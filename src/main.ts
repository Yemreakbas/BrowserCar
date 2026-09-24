import './style.css'
import * as THREE from 'three'

// --- 1. DOM & HUD SETUP ---
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div id="canvas-container"></div>
  <div id="hud-overlay">
    <header class="hud-header">
      <div class="brand-badge">
        <span class="status-dot"></span>
        <span class="brand-title">BrowserCar 3D</span>
        <span class="brand-subtitle">Prototype</span>
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

// --- 2. THREE.JS SCENE SETUP ---
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xa8cded)
scene.fog = new THREE.Fog(0xa8cded, 50, 220)

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
renderer.toneMappingExposure = 1.05

const container = document.querySelector<HTMLDivElement>('#canvas-container')!
container.appendChild(renderer.domElement)

// --- 5. LIGHTING SETUP ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.75)
scene.add(ambientLight)

const hemisphereLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.55)
scene.add(hemisphereLight)

const sunLight = new THREE.DirectionalLight(0xfffef5, 2.2)
sunLight.position.set(35, 55, 30)
sunLight.castShadow = true
sunLight.shadow.mapSize.width = 2048
sunLight.shadow.mapSize.height = 2048
sunLight.shadow.camera.near = 1.0
sunLight.shadow.camera.far = 160
sunLight.shadow.camera.left = -40
sunLight.shadow.camera.right = 40
sunLight.shadow.camera.top = 40
sunLight.shadow.camera.bottom = -40
sunLight.shadow.bias = -0.0006
scene.add(sunLight)
scene.add(sunLight.target)

// --- 6. ENVIRONMENT & GROUND ---
// Ground Plane
const groundSize = 600
const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize)
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x1e242d,
  roughness: 0.88,
  metalness: 0.12,
})
const ground = new THREE.Mesh(groundGeo, groundMat)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// Subtle Ground Grid Helper
const gridHelper = new THREE.GridHelper(groundSize, 120, 0x475569, 0x2e3846)
gridHelper.position.y = 0.01
scene.add(gridHelper)

// Central Plaza & Slalom Course
function createTrackMarkers() {
  const markerGroup = new THREE.Group()

  // Center Spawn Pad (Ring)
  const padGeo = new THREE.RingGeometry(8, 8.4, 48)
  const padMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
  const padMesh = new THREE.Mesh(padGeo, padMat)
  padMesh.rotation.x = -Math.PI / 2
  padMesh.position.y = 0.02
  markerGroup.add(padMesh)

  // Slalom Cones along the course
  const coneGeo = new THREE.ConeGeometry(0.35, 0.8, 16)
  const coneMat = new THREE.MeshStandardMaterial({
    color: 0xff6b35,
    roughness: 0.4,
    metalness: 0.1,
  })
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const stripeGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.16, 16)

  const coneZPositions = [15, 26, 37, 48, 59, 70, 81]
  coneZPositions.forEach((zPos, index) => {
    const coneGroup = new THREE.Group()
    const cone = new THREE.Mesh(coneGeo, coneMat)
    cone.position.y = 0.4
    cone.castShadow = true
    cone.receiveShadow = true
    coneGroup.add(cone)

    const stripe = new THREE.Mesh(stripeGeo, stripeMat)
    stripe.position.y = 0.38
    coneGroup.add(stripe)

    // Alternate left and right for slalom practice
    const xOffset = (index % 2 === 0 ? 1 : -1) * 3.5
    coneGroup.position.set(xOffset, 0, zPos)
    markerGroup.add(coneGroup)
  })

  // Distance markers along the straight track
  for (let z = 100; z <= 240; z += 35) {
    const barrierGeo = new THREE.BoxGeometry(0.6, 0.6, 2.5)
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 })

    const leftBarrier = new THREE.Mesh(barrierGeo, barrierMat)
    leftBarrier.position.set(-10, 0.3, z)
    leftBarrier.castShadow = true
    leftBarrier.receiveShadow = true
    markerGroup.add(leftBarrier)

    const rightBarrier = new THREE.Mesh(barrierGeo, barrierMat)
    rightBarrier.position.set(10, 0.3, z)
    rightBarrier.castShadow = true
    rightBarrier.receiveShadow = true
    markerGroup.add(rightBarrier)
  }

  scene.add(markerGroup)
}
createTrackMarkers()

// --- 7. LOW-POLY CAR CONSTRUCTION ---
const car = new THREE.Group()
car.position.set(0, 0, 0)
scene.add(car)

// Body tilted/roll child group (allows suspension lean when cornering/braking)
const carBody = new THREE.Group()
car.add(carBody)

// Color Materials
const paintMaterial = new THREE.MeshStandardMaterial({
  color: 0x2563eb, // Sporty Royal Blue
  roughness: 0.35,
  metalness: 0.3,
})

const cabinGlassMaterial = new THREE.MeshStandardMaterial({
  color: 0x0f172a, // Dark tinted glass
  roughness: 0.15,
  metalness: 0.85,
})

const trimMaterial = new THREE.MeshStandardMaterial({
  color: 0x111827, // Dark matte trim
  roughness: 0.7,
})

const headlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xfffbe8,
  emissive: 0xffeed0,
  emissiveIntensity: 1.8,
  roughness: 0.2,
})

const taillightMaterial = new THREE.MeshStandardMaterial({
  color: 0xff1e1e,
  emissive: 0xff0020,
  emissiveIntensity: 1.6,
  roughness: 0.2,
})

// 7.1 Chassis / Lower Body
const chassisGeo = new THREE.BoxGeometry(1.8, 0.48, 4.0)
const chassisMesh = new THREE.Mesh(chassisGeo, paintMaterial)
chassisMesh.position.y = 0.5
chassisMesh.castShadow = true
chassisMesh.receiveShadow = true
carBody.add(chassisMesh)

// 7.2 Cabin / Cockpit
const cabinGeo = new THREE.BoxGeometry(1.35, 0.48, 2.1)
const cabinMesh = new THREE.Mesh(cabinGeo, cabinGlassMaterial)
cabinMesh.position.set(0, 0.92, -0.2)
cabinMesh.castShadow = true
cabinMesh.receiveShadow = true
carBody.add(cabinMesh)

// Cabin Roof Cap
const roofGeo = new THREE.BoxGeometry(1.36, 0.08, 1.7)
const roofMesh = new THREE.Mesh(roofGeo, paintMaterial)
roofMesh.position.set(0, 1.18, -0.2)
roofMesh.castShadow = true
carBody.add(roofMesh)

// 7.3 Aerodynamic Hood Scoop & Bumpers
const hoodSlopeGeo = new THREE.BoxGeometry(1.4, 0.14, 1.1)
const hoodSlopeMesh = new THREE.Mesh(hoodSlopeGeo, paintMaterial)
hoodSlopeMesh.position.set(0, 0.76, 1.1)
hoodSlopeMesh.rotation.x = 0.1
hoodSlopeMesh.castShadow = true
carBody.add(hoodSlopeMesh)

// Front Bumper / Splitter
const frontSplitterGeo = new THREE.BoxGeometry(1.84, 0.18, 0.3)
const frontSplitterMesh = new THREE.Mesh(frontSplitterGeo, trimMaterial)
frontSplitterMesh.position.set(0, 0.32, 2.05)
frontSplitterMesh.castShadow = true
carBody.add(frontSplitterMesh)

// Rear Bumper / Diffuser
const rearDiffuserGeo = new THREE.BoxGeometry(1.84, 0.22, 0.26)
const rearDiffuserMesh = new THREE.Mesh(rearDiffuserGeo, trimMaterial)
rearDiffuserMesh.position.set(0, 0.35, -2.03)
rearDiffuserMesh.castShadow = true
carBody.add(rearDiffuserMesh)

// Rear Spoiler
const wingGeo = new THREE.BoxGeometry(1.5, 0.06, 0.32)
const wingMesh = new THREE.Mesh(wingGeo, trimMaterial)
wingMesh.position.set(0, 1.1, -1.82)
wingMesh.castShadow = true
carBody.add(wingMesh)

const strutGeo = new THREE.BoxGeometry(0.06, 0.3, 0.1)
const leftStrut = new THREE.Mesh(strutGeo, trimMaterial)
leftStrut.position.set(-0.5, 0.94, -1.82)
leftStrut.castShadow = true
carBody.add(leftStrut)

const rightStrut = new THREE.Mesh(strutGeo, trimMaterial)
rightStrut.position.set(0.5, 0.94, -1.82)
rightStrut.castShadow = true
carBody.add(rightStrut)

// 7.4 Headlights & Taillights
const headlightGeo = new THREE.BoxGeometry(0.36, 0.14, 0.08)
const leftHeadlight = new THREE.Mesh(headlightGeo, headlightMaterial)
leftHeadlight.position.set(-0.62, 0.52, 2.02)
carBody.add(leftHeadlight)

const rightHeadlight = new THREE.Mesh(headlightGeo, headlightMaterial)
rightHeadlight.position.set(0.62, 0.52, 2.02)
carBody.add(rightHeadlight)

const taillightGeo = new THREE.BoxGeometry(0.38, 0.12, 0.08)
const leftTaillight = new THREE.Mesh(taillightGeo, taillightMaterial)
leftTaillight.position.set(-0.62, 0.54, -2.02)
carBody.add(leftTaillight)

const rightTaillight = new THREE.Mesh(taillightGeo, taillightMaterial)
rightTaillight.position.set(0.62, 0.54, -2.02)
carBody.add(rightTaillight)

// 7.5 Wheels Setup
const wheelRadius = 0.38
const wheelWidth = 0.28
const tireMaterial = new THREE.MeshStandardMaterial({
  color: 0x17171b,
  roughness: 0.85,
  metalness: 0.1,
})
const rimMaterial = new THREE.MeshStandardMaterial({
  color: 0xd8e0e8,
  metalness: 0.9,
  roughness: 0.25,
})

function buildWheelMesh(): THREE.Group {
  const wheelGroup = new THREE.Group()

  // Tire cylinder
  const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 24)
  tireGeo.rotateZ(Math.PI / 2)
  const tireMesh = new THREE.Mesh(tireGeo, tireMaterial)
  tireMesh.castShadow = true
  tireMesh.receiveShadow = true
  wheelGroup.add(tireMesh)

  // Rim cylinder
  const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.62, wheelRadius * 0.62, wheelWidth + 0.02, 16)
  rimGeo.rotateZ(Math.PI / 2)
  const rimMesh = new THREE.Mesh(rimGeo, rimMaterial)
  rimMesh.castShadow = true
  wheelGroup.add(rimMesh)

  // Center hubcap
  const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, wheelWidth + 0.04, 12)
  hubGeo.rotateZ(Math.PI / 2)
  const hubMesh = new THREE.Mesh(hubGeo, paintMaterial)
  wheelGroup.add(hubMesh)

  return wheelGroup
}

// Wheel Positions
const wheelTrackX = 0.98
const wheelBaseZ = 1.28
const wheelPosY = wheelRadius

// Front Steerable Wheels (pivoting on Y)
const frontLeftPivot = new THREE.Group()
frontLeftPivot.position.set(-wheelTrackX, wheelPosY, wheelBaseZ)
const frontLeftWheel = buildWheelMesh()
frontLeftPivot.add(frontLeftWheel)
car.add(frontLeftPivot)

const frontRightPivot = new THREE.Group()
frontRightPivot.position.set(wheelTrackX, wheelPosY, wheelBaseZ)
const frontRightWheel = buildWheelMesh()
frontRightPivot.add(frontRightWheel)
car.add(frontRightPivot)

// Rear Wheels
const rearLeftPivot = new THREE.Group()
rearLeftPivot.position.set(-wheelTrackX, wheelPosY, -wheelBaseZ)
const rearLeftWheel = buildWheelMesh()
rearLeftPivot.add(rearLeftWheel)
car.add(rearLeftPivot)

const rearRightPivot = new THREE.Group()
rearRightPivot.position.set(wheelTrackX, wheelPosY, -wheelBaseZ)
const rearRightWheel = buildWheelMesh()
rearRightPivot.add(rearRightWheel)
car.add(rearRightPivot)

const allWheelMeshes = [frontLeftWheel, frontRightWheel, rearLeftWheel, rearRightWheel]

// --- 8. KEYBOARD & INPUT SYSTEM ---
const keys = {
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
      resetCar()
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
  resetCar()
})

// --- 9. CAR VEHICLE DYNAMICS ---
let currentSpeed = 0
let currentSteerAngle = 0
let wheelSpinAngle = 0

// Physics tuning parameters
const MAX_FORWARD_SPEED = 28.0 // ~101 km/h
const MAX_REVERSE_SPEED = -11.0 // ~40 km/h
const ACCELERATION = 16.0 // Forward acceleration rate
const REVERSE_ACCEL = 10.0 // Reverse acceleration rate
const BRAKING_POWER = 26.0 // Foot brake power
const HANDBRAKE_POWER = 38.0 // Handbrake friction
const DRAG = 5.5 // Natural rolling friction / aerodynamic drag
const MAX_STEER_ANGLE = 0.52 // Front wheel angle in radians (~30 deg)
const STEER_SPEED = 4.5 // Steering response speed
const TURN_RATE = 1.85 // Car yaw turning rate

function resetCar() {
  currentSpeed = 0
  currentSteerAngle = 0
  car.position.set(0, 0, 0)
  car.rotation.set(0, 0, 0)
  carBody.rotation.set(0, 0, 0)
  frontLeftPivot.rotation.y = 0
  frontRightPivot.rotation.y = 0
}

// Camera Follow Variables
const cameraOffset = new THREE.Vector3(0, 3.8, -8.2)
const cameraLookAtLead = 2.4
const currentLookAt = new THREE.Vector3(0, 1.2, 0)
let cameraInitialized = false

// --- 10. MAIN ANIMATION & UPDATE LOOP ---
const clock = new THREE.Clock()

function animate() {
  requestAnimationFrame(animate)

  // Delta time capped to prevent large jumps on tab switch
  const delta = Math.min(clock.getDelta(), 0.05)

  // 10.1 Acceleration & Braking Calculation
  if (keys.handbrake) {
    if (Math.abs(currentSpeed) < HANDBRAKE_POWER * delta) {
      currentSpeed = 0
    } else if (currentSpeed > 0) {
      currentSpeed -= HANDBRAKE_POWER * delta
    } else {
      currentSpeed += HANDBRAKE_POWER * delta
    }
  } else if (keys.forward) {
    if (currentSpeed < 0) {
      // Braking while reversing
      currentSpeed += BRAKING_POWER * delta
    } else {
      // Accelerating forward
      currentSpeed = Math.min(currentSpeed + ACCELERATION * delta, MAX_FORWARD_SPEED)
    }
  } else if (keys.backward) {
    if (currentSpeed > 0) {
      // Braking while going forward
      currentSpeed = Math.max(currentSpeed - BRAKING_POWER * delta, 0)
    } else {
      // Reversing
      currentSpeed = Math.max(currentSpeed - REVERSE_ACCEL * delta, MAX_REVERSE_SPEED)
    }
  } else {
    // Coasting Drag / Friction
    if (Math.abs(currentSpeed) < DRAG * delta) {
      currentSpeed = 0
    } else if (currentSpeed > 0) {
      currentSpeed -= DRAG * delta
    } else {
      currentSpeed += DRAG * delta
    }
  }

  // 10.2 Steering Transition
  let targetSteer = 0
  if (keys.left) targetSteer -= 1.0
  if (keys.right) targetSteer += 1.0

  currentSteerAngle = THREE.MathUtils.lerp(
    currentSteerAngle,
    targetSteer * MAX_STEER_ANGLE,
    1 - Math.exp(-STEER_SPEED * delta)
  )

  // Visually pivot front wheels
  frontLeftPivot.rotation.y = currentSteerAngle
  frontRightPivot.rotation.y = currentSteerAngle

  // 10.3 Car Heading Rotation & Position Translation
  if (Math.abs(currentSpeed) > 0.05) {
    // Normalized speed factor so car steers progressively with movement
    const speedFactor = Math.min(Math.abs(currentSpeed) / 5.0, 1.0)
    const directionSign = currentSpeed >= 0 ? 1 : -1

    // Yaw rotation
    car.rotation.y += currentSteerAngle * TURN_RATE * speedFactor * directionSign * delta
  }

  // Forward movement along current car heading
  const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    car.rotation.y
  )
  car.position.addScaledVector(forward, currentSpeed * delta)

  // 10.4 Wheel Rolling Animation
  const distanceTravelled = currentSpeed * delta
  wheelSpinAngle += distanceTravelled / wheelRadius
  for (const wheel of allWheelMeshes) {
    wheel.rotation.x = wheelSpinAngle
  }

  // 10.5 Dynamic Body Tilt (Suspension Pitch & Roll)
  const targetPitch = (keys.forward ? -0.04 : (keys.backward ? 0.05 : 0)) * (Math.abs(currentSpeed) / MAX_FORWARD_SPEED)
  const targetRoll = -currentSteerAngle * 0.08 * (Math.abs(currentSpeed) / MAX_FORWARD_SPEED)
  carBody.rotation.x = THREE.MathUtils.lerp(carBody.rotation.x, targetPitch, 0.15)
  carBody.rotation.z = THREE.MathUtils.lerp(carBody.rotation.z, targetRoll, 0.15)

  // 10.6 Directional Sunlight Cascade (stays centered on car for crisp shadows)
  sunLight.position.set(car.position.x + 35, 55, car.position.z + 30)
  sunLight.target.position.copy(car.position)
  sunLight.target.updateMatrixWorld()

  // 10.7 Smooth Third-Person Chase Camera
  const desiredCamOffset = cameraOffset.clone().applyQuaternion(car.quaternion)
  const targetCamPosition = car.position.clone().add(desiredCamOffset)

  const desiredLookAtOffset = new THREE.Vector3(0, 1.2, cameraLookAtLead).applyQuaternion(car.quaternion)
  const targetLookAt = car.position.clone().add(desiredLookAtOffset)

  if (!cameraInitialized) {
    camera.position.copy(targetCamPosition)
    currentLookAt.copy(targetLookAt)
    camera.lookAt(currentLookAt)
    cameraInitialized = true
  } else {
    // Frame-rate independent smooth lerp
    const camLerpAlpha = 1 - Math.exp(-6.5 * delta)
    camera.position.lerp(targetCamPosition, camLerpAlpha)
    currentLookAt.lerp(targetLookAt, camLerpAlpha)
    camera.lookAt(currentLookAt)
  }

  // 10.8 HUD Update
  const speedKmh = Math.round(Math.abs(currentSpeed) * 3.6)
  hudSpeed.textContent = speedKmh.toString()

  const speedPercent = Math.min(speedKmh / (MAX_FORWARD_SPEED * 3.6), 1.0) * 100
  hudSpeedBar.style.width = `${speedPercent}%`

  if (Math.abs(currentSpeed) < 0.2) {
    hudGear.textContent = 'N'
    hudGear.className = 'gear-badge neutral'
  } else if (currentSpeed > 0) {
    hudGear.textContent = 'D'
    hudGear.className = 'gear-badge'
  } else {
    hudGear.textContent = 'R'
    hudGear.className = 'gear-badge reverse'
  }

  // Render Scene
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
