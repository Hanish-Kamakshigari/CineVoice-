# CineVoice 🎬🎙️
> **AI Video & Voiceover Studio** — Automated script-to-screen cinematic video generation with realistic neural voiceovers, dynamic camera motion, and immersive audio design.

---

## ✨ Features

- **Cinematic Web Studio Interface (`index.html`)**:
  - Interactive multi-scene script editor with live voiceover auditioning.
  - Scene-by-scene storyboard inspector with camera pan & zoom controls.
  - Visual timeline player with synchronized audio waveform monitoring.
  - Fast script generation and custom prompt assistance.
- **Automated Movie Rendering Pipeline (`render_movie.py`)**:
  - High-definition 1080p 24fps video synthesis.
  - Neural text-to-speech integration via Edge-TTS (supporting multi-speaker male and female voices).
  - Ken Burns effects (smooth camera pans and subtle zoom dynamics).
  - Procedural ambient cinematic soundtrack synthesis and audio ducking.
  - Subtitle styling and cinematic letterboxing / badge watermarks.
- **Turnkey Setup**:
  - Windows launcher script (`Open_Film_And_Download.bat`).
  - Pre-packaged scene art and reference storyboard images in `cinematic_film_assets/`.

---

## 📁 Repository Structure

```text
CineVoice/
├── cinematic_film_assets/       # Key scene artwork and audio references
├── index.html                   # Web studio UI and playback engine
├── render_movie.py              # Core Python rendering pipeline
├── Open_Film_And_Download.bat   # Windows launcher helper
├── requirements.txt             # Python dependencies
└── .gitignore                   # Ignored files (rendered media & caches)
```

---

## 🚀 Getting Started

### 1. Prerequisites

- Python 3.10+
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

## 🛠️ Tech Stack

- **Frontend**: HTML5, Modern Vanilla CSS (Glassmorphism & Cine Dark Theme), Vanilla JavaScript (Web Audio API, Canvas rendering).
- **Backend / Pipeline**: Python, OpenCV (`cv2`), Edge-TTS, Pillow (`PIL`), NumPy, SciPy, FFmpeg (`imageio-ffmpeg`).

---

## 📄 License

MIT License. Feel free to use and modify for personal or commercial projects.
