import type { Vehicle } from '../vehicle/Vehicle.ts'

export interface DriftScoreState {
  currentPoints: number
  totalScore: number
  bestDriftScore: number
  comboMultiplier: number
  driftAngleDeg: number
  driftSpeedKmh: number
  driftDuration: number
  isDrifting: boolean
  isInComboWindow: boolean
  comboTimeRemaining: number
  ratingText: string
  lastBankedPoints: number
  isSpinOut: boolean
}

export class DriftSystem {
  private currentPoints: number = 0
  private totalScore: number = 0
  private bestDriftScore: number = 0
  private comboMultiplier: number = 1.0
  private comboTimer: number = 0
  private readonly comboGracePeriod: number = 1.4 // 1.4s window to transition corners

  private driftAngleDeg: number = 0
  private driftSpeedKmh: number = 0
  private driftDuration: number = 0
  private isDrifting: boolean = false
  private isInComboWindow: boolean = false
  private ratingText: string = 'Hızlan ve Boşluk (El Freni) ile Viraja Gir'
  private lastBankedPoints: number = 0
  private isSpinOut: boolean = false
  private spinOutCooldown: number = 0

  public update(delta: number, vehicle: Vehicle, zoneBonusMultiplier: number = 1.0): DriftScoreState {
    const forwardSpeedKmh = Math.abs(vehicle.currentSpeed) * 3.6
    const slipAngleDeg = vehicle.slipAngleDeg
    const isVehicleDrifting = vehicle.isDrifting

    this.driftAngleDeg = Math.round(slipAngleDeg)
    this.driftSpeedKmh = Math.round(forwardSpeedKmh)

    // Spin-out cooldown timer
    if (this.spinOutCooldown > 0) {
      this.spinOutCooldown -= delta
      if (this.spinOutCooldown <= 0) {
        this.isSpinOut = false
      }
    }

    // 1. Check for Spin-out (over-rotated beyond 80 degrees or stalled during slide)
    if (
      isVehicleDrifting &&
      (slipAngleDeg > vehicle.config.driftMaxAngleDeg || (forwardSpeedKmh < 5 && this.currentPoints > 50))
    ) {
      this.triggerSpinOut()
      return this.getState()
    }

    // 2. Active Drifting Frame
    if (isVehicleDrifting && forwardSpeedKmh >= 14) {
      this.isDrifting = true
      this.isInComboWindow = false
      this.comboTimer = this.comboGracePeriod
      this.driftDuration += delta

      // Update Combo Multiplier based on continuous duration & clean angles
      this.updateComboMultiplier(this.driftDuration)

      // Angle Factor: 20° - 55° gives highest rewards
      const angleFactor = Math.min(Math.max((slipAngleDeg - 8) / 26, 0.4), 2.5)

      // Speed Factor: faster drifts yield more points
      const speedFactor = Math.min(Math.max(forwardSpeedKmh / 32, 0.5), 2.2)

      // Base points per second (multiplied by zone bonus if inside drift zone)
      const baseRate = 160.0 * angleFactor * speedFactor * zoneBonusMultiplier
      const pointsDelta = baseRate * this.comboMultiplier * delta
      this.currentPoints += pointsDelta

      // Update Live Rating Feedback
      this.ratingText = this.computeRatingText(this.currentPoints, this.comboMultiplier, slipAngleDeg, zoneBonusMultiplier)
    } else {
      // 3. Not actively drifting
      this.isDrifting = false

      if (this.currentPoints > 0) {
        // In combo grace window
        this.isInComboWindow = true
        this.comboTimer -= delta

        if (this.comboTimer <= 0) {
          // Grace window expired -> Bank the drift points!
          this.bankPoints()
        } else {
          this.ratingText = `KOMBO KORUNUYOR (${this.comboTimer.toFixed(1)}s)`
        }
      } else if (!this.isSpinOut) {
        this.isInComboWindow = false
        this.ratingText = 'Hızlan ve Boşluk (El Freni) ile Viraja Gir'
        this.driftDuration = 0
      }
    }

    return this.getState()
  }

  private updateComboMultiplier(duration: number): void {
    if (duration >= 8.0) {
      this.comboMultiplier = 5.0
    } else if (duration >= 6.0) {
      this.comboMultiplier = 4.0
    } else if (duration >= 4.0) {
      this.comboMultiplier = 3.0
    } else if (duration >= 2.5) {
      this.comboMultiplier = 2.5
    } else if (duration >= 1.5) {
      this.comboMultiplier = 2.0
    } else if (duration >= 0.8) {
      this.comboMultiplier = 1.5
    } else {
      this.comboMultiplier = 1.0
    }
  }

  private computeRatingText(points: number, combo: number, angleDeg: number, zoneBonus: number = 1.0): string {
    const angleBadge = `${angleDeg.toFixed(0)}°`
    const bonusBadge = zoneBonus > 1.0 ? ` • ${zoneBonus.toFixed(1)}x BÖLGE` : ''

    if (combo >= 4.0 || points >= 3000) {
      return `👑 EFSANE DRIFT! (${angleBadge}${bonusBadge})`
    }
    if (combo >= 3.0 || points >= 1800) {
      return `🏎️💨 DURDURULAMAZ! (${angleBadge}${bonusBadge})`
    }
    if (combo >= 2.0 || points >= 900) {
      return `⚡ ALEV ALDI! (${angleBadge}${bonusBadge})`
    }
    if (points >= 350) {
      return `🔥 HARİKA SLAYT! (${angleBadge}${bonusBadge})`
    }
    return `MÜKEMMEL AÇI (${angleBadge}${bonusBadge})`
  }

  private triggerSpinOut(): void {
    this.isDrifting = false
    this.isInComboWindow = false
    this.isSpinOut = true
    this.spinOutCooldown = 2.0
    this.currentPoints = 0
    this.comboMultiplier = 1.0
    this.comboTimer = 0
    this.driftDuration = 0
    this.ratingText = '⚠️ SPIN-OUT! Kombo Sıfırlandı'
  }

  private bankPoints(): void {
    const banked = Math.round(this.currentPoints)
    this.totalScore += banked
    this.lastBankedPoints = banked

    if (banked > this.bestDriftScore) {
      this.bestDriftScore = banked
    }

    this.ratingText = `✓ +${banked.toLocaleString()} PUAN KAZANILDI!`
    this.currentPoints = 0
    this.comboMultiplier = 1.0
    this.isInComboWindow = false
    this.comboTimer = 0
    this.driftDuration = 0
  }

  public reset(): void {
    this.currentPoints = 0
    this.totalScore = 0
    this.comboMultiplier = 1.0
    this.comboTimer = 0
    this.driftAngleDeg = 0
    this.driftSpeedKmh = 0
    this.driftDuration = 0
    this.isDrifting = false
    this.isInComboWindow = false
    this.ratingText = 'Hızlan ve Boşluk (El Freni) ile Viraja Gir'
    this.lastBankedPoints = 0
    this.isSpinOut = false
    this.spinOutCooldown = 0
  }

  public getState(): DriftScoreState {
    return {
      currentPoints: Math.round(this.currentPoints),
      totalScore: this.totalScore,
      bestDriftScore: this.bestDriftScore,
      comboMultiplier: this.comboMultiplier,
      driftAngleDeg: this.driftAngleDeg,
      driftSpeedKmh: this.driftSpeedKmh,
      driftDuration: this.driftDuration,
      isDrifting: this.isDrifting,
      isInComboWindow: this.isInComboWindow,
      comboTimeRemaining: Math.max(this.comboTimer, 0),
      ratingText: this.ratingText,
      lastBankedPoints: this.lastBankedPoints,
      isSpinOut: this.isSpinOut,
    }
  }
}
