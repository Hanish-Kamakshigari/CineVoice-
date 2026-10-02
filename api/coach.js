// /api/coach.js — Vercel serverless function (CommonJS)
// Calls Gemini API with 3 keyframe images and scene stats,
// returns a cinematography prompt review. Falls back to rule-based when API fails or quota runs out.

const https = require('https');
const http = require('http');

// --- Helper: HTTP Request wrapper (compatible with all Node versions) ---
function requestUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const isHttps = u.protocol === 'https:';
      const proto = isHttps ? https : http;
      const headers = Object.assign({}, opts.headers || {});
      if (opts.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      const req = proto.request(
        {
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          method: opts.method || 'GET',
          headers,
          timeout: 25000,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out after 25s'));
      });

      if (opts.body) {
        req.write(opts.body);
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function formatTime(sec) {
  const s = Math.max(0, parseFloat(sec) || 0);
  const m = Math.floor(s / 60);
  const remainder = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

// --- Rule-Based Fallback Prompt Generator ---
function ruleBasedPrompt(brightness, motion, start, end) {
  const durationSec = Math.max(1, Math.round((end || 8) - (start || 0)));
  const bPercent = Math.round(brightness * 100);
  const mPercent = Math.round(motion * 100);

  // Lighting appraisal
  let lightingDesc = 'balanced cinematic natural lighting with soft shadow rolloff';
  let lightWeakness = null;
  if (brightness < 0.22) {
    lightingDesc = 'moody low-key dramatic lighting, subtle rim illumination, deep contrast';
    lightWeakness = 'Under-exposed: shadow details are crushed and subject lacks definition';
  } else if (brightness < 0.45) {
    lightingDesc = 'soft diffused atmospheric ambient lighting with gentle falloff';
  } else if (brightness > 0.75) {
    lightingDesc = 'bright controlled high-key daylight with soft highlight diffusion';
    lightWeakness = 'Over-exposed: highlights are washed out with risk of blown-out clipping';
  }

  // Camera & motion appraisal
  let cameraMovement = 'subtle slow push-in, 35mm anamorphic prime lens, f/2.0';
  let actionDesc = 'composed character movement';
  let motionWeakness = null;

  if (motion < 0.04) {
    cameraMovement = 'slow cinematic creeping push-in on 50mm prime, stable lock-off';
    actionDesc = 'focused stillness with subtle atmospheric drift';
    motionWeakness = 'Static scene: lacks dynamic focal movement or environmental tension';
  } else if (motion <= 0.16) {
    cameraMovement = 'smooth steadycam tracking shot, 35mm lens, f/2.8';
    actionDesc = 'measured deliberate character movement';
  } else if (motion <= 0.38) {
    cameraMovement = 'dynamic handheld camera tracking with organic micro-sway, 28mm lens';
    actionDesc = 'active character motion through the environment';
  } else {
    cameraMovement = 'kinetic gimbal pursuit tracking with motion-blur compensation, 24mm wide angle lens';
    actionDesc = 'fast-paced action and rapid subject repositioning';
    motionWeakness = 'Excessive motion: risk of visual jitter and temporal warping artifacts';
  }

  const weaknesses = [];
  if (lightWeakness) weaknesses.push(lightWeakness);
  if (motionWeakness) weaknesses.push(motionWeakness);
  if (weaknesses.length === 0) {
    weaknesses.push('Compositional framing could feature sharper depth-of-field separation');
  }
  if (weaknesses.length < 2) {
    weaknesses.push('Lighting contrast could be shaped with stronger key-to-fill ratio');
  }

  const prompt = `${actionDesc}, cinematic film setting, ${cameraMovement}, ${lightingDesc}, 35mm film grain, rich color grade, 24fps, shallow depth of field. Duration ${durationSec}s.`;
  const negativePrompt = 'jittery camera, flickering, motion smear, blown out highlights, muddy crushed shadows, cartoonish textures, warped anatomy.';
  const cameraTip = `Scene brightness ${bPercent}%, motion ${mPercent}%. Use ${motion > 0.2 ? 'a gimbal stabilizer and 1/50s shutter speed' : 'a stable dolly push-in with 50mm f/2.0 lens'} to maximize temporal coherence.`;

  return {
    scene_summary: `Scene from ${formatTime(start)} to ${formatTime(end)} (${bPercent}% brightness, ${mPercent}% motion).`,
    weaknesses: weaknesses.slice(0, 3),
    improved_prompt: prompt,
    negative_prompt: negativePrompt,
    camera_tip: cameraTip,
    is_offline: true,
    offline_mode: true
  };
}

// --- Gemini API Call ---
async function callGemini(images, stats, modelName) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const sceneDuration = Math.max(1, Math.round(stats.end - stats.start));

  const promptText = `You are an expert cinematography prompt coach for AI video generation tools (Veo, Runway, Sora, Luma).
Analyze these 3 chronological keyframes (start, middle, end) from one video scene.

Scene parameters:
- Scene start: ${formatTime(stats.start)} (${stats.start.toFixed(2)}s)
- Scene end: ${formatTime(stats.end)} (${stats.end.toFixed(2)}s)
- Scene duration: ~${sceneDuration}s
- Average brightness (0-1): ${stats.brightness.toFixed(2)}
- Motion intensity (0-1): ${stats.motion.toFixed(2)}

Perform the following tasks:
1. Describe the scene: identify subject, action, setting, camera angle, lighting, colour palette, and visual style.
2. List up to 3 concrete weaknesses or areas for improvement (e.g. flat lighting, unclear action, awkward framing, artifacts, low contrast).
3. Write ONE improved prompt under 90 words using this exact sequence:
   [subject and action], [setting], [camera and lens], [lighting], [colour and style], [duration].
4. Write a concise negative prompt listing artifacts, distortions, and unwanted flaws to avoid.
5. Provide a practical camera tip (framing, lens choice, camera movement, or stabilization).
6. Crucial: Maintain the same characters, setting, and story. Improve execution and cinematic quality without altering the narrative.

Output ONLY valid JSON matching this schema:
{
  "scene_summary": "Concise visual description of the scene",
  "weaknesses": ["Weakness 1", "Weakness 2", "Weakness 3"],
  "improved_prompt": "Under 90 words prompt following the required order",
  "negative_prompt": "Comma-separated list of visual artifacts and flaws to avoid",
  "camera_tip": "Specific cinematography advice for this shot"
}`;

  const parts = [{ text: promptText }];

  for (const img of images) {
    // Strip possible data URI prefix if present
    const base64Data = img.replace(/^data:image\/(?:jpeg|jpg|png);base64,/, '');
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: base64Data
      }
    });
  }

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${apiKey}`;

  const res = await requestUrl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });

  if (res.status !== 200) {
    let errMsg = res.body;
    try {
      const errObj = JSON.parse(res.body);
      errMsg = errObj.error?.message || res.body;
    } catch (_) {}
    throw new Error(`Gemini API error (${res.status}): ${errMsg}`);
  }

  const data = JSON.parse(res.body);
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API returned an empty response');
  }

  // Strip markdown fences if present
  text = text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  const result = JSON.parse(text);

  if (!result.improved_prompt) {
    throw new Error('Response JSON is missing improved_prompt');
  }

  return {
    scene_summary: String(result.scene_summary || ''),
    weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses.map(String) : [],
    improved_prompt: String(result.improved_prompt),
    negative_prompt: String(result.negative_prompt || ''),
    camera_tip: String(result.camera_tip || ''),
    is_offline: false
  };
}

// --- Vercel Serverless Function Handler ---
module.exports = async (req, res) => {
  // Set CORS headers
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
    try { body = JSON.parse(body); } catch (_) {}
  }
  body = body || {};

  const { images, brightness, motion, start, end } = body;

  if (!Array.isArray(images) || images.length !== 3) {
    res.status(400).json({ error: 'Payload requires exactly 3 keyframe images (base64 JPEG).' });
    return;
  }

  const stats = {
    brightness: Math.min(1, Math.max(0, parseFloat(brightness) || 0)),
    motion: Math.min(1, Math.max(0, parseFloat(motion) || 0)),
    start: Math.max(0, parseFloat(start) || 0),
    end: Math.max(0, parseFloat(end) || 0)
  };

  const configuredModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  try {
    let result;
    try {
      result = await callGemini(images, stats, configuredModel);
    } catch (primaryErr) {
      console.warn(`Primary Gemini call (${configuredModel}) failed:`, primaryErr.message);

      // If configured model failed, attempt fallback to gemini-2.5-flash or gemini-flash-latest before offline mode
      const fallbackModel = (configuredModel === 'gemini-2.5-flash') ? 'gemini-flash-latest' : 'gemini-2.5-flash';
      if (process.env.GEMINI_API_KEY) {
        try {
          console.log(`Attempting secondary fallback model: ${fallbackModel}`);
          result = await callGemini(images, stats, fallbackModel);
        } catch (secondaryErr) {
          console.warn('Secondary Gemini call failed:', secondaryErr.message);
          throw secondaryErr;
        }
      } else {
        throw primaryErr;
      }
    }

    res.status(200).json(result);
  } catch (err) {
    console.warn('Falling back to rule-based offline mode:', err.message);
    const offlineResult = ruleBasedPrompt(stats.brightness, stats.motion, stats.start, stats.end);
    offlineResult.offline_reason = err.message;
    res.status(200).json(offlineResult);
  }
};