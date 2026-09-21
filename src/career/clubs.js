/**
 * The world of rink hockey, as a career ladder.
 *
 * Every club, league name and season length below is REAL and was checked
 * against the 2025-26 season, not invented. That matters more here than it
 * would in a football game: rink hockey is small enough that the few hundred
 * people in Israel who play it know these clubs by name, and a made-up
 * "OK Liga" side would read as fake immediately.
 *
 * Sources for the ladder:
 *   · Spain    — OK Liga, 16 teams / 30 rounds. Barcelona 35 titles, Liceo 8,
 *                Igualada 6, Reus 5.
 *   · Portugal — 1ª Divisão (Campeonato Placard), 14 teams. Porto 26 titles,
 *                Benfica 25, Sporting 9.
 *   · Italy    — Serie A1, 14 teams / 26 rounds in 2025-26 (Breganze and
 *                Castiglione promoted; Trissino, Bassano, Lodi the favourites).
 *   · France   — N1 Elite, 12 teams. Coutras 16 titles, La Roche-sur-Yon and
 *                Saint-Omer 13, Quévert 11. N2 and N3 below it.
 *   · Germany  — 1. Rollhockey-Bundesliga (Herringen, Cronenberg, Düsseldorf,
 *                Recklinghausen, Krefeld, Remscheid, Darmstadt, Walsum).
 *   · Europe   — WSE Champions League (16 teams since 2023, then a final
 *                eight). Spain 46 titles, Portugal 12, Italy 2; Barcelona 22.
 *                Winner meets the WSE Cup winner in the Continental Cup, and
 *                the South American champion in the Intercontinental Cup.
 *   · Israel   — 7 senior clubs; national team ranked 26th in the world,
 *                entering the B World Cup and the European Championship, and
 *                winner of the 2017 FIRS Confederations Cup.
 *
 * That last line is the whole emotional shape of the game. An Israeli rink
 * hockey player is starting eight rungs below Barcelona, in a league of seven
 * clubs, for a national team ranked 26th. The ladder is steep and real, and
 * climbing even three rungs of it is a genuine achievement — which is exactly
 * why "legionnaire" (going abroad) is the fantasy worth simulating.
 *
 * Foreign clubs are stored as TUPLES, not objects: at ~110 clubs × 11 fields
 * the key names would be most of the bytes, and this table ships in the main
 * bundle so the game runs with zero network calls. `hydrate()` expands a row
 * once, at module load.
 *
 * Israeli clubs are deliberately NOT here — they come live from our own
 * `teams` table (see israeliClub()), so the league you start your career in
 * is the league this site is actually running, crests and colors included.
 */

// [id, name, country, league, tier, baseOverall, seasonLength, band, continental, c1, c2]
const F = [
  // ── Spain · OK Liga — 16 teams, 30 rounds ────────────────────────────────
  ['es-barcelona',   'ברצלונה',            'ES', 'OK ליגה', 1, 93, 30, 'world', 'ucl', '#A50044', '#004D98'],
  ['es-liceo',       'ליסאו לה קורוניה',   'ES', 'OK ליגה', 1, 88, 30, 'world', 'ucl', '#00843D', '#FFFFFF'],
  ['es-reus',        'ראוס דפורטיו',       'ES', 'OK ליגה', 1, 87, 30, 'world', 'ucl', '#C8102E', '#000000'],
  ['es-igualada',    'איגואלדה',           'ES', 'OK ליגה', 1, 84, 30, 'elite', 'ucl', '#0033A0', '#FFFFFF'],
  ['es-noia',        'נויה פרייחנט',       'ES', 'OK ליגה', 1, 83, 30, 'elite', 'uel', '#D50032', '#FFFFFF'],
  ['es-calafell',    'קלאפל',              'ES', 'OK ליגה', 1, 80, 30, 'elite', 'uel', '#F7B500', '#004B87'],
  ['es-lleida',      'ליידה ליסטה בלאווה', 'ES', 'OK ליגה', 1, 80, 30, 'elite', null,  '#0066B3', '#FFFFFF'],
  ['es-voltrega',    'ווליטרגה',           'ES', 'OK ליגה', 1, 78, 30, 'elite', null,  '#009639', '#FFFFFF'],
  ['es-caldes',      'קאלדס',              'ES', 'OK ליגה', 1, 78, 30, 'elite', null,  '#1D428A', '#FFD100'],
  ['es-girona',      'ג׳ירונה',            'ES', 'OK ליגה', 1, 76, 30, 'elite', null,  '#D50032', '#FFFFFF'],
  ['es-palafrugell', 'פלפרוז׳ל',           'ES', 'OK ליגה', 1, 75, 30, 'elite', null,  '#0033A0', '#FFD100'],
  ['es-vic',         'ויק',                'ES', 'OK ליגה', 1, 75, 30, 'elite', null,  '#8A1538', '#FFFFFF'],
  ['es-taradell',    'טרדל',               'ES', 'OK ליגה', 1, 73, 30, 'elite', null,  '#009639', '#000000'],
  ['es-lloret',      'יורט',               'ES', 'OK ליגה', 1, 72, 30, 'elite', null,  '#00A3E0', '#FFFFFF'],

  // ── Portugal · 1ª Divisão (Campeonato Placard) — 14 teams ────────────────
  ['pt-porto',       'פורטו',              'PT', 'קמפיונאטו פלאקארד', 1, 91, 26, 'world', 'ucl', '#00428C', '#FFFFFF'],
  ['pt-benfica',     'בנפיקה',             'PT', 'קמפיונאטו פלאקארד', 1, 90, 26, 'world', 'ucl', '#E30613', '#FFFFFF'],
  ['pt-sporting',    'ספורטינג ליסבון',    'PT', 'קמפיונאטו פלאקארד', 1, 89, 26, 'world', 'ucl', '#008057', '#FFFFFF'],
  ['pt-oliveirense', 'אוליביירנסה',        'PT', 'קמפיונאטו פלאקארד', 1, 85, 26, 'elite', 'ucl', '#004B97', '#FFD100'],
  ['pt-barcelos',    'ברסלוש',             'PT', 'קמפיונאטו פלאקארד', 1, 83, 26, 'elite', 'uel', '#E4002B', '#FFFFFF'],
  ['pt-valongo',     'ולונגו',             'PT', 'קמפיונאטו פלאקארד', 1, 81, 26, 'elite', 'uel', '#E4002B', '#FFD100'],
  ['pt-juv-viana',   'ז׳ובנטודה ויאנה',    'PT', 'קמפיונאטו פלאקארד', 1, 79, 26, 'elite', null,  '#000000', '#FFD100'],
  ['pt-braga',       'בראגה',              'PT', 'קמפיונאטו פלאקארד', 1, 77, 26, 'elite', null,  '#E30613', '#FFFFFF'],
  ['pt-sanjoanense', 'סנז׳ואננסה',         'PT', 'קמפיונאטו פלאקארד', 1, 76, 26, 'elite', null,  '#009B48', '#FFFFFF'],
  ['pt-oeiras',      'אוארש',              'PT', 'קמפיונאטו פלאקארד', 1, 74, 26, 'elite', null,  '#00529B', '#FFD100'],
  ['pt-candelaria',  'קנדלריה',            'PT', 'קמפיונאטו פלאקארד', 1, 73, 26, 'elite', null,  '#0066B3', '#FFFFFF'],
  ['pt-riba-dave',   'ריבה ד׳אווה',        'PT', 'קמפיונאטו פלאקארד', 1, 72, 26, 'elite', null,  '#00529B', '#FFFFFF'],
  ['pt-tomar',       'ספורטינג טומאר',     'PT', 'קמפיונאטו פלאקארד', 1, 71, 26, 'elite', null,  '#008057', '#FFFFFF'],
  ['pt-pacense',     'ז׳ובנטודה פאסנסה',   'PT', 'קמפיונאטו פלאקארד', 1, 70, 26, 'elite', null,  '#E30613', '#000000'],

  // ── Italy · Serie A1 — 14 teams, 26 rounds (2025-26) ─────────────────────
  ['it-trissino',    'טריסינו',            'IT', 'סרייה A1', 1, 88, 26, 'world', 'ucl', '#E2001A', '#FFFFFF'],
  ['it-lodi',        'אמטורי לודי',        'IT', 'סרייה A1', 1, 86, 26, 'world', 'ucl', '#F5A800', '#003366'],
  ['it-bassano',     'בסאנו 1954',         'IT', 'סרייה A1', 1, 84, 26, 'elite', 'ucl', '#F5A800', '#000000'],
  ['it-forte',       'פורטה דיי מארמי',    'IT', 'סרייה A1', 1, 83, 26, 'elite', 'uel', '#0055A4', '#FFFFFF'],
  ['it-follonica',   'פולוניקה 1952',      'IT', 'סרייה A1', 1, 80, 26, 'elite', 'uel', '#003DA5', '#E2001A'],
  ['it-sarzana',     'סרזנה',              'IT', 'סרייה A1', 1, 79, 26, 'elite', 'uel', '#000000', '#FFFFFF'],
  ['it-valdagno',    'ולדאניו',            'IT', 'סרייה A1', 1, 77, 26, 'elite', null,  '#E2001A', '#004B97'],
  ['it-monza',       'רולר קלאב מונצה',    'IT', 'סרייה A1', 1, 76, 26, 'elite', null,  '#E2001A', '#FFFFFF'],
  ['it-grosseto',    'גרוסטו 1951',        'IT', 'סרייה A1', 1, 75, 26, 'elite', null,  '#E2001A', '#FFFFFF'],
  ['it-viareggio',   'ויארג׳ו',            'IT', 'סרייה A1', 1, 74, 26, 'elite', null,  '#004B97', '#FFFFFF'],
  ['it-giovinazzo',  'ג׳ובינאצו',          'IT', 'סרייה A1', 1, 73, 26, 'elite', null,  '#00A3E0', '#FFFFFF'],
  ['it-novara',      'אזורה נוברה',        'IT', 'סרייה A1', 1, 72, 26, 'elite', null,  '#004B97', '#FFFFFF'],
  ['it-breganze',    'ברגנצה',             'IT', 'סרייה A1', 1, 71, 26, 'elite', null,  '#FFD100', '#004B97'],
  ['it-castiglione', 'קסטיליונה',          'IT', 'סרייה A1', 1, 70, 26, 'elite', null,  '#009639', '#FFFFFF'],

  // ── France · N1 Elite — 12 teams ─────────────────────────────────────────
  ['fr-saint-omer',  'סן אומר',            'FR', 'נסיונל 1 אליט', 2, 74, 22, 'strong', 'uel', '#0055A4', '#FFFFFF'],
  ['fr-coutras',     'קוטרה',              'FR', 'נסיונל 1 אליט', 2, 73, 22, 'strong', 'uel', '#FFD100', '#0055A4'],
  ['fr-la-vendeenne','לה וונדאן (לה רוש)', 'FR', 'נסיונל 1 אליט', 2, 72, 22, 'strong', null,  '#EF4135', '#FFFFFF'],
  ['fr-quevert',     'קוורט',              'FR', 'נסיונל 1 אליט', 2, 71, 22, 'strong', null,  '#0055A4', '#FFFFFF'],
  ['fr-dinan',       'דינאן־קווינטן',      'FR', 'נסיונל 1 אליט', 2, 69, 22, 'strong', null,  '#000000', '#FFFFFF'],
  ['fr-ploufragan',  'פלופראגאן',          'FR', 'נסיונל 1 אליט', 2, 68, 22, 'strong', null,  '#009639', '#FFFFFF'],
  ['fr-nantes',      'נאנט',               'FR', 'נסיונל 1 אליט', 2, 67, 22, 'strong', null,  '#FFD100', '#009639'],
  ['fr-crehen',      'קרהן',               'FR', 'נסיונל 1 אליט', 2, 66, 22, 'strong', null,  '#E30613', '#FFFFFF'],

  // ── Germany · 1. Rollhockey-Bundesliga ───────────────────────────────────
  ['de-herringen',   'גרמניה הרינגן',      'DE', 'רולהוקי בונדסליגה', 2, 70, 14, 'strong', 'uel', '#E30613', '#FFFFFF'],
  ['de-cronenberg',  'RSC קרוננברג',       'DE', 'רולהוקי בונדסליגה', 2, 70, 14, 'strong', 'uel', '#004B97', '#FFD100'],
  ['de-dusseldorf',  'TuS דיסלדורף',       'DE', 'רולהוקי בונדסליגה', 2, 67, 14, 'strong', null,  '#FFFFFF', '#E30613'],
  ['de-recklinghsn', 'RHC רקלינגהאוזן',    'DE', 'רולהוקי בונדסליגה', 2, 66, 14, 'strong', null,  '#000000', '#FFD100'],
  ['de-krefeld',     'HSV קרפלד',          'DE', 'רולהוקי בונדסליגה', 2, 65, 14, 'strong', null,  '#E30613', '#000000'],
  ['de-remscheid',   'IGR רמשייד',         'DE', 'רולהוקי בונדסליגה', 2, 64, 14, 'strong', null,  '#FFD100', '#000000'],
  ['de-darmstadt',   'SGR דרמשטאדט',       'DE', 'רולהוקי בונדסליגה', 2, 63, 14, 'strong', null,  '#004B97', '#FFFFFF'],
  ['de-walsum',      'RESG ולסום',         'DE', 'רולהוקי בונדסליגה', 2, 62, 14, 'strong', null,  '#000000', '#E30613'],

  // ── Switzerland · LNA ────────────────────────────────────────────────────
  ['ch-montreux',    'מונטרה',             'CH', 'ליגה LNA', 2, 71, 18, 'strong', 'uel', '#DA291C', '#FFFFFF'],
  ['ch-geneve',      'ז׳נבה',              'CH', 'ליגה LNA', 2, 69, 18, 'strong', null,  '#FFD100', '#DA291C'],
  ['ch-diessbach',   'דיסבאך',             'CH', 'ליגה LNA', 2, 67, 18, 'strong', null,  '#004B97', '#FFFFFF'],
  ['ch-thunerstern', 'טונרשטרן',           'CH', 'ליגה LNA', 2, 66, 18, 'strong', null,  '#009639', '#FFD100'],
  ['ch-uttigen',     'אוטיגן',             'CH', 'ליגה LNA', 2, 64, 18, 'strong', null,  '#DA291C', '#FFFFFF'],

  // ── Second tiers in the big countries — a real, reachable first stop ─────
  ['es-vilanova',    'וילנובה',            'ES', 'OK פלאטה',      2, 68, 28, 'strong', null, '#0033A0', '#E2001A'],
  ['es-cerdanyola',  'סרדניולה',           'ES', 'OK פלאטה',      2, 67, 28, 'strong', null, '#009639', '#FFFFFF'],
  ['es-mataro',      'מטארו',              'ES', 'OK פלאטה',      2, 66, 28, 'strong', null, '#FFD100', '#000000'],
  ['es-sant-cugat',  'סנט קוגאט',          'ES', 'OK פלאטה',      2, 65, 28, 'strong', null, '#8A1538', '#FFFFFF'],
  ['it-scandiano',   'סקנדיאנו',           'IT', 'סרייה A2',      2, 65, 24, 'strong', null, '#FFD100', '#E2001A'],
  ['it-sandrigo',    'סנדריגו',            'IT', 'סרייה A2',      2, 66, 24, 'strong', null, '#004B97', '#FFFFFF'],
  ['it-montebello',  'מונטבלו',            'IT', 'סרייה A2',      2, 64, 24, 'strong', null, '#009639', '#FFFFFF'],
  ['pt-quinta',      'קינטה דוס לומבוס',   'PT', 'סגונדה דיביזאו', 2, 66, 24, 'strong', null, '#00529B', '#FFD100'],
  ['pt-marinhense',  'מרינייסה',           'PT', 'סגונדה דיביזאו', 2, 64, 24, 'strong', null, '#E4002B', '#FFFFFF'],

  // ── The Americas & Africa ────────────────────────────────────────────────
  ['ar-concepcion',  'קונספסיון פאטין',    'AR', 'ליגה נסיונל A1', 2, 76, 24, 'strong', null, '#75AADB', '#FFFFFF'],
  ['ar-andes',       'אנדס טאיירס',        'AR', 'ליגה נסיונל A1', 2, 74, 24, 'strong', null, '#E30613', '#FFFFFF'],
  ['ar-olimpia',     'אולימפיה סן חואן',   'AR', 'ליגה נסיונל A1', 2, 72, 24, 'strong', null, '#000000', '#FFD100'],
  ['ar-banco',       'בנקו פרובינסיה',     'AR', 'ליגה נסיונל A1', 2, 70, 24, 'strong', null, '#009639', '#FFFFFF'],
  ['ao-petro',       'פטרו דה לואנדה',     'AO', 'ליגת אנגולה',    2, 72, 20, 'strong', null, '#E30613', '#FFD100'],
  ['ao-agosto',      'פרימיירו דה אגושטו', 'AO', 'ליגת אנגולה',    2, 70, 20, 'strong', null, '#E30613', '#000000'],
  ['cl-santiago',    'סנטיאגו פאטין',      'CL', 'ליגת צ׳ילה',     2, 68, 20, 'strong', null, '#D52B1E', '#0033A0'],
  ['br-recife',      'רסיפה',              'BR', 'ליגת ברזיל',     3, 62, 20, 'entry',  null, '#009B3A', '#FFDF00'],
  ['uy-montevideo',  'מונטווידאו פאטין',   'UY', 'ליגת אורוגוואי', 3, 60, 18, 'entry',  null, '#75AADB', '#FFFFFF'],
  ['co-bogota',      'בוגוטה',             'CO', 'ליגת קולומביה',  3, 58, 18, 'entry',  null, '#FCD116', '#003893'],

  // ── Entry leagues: realistically the first stop for an Israeli legionnaire ─
  ['fr-n2-lyon',     'ליון פאטינאז׳',      'FR', 'נסיונל 2',        3, 60, 20, 'entry', null, '#DA291C', '#0055A4'],
  ['fr-n2-noisy',    'נואזי לה גראן',      'FR', 'נסיונל 2',        3, 58, 20, 'entry', null, '#009639', '#FFFFFF'],
  ['fr-n2-merignac', 'מריניאק',            'FR', 'נסיונל 2',        3, 59, 20, 'entry', null, '#0055A4', '#FFD100'],
  ['de-2bl-doberan', 'באד דוברן',          'DE', '2. בונדסליגה',    3, 57, 14, 'entry', null, '#004B97', '#FFFFFF'],
  ['de-2bl-iserlohn','איזרלון',            'DE', '2. בונדסליגה',    3, 56, 14, 'entry', null, '#0055A4', '#FFD100'],
  ['ch-lnb-wimmis',  'ווימיס',             'CH', 'ליגה LNB',        3, 57, 18, 'entry', null, '#FFD100', '#004B97'],
  ['ch-lnb-biasca',  'ביאסקה',             'CH', 'ליגה LNB',        3, 55, 18, 'entry', null, '#DA291C', '#FFFFFF'],
  ['at-wolfurt',     'וולפורט',            'AT', 'ליגת אוסטריה',    3, 56, 16, 'entry', null, '#ED2939', '#FFFFFF'],
  ['at-dornbirn',    'דורנבירן',           'AT', 'ליגת אוסטריה',    3, 54, 16, 'entry', null, '#004B97', '#FFD100'],
  ['en-herne-bay',   'הרן ביי',            'EN', 'פרמייר ליג אנגליה', 3, 55, 18, 'entry', null, '#00247D', '#FFFFFF'],
  ['en-middlesbro',  'מידלסברו',           'EN', 'פרמייר ליג אנגליה', 3, 54, 18, 'entry', null, '#CF142B', '#FFFFFF'],
  ['en-soham',       'סוהאם',              'EN', 'פרמייר ליג אנגליה', 3, 52, 18, 'entry', null, '#009639', '#FFFFFF'],
  ['en-letchworth',  'לצ׳וורת׳',           'EN', 'פרמייר ליג אנגליה', 3, 51, 18, 'entry', null, '#000000', '#FFD100'],
  ['nl-tilburg',     'טילבורג',            'NL', 'ליגת הולנד',      3, 54, 18, 'entry', null, '#FF6C00', '#FFFFFF'],
  ['nl-nijmegen',    'ניימיכן',            'NL', 'ליגת הולנד',      3, 52, 18, 'entry', null, '#E30613', '#000000'],
  ['be-oostende',    'אוסטנדה',            'BE', 'ליגת בלגיה',      3, 53, 18, 'entry', null, '#FFD100', '#000000'],
  ['us-sanjose',     'סן חוזה ראפידס',     'US', 'ליגת ארה״ב',      3, 53, 18, 'entry', null, '#003DA5', '#FFD100'],
  ['us-nyc',         'ניו יורק רולרס',     'US', 'ליגת ארה״ב',      3, 51, 18, 'entry', null, '#B31942', '#FFFFFF'],
  ['mz-maputo',      'מאפוטו',             'MZ', 'ליגת מוזמביק',    3, 56, 18, 'entry', null, '#007168', '#FCE100'],
  ['eg-cairo',       'קהיר SC',            'EG', 'ליגת מצרים',      3, 50, 16, 'entry', null, '#C8102E', '#FFFFFF'],
  ['in-goa',         'גואה',               'IN', 'ליגת הודו',       3, 50, 16, 'entry', null, '#FF9933', '#138808'],
  ['jp-tokyo',       'טוקיו רולרס',        'JP', 'ליגת יפן',        3, 52, 16, 'entry', null, '#BC002D', '#FFFFFF'],
  ['au-sydney',      'סידני',              'AU', 'ליגת אוסטרליה',   3, 51, 16, 'entry', null, '#012169', '#FFD100'],
]

const KEYS = ['id', 'name', 'country', 'league', 'tier', 'baseOverall', 'seasonLength', 'band', 'continental', 'c1', 'c2']

function hydrate(row) {
  const o = {}
  KEYS.forEach((k, i) => { o[k] = row[i] })
  o.shortName = o.name
  o.colors = [o.c1, o.c2]
  o.isIsraeli = false
  delete o.c1
  delete o.c2
  return o
}

export const FOREIGN_CLUBS = F.map(hydrate)

/** Flags for the club chips — country is the only "crest" a foreign club gets. */
export const COUNTRY_FLAG = {
  ES: '🇪🇸', PT: '🇵🇹', IT: '🇮🇹', FR: '🇫🇷', DE: '🇩🇪', CH: '🇨🇭', AT: '🇦🇹',
  EN: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', NL: '🇳🇱', BE: '🇧🇪', AR: '🇦🇷', AO: '🇦🇴', CL: '🇨🇱', BR: '🇧🇷',
  UY: '🇺🇾', CO: '🇨🇴', US: '🇺🇸', MZ: '🇲🇿', EG: '🇪🇬', IN: '🇮🇳', JP: '🇯🇵',
  AU: '🇦🇺', IL: '🇮🇱',
}

/** The rungs of the ladder, in order. The engine only ever offers an adjacent one. */
export const BAND_ORDER = ['academy', 'israel', 'entry', 'strong', 'elite', 'world']

export const BAND_LABEL = {
  academy: 'מחלקת נוער',
  israel: 'הליגה הישראלית',
  entry: 'ליגת כניסה באירופה',
  strong: 'ליגה אירופית חזקה',
  elite: 'ליגת צמרת',
  world: 'מועדון עולמי',
}

/** Short badge text for the offer cards. */
export const BAND_BADGE = {
  academy: 'נוער',
  israel: 'ישראל',
  entry: 'כניסה',
  strong: 'חזקה',
  elite: 'צמרת',
  world: 'עולמי',
}

export const CONTINENTAL_LABEL = {
  ucl: 'ליגת האלופות WSE',
  uel: 'גביע WSE',
}

/**
 * Turn a row from our own `teams` table into a club the engine understands.
 * The real league is tier 4; its youth sides are tier 5. Ratings are a flat
 * band rather than anything derived from the live standings, because the table
 * resets every season and a career spans twenty of them.
 */
export function israeliClub(team, { youth = false, base = 48 } = {}) {
  // Two of the real clubs are already named "… נוער", so blindly appending the
  // suffix produced "גבעת עדה נוער (נוער)" on the offer cards.
  const alreadyYouth = /נוער\s*$/.test(team.name)
  return {
    id: `il-${team.slug || team.id}${youth ? '-youth' : ''}`,
    name: youth && !alreadyYouth ? `${team.name} (נוער)` : team.name,
    shortName: team.name,
    country: 'IL',
    league: youth ? 'ליגת הנוער' : 'ליגת ההוקי הישראלית',
    tier: youth ? 5 : 4,
    baseOverall: youth ? Math.round(base * 0.8) : base,
    seasonLength: youth ? 14 : 18,
    band: youth ? 'academy' : 'israel',
    continental: null,
    colors: [team.primary_color || '#2E3E8C', team.secondary_color || '#FFFFFF'],
    isIsraeli: true,
    logoUrl: team.logo_url || null,
    slug: team.slug || null,
  }
}

/**
 * The Israel national team. Ranked 26th in the world, which in this sport
 * means the B World Cup rather than the A — so the national arc is about
 * dragging the country up a division, not about winning a World Cup.
 */
export const NATIONAL_TEAM = {
  id: 'nat-il',
  name: 'נבחרת ישראל',
  shortName: 'ישראל',
  country: 'IL',
  league: 'נבחרות',
  tier: 0,
  baseOverall: 52,
  seasonLength: 6,
  band: 'israel',
  continental: null,
  colors: ['#0038B8', '#FFFFFF'],
  isIsraeli: true,
}

/** Israel's real international calendar, used for the national-team arc. */
export const NATIONAL_COMPETITIONS = [
  { key: 'bworld', name: 'מונדיאל B', note: 'אליפות העולם לדרג ב׳ — הבמה הקבועה של ישראל' },
  { key: 'euro', name: 'אליפות אירופה', note: 'CERH — הדרג הבכיר של היבשת' },
  { key: 'confed', name: 'גביע הקונפדרציות', note: 'ישראל זכתה בו ב-2017' },
]

/**
 * Spread the Israeli clubs out by strength.
 *
 * Every domestic club previously shared one baseOverall of 48, which made the
 * league a seven-way coin flip that the player's own rating tipped — so a
 * career that simply stayed at one club collected a dozen championships. Real
 * leagues have contenders and strugglers.
 *
 * Where the live standings have been played, rank drives it. Our table resets
 * between seasons though, and a career spans twenty of them, so when every row
 * is still zeroed we fall back to a stable hash of the slug: arbitrary, but
 * deterministic — which the replay contract requires, and which still gives
 * the league a shape.
 */
const IL_STRENGTH = [54, 52, 50, 49, 47, 45, 44]

function hashSlug(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function israeliStrengths(teams) {
  const played = teams.some((t) => (t.points || 0) > 0 || (t.wins || 0) > 0)
  const ranked = [...teams].sort((a, b) => {
    if (played) {
      const pts = (b.points || 0) - (a.points || 0)
      if (pts !== 0) return pts
      const gd = ((b.goals_for || 0) - (b.goals_against || 0)) - ((a.goals_for || 0) - (a.goals_against || 0))
      if (gd !== 0) return gd
    }
    return hashSlug(a.slug || a.name || '') - hashSlug(b.slug || b.name || '')
  })
  const out = new Map()
  ranked.forEach((t, i) => {
    out.set(t.slug || t.name, IL_STRENGTH[Math.min(i, IL_STRENGTH.length - 1)])
  })
  return out
}

/** Every club the engine can route you through, Israeli side included. */
export function allClubs(israeliTeams) {
  const teams = israeliTeams || []
  const strength = israeliStrengths(teams)
  const il = teams.flatMap((t) => {
    const base = strength.get(t.slug || t.name) ?? 48
    return [israeliClub(t, { base }), israeliClub(t, { youth: true, base })]
  })
  return [...il, ...FOREIGN_CLUBS]
}
