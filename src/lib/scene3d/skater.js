import * as THREE from "three"

// A jointed rink-hockey skater driven by 13 joint positions (2026-10-13).
// Joints come either from the video (pose_lift.py: RTMPose 2D keypoints lifted to 3D with the calibrated camera)
// or, where the video has none, from a procedural skating stride. Each body part is a mesh stretched between two
// joints, so one model serves both sources with no retargeting.
//
// Joint order (= pose_lift.py J13): nose, lShoulder, rShoulder, lElbow, rElbow, lWrist, rWrist,
//                                   lHip, rHip, lKnee, rKnee, lAnkle, rAnkle
// Local frame (procedural): x forward, y up, z to the player's right. World: three coords (x, up, -rinkY).

export const J = { nose: 0, lS: 1, rS: 2, lE: 3, rE: 4, lW: 5, rW: 6, lH: 7, rH: 8, lK: 9, rK: 10, lA: 11, rA: 12 }
const MISSING = 999          // pose_lift writes 999 for a joint the video did not see (in cm)

const V = (x, y, z) => new THREE.Vector3(x, y, z)
const UP = V(0, 1, 0)

// two-bone IK: joint between a and c with bone lengths l1, l2, bending toward `bend`
function ik(a, c, l1, l2, bend) {
  const d = c.clone().sub(a), dist = Math.min(d.length(), l1 + l2 - 1e-3)
  const dir = d.normalize()
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x))
  const side = bend.clone().sub(dir.clone().multiplyScalar(bend.dot(dir))).normalize()
  return a.clone().add(dir.multiplyScalar(x)).add(side.multiplyScalar(h))
}

// Procedural stride, local frame. phase in radians, v = speed m/s (0 = standing ready).
export function stridePose(phase, v, lefty = false) {
  const k = Math.min(1, v / 6)                                   // 0 standing → 1 sprint
  const hipY = 0.86 - 0.1 * k
  const lean = 0.18 + 0.32 * k                                   // torso lean forward (rad)
  const s = Math.sin(phase), c = Math.cos(phase)
  const push = 0.06 + 0.26 * k                                   // lateral push of the working skate
  const p = new Array(13)
  const pelvis = V(0, hipY + 0.03 * Math.abs(s) * k, 0)
  p[J.lH] = pelvis.clone().add(V(0, 0, -0.11)); p[J.rH] = pelvis.clone().add(V(0, 0, 0.11))
  // skates: alternate push out to the side and back, recover under the body
  p[J.lA] = V(-0.05 + 0.12 * c * k, 0.09, -0.16 - push * Math.max(0, s))
  p[J.rA] = V(-0.05 - 0.12 * c * k, 0.09, 0.16 + push * Math.max(0, -s))
  p[J.lK] = ik(p[J.lH], p[J.lA], 0.46, 0.46, V(1, 0, -0.2))
  p[J.rK] = ik(p[J.rH], p[J.rA], 0.46, 0.46, V(1, 0, 0.2))
  const chest = pelvis.clone().add(V(Math.sin(lean) * 0.52, Math.cos(lean) * 0.52, 0))
  const twist = 0.08 * s * k
  p[J.lS] = chest.clone().add(V(twist, 0, -0.2)); p[J.rS] = chest.clone().add(V(-twist, 0, 0.2))
  p[J.nose] = chest.clone().add(V(0.12 + Math.sin(lean) * 0.12, 0.24, 0))
  // stick held low in front: top hand near the hip, bottom hand forward and low (shooting side = right)
  const sgn = lefty ? -1 : 1
  const top = V(0.18, hipY + 0.1, -0.12 * sgn), low = V(0.5 + 0.05 * c * k, hipY - 0.15, 0.12 * sgn)
  p[lefty ? J.rW : J.lW] = top; p[lefty ? J.lW : J.rW] = low
  p[J.lE] = ik(p[J.lS], p[J.lW], 0.3, 0.28, V(-0.3, -1, -0.6))
  p[J.rE] = ik(p[J.rS], p[J.rW], 0.3, 0.28, V(-0.3, -1, 0.6))
  return p
}

export function localToWorld(pts, x, y, heading) {
  const c = Math.cos(heading), s = Math.sin(heading)
  // local (fx, up, rz): forward = (c, s) in rink, right = (s, -c) in rink → three (rx, up, -ry)
  return pts.map(p => { const rx = x + p.x * c + p.z * s, ry = y + p.x * s - p.z * c; return V(rx, p.y, -ry) })
}

// pose sample (rink-relative cm, from pose_lift.py) → world points, filling joints the video missed from `fallback`
export function poseToWorld(row, x, y, fallback) {
  const out = new Array(13)
  for (let j = 0; j < 13; j++) {
    const dx = row[j * 3], dy = row[j * 3 + 1], z = row[j * 3 + 2]
    out[j] = dx === MISSING ? fallback[j] : V(x + dx / 100, z / 100, -(y + dy / 100))
  }
  return out
}

// interpolated pose at time t from [[t, ...39], ...], or null when the nearest samples are too far apart
export function samplePose(pose, t, maxGap = 0.35) {
  if (!pose?.length || t < pose[0][0] - 0.1 || t > pose[pose.length - 1][0] + 0.1) return null
  let i = 0; while (i < pose.length - 1 && pose[i + 1][0] < t) i++
  const a = pose[i], b = pose[Math.min(i + 1, pose.length - 1)]
  if (a === b || t <= a[0]) return Math.abs(t - a[0]) < 0.15 ? a.slice(1) : null
  if (b[0] - a[0] > maxGap) return null
  const u = (t - a[0]) / (b[0] - a[0]), out = new Array(39)
  for (let k = 1; k < 40; k++) {
    const va = a[k], vb = b[k]
    out[k - 1] = va === MISSING || vb === MISSING ? (u < 0.5 ? va : vb) : va + (vb - va) * u
  }
  return out
}

// ---- the model ----
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1)          // scaled per bone
const taper = new THREE.CylinderGeometry(0.8, 1, 1, 12, 1)
const ball = new THREE.SphereGeometry(1, 14, 10)
const helmetGeo = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)
const bootGeo = new THREE.BoxGeometry(0.28, 0.11, 0.1)
const wheelGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.025, 10)
const bladeGeo = new THREE.BoxGeometry(0.3, 0.05, 0.02)
const Y = V(0, 1, 0)

export class Skater {
  constructor({ shirt, shorts = 0x161b24, socks, helmet = 0x1d2433, skin = 0xd9a77f }) {
    const m = (color, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough, transparent: true })
    this.mats = { shirt: m(shirt, 0.55), shorts: m(shorts, 0.8), socks: m(socks ?? shirt, 0.7), skin: m(skin, 0.7),
      dark: m(0x101318, 0.5), helmet: m(helmet, 0.35), pad: m(0xe9ecf1, 0.6), stick: m(0x2b2b2b, 0.5), wheel: m(0x9aa3ad, 0.4) }
    this.group = new THREE.Group()
    const M = this.mats, add = (g, mat) => { const o = new THREE.Mesh(g, mat); o.castShadow = true; this.group.add(o); return o }
    this.bones = [
      // [from joint|fn, to joint|fn, radius, mesh]
      ["pelvis", "neck", 0.17, add(taper, M.shirt)],
      [J.lS, J.rS, 0.085, add(unitCyl, M.shirt)],
      [J.lH, J.rH, 0.11, add(unitCyl, M.shorts)],
      [J.lS, J.lE, 0.06, add(unitCyl, M.shirt)], [J.rS, J.rE, 0.06, add(unitCyl, M.shirt)],
      [J.lE, J.lW, 0.048, add(unitCyl, M.dark)], [J.rE, J.rW, 0.048, add(unitCyl, M.dark)],
      [J.lH, J.lK, 0.09, add(unitCyl, M.shorts)], [J.rH, J.rK, 0.09, add(unitCyl, M.shorts)],
      [J.lK, J.lA, 0.065, add(unitCyl, M.socks)], [J.rK, J.rA, 0.065, add(unitCyl, M.socks)],
      ["neck", "head", 0.05, add(unitCyl, M.skin)],
    ]
    this.joints = [[J.lS, 0.09, M.shirt], [J.rS, 0.09, M.shirt], [J.lE, 0.06, M.shirt], [J.rE, 0.06, M.shirt],
      [J.lW, 0.065, M.dark], [J.rW, 0.065, M.dark], [J.lK, 0.085, M.pad], [J.rK, 0.085, M.pad], [J.lH, 0.11, M.shorts], [J.rH, 0.11, M.shorts]]
      .map(([j, r, mat]) => { const o = add(ball, mat); o.scale.setScalar(r); return [j, o] })
    this.head = add(ball, M.skin); this.head.scale.setScalar(0.115)
    this.helmet = add(helmetGeo, M.helmet); this.helmet.scale.setScalar(0.13)
    this.skates = [J.lA, J.rA].map(() => {
      const g = new THREE.Group(); const boot = new THREE.Mesh(bootGeo, M.dark); boot.position.y = 0.09; boot.castShadow = true; g.add(boot)
      for (const dx of [-0.1, -0.035, 0.035, 0.1]) { const w = new THREE.Mesh(wheelGeo, M.wheel); w.rotation.x = Math.PI / 2; w.position.set(dx, 0.035, 0); g.add(w) }
      this.group.add(g); return g
    })
    this.stick = add(unitCyl, M.stick)
    this.blade = add(bladeGeo, M.stick)
  }
  // shirt number on the back (+ small on the chest) and a name tag over the head. label = player_ids.py label
  // ("r14", "b7", "bgk", "ref"), name = from the league roster when the number matches one player.
  setIdentity(label, name, kit) {
    this.tagText = null
    if (!label) return
    const num = /^[rb](\d+)$/.exec(label)?.[1]
    if (num) {
      const tex = numberTexture(num, kit.shirt)
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      this.mats.num = mat
      this.back = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), mat); this.group.add(this.back)
      this.front = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), mat); this.group.add(this.front)
    }
    this.tagText = num ? (name ? `${num} · ${name}` : `#${num}`) : label === "ref" ? "שופט" : /gk$/.test(label) ? "שוער" : null
    if (this.tagText) {
      const { tex, aspect } = tagTexture(this.tagText, kit.shirt)
      this.mats.tag = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
      this.tag = new THREE.Sprite(this.mats.tag); this.tag.scale.set(0.32 * aspect, 0.32, 1); this.group.add(this.tag)
    }
  }
  showTag(v) { if (this.tag) this.tag.visible = v }
  setOpacity(op) { Object.values(this.mats).forEach(m => { m.opacity = op; m.depthWrite = op > 0.9 && m.type !== "SpriteMaterial" && m !== this.mats.num }) }
  set visible(v) { this.group.visible = v }

  // P = 13 world points (THREE.Vector3), heading = rink-angle the player faces (for the skates)
  update(P, heading) {
    const pelvis = P[J.lH].clone().add(P[J.rH]).multiplyScalar(0.5)
    const neck = P[J.lS].clone().add(P[J.rS]).multiplyScalar(0.5)
    const fwd = P[J.nose].clone().sub(neck); fwd.y = 0
    const head = neck.clone().add(UP.clone().multiplyScalar(0.2)).add(fwd.clampLength(0, 0.08))
    const named = { pelvis, neck: neck.clone().add(UP.clone().multiplyScalar(0.04)), head }
    const pt = (k) => typeof k === "string" ? named[k] : P[k]
    for (const [a, b, r, mesh] of this.bones) place(mesh, pt(a), pt(b), r)
    for (const [j, o] of this.joints) o.position.copy(P[j])
    this.head.position.copy(head); this.helmet.position.copy(head).add(V(0, 0.01, 0))
    if (this.back) {                                                 // number patches follow the chest, facing back / front
      const f = V(Math.cos(heading), 0, -Math.sin(heading))
      const chest = pelvis.clone().lerp(neck, 0.62)
      this.back.position.copy(chest).addScaledVector(f, -0.2); this.back.rotation.set(0, Math.atan2(-f.x, -f.z), 0)
      this.front.position.copy(chest).addScaledVector(f, 0.19).add(V(0, 0.06, 0)); this.front.rotation.set(0, Math.atan2(f.x, f.z), 0)
    }
    if (this.tag) this.tag.position.copy(head).add(V(0, 0.42, 0))
    this.skates.forEach((g, i) => {
      const a = P[i ? J.rA : J.lA]; g.position.set(a.x, Math.max(0, a.y - 0.09), a.z); g.rotation.y = heading
    })
    // stick: from the higher hand through the lower one, down to the floor; blade lies flat on the floor
    const [hi, lo] = P[J.lW].y > P[J.rW].y ? [P[J.lW], P[J.rW]] : [P[J.rW], P[J.lW]]
    let d = lo.clone().sub(hi); if (d.y > -0.15) d = d.setY(-Math.max(0.3, d.length())).normalize(); else d.normalize()
    const s = Math.max(0.2, (hi.y - 0.03) / -d.y), foot = hi.clone().add(d.clone().multiplyScalar(Math.min(s, 1.6)))
    place(this.stick, hi.clone().sub(d.clone().multiplyScalar(0.12)), foot, 0.016)
    const fl = V(d.x, 0, d.z).normalize()
    this.blade.position.set(foot.x + fl.x * 0.12, 0.03, foot.z + fl.z * 0.12)
    this.blade.rotation.set(0, Math.atan2(-fl.z, fl.x), 0)
  }
  dispose() { Object.values(this.mats).forEach(m => { m.map?.dispose(); m.dispose() }) }
}

const _q = new THREE.Quaternion()
function place(mesh, a, b, r) {
  const d = b.clone().sub(a), len = d.length()
  if (len < 1e-4) { mesh.visible = false; return }
  mesh.visible = true
  mesh.position.copy(a).add(b).multiplyScalar(0.5)
  mesh.quaternion.copy(_q.setFromUnitVectors(Y, d.divideScalar(len)))
  mesh.scale.set(r, len, r)
}

function numberTexture(num, shirt) {
  const c = document.createElement("canvas"); c.width = c.height = 128
  const g = c.getContext("2d")
  g.font = "900 92px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"
  g.lineWidth = 10; g.strokeStyle = "#" + new THREE.Color(shirt).multiplyScalar(0.35).getHexString(); g.strokeText(num, 64, 68)
  g.fillStyle = "#ffffff"; g.fillText(num, 64, 68)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}
function tagTexture(text, shirt) {
  const c = document.createElement("canvas"), g = c.getContext("2d"), font = "700 44px system-ui, sans-serif"
  g.font = font; const w = Math.ceil(g.measureText(text).width) + 44
  c.width = w; c.height = 64
  g.font = font; g.direction = "rtl"; g.textAlign = "center"; g.textBaseline = "middle"
  g.fillStyle = "rgba(11,18,32,0.82)"; g.beginPath(); g.roundRect(0, 0, w, 64, 18); g.fill()
  g.fillStyle = "#" + new THREE.Color(shirt).getHexString(); g.fillRect(0, 0, 10, 64)
  g.fillStyle = "#ffffff"; g.fillText(text, w / 2 + 4, 34)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return { tex: t, aspect: w / 64 }
}
