/* Node tests for reference_match.js pure helpers (no DOM needed). */
'use strict';

const rm = require('../reference_match.js');

function metricObj(overrides) {
  const base = {
    brightness: { mean: 100, spread: 40, crushedPercent: 2, clippedPercent: 0.2 },
    warmth: { rbRatio: 1.0, label: 'neutral' },
    saturation: { mean: 0.4, spread: 0.2 },
    tint: { shadows: 0, midtones: 0, highlights: 0 },
    palette: [[20, 40, 80], [80, 120, 160], [140, 180, 220], [200, 220, 240], [10, 20, 40]],
    motion: { frameDiff: 0.1, cutRate: 0.3 },
    sharpness: 500,
    letterboxPercent: 0,
    aspect: { ratio: 1.78, label: '16:9' }
  };
  return Object.assign(base, overrides || {});
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok -', name);
  } catch (e) {
    failed++;
    console.log('FAIL -', name, '::', e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

check('pctDelta basic math', function () {
  assert(rm.pctDelta(78, 100) === -22, 'got ' + rm.pctDelta(78, 100));
  assert(rm.pctDelta(122, 100) === 22, 'positive delta');
  assert(rm.pctDelta(50, 0) === 0, 'zero reference is safe');
});

check('deltaLabel wording', function () {
  assert(rm.deltaLabel('brightness', -22) === 'darker by 22%');
  assert(rm.deltaLabel('saturation', 18) === 'more saturated (18%)');
  assert(rm.deltaLabel('cutRate', 3) === 'about the same');
  assert(rm.deltaLabel('cutRate', 40) === 'cuts 40% faster');
});

check('computeDeltas produces readable labels', function () {
  const u = metricObj({ brightness: { mean: 78, spread: 40, crushedPercent: 2, clippedPercent: 0.2 }, warmth: { rbRatio: 0.85, label: 'cool' }, motion: { cutRate: 0.2 }, sharpness: 300 });
  const r = metricObj({ motion: { cutRate: 0.4 } });
  const d = rm.computeDeltas(u, r);
  assert(d.brightnessLabel === 'darker by 22%', d.brightnessLabel);
  assert(d.warmthDirection.indexOf('cooler') === 0, d.warmthDirection);
  assert(d.sharpnessLabel === 'softer by 40%', d.sharpnessLabel);
  assert(d.cutRateLabel === 'cuts 50% slower', d.cutRateLabel);
  assert(d.letterboxUploaded === false && d.letterboxReference === false);
});

check('ruleSuggestions: dark + desaturated gets high priority fixes', function () {
  const u = metricObj({ brightness: { mean: 70, spread: 30, crushedPercent: 2, clippedPercent: 0.2 } });
  const r = metricObj({ saturation: { mean: 0.6, spread: 0.2 }, motion: { cutRate: 0.5 } });
  const d = rm.computeDeltas(u, r);
  const tips = rm.ruleSuggestions(d);
  const exposure = tips.find(function (t) { return t.category === 'lighting'; });
  assert(exposure, 'lighting tip exists');
  assert(/Raise exposure/i.test(exposure.fix), 'suggests raising exposure');
  assert(exposure.priority === 'high', 'dark exposure is high priority');
  const pace = tips.find(function (t) { return t.category === 'pacing'; });
  assert(pace, 'pacing tip exists when cut rates differ');
});

check('ruleSuggestions: reference letterbox suggests adding bars', function () {
  const u = metricObj() , r = metricObj({ letterboxPercent: 12 });
  const d = rm.computeDeltas(u, r);
  const framing = rm.ruleSuggestions(d).find(function (t) { return t.category === 'framing'; });
  assert(framing && /letterbox/i.test(framing.fix));
});

check('ruleSuggestions: close metrics fall back to polish advice', function () {
  const d = rm.computeDeltas(metricObj(), metricObj());
  const tips = rm.ruleSuggestions(d);
  assert(tips.length === 1 && /No large numeric differences/i.test(tips[0].issue));
});

check('paletteDistance: identical 0, similar low, disjoint high', function () {
  const a = [[0, 0, 0], [50, 50, 50], [100, 100, 100], [150, 150, 150], [200, 200, 200]];
  const far = [[250, 0, 0], [0, 250, 0], [0, 0, 250], [250, 250, 250], [255, 0, 0]];
  const near = a.map(function (c) { return [c[0] + 6, c[1] + 6, c[2] + 6]; });
  assert(rm.paletteDistance(a, a) === 0, 'same palette');
  assert(rm.paletteDistance(a, near) < 10, 'slightly shifted palette should score low, got ' + rm.paletteDistance(a, near));
  assert(rm.paletteDistance(a, far) > 25, 'disjoint palettes should score much higher, got ' + rm.paletteDistance(a, far));
});

check('aspectOf recognizable ratios', function () {
  assert(rm.aspectOf(1920, 1080).label === '16:9');
  assert(rm.aspectOf(1080, 1920).label.indexOf('vertical') !== -1);
  assert(rm.aspectOf(2400, 1000).label === '2.39:1 (scope)');
});

if (failed) {
  console.log(failed + ' test(s) failed');
  process.exit(1);
}
console.log('all reference_match tests passed');
