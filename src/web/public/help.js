(function () {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Opens the "How do I…" entry or question a link points to (e.g. the menu's Help link: /admin/help#missing-email).
  const openHash = () => {
    const el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!el) return;
    if (el.tagName === 'DETAILS') el.open = true;
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
    el.scrollIntoView({ block: 'start' });
  };
  window.addEventListener('hashchange', openHash); openHash();

  // Contents: highlight the section being read.
  const links = new Map([...document.querySelectorAll('[data-toc]')].map(a => [a.dataset.toc, a]));
  if ('IntersectionObserver' in window) {
    const visible = new Set();
    const mark = () => {
      const first = [...document.querySelectorAll('.help-sec')].find(s => visible.has(s.id));
      links.forEach((a, id) => a.setAttribute('aria-current', String(!!first && id === first.id)));
    };
    const io = new IntersectionObserver(es => { es.forEach(e => (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id))); mark(); }, { rootMargin: '-10% 0px -55% 0px' });
    document.querySelectorAll('.help-sec').forEach(s => io.observe(s));
  }

  // ---------- search ----------
  // Words that don't help find anything ("how do I switch on a group" → switch, on, group).
  const STOP = new Set('a an the and or of to in for with at by from is are be can could do does did how i me my we our you your it its this that these those what which who whom where when get got want need please didnt didn dont don doesnt doesn t s there here about into using use'.split(' '));
  // Rough stemming so "switching", "switched" and "switches" all match "switch", "emails" matches "email".
  const stem = w => w.length > 4 ? w.replace(/(ings|ing|ed|es|s)$/, '') : w;
  const words = text => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9%]+/).filter(Boolean);
  const terms = q => { const all = words(q); const kept = all.filter(w => !STOP.has(w)); return [...new Set((kept.length ? kept : all).map(stem))]; };
  // Words of 3+ letters also match as a prefix ("sched" → schedule); shorter ones ("no", "on") only as a whole word.
  const hits = (list, t) => list.some(w => w === t || (t.length >= 3 && w.startsWith(t)));

  const items = [...document.querySelectorAll('[data-title]')].map(el => {
    const title = el.dataset.title, href = el.tagName === 'A' ? el.getAttribute('href') : '#' + el.id;
    return { el, title, kind: el.dataset.kind, href, isPage: el.tagName === 'A',
      t: words(title).map(stem), k: words(el.dataset.keys || '').map(stem), b: el.hasAttribute('data-nobody') ? [] : words(el.textContent).map(stem),
      phrase: (title + ' ' + (el.dataset.keys || '')).toLowerCase() };
  });
  // Rare words count more than words found everywhere (like "survey").
  const weight = t => { const df = items.filter(it => hits(it.t, t) || hits(it.k, t) || hits(it.b, t)).length; return Math.log(1 + items.length / (1 + df)); };

  function search(q) {
    const qs = terms(q);
    if (!qs.length) return { list: [], close: false };
    const w = new Map(qs.map(t => [t, weight(t)]));
    const phrase = words(q).filter(x => !STOP.has(x)).join(' ');
    const scored = items.map(it => {
      let score = 0, matched = 0;
      for (const t of qs) {
        const s = hits(it.t, t) ? 4 : hits(it.k, t) ? 3 : hits(it.b, t) ? 1 : 0;
        if (s) matched++; score += s * w.get(t);
      }
      if (phrase.includes(' ') && it.phrase.includes(phrase)) score += 6; // the words typed appear together
      if (it.kind === 'Feature') score -= 0.5; // guides answer "how do I" better than page cards
      return { it, score, matched };
    }).filter(r => r.matched);
    const full = scored.filter(r => r.matched === qs.length);
    const pool = full.length ? full : scored.filter(r => r.matched >= Math.ceil(qs.length / 2));
    return { list: pool.sort((a, b) => b.score - a.score || a.it.title.length - b.it.title.length).slice(0, 8).map(r => r.it), close: !full.length };
  }

  const box = document.getElementById('help-search'), panel = document.getElementById('help-results');
  let results = [], active = -1;
  const highlight = (text, q) => {
    const qs = terms(q);
    return text.split(/(\s+)/).map(w => (w.trim() && qs.some(t => hits(words(w).map(stem), t)) ? `<mark>${esc(w)}</mark>` : esc(w))).join('');
  };
  function render() {
    const q = box.value.trim();
    if (!q) { panel.hidden = true; box.setAttribute('aria-expanded', 'false'); return; }
    const r = search(q);
    results = r.list; active = results.length ? 0 : -1;
    panel.innerHTML = results.length
      ? (r.close ? '<div class="hr-note">No exact match – closest results:</div>' : '')
        + results.map((it, i) => `<a role="option" id="hr-${i}" class="hr-item" href="${esc(it.href)}" aria-selected="${i === active}">
            <span class="hr-kind">${esc(it.kind)}</span><span class="hr-title">${highlight(it.title, q)}</span>${it.isPage ? '<span class="hr-go">Open page →</span>' : ''}</a>`).join('')
      : `<div class="hr-none">Nothing found for “${esc(q)}”. Try fewer or other words, or <a href="#contact">ask for help</a>.</div>`;
    panel.hidden = false; box.setAttribute('aria-expanded', 'true');
    box.setAttribute('aria-activedescendant', active >= 0 ? 'hr-' + active : '');
  }
  function move(d) {
    if (!results.length) return;
    active = (active + d + results.length) % results.length;
    panel.querySelectorAll('.hr-item').forEach((a, i) => a.setAttribute('aria-selected', String(i === active)));
    box.setAttribute('aria-activedescendant', 'hr-' + active);
    panel.querySelector(`#hr-${active}`).scrollIntoView({ block: 'nearest' });
  }
  function go(it) {
    panel.hidden = true; box.setAttribute('aria-expanded', 'false');
    if (it.isPage) { location.href = it.href; return; }
    if (location.hash === it.href) openHash(); else location.hash = it.href;
  }
  box.addEventListener('input', render);
  box.addEventListener('focus', () => { if (box.value.trim()) render(); });
  box.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) go(results[active]); }
    else if (e.key === 'Escape') { panel.hidden = true; box.setAttribute('aria-expanded', 'false'); }
  });
  panel.addEventListener('click', e => {
    const a = e.target.closest('.hr-item'); if (!a) return;
    e.preventDefault(); go(results[+a.id.slice(3)]);
  });
  document.addEventListener('click', e => { if (!e.target.closest('.help-searchwrap')) { panel.hidden = true; box.setAttribute('aria-expanded', 'false'); } });
  // "/" jumps to the search box, like many help centres.
  document.addEventListener('keydown', e => { if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); box.focus(); box.select(); } });
})();
