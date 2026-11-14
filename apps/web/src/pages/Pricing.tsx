import { useEffect, useState } from 'react'
import { Cloud, Cpu, RefreshCw, Save, Trash2, Users } from 'lucide-react'
import { AiLogo, CloudLogo } from '../components/logos'
import { Badge, Card, CardHeader, ErrorNote, Loading } from '../components/ui'
import { errorText, pricing as loadPricing, refreshPricing, savePricing } from '../lib/api'
import type { PriceReport, Pricing as PricingFile, Seniority } from '../lib/api'
import { t } from '../lib/i18n'

// OliveSoft's pricing: the deck's budget slide multiplies the plan's people-days by these day rates (at the level each
// role is staffed with) and sizes the monthly run with the cloud and AI list prices. Saved to knowledge-base/pricing.

const ROLES: [string, string][] = [['pm', 'Project manager'], ['backend', 'Backend'], ['frontend', 'Frontend'], ['devops', 'DevOps'], ['designer', 'Designer'], ['qa', 'QA']]
const LEVELS: [Seniority, string][] = [['junior', 'Junior'], ['mid', 'Mid-level'], ['senior', 'Senior']]
const PERCENTS: [keyof PricingFile, string][] = [['support_percent_of_build', 'Support'], ['contingency_percent', 'Contingency'], ['margin_percent', 'Margin']]
const UNIT = { hour: '/ hour', gb_month: '/ GB / month' }

// Providers OliveSoft can add: the same six items as Azure and GCP, prices to enter from the provider's price list
// (0 until then: the budget never uses a provider with a price left at 0)
const ADDABLE: Record<string, { label: string; region: string; items: [string, string, 'hour' | 'gb_month'][] }> = {
  aws: { label: 'Amazon Web Services', region: 'Paris (eu-west-3)', items: [
    ['vm_small', 'EC2 t3.medium (2 vCPU, 4 Go)', 'hour'], ['vm_medium', 'EC2 m6i.xlarge (4 vCPU, 16 Go)', 'hour'],
    ['vm_large', 'EC2 m6i.2xlarge (8 vCPU, 32 Go)', 'hour'], ['db_small', 'RDS PostgreSQL db.m6i.large (2 vCPU)', 'hour'],
    ['db_medium', 'RDS PostgreSQL db.m6i.xlarge (4 vCPU)', 'hour'], ['storage_gb', 'S3 Standard', 'gb_month']] },
  oracle: { label: 'Oracle Cloud', region: 'Paris (eu-paris-1)', items: [
    ['vm_small', 'VM.Standard.E5.Flex (2 OCPU, 4 Go)', 'hour'], ['vm_medium', 'VM.Standard.E5.Flex (4 OCPU, 16 Go)', 'hour'],
    ['vm_large', 'VM.Standard.E5.Flex (8 OCPU, 32 Go)', 'hour'], ['db_small', 'PostgreSQL DB System, 2 OCPU', 'hour'],
    ['db_medium', 'PostgreSQL DB System, 4 OCPU', 'hour'], ['storage_gb', 'Object Storage Standard', 'gb_month']] },
}

function NumberCell({ value, onChange, step = 1, label }: { value: number; onChange: (v: number) => void; step?: number; label: string }) {
  return <input type="number" min={0} step={step} aria-label={label} className="input h-9 w-28 text-right tabular-nums"
    value={Number.isFinite(value) ? value : ''} onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
}

/** A price marked "manual": true in the file: "Update prices" skips it. */
const ManualBadge = () => <span title={t('Entered by hand: "Update prices" never changes it')}><Badge className="ml-2" tone="neutral">{t('Manual')}</Badge></span>

/** One source's result of "Update prices" (a cloud provider, the exchange rate, the AI models), under its prices. */
function ReportLine({ r, label, className = '' }: { r?: PriceReport; label?: string; className?: string }) {
  if (!r) return null
  const kept = r.skipped?.length ? t('kept as entered (manual): {items}', { items: r.skipped.join(', ') }) : ''
  const parts = r.error ? [t('Not updated: {error}', { error: r.error }), kept]
    : r.note ? [r.note]
    : [t('{n} updated', { n: r.updated.length }), r.missing.length ? t('not found: {items}', { items: r.missing.join(', ') }) : '', kept]
  return <p className={`text-[13px] ${r.error ? 'text-warn-ink' : 'text-ink-muted'} ${className}`}>
    {label ? `${label}: ` : ''}{parts.filter(Boolean).join(', ')}
  </p>
}

export default function Pricing() {
  const [p, setP] = useState<PricingFile | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'save' | 'refresh' | null>(null)
  const [message, setMessage] = useState<{ text: string; warn?: boolean } | null>(null)
  const [report, setReport] = useState<Record<string, PriceReport> | null>(null)
  const [dirty, setDirty] = useState(false)

  const load = () => { setError(''); loadPricing().then(setP).catch(err => setError(errorText(err))) }
  useEffect(load, [])

  const edit = (change: (draft: PricingFile) => void) => setP(prev => {
    if (!prev) return prev
    const draft = structuredClone(prev)
    change(draft)
    setDirty(true)
    setMessage(null)
    return draft
  })

  const save = async () => {
    if (!p) return
    setBusy('save'); setError('')
    try { setP(await savePricing(p)); setDirty(false); setMessage({ text: 'Saved. New decks use these prices.' }) }
    catch (err) { setError(errorText(err)) }
    finally { setBusy(null) }
  }
  // Cloud (Azure, GCP with its key), the USD/EUR rate (ECB) and the AI models (OpenRouter), each reported on its own:
  // the success message only when no source failed
  const refresh = async () => {
    setBusy('refresh'); setError(''); setReport(null); setMessage(null)
    try {
      const r = await refreshPricing(); setP(r.pricing); setReport(r.report); setDirty(false)
      const failed = Object.values(r.report).some(s => s.error)
      setMessage(failed ? { text: t('Some prices could not be updated: see the note under each section.'), warn: true }
        : { text: t('Prices updated from the public sources.') })
    }
    catch (err) { setError(errorText(err)) }
    finally { setBusy(null) }
  }

  if (!p) return error ? <ErrorNote message={error} onRetry={load} /> : <Loading />
  const providers = Object.entries(p.cloud)
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Pricing</h1>
          <p className="mt-1 text-sm text-ink-muted">Day rates, cloud and AI prices used by the budget slide of every new deck. Last saved {p.last_updated}.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-primary" onClick={save} disabled={!dirty || busy != null}><Save size={16} />{busy === 'save' ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      {error && <ErrorNote message={error} />}
      {message && <p className={`rounded-ctl px-3 py-2 text-sm ${message.warn ? 'bg-warn-soft text-warn-ink' : 'bg-brand-soft text-brand-deep'}`} role="status">{message.text}</p>}

      <Card className="p-5">
        <CardHeader icon={Users} title="Day rates (EUR excl. tax)" hint="Price of one day of work by role and level. 'Staffed as' is the level the budget uses for that role." />
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Role</th>{LEVELS.map(([, l]) => <th key={l} className="th text-right">{l}</th>)}<th className="th">Staffed as</th></tr></thead>
            <tbody>{ROLES.map(([role, label]) => (
              <tr key={role}>
                <td className="td font-medium">{label}</td>
                {LEVELS.map(([lvl, l]) => <td key={lvl} className="td text-right">
                  <NumberCell label={`${label} ${l}`} value={p.day_rates[role]?.[lvl]} onChange={v => edit(d => { d.day_rates[role] = { ...d.day_rates[role], [lvl]: v } })} />
                </td>)}
                <td className="td">
                  <select className="input h-9 w-36" aria-label={`${label} staffed as`} value={p.staffing[role] ?? 'mid'}
                    onChange={e => edit(d => { d.staffing[role] = e.target.value as Seniority })}>
                    {LEVELS.map(([lvl, l]) => <option key={lvl} value={lvl}>{l}</option>)}
                  </select>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          {PERCENTS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">{label} (%)
              <NumberCell label={`${label} percent`} value={Math.round((p[k] as number) * 1000) / 10} step={0.5}
                onChange={v => edit(d => { (d as Record<string, unknown>)[k] = v / 100 })} />
            </label>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader icon={Cloud} title="Cloud (monthly run)" hint="The budget uses the provider the tender names, else the default. Prices are public pay-as-you-go list prices." />
        <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">Default provider
            <select className="input h-9 w-48" value={p.default_cloud} onChange={e => edit(d => { d.default_cloud = e.target.value })}>
              {providers.map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">USD for 1 EUR
            <NumberCell label="USD for 1 EUR" step={0.001} value={p.usd_per_eur.value} onChange={v => edit(d => { d.usd_per_eur = { ...d.usd_per_eur, value: v } })} />
          </label>
          <span className="text-ink-muted">{p.usd_per_eur.source}, {p.usd_per_eur.date}{p.usd_per_eur.manual && <ManualBadge />}</span>
          {Object.keys(ADDABLE).some(k => !p.cloud[k]) && (
            <select className="input h-9 w-44 ml-auto" aria-label="Add a cloud provider" value=""
              onChange={e => { const k = e.target.value; const a = ADDABLE[k]; if (!a) return
                edit(d => { d.cloud[k] = { label: a.label, region: a.region, currency: 'USD', source: "Prices to enter from the provider's price list", date: new Date().toISOString().slice(0, 10),
                  items: Object.fromEntries(a.items.map(([id, label, unit]) => [id, { label, unit, price: 0 }])) } }) }}>
              <option value="">+ Add provider</option>
              {Object.entries(ADDABLE).filter(([k]) => !p.cloud[k]).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
            </select>
          )}
          <button className={`btn-secondary btn-sm ${Object.keys(ADDABLE).some(k => !p.cloud[k]) ? '' : 'ml-auto'}`} onClick={refresh} disabled={busy != null}><RefreshCw size={14} />{busy === 'refresh' ? t('Updating…') : t('Update prices')}</button>
        </div>
        <ReportLine r={report?.fx} label={t('Exchange rate')} className="-mt-2 mb-4" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {providers.map(([key, c]) => (
            <div key={key} className="rounded-ctl border border-line">
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                <div className="flex items-center gap-3"><CloudLogo provider={key} size={28} />
                  <div><div className="font-medium">{c.label} · {c.region}</div><div className="text-[12px] text-ink-muted">{c.source} · {c.date} · {c.currency}</div></div></div>
                <div className="flex items-center gap-2">
                  {Object.values(c.items).some(it => !it.price) && <Badge tone="warn">Prices to enter</Badge>}
                  {key === p.default_cloud && <Badge tone="info">Default</Badge>}
                  {key in ADDABLE && key !== p.default_cloud && <button className="btn-ghost btn-sm" aria-label={`Remove ${c.label}`}
                    onClick={() => edit(d => { delete d.cloud[key] })}><Trash2 size={14} /></button>}
                </div>
              </div>
              <table className="w-full text-sm"><tbody>{Object.entries(c.items).map(([item, it]) => (
                <tr key={item}>
                  <td className="td">{it.label}{it.manual && <ManualBadge />}</td>
                  <td className="td text-right"><NumberCell label={`${c.label} ${it.label}`} step={0.0001} value={it.price}
                    onChange={v => edit(d => { d.cloud[key].items[item].price = v })} /></td>
                  <td className="td whitespace-nowrap text-ink-muted">{c.currency} {UNIT[it.unit]}</td>
                </tr>
              ))}</tbody></table>
              <ReportLine r={report?.[key]} className="px-4 py-2" />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader icon={Cpu} title={`AI APIs (${p.llm.currency} per 1M tokens)`} hint="Used only when the tender asks for AI features (chatbot, assistant, generation)." />
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Model</th><th className="th">Provider</th><th className="th text-right">Input</th><th className="th text-right">Output</th><th className="th">Source</th></tr></thead>
            <tbody>{Object.entries(p.llm.models).map(([key, m]) => (
              <tr key={key}>
                <td className="td font-medium">{m.label}{key === p.llm.default_model && <Badge className="ml-2" tone="info">Default</Badge>}{m.manual && <ManualBadge />}</td>
                <td className="td text-ink-muted"><span className="inline-flex items-center gap-2"><AiLogo provider={m.provider} size={18} />{m.provider}</span></td>
                <td className="td text-right"><NumberCell label={`${m.label} input`} step={0.01} value={m.input_per_1m} onChange={v => edit(d => { d.llm.models[key].input_per_1m = v })} /></td>
                <td className="td text-right"><NumberCell label={`${m.label} output`} step={0.01} value={m.output_per_1m} onChange={v => edit(d => { d.llm.models[key].output_per_1m = v })} /></td>
                <td className="td text-[12px] text-ink-muted">{m.source} · {p.llm.date}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {p.llm.source && <p className="mt-3 text-[12px] text-ink-muted">{p.llm.source} · {p.llm.date}</p>}
        <ReportLine r={report?.llm} label={t('AI prices')} className="mt-2" />
      </Card>
    </div>
  )
}
