'use strict';
// Fills the dashboard with 12 weeks of clearly-marked demo data (ticket IDs start with DEMO-).
//   npm run seed:demo           add demo data
//   npm run seed:demo -- --clear  remove it again
// Demo groups and sources are added switched OFF: groups are only ever switched on by an admin on the website.
const db = require('../src/db');
const config = require('../src/config');

const GROUPS = [['G101', 'GSD – Global Service Desk L1', 4.25, 1.6], ['G102', 'EUS – End User Support India', 4.45, 1.1], ['G103', 'EUS – End User Support Europe', 4.2, 0.9],
  ['G104', 'M365 Collaboration', 4.0, 0.7], ['G105', 'IAM – Access Management', 3.75, 0.8], ['G106', 'Network Operations', 4.1, 0.4], ['G108', 'Retail POS Support', 3.6, 0.7]];
const SOURCES = [['Self-service portal', 0.42, 0.05], ['Email', 0.28, 0], ['Phone', 0.14, 0.1], ['Teams chat', 0.12, 0.08], ['Walk-in', 0.04, 0.15]];
const AGENTS = ['Priya N.', 'Rahul S.', 'Marta G.', 'Luca B.', 'Anil K.', 'Sophie D.', 'Kiran P.', 'Elena R.', 'Vikram J.', 'Chloé M.'];
const CATS = ['Email & calendar', 'Hardware', 'Access & passwords', 'Network & VPN', 'Business applications', 'Printing'];
const GOOD = ['Quick and friendly, thank you!', 'Resolved in one call.', 'Very clear explanation of the fix.', 'Agent followed up proactively.'];
const MID = ['Fixed, but took a few days.', 'Had to explain the issue twice.'];
const BAD = ['Ticket was closed without fixing the issue.', 'Waited 5 days with no update.', 'Had to reopen twice, still not working.'];
let seed = 20261009;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
const clamp = n => Math.max(1, Math.min(5, Math.round(n)));

(async () => {
  // Demo data mixes fake groups and surveys into the real dashboard, so only allow it against the mock HDA.
  if (!/localhost:4010|mock-hda/.test(config.hda.baseUrl) && !process.argv.includes('--force')) {
    console.error(`Refusing to add demo data: HDA_BASE_URL is ${config.hda.baseUrl}, not the mock HDA. Use a separate database for demos (or --force).`);
    process.exit(1);
  }
  await db.migrate();
  if (process.argv.includes('--clear')) {
    const r = await db.query(`DELETE FROM surveys WHERE ticket_id LIKE 'DEMO-%'`);
    console.log(`Removed ${r.rowCount} demo surveys.`); return db.pool.end();
  }
  for (const [id, name] of GROUPS) await db.query(`INSERT INTO owner_groups(hda_group_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, name]);
  for (const [s] of SOURCES) await db.query(`INSERT INTO ticket_sources(source) VALUES ($1) ON CONFLICT DO NOTHING`, [s]);
  const now = Date.now();
  let n = 0, num = 300000;
  for (let d = 84; d >= 1; d--) {
    const day = now - d * 864e5, wd = new Date(day).getDay();
    if (wd === 0) continue;
    for (const [gid, gname, base, vol] of GROUPS) {
      const count = Math.round((wd === 6 ? 2 : 6) * vol * (0.7 + rnd() * 0.6));
      for (let i = 0; i < count; i++) {
        let r = rnd(), src = SOURCES[0];
        for (let a = 0, k = 0; k < SOURCES.length; k++) { a += SOURCES[k][1]; if (r < a) { src = SOURCES[k]; break; } }
        const prio = pick(['P1', 'P2', 'P2', 'P3', 'P3', 'P3', 'P3', 'P4', 'P4']);
        const isReq = rnd() < 0.4;
        const sentAt = new Date(day + rnd() * 864e5 * 0.9);
        const answered = rnd() < 0.37;
        const status = answered ? 'answered' : sentAt.getTime() < now - 14 * 864e5 ? 'expired' : 'sent';
        const ins = await db.query(`INSERT INTO surveys(ticket_id, ticket_number, entity, ticket_type, subject, source, requester_email, requester_name, owner_group_id, owner_group_name,
              ticket_owner, priority, category, closed_at, send_after, sent_at, expires_at, status)
            VALUES ($1,$2,$13,$14,'Demo ticket',$3,$4,'Demo User',$5,$6,$7,$8,$9,$10,$10,$10,$11,$12) RETURNING id`,
          [`DEMO-${num}`, `${isReq ? 'REQ0' : 'INC0'}${num++}`, src[0], `demo.user${n}@example.com`, gid, gname, pick(AGENTS.slice(0, 4 + (gid.charCodeAt(3) % 6))), prio, pick(CATS),
           sentAt, new Date(sentAt.getTime() + 14 * 864e5), status, isReq ? 'ServiceRequest' : 'Incident', isReq ? 'Request' : 'Incident']);
        if (answered) {
          const trend = (84 - d) / 84 * 0.18;
          const mu = base + trend + src[2] - (prio === 'P1' ? 0.35 : prio === 'P2' ? 0.15 : 0);
          const o = clamp(mu + (rnd() + rnd() + rnd() - 1.5) * 1.5);
          const c = rnd() < 0.35 ? (o >= 4 ? pick(GOOD) : o === 3 ? pick(MID) : pick(BAD)) : null;
          await db.query(`INSERT INTO responses(survey_id, overall, comment, submitted_at, followup_status)
                          VALUES ($1,$2,$3,$4,$5)`,
            [ins.rows[0].id, o, c,
             new Date(sentAt.getTime() + (0.3 + Math.pow(rnd(), 2) * 70) * 3600e3), o <= 2 ? pick(['open', 'open', 'contacted', 'resolved']) : null]);
        }
        n++;
      }
    }
  }
  console.log(`Added ${n} demo surveys. Remove them with: npm run seed:demo -- --clear`);
  await db.pool.end();
})().catch(e => { console.error(e); process.exit(1); });
