/** Light or dark interface. Until the person picks one, the app follows the system setting (and its changes); a pick is
 * kept in this browser. index.html applies the same rule before the first paint, so a dark page never flashes white. */
export type Theme = 'light' | 'dark'
const KEY = 'cstam:theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function saved(): Theme | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export const theme = (): Theme => saved() ?? (media.matches ? 'dark' : 'light')

function apply() {
  document.documentElement.classList.toggle('dark', theme() === 'dark')
}

export function setTheme(next: Theme) {
  try { localStorage.setItem(KEY, next) } catch { /* the choice lasts until the page reloads */ }
  document.documentElement.classList.toggle('dark', next === 'dark')
}

/** Follows the system setting while nothing is picked; returns the cleanup. */
export function watchSystemTheme(onChange: () => void) {
  const changed = () => { if (!saved()) { apply(); onChange() } }
  media.addEventListener('change', changed)
  return () => media.removeEventListener('change', changed)
}

apply()
