# CineVoice

**AI video and voiceover studio** — script-to-screen authoring, automated scene analysis, AI color grading, and an offline FFmpeg rendering pipeline.

Live studio: [https://cine-voice-puce.vercel.app/](https://cine-voice-puce.vercel.app/)

---

## Capabilities

| Area | Summary |
| --- | --- |
| **Script editor** | Import `json`, `txt`, `fountain`, `csv` or `srt` and organise narration cues with start time, duration and on-screen text. |
| **Voiceover audition** | Audition any cue in the browser through the Web Speech API, with selectable voices and automatic chunking of long lines. |
| **Playback** | Scrubbable timeline, drag-and-drop playback, letterbox (2.39:1) and fullscreen modes. |
| **Scene analysis** | Frame sampling, automatic cut detection and thumbnails that can be converted into narration cues. |
| **Subtitles** | On-screen overlay, import/export (SRT, VTT, `.txt`, `.sub`), live capture while playing, and auto-sync from existing cues. |
| **Narration editor** | Local editor for trimming and reordering source ranges, layering narration with music ducking, and exporting a new MP4. |
| **AI colorist** | Per-scene measurement and restoration grading, delivered as a Resolve-ready 3D `.cube` LUT, a 1D tone LUT and a filtergraph. |
| **Prompt coach** | Frame-by-frame review of the paused scene that returns an improved AI-generation prompt. |
| **Studio enhancement** | One-click cinematic pass over an uploaded clip, with optional Nemotron-driven grading. |
| **Film pipeline** | 1080p composition, neural narration, Ken Burns motion, procedural score and burned-in subtitles. |

---

## Studio Interface

`index.html` is a single self-contained file — no build step, no bundler, no framework. Cues, subtitles and styling persist in `localStorage`.

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

Press `?` in the app for the shortcut reminder. Speech synthesis quality depends on the browser; Chrome and Edge give the most reliable results.

---

## AI Colorist

`video_colorist.py` analyses the footage and produces an executable grade.

- **Detection and measurement** — FFmpeg `scdet` locates the cuts; every scene is measured for exposure, clipping, contrast, noise, color cast, saturation, skin tone, sharpness and on-screen text.
- **Deterministic grade** — each scene receives its own exposure, contrast, saturation, white balance, toe lift, highlight roll-off, denoise and sharpen recipe. Presets: `cinematic`, `natural`, `documentary`, `text_clean`, `vintage`, `broadcast`.
- **Optional AI review** — NVIDIA Nemotron reviews one keyframe per scene and returns a diagnosis plus a grade. The answer is clamped to safe limits and merged over the measured plan, so quality never degrades when the model is unreachable.
- **Graceful degradation** — if the model rejects the keyframes, the vision pool is saturated or a call runs long, the review is retried from the measured statistics and then with a text only fallback model. The response is flagged as degraded; only a complete failure falls back to the deterministic plan.
- **Deliverables** — a DaVinci Resolve 3D `.cube` LUT, a 1D tone `.cube`, the FFmpeg filtergraph, a standalone Python grading script and a Resolve node recipe.
- **Rendering** — every scene correction is applied inside its own time window in a single decode pass; output is `libx264` with the original audio copied.
- **LUT fidelity** — the LUTs are baked from the same control points FFmpeg's `curves` filter receives, using identical `pchip` interpolation. The test suite re-parses them with a strict Iridas/Adobe parser and re-applies them through FFmpeg's own `lut3d` and `lut1d` filters.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/colorist/analyze` | Analyse an asset; returns a job id. |
| `GET` | `/api/colorist/jobs/{id}` | Poll the scene breakdown, plan and artefacts. |
| `POST` | `/api/colorist/apply` | Render the graded master from a report; returns a job id. |
| `GET` | `/api/colorist/report/{id}/{artefact}` | Download `lut`, `tone.cube`, `filtergraph`, `scene-filtergraph`, `script` or `recipe`. |
| `POST` | `/api/enhance` | Render a one-click enhanced copy of an asset. |

### Configuration

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NVIDIA_API_KEY` | Local server, Vercel | Nemotron access. Without it the colorist falls back to the deterministic plan. |
| `NEMOTRON_MODEL` | Local server, Vercel | Overrides the vision review model. |
| `NEMOTRON_FALLBACK_MODEL` | Local server, Vercel | Text only model used when the vision pool is saturated. |
| `COLORIST_PROXY_URL` | Local server | Proxy used when no local key is configured. |
| `CINEVOICE_ALLOWED_ORIGINS` | Local server | Extra origins allowed to call the loopback API (comma separated). The hosted studio is allowed by default. |
| `GEMINI_API_KEY` | Vercel | Gemini access for the prompt coach. |
| `GEMINI_MODEL` | Vercel | Overrides the coach model. |

The local server reads a `.env` file in the repository root; existing environment variables always take precedence. Keys are never committed.

---

## Getting Started

### Studio

`index.html` renders on its own, and the repository can be deployed as static files to any host.

> **Uploads, AI enhancement and the colorist need the local server.** Browsers block a page served over HTTPS from calling `http://127.0.0.1:8080`, so run the studio from the local server when you want those features:
>
> ```bash
> pip install -r requirements.txt
> python editor_server.py
> ```
>
> Then open [http://localhost:8080/index.html](http://localhost:8080/index.html).

> **Windows:** double-click `Open_Film_And_Download.bat`. It copies the demonstration film to your Downloads folder, starts `editor_server.py` on `http://localhost:8080` and opens the studio. Without Python it opens `index.html` directly from disk, where the AI features are unavailable.

### Local editor

A static page cannot upload local media or run FFmpeg, so the editor is served by a small loopback-only server:

```bash
pip install -r requirements.txt
python editor_server.py
```

Open [http://127.0.0.1:8080/editor.html](http://127.0.0.1:8080/editor.html), upload a video, define the output ranges, add narration and optional music, then export the synchronized MP4. Runtime uploads and exports live in `.cinevoice-editor/` and are not committed.

### Film pipeline

```bash
pip install -r requirements.txt
python render_movie.py --voice male
```

| Argument | Description |
| --- | --- |
| `--voice male\|female` | Narrator voice (default `male`). |
| `--script path/to/script.json` | Narration and subtitle script; a JSON array of `{ "id", "vo", "subtitle" }`. |
| `--custom-audio path/to/voice.wav` | Use your own narration instead of neural TTS. |
| `--force-voice` | Re-synthesise all narration even if cached. |
| `--out path/to/output.mp4` | Output filename. |

Scene IDs must match the scene definitions in `render_movie.py`. Unknown IDs and malformed entries are reported as warnings; a script that matches no scene is a hard error rather than a silent render.

---

## Deployment

Static hosting on Vercel is preconfigured through `vercel.json`. The two serverless functions need API keys:

```bash
npm i -g vercel
vercel login
vercel link
vercel env add GEMINI_API_KEY
vercel env add NVIDIA_API_KEY      # required for the live colorist proxy
vercel --prod
```

Both keys stay server-side. If Gemini is unreachable the prompt coach falls back to a rule-based generator; if Nemotron is unreachable the colorist returns the deterministic measurement plan. A model that cannot read images is retried without the keyframes first, so a single missing capability never disables the AI review.

---

## Project Layout

```text
CineVoice/
├── index.html                 # Web studio (markup, styles, logic)
├── editor.html / editor.js / editor.css / editor_server.py
│                              # Local narration editor and its loopback server
├── render_movie.py            # 1080p film rendering pipeline
├── video_colorist.py          # Colorist engine: measurement, grading, LUTs
├── editor_colorist.py         # Colorist job runner and Nemotron client
├── video_enhancer.py          # Studio enhancement pipeline
├── editor_render.py           # Timeline rendering and asset handling
├── api/coach.js / api/colorist.js
│                              # Vercel serverless functions
├── tests/                     # unittest suite, including LUT conformance tests
├── requirements.txt
├── vercel.json
├── cinematic_film_assets/     # Source artwork for the film scenes
├── THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4
└── Open_Film_And_Download.bat
```

---

## Tech Stack

- **Frontend** — HTML5, vanilla CSS, vanilla JavaScript (Web Speech API, Canvas, `localStorage`).
- **Pipeline** — Python, Pillow, Edge-TTS, NumPy, SciPy, FFmpeg via `imageio-ffmpeg`.
- **AI** — NVIDIA Nemotron (colorist), Gemini (prompt coach), both proxied through Vercel functions.
- **Hosting** — Vercel static hosting and serverless functions.

---

## License

MIT License. Free for personal and commercial use.
