'use strict';
// HDA sign-in protection: a rejected password stops further sign-in attempts (so an AD account can't be locked),
// while network problems (off VPN, timeouts) don't. Uses a fake fetch – no real HDA call is made.
const test = require('node:test');
const assert = require('node:assert');
const { HdaClient } = require('../src/hda/client');

const opts = { baseUrl: 'http://hda.test', authMode: 'login', username: 'someone', password: 'pw', timeoutMs: 2000 };
const reply = (status, body) => ({ status, ok: status < 400, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

function withFetch(handler, fn) {
  const real = global.fetch; let calls = 0;
  global.fetch = async (url, init) => { calls++; return handler(String(url), init, calls); };
  return Promise.resolve(fn(() => calls)).finally(() => { global.fetch = real; });
}

test('wrong password: one sign-in attempt, then paused until cleared', () => withFetch(
  () => reply(200, { success: false, result: { code: '1', desc: 'Invalid username or password' } }),
  async calls => {
    const c = new HdaClient(opts);
    await assert.rejects(c.getToken(), /Invalid username or password/);
    assert.ok(c.authStatus(), 'blocked after HDA rejected the sign-in');
    assert.match(c.authStatus().message, /someone.*stopped trying/);
    await assert.rejects(c.getToken(), /sign-in paused/);
    await assert.rejects(c.projection({ entity: 'Incident' }), /sign-in paused/);
    assert.strictEqual(calls(), 1, 'no further calls to HDA while paused');
    c.clearAuthBlock();
    await assert.rejects(c.getToken(), /Invalid username/);
    assert.strictEqual(calls(), 2, 'exactly one new attempt after Try again');
  }));

test('HTTP 401 from the sign-in call also pauses', () => withFetch(() => reply(401, 'Unauthorized'), async calls => {
  const c = new HdaClient(opts);
  await assert.rejects(c.getToken());
  await assert.rejects(c.getToken(), /paused/);
  assert.strictEqual(calls(), 1);
}));

test('off VPN (IIS 404 page) and network errors keep retrying – not a password problem', () => withFetch(
  (url, init, n) => { if (n === 1) return reply(404, '<html>Not Found</html>'); if (n === 2) throw new Error('ECONNRESET'); return reply(200, { success: true, requestToken: 'tok', expiresIn: 3300, result: { code: '0' } }); },
  async calls => {
    const c = new HdaClient(opts);
    await assert.rejects(c.getToken(), /VPN/);
    assert.strictEqual(c.authStatus(), null);
    await assert.rejects(c.getToken(), /ECONNRESET/);
    assert.strictEqual(c.authStatus(), null);
    assert.strictEqual(await c.getToken(), 'tok');
    assert.strictEqual(await c.getToken(), 'tok', 'token reused while valid');
    assert.strictEqual(calls(), 3);
  }));
