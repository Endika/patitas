import * as THREE from 'three'
import { MAX_DT } from '@/engine/math'
import { goTo, type MotionState } from '@/engine/motion/locomotion'
import { BALL_R, type BallState } from './ball'
import { cameraPosition, clampPlay, createCamera, fitCamera, type FixedCamera } from './camera'
import { createFpsMeter } from './fpsMeter'
import { addFurniture, type Furniture } from './furniture'

/** Render budget: fur shells per puppy, device pixel ratio cap and shadow map size. */
export interface Quality {
  shells: number
  dpr: number
  shadowMap: number
}

/** The prototype's settings; a phone with two puppies gives up some fur and resolution. */
export function pickQuality(dogs: 1 | 2, coarse: boolean): Quality {
  if (!coarse) return { shells: 24, dpr: 2, shadowMap: 2048 }
  return dogs === 1
    ? { shells: 16, dpr: 1.6, shadowMap: 2048 }
    : { shells: 12, dpr: 1.5, shadowMap: 1024 }
}

/** Anything the room shows: a puppy view or a prop. */
export interface SceneView {
  group: THREE.Object3D
  /** Puppies have one; the room's quality depends on how many there are. */
  setQuality?(q: Quality): void
}

const SHADOW_HALF = 1.1,
  SHADOW_MARGIN = 0.6

/** Centre and half size of the sun's shadow box: the prototype's ±1.1, grown to cover every puppy. */
export function shadowBox(at: readonly { x: number; z: number }[]): {
  x: number
  z: number
  half: number
} {
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity
  for (const p of at) {
    x0 = Math.min(x0, p.x)
    x1 = Math.max(x1, p.x)
    z0 = Math.min(z0, p.z)
    z1 = Math.max(z1, p.z)
  }
  const span = Math.hypot(x1 - x0, z1 - z0) / 2
  return {
    x: (x0 + x1) / 2,
    z: (z0 + z1) / 2,
    half: Math.max(SHADOW_HALF, span + SHADOW_MARGIN),
  }
}

export interface RoomScene {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  cam: FixedCamera
  quality: Quality
  ballMesh: THREE.Mesh
  /** The bed, bowl, scale and garden; none in the adoption preview. */
  furniture: Furniture | null
  add(view: SceneView): void
  remove(view: SceneView): void
  resize(): void
  /** Called after every resize, once the camera and play area are refitted. */
  onResize(cb: () => void): () => void
  emitHeart(at: THREE.Vector3): void
  /** A «z» rising from a sleeping puppy's head. */
  emitZ(at: THREE.Vector3): void
  start(tick: (dt: number, t: number) => void): void
  dispose(): void
}

function roomEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = new THREE.Scene()
  // A room sky with one big window, for the shine on the eyes and nose
  env.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(20, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader:
          'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `varying vec3 vP; void main(){
      float y = normalize(vP).y;
      vec3 top = vec3(0.86, 0.92, 0.95), hor = vec3(0.80, 0.80, 0.74), gnd = vec3(0.42, 0.31, 0.22);
      vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.6)) : mix(hor, gnd, pow(-y, 0.45));
      gl_FragColor = vec4(c, 1.0); }`,
      }),
    ),
  )
  const win = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 5),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(1, 0.96, 0.88).multiplyScalar(7),
      side: THREE.DoubleSide,
    }),
  )
  win.position.set(5, 6, 8)
  win.lookAt(0, 0, 0)
  env.add(win)
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 4),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.8, 0.9, 1).multiplyScalar(2.2),
      side: THREE.DoubleSide,
    }),
  )
  fill.position.set(-8, 3, 2)
  fill.lookAt(0, 0, 0)
  env.add(fill)
  const tex = pmrem.fromScene(env, 0.02).texture
  env.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  })
  pmrem.dispose()
  return tex
}

function radialCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  gr.addColorStop(0, '#fff')
  gr.addColorStop(0.5, '#fff')
  gr.addColorStop(1, '#000')
  g.fillStyle = gr
  g.fillRect(0, 0, 256, 256)
  return c
}

function floorMesh(): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 72),
    new THREE.MeshStandardMaterial({
      color: '#c49b70',
      roughness: 0.78,
      alphaMap: new THREE.CanvasTexture(radialCanvas()),
      transparent: true,
      depthWrite: false,
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  floor.renderOrder = -1
  return floor
}

function tennisBall(): THREE.Mesh {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#c9d93b'
  g.fillRect(0, 0, 256, 128)
  g.strokeStyle = '#f4f6e8'
  g.lineWidth = 5
  g.beginPath()
  for (let x = 0; x <= 256; x += 4) g.lineTo(x, 64 + 36 * Math.sin((x / 256) * Math.PI * 4))
  g.stroke()
  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 32, 20),
    new THREE.MeshStandardMaterial({ map, roughness: 0.95 }),
  )
  mesh.castShadow = true
  mesh.visible = false
  return mesh
}

function heartTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#e8606a'
  g.beginPath()
  g.moveTo(64, 112)
  g.bezierCurveTo(10, 72, 8, 30, 38, 22)
  g.bezierCurveTo(54, 18, 62, 30, 64, 40)
  g.bezierCurveTo(66, 30, 74, 18, 90, 22)
  g.bezierCurveTo(120, 30, 118, 72, 64, 112)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A soft ink «z», drawn blurred so it reads as a breath rather than a letter. */
function zTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#22302e'
  g.font = '600 52px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.filter = 'blur(1px)'
  g.fillText('z', 32, 30)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

interface Floater {
  s: THREE.Sprite
  life: number
  max: number
  rise: number
  size: number
  grow: number
  drift: number
  /** Peak opacity. */
  alpha: number
  fadeIn: boolean
}

const HEART = { max: 1.3, rise: 0.22, size: 0.05, grow: 0.03, drift: 0, alpha: 1, fadeIn: false }
const Z = { max: 2, rise: 0.1, size: 0.06, grow: 0.035, drift: 0.04, alpha: 0.75, fadeIn: true }

/** With `?fps` in the URL: a corner readout of the frame rate, written straight to the DOM. */
function fpsOverlay(canvas: HTMLCanvasElement) {
  const host = canvas.parentElement
  if (!host || !new URLSearchParams(location.search).has('fps')) return null
  const meter = createFpsMeter()
  const el = document.createElement('div')
  Object.assign(el.style, {
    position: 'absolute',
    right: '8px',
    bottom: '8px',
    padding: '2px 6px',
    borderRadius: '6px',
    background: 'rgba(0, 0, 0, 0.55)',
    color: '#fff',
    font: '12px/1.4 system-ui, sans-serif',
    fontVariantNumeric: 'tabular-nums',
    pointerEvents: 'none',
    zIndex: '5',
  })
  el.textContent = '-- fps'
  host.append(el)
  let shown = 0
  return {
    frame(now: number) {
      meter.frame(now)
      if (now - shown < 500) return
      shown = now
      el.textContent = `${Math.round(meter.fps())} fps`
    },
    remove: () => el.remove(),
  }
}

/**
 * Throws when the browser has no WebGL. `coarse` is a touch screen; `frame` places the camera
 * for the canvas's aspect on every resize.
 */
export function createRoomScene(
  canvas: HTMLCanvasElement,
  coarse = matchMedia('(pointer: coarse)').matches,
  frame: (cam: FixedCamera, aspect: number) => void = fitCamera,
  { furniture: withFurniture = true }: { furniture?: boolean } = {},
): RoomScene {
  let quality = pickQuality(1, coarse)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.dpr))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60)
  const cam = createCamera()
  scene.environment = roomEnvironment(renderer)
  scene.environmentIntensity = 0.9

  const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.94, 0.85), 2.4)
  sun.position.set(1.6, 3.4, 2.4)
  sun.target.position.set(0, 0.3, 0)
  sun.castShadow = true
  sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap)
  Object.assign(sun.shadow.camera, { near: 0.5, far: 8 })
  let shadowHalf = 0
  const fitShadow = (half: number) => {
    if (half === shadowHalf) return
    shadowHalf = half
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half })
    sun.shadow.camera.updateProjectionMatrix()
  }
  fitShadow(SHADOW_HALF)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.01
  scene.add(sun, sun.target)
  const rim = new THREE.DirectionalLight(new THREE.Color(0.85, 0.92, 1), 1.1)
  rim.position.set(-2.2, 1.6, -2.8)
  scene.add(rim)
  scene.add(floorMesh())
  const ballMesh = tennisBall()
  scene.add(ballMesh)
  const furniture = withFurniture ? addFurniture(scene, cam) : null

  const fpsReadout = fpsOverlay(canvas)
  const views = new Set<SceneView>()
  const resizeListeners = new Set<() => void>()
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const heartMap = heartTexture(),
    zMap = zTexture()
  const floaters: Floater[] = []
  const emit = (
    map: THREE.Texture,
    at: THREE.Vector3,
    kind: Omit<Floater, 's' | 'life'>,
    jitter: number,
  ) => {
    if (reduceMotion) return
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0 }),
    )
    s.position
      .copy(at)
      .add(new THREE.Vector3((Math.random() - 0.5) * jitter, 0.04, (Math.random() - 0.5) * jitter))
    s.scale.setScalar(kind.size)
    scene.add(s)
    floaters.push({ s, life: 0, ...kind })
  }

  const resize = () => {
    const w = canvas.clientWidth,
      h = canvas.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    frame(cam, camera.aspect)
    camera.updateProjectionMatrix()
    cameraPosition(cam, camera.position)
    camera.lookAt(cam.target)
    camera.updateMatrixWorld()
    furniture?.layout(cam)
    for (const cb of resizeListeners) cb()
  }
  addEventListener('resize', resize)
  resize()

  const tickFloaters = (dt: number) => {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]!
      f.life += dt
      f.s.position.y += dt * f.rise
      f.s.position.x += dt * f.drift
      f.s.scale.setScalar(f.size + f.life * f.grow)
      // A «z» fades in over the first tenth of its life; both fade out over the rest
      const k = f.life / f.max
      f.s.material.opacity = f.alpha * Math.max(0, Math.min(f.fadeIn ? k * 10 : 1, 1 - k))
      if (f.life > f.max) {
        scene.remove(f.s)
        f.s.material.dispose()
        floaters.splice(i, 1)
      }
    }
  }

  // The sun's shadow box follows the puppies
  const follow = () => {
    if (!views.size) return
    const box = shadowBox([...views].map((v) => v.group.position))
    sun.position.set(box.x + 1.6, 3.4, box.z + 2.4)
    sun.target.position.set(box.x, 0.3, box.z)
    fitShadow(box.half)
  }

  const requality = () => {
    let dogs = 0
    for (const v of views) if (v.setQuality) dogs++
    const q = pickQuality(dogs > 1 ? 2 : 1, coarse)
    if (q.shells === quality.shells && q.dpr === quality.dpr && q.shadowMap === quality.shadowMap)
      return
    quality = room.quality = q
    renderer.setPixelRatio(Math.min(devicePixelRatio, q.dpr))
    if (sun.shadow.mapSize.x !== q.shadowMap) {
      sun.shadow.mapSize.set(q.shadowMap, q.shadowMap)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    }
    for (const v of views) v.setQuality?.(q)
  }

  const room: RoomScene = {
    renderer,
    scene,
    camera,
    cam,
    quality,
    ballMesh,
    furniture,
    add(view) {
      views.add(view)
      scene.add(view.group)
      view.setQuality?.(quality)
      requality()
    },
    remove(view) {
      views.delete(view)
      scene.remove(view.group)
      requality()
    },
    resize,
    onResize(cb) {
      resizeListeners.add(cb)
      return () => resizeListeners.delete(cb)
    },
    emitHeart: (at) => emit(heartMap, at, HEART, 0.08),
    emitZ: (at) => emit(zMap, at, Z, 0.03),
    start(tick) {
      const clock = new THREE.Clock()
      renderer.setAnimationLoop(() => {
        const dt = Math.min(clock.getDelta(), MAX_DT),
          t = clock.elapsedTime
        tick(dt, t)
        follow()
        tickFloaters(dt)
        renderer.render(scene, camera)
        fpsReadout?.frame(performance.now())
      })
    },
    dispose() {
      renderer.setAnimationLoop(null)
      fpsReadout?.remove()
      removeEventListener('resize', resize)
      resizeListeners.clear()
      // Puppy views own their resources and may share cached geometry
      for (const v of views) scene.remove(v.group)
      views.clear()
      furniture?.dispose()
      for (const f of floaters) f.s.material.dispose()
      heartMap.dispose()
      zMap.dispose()
      scene.environment?.dispose()
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          const mat = o.material as THREE.MeshStandardMaterial
          mat.map?.dispose()
          mat.alphaMap?.dispose()
          mat.dispose()
        }
      })
      sun.shadow.dispose()
      renderer.dispose()
      // Cached puppy geometry keeps a dispose listener that holds this renderer: let the GPU go now
      renderer.forceContextLoss()
    },
  }
  return room
}

/** Puts the ball mesh where the ball is: in front of the camera when in hand. */
export function syncBallMesh(room: RoomScene, ball: BallState): void {
  const mesh = room.ballMesh
  mesh.visible = ball.state !== 'none'
  if (ball.state === 'hand') ball.pos.set(0, -0.26, -1).applyMatrix4(room.camera.matrixWorld)
  mesh.position.copy(ball.pos)
  mesh.rotation.set(ball.rot.x, 0, ball.rot.z)
}

/**
 * After the play area changes (a resize or a turned screen), a puppy standing or heading outside
 * it walks back in rather than jumping.
 */
export function keepInPlay(
  m: MotionState,
  cam: FixedCamera,
  mood: { happy: number; energy: number },
): boolean {
  const at = m.goal ?? m.pos
  const [x, z] = clampPlay(cam, at.x, at.z)
  if (Math.hypot(x - at.x, z - at.z) < 1e-3) return false
  goTo(m, x, z, { happy: mood.happy, energy: mood.energy, clamp: (cx, cz) => [cx, cz] })
  return true
}
