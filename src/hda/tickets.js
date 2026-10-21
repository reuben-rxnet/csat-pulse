'use strict';
// Reads closed tickets and owner groups from HDA using the mapping file, and normalises them.
const config = require('../config');
const { hda } = require('./client');
const { firstName } = require('../names');

const decodeEntities = s => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

function stripHtml(html) {
  if (!html) return '';
  let s = String(html);
  // HDA sometimes returns HTML encoded twice ("&lt;p&gt;qualit&amp;#224;…"): decode once so the tags can be removed.
  if (/&lt;\s*\/?\s*[a-z]/i.test(s)) s = decodeEntities(s);
  s = s.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '');
  return decodeEntities(s).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n\s*\n+/g, '\n').trim();
}

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const ms = /\/Date\((\d+)/.exec(String(v)); // legacy .NET JSON dates
  const d = ms ? new Date(Number(ms[1])) : new Date(v);
  return isNaN(d) ? null : d;
}

function columnsOf(map) {
  const keys = Object.keys(map).filter(k => map[k]);
  return { keys, exprs: keys.map(k => map[k]) };
}

// Tickets with an empty Source field in HDA are filed under this name, so admins can switch them on like any source.
const NO_SOURCE = '(No source)';

function normaliseTicket(row, entity, ticketType) {
  const s = v => (v === undefined || v === null ? null : String(v));
  const requesterEmail = s(row.requesterEmail)?.trim().toLowerCase() || null;
  return {
    requesterId: s(row.requesterId),
    requesterFirstName: firstName({ firstName: row.requesterFirstName, fullName: row.requesterName, email: requesterEmail }) || null,
    id: s(row.id), number: s(row.number) || s(row.id), entity, ticketType: ticketType || entity,
    subject: s(row.subject), description: stripHtml(row.description), solution: stripHtml(row.solution),
    source: s(row.source)?.trim() || NO_SOURCE, requesterEmail, requesterName: s(row.requesterName),
    ownerGroupId: s(row.ownerGroupId), ownerGroupName: s(row.ownerGroupName),
    ticketOwner: s(row.ticketOwner), ticketOwnerEmail: s(row.ticketOwnerEmail)?.trim().toLowerCase() || null,
    priority: s(row.priority), category: s(row.category), closeCode: s(row.closeCode), closedAt: toDate(row.closedAt),
  };
}

function ticketTypes() {
  const m = config.hda.mapping.tickets;
  // Back-compat: "entities": ["Incident"] still works.
  return m.types || (m.entities || []).map(e => ({ entity: e, label: e }));
}

async function fetchClosedSince(since, client = hda(), { types } = {}) {
  const m = config.hda.mapping.tickets;
  const out = [];
  for (const t of ticketTypes()) {
    if (types && !types.includes(t.label)) continue;
    const { keys, exprs } = columnsOf({ ...m.columns, ...(t.columns || {}) });
    for (const statusId of t.closedStatusIds || m.closedStatusIds || []) {
      const filter = [
        { property: t.statusProperty || m.statusProperty, op: m.statusFilterOperator || 'eq', value: statusId },
        { property: t.closedDateProperty || m.closedDateProperty, op: m.dateFilterOperator || 'gt', value: since.toISOString() },
        ...(t.filter || []), // e.g. ObjectTypeID in [...] – HDA keeps Incidents and Requests in one entity
      ];
      for (let start = 0; ; start += m.pageSize) {
        const res = await client.projection({ entity: t.entity, filter, columns: exprs, names: keys, start, limit: m.pageSize,
          sort: [{ property: t.closedDateProperty || m.closedDateProperty, direction: 'ASC' }] });
        const data = Array.isArray(res.data) ? res.data : [];
        for (const row of data) out.push(normaliseTicket(row, t.entity, t.label));
        if (data.length < m.pageSize || (res.total && start + m.pageSize >= res.total)) break;
      }
    }
  }
  return out;
}

// One ticket by its ID (any status), tried against each ticket type; null when not found.
async function fetchTicket(id, client = hda()) {
  const m = config.hda.mapping.tickets;
  for (const t of ticketTypes()) {
    const cols = { ...m.columns, ...(t.columns || {}) };
    const { keys, exprs } = columnsOf(cols);
    const res = await client.projection({ entity: t.entity, columns: exprs, names: keys, start: 0, limit: 1,
      filter: [{ property: cols.id, op: m.statusFilterOperator || 'eq', value: id }, ...(t.filter || [])] });
    const row = Array.isArray(res.data) && res.data[0];
    if (row) return normaliseTicket(row, t.entity, t.label);
  }
  return null;
}

// Owner groups a person is assigned to in HDA (Groups/Operators page), by HDA username or, failing that, by email (UPN).
// Returns { user: { id, username, fullName, upn } | null, groups: [{ id, name }] }.
async function fetchUserMemberships(login, client = hda()) {
  const a = config.hda.mapping.access;
  const cols = { userId: a.userId, username: a.username, upn: a.upn, fullName: a.fullName, groupId: a.groupId, groupName: a.groupName };
  const { keys, exprs } = columnsOf(cols);
  const lookup = async property => {
    const rows = [];
    for (let start = 0; start < 1000; start += 200) {
      const res = await client.projection({ entity: a.entity, columns: exprs, names: keys, start, limit: 200, filter: [{ property, op: 'eq', value: login }] });
      const data = Array.isArray(res.data) ? res.data : [];
      rows.push(...data);
      if (data.length < 200) break;
    }
    return rows;
  };
  let rows = await lookup(a.username);
  if (!rows.length && login.includes('@') && a.upn) rows = await lookup(a.upn);
  const first = rows[0];
  return {
    user: first ? { id: String(first.userId), username: first.username || null, fullName: first.fullName || null, upn: first.upn || null } : null,
    groups: rows.filter(r => r.groupId).map(r => ({ id: String(r.groupId), name: String(r.groupName || r.groupId) })),
  };
}

async function fetchGroups(client = hda()) {
  const g = config.hda.mapping.groups;
  const { keys, exprs } = columnsOf(g.columns);
  const out = [];
  for (let start = 0; ; start += 500) {
    const res = await client.projection({ entity: g.entity, filter: g.filter && g.filter.length ? g.filter : undefined, columns: exprs, names: keys, start, limit: 500 });
    const data = Array.isArray(res.data) ? res.data : [];
    for (const r of data) if (r.id) out.push({ id: String(r.id), name: String(r.name || r.id), leadEmail: r.leadEmail || null });
    if (data.length < 500) break;
  }
  return out;
}

// All ticket sources defined in HDA → [{ id, name, active }]. Empty when the mapping has no "sources" entry.
async function fetchSources(client = hda()) {
  const m = config.hda.mapping.sources;
  if (!m || !m.entity) return [];
  const { keys, exprs } = columnsOf(m.columns);
  const res = await client.projection({ entity: m.entity, columns: exprs, names: keys, start: 0, limit: 1000 });
  return (Array.isArray(res.data) ? res.data : []).filter(r => r.name)
    .map(r => ({ id: String(r.id ?? r.name), name: String(r.name).trim(), active: r.active === undefined ? true : r.active === true || r.active === 'true' || r.active === 1 }));
}

async function writeBackScore(ticket, response, client = hda()) {
  const w = config.hda.mapping.writeBack;
  if (!w || !w.enabled) return false;
  const data = { [w.scoreProperty]: response.overall };
  if (w.commentProperty && response.comment) data[w.commentProperty] = response.comment;
  await client.set(ticket.entity, ticket.ticket_id, data);
  return true;
}

module.exports = { NO_SOURCE, ticketTypes, fetchClosedSince, fetchTicket, fetchUserMemberships, fetchGroups, fetchSources, writeBackScore, stripHtml, toDate, normaliseTicket };
