import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import TeamLogo from "@/components/TeamLogo"
import { mentionQuery, matchPlayers, insertMention, displayName } from "@/lib/mentions"
import { loadMentionDirectory } from "@/lib/mentionsApi"

/**
 * A textarea / input with the "@player" picker. Typing "@" + a letter shows up to 8
 * players (crest + name + team); choosing one inserts "@<first> <last> " and reports
 * { player_id, display } through onPick. Esc / tapping away closes it.
 *
 * The host keeps the picks and, after saving, calls setMentions (lib/mentionsApi.js).
 *
 * The list is portalled to <body> with fixed positioning: comment boxes live inside
 * overflow-hidden cards / height animations that would clip an absolutely-placed list.
 */
export default function MentionInput({
  as = "textarea", value, onChange, onPick, maxLength, wrapperClassName = "", inputRef: outerRef, onKeyDown, ...rest
}) {
  const innerRef = useRef(null)
  const ref = outerRef || innerRef
  const [caret, setCaret] = useState(null)
  const [focused, setFocused] = useState(false)
  const [dir, setDir] = useState(null)
  const [active, setActive] = useState(0)
  // The "@" a pick (or Esc) has just closed — don't reopen on it until the caret leaves.
  const [suppressAt, setSuppressAt] = useState(null)

  const q = caret == null ? null : mentionQuery(value, caret)
  const open = focused && !!q && q.start !== suppressAt

  useEffect(() => {
    if (q && !dir) loadMentionDirectory().then(setDir)
  }, [q, dir])
  useEffect(() => { if (q?.start !== suppressAt) setSuppressAt(null) }, [q?.start]) // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = useMemo(
    () => (open && dir ? matchPlayers(dir.players, q.query) : []),
    [open, dir, q?.query], // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => { setActive(0) }, [q?.query])
  const showList = open && suggestions.length > 0

  // Fixed-position box under the field (or above it when the viewport has no room below).
  const [box, setBox] = useState(null)
  useLayoutEffect(() => {
    if (!showList) { setBox(null); return }
    const place = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom
      const up = below < 240 && r.top > below
      const width = Math.min(Math.max(r.width, 240), window.innerWidth - 16)
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
      setBox({ left, width, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) })
    }
    place()
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place) }
  }, [showList]) // eslint-disable-line react-hooks/exhaustive-deps

  const syncCaret = (el) => setCaret(el?.selectionStart ?? null)

  const choose = (player) => {
    const el = ref.current
    const at = caret ?? value.length
    const { text, caret: nextCaret, pick } = insertMention(value, q, at, player)
    const clipped = maxLength ? text.slice(0, maxLength) : text
    onChange(clipped)
    onPick?.(pick)
    setSuppressAt(q.start)
    setCaret(Math.min(nextCaret, clipped.length))
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      try { el.setSelectionRange(nextCaret, nextCaret) } catch { /* input type without selection */ }
    })
  }

  const handleKeyDown = (e) => {
    if (showList) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => (i + 1) % suggestions.length); return }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => (i - 1 + suggestions.length) % suggestions.length); return }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(suggestions[active]); return }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setSuppressAt(q.start); return }
    }
    onKeyDown?.(e)
  }

  const Tag = as
  return (
    <div className={`relative ${wrapperClassName}`}>
      <Tag
        ref={ref}
        value={value}
        onChange={e => { onChange(maxLength ? e.target.value.slice(0, maxLength) : e.target.value); syncCaret(e.target) }}
        onSelect={e => syncCaret(e.target)}
        onKeyDown={handleKeyDown}
        // Warm the player directory on focus so the first "@" doesn't wait on it.
        onFocus={e => { setFocused(true); syncCaret(e.target); loadMentionDirectory() }}
        onBlur={() => setFocused(false)}
        aria-autocomplete="list"
        aria-expanded={showList}
        {...rest}
      />
      {showList && box && createPortal(
        <ul role="listbox" aria-label="תיוג שחקן" dir="rtl" style={{ position: "fixed", ...box }}
          className="z-[60] max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1">
          {suggestions.map((p, i) => {
            const team = dir.teamsMap[p.team_id]
            return (
              <li key={p.id} role="option" aria-selected={i === active}>
                <button type="button"
                  // mousedown, not click: a click would blur the field first and close the list.
                  onMouseDown={e => { e.preventDefault(); choose(p) }}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-right transition-colors ${i === active ? "bg-brand/[0.08] dark:bg-brand/15" : "hover:bg-slate-50 dark:hover:bg-slate-700/60"}`}>
                  <TeamLogo team={team} size={8} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate">{displayName(p)}</span>
                    {team?.name && <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{team.name}</span>}
                  </span>
                  {p.jersey_number != null && <span className="text-[11px] text-slate-400 tabular-nums shrink-0">#{p.jersey_number}</span>}
                </button>
              </li>
            )
          })}
        </ul>,
        document.body,
      )}
    </div>
  )
}
