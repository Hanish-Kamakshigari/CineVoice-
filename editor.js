(function (root) {
  'use strict';
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  /** Map output seconds to source seconds, safely across trimmed segments. */
  function outputToSource(time, segments) {
    let t = Math.max(0, time);
    for (const s of segments || []) {
      const len = Math.max(0, s.end - s.start);
      if (t <= len) return s.start + t;
      t -= len;
    }
    const s = (segments || [])[segments.length - 1];
    return s ? s.end : 0;
  }

  /** Map source seconds to output seconds; null when trimmed out. */
  function sourceToOutput(time, segments) {
    let out = 0;
    for (const s of segments || []) {
      if (time >= s.start && time <= s.end) return out + time - s.start;
      out += Math.max(0, s.end - s.start);
    }
    return null;
  }

  function durationOf(segments) {
    return (segments || []).reduce((n, s) => n + Math.max(0, s.end - s.start), 0);
  }

  function fmt(seconds, ms) {
    seconds = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(seconds / 60), s = seconds - m * 60;
    return String(m).padStart(2, '0') + ':' + String(Math.floor(s)).padStart(2, '0') + (ms ? '.' + String(Math.floor((s % 1) * 100)).padStart(2, '0') : '');
  }

  const esc = (value) => String(value == null ? '' : value);

  if (typeof module !== 'undefined' && module.exports) module.exports = { outputToSource, sourceToOutput, durationOf, fmt, clamp };
  if (typeof document === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const state = {
    video: null,                 // {name, duration}
    videoFile: null,             // File
    videoUrl: null,              // object URL
    segments: [],                // [{start, end}]
    narration: [],               // [{file, name, url, sourceDuration, start, offset, duration, gain}]
    music: null,                 // {file, name, url, duration, gain}
    originalGain: 1,
    originalAudioDisabled: false,
    originalGainBeforeMute: 1,
    outputTime: 0,
    playing: false,
    raf: 0,
    audioCtx: null,
    coloristReport: null,
    backendOk: false,
    exporting: false,
    ffmpeg: null,
    ffmpegLoading: null,
  };

  const toast = (msg) => {
    const e = $('toast');
    e.textContent = msg;
    e.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => e.classList.remove('show'), 3200);
  };

  // Local loopback API — only used for the optional AI enhance / colorist / TTS tools.
  const api = async (path, options = {}) => {
    const r = await fetch(path, {
      ...options,
      headers: { ...(options.body instanceof Blob ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) },
    });
    if (!r.ok) throw new Error((await r.text().catch(() => '')) || `Request failed (${r.status})`);
    return r.json();
  };

  const EXT = (name) => ((name || '').split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const safeName = (n) => String(n || 'file').replace(/[^a-z0-9_.-]/gi, '_');
  const num = (n) => Number(Number(n || 0).toFixed(3));

  // ---------- Timeline / summary rendering ----------

  const syncSummary = () => {
    const d = durationOf(state.segments);
    $('outputDuration').textContent = fmt(d);
    $('segmentCount').textContent = state.segments.length
      ? `${state.segments.length} range${state.segments.length === 1 ? '' : 's'} · ${fmt(d)}`
      : 'No ranges yet';
    $('exportSummary').textContent = state.video && state.segments.length
      ? `${state.segments.length} range${state.segments.length === 1 ? '' : 's'} · ${fmt(d)} output`
      : 'Add footage and at least one range.';
    $('exportButton').disabled = !(state.video && state.segments.length) || state.exporting;
    $('scrubber').max = Math.max(0, d);
    $('segmentMarkers').innerHTML = '';
    state.segments.reduce((at, s) => {
      const mark = document.createElement('i');
      mark.className = 'marker';
      mark.style.left = ((at / d) * 100) + '%';
      mark.style.width = (Math.max(0, s.end - s.start) / d * 100) + '%';
      $('segmentMarkers').append(mark);
      return at + Math.max(0, s.end - s.start);
    }, 0);
  };

  const renderSegments = () => {
    const list = $('segmentList');
    list.textContent = '';
    if (!state.segments.length) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'Add a source range to begin your cut.';
      list.append(li);
      syncSummary();
      return;
    }
    state.segments.forEach((s, i) => {
      const li = document.createElement('li');
      const no = document.createElement('span');
      no.className = 'index';
      no.textContent = String(i + 1).padStart(2, '0');
      const info = document.createElement('span');
      info.innerHTML = `<strong>Source range</strong><br><span class="seg-time">${fmt(s.start)} — ${fmt(s.end)} · ${fmt(s.end - s.start)}</span>`;
      const actions = document.createElement('span');
      const up = document.createElement('button');
      up.textContent = '↑'; up.title = 'Move earlier'; up.disabled = i === 0;
      up.onclick = () => { [state.segments[i - 1], state.segments[i]] = [state.segments[i], state.segments[i - 1]]; renderSegments(); };
      const down = document.createElement('button');
      down.textContent = '↓'; down.title = 'Move later'; down.disabled = i === state.segments.length - 1;
      down.onclick = () => { [state.segments[i + 1], state.segments[i]] = [state.segments[i], state.segments[i + 1]]; renderSegments(); };
      const del = document.createElement('button');
      del.textContent = '×'; del.title = 'Remove range';
      del.onclick = () => { state.segments.splice(i, 1); renderSegments(); updatePreview(); };
      actions.append(up, down, del);
      li.append(no, info, actions);
      list.append(li);
    });
    syncSummary();
  };

  const drawWaveform = async (c, canvas) => {
    try {
      const response = await fetch(c.url);
      const buffer = await (state.audioCtx ||= new (window.AudioContext || window.webkitAudioContext)()).decodeAudioData(await response.arrayBuffer());
      const data = buffer.getChannelData(0), ctx = canvas.getContext('2d'), w = canvas.width = canvas.clientWidth * 2, h = canvas.height = 32;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#e5b364';
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const from = Math.floor(x / w * data.length), to = Math.max(from + 1, Math.floor((x + 1) / w * data.length));
        let peak = 0;
        for (let j = from; j < to; j++) peak = Math.max(peak, Math.abs(data[j]));
        ctx.moveTo(x, h / 2 - peak * h * 0.45);
        ctx.lineTo(x, h / 2 + peak * h * 0.45);
      }
      ctx.stroke();
    } catch (_) { /* waveform is decorative */ }
  };

  const renderNarration = () => {
    const list = $('narrationList');
    list.textContent = '';
    if (!state.narration.length) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'No narration clips yet.';
      list.append(li);
      return;
    }
    state.narration.forEach((c, i) => {
      const li = document.createElement('li');

      const row = document.createElement('div');
      row.className = 'clip-row';
      const name = document.createElement('strong');
      name.textContent = c.name || 'Narration clip';
      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.title = 'Remove clip';
      remove.onclick = () => { state.narration.splice(i, 1); renderNarration(); };
      row.append(name, remove);

      const wave = document.createElement('canvas');
      wave.className = 'waveform';
      wave.setAttribute('aria-label', 'Audio waveform');
      li.append(row, wave);
      drawWaveform(c, wave);

      const controls = document.createElement('div');
      controls.className = 'clip-controls';
      [['Start', 'start', 0, durationOf(state.segments)],
       ['Offset', 'offset', 0, c.sourceDuration],
       ['Duration', 'duration', 0.01, c.sourceDuration],
       ['Gain', 'gain', 0, 1]].forEach(([label, key, min, max]) => {
        const l = document.createElement('label');
        l.textContent = label;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = min;
        input.max = max;
        input.step = '.01';
        input.value = c[key];
        input.onchange = () => { c[key] = clamp(Number(input.value), min, max); input.value = c[key]; };
        l.append(input);
        controls.append(l);
      });
      li.append(controls);

      if (c.offset + c.duration > c.sourceDuration + 0.01) {
        const warn = document.createElement('p');
        warn.className = 'warning';
        warn.textContent = 'Clip duration exceeds available audio; it will be shortened on export.';
        li.append(warn);
      }
      list.append(li);
    });
  };

  // ---------- Media loading (all local — nothing is uploaded) ----------

  function loadVideoFile(file) {
    if (!file) return;
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    const url = URL.createObjectURL(file);
    state.videoFile = file;
    state.videoUrl = url;
    state.video = { name: file.name, duration: 0 };

    $('sourceEmpty').classList.add('hidden');
    $('sourceLoaded').classList.remove('hidden');
    const src = $('sourceVideo');
    src.src = url;
    src.onloadedmetadata = () => {
      const d = src.duration;
      state.video.duration = d;
      $('sourceDuration').textContent = fmt(d);
      $('trimOut').value = d.toFixed(2);
      $('trimIn').max = d;
      $('trimOut').max = d;
    };
    $('sourceName').textContent = file.name;
    $('previewVideo').src = url;
    $('previewVideo').load();
    syncBackendGates(true);
    toast('Video ready. Add a source range.');
    syncSummary();
    updatePreview();
  }

  async function loadAudioFile(file) {
    const audio = new Audio();
    audio.preload = 'metadata';
    const url = URL.createObjectURL(file);
    audio.src = url;
    await new Promise((res, rej) => { audio.onloadedmetadata = res; audio.onerror = () => rej(new Error('Could not read that audio file.')); });
    return { audio, url, duration: audio.duration };
  }

  const addSegment = () => {
    if (!state.videoFile) return;
    const max = $('sourceVideo').duration || 0;
    const start = clamp(Number($('trimIn').value) || 0, 0, max);
    const end = clamp(Number($('trimOut').value) || max, 0, max);
    if (end <= start) { toast('The out point must be after the in point.'); return; }
    state.segments.push({ start, end });
    renderSegments();
    updatePreview();
  };

  const updatePreview = () => {
    const d = durationOf(state.segments);
    $('previewEmpty').classList.toggle('hidden', !d);
    $('playToggle').classList.toggle('hidden', !d);
    $('scrubber').max = Math.max(0, d);
    $('scrubber').value = state.outputTime;
    $('currentTime').textContent = fmt(state.outputTime, true);
    const src = outputToSource(state.outputTime, state.segments);
    const preview = $('previewVideo');
    if (state.videoUrl && preview.src !== state.videoUrl) preview.src = state.videoUrl;
    if (state.videoUrl && Math.abs(preview.currentTime - src) > 0.12) { try { preview.currentTime = src; } catch (_) {} }
  };

  const stopAudio = () => {
    state.narration.forEach((c) => { if (c.audio) { try { c.audio.pause(); c.audio.currentTime = 0; } catch (_) {} } });
    if (state.music && state.music.audio) { try { state.music.audio.pause(); state.music.audio.currentTime = 0; } catch (_) {} }
  };

  const syncNarration = () => {
    const total = durationOf(state.segments);
    state.narration.forEach((c) => {
      if (!c.url) return;
      if (!c.audio) c.audio = new Audio(c.url);
      const a = c.audio;
      const dur = Math.min(c.duration, c.sourceDuration);
      const inside = state.outputTime >= c.start && state.outputTime < c.start + dur;
      if (inside) {
        const wanted = c.offset + (state.outputTime - c.start);
        if (Math.abs(a.currentTime - wanted) > 0.18) a.currentTime = wanted;
        a.volume = clamp(Number(c.gain) || 0, 0, 1);
        if (state.playing) a.play().catch(() => {});
      } else {
        a.pause();
      }
    });
  };

  const syncMusic = () => {
    if (!state.music || !state.music.url) return;
    if (!state.music.audio) state.music.audio = new Audio(state.music.url);
    const a = state.music.audio;
    if (!state.playing) { a.pause(); return; }
    const duration = Number(state.music.duration) || a.duration;
    if (duration > 0) {
      const wanted = state.outputTime % duration;
      if (Math.abs(a.currentTime - wanted) > 0.3) a.currentTime = wanted;
    }
    a.loop = true;
    a.volume = clamp(Number(state.music.gain) || 0, 0, 1);
    a.play().catch(() => {});
  };

  const play = () => {
    if (!state.segments.length) return;
    state.playing = !state.playing;
    const preview = $('previewVideo');
    if (!state.playing) {
      preview.pause();
      stopAudio();
      updatePreview();
      return;
    }
    let last = performance.now();
    const tick = (now) => {
      if (!state.playing) return;
      state.outputTime += ((now - last) / 1000) * Number($('speed').value);
      last = now;
      const end = durationOf(state.segments);
      if (state.outputTime >= end) {
        state.outputTime = end;
        state.playing = false;
        stopAudio();
        preview.pause();
        updatePreview();
        return;
      }
      const src = outputToSource(state.outputTime, state.segments);
      if (Math.abs(preview.currentTime - src) > 0.06) preview.currentTime = src;
      preview.play().catch(() => {});
      syncNarration();
      syncMusic();
      updatePreview();
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  };

  const splitAtPlayhead = () => {
    const src = outputToSource(state.outputTime, state.segments);
    const i = state.segments.findIndex((s) => src > s.start + 0.02 && src < s.end - 0.02);
    if (i < 0) { toast('Place the playhead inside a segment to split it.'); return; }
    const s = state.segments[i];
    state.segments.splice(i, 1, { start: s.start, end: src }, { start: src, end: s.end });
    renderSegments();
  };

  // ---------- Optional, clearly-flagged local backend (AI enhance / colorist / TTS) ----------

  function syncBackendGates(hasVideo) {
    const videoReady = !!hasVideo;
    const en = state.backendOk && videoReady;
    $('enhancePreset').disabled = !en;
    $('enhanceVideo').disabled = !en;
    $('enhanceBlock')?.toggleAttribute('data-disabled', !en);
    $('coloristPreset').disabled = !en;
    $('coloristAnalyze').disabled = !en;
    $('coloristBlock')?.toggleAttribute('data-disabled', !en);
    $('enhanceStatus').textContent = state.backendOk
      ? (videoReady ? 'Ready to enhance video.' : 'Upload footage above to activate cinematic enhancement.')
      : 'Needs the local server: run python editor_server.py.';
    $('coloristStatus').textContent = state.backendOk
      ? (videoReady ? 'Ready to analyse scenes.' : 'Upload footage above to run the AI colorist.')
      : 'Needs the local server: run python editor_server.py.';
    $('generateNarration').disabled = !state.backendOk;
    const hint = $('ttsHint');
    if (hint) hint.textContent = state.backendOk
      ? 'Generated on your machine — never uploaded.'
      : 'Voice generation needs the local server: run python editor_server.py.';
  }

  const enhanceVideo = async () => {
    if (!state.backendOk) { toast('Enhancement needs the local server: run python editor_server.py.'); return; }
    toast('Enhancement runs on the local server — see the hint under the button.');
  };
  const coloristAnalyze = async () => { if (!state.backendOk) { toast('Colorist needs the local server: run python editor_server.py.'); return; } toast('Colorist is available in the local server build.'); };
  const coloristApply = async () => { if (!state.backendOk) return; toast('Colorist is available in the local server build.'); };

  // =====================================================
  // Export — renders entirely in this browser with ffmpeg.wasm
  // =====================================================

  const exportState = {
    progress: 0,
    probeLines: null,
  };

  function setExportUI({ busy, ratio, status, showDownload, downloadUrl }) {
    const btn = $('exportButton');
    if (typeof busy === 'boolean') {
      state.exporting = busy;
      btn.disabled = busy || !(state.video && state.segments.length);
      btn.firstChild.textContent = busy ? 'Rendering… ' : 'Export new MP4 ';
    }
    if (typeof ratio === 'number') {
      const pct = Math.round(clamp(ratio, 0, 1) * 100);
      $('exportProgress').classList.toggle('hidden', busy === false && pct >= 100);
      $('exportProgressFill').style.width = pct + '%';
      $('exportStatus').textContent = status || `Rendering… ${pct}%`;
    } else if (status) {
      $('exportStatus').textContent = status;
    }
    if (showDownload) {
      const link = $('downloadLink');
      link.href = downloadUrl;
      link.classList.remove('hidden');
    }
  }

  async function fetchBytes(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Could not read the source media.');
    return new Uint8Array(await r.arrayBuffer());
  }

  async function ensureFFmpeg() {
    if (state.ffmpeg) return state.ffmpeg;
    if (state.ffmpegLoading) return state.ffmpegLoading;
    state.ffmpegLoading = (async () => {
      const lib = typeof FFmpegWASM !== 'undefined' ? FFmpegWASM : null;
      if (!lib || !lib.FFmpeg) throw new Error('The in-browser encoder could not load. Check that vendor/ffmpeg/ is deployed with the site.');
      const ff = new lib.FFmpeg();
      ff.on('log', ({ message }) => { if (exportState.probeLines) exportState.probeLines.push(message); });
      ff.on('progress', ({ progress }) => {
        setExportUI({ ratio: Math.min(0.99, Math.max(0, Number(progress) || 0)) });
      });
      // Same-origin module worker (vendored); the heavy core+wasm stream from CDN (CORS-enabled).
      const workerURL = new URL('vendor/ffmpeg/worker.js', window.location.href).href;
      const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
      setExportUI({ status: 'Loading encoder (one-time, ~30 MB)…' });
      await ff.load({
        classWorkerURL: workerURL,
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: `${base}/ffmpeg-core.wasm`,
      });
      state.ffmpeg = ff;
      return ff;
    })();
    try {
      return await state.ffmpegLoading;
    } catch (err) {
      state.ffmpegLoading = null;
      throw err;
    }
  }

  async function detectVideoEncoder(ff) {
    exportState.probeLines = [];
    try { await ff.exec(['-encoders']); } catch (_) { /* still usable */ }
    const listing = (exportState.probeLines || []).join('\n');
    exportState.probeLines = null;
    if (/libx264/.test(listing)) return 'libx264';
    return 'mpeg4';
  }

  async function inputHasAudio(ff, inputName) {
    exportState.probeLines = [];
    try { await ff.exec(['-i', inputName]); } catch (_) { /* -i alone exits non-zero */ }
    const listing = (exportState.probeLines || []).join('\n');
    exportState.probeLines = null;
    return /Stream #\d+:\d+[^:]*: Audio/i.test(listing);
  }

  function buildExportGraph({ segments, narration, music, total, hasSourceAudio }) {
    const vParts = [];
    const aParts = [];
    const vLabels = [];
    const aLabels = [];

    segments.forEach((s, i) => {
      vParts.push(
        `[0:v]trim=start=${num(s.start)}:duration=${num(s.end - s.start)},` +
        `setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=30[tv${i}]`
      );
      vLabels.push(`[tv${i}]`);
      if (hasSourceAudio) {
        aParts.push(
          `[0:a]atrim=start=${num(s.start)}:duration=${num(s.end - s.start)},` +
          `asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[ta${i}]`
        );
        aLabels.push(`[ta${i}]`);
      }
    });

    const N = segments.length;
    if (hasSourceAudio) {
      aParts.push(`${aLabels.join('')}concat=n=${N}:v=0:a=1[acat]`);
      aParts.push(`[acat]volume=${num(state.originalGain)}[aorig]`);
    } else {
      aParts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(total)},aformat=sample_fmts=fltp[aorig]`);
    }

    vParts.push(`${vLabels.join('')}concat=n=${N}:v=1:a=0[vc]`);

    const mixInputs = ['[aorig]'];
    let ni = 0;
    narration.forEach((c) => {
      const inputIndex = 1 + ni; // inputs: 0 video, narration 1..n, music last
      const offset = num(c.offset || 0);
      const dur = num(Math.min(c.duration, c.sourceDuration));
      const startMs = Math.max(0, Math.round((c.start || 0) * 1000));
      aParts.push(
        `[${inputIndex}:a]atrim=start=${offset}:duration=${dur},asetpts=PTS-STARTPTS,` +
        `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `volume=${num(c.gain)},adelay=${startMs}|${startMs}[nar${ni}]`
      );
      mixInputs.push(`[nar${ni}]`);
      ni += 1;
    });

    if (music) {
      const mIndex = 1 + ni;
      aParts.push(
        `[${mIndex}:a]aloop=loop=-1,atrim=duration=${num(total)},asetpts=PTS-STARTPTS,` +
        `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `volume=${num(music.gain)}[mus]`
      );
      mixInputs.push('[mus]');
    }

    if (mixInputs.length > 1) {
      aParts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0:dropout_transition=0,atrim=duration=${num(total)},aformat=sample_fmts=fltp[aout]`);
    } else {
      aParts.push(`${mixInputs[0]}anull[aout]`);
    }

    return { filter: [...vParts, ...aParts].join(';'), videoLabel: '[vc]', audioLabel: '[aout]' };
  }

  async function runExport() {
    if (!state.videoFile) { toast('Upload a video first.'); return; }
    if (!state.segments.length) { toast('Add at least one source range.'); return; }

    const total = durationOf(state.segments);
    const ff = await ensureFFmpeg();

    const videoExt = EXT(state.videoFile.name);
    const videoInput = `input.${videoExt}`;
    const narrationJobs = state.narration.map((c, i) => ({ c, i, name: `nar${i}.${EXT(c.file?.name || 'mp3')}` }));
    const musicJob = state.music ? { name: `music.${EXT(state.music.file?.name || 'mp3')}` } : null;

    setExportUI({ busy: true, ratio: 0, status: 'Reading source media…' });
    $('downloadLink').classList.add('hidden');

    const written = [videoInput];
    const fileBytes = async (file, url) => file ? new Uint8Array(await file.arrayBuffer()) : fetchBytes(url);

    try {
      await ff.writeFile(videoInput, new Uint8Array(await state.videoFile.arrayBuffer()));
      for (const job of narrationJobs) {
        await ff.writeFile(job.name, await fileBytes(job.c.file, job.c.url));
        written.push(job.name);
      }
      if (musicJob) {
        await ff.writeFile(musicJob.name, await fileBytes(state.music.file, state.music.url));
        written.push(musicJob.name);
      }

      setExportUI({ status: 'Inspecting streams…', ratio: 0.02 });
      const hasSourceAudio = await inputHasAudio(ff, videoInput);
      const encoder = await detectVideoEncoder(ff);

      const { filter, videoLabel, audioLabel } = buildExportGraph({
        segments: state.segments,
        narration: state.narration,
        music: state.music,
        total,
        hasSourceAudio,
      });

      const args = ['-y', '-i', videoInput];
      narrationJobs.forEach((j) => args.push('-i', j.name));
      if (musicJob) args.push('-i', musicJob.name);
      args.push('-filter_complex', filter, '-map', videoLabel, '-map', audioLabel);
      if (encoder === 'libx264') args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23');
      else args.push('-c:v', 'mpeg4', '-q:v', '5');
      args.push('-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'out.mp4');

      setExportUI({ status: 'Rendering… 0%', ratio: 0.03 });
      const code = await ff.exec(args);
      if (code !== 0) throw new Error(`Encoder exited with code ${code}. Try shorter ranges or a different source file.`);

      const data = await ff.readFile('out.mp4');
      const blob = new Blob([data], { type: 'video/mp4' });
      setExportUI({ busy: false, ratio: 1, status: 'Export complete — your new cut is ready.', showDownload: true, downloadUrl: URL.createObjectURL(blob) });
      toast('Export complete. Click Download MP4.');
    } finally {
      for (const name of [...written, 'out.mp4']) { try { await ff.deleteFile(name); } catch (_) {} }
    }
  }

  // ---------- Save / load project (marks media to re-pick, keeps the edit) ----------

  function saveProject() {
    const data = {
      version: 2,
      videoName: state.video ? state.video.name : null,
      duration: state.video ? state.video.duration : 0,
      segments: state.segments,
      narration: state.narration.map(({ name, start, offset, duration, gain }) => ({ name, start, offset, duration, gain, sourceDuration: undefined })),
      music: state.music ? { name: state.music.name, gain: state.music.gain, duration: state.music.duration } : null,
      originalGain: state.originalGain,
      originalAudioDisabled: state.originalAudioDisabled,
      originalGainBeforeMute: state.originalGainBeforeMute,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'cinevoice-project.json';
    a.click();
  }

  function loadProject(e) {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        state.segments = Array.isArray(d.segments) ? d.segments.filter((s) => s && Number.isFinite(+s.start) && Number.isFinite(+s.end)) : [];
        state.narration = [];
        state.music = d.music && Number.isFinite(+d.music.gain) ? { name: d.music.name || 'Music bed', gain: Number(d.music.gain), duration: Number(d.music.duration) || 0, audio: null, url: null, file: null } : null;
        state.originalGain = Number(d.originalGain ?? 1);
        state.originalAudioDisabled = Boolean(d.originalAudioDisabled);
        state.originalGainBeforeMute = Number(d.originalGainBeforeMute ?? 1);

        $('muteOriginal').checked = state.originalAudioDisabled;
        $('originalGain').disabled = state.originalAudioDisabled;
        $('originalGain').value = state.originalGain;
        $('originalGainValue').textContent = Math.round(state.originalGain * 100) + '%';
        if (state.music && d.music) {
          $('musicName').textContent = state.music.name;
          $('musicGain').value = state.music.gain;
          $('musicInfo').classList.remove('hidden');
        }
        renderSegments();
        renderNarration();
        toast('Timeline restored. Re-upload footage/audio for this edit to preview and export.');
      } catch (_) {
        toast('That project file is not valid.');
      }
    };
    r.readAsText(f);
  }

  // ---------- Wire-up ----------

  const bind = () => {
    $('videoInput').onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) loadVideoFile(f); e.target.value = ''; };
    $('addSegment').onclick = addSegment;
    $('enhanceVideo').onclick = enhanceVideo;
    $('coloristAnalyze').onclick = coloristAnalyze;
    $('coloristApply').onclick = coloristApply;
    $('sourceVideo').onclick = () => { if (state.videoFile) $('trimIn').value = $('sourceVideo').currentTime.toFixed(2); };
    $('splitSegment')?.addEventListener('click', splitAtPlayhead);
    $('playButton').onclick = play;
    $('playToggle').onclick = play;
    $('backFrame').onclick = () => { state.outputTime = clamp(state.outputTime - 5, 0, durationOf(state.segments)); updatePreview(); };
    $('forwardFrame').onclick = () => { state.outputTime = clamp(state.outputTime + 5, 0, durationOf(state.segments)); updatePreview(); };
    $('scrubber').oninput = (e) => { state.outputTime = Number(e.target.value); updatePreview(); };
    $('speed').onchange = (e) => { $('previewVideo').playbackRate = Number(e.target.value); };

    $('originalGain').oninput = (e) => {
      state.originalGain = Number(e.target.value);
      $('originalGainValue').textContent = Math.round(state.originalGain * 100) + '%';
      if (Number(e.target.value) > 0 && state.originalAudioDisabled) { state.originalAudioDisabled = false; $('muteOriginal').checked = false; }
    };
    $('muteOriginal').onchange = (e) => {
      const c = e.target.checked;
      state.originalAudioDisabled = c;
      if (c) {
        state.originalGainBeforeMute = state.originalGain;
        state.originalGain = 0;
        $('originalGain').value = 0;
        $('originalGain').disabled = true;
        $('originalGainValue').textContent = '0%';
      } else {
        state.originalGain = state.originalGainBeforeMute;
        $('originalGain').value = state.originalGainBeforeMute;
        $('originalGain').disabled = false;
        $('originalGainValue').textContent = Math.round(state.originalGainBeforeMute * 100) + '%';
      }
    };

    $('narrationInput').onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      for (const f of files) {
        try {
          const { url, duration } = await loadAudioFile(f);
          state.narration.push({ file: f, name: f.name, url, sourceDuration: duration, start: 0, offset: 0, duration, gain: 1, audio: null });
        } catch (err) {
          toast(err.message);
        }
      }
      renderNarration();
    };

    $('musicInput').onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const { url, duration } = await loadAudioFile(f);
        if (state.music && state.music.url) URL.revokeObjectURL(state.music.url);
        state.music = { file: f, name: f.name, url, duration, gain: 0.35, audio: null };
        $('musicName').textContent = f.name;
        $('musicGain').value = 0.35;
        $('musicInfo').classList.remove('hidden');
      } catch (err) {
        toast(err.message);
      }
    };
    $('musicGain').oninput = (e) => { if (state.music) state.music.gain = Number(e.target.value); };

    $('generateNarration').onclick = async () => {
      if (!state.backendOk) { toast('Voice generation needs the local server: run python editor_server.py.'); return; }
      const text = $('ttsText').value.trim();
      if (!text) { toast('Write a line first.'); return; }
      const b = $('generateNarration');
      b.disabled = true;
      try {
        const r = await api('/api/narration', { method: 'POST', body: JSON.stringify({ text, voice: $('ttsVoice').value }) });
        const audio = new Audio(r.url);
        await new Promise((res, rej) => { audio.onloadedmetadata = res; audio.onerror = rej; });
        state.narration.push({ file: null, name: r.name || 'Generated narration', url: r.url, sourceDuration: audio.duration, start: state.outputTime, offset: 0, duration: audio.duration, gain: 1, audio: null });
        renderNarration();
        $('ttsText').value = '';
      } catch (err) {
        toast(err.message);
      } finally {
        b.disabled = false;
      }
    };

    $('exportButton').onclick = async () => {
      if (state.exporting) return;
      $('exportButton').disabled = true;
      try {
        await runExport();
      } catch (err) {
        setExportUI({ busy: false, ratio: undefined, status: 'Export failed: ' + (err && err.message ? err.message : err) });
        toast('Export failed: ' + (err && err.message ? err.message : err));
      } finally {
        state.exporting = false;
        syncSummary();
      }
    };

    $('saveProject').onclick = saveProject;
    $('loadProject').onchange = loadProject;

    // Drag & drop footage / audio anywhere on the page
    ['dragover', 'drop'].forEach((type) => window.addEventListener(type, (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some((i) => i.kind === 'file')) e.preventDefault();
    }));
    window.addEventListener('drop', (e) => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (!files.length) return;
      const video = files.find((f) => /^video\//.test(f.type) || /\.(mp4|webm|mov|mkv)$/i.test(f.name));
      const audio = files.filter((f) => /^audio\//.test(f.type) || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name));
      if (video) loadVideoFile(video);
      audio.forEach(async (f) => {
        try {
          const { url, duration } = await loadAudioFile(f);
          state.narration.push({ file: f, name: f.name, url, sourceDuration: duration, start: 0, offset: 0, duration, gain: 1, audio: null });
        } catch (err) { toast(err.message); }
      });
      if (audio.length) renderNarration();
    });
  };

  async function init() {
    bind();
    // Optional local AI backend — never required, always flagged.
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch('/api/health', { signal: ctrl.signal });
      clearTimeout(t);
      state.backendOk = r.ok;
    } catch (_) {
      state.backendOk = false;
    }
    const apiState = $('apiState');
    apiState.textContent = state.backendOk ? 'Local AI connected' : 'Browser editor — fully local';
    apiState.classList.toggle('ok', state.backendOk);

    syncBackendGates(false);
    renderSegments();
    renderNarration();
  }

  init();
}(typeof globalThis !== 'undefined' ? globalThis : this));
