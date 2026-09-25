import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export class CityWorld {
  public group: THREE.Group
  private loader: GLTFLoader
  private modelCache: Map<string, THREE.Group> = new Map()
  public isLoaded: boolean = false

  // Road grid dimensions
  private readonly BLOCK_SIZE = 44.0
  private readonly BLOCK_OFFSET = 32.0 // Center coordinate of quadrant blocks

  constructor(scene: THREE.Scene, onReady?: () => void) {
    this.group = new THREE.Group()
    this.group.name = 'CityWorldGroup'
    scene.add(this.group)

    this.loader = new GLTFLoader()

    // 1. Build road networks, sidewalks, and markings
    this.createRoadNetwork()
    this.createSidewalks()
    this.createRoadMarkings()
    this.createStreetFurniture()

    // 2. Preload Kenney GLTF assets and populate city blocks
    this.loadAssetsAndPopulate(onReady)
  }

  // --- 1. ROAD NETWORK & PAVEMENT ---
  private createRoadNetwork() {
    // Large ground plane (outer perimeter grass/suburban bed)
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
    this.group.add(ground)

    // Main Asphalt Grid
    // Total city tarmac apron covering the 4 blocks and surrounding avenues
    const tarmacSize = 180
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
    this.group.add(tarmac)
  }

  // --- 2. RAISED SIDEWALKS ---
  private createSidewalks() {
    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af, // Concrete curb gray
      roughness: 0.75,
      metalness: 0.1,
    })

    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x4b5563, // Dark stone curb border
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
      // Main raised sidewalk slab
      const slabGeo = new THREE.BoxGeometry(sidewalkSize, sidewalkHeight, sidewalkSize)
      const slab = new THREE.Mesh(slabGeo, sidewalkMat)
      slab.position.set(center.x, sidewalkHeight / 2, center.z)
      slab.receiveShadow = true
      slab.castShadow = true
      this.group.add(slab)

      // Curb edge trim
      const curbBorderGeo = new THREE.BoxGeometry(sidewalkSize + 0.3, sidewalkHeight * 0.9, sidewalkSize + 0.3)
      const curbBorder = new THREE.Mesh(curbBorderGeo, curbMat)
      curbBorder.position.set(center.x, sidewalkHeight * 0.45, center.z)
      curbBorder.receiveShadow = true
      this.group.add(curbBorder)
    })
  }

  // --- 3. PAINTED ROAD MARKINGS (Crosswalks, Lane dividers, Stop lines) ---
  private createRoadMarkings() {
    const whiteMarkingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    })
    const yellowMarkingMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15, // Golden yellow double line
      side: THREE.DoubleSide,
    })

    const markingsGroup = new THREE.Group()
    markingsGroup.position.y = 0.015 // Just above asphalt to avoid Z-fighting

    // 3.1 Double Yellow Center Lines on Central Avenues
    const yellowLineGeo = new THREE.PlaneGeometry(0.18, 54)
    yellowLineGeo.rotateX(-Math.PI / 2)

    // Central North-South Avenue (North section & South section)
    const nsLineNorth = new THREE.Mesh(yellowLineGeo, yellowMarkingMat)
    nsLineNorth.position.set(-0.16, 0, 42)
    markingsGroup.add(nsLineNorth)
    const nsLineNorth2 = new THREE.Mesh(yellowLineGeo, yellowMarkingMat)
    nsLineNorth2.position.set(0.16, 0, 42)
    markingsGroup.add(nsLineNorth2)

    const nsLineSouth = new THREE.Mesh(yellowLineGeo, yellowMarkingMat)
    nsLineSouth.position.set(-0.16, 0, -42)
    markingsGroup.add(nsLineSouth)
    const nsLineSouth2 = new THREE.Mesh(yellowLineGeo, yellowMarkingMat)
    nsLineSouth2.position.set(0.16, 0, -42)
    markingsGroup.add(nsLineSouth2)

    // Central East-West Avenue (West section & East section)
    const ewLineGeo = new THREE.PlaneGeometry(54, 0.18)
    ewLineGeo.rotateX(-Math.PI / 2)

    const ewLineWest = new THREE.Mesh(ewLineGeo, yellowMarkingMat)
    ewLineWest.position.set(-42, 0, -0.16)
    markingsGroup.add(ewLineWest)
    const ewLineWest2 = new THREE.Mesh(ewLineGeo, yellowMarkingMat)
    ewLineWest2.position.set(-42, 0, 0.16)
    markingsGroup.add(ewLineWest2)

    const ewLineEast = new THREE.Mesh(ewLineGeo, yellowMarkingMat)
    ewLineEast.position.set(42, 0, -0.16)
    markingsGroup.add(ewLineEast)
    const ewLineEast2 = new THREE.Mesh(ewLineGeo, yellowMarkingMat)
    ewLineEast2.position.set(42, 0, 0.16)
    markingsGroup.add(ewLineEast2)

    // 3.2 Dashed White Lane Lines
    const dashGeo = new THREE.PlaneGeometry(0.22, 2.5)
    dashGeo.rotateX(-Math.PI / 2)

    for (let z = 16; z <= 68; z += 5.5) {
      // NS Avenue lanes (left and right traffic lanes)
      const dashLeft = new THREE.Mesh(dashGeo, whiteMarkingMat)
      dashLeft.position.set(-4.0, 0, z)
      markingsGroup.add(dashLeft)

      const dashRight = new THREE.Mesh(dashGeo, whiteMarkingMat)
      dashRight.position.set(4.0, 0, z)
      markingsGroup.add(dashRight)

      const dashLeftS = new THREE.Mesh(dashGeo, whiteMarkingMat)
      dashLeftS.position.set(-4.0, 0, -z)
      markingsGroup.add(dashLeftS)

      const dashRightS = new THREE.Mesh(dashGeo, whiteMarkingMat)
      dashRightS.position.set(4.0, 0, -z)
      markingsGroup.add(dashRightS)
    }

    // 3.3 Pedestrian Crosswalks at Central Crossroads
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

    // 4 Crosswalks surrounding central intersection
    addZebraCrosswalk(0, 10.5, false)  // North crosswalk
    addZebraCrosswalk(0, -10.5, false) // South crosswalk
    addZebraCrosswalk(10.5, 0, true)   // East crosswalk
    addZebraCrosswalk(-10.5, 0, true)  // West crosswalk

    // Start / Finish Line on the South road (facing North)
    const checkerGeo = new THREE.PlaneGeometry(0.7, 0.7)
    checkerGeo.rotateX(-Math.PI / 2)
    const checkDarkMat = new THREE.MeshBasicMaterial({ color: 0x111111 })

    for (let x = -6.5; x <= 6.5; x += 0.7) {
      for (let row = 0; row < 2; row++) {
        const isWhite = (Math.round((x + 6.5) / 0.7) + row) % 2 === 0
        const tile = new THREE.Mesh(checkerGeo, isWhite ? whiteMarkingMat : checkDarkMat)
        tile.position.set(x, 0, -2.5 + row * 0.7)
        markingsGroup.add(tile)
      }
    }

    this.group.add(markingsGroup)
  }

  // --- 4. STREET LAMPS & DECORATIVE PROPS ---
  private createStreetFurniture() {
    const lampGroup = new THREE.Group()

    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.8,
      roughness: 0.3,
    })
    const lightBulbMat = new THREE.MeshStandardMaterial({
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

      // Post
      const postGeo = new THREE.CylinderGeometry(0.12, 0.16, 5.2, 8)
      const post = new THREE.Mesh(postGeo, poleMat)
      post.position.y = 2.6
      post.castShadow = true
      lamp.add(post)

      // Overhang arm
      const armGeo = new THREE.BoxGeometry(0.9, 0.1, 0.1)
      const arm = new THREE.Mesh(armGeo, poleMat)
      arm.position.set(pos.x > 0 ? -0.4 : 0.4, 5.1, 0)
      lamp.add(arm)

      // Fixture bulb
      const bulbGeo = new THREE.SphereGeometry(0.22, 12, 8)
      const bulb = new THREE.Mesh(bulbGeo, lightBulbMat)
      bulb.position.set(pos.x > 0 ? -0.75 : 0.75, 4.95, 0)
      lamp.add(bulb)

      lampGroup.add(lamp)
    })

    this.group.add(lampGroup)
  }

  // --- 5. KENNEY ASSET LOADING & CITY BLOCK POPULATION ---
  private async loadAssetsAndPopulate(onReady?: () => void) {
    // List of actual Kenney city assets verified in public/assets/environment/city/ and cars/
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
                child.castShadow = true
                child.receiveShadow = true
              }
            })
            this.modelCache.set(url, root)
            resolve()
          },
          undefined,
          (err) => {
            console.error(`Failed to load city asset: ${url}`, err)
            resolve() // Continue gracefully even if one fails
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
    // Sidewalk height is 0.18, so building sits right on the pavement
    instance.position.set(x, 0.18, z)
    instance.rotation.y = rotationY

    instance.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true
        child.receiveShadow = true
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
    // Sidewalk level is 0.18.
    // Kenney building base is ~0.9m. At scale 12, width is ~10.8m.
    // Each quadrant block is 44m x 44m, centered at (+-32, +-32).
    // In each block, arrange 4 major buildings facing outwards towards the streets:
    // Positions inside block are offset from center by ~10m in each direction (+-10, +-10).

    // --- QUADRANT 1: NORTH-WEST (Retail & High-Rise Quarter) ---
    // Center: (-32, 0, 32)
    // Front-Right corner facing Central Intersection:
    this.placeBuilding('/assets/environment/city/building-skyscraper-a.glb', -22, 22, -Math.PI / 2, 12.0)
    // Facing Central North Avenue:
    this.placeBuilding('/assets/environment/city/building-a.glb', -22, 38, -Math.PI / 2, 12.0)
    this.placeDetail('/assets/environment/city/detail-awning.glb', -17.5, 38, -Math.PI / 2, 12.0)
    // Facing Central West Avenue:
    this.placeBuilding('/assets/environment/city/building-b.glb', -38, 22, 0, 12.0)
    // Back corner:
    this.placeBuilding('/assets/environment/city/building-e.glb', -38, 38, Math.PI / 2, 12.0)
    // Sidewalk cafe parasols:
    this.placeDetail('/assets/environment/city/detail-parasol-a.glb', -16.5, 34, 0, 8.0)
    this.placeDetail('/assets/environment/city/detail-parasol-a.glb', -16.5, 30, 0, 8.0)

    // --- QUADRANT 2: NORTH-EAST (Financial District) ---
    // Center: (32, 0, 32)
    // Corner facing Central Intersection:
    this.placeBuilding('/assets/environment/city/building-skyscraper-b.glb', 22, 22, 0, 12.5)
    // Facing Central North Avenue:
    this.placeBuilding('/assets/environment/city/building-c.glb', 22, 38, Math.PI / 2, 12.0)
    // Facing East Avenue:
    this.placeBuilding('/assets/environment/city/building-skyscraper-c.glb', 38, 22, Math.PI, 12.0)
    // Back corner:
    this.placeBuilding('/assets/environment/city/building-d.glb', 38, 38, 0, 12.0)

    // --- QUADRANT 3: SOUTH-WEST (Commercial Plaza) ---
    // Center: (-32, 0, -32)
    // Corner facing Central Intersection:
    this.placeBuilding('/assets/environment/city/building-f.glb', -22, -22, Math.PI, 12.0)
    // Facing Central South Avenue:
    this.placeBuilding('/assets/environment/city/building-g.glb', -22, -38, -Math.PI / 2, 12.0)
    this.placeDetail('/assets/environment/city/detail-awning.glb', -17.5, -38, -Math.PI / 2, 12.0)
    // Facing West Avenue:
    this.placeBuilding('/assets/environment/city/building-h.glb', -38, -22, Math.PI / 2, 12.0)
    // Back corner:
    this.placeBuilding('/assets/environment/city/building-b.glb', -38, -38, Math.PI, 12.0)

    // --- QUADRANT 4: SOUTH-EAST (Mixed High-Rise & Downtown) ---
    // Center: (32, 0, -32)
    // Corner facing Central Intersection:
    this.placeBuilding('/assets/environment/city/building-skyscraper-a.glb', 22, -22, Math.PI / 2, 12.0)
    // Facing Central South Avenue:
    this.placeBuilding('/assets/environment/city/building-e.glb', 22, -38, Math.PI / 2, 12.0)
    // Facing East Avenue:
    this.placeBuilding('/assets/environment/city/building-a.glb', 38, -22, 0, 12.0)
    // Back corner:
    this.placeBuilding('/assets/environment/city/building-c.glb', 38, -38, -Math.PI / 2, 12.0)
  }

  private populateStreetProps() {
    // Slalom Cone Course along the open straight stretch of the East Avenue (X = 64)
    const coneKey = '/assets/cars/cone.glb'
    const coneCached = this.modelCache.get(coneKey)

    if (coneCached) {
      const coneZPositions = [-40, -25, -10, 5, 20, 35, 50]
      coneZPositions.forEach((z, i) => {
        const cone = coneCached.clone(true)
        const xOffset = (i % 2 === 0 ? 1 : -1) * 3.2
        cone.scale.set(1.4, 1.4, 1.4)
        cone.position.set(64 + xOffset, 0, z)
        this.group.add(cone)
      })

      // Extra cones at street entrance barriers
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
        this.group.add(cone)
      })
    }

    // Delivery Crates stacked in service alleys
    const boxKey = '/assets/cars/box.glb'
    const boxCached = this.modelCache.get(boxKey)

    if (boxCached) {
      const boxAlleys = [
        { x: -30, z: 32 },
        { x: 30, z: -32 },
        { x: -30, z: -32 },
      ]

      boxAlleys.forEach((alley) => {
        // Base box 1
        const box1 = boxCached.clone(true)
        box1.scale.set(1.3, 1.3, 1.3)
        box1.position.set(alley.x, 0.18, alley.z)
        this.group.add(box1)

        // Base box 2
        const box2 = boxCached.clone(true)
        box2.scale.set(1.3, 1.3, 1.3)
        box2.position.set(alley.x + 1.2, 0.18, alley.z)
        this.group.add(box2)

        // Stacked box
        const box3 = boxCached.clone(true)
        box3.scale.set(1.1, 1.1, 1.1)
        box3.position.set(alley.x + 0.6, 0.18 + 0.8, alley.z)
        this.group.add(box3)
      })
    }
  }
}
