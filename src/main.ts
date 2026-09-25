import './style.css'
import * as THREE from 'three'
import { PhysicsWorld } from './physics/PhysicsWorld.ts'
import { Vehicle, type VehicleInput } from './vehicle/Vehicle.ts'
import { CityWorld } from './world/CityWorld.ts'
import { RaceTrack } from './world/RaceTrack.ts'
import { DriftTrack } from './world/DriftTrack.ts'

import { GameModeType, type ModeHUDController } from './modes/types.ts'
import { ModeManager } from './modes/ModeManager.ts'
import { TireSmokeSystem } from './effects/TireSmoke.ts'
import type { RaceResult } from './race/RaceSystem.ts'

// --- 1. DOM & HUD SETUP ---
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div id="canvas-container"></div>
  <div id="hud-overlay">
    <header class="hud-header">
      <div class="brand-badge">
        <span class="status-dot"></span>
        <span class="brand-title">BrowserCar 3D</span>
        <span id="hud-asset-status" class="brand-subtitle">Mod Yükleniyor...</span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <div id="hud-fps-badge" class="brand-badge" style="font-family: monospace; font-size: 13px; font-weight: 700; color: #34d399; letter-spacing: 0.5px; padding: 6px 12px;">
          -- FPS
        </div>
        <button id="btn-menu" class="reset-btn" type="button" title="Oyun Modları ve Harita Seçimi (ESC / M)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
            <polyline points="2 17 12 22 22 17"/>
            <polyline points="2 12 12 17 22 12"/>
          </svg>
          <span id="menu-btn-text">Modlar</span>
          <span class="reset-key-hint">ESC</span>
        </button>
        <button id="btn-spawn" class="reset-btn" type="button" title="Başlangıç Konumunu Değiştir (C)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <span id="spawn-btn-text">Konum Değiştir</span>
          <span class="reset-key-hint">C</span>
        </button>
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

      <!-- Dedicated Racing Telemetry Card for Race Track Mode -->
      <div id="race-telemetry-card" class="speedometer-card" style="display: none; min-width: 220px; padding: 12px 18px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.5px;">YARIŞ TELEMETRİSİ</span>
          <span id="race-lap-badge" style="font-size: 11px; font-weight: 800; background: #2563eb; color: white; padding: 2px 8px; border-radius: 6px;">TUR 1/3</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-family: monospace;">
          <span style="font-size: 11px; color: #94a3b8;">SÜRE</span>
          <span id="race-lap-time" style="font-size: 18px; font-weight: 800; color: #f8fafc;">00:00.0</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-family: monospace; margin-top: 2px;">
          <span style="font-size: 11px; color: #94a3b8;">EN İYİ</span>
          <span id="race-best-time" style="font-size: 13px; font-weight: 700; color: #34d399;">--:--.--</span>
        </div>
        <div id="race-checkpoint-status" style="font-size: 11px; color: #38bdf8; font-weight: 600; margin-top: 5px; text-align: right;">
          1. Sektöre İlerle
        </div>
      </div>

      <!-- Dedicated Drift Telemetry Card for Drift Mode (Phase 9) -->
      <div id="drift-telemetry-card" class="speedometer-card" style="display: none; min-width: 250px; padding: 14px 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; box-shadow: 0 0 8px #f59e0b;"></span>
            <span style="font-size: 11px; text-transform: uppercase; color: #fbbf24; font-weight: 800; letter-spacing: 0.6px;">DRIFT TELEMETRİSİ</span>
          </div>
          <span id="drift-combo-text" style="font-size: 12px; font-weight: 800; background: linear-gradient(135deg, #d97706, #b45309); color: white; padding: 2px 10px; border-radius: 999px; box-shadow: 0 0 10px rgba(245, 158, 11, 0.4);">1.0x</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-family: monospace;">
          <span style="font-size: 11px; color: #94a3b8;">SKOR</span>
          <span id="drift-score-badge" style="font-size: 20px; font-weight: 800; color: #fde047; letter-spacing: 0.5px;">0 PUAN</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-family: monospace; margin-top: 4px;">
          <span id="drift-angle-text" style="font-size: 11px; font-weight: 700; color: #38bdf8;">0° AÇI</span>
          <span id="drift-total-score" style="font-size: 11px; font-weight: 600; color: #94a3b8;">En İyi: 0</span>
        </div>
        <div id="drift-status-text" style="font-size: 11px; color: #f59e0b; font-weight: 700; margin-top: 6px; text-align: right; text-shadow: 0 0 8px rgba(245, 158, 11, 0.3);">
          Hızlan ve Viraja Gir (Boşluk: El Freni)
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
          <span>Modlar: ESC</span>
          <span>•</span>
          <span>Konum: C</span>
          <span>•</span>
          <span>Sıfırla: R</span>
        </div>
      </div>
    </footer>
  </div>

  <!-- Game Mode Selection Modal (Phase 8) -->
  <div id="mode-modal" class="modal-backdrop">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title-group">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
            Oyun Modu & Harita Seçimi
          </h2>
          <p>İstediğin haritayı ve sürüş disiplinini seçip hemen başla (ESC ile aç/kapat)</p>
        </div>
        <button id="modal-close" class="modal-close-btn" type="button" title="Kapat (ESC)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div id="mode-grid-container" class="mode-grid">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>

  <!-- Race Starting Countdown Overlay (Phase 11) -->
  <div id="race-countdown-overlay" class="race-countdown-overlay" style="display: none;">
    <span id="race-countdown-text" class="race-countdown-text">3</span>
  </div>

  <!-- Race Wrong Way Warning (Phase 11) -->
  <div id="race-wrong-way" class="race-wrong-way" style="display: none;">
    ⚠️ TERS YÖN! GERİ DÖN ⚠️
  </div>

  <!-- Race Results Modal (Phase 11) -->
  <div id="race-results-modal" class="modal-backdrop">
    <div class="modal-card race-results-card">
      <div class="results-header">
        <span class="results-trophy" id="race-results-trophy">🏆</span>
        <h2 id="race-results-title">YARIŞ TAMAMLANDI!</h2>
        <p id="race-results-subtitle">Grand Prix 3 Tur Mücadelesi</p>
      </div>
      <div class="results-grid">
        <div class="result-stat-box">
          <span class="stat-label">TOPLAM SÜRE</span>
          <span class="stat-value" id="race-total-time">00:00.0</span>
        </div>
        <div class="result-stat-box highlight">
          <span class="stat-label">EN İYİ TUR</span>
          <span class="stat-value" id="race-best-lap">00:00.0</span>
        </div>
      </div>
      <div class="lap-times-list" id="race-lap-times-list">
        <!-- Injected dynamically -->
      </div>
      <div class="results-actions">
        <button id="btn-race-restart" class="action-btn primary" type="button">Tekrar Yarış (R)</button>
        <button id="btn-race-menu" class="action-btn secondary" type="button">Mod Değiştir (ESC)</button>
      </div>
    </div>
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
const btnSpawn = document.querySelector<HTMLButtonElement>('#btn-spawn')!
const btnMenu = document.querySelector<HTMLButtonElement>('#btn-menu')!
const spawnBtnText = document.querySelector<HTMLSpanElement>('#spawn-btn-text')!
const hudAssetStatus = document.querySelector<HTMLSpanElement>('#hud-asset-status')!
const hudFpsBadge = document.querySelector<HTMLDivElement>('#hud-fps-badge')!
const raceTelemetryCard = document.querySelector<HTMLDivElement>('#race-telemetry-card')!
const raceLapBadge = document.querySelector<HTMLSpanElement>('#race-lap-badge')!
const raceLapTime = document.querySelector<HTMLSpanElement>('#race-lap-time')!
const raceBestTime = document.querySelector<HTMLSpanElement>('#race-best-time')!
const raceCheckpointStatus = document.querySelector<HTMLDivElement>('#race-checkpoint-status')!
const driftTelemetryCard = document.querySelector<HTMLDivElement>('#drift-telemetry-card')!
const driftScoreBadge = document.querySelector<HTMLSpanElement>('#drift-score-badge')!
const driftComboText = document.querySelector<HTMLSpanElement>('#drift-combo-text')!
const driftAngleText = document.querySelector<HTMLSpanElement>('#drift-angle-text')!
const driftTotalScore = document.querySelector<HTMLSpanElement>('#drift-total-score')!
const driftStatusText = document.querySelector<HTMLDivElement>('#drift-status-text')!
const modeModal = document.querySelector<HTMLDivElement>('#mode-modal')!
const modalClose = document.querySelector<HTMLButtonElement>('#modal-close')!
const modeGridContainer = document.querySelector<HTMLDivElement>('#mode-grid-container')!

// Race Flow HUD Elements (Phase 11)
const raceCountdownOverlay = document.querySelector<HTMLDivElement>('#race-countdown-overlay')!
const raceCountdownText = document.querySelector<HTMLSpanElement>('#race-countdown-text')!
const raceWrongWay = document.querySelector<HTMLDivElement>('#race-wrong-way')!
const raceResultsModal = document.querySelector<HTMLDivElement>('#race-results-modal')!
const raceResultsTrophy = document.querySelector<HTMLSpanElement>('#race-results-trophy')!
const raceResultsTitle = document.querySelector<HTMLHeadingElement>('#race-results-title')!
const raceResultsSubtitle = document.querySelector<HTMLParagraphElement>('#race-results-subtitle')!
const raceTotalTime = document.querySelector<HTMLSpanElement>('#race-total-time')!
const raceBestLap = document.querySelector<HTMLSpanElement>('#race-best-lap')!
const raceLapTimesList = document.querySelector<HTMLDivElement>('#race-lap-times-list')!
const btnRaceRestart = document.querySelector<HTMLButtonElement>('#btn-race-restart')!
const btnRaceMenu = document.querySelector<HTMLButtonElement>('#btn-race-menu')!

// --- 2. THREE.JS SCENE SETUP ---
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x93c5fd)
scene.fog = new THREE.Fog(0x93c5fd, 60, 260)

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
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

// --- 6. INITIALIZE RAPIER 3D, CITY MAP & RACING TRACK ---
async function bootstrap() {
  const physicsWorld = new PhysicsWorld()
  await physicsWorld.init()

  // 1. Build City World (Centered at Z = 0)
  const city = new CityWorld(scene, physicsWorld, () => {
    console.log('✓ City environment ready')
  })

  // 2. Build Closed Racing Circuit (Centered at Z = 600)
  const raceTrack = new RaceTrack(scene, physicsWorld)

  // 3. Build Dedicated Drift Arena & Slalom Playground (Centered at Z = -600, Phase 10)
  const driftTrack = new DriftTrack(scene, physicsWorld)

  // 4. Build Physics Vehicle
  const vehicle = new Vehicle(scene, physicsWorld, undefined, () => {
    hudAssetStatus.textContent = 'Harita Hazır • 60 FPS'
    hudAssetStatus.style.color = '#34d399'
  })

  // 5. Build Particle & Visual Effect Systems (Phase 9)
  const tireSmoke = new TireSmokeSystem(scene)

  // Helper to format seconds as mm:ss.d
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 10)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`
  }

  // 6. Initialize HUD Controller for Modes
  const modeHud: ModeHUDController = {
    setSubtitle(text: string, color = '#94a3b8') {
      hudAssetStatus.textContent = text
      hudAssetStatus.style.color = color
    },
    setTelemetryVisible(visible: boolean) {
      raceTelemetryCard.style.display = visible ? 'block' : 'none'
    },
    setSpawnButtonVisible(visible: boolean) {
      btnSpawn.style.display = visible ? 'flex' : 'none'
    },
    setSpawnText(text: string) {
      spawnBtnText.textContent = text
    },
    setDriftCardVisible(visible: boolean) {
      driftTelemetryCard.style.display = visible ? 'block' : 'none'
    },
    updateRaceTelemetry(lapText: string, timeText: string, bestText: string, checkpointText: string) {
      raceLapBadge.textContent = lapText
      raceLapTime.textContent = timeText
      raceBestTime.textContent = bestText
      raceCheckpointStatus.textContent = checkpointText
    },
    setRaceCountdown(text: string | null, color?: string | null) {
      if (text) {
        raceCountdownOverlay.style.display = 'flex'
        raceCountdownText.textContent = text
        if (color) raceCountdownText.style.color = color
      } else {
        raceCountdownOverlay.style.display = 'none'
      }
    },
    setWrongWayVisible(visible: boolean) {
      raceWrongWay.style.display = visible ? 'block' : 'none'
    },
    showRaceResults(result: RaceResult) {
      raceResultsTrophy.textContent = result.ratingIcon
      raceResultsTitle.textContent = `${result.rating}!`
      raceResultsSubtitle.textContent = `Grand Prix 3 Tur • Toplam: ${formatTime(result.totalTime)}`
      raceTotalTime.textContent = formatTime(result.totalTime)
      raceBestLap.textContent = formatTime(result.bestLapTime)

      raceLapTimesList.innerHTML = result.lapTimes
        .map(
          (t, i) => `
          <div class="lap-time-row ${t === result.bestLapTime ? 'fastest-lap' : ''}">
            <span class="lap-name">TUR ${i + 1} ${t === result.bestLapTime ? '★ EN HIZLI' : ''}</span>
            <span class="lap-val">${formatTime(t)}</span>
          </div>
        `
        )
        .join('')

      raceResultsModal.classList.add('open')
    },
    hideRaceResults() {
      raceResultsModal.classList.remove('open')
    },
    updateDriftTelemetry(
      scoreText: string,
      comboText: string,
      statusText: string,
      angleText?: string,
      totalText?: string,
      isDrifting?: boolean
    ) {
      driftScoreBadge.textContent = scoreText
      driftComboText.textContent = comboText
      driftStatusText.textContent = statusText
      if (angleText) driftAngleText.textContent = angleText
      if (totalText) driftTotalScore.textContent = totalText

      if (isDrifting) {
        driftTelemetryCard.classList.add('drifting-active')
      } else {
        driftTelemetryCard.classList.remove('drifting-active')
      }
    },
  }

  // 7. Initialize Mode Manager (Default: City Free Roam)
  const modeManager = new ModeManager({
    scene,
    physicsWorld,
    vehicle,
    cityWorld: city,
    raceTrack,
    driftTrack,
    hud: modeHud,
    tireSmoke,
  })

  // 6. Mode Selection Modal Management
  let isModalOpen = false
  const renderModeCards = () => {
    const active = modeManager.getActiveMode()
    modeGridContainer.innerHTML = modeManager
      .getAllModes()
      .map(
        (m) => `
        <div class="mode-card-item ${m.modeType === active.modeType ? 'active' : ''}" data-mode="${m.modeType}">
          <div class="mode-icon-badge">
            <span class="mode-icon">${m.icon}</span>
            <span class="mode-badge" style="background: ${m.badgeColor}">${m.mapType}</span>
          </div>
          <div class="mode-info">
            <h3>${m.title}</h3>
            <div class="mode-subtitle">${m.subtitle}</div>
            <div class="mode-desc">${m.description}</div>
          </div>
          <div class="mode-action-btn">
            ${m.modeType === active.modeType ? 'Aktif Mod' : 'Bu Modu Seç'}
          </div>
        </div>
      `
      )
      .join('')

    modeGridContainer.querySelectorAll<HTMLDivElement>('.mode-card-item').forEach((card) => {
      card.addEventListener('click', () => {
        const modeType = card.dataset.mode as GameModeType
        if (modeType) {
          modeManager.setMode(modeType)
          renderModeCards()
          closeModal()
        }
      })
    })
  }

  const openModal = () => {
    isModalOpen = true
    modeModal.classList.add('open')
    renderModeCards()
  }

  const closeModal = () => {
    isModalOpen = false
    modeModal.classList.remove('open')
  }

  const toggleModal = () => {
    if (isModalOpen) closeModal()
    else openModal()
  }

  btnMenu.addEventListener('click', toggleModal)
  modalClose.addEventListener('click', closeModal)
  modeModal.addEventListener('click', (e) => {
    if (e.target === modeModal) closeModal()
  })

  // Race Results Action Listeners (Phase 11)
  btnRaceRestart.addEventListener('click', () => {
    raceResultsModal.classList.remove('open')
    modeManager.reset()
  })

  btnRaceMenu.addEventListener('click', () => {
    raceResultsModal.classList.remove('open')
    openModal()
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
      case 'Escape':
      case 'KeyM':
        toggleModal()
        break
      case 'KeyR':
        modeManager.reset()
        break
      case 'KeyC':
        modeManager.cycleSpawn()
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
    modeManager.reset()
  })

  btnSpawn.addEventListener('click', () => {
    modeManager.cycleSpawn()
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

    // 9.3 Active Game Mode Update
    modeManager.update(delta)

    // 9.4 Tire Smoke Simulation Update (Phase 9)
    tireSmoke.update(delta)

    // 9.5 Directional Sunlight Cascade (follows vehicle for sharp local shadows)
    sunLight.position.set(
      vehicle.root.position.x + 40,
      60,
      vehicle.root.position.z + 30
    )
    sunLight.target.position.copy(vehicle.root.position)
    sunLight.target.updateMatrixWorld()

    // 9.5 Smooth Third-Person Chase Camera
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

    // 9.6 HUD Speedometer & Gear Update
    const speedKmh = vehicle.getSpeedKmh()
    hudSpeed.textContent = speedKmh.toString()

    const speedPercent = Math.min(speedKmh / (vehicle.config.maxForwardSpeed * 3.6), 1.0) * 100
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

    // 9.7 FPS Monitor Update
    frameCount++
    if (now - lastFpsUpdateTime >= 500) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdateTime))
      hudFpsBadge.textContent = `${fps} FPS`
      if (fps >= 55) {
        hudFpsBadge.style.color = '#34d399'
      } else if (fps >= 35) {
        hudFpsBadge.style.color = '#facc15'
      } else {
        hudFpsBadge.style.color = '#ef4444'
      }
      frameCount = 0
      lastFpsUpdateTime = now
    }

    // 9.8 Render Scene
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
