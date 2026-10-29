'use strict';
// Stakeholder surveys: the survey definition (questions), answer checks, result summaries and the Excel export.
// Pure functions – no database or network – so they can be unit-tested (test/forms.test.js).
//
// A survey is an ordered list of items:
//   section   { id, type, title, description }                         – heading between groups of questions
//   likert    { id, type, title, description, required, rows:[{id,label,hint}], scale:[label…] }  – rating grid
//   rating    { id, type, title, description, required, max (3–10) }   – stars
//   choice    { id, type, title, description, required, options:[{id,label}] }   – pick one
//   checkbox  { id, type, title, description, required, options:[{id,label}] }   – pick any
//   text      { id, type, title, description, required, long }          – short or long text
//   nps       { id, type, title, description, required, low, high }     – 0–10 "how likely to recommend"
// Answers are stored by id: likert {rowId: 1..scale}, rating 1..max, choice optionId, checkbox [optionId], text string, nps 0..10.
const crypto = require('crypto');

const TYPES = ['section', 'likert', 'rating', 'choice', 'checkbox', 'text', 'nps'];
const DEFAULT_SCALE = ['Very Unsatisfied', 'Unsatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'];
const LIMITS = { items: 100, rows: 30, options: 30, scale: 10, title: 500, description: 2000, label: 300, text: 4000 };

const newId = () => crypto.randomBytes(5).toString('hex');
const okId = id => typeof id === 'string' && /^[a-z0-9]{4,24}$/i.test(id);
const str = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);

// Cleans a survey definition coming from the builder: known types only, sane limits, unique ids.
function normalizeQuestions(input) {
  const seen = new Set();
  const uid = id => { let x = okId(id) && !seen.has(id) ? id : newId(); while (seen.has(x)) x = newId(); seen.add(x); return x; };
  const list = (arr, max, map) => (Array.isArray(arr) ? arr : []).slice(0, max).map(map).filter(Boolean);
  return list(input, LIMITS.items, q => {
    if (!q || !TYPES.includes(q.type)) return null;
    const base = { id: uid(q.id), type: q.type, title: str(q.title, LIMITS.title), description: str(q.description, LIMITS.description) };
    if (q.type === 'section') return base;
    base.required = q.required !== false;
    switch (q.type) {
      case 'likert': {
        const scale = list(q.scale, LIMITS.scale, s => str(s, 60) || null);
        const rows = list(q.rows, LIMITS.rows, r => (r && str(r.label, LIMITS.label) ? { id: uid(r.id), label: str(r.label, LIMITS.label), hint: str(r.hint, LIMITS.label) } : null));
        return { ...base, scale: scale.length >= 2 ? scale : [...DEFAULT_SCALE], rows: rows.length ? rows : [{ id: uid(), label: 'Statement 1', hint: '' }] };
      }
      case 'rating': return { ...base, max: Math.min(10, Math.max(3, parseInt(q.max, 10) || 5)) };
      case 'choice': case 'checkbox': {
        const options = list(q.options, LIMITS.options, o => (o && str(o.label, LIMITS.label) ? { id: uid(o.id), label: str(o.label, LIMITS.label) } : null));
        return { ...base, options: options.length ? options : [{ id: uid(), label: 'Option 1' }, { id: uid(), label: 'Option 2' }] };
      }
      case 'text': return { ...base, long: q.long !== false };
      case 'nps': return { ...base, low: str(q.low, 60) || 'Not at all likely', high: str(q.high, 60) || 'Extremely likely' };
      default: return null;
    }
  });
}

// Question numbers as people see them (sections aren't numbered): { id → 1, 2, … }.
function numbering(questions) {
  const out = {}; let n = 0;
  for (const q of questions) if (q.type !== 'section') out[q.id] = ++n;
  return out;
}

// Checks answers against the questions. final=true also enforces required questions (on Submit).
// Returns { answers (only valid values, unknown ids dropped), errors: { questionId: message } }.
function validateAnswers(questions, input, { final = false } = {}) {
  const answers = {}, errors = {};
  const a = input && typeof input === 'object' ? input : {};
  const int = v => (v === '' || v === null || v === undefined ? NaN : Number(v));
  for (const q of questions) {
    if (q.type === 'section') continue;
    const v = a[q.id];
    let val;
    switch (q.type) {
      case 'likert': {
        const rows = {};
        for (const r of q.rows) { const n = int(v && v[r.id]); if (Number.isInteger(n) && n >= 1 && n <= q.scale.length) rows[r.id] = n; }
        if (Object.keys(rows).length) val = rows;
        if (final && q.required && Object.keys(rows).length < q.rows.length) errors[q.id] = q.rows.length > 1 ? 'Please answer every row.' : 'Please choose an answer.';
        break;
      }
      case 'rating': { const n = int(v); if (Number.isInteger(n) && n >= 1 && n <= q.max) val = n; break; }
      case 'nps': { const n = int(v); if (Number.isInteger(n) && n >= 0 && n <= 10) val = n; break; }
      case 'choice': if (q.options.some(o => o.id === v)) val = v; break;
      case 'checkbox': { const picked = [...new Set([].concat(v || []))].filter(id => q.options.some(o => o.id === id)); if (picked.length) val = picked; break; }
      case 'text': { const t = str(v, LIMITS.text); if (t) val = t; break; }
    }
    if (val !== undefined) answers[q.id] = val;
    else if (final && q.required && !errors[q.id]) errors[q.id] = 'This question is required.';
  }
  return { answers, errors };
}

// The answer page posts a normal HTML form: grid rows as "<questionId>.<rowId>", checkboxes repeated, the rest by id.
function formToAnswers(questions, body) {
  const b = body || {}, out = {};
  const one = v => (Array.isArray(v) ? v[v.length - 1] : v);
  for (const q of questions) {
    if (q.type === 'section') continue;
    if (q.type === 'likert') {
      const rows = {};
      for (const r of q.rows) { const v = one(b[`${q.id}.${r.id}`]); if (v !== undefined && v !== '') rows[r.id] = Number(v); }
      if (Object.keys(rows).length) out[q.id] = rows;
    } else if (q.type === 'checkbox') { if (b[q.id] !== undefined) out[q.id] = [].concat(b[q.id]); }
    else if (q.type === 'rating' || q.type === 'nps') { const v = one(b[q.id]); if (v !== undefined && v !== '') out[q.id] = Number(v); }
    else { const v = one(b[q.id]); if (v !== undefined) out[q.id] = v; }
  }
  return out;
}

const npsGroup = n => (n >= 9 ? 'promoter' : n >= 7 ? 'passive' : 'detractor');
const npsScore = ({ promoters, detractors, n }) => (n ? Math.round(((promoters - detractors) / n) * 1000) / 10 : null);

// Results per question from submitted responses ([{ answers, name, email, submitted_at }]).
function summarize(questions, responses) {
  return questions.map(q => {
    if (q.type === 'section') return { q };
    const vals = responses.map(r => ({ v: r.answers && r.answers[q.id], r })).filter(x => x.v !== undefined && x.v !== null);
    switch (q.type) {
      case 'likert': {
        const k = q.scale.length;
        const rows = q.rows.map(row => {
          const counts = Array(k).fill(0); let sum = 0, n = 0;
          for (const { v } of vals) { const x = v[row.id]; if (x >= 1 && x <= k) { counts[x - 1]++; sum += x; n++; } }
          const positive = counts.slice(-2).reduce((a, b) => a + b, 0), negative = counts.slice(0, 2).reduce((a, b) => a + b, 0);
          return { row, counts, n, avg: n ? sum / n : null, positive: n ? positive / n : null, negative: n ? negative / n : null };
        });
        return { q, n: vals.length, rows };
      }
      case 'rating': {
        const counts = Array(q.max).fill(0); let sum = 0;
        for (const { v } of vals) { counts[v - 1]++; sum += v; }
        return { q, n: vals.length, counts, avg: vals.length ? sum / vals.length : null };
      }
      case 'nps': {
        const counts = Array(11).fill(0), g = { promoters: 0, passives: 0, detractors: 0 };
        for (const { v } of vals) { counts[v]++; g[npsGroup(v) + 's']++; }
        return { q, n: vals.length, counts, ...g, score: npsScore({ ...g, n: vals.length }) };
      }
      case 'choice': case 'checkbox': {
        const counts = Object.fromEntries(q.options.map(o => [o.id, 0]));
        for (const { v } of vals) for (const id of [].concat(v)) if (id in counts) counts[id]++;
        return { q, n: vals.length, counts };
      }
      case 'text':
        return { q, n: vals.length, answers: vals.map(({ v, r }) => ({ text: v, name: r.name, email: r.email, at: r.submitted_at })).sort((a, b) => new Date(b.at) - new Date(a.at)) };
      default: return { q, n: vals.length };
    }
  });
}

// "11:15" – minutes:seconds, like MS Forms' "time to complete" (hours added when needed).
function duration(seconds) {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

// One row per response, one column per question (one per row for grids). Opens straight in Excel (UTF-8 BOM, sep=,).
// anonymous: no Email / Name columns (for reports sent without names).
function toCsv(questions, responses, { timeZone, anonymous = false } = {}) {
  const num = numbering(questions);
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const ts = d => (d ? new Date(d).toLocaleString('sv-SE', { timeZone }).replace('T', ' ') : '');
  const cols = [];
  for (const q of questions) {
    if (q.type === 'section') continue;
    const title = `${num[q.id]}. ${q.title}`;
    if (q.type === 'likert') for (const r of q.rows) cols.push({ qid: q.id, head: q.rows.length > 1 ? `${title} – ${r.label}` : title, get: a => (a && a[r.id] ? q.scale[a[r.id] - 1] : '') });
    else if (q.type === 'choice') cols.push({ qid: q.id, head: title, get: a => (q.options.find(o => o.id === a) || {}).label || '' });
    else if (q.type === 'checkbox') cols.push({ qid: q.id, head: title, get: a => [].concat(a || []).map(id => (q.options.find(o => o.id === id) || {}).label).filter(Boolean).join('; ') });
    else cols.push({ qid: q.id, head: title, get: a => (a == null ? '' : a) });
  }
  const who = anonymous ? [] : ['Email', 'Name'];
  const head = ['ID', 'Start time', 'Completion time', 'Time to complete', ...who, ...cols.map(c => c.head)];
  const lines = responses.map((r, i) => [i + 1, ts(r.started_at), ts(r.submitted_at), duration((new Date(r.submitted_at) - new Date(r.started_at)) / 1000), ...(anonymous ? [] : [r.email, r.name]),
    ...cols.map(c => c.get(r.answers ? r.answers[c.qid] : undefined))]);
  return '﻿sep=,\r\n' + [head, ...lines].map(l => l.map(cell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { TYPES, DEFAULT_SCALE, LIMITS, newId, normalizeQuestions, numbering, validateAnswers, formToAnswers, summarize, npsGroup, npsScore, duration, toCsv };
