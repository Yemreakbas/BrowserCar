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
    const mapLimit = 88.0
    const wallThickness = 1.0
    const wallHeight = 4.0

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
    console.log('✓ Rapier 3D Physics initialized successfully with city colliders')
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

  private createCityBlockColliders() {
    // 4 Main Quadrant Blocks: Centers (+-32, +-32), Size: 44m x 44m (halfExtent: 22m x 22m)
    // We add raised curb step colliders so the car hits the sidewalks
    const blockCenters = [
      { x: -32, z: 32 },  // NW
      { x: 32, z: 32 },   // NE
      { x: -32, z: -32 }, // SW
      { x: 32, z: -32 },  // SE
    ]

    // Raised sidewalk slab colliders (height 0.2m)
    blockCenters.forEach((center) => {
      this.createStaticBoxCollider(center.x, 0.1, center.z, 22.0, 0.1, 22.0, 0.6, 0.1)
    })

    // Major Building Obstacle Colliders (so car collides firmly with building facades)
    // Each block contains 4 primary building footprints (~10m x 10m each, halfExtent 5m x 5m, height 15m)
    const buildingObstacles = [
      // NW Block
      { x: -22, z: 22, hX: 5.5, hZ: 5.5 },
      { x: -22, z: 38, hX: 5.5, hZ: 5.5 },
      { x: -38, z: 22, hX: 5.5, hZ: 5.5 },
      { x: -38, z: 38, hX: 5.5, hZ: 5.5 },

      // NE Block
      { x: 22, z: 22, hX: 5.5, hZ: 5.5 },
      { x: 22, z: 38, hX: 5.5, hZ: 5.5 },
      { x: 38, z: 22, hX: 5.5, hZ: 5.5 },
      { x: 38, z: 38, hX: 5.5, hZ: 5.5 },

      // SW Block
      { x: -22, z: -22, hX: 5.5, hZ: 5.5 },
      { x: -22, z: -38, hX: 5.5, hZ: 5.5 },
      { x: -38, z: -22, hX: 5.5, hZ: 5.5 },
      { x: -38, z: -38, hX: 5.5, hZ: 5.5 },

      // SE Block
      { x: 22, z: -22, hX: 5.5, hZ: 5.5 },
      { x: 22, z: -38, hX: 5.5, hZ: 5.5 },
      { x: 38, z: -22, hX: 5.5, hZ: 5.5 },
      { x: 38, z: -38, hX: 5.5, hZ: 5.5 },
    ]

    buildingObstacles.forEach((b) => {
      this.createStaticBoxCollider(b.x, 7.5, b.z, b.hX, 7.5, b.hZ, 0.4, 0.2)
    })
  }

  public step() {
    if (!this.isInitialized) return
    this.world.step()
  }
}
