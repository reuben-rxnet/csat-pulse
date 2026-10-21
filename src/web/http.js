'use strict';
// Minimal router + helpers on node:http (keeps the dependency list to pg and nodemailer).
const fs = require('fs');
const path = require('path');

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = r.re.exec(pathname);
      if (m) return { handlers: r.handlers, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

function formToObject(raw, multi) {
  const p = new URLSearchParams(raw), o = {};
  for (const [k, v] of p) o[k] = multi && k in o ? [].concat(o[k], v) : v;
  return o;
}

function readBody(req, limit = 64 * 1024, multi = false) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = (req.headers['content-type'] || '').split(';')[0].trim();
      try {
        if (type === 'application/json') resolve(raw ? JSON.parse(raw) : {});
        else if (type === 'application/x-www-form-urlencoded') resolve(formToObject(raw, multi));
        else resolve({ _raw: raw });
      } catch { reject(Object.assign(new Error('Invalid body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin', // never leaks survey-link tokens to other sites, but keeps Origin for our own POSTs
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
  res.end(body);
}
const html = (res, body, status = 200, extra) => send(res, status, body, 'text/html; charset=utf-8', extra);
const json = (res, obj, status = 200, extra) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
const redirect = (res, to, extra = {}) => { res.writeHead(303, { Location: to, ...SECURITY_HEADERS, ...extra }); res.end(); };

const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(dir) {
  return (req, res, pathname) => {
    const file = path.join(dir, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600', ...SECURITY_HEADERS });
    fs.createReadStream(file).pipe(res);
    return true;
  };
}

module.exports = { Router, readBody, send, html, json, redirect, serveStatic };
