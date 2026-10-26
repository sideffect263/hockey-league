// Custom rink-hockey line icons — one cohesive family (24×24 grid, 2px stroke,
// `currentColor`, rounded caps). The family signature is a small filled "ball"
// accent in the brand color; pass `mono` to make that accent `currentColor` too
// (needed on solid-brand backgrounds like an active nav item). The accent reads
// the live palette via `rgb(var(--brand))`, so it follows light/dark + any restyle.
const O = 'rgb(var(--brand))'

function Svg({ children, className = "w-6 h-6", strokeWidth = 2, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

/**
 * The rink-hockey ball, in place of the football emoji that used to mark a goal
 * (Ariel, 2026-10-20: a football is the wrong sport). Not a line icon like the rest of
 * this family — it is the ball itself: orange, lit from the upper left so it reads as a
 * ball rather than a dot, with a faint rim so it holds up on a pale stat pill. The same
 * ball the two apps draw (BallIcon) and the one on the live-game progress bar.
 *
 * Sized by className like the others; `title` gives it a label where it stands alone.
 */
export function Ball({ className = "w-4 h-4", title, ...props }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden={title ? undefined : "true"}
         role={title ? "img" : undefined} {...props}>
      {title ? <title>{title}</title> : null}
      <defs>
        <radialGradient id="rh-ball" cx="33%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="55%" stopColor="#ea580c" />
          <stop offset="100%" stopColor="#b4410a" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#rh-ball)" />
      <circle cx="12" cy="12" r="9.3" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.4" />
      <circle cx="7.9" cy="7.7" r="2.2" fill="rgba(255,255,255,0.75)" />
    </svg>
  )
}

// The rink from above — "בית / המגרש": boards, center line, faceoff circle, goals.
export function Rink({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="3.4" />
      <line x1="12" y1="6" x2="12" y2="18" />
      <circle cx="12" cy="12" r="2.3" />
      <circle cx="12" cy="12" r="1" fill={a} stroke="none" />
      <path d="M2.5 9.7 h2 v4.6 h-2" />
      <path d="M21.5 9.7 h-2 v4.6 h2" />
    </Svg>
  )
}

// The league table — "טבלה": ranked rows; the leader's marker is the ball.
export function Standings({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" />
      <circle cx="7.2" cy="8.2" r="1.5" fill={a} stroke="none" />
      <path d="M10 8.2 H17" />
      <circle cx="7.2" cy="12" r="1.1" />
      <path d="M10 12 H17" />
      <circle cx="7.2" cy="15.8" r="1.1" />
      <path d="M10 15.8 H14.8" />
    </Svg>
  )
}

// Crossed sticks over the ball — "משחקים": two shafts form an X, blades hook up.
export function Crossed({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <path d="M5.4 5.4 L14.8 14.8 C15.7 15.7 17.2 15.6 17.8 14.6" />
      <path d="M18.6 5.4 L9.2 14.8 C8.3 15.7 6.8 15.6 6.2 14.6" />
      <circle cx="12" cy="18" r="1.7" fill={a} stroke="none" />
    </Svg>
  )
}

// Two team crests (shields) — "קבוצות".
export function Teams({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <path d="M5 4.4 H10 V8.6 C10 10.8 7.5 12.3 7.5 12.3 C7.5 12.3 5 10.8 5 8.6 Z" />
      <path d="M12.2 6.9 H17.2 V11.1 C17.2 13.3 14.7 14.9 14.7 14.9 C14.7 14.9 12.2 13.3 12.2 11.1 Z" />
      <circle cx="14.7" cy="10.5" r="1.4" fill={a} stroke="none" />
    </Svg>
  )
}

// A skating player with the ball — "שחקנים".
export function Player({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <circle cx="8.8" cy="4.6" r="2" />
      <path d="M8.8 6.6 L10.6 12" />
      <path d="M10.6 12 L8 17.6" />
      <path d="M10.6 12 L13.2 16.8" />
      <path d="M9.6 8.4 L15.2 11 L18.4 16.4" />
      <circle cx="19" cy="16.9" r="1.5" fill={a} stroke="none" />
    </Svg>
  )
}

// A referee whistle — "שיפוט".
export function Whistle({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <path d="M3 11 H10.5 a4 4 0 1 1 -3.4 4 H3 a1 1 0 0 1 -1 -1 v-2 a1 1 0 0 1 1 -1 Z" />
      <path d="M6 11 V9 H9.4" />
      <circle cx="11" cy="14" r="1.6" fill={a} stroke="none" />
    </Svg>
  )
}

// Ascending bars topped with the ball — "סטטיסטיקות".
export function Stats({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <line x1="3.5" y1="20" x2="20.5" y2="20" />
      <rect x="5" y="12.5" width="3.4" height="7.5" rx="0.9" />
      <rect x="10.3" y="8.5" width="3.4" height="11.5" rx="0.9" />
      <rect x="15.6" y="5" width="3.4" height="15" rx="0.9" />
      <circle cx="17.3" cy="3" r="1.3" fill={a} stroke="none" />
    </Svg>
  )
}

// A camera — "מדיה".
export function Camera({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <rect x="2.6" y="7" width="18.8" height="12" rx="2.6" />
      <path d="M8 7 L9.4 4.6 H14.6 L16 7" />
      <circle cx="12" cy="13" r="3.3" />
      <circle cx="12" cy="13" r="1.2" fill={a} stroke="none" />
    </Svg>
  )
}

// A pencil — "יוצרי תוכן".
export function Edit({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <path d="M15.5 4.5 L19.5 8.5 L9 19 L5 20 L6 16 Z" />
      <path d="M13.6 6.4 L17.6 10.4" />
      <circle cx="6" cy="18" r="1.1" fill={a} stroke="none" />
    </Svg>
  )
}

// A trophy — "Final Four".
export function Trophy({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <path d="M8 4 H16 V8 A4 4 0 0 1 8 8 Z" />
      <path d="M8 5 H5.8 A1.8 1.8 0 0 0 5.8 8.6 H7" />
      <path d="M16 5 H18.2 A1.8 1.8 0 0 1 18.2 8.6 H17" />
      <path d="M12 12 V15" />
      <path d="M9.5 19 H14.5" />
      <path d="M10 15.2 H14 V19 H10 Z" />
      <circle cx="12" cy="7" r="1.2" fill={a} stroke="none" />
    </Svg>
  )
}

// An archive crate — "ארכיון".
export function Crate(props) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="4.2" rx="1.2" />
      <path d="M4.6 9.2 V18 A1.2 1.2 0 0 0 5.8 19.2 H18.2 A1.2 1.2 0 0 0 19.4 18 V9.2" />
      <path d="M9.4 12.6 H14.6" />
    </Svg>
  )
}

// A coach's clipboard — "ניהול".
export function Clipboard({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <rect x="4.6" y="4.6" width="14.8" height="15.8" rx="2.2" />
      <path d="M9.4 3.2 H14.6 V6.2 H9.4 Z" />
      <path d="M8.2 11 H15.8 M8.2 14.6 H13" />
      <circle cx="15.6" cy="14.6" r="1.3" fill={a} stroke="none" />
    </Svg>
  )
}

// ── Secondary glyphs (scoreboard / judge tools) ──────────────────────────────

// A rink-hockey stick (straight shaft + flat J-hook blade) with the ball.
export function StickBall({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <path d="M17 4.5 L9.4 14.6" />
      <path d="M9.4 14.6 C 8.3 16.4, 8.7 18.6, 11 18.9 L 12.4 19" />
      <circle cx="15" cy="19.4" r="1.7" fill={a} stroke="none" />
    </Svg>
  )
}

// A hockey goal: frame + net, ball tucked in the top corner.
export function Goal({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <path d="M4 7.5 H20 V19 M4 7.5 V19" />
      <path d="M4 12 H20 M4 15.5 H20" opacity="0.35" />
      <path d="M9.3 7.5 V19 M14.7 7.5 V19" opacity="0.35" />
      <circle cx="17" cy="10" r="2" fill={a} stroke="none" />
    </Svg>
  )
}

// A goalie glove catching the ball.
export function Glove({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <path d="M8 20 V11 a4 4 0 0 1 8 0 V20 Z" />
      <path d="M8 14.5 H16" opacity="0.35" />
      <circle cx="12" cy="8.4" r="2" fill={a} stroke="none" />
    </Svg>
  )
}

// A quad skate.
export function Skate({ mono, ...props }) {
  const a = mono ? "currentColor" : O
  return (
    <Svg {...props}>
      <path d="M4 6 V13 h8.5 a4 4 0 0 1 3.7 2.4 L16.5 16 H4.6 a0.6 0.6 0 0 1 -0.6 -0.6 Z" />
      <path d="M4 13 h8.5" opacity="0.35" />
      <path d="M7 16 V17.6 M15 16 V17.6" />
      <circle cx="5.6" cy="19.2" r="1.7" />
      <circle cx="8.4" cy="19.2" r="1.7" />
      <circle cx="13.6" cy="19.2" r="1.7" />
      <circle cx="16.4" cy="19.2" r="1.7" />
      <circle cx="6.2" cy="9" r="1.3" fill={a} stroke="none" />
    </Svg>
  )
}

// Two penalty cards — blue + red (real card colors, semantic).
export function Cards(props) {
  return (
    <Svg {...props}>
      <g transform="rotate(-9 9 12)">
        <rect x="5.5" y="6" width="7" height="12.5" rx="1.4" fill="#38bdf8" stroke="none" />
      </g>
      <g transform="rotate(9 15 12)">
        <rect x="11.5" y="6" width="7" height="12.5" rx="1.4" fill="#ef4444" stroke="none" />
      </g>
    </Svg>
  )
}

export function BlueCard(props) {
  return (
    <Svg {...props}>
      <g transform="rotate(-7 12 12)">
        <rect x="7.5" y="4.5" width="9" height="15" rx="1.6" fill="#38bdf8" stroke="none" />
      </g>
    </Svg>
  )
}
export function RedCard(props) {
  return (
    <Svg {...props}>
      <g transform="rotate(-7 12 12)">
        <rect x="7.5" y="4.5" width="9" height="15" rx="1.6" fill="#ef4444" stroke="none" />
      </g>
    </Svg>
  )
}
