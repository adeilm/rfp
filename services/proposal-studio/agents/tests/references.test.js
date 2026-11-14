/**
 * references.test.js - The references slide from OliveSoft's real projects when the evidence names none.
 * Runs on the shipped knowledge base (KNOWLEDGE_DIR in the container, knowledge-base/ on a host).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { catalogReferences } = require('../lib/references.js');
const agent5 = require('../lib/agent5.js');
const { normalizeInput } = require('../lib/input.js');

const KB = process.env.KNOWLEDGE_DIR || path.join(__dirname, '..', '..', '..', '..', 'knowledge-base');
const read = sub => fs.readdirSync(path.join(KB, sub)).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(KB, sub, f), 'utf-8')));
const catalog = { projects: read('projects'), stacks: read('tech_stacks') };
// DEMO-003 (2026-10-30): its only matching project was a demo record, so the slide stayed [TO FILL]
const DASHBOARD = 'Les tableaux de bord doivent être réalisés sous Power BI. Pipelines Python. Hébergement Azure.';

test('same technologies first: real OliveSoft projects, never a demo record', () => {
  const refs = catalogReferences(catalog, DASHBOARD.toLowerCase(), 1);
  assert.strictEqual(refs.length, 3);
  refs.forEach(r => {
    assert.strictEqual(r.basis, 'technology');
    assert.ok(r.stack.some(t => ['power bi', 'python', 'azure', 'azure data factory'].includes(t)), r.name);
    assert.ok(catalog.projects.some(p => p.title === r.name && p.origin !== 'demo'), r.name);
  });
  // deck ac16a533 (2026-10-30) cited a Kubeflow MLOps project for a Power BI tender: it shared only "Azure"
  assert.ok(refs.some(r => r.stack.includes('power bi')), 'a Power BI project is cited');
  assert.ok(!refs.some(r => /kubeflow/i.test(r.name)), 'a cloud provider alone does not make a reference');
});

test('no project with the technologies: projects of the department whose stack the tender asks for', () => {
  // Looker Studio is in the BI & Dashboarding stack but in no project
  const refs = catalogReferences(catalog, 'reporting sous looker studio', 0.9);
  assert.ok(refs.length >= 1);
  refs.forEach(r => { assert.strictEqual(r.basis, 'department'); assert.match(r.department, /BI/); });
});

test('fit under 80 %, unknown fit, or no known technology: nothing (the slide stays [TO FILL])', () => {
  assert.deepStrictEqual(catalogReferences(catalog, DASHBOARD, 0.79), []);
  assert.deepStrictEqual(catalogReferences(catalog, DASHBOARD, null), []);
  assert.deepStrictEqual(catalogReferences(catalog, 'fourniture de mobilier de bureau', 1), []);
});

test('agent 5: the cards come from the catalog when the evidence has no project, department cards say so', () => {
  const raw = JSON.parse(JSON.stringify(require('../fixtures/inputs/proposal_v2_example.json')));
  const { input } = normalizeInput(raw);
  input.match.similar_projects = [];
  input.match.fit = 1;
  input.tender.requirements = ['Les tableaux de bord doivent être réalisés sous Power BI.'];
  const facts = agent5.buildReadyFacts(input, catalog);
  assert.strictEqual(facts.projects.top.length, 3);
  const slides = agent5.buildAgent5Slides({ references: [] }, input, facts);
  const cards = slides.find(s => s.id === 's7').blocks[0].cards;
  assert.ok(cards.every(c => !c.title.includes('TO FILL')));
  input.match.fit = 0.5;
  assert.strictEqual(agent5.buildReadyFacts(input, catalog).projects.top.length, 0);
});
