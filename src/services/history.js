'use strict';
// Change history: the audit log in plain words. Team admins see only entries about their own owner groups.
const db = require('../db');

const RULE_WORDS = { ticketTypes: 'ticket types', sendDelayMinutes: 'send delay', throttleDays: 'per-person limit', reminderDays: 'reminder',
  expiryDays: 'link expiry', alertThreshold: 'low-score alert' };

async function listHistory({ scope = null, q = '', limit = 200 } = {}) {
  const p = [], w = [];
  if (scope) { p.push(scope); w.push(`coalesce(a.detail->>'id', a.detail->>'group', s.owner_group_id) = ANY($${p.length}::text[])`); }
  if (q) { p.push('%' + q + '%'); w.push(`(a.actor ILIKE $${p.length} OR a.action ILIKE $${p.length} OR a.detail::text ILIKE $${p.length} OR s.ticket_number ILIKE $${p.length})`); }
  p.push(limit);
  const { rows } = await db.query(`SELECT a.*, s.ticket_number AS survey_ticket, coalesce(a.detail->>'id', a.detail->>'group', s.owner_group_id) AS group_id
    FROM audit_log a LEFT JOIN surveys s ON a.detail ? 'survey' AND s.id::text = a.detail->>'survey'
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.at DESC LIMIT $${p.length}`, p);
  return rows;
}

// One readable sentence per entry. groupName(id) → display name.
function describe(e, groupName = id => id) {
  const d = e.detail || {}, g = groupName(e.group_id || d.id || d.group), on = v => (v ? 'on' : 'off');
  const ticket = e.survey_ticket || d.ticket || (d.survey ? `survey ${d.survey}` : 'a ticket');
  switch (e.action) {
    case 'group.toggle': return `Switched surveys ${on(d.enabled)} for ${g}`;
    case 'group.bulk': return `Switched all owner groups ${on(d.enabled)}`;
    case 'group.lead': return d.email ? `Set the group lead email for ${g} to ${d.email}` : `Removed the group lead email for ${g}`;
    case 'group.settings': {
      const own = Object.keys(d.rules || {}).map(k => RULE_WORDS[k]).filter(Boolean);
      const src = d.sources ? `own sources: ${d.sources.join(', ') || 'none'}` : 'default sources';
      return `Changed sources & rules for ${g} (${src}${own.length ? `; own ${own.join(', ')}` : '; default rules'})`;
    }
    case 'group.sync': return 'Synced owner groups and ticket sources from HDA';
    case 'source.toggle': return `Switched the default source "${d.source}" ${on(d.enabled)}`;
    case 'settings.update': return 'Changed the default send rules';
    case 'source.cleanup': return `Removed unused ticket sources: ${(d.removed || []).join(', ')}${d.reason ? ` (${d.reason})` : ''}`;
    case 'access.add': return `Gave ${d.login} access to ${g}`;
    case 'access.remove': return `Removed ${d.login}'s extra access to ${g}`;
    case 'admin.view_as': return `Viewed CSAT Pulse as ${d.login}`;
    case 'survey.test_send': return `Sent a test survey for ${d.ticket || 'the sample ticket'} to ${d.to}`;
    case 'survey.email_fixed': return `Typed the email for ${ticket} and sent its survey`;
    case 'survey.email_dismissed': return `Dismissed ${ticket} (no valid email)`;
    case 'report.send': return `Emailed a CSAT report (${d.from} to ${d.until}) to ${(d.to || []).join(', ')}`;
    case 'report.schedule_save': return `${d.created ? 'Created' : 'Changed'} the scheduled report "${d.name}" (${d.frequency}, to ${(d.to || []).join(', ')})`;
    case 'report.schedule_toggle': return `${d.enabled ? 'Resumed' : 'Paused'} the scheduled report "${d.name}"`;
    case 'report.schedule_delete': return `Deleted the scheduled report "${d.name}"`;
    case 'report.schedule_run': return `Sent the scheduled report "${d.name}" now`;
    case 'hda.retry': return d.ok ? 'Signed in to HDA again after it was paused' : 'Tried to sign in to HDA again (still failing)';
    case 'auth.sign_in': return `Signed in${d.name ? ` (${d.name})` : ''}`;
    case 'followup.update': return `Marked the low-score follow-up for ${ticket} as ${d.status}`;
    default: return e.action;
  }
}

module.exports = { listHistory, describe };
