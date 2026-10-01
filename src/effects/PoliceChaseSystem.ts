import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { AudioManager } from '../audio/AudioManager.ts'
import type { Vehicle } from '../vehicle/Vehicle.ts'
import {
  checkCityFeeler,
  getSmartPursuitTarget,
  resolveCityObstaclePenetration,
} from '../world/CityCollisionHelper.ts'

export type PursuitState = 'CLEAR' | 'CHASE' | 'EVADING' | 'BUSTED' | 'ESCAPED'

export interface PoliceUnit {
  id: string
  root: THREE.Group
  bodyGroup: THREE.Group
  mesh: THREE.Group | null
  strobeLeft: THREE.Mesh
  strobeRight: THREE.Mesh
  redMat: THREE.MeshStandardMaterial
  blueMat: THREE.MeshStandardMaterial
  currentSpeed: number
  maxSpeed: number
  acceleration: number
  steerRate: number
  active: boolean
  strobePhase: number
  targetSwerve: number
}

export class PoliceChaseSystem {
  private scene: THREE.Scene
  private audioManager?: AudioManager
  public group: THREE.Group

  // System State
  public heatLevel: number = 0 // 0 to 5
  public heatProgress: number = 0 // 0 to 100
  public pursuitState: PursuitState = 'CLEAR'

  // Police Cruisers Pool
  public units: PoliceUnit[] = []
  private readonly MAX_UNITS = 3
  private sharedPoliceModel: THREE.Group | null = null
  private isModelLoading = false

  // Arrest & Evasion Timers
  private bustTimer: number = 0
  private readonly BUST_DURATION = 3.2 // 3.2s near police while slow = BUSTED
  public bustPercent: number = 0

  private escapeTimer: number = 0
  private readonly ESCAPE_DURATION = 6.0 // 6.0s far from police = ESCAPED
  public escapePercent: number = 0

  // Strobe timer
  private strobeTimer: number = 0

  // Scratchpad Vectors (Zero-allocation for 60+ FPS)
  private tempToPlayer = new THREE.Vector3()
  private tempForward = new THREE.Vector3()
  private tempRight = new THREE.Vector3()
  private tempDiff = new THREE.Vector3()

  // Callbacks
  public onHeatChanged?: (heatLevel: number, heatProgress: number) => void
  public onPursuitStateChanged?: (state: PursuitState, text: string) => void
  public onBusted?: (fineAmount: number) => void
  public onEscaped?: (rewardAmount: number) => void

  constructor(scene: THREE.Scene, audioManager?: AudioManager) {
    this.scene = scene
    this.audioManager = audioManager

    this.group = new THREE.Group()
    this.group.name = 'PoliceChaseGroup'
    this.scene.add(this.group)

    this.initPolicePool()
    this.preloadPoliceModel()
  }

  /**
   * Pre-allocates police cruiser objects with rooftop emergency beacons (Zero PointLights for pure 60+ FPS)
   */
  private initPolicePool(): void {
    const strobeGeo = new THREE.BoxGeometry(0.24, 0.12, 0.22)

    for (let i = 0; i < this.MAX_UNITS; i++) {
      const root = new THREE.Group()
      root.name = `PoliceCruiser_${i}`
      root.visible = false
      this.group.add(root)

      const bodyGroup = new THREE.Group()
      root.add(bodyGroup)

      // Fallback placeholder chassis
      const placeholderGeo = new THREE.BoxGeometry(1.85, 0.72, 4.0)
      const placeholderMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        metalness: 0.3,
        roughness: 0.4,
      })
      const placeholder = new THREE.Mesh(placeholderGeo, placeholderMat)
      placeholder.name = 'placeholder_chassis'
      placeholder.position.y = 0.55
      bodyGroup.add(placeholder)

      // Lightbar Red Strobe (Left roof) - Uses emissive glow for 0 performance impact
      const redMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xef4444,
        emissiveIntensity: 0.3,
        roughness: 0.3,
      })
      const strobeLeft = new THREE.Mesh(strobeGeo, redMat)
      strobeLeft.position.set(-0.35, 1.25, -0.15)
      bodyGroup.add(strobeLeft)

      // Lightbar Blue Strobe (Right roof) - Uses emissive glow for 0 performance impact
      const blueMat = new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        emissive: 0x3b82f6,
        emissiveIntensity: 0.3,
        roughness: 0.3,
      })
      const strobeRight = new THREE.Mesh(strobeGeo, blueMat)
      strobeRight.position.set(0.35, 1.25, -0.15)
      bodyGroup.add(strobeRight)

      this.units.push({
        id: `cruiser_${i}`,
        root,
        bodyGroup,
        mesh: null,
        strobeLeft,
        strobeRight,
        redMat,
        blueMat,
        currentSpeed: 0,
        maxSpeed: 28.0,
        acceleration: 22.0,
        steerRate: 7.5,
        active: false,
        strobePhase: i * 0.25,
        targetSwerve: 0,
      })
    }
  }

  /**
   * Preloads the official police interceptor GLTF asset
   */
  private preloadPoliceModel(): void {
    if (this.isModelLoading || this.sharedPoliceModel) return
    this.isModelLoading = true

    const loader = new GLTFLoader()
    loader.load(
      './assets/cars/police.glb',
      (gltf) => {
        this.sharedPoliceModel = gltf.scene
        this.sharedPoliceModel.scale.set(1.12, 1.12, 1.12)
        this.sharedPoliceModel.position.set(0, 0, 0)

        // Attach cloned models to existing pool
        for (const unit of this.units) {
          if (!unit.mesh) {
            // Remove placeholder box
            const placeholder = unit.bodyGroup.getObjectByName('placeholder_chassis')
            if (placeholder) {
              unit.bodyGroup.remove(placeholder)
            }

            const clone = this.sharedPoliceModel.clone(true)
            unit.mesh = clone
            unit.bodyGroup.add(clone)
          }
        }
        this.isModelLoading = false
      },
      undefined,
      (err) => {
        console.warn('[PoliceChaseSystem] police.glb load note:', err)
        this.isModelLoading = false
      }
    )
  }

  /**
   * Triggers Heat Level increase from player actions (speeding, crash, drift, or button)
   */
  public addHeatScore(amount: number): void {
    if (this.pursuitState === 'BUSTED' || this.pursuitState === 'ESCAPED') return

    this.heatProgress += amount
    if (this.heatProgress >= 100) {
      this.heatProgress = 0
      this.setHeatLevel(Math.min(5, this.heatLevel + 1))
    } else if (this.heatLevel === 0 && this.heatProgress >= 35) {
      this.heatProgress = 0
      this.setHeatLevel(1)
    }

    if (this.onHeatChanged) {
      this.onHeatChanged(this.heatLevel, this.heatProgress)
    }
  }

  /**
   * Sets heat level directly (0 to 5) and activates required police units
   */
  public setHeatLevel(level: number): void {
    this.heatLevel = Math.max(0, Math.min(5, level))

    if (this.heatLevel === 0) {
      this.clearPursuit()
      return
    }

    this.pursuitState = 'CHASE'
    this.escapeTimer = 0
    this.bustTimer = 0
    this.bustPercent = 0
    this.escapePercent = 0

    // Activate police units based on heat
    // Heat 1: 1 unit, Heat 2: 2 units, Heat 3-5: 3 units
    const targetUnitsCount = this.heatLevel === 1 ? 1 : this.heatLevel === 2 ? 2 : 3

    for (let i = 0; i < this.MAX_UNITS; i++) {
      const unit = this.units[i]
      if (i < targetUnitsCount) {
        if (!unit.active) {
          this.spawnPoliceUnit(unit, i)
        }
        // Scale pursuit capability with heat level
        unit.maxSpeed = 24.0 + this.heatLevel * 3.5 // up to 41.5 m/s (~150 km/h)
        unit.acceleration = 20.0 + this.heatLevel * 3.0
      } else {
        unit.active = false
        unit.root.visible = false
      }
    }

    if (this.audioManager) {
      this.audioManager.startPoliceSiren()
    }

    if (this.onHeatChanged) {
      this.onHeatChanged(this.heatLevel, this.heatProgress)
    }
    if (this.onPursuitStateChanged) {
      this.onPursuitStateChanged('CHASE', `🚨 SEVİYE ${this.heatLevel} POLİS TAKİBİ!`)
    }
  }

  /**
   * Spawns a police cruiser near the player along streets
   */
  private spawnPoliceUnit(unit: PoliceUnit, index: number): void {
    unit.active = true
    unit.root.visible = true
    unit.currentSpeed = 15.0

    // Spawn 45 to 65 meters away in staggered directions
    const angle = (index * Math.PI * 0.75) + Math.random() * 0.4
    const dist = 48.0 + index * 12.0
    const offsetX = Math.cos(angle) * dist
    const offsetZ = Math.sin(angle) * dist

    // Place near ground
    unit.root.position.set(offsetX, 0.05, offsetZ)
    unit.root.rotation.set(0, Math.atan2(-offsetX, -offsetZ), 0)
  }

  /**
   * Toggles chase on or off via keyboard hotkey [J] or UI button
   */
  public toggleChase(): void {
    if (this.heatLevel === 0) {
      this.setHeatLevel(1)
    } else {
      this.clearPursuit()
    }
  }

  /**
   * Resets pursuit state and despawns cruisers
   */
  public clearPursuit(): void {
    this.heatLevel = 0
    this.heatProgress = 0
    this.pursuitState = 'CLEAR'
    this.bustTimer = 0
    this.escapeTimer = 0
    this.bustPercent = 0
    this.escapePercent = 0

    for (const unit of this.units) {
      unit.active = false
      unit.root.visible = false
      unit.currentSpeed = 0
      unit.redMat.emissiveIntensity = 0.2
      unit.blueMat.emissiveIntensity = 0.2
    }

    if (this.audioManager) {
      this.audioManager.stopPoliceSiren()
    }

    if (this.onHeatChanged) {
      this.onHeatChanged(0, 0)
    }
    if (this.onPursuitStateChanged) {
      this.onPursuitStateChanged('CLEAR', 'Polis Takibi Sona Erdi')
    }
  }

  /**
   * Main simulation step (Zero-allocation, zero uncaught errors, 60+ FPS)
   */
  public update(delta: number, playerVehicle: Vehicle): void {
    // If not in active chase or evading, do not run pursuit physics
    if (this.heatLevel === 0 || this.pursuitState === 'CLEAR' || this.pursuitState === 'BUSTED' || this.pursuitState === 'ESCAPED') {
      return
    }

    const playerPos = playerVehicle.root.position
    const playerSpeedKmh = playerVehicle.getSpeedKmh()
    const playerSpeedMs = Math.abs(playerVehicle.currentSpeed)

    // 1. Lightbar Strobe Animation (Alternating Red/Blue at 8 Hz)
    this.strobeTimer += delta
    const flashIndex = Math.floor(this.strobeTimer * 8) % 2 // 0 or 1

    let minDistanceToPlayer = Infinity

    // 2. Update Each Active Police Cruiser
    for (let i = 0; i < this.units.length; i++) {
      const unit = this.units[i]
      if (!unit.active) continue

      // Strobe lighting via emissive materials (Zero GPU light pass overhead)
      const isRedPhase = (flashIndex + i) % 2 === 0
      if (isRedPhase) {
        unit.redMat.emissiveIntensity = 4.5
        unit.blueMat.emissiveIntensity = 0.2
      } else {
        unit.redMat.emissiveIntensity = 0.2
        unit.blueMat.emissiveIntensity = 4.5
      }

      // Distance to player
      this.tempDiff.subVectors(playerPos, unit.root.position)
      this.tempDiff.y = 0
      const distToPlayer = this.tempDiff.length()
      if (distToPlayer < minDistanceToPlayer) {
        minDistanceToPlayer = distToPlayer
      }

      // 3. Pursuit AI Steering & Velocity with Smart Navigation and Building Obstacle Avoidance
      // If direct line-of-sight to player is blocked by a building, route towards the nearest corner/intersection!
      const smartTarget = getSmartPursuitTarget(unit.root.position, playerPos)

      this.tempToPlayer.subVectors(smartTarget, unit.root.position)
      this.tempToPlayer.y = 0
      this.tempToPlayer.normalize()

      // Current cruiser heading
      this.tempForward.set(0, 0, 1).applyQuaternion(unit.root.quaternion)
      this.tempRight.set(-1, 0, 0).applyQuaternion(unit.root.quaternion)

      const fwdDot = this.tempForward.dot(this.tempToPlayer)
      const rightDot = this.tempRight.dot(this.tempToPlayer)

      // Steering angle with PIT flank offset
      const angleDiff = Math.atan2(rightDot, fwdDot)
      const flankOffset = (i === 1 ? 0.14 : i === 2 ? -0.14 : 0)
      let steerInput = THREE.MathUtils.clamp(angleDiff * 1.6 + flankOffset, -0.75, 0.75)

      // Active Feeler Whiskers for Building / Obstacle Avoidance
      const feelerCenter = checkCityFeeler(unit.root.position, this.tempForward, 9.5)
      if (feelerCenter.hit) {
        // Feeler detected wall ahead! Steer away into open road
        const leftVec = this.tempForward.clone().addScaledVector(this.tempRight, 0.6).normalize()
        const rightVec = this.tempForward.clone().addScaledVector(this.tempRight, -0.6).normalize()
        const feelerLeft = checkCityFeeler(unit.root.position, leftVec, 8.0)
        const feelerRight = checkCityFeeler(unit.root.position, rightVec, 8.0)

        if (feelerLeft.dist > feelerRight.dist) {
          steerInput = Math.min(steerInput + 0.65, 0.85)
        } else {
          steerInput = Math.max(steerInput - 0.65, -0.85)
        }
      }

      // Smooth turning
      unit.root.rotation.y += steerInput * unit.steerRate * delta

      // Acceleration & Braking (slow down for tight corners or obstacles)
      let targetSpeed = unit.maxSpeed
      if (feelerCenter.hit && feelerCenter.dist < 5.0) {
        targetSpeed = 8.0 // Brake to corner safely without hitting facade
      } else if (distToPlayer < 7.0 && fwdDot > 0.8) {
        // Match player speed to execute ramming / boxing
        targetSpeed = Math.max(playerSpeedMs + 3.0, 10.0)
      } else if (fwdDot < 0.2) {
        // Sharp turn ahead, slow down slightly
        targetSpeed = 14.0
      }

      if (unit.currentSpeed < targetSpeed) {
        unit.currentSpeed = Math.min(targetSpeed, unit.currentSpeed + unit.acceleration * delta)
      } else {
        unit.currentSpeed = Math.max(targetSpeed, unit.currentSpeed - unit.acceleration * 1.5 * delta)
      }

      // Move forward
      this.tempForward.set(0, 0, 1).applyQuaternion(unit.root.quaternion)
      unit.root.position.addScaledVector(this.tempForward, unit.currentSpeed * delta)

      // Hard AABB Obstacle Collision Clamping (Guarantees cruiser never phases through buildings!)
      const wasBlocked = resolveCityObstaclePenetration(unit.root.position, 1.35)
      if (wasBlocked) {
        unit.currentSpeed = Math.min(unit.currentSpeed, 4.0)
      }

      // Physical Ramming Impulse with Player
      if (distToPlayer < 3.2 && distToPlayer > 0.1) {
        const impactSpeedKmh = Math.abs(unit.currentSpeed - playerVehicle.currentSpeed) * 3.6
        if (impactSpeedKmh > 18) {
          playerVehicle.applyImpactDamage(impactSpeedKmh * 0.45)
          if (this.audioManager) {
            this.audioManager.playCollision(0.7)
          }
          unit.currentSpeed *= 0.7
        }
      }
    }

    // 4. Update Procedural Siren Audio with Distance Attenuation
    if (this.audioManager) {
      this.audioManager.setPoliceSirenIntensity(minDistanceToPlayer)
    }

    // 5. BUSTED DETECTION
    // If trapped: distance < 7.5m AND player speed < 12 km/h
    if (minDistanceToPlayer < 7.5 && playerSpeedKmh < 12) {
      this.bustTimer += delta
      this.escapeTimer = 0
      this.bustPercent = Math.min(100, Math.round((this.bustTimer / this.BUST_DURATION) * 100))

      if (this.pursuitState !== 'CHASE') {
        this.pursuitState = 'CHASE'
      }
      if (this.onPursuitStateChanged) {
        this.onPursuitStateChanged('CHASE', `🚨 KISKACA ALINDIN! (%${this.bustPercent})`)
      }

      if (this.bustTimer >= this.BUST_DURATION && (this.pursuitState as string) !== 'BUSTED') {
        this.handleBusted(playerVehicle)
      }
    } else {
      this.bustTimer = Math.max(0, this.bustTimer - delta * 1.5)
      this.bustPercent = Math.min(100, Math.round((this.bustTimer / this.BUST_DURATION) * 100))

      // 6. ESCAPE / EVASION DETECTION
      // If player has gained distance > 60m from all police
      if (minDistanceToPlayer > 60.0) {
        this.escapeTimer += delta
        this.escapePercent = Math.min(100, Math.round((this.escapeTimer / this.ESCAPE_DURATION) * 100))

        if (this.pursuitState !== 'EVADING') {
          this.pursuitState = 'EVADING'
          if (this.onPursuitStateChanged) {
            this.onPursuitStateChanged('EVADING', `🏃 İZİNİ KAYBETTİRİYORSUN! (%${this.escapePercent})`)
          }
        }

        if (this.escapeTimer >= this.ESCAPE_DURATION && (this.pursuitState as string) !== 'ESCAPED') {
          this.handleEscaped()
        }
      } else {
        this.escapeTimer = Math.max(0, this.escapeTimer - delta * 1.2)
        this.escapePercent = Math.min(100, Math.round((this.escapeTimer / this.ESCAPE_DURATION) * 100))

        if (this.pursuitState === 'EVADING') {
          this.pursuitState = 'CHASE'
          if (this.onPursuitStateChanged) {
            this.onPursuitStateChanged('CHASE', `🚨 TEKRAR GÖRÜLDÜN!`)
          }
        }
      }
    }
  }

  /**
   * Player was trapped and arrested by the police
   */
  private handleBusted(_playerVehicle: Vehicle): void {
    if (this.pursuitState === 'BUSTED') return
    this.pursuitState = 'BUSTED'
    this.bustTimer = 0
    this.escapeTimer = 0
    this.bustPercent = 100
    const fineAmount = 250 * Math.max(1, this.heatLevel)

    if (this.audioManager) {
      this.audioManager.stopPoliceSiren()
      this.audioManager.playCollision(1.0)
    }

    if (this.onPursuitStateChanged) {
      this.onPursuitStateChanged('BUSTED', `🚨 YAKALANDIN! -${fineAmount} CR CEZA`)
    }
    if (this.onBusted) {
      this.onBusted(fineAmount)
    }

    // Auto-clear chase after 3.5s
    setTimeout(() => {
      this.clearPursuit()
    }, 3500)
  }

  /**
   * Player successfully escaped from police pursuit
   */
  private handleEscaped(): void {
    if (this.pursuitState === 'ESCAPED') return
    this.pursuitState = 'ESCAPED'
    this.escapeTimer = 0
    this.bustTimer = 0
    this.escapePercent = 100
    const rewardCash = 350 * Math.max(1, this.heatLevel)

    if (this.audioManager) {
      this.audioManager.stopPoliceSiren()
    }

    if (this.onPursuitStateChanged) {
      this.onPursuitStateChanged('ESCAPED', `✨ KURTULDUN! +${rewardCash} CR ÖDÜL`)
    }
    if (this.onEscaped) {
      this.onEscaped(rewardCash)
    }

    setTimeout(() => {
      this.clearPursuit()
    }, 3000)
  }

  public dispose(): void {
    this.clearPursuit()
    if (this.group.parent) {
      this.group.parent.remove(this.group)
    }
    for (const unit of this.units) {
      unit.redMat.dispose()
      unit.blueMat.dispose()
    }
    this.units = []
  }
}
