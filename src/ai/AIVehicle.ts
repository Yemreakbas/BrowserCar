import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ExhaustFlameVFX } from '../effects/ExhaustFlameVFX.ts'
import { VehicleHeadlights } from '../effects/VehicleHeadlights.ts'
import { checkCityFeeler, resolveCityObstaclePenetration } from '../world/CityCollisionHelper.ts'

export interface AIOptimizationConfig {
  id: string
  name: string
  modelPath: string
  color: number
  role: 'RACER' | 'TRAFFIC'
  scale?: number
  maxSpeed?: number
  acceleration?: number
  brakePower?: number
  steerRate?: number
}

export class AIVehicle {
  public readonly id: string
  public readonly name: string
  public readonly role: 'RACER' | 'TRAFFIC'
  public readonly root: THREE.Group
  public readonly bodyGroup: THREE.Group
  private scene: THREE.Scene

  // Car model and wheels
  public carModel: THREE.Group | null = null
  private wheelFrontLeft: THREE.Object3D | null = null
  private wheelFrontRight: THREE.Object3D | null = null
  private wheelBackLeft: THREE.Object3D | null = null
  private wheelBackRight: THREE.Object3D | null = null
  private placeholderMesh: THREE.Group | null = null
  private nameplateSprite: THREE.Sprite | null = null
  private flameVFX: ExhaustFlameVFX
  public headlights: VehicleHeadlights

  // Physics & Kinematics
  public currentSpeed: number = 0
  public maxSpeed: number = 36.0 // m/s
  public acceleration: number = 24.0 // m/s^2
  public brakePower: number = 32.0 // m/s^2
  public steerRate: number = 9.0 // rad/s
  public currentSteerAngle: number = 0
  private wheelSpinAngle: number = 0
  public isLocked: boolean = false
  public isNitro: boolean = false
  private nitroTimer: number = 0
  private nitroCooldown: number = 0

  // Waypoint Navigation
  public waypoints: THREE.Vector3[] = []
  public currentWaypointIndex: number = 0
  public waypointRadius: number = 6.5
  public lookaheadDist: number = 10.0

  // Race Telemetry (if RACER)
  public currentLap: number = 1
  public totalLaps: number = 3
  public nextCheckpointIndex: number = 1
  public currentLapTime: number = 0
  public totalRaceTime: number = 0
  public bestLapTime: number | null = null
  public lapTimes: number[] = []
  public isFinished: boolean = false

  // Cached math vectors (Zero-allocation for 60+ FPS)
  private tempForward = new THREE.Vector3()
  private tempRight = new THREE.Vector3()
  private tempTargetDir = new THREE.Vector3()
  private tempDiff = new THREE.Vector3()
  private tempLookahead = new THREE.Vector3()
  private tempObsDiff = new THREE.Vector3()
  private tempObsDir = new THREE.Vector3()

  constructor(scene: THREE.Scene, config: AIOptimizationConfig) {
    this.scene = scene
    this.id = config.id
    this.name = config.name
    this.role = config.role

    if (config.maxSpeed) this.maxSpeed = config.maxSpeed
    if (config.acceleration) this.acceleration = config.acceleration
    if (config.brakePower) this.brakePower = config.brakePower
    if (config.steerRate) this.steerRate = config.steerRate

    this.root = new THREE.Group()
    this.root.name = `AIVehicle_${this.id}`
    this.scene.add(this.root)

    this.bodyGroup = new THREE.Group()
    this.bodyGroup.name = `AIBody_${this.id}`
    this.root.add(this.bodyGroup)

    this.flameVFX = new ExhaustFlameVFX(this.bodyGroup, false)
    this.headlights = new VehicleHeadlights(this.bodyGroup, false)

    this.createPlaceholder(config.color)
    this.createNameplate(config.color)
    this.loadModel(config.modelPath, config.scale || 1.45, config.color)
  }

  private createPlaceholder(color: number) {
    this.placeholderMesh = new THREE.Group()
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.6, 3.6)
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.3,
    })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = 0.55
    body.castShadow = true
    this.placeholderMesh.add(body)
    this.bodyGroup.add(this.placeholderMesh)
  }

  private createNameplate(color: number) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    this.roundRect(ctx, 4, 4, 248, 56, 12)
    ctx.fill()

    ctx.lineWidth = 2
    ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0')
    this.roundRect(ctx, 4, 4, 248, 56, 12)
    ctx.stroke()

    ctx.font = 'bold 22px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.name, 128, 32)

    const texture = new THREE.CanvasTexture(canvas)
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
    this.nameplateSprite = new THREE.Sprite(spriteMat)
    this.nameplateSprite.scale.set(3.2, 0.8, 1)
    this.nameplateSprite.position.set(0, 2.2, 0)
    this.root.add(this.nameplateSprite)
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  private loadModel(modelPath: string, scale: number, color: number) {
    const loader = new GLTFLoader()
    loader.load(
      modelPath,
      (gltf) => {
        if (this.placeholderMesh) {
          this.bodyGroup.remove(this.placeholderMesh)
          this.placeholderMesh = null
        }

        const model = gltf.scene
        model.scale.set(scale, scale, scale)
        model.position.set(0, 0, 0)

        // Custom paint tint on body meshes
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh
            mesh.castShadow = true
            mesh.receiveShadow = true

            const name = mesh.name.toLowerCase()
            if (
              name.includes('body') ||
              name.includes('paint') ||
              name.includes('chassis') ||
              name.includes('car')
            ) {
              if (mesh.material) {
                const orig = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
                const tinted = (orig as THREE.MeshStandardMaterial).clone()
                tinted.color.setHex(color)
                mesh.material = tinted
              }
            }
          }
        })

        // Identify wheel nodes
        model.traverse((child) => {
          const lower = child.name.toLowerCase()
          if (lower.includes('wheel-front-left') || lower.includes('wheelfrontleft')) {
            this.wheelFrontLeft = child
          } else if (lower.includes('wheel-front-right') || lower.includes('wheelfrontright')) {
            this.wheelFrontRight = child
          } else if (lower.includes('wheel-back-left') || lower.includes('wheelbackleft')) {
            this.wheelBackLeft = child
          } else if (lower.includes('wheel-back-right') || lower.includes('wheelbackright')) {
            this.wheelBackRight = child
          }
        })

        this.carModel = model
        this.bodyGroup.add(model)
      },
      undefined,
      (err) => {
        console.warn(`[AIVehicle] Failed to load model ${modelPath}:`, err)
      }
    )
  }

  public setWaypoints(waypoints: THREE.Vector3[], startIndex: number = 0) {
    this.waypoints = waypoints
    this.currentWaypointIndex = startIndex % waypoints.length
  }

  public reset(position: THREE.Vector3, rotationY: number, waypointIndex: number = 0) {
    this.root.position.copy(position)
    this.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY)
    this.currentSpeed = 0
    this.currentSteerAngle = 0
    this.currentWaypointIndex = waypointIndex
    this.currentLap = 1
    this.nextCheckpointIndex = 1
    this.currentLapTime = 0
    this.totalRaceTime = 0
    this.bestLapTime = null
    this.lapTimes = []
    this.isFinished = false
    this.isNitro = false
    this.nitroTimer = 0
    this.flameVFX.setActive(false)
    this.flameVFX.update(0.016, 0)
  }

  public update(
    delta: number,
    obstacles: Array<{ position: THREE.Vector3; speed: number; forward: THREE.Vector3; radius?: number }> = [],
    isNight: boolean = false
  ) {
    if (this.isLocked) {
      this.currentSpeed = 0
      this.flameVFX.setActive(false)
      this.flameVFX.update(delta, 0)
      this.headlights.update(delta, false, isNight)
      return
    }

    if (this.waypoints.length === 0) return

    // Telemetry timers
    if (this.role === 'RACER' && !this.isFinished) {
      this.currentLapTime += delta
      this.totalRaceTime += delta
    }

    // 1. Compute target waypoint and direction
    const targetWp = this.waypoints[this.currentWaypointIndex]
    this.tempDiff.subVectors(targetWp, this.root.position)
    this.tempDiff.y = 0
    const distToWp = this.tempDiff.length()

    if (distToWp < this.waypointRadius) {
      // Advance to next waypoint
      this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length

      // If wrapped to 0 in racer mode, full lap completed!
      if (this.role === 'RACER' && this.currentWaypointIndex === 0) {
        this.lapTimes.push(this.currentLapTime)
        if (this.bestLapTime === null || this.currentLapTime < this.bestLapTime) {
          this.bestLapTime = this.currentLapTime
        }
        if (this.currentLap < this.totalLaps) {
          this.currentLap++
          this.currentLapTime = 0
        } else {
          this.isFinished = true
        }
      }
    }

    // Lookahead point for smoother racing line (Zero allocation)
    const lookaheadIdx = (this.currentWaypointIndex + 1) % this.waypoints.length
    const nextWp = this.waypoints[lookaheadIdx]
    this.tempLookahead.lerpVectors(targetWp, nextWp, 0.45)
    this.tempTargetDir.subVectors(this.tempLookahead, this.root.position).normalize()

    // 2. Heading alignment & Steer calculation
    this.tempForward.set(0, 0, 1).applyQuaternion(this.root.quaternion)
    this.tempRight.set(-1, 0, 0).applyQuaternion(this.root.quaternion)

    const forwardDot = this.tempForward.dot(this.tempTargetDir)
    const rightDot = this.tempRight.dot(this.tempTargetDir) // positive = steer left, negative = steer right

    // Corner sharpness: 1.0 = straight, 0.0 = 90 deg corner, -1.0 = hairpin
    const angleDiff = Math.atan2(rightDot, forwardDot)
    let steerDemand = THREE.MathUtils.clamp(angleDiff * 1.6, -0.65, 0.65)

    // 3. Obstacle Avoidance & Collision Prevention (Zero allocation)
    let targetSpeed = this.maxSpeed
    let avoidanceBrake = false

    // Slow down in corners based on curvature
    if (forwardDot < 0.85) {
      // Cornering speed scaling: 16 m/s for sharp turns, 36 m/s on straights
      targetSpeed = THREE.MathUtils.lerp(15.0, this.maxSpeed, Math.max(0, forwardDot))
    }

    // Check obstacles ahead (Player and other AIs)
    for (let oIdx = 0; oIdx < obstacles.length; oIdx++) {
      const obs = obstacles[oIdx]
      this.tempObsDiff.subVectors(obs.position, this.root.position)
      const dist = this.tempObsDiff.length()

      if (dist < 14.0 && dist > 0.5) {
        this.tempObsDir.copy(this.tempObsDiff).multiplyScalar(1.0 / dist)
        const obsForwardDot = this.tempForward.dot(this.tempObsDir)
        if (obsForwardDot > 0.4) {
          // Obstacle is ahead in front cone!
          const obsRightDot = this.tempRight.dot(this.tempObsDir)

          if (dist < 6.0) {
            // Immediate braking zone to prevent rear-ending
            avoidanceBrake = true
            targetSpeed = Math.min(targetSpeed, Math.max(0, obs.speed - 2.0))
          } else {
            // Adjust steering laterally to overtake or follow
            const swerveSign = obsRightDot >= 0 ? -1 : 1
            steerDemand += swerveSign * 0.25
            targetSpeed = Math.min(targetSpeed, obs.speed + 4.0)
          }
        }
      }
    }

    // Check building obstacles ahead in city traffic
    if (this.role === 'TRAFFIC') {
      const feelerCenter = checkCityFeeler(this.root.position, this.tempForward, 8.5)
      if (feelerCenter.hit) {
        avoidanceBrake = true
        targetSpeed = Math.min(targetSpeed, 6.0)
        // Steer away from obstacle
        const leftVec = this.tempForward.clone().addScaledVector(this.tempRight, 0.6).normalize()
        const rightVec = this.tempForward.clone().addScaledVector(this.tempRight, -0.6).normalize()
        const feelerLeft = checkCityFeeler(this.root.position, leftVec, 7.5)
        const feelerRight = checkCityFeeler(this.root.position, rightVec, 7.5)
        if (feelerLeft.dist > feelerRight.dist) {
          steerDemand = Math.min(steerDemand + 0.5, 0.75)
        } else {
          steerDemand = Math.max(steerDemand - 0.5, -0.75)
        }
      }
    }

    // 4. Nitro Boost Logic (for Racers)
    if (this.role === 'RACER' && !this.isFinished) {
      this.nitroCooldown -= delta
      if (this.nitroTimer > 0) {
        this.nitroTimer -= delta
        this.isNitro = true
        targetSpeed = this.maxSpeed * 1.25
        if (this.nitroTimer <= 0) {
          this.isNitro = false
          this.nitroCooldown = 12.0 + Math.random() * 8.0 // recharge
        }
      } else if (this.nitroCooldown <= 0 && forwardDot > 0.95 && Math.abs(steerDemand) < 0.15 && !avoidanceBrake) {
        // Trigger Nitro on open straight!
        this.isNitro = true
        this.nitroTimer = 2.8
      }
    }

    // 5. Powertrain & Speed Integration
    if (avoidanceBrake || this.currentSpeed > targetSpeed) {
      // Decelerate / Brake
      this.currentSpeed = Math.max(0, this.currentSpeed - this.brakePower * delta)
    } else {
      // Accelerate
      const accelMultiplier = this.isNitro ? 1.6 : 1.0
      this.currentSpeed = Math.min(targetSpeed, this.currentSpeed + this.acceleration * accelMultiplier * delta)
    }

    // Smooth steering angle
    this.currentSteerAngle = THREE.MathUtils.lerp(
      this.currentSteerAngle,
      steerDemand,
      1 - Math.exp(-this.steerRate * delta)
    )

    // 6. Kinematic Movement & Heading Update
    // Yaw rate proportional to steer angle and speed
    const yawSpeedFactor = Math.min(Math.abs(this.currentSpeed) / 1.5, 1.0)
    const yawDelta = this.currentSteerAngle * 3.4 * yawSpeedFactor * delta
    this.root.rotateY(yawDelta)

    // Move forward along orientation
    const moveDist = this.currentSpeed * delta
    this.tempForward.set(0, 0, 1).applyQuaternion(this.root.quaternion)
    this.root.position.addScaledVector(this.tempForward, moveDist)

    // Resolve penetration with city buildings
    if (this.role === 'TRAFFIC') {
      const wasPushed = resolveCityObstaclePenetration(this.root.position, 1.3)
      if (wasPushed) {
        this.currentSpeed = Math.min(this.currentSpeed, 4.0)
      }
    }

    // 7. Visual Body Tilt (Pitch and Roll)
    const turnRoll = -this.currentSteerAngle * (this.currentSpeed / this.maxSpeed) * 0.08
    this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, turnRoll, 0.15)

    // 8. Wheel Steering & Rolling
    const wheelRadius = 0.435
    this.wheelSpinAngle += moveDist / wheelRadius

    if (this.wheelFrontLeft) {
      this.wheelFrontLeft.rotation.y = this.currentSteerAngle
      this.wheelFrontLeft.rotation.x = this.wheelSpinAngle
    }
    if (this.wheelFrontRight) {
      this.wheelFrontRight.rotation.y = this.currentSteerAngle
      this.wheelFrontRight.rotation.x = this.wheelSpinAngle
    }
    if (this.wheelBackLeft) {
      this.wheelBackLeft.rotation.x = this.wheelSpinAngle
    }
    if (this.wheelBackRight) {
      this.wheelBackRight.rotation.x = this.wheelSpinAngle
    }

    // 9. Exhaust Flames & Headlights
    this.flameVFX.setActive(this.isNitro)
    this.flameVFX.update(delta, this.isNitro ? 1.0 : 0.0)
    this.headlights.update(delta, avoidanceBrake, isNight)
  }

  public destroy() {
    this.scene.remove(this.root)
    this.flameVFX.dispose()
    this.headlights.dispose()
  }
}
