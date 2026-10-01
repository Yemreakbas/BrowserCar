import * as THREE from 'three'

export interface CityBlockAABB {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  centerX: number
  centerZ: number
}

// 16 Standard City Blocks for the enlarged 300m x 300m metropolitan grid
export const CITY_BLOCKS: CityBlockAABB[] = [
  // 1. Inner 4 Quadrant Blocks (Downtown Skyscraper Center)
  { minX: -53, maxX: -11, minZ: 11, maxZ: 53, centerX: -32, centerZ: 32 },
  { minX: 11, maxX: 53, minZ: 11, maxZ: 53, centerX: 32, centerZ: 32 },
  { minX: -53, maxX: -11, minZ: -53, maxZ: -11, centerX: -32, centerZ: -32 },
  { minX: 11, maxX: 53, minZ: -53, maxZ: -11, centerX: 32, centerZ: -32 },

  // 2. North District Blocks (Uptown High-Rise & Grand Plaza)
  { minX: -53, maxX: -11, minZ: 75, maxZ: 117, centerX: -32, centerZ: 96 },
  { minX: 11, maxX: 53, minZ: 75, maxZ: 117, centerX: 32, centerZ: 96 },

  // 3. South District Blocks (Industrial & Commercial Waterfront)
  { minX: -53, maxX: -11, minZ: -117, maxZ: -75, centerX: -32, centerZ: -96 },
  { minX: 11, maxX: 53, minZ: -117, maxZ: -75, centerX: 32, centerZ: -96 },

  // 4. East District Blocks (Financial Promenade)
  { minX: 75, maxX: 117, minZ: 11, maxZ: 53, centerX: 96, centerZ: 32 },
  { minX: 75, maxX: 117, minZ: -53, maxZ: -11, centerX: 96, centerZ: -32 },

  // 5. West District Blocks (Shopping Quarter & Boulevard)
  { minX: -117, maxX: -75, minZ: 11, maxZ: 53, centerX: -96, centerZ: 32 },
  { minX: -117, maxX: -75, minZ: -53, maxZ: -11, centerX: -96, centerZ: -32 },

  // 6. Corner Outer Blocks (Outer Suburbs & Parkways)
  { minX: 75, maxX: 117, minZ: 75, maxZ: 117, centerX: 96, centerZ: 96 },
  { minX: -117, maxX: -75, minZ: 75, maxZ: 117, centerX: -96, centerZ: 96 },
  { minX: 75, maxX: 117, minZ: -117, maxZ: -75, centerX: 96, centerZ: -96 },
  { minX: -117, maxX: -75, minZ: -117, maxZ: -75, centerX: -96, centerZ: -96 },
]

// Street Intersections in the grid for intelligent waypoint pathfinding around blocks
export const STREET_INTERSECTIONS: THREE.Vector3[] = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, 64),
  new THREE.Vector3(0, 0, -64),
  new THREE.Vector3(0, 0, 128),
  new THREE.Vector3(0, 0, -128),
  new THREE.Vector3(64, 0, 0),
  new THREE.Vector3(-64, 0, 0),
  new THREE.Vector3(128, 0, 0),
  new THREE.Vector3(-128, 0, 0),
  new THREE.Vector3(64, 0, 64),
  new THREE.Vector3(64, 0, -64),
  new THREE.Vector3(-64, 0, 64),
  new THREE.Vector3(-64, 0, -64),
  new THREE.Vector3(64, 0, 128),
  new THREE.Vector3(64, 0, -128),
  new THREE.Vector3(-64, 0, 128),
  new THREE.Vector3(-64, 0, -128),
  new THREE.Vector3(128, 0, 64),
  new THREE.Vector3(128, 0, -64),
  new THREE.Vector3(-128, 0, 64),
  new THREE.Vector3(-128, 0, -64),
]

/**
 * Checks if a 2D coordinate is inside any city building block
 */
export function isInsideCityObstacle(x: number, z: number, margin = 0.5): boolean {
  for (let i = 0; i < CITY_BLOCKS.length; i++) {
    const b = CITY_BLOCKS[i]
    if (
      x >= b.minX - margin &&
      x <= b.maxX + margin &&
      z >= b.minZ - margin &&
      z <= b.maxZ + margin
    ) {
      return true
    }
  }
  return false
}

/**
 * Resolves penetration by pushing position out to the nearest street edge.
 * Returns true if position was clamped/pushed out.
 */
export function resolveCityObstaclePenetration(
  pos: THREE.Vector3,
  carRadius: number = 1.35
): boolean {
  let wasPushed = false
  for (let i = 0; i < CITY_BLOCKS.length; i++) {
    const b = CITY_BLOCKS[i]
    if (
      pos.x >= b.minX - carRadius &&
      pos.x <= b.maxX + carRadius &&
      pos.z >= b.minZ - carRadius &&
      pos.z <= b.maxZ + carRadius
    ) {
      // Find shortest exit direction to the street
      const dLeft = Math.abs(pos.x - (b.minX - carRadius))
      const dRight = Math.abs(b.maxX + carRadius - pos.x)
      const dBottom = Math.abs(pos.z - (b.minZ - carRadius))
      const dTop = Math.abs(b.maxZ + carRadius - pos.z)

      const minDist = Math.min(dLeft, dRight, dBottom, dTop)

      if (minDist === dLeft) {
        pos.x = b.minX - carRadius
      } else if (minDist === dRight) {
        pos.x = b.maxX + carRadius
      } else if (minDist === dBottom) {
        pos.z = b.minZ - carRadius
      } else {
        pos.z = b.maxZ + carRadius
      }
      wasPushed = true
    }
  }
  return wasPushed
}

/**
 * Fast ray-cast check against city blocks (feeler whiskers)
 */
export function checkCityFeeler(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  margin = 0.6
): { hit: boolean; dist: number } {
  const step = 1.2
  const steps = Math.ceil(maxDistance / step)

  let curX = origin.x
  let curZ = origin.z

  for (let i = 1; i <= steps; i++) {
    const d = i * step
    curX = origin.x + direction.x * d
    curZ = origin.z + direction.z * d

    if (isInsideCityObstacle(curX, curZ, margin)) {
      return { hit: true, dist: d }
    }
  }
  return { hit: false, dist: maxDistance }
}

/**
 * Checks whether a line segment between two points intersects any building block
 */
export function isLineOfSightClear(from: THREE.Vector3, to: THREE.Vector3): boolean {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const dist = Math.sqrt(dx * dx + dz * dz)
  if (dist < 1.0) return true

  const steps = Math.ceil(dist / 2.5)
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const sampleX = from.x + dx * t
    const sampleZ = from.z + dz * t
    if (isInsideCityObstacle(sampleX, sampleZ, 0.4)) {
      return false
    }
  }
  return true
}

/**
 * Finds the best intermediate intersection waypoint to navigate towards when line-of-sight is blocked
 */
export function getSmartPursuitTarget(
  policePos: THREE.Vector3,
  playerPos: THREE.Vector3
): THREE.Vector3 {
  // If line of sight is clear, pursue player directly!
  if (isLineOfSightClear(policePos, playerPos)) {
    return playerPos
  }

  // Otherwise, find an intersection that has clear line-of-sight to police AND brings police closer to player
  let bestInter = STREET_INTERSECTIONS[0]
  let bestScore = Infinity

  for (let i = 0; i < STREET_INTERSECTIONS.length; i++) {
    const inter = STREET_INTERSECTIONS[i]
    const dToPolice = inter.distanceTo(policePos)

    // Consider intersections within 80m
    if (dToPolice > 5.0 && dToPolice < 85.0) {
      if (isLineOfSightClear(policePos, inter)) {
        const dToPlayer = inter.distanceTo(playerPos)
        const score = dToPolice * 0.7 + dToPlayer
        if (score < bestScore) {
          bestScore = score
          bestInter = inter
        }
      }
    }
  }

  return bestInter
}
