// The league's own icon set (brand-icons/, approved one meaning at a time from 2026-10-26),
// in place of emoji and lucide glyphs. Source of truth is ~/…/hockey/brand-icons; the SVGs
// in ./brand are a copy of it, README.md there maps each file to what it replaces.
//
// Every meaning has a `-small` drawing (16–24px: pills, rows, buttons) and most have a
// `-large` one (32px+: headers, empty states). <BrandIcon name="trophy" /> picks by the
// rendered size read off className (w-8 / size-8 and up → large) unless `variant` says.
//
// Small line icons stroke in `currentColor`, so they are inlined as <svg> and tint with the
// text colour like the lucide icons they replace. Large ones are full colour and load as
// <img>. Inlined files get their gradient ids prefixed so two icons can't steal each
// other's `url(#id)`.
const RAW = import.meta.glob(["./brand/*-small.svg", "./brand/rink-large.svg"], { query: "?raw", import: "default", eager: true })
const URLS = import.meta.glob("./brand/*.svg", { query: "?url", import: "default", eager: true })

const key = (p) => p.slice("./brand/".length, -".svg".length)
const urls = Object.fromEntries(Object.entries(URLS).map(([p, u]) => [key(p), u]))
const inline = {}
for (const [p, src] of Object.entries(RAW)) {
  const k = key(p)
  const svg = src.replace(/id="([^"]+)"/g, `id="bi-${k}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#bi-${k}-$1)`)
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] || "0 0 24 24"
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")
  inline[k] = { viewBox, body }
}

// Nothing renders below 16px (min-w-4): the small drawings are made for 16–24px and
// lose their detail under that.
// Tailwind w-N / size-N in quarter-rems; 8 = 32px, the README's large threshold.
function isLargeClass(className = "") {
  const m = /(?:^|\s)(?:size|w)-(\d+(?:\.\d+)?)(?:\s|$)/.exec(className)
  return m ? parseFloat(m[1]) >= 8 : false
}

function resolve(name, large) {
  const order = large ? [`${name}-large`, name, `${name}-small`] : [`${name}-small`, name, `${name}-large`]
  return order.find(k => inline[k] || urls[k])
}

// `tile`: the full-colour large art on its own light card, so the dark-blue parts of a
// drawing (player poses, crests) don't sink into the dark theme's background. Used for
// page-header icons; className then sizes the tile, the art fills ~80% of it.
export function BrandTile({ name, className = "w-10 h-10", title }) {
  return (
    <span className={`inline-grid place-items-center shrink-0 rounded-xl bg-white text-slate-800 ring-1 ring-black/5 shadow-sm dark:bg-slate-100 dark:ring-white/10 ${className}`}>
      <BrandIcon name={name} variant="large" className="w-4/5 h-4/5" title={title} />
    </span>
  )
}

export function BrandIcon({ name, variant, className = "w-4 h-4", size, title, style,
  // lucide / HockeyIcons props that mean nothing here
  strokeWidth, absoluteStrokeWidth, fill, color, mono, ...props }) {
  const large = variant ? variant === "large" : (size ? size >= 32 : isLargeClass(className))
  const k = resolve(name, large)
  if (!k) return null
  const st = size ? { width: size, height: size, ...style } : style
  const st2 = color ? { color, ...st } : st
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": props["aria-label"] ? undefined : "true" }
  if (inline[k]) {
    const { viewBox, body } = inline[k]
    return <svg xmlns="http://www.w3.org/2000/svg" viewBox={viewBox} className={`shrink-0 min-w-4 min-h-4 ${className}`} style={st2}
                {...a11y} {...props} dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : "") + body }} />
  }
  return <img src={urls[k]} alt={title || props["aria-label"] || ""} draggable={false}
              className={`shrink-0 min-w-4 min-h-4 inline-block object-contain ${className}`} style={st2} {...props} />
}

const mk = (name, displayName) => {
  const C = (props) => <BrandIcon name={name} {...props} />
  C.displayName = displayName
  return C
}

// Drop-ins for the lucide icons of the same meaning (same className/size API), so a file
// switches by changing its import line, not its JSX.
export const Trophy = mk("trophy", "Trophy")
export const Award = mk("trophy", "Award")
export const Crown = mk("crown", "Crown")
export const Captain = mk("captain", "Captain")
export const Flame = mk("hot", "Flame")
export const Calendar = mk("calendar", "Calendar")
export const CalendarDays = mk("calendar", "CalendarDays")
export const CalendarClock = mk("calendar-time", "CalendarClock")
export const CalendarCheck = mk("calendar-ok", "CalendarCheck")
export const CalendarPlus = mk("calendar-add", "CalendarPlus")
export const CalendarOff = mk("calendar-busy", "CalendarOff")
export const CalendarX = mk("calendar-busy", "CalendarX")
export const CalendarMove = mk("calendar-move", "CalendarMove")
export const Clock = mk("time", "Clock")
export const GameClock = mk("clock", "GameClock")
export const Timeout = mk("timeout", "Timeout")
export const Break = mk("break", "Break")
export const History = mk("history", "History")
export const Hourglass = mk("waiting", "Hourglass")
export const Reminder = mk("reminder", "Reminder")
export const MapPin = mk("location", "MapPin")
export const Venue = mk("venue", "Venue")
export const Gavel = mk("referee", "Gavel")
export const Referee = mk("referee", "Referee")
export const Officials = mk("officials", "Officials")
export const Medic = mk("medic", "Medic")
export const Live = mk("live", "Live")
export const Broadcast = mk("broadcast", "Broadcast")
export const MonitorPlay = mk("watch", "MonitorPlay")
export const Film = mk("highlights", "Film")
export const VideoLibrary = mk("video-library", "VideoLibrary")
export const PlayBadge = mk("play", "PlayBadge")
export const GoalIcon = mk("goal", "GoalIcon")
export const Save = mk("save", "Save")
export const Goalkeeper = mk("goalkeeper", "Goalkeeper")
export const BlueCard = mk("card-blue", "BlueCard")
export const YellowCard = mk("card-yellow", "YellowCard")
export const RedCard = mk("card-red", "RedCard")
export const Cards = mk("cards", "Cards")
export const HatTrick = mk("hattrick", "HatTrick")
export const OgBadge = mk("og-badge", "OgBadge")
export const MatchFallback = mk("match-fallback", "MatchFallback")
export const RinkIcon = mk("rink", "RinkIcon")
export const PlayerIcon = mk("player-pose-1", "PlayerIcon")
export const TeamsIcon = mk("teams", "TeamsIcon")
export const TeamIcon = mk("team", "TeamIcon")
export const Squad = mk("squad", "Squad")
export const Person = mk("person", "Person")
export const Profile = mk("profile", "Profile")
export const PersonAdd = mk("person-add", "PersonAdd")
export const PersonFollow = mk("person-follow", "PersonFollow")
export const PersonFollowing = mk("person-following", "PersonFollowing")
export const PersonClaim = mk("person-claim", "PersonClaim")
export const PersonRemove = mk("person-remove", "PersonRemove")
export const Coach = mk("coach", "Coach")
export const Medical = mk("medical", "Medical")
export const Injury = mk("injury", "Injury")

// Round 3 (the final 154-file set): the rest of README's meanings.
export const LikeOn = mk("like-on", "LikeOn")
export const LikeOff = mk("like-off", "LikeOff")
export const Comment = mk("comment", "Comment")
export const Tag = mk("tag", "Tag")
export const Untag = mk("untag", "Untag")
export const Share = mk("share", "Share")
export const ShareAlt = mk("share-alt", "ShareAlt")
export const Bell = mk("bell", "Bell")
export const BellNew = mk("bell-new", "BellNew")
export const BellOff = mk("bell-off", "BellOff")
export const Announce = mk("announce", "Announce")
export const Celebrate = mk("celebrate", "Celebrate")
export const Birthday = mk("birthday", "Birthday")
export const NewBadge = mk("new", "NewBadge")
export const Sparkle = mk("sparkle", "Sparkle")
export const GameForm = mk("game-form", "GameForm")
export const Sign = mk("sign", "Sign")
export const ClipboardIcon = mk("clipboard", "ClipboardIcon")
export const Checklist = mk("checklist", "Checklist")
export const EditIcon = mk("edit", "EditIcon")
export const DocumentIcon = mk("document", "DocumentIcon")
export const Report = mk("report", "Report")
export const Foul = mk("foul", "Foul")
export const Star = mk("star", "Star")
export const StarOff = mk("star-off", "StarOff")
export const Mvp = mk("mvp", "Mvp")
export const Table = mk("table", "Table")
export const MovedUp = mk("moved-up", "MovedUp")
export const MovedDown = mk("moved-down", "MovedDown")
export const Market = mk("market", "Market")
export const Coin = mk("coin", "Coin")
export const Wallet = mk("wallet", "Wallet")
export const TrendUp = mk("trend-up", "TrendUp")
export const TrendDown = mk("trend-down", "TrendDown")
export const StatsIcon = mk("stats", "StatsIcon")
export const CloseGame = mk("close-game", "CloseGame")
export const Verified = mk("verified", "Verified")
export const Admin = mk("admin", "Admin")
export const Manage = mk("manage", "Manage")
export const Approved = mk("approved", "Approved")
export const ApprovedStatus = mk("approved-status", "ApprovedStatus")
export const Rejected = mk("rejected", "Rejected")
export const Declined = mk("declined", "Declined")
export const Warning = mk("warning", "Warning")
export const InfoIcon = mk("info", "InfoIcon")
export const Help = mk("help", "Help")
export const Loan = mk("loan", "Loan")
export const JoinTeam = mk("join-team", "JoinTeam")
export const AppUpdate = mk("app-update", "AppUpdate")
export const TestGame = mk("test-game", "TestGame")

// The four traced player poses: 1 stick out front, 2 stride, 3 ready, 4 lunge.
export function PlayerPose({ pose = 1, ...props }) {
  return <BrandIcon name={`player-pose-${pose}`} {...props} />
}

// The referee holding up the card, for a card moment (large art only).
export function RefereeCard({ color: c, ...props }) {
  return <BrandIcon name={`referee-${c}`} variant="large" {...props} />
}

const MEDAL = ["medal-1", "medal-2", "medal-3"]
// Podium medal for 0-based rank (0..2); null past the podium.
export function Medal({ rank, ...props }) {
  return MEDAL[rank] ? <BrandIcon name={MEDAL[rank]} {...props} /> : null
}

// A card by colour key as stored in game events / stats: blue | yellow | red.
export function PenaltyCard({ color: c, ...props }) {
  return <BrandIcon name={`card-${c}`} {...props} />
}
