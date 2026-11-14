// ============================================================================
// RFP - Chat: Answer command. A card button or a fixed command ran ONE tool ("Run command", the same code as the agent's
// tools) without any model: its result -> the bot's reply {text, language, cards, audit}, every sentence written here.
// ============================================================================
/*@lib chatCards*/
const msg = $('Check message').first().json;
const d = $input.first().json || {};
const fr = msg.language === 'fr';
const L = (en, f) => (fr ? f : en);
const t = d.tender || {};
const name = t.title ? `"${t.title}"${t.demo ? ' (demo)' : ''}` : L('this tender', 'cet appel d\'offres');

let text;
if (!d.ok) {
  text = d.not_allowed ? L('Only the approvers can run this action. Ask one of them, or ask me a question instead.',
    'Seuls les approbateurs peuvent lancer cette action. Demandez à l\'un d\'eux, ou posez-moi une question.')
    : L(`It did not work: ${d.error || 'unknown error'}.`, `Cela n'a pas fonctionné : ${d.error || 'erreur inconnue'}.`);
} else if (d.tool === 'list_tenders') {
  text = d.total ? L(`${d.total} open tender${d.total > 1 ? 's' : ''}, the ${d.shown} best by fit:`, `${d.total} appel${d.total > 1 ? 's' : ''} d'offres ouvert${d.total > 1 ? 's' : ''}, les ${d.shown} meilleurs par adéquation :`)
    : L('No open tender in the store. Run "RFP - Main" in n8n to find new ones.', 'Aucun appel d\'offres ouvert. Lancez « RFP - Main » dans n8n pour en trouver.');
} else if (d.tool === 'start_deck') {
  text = L(`Generating the deck for ${name} (run ${d.run_id}). It takes 2 to 5 minutes: I will post it here when it is ready.`,
    `Génération de la présentation pour ${name} (run ${d.run_id}). Cela prend 2 à 5 minutes : je la publierai ici dès qu'elle sera prête.`);
} else if (d.tool === 'record_no_bid') {
  text = L(`No-bid recorded for ${name}. Reason: ${d.reason}`, `No-bid enregistré pour ${name}. Raison : ${d.reason}`);
} else if (d.tool === 'deck_status') {
  const run = d.last_run || (Array.isArray(d.runs) ? d.runs[0] : null);
  text = run ? L('The latest deck run:', 'La dernière génération :') : L('No deck has been generated yet.', 'Aucune présentation n\'a encore été générée.');
} else if (d.tool === 'get_requirements_matrix') {
  text = L(`Requirements matrix of ${name} (${d.total} requirements):`, `Matrice des exigences de ${name} (${d.total} exigences) :`);
} else {
  text = L(`Here is ${name}:`, `Voici ${name} :`);
}

const audit = d.ok && d.audit ? [d.audit] : [];
return [{ json: {
  reply: { text, language: msg.language, cards: chatCards([d]), audit },
  watch: d.tool === 'start_deck' && d.ok && d.run_id ? { run_id: d.run_id, tender_id: t.tender_id, title: t.title } : null,
} }];
