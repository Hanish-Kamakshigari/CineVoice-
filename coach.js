// coach.js — Prompt Coach for AI Video Generation (Veo, Runway, Sora, Luma)
// Supports both single-scene analysis on pause/click and full-video scene-by-scene analysis with timestamps.
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
      if (cb) cb();
    } catch (_) {}
    ta.remove();
  }

  function copyText(text, onCopied) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onCopied).catch(function () {
        fallbackCopy(text, onCopied);
      });
    } else {
      fallbackCopy(text, onCopied);
    }
  }

  /* ================================================================== */
  /*  Inject Styles for Prompt Coach UI                                 */
  /* ================================================================== */
  var STYLES = document.createElement('style');
  STYLES.textContent =
    '#coachPanel {' +
      'position: fixed;' +
      'top: 50%;' +
      'left: 50%;' +
      'transform: translate(-50%, -50%);' +
      'z-index: 10000;' +
      'width: min(calc(100vw - 24px), 520px);' +
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
    '.coach-mode-tabs {' +
      'display: flex;' +
      'gap: 0.35rem;' +
      'background: rgba(255, 255, 255, 0.04);' +
      'padding: 0.25rem;' +
      'border-radius: 8px;' +
      'border: 1px solid rgba(255, 255, 255, 0.06);' +
    '}' +
    '.coach-tab {' +
      'flex: 1;' +
      'background: transparent;' +
      'border: none;' +
      'color: #94a3b8;' +
      'font-size: 0.73rem;' +
      'font-weight: 600;' +
      'padding: 0.35rem 0.6rem;' +
      'border-radius: 6px;' +
      'cursor: pointer;' +
      'transition: all 0.2s;' +
      'text-align: center;' +
      'display: flex;' +
      'align-items: center;' +
      'justify-content: center;' +
      'gap: 0.35rem;' +
      'font-family: inherit;' +
    '}' +
    '.coach-tab.active {' +
      'background: rgba(212, 167, 58, 0.2);' +
      'color: #d4a73a;' +
      'border: 1px solid rgba(212, 167, 58, 0.4);' +
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
      'gap: 0.5rem;' +
      'flex-wrap: wrap;' +
      'margin-top: 0.25rem;' +
    '}' +
    '.coach-btn {' +
      'background: #d4a73a;' +
      'border: 1px solid #d4a73a;' +
      'color: #07090c;' +
      'padding: 0.45rem 1rem;' +
      'border-radius: 9999px;' +
      'font-size: 0.78rem;' +
      'font-weight: 700;' +
      'cursor: pointer;' +
      'transition: all 0.2s;' +
      'display: inline-flex;' +
      'align-items: center;' +
      'gap: 0.35rem;' +
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
    '.coach-btn-gold-outline {' +
      'background: rgba(212, 167, 58, 0.12);' +
      'border: 1px solid rgba(212, 167, 58, 0.4);' +
      'color: #d4a73a;' +
    '}' +
    '.coach-btn-gold-outline:hover {' +
      'background: rgba(212, 167, 58, 0.25);' +
      'color: #fff;' +
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
    '/* Full Video Scenes View */' +
    '.coach-full-video-container {' +
      'display: flex;' +
      'flex-direction: column;' +
      'gap: 0.85rem;' +
    '}' +
    '.coach-film-summary-box {' +
      'background: rgba(212, 167, 58, 0.08);' +
      'border: 1px solid rgba(212, 167, 58, 0.25);' +
      'border-radius: 10px;' +
      'padding: 0.75rem 0.95rem;' +
      'font-size: 0.82rem;' +
      'color: #e5b364;' +
      'line-height: 1.45;' +
    '}' +
    '.coach-scene-card {' +
      'background: rgba(18, 23, 31, 0.75);' +
      'border: 1px solid rgba(255, 255, 255, 0.08);' +
      'border-radius: 12px;' +
      'padding: 0.9rem 1rem;' +
      'display: flex;' +
      'flex-direction: column;' +
      'gap: 0.6rem;' +
      'transition: border-color 0.2s;' +
    '}' +
    '.coach-scene-card:hover {' +
      'border-color: rgba(212, 167, 58, 0.35);' +
    '}' +
    '.coach-scene-card-header {' +
      'display: flex;' +
      'justify-content: space-between;' +
      'align-items: center;' +
      'flex-wrap: wrap;' +
      'gap: 0.4rem;' +
      'border-bottom: 1px solid rgba(255, 255, 255, 0.06);' +
      'padding-bottom: 0.45rem;' +
    '}' +
    '.coach-scene-badge {' +
      'font-family: "JetBrains Mono", monospace;' +
      'font-size: 0.8rem;' +
      'color: #d4a73a;' +
      'font-weight: 700;' +
      'cursor: pointer;' +
      'text-decoration: underline;' +
      'text-underline-offset: 3px;' +
    '}' +
    '.coach-scene-badge:hover {' +
      'color: #fff;' +
    '}' +
    '.coach-copy-sm-btn {' +
      'background: rgba(212, 167, 58, 0.15);' +
      'border: 1px solid rgba(212, 167, 58, 0.35);' +
      'color: #d4a73a;' +
      'font-size: 0.72rem;' +
      'padding: 0.25rem 0.6rem;' +
      'border-radius: 6px;' +
      'cursor: pointer;' +
      'font-weight: 600;' +
      'transition: all 0.15s;' +
    '}' +
    '.coach-copy-sm-btn:hover {' +
      'background: #d4a73a;' +
      'color: #07090c;' +
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
    '<div class="coach-mode-tabs">' +
      '<button class="coach-tab active" id="coachTabScene">📍 Current Scene</button>' +
      '<button class="coach-tab" id="coachTabFull">🎞️ Entire Video (Full Film)</button>' +
    '</div>' +
    '<!-- Single Scene Container -->' +
    '<div id="coachSingleContainer" style="display:flex; flex-direction:column; gap:0.75rem;">' +
      '<div class="coach-meta-bar">' +
        '<div class="coach-timestamps" id="coachTimestamps"></div>' +
        '<div id="coachBadgeContainer"></div>' +
      '</div>' +
      '<div class="coach-section" id="coachWeaknessSection">' +
        '<div class="coach-section-label">Weaknesses</div>' +
        '<ul class="coach-weakness-list" id="coachWeaknesses"></ul>' +
      '</div>' +
      '<div class="coach-section">' +
        '<div class="coach-section-label">Improvised Prompt</div>' +
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
        '<button class="coach-btn coach-btn-gold-outline" id="coachAnalyzeFullBtn">🎞️ Analyze Entire Film</button>' +
      '</div>' +
    '</div>' +
    '<!-- Full Video Container -->' +
    '<div id="coachFullContainer" class="coach-full-video-container" style="display:none;">' +
      '<div class="coach-meta-bar">' +
        '<div class="coach-timestamps" id="coachFullMeta">Full Film Prompt Sequence</div>' +
        '<div id="coachFullBadgeContainer"></div>' +
      '</div>' +
      '<div class="coach-film-summary-box" id="coachFilmSummary">Scanning video scenes...</div>' +
      '<div id="coachFullScenesList" style="display:flex; flex-direction:column; gap:0.75rem;"></div>' +
      '<div class="coach-btn-row">' +
        '<button class="coach-btn" id="coachCopyAllBtn">📋 Copy All Prompts</button>' +
        '<button class="coach-btn coach-btn-secondary" id="coachFullRegenBtn">🔄 Re-scan Full Film</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(panel);

  /* DOM references */
  var tabSceneBtn = document.getElementById('coachTabScene');
  var tabFullBtn = document.getElementById('coachTabFull');
  var singleContainer = document.getElementById('coachSingleContainer');
  var fullContainer = document.getElementById('coachFullContainer');

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
  var analyzeFullBtn = document.getElementById('coachAnalyzeFullBtn');

  var fullMetaEl = document.getElementById('coachFullMeta');
  var fullBadgeEl = document.getElementById('coachFullBadgeContainer');
  var filmSummaryEl = document.getElementById('coachFilmSummary');
  var fullScenesListEl = document.getElementById('coachFullScenesList');
  var copyAllBtn = document.getElementById('coachCopyAllBtn');
  var fullRegenBtn = document.getElementById('coachFullRegenBtn');

  var activeMode = 'single'; // 'single' or 'full'
  var cachedFullResult = null;

  function switchTab(mode) {
    activeMode = mode;
    if (mode === 'single') {
      tabSceneBtn.classList.add('active');
      tabFullBtn.classList.remove('active');
      singleContainer.style.display = 'flex';
      fullContainer.style.display = 'none';
    } else {
      tabSceneBtn.classList.remove('active');
      tabFullBtn.classList.add('active');
      singleContainer.style.display = 'none';
      fullContainer.style.display = 'flex';
      if (!cachedFullResult) {
        analyzeEntireVideo();
      }
    }
  }

  tabSceneBtn.addEventListener('click', function () { switchTab('single'); });
  tabFullBtn.addEventListener('click', function () { switchTab('full'); });
  analyzeFullBtn.addEventListener('click', function () { switchTab('full'); });
  fullRegenBtn.addEventListener('click', function () { analyzeEntireVideo(); });

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
    btn.title = 'Analyze scene or entire video with Gemini 2.5 Flash';
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
  /*  Robust Seek Helper                                                */
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
      var timeoutId = setTimeout(onSeeked, 1400);
      videoEl.addEventListener('seeked', onSeeked, { once: true });
      try {
        videoEl.currentTime = clamped;
      } catch (err) {
        onSeeked();
      }
    });
  }

  /* ================================================================== */
  /*  Keyframe Capture (512px wide JPEG)                                */
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
      return c.toDataURL('image/jpeg', 0.82);
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
  /*  Sample Frames and Compute Cuts                                    */
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
              var g = (0.299 * imgData[p] + 0.587 * imgData[p + 1] + 0.114 * imgData[p + 2]) / 255;
              grays[k] = g;
              bSum += g;
            }

            var brightness = bSum / (32 * 18);
            var delta = 0;

            if (prevGrays) {
              var diffSum = 0;
              for (var j = 0; j < 32 * 18; j++) {
                diffSum += Math.abs(grays[j] - prevGrays[j]);
              }
              delta = diffSum / (32 * 18);
            }

            prevGrays = grays;

            results.push({
              time: t,
              brightness: brightness,
              delta: delta
            });
          } catch (e) {}

          index++;
          setTimeout(sampleNext, 18);
        });
      }

      sampleNext();
    });
  }

  /* ================================================================== */
  /*  Detect Scene Boundaries around Time                               */
  /* ================================================================== */
  function findSceneAround(frames, centerTime, cutThreshold) {
    if (!frames || !frames.length) {
      return { start: 0, end: 0, sceneFrames: [] };
    }

    for (var i = 1; i < frames.length; i++) {
      frames[i].isCut = frames[i].delta > cutThreshold;
    }

    var sceneStart = frames[0].time;
    var sceneEnd = frames[frames.length - 1].time;
    var cutEndIndex = -1;

    for (var i = 1; i < frames.length; i++) {
      if (frames[i].isCut && frames[i].time <= centerTime && frames[i].time > sceneStart) {
        sceneStart = frames[i].time;
      }
    }

    for (var i = 1; i < frames.length; i++) {
      if (frames[i].isCut && frames[i].time > centerTime) {
        sceneEnd = frames[i].time;
        cutEndIndex = i;
        break;
      }
    }

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

  function computeStats(sceneFrames) {
    if (!sceneFrames || !sceneFrames.length) {
      return { brightness: 0.5, motion: 0.1 };
    }
    var bSum = 0;
    var mSum = 0;
    var mCount = 0;

    for (var i = 0; i < sceneFrames.length; i++) {
      bSum += sceneFrames[i].brightness;
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
  /*  Segment Full Video into Coherent Cinematic Scenes                 */
  /* ================================================================== */
  function segmentFullVideo(frames, totalDuration, cutThreshold) {
    var minSceneDuration = 5.0; // AI video clips standard: 5s to 12s
    var cuts = [0];

    // Detect significant cut peaks across the film
    for (var i = 1; i < frames.length - 1; i++) {
      var isPeak = (frames[i].delta >= frames[i - 1].delta && frames[i].delta >= frames[i + 1].delta);
      if (frames[i].delta > 0.22 && isPeak) {
        var lastCut = cuts[cuts.length - 1];
        if (frames[i].time - lastCut >= minSceneDuration) {
          cuts.push(frames[i].time);
        }
      }
    }

    if (totalDuration - cuts[cuts.length - 1] >= 3.0) {
      cuts.push(parseFloat(totalDuration.toFixed(2)));
    } else {
      cuts[cuts.length - 1] = parseFloat(totalDuration.toFixed(2));
    }

    // If too few scenes found for a long video, split into balanced segments
    if (cuts.length <= 2 && totalDuration > 14) {
      var segCount = Math.min(6, Math.max(3, Math.round(totalDuration / 10)));
      var segLen = totalDuration / segCount;
      cuts = [0];
      for (var s = 1; s < segCount; s++) {
        cuts.push(parseFloat((s * segLen).toFixed(2)));
      }
      cuts.push(parseFloat(totalDuration.toFixed(2)));
    }

    // Build scene objects
    var scenes = [];
    for (var j = 0; j < cuts.length - 1; j++) {
      var sStart = cuts[j];
      var sEnd = cuts[j + 1];
      var sFrames = frames.filter(function (f) {
        return f.time >= sStart && f.time <= sEnd;
      });
      var stats = computeStats(sFrames);
      scenes.push({
        scene_id: j + 1,
        start: sStart,
        end: sEnd,
        duration: Math.max(1, Math.round(sEnd - sStart)),
        brightness: stats.brightness,
        motion: stats.motion,
        keyframeTime: parseFloat(((sStart + sEnd) / 2).toFixed(2))
      });
    }

    // Cap at maximum 8 scenes to keep Gemini 2.5 Flash request fast and within token budget
    while (scenes.length > 8) {
      var minDurIdx = 0;
      var minDur = 99999;
      for (var k = 0; k < scenes.length - 1; k++) {
        if (scenes[k].duration < minDur) {
          minDur = scenes[k].duration;
          minDurIdx = k;
        }
      }
      var nextEnd = scenes[minDurIdx + 1].end;
      scenes[minDurIdx].end = nextEnd;
      scenes[minDurIdx].duration = Math.max(1, Math.round(nextEnd - scenes[minDurIdx].start));
      scenes[minDurIdx].keyframeTime = parseFloat(((scenes[minDurIdx].start + nextEnd) / 2).toFixed(2));
      scenes.splice(minDurIdx + 1, 1);
    }

    // Re-index scenes
    for (var m = 0; m < scenes.length; m++) {
      scenes[m].scene_id = m + 1;
    }

    return scenes;
  }

  /* ================================================================== */
  /*  API Callers                                                       */
  /* ================================================================== */
  function callCoachSingle(images, stats, start, end) {
    return fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'single',
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

  function callCoachFullVideo(scenesPayload) {
    return fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'full_video',
        scenes: scenesPayload
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
  /*  Render Single Scene Result                                        */
  /* ================================================================== */
  function renderSingleResult(result, scene) {
    var isOffline = !!(result.is_offline || result.offline_mode);

    timestampsEl.textContent = '📽️ ' + formatTime(scene.start) + ' – ' + formatTime(scene.end);

    badgeContainerEl.innerHTML = '';
    if (isOffline) {
      var badge = document.createElement('span');
      badge.className = 'coach-offline-badge';
      badge.textContent = '⚡ OFFLINE MODE';
      badgeContainerEl.appendChild(badge);
    }

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
      weaknessSectionEl.style.display = 'none';
    }

    promptEl.textContent = String(result.improved_prompt || '—');

    if (result.negative_prompt) {
      negativeEl.textContent = String(result.negative_prompt);
      negativeSectionEl.style.display = 'flex';
    } else {
      negativeSectionEl.style.display = 'none';
    }

    if (result.camera_tip) {
      tipEl.textContent = String(result.camera_tip);
      tipSectionEl.style.display = 'flex';
    } else {
      tipSectionEl.style.display = 'none';
    }

    copyBtn.style.display = 'inline-flex';
    regenBtn.style.display = 'inline-flex';
    analyzeFullBtn.style.display = 'inline-flex';
  }

  /* ================================================================== */
  /*  Render Full Video Sequence Results                                */
  /* ================================================================== */
  function renderFullVideoResult(result) {
    cachedFullResult = result;
    var isOffline = !!(result.is_offline || result.offline_mode);

    fullMetaEl.textContent = '🎞️ Complete Film Sequence (' + (result.scenes ? result.scenes.length : 0) + ' scenes)';

    fullBadgeEl.innerHTML = '';
    if (isOffline) {
      var badge = document.createElement('span');
      badge.className = 'coach-offline-badge';
      badge.textContent = '⚡ OFFLINE MODE';
      fullBadgeEl.appendChild(badge);
    }

    filmSummaryEl.textContent = result.film_summary || 'Cohesive cinematic sequence prompts';

    fullScenesListEl.innerHTML = '';
    var scenes = Array.isArray(result.scenes) ? result.scenes : [];

    scenes.forEach(function (s, idx) {
      var card = document.createElement('div');
      card.className = 'coach-scene-card';

      // Header row
      var head = document.createElement('div');
      head.className = 'coach-scene-card-header';

      var badge = document.createElement('span');
      badge.className = 'coach-scene-badge';
      badge.textContent = 'Scene ' + (s.scene_id || (idx + 1)) + ' [' + (s.start || '00:00') + ' – ' + (s.end || '00:00') + ']';
      badge.title = 'Click to seek main video to this scene';
      badge.addEventListener('click', function () {
        var mainVideo = document.getElementById('mainVideoPlayer');
        if (mainVideo) {
          var tParts = (s.start || '0:0').split(':');
          var sec = (parseFloat(tParts[0]) || 0) * 60 + (parseFloat(tParts[1]) || 0);
          mainVideo.currentTime = sec;
          toast('Jumped to ' + (s.start || '00:00'));
        }
      });

      var copySm = document.createElement('button');
      copySm.className = 'coach-copy-sm-btn';
      copySm.textContent = '📋 Copy';
      copySm.addEventListener('click', function () {
        copyText(s.improved_prompt, function () {
          copySm.textContent = '✅ Copied!';
          setTimeout(function () { copySm.textContent = '📋 Copy'; }, 2000);
        });
      });

      head.appendChild(badge);
      head.appendChild(copySm);
      card.appendChild(head);

      // Scene Summary
      if (s.scene_summary) {
        var sumEl = document.createElement('div');
        sumEl.style.fontSize = '0.78rem';
        sumEl.style.color = '#94a3b8';
        sumEl.textContent = s.scene_summary;
        card.appendChild(sumEl);
      }

      // Weaknesses tags
      if (Array.isArray(s.weaknesses) && s.weaknesses.length) {
        var wUl = document.createElement('ul');
        wUl.className = 'coach-weakness-list';
        s.weaknesses.forEach(function (w) {
          var li = document.createElement('li');
          li.textContent = String(w);
          wUl.appendChild(li);
        });
        card.appendChild(wUl);
      }

      // Improved Prompt
      var pBox = document.createElement('div');
      pBox.className = 'coach-prompt-box';
      pBox.style.fontSize = '0.82rem';
      pBox.textContent = String(s.improved_prompt || '—');
      card.appendChild(pBox);

      // Camera Tip
      if (s.camera_tip) {
        var tipBox = document.createElement('div');
        tipBox.className = 'coach-tip';
        tipBox.style.fontSize = '0.76rem';
        tipBox.textContent = '🎥 ' + s.camera_tip;
        card.appendChild(tipBox);
      }

      fullScenesListEl.appendChild(card);
    });

    copyAllBtn.style.display = 'inline-flex';
    fullRegenBtn.style.display = 'inline-flex';
  }

  /* ================================================================== */
  /*  Analyze Current Scene                                             */
  /* ================================================================== */
  var isAnalyzing = false;
  var lastAnalyzedTime = -1;

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

    switchTab('single');
    panel.classList.add('open');
    timestampsEl.textContent = 'Analyzing scene around ' + formatTime(currentTime) + '...';
    badgeContainerEl.innerHTML = '';
    weaknessesEl.innerHTML = '';
    promptEl.innerHTML = '<span class="coach-spinner"></span> Scanning frames with Gemini 2.5 Flash...';
    negativeEl.textContent = '';
    tipEl.textContent = '';
    copyBtn.style.display = 'none';
    regenBtn.style.display = 'none';
    analyzeFullBtn.style.display = 'none';

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

    function processScene() {
      var T = Math.max(0, currentTime);
      var halfWindow = 8;
      var startT = Math.max(0, T - halfWindow);
      var endT = Math.min(hiddenVideo.duration, T + halfWindow);

      if (T < halfWindow) {
        endT = Math.min(hiddenVideo.duration, T + halfWindow + (halfWindow - T));
      }

      sampleFrames(hiddenVideo, startT, endT, 0.5)
        .then(function (frames) {
          if (!frames || !frames.length) throw new Error('Could not sample video frames');

          var scene = findSceneAround(frames, T, 0.18);
          var sceneFrames = scene.sceneFrames;

          if (!sceneFrames.length) {
            scene.start = frames[0].time;
            scene.end = frames[frames.length - 1].time;
            sceneFrames = frames;
            scene.sceneFrames = frames;
          }

          var stats = computeStats(sceneFrames);

          var tStart = sceneFrames[0].time;
          var tMid = sceneFrames[Math.floor(sceneFrames.length / 2)].time;
          var tEnd = sceneFrames[sceneFrames.length - 1].time;

          return captureThreeKeyframes(hiddenVideo, [tStart, tMid, tEnd])
            .then(function (images) {
              return callCoachSingle(images, stats, scene.start, scene.end)
                .then(function (result) {
                  return { result: result, scene: scene };
                });
            });
        })
        .then(function (data) {
          cleanup();
          renderSingleResult(data.result, data.scene);
        })
        .catch(function (err) {
          cleanup();
          console.warn('Single scene analysis error:', err);
          timestampsEl.textContent = '⚠️ Scene Analysis: ' + err.message;
          promptEl.textContent = 'Please click Re-analyze or try full film analysis.';
          regenBtn.style.display = 'inline-flex';
        });
    }

    document.body.appendChild(hiddenVideo);
    if (hiddenVideo.readyState >= 2) {
      processScene();
    } else {
      hiddenVideo.addEventListener('loadeddata', processScene, { once: true });
      hiddenVideo.addEventListener('error', function () {
        cleanup();
        timestampsEl.textContent = '⚠️ Could not load video for frame analysis.';
        regenBtn.style.display = 'inline-flex';
      }, { once: true });
    }

    setTimeout(function () {
      if (!cleanedUp) {
        cleanup();
        timestampsEl.textContent = '⚠️ Request timed out. Click Re-analyze to try again.';
        regenBtn.style.display = 'inline-flex';
      }
    }, 28000);
  }

  /* ================================================================== */
  /*  Analyze Entire Video (Full Film Scene-by-Scene Improvised Prompts)*/
  /* ================================================================== */
  var isFullAnalyzing = false;

  function analyzeEntireVideo() {
    if (isFullAnalyzing) return;
    var mainVideo = document.getElementById('mainVideoPlayer');
    if (!mainVideo || !mainVideo.duration || mainVideo.readyState < 2) {
      toast('Load a video first before starting full film analysis.');
      return;
    }

    isFullAnalyzing = true;
    switchTab('full');
    panel.classList.add('open');

    fullMetaEl.textContent = 'Analyzing Full Film...';
    fullBadgeEl.innerHTML = '';
    filmSummaryEl.innerHTML = '<span class="coach-spinner"></span> Scanning entire film for scene transitions and keyframes...';
    fullScenesListEl.innerHTML = '';
    copyAllBtn.style.display = 'none';
    fullRegenBtn.style.display = 'none';

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
    function cleanupFull() {
      if (cleanedUp) return;
      cleanedUp = true;
      isFullAnalyzing = false;
      try { hiddenVideo.remove(); } catch (_) {}
    }

    function processFull() {
      var duration = hiddenVideo.duration;
      // Adaptive step size based on duration to maintain fast performance
      var step = duration <= 30 ? 0.5 : (duration <= 75 ? 0.75 : 1.0);

      filmSummaryEl.innerHTML = '<span class="coach-spinner"></span> Detecting cuts across ' + formatTime(duration) + ' runtime...';

      sampleFrames(hiddenVideo, 0, duration, step)
        .then(function (frames) {
          if (!frames || !frames.length) throw new Error('No frames could be sampled.');

          var rawScenes = segmentFullVideo(frames, duration, 0.18);
          if (!rawScenes.length) {
            rawScenes = [{
              scene_id: 1,
              start: 0,
              end: duration,
              duration: Math.round(duration),
              brightness: 0.5,
              motion: 0.1,
              keyframeTime: parseFloat((duration / 2).toFixed(2))
            }];
          }

          filmSummaryEl.innerHTML = '<span class="coach-spinner"></span> Captured ' + rawScenes.length + ' scenes. Extracting keyframes for Gemini 2.5 Flash...';

          // Sequentially capture keyframe for each scene
          var sceneIndex = 0;
          var scenesWithImages = [];

          function captureNextSceneKeyframe() {
            if (sceneIndex >= rawScenes.length) {
              return Promise.resolve(scenesWithImages);
            }
            var sc = rawScenes[sceneIndex];
            return captureKeyframe(hiddenVideo, sc.keyframeTime).then(function (img) {
              sc.image = img;
              scenesWithImages.push(sc);
              sceneIndex++;
              return captureNextSceneKeyframe();
            });
          }

          return captureNextSceneKeyframe().then(function (finalScenes) {
            filmSummaryEl.innerHTML = '<span class="coach-spinner"></span> Gemini 2.5 Flash is improvising scene prompts with timestamps...';
            return callCoachFullVideo(finalScenes);
          });
        })
        .then(function (result) {
          cleanupFull();
          renderFullVideoResult(result);
        })
        .catch(function (err) {
          cleanupFull();
          console.warn('Full video analysis error:', err);
          filmSummaryEl.textContent = '⚠️ Full Film Analysis failed: ' + err.message;
          fullRegenBtn.style.display = 'inline-flex';
        });
    }

    document.body.appendChild(hiddenVideo);
    if (hiddenVideo.readyState >= 2) {
      processFull();
    } else {
      hiddenVideo.addEventListener('loadeddata', processFull, { once: true });
      hiddenVideo.addEventListener('error', function () {
        cleanupFull();
        filmSummaryEl.textContent = '⚠️ Could not load video for full scan.';
        fullRegenBtn.style.display = 'inline-flex';
      }, { once: true });
    }

    setTimeout(function () {
      if (!cleanedUp) {
        cleanupFull();
        filmSummaryEl.textContent = '⚠️ Analysis timed out. Click Re-scan to try again.';
        fullRegenBtn.style.display = 'inline-flex';
      }
    }, 45000);
  }

  /* ================================================================== */
  /*  Event Handlers                                                    */
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

  // Re-analyze single scene
  regenBtn.addEventListener('click', function () {
    analyzeScene(true);
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) {
      panel.classList.remove('open');
    }
  });

  // Copy Single Prompt
  copyBtn.addEventListener('click', function () {
    var text = promptEl.textContent;
    if (!text || text === '—') return;
    copyText(text, function () {
      copyBtn.innerHTML = '✅ Copied!';
      setTimeout(function () { copyBtn.innerHTML = '📋 Copy Prompt'; }, 2000);
    });
  });

  // Copy All Prompts formatted with timestamps
  copyAllBtn.addEventListener('click', function () {
    if (!cachedFullResult || !cachedFullResult.scenes) return;
    var allText = '🎬 ' + (cachedFullResult.film_summary || 'Film Prompt Sequence') + '\n\n' +
      cachedFullResult.scenes.map(function (s) {
        return '--- Scene ' + s.scene_id + ' [' + s.start + ' – ' + s.end + '] ---\n' +
               'PROMPT: ' + s.improved_prompt + '\n' +
               (s.negative_prompt ? 'NEGATIVE: ' + s.negative_prompt + '\n' : '') +
               (s.camera_tip ? 'CAMERA TIP: ' + s.camera_tip + '\n' : '');
      }).join('\n');

    copyText(allText, function () {
      copyAllBtn.innerHTML = '✅ All Prompts Copied!';
      setTimeout(function () { copyAllBtn.innerHTML = '📋 Copy All Prompts'; }, 2000);
    });
  });

  /* ================================================================== */
  /*  Auto-trigger Analysis when Video Pauses                           */
  /* ================================================================== */
  var pauseDebounceTimer = null;

  document.addEventListener('pause', function (e) {
    if (e.target && e.target.id === 'mainVideoPlayer') {
      var v = e.target;
      if (v.ended || v.seeking || isAnalyzing || isFullAnalyzing) return;
      if (!v.duration || v.readyState < 2) return;

      clearTimeout(pauseDebounceTimer);
      pauseDebounceTimer = setTimeout(function () {
        if (v.paused && !v.ended && !v.seeking && !isAnalyzing && !isFullAnalyzing) {
          if (panel.classList.contains('open') && activeMode === 'single' && Math.abs(v.currentTime - lastAnalyzedTime) < 0.5) {
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