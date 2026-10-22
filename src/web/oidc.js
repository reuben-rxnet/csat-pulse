'use strict';
// Company single sign-on with OpenID Connect (authorization code flow + PKCE), for ADMIN_AUTH_MODE=oidc.
// Works with Microsoft Entra ID (issuer https://login.microsoftonline.com/<tenant-id>/v2.0) and other OIDC providers.
// No dependencies: discovery + JWKS over fetch, RS256 signature checks with node:crypto, and a signed session cookie.
const crypto = require('crypto');
const config = require('../config');

const SESSION_COOKIE = 'csat_session';
const FLOW_COOKIE = 'csat_oidc'; // state, nonce and PKCE verifier while the person is at the sign-in page
const b64u = buf => Buffer.from(buf).toString('base64url');
const rand = (n = 32) => b64u(crypto.randomBytes(n));

// ---------- signed cookies (HMAC-SHA256 with SESSION_SECRET) ----------
function sign(obj, secret = config.oidc.sessionSecret) {
  const body = b64u(JSON.stringify(obj));
  return `${body}.${b64u(crypto.createHmac('sha256', secret).update(body).digest())}`;
}
function unsign(value, secret = config.oidc.sessionSecret, now = Date.now()) {
  const [body, mac] = String(value || '').split('.');
  if (!body || !mac || !secret) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return o.exp && o.exp * 1000 > now ? o : null; } catch { return null; }
}
const secure = () => config.publicBaseUrl.startsWith('https://');
const cookie = (name, value, maxAgeSec) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${secure() ? '; Secure' : ''}; Max-Age=${maxAgeSec}`;

// ---------- provider metadata and keys (cached) ----------
let meta = null, metaAt = 0, jwks = null, jwksAt = 0;
async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.json();
}
async function discovery() {
  if (meta && Date.now() - metaAt < 24 * 3600e3) return meta;
  meta = await getJson(config.oidc.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration'); metaAt = Date.now();
  return meta;
}
async function signingKey(kid) {
  const find = () => (jwks && jwks.keys || []).find(k => k.kid === kid && (k.use || 'sig') === 'sig');
  // Keys rotate: refetch when the key isn't known yet (at most once a minute).
  if (!find() && Date.now() - jwksAt > 60e3) { jwks = await getJson((await discovery()).jwks_uri); jwksAt = Date.now(); }
  const k = find();
  if (!k) throw new Error('The sign-in token was signed with an unknown key');
  return crypto.createPublicKey({ key: k, format: 'jwk' });
}

// Checks an ID token: RS256 signature, issuer, audience, expiry and nonce. Returns its claims.
function verifyJwt(token, { key, issuer, audience, nonce, now = Date.now() / 1000, skew = 120 }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed sign-in token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`Unsupported token algorithm ${header.alg}`);
  if (!crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw new Error('Sign-in token signature is not valid');
  if (claims.iss !== issuer) throw new Error('Sign-in token is from an unexpected issuer');
  if (!(Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience)) throw new Error('Sign-in token is for a different application');
  if (!claims.exp || claims.exp + skew < now) throw new Error('Sign-in token has expired');
  if (claims.nbf && claims.nbf - skew > now) throw new Error('Sign-in token is not valid yet');
  if (nonce !== undefined && claims.nonce !== nonce) throw new Error('Sign-in token does not belong to this sign-in');
  return claims;
}
const headerKid = token => JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url').toString('utf8')).kid;

// The person behind the claims. login = what CSAT Pulse matches against ADMIN_EMAILS and HDA (User.USERUPN).
function identity(c) {
  const login = String(c.preferred_username || c.upn || c.email || c.unique_name || '').toLowerCase();
  return { login, name: c.name || login, roles: [].concat(c.roles || []), oid: c.oid || c.sub };
}

const redirectUri = () => config.publicBaseUrl + config.oidc.redirectPath;
const safeNext = n => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : '/admin');

// GET /auth/login → the provider's sign-in page.
async function startLogin(next) {
  const m = await discovery();
  const flow = { state: rand(), nonce: rand(), verifier: rand(48), next: safeNext(next), exp: Math.floor(Date.now() / 1000) + 600 };
  const challenge = b64u(crypto.createHash('sha256').update(flow.verifier).digest());
  const url = new URL(m.authorization_endpoint);
  url.search = new URLSearchParams({ client_id: config.oidc.clientId, response_type: 'code', redirect_uri: redirectUri(), scope: config.oidc.scopes,
    state: flow.state, nonce: flow.nonce, code_challenge: challenge, code_challenge_method: 'S256', response_mode: 'query' });
  return { location: url.toString(), setCookie: cookie(FLOW_COOKIE, sign(flow), 600) };
}

// GET /auth/callback?code&state → session cookie for the signed-in person.
async function finishLogin(query, flowCookie) {
  if (query.get('error')) throw new Error(`Sign-in was not completed: ${query.get('error_description') || query.get('error')}`);
  const flow = unsign(flowCookie);
  if (!flow || !query.get('state') || query.get('state') !== flow.state) throw new Error('This sign-in link has expired. Please sign in again.');
  const m = await discovery();
  const res = await fetch(m.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: query.get('code') || '', redirect_uri: redirectUri(), client_id: config.oidc.clientId,
      client_secret: config.oidc.clientSecret, code_verifier: flow.verifier }) });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.id_token) throw new Error(`The sign-in service refused the request: ${tok.error_description || tok.error || res.status}`);
  const claims = verifyJwt(tok.id_token, { key: await signingKey(headerKid(tok.id_token)), issuer: m.issuer, audience: config.oidc.clientId, nonce: flow.nonce });
  const who = identity(claims);
  if (!who.login) throw new Error('The sign-in did not say who you are (no username or email in the token).');
  const exp = Math.floor(Date.now() / 1000) + config.oidc.sessionHours * 3600;
  return { next: flow.next, who, setCookies: [cookie(SESSION_COOKIE, sign({ ...who, exp }), config.oidc.sessionHours * 3600), cookie(FLOW_COOKIE, '', 0)] };
}

// The signed-in person from the session cookie, or null.
function sessionUser(req, cookies) {
  const s = unsign(cookies[SESSION_COOKIE]);
  return s && s.login ? s : null;
}

// GET /auth/logout → clear the session, then sign out at the provider too when it supports that.
async function logoutTarget() {
  let end = null;
  try { end = (await discovery()).end_session_endpoint; } catch { /* provider unreachable: local sign-out only */ }
  const back = config.publicBaseUrl + '/auth/signed-out';
  return { location: end ? `${end}?${new URLSearchParams({ post_logout_redirect_uri: back, client_id: config.oidc.clientId })}` : back, setCookie: cookie(SESSION_COOKIE, '', 0) };
}

module.exports = { startLogin, finishLogin, sessionUser, logoutTarget, verifyJwt, identity, sign, unsign, redirectUri, safeNext, SESSION_COOKIE, FLOW_COOKIE };
