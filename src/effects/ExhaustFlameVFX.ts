import * as THREE from 'three'

interface FlameSpark {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  maxLife: number
  active: boolean
}

/**
 * ExhaustFlameVFX renders dual high-speed electric-blue nitro flames,
 * flickering core cones, neon road illumination, and jet spark particles (Phase 31).
 */
export class ExhaustFlameVFX {
  public group: THREE.Group
  private flameCones: THREE.Mesh[] = []
  private coreCones: THREE.Mesh[] = []
  private nitroLight: THREE.PointLight | null = null
  private sparks: FlameSpark[] = []
  private maxSparks = 24
  private sparkIndex = 0

  private outerMaterial: THREE.MeshBasicMaterial
  private coreMaterial: THREE.MeshBasicMaterial
  private sparkMaterial: THREE.MeshBasicMaterial

  private time: number = 0
  private isActive: boolean = false
  public enableLight: boolean

  // Exhaust nozzle offsets relative to car chassis center (Sedan & Sports models)
  private nozzleOffsets: THREE.Vector3[] = [
    new THREE.Vector3(-0.42, 0.22, -1.8), // Left pipe
    new THREE.Vector3(0.42, 0.22, -1.8),  // Right pipe
  ]

  constructor(parent: THREE.Object3D, enableLight: boolean = true) {
    this.enableLight = enableLight
    this.group = new THREE.Group()
    this.group.name = 'ExhaustFlameVFX'
    parent.add(this.group)

    // 1. Materials with Additive Blending for neon glow
    this.outerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00d4ff, // Vibrant Cyan / Electric Blue
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    this.coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, // White-hot intense core
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    this.sparkMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    // 2. Dual Flame Cone Meshes (Cone tip pointing backward)
    const flameGeo = new THREE.ConeGeometry(0.14, 0.95, 12, 1, true)
    flameGeo.rotateX(-Math.PI / 2) // Point along -Z (rear of car)
    flameGeo.translate(0, 0, -0.47)

    const coreGeo = new THREE.ConeGeometry(0.07, 0.55, 8, 1, true)
    coreGeo.rotateX(-Math.PI / 2)
    coreGeo.translate(0, 0, -0.27)

    for (const offset of this.nozzleOffsets) {
      const outerMesh = new THREE.Mesh(flameGeo, this.outerMaterial)
      outerMesh.position.copy(offset)
      outerMesh.visible = false
      this.group.add(outerMesh)
      this.flameCones.push(outerMesh)

      const innerMesh = new THREE.Mesh(coreGeo, this.coreMaterial)
      innerMesh.position.copy(offset)
      innerMesh.visible = false
      this.group.add(innerMesh)
      this.coreCones.push(innerMesh)
    }

    // 3. Ground Glow Light (Illuminates asphalt and smoke behind the car - Player only)
    if (this.enableLight) {
      this.nitroLight = new THREE.PointLight(0x00f0ff, 0, 5.5, 2.0)
      this.nitroLight.position.set(0, 0.35, -1.9)
      this.nitroLight.visible = false
      this.group.add(this.nitroLight)
    }

    // 4. Spark Particles
    const sparkGeo = new THREE.SphereGeometry(0.045, 6, 6)
    for (let i = 0; i < this.maxSparks; i++) {
      const sparkMesh = new THREE.Mesh(sparkGeo, this.sparkMaterial)
      sparkMesh.visible = false
      this.group.add(sparkMesh)
      this.sparks.push({
        mesh: sparkMesh,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.25,
        active: false,
      })
    }
  }

  public setActive(active: boolean): void {
    if (this.isActive === active) return
    this.isActive = active

    for (const mesh of this.flameCones) {
      mesh.visible = active
    }
    for (const mesh of this.coreCones) {
      mesh.visible = active
    }

    if (this.nitroLight) {
      this.nitroLight.visible = active
      if (!active) {
        this.nitroLight.intensity = 0
      }
    }

    if (!active) {
      for (const spark of this.sparks) {
        spark.active = false
        spark.mesh.visible = false
      }
    }
  }

  public getIsActive(): boolean {
    return this.isActive
  }

  public update(delta: number, intensity: number = 1.0): void {
    this.time += delta * 45.0

    if (this.isActive) {
      // Dynamic high-frequency jitter for realistic roaring flame tongues
      const flicker1 = Math.sin(this.time) * 0.15 + Math.cos(this.time * 2.3) * 0.1
      const flicker2 = Math.cos(this.time * 1.7) * 0.12
      const baseScaleZ = 1.0 + flicker1
      const baseScaleXY = 1.0 + flicker2

      for (let i = 0; i < this.flameCones.length; i++) {
        const outer = this.flameCones[i]
        const inner = this.coreCones[i]

        outer.scale.set(baseScaleXY * intensity, baseScaleXY * intensity, baseScaleZ * intensity)
        inner.scale.set(baseScaleXY * 0.9 * intensity, baseScaleXY * 0.9 * intensity, baseScaleZ * 1.1 * intensity)
      }

      // Neon ground illumination pulse (only when enabled and active)
      if (this.nitroLight) {
        this.nitroLight.intensity = (2.4 + Math.sin(this.time * 1.5) * 0.6) * intensity
      }

      // Emit sparks from random nozzle
      if (Math.random() < 0.65) {
        const nozzle = this.nozzleOffsets[Math.floor(Math.random() * this.nozzleOffsets.length)]
        const s = this.sparks[this.sparkIndex]
        this.sparkIndex = (this.sparkIndex + 1) % this.maxSparks

        s.active = true
        s.life = 0
        s.maxLife = 0.15 + Math.random() * 0.15
        s.mesh.position.set(
          nozzle.x + (Math.random() - 0.5) * 0.08,
          nozzle.y + (Math.random() - 0.5) * 0.08,
          nozzle.z - 0.3
        )
        s.velocity.set(
          (Math.random() - 0.5) * 1.8,
          (Math.random() - 0.5) * 1.2,
          -12.0 - Math.random() * 8.0 // High speed backward jet
        )
        s.mesh.visible = true
      }
    }

    // Update active sparks
    for (let i = 0; i < this.maxSparks; i++) {
      const s = this.sparks[i]
      if (!s.active) continue

      s.life += delta
      if (s.life >= s.maxLife) {
        s.active = false
        s.mesh.visible = false
        continue
      }

      s.mesh.position.addScaledVector(s.velocity, delta)
      const ratio = 1.0 - s.life / s.maxLife
      s.mesh.scale.setScalar(Math.max(ratio, 0.1))
    }
  }

  public setNozzleOffsets(offsets: THREE.Vector3[]): void {
    if (!offsets || offsets.length === 0) return
    this.nozzleOffsets = offsets
    for (let i = 0; i < this.flameCones.length && i < offsets.length; i++) {
      this.flameCones[i].position.copy(offsets[i])
      this.coreCones[i].position.copy(offsets[i])
    }
  }

  public dispose(): void {
    this.setActive(false)
    this.outerMaterial.dispose()
    this.coreMaterial.dispose()
    this.sparkMaterial.dispose()
    this.flameCones.forEach((m) => m.geometry.dispose())
    this.coreCones.forEach((m) => m.geometry.dispose())
    this.sparks.forEach((s) => s.mesh.geometry.dispose())
    if (this.nitroLight && this.nitroLight.parent) {
      this.nitroLight.parent.remove(this.nitroLight)
    }
    if (this.group.parent) {
      this.group.parent.remove(this.group)
    }
  }
}
