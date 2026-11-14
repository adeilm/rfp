// ============================================================================
// RFP - Chat: Check message. The Teams bot (services/teams-bot) POSTs one user message or one card button:
//   {text, action: {name, tender_id, reason} | null, user: {id, name}, locale, conversation: {id, type}, can_act}
// can_act is the bot's decision (the user is in TEAMS_APPROVER_USERS, or no approver list is set): the webhook key proves
// the bot sent it. Three routes, decided by code:
//   tool  = a card button or a fixed command (help is answered here; "tenders", "status"): one tool, no LLM
//   agent = any other question: the chat agent and its tools
//   reply = an empty, too long or invalid message: answered here
// ============================================================================
const CHAT_LLM_PROVIDER = 'ollama';      // patched by n8n/init/init.js (CHAT_LLM_PROVIDER, else DECK_LLM_PROVIDER, else LLM_PROVIDER)
const MAX_CHARS = 1000;                   // a Teams message longer than this is refused, not cut (a cut question is another question)

const raw = $input.first().json.body;
let req = raw;
if (typeof raw === 'string') { try { req = JSON.parse(raw); } catch (e) { req = null; } }
if (!req || typeof req !== 'object' || Array.isArray(req)) req = {};
const s = v => (v == null ? '' : String(v));
// control and invisible characters out (a pasted message can carry them), spaces folded
const clean = v => s(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, '').replace(/[ \t]+/g, ' ').trim();

const text = clean(req.text);
const user = { id: clean(req.user && req.user.id).slice(0, 80), name: clean(req.user && req.user.name).slice(0, 80) };
const conversationId = clean(req.conversation && req.conversation.id).slice(0, 200) || `user:${user.id || 'unknown'}`;
const canAct = req.can_act === true;
const locale = clean(req.locale).toLowerCase();

// the answer's language: a vote of the message's French and English words (an accent counts for French), the Teams locale on
// a tie ("Power BI ?"). Only words of one language: "details" is English, "détails" French
const FR = /(?<![\p{L}'])(le|la|les|des|du|de|une?|est|sont|pour|quels?|quelles?|qui|quoi|avons|nous|appels?|offres?|marches|bonjour|merci|equipe|couvrons|statut|diapo|lacunes?|acheteur|aide|cette|semaine|montre|donne)(?![\p{L}'])/giu;
const EN = /(?<![\p{L}'])(the|which|what|who|do|does|we|our|have|has|tenders?|details?|status|show|list|generate|deck|slide|cover|gaps?|buyer|team|budget|help|top|of|for|is|are|me|my|this|week|please)(?![\p{L}'])/giu;
const votes = re => (text.match(re) || []).length;
const fr = votes(FR) + (/[éèêàâùûçôî]/i.test(text) ? 1 : 0), en = votes(EN);
const language = fr > en ? 'fr' : en > fr ? 'en' : locale.startsWith('fr') ? 'fr' : 'en';
const meta = { conversation_id: conversationId, conversation_type: clean(req.conversation && req.conversation.type) || 'personal', user, language, can_act: canAct, provider: CHAT_LLM_PROVIDER };
const reply = t => [{ json: { _route: 'reply', ...meta, reply: { text: t, language, cards: [] } } }];
const tool = (name, fields = {}) => [{ json: { _route: 'tool', ...meta, tool: name, can_act: canAct ? 'yes' : 'no', ...fields } }];
const L = (en, fr) => (language === 'fr' ? fr : en);

// ---- a card button (Action.Submit): the bot sends its data as action
const action = req.action && typeof req.action === 'object' ? req.action : null;
if (action) {
  const name = clean(action.name), id = clean(action.tender_id).slice(0, 80);
  const BUTTONS = { generate_deck: 'start_deck', no_bid: 'record_no_bid', deck_status: 'deck_status', matrix: 'get_requirements_matrix', tender: 'get_tender' };
  if (!BUTTONS[name]) return reply(L('This button is not known to the assistant.', 'Ce bouton est inconnu de l\'assistant.'));
  if (!id) return reply(L('This button has no tender id.', 'Ce bouton n\'a pas d\'identifiant d\'appel d\'offres.'));
  if (name === 'no_bid' && clean(action.reason).length < 3) return reply(L('A no-bid needs a reason (3 characters or more): write it in the card, then press No-bid again.',
    'Un no-bid demande une raison (3 caractères ou plus) : écrivez-la dans la carte, puis appuyez de nouveau sur No-bid.'));
  return tool(BUTTONS[name], { tender_id: id, reason: clean(action.reason).slice(0, 300) });
}

// ---- a typed message
if (!text) return reply(L('Send me a question about the tenders, for example "top tenders" or "details of [tender id]". Type "help" for more.',
  'Posez-moi une question sur les appels d\'offres, par exemple « top appels d\'offres » ou « détails de [id] ». Tapez « aide » pour plus.'));
if (text.length > MAX_CHARS) return reply(L(`Your message is too long (${text.length} characters, at most ${MAX_CHARS}). Ask a shorter question.`,
  `Votre message est trop long (${text.length} caractères, ${MAX_CHARS} au plus). Posez une question plus courte.`));

const cmd = text.toLowerCase().replace(/[!?.]+$/, '').trim();
if (/^(help|aide|\?|commands?|commandes?)$/.test(cmd)) {
  return reply(L(
    'I answer from the tender store and the knowledge base, and I can act on decks:\n' +
    '- "top tenders", "which tenders fit this week", "details of [id]"\n' +
    '- "requirements matrix of [id]", "gaps of [id]", "team for [id]", "who is the buyer of [id]", "budget range of [id]"\n' +
    '- "do we cover Power BI and 2 data engineers", "who has a PMP"\n' +
    '- "generate the deck for [id]", "status", "refine slide 5 of deck [deck id]: make it shorter", "export [id]"\n' +
    (canAct ? 'You can run the actions (deck, refine, no-bid).' : 'Actions (deck, refine, no-bid) are for the approvers only: you can ask questions.'),
    'Je réponds à partir des appels d\'offres analysés et de la base de connaissances, et j\'agis sur les présentations :\n' +
    '- « top appels d\'offres », « quels appels d\'offres cette semaine », « détails de [id] »\n' +
    '- « matrice des exigences de [id] », « lacunes de [id] », « équipe pour [id] », « qui est l\'acheteur de [id] », « fourchette de budget de [id] »\n' +
    '- « couvrons-nous Power BI et 2 data engineers », « qui a une certification PMP »\n' +
    '- « génère la présentation de [id] », « statut », « affine la diapo 5 du deck [id deck] : plus courte », « exporter [id] »\n' +
    (canAct ? 'Vous pouvez lancer les actions (présentation, affinage, no-bid).' : 'Les actions (présentation, affinage, no-bid) sont réservées aux approbateurs : vous pouvez poser des questions.')));
}
if (/^(tenders|top( \d+)?( tenders)?|top tenders|appels d'offres|top appels d'offres|offres)$/.test(cmd)) return tool('list_tenders', { limit: '5' });
if (/^(status|statut)$/.test(cmd)) return tool('deck_status', { tender_id: '' });

// ---- the agent: the message and what code knows (never a fact the model could get wrong)
const today = (() => { try { return $now.toFormat('yyyy-MM-dd'); } catch (e) { return new Date().toISOString().slice(0, 10); } })();
const prompt = `LANGUAGE: ${language === 'fr' ? 'French' : 'English'}\nTODAY: ${today}\nUSER MAY RUN ACTIONS: ${canAct ? 'yes' : 'no'}\n` +
  `USER: ${user.name || 'unknown'}\nMESSAGE: ${text}`;
return [{ json: { _route: 'agent', ...meta, text, prompt } }];
