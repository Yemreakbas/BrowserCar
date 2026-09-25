import './style.css'
import * as THREE from 'three'
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
        <span id="hud-asset-status" class="brand-subtitle">Phase 3 • Kenney Assets</span>
      </div>
      <button id="btn-reset" class="reset-btn" type="button" title="Arabayı Başlangıç Konumuna Getir (R)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
        <span>Sıfırla</span>
        <span class="reset-key-hint">R</span>
      </button>
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

// --- 4. RENDERER SETUP ---
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1

const container = document.querySelector<HTMLDivElement>('#canvas-container')!
container.appendChild(renderer.domElement)

// --- 5. LIGHTING SETUP ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
scene.add(ambientLight)

const hemisphereLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.6)
scene.add(hemisphereLight)

const sunLight = new THREE.DirectionalLight(0xfffef5, 2.4)
sunLight.position.set(45, 65, 35)
sunLight.castShadow = true
sunLight.shadow.mapSize.width = 2048
sunLight.shadow.mapSize.height = 2048
sunLight.shadow.camera.near = 1.0
sunLight.shadow.camera.far = 180
sunLight.shadow.camera.left = -50
sunLight.shadow.camera.right = 50
sunLight.shadow.camera.top = 50
sunLight.shadow.camera.bottom = -50
sunLight.shadow.bias = -0.0005
scene.add(sunLight)
scene.add(sunLight.target)

// --- 6. INITIALIZE KENNEY CITY WORLD ---
new CityWorld(scene, () => {
  console.log('✓ City environment ready')
})

// --- 7. INITIALIZE KENNEY VEHICLE ---
const vehicle = new Vehicle(scene, () => {
  hudAssetStatus.textContent = 'Kenney Sports Car • Ready'
  hudAssetStatus.style.color = '#34d399'
})

// Check if vehicle encounters an error
setTimeout(() => {
  if (vehicle.loadError) {
    hudAssetStatus.textContent = 'HATA: ' + vehicle.loadError
    hudAssetStatus.style.color = '#ef4444'
  }
}, 3000)

// --- 8. KEYBOARD & INPUT SYSTEM ---
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
      vehicle.reset()
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
  vehicle.reset()
})

// --- 9. CHASE CAMERA SETUP ---
// Following the vehicle root (+Z forward, camera at -Z behind the vehicle)
const cameraOffset = new THREE.Vector3(0, 3.8, -8.4)
const cameraLookAtLead = 2.5
const currentLookAt = new THREE.Vector3(0, 1.2, 0)
let cameraInitialized = false

// --- 10. MAIN ANIMATION & UPDATE LOOP ---
const clock = new THREE.Clock()

function animate() {
  requestAnimationFrame(animate)

  // Delta time capped to prevent large jumps on tab switch
  const delta = Math.min(clock.getDelta(), 0.05)

  // 10.1 Vehicle physics update (acceleration, steering, rolling wheels, suspension)
  vehicle.update(delta, keys)

  // 10.2 Directional Sunlight Cascade (centers on car for crisp shadows anywhere in city)
  sunLight.position.set(
    vehicle.root.position.x + 45,
    65,
    vehicle.root.position.z + 35
  )
  sunLight.target.position.copy(vehicle.root.position)
  sunLight.target.updateMatrixWorld()

  // 10.3 Smooth Third-Person Chase Camera
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
    // Frame-rate independent smooth camera lag
    const camLerpAlpha = 1 - Math.exp(-6.5 * delta)
    camera.position.lerp(targetCamPosition, camLerpAlpha)
    currentLookAt.lerp(targetLookAt, camLerpAlpha)
    camera.lookAt(currentLookAt)
  }

  // 10.4 HUD Update
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

  // 10.5 Render Scene
  renderer.render(scene, camera)
}

// --- 11. RESPONSIVE WINDOW RESIZE ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

// Start Animation Loop
animate()
