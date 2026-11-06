/* ============================================================
   CineVoice — Reference Match
   Client-side look analysis (no video uploads) + LLM suggestions.
   All numeric work happens locally on <canvas>; only downscaled
   JPEG frames leave the browser, via /api/reference-match.
   ============================================================ */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------
     Tunables
     ------------------------------------------------------------ */
  var LIMITS = {
    maxFileBytes: 100 * 1024 * 1024,      // ~100MB local processing cap
    maxImages: 8,                          // reference still images
    framesDefault: 8,                      // sampled frames per video
    framesShortClip: 4,                    // clips under 5 seconds
    shortClipSeconds: 5,
    metricWidth: 320,                      // analysis resolution
    llmWidth: 768,                         // frame width sent to the LLM
    llmJpegQuality: 0.7,
    seekTimeoutMs: 4000,
    maxNotesChars: 2000,
    maxFrameChars: 500000,                 // per-frame base64 guard
    requestFrameBudget: 8                  // frames sent per side
  };

  /* ------------------------------------------------------------
     Pure helpers (also used by tests)
     ------------------------------------------------------------ */
  function signedPct(value) {
    if (!isFinite(value)) return 0;
    return Math.round(value);
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function hex(c) {
    var h = clamp(Math.round(c), 0, 255).toString(16);
    return h.length === 1 ? '0' + h : h;
  }

  function pctDelta(uploaded, reference) {
    if (!isFinite(uploaded) || !isFinite(reference) || Math.abs(reference) < 1e-6) return 0;
    return ((uploaded - reference) / Math.abs(reference)) * 100;
  }

  /** Human label for one metric delta. */
  function deltaLabel(kind, pct) {
    var p = Math.round(Math.abs(pct));
    if (p < 5) return 'about the same';
    switch (kind) {
      case 'brightness': return pct < 0 ? 'darker by ' + p + '%' : 'brighter by ' + p + '%';
      case 'contrast': return pct < 0 ? 'flatter by ' + p + '%' : 'punchier by ' + p + '%';
      case 'saturation': return pct < 0 ? 'less saturated (' + p + '%)' : 'more saturated (' + p + '%)';
      case 'sharpness': return pct < 0 ? 'softer by ' + p + '%' : 'crisper by ' + p + '%';
      case 'cutRate': return pct < 0 ? 'cuts ' + p + '% slower' : 'cuts ' + p + '% faster';
      case 'palette': return 'palette differs by ' + p + '%';
      default: return (pct > 0 ? '+' : '') + Math.round(pct) + '%';
    }
  }

  /**
   * Build the comparison object: { uploaded, reference, deltas }.
   * `uploaded`/`reference` are metric objects produced by analyzeFrames().
   * Every delta carries a signed percentage and a plain-English label.
   */
  function computeDeltas(u, r) {
    function band(a, b) { // positive = warmer/more orange in uploaded vs reference
      return (isFinite(a) && isFinite(b)) ? (a - b) : 0;
    }
    var cutRateDelta = pctDelta(u.motion.cutRate, r.motion.cutRate);
    var d = {
      brightnessPct: pctDelta(u.brightness.mean, r.brightness.mean),
      contrastPct: pctDelta(u.brightness.spread, r.brightness.spread),
      crushedPctPoints: u.brightness.crushedPercent - r.brightness.crushedPercent,
      clippedPctPoints: u.brightness.clippedPercent - r.brightness.clippedPercent,
      warmthPct: pctDelta(u.warmth.rbRatio, r.warmth.rbRatio),
      warmthDirection: '',
      saturationPct: pctDelta(u.saturation.mean, r.saturation.mean),
      saturationSpreadPct: pctDelta(u.saturation.spread, r.saturation.spread),
      shadowTintDiff: band(u.tint.shadows, r.tint.shadows),
      midTintDiff: band(u.tint.midtones, r.tint.midtones),
      highlightTintDiff: band(u.tint.highlights, r.tint.highlights),
      paletteDistancePct: paletteDistance(u.palette, r.palette),
      cutRatePct: cutRateDelta,
      cutRateLabel: deltaLabel('cutRate', cutRateDelta),
      sharpnessPct: pctDelta(u.sharpness, r.sharpness),
      letterboxUploaded: u.letterboxPercent >= 5,
      letterboxReference: r.letterboxPercent >= 5,
      letterboxDiff: u.letterboxPercent - r.letterboxPercent,
      aspectSame: u.aspect.label === r.aspect.label
    };
    d.brightnessLabel = deltaLabel('brightness', d.brightnessPct);
    d.contrastLabel = deltaLabel('contrast', d.contrastPct);
    d.saturationLabel = deltaLabel('saturation', d.saturationPct);
    d.sharpnessLabel = deltaLabel('sharpness', d.sharpnessPct);
    if (Math.abs(d.warmthPct) < 3) {
      d.warmthDirection = 'similar warmth';
    } else if (d.warmthPct < 0) {
      // Uploaded has lower R/B ratio than the reference -> cooler.
      d.warmthDirection = 'cooler by ' + Math.round(Math.abs(d.warmthPct)) + '%';
    } else {
      d.warmthDirection = 'warmer by ' + Math.round(d.warmthPct) + '%';
    }
    return d;
  }

  /** Mean nearest-neighbour RGB distance between two 5-color palettes, 0-100. */
  function paletteDistance(pA, pB) {
    if (!pA || !pB || !pA.length || !pB.length) return 0;
    var total = 0;
    pA.forEach(function (a) {
      var best = Infinity;
      pB.forEach(function (b) {
        var d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        if (d < best) best = d;
      });
      total += best; // max 765
    });
    return (total / (pA.length * 765)) * 100;
  }

  /* ------------------------------------------------------------
     Rule-based fallback suggestions (work without the LLM)
     ------------------------------------------------------------ */
  function ruleSuggestions(d) {
    var out = [];
    function add(category, issue, fix, priority) {
      out.push({ category: category, issue: issue, fix: fix, priority: priority });
    }
    // Rough stop conversion: perceptual brightness scales ~linear-ish with
    // stops on câmera exposure; 1 stop ≈ doubling light (100%). Heuristic:
    if (d.brightnessPct <= -15) {
      var stops = Math.min(1.5, Math.abs(d.brightnessPct) / 60);
      add('lighting',
        'Your video is ' + d.brightnessLabel + ' than the reference.',
        'Raise exposure by about ' + stops.toFixed(2) + ' stops (or lift the midtone gamma ~' + Math.min(40, Math.abs(d.brightnessPct)) + '%) and re-check the highlights stay under clipping.',
        'high');
    } else if (d.brightnessPct >= 15) {
      var stopsDown = Math.min(1.5, d.brightnessPct / 60);
      add('lighting',
        'Your video is ' + d.brightnessLabel + ' than the reference.',
        'Pull exposure down about ' + stopsDown.toFixed(2) + ' stops and re-check shadows are not crushing.',
        'high');
    }
    if (d.saturationPct <= -15) {
      add('color', 'Colors are ' + d.saturationLabel + ' than the reference.',
        'Increase global saturation by roughly ' + Math.min(35, Math.abs(d.saturationPct)) + '%, then fine-tune per channel so skin tones stay natural.', 'high');
    } else if (d.saturationPct >= 15) {
      add('color', 'Colors are ' + d.saturationLabel + ' than the reference.',
        'Reduce global saturation by roughly ' + Math.min(35, d.saturationPct) + '%; the reference keeps more muted tones.', 'medium');
    }
    if (d.warmthDirection.indexOf('cooler') === 0) {
      add('color', 'White balance is ' + d.warmthDirection + ' than the reference.',
        'Warm the white balance (temp toward orange, +200–400K equivalent) until the R/B balance matches, keeping highlights neutral.', 'medium');
    } else if (d.warmthDirection.indexOf('warmer') === 0) {
      add('color', 'White balance is ' + d.warmthDirection + ' than the reference.',
        'Cool the white balance slightly (toward blue) to match the reference temperature.', 'medium');
    }
    if (d.contrastPct <= -15) {
      add('contrast', 'Contrast is ' + d.contrastLabel + '.',
        'Add an S-curve (gentle for ~' + Math.min(30, Math.abs(d.contrastPct)) + ' more spread) so shadows and highlights separate like the reference.', 'medium');
    } else if (d.contrastPct >= 15) {
      add('contrast', 'Contrast is ' + d.contrastLabel + '.',
        'Soften the contrast curve slightly to match the reference range.', 'low');
    }
    if (d.shadowTintDiff <= -0.05) {
      add('color', 'Reference shadows lean teal/blue; yours are more neutral.',
        'Grade shadows toward teal/blue (~' + Math.round(Math.abs(d.shadowTintDiff) * 100) + '% tint shift) while keeping skin tones clean.', 'medium');
    } else if (d.shadowTintDiff >= 0.05) {
      add('color', 'Your shadows are warmer/tealer than the reference.',
        'Neutralize or warm the shadow tint to match the reference split-tone.', 'low');
    }
    if (d.highlightTintDiff >= 0.06) {
      add('color', 'Reference highlights lean orange/gold; yours do not.',
        'Push highlight tint toward warm gold (~' + Math.round(d.highlightTintDiff * 100) + '%) for that cinematic glow.', 'medium');
    } else if (d.highlightTintDiff <= -0.06) {
      add('color', 'Your highlights lean warmer than the reference.',
        'Neutralize highlight warmth so whites sit closer to the reference temperature.', 'low');
    }
    if (d.crushedPctPoints >= 8) {
      add('contrast', d.crushedPctPoints.toFixed(1) + '% more of the image sits in crushed black than the reference.',
        'Lift the black point slightly (fade/ lift blacks ~5–10%) to recover shadow detail.', 'medium');
    } else if (d.clippedPctPoints >= 8) {
      add('lighting', d.clippedPctPoints.toFixed(1) + '% more highlights are clipped than the reference.',
        'Lower the exposure (or add a highlight rolloff) so texture survives in bright areas.', 'medium');
    }
    if (d.sharpnessPct <= -30) {
      add('texture', 'Your footage is ' + d.sharpnessLabel + ' than the reference.',
        'Apply modest sharpening (unsharp mask, radius 1–2px at 1080p) and avoid aggressive denoise or low-res upscaling.', 'low');
    } else if (d.sharpnessPct >= 30) {
      add('texture', 'Your footage is ' + d.sharpnessLabel + ' than the reference.',
        'Add a slight diffusion/glow or lower sharpening so it reads more filmic.', 'low');
    }
    if (d.cutRateLabel && d.cutRateLabel.indexOf('same') < 0) {
      var refSeconds = d.cutRatePct < 0
        ? 'Hold shots longer — the reference cuts ' + d.cutRateLabel + '.'
        : 'Tighten pacing — the reference cuts ' + d.cutRateLabel + '.';
      add('pacing', 'Editing pace differs: ' + d.cutRateLabel + '.',
        refSeconds + ' Aim the average shot length near the reference rhythm (estimated, approximate).', 'medium');
    }
    if (d.letterboxReference && !d.letterboxUploaded) {
      add('framing', 'The reference uses cinematic letterbox bars; yours is edge-to-edge.',
        'Add 2.39:1 letterbox bars (or crop to a widescreen aspect) to match the framing.', 'medium');
    } else if (!d.letterboxReference && d.letterboxUploaded) {
      add('framing', 'Your video has letterbox bars the reference does not.',
        'Remove the black bars or crop them out (zoom to full frame) to match the reference.', 'low');
    }
    if (!d.aspectSame) {
      add('framing', 'Aspect ratio differs from the reference.',
        'Match the reference frame shape (crop or pad) so compositions land like the original.', 'low');
    }
    if (!out.length) {
      add('color', 'No large numeric differences detected.',
        'Looks close overall — refine with an LUT based on the reference palette for the final polish.', 'low');
    }
    // Deterministic priority order: high first, then medium, then low.
    var rank = { high: 0, medium: 1, low: 2 };
    return out.sort(function (a, b) { return rank[a.priority] - rank[b.priority]; });
  }

  /* ------------------------------------------------------------
     Frame sampling (DOM)
     ------------------------------------------------------------ */
  function loadVideoMeta(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var el = document.createElement('video');
      el.muted = true;
      el.preload = 'metadata';
      el.playsInline = true;
      var timeout = setTimeout(function () { cleanup(); reject(new Error('Could not read this video format. Try MP4/WebM.')); }, LIMITS.seekTimeoutMs);
      function cleanup() { clearTimeout(timeout); el.onloadedmetadata = el.onerror = null; }
      el.onloadedmetadata = function () {
        clearTimeout(timeout);
        el.onerror = null;
        if (!el.videoWidth || !isFinite(el.duration) || el.duration <= 0) {
          cleanup();
          reject(new Error('Unsupported or unreadable video.'));
          return;
        }
        resolve({ el: el, url: url, duration: el.duration, width: el.videoWidth, height: el.videoHeight });
      };
      el.onerror = function () { cleanup(); reject(new Error('Could not read this video format. Try MP4/WebM.')); };
      el.src = url;
    });
  }

  /** Seek and grab downscaled canvases; resolves frame list {t, metric, llm}. */
  function seekGrab(meta, frameCount) {
    return new Promise(function (resolve, reject) {
      var el = meta.el;
      var frames = [];
      var margin = meta.duration * 0.02;
      var sampleEvery = meta.duration / frameCount;
      // ---- canvas setup ----
      var mScale = LIMITS.metricWidth / meta.width;
      var llmScale = Math.min(1, LIMITS.llmWidth / meta.width);
      var mW = Math.max(1, Math.round(meta.width * mScale));
      var mH = Math.max(1, Math.round(meta.height * mScale));
      var lW = Math.max(1, Math.round(meta.width * llmScale));
      var lH = Math.max(1, Math.round(meta.height * llmScale));
      var mCanvas = document.createElement('canvas'); mCanvas.width = mW; mCanvas.height = mH;
      var lCanvas = document.createElement('canvas'); lCanvas.width = lW; lCanvas.height = lH;
      var mCtx = mCanvas.getContext('2d', { willReadFrequently: true });
      var lCtx = lCanvas.getContext('2d', { willReadFrequently: true });
      var i = 0;
      function grabAt(t) {
        return new Promise(function (res, rej) {
          var done = false;
          var to = setTimeout(function fin() { if (!done) { done = true; el.onseeked = null; rej(new Error('Frame seek timed out.')); } }, LIMITS.seekTimeoutMs);
          el.onseeked = function () {
            if (done) return;
            done = true;
            clearTimeout(to);
            try {
              mCtx.drawImage(el, 0, 0, mW, mH);
              lCtx.drawImage(el, 0, 0, lW, lH);
              var jpeg = lCanvas.toDataURL('image/jpeg', LIMITS.llmJpegQuality);
              frames.push({ t: t, metric: mCtx.getImageData(0, 0, mW, mH), metricW: mW, metricH: mH, jpeg: jpeg });
              res();
            } catch (e) { rej(e); }
          };
          el.currentTime = t;
        });
      }
      (function next() {
        if (i >= frameCount) {
          meta.url && URL.revokeObjectURL(meta.url);
          return resolve(frames);
        }
        var t = margin + sampleEvery * i;
        grabAt(t).then(function () { i++; next(); }).catch(function (e) {
          meta.url && URL.revokeObjectURL(meta.url);
          reject(e);
        });
      })();
    });
  }

  /** Sample a File (video) into {duration,width,height,frames[]} */
  function sampleVideoFile(file, onProgress) {
    return loadVideoMeta(file).then(function (meta) {
      var count = meta.duration < LIMITS.shortClipSeconds ? LIMITS.framesShortClip : LIMITS.framesDefault;
      return seekGrab(meta, count).then(function (frames) {
        return {
          kind: 'video', name: file.name, duration: meta.duration,
          width: meta.width, height: meta.height, frames: frames
        };
      });
    });
  }

  /** Downscale one still image to both metric + jpeg forms. */
  function sampleImageFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var mScale = LIMITS.metricWidth / img.naturalWidth;
          var lScale = Math.min(1, LIMITS.llmWidth / img.naturalWidth);
          var mW = Math.max(1, Math.round(img.naturalWidth * mScale)), mH = Math.max(1, Math.round(img.naturalHeight * mScale));
          var lW = Math.max(1, Math.round(img.naturalWidth * lScale)), lH = Math.max(1, Math.round(img.naturalHeight * lScale));
          var mC = document.createElement('canvas'); mC.width = mW; mC.height = mH;
          var lC = document.createElement('canvas'); lC.width = lW; lC.height = lH;
          mC.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, mW, mH);
          lC.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, lW, lH);
          URL.revokeObjectURL(url);
          resolve({
            kind: 'image', name: file.name, duration: 0,
            width: img.naturalWidth, height: img.naturalHeight,
            frames: [{ t: null, metric: mC.getContext('2d').getImageData(0, 0, mW, mH), metricW: mW, metricH: mH, jpeg: lC.toDataURL('image/jpeg', LIMITS.llmJpegQuality) }]
          });
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Unsupported image.')); };
      img.src = url;
    });
  }

  /* ------------------------------------------------------------
     Metric computation (pure ImageData math)
     ------------------------------------------------------------ */
  function analyzeFrames(sampled) {
    var nhist = new Array(256).fill(0);
    var sums = { n: 0, r: 0, g: 0, b: 0, sat: 0, satSq: 0, shadowRB: [0, 0], midRB: [0, 0], highRB: [0, 0] };
    var palettePixels = [];
    var diffs = [];
    var sharpSum = 0, sharpN = 0;
    var letterRows = { top: 0, topN: 0, bot: 0, botN: 0 };
    var pillCols = { left: 0, leftN: 0, right: 0, rightN: 0 };
    var prev = null;

    sampled.frames.forEach(function (fr, idx) {
      var d = fr.metric.data, w = fr.metricW, h = fr.metricH;
      var flat = [];
      // --- per-pixel pooling ---
      for (var y = 0; y < h; y++) {
        var rowSum = 0;
        for (var x = 0; x < w; x++) {
          var o = (y * w + x) * 4;
          var R = d[o], G = d[o + 1], B = d[o + 2];
          var Y = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B);
          nhist[Y]++; sums.n++;
          rowSum += Y;
          if (Y < 85) { sums.shadowRB[0] += R; sums.shadowRB[1] += B; }
          else if (Y > 170) { sums.highRB[0] += R; sums.highRB[1] += B; }
          else { sums.midRB[0] += R; sums.midRB[1] += B; }
          var mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          var s = mx > 0 ? (mx - mn) / mx : 0;
          sums.r += R; sums.g += G; sums.b += B;
          sums.sat += s; sums.satSq += s * s;
          if ((y * w + x) % 6 === 0) flat.push([R, G, B]);
        }
        // --- letterbox row analysis (top/bottom 15% bands) ---
        var bandTop = h * 0.15, bandBot = h * 0.85;
        if (y < bandTop) { letterRows.topN++; if (rowSum / w < 20) letterRows.top++; }
        else if (y > bandBot) { letterRows.botN++; if (rowSum / w < 20) letterRows.bot++; }
      }
      // pillarbox columns (left/right 8%)
      for (var x2 = 0; x2 < w; x2++) {
        var colSum = 0;
        for (var y2 = 0; y2 < h; y2++) {
          var o2 = (y2 * w + x2) * 4;
          colSum += 0.2126 * d[o2] + 0.7152 * d[o2 + 1] + 0.0722 * d[o2 + 2];
        }
        if (x2 < w * 0.08) { pillCols.leftN++; if (colSum / h < 20) pillCols.left++; }
        else if (x2 > w * 0.92) { pillCols.rightN++; if (colSum / h < 20) pillCols.right++; }
      }
      palettePixels.push(flat);
      // --- sharpness: Laplacian variance on grayscale ---
      var gray = [];
      for (var yy = 0; yy < h; yy++) { var row = []; for (var xx = 0; xx < w; xx++) { var oo = (yy * w + xx) * 4; row.push(0.2126 * d[oo] + 0.7152 * d[oo + 1] + 0.0722 * d[oo + 2]); } gray.push(row); }
      var lvals = [];
      for (var yy2 = 1; yy2 < h - 1; yy2 += 1) {
        for (var xx2 = 1; xx2 < w - 1; xx2 += 1) {
          var lap = 4 * gray[yy2][xx2] - gray[yy2 - 1][xx2] - gray[yy2 + 1][xx2] - gray[yy2][xx2 - 1] - gray[yy2][xx2 + 1];
          lvals.push(lap);
        }
      }
      var lmean = lvals.reduce(function (a, b) { return a + b; }, 0) / lvals.length;
      var lvar = lvals.reduce(function (a, b) { return a + (b - lmean) * (b - lmean); }, 0) / lvals.length;
      sharpSum += lvar; sharpN++;
      // --- motion: mean abs diff vs previous sampled frame ---
      if (prev) {
        var diffTotal = 0, diffN = 0;
        for (var yd = 0; yd < h; yd += 2) {
          for (var xd = 0; xd < w; xd += 2) {
            var od = (yd * w + xd) * 4;
            diffTotal += Math.abs(d[od] - prev[od]) + Math.abs(d[od + 1] - prev[od + 1]) + Math.abs(d[od + 2] - prev[od + 2]);
            diffN++;
          }
        }
        diffs.push(diffTotal / (diffN * 3 * 255));
        if (diffTotal / (diffN * 3 * 255) > 0.35) { fr.cutDetected = true; }
      }
      prev = d;
    });

    function histMeanStd(hist) {
      var n = 0, sum = 0;
      hist.forEach(function (c, i) { n += c; sum += c * i; });
      var mean = n ? sum / n : 128;
      var varSum = 0;
      hist.forEach(function (c, i) { varSum += c * (i - mean) * (i - mean); });
      return { mean: mean, std: n ? Math.sqrt(varSum / n) : 0, n: n };
    }
    var lum = histMeanStd(nhist);
    var crushed = nhist.slice(0, 16).reduce(function (a, b) { return a + b; }, 0);
    var clipped = nhist.slice(236).reduce(function (a, b) { return a + b; }, 0);

    var meanCut = diffs.length ? diffs.reduce(function (a, b) { return a + b; }, 0) / diffs.length : 0;
    var cutsSeen = sampled.frames.reduce(function (a, f) { return a + (f.cutDetected ? 1 : 0); }, 0);
    var cutRate = (sampled.duration > 0 && cutsSeen > 0) ? cutsSeen / sampled.duration : 0;

    var letterboxPct = ((letterRows.top + letterRows.bot) / Math.max(1, letterRows.topN + letterRows.botN)) * 100;
    var pillarPct = ((pillCols.left + pillCols.right) / Math.max(1, pillCols.leftN + pillCols.rightN)) * 100;

    var aspectLabel = aspectOf(sampled.width, sampled.height);

    var tint = {
      shadows: sums.shadowRB[0] + sums.shadowRB[1] > 0 ? (sums.shadowRB[0] - sums.shadowRB[1]) / (sums.shadowRB[0] + sums.shadowRB[1]) : 0,
      midtones: sums.midRB[0] + sums.midRB[1] > 0 ? (sums.midRB[0] - sums.midRB[1]) / (sums.midRB[0] + sums.midRB[1]) : 0,
      highlights: sums.highRB[0] + sums.highRB[1] > 0 ? (sums.highRB[0] - sums.highRB[1]) / (sums.highRB[0] + sums.highRB[1]) : 0
    };

    return {
      kind: sampled.kind,
      name: sampled.name,
      duration: sampled.duration,
      framesSampled: sampled.frames.length,
      sampleGapSeconds: sampled.duration > 0 ? sampled.duration / sampled.frames.length : 0,
      aspect: aspectLabel,
      aspectRatio: +(sampled.width / sampled.height).toFixed(3),
      letterboxPercent: +letterboxPct.toFixed(1),
      pillarboxPercent: +pillarPct.toFixed(1),
      brightness: {
        mean: +lum.mean.toFixed(1),                       // 0-255
        spread: +lum.std.toFixed(1),                      // contrast proxy
        crushedPercent: +(crushed / lum.n * 100).toFixed(1),
        clippedPercent: +(clipped / lum.n * 100).toFixed(1)
      },
      warmth: { rbRatio: +((sums.r / Math.max(1, sums.b))).toFixed(3), label: warmthLabel(sums.r / Math.max(1, sums.b)) },
      saturation: {
        mean: +(sums.sat / Math.max(1, sums.n)).toFixed(3),
        spread: +(Math.sqrt(Math.max(0, sums.satSq / Math.max(1, sums.n) - (sums.sat / Math.max(1, sums.n)) * (sums.sat / Math.max(1, sums.n))))).toFixed(3)
      },
      tint: {
        shadows: +tint.shadows.toFixed(3),
        midtones: +tint.midtones.toFixed(3),
        highlights: +tint.highlights.toFixed(3)
      },
      palette: medianCutPalette(palettePixels, 5),
      motion: {
        frameDiff: +meanCut.toFixed(3),
        cutRate: +cutRate.toFixed(3)                      // approx cuts / second
      },
      sharpness: +((sharpSum / Math.max(1, sharpN))).toFixed(1),
      frames: sampled.frames.map(function (f) { return { t: f.t, jpeg: f.jpeg }; })
    };
  }

  function warmthLabel(ratio) {
    if (ratio > 1.08) return 'warm';
    if (ratio < 0.92) return 'cool';
    return 'neutral';
  }

  function aspectOf(w, h) {
    var r = w / h;
    var known = [
      { r: 16 / 9, label: '16:9' }, { r: 9 / 16, label: '9:16 (vertical)' },
      { r: 2.39, label: '2.39:1 (scope)' }, { r: 1.85, label: '1.85:1' },
      { r: 4 / 3, label: '4:3' }, { r: 1, label: '1:1' }
    ];
    for (var i = 0; i < known.length; i++) {
      if (Math.abs(r - known[i].r) < 0.06) return { ratio: +r.toFixed(2), label: known[i].label };
    }
    return { ratio: +r.toFixed(2), label: r.toFixed(2) + ':1' };
  }

  /* ---- median-cut palette over pooled pixel samples ---- */
  function medianCutPalette(framePixels, count) {
    var all = [];
    framePixels.forEach(function (f) { f.forEach(function (p) { if ((p[0] + p[1] + p[2]) > 0) all.push(p); }); });
    if (!all.length) return [];
    var boxes = [all];
    while (boxes.length < count) {
      boxes.sort(function (a, b) { return rangeScore(b) - rangeScore(a); });
      var big = boxes.shift();
      if (!big || rangeScore(big) < 12) { if (big) boxes.push(big); break; }
      var ch = dominantChannel(big);
      big.sort(function (a, b) { return a[ch] - b[ch]; });
      var mid = Math.floor(big.length / 2);
      boxes.push(big.slice(0, mid), big.slice(mid));
    }
    return boxes.map(function (box) {
      var s = [0, 0, 0];
      box.forEach(function (p) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; });
      return [s[0] / box.length, s[1] / box.length, s[2] / box.length, box.length / all.length];
    }).sort(function (a, b) { return b[3] - a[3]; });
  }
  function rangeScore(box) {
    var mn = [255, 255, 255], mx = [0, 0, 0];
    box.forEach(function (p) { for (var i = 0; i < 3; i++) { if (p[i] < mn[i]) mn[i] = p[i]; if (p[i] > mx[i]) mx[i] = p[i]; } });
    return Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  }
  function dominantChannel(box) {
    var mn = [255, 255, 255], mx = [0, 0, 0];
    box.forEach(function (p) { for (var i = 0; i < 3; i++) { if (p[i] < mn[i]) mn[i] = p[i]; if (p[i] > mx[i]) mx[i] = p[i]; } });
    var ranges = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    return ranges.indexOf(Math.max.apply(null, ranges));
  }

  /* ------------------------------------------------------------
     Full pipeline for one input slot
     ------------------------------------------------------------ */
  function analyzeInput(files, onProgress) {
    return new Promise(function (resolve, reject) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) { reject(new Error('No file selected.')); return; }
      var videoFile = list.find(function (f) { return (f.type || '').indexOf('video/') === 0; });
      var imageFiles = list.filter(function (f) { return (f.type || '').indexOf('image/') === 0; }).slice(0, LIMITS.maxImages);
      if (videoFile) {
        if (videoFile.size > LIMITS.maxFileBytes) { reject(new Error('File is over the 100MB local processing limit.')); return; }
        onProgress && onProgress('sampling');
        sampleVideoFile(videoFile, onProgress).then(function (sampled) {
          onProgress && onProgress('analyzing');
          resolve(analyzeFrames(sampled));
        }).catch(reject);
        return;
      }
      if (imageFiles.length) {
        onProgress && onProgress('sampling');
        Promise.all(imageFiles.map(sampleImageFile)).then(function (imgs) {
          var merged = {
            kind: 'images', name: imageFiles[0].name + (imageFiles.length > 1 ? ' (+' + (imageFiles.length - 1) + ')' : ''),
            duration: 0, width: imgs[0].width, height: imgs[0].height,
            frames: imgs.reduce(function (a, b) { return a.concat(b.frames); }, [])
          };
          onProgress && onProgress('analyzing');
          resolve(analyzeFrames(merged));
        }).catch(reject);
        return;
      }
      reject(new Error('Pick a video clip or image files for the reference.'));
    });
  }

  /* ------------------------------------------------------------
     Serverless call
     ------------------------------------------------------------ */
  function trimFramesForRequest(frames, budget) {
    return (frames || []).slice(0, budget).map(function (f) { return f.jpeg; })
      .filter(function (d) { return typeof d === 'string' && d.length < LIMITS.maxFrameChars; });
  }

  function requestSuggestions(payload) {
    return fetch('/api/reference-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'Bad response from the API.' }; }).then(function (body) {
        return { status: r.status, body: body };
      });
    });
  }

  /* ------------------------------------------------------------
     DOM / UI
     ------------------------------------------------------------ */
  var state = {
    uploaded: null,     // metric object + file
    reference: null,    // metric object + file(s)
    uploadedFiles: null,
    referenceFiles: null,
    busy: false
  };

  function $(id) { return document.getElementById(id); }

  function toast(msg, isError) {
    if (typeof root.showToast === 'function') root.showToast(msg, !!isError);
    else if (typeof console !== 'undefined') console.log('[ReferenceMatch]', msg);
  }

  function setProgress(phase) {
    var el = $('rmProgress');
    if (!el) return;
    var map = { idle: '', sampling: 'Sampling frames…', analyzing: 'Analyzing look metrics…', generating: 'Generating AI suggestions…' };
    el.textContent = map[phase] || '';
    $('rmCompareBtn').disabled = phase !== 'idle' && !!phase;
  }

  function resetSlot(kind) {
    var slot = kind === 'uploaded' ? $('rmSlotUploaded') : $('rmSlotReference');
    slot.querySelector('input[type=file]').value = '';
    slot.classList.remove('filled');
    slot.querySelector('div[data-thumbs]').innerHTML = '';
  }

  function renderThumbs(kind, metric) {
    var box = (kind === 'uploaded' ? $('rmSlotUploaded') : $('rmSlotReference')).querySelector('div[data-thumbs]');
    box.innerHTML = '';
    metric.frames.slice(0, LIMITS.requestFrameBudget).forEach(function (f) {
      var img = document.createElement('img');
      img.src = f.jpeg;
      img.alt = 'Sampled frame' + (f.t != null ? ' at ' + fmtTime(f.t) : '');
      box.appendChild(img);
    });
    var label = kind === 'uploaded' ? $('rmUploadedMeta') : $('rmReferenceMeta');
    label.textContent = metric.name + ' · ' + metric.framesSampled + ' frames' +
      (metric.duration ? ' · ' + fmtTime(metric.duration) : ' · stills') + ' · ' + metric.aspect.label;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    var t = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return t;
  }

  function handleFiles(kind, files) {
    var maxBytes = LIMITS.maxFileBytes;
    var arr = Array.prototype.slice.call(files || []);
    if (!arr.length) return;
    if (arr.some(function (f) { return f.size > maxBytes; })) {
      toast('File over the 100MB limit — pick a shorter clip or compress it first.', true);
      return;
    }
    if (kind === 'uploaded') state.uploadedFiles = arr; else state.referenceFiles = arr;
    if (kind === 'uploaded' && state.uploaded) { state.uploaded = null; resetSlot('uploaded'); }
    if (kind === 'reference' && state.reference) { state.reference = null; resetSlot('reference'); }
    setProgress('sampling');
    analyzeInput(arr, function () { /* per-video progress toasts omitted inside slot flow */ })
      .then(function (metric) {
        if (kind === 'uploaded') state.uploaded = metric; else state.reference = metric;
        (kind === 'uploaded' ? $('rmSlotUploaded') : $('rmSlotReference')).classList.add('filled');
        renderThumbs(kind, metric);
        set_progress_idle();
        toast('Sampled ' + metric.framesSampled + ' frames from ' + metric.name + '.');
      })
      .catch(function (e) {
        set_progress_idle();
        if (kind === 'uploaded') state.uploadedFiles = null; else state.referenceFiles = null;
        toast(e.message || 'Could not analyze that file.', true);
      });

    function set_progress_idle() { setProgress('idle'); }
  }

  /* ---------------- results rendering ---------------- */
  function buildPayload(deltas, notes) {
    return {
      deltas: deltas,
      notes: (notes || '').slice(0, LIMITS.maxNotesChars),
      frames: {
        uploaded: trimFramesForRequest(state.uploaded.frames, LIMITS.requestFrameBudget),
        reference: trimFramesForRequest(state.reference.frames, LIMITS.requestFrameBudget)
      }
    };
  }

  function renderResults(numeric, llm, usedFallback) {
    $('rmResults').classList.remove('hidden');
    if (usedFallback !== false) {
      $('rmFallbackNote').classList.remove('hidden');
      $('rmFallbackNote').textContent = usedFallback === true
        ? 'AI suggestions unavailable — showing rule-based tips from the numeric comparison. You can retry in a minute.'
        : '';
    } else {
      $('rmFallbackNote').classList.add('hidden');
    }
    // summary + score
    $('rmSummary').textContent = llm && llm.summary ? llm.summary : defaultSummary(numeric);
    var score = llm && typeof llm.similarity_score === 'number' ? clamp(Math.round(llm.similarity_score), 0, 100) : heuristicScore(numeric);
    $('rmScore').textContent = score + '%';
    $('rmScoreBar').style.width = score + '%';

    // palette strip
    renderPalette('rmPaletteUploaded', state.uploaded.palette, 'Your video');
    renderPalette('rmPaletteReference', state.reference.palette, 'Reference');

    // metric table
    $('rmTable').innerHTML = metricRows(numeric.deltas, state.uploaded, state.reference);

    // suggestions
    var list = $('rmSuggestions'); list.innerHTML = '';
    (llm && Array.isArray(llm.suggestions) && llm.suggestions.length ? llm.suggestions : numeric.ruleSuggestions)
      .forEach(function (s) { list.appendChild(suggestionCard(s)); });

    // prompt
    var promptEl = $('rmPrompt');
    if (llm && llm.better_prompt) {
      promptEl.textContent = llm.better_prompt;
      // CineVoice ships a per-scene Prompt Coach (#coachPrompt inside #coachPanel).
      // When it is present, feed the suggestions/prompts into it instead of
      // relying only on clipboard copy.
      var coachPrompt = $('coachPrompt');
      var coachPanel = $('coachPanel');
      var coachBtn = $('rmSendCoach');
      if (coachPrompt && coachPanel && coachBtn) {
        coachBtn.classList.remove('hidden');
      } else {
        $('rmCopyPrompt').classList.remove('hidden');
      }
    } else {
      promptEl.textContent = '';
      $('rmCopyPrompt').classList.add('hidden');
      var sendBtn = $('rmSendCoach');
      if (sendBtn) sendBtn.classList.add('hidden');
    }
  }

  function sendToCoach() {
    var promptText = $('rmPrompt').textContent;
    var coachPrompt = $('coachPrompt');
    var coachPanel = $('coachPanel');
    if (!promptText) return;
    if (!coachPrompt || !coachPanel) {
      // Prompt Coach not loaded: degrade to clipboard copy.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(promptText).then(function () { toast('Improved prompt copied.'); }, function () { toast('Prompt Coach unavailable; copy failed.', true); });
      } else {
        toast('Prompt Coach unavailable — select the text manually.', true);
      }
      return;
    }
    coachPrompt.textContent = promptText;
    coachPanel.classList.add('open');
    var tabScene = $('coachTabScene');
    if (tabScene) tabScene.click();
    var fullContainer = $('coachFullContainer');
    var singleContainer = $('coachSingleContainer');
    if (fullContainer && singleContainer) { fullContainer.style.display = 'none'; singleContainer.style.display = 'flex'; }
    toast('Improved prompt sent to Prompt Coach.');
  }

  function defaultSummary(d) {
    var bits = [];
    bits.push('Your video is ' + d.brightnessLabel + ' and ' + d.saturationLabel + ' than the reference.');
    bits.push('White balance is ' + d.warmthDirection + '; contrast is ' + d.contrastLabel + '.');
    if (d.cutRateLabel.indexOf('same') < 0) bits.push('Cut pacing: ' + d.cutRateLabel + ' (approximate).');
    return bits.join(' ');
  }

  function heuristicScore(d) {
    // 100 = identical on every numeric axis; each large delta subtracts.
    var penalty = 0;
    [["brightnessPct", 0.9], ["contrastPct", 0.7], ["saturationPct", 0.9], ["sharpnessPct", 0.3], ["paletteDistancePct", 1.0]].forEach(function (row) {
      var v = d[row[0]];
      penalty += Math.min(35, Math.abs(v) * row[1]);
    });
    if (!d.aspectSame) penalty += 6;
    if (d.letterboxUploaded !== d.letterboxReference) penalty += 6;
    return clamp(Math.round(100 - penalty), 0, 99);
  }

  function renderPalette(id, palette, label) {
    var box = $(id);
    box.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'rm-palette-strip';
    (palette.length ? palette : [[34, 34, 34, 1]]).forEach(function (c) {
      var sw = document.createElement('span');
      sw.style.background = 'rgb(' + c.map(function (v) { return clamp(Math.round(v), 0, 255); }).slice(0, 3).join(',') + ')';
      sw.title = 'rgb(' + c.map(function (v) { return clamp(Math.round(v), 0, 255); }).slice(0, 3).join(', ') + ')';
      div.appendChild(sw);
    });
    box.appendChild(div);
  }

  function metricRows(d, u, r) {
    function tr(cells) {
      return '<tr><td>' + cells[0] + '</td><td>' + cells[1] + '</td><td>' + cells[2] + '</td><td>' + cells[3] + '</td></tr>';
    }
    var rows = '';
    rows += tr(['Brightness', u.brightness.mean, r.brightness.mean, d.brightnessLabel]);
    rows += tr(['Contrast (spread)', u.brightness.spread, r.brightness.spread, d.contrastLabel]);
    rows += tr(['Crushed shadows', u.brightness.crushedPercent + '%', r.brightness.crushedPercent + '%', signedPP(d.crushedPctPoints)]);
    rows += tr(['Clipped highlights', u.brightness.clippedPercent + '%', r.brightness.clippedPercent + '%', signedPP(d.clippedPctPoints)]);
    rows += tr(['Warmth (R/B)', u.warmth.rbRatio + ' (' + u.warmth.label + ')', r.warmth.rbRatio + ' (' + r.warmth.label + ')', d.warmthDirection]);
    rows += tr(['Saturation', u.saturation.mean, r.saturation.mean, d.saturationLabel]);
    rows += tr(['Shadow tint', tintLabel(u.tint.shadows), tintLabel(r.tint.shadows), signedRB(d.shadowTintDiff) + ' band']);
    rows += tr(['Highlight tint', tintLabel(u.tint.highlights), tintLabel(r.tint.highlights), signedRB(d.highlightTintDiff) + ' band']);
    rows += tr(['Palette distance', '—', '—', d.paletteDistancePct > 0 ? d.paletteDistancePct + '%' : 'similar']);
    rows += tr(['Cut rate (approx.)', u.motion.cutRate + '/s', r.motion.cutRate + '/s', d.cutRateLabel]);
    rows += tr(['Sharpness', u.sharpness, r.sharpness, d.sharpnessLabel]);
    rows += tr(['Letterbox', u.letterboxPercent + '%', r.letterboxPercent + '%', d.letterboxUploaded === d.letterboxReference ? 'same' : (d.letterboxDiff > 0 ? 'more bars' : 'fewer bars')]);
    rows += tr(['Aspect', u.aspect.label, r.aspect.label, d.aspectSame ? 'same' : 'different']);
    return rows;
  }

  function signedPP(points) {
    var p = Math.round(Math.abs(points));
    if (p < 1) return 'same';
    return (points < 0 ? p + 'pp less' : p + 'pp more');
  }
  function signedRB(diff) {
    var v = Math.round(Math.abs(diff) * 100);
    if (v < 4) return 'similar';
    return (diff < 0 ? v + '% teal-shifted' : v + '% orange-shifted');
  }
  function tintLabel(v) {
    var t = Math.round(Math.abs(v) * 100);
    if (t < 4) return 'neutral';
    return (v < 0 ? 'teal ' : 'orange ') + t + '%';
  }

  function suggestionCard(s) {
    var card = document.createElement('div');
    card.className = 'rm-card rm-priority-' + (s.priority || 'low');
    var cat = document.createElement('span');
    cat.className = 'rm-chip';
    cat.textContent = s.category || 'look';
    var pr = document.createElement('span');
    pr.className = 'rm-chip rm-priority';
    pr.textContent = s.priority || 'low';
    var head = document.createElement('div');
    head.className = 'rm-card-head';
    head.append(cat, pr);
    if (s.timestamp) {
      var ts = document.createElement('button');
      ts.className = 'rm-chip rm-ts';
      ts.textContent = '▶ ' + s.timestamp;
      ts.title = 'Seek your video to this moment';
      ts.onclick = function () { seekUploaded(s.timestamp); };
      ts.type = 'button';
      head.append(ts);
    }
    card.append(head);
    var issue = document.createElement('strong'); issue.textContent = s.issue || '';
    var fix = document.createElement('p'); fix.textContent = s.fix || '';
    card.append(issue, fix);
    return card;
  }

  function seekUploaded(timeStr) {
    var player = root.document ? root.document.getElementById('mainVideoPlayer') : null;
    if (!player) { toast('Load your video in the studio player first.', true); return; }
    var parts = String(timeStr).split(':').map(Number);
    var t = 0;
    parts.forEach(function (p) { t = t * 60 + (isFinite(p) ? p : 0); });
    try { player.currentTime = t; player.play().catch(function () {}); toast('Seeked to ' + timeStr + '.'); }
    catch (e) { toast('Could not seek that timestamp.', true); }
  }

  /* ------------------------------------------------------------
     Compare orchestration
     ------------------------------------------------------------ */
  function compare() {
    if (state.busy) return;
    if (!state.uploaded || !state.reference) {
      toast('Sample both a video and a reference first.', true);
      return;
    }
    if (!state.uploaded.frames.length || !state.reference.frames.length) {
      toast('Frame samples are missing — re-add the files.', true);
      return;
    }
    state.busy = true;
    $('rmCompareBtn').disabled = true;
    var deltas = computeDeltas(state.uploaded, state.reference);
    var numeric = { deltas: deltas, ruleSuggestions: ruleSuggestions(deltas) };
    setProgress('generating');
    requestSuggestions(buildPayload(deltas, ($('rmNotes') || {}).value))
      .then(function (res) {
        if (res.body && res.body.ok && res.body.result) {
          set_progress_done();
          renderResults(numeric, res.body.result, false);
        } else {
          var friendly = friendlyApiError(res.status, res.body);
          set_progress_done();
          renderResults(numeric, null, true);
          toast(friendly, true);
        }
      })
      .catch(function () {
        set_progress_done();
        renderResults(numeric, null, true);
        toast('Could not reach the AI route — showing the numeric comparison and rule-based tips.', true);
      });

    function set_progress_done() { state.busy = false; $('rmCompareBtn').disabled = false; setProgress('idle'); }
  }

  function friendlyApiError(status, body) {
    if (status === 429) return 'Free-tier rate limit hit. The numeric comparison is below — retry in about a minute.';
    if (status === 403) return 'The AI route rejected the request. Check the configured API key.';
    if (body && body.error) return body.error;
    return 'AI suggestions are unavailable right now.';
  }

  /* ------------------------------------------------------------
     Init
     ------------------------------------------------------------ */
  function init() {
    if (!$('rmCompareBtn')) return; // studio page without the panel
    var up = $('rmUploadedInput'), ref = $('rmReferenceInput');
    up.addEventListener('change', function (e) { handleFiles('uploaded', e.target.files); });
    ref.addEventListener('change', function (e) { handleFiles('reference', e.target.files); });
    $('rmCompareBtn').addEventListener('click', compare);
    var sendCoachBtn = $('rmSendCoach');
    if (sendCoachBtn) sendCoachBtn.addEventListener('click', sendToCoach);
    $('rmCopyPrompt').addEventListener('click', function () {
      var text = $('rmPrompt').textContent;
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Improved prompt copied.'); }, function () { toast('Copy failed — select the text manually.', true); });
      } else {
        toast('Clipboard unavailable — select the text manually.', true);
      }
    });
  }

  /* ------------------------------------------------------------
     Exports (pure helpers for tests)
     ------------------------------------------------------------ */
  var api = {
    LIMITS: LIMITS,
    clamp: clamp,
    signedPct: signedPct,
    pctDelta: pctDelta,
    deltaLabel: deltaLabel,
    computeDeltas: computeDeltas,
    paletteDistance: paletteDistance,
    ruleSuggestions: ruleSuggestions,
    aspectOf: aspectOf,
    warmthLabel: warmthLabel,
    medianCutPalette: medianCutPalette
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
  root.CineVoiceReferenceMatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
