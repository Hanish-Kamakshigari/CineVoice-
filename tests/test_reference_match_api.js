/* Node tests for api/reference-match.js using a stubbed Gemini fetch. */
'use strict';

const path = require('path');
const { EventEmitter } = require('events');

process.env.GEMINI_API_KEY = 'test-key-' + '0'.repeat(20);
process.env.GEMINI_MODEL = 'gemini-2.5-flash';
const handler = require(path.join('..', 'api', 'reference-match.js'));

let failed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log('ok -', name),
    (e) => { failed++; console.log('FAIL -', name, '::', e.message); }
  );
}

function mockRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (b) => { res.body = b; };
  return res;
}
function mockReq(method, rawBody) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { 'content-length': String(Buffer.byteLength(rawBody || '')) };
  if (rawBody !== undefined) process.nextTick(() => req.emit('data', Buffer.from(rawBody)) && req.emit('end'));
  else process.nextTick(() => req.emit('end'));
  return req;
}
function parse(res) { return JSON.parse(res.body); }
const JPEG = 'data:image/jpeg;base64,' + 'A'.repeat(200);
const frame = () => JPEG;

(async () => {
  await check('GET is rejected with 405', async () => {
    const res = mockRes();
    await handler(mockReq('GET'), res);
    if (res.statusCode !== 405) throw new Error('status ' + res.statusCode);
  });

  await check('invalid JSON body returns 400', async () => {
    const res = mockRes();
    await handler(mockReq('POST', '{not json'), res);
    if (res.statusCode !== 400) throw new Error('status ' + res.statusCode);
    if (!/Invalid JSON/.test(parse(res).error)) throw new Error('wrong error');
  });

  await check('oversized request returns 413', async () => {
    const res = mockRes();
    const req = mockReq('POST', 'x');
    req.headers = { 'content-length': String(5_000_000) };
    await handler(req, res);
    if (res.statusCode !== 413) throw new Error('status ' + res.statusCode);
  });

  await check('missing frames returns 400', async () => {
    const res = mockRes();
    await handler(mockReq('POST', JSON.stringify({ deltas: {}, frames: { uploaded: [], reference: [frame()] } })), res);
    if (res.statusCode !== 400) throw new Error('status ' + res.statusCode);
  });

  await check('malformed frame dataURL returns 400', async () => {
    const res = mockRes();
    await handler(mockReq('POST', JSON.stringify({ deltas: {}, frames: { uploaded: ['http://evil'], reference: [frame()] } })), res);
    if (res.statusCode !== 400) throw new Error('status ' + res.statusCode);
  });

  await check('happy path parses fenced JSON and sanitizes suggestion enums', async () => {
    const canned = {
      summary: 'Cooler and flatter.',
      similarity_score: 61.4,
      suggestions: [{ category: 'weird', issue: 'shadows are teal-neutral', fix: 'push shadows teal', timestamp: '00:12', priority: 'EXTREME' }],
      better_prompt: 'A moody teal-orange city dawn look...'
    };
    global.fetch = async () => ({
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(canned) + '\n```' }] } }] })
    });
    const res = mockRes();
    await handler(mockReq('POST', JSON.stringify({
      deltas: { brightnessPct: -22 },
      notes: 'moody thriller feel please',
      frames: { uploaded: [frame(), frame()], reference: [frame()] }
    })), res);
    const body = parse(res);
    if (res.statusCode !== 200 || !body.ok) throw new Error('status ' + res.statusCode + ' body ' + res.body);
    if (body.result.summary !== 'Cooler and flatter.') throw new Error('summary lost');
    if (body.result.similarity_score !== 61.4) throw new Error('score not passed through');
    const s = body.result.suggestions[0];
    if (s.category !== 'color') throw new Error('category not sanitized: ' + s.category);
    if (s.priority !== 'medium') throw new Error('priority not sanitized: ' + s.priority);
    if (s.timestamp !== '00:12') throw new Error('timestamp lost');
  });

  await check('garbage model output on both attempts returns 502', async () => {
    global.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Sorry, I cannot help with that.' }] } }] }) });
    const res = mockRes();
    await handler(mockReq('POST', JSON.stringify({ deltas: {}, frames: { uploaded: [frame()], reference: [frame()] } })), res);
    if (res.statusCode !== 502) throw new Error('status ' + res.statusCode);
  });

  await check('provider rate limit surfaces as 429 with friendly error', async () => {
    global.fetch = async () => ({ status: 429, text: async () => '{"error":"quota"}' });
    const res = mockRes();
    await handler(mockReq('POST', JSON.stringify({ deltas: {}, frames: { uploaded: [frame()], reference: [frame()] } })), res);
    if (res.statusCode !== 429) throw new Error('status ' + res.statusCode);
    if (!/rate limit/i.test(parse(res).error)) throw new Error('unfriendly message');
  });

  console.log(failed ? failed + ' test(s) failed' : 'all api tests passed');
  process.exit(failed ? 1 : 0);
})();
