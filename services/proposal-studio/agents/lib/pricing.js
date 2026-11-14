/**
 * pricing.js - Build and run costs from OliveSoft's pricing file (knowledge-base/pricing/pricing.json).
 *
 * Principle (same as budget.js): the LLM chooses what and how much, code calculates the money.
 * Build cost: people-days x the day rate of the role at the seniority OliveSoft staffs it with.
 * Run cost: cloud items of ONE provider (the one the tender names, else OliveSoft's default) and
 * LLM API usage, per month. Prices in USD are converted with the file's usd_per_eur rate.
 * Everything is in integer cents of the file's currency (EUR).
 */

const SENIORITIES = ['junior', 'mid', 'senior'];
const CLOUD_ITEMS = ['vm_small', 'vm_medium', 'vm_large', 'db_small', 'db_medium', 'storage_gb'];

/** True for the pricing.json shape (as opposed to the legacy agents/catalog/pricing_catalog.json). */
function isPricingFile(p) {
  return !!(p && p.day_rates && p.cloud && typeof p.cloud === 'object');
}

/** A price in `currency` -> euros (the file's currency); null when it cannot be converted. */
function toBase(amount, currency, pricing) {
  if (typeof amount !== 'number' || !isFinite(amount)) return null;
  const base = pricing.currency || 'EUR';
  if (!currency || currency === base) return amount;
  const rate = pricing.usd_per_eur && pricing.usd_per_eur.value;
  if (currency === 'USD' && base === 'EUR' && rate > 0) return amount / rate;
  return null;
}

const cents = v => Math.round(v * 100);

/**
 * The cloud provider of this tender: the one its text names (Azure, or Google Cloud / GCP),
 * else OliveSoft's default. Both named, or none: the default.
 */
function chooseCloud(input, pricing) {
  const t = input.tender || {};
  const reqs = t.requirements || {};
  const text = [t.title, t.description, ...(reqs.technical || []), ...(Array.isArray(reqs) ? reqs : [])]
    .filter(x => typeof x === 'string').join(' ');
  // a provider added on the Pricing page with a price left at 0 is not ready: never used for the budget
  const ready = k => !!pricing.cloud[k] && Object.values(pricing.cloud[k].items || {}).every(it => it.price > 0);
  const NAMES = { azure: /\bazure\b/i, gcp: /\b(google cloud|gcp)\b/i, aws: /\b(aws|amazon web services)\b/i, oracle: /\b(oracle cloud|oci)\b/i };
  const named = Object.keys(NAMES).filter(k => NAMES[k].test(text) && ready(k));
  if (named.length === 1) return { provider: named[0], named: true };
  const def = ready(pricing.default_cloud) ? pricing.default_cloud : Object.keys(pricing.cloud).find(ready) || Object.keys(pricing.cloud)[0];
  return { provider: def, named: false };
}

/** Keys the LLM may use (never the prices). */
function pricingKeys(pricing, provider) {
  const items = (pricing.cloud[provider] && pricing.cloud[provider].items) || {};
  return {
    cloud_items: CLOUD_ITEMS.filter(k => items[k] && typeof items[k].price === 'number'),
    llm_models: Object.keys((pricing.llm && pricing.llm.models) || {})
  };
}

/** Checks the LLM's run-cost choices against the keys; returns a list of violations. */
function validateRunChoices(json, pricing, provider) {
  const errors = [];
  const keys = pricingKeys(pricing, provider);
  (json.cloud || []).forEach((c, i) => {
    if (!keys.cloud_items.includes(c.item)) errors.push(`cloud[${i}].item "${c.item}" invalid. Must be one of: ${keys.cloud_items.join(', ')}`);
    if (!Number.isInteger(c.units) || c.units < 1) errors.push(`cloud[${i}].units must be a positive integer`);
  });
  if (json.storage_gb != null && (!Number.isInteger(json.storage_gb) || json.storage_gb < 0)) errors.push('storage_gb must be a whole number >= 0');
  (json.llm || []).forEach((l, i) => {
    if (!keys.llm_models.includes(l.model)) errors.push(`llm[${i}].model "${l.model}" invalid. Must be one of: ${keys.llm_models.join(', ')}`);
    ['requests_per_month', 'input_tokens', 'output_tokens'].forEach(f => {
      if (!Number.isInteger(l[f]) || l[f] < 1) errors.push(`llm[${i}].${f} must be a positive integer`);
    });
  });
  return errors;
}

/**
 * Full cost. people: [{ role, days }] (from the plan); run: { cloud: [{ item, units }], storage_gb, llm: [...] }.
 * Returns build lines, the percentages, run lines and totals, all in cents.
 */
function buildCost(people, run, pricing, provider) {
  const warnings = [];
  const build = (people || []).map(p => {
    const role = String(p.role || '').toLowerCase();
    const seniority = SENIORITIES.includes((pricing.staffing || {})[role]) ? pricing.staffing[role] : 'mid';
    const rate = ((pricing.day_rates || {})[role] || {})[seniority];
    if (typeof rate !== 'number') warnings.push(`No day rate for ${role} (${seniority})`);
    const rateCents = typeof rate === 'number' ? cents(rate) : 0;
    return { role, seniority, days: p.days, rateCents, totalCents: rateCents * p.days };
  });
  const buildCents = build.reduce((s, l) => s + l.totalCents, 0);
  const pct = k => (typeof pricing[k] === 'number' ? pricing[k] : 0);
  const extrasCents = Math.round(buildCents * (pct('support_percent_of_build') + pct('contingency_percent') + pct('margin_percent')));

  const cloud = pricing.cloud[provider] || { items: {} };
  const hours = pricing.hours_per_month || 730;
  const runLines = [];
  const addCloud = (key, units) => {
    const it = cloud.items[key];
    if (!it || typeof it.price !== 'number') { warnings.push(`No ${provider} price for ${key}`); return; }
    const monthly = toBase(it.price * (it.unit === 'hour' ? hours : 1) * units, cloud.currency, pricing);
    if (monthly == null) { warnings.push(`Cannot convert ${cloud.currency} prices`); return; }
    const unit = toBase(it.price, cloud.currency, pricing);
    runLines.push({ kind: 'cloud', key, label: it.label, unit: it.unit, units, hours: it.unit === 'hour' ? hours : null,
                    unitPrice: unit, monthlyCents: cents(monthly) });
  };
  (run.cloud || []).forEach(c => addCloud(c.item, c.units));
  if (run.storage_gb > 0) addCloud('storage_gb', run.storage_gb);
  const llm = pricing.llm || { models: {} };
  (run.llm || []).forEach(l => {
    const m = llm.models[l.model];
    if (!m) return;
    const usd = (l.input_tokens * m.input_per_1m + l.output_tokens * m.output_per_1m) / 1e6 * l.requests_per_month;
    const monthly = toBase(usd, llm.currency, pricing);
    if (monthly == null) { warnings.push(`Cannot convert ${llm.currency} prices`); return; }
    runLines.push({ kind: 'llm', key: l.model, label: m.label, requests: l.requests_per_month, monthlyCents: cents(monthly) });
  });
  return {
    currency: pricing.currency || 'EUR',
    provider, providerLabel: cloud.label || provider, region: cloud.region || '',
    build, buildCents, extrasPercent: pct('support_percent_of_build') + pct('contingency_percent') + pct('margin_percent'),
    extrasCents, oneTimeCents: buildCents + extrasCents,
    run: runLines, monthlyRunCents: runLines.reduce((s, l) => s + l.monthlyCents, 0),
    warnings
  };
}

// Export for CommonJS (n8n Code nodes) and ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SENIORITIES, CLOUD_ITEMS, isPricingFile, toBase, chooseCloud, pricingKeys, validateRunChoices, buildCost };
}
