import * as THREE from 'three'
import { Vehicle } from '../vehicle/Vehicle.ts'

export interface FollowCameraConfig {
  // Base Chase Offsets
  distance: number // Distance behind vehicle (meters)
  height: number // Height above vehicle center (meters)
  lookAtHeight: number // Height of look-at focus point (meters)
  lookAtLead: number // Forward offset of look-at point (meters)

  // Dynamic Speed & Lookahead Behavior
  speedLookaheadFactor: number // Extra lookahead distance at high speed (meters)
  speedDistanceStretch: number // Camera distance stretch at top speed (meters)
  speedHeightOffset: number // Camera height adjustment at high speed (meters)
  speedFovBoost: number // FOV increase at maximum speed (degrees)
  baseFov: number // Nominal camera field of view (degrees)

  // Smoothing & Damping Rates
  positionLerpSpeed: number // Position tracking rate (exponential)
  rotationLerpSpeed: number // Yaw rotation alignment rate
  lookAtLerpSpeed: number // Look-at target tracking rate

  // Drift & Oversteer Camera Feel
  driftAngleLag: number // Camera lag angle during drift to frame slide (0..1)
  counterSteerLead: number // Lateral lookahead bias during counter-steering (meters)

  // Clipping & Ground Protection
  minAltitudeAboveGround: number // Minimum camera Y above ground level (meters)
  nearClippingPlane: number // Camera near plane (meters)

  // Camera Shake & Impact System
  shakeMaxDisplacement: number // Max positional shake offset (meters)
  shakeMaxAngular: number // Max rotational shake angle (radians)
  traumaDecayRate: number // Rate at which trauma dissipates per second
}

export type CameraPreset = 'NORMAL' | 'CLOSE' | 'FAR' | 'DRIFT'

export const CAMERA_PRESETS: Record<CameraPreset, FollowCameraConfig> = {
  NORMAL: {
    distance: 8.2,
    height: 3.4,
    lookAtHeight: 1.25,
    lookAtLead: 2.8,
    speedLookaheadFactor: 4.2,
    speedDistanceStretch: 1.2,
    speedHeightOffset: -0.15,
    speedFovBoost: 9.0,
    baseFov: 60.0,
    positionLerpSpeed: 7.2,
    rotationLerpSpeed: 5.8,
    lookAtLerpSpeed: 8.5,
    driftAngleLag: 0.32,
    counterSteerLead: 0.65,
    minAltitudeAboveGround: 0.75,
    nearClippingPlane: 0.25,
    shakeMaxDisplacement: 0.35,
    shakeMaxAngular: 0.045,
    traumaDecayRate: 1.75,
  },
  CLOSE: {
    distance: 6.4,
    height: 2.6,
    lookAtHeight: 1.15,
    lookAtLead: 2.4,
    speedLookaheadFactor: 3.2,
    speedDistanceStretch: 0.8,
    speedHeightOffset: -0.1,
    speedFovBoost: 11.0,
    baseFov: 62.0,
    positionLerpSpeed: 8.5,
    rotationLerpSpeed: 7.0,
    lookAtLerpSpeed: 9.5,
    driftAngleLag: 0.25,
    counterSteerLead: 0.5,
    minAltitudeAboveGround: 0.65,
    nearClippingPlane: 0.2,
    shakeMaxDisplacement: 0.4,
    shakeMaxAngular: 0.055,
    traumaDecayRate: 1.9,
  },
  FAR: {
    distance: 10.6,
    height: 4.5,
    lookAtHeight: 1.4,
    lookAtLead: 3.5,
    speedLookaheadFactor: 5.5,
    speedDistanceStretch: 1.8,
    speedHeightOffset: -0.2,
    speedFovBoost: 7.0,
    baseFov: 58.0,
    positionLerpSpeed: 6.0,
    rotationLerpSpeed: 4.8,
    lookAtLerpSpeed: 7.2,
    driftAngleLag: 0.38,
    counterSteerLead: 0.8,
    minAltitudeAboveGround: 0.9,
    nearClippingPlane: 0.3,
    shakeMaxDisplacement: 0.3,
    shakeMaxAngular: 0.035,
    traumaDecayRate: 1.6,
  },
  DRIFT: {
    distance: 7.8,
    height: 3.1,
    lookAtHeight: 1.2,
    lookAtLead: 2.6,
    speedLookaheadFactor: 3.8,
    speedDistanceStretch: 1.0,
    speedHeightOffset: -0.2,
    speedFovBoost: 12.0,
    baseFov: 63.0,
    positionLerpSpeed: 6.5,
    rotationLerpSpeed: 4.5,
    lookAtLerpSpeed: 8.0,
    driftAngleLag: 0.55,
    counterSteerLead: 1.2,
    minAltitudeAboveGround: 0.7,
    nearClippingPlane: 0.25,
    shakeMaxDisplacement: 0.38,
    shakeMaxAngular: 0.05,
    traumaDecayRate: 1.8,
  },
}

export class FollowCamera {
  private camera: THREE.PerspectiveCamera
  private vehicle: Vehicle
  public config: FollowCameraConfig
  private activePreset: CameraPreset = 'NORMAL'

  // Internal state vectors
  private currentPosition: THREE.Vector3 = new THREE.Vector3()
  private currentLookAt: THREE.Vector3 = new THREE.Vector3()
  private currentYaw: number = 0
  private isInitialized: boolean = false

  // Camera Shake & Trauma System
  private trauma: number = 0.0
  private shakeTime: number = 0.0
  private shakeOffset: THREE.Vector3 = new THREE.Vector3()

  // Reusable scratch vectors for performance (zero allocations per frame)
  private tempForward = new THREE.Vector3()
  private tempRight = new THREE.Vector3()
  private tempTargetPos = new THREE.Vector3()
  private tempTargetLookAt = new THREE.Vector3()
  private tempCarEuler = new THREE.Euler(0, 0, 0, 'YXZ')

  constructor(
    camera: THREE.PerspectiveCamera,
    vehicle: Vehicle,
    customConfig?: Partial<FollowCameraConfig>,
    initialPreset: CameraPreset = 'NORMAL'
  ) {
    this.camera = camera
    this.vehicle = vehicle
    this.activePreset = initialPreset
    this.config = { ...CAMERA_PRESETS[initialPreset], ...customConfig }

    this.camera.fov = this.config.baseFov
    this.camera.near = this.config.nearClippingPlane
    this.camera.updateProjectionMatrix()
  }

  /**
   * Main camera update called every frame.
   * Handles smooth follow, speed lookahead, drift lag, ground clipping, and screen shake.
   */
  public update(delta: number): void {
    if (!this.vehicle.root) return

    const carPos = this.vehicle.root.position
    const carQuat = this.vehicle.root.quaternion

    // 1. Compute speed ratios and forward/right vectors
    const fwdSpeed = this.vehicle.currentSpeed
    const absSpeed = Math.abs(fwdSpeed)
    const maxSpeed = this.vehicle.config.maxForwardSpeed || 38.0
    const speedRatio = Math.min(absSpeed / maxSpeed, 1.0)

    // Extract car yaw angle
    this.tempCarEuler.setFromQuaternion(carQuat)
    const targetCarYaw = this.tempCarEuler.y

    // 2. Initial Snap on First Update
    if (!this.isInitialized) {
      this.currentYaw = targetCarYaw
      this.computeIdealPositions(targetCarYaw, carPos, speedRatio, this.tempTargetPos, this.tempTargetLookAt)
      this.currentPosition.copy(this.tempTargetPos)
      this.currentLookAt.copy(this.tempTargetLookAt)
      this.camera.position.copy(this.currentPosition)
      this.camera.lookAt(this.currentLookAt)
      this.isInitialized = true
      return
    }

    // 3. Smooth Yaw Rotation Tracking with Drift Lag Angle
    // In drifts, camera slightly lags car orientation to frame oversteer angle nicely
    let desiredYaw = targetCarYaw
    if (this.vehicle.isDrifting && this.config.driftAngleLag > 0) {
      // Slip angle in radians
      const slipBias = this.vehicle.slipAngle * Math.sign(this.vehicle.currentLateralSpeed)
      desiredYaw -= slipBias * this.config.driftAngleLag
    }

    // Smooth shortest-angle yaw interpolation
    const yawDiff = THREE.MathUtils.euclideanModulo(desiredYaw - this.currentYaw + Math.PI, Math.PI * 2) - Math.PI
    const yawAlpha = 1 - Math.exp(-this.config.rotationLerpSpeed * delta)
    this.currentYaw += yawDiff * yawAlpha

    // 4. Compute Ideal Target Position & LookAt based on Filtered Yaw
    this.computeIdealPositions(this.currentYaw, carPos, speedRatio, this.tempTargetPos, this.tempTargetLookAt)

    // 5. Anti-Clipping Ground Protection Clamp
    const minAllowedY = Math.max(carPos.y + 0.3, this.config.minAltitudeAboveGround)
    if (this.tempTargetPos.y < minAllowedY) {
      this.tempTargetPos.y = minAllowedY
    }

    // 6. Smooth Exponential Interpolation
    const posAlpha = 1 - Math.exp(-this.config.positionLerpSpeed * delta)
    const lookAtAlpha = 1 - Math.exp(-this.config.lookAtLerpSpeed * delta)

    this.currentPosition.lerp(this.tempTargetPos, posAlpha)
    this.currentLookAt.lerp(this.tempTargetLookAt, lookAtAlpha)

    // 7. Dynamic High-Speed FOV Scaling
    const targetFov = this.config.baseFov + this.config.speedFovBoost * Math.pow(speedRatio, 1.2)
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-6.0 * delta))
      this.camera.updateProjectionMatrix()
    }

    // 8. Trauma-based Camera Shake Decay & Offset (Phase 20)
    if (this.trauma > 0) {
      this.shakeTime += delta * 32.0 // High frequency impact shake
      const shakeFactor = this.trauma * this.trauma // Quadratic falloff
      const maxDisp = this.config.shakeMaxDisplacement * shakeFactor

      this.shakeOffset.set(
        (Math.sin(this.shakeTime * 1.3) + Math.sin(this.shakeTime * 2.7)) * 0.5 * maxDisp,
        Math.cos(this.shakeTime * 1.7) * 0.5 * maxDisp,
        Math.sin(this.shakeTime * 2.1) * 0.3 * maxDisp
      )

      this.trauma = Math.max(0, this.trauma - this.config.traumaDecayRate * delta)
    } else {
      this.shakeOffset.set(0, 0, 0)
    }

    // 9. Apply to Camera Transform
    this.camera.position.copy(this.currentPosition).add(this.shakeOffset)
    this.camera.lookAt(this.currentLookAt)
  }

  /**
   * Computes the target position behind the car and look-at point in front of the car.
   */
  private computeIdealPositions(
    yaw: number,
    carPos: THREE.Vector3,
    speedRatio: number,
    outPos: THREE.Vector3,
    outLookAt: THREE.Vector3
  ): void {
    // Forward and Right vectors computed from yaw angle
    this.tempForward.set(Math.sin(yaw), 0, Math.cos(yaw))
    this.tempRight.set(-Math.cos(yaw), 0, Math.sin(yaw))

    // Distance stretch & height drop at speed
    const effectiveDistance = this.config.distance + this.config.speedDistanceStretch * speedRatio
    const effectiveHeight = this.config.height + this.config.speedHeightOffset * speedRatio

    // Target camera position behind car
    outPos.copy(carPos)
      .addScaledVector(this.tempForward, -effectiveDistance)
    outPos.y += effectiveHeight

    // Speed lookahead and steering lead
    const effectiveLookAhead = this.config.lookAtLead + this.config.speedLookaheadFactor * speedRatio

    // In drift or sharp turn, bias lookahead towards turning direction (Apex lead)
    const steerBias = this.vehicle.currentSteerAngle * this.config.counterSteerLead

    outLookAt.copy(carPos)
      .addScaledVector(this.tempForward, effectiveLookAhead)
      .addScaledVector(this.tempRight, steerBias)
    outLookAt.y += this.config.lookAtHeight
  }

  /**
   * Instant snap to vehicle target position.
   * Call on respawn, teleport, or room transition to prevent wild camera lerps.
   */
  public snap(): void {
    if (!this.vehicle.root) return
    const carPos = this.vehicle.root.position
    this.tempCarEuler.setFromQuaternion(this.vehicle.root.quaternion)
    this.currentYaw = this.tempCarEuler.y

    const fwdSpeed = this.vehicle.currentSpeed
    const maxSpeed = this.vehicle.config.maxForwardSpeed || 38.0
    const speedRatio = Math.min(Math.abs(fwdSpeed) / maxSpeed, 1.0)

    this.computeIdealPositions(this.currentYaw, carPos, speedRatio, this.tempTargetPos, this.tempTargetLookAt)
    this.currentPosition.copy(this.tempTargetPos)
    this.currentLookAt.copy(this.tempTargetLookAt)
    this.camera.position.copy(this.currentPosition)
    this.camera.lookAt(this.currentLookAt)
    this.trauma = 0.0
    this.shakeOffset.set(0, 0, 0)
    this.isInitialized = true
  }

  /**
   * Add camera trauma from 0.0 to 1.0 (clamped).
   * Trauma is converted quadratically into screen shake.
   */
  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, Math.max(0.0, this.trauma + amount))
  }

  /**
   * Trigger collision/impact camera shake based on velocity drop or collision magnitude.
   */
  public triggerImpactShake(impactSeverity: number = 0.5): void {
    const traumaAmount = Math.min(1.0, impactSeverity * 0.75 + 0.15)
    this.addTrauma(traumaAmount)
  }

  /**
   * Change camera preset (NORMAL, CLOSE, FAR, DRIFT).
   */
  public setPreset(preset: CameraPreset): void {
    this.activePreset = preset
    this.config = { ...CAMERA_PRESETS[preset] }
    this.camera.fov = this.config.baseFov
    this.camera.updateProjectionMatrix()
    console.log(`✓ Camera preset changed to: ${preset}`)
  }

  /**
   * Cycle to next camera preset.
   */
  public cyclePreset(): CameraPreset {
    const presets: CameraPreset[] = ['NORMAL', 'CLOSE', 'FAR', 'DRIFT']
    const nextIndex = (presets.indexOf(this.activePreset) + 1) % presets.length
    const nextPreset = presets[nextIndex]
    this.setPreset(nextPreset)
    return nextPreset
  }

  public getActivePreset(): CameraPreset {
    return this.activePreset
  }

  public getCurrentPosition(): THREE.Vector3 {
    return this.currentPosition
  }

  public getCurrentLookAt(): THREE.Vector3 {
    return this.currentLookAt
  }
}
