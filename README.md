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
- **Narration-Led Editor**: Open `editor.html` through the local editor server to trim and reorder source ranges, add real narration clips with waveforms, duck music under speech, preview the synchronized output, and export a new MP4.
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

### Prompt Coach — Scene Improvement Analysis (`coach.js` + `/api/coach.js`)
Added in v1.2. Pause the video on any scene and the coach analyses the current scene frame-by-frame, then suggests an improved AI-video-generation prompt.

- **Frame Sampling**: Creates a hidden `<video>` clone with the same source, samples grayscale 32×18 thumbnails every 0.5 s in an 16-second window around the paused time, and detects hard scene cuts via per-frame pixel deltas (threshold ≈0.18).
- **Scene Stats**: Computes average brightness (0–1) and average motion (0–1) for the detected scene.
- **Keyframe Capture**: Captures 3 JPEG keyframes (scene start, middle, end) at 512 px wide.
- **AI Prompt Generation** (powered by Gemini): POSTs the 3 images + stats to `POST /api/coach`, which calls the Gemini API to describe weaknesses and write a concrete, cinematography-focused improved prompt (<90 words).
- **Offline Fallback**: If the Gemini API is unreachable or quota is exhausted, the serverless function returns a rule-based prompt derived from the brightness and motion numbers, labelled "offline mode".
- **Floating Panel**: Dark theme (#07090c) with gold accent (#d4a73a), shows timestamps, weaknesses, improved prompt, negative prompt, camera tip, and a Copy button.
- **XSS Safe**: All model output is escaped via `textContent` before inserting into the page.
- **Mobile Friendly**: Panel fits 360 px wide screens.
- **Auto-trigger**: Pausing the video automatically opens the coach after 600 ms (debounced).

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
├── Open_Film_And_Download.bat                # Windows launcher: copy the film to Downloads and open the studio
├── LICENSE                                   # MIT license text
└── audio_cache/                              # Generated voice-over cache (git-ignored)
```

---

## Getting Started

### 1. Web Studio Application
Open `index.html` directly in a modern browser, or deploy the repository as static files to Vercel or any static host.

> **Windows:** double-click `Open_Film_And_Download.bat`. It copies the film to your Downloads folder, then starts a local web server on `http://localhost:8080` (bound to `127.0.0.1` only) and opens the studio. If Python is not installed it opens `index.html` straight from disk instead, which works because the studio is a single self-contained file.

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

### 3. Narration-Led Video Editor

The editor uses a small loopback-only local server because a static browser page cannot safely upload local media or run FFmpeg:

```bash
pip install -r requirements.txt
python editor_server.py
```

Open [http://127.0.0.1:8080/editor.html](http://127.0.0.1:8080/editor.html). Upload a video, add one or more source ranges to the output timeline, upload or generate narration, optionally add music, then export the synchronized MP4. Runtime uploads and exports are stored in `.cinevoice-editor/` and are not committed.

---

## Tech Stack

- **Frontend**: HTML5, vanilla CSS (glassmorphism / cine-dark theme), vanilla JavaScript — Web Speech API, HTML5 Canvas, `localStorage`.
- **Video & Audio Pipeline**: Python, Pillow (`PIL`), Edge-TTS, NumPy, SciPy, FFmpeg (`imageio-ffmpeg`).
- **Deployment**: Vercel static hosting, configured via `vercel.json`.
- **AI Prompt Coach**: Vercel serverless function (`/api/coach.js`) + Gemini API.

---

## Prompt Coach — Deployment Setup

The Prompt Coach feature requires a Gemini API key set as a Vercel environment variable.

### 1. Get a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Click **Create API Key** and choose a Google Cloud project (or create one).
3. Copy the key (it starts with `AIza...`).

### 2. Set the environment variables on Vercel

```bash
# Install Vercel CLI if you haven't
npm i -g vercel

# Log in
vercel login

# Link your project
vercel link

# Add the API key (never commit it)
vercel env add GEMINI_API_KEY

# Optionally set the model (default: gemini-2.5-flash)
vercel env add GEMINI_MODEL

# Or set them in the Vercel Dashboard → Project → Settings → Environment Variables:
#   Key:   GEMINI_API_KEY
#   Value: AIza...
```

### 3. Redeploy

```bash
git add .
git commit -m "Add Prompt Coach feature"
git push
# Vercel auto-deploys. Or run:
vercel --prod
```

The Gemini API key stays server-side — the browser never sees it. If the API quota is exhausted or the service is unreachable, the coach falls back to a rule-based prompt generator ("offline mode").

---

## License

MIT License. Free for personal and commercial use.
