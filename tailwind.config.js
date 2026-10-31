import colors from 'tailwindcss/colors'

// ─── "Rink" reskin ─────────────────────────────────────────────────────────
// The whole app was built on raw Tailwind scales (slate/orange/emerald/red/amber).
// Rather than hand-migrate ~3,000 call-sites, we REMAP those five scales to the
// new palette here — so every existing utility (bg-slate-800, text-orange-500,
// text-emerald-600 …) instantly renders in the new colors and stays in sync with
// the CSS-var tokens in index.css. A future retune is a one-place edit here.
const navy = {   // was slate — navy-ink neutrals
  50: '246 247 251', 100: '236 238 245', 200: '223 227 238', 300: '200 205 222',
  400: '148 156 182', 500: '100 110 140', 600: '71 82 112', 700: '45 55 82',
  800: '20 27 46', 900: '15 23 41', 950: '13 19 34',
}
const blue = {   // was orange — royal-blue primary
  50: '236 240 252', 100: '223 230 250', 200: '197 209 247', 300: '150 172 250',
  400: '124 147 255', 500: '59 79 196', 600: '46 62 168', 700: '38 52 140',
  800: '30 42 120', 900: '26 36 100', 950: '20 28 78',
}
const green = {  // was emerald — win green
  50: '236 247 240', 100: '214 238 222', 200: '178 222 191', 300: '130 200 152',
  400: '92 186 118', 500: '76 160 90', 600: '62 140 78', 700: '48 112 64',
  800: '38 88 52', 900: '28 64 40', 950: '16 40 26',
}
const red = {    // danger red
  50: '252 236 235', 100: '250 222 220', 200: '245 193 190', 300: '238 150 145',
  400: '232 116 110', 500: '215 84 80', 600: '196 62 58', 700: '160 44 42',
  800: '128 36 34', 900: '96 30 28', 950: '60 20 19',
}
const gold = {   // was amber — champion gold
  50: '251 245 228', 100: '247 236 200', 200: '240 220 150', 300: '232 200 100',
  400: '235 190 80', 500: '229 184 67', 600: '196 154 46', 700: '150 116 32',
  800: '110 84 24', 900: '74 56 18', 950: '48 36 14',
}
// Third place. `orange` is remapped to the brand blue above, so the three podium
// call-sites that reached for orange-* to mean "bronze" all rendered brand blue and
// third place stopped being distinguishable. A scale of its own, deliberately outside
// the five remapped raw scales, so the next brand sweep cannot eat it again.
const bronze = {
  50: '250 243 237', 100: '243 229 214', 200: '230 203 174', 300: '213 172 132',
  400: '190 138 92', 500: '166 111 63', 600: '140 91 50', 700: '112 72 40',
  800: '86 55 31', 900: '62 40 23', 950: '40 26 15',
}
const ramp = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, `rgb(${v})`]))
// The two scales a SEASON palette re-points (see `html.season-classic` in index.css):
// neutrals and the primary. Read through CSS vars so a past season can show in the
// colours it wore at the time; the defaults on :root are the navy/blue ramps above.
const varRamp = (name) => Object.fromEntries(Object.keys(navy).map(k => [k, `rgb(var(--${name}-${k}) / <alpha-value>)`]))

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      // Remap the five raw scales to the Rink palette (see note above).
      colors: {
        slate: varRamp('ramp-neutral'),
        orange: varRamp('ramp-primary'),
        emerald: ramp(green),
        red: ramp(red),
        amber: ramp(gold),
        // ─── Semantic design tokens (CSS vars, see index.css) ───────────────
        // Alpha-capable: bg-surface/60, text-fg-muted, ring-brand/30.
        // Brand accent (canonical entry).
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          hover: 'rgb(var(--brand-hover) / <alpha-value>)',
          fg: 'rgb(var(--brand-fg) / <alpha-value>)',
          strong: 'rgb(var(--brand-strong) / <alpha-value>)',
          light: 'rgb(var(--brand-light) / <alpha-value>)',
          deep: 'rgb(var(--brand-deep) / <alpha-value>)',
        },
        // Surfaces (backgrounds). Three distinct dark values — page/nav/card — must
        // stay separate (collapsing them changes the look).
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',        // card fill: white / slate-800
          page: 'rgb(var(--surface-page) / <alpha-value>)',      // page bg: slate-50 / slate-950
          nav: 'rgb(var(--surface-nav) / <alpha-value>)',        // header + overlay: white / slate-900
          inset: 'rgb(var(--surface-inset) / <alpha-value>)',    // inputs, insets: slate-50 / slate-800
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',  // tab track, ghost hover: slate-100 / slate-800
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',  // active tab: white / slate-700
          chip: 'rgb(var(--surface-chip) / <alpha-value>)',      // neutral chip / VS pill: slate-200 / slate-700
        },
        // Foreground (text). `fg` = body; -strong headings; -soft/-muted/-subtle/-faint
        // descend in emphasis; -inverse stays white in both modes (text on colored fills).
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',             // slate-700 / slate-200
          strong: 'rgb(var(--fg-strong) / <alpha-value>)',       // slate-900 / white
          soft: 'rgb(var(--fg-soft) / <alpha-value>)',           // slate-700 / slate-300
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',         // slate-500 / slate-400
          subtle: 'rgb(var(--fg-subtle) / <alpha-value>)',       // slate-400 / slate-500
          faint: 'rgb(var(--fg-faint) / <alpha-value>)',         // slate-300 / slate-600
          inverse: 'rgb(var(--fg-inverse) / <alpha-value>)',     // white / white
        },
        // Borders + dividers. Header border (slate-200/slate-800) differs from both
        // `line` (slate-200/slate-700) and `line-subtle` (slate-100/slate-800).
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',           // slate-200 / slate-700
          strong: 'rgb(var(--line-strong) / <alpha-value>)',     // slate-200 / slate-600
          subtle: 'rgb(var(--line-subtle) / <alpha-value>)',     // slate-100 / slate-800
          header: 'rgb(var(--line-header) / <alpha-value>)',     // slate-200 / slate-800
        },
        divider: 'rgb(var(--divider) / <alpha-value>)',          // slate-100 / slate-700
        // State / semantic hues — aliased to full Tailwind scales so every shade
        // (bg-success-100, text-success-600, …) keeps working. A restyle repoints
        // the alias. These do NOT flip shade by mode, so keep any `dark:` variant.
        success: ramp(green),
        danger: ramp(red),
        warning: ramp(gold),
        info: colors.blue,
        accent: colors.purple,
        // Harmonized supporting tokens (few hues, one family — see index.css).
        pos: 'rgb(var(--pos) / <alpha-value>)',
        neg: 'rgb(var(--neg) / <alpha-value>)',
        gold: 'rgb(var(--gold) / <alpha-value>)',
        // Podium third place — a full scale like success/danger/warning, because the
        // medal call-sites need a light fill, a dark fill and readable ink on each.
        bronze: ramp(bronze),
        // ─── Floodlight (2026-10-31) — same values as iOS FL.* / Android FL.* ──
        // bg-fl-accent (the ONE amber accent, never body text), text-fl-live, the
        // three card colours, the crest disc, ink for text on a light team colour.
        fl: {
          accent: 'rgb(var(--fl-accent) / <alpha-value>)',
          live: 'rgb(var(--fl-live) / <alpha-value>)',
          blue: 'rgb(var(--fl-blue) / <alpha-value>)',
          yellow: 'rgb(var(--fl-yellow) / <alpha-value>)',
          red: 'rgb(var(--fl-red) / <alpha-value>)',
          disc: 'rgb(var(--fl-disc) / <alpha-value>)',
          inkOnLight: 'rgb(var(--fl-ink-on-light) / <alpha-value>)',
          night: 'rgb(var(--fl-night) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Rubik', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      // Non-color primitives, aliased to today's exact values so a restyle can round
      // corners / soften shadows / retune type from one place. (Additive — nothing
      // references these until call-sites adopt them.)
      fontSize: {
        '3xs': ['10px', { lineHeight: '1' }],
        '2xs': ['11px', { lineHeight: '1' }],
      },
      borderRadius: {
        card: '1.25rem',   // Floodlight card radius 20px
        control: '0.875rem',// Floodlight button radius 14px
        item: '0.5rem',    // rounded-lg — small controls
        chip: '0.375rem',  // rounded-md — chips
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.05)',                 // shadow-sm
        'card-hover': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)', // shadow-md
      },
    },
  },
  plugins: [],
}
