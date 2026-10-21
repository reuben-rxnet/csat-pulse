'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { evaluate } = require('../src/services/rules');
const { DEFAULTS, effectiveSettings } = require('../src/services/settings');
const { stripHtml, normaliseTicket, NO_SOURCE } = require('../src/hda/tickets');

const ticket = (o = {}) => ({ id: 'A1', ownerGroupId: 'G1', ownerGroupName: 'Desk', source: 'Email', requesterEmail: 'anna@corp.com', closeCode: 'Resolved', ...o });
const ctx = (o = {}) => ({ settings: { ...DEFAULTS }, enabledGroups: new Set(['G1']), enabledSources: new Set(['Email']), lastSurveyAt: null, now: new Date('2026-10-09T10:00:00Z'), ...o });

test('sends when group and source are enabled', () => assert.deepStrictEqual(evaluate(ticket(), ctx()), { send: true }));
test('skips disabled owner group', () => assert.match(evaluate(ticket({ ownerGroupId: 'G2' }), ctx()).reason, /Owner group not enabled/));
test('skips disabled source', () => assert.match(evaluate(ticket({ source: 'Monitoring' }), ctx()).reason, /source not enabled/));
test('skips missing source', () => assert.equal(evaluate(ticket({ source: null }), ctx()).send, false));
test('skips missing email', () => assert.match(evaluate(ticket({ requesterEmail: null }), ctx()).reason, /email/));
test('skips service accounts', () => assert.match(evaluate(ticket({ requesterEmail: 'svc_backup@corp.com' }), ctx()).reason, /exclusion/));
test('skips duplicate closure code', () => assert.match(evaluate(ticket({ closeCode: 'Closed as Duplicate' }), ctx()).reason, /Closure code/));
test('throttles repeat requesters', () => {
  assert.match(evaluate(ticket(), ctx({ lastSurveyAt: new Date('2026-10-05T10:00:00Z') })).reason, /already surveyed/);
  assert.equal(evaluate(ticket(), ctx({ lastSurveyAt: new Date('2026-09-20T10:00:00Z') })).send, true);
});
test('throttle 0 means no limit', () => {
  const c = ctx({ lastSurveyAt: new Date('2026-10-09T09:00:00Z') }); c.settings.throttleDays = 0;
  assert.equal(evaluate(ticket(), c).send, true);
});
test('master switch off', () => { const c = ctx(); c.settings.surveyEnabled = false; assert.equal(evaluate(ticket(), c).send, false); });

test('stripHtml keeps line breaks and decodes entities', () => {
  assert.equal(stripHtml('<p>Line&nbsp;1</p><p>A &amp; B<br>C</p>'), 'Line 1\nA & B\nC');
});
test('stripHtml handles HTML that HDA encoded twice', () => {
  assert.equal(stripHtml('&lt;p&gt;Bassa qualit&amp;#224; audio.&amp;#160;&lt;/p&gt;&lt;p&gt;dell&amp;#39;input&lt;br /&gt;ok&lt;/p&gt;'), "Bassa qualità audio.\ndell'input\nok");
});
test('normaliseTicket lowercases email and parses dates', () => {
  const t = normaliseTicket({ id: 'X', requesterEmail: ' Anna@Corp.COM ', closedAt: '/Date(1760000000000)/' }, 'Incident');
  assert.equal(t.requesterEmail, 'anna@corp.com');
  assert.equal(t.closedAt.getTime(), 1760000000000);
  assert.equal(t.number, 'X');
});
test('normaliseTicket files an empty source under "(No source)"', () => {
  assert.equal(normaliseTicket({ id: 'X', source: null }, 'Incident').source, NO_SOURCE);
  assert.equal(normaliseTicket({ id: 'X', source: '  ' }, 'Incident').source, NO_SOURCE);
  assert.equal(normaliseTicket({ id: 'X', source: 'Email' }, 'Incident').source, 'Email');
});
test('"(No source)" tickets are surveyed only when that source is switched on', () => {
  assert.match(evaluate(ticket({ source: NO_SOURCE }), ctx()).reason, /source not enabled/);
  assert.equal(evaluate(ticket({ source: NO_SOURCE }), ctx({ enabledSources: new Set([NO_SOURCE]) })).send, true);
});
test('first name: uses the HDA first-name field, title-cased', () => {
  const { firstName } = require('../src/names');
  assert.equal(firstName({ firstName: 'REUBEN', fullName: 'DSOUZA REUBEN', email: 'reuben.dsouza@essilor.com' }), 'Reuben');
  assert.equal(firstName({ firstName: 'JEAN-PIERRE', fullName: 'MARTIN JEAN-PIERRE' }), 'Jean-Pierre');
});
test('first name: falls back to a first.last email only when it matches the name', () => {
  const { firstName } = require('../src/names');
  assert.equal(firstName({ fullName: 'DSOUZA REUBEN', email: 'reuben.dsouza@essilor.com' }), 'Reuben');
  assert.equal(firstName({ fullName: 'John Lopez', email: 'john.lopez@ext.essilor.com' }), 'John');
  assert.equal(firstName({ fullName: 'DSOUZA REUBEN', email: 'dsouza.reuben@essilor.com' }), '', 'never greet by the capitalised surname');
  assert.equal(firstName({ fullName: 'DSOUZA REUBEN', email: 'rdsouza@essilor.com' }), '', 'no first.last pattern');
  assert.equal(firstName({ fullName: 'Store 0452', email: 'store.0452@luxottica.com' }), '');
  assert.equal(firstName({}), '');
});
test('normaliseTicket sets the first name for the greeting', () => {
  const t = normaliseTicket({ id: 'X', requesterName: 'DSOUZA REUBEN', requesterFirstName: 'REUBEN', requesterEmail: 'Reuben.Dsouza@essilor.com', requesterId: 'C1' }, 'Incident');
  assert.equal(t.requesterFirstName, 'Reuben');
  assert.equal(t.requesterId, 'C1');
});
test('contacts CSV opens in Excel and escapes values', () => {
  const { contactsCsv } = require('../src/services/missing');
  const csv = contactsCsv([{ contact_id: 'C1', name: 'DOE, JOHN', email_in_hda: null, suggested_email: 'john.doe@corp.com', tickets: 2, waiting: 1, groups: 'Desk', last_closed: new Date('2026-10-20T10:00:00Z'), examples: ['A1L', 'A2L'] }]);
  assert.ok(csv.startsWith('﻿sep=,\r\n'));
  assert.match(csv, /C1,"DOE, JOHN",\(empty\),john\.doe@corp\.com,2,1,Desk,2026-10-20,A1L A2L/);
});
test('skips tickets owned by an excluded account (e.g. a bot)', () => {
  const c = ctx(); c.settings.excludeOwnerPatterns = ['Eye-T ServiceDesk AI', 'svc *'];
  assert.match(evaluate(ticket({ ticketOwner: 'Eye-T ServiceDesk AI' }), c).reason, /Ticket owner excluded/);
  assert.match(evaluate(ticket({ ticketOwner: 'eye-t servicedesk ai' }), c).reason, /Ticket owner excluded/, 'case-insensitive');
  assert.match(evaluate(ticket({ ticketOwner: 'SVC Backup' }), c).reason, /Ticket owner excluded/);
  assert.equal(evaluate(ticket({ ticketOwner: 'DSOUZA Reuben' }), c).send, true);
});
test('plain-language summary of the send rules', () => {
  const { describeRules, describeGroup } = require('../src/services/summary');
  const r = { ...DEFAULTS, ticketTypes: ['Incident', 'Request'], sendDelayMinutes: 60, throttleDays: 7, reminderDays: 3, expiryDays: 14, alertThreshold: 2 };
  assert.equal(describeRules(r, ['Email', 'Phone', 'Self-service portal']),
    "Solved Incidents and Requests raised via Email, Phone or Self-service portal get a survey 1 hour after they're solved. Each person gets at most one survey every 7 days, with one reminder after 3 days, and the link expires after 14 days. The group lead is emailed when someone scores 2 or lower.");
  assert.equal(describeRules({ ...r, sendDelayMinutes: 0, throttleDays: 0, reminderDays: 0, alertThreshold: 0, ticketTypes: ['Request'] }, ['(No source)']),
    "Solved Requests raised via (No source) get a survey as soon as they're solved. There is no limit on surveys per person, with no reminder, and the link expires after 14 days. No low-score alerts are sent.");
  assert.match(describeRules(r, []), /No ticket sources are switched on/);
  assert.match(describeRules({ ...r, ticketTypes: [] }, ['Email']), /No ticket types are selected/);
  assert.match(describeGroup({ enabled: false, surveyEnabled: true, rules: r, sources: ['Email'] }), /^This group is switched off/);
  assert.match(describeGroup({ enabled: true, surveyEnabled: false, rules: r, sources: ['Email'] }), /master switch/);
});
test('change history reads as plain sentences', () => {
  const { describe } = require('../src/services/history');
  const names = id => ({ G815L: 'WW_GRP_2/RxIT_MFG_Support' }[id] || id);
  assert.equal(describe({ action: 'group.toggle', detail: { id: 'G815L', enabled: true } }, names), 'Switched surveys on for WW_GRP_2/RxIT_MFG_Support');
  assert.equal(describe({ action: 'group.settings', group_id: 'G815L', detail: { id: 'G815L', rules: { reminderDays: 0 }, sources: ['Email'] } }, names),
    'Changed sources & rules for WW_GRP_2/RxIT_MFG_Support (own sources: Email; own reminder)');
  assert.equal(describe({ action: 'survey.email_fixed', survey_ticket: 'A1L', detail: { survey: 5 } }), 'Typed the email for A1L and sent its survey');
});
test('group rules override only the keys they set', () => {
  const eff = effectiveSettings({ ...DEFAULTS }, { rules: { reminderDays: 0, throttleDays: 30, surveyEnabled: false, csatTarget: 1 } });
  assert.equal(eff.reminderDays, 0);
  assert.equal(eff.throttleDays, 30);
  assert.equal(eff.sendDelayMinutes, DEFAULTS.sendDelayMinutes);
  assert.equal(eff.surveyEnabled, DEFAULTS.surveyEnabled, 'master switch stays global');
  assert.equal(eff.csatTarget, DEFAULTS.csatTarget, 'CSAT target stays global');
  assert.deepStrictEqual(effectiveSettings({ ...DEFAULTS }, undefined), { ...DEFAULTS });
});
test('group ticket types narrow what gets surveyed', () => {
  const settings = effectiveSettings({ ...DEFAULTS }, { rules: { ticketTypes: ['Request'] } });
  assert.match(evaluate(ticket({ ticketType: 'Incident' }), ctx({ settings })).reason, /Ticket type not enabled/);
  assert.equal(evaluate(ticket({ ticketType: 'Request' }), ctx({ settings })).send, true);
});
