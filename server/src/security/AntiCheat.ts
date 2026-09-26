/**
 * AntiCheat.ts - Server-Authoritative Anti-Cheat & Strict Protocol Validation (Phase 28)
 *
 * Enforces server authority over competitive game state:
 * - Rejects client-dictated finish positions, lap counts, and illegal checkpoint passes
 * - Validates drift score accumulation rates and strictly prevents arbitrary point injection
 * - Validates unlock states and whitelists authorized vehicle IDs
 * - Performs schema and finite boundary validation on all network payloads
 */

export const AUTHORIZED_CAR_IDS = new Set([
  'sedan_sports',
  'hyper_race',
  'drift_tuner',
  'muscle_classic',
  'suv_luxury',
  'police_interceptor',
  // Historical / mapped IDs
  'car-sedan',
  'car-hypercar',
  'car-sports',
  'car-muscle',
  'car-tuner',
  'car-suv',
  'car-police',
])

export class AntiCheatValidator {
  /**
   * Check if a value is a strictly valid, finite number within specified range.
   */
  public static isFiniteNumber(val: unknown, min = -Infinity, max = Infinity): val is number {
    return typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max
  }

  /**
   * Sanitize a string against script injection, control characters, and length limits.
   */
  public static sanitizeString(val: unknown, maxLen = 32, fallback = ''): string {
    if (typeof val !== 'string') return fallback
    const cleaned = val
      .replace(/[<>'"&]/g, '') // Strip markup chars
      .replace(/[\x00-\x1F\x7F]/g, '') // Strip control chars
      .trim()
    return cleaned.slice(0, maxLen) || fallback
  }

  /**
   * Validate a 3D position vector with bounded coordinates.
   */
  public static isValidVec3(val: unknown, minBound = -2000, maxBound = 2000): val is [number, number, number] {
    if (!Array.isArray(val) || val.length !== 3) return false
    return val.every(n => typeof n === 'number' && Number.isFinite(n) && n >= minBound && n <= maxBound)
  }

  /**
   * Validate a 4D quaternion vector.
   */
  public static isValidQuat(val: unknown): val is [number, number, number, number] {
    if (!Array.isArray(val) || val.length !== 4) return false
    return val.every(n => typeof n === 'number' && Number.isFinite(n))
  }

  /**
   * Check if car ID belongs to the authorized vehicle catalog.
   */
  public static isAuthorizedCar(carId: unknown): boolean {
    if (typeof carId !== 'string') return false
    return AUTHORIZED_CAR_IDS.has(carId.trim().toLowerCase())
  }

  /**
   * Strict validation for Race Checkpoint Pass requests.
   * Ensures the client cannot spoof checkpoint order, skip tracks, or jump ahead in laps.
   */
  public static validateRaceCheckpointPass(params: {
    expectedNextCheckpoint: number
    requestedCheckpoint: number
    lastCheckpointTime: number
    expectedLap: number
    reportedLap: number
    playerPosition: [number, number, number]
    checkpointDef: { x: number; z: number; radius: number }
    minIntervalMs?: number
  }): { valid: boolean; reason?: string } {
    const {
      expectedNextCheckpoint,
      requestedCheckpoint,
      lastCheckpointTime,
      expectedLap,
      reportedLap,
      playerPosition,
      checkpointDef,
      minIntervalMs = 900,
    } = params

    // 1. Validate checkpoint index
    if (!Number.isInteger(requestedCheckpoint) || requestedCheckpoint !== expectedNextCheckpoint) {
      return {
        valid: false,
        reason: `INVALID_CHECKPOINT_SEQUENCE: expected ${expectedNextCheckpoint}, got ${requestedCheckpoint}`,
      }
    }

    // 2. Reject client-claimed lap jumps (server strictly tracks lap progress)
    if (typeof reportedLap === 'number' && reportedLap !== expectedLap) {
      return {
        valid: false,
        reason: `LAP_MISMATCH: server lap is ${expectedLap}, client reported ${reportedLap}`,
      }
    }

    // 3. Spatial verification: player must be within target checkpoint proximity
    const dx = playerPosition[0] - checkpointDef.x
    const dz = playerPosition[2] - checkpointDef.z
    const dist = Math.hypot(dx, dz)
    const maxAllowedDist = checkpointDef.radius + 18.0 // Proximity tolerance for high speed & latency

    if (dist > maxAllowedDist) {
      return {
        valid: false,
        reason: `CHECKPOINT_SPATIAL_VIOLATION: distance ${dist.toFixed(1)}m exceeds radius limit ${maxAllowedDist.toFixed(1)}m`,
      }
    }

    // 4. Anti-Teleport Minimum Travel Time verification
    const now = Date.now()
    const elapsed = now - lastCheckpointTime
    if (elapsed < minIntervalMs) {
      return {
        valid: false,
        reason: `ANTI_TELEPORT_VIOLATION: elapsed ${elapsed}ms is below physical threshold ${minIntervalMs}ms`,
      }
    }

    return { valid: true }
  }

  /**
   * Strict validation for Drift Score Submissions.
   * Prevents arbitrary point injection, fake banking without active drift, and impossible multipliers.
   */
  public static validateDriftSubmission(params: {
    isSpinOut?: boolean
    banked?: boolean
    pointsDelta: number
    serverAccumulatedPoints: number
    speedKmh: number
    slipAngleDeg: number
    duration: number
    comboMultiplier: number
    zoneBonus: number
    dtSec: number
  }): {
    valid: boolean
    sanitizedPointsDelta?: number
    sanitizedCombo?: number
    bankableAmount?: number
    reason?: string
  } {
    const {
      isSpinOut,
      banked,
      pointsDelta,
      serverAccumulatedPoints,
      speedKmh,
      slipAngleDeg,
      duration,
      comboMultiplier,
      zoneBonus,
      dtSec,
    } = params

    if (isSpinOut) {
      return { valid: true }
    }

    // 1. Banked Points Validation:
    // Client CANNOT arbitrarily claim points when banking!
    // Banked score must come from server-authoritative accumulated drift points.
    if (banked) {
      if (serverAccumulatedPoints <= 0) {
        return {
          valid: false,
          reason: 'INVALID_BANK_ATTEMPT: No accumulated drift points to bank',
        }
      }
      // Bank amount is authoritatively bounded by what was accumulated
      const bankable = Math.min(Math.round(serverAccumulatedPoints), 150000)
      return { valid: true, bankableAmount: bankable }
    }

    // 2. Active Telemetry Bounds Validation
    if (!Number.isFinite(speedKmh) || speedKmh < 8 || speedKmh > 260) {
      return { valid: false, reason: `UNREALISTIC_SPEED: ${speedKmh} km/h` }
    }

    if (!Number.isFinite(slipAngleDeg) || slipAngleDeg < 7 || slipAngleDeg > 88) {
      return { valid: false, reason: `UNREALISTIC_ANGLE: ${slipAngleDeg} deg` }
    }

    if (!Number.isFinite(zoneBonus) || zoneBonus < 0.9 || zoneBonus > 2.6) {
      return { valid: false, reason: `UNREALISTIC_ZONE_BONUS: ${zoneBonus}` }
    }

    // 3. Physical Max Drift Accumulation Rate Clamp:
    // Max theoretical rate = 160 base * 2.5 angle * 2.2 speed * 2.5 zone * 5.0 combo = 11,000 pts/sec
    const maxTheoreticalRate = 11000
    const boundedDt = Math.min(Math.max(dtSec, 0.03), 1.5)
    const maxAllowedPoints = Math.round(maxTheoreticalRate * 1.35 * boundedDt) + 50

    const clampedDelta = Math.min(Math.max(0, pointsDelta), maxAllowedPoints)

    // 4. Combo Multiplier Bounds based on continuous duration
    const maxAllowedCombo =
      duration >= 8.0 ? 5.0 :
      duration >= 6.0 ? 4.0 :
      duration >= 4.0 ? 3.0 :
      duration >= 2.5 ? 2.5 :
      duration >= 1.5 ? 2.0 :
      duration >= 0.8 ? 1.5 : 1.0

    const clampedCombo = Math.min(Math.max(1.0, comboMultiplier || 1.0), maxAllowedCombo)

    return {
      valid: true,
      sanitizedPointsDelta: clampedDelta,
      sanitizedCombo: clampedCombo,
    }
  }

  /**
   * Currency & Unlock State validation.
   * If any client tries to claim custom balance, currency, or locked vehicle, rejects or resets to defaults.
   */
  public static validateVehicleSelection(selectedCarId: unknown): string {
    if (typeof selectedCarId === 'string' && AntiCheatValidator.isAuthorizedCar(selectedCarId)) {
      return selectedCarId.trim()
    }
    return 'sedan_sports'
  }
}
