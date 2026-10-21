'use strict';
// One pass of the job: sync groups, check HDA for closed tickets, send due surveys/reminders.
// Usage: npm run poll:once            (add --no-send to only queue, not email)
const db = require('../src/db');
const { syncGroups, pollClosedTickets } = require('../src/services/poller');
const { processQueue } = require('../src/services/sender');

(async () => {
  await db.migrate();
  console.log('Owner groups synced:', await syncGroups());
  console.log('Closed tickets:', await pollClosedTickets());
  if (!process.argv.includes('--no-send')) console.log('Emails:', await processQueue());
  await db.pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
