import * as THREE from 'three'

export class VehicleHeadlights {
  public group: THREE.Group
  private parentBody: THREE.Object3D
  public enablePhysicalLights: boolean

  // Front Headlights (Player only)
  private leftSpotLight: THREE.SpotLight | null = null
  private rightSpotLight: THREE.SpotLight | null = null
  private leftTarget: THREE.Object3D | null = null
  private rightTarget: THREE.Object3D | null = null

  // Emissive Lens Meshes
  private leftFrontLens!: THREE.Mesh
  private rightFrontLens!: THREE.Mesh
  private leftRearLens!: THREE.Mesh
  private rightRearLens!: THREE.Mesh

  // Materials
  private frontLensMaterial!: THREE.MeshStandardMaterial
  private rearLensMaterial!: THREE.MeshStandardMaterial

  // Ground puddle / rear brake glow (Player only)
  private rearBrakeLight: THREE.PointLight | null = null

  // State
  public isEnabled: boolean = false
  public isAuto: boolean = true
  private wasBraking: boolean = false

  // Relative positions for 1.45 scale Kenney sports / sedan cars
  private readonly FRONT_Z = 1.78
  private readonly REAR_Z = -1.78
  private readonly SPREAD_X = 0.58
  private readonly HEIGHT_Y = 0.42

  constructor(parentBody: THREE.Object3D, enablePhysicalLights: boolean = true) {
    this.parentBody = parentBody
    this.enablePhysicalLights = enablePhysicalLights
    this.group = new THREE.Group()
    this.group.name = 'VehicleHeadlightsGroup'
    this.parentBody.add(this.group)

    this.setupLenses()
    if (this.enablePhysicalLights) {
      this.setupSpotlights()
    }
    this.setHeadlights(false)
  }

  private setupLenses() {
    // 1. Front Headlight Lenses (Emissive Xenon White / Pale Blue)
    this.frontLensMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.2,
      metalness: 0.1,
    })

    const frontLensGeo = new THREE.BoxGeometry(0.24, 0.12, 0.08)

    this.leftFrontLens = new THREE.Mesh(frontLensGeo, this.frontLensMaterial)
    this.leftFrontLens.position.set(-this.SPREAD_X, this.HEIGHT_Y, this.FRONT_Z)
    this.group.add(this.leftFrontLens)

    this.rightFrontLens = new THREE.Mesh(frontLensGeo, this.frontLensMaterial)
    this.rightFrontLens.position.set(this.SPREAD_X, this.HEIGHT_Y, this.FRONT_Z)
    this.group.add(this.rightFrontLens)

    // 2. Rear Taillight / Brake Lenses (Emissive Red)
    this.rearLensMaterial = new THREE.MeshStandardMaterial({
      color: 0x450a0a,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.3,
    })

    const rearLensGeo = new THREE.BoxGeometry(0.28, 0.11, 0.08)

    this.leftRearLens = new THREE.Mesh(rearLensGeo, this.rearLensMaterial)
    this.leftRearLens.position.set(-this.SPREAD_X, this.HEIGHT_Y, this.REAR_Z)
    this.group.add(this.leftRearLens)

    this.rightRearLens = new THREE.Mesh(rearLensGeo, this.rearLensMaterial)
    this.rightRearLens.position.set(this.SPREAD_X, this.HEIGHT_Y, this.REAR_Z)
    this.group.add(this.rightRearLens)

    // Rear brake light point source (Player only)
    if (this.enablePhysicalLights) {
      this.rearBrakeLight = new THREE.PointLight(0xef4444, 0, 8, 1.8)
      this.rearBrakeLight.position.set(0, this.HEIGHT_Y, this.REAR_Z - 0.4)
      this.rearBrakeLight.visible = false
      this.group.add(this.rearBrakeLight)
    }
  }

  private setupSpotlights() {
    // Left Spotlight
    this.leftSpotLight = new THREE.SpotLight(0xf8fafc, 0, 42, Math.PI / 6, 0.55, 1.2)
    this.leftSpotLight.position.set(-this.SPREAD_X, this.HEIGHT_Y, this.FRONT_Z)
    this.leftSpotLight.visible = false

    this.leftTarget = new THREE.Object3D()
    this.leftTarget.position.set(-this.SPREAD_X - 0.2, 0.1, this.FRONT_Z + 24)
    this.group.add(this.leftTarget)
    this.leftSpotLight.target = this.leftTarget
    this.group.add(this.leftSpotLight)

    // Right Spotlight
    this.rightSpotLight = new THREE.SpotLight(0xf8fafc, 0, 42, Math.PI / 6, 0.55, 1.2)
    this.rightSpotLight.position.set(this.SPREAD_X, this.HEIGHT_Y, this.FRONT_Z)
    this.rightSpotLight.visible = false

    this.rightTarget = new THREE.Object3D()
    this.rightTarget.position.set(this.SPREAD_X + 0.2, 0.1, this.FRONT_Z + 24)
    this.group.add(this.rightTarget)
    this.rightSpotLight.target = this.rightTarget
    this.group.add(this.rightSpotLight)
  }

  public setHeadlights(enabled: boolean) {
    this.isEnabled = enabled

    if (this.enablePhysicalLights && this.leftSpotLight && this.rightSpotLight) {
      const intensity = enabled ? 2.8 : 0
      this.leftSpotLight.intensity = intensity
      this.rightSpotLight.intensity = intensity
      // Crucial: toggling visible removes light completely from Three.js forward light uniforms
      this.leftSpotLight.visible = enabled
      this.rightSpotLight.visible = enabled
    }

    if (enabled) {
      // Xenon beam glow
      this.frontLensMaterial.emissive.setHex(0xe0f2fe)
      this.frontLensMaterial.emissiveIntensity = 2.5
      // Running taillights (soft ambient red)
      if (!this.wasBraking) {
        this.rearLensMaterial.emissive.setHex(0x991b1b)
        this.rearLensMaterial.emissiveIntensity = 0.8
      }
    } else {
      this.frontLensMaterial.emissive.setHex(0x000000)
      this.frontLensMaterial.emissiveIntensity = 0
      if (!this.wasBraking) {
        this.rearLensMaterial.emissive.setHex(0x000000)
        this.rearLensMaterial.emissiveIntensity = 0
      }
    }
  }

  public toggle(): boolean {
    this.isAuto = false
    this.setHeadlights(!this.isEnabled)
    return this.isEnabled
  }

  public setAuto(auto: boolean) {
    this.isAuto = auto
  }

  public update(_delta: number, isBraking: boolean, isNight: boolean) {
    // Automatic daylight detection
    if (this.isAuto) {
      if (isNight && !this.isEnabled) {
        this.setHeadlights(true)
      } else if (!isNight && this.isEnabled) {
        this.setHeadlights(false)
      }
    }

    // Brake lights update
    this.wasBraking = isBraking
    if (isBraking) {
      this.rearLensMaterial.emissive.setHex(0xef4444)
      this.rearLensMaterial.emissiveIntensity = 3.2
      if (this.enablePhysicalLights && this.rearBrakeLight) {
        this.rearBrakeLight.intensity = 1.4
        this.rearBrakeLight.visible = true
      }
    } else if (this.isEnabled) {
      this.rearLensMaterial.emissive.setHex(0x991b1b)
      this.rearLensMaterial.emissiveIntensity = 0.8
      if (this.enablePhysicalLights && this.rearBrakeLight) {
        this.rearBrakeLight.intensity = 0
        this.rearBrakeLight.visible = false
      }
    } else {
      this.rearLensMaterial.emissive.setHex(0x000000)
      this.rearLensMaterial.emissiveIntensity = 0
      if (this.enablePhysicalLights && this.rearBrakeLight) {
        this.rearBrakeLight.intensity = 0
        this.rearBrakeLight.visible = false
      }
    }
  }

  public dispose() {
    this.frontLensMaterial.dispose()
    this.rearLensMaterial.dispose()
    this.leftFrontLens.geometry.dispose()
    this.rightFrontLens.geometry.dispose()
    this.leftRearLens.geometry.dispose()
    this.rightRearLens.geometry.dispose()
    if (this.leftSpotLight && this.leftSpotLight.parent) {
      this.leftSpotLight.parent.remove(this.leftSpotLight)
    }
    if (this.rightSpotLight && this.rightSpotLight.parent) {
      this.rightSpotLight.parent.remove(this.rightSpotLight)
    }
    if (this.rearBrakeLight && this.rearBrakeLight.parent) {
      this.rearBrakeLight.parent.remove(this.rearBrakeLight)
    }
    if (this.group.parent) {
      this.group.parent.remove(this.group)
    }
  }
}
