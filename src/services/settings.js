'use strict';
const db = require('../db');

const DEFAULTS = {
  sendDelayMinutes: 60,            // wait after closure before sending
  throttleDays: 7,                 // max one survey per requester per N days (0 = no limit)
  reminderDays: 3,                 // 0 = no reminder
  expiryDays: 14,
  alertThreshold: 2,               // alert group lead when overall <= this (0 = never)
  excludeCloseCodes: ['Duplicate', 'Cancelled'],   // matched case-insensitively against closeCode
  excludeRequesterPatterns: ['svc_*', 'noreply*', 'no-reply*', 'monitoring*'], // glob on email local part
  excludeOwnerPatterns: [],        // glob on the ticket owner's name, e.g. bots like "Eye-T ServiceDesk AI"
  surveyEnabled: true,             // master switch
  ticketTypes: ['Incident', 'Request'],   // which ticket types get surveys (labels from config/hda-mapping.json)
  csatTarget: 85,                  // % shown on dashboard
};

async function getSettings() {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const out = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) out[r.key] = r.value;
  return out;
}

async function saveSettings(partial, actor) {
  for (const [k, v] of Object.entries(partial)) {
    if (!(k in DEFAULTS)) continue;
    await db.query(
      `INSERT INTO settings(key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, JSON.stringify(v)]);
  }
  await db.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1, $2, $3::jsonb)', [actor || 'system', 'settings.update', JSON.stringify(partial)]);
}

// Rules a team admin can set per owner group; anything else (master switch, exclusions, CSAT target) stays global.
const GROUP_RULE_KEYS = ['ticketTypes', 'sendDelayMinutes', 'throttleDays', 'reminderDays', 'expiryDays', 'alertThreshold'];

// Global settings with one group's overrides applied. gs = { rules, sources } or undefined.
function effectiveSettings(global, gs) {
  const out = { ...global };
  if (gs && gs.rules) for (const k of GROUP_RULE_KEYS) if (gs.rules[k] !== undefined && gs.rules[k] !== null) out[k] = gs.rules[k];
  return out;
}

const rowToGroupSettings = r => ({ rules: r.rules || {}, sources: r.sources || null, updatedBy: r.updated_by, updatedAt: r.updated_at });

async function getAllGroupSettings() {
  const { rows } = await db.query('SELECT * FROM group_settings');
  return new Map(rows.map(r => [r.hda_group_id, rowToGroupSettings(r)]));
}

async function getGroupSettings(groupId) {
  const { rows } = await db.query('SELECT * FROM group_settings WHERE hda_group_id = $1', [groupId]);
  return rows[0] ? rowToGroupSettings(rows[0]) : undefined;
}

async function saveGroupSettings(groupId, { rules, sources }, actor) {
  const clean = Object.fromEntries(Object.entries(rules || {}).filter(([k, v]) => GROUP_RULE_KEYS.includes(k) && v !== undefined && v !== null));
  await db.query(`INSERT INTO group_settings(hda_group_id, rules, sources, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, $4, now())
                  ON CONFLICT (hda_group_id) DO UPDATE SET rules = EXCLUDED.rules, sources = EXCLUDED.sources, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [groupId, JSON.stringify(clean), sources || null, actor]);
  await db.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1, $2, $3::jsonb)', [actor || 'system', 'group.settings', JSON.stringify({ id: groupId, rules: clean, sources })]);
}

module.exports = { DEFAULTS, GROUP_RULE_KEYS, getSettings, saveSettings, effectiveSettings, getAllGroupSettings, getGroupSettings, saveGroupSettings };
