# CineVoice
> **AI Video and Voiceover Studio** — Automated script-to-screen cinematic video generation with realistic neural voiceovers, dynamic camera motion, and immersive audio design.

**Live Studio Web Application**: [https://cine-voice-puce.vercel.app/](https://cine-voice-puce.vercel.app/)

---

## Features

### Cinematic Web Studio Interface (`index.html`)
- **Interactive Multi-Scene Script Editor**: Write, edit, and organize narrative scenes with granular control over scene timing, captions, and visual cues.
- **Live Voiceover Auditioning**: Test and audition voiceover lines directly within the browser with natural speech synthesis.
- **Cinematic 16:9 Viewport & Media Player**: Supports direct video playback, drag-and-drop video file upload, and custom cinematic letterboxing (2.39:1 aspect ratio bars).
- **Interactive Timeline & Audio Waveform Visualizer**: Real-time scrubbing, frame-accurate seeking, and dynamic canvas-based audio waveform visualization.
- **Frame-by-Frame AI Scene Analysis**: Automated canvas video frame scanning for intelligent visual scene analysis and synchronized cue suggestion.
- **Full Subtitle Suite**: Real-time closed captioning overlay, SRT/VTT file import/export, subtitle live timing capture, and AI subtitle generation from script cues.
- **Instant Video Download Engine**: Direct download options integrated into the top navigation bar, cinema HUD, playback toolbar, and export deck.
- **Keyboard Shortcuts**: Built-in hotkeys for play/pause, frame stepping, mute, and fullscreen toggle.

### Automated Movie Rendering Pipeline (`render_movie.py`)
- **High-Definition Video Synthesis**: Automated 1080p 24fps video composition powered by OpenCV and FFmpeg.
- **Neural Text-to-Speech Integration**: Powered by Edge-TTS with multi-voice support (natural male and female neural voices), speech rate tuning, and pitch adjustments.
- **Ken Burns Motion Engine**: Smooth, frame-interpolated camera panning and scale zooming tailored to each scene's mood and pacing.
- **Procedural Ambient Soundtrack Synthesis**: Algorithmic generation of cinematic ambient drones, chord progressions, sub-bass layers, and automated audio ducking behind spoken dialogue.
- **Cinematic Visual Effects and Typography**: Scene timecode badges, custom typography, drop shadows, and synchronized subtitle overlays.
- **Flexible CLI Arguments**: Support for `--voice`, `--script`, and custom asset directories for headless batch processing.

---

## Repository Structure

```text
CineVoice/
├── cinematic_film_assets/                    # Key scene artwork and audio references
├── index.html                                # Web studio UI and playback engine
├── Open_Film_And_Download.bat                # Windows launcher helper
├── render_movie.py                           # Core Python rendering pipeline
├── requirements.txt                          # Python rendering dependencies
├── THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4 # Pre-rendered demonstration film
└── vercel.json                               # Vercel deployment routing configuration
```

---

## Getting Started

### 1. Web Studio Application
Simply open `index.html` in any modern web browser or deploy directly to Vercel/static hosting.

### 2. Local Rendering Pipeline
To render videos locally using Python:

```bash
pip install -r requirements.txt
python render_movie.py --voice male
```

Optional arguments:
- `--voice male` or `--voice female`
- `--script path/to/script.json`
- `--out path/to/output.mp4`

---

## Tech Stack

- **Frontend**: HTML5, Modern Vanilla CSS (Glassmorphism & Cine Dark Theme), Vanilla JavaScript (Web Audio API, Web Speech API, HTML5 Canvas).
- **Video & Audio Pipeline**: Python, OpenCV (`opencv-python-headless`), Edge-TTS, Pillow (`PIL`), NumPy, SciPy, FFmpeg.
- **Deployment**: Vercel Edge Network.

---

## License

MIT License. Free for personal and commercial use.
