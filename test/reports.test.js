'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { periodFor, adhocPeriod, nextRunAt, parseRecipients, pickSections, isCustom, STANDARD_SECTIONS, periodLabel } = require('../src/report/schedule');
const { PdfDoc, textWidth, wrap, fit } = require('../src/report/pdf');

const D = (y, m, d, h = 0) => new Date(y, m - 1, d, h);

test('periodFor: previous Monday–Sunday week, calendar month and quarter', () => {
  const wed = D(2026, 10, 21, 9); // Wednesday
  const w = periodFor('weekly', wed);
  assert.deepStrictEqual([w.from, w.to, w.prevFrom], [D(2026, 10, 12), D(2026, 10, 19), D(2026, 10, 5)]);
  const m = periodFor('monthly', wed);
  assert.deepStrictEqual([m.from, m.to, m.prevFrom], [D(2026, 9, 1), D(2026, 10, 1), D(2026, 8, 1)]);
  const q = periodFor('quarterly', wed);
  assert.deepStrictEqual([q.from, q.to, q.prevFrom], [D(2026, 7, 1), D(2026, 10, 1), D(2026, 4, 1)]);
  const jan = periodFor('monthly', D(2027, 1, 1, 7));
  assert.deepStrictEqual([jan.from, jan.to], [D(2026, 12, 1), D(2027, 1, 1)]);
});

test('adhocPeriod: both days included, previous period of equal length, and validation', () => {
  const p = adhocPeriod('2026-09-01', '2026-09-30', D(2026, 10, 21));
  assert.deepStrictEqual([p.from, p.to], [D(2026, 9, 1), D(2026, 10, 1)]);
  assert.strictEqual(p.from - p.prevFrom, p.to - p.from);
  assert.match(adhocPeriod('2026-09-30', '2026-09-01').error, /before/);
  assert.match(adhocPeriod('', '2026-09-01').error, /Choose/);
  assert.match(adhocPeriod('2026-02-30', '2026-03-01').error, /Choose/);
  assert.match(adhocPeriod('2030-01-01', '2030-01-02', D(2026, 10, 21)).error, /future/);
  assert.match(adhocPeriod('2020-01-01', '2026-01-01', D(2026, 10, 21)).error, /two years/);
  assert.strictEqual(periodLabel(p.from, p.to), '1 Sept 2026 – 30 Sept 2026'.replace(/Sept/g, p.from.toLocaleDateString('en-GB', { month: 'short' })));
});

test('nextRunAt: weekly, monthly and quarterly at the chosen hour, always strictly later', () => {
  const wed9 = D(2026, 10, 21, 9);
  assert.deepStrictEqual(nextRunAt({ frequency: 'weekly', run_day: 1, send_hour: 7 }, wed9), D(2026, 10, 26, 7));
  assert.deepStrictEqual(nextRunAt({ frequency: 'weekly', run_day: 3, send_hour: 10 }, wed9), D(2026, 10, 21, 10)); // later today
  assert.deepStrictEqual(nextRunAt({ frequency: 'weekly', run_day: 3, send_hour: 9 }, wed9), D(2026, 10, 28, 9));   // exactly now → next week
  assert.deepStrictEqual(nextRunAt({ frequency: 'monthly', run_day: 1, send_hour: 7 }, wed9), D(2026, 11, 1, 7));
  assert.deepStrictEqual(nextRunAt({ frequency: 'monthly', run_day: 25, send_hour: 7 }, wed9), D(2026, 10, 25, 7));
  assert.deepStrictEqual(nextRunAt({ frequency: 'monthly', run_day: 1, send_hour: 7 }, D(2026, 12, 5)), D(2027, 1, 1, 7));
  assert.deepStrictEqual(nextRunAt({ frequency: 'quarterly', run_day: 2, send_hour: 8 }, wed9), D(2027, 1, 2, 8));
  assert.deepStrictEqual(nextRunAt({ frequency: 'quarterly', run_day: 2, send_hour: 8 }, D(2026, 10, 1)), D(2026, 10, 2, 8));
});

test('parseRecipients: splits, lowercases, de-duplicates and enforces the allowed domains', () => {
  const opts = { domains: ['essilor.com', 'luxottica.com'], max: 3 };
  const r = parseRecipients('Reuben.DSouza@essilor.com; a@it.luxottica.com\n reuben.dsouza@essilor.com', opts);
  assert.deepStrictEqual(r.emails, ['reuben.dsouza@essilor.com', 'a@it.luxottica.com']);
  assert.strictEqual(r.error, null);
  assert.match(parseRecipients('x@gmail.com', opts).error, /only be sent to @essilor.com, @luxottica.com/);
  assert.match(parseRecipients('x@notessilor.com', opts).error, /only be sent/); // look-alike domain
  assert.match(parseRecipients('not-an-email', opts).error, /Not a valid/);
  assert.match(parseRecipients('', opts).error, /at least one/);
  assert.match(parseRecipients('a@essilor.com b@essilor.com c@essilor.com d@essilor.com', opts).error, /At most 3/);
  assert.strictEqual(parseRecipients('x@gmail.com', { domains: [] }).error, null);
});

test('pickSections / isCustom: standard leaves out agent names; custom keeps only ticked parts', () => {
  assert.deepStrictEqual(pickSections('standard', ['agents']), STANDARD_SECTIONS);
  assert.ok(!STANDARD_SECTIONS.includes('agents'));
  assert.deepStrictEqual(pickSections('custom', ['agents', 'trend', 'bogus']), ['trend', 'agents']);
  assert.strictEqual(isCustom(STANDARD_SECTIONS), false);
  assert.strictEqual(isCustom(['trend', 'agents']), true);
  assert.strictEqual(isCustom([...STANDARD_SECTIONS, 'agents']), true);
});

test('pdf: valid structure, correct xref offsets, WinAnsi text and wrapping', () => {
  const doc = new PdfDoc({ title: 'Test – é' });
  doc.text(40, 40, 'Hello (world) \\ Chloé – ł', { bold: true }).rect(40, 60, 100, 20, { fill: '#1f5fbf' }).line(40, 90, 200, 90);
  doc.addPage().text(40, 40, 'Page 2');
  const buf = doc.toBuffer(), s = buf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /\/Count 2/);
  const xrefAt = parseInt(/startxref\n(\d+)/.exec(s)[1], 10);
  assert.strictEqual(s.slice(xrefAt, xrefAt + 4), 'xref');
  for (const m of s.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)) assert.match(s.slice(+m[1], +m[1] + 12), /^\d+ 0 obj/);
  assert.match(s, /\/Title \(Test \\226 \\351\)/);
  assert.ok(textWidth('W', 10) > textWidth('i', 10));
  assert.ok(textWidth('Abc', 10, true) > textWidth('Abc', 10));
  for (const l of wrap('The quick brown fox jumps over the lazy dog '.repeat(5), 120, 9)) assert.ok(textWidth(l, 9) <= 120);
  assert.ok(fit('A very long owner group name that will not fit', 80, 9).endsWith('…'));
});
