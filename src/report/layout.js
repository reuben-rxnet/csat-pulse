'use strict';
// Lays out the CSAT report as a PDF (A4 portrait) from the same numbers the dashboard uses (services/metrics.getMetrics).
const config = require('../config');
const { PdfDoc, textWidth, wrap, fit } = require('./pdf');
const { periodLabel } = require('./schedule');

const C = { navy: '#0b1f3f', accent: '#1f5fbf', accentSoft: '#9dbbe8', fg: '#14213a', muted: '#5b6780', faint: '#8a94a8', line: '#dfe4ee', bg: '#f5f7fb',
  good: '#1f8a5b', warn: '#b7791f', bad: '#c2413b', white: '#ffffff', score: ['#c2413b', '#e08a5a', '#b9c0cc', '#6f9be0', '#1f5fbf'] };
const SCORE_LABELS = ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'];
const MIN_N = 5; // CSAT % is not shown for fewer responses than this (one score would swing it too much)
const M = 40, BOTTOM = 56;

const pct = v => (v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1) + '%');
const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const hours = h => (h == null ? '–' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);

// data: { m (getMetrics result), period {from,to,prevFrom}, sections, groupsLabel, producedBy, target (0–1), followups {open,contacted,resolved}, custom, title }
function renderReportPdf(data) {
  const { m, period, sections, target } = data;
  const has = k => sections.includes(k);
  const title = data.title || 'CSAT report';
  const doc = new PdfDoc({ title: `${title} · ${periodLabel(period.from, period.to)}`, author: `${config.brand.company} ${config.brand.unit}` });
  const W = doc.width, CW = W - 2 * M;
  let y = 0, smallN = false;

  const continuationHeader = () => {
    doc.rect(0, 0, W, 30, { fill: C.navy });
    doc.text(M, 10, `${config.brand.company} ${config.brand.unit}`, { size: 9, bold: true, color: C.white });
    doc.text(M, 10, `${title} · ${periodLabel(period.from, period.to)}`, { size: 9, color: C.white, align: 'right', width: CW });
    y = 48;
  };
  const ensure = h => { if (y + h > doc.height - BOTTOM) { doc.addPage(); continuationHeader(); } };
  const heading = (text, note) => {
    ensure(56); y += 8;
    doc.text(M, y, text, { size: 12, bold: true, color: C.navy });
    if (note) doc.text(M, y + 2, note, { size: 8, color: C.muted, align: 'right', width: CW });
    y += 18; doc.line(M, y, M + CW, y, { color: C.line, width: 0.8 }); y += 8;
  };
  const para = (text, { size = 9, color = C.muted, bold = false } = {}) => {
    for (const l of wrap(text, CW, size, bold)) { ensure(size + 4); doc.text(M, y, l, { size, color, bold }); y += size + 3.5; }
  };

  // Simple table; cols = [{ label, w (share of width), align }]. Repeats the header after a page break.
  const table = (cols, rows, { empty = 'No data in this period.' } = {}) => {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const xs = []; let x = M;
    for (const c of cols) { const w = (c.w / total) * CW; xs.push([x, w]); x += w; }
    const head = () => {
      doc.rect(M, y, CW, 17, { fill: C.bg });
      cols.forEach((c, i) => doc.text(xs[i][0] + 5, y + 5, fit(c.label, xs[i][1] - 10, 7.5, true), { size: 7.5, bold: true, color: C.muted, align: c.align || 'left', width: xs[i][1] - 10 }));
      y += 17;
    };
    ensure(17 + 16); head();
    if (!rows.length) { doc.text(M + 5, y + 5, empty, { size: 8.5, color: C.muted }); y += 18; return; }
    for (const r of rows) {
      if (y + 16 > doc.height - BOTTOM) { doc.addPage(); continuationHeader(); head(); }
      cols.forEach((c, i) => {
        const v = r[i] == null ? '' : String(r[i]);
        doc.text(xs[i][0] + 5, y + 4.5, fit(v, xs[i][1] - 10, 8.5, i === 0), { size: 8.5, bold: i === 0, color: C.fg, align: c.align || 'left', width: xs[i][1] - 10 });
      });
      y += 16; doc.line(M, y, M + CW, y, { color: C.line });
    }
    y += 6;
  };
  const csatCell = r => { if (r.n < MIN_N) { if (r.n) smallN = true; return r.n ? '–*' : '–'; } return pct(r.csat); };
  const breakdownRows = list => list.map(r => [r.key || '(none)', r.sent, r.n, pct(r.rate), csatCell(r), r.n ? r.avg.toFixed(2) : '–']);
  const breakdownCols = first => [{ label: first, w: 4 }, { label: 'Surveys sent', w: 1.3, align: 'right' }, { label: 'Responses', w: 1.3, align: 'right' },
    { label: 'Response rate', w: 1.4, align: 'right' }, { label: 'CSAT %', w: 1.2, align: 'right' }, { label: 'Avg score', w: 1.2, align: 'right' }];

  // ---- page 1 header ----
  doc.rect(0, 0, W, 80, { fill: C.navy });
  doc.text(M, 22, config.brand.company, { size: 14, bold: true, color: C.white });
  doc.text(M + textWidth(config.brand.company + ' ', 14, true), 22, config.brand.unit, { size: 14, color: C.white });
  doc.text(M, 44, config.brand.product.toUpperCase(), { size: 8, bold: true, color: '#c9d3e6' });
  doc.text(M, 20, title, { size: 18, bold: true, color: C.white, align: 'right', width: CW });
  doc.text(M, 45, data.custom ? 'Custom report' : 'Standard report', { size: 9, color: '#c9d3e6', align: 'right', width: CW });
  y = 100;
  doc.text(M, y, periodLabel(period.from, period.to), { size: 16, bold: true, color: C.navy }); y += 24;
  para(`Owner groups: ${data.groupsLabel}`, { color: C.fg });
  para(`Compared with the previous period: ${periodLabel(period.prevFrom, period.from)}. Produced ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} by ${data.producedBy}.`);
  para('Counts surveys sent in the period. CSAT % = share of responses scoring 4 or 5. Test surveys are not included.', { size: 8, color: C.faint });
  y += 8;

  // ---- main figures ----
  const k = m.kpis, p = m.prev;
  const delta = (cur, prev, { isPct = false, digits = 0, higherIsBetter = true, neutral = false } = {}) => {
    if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return { text: 'No data for the previous period', color: C.faint };
    const d = cur - prev, sign = d > 0 ? '+' : d < 0 ? '−' : '±';
    const text = `${sign}${isPct ? Math.abs(d * 100).toFixed(1) + ' pts' : Math.abs(d).toFixed(digits)} vs previous period`;
    if (neutral || Math.abs(d) < 1e-9) return { text, color: C.muted };
    return { text, color: (d > 0) === higherIsBetter ? C.good : C.bad };
  };
  const csatColor = k.csat == null ? C.fg : k.csat >= target ? C.good : k.csat >= target - 0.1 ? C.warn : C.bad;
  const tiles = [
    { label: 'CSAT %', value: pct(k.csat), color: csatColor, sub: delta(k.csat, p.csat, { isPct: true }), note: `Target ${Math.round(target * 100)}% · ${k.n} response${k.n === 1 ? '' : 's'}${k.n && k.n < MIN_N ? ' – too few to rely on' : ''}` },
    { label: 'Average score', value: k.avg == null ? '–' : `${k.avg.toFixed(2)} / 5`, sub: delta(k.avg, p.avg, { digits: 2 }) },
    { label: 'Response rate', value: pct(k.rate), sub: delta(k.rate, p.rate, { isPct: true }), note: `${k.n} of ${k.sent} surveys answered` },
    { label: 'Surveys sent', value: String(k.sent), sub: delta(k.sent, p.sent, { neutral: true }) },
    { label: 'Low scores (1–2)', value: String(k.det), color: k.det ? C.bad : C.fg, sub: delta(k.det, p.det, { higherIsBetter: false }), note: `${k.open_followups} follow-up${k.open_followups === 1 ? '' : 's'} still open` },
    { label: 'Median time to respond', value: hours(k.median_hours), sub: delta(k.median_hours, p.median_hours, { digits: 1, higherIsBetter: false }) },
  ];
  const tw = (CW - 20) / 3, th = 70;
  tiles.forEach((t, i) => {
    const tx = M + (i % 3) * (tw + 10), ty = y + Math.floor(i / 3) * (th + 10);
    doc.rect(tx, ty, tw, th, { fill: C.bg });
    doc.rect(tx, ty, 3, th, { fill: t.color && t.color !== C.fg ? t.color : C.accent });
    doc.text(tx + 12, ty + 9, t.label.toUpperCase(), { size: 7.5, bold: true, color: C.muted });
    doc.text(tx + 12, ty + 22, t.value, { size: 19, bold: true, color: t.color || C.fg });
    doc.text(tx + 12, ty + 46, fit(t.sub.text, tw - 20, 7.5), { size: 7.5, color: t.sub.color });
    if (t.note) doc.text(tx + 12, ty + 57, fit(t.note, tw - 20, 7.5), { size: 7.5, color: C.faint });
  });
  y += 2 * (th + 10) + 4;

  // ---- trend + distribution ----
  if (has('trend')) {
    heading('CSAT % by week', `Dashed line = target ${Math.round(target * 100)}%`);
    const weeks = m.trend.filter(w => w.n > 0);
    if (!weeks.length) para('No responses in this period.');
    else {
      const ch = 140; ensure(ch + 30);
      const ax = M + 30, aw = CW - 30, top = y + 6;
      for (const v of [0, 0.5, 1]) {
        const ly = top + ch - v * ch;
        doc.line(ax, ly, ax + aw, ly, { color: C.line });
        doc.text(M, ly - 4, `${v * 100}%`, { size: 7, color: C.faint, align: 'right', width: 24 });
      }
      const slot = aw / weeks.length, bw = Math.min(28, slot * 0.62), every = Math.ceil(weeks.length / 13);
      weeks.forEach((w, i) => {
        const bx = ax + i * slot + (slot - bw) / 2, bh = Math.max(1, (w.csat || 0) * ch);
        doc.rect(bx, top + ch - bh, bw, bh, { fill: w.n < MIN_N ? C.accentSoft : C.accent });
        if (weeks.length <= 16) doc.text(bx - 6, top + ch - bh - 10, `${Math.round((w.csat || 0) * 100)}%`, { size: 6.5, color: C.muted, align: 'center', width: bw + 12 });
        if (i % every === 0) doc.text(bx - 12, top + ch + 4, fmtShort(w.week), { size: 6.5, color: C.faint, align: 'center', width: bw + 24 });
      });
      const ty = top + ch - target * ch;
      doc.line(ax, ty, ax + aw, ty, { color: C.good, width: 1, dash: [3, 2] });
      y = top + ch + 18;
      if (weeks.some(w => w.n < MIN_N)) para(`Lighter bars: fewer than ${MIN_N} responses that week.`, { size: 7.5, color: C.faint });
    }

    heading('Score distribution');
    const total = m.dist.reduce((s, d) => s + d.c, 0);
    ensure(5 * 16);
    for (let s = 5; s >= 1; s--) {
      const c = (m.dist.find(d => d.score === s) || { c: 0 }).c, share = total ? c / total : 0;
      doc.text(M, y + 2, `${s}  ${SCORE_LABELS[s - 1]}`, { size: 8.5, color: C.fg });
      const bx = M + 120, bw = CW - 120 - 80;
      doc.rect(bx, y + 2, bw, 9, { fill: C.bg });
      if (share) doc.rect(bx, y + 2, Math.max(1.5, bw * share), 9, { fill: C.score[s - 1] });
      doc.text(bx + bw, y + 2, `${c}  (${pct(share)})`, { size: 8.5, color: C.muted, align: 'right', width: 80 });
      y += 16;
    }
    y += 4;
  }

  if (has('groups')) {
    heading('By owner group', 'Sorted by CSAT %');
    table(breakdownCols('Owner group'), breakdownRows(m.byGroup));
  }

  if (has('breakdowns')) {
    heading('By ticket source');
    table(breakdownCols('Source'), breakdownRows(m.bySource));
    heading('By ticket type');
    table(breakdownCols('Ticket type'), breakdownRows(m.byType));
    heading('By priority');
    table(breakdownCols('Priority'), breakdownRows(m.byPriority));
    heading('By category', 'Sorted by CSAT %');
    table(breakdownCols('Category'), breakdownRows(m.byCategory));
  }

  if (has('agents')) {
    heading('Ticket owners', `At least ${MIN_N} responses · sorted by CSAT %`);
    table([{ label: 'Ticket owner', w: 3 }, { label: 'Owner group', w: 3.2 }, { label: 'Responses', w: 1.2, align: 'right' }, { label: 'CSAT %', w: 1.1, align: 'right' }, { label: 'Avg score', w: 1.1, align: 'right' }],
      m.byAgent.map(a => [a.name, a.group, a.n, pct(a.csat), a.avg.toFixed(2)]), { empty: `No ticket owner has ${MIN_N} or more responses in this period.` });
  }

  if (has('followups')) {
    heading('Low-score follow-up', 'Responses scoring 1 or 2');
    const f = data.followups || {};
    table([{ label: 'Low scores', w: 1, align: 'right' }, { label: 'Open', w: 1, align: 'right' }, { label: 'Contacted', w: 1, align: 'right' }, { label: 'Resolved', w: 1, align: 'right' }],
      [[k.det, f.open || 0, f.contacted || 0, f.resolved || 0]]);
  }

  if (has('comments')) {
    heading('Latest comments', 'Up to 10, newest first · no requester names');
    if (!m.comments.length) para('No comments in this period.');
    for (const c of m.comments) {
      const lines = wrap(c.comment, CW - 16, 9).slice(0, 8);
      const h = 14 + lines.length * 12.5 + 8;
      ensure(h);
      doc.rect(M, y, 3, h - 8, { fill: C.score[(c.overall || 3) - 1] });
      const meta = [`Score ${c.overall}`, fmtDate(c.submitted_at), c.ticket_number, c.owner_group_name, has('agents') ? c.ticket_owner : null].filter(Boolean).join('  ·  ');
      doc.text(M + 12, y, fit(meta, CW - 16, 7.5, true), { size: 7.5, bold: true, color: C.muted });
      lines.forEach((l, i) => doc.text(M + 12, y + 13 + i * 12.5, l, { size: 9, color: C.fg }));
      y += h;
    }
  }

  if (has('skipped')) {
    heading('Why tickets were not surveyed', 'Closed tickets skipped in the period');
    table([{ label: 'Reason', w: 5 }, { label: 'Tickets', w: 1, align: 'right' }], m.skipped.map(s => [s.reason, s.c]), { empty: 'No tickets were skipped.' });
  }

  if (smallN) { y += 4; para(`* CSAT % is not shown where there are fewer than ${MIN_N} responses, because a single score would change it too much.`, { size: 7.5, color: C.faint }); }

  // ---- footer on every page ----
  const total = doc.pages.length;
  doc.pages.forEach((ops, i) => {
    doc.page = ops;
    const fy = doc.height - 34;
    doc.line(M, fy, M + CW, fy, { color: C.line });
    doc.text(M, fy + 8, `${config.brand.product} · ${config.brand.company} internal – do not share outside the company`, { size: 7, color: C.faint });
    doc.text(M, fy + 8, `Page ${i + 1} of ${total}`, { size: 7, color: C.faint, align: 'right', width: CW });
  });
  return doc.toBuffer();
}

module.exports = { renderReportPdf, MIN_N };
