import * as THREE from 'three'
import type { AudioManager } from '../audio/AudioManager.ts'
import type { DayNightCycle } from './DayNightCycle.ts'

export type WeatherType = 'CLEAR' | 'RAIN' | 'THUNDERSTORM' | 'FOG'

export interface WeatherPreset {
  type: WeatherType
  name: string
  icon: string
  rainIntensity: number
  wetnessTarget: number
  targetRoughness: number
  targetMetalness: number
  gripMultiplier: number
  skyDarkness: number
  fogNear: number
  fogFar: number
  thunderEnabled: boolean
}

export const WEATHER_PRESETS: Record<WeatherType, WeatherPreset> = {
  CLEAR: {
    type: 'CLEAR',
    name: 'Açık Güneşli',
    icon: '☀️',
    rainIntensity: 0.0,
    wetnessTarget: 0.0,
    targetRoughness: 0.80,
    targetMetalness: 0.12,
    gripMultiplier: 1.0,
    skyDarkness: 0.0,
    fogNear: 60,
    fogFar: 260,
    thunderEnabled: false,
  },
  RAIN: {
    type: 'RAIN',
    name: 'Yağmurlu',
    icon: '🌧️',
    rainIntensity: 0.75,
    wetnessTarget: 0.85,
    targetRoughness: 0.20,
    targetMetalness: 0.42,
    gripMultiplier: 0.84,
    skyDarkness: 0.32,
    fogNear: 38,
    fogFar: 180,
    thunderEnabled: false,
  },
  THUNDERSTORM: {
    type: 'THUNDERSTORM',
    name: 'Fırtına & Şimşek',
    icon: '⛈️',
    rainIntensity: 1.0,
    wetnessTarget: 1.0,
    targetRoughness: 0.15,
    targetMetalness: 0.48,
    gripMultiplier: 0.80,
    skyDarkness: 0.52,
    fogNear: 28,
    fogFar: 140,
    thunderEnabled: true,
  },
  FOG: {
    type: 'FOG',
    name: 'Yoğun Sis',
    icon: '🌫️',
    rainIntensity: 0.15,
    wetnessTarget: 0.45,
    targetRoughness: 0.40,
    targetMetalness: 0.25,
    gripMultiplier: 0.90,
    skyDarkness: 0.18,
    fogNear: 14,
    fogFar: 75,
    thunderEnabled: false,
  },
}

interface SprayParticle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  maxLife: number
  active: boolean
  baseScale: number
}

export class WeatherSystem {
  private scene: THREE.Scene
  private audioManager?: AudioManager
  private dayNightCycle?: DayNightCycle

  // Weather state
  public currentType: WeatherType = 'CLEAR'
  public currentWetness: number = 0.0 // 0.0 = bone dry, 1.0 = drenched
  private targetWetness: number = 0.0
  public gripMultiplier: number = 1.0

  // Registered asphalt materials for dynamic wetness & reflections
  private asphaltMaterials: Set<THREE.MeshStandardMaterial> = new Set()

  // Rain Line Segments Particle System (Optimized for 60+ FPS)
  private rainGroup: THREE.Group
  private rainCount = 950
  private rainGeometry: THREE.BufferGeometry
  private rainMaterial: THREE.LineBasicMaterial
  private rainLines: THREE.LineSegments
  private rainPositions: Float32Array
  private rainVelocities: Float32Array
  private currentRainOpacity: number = 0.0

  // Tire Water Spray System
  private sprayGroup: THREE.Group
  private sprayParticles: SprayParticle[] = []
  private maxSprayParticles = 48
  private currentSprayIndex = 0
  private sprayGeometry: THREE.BufferGeometry
  private sprayMaterial: THREE.MeshBasicMaterial
  private sprayTimer: number = 0

  // Lightning & Thunder System
  private lightningLight: THREE.DirectionalLight
  private lightningTimer: number = 8.0
  private isFlashing: boolean = false
  private flashStage: number = 0
  private flashTimer: number = 0
  private thunderDelayTimer: number = -1

  // Callbacks
  public onWeatherChanged?: (type: WeatherType, preset: WeatherPreset) => void

  constructor(scene: THREE.Scene, audioManager?: AudioManager, dayNightCycle?: DayNightCycle) {
    this.scene = scene
    this.audioManager = audioManager
    this.dayNightCycle = dayNightCycle

    // 1. Setup Rain Particle System
    this.rainGroup = new THREE.Group()
    this.rainGroup.name = 'WeatherRainGroup'
    this.scene.add(this.rainGroup)

    this.rainGeometry = new THREE.BufferGeometry()
    this.rainPositions = new Float32Array(this.rainCount * 2 * 3) // 2 vertices per line segment
    this.rainVelocities = new Float32Array(this.rainCount)

    const spanX = 76
    const spanZ = 76
    const spanY = 38

    for (let i = 0; i < this.rainCount; i++) {
      const idx = i * 6
      const x = (Math.random() - 0.5) * spanX
      const y = Math.random() * spanY
      const z = (Math.random() - 0.5) * spanZ
      const dropLen = 0.72 + Math.random() * 0.35

      // Start vertex (bottom of raindrop)
      this.rainPositions[idx] = x
      this.rainPositions[idx + 1] = y
      this.rainPositions[idx + 2] = z

      // End vertex (top of raindrop)
      this.rainPositions[idx + 3] = x
      this.rainPositions[idx + 4] = y + dropLen
      this.rainPositions[idx + 5] = z

      this.rainVelocities[i] = 48.0 + Math.random() * 16.0
    }

    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3))
    this.rainMaterial = new THREE.LineBasicMaterial({
      color: 0xc7d2fe,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    })
    this.rainLines = new THREE.LineSegments(this.rainGeometry, this.rainMaterial)
    this.rainLines.visible = false
    this.rainGroup.add(this.rainLines)

    // 2. Setup Tire Spray Particle System
    this.sprayGroup = new THREE.Group()
    this.sprayGroup.name = 'WeatherSprayGroup'
    this.scene.add(this.sprayGroup)

    this.sprayGeometry = new THREE.DodecahedronGeometry(0.22, 0)
    this.sprayMaterial = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })

    for (let i = 0; i < this.maxSprayParticles; i++) {
      const mesh = new THREE.Mesh(this.sprayGeometry, this.sprayMaterial.clone())
      mesh.visible = false
      this.sprayGroup.add(mesh)

      this.sprayParticles.push({
        mesh,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.35,
        active: false,
        baseScale: 0.3,
      })
    }

    // 3. Setup Lightning Light (hidden by default to avoid forward pass overhead)
    this.lightningLight = new THREE.DirectionalLight(0xe0f2fe, 0)
    this.lightningLight.position.set(20, 120, 20)
    this.lightningLight.name = 'WeatherLightningLight'
    this.lightningLight.visible = false
    this.scene.add(this.lightningLight)
  }

  /**
   * Registers one or multiple asphalt materials for dynamic wetness & reflection lerping
   */
  public registerAsphaltMaterials(materials: THREE.MeshStandardMaterial[]): void {
    for (const mat of materials) {
      if (!this.asphaltMaterials.has(mat)) {
        if (mat.userData.baseRoughness === undefined) {
          mat.userData.baseRoughness = mat.roughness
          mat.userData.baseMetalness = mat.metalness
        }
        this.asphaltMaterials.add(mat)
      }
    }
    this.applyWetnessToMaterials(true)
  }

  /**
   * Sets current weather condition and triggers smooth transitions
   */
  public setWeather(type: WeatherType): void {
    this.currentType = type
    const preset = WEATHER_PRESETS[type]
    this.targetWetness = preset.wetnessTarget
    this.gripMultiplier = preset.gripMultiplier

    if (this.audioManager) {
      this.audioManager.setRainIntensity(preset.rainIntensity)
    }

    if (preset.rainIntensity > 0) {
      this.rainLines.visible = true
    }

    this.lightningTimer = 5.0 + Math.random() * 6.0
    this.isFlashing = false
    this.lightningLight.intensity = 0
    this.lightningLight.visible = false

    if (this.onWeatherChanged) {
      this.onWeatherChanged(type, preset)
    }
  }

  /**
   * Cycles through the 4 weather modes: CLEAR -> RAIN -> THUNDERSTORM -> FOG -> CLEAR
   */
  public cycleWeather(): WeatherType {
    const sequence: WeatherType[] = ['CLEAR', 'RAIN', 'THUNDERSTORM', 'FOG']
    const nextIdx = (sequence.indexOf(this.currentType) + 1) % sequence.length
    const nextWeather = sequence[nextIdx]
    this.setWeather(nextWeather)
    return nextWeather
  }

  /**
   * Emits a water spray puff behind a wheel when driving on wet asphalt
   */
  public emitTireSpray(wheelPos: THREE.Vector3, carVel: THREE.Vector3): void {
    if (this.currentWetness < 0.25) return

    const p = this.sprayParticles[this.currentSprayIndex]
    this.currentSprayIndex = (this.currentSprayIndex + 1) % this.maxSprayParticles

    p.active = true
    p.life = 0
    p.maxLife = 0.28 + Math.random() * 0.15

    p.mesh.position.set(
      wheelPos.x + (Math.random() - 0.5) * 0.2,
      wheelPos.y + 0.08,
      wheelPos.z + (Math.random() - 0.5) * 0.2
    )

    // Spray plumes backwards opposite to motion and fans out
    p.velocity.set(
      carVel.x * 0.15 + (Math.random() - 0.5) * 0.6,
      0.35 + Math.random() * 0.4,
      carVel.z * 0.15 + (Math.random() - 0.5) * 0.6
    )

    p.baseScale = 0.25 + Math.random() * 0.15
    p.mesh.scale.setScalar(p.baseScale)
    ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 * this.currentWetness
    p.mesh.visible = true
  }

  /**
   * Updates wet asphalt surface reflections, rain streaks, spray particles, and atmospheric thunder
   */
  public update(
    delta: number,
    cameraPos: THREE.Vector3,
    carPos?: THREE.Vector3,
    carVelocity?: THREE.Vector3
  ): void {
    const preset = WEATHER_PRESETS[this.currentType]

    // 1. Dynamic Wetness Lerping (Throttled for High Performance)
    const prevWetness = this.currentWetness
    const wetnessLerpRate = Math.min(delta * 0.45, 0.2)
    this.currentWetness = THREE.MathUtils.lerp(this.currentWetness, this.targetWetness, wetnessLerpRate)
    if (Math.abs(this.currentWetness - prevWetness) > 0.0005 || Math.abs(this.currentWetness - this.targetWetness) > 0.001) {
      this.applyWetnessToMaterials(false)
    }

    // 2. Rain Opacity & Visibility Update
    const targetRainOpacity =
      this.currentType === 'THUNDERSTORM'
        ? 0.75
        : this.currentType === 'RAIN'
        ? 0.58
        : this.currentType === 'FOG'
        ? 0.22
        : 0.0

    this.currentRainOpacity = THREE.MathUtils.lerp(
      this.currentRainOpacity,
      targetRainOpacity,
      Math.min(delta * 3.0, 0.9)
    )
    this.rainMaterial.opacity = this.currentRainOpacity

    if (this.currentRainOpacity <= 0.01 && this.currentType === 'CLEAR') {
      this.rainLines.visible = false
    } else {
      this.rainLines.visible = true
    }

    // 3. Update Rain Particle Positions (Wrap around Camera)
    if (this.rainLines.visible) {
      const positions = this.rainPositions
      const spanX = 76
      const spanZ = 76
      const spanY = 38
      const halfX = spanX / 2
      const halfZ = spanZ / 2

      // Slant rain slightly with wind and car movement
      const windX = (this.currentType === 'THUNDERSTORM' ? -4.5 : -1.5) - (carVelocity ? carVelocity.x * 0.15 : 0)
      const windZ = (this.currentType === 'THUNDERSTORM' ? 3.0 : 1.0) - (carVelocity ? carVelocity.z * 0.15 : 0)

      for (let i = 0; i < this.rainCount; i++) {
        const idx = i * 6
        const speed = this.rainVelocities[i]
        const fallDist = speed * delta

        // Update bottom vertex
        positions[idx] += windX * delta
        positions[idx + 1] -= fallDist
        positions[idx + 2] += windZ * delta

        // Keep top vertex aligned
        const dropLen = 0.55
        positions[idx + 3] = positions[idx] - windX * 0.018
        positions[idx + 4] = positions[idx + 1] + dropLen
        positions[idx + 5] = positions[idx + 2] - windZ * 0.018

        // Wrap around camera box
        const relX = positions[idx] - cameraPos.x
        const relY = positions[idx + 1] - cameraPos.y
        const relZ = positions[idx + 2] - cameraPos.z

        if (relY < -4.0) {
          positions[idx + 1] = cameraPos.y + spanY - Math.random() * 4.0
          positions[idx + 4] = positions[idx + 1] + dropLen
          positions[idx] = cameraPos.x + (Math.random() - 0.5) * spanX
          positions[idx + 3] = positions[idx]
          positions[idx + 2] = cameraPos.z + (Math.random() - 0.5) * spanZ
          positions[idx + 5] = positions[idx + 2]
        } else if (Math.abs(relX) > halfX) {
          positions[idx] = cameraPos.x - Math.sign(relX) * (halfX - 1.0)
          positions[idx + 3] = positions[idx]
        } else if (Math.abs(relZ) > halfZ) {
          positions[idx + 2] = cameraPos.z - Math.sign(relZ) * (halfZ - 1.0)
          positions[idx + 5] = positions[idx + 2]
        }
      }

      this.rainGeometry.attributes.position.needsUpdate = true
    }

    // 4. Update Tire Spray Particles
    for (let i = 0; i < this.maxSprayParticles; i++) {
      const p = this.sprayParticles[i]
      if (!p.active) continue

      p.life += delta
      if (p.life >= p.maxLife) {
        p.active = false
        p.mesh.visible = false
        continue
      }

      p.mesh.position.x += p.velocity.x * delta
      p.mesh.position.y += p.velocity.y * delta
      p.mesh.position.z += p.velocity.z * delta
      p.velocity.multiplyScalar(Math.max(1 - delta * 4.0, 0))

      const progress = p.life / p.maxLife
      p.mesh.scale.setScalar(p.baseScale * (1.0 + progress * 2.2))
      ;(p.mesh.material as THREE.MeshBasicMaterial).opacity =
        (1.0 - progress) * 0.32 * this.currentWetness
    }

    // 4b. Continuous Tire Spray Emission when driving fast on wet roads
    if (carPos && carVelocity && this.currentWetness > 0.25) {
      const speed = Math.sqrt(carVelocity.x * carVelocity.x + carVelocity.z * carVelocity.z)
      if (speed > 4.5) { // > 16 km/h
        this.sprayTimer += delta
        const sprayInterval = Math.max(0.04, 0.12 - (speed / 40.0) * 0.08)
        if (this.sprayTimer >= sprayInterval) {
          this.sprayTimer = 0
          this.emitTireSpray(carPos, carVelocity)
        }
      }
    }

    // 5. Thunder & Lightning Logic
    if (preset.thunderEnabled) {
      this.lightningTimer -= delta
      if (this.lightningTimer <= 0 && !this.isFlashing) {
        this.triggerLightning(cameraPos)
        this.lightningTimer = 7.0 + Math.random() * 8.5
      }
    }

    if (this.isFlashing) {
      this.flashTimer -= delta
      if (this.flashTimer <= 0) {
        this.advanceFlashStage()
      }
    }

    // Thunder sound delay countdown
    if (this.thunderDelayTimer > 0) {
      this.thunderDelayTimer -= delta
      if (this.thunderDelayTimer <= 0) {
        this.thunderDelayTimer = -1
        if (this.audioManager) {
          this.audioManager.playThunder(1.0)
        }
      }
    }
  }

  /**
   * Applies wetness interpolation to all active asphalt materials
   */
  private applyWetnessToMaterials(forceInstant: boolean): void {
    const preset = WEATHER_PRESETS[this.currentType]
    const w = this.currentWetness

    for (const mat of this.asphaltMaterials) {
      const baseR = (mat.userData.baseRoughness as number) ?? 0.80
      const baseM = (mat.userData.baseMetalness as number) ?? 0.12

      // Wet surfaces become slick (low roughness) and reflect environment (higher metalness)
      const targetR = THREE.MathUtils.lerp(baseR, preset.targetRoughness, w)
      const targetM = THREE.MathUtils.lerp(baseM, preset.targetMetalness, w)

      if (forceInstant) {
        mat.roughness = targetR
        mat.metalness = targetM
      } else {
        if (Math.abs(mat.roughness - targetR) > 0.002) {
          mat.roughness = THREE.MathUtils.lerp(mat.roughness, targetR, 0.15)
        }
        if (Math.abs(mat.metalness - targetM) > 0.002) {
          mat.metalness = THREE.MathUtils.lerp(mat.metalness, targetM, 0.15)
        }
      }
    }
  }

  /**
   * Initiates realistic double-flash lightning strike
   */
  private triggerLightning(camPos: THREE.Vector3): void {
    this.isFlashing = true
    this.flashStage = 1
    this.flashTimer = 0.08
    this.lightningLight.position.set(camPos.x + 30, camPos.y + 110, camPos.z + 20)
    this.lightningLight.intensity = 4.8
    this.lightningLight.visible = true

    // Schedule delayed thunder rumble
    this.thunderDelayTimer = 0.35 + Math.random() * 0.55
  }

  private advanceFlashStage(): void {
    if (this.flashStage === 1) {
      // Small dip between flashes
      this.flashStage = 2
      this.flashTimer = 0.04
      this.lightningLight.intensity = 0.8
    } else if (this.flashStage === 2) {
      // Secondary flash
      this.flashStage = 3
      this.flashTimer = 0.06
      this.lightningLight.intensity = 3.6
    } else {
      // Flash sequence finished
      this.isFlashing = false
      this.flashStage = 0
      this.lightningLight.intensity = 0
      this.lightningLight.visible = false
    }
  }

  public getGripMultiplier(): number {
    return this.gripMultiplier
  }

  public getCurrentPreset(): WeatherPreset {
    return WEATHER_PRESETS[this.currentType]
  }

  public dispose(): void {
    if (this.rainGroup.parent) {
      this.rainGroup.parent.remove(this.rainGroup)
    }
    if (this.sprayGroup.parent) {
      this.sprayGroup.parent.remove(this.sprayGroup)
    }
    if (this.lightningLight.parent) {
      this.lightningLight.parent.remove(this.lightningLight)
    }
    this.rainGeometry.dispose()
    this.rainMaterial.dispose()
    this.sprayGeometry.dispose()
    this.sprayMaterial.dispose()
    for (const p of this.sprayParticles) {
      if (p.mesh.material) {
        ;(p.mesh.material as THREE.Material).dispose()
      }
    }
    this.asphaltMaterials.clear()
  }
}
