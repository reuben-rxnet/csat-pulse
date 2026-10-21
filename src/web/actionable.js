'use strict';
// Verifies the bearer token Outlook attaches to Actionable Message (Action.Http) requests.
// https://learn.microsoft.com/outlook/actionable-messages/security-requirements
const crypto = require('crypto');
const config = require('../config');

const JWKS_URL = 'https://substrate.office.com/sts/common/discovery/keys';
const ISSUER = 'https://substrate.office.com/sts/';
const OUTLOOK_APP_ID = '48af08dc-f6d2-435f-b2a7-069abd99c086';
let keys = null, keysAt = 0;

async function getKeys() {
  if (keys && Date.now() - keysAt < 12 * 3600e3) return keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  keys = (await res.json()).keys; keysAt = Date.now();
  return keys;
}

const b64 = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function verifyActionableToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('missing bearer token');
  const token = authHeader.slice(7);
  const [h, p, sig] = token.split('.');
  if (!sig) throw new Error('malformed token');
  const header = JSON.parse(b64(h).toString('utf8'));
  const payload = JSON.parse(b64(p).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  const jwk = (await getKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64(sig));
  if (!ok) throw new Error('bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== ISSUER) throw new Error('bad issuer');
  if (payload.exp && payload.exp < now - 60) throw new Error('token expired');
  if (payload.appid && payload.appid !== OUTLOOK_APP_ID) throw new Error('bad appid');
  const aud = String(payload.aud || '').replace(/\/$/, '');
  if (!config.publicBaseUrl.startsWith(aud) && aud !== new URL(config.publicBaseUrl).origin) throw new Error('bad audience');
  return { email: String(payload.sub || '').toLowerCase(), sender: payload.sender };
}

module.exports = { verifyActionableToken };
