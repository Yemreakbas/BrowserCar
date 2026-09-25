import * as THREE from 'three'

interface SmokeParticle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  maxLife: number
  active: boolean
  baseScale: number
}

export class TireSmokeSystem {
  public group: THREE.Group
  private particles: SmokeParticle[] = []
  private maxParticles = 48
  private currentIndex = 0
  private geometry: THREE.BufferGeometry
  private material: THREE.MeshBasicMaterial

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    this.group.name = 'TireSmokeSystem'
    scene.add(this.group)

    this.geometry = new THREE.DodecahedronGeometry(0.24, 0)
    this.material = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    })

    // Pre-allocate pool
    for (let i = 0; i < this.maxParticles; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material.clone())
      mesh.visible = false
      mesh.matrixAutoUpdate = true
      this.group.add(mesh)

      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.55,
        active: false,
        baseScale: 0.35,
      })
    }
  }

  public emit(position: THREE.Vector3, carVelocity: THREE.Vector3): void {
    const p = this.particles[this.currentIndex]
    this.currentIndex = (this.currentIndex + 1) % this.maxParticles

    p.active = true
    p.life = 0
    p.maxLife = 0.45 + Math.random() * 0.2

    // Slight position jitter
    p.mesh.position.set(
      position.x + (Math.random() - 0.5) * 0.25,
      position.y + 0.1,
      position.z + (Math.random() - 0.5) * 0.25
    )

    // Drift smoke drifts slightly with vehicle momentum and rises upward
    p.velocity.set(
      carVelocity.x * 0.2 + (Math.random() - 0.5) * 0.8,
      0.6 + Math.random() * 0.5,
      carVelocity.z * 0.2 + (Math.random() - 0.5) * 0.8
    )

    p.baseScale = 0.35 + Math.random() * 0.2
    p.mesh.scale.setScalar(p.baseScale)
    ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.38
    p.mesh.visible = true
  }

  public update(delta: number): void {
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i]
      if (!p.active) continue

      p.life += delta
      if (p.life >= p.maxLife) {
        p.active = false
        p.mesh.visible = false
        continue
      }

      // Physics: rise and slow down
      p.mesh.position.x += p.velocity.x * delta
      p.mesh.position.y += p.velocity.y * delta
      p.mesh.position.z += p.velocity.z * delta
      p.velocity.multiplyScalar(Math.max(1 - delta * 3.5, 0))

      // Growth & fade out
      const progress = p.life / p.maxLife
      const currentScale = p.baseScale * (1.0 + progress * 2.8)
      p.mesh.scale.setScalar(currentScale)

      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = (1.0 - progress) * 0.4
    }
  }

  public reset(): void {
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i]
      p.active = false
      p.mesh.visible = false
    }
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible
    if (!visible) {
      this.reset()
    }
  }
}
