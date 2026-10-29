(function () {
  'use strict';
  // Survey builder: edits the survey as JSON and autosaves it to /admin/forms/:id/save.
  const root = document.getElementById('builder');
  const state = JSON.parse(document.getElementById('form-data').textContent);
  let cover = 'keep'; // 'keep' | data URL | null (removed)
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const id = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(16).padStart(2, '0')).join('');
  const SCALES = {
    Satisfaction: ['Very Unsatisfied', 'Unsatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'],
    Agreement: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
    Quality: ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'],
    Frequency: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'],
  };
  const TYPES = [
    ['likert', 'Rating grid', 'Rows rated on the same scale'], ['choice', 'Choice', 'Pick one option'], ['checkbox', 'Multiple choice', 'Pick any options'],
    ['text', 'Text', 'Short or long answer'], ['rating', 'Star rating', '1–5 stars'], ['nps', 'Net Promoter Score', '0–10 recommend'], ['section', 'Section', 'Heading for a group of questions'],
  ];
  const LABEL = Object.fromEntries(TYPES.map(t => [t[0], t[1]]));
  const blank = type => ({
    section: { type, title: 'New section', description: '' },
    likert: { type, title: '', description: '', required: true, scale: [...SCALES.Satisfaction], rows: [{ id: id(), label: '', hint: '' }] },
    choice: { type, title: '', description: '', required: true, options: [{ id: id(), label: 'Option 1' }, { id: id(), label: 'Option 2' }] },
    checkbox: { type, title: '', description: '', required: false, options: [{ id: id(), label: 'Option 1' }, { id: id(), label: 'Option 2' }] },
    text: { type, title: '', description: '', required: true, long: true },
    rating: { type, title: '', description: '', required: true, max: 5 },
    nps: { type, title: 'How likely are you to recommend us to a friend or colleague?', description: '', required: true, low: 'Not at all likely', high: 'Extremely likely' },
  }[type]);

  // ---------- saving ----------
  let timer = null, saving = false, again = false, dirty = false;
  const status = (t, cls = '') => { const el = document.getElementById('b-status'); if (el) { el.textContent = t; el.className = 'b-status ' + cls; } };
  function changed() { dirty = true; status('Unsaved changes…', 'pending'); clearTimeout(timer); timer = setTimeout(save, 700); }
  async function save() {
    if (saving) { again = true; return; }
    saving = true; dirty = false; status('Saving…', 'pending');
    try {
      const r = await fetch(`/admin/forms/${state.id}/save`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: state.title, description: state.description, coverImage: cover, closesAt: state.closesAt, settings: state.settings, questions: state.questions }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || r.statusText);
      if (cover !== 'keep') cover = 'keep';
      status('All changes saved ' + new Date(j.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), 'ok');
      document.title = `Edit · ${state.title} · CSAT Pulse`;
    } catch (e) { dirty = true; status('Not saved: ' + e.message + ' – retrying…', 'bad'); setTimeout(save, 5000); }
    finally { saving = false; if (again) { again = false; save(); } }
  }
  addEventListener('beforeunload', e => { if (dirty || saving) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- rendering ----------
  const numberOf = i => state.questions.slice(0, i + 1).filter(q => q.type !== 'section').length;
  const addBar = (at, big = false) => `<div class="b-add${big ? ' big' : ''}" data-at="${at}">
    ${big ? '<div class="b-add-title">Add a question</div>' : '<button type="button" class="b-add-toggle" aria-label="Insert here">+</button>'}
    <div class="b-add-menu"${big ? '' : ' hidden'}>${TYPES.map(([t, l, d]) => `<button type="button" data-add="${t}" title="${esc(d)}"><b>${l}</b><small>${d}</small></button>`).join('')}</div></div>`;
  const listEditor = (q, i, key, label) => `<div class="b-list">${q[key].map((o, j) => `<div class="b-li">
      <span class="b-li-mark">${q.type === 'checkbox' ? '☐' : q.type === 'choice' ? '○' : j + 1}</span>
      <input data-i="${i}" data-list="${key}" data-j="${j}" data-f="label" value="${esc(o.label)}" placeholder="${label} ${j + 1}" maxlength="300">
      ${key === 'rows' ? `<input class="b-hint" data-i="${i}" data-list="rows" data-j="${j}" data-f="hint" value="${esc(o.hint || '')}" placeholder="Explanation (optional)" maxlength="300">` : ''}
      <button type="button" class="b-x" data-act="rm-${key}" data-i="${i}" data-j="${j}" aria-label="Remove ${label.toLowerCase()} ${j + 1}" ${q[key].length < 2 ? 'disabled' : ''}>×</button></div>`).join('')}
    <button type="button" class="b-more" data-act="add-${key}" data-i="${i}">+ Add ${label.toLowerCase()}</button></div>`;
  function editor(q, i) {
    switch (q.type) {
      case 'likert': return `${listEditor(q, i, 'rows', 'Row')}
        <div class="b-scale"><div class="b-scale-head"><span class="small b">Answer scale</span>
          <select data-act="preset" data-i="${i}" aria-label="Scale preset"><option value="">Preset…</option>${Object.keys(SCALES).map(k => `<option>${k}</option>`).join('')}</select>
          <button type="button" class="b-more" data-act="add-scale" data-i="${i}" ${q.scale.length >= 7 ? 'disabled' : ''}>+ point</button>
          <button type="button" class="b-more" data-act="rm-scale" data-i="${i}" ${q.scale.length <= 2 ? 'disabled' : ''}>− point</button></div>
          <div class="b-chips">${q.scale.map((s, j) => `<input data-i="${i}" data-scale="${j}" value="${esc(s)}" maxlength="60" aria-label="Scale point ${j + 1}">`).join('')}</div></div>`;
      case 'choice': case 'checkbox': return `${listEditor(q, i, 'options', 'Option')}
        <label class="chk small"><input type="checkbox" data-act="multi" data-i="${i}" ${q.type === 'checkbox' ? 'checked' : ''}> Allow more than one answer</label>`;
      case 'text': return `<div class="b-preview-in">${q.long ? '<div class="fake-ta">Long answer</div>' : '<div class="fake-in">Short answer</div>'}</div>
        <label class="chk small"><input type="checkbox" data-act="long" data-i="${i}" ${q.long ? 'checked' : ''}> Long answer (several lines)</label>`;
      case 'rating': return `<div class="b-stars">${'★'.repeat(q.max)}</div><label class="small">Stars <select data-act="max" data-i="${i}">${[3, 4, 5, 7, 10].map(n => `<option ${q.max === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
      case 'nps': return `<div class="b-nps">${Array.from({ length: 11 }, (_, n) => `<span>${n}</span>`).join('')}</div>
        <div class="b-nps-ends"><input data-i="${i}" data-f="low" value="${esc(q.low)}" maxlength="60" aria-label="Label for 0"><input data-i="${i}" data-f="high" value="${esc(q.high)}" maxlength="60" aria-label="Label for 10"></div>`;
      default: return '';
    }
  }
  function card(q, i) {
    const n = state.questions.length;
    const tools = `<div class="b-tools">
      <button type="button" data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" data-act="down" data-i="${i}" aria-label="Move down" ${i === n - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" data-act="dup" data-i="${i}" aria-label="Duplicate">⧉</button>
      <button type="button" data-act="del" data-i="${i}" aria-label="Delete" class="danger">🗑</button></div>`;
    if (q.type === 'section') return `<div class="b-card b-section" data-card="${i}">
      <div class="b-card-top"><span class="b-drag" draggable="true" data-drag="${i}" title="Drag to move" aria-hidden="true">⋮⋮</span><span class="b-type">Section</span>${tools}</div>
      <input class="b-sec-title" data-i="${i}" data-f="title" value="${esc(q.title)}" placeholder="Section title" maxlength="500">
      <textarea data-i="${i}" data-f="description" rows="1" placeholder="Description (optional)" maxlength="2000">${esc(q.description || '')}</textarea></div>`;
    return `<div class="b-card" data-card="${i}">
      <div class="b-card-top"><span class="b-drag" draggable="true" data-drag="${i}" title="Drag to move" aria-hidden="true">⋮⋮</span><span class="b-num">${numberOf(i)}</span><span class="b-type">${LABEL[q.type]}</span>${tools}</div>
      <input class="b-q-title" data-i="${i}" data-f="title" value="${esc(q.title)}" placeholder="Question" maxlength="500">
      <textarea data-i="${i}" data-f="description" rows="1" placeholder="Description or instructions (optional)" maxlength="2000">${esc(q.description || '')}</textarea>
      ${editor(q, i)}
      <div class="b-card-foot"><label class="switch-l"><span class="switch"><input type="checkbox" data-act="req" data-i="${i}" ${q.required ? 'checked' : ''}><span></span></span> Required</label></div></div>`;
  }
  function render() {
    const coverSrc = cover === 'keep' ? state.coverImage : cover;
    root.innerHTML = `<div class="b-bar"><span id="b-status" class="b-status ok">All changes saved</span>
        <span class="grow"></span><a class="btn ghost" href="/admin/forms/${state.id}/preview" target="_blank" rel="noopener">Preview</a><a class="btn" href="/admin/forms/${state.id}/send">Next: send →</a></div>
      <div class="b-card b-head">
        <div class="b-cover">${coverSrc ? `<img src="${esc(coverSrc)}" alt="Cover image">` : ''}
          <div class="b-cover-tools"><label class="btn ghost">${coverSrc ? 'Change image' : 'Add cover image'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden data-act="cover"></label>
          ${coverSrc ? '<button type="button" class="btn ghost danger" data-act="rm-cover">Remove</button>' : ''}</div></div>
        <input class="b-form-title" data-top="title" value="${esc(state.title)}" placeholder="Survey title" maxlength="300" aria-label="Survey title">
        <textarea class="b-form-desc" data-top="description" rows="3" placeholder="Introduction shown at the top of the survey (optional)" maxlength="4000" aria-label="Introduction">${esc(state.description || '')}</textarea>
      </div>
      ${state.questions.map((q, i) => addBar(i) + card(q, i)).join('')}
      ${addBar(state.questions.length, true)}`;
    root.querySelectorAll('textarea').forEach(autosize);
  }
  const autosize = t => { t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight, 38) + 'px'; };

  // ---------- editing ----------
  function move(from, to) {
    if (to < 0 || to >= state.questions.length || from === to) return;
    const [q] = state.questions.splice(from, 1); state.questions.splice(to, 0, q);
  }
  function rerender(focusCard) {
    const y = scrollY; render(); scrollTo(0, y);
    if (focusCard != null) { const c = root.querySelector(`[data-card="${focusCard}"]`); if (c) { c.classList.add('flash'); const f = c.querySelector('input,textarea'); if (f) f.focus({ preventScroll: true }); } }
    changed();
  }
  root.addEventListener('input', e => {
    const t = e.target, i = +t.dataset.i;
    if (t.dataset.top) { state[t.dataset.top] = t.value; if (t.tagName === 'TEXTAREA') autosize(t); return changed(); }
    if (Number.isNaN(i) || !state.questions[i]) return;
    const q = state.questions[i];
    if (t.dataset.list) q[t.dataset.list][+t.dataset.j][t.dataset.f] = t.value;
    else if (t.dataset.scale !== undefined) q.scale[+t.dataset.scale] = t.value;
    else if (t.dataset.f) q[t.dataset.f] = t.value;
    if (t.tagName === 'TEXTAREA') autosize(t);
    changed();
  });
  root.addEventListener('change', e => {
    const t = e.target, i = +t.dataset.i, q = state.questions[i], act = t.dataset.act;
    if (act === 'req') { q.required = t.checked; return changed(); }
    if (act === 'multi') { q.type = t.checked ? 'checkbox' : 'choice'; return rerender(); }
    if (act === 'long') { q.long = t.checked; return rerender(); }
    if (act === 'max') { q.max = +t.value; return rerender(); }
    if (act === 'preset' && SCALES[t.value]) { q.scale = [...SCALES[t.value]]; return rerender(); }
    if (act === 'cover' && t.files[0]) loadCover(t.files[0]);
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('b-add-toggle')) { const m = b.parentElement.querySelector('.b-add-menu'); m.hidden = !m.hidden; return; }
    if (b.dataset.add) {
      const at = +b.closest('.b-add').dataset.at, q = { id: id(), ...blank(b.dataset.add) };
      state.questions.splice(at, 0, q); return rerender(at);
    }
    const act = b.dataset.act, i = +b.dataset.i, j = +b.dataset.j, q = state.questions[i];
    switch (act) {
      case 'up': move(i, i - 1); return rerender(i - 1);
      case 'down': move(i, i + 1); return rerender(i + 1);
      case 'dup': { const c = JSON.parse(JSON.stringify(q)); c.id = id(); (c.rows || []).forEach(r => (r.id = id())); (c.options || []).forEach(o => (o.id = id())); state.questions.splice(i + 1, 0, c); return rerender(i + 1); }
      case 'del': if (confirm(`Delete "${q.title || LABEL[q.type]}"?${state.responses ? ' Its answers will no longer show in the results.' : ''}`)) { state.questions.splice(i, 1); rerender(); } return;
      case 'add-rows': q.rows.push({ id: id(), label: '', hint: '' }); return rerender(), focusLast(i);
      case 'add-options': q.options.push({ id: id(), label: `Option ${q.options.length + 1}` }); return rerender(), focusLast(i);
      case 'rm-rows': q.rows.splice(j, 1); return rerender();
      case 'rm-options': q.options.splice(j, 1); return rerender();
      case 'add-scale': q.scale.push('New point'); return rerender();
      case 'rm-scale': q.scale.pop(); return rerender();
      case 'rm-cover': cover = null; state.coverImage = null; return rerender();
    }
  });
  const focusLast = i => { const c = root.querySelector(`[data-card="${i}"]`); const ins = c && c.querySelectorAll('.b-li input:not(.b-hint)'); if (ins && ins.length) ins[ins.length - 1].focus(); };

  // Cover image: shrunk in the browser to at most 1600 px wide (JPEG), so pages stay fast.
  function loadCover(file) {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const w = Math.min(1600, img.width), h = Math.round(img.height * (w / img.width));
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cover = c.toDataURL('image/jpeg', 0.85); state.coverImage = cover;
      if (cover.length > 2_000_000) { alert('That image is too large even after shrinking. Please choose a smaller one.'); cover = 'keep'; return; }
      rerender();
    };
    img.onerror = () => alert('That file could not be read as an image.');
    img.src = url;
  }

  // Drag and drop by the ⋮⋮ handle.
  let dragFrom = null;
  root.addEventListener('dragstart', e => { const h = e.target.closest('[data-drag]'); if (!h) return; dragFrom = +h.dataset.drag; e.dataTransfer.effectAllowed = 'move'; h.closest('.b-card').classList.add('dragging'); });
  root.addEventListener('dragover', e => { if (dragFrom === null) return; const c = e.target.closest('[data-card]'); if (!c) return; e.preventDefault(); root.querySelectorAll('.drop-to').forEach(x => x.classList.remove('drop-to')); c.classList.add('drop-to'); });
  root.addEventListener('drop', e => { if (dragFrom === null) return; const c = e.target.closest('[data-card]'); e.preventDefault(); if (c) { const to = +c.dataset.card; move(dragFrom, to); dragFrom = null; rerender(to); } });
  root.addEventListener('dragend', () => { dragFrom = null; root.querySelectorAll('.dragging,.drop-to').forEach(x => x.classList.remove('dragging', 'drop-to')); });

  render();
})();
