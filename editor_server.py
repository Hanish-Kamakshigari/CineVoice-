"""Loopback-only HTTP API for CineVoice's narration-led editor."""
from __future__ import annotations

import json
import mimetypes
import os
import re
import threading
import urllib.parse
import uuid
import shutil
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import edge_tts

from editor_render import RenderJobs, MAX_ASSET_BYTES, _asset_path, _number, MAX_SEGMENTS, MAX_NARRATION
from editor_colorist import ColoristJobs
from video_enhancer import process_video_enhancement


ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / ".cinevoice-editor"
ASSETS = RUNTIME / "assets"
EXPORTS = RUNTIME / "exports"
TMP = RUNTIME / "tmp"
COLORIST_REPORTS = RUNTIME / "colorist"
for folder in (ASSETS, EXPORTS, TMP, COLORIST_REPORTS):
    folder.mkdir(parents=True, exist_ok=True)

MAX_JSON = 256 * 1024
# The studio may also be opened from its hosted deployment, which is a
# different origin. Only these origins may drive the loopback server; add
# more with CINEVOICE_ALLOWED_ORIGINS (comma separated) if needed.
DEFAULT_ALLOWED_ORIGINS = "https://cine-voice-puce.vercel.app"
ALLOWED_STATIC = {
    "index.html", "editor.html", "editor.js", "editor.css", "coach.js", "favicon.svg",
    "favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "site.webmanifest",
    "apple-touch-icon.png", "android-chrome-192x192.png", "android-chrome-512x512.png",
    # The studio's bundled demo film, so "Load Demo" works without network access.
    "THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4",
}
PUBLIC_ASSET_DIRS = {"cinematic_film_assets"}
JOBS = RenderJobs(RUNTIME)
COLORIST = ColoristJobs(RUNTIME)


def _json(handler, status, value):
    raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(raw)


def _allowed_origins() -> set[str]:
    raw = os.environ.get("CINEVOICE_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    return {item.strip().rstrip("/").lower() for item in raw.split(",") if item.strip()}


def _origin_allowed(host, origin) -> bool:
    """Only loopback hosts may be driven, and only by local or allowlisted pages."""
    host = (host or "").split(":", 1)[0].lower().strip("[]")
    if host not in {"localhost", "127.0.0.1"}:
        return False
    if not origin or origin == "null":
        return True
    parsed = urllib.parse.urlparse(origin)
    if parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}:
        return True
    return origin.rstrip("/").lower() in _allowed_origins()


def _safe_name(name):
    name = Path(name or "upload.bin").name
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:100]
    return name or "upload.bin"


class EditorHandler(BaseHTTPRequestHandler):
    server_version = "CineVoiceEditor/1"

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Chrome gates public pages calling loopback behind a private network
        # access preflight; this opt-in lets the hosted studio reach the server.
        if self.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _origin_ok(self):
        return _origin_allowed(self.headers.get("Host", ""), self.headers.get("Origin"))

    def _body(self, limit=MAX_JSON):
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            raise ValueError("invalid content length")
        if length < 0 or length > limit:
            raise ValueError("request body is too large")
        return self.rfile.read(length)

    def do_GET(self):
        if not self._origin_ok():
            return _json(self, HTTPStatus.FORBIDDEN, {"error": "loopback host required"})
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            return _json(self, 200, {"ok": True})
        if parsed.path.startswith("/api/jobs/"):
            value = JOBS.get(parsed.path.rsplit("/", 1)[-1])
            return _json(self, 200 if value else 404, value or {"error": "job not found"})
        if parsed.path.startswith("/api/colorist/jobs/"):
            value = COLORIST.get(parsed.path.rsplit("/", 1)[-1])
            return _json(self, 200 if value else 404, value or {"error": "job not found"})
        if parsed.path.startswith("/api/colorist/report/"):
            return self._colorist_report(parsed.path)
        if parsed.path.startswith("/media/"):
            return self._file(ASSETS / parsed.path.rsplit("/", 1)[-1], allow_range=True)
        if parsed.path.startswith("/exports/"):
            name = parsed.path.rsplit("/", 1)[-1]
            if not re.fullmatch(r"[0-9a-f]{32}\.mp4", name):
                return _json(self, 404, {"error": "not found"})
            return self._file(EXPORTS / name, allow_range=True)
        return self._static(parsed.path)

    def _static(self, path):
        clean = urllib.parse.unquote(path).lstrip("/")
        if clean == "":
            clean = "editor.html" if (ROOT / "editor.html").exists() else "index.html"
        parts = clean.split("/")
        if clean in ALLOWED_STATIC:
            # Byte ranges are what make seeking inside the demo film responsive.
            return self._file(ROOT / clean, allow_range=clean.endswith(".mp4"))
        if len(parts) == 2 and parts[0] in PUBLIC_ASSET_DIRS and Path(parts[1]).name == parts[1]:
            return self._file(ROOT / parts[0] / parts[1])
        return _json(self, 404, {"error": "not found"})

    def _file(self, path, allow_range=False):
        try:
            path = path.resolve()
            if not path.is_file():
                raise FileNotFoundError
            size = path.stat().st_size
            start, end = 0, size - 1
            status = 200
            if allow_range and self.headers.get("Range"):
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers["Range"].strip())
                if not match:
                    raise ValueError
                if match.group(1):
                    start = int(match.group(1)); end = int(match.group(2) or size - 1)
                else:
                    start = max(0, size - int(match.group(2)))
                if start >= size or end < start:
                    self.send_error(416); return
                end = min(end, size - 1); status = 206
            self.send_response(status)
            ctype = mimetypes.guess_type(str(path))[0]
            if not ctype:
                try:
                    with path.open("rb") as test_f:
                        header = test_f.read(16)
                        if b"ftyp" in header or header.startswith(b"\x00\x00\x00"):
                            ctype = "video/mp4"
                        elif header.startswith(b"ID3") or header.startswith(b"\xff\xfb"):
                            ctype = "audio/mpeg"
                        elif header.startswith(b"RIFF"):
                            ctype = "audio/wav"
                except Exception:
                    pass
            self.send_header("Content-Type", ctype or "application/octet-stream")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Access-Control-Allow-Origin", "*")
            if status == 206: self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with path.open("rb") as fh:
                fh.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = fh.read(min(1024 * 1024, remaining))
                    if not chunk: break
                    self.wfile.write(chunk); remaining -= len(chunk)
        except (FileNotFoundError, ValueError):
            _json(self, 404, {"error": "not found"})

    def do_POST(self):
        if not self._origin_ok():
            return _json(self, 403, {"error": "loopback host required"})
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/upload": return self._upload(parsed)
            if parsed.path == "/api/narration": return self._narration()
            if parsed.path == "/api/export": return self._export()
            if parsed.path == "/api/enhance": return self._enhance()
            if parsed.path == "/api/colorist/analyze": return self._colorist_analyze()
            if parsed.path == "/api/colorist/apply": return self._colorist_apply()
            _json(self, 404, {"error": "not found"})
        except (ValueError, json.JSONDecodeError) as exc:
            _json(self, 400, {"error": str(exc)})

    def _upload(self, parsed):
        length = int(self.headers.get("Content-Length", "-1"))
        if length <= 0 or length > MAX_ASSET_BYTES: raise ValueError("upload is empty or too large")
        asset_id = uuid.uuid4().hex
        path = ASSETS / asset_id
        with path.open("wb") as fh:
            remaining = length
            while remaining:
                data = self.rfile.read(min(1024 * 1024, remaining))
                if not data: raise ValueError("truncated upload")
                fh.write(data); remaining -= len(data)
        name = _safe_name(urllib.parse.parse_qs(parsed.query).get("name", ["upload.bin"])[0])
        _json(self, 200, {"id": asset_id, "url": f"/media/{asset_id}", "name": name})

    def _narration(self):
        value = json.loads(self._body())
        if not isinstance(value, dict) or not isinstance(value.get("text"), str) or not value["text"].strip() or len(value["text"]) > 20000:
            raise ValueError("text is required")
        voice = value.get("voice")
        if voice not in {"male", "female"}: raise ValueError("voice must be male or female")
        asset_id = uuid.uuid4().hex; path = ASSETS / asset_id
        voice_name = "en-US-ChristopherNeural" if voice == "male" else "en-US-JennyNeural"
        import asyncio
        asyncio.run(edge_tts.Communicate(value["text"], voice_name).save(str(path)))
        _json(self, 200, {"id": asset_id, "url": f"/media/{asset_id}", "name": asset_id + ".mp3"})

    def _export(self):
        value = json.loads(self._body())
        if not isinstance(value, dict): raise ValueError("request must be an object")
        # Reject malformed requests before creating a job (the worker repeats
        # these checks, since queued requests can outlive this handler).
        _asset_path(RUNTIME, value.get("videoId"))
        segments = value.get("segments")
        if not isinstance(segments, list) or not segments or len(segments) > MAX_SEGMENTS:
            raise ValueError("segments must be a nonempty array")
        for segment in segments:
            if not isinstance(segment, dict): raise ValueError("invalid segment")
            _number(segment.get("start"), "segment start")
            _number(segment.get("end"), "segment end")
        narration = value.get("narration", [])
        if not isinstance(narration, list) or len(narration) > MAX_NARRATION:
            raise ValueError("invalid narration array")
        for item in narration:
            if not isinstance(item, dict): raise ValueError("invalid narration item")
            _asset_path(RUNTIME, item.get("assetId"))
        music = value.get("music")
        if music is not None:
            if not isinstance(music, dict): raise ValueError("music must be null or an object")
            _asset_path(RUNTIME, music.get("assetId"))
        job_id = JOBS.submit(value)
        _json(self, 202, {"id": job_id})

    def _enhance(self):
        value = json.loads(self._body())
        if not isinstance(value, dict): raise ValueError("request must be an object")

        # Get and validate video asset ID
        video_id = value.get("videoId")
        if not video_id:
            raise ValueError("videoId is required")
        video_path = _asset_path(RUNTIME, video_id)

        presets = value.get("presets")
        preset_type = value.get("presetType", "modern_cinematic")

        # Generate standard 32-character hex asset ID (strictly validated by export pipeline)
        enhanced_id = uuid.uuid4().hex
        target_path = ASSETS / enhanced_id

        # Import enhancement module
        from video_enhancer import process_video_enhancement

        try:
            process_video_enhancement(
                str(video_path),
                str(target_path),
                presets=presets,
                preset_type=preset_type,
                scene_enhancement=True
            )
        except Exception as exc:
            import traceback
            traceback.print_exc()
            raise ValueError(f"Video enhancement failed: {exc}")

        _json(self, 200, {
            "id": enhanced_id,
            "url": f"/media/{enhanced_id}",
            "originalId": video_id,
            "path": str(target_path),
            "message": "Video enhanced successfully"
        })

    # ------------------------------------------------------------------
    # AI Colorist
    # ------------------------------------------------------------------
    def _colorist_analyze(self):
        value = json.loads(self._body())
        if not isinstance(value, dict): raise ValueError("request must be an object")
        video_id = value.get("videoId")
        if not video_id: raise ValueError("videoId is required")
        # Validate the asset before the job is queued.
        _asset_path(RUNTIME, video_id)
        preset = value.get("preset", "cinematic")
        if not isinstance(preset, str): raise ValueError("preset must be a string")
        job_id = COLORIST.submit_analysis({"videoId": video_id, "preset": preset})
        _json(self, 202, {"id": job_id})

    def _colorist_apply(self):
        value = json.loads(self._body())
        if not isinstance(value, dict): raise ValueError("request must be an object")
        report_id = value.get("reportId")
        if not isinstance(report_id, str) or not report_id: raise ValueError("reportId is required")
        report = COLORIST.load_report(report_id)
        if not report: raise ValueError("colorist report not found")
        video_id = value.get("videoId") or report.get("video_id")
        if not video_id: raise ValueError("videoId is required")
        _asset_path(RUNTIME, video_id)
        encode_preset = value.get("encodePreset", "fast")
        job_id = COLORIST.submit_render({
            "reportId": report_id,
            "videoId": video_id,
            "encodePreset": encode_preset,
        })
        _json(self, 202, {"id": job_id})

    def _colorist_report(self, path):
        parts = [part for part in path.split("/") if part]
        # /api/colorist/report/<id>/<artefact>
        if len(parts) != 5: return _json(self, 404, {"error": "not found"})
        report_id, artefact = parts[3], parts[4]
        if not re.fullmatch(r"[0-9a-f]{32}", report_id): return _json(self, 404, {"error": "not found"})
        report = COLORIST.load_report(report_id)
        if not report: return _json(self, 404, {"error": "not found"})
        preset = report.get("preset", "cinematic")
        if artefact == "lut":
            return self._download(f"cinevoice_{preset}.cube", report.get("lut", ""), "text/plain")
        if artefact == "tone.cube":
            return self._download(f"cinevoice_{preset}_tone.cube", report.get("lut_tone", ""), "text/plain")
        if artefact == "filtergraph":
            return self._download(f"cinevoice_{preset}.ffgraph", report.get("timeline_filtergraph", ""), "text/plain")
        if artefact == "scene-filtergraph":
            return self._download(f"cinevoice_{preset}_scenes.ffgraph", report.get("filtergraph", ""), "text/plain")
        if artefact == "script":
            return self._download("colorist_grade.py", report.get("python_script", ""), "text/x-python")
        if artefact == "recipe":
            return self._download(f"cinevoice_{preset}_resolve.txt", report.get("resolve_recipe", ""), "text/plain")
        return _json(self, 404, {"error": "not found"})

    def _download(self, filename, text, content_type):
        raw = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)


def serve(host="127.0.0.1", port=8080):
    if host != "127.0.0.1": raise ValueError("server must bind loopback")
    server = ThreadingHTTPServer((host, port), EditorHandler)
    print(f"CineVoice editor: http://127.0.0.1:{server.server_port}")
    server.serve_forever()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    serve(port=parser.parse_args().port)
