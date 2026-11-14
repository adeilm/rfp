// ============================================================================
// RFP - Chat Tools: the tools of the Teams chat agent (RFP - Chat) and of the bot's buttons. One item in ({tool, ...inputs},
// from the agent's tool nodes, or "Run command" of RFP - Chat: the same code); one item out: {ok, tool, ...facts}, the JSON
// the agent reads and Check answer builds the cards from. Every fact comes from the RAG service (tender store, requirements matrix,
// team, gaps, /retrieve) or the proposal studio (buyer research, market study, decks); nothing here is written by a model.
// The actions (start_deck, refine_slide, record_no_bid) run only when can_act is 'yes': set by code in RFP - Chat from
// TEAMS_APPROVER_USERS (the bot), never by the model. Tender text is data: it is cut and passed on, never followed.
// ============================================================================
// where the services are, as seen from inside n8n (patched by n8n/init/init.js for the compose network)
const RAG_URL = 'http://host.docker.internal:8001';
const STUDIO_URL = 'http://host.docker.internal:8091';
const REFINE_URL = 'http://127.0.0.1:5678/webhook/cstam/refine-slide';   // "RFP - Refine Slide", same n8n (not localhost: IPv6 first)
const WEB_APP_URL = 'http://localhost:5173';                              // the links the Teams user opens (TEAMS_WEB_APP_URL)

const inp = $input.first().json || {};
const s = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const cut = (v, n) => { const t = s(v); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const tool = s(inp.tool);
const canAct = s(inp.can_act) === 'yes';
const out = data => [{ json: data }];
const fail = (error, extra = {}) => out({ ok: false, tool, error, ...extra });

// the studio's id of a tender (its tender_store.safe_id), as the web app sends it
const studioId = id => s(id).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64).replace(/^-+|-+$/g, '');
const tenderLink = id => `${WEB_APP_URL}/tenders/${encodeURIComponent(id)}`;
const deckLink = (deckId, tenderId) => `${WEB_APP_URL}/decks/${encodeURIComponent(deckId)}${tenderId ? `?tender=${encodeURIComponent(tenderId)}` : ''}`;
// an id the model typed: quotes, backticks and a trailing dot removed ("`T1w50xyr`." -> T1w50xyr)
const cleanRef = v => s(v).replace(/^[\s"'`«“]+|[\s"'`»”.,;:!?]+$/g, '');

const http = async (method, url, body) => {
  try {
    const r = await this.helpers.httpRequest({ method, url, json: true, timeout: 30000, returnFullResponse: true, ignoreHttpStatusErrors: true,
      ...(body === undefined ? {} : { body, headers: { 'Content-Type': 'application/json' } }) });
    let b = r.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { /* not JSON */ } }
    return { status: Number(r.statusCode) || 0, body: b };
  } catch (e) {
    return { status: 0, body: null, error: s(e.message || e).slice(0, 160) };
  }
};

// ---- today, in n8n's timezone (as Main's Config): days_left counts from it
const TZ = (typeof $now !== 'undefined' && $now && $now.zoneName) || 'UTC';
const today = (() => { try { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
  .formatToParts(new Date()).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; } catch (e) { return new Date().toISOString().slice(0, 10); } })();
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const isoDay = v => (/^\d{4}-\d{2}-\d{2}/.test(s(v)) ? s(v).slice(0, 10) : '');

// ---- the RAG's tender store
let store = null;
const tenders = async () => {
  if (store) return store;
  const r = await http('GET', `${RAG_URL}/api/tenders`);
  if (r.status !== 200 || !r.body || !Array.isArray(r.body.tenders)) {
    store = { error: r.status ? `the RAG service answered HTTP ${r.status}` : 'the RAG service is not reachable' };
    return store;
  }
  store = { list: r.body.tenders };
  return store;
};
const isDemo = t => t.data_mode === 'demo' || s(t.source).toLowerCase() === 'demo';
const counts = t => {
  const m = (t.rag_analysis && t.rag_analysis.requirements_matrix) || [];
  const c = st => m.filter(r => r.status === st).length;
  return { requirements: m.length, covered: c('covered'), partial: c('partial'), missing: c('missing'),
    mandatory_missing: m.filter(r => r.status === 'missing' && r.mandatory).length };
};
// the compact facts of one stored tender: what the agent reads and what the bot's TenderCard shows
const summary = t => {
  const fit = t.rag_analysis && t.rag_analysis.fit_score ? t.rag_analysis.fit_score.overall : null;
  const deadline = isoDay(t.deadline);
  return {
    tender_id: t.tender_id, title: cut(t.title, 140), buyer: cut(t.client, 80), demo: isDemo(t), source: s(t.source),
    published: isoDay(t.published), deadline: deadline || null, days_left: deadline ? daysBetween(today, deadline) : null,
    budget: s(t.estimated_budget) || null, language: s(t.language) || null, country: s(t.country) || null,
    fit: typeof fit === 'number' ? fit : null, ...counts(t),
    decision: t.decision ? { decision: t.decision.decision, reason: cut(t.decision.reason, 120) || null } : null,
    url: tenderLink(t.tender_id), notice_url: s(t.source_url) || null,
  };
};
// a tender by id, else by words of its title or buyer ("the Lille tender"): one match is used, several are listed
const findTender = async ref => {
  const st = await tenders();
  if (st.error) return { error: st.error };
  const id = cleanRef(ref);
  if (!id) return { error: 'no tender id given' };
  const exact = st.list.find(t => t.tender_id === id) || st.list.find(t => s(t.tender_id).toLowerCase() === id.toLowerCase());
  if (exact) return { tender: exact };
  const fold = x => s(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = fold(id).split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const hits = words.length ? st.list.filter(t => words.every(w => fold(`${t.title} ${t.client}`).includes(w))) : [];
  if (hits.length === 1) return { tender: hits[0] };
  if (hits.length > 1) return { error: `several tenders match "${cut(id, 60)}"`, candidates: hits.slice(0, 5).map(summary) };
  return { error: `no tender with id or words "${cut(id, 60)}" in the tender store` };
};
const notFound = f => fail(f.error, f.candidates ? { candidates: f.candidates } : { hint: 'call list_tenders to see the ids' });
const needAct = () => fail('not allowed: only the approvers listed in TEAMS_APPROVER_USERS can run this action', { not_allowed: true });

// ---- the studio's copy of a tender (proposal input v2: buyer research, market study) and its deck runs
const studioTender = async id => {
  const r = await http('GET', `${STUDIO_URL}/api/tenders/${studioId(id)}`);
  if (r.status === 404) return { missing: true };
  if (r.status !== 200 || !r.body) return { error: r.status ? `the proposal studio answered HTTP ${r.status}` : 'the proposal studio is not reachable' };
  return { input: r.body };
};
const runOf = g => g && {
  run_id: g.runId, status: g.status, step: g.step || null, created_at: g.createdAt || null, deck_id: g.deckId || null,
  placeholders: typeof g.placeholders === 'number' ? g.placeholders : null, warnings: Array.isArray(g.warnings) ? g.warnings.length : 0,
  error: cut(g.error, 160) || null, deck_url: g.deckId ? deckLink(g.deckId, g.tenderId) : null, tender_id: g.tenderId || null,
};

// ---------------------------------------------------------------- the tools
const TOOLS = {
  async list_tenders() {
    const st = await tenders();
    if (st.error) return fail(st.error);
    const q = s(inp.query).toLowerCase(), minFit = Number(s(inp.min_fit)) || 0;
    const within = Number(s(inp.deadline_within_days)) || 0, since = Number(s(inp.published_within_days)) || 0;
    const all = s(inp.include_closed) === 'yes';
    let rows = st.list.map(summary);
    const filters = [];
    if (!all) { rows = rows.filter(t => t.days_left == null || t.days_left >= 0); filters.push('open (deadline not passed)'); }
    if (q) { rows = rows.filter(t => `${t.title} ${t.buyer} ${t.tender_id}`.toLowerCase().includes(q)); filters.push(`matching "${cut(q, 40)}"`); }
    if (minFit) { rows = rows.filter(t => (t.fit || 0) >= minFit); filters.push(`fit ${minFit} or more`); }
    if (within) { rows = rows.filter(t => t.days_left != null && t.days_left <= within); filters.push(`deadline within ${within} days`); }
    if (since) { rows = rows.filter(t => t.published && daysBetween(t.published, today) <= since); filters.push(`published in the last ${since} days`); }
    rows.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || (a.days_left ?? 9999) - (b.days_left ?? 9999));
    const limit = Math.min(Math.max(Number(s(inp.limit)) || 5, 1), 10);
    return out({ ok: true, tool, today, total: rows.length, shown: Math.min(limit, rows.length), filters, tenders: rows.slice(0, limit),
      note: rows.some(t => t.demo) ? 'tenders with demo: true are fictional demo tenders: always say "demo"' : undefined });
  },

  async get_tender() {
    const f = await findTender(inp.tender_id);
    if (!f.tender) return notFound(f);
    const t = f.tender, a = t.rag_analysis || {};
    const st = await studioTender(t.tender_id);
    const summ = st.input && st.input.matrix && st.input.matrix.summary;
    return out({ ok: true, tool, today, tender: { ...summary(t),
      fit_detail: a.fit_score || null, gaps: (a.knowledge_gaps || []).length,
      team_size: a.team_proposal && a.team_proposal.size || 0,
      requirements_text: ['technical', 'team', 'experience'].flatMap(k => ((t.requirements || {})[k] || []).map(r => cut(r, 120))).slice(0, 8),
      in_studio: !!st.input, recommendation: summ ? s(summ.recommendation) || null : null,
      recommendation_reason: summ ? cut(summ.recommendation_reason, 200) || null : null } });
  },

  async get_requirements_matrix() {
    const f = await findTender(inp.tender_id);
    if (!f.tender) return notFound(f);
    const m = (f.tender.rag_analysis && f.tender.rag_analysis.requirements_matrix) || [];
    const rows = m.slice(0, 15).map((r, i) => ({ n: i + 1, requirement: cut(r.requirement, 140), category: r.category || null, mandatory: !!r.mandatory,
      status: r.status, basis: s(r.best_doc) || (r.closest_doc ? `closest: ${s(r.closest_doc)}` : null), evidence: cut(r.evidence || r.statement, 140) || null,
      demo_evidence: r.origin === 'demo' }));
    return out({ ok: true, tool, tender: summary(f.tender), total: m.length, rows });
  },

  async get_team() {
    const f = await findTender(inp.tender_id);
    if (!f.tender) return notFound(f);
    const tp = f.tender.rag_analysis && f.tender.rag_analysis.team_proposal;
    const members = (tp && tp.members || []).slice(0, 8).map(p => ({ name: s(p.name) || null, title: cut(p.title, 80), seniority: p.seniority || null,
      years: typeof p.years === 'number' ? p.years : null, roles: (p.roles || []).slice(0, 4), certifications: (p.certifications || []).slice(0, 5).map(c => cut(c, 60)),
      assigned_to: (p.assigned_to || []).slice(0, 4).map(x => cut(x, 80)), cv: p.doc_id || null }));
    return out({ ok: true, tool, tender: summary(f.tender), team_size: tp ? tp.size || members.length : 0, method: tp ? tp.method || null : null, members,
      note: members.length ? undefined : 'the RAG proposed no team for this tender (no team requirement, or no matching CV)' });
  },

  async get_gaps() {
    const f = await findTender(inp.tender_id);
    if (!f.tender) return notFound(f);
    const g = (f.tender.rag_analysis && f.tender.rag_analysis.knowledge_gaps) || [];
    return out({ ok: true, tool, tender: summary(f.tender), total: g.length, gaps: g.slice(0, 10).map(x => ({ requirement: cut(x.requirement, 140), status: x.status || null,
      mandatory: !!x.mandatory, gap: cut(x.gap, 160) || null, suggestion: cut(x.suggestion, 160) || null })) });
  },

  async get_prospect() {
    const f = await findTender(inp.tender_id);
    if (!f.tender) return notFound(f);
    const st = await studioTender(f.tender.tender_id);
    if (st.error) return fail(st.error);
    const b = st.input && st.input.buyer_profile;
    if (!b) return out({ ok: true, tool, tender: summary(f.tender), research_status: 'missing',
      note: 'no buyer research: n8n researches the buyers of fit tenders only (and never the demo buyers)' });
    return out({ ok: true, tool, tender: summary(f.tender), research_status: b.research_status || null, buyer: {
      name: s(b.name) || null, legal_name: s(b.legal_name) || null, sector: s(b.sector) || null, size: s(b.size) || null, staff: s(b.staff) || null,
      revenue: s(b.estimated_revenue) || null, website: s(b.website) || null, description: cut(b.organization_description, 300) || null,
      emails: ((b.contacts && b.contacts.emails) || []).slice(0, 3), phones: ((b.contacts && b.contacts.phones) || []).slice(0, 2),
      past_projects: (b.past_digital_projects || []).slice(0, 5).map(p => ({ title: cut(p.title, 100), date: p.date || null })),
      past_winners: (b.past_winners || []).slice(0, 5).map(w => ({ name: cut(w.name, 60), wins: w.wins ?? null })) } });
  },

  async get_market() {
    const f = await findTender(inp.tender_id);
    if (!f.tender) return notFound(f);
    const st = await studioTender(f.tender.tender_id);
    if (st.error) return fail(st.error);
    const c = st.input && st.input.competition;
    if (!c) return out({ ok: true, tool, tender: summary(f.tender), status: 'NOT_STUDIED', declared_value: summary(f.tender).budget,
      note: 'no market study for this tender (n8n studies the best fit tenders only)' });
    const b = c.budget_estimate || null;
    return out({ ok: true, tool, tender: summary(f.tender), status: s(c.status) || null, declared_value: s(c.declared_value) || null,
      budget_range: b ? { low: b.low ?? null, mid: b.mid ?? null, high: b.high ?? null, currency: b.currency || null, confidence: b.confidence || null,
        comparables: b.comparables ?? null, basis: cut(b.basis, 160) || null } : null,
      competitors: (c.competitors || []).slice(0, 5).map(x => ({ name: cut(x.name, 60), past_wins: x.past_wins ?? null })),
      median_bids: c.median_bids ?? null, positioning: cut(c.positioning, 400) || null,
      note: 'budget figures are computed by code from awarded contracts; OliveSoft prices are set in the studio, never in chat' });
  },

  async search_knowledge() {
    // "Power BI; 2 data engineers; a PMP": one requirement per ';' or new line, in the category the agent chose
    const lines = String(inp.query || '').split(/[;\n]+/).map(x => cut(x, 200)).filter(x => x.length >= 2).slice(0, 6);
    if (!lines.length) return fail('no requirement given: write them in query, separated by ";"');
    const cat = ['technical', 'team', 'experience'].includes(s(inp.category)) ? s(inp.category) : 'technical';
    // team lines ("2 data engineers", "a project manager with PMP") are matched against the CVs; a role word sends a line there
    const isTeam = l => cat === 'team' || /\b(engineers?|developers?|d[ée]veloppeurs?|ing[ée]nieurs?|chefs? de projet|project managers?|consultants?|architects?|architectes?|experts?|analysts?|PMP|scrum|certifi)/i.test(l);
    const body = { technical: [], team: [], experience: [] };
    for (const l of lines) (cat === 'experience' ? body.experience : isTeam(l) ? body.team : body.technical).push(l);
    const r = await http('POST', `${RAG_URL}/retrieve`, body);
    if (r.status !== 200 || !r.body) return fail(r.status ? `the RAG service answered HTTP ${r.status}` : 'the RAG service is not reachable');
    const m = r.body.requirements_matrix || [];
    const tp = r.body.team_proposal;
    return out({ ok: true, tool, rows: m.map((x, i) => ({ n: i + 1, requirement: cut(x.requirement, 140), category: x.category || null, status: x.status,
        found: x.found ?? null, needed: x.needed ?? null, basis: s(x.best_doc) || (x.closest_doc ? `closest: ${s(x.closest_doc)}` : null),
        evidence: cut(x.evidence || x.statement, 160) || null })),
      team: tp ? (tp.members || []).slice(0, 6).map(p => ({ name: s(p.name) || null, title: cut(p.title, 80), certifications: (p.certifications || []).slice(0, 4),
        assigned_to: (p.assigned_to || []).slice(0, 3).map(x => cut(x, 80)) })) : [],
      fit: r.body.fit_score ? r.body.fit_score.overall ?? null : null });
  },

  async deck_status() {
    const ref = cleanRef(inp.tender_id);
    if (!ref) {   // no tender: the latest runs of every tender
      const r = await http('GET', `${STUDIO_URL}/api/generations`);
      if (r.status !== 200 || !r.body) return fail(r.status ? `the proposal studio answered HTTP ${r.status}` : 'the proposal studio is not reachable');
      const runs = (r.body.generations || []).slice(0, 3).map(runOf);
      return out({ ok: true, tool, runs, note: runs.length ? undefined : 'no deck was generated yet' });
    }
    const f = await findTender(ref);
    if (!f.tender) return notFound(f);
    const r = await http('GET', `${STUDIO_URL}/api/generations?tenderId=${encodeURIComponent(studioId(f.tender.tender_id))}`);
    if (r.status !== 200 || !r.body) return fail(r.status ? `the proposal studio answered HTTP ${r.status}` : 'the proposal studio is not reachable');
    const runs = (r.body.generations || []).map(runOf);
    return out({ ok: true, tool, tender: summary(f.tender), last_run: runs[0] || null, runs: runs.length,
      note: runs.length ? undefined : 'no deck for this tender yet: start_deck makes one' });
  },

  async export_deck() {
    // the studio exports from its editor (it renders the slides there) and only after the prices are approved: a link, no file
    const f = await findTender(inp.tender_id);
    if (!f.tender) return notFound(f);
    const r = await http('GET', `${STUDIO_URL}/api/generations?tenderId=${encodeURIComponent(studioId(f.tender.tender_id))}`);
    const done = r.status === 200 && r.body ? (r.body.generations || []).map(runOf).find(g => g.status === 'done' && g.deck_id) : null;
    if (!done) return fail('this tender has no finished deck yet', { tender: summary(f.tender) });
    return out({ ok: true, tool, tender: summary(f.tender), deck_id: done.deck_id, deck_url: done.deck_url, placeholders: done.placeholders,
      note: 'open the deck, approve the prices and fill the [TO FILL] placeholders, then Export PPTX or PDF in the editor (prices are never approved from chat)' });
  },

  async start_deck() {
    if (!canAct) return needAct();
    const f = await findTender(inp.tender_id);
    if (!f.tender) return notFound(f);
    const t = f.tender;
    const r = await http('POST', `${STUDIO_URL}/api/generations`, { tenderId: studioId(t.tender_id), params: {} });
    const said = r.body && typeof r.body.message === 'string' ? cut(r.body.message, 160) : '';
    if (r.status === 202 && r.body && typeof r.body.runId === 'string') {
      return out({ ok: true, tool, tender: summary(t), run_id: r.body.runId, started: true, audit: { action: 'start_deck', tender_id: t.tender_id, run_id: r.body.runId },
        note: 'the deck takes about 2 to 5 minutes; the bot posts it in this conversation when it is ready' });
    }
    const why = { 404: 'this tender is not in the proposal studio (n8n sends the fit, open tenders only)',
      409: 'another deck is being generated (the studio makes one at a time): try again when it is done',
      503: 'deck generation is not configured in the proposal studio', 502: 'the proposal studio cannot reach the deck agents' }[r.status];
    return fail(why || (r.status ? `the proposal studio answered HTTP ${r.status}${said ? `: ${said}` : ''}` : 'the proposal studio is not reachable'), { tender: summary(t) });
  },

  async refine_slide() {
    if (!canAct) return needAct();
    const deckId = cleanRef(inp.deck_id);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deckId)) return fail('deck_id is missing or invalid: call deck_status to get it');
    // the slide number the editor shows (1 = the title slide) -> the studio's 0-based index
    const n = Number(s(inp.slide));
    if (!Number.isInteger(n) || n < 1) return fail('slide must be the slide number shown in the editor (1 = the title slide)');
    if (n === 1) return fail('the title slide cannot be refined');
    const instruction = cut(inp.instruction, 200);
    if (instruction.length < 3) return fail('write an instruction of at least 3 characters');
    const r = await http('POST', REFINE_URL, { deckId, slideIndex: n - 1, instruction });
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    if (r.status === 200 && b.status === 'ok') {
      return out({ ok: true, tool, deck_id: deckId, slide: n, title: cut(b.title, 120), warnings: (b.warnings || []).length, deck_url: deckLink(deckId),
        audit: { action: 'refine_slide', deck_id: deckId, slide: n }, note: 'a refined slide with prices needs a new price approval in the studio before export' });
    }
    return fail(cut(b.message, 200) || (r.status ? `Refine Slide answered HTTP ${r.status}` : 'Refine Slide is not reachable (is "RFP - Refine Slide" published?)'));
  },

  async record_no_bid() {
    if (!canAct) return needAct();
    const f = await findTender(inp.tender_id);
    if (!f.tender) return notFound(f);
    const reason = cut(inp.reason, 300);
    if (reason.length < 3) return fail('a no-bid needs a reason of 3 to 300 characters: ask the user why');
    const t = f.tender;
    const r = await http('PUT', `${RAG_URL}/api/tenders/${encodeURIComponent(t.tender_id)}/decision`, { decision: 'no_bid', reason });
    if (r.status !== 200) return fail(r.status ? `the RAG service answered HTTP ${r.status}` : 'the RAG service is not reachable', { tender: summary(t) });
    return out({ ok: true, tool, tender: summary(r.body && r.body.tender_id ? r.body : t), decision: 'no_bid', reason,
      audit: { action: 'record_no_bid', tender_id: t.tender_id } });
  },
};

if (!TOOLS[tool]) return fail(`unknown tool "${cut(tool, 40)}"`);
try {
  return await TOOLS[tool]();
} catch (e) {
  return fail(`the tool failed: ${cut(e.message || e, 160)}`);
}
