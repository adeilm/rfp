/**
 * lang.js - Is a sentence French or English? Used to keep a French deck French.
 *
 * The LLM sometimes answers in English whatever the prompt says, and n8n's analysis restates the tender's
 * requirements in English. A word count is enough here: product names and technical terms (React, Power BI,
 * PostgreSQL) carry no function words, so they never make a French sentence look English.
 */

// English words that do not occur in French text (function words, and the content words the agents
// produced in English in real decks: "Insufficient health sector experience")
const EN = new Set(('the and with of for our we will is are to in from this that be by at your which have has been '
  + 'during into across each their its can must should provide ensure dedicated available regular throughout '
  + 'experience insufficient lack health skills knowledge staff training delivery management requirements users').split(' '));
const FR = new Set(('le la les des du de et pour avec un une est sont dans sur au aux nous notre nos vous votre qui que '
  + 'par en à ce cette ces son sa ses leur leurs être sera seront afin selon chaque').split(' '));

/** Field names of the agents' input that must never appear in a slide ("(ready_facts.whyUs)"). */
const INTERNAL_NAMES = /\b(ready_facts|readyFacts|why_us|whyUs|evidence_candidates|team_profiles|similar_projects)\b/;

function words(text) {
  return String(text || '').toLowerCase().normalize('NFC').split(/[^a-zà-öø-ÿœ']+/).filter(Boolean)
    .map(w => w.replace(/^[ldjmnstcq]'/, ''));
}

/** True when `text` is an English sentence (4+ words, at least 2 English words, more English than French). */
function looksEnglish(text) {
  const w = words(text);
  if (w.length < 4) return false;
  const en = w.filter(x => EN.has(x)).length;
  const fr = w.filter(x => FR.has(x)).length;
  return en >= 2 && en > fr;
}

/** True when `text` is a French sentence (more French than English words). */
function looksFrench(text) {
  const w = words(text);
  const en = w.filter(x => EN.has(x)).length;
  const fr = w.filter(x => FR.has(x)).length;
  return fr >= 1 && fr > en;
}

/**
 * Violations for text an LLM wrote: English in a French deck, and internal field names in any deck.
 * `items` = [[path, text], ...]. Never used on text copied by code (project names, the tender's words).
 */
function checkWritten(items, language = 'fr') {
  const v = [];
  items.forEach(([path, text]) => {
    if (typeof text !== 'string' || !text.trim()) return;
    if (INTERNAL_NAMES.test(text)) v.push(`${path}: do not cite input field names (${text.match(INTERNAL_NAMES)[0]}) in the slide text`);
    if (language === 'fr' && looksEnglish(text)) v.push(`${path}: written in English ("${text.slice(0, 60)}"); write it in French`);
  });
  return v;
}

/** The language line every writing agent gets in its user message. */
function languageLine(language) {
  return language === 'en'
    ? 'Language: write every sentence in English.'
    : 'Language: write every sentence in French, with correct accents (the deck is in French). Product names and technical terms stay as they are.';
}

// Export for CommonJS (n8n Code nodes) and ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { looksEnglish, looksFrench, checkWritten, languageLine, INTERNAL_NAMES };
}
