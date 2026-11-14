import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarClock, FileSearch, Filter, Target, TrendingUp, Users } from 'lucide-react'
import { Badge, Card, CardHeader, cx, Donut, Empty, ErrorNote, Loading, Pending, ScoreRing, statusTone } from '../components/ui'
import { allTenders, analysisFor, daysLeft, deadlineLabel, fmtDate, isOpen, parseDate, statusLabel, syncTenders, TODAY, withDeck, type Tender } from '../lib/data'
import { studioDecks, studioId, type Generation } from '../lib/studio'
import { documents, errorText, peek, records as fetchRecords, tenders as fetchTenders, type LoadState } from '../lib/api'
import { locale, plural, t } from '../lib/i18n'

const PIPE = [
  { key: 'detected', label: 'Detected', color: 'bg-primary/20 text-primary-deep' },
  { key: 'relevant', label: 'Relevant', color: 'bg-primary/40 text-primary-deep' },
  { key: 'analysed', label: 'Analysed', color: 'bg-primary-fill text-white' },
  { key: 'bid', label: 'Bid', color: 'bg-brand-soft text-brand-deep' },
  { key: 'proposal', label: 'Proposal ready', color: 'bg-brand-strong text-white' },
]

/** How close a deadline is: red within 3 days, amber within a week, calm otherwise (the words say it too). */
const urgency = (d: number) => d <= 3 ? 'bad' : d <= 7 ? 'warn' : 'neutral'

export default function Dashboard() {
  const nav = useNavigate()
  // Seen before in this session: the last answers show at once and are refreshed quietly (no loading state on every visit).
  const [seen] = useState(() => {
    const docs = peek.documents(), liveRecords = peek.records()
    return docs && liveRecords && peek.tenders() ? { docs, liveRecords } : null
  })
  const [peopleCount, setPeopleCount] = useState<number | null>(() => seen ? seen.docs.filter(doc => doc.type === 'cv').length : null)
  const [projectCount, setProjectCount] = useState<number | null>(() => seen ? seen.liveRecords.filter(record => record.type === 'past_project' && record.status === 'indexed').length : null)
  const [tenders, setTenders] = useState(allTenders)
  const [state, setState] = useState<LoadState>(seen ? 'ready' : 'loading')
  const [error, setError] = useState('')
  const load = useCallback((quiet = false) => {
    if (!quiet) setState('loading')
    Promise.all([documents(), fetchRecords(), fetchTenders()]).then(([docs, liveRecords, stored]) => {
      setPeopleCount(docs.filter(doc => doc.type === 'cv').length)
      setProjectCount(liveRecords.filter(record => record.type === 'past_project' && record.status === 'indexed').length)
      syncTenders(stored)
      setTenders(allTenders())
      setState('ready')
    }).catch(err => {
      // Tenders saved in this browser stay visible; the knowledge counts are unknown.
      setPeopleCount(null)
      setProjectCount(null)
      setTenders(allTenders())
      setError(errorText(err))
      setState('error')
    })
  }, [])
  useEffect(() => load(seen !== null), [load, seen])
  // The studio's decks turn a Bid tender into Proposal ready; without the studio the Bid tenders stay Bid.
  const [decks, setDecks] = useState<Map<string, Generation>>(() => new Map())
  useEffect(() => { studioDecks().then(setDecks) }, [])
  const statusOf = (x: Tender) => withDeck(x.status, decks.get(studioId(x.id))?.status)
  const loading = state === 'loading'
  /** A number from the RAG service: a placeholder while it loads, "–" when it is unknown (the service failed and the
   * browser has no saved copy of the tenders, so a count of 0 would be a guess). */
  const unknown = state === 'error' && tenders.length === 0
  const num = (value: number | null) => loading ? <Pending /> : unknown ? '–' : value ?? '–'
  const active = tenders.filter(x => isOpen(x.status))
  const byStatus = (...statuses: string[]) => tenders.filter(x => statuses.includes(statusOf(x))).length
  const counts = {
    detected: tenders.length,
    relevant: tenders.filter(x => x.status !== 'filtered').length,
    analysed: tenders.filter(x => analysisFor(x.id)).length,
    bid: byStatus('bid', 'proposal'),
    proposal: byStatus('proposal'),
  }
  const avgFit = Math.round(active.reduce((s, x) => s + (analysisFor(x.id)?.fit_score.overall ?? 0), 0) / (active.length || 1))
  // Tenders without a deadline come last.
  const byDeadline = [...active].sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
  const upcoming = byDeadline.filter(x => (daysLeft(x.deadline) ?? -1) >= 0)
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-muted first-letter:uppercase">{TODAY.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{t('Welcome back, OliveSoft admin')}</h1>
        </div>
        <Link to="/tenders" className="btn-secondary"><Filter size={16} />{t('Review new tenders')}</Link>
      </div>

      {state === 'error' && <ErrorNote onRetry={() => load()}
        message={`${t('Could not load the dashboard from the RAG service: {error}', { error })}${tenders.length ? ` ${t('Tenders come from the copy saved in this browser.')}` : ''}`} />}

      <div className="grid gap-5 md:grid-cols-3">
        <Card className="p-5">
          <CardHeader icon={FileSearch} title={t('Tenders')} />
          <div className="flex items-center gap-5">
            <Donut size={112} stroke={16} center={<div><div className="text-2xl font-semibold">{num(tenders.length)}</div><div className="text-[11px] text-ink-muted">{t('total')}</div></div>}
              segments={loading ? [] : [{ value: byStatus('review'), className: 'text-primary' }, { value: byStatus('bid', 'proposal'), className: 'text-brand' }, { value: byStatus('nobid', 'filtered'), className: 'text-line-strong' }]} />
            <ul className="space-y-2 text-[13px]">
              <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-primary" />{statusLabel('review')} <b className="ml-auto pl-3">{num(byStatus('review'))}</b></li>
              <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-brand" />{statusLabel('bid')} <b className="ml-auto pl-3">{num(byStatus('bid', 'proposal'))}</b></li>
              <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-line-strong" />{t('Closed')} <b className="ml-auto pl-3">{num(byStatus('nobid', 'filtered'))}</b></li>
            </ul>
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader icon={TrendingUp} title={t('Pipeline')} />
          <div className="space-y-2.5">
            {PIPE.map(p => {
              const n = counts[p.key as keyof typeof counts]
              // The bar is as long as its share of the detected tenders, never shorter than its label; an empty stage keeps
              // only an outline, so a 0 is not drawn as half a bar.
              const empty = !loading && n === 0
              return <div key={p.key} className="h-7 rounded-[8px] bg-canvas"><div className={cx('flex h-full w-fit min-w-fit items-center whitespace-nowrap rounded-[8px] px-3 text-[12px] font-medium',
                empty ? 'text-ink-muted ring-1 ring-inset ring-line-strong' : p.color)} style={empty ? undefined : { width: `${(n / (counts.detected || 1)) * 100}%` }}>{t(p.label)}<b className="ml-2">{num(n)}</b></div></div>
            })}
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader icon={Target} title={t('Average fit')} />
          <div className="text-[34px] font-semibold leading-none tracking-tight">{loading ? <Pending className="w-24" /> : active.length ? `${avgFit}%` : '–'}</div>
          <p className="mt-2 text-[13px] text-ink-muted">{loading ? t('Loading tenders…') : plural(active.length, 'Recorded coverage across {n} active tender', 'Recorded coverage across {n} active tenders')}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-ctl bg-canvas px-3 py-2"><div className="text-ink-muted">{t('People')}</div><b className="text-[15px]">{num(peopleCount)}</b></div>
            <div className="rounded-ctl bg-canvas px-3 py-2"><div className="text-ink-muted">{t('Projects')}</div><b className="text-[15px]">{num(projectCount)}</b></div>
          </div>
        </Card>

      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <CardHeader icon={FileSearch} title={t('Active tenders')} action={<Link to="/tenders" className="text-sm font-semibold text-primary">{t('View all')}</Link>} />
          {loading ? <Loading text={t('Loading tenders…')} /> : byDeadline.length === 0 ? <Empty icon={FileSearch} title={t('No active tenders')} text={t('Tenders sent by n8n and new analyses appear here.')} /> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">{t('Tender')}</th><th className="th">{t('Fit')}</th><th className="th">{t('Deadline')}</th><th className="th">{t('Status')}</th><th className="th"><span className="sr-only">{t('Open')}</span></th></tr></thead>
              <tbody>
                {byDeadline.map(x => {
                  const a = analysisFor(x.id), d = daysLeft(x.deadline)
                  return (
                    <tr key={x.id} className="cursor-pointer hover:bg-canvas/60" onClick={() => nav(`/tenders/${x.id}`)}>
                      <td className="td max-w-[360px]"><Link to={`/tenders/${x.id}`} onClick={e => e.stopPropagation()} className="block truncate font-medium hover:text-primary">{x.title}</Link><div className="truncate text-[12px] text-ink-muted">{x.client}</div></td>
                      <td className="td"><ScoreRing value={a?.fit_score.overall ?? null} size={40} /></td>
                      <td className="td whitespace-nowrap"><div className={d == null || d < 0 ? 'text-ink-muted' : cx('font-medium', d <= 7 && 'text-warn-ink')}>{deadlineLabel(d)}</div>{d != null && <div className="text-[12px] text-ink-muted">{fmtDate(x.deadline)}</div>}</td>
                      <td className="td"><Badge tone={statusTone(statusOf(x))}>{statusLabel(statusOf(x))}</Badge></td>
                      <td className="td text-right"><ArrowRight size={16} className="inline text-ink-faint" aria-hidden /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader icon={CalendarClock} title={t('Upcoming deadlines')} />
          {loading ? <Loading text={t('Loading deadlines…')} /> : upcoming.length === 0 ? <p className="py-6 text-center text-sm text-ink-muted">{t('No upcoming deadline.')}</p> : (
          <ol className="space-y-3">
            {upcoming.map(x => {
              const d = daysLeft(x.deadline) ?? 0, date = parseDate(x.deadline)!
              return (
                <li key={x.id}>
                  <Link to={`/tenders/${x.id}`} className="flex gap-3 rounded-ctl border border-line p-3 hover:border-primary/40">
                    <div className="grid w-12 shrink-0 place-items-center rounded-[8px] bg-canvas py-1 text-center leading-tight">
                      <span className="text-[11px] uppercase text-ink-muted">{date.toLocaleDateString(locale(), { month: 'short' })}</span>
                      <span className="text-[18px] font-semibold">{date.getDate()}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{x.title}</div>
                      <Badge tone={urgency(d)} className="mt-1">{d === 0 ? t('Today') : plural(d, 'In {n} day', 'In {n} days')}</Badge>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ol>
          )}
          <Link to="/knowledge" className="mt-4 flex items-center gap-2 rounded-ctl bg-primary-soft px-3 py-2.5 text-[13px] font-medium text-primary"><Users size={16} />{num(peopleCount)} {t('CVs in the knowledge base')}</Link>
        </Card>
      </div>
    </div>
  )
}
