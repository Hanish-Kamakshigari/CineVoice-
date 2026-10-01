"""FFmpeg render worker for the local narration editor.

The module deliberately accepts only server-side asset ids.  Callers never get
to supply a filename or an FFmpeg option.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import re
from pathlib import Path

import imageio_ffmpeg


MAX_SEGMENTS = 120
MAX_NARRATION = 120
MAX_DURATION = 60 * 60
MAX_ASSET_BYTES = 512 * 1024 * 1024
FFMPEG_TIMEOUT = 30 * 60


def _number(value, name, *, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    value = float(value)
    if value != value or value in (float("inf"), float("-inf")) or value < 0:
        raise ValueError(f"{name} must be a finite nonnegative number")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} is too large")
    return value


def _ffmpeg():
    return imageio_ffmpeg.get_ffmpeg_exe()


def _asset_path(root: Path, asset_id: str) -> Path:
    if not isinstance(asset_id, str) or len(asset_id) < 16 or len(asset_id) > 80:
        raise ValueError("invalid asset id")
    if any(c not in "0123456789abcdef" for c in asset_id):
        raise ValueError("invalid asset id")
    path = root / "assets" / asset_id
    if not path.is_file() or path.stat().st_size > MAX_ASSET_BYTES:
        raise ValueError("asset not found")
    return path


def _run(cmd, *, timeout=FFMPEG_TIMEOUT):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout, check=True)


def _has_audio(path):
    # ffmpeg's bundled binary is used instead of assuming ffprobe is installed.
    result = subprocess.run([_ffmpeg(), "-hide_banner", "-i", str(path)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=20)
    return bool(re.search(rb"Stream .*: Audio:", result.stderr))


def render_export(root: Path, request: dict, output: Path) -> None:
    """Render one validated export request into *output*."""
    if not isinstance(request, dict):
        raise ValueError("request must be an object")
    video_id = request.get("videoId")
    video = _asset_path(root, video_id)
    segments = request.get("segments")
    if not isinstance(segments, list) or not segments or len(segments) > MAX_SEGMENTS:
        raise ValueError("segments must be a nonempty array")
    segs = []
    total = 0.0
    for segment in segments:
        if not isinstance(segment, dict):
            raise ValueError("invalid segment")
        start = _number(segment.get("start"), "segment start", maximum=MAX_DURATION)
        end = _number(segment.get("end"), "segment end", maximum=MAX_DURATION)
        if end <= start:
            raise ValueError("segment end must be greater than start")
        total += end - start
        if total > MAX_DURATION:
            raise ValueError("export is too long")
        segs.append((start, end))

    original_gain = _number(request.get("originalGain", 1), "originalGain", maximum=1)
    narration = request.get("narration", [])
    if not isinstance(narration, list) or len(narration) > MAX_NARRATION:
        raise ValueError("invalid narration array")
    narr = []
    for item in narration:
        if not isinstance(item, dict):
            raise ValueError("invalid narration item")
        source = _asset_path(root, item.get("assetId"))
        start = _number(item.get("start"), "narration start", maximum=MAX_DURATION)
        offset = _number(item.get("offset", 0), "narration offset", maximum=MAX_DURATION)
        duration = _number(item.get("duration"), "narration duration", maximum=MAX_DURATION)
        gain = _number(item.get("gain", 1), "narration gain", maximum=4)
        if duration <= 0 or start + duration > total + 0.05:
            raise ValueError("narration lies outside the output")
        narr.append((source, start, offset, duration, gain))

    music = request.get("music")
    music_data = None
    if music is not None:
        if not isinstance(music, dict):
            raise ValueError("music must be null or an object")
        music_data = (_asset_path(root, music.get("assetId")),
                      _number(music.get("gain", 1), "music gain", maximum=4))

    # Every segment gets its own input so concat preserves caller order.  The
    # audio branch is optional (anullsrc makes videos without audio work).
    has_audio = _has_audio(video)
    inputs = ["-i", str(video)]
    audio_source = 0
    if not has_audio:
        inputs += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        audio_source = 1
    filters = []
    vlabels = []
    alabels = []
    for i, (start, end) in enumerate(segs):
        filters += [f"[0:v]trim=start={start:.6f}:end={end:.6f},setpts=PTS-STARTPTS[v{i}]"]
        filters += [f"[{audio_source}:a]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS[a{i}]"]
        vlabels.append(f"[v{i}]")
        alabels.append(f"[a{i}]")
    filters.append("".join(vlabels) + "concat=n=%d:v=1:a=0[vout]" % len(segs))
    filters.append("".join(alabels) + "concat=n=%d:v=0:a=1[origraw]" % len(segs))
    filters.append(f"[origraw]volume={original_gain:.6f}[orig]")

    # Narration files are separate inputs; adelay places each clip on the
    # output timeline and apad keeps the mix well-defined.
    narration_labels = []
    for i, (source, start, offset, duration, gain) in enumerate(narr):
        inputs += ["-i", str(source)]
        filters.append(
            f"[{i + 1 + (0 if has_audio else 1)}:a]atrim=start={offset:.6f}:duration={duration:.6f},"
            f"asetpts=PTS-STARTPTS,volume={gain:.6f},adelay={int(start * 1000)}:all=1[n{i}]"
        )
        narration_labels.append(f"[n{i}]")
    if narration_labels:
        filters.append("".join(narration_labels) + "amix=inputs=%d:duration=longest:normalize=0[narr]" % len(narration_labels))
    else:
        filters.append("anullsrc=r=48000:cl=stereo,atrim=duration=%.6f[narr]" % total)

    audio_inputs = ["[orig]"]
    if music_data:
        source, gain = music_data
        inputs += ["-stream_loop", "-1", "-i", str(source)]
        music_input = len(narr) + 1 + (0 if has_audio else 1)
        filters.append(f"[{music_input}:a]atrim=duration={total:.6f},asetpts=PTS-STARTPTS,volume={gain:.6f}[musicraw]")
        # The narration signal is also the side-chain key.  This ducks only
        # while speech exists, rather than lowering music for the whole film.
        filters.append("[musicraw][narr]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350:makeup=1[music]")
        audio_inputs.append("[music]")
    audio_inputs.append("[narr]")
    filters.append("".join(audio_inputs) + "amix=inputs=%d:duration=first:normalize=0,alimiter=limit=0.97[aout]" % len(audio_inputs))

    cmd = [_ffmpeg(), "-y", *inputs, "-filter_complex", ";".join(filters),
           "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.6f}",
           "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output)]
    try:
        _run(cmd)
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", "replace")[-1200:]
        raise RuntimeError("FFmpeg export failed: " + detail) from exc


class RenderJobs:
    """Small persistent-in-process job registry; one render runs at a time."""
    def __init__(self, root: Path):
        self.root = root
        self.lock = threading.Lock()
        self.jobs = {}
        self.active = False

    def submit(self, request):
        job_id = uuid.uuid4().hex
        with self.lock:
            if self.active:
                # Queue semantics are explicit: the worker starts the job as
                # soon as the previous one finishes.
                pass
            self.jobs[job_id] = {"status": "queued"}
        threading.Thread(target=self._work, args=(job_id, request), daemon=True).start()
        return job_id

    def _work(self, job_id, request):
        while True:
            with self.lock:
                if not self.active:
                    self.active = True
                    self.jobs[job_id]["status"] = "running"
                    break
            time.sleep(0.05)
        tmp = Path(tempfile.mkdtemp(prefix="export-", dir=self.root / "tmp"))
        try:
            out = tmp / (job_id + ".mp4")
            render_export(self.root, request, out)
            final = self.root / "exports" / (job_id + ".mp4")
            os.replace(out, final)
            with self.lock:
                self.jobs[job_id] = {"status": "done", "url": f"/exports/{job_id}.mp4"}
        except Exception as exc:
            with self.lock:
                self.jobs[job_id] = {"status": "error", "error": str(exc)[:2000]}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            with self.lock:
                self.active = False

    def get(self, job_id):
        with self.lock:
            return self.jobs.get(job_id)
