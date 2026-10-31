// Single source of truth for the league's brand color outside of CSS.
// Anything that needs a literal hex (canvas poster rendering, inline `style`
// fallbacks, SVG icon fills) imports from here instead of retyping the value.
// Keep in sync with --brand / --brand-hover in src/index.css.
export const BRAND_COLOR = '#11161D'        // Floodlight ink — matches --brand (light)
export const BRAND_COLOR_HOVER = '#2A323D'  // matches --brand-hover
// The one Floodlight accent (amber): indicators, "your team", the + button. Never body text.
export const FL_ACCENT = '#F2B233'
export const FL_LIVE = '#E0362C'
export const FL_NIGHT = '#0B0F14'

// Back-compat aliases: the constants keep their historical "ORANGE" name so the
// ~6 importers don't churn, but both now resolve to the current royal-blue brand
// (the app was re-skinned from orange to the "Rink" navy/blue palette).
export const BRAND_ORANGE = BRAND_COLOR
export const BRAND_ORANGE_HOVER = BRAND_COLOR_HOVER
