'use strict';
// Dashboard metrics. A survey counts as "sent" once delivered (sent/answered/expired); CSAT % = scores 4–5 / responses.
const db = require('../db');

function where(f, from, to, params) {
  const w = [`s.status IN ('sent','answered','expired')`, 'NOT s.is_test'];
  params.push(from); w.push(`s.sent_at >= $${params.length}`);
  params.push(to); w.push(`s.sent_at < $${params.length}`);
  if (f.groups) { params.push(f.groups); w.push(`s.owner_group_id = ANY($${params.length}::text[])`); } // team admin scope
  if (f.group) { params.push(f.group); w.push(`s.owner_group_id = $${params.length}`); }
  if (f.source) { params.push(f.source); w.push(`s.source = $${params.length}`); }
  if (f.type) { params.push(f.type); w.push(`s.ticket_type = $${params.length}`); }
  if (f.priority) { params.push(f.priority); w.push(`s.priority = $${params.length}`); }
  return 'WHERE ' + w.join(' AND ');
}

const AGG = `count(*)::int AS sent, count(r.survey_id)::int AS n,
  count(*) FILTER (WHERE r.overall >= 4)::int AS sat, count(*) FILTER (WHERE r.overall <= 2)::int AS det,
  round(avg(r.overall)::numeric, 2)::float8 AS avg`;
const FROM = `FROM surveys s LEFT JOIN responses r ON r.survey_id = s.id`;

function shape(r) {
  return { ...r, csat: r.n ? r.sat / r.n : null, rate: r.sent ? r.n / r.sent : null };
}

async function grouped(col, f, from, to, minN = 0, limit = 50) {
  const p = [];
  const { rows } = await db.query(`SELECT ${col} AS key, ${AGG} ${FROM} ${where(f, from, to, p)} GROUP BY 1 HAVING count(r.survey_id) >= ${minN} ORDER BY 1 LIMIT ${limit}`, p);
  return rows.map(shape);
}

async function getMetrics(f = {}) {
  // Either the last N weeks (dashboard) or exact dates (reports: f.from inclusive, f.to exclusive, optional f.prevFrom).
  const weeks = Math.min(Math.max(parseInt(f.weeks, 10) || 12, 1), 104);
  const to = f.to ? new Date(f.to) : new Date();
  const from = f.from ? new Date(f.from) : new Date(to.getTime() - weeks * 7 * 864e5);
  const prevFrom = f.prevFrom ? new Date(f.prevFrom) : new Date(from.getTime() - (to - from));

  const kpi = async (a, b) => {
    const p = [];
    const { rows } = await db.query(`SELECT ${AGG},
        count(*) FILTER (WHERE r.followup_status = 'open')::int AS open_followups,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r.submitted_at - s.sent_at) / 3600))::float8 AS median_hours
      ${FROM} ${where(f, a, b, p)}`, p);
    return shape(rows[0]);
  };

  const p1 = [];
  const trend = (await db.query(`SELECT date_trunc('week', s.sent_at) AS week, ${AGG} ${FROM} ${where(f, from, to, p1)} GROUP BY 1 ORDER BY 1`, p1)).rows.map(shape);
  const p2 = [];
  const dist = (await db.query(`SELECT r.overall AS score, count(*)::int AS c ${FROM} ${where(f, from, to, p2)} AND r.overall IS NOT NULL GROUP BY 1 ORDER BY 1`, p2)).rows;
  const p4 = [];
  const followups = (await db.query(`SELECT s.id, s.ticket_number, s.subject, s.owner_group_name, s.ticket_owner, s.requester_name, s.requester_email,
      r.overall, r.comment, r.submitted_at, r.followup_status, r.followup_owner, r.followup_note
      ${FROM} ${where(f, from, to, p4)} AND r.overall <= 2
      ORDER BY CASE r.followup_status WHEN 'open' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END, r.submitted_at DESC LIMIT 50`, p4)).rows;
  const p5 = [];
  const comments = (await db.query(`SELECT s.ticket_number, s.owner_group_name, s.ticket_owner, r.overall, r.comment, r.submitted_at
      ${FROM} ${where(f, from, to, p5)} AND r.comment IS NOT NULL ORDER BY r.submitted_at DESC LIMIT 10`, p5)).rows;
  const skipped = (await db.query(`SELECT split_part(skip_reason, ' (', 1) AS reason, count(*)::int AS c FROM surveys
      WHERE status = 'skipped' AND NOT is_test AND created_at >= $1 AND created_at < $3 AND ($2::text[] IS NULL OR owner_group_id = ANY($2::text[])) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [from, f.groups || null, to])).rows;

  const byGroupRaw = await grouped(`s.owner_group_id || '|' || coalesce(s.owner_group_name, s.owner_group_id)`, f, from, to);
  const byGroup = byGroupRaw.map(g => { const [id, ...n] = g.key.split('|'); return { ...g, id, key: n.join('|') }; })
    .sort((a, b) => (b.csat ?? -1) - (a.csat ?? -1));

  return {
    period: { weeks, from, to },
    kpis: await kpi(from, to), prev: await kpi(prevFrom, from),
    trend, dist, followups, comments, skipped, byGroup,
    bySource: (await grouped('s.source', f, from, to)).sort((a, b) => b.sent - a.sent),
    byPriority: await grouped('s.priority', f, from, to),
    byType: await grouped('s.ticket_type', f, from, to),
    byCategory: (await grouped('s.category', f, from, to)).sort((a, b) => (b.csat ?? -1) - (a.csat ?? -1)),
    byAgent: (await grouped(`coalesce(s.ticket_owner, 'Unassigned') || '|' || coalesce(s.owner_group_name, '')`, f, from, to, 5, 200))
      .map(a => { const [name, group] = a.key.split('|'); return { ...a, name, group }; })
      .sort((a, b) => b.csat - a.csat || b.n - a.n).slice(0, f.agentLimit || 15),
  };
}

// scope: null = all groups, or the group IDs a team admin may see.
async function filterOptions(scope = null) {
  const q = (col, extra = '') => db.query(`SELECT DISTINCT ${col} FROM surveys WHERE ${extra} status <> 'skipped' AND NOT is_test
                                            AND ($1::text[] IS NULL OR owner_group_id = ANY($1::text[])) ORDER BY ${col.includes(',') ? 2 : 1}`, [scope]);
  const groups = (await q('owner_group_id AS id, owner_group_name AS name', 'owner_group_id IS NOT NULL AND')).rows;
  const sources = (await q('source', 'source IS NOT NULL AND')).rows.map(r => r.source);
  const priorities = (await q('priority', 'priority IS NOT NULL AND')).rows.map(r => r.priority);
  const types = (await q('ticket_type', 'ticket_type IS NOT NULL AND')).rows.map(r => r.ticket_type);
  return { groups, sources, priorities, types };
}

module.exports = { getMetrics, filterOptions };
