/**
 * pricing.test.js - Budget from OliveSoft's pricing file (knowledge-base/pricing/pricing.json):
 * day rates by role and seniority, cloud and LLM run costs, the s9 slide that shows them.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pricingLib = require('../lib/pricing.js');
const agent4 = require('../lib/agent4.js');
const pipeline = require('../lib/pipeline.js');

// the shipped file: PRICING_FILE in the containers (docker-compose mounts knowledge-base/pricing), else the repository
const FILE = process.env.PRICING_FILE || path.resolve(__dirname, '..', '..', '..', '..', 'knowledge-base', 'pricing', 'pricing.json');
const pricing = () => JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const tender = (technical = []) => ({ tender: { language: 'fr', title: 'Plateforme', requirements: { technical } } });

test('the shipped pricing file has every role at every level, both clouds and the LLM models', () => {
  const p = pricing();
  for (const role of ['backend', 'frontend', 'devops', 'pm', 'designer', 'qa']) {
    for (const s of pricingLib.SENIORITIES) assert.ok(p.day_rates[role][s] > 0, `${role} ${s}`);
  }
  for (const c of ['azure', 'gcp']) for (const k of pricingLib.CLOUD_ITEMS) assert.ok(p.cloud[c].items[k].price > 0, `${c} ${k}`);
  assert.ok(Object.keys(p.llm.models).length >= 3);
});

test('build cost: days x the rate of the level each role is staffed with, plus support, contingency and margin', () => {
  const p = pricing();
  p.staffing.pm = 'senior';
  p.staffing.backend = 'junior';
  const c = pricingLib.buildCost([{ role: 'pm', days: 10 }, { role: 'backend', days: 20 }], {}, p, 'azure');
  assert.strictEqual(c.build[0].rateCents, p.day_rates.pm.senior * 100);
  assert.strictEqual(c.build[1].rateCents, p.day_rates.backend.junior * 100);
  const build = 10 * p.day_rates.pm.senior * 100 + 20 * p.day_rates.backend.junior * 100;
  assert.strictEqual(c.buildCents, build);
  assert.strictEqual(c.extrasCents, Math.round(build * (p.support_percent_of_build + p.contingency_percent + p.margin_percent)));
  assert.strictEqual(c.oneTimeCents, c.buildCents + c.extrasCents);
});

test('run cost: hourly cloud items x 730 h, USD converted at the file rate, LLM per request', () => {
  const p = pricing();
  const c = pricingLib.buildCost([], {
    cloud: [{ item: 'vm_medium', units: 2 }], storage_gb: 100,
    llm: [{ model: 'claude-sonnet-5-5', requests_per_month: 10000, input_tokens: 2000, output_tokens: 500 }]
  }, p, 'gcp');
  const usd = p.usd_per_eur.value;
  assert.strictEqual(c.run[0].monthlyCents, Math.round(p.cloud.gcp.items.vm_medium.price * 730 * 2 / usd * 100));
  assert.strictEqual(c.run[1].monthlyCents, Math.round(p.cloud.gcp.items.storage_gb.price * 100 / usd * 100));
  const m = p.llm.models['claude-sonnet-5-5'];
  assert.strictEqual(c.run[2].monthlyCents, Math.round((2000 * m.input_per_1m + 500 * m.output_per_1m) / 1e6 * 10000 / usd * 100));
  assert.strictEqual(c.monthlyRunCents, c.run.reduce((s, l) => s + l.monthlyCents, 0));
  const az = pricingLib.buildCost([], { cloud: [{ item: 'vm_small', units: 1 }] }, p, 'azure');
  assert.strictEqual(az.run[0].monthlyCents, Math.round(p.cloud.azure.items.vm_small.price * 730 * 100), 'EUR prices are not converted');
});

test('cloud provider: the one the tender names, else the default', () => {
  const p = pricing();
  assert.deepStrictEqual(pricingLib.chooseCloud(tender(['Hébergement sur Google Cloud']), p), { provider: 'gcp', named: true });
  assert.deepStrictEqual(pricingLib.chooseCloud(tender(['Déploiement Azure obligatoire']), p), { provider: 'azure', named: true });
  assert.deepStrictEqual(pricingLib.chooseCloud(tender(['Azure ou GCP']), p), { provider: p.default_cloud, named: false });
  p.default_cloud = 'gcp';
  assert.deepStrictEqual(pricingLib.chooseCloud(tender([]), p), { provider: 'gcp', named: false });
});

test('the LLM may only use the keys it was given, with whole positive numbers', () => {
  const p = pricing();
  assert.deepStrictEqual(pricingLib.validateRunChoices({ cloud: [{ item: 'vm_small', units: 1 }], storage_gb: 10,
    llm: [{ model: 'gpt-6-luna', requests_per_month: 5, input_tokens: 10, output_tokens: 10 }] }, p, 'azure'), []);
  const v = pricingLib.validateRunChoices({ cloud: [{ item: 'kubernetes', units: 0 }], storage_gb: -1,
    llm: [{ model: 'gpt-4', requests_per_month: 1.5 }] }, p, 'azure');
  assert.ok(v.some(x => /kubernetes/.test(x)) && v.some(x => /units/.test(x)) && v.some(x => /storage_gb/.test(x)));
  assert.ok(v.some(x => /gpt-4/.test(x)) && v.some(x => /requests_per_month/.test(x)));
});

test('slide s9: one table, build lines add up to the build total, run lines add up to the run total', () => {
  const p = pricing();
  const c = pricingLib.buildCost([{ role: 'pm', days: 25 }, { role: 'backend', days: 55 }, { role: 'frontend', days: 70 }],
    { cloud: [{ item: 'vm_medium', units: 1 }, { item: 'db_medium', units: 1 }], storage_gb: 500 }, p, 'azure');
  const s = agent4.buildPricingSlide(c, 'fr', p);
  const text = JSON.stringify(s);
  assert.doesNotMatch(text, /TO FILL/);
  assert.strictEqual(s.requiresApproval, true);
  assert.deepStrictEqual(s.blocks.map(b => b.kind), ['table', 'note'], 'every amount is in the table');
  assert.match(s.blocks[1].text, /^Estimation indicative, tarifs à confirmer/);
  const rows = s.blocks[0].rows;
  const euros = x => Number(x.replace(/\/mois$/, '').replace(/[^\d,]/g, '').replace(',', '.'));
  const buildTotal = rows.findIndex(r => r[0] === 'Total réalisation (HT)');
  const runTotal = rows.findIndex(r => r[0].startsWith('Total exploitation (Microsoft Azure, France Central)'));
  assert.ok(buildTotal > 0 && runTotal > buildTotal);
  const cents = x => Math.round(euros(x) * 100);
  assert.strictEqual(rows.slice(0, buildTotal).reduce((a, r) => a + cents(r[3]), 0), cents(rows[buildTotal][3]));
  assert.strictEqual(rows.slice(buildTotal + 1, runTotal).reduce((a, r) => a + cents(r[3]), 0), cents(rows[runTotal][3]));
  assert.match(rows[0][0], /Chef de projet \((senior|confirmé|junior)\)/);
  assert.deepStrictEqual(rows[buildTotal + 1], ['Exploitation mensuelle — Microsoft Azure, France Central', '', '', ''], 'the provider heads its services');
  assert.deepStrictEqual(rows[buildTotal + 2].slice(1, 3), ['1 × 730 h/mois', '0,1971 EUR/h']);
  assert.match(rows[runTotal - 1][1], /^500 Go$/);
  assert.match(rows[runTotal - 1][2], /EUR\/Go\/mois$/);
});

test('slide s9: more than 6 roles are summed into one line, never left blank', () => {
  const p = pricing();
  const people = ['pm', 'backend', 'frontend', 'devops', 'designer', 'qa'].map(role => ({ role, days: 10 }));
  people.push({ role: 'backend', days: 5 });
  const s = agent4.buildPricingSlide(pricingLib.buildCost(people, {}, p, 'azure'), 'fr', p);
  const other = s.blocks[0].rows.find(r => r[0] === 'Autres profils');
  assert.ok(other && /\d/.test(other[3]));
  assert.deepStrictEqual(s.blocks.map(b => b.kind), ['table', 'note'], 'no run cost: table and note only');
  assert.ok(!s.blocks[0].rows.some(r => /exploitation/i.test(r[0])));
});

test('English deck: English labels', () => {
  const p = pricing();
  const s = agent4.buildPricingSlide(pricingLib.buildCost([{ role: 'pm', days: 1 }], { cloud: [{ item: 'db_small', units: 1 }] }, p, 'azure'), 'en', p);
  const text = JSON.stringify(s);
  assert.match(text, /Build total/);
  assert.match(text, /Indicative estimate/);
  assert.doesNotMatch(text, /mois|jours|Exploitation/);
  assert.ok(s.blocks[0].rows.some(r => /^Run total \(Microsoft Azure/.test(r[0])));
});

test('agent 4 (real mode): the LLM sizes the run, code prices it; an invalid answer is retried', async () => {
  const p = pricing();
  const answers = [
    { cloud: [{ item: 'kubernetes', units: 1 }] },
    { cloud: [{ item: 'vm_medium', units: 2 }, { item: 'db_small', units: 1 }], storage_gb: 20, llm: [], assumptions: ['2 serveurs'] }
  ];
  let calls = 0;
  const call = async () => ({ ok: true, json: answers[calls++], usage: { promptTokens: 1, completionTokens: 1 }, rateLimitWaits: 0, model: 'fake' });
  const res = await agent4.executeAgent4(tender(['Hébergement Azure']), { plan: [{ weeks: 4, roles: [{ role: 'backend', people: 2 }] }] }, p,
    { mode: 'real', call, maxAttempts: 3 });
  assert.strictEqual(calls, 2);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.data.provider, 'azure');
  assert.deepStrictEqual(res.data.people, [{ role: 'backend', days: 40 }]);
  assert.strictEqual(res.data.cost.run.length, 3);
  assert.ok(res.slides[0].assumptions.some(a => /demandé par l.appel d.offres/.test(a)));
});

test('pipeline: cfg.pricingFile wins over the legacy catalog, which stays the fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing_'));
  const file = path.join(dir, 'pricing.json');
  fs.writeFileSync(file, fs.readFileSync(FILE));
  const projectDir = path.resolve(__dirname, '..', '..');
  assert.ok(pricingLib.isPricingFile(pipeline.loadCatalog({ projectDir, pricingFile: file })));
  assert.ok(!pricingLib.isPricingFile(pipeline.loadCatalog({ projectDir })));
  assert.ok(!pricingLib.isPricingFile(pipeline.loadCatalog({ projectDir, pricingFile: path.join(dir, 'missing.json') })));
});

test('chooseCloud: AWS or Oracle named by the tender, only once their prices are entered', () => {
  const p = pricing();
  const items = Object.fromEntries(Object.entries(p.cloud.azure.items).map(([k, it]) => [k, { ...it, price: 0 }]));
  p.cloud.aws = { label: 'Amazon Web Services', region: 'Paris (eu-west-3)', currency: 'USD', items };
  const aws = { tender: { title: 'Hébergement sur AWS', requirements: [] } };
  assert.strictEqual(pricingLib.chooseCloud(aws, p).provider, 'azure', 'added from the Pricing page, prices still at 0: not used');
  Object.values(p.cloud.aws.items).forEach(it => { it.price = 0.05; });
  assert.deepStrictEqual(pricingLib.chooseCloud(aws, p), { provider: 'aws', named: true });
});
