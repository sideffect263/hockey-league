import { BRAND_ORANGE } from './brand'
import { getTeamLogoPath } from './posterTeamLogos'
import { getAiBackground } from './posterAiBackground'
import { format } from 'date-fns'

const W = 1080, H = 1080
const FONT = 'Rubik'
const LEAGUE_LOGO_PATH = '/logos/main-logo.png'

// ─── Helpers ──────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    img.src = src
  })
}

async function ensureFont() {
  await document.fonts.load(`bold 48px ${FONT}`)
  await document.fonts.load(`800 72px ${FONT}`)
}

function drawCircularImage(ctx, img, x, y, radius) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2)
  ctx.restore()
}

function drawCircleFallback(ctx, x, y, radius, color, letter) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = color || '#6366f1'
  ctx.fill()
  ctx.font = `bold ${radius}px ${FONT}`
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(letter, x, y + 2)
  ctx.restore()
}

function drawLogoNatural(ctx, img, x, y, maxSize) {
  const aspect = img.naturalWidth / img.naturalHeight
  let drawW, drawH
  if (aspect >= 1) {
    drawW = maxSize
    drawH = maxSize / aspect
  } else {
    drawH = maxSize
    drawW = maxSize * aspect
  }
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 25
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 5
  ctx.drawImage(img, x - drawW / 2, y - drawH / 2, drawW, drawH)
  ctx.restore()
}

async function loadTeamLogo(team) {
  const path = getTeamLogoPath(team)
  if (!path) return null
  try { return await loadImage(path) } catch { return null }
}

function drawDiagonalStripes(ctx, w, h, color, alpha = 0.06) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  for (let i = -h; i < w + h; i += 60) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + h, h)
    ctx.stroke()
  }
  ctx.restore()
}

function drawAngularShape(ctx, points, color, alpha = 1) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function formatHebrewDate(dateStr) {
  const d = new Date(dateStr)
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  const day = days[d.getDay()]
  return `יום ${day} | ${format(d, 'dd/MM/yyyy')}`
}

function formatTime(dateStr) {
  return format(new Date(dateStr), 'HH:mm')
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}

function drawTextWithShadow(ctx, text, x, y, shadowOpts = {}) {
  ctx.save()
  ctx.shadowColor = shadowOpts.color || 'rgba(0,0,0,0.7)'
  ctx.shadowBlur = shadowOpts.blur || 8
  ctx.shadowOffsetX = shadowOpts.offsetX || 0
  ctx.shadowOffsetY = shadowOpts.offsetY || 2
  ctx.fillText(text, x, y)
  ctx.restore()
}

// ─── Match Day Poster ─────────────────────────────────────

export async function generateMatchDayPoster(games, teamsMap, options = {}) {
  await ensureFont()

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  let usedAi = false

  if (options.useAi) {
    const aiBg = await getAiBackground(BRAND_ORANGE, '#3b82f6', 'matchday')
    if (aiBg) {
      ctx.drawImage(aiBg, 0, 0, W, H)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, 0, W, H)
      usedAi = true
    }
  }

  if (!usedAi) {
    const bg = ctx.createLinearGradient(0, 0, W, H)
    bg.addColorStop(0, '#1a1a2e')
    bg.addColorStop(0.4, '#16213e')
    bg.addColorStop(1, '#0f3460')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    drawDiagonalStripes(ctx, W, H, BRAND_ORANGE, 0.04)
    drawAngularShape(ctx, [[0, 0], [400, 0], [0, 250]], BRAND_ORANGE, 0.12)
    drawAngularShape(ctx, [[W, H], [W - 400, H], [W, H - 250]], '#e94560', 0.12)
  }

  // Top accent bar
  const topBar = ctx.createLinearGradient(0, 0, W, 0)
  topBar.addColorStop(0, BRAND_ORANGE)
  topBar.addColorStop(1, '#e94560')
  ctx.fillStyle = topBar
  ctx.fillRect(0, 0, W, 6)

  // League logo
  try {
    const logo = await loadImage(LEAGUE_LOGO_PATH)
    drawCircularImage(ctx, logo, W / 2, 80, 50)
  } catch {}

  // Title
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 64px ${FONT}`
  ctx.fillStyle = '#ffffff'
  drawTextWithShadow(ctx, 'יום משחקים', W / 2, 175, { blur: 12 })

  // Date
  if (games.length > 0) {
    ctx.font = `600 30px ${FONT}`
    const dateGrad = ctx.createLinearGradient(W / 2 - 200, 0, W / 2 + 200, 0)
    dateGrad.addColorStop(0, BRAND_ORANGE)
    dateGrad.addColorStop(1, '#8AA0FF') // brand-light — lighter royal-blue endpoint
    ctx.fillStyle = dateGrad
    drawTextWithShadow(ctx, formatHebrewDate(games[0].game_date), W / 2, 225)
  }

  // Divider line
  const divGrad = ctx.createLinearGradient(240, 0, W - 240, 0)
  divGrad.addColorStop(0, 'transparent')
  divGrad.addColorStop(0.5, 'rgba(249,115,22,0.5)')
  divGrad.addColorStop(1, 'transparent')
  ctx.strokeStyle = divGrad
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(240, 260)
  ctx.lineTo(W - 240, 260)
  ctx.stroke()

  // Game cards
  const cardAreaTop = 290
  const cardAreaHeight = H - cardAreaTop - 80
  const cardH = Math.min(220, cardAreaHeight / games.length - 20)
  const totalCardsH = games.length * cardH + (games.length - 1) * 20
  const startY = cardAreaTop + (cardAreaHeight - totalCardsH) / 2

  for (let i = 0; i < games.length; i++) {
    const game = games[i]
    const homeTeam = teamsMap[game.home_team_id]
    const awayTeam = teamsMap[game.away_team_id]
    const y = startY + i * (cardH + 20)

    ctx.save()
    const cardX = 60, cardW = W - 120
    ctx.beginPath()
    ctx.roundRect(cardX, y, cardW, cardH, 20)
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()

    const centerY = y + cardH / 2
    const logoSize = Math.min(110, cardH * 0.44)

    // Home team (right — RTL)
    const homeX = W - 180
    const homeLogo = homeTeam ? await loadTeamLogo(homeTeam) : null
    if (homeLogo) {
      drawLogoNatural(ctx, homeLogo, homeX, centerY - 15, logoSize)
    } else if (homeTeam) {
      drawCircleFallback(ctx, homeX, centerY - 15, logoSize / 2, homeTeam.primary_color, homeTeam.name[0])
    }
    ctx.textAlign = 'center'
    ctx.font = `700 20px ${FONT}`
    ctx.fillStyle = '#ffffff'
    if (homeTeam) drawTextWithShadow(ctx, homeTeam.name, homeX, centerY + logoSize / 2 + 20)

    // Away team (left)
    const awayX = 180
    const awayLogo = awayTeam ? await loadTeamLogo(awayTeam) : null
    if (awayLogo) {
      drawLogoNatural(ctx, awayLogo, awayX, centerY - 15, logoSize)
    } else if (awayTeam) {
      drawCircleFallback(ctx, awayX, centerY - 15, logoSize / 2, awayTeam.primary_color, awayTeam.name[0])
    }
    ctx.textAlign = 'center'
    ctx.font = `700 20px ${FONT}`
    ctx.fillStyle = '#ffffff'
    if (awayTeam) drawTextWithShadow(ctx, awayTeam.name, awayX, centerY + logoSize / 2 + 20)

    // VS badge
    ctx.beginPath()
    ctx.arc(W / 2, centerY - 10, 28, 0, Math.PI * 2)
    const vsBg = ctx.createRadialGradient(W / 2, centerY - 10, 0, W / 2, centerY - 10, 28)
    vsBg.addColorStop(0, BRAND_ORANGE)
    vsBg.addColorStop(1, '#2E3EA8') // brand-hover — darker royal-blue edge
    ctx.fillStyle = vsBg
    ctx.fill()
    ctx.font = `800 22px ${FONT}`
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('VS', W / 2, centerY - 8)

    // Time
    ctx.font = `700 26px ${FONT}`
    ctx.fillStyle = BRAND_ORANGE
    ctx.fillText(formatTime(game.game_date), W / 2, centerY + 30)

    // Venue
    if (game.venue) {
      ctx.font = `400 18px ${FONT}`
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText(game.venue, W / 2, centerY + 58)
    }
  }

  // Bottom bar
  ctx.fillStyle = 'rgba(249,115,22,0.15)'
  ctx.fillRect(0, H - 50, W, 50)
  ctx.font = `500 16px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.textAlign = 'center'
  ctx.fillText('ליגת הוקי גלגיליות ישראל', W / 2, H - 22)

  const botBar = ctx.createLinearGradient(0, 0, W, 0)
  botBar.addColorStop(0, BRAND_ORANGE)
  botBar.addColorStop(1, '#e94560')
  ctx.fillStyle = botBar
  ctx.fillRect(0, H - 6, W, 6)

  return canvas
}

// ─── Single Match Poster ──────────────────────────────────

export async function generateSingleMatchPoster(game, teamsMap, options = {}) {
  await ensureFont()

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  const homeTeam = teamsMap[game.home_team_id]
  const awayTeam = teamsMap[game.away_team_id]
  const homeColor = homeTeam?.primary_color || BRAND_ORANGE
  const awayColor = awayTeam?.primary_color || '#3b82f6'

  let usedAi = false

  if (options.useAi) {
    const aiBg = await getAiBackground(homeColor, awayColor, 'single')
    if (aiBg) {
      ctx.drawImage(aiBg, 0, 0, W, H)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.fillRect(0, 0, W, H)
      usedAi = true
    }
  }

  if (!usedAi) {
    // Fallback: existing gradient background
    ctx.fillStyle = '#080818'
    ctx.fillRect(0, 0, W, H)

    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`
      ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1)
    }

    // Home streak
    ctx.save()
    const homeStreakGrad = ctx.createLinearGradient(W, 0, W / 2 - 100, H / 2)
    homeStreakGrad.addColorStop(0, homeColor)
    homeStreakGrad.addColorStop(0.6, homeColor + 'AA')
    homeStreakGrad.addColorStop(1, 'transparent')
    ctx.fillStyle = homeStreakGrad
    ctx.beginPath()
    ctx.moveTo(W + 50, -50)
    ctx.lineTo(W / 2 + 40, H / 2 - 30)
    ctx.lineTo(W / 2 - 40, H / 2 + 30)
    ctx.lineTo(W + 50, H * 0.35)
    ctx.closePath()
    ctx.globalAlpha = 0.5
    ctx.fill()
    ctx.restore()

    ctx.save()
    const homeInner = ctx.createLinearGradient(W, 0, W / 2, H / 2)
    homeInner.addColorStop(0, homeColor)
    homeInner.addColorStop(0.5, homeColor + '80')
    homeInner.addColorStop(1, 'transparent')
    ctx.fillStyle = homeInner
    ctx.beginPath()
    ctx.moveTo(W + 30, 0)
    ctx.lineTo(W / 2 + 15, H / 2 - 10)
    ctx.lineTo(W / 2 - 15, H / 2 + 10)
    ctx.lineTo(W + 30, H * 0.2)
    ctx.closePath()
    ctx.globalAlpha = 0.35
    ctx.fill()
    ctx.restore()

    // Away streak
    ctx.save()
    const awayStreakGrad = ctx.createLinearGradient(0, H, W / 2 + 100, H / 2)
    awayStreakGrad.addColorStop(0, awayColor)
    awayStreakGrad.addColorStop(0.6, awayColor + 'AA')
    awayStreakGrad.addColorStop(1, 'transparent')
    ctx.fillStyle = awayStreakGrad
    ctx.beginPath()
    ctx.moveTo(-50, H + 50)
    ctx.lineTo(W / 2 - 40, H / 2 + 30)
    ctx.lineTo(W / 2 + 40, H / 2 - 30)
    ctx.lineTo(-50, H * 0.65)
    ctx.closePath()
    ctx.globalAlpha = 0.5
    ctx.fill()
    ctx.restore()

    ctx.save()
    const awayInner = ctx.createLinearGradient(0, H, W / 2, H / 2)
    awayInner.addColorStop(0, awayColor)
    awayInner.addColorStop(0.5, awayColor + '80')
    awayInner.addColorStop(1, 'transparent')
    ctx.fillStyle = awayInner
    ctx.beginPath()
    ctx.moveTo(-30, H)
    ctx.lineTo(W / 2 - 15, H / 2 + 10)
    ctx.lineTo(W / 2 + 15, H / 2 - 10)
    ctx.lineTo(-30, H * 0.8)
    ctx.closePath()
    ctx.globalAlpha = 0.35
    ctx.fill()
    ctx.restore()

    // Particles
    ctx.save()
    for (let i = 0; i < 40; i++) {
      const t = Math.random()
      ctx.globalAlpha = Math.random() * 0.4
      ctx.fillStyle = homeColor
      ctx.beginPath()
      ctx.arc(
        W * (1 - t) + (W / 2) * t + (Math.random() - 0.5) * 120,
        -50 * (1 - t) + (H / 2) * t + (Math.random() - 0.5) * 80,
        Math.random() * 3 + 1, 0, Math.PI * 2
      )
      ctx.fill()
    }
    for (let i = 0; i < 40; i++) {
      const t = Math.random()
      ctx.globalAlpha = Math.random() * 0.4
      ctx.fillStyle = awayColor
      ctx.beginPath()
      ctx.arc(
        (W / 2) * t + (Math.random() - 0.5) * 120,
        H * (1 - t) + (H / 2) * t + (Math.random() - 0.5) * 80,
        Math.random() * 3 + 1, 0, Math.PI * 2
      )
      ctx.fill()
    }
    ctx.restore()

    // Center glow
    const centerGlow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 250)
    centerGlow.addColorStop(0, 'rgba(255,255,255,0.12)')
    centerGlow.addColorStop(0.3, 'rgba(249,115,22,0.06)')
    centerGlow.addColorStop(1, 'transparent')
    ctx.fillStyle = centerGlow
    ctx.fillRect(0, 0, W, H)
  }

  // Top accent bar
  const topBar = ctx.createLinearGradient(0, 0, W, 0)
  topBar.addColorStop(0, homeColor)
  topBar.addColorStop(1, awayColor)
  ctx.fillStyle = topBar
  ctx.fillRect(0, 0, W, 5)

  // League logo
  try {
    const logo = await loadImage(LEAGUE_LOGO_PATH)
    drawCircularImage(ctx, logo, W / 2, 70, 40)
  } catch {}

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 24px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  drawTextWithShadow(ctx, 'ליגת הוקי גלגיליות', W / 2, 125)

  // --- Team logos: diagonal positioning, natural shape ---
  const logoSize = 310
  const homeX = W - 220
  const homeY = H / 2 - 150
  const awayX = 220
  const awayY = H / 2 + 110

  // Home team glow (upper-right)
  ctx.save()
  const homeGlow = ctx.createRadialGradient(homeX, homeY, 0, homeX, homeY, logoSize * 0.7)
  homeGlow.addColorStop(0, homeColor + '40')
  homeGlow.addColorStop(1, 'transparent')
  ctx.fillStyle = homeGlow
  ctx.beginPath()
  ctx.arc(homeX, homeY, logoSize * 0.7, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const homeLogo = homeTeam ? await loadTeamLogo(homeTeam) : null
  if (homeLogo) {
    drawLogoNatural(ctx, homeLogo, homeX, homeY, logoSize)
  } else if (homeTeam) {
    drawCircleFallback(ctx, homeX, homeY, logoSize / 2, homeColor, homeTeam.name[0])
  }

  // Home team name
  ctx.textAlign = 'center'
  ctx.font = `800 34px ${FONT}`
  ctx.fillStyle = '#ffffff'
  if (homeTeam) drawTextWithShadow(ctx, homeTeam.name, homeX, homeY + logoSize / 2 + 30, { blur: 12 })

  // Away team glow (lower-left)
  ctx.save()
  const awayGlow = ctx.createRadialGradient(awayX, awayY, 0, awayX, awayY, logoSize * 0.7)
  awayGlow.addColorStop(0, awayColor + '40')
  awayGlow.addColorStop(1, 'transparent')
  ctx.fillStyle = awayGlow
  ctx.beginPath()
  ctx.arc(awayX, awayY, logoSize * 0.7, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const awayLogo = awayTeam ? await loadTeamLogo(awayTeam) : null
  if (awayLogo) {
    drawLogoNatural(ctx, awayLogo, awayX, awayY, logoSize)
  } else if (awayTeam) {
    drawCircleFallback(ctx, awayX, awayY, logoSize / 2, awayColor, awayTeam.name[0])
  }

  // Away team name
  ctx.textAlign = 'center'
  ctx.font = `800 34px ${FONT}`
  ctx.fillStyle = '#ffffff'
  if (awayTeam) drawTextWithShadow(ctx, awayTeam.name, awayX, awayY + logoSize / 2 + 30, { blur: 12 })

  // VS element — dead center
  const vsX = W / 2, vsY = H / 2

  // VS impact glow
  ctx.save()
  const vsGlow = ctx.createRadialGradient(vsX, vsY, 0, vsX, vsY, 120)
  vsGlow.addColorStop(0, 'rgba(255,255,255,0.3)')
  vsGlow.addColorStop(0.3, 'rgba(249,115,22,0.2)')
  vsGlow.addColorStop(1, 'transparent')
  ctx.fillStyle = vsGlow
  ctx.beginPath()
  ctx.arc(vsX, vsY, 120, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // VS diamond
  ctx.save()
  ctx.translate(vsX, vsY)
  ctx.rotate(Math.PI / 4)
  const vsSize = 52
  ctx.beginPath()
  ctx.roundRect(-vsSize, -vsSize, vsSize * 2, vsSize * 2, 14)
  const vsBg = ctx.createLinearGradient(-vsSize, -vsSize, vsSize, vsSize)
  vsBg.addColorStop(0, BRAND_ORANGE)
  vsBg.addColorStop(1, '#dc2626')
  ctx.fillStyle = vsBg
  ctx.shadowColor = BRAND_ORANGE
  ctx.shadowBlur = 40
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.font = `900 60px ${FONT}`
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 10
  ctx.fillText('VS', vsX, vsY + 2)
  ctx.restore()

  // Bottom info bar
  const barY = H - 130
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.beginPath()
  ctx.roundRect(50, barY, W - 100, 90, 16)
  ctx.fill()

  const barAccent = ctx.createLinearGradient(50, 0, W - 50, 0)
  barAccent.addColorStop(0, homeColor)
  barAccent.addColorStop(1, awayColor)
  ctx.fillStyle = barAccent
  ctx.fillRect(70, barY, W - 140, 3)

  ctx.font = `700 26px ${FONT}`
  ctx.fillStyle = BRAND_ORANGE
  ctx.textAlign = 'center'
  ctx.fillText(formatHebrewDate(game.game_date), W / 2, barY + 34)

  const timeVenue = `${formatTime(game.game_date)}${game.venue ? '  •  ' + game.venue : ''}`
  ctx.font = `500 20px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.fillText(timeVenue, W / 2, barY + 64)

  // Bottom accent bar
  const botBar = ctx.createLinearGradient(0, 0, W, 0)
  botBar.addColorStop(0, homeColor)
  botBar.addColorStop(1, awayColor)
  ctx.fillStyle = botBar
  ctx.fillRect(0, H - 5, W, 5)

  return canvas
}

export { downloadCanvas }
