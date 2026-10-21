"""AI Colorist and post-production restoration engine for CineVoice.

The engine is deterministic and works fully offline:

* :func:`detect_scenes` finds hard cuts with FFmpeg's ``scdet`` filter.
* :func:`measure_video` samples frames of every scene and measures exposure,
  contrast, noise, white balance, saturation, detail and skin ratio.
* :func:`plan_scene` turns those measurements plus a look preset into a
  per-scene grade recipe (curves, colour balance, denoise, sharpen, grain).
* :func:`build_scene_filtergraph` compiles the recipes into one FFmpeg
  ``-filter_complex`` graph, and :func:`build_cube_lut` bakes the same
  transform into a DaVinci Resolve ``.cube`` LUT.

An optional NVIDIA Nemotron pass (``api/colorist.js``) can refine the
diagnostics and the recipes; the renderer always stays deterministic so the
same input always produces the same output.
"""
from __future__ import annotations

import base64
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np


CINEVOICE_ROOT = Path(__file__).resolve().parent
LUT_SIZE = 33
CURVE_POINTS = 17
MAX_SCENES = 24
MIN_SCENE_SECONDS = 0.8
SAMPLE_WIDTH = 480
SAMPLES_PER_SCENE = 6

# Rec.709 luma weights, used for every luminance decision in the engine.
LR, LG, LB = 0.2126, 0.7152, 0.0722
PIVOT = 0.42          # encoded-space contrast pivot
HIGHLIGHT_KNEE = 0.72  # encoded-space highlight roll-off knee


PRESETS: Dict[str, Dict[str, Any]] = {
    "natural": {
        "label": "Natural Skin",
        "description": "Correction only. Preserves skin texture and true colour.",
        "target_luma": 0.44,
        "contrast": 1.04,
        "saturation": 1.0,
        "grain": 5,
        "max_exposure": 0.7,
        "denoise_bias": 0.85,
        "sharpen_bias": 0.9,
        "shadow_tint": [0.0, 0.0, 0.0],
        "highlight_tint": [0.0, 0.0, 0.0],
    },
    "cinematic": {
        "label": "Cinematic",
        "description": "Filmic contrast, teal shadows, warm highlights, organic grain.",
        "target_luma": 0.40,
        "contrast": 1.12,
        "saturation": 1.04,
        "grain": 10,
        "max_exposure": 0.8,
        "denoise_bias": 1.0,
        "sharpen_bias": 1.0,
        "shadow_tint": [-0.004, 0.002, 0.018],
        "highlight_tint": [0.018, 0.004, -0.014],
    },
    "documentary": {
        "label": "Documentary",
        "description": "Even, honest look with restrained contrast and no film tricks.",
        "target_luma": 0.46,
        "contrast": 1.08,
        "saturation": 0.97,
        "grain": 4,
        "max_exposure": 0.75,
        "denoise_bias": 1.15,
        "sharpen_bias": 1.1,
        "shadow_tint": [0.0, 0.0, 0.0],
        "highlight_tint": [0.0, 0.0, 0.0],
    },
    "text_clean": {
        "label": "Clean Text / UI",
        "description": "Crisp on-screen text and interfaces. No grain, local contrast boost.",
        "target_luma": 0.47,
        "contrast": 1.14,
        "saturation": 1.0,
        "grain": 0,
        "max_exposure": 0.6,
        "denoise_bias": 0.7,
        "sharpen_bias": 1.6,
        "shadow_tint": [0.0, 0.0, 0.0],
        "highlight_tint": [0.0, 0.0, 0.0],
    },
    "vintage": {
        "label": "Vintage Print",
        "description": "Faded print emulation with heavy grain and split toning.",
        "target_luma": 0.43,
        "contrast": 1.02,
        "saturation": 0.82,
        "grain": 20,
        "max_exposure": 0.7,
        "denoise_bias": 1.0,
        "sharpen_bias": 0.7,
        "shadow_tint": [0.012, 0.004, -0.006],
        "highlight_tint": [0.026, 0.012, -0.018],
    },
    "broadcast": {
        "label": "Broadcast Safe",
        "description": "Rec.709 compliant. Neutral colour, no grain, broadcast contrast.",
        "target_luma": 0.45,
        "contrast": 1.02,
        "saturation": 1.0,
        "grain": 0,
        "max_exposure": 0.7,
        "denoise_bias": 1.0,
        "sharpen_bias": 1.0,
        "shadow_tint": [0.0, 0.0, 0.0],
        "highlight_tint": [0.0, 0.0, 0.0],
    },
}


# --------------------------------------------------------------------------
# FFmpeg plumbing
# --------------------------------------------------------------------------

class ColoristError(RuntimeError):
    """Raised when the engine cannot read or write the supplied media."""


def ffmpeg_binary() -> str:
    """Locate an FFmpeg binary (explicit override, PATH, then imageio-ffmpeg)."""
    for env_name in ("CINEVOICE_FFMPEG", "FFMPEG_BINARY", "IMAGEIO_FFMPEG_EXE"):
        candidate = os.environ.get(env_name)
        if candidate and Path(candidate).is_file():
            return candidate
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - environment specific
        raise ColoristError(
            "FFmpeg is required. Install imageio-ffmpeg or set FFMPEG_BINARY."
        ) from exc


def _run(cmd: Sequence[str], timeout: int = 1800) -> subprocess.CompletedProcess:
    return subprocess.run(
        list(cmd), capture_output=True, timeout=timeout
    )


def probe_video(path: Path | str) -> Dict[str, Any]:
    """Read duration, resolution, frame rate and audio presence from FFmpeg."""
    exe = ffmpeg_binary()
    proc = _run([exe, "-hide_banner", "-i", str(path)], timeout=120)
    text = proc.stderr.decode("utf-8", "replace")

    duration = 0.0
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if match:
        duration = int(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3))

    width = height = 0
    match = re.search(r"Stream #\d+:\d+.*?Video:.*?(\d{2,5})x(\d{2,5})", text)
    if match:
        width, height = int(match.group(1)), int(match.group(2))

    fps = 0.0
    match = re.search(r"(\d+(?:\.\d+)?)\s*fps", text)
    if match:
        fps = float(match.group(1))
    if fps <= 0:
        match = re.search(r"(\d+(?:\.\d+)?)\s*tbr", text)
        if match:
            fps = float(match.group(1))
    if fps <= 0:
        fps = 25.0

    has_audio = bool(re.search(r"Stream #\d+:\d+.*?Audio:", text))
    return {
        "duration": round(duration, 3),
        "width": width,
        "height": height,
        "fps": fps,
        "has_audio": has_audio,
    }


# --------------------------------------------------------------------------
# Scene detection
# --------------------------------------------------------------------------

def detect_scenes(
    path: Path | str,
    threshold: float = 12.0,
    duration: Optional[float] = None,
    max_scenes: int = MAX_SCENES,
) -> List[Dict[str, Any]]:
    """Detect hard cuts with FFmpeg's ``scdet`` and return scene windows."""
    exe = ffmpeg_binary()
    proc = _run(
        [exe, "-hide_banner", "-i", str(path), "-vf", f"scdet=threshold={threshold}", "-f", "null", "-"],
        timeout=1800,
    )
    text = proc.stderr.decode("utf-8", "replace")
    cuts = sorted({round(float(t), 3) for t in re.findall(r"lavfi\.scd\.time:\s*([0-9.]+)", text)})

    if duration is None:
        duration = probe_video(path)["duration"]
    if not cuts:
        return [{"index": 0, "start": 0.0, "end": round(float(duration), 3)}]

    # Drop cuts that would create a scene shorter than the minimum length.
    kept: List[float] = []
    for cut in cuts:
        previous = kept[-1] if kept else 0.0
        if cut - previous >= MIN_SCENE_SECONDS and duration - cut >= MIN_SCENE_SECONDS:
            kept.append(cut)

    scenes = []
    start = 0.0
    for cut in kept:
        scenes.append({"start": round(start, 3), "end": round(cut, 3)})
        start = cut
    scenes.append({"start": round(start, 3), "end": round(float(duration), 3)})

    # Merge the shortest scenes until the breakdown stays readable.
    while len(scenes) > max_scenes:
        lengths = [s["end"] - s["start"] for s in scenes]
        shortest = int(np.argmin(lengths))
        if shortest == 0:
            victim = 1
        else:
            victim = shortest - 1
        merged = {
            "start": scenes[victim]["start"],
            "end": scenes[victim + 1]["end"],
        }
        scenes[victim : victim + 2] = [merged]

    for index, scene in enumerate(scenes):
        scene["index"] = index
        scene["duration"] = round(scene["end"] - scene["start"], 3)
    return scenes


# --------------------------------------------------------------------------
# Measurement
# --------------------------------------------------------------------------

def _laplacian(plane: np.ndarray) -> np.ndarray:
    padded = np.pad(plane, 1, mode="edge")
    return (
        padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2] + padded[1:-1, 2:] - 4 * plane
    )


def measure_frame(rgb: np.ndarray) -> Dict[str, float]:
    """Measure a single RGB frame (uint8 HxWx3) for grading decisions."""
    x = rgb.astype(np.float32) / 255.0
    red, green, blue = x[..., 0], x[..., 1], x[..., 2]
    luma = LR * red + LG * green + LB * blue

    luma_mean = float(luma.mean())
    luma_std = float(luma.std())
    black_point = float(np.percentile(luma, 0.5))
    shadow_clip = float((luma <= 0.02).mean())
    highlight_clip = float((luma >= 0.98).mean())

    # Noise: robust Laplacian-style estimate restricted to flat areas.
    dx = np.abs(np.diff(luma, axis=1))
    dy = np.abs(np.diff(luma, axis=0))
    dx = dx[:-1, :] if dx.shape[0] > 1 else dx
    dy = dy[:, :-1] if dy.shape[1] > 1 else dy
    grad = np.minimum(dx, dy)
    flat = grad[grad < 0.06]
    sample = flat if flat.size > 500 else grad
    noise = float(1.4826 * np.median(sample) / math.sqrt(2.0))

    # Graphic / UI signature: rows and columns packed with hard edges.
    row_activity = float((dx > 0.12).mean(axis=1).max()) if dx.size else 0.0
    col_activity = float((dy > 0.12).mean(axis=0).max()) if dy.size else 0.0
    graphic_score = 0.5 * row_activity + 0.5 * col_activity
    binary_area = float(((luma < 0.08) | (luma > 0.92)).mean())

    # Sharpness: high-frequency energy relative to overall contrast.
    laplacian = _laplacian(luma)
    detail = float(np.sqrt(np.mean(laplacian ** 2)))
    sharpness = float(detail / (luma_std + 0.04))
    edge_density = float((grad > 0.08).mean())

    # White balance: grey world, plus a white patch reference.
    grey = np.array([red.mean(), green.mean(), blue.mean()], dtype=np.float64)
    patch = np.array(
        [np.percentile(red, 95), np.percentile(green, 95), np.percentile(blue, 95)],
        dtype=np.float64,
    )
    grey = np.maximum(grey, 1e-4)
    patch = np.maximum(patch, 1e-4)
    grey_gain = grey.mean() / grey
    patch_gain = patch.mean() / patch
    # Trust the white patch only when it is not wildly different from grey world.
    if np.abs(patch_gain - grey_gain).max() > 0.25:
        gains = grey_gain
    else:
        gains = 0.5 * (grey_gain + patch_gain)
    cast = float((gains.max() - gains.min()) / gains.max()) if gains.max() > 0 else 0.0

    # Saturation and skin presence. The YCbCb conversion needs the 0-255 scale.
    high = x.max(axis=2)
    low = x.min(axis=2)
    saturation = float(np.mean(np.where(high > 1e-4, (high - low) / np.maximum(high, 1e-4), 0.0)))

    red8, green8, blue8 = red * 255.0, green * 255.0, blue * 255.0
    cb = 128.0 - 0.168736 * red8 - 0.331264 * green8 + 0.5 * blue8
    cr = 128.0 + 0.5 * red8 - 0.418688 * green8 - 0.081312 * blue8
    y601 = 0.299 * red8 + 0.587 * green8 + 0.114 * blue8
    skin = (
        (cb >= 77)
        & (cb <= 133)
        & (cr >= 133)
        & (cr <= 180)
        & (y601 > 60)
        & (red > green)
        & (green > blue)
        & ((red - blue) > 0.06)
    )
    skin_ratio = float(skin.mean())

    return {
        "luma_mean": luma_mean,
        "luma_std": luma_std,
        "black_point": black_point,
        "shadow_clip": shadow_clip,
        "highlight_clip": highlight_clip,
        "noise_sigma": noise,
        "sharpness": sharpness,
        "edge_density": edge_density,
        "cast": cast,
        "wb_gain_r": float(gains[0]),
        "wb_gain_g": float(gains[1]),
        "wb_gain_b": float(gains[2]),
        "saturation": saturation,
        "skin_ratio": skin_ratio,
        "graphic_score": graphic_score,
        "binary_area": binary_area,
    }


def _median_stats(samples: Sequence[Dict[str, float]]) -> Dict[str, float]:
    keys = samples[0].keys()
    return {key: float(np.median([s[key] for s in samples])) for key in keys}


def extract_frames(
    path: Path | str, times: Sequence[float], width: int = SAMPLE_WIDTH
) -> List[np.ndarray]:
    """Extract one frame per timestamp with a single FFmpeg pass."""
    if not times:
        return []
    exe = ffmpeg_binary()
    info = probe_video(path)
    fps = info["fps"] or 25.0
    source_w = info["width"] or 1920
    source_h = info["height"] or 1080
    out_h = max(2, int(round(width * source_h / source_w / 2.0)) * 2)

    indices = sorted({max(0, int(round(t * fps))) for t in times})
    expression = "+".join(f"eq(n\\,{index})" for index in indices)
    proc = _run(
        [
            exe, "-hide_banner", "-loglevel", "error", "-i", str(path),
            "-vf", f"select='{expression}',scale={width}:{out_h}",
            "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        timeout=1800,
    )
    raw = proc.stdout
    frame_bytes = width * out_h * 3
    frames: List[np.ndarray] = []
    for offset in range(0, len(raw) - frame_bytes + 1, frame_bytes):
        frames.append(
            np.frombuffer(raw[offset : offset + frame_bytes], dtype=np.uint8).reshape(out_h, width, 3)
        )

    if len(frames) != len(indices):
        # Fall back to a per-frame seek when the fast path disagrees.
        frames = []
        for time in times:
            single = _run(
                [
                    exe, "-hide_banner", "-loglevel", "error", "-ss", f"{max(0.0, time):.3f}",
                    "-i", str(path), "-frames:v", "1", "-vf", f"scale={width}:{out_h}",
                    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ],
                timeout=300,
            )
            if len(single.stdout) >= frame_bytes:
                frames.append(
                    np.frombuffer(single.stdout[:frame_bytes], dtype=np.uint8).reshape(out_h, width, 3)
                )
    return frames


def measure_video(
    path: Path | str, scenes: Sequence[Dict[str, Any]], samples_per_scene: int = SAMPLES_PER_SCENE
) -> List[Dict[str, float]]:
    """Measure every scene by sampling frames across its time range."""
    times: List[float] = []
    for scene in scenes:
        start = float(scene["start"])
        end = float(scene["end"])
        span = max(0.0, end - start)
        count = max(1, samples_per_scene)
        for index in range(count):
            offset = (index + 0.5) / count
            times.append(start + span * offset)

    frames = extract_frames(path, times)
    if not frames:
        raise ColoristError("Could not decode any frames from the source video.")

    stats: List[Dict[str, float]] = []
    cursor = 0
    for scene in scenes:
        count = max(1, samples_per_scene)
        chunk = frames[cursor : cursor + count]
        cursor += count
        if not chunk:
            chunk = frames[-1:]
        stats.append(_median_stats([measure_frame(frame) for frame in chunk]))
    return stats


def keyframe_jpeg(path: Path | str, time: float, width: int = 512) -> str:
    """Return one keyframe as a base64 JPEG data URI (for the vision model)."""
    exe = ffmpeg_binary()
    proc = _run(
        [
            exe, "-hide_banner", "-loglevel", "error", "-ss", f"{max(0.0, time):.3f}",
            "-i", str(path), "-frames:v", "1", "-vf", f"scale={width}:-2",
            "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
        ],
        timeout=300,
    )
    if not proc.stdout:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(proc.stdout).decode("ascii")


# --------------------------------------------------------------------------
# Grade planning
# --------------------------------------------------------------------------

def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _blank_grade(preset: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "exposure": 0.0,
        "contrast": float(preset["contrast"]),
        "saturation": float(preset["saturation"]),
        "shadow_lift": 0.0,
        "highlight_rolloff": 0.0,
        "wb": [1.0, 1.0, 1.0],
        "shadow_tint": list(preset["shadow_tint"]),
        "highlight_tint": list(preset["highlight_tint"]),
        "denoise_luma": 0.0,
        "denoise_chroma": 0.0,
        "denoise_temporal": 0.0,
        "sharpen": 0.0,
        "normalize": False,
        "grain": float(preset["grain"]),
    }


def plan_scene(
    stats: Dict[str, float],
    preset_name: str = "cinematic",
    context: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """Derive a grade recipe from one scene's measurements.

    ``context`` carries video-wide baselines (currently the median graphic
    activity) so that "UI / text" detection is relative to the film instead
    of firing on every high-contrast cinematic shot.
    """
    context = context or {}
    preset = PRESETS.get(preset_name, PRESETS["cinematic"])
    grade = _blank_grade(preset)
    issues: List[str] = []
    actions: List[str] = []

    luma = stats["luma_mean"]
    target = float(preset["target_luma"])
    max_exposure = float(preset["max_exposure"])

    # Exposure.
    if luma < 0.02:
        grade["exposure"] = 0.0
        issues.append("near-black scene")
        actions.append("lift shadows instead of exposure")
    elif luma < target - 0.13:
        stops = math.log2(max(target, 1e-3) / max(luma, 1e-3))
        grade["exposure"] = _clamp(stops, 0.0, max_exposure)
        if luma < 0.2:
            grade["exposure"] = min(grade["exposure"], max_exposure * 0.7)
        issues.append("under-exposed")
        actions.append(f"raise exposure {grade['exposure']:+.2f} stops")
    elif luma > target + 0.18:
        stops = math.log2(max(luma, 1e-3) / max(target, 1e-3))
        grade["exposure"] = -_clamp(stops, 0.0, 0.8)
        issues.append("over-exposed")
        actions.append(f"lower exposure {grade['exposure']:+.2f} stops")

    # Shadow / highlight range.
    if stats["shadow_clip"] > 0.12 or stats["black_point"] > 0.14:
        grade["shadow_lift"] = _clamp(0.008 + stats["shadow_clip"] * 0.2, 0.0, 0.035)
        issues.append("crushed blacks")
        actions.append("lift the toe to recover shadow detail")
    elif luma < 0.22 and stats["black_point"] > 0.05:
        # Dense low-key scene: nothing is clipped, but the whole range sits in
        # the shadows, so open the toe a touch to keep separation.
        grade["shadow_lift"] = max(grade["shadow_lift"], 0.012)
        issues.append("dense shadows")
        actions.append("open the toe so the low key keeps detail")
    if stats["highlight_clip"] > 0.03:
        grade["highlight_rolloff"] = _clamp(stats["highlight_clip"] * 6.0, 0.0, 0.7)
        grade["exposure"] -= min(0.2, stats["highlight_clip"] * 1.2)
        issues.append("blown highlights")
        actions.append("roll off highlights and pull exposure back")

    # Contrast.
    if stats["luma_std"] < 0.1:
        grade["contrast"] += _clamp((0.1 - stats["luma_std"]) * 1.4, 0.0, 0.22)
        issues.append("flat contrast")
        actions.append("build an S-curve for separation")
    elif stats["luma_std"] > 0.38:
        grade["contrast"] -= _clamp((stats["luma_std"] - 0.38) * 0.5, 0.0, 0.1)
        issues.append("crushing contrast")
        actions.append("soften the curve to protect detail")

    # Noise.
    noise = stats["noise_sigma"]
    bias = float(preset["denoise_bias"])
    if noise > 0.012:
        strength = _clamp((noise - 0.012) * 150.0, 0.0, 9.0) * bias
        grade["denoise_luma"] = _clamp(strength, 0.0, 10.0)
        grade["denoise_chroma"] = _clamp(strength * 1.8, 0.0, 14.0)
        grade["denoise_temporal"] = _clamp(strength * 0.35, 0.0, 4.0)
        issues.append("visible noise")
        actions.append("denoise chroma harder than luma to keep skin texture")

    # White balance. Grey world is unreliable in very dark or very flat shots.
    if stats["cast"] > 0.07 and luma > 0.12 and stats["luma_std"] > 0.08:
        gain = [stats["wb_gain_r"], stats["wb_gain_g"], stats["wb_gain_b"]]
        # Keep the correction conservative and luminance neutral.
        neutralised = [g / max(gain) for g in gain]
        grade["wb"] = [_clamp(1.0 + (g - 1.0) * 0.6, 0.88, 1.12) for g in neutralised]
        issues.append("white balance cast")
        actions.append("neutralise the colour cast per channel")

    # Saturation.
    if stats["saturation"] > 0.55:
        grade["saturation"] = _clamp(grade["saturation"] * 0.94, 0.5, 1.4)
        issues.append("over-saturated")
        actions.append("pull saturation back to protect skin")
    elif stats["saturation"] < 0.08:
        grade["saturation"] = _clamp(grade["saturation"] * 1.08, 0.5, 1.4)
        issues.append("flat colour")
        actions.append("add gentle vibrance")

    # Detail and on-screen graphics.
    sharpen_bias = float(preset["sharpen_bias"])
    baseline = float(context.get("graphic_baseline", 0.0))
    graphic = stats.get("graphic_score", 0.0)
    is_graphic = graphic > max(0.02, baseline * 2.0) and stats.get("binary_area", 0.0) > 0.03
    if is_graphic:
        grade["normalize"] = True
        grade["sharpen"] = _clamp(0.35 * sharpen_bias, 0.0, 1.2)
        issues.append("flat UI / text")
        actions.append("local contrast plus restrained sharpening for legibility")
    elif stats["sharpness"] < 0.28:
        grade["sharpen"] = _clamp((0.28 - stats["sharpness"]) * 1.5, 0.0, 0.9) * sharpen_bias
        issues.append("soft focus")
        actions.append("add unsharp detail recovery")

    # Grain interacts badly with existing noise.
    if noise > 0.02:
        grade["grain"] = grade["grain"] * 0.45
    grade["grain"] = int(round(_clamp(grade["grain"], 0, 40)))

    return {"grade": grade, "issues": issues, "actions": actions}


def merge_ai_plan(
    base: Dict[str, Any], ai_grade: Dict[str, Any], limits: Optional[Dict[str, float]] = None
) -> Dict[str, Any]:
    """Merge an AI proposal into the deterministic grade, within safe limits."""
    limits = limits or {
        "exposure": 0.45,
        "contrast": 0.18,
        "saturation": 0.2,
        "shadow_lift": 0.03,
        "highlight_rolloff": 0.45,
        "denoise_luma": 4.0,
        "denoise_chroma": 6.0,
        "sharpen": 0.5,
        "grain": 12.0,
    }
    merged = dict(base)
    for key, limit in limits.items():
        if key not in ai_grade or not isinstance(ai_grade[key], (int, float)):
            continue
        value = float(ai_grade[key])
        merged[key] = _clamp(value, float(base.get(key, 0.0)) - limit, float(base.get(key, 0.0)) + limit)
    if isinstance(ai_grade.get("wb"), (list, tuple)) and len(ai_grade["wb"]) == 3:
        merged["wb"] = [
            _clamp(float(value), 0.88, 1.12) for value in ai_grade["wb"] if isinstance(value, (int, float))
        ] or merged["wb"]
        if len(merged["wb"]) != 3:
            merged["wb"] = list(base["wb"])
    if isinstance(ai_grade.get("normalize"), bool):
        merged["normalize"] = ai_grade["normalize"]
    return merged


# --------------------------------------------------------------------------
# Transfer function, FFmpeg graph and LUT baking
# --------------------------------------------------------------------------

def channel_curve(grade: Dict[str, Any], channel: int, points: int = CURVE_POINTS) -> List[Tuple[float, float]]:
    """Sample the per-channel transfer function used by FFmpeg and the LUT."""
    gain = float(grade["wb"][channel])
    exposure = 2.0 ** float(grade["exposure"])
    contrast = float(grade["contrast"])
    lift = float(grade["shadow_lift"])
    rolloff = float(grade["highlight_rolloff"])
    tint_shadow = float(grade["shadow_tint"][channel])
    tint_highlight = float(grade["highlight_tint"][channel])

    samples: List[Tuple[float, float]] = []
    for value in np.linspace(0.0, 1.0, points):
        x = float(value)
        y = x * gain * exposure
        y = PIVOT + (y - PIVOT) * contrast
        shadow_weight = max(0.0, 1.0 - x / PIVOT) ** 2
        highlight_weight = max(0.0, (x - HIGHLIGHT_KNEE) / (1.0 - HIGHLIGHT_KNEE)) ** 2
        y += (lift + tint_shadow) * shadow_weight
        y -= tint_highlight * highlight_weight
        if rolloff > 0 and y > HIGHLIGHT_KNEE:
            t = _clamp((y - HIGHLIGHT_KNEE) / (1.0 - HIGHLIGHT_KNEE + 1e-6), 0.0, 1.0)
            y = HIGHLIGHT_KNEE + (1.0 - HIGHLIGHT_KNEE) * (1.0 - (1.0 - t) ** (1.0 + rolloff * 2.2))
        samples.append((x, _clamp(y, 0.0, 1.0)))
    return samples


def saturation_matrix(saturation: float) -> Dict[str, float]:
    """Rec.709 saturation matrix expressed as a colorchannelmixer matrix.

    The transform is ``out = luma + s * (in - luma)`` expanded per channel.
    Every row sums to 1.0, so a neutral grey keeps its value at any
    saturation, and ``s = 0`` collapses to the plain luma matrix.
    """
    s = float(saturation)
    return {
        "rr": s + (1 - s) * LR,
        "rg": (1 - s) * LG,
        "rb": (1 - s) * LB,
        "gr": (1 - s) * LR,
        "gg": s + (1 - s) * LG,
        "gb": (1 - s) * LB,
        "br": (1 - s) * LR,
        "bg": (1 - s) * LG,
        "bb": s + (1 - s) * LB,
    }


def _curve_argument(samples: Sequence[Tuple[float, float]]) -> str:
    return " ".join(f"{x:.4f}/{y:.4f}" for x, y in samples)


def scene_filter_chain(grade: Dict[str, Any], enable: Optional[str] = None) -> str:
    """Build the FFmpeg filter chain that realises one scene's grade.

    When ``enable`` is given (a ``between(t,...)`` expression) every filter in
    the chain is gated with it, so the grade only applies inside that window.
    """
    chain: List[str] = []

    def add(filter_string: str) -> None:
        if enable:
            chain.append(f"{filter_string}:enable='{enable}'")
        else:
            chain.append(filter_string)

    if grade["denoise_luma"] > 0.05 or grade["denoise_chroma"] > 0.05:
        add(
            "hqdn3d=luma_spatial={:.2f}:chroma_spatial={:.2f}:luma_tmp={:.2f}:chroma_tmp={:.2f}".format(
                grade["denoise_luma"],
                grade["denoise_chroma"],
                grade["denoise_temporal"],
                grade["denoise_temporal"] * 0.8,
            )
        )

    curves = ":".join(
        f"{name}='{_curve_argument(channel_curve(grade, channel))}'"
        for name, channel in (("r", 0), ("g", 1), ("b", 2))
    )
    add(f"curves={curves}:interp=pchip")

    matrix = saturation_matrix(grade["saturation"])
    add("colorchannelmixer=" + ":".join(f"{k}={v:.5f}" for k, v in matrix.items()))

    if grade.get("normalize"):
        add("normalize=blackpt=black:whitept=white:smoothing=0:strength=0.65")
    if grade["sharpen"] > 0.02:
        add(
            "unsharp=lx=5:ly=5:la={:.2f}:cx=3:cy=3:ca={:.2f}".format(
                grade["sharpen"], grade["sharpen"] * 0.4
            )
        )
    if grade["grain"] > 0:
        # "a" keeps the grain spatially correlated (film-like) and "t" makes it
        # move frame to frame. Pure uniform noise is incompressible and triples
        # the output bitrate, so it is deliberately avoided.
        add(f"noise=alls={int(grade['grain'])}:allf=a+t:all_seed={int(grade['grain'] * 7) + 11}")

    return ",".join(chain)


def build_scene_filtergraph(scenes: Sequence[Dict[str, Any]]) -> str:
    """Compile per-scene grades into a single ``-filter_complex`` graph.

    Every scene is trimmed to its own window, graded with its own recipe and
    the results are concatenated, so each shot keeps its own correction.
    """
    if not scenes:
        raise ColoristError("No scenes to grade.")

    count = len(scenes)
    branches = ";\n".join(
        f"[s{index}]trim=start={scene['start']:.3f}:end={scene['end']:.3f},setpts=PTS-STARTPTS,"
        f"format=gbrp,{scene_filter_chain(scene['grade'])},format=yuv420p[v{index}]"
        for index, scene in enumerate(scenes)
    )
    concat_inputs = "".join(f"[v{index}]" for index in range(count))
    return (
        f"[0:v]split={count}" + "".join(f"[s{index}]" for index in range(count)) + ";\n"
        + branches
        + ";\n"
        + f"{concat_inputs}concat=n={count}:v=1:a=0[vout]"
    )


def build_timeline_filtergraph(scenes: Sequence[Dict[str, Any]]) -> str:
    """Compile the grades as timeline-gated passes (``between(t,...)``).

    This keeps the original timeline untouched: one chain, where each scene's
    correction is switched on only inside that scene's time window. It is the
    variant to use when the source must keep its exact timing.
    """
    if not scenes:
        raise ColoristError("No scenes to grade.")

    stages: List[str] = []
    for scene in scenes:
        enable = f"between(t,{scene['start']:.3f},{scene['end']:.3f})"
        stages.append(scene_filter_chain(scene["grade"], enable=enable))

    return "[0:v]format=gbrp," + ",".join(stages) + ",format=yuv420p[vout]"


def ffmpeg_command(
    source: Path | str,
    target: Path | str,
    filtergraph: str,
    use_script: bool = True,
    has_audio: bool = True,
    encode_preset: str = "fast",
    crf: int = 18,
) -> List[str]:
    """Build the FFmpeg argv that renders the grade."""
    exe = ffmpeg_binary()
    command = [exe, "-hide_banner", "-y", "-i", str(source)]
    if use_script:
        script = Path(tempfile.gettempdir()) / f"cinevoice_colorist_{os.getpid()}.ffgraph"
        script.write_text(filtergraph, encoding="utf-8")
        command += ["-filter_complex_script", str(script)]
    else:
        command += ["-filter_complex", filtergraph]
    command += ["-map", "[vout]"]
    if has_audio:
        command += ["-map", "0:a?", "-c:a", "copy"]
    else:
        command += ["-an"]
    command += [
        "-c:v", "libx264",
        "-preset", encode_preset,
        "-crf", str(crf),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-map_metadata", "0",
        str(target),
    ]
    return command


def render_filtergraph(
    source: Path | str,
    target: Path | str,
    filtergraph: str,
    has_audio: bool = True,
    encode_preset: str = "fast",
    crf: int = 18,
) -> None:
    """Render the graded video with FFmpeg."""
    command = ffmpeg_command(
        source,
        target,
        filtergraph,
        use_script=True,
        has_audio=has_audio,
        encode_preset=encode_preset,
        crf=crf,
    )
    proc = _run(command, timeout=7200)
    if proc.returncode != 0 or not Path(target).exists():
        detail = proc.stderr.decode("utf-8", "replace")[-1200:]
        raise ColoristError(f"FFmpeg failed to render the grade:\n{detail}")


# --------------------------------------------------------------------------
# LUT baking
# --------------------------------------------------------------------------

def _apply_curve_samples(samples: Sequence[Tuple[float, float]], values: np.ndarray) -> np.ndarray:
    xs = np.array([p[0] for p in samples], dtype=np.float64)
    ys = np.array([p[1] for p in samples], dtype=np.float64)
    return np.interp(values, xs, ys)


def bake_cube_lut(grade: Dict[str, Any], size: int = LUT_SIZE) -> str:
    """Bake a grade into a DaVinci Resolve compatible 3D ``.cube`` LUT."""
    levels = np.linspace(0.0, 1.0, size)
    blue, green, red = np.meshgrid(levels, levels, levels, indexing="ij")

    curves = [channel_curve(grade, channel, points=256) for channel in range(3)]
    r = _apply_curve_samples(curves[0], red)
    g = _apply_curve_samples(curves[1], green)
    b = _apply_curve_samples(curves[2], blue)

    matrix = saturation_matrix(grade["saturation"])
    out_r = matrix["rr"] * r + matrix["rg"] * g + matrix["rb"] * b
    out_g = matrix["gr"] * r + matrix["gg"] * g + matrix["gb"] * b
    out_b = matrix["br"] * r + matrix["bg"] * g + matrix["bb"] * b
    # A .cube LUT cannot carry negative values, so the matrix result is clamped.
    out_r = np.clip(out_r, 0.0, 1.0)
    out_g = np.clip(out_g, 0.0, 1.0)
    out_b = np.clip(out_b, 0.0, 1.0)

    lines = [
        'TITLE "CineVoice Colorist"',
        f"LUT_3D_SIZE {size}",
        "DOMAIN_MIN 0.0 0.0 0.0",
        "DOMAIN_MAX 1.0 1.0 1.0",
        "",
    ]
    for index in range(size * size * size):
        blue_index = index // (size * size)
        green_index = (index // size) % size
        red_index = index % size
        lines.append(
            "{:.6f} {:.6f} {:.6f}".format(
                float(out_r[blue_index, green_index, red_index]),
                float(out_g[blue_index, green_index, red_index]),
                float(out_b[blue_index, green_index, red_index]),
            )
        )
    return "\n".join(lines) + "\n"


def bake_1d_cube_lut(grade: Dict[str, Any], size: int = 1024) -> str:
    """Bake the tone curve of a grade into a 1D ``.cube`` LUT."""
    curves = [channel_curve(grade, channel, points=256) for channel in range(3)]
    levels = np.linspace(0.0, 1.0, size)
    lines = [
        'TITLE "CineVoice Colorist Tone"',
        f"LUT_1D_SIZE {size}",
        "LUT_1D_INPUT_RANGE 0.0 1.0",
        "",
    ]
    for index, value in enumerate(levels):
        r = float(_apply_curve_samples(curves[0], np.array([value]))[0])
        g = float(_apply_curve_samples(curves[1], np.array([value]))[0])
        b = float(_apply_curve_samples(curves[2], np.array([value]))[0])
        lines.append(f"{r:.6f} {g:.6f} {b:.6f}")
    return "\n".join(lines) + "\n"


def global_grade(scenes: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Average the per-scene grades into one grade for a global LUT."""
    if not scenes:
        return _blank_grade(PRESETS["cinematic"])
    keys = ("exposure", "contrast", "saturation", "shadow_lift", "highlight_rolloff", "grain")
    averaged = _blank_grade(PRESETS["cinematic"])
    for key in keys:
        averaged[key] = float(np.median([scene["grade"][key] for scene in scenes]))
    averaged["wb"] = [
        float(np.median([scene["grade"]["wb"][index] for scene in scenes])) for index in range(3)
    ]
    averaged["shadow_tint"] = list(PRESETS["cinematic"]["shadow_tint"])
    averaged["highlight_tint"] = list(PRESETS["cinematic"]["highlight_tint"])
    averaged["denoise_luma"] = float(np.median([scene["grade"]["denoise_luma"] for scene in scenes]))
    averaged["denoise_chroma"] = float(np.median([scene["grade"]["denoise_chroma"] for scene in scenes]))
    averaged["denoise_temporal"] = float(np.median([scene["grade"]["denoise_temporal"] for scene in scenes]))
    averaged["sharpen"] = float(np.median([scene["grade"]["sharpen"] for scene in scenes]))
    averaged["normalize"] = any(scene["grade"]["normalize"] for scene in scenes)
    return averaged


def resolve_recipe(preset_name: str, grade: Dict[str, Any]) -> str:
    """Human readable DaVinci Resolve node setup for the exported LUT."""
    preset = PRESETS.get(preset_name, PRESETS["cinematic"])
    return "\n".join(
        [
            "DaVinci Resolve node setup (CineVoice AI Colorist)",
            "=" * 52,
            "",
            "1. Add a serial node after the input timeline.",
            f"2. Node 1 - \"CineVoice {preset['label']}\" - load cinevoice_{preset_name}.cube",
            "   (the 1D variant cinevoice_{}_tone.cube covers tone only)".format(preset_name),
            "3. Node 2 - \"Grain\" - Resolve film grain, size 1.2, strength 0.08.",
            "4. Node 3 - \"Balance\" - trim lift/gamma/gain per shot if needed.",
            "",
            f"Base exposure   : {grade['exposure']:+.2f} stops",
            f"Contrast        : {grade['contrast']:.3f}",
            f"Saturation      : {grade['saturation']:.3f}",
            f"Shadow lift     : {grade['shadow_lift']:.4f}",
            f"Highlight roll  : {grade['highlight_rolloff']:.3f}",
            f"White balance   : R {grade['wb'][0]:.3f}  G {grade['wb'][1]:.3f}  B {grade['wb'][2]:.3f}",
            f"Grain           : {int(grade['grain'])}",
        ]
    )


# --------------------------------------------------------------------------
# Standalone script export
# --------------------------------------------------------------------------

SCRIPT_TEMPLATE = '''#!/usr/bin/env python3
"""CineVoice AI Colorist - standalone grading script.

Generated by video_colorist.py for the "{preset}" preset.

Usage:
    python colorist_grade.py input.mp4 output.mp4
    python colorist_grade.py input.mp4 output.mp4 --opencv

The script rebuilds the exact FFmpeg filtergraph that CineVoice used, then
renders the graded master. With --opencv it additionally runs a frame
accurate OpenCV pass for grain and local contrast when OpenCV is available.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

PLAN = json.loads(r"""
{payload}
""")

PRESET_NAME = PLAN["preset"]


def ffmpeg_binary() -> str:
    for name in ("CINEVOICE_FFMPEG", "FFMPEG_BINARY", "IMAGEIO_FFMPEG_EXE"):
        candidate = os.environ.get(name)
        if candidate and os.path.isfile(candidate):
            return candidate
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        sys.exit("FFmpeg not found. Install imageio-ffmpeg or set FFMPEG_BINARY.")


def scene_chain(scene):
    return scene["chain"]


def build_filtergraph():
    scenes = PLAN["scenes"]
    count = len(scenes)
    branches = ";\\n".join(
        "[s{{i}}]trim=start={{s:.3f}}:end={{e:.3f}},setpts=PTS-STARTPTS,{{chain}}[v{{i}}]".format(
            i=index, s=scene["start"], e=scene["end"], chain=scene_chain(scene)
        )
        for index, scene in enumerate(scenes)
    )
    concat = "".join("[v{{i}}]".format(i=index) for index in range(count))
    return (
        "[0:v]split={{n}}".format(n=count)
        + "".join("[s{{i}}]".format(i=index) for index in range(count))
        + ";\\n" + branches + ";\\n" + concat + "concat=n={{n}}:v=1:a=0[vout]".format(n=count)
    )


def render(source, target):
    graph = build_filtergraph()
    handle = tempfile.NamedTemporaryFile("w", suffix=".ffgraph", delete=False, encoding="utf-8")
    handle.write(graph)
    handle.close()
    command = [
        ffmpeg_binary(), "-hide_banner", "-y", "-i", source,
        "-filter_complex_script", handle.name,
        "-map", "[vout]",
    ]
    if PLAN.get("has_audio"):
        command += ["-map", "0:a?", "-c:a", "copy"]
    else:
        command += ["-an"]
    command += [
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "0", target,
    ]
    print(" ".join(command))
    subprocess.run(command, check=True)
    os.unlink(handle.name)


def opencv_pass(source, target):
    """Optional frame accurate pass. Requires OpenCV with numpy support."""
    try:
        import cv2
        import numpy as np
    except Exception as exc:
        print("OpenCV pass skipped:", exc)
        return False
    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        print("OpenCV pass skipped: cannot open", source)
        return False
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    writer = cv2.VideoWriter(target, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    grain = PLAN.get("grain", 0)
    rng = np.random.default_rng(PLAN.get("seed", 7))
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if grain > 0:
            noise = rng.normal(0, grain * 0.35, frame.shape[:2]).astype(np.float32)
            frame = np.clip(frame.astype(np.float32) + noise[:, :, None], 0, 255).astype(np.uint8)
        writer.write(frame)
    capture.release()
    writer.release()
    return True


def main():
    parser = argparse.ArgumentParser(description="CineVoice AI Colorist grading script")
    parser.add_argument("source")
    parser.add_argument("target")
    parser.add_argument("--opencv", action="store_true", help="run the OpenCV frame pass")
    args = parser.parse_args()
    render(args.source, args.target)
    if args.opencv:
        intermediate = args.target + ".ffmpeg.mp4"
        os.replace(args.target, intermediate)
        if opencv_pass(intermediate, args.target):
            os.unlink(intermediate)
        else:
            os.replace(intermediate, args.target)


if __name__ == "__main__":
    main()
'''


def build_python_script(scenes: Sequence[Dict[str, Any]], preset_name: str, has_audio: bool) -> str:
    """Generate a standalone, runnable grading script for the current plan."""
    payload = {
        "preset": preset_name,
        "has_audio": bool(has_audio),
        "grain": int(global_grade(scenes)["grain"]),
        "seed": 7,
        "scenes": [
            {
                "index": scene["index"],
                "start": scene["start"],
                "end": scene["end"],
                "chain": "format=gbrp,"
                + scene_filter_chain(scene["grade"])
                + ",format=yuv420p",
            }
            for scene in scenes
        ],
    }
    return SCRIPT_TEMPLATE.format(preset=preset_name, payload=json.dumps(payload, indent=2))


# --------------------------------------------------------------------------
# High level analysis
# --------------------------------------------------------------------------

def analyze_video(
    path: Path | str,
    preset_name: str = "cinematic",
    max_scenes: int = MAX_SCENES,
    scene_threshold: float = 12.0,
    include_keyframes: bool = True,
) -> Dict[str, Any]:
    """Full pass: detect scenes, measure them and plan a grade for each one."""
    source = Path(path)
    if not source.is_file():
        raise ColoristError(f"Video not found: {source}")

    info = probe_video(source)
    duration = info["duration"]
    if duration <= 0:
        raise ColoristError("Could not read the duration of the source video.")

    scenes = detect_scenes(source, threshold=scene_threshold, duration=duration, max_scenes=max_scenes)
    measurements = measure_video(source, scenes)

    # Video-wide baseline so "UI / text" detection is relative to the film.
    context = {
        "graphic_baseline": float(np.median([m["graphic_score"] for m in measurements]))
        if measurements
        else 0.0
    }

    planned: List[Dict[str, Any]] = []
    for scene, stats in zip(scenes, measurements):
        result = plan_scene(stats, preset_name, context=context)
        planned.append(
            {
                "index": scene["index"],
                "start": scene["start"],
                "end": scene["end"],
                "duration": scene["duration"],
                "stats": stats,
                "grade": result["grade"],
                "issues": result["issues"],
                "actions": result["actions"],
            }
        )

    report: Dict[str, Any] = {
        "source": source.name,
        "preset": preset_name,
        "preset_label": PRESETS.get(preset_name, PRESETS["cinematic"])["label"],
        "video": info,
        "scenes": planned,
        "offline": True,
    }

    if include_keyframes:
        for scene in planned:
            midpoint = (scene["start"] + scene["end"]) / 2.0
            scene["keyframe"] = keyframe_jpeg(source, midpoint)

    report["filtergraph"] = build_scene_filtergraph(planned)
    report["timeline_filtergraph"] = build_timeline_filtergraph(planned)
    report["python_script"] = build_python_script(planned, preset_name, info["has_audio"])
    report["lut"] = bake_cube_lut(global_grade(planned))
    report["lut_tone"] = bake_1d_cube_lut(global_grade(planned))
    report["resolve_recipe"] = resolve_recipe(preset_name, global_grade(planned))
    report["context"] = context
    report["summary"] = _summarize(planned)
    return report


def _summarize(scenes: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    counts: Dict[str, int] = {}
    for scene in scenes:
        for issue in scene["issues"]:
            counts[issue] = counts.get(issue, 0) + 1
    return {
        "scene_count": len(scenes),
        "issues": counts,
        "average_exposure": float(np.mean([scene["grade"]["exposure"] for scene in scenes])),
        "average_noise": float(np.mean([scene["stats"]["noise_sigma"] for scene in scenes])),
    }


def grade_video(
    source: Path | str,
    target: Path | str,
    report: Dict[str, Any],
    use_timeline_graph: bool = True,
    encode_preset: str = "fast",
    crf: int = 18,
) -> Path:
    """Render the planned grade for a whole video.

    The timeline graph is the default because it decodes the source once and
    switches each scene's correction on with ``between(t,...)``. The
    trim/concat graph isolates every scene completely but decodes the source
    once per scene, so it is only worth it for short clips.
    """
    scenes = report["scenes"]
    graph = report["timeline_filtergraph"] if use_timeline_graph else report["filtergraph"]
    render_filtergraph(
        source,
        target,
        graph,
        has_audio=report["video"]["has_audio"],
        encode_preset=encode_preset,
        crf=crf,
    )
    return Path(target)


def build_payload(report: Dict[str, Any]) -> Dict[str, Any]:
    """Compact payload for the vision model (stats plus one keyframe per scene)."""
    return {
        "preset": report["preset"],
        "video": report["video"],
        "scenes": [
            {
                "index": scene["index"],
                "start": scene["start"],
                "end": scene["end"],
                "stats": {key: round(float(value), 5) for key, value in scene["stats"].items()},
                "planned_grade": scene["grade"],
                "planned_issues": scene["issues"],
                "keyframe": scene.get("keyframe", ""),
            }
            for scene in report["scenes"]
        ],
    }


def _cli() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="CineVoice AI Colorist engine")
    sub = parser.add_subparsers(dest="command", required=True)

    analyze = sub.add_parser("analyze", help="detect scenes, measure and plan a grade")
    analyze.add_argument("source")
    analyze.add_argument("--preset", default="cinematic", choices=sorted(PRESETS))
    analyze.add_argument("--json", dest="json_out", help="write the report as JSON")
    analyze.add_argument("--lut", dest="lut_out", help="write the 3D .cube LUT")
    analyze.add_argument("--script", dest="script_out", help="write the standalone python script")
    analyze.add_argument("--graph", dest="graph_out", help="write the FFmpeg filtergraph")

    grade = sub.add_parser("grade", help="render the planned grade")
    grade.add_argument("source")
    grade.add_argument("-o", "--target", required=True)
    grade.add_argument("--preset", default="cinematic", choices=sorted(PRESETS))
    grade.add_argument("--timeline", action="store_true", help="use the between(t,...) variant")

    args = parser.parse_args()

    if args.command == "analyze":
        report = analyze_video(args.source, preset_name=args.preset)
        if args.json_out:
            Path(args.json_out).write_text(json.dumps(report, indent=2), encoding="utf-8")
        if args.lut_out:
            Path(args.lut_out).write_text(report["lut"], encoding="utf-8")
        if args.script_out:
            Path(args.script_out).write_text(report["python_script"], encoding="utf-8")
        if args.graph_out:
            Path(args.graph_out).write_text(report["filtergraph"], encoding="utf-8")
        print(json.dumps(report["summary"], indent=2))
        return 0

    report = analyze_video(args.source, preset_name=args.preset)
    grade_video(args.source, args.target, report, use_timeline_graph=args.timeline)
    print(f"Graded master written to {args.target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
