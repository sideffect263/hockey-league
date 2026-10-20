// The page a person sees when they open /api/mcp in a browser — how to connect the
// league to Claude / ChatGPT / Cursor. MCP clients POST and never see it.
// Underscore prefix: Vercel does not turn this file into its own function.

export function mcpLandingHtml({ endpoint, site, tools }) {
  const examples = [
    'מתי יש משחק קרוב לבית לחם הגלילית?',
    'מתי רמת ישי משחקת הבאה?',
    'מה המצב בטבלה?',
    'מי מלך השערים של הליגה?',
    'מה היו התוצאות בשבת האחרונה?',
    'איפה משחקת קריית מוצקין בבית?',
  ]
  const toolText = {
    upcoming_games: ['📅', 'משחקים קרובים', 'מתי, איפה ומי — לפי קבוצה או לפי מקום ("קרוב אליי")'],
    recent_results: ['🏁', 'תוצאות', 'התוצאות האחרונות, של כל הליגה או של קבוצה אחת'],
    standings: ['🏆', 'טבלה', 'נקודות, ניצחונות, הפסדים ושערים'],
    top_scorers: ['🎯', 'מלך השערים', 'הכובשים המובילים בליגה או בקבוצה'],
    rinks: ['📍', 'מגרשים', 'איפה משחקים ומי הקבוצות הביתיות בכל מגרש'],
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>הליגה בתוך Claude · ליגת הוקי גלגיליות</title>
<meta name="description" content="חברו את ליגת הוקי הגלגיליות ל-Claude, ChatGPT או Cursor ושאלו מתי המשחק הבא, מה המצב בטבלה ומי מלך השערים.">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ליגת הוקי גלגיליות">
<meta property="og:locale" content="he_IL">
<meta property="og:url" content="${esc(endpoint)}">
<meta property="og:title" content="הליגה, בתוך Claude">
<meta property="og:description" content="חברו את ליגת הוקי הגלגיליות ל-Claude או ChatGPT ושאלו מתי המשחק הבא, איפה, מה המצב בטבלה ומי מלך השערים.">
<meta property="og:image" content="${site}/og/mcp.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="הליגה, בתוך Claude — rinkhockeyil.com/api/mcp">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="הליגה, בתוך Claude">
<meta name="twitter:description" content="שאלו את ה-AI מתי המשחק הבא, איפה, מה המצב בטבלה ומי מלך השערים.">
<meta name="twitter:image" content="${site}/og/mcp.png">
<link rel="icon" href="${site}/logos/crest-256.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;800&display=swap">
<style>
  :root {
    --bg: #f4f6fc; --card: #ffffff; --text: #141a3a; --muted: #5b6386; --line: #e1e5f2;
    --brand: #3B4FC4; --brand-deep: #1E2A78; --gold: #E5B843; --code: #eef1fb; --ok: #109669;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0b1028; --card: #141b3d; --text: #eef0fb; --muted: #a3abd0; --line: #252e5c;
      --brand: #4E6DF0; --brand-deep: #28368c; --gold: #EBBE50; --code: #1c2550; --ok: #2fbf8a;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 Heebo, system-ui, sans-serif; }
  a { color: var(--brand); }
  .wrap { max-width: 760px; margin: 0 auto; padding: 0 16px 56px; }

  header.hero { background: linear-gradient(160deg, #1E2A78, #3B4FC4 70%); color: #fff; padding: 40px 16px 72px; text-align: center; }
  .hero img { width: 84px; height: 84px; border-radius: 50%; background: #fff; padding: 6px; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
  .hero h1 { margin: 16px 0 6px; font-size: clamp(26px, 6vw, 38px); font-weight: 800; line-height: 1.2; }
  .hero h1 span { color: var(--gold); }
  .hero p { margin: 0 auto; max-width: 520px; opacity: .9; font-size: 17px; }

  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; margin-top: 16px; }
  .card.lift { margin-top: -44px; box-shadow: 0 10px 30px rgba(20,26,58,.12); }
  h2 { font-size: 20px; margin: 0 0 12px; font-weight: 800; }
  .muted { color: var(--muted); }

  .url { display: flex; gap: 8px; align-items: stretch; margin-top: 8px; }
  .url code { flex: 1; min-width: 0; direction: ltr; text-align: left; background: var(--code); border-radius: 10px; padding: 12px 14px;
              font: 600 15px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  button { font: inherit; cursor: pointer; }
  .btn { border: 0; border-radius: 10px; background: var(--brand); color: #fff; font-weight: 700; padding: 0 18px; white-space: nowrap; }
  .btn:active { transform: translateY(1px); }
  .btn.done { background: var(--ok); }

  .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .tab { border: 1px solid var(--line); background: transparent; color: var(--text); border-radius: 999px; padding: 6px 14px; font-weight: 600; }
  .tab[aria-selected="true"] { background: var(--brand); border-color: var(--brand); color: #fff; }
  .panel[hidden] { display: none; }
  ol.steps { margin: 0; padding: 0; list-style: none; counter-reset: s; }
  ol.steps li { counter-increment: s; position: relative; padding: 0 40px 14px 0; }
  ol.steps li::before { content: counter(s); position: absolute; right: 0; top: 0; width: 28px; height: 28px; border-radius: 50%;
                        background: var(--brand); color: #fff; font-weight: 800; display: grid; place-items: center; font-size: 14px; }
  kbd, .k { background: var(--code); border-radius: 6px; padding: 1px 7px; font-weight: 600; white-space: nowrap; }
  pre { direction: ltr; text-align: left; background: var(--code); border-radius: 10px; padding: 12px 14px; overflow-x: auto;
        font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 8px 0 0; }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { border: 1px solid var(--line); background: var(--code); color: var(--text); border-radius: 12px; padding: 8px 12px; text-align: right; }
  .chip:hover { border-color: var(--brand); }
  .chip.done { border-color: var(--ok); }

  .tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .tool { border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
  .tool b { display: block; }
  .tool .i { font-size: 22px; }

  .safe { display: flex; gap: 12px; align-items: flex-start; }
  .safe .i { font-size: 26px; line-height: 1; }
  footer { text-align: center; margin-top: 28px; font-size: 14px; }
</style>
</head>
<body>
<header class="hero">
  <img src="${site}/logos/crest-256.png" alt="">
  <h1>הליגה, <span>בתוך Claude</span></h1>
  <p>חברו את ליגת הוקי הגלגיליות לעוזר ה-AI שלכם ושאלו אותו בעברית רגילה: מתי המשחק הבא, איפה, מה המצב בטבלה ומי מלך השערים.</p>
</header>

<main class="wrap">
  <section class="card lift">
    <h2>הכתובת להעתקה</h2>
    <div class="muted">את זה מדביקים בהגדרות של Claude / ChatGPT / Cursor. אין צורך בהרשמה או בסיסמה.</div>
    <div class="url">
      <code id="endpoint">${esc(endpoint)}</code>
      <button class="btn" data-copy="${esc(endpoint)}" data-label="העתקה">העתקה</button>
    </div>
  </section>

  <section class="card">
    <h2>איך מחברים</h2>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" aria-selected="true" data-tab="claude">Claude</button>
      <button class="tab" role="tab" aria-selected="false" data-tab="chatgpt">ChatGPT</button>
      <button class="tab" role="tab" aria-selected="false" data-tab="dev">Cursor / Claude Code</button>
    </div>

    <div class="panel" data-panel="claude">
      <ol class="steps">
        <li>נכנסים ל-<a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">claude.ai</a>, ובהגדרות בוחרים <span class="k">Connectors</span> (מהמחשב או מהדפדפן).</li>
        <li>לוחצים <span class="k">Add custom connector</span>.</li>
        <li>בשם כותבים <span class="k">ליגת הוקי גלגיליות</span>, ובכתובת מדביקים את הכתובת שלמעלה. <span class="k">Add</span>.</li>
        <li>בצ'אט חדש, בתפריט הכלים (ליד תיבת ההודעה) מוודאים שהמחבר דלוק — ושואלים.</li>
      </ol>
      <div class="muted">אחרי שמחברים פעם אחת, המחבר זמין גם באפליקציית Claude בטלפון.</div>
    </div>

    <div class="panel" data-panel="chatgpt" hidden>
      <ol class="steps">
        <li>ב-ChatGPT: <span class="k">Settings ← Apps &amp; Connectors ← Advanced</span> ומדליקים <span class="k">Developer mode</span>.</li>
        <li>חוזרים ל-<span class="k">Apps &amp; Connectors</span> ולוחצים <span class="k">Create</span>.</li>
        <li>שם: <span class="k">ליגת הוקי גלגיליות</span>, כתובת: הכתובת שלמעלה, אימות: <span class="k">No authentication</span>.</li>
        <li>בצ'אט חדש בוחרים את המחבר מתפריט ה-<span class="k">+</span> ושואלים.</li>
      </ol>
      <div class="muted">מצב מפתחים של ChatGPT זמין רק בחלק מהמנויים.</div>
    </div>

    <div class="panel" data-panel="dev" hidden>
      <div><b>הכי פשוט:</b> מבקשים מהעוזר להתקין לבד. מעתיקים ושולחים לו:</div>
      <div class="chips" style="margin:8px 0 16px">
        <button class="chip" data-copy="תתקין לי את שרת ה-MCP הזה: ${esc(endpoint)}">תתקין לי את שרת ה-MCP הזה: <span dir="ltr">${esc(endpoint)}</span></button>
      </div>
      <div class="muted" style="margin-bottom:14px">עובד בכלים שמריצים פקודות במחשב (Claude Code, Cursor). אחרי ההתקנה פותחים שיחה חדשה. ב-claude.ai וב-ChatGPT העוזר לא יכול לשנות את ההגדרות של עצמו — שם מחברים לפי השלבים בלשוניות האחרות.</div>
      <div><b>או ידנית — Claude Code</b>, בטרמינל:</div>
      <pre>claude mcp add --transport http rinkhockeyil ${esc(endpoint)}</pre>
      <div style="margin-top:14px"><b>Cursor</b> — בקובץ <span class="k" dir="ltr">~/.cursor/mcp.json</span>:</div>
      <pre>{
  "mcpServers": {
    "rinkhockeyil": { "url": "${esc(endpoint)}" }
  }
}</pre>
    </div>
  </section>

  <section class="card">
    <h2>מה לשאול</h2>
    <div class="muted" style="margin-bottom:10px">לחיצה מעתיקה את השאלה — הדביקו אותה בצ'אט.</div>
    <div class="chips">
      ${examples.map(q => `<button class="chip" data-copy="${esc(q)}">${esc(q)}</button>`).join('\n      ')}
    </div>
  </section>

  <section class="card">
    <h2>מה הוא יודע</h2>
    <div class="tools">
      ${tools.map(t => toolText[t]).filter(Boolean).map(([i, name, d]) =>
        `<div class="tool"><span class="i">${i}</span><b>${name}</b><span class="muted">${d}</span></div>`).join('\n      ')}
    </div>
    <div class="muted" style="margin-top:12px">הנתונים חיים — אותו מידע שמופיע באתר, מתעדכן ברגע שמשחק נקבע או נגמר.</div>
  </section>

  <section class="card safe">
    <span class="i">🔒</span>
    <div>
      <b>מידע ציבורי בלבד, קריאה בלבד</b>
      <div class="muted">המחבר רואה רק את מה שכל מבקר באתר רואה — לוח משחקים, תוצאות, טבלה ושערים. אין לו גישה לפרטים אישיים, לחשבונות או למידע רפואי, והוא לא יכול לשנות שום דבר.</div>
    </div>
  </section>

  <footer class="muted">
    <a href="${site}">rinkhockeyil.com</a> · ליגת הוקי גלגיליות
  </footer>
</main>

<script>
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy) } catch { return }
    b.classList.add('done')
    if (b.dataset.label) b.textContent = 'הועתק ✓'
    setTimeout(() => { b.classList.remove('done'); if (b.dataset.label) b.textContent = b.dataset.label }, 1600)
  }))
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', String(x === t)))
    document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== t.dataset.tab })
  }))
</script>
</body>
</html>`
}
