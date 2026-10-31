import { useEffect, useState } from "react"

const Q = "(min-width: 1024px)"

/** True on a desktop-width window (Tailwind `lg`). Pages that lay out differently on
 * desktop (2 columns) and phone (one stack in phone order) render ONE of the two. */
export function useIsDesktop() {
  const [is, setIs] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(Q).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(Q)
    if (!mq) return
    const on = () => setIs(mq.matches)
    on()
    mq.addEventListener?.("change", on)
    return () => mq.removeEventListener?.("change", on)
  }, [])
  return is
}
