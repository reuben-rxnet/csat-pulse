'use strict';
// Stakeholder surveys: create and edit, recipients, personal invitations and reminders, answering, results.
// Global admins see every survey; team admins see the ones they created. Recipients must be internal
// (config.reports.recipientDomains). Invitations go straight to the people listed (like reports).
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const { sendMail } = require('../mail/transport');
const { esc } = require('../mail/templates');
const { firstName, titleCase } = require('../names');
const { normalizeQuestions, validateAnswers, summarize, toCsv, numbering } = require('../forms/model');
const { fromTemplate, currentPeriod } = require('../forms/templates');

const ownerOf = admin => admin.login || admin.name;
const isGlobal = admin => admin.role === 'global';
const token = () => crypto.randomBytes(24).toString('base64url');
const DEFAULT_SETTINGS = { thankYou: 'Thank you – your feedback has been recorded.', allowEdit: false, reminderDays: 3, maxReminders: 1, inviteSubject: '', inviteMessage: '' };
const settingsOf = f => ({ ...DEFAULT_SETTINGS, ...(f.settings || {}) });
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const surveyLink = t => `${config.publicBaseUrl}/f/${t}`;
// Rough "about N minutes": half a minute per question, a minute per grid or text answer.
const minutes = qs => Math.max(1, Math.round(qs.reduce((m, q) => m + (q.type === 'section' ? 0 : q.type === 'likert' ? 0.25 * q.rows.length + 0.25 : q.type === 'text' ? 1 : 0.4), 0)));

// ---------- surveys ----------
async function listForms(admin) {
  const { rows } = await db.query(`SELECT f.id, f.title, f.status, f.closes_at, f.opened_at, f.closed_at, f.owner_login, f.owner_role, f.created_at, f.updated_at,
      jsonb_array_length(f.questions) AS items,
      (SELECT count(*) FROM form_recipients r WHERE r.form_id = f.id AND NOT r.is_test)::int AS recipients,
      (SELECT count(*) FROM form_recipients r WHERE r.form_id = f.id AND NOT r.is_test AND r.invite_status = 'sent')::int AS invited,
      (SELECT count(*) FROM form_responses x JOIN form_recipients r ON r.id = x.recipient_id WHERE x.form_id = f.id AND NOT r.is_test AND x.submitted_at IS NOT NULL)::int AS responses
    FROM forms f WHERE ($1::text IS NULL OR f.owner_login = $1) ORDER BY f.updated_at DESC`, [isGlobal(admin) ? null : ownerOf(admin)]);
  return rows;
}
async function getForm(admin, id) {
  const f = (await db.query('SELECT * FROM forms WHERE id = $1', [parseInt(id, 10) || 0])).rows[0];
  if (!f || (!isGlobal(admin) && f.owner_login !== ownerOf(admin))) return null;
  return { ...f, settings: settingsOf(f) };
}
async function createForm(admin, { template = 'blank', period = currentPeriod() }, actor) {
  const t = fromTemplate(template, String(period || currentPeriod()).slice(0, 40));
  const { rows } = await db.query(`INSERT INTO forms(title, description, questions, settings, owner_login, owner_role, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [t.title, t.description, JSON.stringify(t.questions), JSON.stringify(DEFAULT_SETTINGS), ownerOf(admin), admin.role, actor]);
  return rows[0].id;
}
const IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
// Saves the builder's draft. Returns the cleaned questions so the builder keeps the same ids.
async function saveForm(form, input, actor) {
  const s = settingsOf(form), i = input.settings || {};
  const settings = {
    thankYou: String(i.thankYou ?? s.thankYou).slice(0, 1000), allowEdit: i.allowEdit === undefined ? s.allowEdit : !!i.allowEdit,
    reminderDays: Math.min(30, Math.max(0, parseInt(i.reminderDays ?? s.reminderDays, 10) || 0)), maxReminders: Math.min(5, Math.max(0, parseInt(i.maxReminders ?? s.maxReminders, 10) || 0)),
    inviteSubject: String(i.inviteSubject ?? s.inviteSubject).slice(0, 200), inviteMessage: String(i.inviteMessage ?? s.inviteMessage).slice(0, 2000),
    // Opt-in: email the results report when the survey closes (recipients already checked by the route).
    reportOnClose: (o => ({ enabled: !!o.enabled, recipients: [].concat(o.recipients || []).map(String).slice(0, 50), names: !!o.names, excel: !!o.excel }))(i.reportOnClose ?? s.reportOnClose ?? {}),
  };
  const questions = normalizeQuestions(input.questions);
  let cover = form.cover_image;
  if (input.coverImage === null || input.coverImage === '') cover = null;
  else if (typeof input.coverImage === 'string' && input.coverImage !== 'keep') {
    if (!IMAGE_RE.test(input.coverImage) || input.coverImage.length > 2_000_000) throw Object.assign(new Error('The cover image must be a PNG, JPEG, WebP or GIF under 1.5 MB.'), { status: 400 });
    cover = input.coverImage;
  }
  const closes = input.closesAt ? new Date(input.closesAt) : null;
  await db.query(`UPDATE forms SET title=$2, description=$3, questions=$4, settings=$5, cover_image=$6, closes_at=$7, updated_by=$8, updated_at=now() WHERE id=$1`,
    [form.id, String(input.title || '').trim().slice(0, 300) || 'Untitled survey', String(input.description || '').slice(0, 4000), JSON.stringify(questions),
     JSON.stringify(settings), cover, closes && !isNaN(closes) ? closes : null, actor]);
  return { questions, settings };
}
// A copy for the next round: same questions, settings and recipients (new personal links), no answers.
async function duplicateForm(admin, form, actor) {
  const title = form.title.replace(/(\d{4}) Q([1-4])/, (m, y, q) => (q === '4' ? `${+y + 1} Q1` : `${y} Q${+q + 1}`));
  const desc = form.description.replace(/(\d{4}) Q([1-4])/g, (m, y, q) => (q === '4' ? `${+y + 1} Q1` : `${y} Q${+q + 1}`));
  const { rows } = await db.query(`INSERT INTO forms(title, description, cover_image, questions, settings, owner_login, owner_role, copied_from, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [title === form.title ? `${form.title} (copy)` : title, desc, form.cover_image, JSON.stringify(form.questions), JSON.stringify(form.settings), ownerOf(admin), admin.role, form.id, actor]);
  const id = rows[0].id;
  const rec = (await db.query('SELECT email, name, first_name FROM form_recipients WHERE form_id = $1 AND NOT is_test', [form.id])).rows;
  for (const r of rec) await db.query('INSERT INTO form_recipients(form_id, email, name, first_name, token, added_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, r.email, r.name, r.first_name, token(), actor]);
  return id;
}
const deleteForm = id => db.query('DELETE FROM forms WHERE id = $1', [id]);
const setStatus = (id, status, actor) => db.query(`UPDATE forms SET status = $2, opened_at = CASE WHEN $2 = 'open' THEN coalesce(opened_at, now()) ELSE opened_at END,
    closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END, updated_by = $3, updated_at = now() WHERE id = $1`, [id, status, actor]);

// ---------- recipients ----------
// Company domains: shared with reports (src/domains.js).
const { domainAllowed } = require('../domains');
// "Name <email>", "email, Name", "email<TAB>Name" or just "email", one per line (or separated by ; ).
function parseRecipientLines(text, { domains = config.forms.recipientDomains } = {}) {
  const ok = [], invalid = [], blocked = [];
  for (const raw of String(text || '').split(/[\n;]+/).map(s => s.trim()).filter(Boolean)) {
    let email, name;
    const angle = /^(.*?)<\s*([^>]+)\s*>$/.exec(raw);
    if (angle) { name = angle[1].replace(/["',]/g, '').trim(); email = angle[2]; }
    else { const parts = raw.split(/[,\t]/).map(s => s.trim()).filter(Boolean); email = parts.find(p => p.includes('@')) || parts[0]; name = parts.filter(p => p !== email).join(' '); }
    email = String(email || '').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { invalid.push(raw); continue; }
    const host = email.split('@')[1];
    if (!domainAllowed(host, domains)) { blocked.push(email); continue; }
    if (!ok.some(x => x.email === email)) ok.push({ email, name: name || '' });
  }
  return { ok, invalid, blocked };
}
// Names for people listed without one, from their HDA contact (best effort – skipped when HDA can't be reached).
async function lookupNames(emails) {
  const out = new Map();
  if (!emails.length) return out;
  try {
    const { hda } = require('../hda/client');
    for (let i = 0; i < emails.length; i += 40) {
      const chunk = emails.slice(i, i + 40);
      const res = await hda().projection({ entity: 'Contact', columns: ['EMail', 'LastName', 'CONFNAME'], names: ['email', 'name', 'first'],
        filter: [{ property: 'EMail', op: 'in', value: chunk }], limit: 200 });
      for (const r of res.data || []) if (r.email) out.set(String(r.email).toLowerCase(), { name: r.name || '', first: r.first || '' });
    }
  } catch (e) { console.warn('[forms] HDA name lookup skipped:', e.message); }
  return out;
}
// "DSOUZA REUBEN" + first name "Reuben" → "REUBEN DSOUZA" (title-cased later). Unchanged when the first name isn't in it.
function firstNameFirst(full, first) {
  const words = String(full || '').trim().split(/\s+/).filter(Boolean), f = String(first || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!f.length || !f.every(w => words.some(x => x.toLowerCase() === w))) return words.join(' ');
  const firstWords = words.filter(x => f.includes(x.toLowerCase())), rest = words.filter(x => !f.includes(x.toLowerCase()));
  return [...firstWords, ...rest].join(' ');
}
// From an email alone: "phawinee.singto@…" → "Phawinee Singto".
const nameFromEmail = email => titleCase(email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim());
async function addRecipients(form, text, actor) {
  const p = parseRecipientLines(text);
  if (!p.ok.length) return { added: 0, ...p };
  const hdaNames = await lookupNames(p.ok.filter(r => !r.name).map(r => r.email));
  let added = 0;
  for (const r of p.ok) {
    const h = hdaNames.get(r.email);
    // HDA keeps "SURNAME First" in LastName; when its first-name field is known, show "First Surname".
    const hdaName = h && h.name ? firstNameFirst(h.name, h.first) : '';
    const name = r.name || hdaName || nameFromEmail(r.email);
    // A name typed by the admin is in normal order ("Raghavendra M"), so its first word is the first name.
    const first = (h && h.first ? titleCase(h.first) : '') || firstName({ fullName: name, email: r.email }) || (r.name ? titleCase(r.name.split(/\s+/)[0]) : nameFromEmail(r.email).split(' ')[0]);
    const ins = await db.query(`INSERT INTO form_recipients(form_id, email, name, first_name, token, added_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (form_id, email, is_test) DO NOTHING`,
      [form.id, r.email, titleCase(name), first || null, token(), actor]);
    added += ins.rowCount;
  }
  return { added, skipped: p.ok.length - added, ...p };
}
async function recipientsOf(formId) {
  return (await db.query(`SELECT r.*, x.submitted_at, x.started_at, x.id AS response_id FROM form_recipients r LEFT JOIN form_responses x ON x.recipient_id = r.id
    WHERE r.form_id = $1 ORDER BY r.is_test, x.submitted_at IS NULL, x.submitted_at DESC, r.name, r.email`, [formId])).rows;
}
const removeRecipient = (formId, rid) => db.query(`DELETE FROM form_recipients r WHERE r.id = $2 AND r.form_id = $1
    AND NOT EXISTS (SELECT 1 FROM form_responses x WHERE x.recipient_id = r.id AND x.submitted_at IS NOT NULL)`, [formId, rid]);

// ---------- invitation email ----------
function inviteEmail(form, r, { reminder = false } = {}) {
  const s = settingsOf(form), b = config.brand, link = surveyLink(r.token), mins = minutes(form.questions);
  const NAVY = '#0b1f3f', ACCENT = '#1f5fbf', MUTED = '#5b6780', LINE = '#dfe4ee', BG = '#f5f7fb';
  const hello = r.first_name ? `Hello ${esc(r.first_name)},` : 'Hello,';
  const message = s.inviteMessage.trim() || `We'd really value your feedback. Please take about ${mins} minute${mins === 1 ? '' : 's'} to answer our survey "${form.title}".`;
  const closes = form.closes_at ? `The survey closes on <b>${esc(fmtDate(form.closes_at))}</b>.` : '';
  const subject = `${r.is_test ? '[TEST] ' : ''}${reminder ? 'Reminder: ' : ''}${s.inviteSubject.trim() || form.title}`;
  const html = `<!doctype html><html><body style="margin:0;background:${BG}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:10px">
<tr><td style="background:${NAVY};padding:20px 24px;border-radius:10px 10px 0 0">
  <span style="font:800 17px Segoe UI,Arial,sans-serif;color:#ffffff">${esc(b.company)} <span style="font-weight:400;opacity:.85">${esc(b.unit)}</span></span>
  <div style="font:700 19px Segoe UI,Arial,sans-serif;color:#ffffff;margin-top:10px">${esc(form.title)}</div></td></tr>
<tr><td style="padding:22px 24px;font:14px/1.55 Segoe UI,Arial,sans-serif;color:#14213a">
  <p style="margin:0 0 14px">${hello}</p>
  ${reminder ? `<p style="margin:0 0 14px">A friendly reminder – we haven't received your answers yet.</p>` : ''}
  <p style="margin:0 0 18px">${esc(message).replace(/\n/g, '<br>')}</p>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${ACCENT};border-radius:8px">
    <a href="${esc(link)}" style="display:inline-block;padding:12px 22px;font:700 15px Segoe UI,Arial,sans-serif;color:#ffffff;text-decoration:none">Start the survey</a></td></tr></table>
  <p style="margin:18px 0 0;color:${MUTED};font-size:13px">${closes} Your answers are saved as you go, so you can finish later.</p>
  <p style="margin:14px 0 0;color:${MUTED};font-size:12px;border-top:1px solid ${LINE};padding-top:12px">This link is personal to you – please don't forward it. If the button doesn't work, copy this address into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${r.first_name ? `Hello ${r.first_name},` : 'Hello,'}\n\n${reminder ? "A friendly reminder – we haven't received your answers yet.\n\n" : ''}${message}\n\nStart the survey: ${link}\n${form.closes_at ? `The survey closes on ${fmtDate(form.closes_at)}.\n` : ''}\nThis link is personal to you – please don't forward it.`;
  return { subject, html, text };
}

// Sends the personal invitation to everyone not invited yet (or whose invitation failed). Opens the survey.
async function sendInvites(form, actor) {
  if (form.status === 'closed') throw Object.assign(new Error('This survey is closed. Reopen it first.'), { status: 400 });
  if (!form.questions.some(q => q.type !== 'section')) throw Object.assign(new Error('Add at least one question before sending.'), { status: 400 });
  const todo = (await db.query(`SELECT * FROM form_recipients WHERE form_id = $1 AND NOT is_test AND invite_status <> 'sent' ORDER BY id`, [form.id])).rows;
  if (!todo.length) return { sent: 0, failed: 0 };
  if (form.status === 'draft') await setStatus(form.id, 'open', actor);
  let sent = 0, failed = 0;
  for (const r of todo) {
    try {
      await sendMail({ to: r.email, ...inviteEmail(form, r) }, { direct: true });
      await db.query(`UPDATE form_recipients SET invite_status='sent', invited_at=now(), send_error=NULL WHERE id=$1`, [r.id]); sent++;
    } catch (e) {
      await db.query(`UPDATE form_recipients SET invite_status='failed', send_error=$2 WHERE id=$1`, [r.id, e.message.slice(0, 300)]); failed++;
    }
  }
  return { sent, failed };
}
// Reminder to invited people who haven't submitted. due=true: only those due by the survey's reminder rule.
async function sendReminders(form, { due = false, now = new Date() } = {}) {
  const s = settingsOf(form);
  const p = [form.id];
  let extra = '';
  if (due) { p.push(s.maxReminders, now, s.reminderDays); extra = `AND r.reminders_sent < $2 AND coalesce(r.last_reminded_at, r.invited_at) <= $3::timestamptz - make_interval(days => $4)`; }
  const todo = (await db.query(`SELECT r.* FROM form_recipients r LEFT JOIN form_responses x ON x.recipient_id = r.id
      WHERE r.form_id = $1 AND NOT r.is_test AND r.invite_status = 'sent' AND x.submitted_at IS NULL ${extra}`, p)).rows;
  let sent = 0, failed = 0;
  for (const r of todo) {
    try { await sendMail({ to: r.email, ...inviteEmail(form, r, { reminder: true }) }, { direct: true }); await db.query('UPDATE form_recipients SET reminders_sent = reminders_sent + 1, last_reminded_at = now() WHERE id = $1', [r.id]); sent++; }
    catch (e) { console.error('[forms] reminder failed:', e.message); failed++; }
  }
  return { sent, failed };
}
// "Send a test to me": a real personal email to one internal address, marked as a test. Works on drafts too
// (without opening the survey); test answers never appear in the results.
async function sendTest(form, email, actor) {
  const p = parseRecipientLines(email);
  if (!p.ok.length) throw Object.assign(new Error(p.blocked.length ? 'Tests can only go to an internal address.' : 'Enter a valid email address.'), { status: 400 });
  if (!form.questions.some(q => q.type !== 'section')) throw Object.assign(new Error('Add at least one question first.'), { status: 400 });
  const to = p.ok[0].email, name = p.ok[0].name || nameFromEmail(to);
  await db.query(`INSERT INTO form_recipients(form_id, email, name, first_name, token, is_test, added_by) VALUES ($1,$2,$3,$4,$5,true,$6)
      ON CONFLICT (form_id, email, is_test) DO NOTHING`, [form.id, to, titleCase(name), firstName({ fullName: name, email: to }) || name.split(' ')[0], token(), actor]);
  const r = (await db.query('SELECT * FROM form_recipients WHERE form_id = $1 AND email = $2 AND is_test', [form.id, to])).rows[0];
  // A fresh start for each test: earlier test answers from this address are cleared.
  await db.query('DELETE FROM form_responses WHERE recipient_id = $1', [r.id]);
  await sendMail({ to, ...inviteEmail(form, r) }, { direct: true });
  await db.query(`UPDATE form_recipients SET invite_status='sent', invited_at=now(), opened_at=NULL WHERE id=$1`, [r.id]);
  return { to };
}
const clearTests = formId => db.query('DELETE FROM form_recipients WHERE form_id = $1 AND is_test', [formId]);

// Scheduler: close surveys whose close date has passed, and send reminders that are due.
async function runFormJobs(now = new Date()) {
  const closed = await db.query(`UPDATE forms SET status='closed', closed_at=now(), updated_at=now(), updated_by='CSAT Pulse (close date)' WHERE status='open' AND closes_at IS NOT NULL AND closes_at <= $1 RETURNING id`, [now]);
  let reminded = 0;
  const open = (await db.query(`SELECT * FROM forms WHERE status = 'open' AND coalesce((settings->>'reminderDays')::int, 0) > 0 AND coalesce((settings->>'maxReminders')::int, 0) > 0`)).rows;
  for (const f of open) reminded += (await sendReminders({ ...f, settings: settingsOf(f) }, { due: true, now })).sent;
  return { closed: closed.rowCount, closedIds: closed.rows.map(r => r.id), reminded };
}

// ---------- answering (public, by personal link) ----------
async function findByToken(t) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(t || ''))) return null;
  const r = (await db.query('SELECT * FROM form_recipients WHERE token = $1', [t])).rows[0];
  if (!r) return null;
  const f = (await db.query('SELECT * FROM forms WHERE id = $1', [r.form_id])).rows[0];
  const x = (await db.query('SELECT * FROM form_responses WHERE recipient_id = $1', [r.id])).rows[0] || null;
  return { form: { ...f, settings: settingsOf(f) }, recipient: r, response: x };
}
const isOpen = f => f.status === 'open' && (!f.closes_at || new Date(f.closes_at) > new Date());
async function markOpened(r) {
  if (!r.opened_at) await db.query('UPDATE form_recipients SET opened_at = now() WHERE id = $1 AND opened_at IS NULL', [r.id]);
}
// When answering started: the page reports how long it has been open (capped at 4 hours), so "time to complete"
// measures the answering, not the days between receiving the email and opening it.
const startedAt = elapsed => new Date(Date.now() - Math.min(4 * 3600, Math.max(0, Number(elapsed) || 0)) * 1000);
const canAnswer = ({ form, recipient, response }) => (isOpen(form) || (recipient && recipient.is_test && form.status === 'draft'))
  && (!response || !response.submitted_at || form.settings.allowEdit || (recipient && recipient.is_test));
// Autosave while answering (no required checks).
async function saveDraft(ctx, input, { elapsed } = {}) {
  if (!canAnswer(ctx)) return { ok: false, error: 'closed' };
  const { answers } = validateAnswers(ctx.form.questions, input);
  await db.query(`INSERT INTO form_responses(form_id, recipient_id, answers, started_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT (recipient_id) DO UPDATE SET answers = EXCLUDED.answers, updated_at = now()`, [ctx.form.id, ctx.recipient.id, JSON.stringify(answers), startedAt(elapsed)]);
  return { ok: true };
}
async function submit(ctx, input, { elapsed } = {}) {
  if (!canAnswer(ctx)) return { ok: false, error: ctx.response && ctx.response.submitted_at ? 'already' : 'closed' };
  const { answers, errors } = validateAnswers(ctx.form.questions, input, { final: true });
  if (Object.keys(errors).length) return { ok: false, error: 'invalid', errors, answers };
  await db.query(`INSERT INTO form_responses(form_id, recipient_id, answers, started_at, submitted_at) VALUES ($1,$2,$3,$4, now())
      ON CONFLICT (recipient_id) DO UPDATE SET answers = EXCLUDED.answers, submitted_at = coalesce(form_responses.submitted_at, now()), updated_at = now()`,
    [ctx.form.id, ctx.recipient.id, JSON.stringify(answers), startedAt(elapsed)]);
  return { ok: true };
}

// ---------- results ----------
async function submittedResponses(formId) {
  return (await db.query(`SELECT x.id, x.answers, x.started_at, x.submitted_at, x.updated_at, r.name, r.email, r.id AS recipient_id
    FROM form_responses x JOIN form_recipients r ON r.id = x.recipient_id WHERE x.form_id = $1 AND NOT r.is_test AND x.submitted_at IS NOT NULL ORDER BY x.submitted_at`, [formId])).rows;
}
async function results(form) {
  const [responses, recipients] = await Promise.all([submittedResponses(form.id), recipientsOf(form.id)]);
  const real = recipients.filter(r => !r.is_test);
  const invited = real.filter(r => r.invite_status === 'sent').length;
  const secs = responses.map(r => (new Date(r.submitted_at) - new Date(r.started_at)) / 1000).filter(s => s > 0).sort((a, b) => a - b);
  return { responses, recipients: real, summary: summarize(form.questions, responses), numbers: numbering(form.questions),
    stats: { invited, responded: responses.length, rate: invited ? responses.length / invited : null, opened: real.filter(r => r.opened_at).length,
      medianSeconds: secs.length ? secs[Math.floor(secs.length / 2)] : null } };
}
const exportCsv = async (form, { anonymous = false } = {}) => toCsv(form.questions, await submittedResponses(form.id), { anonymous });

module.exports = { listForms, getForm, createForm, saveForm, duplicateForm, deleteForm, setStatus, parseRecipientLines, addRecipients, recipientsOf, removeRecipient,
  domainAllowed, inviteEmail, sendInvites, sendReminders, sendTest, clearTests, runFormJobs, findByToken, isOpen, canAnswer, markOpened, saveDraft, submit, results, exportCsv, minutes, surveyLink, settingsOf, ownerOf };
