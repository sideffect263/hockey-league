/**
 * The Suspense fallback for the route chunks.
 *
 * `App` lazy-loads every page, so between clicking a nav link and the page
 * appearing there is a gap of however long that chunk takes to download — on a
 * phone on league Wi-Fi, not a short time. It used to be a centred spinner for
 * every route alike; now each route gets *its own* skeleton, the same component
 * the page renders while it fetches. So a cold visit to /players is one
 * continuous skeleton that simply fills in, rather than spinner → skeleton →
 * page, with a layout jump at each arrow.
 *
 * Matching is done by hand rather than by mounting React Router's matcher: this
 * ships in the entry chunk and the route set is small, stable and listed right
 * here beside `App`'s own `<Routes>`. Anything unmapped falls back to a plain
 * page shell, which is still better than a spinner and never wrong about the
 * one thing it claims.
 */
import { useLocation } from "react-router-dom"
import {
  FeedSkeleton,
  StandingsSkeleton,
  GamesSkeleton,
  GameDetailSkeleton,
  TeamsSkeleton,
  TeamDetailSkeleton,
  PlayersSkeleton,
  PlayerDetailSkeleton,
  StatisticsSkeleton,
  TournamentsSkeleton,
  TournamentDetailSkeleton,
  NotificationsSkeleton,
  MediaSkeleton,
  ArchiveSkeleton,
  ArchiveSeasonSkeleton,
  MarketSkeleton,
  MarketDetailSkeleton,
  ProfileSkeleton,
  JudgeSkeleton,
  JudgeGameSkeleton,
  AdminSkeleton,
  CreatorsSkeleton,
  CareerSkeleton,
  GenericPageSkeleton,
} from "./PageSkeletons"

/** /games/:id/tv — a fullscreen board on a TV; the shell is not even visible. */
function GameTvSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="fixed inset-0 z-[100] bg-[#0E2350] flex items-center justify-center"
    >
      <span className="sr-only">טוען…</span>
      <div className="w-[70vw] max-w-5xl space-y-6" aria-hidden="true">
        <div className="skeleton h-40 w-full rounded-3xl opacity-20" />
        <div className="skeleton h-24 w-2/3 mx-auto rounded-2xl opacity-20" />
      </div>
    </div>
  )
}

/**
 * The route table, in the order it is tested. Two-segment paths are listed
 * before their one-segment parents so /teams/:id never matches /teams.
 */
const ROUTES = [
  [/^\/$/, FeedSkeleton],
  [/^\/standings\/?$/, StandingsSkeleton],
  [/^\/games\/[^/]+\/tv\/?$/, GameTvSkeleton],
  [/^\/games\/[^/]+\/?$/, GameDetailSkeleton],
  [/^\/games\/?$/, GamesSkeleton],
  [/^\/teams\/[^/]+\/?$/, TeamDetailSkeleton],
  [/^\/teams\/?$/, TeamsSkeleton],
  [/^\/players\/[^/]+\/?$/, PlayerDetailSkeleton],
  [/^\/players\/?$/, PlayersSkeleton],
  [/^\/tournaments\/[^/]+\/?$/, TournamentDetailSkeleton],
  [/^\/tournaments\/?$/, TournamentsSkeleton],
  [/^\/market\/[^/]+\/?$/, MarketDetailSkeleton],
  [/^\/market\/?$/, MarketSkeleton],
  [/^\/archive\/[^/]+\/?$/, ArchiveSeasonSkeleton],
  [/^\/archive\/?$/, ArchiveSkeleton],
  [/^\/judge\/[^/]+\/?$/, JudgeGameSkeleton],
  [/^\/judge\/?$/, JudgeSkeleton],
  [/^\/statistics\/?$/, StatisticsSkeleton],
  [/^\/notifications\/?$/, NotificationsSkeleton],
  [/^\/media\/?$/, MediaSkeleton],
  [/^\/creators\/?$/, CreatorsSkeleton],
  [/^\/admin\/?$/, AdminSkeleton],
  [/^\/me\/?$/, ProfileSkeleton],
  [/^\/career\/?$/, CareerSkeleton],
]

/**
 * The skeleton for a path, as a component.
 *
 * Exported separately from the hook-using component below because the very
 * first gate of all — `App` waiting on the season settings — runs OUTSIDE the
 * Router, where `useLocation` throws. It reads `window.location.pathname`
 * instead, which is the same path React Router is about to report. The result
 * is that a cold load of /players shows the players skeleton from the first
 * paint, through the season fetch, through the chunk download, through the data
 * fetch, without ever changing shape.
 */
export function skeletonFor(pathname) {
  const hit = ROUTES.find(([re]) => re.test(pathname))
  return hit?.[1] || GenericPageSkeleton
}

export default function RouteSkeleton() {
  const { pathname } = useLocation()
  const Fallback = skeletonFor(pathname)
  return <Fallback />
}
