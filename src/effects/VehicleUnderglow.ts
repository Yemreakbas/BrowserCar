import * as THREE from 'three'

export interface NeonColorPreset {
  id: string
  name: string
  hex: number
  css: string
}

export const NEON_PRESETS: NeonColorPreset[] = [
  { id: 'cyan', name: 'Cyber Cyan', hex: 0x00f0ff, css: '#00f0ff' },
  { id: 'purple', name: 'Electric Purple', hex: 0xc084fc, css: '#c084fc' },
  { id: 'green', name: 'Neon Lime', hex: 0x22c55e, css: '#22c55e' },
  { id: 'red', name: 'Crimson Fury', hex: 0xf43f5e, css: '#f43f5e' },
  { id: 'gold', name: 'Tokyo Amber', hex: 0xfbbf24, css: '#fbbf24' },
  { id: 'ice', name: 'Ice White', hex: 0xe0f2fe, css: '#e0f2fe' },
]

/**
 * High-performance, zero-drawcall-waste Neon Underglow System.
 * Projects custom glowing undercarriage neon onto the asphalt with dynamic pulsing,
 * nitro flaring, and rev-limiter strobe.
 */
export class VehicleUnderglow {
  public group: THREE.Group
  public isEnabled: boolean = true
  public currentColorIndex: number = 0

  private glowMeshes: THREE.Mesh[] = []
  private materials: THREE.MeshBasicMaterial[] = []
  private pulseTimer: number = 0

  constructor(parent: THREE.Object3D) {
    this.group = new THREE.Group()
    this.group.name = 'VehicleUnderglow'
    parent.add(this.group)

    // Generate high-resolution radial glow texture on canvas
    const glowTexture = this.createNeonTexture()

    // 4 neon ground projector quads (Front, Rear, Left, Right)
    const configs = [
      { x: -0.65, z: 0.0, width: 0.8, length: 2.8 },  // Left flank
      { x: 0.65, z: 0.0, width: 0.8, length: 2.8 },   // Right flank
      { x: 0.0, z: 1.35, width: 1.6, length: 0.8 },   // Front lip
      { x: 0.0, z: -1.35, width: 1.6, length: 0.8 },  // Rear diffuser
    ]

    const initialColor = NEON_PRESETS[this.currentColorIndex].hex

    configs.forEach((cfg) => {
      const geo = new THREE.PlaneGeometry(cfg.width * 1.5, cfg.length * 1.3)
      geo.rotateX(-Math.PI / 2) // Lay flat on ground

      const mat = new THREE.MeshBasicMaterial({
        color: initialColor,
        map: glowTexture,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })

      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(cfg.x, 0.045, cfg.z)
      this.group.add(mesh)
      this.glowMeshes.push(mesh)
      this.materials.push(mat)
    })
  }

  /**
   * Generates a smooth radial neon glow texture with soft exponential falloff
   */
  private createNeonTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')!

    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 60)
    gradient.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)')
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.85)')
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.35)')
    gradient.addColorStop(0.85, 'rgba(255, 255, 255, 0.08)')
    gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)')

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 128, 128)

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    return texture
  }

  /**
   * Updates underglow animations (breathing glow, nitro flare, rev limiter strobe)
   */
  public update(delta: number, isNitro: boolean, isRevLimiter: boolean): void {
    if (!this.isEnabled) {
      if (this.group.visible) this.group.visible = false
      return
    }

    if (!this.group.visible) this.group.visible = true

    this.pulseTimer += delta

    let baseOpacity = 0.58 + Math.sin(this.pulseTimer * 3.5) * 0.12
    let baseScale = 1.0

    if (isNitro) {
      baseOpacity = 0.95
      baseScale = 1.25
    } else if (isRevLimiter) {
      // Rapid 15Hz staccato flicker in kesici
      baseOpacity = 0.45 + (Math.sin(this.pulseTimer * 38.0) > 0 ? 0.45 : -0.2)
      baseScale = 1.15
    }

    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].opacity = baseOpacity
      this.glowMeshes[i].scale.set(baseScale, 1.0, baseScale)
    }
  }

  /**
   * Toggles underglow on/off
   */
  public toggle(): boolean {
    this.isEnabled = !this.isEnabled
    this.group.visible = this.isEnabled
    return this.isEnabled
  }

  /**
   * Cycles to next neon color preset
   */
  public cycleColor(): NeonColorPreset {
    this.currentColorIndex = (this.currentColorIndex + 1) % NEON_PRESETS.length
    const preset = NEON_PRESETS[this.currentColorIndex]
    this.setColor(preset.hex)
    return preset
  }

  public setColor(hex: number): void {
    for (const mat of this.materials) {
      mat.color.setHex(hex)
    }
  }

  public getCurrentPreset(): NeonColorPreset {
    return NEON_PRESETS[this.currentColorIndex]
  }
}
