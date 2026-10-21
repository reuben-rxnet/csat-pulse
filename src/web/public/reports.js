(function () {
  'use strict';
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Period presets on "Create a report".
  const presets = {
    'last-month': n => [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)],
    'this-month': n => [new Date(n.getFullYear(), n.getMonth(), 1), n],
    'last-4w': n => [new Date(n.getFullYear(), n.getMonth(), n.getDate() - 27), n],
    'last-quarter': n => { const q = Math.floor(n.getMonth() / 3) * 3; return [new Date(n.getFullYear(), q - 3, 1), new Date(n.getFullYear(), q, 0)]; },
    'this-year': n => [new Date(n.getFullYear(), 0, 1), n],
  };
  document.querySelectorAll('[data-presets]').forEach(seg => {
    const form = seg.closest('form');
    seg.addEventListener('click', e => {
      const b = e.target.closest('[data-preset]'); if (!b) return;
      const [from, to] = presets[b.dataset.preset](new Date());
      form.elements.from.value = ymd(from); form.elements.to.value = ymd(to);
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    ['from', 'to'].forEach(k => form.elements[k].addEventListener('input', () => seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false'))));
  });

  // Owner groups: "All" switches the individual boxes off; search filters the list.
  document.querySelectorAll('[data-picker]').forEach(p => {
    const all = p.querySelector('[data-all]'), boxes = () => p.querySelectorAll('input[name=groups]');
    const sync = () => boxes().forEach(b => { b.disabled = all.checked; });
    all.addEventListener('change', sync); sync();
    const s = p.querySelector('[data-search]');
    if (s) s.addEventListener('input', () => { const q = s.value.trim().toLowerCase(); p.querySelectorAll('.picker-list label').forEach(l => { l.hidden = q && !l.dataset.name.includes(q); }); });
  });

  // Report type: the section boxes only apply to a custom report.
  document.querySelectorAll('[data-sections]').forEach(f => {
    const sync = () => { const custom = f.querySelector('input[name=type][value=custom]').checked; f.querySelectorAll('input[name=sections]').forEach(b => { b.disabled = !custom; }); };
    f.addEventListener('change', sync); sync();
  });

  // Schedule: show the weekday for weekly reports, the day of the month otherwise.
  document.querySelectorAll('[data-frequency]').forEach(w => {
    const sel = w.querySelector('select[name=frequency]');
    const sync = () => w.querySelectorAll('[data-when]').forEach(l => { l.hidden = !l.dataset.when.split(' ').includes(sel.value); });
    sel.addEventListener('change', sync); sync();
  });

  // Form checks before submitting.
  document.querySelectorAll('form').forEach(form => form.addEventListener('submit', e => {
    const btn = e.submitter;
    const picker = form.querySelector('[data-picker]');
    if (picker && !picker.querySelector('[data-all]').checked && !picker.querySelector('input[name=groups]:checked')) { e.preventDefault(); alert('Tick "All" or at least one owner group.'); return; }
    const secs = form.querySelector('[data-sections]');
    if (secs && secs.querySelector('input[name=type][value=custom]').checked && !secs.querySelector('input[name=sections]:checked')) {
      if (!confirm('No parts ticked: the report will only show the main figures. Continue?')) { e.preventDefault(); return; }
    }
    if (btn && btn.hasAttribute('data-needs-recipients')) {
      const to = form.elements.to_emails;
      if (!to.value.trim()) { e.preventDefault(); alert('Enter at least one email address to send the report to.'); to.focus(); return; }
      const n = to.value.split(/[\s,;]+/).filter(Boolean).length;
      if (!confirm(`Send this report to ${n} recipient${n === 1 ? '' : 's'} now?`)) { e.preventDefault(); return; }
    }
    if (form.dataset.confirm && !confirm(form.dataset.confirm)) e.preventDefault();
  }));
})();
