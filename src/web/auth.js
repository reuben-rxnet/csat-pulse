'use strict';
// Admin protection.
//  - basic:    HTTP Basic auth with ADMIN_USERNAME / ADMIN_PASSWORD (pilot, internal network).
//  - oidc:     company single sign-on (OpenID Connect, e.g. Microsoft Entra ID) handled by CSAT Pulse itself – see oidc.js.
//              Global admins = ADMIN_EMAILS or the OIDC_ADMIN_ROLE app role; everyone else is a team admin.
//  - easyauth: Azure App Service Authentication (Entra ID) in front of the app; the platform injects
//              X-MS-CLIENT-PRINCIPAL-NAME. Optionally restricted to ADMIN_EMAILS. Only use this mode when the
//              app is reachable exclusively through App Service, otherwise the header could be forged.
const crypto = require('crypto');
const config = require('../config');
const oidc = require('./oidc');

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Who is signing in. global = may see and change everything; other users become team admins (see services/access.js).
function adminUser(req) {
  const a = config.admin;
  if (a.authMode === 'oidc') {
    const s = oidc.sessionUser(req, cookies(req));
    if (!s) return null;
    return { name: s.login, displayName: s.name, global: a.allowedEmails.includes(s.login) || s.roles.includes(config.oidc.adminRole) };
  }
  if (a.authMode === 'easyauth') {
    const name = String(req.headers['x-ms-client-principal-name'] || '').toLowerCase();
    if (!name) return null;
    return { name, global: a.allowedEmails.includes(name) };
  }
  if (!a.password) return null;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return null;
  const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  return safeEqual(u, a.username) && safeEqual(rest.join(':'), a.password) ? { name: u, global: true } : null;
}

// Blocks cross-site POSTs to admin endpoints (basic-auth credentials are sent automatically by browsers).
function sameOrigin(req) {
  // Modern browsers say directly whether a request came from this site.
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  // Older browsers: compare Origin/Referer. ("null" is what browsers send under a no-referrer policy.)
  const origin = [req.headers.origin, req.headers.referer].find(v => v && v !== 'null');
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    return host === req.headers.host || host === new URL(config.publicBaseUrl).host;
  } catch { return false; }
}

// Settings missing for the chosen sign-in mode (empty = fine). The admin pages stay locked until they are set.
function authProblems() {
  const a = config.admin, o = config.oidc, out = [];
  if (a.authMode === 'basic' && !a.password) out.push('ADMIN_PASSWORD');
  if (a.authMode === 'oidc') {
    for (const [k, v] of [['OIDC_ISSUER', o.issuer], ['OIDC_CLIENT_ID', o.clientId], ['OIDC_CLIENT_SECRET', o.clientSecret]]) if (!v) out.push(k);
    if (o.sessionSecret.length < 32) out.push('SESSION_SECRET (at least 32 characters)');
  }
  return out;
}

module.exports = { adminUser, sameOrigin, cookies, authProblems };
