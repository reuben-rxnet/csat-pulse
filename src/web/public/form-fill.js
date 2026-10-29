(function () {
  'use strict';
  // Answer page: saves as people go, shows progress, and points to unanswered required questions before submitting.
  const form = document.getElementById('fill-form');
  if (!form) return;
  const t0 = Date.now(), statusEl = document.getElementById('fill-status'), bar = document.getElementById('fill-bar');
  const elapsed = () => Math.round((Date.now() - t0) / 1000);
  const qs = [...form.querySelectorAll('.fq')];

  function answered(q) {
    const type = q.dataset.type;
    if (type === 'likert') { const rows = q.querySelectorAll('.lkf-row:not(.lkf-headrow)'); return [...rows].every(r => r.querySelector('input:checked')); }
    if (type === 'text') { const i = q.querySelector('textarea,input'); return !!i.value.trim(); }
    return !!q.querySelector('input:checked');
  }
  function progress() {
    const done = qs.filter(answered).length;
    bar.style.width = qs.length ? (done / qs.length) * 100 + '%' : '0';
    bar.parentElement.title = `${done} of ${qs.length} answered`;
  }

  // ---------- autosave ----------
  let timer = null, busy = false, pending = false;
  const say = t => { if (statusEl) statusEl.textContent = t; };
  async function save() {
    if (!form.dataset.save) return;
    if (busy) { pending = true; return; }
    busy = true;
    form.elements._elapsed.value = elapsed();
    try {
      const r = await fetch(form.dataset.save, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(form)) });
      const j = await r.json().catch(() => ({}));
      say(j.ok ? 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' – you can finish later' : j.error === 'closed' ? 'This survey is closed.' : 'Not saved – check your connection');
    } catch { say('Not saved – check your connection'); }
    finally { busy = false; if (pending) { pending = false; save(); } }
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(save, 900); };
  form.addEventListener('change', e => { const q = e.target.closest('.fq'); if (q && answered(q)) clear(q); progress(); later(); });
  form.addEventListener('input', e => { if (e.target.matches('textarea,input[type=text]')) { progress(); later(); } });

  // ---------- submit ----------
  const clear = q => { q.classList.remove('has-err'); const p = q.querySelector('.fq-err'); if (p) p.hidden = true; };
  form.addEventListener('submit', e => {
    if (form.hasAttribute('data-preview')) { e.preventDefault(); return; }
    form.elements._elapsed.value = elapsed();
    const missing = qs.filter(q => q.hasAttribute('data-required') && !answered(q));
    qs.forEach(clear);
    if (missing.length) {
      e.preventDefault();
      missing.forEach(q => { q.classList.add('has-err'); const p = q.querySelector('.fq-err'); if (p) { p.hidden = false; p.textContent = q.dataset.type === 'likert' && q.querySelectorAll('.lkf-row:not(.lkf-headrow)').length > 1 ? 'Please answer every row.' : 'This question is required.'; } });
      missing[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      const f = missing[0].querySelector('input,textarea'); if (f) f.focus({ preventScroll: true });
      say(`${missing.length} required question${missing.length === 1 ? '' : 's'} still to answer`);
      return;
    }
    clearTimeout(timer);
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Submitting…';
  });
  progress();
  const firstErr = form.querySelector('.fq.has-err'); if (firstErr) firstErr.scrollIntoView({ block: 'center' });
})();
