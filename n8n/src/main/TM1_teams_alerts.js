// ============================================================================
// Teams Alerts (optional, off by default: TEAMS_NOTIFY in .env, patched by n8n/init/init.js). After Rank & Export: one Adaptive
// Card per ranked tender whose fit is high or medium and whose deadline is not too close, posted by the Teams bot in its alert
// conversation (services/teams-bot, POST /notify, credential "Teams bot notify key"). The card's facts are the ranked row's;
// its buttons are Open tender | Generate deck | No-bid. At most MAX_ALERTS a run (the best ranked ones).
// ============================================================================
const TEAMS_NOTIFY = false;                                         // patched by n8n/init/init.js (TEAMS_NOTIFY=true)
const BOT_NOTIFY_URL = 'http://host.docker.internal:3978/notify';  // patched by n8n/init/init.js (the teams-bot service)
const WEB_APP_URL = 'http://localhost:5173';                       // patched by n8n/init/init.js (TEAMS_WEB_APP_URL)
const MAX_ALERTS = 5;

const rows = $input.all().map(i => i.json).filter(r => r && r.tender_id && r.rank !== '' && r.rank != null && !r.status);
const fit = rows.filter(r => (r.fit === 'high' || r.fit === 'medium') && !r.too_late).sort((a, b) => Number(a.rank) - Number(b.rank));
if (!TEAMS_NOTIFY) return [{ json: { _notify: false, note: `Teams alerts off (TEAMS_NOTIFY): ${fit.length} fit tender(s) not posted` } }];
if (!fit.length) return [{ json: { _notify: false, note: 'no fit tender in this run: nothing posted to Teams' } }];

const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
return fit.slice(0, MAX_ALERTS).map(r => {
  const demo = /\bdemo\b/i.test(String(r.source || ''));
  const data = {
    tender_id: r.tender_id, title: String(r.title || '').slice(0, 140), buyer: String(r.buyer || '').slice(0, 80) || null, demo, source: r.source || null,
    deadline: r.deadline || null, days_left: num(r.days_left), budget: r.estimated_value || null, fit_level: r.fit, rank: Number(r.rank),
    fit: num(r.rag_fit_overall), covered: num(r.rag_covered), partial: num(r.rag_partial), missing: num(r.rag_missing), mandatory_missing: num(r.rag_mandatory_missing),
    market: r.market_budget_median ? { low: num(r.market_budget_low), mid: num(r.market_budget_median), high: num(r.market_budget_high), currency: r.market_budget_currency || null } : null,
    reason: String(r.fit_reason || '').slice(0, 240) || null, url: `${WEB_APP_URL}/tenders/${encodeURIComponent(r.tender_id)}`, notice_url: r.source_url || null,
  };
  const text = `New ${r.fit}-fit tender${demo ? ' (demo)' : ''}: ${data.title}${data.deadline ? ` (deadline ${data.deadline})` : ''}`;
  return { json: { _notify: true, notifyUrl: BOT_NOTIFY_URL, body: { kind: 'alert', text, language: r.language || 'en', cards: [{ type: 'tender', data: { ...data, alert: true } }] } } };
});
