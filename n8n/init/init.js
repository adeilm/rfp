#!/usr/bin/env node
// n8n init for the packaged system (runs inside the n8n container, before n8n starts; see n8n/init/entrypoint.sh).
//   node init.js check     image build: the Config / Refine patches still apply and n8n/llm.json matches build.js (no n8n, no keys)
//   node init.js prepare   every start: credentials from the environment (always re-imported: .env is the source of truth), then,
//                          when the workflows changed (or RFP_FORCE_IMPORT=1), import our 6 + the 9 deck-agent workflows and publish
//                          the 2 tool sub-workflows, the 9 deck agents, Refine Slide and the 2 Teams chat workflows (the sequence of n8n/test/e2e.js)
//   node init.js render D  writes our 6 patched workflows into folder D (debugging; imports nothing)
//   node init.js env       prints `export ...` lines for the deck agents' LLM (GROQ_BASE_URL / GROQ_API_KEY / GROQ_MODEL), computed
//                          from LLM_PROVIDER; the entrypoint evals them (a pipe, never a file or a log)
// Keys are never printed: the credentials file lives in /tmp/rfp-init (mode 600) only during the import and is always deleted.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');

const HERE = __dirname;
const DIST = process.env.RFP_PIPELINE_DIST || path.join(HERE, 'pipeline', 'dist');
const LLM_TABLE = JSON.parse(fs.readFileSync(process.env.RFP_LLM_TABLE || path.join(HERE, 'llm.json'), 'utf8'));
const STUDIO_DIR = process.env.RFP_STUDIO_DIR || '/data/rfp-studio';
const N8N_HOME = process.env.N8N_USER_FOLDER ? path.join(process.env.N8N_USER_FOLDER, '.n8n') : '/home/node/.n8n';
const STATE_FILE = path.join(N8N_HOME, 'rfp-init-state.json');
const TMP = '/tmp/rfp-init';

// fixed workflow ids: the two tool sub-workflows are the ids build.js puts in Main's tool nodes
const MAIN_ID = 'RfpPipelineMain1', RESEARCH_ID = 'QHV4m1jKm8fKBXNA', SCOUT_ID = 'kJh2xit7vcFVsP7i';
// the 9 deck-agent workflows (services/proposal-studio/workflows): sub-workflows and the error handler first, the two webhook workflows last (n8n/test/e2e.js)
const STUDIO_WF = ['rfpErrors0000001', 'rfpAgent10000001', 'rfpDiagrams00001', 'rfpAgent40000001', 'rfpAgent50000001', 'rfpAgent60000001',
  'rfpLlmJson000001', 'rfpRegenerate001', 'rfpMain000000001'];

const log = msg => console.log(`[rfp-init] ${msg}`);
class ConfigError extends Error {}
class CliError extends Error {}
const fail = msg => { throw new ConfigError(msg); };
const env = name => String(process.env[name] || '').replace(/^﻿/, '').trim();
const on = name => /^(1|true|yes|on)$/i.test(env(name));

// ---------------------------------------------------------------- the one LLM setting
// which: 'main' = Main's model (LLM_PROVIDER / LLM_MODEL); 'deck' = the deck agents' (DECK_LLM_PROVIDER / DECK_LLM_MODEL, empty =
// the same as Main). One setting by default; the second one only to split them (e.g. Main on a local Ollama, the decks on Groq).
// 'chat' = the Teams chat agent's (CHAT_LLM_PROVIDER / CHAT_LLM_MODEL, empty = the deck agents' LLM: an interactive agent with tools,
// like them, needs a fast model that calls tools reliably)
function llm({ needKeys = true, which = 'main' } = {}) {
  const mainProvider = (env('LLM_PROVIDER') || 'groq').toLowerCase();
  const deckProvider = (env('DECK_LLM_PROVIDER') || mainProvider).toLowerCase();
  const provider = which === 'chat' ? (env('CHAT_LLM_PROVIDER') || deckProvider).toLowerCase() : which === 'deck' ? deckProvider : mainProvider;
  if (provider === 'anthropic') fail('LLM_PROVIDER=anthropic is not supported here: the deck agents speak the OpenAI API only. Use groq, gemini, openai or ollama.');
  const p = LLM_TABLE[provider];
  if (!p || provider.startsWith('_')) fail(`LLM_PROVIDER=${provider} is unknown. Use one of: ${Object.keys(LLM_TABLE).filter(k => !k.startsWith('_')).join(', ')}.`);
  const deckModel = env('DECK_LLM_MODEL') || (deckProvider === mainProvider ? env('LLM_MODEL') : '');
  const model = which === 'chat' ? env('CHAT_LLM_MODEL') || (provider === deckProvider ? deckModel : '') || (provider === mainProvider ? env('LLM_MODEL') : '') || p.defaultModel
    : (which === 'deck' ? env('DECK_LLM_MODEL') : '') || (provider === mainProvider ? env('LLM_MODEL') : '') || p.defaultModel;
  // the studio accepts only these characters in its model list (server.py groq_models)
  if (!/^[A-Za-z0-9._/:-]{1,80}$/.test(model)) fail(`LLM_MODEL=${model} is not a valid model name (letters, digits and . _ / : - only).`);
  const ollamaUrl = (env('OLLAMA_URL') || 'http://host.docker.internal:11434').replace(/\/+$/, '');
  let key = '';
  if (p.keyEnv) {
    key = env(p.keyEnv).replace(/^Bearer\s+/i, '');
    if (!key && needKeys) fail(`LLM_PROVIDER=${provider} needs ${p.keyEnv} in .env (it is empty).`);
  }
  return {
    provider, model, node: p.node, key, ollamaUrl,
    agentsBaseUrl: provider === 'ollama' ? `${ollamaUrl}/v1` : p.agentsBaseUrl,
    agentsKey: provider === 'ollama' ? 'ollama' : key,   // the agents' client refuses an empty key; Ollama ignores it
  };
}

function requireSecrets() {
  const missing = ['STUDIO_API_KEY', 'AGENTS_WEBHOOK_KEY'].filter(n => !env(n));
  if (missing.length) fail(`${missing.join(' and ')} must be set in .env (any long random string; see .env.example for a command that makes one).`);
}

// ---------------------------------------------------------------- credentials (fixed ids of build.js and the studio's credentials.example.json)
function credentials(cfg) {
  const firecrawl = env('FIRECRAWL_KEY').replace(/^Bearer\s+/i, '');
  const deck = llm({ needKeys: false, which: 'deck' }), chat = llm({ needKeys: false, which: 'chat' });
  const real = (provider, value) => (cfg.provider === provider ? value : deck.provider === provider ? deck.key : chat.provider === provider ? chat.key : 'unused');
  return [
    { id: 'CfeiKFMFWXxIkMe6', name: 'Header Auth account', type: 'httpHeaderAuth', data: { name: 'Authorization', value: `Bearer ${firecrawl || 'not-configured'}` } },
    { id: 'WJErbMQ0BDKh8uZB', name: 'Ollama account', type: 'ollamaApi', data: { baseUrl: cfg.ollamaUrl } },
    { id: 'aMTyXr6dYELQA8DQ', name: 'Google Gemini(PaLM) Api account', type: 'googlePalmApi', data: { host: 'https://generativelanguage.googleapis.com', apiKey: real('gemini', cfg.key) } },
    { id: 'FPcfbtrrjsRjQcB5', name: 'Groq account', type: 'groqApi', data: { apiKey: real('groq', cfg.key) } },
    { id: '3oFuvY33PPiWwnf1', name: 'OpenAI account', type: 'openAiApi', data: { apiKey: real('openai', cfg.key), url: 'https://api.openai.com/v1' } },
    { id: 'XzG8ORjaa0RmjUCR', name: 'Anthropic account', type: 'anthropicApi', data: { apiKey: 'unused' } },
    { id: 'StudioKey0000001', name: 'Proposal Studio key', type: 'httpHeaderAuth', data: { name: 'X-API-Key', value: env('STUDIO_API_KEY') } },
    { id: 'rfpMainWebhook01', name: 'MainWebhook', type: 'httpHeaderAuth', data: { name: 'X-API-Key', value: env('AGENTS_WEBHOOK_KEY') } },
    { id: 'rfpRegenWebhook1', name: 'RegenWebhook', type: 'httpHeaderAuth', data: { name: 'X-API-Key', value: env('AGENTS_WEBHOOK_KEY') } },
    // the Teams bot: the key it sends to RFP - Chat, and the key of its /notify (Main's Teams Alerts, the chat's deck watch)
    { id: 'rfpChatWebhook01', name: 'ChatWebhook', type: 'httpHeaderAuth', data: { name: 'X-API-Key', value: env('AGENTS_WEBHOOK_KEY') } },
    { id: 'rfpTeamsNotify01', name: 'Teams bot notify key', type: 'httpHeaderAuth', data: { name: 'X-Notify-Key', value: env('BOT_NOTIFY_KEY') || 'not-configured' } },
  ];
}

// ---------------------------------------------------------------- our 6 workflows, patched for the compose network (like e2e.js)
const swap = (s, a, b, what) => { if (!s.includes(a)) fail(`pipeline patch not found (${what}): ${a} -- build.js / 00_config.js changed, update n8n/init/init.js`); return s.split(a).join(b); };
const readDist = file => JSON.parse(fs.readFileSync(path.join(DIST, file), 'utf8'));

function settings(cfg) {
  const urlSources = (env('PIPELINE_URL_SOURCES') || 'auto').toLowerCase();
  const autoDeck = env('PIPELINE_AUTO_DECK') || 'top1';
  if (!['none', 'top1'].includes(autoDeck)) fail(`PIPELINE_AUTO_DECK=${autoDeck}: use top1 or none.`);
  if (!['auto', 'on', 'off'].includes(urlSources)) fail(`PIPELINE_URL_SOURCES=${urlSources}: use auto, on or off.`);
  return {
    provider: cfg.provider, model: cfg.model,
    // pause between Main's LLM calls (ms): PIPELINE_LLM_DELAY_MS, else by provider (Groq's free tier: about 8 000 tokens a minute)
    delayMs: /^\d+$/.test(env('PIPELINE_LLM_DELAY_MS')) ? Number(env('PIPELINE_LLM_DELAY_MS'))
      : ({ ollama: 0, groq: 15000, gemini: 4000, openai: 1000 })[cfg.provider] ?? 4000,
    ragUrl: env('PIPELINE_RAG_URL') || 'http://rag:8001/retrieve/tender',
    studioUrl: (env('PIPELINE_STUDIO_URL') || 'http://proposal-studio:8091').replace(/\/+$/, ''),
    demoUrl: env('PIPELINE_DEMO_TENDERS_URL') || 'http://demo-tenders:8004/tenders',
    // true = the demo tenders only | with = the demo tenders WITH the real sources | false = the real sources only
    researchDemoBuyers: env('PIPELINE_RESEARCH_DEMO_BUYERS').split('|').map(x => x.trim()).filter(Boolean),
    demoMode: /^(with|both|add)$/i.test(env('PIPELINE_DEMO_MODE')) ? 'with' : on('PIPELINE_DEMO_MODE') ? 'only' : 'off',
    // test (small limits: 20 records per API, 3 buyers, 3 market studies) | production | empty = Config's rule (CLI runs: production)
    preset: /^(test|production)$/i.test(env('PIPELINE_PRESET')) ? env('PIPELINE_PRESET').toLowerCase() : null,
    // URL sources (francemarches, domainetat-tn) read the portals through Firecrawl: off without a key, unless forced
    urlSources: urlSources === 'auto' ? Boolean(env('FIRECRAWL_KEY')) : urlSources === 'on',
    autoDeck,
    // the Teams bot (services/teams-bot): Main's alerts on or off, its /notify, and the web app address its cards link to
    teamsNotify: on('TEAMS_NOTIFY'),
    botNotifyUrl: env('PIPELINE_BOT_NOTIFY_URL') || 'http://teams-bot:3978/notify',
    webAppUrl: (env('TEAMS_WEB_APP_URL') || 'http://localhost:5173').replace(/\/+$/, ''),
  };
}

function ourWorkflows(cfg, chatLlm = llm({ needKeys: false, which: 'chat' })) {
  const s = { ...settings(cfg), chat: { provider: chatLlm.provider, model: chatLlm.model, node: chatLlm.node } };
  const main = readDist('RFP - Main.json'), research = readDist('RFP - Research Tools.json');
  const scout = readDist('RFP - Scout Tools.json'), refine = readDist('RFP - Refine Slide.json');

  const config = main.nodes.find(n => n.name === '00 - Config');
  if (!config) fail('node "00 - Config" not found in RFP - Main');
  let js = config.parameters.jsCode;
  js = swap(js, "const LLM_PROVIDER = 'ollama';", `const LLM_PROVIDER = '${s.provider}';`, 'LLM_PROVIDER');
  js = swap(js, "delayMs: LLM_PROVIDER === 'ollama' ? 0 : 4000", `delayMs: ${s.delayMs}`, 'LLM pacing');
  js = swap(js, "rag: { url: 'http://host.docker.internal:8001/retrieve/tender'", `rag: { url: ${JSON.stringify(s.ragUrl)}`, 'RAG url');
  js = swap(js, "const STUDIO_URL = 'http://host.docker.internal:8091';", `const STUDIO_URL = ${JSON.stringify(s.studioUrl)};`, 'STUDIO_URL');
  js = swap(js, "request: { method: 'GET', url: 'http://host.docker.internal:8004/tenders' }", `request: { method: 'GET', url: ${JSON.stringify(s.demoUrl)} }`, 'demo source');
  if (s.demoMode === 'only') js = swap(js, 'const DEMO_MODE = false;', 'const DEMO_MODE = true;', 'DEMO_MODE');
  if (s.demoMode === 'with') js = swap(js, "{ type: 'api', name: 'demo', demo: true, enabled: false,", "{ type: 'api', name: 'demo', demo: true, enabled: true,", 'demo source on');
  if (s.researchDemoBuyers.length) js = swap(js, 'const RESEARCH_DEMO_BUYERS = [];', `const RESEARCH_DEMO_BUYERS = ${JSON.stringify(s.researchDemoBuyers)};`, 'RESEARCH_DEMO_BUYERS');
  if (s.preset) js = swap(js, 'const FORCE_PRESET = null;', `const FORCE_PRESET = '${s.preset}';`, 'FORCE_PRESET');
  if (s.autoDeck !== 'top1') js = swap(js, "const AUTO_DECK = 'top1';", `const AUTO_DECK = '${s.autoDeck}';`, 'AUTO_DECK');
  if (!s.urlSources) js = swap(js, 'sources: sources.filter(s => (DEMO_MODE ? s.demo : s.enabled !== false)),',
    "sources: sources.filter(s => (DEMO_MODE ? s.demo : s.enabled !== false) && s.type !== 'url'),   // packaged: no Firecrawl key, URL sources off", 'URL sources');
  config.parameters.jsCode = js;

  // LLM_MODEL: the provider's model node uses it too (Main and the deck agents run the same model)
  const modelNode = main.nodes.find(n => n.name === cfg.node);
  if (!modelNode) fail(`node "${cfg.node}" not found in RFP - Main`);
  if (env('LLM_MODEL')) {
    const prm = modelNode.parameters;
    if (cfg.provider === 'gemini') prm.modelName = cfg.model;
    else if (cfg.provider === 'openai') prm.model = { __rl: true, mode: 'id', value: cfg.model };
    else prm.model = cfg.model;
  }

  const check = refine.nodes.find(n => n.name === 'Check request');
  if (!check) fail('node "Check request" not found in RFP - Refine Slide');
  // REGENERATE_URL (http://127.0.0.1:5678/webhook/rfp/regenerate) is n8n itself: right inside this container, kept
  check.parameters.jsCode = swap(check.parameters.jsCode, "const STUDIO_URL = 'http://host.docker.internal:8091';",
    `const STUDIO_URL = ${JSON.stringify(s.studioUrl)};`, 'Refine STUDIO_URL');

  // the Teams chat and its tools, and Main's Teams Alerts (REFINE_URL is n8n itself, kept)
  const chat = readDist('RFP - Chat.json'), chatTools = readDist('RFP - Chat Tools.json');
  const codeOf = (w, name, file) => { const n = w.nodes.find(x => x.name === name); if (!n) fail(`node "${name}" not found in ${file}`); return n; };
  const ragBase = s.ragUrl.replace(/\/retrieve\/tender$/, '');
  for (const [w, name, file] of [[chatTools, 'Chat Tools', 'RFP - Chat Tools'], [chat, 'Run command', 'RFP - Chat']]) {
    const n = codeOf(w, name, file);
    let c = n.parameters.jsCode;
    c = swap(c, "const RAG_URL = 'http://host.docker.internal:8001';", `const RAG_URL = ${JSON.stringify(ragBase)};`, `${name} RAG_URL`);
    c = swap(c, "const STUDIO_URL = 'http://host.docker.internal:8091';", `const STUDIO_URL = ${JSON.stringify(s.studioUrl)};`, `${name} STUDIO_URL`);
    c = swap(c, "const WEB_APP_URL = 'http://localhost:5173';", `const WEB_APP_URL = ${JSON.stringify(s.webAppUrl)};`, `${name} WEB_APP_URL`);
    n.parameters.jsCode = c;
  }
  const chatCheck = codeOf(chat, 'Check message', 'RFP - Chat');
  chatCheck.parameters.jsCode = swap(chatCheck.parameters.jsCode, "const CHAT_LLM_PROVIDER = 'ollama';", `const CHAT_LLM_PROVIDER = '${s.chat.provider}';`, 'CHAT_LLM_PROVIDER');
  const chatModel = codeOf(chat, s.chat.node, 'RFP - Chat').parameters;
  if (s.chat.provider === 'gemini') chatModel.modelName = s.chat.model;
  else if (s.chat.provider === 'openai') chatModel.model = { __rl: true, mode: 'id', value: s.chat.model };
  else chatModel.model = s.chat.model;
  const watch = codeOf(chat, 'Watch deck', 'RFP - Chat');
  let wc = swap(watch.parameters.jsCode, "const STUDIO_URL = 'http://host.docker.internal:8091';", `const STUDIO_URL = ${JSON.stringify(s.studioUrl)};`, 'Watch STUDIO_URL');
  wc = swap(wc, "const WEB_APP_URL = 'http://localhost:5173';", `const WEB_APP_URL = ${JSON.stringify(s.webAppUrl)};`, 'Watch WEB_APP_URL');
  watch.parameters.jsCode = swap(wc, "const BOT_NOTIFY_URL = 'http://host.docker.internal:3978/notify';", `const BOT_NOTIFY_URL = ${JSON.stringify(s.botNotifyUrl)};`, 'Watch BOT_NOTIFY_URL');
  const alerts = codeOf(main, 'Teams Alerts', 'RFP - Main');
  let ac = swap(alerts.parameters.jsCode, "const BOT_NOTIFY_URL = 'http://host.docker.internal:3978/notify';", `const BOT_NOTIFY_URL = ${JSON.stringify(s.botNotifyUrl)};`, 'Alerts BOT_NOTIFY_URL');
  ac = swap(ac, "const WEB_APP_URL = 'http://localhost:5173';", `const WEB_APP_URL = ${JSON.stringify(s.webAppUrl)};`, 'Alerts WEB_APP_URL');
  if (s.teamsNotify) ac = swap(ac, 'const TEAMS_NOTIFY = false;', 'const TEAMS_NOTIFY = true;', 'TEAMS_NOTIFY');
  alerts.parameters.jsCode = ac;

  Object.assign(main, { id: MAIN_ID, active: false });
  Object.assign(research, { id: RESEARCH_ID, active: false });
  Object.assign(scout, { id: SCOUT_ID, active: false });
  Object.assign(refine, { active: false });
  Object.assign(chat, { active: false });
  Object.assign(chatTools, { active: false });
  const out = { 'main.json': main, 'research.json': research, 'scout.json': scout, 'refine.json': refine, 'chat.json': chat, 'chat-tools.json': chatTools };
  for (const [f, w] of Object.entries(out)) if (JSON.stringify(w).includes('host.docker.internal')) fail(`${f}: a host.docker.internal URL is left after the patches`);
  return { workflows: out, settings: s, refineId: refine.id, chatIds: [chatTools.id, chat.id] };
}

function studioWorkflowFiles() {
  const dir = path.join(STUDIO_DIR, 'workflows');
  if (!fs.existsSync(dir)) fail(`${dir} not found: the studio folder must be mounted read-only at ${STUDIO_DIR}`);
  const files = fs.readdirSync(dir).filter(f => /^[0-9].*\.json$/.test(f)).sort();
  const ids = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).id);
  const missing = STUDIO_WF.filter(id => !ids.includes(id));
  if (missing.length) fail(`the deck-agent workflows in ${dir} lack ${missing.join(', ')}`);
  return files.map(f => path.join(dir, f));
}

// ---------------------------------------------------------------- n8n CLI
function n8n(args, what) {
  const r = spawnSync('n8n', args, { encoding: 'utf8', env: process.env, maxBuffer: 1 << 26 });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter(l => l.trim() && !/encryption key|Permissions 0\d+ for n8n settings/i.test(l));
  // thrown, not exit(): the finally that deletes the credentials file must run
  if (r.status !== 0) throw new CliError(`${what} FAILED (exit ${r.status}${r.error ? `, ${r.error.message}` : ''}):\n${text.slice(-8).join('\n')}`);
  return text;
}

function prepare() {
  requireSecrets();
  const cfg = llm(), deck = llm({ which: 'deck' }), chat = llm({ which: 'chat' });
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  const registry = env('AGENTS_REGISTRY_DIR') || path.join(N8N_HOME, 'rfp-registry');
  fs.mkdirSync(registry, { recursive: true });
  log(deck.provider === cfg.provider && deck.model === cfg.model
    ? `LLM_PROVIDER=${cfg.provider}, model ${cfg.model} (Main's "${cfg.node}" and the deck agents, ${cfg.agentsBaseUrl})`
    : `Main: ${cfg.provider} ${cfg.model} ("${cfg.node}") | deck agents: ${deck.provider} ${deck.model} (${deck.agentsBaseUrl})`);
  log(`Teams chat agent: ${chat.provider} ${chat.model} | Teams alerts from Main: ${on('TEAMS_NOTIFY') ? 'on' : 'off'} (TEAMS_NOTIFY)`);

  // credentials: every start, from .env (never printed; the file is deleted whatever happens)
  const credFile = path.join(TMP, 'creds.json');
  try {
    fs.writeFileSync(credFile, JSON.stringify(credentials(cfg)), { mode: 0o600 });
    const out = n8n(['import:credentials', `--input=${credFile}`], 'credentials import');
    log(`credentials: ${out.slice(-1)[0] || 'imported'} (Firecrawl ${env('FIRECRAWL_KEY') ? 'key set' : 'placeholder'}; keys never shown)`);
  } finally {
    fs.rmSync(credFile, { force: true });
  }

  // workflows: only when they changed (an import unpublishes them and replaces edits made in the editor)
  const ours = ourWorkflows(cfg, chat), studioFiles = studioWorkflowFiles();
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(ours.workflows)).update(studioFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n')).digest('hex');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  if (state.fingerprint === fingerprint && !on('RFP_FORCE_IMPORT')) {
    log(`workflows up to date (imported ${state.at}); RFP_FORCE_IMPORT=1 imports them again`);
    return;
  }
  const s = ours.settings;
  log(`importing workflows: RAG ${s.ragUrl} | studio ${s.studioUrl} | demo tenders ${s.demoMode} | preset ${s.preset || 'Config rule'} | URL sources ${s.urlSources ? 'on' : 'off (no FIRECRAWL_KEY)'} | auto deck ${s.autoDeck}`);
  const oursDir = path.join(TMP, 'ours'), studioDir = path.join(TMP, 'studio');
  for (const d of [oursDir, studioDir]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
  for (const [f, w] of Object.entries(ours.workflows)) fs.writeFileSync(path.join(oursDir, f), JSON.stringify(w));
  for (const f of studioFiles) fs.copyFileSync(f, path.join(studioDir, path.basename(f)));
  log(`ours: ${n8n(['import:workflow', '--separate', `--input=${oursDir}`], 'import of our 6 workflows').slice(-1)[0]}`);
  log(`deck agents: ${n8n(['import:workflow', '--separate', `--input=${studioDir}`], "import of the 9 deck-agent workflows").slice(-1)[0]}`);
  // n8n 2 runs only published workflows and an import unpublishes them. Main stays unpublished: it is run by hand from the editor
  // (its schedule trigger would otherwise run the production preset every day)
  const publish = [RESEARCH_ID, SCOUT_ID, ...STUDIO_WF, ours.refineId, ...ours.chatIds];
  for (const id of publish) n8n(['publish:workflow', `--id=${id}`], `publish ${id}`);
  log(`published ${publish.length} workflows (Research Tools, Scout Tools, the 9 deck agents, Refine Slide, Chat Tools, Chat); RFP - Main (${MAIN_ID}) is run from the editor`);
  fs.rmSync(oursDir, { recursive: true, force: true });
  fs.rmSync(studioDir, { recursive: true, force: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ fingerprint, at: new Date().toISOString(), settings: s }, null, 1));
}

// the deck agents' LLM, as shell exports for the entrypoint (single-quoted; no output when it fails).
// The base URL is AGENTS_LLM_BASE_URL, not GROQ_BASE_URL: the Groq SDK inside n8n (Main's "Model - Groq" node) reads
// GROQ_BASE_URL as its own base (https://api.groq.com) and adds /openai/v1 itself, so .../openai/v1 there gives
// "POST /openai/v1/openai/v1/chat/completions" (404).
function envExports() {
  const cfg = llm({ which: 'deck' });
  const q = v => `'${String(v).replace(/'/g, `'\\''`)}'`;
  const vars = { AGENTS_LLM_BASE_URL: cfg.agentsBaseUrl, GROQ_API_KEY: cfg.agentsKey, GROQ_MODEL: cfg.model };
  process.stdout.write(Object.entries(vars).map(([k, v]) => `export ${k}=${q(v)}`).join('\n') + '\n');
}

// image build: every patch applies for every provider, and llm.json agrees with Main's model nodes
function check() {
  const main = readDist('RFP - Main.json');
  for (const [provider, p] of Object.entries(LLM_TABLE)) {
    if (provider.startsWith('_')) continue;
    const n = main.nodes.find(x => x.name === p.node);
    if (!n) fail(`llm.json: node "${p.node}" not in RFP - Main`);
    const model = n.parameters.modelName || (n.parameters.model && n.parameters.model.value) || n.parameters.model;
    if (model !== p.defaultModel) fail(`llm.json ${provider}.defaultModel is ${p.defaultModel} but "${p.node}" in build.js uses ${model}`);
    if (provider !== 'anthropic') {
      const c = readDist('RFP - Chat.json').nodes.find(x => x.name === p.node);
      const cm = c && (c.parameters.modelName || (c.parameters.model && c.parameters.model.value) || c.parameters.model);
      if (cm !== p.defaultModel) fail(`llm.json ${provider}.defaultModel is ${p.defaultModel} but "${p.node}" of RFP - Chat in build.js uses ${cm}`);
    }
    for (const extra of [{}, { PIPELINE_DEMO_MODE: '1', PIPELINE_AUTO_DECK: 'none', FIRECRAWL_KEY: 'x', LLM_MODEL: 'some/model' }]) {
      const saved = { ...process.env };
      Object.assign(process.env, { LLM_PROVIDER: provider }, extra);
      try { ourWorkflows(llm({ needKeys: false })); } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
    }
  }
  console.log(`[rfp-init] check ok: patches apply for ${Object.keys(LLM_TABLE).filter(k => !k.startsWith('_')).join(', ')}; llm.json matches build.js`);
}

try {
  const cmd = process.argv[2];
  if (cmd === 'prepare') prepare();
  else if (cmd === 'env') envExports();
  else if (cmd === 'check') check();
  else if (cmd === 'render') {   // node init.js render <dir>: write our 6 patched workflows there, import nothing (debugging)
    const dir = process.argv[3] || fail('usage: node init.js render <dir>');
    fs.mkdirSync(dir, { recursive: true });
    for (const [f, w] of Object.entries(ourWorkflows(llm({ needKeys: false })).workflows)) fs.writeFileSync(path.join(dir, f), JSON.stringify(w, null, 2));
    log(`rendered our 6 workflows in ${dir}`);
  }
  else fail('usage: node init.js prepare|env|check');
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`\n[rfp-init] CONFIGURATION ERROR: ${e.message}\n[rfp-init] Fix .env, then: docker compose up -d --force-recreate n8n proposal-studio\n`);
    process.exit(2);
  }
  if (e instanceof CliError) {
    console.error(`[rfp-init] ${e.message}`);
    process.exit(1);
  }
  throw e;
}
