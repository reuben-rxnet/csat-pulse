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
  return { pdf, filename: `CSAT-report_${fileDate(period.from)}_to_${fileDate(last)}.pdf`, label, kpis: m.kpis, prev: m.prev, target };
}

const pct = v => (v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1) + '%');
// Short Outlook-friendly email with the main figures; the full report is the attached PDF.
function reportEmail({ title, period, label, kpis, target, message, producedBy, scheduleName }) {
  const NAVY = '#0b1f3f', MUTED = '#5b6780', LINE = '#dfe4ee', BG = '#f5f7fb';
  const b = config.brand;
  const cell = (k, v) => `<td style="padding:10px 12px;background:${BG};border-radius:6px;width:33%;vertical-align:top">
      <div style="font:700 11px Segoe UI,Arial,sans-serif;color:${MUTED};text-transform:uppercase">${esc(k)}</div>
      <div style="font:700 20px Segoe UI,Arial,sans-serif;color:#14213a;margin-top:2px">${esc(v)}</div></td>`;
  const html = `<!doctype html><html><body style="margin:0;background:${BG}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:10px">
<tr><td style="background:${NAVY};padding:20px 24px;border-radius:10px 10px 0 0">
  <span style="font:800 17px Segoe UI,Arial,sans-serif;color:#ffffff">${esc(b.company)} <span style="font-weight:400;opacity:.85">${esc(b.unit)}</span></span>
  <div style="font:700 19px Segoe UI,Arial,sans-serif;color:#ffffff;margin-top:10px">${esc(scheduleName || title)}</div>
  <div style="font:13px Segoe UI,Arial,sans-serif;color:#ffffff;opacity:.8;margin-top:4px">${esc(periodLabel(period.from, period.to))}</div></td></tr>
<tr><td style="padding:20px 24px;font:14px Segoe UI,Arial,sans-serif;color:#14213a">
  ${message ? `<p style="margin:0 0 14px">${esc(message).replace(/\n/g, '<br>')}</p>` : ''}
  <p style="margin:0 0 14px;color:${MUTED}">Owner groups: ${esc(label)}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>${cell('CSAT %', pct(kpis.csat))}${cell('Average score', kpis.avg == null ? '–' : kpis.avg.toFixed(2) + ' / 5')}${cell('Response rate', pct(kpis.rate))}</tr>
    <tr>${cell('Surveys sent', String(kpis.sent))}${cell('Responses', String(kpis.n))}${cell('Low scores (1–2)', String(kpis.det))}</tr></table>
  <p style="margin:14px 0 0">CSAT target: ${Math.round(target * 100)}%. The full report is attached as a PDF.</p>
  <p style="margin:14px 0 0;font-size:12px;color:${MUTED}">${scheduleName ? 'Scheduled report' : 'Sent'} from ${esc(b.product)} by ${esc(producedBy)}. For internal use only – please don't forward outside the company.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${scheduleName || title} – ${periodLabel(period.from, period.to)}\nOwner groups: ${label}\nCSAT ${pct(kpis.csat)} · average ${kpis.avg == null ? '–' : kpis.avg.toFixed(2)} · response rate ${pct(kpis.rate)} · ${kpis.sent} surveys sent · ${kpis.det} low scores\nThe full report is attached as a PDF.`;
  return { html, text };
}

async function logRun(r) {
  await db.query(`INSERT INTO report_runs(schedule_id, kind, actor, owner_login, recipients, period_from, period_to, groups, sections, status, error)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [r.scheduleId || null, r.kind, r.actor, r.owner || null, r.recipients || null, r.period.from, r.period.to, r.groups, r.sections, r.status, r.error || null]);
}

// Builds and emails one report. Throws on failure (after logging it).
async function sendReport({ to, period, groups, sections, actor, owner, message, scheduleId, scheduleName, kind = 'send' }) {
  const title = isCustom(sections) ? 'CSAT report (custom)' : 'CSAT report';
  try {
    const r = await buildReport({ period, groups, sections, producedBy: actor, title });
    const mail = reportEmail({ title, period, label: r.label, kpis: r.kpis, target: r.target, message, producedBy: actor, scheduleName });
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
  return (await db.query(`SELECT r.*, s.name AS schedule_name FROM report_runs r LEFT JOIN scheduled_reports s ON s.id = r.schedule_id
      WHERE ($1::text IS NULL OR r.owner_login = $1) ORDER BY r.at DESC LIMIT $2`, [own, limit])).rows;
}

module.exports = { recipients, resolveGroups, buildReport, sendReport, logRun, listSchedules, getSchedule, saveSchedule, setScheduleEnabled, deleteSchedule,
  sendScheduleNow, runDueReports, listRuns, ownerOf };
