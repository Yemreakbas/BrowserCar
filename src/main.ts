import './style.css'
import * as THREE from 'three'
import { PhysicsWorld } from './physics/PhysicsWorld.ts'
import { Vehicle, type VehicleInput } from './vehicle/Vehicle.ts'
import { CityWorld } from './world/CityWorld.ts'

// --- 1. DOM & HUD SETUP ---
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div id="canvas-container"></div>
  <div id="hud-overlay">
    <header class="hud-header">
      <div class="brand-badge">
        <span class="status-dot"></span>
        <span class="brand-title">BrowserCar 3D</span>
        <span id="hud-asset-status" class="brand-subtitle">Phase 4 • Rapier Physics</span>
      </div>
      <div style="display: flex; gap: 10px; align-items: center;">
        <div id="hud-fps-badge" class="brand-badge" style="font-family: monospace; font-size: 13px; font-weight: 700; color: #34d399; letter-spacing: 0.5px; padding: 6px 12px;">
          -- FPS
        </div>
        <button id="btn-reset" class="reset-btn" type="button" title="Arabayı Başlangıç Konumuna Getir (R)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          <span>Sıfırla</span>
          <span class="reset-key-hint">R</span>
        </button>
      </div>
    </header>

    <footer class="hud-footer">
      <div class="speedometer-card">
        <div class="speed-main">
          <span id="hud-speed" class="speed-value">0</span>
          <span class="speed-unit">KM/H</span>
          <span id="hud-gear" class="gear-badge neutral">N</span>
        </div>
        <div class="speed-bar-track">
          <div id="hud-speed-bar" class="speed-bar-fill"></div>
        </div>
      </div>

      <div class="controls-card">
        <div class="controls-title">Kontroller</div>
        <div class="wasd-grid">
          <div class="wasd-row">
            <div id="key-w" class="key-box">
              <span>W</span>
              <span class="key-hint">Gaz</span>
            </div>
          </div>
          <div class="wasd-row">
            <div id="key-a" class="key-box">
              <span>A</span>
              <span class="key-hint">Sol</span>
            </div>
            <div id="key-s" class="key-box">
              <span>S</span>
              <span class="key-hint">Fren</span>
            </div>
            <div id="key-d" class="key-box">
              <span>D</span>
              <span class="key-hint">Sağ</span>
            </div>
          </div>
        </div>
        <div class="controls-legend">
          <span>El Freni: Boşluk</span>
          <span>•</span>
          <span>Sıfırla: R</span>
        </div>
      </div>
    </footer>
  </div>
`

// HUD Elements
const hudSpeed = document.querySelector<HTMLSpanElement>('#hud-speed')!
const hudGear = document.querySelector<HTMLSpanElement>('#hud-gear')!
const hudSpeedBar = document.querySelector<HTMLDivElement>('#hud-speed-bar')!
const keyW = document.querySelector<HTMLDivElement>('#key-w')!
const keyA = document.querySelector<HTMLDivElement>('#key-a')!
const keyS = document.querySelector<HTMLDivElement>('#key-s')!
const keyD = document.querySelector<HTMLDivElement>('#key-d')!
const btnReset = document.querySelector<HTMLButtonElement>('#btn-reset')!
const hudAssetStatus = document.querySelector<HTMLSpanElement>('#hud-asset-status')!
const hudFpsBadge = document.querySelector<HTMLDivElement>('#hud-fps-badge')!

// --- 2. THREE.JS SCENE SETUP ---
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x93c5fd) // Soft sky blue
scene.fog = new THREE.Fog(0x93c5fd, 60, 240)

// --- 3. CAMERA SETUP ---
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)

// --- 4. RENDERER & PERFORMANCE OPTIMIZATIONS ---
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setSize(window.innerWidth, window.innerHeight)
// Cap pixel ratio at 1.5 to eliminate 4K GPU fill-rate throttling while maintaining crystal sharpness
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap // Fast, crisp shadow filtering
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1

const container = document.querySelector<HTMLDivElement>('#canvas-container')!
container.appendChild(renderer.domElement)

// --- 5. LIGHTING SETUP ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.85)
scene.add(ambientLight)

const hemisphereLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.6)
scene.add(hemisphereLight)

const sunLight = new THREE.DirectionalLight(0xfffef5, 2.3)
sunLight.position.set(40, 60, 30)
sunLight.castShadow = true
// 1024x1024 shadow map cuts shadow texture memory and rasterization time by 75%
sunLight.shadow.mapSize.width = 1024
sunLight.shadow.mapSize.height = 1024
sunLight.shadow.camera.near = 1.0
sunLight.shadow.camera.far = 160
sunLight.shadow.camera.left = -30
sunLight.shadow.camera.right = 30
sunLight.shadow.camera.top = 30
sunLight.shadow.camera.bottom = -30
sunLight.shadow.bias = -0.0006
scene.add(sunLight)
scene.add(sunLight.target)

// --- 6. INITIALIZE RAPIER 3D & CITY WORLD ---
async function bootstrap() {
  const physicsWorld = new PhysicsWorld()
  await physicsWorld.init()

  // Build City World
  new CityWorld(scene, () => {
    console.log('✓ City environment ready')
  })

  // Build Physics Vehicle
  const vehicle = new Vehicle(scene, physicsWorld, () => {
    hudAssetStatus.textContent = 'Rapier Physics Car • Active'
    hudAssetStatus.style.color = '#34d399'
  })

  // Keyboard controls
  const keys: VehicleInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    handbrake: false,
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return

    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = true
        keyW.classList.add('active')
        break
      case 'KeyS':
      case 'ArrowDown':
        keys.backward = true
        keyS.classList.add('active')
        break
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = true
        keyA.classList.add('active')
        break
      case 'KeyD':
      case 'ArrowRight':
        keys.right = true
        keyD.classList.add('active')
        break
      case 'Space':
        keys.handbrake = true
        break
      case 'KeyR':
        vehicle.reset(0, 0)
        break
    }
  })

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = false
        keyW.classList.remove('active')
        break
      case 'KeyS':
      case 'ArrowDown':
        keys.backward = false
        keyS.classList.remove('active')
        break
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = false
        keyA.classList.remove('active')
        break
      case 'KeyD':
      case 'ArrowRight':
        keys.right = false
        keyD.classList.remove('active')
        break
      case 'Space':
        keys.handbrake = false
        break
    }
  })

  btnReset.addEventListener('click', () => {
    vehicle.reset(0, 0)
  })

  // --- 7. CHASE CAMERA VARIABLES ---
  const cameraOffset = new THREE.Vector3(0, 3.8, -8.4)
  const cameraLookAtLead = 2.5
  const currentLookAt = new THREE.Vector3(0, 1.2, 0)
  let cameraInitialized = false

  // --- 8. PERFORMANCE & FPS MONITOR ---
  let frameCount = 0
  let lastFpsUpdateTime = performance.now()

  // --- 9. MAIN ANIMATION & PHYSICS LOOP ---
  let lastTime = performance.now()

  function animate() {
    requestAnimationFrame(animate)

    const now = performance.now()
    const rawDelta = (now - lastTime) / 1000
    lastTime = now
    const delta = Math.min(rawDelta, 0.05)

    // 9.1 Physics Simulation Step
    physicsWorld.step()

    // 9.2 Vehicle Dynamics Update
    vehicle.update(delta, keys)

    // 9.3 Directional Sunlight Cascade (follows vehicle for sharp local shadows)
    sunLight.position.set(
      vehicle.root.position.x + 40,
      60,
      vehicle.root.position.z + 30
    )
    sunLight.target.position.copy(vehicle.root.position)
    sunLight.target.updateMatrixWorld()

    // 9.4 Smooth Third-Person Chase Camera
    const desiredCamOffset = cameraOffset.clone().applyQuaternion(vehicle.root.quaternion)
    const targetCamPosition = vehicle.root.position.clone().add(desiredCamOffset)

    const desiredLookAtOffset = new THREE.Vector3(0, 1.2, cameraLookAtLead).applyQuaternion(
      vehicle.root.quaternion
    )
    const targetLookAt = vehicle.root.position.clone().add(desiredLookAtOffset)

    if (!cameraInitialized) {
      camera.position.copy(targetCamPosition)
      currentLookAt.copy(targetLookAt)
      camera.lookAt(currentLookAt)
      cameraInitialized = true
    } else {
      const camLerpAlpha = 1 - Math.exp(-7.0 * delta)
      camera.position.lerp(targetCamPosition, camLerpAlpha)
      currentLookAt.lerp(targetLookAt, camLerpAlpha)
      camera.lookAt(currentLookAt)
    }

    // 9.5 HUD Speedometer & Gear Update
    const speedKmh = vehicle.getSpeedKmh()
    hudSpeed.textContent = speedKmh.toString()

    const speedPercent = Math.min(speedKmh / (vehicle.MAX_FORWARD_SPEED * 3.6), 1.0) * 100
    hudSpeedBar.style.width = `${speedPercent}%`

    if (Math.abs(vehicle.currentSpeed) < 0.2) {
      hudGear.textContent = 'N'
      hudGear.className = 'gear-badge neutral'
    } else if (vehicle.currentSpeed > 0) {
      hudGear.textContent = 'D'
      hudGear.className = 'gear-badge'
    } else {
      hudGear.textContent = 'R'
      hudGear.className = 'gear-badge reverse'
    }

    // 9.6 FPS Monitor Update
    frameCount++
    if (now - lastFpsUpdateTime >= 500) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdateTime))
      hudFpsBadge.textContent = `${fps} FPS`
      if (fps >= 55) {
        hudFpsBadge.style.color = '#34d399' // Green
      } else if (fps >= 35) {
        hudFpsBadge.style.color = '#facc15' // Yellow
      } else {
        hudFpsBadge.style.color = '#ef4444' // Red
      }
      frameCount = 0
      lastFpsUpdateTime = now
    }

    // 9.7 Render Scene
    renderer.render(scene, camera)
  }

  animate()
}

// --- 10. RESPONSIVE WINDOW RESIZE ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
})

// Start Application
bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err)
  hudAssetStatus.textContent = 'BAŞLATMA HATASI'
  hudAssetStatus.style.color = '#ef4444'
})
