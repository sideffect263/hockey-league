import { BRAND_ORANGE } from '@/lib/brand'
import { Link, useLocation } from "react-router-dom"
import { useEffect, useRef, useState } from "react"
import { useSeasonName } from "@/App"
import {
  Menu,
  X,
  LogOut,
  UserCircle,
  Swords,
  BookOpen,
  Coins,
  ChevronDown,
  MoreHorizontal,
  Gamepad2
} from "lucide-react"
import { Rink, Standings, Crossed, Teams, Player, Whistle, Stats, Camera, Edit, Clipboard } from "./components/icons/HockeyIcons"
import { useAuth } from "./lib/AuthContext"
import AuthModal from "./components/AuthModal"
import OnboardingModal from "./components/OnboardingModal"
import NotificationBell from "./components/NotificationBell"
import ChatDrawer from "./components/ChatDrawer"
import LiveEditPanel from "./components/liveedit/LiveEditPanel"

// Nav uses the hockey icons in `mono`, so the brand-color ball accent becomes
// currentColor and stays visible on the active tab's solid-brand background.
const NavRink = (p) => <Rink mono {...p} />
const NavStandings = (p) => <Standings mono {...p} />
const NavGames = (p) => <Crossed mono {...p} />
const NavTeams = (p) => <Teams mono {...p} />
const NavPlayers = (p) => <Player mono {...p} />
const NavWhistle = (p) => <Whistle mono {...p} />
const NavStats = (p) => <Stats mono {...p} />
const NavCamera = (p) => <Camera mono {...p} />
const NavEdit = (p) => <Edit mono {...p} />
const NavClipboard = (p) => <Clipboard mono {...p} />

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

/** Shared panel chrome for the header menus (matches NotificationBell). */
function MenuPanel({ children, className = "" }) {
  return (
    <div className={`absolute mt-2 min-w-[12rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl z-50 py-1 ${className}`}>
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
          ? "bg-brand/10 text-brand-strong dark:text-brand-light"
          : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
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
            ? "bg-brand/10 text-brand-strong dark:text-brand-light"
            : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
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
    return <img src={profile.avatar_url} alt="" className={`${className} rounded-full object-cover shrink-0`} />
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
            item={{ title: "הדף שלי", url: "/me", icon: UserCircle }}
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
  const seasonName = useSeasonName()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { user, isAdmin, hasRole, coachTeamIds, isJudgeRole, isContentEditor, isLeagueManager, profile, signOut, openAuth } = useAuth()

  // The header is split into three groups so its width no longer depends on how
  // many roles you hold: six public destinations always visible, everything else
  // folded into "עוד", and the role tools kept next to the avatar (where people
  // already look for "my stuff"). The mobile sheet re-flattens all three.
  const primaryNav = [
    { title: "המגרש", url: "/", icon: NavRink },
    { title: "טבלה", url: "/standings", icon: NavStandings },
    { title: "משחקים", url: "/games", icon: NavGames },
    { title: "סטטיסטיקות", url: "/statistics", icon: NavStats },
    { title: "קבוצות", url: "/teams", icon: NavTeams },
    { title: "שחקנים", url: "/players", icon: NavPlayers },
  ]

  const moreNav = [
    { title: "טורנירים", url: "/tournaments", icon: Swords },
    // Media entry: content editors get the /creators workspace in the role menu
    // instead, so "מדיה" is hidden for them unless they are also an admin.
    ...((!isContentEditor || isAdmin) ? [{ title: "מדיה", url: "/media", icon: NavCamera }] : []),
    { title: "מדריך", url: "/guide", icon: BookOpen },
    // Unlike הוקי מרקט below, the career game is public: it needs no account,
    // touches no league data, and is the one page here a visitor who has never
    // heard of the sport might actually stay on.
    { title: "ליגיונר", url: "/career", icon: Gamepad2 },
    // הוקי מרקט is signed-in only: the page is gated to 18+ league players
    // anyway, and the public site should not advertise a betting board to the
    // youth-team visitors who make up much of its traffic.
    ...(user ? [{ title: "הוקי מרקט", url: "/market", icon: Coins }] : []),
  ]

  // Role tools — shown inside the avatar menu (desktop) and inline (mobile).
  // Archive lives in the management screen's season tab (/admin), not the nav.
  const roleNav = [
    ...((isAdmin || coachTeamIds.length > 0 || isJudgeRole || isLeagueManager) ? [{ title: "ניהול", url: "/admin", icon: NavClipboard }] : []),
    ...(hasRole("judge") ? [{ title: "שיפוט", url: "/judge", icon: NavWhistle }] : []),
    ...(isContentEditor ? [{ title: "יוצרי תוכן", url: "/creators", icon: NavEdit }] : []),
  ]

  // Flat list for the mobile sheet, which has the vertical room for everything.
  const navItems = [...primaryNav, ...moreNav, ...roleNav]

  const isActivePage = (url) =>
    url === "/"
      ? location.pathname === "/"
      : location.pathname === url || location.pathname.startsWith(url + "/")

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950" dir="rtl">
      {/* Top header bar */}
      <header className="sticky top-0 z-50 bg-surface-nav/80 backdrop-blur-lg border-b border-line-header">
        <div className="flex items-center gap-3 px-4 sm:px-6 h-16">
          {/* RTL start (right): logo + wordmark */}
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <img src="/logos/main-logo.png" alt="ליגת הוקי" className="size-10 rounded-xl object-cover ring-1 ring-line shadow-sm" />
            <div className="leading-none">
              {/* Not an <h1>: the site wordmark repeats on every route, so tagging it
                  as a heading gave each page two h1s and made "ליגת הוקי" — rather than
                  the page's own title — its primary heading for crawlers and screen
                  readers. `block` keeps the exact layout the <h1> had. */}
              <span className="block text-xl font-black text-fg-strong tracking-tight">ליגת הוקי</span>
              {seasonName && (
                <span className="mt-1 inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand-strong dark:text-brand-light">עונת {seasonName}</span>
              )}
            </div>
          </Link>

          {/* Inline nav (lg+). Grouping the tail into "עוד" and the role tools into
              the avatar menu caps the row at seven slots for every visitor, which
              is what lets it start at lg (1024px) instead of xl — laptops used to
              fall back to the hamburger. NOTE: no `overflow-x-auto` here, unlike
              the old 13-item row — a scroll container clips the "עוד" panel, which
              is absolutely positioned. The row is a fixed seven slots now, so it
              has nothing left to scroll. */}
          <nav className="hidden lg:flex flex-1 min-w-0 justify-center">
            {/* Tighter padding/gap below xl so the seven slots fit a 1024px laptop
                without overlapping the logo or the avatar cluster. */}
            <div className="flex items-center gap-0.5 xl:gap-1">
              {primaryNav.map((item) => (
                <Link
                  key={item.title}
                  to={item.url}
                  className={`inline-flex items-center gap-1.5 px-2 xl:px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                    isActivePage(item.url)
                      ? "bg-brand/10 text-brand-strong dark:text-brand-light"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {item.title}
                </Link>
              ))}
              <NavDropdown label="עוד" icon={MoreHorizontal} items={moreNav} isActivePage={isActivePage} />
            </div>
          </nav>

          {/* RTL end (left): auth (desktop) / hamburger (mobile).
              Dark-mode toggle lives on the profile page (/me), not here. */}
          <div className="flex items-center gap-1.5 ms-auto lg:ms-0">
            {/* Notifications bell — visible on all sizes for signed-in users, next to the avatar */}
            {user && <NotificationBell />}

            {/* Auth (lg+) — signed-in users get the avatar menu, which also carries
                the role tools that used to sit in the nav row. */}
            <div className="hidden lg:flex items-center gap-2">
              {user ? (
                <AvatarMenu
                  user={user}
                  profile={profile}
                  roleNav={roleNav}
                  isActivePage={isActivePage}
                  signOut={signOut}
                />
              ) : (
                <button
                  onClick={openAuth}
                  className="btn-primary btn-sm"
                >
                  התחבר
                </button>
              )}
            </div>

            {/* Hamburger (below lg) */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              aria-label="תפריט"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-white dark:bg-slate-900 pt-16 flex flex-col" dir="rtl">
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="absolute top-4 end-4 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            aria-label="סגור"
          >
            <X className="w-5 h-5" />
          </button>

          <nav className="flex-1 overflow-y-auto p-4 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.title}
                to={item.url}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors ${
                  isActivePage(item.url)
                    ? "bg-brand text-white shadow-md shadow-brand/25"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="font-semibold">{item.title}</span>
              </Link>
            ))}
          </nav>

          {/* Footer actions */}
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
            {user ? (
              <>
                <Link
                  to="/me"
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-primary w-full py-2.5"
                >
                  <NavAvatar profile={profile} email={user.email} className="w-6 h-6 ring-2 ring-white/50" /> הדף שלי
                </Link>
                <button
                  onClick={() => { signOut(); setMobileMenuOpen(false) }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> התנתק
                </button>
              </>
            ) : (
              <button
                onClick={() => { openAuth(); setMobileMenuOpen(false) }}
                className="btn-primary w-full py-2.5"
              >
                התחבר
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main content. min-h-[calc(100vh-4rem)], not min-h-screen: the sticky
          header above (h-16 = 4rem) already takes up its own space in flow, so
          "main also wants a full 100vh" forced a scrollbar on every page, even
          ones with no content to scroll. */}
      <main className="min-h-[calc(100vh-4rem)]">
        {children}
      </main>

      {/* Auth (login / signup) modal */}
      <AuthModal />

      {/* First-run prompt to link the account to a player profile */}
      <OnboardingModal />

      {/* Members-only chat / mailbox (self-gates to members) */}
      <ChatDrawer />

      {/* עריכה חיה — report a UI bug from the page it is on (self-gates to admins) */}
      <LiveEditPanel />
    </div>
  )
}
