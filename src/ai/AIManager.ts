import * as THREE from 'three'
import { AIVehicle } from './AIVehicle.ts'
import type { RaceTrack } from '../world/RaceTrack.ts'
import type { CityWorld } from '../world/CityWorld.ts'
import type { Vehicle } from '../vehicle/Vehicle.ts'

export interface RacerStanding {
  id: string
  name: string
  isPlayer: boolean
  lap: number
  bestLap: number | null
  totalTime: number
  isFinished: boolean
  rank: number
}

export class AIManager {
  private scene: THREE.Scene
  public vehicles: AIVehicle[] = []
  public isEnabled: boolean = true
  public activeMode: 'NONE' | 'RACE' | 'CITY' = 'NONE'

  // Zero-allocation obstacle cache for 60+ FPS
  private obstaclesPool: Array<{ position: THREE.Vector3; speed: number; forward: THREE.Vector3 }> = []
  private playerForward = new THREE.Vector3()

  // Predefined AI Opponent Profiles
  private static readonly RACER_PROFILES = [
    {
      id: 'ai_vortex',
      name: 'Vortex AI',
      modelPath: '/assets/cars/race.glb',
      color: 0xef4444, // Racing Red
      maxSpeed: 38.5,
      acceleration: 28.0,
      brakePower: 36.0,
      steerRate: 11.0,
    },
    {
      id: 'ai_cyberion',
      name: 'Cyberion AI',
      modelPath: '/assets/cars/race-future.glb',
      color: 0x8b5cf6, // Electric Violet
      maxSpeed: 37.0,
      acceleration: 26.5,
      brakePower: 34.0,
      steerRate: 10.5,
    },
    {
      id: 'ai_driftpulse',
      name: 'Drift Pulse AI',
      modelPath: '/assets/cars/hatchback-sports.glb',
      color: 0x10b981, // Emerald Green
      maxSpeed: 35.5,
      acceleration: 25.0,
      brakePower: 32.0,
      steerRate: 10.0,
    },
    {
      id: 'ai_interceptor',
      name: 'Interceptor AI',
      modelPath: '/assets/cars/police.glb',
      color: 0x3b82f6, // Royal Blue
      maxSpeed: 36.0,
      acceleration: 26.0,
      brakePower: 35.0,
      steerRate: 10.2,
    },
  ]

  // City Traffic Profiles
  private static readonly TRAFFIC_PROFILES = [
    {
      id: 'traffic_taxi',
      name: 'Sarı Taksi',
      modelPath: '/assets/cars/taxi.glb',
      color: 0xf59e0b,
      maxSpeed: 16.0,
      acceleration: 15.0,
    },
    {
      id: 'traffic_sedan',
      name: 'Şehir Sedanı',
      modelPath: '/assets/cars/sedan.glb',
      color: 0x3b82f6,
      maxSpeed: 15.0,
      acceleration: 14.0,
    },
    {
      id: 'traffic_suv',
      name: 'Lüks SUV',
      modelPath: '/assets/cars/suv-luxury.glb',
      color: 0x1e293b,
      maxSpeed: 14.5,
      acceleration: 13.0,
    },
    {
      id: 'traffic_van',
      name: 'Kargo Van',
      modelPath: '/assets/cars/van.glb',
      color: 0x64748b,
      maxSpeed: 13.5,
      acceleration: 12.0,
    },
    {
      id: 'traffic_hatch',
      name: 'Kompakt Hatch',
      modelPath: '/assets/cars/hatchback-sports.glb',
      color: 0xec4899,
      maxSpeed: 16.5,
      acceleration: 16.0,
    },
  ]

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  // --- 1. RACE MODE AI INITIALIZATION ---
  public initRaceAI(raceTrack: RaceTrack) {
    this.clear()
    this.activeMode = 'RACE'

    // Generate smooth 120-point circuit spline
    const curve = raceTrack.getTrackCurve()
    if (!curve) return
    const splinePoints = curve.getSpacedPoints(120)

    // Predefined starting grid slots for AI opponents
    const gridSlots = [
      { x: -2.5, y: 0.05, z: 563, rotY: 0 }, // Grid 2
      { x: 2.5, y: 0.05, z: 556, rotY: 0 },  // Grid 3
      { x: -2.5, y: 0.05, z: 549, rotY: 0 }, // Grid 4
    ]

    for (let i = 0; i < gridSlots.length; i++) {
      const profile = AIManager.RACER_PROFILES[i % AIManager.RACER_PROFILES.length]
      const slot = gridSlots[i]

      const ai = new AIVehicle(this.scene, {
        id: profile.id,
        name: profile.name,
        modelPath: profile.modelPath,
        color: profile.color,
        role: 'RACER',
        maxSpeed: profile.maxSpeed,
        acceleration: profile.acceleration,
        brakePower: profile.brakePower,
        steerRate: profile.steerRate,
      })

      ai.setWaypoints(splinePoints, 0)
      ai.reset(new THREE.Vector3(slot.x, slot.y, slot.z), slot.rotY, 0)
      ai.isLocked = true // Locked on starting grid until green light
      this.vehicles.push(ai)
    }
  }

  public setRaceLocked(locked: boolean) {
    for (const v of this.vehicles) {
      if (v.role === 'RACER') {
        v.isLocked = locked
      }
    }
  }

  // --- 2. CITY TRAFFIC INITIALIZATION ---
  public initCityTraffic(_cityWorld: CityWorld) {
    this.clear()
    this.activeMode = 'CITY'

    // Continuous boulevard & perimeter loop for city traffic (driving in right lanes)
    // Road width is ~12-14m, lane center is ~3.2m offset from road axis
    const routeOuterLoop = [
      new THREE.Vector3(3.4, 0, -60),
      new THREE.Vector3(3.4, 0, -4.0),
      new THREE.Vector3(60, 0, -4.0),
      new THREE.Vector3(60, 0, 4.0),
      new THREE.Vector3(3.4, 0, 4.0),
      new THREE.Vector3(3.4, 0, 60),
      new THREE.Vector3(-3.4, 0, 60),
      new THREE.Vector3(-3.4, 0, 4.0),
      new THREE.Vector3(-60, 0, 4.0),
      new THREE.Vector3(-60, 0, -4.0),
      new THREE.Vector3(-3.4, 0, -4.0),
      new THREE.Vector3(-3.4, 0, -60),
    ]

    const routePerimeter = [
      new THREE.Vector3(56, 0, -56),
      new THREE.Vector3(56, 0, 56),
      new THREE.Vector3(-56, 0, 56),
      new THREE.Vector3(-56, 0, -56),
    ]

    const routes = [routeOuterLoop, routePerimeter]

    for (let i = 0; i < AIManager.TRAFFIC_PROFILES.length; i++) {
      const profile = AIManager.TRAFFIC_PROFILES[i]
      const selectedRoute = routes[i % routes.length]
      const startIndex = Math.floor((i * selectedRoute.length) / AIManager.TRAFFIC_PROFILES.length)
      const startWp = selectedRoute[startIndex]
      const nextWp = selectedRoute[(startIndex + 1) % selectedRoute.length]

      const forward = new THREE.Vector3().subVectors(nextWp, startWp).normalize()
      const rotY = Math.atan2(forward.x, forward.z)

      const ai = new AIVehicle(this.scene, {
        id: profile.id,
        name: profile.name,
        modelPath: profile.modelPath,
        color: profile.color,
        role: 'TRAFFIC',
        maxSpeed: profile.maxSpeed,
        acceleration: profile.acceleration,
        brakePower: 26.0,
        steerRate: 7.5,
      })

      ai.waypointRadius = 8.0
      ai.setWaypoints(selectedRoute, startIndex)
      ai.reset(startWp.clone(), rotY, startIndex)
      this.vehicles.push(ai)
    }
  }

  // --- 3. RUNTIME UPDATE ---
  public update(delta: number, playerVehicle: Vehicle, isNight: boolean = false): { playerRank: number; totalRacers: number } {
    if (!this.isEnabled || this.vehicles.length === 0) {
      return { playerRank: 1, totalRacers: 1 }
    }

    const playerPos = playerVehicle.root.position
    this.playerForward.set(0, 0, 1).applyQuaternion(playerVehicle.root.quaternion)

    const neededCount = 1 + this.vehicles.length
    while (this.obstaclesPool.length < neededCount) {
      this.obstaclesPool.push({
        position: new THREE.Vector3(),
        speed: 0,
        forward: new THREE.Vector3(),
      })
    }

    // Slot 0: Player
    this.obstaclesPool[0].position.copy(playerPos)
    this.obstaclesPool[0].speed = playerVehicle.currentSpeed
    this.obstaclesPool[0].forward.copy(this.playerForward)

    // Slots 1..N: AI Vehicles
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i]
      const obs = this.obstaclesPool[i + 1]
      obs.position.copy(v.root.position)
      obs.speed = v.currentSpeed
      obs.forward.set(0, 0, 1).applyQuaternion(v.root.quaternion)
    }

    // Pass active obstacles to each AI vehicle
    const activeObstacles = this.obstaclesPool.length === neededCount ? this.obstaclesPool : this.obstaclesPool.slice(0, neededCount)
    for (let i = 0; i < this.vehicles.length; i++) {
      this.vehicles[i].update(delta, activeObstacles, isNight)
    }

    // If in Race Mode, calculate player standings
    if (this.activeMode === 'RACE') {
      return this.computeRaceRank(playerPos)
    }

    return { playerRank: 1, totalRacers: 1 }
  }

  private computeRaceRank(playerPos: THREE.Vector3): { playerRank: number; totalRacers: number } {
    // Score based on lap and proximity along spline
    const totalRacers = this.vehicles.length + 1
    let playerRank = 1

    for (const ai of this.vehicles) {
      if (ai.currentLap > 1) {
        // AI is ahead on laps
        // Compare progress
        const aiScore = ai.currentLap * 1000 + ai.currentWaypointIndex
        // Approximation: player distance along circuit
        const playerWpDist = this.getApproximateCircuitIndex(playerPos, ai.waypoints)
        const playerScore = 1 * 1000 + playerWpDist
        if (aiScore > playerScore) {
          playerRank++
        }
      } else {
        const aiWp = ai.currentWaypointIndex
        const playerWp = this.getApproximateCircuitIndex(playerPos, ai.waypoints)
        if (aiWp > playerWp + 2) {
          playerRank++
        }
      }
    }

    return { playerRank: Math.min(playerRank, totalRacers), totalRacers }
  }

  private getApproximateCircuitIndex(pos: THREE.Vector3, waypoints: THREE.Vector3[]): number {
    if (!waypoints || waypoints.length === 0) return 0
    let closestIdx = 0
    let minDistSq = Infinity
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i]
      const dx = wp.x - pos.x
      const dz = wp.z - pos.z
      const dSq = dx * dx + dz * dz
      if (dSq < minDistSq) {
        minDistSq = dSq
        closestIdx = i
      }
    }
    return closestIdx
  }

  public getRaceStandings(playerTotalTime: number, playerBestLap: number | null): RacerStanding[] {
    const standings: RacerStanding[] = [
      {
        id: 'local_player',
        name: 'Sen (Oyuncu)',
        isPlayer: true,
        lap: 3,
        bestLap: playerBestLap,
        totalTime: playerTotalTime,
        isFinished: true,
        rank: 1,
      },
    ]

    for (const ai of this.vehicles) {
      if (ai.role === 'RACER') {
        standings.push({
          id: ai.id,
          name: ai.name,
          isPlayer: false,
          lap: ai.currentLap,
          bestLap: ai.bestLapTime,
          totalTime: ai.totalRaceTime,
          isFinished: ai.isFinished,
          rank: 2,
        })
      }
    }

    // Sort by totalTime ascending (fastest total time first)
    standings.sort((a, b) => a.totalTime - b.totalTime)
    standings.forEach((s, idx) => {
      s.rank = idx + 1
    })

    return standings
  }

  public clear() {
    for (const v of this.vehicles) {
      v.destroy()
    }
    this.vehicles = []
    this.activeMode = 'NONE'
  }
}
