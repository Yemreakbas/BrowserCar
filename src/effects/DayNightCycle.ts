import * as THREE from 'three'

export type TimePreset = 'DAY' | 'SUNSET' | 'NIGHT' | 'DAWN'

export class DayNightCycle {
  private scene: THREE.Scene
  private sunLight: THREE.DirectionalLight
  private ambientLight: THREE.AmbientLight
  private hemisphereLight: THREE.HemisphereLight

  // Time tracking (0.0 to 24.0 hours)
  public timeOfDay: number = 13.5 // Default sunny early afternoon
  public isAutoCycle: boolean = false
  public cycleSpeed: number = 24 / 480 // 1 full day every 8 minutes if auto
  public activePreset: TimePreset = 'DAY'
  public currentSunOffset = new THREE.Vector3(40, 60, 30)
  private followTarget = new THREE.Vector3(0, 0, 0)

  // Starfield celestial dome
  private starsPoints: THREE.Points | null = null
  private starsMaterial: THREE.PointsMaterial | null = null

  // Sky & Fog target colors
  private currentSkyColor = new THREE.Color(0x93c5fd)
  private currentFogColor = new THREE.Color(0x93c5fd)

  // Listeners (Throttled for Performance)
  public onTimeChanged?: (timeText: string, isNight: boolean, preset: TimePreset) => void
  private lastNotifiedTimeString: string = ''
  private lastNotifiedPreset?: TimePreset

  constructor(
    scene: THREE.Scene,
    sunLight: THREE.DirectionalLight,
    ambientLight: THREE.AmbientLight,
    hemisphereLight: THREE.HemisphereLight
  ) {
    this.scene = scene
    this.sunLight = sunLight
    this.ambientLight = ambientLight
    this.hemisphereLight = hemisphereLight

    this.createStarfield()
    this.updateLighting(0, true)
  }

  private createStarfield() {
    const starCount = 850
    const starGeo = new THREE.BufferGeometry()
    const positions = new Float32Array(starCount * 3)

    for (let i = 0; i < starCount; i++) {
      // Celestial sphere dome (radius: 280m)
      const u = Math.random()
      const v = Math.random()
      const theta = u * 2.0 * Math.PI
      const phi = Math.acos(2.0 * v - 1.0)
      const r = 280.0

      const x = r * Math.sin(phi) * Math.cos(theta)
      const y = Math.abs(r * Math.cos(phi)) + 18.0 // Keep in upper hemisphere
      const z = r * Math.sin(phi) * Math.sin(theta)

      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    this.starsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.8,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    this.starsPoints = new THREE.Points(starGeo, this.starsMaterial)
    this.starsPoints.name = 'CelestialStarfield'
    this.scene.add(this.starsPoints)
  }

  public setPreset(preset: TimePreset) {
    this.activePreset = preset
    switch (preset) {
      case 'DAY':
        this.timeOfDay = 12.0
        break
      case 'SUNSET':
        this.timeOfDay = 18.75 // Deep golden hour
        break
      case 'NIGHT':
        this.timeOfDay = 23.5 // Deep midnight
        break
      case 'DAWN':
        this.timeOfDay = 6.25 // Morning sunrise
        break
    }
    this.updateLighting(0.016, true)
  }

  public toggleAutoCycle(): boolean {
    this.isAutoCycle = !this.isAutoCycle
    return this.isAutoCycle
  }

  public isNight(): boolean {
    return this.timeOfDay < 5.8 || this.timeOfDay > 19.4
  }

  public isDuskOrDawn(): boolean {
    return (
      (this.timeOfDay >= 5.8 && this.timeOfDay <= 7.5) ||
      (this.timeOfDay >= 18.0 && this.timeOfDay <= 19.4)
    )
  }

  public getTimeString(): string {
    const hours = Math.floor(this.timeOfDay)
    const minutes = Math.floor((this.timeOfDay % 1) * 60)
    const hh = hours.toString().padStart(2, '0')
    const mm = minutes.toString().padStart(2, '0')

    let label = 'Gündüz'
    if (this.timeOfDay >= 5.5 && this.timeOfDay < 8.0) {
      label = 'Şafak'
    } else if (this.timeOfDay >= 8.0 && this.timeOfDay < 17.5) {
      label = 'Öğle'
    } else if (this.timeOfDay >= 17.5 && this.timeOfDay < 20.0) {
      label = 'Gün Batımı'
    } else {
      label = 'Gece'
    }

    return `${hh}:${mm} • ${label}`
  }

  public update(delta: number) {
    if (this.isAutoCycle) {
      this.timeOfDay = (this.timeOfDay + delta * this.cycleSpeed) % 24.0
    }
    this.updateLighting(delta, false)
  }

  private updateLighting(delta: number, forceInstant: boolean = false) {
    // 1. Calculate Sun / Celestial Elevation & Orbit
    // Sun rises at 6:00 (East), peaks at 12:00 (Zenith), sets at 18:00 (West)
    const sunAngle = ((this.timeOfDay - 6.0) / 24.0) * Math.PI * 2
    const sunElevation = Math.sin(sunAngle)

    const orbitRadius = 110
    const sunX = Math.cos(sunAngle) * orbitRadius
    const sunY = Math.max(sunElevation * orbitRadius, 10.0)
    const sunZ = 35.0

    // Moon position (opposite the sun)
    const moonAngle = sunAngle + Math.PI
    const moonElevation = Math.sin(moonAngle)
    const moonX = Math.cos(moonAngle) * orbitRadius
    const moonY = Math.max(moonElevation * orbitRadius, 14.0)
    const moonZ = -28.0

    // 2. Compute Colors & Intensities based on time of day
    let targetSunColor = new THREE.Color()
    let targetSunIntensity = 2.3
    let targetAmbientColor = new THREE.Color()
    let targetAmbientIntensity = 0.85
    let targetHemiSky = new THREE.Color()
    let targetHemiGround = new THREE.Color()
    let targetHemiIntensity = 0.6
    let targetSkyColor = new THREE.Color()
    let targetFogColor = new THREE.Color()
    let starOpacity = 0.0

    if (this.timeOfDay >= 8.0 && this.timeOfDay < 17.0) {
      // --- NOON / BRIGHT DAY ---
      targetSunColor.setHex(0xfffef5)
      targetSunIntensity = 2.3
      targetAmbientColor.setHex(0xffffff)
      targetAmbientIntensity = 0.85
      targetHemiSky.setHex(0xe0f2fe)
      targetHemiGround.setHex(0x1e293b)
      targetHemiIntensity = 0.6
      targetSkyColor.setHex(0x60a5fa) // Bright crisp blue
      targetFogColor.setHex(0x93c5fd)
      starOpacity = 0.0

      this.currentSunOffset.set(sunX, sunY, sunZ)
    } else if (this.timeOfDay >= 17.0 && this.timeOfDay < 19.5) {
      // --- GOLDEN HOUR / SUNSET ---
      const sunsetFactor = (this.timeOfDay - 17.0) / 2.5
      targetSunColor.setHex(0xf97316) // Rich fiery orange
      targetSunIntensity = THREE.MathUtils.lerp(2.2, 1.2, sunsetFactor)
      targetAmbientColor.setHex(0xfdba74) // Warm peach
      targetAmbientIntensity = THREE.MathUtils.lerp(0.8, 0.45, sunsetFactor)
      targetHemiSky.setHex(0xfb923c)
      targetHemiGround.setHex(0x431407)
      targetHemiIntensity = 0.52
      targetSkyColor.setHex(0x7c2d12) // Deep dusk amber
      targetFogColor.setHex(0x9a3412)
      starOpacity = THREE.MathUtils.lerp(0.0, 0.45, sunsetFactor)

      this.currentSunOffset.set(sunX, sunY, sunZ)
    } else if (this.timeOfDay >= 19.5 || this.timeOfDay < 5.0) {
      // --- CYBERPUNK MIDNIGHT / NEON NIGHT ---
      targetSunColor.setHex(0x7dd3fc) // Lunar pale cyan moonlight
      targetSunIntensity = 0.42
      targetAmbientColor.setHex(0x1e293b) // Deep dark navy ambient
      targetAmbientIntensity = 0.28
      targetHemiSky.setHex(0x0f172a)
      targetHemiGround.setHex(0x020617)
      targetHemiIntensity = 0.32
      targetSkyColor.setHex(0x050814) // Deep space black-blue
      targetFogColor.setHex(0x080d1a)
      starOpacity = 0.95

      // Light acts as Moon at night
      this.currentSunOffset.set(moonX, moonY, moonZ)
    } else {
      // --- DAWN / MORNING SUNRISE ---
      const dawnFactor = (this.timeOfDay - 5.0) / 3.0
      targetSunColor.setHex(0xfde047) // Morning gold
      targetSunIntensity = THREE.MathUtils.lerp(0.5, 2.0, dawnFactor)
      targetAmbientColor.setHex(0xfef08a)
      targetAmbientIntensity = THREE.MathUtils.lerp(0.3, 0.8, dawnFactor)
      targetHemiSky.setHex(0xfbcfe8) // Pastel rose
      targetHemiGround.setHex(0x3b0764)
      targetHemiIntensity = 0.55
      targetSkyColor.setHex(0xf472b6) // Morning rose-sky
      targetFogColor.setHex(0xfbcfe8)
      starOpacity = THREE.MathUtils.lerp(0.8, 0.0, dawnFactor)

      this.currentSunOffset.set(sunX, sunY, sunZ)
    }

    // Keep sunlight and shadow camera centered relative to followed vehicle
    this.sunLight.position.set(
      this.followTarget.x + this.currentSunOffset.x,
      this.currentSunOffset.y,
      this.followTarget.z + this.currentSunOffset.z
    )
    this.sunLight.target.position.copy(this.followTarget)
    this.sunLight.target.updateMatrixWorld()

    // Disable shadow map calculation at night to save massive fillrate
    this.sunLight.castShadow = !this.isNight()

    // 3. Apply Smooth Transitions
    const lerpRate = forceInstant ? 1.0 : Math.min(delta * 4.5, 0.95)

    this.sunLight.color.lerp(targetSunColor, lerpRate)
    this.sunLight.intensity = THREE.MathUtils.lerp(this.sunLight.intensity, targetSunIntensity, lerpRate)

    this.ambientLight.color.lerp(targetAmbientColor, lerpRate)
    this.ambientLight.intensity = THREE.MathUtils.lerp(this.ambientLight.intensity, targetAmbientIntensity, lerpRate)

    this.hemisphereLight.color.lerp(targetHemiSky, lerpRate)
    this.hemisphereLight.groundColor.lerp(targetHemiGround, lerpRate)
    this.hemisphereLight.intensity = THREE.MathUtils.lerp(this.hemisphereLight.intensity, targetHemiIntensity, lerpRate)

    this.currentSkyColor.lerp(targetSkyColor, lerpRate)
    this.currentFogColor.lerp(targetFogColor, lerpRate)

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.currentSkyColor)
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.currentFogColor)
      // Slightly denser fog at dusk/night for atmosphere
      const targetNear = this.isNight() ? 45 : this.isDuskOrDawn() ? 55 : 65
      const targetFar = this.isNight() ? 220 : this.isDuskOrDawn() ? 245 : 270
      this.scene.fog.near = THREE.MathUtils.lerp(this.scene.fog.near, targetNear, lerpRate)
      this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, targetFar, lerpRate)
    }

    // Starfield opacity
    if (this.starsMaterial) {
      this.starsMaterial.opacity = THREE.MathUtils.lerp(this.starsMaterial.opacity, starOpacity, lerpRate)
    }

    // Callback notification (Throttled: only when time string or preset changes)
    const timeStr = this.getTimeString()
    if (this.onTimeChanged && (timeStr !== this.lastNotifiedTimeString || this.activePreset !== this.lastNotifiedPreset)) {
      this.lastNotifiedTimeString = timeStr
      this.lastNotifiedPreset = this.activePreset
      this.onTimeChanged(timeStr, this.isNight(), this.activePreset)
    }
  }

  public updateShadowFollow(carPos: THREE.Vector3) {
    this.followTarget.copy(carPos)
    this.sunLight.position.set(
      this.followTarget.x + this.currentSunOffset.x,
      this.currentSunOffset.y,
      this.followTarget.z + this.currentSunOffset.z
    )
    this.sunLight.target.position.copy(this.followTarget)
    this.sunLight.target.updateMatrixWorld()
  }
}
