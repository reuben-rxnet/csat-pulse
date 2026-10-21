'use strict';
const http = require('http');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { Router, readBody, html, json, redirect, serveStatic, send } = require('./web/http');
const { sameOrigin } = require('./web/auth');
const views = require('./web/views');
const { findByToken, submit } = require('./services/responses');
const { getSettings, saveSettings, getAllGroupSettings, getGroupSettings, saveGroupSettings, effectiveSettings, DEFAULTS } = require('./services/settings');
const { describeGroup } = require('./services/summary');
const { listHistory } = require('./services/history');
const { getMetrics, filterOptions } = require('./services/metrics');
const { syncGroups, getState } = require('./services/poller');
const { ticketTypes } = require('./hda/tickets');
const { resolveAdmin, teamAccess, isGlobal, canManage, groupScope, viewAsCookie, clearViewAsCookie } = require('./services/access');
const { verifyActionableToken } = require('./web/actionable');
const { previewHtml, sendTest } = require('./services/testsend');
const { listMissing, countMissing, findMissing, fixAndSend, dismiss, contactsToFix, contactsCsv } = require('./services/missing');
const reportsSvc = require('./services/reports');
const R = require('./report/schedule');
const help = require('./web/help');
const scheduler = require('./scheduler');

const router = new Router();
const assets = serveStatic(path.join(__dirname, 'web', 'public'));

// ---------- middleware ----------
async function requireAdmin(req, res, ctx) {
  if (req.method === 'POST' && !sameOrigin(req)) { json(res, { error: 'Cross-site request blocked' }, 403); return false; }
  let u;
  try { u = await resolveAdmin(req); }
  catch (e) {
    console.error('[access] HDA group lookup failed:', e.message);
    // A global admin stuck in "View as" must still be able to leave it.
    if (req.method === 'POST' && req.url === '/admin/view-as/stop') { redirect(res, '/admin/settings', { 'Set-Cookie': clearViewAsCookie() }); return false; }
    html(res, views.messagePage('Could not check your HDA groups', `CSAT Pulse could not reach HDA to look up your owner groups (${e.message}). Try again in a minute.`), 502); return false;
  }
  if (!u) {
    if (config.admin.authMode === 'basic') { send(res, 401, 'Sign-in required', 'text/plain', { 'WWW-Authenticate': `Basic realm="${config.brand.product} admin"` }); return false; }
    send(res, 401, 'Sign-in required', 'text/plain'); return false;
  }
  if (u.denied) { send(res, 403, `${u.name} ${u.reason}`, 'text/plain'); return false; }
  ctx.admin = u;
  ctx.actor = u.viewAs ? `${u.realName} (as ${u.login})` : u.name; // who made a change, for audit and "updated by"
  return true;
}
function requireGlobal(req, res, ctx) {
  if (isGlobal(ctx.admin)) return true;
  html(res, views.messagePage('Not available', 'Only a CSAT Pulse global admin can do this.'), 403); return false;
}
// 403 unless the signed-in person may manage this owner group.
function denyUnlessGroup(res, ctx, groupId) {
  if (canManage(ctx.admin, groupId)) return false;
  json(res, { error: 'You can only change owner groups you are assigned to in HDA.' }, 403); return true;
}
const audit = (actor, action, detail) => db.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3::jsonb)', [actor, action, JSON.stringify(detail)]);

// ---------- public ----------
router.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); json(res, { ok: true, polledAt: await getState('tickets_polled_at') }); }
  catch (e) { json(res, { ok: false, error: e.message }, 503); }
});
router.get('/', (req, res) => redirect(res, '/admin'));
// Public: explains the survey to the people who receive it (linked from every survey email and page).
router.get('/about-survey', async (req, res) => html(res, help.aboutSurveyPage({ settings: await getSettings(), layout: views.layout })));
router.get('/favicon.ico', (req, res) => { res.writeHead(204); res.end(); });

const ERRORS = {
  not_found: ['Link not valid', 'This survey link is not valid. It may have been replaced by a newer reminder email.'],
  already_answered: ['Thank you', 'This survey has already been answered. Thank you for your feedback.'],
  expired: ['Survey closed', 'This survey link has expired.'],
};

router.get('/s/:token', async (req, res, ctx) => {
  const s = await findByToken(ctx.params.token);
  if (!s) return html(res, views.messagePage(...ERRORS.not_found), 404);
  if (s.status === 'answered') return html(res, views.messagePage(...ERRORS.already_answered));
  if (s.status === 'expired' || new Date(s.expires_at) < new Date()) return html(res, views.messagePage(...ERRORS.expired));
  const pre = parseInt(ctx.query.get('score'), 10);
  html(res, views.surveyPage(s, { preselect: pre >= 1 && pre <= 5 ? pre : null }));
});

router.post('/s/:token', async (req, res, ctx) => {
  const body = await readBody(req);
  const r = await submit(ctx.params.token, body, 'web');
  if (r.ok) return html(res, views.messagePage('Thank you for your feedback', `Your rating has been recorded for ticket ${r.survey.ticket_number || r.survey.ticket_id}.`));
  if (r.error === 'missing_overall') return html(res, views.surveyPage(r.survey, { error: 'Choose a rating for the first question to submit.', values: body }), 400);
  const [t, m] = ERRORS[r.error] || ERRORS.not_found;
  html(res, views.messagePage(t, m), r.error === 'not_found' ? 404 : 200);
});

// Outlook Actionable Message submit
router.post('/api/actionable/:token', async (req, res, ctx) => {
  try { await verifyActionableToken(req.headers.authorization); }
  catch (e) { console.warn('[actionable] rejected:', e.message); return json(res, { error: 'unauthorized' }, 401); }
  const body = await readBody(req);
  const r = await submit(ctx.params.token, body, 'outlook');
  const msg = r.ok ? 'Thank you, your feedback was recorded.' : r.error === 'already_answered' ? 'This survey was already answered.' : r.error === 'expired' ? 'This survey has expired.' : r.error === 'missing_overall' ? 'Please choose a rating for the first question.' : 'This survey link is no longer valid.';
  json(res, { ok: r.ok }, r.ok || r.error === 'already_answered' ? 200 : 400, { 'CARD-ACTION-STATUS': msg });
});

// ---------- admin ----------
router.get('/admin', requireAdmin, (req, res, ctx) => html(res, views.dashboardPage(ctx.admin)));

router.get('/admin/api/metrics', requireAdmin, async (req, res, ctx) => {
  const scope = groupScope(ctx.admin);
  const group = ctx.query.get('group') || '';
  const f = { weeks: ctx.query.get('weeks'), groups: scope, group: !scope || scope.includes(group) ? group : '', source: ctx.query.get('source') || '', priority: ctx.query.get('priority') || '', type: ctx.query.get('type') || '' };
  const [m, options, settings] = await Promise.all([getMetrics(f), filterOptions(scope), getSettings()]);
  json(res, { ...m, options, target: settings.csatTarget });
});

router.post('/admin/api/followups/:id', requireAdmin, async (req, res, ctx) => {
  const b = await readBody(req);
  if (!['open', 'contacted', 'resolved'].includes(b.status)) return json(res, { error: 'Invalid status' }, 400);
  const s = (await db.query('SELECT owner_group_id FROM surveys WHERE id = $1', [ctx.params.id])).rows[0];
  if (!s) return json(res, { error: 'Unknown survey' }, 404);
  if (denyUnlessGroup(res, ctx, s.owner_group_id)) return;
  await db.query('UPDATE responses SET followup_status = $2, followup_owner = $3, followup_note = coalesce($4, followup_note), followup_at = now() WHERE survey_id = $1',
    [ctx.params.id, b.status, ctx.actor, b.note || null]);
  await audit(ctx.actor, 'followup.update', { survey: ctx.params.id, group: s.owner_group_id, status: b.status });
  json(res, { ok: true });
});

// Switched-on and busy groups first, so the 2,000+ quiet ones don't bury them.
const groupsWithCounts = scope => db.query(`SELECT g.*, (SELECT count(*)::int FROM surveys s WHERE s.owner_group_id = g.hda_group_id AND s.closed_at > now() - interval '30 days' AND NOT s.is_test) AS closed_30d
    FROM owner_groups g WHERE ($1::text[] IS NULL OR g.hda_group_id = ANY($1::text[])) ORDER BY g.csat_enabled DESC, closed_30d DESC, g.active_in_hda DESC, g.name`, [scope]).then(r => r.rows);
// Plain-language sentence for one group, from the global settings, its overrides and the sources that apply.
function plainForGroup(g, global, gs, sources) {
  const srcs = gs && gs.sources ? gs.sources : sources.filter(s => s.csat_enabled).map(s => s.source);
  return describeGroup({ enabled: g.csat_enabled, surveyEnabled: global.surveyEnabled, rules: effectiveSettings(global, gs), sources: srcs });
}
const SETTINGS_TABS = ['groups', 'sources', 'rules', 'access', 'history'];
const sourcesWithCounts = () => db.query(`SELECT t.*, (SELECT count(*)::int FROM surveys s WHERE s.source = t.source AND s.closed_at > now() - interval '30 days' AND NOT s.is_test) AS closed_30d
    FROM ticket_sources t ORDER BY t.source = '(No source)' DESC, t.active_in_hda DESC, t.source`).then(r => r.rows);

router.get('/admin/settings', requireAdmin, async (req, res, ctx) => {
  const scope = groupScope(ctx.admin);
  const tab = SETTINGS_TABS.includes(ctx.query.get('tab')) && (isGlobal(ctx.admin) || ['groups', 'history'].includes(ctx.query.get('tab'))) ? ctx.query.get('tab') : 'groups';
  const q = (ctx.query.get('q') || '').trim().slice(0, 100);
  const [groups, sources, gsAll, settings] = await Promise.all([groupsWithCounts(scope), sourcesWithCounts(), getAllGroupSettings(), getSettings()]);
  for (const g of groups) { g.gs = gsAll.get(g.hda_group_id); g.plain = plainForGroup(g, settings, g.gs, sources); }
  const state = { groups_synced_at: await getState('groups_synced_at'), tickets_polled_at: await getState('tickets_polled_at') };
  const types = ticketTypes().map(t => t.label);
  const access = isGlobal(ctx.admin) ? (await db.query('SELECT * FROM group_access ORDER BY login, hda_group_id')).rows : [];
  const history = tab === 'history' ? await listHistory({ scope, q }) : [];
  html(res, views.settingsPage(ctx.admin, { tab, groups, sources, settings, state, types, access, history, q,
    closeCodeMapped: !!config.hda.mapping.tickets.columns.closeCode,
    saved: ctx.query.get('saved') === '1', notice: ctx.query.get('notice'), error: ctx.query.get('error') }));
});

// Must be registered before /admin/groups/:id, or "sync" is taken as a group ID (routes match in order).
router.post('/admin/groups/sync', requireAdmin, requireGlobal, async (req, res, ctx) => {
  const back = (await readBody(req)).back === 'sources' ? 'tab=sources&' : '';
  try { await syncGroups(); await audit(ctx.actor, 'group.sync', {}); redirect(res, `/admin/settings?${back}notice=` + encodeURIComponent('Owner groups and ticket sources synced from HDA.')); }
  catch (e) { html(res, views.messagePage('HDA sync failed', e.message), 502); }
});

// One group's own sources, ticket types and send rules (team admins: their groups only).
router.get('/admin/groups/:id', requireAdmin, async (req, res, ctx) => {
  const id = ctx.params.id;
  if (!canManage(ctx.admin, id)) return html(res, views.messagePage('Not your group', 'You can only open owner groups you are assigned to in HDA.'), 403);
  const group = (await db.query('SELECT * FROM owner_groups WHERE hda_group_id = $1', [id])).rows[0];
  if (!group) return html(res, views.messagePage('Unknown group', `Owner group ${id} is not in CSAT Pulse yet.`), 404);
  const [gs, defaults, sources] = await Promise.all([getGroupSettings(id), getSettings(), sourcesWithCounts()]);
  html(res, views.groupSettingsPage(ctx.admin, { group, gs, defaults, sources, plain: plainForGroup(group, defaults, gs, sources),
    types: ticketTypes().map(t => t.label), saved: ctx.query.get('saved') === '1' }));
});
router.post('/admin/groups/:id', requireAdmin, async (req, res, ctx) => {
  const id = ctx.params.id;
  if (!canManage(ctx.admin, id)) return html(res, views.messagePage('Not your group', 'You can only change owner groups you are assigned to in HDA.'), 403);
  if (!(await db.query('SELECT 1 FROM owner_groups WHERE hda_group_id = $1', [id])).rowCount) return html(res, views.messagePage('Unknown group', `Owner group ${id} is not in CSAT Pulse yet.`), 404);
  const b = await readBody(req, 64 * 1024, true);
  const known = new Set((await db.query('SELECT source FROM ticket_sources')).rows.map(r => r.source));
  const optInt = (k, lo, hi) => { const v = String(b[k] ?? '').trim(); if (v === '') return undefined; const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined; };
  const rules = {
    ticketTypes: b.useDefaultTypes === 'true' ? undefined : [].concat(b.ticketTypes || []).filter(t => ticketTypes().some(x => x.label === t)),
    sendDelayMinutes: optInt('sendDelayMinutes', 0, 10080), throttleDays: optInt('throttleDays', 0, 365), reminderDays: optInt('reminderDays', 0, 30),
    expiryDays: optInt('expiryDays', 1, 90), alertThreshold: optInt('alertThreshold', 0, 5),
  };
  const sources = b.useDefaultSources === 'true' ? null : [].concat(b.sources || []).filter(s => known.has(s));
  await saveGroupSettings(id, { rules, sources }, ctx.actor);
  redirect(res, `/admin/groups/${encodeURIComponent(id)}?saved=1`);
});

// "View as": a global admin sees CSAT Pulse exactly as a team admin would (until Microsoft sign-in is set up).
router.post('/admin/view-as', requireAdmin, requireGlobal, async (req, res, ctx) => {
  const login = String((await readBody(req)).login || '').trim();
  if (!login) return redirect(res, '/admin/settings?tab=access&error=' + encodeURIComponent('Enter an HDA username or email.'));
  let t;
  try { t = await teamAccess(login); }
  catch (e) { return redirect(res, '/admin/settings?tab=access&error=' + encodeURIComponent(`Could not look up ${login} in HDA: ${e.message}`)); }
  if (!t.hdaUser && !t.groups.size) return redirect(res, '/admin/settings?tab=access&error=' + encodeURIComponent(`No HDA user "${login}" with owner groups was found. Use the HDA username (e.g. reuben.dsouza) or their email.`));
  await audit(ctx.actor, 'admin.view_as', { login, groups: t.groups.size });
  redirect(res, '/admin/settings', { 'Set-Cookie': viewAsCookie(login) });
});
router.post('/admin/view-as/stop', requireAdmin, async (req, res, ctx) => {
  if (!ctx.admin.viewAs) return redirect(res, '/admin/settings');
  redirect(res, '/admin/settings', { 'Set-Cookie': clearViewAsCookie() });
});

// Extra groups for people who aren't members in HDA.
router.post('/admin/access/add', requireAdmin, requireGlobal, async (req, res, ctx) => {
  const b = await readBody(req);
  const login = String(b.login || '').trim().toLowerCase(), group = String(b.group || '').trim();
  const g = (await db.query('SELECT hda_group_id, name FROM owner_groups WHERE hda_group_id = $1 OR lower(name) = lower($1) LIMIT 1', [group])).rows[0];
  if (!login || !g) return redirect(res, '/admin/settings?tab=access&error=' + encodeURIComponent('Enter a person and pick an owner group from the list.'));
  await db.query('INSERT INTO group_access(login, hda_group_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [login, g.hda_group_id, ctx.actor]);
  await audit(ctx.actor, 'access.add', { login, group: g.hda_group_id });
  redirect(res, '/admin/settings?tab=access&notice=' + encodeURIComponent(`${login} can now manage ${g.name}.`));
});
router.post('/admin/access/remove', requireAdmin, requireGlobal, async (req, res, ctx) => {
  const b = await readBody(req);
  await db.query('DELETE FROM group_access WHERE login = $1 AND hda_group_id = $2', [String(b.login || ''), String(b.group || '')]);
  await audit(ctx.actor, 'access.remove', { login: b.login, group: b.group });
  redirect(res, '/admin/settings?tab=access&notice=' + encodeURIComponent('Extra group access removed.'));
});

router.post('/admin/settings', requireAdmin, requireGlobal, async (req, res, ctx) => {
  const b = await readBody(req, 64 * 1024, true);
  const clampInt = (k, lo, hi) => Math.min(hi, Math.max(lo, parseInt(b[k], 10) || 0));
  const lines = k => String(b[k] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 50);
  await saveSettings({
    surveyEnabled: b.surveyEnabled === 'true',
    ticketTypes: [].concat(b.ticketTypes || []).filter(t => ticketTypes().some(x => x.label === t)),
    sendDelayMinutes: clampInt('sendDelayMinutes', 0, 10080), throttleDays: clampInt('throttleDays', 0, 365),
    reminderDays: clampInt('reminderDays', 0, 30), expiryDays: Math.max(1, clampInt('expiryDays', 1, 90)),
    alertThreshold: clampInt('alertThreshold', 0, 5), csatTarget: Math.max(1, clampInt('csatTarget', 1, 100)) || DEFAULTS.csatTarget,
    excludeCloseCodes: lines('excludeCloseCodes'), excludeRequesterPatterns: lines('excludeRequesterPatterns'), excludeOwnerPatterns: lines('excludeOwnerPatterns'),
  }, ctx.actor);
  redirect(res, '/admin/settings?tab=rules&saved=1');
});

router.post('/admin/api/groups/toggle', requireAdmin, async (req, res, ctx) => {
  const b = await readBody(req);
  if (denyUnlessGroup(res, ctx, String(b.id))) return;
  const r = await db.query('UPDATE owner_groups SET csat_enabled = $2, updated_by = $3, updated_at = now() WHERE hda_group_id = $1', [String(b.id), !!b.enabled, ctx.actor]);
  if (!r.rowCount) return json(res, { error: 'Unknown group' }, 404);
  await audit(ctx.actor, 'group.toggle', { id: b.id, enabled: !!b.enabled });
  json(res, { ok: true });
});
router.post('/admin/api/groups/bulk', requireAdmin, async (req, res, ctx) => {
  if (!isGlobal(ctx.admin)) return json(res, { error: 'Only a global admin can switch all groups at once.' }, 403);
  const b = await readBody(req);
  // Groups are only ever switched on one at a time, on purpose; "all at once" exists only for switching off.
  if (b.enabled) return json(res, { error: 'Groups can only be switched on one at a time.' }, 400);
  await db.query('UPDATE owner_groups SET csat_enabled = false, updated_by = $1, updated_at = now()', [ctx.actor]);
  await audit(ctx.actor, 'group.bulk', { enabled: false });
  json(res, { ok: true });
});
router.post('/admin/api/groups/lead', requireAdmin, async (req, res, ctx) => {
  const b = await readBody(req);
  if (denyUnlessGroup(res, ctx, String(b.id))) return;
  const email = String(b.email || '').trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, { error: 'Invalid email' }, 400);
  await db.query('UPDATE owner_groups SET lead_email = $2, updated_by = $3, updated_at = now() WHERE hda_group_id = $1', [String(b.id), email || null, ctx.actor]);
  await audit(ctx.actor, 'group.lead', { id: String(b.id), email: email || null });
  json(res, { ok: true });
});
router.post('/admin/api/sources/toggle', requireAdmin, async (req, res, ctx) => {
  if (!isGlobal(ctx.admin)) return json(res, { error: 'Only a global admin can change the default sources. Use "Sources & rules" on your group instead.' }, 403);
  const b = await readBody(req);
  const r = await db.query('UPDATE ticket_sources SET csat_enabled = $2, updated_by = $3, updated_at = now() WHERE source = $1', [String(b.id), !!b.enabled, ctx.actor]);
  if (!r.rowCount) return json(res, { error: 'Unknown source' }, 404);
  await audit(ctx.actor, 'source.toggle', { source: b.id, enabled: !!b.enabled });
  json(res, { ok: true });
});

router.get('/admin/surveys', requireAdmin, async (req, res, ctx) => {
  const q = (ctx.query.get('q') || '').trim(), status = ctx.query.get('status') || '';
  const p = [], w = [];
  const scope = groupScope(ctx.admin);
  if (scope) { p.push(scope); w.push(`s.owner_group_id = ANY($${p.length}::text[])`); }
  if (q) { p.push('%' + q.toLowerCase() + '%'); w.push(`(lower(s.ticket_number) LIKE $${p.length} OR lower(s.requester_email) LIKE $${p.length} OR lower(s.ticket_owner) LIKE $${p.length})`); }
  if (status) { p.push(status); w.push(`s.status = $${p.length}`); }
  const rows = (await db.query(`SELECT s.*, r.overall FROM surveys s LEFT JOIN responses r ON r.survey_id = s.id ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
                                ORDER BY s.created_at DESC LIMIT 300`, p)).rows;
  html(res, views.surveysPage(ctx.admin, { rows, q, status }));
});

// ---------- missing emails ----------
router.get('/admin/missing', requireAdmin, async (req, res, ctx) => {
  const scope = groupScope(ctx.admin), tab = ctx.query.get('tab') === 'contacts' ? 'contacts' : 'tickets';
  const [rows, contacts] = await Promise.all([tab === 'tickets' ? listMissing(scope) : [], contactsToFix(scope)]);
  const counts = { missing: tab === 'tickets' ? rows.length : await countMissing(scope), contacts: contacts.length };
  html(res, views.missingPage(ctx.admin, { tab, rows, contacts, counts, notice: ctx.query.get('notice'), error: ctx.query.get('error') }));
});
router.get('/admin/missing/contacts.csv', requireAdmin, async (req, res, ctx) => {
  const csv = contactsCsv(await contactsToFix(groupScope(ctx.admin)));
  send(res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="csat-contacts-to-fix-${new Date().toISOString().slice(0, 10)}.csv"` });
});
const missingBack = (res, q) => redirect(res, '/admin/missing?' + new URLSearchParams(q));
router.post('/admin/missing/:id/send', requireAdmin, async (req, res, ctx) => {
  const s = await findMissing(ctx.params.id);
  if (!s) return missingBack(res, { error: 'That ticket is no longer waiting for an email.' });
  if (!canManage(ctx.admin, s.owner_group_id)) return missingBack(res, { error: 'You can only send surveys for your own owner groups.' });
  const email = String((await readBody(req)).email || '');
  try {
    const r = await fixAndSend(s, email, ctx.actor);
    await audit(ctx.actor, 'survey.email_fixed', { survey: s.id, ticket: s.ticket_number, group: s.owner_group_id, sent: r.sent });
    missingBack(res, r.sent ? { notice: `Survey for ${s.ticket_number} sent to ${email.trim().toLowerCase()}.` }
      : { error: `The email for ${s.ticket_number} was saved, but sending failed (${r.error}). It will be retried automatically.` });
  } catch (e) { missingBack(res, { error: e.message }); }
});
router.post('/admin/missing/:id/dismiss', requireAdmin, async (req, res, ctx) => {
  const s = await findMissing(ctx.params.id);
  if (!s) return missingBack(res, { error: 'That ticket is no longer waiting for an email.' });
  if (!canManage(ctx.admin, s.owner_group_id)) return missingBack(res, { error: 'You can only dismiss tickets of your own owner groups.' });
  await dismiss(s, ctx.actor);
  await audit(ctx.actor, 'survey.email_dismissed', { survey: s.id, ticket: s.ticket_number, group: s.owner_group_id });
  missingBack(res, { notice: `${s.ticket_number} dismissed. Its contact stays on the "Contacts to fix" list.` });
});

// Team admins may preview/send tests only for tickets of their own groups (the built-in sample is always allowed).
const ownGroupOnly = ctx => s => {
  if (s.ticket_id === 'SAMPLE-0001' || canManage(ctx.admin, s.owner_group_id)) return;
  throw Object.assign(new Error(`Ticket ${s.ticket_number} belongs to ${s.owner_group_name || 'another owner group'}, which isn't one of your groups.`), { status: 403 });
};
const testMailInfo = () => ({ transport: config.mail.transport, smtpHost: config.mail.smtp.host, from: config.mail.from, publicBaseUrl: config.publicBaseUrl });
router.get('/admin/test', requireAdmin, async (req, res, ctx) => {
  html(res, views.testPage(ctx.admin, { ticket: (ctx.query.get('ticket') || '').trim(), to: ctx.query.get('to') || '',
    sent: ctx.query.get('sent') ? { ticket: ctx.query.get('sent'), to: ctx.query.get('to') } : null, error: ctx.query.get('error'), mail: testMailInfo() }));
});
router.get('/admin/test/preview', requireAdmin, async (req, res, ctx) => {
  // Shown in an iframe on /admin/test, so allow framing by this app only (every other page denies framing).
  const sameOriginFrame = { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'" };
  try { html(res, await previewHtml(ctx.query.get('ticket'), ownGroupOnly(ctx)), 200, sameOriginFrame); }
  catch (e) { html(res, views.messagePage('Preview not available', e.message), e.status || 502, sameOriginFrame); }
});
router.post('/admin/test/send', requireAdmin, async (req, res, ctx) => {
  const b = await readBody(req);
  const to = String(b.to || '').trim(), ticket = String(b.ticket || '').trim();
  const back = q => redirect(res, '/admin/test?' + new URLSearchParams({ ...(ticket ? { ticket } : {}), to, ...q }));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return back({ error: 'Enter a valid email address.' });
  try {
    const r = await sendTest({ to, ticketNumber: ticket, guard: ownGroupOnly(ctx) });
    await audit(ctx.actor, 'survey.test_send', { to, ticket: r.ticket, ...(r.group ? { group: r.group } : {}) });
    back({ sent: r.ticket });
  } catch (e) {
    console.error('[test-send] failed:', e.message);
    back({ error: `Sending failed: ${e.message}` });
  }
});

router.get('/admin/help', requireAdmin, async (req, res, ctx) => {
  const [settings, sources] = await Promise.all([getSettings(), db.query('SELECT source FROM ticket_sources WHERE csat_enabled ORDER BY source')]);
  html(res, help.helpPage(ctx.admin, { settings, defaultSources: sources.rows.map(r => r.source), layout: views.layout, forId: String(ctx.query.get('for') || '') }));
});

// ---------- reports ----------
// Reads the report fields shared by the forms (body object or URLSearchParams): groups, sections and, for ad hoc reports, the dates.
function reportForm(admin, src) {
  const get = k => (src instanceof URLSearchParams ? src.get(k) : [].concat(src[k] ?? [])[0]) ?? '';
  const all = k => (src instanceof URLSearchParams ? src.getAll(k) : [].concat(src[k] ?? []));
  const g = reportsSvc.resolveGroups(admin, { all: get('allGroups') === 'true', picked: all('groups') });
  if (g.error) return { error: g.error };
  return { groups: g.groups, sections: R.pickSections(get('type'), all('sections')), get };
}
const reportsBack = (res, q, hash = '') => redirect(res, '/admin/reports?' + new URLSearchParams(q) + hash);

router.get('/admin/reports', requireAdmin, async (req, res, ctx) => {
  const now = new Date(), lastMonth = R.periodFor('monthly', now);
  const [options, schedules, runs] = await Promise.all([filterOptions(groupScope(ctx.admin)), reportsSvc.listSchedules(ctx.admin), reportsSvc.listRuns(ctx.admin)]);
  const edit = ctx.query.get('edit') ? await reportsSvc.getSchedule(ctx.admin, ctx.query.get('edit')) : null;
  // A schedule may list a group that has no surveys yet; keep it pickable while editing.
  const groups = [...options.groups];
  for (const id of (edit && edit.groups) || []) if (!groups.some(g => g.id === id)) groups.push({ id, name: id });
  html(res, views.reportsPage(ctx.admin, { groups, schedules, runs, edit, R, domains: config.reports.recipientDomains,
    defaults: { from: views.ymd(lastMonth.from), to: views.ymd(new Date(lastMonth.to.getTime() - 864e5)) },
    notice: ctx.query.get('notice'), error: ctx.query.get('error') }));
});

router.get('/admin/reports/pdf', requireAdmin, async (req, res, ctx) => {
  const f = reportForm(ctx.admin, ctx.query);
  if (f.error) return reportsBack(res, { error: f.error });
  const period = R.adhocPeriod(f.get('from'), f.get('to'));
  if (period.error) return reportsBack(res, { error: period.error });
  const title = R.isCustom(f.sections) ? 'CSAT report (custom)' : 'CSAT report';
  const r = await reportsSvc.buildReport({ period, groups: f.groups, sections: f.sections, producedBy: ctx.actor, title });
  await reportsSvc.logRun({ kind: 'download', actor: ctx.actor, owner: reportsSvc.ownerOf(ctx.admin), period, groups: f.groups, sections: f.sections, status: 'ok' });
  send(res, 200, r.pdf, 'application/pdf', { 'Content-Disposition': `attachment; filename="${r.filename}"` });
});

router.post('/admin/reports/send', requireAdmin, async (req, res, ctx) => {
  const b = await readBody(req, 64 * 1024, true);
  const f = reportForm(ctx.admin, b);
  if (f.error) return reportsBack(res, { error: f.error });
  const period = R.adhocPeriod(f.get('from'), f.get('to'));
  if (period.error) return reportsBack(res, { error: period.error });
  const to = reportsSvc.recipients(f.get('to_emails'));
  if (to.error) return reportsBack(res, { error: to.error });
  try {
    await reportsSvc.sendReport({ to: to.emails, period, groups: f.groups, sections: f.sections, actor: ctx.actor, owner: reportsSvc.ownerOf(ctx.admin),
      message: String(f.get('message')).trim().slice(0, 1000) });
    await audit(ctx.actor, 'report.send', { to: to.emails, from: f.get('from'), until: f.get('to'), groups: f.groups, sections: f.sections });
    reportsBack(res, { notice: `Report for ${R.periodLabel(period.from, period.to)} sent to ${to.emails.join(', ')}.` });
  } catch (e) {
    console.error('[reports] send failed:', e.message);
    reportsBack(res, { error: `Sending the report failed: ${e.message}` });
  }
});

router.post('/admin/reports/schedules', requireAdmin, async (req, res, ctx) => {
  const b = await readBody(req, 64 * 1024, true);
  const id = parseInt(b.id, 10) || null;
  const back = q => reportsBack(res, { ...q, ...(id && q.error ? { edit: id } : {}) }, '#schedule');
  if (id && !(await reportsSvc.getSchedule(ctx.admin, id))) return back({ error: 'That scheduled report no longer exists, or isn\'t yours.' });
  const f = reportForm(ctx.admin, b);
  if (f.error) return back({ error: f.error });
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) return back({ error: 'Give the scheduled report a name.' });
  const to = reportsSvc.recipients(b.to_emails);
  if (to.error) return back({ error: to.error });
  const frequency = R.FREQUENCIES[b.frequency] ? b.frequency : 'monthly';
  const run_day = frequency === 'weekly' ? Math.min(7, Math.max(1, parseInt(b.weekday, 10) || 1)) : Math.min(28, Math.max(1, parseInt(b.monthday, 10) || 1));
  const send_hour = Math.min(23, Math.max(0, parseInt(b.send_hour, 10) || 0));
  const s = await reportsSvc.saveSchedule(ctx.admin, id, { name, recipients: to.emails, frequency, run_day, send_hour, groups: f.groups, sections: f.sections }, ctx.actor);
  await audit(ctx.actor, 'report.schedule_save', { schedule: s.id, name, to: to.emails, frequency, groups: f.groups, sections: f.sections, created: !id });
  back({ notice: `Scheduled report "${name}" ${id ? 'saved' : 'created'}. ${R.describeSchedule(s)}${s.next_run_at ? ` Next send: ${s.next_run_at.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.` : ''}` });
});

router.post('/admin/reports/schedules/:id/toggle', requireAdmin, async (req, res, ctx) => {
  const s = await reportsSvc.getSchedule(ctx.admin, ctx.params.id);
  if (!s) return reportsBack(res, { error: 'That scheduled report no longer exists, or isn\'t yours.' });
  const enabled = (await readBody(req)).enabled === 'true';
  await reportsSvc.setScheduleEnabled(s.id, enabled, ctx.actor);
  await audit(ctx.actor, 'report.schedule_toggle', { schedule: s.id, name: s.name, enabled });
  reportsBack(res, { notice: `"${s.name}" ${enabled ? 'resumed' : 'paused'}.` });
});
router.post('/admin/reports/schedules/:id/delete', requireAdmin, async (req, res, ctx) => {
  const s = await reportsSvc.getSchedule(ctx.admin, ctx.params.id);
  if (!s) return reportsBack(res, { error: 'That scheduled report no longer exists, or isn\'t yours.' });
  await reportsSvc.deleteSchedule(s.id);
  await audit(ctx.actor, 'report.schedule_delete', { schedule: s.id, name: s.name });
  reportsBack(res, { notice: `Scheduled report "${s.name}" deleted.` });
});
router.post('/admin/reports/schedules/:id/run', requireAdmin, async (req, res, ctx) => {
  const s = await reportsSvc.getSchedule(ctx.admin, ctx.params.id);
  if (!s) return reportsBack(res, { error: 'That scheduled report no longer exists, or isn\'t yours.' });
  try {
    await reportsSvc.sendScheduleNow(s, ctx.actor);
    await audit(ctx.actor, 'report.schedule_run', { schedule: s.id, name: s.name, to: s.recipients });
    reportsBack(res, { notice: `"${s.name}" sent to ${s.recipients.join(', ')}.` });
  } catch (e) {
    console.error('[reports] send now failed:', e.message);
    reportsBack(res, { error: `Sending "${s.name}" failed: ${e.message}` });
  }
});

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/assets/') && (req.method === 'GET' || req.method === 'HEAD')) {
      if (assets(req, res, url.pathname.slice(7))) return;
    }
    const m = router.match(req.method, url.pathname);
    if (!m) return send(res, 404, 'Not found', 'text/plain');
    const ctx = { params: m.params, query: url.searchParams };
    for (const h of m.handlers) { const r = await h(req, res, ctx); if (r === false || res.writableEnded) break; }
  } catch (e) {
    console.error(`[http] ${req.method} ${url.pathname}:`, e);
    if (!res.headersSent) send(res, e.status || 500, e.status ? e.message : 'Something went wrong. Please try again.', 'text/plain');
  }
});

async function main() {
  await db.migrate();
  if (config.admin.authMode === 'basic' && !config.admin.password) console.warn('[admin] ADMIN_PASSWORD is not set: admin pages are locked.');
  server.listen(config.port, () => console.log(`[http] ${config.brand.product} listening on :${config.port} (${config.publicBaseUrl})`));
  scheduler.start();
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { server, main };
