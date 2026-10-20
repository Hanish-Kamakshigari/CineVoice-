#!/usr/bin/env python3
"""Comprehensive test suite for the rebuilt CineVoice video enhancement system."""

import os
import sys
import tempfile
import subprocess
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from video_enhancer import (
    apply_color_correction,
    apply_cinematic_preset,
    apply_scene_enhancement,
    build_filtergraph,
    process_video_enhancement,
    PRESET_FILTERS,
    _ffmpeg_exe,
)
import numpy as np


def test_frame_level_processing():
    """Test frame-level transformation fallbacks."""
    print("Testing frame-level fallback utilities...")
    test_frame = np.random.randint(0, 255, (120, 160, 3), dtype=np.uint8)

    corrected = apply_color_correction(test_frame, brightness=1.1, contrast=1.1, saturation=1.1)
    assert corrected.shape == test_frame.shape, "Color correction altered frame dimensions"

    for preset in ["modern", "vintage", "television", "dramatic"]:
        preset_frame = apply_cinematic_preset(test_frame, preset)
        assert preset_frame.shape == test_frame.shape, f"Preset {preset} altered frame dimensions"

    for scene in ["dramatic", "bright", "dynamic", "neutral"]:
        scene_frame = apply_scene_enhancement(test_frame, scene)
        assert scene_frame.shape == test_frame.shape, f"Scene {scene} altered frame dimensions"

    print("  [PASS] Frame-level processing passed.")


def test_filtergraph_builder():
    """Test FFmpeg filter string generation."""
    print("Testing filtergraph construction...")
    for preset_name in PRESET_FILTERS.keys():
        vf = build_filtergraph(preset_type=preset_name)
        assert "eq=" in vf, f"Missing equalizer filter in preset {preset_name}"
        assert isinstance(vf, str) and len(vf) > 0

    custom_vf = build_filtergraph("modern_cinematic", presets={"contrast": 1.35, "saturation": 1.4, "brightness": 1.1})
    assert "contrast=1.350" in custom_vf
    assert "saturation=1.400" in custom_vf
    assert "brightness=0.100" in custom_vf  # Multiplier 1.1 converted to offset 0.1

    print("  [PASS] Filtergraph generation passed.")


def test_end_to_end_video_enhancement():
    """Test end-to-end video enhancement with audio preservation using FFmpeg."""
    print("Testing end-to-end video enhancement with FFmpeg...")
    ffmpeg = _ffmpeg_exe()
    assert os.path.isfile(ffmpeg), f"FFmpeg binary not found at {ffmpeg}"

    with tempfile.TemporaryDirectory() as tmp_dir:
        input_mp4 = Path(tmp_dir) / "sample_input.mp4"
        enhanced_mp4 = Path(tmp_dir) / "sample_enhanced.mp4"

        # Generate a 1.5-second test MP4 containing video + sine audio
        create_cmd = [
            ffmpeg,
            "-y",
            "-f", "lavfi", "-i", "testsrc=duration=1.5:size=320x240:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=880:duration=1.5",
            "-c:v", "libx264",
            "-c:a", "aac",
            "-pix_fmt", "yuv420p",
            str(input_mp4),
        ]
        subprocess.run(create_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert input_mp4.is_file() and input_mp4.stat().st_size > 0

        # Enhance with modern_cinematic
        res_path = process_video_enhancement(
            video_path=str(input_mp4),
            output_path=str(enhanced_mp4),
            preset_type="modern_cinematic",
        )
        assert Path(res_path).is_file(), "Enhanced output file was not created"
        assert Path(res_path).stat().st_size > 0, "Enhanced output file is empty"

        # Verify that output contains both video and audio streams
        probe_cmd = [ffmpeg, "-i", str(enhanced_mp4)]
        proc = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        probe_out = proc.stderr
        assert "Video: h264" in probe_out, "Output video is not encoded in H.264"
        assert "Audio: aac" in probe_out, "Audio track was lost during enhancement"

        # Test custom parameters
        custom_out = Path(tmp_dir) / "custom_enhanced.mp4"
        process_video_enhancement(
            video_path=str(input_mp4),
            output_path=str(custom_out),
            presets={"brightness": 1.15, "contrast": 1.25, "saturation": 1.3},
        )
        assert custom_out.is_file() and custom_out.stat().st_size > 0

    print("  [PASS] End-to-end video enhancement with audio preservation passed.")


if __name__ == "__main__":
    print("=" * 60)
    print("Running CineVoice Video Enhancement Test Suite")
    print("=" * 60)
    try:
        test_frame_level_processing()
        test_filtergraph_builder()
        test_end_to_end_video_enhancement()
        print("\nSUCCESS: All video enhancement tests passed successfully!")
    except Exception as e:
        print(f"\nFAIL: Test encountered an error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
