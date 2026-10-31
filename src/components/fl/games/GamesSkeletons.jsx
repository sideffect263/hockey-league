/** Page-shaped skeletons for the Floodlight games pages (no spinners). */
import { Skeleton } from "@/components/ui/Skeleton"

export function GameDetailSkeletonFL() {
  return (
    <div className="max-w-6xl mx-auto lg:px-8 lg:pt-6" aria-busy="true" aria-label="טוען את המשחק">
      <div className="rounded-b-[30px] lg:rounded-[28px] bg-fl-night/90 px-4 pt-3 pb-7">
        <div className="flex justify-between"><span className="size-11 rounded-full bg-white/10" /><span className="h-7 w-28 rounded-full bg-white/10" /><span className="size-11 rounded-full bg-white/10" /></div>
        <div className="mt-8 grid grid-cols-3 items-center max-w-3xl mx-auto">
          <span className="mx-auto size-20 rounded-full bg-white/10" />
          <span className="mx-auto h-12 w-24 rounded-xl bg-white/10" />
          <span className="mx-auto size-20 rounded-full bg-white/10" />
        </div>
        <span className="block mx-auto mt-6 h-3.5 w-56 rounded bg-white/10" />
      </div>
      <div className="px-3 lg:px-0 pt-4 flex flex-col gap-3.5">
        <Skeleton className="h-16 w-full rounded-[16px]" />
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-56 w-full rounded-card" />
      </div>
    </div>
  )
}

export function GamesSkeletonFL() {
  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 pt-4" aria-busy="true" aria-label="טוען משחקים">
      <Skeleton className="h-11 w-40 rounded-lg" />
      <Skeleton className="h-4 w-52 mt-2" />
      <div className="flex gap-2 mt-4"><Skeleton className="h-11 w-40 rounded-full" /><Skeleton className="h-11 w-32 rounded-full" /></div>
      <Skeleton className="h-56 w-full rounded-[24px] mt-4" />
      {[0, 1].map(i => (
        <div key={i} className="mt-6 flex flex-col gap-1.5">
          <Skeleton className="h-9 w-32 mb-1" />
          <Skeleton className="h-16 w-full rounded-[16px]" />
          <Skeleton className="h-16 w-full rounded-[16px]" />
        </div>
      ))}
    </div>
  )
}
