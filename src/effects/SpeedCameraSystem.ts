import * as THREE from 'three'
import type { Vehicle } from '../vehicle/Vehicle.ts'
import type { PoliceChaseSystem } from './PoliceChaseSystem.ts'
import type { AudioManager } from '../audio/AudioManager.ts'

export interface SpeedCameraLocation {
  id: string
  name: string
  position: THREE.Vector3
  speedLimitKmh: number
  triggerRadius: number
  cooldownTimer: number
}

/**
 * Speed Camera / Radar Trap System for City Free Roam.
 * Detects vehicles exceeding the speed limit at key metropolitan boulevards,
 * triggers high-intensity camera flashes, audio alerts, and Police Heat increases.
 */
export class SpeedCameraSystem {
  public group: THREE.Group
  private cameras: SpeedCameraLocation[] = [
    {
      id: 'cam_north',
      name: 'Kuzey Bulvarı Radarı',
      position: new THREE.Vector3(0, 0, 75),
      speedLimitKmh: 95,
      triggerRadius: 18.0,
      cooldownTimer: 0,
    },
    {
      id: 'cam_central',
      name: 'Downtown Merkez Radarı',
      position: new THREE.Vector3(75, 0, 0),
      speedLimitKmh: 90,
      triggerRadius: 18.0,
      cooldownTimer: 0,
    },
    {
      id: 'cam_south',
      name: 'Güney Sahil Yolu Radarı',
      position: new THREE.Vector3(-75, 0, -50),
      speedLimitKmh: 100,
      triggerRadius: 18.0,
      cooldownTimer: 0,
    },
  ]

  public onSpeedViolation?: (speedKmh: number, limitKmh: number, locationName: string) => void

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    this.group.name = 'SpeedCamerasGroup'
    scene.add(this.group)

    this.initCameraMeshes()
  }

  private initCameraMeshes(): void {
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.14, 5.0, 8)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 })

    const boxGeo = new THREE.BoxGeometry(0.7, 0.45, 0.6)
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.5, roughness: 0.2 })

    const lensGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.2, 16)
    lensGeo.rotateX(Math.PI / 2)
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1 })

    const flashGeo = new THREE.PlaneGeometry(0.35, 0.25)
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff })

    this.cameras.forEach((cam) => {
      const root = new THREE.Group()
      // Place by the side of the road
      root.position.copy(cam.position)
      root.position.x += 10.5

      const pole = new THREE.Mesh(poleGeo, poleMat)
      pole.position.y = 2.5
      root.add(pole)

      const box = new THREE.Mesh(boxGeo, boxMat)
      box.position.set(0, 4.8, 0)
      root.add(box)

      const lens = new THREE.Mesh(lensGeo, lensMat)
      lens.position.set(-0.35, 4.8, 0)
      root.add(lens)

      const flash = new THREE.Mesh(flashGeo, flashMat)
      flash.position.set(-0.36, 4.8, 0)
      flash.rotation.y = -Math.PI / 2
      root.add(flash)

      this.group.add(root)
    })
  }

  /**
   * Evaluates speed trap crossings
   */
  public update(
    delta: number,
    vehicle: Vehicle,
    policeChase?: PoliceChaseSystem,
    audioManager?: AudioManager
  ): void {
    if (!vehicle.root) return
    const carPos = vehicle.root.position
    const speedKmh = Math.round(Math.abs(vehicle.currentSpeed * 3.6))

    for (const cam of this.cameras) {
      if (cam.cooldownTimer > 0) {
        cam.cooldownTimer -= delta
        continue
      }

      const dist = carPos.distanceTo(cam.position)
      if (dist < cam.triggerRadius && speedKmh > cam.speedLimitKmh) {
        // TRIGGER SPEED TRAP!
        cam.cooldownTimer = 7.0 // 7-second cooldown per camera

        if (audioManager) {
          audioManager.playSpeedCameraFlash()
        }

        if (policeChase) {
          policeChase.addHeatScore(30)
        }

        if (this.onSpeedViolation) {
          this.onSpeedViolation(speedKmh, cam.speedLimitKmh, cam.name)
        }
        break
      }
    }
  }
}
