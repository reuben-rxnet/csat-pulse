'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeQuestions, validateAnswers, formToAnswers, summarize, numbering, toCsv, duration, npsScore } = require('../src/forms/model');
const { fromTemplate } = require('../src/forms/templates');
const { parseRecipientLines } = require('../src/services/forms');

const Q = normalizeQuestions([
  { type: 'section', title: 'Support' },
  { id: 'grid01', type: 'likert', title: 'Rate us', rows: [{ id: 'rowaa', label: 'Speed' }, { id: 'rowbb', label: 'Quality', hint: 'How good?' }] },
  { id: 'nps001', type: 'nps', title: 'Recommend?' },
  { id: 'txt001', type: 'text', title: 'Comments', required: false },
  { id: 'chk001', type: 'checkbox', title: 'Tools', required: false, options: [{ id: 'opt1a', label: 'Email' }, { id: 'opt2b', label: 'Portal' }] },
  { type: 'bogus', title: 'dropped' },
]);

test('normalizeQuestions: known types only, defaults, unique ids', () => {
  assert.deepStrictEqual(Q.map(q => q.type), ['section', 'likert', 'nps', 'text', 'checkbox']);
  assert.strictEqual(Q[1].scale.length, 5);
  assert.strictEqual(Q[1].required, true);
  assert.strictEqual(Q[3].required, false);
  const dup = normalizeQuestions([{ id: 'same1', type: 'text' }, { id: 'same1', type: 'text' }]);
  assert.notStrictEqual(dup[0].id, dup[1].id);
  assert.deepStrictEqual(numbering(Q), { grid01: 1, nps001: 2, txt001: 3, chk001: 4 });
});

test('validateAnswers: keeps valid values, drops unknown ones, enforces required on submit', () => {
  const draft = validateAnswers(Q, { grid01: { rowaa: 4, rowbb: 9 }, nps001: 11, txt001: '  hi  ', chk001: ['opt1a', 'nope'], hacker: 'x' });
  assert.deepStrictEqual(draft.answers, { grid01: { rowaa: 4 }, txt001: 'hi', chk001: ['opt1a'] });
  assert.deepStrictEqual(draft.errors, {});
  const final = validateAnswers(Q, { grid01: { rowaa: 4 } }, { final: true });
  assert.strictEqual(final.errors.grid01, 'Please answer every row.');
  assert.strictEqual(final.errors.nps001, 'This question is required.');
  assert.ok(!final.errors.txt001, 'optional question');
  const ok = validateAnswers(Q, { grid01: { rowaa: 4, rowbb: 5 }, nps001: 0 }, { final: true });
  assert.deepStrictEqual(ok.errors, {});
  assert.strictEqual(ok.answers.nps001, 0, 'zero is a valid NPS answer');
});

test('formToAnswers: reads the HTML form fields of the answer page', () => {
  const a = formToAnswers(Q, { 'grid01.rowaa': '5', 'grid01.rowbb': '3', nps001: '9', txt001: 'Great', chk001: ['opt1a', 'opt2b'], _elapsed: '40' });
  assert.deepStrictEqual(a, { grid01: { rowaa: 5, rowbb: 3 }, nps001: 9, txt001: 'Great', chk001: ['opt1a', 'opt2b'] });
  assert.deepStrictEqual(formToAnswers(Q, { chk001: 'opt2b' }).chk001, ['opt2b'], 'a single checkbox arrives as a string');
});

test('summarize: grid averages and NPS like MS Forms', () => {
  const rs = [
    { name: 'A', email: 'a@x', submitted_at: '2026-10-01', answers: { grid01: { rowaa: 5, rowbb: 4 }, nps001: 10, txt001: 'Good' } },
    { name: 'B', email: 'b@x', submitted_at: '2026-10-02', answers: { grid01: { rowaa: 3, rowbb: 4 }, nps001: 8 } },
    { name: 'C', email: 'c@x', submitted_at: '2026-10-03', answers: { grid01: { rowaa: 1, rowbb: 2 }, nps001: 4, chk001: ['opt1a'] } },
  ];
  const s = summarize(Q, rs);
  const grid = s.find(x => x.q.id === 'grid01');
  assert.deepStrictEqual(grid.rows[0].counts, [1, 0, 1, 0, 1]);
  assert.strictEqual(grid.rows[0].avg, 3);
  assert.strictEqual(grid.rows[1].positive, 2 / 3);
  const nps = s.find(x => x.q.id === 'nps001');
  assert.deepStrictEqual([nps.promoters, nps.passives, nps.detractors, nps.score], [1, 1, 1, 0]);
  assert.strictEqual(npsScore({ promoters: 4, detractors: 0, n: 7 }), 57.1, 'the 57 in the MS Forms screenshot');
  assert.deepStrictEqual(s.find(x => x.q.id === 'txt001').answers.map(a => a.name), ['A']);
  assert.strictEqual(s.find(x => x.q.id === 'chk001').counts.opt1a, 1);
});

test('toCsv: one row per response with names, opens in Excel', () => {
  const csv = toCsv(Q, [{ name: 'Phawinee SINGTO', email: 'p@essilor.com', started_at: '2026-10-29T10:00:00Z', submitted_at: '2026-10-29T10:11:15Z',
    answers: { grid01: { rowaa: 4, rowbb: 5 }, nps001: 8, txt001: 'Easy, "fast"', chk001: ['opt1a', 'opt2b'] } }], { timeZone: 'UTC' });
  const lines = csv.replace(/^﻿sep=,\r\n/, '').trim().split('\r\n');
  assert.strictEqual(lines[0], 'ID,Start time,Completion time,Time to complete,Email,Name,1. Rate us – Speed,1. Rate us – Quality,2. Recommend?,3. Comments,4. Tools');
  assert.strictEqual(lines[1], '1,2026-10-29 10:00:00,2026-10-29 10:11:15,11:15,p@essilor.com,Phawinee SINGTO,Satisfied,Very Satisfied,8,"Easy, ""fast""","Email; Portal"');
  assert.strictEqual(duration(675), '11:15');
  assert.strictEqual(duration(3725), '1:02:05');
});

test('parseRecipientLines: Outlook and Excel formats, internal domains only', () => {
  const r = parseRecipientLines('Phawinee Singto <phawinee.singto@essilor.com>\nholly.qiu@luxottica.com, Holly Qiu\nRaghav@Essilor.in\nx@gmail.com\nnot-an-email\nholly.qiu@luxottica.com',
    { domains: ['essilor.com', 'luxottica.com', 'essilor.in'] });
  assert.deepStrictEqual(r.ok, [{ email: 'phawinee.singto@essilor.com', name: 'Phawinee Singto' }, { email: 'holly.qiu@luxottica.com', name: 'Holly Qiu' }, { email: 'raghav@essilor.in', name: '' }]);
  assert.deepStrictEqual(r.blocked, ['x@gmail.com']);
  assert.deepStrictEqual(r.invalid, ['not-an-email']);
});

test('company domains: every domain past stakeholders used, but no look-alikes', () => {
  const { domainAllowed } = require('../src/services/forms');
  const P = ['essilor*', 'luxottica*', 'nikonlenswear.com'];
  for (const h of ['essilor.co.th', 'cn.luxottica.com', 'essilorluxottica.id', 'luxottica.com', 'ext.essilor.com', 'essilor.in', 'essilorusa.com', 'nikonlenswear.com',
    'cn.essilor.com', 'essilor.com.pl', 'ext.essilorluxottica.id', 'essilor.fr', 'essilorchina.com', 'luxotticaretail.com', 'essilor.co.za', 'essilor.vn']) assert.ok(domainAllowed(h, P), h);
  for (const h of ['gmail.com', 'notessilor.com', 'essilor.com.x-evil.com', 'evil-luxottica.com', 'nikonlenswear.com.evil.com', 'essilor.evil.org']) assert.ok(!domainAllowed(h, P), h);
  assert.ok(domainAllowed('anything.org', []), 'empty list = any address');
});

test('RxSolutions template mirrors the MS Forms survey', () => {
  const t = fromTemplate('rxsolutions', '2026 Q4');
  assert.strictEqual(t.title, 'RxSolutions CSAT Survey (2026 Q4)');
  const qs = t.questions.filter(q => q.type !== 'section');
  assert.strictEqual(qs.length, 8);
  assert.deepStrictEqual(qs.map(q => q.type), ['likert', 'likert', 'likert', 'text', 'likert', 'text', 'text', 'nps']);
  assert.deepStrictEqual(qs.slice(0, 3).map(q => q.rows.length), [4, 5, 3]);
  assert.ok(t.description.includes('2026 Q4'));
});
