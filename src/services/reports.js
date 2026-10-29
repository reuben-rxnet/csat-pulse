'use strict';
// PDF reports: build (same numbers as the dashboard), download, email now, and scheduled sends to stakeholders.
// Reports go straight to the addresses an admin typed (like Test survey), limited to config.reports.recipientDomains.
const config = require('../config');
const db = require('../db');
const { getMetrics } = require('./metrics');
const { getSettings } = require('./settings');
const { sendMail } = require('../mail/transport');
const { esc } = require('../mail/templates');
const { renderReportPdf } = require('../report/layout');
const { renderSurveyPdf } = require('../report/survey-layout');
const mailKit = require('../mail/report-email');
const formsSvc = require('./forms');
const { SECTION_KEYS, isCustom, periodFor, nextRunAt, parseRecipients, periodLabel } = require('../report/schedule');

const MAX_GROUPS_IN_LABEL = 8;
const ownerOf = admin => admin.login || admin.name;
const recipients = text => parseRecipients(text, { domains: config.reports.recipientDomains, max: config.reports.maxRecipients });

// The groups a report covers. Global admin: null (all) or the ticked groups. Team admin: always a list within their groups.
function resolveGroups(admin, { all, picked }) {
  const scope = admin.role === 'global' ? null : [...admin.groups];
  const list = [...new Set([].concat(picked || []).map(String).filter(Boolean))];
  if (all || !list.length) return scope ? { groups: scope } : { groups: null };
  if (scope && list.some(g => !scope.includes(g))) return { error: 'You can only report on your own owner groups.' };
  return { groups: list };
}

async function groupsLabel(groups) {
  if (!groups) return 'All owner groups';
  const names = (await db.query('SELECT hda_group_id, name FROM owner_groups WHERE hda_group_id = ANY($1::text[]) ORDER BY name', [groups])).rows.map(r => r.name || r.hda_group_id);
  for (const g of groups) if (names.length < groups.length && !names.includes(g)) names.push(g);
  return names.length > MAX_GROUPS_IN_LABEL ? `${names.slice(0, MAX_GROUPS_IN_LABEL).join(', ')} and ${names.length - MAX_GROUPS_IN_LABEL} more` : names.join(', ');
}

async function followupCounts(groups, from, to) {
  const { rows } = await db.query(`SELECT r.followup_status AS s, count(*)::int AS c FROM surveys s JOIN responses r ON r.survey_id = s.id
      WHERE r.overall <= 2 AND NOT s.is_test AND s.sent_at >= $1 AND s.sent_at < $2 AND ($3::text[] IS NULL OR s.owner_group_id = ANY($3::text[])) GROUP BY 1`, [from, to, groups]);
  return Object.fromEntries(rows.map(r => [r.s || 'open', r.c]));
}

const fileDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// → { pdf (Buffer), filename, label, kpis, target }
async function buildReport({ period, groups, sections, producedBy, title }) {
  const secs = SECTION_KEYS.filter(k => sections.includes(k));
  const [m, settings, label, followups] = await Promise.all([
    getMetrics({ from: period.from, to: period.to, prevFrom: period.prevFrom, groups, agentLimit: 200 }),
    getSettings(), groupsLabel(groups), followupCounts(groups, period.from, period.to),
  ]);
  const target = (settings.csatTarget || 85) / 100;
  const pdf = renderReportPdf({ m, period, sections: secs, target, groupsLabel: label, producedBy, followups, custom: isCustom(secs), title });
  const last = new Date(period.to.getTime() - 1);
  return { pdf, filename: `CSAT-report_${fileDate(period.from)}_to_${fileDate(last)}.pdf`, label, kpis: m.kpis, prev: m.prev, target, m };
}

const footer = (who, scheduled) => `${scheduled ? 'Scheduled report' : 'Sent'} from ${esc(config.brand.product)} by ${esc(who)}. The full report is attached as a PDF.
  For internal use only – please don't forward outside the company.`;
const hours = h => (h == null ? '–' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
// Ticket CSAT report email: KPI tiles, the weekly trend, the score spread and CSAT by owner group – all in the body.
function reportEmail({ title, period, label, m, target, message, producedBy, scheduleName }) {
  const k = m.kpis, p = m.prev, E = mailKit;
  const d = (a, b, o) => E.delta(a, b, o);
  const csatTone = k.csat == null ? undefined : k.csat >= target ? 'good' : k.csat >= target - 0.1 ? 'warn' : 'bad';
  const t1 = d(k.csat, p.csat, { isPct: true }), t2 = d(k.avg, p.avg), t3 = d(k.rate, p.rate, { isPct: true });
  const blocks = [
    E.block('Main figures', E.tiles([
      { label: 'CSAT %', value: E.pct(k.csat), tone: csatTone, sub: `${t1.text} · target ${Math.round(target * 100)}%`, subTone: t1.tone },
      { label: 'Average score', value: k.avg == null ? '–' : `${k.avg.toFixed(2)} / 5`, sub: t2.text, subTone: t2.tone },
      { label: 'Response rate', value: E.pct(k.rate), sub: t3.text, subTone: t3.tone },
      { label: 'Surveys sent', value: String(k.sent), sub: `${k.n} answered` },
      { label: 'Low scores (1–2)', value: String(k.det), tone: k.det ? 'bad' : undefined, sub: `${k.open_followups} still to follow up` },
      { label: 'Time to respond', value: hours(k.median_hours), sub: 'median, email to answer' },
    ])),
  ];
  const weeks = m.trend.filter(w => w.n > 0).slice(-13);
  if (weeks.length) blocks.push(E.block('CSAT % by week', E.columns(weeks.map(w => ({ label: new Date(w.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    share: w.csat, value: E.pct(w.csat, 0), color: w.csat >= target ? E.C.good : E.C.accent }))), `green = at or above ${Math.round(target * 100)}%`));
  const dist = [5, 4, 3, 2, 1].map(s => ({ label: `${s}`, count: (m.dist.find(x => x.score === s) || { c: 0 }).c, color: E.C.score[s - 1] }));
  if (dist.some(x => x.count)) blocks.push(E.block('Score distribution', E.stacked(dist.map(x => ({ ...x, label: { 5: '5 Very satisfied', 4: '4 Satisfied', 3: '3 Neutral', 2: '2 Dissatisfied', 1: '1 Very dissatisfied' }[x.label] })))));
  const groups = m.byGroup.filter(g => g.n >= 5).slice(0, 8);
  if (groups.length) blocks.push(E.block('CSAT % by owner group', E.hbars(groups.map(g => ({ label: g.key, sub: `${g.n} responses`, share: g.csat, value: E.pct(g.csat),
    color: g.csat >= target ? E.C.good : g.csat >= target - 0.1 ? E.C.warn : E.C.bad }))), 'at least 5 responses'));
  const html = E.shell({ title: scheduleName || title, subtitle: periodLabel(period.from, period.to), message, intro: `Owner groups: ${esc(label)}`, blocks, footer: footer(producedBy, !!scheduleName) });
  const text = `${scheduleName || title} – ${periodLabel(period.from, period.to)}\nOwner groups: ${label}\nCSAT ${E.pct(k.csat)} (target ${Math.round(target * 100)}%) · average ${k.avg == null ? '–' : k.avg.toFixed(2)} · response rate ${E.pct(k.rate)} · ${k.sent} surveys sent · ${k.det} low scores\nThe full report is attached as a PDF.`;
  return { html, text };
}

async function logRun(r) {
  await db.query(`INSERT INTO report_runs(schedule_id, kind, actor, owner_login, recipients, period_from, period_to, groups, sections, status, error, form_id, title)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [r.scheduleId || null, r.kind, r.actor, r.owner || null, r.recipients || null, r.period.from, r.period.to, r.groups || null, r.sections || null, r.status, r.error || null, r.formId || null, r.title || null]);
}

// ---------- stakeholder survey reports ----------
const safeName = s => String(s).replace(/[^\w\- ()]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'survey';
async function buildSurveyReport(form, { includeNames = false, producedBy }) {
  const res = await formsSvc.results(form);
  const pdf = renderSurveyPdf({ form, res, includeNames, producedBy });
  return { res, pdf, filename: `${safeName(form.title)}-results.pdf` };
}
// Survey results email: figure tiles, NPS mix and every rating grid as bars – never names.
function surveyEmail(form, res, { message, producedBy, automatic = false }) {
  const E = mailKit, { stats, summary, numbers } = res;
  const nps = summary.find(s => s.q.type === 'nps' && s.n);
  const rows = summary.filter(s => s.q.type === 'likert').flatMap(s => s.rows).filter(r => r.n);
  const avg = rows.length ? rows.reduce((a, r) => a + r.avg * r.n, 0) / rows.reduce((a, r) => a + r.n, 0) : null;
  const blocks = [E.block('Main figures', E.tiles([
    { label: 'Responses', value: String(stats.responded), sub: `of ${stats.invited} invited` },
    { label: 'Response rate', value: E.pct(stats.rate, 0), sub: `${stats.opened} opened the link` },
    { label: 'Average rating', value: avg == null ? '–' : `${avg.toFixed(2)} / 5`, sub: 'all rating-grid answers' },
    ...(nps ? [{ label: 'NPS', value: String(Math.round(nps.score)), tone: nps.score >= 30 ? 'good' : nps.score >= 0 ? 'warn' : 'bad', sub: `${nps.promoters} promoter${nps.promoters === 1 ? '' : 's'} · ${nps.detractors} detractor${nps.detractors === 1 ? '' : 's'}` }] : []),
  ]))];
  if (nps) blocks.push(E.block('Net Promoter Score', E.stacked([{ label: 'Promoters (9–10)', count: nps.promoters, color: E.C.good }, { label: 'Passives (7–8)', count: nps.passives, color: E.C.score[2] },
    { label: 'Detractors (0–6)', count: nps.detractors, color: E.C.bad }])));
  for (const s of summary) {
    if (s.q.type === 'likert' && s.n) blocks.push(E.block(`${numbers[s.q.id]}. ${s.q.title}`, E.hbars(s.rows.map(r => ({ label: r.row.label, share: r.avg == null ? 0 : (r.avg - 1) / (s.q.scale.length - 1),
      value: r.avg == null ? '–' : `${r.avg.toFixed(2)} · ${E.pct(r.positive, 0)}`, color: r.avg == null ? E.C.track : r.avg >= 4 ? E.C.good : r.avg >= 3 ? E.C.accent : E.C.bad }))), 'average · % positive'));
    if ((s.q.type === 'choice' || s.q.type === 'checkbox') && s.n) { const max = Math.max(1, ...Object.values(s.counts));
      blocks.push(E.block(`${numbers[s.q.id]}. ${s.q.title}`, E.hbars(s.q.options.map(o => ({ label: o.label, share: s.counts[o.id] / max, value: String(s.counts[o.id]) }))))); }
  }
  const comments = summary.filter(s => s.q.type === 'text').reduce((a, s) => a + s.n, 0);
  const status = form.status === 'closed' ? `Final results – the survey closed on ${new Date(form.closed_at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.` : 'Results so far – the survey is still open.';
  const html = E.shell({ title: form.title, subtitle: 'Stakeholder survey results', message, intro: `${status}${comments ? ` ${comments} written comment${comments === 1 ? ' is' : 's are'} in the PDF.` : ''}`, blocks,
    footer: `${automatic ? 'Sent automatically when the survey closed' : 'Sent'} from ${esc(config.brand.product)}${automatic ? '' : ` by ${esc(producedBy)}`}. The full results are attached as a PDF. For internal use only – please don't forward outside the company.` });
  const text = `${form.title} – stakeholder survey results\n${status}\nResponses ${stats.responded} of ${stats.invited} (${E.pct(stats.rate, 0)}) · average rating ${avg == null ? '–' : avg.toFixed(2)}${nps ? ` · NPS ${Math.round(nps.score)}` : ''}\nThe full results are attached as a PDF.`;
  return { html, text };
}
// Emails one survey's results. Names only with includeNames; the Excel file only with excel.
async function sendSurveyReport({ form, to, includeNames = false, excel = false, message, actor, owner, kind = 'send' }) {
  const period = { from: form.opened_at || form.created_at, to: form.closed_at || new Date() };
  const base = { kind, actor, owner, recipients: to, period, sections: ['survey', ...(includeNames ? ['names'] : []), ...(excel ? ['excel'] : [])], formId: form.id, title: form.title };
  try {
    const r = await buildSurveyReport(form, { includeNames, producedBy: actor });
    const attachments = [{ filename: r.filename, content: r.pdf, contentType: 'application/pdf' }];
    if (excel) attachments.push({ filename: `${safeName(form.title)}-responses.csv`, content: Buffer.from(await formsSvc.exportCsv(form, { anonymous: !includeNames }), 'utf8'), contentType: 'text/csv' });
    await sendMail({ to, subject: `Results: ${form.title}`, ...surveyEmail(form, r.res, { message, producedBy: actor, automatic: kind === 'on_close' }), attachments }, { direct: true });
    await logRun({ ...base, status: 'ok' });
    return r;
  } catch (e) {
    await logRun({ ...base, status: 'failed', error: e.message }).catch(() => {});
    throw e;
  }
}
// "Email the results when the survey closes" (opt-in per survey). Called after a manual close and by the scheduler.
async function sendResultsOnClose(formId) {
  const f = (await db.query('SELECT * FROM forms WHERE id = $1', [formId])).rows[0];
  if (!f || f.status !== 'closed') return { sent: false };
  const form = { ...f, settings: formsSvc.settingsOf(f) }, o = form.settings.reportOnClose || {};
  if (!o.enabled || !(o.recipients || []).length) return { sent: false };
  try {
    await sendSurveyReport({ form, to: o.recipients, includeNames: !!o.names, excel: !!o.excel, actor: `${config.brand.product} (survey closed)`, owner: form.owner_login, kind: 'on_close' });
    await db.query('UPDATE forms SET report_sent_at = now(), report_error = NULL WHERE id = $1', [form.id]);
    return { sent: true };
  } catch (e) {
    console.error(`[reports] results of "${form.title}" could not be emailed:`, e.message);
    await db.query('UPDATE forms SET report_error = $2 WHERE id = $1', [form.id, e.message.slice(0, 300)]);
    return { sent: false, error: e.message };
  }
}

// Builds and emails one report. Throws on failure (after logging it).
async function sendReport({ to, period, groups, sections, actor, owner, message, scheduleId, scheduleName, kind = 'send' }) {
  const title = isCustom(sections) ? 'CSAT report (custom)' : 'CSAT report';
  try {
    const r = await buildReport({ period, groups, sections, producedBy: actor, title });
    const mail = reportEmail({ title, period, label: r.label, m: r.m, target: r.target, message, producedBy: actor, scheduleName });
    await sendMail({ to, subject: `${scheduleName || title} · ${periodLabel(period.from, period.to)}`, ...mail,
      attachments: [{ filename: r.filename, content: r.pdf, contentType: 'application/pdf' }] }, { direct: true });
    await logRun({ kind, actor, owner, recipients: to, period, groups, sections, scheduleId, status: 'ok' });
    return r;
  } catch (e) {
    await logRun({ kind, actor, owner, recipients: to, period, groups, sections, scheduleId, status: 'failed', error: e.message }).catch(() => {});
    throw e;
  }
}

// ---------- schedules ----------
async function listSchedules(admin) {
  const own = admin.role === 'global' ? null : ownerOf(admin);
  return (await db.query('SELECT * FROM scheduled_reports WHERE ($1::text IS NULL OR owner_login = $1) ORDER BY name, id', [own])).rows;
}
async function getSchedule(admin, id) {
  const s = (await db.query('SELECT * FROM scheduled_reports WHERE id = $1', [parseInt(id, 10) || 0])).rows[0];
  if (!s || (admin.role !== 'global' && s.owner_login !== ownerOf(admin))) return null;
  return s;
}
async function saveSchedule(admin, id, v, actor, now = new Date()) {
  const next = v.enabled === false ? null : nextRunAt(v, now);
  if (id) {
    const r = await db.query(`UPDATE scheduled_reports SET name=$2, recipients=$3, frequency=$4, run_day=$5, send_hour=$6, groups=$7, sections=$8,
        next_run_at = CASE WHEN enabled THEN $9::timestamptz END, retry_anchor = NULL, attempts = 0, updated_by=$10, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, v.name, v.recipients, v.frequency, v.run_day, v.send_hour, v.groups, v.sections, next, actor]);
    return r.rows[0];
  }
  const r = await db.query(`INSERT INTO scheduled_reports(name, recipients, frequency, run_day, send_hour, groups, sections, owner_login, owner_role, next_run_at, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [v.name, v.recipients, v.frequency, v.run_day, v.send_hour, v.groups, v.sections, ownerOf(admin), admin.role, next, actor]);
  return r.rows[0];
}
async function setScheduleEnabled(id, enabled, actor, now = new Date()) {
  const s = (await db.query('SELECT * FROM scheduled_reports WHERE id = $1', [id])).rows[0];
  if (!s) return null;
  // Resuming skips any sends missed while paused.
  await db.query('UPDATE scheduled_reports SET enabled=$2, next_run_at=$3, retry_anchor=NULL, attempts=0, updated_by=$4, updated_at=now() WHERE id=$1',
    [id, enabled, enabled ? nextRunAt(s, now) : null, actor]);
  return s;
}
const deleteSchedule = id => db.query('DELETE FROM scheduled_reports WHERE id = $1', [id]);

// "Send now" for a schedule: the latest complete period.
const sendScheduleNow = (s, actor, now = new Date()) => sendReport({ to: s.recipients, period: periodFor(s.frequency, now), groups: s.groups, sections: s.sections,
  actor, owner: s.owner_login, scheduleId: s.id, scheduleName: s.name, kind: 'send' });

const RETRY_MINUTES = 30, MAX_ATTEMPTS = 3;
// Called by the scheduler. Sends every due report once; a failed send is retried up to 3 times, 30 minutes apart, for the same period.
async function runDueReports(now = new Date()) {
  const due = (await db.query('SELECT * FROM scheduled_reports WHERE enabled AND next_run_at <= $1 ORDER BY next_run_at', [now])).rows;
  let sent = 0, failed = 0;
  for (const s of due) {
    // Claim it first (a 15-minute lease), so a slow send can't be picked up twice and a crash mid-send is retried.
    const claim = await db.query('UPDATE scheduled_reports SET next_run_at = $3, retry_anchor = coalesce(retry_anchor, next_run_at) WHERE id = $1 AND enabled AND next_run_at <= $2',
      [s.id, now, new Date(now.getTime() + 15 * 60e3)]);
    if (!claim.rowCount) continue;
    const anchor = s.retry_anchor || s.next_run_at;
    try {
      await sendReport({ to: s.recipients, period: periodFor(s.frequency, anchor), groups: s.groups, sections: s.sections,
        actor: `${config.brand.product} (scheduled by ${s.owner_login})`, owner: s.owner_login, scheduleId: s.id, scheduleName: s.name, kind: 'scheduled' });
      await db.query(`UPDATE scheduled_reports SET next_run_at=$2, retry_anchor=NULL, attempts=0, last_run_at=now(), last_status='ok', last_error=NULL WHERE id=$1`,
        [s.id, nextRunAt(s, new Date(Math.max(anchor.getTime(), now.getTime())))]);
      sent++;
    } catch (e) {
      const attempts = s.attempts + 1, retry = attempts < MAX_ATTEMPTS;
      console.error(`[reports] "${s.name}" failed (attempt ${attempts}):`, e.message);
      await db.query(`UPDATE scheduled_reports SET next_run_at=$2, retry_anchor=$3, attempts=$4, last_run_at=now(), last_status='failed', last_error=$5 WHERE id=$1`,
        [s.id, retry ? new Date(now.getTime() + RETRY_MINUTES * 60e3) : nextRunAt(s, new Date(Math.max(anchor.getTime(), now.getTime()))),
         retry ? anchor : null, retry ? attempts : 0, e.message.slice(0, 500)]);
      failed++;
    }
  }
  return { sent, failed };
}

async function listRuns(admin, limit = 30) {
  const own = admin.role === 'global' ? null : ownerOf(admin);
  return (await db.query(`SELECT r.*, s.name AS schedule_name, coalesce(f.title, r.title) AS form_title FROM report_runs r LEFT JOIN scheduled_reports s ON s.id = r.schedule_id LEFT JOIN forms f ON f.id = r.form_id
      WHERE ($1::text IS NULL OR r.owner_login = $1) ORDER BY r.at DESC LIMIT $2`, [own, limit])).rows;
}

module.exports = { recipients, resolveGroups, buildReport, sendReport, logRun, buildSurveyReport, sendSurveyReport, sendResultsOnClose, surveyEmail, reportEmail, listSchedules, getSchedule, saveSchedule, setScheduleEnabled, deleteSchedule,
  sendScheduleNow, runDueReports, listRuns, ownerOf };
