'use strict';
// Survey, reminder and low-score alert emails. Table-based HTML with inline styles for Outlook.
const config = require('../config');
const { greetingName } = require('../names');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const nl2br = s => esc(s).replace(/\n/g, '<br>');

const NAVY = '#0b1f3f', ACCENT = '#1f5fbf', MUTED = '#5b6780', LINE = '#dfe4ee', BG = '#f5f7fb';
const LABELS = ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'];
const QUESTION = 'How satisfied are you with how this ticket was handled?';
const COMMENT_PROMPT = "Anything you'd like to add? (optional)";

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function brandHeader(title, sub) {
  const b = config.brand;
  const mark = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.company)}" height="28" style="display:block;border:0;height:28px">`
    : `<span style="font:800 17px Segoe UI,Arial,sans-serif;color:#ffffff;letter-spacing:.2px">${esc(b.company)} <span style="font-weight:400;opacity:.85">${esc(b.unit)}</span></span>`;
  return `<tr><td style="background:${NAVY};padding:20px 24px;border-radius:10px 10px 0 0">
    ${mark}
    <div style="font:700 19px Segoe UI,Arial,sans-serif;color:#ffffff;margin-top:10px">${esc(title)}</div>
    ${sub ? `<div style="font:13px Segoe UI,Arial,sans-serif;color:#ffffff;opacity:.8;margin-top:4px">${esc(sub)}</div>` : ''}
  </td></tr>`;
}

function detailRow(label, value, mono) {
  return `<tr><td style="padding:6px 12px 6px 0;font:13px Segoe UI,Arial,sans-serif;color:${MUTED};vertical-align:top;white-space:nowrap;width:110px">${esc(label)}</td>
    <td style="padding:6px 0;font:${mono ? '600 13px Consolas,monospace' : '13px Segoe UI,Arial,sans-serif'};color:#14213a;vertical-align:top">${value}</td></tr>`;
}

// Requester email (agreed with the product owner): Ticket ID, Date, Subject, Solution, Ticket owner.
// The low-score alert to the group lead (ownerGroup: true) also shows the description and owner group.
function ticketDetails(s, { ownerGroup = false } = {}) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};border-radius:8px">
    <tr><td style="padding:12px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${detailRow('Ticket ID', esc(s.ticket_number || s.ticket_id), true)}
      ${detailRow('Date', esc(fmtDate(s.closed_at) || '–'))}
      ${detailRow('Subject', `<b>${esc(s.subject || '–')}</b>`)}
      ${ownerGroup && s.description ? detailRow('Description', nl2br(clip(s.description, 900))) : ''}
      ${s.solution ? detailRow('Solution', nl2br(clip(s.solution, 900))) : ''}
      ${ownerGroup ? detailRow('Owner group', esc(s.owner_group_name || '–')) : ''}
      ${detailRow('Ticket owner', esc(s.ticket_owner || '–'))}
    </table></td></tr></table>`;
}

function ratingButtons(link) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${[1, 2, 3, 4, 5].map(n => `<td width="20%" style="padding:0 3px" align="center">
      <a href="${esc(link)}?score=${n}" style="display:block;border:1px solid ${LINE};border-radius:8px;padding:10px 2px;text-decoration:none;font:12px Segoe UI,Arial,sans-serif;color:${MUTED}">
        <span style="display:block;font:700 18px Segoe UI,Arial,sans-serif;color:${NAVY}">${n}</span>${LABELS[n - 1]}</a></td>`).join('')}
  </tr></table>`;
}

// Email clients can't submit form fields, so the comment box links to the survey page, where it can be typed in.
function commentBox(link) {
  return `<p style="font:600 13px Segoe UI,Arial,sans-serif;color:#14213a;margin:18px 0 6px">${esc(COMMENT_PROMPT)}</p>
    <a href="${esc(link)}" style="display:block;border:1px solid ${LINE};border-radius:8px;padding:10px 12px;height:36px;text-decoration:none;font:13px Segoe UI,Arial,sans-serif;color:${MUTED}">What went well, or what could be better</a>`;
}

function surveyEmail(s, link, { reminder = false } = {}) {
  const first = greetingName(s);
  const kind = (s.ticket_type || 'ticket').toLowerCase();
  const subject = `${reminder ? 'Reminder: ' : ''}How did we do? ${s.ticket_type || 'Ticket'} ${s.ticket_number || s.ticket_id}`;
  const card = config.mail.actionable.enabled ? actionableCard(s, link) : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${card}</head>
<body style="margin:0;padding:24px 12px;background:${BG}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  ${brandHeader('How did we do?', `Your ${kind} ${s.ticket_number || s.ticket_id} was closed on ${fmtDate(s.closed_at)}`)}
  <tr><td style="background:#ffffff;border:1px solid ${LINE};border-top:0;border-radius:0 0 10px 10px;padding:22px 24px">
    <p style="font:14px Segoe UI,Arial,sans-serif;color:#14213a;margin:0 0 16px">Hello${first ? ' ' + esc(first) : ''}, your ${esc(kind)} has been resolved and closed. Please take a moment to rate the support you received.</p>
    ${ticketDetails(s)}
    <p style="font:700 15px Segoe UI,Arial,sans-serif;color:#14213a;margin:22px 0 10px">${esc(QUESTION)}</p>
    ${ratingButtons(link)}
    ${commentBox(link)}
    <p style="font:13px Segoe UI,Arial,sans-serif;color:${MUTED};margin:14px 0 0">Choose a rating, add a comment if you like, then submit. It takes about 10 seconds.</p>
    <p style="font:12px Segoe UI,Arial,sans-serif;color:${MUTED};margin:18px 0 0;border-top:1px solid ${LINE};padding-top:12px">This link is personal to you, works once and expires on ${fmtDate(s.expires_at)}. If the issue is not resolved, reopen the ticket in the IT portal or contact the Service Desk team. <a href="${esc(config.publicBaseUrl)}/about-survey" style="color:${ACCENT}">About this survey</a></p>
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `Hello${first ? ' ' + first : ''},`, '', `Your ${kind} has been resolved and closed. Please rate the support you received.`, '',
    `${s.ticket_type || 'Ticket'} number: ${s.ticket_number || s.ticket_id}`, `Subject: ${s.subject || ''}`,
    s.description ? `Description: ${clip(s.description, 900)}` : '', s.solution ? `Solution: ${clip(s.solution, 900)}` : '',
    `Ticket owner: ${s.ticket_owner || '-'}`, '',
    QUESTION, ...[1, 2, 3, 4, 5].map(n => `  ${n} ${LABELS[n - 1]}: ${link}?score=${n}`), '',
    `To add a comment, open: ${link}`, '',
    `This link works once and expires on ${fmtDate(s.expires_at)}.`, `About this survey: ${config.publicBaseUrl}/about-survey`,
  ].filter(l => l !== null).join('\n');
  return { subject, html, text };
}

// Outlook Actionable Message (Adaptive Card): lets Outlook users answer inside the email.
// Requires a registered provider (originator ID) in the Actionable Email Developer Dashboard.
function actionableCard(s, link) {
  const token = link.split('/').pop();
  const card = {
    type: 'AdaptiveCard', version: '1.0', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    originator: config.mail.actionable.originator, hideOriginalBody: true,
    body: [
      { type: 'TextBlock', text: `${config.brand.company} ${config.brand.unit} · How did we do?`, weight: 'bolder', size: 'medium' },
      { type: 'FactSet', facts: [
        { title: (s.ticket_type || 'Ticket') + ' number', value: s.ticket_number || s.ticket_id }, { title: 'Subject', value: s.subject || '' },
        { title: 'Description', value: clip(s.description, 500) }, { title: 'Solution', value: clip(s.solution, 500) },
        { title: 'Ticket owner', value: s.ticket_owner || '' } ] },
      { type: 'TextBlock', text: QUESTION, wrap: true, weight: 'bolder', spacing: 'medium' },
      { type: 'Input.ChoiceSet', id: 'overall', style: 'expanded', isRequired: true, label: QUESTION,
        choices: LABELS.map((l, i) => ({ title: `${i + 1} – ${l}`, value: String(i + 1) })) },
      { type: 'TextBlock', text: COMMENT_PROMPT, weight: 'bolder', spacing: 'medium' },
      { type: 'Input.Text', id: 'comment', isMultiline: true, maxLength: 500, placeholder: 'What went well, or what could be better' },
    ],
    actions: [{
      type: 'Action.Http', title: 'Submit feedback', method: 'POST',
      url: `${config.publicBaseUrl}/api/actionable/${token}`,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify({ overall: '{{overall.value}}', comment: '{{comment.value}}' }),
    }],
  };
  return `<script type="application/adaptivecard+json">${JSON.stringify(card).replace(/</g, '\\u003c')}</script>`;
}

function alertEmail(s, r) {
  const subject = `Low CSAT score (${r.overall}/5) on ${s.ticket_number || s.ticket_id}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:${BG}">
<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  ${brandHeader('Low CSAT score needs follow-up', `${s.owner_group_name || ''}`)}
  <tr><td style="background:#ffffff;border:1px solid ${LINE};border-top:0;border-radius:0 0 10px 10px;padding:22px 24px;font:14px Segoe UI,Arial,sans-serif;color:#14213a">
    <p style="margin:0 0 14px"><b>${esc(s.requester_name || s.requester_email)}</b> rated ticket <b>${esc(s.ticket_number || s.ticket_id)}</b> <b style="color:#c2413b">${r.overall} / 5</b>.</p>
    ${ticketDetails(s, { ownerGroup: true })}
    ${r.comment ? `<p style="margin:16px 0 0"><b>Comment:</b><br>“${nl2br(r.comment)}”</p>` : ''}
    <p style="margin:16px 0 0"><a href="${esc(config.publicBaseUrl)}/admin#followups" style="color:${ACCENT};font-weight:700">Open the follow-up queue</a></p>
  </td></tr></table></body></html>`;
  const text = `${subject}\n\nRequester: ${s.requester_name || ''} <${s.requester_email}>\nSubject: ${s.subject}\nComment: ${r.comment || '-'}\n\n${config.publicBaseUrl}/admin#followups`;
  return { subject, html, text };
}

module.exports = { surveyEmail, alertEmail, QUESTION, LABELS, esc, clip, nl2br };
