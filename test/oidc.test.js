'use strict';
// Company sign-in (OIDC): token checks and the signed session cookie. Uses a locally generated key – no network.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { verifyJwt, identity, sign, unsign, safeNext } = require('../src/web/oidc');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64u = b => Buffer.from(b).toString('base64url');
const jwt = (claims, key = privateKey, alg = 'RS256') => {
  const h = b64u(JSON.stringify({ alg, kid: 'k1' })), p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${b64u(crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key))}`;
};
const now = 1_800_000_000, iss = 'https://login.microsoftonline.com/tenant/v2.0', aud = 'client-123';
const good = { iss, aud, exp: now + 3600, nbf: now - 10, nonce: 'n1', preferred_username: 'Reuben.DSouza@essilor.com', name: "Reuben D'Souza", roles: ['CSAT.GlobalAdmin'] };
const check = (token, extra = {}) => verifyJwt(token, { key: publicKey, issuer: iss, audience: aud, nonce: 'n1', now, ...extra });

test('valid ID token is accepted and gives the person', () => {
  const who = identity(check(jwt(good)));
  assert.deepStrictEqual(who, { login: 'reuben.dsouza@essilor.com', name: "Reuben D'Souza", roles: ['CSAT.GlobalAdmin'], oid: undefined });
});

test('forged, foreign, expired or replayed tokens are rejected', () => {
  assert.throws(() => check(jwt(good, other.privateKey)), /signature/);
  assert.throws(() => check(jwt({ ...good, iss: 'https://evil.example' })), /issuer/);
  assert.throws(() => check(jwt({ ...good, aud: 'another-app' })), /different application/);
  assert.throws(() => check(jwt({ ...good, exp: now - 600 })), /expired/);
  assert.throws(() => check(jwt({ ...good, nonce: 'other' })), /does not belong/);
  assert.throws(() => check(jwt(good, privateKey, 'none')), /Unsupported/);
  const [h, p] = jwt(good).split('.');
  const tampered = `${h}.${b64u(JSON.stringify({ ...good, roles: ['CSAT.GlobalAdmin', 'x'] }))}.${jwt(good).split('.')[2]}`;
  assert.throws(() => check(tampered), /signature/);
  assert.ok(p);
});

test('session cookie: signed, tamper-proof and time-limited', () => {
  const secret = 'x'.repeat(40), exp = Math.floor(Date.now() / 1000) + 60;
  const c = sign({ login: 'a@essilor.com', roles: [], exp }, secret);
  assert.strictEqual(unsign(c, secret).login, 'a@essilor.com');
  assert.strictEqual(unsign(c, 'y'.repeat(40)), null, 'wrong secret');
  const [body, mac] = c.split('.');
  const forged = b64u(JSON.stringify({ login: 'admin@essilor.com', roles: ['CSAT.GlobalAdmin'], exp }));
  assert.strictEqual(unsign(`${forged}.${mac}`, secret), null, 'changed content');
  assert.strictEqual(unsign(c, secret, (exp + 1) * 1000), null, 'expired');
  assert.strictEqual(unsign('', secret), null);
  assert.ok(body);
});

test('after sign-in, only same-site paths are followed', () => {
  assert.strictEqual(safeNext('/admin/reports?x=1'), '/admin/reports?x=1');
  assert.strictEqual(safeNext('//evil.example/x'), '/admin');
  assert.strictEqual(safeNext('https://evil.example'), '/admin');
  assert.strictEqual(safeNext(undefined), '/admin');
});
