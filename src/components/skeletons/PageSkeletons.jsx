/**
 * One skeleton per screen.
 *
 * Each of these is a tracing of a real page in `src/pages` — the same shell
 * width, the same header, the same number of columns — so the skeleton and the
 * page it stands in for occupy the same space and the swap is a fade, not a
 * jump.
 *
 * They are used in TWO places, deliberately the same component in both:
 *
 *   · `App`'s Suspense fallback, while the route's lazy chunk downloads
 *     (see `RouteSkeleton`), and
 *   · the page itself, while its data loads.
 *
 * That is what makes a cold visit to /players one continuous skeleton instead
 * of a spinner, then a skeleton, then the page.
 *
 * Keep this file dependency-free — it rides in the entry chunk. See the note at
 * the top of `components/ui/Skeleton.jsx`.
 */
import {
  Skeleton,
  SkeletonPage,
  SkeletonPageHeader,
  SkeletonBackLink,
  SkeletonTabs,
  SkeletonChips,
  SkeletonFilters,
  SkeletonCards,
  SkeletonGrid,
  SkeletonTable,
  SkeletonStatTiles,
  SkeletonChartCard,
  SkeletonDetailHeader,
  SkeletonSideNav,
  SkeletonBlock,
} from "@/components/ui/Skeleton"

/* ─── / — המגרש (feed) ──────────────────────────────────────────────────── */

/**
 * Three columns on desktop, one on mobile — and the two rails are `hidden`
 * below `lg` exactly as the real ones are, so the mobile skeleton is the mobile
 * layout and not a desktop layout squeezed.
 */
export function FeedSkeleton() {
  return (
    <SkeletonPage width="max-w-[1500px]" className="!space-y-0">
      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)_300px] lg:gap-6 lg:items-start">
        <aside className="hidden lg:block space-y-4">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </aside>

        <div className="space-y-5 min-w-0">
          <SkeletonPageHeader titleWidth="w-36" />
          {/* composer */}
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="lg:hidden space-y-5">
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>
          <SkeletonFeedPosts count={3} />
        </div>

        <aside className="hidden lg:block space-y-5">
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
        </aside>
      </div>
    </SkeletonPage>
  )
}

/**
 * Feed cards, drawn in parts rather than as one grey slab: a post is the one
 * thing on the site a reader scans *within* (who posted, then the text, then
 * the photo), so the placeholder has to carry that rhythm or the feed looks
 * like it failed to load rather than like it is loading.
 *
 * Exported because the feed also appends pages on scroll — see `Feed.jsx`.
 */
export function SkeletonFeedPosts({ count = 3 }) {
  return (
    <div className="space-y-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full shrink-0" />
            <div className="space-y-2 min-w-0 flex-1">
              <Skeleton className="h-3.5 w-36 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          {/* Every other card gets a photo — a feed is a mix, and a column of
              identical placeholders reads as a list, not a feed. */}
          {i % 2 === 0 && <Skeleton className="h-56 w-full rounded-xl" />}
          <div className="flex items-center gap-2 pt-1">
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── /standings — טבלת הליגה ───────────────────────────────────────────── */

export function StandingsSkeleton() {
  return (
    <SkeletonPage width="max-w-6xl">
      <SkeletonPageHeader titleWidth="w-44" />
      <SkeletonTable rows={8} cols={7} />
    </SkeletonPage>
  )
}

/* ─── /games — משחקים ───────────────────────────────────────────────────── */

export function GamesSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader titleWidth="w-36" />
      <SkeletonFilters withTabs tabCount={3} count={3} />
      <div className="space-y-6">
        <div>
          <Skeleton className="h-3.5 w-28 mb-3" />
          <SkeletonCards count={2} height="h-28" />
        </div>
        <div>
          <Skeleton className="h-3.5 w-20 mb-3" />
          <SkeletonCards count={4} height="h-24" />
        </div>
      </div>
    </SkeletonPage>
  )
}

/* ─── /games/:id — game detail ──────────────────────────────────────────── */

export function GameDetailSkeleton() {
  return (
    <SkeletonPage width="max-w-3xl">
      <SkeletonBackLink />
      {/* Scoreboard header: crest · score · crest, the one block on the site
          whose three columns must not shift when the numbers arrive. */}
      <div className="card p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-14 rounded-full" />
        </div>
        <div className="flex items-center justify-between gap-3">
          {[0, 1].map(i => (
            <div key={i} className={`flex flex-col items-center gap-2 flex-1 min-w-0 ${i === 1 ? "order-last" : ""}`}>
              <Skeleton className="size-14 rounded-full" />
              <Skeleton className="h-3.5 w-24 max-w-full" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
          <Skeleton className="h-10 w-24 rounded-lg shrink-0" />
        </div>
      </div>
      <Skeleton className="h-16 w-full rounded-2xl" />
      <SkeletonCards count={2} height="h-40" />
    </SkeletonPage>
  )
}

/* ─── /teams — קבוצות ───────────────────────────────────────────────────── */

export function TeamsSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader titleWidth="w-32" action />
      <SkeletonChips count={4} />
      <SkeletonCards count={6} height="h-20" />
    </SkeletonPage>
  )
}

/* ─── /teams/:id ────────────────────────────────────────────────────────── */

export function TeamDetailSkeleton() {
  return (
    <SkeletonPage width="max-w-3xl">
      <SkeletonBackLink />
      <SkeletonDetailHeader avatar="size-14 rounded-full" pills={3} />
      <SkeletonStatTiles count={4} cols="grid-cols-2 sm:grid-cols-4" />
      <SkeletonCards count={3} height="h-32" />
    </SkeletonPage>
  )
}

/* ─── /players — שחקנים ─────────────────────────────────────────────────── */

export function PlayersSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader titleWidth="w-32" />
      <SkeletonFilters count={4} />
      <SkeletonGrid count={9} height="h-36" />
    </SkeletonPage>
  )
}

/* ─── /players/:id ──────────────────────────────────────────────────────── */

export function PlayerDetailSkeleton() {
  return (
    <SkeletonPage width="max-w-3xl">
      <SkeletonBackLink />
      <SkeletonDetailHeader avatar="size-20 rounded-2xl" pills={3} />
      <SkeletonStatTiles count={4} cols="grid-cols-2 sm:grid-cols-4" />
      <SkeletonCards count={2} height="h-44" />
    </SkeletonPage>
  )
}

/* ─── /statistics — סטטיסטיקות ──────────────────────────────────────────── */

export function StatisticsSkeleton() {
  return (
    <SkeletonPage className="!space-y-6">
      <SkeletonPageHeader titleWidth="w-48" />
      <SkeletonStatTiles count={5} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonChartCard className="lg:col-span-2" height="h-56" />
        <SkeletonChartCard className="lg:col-span-2" height="h-56" />
        <SkeletonChartCard />
        <SkeletonChartCard />
      </div>
    </SkeletonPage>
  )
}

/* ─── /tournaments — טורנירים ───────────────────────────────────────────── */

export function TournamentsSkeleton() {
  return (
    <SkeletonPage width="max-w-4xl">
      <SkeletonPageHeader titleWidth="w-32" />
      <SkeletonCards count={4} height="h-20" />
    </SkeletonPage>
  )
}

export function TournamentDetailSkeleton() {
  return (
    <SkeletonPage width="max-w-3xl">
      <SkeletonBackLink />
      <SkeletonDetailHeader avatar="size-14 rounded-2xl" pills={2} />
      <SkeletonCards count={2} height="h-36" />
    </SkeletonPage>
  )
}

/* ─── /notifications — התראות ───────────────────────────────────────────── */

export function NotificationsSkeleton() {
  return (
    <SkeletonPage width="max-w-2xl" className="!space-y-4">
      <SkeletonBackLink />
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-32 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <SkeletonNotificationRows />
    </SkeletonPage>
  )
}

/**
 * The list alone — the page header is already on screen while rows reload.
 *
 * `compact` drops the card chrome for the header bell's dropdown, where the
 * panel is already a bordered surface and cards inside it read as a box in a
 * box.
 */
export function SkeletonNotificationRows({ count = 5, compact = false }) {
  return (
    <SkeletonBlock className={compact ? "space-y-4" : "space-y-2"}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`flex items-start gap-3 ${compact ? "px-1" : "card p-4"}`}>
          <Skeleton className="size-9 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </SkeletonBlock>
  )
}

/* ─── /media — זיהוי שחקנים ─────────────────────────────────────────────── */

export function MediaSkeleton() {
  return (
    <SkeletonPage width="max-w-6xl">
      <SkeletonPageHeader titleWidth="w-64" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <SkeletonGrid count={6} height="h-72" gap="gap-4" />
    </SkeletonPage>
  )
}

/** /media's core is also embedded in /creators, where the page chrome differs. */
export function MediaClustersSkeleton() {
  return (
    <SkeletonBlock className="space-y-5">
      <SkeletonPageHeader titleWidth="w-64" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <SkeletonGrid count={6} height="h-72" gap="gap-4" />
    </SkeletonBlock>
  )
}

/* ─── /archive — ארכיון עונות ───────────────────────────────────────────── */

export function ArchiveSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader titleWidth="w-44" />
      <SkeletonGrid count={4} height="h-24" cols="grid-cols-1 sm:grid-cols-2" />
    </SkeletonPage>
  )
}

export function ArchiveSeasonSkeleton() {
  return (
    <SkeletonPage>
      <div className="space-y-2.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-8 sm:h-9 w-48 rounded-lg" />
      </div>
      <SkeletonStatTiles count={4} cols="grid-cols-2 sm:grid-cols-4" />
      <SkeletonTable rows={6} cols={6} />
    </SkeletonPage>
  )
}

/* ─── /market — הוקי מרקט ───────────────────────────────────────────────── */

/**
 * The market re-skins the shell through the same tokens, so these blocks come
 * out warm-stone-on-emerald there without a market-specific class. Its shell is
 * `px-4 sm:px-6 py-6` rather than the league's `p-4 sm:p-6 lg:p-8`.
 */
export function MarketSkeleton() {
  return (
    <SkeletonPage width="max-w-5xl" pad={false} className="px-4 sm:px-6 py-6">
      {/* wallet hero */}
      <Skeleton className="h-28 w-full rounded-xl" />
      <SkeletonTabs count={3} />
      <MarketBoardSkeleton />
    </SkeletonPage>
  )
}

/** The board alone — the wallet hero and tabs stay put while a tab loads. */
export function MarketBoardSkeleton() {
  return (
    <SkeletonBlock className="space-y-8">
      <Skeleton className="h-64 w-full rounded-xl" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <SkeletonGrid count={4} height="h-40" cols="grid-cols-1 sm:grid-cols-2" />
      </div>
    </SkeletonBlock>
  )
}

export function MarketDetailSkeleton() {
  return (
    <SkeletonPage width="max-w-5xl" pad={false} className="px-4 sm:px-6 py-6">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </SkeletonPage>
  )
}

/* ─── /me — הפרופיל שלי ─────────────────────────────────────────────────── */

export function ProfileSkeleton() {
  return (
    <SkeletonPage width="max-w-2xl">
      <SkeletonDetailHeader avatar="size-20 rounded-2xl" pills={2} />
      <SkeletonCards count={4} height="h-32" />
    </SkeletonPage>
  )
}

/* ─── /judge — שיפוט משחקים ─────────────────────────────────────────────── */

export function JudgeSkeleton() {
  return (
    <SkeletonPage width="max-w-3xl">
      <SkeletonPageHeader titleWidth="w-44" />
      <SkeletonCards count={4} height="h-28" />
    </SkeletonPage>
  )
}

/** /judge/:id — the scoreboard the official runs the game on. */
export function JudgeGameSkeleton() {
  return (
    <SkeletonPage width="max-w-3xl">
      <SkeletonBackLink />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <SkeletonCards count={2} height="h-40" />
    </SkeletonPage>
  )
}

/* ─── /admin · /creators — side-nav consoles ────────────────────────────── */

export function AdminSkeleton() {
  return (
    <SkeletonPage width="max-w-6xl">
      <SkeletonPageHeader titleWidth="w-24" action />
      <SkeletonSideNav tabs={8}>
        <AdminPanelSkeleton />
      </SkeletonSideNav>
    </SkeletonPage>
  )
}

/**
 * Rows inside a panel whose own header and toolbar are already on screen — the
 * seventeen /admin tabs, each of which fetches its own list. No toolbar of its
 * own, or the panel grows a second one while it waits.
 */
export function SkeletonPanelRows({ count = 5, height = "h-16" }) {
  return (
    <SkeletonBlock className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={`${height} w-full rounded-xl`} />
      ))}
    </SkeletonBlock>
  )
}

/** The panel beside the rail — the rail itself is real and stays interactive. */
export function AdminPanelSkeleton() {
  return (
    <SkeletonBlock className="space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 flex-1 rounded-xl" />
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>
      <SkeletonCards count={6} height="h-16" />
    </SkeletonBlock>
  )
}

export function CreatorsSkeleton() {
  return (
    <SkeletonPage width="max-w-6xl">
      <SkeletonPageHeader titleWidth="w-40" />
      <SkeletonSideNav tabs={5}>
        <AdminPanelSkeleton />
      </SkeletonSideNav>
    </SkeletonPage>
  )
}

/* ─── /career — ליגיונר על גלגלים ───────────────────────────────────────── */

/**
 * The career game: the player HUD across the top, then the decision card beside
 * the timeline. Its own shell (`px-4 py-6`, no `lg:p-8`), like the market's.
 */
export function CareerSkeleton() {
  return (
    <SkeletonPage width="max-w-5xl" pad={false} className="px-4 py-6 !space-y-4">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Skeleton className="h-80 w-full rounded-2xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    </SkeletonPage>
  )
}

/* ─── Fallbacks ─────────────────────────────────────────────────────────── */

/**
 * For routes with no shape worth tracing — static content pages, the stream
 * diagnostics — and for any route added later that nobody mapped. A title and
 * a couple of blocks: honest about the width, silent about the rest.
 */
export function GenericPageSkeleton({ width = "max-w-5xl" }) {
  return (
    <SkeletonPage width={width}>
      <SkeletonPageHeader titleWidth="w-40" />
      <SkeletonCards count={3} height="h-32" />
    </SkeletonPage>
  )
}
