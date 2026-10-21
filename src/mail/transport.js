'use strict';
// Mail transports: Microsoft Graph (app-only, Mail.Send), SMTP relay (nodemailer), or file (dev: writes to ./outbox).
const fs = require('fs');
const path = require('path');
const config = require('../config');

let graphToken = null, graphTokenExp = 0, smtp = null;
// msg.to may be one address or a list (reports); msg.attachments = [{ filename, content: Buffer, contentType }].
const toList = to => [].concat(to || []);

async function graphAccessToken() {
  if (graphToken && Date.now() < graphTokenExp - 60e3) return graphToken;
  const g = config.mail.graph;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(g.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Graph token error: ${json.error_description || json.error || res.status}`);
  graphToken = json.access_token; graphTokenExp = Date.now() + json.expires_in * 1000;
  return graphToken;
}

async function sendGraph(msg) {
  const g = config.mail.graph;
  const body = {
    message: {
      subject: msg.subject,
      body: { contentType: 'HTML', content: msg.html },
      toRecipients: toList(msg.to).map(address => ({ emailAddress: { address } })),
      ...(msg.attachments && msg.attachments.length ? { attachments: msg.attachments.map(a => ({ '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.filename, contentType: a.contentType, contentBytes: Buffer.from(a.content).toString('base64') })) } : {}),
      ...(config.mail.replyTo ? { replyTo: [{ emailAddress: { address: config.mail.replyTo } }] } : {}),
    },
    saveToSentItems: false,
  };
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(g.senderUpn)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${await graphAccessToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (res.status !== 202) { const t = await res.text(); throw new Error(`Graph sendMail ${res.status}: ${t.slice(0, 300)}`); }
}

async function sendSmtp(msg) {
  if (!smtp) {
    const nodemailer = require('nodemailer');
    const s = config.mail.smtp;
    smtp = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass } : undefined });
  }
  await smtp.sendMail({
    from: { name: config.mail.fromName, address: config.mail.from }, to: msg.to, replyTo: config.mail.replyTo || undefined,
    subject: msg.subject, html: msg.html, text: msg.text,
    attachments: (msg.attachments || []).map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
  });
}

async function sendFile(msg) {
  fs.mkdirSync(config.mail.outboxDir, { recursive: true });
  const list = toList(msg.to);
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${(list[0] || 'unknown').replace(/[^a-z0-9@._-]/gi, '_')}${list.length > 1 ? `_+${list.length - 1}` : ''}`;
  fs.writeFileSync(path.join(config.mail.outboxDir, name + '.html'), msg.html);
  for (const a of msg.attachments || []) fs.writeFileSync(path.join(config.mail.outboxDir, `${name}_${a.filename.replace(/[^a-z0-9._-]/gi, '_')}`), a.content);
  fs.writeFileSync(path.join(config.mail.outboxDir, name + '.json'), JSON.stringify({ to: msg.to, subject: msg.subject, text: msg.text,
    attachments: (msg.attachments || []).map(a => a.filename) }, null, 2));
}

// direct: skip MAIL_TEST_RECIPIENT (used by Admin → Test survey, where the admin types the recipient).
async function sendMail(msg, { direct = false } = {}) {
  const override = direct ? '' : config.mail.testRecipientOverride;
  const to = override || msg.to;
  const m = { ...msg, to, subject: override ? `[TEST for ${toList(msg.to).join(', ')}] ${msg.subject}` : msg.subject };
  switch (config.mail.transport) {
    case 'graph': return sendGraph(m);
    case 'smtp': return sendSmtp(m);
    case 'file': return sendFile(m);
    default: throw new Error(`Unknown MAIL_TRANSPORT "${config.mail.transport}" (use graph, smtp or file)`);
  }
}

module.exports = { sendMail };
