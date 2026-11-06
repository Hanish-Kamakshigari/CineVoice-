/**
 * Vercel serverless route: POST /api/reference-match
 *
 * Receives { deltas, frames: {uploaded[], reference[]}, notes } where frames
 * are small base64 JPEG dataURLs produced in the browser. The video files
 * themselves never leave the client.
 *
 * Env:
 *   GEMINI_API_KEY  (required)   key from Google AI Studio free tier
 *   GEMINI_MODEL    (optional)   defaults to gemini-2.5-flash
 *
 * Zero dependencies; Node 18+ global fetch.
 */
'use strict';

const MODEL_DEFAULT = 'gemini-2.5-flash';
const MAX_CHARS_PER_FRAME = 500_000;
const MAX_FRAMES_PER_SIDE = 8;
const MAX_NOTES_CHARS = 2000;
const MAX_DELTAS_CHARS = 12_000;
const MAX_BODY_CHARS = 4_400_000; // under Vercel's ~4.5MB request cap
const CATEGORIES = ['color', 'lighting', 'contrast', 'framing', 'pacing', 'texture', 'audio_mood'];
const PRIORITIES = ['high', 'medium', 'low'];

function json(res, status, value) {
  const raw = JSON.stringify(value);

  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(raw);
}

function stripDataUrl(d) {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(d || '').slice(0, 64));
  if (!m) return null;
  const rest = String(d).slice(m[0].length - m[2].length);
  return { mime: m[1] === 'png' ? 'image/png' : 'image/jpeg', data: rest };
}

function validateFrameArray(list, name) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error(name + ' frames must be an array');
  if (list.length > MAX_FRAMES_PER_SIDE) throw new Error(name + ' has more than ' + MAX_FRAMES_PER_SIDE + ' frames');
  return list.map(function (d) {
    const parsed = stripDataUrl(d);
    if (!parsed || parsed.data.length > MAX_CHARS_PER_FRAME) throw new Error(name + ' has an oversized or malformed frame');
    return parsed;
  });
}

function sanitizeText(value, name, limit) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(name + ' must be a string');
  return value.slice(0, limit);
}

function buildPrompt(deltas, notes, frameCounts) {
  const system = [
    'You are a senior cinematographer and colorist giving concise, specific, actionable feedback.',
    'Two sets of frames are provided: first the user\'s video, then the reference style frames.',
    'Compare LOOK AND FEEL ONLY (color grade, lighting, contrast, framing, pacing, texture, audio mood).',
    'Never identify, name, describe plot of, or reproduce content from any film. Style only.',
    framesCountsLine(frameCounts),
    'The client-computed numeric deltas are provided and are approximate; trust frames for anything numeric deltas miss.',
    'Respond with STRICT minified JSON ONLY, no markdown, no code fences, matching exactly this schema:',
    '{"summary":string,"similarity_score":number(0-100),"suggestions":[{"category":"color|lighting|contrast|framing|pacing|texture|audio_mood","issue":string,"fix":string,"timestamp":"optional mm:ss or omitted","priority":"high|medium|low"}],"better_prompt":string}',
    'Give 3 to 7 suggestions sorted most important first. Fixes must be concrete actions (e.g. "lower exposure ~0.5 stop", "push shadows toward teal", "add 2.39:1 letterbox", "slow cuts to ~4s average").',
    'better_prompt: rewrite the user\'s implied prompt as a text-to-video / AI-generation prompt that would produce the reference look (no copyrighted titles).'
  ].join('\n');
  const user = [
    'Numeric deltas JSON (approximate, client-computed):',
    deltas,
    notes ? 'User notes: ' + JSON.stringify(notes) : 'User notes: (none)'
  ].join('\n\n');
  return { system, user };
}

function framesCountsLine(frameCounts) {
  return 'The user video is represented by ' + frameCounts.uploaded + ' sampled frame(s); the reference by ' + frameCounts.reference + ' frame(s), in chronological order.';
}

function extractJson(text) {
  let t = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(t.slice(start, end + 1));
}

function validateResult(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('result is not an object');
  const out = {
    summary: typeof obj.summary === 'string' ? obj.summary.slice(0, 600) : '',
    similarity_score: typeof obj.similarity_score === 'number' && isFinite(obj.similarity_score)
      ? Math.max(0, Math.min(100, obj.similarity_score)) : clampInt(obj.similarity_score),
    suggestions: [],
    better_prompt: typeof obj.better_prompt === 'string' ? obj.better_prompt.slice(0, 2000) : ''
  };
  if (Array.isArray(obj.suggestions)) {
    out.suggestions = obj.suggestions.slice(0, 10).map(function (s) {
      if (!s || typeof s !== 'object') return null;
      const category = CATEGORIES.includes(s.category) ? s.category : 'color';
      const priority = PRIORITIES.includes(s.priority) ? s.priority : 'medium';
      return {
        category,
        issue: typeof s.issue === 'string' ? s.issue.slice(0, 400) : '',
        fix: typeof s.fix === 'string' ? s.fix.slice(0, 600) : '',
        timestamp: typeof s.timestamp === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(s.timestamp.trim()) ? s.timestamp.trim() : undefined,
        priority
      };
    }).filter(Boolean);
  }
  return out;
}

function clampInt(v) {
  const n = parseInt(v, 10);
  return isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
}

async function callGemini(apiKey, model, system, user, frames) {
  const parts = [{ text: user }];
  frames.uploaded.concat(frames.reference).forEach(function (f) {
    parts.push({ text: '(frame)' });
    parts.push({ inlineData: { mimeType: f.mime, data: f.data } });
  });
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json'
    }
  };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { /* fallthrough */ }
  return { status: res.status, parsed };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'POST only' });
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    json(res, 503, { ok: false, error: 'AI suggestions are not configured (missing GEMINI_API_KEY).' });
    return;
  }
  // size guard before parsing
  const lenHeader = parseInt(req.headers['content-length'] || '0', 10);
  if (lenHeader > MAX_BODY_CHARS) {
    json(res, 413, { ok: false, error: 'Request too large.' });
    return;
  }

  let payload;
  try {
    const chunks = [];
    let size = 0;
    await new Promise(function (resolve, reject) {
      req.on('data', function (c) {
        size += c.length;
        if (size > MAX_BODY_CHARS) { reject(new Error('Request too large.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', resolve);
      req.on('error', reject);
    });
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    json(res, 400, { ok: false, error: 'Invalid JSON body.' });
    return;
  }

  try {
    const deltas = sanitizeText(JSON.stringify(payload.deltas || {}), 'deltas', MAX_DELTAS_CHARS);
    const notes = sanitizeText(payload.notes, 'notes', MAX_NOTES_CHARS);
    const frames = {
      uploaded: validateFrameArray((payload.frames || {}).uploaded, 'uploaded'),
      reference: validateFrameArray((payload.frames || {}).reference, 'reference')
    };
    if (!frames.uploaded.length || !frames.reference.length) {
      json(res, 400, { ok: false, error: 'Frames from both videos are required for AI suggestions.' });
      return;
    }
    const { system, user } = buildPrompt(deltas, notes, { uploaded: frames.uploaded.length, reference: frames.reference.length });
    const model = process.env.GEMINI_MODEL || MODEL_DEFAULT;

    let attempt = await callGemini(key, model, system, user, frames);
    if (attempt.status === 429) {
      json(res, 429, { ok: false, error: 'Rate limited by the AI provider (free tier).' });
      return;
    }
    if (attempt.status === 401 || attempt.status === 403) {
      json(res, 403, { ok: false, error: 'AI provider rejected the API key.' });
      return;
    }
    if (attempt.status < 200 || attempt.status >= 300) {
      json(res, 502, { ok: false, error: 'AI provider error (' + attempt.status + ').' });
      return;
    }
    let text = '';
    try {
      const parts0 = attempt.parsed && attempt.parsed.candidates && attempt.parsed.candidates[0] && attempt.parsed.candidates[0].content;
      text = parts0 && parts0.parts && parts0.parts.map(function (p) { return p.text || ''; }).join('');
    } catch (e) { /* fallthrough */ }

    let result;
    try {
      result = validateResult(extractJson(text));
    } catch (e) {
      // one strict retry
      const retry = await callGemini(key, model, system + '\nReturn ONLY minified JSON, no prose.', user, frames);
      if (retry.status !== 200) {
        json(res, 502, { ok: false, error: 'AI provider error on retry (' + retry.status + ').' });
        return;
      }
      try {
        const parts0 = retry.parsed && retry.parsed.candidates && retry.parsed.candidates[0] && retry.parsed.candidates[0].content;
        text = parts0 && parts0.parts && parts0.parts.map(function (p) { return p.text || ''; }).join('');
        result = validateResult(extractJson(text));
      } catch (e2) {
        json(res, 502, { ok: false, error: 'Could not parse AI suggestions. The numeric comparison is still available.' });
        return;
      }
    }
    json(res, 200, { ok: true, result });
  } catch (e) {
    json(res, 400, { ok: false, error: e.message || 'Bad request.' });
  }
};
