'use strict';
// Connects to HDA with the .env credentials and helps fill config/hda-mapping.json.
//   npm run hda:discover                 -> tests login, lists Incident + UserGroup properties, tries the current mapping
//   npm run hda:discover -- ServiceRequest  -> also inspects other entities
// Writes the raw metabase JSON to ./discover/ so you can search it or share it (it contains no ticket data).
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { HdaClient } = require('../src/hda/client');
const { ticketTypes } = require('../src/hda/tickets');

const KEYWORDS = /group|contact|requester|caller|mail|solution|description|subject|source|media|channel|origin|closure|closed|status|code|priority|category|assigned|owner|request/i;

function propertyNames(meta) {
  const names = new Set();
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) return o.forEach(x => walk(x, depth + 1));
    for (const k of ['Name', 'PropertyName', 'name', 'propertyName', 'FieldName']) if (typeof o[k] === 'string') names.add(o[k]);
    Object.values(o).forEach(v => walk(v, depth + 1));
  };
  walk(meta);
  return [...names].sort();
}

(async () => {
  const client = new HdaClient(config.hda);
  const m = config.hda.mapping;
  console.log(`HDA: ${config.hda.baseUrl} (auth mode: ${config.hda.authMode}, user: ${config.hda.username || '-'})`);
  await client.getToken();
  console.log('✔ Signed in to HDA\n');

  const outDir = path.join(config.root, 'discover');
  fs.mkdirSync(outDir, { recursive: true });
  const types = ticketTypes();
  const entities = [...new Set([...types.map(t => t.entity), m.groups.entity, ...process.argv.slice(2)])];
  for (const e of entities) {
    try {
      const meta = await client.metabase(e);
      delete meta.requestToken; // HDA echoes the session token; keep it out of files that may be shared
      fs.writeFileSync(path.join(outDir, `metabase-${e}.json`), JSON.stringify(meta, null, 2));
      const names = propertyNames(meta.data);
      console.log(`── ${e}: ${names.length} properties (full list in discover/metabase-${e}.json)`);
      console.log('   Likely relevant:', names.filter(n => KEYWORDS.test(n)).join(', ') || '(none matched)');
    } catch (err) { console.log(`✖ GetMetabase ${e}: ${err.message}`); }
  }

  console.log('\nTrying the current mapping…');
  const t = m.tickets;
  for (const tt of types) {
    const cols = { ...t.columns, ...(tt.columns || {}) };
    const keys = Object.keys(cols).filter(k => cols[k]);
    try {
      const res = await client.projection({ entity: tt.entity, columns: keys.map(k => cols[k]), names: keys, start: 0, limit: 3,
        filter: [{ property: t.statusProperty, op: t.statusFilterOperator || 'eq', value: (tt.closedStatusIds || t.closedStatusIds)[0] }, ...(tt.filter || [])], sort: [{ property: t.closedDateProperty, direction: 'DESC' }] });
      console.log(`✔ ${tt.label} (${tt.entity}) returned ${res.total ?? res.data.length} closed tickets. Latest:`);
      for (const r of res.data || []) {
        const empty = keys.filter(k => r[k] === null || r[k] === undefined || r[k] === '');
        console.log(`   ${r.number || r.id}  group=${r.ownerGroupName}  owner=${r.ticketOwner}  source=${r.source}  email=${r.requesterEmail ? '(present)' : '(missing)'}${empty.length ? '  EMPTY: ' + empty.join(',') : ''}`);
      }
    } catch (err) { console.log(`✖ ${tt.label} (${tt.entity}) projection failed: ${err.message}\n  Fix the entity or property names in config/hda-mapping.json using the lists above.`); }
  }
  try {
    const g = m.groups;
    const gk = Object.keys(g.columns).filter(k => g.columns[k]);
    const res = await client.projection({ entity: g.entity, columns: gk.map(k => g.columns[k]), names: gk, start: 0, limit: 5 });
    console.log(`✔ ${g.entity} returned ${res.total ?? res.data.length} groups, e.g. ${res.data.map(x => x.name).join(' | ')}`);
  } catch (err) { console.log(`✖ Group projection failed: ${err.message}`); }
})().catch(e => { console.error('✖', e.message); process.exit(1); });
