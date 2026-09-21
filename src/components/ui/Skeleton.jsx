/**
 * Skeleton primitives.
 *
 * A skeleton screen replaces the centred spinner that every page used to show
 * while it fetched. The spinner said "something is happening"; a skeleton says
 * *what* is about to appear and where, so the page does not visibly re-lay-out
 * under the reader when the data lands.
 *
 * Three rules hold this together:
 *
 *  1. **Shape follows the real page.** Every skeleton below mirrors a layout
 *     that actually exists in the app — the page shell (`p-4 sm:p-6 lg:p-8
 *     max-w-* mx-auto space-y-5`), the `.card`, the filter row, the side-nav
 *     grid. When a page's layout changes, its skeleton has to change with it;
 *     that coupling is the point, not an accident.
 *  2. **No dependencies.** No framer-motion, no lucide, no data. These render
 *     in `App`'s Suspense fallback, which is in the entry chunk — anything
 *     imported here ships to every visitor before the route chunk does.
 *  3. **One announcement per page.** `SkeletonPage` carries the single
 *     `role="status"` and the only text a screen reader hears ("טוען…"); the
 *     blocks themselves are `aria-hidden`, because a screen reader reading out
 *     forty empty boxes is worse than a spinner.
 */

/** One placeholder block. Size and radius come from the caller. */
export function Skeleton({ className = "" }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />
}

/**
 * A circle — avatars, team crests, icon tiles.
 *
 * The size is a whole class, never `size-${n}`: Tailwind generates utilities by
 * scanning the source as text, so an interpolated class name produces no CSS at
 * all and the element collapses to 0×0 with nothing in the console to say why.
 */
export function SkeletonCircle({ size = "size-10", className = "" }) {
  return <Skeleton className={`${size} rounded-full shrink-0 ${className}`} />
}

/**
 * A paragraph of placeholder lines. The last line is short, because real text
 * ends mid-line and a block of equal-length bars reads as a table, not prose.
 */
export function SkeletonText({ lines = 3, className = "" }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  )
}

/**
 * The page shell. Owns the loading announcement for the whole screen.
 *
 * `width` is the page's own max-width class, so the skeleton occupies exactly
 * the column the real page will — the most visible source of layout shift if
 * you get it wrong.
 */
export function SkeletonPage({ children, width = "max-w-5xl", className = "", pad = true }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={`${pad ? "p-4 sm:p-6 lg:p-8 " : ""}${width} mx-auto space-y-5 ${className}`}
    >
      <span className="sr-only">טוען…</span>
      {children}
    </div>
  )
}

/** Title + subtitle, matching `.page-title` / `.page-subtitle` metrics. */
export function SkeletonPageHeader({ titleWidth = "w-52", subtitle = true, action = false }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-xl" />
          <Skeleton className={`h-8 sm:h-9 ${titleWidth} rounded-lg`} />
        </div>
        {subtitle && <Skeleton className="h-3.5 w-64 max-w-full" />}
      </div>
      {action && <Skeleton className="h-9 w-28 rounded-lg shrink-0" />}
    </div>
  )
}

/** The back-link that every detail page opens with ("חזרה ל…"). */
export function SkeletonBackLink() {
  return <Skeleton className="h-4 w-28" />
}

/** A `.tab-bar` of n tabs. */
export function SkeletonTabs({ count = 3, className = "" }) {
  return (
    <div className={`tab-bar w-fit ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-20 rounded-lg" />
      ))}
    </div>
  )
}

/** A row of pill filters / age-group chips. */
export function SkeletonChips({ count = 4, className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-24 rounded-full shrink-0" />
      ))}
    </div>
  )
}

/** The search + `<select>` filter row used by /games, /players, /teams. */
export function SkeletonFilters({ count = 3, withTabs = false, tabCount = 3 }) {
  return (
    <div className="flex flex-col sm:flex-row gap-2.5">
      {withTabs && <SkeletonTabs count={tabCount} className="sm:w-auto" />}
      <div className="flex gap-2 flex-1 flex-wrap">
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="h-11 flex-1 min-w-[120px] rounded-xl" />
        ))}
      </div>
    </div>
  )
}

/** n `.card`s of a fixed height — the generic list placeholder. */
export function SkeletonCards({ count = 4, height = "h-24", className = "" }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={`${height} w-full rounded-2xl`} />
      ))}
    </div>
  )
}

/** A responsive grid of card placeholders. */
export function SkeletonGrid({ count = 6, height = "h-28", cols = "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", gap = "gap-3" }) {
  return (
    <div className={`grid ${cols} ${gap}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={`${height} w-full rounded-2xl`} />
      ))}
    </div>
  )
}

/**
 * A table inside a `.card`, with the brand-deep header bar the standings and
 * the admin tables both use. `cols` sets how many cells a row is cut into.
 */
export function SkeletonTable({ rows = 8, cols = 6, firstColWide = true }) {
  return (
    <div className="card overflow-hidden">
      <div className="h-11 bg-brand-deep/90" aria-hidden="true" />
      <div className="divide-y divide-divider">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-3 px-4 py-3">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                className={`h-4 ${firstColWide && c === 0 ? "flex-[3] min-w-0" : "flex-1"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A row of `StatTile`s. */
export function SkeletonStatTiles({ count = 5, cols = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" }) {
  return (
    <div className={`grid ${cols} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-2xl" />
      ))}
    </div>
  )
}

/** A `ChartCard`: heading, then the plot area. */
export function SkeletonChartCard({ height = "h-52", className = "" }) {
  return (
    <div className={`card p-4 sm:p-5 space-y-4 ${className}`}>
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <Skeleton className={`${height} w-full rounded-xl`} />
    </div>
  )
}

/**
 * The hero card every detail page opens with: a crest or avatar beside a name,
 * a line of meta, and a row of `.stat-pill`s.
 */
export function SkeletonDetailHeader({ avatar = "size-16 rounded-2xl", pills = 3 }) {
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <Skeleton className={`${avatar} shrink-0`} />
        <div className="min-w-0 flex-1 space-y-2.5">
          <Skeleton className="h-7 w-48 max-w-full rounded-lg" />
          <Skeleton className="h-3.5 w-36 max-w-full" />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {Array.from({ length: pills }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-16 rounded-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The `/admin` and `/creators` shell: a sticky rail (right in RTL) beside the
 * panel. The rail is drawn as real tabs because it is the part of those screens
 * that is already interactive-looking before any data arrives.
 */
export function SkeletonSideNav({ tabs = 8, children }) {
  return (
    <div className="lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:items-start">
      <aside className="lg:sticky lg:top-20 self-start mb-4 lg:mb-0">
        <nav className="card p-2 flex lg:flex-col gap-1 overflow-hidden">
          {Array.from({ length: tabs }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-28 lg:w-full rounded-xl shrink-0" />
          ))}
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/**
 * A skeleton for a region *inside* an already-rendered page (a tab panel, a
 * list that reloads under a header that is already on screen). It announces
 * itself, unlike the bare blocks, because nothing above it is doing so.
 */
export function SkeletonBlock({ children, className = "" }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">טוען…</span>
      {children}
    </div>
  )
}
