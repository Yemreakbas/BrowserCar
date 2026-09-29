import type * as THREE from 'three'
import { ExhaustFlameVFX } from '../effects/ExhaustFlameVFX.ts'

export interface NitroUpdateResult {
  isBoosting: boolean
  impulse: number
  topSpeedMultiplier: number
}

/**
 * NitroSystem manages fuel capacity, burn consumption, progressive drift-recharge,
 * powertrain thrust calculations, and visual flame jet effects (Phase 31).
 */
export class NitroSystem {
  public readonly maxNitro: number = 100
  public currentNitro: number = 100

  // Consumption & Recharge Dynamics
  public readonly burnRate: number = 28.0 // Consumes 100% in ~3.57 seconds
  public readonly passiveRechargeRate: number = 7.5 // Fully recovers passively in ~13 seconds
  public readonly driftBonusRechargeRate: number = 25.0 // Drift-boost recharge: recovers in ~4 seconds!
  public readonly minActivationLevel: number = 6.0 // Minimum % required to reignite

  // Powertrain Boost Force
  public readonly boostAcceleration: number = 32.0 // m/s^2 additional thrust impulse
  public readonly topSpeedBoostMultiplier: number = 1.26 // 26% higher top speed ceiling during boost

  public isActive: boolean = false
  public flameVFX: ExhaustFlameVFX

  constructor(vehicleBodyGroup: THREE.Object3D) {
    this.flameVFX = new ExhaustFlameVFX(vehicleBodyGroup)
  }

  /**
   * Main simulation tick called every frame inside Vehicle.update()
   */
  public update(
    delta: number,
    isInputActive: boolean,
    isForwardThrottle: boolean,
    isDrifting: boolean,
    forwardSpeed: number
  ): NitroUpdateResult {
    // Activation conditions:
    // 1. Player is holding Nitro key (N or Shift)
    // 2. Player is holding forward throttle (W or ArrowUp)
    // 3. Has sufficient fuel
    // 4. Vehicle is not moving backwards
    const canIgnite = this.isActive
      ? this.currentNitro > 0.5
      : this.currentNitro >= this.minActivationLevel

    const wantsBoost = isInputActive && isForwardThrottle && forwardSpeed > -0.5

    if (wantsBoost && canIgnite) {
      this.isActive = true
      this.currentNitro = Math.max(0, this.currentNitro - this.burnRate * delta)
    } else {
      this.isActive = false

      // Recharge mechanics:
      // While actively drifting around corners, nitro recharges over 3x faster!
      const rechargeRate = isDrifting ? this.driftBonusRechargeRate : this.passiveRechargeRate
      this.currentNitro = Math.min(this.maxNitro, this.currentNitro + rechargeRate * delta)
    }

    // Update flame visual effects
    this.flameVFX.setActive(this.isActive)
    this.flameVFX.update(delta, this.isActive ? 1.0 : 0.0)

    if (this.isActive) {
      return {
        isBoosting: true,
        impulse: this.boostAcceleration * delta,
        topSpeedMultiplier: this.topSpeedBoostMultiplier,
      }
    }

    return {
      isBoosting: false,
      impulse: 0,
      topSpeedMultiplier: 1.0,
    }
  }

  public getPercent(): number {
    return (this.currentNitro / this.maxNitro) * 100
  }

  public getIsActive(): boolean {
    return this.isActive
  }

  public refill(): void {
    this.currentNitro = this.maxNitro
  }

  public dispose(): void {
    this.flameVFX.dispose()
  }
}
