import type { StringLayout } from './strum'

const INLAYS = [3, 5, 7, 9, 15]

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface GuitarGeometry {
  fretX: (n: number) => number
  boardEnd: number
  boardTop: number
  boardBottom: number
  soundhole: { x: number; y: number; r: number }
}

export function guitarGeometry(l: StringLayout): GuitarGeometry {
  const span = l.ys[5] - l.ys[0]
  const mid = (l.ys[0] + l.ys[5]) / 2
  // Scale length chosen so the 12th fret lands at the neck/body joint.
  const scale = 2 * (l.x0 - l.nut)
  const fretX = (n: number) => l.nut + scale * (1 - 2 ** (-n / 12))
  const r = span * 0.55
  const soundhole = { x: l.x0 + r * 1.15, y: mid, r }
  const pad = l.spacing * 0.55
  return {
    fretX,
    boardEnd: soundhole.x - r - span * 0.12,
    boardTop: l.ys[0] - pad,
    boardBottom: l.ys[5] + pad,
    soundhole,
  }
}

function tortoise(g: CanvasRenderingContext2D) {
  const c = document.createElement('canvas')
  c.width = c.height = 160
  const p = c.getContext('2d')!
  const rand = rng(7)
  p.fillStyle = '#2a1108'
  p.fillRect(0, 0, 160, 160)
  for (let i = 0; i < 70; i++) {
    const x = rand() * 160
    const y = rand() * 160
    const r = 6 + rand() * 22
    const hue = rand()
    const grad = p.createRadialGradient(x, y, 0, x, y, r)
    const col = hue < 0.45 ? '176,92,32' : hue < 0.75 ? '120,52,18' : '20,8,4'
    grad.addColorStop(0, `rgba(${col},0.75)`)
    grad.addColorStop(1, `rgba(${col},0)`)
    p.fillStyle = grad
    p.beginPath()
    p.ellipse(x, y, r * 1.4, r * 0.7, rand() * Math.PI, 0, Math.PI * 2)
    p.fill()
  }
  return g.createPattern(c, 'repeat')!
}

function bodyPath(l: StringLayout) {
  const span = l.ys[5] - l.ys[0]
  const mid = (l.ys[0] + l.ys[5]) / 2
  const L = l.x0 - span * 0.3
  const R = l.x1 + span * 1.15
  const B = R - L
  const hu = span * 1.02
  const hw = span * 0.8
  const hl = span * 1.28
  const path = new Path2D()
  path.moveTo(L, mid)
  for (const dir of [-1, 1]) {
    const y = (h: number) => mid + dir * h
    if (dir === 1) path.moveTo(L, mid)
    path.bezierCurveTo(L, y(hu * 0.62), L + 0.08 * B, y(hu), L + 0.24 * B, y(hu))
    path.bezierCurveTo(L + 0.34 * B, y(hu), L + 0.39 * B, y(hw), L + 0.46 * B, y(hw))
    path.bezierCurveTo(L + 0.54 * B, y(hw), L + 0.6 * B, y(hl), L + 0.76 * B, y(hl))
    path.bezierCurveTo(L + 0.93 * B, y(hl), R, y(hl * 0.6), R, mid)
  }
  return { path, L, R, B, mid, hl }
}

/** Static guitar art (everything except strings, finger dots and motion), rendered once per resize. */
export function renderGuitar(l: StringLayout, w: number, h: number, dpr: number) {
  const c = document.createElement('canvas')
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)
  const geo = guitarGeometry(l)
  const { path, L, B, mid, hl } = bodyPath(l)
  const rand = rng(42)

  // Sunburst top
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.6)'
  g.shadowBlur = 40
  g.fillStyle = '#140805'
  g.fill(path)
  g.restore()
  g.save()
  g.clip(path)
  const cx = L + 0.62 * B
  const burst = g.createRadialGradient(cx, mid, 0, cx, mid, Math.max(hl * 1.05, B * 0.55))
  burst.addColorStop(0, '#e9ad52')
  burst.addColorStop(0.32, '#d98d34')
  burst.addColorStop(0.58, '#9a4a18')
  burst.addColorStop(0.8, '#3d170a')
  burst.addColorStop(1, '#120604')
  g.fillStyle = burst
  g.fillRect(L - 10, mid - hl - 10, B + 20, hl * 2 + 20)
  // Spruce grain runs along the length of the top.
  for (let i = 0; i < 90; i++) {
    const y = mid - hl + rand() * hl * 2
    g.strokeStyle = `rgba(60,24,6,${0.05 + rand() * 0.08})`
    g.lineWidth = 0.6 + rand() * 1.2
    g.beginPath()
    g.moveTo(L, y)
    g.bezierCurveTo(L + B * 0.3, y + rand() * 3, L + B * 0.7, y - rand() * 3, L + B, y)
    g.stroke()
  }
  g.restore()

  // Cream binding with a dark purfling line inside
  g.lineWidth = 3.5
  g.strokeStyle = '#efe4c8'
  g.stroke(path)
  g.save()
  g.clip(path)
  g.lineWidth = 9
  g.strokeStyle = 'rgba(20,10,6,0.55)'
  g.stroke(path)
  g.restore()

  // Tortoiseshell pickguard, treble side below the soundhole
  const sh = geo.soundhole
  g.save()
  g.fillStyle = tortoise(g)
  g.beginPath()
  g.ellipse(sh.x + sh.r * 0.75, sh.y + sh.r * 1.02, sh.r * 1.02, sh.r * 0.6, 0.42, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(10,4,2,0.6)'
  g.lineWidth = 1
  g.stroke()
  g.restore()

  // Rosette and soundhole
  const rings: [number, string, number][] = [
    [sh.r + 16, '#efe4c8', 2],
    [sh.r + 12, '#1a0c06', 3],
    [sh.r + 8, '#b87a3a', 3.5],
    [sh.r + 4, '#1a0c06', 2],
  ]
  for (const [r, col, lw] of rings) {
    g.strokeStyle = col
    g.lineWidth = lw
    g.beginPath()
    g.arc(sh.x, sh.y, r, 0, Math.PI * 2)
    g.stroke()
  }
  const hole = g.createRadialGradient(sh.x - sh.r * 0.2, sh.y - sh.r * 0.3, sh.r * 0.1, sh.x, sh.y, sh.r)
  hole.addColorStop(0, '#1d0f08')
  hole.addColorStop(1, '#050201')
  g.fillStyle = hole
  g.beginPath()
  g.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2)
  g.fill()

  // Headstock stub, then the rosewood fretboard over neck and upper bout
  const { boardTop, boardBottom, boardEnd, fretX } = geo
  const span = l.ys[5] - l.ys[0]
  const headLen = span * 0.9
  const headTop = boardTop - l.spacing * 0.35
  const headH = boardBottom - boardTop + l.spacing * 0.7
  for (let i = 0; i < 3; i++) {
    const tx = l.nut - headLen * (0.25 + i * 0.28)
    for (const ty of [headTop - l.spacing * 0.45, headTop + headH + l.spacing * 0.45]) {
      const peg = g.createRadialGradient(tx - 2, ty - 2, 0, tx, ty, l.spacing * 0.32)
      peg.addColorStop(0, '#fbf3dc')
      peg.addColorStop(1, '#a89468')
      g.fillStyle = peg
      g.beginPath()
      g.ellipse(tx, ty, l.spacing * 0.24, l.spacing * 0.34, 0, 0, Math.PI * 2)
      g.fill()
    }
  }
  const head = g.createLinearGradient(0, headTop, 0, headTop + headH)
  head.addColorStop(0, '#2a170d')
  head.addColorStop(1, '#170c06')
  g.fillStyle = head
  g.beginPath()
  g.moveTo(l.nut, boardTop)
  g.lineTo(l.nut - headLen, headTop)
  g.quadraticCurveTo(l.nut - headLen - l.spacing * 0.6, headTop + headH / 2, l.nut - headLen, headTop + headH)
  g.lineTo(l.nut, boardBottom)
  g.closePath()
  g.fill()
  g.strokeStyle = 'rgba(239,228,200,0.6)'
  g.lineWidth = 1.2
  g.stroke()

  const neck = g.createLinearGradient(0, boardTop, 0, boardBottom)
  neck.addColorStop(0, '#2f1a10')
  neck.addColorStop(0.5, '#3d2416')
  neck.addColorStop(1, '#27150c')
  g.fillStyle = neck
  g.fillRect(l.nut, boardTop, boardEnd - l.nut, boardBottom - boardTop)
  for (let i = 0; i < 60; i++) {
    const y = boardTop + rand() * (boardBottom - boardTop)
    g.strokeStyle = rand() < 0.5 ? 'rgba(12,5,2,0.35)' : 'rgba(110,64,36,0.18)'
    g.lineWidth = 0.5 + rand()
    g.beginPath()
    g.moveTo(l.nut, y)
    g.lineTo(boardEnd, y + (rand() - 0.5) * 3)
    g.stroke()
  }
  g.fillStyle = '#efe4c8'
  g.fillRect(l.nut, boardTop - 2, boardEnd - l.nut, 2)
  g.fillRect(l.nut, boardBottom, boardEnd - l.nut, 2)

  // Pearl inlays and nickel frets
  const pearl = (x: number, y: number, r: number) => {
    const p = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r)
    p.addColorStop(0, '#fbf6ee')
    p.addColorStop(0.6, '#d9d6d0')
    p.addColorStop(1, '#a9b2b8')
    g.fillStyle = p
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  const dotR = l.spacing * 0.16
  for (let n = 1; fretX(n) < boardEnd; n++) {
    const x = fretX(n)
    const mx = (fretX(n - 1) + x) / 2
    if (INLAYS.includes(n)) pearl(mx, (l.ys[2] + l.ys[3]) / 2, dotR)
    if (n === 12) {
      pearl(mx, (l.ys[1] + l.ys[2]) / 2, dotR)
      pearl(mx, (l.ys[3] + l.ys[4]) / 2, dotR)
    }
    const fret = g.createLinearGradient(x - 1.5, 0, x + 1.5, 0)
    fret.addColorStop(0, '#6d6a66')
    fret.addColorStop(0.5, '#e6e2dc')
    fret.addColorStop(1, '#6d6a66')
    g.fillStyle = fret
    g.fillRect(x - 1.5, boardTop, 3, boardBottom - boardTop)
  }

  // Bone nut
  g.fillStyle = '#ece3cf'
  g.fillRect(l.nut - 5, boardTop - 2, 6, boardBottom - boardTop + 4)

  // Rosewood bridge with bone saddle and pins
  const bw = l.spacing * 2.1
  const bh = boardBottom - boardTop + l.spacing * 1.6
  const bx = l.x1 - l.spacing * 0.5
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.5)'
  g.shadowBlur = 10
  g.shadowOffsetX = 3
  g.fillStyle = '#23130b'
  g.beginPath()
  g.moveTo(bx, mid - bh / 2)
  g.quadraticCurveTo(bx + bw / 2, mid - bh / 2 - l.spacing * 0.6, bx + bw, mid - bh / 2)
  g.lineTo(bx + bw, mid + bh / 2)
  g.quadraticCurveTo(bx + bw / 2, mid + bh / 2 + l.spacing * 0.6, bx, mid + bh / 2)
  g.closePath()
  g.fill()
  g.restore()
  g.fillStyle = '#efe6d2'
  g.fillRect(l.x1 - 1.5, l.ys[0] - l.spacing * 0.5, 3.5, l.ys[5] - l.ys[0] + l.spacing)
  for (const y of l.ys) {
    const px = l.x1 + l.spacing * 0.75
    const pin = g.createRadialGradient(px - 1.5, y - 1.5, 0, px, y, l.spacing * 0.2)
    pin.addColorStop(0, '#fffaf0')
    pin.addColorStop(1, '#c9bda2')
    g.fillStyle = pin
    g.beginPath()
    g.arc(px, y, l.spacing * 0.2, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#3a2a1a'
    g.beginPath()
    g.arc(px, y, l.spacing * 0.06, 0, Math.PI * 2)
    g.fill()
  }

  return { canvas: c, geo }
}

/** Classic 351-shape celluloid pick, point facing down. */
export function drawPick(g: CanvasRenderingContext2D, x: number, y: number, size: number, pattern: CanvasPattern | null) {
  g.save()
  g.translate(x, y)
  g.shadowColor = 'rgba(0,0,0,0.55)'
  g.shadowBlur = 8
  g.shadowOffsetY = 3
  g.beginPath()
  g.moveTo(0, size)
  g.bezierCurveTo(-size * 0.35, size * 0.55, -size * 0.95, -size * 0.1, -size * 0.7, -size * 0.6)
  g.bezierCurveTo(-size * 0.45, -size * 0.98, size * 0.45, -size * 0.98, size * 0.7, -size * 0.6)
  g.bezierCurveTo(size * 0.95, -size * 0.1, size * 0.35, size * 0.55, 0, size)
  g.fillStyle = pattern ?? '#8a4a1a'
  g.fill()
  g.shadowColor = 'transparent'
  g.strokeStyle = 'rgba(239,228,200,0.7)'
  g.lineWidth = 1.2
  g.stroke()
  g.restore()
}

export function tortoisePattern(g: CanvasRenderingContext2D) {
  return tortoise(g)
}
