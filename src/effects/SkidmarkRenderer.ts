import * as THREE from 'three'
import type { Vehicle } from '../vehicle/Vehicle.ts'

export interface SkidmarkConfig {
  maxSegments?: number
  tireWidth?: number
  fadeSpeed?: number
  groundYOffset?: number
}

/**
 * High-performance dynamic tire skidmark ribbon renderer.
 * Efficiently draws authentic rubber skidmarks on the asphalt when:
 * - Drifting (slip angle > 0.22)
 * - Hard braking / wheel lock
 * - W + S Rev Limiter / Burnout (dense circular rubber marks)
 */
export class SkidmarkRenderer {
  private scene: THREE.Scene
  private maxSegments: number
  private tireWidth: number
  private groundYOffset: number

  private mesh: THREE.Mesh
  private geometry: THREE.BufferGeometry
  private positions: Float32Array
  private colors: Float32Array
  private indices: Uint32Array

  // Ring buffer index
  private currentSegment: number = 0
  private totalSegments: number = 0

  // Previous wheel positions for connecting ribbons
  private lastLeftPos = new THREE.Vector3()
  private lastRightPos = new THREE.Vector3()
  private hadPrevLeft: boolean = false
  private hadPrevRight: boolean = false

  // Scratchpad vectors (zero allocation)
  private tempLeftWheel = new THREE.Vector3()
  private tempRightWheel = new THREE.Vector3()
  private tempForward = new THREE.Vector3()
  private tempRight = new THREE.Vector3()

  // Burnout accumulator
  private burnoutDistanceAccum: number = 0

  constructor(scene: THREE.Scene, config?: SkidmarkConfig) {
    this.scene = scene
    this.maxSegments = config?.maxSegments || 900
    this.tireWidth = config?.tireWidth || 0.28
    this.groundYOffset = config?.groundYOffset || 0.038

    // Each segment connects 2 vertices to 2 previous vertices = 1 quad (2 triangles, 4 vertices, 6 indices)
    const vertexCount = this.maxSegments * 4
    const indexCount = this.maxSegments * 6

    this.positions = new Float32Array(vertexCount * 3)
    this.colors = new Float32Array(vertexCount * 4) // RGBA
    this.indices = new Uint32Array(indexCount)

    // Pre-populate index buffer for quad triangles
    for (let i = 0; i < this.maxSegments; i++) {
      const vIdx = i * 4
      const iIdx = i * 6
      this.indices[iIdx + 0] = vIdx + 0
      this.indices[iIdx + 1] = vIdx + 1
      this.indices[iIdx + 2] = vIdx + 2
      this.indices[iIdx + 3] = vIdx + 2
      this.indices[iIdx + 4] = vIdx + 1
      this.indices[iIdx + 5] = vIdx + 3
    }

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4))
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1))

    // High performance rubber skidmark material
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -3.0,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(this.geometry, material)
    this.mesh.name = 'DynamicSkidmarksMesh'
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  /**
   * Updates skidmark generation based on vehicle dynamics
   */
  public update(delta: number, vehicle: Vehicle): void {
    if (!vehicle.root) return

    // 1. Fade existing skidmarks gradually over ~18 seconds
    const fadeDelta = delta * 0.055
    let needsColorUpdate = false
    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute
    const colAttr = this.geometry.attributes.color as THREE.BufferAttribute

    if (this.totalSegments > 0) {
      const limit = Math.min(this.totalSegments, this.maxSegments) * 4
      for (let i = 0; i < limit; i++) {
        const aIdx = i * 4 + 3
        if (this.colors[aIdx] > 0.001) {
          this.colors[aIdx] = Math.max(0, this.colors[aIdx] - fadeDelta)
          needsColorUpdate = true
        }
      }
    }

    // 2. Check if tires are skidding
    const speedKmh = vehicle.currentSpeed * 3.6
    const absSpeedKmh = Math.abs(speedKmh)
    const isDrifting = vehicle.isDrifting && Math.abs(vehicle.slipAngle) > 0.22 && absSpeedKmh > 12.0
    const isHardBrake = vehicle.isHandbrakeActive && absSpeedKmh > 10.0
    const isRevLimiter = vehicle.isRevLimiterActive

    const isSkidding = isDrifting || isHardBrake || isRevLimiter

    if (!isSkidding) {
      this.hadPrevLeft = false
      this.hadPrevRight = false
      if (needsColorUpdate) colAttr.needsUpdate = true
      return
    }

    // Calculate intensity and rubber darkness
    let intensity = 0.45
    if (isRevLimiter) {
      intensity = 0.72 // Dense black rubber from stationary burnout
    } else if (isDrifting) {
      intensity = Math.min(0.85, 0.35 + Math.abs(vehicle.slipAngle) * 0.5)
    } else if (isHardBrake) {
      intensity = 0.55
    }

    // 3. Compute rear wheel contact positions
    const carPos = vehicle.root.position
    vehicle.root.getWorldDirection(this.tempForward)
    this.tempRight.set(-this.tempForward.z, 0, this.tempForward.x).normalize()

    const halfTrack = 0.82
    const rearAxleDist = -1.15

    // Left rear tire ground point
    this.tempLeftWheel.copy(carPos)
      .addScaledVector(this.tempForward, rearAxleDist)
      .addScaledVector(this.tempRight, -halfTrack)
    this.tempLeftWheel.y = this.groundYOffset

    // Right rear tire ground point
    this.tempRightWheel.copy(carPos)
      .addScaledVector(this.tempForward, rearAxleDist)
      .addScaledVector(this.tempRight, halfTrack)
    this.tempRightWheel.y = this.groundYOffset

    // 4. Add skid segments when moved sufficiently
    let shouldAddLeft = false
    let shouldAddRight = false

    if (isRevLimiter) {
      this.burnoutDistanceAccum += delta
      if (this.burnoutDistanceAccum >= 0.065) {
        this.burnoutDistanceAccum = 0
        shouldAddLeft = true
        shouldAddRight = true
      }
    } else {
      const distL = this.hadPrevLeft ? this.tempLeftWheel.distanceTo(this.lastLeftPos) : 999
      const distR = this.hadPrevRight ? this.tempRightWheel.distanceTo(this.lastRightPos) : 999

      if (distL > 0.42 && distL < 5.0) shouldAddLeft = true
      if (distR > 0.42 && distR < 5.0) shouldAddRight = true
    }

    if (shouldAddLeft) {
      if (this.hadPrevLeft) {
        this.addSegment(this.lastLeftPos, this.tempLeftWheel, intensity)
      }
      this.lastLeftPos.copy(this.tempLeftWheel)
      this.hadPrevLeft = true
    }

    if (shouldAddRight) {
      if (this.hadPrevRight) {
        this.addSegment(this.lastRightPos, this.tempRightWheel, intensity)
      }
      this.lastRightPos.copy(this.tempRightWheel)
      this.hadPrevRight = true
    }

    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
  }

  /**
   * Appends a quad segment between prevPos and currPos
   */
  private addSegment(prev: THREE.Vector3, curr: THREE.Vector3, alpha: number): void {
    const segIdx = this.currentSegment % this.maxSegments
    const vBase = segIdx * 4

    // Direction of movement
    this.tempNormDir(prev, curr, this.tempForward)
    // Lateral normal
    this.tempRight.set(-this.tempForward.z, 0, this.tempForward.x).normalize().multiplyScalar(this.tireWidth * 0.5)

    const p0 = prev.clone().sub(this.tempRight)
    const p1 = prev.clone().add(this.tempRight)
    const p2 = curr.clone().sub(this.tempRight)
    const p3 = curr.clone().add(this.tempRight)

    const pos = this.positions
    const col = this.colors

    // Rubber color: rich asphalt tire mark (deep charcoal black with alpha)
    const r = 0.06
    const g = 0.06
    const b = 0.06

    // V0
    pos[vBase * 3 + 0] = p0.x
    pos[vBase * 3 + 1] = p0.y
    pos[vBase * 3 + 2] = p0.z
    col[vBase * 4 + 0] = r
    col[vBase * 4 + 1] = g
    col[vBase * 4 + 2] = b
    col[vBase * 4 + 3] = alpha

    // V1
    pos[(vBase + 1) * 3 + 0] = p1.x
    pos[(vBase + 1) * 3 + 1] = p1.y
    pos[(vBase + 1) * 3 + 2] = p1.z
    col[(vBase + 1) * 4 + 0] = r
    col[(vBase + 1) * 4 + 1] = g
    col[(vBase + 1) * 4 + 2] = b
    col[(vBase + 1) * 4 + 3] = alpha

    // V2
    pos[(vBase + 2) * 3 + 0] = p2.x
    pos[(vBase + 2) * 3 + 1] = p2.y
    pos[(vBase + 2) * 3 + 2] = p2.z
    col[(vBase + 2) * 4 + 0] = r
    col[(vBase + 2) * 4 + 1] = g
    col[(vBase + 2) * 4 + 2] = b
    col[(vBase + 2) * 4 + 3] = alpha

    // V3
    pos[(vBase + 3) * 3 + 0] = p3.x
    pos[(vBase + 3) * 3 + 1] = p3.y
    pos[(vBase + 3) * 3 + 2] = p3.z
    col[(vBase + 3) * 4 + 0] = r
    col[(vBase + 3) * 4 + 1] = g
    col[(vBase + 3) * 4 + 2] = b
    col[(vBase + 3) * 4 + 3] = alpha

    this.currentSegment++
    this.totalSegments++
  }

  private tempNormDir(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3): void {
    out.subVectors(to, from)
    const len = out.length()
    if (len > 0.0001) {
      out.multiplyScalar(1 / len)
    } else {
      out.set(0, 0, 1)
    }
  }

  /**
   * Resets all skidmarks (e.g. on respawn or mode switch)
   */
  public reset(): void {
    this.hadPrevLeft = false
    this.hadPrevRight = false
    this.currentSegment = 0
    this.totalSegments = 0
    this.burnoutDistanceAccum = 0

    // Clear alpha
    for (let i = 0; i < this.colors.length; i += 4) {
      this.colors[i + 3] = 0
    }
    const colAttr = this.geometry.attributes.color as THREE.BufferAttribute
    colAttr.needsUpdate = true
  }

  public dispose(): void {
    this.scene.remove(this.mesh)
    this.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
