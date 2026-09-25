import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PhysicsWorld } from '../physics/PhysicsWorld.ts'
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

  // Vehicle Tuning
  public readonly MAX_FORWARD_SPEED: number = 28.0 // ~101 km/h
  public readonly MAX_REVERSE_SPEED: number = -11.0 // ~40 km/h
  public readonly ACCELERATION: number = 18.0
  public readonly REVERSE_ACCEL: number = 10.0
  public readonly BRAKING_POWER: number = 28.0
  public readonly HANDBRAKE_POWER: number = 42.0
  public readonly DRAG: number = 4.5
  public readonly MAX_STEER_ANGLE: number = 0.50 // radians (~28.6 degrees)
  public readonly STEER_SPEED: number = 5.5
  public readonly TURN_RATE: number = 2.0
  public readonly WHEEL_RADIUS: number = 0.435 // Kenney wheel radius at 1.45 scale

  constructor(scene: THREE.Scene, physicsWorld: PhysicsWorld, onLoaded?: () => void) {
    this.physicsWorld = physicsWorld
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
    // lockRotations(true, false, true) locks Pitch (X) and Roll (Z) on the physics body
    // This gives complete stability (car never flips onto roof on collision) while Yaw (Y) turns freely
    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(0, 0.45, 0)
      .setLinearDamping(0.6)
      .enabledRotations(false, true, false)

    this.rigidBody = this.physicsWorld.world.createRigidBody(bodyDesc)

    // Cuboid collider matching the 3.7m x 2.0m x 1.2m sports sedan chassis
    const halfWidth = 0.95
    const halfHeight = 0.38
    const halfLength = 1.75
    const colliderDesc = rapier.ColliderDesc.cuboid(halfWidth, halfHeight, halfLength)
      .setFriction(0.4)
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

    // 2. Compute Direction Vectors
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion)
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.root.quaternion)

    // 3. Decompose Linear Velocity into Forward & Lateral
    const linvel = this.rigidBody.linvel()
    const forwardSpeed = linvel.x * forward.x + linvel.z * forward.z
    const lateralSpeed = linvel.x * right.x + linvel.z * right.z
    this.currentSpeed = forwardSpeed

    // 4. Lateral Grip (Cancels sideways sliding so vehicle tracks its wheels cleanly)
    const gripDamping = Math.min(delta * 22.0, 0.94)
    let newLinvelX = linvel.x - right.x * lateralSpeed * gripDamping
    let newLinvelZ = linvel.z - right.z * lateralSpeed * gripDamping

    // 5. Longitudinal Acceleration, Braking & Friction
    let impulse = 0
    if (keys.handbrake) {
      // Handbrake: strong deceleration
      const brakeImpulse = Math.min(delta * this.HANDBRAKE_POWER, Math.abs(forwardSpeed)) * Math.sign(forwardSpeed)
      impulse -= brakeImpulse
    } else if (keys.forward) {
      if (forwardSpeed < 0) {
        // Braking while in reverse
        impulse += this.BRAKING_POWER * delta
      } else if (forwardSpeed < this.MAX_FORWARD_SPEED) {
        // Accelerating forward
        impulse += this.ACCELERATION * delta
      }
    } else if (keys.backward) {
      if (forwardSpeed > 0.4) {
        // Foot brake while moving forward
        impulse -= this.BRAKING_POWER * delta
      } else if (forwardSpeed > this.MAX_REVERSE_SPEED) {
        // Reversing
        impulse -= this.REVERSE_ACCEL * delta
      }
    } else {
      // Coasting drag
      const dragAmount = Math.min(delta * this.DRAG, Math.abs(forwardSpeed)) * Math.sign(forwardSpeed)
      impulse -= dragAmount
    }

    newLinvelX += forward.x * impulse
    newLinvelZ += forward.z * impulse

    // Apply updated velocity (preserving Rapier gravity on Y)
    this.rigidBody.setLinvel({ x: newLinvelX, y: linvel.y, z: newLinvelZ }, true)

    // 6. Steering Interpolation & Yaw Angular Velocity
    let targetSteer = 0
    if (keys.left) targetSteer += 1.0  // A / Left -> positive steer angle (steer left)
    if (keys.right) targetSteer -= 1.0 // D / Right -> negative steer angle (steer right)

    this.currentSteerAngle = THREE.MathUtils.lerp(
      this.currentSteerAngle,
      targetSteer * this.MAX_STEER_ANGLE,
      1 - Math.exp(-this.STEER_SPEED * delta)
    )

    if (Math.abs(forwardSpeed) > 0.1) {
      const speedFactor = Math.min(Math.abs(forwardSpeed) / 5.0, 1.0)
      const directionSign = forwardSpeed >= 0 ? 1 : -1
      const targetAngVel = this.currentSteerAngle * this.TURN_RATE * speedFactor * directionSign
      this.rigidBody.setAngvel({ x: 0, y: targetAngVel, z: 0 }, true)
    } else {
      this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }

    // 7. Visual Wheel Steering and Rolling Animations
    const distanceTravelled = forwardSpeed * delta
    this.wheelSpinAngle += distanceTravelled / this.WHEEL_RADIUS

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

    // 8. Dynamic Suspension Pitch & Roll on Body Mesh
    const speedRatio = Math.abs(forwardSpeed) / this.MAX_FORWARD_SPEED
    const targetPitch = (keys.forward ? -0.04 : keys.backward ? 0.05 : 0) * speedRatio
    const targetRoll = this.currentSteerAngle * 0.07 * speedRatio

    if (this.bodyMesh) {
      this.bodyMesh.rotation.x = THREE.MathUtils.lerp(this.bodyMesh.rotation.x, targetPitch, 0.18)
      this.bodyMesh.rotation.z = THREE.MathUtils.lerp(this.bodyMesh.rotation.z, targetRoll, 0.18)
    } else {
      this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, targetPitch, 0.18)
      this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, targetRoll, 0.18)
    }
  }

  public reset(spawnX: number = 0, spawnZ: number = 0) {
    if (!this.rigidBody) return

    this.currentSpeed = 0
    this.currentSteerAngle = 0
    this.wheelSpinAngle = 0

    // Reset physics body state
    this.rigidBody.setTranslation({ x: spawnX, y: 0.45, z: spawnZ }, true)
    this.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)

    // Reset Three.js transforms
    this.root.position.set(spawnX, 0.02, spawnZ)
    this.root.rotation.set(0, 0, 0)
    this.bodyGroup.rotation.set(0, 0, 0)

    if (this.bodyMesh) this.bodyMesh.rotation.set(0, 0, 0)
    if (this.wheelFrontLeft) this.wheelFrontLeft.rotation.set(0, 0, 0)
    if (this.wheelFrontRight) this.wheelFrontRight.rotation.set(0, 0, 0)
    if (this.wheelBackLeft) this.wheelBackLeft.rotation.set(0, 0, 0)
    if (this.wheelBackRight) this.wheelBackRight.rotation.set(0, 0, 0)
  }

  public getSpeedKmh(): number {
    return Math.round(Math.abs(this.currentSpeed) * 3.6)
  }
}
