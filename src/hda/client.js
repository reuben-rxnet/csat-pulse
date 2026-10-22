'use strict';
// Thin client for the HDA (HelpDesk Advanced) REST API, following the HDA_REST_API Postman collection:
//   POST /Authentication/Token        (TokenMode=apikey | trusted)  -> requestToken, refreshToken, expiresIn
//   POST /Authentication/LoginEx      (username/password)
//   POST /Authentication/RefreshToken (apikey, token)
//   GET  /WSC/Projection, /WSC/List, /WSC/Get, /WSC/GetMetabase
//   POST /WSC/Set
// Every response carries { success, data, total, result: { code: '0' = OK, desc } }.
const config = require('../config');

class HdaError extends Error {
  constructor(message, info) { super(message); this.name = 'HdaError'; Object.assign(this, info); }
}

class HdaClient {
  constructor(opts = config.hda) {
    this.opts = opts;
    this.token = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    // Set when HDA itself rejects the sign-in (wrong or expired password). While set, no further sign-in is attempted,
    // so a changed AD password can't lock the account through repeated tries every few minutes.
    this.authBlocked = null; // { at: Date, message }
  }

  authStatus() { return this.authBlocked ? { ...this.authBlocked } : null; }
  // "Try again" (Admin settings) or a restart: allow one new sign-in attempt.
  clearAuthBlock() { this.authBlocked = null; this.token = null; this.refreshToken = null; }

  async _fetch(method, path, { query, form, jsonBody, auth = true } = {}) {
    const url = new URL(this.opts.baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    // Node's fetch sends "Accept-Language: *" by default, which makes HDA's LoginEx fail with code 99 "Unknown Error".
    const headers = { Accept: 'application/json', 'Accept-Language': this.opts.acceptLanguage || 'en-US' };
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) if (v !== undefined && v !== null) p.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      body = p.toString();
    }
    if (jsonBody) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(jsonBody); }
    if (auth) headers.Authorization = `Bearer ${await this.getToken()}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs || 30000);
    let res;
    try {
      res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    } catch (e) {
      throw new HdaError(`HDA request failed: ${method} ${path}: ${e.message}`, { path });
    } finally { clearTimeout(timer); }

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      // Off the corporate network the HDA host answers every API call with an IIS 404 page.
      const hint = res.status === 404 ? ' – HDA could not be reached. Check that this computer is connected to the company VPN or network, then try again.' : '';
      throw new HdaError(`HDA returned non-JSON (${res.status}) for ${path}${hint}`, { status: res.status, path, body: text.slice(0, 300) });
    }
    if (res.status === 401 && auth && !this._retrying) {
      this.token = null; this._retrying = true;
      try { return await this._fetch(method, path, { query, form, jsonBody, auth }); } finally { this._retrying = false; }
    }
    const code = json && json.result ? String(json.result.code) : undefined;
    if (!res.ok || json.success === false || (code !== undefined && code !== '0')) {
      const desc = json && json.result && (json.result.desc || json.result.subcode);
      throw new HdaError(`HDA error on ${path}: ${desc || res.status}`, { status: res.status, path, result: json && json.result });
    }
    return json;
  }

  async getToken() {
    if (this.token && Date.now() < this.expiresAt - 60_000) return this.token;
    if (this.authBlocked) throw new HdaError(`HDA sign-in paused: ${this.authBlocked.message}`, { authBlocked: true });
    try { return await this._signIn(); }
    catch (e) {
      // HDA answered (JSON) and said no → the credentials are the problem. Network errors and the off-VPN 404 page are not.
      if (e instanceof HdaError && !e.authBlocked && (e.result || [400, 401, 403].includes(e.status))) {
        const desc = String((e.result && (e.result.desc || e.result.subcode)) || (e.status ? `HTTP ${e.status}` : '')).trim();
        this.authBlocked = { at: new Date(), message: `HDA rejected the sign-in for "${this.opts.username || 'the API user'}"${desc ? ` (${desc})` : ''}. CSAT Pulse stopped trying so the account isn't locked.` };
        console.error('[hda] ' + this.authBlocked.message);
      }
      throw e;
    }
  }

  async _signIn() {
    if (this.refreshToken && this.opts.apiKey) {
      try { return this._store(await this._fetch('POST', '/Authentication/RefreshToken', { auth: false, form: { apikey: this.opts.apiKey, token: this.refreshToken } })); }
      catch { this.refreshToken = null; }
    }
    const o = this.opts;
    let json;
    if (o.authMode === 'login') {
      // Same call HDAConnect uses: JSON body { username, password }
      json = await this._fetch('POST', '/Authentication/LoginEx', { auth: false, jsonBody: { username: o.username, password: o.password } });
    } else if (o.authMode === 'trusted') {
      json = await this._fetch('POST', '/Authentication/Token', { auth: false, form: {
        ApiKey: o.apiKey, TokenMode: 'trusted', TrustedUsername: o.trustedUsername, TrustedPassword: o.trustedPassword,
        Username: o.username, SourceApplication: o.sourceApplication } });
    } else {
      json = await this._fetch('POST', '/Authentication/Token', { auth: false, form: {
        ApiKey: o.apiKey, TokenMode: 'apikey', Username: o.username, SourceApplication: o.sourceApplication } });
    }
    return this._store(json);
  }

  _store(json) {
    if (!json.requestToken) throw new HdaError('HDA authentication returned no requestToken', { result: json.result });
    this.token = json.requestToken;
    this.refreshToken = json.refreshToken || null;
    this.expiresAt = Date.now() + (Number(json.expiresIn) || 900) * 1000;
    return this.token;
  }

  projection({ entity, filter, columns, names, start = 0, limit = 200, sort }) {
    return this._fetch('GET', '/WSC/Projection', { query: { entity, filter, columnExpressions: columns, columnNames: names, start, limit, sort } });
  }
  list({ entity, filter, start = 0, limit = 200, sort }) {
    return this._fetch('GET', '/WSC/List', { query: { entity, filter, start, limit, sort } });
  }
  get(entity, id) { return this._fetch('GET', '/WSC/Get', { query: { entity, id } }); }
  metabase(entity) { return this._fetch('GET', '/WSC/GetMetabase', { query: { entity } }); }
  set(entity, id, data) { return this._fetch('POST', '/WSC/Set', { form: { entity, id, data } }); }
  ping() { return this._fetch('GET', '/WSC/Test', { auth: false }); }
}

let shared;
const hda = () => (shared ||= new HdaClient());

module.exports = { HdaClient, HdaError, hda };
