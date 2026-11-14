/**
 * pipeline_competition.test.js - A tender with competition data must publish (regression:
 * the competitor slide was pushed before slidesWithIds existed, so the review step crashed).
 * The competitive context slide (s12) is now merged with the agents' slides: present when the
 * market study succeeded, absent otherwise, facts only on the slide.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const pipeline = require('../lib/pipeline.js');
const { validateDeckSpec } = require('../lib/contracts.js');
const { buildCompetitiveSlide } = require('../lib/competitive.js');
const fixture = () => JSON.parse(JSON.stringify(require('../fixtures/inputs/proposal_v2_example.json')));

async function publishedSpec(raw) {
  const posted = [];
  const http = async (url, { method, body }) => {
    if (method === 'POST' && url.endsWith('/api/decks')) {
      posted.push(JSON.parse(body));
      return { status: 200, headers: {}, body: JSON.stringify({ id: 'deck0001', url: '/editor.html?id=deck0001', warnings: [] }) };
    }
    if (method === 'GET' && url.includes('/api/decks/')) return { status: 200, headers: {}, body: JSON.stringify({ slides: [] }) };
    return { status: 200, headers: {}, body: '{}' };
  };
  const cfg = { mode: 'mock', projectDir: path.resolve(__dirname, '..', '..'), http,
                studio: { baseUrl: 'http://fake', apiKey: 'k' }, maxCorrectionRounds: 0,
                registryDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rfp_reg_')) };
  const state = pipeline.prepare(raw, cfg);
  for (const stage of pipeline.STAGES) await pipeline.runStage(state, stage, cfg);
  const res = await pipeline.finalize(state, cfg);
  assert.strictEqual(res.ok, true, res.error);
  return posted[0];
}
const isCompetitive = s => /concurrentiel|competitive/i.test(s.title);
const i18n = require('../lib/i18n.js');

test('v2 tender with competition: review and publish finish, no id sent, competitive slide before pricing', async () => {
  const posted = [];
  const http = async (url, { method, body }) => {
    if (method === 'POST' && url.endsWith('/api/decks')) {
      posted.push(JSON.parse(body));
      return { status: 200, headers: {}, body: JSON.stringify({ id: 'deck0001', url: '/editor.html?id=deck0001', warnings: [] }) };
    }
    if (method === 'GET' && url.includes('/api/decks/')) return { status: 200, headers: {}, body: JSON.stringify({ slides: [] }) };
    return { status: 200, headers: {}, body: '{}' };
  };
  const cfg = { mode: 'mock', projectDir: path.resolve(__dirname, '..', '..'), http,
                studio: { baseUrl: 'http://fake', apiKey: 'k' }, maxCorrectionRounds: 0,
                registryDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rfp_reg_')) };
  const raw = { ...require('../fixtures/inputs/proposal_v2_example.json'), params: { includeCompetitorSlide: true } };
  const state = pipeline.prepare(raw, cfg);
  for (const stage of pipeline.STAGES) await pipeline.runStage(state, stage, cfg);
  const res = await pipeline.finalize(state, cfg);
  assert.strictEqual(res.ok, true, res.error);
  const spec = posted[0];
  assert.deepStrictEqual(validateDeckSpec(spec).errors, []);
  assert.ok(spec.slides.every(s => !('id' in s)), 'an internal slide id reached the platform');
  const i = spec.slides.findIndex(isCompetitive);
  assert.ok(i >= 0, 'competitive slide must be present when the market study succeeded');
  assert.strictEqual(spec.slides.filter(isCompetitive).length, 1);
  const table = spec.slides[i].blocks.find(b => b.kind === 'table');
  assert.ok(table && table.rows.some(r => r[0] === 'DATAERA'), 'competitors come from the market study');
  const pricing = spec.slides.findIndex(s => s.title.startsWith(i18n.translate('pricing', 'fr')));
  assert.ok(pricing > i, 'competitive slide comes just before the pricing slide');

});

test('daily provider quota: the run stops at once with a clear error, no deck is published', async () => {
  let llmCalls = 0;
  let posted = 0;
  const groq429 = JSON.stringify({ error: { message: 'Rate limit reached for model on tokens per day (TPD): Limit 200000, Used 199000. Please try again in 11m35.9s.' } });
  const http = async (url, { method }) => {
    if (url.includes('/chat/completions')) { llmCalls++; return { status: 429, headers: { 'retry-after': '695' }, body: groq429 }; }
    if (method === 'POST' && url.endsWith('/api/decks')) posted++;
    return { status: 200, headers: {}, body: '{}' };
  };
  const cfg = { mode: 'real', projectDir: path.resolve(__dirname, '..', '..'), http,
                llm: { apiKey: 'k', model: 'm', baseUrl: 'http://fake', transport: http, sleep: async () => {} },
                studio: { baseUrl: 'http://fake', apiKey: 'k' }, maxCorrectionRounds: 0 };
  const t0 = Date.now();
  const state = pipeline.prepare(require('../fixtures/inputs/proposal_v2_example.json'), cfg);
  for (const stage of pipeline.STAGES) await pipeline.runStage(state, stage, cfg);
  const res = await pipeline.finalize(state, cfg);
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /limite quotidienne.*réessayez dans 11m35/);
  assert.strictEqual(llmCalls, 1, 'one call, then no retries and no other agent calls');
  assert.strictEqual(posted, 0);
  assert.ok(Date.now() - t0 < 5000);
});

for (const status of ['NOT_STUDIED', 'NO_DATA', 'NO_COMPARABLE', 'FAILED']) {
  test(`competition ${status}: no competitive slide, no placeholder, deck still valid`, async () => {
    const raw = fixture();
    raw.competition.status = status;
    const spec = await publishedSpec(raw);
    assert.deepStrictEqual(validateDeckSpec(spec).errors, []);
    assert.ok(!spec.slides.some(isCompetitive));
    assert.ok(!spec.slides.some(s => /s12/.test(JSON.stringify(s))), 'no placeholder for the optional slide');
  });
}

test('competitive slide: facts only, the English agent sentences stay in the notes', () => {
  const s = buildCompetitiveSlide(fixture(), 'fr');
  const onSlide = JSON.stringify(s.blocks);
  assert.ok(!onSlide.includes('Companies like'), 'positioning sentence must not be on a French slide');
  assert.ok(s.notes.includes('Companies like'), 'positioning kept for the presenter');
  assert.match(onSlide, /480 000 TND/);
  assert.match(onSlide, /197 000 TND/);
  assert.doesNotMatch(onSlide, /N\/A/);
});

test('competitive slide: estimated range only with 3+ comparables and confidence above very low', () => {
  const raw = fixture();
  assert.ok(!/comparables attribués/.test(JSON.stringify(buildCompetitiveSlide(raw, 'fr').blocks)), '2 comparables: no range');
  raw.competition.budget_estimate.comparables = 5;
  assert.match(JSON.stringify(buildCompetitiveSlide(raw, 'fr').blocks), /150 103 à 181 368 TND \(médiane 165 735, 5 contrats\)/);
  raw.competition.budget_estimate.confidence = 'very low';
  assert.ok(!/comparables attribués/.test(JSON.stringify(buildCompetitiveSlide(raw, 'fr').blocks)));
  raw.competition.budget_estimate = null;
  assert.ok(buildCompetitiveSlide(raw, 'fr'), 'no estimate: the slide still shows the competitors');
});

test('competitive slide: nothing to show gives no slide', () => {
  const raw = fixture();
  raw.competition.competitors = [];
  raw.competition.median_bids = null;
  assert.strictEqual(buildCompetitiveSlide(raw, 'fr'), null);
  assert.strictEqual(buildCompetitiveSlide({}, 'fr'), null);
});
