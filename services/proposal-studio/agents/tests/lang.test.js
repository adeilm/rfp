/**
 * lang.test.js - A French deck stays French: the sentences the agents write, and the requirement column.
 * The sentences are the English ones found in real decks of 2026-10-30 (fe42d735, ee0b92d8, dbb1bea6).
 */
const test = require('node:test');
const assert = require('node:assert');
const { looksEnglish, looksFrench, checkWritten, languageLine } = require('../lib/lang.js');
const { normalizeInput } = require('../lib/input.js');
const agent5 = require('../lib/agent5.js');

const ENGLISH = [
  'Implement continuous risk monitoring and mitigation throughout the project lifecycle.',
  'Schedule regular briefings and obtain commitments in advance',
  'Reserve resources early and validate capacity with Azure team',
  'A dedicated support team will be available during business hours.',
  'Insufficient health sector experience',
  'Offer training sessions for client staff on platform usage and maintenance.',
  'Data pipelines must be automated with Python.'
];
const FRENCH = [
  "Mise en place d'un tableau de bord Power BI avec des pipelines Python",
  'Notre équipe compte 2 ingénieurs frontend seniors et 1 backend senior',
  'Une équipe de support dédiée sera disponible aux heures ouvrées.',
  'Expérience insuffisante dans le secteur de la santé',
  'Hébergement sur Azure',
  'React, Spring Boot, PostgreSQL et AWS'
];

test('English sentences of real decks are detected, French ones and technical names are not', () => {
  ENGLISH.forEach(t => assert.ok(looksEnglish(t), t));
  FRENCH.forEach(t => assert.ok(!looksEnglish(t), t));
  assert.ok(looksFrench('Les flux de données doivent être automatisés avec des pipelines Python.'));
  assert.ok(!looksFrench('يجب تطوير الواجهة باستعمال Angular.'));
});

test('checkWritten: English in a French deck and input field names are violations', () => {
  const v = checkWritten([['a', ENGLISH[0]], ['b', FRENCH[0]], ['c', 'Expertise React (ready_facts.whyUs).']], 'fr');
  assert.strictEqual(v.length, 2);
  assert.match(v[0], /^a: written in English/);
  assert.match(v[1], /^c: do not cite input field names \(ready_facts\)/);
  assert.deepStrictEqual(checkWritten([['a', ENGLISH[0]]], 'en'), [], 'English deck: English is right');
  assert.match(languageLine('fr'), /French/);
});

const v2 = (language, rows) => ({ contract: 'olivesoft.proposal-input.v2', tender_id: 'T1', language,
  tender: { title: 'Tableau de bord' }, analysis: {}, matrix: { rows } });

test('French deck: the requirement column shows the tender’s French words, coverage follows', () => {
  const rows = [
    { requirement_id: 'R1', requirement: 'Dashboard must be built using Power BI.', quote: 'les tableaux de bord doivent être réalisés sous Power BI.', coverage_score: 100 },
    { requirement_id: 'R2', requirement: 'Kubernetes', quote: null, coverage_score: 50 }
  ];
  const { input } = normalizeInput(v2('fr', rows));
  assert.deepStrictEqual(input.tender.requirements, ['Les tableaux de bord doivent être réalisés sous Power BI.', 'Kubernetes']);
  assert.deepStrictEqual(input.match.requirement_coverage.map(r => r.requirement), input.tender.requirements,
    'the coverage is keyed by the same text, so the compliance table still finds each row');
});

test('a quote in another language, or an English deck, keeps the restated requirement', () => {
  const arabic = [{ requirement_id: 'R1', requirement: 'Develop the front-end using Angular.', quote: 'يجب تطوير الواجهة باستعمال Angular.' }];
  assert.deepStrictEqual(normalizeInput(v2('fr', arabic)).input.tender.requirements, ['Develop the front-end using Angular.']);
  const french = [{ requirement_id: 'R1', requirement: 'Use Power BI.', quote: 'Les tableaux de bord sous Power BI.' }];
  assert.deepStrictEqual(normalizeInput(v2('en', french)).input.tender.requirements, ['Use Power BI.']);
});

test('agent 5 (real mode): an English answer is sent back and the French retry is kept', async () => {
  const raw = require('../fixtures/inputs/proposal_v2_example.json');
  const { input } = normalizeInput(JSON.parse(JSON.stringify(raw)));
  input.tender.language = 'fr';
  const english = { differentiators: ['Our team will deliver the platform with the required skills and experience.'],
    governance: ['A steering committee will meet with the client.'], references: [], support: ['A dedicated support team will be available.'] };
  const french = { differentiators: ['Une équipe expérimentée sur des plateformes publiques similaires.'],
    governance: ['Un comité de pilotage réunit le client et OliveSoft.'], references: [], support: ['Une équipe de support dédiée pendant le contrat.'] };
  const requests = [];
  const answers = [english, french];
  const call = async (req) => { requests.push(req); return { ok: true, json: answers[requests.length - 1] || french,
    usage: { promptTokens: 1, completionTokens: 1 }, rateLimitWaits: 0, model: 'fake' }; };
  const res = await agent5.executeAgent5(input, { mode: 'real', call, maxAttempts: 3 });
  assert.ok(requests.length >= 2, 'the English answer was refused');
  assert.match(requests[0].user, /write every sentence in French/);
  assert.match(requests[1].user, /written in English/);
  const text = JSON.stringify(res.slides);
  assert.doesNotMatch(text, /Our team will deliver|A dedicated support team/);
});

test('names joined by "et" are checked one by one ("Python et Airflow")', () => {
  const { checkNames } = require('../lib/checks.js');
  // the allowed names are input sentences, as in deck f82789f4 (2026-10-30), where agent 5 lost two bullets to this
  const allowed = ['Designed an automated ETL workflow (Python + Airflow) that reduced data refresh time.'];
  assert.deepStrictEqual(checkNames('Un workflow ETL avec Python et Airflow.', allowed, 'p'), []);
  assert.strictEqual(checkNames('Un workflow avec Python et Kubeflow.', allowed, 'p').length, 1, 'an unknown part is still refused');
  assert.deepStrictEqual(checkNames('Banque de France', ['Banque de France'], 'p'), []);
});

test('architecture (real mode): components in English or with a placeholder are sent back', async () => {
  const { executeDiagramAgentsReal } = require('../lib/diagrams.js');
  const raw = require('../fixtures/inputs/proposal_v2_example.json');
  const { input } = normalizeInput(JSON.parse(JSON.stringify(raw)));
  input.tender.language = 'fr';
  const architecture = { nodes: [{ id: 'web', label: 'Portail', group: 'frontend' }, { id: 'api', label: 'API', group: 'backend' }],
    edges: [{ from: 'web', to: 'api', label: 'REST' }] };
  // as in deck e22b4c1b (2026-10-30): the model wrapped product names in placeholders, in English
  const bad = { architecture, components: ['[TO FILL: Power BI] dashboards', 'The data pipelines will be built with the ETL tools'] };
  const good = { architecture, components: ['Tableaux de bord décisionnels', 'Chaîne de traitement des données'] };
  const plan = { plan: [{ phase: 'Cadrage', weeks: 4, roles: [] }], risks: [] };
  const requests = [];
  const call = async (req) => {
    requests.push(req);
    const isArch = /architecture for this tender/.test(req.user);
    const json = isArch ? (requests.filter(r => /architecture for this tender/.test(r.user)).length === 1 ? bad : good) : plan;
    return { ok: true, json, usage: { promptTokens: 1, completionTokens: 1 }, rateLimitWaits: 0, model: 'fake' };
  };
  const facts = { projectType: 'software', technologies: ['Power BI', 'Python'], avgDurationMonths: 1, teamProfiles: [] };
  const res = await executeDiagramAgentsReal(input, facts, { call, maxAttempts: 3 });
  const arch = requests.filter(r => /architecture for this tender/.test(r.user));
  assert.match(arch[0].user, /write every sentence in French/);
  assert.strictEqual(arch.length, 2, 'the first answer was refused');
  assert.match(arch[1].user, /no placeholder in a component/);
  assert.match(arch[1].user, /written in English/);
  assert.deepStrictEqual(res.data.components, good.components);
});
