"""AI Colorist job runner for the local CineVoice editor.

The editor API stays responsive by running the measurement and the render in
background jobs, exactly like the narration export does.

The NVIDIA Nemotron pass is optional. When ``NVIDIA_API_KEY`` is present the
runner calls the model directly, otherwise it forwards the request to the
serverless proxy in ``api/colorist.js``. If neither is reachable the
deterministic grade from :mod:`video_colorist` is used unchanged, so the
feature always produces a result.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import video_colorist
from editor_render import MAX_ASSET_BYTES, _asset_path


DEFAULT_PROXY_URL = "https://cine-voice-puce.vercel.app/api/colorist"
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
DEFAULT_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
REPORT_TIMEOUT = 900


def _load_dotenv() -> None:
    """Pick up the project ``.env`` file so local runs can use the AI key.

    Existing environment variables always win, and the file is optional.
    """
    path = Path(__file__).resolve().parent / ".env"
    if not path.is_file():
        return
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip()
        value = value.strip().strip("'").strip('"')
        if name and value and name not in os.environ:
            os.environ[name] = value


_load_dotenv()


def _environment(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def proxy_url() -> str:
    return _environment("COLORIST_PROXY_URL", DEFAULT_PROXY_URL)


def nvidia_model() -> str:
    return _environment("NEMOTRON_MODEL", DEFAULT_MODEL)


def _post_json(url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout: int) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    for key, value in headers.items():
        request.add_header(key, value)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8", "replace")
    return json.loads(raw)


def call_nemotron(payload: Dict[str, Any], api_key: str) -> Dict[str, Any]:
    """Ask Nemotron for a per-scene colour decision."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are a senior digital colourist and post-production supervisor. "
                "You receive measured technical statistics and one keyframe per scene "
                "from a short film. For every scene, return a JSON diagnosis and a "
                "restoration recipe. Answer with JSON only."
            ),
        }
    ]
    content: list[Dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "Review the scene measurements and keyframes below and produce a "
                "colour restoration plan for each scene.\n\n"
                "Measurements:\n"
                + json.dumps(
                    [
                        {
                            "index": scene["index"],
                            "start": scene["start"],
                            "end": scene["end"],
                            "stats": scene["stats"],
                        }
                        for scene in payload["scenes"]
                    ],
                    indent=1,
                )
                + "\n\nAnswer with this exact JSON shape:\n"
                '{"scenes":[{"index":0,"diagnosis":["short finding"],'
                '"severity":"low|medium|high",'
                '"grade":{"exposure":0.0,"contrast":1.0,"saturation":1.0,'
                '"shadow_lift":0.0,"highlight_rolloff":0.0,"wb":[1.0,1.0,1.0],'
                '"denoise_luma":0.0,"denoise_chroma":0.0,"sharpen":0.0,"grain":0}}],'
                '"film_summary":"one paragraph",'
                '"global_notes":["short note"]}\n\n'
                "Rules: exposure is in stops (-1..1); contrast and saturation are "
                "multipliers around 1.0; keep the change per scene small and never "
                "destroy skin texture. You may look at the attached keyframes."
            ),
        }
    ]
    for scene in payload["scenes"]:
        keyframe = scene.get("keyframe")
        if keyframe:
            content.append({"type": "text", "text": f"Scene {scene['index']} keyframe:"})
            content.append({"type": "image_url", "image_url": {"url": keyframe}})

    messages.append({"role": "user", "content": content})
    response = _post_json(
        NVIDIA_URL,
        {
            "model": nvidia_model(),
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 4096,
        },
        {"Authorization": f"Bearer {api_key}"},
        timeout=REPORT_TIMEOUT,
    )
    choices = response.get("choices") or []
    if not choices:
        raise RuntimeError("Nemotron returned no choices")
    text = (choices[0].get("message") or {}).get("content") or ""
    return _parse_json_object(text)


def _parse_json_object(text: str) -> Dict[str, Any]:
    """Pull the first JSON object out of a model answer."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```", 2)[1] if cleaned.count("```") >= 2 else cleaned
        cleaned = cleaned.lstrip("json").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError("Nemotron did not return JSON")
    return json.loads(cleaned[start : end + 1])


def request_ai_review(report: Dict[str, Any]) -> Dict[str, Any]:
    """Try to refine the deterministic plan with Nemotron.

    Returns a dict with ``ai`` (the model answer or ``None``) and ``offline``
    (True when the model could not be reached).
    """
    payload = video_colorist.build_payload(report)
    api_key = _environment("NVIDIA_API_KEY")
    try:
        if api_key:
            answer = call_nemotron(payload, api_key)
        else:
            url = proxy_url()
            if not url:
                raise RuntimeError("no colorist endpoint configured")
            answer = _post_json(
                url,
                payload,
                {"Content-Type": "application/json"},
                timeout=REPORT_TIMEOUT,
            )
        if not isinstance(answer, dict):
            raise RuntimeError("colorist endpoint returned an unexpected payload")
        return {"ai": answer, "offline": bool(answer.get("offline"))}
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError, RuntimeError) as exc:
        return {"ai": None, "offline": True, "reason": str(exc)[:300]}


def apply_ai_review(report: Dict[str, Any], answer: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Merge an AI answer into the deterministic report."""
    if not answer:
        return report
    by_index = {}
    for scene in answer.get("scenes") or []:
        if isinstance(scene, dict) and isinstance(scene.get("index"), int):
            by_index[scene["index"]] = scene

    for scene in report["scenes"]:
        proposal = by_index.get(scene["index"])
        if not proposal:
            continue
        grade = proposal.get("grade")
        if isinstance(grade, dict):
            scene["grade"] = video_colorist.merge_ai_plan(scene["grade"], grade)
        diagnosis = proposal.get("diagnosis")
        if isinstance(diagnosis, list) and diagnosis:
            scene["ai_diagnosis"] = [str(item)[:200] for item in diagnosis][:6]
        severity = proposal.get("severity")
        if isinstance(severity, str):
            scene["ai_severity"] = severity[:20]

    report["film_summary"] = str(answer.get("film_summary") or "")[:1200]
    report["global_notes"] = [str(note)[:300] for note in (answer.get("global_notes") or [])][:8]
    return report


class ColoristJobs:
    """Background job registry for colour analysis and colour renders."""

    def __init__(self, root: Path):
        self.root = root
        self.lock = threading.Lock()
        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.reports: Dict[str, Dict[str, Any]] = {}
        self.active = False

    # -- analysis ---------------------------------------------------------
    def submit_analysis(self, request: Dict[str, Any]) -> str:
        job_id = uuid.uuid4().hex
        with self.lock:
            self.jobs[job_id] = {"status": "queued", "kind": "analysis"}
        threading.Thread(target=self._analyse, args=(job_id, request), daemon=True).start()
        return job_id

    def _analyse(self, job_id: str, request: Dict[str, Any]) -> None:
        self._begin(job_id)
        try:
            video_id = request.get("videoId")
            preset = request.get("preset", "cinematic")
            if preset not in video_colorist.PRESETS:
                raise ValueError("unknown colorist preset")
            video = _asset_path(self.root, video_id)
            report = video_colorist.analyze_video(video, preset_name=preset)
            review = request_ai_review(report)
            report = apply_ai_review(report, review.get("ai"))
            report["offline"] = bool(review.get("offline"))
            if review.get("reason"):
                report["offline_reason"] = review["reason"]
            report["report_id"] = job_id
            report["video_id"] = video_id
            report["preset"] = preset
            self._save_report(report)
            with self.lock:
                self.jobs[job_id] = {
                    "status": "done",
                    "kind": "analysis",
                    "report_id": job_id,
                    "report": public_report(report),
                }
        except Exception as exc:
            with self.lock:
                self.jobs[job_id] = {"status": "error", "kind": "analysis", "error": str(exc)[:1200]}
        finally:
            self._end()

    # -- render -----------------------------------------------------------
    def submit_render(self, request: Dict[str, Any]) -> str:
        job_id = uuid.uuid4().hex
        with self.lock:
            self.jobs[job_id] = {"status": "queued", "kind": "render"}
        threading.Thread(target=self._render, args=(job_id, request), daemon=True).start()
        return job_id

    def _render(self, job_id: str, request: Dict[str, Any]) -> None:
        self._begin(job_id)
        tmp = Path(tempfile.mkdtemp(prefix="colorist-", dir=self.root / "tmp"))
        try:
            report_id = request.get("reportId")
            report = self.load_report(report_id)
            if not report:
                raise ValueError("colorist report not found")
            video_id = request.get("videoId") or report.get("video_id")
            video = _asset_path(self.root, video_id)
            encode_preset = request.get("encodePreset", "fast")
            if encode_preset not in {"veryfast", "fast", "medium", "slow"}:
                encode_preset = "fast"
            out = tmp / (job_id + ".mp4")
            video_colorist.grade_video(
                video,
                out,
                report,
                use_timeline_graph=bool(request.get("timeline", True)),
                encode_preset=encode_preset,
            )
            final = self.root / "exports" / (job_id + ".mp4")
            os.replace(out, final)
            # The graded master also becomes an editor asset so it can be used
            # as the source of the next edit.
            asset_id = uuid.uuid4().hex
            shutil.copy2(final, self.root / "assets" / asset_id)
            with self.lock:
                self.jobs[job_id] = {
                    "status": "done",
                    "kind": "render",
                    "url": f"/exports/{job_id}.mp4",
                    "assetId": asset_id,
                    "assetUrl": f"/media/{asset_id}",
                }
        except Exception as exc:
            with self.lock:
                self.jobs[job_id] = {"status": "error", "kind": "render", "error": str(exc)[:1200]}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            self._end()

    # -- shared -----------------------------------------------------------
    def _begin(self, job_id: str) -> None:
        while True:
            with self.lock:
                if not self.active:
                    self.active = True
                    self.jobs[job_id]["status"] = "running"
                    return
            time.sleep(0.05)

    def _end(self) -> None:
        with self.lock:
            self.active = False

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            return self.jobs.get(job_id)

    def _save_report(self, report: Dict[str, Any]) -> None:
        folder = self.root / "colorist"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{report['report_id']}.json"
        path.write_text(json.dumps(report), encoding="utf-8")
        with self.lock:
            self.reports[report["report_id"]] = report

    def load_report(self, report_id: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(report_id, str):
            return None
        with self.lock:
            report = self.reports.get(report_id)
        if report:
            return report
        path = self.root / "colorist" / f"{report_id}.json"
        if not path.is_file() or len(path.read_text(encoding="utf-8")) > MAX_ASSET_BYTES:
            return None
        return json.loads(path.read_text(encoding="utf-8"))


def public_report(report: Dict[str, Any]) -> Dict[str, Any]:
    """Strip the heavy artefacts (LUT and script) out of the API payload."""
    compact = {
        key: value
        for key, value in report.items()
        if key not in {"lut", "lut_tone", "python_script", "scenes"}
    }
    compact["scenes"] = [
        {
            "index": scene["index"],
            "start": scene["start"],
            "end": scene["end"],
            "duration": scene["duration"],
            "issues": scene["issues"],
            "actions": scene["actions"],
            "grade": scene["grade"],
            "stats": {key: round(float(value), 5) for key, value in scene["stats"].items()},
            "ai_diagnosis": scene.get("ai_diagnosis", []),
            "ai_severity": scene.get("ai_severity", ""),
        }
        for scene in report["scenes"]
    ]
    compact["filtergraph"] = report.get("timeline_filtergraph", "")
    compact["scene_filtergraph"] = report.get("filtergraph", "")
    compact["resolve_recipe"] = report.get("resolve_recipe", "")
    return compact
