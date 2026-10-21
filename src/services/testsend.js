'use strict';
// Admin → Test survey: preview the survey email and send a working test to any address.
// Test rows have is_test = true, so they stay out of the dashboard, the throttle and the duplicate check.
const db = require('../db');
const { sendMail } = require('../mail/transport');
const { surveyEmail } = require('../mail/templates');
const { fetchTicket } = require('../hda/tickets');
const { getSettings } = require('./settings');
const { newToken, hashToken, linkFor } = require('./sender');

const SAMPLE = {
  ticket_id: 'SAMPLE-0001', ticket_number: 'A0000001L', entity: 'Incident', ticket_type: 'Incident',
  subject: 'Outlook keeps asking for my password',
  description: 'Since this morning Outlook asks for my password every few minutes, even after I type it in.',
  solution: 'Cleared the cached credentials in Windows Credential Manager and re-created the Outlook profile. Sign-in now works normally.',
  source: 'Web', requester_name: 'USER Sample', requester_first_name: 'Sample', owner_group_id: 'G0L', owner_group_name: 'L1_ESS_Service Desk',
  ticket_owner: 'Sample Agent', priority: 'P3 - Normal', category: 'Email', closed_at: new Date(),
};

// Survey fields for a real HDA ticket (by number), or the built-in sample when no number is given.
async function sampleSurvey(ticketNumber) {
  const id = String(ticketNumber || '').trim();
  if (!id) return { survey: { ...SAMPLE, closed_at: new Date() }, fromHda: false };
  const t = await fetchTicket(id);
  if (!t) { const e = new Error(`Ticket ${id} was not found in HDA (or it is not an Incident/Request type in the mapping).`); e.status = 404; throw e; }
  return {
    fromHda: true,
    survey: {
      ticket_id: t.id, ticket_number: t.number, entity: t.entity, ticket_type: t.ticketType, subject: t.subject,
      description: t.description, solution: t.solution, source: t.source, requester_name: t.requesterName, requester_first_name: t.requesterFirstName,
      owner_group_id: t.ownerGroupId, owner_group_name: t.ownerGroupName, ticket_owner: t.ticketOwner,
      ticket_owner_email: t.ticketOwnerEmail, priority: t.priority, category: t.category, closed_at: t.closedAt || new Date(),
    },
  };
}

// guard(survey) may throw, e.g. when a team admin picks a ticket from a group that isn't theirs.
async function previewHtml(ticketNumber, guard = () => {}) {
  const { survey } = await sampleSurvey(ticketNumber);
  guard(survey);
  const settings = await getSettings();
  return surveyEmail({ ...survey, expires_at: new Date(Date.now() + settings.expiryDays * 864e5) }, linkFor('preview-only-link')).html;
}

async function sendTest({ to, ticketNumber, guard = () => {} }) {
  const { survey: s } = await sampleSurvey(ticketNumber);
  guard(s);
  const settings = await getSettings();
  const token = newToken();
  const expiresAt = new Date(Date.now() + settings.expiryDays * 864e5);
  const mail = surveyEmail({ ...s, expires_at: expiresAt }, linkFor(token));
  await sendMail({ to, ...mail, subject: `[TEST] ${mail.subject}` }, { direct: true });
  await db.query(`INSERT INTO surveys(is_test, ticket_id, ticket_number, entity, ticket_type, ticket_owner_email, subject, description, solution, source,
                    requester_email, requester_name, owner_group_id, owner_group_name, ticket_owner, priority, category, closed_at,
                    status, sent_at, expires_at, token_hash, attempts, requester_first_name)
                  VALUES (true,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'sent',now(),$18,$19,1,$20)`,
    [s.ticket_id, s.ticket_number, s.entity, s.ticket_type, s.ticket_owner_email || null, s.subject, s.description, s.solution, s.source,
     to, s.requester_name, s.owner_group_id, s.owner_group_name, s.ticket_owner, s.priority, s.category, s.closed_at, expiresAt, hashToken(token),
     s.requester_first_name || null]);
  return { ticket: s.ticket_number, subject: mail.subject, group: s.ticket_id === SAMPLE.ticket_id ? null : s.owner_group_id };
}

module.exports = { sampleSurvey, previewHtml, sendTest };
