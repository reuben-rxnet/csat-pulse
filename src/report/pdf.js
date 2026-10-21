'use strict';
// Minimal PDF writer (no dependencies): A4 pages, Helvetica / Helvetica-Bold text, rectangles and lines.
// Coordinates are in points from the TOP-LEFT of the page. Text is encoded as WinAnsi (Western European);
// characters outside it fall back to their unaccented letter or "?".
const zlib = require('zlib');

const A4 = { w: 595.28, h: 841.89 };

// Glyph widths (1/1000 em) for codes 32–126, from the standard Helvetica AFM files.
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667,
  944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667,
  944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556,
  333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// WinAnsi codes 128–159 that differ from Latin-1, with their widths (same in both weights, close enough for layout).
const WIN = { '€': [0x80, 556], '‚': [0x82, 222], '„': [0x84, 333], '…': [0x85, 1000], '‰': [0x89, 1000], 'Š': [0x8a, 667], 'Œ': [0x8c, 1000],
  'Ž': [0x8e, 611], '‘': [0x91, 222], '’': [0x92, 222], '“': [0x93, 333], '”': [0x94, 333], '•': [0x95, 350], '–': [0x96, 556], '—': [0x97, 1000],
  '™': [0x99, 1000], 'š': [0x9a, 500], 'œ': [0x9c, 944], 'ž': [0x9e, 500], 'Ÿ': [0x9f, 667] };

// Letters with no Unicode decomposition (common in Polish, Turkish, Croatian, Nordic names) → nearest plain letter.
const PLAIN = { 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'ħ': 'h', 'Ħ': 'H', 'ŀ': 'l', 'Ŀ': 'L', 'ŧ': 't', 'Ŧ': 'T', '‐': '-', '‑': '-', '−': '-', '′': "'", '″': '"' };

// One character → [WinAnsi byte, width at 1000 units].
function glyph(ch, bold) {
  const table = bold ? W_BOLD : W_REG;
  const c = ch.codePointAt(0);
  if (c >= 32 && c <= 126) return [c, table[c - 32]];
  if (WIN[ch]) return WIN[ch];
  if (c >= 0xa0 && c <= 0xff) {
    const base = ch.normalize('NFD')[0]; // é → e, for the width
    const bc = base.codePointAt(0);
    return [c, bc >= 32 && bc <= 126 && base !== ch ? table[bc - 32] : 556];
  }
  if (c === 0x2009 || c === 0x202f || c === 0x00a0) return [32, table[0]];
  if (PLAIN[ch]) return glyph(PLAIN[ch], bold);
  const base = ch.normalize('NFD')[0];
  if (base !== ch) return glyph(base, bold); // ą → a, ś → s, ę → e, č → c …
  if (c < 32) return [32, table[0]];
  return [63, table[63 - 32]]; // ?
}

function textWidth(str, size, bold = false) {
  let w = 0;
  for (const ch of String(str ?? '')) w += glyph(ch, bold)[1];
  return (w * size) / 1000;
}

function encode(str, bold) {
  let out = '';
  for (const ch of String(str ?? '')) {
    const b = glyph(ch, bold)[0];
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out;
}

// Splits text into lines no wider than `width`; long words are cut.
function wrap(str, width, size, bold = false) {
  const lines = [];
  for (const para of String(str ?? '').replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (textWidth(next, size, bold) <= width) { line = next; continue; }
      if (line) lines.push(line);
      let w = word;
      while (textWidth(w, size, bold) > width) {
        let i = w.length - 1;
        while (i > 1 && textWidth(w.slice(0, i), size, bold) > width) i--;
        lines.push(w.slice(0, i)); w = w.slice(i);
      }
      line = w;
    }
    lines.push(line);
  }
  return lines;
}

// Shortens text with "…" so it fits `width`.
function fit(str, width, size, bold = false) {
  str = String(str ?? '');
  if (textWidth(str, size, bold) <= width) return str;
  while (str.length > 1 && textWidth(str + '…', size, bold) > width) str = str.slice(0, -1);
  return str.trimEnd() + '…';
}

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
}
const n = v => (Math.round(v * 100) / 100).toString();

class PdfDoc {
  constructor({ title = '', author = '' } = {}) {
    this.title = title; this.author = author; this.pages = [];
    this.addPage();
  }
  get width() { return A4.w; }
  get height() { return A4.h; }
  addPage() { this.page = []; this.pages.push(this.page); return this; }

  text(x, y, str, { size = 10, bold = false, color = '#14213a', align = 'left', width = 0 } = {}) {
    let tx = x;
    if (align !== 'left') { const w = textWidth(str, size, bold); tx = align === 'right' ? x + width - w : x + (width - w) / 2; }
    // y is the top of the text line; the baseline sits ~0.8 em lower.
    this.page.push(`BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${rgb(color)} rg ${n(tx)} ${n(A4.h - y - size * 0.8)} Td (${encode(str, bold)}) Tj ET`);
    return this;
  }
  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.5 } = {}) {
    const ops = [];
    if (fill) ops.push(`${rgb(fill)} rg`);
    if (stroke) ops.push(`${rgb(stroke)} RG ${n(lineWidth)} w`);
    ops.push(`${n(x)} ${n(A4.h - y - h)} ${n(w)} ${n(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.page.push(ops.join(' '));
    return this;
  }
  line(x1, y1, x2, y2, { color = '#dfe4ee', width = 0.5, dash = null } = {}) {
    this.page.push(`${rgb(color)} RG ${n(width)} w ${dash ? `[${dash.join(' ')}] 0 d` : '[] 0 d'} ${n(x1)} ${n(A4.h - y1)} m ${n(x2)} ${n(A4.h - y2)} l S [] 0 d`);
    return this;
  }

  toBuffer() {
    const objs = []; // index i → object number i + 1
    const add = body => { objs.push(body); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of this.pages) {
      const data = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const content = add({ dict: `<< /Length ${data.length} /Filter /FlateDecode >>`, data });
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const d = new Date(), p2 = v => String(v).padStart(2, '0');
    const info = add(`<< /Title (${encode(this.title)}) /Author (${encode(this.author)}) /Producer (CSAT Pulse) /CreationDate (D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z) >>`);

    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(offset);
      const parts = typeof o === 'string'
        ? [Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')]
        : [Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')];
      for (const b of parts) { chunks.push(b); offset += b.length; }
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`
      + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}

module.exports = { PdfDoc, textWidth, wrap, fit, A4 };
