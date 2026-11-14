/**
 * agent4.js - Agent 4 (Budget) logic
 * 
 * Produces slide s9 with requiresApproval, catalogDate, assumptions
 */

const { buildBudget, checkPlanConsistency, buildBudgetTableRows } = require('./budget.js');
const i18n = require('./i18n.js');
const { buildSystemPrompt, wrapTenderData, withFeedback, makeCaller, runAgentLoop } = require('./llm.js');
const pricingLib = require('./pricing.js');

/**
 * Builds ready facts for Agent 4
 */
function buildBudgetFacts(input, diagramsData) {
  const plan = diagramsData?.plan || [];
  const components = diagramsData?.components || [];
  const similarProjects = input.match?.similar_projects || [];
  
  return {
    components,
    plan,
    similarProjects,
    projectType: input.tender?.project_type || 'other'
  };
}

/**
 * Builds catalog keys list (not prices) for LLM
 */
function getCatalogKeys(catalog) {
  return {
    daily_rates: Object.keys(catalog.daily_rates),
    cloud: Object.keys(catalog.cloud),
    api: Object.keys(catalog.api),
    licenses: Object.keys(catalog.licenses)
  };
}

/**
 * Validates LLM output against catalog and rules
 */
function validateBudgetOutput(llmOutput, catalog, plan) {
  const errors = [];
  
  // Check people roles
  const validRoles = ['backend', 'frontend', 'devops', 'pm', 'designer', 'qa'];
  (llmOutput.people || []).forEach((p, i) => {
    const role = p.role?.toLowerCase();
    if (!validRoles.includes(role)) {
      errors.push(`people[${i}].role "${p.role}" invalid. Must be one of: ${validRoles.join(', ')}`);
    }
    if (!Number.isInteger(p.days) || p.days < 1) {
      errors.push(`people[${i}].days must be positive integer, got ${p.days}`);
    }
  });
  
  // Check infrastructure items exist in catalog
  (llmOutput.infrastructure || []).forEach((infra, i) => {
    if (!Object.prototype.hasOwnProperty.call(catalog.cloud, infra.item)) {
      errors.push(`infrastructure[${i}].item "${infra.item}" not in catalog. Available: ${Object.keys(catalog.cloud).join(', ')}`);
    }
    if (!Number.isInteger(infra.units) || infra.units < 1) {
      errors.push(`infrastructure[${i}].units must be positive integer`);
    }
    if (!Number.isInteger(infra.months) || infra.months < 1) {
      errors.push(`infrastructure[${i}].months must be positive integer`);
    }
  });
  
  // Check license items exist in catalog
  (llmOutput.licenses || []).forEach((lic, i) => {
    if (!Object.prototype.hasOwnProperty.call(catalog.licenses, lic.item)) {
      errors.push(`licenses[${i}].item "${lic.item}" not in catalog. Available: ${Object.keys(catalog.licenses).join(', ')}`);
    }
    if (!Number.isInteger(lic.units) || lic.units < 1) {
      errors.push(`licenses[${i}].units must be positive integer`);
    }
    if (!Number.isInteger(lic.months) || lic.months < 1) {
      errors.push(`licenses[${i}].months must be positive integer`);
    }
  });
  
  // Check API usage
  (llmOutput.api_usage || []).forEach((api, i) => {
    if (!Number.isInteger(api.requests_per_month) || api.requests_per_month < 0) {
      errors.push(`api_usage[${i}].requests_per_month must be non-negative integer`);
    }
    if (!Number.isInteger(api.months) || api.months < 1) {
      errors.push(`api_usage[${i}].months must be positive integer`);
    }
  });
  
  // Plan consistency check
  if (plan && plan.length > 0) {
    const consistency = checkPlanConsistency(plan, llmOutput.people || [], catalog.workdays_per_week);
    if (!consistency.consistent) {
      consistency.errors.forEach(err => {
        errors.push(`Plan mismatch for ${err.role}: expected ${err.expected} days, got ${err.actual} days (${err.percentDiff}% diff, tolerance 15%)`);
      });
    }
  }
  
  return errors;
}

/**
 * Builds slide s9 from budget
 */
function buildBudgetSlide(budget, language = 'fr', hasRealPrices = false) {
  const blocks = [];
  
  // Build table
  const columns = [
    i18n.translate('budget_item', language),
    i18n.translate('quantity', language),
    i18n.translate('unit_price', language),
    i18n.translate('total', language)
  ];
  
  const rows = buildBudgetTableRows(budget, language, 8);
  
  blocks.push({
    kind: 'table',
    columns,
    rows
  });
  
  // Note with one-time vs recurring
  let noteText;
  if (hasRealPrices && budget.oneTimeTotalCents > 0) {
    const oneTime = require('./budget.js').formatCurrency(budget.oneTimeTotalCents, language, budget.currency);
    const recurring = require('./budget.js').formatCurrency(budget.recurringTotalCents, language, budget.currency);
    
    if (language === 'fr') {
      noteText = `Montant one-time : ${oneTime}. Coûts récurrents : ${recurring}/an.`;
    } else {
      noteText = `One-time amount: ${oneTime}. Recurring costs: ${recurring}/year.`;
    }
  } else {
    if (language === 'fr') {
      noteText = 'Montant one-time : [TO FILL: total]. Coûts récurrents : [TO FILL: total]/an.';
    } else {
      noteText = 'One-time amount: [TO FILL: total]. Recurring costs: [TO FILL: total]/year.';
    }
  }
  
  blocks.push({
    kind: 'note',
    text: noteText
  });
  
  // Build assumptions
  const assumptions = [];
  assumptions.push(
    language === 'fr'
      ? `Catalogue de prix du ${budget.catalogDate}`
      : `Price catalog dated ${budget.catalogDate}`
  );
  assumptions.push(
    language === 'fr'
      ? 'Jours ouvrés par semaine : 5'
      : 'Working days per week: 5'
  );
  
  const slide = {
    id: 's9',
    type: 'content',
    title: i18n.translate('pricing', language),
    blocks,
    requiresApproval: true,
    assumptions,
    catalogDate: budget.catalogDate
  };
  
  return slide;
}

/**
 * Checks if catalog has all zero prices
 */
function hasZeroPrices(catalog) {
  const allRates = Object.values(catalog.daily_rates).concat(
    Object.values(catalog.cloud),
    Object.values(catalog.api),
    Object.values(catalog.licenses)
  );
  
  return allRates.every(price => price === 0);
}

/**
 * Executes Agent 4 (mock mode for now)
 */
function executeAgent4(input, diagramsData, catalog, options = {}) {
  const { mode = 'mock', fixtures = {} } = options;
  const language = input.tender?.language || 'fr';
  
  if (mode === 'mock') {
    // Return fixture or placeholder
    const inputId = input.tender?.id || 'unknown';
    const fixture = fixtures[inputId];
    
    if (fixture) {
      return fixture;
    }
    if (pricingLib.isPricingFile(catalog)) {
      const people = derivePeopleDays(diagramsData && diagramsData.plan, catalog.workdays_per_week || 5);
      return pricingResult(input, catalog, people.length ? people : [{ role: 'backend', days: 40 }, { role: 'frontend', days: 30 }],
        { cloud: [], storage_gb: 0, llm: [], assumptions: [] }, { ok: true, usage: { model: 'mock', promptTokens: 0, completionTokens: 0, ms: 0, attempts: 1 } });
    }
    
    // Generate placeholder
    const warnings = [];
    if (hasZeroPrices(catalog)) {
      warnings.push('Catalog prices not yet loaded - all prices shown as [TO FILL]');
    }
    
    const llmOutput = {
      people: [
        { role: 'backend', days: 40 },
        { role: 'frontend', days: 30 }
      ],
      infrastructure: [],
      api_usage: [],
      licenses: [],
      assumptions: [
        language === 'fr'
          ? `Catalogue de prix du ${catalog.last_updated}`
          : `Price catalog dated ${catalog.last_updated}`,
        language === 'fr'
          ? 'Jours ouvrés par semaine : 5'
          : 'Working days per week: 5'
      ]
    };
    
    const budget = buildBudget(llmOutput, catalog);
    const slide = buildBudgetSlide(budget, language, !hasZeroPrices(catalog));
    
    return {
      agent: 'budget',
      ok: true,
      slides: [slide],
      data: llmOutput,
      assumptions: llmOutput.assumptions,
      warnings,
      usage: { model: 'mock', promptTokens: 0, completionTokens: 0, ms: 0, attempts: 1 }
    };
  }
  
  return executeAgent4Real(input, diagramsData, catalog, options);
}

const AGENT4_PROMPT = `You are Agent 4 (budget). Choose WHAT is needed and HOW MUCH, never prices.
People-days are computed by code from the plan; you do not output them.

Return exactly this JSON:
{
  "infrastructure": [ { "item": "a key from catalog_keys.cloud", "units": 1, "months": 12 } ],
  "api_usage": [ { "item": "a key from catalog_keys.api", "requests_per_month": 1000, "input_tokens": 0, "output_tokens": 0, "months": 12 } ],
  "licenses": [ { "item": "a key from catalog_keys.licenses", "units": 1, "months": 12 } ],
  "assumptions": ["one line per volume you chose, explaining why"]
}
Use only catalog keys. All quantities are whole numbers. Empty arrays are fine when nothing is needed.`;

/** People-days per role derived from the plan: sum(weeks x people) x workdays per week. */
function derivePeopleDays(plan, workdaysPerWeek = 5) {
  const days = {};
  (plan || []).forEach(ph => (ph.roles || []).forEach(r => {
    const role = String(r.role || '').toLowerCase();
    days[role] = (days[role] || 0) + (ph.weeks || 0) * (r.people || 0) * workdaysPerWeek;
  }));
  return Object.entries(days).filter(([, d]) => d > 0).map(([role, d]) => ({ role, days: d }));
}

async function executeAgent4Real(input, diagramsData, catalog, options = {}) {
  if (pricingLib.isPricingFile(catalog)) return executeAgent4Pricing(input, diagramsData, catalog, options);
  const call = makeCaller(options);
  const language = input.tender?.language || 'fr';
  const fr = language === 'fr';
  const facts = buildBudgetFacts(input, diagramsData);
  const people = derivePeopleDays(facts.plan, catalog.workdays_per_week || 5);
  
  // Check for budget scenarios
  const competitive = require('./competitive.js');
  const scenariosData = competitive.buildBudgetScenarios(input, catalog, language);
  
  const system = buildSystemPrompt(AGENT4_PROMPT);
  const user = `Choose the budget quantities for this tender.\n${wrapTenderData({
    tender: { title: input.tender?.title, requirements: input.tender?.requirements, project_type: facts.projectType },
    components: facts.components, plan: facts.plan, people_days_computed_by_code: people,
    similar_projects: facts.similarProjects.map(p => ({ duration_months: p.duration_months, team_size: p.team_size })),
    catalog_keys: getCatalogKeys(catalog) })}`;

  const loop = await runAgentLoop({
    call, maxAttempts: options.maxAttempts || 3, initialViolations: options.feedback,
    build: (v) => ({ system, user: withFeedback(user, v), temperature: 0.2, maxTokens: 1500 }),
    validate: (json) => {
      const v = validateBudgetOutput({ ...json, people }, catalog, facts.plan);
      (json.api_usage || []).forEach((a, i) => {
        if (!Object.prototype.hasOwnProperty.call(catalog.api, a.item)) v.push(`api_usage[${i}].item "${a.item}" not in catalog`);
      });
      return v;
    }
  });

  const chosen = loop.ok ? loop.json : { infrastructure: [], api_usage: [], licenses: [], assumptions: [] };
  const llmOutput = {
    people,
    infrastructure: chosen.infrastructure || [],
    api_usage: chosen.api_usage || [],
    licenses: chosen.licenses || [],
    assumptions: [
      ...(chosen.assumptions || []).filter(a => typeof a === 'string'),
      fr ? `Catalogue de prix du ${catalog.last_updated}` : `Price catalog dated ${catalog.last_updated}`,
      fr ? `Jours ouvrés par semaine : ${catalog.workdays_per_week || 5}` : `Working days per week: ${catalog.workdays_per_week || 5}`,
      fr ? 'Jours-homme calculés par le code à partir du plan' : 'People-days computed by code from the plan'
    ]
  };
  
  // Add budget scenarios to assumptions if they exist
  if (scenariosData.hasScenarios) {
    llmOutput.warnings = [...(llmOutput.warnings || []), ...scenariosData.warnings];
    scenariosData.scenarios.forEach(s => {
      const formatted = require('./budget.js').formatCurrency(s.targetAmount, language, scenariosData.currency);
      llmOutput.assumptions.push(fr
        ? `Scénario ${s.name} : ${formatted} (${s.description})`
        : `${s.name} scenario: ${formatted} (${s.description})`);
    });
  }
  
  const warnings = llmOutput.warnings || [];
  if (hasZeroPrices(catalog)) warnings.push('Catalog prices not yet loaded - all prices shown as [TO FILL]');
  if (catalog.status === 'estimate') {
    // Rates not confirmed by OliveSoft: visible on the slide (Review panel) and in the assumptions
    const note = fr ? 'Tarifs estimés, à confirmer par OliveSoft avant envoi au client'
                    : 'Estimated rates, to be confirmed by OliveSoft before sending to the client';
    warnings.push(note);
    llmOutput.assumptions.push(note);
  }
  if (!people.length) warnings.push(fr ? 'Plan sans rôles : jours-homme à compléter' : 'Plan has no roles: people-days to fill');
  if (!loop.ok) warnings.push(`Agent 4 : ${loop.error || loop.violations.slice(0, 3).join('; ')} (seuls les jours-homme sont chiffrés)`);

  const budget = buildBudget(llmOutput, catalog);
  const slide = buildBudgetSlide(budget, language, !hasZeroPrices(catalog));
  slide.assumptions = [...new Set([...(slide.assumptions || []), ...llmOutput.assumptions])];
  if (catalog.status === 'estimate') slide.warnings = [...(slide.warnings || []), warnings[warnings.length - 1]];
  return {
    agent: 'budget',
    ok: loop.ok,
    slides: [slide],
    data: llmOutput,
    assumptions: llmOutput.assumptions,
    warnings,
    usage: { model: loop.model, promptTokens: loop.usage.promptTokens, completionTokens: loop.usage.completionTokens,
             ms: loop.ms, attempts: loop.attempts, rateLimitWaits: loop.rateLimitWaits }
  };
}


// ---- pricing.json (knowledge-base/pricing): day rates by role and seniority, cloud and LLM list prices

const RUN_PROMPT = `You are Agent 4 (budget). Choose WHAT the solution needs to run and HOW MUCH, never prices.
People-days and the cloud provider are decided by code; you only size the monthly run.

Return exactly this JSON:
{
  "cloud": [ { "item": "a key from pricing_keys.cloud_items", "units": 1 } ],
  "storage_gb": 0,
  "llm": [ { "model": "a key from pricing_keys.llm_models", "requests_per_month": 1000, "input_tokens": 2000, "output_tokens": 500 } ],
  "assumptions": ["one line per volume you chose, explaining why"]
}
Rules: use only the given keys; whole numbers only. "vm_*" are application servers, "db_*" managed databases, storage_gb the
files stored. Use "llm" ONLY when the tender asks for AI features (chatbot, assistant, generation, LLM, IA générative);
input_tokens / output_tokens are per request. Empty arrays and 0 are fine. Size for the tender's users, not the maximum.`;

const SENIORITY_LABEL = {
  fr: { junior: 'junior', mid: 'confirmé', senior: 'senior' },
  en: { junior: 'junior', mid: 'mid-level', senior: 'senior' }
};

/** Slide s9 from a pricing.js cost: build lines, the extras, the build total, then the monthly run. */
function buildPricingSlide(cost, language, pricing) {
  const fr = language !== 'en';
  const lang = fr ? 'fr' : 'en';
  const { formatCurrency } = require('./budget.js');
  const money = c => formatCurrency(c, lang, cost.currency);
  const rows = cost.build.map(l => [
    `${i18n.translate(`role_${l.role}`, lang)} (${SENIORITY_LABEL[lang][l.seniority]})`,
    `${l.days} ${fr ? 'jours' : 'days'}`, money(l.rateCents), money(l.totalCents)
  ]);
  // at most 6 build lines: the others are summed, never left blank
  if (rows.length > 6) {
    const rest = cost.build.slice(5).reduce((s, l) => s + l.totalCents, 0);
    rows.splice(5, rows.length, [fr ? 'Autres profils' : 'Other profiles', '-', '-', money(rest)]);
  }
  const pct = Math.round(cost.extrasPercent * 100);
  rows.push([fr ? `Support, aléas et marge (${pct} %)` : `Support, contingency and margin (${pct}%)`, '-', '-', money(cost.extrasCents)]);
  rows.push([fr ? 'Total réalisation (HT)' : 'Build total (excl. tax)', '', '', money(cost.oneTimeCents)]);

  // the monthly run in the same table, after the build total: one line per item, then its own total
  if (cost.run.length) {
    const n = v => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, fr ? '\u00a0' : ',');
    // unit prices below one euro keep 4 decimals (0,0169 EUR / Go), the others 2
    const unit = (v, per) => `${v.toFixed(v < 1 ? 4 : 2).replace('.', fr ? ',' : '.')} ${cost.currency}/${per}`;
    const perMonth = fr ? 'mois' : 'month';
    const where = `${cost.providerLabel}${cost.region ? `, ${cost.region}` : ''}`;
    // a section row names the provider before its services (VM, base, stockage)
    rows.push([fr ? `Exploitation mensuelle — ${where}` : `Monthly run — ${where}`, '', '', '']);
    cost.run.slice(0, 4).forEach(l => {
      if (l.kind === 'llm') {
        rows.push([fr ? `API ${l.label}` : `${l.label} API`, `${n(l.requests)} ${fr ? 'requêtes/mois' : 'requests/month'}`, '-', `${money(l.monthlyCents)}/${perMonth}`]);
      } else if (l.unit === 'hour') {
        rows.push([l.label, `${l.units} × ${l.hours} h/${perMonth}`, unit(l.unitPrice, 'h'), `${money(l.monthlyCents)}/${perMonth}`]);
      } else {
        rows.push([l.label, `${n(l.units)} ${fr ? 'Go' : 'GB'}`, unit(l.unitPrice, fr ? 'Go/mois' : 'GB/month'), `${money(l.monthlyCents)}/${perMonth}`]);
      }
    });
    rows.push([fr ? `Total exploitation (${where})` : `Run total (${where})`, '', '', `${money(cost.monthlyRunCents)}/${perMonth}`]);
  }

  const blocks = [{
    kind: 'table',
    columns: [i18n.translate('budget_item', lang), i18n.translate('quantity', lang), i18n.translate('unit_price', lang), i18n.translate('total', lang)],
    rows
  }];
  const fx = pricing.usd_per_eur;
  blocks.push({ kind: 'note', text: fr
    ? `Estimation indicative, tarifs à confirmer par OliveSoft${cost.run.length ? `. Cloud et IA : tarifs publics${fx ? `, USD au taux BCE du ${fx.date}` : ''}` : ''}.`
    : `Indicative estimate, rates to be confirmed by OliveSoft${cost.run.length ? `. Cloud and AI: public list prices${fx ? `, USD at the ECB rate of ${fx.date}` : ''}` : ''}.` });
  return { id: 's9', type: 'content', title: i18n.translate('pricing', lang), blocks, requiresApproval: true, catalogDate: pricing.last_updated };
}

function pricingResult(input, pricing, people, chosen, loop) {
  const language = input.tender?.language || 'fr';
  const fr = language !== 'en';
  const { provider, named } = pricingLib.chooseCloud(input, pricing);
  const cost = pricingLib.buildCost(people, chosen, pricing, provider);
  const slide = buildPricingSlide(cost, language, pricing);
  const cloud = pricing.cloud[provider] || {};
  const assumptions = [
    ...(chosen.assumptions || []).filter(a => typeof a === 'string'),
    fr ? 'Jours-homme calculés par le code à partir du plan' : 'People-days computed by code from the plan',
    fr ? `Tarifs journaliers OliveSoft du ${pricing.last_updated} (niveau par rôle : page Tarifs)` : `OliveSoft day rates of ${pricing.last_updated} (level per role: Pricing page)`,
    fr ? `Cloud ${cloud.label || provider}${named ? ' (demandé par l’appel d’offres)' : ' (choix par défaut)'} : ${cloud.source || ''} du ${cloud.date || '?'}`
       : `Cloud ${cloud.label || provider}${named ? ' (named by the tender)' : ' (default choice)'}: ${cloud.source || ''} of ${cloud.date || '?'}`
  ];
  const warnings = [...cost.warnings];
  if (pricing.status === 'estimate') warnings.push(fr ? 'Tarifs estimés, à confirmer par OliveSoft avant envoi au client' : 'Estimated rates, to be confirmed by OliveSoft before sending to the client');
  if (!people.length) warnings.push(fr ? 'Plan sans rôles : jours-homme à compléter' : 'Plan has no roles: people-days to fill');
  if (!loop.ok) warnings.push(`Agent 4 : ${loop.error || (loop.violations || []).slice(0, 3).join('; ')} (seuls les jours-homme sont chiffrés)`);
  slide.assumptions = assumptions;
  if (warnings.length) slide.warnings = warnings;
  return {
    agent: 'budget', ok: loop.ok !== false, slides: [slide],
    data: { people, provider, run: chosen, cost }, assumptions, warnings,
    usage: loop.usage || { model: loop.model, promptTokens: (loop.usage || {}).promptTokens, completionTokens: (loop.usage || {}).completionTokens,
                           ms: loop.ms, attempts: loop.attempts, rateLimitWaits: loop.rateLimitWaits }
  };
}

async function executeAgent4Pricing(input, diagramsData, pricing, options = {}) {
  const call = makeCaller(options);
  const facts = buildBudgetFacts(input, diagramsData);
  const people = derivePeopleDays(facts.plan, pricing.workdays_per_week || 5);
  const { provider } = pricingLib.chooseCloud(input, pricing);
  const system = buildSystemPrompt(RUN_PROMPT);
  const user = `Size the monthly run of this solution.\n${wrapTenderData({
    tender: { title: input.tender?.title, requirements: input.tender?.requirements, project_type: facts.projectType },
    components: facts.components, cloud_provider: provider, pricing_keys: pricingLib.pricingKeys(pricing, provider) })}`;
  const loop = await runAgentLoop({
    call, maxAttempts: options.maxAttempts || 3, initialViolations: options.feedback,
    build: (v) => ({ system, user: withFeedback(user, v), temperature: 0.2, maxTokens: 1200 }),
    validate: (json) => pricingLib.validateRunChoices(json, pricing, provider)
  });
  const chosen = loop.ok ? loop.json : { cloud: [], storage_gb: 0, llm: [], assumptions: [] };
  return pricingResult(input, pricing, people, chosen, {
    ok: loop.ok, error: loop.error, violations: loop.violations,
    usage: { model: loop.model, promptTokens: loop.usage.promptTokens, completionTokens: loop.usage.completionTokens,
             ms: loop.ms, attempts: loop.attempts, rateLimitWaits: loop.rateLimitWaits }
  });
}

// Export for CommonJS (n8n Code nodes) and ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildBudgetFacts,
    getCatalogKeys,
    validateBudgetOutput,
    buildBudgetSlide,
    hasZeroPrices,
    executeAgent4,
    executeAgent4Real,
    executeAgent4Pricing,
    buildPricingSlide,
    derivePeopleDays
  };
}
