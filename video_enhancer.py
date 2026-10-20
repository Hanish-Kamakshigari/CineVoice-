"""Video Enhancement Module for CineVoice.

Provides fast, high-quality cinematic video enhancement using FFmpeg filtergraphs.
Includes color correction, contrast enhancement, sharpening, and style presets
with audio preservation and fast-start streaming for web playback.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageEnhance

PRESET_FILTERS = {
    "modern_cinematic": {
        "contrast": 1.12,
        "saturation": 1.18,
        "brightness": 0.02,
        "colorbalance": "bh=0.03:gh=0.02:rh=-0.02:bm=-0.03:rm=0.04:gm=0.01",
        "unsharp": "5:5:0.6:5:5:0.0",
    },
    "vintage_film": {
        "contrast": 1.06,
        "saturation": 0.78,
        "brightness": 0.03,
        "colorbalance": "rm=0.08:gm=0.03:bm=-0.07:rh=0.06:gh=0.02:bh=-0.05",
        "unsharp": None,
    },
    "dramatic": {
        "contrast": 1.28,
        "saturation": 1.22,
        "brightness": -0.04,
        "colorbalance": "rs=-0.03:gs=-0.01:bs=0.03:rm=-0.02:bm=0.03",
        "unsharp": "5:5:0.8:5:5:0.0",
    },
    "television_style": {
        "contrast": 1.06,
        "saturation": 1.05,
        "brightness": 0.04,
        "colorbalance": None,
        "unsharp": "5:5:0.4:5:5:0.0",
    },
    "neutral": {
        "contrast": 1.0,
        "saturation": 1.0,
        "brightness": 0.0,
        "colorbalance": None,
        "unsharp": None,
    },
}


def _ffmpeg_exe() -> str:
    """Retrieve bundled FFmpeg binary path."""
    return imageio_ffmpeg.get_ffmpeg_exe()


def build_filtergraph(preset_type: str = "modern_cinematic", presets: dict | None = None) -> str:
    """Build an FFmpeg video filtergraph string based on preset and custom overrides.

    Args:
        preset_type: Name of preset (modern_cinematic, vintage_film, dramatic, etc.)
        presets: Optional custom overrides for brightness, contrast, saturation.

    Returns:
        Comma-separated FFmpeg -vf filter string.
    """
    config = PRESET_FILTERS.get(preset_type, PRESET_FILTERS["modern_cinematic"]).copy()

    if presets:
        if "contrast" in presets and presets["contrast"] is not None:
            config["contrast"] = float(presets["contrast"])
        if "saturation" in presets and presets["saturation"] is not None:
            config["saturation"] = float(presets["saturation"])
        if "brightness" in presets and presets["brightness"] is not None:
            raw_b = float(presets["brightness"])
            # If user provided a multiplier > 0.5 (e.g. 1.05), convert to FFmpeg offset (0.05)
            config["brightness"] = (raw_b - 1.0) if raw_b >= 0.5 else raw_b

    filters: list[str] = []

    # 1. Equalizer filter (brightness, contrast, saturation)
    c = config.get("contrast", 1.0)
    s = config.get("saturation", 1.0)
    b = config.get("brightness", 0.0)
    filters.append(f"eq=contrast={c:.3f}:saturation={s:.3f}:brightness={b:.3f}")

    # 2. Color balance filter (for cinematic tone mapping / split-toning)
    if config.get("colorbalance"):
        filters.append(f"colorbalance={config['colorbalance']}")

    # 3. Subtle unsharp mask for enhanced clarity and definition
    if config.get("unsharp"):
        filters.append(f"unsharp={config['unsharp']}")

    return ",".join(filters)


def analyze_with_nemotron(video_path: str, timestamp: float = 5.0) -> dict:
    """Use NVIDIA Nemotron 3 Nano Omni to visually inspect the video and calculate bespoke grading parameters."""
    import base64
    import tempfile
    import requests
    import json
    import time
    from dotenv import load_dotenv
    load_dotenv()

    key = os.environ.get("NVIDIA_API_KEY")
    if not key:
        return {}

    ffmpeg = _ffmpeg_exe()
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_frame = tmp.name

    try:
        # Extract single frame at timestamp
        subprocess.run(
            [ffmpeg, "-y", "-ss", str(timestamp), "-i", str(video_path), "-vframes", "1", "-q:v", "2", tmp_frame],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        with open(tmp_frame, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
    except Exception:
        return {}
    finally:
        if os.path.exists(tmp_frame):
            try:
                os.remove(tmp_frame)
            except Exception:
                pass

    headers = {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    prompt = (
        "You are an elite Digital Imaging Technician and Master Film Colorist.\n"
        "Analyze this video frame. Evaluate exposure, shadows, highlights, contrast, and color balance.\n"
        "Determine the exact optimal mathematical parameters to enhance this video to cinematic quality.\n\n"
        "Output strictly valid JSON with these numeric keys:\n"
        "{\n"
        '  "brightness": 0.05,\n'
        '  "contrast": 1.15,\n'
        '  "saturation": 1.15,\n'
        '  "unsharp": "5:5:0.6:5:5:0.0"\n'
        "}"
    )
    payload = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }
        ],
        "model": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "max_tokens": 512,
        "temperature": 0.2,
    }

    for _ in range(3):
        try:
            res = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=30)
            if res.status_code == 200:
                raw = res.json()["choices"][0]["message"]["content"]
                clean_json = raw.strip()
                if "```json" in clean_json:
                    clean_json = clean_json.split("```json", 1)[1].split("```", 1)[0].strip()
                elif "```" in clean_json:
                    clean_json = clean_json.split("```", 1)[1].split("```", 1)[0].strip()
                parsed = json.loads(clean_json)
                return {
                    "brightness": float(parsed.get("brightness", 0.05)),
                    "contrast": float(parsed.get("contrast", 1.15)),
                    "saturation": float(parsed.get("saturation", 1.15)),
                }
            time.sleep(2)
        except Exception:
            time.sleep(1)

    return {}


def process_video_enhancement(
    video_path: str,
    output_path: str | None = None,
    presets: dict | None = None,
    preset_type: str = "modern_cinematic",
    scene_enhancement: bool = True,
    timeout: int = 300,
) -> str:
    """Enhance a video using high-speed FFmpeg filtergraphs.

    Args:
        video_path: Path to the input video.
        output_path: Optional path for the output enhanced video.
        presets: Optional dictionary of brightness, contrast, saturation adjustments.
        preset_type: Preset style ("modern_cinematic", "vintage_film", "dramatic", "nvidia_nemotron_ai", etc.).
        scene_enhancement: Whether scene-appropriate tone curves should be applied.
        timeout: Subprocess execution timeout in seconds.

    Returns:
        Absolute path to the enhanced video.
    """
    in_path = Path(video_path).resolve()
    if not in_path.is_file():
        raise FileNotFoundError(f"Input video not found: {video_path}")

    if output_path is None:
        output_path = str(in_path.parent / f"enhanced_{in_path.stem}.mp4")

    out_path = Path(output_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # If AI Autonomous enhancement via NVIDIA Nemotron is requested, compute custom parameters
    if preset_type in ("nvidia_nemotron_ai", "nemotron_ai"):
        ai_params = analyze_with_nemotron(str(in_path))
        if ai_params:
            presets = {**(presets or {}), **ai_params}
            preset_type = "neutral"
        else:
            preset_type = "modern_cinematic"

    filter_str = build_filtergraph(preset_type=preset_type, presets=presets)
    ffmpeg = _ffmpeg_exe()

    # Base command: libx264, yuv420p for universal browser support, faststart for streaming
    cmd = [
        ffmpeg,
        "-y",
        "-i", str(in_path),
        "-vf", filter_str,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-movflags", "+faststart",
        str(out_path),
    ]

    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        if proc.returncode != 0:
            # If audio copy failed (e.g. incompatible audio codec in container), retry with AAC encoding
            fallback_cmd = [
                ffmpeg,
                "-y",
                "-i", str(in_path),
                "-vf", filter_str,
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-movflags", "+faststart",
                str(out_path),
            ]
            fallback_proc = subprocess.run(fallback_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
            if fallback_proc.returncode != 0:
                err_msg = fallback_proc.stderr.decode("utf-8", errors="replace")
                raise RuntimeError(f"FFmpeg enhancement failed: {err_msg[:400]}")
    except subprocess.TimeoutExpired:
        raise TimeoutError(f"Video enhancement exceeded timeout of {timeout} seconds.")

    return str(out_path)


def batch_enhance_videos(
    video_paths: list[str],
    output_dir: str,
    preset_type: str = "modern_cinematic",
    presets: dict | None = None,
) -> list[str]:
    """Enhance multiple videos in batch.

    Args:
        video_paths: List of input video file paths.
        output_dir: Destination directory.
        preset_type: Preset style to apply.
        presets: Optional custom parameters.

    Returns:
        List of generated output file paths.
    """
    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    results: list[str] = []
    for vp in video_paths:
        path = Path(vp)
        if not path.is_file():
            continue
        dest = out_dir / f"enhanced_{path.name}"
        res = process_video_enhancement(
            video_path=str(path),
            output_path=str(dest),
            presets=presets,
            preset_type=preset_type,
        )
        results.append(res)
    return results


# Frame-level utilities for backward compatibility and test verification
def apply_color_correction(frame: np.ndarray, brightness: float = 1.0, contrast: float = 1.0, saturation: float = 1.0) -> np.ndarray:
    """Pillow-based per-frame color correction fallback."""
    if frame is None:
        return frame
    img = Image.fromarray(frame)
    if brightness != 1.0:
        img = ImageEnhance.Brightness(img).enhance(brightness)
    if contrast != 1.0:
        img = ImageEnhance.Contrast(img).enhance(contrast)
    if saturation != 1.0:
        img = ImageEnhance.Color(img).enhance(saturation)
    return np.array(img)


def apply_cinematic_preset(frame: np.ndarray, preset_type: str = "modern") -> np.ndarray:
    """Frame-level cinematic preset fallback using Pillow."""
    presets = {
        "modern": {"brightness": 1.05, "contrast": 1.12, "saturation": 1.15},
        "vintage": {"brightness": 0.96, "contrast": 1.05, "saturation": 0.75},
        "television": {"brightness": 1.08, "contrast": 1.05, "saturation": 1.02},
        "dramatic": {"brightness": 0.92, "contrast": 1.25, "saturation": 1.20},
    }
    p = presets.get(preset_type, presets["modern"])
    return apply_color_correction(frame, brightness=p["brightness"], contrast=p["contrast"], saturation=p["saturation"])


def apply_scene_enhancement(frame: np.ndarray, scene_type: str = "neutral") -> np.ndarray:
    """Frame-level scene enhancement fallback."""
    if frame is None or scene_type == "neutral":
        return frame
    if scene_type == "dramatic":
        return apply_color_correction(frame, brightness=0.95, contrast=1.2, saturation=1.2)
    elif scene_type == "bright":
        return apply_color_correction(frame, brightness=1.1, contrast=1.05, saturation=0.88)
    elif scene_type == "dynamic":
        return apply_color_correction(frame, brightness=1.04, contrast=1.1, saturation=1.12)
    return frame
