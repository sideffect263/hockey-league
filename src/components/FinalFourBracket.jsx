import { useMemo } from "react"
import { ageOf, DEFAULT_AGE } from "@/lib/ageGroups"
import { Trophy, Crown, ListOrdered } from "lucide-react"
import { Trophy as TrophyIcon } from "@/components/icons/HockeyIcons"
import { motion } from "framer-motion"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import { TeamLink } from "@/components/EntityLinks"
import { useSeasonName } from "@/App"
import { buildPlayoffs } from "@/lib/playoffs"
import { ilDate } from "@/lib/ilTime"

// Playoffs — the path to the title, shown above the league table on the standings
// page (there is no separate Final Four page). All the RULES live in lib/playoffs.js
// (pinned by scripts/check-playoffs.mjs); this file only draws what it returns.
//
// It opens by itself the moment #1 is mathematically certain: the leader's direct
// semi-final spot shows first, the three series fill in when the table is final,
// the semis/final appear as the league creates those games, and the full 1–7 ranking
// fills in at the end.
//
// Palette is intentionally two-tone: neutral slate for structure, gold for the things
// that matter (winners, the league-winner's path, and the champion).
export default function FinalFourBracket({ teams = [], games = [], championId = null }) {
  const seasonName = useSeasonName()
  const senior = useMemo(() => teams.filter(t => ageOf(t) === DEFAULT_AGE), [teams])
  const byId = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams])
  const po = useMemo(() => buildPlayoffs(senior, games, championId), [senior, games, championId])

  if (senior.length < 7 || !po.visible) return null

  const team = (id) => (id ? byId[id] || null : null)
  const [sA, sB, sC] = po.series
  const champion = team(po.champion)
  const [semi1, semi2] = po.semis
  const finalists = po.final.game
    ? [team(po.final.game.home_team_id), team(po.final.game.away_team_id)]
    : [team(semi1.winner), team(semi2.winner)]
  const thirdTeams = po.third.game
    ? [team(po.third.game.home_team_id), team(po.third.game.away_team_id)]
    : [team(semi1.loser), team(semi2.loser)]
  const showRanking = po.ranking.some(Boolean)
  const connector = "text-slate-300 dark:text-slate-600"

  const status = champion ? null
    : !po.seasonOver ? "מקום ראשון הובטח — הזוגות בסדרות ייקבעו בסיום העונה הסדירה"
    : !semi1.game && !semi2.game ? "זוגות חצי הגמר ייקבעו על ידי הליגה"
    : null

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }} className="space-y-4">
      {/* Section header — champion inline, no separate hero */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-black text-fg-strong flex items-center gap-2">
            <TrophyIcon className="size-6 text-gold" /> פלייאוף
          </h2>
          <p className="text-xs text-fg-muted mt-0.5">
            הדרך לאליפות{seasonName && <> — עונת <bdi dir="ltr">{seasonName}</bdi></>}
            {status && <> · {status}</>}
          </p>
        </div>
        {champion && (
          <span className="flex items-center gap-1.5 text-sm font-bold text-fg-strong bg-gold/[0.12] ring-1 ring-gold/30 rounded-full px-3 py-1.5">
            <Crown className="size-4 text-gold" /> אלופה:
            <TeamLink team={champion} className="text-gold hover:underline">{champion.name}</TeamLink> 🏆
          </span>
        )}
      </div>

      {/* Desktop bracket */}
      <div className="hidden lg:block">
        <div className="card p-6 overflow-hidden">
          <div className="relative grid grid-cols-5 gap-0 items-center" style={{ minHeight: 480 }}>
            {/* Column 1 (right in RTL): Series C + the #1 seed */}
            <div className="flex flex-col justify-center gap-8 px-2">
              <SeriesCard s={sC} label="סדרה C" delay={0} />
              <DirectQualifier team={po.first} delay={0.1} />
            </div>

            {/* Column 2: the semi #1 plays in. Only #1's line is drawn — the other
                pairings are the league's call, so no line pretends to know them. */}
            <div className="flex flex-col justify-center items-center px-2 relative self-stretch">
              <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
                <line x1="100%" y1="70%" x2="58%" y2="50%" stroke="currentColor" className={connector} strokeWidth="2" />
                <line x1="42%" y1="50%" x2="0%" y2="50%" stroke="currentColor" className={connector} strokeWidth="2" />
              </svg>
              <KnockoutCard label="חצי גמר 1" ko={semi1} team={team} fallback={[po.first, null]} delay={0.2} />
            </div>

            {/* Column 3: FINAL */}
            <div className="flex flex-col items-center justify-center px-2">
              <FinalCard teams={finalists} ko={po.final} champion={champion} delay={0.4} />
            </div>

            {/* Column 4: the other semi */}
            <div className="flex flex-col justify-center items-center px-2 relative self-stretch">
              <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
                <line x1="58%" y1="50%" x2="100%" y2="50%" stroke="currentColor" className={connector} strokeWidth="2" />
              </svg>
              <KnockoutCard label="חצי גמר 2" ko={semi2} team={team} delay={0.3} />
            </div>

            {/* Column 5 (left in RTL): Series A + Series B */}
            <div className="flex flex-col justify-center gap-8 px-2">
              <SeriesCard s={sA} label="סדרה A" delay={0.05} />
              <SeriesCard s={sB} label="סדרה B" delay={0.1} />
            </div>
          </div>

          {(po.third.game || semi1.loser || semi2.loser) && (
            <div className="relative mt-4 flex justify-center">
              <div className="w-full max-w-md">
                <ThirdPlaceCard teams={thirdTeams} ko={po.third} delay={0.5} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile bracket (stacked) */}
      <div className="lg:hidden space-y-4">
        <DirectQualifier team={po.first} delay={0} />
        <div className="card p-4">
          <h3 className="text-xs font-bold text-fg-subtle uppercase tracking-wider mb-3 text-center">סדרות</h3>
          <div className="space-y-3">
            <SeriesCard s={sA} label="סדרה A" delay={0.05} />
            <SeriesCard s={sB} label="סדרה B" delay={0.1} />
            <SeriesCard s={sC} label="סדרה C" delay={0.15} />
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-xs font-bold text-fg-subtle uppercase tracking-wider mb-3 text-center">חצי גמר</h3>
          <div className="space-y-3">
            <KnockoutCard label="חצי גמר 1" ko={semi1} team={team} fallback={[po.first, null]} delay={0.2} />
            <KnockoutCard label="חצי גמר 2" ko={semi2} team={team} delay={0.25} />
          </div>
        </div>
        <FinalCard teams={finalists} ko={po.final} champion={champion} delay={0.3} />
        {(po.third.game || semi1.loser || semi2.loser) && (
          <ThirdPlaceCard teams={thirdTeams} ko={po.third} delay={0.35} />
        )}
      </div>

      {/* Places 5–7 + the final 1–7 ranking */}
      {(po.placements.length > 0 || showRanking) && (
        <div data-ff-blocks-link className="grid gap-4 md:grid-cols-2">
          {po.placements.length > 0 && <PlacementCard rows={po.placements} team={team} done={po.placementsDone} />}
          {showRanking && <RankingCard ranking={po.ranking} team={team} />}
        </div>
      )}
    </motion.section>
  )
}

// ============ BRACKET COMPONENTS ============

function Card({ delay, className = "", children }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 shadow-sm ${className}`}
    >
      {children}
    </motion.div>
  )
}

function CardHead({ label, decided }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-[10px] font-bold text-fg-muted bg-surface-inset px-2 py-0.5 rounded-md">{label}</span>
      {decided && <span className="text-[10px] font-bold text-gold">הוכרע</span>}
    </div>
  )
}

const Vs = ({ gold }) => (
  <div className="flex items-center gap-2 px-2">
    <div className={`flex-1 h-px ${gold ? "bg-gold/30" : "bg-slate-200 dark:bg-slate-700"}`} />
    <span className="text-[10px] font-bold text-fg-subtle">VS</span>
    <div className={`flex-1 h-px ${gold ? "bg-gold/30" : "bg-slate-200 dark:bg-slate-700"}`} />
  </div>
)

function TeamSlot({ team, pos, placeholder = "ממתין", isWinner, isLoser, wins }) {
  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
      isWinner
        ? "bg-gold/[0.08] ring-1 ring-gold/30"
        : isLoser
          ? "bg-slate-50 dark:bg-slate-800/50 opacity-50"
          : "bg-white dark:bg-slate-800"
    }`}>
      {team ? (
        <>
          <TeamLogo team={team} size={7} />
          <TeamLink team={team} className="font-semibold text-xs flex-1 truncate text-fg-strong hover:text-brand hover:underline transition-colors">
            {team.name}
          </TeamLink>
          {wins != null && <span className="text-[10px] font-bold text-fg-muted tabular-nums" title="ניצחונות בסדרה">{wins}</span>}
          {pos && <span className="text-[10px] text-fg-subtle font-mono">#{pos}</span>}
          {isWinner && <span className="text-[10px] text-gold">✓</span>}
        </>
      ) : (
        <>
          <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 border-2 border-dashed border-slate-300 dark:border-slate-600" />
          <span className="text-xs text-fg-subtle font-medium">{placeholder}</span>
        </>
      )}
    </div>
  )
}

function GameResult({ game, label }) {
  if (!game) return null
  return (
    <div className="flex items-center justify-between text-[11px] px-2 py-1 bg-surface-inset rounded-md">
      <span className="text-fg-subtle">{label || ""}</span>
      <span className="text-fg-subtle" dir="ltr">{format(ilDate(game.game_date), "d/M")}</span>
      {/* Score is away:home. The spaces around the dash are bidi-neutral, so under RTL
          the two digit runs swap (5 - 2 would read 2 - 5) — dir=ltr pins the order. */}
      {game.status === "completed"
        ? <span dir="ltr" className="font-bold text-fg-strong tabular-nums">{game.away_score} - {game.home_score}</span>
        : <span className="text-fg-muted font-medium">מתוכנן</span>
      }
    </div>
  )
}

const legLabel = (g, i) => (g.series_game === 3 || (!g.series_game && i === 2) ? "הכרעה" : `מ׳ ${g.series_game || i + 1}`)

function SeriesCard({ s, label, delay }) {
  const known = s.t1 && s.t2
  const w = s.winner
  const played = s.games.some(g => g.status === "completed")
  return (
    <Card delay={delay}>
      <CardHead label={label} decided={!!w} />
      <div className="space-y-1.5">
        <TeamSlot team={s.t1} pos={s.p1} placeholder={`מקום ${s.p1}`} wins={known && played ? s.wins[s.t1.id] : null}
          isWinner={w && w === s.t1?.id} isLoser={w && w !== s.t1?.id} />
        <Vs />
        <TeamSlot team={s.t2} pos={s.p2} placeholder={`מקום ${s.p2}`} wins={known && played ? s.wins[s.t2.id] : null}
          isWinner={w && w === s.t2?.id} isLoser={w && w !== s.t2?.id} />
      </div>
      {s.games.length > 0 && (
        <div className="mt-2 space-y-1">
          {s.games.map((g, i) => (
            s.deciderUnneeded && legLabel(g, i) === "הכרעה"
              ? <div key={g.id} className="text-[11px] px-2 py-1 text-fg-subtle text-center">הכרעה — לא נדרשת</div>
              : <GameResult key={g.id} game={g} label={legLabel(g, i)} />
          ))}
        </div>
      )}
      {s.needsDecider && !w && (
        <p className="mt-2 text-[10px] font-semibold text-amber-600 dark:text-amber-400 text-center">שוויון בניצחונות — משחק הכרעה</p>
      )}
    </Card>
  )
}

// The league winner's direct-to-semi card. Given a subtle gold tint (it is the
// team that topped the table) — the gold connector line leads out of it.
function DirectQualifier({ team, delay }) {
  if (!team) return null
  return (
    <motion.div
      data-ff-anchor="direct-qualifier"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      className="bg-gold/[0.06] rounded-xl border border-gold/30 p-3 shadow-sm"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Crown className="w-3.5 h-3.5 text-gold" />
        <span className="text-[10px] font-bold text-gold">מקום 1 — ישיר לחצי הגמר</span>
      </div>
      <div className="flex items-center gap-2 p-2 bg-white/60 dark:bg-slate-800/60 rounded-lg">
        <TeamLogo team={team} size={8} />
        <TeamLink team={team} className="font-bold text-sm text-fg-strong hover:text-brand transition-colors">{team.name}</TeamLink>
        <span className="text-[10px] text-gold font-mono mr-auto">#1</span>
      </div>
    </motion.div>
  )
}

/** A single-game knockout (semi). `fallback` = teams to show before the game exists. */
function KnockoutCard({ label, ko, team, fallback = [null, null], delay }) {
  const g = ko.game
  const [t1, t2] = g ? [team(g.home_team_id), team(g.away_team_id)] : fallback
  return (
    <Card delay={delay} className="w-full max-w-[220px] lg:max-w-none z-10">
      <CardHead label={label} decided={!!ko.winner} />
      <div className="space-y-1.5">
        <TeamSlot team={t1} isWinner={ko.winner && ko.winner === t1?.id} isLoser={ko.loser && ko.loser === t1?.id} />
        <Vs />
        <TeamSlot team={t2} isWinner={ko.winner && ko.winner === t2?.id} isLoser={ko.loser && ko.loser === t2?.id} />
      </div>
      {g && <div className="mt-2"><GameResult game={g} /></div>}
    </Card>
  )
}

function FinalCard({ teams: [t1, t2], ko, champion, delay }) {
  const w = champion?.id || ko.winner
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      className="w-full max-w-[240px] lg:max-w-none mx-auto"
    >
      <div className="relative bg-gold/[0.06] rounded-2xl border-2 border-gold/40 p-4 shadow-lg">
        <div className="flex justify-center mb-3">
          <div className="w-14 h-14 rounded-full bg-gold flex items-center justify-center shadow-lg shadow-gold/30">
            <Trophy className="w-7 h-7 text-white" />
          </div>
        </div>
        <h3 className="text-xs font-bold text-gold text-center uppercase tracking-wider mb-3">גמר</h3>
        <div className="space-y-1.5">
          <TeamSlot team={t1} isWinner={w && w === t1?.id} isLoser={w && t1 && w !== t1.id} />
          <Vs gold />
          <TeamSlot team={t2} isWinner={w && w === t2?.id} isLoser={w && t2 && w !== t2.id} />
        </div>
        {ko.game && <div className="mt-2"><GameResult game={ko.game} /></div>}
        {champion && (
          <div className="mt-3 p-2 bg-gold/[0.12] rounded-lg text-center border border-gold/30">
            <p className="text-[10px] text-gold font-bold mb-1">אלופת הליגה</p>
            <div className="flex items-center justify-center gap-2">
              <TeamLogo team={champion} size={8} />
              <TeamLink team={champion} className="font-extrabold text-sm text-fg-strong hover:text-brand transition-colors">{champion.name}</TeamLink>
              <span className="text-lg">🏆</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function ThirdPlaceCard({ teams: [t1, t2], ko, delay }) {
  return (
    <Card delay={delay} className="p-4">
      <CardHead label="משחק על מקום 3/4" decided={!!ko.winner} />
      <div className="flex items-center gap-3">
        <div className="flex-1"><TeamSlot team={t1} isWinner={ko.winner && ko.winner === t1?.id} isLoser={ko.loser && ko.loser === t1?.id} /></div>
        <span className="text-[10px] font-bold text-fg-subtle">VS</span>
        <div className="flex-1"><TeamSlot team={t2} isWinner={ko.winner && ko.winner === t2?.id} isLoser={ko.loser && ko.loser === t2?.id} /></div>
      </div>
      {ko.game && <div className="mt-2"><GameResult game={ko.game} /></div>}
      {ko.game?.status === "completed" && !ko.winner && (
        <p className="mt-2 text-[10px] text-fg-muted text-center">תיקו — ממתין להכרעת הליגה</p>
      )}
    </Card>
  )
}

function PlacementCard({ rows, team, done }) {
  return (
    <div className="card p-4">
      <h3 className="text-sm font-bold text-fg-strong mb-1">דירוג מקומות 5–7</h3>
      <p className="text-[11px] text-fg-muted mb-3">שלוש המפסידות בסדרות, משחק אחד כל אחת מול כל אחת</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-fg-subtle">
            <th className="text-right font-semibold pb-1">מקום</th>
            <th className="text-right font-semibold pb-1">קבוצה</th>
            <th className="font-semibold pb-1">מש׳</th>
            <th className="font-semibold pb-1">הפרש</th>
            <th className="font-semibold pb-1">נק׳</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-t border-line-subtle">
              <td className="py-1.5 font-bold text-fg-muted">{done ? 5 + i : "—"}</td>
              <td className="py-1.5">
                <span className="flex items-center gap-2"><TeamLogo team={team(r.id)} size={5} />{team(r.id)?.name}</span>
              </td>
              <td className="py-1.5 text-center tabular-nums">{r.played}</td>
              <td className="py-1.5 text-center tabular-nums" dir="ltr">{r.goals_for - r.goals_against}</td>
              <td className="py-1.5 text-center font-bold tabular-nums">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RankingCard({ ranking, team }) {
  return (
    <div className="card p-4">
      <h3 className="text-sm font-bold text-fg-strong mb-3 flex items-center gap-2">
        <ListOrdered className="w-4 h-4 text-gold" /> דירוג סופי
      </h3>
      <ol className="space-y-1.5">
        {ranking.map((id, i) => {
          const t = team(id)
          return (
            <li key={i} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${i === 0 && t ? "bg-gold/[0.1] ring-1 ring-gold/30" : "bg-surface-inset"}`}>
              <span className={`w-5 text-center text-xs font-black ${i === 0 ? "text-gold" : "text-fg-muted"}`}>{i + 1}</span>
              {t ? (
                <>
                  <TeamLogo team={t} size={6} />
                  <TeamLink team={t} className="text-sm font-semibold text-fg-strong hover:text-brand">{t.name}</TeamLink>
                  {i === 0 && <span className="mr-auto">🏆</span>}
                </>
              ) : (
                <span className="text-xs text-fg-subtle">ייקבע</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
