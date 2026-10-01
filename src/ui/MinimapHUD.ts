import * as THREE from 'three'
import type { Vehicle } from '../vehicle/Vehicle.ts'
import type { PoliceChaseSystem } from '../effects/PoliceChaseSystem.ts'
import type { AIManager } from '../ai/AIManager.ts'
import type { RemoteVehicle } from '../vehicle/RemoteVehicle.ts'
import type { RaceTrack } from '../world/RaceTrack.ts'
import { CITY_BLOCKS } from '../world/CityCollisionHelper.ts'

export interface MinimapOptions {
  radius?: number
  zoomMeters?: number
}

/**
 * Modern Glassmorphic GPS Radar & Minimap HUD.
 * Renders an orienting top-down radar view showing:
 * - City road grid & Grand Prix race track
 * - Player vehicle heading arrow
 * - Police pursuit cruisers with emergency strobe blips
 * - Traffic AI cars & Multiplayer competitors
 * - Checkpoints during active races
 */
export class MinimapHUD {
  private container: HTMLDivElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  public isVisible: boolean = true

  private readonly radarRadius = 78
  private readonly zoomMeters = 88 // Visible radius in meters
  private tempForward = new THREE.Vector3()

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'hud-minimap-container'
    this.container.className = 'hud-minimap-container'
    this.container.innerHTML = `
      <canvas id="hud-minimap-canvas" width="160" height="160"></canvas>
      <div class="minimap-compass-n">N</div>
      <div class="minimap-zoom-badge">GPS</div>
    `
    document.body.appendChild(this.container)

    this.canvas = this.container.querySelector('#hud-minimap-canvas') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d')!
  }

  /**
   * Main render loop called every frame (60 FPS)
   */
  public update(
    vehicle: Vehicle,
    policeChase?: PoliceChaseSystem,
    aiManager?: AIManager,
    remoteVehicles?: Map<string, RemoteVehicle>,
    raceTrack?: RaceTrack,
    isRaceMode?: boolean
  ): void {
    if (!this.isVisible || !vehicle.root) {
      if (this.container.style.display !== 'none') this.container.style.display = 'none'
      return
    }

    if (this.container.style.display !== 'block') this.container.style.display = 'block'

    const ctx = this.ctx
    const cx = 80
    const cy = 80
    const r = this.radarRadius
    const scale = r / this.zoomMeters

    ctx.clearRect(0, 0, 160, 160)

    // 1. Clip to circular radar boundary
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2)
    ctx.clip()

    // Radar Dark Glass Background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
    ctx.fillRect(0, 0, 160, 160)

    // Player position and yaw
    const playerPos = vehicle.root.position
    vehicle.root.getWorldDirection(this.tempForward)
    const playerHeading = Math.atan2(this.tempForward.x, this.tempForward.z)

    // Transform world to radar coordinates (player-centric, rotating with heading)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-playerHeading)

    // 2. Draw City Blocks & Avenues
    if (!isRaceMode) {
      ctx.fillStyle = 'rgba(30, 41, 59, 0.95)'
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)'
      ctx.lineWidth = 1.0

      for (const block of CITY_BLOCKS) {
        const dx = block.centerX - playerPos.x
        const dz = block.centerZ - playerPos.z

        // Screen coords: +X is right, +Z is DOWN in 2D canvas, but heading up
        const rx = dx * scale
        const ry = dz * scale
        const rw = (block.maxX - block.minX) * scale
        const rd = (block.maxZ - block.minZ) * scale

        // Check if within radar bounding box
        if (Math.hypot(rx, ry) < r + 45) {
          ctx.fillRect(rx - rw / 2, ry - rd / 2, rw, rd)
          ctx.strokeRect(rx - rw / 2, ry - rd / 2, rw, rd)
        }
      }
    } else if (raceTrack && raceTrack.checkpoints) {
      // 3. Draw Grand Prix Track outline in race mode
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
      ctx.lineWidth = 4.0
      ctx.beginPath()
      let first = true
      for (const cp of raceTrack.checkpoints) {
        const dx = cp.position.x - playerPos.x
        const dz = cp.position.z - playerPos.z
        const rx = dx * scale
        const ry = dz * scale
        if (first) {
          ctx.moveTo(rx, ry)
          first = false
        } else {
          ctx.lineTo(rx, ry)
        }
      }
      ctx.closePath()
      ctx.stroke()

      // Checkpoints
      raceTrack.checkpoints.forEach((cp, idx) => {
        const dx = cp.position.x - playerPos.x
        const dz = cp.position.z - playerPos.z
        const rx = dx * scale
        const ry = dz * scale
        if (Math.hypot(rx, ry) < r + 15) {
          ctx.fillStyle = idx === 0 ? '#facc15' : '#38bdf8'
          ctx.beginPath()
          ctx.arc(rx, ry, 3.2, 0, Math.PI * 2)
          ctx.fill()
        }
      })
    }

    // 4. Draw Traffic AI Vehicles (White/Slate dots)
    if (aiManager && aiManager.vehicles) {
      const traffic = aiManager.vehicles
      ctx.fillStyle = '#cbd5e1'
      for (const ai of traffic) {
        const dx = (ai.root.position.x - playerPos.x) * scale
        const dz = (ai.root.position.z - playerPos.z) * scale
        if (Math.hypot(dx, dz) < r - 2) {
          ctx.beginPath()
          ctx.arc(dx, dz, 2.4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    // 5. Draw Remote Multiplayer Cars (Colored dots)
    if (remoteVehicles) {
      for (const [, remoteCar] of remoteVehicles.entries()) {
        const dx = (remoteCar.root.position.x - playerPos.x) * scale
        const dz = (remoteCar.root.position.z - playerPos.z) * scale
        if (Math.hypot(dx, dz) < r - 2) {
          ctx.fillStyle = '#f59e0b'
          ctx.beginPath()
          ctx.arc(dx, dz, 3.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.0
          ctx.stroke()
        }
      }
    }

    // 6. Draw Police Cruisers (Flashing Red / Blue beacons)
    if (policeChase && policeChase.units) {
      const now = performance.now() * 0.008
      for (const unit of policeChase.units) {
        if (!unit.active) continue
        const dx = (unit.root.position.x - playerPos.x) * scale
        const dz = (unit.root.position.z - playerPos.z) * scale
        const dist = Math.hypot(dx, dz)

        if (dist < r - 2) {
          // Flashing siren color
          const isRed = Math.sin(now * 5.0 + unit.strobePhase) > 0
          ctx.fillStyle = isRed ? '#ef4444' : '#3b82f6'
          ctx.beginPath()
          ctx.arc(dx, dz, 4.2, 0, Math.PI * 2)
          ctx.fill()

          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.2
          ctx.stroke()
        }
      }
    }

    ctx.restore() // End world rotation

    // 7. Radar Range Rings & Crosshairs
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)'
    ctx.lineWidth = 1.0
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2)
    ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2)
    ctx.moveTo(cx - r, cy)
    ctx.lineTo(cx + r, cy)
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx, cy + r)
    ctx.stroke()

    // 8. Player Icon (Always pointing UP at center cx, cy)
    ctx.fillStyle = '#38bdf8'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cx, cy - 8)
    ctx.lineTo(cx + 6, cy + 6)
    ctx.lineTo(cx, cy + 3)
    ctx.lineTo(cx - 6, cy + 6)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.restore() // End circular clip

    // Outer Glassmorphic Border
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
    ctx.lineWidth = 2.0
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }

  public toggle(): boolean {
    this.isVisible = !this.isVisible
    this.container.style.display = this.isVisible ? 'block' : 'none'
    return this.isVisible
  }
}
