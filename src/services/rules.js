'use strict';
// Pure decision logic: should this closed ticket get a survey? Kept side-effect free for unit testing.

// Exact text matters: the "Missing email" page lists skipped surveys with this reason.
const NO_EMAIL_REASON = 'No valid requester email';
const isValidEmail = e => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

function globToRegex(glob) {
  return new RegExp('^' + glob.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
}

/**
 * @param {object} t normalised ticket
 * @param {object} ctx { settings, enabledGroups:Set, enabledSources:Set, lastSurveyAt:Date|null, now:Date }
 * @returns {{ send: boolean, reason?: string }}
 */
function evaluate(t, ctx) {
  const { settings: s, enabledGroups, enabledSources, lastSurveyAt, now = new Date() } = ctx;
  if (!s.surveyEnabled) return { send: false, reason: 'Surveys are switched off globally' };
  if (Array.isArray(s.ticketTypes) && t.ticketType && !s.ticketTypes.includes(t.ticketType)) return { send: false, reason: `Ticket type not enabled (${t.ticketType})` };
  if (!t.ownerGroupId || !enabledGroups.has(t.ownerGroupId)) return { send: false, reason: `Owner group not enabled (${t.ownerGroupName || t.ownerGroupId || 'none'})` };
  if (!t.source || !enabledSources.has(t.source)) return { send: false, reason: `Ticket source not enabled (${t.source || 'none'})` };
  if (!isValidEmail(t.requesterEmail)) return { send: false, reason: NO_EMAIL_REASON };
  const local = t.requesterEmail.split('@')[0];
  for (const p of s.excludeRequesterPatterns || []) if (globToRegex(p).test(local)) return { send: false, reason: `Requester matches exclusion "${p}"` };
  // e.g. bots such as "Eye-T ServiceDesk AI"; matched against the ticket owner's full name, * = wildcard.
  if (t.ticketOwner) for (const p of s.excludeOwnerPatterns || []) if (globToRegex(p).test(String(t.ticketOwner).trim())) return { send: false, reason: `Ticket owner excluded (${t.ticketOwner})` };
  if (t.closeCode) {
    const cc = t.closeCode.toLowerCase();
    for (const x of s.excludeCloseCodes || []) if (x && cc.includes(String(x).toLowerCase())) return { send: false, reason: `Closure code excluded (${t.closeCode})` };
  }
  if (s.throttleDays > 0 && lastSurveyAt && now - lastSurveyAt < s.throttleDays * 864e5) {
    return { send: false, reason: `Requester already surveyed in the last ${s.throttleDays} days` };
  }
  return { send: true };
}

module.exports = { evaluate, globToRegex, isValidEmail, NO_EMAIL_REASON };
