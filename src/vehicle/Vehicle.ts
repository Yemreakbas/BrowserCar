import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PhysicsWorld } from '../physics/PhysicsWorld.ts'
import { DEFAULT_VEHICLE_CONFIG, type VehicleConfig } from './VehicleConfig.ts'
import type RAPIER from '@dimforge/rapier3d-compat'

export interface VehicleInput {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  handbrake: boolean
}

export class Vehicle {
  public root: THREE.Group
  public bodyGroup: THREE.Group
  public isLoaded: boolean = false
  public loadError: string | null = null

  // Centralized Vehicle Tuning Configuration
  public config: VehicleConfig

  // Rapier Physics references
  public rigidBody!: RAPIER.RigidBody
  public collider!: RAPIER.Collider
  private physicsWorld: PhysicsWorld

  // Kenney model node references
  private carModel: THREE.Group | null = null
  private bodyMesh: THREE.Object3D | null = null
  private wheelFrontLeft: THREE.Object3D | null = null
  private wheelFrontRight: THREE.Object3D | null = null
  private wheelBackLeft: THREE.Object3D | null = null
  private wheelBackRight: THREE.Object3D | null = null

  // Fallback placeholder while model loads
  private placeholderMesh: THREE.Group | null = null

  // Dynamics & State
  public currentSpeed: number = 0
  public currentSteerAngle: number = 0
  private wheelSpinAngle: number = 0
  private currentTraction: number = 0.94

  // Drift State & Slip Telemetry (Phase 9)
  public isDrifting: boolean = false
  public isHandbrakeActive: boolean = false
  public slipAngle: number = 0 // Slip angle in radians
  public slipAngleDeg: number = 0 // Slip angle in degrees
  public driftDuration: number = 0 // Seconds continuously drifting
  public currentLateralSpeed: number = 0

  constructor(
    scene: THREE.Scene,
    physicsWorld: PhysicsWorld,
    customConfig?: Partial<VehicleConfig>,
    onLoaded?: () => void
  ) {
    this.physicsWorld = physicsWorld
    this.config = { ...DEFAULT_VEHICLE_CONFIG, ...customConfig }

    this.root = new THREE.Group()
    this.root.name = 'PlayerVehicleRoot'
    this.root.position.set(0, 0, 0)
    scene.add(this.root)

    // Body group for suspension tilt (pitch and roll)
    this.bodyGroup = new THREE.Group()
    this.bodyGroup.name = 'VehicleBodyGroup'
    this.root.add(this.bodyGroup)

    // Temporary placeholder until Kenney model finishes loading
    this.createPlaceholder()

    // 1. Initialize Rapier Rigid Body and Chassis Collider
    this.setupPhysicsBody()

    // 2. Load real Kenney car model from public/assets/cars/sedan-sports.glb
    this.loadKenneyCar('/assets/cars/sedan-sports.glb', onLoaded)
  }

  private setupPhysicsBody() {
    const rapier = PhysicsWorld.RAPIER_INSTANCE

    // Dynamic rigid body positioned at car center of mass (y = 0.45)
    // enabledRotations(false, true, false) locks Pitch (X) and Roll (Z) on the physics body
    // This gives rock-solid stability while Yaw (Y) turns and drifts freely
    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(0, 0.45, 0)
      .setLinearDamping(0.08)
      .enabledRotations(false, true, false)

    this.rigidBody = this.physicsWorld.world.createRigidBody(bodyDesc)

    // Cuboid collider matching the 3.7m x 2.0m x 1.2m sports sedan chassis
    const halfWidth = 0.95
    const halfHeight = 0.38
    const halfLength = 1.75
    const colliderDesc = rapier.ColliderDesc.cuboid(halfWidth, halfHeight, halfLength)
      .setFriction(0.05)
      .setRestitution(0.12)

    this.collider = this.physicsWorld.world.createCollider(colliderDesc, this.rigidBody)
  }

  private createPlaceholder() {
    this.placeholderMesh = new THREE.Group()

    const bodyGeo = new THREE.BoxGeometry(1.8, 0.6, 3.6)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.4,
      metalness: 0.3,
    })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = 0.55
    body.castShadow = true
    body.receiveShadow = true
    this.placeholderMesh.add(body)

    this.bodyGroup.add(this.placeholderMesh)
  }

  private loadKenneyCar(assetPath: string, onLoaded?: () => void) {
    const loadingManager = new THREE.LoadingManager()
    loadingManager.setURLModifier((url) => {
      if (url.includes('colormap.png')) {
        return '/assets/cars/Textures/colormap.png'
      }
      return url
    })
    const loader = new GLTFLoader(loadingManager)

    loader.load(
      assetPath,
      (gltf) => {
        if (this.placeholderMesh) {
          this.bodyGroup.remove(this.placeholderMesh)
          this.placeholderMesh = null
        }

        this.carModel = gltf.scene
        this.carModel.name = 'KenneySedanSports'

        // Scale Kenney car to match real-world sports sedan proportions (~3.7m x 2.1m)
        const scale = 1.45
        this.carModel.scale.set(scale, scale, scale)
        this.carModel.position.set(0, 0.02, 0)

        // Enable shadows and locate wheel/body nodes
        this.carModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true
            child.receiveShadow = true

            const mesh = child as THREE.Mesh
            if (mesh.material) {
              const mat = mesh.material as THREE.MeshStandardMaterial
              mat.roughness = Math.min(mat.roughness ?? 0.5, 0.7)
            }
          }

          if (child.name === 'body') {
            this.bodyMesh = child
          } else if (child.name === 'wheel-front-left') {
            this.wheelFrontLeft = child
            this.wheelFrontLeft.rotation.order = 'YXZ'
          } else if (child.name === 'wheel-front-right') {
            this.wheelFrontRight = child
            this.wheelFrontRight.rotation.order = 'YXZ'
          } else if (child.name === 'wheel-back-left') {
            this.wheelBackLeft = child
          } else if (child.name === 'wheel-back-right') {
            this.wheelBackRight = child
          }
        })

        this.bodyGroup.add(this.carModel)
        this.isLoaded = true
        console.log('✓ Kenney vehicle model successfully loaded:', assetPath)

        if (onLoaded) {
          onLoaded()
        }
      },
      undefined,
      (error) => {
        this.loadError = `Failed to load car asset: ${assetPath}`
        console.error('Error loading Kenney vehicle asset from', assetPath, error)
      }
    )
  }

  public update(delta: number, keys: VehicleInput) {
    if (!this.rigidBody) return

    // 1. Sync Three.js Root Object from Rapier RigidBody
    const trans = this.rigidBody.translation()
    const rot = this.rigidBody.rotation()

    // Height offset: rigidBody center of mass is at 0.45, so y - 0.43 places tires on ground
    this.root.position.set(trans.x, trans.y - 0.43, trans.z)
    this.root.quaternion.set(rot.x, rot.y, rot.z, rot.w)

    // 2. Compute Forward and Right vectors from car heading
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion)
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.root.quaternion)

    // 3. Decompose Linear Velocity into Forward & Lateral
    const linvel = this.rigidBody.linvel()
    const forwardSpeed = linvel.x * forward.x + linvel.z * forward.z
    const lateralSpeed = linvel.x * right.x + linvel.z * right.z
    this.currentSpeed = forwardSpeed
    this.currentLateralSpeed = lateralSpeed
    this.isHandbrakeActive = keys.handbrake

    // Slip Angle Calculation (Arcade Drift Slip Detection)
    const absForward = Math.abs(forwardSpeed)
    const absLateral = Math.abs(lateralSpeed)
    this.slipAngle = absForward > 0.3 ? Math.atan2(absLateral, absForward) : 0
    this.slipAngleDeg = (this.slipAngle * 180) / Math.PI

    // Drift Detection Criteria
    // Requires sufficient forward velocity to prevent stationary spinning
    const hasDriftSpeed = absForward >= this.config.driftMinSpeed
    const isUnderHandbrake = keys.handbrake && hasDriftSpeed && (keys.left || keys.right || this.slipAngleDeg >= 6.0)
    const isAngleSustained = this.slipAngleDeg >= this.config.driftMinAngleDeg && hasDriftSpeed
    const isNotSpunOut = this.slipAngleDeg <= this.config.driftMaxAngleDeg

    if ((isUnderHandbrake || isAngleSustained) && isNotSpunOut) {
      this.isDrifting = true
      this.driftDuration += delta
    } else {
      this.isDrifting = false
      this.driftDuration = 0
    }

    // 4. Configurable Traction & Dynamic Drift Dynamics
    // Under active drift or handbrake, lateral grip drops immediately to allow smooth, controllable slides
    const targetTraction = keys.handbrake
      ? Math.min(this.config.lateralGripDrift, 0.18)
      : this.isDrifting
      ? this.config.lateralGripDrift
      : this.config.lateralGripNormal

    const gripLerpRate = (this.isDrifting || keys.handbrake) ? 14.0 : this.config.driftGripRecoverySpeed
    this.currentTraction = THREE.MathUtils.lerp(
      this.currentTraction,
      targetTraction,
      1 - Math.exp(-gripLerpRate * delta)
    )

    const lateralDamping = Math.min(delta * 22.0 * this.currentTraction, 0.94)
    let newLinvelX = linvel.x - right.x * lateralSpeed * lateralDamping
    let newLinvelZ = linvel.z - right.z * lateralSpeed * lateralDamping

    // 5. Powertrain Dynamics (Throttle, Reverse, Foot Brake & Handbrake)
    let impulse = 0

    if (keys.forward) {
      if (forwardSpeed < -0.2) {
        // Foot brake while moving backwards
        impulse += this.config.brakingPower * delta
      } else if (forwardSpeed < this.config.maxForwardSpeed) {
        if (this.isDrifting || keys.handbrake) {
          // Power-slide throttle: delivers continuous drive thrust to power through corners
          impulse += this.config.baseAcceleration * 0.92 * delta
        } else {
          // Progressive acceleration curve: strong low-end torque tapering smoothly near top speed
          const speedRatio = Math.min(Math.max(forwardSpeed / this.config.maxForwardSpeed, 0), 1)
          const torqueFactor =
            Math.pow(1 - speedRatio, this.config.accelerationCurvePower) * 0.75 + 0.25
          impulse += this.config.baseAcceleration * torqueFactor * delta
        }
      }
    } else if (keys.backward) {
      if (forwardSpeed > 0.3) {
        // Foot brake while moving forward
        impulse -= this.config.brakingPower * delta
      } else if (forwardSpeed > this.config.maxReverseSpeed) {
        // Fast, responsive reversing with strong initial torque punch
        const revRatio = Math.min(Math.abs(forwardSpeed) / Math.abs(this.config.maxReverseSpeed), 1.0)
        const revTorque = Math.pow(1.0 - revRatio, 0.7) * 0.7 + 0.3
        impulse -= this.config.reverseAcceleration * revTorque * delta
      }
    } else {
      // Natural rolling drag & aerodynamic coasting friction
      const dragAmount =
        Math.min(delta * this.config.coastingDrag, absForward) *
        Math.sign(forwardSpeed)
      impulse -= dragAmount
    }

    // Handbrake deceleration: gently decelerates without killing slide momentum
    // If player is also pressing throttle (power-sliding), handbrake drag is even lighter
    if (keys.handbrake) {
      const effectiveHBrakePower = keys.forward ? 1.5 : this.config.handbrakePower
      const brakeImpulse =
        Math.min(delta * effectiveHBrakePower, absForward) *
        Math.sign(forwardSpeed)
      impulse -= brakeImpulse
    }

    newLinvelX += forward.x * impulse
    newLinvelZ += forward.z * impulse

    // Apply updated linear velocity (preserving natural Rapier gravity on Y)
    this.rigidBody.setLinvel({ x: newLinvelX, y: linvel.y, z: newLinvelZ }, true)

    // 6. Speed-Sensitive Steering
    // At low speeds, full steering angle is available for sharp 90-degree city turns.
    // At high speeds, sensitivity scales down smoothly to prevent high-speed twitching.
    const speedRatio = absForward / this.config.steeringSpeedDropoff
    const speedSteerSensitivity = Math.max(
      1.0 / (1.0 + speedRatio),
      this.config.minSteerSensitivity
    )
    const effectiveMaxSteer = this.config.maxSteerAngle * speedSteerSensitivity

    let targetSteer = 0
    if (keys.left) targetSteer += 1.0  // A / Left -> turn left
    if (keys.right) targetSteer -= 1.0 // D / Right -> turn right

    // Dynamic steering response: rapid wheel turn, snappy return to center
    const steerRate =
      targetSteer !== 0
        ? this.config.steerResponseSpeed
        : this.config.steerReturnSpeed

    this.currentSteerAngle = THREE.MathUtils.lerp(
      this.currentSteerAngle,
      targetSteer * effectiveMaxSteer,
      1 - Math.exp(-steerRate * delta)
    )

    // Apply Yaw Angular Velocity
    if (absForward > 0.08) {
      const speedThreshold = forwardSpeed >= 0 ? 4.8 : 2.5
      const speedFactor = Math.min(absForward / speedThreshold, 1.0)
      const directionSign = forwardSpeed >= 0 ? 1 : -1

      // Drift yaw boost to enhance oversteer and counter-steer control during slides
      let driftMultiplier = 1.0
      if (this.isDrifting) {
        driftMultiplier = this.config.driftYawMultiplier
      } else if (keys.handbrake && absForward > 1.8 && (keys.left || keys.right)) {
        // Immediate turn-in oversteer kick when pulling handbrake into a corner
        driftMultiplier = 1.65
      }

      const targetAngVel =
        this.currentSteerAngle *
        this.config.baseTurnRate *
        speedFactor *
        directionSign *
        driftMultiplier
      this.rigidBody.setAngvel({ x: 0, y: targetAngVel, z: 0 }, true)
    } else {
      this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }

    // 7. Wheel Steering & Rolling Animations
    const distanceTravelled = forwardSpeed * delta
    this.wheelSpinAngle += distanceTravelled / this.config.wheelRadius

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

    // 8. Mild Body Roll & Suspension Pitch
    // G-forces: acceleration creates pitch squat/dive, lateral cornering creates centrifugal roll
    const accelG = delta > 0 ? (impulse / delta) / 9.81 : 0
    const targetPitch = THREE.MathUtils.clamp(
      -accelG * 0.022,
      -this.config.suspensionPitchMax,
      this.config.suspensionPitchMax
    )

    const corneringRatio = (this.currentSteerAngle * forwardSpeed) / this.config.maxForwardSpeed
    const targetRoll = THREE.MathUtils.clamp(
      corneringRatio * this.config.suspensionRollMax * 1.6,
      -this.config.suspensionRollMax,
      this.config.suspensionRollMax
    )

    if (this.bodyMesh) {
      this.bodyMesh.rotation.x = THREE.MathUtils.lerp(
        this.bodyMesh.rotation.x,
        targetPitch,
        this.config.suspensionSmoothing
      )
      this.bodyMesh.rotation.z = THREE.MathUtils.lerp(
        this.bodyMesh.rotation.z,
        targetRoll,
        this.config.suspensionSmoothing
      )
    } else {
      this.bodyGroup.rotation.x = THREE.MathUtils.lerp(
        this.bodyGroup.rotation.x,
        targetPitch,
        this.config.suspensionSmoothing
      )
      this.bodyGroup.rotation.z = THREE.MathUtils.lerp(
        this.bodyGroup.rotation.z,
        targetRoll,
        this.config.suspensionSmoothing
      )
    }
  }

  public reset(spawnX: number = 0, spawnZ: number = 0, rotationY: number = 0, spawnY: number = 0.45) {
    if (!this.rigidBody) return

    this.currentSpeed = 0
    this.currentSteerAngle = 0
    this.wheelSpinAngle = 0
    this.currentTraction = this.config.lateralGripNormal

    // Reset drift telemetry
    this.isDrifting = false
    this.isHandbrakeActive = false
    this.slipAngle = 0
    this.slipAngleDeg = 0
    this.driftDuration = 0
    this.currentLateralSpeed = 0

    const halfRot = rotationY / 2
    const qY = Math.sin(halfRot)
    const qW = Math.cos(halfRot)

    const yPos = Math.max(0.45, spawnY)

    // Reset physics body state
    this.rigidBody.setTranslation({ x: spawnX, y: yPos, z: spawnZ }, true)
    this.rigidBody.setRotation({ x: 0, y: qY, z: 0, w: qW }, true)
    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)

    // Reset Three.js transforms
    this.root.position.set(spawnX, yPos - 0.43, spawnZ)
    this.root.rotation.set(0, rotationY, 0)
    this.bodyGroup.rotation.set(0, 0, 0)

    if (this.bodyMesh) this.bodyMesh.rotation.set(0, 0, 0)
    if (this.wheelFrontLeft) this.wheelFrontLeft.rotation.set(0, 0, 0)
    if (this.wheelFrontRight) this.wheelFrontRight.rotation.set(0, 0, 0)
    if (this.wheelBackLeft) this.wheelBackLeft.rotation.set(0, 0, 0)
    if (this.wheelBackRight) this.wheelBackRight.rotation.set(0, 0, 0)
  }

  /**
   * Reconcile local vehicle state from authoritative server correction (Phase 14).
   */
  public reconcile(
    position: [number, number, number],
    rotation: [number, number, number, number],
    velocity?: [number, number, number]
  ): void {
    if (!this.rigidBody) return

    this.rigidBody.setTranslation({ x: position[0], y: position[1], z: position[2] }, true)
    this.rigidBody.setRotation(
      { x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] },
      true
    )

    if (velocity) {
      this.rigidBody.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true)
    }

    this.root.position.set(position[0], position[1], position[2])
    this.root.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3])
  }

  public getSpeedKmh(): number {
    return Math.round(Math.abs(this.currentSpeed) * 3.6)
  }

  public getRearWheelPositions(leftOut: THREE.Vector3, rightOut: THREE.Vector3): void {
    if (this.wheelBackLeft && this.wheelBackRight) {
      this.wheelBackLeft.getWorldPosition(leftOut)
      this.wheelBackRight.getWorldPosition(rightOut)
    } else {
      const offsetL = new THREE.Vector3(-0.75, 0.15, -1.15).applyQuaternion(this.root.quaternion)
      leftOut.copy(this.root.position).add(offsetL)
      const offsetR = new THREE.Vector3(0.75, 0.15, -1.15).applyQuaternion(this.root.quaternion)
      rightOut.copy(this.root.position).add(offsetR)
    }
  }
}
