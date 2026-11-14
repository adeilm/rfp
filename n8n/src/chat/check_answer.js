// ============================================================================
// RFP - Chat: Check answer. The chat agent's answer -> the bot's reply {text, language, cards, audit}. Code, not the model,
// decides what reaches Teams:
//   - the cards come from the tools' results (chatCards), never from the model's text;
//   - a line of the model's text that names a tender id or a knowledge-base document (CV, project, stack) no tool returned, or a
//     number found neither in a tool result nor in the user's message, is removed (an invented fact never reaches the user); if
//     nothing is left, a fixed sentence introduces the cards;
//   - a model error (429 quota, timeout, invalid answer) gives a short, honest message, never the raw error;
//   - a deck started by start_deck is handed to "Watch deck" (after Respond) so the bot posts it when it is ready.
// ============================================================================
/*@lib chatCards*/
const MAX_LINES = 8, MAX_CHARS = 1200;
const msg = $('Check message').first().json;
const r = $input.first().json || {};
const fr = msg.language === 'fr';
const L = (en, f) => (fr ? f : en);

// ---- the tools' results: each observation is the JSON of the tool's output item(s)
const parse = v => {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch (e) { return null; }
};
const resultOf = obs => {
  let j = parse(obs);
  if (Array.isArray(j)) j = j[0];
  if (j && typeof j === 'object' && typeof j.response === 'string') j = parse(j.response);   // some n8n versions wrap the item
  return j && typeof j === 'object' && typeof j.tool === 'string' ? j : null;
};
const results = (r.intermediateSteps || []).map(st => resultOf(st.observation)).filter(Boolean);
const facts = JSON.stringify(results) + ' ' + String(msg.text || '');

// ---- what the model may say: ids and numbers that a tool returned (or the user wrote)
const ids = new Set();
const collect = o => { if (Array.isArray(o)) o.forEach(collect); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (/(^|_)id$/.test(k) && typeof v === 'string') ids.add(v); collect(v); } };
collect(results);
const digitRuns = new Set((facts.match(/\d+/g) || []).map(x => x.replace(/^0+(?=\d)/, '')));
const factNumbers = new Set((facts.replace(/(\d)[\s  ](?=\d{3}\b)/g, '$1').match(/\d+(?:[.,]\d+)?/g) || []).map(x => String(Number(x.replace(',', '.')))));
// a number of 2 digits or more, or any number with %, € or a million / thousand unit, must be a fact
const NUM = /(\d[\d\s  ]*\d|\d)(?:[.,](\d+))?\s*(%|€|eur\b|euros?\b|k€|m€|k\b|m\b|millions?\b|thousand\b|milliers?\b)?/gi;
const numberOk = (m, intPart, frac, unit) => {
  const int = intPart.replace(/[\s  ]/g, '');
  if (int.length < 2 && !unit) return true;                                  // "slide 5", "3 tenders": too common to be a claim
  const value = Number(int + (frac ? '.' + frac : ''));
  const u = (unit || '').toLowerCase();
  const scaled = /^(m€|m|millions?)$/.test(u) ? value * 1e6 : /^(k€|k|thousand|milliers?)$/.test(u) ? value * 1e3 : value;
  return factNumbers.has(String(scaled)) || factNumbers.has(String(value)) || digitRuns.has(int.replace(/^0+(?=\d)/, ''));
};
// tender ids ('T' + a base-36 hash: T1teiowa, Tdoatt8; one digit at least, so "Tenders" is a word), deck and run ids (hex with a letter)
const ID_LIKE = /\b(T(?=[a-z]*\d)[0-9a-z]{6,8}|(?=\d*[a-f])[a-f0-9]{8}|(?=\d*[a-f])[a-f0-9]{12})\b/g;
// knowledge-base documents as the RAG names them (CV_13_Isabella_Ross.pdf, olivesoft_Project_..., demo_...): a small model
// writes a plausible name with the wrong number ("CV_17_Nora_Ellis.pdf"), so the exact name must be in a tool result
const DOC_LIKE = /\b((?:CV_)?\d{1,3}_[A-Z][A-Za-z]*_[A-Za-z_]+\.pdf|(?:olivesoft|demo)_[A-Za-z0-9_]+)\b/g;
const lineOk = line => {
  for (const m of line.matchAll(ID_LIKE)) if (!ids.has(m[1]) && !String(msg.text || '').includes(m[1])) return false;
  for (const m of line.matchAll(DOC_LIKE)) if (!facts.includes(m[1])) return false;
  for (const m of line.matchAll(NUM)) if (!numberOk(m[0], m[1], m[2], m[3])) return false;
  return true;
};

const say = (text, extra = {}) => [{ json: { reply: { text, language: msg.language, cards: chatCards(results), ...extra }, watch: null } }];

// ---- the model failed: an honest message (the raw error stays in the n8n execution)
if (r.error || typeof r.output !== 'string') {
  const e = String((r.error && (r.error.message || r.error.description)) || r.error || '');
  // busy: the bot says so, waits and asks once more by itself (services/teams-bot, core.py)
  if (/429|rate.?limit|quota|too many requests/i.test(e)) return say(L('The assistant is busy (the model\'s rate limit). Wait a minute and ask again.',
    'L\'assistant est occupé (limite de débit du modèle). Attendez une minute et reposez la question.'), { busy: true });
  if (/timeout|timed out|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(e)) return say(L('The assistant\'s model did not answer in time. Try again in a moment.',
    'Le modèle de l\'assistant n\'a pas répondu à temps. Réessayez dans un instant.'));
  return say(L('The assistant could not answer this question. Try again, or ask it differently.', 'L\'assistant n\'a pas pu répondre. Réessayez ou reformulez.'));
}

// ---- the model's text, checked line by line
const lines = r.output.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\r/g, '').split('\n')
  .map(l => l.replace(/^#+\s*/, '').replace(/\*\*/g, '').trimEnd()).filter(l => l.trim() && !/^\s*\|?[-:| ]+\|?\s*$/.test(l));
const kept = lines.filter(lineOk);
const removed = lines.length - kept.length;
let text = kept.slice(0, MAX_LINES).join('\n');
if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 1) + '…';
const cards = chatCards(results);
if (!text) text = cards.length ? L('Here is what the tools returned:', 'Voici ce que les outils ont renvoyé :')
  : L('I could not find a reliable answer to this question.', 'Je n\'ai pas trouvé de réponse fiable à cette question.');
if (removed) text += '\n' + L(`(${removed} line${removed > 1 ? 's' : ''} removed: not supported by the data.)`, `(${removed} ligne${removed > 1 ? 's' : ''} retirée${removed > 1 ? 's' : ''} : non étayée${removed > 1 ? 's' : ''} par les données.)`);

const audit = results.filter(d => d.ok && d.audit).map(d => d.audit);
const started = results.find(d => d.tool === 'start_deck' && d.ok && d.run_id);
return [{ json: {
  reply: { text, language: msg.language, cards, audit },
  watch: started ? { run_id: started.run_id, tender_id: started.tender.tender_id, title: started.tender.title } : null,
  checks: { tools: results.map(d => `${d.tool}:${d.ok ? 'ok' : 'failed'}`), removed_lines: removed },
} }];
