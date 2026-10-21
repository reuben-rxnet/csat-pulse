'use strict';
// Mock HDA REST API for local development. Mirrors the shape of the HDA_REST_API Postman collection
// (Authentication/Token, WSC/Projection, WSC/List, WSC/GetMetabase, WSC/Set) with generated data.
// A new ticket closes every MOCK_CLOSE_EVERY_SECONDS so the poller has something to pick up.
const http = require('http');
const crypto = require('crypto');

const PORT = +(process.env.MOCK_HDA_PORT || 4010);
const API_KEY = process.env.MOCK_HDA_API_KEY || 'mock-api-key';
const CLOSE_EVERY = +(process.env.MOCK_CLOSE_EVERY_SECONDS || 120);
const tokens = new Set();

const SOURCES = [['F1DEF', 'Web', true], ['F2DEF', 'EMail', true], ['F2C', 'Phone', true], ['F12L', 'Chat', true], ['F13L', 'Walk-in', true], ['F3DEF', 'Fax', false]]
  .map(([ID, Description, Active]) => ({ ID, Description, Active }));
const GROUPS = [
  ['G101', 'GSD – Global Service Desk L1'], ['G102', 'EUS – End User Support India'], ['G103', 'EUS – End User Support Europe'],
  ['G104', 'M365 Collaboration'], ['G105', 'IAM – Access Management'], ['G106', 'Network Operations'],
  ['G107', 'SAP Basis Support'], ['G108', 'Retail POS Support'], ['G109', 'Rx Lab Systems'], ['G110', 'Security Operations'],
].map(([ID, Description]) => ({ ID, Description }));
const SOURCES = ['Self-service portal', 'Email', 'Phone', 'Teams chat', 'Walk-in', 'Monitoring'];
const AGENTS = ['Priya N.', 'Rahul S.', 'Marta G.', 'Luca B.', 'Anil K.', 'Sophie D.', 'Kiran P.', 'Elena R.'];
const PEOPLE = [['Anjali Rao', 'anjali.rao'], ['Marco Bianchi', 'marco.bianchi'], ['Sarah Lee', 'sarah.lee'], ['Vikram Shah', 'vikram.shah'], ['Julie Martin', 'julie.martin'], ['svc_backup', 'svc_backup']];
const ISSUES = [
  ['Outlook not syncing shared calendar', 'The shared team calendar in Outlook desktop shows old events only. Outlook on the web is correct.', 'Cleared the local cache for the shared calendar, removed and re-added it, and enabled shared calendar improvements. Confirmed sync with the user.'],
  ['VPN drops every few minutes', 'GlobalProtect VPN disconnects every 5–10 minutes when working from home.', 'Updated the VPN client to the current version and switched the laptop Wi-Fi adapter to the 5 GHz band. Monitored for 30 minutes with no drops.'],
  ['Cannot access shared drive', 'Access denied when opening \\\\fs01\\finance after a team move.', 'Added the user to the FIN-Shared-RW group and asked them to sign out and back in. Access confirmed.'],
  ['Laptop running slow after update', 'Laptop takes 10 minutes to boot since the last Windows update.', 'Removed a stuck update, cleared temp files and re-ran the update. Boot time is back to under a minute.'],
  ['POS terminal not printing receipts', 'Store 1142 till 2 does not print receipts since this morning.', 'Replaced the printer USB cable and reinstalled the receipt printer driver remotely. Test receipt printed.'],
];
const REQUESTS = [
  ['New laptop for new joiner', 'Please prepare a standard laptop for a new joiner starting on Monday in the Bangalore office.', 'Laptop imaged with the standard build, enrolled in Intune and handed over to the manager with the asset tag recorded.'],
  ['Access to Power BI workspace', 'Requesting contributor access to the Retail KPI Power BI workspace.', 'Added the user to the Retail-KPI-Contributors group after manager approval. Access confirmed.'],
  ['Install Adobe Acrobat Pro', 'Need Acrobat Pro to edit supplier contracts.', 'Assigned an Acrobat Pro licence and deployed the package through Software Center.'],
];
const pick = a => a[Math.floor(Math.random() * a.length)];
let seq = 412800;
const tickets = [];

function makeTicket(closedAt) {
  const isReq = Math.random() < 0.4;
  const g = pick(GROUPS), [name, local] = pick(PEOPLE), issue = isReq ? pick(REQUESTS) : pick(ISSUES), id = (isReq ? 'R' : 'A') + (2319000 + seq) + 'L';
  const owner = pick(AGENTS);
  return {
    _entity: isReq ? 'ServiceRequest' : 'Incident', ID: id, Code: (isReq ? 'REQ0' : 'INC0') + seq++, TicketStatusID: 'S18C', ClosureDate: closedAt.toISOString(), C70C: closedAt.toISOString(),
    Subject: issue[0], ProblemHTML: `<p>${issue[1]}</p>`, SolutionHTML: `<p>${issue[2]}</p>`,
    OpeningMedia: { Description: pick(SOURCES) }, Contact: { EMail: `${local}@essilorluxottica.example`, FullName: name },
    OwnerUserGroupID: g.ID, OwnerUserGroup: g, AssignedUser: { FullName: owner, EMail: owner.toLowerCase().replace(/[^a-z]+/g, '.').replace(/\.$/, '') + '@essilorluxottica.example' },
    TicketPriority: { Description: pick(['P1', 'P2', 'P3', 'P3', 'P3', 'P4', 'P4']) },
    Category: { Description: pick(['Email & calendar', 'Hardware', 'Access & passwords', 'Network & VPN', 'Business applications']) },
    ClosureCode: { Description: Math.random() < 0.05 ? 'Duplicate' : 'Resolved' },
  };
}
for (let i = 40; i > 0; i--) tickets.push(makeTicket(new Date(Date.now() - i * 45 * 60e3)));
setInterval(() => tickets.push(makeTicket(new Date())), CLOSE_EVERY * 1000);

const resolve = (obj, expr) => expr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const parse = (v, d) => { if (!v) return d; try { return JSON.parse(v); } catch { return d; } };

function applyFilter(rows, filter) {
  if (!Array.isArray(filter)) return rows;
  return rows.filter(r => filter.every(f => {
    const v = resolve(r, f.property);
    switch (f.op) {
      case 'eq': case 'is': case 'equals': return String(v) === String(f.value);
      case 'gt': return new Date(v) > new Date(f.value);
      case 'ge': return new Date(v) >= new Date(f.value);
      case 'lt': return new Date(v) < new Date(f.value);
      default: return true;
    }
  }));
}

const ok = (data, total) => ({ success: true, data, total: total ?? (Array.isArray(data) ? data.length : 0), result: { code: '0', subcode: null, parameters: null, desc: null }, requestToken: null });
const fail = (desc, code = '1') => ({ success: false, data: null, total: 0, result: { code, subcode: null, parameters: null, desc } });

function readForm(req) {
  return new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(Object.fromEntries(new URLSearchParams(b)))); });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/^\/api/, '');
  const q = url.searchParams;
  const out = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

  if (p === '/WSC/Test') return out(200, ok(true));
  if (p === '/Authentication/LoginEx' && req.method === 'POST') {
    // HDAConnect posts JSON { username, password }; the Postman collection uses form data. Accept both.
    let raw = ''; for await (const c of req) raw += c;
    let f = {}; try { f = JSON.parse(raw); } catch { f = Object.fromEntries(new URLSearchParams(raw)); }
    if (!f.username || f.password !== (process.env.MOCK_HDA_PASSWORD || 'mock-password')) return out(200, fail('Invalid username or password', 'AUTH'));
    const t = crypto.randomBytes(16).toString('hex'); tokens.add(t);
    return out(200, { ...ok({ UserID: 'U1', LanguageCode: 'en' }), refreshToken: 'r' + t, expiresIn: 1800, requestToken: t });
  }
  if (p === '/Authentication/Token' && req.method === 'POST') {
    const f = await readForm(req);
    if (f.ApiKey !== API_KEY || !f.Username) return out(200, fail('Invalid ApiKey or Username', 'AUTH'));
    const t = crypto.randomBytes(16).toString('hex'); tokens.add(t);
    return out(200, { ...ok({ UserID: 'U1', LanguageCode: 'en' }), refreshToken: 'r' + t, expiresIn: 1800, requestToken: t });
  }
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (!tokens.has(auth)) return out(401, fail('Unauthorized', '401'));

  const entity = q.get('entity');
  const source = entity === 'UserGroup' ? GROUPS : entity === 'TicketSource' ? SOURCES : ['Incident', 'ServiceRequest'].includes(entity) ? tickets.filter(t => t._entity === entity) : null;
  if (p === '/WSC/GetMetabase') {
    const sample = entity === 'UserGroup' ? GROUPS[0] : (tickets.find(t => t._entity === entity) || tickets[0]);
    const props = [];
    const walk = (o, pre) => Object.entries(o).forEach(([k, v]) => (v && typeof v === 'object' ? walk(v, pre + k + '.') : props.push({ Name: pre + k, DataType: typeof v })));
    walk(sample, '');
    return out(200, ok([{ Entity: entity, Properties: props }]));
  }
  if ((p === '/WSC/Projection' || p === '/WSC/List') && req.method === 'GET') {
    if (!source) return out(200, fail(`Unknown entity ${entity}`));
    let rows = applyFilter(source, parse(q.get('filter'), []));
    const sort = parse(q.get('sort'), []);
    if (sort[0]) rows = [...rows].sort((a, b) => (String(resolve(a, sort[0].property)) < String(resolve(b, sort[0].property)) ? -1 : 1) * (sort[0].direction === 'DESC' ? -1 : 1));
    const start = +q.get('start') || 0, limit = +q.get('limit') || 20, total = rows.length;
    rows = rows.slice(start, limit ? start + limit : undefined);
    if (p === '/WSC/Projection') {
      const exprs = parse(q.get('columnExpressions'), []), names = parse(q.get('columnNames'), exprs);
      rows = rows.map(r => Object.fromEntries(exprs.map((e, i) => [names[i] || e, resolve(r, e) ?? null])));
    }
    return out(200, ok(rows, total));
  }
  if (p === '/WSC/Set' && req.method === 'POST') { const f = await readForm(req); console.log('[mock-hda] Set', f.entity, f.id, f.data); return out(200, ok({ ID: f.id })); }
  out(404, fail('Not found'));
}).listen(PORT, () => console.log(`[mock-hda] listening on http://localhost:${PORT}/api (LoginEx password: mock-password, ApiKey: ${API_KEY}); a ticket closes every ${CLOSE_EVERY}s`));
