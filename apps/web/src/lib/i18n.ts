/** Interface language. The English text is the key: `t('Tenders')` returns the French text when French is chosen and a
 * translation exists, and the English text otherwise, so an untranslated string still reads correctly. */
import { FR } from './fr'

export type Lang = 'en' | 'fr'
export const LANGS: { id: Lang; label: string; name: string }[] = [
  { id: 'en', label: 'EN', name: 'English' }, { id: 'fr', label: 'FR', name: 'Français' },
]
/** Window event sent when the interface language changes (the app renders again in the new language). */
export const LANG_CHANGED = 'cstam:lang-changed'
const KEY = 'cstam:lang'

/** The language chosen in this browser, else the browser's own language when it is French, else English. */
function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'fr') return saved
  } catch { /* storage blocked: fall back to the browser language */ }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

let current: Lang = initial()
document.documentElement.lang = current

export const lang = () => current
/** The locale for dates and numbers. */
export const locale = () => current === 'fr' ? 'fr-FR' : 'en-GB'

export function setLang(next: Lang) {
  if (next === current) return
  current = next
  document.documentElement.lang = next
  try { localStorage.setItem(KEY, next) } catch { /* the choice lasts until the page reloads */ }
  window.dispatchEvent(new Event(LANG_CHANGED))
}

/** The text in the current language; `{name}` placeholders are filled from `vars`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  const text = current === 'fr' ? FR[en] ?? en : en
  return vars ? text.replace(/\{(\w+)\}/g, (all, key: string) => key in vars ? fmtVar(vars[key]) : all) : text
}

/** `one` or `other` by the plural rules of the current language (French counts 0 as singular), with `{n}` filled in. */
export function plural(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  return t(new Intl.PluralRules(locale()).select(n) === 'one' ? one : other, { n, ...vars })
}

/** A number written for the current language: "1,250" or "1 250". */
export const num = (n: number) => n.toLocaleString(locale())
const fmtVar = (v: string | number) => typeof v === 'number' ? num(v) : v
