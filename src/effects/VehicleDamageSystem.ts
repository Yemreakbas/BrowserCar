import * as THREE from 'three'

interface SparkParticle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  maxLife: number
  active: boolean
}

interface SmokeFireParticle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  maxLife: number
  active: boolean
  baseScale: number
  isFlame: boolean
}

export class VehicleDamageSystem {
  public group: THREE.Group
  public health: number = 100.0
  public readonly maxHealth: number = 100.0
  public isWrecked: boolean = false

  // Deformable 3D Mesh references
  private bodyMesh: THREE.Mesh | null = null
  private originalPositions: Float32Array | null = null
  private isDeformed: boolean = false

  // Collision Spark VFX
  private sparksGroup: THREE.Group
  private sparks: SparkParticle[] = []
  private maxSparks = 48
  private currentSparkIdx = 0
  private sparkGeo: THREE.BufferGeometry
  private sparkMat: THREE.MeshBasicMaterial

  // Engine Hood Smoke & Fire VFX
  private smokeGroup: THREE.Group
  private smokeParticles: SmokeFireParticle[] = []
  private maxSmoke = 36
  private currentSmokeIdx = 0
  private smokeGeo: THREE.BufferGeometry
  private smokeMat: THREE.MeshBasicMaterial
  private flameMat: THREE.MeshBasicMaterial
  private smokeEmitTimer: number = 0

  // Callbacks
  public onHealthChanged?: (health: number, maxHealth: number) => void
  public onWrecked?: () => void
  public onRepaired?: () => void

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    this.group.name = 'VehicleDamageSystem'
    scene.add(this.group)

    // 1. Setup Spark Particles
    this.sparksGroup = new THREE.Group()
    this.sparksGroup.name = 'CollisionSparks'
    this.group.add(this.sparksGroup)

    this.sparkGeo = new THREE.DodecahedronGeometry(0.045, 0)
    this.sparkMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24, // Bright neon gold-yellow
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    for (let i = 0; i < this.maxSparks; i++) {
      const mesh = new THREE.Mesh(this.sparkGeo, this.sparkMat.clone())
      mesh.visible = false
      this.sparksGroup.add(mesh)
      this.sparks.push({
        mesh,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.35,
        active: false,
      })
    }

    // 2. Setup Engine Hood Smoke & Fire Particles
    this.smokeGroup = new THREE.Group()
    this.smokeGroup.name = 'EngineDamageSmoke'
    this.group.add(this.smokeGroup)

    this.smokeGeo = new THREE.DodecahedronGeometry(0.2, 0)
    this.smokeMat = new THREE.MeshBasicMaterial({
      color: 0x334155, // Slate dark smoke
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })
    this.flameMat = new THREE.MeshBasicMaterial({
      color: 0xf97316, // Vivid orange-red flame
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    for (let i = 0; i < this.maxSmoke; i++) {
      const mesh = new THREE.Mesh(this.smokeGeo, this.smokeMat.clone())
      mesh.visible = false
      this.smokeGroup.add(mesh)
      this.smokeParticles.push({
        mesh,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.6,
        active: false,
        baseScale: 0.25,
        isFlame: false,
      })
    }
  }

  /**
   * Attaches the vehicle's body mesh and stores its pristine baseline vertex coordinates
   */
  public attachBodyMesh(mesh: THREE.Mesh): void {
    this.bodyMesh = mesh
    if (mesh.geometry && mesh.geometry.attributes.position) {
      const posAttr = mesh.geometry.attributes.position
      this.originalPositions = new Float32Array(posAttr.array.length)
      this.originalPositions.set(posAttr.array)
      this.isDeformed = false
    }
  }

  /**
   * Applies an impact collision: calculates damage, deforms chassis vertices, and spawns spark spray
   */
  public applyCollision(
    impactSpeedKmh: number,
    localImpactPoint: THREE.Vector3,
    impactDirection: THREE.Vector3,
    worldImpactPos?: THREE.Vector3
  ): number {
    if (impactSpeedKmh < 12) return 0 // Ignore low speed taps

    // Damage scales with kinetic impact: speed drop over 12 km/h
    const rawDamage = Math.min((impactSpeedKmh - 10) * 1.35, 40)
    this.health = Math.max(0, this.health - rawDamage)

    // Deform chassis mesh vertices around impact point
    this.deformMesh(localImpactPoint, impactDirection, Math.min(rawDamage / 35, 1.0))

    // Spawn sparks at collision zone
    const sparkOrigin = worldImpactPos ?? localImpactPoint
    this.emitSparks(sparkOrigin, impactDirection, Math.min(Math.floor(impactSpeedKmh * 0.75), 32))

    if (this.onHealthChanged) {
      this.onHealthChanged(this.health, this.maxHealth)
    }

    if (this.health <= 0 && !this.isWrecked) {
      this.isWrecked = true
      if (this.onWrecked) {
        this.onWrecked()
      }
    }

    return rawDamage
  }

  /**
   * Procedural vertex denting: pushes nearby vertices inward along the impact vector
   */
  private deformMesh(localImpact: THREE.Vector3, direction: THREE.Vector3, strength: number): void {
    if (!this.bodyMesh || !this.bodyMesh.geometry || !this.bodyMesh.geometry.attributes.position) return

    const posAttr = this.bodyMesh.geometry.attributes.position
    const radius = 1.15 // Local radius around impact center
    let modified = false

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i)
      const vy = posAttr.getY(i)
      const vz = posAttr.getZ(i)

      const dx = vx - localImpact.x
      const dy = vy - localImpact.y
      const dz = vz - localImpact.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      if (dist < radius) {
        const falloff = Math.pow(1 - dist / radius, 1.8)
        const dentAmount = Math.min(strength * falloff * 0.28, 0.42)

        // Indent vertex inward with slight organic asymmetry
        posAttr.setXYZ(
          i,
          vx + direction.x * dentAmount + (Math.random() - 0.5) * 0.02,
          vy + direction.y * dentAmount * 0.5,
          vz + direction.z * dentAmount + (Math.random() - 0.5) * 0.02
        )
        modified = true
      }
    }

    if (modified) {
      posAttr.needsUpdate = true
      this.bodyMesh.geometry.computeVertexNormals()
      this.isDeformed = true
    }
  }

  /**
   * Emits bright fiery metal collision sparks
   */
  public emitSparks(origin: THREE.Vector3, normal: THREE.Vector3, count: number = 20): void {
    const num = Math.min(count, this.maxSparks)
    for (let i = 0; i < num; i++) {
      const p = this.sparks[this.currentSparkIdx]
      this.currentSparkIdx = (this.currentSparkIdx + 1) % this.maxSparks

      p.active = true
      p.life = 0
      p.maxLife = 0.22 + Math.random() * 0.18

      p.mesh.position.set(
        origin.x + (Math.random() - 0.5) * 0.15,
        Math.max(origin.y + (Math.random() - 0.5) * 0.15, 0.1),
        origin.z + (Math.random() - 0.5) * 0.15
      )

      // Cone spray away from impact normal
      const speed = 7.0 + Math.random() * 11.0
      p.velocity.set(
        normal.x * speed * 0.6 + (Math.random() - 0.5) * 6.0,
        Math.abs(normal.y) * speed * 0.4 + 2.5 + Math.random() * 4.5,
        normal.z * speed * 0.6 + (Math.random() - 0.5) * 6.0
      )

      ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95
      p.mesh.scale.setScalar(0.7 + Math.random() * 0.6)
      p.mesh.visible = true
    }
  }

  /**
   * Emits engine hood smoke or fire puffs
   */
  private emitHoodSmoke(hoodPos: THREE.Vector3, carVel: THREE.Vector3, isSevere: boolean, isFire: boolean): void {
    const p = this.smokeParticles[this.currentSmokeIdx]
    this.currentSmokeIdx = (this.currentSmokeIdx + 1) % this.maxSmoke

    p.active = true
    p.life = 0
    p.maxLife = isFire ? 0.35 + Math.random() * 0.15 : 0.55 + Math.random() * 0.25
    p.isFlame = isFire

    p.mesh.position.set(
      hoodPos.x + (Math.random() - 0.5) * 0.3,
      hoodPos.y + 0.15,
      hoodPos.z + (Math.random() - 0.5) * 0.3
    )

    // Smoke billows up and drifts backward with car speed
    p.velocity.set(
      carVel.x * 0.2 + (Math.random() - 0.5) * 0.8,
      1.4 + Math.random() * 1.2,
      carVel.z * 0.2 + (Math.random() - 0.5) * 0.8
    )

    p.baseScale = isFire ? 0.22 + Math.random() * 0.15 : 0.32 + Math.random() * 0.2
    p.mesh.scale.setScalar(p.baseScale)

    const mat = p.mesh.material as THREE.MeshBasicMaterial
    if (isFire) {
      mat.color.setHex(Math.random() > 0.4 ? 0xf97316 : 0xef4444)
      mat.opacity = 0.85
    } else if (isSevere) {
      mat.color.setHex(0x1e293b) // Pitch black smoke
      mat.opacity = 0.65
    } else {
      mat.color.setHex(0x94a3b8) // Light grey radiator steam
      mat.opacity = 0.35
    }

    p.mesh.visible = true
  }

  /**
   * Updates sparks physics, hood smoke emission, and particle lifetimes
   */
  public update(delta: number, carPos: THREE.Vector3, carVel: THREE.Vector3, forwardDir: THREE.Vector3): void {
    // 1. Update Sparks
    for (let i = 0; i < this.maxSparks; i++) {
      const p = this.sparks[i]
      if (!p.active) continue

      p.life += delta
      if (p.life >= p.maxLife) {
        p.active = false
        p.mesh.visible = false
        continue
      }

      // Gravity & air drag
      p.velocity.y -= 22.0 * delta
      p.velocity.x *= Math.max(1 - delta * 3.0, 0)
      p.velocity.z *= Math.max(1 - delta * 3.0, 0)

      p.mesh.position.x += p.velocity.x * delta
      p.mesh.position.y += p.velocity.y * delta
      p.mesh.position.z += p.velocity.z * delta

      // Ground bounce
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05
        p.velocity.y = -p.velocity.y * 0.4
      }

      const progress = p.life / p.maxLife
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = (1 - progress) * 0.95
    }

    // 2. Engine Hood Smoke & Fire Emission
    if (this.health < 65) {
      this.smokeEmitTimer += delta
      const isCritical = this.health < 30
      const isFire = this.health <= 0
      const emitRate = isFire ? 0.04 : isCritical ? 0.07 : 0.14

      if (this.smokeEmitTimer >= emitRate) {
        this.smokeEmitTimer = 0
        // Compute engine hood location in front of car
        const hoodPos = new THREE.Vector3(
          carPos.x + forwardDir.x * 1.25,
          carPos.y + 0.45,
          carPos.z + forwardDir.z * 1.25
        )
        this.emitHoodSmoke(hoodPos, carVel, isCritical, isFire)
      }
    }

    // 3. Update Smoke Particles
    for (let i = 0; i < this.maxSmoke; i++) {
      const p = this.smokeParticles[i]
      if (!p.active) continue

      p.life += delta
      if (p.life >= p.maxLife) {
        p.active = false
        p.mesh.visible = false
        continue
      }

      p.mesh.position.x += p.velocity.x * delta
      p.mesh.position.y += p.velocity.y * delta
      p.mesh.position.z += p.velocity.z * delta
      p.velocity.multiplyScalar(Math.max(1 - delta * 2.5, 0))

      const progress = p.life / p.maxLife
      const currentScale = p.baseScale * (1.0 + progress * 2.4)
      p.mesh.scale.setScalar(currentScale)

      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = (1.0 - progress) * (p.isFlame ? 0.8 : 0.45)
    }
  }

  /**
   * Fully repairs vehicle health, restores factory chassis mesh geometry, and stops smoke/sparks
   */
  public repair(): void {
    this.health = this.maxHealth
    this.isWrecked = false

    // Restore original pristine vertex buffer
    if (this.bodyMesh && this.originalPositions && this.bodyMesh.geometry.attributes.position) {
      const posAttr = this.bodyMesh.geometry.attributes.position
      posAttr.array.set(this.originalPositions)
      posAttr.needsUpdate = true
      this.bodyMesh.geometry.computeVertexNormals()
      this.isDeformed = false
    }

    // Extinguish all active smoke and sparks
    for (const s of this.sparks) {
      s.active = false
      s.mesh.visible = false
    }
    for (const sm of this.smokeParticles) {
      sm.active = false
      sm.mesh.visible = false
    }

    if (this.onHealthChanged) {
      this.onHealthChanged(this.health, this.maxHealth)
    }
    if (this.onRepaired) {
      this.onRepaired()
    }
  }

  /**
   * Returns powertrain efficiency multiplier based on damage condition
   */
  public getEngineMultiplier(): number {
    if (this.health <= 0) return 0.08 // Limp mode: barely rolls forward to allow respawn
    if (this.health < 25) return 0.72 // Heavily damaged engine
    if (this.health < 50) return 0.88 // Light engine power degradation
    return 1.0
  }

  public getHealth(): number {
    return this.health
  }

  public dispose(): void {
    this.repair()
    if (this.group.parent) {
      this.group.parent.remove(this.group)
    }
    this.sparkGeo.dispose()
    this.sparkMat.dispose()
    this.smokeGeo.dispose()
    this.smokeMat.dispose()
    this.flameMat.dispose()
    for (const p of this.sparks) {
      if (p.mesh.material) (p.mesh.material as THREE.Material).dispose()
    }
    for (const sm of this.smokeParticles) {
      if (sm.mesh.material) (sm.mesh.material as THREE.Material).dispose()
    }
  }
}
