// /api/coach.js — Vercel serverless function (CommonJS)
// Uses Gemini 2.5 Flash to analyze single scenes or entire video sequences with timestamps.
// Adheres strictly to the Standard Prompt Formula:
// [Shot Type & Camera Movement] of [Subject & Action], set in [Environment/Setting]. [Lighting & Atmosphere], [Visual Style/Render Quality].

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
          timeout: 28000,
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
        reject(new Error('Request timed out after 28s'));
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

// --- Rule-Based Fallback Prompt Generator adhering to the Standard Prompt Formula ---
// [Shot Type & Camera Movement] of [Subject & Action], set in [Environment/Setting]. [Lighting & Atmosphere], [Visual Style/Render Quality].
function ruleBasedPrompt(brightness, motion, start, end, sceneIndex = 1) {
  const durationSec = Math.max(1, Math.round((end || 8) - (start || 0)));
  const bPercent = Math.round(brightness * 100);
  const mPercent = Math.round(motion * 100);

  // 1. [Shot Type & Camera Movement]
  let shotAndCamera = 'Medium shot with smooth slow push-in';
  let motionWeakness = null;
  if (motion < 0.04) {
    shotAndCamera = 'Clean, static locked-off wide shot';
    motionWeakness = 'Static scene: lacks dynamic focal movement or tension';
  } else if (motion <= 0.16) {
    shotAndCamera = 'Smooth Steadicam tracking shot moving alongside on a 35mm lens';
  } else if (motion <= 0.35) {
    shotAndCamera = 'Over-the-shoulder tracking shot moving slightly inward with organic micro-sway, 28mm lens';
  } else {
    shotAndCamera = 'Dynamic handheld camera tracking shot with kinetic motion, 24mm wide angle lens';
    motionWeakness = 'High motion: risk of visual jitter and temporal warping artifacts';
  }

  // 2. [Subject & Action]
  const subjectActions = [
    'a protagonist in deep contemplation, turning gaze forward with purposeful resolve',
    'the subject moving deliberately through the scene, scanning the environment with intense focus',
    'two figures in an emotional dialogue exchange, gesturing with natural micro-expressions',
    'hands engaging with physical tools and objects in sharp focal relief',
    'a character striding through the frame as the background reveals dramatic depth'
  ];
  const subjectAction = subjectActions[(sceneIndex - 1) % subjectActions.length];

  // 3. [Environment/Setting]
  let setting = 'a cinematic interior environment with layered background elements';
  if (brightness > 0.65) {
    setting = 'a sun-drenched architectural space with wide windows and soft bokeh';
  } else if (brightness < 0.3) {
    setting = 'a moody low-key cinematic interior with deep shadow corridors';
  }

  // 4. [Lighting & Atmosphere]
  let lighting = 'balanced natural cinematic lighting with soft shadow rolloff';
  let lightWeakness = null;
  if (brightness < 0.22) {
    lighting = 'moody low-key dramatic lighting, subtle rim illumination, deep contrast';
    lightWeakness = 'Under-exposed: shadow details are crushed and subject lacks definition';
  } else if (brightness < 0.45) {
    lighting = 'soft diffused atmospheric ambient lighting with gentle warm falloff';
  } else if (brightness > 0.75) {
    lighting = 'bright daylight-balanced lighting with crisp highlights and soft diffusion';
    lightWeakness = 'Over-exposed: highlights are washed out with risk of blown-out clipping';
  }

  // 5. [Visual Style/Render Quality]
  const visualStyle = 'crisp 35mm lens look, realistic skin texture, rich color grade, cinematic 24fps';

  // Assembly: Standard Prompt Formula
  const prompt = `${shotAndCamera} of ${subjectAction}, set in ${setting}. ${lighting}, ${visualStyle}. (${durationSec}s)`;
  const negativePrompt = 'Warped hands, distorted face, flickering, artificial plastic look, frame stutter, ghosting, blurry textures, unnatural walking cycle, extra limbs, low resolution.';
  const cameraTip = `Scene brightness ${bPercent}%, motion ${mPercent}%. Use ${motion > 0.2 ? 'a gimbal stabilizer and 1/50s shutter speed' : 'a stable dolly or 50mm f/2.0 prime'} to maximize temporal coherence.`;

  const weaknesses = [];
  if (lightWeakness) weaknesses.push(lightWeakness);
  if (motionWeakness) weaknesses.push(motionWeakness);
  if (weaknesses.length === 0) {
    weaknesses.push('Compositional framing could feature sharper depth-of-field separation');
  }
  if (weaknesses.length < 2) {
    weaknesses.push('Lighting contrast could be shaped with stronger key-to-fill ratio');
  }

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

// --- Rule-Based Fallback for Full Video ---
function ruleBasedFullVideo(scenes) {
  return {
    film_summary: `Sequential scene-by-scene analysis for ${scenes.length} detected film scenes (offline mode).`,
    scenes: scenes.map((s, idx) => {
      const single = ruleBasedPrompt(s.brightness || 0.5, s.motion || 0.1, s.start, s.end, idx + 1);
      return {
        scene_id: idx + 1,
        start: formatTime(s.start),
        end: formatTime(s.end),
        duration: Math.max(1, Math.round(s.end - s.start)),
        scene_summary: single.scene_summary,
        weaknesses: single.weaknesses,
        improved_prompt: `[${formatTime(s.start)} - ${formatTime(s.end)}]: ${single.improved_prompt}`,
        negative_prompt: single.negative_prompt,
        camera_tip: single.camera_tip
      };
    }),
    is_offline: true,
    offline_mode: true
  };
}

// --- Gemini System Prompt Guidelines & Few-Shot Templates ---
const PROMPT_FORMULA_INSTRUCTIONS = `
MANDATORY PROMPT FORMULA FOR ALL IMPROVED PROMPTS:
[Shot Type & Camera Movement] of [Subject & Action], set in [Environment/Setting]. [Lighting & Atmosphere], [Visual Style/Render Quality].

PRODUCTION-READY REFERENCE TEMPLATES:
- Kinetic CGI / Titles: Fast drone-style flythrough of a futuristic neon-lit digital skyline. 3D holographic title text floats between glass skyscrapers. High-tech, cinematic blue and purple lighting, octane render, 4K resolution.
  Negative: Shaky cam, low resolution, motion blur, muddy textures.
- Character Dialogue / Direct-to-Camera: Medium shot of a professional speaking directly to the camera, gestures naturally. Modern open-plan office background with soft bokeh. Clean corporate lighting, crisp 35mm lens look, realistic skin texture.
  Negative: Warped hands, distorted face, flickering, artificial plastic look.
- Over-the-Shoulder / Workspace Action: Over-the-shoulder shot tracking slightly inward as hands type on a laptop. Sharp focus on a high-tech UI dashboard displayed on the screen. Bright, daylight-balanced corporate office lighting.
  Negative: Illegible screen distortion, extra fingers, jittery movement.
- Motion Graphics / Visualizations: Clean, static frontal angle of a 3D animated marketing funnel graphic with glowing data nodes. Dark minimalist tech background, sharp geometric vectors, smooth digital animation.
  Negative: Organic noise, blurry graphics, erratic camera pan.
- Group Tracking / Hallway Walk: Smooth Steadicam shot moving backward in front of a diverse group walking down a bright office hallway, talking and smiling. Cool-toned fluorescent lighting, glossy floor reflections, cinematic 24fps.
  Negative: Deformed limbs, unnatural walking cycle, ghosting, frame stutter.

NEGATIVE PROMPTS:
Must target realistic generative video artifacts (e.g. "Warped hands, distorted face, flickering, artificial plastic look, ghosting, frame stutter, unnatural walking cycle, blurry textures").
`;

// --- Gemini API Call: Single Scene ---
async function callGeminiSingleScene(images, stats, modelName) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const sceneDuration = Math.max(1, Math.round(stats.end - stats.start));

  const promptText = `You are a world-class film director and AI video prompt engineer (for Veo, Runway Gen-3, Sora, Luma).
Analyze these 3 chronological keyframes (start, middle, end) from one video scene.

Scene parameters:
- Scene start: ${formatTime(stats.start)} (${stats.start.toFixed(2)}s)
- Scene end: ${formatTime(stats.end)} (${stats.end.toFixed(2)}s)
- Scene duration: ~${sceneDuration}s
- Average brightness (0-1): ${stats.brightness.toFixed(2)}
- Motion intensity (0-1): ${stats.motion.toFixed(2)}

${PROMPT_FORMULA_INSTRUCTIONS}

Instructions:
1. "scene_summary": Describe the visual reality: subject, action, setting, lighting, style.
2. "weaknesses": List up to 3 flaws (e.g. flat lighting, awkward framing, artifacts, lack of depth).
3. "improved_prompt": ONE production-ready prompt strictly following:
   [Shot Type & Camera Movement] of [Subject & Action], set in [Environment/Setting]. [Lighting & Atmosphere], [Visual Style/Render Quality]. (${sceneDuration}s)
4. "negative_prompt": Targeted list of generative artifacts to avoid.
5. "camera_tip": Specific cinematography tip for lens choice, camera movement, or stabilization.

Output ONLY valid JSON matching this schema:
{
  "scene_summary": "Concise visual description",
  "weaknesses": ["Weakness 1", "Weakness 2"],
  "improved_prompt": "Prompt strictly adhering to the Standard Prompt Formula",
  "negative_prompt": "Targeted negative prompt listing visual artifacts to avoid",
  "camera_tip": "Specific cinematography advice for this shot"
}`;

  const parts = [{ text: promptText }];

  for (const img of images) {
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

// --- Gemini API Call: Whole Video (Multiple Scenes with Timestamps) ---
async function callGeminiFullVideo(scenes, modelName) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const sceneDescriptions = scenes.map((s, idx) => {
    const dur = Math.max(1, Math.round(s.end - s.start));
    return `Scene ${idx + 1}:
- Timestamps: ${formatTime(s.start)} to ${formatTime(s.end)} (${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s, duration: ${dur}s)
- Brightness: ${Math.round((s.brightness || 0.5) * 100)}%
- Motion intensity: ${Math.round((s.motion || 0.1) * 100)}%`;
  }).join('\n\n');

  const promptText = `You are a master film director and AI video prompt engineer (for Veo, Runway Gen-3, Sora, Luma).
Analyze this complete sequence of ${scenes.length} chronological film scenes, using the attached keyframe images and timestamps.

Scene Metadata:
${sceneDescriptions}

${PROMPT_FORMULA_INSTRUCTIONS}

Task:
Analyze each scene in the context of the whole film's narrative and visual continuity.
For EVERY scene, generate a production-ready AI video prompt starting with its timestamp prefix.

Strict requirements for each scene in "scenes":
1. "scene_id": number (1, 2, ...)
2. "start": string in "MM:SS" (e.g. "${formatTime(scenes[0]?.start || 0)}")
3. "end": string in "MM:SS" (e.g. "${formatTime(scenes[0]?.end || 5)}")
4. "duration": number in seconds
5. "scene_summary": concise visual description of subject, action, lighting, and mood.
6. "weaknesses": array of up to 3 flaws.
7. "improved_prompt": production-ready prompt formatted as:
   "[MM:SS - MM:SS]: [Shot Type & Camera Movement] of [Subject & Action], set in [Environment/Setting]. [Lighting & Atmosphere], [Visual Style/Render Quality]."
8. "negative_prompt": targeted generative video artifacts to avoid.
9. "camera_tip": specific cinematography tip for focal length, camera movement, or stabilization.

Output ONLY valid JSON matching this schema:
{
  "film_summary": "Comprehensive overview of the film aesthetic, character consistency, and narrative arc",
  "scenes": [
    {
      "scene_id": 1,
      "start": "00:00",
      "end": "00:06",
      "duration": 6,
      "scene_summary": "...",
      "weaknesses": ["...", "..."],
      "improved_prompt": "[00:00 - 00:06]: ...",
      "negative_prompt": "...",
      "camera_tip": "..."
    }
  ]
}`;

  const parts = [{ text: promptText }];

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    parts.push({ text: `Keyframe image for Scene ${i + 1} (${formatTime(s.start)} - ${formatTime(s.end)}):` });
    const imgs = Array.isArray(s.images) ? s.images : (s.image ? [s.image] : []);
    for (const img of imgs) {
      const base64Data = img.replace(/^data:image\/(?:jpeg|jpg|png);base64,/, '');
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: base64Data
        }
      });
    }
  }

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
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

  text = text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  const result = JSON.parse(text);

  return {
    mode: 'full_video',
    film_summary: String(result.film_summary || 'Cohesive cinematic sequence prompt guide'),
    scenes: Array.isArray(result.scenes) ? result.scenes : [],
    is_offline: false
  };
}

// --- Vercel Serverless Function Handler ---
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
    try { body = JSON.parse(body); } catch (_) {}
  }
  body = body || {};

  const configuredModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  // -------------------------------------------------------------
  // BRANCH A: Full Video Analysis Mode
  // -------------------------------------------------------------
  if (body.mode === 'full_video') {
    const scenes = Array.isArray(body.scenes) ? body.scenes : [];
    if (!scenes.length) {
      res.status(400).json({ error: 'Full video mode requires an array of scenes with keyframes and timestamps.' });
      return;
    }

    try {
      let result;
      try {
        result = await callGeminiFullVideo(scenes, configuredModel);
      } catch (primaryErr) {
        console.warn(`Primary full video call (${configuredModel}) failed:`, primaryErr.message);
        const fallbackModel = (configuredModel === 'gemini-2.5-flash') ? 'gemini-flash-latest' : 'gemini-2.5-flash';
        if (process.env.GEMINI_API_KEY) {
          result = await callGeminiFullVideo(scenes, fallbackModel);
        } else {
          throw primaryErr;
        }
      }
      res.status(200).json(result);
    } catch (err) {
      console.warn('Falling back to rule-based full video mode:', err.message);
      const offlineResult = ruleBasedFullVideo(scenes);
      offlineResult.offline_reason = err.message;
      res.status(200).json(offlineResult);
    }
    return;
  }

  // -------------------------------------------------------------
  // BRANCH B: Single Scene Mode (Default)
  // -------------------------------------------------------------
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

  try {
    let result;
    try {
      result = await callGeminiSingleScene(images, stats, configuredModel);
    } catch (primaryErr) {
      console.warn(`Primary Gemini call (${configuredModel}) failed:`, primaryErr.message);
      const fallbackModel = (configuredModel === 'gemini-2.5-flash') ? 'gemini-flash-latest' : 'gemini-2.5-flash';
      if (process.env.GEMINI_API_KEY) {
        result = await callGeminiSingleScene(images, stats, fallbackModel);
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