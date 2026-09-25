import * as THREE from 'three'
import { PhysicsWorld } from '../physics/PhysicsWorld.ts'

export interface TrackCheckpoint {
  id: number
  name: string
  position: THREE.Vector3
  forward: THREE.Vector3
  radius: number
}

export interface LapState {
  currentLap: number
  totalLaps: number
  currentLapTime: number
  bestLapTime: number | null
  lastLapTime: number | null
  nextCheckpointIndex: number
  totalCheckpoints: number
  isLapComplete: boolean
  lapMessage: string | null
}

export interface TrackSpawnPoint {
  id: string
  name: string
  position: THREE.Vector3
  rotationY: number
}

export class RaceTrack {
  public group: THREE.Group
  private physicsWorld: PhysicsWorld
  public isLoaded: boolean = true

  // World Offset (Places RaceTrack 600m away from City to prevent any collider overlap)
  public readonly offset: THREE.Vector3 = new THREE.Vector3(0, 0, 600)

  // Track Curve & Geometry Data
  private trackCurve!: THREE.CatmullRomCurve3
  private readonly TRACK_WIDTH = 14.0
  private readonly KERB_WIDTH = 1.3
  private readonly NUM_SEGMENTS = 160

  // Checkpoints & Lap System
  public checkpoints: TrackCheckpoint[] = []
  public lapState: LapState = {
    currentLap: 1,
    totalLaps: 3,
    currentLapTime: 0,
    bestLapTime: null,
    lastLapTime: null,
    nextCheckpointIndex: 1, // Must hit checkpoint 1 first
    totalCheckpoints: 0,
    isLapComplete: false,
    lapMessage: 'Yarış Pisti Hazır! 1. Tura Başla',
  }

  // Predefined Starting Grid & Pit Spawns (Situated at Z = 600)
  public readonly spawnPoints: TrackSpawnPoint[] = [
    {
      id: 'pole-position',
      name: 'Grid 1 (Pole Pozisyonu)',
      position: new THREE.Vector3(2.5, 0.05, 570),
      rotationY: 0,
    },
    {
      id: 'grid-2',
      name: 'Grid 2 (Ön Sıra Dış)',
      position: new THREE.Vector3(-2.5, 0.05, 563),
      rotationY: 0,
    },
    {
      id: 'grid-3',
      name: 'Grid 3 (İkinci Sıra)',
      position: new THREE.Vector3(2.5, 0.05, 556),
      rotationY: 0,
    },
    {
      id: 'pit-lane',
      name: 'Pit Yolu (Çıkış)',
      position: new THREE.Vector3(12.0, 0.05, 585),
      rotationY: 0,
    },
  ]

  // Shared Materials
  private materials = {
    asphalt: new THREE.MeshStandardMaterial({
      color: 0x181a1f,
      roughness: 0.78,
      metalness: 0.12,
    }),
    grass: new THREE.MeshStandardMaterial({
      color: 0x1e3a1e, // Deep circuit grass green
      roughness: 0.92,
      metalness: 0.05,
    }),
    kerbRed: new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 }),
    kerbWhite: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }),
    barrierArmco: new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.7,
      roughness: 0.3,
    }),
    barrierPost: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 }),
    overheadGantry: new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.25,
    }),
    bleachers: new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.6 }),
  }

  constructor(scene: THREE.Scene, physicsWorld: PhysicsWorld) {
    this.physicsWorld = physicsWorld
    this.group = new THREE.Group()
    this.group.name = 'RaceTrackWorldGroup'
    scene.add(this.group)

    // 1. Build the mathematical circuit path spline (anchored at Z = 600)
    this.buildCircuitSpline()

    // 2. Build continuous track ribbon, rumble strips, and road markings
    this.createRoadSurface()
    this.createRumbleStrips()
    this.createStartFinishGantry()
    this.createStartingGridBoxes()

    // 3. Build track barriers with Rapier physics colliders
    this.createTrackBarriers()

    // 4. Build circuit scenery (grandstands, brake markers, trees, floodlights)
    this.createScenery()

    // 5. Initialize Checkpoints
    this.setupCheckpoints()
  }

  // --- 1. CIRCUIT SPLINE ---
  private buildCircuitSpline() {
    // A flowing, diverse ~480m racing circuit situated at Z = 600:
    // Main straight -> Turn 1/2 chicane -> Back straight -> Hairpin -> S-curves -> Final sweeper
    const zOffset = this.offset.z
    const controlPoints = [
      new THREE.Vector3(0, 0, -45 + zOffset),    // Start / Finish Straight
      new THREE.Vector3(0, 0, 30 + zOffset),     // Main Straight End
      new THREE.Vector3(12, 0, 65 + zOffset),    // Chicane Turn 1 entry
      new THREE.Vector3(42, 0, 78 + zOffset),    // Chicane apex
      new THREE.Vector3(70, 0, 62 + zOffset),    // Chicane exit
      new THREE.Vector3(82, 0, 15 + zOffset),    // Back Straight
      new THREE.Vector3(82, 0, -35 + zOffset),   // Approaching Hairpin
      new THREE.Vector3(72, 0, -78 + zOffset),   // Hairpin braking zone
      new THREE.Vector3(42, 0, -96 + zOffset),   // Hairpin Apex (heavy turn)
      new THREE.Vector3(14, 0, -82 + zOffset),   // Hairpin exit
      new THREE.Vector3(-14, 0, -68 + zOffset),  // S-Curve 1
      new THREE.Vector3(-36, 0, -45 + zOffset),  // S-Curve 2
      new THREE.Vector3(-46, 0, -10 + zOffset),  // Infield sweep
      new THREE.Vector3(-40, 0, 25 + zOffset),   // Turn 5 entry
      new THREE.Vector3(-24, 0, 42 + zOffset),   // Turn 5 apex
      new THREE.Vector3(-8, 0, 10 + zOffset),    // Sweeper exit onto main straight
    ]

    this.trackCurve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal', 0.5)
  }

  // --- 2. PROCEDURAL TRACK SURFACE ---
  private createRoadSurface() {
    // Infield & Outfield Grass Bed centered at Z = 600
    const grassGeo = new THREE.PlaneGeometry(350, 350)
    const grass = new THREE.Mesh(grassGeo, this.materials.grass)
    grass.rotation.x = -Math.PI / 2
    grass.position.set(0, -0.01, this.offset.z)
    grass.receiveShadow = true
    grass.matrixAutoUpdate = false
    grass.updateMatrix()
    this.group.add(grass)

    // Track Ribbon Mesh
    const points = this.trackCurve.getSpacedPoints(this.NUM_SEGMENTS)
    const vertices: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    const halfW = this.TRACK_WIDTH / 2
    const up = new THREE.Vector3(0, 1, 0)

    for (let i = 0; i <= this.NUM_SEGMENTS; i++) {
      const idx = i % this.NUM_SEGMENTS
      const pt = points[idx]
      const t = this.trackCurve.getTangent(idx / this.NUM_SEGMENTS)
      const side = new THREE.Vector3().crossVectors(t, up).normalize()

      const left = pt.clone().addScaledVector(side, -halfW)
      const right = pt.clone().addScaledVector(side, halfW)

      vertices.push(left.x, 0.01, left.z)
      vertices.push(right.x, 0.01, right.z)

      const uvY = i * 0.8
      uvs.push(0, uvY)
      uvs.push(1, uvY)

      if (i < this.NUM_SEGMENTS) {
        const v1 = i * 2
        const v2 = v1 + 1
        const v3 = v1 + 2
        const v4 = v1 + 3

        indices.push(v1, v2, v3)
        indices.push(v2, v4, v3)
      }
    }

    const roadGeo = new THREE.BufferGeometry()
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    roadGeo.setIndex(indices)
    roadGeo.computeVertexNormals()

    const roadMesh = new THREE.Mesh(roadGeo, this.materials.asphalt)
    roadMesh.receiveShadow = true
    roadMesh.matrixAutoUpdate = false
    roadMesh.updateMatrix()
    this.group.add(roadMesh)
  }

  // --- 3. RED & WHITE RUMBLE STRIPS (KERBS) ---
  private createRumbleStrips() {
    const points = this.trackCurve.getSpacedPoints(this.NUM_SEGMENTS)
    const halfW = this.TRACK_WIDTH / 2
    const up = new THREE.Vector3(0, 1, 0)

    const kerbGroup = new THREE.Group()

    for (let i = 0; i < this.NUM_SEGMENTS; i++) {
      const isRed = Math.floor(i / 2) % 2 === 0
      const mat = isRed ? this.materials.kerbRed : this.materials.kerbWhite

      const pt1 = points[i]
      const pt2 = points[(i + 1) % this.NUM_SEGMENTS]

      const t1 = this.trackCurve.getTangent(i / this.NUM_SEGMENTS)
      const side1 = new THREE.Vector3().crossVectors(t1, up).normalize()

      const t2 = this.trackCurve.getTangent((i + 1) / this.NUM_SEGMENTS)
      const side2 = new THREE.Vector3().crossVectors(t2, up).normalize()

      // Left Kerb
      const p1L = pt1.clone().addScaledVector(side1, -halfW)
      const p2L = pt2.clone().addScaledVector(side2, -halfW)
      const p1LOuter = pt1.clone().addScaledVector(side1, -(halfW + this.KERB_WIDTH))
      const p2LOuter = pt2.clone().addScaledVector(side2, -(halfW + this.KERB_WIDTH))

      const kerbGeoL = new THREE.BufferGeometry()
      const vertsL = [
        p1L.x, 0.03, p1L.z,
        p1LOuter.x, 0.05, p1LOuter.z,
        p2L.x, 0.03, p2L.z,
        p2L.x, 0.03, p2L.z,
        p1LOuter.x, 0.05, p1LOuter.z,
        p2LOuter.x, 0.05, p2LOuter.z,
      ]
      kerbGeoL.setAttribute('position', new THREE.Float32BufferAttribute(vertsL, 3))
      kerbGeoL.computeVertexNormals()
      const kerbMeshL = new THREE.Mesh(kerbGeoL, mat)
      kerbGroup.add(kerbMeshL)

      // Right Kerb
      const p1R = pt1.clone().addScaledVector(side1, halfW)
      const p2R = pt2.clone().addScaledVector(side2, halfW)
      const p1ROuter = pt1.clone().addScaledVector(side1, halfW + this.KERB_WIDTH)
      const p2ROuter = pt2.clone().addScaledVector(side2, halfW + this.KERB_WIDTH)

      const kerbGeoR = new THREE.BufferGeometry()
      const vertsR = [
        p1R.x, 0.03, p1R.z,
        p1ROuter.x, 0.05, p1ROuter.z,
        p2R.x, 0.03, p2R.z,
        p2R.x, 0.03, p2R.z,
        p1ROuter.x, 0.05, p1ROuter.z,
        p2ROuter.x, 0.05, p2ROuter.z,
      ]
      kerbGeoR.setAttribute('position', new THREE.Float32BufferAttribute(vertsR, 3))
      kerbGeoR.computeVertexNormals()
      const kerbMeshR = new THREE.Mesh(kerbGeoR, mat)
      kerbGroup.add(kerbMeshR)
    }

    kerbGroup.matrixAutoUpdate = false
    kerbGroup.updateMatrix()
    this.group.add(kerbGroup)
  }

  // --- 4. START/FINISH OVERHEAD GANTRY & CHECKERED LINE ---
  private createStartFinishGantry() {
    const gantry = new THREE.Group()
    gantry.position.set(0, 0, this.offset.z) // At Start Line on Main Straight (Z = 600)

    // Checkered Start / Finish Strip on Asphalt
    const checkGeo = new THREE.PlaneGeometry(0.8, 0.8)
    checkGeo.rotateX(-Math.PI / 2)
    const checkWhite = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const checkBlack = new THREE.MeshBasicMaterial({ color: 0x111111 })

    const numTiles = Math.floor(this.TRACK_WIDTH / 0.8)
    for (let i = 0; i < numTiles; i++) {
      for (let row = 0; row < 2; row++) {
        const isWhite = (i + row) % 2 === 0
        const tile = new THREE.Mesh(checkGeo, isWhite ? checkWhite : checkBlack)
        const posX = -this.TRACK_WIDTH / 2 + (i + 0.5) * 0.8
        tile.position.set(posX, 0.02, (row - 0.5) * 0.8)
        gantry.add(tile)
      }
    }

    // Overhead Truss Structure
    const pillarGeo = new THREE.BoxGeometry(0.5, 6.5, 0.5)
    const leftPillar = new THREE.Mesh(pillarGeo, this.materials.overheadGantry)
    leftPillar.position.set(-this.TRACK_WIDTH / 2 - 1.5, 3.25, 0)
    const rightPillar = new THREE.Mesh(pillarGeo, this.materials.overheadGantry)
    rightPillar.position.set(this.TRACK_WIDTH / 2 + 1.5, 3.25, 0)

    const beamGeo = new THREE.BoxGeometry(this.TRACK_WIDTH + 4.0, 0.8, 0.8)
    const beam = new THREE.Mesh(beamGeo, this.materials.overheadGantry)
    beam.position.set(0, 6.2, 0)

    // Signboard
    const signGeo = new THREE.BoxGeometry(this.TRACK_WIDTH - 2.0, 1.2, 0.15)
    const signMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3 })
    const sign = new THREE.Mesh(signGeo, signMat)
    sign.position.set(0, 5.8, 0.4)

    // Starting Lights (Red & Green pods)
    for (let x = -3; x <= 3; x += 1.5) {
      const podMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 2.0,
      })
      const pod = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), podMat)
      pod.position.set(x, 4.8, 0.3)
      gantry.add(pod)
    }

    gantry.add(leftPillar, rightPillar, beam, sign)
    gantry.matrixAutoUpdate = false
    gantry.updateMatrix()
    this.group.add(gantry)

    // Physical colliders for gantry pillars
    this.physicsWorld.createStaticBoxCollider(
      -this.TRACK_WIDTH / 2 - 1.5,
      3.25,
      this.offset.z,
      0.4,
      3.25,
      0.4
    )
    this.physicsWorld.createStaticBoxCollider(
      this.TRACK_WIDTH / 2 + 1.5,
      3.25,
      this.offset.z,
      0.4,
      3.25,
      0.4
    )
  }

  // --- 5. STARTING GRID BOXES ---
  private createStartingGridBoxes() {
    const gridGroup = new THREE.Group()
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const zOffset = this.offset.z

    const addGridBox = (x: number, z: number) => {
      const frontLine = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.16).rotateX(-Math.PI / 2), lineMat)
      frontLine.position.set(x, 0.02, z)

      const leftLine = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 4.2).rotateX(-Math.PI / 2), lineMat)
      leftLine.position.set(x - 1.2, 0.02, z - 2.1)

      const rightLine = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 4.2).rotateX(-Math.PI / 2), lineMat)
      rightLine.position.set(x + 1.2, 0.02, z - 2.1)

      gridGroup.add(frontLine, leftLine, rightLine)
    }

    addGridBox(2.5, -30 + zOffset)   // P1 (Pole)
    addGridBox(-2.5, -37 + zOffset)  // P2
    addGridBox(2.5, -44 + zOffset)   // P3
    addGridBox(-2.5, -51 + zOffset)  // P4

    gridGroup.matrixAutoUpdate = false
    gridGroup.updateMatrix()
    this.group.add(gridGroup)
  }

  // --- 6. CONTINUOUS TRACK BARRIERS & COLLIDERS ---
  private createTrackBarriers() {
    const points = this.trackCurve.getSpacedPoints(this.NUM_SEGMENTS)
    const barrierDist = this.TRACK_WIDTH / 2 + this.KERB_WIDTH + 0.4
    const up = new THREE.Vector3(0, 1, 0)

    const barrierGroup = new THREE.Group()

    const step = 2
    for (let i = 0; i < this.NUM_SEGMENTS; i += step) {
      const idx1 = i
      const idx2 = (i + step) % this.NUM_SEGMENTS

      const pt1 = points[idx1]
      const pt2 = points[idx2]

      const t1 = this.trackCurve.getTangent(idx1 / this.NUM_SEGMENTS)
      const side1 = new THREE.Vector3().crossVectors(t1, up).normalize()

      const t2 = this.trackCurve.getTangent(idx2 / this.NUM_SEGMENTS)
      const side2 = new THREE.Vector3().crossVectors(t2, up).normalize()

      // Left Barrier Section
      const pL1 = pt1.clone().addScaledVector(side1, -barrierDist)
      const pL2 = pt2.clone().addScaledVector(side2, -barrierDist)
      this.createBarrierSegment(pL1, pL2, barrierGroup)

      // Right Barrier Section
      const pR1 = pt1.clone().addScaledVector(side1, barrierDist)
      const pR2 = pt2.clone().addScaledVector(side2, barrierDist)
      this.createBarrierSegment(pR1, pR2, barrierGroup)
    }

    barrierGroup.matrixAutoUpdate = false
    barrierGroup.updateMatrix()
    this.group.add(barrierGroup)
  }

  private createBarrierSegment(p1: THREE.Vector3, p2: THREE.Vector3, parent: THREE.Group) {
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5)
    const len = p1.distanceTo(p2)
    const angle = Math.atan2(p2.x - p1.x, p2.z - p1.z)

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.65, len),
      this.materials.barrierArmco
    )
    rail.position.set(mid.x, 0.42, mid.z)
    rail.rotation.y = angle
    parent.add(rail)

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.8, 6),
      this.materials.barrierPost
    )
    post.position.set(p1.x, 0.4, p1.z)
    parent.add(post)

    // Rapier Physics Static Box Collider
    const halfX = Math.abs(Math.sin(angle)) * (len / 2) + 0.25
    const halfZ = Math.abs(Math.cos(angle)) * (len / 2) + 0.25
    this.physicsWorld.createStaticBoxCollider(mid.x, 0.45, mid.z, halfX, 0.45, halfZ, 0.6, 0.2)
  }

  // --- 7. CIRCUIT SCENERY (Grandstands, Trees, Brake Markers, Lights) ---
  private createScenery() {
    const scenery = new THREE.Group()
    const zOffset = this.offset.z

    // 7.1 Spectator Grandstands along Main Straight
    const standGeo = new THREE.BoxGeometry(6.0, 4.0, 50.0)
    const stand = new THREE.Mesh(standGeo, this.materials.bleachers)
    stand.position.set(this.TRACK_WIDTH / 2 + 6.0, 2.0, -10.0 + zOffset)
    scenery.add(stand)

    const canopyGeo = new THREE.BoxGeometry(8.0, 0.3, 52.0)
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 })
    const canopy = new THREE.Mesh(canopyGeo, canopyMat)
    canopy.position.set(this.TRACK_WIDTH / 2 + 5.0, 5.2, -10.0 + zOffset)
    canopy.rotation.z = -0.15
    scenery.add(canopy)

    // 7.2 Brake Distance Marker Boards (150m, 100m, 50m before Turn 1)
    const markerDistances = [
      { z: 15, text: '150' },
      { z: 30, text: '100' },
      { z: 45, text: '50' },
    ]
    markerDistances.forEach((m) => {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1.2, 1.8),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
      )
      board.position.set(-this.TRACK_WIDTH / 2 - 2.0, 0.9, m.z + zOffset)
      scenery.add(board)
    })

    // 7.3 Stylized Low-Poly Pine Trees throughout the Infield
    const treeTrunkGeo = new THREE.CylinderGeometry(0.2, 0.35, 2.4, 6)
    const treeFoliageGeo = new THREE.ConeGeometry(1.6, 3.8, 6)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x422a1d, roughness: 0.9 })
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.8, flatShading: true })

    const infieldTreePositions = [
      { x: 15, z: 20 },
      { x: 25, z: 0 },
      { x: 35, z: -25 },
      { x: 20, z: -50 },
      { x: -10, z: -20 },
      { x: -25, z: 10 },
      { x: 55, z: 30 },
      { x: 55, z: -40 },
      { x: -55, z: -10 },
      { x: 60, z: 85 },
      { x: 80, z: -95 },
      { x: 0, z: -110 },
    ]

    infieldTreePositions.forEach((pos) => {
      const realZ = pos.z + zOffset
      const tree = new THREE.Group()
      tree.position.set(pos.x, 0, realZ)

      const trunk = new THREE.Mesh(treeTrunkGeo, trunkMat)
      trunk.position.y = 1.2
      tree.add(trunk)

      const foliage = new THREE.Mesh(treeFoliageGeo, foliageMat)
      foliage.position.y = 3.6
      tree.add(foliage)

      scenery.add(tree)

      this.physicsWorld.createStaticBoxCollider(pos.x, 1.5, realZ, 0.4, 1.5, 0.4)
    })

    scenery.matrixAutoUpdate = false
    scenery.updateMatrix()
    this.group.add(scenery)
  }

  // --- 8. CIRCUIT CHECKPOINTS SYSTEM ---
  private setupCheckpoints() {
    const tValues = [
      { t: 0.0, name: 'Bitiş Çizgisi' },
      { t: 0.22, name: 'Şikan Çıkışı' },
      { t: 0.40, name: 'Arka Düzlük' },
      { t: 0.55, name: 'Viraj 3 (Hairpin)' },
      { t: 0.72, name: 'S-Virajları' },
      { t: 0.88, name: 'Son Viraj' },
    ]

    this.checkpoints = tValues.map((item, index) => {
      const pos = this.trackCurve.getPoint(item.t)
      const forward = this.trackCurve.getTangent(item.t)
      return {
        id: index,
        name: item.name,
        position: pos,
        forward: forward,
        radius: this.TRACK_WIDTH * 0.95,
      }
    })

    this.lapState.totalCheckpoints = this.checkpoints.length
  }

  // --- 9. FRAME UPDATE & LAP VALIDATION ---
  public update(delta: number, carPosition: THREE.Vector3): LapState {
    this.lapState.currentLapTime += delta
    this.lapState.isLapComplete = false
    this.lapState.lapMessage = null

    const targetCp = this.checkpoints[this.lapState.nextCheckpointIndex]
    const distToTarget = new THREE.Vector2(
      carPosition.x - targetCp.position.x,
      carPosition.z - targetCp.position.z
    ).length()

    if (distToTarget <= targetCp.radius) {
      if (this.lapState.nextCheckpointIndex === 0) {
        // Completed a full lap!
        this.lapState.isLapComplete = true
        this.lapState.lastLapTime = this.lapState.currentLapTime

        if (this.lapState.bestLapTime === null || this.lapState.currentLapTime < this.lapState.bestLapTime) {
          this.lapState.bestLapTime = this.lapState.currentLapTime
        }

        this.lapState.lapMessage = `Tur ${this.lapState.currentLap} Tamamlandı! (${this.lapState.currentLapTime.toFixed(2)}s)`
        this.lapState.currentLap++
        this.lapState.currentLapTime = 0
        this.lapState.nextCheckpointIndex = 1
      } else {
        // Passed intermediate checkpoint
        this.lapState.lapMessage = `${targetCp.name} Geçildi (${this.lapState.nextCheckpointIndex}/${this.checkpoints.length - 1})`
        this.lapState.nextCheckpointIndex = (this.lapState.nextCheckpointIndex + 1) % this.checkpoints.length
      }
    }

    return this.lapState
  }

  public getPolePosition(): TrackSpawnPoint {
    return this.spawnPoints[0]
  }

  public setVisible(visible: boolean) {
    this.group.visible = visible
  }
}
