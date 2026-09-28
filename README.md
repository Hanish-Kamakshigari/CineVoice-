# CineVoice
> **AI Video and Voiceover Studio** — Script-to-screen authoring with browser speech auditioning, automated scene analysis, subtitle tooling, and an offline FFmpeg rendering pipeline.

**Live Studio Web Application**: [https://cine-voice-puce.vercel.app/](https://cine-voice-puce.vercel.app/)

---

## Features

### Cinematic Web Studio Interface (`index.html`)
A single self-contained file — no build step, no bundler, no framework.

- **Multi-Scene Script Editor**: Write, import (`json` / `txt` / `fountain` / `csv` / `srt`), and organise narration cues with per-cue start time, duration, and on-screen text.
- **Live Voiceover Auditioning**: Audition any cue in the browser via the Web Speech API, with selectable system voices, automatic long-text chunking, and automatic scrolling to the active cue during playback.
- **Cinematic Viewport & Media Player**: Playback with drag-and-drop or file-picker upload, plus **letterbox** (2.39:1 bars) and **fullscreen** toggles.
- **Interactive Timeline**: Scrubbable, keyboard-operable seek bar with time readout.
- **Frame-by-Frame Scene Analysis**: Samples video frames to a canvas, detects visual scene cuts, and generates thumbnails you can turn into narration cues.
- **Subtitle Suite**: On-screen caption overlay, SRT/VTT/`.txt`/`.sub` import, SRT and VTT export, live subtitle line capture while playing, and auto-sync of subtitles from existing cues.
- **Export Deck**: Narration script as JSON or plain text, plus SRT and VTT subtitle files.
- **Direct Download**: Download the current video from the header, the cinema HUD, the playback toolbar, or the export deck.
- **Automatic Persistence**: Cues, subtitles, and subtitle styling are saved to `localStorage` and restored on reload, with a clear warning if storage quota is exceeded.
- **Keyboard Shortcuts** (press `?` in the app for a reminder):

  | Key | Action |
  | --- | --- |
  | `Space` / `K` | Play / pause |
  | `←` / `→` | Seek ∓5s (hold `Shift` for 10s) |
  | `↑` / `↓` | Volume ±5% |
  | `M` | Mute / unmute |
  | `C` | Toggle captions |
  | `F` | Fullscreen |
  | `L` | Letterbox |
  | `/` | Focus the timeline |

- **Accessibility**: Visible focus rings, labelled controls, ARIA roles on custom cards, live-region status toasts, a focus-trapped modal with `Escape` to close and focus restoration, plus `prefers-reduced-motion` and `prefers-contrast` support.

> Speech synthesis quality and the available voice list vary by browser. Chrome and Edge provide the most reliable results.

### Automated Movie Rendering Pipeline (`render_movie.py`)
- **HD Video Synthesis**: 1920×1080 at 24 fps, composed frame-by-frame with Pillow and encoded through FFmpeg (bundled via `imageio-ffmpeg`).
- **Neural Text-to-Speech**: Edge-TTS with male and female neural voices, tuned speech rate and pitch. Requires network access on first synthesis.
- **Ken Burns Motion Engine**: Per-scene interpolated zoom and pan.
- **Procedural Soundtrack**: Multi-act clock-tick foley, a glass-crack hit, a deliberate silent beat, a sub-bass drone with chord progressions and string swells, automatic ducking under narration, and soft-clipping normalisation.
- **Cinematic Finishing**: 2.39:1 anamorphic bars, per-scene timecode badges, and burned-in subtitles.
- **Robust Rendering**: Cross-platform font resolution, voice-over that is clipped rather than silently dropped when it overruns the film, checked FFmpeg exit codes, and a narration cache that re-synthesises automatically when the script text changes.
- **Flexible CLI**: `--voice`, `--script`, `--custom-audio`, `--force-voice`, and `--out` for headless batch runs.

---

## Repository Structure

```text
CineVoice/
├── cinematic_film_assets/                    # Source artwork for the 12 film scenes
├── index.html                                # Entire web studio (markup, styles, logic)
├── render_movie.py                           # Python/FFmpeg rendering pipeline
├── requirements.txt                          # Python rendering dependencies
├── site.webmanifest                          # PWA manifest
├── vercel.json                               # Vercel routing, cache, and security headers
├── generate_favicons.py                      # Favicon generator
├── favicon.svg / .ico / apple-touch-icon.png
├── android-chrome-192x192.png / android-chrome-512x512.png
├── master_soundtrack.wav                     # Reference soundtrack
├── THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4 # Pre-rendered demonstration film
├── Open_Film_And_Download.bat                # Windows helper: copy the film to Downloads
└── audio_cache/                              # Generated voice-over cache (git-ignored)
```

---

## Getting Started

### 1. Web Studio Application
Open `index.html` directly in a modern browser, or deploy the repository as static files to Vercel or any static host.

> `Open_Film_And_Download.bat` opens `http://localhost:8080/`, so run a local server first (for example `python -m http.server 8080`) if you want that launcher to work.

### 2. Local Rendering Pipeline

```bash
pip install -r requirements.txt
python render_movie.py --voice male
```

Optional arguments:

| Argument | Description |
| --- | --- |
| `--voice male\|female` | Narrator voice (default `male`) |
| `--script path/to/script.json` | Narration/subtitle script; a JSON array of `{ "id", "vo", "subtitle" }` |
| `--custom-audio path/to/voice.wav` | Use your own narration instead of neural TTS |
| `--force-voice` | Re-synthesise all voice-over even if cached |
| `--out path/to/output.mp4` | Output filename |

Scene IDs in `--script` must match the scene definitions in `render_movie.py`. Unrecognised IDs and malformed entries are reported as warnings; a script that matches no scene is a hard error rather than a silent render.

---

## Tech Stack

- **Frontend**: HTML5, vanilla CSS (glassmorphism / cine-dark theme), vanilla JavaScript — Web Speech API, HTML5 Canvas, `localStorage`.
- **Video & Audio Pipeline**: Python, Pillow (`PIL`), Edge-TTS, NumPy, SciPy, FFmpeg (`imageio-ffmpeg`).
- **Deployment**: Vercel static hosting, configured via `vercel.json`.

---

## License

MIT License. Free for personal and commercial use.
