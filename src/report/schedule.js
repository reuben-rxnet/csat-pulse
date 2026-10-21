'use strict';
// Pure helpers for PDF reports: report sections, periods, next send time and recipient checks. Times use the server's local time zone.

// Main figures are always included. "agents" (ticket owner names) only goes into custom reports.
const SECTIONS = [
  ['trend', 'CSAT % by week and score distribution'],
  ['groups', 'By owner group'],
  ['breakdowns', 'By source, ticket type, priority and category'],
  ['followups', 'Low-score follow-up'],
  ['comments', 'Latest comments (no requester names)'],
  ['skipped', 'Why tickets were not surveyed'],
  ['agents', 'Ticket owners (agent names)'],
];
const SECTION_KEYS = SECTIONS.map(s => s[0]);
const STANDARD_SECTIONS = SECTION_KEYS.filter(k => k !== 'agents');
const FREQUENCIES = { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every quarter' };
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// "standard" → the fixed standard set; "custom" → whatever was ticked (in SECTIONS order).
function pickSections(type, ticked) {
  if (type !== 'custom') return [...STANDARD_SECTIONS];
  const t = new Set([].concat(ticked || []));
  return SECTION_KEYS.filter(k => t.has(k));
}
const isCustom = sections => sections.includes('agents') || sections.length !== STANDARD_SECTIONS.length || !STANDARD_SECTIONS.every(k => sections.includes(k));

const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const startOfWeek = d => { const s = startOfDay(d); return addDays(s, -((s.getDay() + 6) % 7)); }; // Monday
const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfQuarter = d => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);

// The last complete week (Mon–Sun), month or quarter before `at`, plus the one before it for comparison.
// from is inclusive, to is exclusive.
function periodFor(frequency, at) {
  if (frequency === 'weekly') {
    const to = startOfWeek(at), from = addDays(to, -7);
    return { from, to, prevFrom: addDays(from, -7) };
  }
  const months = frequency === 'quarterly' ? 3 : 1;
  const to = frequency === 'quarterly' ? startOfQuarter(at) : startOfMonth(at);
  const from = new Date(to.getFullYear(), to.getMonth() - months, 1);
  return { from, to, prevFrom: new Date(from.getFullYear(), from.getMonth() - months, 1) };
}

// Dates typed on the form (YYYY-MM-DD, both days included) → { from, to (exclusive), prevFrom } or { error }.
function adhocPeriod(fromStr, toStr, now = new Date()) {
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim()); if (!m) return null; const d = new Date(+m[1], +m[2] - 1, +m[3]); return d.getDate() === +m[3] ? d : null; };
  const from = parse(fromStr), last = parse(toStr);
  if (!from || !last) return { error: 'Choose a start and an end date.' };
  if (last < from) return { error: 'The end date is before the start date.' };
  if (from > now) return { error: 'The start date is in the future.' };
  const to = addDays(last, 1);
  if (to - from > 731 * 864e5) return { error: 'A report can cover at most two years.' };
  return { from, to, prevFrom: new Date(from.getTime() - (to - from)) };
}

// Next send time strictly after `after`: weekly on run_day (1 = Monday), monthly / quarterly on day run_day, at send_hour:00.
function nextRunAt(s, after) {
  const hour = Math.min(23, Math.max(0, s.send_hour ?? 7));
  if (s.frequency === 'weekly') {
    const day = Math.min(7, Math.max(1, s.run_day || 1));
    let d = new Date(after.getFullYear(), after.getMonth(), after.getDate(), hour);
    for (let i = 0; i < 8; i++, d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, hour)) {
      if (((d.getDay() + 6) % 7) + 1 === day && d > after) return d;
    }
  }
  const day = Math.min(28, Math.max(1, s.run_day || 1));
  const step = s.frequency === 'quarterly' ? 3 : 1;
  let m = s.frequency === 'quarterly' ? Math.floor(after.getMonth() / 3) * 3 : after.getMonth();
  for (let i = 0; i < 6; i++, m += step) {
    const d = new Date(after.getFullYear(), m, day, hour);
    if (d > after) return d;
  }
  throw new Error('no next run');
}

// "a@x.com; b@y.com\nc@z.com" → { emails, invalid, blocked }. blocked = addresses outside the allowed domains.
function parseRecipients(text, { domains = [], max = 50 } = {}) {
  const emails = [], invalid = [], blocked = [];
  for (const raw of String(text || '').split(/[\s,;]+/).map(s => s.trim().replace(/^<|>$/g, '')).filter(Boolean)) {
    const e = raw.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { invalid.push(raw); continue; }
    const host = e.split('@')[1];
    if (domains.length && !domains.some(d => host === d || host.endsWith('.' + d))) { blocked.push(e); continue; }
    if (!emails.includes(e)) emails.push(e);
  }
  const error = invalid.length ? `Not a valid email address: ${invalid.join(', ')}`
    : blocked.length ? `Reports can only be sent to ${domains.map(d => '@' + d).join(', ')} addresses (not ${blocked.join(', ')}).`
    : !emails.length ? 'Enter at least one email address.'
    : emails.length > max ? `At most ${max} recipients per report.` : null;
  return { emails, invalid, blocked, error };
}

const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
// "1 Sep 2026 – 30 Sep 2026" for from (inclusive) and to (exclusive).
const periodLabel = (from, to) => { const last = addDays(startOfDay(new Date(to.getTime() - 1)), 0); return +startOfDay(from) === +last ? fmt(from) : `${fmt(from)} – ${fmt(last)}`; };

function describeSchedule(s) {
  const hour = String(s.send_hour ?? 7).padStart(2, '0') + ':00';
  const covers = { weekly: 'the previous week (Mon–Sun)', monthly: 'the previous month', quarterly: 'the previous quarter' }[s.frequency];
  const when = s.frequency === 'weekly' ? `every ${WEEKDAYS[(s.run_day || 1) - 1]}`
    : s.frequency === 'monthly' ? `on day ${s.run_day} of every month` : `on day ${s.run_day} of January, April, July and October`;
  return `Sent ${when} at ${hour}, covering ${covers}.`;
}

module.exports = { SECTIONS, SECTION_KEYS, STANDARD_SECTIONS, FREQUENCIES, WEEKDAYS, pickSections, isCustom, periodFor, adhocPeriod, nextRunAt,
  parseRecipients, periodLabel, describeSchedule };
