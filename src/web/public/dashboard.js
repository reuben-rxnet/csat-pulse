(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = v => v !== null && v !== undefined && isFinite(v);
  const pct = (v, d = 1) => (ok(v) ? (v * 100).toFixed(d) + '%' : '–');
  const fmtD = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fmtDY = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const num = v => (ok(v) ? Math.round(v).toLocaleString('en-GB') : '–');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MIN_N = 5;
  const LABELS = ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'];
  const ICON = {
    smile: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01', star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
    reply: 'M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v2', send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z', alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', up: 'M7 17L17 7M9 7h8v8', down: 'M7 7l10 10M17 9v8H9', trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
    target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  };
  const ico = (n, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[n]}"/></svg>`;

  // ---------- state (kept in the address bar, so a view can be bookmarked or shared) ----------
  const url = new URLSearchParams(location.search);
  const st = { weeks: +url.get('weeks') || 12, group: url.get('group') || '', source: url.get('source') || '', type: url.get('type') || '', priority: url.get('priority') || '' };
  let target = 0.85, data = null, metric = 'csat', bdKey = 'bySource', fuMode = 'open', first = true;

  // ---------- small helpers ----------
  function countUp(el, to, fmt, ms = 900) {
    if (!ok(to) || reduce || !first) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = t => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function deltaChip(cur, prev, { isPct = false, digits = 2, higherIsBetter = true, unit = '' } = {}) {
    if (!ok(cur) || !ok(prev)) return '<span class="dchip none">no earlier data</span>';
    const d = cur - prev, flat = Math.abs(d) < 1e-9, good = flat ? null : (d > 0) === higherIsBetter;
    const txt = isPct ? `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} pts` : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(digits)}${unit}`;
    return `<span class="dchip ${flat ? 'flat' : good ? 'up' : 'down'}">${flat ? '' : ico(d > 0 ? 'up' : 'down', 'ico xs')}${txt}</span>`;
  }
  const statusOf = c => (!ok(c) ? ['muted', 'No data'] : c >= target ? ['good', 'On target'] : c >= target - 0.1 ? ['warn', 'Watch'] : ['bad', 'Below target']);
  const statusPill = c => { const [k, t] = statusOf(c); return `<span class="pill ${k}">${t}</span>`; };
  // Smooth line through points (Catmull-Rom → Bézier).
  function smooth(pts) {
    if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18;
      d += `C${(p1[0] + (p2[0] - p0[0]) * t).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) * t).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) * t).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) * t).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }
  let gid = 0;
  function spark(values, { color = 'var(--accent)', bars = false } = {}) {
    const v = values.map(x => (ok(x) ? x : null)), vals = v.filter(x => x !== null);
    if (vals.length < 2) return '<div class="spark empty"></div>';
    const W = 120, H = 34, lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1, id = 'sg' + (++gid);
    if (bars) {
      const bw = W / v.length;
      return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${v.map((x, i) => x === null ? '' : `<rect x="${(i * bw + bw * 0.18).toFixed(1)}" y="${(H - 2 - (x - Math.min(0, lo)) / ((hi - Math.min(0, lo)) || 1) * (H - 4)).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${((x - Math.min(0, lo)) / ((hi - Math.min(0, lo)) || 1) * (H - 4) + 0.5).toFixed(1)}" rx="1.5" fill="${color}" opacity="${i === v.length - 1 ? 1 : 0.45}"/>`).join('')}</svg>`;
    }
    const pts = v.map((x, i) => (x === null ? null : [i / (v.length - 1) * W, H - 4 - (x - lo) / r * (H - 8)])).filter(Boolean);
    const line = smooth(pts);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${line}L${pts[pts.length - 1][0]},${H}L${pts[0][0]},${H}Z" fill="url(#${id})"/><path class="draw" d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function gauge(v) {
    const R = 52, C = 2 * Math.PI * R, val = ok(v) ? v : 0, [k] = statusOf(v);
    const col = k === 'good' ? 'var(--good)' : k === 'warn' ? 'var(--warn)' : k === 'bad' ? 'var(--bad)' : 'var(--line)';
    const ta = target * 2 * Math.PI - Math.PI / 2, tx = 60 + Math.cos(ta) * R, ty = 60 + Math.sin(ta) * R;
    return `<svg class="gauge" viewBox="0 0 120 120" aria-hidden="true">
      <defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb0ff"/><stop offset="1" stop-color="#5fe0ea"/></linearGradient></defs>
      <circle cx="60" cy="60" r="${R}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="10"/>
      <circle class="gauge-arc" cx="60" cy="60" r="${R}" fill="none" stroke="url(#gg)" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${C}" data-to="${(C * (1 - val)).toFixed(2)}" transform="rotate(-90 60 60)"/>
      <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="4.5" fill="${col}" stroke="#fff" stroke-width="2"><title>Target ${Math.round(target * 100)}%</title></circle></svg>`;
  }
  const avatar = name => { const n = String(name || '?'); let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<span class="av" style="--h:${h}">${esc(n.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>`; };
  const csatCell = r => (r.n < MIN_N ? `<span class="muted" title="Fewer than ${MIN_N} responses">–</span>` : `<b>${pct(r.csat)}</b>`);
  const barTarget = r => `<div class="hbar" title="${r.n} responses"><div class="hbar-track"><div class="hbar-fill ${r.n < MIN_N ? 'weak' : statusOf(r.csat)[0]}" style="--w:${ok(r.csat) ? r.csat * 100 : 0}%"></div>
    <i class="hbar-target" style="left:${target * 100}%"></i></div></div>`;
  const empty = (msg = 'No data in this period') => `<div class="empty">${ico('info')}<span>${msg}</span></div>`;

  // ---------- loading ----------
  async function load() {
    const q = new URLSearchParams(Object.entries(st).filter(([, v]) => v !== '' && v !== 0));
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    $('dash').setAttribute('aria-busy', 'true'); $('dash').classList.add('is-loading');
    try {
      const r = await fetch('/admin/api/metrics?' + q, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(r.statusText);
      data = await r.json();
      target = (data.target || 85) / 100;
      render(data);
      $('dash-status').innerHTML = `${fmtDY(data.period.from)} – ${fmtDY(data.period.to)} <span class="dot-sep"></span> compared with the ${st.weeks} weeks before <span class="dot-sep"></span> updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (e) { $('dash-status').textContent = 'Could not load the figures: ' + e.message; }
    finally { $('dash').setAttribute('aria-busy', 'false'); $('dash').classList.remove('is-loading'); first = false; }
  }

  function fillOptions(o) {
    const fill = (el, items, all, cur) => { el.innerHTML = `<option value="">${all}</option>` + items.map(i => `<option value="${esc(i.v)}">${esc(i.t)}</option>`).join(''); el.value = cur; el.closest('.dsel').classList.toggle('on', !!cur); };
    fill($('f-group'), o.groups.map(g => ({ v: g.id, t: g.name || g.id })), 'All owner groups', st.group);
    fill($('f-source'), o.sources.map(s => ({ v: s, t: s })), 'All sources', st.source);
    fill($('f-type'), o.types.map(s => ({ v: s, t: s })), 'All types', st.type);
    fill($('f-priority'), o.priorities.map(s => ({ v: s, t: s })), 'All priorities', st.priority);
    $('f-clear').hidden = !(st.group || st.source || st.type || st.priority);
  }

  function render(d) {
    fillOptions(d.options);
    const g = d.options.groups.find(x => x.id === st.group);
    $('dash-title').textContent = g ? g.name || g.id : 'CSAT dashboard';
    kpis(d); trend(); dist(d); insights(d); groups(d); breakdown(); agents(d); followups(); comments(d); skipped(d);
  }

  // ---------- KPI cards ----------
  function kpis(d) {
    const k = d.kpis, p = d.prev, tr = d.trend;
    const [sk, st0] = statusOf(k.csat);
    const tiles = [
      { cls: 'kpi-hero', html: `<div class="kh-l"><div class="lab">CSAT</div><div class="val xl" data-v="${k.csat}" data-f="pct">–</div>
          <div class="kh-meta"><span class="pill ${sk} glass">${st0}</span>${deltaChip(k.csat, p.csat, { isPct: true })}</div>
          <div class="sub">Target ${Math.round(target * 100)}% · ${num(k.n)} responses</div></div><div class="kh-r">${gauge(k.csat)}</div>` },
      { icon: 'star', lab: 'Average score', v: k.avg, f: 'avg', unit: '/ 5', chip: deltaChip(k.avg, p.avg), spark: spark(tr.map(w => w.avg), { color: 'var(--accent-3)' }) },
      { icon: 'reply', lab: 'Response rate', v: k.rate, f: 'pct', chip: deltaChip(k.rate, p.rate, { isPct: true }), spark: spark(tr.map(w => w.rate), { color: 'var(--accent-2)' }) },
      { icon: 'send', lab: 'Surveys sent', v: k.sent, f: 'int', chip: `<span class="dchip flat">${num(k.n)} answered</span>`, spark: spark(tr.map(w => w.sent), { bars: true }) },
      { icon: 'alert', lab: 'Low scores (1–2)', v: k.det, f: 'int', tone: k.det ? 'bad' : '', chip: `<a class="dchip ${k.open_followups ? 'down' : 'up'}" href="#followups">${k.open_followups} open</a>`, spark: spark(tr.map(w => w.det), { color: 'var(--bad)', bars: true }) },
      { icon: 'clock', lab: 'Time to respond', v: k.median_hours, f: 'hours', chip: deltaChip(k.median_hours, p.median_hours, { digits: 1, higherIsBetter: false, unit: ' h' }), spark: '<div class="kpi-note">median, from email to answer</div>' },
    ];
    $('kpis').innerHTML = tiles.map((t, i) => t.html ? `<div class="kpi ${t.cls}" style="--i:${i}">${t.html}</div>`
      : `<div class="kpi" style="--i:${i}"><div class="kpi-top"><span class="kpi-ico">${ico(t.icon)}</span><span class="lab">${t.lab}</span></div>
          <div class="kpi-val"><span class="val ${t.tone || ''}" data-v="${t.v}" data-f="${t.f}">–</span>${t.unit ? `<span class="unit">${t.unit}</span>` : ''}</div>
          <div class="kpi-foot">${t.chip}${t.spark}</div></div>`).join('');
    const F = { pct: v => pct(v), avg: v => (ok(v) ? v.toFixed(2) : '–'), int: v => num(v), hours: v => (!ok(v) ? '–' : v < 1 ? Math.round(v * 60) + ' min' : v < 48 ? v.toFixed(1) + ' h' : (v / 24).toFixed(1) + ' d') };
    document.querySelectorAll('#kpis [data-v]').forEach(el => { const v = el.dataset.v === 'null' ? null : +el.dataset.v; countUp(el, v, F[el.dataset.f]); });
    setTimeout(() => document.querySelectorAll('.gauge-arc').forEach(a => a.setAttribute('stroke-dashoffset', a.dataset.to)), 60);
  }

  // ---------- trend chart (CSAT %, average score or volume), with hover crosshair ----------
  function trend() {
    const rows = data.trend, el = $('trend');
    if (!rows.length) { el.innerHTML = empty('No surveys in this period'); return; }
    const W = 760, H = 270, m = { l: 44, r: 16, t: 16, b: 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = i => m.l + (rows.length === 1 ? iw / 2 : i * iw / (rows.length - 1));
    let svg = '', lo, hi, fmtY, y;
    if (metric === 'vol') {
      hi = Math.max(1, ...rows.map(r => r.sent)); lo = 0; fmtY = v => Math.round(v);
      y = v => m.t + (1 - v / hi) * ih;
      const bw = Math.min(26, iw / rows.length * 0.36);
      svg += rows.map((r, i) => `<rect class="grow-y" x="${x(i) - bw - 1}" y="${y(r.sent)}" width="${bw}" height="${ih + m.t - y(r.sent)}" rx="4" fill="var(--accent)" opacity=".28"/>
        <rect class="grow-y" x="${x(i) + 1}" y="${y(r.n)}" width="${bw}" height="${ih + m.t - y(r.n)}" rx="4" fill="url(#tg-bar)"/>`).join('');
    } else {
      const key = metric === 'avg' ? 'avg' : 'csat', vals = rows.map(r => r[key]).filter(ok);
      if (!vals.length) { el.innerHTML = empty('No responses in this period'); return; }
      if (metric === 'avg') { lo = Math.max(1, Math.floor(Math.min(...vals) - 0.3)); hi = 5; fmtY = v => v.toFixed(1); }
      else { lo = Math.max(0, Math.floor((Math.min(...vals, target) - 0.06) * 10) / 10); hi = 1; fmtY = v => Math.round(v * 100) + '%'; }
      y = v => m.t + (hi - v) / (hi - lo) * ih;
      const pts = rows.map((r, i) => (ok(r[key]) ? [x(i), y(r[key])] : null)).filter(Boolean), line = smooth(pts);
      if (metric === 'csat') svg += `<rect x="${m.l}" y="${m.t}" width="${iw}" height="${y(target) - m.t}" fill="var(--good)" opacity=".05"/>
        <line x1="${m.l}" x2="${W - m.r}" y1="${y(target)}" y2="${y(target)}" stroke="var(--good)" stroke-dasharray="5 5" stroke-width="1.5"/>
        <text x="${W - m.r}" y="${y(target) - 6}" text-anchor="end" class="tlabel">Target ${Math.round(target * 100)}%</text>`;
      svg += `<path class="fade-in" d="${line}L${pts[pts.length - 1][0]},${m.t + ih}L${pts[0][0]},${m.t + ih}Z" fill="url(#tg-area)"/>
        <path class="draw" d="${line}" fill="none" stroke="url(#tg-line)" stroke-width="3" stroke-linecap="round"/>`;
      svg += pts.map((p, i) => `<circle class="pop" style="--i:${i}" cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 5 : 3.2}" fill="var(--surface)" stroke="var(--accent)" stroke-width="2.2"/>`).join('');
    }
    let grid = '';
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) { const v = lo + (hi - lo) * t / ticks; grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line-2)"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmtY(v)}</text>`; }
    const step = Math.ceil(rows.length / 7);
    const xl = rows.map((r, i) => (i % step === 0 || i === rows.length - 1) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtD(r.week)}</text>` : '').join('');
    el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Trend by week">
      <defs><linearGradient id="tg-line" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient>
        <linearGradient id="tg-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient>
        <linearGradient id="tg-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>
      ${grid}${svg}${xl}<line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="var(--faint)" stroke-dasharray="3 3" opacity="0"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>
      ${metric === 'vol' ? '<div class="legend"><span><i style="background:var(--accent);opacity:.3"></i>Surveys sent</span><span><i style="background:var(--accent-2)"></i>Responses</span></div>' : ''}</div>`;
    // Draw the line from left to right, using its real length.
    if (!reduce) el.querySelectorAll('path.draw').forEach(pth => { const L = Math.ceil(pth.getTotalLength()); pth.style.strokeDasharray = L; pth.style.strokeDashoffset = L; pth.style.setProperty('--len', L); });
    const svgEl = el.querySelector('svg'), hair = el.querySelector('.xhair'), tip = $('tip');
    el.querySelector('.hit').addEventListener('mousemove', e => {
      const b = svgEl.getBoundingClientRect(), mx = (e.clientX - b.left) / b.width * W;
      const i = Math.max(0, Math.min(rows.length - 1, Math.round(rows.length === 1 ? 0 : (mx - m.l) / iw * (rows.length - 1)))), r = rows[i];
      hair.setAttribute('x1', x(i)); hair.setAttribute('x2', x(i)); hair.setAttribute('opacity', '.8');
      tip.innerHTML = `<div class="small" style="opacity:.75">Week of ${fmtDY(r.week)}</div><b>${metric === 'avg' ? (ok(r.avg) ? r.avg.toFixed(2) + ' / 5' : '–') : metric === 'vol' ? r.n + ' of ' + r.sent + ' answered' : pct(r.csat)}</b>
        <div class="small">${metric === 'csat' ? `${r.n} responses · avg ${ok(r.avg) ? r.avg.toFixed(2) : '–'}` : metric === 'avg' ? `CSAT ${pct(r.csat)} · ${r.n} responses` : `response rate ${pct(r.rate)}`}</div>`;
      tip.hidden = false; tip.style.left = Math.min(e.clientX + 14, innerWidth - 240) + 'px'; tip.style.top = (e.clientY - 70) + 'px';
    });
    el.querySelector('.hit').addEventListener('mouseleave', () => { hair.setAttribute('opacity', '0'); tip.hidden = true; });
  }

  // ---------- score distribution donut ----------
  function dist(d) {
    const c = [1, 2, 3, 4, 5].map(k => (d.dist.find(r => r.score === k) || { c: 0 }).c), n = c.reduce((a, b) => a + b, 0);
    $('dist-n').textContent = n ? `${num(n)} responses` : '';
    if (!n) { $('dist').innerHTML = empty('No responses in this period'); return; }
    const R = 46, C = 2 * Math.PI * R; let off = 0;
    const segs = c.map((v, i) => { const len = v / n * C, s = `<circle class="seg-arc" cx="60" cy="60" r="${R}" fill="none" stroke="var(--l${i + 1})" stroke-width="16"
        stroke-dasharray="${Math.max(0, len - 1.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)" data-tip="<b>${i + 1} · ${LABELS[i]}</b><br>${v} (${(v / n * 100).toFixed(1)}%)" style="--i:${i}"/>`; off += len; return s; }).join('');
    const avg = c.reduce((a, v, i) => a + v * (i + 1), 0) / n;
    $('dist').innerHTML = `<div class="donut-wrap"><svg class="donut" viewBox="0 0 120 120" role="img" aria-label="Score distribution">${segs}
        <text x="60" y="58" text-anchor="middle" class="donut-v">${avg.toFixed(2)}</text><text x="60" y="74" text-anchor="middle" class="donut-l">average</text></svg>
      <div class="donut-legend">${[4, 3, 2, 1, 0].map(i => `<div class="dl-row"><i style="background:var(--l${i + 1})"></i><span>${i + 1} ${LABELS[i]}</span>
        <div class="dl-bar"><div style="--w:${c[i] / n * 100}%;background:var(--l${i + 1})"></div></div><b>${(c[i] / n * 100).toFixed(0)}%</b></div>`).join('')}</div></div>
      <div class="senti">${[['Satisfied', c[3] + c[4], 'good'], ['Neutral', c[2], 'mid'], ['Dissatisfied', c[0] + c[1], 'bad']].map(([l, v, k]) => `<div class="senti-i ${k}"><b>${(v / n * 100).toFixed(0)}%</b><span>${l}</span></div>`).join('')}</div>`;
    bindTips($('dist'));
  }

  // ---------- insights: a few sentences worth knowing, from the same numbers ----------
  function insights(d) {
    const k = d.kpis, p = d.prev, out = [];
    if (ok(k.csat)) {
      const gap = (k.csat - target) * 100;
      out.push([gap >= 0 ? 'good' : 'bad', 'target', gap >= 0 ? `CSAT is <b>${gap.toFixed(1)} pts above</b> the ${Math.round(target * 100)}% target.` : `CSAT is <b>${Math.abs(gap).toFixed(1)} pts below</b> the ${Math.round(target * 100)}% target.`]);
    }
    if (ok(k.csat) && ok(p.csat) && Math.abs(k.csat - p.csat) >= 0.005) out.push([k.csat > p.csat ? 'good' : 'bad', k.csat > p.csat ? 'up' : 'down', `${k.csat > p.csat ? 'Up' : 'Down'} <b>${Math.abs((k.csat - p.csat) * 100).toFixed(1)} pts</b> on the previous ${st.weeks} weeks.`]);
    const solid = arr => arr.filter(r => r.n >= MIN_N && ok(r.csat));
    const gs = solid(d.byGroup);
    if (gs.length > 1) {
      const best = gs.reduce((a, b) => (b.csat > a.csat ? b : a)), worst = gs.reduce((a, b) => (b.csat < a.csat ? b : a));
      out.push(['good', 'trophy', `Top group: <b>${esc(best.key)}</b> at ${pct(best.csat)}.`]);
      if (worst.csat < target) out.push(['warn', 'alert', `Needs attention: <b>${esc(worst.key)}</b> at ${pct(worst.csat)}.`]);
    }
    const cs = solid(d.byCategory);
    if (cs.length > 1) { const w = cs.reduce((a, b) => (b.csat < a.csat ? b : a)); if (w.csat < target) out.push(['warn', 'info', `Lowest category: <b>${esc(w.key)}</b> (${pct(w.csat)}, ${w.n} responses).`]); }
    if (k.open_followups) out.push(['bad', 'alert', `<b>${k.open_followups} low score${k.open_followups === 1 ? '' : 's'}</b> still waiting for follow-up. <a href="#followups">Review</a>`]);
    if (ok(k.rate)) out.push([k.rate >= 0.3 ? 'good' : 'warn', 'reply', k.rate >= 0.3 ? `<b>${pct(k.rate, 0)}</b> of people answered – a healthy response rate.` : `Only <b>${pct(k.rate, 0)}</b> answered. A reminder or shorter delay may help.`]);
    $('insights').innerHTML = out.length ? `<ul class="insights">${out.slice(0, 5).map(([tone, ic, t], i) => `<li class="${tone}" style="--i:${i}"><span class="ins-ico">${ico(ic)}</span><span>${t}</span></li>`).join('')}</ul>` : empty('Not enough data for insights yet');
  }

  // ---------- owner group leaderboard ----------
  let showAllGroups = false;
  function groups(d) {
    const rows = [...d.byGroup].sort((a, b) => (b.n >= MIN_N) - (a.n >= MIN_N) || (b.csat ?? -1) - (a.csat ?? -1));
    if (!rows.length) { $('t-group').innerHTML = empty(); return; }
    const list = showAllGroups ? rows : rows.slice(0, 8);
    $('t-group').innerHTML = `<div class="lb">${list.map((r, i) => `<button type="button" class="lb-row${r.id === st.group ? ' sel' : ''}" data-g="${esc(r.id)}" style="--i:${i}">
        <span class="rank r${i + 1}">${i + 1}</span><span class="lb-name"><b>${esc(r.key)}</b><small>${num(r.sent)} sent · ${num(r.n)} responses · ${pct(r.rate, 0)} answered${r.det ? ` · <span class="bad-t">${r.det} low</span>` : ''}</small></span>
        ${barTarget(r)}<span class="lb-v">${csatCell(r)}</span>${r.n >= MIN_N ? statusPill(r.csat) : '<span class="pill muted">Few answers</span>'}</button>`).join('')}</div>
      ${rows.length > 8 ? `<button type="button" class="more" id="lb-more">${showAllGroups ? 'Show top 8' : `Show all ${rows.length} groups`}</button>` : ''}`;
    $('t-group').querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => { st.group = st.group === b.dataset.g ? '' : b.dataset.g; load(); scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); }));
    const more = $('lb-more'); if (more) more.addEventListener('click', () => { showAllGroups = !showAllGroups; groups(data); });
  }

  // ---------- breakdown tabs ----------
  function breakdown() {
    const rows = [...data[bdKey]].sort((a, b) => b.n - a.n).slice(0, 12), el = $('breakdown');
    if (!rows.length) { el.innerHTML = empty(); return; }
    el.innerHTML = `<div class="bd fade-swap">${rows.map((r, i) => `<div class="bd-row" style="--i:${i}"><span class="bd-name" title="${esc(r.key || '–')}">${esc(r.key || '–')}</span>${barTarget(r)}
      <span class="bd-v">${csatCell(r)}</span><span class="bd-n">${num(r.n)}</span></div>`).join('')}</div>
      <div class="legend"><span><i class="lg-target"></i>Target ${Math.round(target * 100)}%</span><span>Right-hand number = responses</span></div>`;
  }

  // ---------- ticket owners ----------
  let showAllAgents = false, showAllFu = false;
  function agents(d) {
    const rows = d.byAgent;
    $('t-agent').innerHTML = rows.length ? `<div class="ag">${rows.slice(0, showAllAgents ? 50 : 6).map((a, i) => `<div class="ag-row" style="--i:${i}">${avatar(a.name)}
        <span class="ag-name"><b>${esc(a.name)}</b><small>${esc(a.group)}</small></span>${barTarget(a)}<span class="bd-v"><b>${pct(a.csat)}</b></span><span class="bd-n">${a.n}</span></div>`).join('')}</div>${rows.length > 6 ? `<button type="button" class="more" id="ag-more">${showAllAgents ? 'Show top 6' : `Show all ${rows.length}`}</button>` : ''}`
      : empty(`No ticket owner has ${MIN_N} or more responses in this period`);
    const am = $('ag-more'); if (am) am.addEventListener('click', () => { showAllAgents = !showAllAgents; agents(data); });
  }

  // ---------- follow-up queue ----------
  function followups() {
    const all = data.followups, open = all.filter(f => f.followup_status === 'open');
    $('fu-open').textContent = open.length;
    const list = fuMode === 'open' ? open : all;
    $('t-followup').innerHTML = list.length ? `<div class="fu">${list.slice(0, showAllFu ? 50 : 5).map((f, i) => `<div class="fu-item s-${f.followup_status}" style="--i:${i}" data-id="${f.id}">
        <span class="fu-score s${f.overall}">${f.overall}</span>
        <div class="fu-main"><div class="fu-top"><span class="mono">${esc(f.ticket_number)}</span><span class="muted small">${fmtD(f.submitted_at)} · ${esc(f.owner_group_name || '')}${f.ticket_owner ? ' · ' + esc(f.ticket_owner) : ''}</span></div>
          ${f.comment ? `<p class="fu-c">“${esc(f.comment)}”</p>` : '<p class="fu-c muted">No comment</p>'}</div>
        <div class="seg seg-xs fu-st" role="group" aria-label="Follow-up status for ${esc(f.ticket_number)}">${['open', 'contacted', 'resolved'].map(s => `<button type="button" data-s="${s}" aria-pressed="${s === f.followup_status}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      </div>`).join('')}</div>${list.length > 5 ? `<button type="button" class="more" id="fu-more">${showAllFu ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}` : `<div class="empty good">${ico('smile')}<span>${fuMode === 'open' ? 'All low scores have been followed up.' : 'No low scores in this period.'}</span></div>`;
    const fm = $('fu-more'); if (fm) fm.addEventListener('click', () => { showAllFu = !showAllFu; followups(); });
    $('t-followup').querySelectorAll('.fu-st button').forEach(b => b.addEventListener('click', async () => {
      const item = b.closest('.fu-item'), id = item.dataset.id, s = b.dataset.s, f = data.followups.find(x => String(x.id) === id);
      if (!f || f.followup_status === s) return;
      const before = f.followup_status; f.followup_status = s;
      item.querySelectorAll('.fu-st button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); item.className = `fu-item s-${s}`;
      try {
        const r = await fetch('/admin/api/followups/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: s }), credentials: 'same-origin' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
        toast(`${f.ticket_number} marked ${s}`);
        data.kpis.open_followups += (s === 'open') - (before === 'open');
        setTimeout(() => { followups(); kpis(data); insights(data); }, fuMode === 'open' && s !== 'open' ? 450 : 0);
        if (fuMode === 'open' && s !== 'open') item.classList.add('leaving');
      } catch (e) { f.followup_status = before; followups(); toast('Could not save: ' + e.message); }
    }));
  }

  // ---------- comments ----------
  function comments(d) {
    $('comments').innerHTML = d.comments.length ? `<div class="cm">${d.comments.slice(0, 5).map((c, i) => `<figure class="cm-item t${c.overall >= 4 ? 'g' : c.overall === 3 ? 'n' : 'b'}" style="--i:${i}">
        <blockquote>${esc(c.comment)}</blockquote><figcaption><span class="cm-score">${'★'.repeat(c.overall)}<span>${'★'.repeat(5 - c.overall)}</span></span>
        <span class="muted small">${esc(c.owner_group_name || '')} · ${fmtD(c.submitted_at)}</span></figcaption></figure>`).join('')}</div>` : empty('No comments in this period');
  }

  function skipped(d) {
    const rows = d.skipped, max = Math.max(1, ...rows.map(r => r.c));
    $('t-skipped').innerHTML = rows.length ? `<div class="sk">${rows.map((r, i) => `<div class="sk-row" style="--i:${i}"><span>${esc(r.reason)}</span>
      <div class="sk-bar"><div style="--w:${r.c / max * 100}%"></div></div><b>${num(r.c)}</b></div>`).join('')}</div>` : empty('No tickets were skipped');
  }

  // ---------- tooltips, toast, segmented controls ----------
  function bindTips(root) {
    const tip = $('tip');
    root.querySelectorAll('[data-tip]').forEach(el => {
      el.addEventListener('mousemove', e => { tip.hidden = false; tip.innerHTML = el.dataset.tip; tip.style.left = Math.min(e.clientX + 14, innerWidth - 240) + 'px'; tip.style.top = e.clientY + 14 + 'px'; });
      el.addEventListener('mouseleave', () => (tip.hidden = true));
    });
  }
  let toastT;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; t.style.animation = 'none'; void t.offsetWidth; t.style.animation = ''; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }
  // Moves the highlight behind the pressed button of a segmented control.
  function slide(seg) {
    const ind = seg.querySelector('.seg-ind'), on = seg.querySelector('button[aria-pressed=true]');
    if (!ind || !on) return;
    ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft - 3}px)`;
  }
  function segment(id, attr, onPick) {
    const seg = $(id);
    seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); slide(seg); onPick(b.dataset[attr]); });
    requestAnimationFrame(() => slide(seg));
  }

  // ---------- wiring ----------
  ['group', 'source', 'type', 'priority'].forEach(k => $('f-' + k).addEventListener('change', e => { st[k] = e.target.value; load(); }));
  $('f-clear').addEventListener('click', () => { st.group = st.source = st.type = st.priority = ''; load(); });
  document.querySelectorAll('#f-weeks button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.w === st.weeks)));
  segment('f-weeks', 'w', w => { st.weeks = +w; load(); });
  segment('trend-metric', 'm', m => { metric = m; if (data) trend(); });
  segment('bd-tabs', 'b', b => { bdKey = b; if (data) breakdown(); });
  segment('fu-tabs', 'f', f => { fuMode = f; if (data) followups(); });
  addEventListener('resize', () => document.querySelectorAll('.seg-slide').forEach(slide));
  const h = new Date().getHours();
  $('dash-hello').textContent = `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'} · ${$('dash-hello').textContent}`;
  load();
  setInterval(() => { if (!document.hidden) load(); }, 5 * 60e3);
})();
