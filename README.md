# CineVoice
> **AI Video and Voiceover Studio** — Automated script-to-screen cinematic video generation with realistic neural voiceovers, dynamic camera motion, and immersive audio design.

**Live Studio Web Application**: [https://cine-voice-puce.vercel.app/](https://cine-voice-puce.vercel.app/)

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

### Cloud Video Synthesis API (`server.py`)
- **FastAPI Asynchronous Engine**: Production-ready REST backend managing background video synthesis jobs.
- **CORS Architecture**: Pre-configured for cross-origin communication between the frontend (Vercel) and the cloud renderer (Render.com).
- **Job Lifecycle Endpoints**:
  - `POST /api/render`: Accepts multi-scene JSON and queues rendering tasks.
  - `GET /api/status/{job_id}`: Polls render job status and progress.
  - `GET /api/download/{filename}`: Streams generated 1080p MP4 master files directly to the client.
  - `GET /api/health`: Health verification probe for cloud infrastructure.

### Turnkey Scripts and Assets
- **Dockerized Environment (`Dockerfile`)**: Containerized Linux image packing system FFmpeg and Python libraries for reproducible cloud deployments.
- **Cloud Infrastructure Blueprints (`render.yaml`, `vercel.json`)**: Zero-configuration templates for Render.com and Vercel.
- **Windows Quick Launcher**: `Open_Film_And_Download.bat` for one-click setup and launch.
- **Pre-packaged Scene Artwork**: High-resolution concept art for immediate testing located in `cinematic_film_assets/`.

---

## Repository Structure

```text
CineVoice/
├── cinematic_film_assets/       # Key scene artwork and audio references
├── Dockerfile                   # Cloud container definition with system FFmpeg
├── index.html                   # Web studio UI and playback engine
├── Open_Film_And_Download.bat   # Windows launcher helper
├── render_movie.py              # Core Python rendering pipeline
├── render.yaml                  # Render.com service configuration blueprint
├── requirements.txt             # Python dependencies
├── server.py                    # FastAPI cloud video synthesis service
└── vercel.json                  # Vercel deployment routing configuration
```

---

## Getting Started

### 1. Prerequisites

- Python 3.10 or higher
- Modern Web Browser (Chrome, Edge, Firefox, Safari)

### 2. Installation

Clone the repository and install the Python dependencies:

```bash
git clone https://github.com/Hanish-Kamakshigari/CineVoice-.git
cd CineVoice-
pip install -r requirements.txt
```

### 3. Launching the Web Studio Locally

You can open `index.html` directly in your browser or run a lightweight local HTTP server:

```bash
python -m http.server 8080
```
Then navigate to: `http://localhost:8080/index.html`

### 4. Running the Local API Server

Start the FastAPI backend with hot reloading:

```bash
uvicorn server:app --reload --port 8000
```

### 5. Rendering Videos via CLI

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

## Cloud Deployment Guide

### Frontend Deployment (Vercel)

- **Production URL**: [https://cine-voice-puce.vercel.app/](https://cine-voice-puce.vercel.app/)
- Automatically deployed from the `main` branch with high-performance edge CDN caching.

### Backend Cloud API Deployment (Render.com)

1. Sign in to [Render.com](https://render.com) and click **New +** -> **Web Service**.
2. Connect your GitHub repository: `Hanish-Kamakshigari/CineVoice-`.
3. Render automatically detects the `Dockerfile` and `render.yaml` configuration.
4. Set the name to `cinevoice-api` and choose the **Free** instance type.
5. Click **Create Web Service**. Render builds the container with system FFmpeg and exposes `server.py` at your public backend URL (e.g. `https://cinevoice-api.onrender.com`).

### Connecting Vercel Frontend to Render Backend

1. Open your live studio at [https://cine-voice-puce.vercel.app/](https://cine-voice-puce.vercel.app/).
2. Click **Cloud Render API** in the top navigation bar.
3. Paste your Render service URL into the input field and click **Test Connection**.
4. Once verified, click **Start Cloud Render** to synthesize full 1080p cinematic short films from any device. The resulting video automatically loads into the studio player with instant download options.

---

## Tech Stack

- **Frontend**: HTML5, Modern Vanilla CSS (Glassmorphism and Cine Dark Theme), Vanilla JavaScript (Web Audio API, HTML5 Canvas).
- **Backend & Cloud API**: FastAPI, Uvicorn, Python, OpenCV (`opencv-python-headless`), Edge-TTS, Pillow (`PIL`), NumPy, SciPy, FFmpeg.
- **DevOps & Infrastructure**: Docker, Vercel Edge Network, Render.com.

---

## License

MIT License. Free for personal and commercial use.
