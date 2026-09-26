import * as THREE from 'three'
import { PhysicsWorld } from '../physics/PhysicsWorld.ts'

export interface DriftZone {
  id: string
  name: string
  position: THREE.Vector3
  radius: number
  multiplierBonus: number
  color: number
}

export interface DriftTrackSpawnPoint {
  id: string
  name: string
  position: THREE.Vector3
  rotationY: number
}

export class DriftTrack {
  public group: THREE.Group
  private physicsWorld: PhysicsWorld
  public isLoaded: boolean = true

  // World Offset (Places DriftTrack 600m away on negative Z to prevent any collider overlap)
  public readonly offset: THREE.Vector3 = new THREE.Vector3(0, 0, -600)

  // Designated Drift Zones
  public readonly driftZones: DriftZone[] = [
    {
      id: 'zone-sweeper',
      name: 'Bölge 1: Omega Sweeper',
      position: new THREE.Vector3(45, 0, -600),
      radius: 42,
      multiplierBonus: 1.5,
      color: 0x38bdf8, // Cyan glow
    },
    {
      id: 'zone-donut',
      name: 'Bölge 2: Donut Arena',
      position: new THREE.Vector3(0, 0, -600),
      radius: 36,
      multiplierBonus: 2.0,
      color: 0xf59e0b, // Amber glow
    },
    {
      id: 'zone-chicane',
      name: 'Bölge 3: S-Şikan Slalom',
      position: new THREE.Vector3(-45, 0, -600),
      radius: 38,
      multiplierBonus: 1.5,
      color: 0x10b981, // Emerald glow
    },
    {
      id: 'zone-hairpin',
      name: 'Bölge 4: Final Hairpin',
      position: new THREE.Vector3(-30, 0, -520),
      radius: 35,
      multiplierBonus: 1.8,
      color: 0xec4899, // Pink glow
    },
  ]

  // Track Spawn Points
  public readonly spawnPoints: DriftTrackSpawnPoint[] = [
    {
      id: 'main-staging',
      name: 'Ana Başlangıç Çizgisi',
      position: new THREE.Vector3(0, 0.05, -500),
      rotationY: Math.PI, // Facing South toward Donut Arena
    },
    {
      id: 'donut-pad',
      name: 'Donut Meydanı',
      position: new THREE.Vector3(0, 0.05, -580),
      rotationY: Math.PI,
    },
    {
      id: 'sweeper-entry',
      name: 'Omega Sweeper Girişi',
      position: new THREE.Vector3(40, 0.05, -540),
      rotationY: Math.PI * 0.85,
    },
    {
      id: 'chicane-entry',
      name: 'S-Şikan Girişi',
      position: new THREE.Vector3(-45, 0.05, -640),
      rotationY: 0,
    },
  ]

  // Shared Materials
  private materials = {
    asphaltDark: new THREE.MeshStandardMaterial({
      color: 0x16181d,
      roughness: 0.82,
      metalness: 0.15,
    }),
    asphaltLight: new THREE.MeshStandardMaterial({
      color: 0x222630,
      roughness: 0.78,
      metalness: 0.1,
    }),
    groundOuter: new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Deep industrial perimeter
      roughness: 0.95,
      metalness: 0.05,
    }),
    skidMark: new THREE.MeshBasicMaterial({
      color: 0x090a0d,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
    barrierRed: new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 }),
    barrierWhite: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }),
    guardRail: new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.75, roughness: 0.35 }),
    coneOrange: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4 }),
    floodlightPole: new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.4 }),
    floodlightLamp: new THREE.MeshBasicMaterial({ color: 0xfffbeb }),
    neonCyan: new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    neonAmber: new THREE.MeshBasicMaterial({ color: 0xfbbf24 }),
  }

  constructor(scene: THREE.Scene, physicsWorld: PhysicsWorld) {
    this.physicsWorld = physicsWorld
    this.group = new THREE.Group()
    this.group.name = 'DriftTrackWorld'
    this.group.position.copy(this.offset)
    scene.add(this.group)

    // Build the Drift Playground elements
    this.buildGroundAndTracks()
    this.buildSafetyBarriers()
    this.buildDonutDriftPad()
    this.buildDriftZoneVisuals()
    this.buildStartingGantry()
    this.buildStadiumLighting()
    this.buildPropsAndBillboards()

    // Initially hide until Drift mode activated
    this.setVisible(false)
  }

  // --- 1. GROUND & WIDE ASPHALT PLAYGROUND ---
  private buildGroundAndTracks(): void {
    // 1.1 Base ground plate (260x260m)
    const baseGeo = new THREE.PlaneGeometry(260, 260)
    baseGeo.rotateX(-Math.PI / 2)
    const baseMesh = new THREE.Mesh(baseGeo, this.materials.groundOuter)
    baseMesh.receiveShadow = true
    baseMesh.position.set(0, -0.04, 0)
    this.group.add(baseMesh)

    // Rapier Ground Physics Collider
    this.physicsWorld.createStaticBoxCollider(
      this.offset.x,
      this.offset.y - 0.25,
      this.offset.z,
      130,
      0.25,
      130
    )

    // 1.2 Main Arena Asphalt Tarmac (220x220m)
    const arenaGeo = new THREE.PlaneGeometry(220, 220)
    arenaGeo.rotateX(-Math.PI / 2)
    const arenaMesh = new THREE.Mesh(arenaGeo, this.materials.asphaltDark)
    arenaMesh.receiveShadow = true
    arenaMesh.position.set(0, -0.01, 0)
    this.group.add(arenaMesh)

    // 1.3 Main Launch Straight Ribbon (Width: 20m, Length: 90m)
    const straightGeo = new THREE.PlaneGeometry(20, 90)
    straightGeo.rotateX(-Math.PI / 2)
    const straightMesh = new THREE.Mesh(straightGeo, this.materials.asphaltLight)
    straightMesh.receiveShadow = true
    straightMesh.position.set(0, 0.01, 60)
    this.group.add(straightMesh)

    // 1.4 Staging Start Line & Checkerboard Decal
    const startLineGeo = new THREE.PlaneGeometry(20, 3)
    startLineGeo.rotateX(-Math.PI / 2)
    const startLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const startLineMesh = new THREE.Mesh(startLineGeo, startLineMat)
    startLineMesh.position.set(0, 0.02, 100)
    this.group.add(startLineMesh)

    // 1.5 Rubber Skid Marks on Tarmac (Simulates heavily drifted surfaces)
    this.createSkidMarkRibbon(new THREE.Vector3(2, 0.015, 60), 16, 75, 0.1)
    this.createSkidMarkRibbon(new THREE.Vector3(42, 0.015, 0), 24, 60, Math.PI * 0.25)
    this.createSkidMarkRibbon(new THREE.Vector3(-42, 0.015, 0), 24, 60, -Math.PI * 0.25)
  }

  private createSkidMarkRibbon(pos: THREE.Vector3, width: number, length: number, rotY: number): void {
    const geo = new THREE.PlaneGeometry(width, length)
    geo.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geo, this.materials.skidMark)
    mesh.position.copy(pos)
    mesh.rotation.y = rotY
    this.group.add(mesh)
  }

  // --- 2. DONUT & FIGURE-8 DRIFT ARENA ---
  private buildDonutDriftPad(): void {
    // 2.1 Center Donut Pad Circle (Diameter: 68m)
    const circleGeo = new THREE.CircleGeometry(34, 48)
    circleGeo.rotateX(-Math.PI / 2)
    const circleMesh = new THREE.Mesh(circleGeo, this.materials.asphaltLight)
    circleMesh.receiveShadow = true
    circleMesh.position.set(0, 0.01, 0)
    this.group.add(circleMesh)

    // Outer painted drift ring
    const ringGeo = new THREE.RingGeometry(32, 33.5, 48)
    ringGeo.rotateX(-Math.PI / 2)
    const ringMesh = new THREE.Mesh(ringGeo, this.materials.neonAmber)
    ringMesh.position.set(0, 0.02, 0)
    this.group.add(ringMesh)

    // Inner painted ring
    const innerRingGeo = new THREE.RingGeometry(14, 15, 36)
    innerRingGeo.rotateX(-Math.PI / 2)
    const innerRingMesh = new THREE.Mesh(innerRingGeo, this.materials.neonCyan)
    innerRingMesh.position.set(0, 0.02, 0)
    this.group.add(innerRingMesh)

    // 2.2 Center Obstacle Tower (Protected by tire stacks & Rapier collider)
    const centerPillarGeo = new THREE.CylinderGeometry(2.5, 2.5, 6, 16)
    const centerPillarMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6 })
    const centerPillar = new THREE.Mesh(centerPillarGeo, centerPillarMat)
    centerPillar.position.set(0, 3, 0)
    centerPillar.castShadow = true
    this.group.add(centerPillar)

    // Tire stack around center pillar
    this.createTireStack(new THREE.Vector3(0, 0, 0), 3.2, 4)

    // Rapier collider for center pillar
    this.physicsWorld.createStaticBoxCollider(
      this.offset.x,
      this.offset.y + 1.5,
      this.offset.z,
      3.2,
      1.5,
      3.2
    )

    // Corner Apex Traffic Cones
    const conePositions = [
      new THREE.Vector3(12, 0, 12),
      new THREE.Vector3(-12, 0, 12),
      new THREE.Vector3(12, 0, -12),
      new THREE.Vector3(-12, 0, -12),
    ]

    conePositions.forEach((pos) => {
      this.createTrafficCone(pos)
    })
  }

  // --- 3. DRIFT ZONES VISUAL RINGS & NEON MARKERS ---
  private buildDriftZoneVisuals(): void {
    this.driftZones.forEach((zone) => {
      // Zone boundary ring on asphalt
      const ringGeo = new THREE.RingGeometry(zone.radius - 1.2, zone.radius, 40)
      ringGeo.rotateX(-Math.PI / 2)
      const ringMat = new THREE.MeshBasicMaterial({
        color: zone.color,
        transparent: true,
        opacity: 0.65,
      })
      const ringMesh = new THREE.Mesh(ringGeo, ringMat)
      ringMesh.position.set(zone.position.x, 0.02, zone.position.z - this.offset.z)
      this.group.add(ringMesh)

      // Pylon markers at zone entrance
      const pylonGeo = new THREE.CylinderGeometry(0.3, 0.4, 2.8, 8)
      const pylonMat = new THREE.MeshStandardMaterial({ color: zone.color, roughness: 0.3 })
      const pylon = new THREE.Mesh(pylonGeo, pylonMat)
      pylon.position.set(zone.position.x, 1.4, zone.position.z - this.offset.z + zone.radius * 0.8)
      this.group.add(pylon)
    })
  }

  // --- 4. SAFETY BARRIERS & WALL COLLIDERS ---
  private buildSafetyBarriers(): void {
    // Perimeter Size: 210 x 210 meters
    const halfWidth = 105
    const halfLength = 105

    // North Wall (Z = -halfLength)
    this.createBarrierSegment(new THREE.Vector3(0, 0.9, -halfLength), 210, 1.8, 1.4, 0)
    this.physicsWorld.createStaticBoxCollider(
      this.offset.x,
      this.offset.y + 0.9,
      this.offset.z - halfLength,
      105,
      0.9,
      0.7
    )

    // South Wall (Z = halfLength)
    this.createBarrierSegment(new THREE.Vector3(0, 0.9, halfLength), 210, 1.8, 1.4, 0)
    this.physicsWorld.createStaticBoxCollider(
      this.offset.x,
      this.offset.y + 0.9,
      this.offset.z + halfLength,
      105,
      0.9,
      0.7
    )

    // East Wall (X = halfWidth)
    this.createBarrierSegment(new THREE.Vector3(halfWidth, 0.9, 0), 1.4, 1.8, 210, 0)
    this.physicsWorld.createStaticBoxCollider(
      this.offset.x + halfWidth,
      this.offset.y + 0.9,
      this.offset.z,
      0.7,
      0.9,
      105
    )

    // West Wall (X = -halfWidth)
    this.createBarrierSegment(new THREE.Vector3(-halfWidth, 0.9, 0), 1.4, 1.8, 210, 0)
    this.physicsWorld.createStaticBoxCollider(
      this.offset.x - halfWidth,
      this.offset.y + 0.9,
      this.offset.z,
      0.7,
      0.9,
      105
    )

    // Inner Chicane Barrier Dividers (Guides slides and prevents shortcuts)
    this.createBarrierSegment(new THREE.Vector3(-25, 0.7, -20), 4, 1.4, 40, Math.PI * 0.1)
    this.physicsWorld.createStaticBoxCollider(
      this.offset.x - 25,
      this.offset.y + 0.7,
      this.offset.z - 20,
      2.0,
      0.7,
      20.0
    )

    this.createBarrierSegment(new THREE.Vector3(25, 0.7, 20), 4, 1.4, 40, -Math.PI * 0.1)
    this.physicsWorld.createStaticBoxCollider(
      this.offset.x + 25,
      this.offset.y + 0.7,
      this.offset.z + 20,
      2.0,
      0.7,
      20.0
    )
  }

  private createBarrierSegment(
    pos: THREE.Vector3,
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    rotY: number
  ): void {
    const geo = new THREE.BoxGeometry(sizeX, sizeY, sizeZ)
    const mesh = new THREE.Mesh(geo, this.materials.guardRail)
    mesh.position.copy(pos)
    mesh.rotation.y = rotY
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)

    // Alternating red/white warning top rail
    const topRailGeo = new THREE.BoxGeometry(sizeX * 1.01, 0.35, sizeZ * 1.01)
    const topRail = new THREE.Mesh(topRailGeo, this.materials.barrierRed)
    topRail.position.set(pos.x, pos.y + sizeY / 2 - 0.15, pos.z)
    topRail.rotation.y = rotY
    this.group.add(topRail)
  }

  private createTireStack(pos: THREE.Vector3, radius: number, count: number): void {
    const tireGeo = new THREE.TorusGeometry(radius, 0.45, 8, 20)
    tireGeo.rotateX(Math.PI / 2)
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 })

    for (let i = 0; i < count; i++) {
      const tire = new THREE.Mesh(tireGeo, tireMat)
      tire.position.set(pos.x, 0.35 + i * 0.65, pos.z)
      tire.castShadow = true
      this.group.add(tire)
    }
  }

  private createTrafficCone(pos: THREE.Vector3): void {
    const coneGeo = new THREE.ConeGeometry(0.35, 1.0, 10)
    const cone = new THREE.Mesh(coneGeo, this.materials.coneOrange)
    cone.position.set(pos.x, 0.5, pos.z)
    cone.castShadow = true
    this.group.add(cone)
  }

  // --- 5. STARTING GANTRY ARCH ---
  private buildStartingGantry(): void {
    const gantryGroup = new THREE.Group()
    gantryGroup.position.set(0, 0, 100) // Near start line

    // Vertical Pillars
    const pillarGeo = new THREE.BoxGeometry(0.8, 8, 0.8)
    const leftPillar = new THREE.Mesh(pillarGeo, this.materials.floodlightPole)
    leftPillar.position.set(-11, 4, 0)
    gantryGroup.add(leftPillar)

    const rightPillar = new THREE.Mesh(pillarGeo, this.materials.floodlightPole)
    rightPillar.position.set(11, 4, 0)
    gantryGroup.add(rightPillar)

    // Horizontal Truss
    const trussGeo = new THREE.BoxGeometry(23, 1.2, 1.0)
    const truss = new THREE.Mesh(trussGeo, this.materials.floodlightPole)
    truss.position.set(0, 7.8, 0)
    gantryGroup.add(truss)

    // Illuminated "DRIFT PLAYGROUND" Signboard
    const signGeo = new THREE.PlaneGeometry(16, 2.2)
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(0, 0, 1024, 256)
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 14
      ctx.strokeRect(10, 10, 1004, 236)

      ctx.fillStyle = '#fbbf24'
      ctx.font = 'bold 96px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('⚡ DRIFT ARENA ⚡', 512, 128)
    }

    const signTexture = new THREE.CanvasTexture(canvas)
    const signMat = new THREE.MeshBasicMaterial({ map: signTexture })
    const signMesh = new THREE.Mesh(signGeo, signMat)
    signMesh.position.set(0, 7.8, -0.6)
    signMesh.rotation.y = Math.PI // Face oncoming cars from staging
    gantryGroup.add(signMesh)

    this.group.add(gantryGroup)
  }

  // --- 6. STADIUM FLOODLIGHT TOWERS ---
  private buildStadiumLighting(): void {
    const towerCoords = [
      { x: -95, z: -95 },
      { x: 95, z: -95 },
      { x: -95, z: 95 },
      { x: 95, z: 95 },
      { x: -95, z: 0 },
      { x: 95, z: 0 },
    ]

    towerCoords.forEach((coord) => {
      const towerGroup = new THREE.Group()
      towerGroup.position.set(coord.x, 0, coord.z)

      // Tall mast
      const poleGeo = new THREE.CylinderGeometry(0.5, 0.9, 22, 8)
      const pole = new THREE.Mesh(poleGeo, this.materials.floodlightPole)
      pole.position.y = 11
      pole.castShadow = true
      towerGroup.add(pole)

      // Lamp crosshead
      const headGeo = new THREE.BoxGeometry(5.0, 1.4, 1.2)
      const head = new THREE.Mesh(headGeo, this.materials.floodlightPole)
      head.position.y = 22
      towerGroup.add(head)

      // Glowing light panel
      const lampGeo = new THREE.PlaneGeometry(4.6, 1.1)
      const lamp = new THREE.Mesh(lampGeo, this.materials.floodlightLamp)
      lamp.position.set(0, 22, -0.65)
      lamp.rotation.y = Math.PI
      towerGroup.add(lamp)

      this.group.add(towerGroup)
    })
  }

  // --- 7. PROPS & SPONSOR BILLBOARDS ---
  private buildPropsAndBillboards(): void {
    const billboardTexts = [
      'TOKYO DRIFT CLUB',
      'APEX ATTACK 2026',
      'BURNOUT ENERGY',
      'TURBO OVERBOOST',
    ]

    const billboardCoords = [
      { x: -70, z: -103, rot: 0, text: billboardTexts[0] },
      { x: 70, z: -103, rot: 0, text: billboardTexts[1] },
      { x: 103, z: -40, rot: -Math.PI / 2, text: billboardTexts[2] },
      { x: -103, z: 40, rot: Math.PI / 2, text: billboardTexts[3] },
    ]

    billboardCoords.forEach((item) => {
      const bGroup = new THREE.Group()
      bGroup.position.set(item.x, 0, item.z)
      bGroup.rotation.y = item.rot

      // Support legs
      const legGeo = new THREE.BoxGeometry(0.3, 5, 0.3)
      const legL = new THREE.Mesh(legGeo, this.materials.floodlightPole)
      legL.position.set(-4, 2.5, 0)
      bGroup.add(legL)
      const legR = new THREE.Mesh(legGeo, this.materials.floodlightPole)
      legR.position.set(4, 2.5, 0)
      bGroup.add(legR)

      // Board canvas
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 128
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#1e293b'
        ctx.fillRect(0, 0, 512, 128)
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 8
        ctx.strokeRect(6, 6, 500, 116)

        ctx.fillStyle = '#38bdf8'
        ctx.font = 'bold 44px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(item.text, 256, 64)
      }

      const tex = new THREE.CanvasTexture(canvas)
      const boardGeo = new THREE.BoxGeometry(10, 2.8, 0.4)
      const boardMat = new THREE.MeshStandardMaterial({
        map: tex,
        metalness: 0.3,
        roughness: 0.6,
      })
      const board = new THREE.Mesh(boardGeo, boardMat)
      board.position.set(0, 4.5, 0)
      bGroup.add(board)

      this.group.add(bGroup)
    })
  }

  // --- 8. DRIFT ZONE TELEMETRY CHECKER ---
  public update(_delta: number, carPos: THREE.Vector3): { activeZone: DriftZone | null; bonusMultiplier: number } {
    let activeZone: DriftZone | null = null
    let bonusMultiplier = 1.0

    for (let i = 0; i < this.driftZones.length; i++) {
      const zone = this.driftZones[i]
      const dist = Math.hypot(carPos.x - zone.position.x, carPos.z - zone.position.z)

      if (dist <= zone.radius) {
        activeZone = zone
        bonusMultiplier = zone.multiplierBonus
        break
      }
    }

    return { activeZone, bonusMultiplier }
  }

  public getSpawnPosition(index: number = 0): DriftTrackSpawnPoint {
    const safeIndex = (index + this.spawnPoints.length) % this.spawnPoints.length
    return this.spawnPoints[safeIndex]
  }

  public getNearestSpawnPoint(pos: THREE.Vector3): DriftTrackSpawnPoint {
    let nearest = this.spawnPoints[0]
    let minDistSq = Infinity
    for (const pt of this.spawnPoints) {
      const dx = pt.position.x - pos.x
      const dz = pt.position.z - pos.z
      const distSq = dx * dx + dz * dz
      if (distSq < minDistSq) {
        minDistSq = distSq
        nearest = pt
      }
    }
    return nearest
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible
  }
}
