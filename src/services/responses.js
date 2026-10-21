'use strict';
// Records survey answers, triggers low-score alerts and optional HDA write-back.
const db = require('../db');
const config = require('../config');
const { hashToken } = require('./sender');
const { getSettings, getGroupSettings, effectiveSettings } = require('./settings');
const { sendMail } = require('../mail/transport');
const { alertEmail } = require('../mail/templates');
const { writeBackScore } = require('../hda/tickets');

async function findByToken(token) {
  if (!token || token.length < 20 || token.length > 100) return null;
  const { rows } = await db.query('SELECT * FROM surveys WHERE token_hash = $1', [hashToken(token)]);
  return rows[0] || null;
}

const score = v => { const n = parseInt(v, 10); return n >= 1 && n <= 5 ? n : null; };

function parseAnswer(body) {
  const comment = String(body.comment || '').trim().slice(0, 1000);
  return { overall: score(body.overall), comment: comment || null };
}

/** @returns {{ ok: boolean, error?: string, survey?: object }} */
async function submit(token, body, channel = 'web') {
  const s = await findByToken(token);
  if (!s) return { ok: false, error: 'not_found' };
  if (s.status === 'answered') return { ok: false, error: 'already_answered', survey: s };
  if (s.status === 'expired' || (s.expires_at && new Date(s.expires_at) < new Date())) return { ok: false, error: 'expired', survey: s };
  const a = parseAnswer(body);
  if (!a.overall) return { ok: false, error: 'missing_overall', survey: s };

  const settings = effectiveSettings(await getSettings(), await getGroupSettings(s.owner_group_id));
  const low = settings.alertThreshold > 0 && a.overall <= settings.alertThreshold;
  const inserted = await db.tx(async c => {
    const upd = await c.query(`UPDATE surveys SET status = 'answered' WHERE id = $1 AND status = 'sent' RETURNING id`, [s.id]);
    if (!upd.rowCount) return false; // raced with another submit
    await c.query(`INSERT INTO responses(survey_id, overall, comment, channel, followup_status)
                   VALUES ($1,$2,$3,$4,$5)`,
      [s.id, a.overall, a.comment, channel, a.overall <= 2 ? 'open' : null]);
    return true;
  });
  if (!inserted) return { ok: false, error: 'already_answered', survey: s };

  if (s.is_test) return { ok: true, survey: s, answer: a }; // no group-lead alert or HDA write-back for tests

  if (low) {
    const g = (await db.query('SELECT lead_email FROM owner_groups WHERE hda_group_id = $1', [s.owner_group_id])).rows[0];
    const to = (g && g.lead_email) || config.mail.alertFallback;
    if (to) sendMail({ to, ...alertEmail(s, a) }).catch(e => console.error('[alert] failed:', e.message));
  }
  writeBackScore(s, a).catch(e => console.error('[writeback] failed:', e.message));
  return { ok: true, survey: s, answer: a };
}

module.exports = { findByToken, submit, parseAnswer };
