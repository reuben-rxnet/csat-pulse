'use strict';
// Starting points for "New survey". The RxSolutions template mirrors the quarterly MS Forms survey
// (design reference/RxSolutions CSAT Survey (2026 Q3).pdf).
const { normalizeQuestions } = require('./model');

const S = ['Very Unsatisfied', 'Unsatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'];
const grid = (title, rows) => ({ type: 'likert', required: true, title, scale: S, rows: rows.map(r => (Array.isArray(r) ? { label: r[0], hint: r[1] } : { label: r })) });

const TEMPLATES = [
  {
    key: 'rxsolutions',
    name: 'RxSolutions quarterly CSAT',
    summary: 'The quarterly stakeholder survey: support tools, problem handling, effort, overall rating, comments and NPS (8 questions).',
    title: 'RxSolutions CSAT Survey ({period})',
    description: 'For support and service provided by the RxNet Application Support Team.\n\nHi! Would you mind taking a few minutes to complete this form to provide your feedback for the support provided by the RxNet Application Support Team in {period}? Your satisfaction is our top priority!',
    questions: [
      { type: 'section', title: 'Support Tools & Service' },
      grid('How do you personally evaluate and rate the support provided by RxNet Application Support Team?', ['Ticketing Mechanism', 'Support Response Time', 'Resolution Time', 'SLA Adherence']),
      { type: 'section', title: 'Issues / Problem Handling' },
      grid('How do you personally evaluate and rate the support provided by RxNet Application Support Team?', ['Efforts to Understand the Problem Clearly', 'Subject Matter Knowledge/Expertise', 'Patience & Friendliness', "Workarounds Provided for Issues which take long to resolve", 'First Time Resolution']),
      { type: 'section', title: 'Your Experience With Us' },
      grid('How do you personally evaluate and rate the Effort Required to Resolve Your Issue?', [
        ['Outcome experience (resolution)', 'How satisfied are you with the ease of resolving your issue?'],
        ['Customer effort', 'How satisfied are you with the amount of effort you had to put in to get your issue resolved?'],
        ['Overall Help', 'How satisfied are you with how simple it was to get the help you needed?']]),
      { type: 'text', required: true, long: true, title: 'Please tell us what made the experience easy or difficult for you.' },
      { type: 'section', title: 'Overall Rating of the Service Provided' },
      grid('Please rate the overall service provided by RxNet Application Support Team.', ['Overall Satisfaction Level']),
      { type: 'text', required: true, long: true, title: 'Would you like to tell us something that we could do better?' },
      { type: 'text', required: true, long: true, title: 'Anything we did well and you would like to acknowledge? This will help motivate the team.' },
      { type: 'nps', required: true, title: 'How likely are you to recommend us to a friend or colleague?' },
    ],
  },
  {
    key: 'pulse',
    name: 'Quick pulse',
    summary: 'Three short questions: overall satisfaction, recommendation and one comment.',
    title: 'Quick feedback ({period})',
    description: 'Three quick questions about the support you received from us this quarter.',
    questions: [
      grid('Overall, how satisfied are you with the support you received?', ['Overall satisfaction']),
      { type: 'nps', required: true, title: 'How likely are you to recommend us to a friend or colleague?' },
      { type: 'text', required: false, long: true, title: 'What is one thing we could do better?' },
    ],
  },
  { key: 'blank', name: 'Blank survey', summary: 'Start from scratch.', title: 'Untitled survey', description: '', questions: [] },
];

// "2026 Q4" for a date (the quarter it falls in).
const currentPeriod = (d = new Date()) => `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;

function fromTemplate(key, period = currentPeriod()) {
  const t = TEMPLATES.find(x => x.key === key) || TEMPLATES.find(x => x.key === 'blank');
  const fill = s => s.replace(/\{period\}/g, period);
  return { title: fill(t.title), description: fill(t.description), questions: normalizeQuestions(JSON.parse(JSON.stringify(t.questions))) };
}

module.exports = { TEMPLATES, fromTemplate, currentPeriod };
