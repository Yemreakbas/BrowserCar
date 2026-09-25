import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { PlayerStateMessage } from '../../shared/src/messages.ts'

const REMOTE_CAR_COLORS = [
  0xef4444, // Vibrant Red
  0xf59e0b, // Amber Gold
  0x10b981, // Emerald Green
  0x8b5cf6, // Purple
  0x06b6d4, // Cyan
  0xec4899, // Pink
  0x3b82f6, // Royal Blue
  0xf97316, // Orange
]

function getPlayerColor(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  return REMOTE_CAR_COLORS[Math.abs(hash) % REMOTE_CAR_COLORS.length]
}

export class RemoteVehicle {
  public readonly playerId: string
  public playerName: string
  public readonly root: THREE.Group
  private scene: THREE.Scene

  // Car model and wheel nodes
  private carModel: THREE.Group | null = null
  private wheelFrontLeft: THREE.Object3D | null = null
  private wheelFrontRight: THREE.Object3D | null = null
  private wheelBackLeft: THREE.Object3D | null = null
  private wheelBackRight: THREE.Object3D | null = null
  private placeholderMesh: THREE.Group | null = null

  // Nameplate floating sprite
  private nameplateSprite: THREE.Sprite | null = null

  // Target telemetry for interpolation
  private targetPosition: THREE.Vector3
  private targetQuaternion: THREE.Quaternion
  private targetSpeed: number = 0
  private targetSteering: number = 0
  public isBraking: boolean = false
  public isDrifting: boolean = false
  private wheelSpinAngle: number = 0

  private carColor: number

  constructor(
    scene: THREE.Scene,
    playerId: string,
    playerName: string = 'Racer',
    initialPosition: [number, number, number] = [0, 0.45, 0],
    initialRotation: [number, number, number, number] = [0, 0, 0, 1]
  ) {
    this.scene = scene
    this.playerId = playerId
    this.playerName = playerName
    this.carColor = getPlayerColor(playerId)

    this.root = new THREE.Group()
    this.root.name = `RemoteVehicle_${playerId}`

    this.targetPosition = new THREE.Vector3(...initialPosition)
    this.targetQuaternion = new THREE.Quaternion(...initialRotation)

    this.root.position.copy(this.targetPosition)
    this.root.quaternion.copy(this.targetQuaternion)

    this.createPlaceholder()
    this.createNameplate()
    this.loadKenneyModel('/assets/cars/sedan-sports.glb')

    this.scene.add(this.root)
  }

  private createPlaceholder() {
    this.placeholderMesh = new THREE.Group()

    const bodyGeo = new THREE.BoxGeometry(1.8, 0.6, 3.6)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.carColor,
      roughness: 0.35,
      metalness: 0.3,
    })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = 0.55
    body.castShadow = true
    body.receiveShadow = true
    this.placeholderMesh.add(body)

    this.root.add(this.placeholderMesh)
  }

  private createNameplate() {
    const canvas = document.createElement('canvas')
    canvas.width = 384
    canvas.height = 96
    const ctx = canvas.getContext('2d')!

    // Draw background pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 24)
    ctx.fill()
    ctx.stroke()

    // Draw player name
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 36px "Segoe UI", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const displayName = this.playerName.length > 14 ? this.playerName.slice(0, 13) + '…' : this.playerName
    ctx.fillText(`${displayName}`, canvas.width / 2, 38)

    // Draw ID tag
    ctx.fillStyle = '#38bdf8'
    ctx.font = 'bold 22px monospace'
    ctx.fillText(`#${this.playerId}`, canvas.width / 2, 70)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })

    this.nameplateSprite = new THREE.Sprite(spriteMat)
    this.nameplateSprite.scale.set(2.8, 0.7, 1)
    this.nameplateSprite.position.set(0, 2.1, 0)
    this.root.add(this.nameplateSprite)
  }

  private loadKenneyModel(assetPath: string) {
    const loadingManager = new THREE.LoadingManager()
    loadingManager.setURLModifier(url => {
      if (url.includes('colormap.png')) {
        return '/assets/cars/Textures/colormap.png'
      }
      return url
    })
    const loader = new GLTFLoader(loadingManager)

    loader.load(
      assetPath,
      gltf => {
        if (this.placeholderMesh) {
          this.root.remove(this.placeholderMesh)
          this.placeholderMesh = null
        }

        this.carModel = gltf.scene
        this.carModel.name = `KenneySedanSports_${this.playerId}`

        const scale = 1.45
        this.carModel.scale.set(scale, scale, scale)
        this.carModel.position.set(0, 0.02, 0)

        this.carModel.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true
            child.receiveShadow = true

            const mesh = child as THREE.Mesh
            if (mesh.material) {
              const mat = (mesh.material as THREE.Material).clone() as THREE.MeshStandardMaterial
              mesh.material = mat

              // Subtle custom tint for the remote car body
              if (child.name === 'body') {
                mat.color.setHex(this.carColor)
                mat.roughness = 0.3
                mat.metalness = 0.2
              }
            }
          }

          if (child.name === 'wheel-front-left') {
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

        this.root.add(this.carModel)
      },
      undefined,
      err => {
        console.warn(`[RemoteVehicle] Error loading GLB for remote player ${this.playerId}:`, err)
      }
    )
  }

  /**
   * Receive new authoritative state snapshot and update target targets for interpolation.
   */
  public setTargetState(state: PlayerStateMessage) {
    this.targetPosition.set(state.position[0], state.position[1], state.position[2])
    this.targetQuaternion.set(state.rotation[0], state.rotation[1], state.rotation[2], state.rotation[3])
    this.targetSpeed = state.speed || 0
    this.targetSteering = state.steering || 0
    this.isBraking = !!state.isBraking
    this.isDrifting = !!state.isDrifting

    if (state.playerName && state.playerName !== this.playerName) {
      this.playerName = state.playerName
      if (this.nameplateSprite) {
        this.root.remove(this.nameplateSprite)
        this.createNameplate()
      }
    }
  }

  /**
   * Update remote vehicle position and wheels every frame using smooth interpolation.
   */
  public update(delta: number) {
    const dist = this.root.position.distanceTo(this.targetPosition)

    if (dist > 25) {
      // Teleport if too far away (e.g. spawn, mode reset)
      this.root.position.copy(this.targetPosition)
      this.root.quaternion.copy(this.targetQuaternion)
    } else {
      // Smooth lerp and slerp
      const lerpFactor = Math.min(1, delta * 14)
      this.root.position.lerp(this.targetPosition, lerpFactor)
      this.root.quaternion.slerp(this.targetQuaternion, lerpFactor)
    }

    // Animate wheels
    if (Math.abs(this.targetSpeed) > 0.1) {
      this.wheelSpinAngle += (this.targetSpeed / 3.6 / 0.35) * delta
    }

    if (this.wheelFrontLeft) {
      this.wheelFrontLeft.rotation.y = this.targetSteering
      this.wheelFrontLeft.rotation.x = this.wheelSpinAngle
    }
    if (this.wheelFrontRight) {
      this.wheelFrontRight.rotation.y = this.targetSteering
      this.wheelFrontRight.rotation.x = this.wheelSpinAngle
    }
    if (this.wheelBackLeft) {
      this.wheelBackLeft.rotation.x = this.wheelSpinAngle
    }
    if (this.wheelBackRight) {
      this.wheelBackRight.rotation.x = this.wheelSpinAngle
    }
  }

  public destroy() {
    this.scene.remove(this.root)
    this.root.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose())
        } else if (mesh.material) {
          mesh.material.dispose()
        }
      }
    })
  }
}
