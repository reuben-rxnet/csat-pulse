'use strict';
// PDF report of one stakeholder survey (A4 portrait), from the same summary the Results page shows (services/forms.results).
// Without includeNames, comments and the respondents list carry no names or emails.
const config = require('../config');
const { PdfDoc, textWidth, wrap, fit } = require('./pdf');
const { duration } = require('../forms/model');

const C = { navy: '#0b1f3f', accent: '#1f5fbf', fg: '#14213a', muted: '#5b6780', faint: '#8a94a8', line: '#dfe4ee', bg: '#f5f7fb', track: '#edf0f5',
  good: '#16915e', warn: '#b7791f', bad: '#d1453e', white: '#ffffff', score: ['#d1453e', '#ec8a55', '#b9c2d0', '#6f9be0', '#1f5fbf'] };
const M = 40, BOTTOM = 56;
const pct = (v, d = 0) => (v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d) + '%');
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const scaleColor = (i, k) => C.score[Math.round((i * 4) / Math.max(1, k - 1))];

function renderSurveyPdf({ form, res, includeNames = false, producedBy }) {
  const { stats, summary, numbers, responses } = res;
  const doc = new PdfDoc({ title: `${form.title} – results`, author: `${config.brand.company} ${config.brand.unit}` });
  const W = doc.width, CW = W - 2 * M;
  let y = 0;
  const continuation = () => {
    doc.rect(0, 0, W, 30, { fill: C.navy });
    doc.text(M, 10, `${config.brand.company} ${config.brand.unit}`, { size: 9, bold: true, color: C.white });
    doc.text(M, 10, fit(form.title, CW - 140, 9), { size: 9, color: C.white, align: 'right', width: CW });
    y = 48;
  };
  const ensure = h => { if (y + h > doc.height - BOTTOM) { doc.addPage(); continuation(); } };
  const para = (t, { size = 9, color = C.muted, bold = false, indent = 0 } = {}) => {
    for (const l of wrap(t, CW - indent, size, bold)) { ensure(size + 4); doc.text(M + indent, y, l, { size, color, bold }); y += size + 3.5; }
  };

  // ---- header ----
  doc.rect(0, 0, W, 80, { fill: C.navy });
  doc.text(M, 22, config.brand.company, { size: 14, bold: true, color: C.white });
  doc.text(M + textWidth(config.brand.company + ' ', 14, true), 22, config.brand.unit, { size: 14, color: C.white });
  doc.text(M, 44, config.brand.product.toUpperCase(), { size: 8, bold: true, color: '#c9d3e6' });
  doc.text(M, 20, 'Survey results', { size: 18, bold: true, color: C.white, align: 'right', width: CW });
  doc.text(M, 45, includeNames ? 'Named responses' : 'Respondents not named', { size: 9, color: '#c9d3e6', align: 'right', width: CW });
  y = 100;
  for (const l of wrap(form.title, CW, 16, true)) { doc.text(M, y, l, { size: 16, bold: true, color: C.navy }); y += 21; }
  y += 2;
  const span = [form.opened_at && `opened ${fmtDate(form.opened_at)}`, form.closed_at ? `closed ${fmtDate(form.closed_at)}` : form.closes_at ? `closes ${fmtDate(form.closes_at)}` : 'still open'].filter(Boolean).join(' · ');
  para(`${form.status === 'closed' ? 'Final results' : 'Results so far'} · ${span}.`, { color: C.fg });
  para(`Produced ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} by ${producedBy}. Test answers are not included.`);
  y += 8;

  // ---- tiles ----
  const nps = summary.find(s => s.q.type === 'nps' && s.n);
  const rows = summary.filter(s => s.q.type === 'likert').flatMap(s => s.rows).filter(r => r.n);
  const avg = rows.length ? rows.reduce((a, r) => a + r.avg * r.n, 0) / rows.reduce((a, r) => a + r.n, 0) : null;
  const tiles = [
    ['Responses', String(stats.responded), `of ${stats.invited} invited`],
    ['Response rate', pct(stats.rate), `${stats.opened} opened the link`],
    ['Average rating', avg == null ? '–' : avg.toFixed(2), 'all rating-grid answers, 1–5'],
    ['NPS', nps ? String(Math.round(nps.score)) : '–', nps ? `${nps.promoters} promoter${nps.promoters === 1 ? '' : 's'} · ${nps.passives} passive${nps.passives === 1 ? '' : 's'} · ${nps.detractors} detractor${nps.detractors === 1 ? '' : 's'}` : 'no answers'],
    ['Time to complete', stats.medianSeconds == null ? '–' : duration(stats.medianSeconds), 'median, minutes:seconds'],
    ['Questions', String(Object.keys(numbers).length), `${summary.filter(s => s.q.type === 'section').length} sections`],
  ];
  const tw = (CW - 20) / 3, th = 58;
  tiles.forEach(([lab, val, sub], i) => {
    const tx = M + (i % 3) * (tw + 10), ty = y + Math.floor(i / 3) * (th + 10);
    doc.rect(tx, ty, tw, th, { fill: C.bg }); doc.rect(tx, ty, 3, th, { fill: C.accent });
    doc.text(tx + 12, ty + 9, lab.toUpperCase(), { size: 7.5, bold: true, color: C.muted });
    doc.text(tx + 12, ty + 21, val, { size: 18, bold: true, color: C.fg });
    doc.text(tx + 12, ty + 44, fit(sub, tw - 20, 7.5), { size: 7.5, color: C.faint });
  });
  y += 2 * (th + 10) + 6;

  // ---- questions ----
  const qHead = (s) => {
    ensure(48); y += 6;
    const n = String(numbers[s.q.id]);
    doc.rect(M, y, 18, 16, { fill: C.navy }); doc.text(M, y + 4, n, { size: 8, bold: true, color: C.white, align: 'center', width: 18 });
    const lines = wrap(s.q.title, CW - 120, 10.5, true);
    lines.forEach((l, i) => doc.text(M + 26, y + 2 + i * 13, l, { size: 10.5, bold: true, color: C.fg }));
    doc.text(M, y + 3, `${s.n} answer${s.n === 1 ? '' : 's'}`, { size: 8, color: C.muted, align: 'right', width: CW });
    y += Math.max(18, lines.length * 13) + 8;
  };
  for (const s of summary) {
    if (s.q.type === 'section') {
      ensure(40); y += 10;
      doc.text(M, y, s.q.title.toUpperCase(), { size: 10, bold: true, color: C.accent }); y += 14;
      doc.line(M, y, M + CW, y, { color: C.line, width: 0.8 }); y += 4;
      continue;
    }
    qHead(s);
    if (s.q.type === 'likert') {
      const k = s.q.scale.length, lw = 150, bw = CW - lw - 90;
      for (const r of s.rows) {
        const labelLines = wrap(r.row.label, lw - 8, 8.5, true).slice(0, 2), hintLines = r.row.hint ? wrap(r.row.hint, lw - 8, 7, false).slice(0, 3) : [];
        const h = Math.max(22, labelLines.length * 10.5 + hintLines.length * 8.5 + 6);
        ensure(h + 4);
        labelLines.forEach((l, i) => doc.text(M, y + 2 + i * 10.5, l, { size: 8.5, bold: true, color: C.fg }));
        hintLines.forEach((l, i) => doc.text(M, y + 2 + labelLines.length * 10.5 + i * 8.5, l, { size: 7, color: C.muted }));
        const by = y + (h - 16) / 2;
        doc.rect(M + lw, by, bw, 16, { fill: C.track });
        let x = M + lw;
        r.counts.forEach((c, i) => { if (!c || !r.n) return; const w = (c / r.n) * bw; doc.rect(x, by, w, 16, { fill: scaleColor(i, k) });
          if (w > 22) doc.text(x, by + 4.5, pct(c / r.n), { size: 7, bold: true, color: C.white, align: 'center', width: w }); x += w; });
        doc.text(M + lw + bw, by - 1, r.avg == null ? '–' : r.avg.toFixed(2), { size: 11, bold: true, color: C.fg, align: 'right', width: 88 });
        doc.text(M + lw + bw, by + 11, `${pct(r.positive)} positive`, { size: 7, color: C.muted, align: 'right', width: 88 });
        y += h + 2;
      }
      ensure(14); let lx = M;
      s.q.scale.forEach((l, i) => { doc.rect(lx, y + 2, 7, 7, { fill: scaleColor(i, k) }); doc.text(lx + 10, y + 1, l, { size: 7, color: C.muted }); lx += 14 + textWidth(l, 7) + 8; });
      y += 16;
    } else if (s.q.type === 'nps') {
      ensure(110);
      const score = s.score ?? 0, bx = M, bw = CW, by = y + 4;
      doc.rect(bx, by, bw, 12, { fill: C.track });
      doc.rect(bx + bw / 2, by - 3, 0.8, 18, { fill: C.faint });
      const sx = bx + ((score + 100) / 200) * bw;
      doc.rect(Math.min(sx, bx + bw / 2), by, Math.abs(sx - (bx + bw / 2)), 12, { fill: score >= 30 ? C.good : score >= 0 ? C.warn : C.bad });
      doc.text(bx, by + 16, '-100', { size: 7, color: C.faint }); doc.text(bx, by + 16, '+100', { size: 7, color: C.faint, align: 'right', width: bw }); doc.text(bx, by + 16, '0', { size: 7, color: C.faint, align: 'center', width: bw });
      y = by + 30;
      doc.text(M, y, `NPS ${s.score == null ? '–' : Math.round(s.score)}`, { size: 16, bold: true, color: C.fg });
      doc.text(M + 110, y + 3, `Promoters (9–10): ${s.promoters}     Passives (7–8): ${s.passives}     Detractors (0–6): ${s.detractors}`, { size: 9, color: C.muted });
      y += 26;
      const colW = CW / 11, maxC = Math.max(1, ...s.counts);
      s.counts.forEach((c, i) => { const h = (c / maxC) * 36; const col = i >= 9 ? C.good : i >= 7 ? C.score[2] : C.score[0];
        if (c) doc.rect(M + i * colW + 4, y + 36 - h, colW - 8, h, { fill: col });
        doc.text(M + i * colW, y + 39, String(i), { size: 7.5, color: C.muted, align: 'center', width: colW });
        if (c) doc.text(M + i * colW, y + 26 - h, String(c), { size: 7, color: C.fg, align: 'center', width: colW }); });
      y += 54;
    } else if (s.q.type === 'choice' || s.q.type === 'checkbox' || s.q.type === 'rating') {
      const items = s.q.type === 'rating' ? s.counts.map((c, i) => ({ label: `${i + 1} star${i ? 's' : ''}`, c })).reverse() : s.q.options.map(o => ({ label: o.label, c: s.counts[o.id] }));
      const max = Math.max(1, ...items.map(i => i.c)), lw = 170, bw = CW - lw - 70;
      if (s.q.type === 'rating') { ensure(18); doc.text(M, y, `Average ${s.avg == null ? '–' : s.avg.toFixed(2)} of ${s.q.max}`, { size: 10, bold: true, color: C.fg }); y += 16; }
      for (const it of items) {
        ensure(16);
        doc.text(M, y + 2, fit(it.label, lw - 8, 8.5), { size: 8.5, color: C.fg });
        doc.rect(M + lw, y + 3, bw, 9, { fill: C.track }); if (it.c) doc.rect(M + lw, y + 3, (it.c / max) * bw, 9, { fill: C.accent });
        doc.text(M + lw + bw, y + 2, `${it.c}  (${pct(s.n ? it.c / s.n : null)})`, { size: 8.5, color: C.muted, align: 'right', width: 68 });
        y += 15;
      }
      y += 4;
    } else if (s.q.type === 'text') {
      if (!s.answers.length) { para('No answers.'); continue; }
      for (const a of s.answers) {
        const lines = wrap(a.text, CW - 16, 9).slice(0, 12);
        const h = lines.length * 12 + (includeNames ? 13 : 2) + 8;
        ensure(h);
        doc.rect(M, y, 2.5, h - 8, { fill: C.accent });
        lines.forEach((l, i) => doc.text(M + 10, y + i * 12, l, { size: 9, color: C.fg }));
        if (includeNames) doc.text(M + 10, y + lines.length * 12 + 1, `${a.name || a.email} · ${fmtDate(a.at)}`, { size: 7.5, bold: true, color: C.muted });
        y += h;
      }
    }
  }

  // ---- respondents (only with names) ----
  if (includeNames && responses.length) {
    ensure(60); y += 10;
    doc.text(M, y, 'RESPONDENTS', { size: 10, bold: true, color: C.accent }); y += 14; doc.line(M, y, M + CW, y, { color: C.line, width: 0.8 }); y += 6;
    const cols = [[M, 'Name', 160], [M + 165, 'Email', 190], [M + 360, 'Submitted', 90], [M + 455, 'Time', CW - 455]];
    const head = () => { cols.forEach(([x, t, w]) => doc.text(x, y, t, { size: 7.5, bold: true, color: C.muted, align: t === 'Time' ? 'right' : 'left', width: w })); y += 13; };
    head();
    for (const r of responses) {
      if (y + 14 > doc.height - BOTTOM) { doc.addPage(); continuation(); head(); }
      doc.text(cols[0][0], y, fit(r.name || '–', 155, 8.5, true), { size: 8.5, bold: true, color: C.fg });
      doc.text(cols[1][0], y, fit(r.email, 185, 8.5), { size: 8.5, color: C.fg });
      doc.text(cols[2][0], y, fmtDate(r.submitted_at), { size: 8.5, color: C.fg });
      doc.text(cols[3][0], y, duration((new Date(r.submitted_at) - new Date(r.started_at)) / 1000), { size: 8.5, color: C.fg, align: 'right', width: cols[3][2] });
      y += 14; doc.line(M, y - 3, M + CW, y - 3, { color: C.line });
    }
  }

  const total = doc.pages.length;
  doc.pages.forEach((ops, i) => {
    doc.page = ops; const fy = doc.height - 34;
    doc.line(M, fy, M + CW, fy, { color: C.line });
    doc.text(M, fy + 8, `${config.brand.product} · ${config.brand.company} internal – do not share outside the company`, { size: 7, color: C.faint });
    doc.text(M, fy + 8, `Page ${i + 1} of ${total}`, { size: 7, color: C.faint, align: 'right', width: CW });
  });
  return doc.toBuffer();
}

module.exports = { renderSurveyPdf };
