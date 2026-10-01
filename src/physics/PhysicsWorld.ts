import RAPIER from '@dimforge/rapier3d-compat'

export class PhysicsWorld {
  public world!: RAPIER.World
  public isInitialized: boolean = false
  public static RAPIER_INSTANCE: typeof RAPIER = RAPIER

  constructor() {}

  public async init(): Promise<void> {
    await RAPIER.init()

    // 1. Create Rapier Physics World with realistic gravity
    const gravity = { x: 0.0, y: -9.81, z: 0.0 }
    this.world = new RAPIER.World(gravity)

    // 2. Add Ground Plane Collider (thick static slab at y = 0)
    // Half extents: 250m x 1m x 250m, translated down 1m so top surface is exactly at y = 0
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(250, 1.0, 250)
      .setTranslation(0, -1.0, 0)
      .setFriction(0.8)
      .setRestitution(0.05)
    this.world.createCollider(groundColliderDesc)

    // Ground plane collider for RaceTrack (at Z = 600)
    const trackGroundDesc = RAPIER.ColliderDesc.cuboid(250, 1.0, 250)
      .setTranslation(0, -1.0, 600)
      .setFriction(0.85)
      .setRestitution(0.05)
    this.world.createCollider(trackGroundDesc)

    // 3. Add Outer Perimeter Safety Boundaries (prevents driving off world)
    const mapLimit = 145.0
    const wallThickness = 1.0
    const wallHeight = 5.0

    // North wall (Z = +mapLimit)
    this.createStaticBoxCollider(0, wallHeight / 2, mapLimit, mapLimit, wallHeight / 2, wallThickness)
    // South wall (Z = -mapLimit)
    this.createStaticBoxCollider(0, wallHeight / 2, -mapLimit, mapLimit, wallHeight / 2, wallThickness)
    // East wall (X = +mapLimit)
    this.createStaticBoxCollider(mapLimit, wallHeight / 2, 0, wallThickness, wallHeight / 2, mapLimit)
    // West wall (X = -mapLimit)
    this.createStaticBoxCollider(-mapLimit, wallHeight / 2, 0, wallThickness, wallHeight / 2, mapLimit)

    // 4. Add City Block Sidewalk and Building Obstacle Colliders
    this.createCityBlockColliders()

    this.isInitialized = true
    console.log('✓ Rapier 3D Physics initialized successfully with expanded metropolitan city colliders')
  }

  public createStaticBoxCollider(
    x: number,
    y: number,
    z: number,
    halfX: number,
    halfY: number,
    halfZ: number,
    friction: number = 0.5,
    restitution: number = 0.15
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
      .setTranslation(x, y, z)
      .setFriction(friction)
      .setRestitution(restitution)
    return this.world.createCollider(desc)
  }

  public createStaticRotatedBoxCollider(
    x: number,
    y: number,
    z: number,
    halfX: number,
    halfY: number,
    halfZ: number,
    rotationY: number,
    friction: number = 0.5,
    restitution: number = 0.15
  ): RAPIER.Collider {
    const halfRot = rotationY / 2
    const desc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(halfRot), z: 0, w: Math.cos(halfRot) })
      .setFriction(friction)
      .setRestitution(restitution)
    return this.world.createCollider(desc)
  }

  private createCityBlockColliders() {
    // 16 Full Metropolitan Quadrant Blocks: Centers (+-32, +-96), Size: 42m x 42m (halfExtent: 21m x 21m)
    const blockCenters = [
      // Central 4
      { x: -32, z: 32 },
      { x: 32, z: 32 },
      { x: -32, z: -32 },
      { x: 32, z: -32 },

      // North District (2)
      { x: -32, z: 96 },
      { x: 32, z: 96 },

      // South District (2)
      { x: -32, z: -96 },
      { x: 32, z: -96 },

      // East District (2)
      { x: 96, z: 32 },
      { x: 96, z: -32 },

      // West District (2)
      { x: -96, z: 32 },
      { x: -96, z: -32 },

      // Corners (4)
      { x: 96, z: 96 },
      { x: -96, z: 96 },
      { x: 96, z: -96 },
      { x: -96, z: -96 },
    ]

    // Raised sidewalk slab colliders (height 0.2m)
    blockCenters.forEach((center) => {
      this.createStaticBoxCollider(center.x, 0.1, center.z, 21.0, 0.1, 21.0, 0.6, 0.1)

      // 4 Main high-rise building colliders per block (~10m x 10m each, height 15m)
      const offsets = [
        { dx: -10, dz: -10 },
        { dx: 10, dz: -10 },
        { dx: -10, dz: 10 },
        { dx: 10, dz: 10 },
      ]
      offsets.forEach((off) => {
        this.createStaticBoxCollider(
          center.x + off.dx,
          7.5,
          center.z + off.dz,
          6.0,
          7.5,
          6.0,
          0.4,
          0.2
        )
      })
    })
  }

  public step() {
    if (!this.isInitialized) return
    this.world.step()
  }
}
