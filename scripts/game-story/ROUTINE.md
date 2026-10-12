# סיפור המשחק — the game-story routine

You write the story of finished games in the Israeli rink-hockey league (הוקי גלגיליות,
rinkhockeyil.com), so a game page is more than a score. Each story is saved as a **draft**;
a content editor reads it, edits it and publishes it. You never publish anything yourself.

Everything goes through `scripts/game-story/story.mjs` (it holds the API; `GAME_STORY_TOKEN`
must be exported). Work from the repo root of the clone (`hockey-league/` if the clone has it
as a subfolder — find `scripts/game-story/story.mjs`).

## 1. Pick the games

```
node scripts/game-story/story.mjs queue 8 > /tmp/queue.json
```

Games with no story yet, those with media first. Unless the prompt names specific game ids,
write stories for up to **8** games from the top of the queue in this run. If the queue is
empty, say so and stop.

## 2. For each game: gather

```
node scripts/game-story/story.mjs bundle <game_id> /tmp/gs/<game_id>
```

This writes `/tmp/gs/<game_id>/facts.json` and downloads every frame/photo to
`/tmp/gs/<game_id>/media/`. Read facts.json fully. Then **look at the images** (Read the
.jpg files): every `media[].video.frames[].file` (highlight clips, in order), every
`media[].image_file`, and a few `recordings[].frames[].file` (full-game recordings — wide shots).

What the facts mean:
- `score` / `halftime` — final and half-time score. `home` is the host.
- `box_score.home/away` — who scored, cards, clean sheets; `season_goals_after_this_game`
  lets you say "his 5th of the season". `box_score.recorded=false` → no per-player data
  exists for this game; do not name scorers at all.
- `table_before` / `table_after` / `rank_change` — the league table around this game.
  `null` rank before = this was the team's first game of the season.
- `form_before` — each team's previous results (W/D/L). `head_to_head` — earlier meetings.
- `media[].text` — the caption a league editor wrote on that highlight. Captions are the
  ONLY source for the order of events and who did what in a clip.
- `season_status: "archived"` → this is a past season; write it in the past, as history.

## 3. Write

Hebrew, the voice of a good local sports reporter: warm, specific, never hype for its own sake.

**The one hard rule: every sentence must be true and checkable.** Facts come from facts.json;
the look and feel (colours, the rink, light, the crowd, the bench, a celebration, a save
visible in a frame) from the images. When you don't know something, leave it out — a
shorter true story beats a longer invented one. Specifically NEVER:
- invent a goal time, an assist, a sequence, a quote, an injury, a tactic or a turning point
  that is not in the facts or plainly visible;
- identify a person from their face or body. A name may appear only if it is in facts.json
  (box score, MVP, or a caption that names them). Jersey numbers in frames don't count;
- mention ages, birthdays, schools, family, or anything about a player's life off the rink;
- judge the referee, or criticise a player by name;
- say "רולר" or "הוקי קרח" — the sport is **הוקי גלגיליות**.

Scores in prose: winner's goals first, with an en dash and no spaces — "8–4 לגבעת עדה נוער",
"תיקו 4–4". Halftime the same way.

Output, as JSON (`/tmp/gs/<game_id>/story.json`):
```json
{
  "game_id": "<uuid>",
  "title": "headline, 8-120 chars — teams + what happened, no clickbait",
  "summary": "one sentence, 40-220 chars — the result and why it matters (it is also the page's search snippet)",
  "body": "4-7 paragraphs separated by ONE blank line (\n\n). 600-2500 chars is the sweet spot.",
  "moments": [ { "label": "short tag e.g. 'דקה של שוויון' / 'המחצית'", "text": "1-2 sentences", "post_id": "<the highlight post it describes, if any>" } ],
  "hero_image_url": "the frame/photo URL (the `url`, not the local file) that best shows THIS game — wide action, both colours, no face filling the frame. Omit if none fits.",
  "media_post_ids": ["post ids whose clips/photos you actually looked at"],
  "generated_by": "routine"
}
```

Shape of the body:
1. The lede — result, place, date ("בשבת, 10 באוקטובר, באולם בקריית ביאליק…"), what it means.
2. How it unfolded — halftime score if known, the captions' sequence, what the frames show.
3. The people — scorers (with season tallies), MVP, goalkeeper clean sheet, cards — only from the box score.
4. Context — table before → after, form, head-to-head history.
5. A closing line — what's next for both (only if the facts say; otherwise a neutral close).

No markdown, no emoji, no hashtags, no links in the body (the page links scorers and teams itself).
`moments`: 0-6 items; for games with highlight posts, one per meaningful clip, in order.
Games without media: no moments, no hero — a solid, accurate text story from the numbers.

## 4. Save as a draft

```
node scripts/game-story/story.mjs save /tmp/gs/<game_id>/story.json
```

If it refuses (a length or media check), fix the JSON and save again. Never pass
`replace_published`. If `existing_story_status` is `published`, skip that game.

## 5. Report

End with a short report: each game (date, teams, score), the title you saved, how many
frames you looked at, and anything you left out because it wasn't verifiable. Never commit or
push anything.
