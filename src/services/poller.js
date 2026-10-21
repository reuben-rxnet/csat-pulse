'use strict';
// Pulls newly closed tickets from HDA, applies the send rules and queues surveys.
const db = require('../db');
const config = require('../config');
const { fetchClosedSince, fetchGroups, fetchSources, NO_SOURCE } = require('../hda/tickets');
const { evaluate } = require('./rules');
const { getSettings, getAllGroupSettings, effectiveSettings } = require('./settings');

async function getState(key) {
  const { rows } = await db.query('SELECT value FROM poll_state WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : null;
}
async function setState(key, value) {
  await db.query(`INSERT INTO poll_state(key, value, updated_at) VALUES ($1, $2, now())
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, value]);
}

async function syncGroups() {
  const groups = await fetchGroups();
  const ids = groups.map(g => g.id);
  for (const g of groups) {
    await db.query(`INSERT INTO owner_groups(hda_group_id, name, lead_email, active_in_hda, synced_at)
                    VALUES ($1, $2, $3, true, now())
                    ON CONFLICT (hda_group_id) DO UPDATE SET name = EXCLUDED.name,
                      lead_email = COALESCE(owner_groups.lead_email, EXCLUDED.lead_email), active_in_hda = true, synced_at = now()`,
      [g.id, g.name, g.leadEmail]);
  }
  if (ids.length) await db.query('UPDATE owner_groups SET active_in_hda = false WHERE NOT (hda_group_id = ANY($1::text[]))', [ids]);
  // A problem reading sources must not stop the owner-group sync.
  try { await syncSources(); } catch (e) { console.error('[sync] ticket sources could not be read from HDA:', e.message); }
  await setState('groups_synced_at', new Date().toISOString());
  return groups.length;
}

// Every ticket source defined in HDA. New ones arrive switched off; csat_enabled is never changed here.
// Sources that tickets carry but HDA no longer lists (and "(No source)") are kept.
async function syncSources() {
  const sources = await fetchSources();
  for (const s of sources) {
    await db.query(`INSERT INTO ticket_sources(source, hda_source_id, active_in_hda, synced_at) VALUES ($1, $2, $3, now())
                    ON CONFLICT (source) DO UPDATE SET hda_source_id = EXCLUDED.hda_source_id, active_in_hda = EXCLUDED.active_in_hda, synced_at = now()`,
      [s.name, s.id, s.active]);
  }
  if (sources.length) await db.query(`UPDATE ticket_sources SET active_in_hda = false WHERE source <> $2 AND NOT (source = ANY($1::text[]))`, [sources.map(s => s.name), NO_SOURCE]);
  return sources.length;
}

async function pollClosedTickets(now = new Date()) {
  const settings = await getSettings();
  const last = await getState('tickets_last_closed_at');
  const since = last
    ? new Date(new Date(last).getTime() - config.scheduler.pollOverlapMinutes * 60e3)
    : new Date(now.getTime() - config.scheduler.initialLookbackHours * 3600e3);

  const tickets = await fetchClosedSince(since);
  const enabledGroups = new Set((await db.query('SELECT hda_group_id FROM owner_groups WHERE csat_enabled')).rows.map(r => r.hda_group_id));
  const globalSources = new Set((await db.query('SELECT source FROM ticket_sources WHERE csat_enabled')).rows.map(r => r.source));
  const groupSettings = await getAllGroupSettings();
  let maxClosed = last ? new Date(last) : since;
  const counts = { seen: tickets.length, queued: 0, skipped: 0, duplicate: 0 };

  for (const t of tickets) {
    if (!t.id) continue;
    if (t.closedAt && t.closedAt > maxClosed) maxClosed = t.closedAt;

    // Learn new sources and groups so admins can switch them on.
    if (t.source) await db.query('INSERT INTO ticket_sources(source) VALUES ($1) ON CONFLICT DO NOTHING', [t.source]);
    if (t.ownerGroupId) await db.query(`INSERT INTO owner_groups(hda_group_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [t.ownerGroupId, t.ownerGroupName || t.ownerGroupId]);

    const exists = await db.query('SELECT 1 FROM surveys WHERE entity = $1 AND ticket_id = $2 AND NOT is_test', [t.entity, t.id]);
    if (exists.rowCount) { counts.duplicate++; continue; }

    // A group can have its own sources and send rules; otherwise the global ones apply.
    const gs = groupSettings.get(t.ownerGroupId);
    const rules = effectiveSettings(settings, gs);
    const enabledSources = gs && gs.sources ? new Set(gs.sources) : globalSources;
    const lastSurvey = t.requesterEmail ? (await db.query(
      `SELECT max(created_at) AS at FROM surveys WHERE lower(requester_email) = $1 AND status IN ('pending','sent','answered','expired') AND NOT is_test`,
      [t.requesterEmail])).rows[0].at : null;

    const decision = evaluate(t, { settings: rules, enabledGroups, enabledSources, lastSurveyAt: lastSurvey ? new Date(lastSurvey) : null, now });
    const base = (t.closedAt && t.closedAt > now ? t.closedAt : (t.closedAt || now));
    const sendAfter = new Date(Math.max(base.getTime() + rules.sendDelayMinutes * 60e3, now.getTime()));
    await db.query(`INSERT INTO surveys(ticket_id, ticket_number, entity, ticket_type, ticket_owner_email, subject, description, solution, source, requester_email, requester_name,
                      owner_group_id, owner_group_name, ticket_owner, priority, category, closed_at, send_after, status, skip_reason, contact_id, requester_first_name)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
                    ON CONFLICT (entity, ticket_id) WHERE NOT is_test DO NOTHING`,
      [t.id, t.number, t.entity, t.ticketType, t.ticketOwnerEmail, t.subject, t.description, t.solution, t.source, t.requesterEmail, t.requesterName,
       t.ownerGroupId, t.ownerGroupName, t.ticketOwner, t.priority, t.category, t.closedAt, decision.send ? sendAfter : null,
       decision.send ? 'pending' : 'skipped', decision.reason || null, t.requesterId, t.requesterFirstName]);
    decision.send ? counts.queued++ : counts.skipped++;
  }
  await setState('tickets_last_closed_at', maxClosed.toISOString());
  await setState('tickets_polled_at', now.toISOString());
  return counts;
}

module.exports = { pollClosedTickets, syncGroups, syncSources, getState, setState };
