"""Loopback-only HTTP API for CineVoice's narration-led editor."""
from __future__ import annotations

import json
import mimetypes
import os
import re
import threading
import urllib.parse
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import edge_tts

from editor_render import RenderJobs, MAX_ASSET_BYTES, _asset_path, _number, MAX_SEGMENTS, MAX_NARRATION


ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / ".cinevoice-editor"
ASSETS = RUNTIME / "assets"
EXPORTS = RUNTIME / "exports"
TMP = RUNTIME / "tmp"
for folder in (ASSETS, EXPORTS, TMP):
    folder.mkdir(parents=True, exist_ok=True)

MAX_JSON = 256 * 1024
ALLOWED_STATIC = {
    "index.html", "editor.html", "editor.js", "editor.css", "coach.js", "favicon.svg",
    "favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "site.webmanifest",
    "apple-touch-icon.png", "android-chrome-192x192.png", "android-chrome-512x512.png",
}
PUBLIC_ASSET_DIRS = {"cinematic_film_assets"}
JOBS = RenderJobs(RUNTIME)


def _json(handler, status, value):
    raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def _safe_name(name):
    name = Path(name or "upload.bin").name
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:100]
    return name or "upload.bin"


class EditorHandler(BaseHTTPRequestHandler):
    server_version = "CineVoiceEditor/1"

    def _origin_ok(self):
        host = self.headers.get("Host", "").split(":", 1)[0].lower().strip("[]")
        if host not in {"localhost", "127.0.0.1"}:
            return False
        origin = self.headers.get("Origin")
        if origin:
            parsed = urllib.parse.urlparse(origin)
            if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1"}:
                return False
            # A browser can use either loopback spelling, but must use this port.
            if parsed.port not in (None, self.server.server_port):
                return False
        return True

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
            return self._file(ROOT / clean)
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
            self.send_header("Content-Type", mimetypes.guess_type(str(path))[0] or "application/octet-stream")
            self.send_header("Content-Length", str(end - start + 1))
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
