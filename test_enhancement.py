#!/usr/bin/env python3
"""
Simple test for the video enhancement system.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Test imports
try:
    from video_enhancer import (
        apply_color_correction,
        apply_cinematic_preset,
        apply_scene_enhancement,
        process_video_enhancement
    )
    import cv2
    print("SUCCESS: All imports successful")
except Exception as e:
    print(f"FAIL: Import error: {e}")
    sys.exit(1)

# Test color correction
try:
    import numpy as np
    test_frame = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
    
    # Test basic color correction
    corrected = apply_color_correction(test_frame, brightness=1.1, contrast=1.1, saturation=1.1)
    assert corrected.shape == test_frame.shape
    print("SUCCESS: Color correction test passed")
    
    # Test cinematic preset
    cinematic = apply_cinematic_preset(test_frame, "modern")
    assert cinematic.shape == test_frame.shape
    print("SUCCESS: Cinematic preset test passed")
    
    # Test scene enhancement
    scene_enhanced = apply_scene_enhancement(test_frame, "dramatic")
    assert scene_enhanced.shape == test_frame.shape
    print("SUCCESS: Scene enhancement test passed")
    
except Exception as e:
    print(f"FAIL: Enhancement tests failed: {e}")
    sys.exit(1)

print("\nSUCCESS: All video enhancement tests passed!")
print("\nThe video enhancement system is ready for use.")
print("\nUsage:")
print("1. Upload a video to the CineVoice editor")
print("2. Use the enhancement UI to apply presets or custom settings")
print("3. Preview the enhanced video")
print("4. Export the enhanced video with narration")
print("\nAvailable presets:")
print("- modern_cinematic: Vibrant, natural cinematic look")
print("- vintage_film: Classic film aesthetic")
print("- dramatic: High-contrast, impactful visuals")
print("- television_style: Broadcast TV aesthetic")
print("- neutral: Subtle, minimal enhancement")
