'use strict';
// Fake OpenID Connect provider on :4020, for trying company sign-in before IAM has registered the app.
// It shows a one-click "sign in as" page; nothing here is secure – never point a real deployment at it.
//   .env: ADMIN_AUTH_MODE=oidc  OIDC_ISSUER=http://localhost:4020  OIDC_CLIENT_ID=csat-pulse  OIDC_CLIENT_SECRET=mock-secret
//         SESSION_SECRET=<32+ random characters>
const http = require('http');
const crypto = require('crypto');

const PORT = +process.env.MOCK_OIDC_PORT || 4020, ISSUER = `http://localhost:${PORT}`;
const CLIENT_ID = 'csat-pulse', CLIENT_SECRET = 'mock-secret';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'mock-key-1';
const USERS = [
  { login: 'reuben.dsouza@essilor.com', name: "Reuben D'Souza", roles: ['CSAT.GlobalAdmin'] },
  { login: 'team.admin@essilor.com', name: 'Team Admin (no HDA groups)', roles: [] },
];
const codes = new Map(); // code → { user, nonce, challenge, redirect_uri }
const b64u = b => Buffer.from(b).toString('base64url');
const jwt = claims => {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID })), body = b64u(JSON.stringify(claims));
  return `${head}.${body}.${b64u(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey))}`;
};
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

http.createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);
  if (url.pathname === '/.well-known/openid-configuration') return send(res, 200, { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys`, end_session_endpoint: `${ISSUER}/logout`, id_token_signing_alg_values_supported: ['RS256'] });
  if (url.pathname === '/keys') return send(res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] });
  if (url.pathname === '/authorize') {
    const q = url.searchParams;
    if (q.get('client_id') !== CLIENT_ID) return send(res, 400, 'Unknown client_id', 'text/plain');
    const pick = q.get('as');
    if (pick === null) {
      return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Mock sign-in</title><body style="font:15px Segoe UI,sans-serif;max-width:520px;margin:60px auto">
        <h2>Mock company sign-in</h2><p>Testing only. Pick who to sign in as:</p>${USERS.map((u, i) => `<p><a href="?${esc(new URLSearchParams({ ...Object.fromEntries(q), as: i }))}">${esc(u.name)}</a> <small>${esc(u.login)}${u.roles.length ? ' · ' + esc(u.roles.join(', ')) : ''}</small></p>`).join('')}
        <form><input type="hidden" name="as" value="custom">${[...q].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
        <p>Or any HDA user: <input name="login" placeholder="someone@essilor.com" required> <button>Sign in</button></p></form></body>`, 'text/html; charset=utf-8');
    }
    const user = pick === 'custom' ? { login: String(q.get('login') || '').toLowerCase(), name: q.get('login'), roles: [] } : USERS[+pick];
    if (!user || !user.login) return send(res, 400, 'Unknown user', 'text/plain');
    const code = crypto.randomBytes(16).toString('hex');
    codes.set(code, { user, nonce: q.get('nonce'), challenge: q.get('code_challenge'), redirect_uri: q.get('redirect_uri') });
    const back = new URL(q.get('redirect_uri')); back.searchParams.set('code', code); back.searchParams.set('state', q.get('state'));
    res.writeHead(302, { Location: back.toString() }); return res.end();
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    let raw = ''; for await (const c of req) raw += c;
    const f = new URLSearchParams(raw), c = codes.get(f.get('code'));
    if (f.get('client_id') !== CLIENT_ID || f.get('client_secret') !== CLIENT_SECRET) return send(res, 401, { error: 'invalid_client', error_description: 'Wrong client ID or secret' });
    if (!c || c.redirect_uri !== f.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant', error_description: 'Unknown or used code' });
    if (b64u(crypto.createHash('sha256').update(f.get('code_verifier') || '').digest()) !== c.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE check failed' });
    codes.delete(f.get('code'));
    const now = Math.floor(Date.now() / 1000);
    return send(res, 200, { token_type: 'Bearer', expires_in: 3600, access_token: 'mock-access-token',
      id_token: jwt({ iss: ISSUER, aud: CLIENT_ID, sub: c.user.login, oid: c.user.login, iat: now, nbf: now, exp: now + 3600, nonce: c.nonce,
        preferred_username: c.user.login, name: c.user.name, roles: c.user.roles }) });
  }
  if (url.pathname === '/logout') { res.writeHead(302, { Location: url.searchParams.get('post_logout_redirect_uri') || '/' }); return res.end(); }
  send(res, 404, 'Not found', 'text/plain');
}).listen(PORT, () => console.log(`[mock-oidc] fake company sign-in on ${ISSUER} (client ${CLIENT_ID} / ${CLIENT_SECRET})`));
