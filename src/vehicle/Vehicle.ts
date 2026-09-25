import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

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
  public readonly ACCELERATION: number = 16.0
  public readonly REVERSE_ACCEL: number = 10.0
  public readonly BRAKING_POWER: number = 26.0
  public readonly HANDBRAKE_POWER: number = 38.0
  public readonly DRAG: number = 5.5
  public readonly MAX_STEER_ANGLE: number = 0.50 // radians (~28.6 degrees)
  public readonly STEER_SPEED: number = 5.2
  public readonly TURN_RATE: number = 1.9
  public readonly WHEEL_RADIUS: number = 0.435 // Kenney wheel radius at 1.45 scale

  constructor(scene: THREE.Scene, onLoaded?: () => void) {
    this.root = new THREE.Group()
    this.root.name = 'PlayerVehicleRoot'
    this.root.position.set(0, 0, 0)
    scene.add(this.root)

    // Body group for suspension tilt (pitch and roll)
    this.bodyGroup = new THREE.Group()
    this.bodyGroup.name = 'VehicleBodyGroup'
    this.root.add(this.bodyGroup)

    // Temporary sleek placeholder until Kenney model finishes loading
    this.createPlaceholder()

    // Load real Kenney car model from public/assets/cars/sedan-sports.glb
    this.loadKenneyCar('/assets/cars/sedan-sports.glb', onLoaded)
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
    const loader = new GLTFLoader()

    loader.load(
      assetPath,
      (gltf) => {
        // Remove placeholder mesh
        if (this.placeholderMesh) {
          this.bodyGroup.remove(this.placeholderMesh)
          this.placeholderMesh = null
        }

        this.carModel = gltf.scene
        this.carModel.name = 'KenneySedanSports'

        // Scale Kenney car to match real-world sports sedan proportions (~3.7m x 2.1m)
        const scale = 1.45
        this.carModel.scale.set(scale, scale, scale)

        // Kenney models sit cleanly at y = 0
        this.carModel.position.set(0, 0.02, 0)

        // Enable shadows and locate wheel/body nodes
        this.carModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true
            child.receiveShadow = true

            // Optimize material rendering
            const mesh = child as THREE.Mesh
            if (mesh.material) {
              const mat = mesh.material as THREE.MeshStandardMaterial
              mat.roughness = Math.min(mat.roughness ?? 0.5, 0.7)
            }
          }

          // Locate articulated nodes
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
    // 1. Acceleration, Braking & Handbrake Dynamics
    if (keys.handbrake) {
      if (Math.abs(this.currentSpeed) < this.HANDBRAKE_POWER * delta) {
        this.currentSpeed = 0
      } else if (this.currentSpeed > 0) {
        this.currentSpeed -= this.HANDBRAKE_POWER * delta
      } else {
        this.currentSpeed += this.HANDBRAKE_POWER * delta
      }
    } else if (keys.forward) {
      if (this.currentSpeed < 0) {
        // Braking while reversing
        this.currentSpeed += this.BRAKING_POWER * delta
      } else {
        // Accelerating forward
        this.currentSpeed = Math.min(
          this.currentSpeed + this.ACCELERATION * delta,
          this.MAX_FORWARD_SPEED
        )
      }
    } else if (keys.backward) {
      if (this.currentSpeed > 0) {
        // Braking while moving forward
        this.currentSpeed = Math.max(
          this.currentSpeed - this.BRAKING_POWER * delta,
          0
        )
      } else {
        // Reversing
        this.currentSpeed = Math.max(
          this.currentSpeed - this.REVERSE_ACCEL * delta,
          this.MAX_REVERSE_SPEED
        )
      }
    } else {
      // Natural rolling friction & aerodynamic drag
      if (Math.abs(this.currentSpeed) < this.DRAG * delta) {
        this.currentSpeed = 0
      } else if (this.currentSpeed > 0) {
        this.currentSpeed -= this.DRAG * delta
      } else {
        this.currentSpeed += this.DRAG * delta
      }
    }

    // 2. Steering angle interpolation
    // A = Turn Left (+steer angle), D = Turn Right (-steer angle)
    let targetSteer = 0
    if (keys.left) targetSteer += 1.0
    if (keys.right) targetSteer -= 1.0

    this.currentSteerAngle = THREE.MathUtils.lerp(
      this.currentSteerAngle,
      targetSteer * this.MAX_STEER_ANGLE,
      1 - Math.exp(-this.STEER_SPEED * delta)
    )

    // 3. Vehicle Heading (Yaw) and Position Translation
    if (Math.abs(this.currentSpeed) > 0.05) {
      const speedFactor = Math.min(Math.abs(this.currentSpeed) / 5.0, 1.0)
      const directionSign = this.currentSpeed >= 0 ? 1 : -1

      // Yaw rotation: positive angle turns heading left (+X), negative turns right (-X)
      this.root.rotation.y +=
        this.currentSteerAngle * this.TURN_RATE * speedFactor * directionSign * delta
    }

    // Forward direction (+Z forward in car local coordinate space)
    const forwardVector = new THREE.Vector3(0, 0, 1).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.root.rotation.y
    )
    this.root.position.addScaledVector(forwardVector, this.currentSpeed * delta)

    // 4. Wheel Visual Steering and Rolling Animations
    const distanceTravelled = this.currentSpeed * delta
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

    // 5. Dynamic Suspension Pitch & Roll
    const speedRatio = Math.abs(this.currentSpeed) / this.MAX_FORWARD_SPEED
    const targetPitch =
      (keys.forward ? -0.04 : keys.backward ? 0.05 : 0) * speedRatio
    const targetRoll = this.currentSteerAngle * 0.07 * speedRatio

    if (this.bodyMesh) {
      this.bodyMesh.rotation.x = THREE.MathUtils.lerp(
        this.bodyMesh.rotation.x,
        targetPitch,
        0.18
      )
      this.bodyMesh.rotation.z = THREE.MathUtils.lerp(
        this.bodyMesh.rotation.z,
        targetRoll,
        0.18
      )
    } else {
      this.bodyGroup.rotation.x = THREE.MathUtils.lerp(
        this.bodyGroup.rotation.x,
        targetPitch,
        0.18
      )
      this.bodyGroup.rotation.z = THREE.MathUtils.lerp(
        this.bodyGroup.rotation.z,
        targetRoll,
        0.18
      )
    }
  }

  public reset(spawnPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0)) {
    this.currentSpeed = 0
    this.currentSteerAngle = 0
    this.wheelSpinAngle = 0
    this.root.position.copy(spawnPosition)
    this.root.rotation.set(0, 0, 0)
    this.bodyGroup.rotation.set(0, 0, 0)

    if (this.bodyMesh) {
      this.bodyMesh.rotation.set(0, 0, 0)
    }
    if (this.wheelFrontLeft) {
      this.wheelFrontLeft.rotation.set(0, 0, 0)
    }
    if (this.wheelFrontRight) {
      this.wheelFrontRight.rotation.set(0, 0, 0)
    }
    if (this.wheelBackLeft) {
      this.wheelBackLeft.rotation.set(0, 0, 0)
    }
    if (this.wheelBackRight) {
      this.wheelBackRight.rotation.set(0, 0, 0)
    }
  }

  public getSpeedKmh(): number {
    return Math.round(Math.abs(this.currentSpeed) * 3.6)
  }
}
