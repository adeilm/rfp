// ============================================================================
// RFP - Chat: Watch deck. Runs AFTER Respond (the user already has "Generating..."): polls the studio's run of the deck that
// start_deck started (GET /api/generations/<runId>) every 15 s for up to 12 minutes, then gives "Notify Teams" the card to
// post in the same conversation: the deck link, slide placeholders and warnings, or the failure. Never longer than n8n's task
// timeout (N8N_RUNNERS_TASK_TIMEOUT, 1200 s in docker-compose.yml).
// ============================================================================
const STUDIO_URL = 'http://host.docker.internal:8091';      // patched by n8n/init/init.js
const WEB_APP_URL = 'http://localhost:5173';                 // patched by n8n/init/init.js (TEAMS_WEB_APP_URL)
const BOT_NOTIFY_URL = 'http://host.docker.internal:3978/notify';   // patched by n8n/init/init.js (the teams-bot service)
const EVERY_MS = 15000, MAX_MS = 12 * 60 * 1000;

const msg = $('Check message').first().json;
const w = $input.first().json.watch || {};
const fr = msg.language === 'fr';
const L = (en, f) => (fr ? f : en);
const sleep = ms => new Promise(res => setTimeout(res, ms));
const deckLink = (deckId, tenderId) => `${WEB_APP_URL}/decks/${encodeURIComponent(deckId)}${tenderId ? `?tender=${encodeURIComponent(tenderId)}` : ''}`;

let run = null, misses = 0;
const start = Date.now();
while (Date.now() - start < MAX_MS) {
  await sleep(EVERY_MS);
  try {
    run = await this.helpers.httpRequest({ method: 'GET', url: `${STUDIO_URL}/api/generations/${w.run_id}`, json: true, timeout: 15000 });
    misses = 0;
  } catch (e) {
    if (++misses >= 8) break;                      // the studio stopped answering for 2 minutes
    continue;
  }
  if (run && (run.status === 'done' || run.status === 'failed')) break;
}

const name = w.title ? `"${w.title}"` : L('the tender', 'l\'appel d\'offres');
let text, data;
if (run && run.status === 'done' && run.deckId) {
  const placeholders = typeof run.placeholders === 'number' ? run.placeholders : null;
  data = { status: 'done', run_id: w.run_id, deck_id: run.deckId, deck_url: deckLink(run.deckId, w.tender_id), tender_id: w.tender_id, title: w.title,
    placeholders, warnings: Array.isArray(run.warnings) ? run.warnings.length : 0, slides: Array.isArray(run.slides) ? run.slides.length : null };
  text = L(`The deck for ${name} is ready.`, `La présentation pour ${name} est prête.`) + (placeholders
    ? L(` ${placeholders} [TO FILL] placeholder${placeholders > 1 ? 's' : ''} to fill and the prices to approve before export.`,
      ` ${placeholders} élément${placeholders > 1 ? 's' : ''} [TO FILL] à compléter et les prix à approuver avant l'export.`)
    : L(' Approve the prices in the editor before export.', ' Approuvez les prix dans l\'éditeur avant l\'export.'));
} else if (run && run.status === 'failed') {
  data = { status: 'failed', run_id: w.run_id, tender_id: w.tender_id, title: w.title, error: String(run.error || '').slice(0, 200) || null };
  text = L(`The deck for ${name} failed. Open the tender in the app to retry.`, `La génération pour ${name} a échoué. Ouvrez l'appel d'offres dans l'application pour réessayer.`);
} else {
  data = { status: run ? run.status : 'unknown', run_id: w.run_id, tender_id: w.tender_id, title: w.title };
  text = L(`The deck for ${name} is still not finished after 12 minutes. Type "status" later.`, `La présentation pour ${name} n'est toujours pas prête après 12 minutes. Tapez « statut » plus tard.`);
}
return [{ json: { notifyUrl: BOT_NOTIFY_URL, body: { conversation_id: msg.conversation_id, kind: 'deck', text, language: msg.language, cards: [{ type: 'deck', data }] } } }];
