'use strict';
const config = require('../config');
const { esc, nl2br, clip, QUESTION, LABELS } = require('../mail/templates');
const { greetingName } = require('../names');
const { describeRules, describeExclusions } = require('../services/summary');
const { describe } = require('../services/history');

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtDateTime = d => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

function wordmark() {
  const b = config.brand;
  return b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.company)}" class="logo">`
    : `<span class="wordmark">${esc(b.company)} <span>${esc(b.unit)}</span></span>`;
}

const isTeam = admin => admin && admin.role === 'team';
const initials = name => String(name || '?').replace(/\(.*\)/, '').trim().split(/[\s._-]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
// A small "pulse" mark next to the wordmark.
const BRAND_MARK = '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></svg></span>';
// Changes on every restart, so browsers fetch new CSS/JS after an update instead of using their cached copy.
const ASSET_VERSION = Date.now().toString(36);

// help: anchor on /admin/help for this page, so the menu's Help link opens the matching section.
function layout({ title, body, admin, active, scripts = [], help = '' }) {
  const nav = admin ? `<nav aria-label="Admin">
      <a href="/admin" ${active === 'dash' ? 'aria-current="page"' : ''}>Dashboard</a>
      <a href="/admin/settings" ${active === 'settings' ? 'aria-current="page"' : ''}>${isTeam(admin) ? 'My groups' : 'Admin settings'}</a>
      <a href="/admin/reports" ${active === 'reports' ? 'aria-current="page"' : ''}>Reports</a>
      <a href="/admin/surveys" ${active === 'surveys' ? 'aria-current="page"' : ''}>Survey log</a>
      <a href="/admin/missing" ${active === 'missing' ? 'aria-current="page"' : ''}>Missing emails</a>
      <a href="/admin/test" ${active === 'test' ? 'aria-current="page"' : ''}>Test survey</a>
      <a class="help-link" href="/admin/help${help ? '?for=' + help : ''}" ${active === 'help' ? 'aria-current="page"' : ''} title="About &amp; help${help ? ' for this page' : ''}"><span aria-hidden="true">?</span> Help</a>
    </nav><div class="me"><span class="avatar-sm" aria-hidden="true">${esc(initials(admin.name))}</span><span class="who">${esc(admin.name)}<small>${isTeam(admin) ? 'Team admin' : 'Global admin'}</small></span></div>` : '';
  const viewAs = admin && admin.viewAs ? `<div class="viewas" role="status"><div class="viewas-in">
      <span>You're viewing CSAT Pulse as <b>${esc(admin.name)}</b>${admin.hdaUser ? '' : ' <span class="pill warn">not found in HDA</span>'}, a team admin with ${admin.groups.size} owner group${admin.groups.size === 1 ? '' : 's'}. This is exactly what they would see.</span>
      <form method="post" action="/admin/view-as/stop"><button class="btn ghost" type="submit">Back to global admin</button></form></div></div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(config.brand.product)}</title><link rel="stylesheet" href="/assets/app.css?v=${ASSET_VERSION}"></head>
<body><header class="top"><div class="top-in"><a class="brand" href="${admin ? '/admin' : '#'}">${BRAND_MARK}${wordmark()}<span class="app">${esc(config.brand.product)}</span></a>${nav}</div></header>
${viewAs}<main>${body}</main>${scripts.map(s => `<script src="${s}?v=${ASSET_VERSION}"></script>`).join('')}</body></html>`;
}

// One line describing a group's own settings, e.g. "Own sources: Email, Phone · own rules: delay, reminder".
const RULE_LABELS = { ticketTypes: 'ticket types', sendDelayMinutes: 'delay', throttleDays: 'throttle', reminderDays: 'reminder', expiryDays: 'expiry', alertThreshold: 'alert' };
function groupSummary(gs) {
  if (!gs) return 'Default sources and rules';
  const parts = [gs.sources ? `Own sources: ${gs.sources.join(', ') || 'none'}` : 'Default sources'];
  const own = Object.keys(gs.rules || {}).map(k => RULE_LABELS[k]).filter(Boolean);
  parts.push(own.length ? `own ${own.join(', ')}` : 'default rules');
  return parts.join(' · ');
}

function groupRow(g, { lead = true } = {}) {
  return `<div class="row" data-name="${esc(g.name.toLowerCase())}" data-on="${g.csat_enabled}" data-active="${g.closed_30d > 0}">
    <span class="switch"><input type="checkbox" data-kind="group" data-id="${esc(g.hda_group_id)}" data-label="${esc(g.name)}" data-closed="${g.closed_30d}" ${g.csat_enabled ? 'checked' : ''} aria-label="Send CSAT for ${esc(g.name)}"><span></span></span>
    <div class="grow"><div class="b">${esc(g.name)}${g.active_in_hda ? '' : ' <span class="pill warn">Not in HDA</span>'}</div>
      <div class="small muted"><span class="mono">${esc(g.hda_group_id)}</span> · ${g.closed_30d} closed in 30 days · ${esc(groupSummary(g.gs))}</div></div>
    ${lead ? `<input type="email" class="lead" data-id="${esc(g.hda_group_id)}" value="${esc(g.lead_email || '')}" placeholder="Group lead email" aria-label="Group lead email for ${esc(g.name)}">` : ''}
    <a class="btn ghost" href="/admin/groups/${encodeURIComponent(g.hda_group_id)}">Sources &amp; rules</a>
  </div>`;
}

// ---------- end-user survey ----------
function ticketBlock(s) {
  return `<dl class="tk">
    <dt>Ticket ID</dt><dd class="mono">${esc(s.ticket_number || s.ticket_id)}</dd>
    <dt>Date</dt><dd>${fmtDate(s.closed_at) || '–'}</dd>
    <dt>Subject</dt><dd><b>${esc(s.subject || '–')}</b></dd>
    ${s.solution ? `<dt>Solution</dt><dd>${nl2br(clip(s.solution, 1500))}</dd>` : ''}
    <dt>Ticket owner</dt><dd>${esc(s.ticket_owner || '–')}</dd>
  </dl>`;
}

function likert(selected) {
  return `<fieldset class="q"><legend>${esc(QUESTION)}</legend>
    <div class="likert">${LABELS.map((l, i) => {
      const v = i + 1, id = `overall-${v}`;
      return `<label for="${id}"><input type="radio" id="${id}" name="overall" value="${v}" ${selected === v ? 'checked' : ''} required><b>${v}</b><span>${esc(l)}</span></label>`;
    }).join('')}</div></fieldset>`;
}

function surveyPage(s, { preselect, error, values = {} } = {}) {
  const body = `<div class="mail">
    <div class="mail-head"><div class="h">How did we do?</div><div class="sub">Your ${esc((s.ticket_type || 'ticket').toLowerCase())} ${esc(s.ticket_number || s.ticket_id)} was closed on ${fmtDate(s.closed_at)}</div></div>
    <form class="mail-body" method="post" action="">
      <p>Hello${greetingName(s) ? ' ' + esc(greetingName(s)) : ''}, please take a moment to rate the support you received.</p>
      ${ticketBlock(s)}
      ${likert(Number(values.overall) || preselect)}
      <div class="field"><label for="comment">Anything you'd like to add? <span class="muted">(optional)</span></label>
        <textarea id="comment" name="comment" rows="2" maxlength="1000" placeholder="What went well, or what could be better">${esc(values.comment || '')}</textarea></div>
      ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
      <button class="btn" type="submit">Submit feedback</button>
      <p class="small muted">Takes about 10 seconds. This link works once and expires on ${fmtDate(s.expires_at)}. <a href="/about-survey" target="_blank" rel="noopener">About this survey</a></p>
    </form></div>`;
  return layout({ title: 'Rate your support', body });
}

function messagePage(title, text) {
  return layout({ title, body: `<div class="mail"><div class="mail-head"><div class="h">${esc(title)}</div></div>
    <div class="mail-body thanks"><p>${esc(text)}</p></div></div>` });
}

// ---------- admin ----------
function dashboardPage(admin) {
  const sel = (id, label, all) => `<label class="dsel"><span>${label}</span><select id="${id}"><option value="">${all}</option></select></label>`;
  const card = (cls, id, title, extra = '', bodyId = '') => `<div class="card dcard ${cls}"${id ? ` id="${id}"` : ''}><div class="ch"><h3>${title}</h3>${extra}</div><div class="dbody"${bodyId ? ` id="${bodyId}"` : ''}><div class="skel" style="height:160px"></div></div></div>`;
  const body = `<section class="dash" id="dash" aria-busy="true">
  <header class="dash-hero">
    <div class="dash-hero-top">
      <div><div class="eyebrow" id="dash-hello">${esc(isTeam(admin) ? 'Your owner groups' : 'All owner groups')}</div>
        <h1 id="dash-title">CSAT dashboard</h1>
        <p class="dash-sub" id="dash-status">Loading…</p></div>
      <div class="dash-actions">
        <div class="seg seg-slide" id="f-weeks" role="group" aria-label="Period"><span class="seg-ind" aria-hidden="true"></span>
          <button type="button" data-w="4" aria-pressed="false">4 weeks</button><button type="button" data-w="12" aria-pressed="true">12 weeks</button>
          <button type="button" data-w="26" aria-pressed="false">6 months</button><button type="button" data-w="52" aria-pressed="false">12 months</button></div>
        <a class="btn btn-glow" href="/admin/reports"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 18v-6M9 15l3 3 3-3"/></svg>PDF report</a>
      </div>
    </div>
    <div class="dash-filters" role="group" aria-label="Filters">
      ${sel('f-group', 'Owner group', 'All owner groups')}${sel('f-source', 'Source', 'All sources')}${sel('f-type', 'Type', 'All types')}${sel('f-priority', 'Priority', 'All priorities')}
      <button type="button" class="dclear" id="f-clear" hidden>Clear filters</button>
    </div>
  </header>
  <div class="kpis" id="kpis">${'<div class="kpi"><div class="skel" style="height:96px"></div></div>'.repeat(6)}</div>
  <div class="dgrid">
    ${card('s8', '', 'Trend', `<div class="seg seg-slide seg-sm" id="trend-metric" role="group" aria-label="Trend measure"><span class="seg-ind" aria-hidden="true"></span>
      <button type="button" data-m="csat" aria-pressed="true">CSAT %</button><button type="button" data-m="avg" aria-pressed="false">Avg score</button><button type="button" data-m="vol" aria-pressed="false">Volume</button></div>`, 'trend')}
    ${card('s4', '', 'Score distribution', '<span class="small muted" id="dist-n"></span>', 'dist')}
    ${card('s4', '', '<span class="spark-dot"></span>Insights', '', 'insights')}
    ${card('s8', '', 'Owner groups', '<span class="small muted">Sorted by CSAT % · click a group to focus on it</span>', 't-group')}
    ${card('s6', '', 'Breakdown', `<div class="seg seg-slide seg-sm" id="bd-tabs" role="tablist" aria-label="Breakdown"><span class="seg-ind" aria-hidden="true"></span>
      <button type="button" data-b="bySource" aria-pressed="true">Source</button><button type="button" data-b="byType" aria-pressed="false">Type</button>
      <button type="button" data-b="byPriority" aria-pressed="false">Priority</button><button type="button" data-b="byCategory" aria-pressed="false">Category</button></div>`, 'breakdown')}
    ${card('s6', '', 'Ticket owners', '<span class="small muted">At least 5 responses</span>', 't-agent')}
    ${card('s7', 'followups', 'Low-score follow-up', `<div class="seg seg-slide seg-sm" id="fu-tabs" role="group" aria-label="Show"><span class="seg-ind" aria-hidden="true"></span>
      <button type="button" data-f="open" aria-pressed="true">Open <span class="pill bad" id="fu-open">0</span></button><button type="button" data-f="all" aria-pressed="false">All</button></div>`, 't-followup')}
    ${card('s5', '', 'Latest comments', '', 'comments')}
    ${card('s12', '', 'Why tickets were not surveyed', '<span class="small muted">Solved tickets skipped in the period</span>', 't-skipped')}
  </div>
</section><div id="tip" hidden></div><div class="toast" id="toast" hidden></div>`;
  return layout({ title: 'Dashboard', body, admin, active: 'dash', scripts: ['/assets/dashboard.js'], help: 'dashboard' });
}

// Server-rendered tabs (?tab=…); each tab is a plain link so it works without JavaScript and can be bookmarked.
function tabBar(label, tabs, current) {
  return `<div class="seg tabs" role="tablist" aria-label="${esc(label)}">${tabs.map(([key, text, badge]) =>
    `<a role="tab" class="tab" href="/admin/settings${key === tabs[0][0] ? '' : '?tab=' + key}" aria-selected="${key === current}">${esc(text)}${badge !== undefined ? ` <span class="pill neutral">${badge}</span>` : ''}</a>`).join('')}</div>`;
}

// Owner-group list with search and quick filters (busy and switched-on groups are listed first).
function groupList(groups, { global }) {
  const on = groups.filter(g => g.csat_enabled).length, active = groups.filter(g => g.closed_30d > 0).length;
  return `<div class="card"><div class="ch"><h3>Owner groups</h3><span class="small muted" id="g-count">${on} of ${groups.length} switched on</span></div>
    <div class="filters">
      <input type="search" id="g-search" placeholder="Search groups" aria-label="Search groups">
      <div class="seg" id="g-filter" role="group" aria-label="Show">
        <button type="button" data-filter="all" aria-pressed="${global ? 'false' : 'true'}">All ${groups.length}</button>
        <button type="button" data-filter="on" aria-pressed="false">Switched on ${on}</button>
        <button type="button" data-filter="active" aria-pressed="${global ? 'true' : 'false'}">Tickets in last 30 days ${active}</button></div>
      ${global ? `<button class="btn ghost" type="button" data-bulk="groups" data-on="false">Switch all off</button>
        <form method="post" action="/admin/groups/sync"><button class="btn ghost" type="submit">Sync from HDA now</button></form>` : ''}</div>
    <div id="g-list">${groups.map(g => groupRow(g)).join('') || `<p class="muted">${global ? 'No owner groups yet. Click "Sync from HDA now".' : 'None of your HDA groups are in CSAT Pulse yet. Ask a global admin to run "Sync from HDA now".'}</p>`}</div>
    <p class="small muted" id="g-empty" hidden>No groups match.</p>
  </div>`;
}

function historyCard(entries, groupNames, { q, scoped }) {
  const name = id => groupNames.get(id) || id || 'a group';
  return `<div class="card"><div class="ch"><h3>Change history</h3><span class="small muted">${scoped ? 'Changes to your owner groups' : 'All changes'} · newest first</span></div>
    <form class="filters" method="get" action="/admin/settings"><input type="hidden" name="tab" value="history">
      <input type="search" name="q" value="${esc(q || '')}" placeholder="Search person, group or ticket" aria-label="Search history"><button class="btn ghost" type="submit">Search</button></form>
    <div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
    ${entries.map(e => `<tr><td class="small" style="white-space:nowrap">${fmtDateTime(e.at)}</td><td class="small">${esc(e.actor || 'system')}</td>
      <td class="small">${esc(describe(e, name))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No changes recorded yet.</td></tr>'}
    </tbody></table></div></div>`;
}

function settingsPage(admin, { tab, groups, sources, settings, state, saved, types, access = [], history = [], q, notice, error, closeCodeMapped }) {
  if (isTeam(admin)) return teamGroupsPage(admin, { tab, groups, state, history, q, settings, sources });
  const sw = (kind, id, on, label) => `<span class="switch"><input type="checkbox" data-kind="${kind}" data-id="${esc(id)}" ${on ? 'checked' : ''} aria-label="${esc(label)}"><span></span></span>`;
  const defaultSources = sources.filter(s => s.csat_enabled).map(s => s.source);
  const on = groups.filter(g => g.csat_enabled).length;
  const summary = `<div class="card summary"><div class="b">${settings.surveyEnabled ? `Surveys are <span class="pill good">on</span> for ${on} of ${groups.length} owner groups.` : 'Surveys are <span class="pill bad">off</span> for everyone (master switch).'}</div>
    <p><b>By default:</b> ${esc(describeRules(settings, defaultSources))}</p>
    ${describeExclusions(settings) ? `<p class="small muted">${esc(describeExclusions(settings))}</p>` : ''}
    <p class="small muted">Groups with their own sources or rules say so under their name. Last synced from HDA: ${fmtDateTime(state.groups_synced_at) || 'never'} · Last ticket check: ${fmtDateTime(state.tickets_polled_at) || 'never'}</p></div>`;
  const tabs = tabBar('Admin settings', [['groups', 'Owner groups', on], ['sources', 'Default sources', defaultSources.length], ['rules', 'Default send rules'], ['access', 'Team access', access.length], ['history', 'Change history']], tab);
  const panes = {
    groups: groupList(groups, { global: true }),
    sources: `<div class="card"><div class="ch"><h3>Default ticket sources</h3><span class="small muted" id="s-count">${defaultSources.length} of ${sources.length} switched on</span></div>
        <div class="bar"><p class="small muted">Used by every group that doesn't choose its own sources. All sources defined in HDA are listed (synced daily with the owner groups); new ones arrive switched off.
          "(No source)" covers tickets whose Source field is empty in HDA.</p>
          <form method="post" action="/admin/groups/sync"><input type="hidden" name="back" value="sources"><button class="btn ghost" type="submit">Sync from HDA now</button></form></div>
        ${sources.map(s => `<div class="row">${sw('source', s.source, s.csat_enabled, 'Send CSAT for ' + s.source + ' tickets')}<div class="grow"><span class="b">${esc(s.source)}</span>${s.active_in_hda ? '' : ' <span class="pill muted" title="This source is switched off or removed in HDA, so new tickets are unlikely to use it">Not active in HDA</span>'}${s.hda_source_id ? ` <span class="small muted mono">${esc(s.hda_source_id)}</span>` : ''}</div><span class="small muted">${s.closed_30d} in 30 days</span></div>`).join('') || '<p class="muted">Sources appear after the first sync from HDA.</p>'}
      </div>`,
    rules: `<form class="card rules narrow" method="post" action="/admin/settings">
        <h3>Default send rules</h3>
        <p class="small muted">Groups can override the ticket types, timing and alert level. The master switch, exclusions and CSAT target apply to everyone.</p>
        <label class="chk"><input type="checkbox" name="surveyEnabled" value="true" ${settings.surveyEnabled ? 'checked' : ''}> Surveys are switched on (master switch)</label>
        <div class="field"><span class="b small">Ticket types that get surveys</span>
          ${types.map(t => `<label class="chk"><input type="checkbox" name="ticketTypes" value="${esc(t)}" ${settings.ticketTypes.includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
        ${num('sendDelayMinutes', 'Send this many minutes after the ticket is solved', settings.sendDelayMinutes, 0, 10080)}
        ${num('throttleDays', "Don't survey the same person more than once every (days, 0 = no limit)", settings.throttleDays, 0, 365)}
        ${num('reminderDays', 'Send one reminder after (days, 0 = no reminder)', settings.reminderDays, 0, 30)}
        ${num('expiryDays', 'Survey link expires after (days)', settings.expiryDays, 1, 90)}
        ${num('alertThreshold', 'Email the group lead when the overall score is at or below (0 = never)', settings.alertThreshold, 0, 5)}
        ${num('csatTarget', 'CSAT target shown on the dashboard (%)', settings.csatTarget, 1, 100)}
        <div class="field"><label for="excludeOwnerPatterns">Skip tickets owned by (one name per line, * = wildcard)</label>
          <textarea id="excludeOwnerPatterns" name="excludeOwnerPatterns" rows="3" placeholder="e.g. Eye-T ServiceDesk AI">${esc((settings.excludeOwnerPatterns || []).join('\n'))}</textarea>
          <span class="small muted">For automated accounts (bots). Matches the "Ticket owner" name shown in the Survey log.</span></div>
        <div class="field"><label for="excludeRequesterPatterns">Skip requesters whose email starts like (one per line, * = wildcard)</label>
          <textarea id="excludeRequesterPatterns" name="excludeRequesterPatterns" rows="3">${esc((settings.excludeRequesterPatterns || []).join('\n'))}</textarea></div>
        ${closeCodeMapped ? `<div class="field"><label for="excludeCloseCodes">Skip tickets whose closure code contains (one per line)</label>
          <textarea id="excludeCloseCodes" name="excludeCloseCodes" rows="3">${esc((settings.excludeCloseCodes || []).join('\n'))}</textarea></div>`
          : `<input type="hidden" name="excludeCloseCodes" value="${esc((settings.excludeCloseCodes || []).join('\n'))}">`}
        <button class="btn" type="submit">Save rules</button>
      </form>`,
    access: `<div class="narrow">${teamAccessCard(access, groups)}</div>`,
    history: historyCard(history, new Map(groups.map(g => [g.hda_group_id, g.name])), { q, scoped: false }),
  };
  const body = `<section class="panel">
  <div><div class="eyebrow">Admin</div><h1>Admin settings</h1>
    <p class="lead">A survey is sent only when the ticket's owner group <b>and</b> its source are both switched on. Each group can use the defaults
      or its own sources and rules (<b>Sources &amp; rules</b>). New groups and sources found in HDA appear switched off.</p></div>
  ${saved ? '<p class="ok" role="status">Send rules saved.</p>' : ''}
  ${notice ? `<p class="ok" role="status">${esc(notice)}</p>` : ''}${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
  ${summary}${tabs}${panes[tab] || panes.groups}
  </section><div class="toast" id="toast" hidden></div>`;
  return layout({ title: 'Admin settings', body, admin, active: 'settings', scripts: ['/assets/admin.js'], help: tab === 'rules' ? 'default-rules' : tab === 'sources' ? 'default-sources' : tab === 'access' ? 'team-access' : tab === 'history' ? 'history' : 'switch-on' });
}
function num(name, label, value, min, max) {
  return `<div class="field"><label for="${name}">${esc(label)}</label><input type="number" id="${name}" name="${name}" value="${esc(value)}" min="${min}" max="${max}" required></div>`;
}

// Global admin: preview a team admin's view, and grant groups to people who aren't members in HDA.
function teamAccessCard(access, groups) {
  const byId = new Map(groups.map(g => [g.hda_group_id, g.name]));
  return `<div class="card rules"><h3>Team access</h3>
    <p class="small muted">Team admins see only the owner groups they're assigned to in HDA (Groups/Operators). Once Microsoft sign-in is set up they sign in with their own account; until then, use <b>View as</b> to see exactly what a person would see.</p>
    <form class="filters" method="post" action="/admin/view-as">
      <label>HDA username or email<input type="text" name="login" required placeholder="e.g. reuben.dsouza" autocomplete="off"></label>
      <button class="btn ghost" type="submit">View as</button></form>
    <div class="field"><span class="b small">Extra group access</span>
      <span class="small muted">Only for someone who should manage a group but isn't in it in HDA, e.g. a team lead.</span></div>
    ${access.length ? `<div class="tw"><table><thead><tr><th>Person</th><th>Owner group</th><th>Added</th><th></th></tr></thead><tbody>
      ${access.map(a => `<tr><td class="small">${esc(a.login)}</td><td class="small">${esc(byId.get(a.hda_group_id) || a.hda_group_id)}</td>
        <td class="small muted">${esc(a.added_by || '')} · ${fmtDate(a.added_at)}</td>
        <td><form method="post" action="/admin/access/remove"><input type="hidden" name="login" value="${esc(a.login)}"><input type="hidden" name="group" value="${esc(a.hda_group_id)}">
          <button class="btn ghost" type="submit" aria-label="Remove ${esc(a.login)} from ${esc(byId.get(a.hda_group_id) || a.hda_group_id)}">Remove</button></form></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="small muted">None yet.</p>'}
    <form class="filters" method="post" action="/admin/access/add">
      <label>HDA username or email<input type="text" name="login" required autocomplete="off"></label>
      <label>Owner group<input type="text" name="group" list="group-options" required placeholder="Type to search" autocomplete="off"></label>
      <button class="btn ghost" type="submit">Add</button></form>
    <datalist id="group-options">${groups.map(g => `<option value="${esc(g.hda_group_id)}">${esc(g.name)}</option>`).join('')}</datalist>
  </div>`;
}

// Team admin: only their groups, no bulk switches, no global rules.
function teamGroupsPage(admin, { tab, groups, state, history, q, settings }) {
  const on = groups.filter(g => g.csat_enabled).length;
  const via = [admin.hdaGroupCount ? `${admin.hdaGroupCount} from your HDA assignments (Groups/Operators)` : '', admin.extraGroupCount ? `${admin.extraGroupCount} added by a global admin` : ''].filter(Boolean).join(' and ');
  const pane = tab === 'history' ? historyCard(history, new Map(groups.map(g => [g.hda_group_id, g.name])), { q, scoped: true })
    : `${groups.filter(g => g.csat_enabled).map(g => `<div class="card summary"><div class="b">${esc(g.name)} <span class="pill good">on</span></div><p>${esc(g.plain)}</p></div>`).join('')}
       ${groupList(groups, { global: false })}`;
  const body = `<section class="panel">
  <div><div class="eyebrow">Team admin</div><h1>My owner groups</h1>
    <p class="lead">You can manage the owner groups you belong to${via ? ` (${esc(via)})` : ''}. Switch a group on to send a survey when its tickets close,
      and use <b>Sources &amp; rules</b> to choose which channels, ticket types and timing apply to it.</p>
    ${settings.surveyEnabled ? '' : '<p class="err mt">Surveys are currently switched off for everyone by a global admin, so nothing is sent.</p>'}
    <p class="small muted mt">Last ticket check: ${fmtDateTime(state.tickets_polled_at) || 'never'}</p></div>
  ${tabBar('My groups', [['groups', 'My groups', on], ['history', 'Change history']], tab)}
  ${pane}</section><div class="toast" id="toast" hidden></div>`;
  return layout({ title: 'My groups', body, admin, active: 'settings', scripts: ['/assets/admin.js'], help: tab === 'history' ? 'history' : 'switch-on' });
}

// One owner group's sources, ticket types and send rules. Empty box / "use default" = inherit the global value.
function groupSettingsPage(admin, { group, gs, defaults, sources, types, saved, plain }) {
  const rules = (gs && gs.rules) || {};
  const ownSources = gs && gs.sources;
  const defaultSources = sources.filter(s => s.csat_enabled).map(s => s.source);
  const ownTypes = Array.isArray(rules.ticketTypes) ? rules.ticketTypes : null;
  const box = (name, label, min, max) => `<div class="field"><label for="${name}">${esc(label)}</label>
    <input type="number" id="${name}" name="${name}" value="${rules[name] ?? ''}" min="${min}" max="${max}" placeholder="Default: ${esc(defaults[name])}"></div>`;
  const body = `<section class="panel">
  <div><div class="eyebrow"><a href="/admin/settings">← ${isTeam(admin) ? 'My groups' : 'Admin settings'}</a></div>
    <h1>${esc(group.name)}</h1>
    <p class="lead">Sources, ticket types and timing for this owner group. Anything left on "default" or empty follows the global settings, so later changes there apply here too.</p>
    <p class="small muted mt">Surveys for this group are currently <b>${group.csat_enabled ? 'switched on' : 'switched off'}</b> (change that on the ${isTeam(admin) ? 'My groups' : 'Admin settings'} page).
      ${gs && gs.updatedBy ? ` Last changed by ${esc(gs.updatedBy)} on ${fmtDateTime(gs.updatedAt)}.` : ''}</p></div>
  ${saved ? '<p class="ok" role="status">Group settings saved.</p>' : ''}
  <div class="card summary"><div class="b">What happens for this group</div><p>${esc(plain)}</p></div>
  <form class="grid g2" method="post" action="/admin/groups/${encodeURIComponent(group.hda_group_id)}">
    <div class="card rules"><h3>Ticket sources</h3>
      <label class="chk"><input type="checkbox" name="useDefaultSources" value="true" data-default-for="own-sources" ${ownSources ? '' : 'checked'}>
        Use the default sources (${esc(defaultSources.join(', ') || 'none switched on')})</label>
      <fieldset id="own-sources" class="plain" ${ownSources ? '' : 'disabled'}><legend class="small muted">Or choose this group's own sources:</legend>
        ${sources.map(s => `<label class="chk"><input type="checkbox" name="sources" value="${esc(s.source)}" ${(ownSources ? ownSources.includes(s.source) : s.csat_enabled) ? 'checked' : ''}> ${esc(s.source)}
          <span class="small muted">· ${s.closed_30d} in 30 days</span></label>`).join('')}</fieldset>
      <p class="small muted">"(No source)" covers tickets whose Source field is empty in HDA.</p>
    </div>
    <div class="card rules"><h3>Ticket types and timing</h3>
      <label class="chk"><input type="checkbox" name="useDefaultTypes" value="true" data-default-for="own-types" ${ownTypes ? '' : 'checked'}>
        Use the default ticket types (${esc(defaults.ticketTypes.join(', '))})</label>
      <fieldset id="own-types" class="plain" ${ownTypes ? '' : 'disabled'}><legend class="small muted">Or choose this group's own ticket types:</legend>
        ${types.map(t => `<label class="chk"><input type="checkbox" name="ticketTypes" value="${esc(t)}" ${(ownTypes || defaults.ticketTypes).includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</fieldset>
      ${box('sendDelayMinutes', 'Send this many minutes after the ticket is solved', 0, 10080)}
      ${box('throttleDays', "Don't survey the same person more than once every (days, 0 = no limit)", 0, 365)}
      ${box('reminderDays', 'Send one reminder after (days, 0 = no reminder)', 0, 30)}
      ${box('expiryDays', 'Survey link expires after (days)', 1, 90)}
      ${box('alertThreshold', 'Email the group lead when the overall score is at or below (0 = never)', 0, 5)}
    </div>
    <div><button class="btn" type="submit">Save group settings</button></div>
  </form></section>`;
  return layout({ title: group.name, body, admin, active: 'settings', scripts: ['/assets/admin.js'], help: 'group-rules' });
}

// Opens the ticket in the HDA portal (same URL pattern as HDA's own ticket links).
const hdaTicketUrl = (id, entity = 'Incident') => `${config.hda.baseUrl}/#/WSCView/Detail/${encodeURIComponent(id)}$entity=${encodeURIComponent(entity)}&RecordViewID=Default`;
const ticketLink = r => `<a class="mono" href="${esc(hdaTicketUrl(r.ticket_id, r.entity))}" target="_blank" rel="noopener">${esc(r.ticket_number || r.ticket_id)}</a>`;
const daysAgo = d => { if (!d) return ''; const n = Math.floor((Date.now() - new Date(d)) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };

function missingPage(admin, { tab, rows, contacts, counts, notice, error }) {
  const tabs = `<div class="seg" role="tablist" aria-label="Missing emails">
    <a role="tab" href="/admin/missing" aria-selected="${tab !== 'contacts'}" class="tab">Tickets to send <span class="pill neutral">${counts.missing}</span></a>
    <a role="tab" href="/admin/missing?tab=contacts" aria-selected="${tab === 'contacts'}" class="tab">Contacts to fix <span class="pill neutral">${counts.contacts}</span></a></div>`;
  const tickets = `<div class="card"><div class="ch"><h3>Tickets without a valid email</h3><span class="small muted">Newest first</span></div>
    <p class="small muted">These tickets would have had a survey, but the HDA contact has no usable email. Type the right address and click <b>Send survey</b>,
      or <b>Dismiss</b> it (e.g. a shared or generic account). The address is used for this survey only, so also get the contact fixed in HDA (see <a href="/admin/missing?tab=contacts">Contacts to fix</a>).</p>
    <div class="tw"><table><thead><tr><th>Ticket</th><th>Contact</th><th>Owner group · owner</th><th>Closed</th><th>Send to</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr>
      <td>${ticketLink(r)}<div class="small muted">${esc(r.ticket_type || '')}</div></td>
      <td class="small"><b>${esc(r.requester_name || '–')}</b><div class="muted">${r.requester_email ? `HDA has: <span class="mono">${esc(r.requester_email)}</span>` : 'No email in HDA'}</div></td>
      <td class="small">${esc(r.owner_group_name || '')}<div class="muted">${esc(r.ticket_owner || '')}</div></td>
      <td class="small">${fmtDate(r.closed_at)}<div class="muted">${daysAgo(r.closed_at)}</div></td>
      <td><form class="inline" method="post" action="/admin/missing/${r.id}/send">
          <input type="email" name="email" required value="${esc(r.suggested_email || '')}" placeholder="name@essilor.com" aria-label="Email for ${esc(r.requester_name || r.ticket_number)}">
          <button class="btn" type="submit">Send survey</button></form>
        ${r.suggested_email ? '<div class="small muted">Suggested: used for this contact before</div>' : ''}</td>
      <td><form method="post" action="/admin/missing/${r.id}/dismiss"><button class="btn ghost" type="submit" aria-label="Dismiss ${esc(r.ticket_number)}">Dismiss</button></form></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing waiting – every surveyed ticket had a valid email.</td></tr>'}
    </tbody></table></div></div>`;
  const people = `<div class="card"><div class="ch"><h3>HDA contacts with a missing or invalid email</h3>
      <a class="btn ghost" href="/admin/missing/contacts.csv">Download for Excel</a></div>
    <p class="small muted">Share this list with the HDA team so they can correct the contacts' profiles. "Correct email" is what an admin typed here, where known.</p>
    <div class="tw"><table><thead><tr><th>Contact</th><th>Email in HDA</th><th>Correct email</th><th class="n">Tickets</th><th>Owner groups</th><th>Last ticket</th></tr></thead><tbody>
    ${contacts.map(c => `<tr><td class="small"><b>${esc(c.name || '–')}</b><div class="muted mono">${esc(c.contact_id || 'no contact ID')}</div></td>
      <td class="small mono">${esc(c.email_in_hda || '(empty)')}</td><td class="small mono">${esc(c.suggested_email || '')}</td>
      <td class="n">${c.tickets}${c.waiting ? `<div class="small muted">${c.waiting} waiting</div>` : ''}</td>
      <td class="small">${esc(c.groups || '')}</td><td class="small">${fmtDate(c.last_closed)}<div class="muted mono">${esc((c.examples || []).join(' '))}</div></td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">No contacts to fix.</td></tr>'}
    </tbody></table></div></div>`;
  const body = `<section class="panel"><div><div class="eyebrow">${isTeam(admin) ? 'Team admin' : 'Admin'}</div><h1>Missing emails</h1>
    <p class="lead">Surveys that couldn't be sent because the contact in HDA has no valid email${isTeam(admin) ? ', for your owner groups' : ''}.</p></div>
    ${notice ? `<p class="ok" role="status">${esc(notice)}</p>` : ''}${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
    ${tabs}${tab === 'contacts' ? people : tickets}</section>`;
  return layout({ title: 'Missing emails', body, admin, active: 'missing', help: tab === 'contacts' ? 'contacts-csv' : 'missing-email' });
}

function surveysPage(admin, { rows, q, status }) {
  const pill = { pending: 'neutral', sent: 'neutral', answered: 'good', expired: 'warn', skipped: 'muted', failed: 'bad' };
  const body = `<section class="panel"><div><div class="eyebrow">Admin</div><h1>Survey log</h1>
    <p class="lead">Every closed ticket the service has checked, including the ones that were skipped and why.</p></div>
    <form class="filters" method="get"><input type="search" name="q" value="${esc(q || '')}" placeholder="Ticket number or requester email" aria-label="Search">
      <select name="status" aria-label="Status"><option value="">All statuses</option>${['pending', 'sent', 'answered', 'expired', 'skipped', 'failed'].map(s => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn ghost" type="submit">Filter</button></form>
    <div class="card"><div class="tw"><table><thead><tr><th>Ticket</th><th>Type</th><th>Requester</th><th>Owner group · owner</th><th>Source</th><th>Closed</th><th>Status</th><th class="n">Score</th><th>Detail</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="mono">${esc(r.ticket_number)}${r.is_test ? ' <span class="pill warn">test</span>' : ''}</td><td class="small">${esc(r.ticket_type || '')}</td><td class="small">${esc(r.requester_email || '–')}</td><td class="small">${esc(r.owner_group_name || '')}<br><span class="muted">${esc(r.ticket_owner || '')}</span></td><td class="small">${esc(r.source || '')}</td>
      <td class="small">${fmtDateTime(r.closed_at)}</td><td><span class="pill ${pill[r.status]}">${r.status}</span></td><td class="n"><b>${r.overall || ''}</b></td>
      <td class="small muted">${esc(r.skip_reason || r.send_error || (r.sent_at ? 'Sent ' + fmtDateTime(r.sent_at) : r.send_after ? 'Scheduled ' + fmtDateTime(r.send_after) : ''))}
        ${r.email_fixed_by ? `<div>Email typed by ${esc(r.email_fixed_by)}</div>` : ''}${r.email_dismissed_by ? `<div>Dismissed by ${esc(r.email_dismissed_by)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No surveys yet</td></tr>'}
    </tbody></table></div></div></section>`;
  return layout({ title: 'Survey log', body, admin, active: 'surveys', help: 'find-ticket' });
}

function testPage(admin, { ticket, to, sent, error, mail }) {
  const previewSrc = `/admin/test/preview${ticket ? '?ticket=' + encodeURIComponent(ticket) : ''}`;
  const via = mail.transport === 'smtp' ? `SMTP relay ${esc(mail.smtpHost)}` : mail.transport === 'graph' ? 'Microsoft Graph' : 'the outbox folder only (MAIL_TRANSPORT=file, nothing is emailed)';
  const body = `<section class="panel">
  <div><div class="eyebrow">Admin</div><h1>Test survey</h1>
    <p class="lead">Preview the survey email, then send a working test to any address. Test surveys are marked "test" in the Survey log
      and are left out of the dashboard, so they don't change the KPIs.</p></div>
  ${sent ? `<p class="ok" role="status">Test survey for ${esc(sent.ticket)} sent to ${esc(sent.to)}.</p>` : ''}
  ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
  <div class="grid g2">
    <form class="card rules" method="get" action="/admin/test">
      <h3>1. Choose a ticket</h3>
      <div class="field"><label for="ticket">HDA ticket number <span class="muted">(optional, e.g. A3412273L)</span></label>
        <input type="text" id="ticket" name="ticket" value="${esc(ticket || '')}" placeholder="Leave empty for a built-in sample ticket"></div>
      <button class="btn ghost" type="submit">Show preview</button>
    </form>
    <form class="card rules" method="post" action="/admin/test/send">
      <h3>2. Send a test</h3>
      <input type="hidden" name="ticket" value="${esc(ticket || '')}">
      <div class="field"><label for="to">Send to</label>
        <input type="email" id="to" name="to" value="${esc(to || '')}" placeholder="name@essilor.com" required></div>
      <p class="small muted">Sent via ${via}, from ${esc(mail.from)}. The subject starts with [TEST].
        The links open ${esc(mail.publicBaseUrl)}, so they only work where that address can be reached.</p>
      <button class="btn" type="submit">Send test survey</button>
    </form>
  </div>
  <div class="card"><div class="ch"><h3>Email preview${ticket ? ' · ' + esc(ticket) : ' · sample ticket'}</h3><span class="small muted">Links in the preview don't work; use a sent test to try the form.</span></div>
    <iframe src="${previewSrc}" title="Survey email preview" style="width:100%;height:900px;border:0;background:#f5f7fb;border-radius:8px"></iframe></div>
</section>`;
  return layout({ title: 'Test survey', body, admin, active: 'test', help: 'test-survey' });
}

// ---------- reports ----------
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Owner-group picker shared by the ad hoc and the schedule form. selected: null = all.
function groupPicker(prefix, groups, selected, team) {
  const all = !selected;
  const sel = new Set(selected || []);
  return `<fieldset class="field picker" data-picker><legend>Owner groups</legend>
    <label class="chk"><input type="checkbox" name="allGroups" value="true" data-all ${all ? 'checked' : ''}> ${team ? 'All my owner groups' : 'All owner groups'}</label>
    ${groups.length > 8 ? `<input type="search" class="picker-search" placeholder="Search groups" aria-label="Search owner groups" data-search>` : ''}
    <div class="picker-list">${groups.map(g => `<label class="chk small" data-name="${esc(String(g.name || g.id).toLowerCase())}"><input type="checkbox" name="groups" value="${esc(g.id)}" ${sel.has(g.id) ? 'checked' : ''} ${all ? 'disabled' : ''}> ${esc(g.name || g.id)}</label>`).join('')
      || '<p class="small muted">No owner group has surveys yet.</p>'}</div>
    <p class="small muted">Only groups that have sent surveys are listed.</p></fieldset>`;
}

function sectionPicker(prefix, sections, SECTIONS, custom) {
  return `<fieldset class="field" data-sections><legend>Report type</legend>
    <label class="chk"><input type="radio" name="type" value="standard" ${custom ? '' : 'checked'}> Standard report <span class="small muted">– everything except agent names</span></label>
    <label class="chk"><input type="radio" name="type" value="custom" ${custom ? 'checked' : ''}> Custom report <span class="small muted">– choose the parts, e.g. to add ticket owners</span></label>
    <div class="sections">${SECTIONS.map(([k, label]) => `<label class="chk small"><input type="checkbox" name="sections" value="${k}" ${sections.includes(k) ? 'checked' : ''} ${custom ? '' : 'disabled'}> ${esc(label)}${k === 'agents' ? ' <span class="pill warn">custom only</span>' : ''}</label>`).join('')}</div>
    <p class="small muted">The main figures (CSAT %, average score, response rate, surveys sent, low scores, time to respond) are always included.</p></fieldset>`;
}

function reportsPage(admin, { groups, schedules, runs, edit, R, domains, defaults, notice, error }) {
  const team = isTeam(admin);
  const gname = new Map(groups.map(g => [g.id, g.name || g.id]));
  const groupText = gs => !gs ? 'All owner groups' : gs.length > 3 ? `${gs.slice(0, 3).map(g => gname.get(g) || g).join(', ')} +${gs.length - 3}` : gs.map(g => gname.get(g) || g).join(', ');
  const domainNote = domains.length ? `Only ${domains.map(d => '@' + d).join(', ')} addresses. ` : '';
  const recipientHelp = `<p class="small muted">${domainNote}Separate addresses with commas or new lines. The report goes straight to these people (also during the pilot).</p>`;

  const adhoc = `<form class="card rules" method="post" action="/admin/reports/send" id="adhoc">
    <div class="ch"><h3>Create a report</h3><span class="small muted">Download it, or email it now</span></div>
    <fieldset class="field"><legend>Period</legend>
      <div class="seg" data-presets>${[['last-month', 'Last month'], ['this-month', 'This month'], ['last-4w', 'Last 4 weeks'], ['last-quarter', 'Last quarter'], ['this-year', 'This year']]
        .map(([k, l]) => `<button type="button" data-preset="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
      <div class="inline mt"><label class="small">From <input type="date" name="from" value="${esc(defaults.from)}" required></label>
        <label class="small">To <input type="date" name="to" value="${esc(defaults.to)}" required></label></div>
      <p class="small muted">Both days included. Compared with the same number of days just before.</p></fieldset>
    ${groupPicker('a', groups, null, team)}
    ${sectionPicker('a', R.STANDARD_SECTIONS, R.SECTIONS, false)}
    <div class="inline"><button class="btn" type="submit" formaction="/admin/reports/pdf" formmethod="get">Download PDF</button></div>
    <hr class="sep">
    <div class="field"><label for="adhoc-to">Email it to</label>
      <textarea id="adhoc-to" name="to_emails" rows="2" placeholder="name@essilor.com, name2@luxottica.com"></textarea>${recipientHelp}</div>
    <div class="field"><label for="adhoc-msg">Message <span class="muted">(optional, shown above the figures)</span></label>
      <textarea id="adhoc-msg" name="message" rows="2" maxlength="1000" placeholder="e.g. Here is the CSAT report for September."></textarea></div>
    <button class="btn ghost" type="submit" data-needs-recipients>Send report now</button>
  </form>`;

  const fmtNext = s => !s.enabled ? '<span class="pill muted">Paused</span>' : s.next_run_at ? fmtDateTime(s.next_run_at) : '–';
  const last = s => !s.last_run_at ? '<span class="muted">Not sent yet</span>'
    : `${fmtDateTime(s.last_run_at)} ${s.last_status === 'ok' ? '<span class="pill good">sent</span>' : `<span class="pill bad" title="${esc(s.last_error || '')}">failed</span>`}`
      + (s.last_status === 'failed' && s.last_error ? `<div class="small err">${esc(clip(s.last_error, 120))}</div>` : '');
  const list = `<div class="tw"><table><thead><tr><th>Report</th><th>Recipients</th><th>Owner groups</th><th>Next send</th><th>Last send</th><th></th></tr></thead><tbody>
    ${schedules.map(s => `<tr>
      <td><b>${esc(s.name)}</b>${R.isCustom(s.sections) ? ' <span class="pill neutral">custom</span>' : ''}<div class="small muted">${esc(R.describeSchedule(s))}</div>
        ${!team && s.owner_role === 'team' ? `<div class="small muted">Created by ${esc(s.owner_login)}</div>` : ''}</td>
      <td class="small">${s.recipients.map(esc).join('<br>')}</td>
      <td class="small">${esc(groupText(s.groups))}</td>
      <td class="small">${fmtNext(s)}</td><td class="small">${last(s)}</td>
      <td class="actions"><a class="btn ghost" href="/admin/reports?edit=${s.id}#schedule">Edit</a>
        <form method="post" action="/admin/reports/schedules/${s.id}/run" data-confirm="Send &quot;${esc(s.name)}&quot; now to ${s.recipients.length} recipient${s.recipients.length === 1 ? '' : 's'}, for the last complete period?"><button class="btn ghost" type="submit">Send now</button></form>
        <form method="post" action="/admin/reports/schedules/${s.id}/toggle"><input type="hidden" name="enabled" value="${s.enabled ? 'false' : 'true'}"><button class="btn ghost" type="submit">${s.enabled ? 'Pause' : 'Resume'}</button></form>
        <form method="post" action="/admin/reports/schedules/${s.id}/delete" data-confirm="Delete the scheduled report &quot;${esc(s.name)}&quot;?"><button class="btn ghost danger" type="submit">Delete</button></form></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">No scheduled reports yet. Create one below.</td></tr>'}</tbody></table></div>`;

  const e = edit || { name: '', recipients: [], frequency: 'monthly', run_day: 1, send_hour: 7, groups: null, sections: R.STANDARD_SECTIONS };
  const editCustom = R.isCustom(e.sections);
  const scheduleForm = `<form class="rules mt" method="post" action="/admin/reports/schedules" id="schedule">
    <h3>${edit ? `Edit "${esc(edit.name)}"` : 'New scheduled report'}</h3>
    ${edit ? `<input type="hidden" name="id" value="${edit.id}">` : ''}
    <div class="field"><label for="s-name">Name</label><input id="s-name" name="name" required maxlength="120" value="${esc(e.name)}" placeholder="e.g. Monthly CSAT – RxIT manufacturing"></div>
    <div class="field"><label for="s-to">Recipients</label><textarea id="s-to" name="to_emails" rows="2" required placeholder="name@essilor.com, name2@luxottica.com">${esc(e.recipients.join(', '))}</textarea>${recipientHelp}</div>
    <div class="inline" data-frequency>
      <label class="small">How often <select name="frequency">${Object.entries(R.FREQUENCIES).map(([k, l]) => `<option value="${k}" ${e.frequency === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="small" data-when="weekly">On <select name="weekday">${R.WEEKDAYS.map((d, i) => `<option value="${i + 1}" ${e.frequency === 'weekly' && e.run_day === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="small" data-when="monthly quarterly">On day <select name="monthday">${Array.from({ length: 28 }, (_, i) => `<option ${e.frequency !== 'weekly' && e.run_day === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      <label class="small">At <select name="send_hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${e.send_hour === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
    </div>
    <p class="small muted">Each report covers the last complete week (Monday–Sunday), month or quarter, compared with the one before. Quarterly reports go out in January, April, July and October. Times are server time.</p>
    ${groupPicker('s', groups, e.groups, team)}
    ${sectionPicker('s', e.sections, R.SECTIONS, editCustom)}
    <div class="inline"><button class="btn" type="submit">${edit ? 'Save changes' : 'Create scheduled report'}</button>${edit ? '<a class="btn ghost" href="/admin/reports#schedule">Cancel</a>' : ''}</div>
  </form>`;

  const kinds = { download: 'Downloaded', send: 'Emailed', scheduled: 'Scheduled email' };
  const history = `<div class="card"><div class="ch"><h3>Recent reports</h3><span class="small muted">Last 30${team ? ', yours' : ''}</span></div>
    <div class="tw"><table><thead><tr><th>When</th><th>What</th><th>Period</th><th>Owner groups</th><th>Recipients</th><th>By</th><th>Result</th></tr></thead><tbody>
    ${runs.map(r => `<tr><td class="small" style="white-space:nowrap">${fmtDateTime(r.at)}</td><td class="small">${kinds[r.kind] || esc(r.kind)}${r.schedule_name ? `<div class="muted">${esc(r.schedule_name)}</div>` : ''}${R.isCustom(r.sections || []) ? ' <span class="pill neutral">custom</span>' : ''}</td>
      <td class="small">${esc(R.periodLabel(new Date(r.period_from), new Date(r.period_to)))}</td><td class="small">${esc(groupText(r.groups))}</td>
      <td class="small">${(r.recipients || []).map(esc).join('<br>') || '<span class="muted">–</span>'}</td><td class="small">${esc(r.actor)}</td>
      <td class="small">${r.status === 'ok' ? '<span class="pill good">ok</span>' : `<span class="pill bad">failed</span><div class="err">${esc(clip(r.error || '', 140))}</div>`}</td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">No reports yet.</td></tr>'}</tbody></table></div></div>`;

  const body = `<section class="panel"><div><div class="eyebrow">${team ? 'Team admin' : 'Admin'}</div><h1>Reports</h1>
    <p class="lead">PDF reports of the CSAT figures for stakeholders${team ? ', for your owner groups' : ''}. They use the same numbers as the dashboard.
      Standard reports leave out agent names; choose <b>Custom report</b> to add ticket owners.</p></div>
    ${notice ? `<p class="ok" role="status">${esc(notice)}</p>` : ''}${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
    ${adhoc}
    <div class="card"><div class="ch"><h3>Scheduled reports</h3><span class="small muted">Emailed automatically with the PDF attached</span></div>${list}${scheduleForm}</div>
    ${history}</section>`;
  return layout({ title: 'Reports', body, admin, active: 'reports', scripts: ['/assets/reports.js'], help: 'report-download' });
}

module.exports = { layout, surveyPage, messagePage, dashboardPage, settingsPage, groupSettingsPage, surveysPage, missingPage, testPage, reportsPage, ymd };
