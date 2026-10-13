import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { Skater, stridePose, keeperStance, localToWorld, poseToWorld, samplePose, bodyHeading } from "./skater"

// 3D replay of one play (video_lab_scenes.scene, written by video-analysis/scene3d/export_scene.py).
// Rink coords are metres: x along the length (+ = right as the venue camera sees it), y across (+ = far side),
// centre spot (0, 0). Three coords: (x, height, -y). Everything drawn comes from the scene data; nothing is invented
// except the body shape around each tracked floor point.
//
// createReplay({ container, scene, onTick, clock }) -> { play, pause, seek, setSpeed, setView, dispose, state }
//   onTick(t, activeEventIndex) ~10×/s for the UI; clock() -> seconds or null lets an external player (YouTube)
//   drive the time while it is playing.

const COL = { red: 0xf0393e, blue: 0x3c6ff0, ref: 0xff8a2a }
const GOLD = 0xd9b45a
export const EVENT_NAME = { pass: "מסירה", shot: "בעיטה", pass_lost: "מסירה שאבדה", interception: "יירוט", steal: "חטיפה", out: "כדור יצא" }
export const SHOT_OUTCOME = { saved: "השוער עצר", wide: "החטיאה", blocked: "נחסמה", goal: "גול" }
// "נבו כהן (14)" / "#7" / null — who the engine credits with an event (export_scene.py: nearest named player)
export function whoLabel(e) {
  const num = /^[rb](\d+)$/.exec(e?.by || "")?.[1]
  if (!num) return /gk$/.test(e?.by || "") ? "השוער" : null
  return e.by_name ? `${e.by_name} (${num})` : `#${num}`
}

export function createReplay({ container, scene: D, onTick, clock }) {
  const R = D.rink, L = R.L, W = R.W, DUR = D.dur
  const GX = L / 2 - R.goal_line
  const P = (x, y, h = 0) => new THREE.Vector3(x, h, -y)
  const state = { t: 0, playing: false, speed: 1, view: "stand", tags: true }

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const canvas = renderer.domElement
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none"
  container.appendChild(canvas)
  const callout = document.createElement("div")
  callout.style.cssText = "position:absolute;pointer-events:none;transform:translate(-50%,-130%);background:rgba(11,18,32,.9);color:#e8edf6;border:1px solid #24314d;border-radius:6px;padding:3px 8px;font-weight:700;font-size:12px;white-space:nowrap;opacity:0;transition:opacity .2s"
  container.appendChild(callout)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b1220)
  scene.fog = new THREE.Fog(0x0b1220, 40, 90)
  const cam = new THREE.PerspectiveCamera(48, 1, 0.1, 200)
  const controls = new OrbitControls(cam, canvas)
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.03; controls.minDistance = 3; controls.maxDistance = 60

  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x223044, 1.3))
  const sun = new THREE.DirectionalLight(0xffffff, 2.3)
  sun.position.set(-6, 22, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 12, bottom: -12, near: 1, far: 50 })
  scene.add(sun)
  const lamps = []
  for (let i = -2; i <= 2; i++) for (const zz of [-4, 4]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.4), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }))
    lamp.position.set(i * 7, 9, zz); scene.add(lamp); lamps.push(lamp)
  }

  // ---- rink: floor, paint, boards, goals ----
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ color: 0x6f7984, roughness: 0.42, metalness: 0.05 }))
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor)
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(L + 14, W + 14), new THREE.MeshStandardMaterial({ color: 0x141d2e, roughness: 1 }))
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.01; scene.add(apron)
  const paint = (geo, color, op = 1) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: op < 1, opacity: op }))
    m.rotation.x = -Math.PI / 2; m.position.y = 0.004; scene.add(m); return m
  }
  const BLUE_PAINT = 0x3f6fb8, WHITE_PAINT = 0xf2f4f8, T = 0.07
  paint(new THREE.PlaneGeometry(T, W), BLUE_PAINT)
  paint(new THREE.RingGeometry(R.circle_r - T, R.circle_r, 96), BLUE_PAINT)
  for (const s of [-1, 1]) {
    paint(new THREE.PlaneGeometry(T, W), WHITE_PAINT, 0.7).position.x = s * GX
    const bx = s * (GX - R.box_d / 2)
    paint(new THREE.PlaneGeometry(R.box_d, T), WHITE_PAINT).position.set(bx, 0.004, -R.box_w / 2)
    paint(new THREE.PlaneGeometry(R.box_d, T), WHITE_PAINT).position.set(bx, 0.004, R.box_w / 2)
    paint(new THREE.PlaneGeometry(T, R.box_w), WHITE_PAINT).position.set(s * (GX - R.box_d), 0.004, 0)
    paint(new THREE.CircleGeometry(0.09, 20), WHITE_PAINT).position.set(s * (GX - 5.4), 0.004, 0)
  }
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xf1f3f6, roughness: 0.6 })
  const nearMat = new THREE.MeshStandardMaterial({ color: 0xf1f3f6, roughness: 0.6, transparent: true, opacity: 0.16, depthWrite: false })
  const kick = new THREE.MeshStandardMaterial({ color: 0xc9933f, roughness: 0.7 })
  const board = (w, x, z, rot, near) => {
    const g = new THREE.Group()
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, 0.08), near ? nearMat : boardMat)
    m.position.y = 0.5; m.castShadow = !near; m.receiveShadow = true; g.add(m)
    if (!near) { const k = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 0.085), kick); k.position.y = 0.08; g.add(k) }
    g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g)
  }
  board(L, 0, -W / 2 - 0.04, 0, false); board(L, 0, W / 2 + 0.04, 0, true)
  board(W + 0.16, -L / 2 - 0.04, 0, Math.PI / 2, false); board(W + 0.16, L / 2 + 0.04, 0, Math.PI / 2, false)
  const goalMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.45 })
  for (const s of [-1, 1]) {
    const g = new THREE.Group(), r = 0.04, gw = R.goal_w, gh = R.goal_h, dp = 0.9
    const tube = (len) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), goalMat)
    for (const zz of [-gw / 2, gw / 2]) {
      const p = tube(gh); p.position.set(0, gh / 2, zz); p.castShadow = true; g.add(p)
      const back = tube(Math.hypot(dp, gh)); back.position.set(-dp / 2, gh / 2, zz); back.rotation.z = -Math.atan2(dp, gh); g.add(back)
      const base = tube(dp); base.rotation.z = Math.PI / 2; base.position.set(-dp / 2, r, zz); g.add(base)
    }
    const bar = tube(gw); bar.rotation.x = Math.PI / 2; bar.position.set(0, gh, 0); bar.castShadow = true; g.add(bar)
    const v = []
    for (let i = 0; i <= 10; i++) { const z = -gw / 2 + gw * i / 10; v.push(0, gh, z, -dp, 0, z) }
    for (let j = 0; j <= 7; j++) {
      const u = j / 7; v.push(-dp * u, gh * (1 - u), -gw / 2, -dp * u, gh * (1 - u), gw / 2)
      for (const zz of [-gw / 2, gw / 2]) v.push(-dp * u, gh * (1 - u), zz, -dp * u, 0, zz)
    }
    const ng = new THREE.BufferGeometry(); ng.setAttribute("position", new THREE.Float32BufferAttribute(v, 3))
    g.add(new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })))
    g.position.set(s * GX, 0, 0); g.rotation.y = s < 0 ? 0 : Math.PI; scene.add(g)
  }

  // ---- players: a jointed skater per track (skater.js), driven by the video pose where there is one, else a stride;
  //      opacity drops when the track is not freshly observed ----
  const KIT = {
    red: { shirt: 0xe3262d, shorts: 0x14171d, socks: 0xe3262d },
    blue: { shirt: 0x2f63e8, shorts: 0x18213a, socks: 0x2f63e8 },
    ref: { shirt: 0xff8a2a, shorts: 0x14171d, socks: 0x14171d, helmet: 0x14171d },
  }
  const ringGeo = new THREE.RingGeometry(0.34, 0.4, 32)
  // goalkeepers (player_ids labels rgk / bgk): own kit (the opener's red keeper wore dark navy), pads, ready stance
  const KEEPER_KIT = { red: { shirt: 0x1d2a4a, shorts: 0x14171d, socks: 0x1d2a4a }, blue: { shirt: 0x1f3c8a, shorts: 0x14171d, socks: 0x1f3c8a } }
  const players = D.players.map(p => {
    const keeper = /gk$/.test(p.label || "")
    const sk = new Skater({ ...(keeper ? KEEPER_KIT[p.team] : KIT[p.team]) ?? { shirt: 0x888888 }, keeper })
    if (p.team === "ref") { sk.stick.visible = false; sk.blade.visible = false; sk.noStick = true }
    sk.setIdentity(p.label, p.name, KIT[p.team] ?? { shirt: 0x888888 })
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COL[p.team] ?? 0x888888, transparent: true, opacity: 0.8, depthWrite: false }))
    ring.rotation.x = -Math.PI / 2
    scene.add(sk.group); scene.add(ring)
    return { sk, ring, obs: p.obs, pose: p.pose, heading: 0, speed: 0, phase: Math.random() * 6.28 }
  })
  const posed = players.some(p => p.pose?.length)
  function sampleTrack(obs, t) {
    if (t < obs[0][0] - 0.15 || t > obs[obs.length - 1][0] + 0.8) return null
    let i = 0; while (i < obs.length - 1 && obs[i + 1][0] < t) i++
    const a = obs[i], b = obs[Math.min(i + 1, obs.length - 1)]
    if (t <= a[0] || a === b) return { x: a[1], y: a[2], fresh: Math.abs(t - a[0]) < 0.3, vx: 0, vy: 0 }
    const gap = b[0] - a[0], u = Math.min(1, (t - a[0]) / gap)
    return { x: a[1] + (b[1] - a[1]) * u, y: a[2] + (b[2] - a[2]) * u, fresh: gap < 0.6, vx: (b[1] - a[1]) / gap, vy: (b[2] - a[2]) / gap }
  }

  // ---- ball: black, thin dim-gold outline ring, short trail ----
  const B = D.ball
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.3 }))
  ball.castShadow = true; scene.add(ball)
  const ballRing = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.235, 40), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85, depthWrite: false }))
  ballRing.rotation.x = -Math.PI / 2; scene.add(ballRing)
  const TRAIL_N = 40, trailPos = new Float32Array(TRAIL_N * 3)
  const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3))
  scene.add(new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6 })))
  function sampleBall(t) {
    if (!B.length || t < B[0][0] || t > B[B.length - 1][0]) return null
    let i = 0; while (i < B.length - 1 && B[i + 1][0] < t) i++
    const a = B[i], b = B[Math.min(i + 1, B.length - 1)]
    if (a === b) return { x: a[1], y: a[2] }
    if (b[0] - a[0] > 0.8) return Math.abs(t - a[0]) < 0.1 ? { x: a[1], y: a[2] } : null
    const u = (t - a[0]) / (b[0] - a[0])
    return { x: a[1] + (b[1] - a[1]) * u, y: a[2] + (b[2] - a[2]) * u, filled: a[3] && b[3] }
  }

  // ---- events: shot lines to the attacked goal, pulses for the rest ----
  const attackX = team => (D.attack?.[team] ?? (team === "red" ? -1 : 1)) * GX
  const shotFx = D.events.filter(e => e.type === "shot" && e.x != null).map(e => {
    const gy = e.aim_y != null ? Math.max(-1.6, Math.min(1.6, e.aim_y)) : 0
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([P(e.x, e.y, 0.02), P(attackX(e.team), gy, 0.02)]),
      new THREE.LineDashedMaterial({ color: e.outcome === "goal" ? GOLD : 0xffffff, dashSize: 0.35, gapSize: 0.2, transparent: true, opacity: 0 }))
    line.computeLineDistances(); scene.add(line)
    return { e, line }
  })
  const pulses = D.events.filter(e => e.x != null && e.type !== "shot").map(e => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 40), new THREE.MeshBasicMaterial({ color: COL[e.team] ?? 0xffffff, transparent: true, opacity: 0, depthWrite: false }))
    m.rotation.x = -Math.PI / 2; m.position.copy(P(e.x, e.y, 0.01)); scene.add(m); return { e, m }
  })

  // ---- views ----
  const side = D.events.find(e => e.type === "shot" && e.x != null)
  const focusX = side ? attackX(side.team) * 0.55 : 0                      // look toward where the play happens
  const VIEWS = {
    stand: { pos: [focusX * 0.4, 6.5, 13.5], tgt: [focusX, 0, 0] },
    top: { pos: [0, 36, 0.8], tgt: [0, 0, 0] },
    goal: { pos: [Math.sign(focusX || -1) * (GX + 4.5), 3.2, 0], tgt: [Math.sign(focusX || -1) * (GX - 8), 0.4, 0] },
    ball: { pos: [focusX + 4, 5, 8], tgt: [focusX, 0, 0] },
  }
  let camFrom = null, camTo = null, camT = 1
  // "real": the calibrated venue camera itself, frame by frame (scene.camera from camera_path.py) — the 3D then
  // lines up with the video next to it. Orbit controls are off in this view; any other view turns them back on.
  const CP = D.camera?.path?.length ? D.camera : null
  function realCam(t) {
    const path = CP.path; let i = 0; while (i < path.length - 1 && path[i + 1][0] < t) i++
    const a = path[i], b = path[Math.min(i + 1, path.length - 1)], u = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0
    const L = (k) => a[k] + (b[k] - a[k]) * u
    const [x, y, z] = CP.pos
    cam.position.set(x, z, -y)
    cam.up.set(L(4), L(6), -L(5)).normalize()
    cam.lookAt(x + L(1), z + L(3), -y - L(2))
    if (Math.abs(cam.fov - L(7)) > 0.01) { cam.fov = L(7); cam.updateProjectionMatrix() }
  }
  function setView(v, instant) {
    if (v === "real" && !CP) v = "stand"
    controls.enabled = v !== "real"
    if (v !== "real") { cam.up.set(0, 1, 0); if (cam.fov !== 48) { cam.fov = 48; cam.updateProjectionMatrix() } }
    state.view = v; lamps.forEach(l => { l.visible = v !== "top" })
    if (v === "real") { realCam(state.t); camT = 1; return }
    camFrom = { pos: cam.position.clone(), tgt: controls.target.clone() }
    camTo = { pos: new THREE.Vector3(...VIEWS[v].pos), tgt: new THREE.Vector3(...VIEWS[v].tgt) }; camT = instant ? 1 : 0
    if (instant) { cam.position.copy(camTo.pos); controls.target.copy(camTo.tgt) }
  }
  setView(CP ? "real" : "stand", true)

  function resize() {
    const r = container.getBoundingClientRect()
    renderer.setSize(r.width, r.height, false); cam.aspect = r.width / Math.max(1, r.height); cam.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize()

  let raf = 0, last = performance.now(), lastTick = 0, dead = false
  function frame(now) {
    if (dead) return
    const dt = Math.min(0.1, (now - last) / 1000); last = now
    if (state.playing) {
      const ext = clock?.()
      state.t = ext != null ? ext : state.t + dt * state.speed
      if (state.t >= DUR) { state.t = 0; onLoop?.() }
    }
    const t = state.t

    for (const pl of players) {
      const s = sampleTrack(pl.obs, t)
      pl.sk.visible = pl.ring.visible = !!s
      if (!s) continue
      const sp = Math.hypot(s.vx, s.vy)
      pl.speed += (Math.min(sp, 9) - pl.speed) * Math.min(1, dt * 4)
      if (sp > 0.6) { let d = Math.atan2(s.vy, s.vx) - pl.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); pl.heading += d * Math.min(1, dt * 8) }
      if (state.playing) pl.phase += dt * state.speed * 2 * Math.PI * (0.55 + 0.14 * pl.speed)
      if (pl.sk.keeper && !(pl.pose && samplePose(pl.pose, t)) && pl.speed < 1.5) {
        // no video pose: a keeper faces out of his own net (the nearer goal), not his drift direction
        const out = s.x < 0 ? 0 : Math.PI; let d = out - pl.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); pl.heading += d * Math.min(1, dt * 4)
      }
      const stride = localToWorld(pl.sk.keeper && pl.speed < 2.5 ? keeperStance(pl.phase) : stridePose(pl.phase, pl.speed), s.x, s.y, pl.heading)
      const row = pl.pose && samplePose(pl.pose, t)
      const P = row ? poseToWorld(row, s.x, s.y, stride) : stride
      if (row) {                                    // the body says where the player faces (89–96% agree with motion)
        const bh = bodyHeading(P)
        if (bh != null) { let d = bh - pl.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); pl.heading += d * Math.min(1, dt * 6) }
      }
      pl.sk.update(P, pl.heading)
      if (pl.sk.noStick) { pl.sk.stick.visible = false; pl.sk.blade.visible = false }
      pl.sk.showTag(state.tags)
      pl.ring.position.set(s.x, 0.006, -s.y)
      const op = s.fresh ? 1 : 0.3; pl.sk.setOpacity(op); pl.ring.material.opacity = 0.8 * op
    }
    const b = sampleBall(t)
    ball.visible = ballRing.visible = !!b
    if (b) { ball.position.copy(P(b.x, b.y, 0.11)); ballRing.position.set(b.x, 0.008, -b.y); ballRing.material.opacity = b.filled ? 0.4 : 0.85 }
    let n = 0
    for (const s of B) if (s[0] > t - 1.2 && s[0] <= t && n < TRAIL_N) { trailPos[n * 3] = s[1]; trailPos[n * 3 + 1] = 0.05; trailPos[n * 3 + 2] = -s[2]; n++ }
    trailGeo.setDrawRange(0, n); trailGeo.attributes.position.needsUpdate = true

    let active = null
    for (const s of shotFx) { const age = t - s.e.t; const on = age >= 0 && age < 2.5; s.line.material.opacity = on ? 1 - age / 2.5 : 0; if (on) active = s.e }
    for (const p of pulses) {
      const age = t - p.e.t, on = age >= 0 && age < 1.2
      p.m.material.opacity = on ? 0.9 * (1 - age / 1.2) : 0; p.m.scale.setScalar(on ? 1 + age * 1.5 : 1)
      if (on && (!active || active.t < p.e.t)) active = p.e
    }
    if (active && active.x != null) {
      const v = P(active.x, active.y, 1.9).project(cam), r = canvas.getBoundingClientRect()
      callout.style.left = ((v.x + 1) / 2 * r.width) + "px"; callout.style.top = ((1 - v.y) / 2 * r.height) + "px"
      const who = whoLabel(active)
      callout.textContent = (active.type === "shot"
        ? `בעיטה · ${SHOT_OUTCOME[active.outcome] || active.outcome} · ${active.dist} מ׳${active.speed ? ` · ${active.speed} קמ״ש` : ""}`
        : (EVENT_NAME[active.type] || active.type)) + (who ? ` · ${who}` : "")
      callout.style.opacity = v.z < 1 ? "1" : "0"
    } else callout.style.opacity = "0"

    if (state.view === "real") realCam(t)
    else if (camT < 1) {
      camT = Math.min(1, camT + dt * 1.6); const k = 1 - Math.pow(1 - camT, 3)
      cam.position.lerpVectors(camFrom.pos, camTo.pos, k); controls.target.lerpVectors(camFrom.tgt, camTo.tgt, k)
    } else if (state.view === "ball" && b) {
      const off = cam.position.clone().sub(controls.target)
      controls.target.lerp(new THREE.Vector3(b.x, 0, -b.y), Math.min(1, dt * 2.5)); cam.position.copy(controls.target).add(off)
    }
    if (state.view !== "real") controls.update()
    renderer.render(scene, cam)
    if (now - lastTick > 100) {
      lastTick = now
      let ai = -1; D.events.forEach((e, i) => { if (e.t <= t + 0.01) ai = i })
      onTick?.(t, ai)
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  let onLoop = null
  return {
    state,
    posed,
    hasRealCamera: !!CP,
    play() { state.playing = true },
    pause() { state.playing = false },
    seek(t) { state.t = Math.max(0, Math.min(DUR, t)) },
    setSpeed(s) { state.speed = s },
    setView,
    setTags(v) { state.tags = v },
    set onLoop(fn) { onLoop = fn },
    dispose() {
      dead = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose()
      players.forEach(p => p.sk.dispose())
      scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => x.dispose?.()) })
      renderer.dispose(); canvas.remove(); callout.remove()
    },
  }
}
