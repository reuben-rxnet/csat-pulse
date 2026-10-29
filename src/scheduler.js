'use strict';
// In-process scheduler. Run a single instance of the app (or set SCHEDULER_ENABLED=false on extra instances).
const config = require('./config');
const { pollClosedTickets, syncGroups, getState } = require('./services/poller');
const { processQueue } = require('./services/sender');
const { runDueReports, sendResultsOnClose } = require('./services/reports');
const { runFormJobs } = require('./services/forms');

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const last = await getState('groups_synced_at');
    if (!last || Date.now() - new Date(last).getTime() > config.scheduler.groupSyncHours * 3600e3) {
      const n = await syncGroups();
      console.log(`[scheduler] synced ${n} owner groups from HDA`);
    }
    const p = await pollClosedTickets();
    const q = await processQueue();
    if (p.seen || q.sent || q.failed || q.reminded || q.expired) console.log(`[scheduler] tickets seen=${p.seen} queued=${p.queued} skipped=${p.skipped} | sent=${q.sent} failed=${q.failed} reminders=${q.reminded} expired=${q.expired}`);
  } catch (e) {
    console.error('[scheduler] run failed:', e.message);
  }
  // Scheduled PDF reports don't depend on HDA, so they run even when the HDA check fails.
  try {
    const r = await runDueReports();
    if (r.sent || r.failed) console.log(`[scheduler] reports sent=${r.sent} failed=${r.failed}`);
    const f = await runFormJobs();
    for (const id of f.closedIds) await sendResultsOnClose(id); // only when that survey's "email the results" option is on
    if (f.closed || f.reminded) console.log(`[scheduler] stakeholder surveys closed=${f.closed} reminders=${f.reminded}`);
  } catch (e) {
    console.error('[scheduler] reports failed:', e.message);
  } finally { running = false; }
}

function start() {
  if (!config.scheduler.enabled) { console.log('[scheduler] disabled'); return; }
  console.log(`[scheduler] checking HDA every ${config.scheduler.pollMinutes} min`);
  setTimeout(tick, 5000);
  setInterval(tick, config.scheduler.pollMinutes * 60e3);
}

module.exports = { start, tick };
