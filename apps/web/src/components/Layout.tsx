import { FormEvent, useEffect, useReducer, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Euro, FileText, Gauge, LayoutDashboard, LayoutTemplate, Library, Moon, Presentation, Search, Settings, Sun } from 'lucide-react'
import { cx } from './ui'
import { allTenders, daysLeft, isOpen, TENDERS_CHANGED } from '../lib/data'
import { lang, LANGS, plural, setLang, t } from '../lib/i18n'
import { setTheme, theme, watchSystemTheme } from '../lib/theme'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tenders', label: 'Tenders', icon: FileText },
  { to: '/knowledge', label: 'Knowledge base', icon: Library },
  { to: '/proposals', label: 'Proposals', icon: Presentation },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/pricing', label: 'Pricing', icon: Euro },
  { to: '/quality', label: 'Quality', icon: Gauge },
]

/** The TendOlive lockup (public/brand/). */
function Logo() {
  return (
    <div className="px-2">
      <img src="/brand/tendolive-logo.svg" alt="TendOlive" width={143} height={32} className="block h-8 w-auto dark:hidden" />
      <img src="/brand/tendolive-logo-reversed.svg" alt="TendOlive" width={143} height={32} className="hidden h-8 w-auto dark:block" />
    </div>
  )
}

/** Light / dark. One button: it shows the mode it switches to, and says so to a screen reader. */
function ThemeSwitch() {
  const [current, setCurrent] = useState(theme)
  useEffect(() => watchSystemTheme(() => setCurrent(theme())), [])
  const dark = current === 'dark'
  const label = dark ? t('Switch to light mode') : t('Switch to dark mode')
  return (
    <button type="button" onClick={() => { const next = dark ? 'light' : 'dark'; setTheme(next); setCurrent(next) }}
      aria-label={label} title={label}
      className="grid h-9 w-9 place-items-center rounded-ctl border border-line text-ink-muted transition-colors hover:text-ink">
      {dark ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
    </button>
  )
}

/** EN | FR. The choice is kept in this browser. */
function LanguageSwitch() {
  const current = lang()
  return (
    <div role="group" aria-label={t('Interface language')} className="flex rounded-ctl border border-line p-0.5">
      {LANGS.map(l => (
        <button key={l.id} type="button" lang={l.id} aria-pressed={current === l.id} title={l.name} onClick={() => setLang(l.id)}
          className={cx('h-8 min-w-9 rounded-[8px] px-2 text-[12px] font-semibold transition-colors',
            current === l.id ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:text-ink')}>
          <span aria-hidden>{l.label}</span><span className="sr-only">{l.name}</span>
        </button>
      ))}
    </div>
  )
}

/** Searches the tenders: opens the Tenders page filtered by the words typed. */
function HeaderSearch() {
  const nav = useNavigate()
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim()
    nav(q ? `/tenders?q=${encodeURIComponent(q)}` : '/tenders')
  }
  return (
    <form role="search" onSubmit={submit} className="relative hidden max-w-md flex-1 md:block">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input name="q" type="search" className="input bg-canvas pl-9 border-transparent" placeholder={t('Search tenders…')} aria-label={t('Search tenders')} />
    </form>
  )
}

export default function Layout() {
  const { pathname } = useLocation()
  // Recount when the tender inbox changes (loaded, deleted or cleared), not only on navigation.
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    window.addEventListener(TENDERS_CHANGED, refresh)
    return () => window.removeEventListener(TENDERS_CHANGED, refresh)
  }, [])
  const urgent = allTenders().filter(x => {
    const d = daysLeft(x.deadline)
    return isOpen(x.status) && d != null && d >= 0 && d <= 7
  }).length
  const urgentLabel = plural(urgent, '{n} open tender due within 7 days', '{n} open tenders due within 7 days')
  return (
    <div className="min-h-screen lg:pl-[248px]">
      <a href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus() }}
        className="sr-only z-50 rounded-ctl bg-primary-fill px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        {t('Skip to content')}</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <Logo />
        <nav className="mt-8 space-y-1" aria-label={t('Main')}>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('flex items-center gap-3 rounded-ctl px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-canvas hover:text-ink')}>
              <Icon size={18} aria-hidden />{t(label)}
              {to === '/tenders' && urgent > 0 && <span className="ml-auto rounded-full bg-warn-soft px-2 text-[11px] font-semibold text-warn-ink" title={urgentLabel}>
                <span aria-hidden>{urgent}</span><span className="sr-only">{urgentLabel}</span></span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-1">
          <NavLink to="/settings" className={({ isActive }) => cx('flex items-center gap-3 rounded-ctl px-3 py-2.5 text-sm font-medium', isActive ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-canvas hover:text-ink')}><Settings size={18} aria-hidden />{t('Settings')}</NavLink>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-line bg-surface/85 px-6 backdrop-blur">
        <nav className="flex min-w-0 gap-1 overflow-x-auto lg:hidden" aria-label={t('Main')}>
          {[...NAV, { to: '/settings', label: 'Settings', end: false }].map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('flex h-10 items-center rounded-ctl px-3 text-[13px] font-medium whitespace-nowrap', isActive ? 'bg-primary-soft text-primary' : 'text-ink-muted')}>{t(label)}</NavLink>
          ))}
        </nav>
        <HeaderSearch />
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <ThemeSwitch />
          <LanguageSwitch />
          <div className="hidden items-center gap-2.5 sm:flex">
            <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-primary-fill text-[12px] font-semibold text-white" aria-hidden>MA</span>
            <span className="text-left leading-tight"><span className="block text-[13px] font-semibold">{t('OliveSoft admin')}</span><span className="block text-[11px] text-ink-muted">{t('Administrator')}</span></span>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} key={pathname} className="mx-auto max-w-[1400px] px-6 py-7 focus:outline-none"><Outlet /></main>
    </div>
  )
}
