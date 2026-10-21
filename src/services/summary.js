'use strict';
// Plain-language descriptions of what the send rules do, shown at the top of the settings pages. Pure, unit-tested.

const orList = a => (a.length <= 1 ? a[0] || '' : `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const duration = m => (m % 1440 === 0 ? plural(m / 1440, 'day') : m % 60 === 0 ? plural(m / 60, 'hour') : plural(m, 'minute'));
const typeNames = types => types.map(t => (/s$/i.test(t) ? t : t + 's')).join(' and '); // Incident → Incidents

// r = effective settings (global merged with the group's overrides); sources = names of the sources that apply.
function describeRules(r, sources) {
  const types = r.ticketTypes || [];
  if (!types.length) return 'No ticket types are selected, so no surveys are sent.';
  if (!sources.length) return 'No ticket sources are switched on, so no surveys are sent.';
  const when = r.sendDelayMinutes > 0 ? `${duration(r.sendDelayMinutes)} after they're solved` : "as soon as they're solved";
  const limit = r.throttleDays > 0 ? `Each person gets at most one survey every ${plural(r.throttleDays, 'day')}` : 'There is no limit on surveys per person';
  const reminder = r.reminderDays > 0 ? `one reminder after ${plural(r.reminderDays, 'day')}` : 'no reminder';
  const alert = r.alertThreshold > 0 ? `The group lead is emailed when someone scores ${r.alertThreshold} or lower.` : 'No low-score alerts are sent.';
  return `Solved ${typeNames(types)} raised via ${orList(sources)} get a survey ${when}. ${limit}, with ${reminder}, and the link expires after ${plural(r.expiryDays, 'day')}. ${alert}`;
}

function describeGroup({ enabled, surveyEnabled, rules, sources }) {
  if (!surveyEnabled) return `Surveys are switched off for everyone (master switch), so nothing is sent right now. When it's back on: ${describeRules(rules, sources)}`;
  if (!enabled) return `This group is switched off, so it gets no surveys. When switched on: ${describeRules(rules, sources)}`;
  return describeRules(rules, sources);
}

function describeExclusions(s) {
  const parts = [];
  if ((s.excludeRequesterPatterns || []).length) parts.push(`requesters whose email starts like ${s.excludeRequesterPatterns.join(', ')}`);
  if ((s.excludeOwnerPatterns || []).length) parts.push(`tickets owned by ${s.excludeOwnerPatterns.join(', ')}`);
  return parts.length ? `Never surveyed: ${parts.join('; ')}.` : '';
}

module.exports = { describeRules, describeGroup, describeExclusions, duration };
