#!/usr/bin/env python3
"""
Demo script for CineVoice Video Enhancement feature.

This script demonstrates the video enhancement capabilities for both
AI-generated and original videos.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from video_enhancer import process_video_enhancement, batch_enhance_videos


def demo_single_video_enhancement():
    """Demonstrate enhancing a single video."""
    print("=" * 60)
    print("CineVoice Video Enhancement - Single Video Demo")
    print("=" * 60)
    
    # Check if there's a demo video available
    demo_video_path = os.path.join(
        os.path.dirname(__file__), 
        "THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4"
    )
    
    if not os.path.exists(demo_video_path):
        print("Error: Demo video not found. Please ensure the CineVoice")
        print("demo video 'THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4'")
        print("is present in the project root directory.")
        return
    
    print(f"Input video: {demo_video_path}")
    print()
    
    # Enhance with different presets
    presets = [
        ("modern_cinematic", "Modern Cinematic"),
        ("vintage_film", "Vintage Film"),
        ("dramatic", "Dramatic"),
        ("television_style", "Television Style"),
        ("neutral", "Neutral"),
    ]
    
    for preset_type, preset_name in presets:
        print(f"Enhancing with '{preset_name}' preset...")
        output_path = process_video_enhancement(
            demo_video_path,
            presets=None,  # Use default preset
            preset_type=preset_type,
            scene_enhancement=True
        )
        print(f"  Output: {output_path}")
        print()


def demo_batch_enhancement():
    """Demonstrate batch enhancement of multiple videos."""
    print("=" * 60)
    print("CineVoice Video Enhancement - Batch Enhancement Demo")
    print("=" * 60)
    
    # Create temporary test videos if they don't exist
    test_videos = [
        os.path.join(os.path.dirname(__file__), "THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4")
    ]
    
    # Filter out non-existent videos
    existing_videos = [v for v in test_videos if os.path.exists(v)]
    
    if not existing_videos:
        print("No test videos found for batch enhancement demo.")
        print("Please ensure the demo video is present.")
        return
    
    print(f"Input videos: {len(existing_videos)} found")
    for video in existing_videos:
        print(f"  - {os.path.basename(video)}")
    print()
    
    # Create output directory
    output_dir = os.path.join(os.path.dirname(__file__), "enhanced_output")
    
    # Process videos with different presets
    for preset_type in ["modern_cinematic", "dramatic", "vintage_film"]:
        print(f"Batch enhancing with '{preset_type}' preset...")
        enhanced_paths = batch_enhance_videos(
            existing_videos,
            output_dir,
            preset_type=preset_type
        )
        print(f"  Enhanced {len(enhanced_paths)} videos")
        for path in enhanced_paths:
            print(f"    - {os.path.basename(path)}")
        print()


def demo_custom_presets():
    """Demonstrate custom enhancement presets."""
    print("=" * 60)
    print("CineVoice Video Enhancement - Custom Presets Demo")
    print("=" * 60)
    
    demo_video_path = os.path.join(
        os.path.dirname(__file__), 
        "THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4"
    )
    
    if not os.path.exists(demo_video_path):
        print("Error: Demo video not found.")
        return
    
    # Define custom presets
    custom_presets = [
        {
            "name": "Ultra Bright",
            "presets": {"brightness": 1.3, "contrast": 0.9, "saturation": 1.1}
        },
        {
            "name": "Cinematic Dark",
            "presets": {"brightness": 0.8, "contrast": 1.2, "saturation": 0.9}
        },
        {
            "name": "Vibrant Colors",
            "presets": {"brightness": 1.1, "contrast": 1.15, "saturation": 1.3}
        },
    ]
    
    for preset_config in custom_presets:
        print(f"Applying '{preset_config['name']}' custom preset...")
        output_path = process_video_enhancement(
            demo_video_path,
            presets=preset_config["presets"],
            preset_type="custom",
            scene_enhancement=True
        )
        print(f"  Output: {output_path}")
        print()


def main():
    """Main demo function."""
    print("CineVoice Video Enhancement Demo")
    print("This script demonstrates the video enhancement capabilities.")
    print()
    
    # Check if OpenCV is available
    try:
        import cv2
        print("OpenCV is available for video enhancement.")
    except ImportError:
        print("Error: OpenCV is required for video enhancement.")
        print("Please install it with: pip install opencv-python-headless")
        return
    
    print()
    
    # Run demos
    demo_single_video_enhancement()
    demo_custom_presets()
    demo_batch_enhancement()
    
    print("=" * 60)
    print("Demo Complete!")
    print("=" * 60)
    print()
    print("The video enhancement feature is ready for use with CineVoice.")
    print("You can now enhance your uploaded videos in the editor interface.")
    print("Available presets: modern_cinematic, vintage_film, dramatic,")
    print("                   television_style, neutral")
    print("Custom presets can also be applied with specific brightness,")
    print("contrast, and saturation values.")


if __name__ == "__main__":
    main()
