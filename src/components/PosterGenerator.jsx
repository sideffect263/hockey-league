import { useState, useRef } from 'react'
import { X, Download, Image, Loader2, Sparkles } from 'lucide-react'
import { Calendar, MatchFallback as Swords } from "@/components/icons/BrandIcons"
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { generateMatchDayPoster, generateSingleMatchPoster, downloadCanvas } from '@/lib/posterGenerator'
import { ilDate } from "@/lib/ilTime"

export default function PosterGenerator({ games, teams, teamsMap, onClose }) {
  const [tab, setTab] = useState('matchday')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedGameId, setSelectedGameId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [canvasEl, setCanvasEl] = useState(null)
  const [useAi, setUseAi] = useState(false)
  const [aiError, setAiError] = useState(false)
  const previewRef = useRef(null)

  const scheduledGames = games.filter(g => g.status === 'scheduled')

  const uniqueDates = [...new Set(scheduledGames.map(g => format(ilDate(g.game_date), 'yyyy-MM-dd')))].sort()

  const gamesOnDate = selectedDate
    ? scheduledGames.filter(g => format(ilDate(g.game_date), 'yyyy-MM-dd') === selectedDate)
        .sort((a, b) => new Date(a.game_date) - new Date(b.game_date))
    : []

  const handleGenerate = async () => {
    setGenerating(true)
    setCanvasEl(null)
    setAiError(false)
    try {
      let canvas
      const opts = { useAi }
      if (tab === 'matchday') {
        canvas = await generateMatchDayPoster(gamesOnDate, teamsMap, opts)
      } else {
        const game = games.find(g => g.id === selectedGameId)
        if (!game) return
        canvas = await generateSingleMatchPoster(game, teamsMap, opts)
      }
      setCanvasEl(canvas)
      if (previewRef.current) {
        previewRef.current.innerHTML = ''
        canvas.style.maxWidth = '100%'
        canvas.style.height = 'auto'
        canvas.style.borderRadius = '12px'
        previewRef.current.appendChild(canvas)
      }
    } catch (err) {
      console.error('Poster generation failed:', err)
      if (useAi) {
        setAiError(true)
      }
      alert('שגיאה ביצירת הפוסטר')
    } finally {
      setGenerating(false)
    }
  }

  const handleDownload = () => {
    if (!canvasEl) return
    const name = tab === 'matchday'
      ? `matchday-${selectedDate}.png`
      : `match-${selectedGameId.slice(0, 8)}.png`
    downloadCanvas(canvasEl, name)
  }

  const canGenerate = tab === 'matchday' ? gamesOnDate.length > 0 : !!selectedGameId

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <Image className="w-5 h-5 text-purple-500" /> יצירת פוסטר
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => { setTab('matchday'); setCanvasEl(null) }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                tab === 'matchday'
                  ? 'bg-purple-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Calendar className="w-4 h-4" /> יום משחקים
            </button>
            <button
              onClick={() => { setTab('single'); setCanvasEl(null) }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                tab === 'single'
                  ? 'bg-purple-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Swords className="w-4 h-4" /> משחק בודד
            </button>
          </div>

          {/* AI Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border border-purple-200 dark:border-purple-800/50">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <span className="text-sm font-semibold text-purple-800 dark:text-purple-300">רקע AI מקצועי</span>
              <span className="text-xs text-purple-500 dark:text-purple-400">(DALL·E 3)</span>
            </div>
            <button
              onClick={() => { setUseAi(!useAi); setCanvasEl(null); setAiError(false) }}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                useAi ? 'bg-purple-500' : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                useAi ? 'translate-x-5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {aiError && (
            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-lg">
              רקע AI לא זמין — השתמשנו ברקע רגיל. ודא שמפתח OpenAI מוגדר ב-Vercel.
            </div>
          )}

          {/* Match Day controls */}
          {tab === 'matchday' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">בחר תאריך</label>
                <select
                  value={selectedDate}
                  onChange={e => { setSelectedDate(e.target.value); setCanvasEl(null) }}
                  className="filter-select w-full"
                >
                  <option value="">— בחר תאריך —</option>
                  {uniqueDates.map(d => (
                    <option key={d} value={d}>
                      {format(new Date(d), 'dd/MM/yyyy')} ({scheduledGames.filter(g => format(ilDate(g.game_date), 'yyyy-MM-dd') === d).length} משחקים)
                    </option>
                  ))}
                </select>
              </div>
              {gamesOnDate.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{gamesOnDate.length} משחקים בתאריך זה:</p>
                  {gamesOnDate.map(g => (
                    <div key={g.id} className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                      <span>{teamsMap[g.home_team_id]?.name} vs {teamsMap[g.away_team_id]?.name}</span>
                      <span className="text-xs text-slate-400">{format(ilDate(g.game_date), 'HH:mm')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Single Match controls */}
          {tab === 'single' && (
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">בחר משחק</label>
              <select
                value={selectedGameId}
                onChange={e => { setSelectedGameId(e.target.value); setCanvasEl(null) }}
                className="filter-select w-full"
              >
                <option value="">— בחר משחק —</option>
                {scheduledGames.sort((a, b) => new Date(a.game_date) - new Date(b.game_date)).map(g => (
                  <option key={g.id} value={g.id}>
                    {teamsMap[g.home_team_id]?.name} vs {teamsMap[g.away_team_id]?.name} — {format(ilDate(g.game_date), 'dd/MM HH:mm')}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || generating}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-purple-500 text-white text-sm font-bold rounded-xl hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {useAi ? 'יוצר רקע AI...' : 'יוצר פוסטר...'}</>
            ) : (
              <>{useAi ? <Sparkles className="w-4 h-4" /> : <Image className="w-4 h-4" />} צור פוסטר</>
            )}
          </button>

          {/* Preview */}
          <div ref={previewRef} className="rounded-xl overflow-hidden" />

          {/* Download button */}
          {canvasEl && (
            <button
              onClick={handleDownload}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-green-500 text-white text-sm font-bold rounded-xl hover:bg-green-600 transition-colors"
            >
              <Download className="w-4 h-4" /> הורד תמונה
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}
