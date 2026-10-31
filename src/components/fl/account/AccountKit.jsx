/**
 * Floodlight account kit (web): the shared pieces of the account / onboarding /
 * notifications area — grouped settings rows (board MyPage), the switch, chips, the
 * three-way segment, a sheet that is a bottom sheet on phones and a centred dialog on
 * desktop, and the onboarding page chrome (board OnbWho: step bar, back, title, pinned
 * CTA). Same pieces as iOS FLAccountKit.swift. Area-only: not for other areas.
 */
import { useEffect, useId, useRef } from "react"
import { Link } from "react-router-dom"
import { BrandIcon } from "@/components/icons/BrandIcons"

/* ---------------------------------------------------------------- line glyphs */

/** Simple line icons for UI chrome rows (board MyPage `L`). */
export const LINE = {
  lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3",
  key: "M14 10a4 4 0 1 0-4 4l-6 6M8 18l2 2M10 16l2 2",
  exit: "M10 17l-5-5 5-5M5 12h11M14 4h5v16h-5",
  block: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM6 6l12 12",
  down: "M12 4v12M7 11l5 5 5-5M5 20h14",
  mail: "M3 5h18v14H3zM3 7l9 6 9-6",
  doc: "M6 3h9l3 3v15H6zM9 12h6M9 16h4",
  shield: "M12 3l7 3v5c0 4.5-3 8-7 10c-4-2-7-5.5-7-10V6z",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01",
  moon: "M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z",
  plus: "M12 5v14M5 12h14",
  phone: "M7 3h10v18H7zM11 18h2",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  unlink: "M9 15l-2 2a3 3 0 0 1-4-4l2-2M15 9l2-2a3 3 0 0 1 4 4l-2 2M8 4v3M4 8h3M16 20v-3M20 16h-3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6L6 18",
  back: "M9 5l7 7-7 7",          // RTL "back" = points right
  chev: "M15 6l-6 6 6 6",        // RTL "forward" = points left
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  cal: "M4 6h16v14H4zM4 10h16M8.5 3v4M15.5 3v4",
  search: "M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM16 16l4 4",
  edit: "M4 20h4L19 9l-4-4L4 16z",
  history: "M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4l3 2",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4",
}

export function Glyph({ d, size = 20, stroke = 1.9, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d={LINE[d] || d} />
    </svg>
  )
}

/* ---------------------------------------------------------------- tones */

const CHIP = {
  ok: "bg-[#DDE9DF] text-[#1B5E2A] dark:bg-emerald-900/40 dark:text-emerald-200",
  warn: "bg-[#F6EBD3] text-[#7A5200] dark:bg-amber-900/35 dark:text-amber-200",
  err: "bg-red-100 text-[#B4231A] dark:bg-red-900/40 dark:text-red-200",
  quiet: "bg-surface-page text-fg-muted",
  accent: "bg-fl-accent text-fl-inkOnLight",
  ink: "bg-fg-strong text-fl-accent dark:bg-[#0B0F14]",
  blue: "bg-[#E4ECFB] text-[#0E3394] dark:bg-blue-900/40 dark:text-blue-200",
}

export function AccChip({ tone = "quiet", children, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 text-[11.5px] font-extrabold px-2 py-1 rounded-lg leading-none ${CHIP[tone] || CHIP.quiet} ${className}`}>
      {children}
    </span>
  )
}

/** The small "חדש" mark the boards put on a row that is new in this version. */
export function NewMark() {
  return <span className="text-[10px] font-extrabold px-1.5 py-[2px] rounded-md bg-fg-strong text-fl-accent dark:bg-[#0B0F14]">חדש</span>
}

export const errText = "text-[#B4231A] dark:text-[#FF8A7A]"

/* ---------------------------------------------------------------- buttons */

const BTN = {
  ink: "bg-brand text-brand-fg hover:bg-brand-hover",
  quiet: "bg-surface-page text-fg-strong hover:bg-surface-sunken",
  outline: "border border-line-strong text-fg-strong hover:bg-surface-page",
  danger: "bg-[#B4231A] text-white hover:bg-[#9A1D15]",
  ghost: "text-fg-muted hover:text-fg-strong hover:bg-surface-page",
}

/** Row-size button (≥ 44px hit area: 40px visual + margin). */
export function AccButton({ tone = "ink", className = "", children, ...rest }) {
  return (
    <button type="button" {...rest}
      className={`inline-flex items-center justify-center gap-1.5 h-11 min-w-[44px] px-3.5 rounded-xl text-[13.5px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent ${BTN[tone] || BTN.ink} ${className}`}>
      {children}
    </button>
  )
}

/** Full-width call to action (boards: 52px, radius 16). */
export function CTA({ tone = "ink", className = "", children, ...rest }) {
  return (
    <button type="button" {...rest}
      className={`w-full h-[52px] rounded-2xl inline-flex items-center justify-center gap-2 text-[15.5px] font-bold transition-colors disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page ${BTN[tone] || BTN.ink} ${className}`}>
      {children}
    </button>
  )
}

export function Spinner({ className = "w-4 h-4" }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/* ---------------------------------------------------------------- switch + segment */

/** Board switch: 52×30 track, 24px knob; on = green. A real role="switch" button. */
export function AccSwitch({ on, onChange, label, disabled = false }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled}
      onClick={() => onChange?.(!on)}
      className="relative shrink-0 h-11 w-[52px] flex items-center disabled:opacity-55 focus-visible:outline-none group">
      <span className={`relative block w-[52px] h-[30px] rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-fl-accent ${on ? "bg-[#2E9A44]" : "bg-[#C9C4B9] dark:bg-[#3A4350]"}`}>
        <span className={`absolute top-[3px] w-6 h-6 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none ${on ? "right-[3px]" : "right-[3px] -translate-x-[22px]"}`} />
      </span>
    </button>
  )
}

/** Three-way segmented control (מראה: בהיר / כהה / לפי המכשיר). */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label}
      className="grid gap-0 bg-surface-page rounded-[14px] p-[3px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(o => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`h-11 rounded-[11px] text-[13.5px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent ${
              on ? "bg-surface text-fg-strong shadow-[0_1px_4px_rgba(0,0,0,.12)] dark:bg-[#2A323D]" : "text-fg-muted hover:text-fg-strong"}`}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* ---------------------------------------------------------------- groups + rows */

/** A titled group of rows on one card (board MyPage: 13px label, radius 18 card). */
export function AccGroup({ title, children, className = "", footer }) {
  const id = useId()
  return (
    <section aria-labelledby={title ? id : undefined} className={className}>
      {title && <h2 id={id} className="mx-1.5 mb-2 text-[13px] font-extrabold text-fg-muted">{title}</h2>}
      <div className="bg-surface rounded-[18px] overflow-hidden divide-y divide-line">
        {children}
      </div>
      {footer && <p className="mx-1.5 mt-2 text-[12px] leading-relaxed text-fg-muted">{footer}</p>}
    </section>
  )
}

/** The leading icon: a brand art (32px) or a line glyph in a 32px tile. */
export function RowIcon({ brand, line, tone }) {
  if (brand) return <BrandIcon name={brand} variant="large" className="w-8 h-8 object-contain" />
  if (line) {
    return (
      <span className={`w-8 h-8 shrink-0 rounded-[10px] flex items-center justify-center ${tone === "danger" ? "bg-red-100 text-[#B4231A] dark:bg-red-900/40 dark:text-[#FF8A7A]" : "bg-surface-page text-fg-strong"}`}>
        <Glyph d={line} size={18} />
      </span>
    )
  }
  return null
}

/**
 * One settings row. Navigates when `to` (in-app) / `href` (external) / `onClick` is given
 * and shows a chevron then, unless `trailing` holds a control. `children` render under the
 * row (an expanded editor), inside the same divider block.
 */
export function AccRow({ brand, line, iconTone, label, sub, tone, isNew, trailing, to, href, onClick, chevron, children, labelId, className = "" }) {
  const nav = !!(to || href || onClick)
  const showChev = chevron ?? (nav && !trailing)
  const body = (
    <>
      <RowIcon brand={brand} line={line} tone={iconTone} />
      <span className="flex-1 min-w-0 flex flex-col gap-0.5 text-start">
        <span id={labelId} className={`flex items-center gap-1.5 text-[14.5px] font-bold leading-snug ${tone === "muted" ? "text-fg-muted" : tone === "danger" ? errText : "text-fg-strong"}`}>
          <span className="min-w-0 break-words">{label}</span>
          {isNew && <NewMark />}
        </span>
        {sub && <span className="text-[12px] leading-[1.4] text-fg-muted break-words">{sub}</span>}
      </span>
      {trailing}
      {showChev && <Glyph d="chev" size={18} className="text-fg-subtle" />}
    </>
  )
  const rowCls = `flex items-center gap-3 min-h-[58px] px-3.5 py-2 ${className}`
  const navCls = `${rowCls} w-full transition-colors hover:bg-surface-page/70 focus-visible:outline-none focus-visible:bg-surface-page focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fl-accent`
  let row
  if (to) row = <Link to={to} className={navCls}>{body}</Link>
  else if (href) row = <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className={navCls}>{body}</a>
  else if (onClick) row = <button type="button" onClick={onClick} className={navCls}>{body}</button>
  else row = <div className={rowCls}>{body}</div>
  if (!children) return row
  return <div>{row}{children}</div>
}

/* ---------------------------------------------------------------- sheet / dialog */

/**
 * Modal surface: a bottom sheet on phones (slides up, safe-area aware) and a centred
 * dialog from 640px. Esc + backdrop close, the page behind stops scrolling, focus moves
 * in and comes back. z-[100]: above the phone tab bar (z-40) and the + fan (z-60/70).
 */
export function Sheet({ open = true, onClose, title, titleId, children, footer, wide = false, dark = false, closeLabel = "סגירה", hideTitle = false }) {
  const panel = useRef(null)
  const autoId = useId()
  const tid = titleId || autoId
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    const onKey = (e) => { if (e.key === "Escape") onClose?.() }
    const prevOverflow = document.body.style.overflow
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    const t = setTimeout(() => {
      const el = panel.current?.querySelector("[data-autofocus]") || panel.current
      el?.focus?.({ preventScroll: true })
    }, 30)
    return () => {
      clearTimeout(t)
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
      prev?.focus?.({ preventScroll: true })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-6" dir="rtl">
      <div className="absolute inset-0 bg-black/55 fl-fade-in" onClick={onClose} aria-hidden="true" />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={title ? tid : undefined} tabIndex={-1}
        className={`relative w-full ${wide ? "sm:max-w-lg" : "sm:max-w-md"} max-h-[92dvh] flex flex-col rounded-t-[26px] sm:rounded-[26px] shadow-2xl outline-none fl-sheet-in sm:animate-none ${
          dark ? "bg-[#070B10] text-white" : "bg-surface-page text-fg-strong"}`}>
        <div className="sm:hidden mx-auto mt-2 w-10 h-1.5 rounded-full bg-black/15 dark:bg-white/20" aria-hidden="true" />
        {(title || onClose) && (
          <div className="flex items-center gap-2 px-4 pt-2 sm:pt-4 pb-1 min-h-[52px]">
            {title && <h2 id={tid} className={`flex-1 min-w-0 text-[20px] font-extrabold leading-tight ${hideTitle ? "sr-only" : ""}`}>{title}</h2>}
            {!title && <span className="flex-1" />}
            {onClose && (
              <button type="button" onClick={onClose} aria-label={closeLabel}
                className={`size-11 -me-2 rounded-full flex items-center justify-center transition-colors ${dark ? "text-white/75 hover:bg-white/10" : "text-fg-muted hover:bg-surface"}`}>
                <Glyph d="close" size={18} stroke={2.2} />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer && <div className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-line/70">{footer}</div>}
        {!footer && <div className="pb-[env(safe-area-inset-bottom)]" />}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- form fields */

export const inputCls = "w-full h-12 bg-surface border border-line rounded-[14px] px-3.5 text-[15px] text-fg-strong placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-fl-accent/60 focus:border-fg-strong transition-colors"

export function Field({ label, hint, htmlFor, children, error }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={htmlFor} className="text-[13px] font-bold text-fg-strong">{label}</label>}
      {children}
      {hint && !error && <p className="text-[12px] text-fg-muted leading-relaxed">{hint}</p>}
      {error && <p className={`text-[12.5px] font-semibold ${errText}`}>{error}</p>}
    </div>
  )
}

export function Notice({ tone = "warn", children, className = "" }) {
  const t = {
    warn: "bg-[#F6EBD3] text-[#7A5200] dark:bg-amber-900/30 dark:text-amber-100",
    err: "bg-red-50 text-[#B4231A] dark:bg-red-950/40 dark:text-[#FF8A7A]",
    ok: "bg-[#DDE9DF] text-[#1B5E2A] dark:bg-emerald-900/35 dark:text-emerald-100",
    info: "bg-surface text-fg-strong",
  }[tone]
  return <div role={tone === "err" ? "alert" : undefined} className={`rounded-[14px] px-3.5 py-3 text-[13px] leading-relaxed ${t} ${className}`}>{children}</div>
}

/* ---------------------------------------------------------------- onboarding chrome */

/** Step bar: one segment per step, filled up to `step` (boards OnbWho …). */
export function StepBar({ step, total }) {
  return (
    <div className="flex-1 flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} aria-label={`שלב ${step} מתוך ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < step ? "bg-fg-strong" : "bg-surface-sunken"}`} />
      ))}
    </div>
  )
}

/**
 * One onboarding page: top row (back · step bar / kicker · later), a 31px title, the
 * content, and the CTA pinned at the bottom of the panel.
 */
export function OnbPage({ step, kicker, kickerIcon, title, subtitle, onBack, onClose, children, footer, titleId }) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 pt-3 pb-5">
        <div className="flex items-center gap-3 min-h-[44px]">
          {onBack && (
            <button type="button" onClick={onBack} aria-label="חזרה"
              className="size-11 -ms-3 shrink-0 rounded-full flex items-center justify-center text-fg-strong hover:bg-surface">
              <Glyph d="back" size={21} stroke={2.1} />
            </button>
          )}
          {step && <StepBar step={step[0]} total={step[1]} />}
          {kicker && (
            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-surface-sunken text-[12.5px] font-extrabold text-fg-strong">
              {kickerIcon && <BrandIcon name={kickerIcon} className="w-4 h-4" />}{kicker}
            </span>
          )}
          {!step && <span className="flex-1" />}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="אחר כך"
              className="size-11 -me-2 shrink-0 rounded-full flex items-center justify-center text-fg-muted hover:bg-surface">
              <Glyph d="close" size={16} stroke={2.4} />
            </button>
          )}
        </div>
        <h2 id={titleId} className="mt-3.5 text-[29px] sm:text-[31px] font-black leading-[1.08] text-fg-strong text-balance">{title}</h2>
        {subtitle && <p className="mt-1.5 text-[15px] leading-relaxed text-fg-muted">{subtitle}</p>}
        <div className="mt-4">{children}</div>
      </div>
      {footer && (
        <div className="shrink-0 px-4 sm:px-6 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-surface-page flex flex-col items-stretch gap-1.5 text-center">
          {footer}
        </div>
      )}
    </div>
  )
}

/** A checkbox square (boards: 24px, radius 7). */
export function CheckBox({ on, size = 24 }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size }}
      className={`shrink-0 rounded-[7px] flex items-center justify-center transition-colors ${on ? "bg-fl-accent text-fl-inkOnLight" : "border-2 border-line-strong bg-surface"}`}>
      {on && <Glyph d="check" size={size * 0.7} stroke={3} />}
    </span>
  )
}

/** A selectable card (OnbWho roles, OnbRef jobs): icon box, title + sub, a checkbox. */
export function ChoiceCard({ title, subtitle, icon, on, onToggle, disabled }) {
  return (
    <button type="button" role="checkbox" aria-checked={!!on} onClick={onToggle} disabled={disabled}
      className={`w-full flex items-center gap-3.5 p-3.5 rounded-[18px] bg-surface text-start border-2 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent ${on ? "border-fg-strong" : "border-transparent hover:border-line-strong"}`}>
      {icon && (
        <span className={`w-12 h-12 shrink-0 rounded-[14px] flex items-center justify-center transition-colors ${on ? "bg-fg-strong dark:bg-[#0B0F14]" : "bg-surface-page"}`}>
          <BrandIcon name={icon} variant="large" className="w-8 h-8" />
        </span>
      )}
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-[16px] font-extrabold text-fg-strong">{title}</span>
        {subtitle && <span className="text-[13px] text-fg-muted leading-snug">{subtitle}</span>}
      </span>
      <CheckBox on={on} />
    </button>
  )
}
