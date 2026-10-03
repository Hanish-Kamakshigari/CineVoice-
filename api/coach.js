// /api/coach.js — Vercel serverless function (CommonJS)
// Expert Computer Vision Cinematographer and AI Video Prompt Engineer.
// Deconstructs user-uploaded video segments and outputs reproduction-ready prompts for generative models.

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

// --- Computer Vision System Prompt & Operating Rules ---
const CV_CINEMATOGRAPHER_SYSTEM_PROMPT = `
You are an expert Computer Vision Cinematographer and AI Video Prompt Engineer. 

Your sole task is to analyze user-uploaded video segments, deconstruct their exact visual, technical, and stylistic mechanics, and output hyper-accurate, reproduction-ready prompts optimized for modern generative video models (e.g., Kling, Sora, Runway Gen-3, Luma Dream Machine).

---

### CORE OPERATING RULES

1. ZERO GENERIC HALLUCINATIONS:
   Never default to boilerplate "indie film" tropes (e.g., "protagonist in deep contemplation", "moody deep shadow corridors", "melancholic atmosphere") unless the footage explicitly shows that. If the video is a corporate ad, UGC social media reel, 3D motion graphic, or UI mockup, reflect that exact genre.

2. DETECT THE ASSET TYPE FIRST:
   Classify each scene into one of three categories before writing:
   - Live-Action / Cinematic (Actors, physical locations, real lighting)
   - Mixed-Media / AR Overlay (Actors interacting with HUDs, floating UI, holographic graphics)
   - Pure Motion Design / UI (Dashboards, typography, abstract 3D elements, graphic slides)

3. RESPECT ASPECT RATIO & PACE:
   Always state the framing geometry (Vertical 9:16 vs. Landscape 16:9) and pace (fast dynamic commercial cuts vs. slow continuous tracking).

4. AVOID CONFLICTING DIRECTIVES:
   Do not mix conflicting focal lengths (e.g., don't write "28mm wide shot" and "crisp 50mm portrait" in the same block).

---

### OUTPUT FORMAT SPECIFICATION

For each distinct scene or cut, output strictly in the following format:

- Asset Type: [Live-Action | Mixed-Media AR | Motion Graphics | Screen UI]
- Framing & Aspect: [Vertical 9:16 | Landscape 16:9 | Close-up | Medium | Wide]

RECREATION PROMPT:
[Timestamp Range]: [Framing, lens/focal length, and camera motion]. [Exact subject details: demographic, clothing, action, and direction of movement]. [Environment/setting: interior/exterior, architecture, specific background props]. [Lighting and color grade: high-key commercial, cyber-neon accents, diffused daylight, exact color palette]. [Special elements: floating HUDs, UI elements, motion graphics, VFX]. [Frame rate, visual resolution, aesthetic target].

NEGATIVE PROMPT:
[List 8-12 scene-specific artifacts and stylistic elements to explicitly avoid based on the scene type].

CAMERA & GENERATION TIP:
[Specific advice on motion bucket/intensity, prompt weights, shutter/camera movement consistency, and whether to use image-to-video or text-to-video for best fidelity].

---

### FEW-SHOT EXAMPLES

#### Example 1: Mixed-Media / Corporate Commercial
- Asset Type: Mixed-Media AR / Commercial
- Framing & Aspect: Vertical 9:16 | Full-body to Medium tracking shot
RECREATION PROMPT:
[00:00 - 00:07]: Vertical 9:16 commercial video, eye-level smooth forward tracking shot on a 28mm wide lens. A sharp, confident young South Asian professional man in a crisp white tailored dress shirt and slate gray trousers walks purposefully down an ultra-modern glass office corridor carrying a closed silver laptop. Translucent glowing blue and purple holographic data widgets and line graphs float organically beside him in mid-air. Bright corporate high-key lighting with soft reflections on white polished floors, pristine 4K commercial broadcast quality, crisp focus, 24fps.
NEGATIVE PROMPT:
Moody film grain, dark shadows, cinematic lens dirt, distorted hands, floating laptop artifacts, warped geometry, flickering HUD text, low dynamic range, jittery motion.
CAMERA & GENERATION TIP:
Motion scale 25-30%. Use image-to-video seeded from a clean front-facing still to ensure face identity and corporate cleanliness are preserved across the forward dolly movement.

#### Example 2: Pure 3D Motion Graphics / UI
- Asset Type: Motion Graphics / UI
- Framing & Aspect: Vertical 9:16 | Dynamic 3D angled screen perspective
RECREATION PROMPT:
[00:20 - 00:35]: Vertical 9:16 dynamic 3D motion design sequence. Floating glossy glassmorphic social media feed tiles, glowing conversion funnel diagrams, and neon purple line graphs animating across a deep dark navy digital background. Smooth diagonal camera drift over sleek data metrics with subtle volumetric glow and depth of field, high-end tech SaaS product video aesthetic, 60fps fluidity, ultra-sharp vector lines.
NEGATIVE PROMPT:
Live-action humans, real-world rooms, noisy compression, pixelated text, photorealistic skin textures, naturalistic daylight, shaky cam.
CAMERA & GENERATION TIP:
Set camera motion to slow smooth pan with zero organic sway. Generative models struggle with real-time text—generate base assets cleanly and composite kinetic typography in post-production.
`;

// --- Rule-Based Fallback Prompt Generator (Zero Indie Hallucinations) ---
function ruleBasedPrompt(brightness, motion, start, end, sceneIndex = 1, aspectInfo = {}) {
  const durationSec = Math.max(1, Math.round((end || 8) - (start || 0)));
  const bPercent = Math.round(brightness * 100);
  const mPercent = Math.round(motion * 100);

  const isVertical = aspectInfo.aspect === '9:16' || (aspectInfo.height && aspectInfo.width && aspectInfo.height > aspectInfo.width);
  const aspectLabel = isVertical ? 'Vertical 9:16' : 'Landscape 16:9';

  let shotAndCamera = 'Eye-level smooth tracking shot';
  let motionWeakness = null;

  if (motion < 0.04) {
    shotAndCamera = 'Clean, static locked-off perspective';
    motionWeakness = 'Static scene: lacks dynamic kinetic movement';
  } else if (motion <= 0.16) {
    shotAndCamera = 'Smooth linear forward tracking shot on a 28mm wide lens';
  } else if (motion <= 0.35) {
    shotAndCamera = 'Dynamic angled camera drift with subtle organic micro-sway, 24mm lens';
  } else {
    shotAndCamera = 'Kinetic high-motion camera tracking sequence';
    motionWeakness = 'High motion: risk of visual jitter and temporal warping artifacts';
  }

  let lighting = 'balanced clean ambient lighting with neutral color grade';
  let lightWeakness = null;
  let setting = 'modern structured visual setting with crisp geometric separation';

  if (brightness < 0.25) {
    lighting = 'low-key lighting with subtle rim accents and high contrast';
    lightWeakness = 'Under-exposed: shadow details risk crushing in darker zones';
  } else if (brightness > 0.70) {
    lighting = 'high-key bright commercial lighting with clean highlights';
    lightWeakness = 'High exposure: highlights risk blown-out clipping';
  }

  const timeRange = `[${formatTime(start)} - ${formatTime(end)}]`;
  const recreationPrompt = `${timeRange}: ${aspectLabel} video, ${shotAndCamera}. Primary visual elements and focal subjects positioned within ${setting}. ${lighting}, crisp optical definition, pristine broadcast quality, 24fps. (${durationSec}s)`;
  const negativePrompt = 'Distorted anatomy, warped geometry, flickering artifacts, low dynamic range, jittery motion, duplicate elements, pixelation, motion stutter, compression noise.';
  const cameraTip = `Scene brightness ${bPercent}%, motion ${mPercent}%. Suggested motion scale ${Math.min(45, Math.max(15, mPercent))}%. For maximum reproduction fidelity, seed with image-to-video using a clean keyframe still.`;

  const weaknesses = [];
  if (lightWeakness) weaknesses.push(lightWeakness);
  if (motionWeakness) weaknesses.push(motionWeakness);
  if (weaknesses.length === 0) {
    weaknesses.push('Focal depth separation between foreground elements and background can be strengthened');
  }

  return {
    asset_type: 'Live-Action / Cinematic',
    framing_aspect: `${aspectLabel} | ${shotAndCamera.split(' on ')[0]}`,
    scene_summary: `Video segment from ${formatTime(start)} to ${formatTime(end)} (${bPercent}% brightness, ${mPercent}% motion).`,
    weaknesses: weaknesses.slice(0, 3),
    improved_prompt: recreationPrompt,
    recreation_prompt: recreationPrompt,
    negative_prompt: negativePrompt,
    camera_tip: cameraTip,
    is_offline: true,
    offline_mode: true
  };
}

// --- Rule-Based Fallback for Full Video ---
function ruleBasedFullVideo(scenes, aspectInfo = {}) {
  return {
    film_summary: `Sequential scene-by-scene computer vision analysis for ${scenes.length} detected video scenes (offline mode).`,
    scenes: scenes.map((s, idx) => {
      const single = ruleBasedPrompt(s.brightness || 0.5, s.motion || 0.1, s.start, s.end, idx + 1, aspectInfo);
      return {
        scene_id: idx + 1,
        start: formatTime(s.start),
        end: formatTime(s.end),
        duration: Math.max(1, Math.round(s.end - s.start)),
        asset_type: single.asset_type,
        framing_aspect: single.framing_aspect,
        scene_summary: single.scene_summary,
        weaknesses: single.weaknesses,
        improved_prompt: single.improved_prompt,
        recreation_prompt: single.recreation_prompt,
        negative_prompt: single.negative_prompt,
        camera_tip: single.camera_tip
      };
    }),
    is_offline: true,
    offline_mode: true
  };
}

// --- Gemini API Call: Single Scene ---
async function callGeminiSingleScene(images, stats, aspectInfo, modelName) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const sceneDuration = Math.max(1, Math.round(stats.end - stats.start));
  const aspectDesc = aspectInfo.aspect || (aspectInfo.width && aspectInfo.height ? `${aspectInfo.width}x${aspectInfo.height}` : 'Auto-detect');

  const promptText = `${CV_CINEMATOGRAPHER_SYSTEM_PROMPT}

Analyze these 3 chronological keyframes (start, middle, end) from this specific video segment.

Video & Scene Parameters:
- Native Video Geometry: ${aspectDesc} (Dimensions: ${aspectInfo.width || 'unknown'}x${aspectInfo.height || 'unknown'})
- Scene Start: ${formatTime(stats.start)} (${stats.start.toFixed(2)}s)
- Scene End: ${formatTime(stats.end)} (${stats.end.toFixed(2)}s)
- Duration: ~${sceneDuration}s
- Measured Brightness (0-1): ${stats.brightness.toFixed(2)}
- Motion Intensity (0-1): ${stats.motion.toFixed(2)}

Instructions:
1. "asset_type": Classify exactly as one of: "Live-Action", "Mixed-Media AR", "Motion Graphics", or "Screen UI".
2. "framing_aspect": State the framing geometry and lens perspective (e.g. "Vertical 9:16 | Full-body tracking" or "Landscape 16:9 | Medium close-up").
3. "scene_summary": Factual, grounded breakdown of subjects, actions, lighting, and palette without inventing unshown characters or melodramatic indie tropes.
4. "weaknesses": Array of 1-3 technical flaws or generative model rendering challenges.
5. "improved_prompt": The RECREATION PROMPT starting with [${formatTime(stats.start)} - ${formatTime(stats.end)}]: following the exact prompt specification.
6. "negative_prompt": 8-12 scene-specific artifacts to avoid based on the asset type.
7. "camera_tip": Specific advice on motion scale/intensity, prompt weights, and image-to-video vs text-to-video.

Output ONLY valid JSON matching this schema:
{
  "asset_type": "Live-Action | Mixed-Media AR | Motion Graphics | Screen UI",
  "framing_aspect": "Geometry and shot type",
  "scene_summary": "Concise factual breakdown",
  "weaknesses": ["Flaw or generation challenge 1", "Flaw or generation challenge 2"],
  "improved_prompt": "[${formatTime(stats.start)} - ${formatTime(stats.end)}]: ...",
  "negative_prompt": "Targeted negative prompt listing 8-12 visual artifacts to avoid",
  "camera_tip": "Specific generation advice on motion scale and pipeline"
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
      temperature: 0.5,
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

  const promptResult = String(result.improved_prompt || result.recreation_prompt || '');
  if (!promptResult) {
    throw new Error('Response JSON is missing improved_prompt / recreation_prompt');
  }

  return {
    asset_type: String(result.asset_type || 'Live-Action'),
    framing_aspect: String(result.framing_aspect || 'Landscape 16:9'),
    scene_summary: String(result.scene_summary || ''),
    weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses.map(String) : [],
    improved_prompt: promptResult,
    recreation_prompt: promptResult,
    negative_prompt: String(result.negative_prompt || ''),
    camera_tip: String(result.camera_tip || ''),
    is_offline: false
  };
}

// --- Gemini API Call: Whole Video (Multiple Scenes with Timestamps) ---
async function callGeminiFullVideo(scenes, aspectInfo, modelName) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const aspectDesc = aspectInfo.aspect || (aspectInfo.width && aspectInfo.height ? `${aspectInfo.width}x${aspectInfo.height}` : 'Auto-detect');

  const sceneDescriptions = scenes.map((s, idx) => {
    const dur = Math.max(1, Math.round(s.end - s.start));
    return `Scene ${idx + 1}:
- Timestamps: ${formatTime(s.start)} to ${formatTime(s.end)} (${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s, duration: ${dur}s)
- Brightness: ${Math.round((s.brightness || 0.5) * 100)}%
- Motion intensity: ${Math.round((s.motion || 0.1) * 100)}%`;
  }).join('\n\n');

  const promptText = `${CV_CINEMATOGRAPHER_SYSTEM_PROMPT}

Analyze this complete sequence of ${scenes.length} chronological video scenes using the attached keyframe images and timestamps.

Video Metadata:
- Native Geometry: ${aspectDesc} (Dimensions: ${aspectInfo.width || 'unknown'}x${aspectInfo.height || 'unknown'})

Scene Metadata:
${sceneDescriptions}

Task:
Analyze each scene with zero generic hallucinations. Detect asset type, framing & aspect, exact recreation prompt, negative prompt, and camera & generation tips for each scene.

Output ONLY valid JSON matching this schema:
{
  "film_summary": "Comprehensive overview of the video aesthetic, asset type continuity, and pacing",
  "scenes": [
    {
      "scene_id": 1,
      "start": "00:00",
      "end": "00:06",
      "duration": 6,
      "asset_type": "Live-Action | Mixed-Media AR | Motion Graphics | Screen UI",
      "framing_aspect": "Vertical 9:16 | Landscape 16:9 | Close-up | Medium | Wide",
      "scene_summary": "Factual visual description",
      "weaknesses": ["Flaw or generation challenge 1", "Flaw or generation challenge 2"],
      "improved_prompt": "[00:00 - 00:06]: ...",
      "negative_prompt": "8-12 scene-specific artifacts to avoid",
      "camera_tip": "Specific generation tip on motion scale and i2v vs t2v"
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
      temperature: 0.5,
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
    film_summary: String(result.film_summary || 'Cohesive video sequence prompt guide'),
    scenes: Array.isArray(result.scenes) ? result.scenes.map(s => Object.assign({}, s, {
      recreation_prompt: s.improved_prompt || s.recreation_prompt
    })) : [],
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

  const aspectInfo = {
    aspect: body.aspect || null,
    width: parseInt(body.width, 10) || null,
    height: parseInt(body.height, 10) || null
  };

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
        result = await callGeminiFullVideo(scenes, aspectInfo, configuredModel);
      } catch (primaryErr) {
        console.warn(`Primary full video call (${configuredModel}) failed:`, primaryErr.message);
        const fallbackModel = (configuredModel === 'gemini-2.5-flash') ? 'gemini-flash-latest' : 'gemini-2.5-flash';
        if (process.env.GEMINI_API_KEY) {
          result = await callGeminiFullVideo(scenes, aspectInfo, fallbackModel);
        } else {
          throw primaryErr;
        }
      }
      res.status(200).json(result);
    } catch (err) {
      console.warn('Falling back to rule-based full video mode:', err.message);
      const offlineResult = ruleBasedFullVideo(scenes, aspectInfo);
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
      result = await callGeminiSingleScene(images, stats, aspectInfo, configuredModel);
    } catch (primaryErr) {
      console.warn(`Primary Gemini call (${configuredModel}) failed:`, primaryErr.message);
      const fallbackModel = (configuredModel === 'gemini-2.5-flash') ? 'gemini-flash-latest' : 'gemini-2.5-flash';
      if (process.env.GEMINI_API_KEY) {
        result = await callGeminiSingleScene(images, stats, aspectInfo, fallbackModel);
      } else {
        throw primaryErr;
      }
    }
    res.status(200).json(result);
  } catch (err) {
    console.warn('Falling back to rule-based offline mode:', err.message);
    const offlineResult = ruleBasedPrompt(stats.brightness, stats.motion, stats.start, stats.end, 1, aspectInfo);
    offlineResult.offline_reason = err.message;
    res.status(200).json(offlineResult);
  }
};