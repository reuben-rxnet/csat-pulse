'use strict';
// Pages for stakeholder surveys: list, builder, send, results, one response, and the answer page people see.
const config = require('../config');
const { esc } = require('../mail/templates');
const { layout, messagePage } = require('./views');
const { TEMPLATES, currentPeriod } = require('../forms/templates');
const { numbering, duration, npsGroup } = require('../forms/model');

const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtDateTime = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const pct = (v, d = 0) => (v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d) + '%');
const nl2br = s => esc(s).replace(/\n/g, '<br>');
const STATUS = { draft: ['muted', 'Draft'], open: ['good', 'Open'], closed: ['neutral', 'Closed'] };
const statusPill = f => { const [k, t] = STATUS[f.status] || STATUS.draft; return `<span class="pill ${k}">${t}</span>`; };
// Colours for an answer scale of any length, from "very negative" (l1) to "very positive" (l5).
const scaleColor = (i, k) => `var(--l${1 + Math.round((i * 4) / Math.max(1, k - 1))})`;
const TYPE_LABEL = { section: 'Section', likert: 'Rating grid', rating: 'Star rating', choice: 'Choice', checkbox: 'Multiple choice', text: 'Text', nps: 'Net Promoter Score' };

function tabs(form, active) {
  const t = [['edit', 'Questions', `/admin/forms/${form.id}`], ['send', 'Send', `/admin/forms/${form.id}/send`], ['results', 'Results', `/admin/forms/${form.id}/results`]];
  return `<div class="fhead"><div class="fhead-l"><a class="back" href="/admin/forms">← All surveys</a><h1>${esc(form.title)}</h1>
      <div class="small muted">${statusPill(form)} ${form.closes_at ? `· closes ${esc(fmtDateTime(form.closes_at))}` : ''} · by ${esc(form.owner_login)}</div></div>
    <div class="fhead-r"><div class="seg tabs" role="tablist">${t.map(([k, label, href]) => `<a role="tab" class="tab" href="${href}" aria-selected="${k === active}">${label}</a>`).join('')}</div>
      <a class="btn ghost" href="/admin/forms/${form.id}/preview" target="_blank" rel="noopener">Preview</a></div></div>`;
}
const flash = (notice, error) => `${notice ? `<p class="ok" role="status">${esc(notice)}</p>` : ''}${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}`;

// ---------- list ----------
function listPage(admin, { forms, notice, error }) {
  const team = admin.role === 'team';
  const rows = forms.map(f => {
    const rate = f.invited ? f.responses / f.invited : 0;
    return `<div class="fcard">
      <div class="fcard-main"><a class="fcard-title" href="/admin/forms/${f.id}${f.status === 'draft' ? '' : '/results'}">${esc(f.title)}</a>
        <div class="small muted">${statusPill(f)} · ${f.items} item${f.items === 1 ? '' : 's'} · ${f.recipients} recipient${f.recipients === 1 ? '' : 's'}${f.closes_at ? ` · closes ${esc(fmtDate(f.closes_at))}` : ''} · updated ${esc(fmtDate(f.updated_at))}${team ? '' : ` · by ${esc(f.owner_login)}`}</div></div>
      <div class="fcard-rate" title="${f.responses} of ${f.invited} invited people answered"><b>${f.responses}</b><span>/ ${f.invited} answered</span><div class="track"><div class="fill" style="width:${Math.round(rate * 100)}%"></div></div></div>
      <div class="fcard-actions"><a class="btn ghost" href="/admin/forms/${f.id}">Edit</a><a class="btn ghost" href="/admin/forms/${f.id}/send">Send</a><a class="btn ghost" href="/admin/forms/${f.id}/results">Results</a>
        <form method="post" action="/admin/forms/${f.id}/duplicate"><button class="btn ghost" type="submit" title="Copy questions and recipients into a new draft (next quarter)">Duplicate</button></form>
        <form method="post" action="/admin/forms/${f.id}/delete" data-confirm="Delete &quot;${esc(f.title)}&quot;${f.responses ? ` and its ${f.responses} response${f.responses === 1 ? '' : 's'}` : ''}? This can't be undone."><button class="btn ghost danger" type="submit">Delete</button></form></div>
    </div>`;
  }).join('');
  const body = `<section class="panel">
    <div><div class="eyebrow">${team ? 'Team admin' : 'Admin'}</div><h1>Stakeholder surveys</h1>
      <p class="lead">Build a survey, send a personal link to each stakeholder, and see every named answer – like Microsoft Forms, inside CSAT Pulse.${team ? ' You see the surveys you created.' : ''}</p></div>
    ${flash(notice, error)}
    <form class="card newform" method="post" action="/admin/forms">
      <div class="ch"><h3>New survey</h3><label class="small">Period <input name="period" value="${esc(currentPeriod())}" maxlength="40" aria-label="Period used in the title"></label></div>
      <div class="tpl-grid">${TEMPLATES.map((t, i) => `<label class="tpl"><input type="radio" name="template" value="${t.key}" ${i === 0 ? 'checked' : ''}><span><b>${esc(t.name)}</b><small>${esc(t.summary)}</small></span></label>`).join('')}</div>
      <button class="btn" type="submit">Create survey</button>
    </form>
    <div class="card"><div class="ch"><h3>Your surveys</h3><span class="small muted">${forms.length} survey${forms.length === 1 ? '' : 's'}</span></div>
      ${rows || '<p class="muted">No surveys yet. Create one above – the RxSolutions template is your quarterly MS Forms survey, ready to send.</p>'}</div>
  </section>`;
  return layout({ title: 'Stakeholder surveys', body, admin, active: 'forms', scripts: ['/assets/forms.js'], help: 'forms-create' });
}

// ---------- builder ----------
function editPage(admin, { form, responses, notice, error }) {
  const data = { id: form.id, title: form.title, description: form.description, coverImage: form.cover_image || null, closesAt: form.closes_at, settings: form.settings, questions: form.questions, responses };
  const body = `<section class="panel">${tabs(form, 'edit')}${flash(notice, error)}
    ${responses ? `<p class="warnbox">${responses} ${responses === 1 ? 'person has' : 'people have'} already answered. You can still edit; removing a question or option hides its answers from the results.</p>` : ''}
    <div id="builder" class="builder" aria-live="polite"><p class="muted">Loading the editor…</p></div>
    <script type="application/json" id="form-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
  </section>`;
  return layout({ title: `Edit · ${form.title}`, body, admin, active: 'forms', scripts: ['/assets/forms-builder.js'], help: 'forms-create' });
}

// ---------- send ----------
function recipientStatus(r) {
  if (r.submitted_at) return `<span class="pill good">Answered</span><div class="small muted">${esc(fmtDateTime(r.submitted_at))}</div>`;
  if (r.invite_status === 'failed') return `<span class="pill bad" title="${esc(r.send_error || '')}">Not delivered</span>`;
  if (r.invite_status !== 'sent') return '<span class="pill muted">Not invited yet</span>';
  const extra = r.response_id ? 'In progress' : r.opened_at ? 'Opened' : 'Invited';
  return `<span class="pill neutral">${extra}</span><div class="small muted">${esc(fmtDate(r.invited_at))}${r.reminders_sent ? ` · ${r.reminders_sent} reminder${r.reminders_sent === 1 ? '' : 's'}` : ''}</div>`;
}
function sendPage(admin, { form, recipients: all, domains, notice, error, testTo }) {
  const recipients = all.filter(r => !r.is_test), tests = all.filter(r => r.is_test);
  const ro = form.settings.reportOnClose || {};
  const s = form.settings, pending = recipients.filter(r => r.invite_status !== 'sent').length;
  const waiting = recipients.filter(r => r.invite_status === 'sent' && !r.submitted_at).length;
  const local = form.closes_at ? new Date(new Date(form.closes_at).getTime() - new Date(form.closes_at).getTimezoneOffset() * 60e3).toISOString().slice(0, 16) : '';
  const body = `<section class="panel">${tabs(form, 'send')}${flash(notice, error)}
  <div class="grid g2 send-grid">
    <div class="card rules">
      <h3>1. Who should answer?</h3>
      <form method="post" action="/admin/forms/${form.id}/recipients" class="rules">
        <div class="field"><label for="rec">Add people <span class="muted">(one per line)</span></label>
          <textarea id="rec" name="people" rows="5" placeholder="phawinee.singto@essilor.com&#10;Raghavendra M &lt;raghavmr@essilor.in&gt;&#10;holly.qiu@luxottica.com, Holly Qiu"></textarea>
          <p class="small muted">Paste from Outlook or Excel: an email, optionally with the name. Names are looked up in HDA when missing. ${domains.length ? `Only company addresses (${domains.map(d => '@' + esc(d)).join(', ')}; * = anything, subdomains included).` : ''}</p></div>
        <button class="btn ghost" type="submit">Add to the list</button>
      </form>
    </div>
    <form class="card rules" method="post" action="/admin/forms/${form.id}/settings">
      <h3>2. Invitation and timing</h3>
      <div class="field"><label for="subj">Email subject</label><input id="subj" name="inviteSubject" maxlength="200" value="${esc(s.inviteSubject)}" placeholder="${esc(form.title)}"></div>
      <div class="field"><label for="msg">Message <span class="muted">(after "Hello &lt;first name&gt;,")</span></label>
        <textarea id="msg" name="inviteMessage" rows="4" maxlength="2000" placeholder="We'd really value your feedback. Please take a few minutes to answer our survey.">${esc(s.inviteMessage)}</textarea></div>
      <div class="inline">
        <label class="small">Closes on <input type="datetime-local" name="closesAt" value="${esc(local)}"></label>
        <label class="small">Reminder after <select name="reminderDays">${[0, 2, 3, 5, 7].map(d => `<option value="${d}" ${s.reminderDays === d ? 'selected' : ''}>${d ? `${d} days` : 'no reminder'}</option>`).join('')}</select></label>
        <label class="small">Max. reminders <select name="maxReminders">${[1, 2, 3].map(n => `<option ${s.maxReminders === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <label class="chk"><input type="checkbox" name="allowEdit" value="true" ${s.allowEdit ? 'checked' : ''}> Let people change their answers until the survey closes</label>
      <div class="field"><label for="ty">Thank-you message</label><input id="ty" name="thankYou" maxlength="1000" value="${esc(s.thankYou)}"></div>
      <div class="inline"><button class="btn ghost" type="submit">Save</button> <a class="small" href="/admin/forms/${form.id}/invite-preview" target="_blank" rel="noopener">Preview the email</a></div>
    </form>
  </div>
  <div class="card test-card"><div class="ch"><h3>Try it first</h3><a class="btn ghost" href="/admin/forms/${form.id}/preview" target="_blank" rel="noopener">Preview</a></div>
    <p class="small muted">Send yourself (or a colleague) the real invitation email to check the greeting, the link and answering${form.status === 'draft' ? ' – it works before the survey is opened' : ''}.
      Test answers are marked <span class="pill warn">Test</span> and never count in the results or the Excel export.</p>
    <form class="inline" method="post" action="/admin/forms/${form.id}/test"><input type="email" name="to" required placeholder="you@essilor.com" value="${esc(testTo || '')}" aria-label="Send a test to">
      <button class="btn ghost" type="submit">Send a test to me</button></form>
    ${tests.length ? `<div class="tw mt"><table><tbody>${tests.map(r => `<tr><td><span class="pill warn">Test</span> <span class="small mono">${esc(r.email)}</span></td><td>${recipientStatus(r)}</td>
      <td class="actions">${r.submitted_at ? `<a class="btn ghost" href="/f/${esc(r.token)}?edit=1" target="_blank" rel="noopener">Open test link</a>` : `<a class="btn ghost" href="/f/${esc(r.token)}" target="_blank" rel="noopener">Open test link</a>`}</td></tr>`).join('')}</tbody></table></div>
      <form method="post" action="/admin/forms/${form.id}/tests/clear" data-confirm="Remove all test recipients and their answers?"><button class="btn ghost danger" type="submit">Clear test answers</button></form>` : ''}
  </div>
  <form class="card rules" method="post" action="/admin/forms/${form.id}/report-on-close">
    <div class="ch"><h3>Results report when the survey closes <span class="pill ${ro.enabled ? 'good' : 'muted'}">${ro.enabled ? 'On' : 'Off'}</span></h3>
      ${form.report_sent_at ? `<span class="small muted">Last sent ${esc(fmtDateTime(form.report_sent_at))}</span>` : ''}</div>
    <p class="small muted">Optional. When the survey closes – on its close date or when you click <b>Close survey</b> – the results PDF is emailed with the main figures and charts in the email.
      Moving the close date later never sends anything. You can also send the results any time from <a href="/admin/reports?kind=survey&amp;form=${form.id}">Reports</a>.</p>
    ${form.report_error ? `<p class="err small">The last automatic send failed: ${esc(form.report_error)}</p>` : ''}
    <label class="chk"><input type="checkbox" name="enabled" value="true" ${ro.enabled ? 'checked' : ''}> Email the results when the survey closes</label>
    <div class="field"><label for="ro-to">Send to</label><textarea id="ro-to" name="to_emails" rows="2" placeholder="manager@essilor.com, team.lead@luxottica.com">${esc((ro.recipients || []).join(', '))}</textarea></div>
    <div class="inline"><label class="chk"><input type="checkbox" name="names" value="true" ${ro.names ? 'checked' : ''}> Include respondent names</label>
      <label class="chk"><input type="checkbox" name="excel" value="true" ${ro.excel ? 'checked' : ''}> Attach Excel</label></div>
    <button class="btn ghost" type="submit">Save</button>
  </form>
  <div class="card">
    <div class="ch"><h3>3. Recipients <span class="pill neutral">${recipients.length}</span></h3>
      <div class="inline">
        ${form.status !== 'closed' ? `<form method="post" action="/admin/forms/${form.id}/invite" data-confirm="Send a personal invitation to ${pending} ${pending === 1 ? 'person' : 'people'} now?"><button class="btn" type="submit" ${pending ? '' : 'disabled'}>Send invitations (${pending})</button></form>` : ''}
        ${form.status === 'open' ? `<form method="post" action="/admin/forms/${form.id}/remind" data-confirm="Send a reminder to the ${waiting} ${waiting === 1 ? 'person who hasn’t' : 'people who haven’t'} answered yet?"><button class="btn ghost" type="submit" ${waiting ? '' : 'disabled'}>Remind now (${waiting})</button></form>` : ''}
        ${form.status === 'open' ? `<form method="post" action="/admin/forms/${form.id}/status" data-confirm="Close the survey? Nobody can answer after this (you can reopen it)."><input type="hidden" name="status" value="closed"><button class="btn ghost" type="submit">Close survey</button></form>` : ''}
        ${form.status === 'closed' ? `<form method="post" action="/admin/forms/${form.id}/status"><input type="hidden" name="status" value="open"><button class="btn ghost" type="submit">Reopen survey</button></form>` : ''}
      </div></div>
    <p class="small muted">Each person gets their own link, so every answer shows their name. ${s.reminderDays ? `People who haven't answered get a reminder after ${s.reminderDays} days (up to ${s.maxReminders}).` : 'Automatic reminders are off.'}</p>
    <div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>
      ${recipients.map(r => `<tr><td><b>${esc(r.name || '–')}</b>${r.first_name ? `<div class="small muted">Greeting: Hello ${esc(r.first_name)}</div>` : ''}</td><td class="small mono">${esc(r.email)}</td><td>${recipientStatus(r)}</td>
        <td class="actions">${r.submitted_at ? `<a class="btn ghost" href="/admin/forms/${form.id}/responses/${r.response_id}">View answers</a>` : `<form method="post" action="/admin/forms/${form.id}/recipients/${r.id}/remove" data-confirm="Remove ${esc(r.email)} from this survey? Their link stops working."><button class="btn ghost danger" type="submit">Remove</button></form>`}</td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">Nobody yet. Add people above.</td></tr>'}
    </tbody></table></div>
  </div></section>`;
  return layout({ title: `Send · ${form.title}`, body, admin, active: 'forms', scripts: ['/assets/forms.js'], help: 'forms-send' });
}

// ---------- results ----------
function likertCard(s, num) {
  const q = s.q, k = q.scale.length;
  const legend = `<div class="legend">${q.scale.map((l, i) => `<span><i style="background:${scaleColor(i, k)}"></i>${esc(l)}</span>`).join('')}</div>`;
  const rows = s.rows.map(r => `<div class="lk-row"><div class="lk-label">${esc(r.row.label)}${r.row.hint ? `<small>${esc(r.row.hint)}</small>` : ''}</div>
      <div class="lk-bar" role="img" aria-label="${esc(r.row.label)}: ${r.counts.map((c, i) => `${q.scale[i]} ${c}`).join(', ')}">${r.n ? r.counts.map((c, i) => c ? `<span style="flex:${c};background:${scaleColor(i, k)}" title="${esc(q.scale[i])}: ${c} (${pct(c / r.n)})">${c / r.n >= 0.1 ? pct(c / r.n) : ''}</span>` : '').join('') : '<span class="lk-empty">No answers</span>'}</div>
      <div class="lk-stat"><b>${r.avg == null ? '–' : r.avg.toFixed(2)}</b><small>${pct(r.positive)} positive</small></div></div>`).join('');
  return `<div class="lk"><div class="lk-head"><span></span><span></span><span class="small muted">Average (1–${k}) · positive = top two</span></div>${rows}</div>${legend}`;
}
function npsCard(s) {
  const score = s.score ?? 0, a = ((score + 100) / 200) * Math.PI; // 0..π along a half circle
  const x = 100 - 80 * Math.cos(a), y = 100 - 80 * Math.sin(a);
  const bars = s.counts.map((c, i) => `<div class="nps-col ${npsGroup(i)}" title="${i}: ${c}"><span style="height:${s.n ? Math.max(c ? 6 : 0, (c / Math.max(...s.counts)) * 100) : 0}%"></span><small>${i}</small></div>`).join('');
  return `<div class="nps">
    <svg viewBox="0 0 200 118" class="nps-gauge" role="img" aria-label="NPS ${s.score ?? 'no answers'}">
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--line-2)" stroke-width="16" stroke-linecap="round"/>
      <path d="M20 100 A80 80 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${score >= 30 ? 'var(--good)' : score >= 0 ? 'var(--warn)' : 'var(--bad)'}" stroke-width="16" stroke-linecap="round"/>
      <text x="100" y="92" text-anchor="middle" class="nps-v">${s.score == null ? '–' : Math.round(s.score)}</text><text x="100" y="112" text-anchor="middle" class="nps-l">NPS</text>
      <text x="14" y="116" class="nps-l">-100</text><text x="186" y="116" text-anchor="end" class="nps-l">+100</text></svg>
    <div class="nps-mix"><div><b class="good-t">${s.promoters}</b> Promoters <small>(9–10)</small></div><div><b>${s.passives}</b> Passives <small>(7–8)</small></div><div><b class="bad-t">${s.detractors}</b> Detractors <small>(0–6)</small></div></div>
    <div class="nps-dist">${bars}</div>
    <div class="nps-ends small muted"><span>${esc(s.q.low)}</span><span>${esc(s.q.high)}</span></div></div>`;
}
function optionsCard(s) {
  const q = s.q, max = Math.max(1, ...Object.values(s.counts));
  return `<div class="opt">${q.options.map(o => `<div class="opt-row"><span>${esc(o.label)}</span><div class="opt-bar"><div style="width:${(s.counts[o.id] / max) * 100}%"></div></div><b>${s.counts[o.id]}</b><small>${pct(s.n ? s.counts[o.id] / s.n : null)}</small></div>`).join('')}</div>`;
}
function ratingCard(s) {
  const q = s.q, max = Math.max(1, ...s.counts);
  return `<div class="rating-sum"><div class="rating-avg"><b>${s.avg == null ? '–' : s.avg.toFixed(2)}</b><span class="stars" aria-hidden="true">${'★'.repeat(Math.round(s.avg || 0))}<i>${'★'.repeat(q.max - Math.round(s.avg || 0))}</i></span><small>average of ${s.n}</small></div>
    <div class="opt">${s.counts.map((c, i) => ({ c, i })).reverse().map(({ c, i }) => `<div class="opt-row"><span>${i + 1} ★</span><div class="opt-bar"><div style="width:${(c / max) * 100}%"></div></div><b>${c}</b><small></small></div>`).join('')}</div></div>`;
}
function textCard(s) {
  return s.answers.length ? `<div class="answers">${s.answers.map(a => `<figure class="ans"><blockquote>${nl2br(a.text)}</blockquote><figcaption><b>${esc(a.name || a.email)}</b> · ${esc(fmtDate(a.at))}</figcaption></figure>`).join('')}</div>` : '<p class="muted">No answers yet.</p>';
}
function resultsPage(admin, { form, res, prev, next }) {
  const { stats, summary, numbers, recipients } = res;
  const nps = summary.find(s => s.q.type === 'nps' && s.n);
  const likertRows = summary.filter(s => s.q.type === 'likert').flatMap(s => s.rows).filter(r => r.n);
  const overall = likertRows.length ? likertRows.reduce((a, r) => a + r.avg * r.n, 0) / likertRows.reduce((a, r) => a + r.n, 0) : null;
  const tile = (lab, val, sub) => `<div class="kpi"><div class="lab">${lab}</div><div class="kpi-val"><span class="val">${val}</span></div><div class="small muted">${sub}</div></div>`;
  const cards = summary.map(s => {
    if (s.q.type === 'section') return `<h2 class="res-section">${esc(s.q.title)}</h2>`;
    const body = { likert: likertCard, nps: npsCard, choice: optionsCard, checkbox: optionsCard, rating: ratingCard, text: textCard }[s.q.type](s, numbers);
    return `<div class="card res-q"><div class="ch"><h3><span class="qnum">${numbers[s.q.id]}</span>${esc(s.q.title)}</h3><span class="small muted">${s.n} answer${s.n === 1 ? '' : 's'} · ${TYPE_LABEL[s.q.type]}</span></div>${s.q.description ? `<p class="small muted">${nl2br(s.q.description)}</p>` : ''}${body}</div>`;
  }).join('');
  const answered = recipients.filter(r => r.submitted_at);
  const body = `<section class="panel">${tabs(form, 'results')}
    <div class="kpis res-kpis">
      ${tile('Responses', stats.responded, `of ${stats.invited} invited`)}
      ${tile('Response rate', pct(stats.rate), `${stats.opened} opened the link`)}
      ${tile('Average rating', overall == null ? '–' : overall.toFixed(2), 'all rating-grid answers, 1–5')}
      ${tile('NPS', nps ? Math.round(nps.score) : '–', nps ? `${nps.promoters} promoter${nps.promoters === 1 ? '' : 's'} · ${nps.detractors} detractor${nps.detractors === 1 ? '' : 's'}` : 'no NPS answers yet')}
      ${tile('Time to complete', stats.medianSeconds == null ? '–' : duration(stats.medianSeconds), 'median, minutes:seconds')}
    </div>
    <div class="res-actions"><a class="btn" href="/admin/reports?kind=survey&amp;form=${form.id}">Send results report</a><a class="btn ghost" href="/admin/reports/survey.pdf?form=${form.id}">PDF report</a>
      <a class="btn ghost" href="/admin/forms/${form.id}/export.csv">Download for Excel</a><a class="btn ghost" href="#respondents">Who answered (${answered.length})</a>
      <span class="grow"></span>${prev ? `<a class="btn ghost" href="/admin/forms/${prev.id}/results" title="The survey this one was copied from">← ${esc(prev.title)}</a>` : ''}${next ? `<a class="btn ghost" href="/admin/forms/${next.id}/results" title="The copy made from this survey">${esc(next.title)} →</a>` : ''}</div>
    ${stats.responded ? cards : '<div class="card"><p class="muted">No answers yet. Results appear here as soon as the first person submits.</p></div>'}
    <div class="card" id="respondents"><div class="ch"><h3>Respondents</h3><span class="small muted">${answered.length} answered · ${recipients.length - answered.length} not yet</span></div>
      <div class="tw"><table><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Submitted</th><th class="n">Time to complete</th><th></th></tr></thead><tbody>
      ${answered.map((r, i) => `<tr><td class="small muted">${i + 1}</td><td><b>${esc(r.name || '–')}</b></td><td class="small mono">${esc(r.email)}</td><td class="small">${esc(fmtDateTime(r.submitted_at))}</td>
        <td class="n">${duration((new Date(r.submitted_at) - new Date(r.started_at)) / 1000)}</td><td><a class="btn ghost" href="/admin/forms/${form.id}/responses/${r.response_id}">View answers</a></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nobody has answered yet.</td></tr>'}
      </tbody></table></div></div>
  </section>`;
  return layout({ title: `Results · ${form.title}`, body, admin, active: 'forms', help: 'forms-results' });
}

// One person's answers, read-only (with previous / next).
function answerText(q, v) {
  if (v === undefined || v === null || v === '') return '<span class="muted">No answer</span>';
  switch (q.type) {
    case 'likert': return `<table class="ans-grid">${q.rows.map(r => `<tr><td>${esc(r.label)}</td><td>${v[r.id] ? `<span class="pill" style="background:${scaleColor(v[r.id] - 1, q.scale.length)};color:#fff">${esc(q.scale[v[r.id] - 1])}</span>` : '<span class="muted">–</span>'}</td></tr>`).join('')}</table>`;
    case 'rating': return `<span class="stars">${'★'.repeat(v)}<i>${'★'.repeat(q.max - v)}</i></span> ${v} / ${q.max}`;
    case 'nps': return `<b>${v}</b> / 10 <span class="pill ${npsGroup(v) === 'promoter' ? 'good' : npsGroup(v) === 'passive' ? 'muted' : 'bad'}">${npsGroup(v)}</span>`;
    case 'choice': return esc((q.options.find(o => o.id === v) || {}).label || '');
    case 'checkbox': return [].concat(v).map(id => `<span class="pill neutral">${esc((q.options.find(o => o.id === id) || {}).label || '')}</span>`).join(' ');
    default: return nl2br(v);
  }
}
function responsePage(admin, { form, response, prev, next, index, total }) {
  const num = numbering(form.questions);
  const items = form.questions.map(q => q.type === 'section' ? `<h2 class="res-section">${esc(q.title)}</h2>`
    : `<div class="card res-q"><h3><span class="qnum">${num[q.id]}</span>${esc(q.title)}</h3><div class="ans-v">${answerText(q, response.answers[q.id])}</div></div>`).join('');
  const body = `<section class="panel">${tabs(form, 'results')}
    <div class="card resp-head"><div><div class="eyebrow">Response ${index} of ${total}</div><h2>${esc(response.name || response.email)}</h2>
      <div class="small muted">${esc(response.email)} · submitted ${esc(fmtDateTime(response.submitted_at))} · time to complete ${duration((new Date(response.submitted_at) - new Date(response.started_at)) / 1000)}</div></div>
      <div class="inline">${prev ? `<a class="btn ghost" href="/admin/forms/${form.id}/responses/${prev}">← Previous</a>` : ''}${next ? `<a class="btn ghost" href="/admin/forms/${form.id}/responses/${next}">Next →</a>` : ''}<a class="btn ghost" href="/admin/forms/${form.id}/results">Back to results</a></div></div>
    ${items}</section>`;
  return layout({ title: `${response.name || response.email} · ${form.title}`, body, admin, active: 'forms', help: 'forms-results' });
}

// ---------- the answer page stakeholders see ----------
function questionInput(q, v, err, n) {
  const req = q.required ? '<span class="req" aria-label="required">*</span>' : '';
  const head = `<div class="fq-head"><span class="qnum">${n}</span><div><div class="fq-title">${esc(q.title)} ${req}</div>${q.description ? `<div class="small muted">${nl2br(q.description)}</div>` : ''}</div></div>`;
  let input = '';
  switch (q.type) {
    case 'likert': {
      const k = q.scale.length;
      input = `<div class="lkf" style="--k:${k}"><div class="lkf-row lkf-headrow"><span></span>${q.scale.map(s => `<span>${esc(s)}</span>`).join('')}</div>
        ${q.rows.map(r => `<div class="lkf-row" role="radiogroup" aria-label="${esc(r.label)}"><div class="lkf-label">${esc(r.label)}${r.hint ? `<small>${esc(r.hint)}</small>` : ''}</div>
          ${q.scale.map((s, i) => `<label class="lkf-opt"><input type="radio" name="${q.id}.${r.id}" value="${i + 1}" ${v && v[r.id] === i + 1 ? 'checked' : ''} ${q.required ? 'data-req' : ''}><span class="lkf-dot" aria-hidden="true"></span><span class="lkf-txt">${esc(s)}</span></label>`).join('')}</div>`).join('')}</div>`;
      break;
    }
    case 'rating': input = `<div class="starsf" role="radiogroup">${Array.from({ length: q.max }, (_, i) => `<label><input type="radio" name="${q.id}" value="${i + 1}" ${v === i + 1 ? 'checked' : ''}><span aria-hidden="true">★</span><span class="sr">${i + 1} of ${q.max}</span></label>`).join('')}</div>`; break;
    case 'nps': input = `<div class="npsf" role="radiogroup">${Array.from({ length: 11 }, (_, i) => `<label><input type="radio" name="${q.id}" value="${i}" ${v === i ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div>
      <div class="npsf-ends small muted"><span>${esc(q.low)}</span><span>${esc(q.high)}</span></div>`; break;
    case 'choice': input = `<div class="optf">${q.options.map(o => `<label class="optf-o"><input type="radio" name="${q.id}" value="${o.id}" ${v === o.id ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>`; break;
    case 'checkbox': input = `<div class="optf">${q.options.map(o => `<label class="optf-o"><input type="checkbox" name="${q.id}" value="${o.id}" ${[].concat(v || []).includes(o.id) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>`; break;
    case 'text': input = q.long ? `<textarea name="${q.id}" rows="4" maxlength="4000" placeholder="Enter your answer">${esc(v || '')}</textarea>` : `<input type="text" name="${q.id}" maxlength="500" value="${esc(v || '')}" placeholder="Enter your answer">`; break;
  }
  return `<div class="fq${err ? ' has-err' : ''}" id="q-${q.id}" data-qid="${q.id}" data-type="${q.type}" ${q.required ? 'data-required' : ''}>${head}${input}<p class="fq-err" role="alert" ${err ? '' : 'hidden'}>${esc(err || 'This question is required.')}</p></div>`;
}
function fillPage({ form, recipient, answers = {}, errors = {}, preview = false, editing = false }) {
  const num = numbering(form.questions);
  const required = form.questions.filter(q => q.required && q.type !== 'section').length;
  const items = form.questions.map(q => q.type === 'section'
    ? `<div class="fsec"><h2>${esc(q.title)}</h2>${q.description ? `<p class="muted">${nl2br(q.description)}</p>` : ''}</div>`
    : questionInput(q, answers[q.id], errors[q.id], num[q.id])).join('');
  const action = preview ? '' : `/f/${recipient.token}`;
  const body = `<div class="fillpage">
    ${preview ? '<div class="preview-bar">Preview – this is what people see. Answers here are not saved.</div>' : ''}
    ${recipient && recipient.is_test ? '<div class="preview-bar test">Test link – your answers are saved as a test and never count in the results.</div>' : ''}
    <header class="fill-hero${form.cover_image ? ' has-img' : ''}">${form.cover_image ? `<img src="${esc(form.cover_image)}" alt="" class="fill-img">` : ''}
      <div class="fill-hero-in"><div class="eyebrow">${esc(config.brand.company)} ${esc(config.brand.unit)}</div><h1>${esc(form.title)}</h1>
        ${form.description ? `<p>${nl2br(form.description)}</p>` : ''}
        <p class="fill-who">${recipient ? `Hi ${esc(recipient.first_name || recipient.name || '')}! Your answers are linked to <b>${esc(recipient.email)}</b> and saved as you go.` : ''}${required ? ` <span class="req">*</span> Required` : ''}</p></div></header>
    ${Object.keys(errors).length ? `<p class="err" role="alert">Please answer the ${Object.keys(errors).length === 1 ? 'question' : `${Object.keys(errors).length} questions`} marked in red.</p>` : ''}
    <form method="post" action="${action}" id="fill-form" class="fill-form" novalidate data-save="${preview ? '' : `/f/${esc(recipient.token)}/save`}" ${preview ? 'data-preview' : ''}>
      <input type="hidden" name="_elapsed" value="0">
      ${items}
      <div class="fill-foot"><div class="fill-progress" aria-hidden="true"><div id="fill-bar"></div></div><span class="small muted" id="fill-status">${editing ? 'You are changing your submitted answers.' : ''}</span>
        <button class="btn" type="submit" ${preview ? 'disabled title="Preview only"' : ''}>${editing ? 'Save changes' : 'Submit'}</button></div>
    </form></div>`;
  return layout({ title: form.title, body, scripts: ['/assets/form-fill.js'] });
}
const thanksPage = (form, { canEdit, token, isTest = false }) => layout({ title: form.title, body: `<div class="mail"><div class="mail-head"><div class="h">${esc(form.title)}</div></div>
  <div class="mail-body thanks"><div class="done-ico" aria-hidden="true">✓</div><p>${nl2br(form.settings.thankYou)}</p>
  ${isTest ? '<p class="small"><span class="pill warn">Test</span> This was a test – it does not count in the results.</p>' : ''}
  ${canEdit ? `<p class="small muted"><a href="/f/${esc(token)}?edit=1">Change my answers</a> (possible until the survey closes)</p>` : ''}</div></div>` });
const closedPage = form => messagePage(form.title, form.status === 'draft' ? 'This survey has not been opened yet.' : 'This survey is closed. Thank you for your interest.');

module.exports = { listPage, editPage, sendPage, resultsPage, responsePage, fillPage, thanksPage, closedPage };
