"""Video Enhancement Module for CineVoice Editor.

Provides cinematic video enhancement capabilities for both AI-generated and original videos.
Includes color correction, noise reduction, contrast enhancement, and style presets.
"""

import numpy as np
from PIL import Image, ImageEnhance
import cv2


def apply_color_correction(frame, brightness=1.0, contrast=1.0, saturation=1.0):
    """Apply color correction to a frame.
    
    Args:
        frame: Numpy array of the frame (BGR format)
        brightness: Brightness multiplier (1.0 = no change, >1.0 = brighter)
        contrast: Contrast multiplier (1.0 = no change)
        saturation: Saturation multiplier (1.0 = no change)
        
    Returns:
        Enhanced frame
    """
    if frame is None:
        return frame

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    # Apply brightness correction
    if brightness != 1.0:
        frame_rgb = np.clip(frame_rgb * brightness, 0, 255).astype(np.uint8)

    # Apply contrast correction using PIL for better results
    img = Image.fromarray(frame_rgb)
    if contrast != 1.0:
        enhancer = ImageEnhance.Contrast(img)
        frame_rgb = np.array(enhancer.enhance(contrast))

    if saturation != 1.0:
        enhancer = ImageEnhance.Color(img)
        frame_rgb = np.array(enhancer.enhance(saturation))

    return cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)


def apply_cinematic_preset(frame, preset_type="modern"):
    """Apply cinematic color preset to enhance the video.
    
    Args:
        frame: Numpy array of the frame (BGR format)
        preset_type: Type of cinematic preset ("modern", "vintage", "television", "dramatic")
        
    Returns:
        Enhanced frame
    """
    if frame is None:
        return frame

    # Convert to HLS color space for better color manipulation
    frame_hls = cv2.cvtColor(frame, cv2.COLOR_BGR2HLS)
    h, l, s = cv2.split(frame_hls)

    if preset_type == "modern":
        # Modern cinematic look - vibrant but natural
        s = cv2.addWeighted(s, 1.2, s, 0.0, 0)  # Increase saturation
        l = cv2.addWeighted(l, 1.1, l, 0.0, 0)  # Slightly brighter
        h = apply_hue_rotation(h, -15)  # Slightly cool tones
    elif preset_type == "vintage":
        # Vintage film look
        s = cv2.multiply(s, 0.7)  # Lower saturation
        l = cv2.addWeighted(l, 0.9, l, 0.0, 0)  # Muted brightness
        h = apply_hue_rotation(h, 45)  # Warm tones
    elif preset_type == "television":
        # Broadcast television look
        s = cv2.multiply(s, 0.85)
        l = cv2.addWeighted(l, 1.05, l, 0.0, 0)
        h = apply_hue_rotation(h, 0)  # Neutral tones
    elif preset_type == "dramatic":
        # Dramatic high-contrast look
        s = cv2.multiply(s, 1.3)
        l = cv2.addWeighted(l, 0.8, l, 0.0, 0)
        h = apply_hue_rotation(h, -30)  # Cooler tones

    # Merge the channels back
    frame_hls_enhanced = cv2.merge([h, l, s])
    frame_enhanced = cv2.cvtColor(frame_hls_enhanced, cv2.COLOR_HLS2BGR)

    return frame_enhanced


def apply_hue_rotation(hue_channel, degrees):
    """Apply hue rotation to the hue channel.
    
    Args:
        hue_channel: Hue channel (0-179 in OpenCV)
        degrees: Rotation angle in degrees
        
    Returns:
        Rotated hue channel
    """
    # Convert degrees to radians
    theta = degrees * np.pi / 180

    # Create rotation matrix
    c, s = np.cos(theta), np.sin(theta)

    # Create mesh grid for translation
    center_x, center_y = 90, 90
    y, x = np.indices((180, 180))

    # Apply rotation
    x = (x - center_x) * c + (y - center_y) * s + center_x
    y = -(x - center_x) * s + (y - center_y) * c + center_y

    # Crop to original size
    x = x.astype(np.int32)
    y = y.astype(np.int32)

    # Create the rotated hue channel
    rotated_hue = np.zeros_like(hue_channel)

    # Handle bounds checking for rotation
    mask = (x >= 0) & (x < 180) & (y >= 0) & (y < 180)
    rotated_hue[mask] = hue_channel[y[mask], x[mask]]

    return rotated_hue


def apply_scene_enhancement(frame, scene_type="neutral"):
    """Apply enhancement based on scene type detected.
    
    Args:
        frame: Numpy array of the frame (BGR format)
        scene_type: Type of scene ("neutral", "dramatic", "bright", "dynamic")
        
    Returns:
        Enhanced frame
    """
    if frame is None:
        return frame

    # Convert to HSV for easier brightness analysis
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    if scene_type == "dramatic":
        # Increase contrast and saturation
        s = cv2.multiply(s, 1.3)
        v = cv2.addWeighted(v, 1.15, v, 0.0, 0)
    elif scene_type == "bright":
        # Reduce saturation, increase brightness
        s = cv2.multiply(s, 0.85)
        v = cv2.addWeighted(v, 1.2, v, 0.0, 0)
    elif scene_type == "dynamic":
        # Vibrant look with balanced brightness
        s = cv2.multiply(s, 1.15)
        v = cv2.addWeighted(v, 1.1, v, 0.0, 0)
    # "neutral" scene keeps the original

    hsv_enhanced = cv2.merge([h, s, v])
    frame_enhanced = cv2.cvtColor(hsv_enhanced, cv2.COLOR_HSV2BGR)

    return frame_enhanced


def process_video_enhancement(video_path, output_path=None, presets=None, preset_type="modern_cinematic", scene_enhancement=True):
    """Process a video with enhancement presets.
    
    Args:
        video_path: Path to the input video
        output_path: Path to save enhanced video (optional)
        presets: Dict of enhancement presets (brightness, contrast, saturation)
        preset_type: Type of preset to apply (modern_cinematic, vintage_film, etc.)
        scene_enhancement: Whether to apply scene-type enhancement
        
    Returns:
        Path to enhanced video
    """
    # Default presets
    default_presets = {
        "modern_cinematic": {"brightness": 1.05, "contrast": 1.1, "saturation": 1.15},
        "vintage_film": {"brightness": 0.95, "contrast": 1.05, "saturation": 0.75},
        "television_style": {"brightness": 1.1, "contrast": 1.05, "saturation": 0.9},
        "dramatic": {"brightness": 0.9, "contrast": 1.15, "saturation": 1.25},
        "neutral": {"brightness": 1.0, "contrast": 1.0, "saturation": 1.0},
    }

    # Merge user presets with defaults
    if presets is None:
        presets = default_presets.get(preset_type, default_presets["modern_cinematic"])
    else:
        for key, value in default_presets.items():
            if key not in presets:
                presets[key] = value

    # Open video file
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_path}")

    # Get video properties
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Setup output writer
    if output_path is None:
        import os
        base_dir = os.path.dirname(video_path)
        video_name = os.path.basename(video_path)
        output_path = os.path.join(base_dir, f"enhanced_{video_name}")

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (frame_width, frame_height))

    frame_idx = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # Apply enhancements
        enhanced_frame = apply_color_correction(
            frame,
            brightness=presets.get("brightness", 1.0),
            contrast=presets.get("contrast", 1.0),
            saturation=presets.get("saturation", 1.0)
        )

        if scene_enhancement:
            # Detect simple scene type based on brightness and motion
            gray = cv2.cvtColor(enhanced_frame, cv2.COLOR_BGR2GRAY)
            brightness = cv2.mean(gray)[0] / 255.0

            if brightness < 0.3:
                scene_type = "dramatic"
            elif brightness > 0.7:
                scene_type = "bright"
            else:
                scene_type = "dynamic"

            enhanced_frame = apply_scene_enhancement(enhanced_frame, scene_type)

            # Apply cinematic preset based on scene type
            enhanced_frame = apply_cinematic_preset(enhanced_frame, "modern")

        # Write enhanced frame
        out.write(enhanced_frame)

        frame_idx += 1
        if frame_idx % 24 == 0:  # Progress every second at 24fps
            print(f"Enhancing video: {frame_idx}/{frame_count} frames")

    # Cleanup
    cap.release()
    out.release()

    print(f"Enhanced video saved to: {output_path}")
    return output_path


def batch_enhance_videos(video_paths, output_dir, preset_type="modern_cinematic"):
    """Enhance multiple videos with the same preset.
    
    Args:
        video_paths: List of input video paths
        output_dir: Directory to save enhanced videos
        preset_type: Type of preset to apply
        
    Returns:
        List of paths to enhanced videos
    """
    import os

    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    enhanced_paths = []
    default_presets = {
        "modern_cinematic": {"brightness": 1.05, "contrast": 1.1, "saturation": 1.15},
        "vintage_film": {"brightness": 0.95, "contrast": 1.05, "saturation": 0.75},
        "television_style": {"brightness": 1.1, "contrast": 1.05, "saturation": 0.9},
        "dramatic": {"brightness": 0.9, "contrast": 1.15, "saturation": 1.25},
        "neutral": {"brightness": 1.0, "contrast": 1.0, "saturation": 1.0},
    }

    presets = default_presets.get(preset_type, default_presets["modern_cinematic"])

    for video_path in video_paths:
        if not os.path.exists(video_path):
            print(f"Warning: Video not found - {video_path}")
            continue

        output_path = process_video_enhancement(
            video_path,
            presets=presets,
            scene_enhancement=True
        )

        enhanced_paths.append(output_path)

    return enhanced_paths
