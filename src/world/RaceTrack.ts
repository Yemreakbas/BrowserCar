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

/**
 * RaceTrack provides a wide, flowing, professional Grand Prix circuit (~750m),
 * with rotated Armco barrier physics (zero road encroachment), red/white kerbs,
 * start/finish gantry, distance boards, grandstands, and accurate spline tangent tracking.
 */
export class RaceTrack {
  public group: THREE.Group
  private physicsWorld: PhysicsWorld
  public isLoaded: boolean = true

  // World Offset (Places RaceTrack 600m away from City to prevent collider overlap)
  public readonly offset: THREE.Vector3 = new THREE.Vector3(0, 0, 600)

  // Track Curve & Geometry Data
  private trackCurve!: THREE.CatmullRomCurve3
  private readonly TRACK_WIDTH = 16.5 // Wide and spacious for overtaking & clean racing
  private readonly KERB_WIDTH = 1.6
  private readonly NUM_SEGMENTS = 180

  // Pre-sampled spline tangents for instant, accurate track heading lookup anywhere on circuit
  private splineSamples: Array<{ point: THREE.Vector3; tangent: THREE.Vector3; t: number }> = []

  // Checkpoints & Lap System
  public checkpoints: TrackCheckpoint[] = []
  public lapState: LapState = {
    currentLap: 1,
    totalLaps: 3,
    currentLapTime: 0,
    bestLapTime: null,
    lastLapTime: null,
    nextCheckpointIndex: 1,
    totalCheckpoints: 0,
    isLapComplete: false,
    lapMessage: 'Grand Prix Pisti Hazır! 1. Tura Başla',
  }

  // Starting Grid & Pit Spawns on Main Straight (Heading +Z towards Gantry at Z = 590)
  public readonly spawnPoints: TrackSpawnPoint[] = [
    {
      id: 'pole-position',
      name: 'Grid 1 (Pole Pozisyonu)',
      position: new THREE.Vector3(2.8, 0.05, 575),
      rotationY: 0,
    },
    {
      id: 'grid-2',
      name: 'Grid 2 (Ön Sıra Dış)',
      position: new THREE.Vector3(-2.8, 0.05, 565),
      rotationY: 0,
    },
    {
      id: 'grid-3',
      name: 'Grid 3 (İkinci Sıra)',
      position: new THREE.Vector3(2.8, 0.05, 555),
      rotationY: 0,
    },
    {
      id: 'grid-4',
      name: 'Grid 4 (İkinci Sıra Dış)',
      position: new THREE.Vector3(-2.8, 0.05, 545),
      rotationY: 0,
    },
    {
      id: 'pit-lane',
      name: 'Pit Yolu (Çıkış)',
      position: new THREE.Vector3(13.5, 0.05, 580),
      rotationY: 0,
    },
  ]

  // Shared Materials
  private materials = {
    asphalt: new THREE.MeshStandardMaterial({
      color: 0x181a1f,
      roughness: 0.75,
      metalness: 0.12,
    }),
    grass: new THREE.MeshStandardMaterial({
      color: 0x166534, // Vibrant circuit outfield grass
      roughness: 0.95,
      metalness: 0.04,
    }),
    kerbRed: new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.45 }),
    kerbWhite: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 }),
    barrierArmco: new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.75,
      roughness: 0.28,
    }),
    barrierPost: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 }),
    overheadGantry: new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.25,
    }),
    bleachers: new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.55 }),
    brakeBoard: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }),
  }

  constructor(scene: THREE.Scene, physicsWorld: PhysicsWorld) {
    this.physicsWorld = physicsWorld
    this.group = new THREE.Group()
    this.group.name = 'RaceTrackWorldGroup'
    scene.add(this.group)

    // 1. Build the mathematical circuit path spline (anchored at Z = 600)
    this.buildCircuitSpline()
    this.initSplineSamples()

    // 2. Build continuous track ribbon, rumble strips, and road markings
    this.createRoadSurface()
    this.createRumbleStrips()
    this.createStartFinishGantry()
    this.createStartingGridBoxes()

    // 3. Build track barriers with Rapier ROTATED physics colliders
    this.createTrackBarriers()

    // 4. Build circuit scenery (grandstands, brake markers, trees, floodlights)
    this.createScenery()

    // 5. Initialize Checkpoints
    this.setupCheckpoints()
  }

  // --- 1. CIRCUIT SPLINE ---
  private buildCircuitSpline() {
    // A grand, flowing ~750m international racing circuit situated around Z = 600:
    // Long Main Straight -> High-Speed Sweeper (T1-T2) -> Back Straight -> Wide Parabolic Hairpin (T3)
    // -> Flowing S-Chicane (T4-T5) -> Infield Straight -> Parabolica (T6-T7) -> Main Straight
    const zOffset = this.offset.z // 600
    const controlPoints = [
      new THREE.Vector3(0, 0, -85 + zOffset),   // P0: Start-Finish Straight South (Z = 515)
      new THREE.Vector3(0, 0, -10 + zOffset),   // P1: Start-Finish Gantry (Z = 590)
      new THREE.Vector3(0, 0, 55 + zOffset),    // P2: End of Main Straight, Turn 1 Braking (Z = 655)
      new THREE.Vector3(28, 0, 98 + zOffset),   // P3: Turn 1 Entry (Wide Right Sweeper)
      new THREE.Vector3(68, 0, 112 + zOffset),  // P4: Turn 1 Apex
      new THREE.Vector3(108, 0, 85 + zOffset),  // P5: Turn 2 Exit onto Back Straight
      new THREE.Vector3(118, 0, 25 + zOffset),  // P6: Back Straight High-Speed Section
      new THREE.Vector3(118, 0, -45 + zOffset), // P7: Back Straight Braking Zone (150m board)
      new THREE.Vector3(98, 0, -105 + zOffset), // P8: Hairpin Entry (Turn 3)
      new THREE.Vector3(55, 0, -125 + zOffset), // P9: Hairpin Apex (Wide & Smooth)
      new THREE.Vector3(12, 0, -105 + zOffset), // P10: Hairpin Exit
      new THREE.Vector3(-28, 0, -85 + zOffset), // P11: S-Curve 1 (Left Flick)
      new THREE.Vector3(-58, 0, -48 + zOffset), // P12: S-Curve 2 (Right Transition)
      new THREE.Vector3(-68, 0, 0 + zOffset),   // P13: Infield Straight
      new THREE.Vector3(-58, 0, 52 + zOffset),  // P14: Parabolica Entry
      new THREE.Vector3(-32, 0, 72 + zOffset),  // P15: Parabolica Mid-Apex
      new THREE.Vector3(-10, 0, 20 + zOffset),  // P16: Parabolica Exit onto Straight
    ]

    this.trackCurve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal', 0.5)
  }

  private initSplineSamples() {
    this.splineSamples = []
    const count = 180
    for (let i = 0; i < count; i++) {
      const t = i / count
      this.splineSamples.push({
        point: this.trackCurve.getPoint(t),
        tangent: this.trackCurve.getTangent(t).normalize(),
        t,
      })
    }
  }

  /**
   * Returns the exact tangent orientation of the road at any position on or near the circuit
   */
  public getTrackTangentAt(pos: THREE.Vector3): THREE.Vector3 {
    let minDistSq = Infinity
    let bestTangent = this.splineSamples[0].tangent

    for (let i = 0; i < this.splineSamples.length; i++) {
      const s = this.splineSamples[i]
      const dx = s.point.x - pos.x
      const dz = s.point.z - pos.z
      const dSq = dx * dx + dz * dz
      if (dSq < minDistSq) {
        minDistSq = dSq
        bestTangent = s.tangent
      }
    }
    return bestTangent
  }

  // --- 2. PROCEDURAL TRACK SURFACE ---
  private createRoadSurface() {
    // Infield & Outfield Grass Bed centered at Z = 600
    const grassGeo = new THREE.PlaneGeometry(420, 420)
    const grass = new THREE.Mesh(grassGeo, this.materials.grass)
    grass.rotation.x = -Math.PI / 2
    grass.position.set(25, -0.01, this.offset.z)
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

      vertices.push(left.x, 0.015, left.z)
      vertices.push(right.x, 0.015, right.z)

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
    const gantryZ = -10 + this.offset.z // Z = 590
    gantry.position.set(0, 0, gantryZ)

    // Checkered Start / Finish Strip on Asphalt across the road
    const checkGeo = new THREE.PlaneGeometry(0.85, 0.85)
    checkGeo.rotateX(-Math.PI / 2)
    const checkWhite = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const checkBlack = new THREE.MeshBasicMaterial({ color: 0x111111 })

    const numTiles = Math.floor(this.TRACK_WIDTH / 0.85)
    for (let i = 0; i < numTiles; i++) {
      for (let row = 0; row < 2; row++) {
        const isWhite = (i + row) % 2 === 0
        const tile = new THREE.Mesh(checkGeo, isWhite ? checkWhite : checkBlack)
        const posX = -this.TRACK_WIDTH / 2 + (i + 0.5) * 0.85
        tile.position.set(posX, 0.025, (row - 0.5) * 0.85)
        gantry.add(tile)
      }
    }

    // Overhead Truss Structure (Spans 20.5m across full track + margins)
    const pillarGeo = new THREE.BoxGeometry(0.5, 7.0, 0.5)
    const leftPillar = new THREE.Mesh(pillarGeo, this.materials.overheadGantry)
    leftPillar.position.set(-this.TRACK_WIDTH / 2 - 2.0, 3.5, 0)
    const rightPillar = new THREE.Mesh(pillarGeo, this.materials.overheadGantry)
    rightPillar.position.set(this.TRACK_WIDTH / 2 + 2.0, 3.5, 0)

    const beamGeo = new THREE.BoxGeometry(this.TRACK_WIDTH + 5.0, 0.9, 0.9)
    const beam = new THREE.Mesh(beamGeo, this.materials.overheadGantry)
    beam.position.set(0, 6.7, 0)

    // Signboard
    const signGeo = new THREE.BoxGeometry(this.TRACK_WIDTH - 2.0, 1.4, 0.15)
    const signMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3 })
    const sign = new THREE.Mesh(signGeo, signMat)
    sign.position.set(0, 6.2, 0.45)

    // Starting Lights (Red pods)
    for (let x = -3.6; x <= 3.6; x += 1.8) {
      const podMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 2.2,
      })
      const pod = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), podMat)
      pod.position.set(x, 5.1, 0.4)
      gantry.add(pod)
    }

    gantry.add(leftPillar, rightPillar, beam, sign)
    gantry.matrixAutoUpdate = false
    gantry.updateMatrix()
    this.group.add(gantry)

    // Physical colliders for gantry pillars (safe outside road margins)
    this.physicsWorld.createStaticBoxCollider(
      -this.TRACK_WIDTH / 2 - 2.0,
      3.5,
      gantryZ,
      0.4,
      3.5,
      0.4
    )
    this.physicsWorld.createStaticBoxCollider(
      this.TRACK_WIDTH / 2 + 2.0,
      3.5,
      gantryZ,
      0.4,
      3.5,
      0.4
    )
  }

  // --- 5. STARTING GRID BOXES ---
  private createStartingGridBoxes() {
    const gridGroup = new THREE.Group()
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff })

    const addGridBox = (x: number, z: number) => {
      const frontLine = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.18).rotateX(-Math.PI / 2), lineMat)
      frontLine.position.set(x, 0.025, z)

      const leftLine = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 4.6).rotateX(-Math.PI / 2), lineMat)
      leftLine.position.set(x - 1.3, 0.025, z - 2.3)

      const rightLine = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 4.6).rotateX(-Math.PI / 2), lineMat)
      rightLine.position.set(x + 1.3, 0.025, z - 2.3)

      gridGroup.add(frontLine, leftLine, rightLine)
    }

    // Lined up nicely on the main straight before the finish gantry at Z = 590
    addGridBox(2.8, 575)   // P1 (Pole)
    addGridBox(-2.8, 565)  // P2
    addGridBox(2.8, 555)   // P3
    addGridBox(-2.8, 545)  // P4
    addGridBox(2.8, 535)   // P5
    addGridBox(-2.8, 525)  // P6
    addGridBox(2.8, 515)   // P7
    addGridBox(-2.8, 505)  // P8

    gridGroup.matrixAutoUpdate = false
    gridGroup.updateMatrix()
    this.group.add(gridGroup)
  }

  // --- 6. CONTINUOUS TRACK BARRIERS WITH ROTATED COLLIDERS ---
  private createTrackBarriers() {
    const points = this.trackCurve.getSpacedPoints(this.NUM_SEGMENTS)
    const barrierDist = this.TRACK_WIDTH / 2 + this.KERB_WIDTH + 0.5
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
      new THREE.BoxGeometry(0.2, 0.75, len),
      this.materials.barrierArmco
    )
    rail.position.set(mid.x, 0.45, mid.z)
    rail.rotation.y = angle
    parent.add(rail)

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.85, 6),
      this.materials.barrierPost
    )
    post.position.set(p1.x, 0.42, p1.z)
    parent.add(post)

    // Accurate ROTATED Rapier Physics Static Box Collider
    // Thin 0.35m rail exactly matches 3D mesh, preventing any invisible blocking walls on the track!
    this.physicsWorld.createStaticRotatedBoxCollider(
      mid.x,
      0.45,
      mid.z,
      0.18,          // halfX: thin barrier width (0.36m)
      0.45,          // halfY: barrier height
      len / 2 + 0.05,// halfZ: exact segment length
      angle,         // rotation matching road curvature
      0.55,
      0.15
    )
  }

  // --- 7. CIRCUIT SCENERY (Grandstands, Brake Markers, Outfield Trees) ---
  private createScenery() {
    const scenery = new THREE.Group()
    const zOffset = this.offset.z

    // 7.1 Spectator Grandstands along Main Straight
    const standGeo = new THREE.BoxGeometry(8.0, 5.0, 75.0)
    const stand = new THREE.Mesh(standGeo, this.materials.bleachers)
    stand.position.set(this.TRACK_WIDTH / 2 + 7.5, 2.5, -20.0 + zOffset)
    scenery.add(stand)

    const canopyGeo = new THREE.BoxGeometry(10.0, 0.35, 78.0)
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 })
    const canopy = new THREE.Mesh(canopyGeo, canopyMat)
    canopy.position.set(this.TRACK_WIDTH / 2 + 6.5, 6.2, -20.0 + zOffset)
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
        new THREE.BoxGeometry(0.12, 1.4, 2.0),
        this.materials.brakeBoard
      )
      board.position.set(-this.TRACK_WIDTH / 2 - 2.4, 1.0, m.z + zOffset)
      scenery.add(board)
    })

    // 7.3 Trees positioned safely in the outfield (at least 25m away from track edges)
    const treeTrunkGeo = new THREE.CylinderGeometry(0.24, 0.38, 2.6, 6)
    const treeFoliageGeo = new THREE.ConeGeometry(1.8, 4.2, 6)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x422a1d, roughness: 0.9 })
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.8, flatShading: true })

    const outfieldTreePositions = [
      { x: -95, z: -110 },
      { x: -110, z: -30 },
      { x: -105, z: 60 },
      { x: -75, z: 125 },
      { x: -20, z: 135 },
      { x: 50, z: 145 },
      { x: 120, z: 135 },
      { x: 155, z: 60 },
      { x: 155, z: -20 },
      { x: 145, z: -90 },
      { x: 105, z: -145 },
      { x: 35, z: -155 },
      { x: -45, z: -145 },
      // Safe center infield (well away from curves)
      { x: 0, z: -20 },
      { x: 35, z: 10 },
      { x: 55, z: -30 },
    ]

    outfieldTreePositions.forEach((pos) => {
      const realZ = pos.z + zOffset
      const tree = new THREE.Group()
      tree.position.set(pos.x, 0, realZ)

      const trunk = new THREE.Mesh(treeTrunkGeo, trunkMat)
      trunk.position.y = 1.3
      tree.add(trunk)

      const foliage = new THREE.Mesh(treeFoliageGeo, foliageMat)
      foliage.position.y = 3.8
      tree.add(foliage)

      scenery.add(tree)

      this.physicsWorld.createStaticBoxCollider(pos.x, 1.5, realZ, 0.45, 1.5, 0.45)
    })

    scenery.matrixAutoUpdate = false
    scenery.updateMatrix()
    this.group.add(scenery)
  }

  // --- 8. CIRCUIT CHECKPOINTS SYSTEM ---
  private setupCheckpoints() {
    const tValues = [
      { t: 0.045, name: 'Bitiş Çizgisi' },
      { t: 0.16,  name: 'Viraj 1 Girişi' },
      { t: 0.28,  name: 'Viraj 2 Çıkışı' },
      { t: 0.40,  name: 'Arka Düzlük' },
      { t: 0.54,  name: 'Viraj 3 (Hairpin)' },
      { t: 0.67,  name: 'S-Virajları' },
      { t: 0.79,  name: 'İç Düzlük' },
      { t: 0.91,  name: 'Son Viraj (Parabolica)' },
    ]

    this.checkpoints = tValues.map((item, index) => {
      const pos = this.trackCurve.getPoint(item.t)
      const forward = this.trackCurve.getTangent(item.t).normalize()
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

  public getCheckpointRespawn(checkpointIndex: number): { position: THREE.Vector3; rotationY: number; name: string } {
    if (!this.checkpoints || this.checkpoints.length === 0) {
      const pole = this.getPolePosition()
      return { position: pole.position.clone(), rotationY: pole.rotationY, name: pole.name }
    }
    const idx = ((checkpointIndex % this.checkpoints.length) + this.checkpoints.length) % this.checkpoints.length
    const cp = this.checkpoints[idx]
    const rotY = Math.atan2(cp.forward.x, cp.forward.z)
    return {
      position: cp.position.clone(),
      rotationY: rotY,
      name: cp.name,
    }
  }

  public getTrackCurve(): THREE.CatmullRomCurve3 {
    return this.trackCurve
  }

  public setVisible(visible: boolean) {
    this.group.visible = visible
  }

  public getAsphaltMaterials(): THREE.MeshStandardMaterial[] {
    return [this.materials.asphalt]
  }
}
