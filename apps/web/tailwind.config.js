/** TendOlive design tokens (see docs/design/Product_UX_and_Design_System.md).
 * Each colour is a CSS variable (src/index.css) holding "R G B", so a theme only remaps the variables: light on :root,
 * dark on html.dark. Roles: plain = text, icons and chart marks; -soft = tinted backgrounds; -deep = text on -soft;
 * -fill / -strong = solid backgrounds that carry white text (they stay dark enough in both themes). */
const v = name => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: v('primary'), hover: v('primary-hover'), soft: v('primary-soft'), deep: v('primary-deep'), fill: v('primary-fill'), strong: v('primary-strong') },
        // TendOlive teal, a deeper step of the logo's mint-to-cyan gradient: covered, proven, Go
        brand: { DEFAULT: v('brand'), soft: v('brand-soft'), deep: v('brand-deep'), strong: v('brand-strong') },
        ink: { DEFAULT: v('ink'), muted: v('ink-muted'), faint: v('ink-faint') },  // faint: icons and borders only, never text
        canvas: v('canvas'),
        surface: v('surface'),
        scrim: v('scrim'),
        line: { DEFAULT: v('line'), strong: v('line-strong') },  // strong: closed / inactive data marks
        warn: { DEFAULT: v('warn'), soft: v('warn-soft'), ink: v('warn-ink') },
        bad: { DEFAULT: v('bad'), soft: v('bad-soft'), ink: v('bad-ink'), strong: v('bad-strong') },
      },
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '16px', ctl: '10px' },
      boxShadow: { card: '0 1px 2px rgb(var(--shadow) / 0.06), 0 1px 1px rgb(var(--shadow) / 0.03)', pop: '0 12px 40px rgb(var(--shadow) / 0.16)' },
    },
  },
  plugins: [],
}
