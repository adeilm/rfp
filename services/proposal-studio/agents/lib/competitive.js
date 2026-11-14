/**
 * competitive.js - Budget scenarios and competitive positioning slide (s12).
 *
 * Budget scenarios: when the input provides competition.budget_estimate with low/mid/high,
 * Agent 4 proposes three scenarios: Basic (low budget), Recommended (mid), Premium (high).
 * The deck shows the Recommended scenario by default; the other two are kept in assumptions.
 *
 * Competitive positioning slide (s12): ONLY when competition.positioning and competitors exist.
 * Shows: declared budget, estimated range, past winners, median bid count, positioning advice.
 *
 * This is Phase B: budget range (three scenarios) and competitive positioning, only when
 * research data exists.
 */

/**
 * Returns { hasScenarios, scenarios: [{ name, description, budget }], warnings }
 * where budget = { one_time, recurring, total } in cents.
 * scenarios = [] when no range data exists.
 */
function buildBudgetScenarios(input, catalog, language) {
  const fr = language !== 'en';
  const comp = input.competition || {};
  const est = comp.budget_estimate || {};
  
  if (!est.low || !est.mid || !est.high || !est.currency) {
    return { hasScenarios: false, scenarios: [], warnings: [] };
  }

  const warnings = [];
  if (est.confidence !== 'high') {
    warnings.push(fr 
      ? `Estimation budgétaire avec confiance ${est.confidence || 'inconnue'} (${est.comparables || 0} comparables)`
      : `Budget estimate with ${est.confidence || 'unknown'} confidence (${est.comparables || 0} comparables)`);
  }

  const scenarios = [
    {
      name: fr ? 'Basique' : 'Basic',
      description: fr 
        ? 'Configuration minimale, fonctionnalités essentielles'
        : 'Minimal configuration, essential features',
      targetAmount: Math.round(est.low * 100), // cents
      multiplier: est.low / est.mid
    },
    {
      name: fr ? 'Recommandée' : 'Recommended',
      description: fr
        ? 'Configuration standard, couvre tous les requis avec qualité'
        : 'Standard configuration, covers all requirements with quality',
      targetAmount: Math.round(est.mid * 100),
      multiplier: 1
    },
    {
      name: fr ? 'Premium' : 'Premium', 
      description: fr
        ? 'Configuration avancée, fonctionnalités étendues et support renforcé'
        : 'Advanced configuration, extended features and enhanced support',
      targetAmount: Math.round(est.high * 100),
      multiplier: est.high / est.mid
    }
  ];

  return { hasScenarios: true, scenarios, currency: est.currency, warnings };
}

/** 1234567 -> "1 234 567" (the deck's number style; no locale data needed in n8n). */
function fmtAmount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Competitive context slide (s12), from the market study of awarded comparable contracts.
 * Returns null unless the study succeeded (status OK) and found competitors or a bid count:
 * no slide is better than a slide of guesses.
 * The slide shows facts only (amounts, counts, names), labelled in the deck language. The market
 * agent's own sentences (positioning, budget comment) are written in English, so they go to the
 * speaker notes, never on the slide. The estimated range is shown only on the same terms as the
 * n8n adapter (3+ comparables, confidence above "very low").
 */
function buildCompetitiveSlide(input, language) {
  const fr = language !== 'en';
  const comp = input.competition || {};
  if (comp.status !== 'OK') return null;
  const competitors = (comp.competitors || []).filter(c => c && c.name);
  if (competitors.length === 0 && comp.median_bids == null) return null;

  const est = comp.budget_estimate;
  const showRange = est && est.low != null && est.high != null && est.mid != null
    && Number(est.comparables) >= 3 && est.confidence !== 'very low';
  const cur = (est && est.currency) || '';

  const blocks = [];
  const items = [];
  if (comp.declared_value) items.push(fr ? `Budget déclaré par l'acheteur : ${comp.declared_value}` : `Buyer's declared budget: ${comp.declared_value}`);
  if (showRange) {
    items.push(fr
      ? `Marchés comparables attribués : ${fmtAmount(est.low)} à ${fmtAmount(est.high)} ${cur} (médiane ${fmtAmount(est.mid)}, ${est.comparables} contrats)`
      : `Comparable awarded contracts: ${fmtAmount(est.low)} to ${fmtAmount(est.high)} ${cur} (median ${fmtAmount(est.mid)}, ${est.comparables} contracts)`);
  }
  if (comp.median_bids != null) items.push(fr ? `Nombre médian d'offres reçues : ${comp.median_bids}` : `Median number of bids received: ${comp.median_bids}`);
  if (items.length) blocks.push({ kind: 'bullets', items });

  if (competitors.length) {
    const none = fr ? 'n.d.' : 'n/a';
    blocks.push({
      kind: 'table',
      columns: fr ? ['Concurrent', 'Marchés gagnés', 'Dernier gain', 'Montant moyen'] : ['Competitor', 'Contracts won', 'Last win', 'Average amount'],
      rows: [...competitors]
        .sort((a, b) => (b.past_wins || 0) - (a.past_wins || 0))
        .slice(0, 8)
        .map(c => [
          c.name,
          c.past_wins == null ? none : String(c.past_wins),
          c.last_win || none,
          c.avg_amount != null ? `${fmtAmount(c.avg_amount)} ${cur}`.trim() : none
        ])
    });
  }

  const notes = [];
  if (comp.positioning) notes.push(comp.positioning);
  if (comp.budget_comment) notes.push(comp.budget_comment);
  const titles = (comp.comparables || []).slice(0, 3).map(c => c && c.title).filter(Boolean);
  if (titles.length) notes.push((fr ? 'Contrats comparables : ' : 'Comparable contracts: ') + titles.join('; '));
  notes.push(fr ? 'Source : marchés publics attribués (DECP, TED, TUNEPS).' : 'Source: awarded public contracts (DECP, TED, TUNEPS).');

  return {
    id: 's12',
    type: 'content',
    title: fr ? 'Contexte concurrentiel' : 'Competitive context',
    blocks,
    notes: notes.join('\n\n')
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildBudgetScenarios, buildCompetitiveSlide, fmtAmount };
}
