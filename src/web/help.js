'use strict';
// "About & help" page for admins (/admin/help) and the public "About this survey" page (/about-survey).
// All help text lives here. When a feature changes, update the matching section and add a line to WHATS_NEW.
// Live values (send rules, check interval, report domains, contact) come from settings/config so the text stays true.
const config = require('../config');
const { esc } = require('../mail/templates');
const { describeRules, describeExclusions } = require('../services/summary');

const WHATS_NEW = [
  ['29 Oct 2026', [
    'Stakeholder survey results can be sent from <b>Reports</b> (PDF, optional Excel, no names unless ticked), and optionally emailed automatically when a survey closes. Results pages link to the previous and next quarter’s round.',
    'Report emails – ticket CSAT and stakeholder surveys – now show the main figures and charts in the email itself, with the PDF attached.',
    'New <b>Stakeholder surveys</b>: build a survey like Microsoft Forms (rating grids, choice, text, stars, NPS), send each stakeholder a personal email link with reminders, and see every named answer with charts, NPS and an Excel export. Includes the RxSolutions quarterly survey as a template, “Send a test to me”, and Duplicate for next quarter.',
  ]],
  ['21 Oct 2026', [
    'Company single sign-on (OpenID Connect, e.g. Microsoft Entra ID) is ready: once IAM has registered the app, people sign in with their company account and <b>Sign out</b> appears next to their name.',
    'CSAT Pulse stops signing in to HDA after a rejected password, so an AD account can’t be locked; global admins see a red bar with <b>Try again</b>.',
    'New <b>How CSAT Pulse is built</b> section on this page: the platform, and why it was built this way.',
    'All ticket sources defined in HDA are now listed under <b>Default sources</b> (synced daily, or with <b>Sync from HDA now</b>), not only the ones seen on tickets.',
    'New look for the whole site, and a redesigned <b>Dashboard</b> with insights, a group leaderboard and a follow-up queue you can work through on the page.',
    'New <b>About &amp; help</b> page (this page) and a public <a href="/about-survey">About this survey</a> page, linked from every survey email.',
    'New <b>Reports</b> page: download a PDF report for any dates, email it now, or schedule it weekly, monthly or quarterly. A custom report can include ticket owners.',
    'Surveys now go out when a ticket is <b>Solved</b> in HDA, instead of days later when HDA closes it.',
    'Team admins: everyone who signs in sees and manages only the owner groups they belong to in HDA. Each group can have its own sources and send rules.',
    '<b>Missing emails</b> page: send a survey when the HDA contact has no valid email, and download a list of contacts to fix.',
    'Plain-language summaries of the send rules, a <b>Change history</b> tab, and "Skip tickets owned by" for automated accounts.',
  ]],
  ['16 Oct 2026', [
    'CSAT Pulse connected to HDA (quality environment). Survey email agreed: Ticket ID, Date, Subject, Solution, Ticket owner, a 1–5 rating and a comment box.',
    '<b>Test survey</b> page to preview the email and send yourself a working test.',
  ]],
];

const contact = () => {
  const s = config.support;
  return s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.name || s.email)}</a>${s.name ? ` (${esc(s.email)})` : ''}` : esc(s.name || 'your CSAT Pulse global admin');
};
const pill = t => `<span class="pill warn">${t}</span>`;
const steps = list => `<ol class="steps">${list.map(s => `<li><span>${s}</span></li>`).join('')}</ol>`;
// One "How do I…" entry: collapsible, linkable by id, searchable.
const task = (id, title, body, { globalOnly = false } = {}) => ({ id, title, body, globalOnly, keys: KEYWORDS[id] || '' });
// Other words people may search with, per guide (the search also matches the title and steps).
const KEYWORDS = {
  'switch-on': 'enable turn on activate start begin add group team owner group toggle',
  'group-rules': 'override customise customize own settings per group delay throttle reminder expiry sources types',
  'group-lead': 'alert notify notification manager lead team lead low score email who gets',
  'default-rules': 'settings configuration defaults delay throttle reminder expiry target master switch',
  'default-sources': 'source channel web portal email phone no source enable',
  'skip-bots': 'bot robot ai automated service account exclude ignore skip eye-t',
  dashboard: 'kpi metrics numbers results charts trend csat score filter period',
  'follow-up': 'low score bad rating unhappy complaint follow up contact resolve detractor',
  'report-download': 'pdf export download print report stakeholder management',
  'report-email': 'send share email report stakeholder recipients management',
  'report-schedule': 'schedule automatic recurring weekly monthly quarterly regular report email',
  'report-agents': 'agent agents ticket owner names people technician custom report',
  'forms-create': 'stakeholder survey form ms forms microsoft forms quarterly questionnaire build create new questions likert grid nps template',
  'forms-send': 'send invite invitation email stakeholders recipients personal link reminder close date test',
  'forms-results': 'results responses answers names who answered export excel nps chart respondents',
  'forms-next-quarter': 'duplicate copy next quarter repeat again reuse previous round',
  'forms-report': 'report pdf email results manager boss stakeholders send results close automatic excel names anonymous',
  history: 'audit log changes who changed history trail',
  'find-ticket': 'search ticket lookup status survey log where is missing survey not sent',
  'missing-email': 'no email invalid email wrong address bounce missing email contact',
  'contacts-csv': 'excel csv export contacts fix hda wrong email list',
  'test-survey': 'preview test try sample example look like demo',
  'team-access': 'permission access rights grant give add person user manager',
  'view-as': 'impersonate view as team admin see what they see preview role',
  sync: 'import refresh new groups hda sync update',
  'stop-all': 'disable turn off pause stop everything master switch all off',
};

function tasks(ctx) {
  const { team, settings } = ctx;
  const groupsPage = team ? '<b>My groups</b>' : '<b>Admin settings</b>';
  return [
    ['Setting up surveys', [
      task('switch-on', 'Switch surveys on for an owner group', steps([
        `Open ${groupsPage} in the top menu and stay on the <b>Owner groups</b> tab.`,
        'Find the group: type part of its name in <b>Search groups</b>, or click <b>Tickets in last 30 days</b> to see the busy ones.',
        'Click the switch next to the group and confirm. It turns blue and the group is listed under <b>Switched on</b>.',
        'From now on, tickets of that group that are solved in HDA get a survey (if their source is switched on too).',
      ]) + `<p class="small muted">No group is ever switched on automatically – only by an admin, one at a time. To stop, click the same switch again.</p>`),
      task('group-rules', 'Give one group its own sources, ticket types or timing', steps([
        `In ${groupsPage}, click <b>Sources &amp; rules</b> next to the group.`,
        'For sources and ticket types, keep <b>Use the default …</b> ticked, or untick it and choose the group’s own.',
        'For the send delay, per-person limit, reminder, link expiry and low-score alert level, type the group’s own value, or leave the box empty to use the default.',
        'Click <b>Save group settings</b>. The sentence at the top (“What happens for this group”) tells you in words what will happen.',
      ])),
      task('group-lead', 'Set who gets low-score alerts (group lead)', steps([
        `In ${groupsPage}, type an email address in the <b>Group lead email</b> box next to the group.`,
        'Click anywhere outside the box. “Group lead saved” confirms it.',
        `That person is emailed whenever someone scores ${settings.alertThreshold || 2} or lower for this group (the level can be changed in <b>Sources &amp; rules</b>). Leave the box empty to send no alerts.`,
      ])),
      task('default-rules', 'Change the default send rules', steps([
        'Open <b>Admin settings</b> → <b>Default send rules</b>.',
        'Change the ticket types, send delay, per-person limit, reminder, link expiry, low-score alert level or CSAT target.',
        'Click <b>Save rules</b>. Groups with their own rules keep them; all other groups use the new defaults.',
      ]) + '<p class="small muted">The master switch at the top of this tab stops every survey at once.</p>', { globalOnly: true }),
      task('default-sources', 'Choose which ticket sources get surveys', steps([
        'Open <b>Admin settings</b> → <b>Default sources</b>.',
        'Switch on the sources that should get surveys, for example Web. Every source defined in HDA is listed; “Not active in HDA” means HDA no longer offers it. “(No source)” means the Source field is empty in HDA.',
        'A source added in HDA appears here after the daily sync, or straight away with <b>Sync from HDA now</b> – switched off.',
        'Changes save immediately. Groups that chose their own sources in <b>Sources &amp; rules</b> are not affected.',
      ]), { globalOnly: true }),
      task('skip-bots', 'Stop surveys for tickets handled by a bot or service account', steps([
        'Open <b>Admin settings</b> → <b>Default send rules</b>.',
        'In <b>Skip tickets owned by</b>, type the ticket owner’s name exactly as the Survey log shows it, one per line (for example <i>Eye-T ServiceDesk AI</i>). Use * as a wildcard.',
        'Click <b>Save rules</b>. Requesters can be skipped the same way under <b>Skip requesters whose email starts like</b>.',
      ]), { globalOnly: true }),
    ]],
    ['Results', [
      task('dashboard', 'Read the dashboard', steps([
        'Open <b>Dashboard</b>. Choose an owner group, source, type or priority, and a period (4 weeks to 12 months).',
        'The tiles at the top show CSAT %, average score, response rate, surveys sent, low scores and time to respond. The small ▲/▼ compares with the period before.',
        'Scroll down for the weekly trend, the score spread, breakdowns by source, group, ticket owner, type, priority and category, and why tickets were skipped.',
      ]) + `<p class="small muted">${team ? 'You see your own owner groups only.' : 'Global admins see all owner groups.'} Test surveys are never counted. See the <a href="#glossary">glossary</a> for what each number means.</p>`),
      task('follow-up', 'Follow up a low score', steps([
        'On the <b>Dashboard</b>, scroll to <b>Low-score follow-up queue</b>. Every score of 1 or 2 is listed, open ones first.',
        'Read the comment and contact the person (open the ticket in HDA from the <b>Survey log</b> if you need their details). If the issue isn’t fixed, reopen the ticket in HDA – the survey doesn’t do that by itself.',
        'Change the status from <b>open</b> to <b>contacted</b>, then <b>resolved</b>. It saves immediately and shows in the tiles and in reports.',
      ])),
      task('report-download', 'Download a PDF report', steps([
        'Open <b>Reports</b> (or click <b>Create a PDF report</b> on the Dashboard).',
        'Under <b>Create a report</b>, pick the dates – or click Last month, This month, Last 4 weeks, Last quarter or This year.',
        'Keep <b>All owner groups</b> ticked, or untick it and choose groups.',
        'Choose <b>Standard report</b> (no agent names) or <b>Custom report</b> and tick the parts you want.',
        'Click <b>Download PDF</b>.',
      ])),
      task('report-email', 'Email a report now', steps([
        'Set up the report as in <a href="#report-download">Download a PDF report</a>.',
        `Under <b>Email it to</b>, type one or more addresses, separated by commas or new lines.${config.reports.recipientDomains.length ? ` Only ${config.reports.recipientDomains.map(d => '@' + d).join(', ')} addresses are accepted.` : ''}`,
        'Add a message if you like, then click <b>Send report now</b> and confirm. The email shows the main figures and has the PDF attached.',
      ])),
      task('report-schedule', 'Send a report automatically every week, month or quarter', steps([
        'Open <b>Reports</b> and scroll to <b>Scheduled reports</b> → <b>New scheduled report</b>.',
        'Give it a name and the recipients.',
        'Choose how often, the day and the time. Each report covers the last complete week (Monday–Sunday), month or quarter.',
        'Choose the owner groups and Standard or Custom, then click <b>Create scheduled report</b>.',
        'Use <b>Send now</b> to try it, <b>Pause</b> to stop it for a while, <b>Edit</b> or <b>Delete</b>.',
      ]) + '<p class="small muted">If a send fails, it is retried up to 3 times, 30 minutes apart. <b>Last send</b> shows the result. Scheduled reports only go out while CSAT Pulse is running.</p>'),
      task('report-agents', 'Include ticket owners (agent names) in a report', steps([
        'In the report or schedule form, choose <b>Custom report</b>.',
        'Tick <b>Ticket owners (agent names)</b> and the other parts you want.',
      ]) + '<p class="small muted">Only ticket owners with at least 5 responses are listed, so one answer can’t single someone out. Standard reports never include agent names.</p>'),
      task('history', 'See who changed what', steps([
        `Open ${groupsPage} → <b>Change history</b>.`,
        'Every change is listed in words, newest first: groups switched on or off, rules, sources, reports, follow-ups, emails typed in. Use the search box to find one.',
      ]) + (team ? '<p class="small muted">You see changes about your own owner groups.</p>' : '')),
    ]],
    ['Stakeholder surveys', [
      task('forms-create', 'Build a stakeholder survey (like Microsoft Forms)', steps([
        'Open <b>Stakeholder surveys</b> in the top menu.',
        'Under <b>New survey</b>, pick a starting point – <b>RxSolutions quarterly CSAT</b> is the quarterly MS Forms survey, ready to use – type the period (e.g. 2026 Q4) and click <b>Create survey</b>.',
        'Edit the title, introduction and cover image, then each question. Hover between two questions and click <b>+</b> to insert one: rating grid, choice, multiple choice, text, star rating, Net Promoter Score or a section heading.',
        'Use ↑ ↓ (or drag ⋮⋮) to move a question, ⧉ to duplicate and 🗑 to delete. Switch <b>Required</b> on or off per question. Everything saves by itself.',
        'Click <b>Preview</b> to see exactly what people will see.',
      ]) + '<p class="small muted">Global admins see every survey; team admins see the surveys they created.</p>'),
      task('forms-send', 'Send a survey to stakeholders by personal email', steps([
        'Open the survey and click <b>Send</b>.',
        'Under <b>Who should answer?</b>, paste the people – one per line, an email with or without the name (e.g. from Outlook or Excel) – and click <b>Add to the list</b>. Missing names are looked up in HDA.',
        'Check the email subject and message, the close date and reminders, then <b>Save</b>. <b>Preview the email</b> shows the invitation.',
        'Try it with <b>Send a test to me</b> – test answers never count.',
        'Click <b>Send invitations</b>. Everyone gets a personal email (“Hello Phawinee, …”) with their own link, so every answer shows their name.',
      ]) + '<p class="small muted">Only company addresses are accepted. People added later are invited with the same button. <b>Remind now</b> emails everyone who hasn’t answered; automatic reminders follow the setting. <b>Close survey</b> stops answers (you can reopen it).</p>'),
      task('forms-results', 'See who answered and what they said', steps([
        'Open the survey and click <b>Results</b>.',
        'The tiles show responses, response rate, average rating, NPS and time to complete. Below, every question has its chart – coloured bars per row for rating grids, the NPS gauge, and all comments with the person’s name.',
        'Under <b>Respondents</b>, click <b>View answers</b> to read one person’s full response (Previous / Next to move between them).',
        'Click <b>Download for Excel</b> for one row per person, like the MS Forms export.',
      ])),
      task('forms-report', 'Send survey results to your manager or stakeholders', steps([
        'Open <b>Reports</b> → <b>Stakeholder survey</b> (or click <b>Send results report</b> on the survey’s Results page).',
        'Pick the survey – every survey is listed, so earlier quarters can be sent again.',
        'Leave <b>Include respondent names</b> off unless the readers should see who said what. Tick <b>Attach the answers as an Excel file</b> only if they need the raw answers.',
        'Click <b>Download PDF</b>, or type the recipients (and a message) and click <b>Send report now</b>. The email shows the main figures and charts; the PDF is attached.',
      ]) + '<p class="small muted">To send the results automatically when a survey closes, switch on <b>Results report when the survey closes</b> on its Send page. It is off unless you switch it on, and moving the close date later never sends anything.</p>'),
      task('forms-next-quarter', 'Run the same survey again next quarter', steps([
        'Open <b>Stakeholder surveys</b> and click <b>Duplicate</b> next to last quarter’s survey.',
        'The copy is a new draft with the same questions and recipients, and the period in the title moves on (2026 Q4 → 2027 Q1). Check it, then send it.',
      ])),
    ]],
    ['Fixing problems', [
      task('find-ticket', 'Find out what happened to a ticket', steps([
        'Open <b>Survey log</b> and type the HDA ticket number (for example A3414817L) or the requester’s email, then click <b>Filter</b>.',
        'The <b>Status</b> and <b>Detail</b> columns say whether a survey was sent, answered, expired or skipped – and if skipped, why.',
        'Not listed at all? See <a href="#why-not">Why didn’t a ticket get a survey?</a>',
      ])),
      task('missing-email', 'Send a survey when the requester has no valid email', steps([
        'Open <b>Missing emails</b> → <b>Tickets to send</b>.',
        'Type the right email address next to the ticket and click <b>Send survey</b>. It is used for that survey only.',
        'Or click <b>Dismiss</b> if it shouldn’t get a survey (e.g. a shared account).',
      ])),
      task('contacts-csv', 'Get HDA contacts with a wrong email corrected', steps([
        'Open <b>Missing emails</b> → <b>Contacts to fix</b>.',
        'Click <b>Download for Excel</b> and send the file to the HDA team so they can correct the contacts in HDA.',
      ])),
      task('test-survey', 'See what a survey looks like, or send yourself a test', steps([
        'Open <b>Test survey</b>.',
        'Type an HDA ticket number and click <b>Show preview</b>, or leave it empty for a sample ticket.',
        'Type your email under <b>Send a test</b> and click <b>Send test survey</b>. You can answer it like a real one.',
      ]) + '<p class="small muted">Test surveys are marked “test” in the Survey log and never count in the dashboard or reports.</p>'),
    ]],
    ['Global admins', [
      task('team-access', 'Let someone manage a group they aren’t a member of in HDA', steps([
        'Open <b>Admin settings</b> → <b>Team access</b>.',
        'Type their HDA username or email, choose the owner group and click <b>Add</b>.',
        'To take it away, click <b>Remove</b> next to the entry.',
      ]) + '<p class="small muted">Normally access follows HDA: people manage the groups they belong to on the HDA Groups/Operators page.</p>', { globalOnly: true }),
      task('view-as', 'See CSAT Pulse the way a team admin sees it', steps([
        'Open <b>Admin settings</b> → <b>Team access</b> → <b>View as</b>.',
        'Type their HDA username (e.g. reuben.dsouza) and click <b>View as</b>. A yellow bar shows you are viewing as them.',
        'Click <b>Back to global admin</b> in the yellow bar when done.',
      ]), { globalOnly: true }),
      task('sync', 'Bring in new owner groups from HDA', steps([
        'Open <b>Admin settings</b> → <b>Owner groups</b> and click <b>Sync from HDA now</b>.',
        'New groups appear switched off. This also happens automatically once a day.',
      ]), { globalOnly: true }),
      task('stop-all', 'Stop all surveys at once', steps([
        'To pause everything: <b>Admin settings</b> → <b>Default send rules</b>, untick the master switch and click <b>Save rules</b>.',
        'To switch every group off for good: <b>Owner groups</b> → <b>Switch all off</b>. Groups then have to be switched on again one by one.',
      ]), { globalOnly: true }),
    ]],
  ];
}

const WHY_NOT = [
  ['Not in the Survey log at all', 'HDA hasn’t marked the ticket <b>Solved</b> yet, it isn’t an Incident or Request, or it was solved before CSAT Pulse started. CSAT Pulse checks HDA every {poll} minutes, so wait a few minutes after solving.'],
  ['Owner group not enabled', 'The ticket’s owner group is switched off. Switch it on in the owner group list (see <a href="#switch-on">how</a>).'],
  ['Ticket source not enabled', 'The ticket came in through a source that is switched off, for the group or by default. Check <b>Sources &amp; rules</b> for the group.'],
  ['Ticket type not enabled', 'Incidents or Requests are switched off for this group or by default.'],
  ['Requester already surveyed in the last … days', 'The person had a survey recently. This limit stops people getting too many surveys. It can be changed per group.'],
  ['No valid requester email', 'The HDA contact has no usable email. Send it from <b>Missing emails</b> and get the contact fixed in HDA.'],
  ['Requester matches exclusion / Ticket owner excluded', 'The requester or ticket owner is on a “skip” list in <b>Default send rules</b> (e.g. service accounts or bots).'],
  ['Surveys are switched off globally', 'The master switch is off, so nothing is sent.'],
  ['Status “pending”', 'The survey is waiting for the send delay. The Detail column says when it will go out.'],
  ['Status “failed”', 'The email couldn’t be sent. It is retried automatically; the Detail column shows the error.'],
];

const GLOSSARY = [
  ['CSAT %', 'Share of answers that scored 4 or 5 (Satisfied or Very satisfied), out of all answers.'],
  ['Average score', 'The average of all 1–5 ratings.'],
  ['Response rate', 'Answers divided by surveys sent.'],
  ['Surveys sent', 'Surveys delivered in the period (sent, answered or expired). Skipped tickets and test surveys are not counted.'],
  ['Low score', 'A rating of 1 or 2. It goes into the follow-up queue and, if a group lead is set, they get an email.'],
  ['Time to respond', 'Median time between the survey email and the answer.'],
  ['–*', 'CSAT % hidden because there are fewer than 5 answers – one score would swing it too much.'],
  ['pending', 'Waiting to be sent (send delay).'],
  ['sent', 'Emailed, not answered yet.'],
  ['answered', 'The person rated the ticket.'],
  ['expired', 'Not answered before the link expired.'],
  ['skipped', 'No survey, for the reason in the Detail column.'],
  ['failed', 'The email couldn’t be delivered; retried automatically.'],
  ['Global admin', 'Sets the defaults for everyone, gives extra access and sees all owner groups.'],
  ['Team admin', 'Anyone else who signs in. Manages only their own owner groups (from HDA), including their sources, rules, reports and follow-ups.'],
];

function faq(ctx) {
  const s = ctx.settings;
  return [
    ['Who can see what?', 'Global admins see every owner group. Team admins see only the groups they belong to in HDA (plus any extra a global admin gave them) – on every page, including the dashboard, Survey log, Missing emails and Reports.'],
    ['What does the person who raised the ticket see?', 'One short email with the ticket ID, date, subject, solution and ticket owner, a 1–5 rating and an optional comment. The public <a href="/about-survey">About this survey</a> page explains why they got it and how answers are used.'],
    ['Can someone get lots of surveys?', `No. Each ticket gets at most one survey, and each person at most one every ${s.throttleDays || 0} days by default${s.throttleDays ? '' : ' (no limit is set)'}. A ticket that is reopened and solved again isn’t surveyed twice.`],
    ['When is the survey sent?', `CSAT Pulse checks HDA every ${config.scheduler.pollMinutes} minutes for tickets marked Solved, then waits the send delay. ${s.reminderDays ? `One reminder follows after ${s.reminderDays} days if there’s no answer.` : ''} The link expires after ${s.expiryDays} days.`],
    ['Where do the numbers come from?', 'From the surveys and answers stored in CSAT Pulse. The dashboard and the PDF reports use exactly the same calculations, so they always match. Test surveys are left out everywhere.'],
    ['Are comments anonymous?', 'Admins of the owner group can see the comment with the ticket, so they can follow up. Reports never include the requester’s name; agent names appear only in custom reports.'],
    ['What if the person says their issue isn’t fixed?', 'A survey answer doesn’t reopen the ticket by itself. The survey email and the <a href="/about-survey">About this survey</a> page tell people to reopen the ticket in the IT portal or contact the Service Desk team. If a comment says the issue isn’t fixed, reopen or follow up the ticket in HDA, and use the <a href="#follow-up">low-score follow-up queue</a> to track it.'],
    ['What if CSAT Pulse can’t sign in to HDA?', 'If HDA rejects the username or password (for example after an AD password change), CSAT Pulse stops trying straight away so the account isn’t locked, and global admins see a red bar at the top of every page. Update HDA_PASSWORD in the .env file and restart the app, or click <b>Try again</b>. If HDA simply can’t be reached (off VPN, HDA down), it keeps retrying by itself and catches up afterwards.'],
    ['Is anything switched on automatically?', 'No. New owner groups and sources from HDA arrive switched off. Only an admin switches a group on, one at a time.'],
  ];
}

// "How it's built": the platform, with live details that are safe to show (no host names, accounts or passwords).
function TECH() {
  const mail = { smtp: 'SMTP through the company mail relay', graph: 'Microsoft Graph (Microsoft 365)', file: 'Test mode – emails are saved to a folder, not sent' }[config.mail.transport] || config.mail.transport;
  const signIn = config.admin.authMode === 'oidc' ? 'Company single sign-on (OpenID Connect)' : config.admin.authMode === 'easyauth' ? 'Microsoft Entra ID via Azure App Service' : 'Username and password (company sign-on once IAM has registered the app)';
  const hdaAuth = { login: 'HDA user sign-in', apikey: 'HDA API key', trusted: 'HDA trusted application' }[config.hda.authMode] || config.hda.authMode;
  return [
    ['Main program', '<b>Node.js</b>, written in JavaScript', `Node.js ${esc(process.version)}`],
    ['Database', '<b>PostgreSQL</b> – surveys, answers, settings, reports and change history', 'Docker on the current machine; Azure Database for PostgreSQL suggested for go-live'],
    ['Web pages', 'Node.js’s built-in web server, no web framework; pages built on the server as HTML, CSS and a little JavaScript', 'Light and dark mode; follows “reduce motion”'],
    ['Dashboard charts &amp; PDF reports', 'Written for CSAT Pulse itself – no chart or PDF library', 'PDFs in A4, Helvetica'],
    ['Email', 'SMTP or Microsoft Graph, using <span class="mono">nodemailer</span>', esc(mail)],
    ['HDA connection', 'HDA REST API (sign-in, ticket, group, source and membership lookups)', `${esc(hdaAuth)} · checked every ${config.scheduler.pollMinutes} minutes`],
    ['Admin sign-in', 'Company single sign-on with OpenID Connect (Microsoft Entra ID or another IAM provider), or a username and password', esc(signIn)],
  ];
}

// ---------- admin help page ----------
// Simple line icons (24×24, stroke = currentColor).
const ICONS = {
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6',
  beaker: 'M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0', history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  arrow: 'M5 12h14M13 6l6 6-6 6', chevron: 'M9 6l6 6-6 6', grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', question: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01', book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  layers: 'M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5', globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20', wrench: 'M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L4 12l8-8z',
};
const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
const GROUP_ICONS = { 'Setting up surveys': 'sliders', Results: 'chart', 'Stakeholder surveys': 'list', 'Fixing problems': 'wrench', 'Global admins': 'shield' };

// forId: the guide for the page the person came from (menu Help link) – suggested at the top, without jumping down to it.
function helpPage(admin, { settings, defaultSources, layout, forId = '' }) {
  const team = admin && admin.role === 'team';
  const ctx = { team, settings };
  const sections = tasks(ctx).map(([title, list]) => [title, list.filter(t => !team || !t.globalOnly)]).filter(([, list]) => list.length);
  const rules = esc(describeRules(settings, defaultSources));
  const excl = describeExclusions(settings);
  const suggest = sections.flatMap(([, list]) => list).find(t => t.id === forId);
  const s = config.support;
  const initials = (s.name || 'CSAT').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const toc = [['about', 'About CSAT Pulse', 'info'], ['features', 'Features', 'grid'], ['how', 'How do I…?', 'book'], ['why-not', 'Why no survey?', 'alert'],
    ['glossary', 'Glossary', 'list'], ['faq', 'Questions', 'question'], ['new', 'What’s new', 'sparkle'], ['tech', 'How it’s built', 'layers'], ['contact', 'Contact', 'mail']];
  const popular = [['switch-on', 'Switch on a group'], ['report-download', 'Download a report'], ['report-schedule', 'Schedule a report'], ['missing-email', 'Fix a missing email'], ['why-not', 'Why no survey?']];

  const features = [
    ['chart', 'Dashboard', '/admin', 'CSAT %, average score, response rate and trends, broken down by group, source, ticket owner, type, priority and category – plus the follow-up queue and latest comments.'],
    ['sliders', team ? 'My groups' : 'Admin settings', '/admin/settings', team ? 'Switch surveys on or off for your owner groups, set the group lead and see the change history.'
      : 'Switch owner groups and sources on or off, set the default send rules and give team access.'],
    ['list', 'Sources & rules', '/admin/settings', 'Per owner group: which sources and ticket types get surveys, timing, reminders, expiry and the low-score alert level.'],
    ['list', 'Stakeholder surveys', '/admin/forms', 'Build surveys like Microsoft Forms, send a personal link to each stakeholder, and see every named answer, chart and NPS.'],
    ['file', 'Reports', '/admin/reports', 'PDF reports for stakeholders – download, email now, or schedule weekly, monthly or quarterly.'],
    ['search', 'Survey log', '/admin/surveys', 'Every solved ticket CSAT Pulse checked: sent, answered, expired or skipped – and why.'],
    ['mail', 'Missing emails', '/admin/missing', 'Type the address for tickets whose HDA contact has no valid email, or download the list for the HDA team.'],
    ['beaker', 'Test survey', '/admin/test', 'Preview the survey email for any ticket and send yourself a working test. Tests never count.'],
    ['bell', 'Low-score alerts', '/admin#followups', 'A low score emails the group lead and joins the follow-up queue until it’s resolved.'],
    ['history', 'Change history', '/admin/settings?tab=history', 'Every change in plain words: who did what, and when.'],
    ...(team ? [] : [['users', 'Team access & View as', '/admin/settings?tab=access', 'Give someone extra groups, and see the site exactly as a team admin would.']]),
    ['globe', 'About this survey', '/about-survey', 'The public page for people who receive surveys, linked from every survey email.'],
  ];

  const flow = [
    ['Solved in HDA', 'An agent marks an <b>Incident</b> or <b>Request</b> as <b>Solved</b>.'],
    ['Checked', `Every ${config.scheduler.pollMinutes} minutes CSAT Pulse picks up newly solved tickets.`],
    ['Rules applied', 'Group and source switched on? Right ticket type? Not surveyed recently? Valid email?'],
    ['Email sent', 'After the send delay: ticket details, a 1–5 rating and a comment box.'],
    ['Answered', 'One click to rate, optional comment. One reminder; the link expires.'],
    ['Results', 'On the Dashboard straight away. Low scores alert the group lead.'],
  ];

  const body = `<section class="help">
  <header class="help-hero">
    <div class="help-hero-in">
      <div class="eyebrow">Help centre</div>
      <h1>How can we help?</h1>
      <p>What CSAT Pulse does, what each page is for, and step-by-step guides${team ? ' for team admins' : ''}.</p>
      <div class="help-searchwrap"><label class="help-searchbox">${icon('search')}<input type="search" id="help-search" placeholder="Search help – e.g. switch on a group, schedule a report" aria-label="Search help" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="help-results" aria-autocomplete="list"><kbd>/</kbd></label>
        <div class="help-results" id="help-results" role="listbox" hidden></div></div>
      <div class="help-chips"><span>Popular:</span>${popular.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</div>
    </div>
    ${suggest ? `<a class="help-suggest" href="#${suggest.id}">${icon('book', 'ico hs-ico')}<span><span class="hs-label">Help for the page you were on</span><b>${esc(suggest.title)}</b></span>${icon('arrow')}</a>` : ''}
  </header>

  <div class="help-grid">
  <nav class="help-toc" aria-label="Help contents"><div class="help-toc-title">On this page</div>
    <ol>${toc.map(([id, t, ic]) => `<li><a href="#${id}" data-toc="${id}">${icon(ic)}<span>${t}</span></a></li>`).join('')}</ol></nav>
  <div class="help-main">

  <section class="help-sec" id="about" data-search>
    <div class="sec-head">${icon('info', 'ico sec-ico')}<div><h2>About CSAT Pulse</h2>
      <p class="sec-sub">Quick feedback after ${esc(config.brand.company)} ${esc(config.brand.unit)} solves an HDA ticket – so teams see what works and follow up when something didn’t.</p></div></div>
    <h3>How a survey happens</h3>
    <ol class="flow">${flow.map(([t, d], i) => `<li><span class="flow-n">${i + 1}</span><b>${t}</b><span>${d}</span></li>`).join('')}</ol>
    <div class="callout">${icon('sliders', 'ico callout-ico')}<div><div class="callout-title">Right now, by default</div><p>${rules}</p>
      ${excl ? `<p class="small muted">${esc(excl)}</p>` : ''}
      <p class="small muted">${settings.surveyEnabled ? '<span class="dot on"></span>Master switch on' : '<span class="dot off"></span><b>Master switch off – no surveys are sent</b>'} · Groups can have their own sources and rules · CSAT target ${settings.csatTarget}%</p></div></div>
    <h3>Who does what</h3>
    <div class="roles">
      <div class="role${team ? '' : ' me'}">${icon('shield', 'ico role-ico')}<div><b>Global admin</b>${team ? '' : ' <span class="pill neutral">You</span>'}<p>Sets the defaults for everyone, gives extra access and sees all owner groups.</p></div></div>
      <div class="role${team ? ' me' : ''}">${icon('user', 'ico role-ico')}<div><b>Team admin</b>${team ? ' <span class="pill neutral">You</span>' : ''}<p>Anyone else who signs in. Manages only the owner groups they belong to in HDA – switching them on, sources and rules, follow-ups and reports.</p></div></div>
    </div>
  </section>

  <section class="help-sec" id="features" data-search>
    <div class="sec-head">${icon('grid', 'ico sec-ico')}<div><h2>Features</h2><p class="sec-sub">Everything CSAT Pulse can do. Click a card to open it.</p></div></div>
    <div class="feature-grid">${features.map(([ic, name, href, text]) => `<a class="feature" href="${href}" data-kind="Feature" data-title="${esc(name)}">
      <span class="feature-ico">${icon(ic)}</span><span class="feature-name">${esc(name)}</span><span class="feature-text">${esc(text)}</span>
      <span class="feature-go">Open ${icon('arrow')}</span></a>`).join('')}</div>
  </section>

  <section class="help-sec" id="how">
    <div class="sec-head">${icon('book', 'ico sec-ico')}<div><h2>How do I…?</h2><p class="sec-sub">Click a question to see the steps. Buttons are named exactly as they appear.</p></div></div>
    ${sections.map(([title, list]) => `<div class="howto-group"><h3>${icon(GROUP_ICONS[title] || 'book')}${esc(title)}</h3>
      ${list.map(t => `<details class="howto" id="${t.id}" data-search data-kind="${esc(title)}" data-title="${esc(t.title)}" data-keys="${esc(t.keys)}"><summary><span>${esc(t.title)}</span>${t.globalOnly ? pill('Global admins') : ''}${icon('chevron', 'ico chev')}</summary><div class="howto-body">${t.body}</div></details>`).join('')}</div>`).join('')}
  </section>

  <section class="help-sec" id="why-not" data-search data-nobody data-kind="Section" data-title="Why didn’t a ticket get a survey?" data-keys="why no survey not received didn't get missing survey not sent skipped reason">
    <div class="sec-head">${icon('alert', 'ico sec-ico')}<div><h2>Why didn’t a ticket get a survey?</h2>
      <p class="sec-sub">Look the ticket up in the <a href="/admin/surveys">Survey log</a> – the <b>Detail</b> column gives one of these reasons.</p></div></div>
    <div class="reasons">${WHY_NOT.map(([k, v], i) => `<div class="reason" id="reason-${i + 1}" data-kind="Why no survey?" data-title="${esc(k)}" data-keys="not received didn't get no survey missing"><div class="reason-k">${esc(k)}</div><div class="reason-v">${v.replace('{poll}', config.scheduler.pollMinutes)}</div></div>`).join('')}</div>
  </section>

  <section class="help-sec" id="glossary" data-search>
    <div class="sec-head">${icon('list', 'ico sec-ico')}<div><h2>Glossary</h2><p class="sec-sub">What the numbers, statuses and roles mean.</p></div></div>
    <dl class="terms">${GLOSSARY.map(([k, v], i) => `<div class="term" id="term-${i + 1}" data-kind="Glossary" data-title="${esc(k)}" data-keys="meaning definition what is"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  </section>

  <section class="help-sec" id="faq" data-search>
    <div class="sec-head">${icon('question', 'ico sec-ico')}<div><h2>Questions</h2></div></div>
    ${faq(ctx).map(([q, a], i) => `<details class="howto" id="faq-${i + 1}" data-search data-kind="Questions" data-title="${esc(q)}"><summary><span>${esc(q)}</span>${icon('chevron', 'ico chev')}</summary><div class="howto-body"><p>${a}</p></div></details>`).join('')}
  </section>

  <section class="help-sec" id="new" data-search>
    <div class="sec-head">${icon('sparkle', 'ico sec-ico')}<div><h2>What’s new</h2></div></div>
    <ol class="timeline">${WHATS_NEW.map(([date, items]) => `<li><div class="tl-date">${esc(date)}</div><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></li>`).join('')}</ol>
  </section>

  <section class="help-sec" id="tech" data-search data-nobody data-kind="Section" data-title="How CSAT Pulse is built" data-keys="technology platform built stack node nodejs postgresql postgres database docker azure hosting smtp graph email entra sign in architecture libraries">
    <div class="sec-head">${icon('layers', 'ico sec-ico')}<div><h2>How CSAT Pulse is built</h2>
      <p class="sec-sub">A small, self-contained web application made from standard building blocks, with very few outside parts.</p></div></div>
    <div class="tw"><table class="tech"><thead><tr><th>Part</th><th>Built on</th><th>Right now</th></tr></thead><tbody>
      ${TECH(admin).map(([part, on, now]) => `<tr><td class="b">${part}</td><td>${on}</td><td class="small muted">${now}</td></tr>`).join('')}
    </tbody></table></div>
    <h3>Why it’s built this way</h3>
    <div class="roles">
      <div class="role">${icon('shield', 'ico role-ico')}<div><b>Easy to approve</b><p>Only two outside libraries – <span class="mono">pg</span> (database) and <span class="mono">nodemailer</span> (email) – so IT security has almost nothing third-party to review.</p></div></div>
      <div class="role">${icon('globe', 'ico role-ico')}<div><b>Easy to host</b><p>Runs anywhere Node.js and PostgreSQL run: a company server, a Docker container (a Dockerfile is included) or Azure App Service with Azure Database for PostgreSQL.</p></div></div>
      <div class="role">${icon('wrench', 'ico role-ico')}<div><b>Easy to look after</b><p>Few moving parts and nothing that needs frequent updates. Charts and PDF reports are drawn by CSAT Pulse itself, without extra libraries.</p></div></div>
    </div>
    <p class="small muted">The code is kept in a private GitHub repository. HDA field names live in one settings file (config/hda-mapping.json), so a change in HDA rarely needs a code change.</p>
  </section>

  <section class="help-sec" id="contact" data-search>
    <div class="contact-card"><span class="avatar" aria-hidden="true">${esc(initials)}</span>
      <div class="grow"><div class="eyebrow">Product owner</div><div class="contact-name">${esc(s.name || 'CSAT Pulse global admin')}</div>
        <p class="sec-sub">Questions, ideas, or need access to an owner group? Get in touch. For a problem with a ticket itself, use HDA as usual.</p></div>
      ${s.email ? `<a class="btn" href="mailto:${esc(s.email)}?subject=${encodeURIComponent(config.brand.product)}">${icon('mail')} Email ${esc((s.name || '').split(' ')[0] || 'us')}</a>` : ''}</div>
  </section>
  </div></div></section>`;
  return layout({ title: 'About & help', body, admin, active: 'help', scripts: ['/assets/help.js'] });
}

// ---------- public page for survey recipients ----------
function aboutSurveyPage({ settings, layout }) {
  const s = settings;
  const body = `<div class="mail about-survey">
    <div class="mail-head"><div class="h">About this survey</div><div class="sub">${esc(config.brand.company)} ${esc(config.brand.unit)} · ${esc(config.brand.product)}</div></div>
    <div class="mail-body">
      <h2>Why did I get this email?</h2>
      <p>You raised a ticket with ${esc(config.brand.company)} ${esc(config.brand.unit)} and it has been solved. After a ticket is solved we ask the person who raised it how it went, so we can see what works and fix what doesn’t.</p>
      <h2>What do you ask?</h2>
      <p>One question: how satisfied you are with how the ticket was handled, from 1 (very dissatisfied) to 5 (very satisfied). You can add a comment if you like. It takes about 10 seconds.</p>
      <h2>How is my answer used?</h2>
      <ul><li>It goes to the IT team that handled your ticket and to IT managers, to improve the service.</li>
        <li>If you give a low score, the team lead may contact you to put things right.</li>
        <li>Reports shared with managers show totals and comments, never your name.</li>
        <li>Your answer is not shared outside ${esc(config.brand.company)}.</li></ul>
      <h2>How often will I be asked?</h2>
      <p>At most once per ticket${s.throttleDays ? `, and no more than once every ${s.throttleDays} days` : ''}. ${s.reminderDays ? `If you don’t answer, you get one reminder after ${s.reminderDays} days. ` : ''}The link expires after ${s.expiryDays} days. Answering is optional.</p>
      <h2>My issue isn’t actually fixed</h2>
      <p>Reopen the ticket in the IT portal or contact the Service Desk team. A survey answer doesn’t reopen the ticket by itself.</p>
      <h2>Is this email genuine?</h2>
      <p>Survey emails come from <b>${esc(config.mail.from)}</b> and the link opens <b>${esc(config.publicBaseUrl.replace(/^https?:\/\//, ''))}</b>. We will never ask for your password or personal details in a survey.</p>
      <h2>Questions about the survey</h2>
      <p>Contact ${contact()}.</p>
    </div></div>`;
  return layout({ title: 'About this survey', body });
}

module.exports = { helpPage, aboutSurveyPage, WHATS_NEW };
