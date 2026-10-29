'use strict';
// Stakeholder survey reports: PDF and email content, and that names stay out unless asked for. No database needed.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { normalizeQuestions, summarize, numbering, toCsv } = require('../src/forms/model');
const { renderSurveyPdf } = require('../src/report/survey-layout');
const { surveyEmail } = require('../src/services/reports');

const questions = normalizeQuestions([
  { type: 'section', title: 'Support Tools & Service' },
  { id: 'grid01', type: 'likert', title: 'Rate the support', rows: [{ id: 'rowaa', label: 'Ticketing Mechanism' }, { id: 'rowbb', label: 'Resolution Time', hint: 'How fast?' }] },
  { id: 'txt001', type: 'text', title: 'What could we do better?' },
  { id: 'nps001', type: 'nps', title: 'Recommend us?' },
]);
const responses = [
  { name: 'Phawinee Singto', email: 'phawinee.singto@essilor.co.th', started_at: '2026-10-01T10:00:00Z', submitted_at: '2026-10-01T10:08:00Z', answers: { grid01: { rowaa: 4, rowbb: 3 }, txt001: 'Faster L2 answers please', nps001: 9 } },
  { name: 'Holly Qiu', email: 'holly.qiu@cn.luxottica.com', started_at: '2026-10-02T10:00:00Z', submitted_at: '2026-10-02T10:05:00Z', answers: { grid01: { rowaa: 5, rowbb: 5 }, txt001: 'Great team', nps001: 6 } },
];
const form = { id: 1, title: 'RxSolutions CSAT Survey (2026 Q3)', status: 'closed', opened_at: '2026-10-01', closed_at: '2026-10-15', questions };
const res = { responses, summary: summarize(questions, responses), numbers: numbering(questions),
  stats: { invited: 4, responded: 2, rate: 0.5, opened: 3, medianSeconds: 390 } };
// All text drawn in a PDF (content streams are deflated).
function pdfText(buf) {
  const s = buf.toString('latin1'); let out = '';
  for (const m of s.matchAll(/stream\n([\s\S]*?)\nendstream/g)) out += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
  return [...out.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(m => m[1].replace(/\\(.)/g, '$1')).join(' ');
}

test('survey PDF: valid, all questions, no names by default', () => {
  const buf = renderSurveyPdf({ form, res, producedBy: 'admin' });
  assert.ok(buf.toString('latin1', 0, 8).startsWith('%PDF-1.4'));
  const t = pdfText(buf);
  for (const s of ['RxSolutions CSAT Survey (2026 Q3)', 'SUPPORT TOOLS & SERVICE', 'Ticketing Mechanism', 'How fast?', 'Faster L2 answers please', 'NPS 0', 'Respondents not named']) assert.ok(t.includes(s), s);
  for (const s of ['Phawinee', 'Holly', 'essilor.co.th', 'RESPONDENTS']) assert.ok(!t.includes(s), `no ${s}`);
});

test('survey PDF with names: comments and respondents list name people', () => {
  const t = pdfText(renderSurveyPdf({ form, res, includeNames: true, producedBy: 'admin' }));
  for (const s of ['Named responses', 'Phawinee Singto', 'holly.qiu@cn.luxottica.com', 'RESPONDENTS']) assert.ok(t.includes(s), s);
});

test('survey email: figures and charts in the body, never names', () => {
  const { html, text } = surveyEmail(form, res, { message: 'Here are the Q3 results.', producedBy: 'admin' });
  for (const s of ['Here are the Q3 results.', 'Final results', 'Main figures', 'Net Promoter Score', '1. Rate the support', 'Ticketing Mechanism', '4.50 · 100%', 'of 4 invited']) assert.ok(html.includes(s), s);
  assert.ok(!/Phawinee|Holly|essilor\.co\.th/.test(html + text), 'no names or emails');
  assert.ok(!/<img|<svg/i.test(html), 'charts are table cells, so Outlook shows them');
  assert.match(text, /Responses 2 of 4 \(50%\)/);
});

test('ticket CSAT report email: KPI tiles with change, weekly chart, spread and groups in the body', () => {
  const { reportEmail } = require('../src/services/reports');
  const k = { csat: 0.86, avg: 4.31, rate: 0.365, sent: 1240, n: 452, det: 31, open_followups: 7, median_hours: 5.4 };
  const m = { kpis: k, prev: { ...k, csat: 0.82, avg: 4.4, rate: 0.34 },
    trend: [{ week: '2026-09-07', n: 40, csat: 0.9 }, { week: '2026-09-14', n: 38, csat: 0.7 }],
    dist: [{ score: 5, c: 269 }, { score: 4, c: 120 }, { score: 1, c: 18 }],
    byGroup: [{ key: 'WW_GRP_2/RxIT_MFG_Support', n: 120, csat: 0.92 }, { key: 'Tiny group', n: 3, csat: 1 }] };
  const { html, text } = reportEmail({ title: 'CSAT report', period: { from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) }, label: 'All owner groups', m, target: 0.85, producedBy: 'admin' });
  for (const s of ['86.0%', '+4.0 pts vs previous', '−0.09 vs previous', 'CSAT % by week', '90%', 'Score distribution', '5 Very satisfied 269', 'WW_GRP_2/RxIT_MFG_Support', '7 still to follow up']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('Tiny group'), 'groups with fewer than 5 responses are left out');
  assert.ok(!/<img|<svg/i.test(html));
  assert.match(text, /CSAT 86\.0% \(target 85%\)/);
});

test('anonymous Excel export has no Email or Name columns', () => {
  const named = toCsv(questions, responses).split('\r\n')[1], anon = toCsv(questions, responses, { anonymous: true }).split('\r\n');
  assert.ok(named.includes('Email,Name'));
  assert.ok(!anon[1].includes('Email') && !anon[1].includes('Name'));
  assert.ok(!anon.join('\n').includes('Phawinee'));
});
