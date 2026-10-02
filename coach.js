// coach.js — Prompt Coach for AI Video Generation (Veo, Runway, Sora, Luma)
// Vanilla JS, no build step. Added via <script src="coach.js"></script>.
(function () {
  'use strict';

  /* ================================================================== */
  /*  Helper Utilities                                                  */
  /* ================================================================== */
  function formatTime(sec) {
    var s = Math.max(0, parseFloat(sec) || 0);
    var m = Math.floor(s / 60);
    var remainder = Math.floor(s % 60);
    return String(m).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
  }

  function toast(msg) {
    var t = document.getElementById('studioToast');
    var tm = document.getElementById('toastMsg');
    if (!t || !tm) return;
    tm.textContent = msg;
    var icon = document.getElementById('toastIcon');
    if (icon) icon.textContent = '🎬';
    t.classList.add('show');
    t.style.opacity = '1';
    clearTimeout(t._hide);
    t._hide = setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { t.classList.remove('show'); }, 350);
    }, 3000);
  }

  /* ================================================================== */
  /*  Inject Styles for the Prompt Coach UI                             */
  /* ================================================================== */
  var STYLES = document.createElement('style');
  STYLES.textContent =
    '#coachPanel {' +
      'position: fixed;' +
      'top: 50%;' +
      'left: 50%;' +
      'transform: translate(-50%, -50%);' +
      'z-index: 10000;' +
      'width: min(calc(100vw - 24px), 480px);' +
      'max-height: 88vh;' +
      'overflow-y: auto;' +
      'box-sizing: border-box;' +
      'background: #07090c;' +
      'border: 1px solid rgba(212, 167, 58, 0.45);' +
      'border-radius: 16px;' +
      'padding: 1.15rem 1.25rem;' +
      'box-shadow: 0 25px 65px rgba(0, 0, 0, 0.95), 0 0 40px rgba(212, 167, 58, 0.18);' +
      'color: #f1f5f9;' +
      'font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
      'display: none;' +
      'flex-direction: column;' +
      'gap: 0.8rem;' +
      'backdrop-filter: blur(20px);' +
      '-webkit-backdrop-filter: blur(20px);' +
      'animation: coachFadeIn 0.22s ease-out;' +
    '}' +
    '#coachPanel.open {' +
      'display: flex;' +
    '}' +
    '@keyframes coachFadeIn {' +
      'from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }' +
      'to { opacity: 1; transform: translate(-50%, -50%) scale(1); }' +
    '}' +
    '.coach-header {' +
      'display: flex;' +
      'justify-content: space-between;' +
      'align-items: center;' +
      'border-bottom: 1px solid rgba(255, 255, 255, 0.08);' +
      'padding-bottom: 0.65rem;' +
    '}' +
    '.coach-title {' +
      'font-family: "Cinzel", Georgia, serif;' +
      'font-size: 0.95rem;' +
      'font-weight: 700;' +
      'letter-spacing: 0.08em;' +
      'color: #ffffff;' +
      'display: flex;' +
      'align-items: center;' +
      'gap: 0.5rem;' +
    '}' +
    '.coach-title span {' +
      'color: #d4a73a;' +
    '}' +
    '.coach-close {' +
      'background: rgba(255, 255, 255, 0.06);' +
      'border: 1px solid rgba(255, 255, 255, 0.12);' +
      'color: #94a3b8;' +
      'cursor: pointer;' +
      'width: 28px;' +
      'height: 28px;' +
      'border-radius: 50%;' +
      'display: flex;' +
      'align-items: center;' +
      'justify-content: center;' +
      'font-size: 0.85rem;' +
      'transition: all 0.2s;' +
    '}' +
    '.coach-close:hover {' +
      'background: rgba(239, 68, 68, 0.2);' +
      'border-color: rgba(239, 68, 68, 0.4);' +
      'color: #fca5a5;' +
    '}' +
    '.coach-meta-bar {' +
      'display: flex;' +
      'align-items: center;' +
      'justify-content: space-between;' +
      'flex-wrap: wrap;' +
      'gap: 0.5rem;' +
    '}' +
    '.coach-timestamps {' +
      'font-family: "JetBrains Mono", monospace;' +
      'font-size: 0.82rem;' +
      'color: #d4a73a;' +
      'letter-spacing: 0.05em;' +
      'font-weight: 600;' +
    '}' +
    '.coach-offline-badge {' +
      'font-family: "JetBrains Mono", monospace;' +
      'font-size: 0.62rem;' +
      'letter-spacing: 0.08em;' +
      'color: #f59e0b;' +
      'background: rgba(245, 158, 11, 0.15);' +
      'border: 1px solid rgba(245, 158, 11, 0.35);' +
      'padding: 0.18rem 0.55rem;' +
      'border-radius: 9999px;' +
      'display: inline-block;' +
      'text-transform: uppercase;' +
    '}' +
    '.coach-section {' +
      'display: flex;' +
      'flex-direction: column;' +
      'gap: 0.25rem;' +
    '}' +
    '.coach-section-label {' +
      'font-family: "JetBrains Mono", monospace;' +
      'font-size: 0.65rem;' +
      'letter-spacing: 0.1em;' +
      'color: #94a3b8;' +
      'text-transform: uppercase;' +
    '}' +
    '.coach-weakness-list {' +
      'display: flex;' +
      'flex-direction: column;' +
      'gap: 0.35rem;' +
      'padding-left: 1.1rem;' +
      'margin: 0;' +
    '}' +
    '.coach-weakness-list li {' +
      'font-size: 0.82rem;' +
      'color: #fbbf24;' +
      'line-height: 1.4;' +
    '}' +
    '.coach-weakness-list li::marker {' +
      'color: #d4a73a;' +
    '}' +
    '.coach-prompt-box {' +
      'background: rgba(18, 23, 31, 0.85);' +
      'border: 1px solid rgba(212, 167, 58, 0.25);' +
      'border-radius: 10px;' +
      'padding: 0.85rem 1rem;' +
      'font-size: 0.84rem;' +
      'line-height: 1.55;' +
      'color: #f1f5f9;' +
      'user-select: text;' +
      '-webkit-user-select: text;' +
      'white-space: pre-wrap;' +
      'word-break: break-word;' +
    '}' +
    '.coach-negative-box {' +
      'background: rgba(30, 15, 15, 0.6);' +
      'border: 1px solid rgba(239, 68, 68, 0.25);' +
      'border-radius: 10px;' +
      'padding: 0.75rem 1rem;' +
      'font-size: 0.8rem;' +
      'line-height: 1.45;' +
      'color: #fca5a5;' +
      'user-select: text;' +
      '-webkit-user-select: text;' +
      'word-break: break-word;' +
    '}' +
    '.coach-tip {' +
      'background: rgba(56, 189, 248, 0.08);' +
      'border: 1px solid rgba(56, 189, 248, 0.22);' +
      'border-radius: 10px;' +
      'padding: 0.7rem 1rem;' +
      'font-size: 0.8rem;' +
      'line-height: 1.45;' +
      'color: #7dd3fc;' +
      'user-select: text;' +
      '-webkit-user-select: text;' +
      'word-break: break-word;' +
    '}' +
    '.coach-btn-row {' +
      'display: flex;' +
      'gap: 0.6rem;' +
      'flex-wrap: wrap;' +
      'margin-top: 0.25rem;' +
    '}' +
    '.coach-btn {' +
      'background: #d4a73a;' +
      'border: 1px solid #d4a73a;' +
      'color: #07090c;' +
      'padding: 0.5rem 1.1rem;' +
      'border-radius: 9999px;' +
      'font-size: 0.8rem;' +
      'font-weight: 700;' +
      'cursor: pointer;' +
      'transition: all 0.2s;' +
      'display: inline-flex;' +
      'align-items: center;' +
      'gap: 0.4rem;' +
      'font-family: inherit;' +
    '}' +
    '.coach-btn:hover {' +
      'background: #e5b364;' +
      'box-shadow: 0 0 16px rgba(212, 167, 58, 0.4);' +
    '}' +
    '.coach-btn-secondary {' +
      'background: rgba(255, 255, 255, 0.06);' +
      'border: 1px solid rgba(255, 255, 255, 0.15);' +
      'color: #94a3b8;' +
    '}' +
    '.coach-btn-secondary:hover {' +
      'background: rgba(255, 255, 255, 0.14);' +
      'color: #ffffff;' +
    '}' +
    '.coach-spinner {' +
      'display: inline-block;' +
      'width: 16px;' +
      'height: 16px;' +
      'border: 2px solid rgba(212, 167, 58, 0.3);' +
      'border-top-color: #d4a73a;' +
      'border-radius: 50%;' +
      'animation: coachSpin 0.7s linear infinite;' +
    '}' +
    '@keyframes coachSpin {' +
      'to { transform: rotate(360deg); }' +
    '}' +
    '#coachLaunchBtn {' +
      'background: rgba(212, 167, 58, 0.14);' +
      'border: 1px solid rgba(212, 167, 58, 0.4);' +
      'color: #d4a73a;' +
      'padding: 0.35rem 0.85rem;' +
      'border-radius: 9999px;' +
      'font-size: 0.74rem;' +
      'font-weight: 600;' +
      'cursor: pointer;' +
      'transition: all 0.2s;' +
      'display: inline-flex;' +
      'align-items: center;' +
      'gap: 0.35rem;' +
      'font-family: "Inter", sans-serif;' +
      'letter-spacing: 0.02em;' +
    '}' +
    '#coachLaunchBtn:hover {' +
      'background: rgba(212, 167, 58, 0.28);' +
      'box-shadow: 0 0 14px rgba(212, 167, 58, 0.35);' +
      'color: #fff;' +
    '}' +
    '#coachLaunchBtn:disabled {' +
      'opacity: 0.45;' +
      'cursor: not-allowed;' +
    '}' +
    '#coachPanel::-webkit-scrollbar {' +
      'width: 5px;' +
    '}' +
    '#coachPanel::-webkit-scrollbar-track {' +
      'background: rgba(255, 255, 255, 0.03);' +
      'border-radius: 3px;' +
    '}' +
    '#coachPanel::-webkit-scrollbar-thumb {' +
      'background: rgba(212, 167, 58, 0.4);' +
      'border-radius: 3px;' +
    '}' +
    '@media (max-width: 420px) {' +
      '#coachPanel {' +
        'width: calc(100vw - 16px);' +
        'padding: 1rem 0.9rem;' +
        'gap: 0.65rem;' +
      '}' +
      '.coach-prompt-box {' +
        'font-size: 0.8rem;' +
        'padding: 0.75rem;' +
      '}' +
    '}';
  document.head.appendChild(STYLES);

  /* ================================================================== */
  /*  Build Floating Panel DOM Structure                                */
  /* ================================================================== */
  var panel = document.createElement('div');
  panel.id = 'coachPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Prompt Coach Panel');

  panel.innerHTML =
    '<div class="coach-header">' +
      '<div class="coach-title"><span>🎬</span> PROMPT COACH</div>' +
      '<button class="coach-close" id="coachCloseBtn" title="Close Prompt Coach (Esc)">✕</button>' +
    '</div>' +
    '<div class="coach-meta-bar">' +
      '<div class="coach-timestamps" id="coachTimestamps"></div>' +
      '<div id="coachBadgeContainer"></div>' +
    '</div>' +
    '<div class="coach-section" id="coachWeaknessSection">' +
      '<div class="coach-section-label">Weaknesses</div>' +
      '<ul class="coach-weakness-list" id="coachWeaknesses"></ul>' +
    '</div>' +
    '<div class="coach-section">' +
      '<div class="coach-section-label">Improved Prompt</div>' +
      '<div class="coach-prompt-box" id="coachPrompt"></div>' +
    '</div>' +
    '<div class="coach-section" id="coachNegativeSection">' +
      '<div class="coach-section-label">What to Avoid</div>' +
      '<div class="coach-negative-box" id="coachNegative"></div>' +
    '</div>' +
    '<div class="coach-section" id="coachTipSection">' +
      '<div class="coach-section-label">Camera Tip</div>' +
      '<div class="coach-tip" id="coachTip"></div>' +
    '</div>' +
    '<div class="coach-btn-row">' +
      '<button class="coach-btn" id="coachCopyBtn">📋 Copy Prompt</button>' +
      '<button class="coach-btn coach-btn-secondary" id="coachRegenBtn">🔄 Re-analyze</button>' +
    '</div>';

  document.body.appendChild(panel);

  /* DOM references */
  var timestampsEl = document.getElementById('coachTimestamps');
  var badgeContainerEl = document.getElementById('coachBadgeContainer');
  var weaknessSectionEl = document.getElementById('coachWeaknessSection');
  var weaknessesEl = document.getElementById('coachWeaknesses');
  var promptEl = document.getElementById('coachPrompt');
  var negativeSectionEl = document.getElementById('coachNegativeSection');
  var negativeEl = document.getElementById('coachNegative');
  var tipSectionEl = document.getElementById('coachTipSection');
  var tipEl = document.getElementById('coachTip');
  var copyBtn = document.getElementById('coachCopyBtn');
  var regenBtn = document.getElementById('coachRegenBtn');

  /* ================================================================== */
  /*  Inject "Coach" Button into Player Control Bar                     */
  /* ================================================================== */
  function injectCoachButton() {
    if (document.getElementById('coachLaunchBtn')) return;
    var controlRow = document.querySelector('.control-row');
    if (!controlRow) {
      setTimeout(injectCoachButton, 500);
      return;
    }
    var btn = document.createElement('button');
    btn.id = 'coachLaunchBtn';
    btn.innerHTML = '🎬 Coach';
    btn.title = 'Analyze current scene and suggest an improved AI video prompt';
    var tools = controlRow.querySelector('.playback-tools');
    if (tools) tools.after(btn);
    else controlRow.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCoachButton);
  } else {
    injectCoachButton();
  }

  /* ================================================================== */
  /*  Robust Seek Helper with Timeout Guard                             */
  /* ================================================================== */
  function seekTo(videoEl, targetTime) {
    return new Promise(function (resolve) {
      var clamped = Math.max(0, Math.min(videoEl.duration || targetTime, targetTime));
      if (Math.abs(videoEl.currentTime - clamped) < 0.04) {
        resolve();
        return;
      }
      var completed = false;
      function onSeeked() {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutId);
        videoEl.removeEventListener('seeked', onSeeked);
        resolve();
      }
      var timeoutId = setTimeout(onSeeked, 1400); // 1.4s safety limit per seek
      videoEl.addEventListener('seeked', onSeeked, { once: true });
      try {
        videoEl.currentTime = clamped;
      } catch (err) {
        onSeeked();
      }
    });
  }

  /* ================================================================== */
  /*  Sample Frames every 0.5s from -8s to +8s on Hidden Video Clone    */
  /* ================================================================== */
  function sampleFrames(hiddenVideo, startT, endT, step) {
    return new Promise(function (resolve) {
      var results = [];
      var canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 18;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var prevGrays = null;

      var times = [];
      for (var t = startT; t <= endT + 0.001; t += step) {
        times.push(parseFloat(t.toFixed(2)));
      }

      var index = 0;

      function sampleNext() {
        if (index >= times.length) {
          resolve(results);
          return;
        }

        var t = times[index];
        seekTo(hiddenVideo, t).then(function () {
          try {
            ctx.drawImage(hiddenVideo, 0, 0, 32, 18);
            var imgData = ctx.getImageData(0, 0, 32, 18).data;
            var grays = new Float32Array(32 * 18);
            var bSum = 0;

            for (var p = 0, k = 0; p < imgData.length; p += 4, k++) {
              // ITU-R BT.601 standard grayscale conversion: 0.299R + 0.587G + 0.114B
              var g = (0.299 * imgData[p] + 0.587 * imgData[p + 1] + 0.114 * imgData[p + 2]) / 255;
              grays[k] = g;
              bSum += g;
            }

            var brightness = bSum / (32 * 18); // 0 to 1
            var delta = 0;

            if (prevGrays) {
              var diffSum = 0;
              for (var j = 0; j < 32 * 18; j++) {
                diffSum += Math.abs(grays[j] - prevGrays[j]);
              }
              delta = diffSum / (32 * 18); // average pixel difference (0 to 1)
            }

            prevGrays = grays;

            results.push({
              time: t,
              brightness: brightness,
              delta: delta
            });
          } catch (e) {
            console.warn('Frame sample error at', t, e);
          }

          index++;
          setTimeout(sampleNext, 20);
        });
      }

      sampleNext();
    });
  }

  /* ================================================================== */
  /*  Scene Boundary & Cut Detection around Center Time (Threshold ≈0.18)*/
  /* ================================================================== */
  function findSceneAround(frames, centerTime, cutThreshold) {
    if (!frames || !frames.length) {
      return { start: 0, end: 0, sceneFrames: [] };
    }

    // Mark hard cuts: frame i is a cut if delta from frame i-1 exceeds threshold
    for (var i = 1; i < frames.length; i++) {
      frames[i].isCut = frames[i].delta > cutThreshold;
    }

    var sceneStart = frames[0].time;
    var sceneEnd = frames[frames.length - 1].time;
    var cutEndIndex = -1;

    // Latest cut at or before centerTime defines the scene start
    for (var i = 1; i < frames.length; i++) {
      if (frames[i].isCut && frames[i].time <= centerTime && frames[i].time > sceneStart) {
        sceneStart = frames[i].time;
      }
    }

    // Earliest cut strictly after centerTime defines where next scene begins
    for (var i = 1; i < frames.length; i++) {
      if (frames[i].isCut && frames[i].time > centerTime) {
        sceneEnd = frames[i].time;
        cutEndIndex = i;
        break;
      }
    }

    // Current scene frames: from sceneStart up to right before the next cut
    var sceneFrames = frames.filter(function (f) {
      return f.time >= sceneStart && (cutEndIndex > -1 ? f.time < sceneEnd : f.time <= sceneEnd);
    });

    if (!sceneFrames.length) {
      sceneFrames = frames.filter(function (f) {
        return f.time >= sceneStart && f.time <= sceneEnd;
      });
    }

    return {
      start: sceneStart,
      end: sceneEnd,
      sceneFrames: sceneFrames
    };
  }

  /* ================================================================== */
  /*  Compute Average Brightness and Motion (0-1) for the Scene         */
  /* ================================================================== */
  function computeStats(sceneFrames) {
    if (!sceneFrames || !sceneFrames.length) {
      return { brightness: 0.5, motion: 0.1 };
    }
    var bSum = 0;
    var mSum = 0;
    var mCount = 0;

    for (var i = 0; i < sceneFrames.length; i++) {
      bSum += sceneFrames[i].brightness;
      // Intra-scene motion ignores the boundary cut of the first frame
      if (i > 0) {
        mSum += sceneFrames[i].delta;
        mCount++;
      }
    }

    return {
      brightness: Math.min(1, Math.max(0, bSum / sceneFrames.length)),
      motion: Math.min(1, Math.max(0, mCount > 0 ? (mSum / mCount) : 0))
    };
  }

  /* ================================================================== */
  /*  Capture 512px-wide JPEG Keyframe (Sequential, No Concurrency Race)*/
  /* ================================================================== */
  function captureKeyframe(videoEl, t) {
    return seekTo(videoEl, t).then(function () {
      var vw = videoEl.videoWidth || 640;
      var vh = videoEl.videoHeight || 360;
      var targetWidth = 512;
      var targetHeight = Math.max(1, Math.round(vh * (targetWidth / vw)));

      var c = document.createElement('canvas');
      c.width = targetWidth;
      c.height = targetHeight;
      var ctx = c.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight);
      return c.toDataURL('image/jpeg', 0.85);
    });
  }

  function captureThreeKeyframes(videoEl, times) {
    return captureKeyframe(videoEl, times[0]).then(function (img1) {
      return captureKeyframe(videoEl, times[1]).then(function (img2) {
        return captureKeyframe(videoEl, times[2]).then(function (img3) {
          return [img1, img2, img3];
        });
      });
    });
  }

  /* ================================================================== */
  /*  Client-side Rule-based Fallback in case of Network/API Outage    */
  /* ================================================================== */
  function localRuleBasedPrompt(brightness, motion, start, end) {
    var dur = Math.max(1, Math.round((end || 8) - (start || 0)));
    var bPct = Math.round(brightness * 100);
    var mPct = Math.round(motion * 100);

    var lighting = 'balanced cinematic natural lighting';
    var lightWeakness = null;
    if (brightness < 0.22) {
      lighting = 'moody low-key dramatic lighting, subtle rim lighting, deep contrast';
      lightWeakness = 'Under-exposed: shadow details are crushed and subject lacks definition';
    } else if (brightness < 0.45) {
      lighting = 'soft diffused atmospheric ambient lighting with gentle falloff';
    } else if (brightness > 0.75) {
      lighting = 'bright controlled high-key daylight with soft highlight diffusion';
      lightWeakness = 'Over-exposed: highlights are washed out with risk of blown-out clipping';
    }

    var camera = 'subtle slow push-in, 35mm anamorphic prime lens, f/2.0';
    var action = 'composed character movement';
    var motionWeakness = null;

    if (motion < 0.04) {
      camera = 'slow cinematic creeping push-in on 50mm prime, stable lock-off';
      action = 'focused stillness with subtle atmospheric drift';
      motionWeakness = 'Static scene: lacks dynamic focal movement or environmental tension';
    } else if (motion <= 0.16) {
      camera = 'smooth steadycam tracking shot, 35mm lens, f/2.8';
      action = 'measured deliberate character movement';
    } else if (motion <= 0.38) {
      camera = 'dynamic handheld camera tracking with organic micro-sway, 28mm lens';
      action = 'active character motion through the environment';
    } else {
      camera = 'kinetic gimbal pursuit tracking with motion-blur compensation, 24mm wide angle lens';
      action = 'fast-paced action and rapid subject repositioning';
      motionWeakness = 'Excessive motion: risk of visual jitter and temporal warping artifacts';
    }

    var weaknesses = [];
    if (lightWeakness) weaknesses.push(lightWeakness);
    if (motionWeakness) weaknesses.push(motionWeakness);
    if (weaknesses.length === 0) {
      weaknesses.push('Compositional framing could feature sharper depth-of-field separation');
    }
    if (weaknesses.length < 2) {
      weaknesses.push('Lighting contrast could be shaped with stronger key-to-fill ratio');
    }

    return {
      scene_summary: 'Scene from ' + formatTime(start) + ' to ' + formatTime(end) + ' (' + bPct + '% brightness, ' + mPct + '% motion).',
      weaknesses: weaknesses.slice(0, 3),
      improved_prompt: action + ', cinematic film setting, ' + camera + ', ' + lighting + ', 35mm film grain, rich color grade, 24fps, shallow depth of field. Duration ' + dur + 's.',
      negative_prompt: 'jittery camera, flickering, motion smear, blown out highlights, muddy crushed shadows, cartoonish textures, warped anatomy.',
      camera_tip: 'Scene brightness ' + bPct + '%, motion ' + mPct + '%. Use ' + (motion > 0.2 ? 'a gimbal stabilizer and 1/50s shutter speed' : 'a stable dolly push-in with 50mm f/2.0 lens') + ' to maximize temporal coherence.',
      is_offline: true,
      offline_mode: true
    };
  }

  /* ================================================================== */
  /*  POST Keyframes & Stats to /api/coach                              */
  /* ================================================================== */
  function callCoachAPI(images, stats, start, end) {
    return fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: images,
        brightness: stats.brightness,
        motion: stats.motion,
        start: start,
        end: end
      })
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return { error: 'Status ' + r.status }; }).then(function (err) {
          throw new Error(err.error || 'Server error ' + r.status);
        });
      }
      return r.json();
    });
  }

  /* ================================================================== */
  /*  Main Scene Analysis Pipeline                                      */
  /* ================================================================== */
  var isAnalyzing = false;
  var lastAnalyzedTime = -1;

  function renderCoachResult(result, scene) {
    var isOffline = !!(result.is_offline || result.offline_mode);

    // Timestamps mm:ss
    timestampsEl.textContent = '📽️ ' + formatTime(scene.start) + ' – ' + formatTime(scene.end);

    // Badge
    badgeContainerEl.innerHTML = '';
    if (isOffline) {
      var badge = document.createElement('span');
      badge.className = 'coach-offline-badge';
      badge.textContent = '⚡ OFFLINE MODE';
      badgeContainerEl.appendChild(badge);
    }

    // Weaknesses (XSS safe via textContent)
    weaknessesEl.innerHTML = '';
    var wList = Array.isArray(result.weaknesses) ? result.weaknesses : [];
    if (wList.length > 0) {
      wList.forEach(function (w) {
        var li = document.createElement('li');
        li.textContent = String(w);
        weaknessesEl.appendChild(li);
      });
      weaknessSectionEl.style.display = 'flex';
    } else {
      var liNone = document.createElement('li');
      liNone.textContent = 'Visual balance and framing look strong.';
      liNone.style.color = '#94a3b8';
      weaknessesEl.appendChild(liNone);
      weaknessSectionEl.style.display = 'flex';
    }

    // Improved prompt (XSS safe)
    promptEl.textContent = String(result.improved_prompt || '—');

    // What to avoid (XSS safe)
    if (result.negative_prompt) {
      negativeEl.textContent = String(result.negative_prompt);
      negativeSectionEl.style.display = 'flex';
    } else {
      negativeSectionEl.style.display = 'none';
    }

    // Camera tip (XSS safe)
    if (result.camera_tip) {
      tipEl.textContent = String(result.camera_tip);
      tipSectionEl.style.display = 'flex';
    } else {
      tipSectionEl.style.display = 'none';
    }

    copyBtn.style.display = 'inline-flex';
    regenBtn.style.display = 'inline-flex';
  }

  function analyzeScene(isManualClick) {
    if (isAnalyzing) return;
    var mainVideo = document.getElementById('mainVideoPlayer');
    if (!mainVideo || !mainVideo.duration || mainVideo.readyState < 2) {
      if (isManualClick) {
        toast('Load a video first before using Prompt Coach.');
      }
      return;
    }

    var currentTime = mainVideo.currentTime;
    lastAnalyzedTime = currentTime;
    isAnalyzing = true;

    var launchBtn = document.getElementById('coachLaunchBtn');
    if (launchBtn) launchBtn.disabled = true;

    // Show panel in loading state
    panel.classList.add('open');
    timestampsEl.textContent = 'Analyzing scene around ' + formatTime(currentTime) + '...';
    badgeContainerEl.innerHTML = '';
    weaknessesEl.innerHTML = '';
    promptEl.innerHTML = '<span class="coach-spinner"></span> Scanning frames & generating prompt...';
    negativeEl.textContent = '';
    tipEl.textContent = '';
    copyBtn.style.display = 'none';
    regenBtn.style.display = 'none';

    // Create hidden video element with identical source
    var hiddenVideo = document.createElement('video');
    hiddenVideo.preload = 'auto';
    hiddenVideo.muted = true;
    hiddenVideo.playsInline = true;
    hiddenVideo.crossOrigin = 'anonymous';
    hiddenVideo.style.position = 'fixed';
    hiddenVideo.style.top = '-9999px';
    hiddenVideo.style.left = '-9999px';
    hiddenVideo.style.width = '1px';
    hiddenVideo.style.height = '1px';
    hiddenVideo.style.opacity = '0';
    hiddenVideo.style.pointerEvents = 'none';

    var currentSource = mainVideo.currentSrc || mainVideo.src;
    hiddenVideo.src = currentSource;

    var cleanedUp = false;
    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      isAnalyzing = false;
      if (launchBtn) launchBtn.disabled = false;
      try { hiddenVideo.remove(); } catch (_) {}
    }

    function startProcessing() {
      var T = Math.max(0, currentTime);
      var halfWindow = 8;
      var startT = Math.max(0, T - halfWindow);
      var endT = Math.min(hiddenVideo.duration, T + halfWindow);

      // If near beginning, shift window forward
      if (T < halfWindow) {
        endT = Math.min(hiddenVideo.duration, T + halfWindow + (halfWindow - T));
      }

      var step = 0.5;

      sampleFrames(hiddenVideo, startT, endT, step)
        .then(function (frames) {
          if (!frames || !frames.length) {
            throw new Error('Could not sample frames from video.');
          }

          var scene = findSceneAround(frames, T, 0.18);
          var sceneFrames = scene.sceneFrames;

          if (!sceneFrames.length) {
            scene.start = frames[0].time;
            scene.end = frames[frames.length - 1].time;
            sceneFrames = frames;
            scene.sceneFrames = frames;
          }

          var stats = computeStats(sceneFrames);

          // Select 3 keyframe timestamps: start, middle, end
          var tStart = sceneFrames[0].time;
          var tMid = sceneFrames[Math.floor(sceneFrames.length / 2)].time;
          var tEnd = sceneFrames[sceneFrames.length - 1].time;

          // Sequential capture to avoid concurrent seeking conflicts on single video
          return captureThreeKeyframes(hiddenVideo, [tStart, tMid, tEnd])
            .then(function (images) {
              return callCoachAPI(images, stats, scene.start, scene.end)
                .catch(function (err) {
                  console.warn('API call failed, switching to local offline fallback:', err);
                  return localRuleBasedPrompt(stats.brightness, stats.motion, scene.start, scene.end);
                })
                .then(function (result) {
                  return { result: result, scene: scene };
                });
            });
        })
        .then(function (data) {
          cleanup();
          renderCoachResult(data.result, data.scene);
        })
        .catch(function (err) {
          cleanup();
          console.error('Coach analysis error:', err);
          // Fallback to local rule-based prompt even in case of sampling error
          var fallbackResult = localRuleBasedPrompt(0.5, 0.1, Math.max(0, T - 2), Math.min(T + 4, 10));
          renderCoachResult(fallbackResult, { start: Math.max(0, T - 2), end: Math.min(T + 4, 10) });
        });
    }

    document.body.appendChild(hiddenVideo);

    if (hiddenVideo.readyState >= 2) {
      startProcessing();
    } else {
      hiddenVideo.addEventListener('loadeddata', startProcessing, { once: true });
      hiddenVideo.addEventListener('error', function () {
        cleanup();
        var fallbackResult = localRuleBasedPrompt(0.5, 0.1, Math.max(0, currentTime - 2), currentTime + 4);
        renderCoachResult(fallbackResult, { start: Math.max(0, currentTime - 2), end: currentTime + 4 });
      }, { once: true });
    }

    // Master safety timeout (28 seconds)
    setTimeout(function () {
      if (!cleanedUp) {
        cleanup();
        var fallbackResult = localRuleBasedPrompt(0.5, 0.1, Math.max(0, currentTime - 2), currentTime + 4);
        renderCoachResult(fallbackResult, { start: Math.max(0, currentTime - 2), end: currentTime + 4 });
      }
    }, 28000);
  }

  /* ================================================================== */
  /*  Event Listeners & Interactions                                    */
  /* ================================================================== */

  // Launch button in player controls
  document.addEventListener('click', function (e) {
    if (e.target.id === 'coachLaunchBtn' || (e.target.closest && e.target.closest('#coachLaunchBtn'))) {
      e.preventDefault();
      analyzeScene(true);
    }
  });

  // Close button
  document.getElementById('coachCloseBtn').addEventListener('click', function () {
    panel.classList.remove('open');
  });

  // Re-analyze button
  regenBtn.addEventListener('click', function () {
    analyzeScene(true);
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) {
      panel.classList.remove('open');
    }
  });

  // Copy button with clipboard fallback and visual confirmation
  copyBtn.addEventListener('click', function () {
    var text = promptEl.textContent;
    if (!text || text === '—') return;

    function onCopied() {
      copyBtn.innerHTML = '✅ Copied!';
      setTimeout(function () {
        copyBtn.innerHTML = '📋 Copy Prompt';
      }, 2000);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onCopied).catch(function () {
        fallbackCopy(text, onCopied);
      });
    } else {
      fallbackCopy(text, onCopied);
    }
  });

  function fallbackCopy(text, cb) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      cb();
    } catch (_) {}
    ta.remove();
  }

  /* ================================================================== */
  /*  Auto-trigger Analysis when Video Pauses                           */
  /* ================================================================== */
  var pauseDebounceTimer = null;

  document.addEventListener('pause', function (e) {
    if (e.target && e.target.id === 'mainVideoPlayer') {
      var v = e.target;
      if (v.ended || v.seeking || isAnalyzing) return;
      if (!v.duration || v.readyState < 2) return;

      clearTimeout(pauseDebounceTimer);
      pauseDebounceTimer = setTimeout(function () {
        if (v.paused && !v.ended && !v.seeking && !isAnalyzing) {
          // If panel is already open and still on the same time, don't needlessly re-run
          if (panel.classList.contains('open') && Math.abs(v.currentTime - lastAnalyzedTime) < 0.5) {
            return;
          }
          analyzeScene(false);
        }
      }, 600);
    }
  }, true);

  document.addEventListener('play', function (e) {
    if (e.target && e.target.id === 'mainVideoPlayer') {
      clearTimeout(pauseDebounceTimer);
    }
  }, true);

})();