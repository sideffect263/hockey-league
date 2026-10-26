# rinkhockeyIL brand icons

Our own icon set, approved one by one (started 2026-10-26). Style: 24×24 grid, 2pt round stroke in `currentColor`,
detail lines at 35% opacity, orange ball #EA580C (white highlight) or brand-blue #3B4FC4 dot as the accent.
Source of truth for the later pass that makes iOS, Android and web use the same art everywhere.
Inventory of what these replace: ../mockups/mobile-icon-inventory.html

Each meaning gets a **large** detailed version (32px and up) and a **small** version (16–24px) of the same drawing.

| Files | Meaning | Replaces | Approved |
|---|---|---|---|
| goal-large.svg, goal-small.svg | Goal / scoring (גול) | ⚽, SF `soccerball`, Material `SportsSoccer`/`SportsScore`, `flag.checkered`, `target`/`scope` | 2026-10-26 |
| (component) + match-fallback-large/-small.svg | Match (משחק): the two teams' real crests (`team-logos/{id}/cutout.png`) with the orange ball between them; the score replaces the ball once there is one. `match-fallback-large/-small.svg` (crossed rink sticks + ball, picked 2026-10-26) where there is no specific game | 🏒, SF `figure.hockey` (game uses), Material `SportsHockey` (section headers), `Scoreboard` | 2026-10-26 |
| player-pose-1..4.svg (+ `-small`) | Player (שחקן): traced from real league player cutouts (hockey-photos/cutouts), posterized to brand blues + orange ball; `-small` = one-colour silhouette (`currentColor`). 1 stick out front, 2 stride, 3 ready, 4 lunge | SF `figure.hockey` (player uses), `tshirt.fill`, Material `SportsHockey` (player uses) | 2026-10-26 |
| rink-large.svg, rink-small.svg | Rink / court (מגרש): top-down line style, real rink proportions, speckled blue floor, orange ball on the centre spot | SF `sportscourt`/`sportscourt.fill`, Material `Scoreboard` (rink uses) | 2026-10-26 |
| goalkeeper-large.svg, goalkeeper-small.svg, save-small.svg | Goalkeeper (שוער): large = traced real league goalkeeper going down (pad + blocker); small = cage helmet (position badge); save-small = blocker + ball (saves in match stats) | 🧤, SF `hand.raised.fill` (GK badge), Material `FrontHand` | 2026-10-26 (small ones provisional) |
| card-blue-small.svg, card-yellow-small.svg, card-red-small.svg, cards-small.svg | Penalty cards (כרטיסים): tilted card with edge, shine, shadow; `cards-small` = blue+yellow+red fanned. Large = referee-*-large.svg | 🟦 🟥, SF `rectangle.portrait.fill`/`rectangle.fill`, Material `Square` | 2026-10-26 |
| referee-blue-large.svg, referee-yellow-large.svg, referee-red-large.svg | Card given (large): traced real league referee (orange shirt) holding up the card | the card moment in live game / match centre | 2026-10-26 |
| referee-large.svg, referee-small.svg | Referee / judge (שופט): large: traced real league referee signalling, orange shirt (hand redrawn where the photo cut it). small = orange referee polo | SF `gavel`/`gavel.fill` (blank on iOS), `hammer.fill`, Material `Gavel` | 2026-10-26 |
| medic-large.svg, medic-small.svg, officials-small.svg | Medic (חובש): white uniform shirt with reflective sleeves and a red Star of David badge; officials-small = referee polo + medic shirt (בעלי תפקיד) | SF `cross.case`, Material `MedicalServices` (medic uses), ⚖️ in officials notifications | 2026-10-26 |
| medal-1/2/3-small.svg | Podium medals: gold/silver/bronze on brand-blue ribbon with the number | 🥇 🥈 🥉 | 2026-10-26 |
| crown-small.svg | Leader / top scorer (מלך השערים) / winner badge: gold crown, orange-ball jewel | 👑, SF `crown`/`crown.fill` (leader uses) | 2026-10-26 |
| captain-small.svg | Captain (קפטן): gold armband with C | SF `crown`/`crown.fill` (captain uses) | 2026-10-26 |
| trophy-large.svg, trophy-small.svg | Trophy / champions / tournaments (גביע): our player pose cast in gold on a navy base, ball on the plinth | 🏆, SF `trophy`/`trophy.fill`/`rosette`, Material `EmojiEvents`/`WorkspacePremium` | 2026-10-26 |
| og-badge.svg | OG (first 25): vintage leather quad skate on the OG navy/gold roundel; one file for all sizes | 🎩 | 2026-10-26 |
| hot-large.svg, hot-small.svg | Hot / on fire (top scorers, big games, hot markets): our ball flying with a flame trail | 🔥, SF `flame`/`flame.fill`, Material `LocalFireDepartment` | 2026-10-26 |
| hattrick-large.svg, hattrick-small.svg | Hat-trick (שלושער): three balls in the net (+ gold 3 on large) | 🎩 (hat-trick uses) | 2026-10-26 |
| clock-large.svg, clock-small.svg, timeout-small.svg, break-small.svg | Game clock (judge tab, Live Activity timer); timeout = stopwatch + T sign; break between halves = stopwatch + pause bars | SF `stopwatch`/`timer`/`pause`, Material `SkipNext`, ⏱️ ⏸️ | 2026-10-26 |
| live-small.svg, broadcast-large.svg, broadcast-small.svg, watch-large.svg, watch-small.svg | Live now (red dot + waves); go live (phone on tripod filming the rink); watch live (screen with rink + play) | SF `dot.radiowaves*`, `iphone.radiowaves*`, `video*`, `play.tv`, Material `Sensors`, `Videocam`, `FiberManualRecord`, 🎥 📺 | 2026-10-26 |
| highlights-large.svg, highlights-small.svg, play-large.svg, video-library-small.svg | Video / highlights (film strip with game frames), play overlay on thumbnails, video library | SF `film`, `play.circle*`, `play.rectangle*`, Material `Movie`, `OndemandVideo`, `VideoLibrary`, `PlayCircle*` | 2026-10-26 |
| calendar-large.svg, calendar-small.svg, calendar-{add,ok,busy,move,time}-small.svg | Calendar / fixtures (matchday page); badges: add (+), available (✓), can't make it (✕), game moved (swap), upcoming (clock) | SF `calendar*`, Material `CalendarMonth`, `EditCalendar`, `EventBusy`, 🗓️ | 2026-10-26 |
| waiting-large/-small.svg, reminder-large/-small.svg, time-small.svg, history-small.svg | Waiting (hourglass, orange sand), reminder/deadline (ringing alarm clock), time (clock), history (clock + back arrow) | ⏳ ⏰, SF `hourglass`, `clock*`, Material `HourglassTop/Bottom`, `Schedule`, `History` | 2026-10-26 |
| location-large.svg, location-small.svg, venue-small.svg | Location / venue: brand pin with our rink in the head on a folded map; small pin with ball; venue pin with tiny rink | 📍, SF `mappin*`, `pin.fill`, Material `LocationOn`, `Place` | 2026-10-26 |
| medical-large/-small.svg, injury-large/-small.svg | Medical certificate (form with heart, heartbeat, approved stamp, stethoscope); injury / can't play (plasters) | 🩺 🚑, SF `heart.text.square*`, Material `HealthAndSafety` | 2026-10-26 |
| team-large.svg, teams-small.svg, squad-large/-small.svg | Team (blue shield, gold rim, traced player); teams list (two shields); squad/roster (three traced players side by side; three jerseys) | SF `person.2*`, `person.3*`, Material `Group`, `Groups`, `RecentActors` | 2026-10-26 |
| profile-large.svg, person-small.svg, person-{add,follow,following,claim,remove}-small.svg, coach-small.svg | Profile (gold-rim player card); person; add (+), follow (★), following/approved (✓), claim card (?), remove/release (−); coach (clipboard) | SF `person*` (incl. blank `person.badge.checkmark`), Material `Person*`, `HowToReg`, `GroupAdd`, 🙋 🧑‍🏫 | 2026-10-26 |
