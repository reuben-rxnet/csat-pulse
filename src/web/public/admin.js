(function () {
  'use strict';
  const toastEl = document.getElementById('toast');
  let tt;
  function toast(m) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(tt); tt = setTimeout(() => (toastEl.hidden = true), 2400); }
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  }
  function counts() {
    const g = [...document.querySelectorAll('input[data-kind=group]')], s = [...document.querySelectorAll('input[data-kind=source]')];
    const gc = document.getElementById('g-count'), sc = document.getElementById('s-count');
    if (gc) gc.textContent = `${g.filter(x => x.checked).length} of ${g.length} switched on`;
    if (sc) sc.textContent = `${s.filter(x => x.checked).length} of ${s.length} switched on`;
  }
  document.querySelectorAll('input[data-kind]').forEach(i => i.addEventListener('change', async () => {
    const kind = i.dataset.kind;
    // Say what switching a group on means before it starts emailing people.
    if (kind === 'group' && i.checked) {
      const n = Number(i.dataset.closed || 0);
      const msg = `Switch on surveys for ${i.dataset.label}?\n\n` + (n
        ? `CSAT Pulse saw ${n} closed ticket${n === 1 ? '' : 's'} for this group in the last 30 days. Their requesters may get a survey (subject to the group's sources and rules).`
        : 'CSAT Pulse saw no closed tickets for this group in the last 30 days.');
      if (!confirm(msg)) { i.checked = false; return; }
    }
    try {
      await post(`/admin/api/${kind === 'group' ? 'groups' : 'sources'}/toggle`, { id: i.dataset.id, enabled: i.checked });
      const row = i.closest('.row'); if (row && kind === 'group') row.dataset.on = String(i.checked);
      toast(`Surveys switched ${i.checked ? 'on' : 'off'} for ${kind === 'group' ? i.dataset.label : 'this source'}`); counts();
    } catch (e) { i.checked = !i.checked; toast('Could not save: ' + e.message); }
  }));
  document.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', async () => {
    const on = b.dataset.on === 'true';
    if (!confirm(on ? 'Switch surveys on for ALL owner groups?' : 'Switch surveys off for all owner groups? No group will send surveys until you switch them back on.')) return;
    try {
      await post('/admin/api/groups/bulk', { enabled: on });
      document.querySelectorAll('input[data-kind=group]').forEach(i => { i.checked = on; const r = i.closest('.row'); if (r) r.dataset.on = String(on); }); counts(); applyFilter();
      toast(on ? 'All owner groups enabled' : 'All owner groups disabled');
    } catch (e) { toast('Could not save: ' + e.message); }
  }));
  document.querySelectorAll('input.lead').forEach(i => i.addEventListener('change', async () => {
    if (i.value && !i.checkValidity()) { toast('Enter a valid email address'); return; }
    try { await post('/admin/api/groups/lead', { id: i.dataset.id, email: i.value.trim() }); toast('Group lead saved'); }
    catch (e) { toast('Could not save: ' + e.message); }
  }));
  // Group settings: "Use the default …" turns the group's own choices off (disabled fields aren't submitted).
  document.querySelectorAll('input[data-default-for]').forEach(c => c.addEventListener('change', () => {
    const fs = document.getElementById(c.dataset.defaultFor);
    if (fs) fs.disabled = c.checked;
  }));
  // Group list: search box + All / Switched on / Tickets in last 30 days.
  const search = document.getElementById('g-search');
  const filterBtns = [...document.querySelectorAll('#g-filter [data-filter]')];
  function applyFilter() {
    const q = search ? search.value.toLowerCase() : '';
    const f = (filterBtns.find(b => b.getAttribute('aria-pressed') === 'true') || {}).dataset?.filter || 'all';
    let shown = 0;
    document.querySelectorAll('#g-list .row').forEach(r => {
      const ok = r.dataset.name.includes(q) && (f === 'all' || (f === 'on' && r.dataset.on === 'true') || (f === 'active' && r.dataset.active === 'true'));
      r.hidden = !ok; if (ok) shown++;
    });
    const empty = document.getElementById('g-empty'); if (empty) empty.hidden = shown > 0 || !document.querySelector('#g-list .row');
  }
  filterBtns.forEach(b => b.addEventListener('click', () => { filterBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b))); applyFilter(); }));
  if (search) search.addEventListener('input', applyFilter);
  applyFilter();
})();
