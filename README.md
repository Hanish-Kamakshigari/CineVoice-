# CineVoice
> **AI Video and Voiceover Studio** — Automated script-to-screen cinematic video generation with realistic neural voiceovers, dynamic camera motion, and immersive audio design.

---

## Features

### Cinematic Web Studio Interface (`index.html`)
- **Interactive Multi-Scene Script Editor**: Write, edit, and organize narrative scenes with granular control over scene timing, captions, and visual cues.
- **Live Voiceover Auditioning**: Test and audition voiceover lines directly within the browser before triggering full renders.
- **Cinematic 16:9 Viewport and Media Player**: Supports direct video playback, drag-and-drop video file upload, and custom cinematic letterboxing (2.39:1 aspect ratio bars).
- **Interactive Timeline and Audio Waveform Visualizer**: Real-time scrubbing, frame-accurate seeking, and dynamic canvas-based audio waveform visualization.
- **Render Configuration and CLI Command Generator**: One-click generation of terminal commands and exportable scene configuration JSON for headless execution.
- **Keyboard Shortcuts**: Built-in hotkeys for play/pause, frame stepping, mute, and fullscreen toggle.

### Automated Movie Rendering Pipeline (`render_movie.py`)
- **High-Definition Video Synthesis**: Automated 1080p 24fps video composition powered by OpenCV and FFmpeg.
- **Neural Text-to-Speech Integration**: Powered by Edge-TTS with multi-voice support (natural male and female neural voices), speech rate tuning, and pitch adjustments.
- **Ken Burns Motion Engine**: Smooth, frame-interpolated camera panning and scale zooming tailored to each scene's mood and pacing.
- **Procedural Ambient Soundtrack Synthesis**: Algorithmic generation of cinematic ambient drones, chord progressions, sub-bass layers, and automated audio ducking behind spoken dialogue.
- **Cinematic Visual Effects and Typography**: Scene timecode badges, custom typography, drop shadows, and synchronized subtitle overlays.
- **Flexible CLI Arguments**: Support for `--voice`, `--script`, and custom asset directories for headless batch processing.

### Turnkey Scripts and Assets
- **Windows Quick Launcher**: `Open_Film_And_Download.bat` for one-click setup and launch.
- **Pre-packaged Scene Artwork**: High-resolution concept art for immediate testing located in `cinematic_film_assets/`.

---

## Repository Structure

```text
CineVoice/
├── cinematic_film_assets/       # Key scene artwork and audio references
├── index.html                   # Web studio UI and playback engine
├── render_movie.py              # Core Python rendering pipeline
├── Open_Film_And_Download.bat   # Windows launcher helper
├── requirements.txt             # Python dependencies
└── .gitignore                   # Ignored files (rendered media and caches)
```

---

## Getting Started

### 1. Prerequisites

- Python 3.10 or higher
- Modern Web Browser (Chrome, Edge, Firefox)

### 2. Installation

Clone the repository and install the Python dependencies:

```bash
git clone https://github.com/Hanish-Kamakshigari/CineVoice-.git
cd CineVoice-
pip install -r requirements.txt
```

### 3. Launching the Web Studio

You can open `index.html` directly in your browser or run a lightweight local HTTP server:

```bash
python -m http.server 8080
```
Then navigate to: `http://localhost:8080/index.html`

### 4. Rendering Videos via CLI

Render a video using the automated rendering pipeline:

```bash
# Render with default male voice
python render_movie.py

# Render with female voice
python render_movie.py --voice female

# Render with custom script JSON
python render_movie.py --script path/to/script.json
```

---

## Deployment Guide

### Frontend Deployment (Vercel)

1. Sign in to [Vercel](https://vercel.com) and click **Add New...** -> **Project**.
2. Select your repository: `Hanish-Kamakshigari/CineVoice-`.
3. Set **Framework Preset** to `Other`.
4. Keep the **Root Directory** as `./` and leave build/output commands empty.
5. Click **Deploy**. Your studio will be live with high-speed CDN delivery and HTTPS.

### Backend Cloud API Deployment (Render.com)

1. Sign in to [Render.com](https://render.com) and click **New +** -> **Web Service**.
2. Connect your GitHub repository: `Hanish-Kamakshigari/CineVoice-`.
3. Choose **Docker** as the runtime (Render will automatically detect `Dockerfile`).
4. Select the **Free** instance type.
5. Click **Create Web Service**. Render builds the container with system-level FFmpeg and runs `server.py` on the assigned URL.

---

## Tech Stack

- **Frontend**: HTML5, Modern Vanilla CSS (Glassmorphism and Cine Dark Theme), Vanilla JavaScript (Web Audio API, HTML5 Canvas).
- **Backend and Rendering Pipeline**: Python, OpenCV (`cv2`), Edge-TTS, Pillow (`PIL`), NumPy, SciPy, FFmpeg (`imageio-ffmpeg`).

---

## License

MIT License. Free for personal and commercial use.
