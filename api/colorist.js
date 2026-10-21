// CineVoice AI Colorist - NVIDIA Nemotron 3 Nano Omni grade advisor.
//
// The local editor measures the footage (scene cuts, exposure, noise, white
// balance, skin ratio) and sends the measurements plus one keyframe per
// scene. This function asks Nemotron for a colour restoration plan and
// returns it as JSON. When no API key is configured, or the model call
// fails, the deterministic plan that came in with the request is returned
// untouched, so the editor always has a usable grade.
const MODEL = process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

const SYSTEM_PROMPT =
  'You are a senior digital colourist and post-production supervisor. You receive ' +
  'measured technical statistics and one keyframe per scene from a short film. ' +
  'For every scene, return a JSON diagnosis and a restoration recipe that a colourist ' +
  'could execute in DaVinci Resolve. Answer with JSON only.';

const RESPONSE_SHAPE =
  '{"scenes":[{"index":0,"diagnosis":["short finding"],"severity":"low|medium|high",' +
  '"grade":{"exposure":0.0,"contrast":1.0,"saturation":1.0,"shadow_lift":0.0,' +
  '"highlight_rolloff":0.0,"wb":[1.0,1.0,1.0],"denoise_luma":0.0,"denoise_chroma":0.0,' +
  '"sharpen":0.0,"grain":0}}],"film_summary":"one paragraph",' +
  '"global_notes":["short note"]}';

function clamp(value, low, high) {
  if (typeof value !== 'number' || !isFinite(value)) return null;
  return Math.max(low, Math.min(high, value));
}

function sanitizeGrade(grade) {
  if (!grade || typeof grade !== 'object') return null;
  const out = {};
  const numbers = {
    exposure: [-1, 1],
    contrast: [0.7, 1.4],
    saturation: [0.6, 1.4],
    shadow_lift: [0, 0.08],
    highlight_rolloff: [0, 0.9],
    denoise_luma: [0, 12],
    denoise_chroma: [0, 16],
    denoise_temporal: [0, 6],
    sharpen: [0, 1.5],
    grain: [0, 40],
  };
  Object.keys(numbers).forEach((key) => {
    const value = clamp(grade[key], numbers[key][0], numbers[key][1]);
    if (value !== null) out[key] = value;
  });
  if (Array.isArray(grade.wb) && grade.wb.length === 3) {
    const wb = grade.wb.map((value) => clamp(Number(value), 0.85, 1.15));
    if (wb.every((value) => value !== null)) out.wb = wb;
  }
  if (typeof grade.normalize === 'boolean') out.normalize = grade.normalize;
  return Object.keys(out).length ? out : null;
}

function sanitizeAnswer(answer, payload) {
  const scenes = Array.isArray(answer.scenes) ? answer.scenes : [];
  const known = new Set((payload.scenes || []).map((scene) => scene.index));
  const cleaned = scenes
    .filter((scene) => scene && typeof scene === 'object' && known.has(scene.index))
    .map((scene) => ({
      index: scene.index,
      diagnosis: Array.isArray(scene.diagnosis)
        ? scene.diagnosis.slice(0, 6).map((item) => String(item).slice(0, 200))
        : [],
      severity: ['low', 'medium', 'high'].includes(scene.severity) ? scene.severity : 'medium',
      grade: sanitizeGrade(scene.grade),
    }))
    .filter((scene) => scene.grade);
  return {
    scenes: cleaned,
    film_summary: String(answer.film_summary || '').slice(0, 1200),
    global_notes: Array.isArray(answer.global_notes)
      ? answer.global_notes.slice(0, 8).map((note) => String(note).slice(0, 300))
      : [],
    offline: false,
  };
}

function offlineAnswer(payload, reason) {
  // The deterministic plan computed by video_colorist.py is the fallback.
  // It is sanitised as well, so a caller cannot smuggle extreme values in
  // through the request body.
  const scenes = (Array.isArray(payload.scenes) ? payload.scenes : [])
    .filter((scene) => scene && Number.isInteger(scene.index))
    .map((scene) => ({
      index: scene.index,
      diagnosis: (Array.isArray(scene.planned_issues) ? scene.planned_issues : [])
        .slice(0, 6)
        .map((item) => String(item).slice(0, 200)),
      severity: 'medium',
      grade: sanitizeGrade(scene.planned_grade),
    }))
    .filter((scene) => scene.grade);
  return {
    scenes,
    film_summary: 'Offline technical analysis: every correction was derived from measured exposure, noise, white balance and contrast data.',
    global_notes: reason ? [`Nemotron unavailable (${reason}); used the deterministic measurement plan.`] : [],
    offline: true,
    offline_reason: reason || 'NVIDIA_API_KEY is not configured',
  };
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    const parts = cleaned.split('```');
    cleaned = (parts[1] || parts[0] || '').replace(/^json/i, '').trim();
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function buildMessages(payload, includeImages) {
  const summary = (payload.scenes || []).map((scene) => ({
    index: scene.index,
    start: scene.start,
    end: scene.end,
    stats: scene.stats,
  }));
  const content = [
    {
      type: 'text',
      text:
        'Review the scene measurements and keyframes below and produce a colour ' +
        'restoration plan for each scene.\n\nMeasurements:\n' +
        JSON.stringify(summary, null, 1) +
        '\n\nAnswer with this exact JSON shape:\n' +
        RESPONSE_SHAPE +
        '\n\nRules: exposure is in stops (-1..1); contrast and saturation are ' +
        'multipliers around 1.0; keep every change small and never destroy skin ' +
        'texture. You may look at the attached keyframes.',
    },
  ];
  if (includeImages) {
    (payload.scenes || []).forEach((scene) => {
      if (!scene.keyframe) return;
      content.push({ type: 'text', text: `Scene ${scene.index} keyframe:` });
      content.push({ type: 'image_url', image_url: { url: scene.keyframe } });
    });
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content },
  ];
}

function hasImages(payload) {
  return (payload.scenes || []).some((scene) => scene && scene.keyframe);
}

// The model can refuse image input (text-only build, multimodal disabled) and
// the vision worker pool can be saturated. Both are recoverable: the measured
// statistics carry enough signal to grade the scene from text alone.
function isImageError(message) {
  return /image|multimodal|vision|modality/i.test(String(message || ''));
}

function isTransient(message) {
  return /503|502|504|429|ResourceExhausted|rate limit|temporarily|high demand/i.test(
    String(message || '')
  );
}

async function callNemotron(payload, apiKey, includeImages) {
  const response = await fetch(NVIDIA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: buildMessages(payload, includeImages),
      temperature: 0.2,
      max_tokens: 4096,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Nemotron ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  const choice = (data.choices || [])[0] || {};
  const text = (choice.message || {}).content || '';
  const parsed = extractJson(text);
  if (!parsed) throw new Error('Nemotron did not return JSON');
  return parsed;
}

// Runs the review and degrades gracefully: vision -> text-only -> offline plan.
async function reviewScenes(payload, apiKey) {
  const wantsImages = hasImages(payload);
  let notes = [];
  try {
    const answer = await callNemotron(payload, apiKey, wantsImages);
    return { answer, notes, degraded: false };
  } catch (err) {
    if (!wantsImages) throw err;
    if (!isImageError(err.message) && !isTransient(err.message)) throw err;
    notes.push(
      isImageError(err.message)
        ? 'The configured model rejected the keyframes, so the review ran from the measured statistics only.'
        : 'The vision endpoint was unavailable, so the review ran from the measured statistics only.'
    );
    const answer = await callNemotron(payload, apiKey, false);
    return { answer, notes, degraded: true };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed. POST required.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }
  body = body || {};
  const scenes = Array.isArray(body.scenes) ? body.scenes : [];
  if (!scenes.length) {
    res.status(400).json({ error: 'Payload requires at least one measured scene.' });
    return;
  }

  const apiKey = (process.env.NVIDIA_API_KEY || '').trim();
  if (!apiKey) {
    res.status(200).json(offlineAnswer(body, 'NVIDIA_API_KEY is not configured'));
    return;
  }

  try {
    const { answer, notes, degraded } = await reviewScenes(body, apiKey);
    const result = sanitizeAnswer(answer, body);
    if (notes.length) result.global_notes = notes.concat(result.global_notes || []).slice(0, 8);
    if (degraded) result.degraded = true;
    res.status(200).json(result);
  } catch (err) {
    console.warn('Falling back to the deterministic colorist plan:', err.message);
    res.status(200).json(offlineAnswer(body, err.message));
  }
};
