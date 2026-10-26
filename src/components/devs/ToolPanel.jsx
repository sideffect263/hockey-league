import { lazy, Suspense, useEffect, useState } from "react"
import { BrainCircuit, Box, Video, Sparkles, BarChart3, Images, Smartphone, FlaskConical, Camera, Loader2 } from "lucide-react"
import { Film } from "@/components/icons/BrandIcons"
import VideoLab from "@/components/creators/VideoLab"
import { MediaClusters } from "@/pages/Media"
import ClustersAdmin from "@/components/admin/ClustersAdmin"
import { getPlayers } from "@/lib/api"
import { LAB_FOCUS } from "@/lib/stageWork"

// three.js is big — only the 3D tool loads it.
const Scene3DTab = lazy(() => import("@/components/creators/Scene3D"))

/** lucide icons referenced by name in src/lib/stageWork.js (TOOLS). */
export const ICONS = { Film, BrainCircuit, Box, Video, Sparkles, BarChart3, Images, Smartphone, FlaskConical, Camera }

const spinner = <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>

function Clusters() {
  // ClustersAdmin needs the roster to assign a face cluster to a player.
  const [players, setPlayers] = useState(null)
  useEffect(() => { getPlayers().then(setPlayers).catch(() => setPlayers([])) }, [])
  return players === null ? spinner : <ClustersAdmin players={players} />
}

/** One of the tools moved from /creators, or a narrowed lab view ("lab-match" …). */
export default function ToolPanel({ tool }) {
  if (LAB_FOCUS[tool]) return <VideoLab focus={LAB_FOCUS[tool]} />
  switch (tool) {
    case "lab": return <VideoLab />
    case "scene3d": return <Suspense fallback={spinner}><Scene3DTab /></Suspense>
    case "media": return <MediaClusters />
    case "clusters": return <Clusters />
    default: return null
  }
}
