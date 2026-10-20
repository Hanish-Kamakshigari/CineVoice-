# Video Enhancement Feature

## Overview

The CineVoice video enhancement system adds powerful cinematic enhancement capabilities to both AI-generated and user-uploaded videos. This feature enhances video quality through color correction, noise reduction, contrast enhancement, and style presets.

## Features

### Video Enhancement API

The video enhancement system provides a RESTful API endpoint for enhancing videos:

**POST `/api/enhance`**

Request body:
```json
{
  "videoId": "string (required)",           // ID of the video to enhance
  "presetType": "string",                  // Enhancement preset type
  "presets": {                             // Custom enhancement values
    "brightness": 1.05,
    "contrast": 1.1,
    "saturation": 1.15
  }
}
```

**Response:**
```json
{
  "id": "enhanced_video_id",
  "url": "/media/enhanced_video_id",
  "originalId": "original_video_id",
  "path": "path/to/enhanced/video.mp4",
  "message": "Video enhanced successfully"
}
```

### Available Enhancement Presets

The video enhancer supports five preset styles:

1. **modern_cinematic** - Vibrant, natural cinematic look with balanced enhancement
   - Brightness: 1.05×
   - Contrast: 1.1×
   - Saturation: 1.15×

2. **vintage_film** - Classic film look with muted tones
   - Brightness: 0.95×
   - Contrast: 1.05×
   - Saturation: 0.75×

3. **television_style** - Broadcast TV aesthetics
   - Brightness: 1.1×
   - Contrast: 1.05×
   - Saturation: 0.9×

4. **dramatic** - High-contrast, impactful visuals
   - Brightness: 0.9×
   - Contrast: 1.15×
   - Saturation: 1.25×

5. **neutral** - Subtle, minimal enhancement
   - Brightness: 1.0×
   - Contrast: 1.0×
   - Saturation: 1.0×

### Enhancement Algorithms

#### 1. Color Correction

- **Brightness adjustment**: Linear brightness scaling
- **Contrast enhancement**: PIL-based contrast enhancement for natural results
- **Saturation adjustment**: HSL color space manipulation for precise control

#### 2. Scene-Type Detection

The enhancer automatically detects scene types and applies appropriate enhancements:

- **Dramatic scenes** (brightness < 0.3): High contrast, increased saturation
- **Bright scenes** (brightness > 0.7): Reduced saturation, increased brightness
- **Dynamic scenes** (otherwise): Balanced enhancement with vibrant colors
- **Neutral scenes**: Minimal enhancement

#### 3. Cinematic Presets

Each preset applies specific color grading and tone curves:

- **Modern**: Cool tones, slightly increased saturation
- **Vintage**: Warm tones, film-like appearance
- **Television**: Neutral tones, broadcast aesthetic
- **Dramatic**: High contrast, cool tones

### Integration with CineVoice

#### Frontend Usage

The video enhancement feature integrates seamlessly with the CineVoice editor interface. Users can enhance their uploaded videos in the editor by:

1. Uploading a video to the editor
2. Selecting the enhanced video from the video list
3. Applying the desired enhancement preset
4. Previewing the enhanced version before exporting

#### Workflow

1. **Video Upload**: Users upload videos through the editor interface
2. **Enhancement Selection**: Users choose from preset styles or custom parameters
3. **Real-time Preview**: Enhanced video is previewed before final export
4. **Export**: The enhanced video is exported with narration and effects

### Technical Details

#### Dependencies

- **imageio-ffmpeg**: Native FFmpeg binary for high-speed filtergraph processing
- **Pillow (PIL)**: Image and color utilities
- **NumPy**: Numeric and array operations

#### Performance Considerations

- **High-speed processing**: Evaluated via multi-threaded native FFmpeg C filtergraphs (capable of enhancing 3-minute 1080p footage in seconds)
- **Audio preservation**: Lossless audio stream copy (`-c:a copy`) with AAC fallback
- **Fast-Start Web Streaming**: Encoded with `-movflags +faststart` for immediate browser playback

#### Compatibility

- **Input formats**: MP4, WebM, MOV
- **Output format**: MP4 with libx264 encoding
- **Resolution support**: Full HD (1920x1080) and above

### Use Cases

#### AI-Generated Video Enhancement

Enhance AI-generated content from platforms like:
- Kling
- Runway Gen-3
- Sora
- Luma Dream Machine

#### Original Video Enhancement

Apply cinematic enhancements to:
- User-uploaded footage
- Social media videos
- Home videos
- Professional content

#### Batch Processing

Process multiple videos with the same enhancement settings for:
- Content libraries
- Social media campaigns
- Video archives

### API Examples

#### Custom Enhancement

```json
POST /api/enhance
{
  "videoId": "abc123def456",
  "presetType": "custom",
  "presets": {
    "brightness": 1.1,
    "contrast": 0.95,
    "saturation": 1.2
  }
}
```

#### Preset Enhancement

```json
POST /api/enhance
{
  "videoId": "abc123def456",
  "presetType": "dramatic"
}
```

### Configuration

#### Server Configuration

Add the video enhancer to your CineVoice installation:

```bash
# Install dependencies
pip install opencv-python-headless numpy pillow

# Start the editor server
python editor_server.py
```

#### Frontend Integration

The video enhancement feature is automatically available in the CineVoice editor interface. No additional configuration is required.

### Troubleshooting

#### Common Issues

1. **Video not found**: Ensure the video ID is correct and the video is uploaded
2. **Enhancement failed**: Check that the video file is valid and not corrupted
3. **Performance issues**: Videos with high resolution may require more processing time

#### Error Codes

- `400`: Bad request - missing or invalid parameters
- `404`: Video not found
- `500`: Enhancement failed - internal server error

### Future Enhancements

Potential future improvements include:

1. **AI-powered enhancement**: Machine learning-based enhancement suggestions
2. **Style transfer**: Apply artistic styles to videos
3. **Real-time enhancement**: Live enhancement during video playback
4. **Multi-platform support**: Enhancement for mobile video content

### License

This feature is part of the CineVoice project and is licensed under the MIT License.
