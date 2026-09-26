import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PhysicsWorld } from '../physics/PhysicsWorld.ts'

export interface SpawnLocation {
  id: string
  name: string
  position: THREE.Vector3
  rotationY: number
}

export class CityWorld {
  public group: THREE.Group
  private loader: GLTFLoader
  private modelCache: Map<string, THREE.Group> = new Map()
  public isLoaded: boolean = false
  private physicsWorld?: PhysicsWorld

  // Road grid dimensions
  private readonly BLOCK_SIZE = 44.0
  private readonly BLOCK_OFFSET = 32.0 // Center coordinate of quadrant blocks

  // Available Spawn Points
  public readonly spawnLocations: SpawnLocation[] = [
    {
      id: 'start-line',
      name: 'Başlangıç Çizgisi (Güney Bulvarı)',
      position: new THREE.Vector3(0, 0, -25),
      rotationY: 0,
    },
    {
      id: 'downtown-plaza',
      name: 'Gökdelen Meydanı (Kuzeydoğu)',
      position: new THREE.Vector3(45, 0, 45),
      rotationY: -Math.PI / 2,
    },
    {
      id: 'slalom-strip',
      name: 'Slalom Parkuru (Doğu Caddesi)',
      position: new THREE.Vector3(64, 0, -55),
      rotationY: 0,
    },
    {
      id: 'west-district',
      name: 'Ticaret Bölgesi (Batı Caddesi)',
      position: new THREE.Vector3(-45, 0, 0),
      rotationY: Math.PI / 2,
    },
  ]

  /**
   * Find the closest spawn point to a given coordinate for intelligent respawn.
   */
  public getNearestSpawnLocation(pos: THREE.Vector3): SpawnLocation {
    let nearest = this.spawnLocations[0]
    let minDistSq = Infinity
    for (const loc of this.spawnLocations) {
      const dx = loc.position.x - pos.x
      const dz = loc.position.z - pos.z
      const distSq = dx * dx + dz * dz
      if (distSq < minDistSq) {
        minDistSq = distSq
        nearest = loc
      }
    }
    return nearest
  }

  // Shared Geometries and Materials for Trees & Props (Reused for Performance)
  private sharedMaterials = {
    trunk: new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.9, metalness: 0.05 }),
    foliageLight: new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      roughness: 0.7,
      flatShading: true,
    }),
    foliageDark: new THREE.MeshStandardMaterial({
      color: 0x15803d,
      roughness: 0.75,
      flatShading: true,
    }),
    barrierMetal: new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.75,
      roughness: 0.28,
    }),
    barrierPost: new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.6,
      roughness: 0.4,
    }),
    woodBench: new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.8 }),
    hydrantRed: new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4, metalness: 0.2 }),
  }

  private sharedGeometries = {
    trunk: new THREE.CylinderGeometry(0.22, 0.36, 2.4, 7),
    foliageMain: new THREE.DodecahedronGeometry(1.35, 0),
    foliageSecondary: new THREE.DodecahedronGeometry(0.95, 0),
    barrierRail: new THREE.BoxGeometry(4.2, 0.42, 0.12),
    barrierPost: new THREE.CylinderGeometry(0.08, 0.08, 0.75, 6),
    benchSeat: new THREE.BoxGeometry(2.0, 0.12, 0.6),
    benchLeg: new THREE.BoxGeometry(0.1, 0.4, 0.55),
    hydrantBody: new THREE.CylinderGeometry(0.18, 0.22, 0.8, 8),
    hydrantCap: new THREE.SphereGeometry(0.2, 8, 6),
  }

  constructor(scene: THREE.Scene, physicsWorld?: PhysicsWorld, onReady?: () => void) {
    this.physicsWorld = physicsWorld
    this.group = new THREE.Group()
    this.group.name = 'CityWorldGroup'
    scene.add(this.group)

    const loadingManager = new THREE.LoadingManager()
    loadingManager.setURLModifier((url) => {
      if (url.includes('colormap.png')) {
        return '/assets/cars/Textures/colormap.png'
      }
      return url
    })
    this.loader = new GLTFLoader(loadingManager)

    // 1. Build road networks, sidewalks, and markings
    this.createRoadNetwork()
    this.createSidewalks()
    this.createRoadMarkings()
    this.createStreetFurniture()

    // 2. Build Trees, Urban Props & Crash Barriers (Phase 6 Map Elements)
    this.createTreesAndParks()
    this.createCrashBarriers()
    this.createUrbanProps()

    // 3. Preload Kenney GLTF assets and populate city blocks
    this.loadAssetsAndPopulate(onReady)
  }

  // --- 1. ROAD NETWORK & PAVEMENT ---
  private createRoadNetwork() {
    const groundGeo = new THREE.PlaneGeometry(500, 500)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1a221a, // Dark muted grass
      roughness: 0.95,
      metalness: 0.05,
    })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    ground.matrixAutoUpdate = false
    ground.updateMatrix()
    this.group.add(ground)

    // Main Asphalt Grid
    const tarmacSize = 190
    const tarmacGeo = new THREE.PlaneGeometry(tarmacSize, tarmacSize)
    const tarmacMat = new THREE.MeshStandardMaterial({
      color: 0x181a1f, // Rich dark asphalt
      roughness: 0.82,
      metalness: 0.15,
    })
    const tarmac = new THREE.Mesh(tarmacGeo, tarmacMat)
    tarmac.rotation.x = -Math.PI / 2
    tarmac.position.y = 0.0
    tarmac.receiveShadow = true
    tarmac.matrixAutoUpdate = false
    tarmac.updateMatrix()
    this.group.add(tarmac)
  }

  // --- 2. RAISED SIDEWALKS ---
  private createSidewalks() {
    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      roughness: 0.75,
      metalness: 0.1,
    })

    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x4b5563,
      roughness: 0.8,
    })

    const blockCenters = [
      { x: -this.BLOCK_OFFSET, z: this.BLOCK_OFFSET },  // NW
      { x: this.BLOCK_OFFSET, z: this.BLOCK_OFFSET },   // NE
      { x: -this.BLOCK_OFFSET, z: -this.BLOCK_OFFSET }, // SW
      { x: this.BLOCK_OFFSET, z: -this.BLOCK_OFFSET },  // SE
    ]

    const sidewalkHeight = 0.18
    const sidewalkSize = this.BLOCK_SIZE

    blockCenters.forEach((center) => {
      const slabGeo = new THREE.BoxGeometry(sidewalkSize, sidewalkHeight, sidewalkSize)
      const slab = new THREE.Mesh(slabGeo, sidewalkMat)
      slab.position.set(center.x, sidewalkHeight / 2, center.z)
      slab.receiveShadow = true
      slab.matrixAutoUpdate = false
      slab.updateMatrix()
      this.group.add(slab)

      const curbBorderGeo = new THREE.BoxGeometry(sidewalkSize + 0.3, sidewalkHeight * 0.9, sidewalkSize + 0.3)
      const curbBorder = new THREE.Mesh(curbBorderGeo, curbMat)
      curbBorder.position.set(center.x, sidewalkHeight * 0.45, center.z)
      curbBorder.receiveShadow = true
      curbBorder.matrixAutoUpdate = false
      curbBorder.updateMatrix()
      this.group.add(curbBorder)
    })
  }

  // --- 3. PAINTED ROAD MARKINGS ---
  private createRoadMarkings() {
    const whiteMarkingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    const yellowMarkingMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })

    const markingsGroup = new THREE.Group()
    markingsGroup.position.y = 0.015

    // Double Yellow Center Lines on Central Avenues
    const yellowLineGeo = new THREE.PlaneGeometry(0.18, 54)
    yellowLineGeo.rotateX(-Math.PI / 2)

    const addYellowPair = (x: number, z: number, horizontal: boolean) => {
      const g = new THREE.Group()
      g.position.set(x, 0, z)
      if (horizontal) g.rotation.y = Math.PI / 2

      const line1 = new THREE.Mesh(yellowLineGeo, yellowMarkingMat)
      line1.position.x = -0.16
      const line2 = new THREE.Mesh(yellowLineGeo, yellowMarkingMat)
      line2.position.x = 0.16
      g.add(line1, line2)
      markingsGroup.add(g)
    }

    addYellowPair(0, 42, false)  // NS North
    addYellowPair(0, -42, false) // NS South
    addYellowPair(-42, 0, true)  // EW West
    addYellowPair(42, 0, true)   // EW East

    // Dashed White Lane Lines
    const dashGeo = new THREE.PlaneGeometry(0.22, 2.5)
    dashGeo.rotateX(-Math.PI / 2)

    for (let z = 16; z <= 68; z += 5.5) {
      const dashLeft = new THREE.Mesh(dashGeo, whiteMarkingMat)
      dashLeft.position.set(-4.0, 0, z)
      const dashRight = new THREE.Mesh(dashGeo, whiteMarkingMat)
      dashRight.position.set(4.0, 0, z)
      const dashLeftS = new THREE.Mesh(dashGeo, whiteMarkingMat)
      dashLeftS.position.set(-4.0, 0, -z)
      const dashRightS = new THREE.Mesh(dashGeo, whiteMarkingMat)
      dashRightS.position.set(4.0, 0, -z)
      markingsGroup.add(dashLeft, dashRight, dashLeftS, dashRightS)
    }

    // Pedestrian Crosswalks
    const stripeGeo = new THREE.PlaneGeometry(0.7, 3.2)
    stripeGeo.rotateX(-Math.PI / 2)

    const addZebraCrosswalk = (posX: number, posZ: number, horizontal: boolean) => {
      const crossGroup = new THREE.Group()
      crossGroup.position.set(posX, 0, posZ)
      if (horizontal) crossGroup.rotation.y = Math.PI / 2

      for (let i = -6; i <= 6; i += 1.2) {
        const stripe = new THREE.Mesh(stripeGeo, whiteMarkingMat)
        stripe.position.set(i, 0, 0)
        crossGroup.add(stripe)
      }
      markingsGroup.add(crossGroup)
    }

    addZebraCrosswalk(0, 10.5, false)
    addZebraCrosswalk(0, -10.5, false)
    addZebraCrosswalk(10.5, 0, true)
    addZebraCrosswalk(-10.5, 0, true)

    // Checkered Start / Finish Line
    const checkerGeo = new THREE.PlaneGeometry(0.7, 0.7)
    checkerGeo.rotateX(-Math.PI / 2)
    const checkDarkMat = new THREE.MeshBasicMaterial({ color: 0x111111 })

    for (let x = -6.5; x <= 6.5; x += 0.7) {
      for (let row = 0; row < 2; row++) {
        const isWhite = (Math.round((x + 6.5) / 0.7) + row) % 2 === 0
        const tile = new THREE.Mesh(checkerGeo, isWhite ? whiteMarkingMat : checkDarkMat)
        tile.position.set(x, 0, -25.0 + row * 0.7)
        markingsGroup.add(tile)
      }
    }

    markingsGroup.matrixAutoUpdate = false
    markingsGroup.updateMatrix()
    this.group.add(markingsGroup)
  }

  // --- 4. STREET LAMPS & LIGHTING ---
  private createStreetFurniture() {
    const lampGroup = new THREE.Group()

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 })
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff4d6,
      emissive: 0xffe89e,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    })

    const lampPositions = [
      { x: -9.5, z: 9.5 },
      { x: 9.5, z: 9.5 },
      { x: -9.5, z: -9.5 },
      { x: 9.5, z: -9.5 },
      { x: -9.5, z: 35 },
      { x: 9.5, z: 35 },
      { x: -9.5, z: -35 },
      { x: 9.5, z: -35 },
      { x: 35, z: 9.5 },
      { x: -35, z: 9.5 },
      { x: 35, z: -9.5 },
      { x: -35, z: -9.5 },
    ]

    lampPositions.forEach((pos) => {
      const lamp = new THREE.Group()
      lamp.position.set(pos.x, 0.18, pos.z)

      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 5.2, 8), poleMat)
      post.position.y = 2.6
      lamp.add(post)

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.1), poleMat)
      arm.position.set(pos.x > 0 ? -0.4 : 0.4, 5.1, 0)
      lamp.add(arm)

      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bulbMat)
      bulb.position.set(pos.x > 0 ? -0.75 : 0.75, 4.95, 0)
      lamp.add(bulb)

      lamp.matrixAutoUpdate = false
      lamp.updateMatrix()
      lampGroup.add(lamp)
    })

    lampGroup.matrixAutoUpdate = false
    lampGroup.updateMatrix()
    this.group.add(lampGroup)
  }

  // --- 5. TREES & URBAN LANDSCAPING (Phase 6) ---
  private createTreesAndParks() {
    const treeGroup = new THREE.Group()
    treeGroup.name = 'CityTreesGroup'

    const treeLocations = [
      // Sidewalk avenue tree alignments
      { x: -9.5, z: 20 },
      { x: -9.5, z: 50 },
      { x: 9.5, z: 20 },
      { x: 9.5, z: 50 },
      { x: -9.5, z: -20 },
      { x: -9.5, z: -50 },
      { x: 9.5, z: -20 },
      { x: 9.5, z: -50 },

      // East-West Avenue trees
      { x: 20, z: 9.5 },
      { x: 50, z: 9.5 },
      { x: -20, z: 9.5 },
      { x: -50, z: 9.5 },
      { x: 20, z: -9.5 },
      { x: 50, z: -9.5 },
      { x: -20, z: -9.5 },
      { x: -50, z: -9.5 },

      // Urban Park Pocket (South-East Block Plaza)
      { x: 28, z: -28 },
      { x: 36, z: -28 },
      { x: 28, z: -36 },
    ]

    treeLocations.forEach((loc, idx) => {
      const tree = new THREE.Group()
      tree.position.set(loc.x, 0.18, loc.z)

      // Trunk
      const trunk = new THREE.Mesh(this.sharedGeometries.trunk, this.sharedMaterials.trunk)
      trunk.position.y = 1.2
      tree.add(trunk)

      // Main foliage canopy
      const isDark = idx % 2 === 0
      const foliageMat = isDark ? this.sharedMaterials.foliageDark : this.sharedMaterials.foliageLight
      const foliage = new THREE.Mesh(this.sharedGeometries.foliageMain, foliageMat)
      foliage.position.y = 2.6
      tree.add(foliage)

      // Secondary top foliage sphere for rich stylized low-poly volume
      const foliageTop = new THREE.Mesh(this.sharedGeometries.foliageSecondary, foliageMat)
      foliageTop.position.set(0.2, 3.4, -0.1)
      tree.add(foliageTop)

      tree.matrixAutoUpdate = false
      tree.updateMatrix()
      treeGroup.add(tree)

      // Register Rapier obstacle collider for solid tree trunk
      if (this.physicsWorld) {
        this.physicsWorld.createStaticBoxCollider(loc.x, 1.2, loc.z, 0.45, 1.2, 0.45, 0.6, 0.1)
      }
    })

    treeGroup.matrixAutoUpdate = false
    treeGroup.updateMatrix()
    this.group.add(treeGroup)
  }

  // --- 6. CRASH BARRIERS & GUARDRAILS (Phase 6) ---
  private createCrashBarriers() {
    const barrierGroup = new THREE.Group()
    barrierGroup.name = 'CityCrashBarriers'

    const barrierLines = [
      // Outer North Perimeter Barriers (Z = 84)
      { x: -30, z: 84, rot: 0, length: 40 },
      { x: 30, z: 84, rot: 0, length: 40 },

      // Outer South Perimeter Barriers (Z = -84)
      { x: -30, z: -84, rot: 0, length: 40 },
      { x: 30, z: -84, rot: 0, length: 40 },

      // Outer East Road Buffer (X = 84)
      { x: 84, z: 0, rot: Math.PI / 2, length: 60 },

      // Outer West Road Buffer (X = -84)
      { x: -84, z: 0, rot: Math.PI / 2, length: 60 },

      // Slalom course boundary guardrails on East Avenue
      { x: 74, z: 0, rot: Math.PI / 2, length: 80 },
    ]

    barrierLines.forEach((line) => {
      const segmentCount = Math.floor(line.length / 4.0)
      for (let i = 0; i < segmentCount; i++) {
        const offset = (i - (segmentCount - 1) / 2) * 4.0
        const posX = line.rot === 0 ? line.x + offset : line.x
        const posZ = line.rot === 0 ? line.z : line.z + offset

        const barrierMesh = new THREE.Mesh(this.sharedGeometries.barrierRail, this.sharedMaterials.barrierMetal)
        barrierMesh.position.set(posX, 0.42, posZ)
        barrierMesh.rotation.y = line.rot
        barrierGroup.add(barrierMesh)

        // Support posts
        const post1 = new THREE.Mesh(this.sharedGeometries.barrierPost, this.sharedMaterials.barrierPost)
        post1.position.set(posX - 1.8, 0.38, posZ)
        const post2 = new THREE.Mesh(this.sharedGeometries.barrierPost, this.sharedMaterials.barrierPost)
        post2.position.set(posX + 1.8, 0.38, posZ)
        barrierGroup.add(post1, post2)

        // Solid physical collider
        if (this.physicsWorld) {
          const halfX = line.rot === 0 ? 2.1 : 0.15
          const halfZ = line.rot === 0 ? 0.15 : 2.1
          this.physicsWorld.createStaticBoxCollider(posX, 0.4, posZ, halfX, 0.4, halfZ, 0.5, 0.25)
        }
      }
    })

    barrierGroup.matrixAutoUpdate = false
    barrierGroup.updateMatrix()
    this.group.add(barrierGroup)
  }

  // --- 7. URBAN PROPS: BENCHES & HYDRANTS (Phase 6) ---
  private createUrbanProps() {
    const propsGroup = new THREE.Group()

    // Benches along sidewalks near trees
    const benchLocations = [
      { x: -10.5, z: 23, rot: Math.PI / 2 },
      { x: -10.5, z: 47, rot: Math.PI / 2 },
      { x: 10.5, z: 23, rot: -Math.PI / 2 },
      { x: 10.5, z: 47, rot: -Math.PI / 2 },
      { x: 32, z: -25, rot: 0 },
    ]

    benchLocations.forEach((loc) => {
      const bench = new THREE.Group()
      bench.position.set(loc.x, 0.18, loc.z)
      bench.rotation.y = loc.rot

      const seat = new THREE.Mesh(this.sharedGeometries.benchSeat, this.sharedMaterials.woodBench)
      seat.position.y = 0.35
      const leg1 = new THREE.Mesh(this.sharedGeometries.benchLeg, this.sharedMaterials.barrierPost)
      leg1.position.set(-0.85, 0.2, 0)
      const leg2 = new THREE.Mesh(this.sharedGeometries.benchLeg, this.sharedMaterials.barrierPost)
      leg2.position.set(0.85, 0.2, 0)

      bench.add(seat, leg1, leg2)
      bench.matrixAutoUpdate = false
      bench.updateMatrix()
      propsGroup.add(bench)
    })

    // Fire hydrants on street corners
    const hydrantLocations = [
      { x: -9.8, z: 12.0 },
      { x: 9.8, z: 12.0 },
      { x: -9.8, z: -12.0 },
      { x: 9.8, z: -12.0 },
    ]

    hydrantLocations.forEach((loc) => {
      const hydrant = new THREE.Group()
      hydrant.position.set(loc.x, 0.18, loc.z)

      const body = new THREE.Mesh(this.sharedGeometries.hydrantBody, this.sharedMaterials.hydrantRed)
      body.position.y = 0.4
      const cap = new THREE.Mesh(this.sharedGeometries.hydrantCap, this.sharedMaterials.hydrantRed)
      cap.position.y = 0.8

      hydrant.add(body, cap)
      hydrant.matrixAutoUpdate = false
      hydrant.updateMatrix()
      propsGroup.add(hydrant)
    })

    propsGroup.matrixAutoUpdate = false
    propsGroup.updateMatrix()
    this.group.add(propsGroup)
  }

  // --- 8. KENNEY ASSET LOADING & POPULATION ---
  private async loadAssetsAndPopulate(onReady?: () => void) {
    const assetUrls = [
      '/assets/environment/city/building-a.glb',
      '/assets/environment/city/building-b.glb',
      '/assets/environment/city/building-c.glb',
      '/assets/environment/city/building-d.glb',
      '/assets/environment/city/building-e.glb',
      '/assets/environment/city/building-f.glb',
      '/assets/environment/city/building-g.glb',
      '/assets/environment/city/building-h.glb',
      '/assets/environment/city/building-skyscraper-a.glb',
      '/assets/environment/city/building-skyscraper-b.glb',
      '/assets/environment/city/building-skyscraper-c.glb',
      '/assets/environment/city/detail-awning.glb',
      '/assets/environment/city/detail-parasol-a.glb',
      '/assets/cars/cone.glb',
      '/assets/cars/box.glb',
    ]

    console.log('Loading Kenney city assets...')

    const loadPromises = assetUrls.map((url) => {
      return new Promise<void>((resolve) => {
        this.loader.load(
          url,
          (gltf) => {
            const root = gltf.scene
            root.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                child.receiveShadow = true
              }
            })
            this.modelCache.set(url, root)
            resolve()
          },
          undefined,
          (err) => {
            console.error(`Failed to load city asset: ${url}`, err)
            resolve()
          }
        )
      })
    })

    await Promise.all(loadPromises)
    console.log('✓ All Kenney city assets loaded. Populating city blocks...')

    this.populateBuildings()
    this.populateStreetProps()

    this.isLoaded = true
    if (onReady) {
      onReady()
    }
  }

  private placeBuilding(
    assetKey: string,
    x: number,
    z: number,
    rotationY: number = 0,
    scale: number = 12.0
  ) {
    const cached = this.modelCache.get(assetKey)
    if (!cached) {
      console.warn(`Asset not found in cache: ${assetKey}`)
      return
    }

    const instance = cached.clone(true)
    instance.scale.set(scale, scale, scale)
    instance.position.set(x, 0.18, z)
    instance.rotation.y = rotationY
    instance.matrixAutoUpdate = false
    instance.updateMatrix()

    instance.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.receiveShadow = true
        child.matrixAutoUpdate = false
        child.updateMatrix()
      }
    })

    this.group.add(instance)
  }

  private placeDetail(
    assetKey: string,
    x: number,
    z: number,
    rotationY: number = 0,
    scale: number = 12.0
  ) {
    this.placeBuilding(assetKey, x, z, rotationY, scale)
  }

  private populateBuildings() {
    // --- QUADRANT 1: NORTH-WEST (Retail & High-Rise Quarter) ---
    this.placeBuilding('/assets/environment/city/building-skyscraper-a.glb', -22, 22, -Math.PI / 2, 12.0)
    this.placeBuilding('/assets/environment/city/building-a.glb', -22, 38, -Math.PI / 2, 12.0)
    this.placeDetail('/assets/environment/city/detail-awning.glb', -17.5, 38, -Math.PI / 2, 12.0)
    this.placeBuilding('/assets/environment/city/building-b.glb', -38, 22, 0, 12.0)
    this.placeBuilding('/assets/environment/city/building-e.glb', -38, 38, Math.PI / 2, 12.0)
    this.placeDetail('/assets/environment/city/detail-parasol-a.glb', -16.5, 34, 0, 8.0)
    this.placeDetail('/assets/environment/city/detail-parasol-a.glb', -16.5, 30, 0, 8.0)

    // --- QUADRANT 2: NORTH-EAST (Financial District) ---
    this.placeBuilding('/assets/environment/city/building-skyscraper-b.glb', 22, 22, 0, 12.5)
    this.placeBuilding('/assets/environment/city/building-c.glb', 22, 38, Math.PI / 2, 12.0)
    this.placeBuilding('/assets/environment/city/building-skyscraper-c.glb', 38, 22, Math.PI, 12.0)
    this.placeBuilding('/assets/environment/city/building-d.glb', 38, 38, 0, 12.0)

    // --- QUADRANT 3: SOUTH-WEST (Commercial Plaza) ---
    this.placeBuilding('/assets/environment/city/building-f.glb', -22, -22, Math.PI, 12.0)
    this.placeBuilding('/assets/environment/city/building-g.glb', -22, -38, -Math.PI / 2, 12.0)
    this.placeDetail('/assets/environment/city/detail-awning.glb', -17.5, -38, -Math.PI / 2, 12.0)
    this.placeBuilding('/assets/environment/city/building-h.glb', -38, -22, Math.PI / 2, 12.0)
    this.placeBuilding('/assets/environment/city/building-b.glb', -38, -38, Math.PI, 12.0)

    // --- QUADRANT 4: SOUTH-EAST (Mixed High-Rise & Downtown) ---
    this.placeBuilding('/assets/environment/city/building-skyscraper-a.glb', 22, -22, Math.PI / 2, 12.0)
    this.placeBuilding('/assets/environment/city/building-e.glb', 22, -38, Math.PI / 2, 12.0)
    this.placeBuilding('/assets/environment/city/building-a.glb', 38, -22, 0, 12.0)
    this.placeBuilding('/assets/environment/city/building-c.glb', 38, -38, -Math.PI / 2, 12.0)
  }

  private populateStreetProps() {
    const coneKey = '/assets/cars/cone.glb'
    const coneCached = this.modelCache.get(coneKey)

    if (coneCached) {
      const coneZPositions = [-45, -30, -15, 0, 15, 30, 45]
      coneZPositions.forEach((z, i) => {
        const cone = coneCached.clone(true)
        const xOffset = (i % 2 === 0 ? 1 : -1) * 3.2
        cone.scale.set(1.4, 1.4, 1.4)
        cone.position.set(64 + xOffset, 0, z)
        cone.matrixAutoUpdate = false
        cone.updateMatrix()
        this.group.add(cone)
      })

      const barrierCones = [
        { x: -5.5, z: 8.5 },
        { x: 5.5, z: 8.5 },
        { x: -5.5, z: -8.5 },
        { x: 5.5, z: -8.5 },
      ]
      barrierCones.forEach((pt) => {
        const cone = coneCached.clone(true)
        cone.scale.set(1.2, 1.2, 1.2)
        cone.position.set(pt.x, 0, pt.z)
        cone.matrixAutoUpdate = false
        cone.updateMatrix()
        this.group.add(cone)
      })
    }

    const boxKey = '/assets/cars/box.glb'
    const boxCached = this.modelCache.get(boxKey)

    if (boxCached) {
      const boxAlleys = [
        { x: -30, z: 32 },
        { x: 30, z: -32 },
        { x: -30, z: -32 },
      ]

      boxAlleys.forEach((alley) => {
        const box1 = boxCached.clone(true)
        box1.scale.set(1.3, 1.3, 1.3)
        box1.position.set(alley.x, 0.18, alley.z)
        box1.matrixAutoUpdate = false
        box1.updateMatrix()
        this.group.add(box1)

        const box2 = boxCached.clone(true)
        box2.scale.set(1.3, 1.3, 1.3)
        box2.position.set(alley.x + 1.2, 0.18, alley.z)
        box2.matrixAutoUpdate = false
        box2.updateMatrix()
        this.group.add(box2)

        const box3 = boxCached.clone(true)
        box3.scale.set(1.1, 1.1, 1.1)
        box3.position.set(alley.x + 0.6, 0.18 + 0.8, alley.z)
        box3.matrixAutoUpdate = false
        box3.updateMatrix()
        this.group.add(box3)
      })
    }
  }

  public getDefaultSpawn(): SpawnLocation {
    return this.spawnLocations[0]
  }
}
