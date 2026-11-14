import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, ExternalLink, FileText, Plus, Presentation, Search, Trash2 } from 'lucide-react'
import { Badge, Card, Chips, cx, ConfirmDialog, DeckBadge, Empty, ErrorNote, Loading, ScoreRing, SidePanel, statusTone } from '../components/ui'
import {
  allTenders, analysisFor, daysLeft, deadlineLabel, fmtDate, forgetAllTenders, forgetTender, MANUAL_SOURCE, rememberTender,
  isOpen, sourceLabel, statusLabel, syncTenders, withDeck, TENDERS_CHANGED, type Tender, type TenderStatus,
} from '../lib/data'
import { analyzeTender, clearTenders, deleteTender, errorText, peek, tenders, type LoadState, type TenderInput } from '../lib/api'
import { deckPath, studioDecks, studioId, type Generation } from '../lib/studio'
import { plural, t } from '../lib/i18n'

type F = 'all' | TenderStatus
/** What the confirmation dialog is about to delete. */
type Removal = { kind: 'all' } | { kind: 'one'; tender: Tender }

export default function Tenders() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<F>('all')
  // ?q=: a search typed in the header
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const asked = params.get('q')
  useEffect(() => { if (asked != null) setQ(asked) }, [asked])   // a new header search while this page is open
  const [currentTenders, setCurrentTenders] = useState(allTenders)
  // Loaded before in this session: the list shows at once and is refreshed quietly (no loading state on every visit).
  const [seen] = useState(() => peek.tenders() !== undefined)
  const [state, setState] = useState<LoadState>(seen ? 'ready' : 'loading')
  const [loadError, setLoadError] = useState('')
  const [removal, setRemoval] = useState<Removal | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')
  // The RAG service holds the inbox; the browser copy is only shown when the service cannot answer.
  // A quiet reload (after a delete) keeps the list on screen instead of showing the loading state.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState('loading')
    try {
      syncTenders(await tenders())
      setLoadError('')
      setState('ready')
    } catch (err) {
      setLoadError(errorText(err))
      setState('error')
    }
    setCurrentTenders(allTenders())
  }, [])
  useEffect(() => { load(seen) }, [load, seen])
  useEffect(() => {  // a new analysis or a change made elsewhere in the app shows up at once
    const refresh = () => setCurrentTenders(allTenders())
    window.addEventListener(TENDERS_CHANGED, refresh)
    return () => window.removeEventListener(TENDERS_CHANGED, refresh)
  }, [])
  // The decks of the proposal studio, by studio id; none when the studio does not answer (the list works without it).
  const [decks, setDecks] = useState<Map<string, Generation>>(() => new Map())
  useEffect(() => { studioDecks().then(setDecks) }, [])
  const statusOf = (x: Tender) => withDeck(x.status, decks.get(studioId(x.id))?.status)
  const newOpen = params.get('new') === '1'
  const list = useMemo(() => currentTenders
    .filter(x => filter === 'all' || statusOf(x) === filter)
    .filter(x => (x.title + x.client + x.sector + x.id).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.relevance - a.relevance), [filter, q, currentTenders, decks])
  const loading = state === 'loading'
  const n = (s: TenderStatus) => loading ? undefined : currentTenders.filter(x => statusOf(x) === s).length
  const ask = (next: Removal) => { setRemoveError(''); setRemoval(next) }
  const closeDialog = useCallback(() => setRemoval(null), [])

  async function remove() {
    if (!removal) return
    setRemoving(true); setRemoveError('')
    try {
      if (removal.kind === 'all') {
        await clearTenders()
        forgetAllTenders()
      } else {
        await deleteTender(removal.tender.id)
        forgetTender(removal.tender.id)
      }
      setCurrentTenders(allTenders())
      setRemoval(null)
      await load(true)
    } catch (err) {
      setRemoveError(errorText(err))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-[28px] font-semibold tracking-tight">{t('Tenders')}</h1><p className="mt-1 text-sm text-ink-muted">{t('Detected from public portals, ranked by relevance.')}</p></div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={loading || (state === 'ready' && currentTenders.length === 0)} onClick={() => ask({ kind: 'all' })}>
            <Trash2 size={16} />{t('Clear tenders')}</button>
          <button className="btn-primary" onClick={() => setParams({ new: '1' })}><Plus size={16} />{t('New analysis')}</button>
        </div>
      </div>

      {state === 'error' && <ErrorNote onRetry={() => load()}
        message={`${t('Could not load the tenders from the RAG service: {error}', { error: loadError })}${currentTenders.length ? ` ${t('Showing the copy saved in this browser.')}` : ''}`} />}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Chips<F> value={filter} onChange={setFilter} items={[
            { id: 'all', label: t('All'), count: loading ? undefined : currentTenders.length }, { id: 'review', label: statusLabel('review'), count: n('review') }, { id: 'bid', label: statusLabel('bid'), count: n('bid') },
            { id: 'proposal', label: statusLabel('proposal'), count: n('proposal') }, { id: 'nobid', label: statusLabel('nobid'), count: n('nobid') }, { id: 'filtered', label: statusLabel('filtered'), count: n('filtered') }]} />
          <label className="relative w-full sm:w-72"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
            <input type="search" className="input pl-9" placeholder={t('Search tenders')} value={q} onChange={e => setQ(e.target.value)} aria-label={t('Search tenders')} /></label>
        </div>
        {loading ? <Loading text={t('Loading tenders…')} /> :
          currentTenders.length === 0 ? (state === 'error'
            ? <Empty icon={FileText} title={t('No tenders to show')} text={t('The RAG service did not answer and this browser has no saved copy.')} />
            : <Empty icon={FileText} title={t('No tenders yet')} text={t('Tenders sent by n8n and your new analyses appear here.')}
                action={<button className="btn-secondary" onClick={() => setParams({ new: '1' })}><Plus size={16} />{t('New analysis')}</button>} />) :
          list.length === 0 ? <Empty icon={FileText} title={t('No tenders match')} text={t('Change the filter or the search.')}
            action={q || filter !== 'all' ? <button className="btn-secondary" onClick={() => { setQ(''); setFilter('all') }}>{t('Show all tenders')}</button> : undefined} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">{t('Tender')}</th><th className="th">{t('Source')}</th><th className="th">{t('Relevance')}</th><th className="th">{t('Fit')}</th><th className="th">{t('Deadline')}</th><th className="th">{t('Status')}</th><th className="th w-20"><span className="sr-only">{t('Actions')}</span></th></tr></thead>
              <tbody>
                {list.map(x => {
                  const a = analysisFor(x.id), d = daysLeft(x.deadline), closed = !isOpen(x.status)
                  const deck = decks.get(studioId(x.id)), deckUrl = deck?.status === 'done' ? deckPath(deck, x.id) : null
                  return (
                    <tr key={x.id} className="cursor-pointer hover:bg-canvas/60" onClick={() => nav(`/tenders/${x.id}`)}>
                      <td className="td max-w-[340px]">
                        <div className="flex items-center gap-2"><Link to={`/tenders/${x.id}`} onClick={e => e.stopPropagation()} className="truncate font-medium hover:text-primary">{x.title}</Link></div>
                        <div className="truncate text-[12px] text-ink-muted">{x.id} · {x.client}</div>
                      </td>
                      <td className="td whitespace-nowrap text-[13px] text-ink-muted">{sourceLabel(x)}</td>
                      <td className="td"><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-primary" style={{ width: `${x.relevance}%` }} /></div><span className="text-[12px] font-medium">{x.relevance}%</span></div></td>
                      <td className="td"><ScoreRing value={a?.fit_score.overall ?? null} size={40} /></td>
                      <td className="td whitespace-nowrap"><div className={d == null || d < 0 || closed ? 'text-ink-muted' : cx('font-medium', d <= 7 && 'text-warn-ink')}>{deadlineLabel(d)}</div>{d != null && <div className="text-[12px] text-ink-muted">{fmtDate(x.deadline)}</div>}</td>
                      <td className="td"><div className="flex flex-wrap items-center gap-1.5"><Badge tone={statusTone(statusOf(x))}>{statusLabel(statusOf(x))}</Badge><DeckBadge status={deck?.status} /></div></td>
                      <td className="td whitespace-nowrap text-right">
                        {deckUrl && <button className="btn-ghost btn-sm !px-2" aria-label={t('Open the deck of tender {id}', { id: x.id })} title={t('Open deck')}
                          onClick={e => { e.stopPropagation(); nav(deckUrl) }}><Presentation size={16} /></button>}
                        <button className="btn-ghost btn-sm !px-2 hover:!bg-bad-soft hover:!text-bad" aria-label={t('Delete tender {id}', { id: x.id })} title={t('Delete tender')}
                          onClick={e => { e.stopPropagation(); ask({ kind: 'one', tender: x }) }}><Trash2 size={16} /></button>
                        <ArrowRight size={16} className="ml-1 inline text-ink-faint" aria-hidden />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog open={!!removal} busy={removing} error={removeError} onConfirm={remove} onCancel={closeDialog}
        title={removal?.kind === 'all' ? t('Clear all tenders?') : t('Delete this tender?')}
        confirmLabel={removal?.kind === 'all' ? t('Clear tenders') : t('Delete tender')}
        text={removal?.kind === 'one'
          ? <><b className="font-medium text-ink">{removal.tender.title}</b> ({removal.tender.id}) {t('and its analysis are deleted from the RAG service. The knowledge base and the proposal studio\'s copy are not changed.')}</>
          : <>{currentTenders.length
              ? plural(currentTenders.length, 'The {n} tender stored by the RAG service and its analysis are deleted.', 'All {n} tenders stored by the RAG service and their analyses are deleted.')
              : t('Every tender stored by the RAG service and its analysis is deleted.')}{' '}
              {t('The knowledge base and the proposal studio are not changed. n8n adds a tender again the next time it sends it.')}</>} />

      <SidePanel open={newOpen} onClose={() => setParams({})} title={t('New analysis')} subtitle={<span className="text-[13px] text-ink-muted">{t('One requirement per line.')}</span>}>
        <NewAnalysisForm onComplete={() => setParams({})} />
      </SidePanel>
    </div>
  )
}

function NewAnalysisForm({ onComplete }: { onComplete: () => void }) {
  const nav = useNavigate()
  const [form, setForm] = useState({ title: '', client: '', sector: '', technical: '', team: '', experience: '', mode: 'company' as 'company' | 'demo' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const field = (key: 'technical' | 'team' | 'experience', label: string, rows: number, ph: string) => (
    <label className="block"><span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      <textarea rows={rows} className="input h-auto py-2" placeholder={ph} value={form[key]}
        onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>
  )
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(''); setSent(false)
    // The title, source and date are stored with the analysis, so the tender keeps them after a reload.
    const input: TenderInput = {
      tender_id: `LIVE-${Date.now()}`, title: form.title.trim(), client: form.client, sector: form.sector,
      source: MANUAL_SOURCE, published: new Date().toISOString().slice(0, 10), data_mode: form.mode,
      requirements: {
        technical: form.technical.split('\n').map(x => x.trim()).filter(Boolean),
        team: form.team.split('\n').map(x => x.trim()).filter(Boolean),
        experience: form.experience.split('\n').map(x => x.trim()).filter(Boolean),
        client: form.client, sector: form.sector,
      },
    }
    if (!form.title.trim() || !Object.values(input.requirements).some(value => Array.isArray(value) && value.length)) {
      setError(t('Enter a tender title and at least one requirement.'))
      setBusy(false)
      return
    }
    try {
      const analysis = await analyzeTender(input)
      const id = input.tender_id!
      // Same record as the RAG service stored; no deadline is invented (the form has none).
      rememberTender({ ...input, tender_id: id, rag_analysis: analysis })
      onComplete()  // closes the panel (a navigation to /tenders): it must come before opening the tender
      nav(`/tenders/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Analysis failed.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="space-y-4" onSubmit={submit}>
      <label className="block"><span className="mb-1.5 block text-[13px] font-medium">{t('Tender title')}</span><input className="input" placeholder={t('e.g. Plateforme CRM omnicanal')} required maxLength={300} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="mb-1.5 block text-[13px] font-medium">{t('Client')}</span><input className="input" value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} /></label>
        <label className="block"><span className="mb-1.5 block text-[13px] font-medium">{t('Sector')}</span><input className="input" placeholder={t('e.g. retail')} value={form.sector} onChange={e => setForm({ ...form, sector: e.target.value })} /></label>
      </div>
      {field('technical', t('Technical'), 4, t('e.g. Power BI dashboards'))}
      {field('team', t('Team'), 3, t('e.g. 2 data engineers'))}
      {field('experience', t('Experience'), 2, t('e.g. 2 projects in retail'))}
      <label className="block"><span className="mb-1.5 block text-[13px] font-medium">{t('Data mode')}</span><select className="input" value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value as 'company' | 'demo' })}><option value="company">{t('Company CVs and records')}</option><option value="demo">{t('Demo records')}</option></select></label>
      <button className="btn-primary w-full" disabled={busy}>{busy ? t('Analysing…') : t('Analyse the requirements')}</button>
      {error && <p role="alert" className="rounded-ctl bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">{error}</p>}
      {sent && <p role="status" className="rounded-ctl bg-primary-soft px-3 py-2 text-[13px] text-primary">{t('Analysis complete.')}</p>}
      <a href="https://domainetat.tn/?cat=9" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[13px] font-medium text-primary">{t('Browse source portal')} <ExternalLink size={14} aria-hidden /></a>
    </form>
  )
}
