'use strict';
// Sends queued surveys, reminders, and expires old ones. Raw tokens are never stored, only their SHA-256 hash.
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { sendMail } = require('../mail/transport');
const { surveyEmail } = require('../mail/templates');
const { getSettings, getAllGroupSettings, effectiveSettings } = require('./settings');

const MAX_ATTEMPTS = 3;
const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');
const linkFor = token => `${config.publicBaseUrl}/s/${token}`;

async function sendOne(s, settings, { reminder = false } = {}) {
  const token = newToken();
  const expiresAt = reminder && s.expires_at ? new Date(s.expires_at) : new Date(Date.now() + settings.expiryDays * 864e5);
  const mail = surveyEmail({ ...s, expires_at: expiresAt }, linkFor(token), { reminder });
  await sendMail({ to: s.requester_email, ...mail });
  // Token is rotated on reminders, so only the latest link works.
  if (reminder) {
    await db.query('UPDATE surveys SET token_hash = $2, reminder_sent_at = now() WHERE id = $1', [s.id, hashToken(token)]);
  } else {
    await db.query(`UPDATE surveys SET token_hash = $2, status = 'sent', sent_at = now(), expires_at = $3, attempts = attempts + 1, send_error = NULL WHERE id = $1`,
      [s.id, hashToken(token), expiresAt]);
  }
}

async function processQueue({ limit = 50 } = {}) {
  const settings = await getSettings();
  const groupSettings = await getAllGroupSettings();
  const rulesFor = s => effectiveSettings(settings, groupSettings.get(s.owner_group_id)); // expiry and reminders can differ per group
  const out = { sent: 0, failed: 0, reminded: 0, expired: 0 };

  const due = await db.query(`SELECT * FROM surveys WHERE status = 'pending' AND send_after <= now() AND attempts < $1 ORDER BY send_after LIMIT $2`, [MAX_ATTEMPTS, limit]);
  for (const s of due.rows) {
    try { await sendOne(s, rulesFor(s)); out.sent++; }
    catch (e) {
      out.failed++;
      await db.query(`UPDATE surveys SET attempts = attempts + 1, send_error = $2,
                        status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE status END,
                        send_after = now() + interval '15 minutes' WHERE id = $1`, [s.id, e.message.slice(0, 500), MAX_ATTEMPTS]);
      console.error(`[sender] survey ${s.id} (${s.ticket_number}) failed: ${e.message}`);
    }
  }

  // Reminder days are per group, so pick candidates sent at least a day ago and check each one's own rule.
  const rem = await db.query(`SELECT * FROM surveys WHERE status = 'sent' AND reminder_sent_at IS NULL AND NOT is_test
                                AND sent_at <= now() - interval '1 day' AND expires_at > now() ORDER BY sent_at LIMIT 1000`);
  for (const s of rem.rows) {
    if (out.reminded >= limit) break;
    const r = rulesFor(s);
    if (!(r.reminderDays > 0) || Date.now() - new Date(s.sent_at).getTime() < r.reminderDays * 864e5) continue;
    try { await sendOne(s, r, { reminder: true }); out.reminded++; }
    catch (e) { console.error(`[sender] reminder ${s.id} failed: ${e.message}`); }
  }

  const exp = await db.query(`UPDATE surveys SET status = 'expired' WHERE status = 'sent' AND expires_at <= now()`);
  out.expired = exp.rowCount;
  return out;
}

module.exports = { processQueue, sendOne, hashToken, newToken, linkFor };
