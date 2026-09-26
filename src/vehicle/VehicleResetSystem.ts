import * as THREE from 'three'
import type { Vehicle, VehicleInput } from './Vehicle.ts'
import type { ModeManager } from '../modes/ModeManager.ts'
import type { NetworkManager } from '../networking/NetworkManager.ts'
import type { TireSmokeSystem } from '../effects/TireSmoke.ts'

export type ResetReason = 'manual' | 'fall' | 'flipped' | 'stuck'

export interface ResetEvent {
  reason: ResetReason
  position: THREE.Vector3
  rotationY: number
  timestamp: number
  locationName: string
}

export interface VehicleResetSystemOptions {
  vehicle: Vehicle
  modeManager: ModeManager
  networkManager?: NetworkManager
  tireSmoke?: TireSmokeSystem
  onNotice?: (message: string, type: 'info' | 'warning' | 'alert', durationMs?: number) => void
  onHint?: (hint: string | null) => void
}

/**
 * VehicleResetSystem manages vehicle out-of-bounds fall detection, rollover/flip detection,
 * stuck geometry detection, and mode-aware respawn coordination (Phase 19).
 */
export class VehicleResetSystem {
  private vehicle: Vehicle
  private modeManager: ModeManager
  private networkManager?: NetworkManager
  private tireSmoke?: TireSmokeSystem
  private onNotice?: (message: string, type: 'info' | 'warning' | 'alert', durationMs?: number) => void
  private onHint?: (hint: string | null) => void

  // Detection thresholds
  public readonly FALL_Y_THRESHOLD = -4.5
  public readonly MAP_BOUNDS = 900 // Max absolute X or Z coordinate

  public readonly FLIP_UP_THRESHOLD = 0.25 // cos(~75 deg)
  public readonly FLIP_HINT_TIME = 1.2 // Seconds until "[R] ile Düzelt" hint
  public readonly FLIP_AUTO_RECOVER_TIME = 3.5 // Seconds until automatic upright recovery

  public readonly STUCK_SPEED_THRESHOLD = 1.0 // km/h
  public readonly STUCK_HINT_TIME = 2.5 // Seconds until "[R] ile Sıfırla" hint

  // State tracking
  private flipTimer = 0
  private isFlipped = false
  private flipHintActive = false

  private stuckTimer = 0
  private isStuck = false
  private stuckHintActive = false

  private lastResetTime = 0
  private readonly RESET_COOLDOWN_MS = 500 // Prevent accidental double resets

  private tempUp = new THREE.Vector3()

  constructor(options: VehicleResetSystemOptions) {
    this.vehicle = options.vehicle
    this.modeManager = options.modeManager
    this.networkManager = options.networkManager
    this.tireSmoke = options.tireSmoke
    this.onNotice = options.onNotice
    this.onHint = options.onHint
  }

  /**
   * Frame update checking for out-of-bounds falls, flips, and stuck vehicles.
   */
  public update(delta: number, inputs?: VehicleInput): void {
    if (!this.vehicle || !this.vehicle.rigidBody) return

    const pos = this.vehicle.root.position
    const quat = this.vehicle.root.quaternion
    const now = performance.now()

    // Temporary cooldown after respawn to let physics settle
    if (now - this.lastResetTime < this.RESET_COOLDOWN_MS) {
      this.flipTimer = 0
      this.stuckTimer = 0
      return
    }

    // 1. OUT-OF-BOUNDS & FALL DETECTION
    if (pos.y < this.FALL_Y_THRESHOLD || Math.abs(pos.x) > this.MAP_BOUNDS || Math.abs(pos.z) > this.MAP_BOUNDS) {
      this.respawn('fall')
      return
    }

    // 2. FLIPPED / ROLLOVER DETECTION
    // Compute vehicle's local UP axis in world coordinates
    this.tempUp.set(0, 1, 0).applyQuaternion(quat)
    if (this.tempUp.y < this.FLIP_UP_THRESHOLD) {
      this.flipTimer += delta
      this.isFlipped = true

      if (this.flipTimer >= this.FLIP_AUTO_RECOVER_TIME) {
        this.respawn('flipped')
        return
      } else if (this.flipTimer >= this.FLIP_HINT_TIME) {
        if (!this.flipHintActive) {
          this.flipHintActive = true
          this.onHint?.('⚠️ Araç Ters Döndü! [R] ile Düzelt')
        }
      }
    } else {
      if (this.isFlipped) {
        this.isFlipped = false
        this.flipTimer = 0
        if (this.flipHintActive) {
          this.flipHintActive = false
          this.onHint?.(null)
        }
      }
    }

    // 3. STUCK AGAINST OBSTACLE / GEOMETRY DETECTION
    if (inputs) {
      const isTryingToAccelerate = inputs.forward || inputs.backward
      const speedKmh = this.vehicle.getSpeedKmh()

      if (isTryingToAccelerate && speedKmh < this.STUCK_SPEED_THRESHOLD) {
        this.stuckTimer += delta
        this.isStuck = true

        if (this.stuckTimer >= this.STUCK_HINT_TIME) {
          if (!this.stuckHintActive && !this.flipHintActive) {
            this.stuckHintActive = true
            this.onHint?.('⚠️ Sıkıştın mı? [R] ile Aracı Sıfırla')
          }
        }
      } else {
        if (this.isStuck) {
          this.isStuck = false
          this.stuckTimer = 0
          if (this.stuckHintActive) {
            this.stuckHintActive = false
            if (!this.flipHintActive) {
              this.onHint?.(null)
            }
          }
        }
      }
    }
  }

  /**
   * Perform mode-aware respawn / reset.
   * Zeroes linear and angular velocity, resets steering angle, restores upright orientation,
   * cleanly resets drift combo and tire smoke, and synchronizes with server.
   */
  public respawn(reason: ResetReason = 'manual'): ResetEvent {
    this.lastResetTime = performance.now()
    this.flipTimer = 0
    this.isFlipped = false
    this.flipHintActive = false
    this.stuckTimer = 0
    this.isStuck = false
    this.stuckHintActive = false
    this.onHint?.(null)

    const activeMode = this.modeManager.getActiveMode()
    const context = this.modeManager['context']

    let targetPos = new THREE.Vector3(0, 0.45, -25)
    let targetRotY = 0
    let locationName = 'Başlangıç Noktası'

    // Determine mode-aware respawn location
    if (typeof (activeMode as any).getRespawnPoint === 'function') {
      const pt = (activeMode as any).getRespawnPoint(context)
      if (pt && pt.position) {
        targetPos.copy(pt.position)
        targetRotY = pt.rotationY || 0
        locationName = pt.name || locationName
      }
    } else if (context.cityWorld) {
      const nearest = context.cityWorld.getNearestSpawnLocation(this.vehicle.root.position)
      targetPos.copy(nearest.position)
      targetRotY = nearest.rotationY
      locationName = nearest.name
    }

    // Drift mode specific: cleanly reset drift combo
    if (typeof (activeMode as any).resetCombo === 'function') {
      (activeMode as any).resetCombo()
    }

    // Reset tire smoke particles
    if (this.tireSmoke) {
      this.tireSmoke.reset()
    }

    // Reset vehicle physics body & visual hierarchy
    this.vehicle.reset(targetPos.x, targetPos.z, targetRotY, targetPos.y || 0.45)

    // Synchronize authoritative respawn with multiplayer server
    const halfRot = targetRotY / 2
    const qY = Math.sin(halfRot)
    const qW = Math.cos(halfRot)
    const quatArr: [number, number, number, number] = [0, qY, 0, qW]
    const posArr: [number, number, number] = [targetPos.x, targetPos.y || 0.45, targetPos.z]

    if (this.networkManager) {
      this.networkManager.sendPlayerReset(posArr, quatArr, reason)
    }

    // HUD feedback notifications
    let noticeMsg = 'Araç Sıfırlandı'
    let noticeType: 'info' | 'warning' | 'alert' = 'info'

    if (reason === 'fall') {
      noticeMsg = `Pistten Düştün! • ${locationName}`
      noticeType = 'alert'
    } else if (reason === 'flipped') {
      noticeMsg = `Araç Düzeltildi • ${locationName}`
      noticeType = 'warning'
    } else if (reason === 'stuck') {
      noticeMsg = `Araç Kurtarıldı • ${locationName}`
      noticeType = 'warning'
    } else {
      noticeMsg = `Araç Konumlandırıldı • ${locationName}`
      noticeType = 'info'
    }

    this.onNotice?.(noticeMsg, noticeType, 2200)

    return {
      reason,
      position: targetPos,
      rotationY: targetRotY,
      timestamp: Date.now(),
      locationName,
    }
  }

  public getFlipTimer(): number {
    return this.flipTimer
  }

  public getStuckTimer(): number {
    return this.stuckTimer
  }

  public isVehicleRolledOver(): boolean {
    return this.isFlipped
  }

  public isVehicleTrapped(): boolean {
    return this.isStuck
  }
}
