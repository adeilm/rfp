import { type KeyboardEvent, ReactNode, useEffect, useId, useRef } from 'react'
import { AlertTriangle, CheckCircle2, CircleCheck, CircleDashed, CircleX, HelpCircle, Loader2, RotateCw, X, type LucideIcon } from 'lucide-react'
import { t } from '../lib/i18n'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('card', className)}>{children}</section>
}

export function IconTile({ icon: Icon, tone = 'primary' }: { icon: LucideIcon; tone?: 'primary' | 'brand' | 'warn' | 'bad' }) {
  const tones = { primary: 'bg-primary-fill text-white', brand: 'bg-brand-strong text-white', warn: 'bg-warn-soft text-warn-ink', bad: 'bg-bad-soft text-bad' }
  return <span className={cx('grid h-9 w-9 place-items-center rounded-[10px] shrink-0', tones[tone])}><Icon size={18} strokeWidth={2} /></span>
}

export function CardHeader({ icon, title, action, tone, hint }: { icon?: LucideIcon; title: ReactNode; action?: ReactNode; tone?: 'primary' | 'brand' | 'warn' | 'bad'; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-3 min-w-0">
        {icon && <IconTile icon={icon} tone={tone} />}
        <h2 className="text-[16px] font-semibold truncate">{title}</h2>
        {hint && <Tip text={hint} />}
      </div>
      {action}
    </div>
  )
}

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'brand' | 'dark' | 'outline'
const TONES: Record<Tone, string> = {
  good: 'bg-brand-soft text-brand-deep', warn: 'bg-warn-soft text-warn-ink', bad: 'bg-bad-soft text-bad-ink',
  info: 'bg-primary-soft text-primary', neutral: 'bg-canvas text-ink-muted', brand: 'bg-brand-strong text-white', dark: 'bg-primary-strong text-white', outline: 'bg-surface text-primary ring-1 ring-inset ring-primary/30',
}
export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap', TONES[tone], className)}>{children}</span>
}

export const statusTone = (s: string): Tone =>
  ({ covered: 'good', partial: 'warn', missing: 'bad', review: 'outline', bid: 'good', proposal: 'brand', nobid: 'neutral', filtered: 'neutral' } as Record<string, Tone>)[s] ?? 'neutral'

/** The proposal studio's deck of a tender: "Generating" while its agents work, "Deck ready" once done, nothing otherwise. */
export function DeckBadge({ status }: { status?: string | null }) {
  if (status === 'done') return <Badge tone="good"><CheckCircle2 size={12} />{t('Deck ready')}</Badge>
  if (status === 'queued' || status === 'running') return <Badge tone="info"><Loader2 size={12} className="animate-spin" />{t('Generating')}</Badge>
  return null
}

/** A help mark: the text shows on hover and on keyboard focus, and a screen reader reads it as the mark's name. */
export function Tip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex" tabIndex={0} role="img" aria-label={text}>
      <HelpCircle size={15} className="text-ink-muted group-hover:text-ink" aria-hidden />
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-6 z-30 hidden w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-ctl bg-ink px-3 py-2 text-[12px] font-normal normal-case leading-snug tracking-normal text-surface shadow-pop group-hover:block group-focus:block">{text}</span>
    </span>
  )
}

export function Bar({ value, tone = 'primary', className }: { value: number | null; tone?: 'primary' | 'brand' | 'warn' | 'bad'; className?: string }) {
  const color = { primary: 'bg-primary', brand: 'bg-brand', warn: 'bg-warn', bad: 'bg-bad' }[tone]
  return <div className={cx('h-2 w-full rounded-full bg-canvas overflow-hidden', className)}><div className={cx('h-full rounded-full', color)} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></div>
}

/** Fit bands: teal (brand) from 60 % (most requirements backed), amber from 30 %, red below; blue when there is no score. The
 * number is always shown with the colour. A band reads coverage, not the chance of winning. */
export const fitTone = (v: number | null): 'primary' | 'brand' | 'warn' | 'bad' => v == null ? 'primary' : v >= 60 ? 'brand' : v >= 30 ? 'warn' : 'bad'
const STROKE = { primary: 'text-primary', brand: 'text-brand', warn: 'text-warn', bad: 'text-bad' }

/** A ring chart. Each segment's colour is a text-colour class (the stroke is currentColor), so it follows the tokens. */
export function Donut({ segments, size = 128, stroke = 18, center }: { segments: { value: number; className: string }[]; size?: number; stroke?: number; center: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  let offset = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-line" />
        {segments.filter(s => s.value > 0).map((s, i) => {
          const len = (s.value / total) * c
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className={s.className}
            strokeDasharray={`${Math.max(len - 3, 0)} ${c}`} strokeDashoffset={-offset} strokeLinecap="butt" />
          offset += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{center}</div>
    </div>
  )
}

export function ScoreRing({ value, size = 44 }: { value: number | null; size?: number }) {
  const v = value ?? 0
  return (
    <span role="img" aria-label={value == null ? t('Fit not computed') : t('Fit {v}%', { v })} className="inline-flex">
      <Donut size={size} stroke={5} segments={[{ value: v, className: STROKE[fitTone(value)] }, { value: 100 - v, className: 'text-transparent' }]}
        center={<span className="text-[12px] font-semibold" aria-hidden>{value == null ? '–' : v}</span>} />
    </span>
  )
}

const COVERAGE = {
  covered: { tone: 'good', icon: CircleCheck, label: 'Covered' },
  partial: { tone: 'warn', icon: CircleDashed, label: 'Partial' },
  missing: { tone: 'bad', icon: CircleX, label: 'Missing' },
} as const
/** Covered / partial / missing: colour, icon and word together, so the three read apart at a glance and without colour. */
export function CoverageBadge({ status }: { status: string }) {
  const c = COVERAGE[status as keyof typeof COVERAGE]
  if (!c) return <Badge>{status}</Badge>
  const Icon = c.icon
  return <Badge tone={c.tone}><Icon size={12} strokeWidth={2.5} aria-hidden />{t(c.label)}</Badge>
}

/** The ids that tie a tab to its panel: spread `tabPanel(id, value)` on the element that holds the selected tab's content. */
const tabId = (id: string, tab: string) => `${id}-tab-${tab}`
export const tabPanel = (id: string, value: string) =>
  ({ role: 'tabpanel', id: `${id}-panel`, 'aria-labelledby': tabId(id, value), tabIndex: -1 }) as const

/** Tabs with the keyboard pattern of the ARIA tabs: one tab stop, arrows, Home and End move and select. */
export function Tabs<T extends string>({ id, label, tabs, value, onChange }: {
  id: string; label: string; tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex(x => x.id === value)
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key]
    if (next == null) return
    e.preventDefault()
    const tab = tabs[(next + tabs.length) % tabs.length]
    onChange(tab.id)
    list.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(id, tab.id))}`)?.focus()
  }
  return (
    <div ref={list} role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(x => {
        const selected = value === x.id
        return (
          <button key={x.id} id={tabId(id, x.id)} role="tab" aria-selected={selected} aria-controls={`${id}-panel`} tabIndex={selected ? 0 : -1}
            onClick={() => onChange(x.id)}
            className={cx('relative -mb-px whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors',
              selected ? 'text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary' : 'text-ink-muted hover:text-ink')}>
            {x.label}{x.count != null && <span className={cx('ml-2 rounded-full px-2 py-0.5 text-[11px]', selected ? 'bg-primary-soft' : 'bg-canvas')}>{x.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Chips<T extends string>({ items, value, onChange }: { items: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(i => (
        <button key={i.id} onClick={() => onChange(i.id)}
          className={cx('h-8 rounded-full border px-3 text-[13px] font-medium transition-colors',
            value === i.id ? 'border-primary-fill bg-primary-fill text-white' : 'border-line bg-surface text-ink-muted hover:border-primary/40 hover:text-ink')}>
          {i.label}{i.count != null && <span className="ml-1.5 opacity-80">{i.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** A details panel on the right. Opening it moves the focus into it; Escape or Close shuts it and gives the focus back to
 * the control that opened it. The page behind stays usable (it is not modal). */
export function SidePanel({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null)
  const titleId = useId()
  // The latest onClose, so callers can pass an inline function without re-attaching the listener on every render.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [open])
  if (!open) return null
  return (
    <aside ref={panel} role="dialog" aria-labelledby={titleId} tabIndex={-1}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[480px] flex-col border-l border-line bg-surface shadow-pop focus:outline-none">
      <header className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
        <div className="min-w-0"><h2 id={titleId} className="break-words text-[17px] font-semibold leading-snug">{title}</h2>{subtitle && <div className="mt-1.5">{subtitle}</div>}</div>
        <button onClick={onClose} className="btn-ghost btn-sm !h-10 !px-2.5" aria-label={t('Close')}><X size={18} /></button>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">{children}</div>
    </aside>
  )
}

export function Empty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-canvas text-ink-muted"><Icon size={22} /></span>
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-ink-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Shown in place of a list while the RAG service answers. */
export function Loading({ text = t('Loading…'), className }: { text?: string; className?: string }) {
  return (
    <div role="status" className={cx('flex items-center justify-center gap-2.5 px-6 py-12 text-sm text-ink-muted', className)}>
      <Loader2 size={18} className="animate-spin text-primary" />{text}
    </div>
  )
}

/** Stands for a number that is still loading, so a count never reads "0" before the answer. */
export function Pending({ className }: { className?: string }) {
  return <span role="status" aria-label={t('Loading')} className={cx('inline-block h-[0.9em] w-8 animate-pulse rounded-md bg-canvas align-middle', className)} />
}

/** A failed request: what happened, and a way to try again. */
export function ErrorNote({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cx('flex flex-wrap items-center gap-3 rounded-ctl bg-bad-soft px-3 py-2 text-sm text-bad-ink', className)}>
      <AlertTriangle size={16} className="shrink-0" aria-hidden /><span className="min-w-0 flex-1 basis-60">{message}</span>
      {onRetry && <button className="btn-ghost btn-sm !text-bad-ink hover:!bg-surface/60" onClick={onRetry}><RotateCw size={14} />{t('Retry')}</button>}
    </div>
  )
}

/** Asks before an action that cannot be undone, or that should be thought over (`tone="primary"`). Escape or Cancel closes
 * it; the focus stays inside it (Tab cycles) and goes back to the opening control on close. */
export function ConfirmDialog({ open, title, text, confirmLabel, busyLabel = t('Deleting…'), tone = 'danger', busy, error, onConfirm, onCancel }: {
  open: boolean; title: string; text: ReactNode; confirmLabel: string; busyLabel?: string; tone?: 'danger' | 'primary'
  busy?: boolean; error?: string; onConfirm: () => void; onCancel: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const ids = useId()
  useEffect(() => {
    if (!open) return
    // Focus Cancel (the safe choice), and give focus back to the button that opened the dialog on close.
    const opener = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && !busy && onCancel()
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])
  // While busy both buttons are disabled: the dialog itself holds the focus so it does not fall back to the page.
  useEffect(() => { if (busy) box.current?.focus() }, [busy])
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const items = [...(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])]
    if (!items.length) { e.preventDefault(); return }
    const first = items[0], last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim/40 p-4" onClick={() => !busy && onCancel()}>
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby={`${ids}-title`} aria-describedby={`${ids}-text`} aria-busy={busy}
        tabIndex={-1} onKeyDown={trap}
        className="card max-h-[calc(100dvh-2rem)] w-full max-w-[440px] overflow-y-auto p-6 shadow-pop focus:outline-none" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <IconTile icon={AlertTriangle} tone={tone === 'danger' ? 'bad' : 'warn'} />
          <div className="min-w-0">
            <h2 id={`${ids}-title`} className="text-[16px] font-semibold leading-snug">{title}</h2>
            <div id={`${ids}-text`} className="mt-1.5 text-sm text-ink-muted">{text}</div>
          </div>
        </div>
        {error && <ErrorNote className="mt-4" message={error} />}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={cancel} className="btn-secondary" onClick={onCancel} disabled={busy}>{t('Cancel')}</button>
          <button className={tone === 'danger' ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}{busy ? busyLabel : confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export function Avatar({ name, size = 36, tone = 'primary' }: { name: string; size?: number; tone?: 'primary' | 'brand' }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return <span className={cx('grid shrink-0 place-items-center rounded-full font-semibold', tone === 'brand' ? 'bg-brand-soft text-brand-deep' : 'bg-primary-soft text-primary')}
    style={{ width: size, height: size, fontSize: size * 0.36 }}>{ini}</span>
}

export function Kpi({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon: LucideIcon; tone?: 'primary' | 'brand' | 'warn' | 'bad' }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3"><IconTile icon={icon} tone={tone} /><span className="text-sm font-medium text-ink-muted">{label}</span></div>
      <div className="mt-4 text-[28px] font-semibold leading-none tracking-tight">{value}</div>
      {sub && <div className="mt-2 text-[13px] text-ink-muted">{sub}</div>}
    </Card>
  )
}
