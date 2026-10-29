'use strict';
// Report emails with the KPIs in the body: figure tiles and simple charts drawn with coloured table cells only, so they
// show in Outlook (desktop, web, mobile), which blocks images and SVG by default. The full report is the attached PDF.
// Used by the ticket CSAT report and the stakeholder survey report.
const config = require('../config');
const { esc } = require('./templates');

const C = { navy: '#0b1f3f', accent: '#1f5fbf', soft: '#e8effc', fg: '#14213a', muted: '#5b6780', line: '#dfe4ee', bg: '#f5f7fb', track: '#edf0f5',
  good: '#16915e', warn: '#b7791f', bad: '#d1453e', score: ['#d1453e', '#ec8a55', '#b9c2d0', '#6f9be0', '#1f5fbf'] };
const F = 'Segoe UI,Arial,sans-serif';
const pct = (v, d = 1) => (v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d) + '%');
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));

// tiles: [{ label, value, sub, tone: 'good'|'bad'|'warn'|undefined }] – three per row.
function tiles(list) {
  const cell = t => `<td width="33%" valign="top" style="padding:12px 14px;background:${C.bg};border-radius:8px">
      <div style="font:700 11px ${F};color:${C.muted};text-transform:uppercase;letter-spacing:.5px">${esc(t.label)}</div>
      <div style="font:800 24px ${F};color:${t.tone ? C[t.tone] : C.fg};margin-top:4px">${esc(t.value)}</div>
      ${t.sub ? `<div style="font:12px ${F};color:${t.subTone ? C[t.subTone] : C.muted};margin-top:2px">${esc(t.sub)}</div>` : ''}</td>`;
  const rows = [];
  for (let i = 0; i < list.length; i += 3) rows.push(`<tr>${list.slice(i, i + 3).map(cell).join('')}${'<td width="33%"></td>'.repeat(3 - Math.min(3, list.length - i))}</tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="6">${rows.join('')}</table>`;
}

// One horizontal bar (share 0–1) as a two-cell table.
const bar = (share, color = C.accent, height = 12) => {
  const w = Math.round(clamp01(share) * 100);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
    ${w > 0 ? `<td width="${w}%" height="${height}" style="background:${color};border-radius:3px;font-size:1px;line-height:1px">&nbsp;</td>` : ''}
    ${w < 100 ? `<td width="${100 - w}%" height="${height}" style="background:${C.track};font-size:1px;line-height:1px">&nbsp;</td>` : ''}</tr></table>`;
};

// rows: [{ label, sub, share (0–1), value (text), color }]
function hbars(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(r => `<tr>
      <td width="38%" style="padding:5px 10px 5px 0;font:13px ${F};color:${C.fg};vertical-align:middle">${esc(r.label)}${r.sub ? `<div style="font:11px ${F};color:${C.muted}">${esc(r.sub)}</div>` : ''}</td>
      <td width="44%" style="padding:5px 0;vertical-align:middle">${bar(r.share, r.color || C.accent)}</td>
      <td width="18%" align="right" style="padding:5px 0 5px 10px;font:700 13px ${F};color:${C.fg};white-space:nowrap">${esc(r.value)}</td></tr>`).join('')}</table>`;
}

// segments: [{ label, count, color }] → one 100% bar with a legend underneath.
function stacked(segments) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  if (!total) return `<p style="font:13px ${F};color:${C.muted};margin:0">No answers yet.</p>`;
  const cells = segments.filter(s => s.count).map(s => { const w = (s.count / total) * 100;
    return `<td width="${w.toFixed(1)}%" height="22" align="center" style="background:${s.color};font:700 11px ${F};color:#ffffff">${w >= 9 ? Math.round(w) + '%' : '&nbsp;'}</td>`; }).join('');
  const legend = segments.map(s => `<span style="display:inline-block;margin:6px 12px 0 0;font:12px ${F};color:${C.muted}"><span style="display:inline-block;width:10px;height:10px;background:${s.color};border-radius:2px;vertical-align:-1px"></span>&nbsp;${esc(s.label)} ${s.count}</span>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:4px"><tr>${cells}</tr></table><div>${legend}</div>`;
}

// Small column chart. points: [{ label, share (0–1), value (text) }]; optional target line (0–1) as a caption.
function columns(points, { height = 90, color = C.accent } = {}) {
  if (!points.length) return `<p style="font:13px ${F};color:${C.muted};margin:0">No data for this period.</p>`;
  const w = Math.floor(100 / points.length);
  const cols = points.map(p => { const h = Math.max(2, Math.round(clamp01(p.share) * height));
    return `<td width="${w}%" valign="bottom" align="center" style="padding:0 2px">
      <div style="font:10px ${F};color:${C.muted};padding-bottom:2px">${esc(p.value)}</div>
      <table role="presentation" width="70%" cellpadding="0" cellspacing="0"><tr><td height="${h}" style="background:${p.color || color};border-radius:3px 3px 0 0;font-size:1px;line-height:1px">&nbsp;</td></tr></table></td>`; }).join('');
  const labels = points.map(p => `<td width="${w}%" align="center" style="padding-top:4px;font:10px ${F};color:${C.muted}">${esc(p.label)}</td>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr style="height:${height + 16}px">${cols}</tr><tr>${labels}</tr></table>`;
}

const block = (title, html, note) => `<tr><td style="padding:6px 24px 14px">
  <div style="font:700 14px ${F};color:${C.navy};padding:8px 0 8px;border-top:1px solid ${C.line}">${esc(title)}${note ? `<span style="font:12px ${F};color:${C.muted};float:right">${esc(note)}</span>` : ''}</div>${html}</td></tr>`;

// The whole email. blocks: HTML from block(…).
function shell({ title, subtitle, message, intro, blocks = [], footer }) {
  const b = config.brand;
  return `<!doctype html><html><body style="margin:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid ${C.line};border-radius:10px">
<tr><td style="background:${C.navy};padding:20px 24px;border-radius:10px 10px 0 0">
  <span style="font:800 17px ${F};color:#ffffff">${esc(b.company)} <span style="font-weight:400;opacity:.85">${esc(b.unit)}</span></span>
  <div style="font:700 19px ${F};color:#ffffff;margin-top:10px">${esc(title)}</div>
  ${subtitle ? `<div style="font:13px ${F};color:#ffffff;opacity:.8;margin-top:4px">${esc(subtitle)}</div>` : ''}</td></tr>
<tr><td style="padding:18px 24px 4px;font:14px/1.5 ${F};color:${C.fg}">
  ${message ? `<p style="margin:0 0 12px">${esc(message).replace(/\n/g, '<br>')}</p>` : ''}${intro ? `<p style="margin:0 0 6px;color:${C.muted}">${intro}</p>` : ''}</td></tr>
${blocks.join('')}
<tr><td style="padding:6px 24px 20px;font:12px ${F};color:${C.muted};border-top:1px solid ${C.line}">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const delta = (cur, prev, { isPct = false, digits = 2, higherIsBetter = true } = {}) => {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return { text: 'no earlier data' };
  const d = cur - prev;
  const text = `${d >= 0 ? '+' : '−'}${isPct ? Math.abs(d * 100).toFixed(1) + ' pts' : Math.abs(d).toFixed(digits)} vs previous`;
  return { text, tone: Math.abs(d) < 1e-9 ? undefined : (d > 0) === higherIsBetter ? 'good' : 'bad' };
};

module.exports = { C, pct, tiles, bar, hbars, stacked, columns, block, shell, delta };
