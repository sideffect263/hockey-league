import { Shield, Code2 } from "lucide-react"
import { EditIcon as PenSquare, Verified as BadgeCheck, Person as UserCircle, Gavel, BrandIcon, Admin, Manage, Medic, Coach } from "@/components/icons/BrandIcons"

// Single source of truth for how a league role renders as a badge, so /me, the
// player page and feed post authors all show the same label/icon/color per role.
// Labels mirror ROLE_LABEL in src/lib/roles.js (kept human here for the UI).
export const ROLE_BADGE = {
  // admin=blue / coach=gold / player=green come from the palette remap (orange→blue,
  // amber→gold, emerald→green). judge + content_editor use tuned indigo/teal so the
  // whole role set harmonizes with the navy+blue+gold system (no stray purple/sky).
  admin:          { label: "מנהל",      icon: Admin,         cls: "bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-light" },
  league_manager: { label: "מנהל ליגה", icon: Manage,        cls: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300" },
  judge:          { label: "שופט",      icon: Gavel,         cls: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300" },
  medic:          { label: "חובש",      icon: Medic,         cls: "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300" },
  coach:          { label: "מאמן",      icon: Coach,         cls: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" },
  content_editor: { label: "עורך תוכן", icon: PenSquare,     cls: "bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300" },
  developer:      { label: "מפתח/ת",    icon: Code2,         cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" },
  player:         { label: "שחקן/ית",   icon: BadgeCheck,    cls: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" },
  guest:          { label: "אורח/ת",    icon: UserCircle,    cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
}

// The order badges appear in when a user holds several roles.
const ORDER = ["admin", "league_manager", "judge", "medic", "coach", "content_editor", "developer", "player", "guest"]

/**
 * Turn a set of role signals into a de-duplicated, ordered list of badge items.
 * `roles` is an array of user_roles rows ({ role, team_id }) or plain role strings.
 * `isAdmin` / `isPlayer` are the out-of-band signals (admin lives in admin_users;
 * "player" comes from a profiles↔players link, not a user_roles row).
 * Pass `teamsMap` to append a coach's team name; pass `guestFallback` to show
 * "אורח/ת" when the user holds no role at all.
 */
export function deriveRoleItems({ roles = [], isAdmin = false, isPlayer = false, teamsMap = null, guestFallback = false } = {}) {
  // Admin supersedes every granted role (admin already implies judge/coach/editor
  // powers), so an admin shows only the "מנהל" badge.
  if (isAdmin) return [{ role: "admin", team: null }]
  const items = []
  const seen = new Set()
  const push = (role, team_id) => {
    if (!ROLE_BADGE[role] || seen.has(role)) return
    seen.add(role)
    const team = team_id && teamsMap ? (teamsMap[team_id]?.name || null) : null
    items.push({ role, team })
  }
  for (const r of roles) {
    const role = typeof r === "string" ? r : r?.role
    const team_id = typeof r === "string" ? null : r?.team_id
    if (role) push(role, team_id)
  }
  if (isPlayer) push("player")
  if (guestFallback && items.length === 0) push("guest")
  return items.sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role))
}

// One badge pill. `size="sm"` is the compact variant used inline next to a name.
export function RoleBadge({ role, team, size = "md", className = "" }) {
  const def = ROLE_BADGE[role]
  if (!def) return null
  const Icon = def.icon
  const sizeCls = size === "sm"
    ? "text-[10px] px-1.5 py-0.5 gap-0.5 rounded-full font-bold"
    : "stat-pill"
  const iconCls = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"
  return (
    <span className={`inline-flex items-center shrink-0 ${sizeCls} ${def.cls} ${className}`}>
      <Icon className={iconCls} aria-hidden="true" />
      {def.label}{team ? ` · ${team}` : ""}
    </span>
  )
}

// A row of badges built from derived items.
export function RoleBadges({ items = [], size = "md", className = "" }) {
  if (!items.length) return null
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {items.map((it) => (
        <RoleBadge key={it.role} role={it.role} team={it.team} size={size} />
      ))}
    </div>
  )
}

// "OG #N" — one of the 25 players Ariel picked as the first to link their account to
// their player card (players.og_number, 1..25, permanent). Gold on navy so it reads as a
// distinction, not another role. Renders nothing for everyone else.
export function OgBadge({ number, size = "md", className = "" }) {
  if (!number) return null
  const sizeCls = size === "sm"
    ? "text-[10px] px-1.5 py-0.5 gap-1 rounded-full"
    : "text-xs px-2.5 py-1 gap-1.5 rounded-full"
  return (
    <span
      dir="ltr"
      title={`OG #${number} — אחד מ־25 השחקנים הראשונים שחיברו את החשבון לכרטיס השחקן`}
      className={`inline-flex items-center shrink-0 font-extrabold bg-gradient-to-l from-slate-900 to-slate-800 text-amber-300 ring-1 ring-amber-400/60 dark:from-amber-400/20 dark:to-amber-300/10 dark:text-amber-300 ${sizeCls} ${className}`}
    >
      <BrandIcon name="og-badge" className={size === "sm" ? "w-4 h-4 -my-1" : "w-5 h-5 -my-1"} />
      <span className="tracking-wider">OG</span>
      <span className="opacity-80">#{number}</span>
    </span>
  )
}
