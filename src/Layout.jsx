import { BRAND_ORANGE } from '@/lib/brand'
import { Link, useLocation } from "react-router-dom"
import { useEffect, useRef, useState } from "react"
import SeasonPicker, { SeasonPaletteSync } from "./components/SeasonPicker"
import {
  LogOut,
  UserCircle,
  ChevronDown,
  MoreHorizontal,
  Code2
} from "lucide-react"
import { RinkIcon, Trophy as BrandTrophy, MatchFallback, TeamsIcon, PlayerIcon, Referee, VideoLibrary, Person, Table, StatsIcon, EditIcon, Manage, Loan, DocumentIcon, PlayerPose, Market, GameForm } from "@/components/icons/BrandIcons"
import { useAuth } from "./lib/AuthContext"
import AuthModal from "./components/AuthModal"
import OnboardingModal from "./components/OnboardingModal"
import OgCelebration from "./components/OgCelebration"
import NotificationBell from "./components/NotificationBell"
import ChatDrawer from "./components/ChatDrawer"
import LiveEditPanel from "./components/liveedit/LiveEditPanel"
import { sizedImage } from "@/lib/imageSize"
import { FLTabBar, LineIcon } from "@/components/fl/shell/FLShell"
import { isFullscreen, desktopPrimary } from "@/components/fl/shell/navModel"

// Nav uses the league's own icons (BrandIcons) where a meaning has one. Their accents
// (orange ball, brand-blue/white fills) stay readable on the active tab's tint and on
// the mobile menu's solid brand fill, so no `mono` variant is needed. The in-house
// Every item has brand art now (the final 154-file set).
const NavRink = (p) => <RinkIcon {...p} />
const NavStandings = (p) => <Table {...p} />
const NavTournaments = (p) => <BrandTrophy {...p} />
const NavGames = (p) => <MatchFallback {...p} />
const NavTeams = (p) => <TeamsIcon {...p} />
const NavPlayers = (p) => <PlayerIcon {...p} />
const NavWhistle = (p) => <Referee {...p} />
const NavStats = (p) => <StatsIcon {...p} />
const NavCamera = (p) => <VideoLibrary {...p} />
const NavEdit = (p) => <EditIcon {...p} />
const NavClipboard = (p) => <Manage {...p} />
const NavLoans = (p) => <Loan {...p} />
const NavGuide = (p) => <DocumentIcon {...p} />
const NavCareer = (p) => <PlayerPose pose={4} {...p} />
const NavMarket = (p) => <Market {...p} />
const NavResults = (p) => <GameForm {...p} />
const NavMe = (p) => <Person {...p} />

/**
 * Close a navbar dropdown on outside click, Escape, or route change. Every menu
 * in the header behaves the same way (and the same way NotificationBell does),
 * so the behaviour lives here once instead of in each menu.
 */
function useDismissable(open, setOpen, wrapRef) {
  const location = useLocation()
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [open, setOpen, wrapRef])
  // A menu item is a <Link>; navigating away must not leave the panel hanging open.
  useEffect(() => { setOpen(false) }, [location.pathname, setOpen])
}

/** Header shortcut to the /devs lab for developers + admins. */
function DevsButton({ active }) {
  return (
    <Link to="/devs" title="מפתחים"
      className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-sm font-semibold transition-colors ${
        active ? "bg-brand/10 text-brand" : "text-fg-muted hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-fg-strong"}`}>
      <Code2 className="w-5 h-5" />
      <span className="hidden xl:inline">מפתחים</span>
    </Link>
  )
}

/** Shared panel chrome for the header menus (matches NotificationBell). */
function MenuPanel({ children, className = "" }) {
  return (
    <div className={`absolute mt-2 min-w-[12rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-control border border-line bg-surface shadow-[0_12px_32px_rgba(0,0,0,.14)] z-50 py-1 ${className}`}>
      {children}
    </div>
  )
}

/** One row inside a header menu. */
function MenuItem({ item, active, onClick }) {
  return (
    <Link
      to={item.url}
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-semibold transition-colors ${
        active
          ? "bg-surface-sunken text-fg-strong"
          : "text-fg hover:bg-surface-inset hover:text-fg-strong"
      }`}
    >
      <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      {item.title}
    </Link>
  )
}

/**
 * The "עוד" nav group. Secondary destinations live here so the visible row stays
 * a fixed six items no matter how many roles the signed-in user holds — the row
 * used to grow to 13 items and silently horizontal-scroll its tail out of view.
 */
function NavDropdown({ label, icon: Icon, items, isActivePage }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useDismissable(open, setOpen, wrapRef)

  if (items.length === 0) return null
  const anyActive = items.some((i) => isActivePage(i.url))

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`inline-flex items-center gap-1.5 px-2 xl:px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
          anyActive || open
            ? "bg-surface text-fg-strong"
            : "text-fg-muted hover:bg-surface hover:text-fg-strong"
        }`}
      >
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        {label}
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <MenuPanel className="start-0">
          {items.map((item) => (
            <MenuItem key={item.title} item={item} active={isActivePage(item.url)} onClick={() => setOpen(false)} />
          ))}
        </MenuPanel>
      )}
    </div>
  )
}

/**
 * Navbar avatar with three states (mirrors the /me header + feed avatars):
 *   1. profile image set        → the uploaded picture
 *   2. linked to a player       → circle in the player's team color + initial
 *   3. guest (neither)          → neutral gray generic user icon
 */
function NavAvatar({ profile, email, className = "w-8 h-8" }) {
  const name = profile?.display_name || profile?.player?.first_name || email || ""
  const initial = name.trim().charAt(0).toUpperCase()

  if (profile?.avatar_url) {
    return <img src={sizedImage(profile.avatar_url, 48)} alt="" className={`${className} rounded-full object-cover shrink-0`} />
  }
  if (profile?.player_id) {
    return (
      <div
        className={`${className} rounded-full shrink-0 flex items-center justify-center text-white text-sm font-bold`}
        style={{ backgroundColor: profile.teamColor || BRAND_ORANGE }}
      >
        {initial || <UserCircle className="w-1/2 h-1/2" />}
      </div>
    )
  }
  return (
    <div className={`${className} rounded-full shrink-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400`}>
      <UserCircle className="w-3/5 h-3/5" />
    </div>
  )
}

/**
 * Signed-in menu behind the avatar: the personal page, the role tools (ניהול /
 * שיפוט / יוצרי תוכן) and sign-out. Keeping the role entries here is what stops
 * the nav row from growing for admins, judges and content editors.
 */
function AvatarMenu({ user, profile, roleNav, isActivePage, signOut }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useDismissable(open, setOpen, wrapRef)

  const anyRoleActive = roleNav.some((i) => isActivePage(i.url))

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="התפריט שלי"
        className={`flex items-center gap-1 rounded-full p-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
          anyRoleActive || open ? "ring-2 ring-brand/50" : "hover:ring-2 hover:ring-brand/40 dark:hover:ring-brand/50"
        }`}
      >
        <NavAvatar profile={profile} email={user.email} className="w-8 h-8" />
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <MenuPanel className="end-0">
          <MenuItem
            item={{ title: "הדף שלי", url: "/me", icon: NavMe }}
            active={isActivePage("/me")}
            onClick={() => setOpen(false)}
          />
          {roleNav.length > 0 && (
            <>
              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
              {roleNav.map((item) => (
                <MenuItem key={item.title} item={item} active={isActivePage(item.url)} onClick={() => setOpen(false)} />
              ))}
            </>
          )}
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <button
            onClick={() => { setOpen(false); signOut() }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" /> התנתק
          </button>
        </MenuPanel>
      )}
    </div>
  )
}

export default function Layout({ children }) {
  const location = useLocation()
  const fullscreen = isFullscreen(location.pathname)
  const { user, isAdmin, hasRole, coachTeamIds, isJudgeRole, isContentEditor, isLeagueManager, isDeveloper, profile, signOut, openAuth } = useAuth()


  // The header is split into three groups so its width no longer depends on how
  // many roles you hold: six public destinations always visible, everything else
  // folded into "עוד", and the role tools kept next to the avatar (where people
  // already look for "my stuff"). The mobile sheet re-flattens all three.
  const moreNav = [
    { title: "טורנירים", url: "/tournaments", icon: NavTournaments },
    // Shown to everyone again: the face-naming tool left /creators for /devs (2026-10-15),
    // so content editors no longer have a copy of it in their workspace.
    { title: "מדיה", url: "/media", icon: NavCamera },
    { title: "מדריך", url: "/guide", icon: NavGuide },
    // Unlike סטופר מרקט below, the career game is public: it needs no account,
    // touches no league data, and is the one page here a visitor who has never
    // heard of the sport might actually stay on.
    { title: "ליגיונר", url: "/career", icon: NavCareer },
    // סטופר מרקט is signed-in only: the page is gated to 18+ league players
    // anyway, and the public site should not advertise a betting board to the
    // youth-team visitors who make up much of its traffic.
    ...(user ? [{ title: "סטופר מרקט", url: "/market", icon: NavMarket }] : []),
  ]

  // Role tools — shown inside the avatar menu (desktop) and inline (mobile).
  // Archive lives in the management screen's season tab (/admin), not the nav.
  const roleNav = [
    ...((isAdmin || coachTeamIds.length > 0 || isJudgeRole || isLeagueManager) ? [{ title: "ניהול", url: "/admin", icon: NavClipboard }] : []),
    ...(hasRole("judge") ? [{ title: "שיפוט", url: "/judge", icon: NavWhistle }] : []),
    // Results from the handwritten form: referees + league managers (never coaches).
    ...((isAdmin || isJudgeRole || isLeagueManager) ? [{ title: "הזנת תוצאות", url: "/results", icon: NavResults }] : []),
    ...((isContentEditor || isAdmin) ? [{ title: "יוצרי תוכן", url: "/creators", icon: NavEdit }] : []),
  ]

  const isActivePage = (url) =>
    url === "/"
      ? location.pathname === "/"
      : location.pathname === url || location.pathname.startsWith(url + "/")

  return (
    <div className="min-h-screen bg-surface-page" dir="rtl">
      <SeasonPaletteSync />
      {/* Top header bar — Floodlight: page-coloured and blurred, brand on the RTL start,
          search · bell · avatar on the end (FeedFan board). Phones navigate with the
          bottom tab bar + the "עוד" sheet (FLTabBar); lg+ keep the inline nav row. */}
      {!fullscreen && (
      <header className="sticky top-0 z-50 bg-surface-nav/85 backdrop-blur-lg border-b border-line-header/70">
        <div className="flex items-center gap-3 px-3 sm:px-6 h-16">
          {/* The season badge is a button (the season picker), so it sits beside the
              home link rather than inside it — a control nested in a link is invalid. */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Link to="/" className="shrink-0">
              <img src="/logos/mark-256.png" alt="ליגת הוקי" data-header-logo className="size-[34px] rounded-[10px] object-contain" />
            </Link>
            <div className="leading-none">
              {/* Not an <h1>: the wordmark repeats on every route (one h1 per page). */}
              <Link to="/" className="block text-[22px] font-extrabold text-fg-strong leading-[1.05]">ליגת הוקי</Link>
              <SeasonPicker />
            </div>
          </div>

          {/* Inline nav (lg+). No overflow-x-auto: a scroll container clips the "עוד" panel. */}
          <nav className="hidden lg:flex flex-1 min-w-0 justify-center" aria-label="ניווט ראשי">
            <div className="flex items-center gap-0.5 xl:gap-1">
              {desktopPrimary.map((item) => {
                const on = isActivePage(item.url)
                return (
                  <Link key={item.title} to={item.url} aria-current={on ? "page" : undefined}
                    className={`relative inline-flex items-center px-2.5 xl:px-3 h-10 rounded-[10px] text-[14px] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent ${
                      on ? "text-fg-strong font-bold" : "text-fg-muted font-medium hover:text-fg-strong hover:bg-surface"}`}>
                    {item.title}
                    <span aria-hidden="true" className={`absolute inset-x-3 -bottom-[9px] h-[3px] rounded-full bg-fl-accent transition-opacity ${on ? "opacity-100" : "opacity-0"}`} />
                  </Link>
                )
              })}
              <NavDropdown label="עוד" icon={MoreHorizontal} items={moreNav} isActivePage={isActivePage} />
            </div>
          </nav>

          <div className="flex items-center gap-0.5 ms-auto lg:ms-0">
            {/* Dev lab — the only role tool with a header button; it is not repeated in the menus. */}
            {(isDeveloper || isAdmin) && <DevsButton active={isActivePage("/devs")} />}
            <Link to="/search" aria-label="חיפוש" className="size-11 rounded-full flex items-center justify-center text-fg-strong hover:bg-surface">
              <LineIcon name="search" size={23} stroke={1.9} />
            </Link>
            {user && <NotificationBell />}
            {user ? (
              <>
                <div className="hidden lg:flex items-center">
                  <AvatarMenu user={user} profile={profile} roleNav={roleNav} isActivePage={isActivePage} signOut={signOut} />
                </div>
                <Link to="/me" aria-label="הדף שלי" className="lg:hidden size-11 flex items-center justify-center">
                  <NavAvatar profile={profile} email={user.email} className="w-9 h-9" />
                </Link>
              </>
            ) : (
              <button onClick={openAuth} className="btn-primary btn-sm ms-1">התחברות</button>
            )}
          </div>
        </div>
      </header>
      )}

      {/* Main content. min-h-[calc(100vh-4rem)], not min-h-screen: the sticky
          header above (h-16 = 4rem) already takes up its own space in flow, so
          "main also wants a full 100vh" forced a scrollbar on every page, even
          ones with no content to scroll. */}
      <main className={fullscreen ? "" : "min-h-[calc(100vh-4rem)] fl-tabbar-pad"}>
        {children}
      </main>

      {!fullscreen && <FLTabBar />}

      {/* Auth (login / signup) modal */}
      <AuthModal />

      {/* First-run prompt to link the account to a player profile */}
      <OnboardingModal />

      {/* One-time "OG #N" surprise for the 25 OG players */}
      <OgCelebration />

      {/* Members-only chat / mailbox (self-gates to members) */}
      <ChatDrawer />

      {/* עריכה חיה — report a UI bug from the page it is on (self-gates to admins) */}
      <LiveEditPanel />
    </div>
  )
}
