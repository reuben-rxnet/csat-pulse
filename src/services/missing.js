'use strict';
// "Missing emails": surveys skipped because the HDA contact had no valid email. A team admin can type the right address
// and send the survey (that one survey only – HDA stays the source of truth), or dismiss the ticket.
// "Contacts to fix": the HDA contacts behind those tickets, to hand to the HDA team so they can correct the profiles.
const db = require('../db');
const { NO_EMAIL_REASON, isValidEmail } = require('./rules');
const { getSettings, getGroupSettings, effectiveSettings } = require('./settings');
const { sendOne } = require('./sender');

const scoped = (scope, p, col = 's.owner_group_id') => { if (!scope) return 'true'; p.push(scope); return `${col} = ANY($${p.length}::text[])`; };

async function listMissing(scope) {
  const p = [NO_EMAIL_REASON];
  const { rows } = await db.query(`SELECT s.*,
      (SELECT f.requester_email FROM surveys f WHERE f.contact_id = s.contact_id AND f.email_fixed_at IS NOT NULL ORDER BY f.email_fixed_at DESC LIMIT 1) AS suggested_email
    FROM surveys s WHERE s.status = 'skipped' AND s.skip_reason = $1 AND s.email_dismissed_at IS NULL AND NOT s.is_test AND ${scoped(scope, p)}
    ORDER BY s.closed_at DESC NULLS LAST LIMIT 500`, p);
  return rows;
}

async function countMissing(scope) {
  const p = [NO_EMAIL_REASON];
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM surveys s WHERE s.status = 'skipped' AND s.skip_reason = $1
    AND s.email_dismissed_at IS NULL AND NOT s.is_test AND ${scoped(scope, p)}`, p);
  return rows[0].n;
}

async function findMissing(id) {
  const { rows } = await db.query(`SELECT * FROM surveys WHERE id = $1 AND status = 'skipped' AND skip_reason = $2 AND email_dismissed_at IS NULL AND NOT is_test`, [id, NO_EMAIL_REASON]);
  return rows[0] || null;
}

// Throws with a user-facing message; returns { sent: boolean, error? } – a mail failure leaves it queued for retry.
async function fixAndSend(survey, email, actor) {
  email = String(email || '').trim().toLowerCase();
  if (!isValidEmail(email)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  const upd = await db.query(`UPDATE surveys SET original_email = requester_email, requester_email = $2, email_fixed_by = $3, email_fixed_at = now(),
      status = 'pending', skip_reason = NULL, send_after = now() WHERE id = $1 AND status = 'skipped' RETURNING *`, [survey.id, email, actor]);
  if (!upd.rowCount) throw Object.assign(new Error('This ticket was already handled by someone else.'), { status: 409 });
  const rules = effectiveSettings(await getSettings(), await getGroupSettings(survey.owner_group_id));
  try { await sendOne(upd.rows[0], rules); return { sent: true }; }
  catch (e) {
    await db.query('UPDATE surveys SET attempts = attempts + 1, send_error = $2 WHERE id = $1', [survey.id, e.message.slice(0, 500)]);
    return { sent: false, error: e.message };
  }
}

async function dismiss(survey, actor) {
  await db.query('UPDATE surveys SET email_dismissed_by = $2, email_dismissed_at = now() WHERE id = $1', [survey.id, actor]);
}

// One row per HDA contact that had tickets without a usable email (still missing, dismissed or fixed by hand).
async function contactsToFix(scope) {
  const p = [NO_EMAIL_REASON];
  const { rows } = await db.query(`SELECT coalesce(s.contact_id, '') AS contact_id,
      max(s.requester_name) AS name,
      max(CASE WHEN s.email_fixed_at IS NOT NULL THEN s.original_email ELSE s.requester_email END) AS email_in_hda,
      (array_agg(s.requester_email ORDER BY s.email_fixed_at DESC) FILTER (WHERE s.email_fixed_at IS NOT NULL))[1] AS suggested_email,
      count(*)::int AS tickets,
      count(*) FILTER (WHERE s.status = 'skipped' AND s.email_dismissed_at IS NULL)::int AS waiting,
      string_agg(DISTINCT s.owner_group_name, ', ') AS groups,
      max(s.closed_at) AS last_closed,
      (array_agg(s.ticket_number ORDER BY s.closed_at DESC NULLS LAST))[1:5] AS examples
    FROM surveys s
    WHERE NOT s.is_test AND (s.skip_reason = $1 OR s.email_fixed_at IS NOT NULL) AND ${scoped(scope, p)}
    GROUP BY coalesce(s.contact_id, ''), CASE WHEN s.contact_id IS NULL THEN lower(s.requester_name) END
    ORDER BY count(*) DESC, max(s.closed_at) DESC LIMIT 2000`, p);
  return rows;
}

// CSV that opens straight in Excel (BOM + "sep=," so every locale splits the columns).
function contactsCsv(rows) {
  const cell = v => { const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' ') : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['HDA contact ID', 'Contact name', 'Email in HDA', 'Correct email (typed in CSAT Pulse)', 'Tickets affected', 'Still waiting', 'Owner groups', 'Last ticket closed', 'Example tickets'];
  const lines = rows.map(r => [r.contact_id, r.name, r.email_in_hda || '(empty)', r.suggested_email, r.tickets, r.waiting, r.groups, r.last_closed, r.examples].map(cell).join(','));
  return '﻿sep=,\r\n' + [head.map(cell).join(','), ...lines].join('\r\n') + '\r\n';
}

module.exports = { listMissing, countMissing, findMissing, fixAndSend, dismiss, contactsToFix, contactsCsv };
