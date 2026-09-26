import type { VehicleConfig } from './VehicleConfig.ts'

export interface VehicleStats {
  topSpeedKmh: number // Projected top speed in km/h
  acceleration: number // Rating 1-10
  handling: number // Rating 1-10
  braking: number // Rating 1-10
  grip: number // Rating 1-10
  driftMultiplier: number // Score & slip multiplier (e.g. 1.35x)
  massKg: number // Mass in kilograms
}

export interface VehicleDefinition {
  id: string
  name: string
  category: 'SPORTS' | 'RACE' | 'DRIFT' | 'PROTOTYPE' | 'POLICE' | 'SUV'
  badge: string
  tagline: string
  description: string
  modelPath: string
  scale: number
  stats: VehicleStats
  config: Partial<VehicleConfig>
}

export const VEHICLE_CATALOG: VehicleDefinition[] = [
  {
    id: 'sedan_sports',
    name: 'Apex GT Sedan',
    category: 'SPORTS',
    badge: 'Dengeli • Klasik GT',
    tagline: 'Çok Yönlü Sokak & Pist Canavarı',
    description: 'Güçlü V6 motor, mükemmel ağırlık dengesi ve hem yarış hem serbest sürüş için ideal dinamikler.',
    modelPath: '/assets/cars/sedan-sports.glb',
    scale: 1.45,
    stats: {
      topSpeedKmh: 137,
      acceleration: 7.5,
      handling: 7.8,
      braking: 8.0,
      grip: 7.6,
      driftMultiplier: 1.0,
      massKg: 1350,
    },
    config: {
      maxForwardSpeed: 38.0,
      maxReverseSpeed: -14.0,
      baseAcceleration: 28.0,
      accelerationCurvePower: 0.75,
      reverseAcceleration: 22.0,
      brakingPower: 36.0,
      handbrakePower: 4.0,
      coastingDrag: 5.5,
      maxSteerAngle: 0.48,
      minSteerSensitivity: 0.38,
      steeringSpeedDropoff: 16.0,
      steerResponseSpeed: 7.2,
      steerReturnSpeed: 8.8,
      baseTurnRate: 2.2,
      lateralGripNormal: 0.94,
      lateralGripDrift: 0.20,
      driftGripRecoverySpeed: 4.2,
      driftMinSpeed: 2.8,
      driftYawMultiplier: 1.55,
      suspensionPitchMax: 0.045,
      suspensionRollMax: 0.08,
    },
  },
  {
    id: 'hyper_race',
    name: 'Vortex R1 Hypercar',
    category: 'RACE',
    badge: 'Pist Şampiyonu',
    tagline: 'Ultra Yüksek Hız & Maksimum Downforce',
    description: "Saf yarış DNA'sı. 162 km/h son sürat, devasa aerodinamik tutuş ve pist virajlarında kusursuz rayda gidiş hissi.",
    modelPath: '/assets/cars/race.glb',
    scale: 1.45,
    stats: {
      topSpeedKmh: 162,
      acceleration: 9.4,
      handling: 9.1,
      braking: 9.5,
      grip: 9.6,
      driftMultiplier: 0.9,
      massKg: 1100,
    },
    config: {
      maxForwardSpeed: 45.0, // ~162 km/h
      maxReverseSpeed: -15.0,
      baseAcceleration: 35.0, // Blistering track acceleration
      accelerationCurvePower: 0.70,
      reverseAcceleration: 24.0,
      brakingPower: 44.0,
      handbrakePower: 5.0,
      coastingDrag: 6.2,
      maxSteerAngle: 0.44, // Tight racing steering
      minSteerSensitivity: 0.45,
      steeringSpeedDropoff: 20.0,
      steerResponseSpeed: 8.5,
      steerReturnSpeed: 9.8,
      baseTurnRate: 2.5,
      lateralGripNormal: 0.97, // Ultra high cornering grip
      lateralGripDrift: 0.28,
      driftGripRecoverySpeed: 5.5,
      driftMinSpeed: 4.5,
      driftYawMultiplier: 1.35,
      suspensionPitchMax: 0.03, // Stiff racing suspension
      suspensionRollMax: 0.045,
    },
  },
  {
    id: 'drift_hatch',
    name: 'Drift Pulse Hatch',
    category: 'DRIFT',
    badge: 'Yanlama Ustası',
    tagline: 'Kıvrak Şasi & Kolay Kontrol Edilen Açılar',
    description: 'Arkadan itişli drift uzmanı. Düşük tutuşlu arka şasi, yüksek açılı direksiyon ve +35% drift puan çarpanı.',
    modelPath: '/assets/cars/hatchback-sports.glb',
    scale: 1.45,
    stats: {
      topSpeedKmh: 125,
      acceleration: 8.0,
      handling: 8.8,
      braking: 7.2,
      grip: 5.8,
      driftMultiplier: 1.35,
      massKg: 1180,
    },
    config: {
      maxForwardSpeed: 34.8, // ~125 km/h
      maxReverseSpeed: -13.0,
      baseAcceleration: 30.0,
      accelerationCurvePower: 0.72,
      reverseAcceleration: 22.0,
      brakingPower: 32.0,
      handbrakePower: 3.2,
      coastingDrag: 5.0,
      maxSteerAngle: 0.54, // Wider drift counter-steer angle (~31 deg)
      minSteerSensitivity: 0.42,
      steeringSpeedDropoff: 14.0,
      steerResponseSpeed: 8.8,
      steerReturnSpeed: 10.2,
      baseTurnRate: 2.4,
      lateralGripNormal: 0.88, // Easy to initiate drift
      lateralGripDrift: 0.15, // Smooth sustained sliding
      driftGripRecoverySpeed: 3.8,
      driftMinSpeed: 2.2, // Drifts even at low speeds
      driftYawMultiplier: 1.85, // Super responsive counter-steer
      suspensionPitchMax: 0.05,
      suspensionRollMax: 0.09,
    },
  },
  {
    id: 'cyber_future',
    name: 'Cyberion Prototype',
    category: 'PROTOTYPE',
    badge: 'Geleceğin Teknolojisi',
    tagline: 'Dört Çeker Anlık Tork & Çift Motor',
    description: 'Yeni nesil elektrikli hiper prototip. Anında 0-100 fırlatma, tork vektörleme ve pürüzsüz yüksek hız dengesi.',
    modelPath: '/assets/cars/race-future.glb',
    scale: 1.45,
    stats: {
      topSpeedKmh: 154,
      acceleration: 9.8,
      handling: 8.5,
      braking: 8.8,
      grip: 9.0,
      driftMultiplier: 1.1,
      massKg: 1420,
    },
    config: {
      maxForwardSpeed: 42.8, // ~154 km/h
      maxReverseSpeed: -16.0,
      baseAcceleration: 38.0, // Instant EV acceleration thrust
      accelerationCurvePower: 0.65,
      reverseAcceleration: 26.0,
      brakingPower: 40.0,
      handbrakePower: 4.5,
      coastingDrag: 5.8,
      maxSteerAngle: 0.46,
      minSteerSensitivity: 0.40,
      steeringSpeedDropoff: 18.0,
      steerResponseSpeed: 8.0,
      steerReturnSpeed: 9.2,
      baseTurnRate: 2.3,
      lateralGripNormal: 0.95,
      lateralGripDrift: 0.22,
      driftGripRecoverySpeed: 4.8,
      driftMinSpeed: 3.0,
      driftYawMultiplier: 1.45,
      suspensionPitchMax: 0.035,
      suspensionRollMax: 0.06,
    },
  },
  {
    id: 'police_interceptor',
    name: 'Interceptor V8',
    category: 'POLICE',
    badge: 'Ağır Takip Kruvazörü',
    tagline: 'Dayanıklı Gövde & Güçlü Blok V8',
    description: 'Ağır çelik takviyeli şasi, acımasız itiş gücü ve çarpışmalarda sarsılmayan kararlılık.',
    modelPath: '/assets/cars/police.glb',
    scale: 1.45,
    stats: {
      topSpeedKmh: 144,
      acceleration: 8.2,
      handling: 7.0,
      braking: 8.5,
      grip: 8.0,
      driftMultiplier: 1.0,
      massKg: 1680,
    },
    config: {
      maxForwardSpeed: 40.0, // ~144 km/h
      maxReverseSpeed: -14.5,
      baseAcceleration: 31.0,
      accelerationCurvePower: 0.74,
      reverseAcceleration: 23.0,
      brakingPower: 38.0,
      handbrakePower: 4.2,
      coastingDrag: 5.8,
      maxSteerAngle: 0.45,
      minSteerSensitivity: 0.36,
      steeringSpeedDropoff: 15.0,
      steerResponseSpeed: 7.0,
      steerReturnSpeed: 8.5,
      baseTurnRate: 2.0,
      lateralGripNormal: 0.92,
      lateralGripDrift: 0.21,
      driftGripRecoverySpeed: 4.0,
      driftMinSpeed: 3.2,
      driftYawMultiplier: 1.4,
      suspensionPitchMax: 0.055,
      suspensionRollMax: 0.085,
    },
  },
  {
    id: 'titan_suv',
    name: 'Titan Luxury SUV',
    category: 'SUV',
    badge: 'Lüks Zırhlı Dev',
    tagline: 'Üstün Konfor & Sarsılmaz Ağır Şasi',
    description: 'Yüksek sürüş pozisyonu, yumuşak süspansiyon esnemesi ve sağlam yol tutuşu ile şehirde heybetli bir sürüş.',
    modelPath: '/assets/cars/suv-luxury.glb',
    scale: 1.45,
    stats: {
      topSpeedKmh: 132,
      acceleration: 7.0,
      handling: 6.5,
      braking: 7.8,
      grip: 8.4,
      driftMultiplier: 0.85,
      massKg: 1950,
    },
    config: {
      maxForwardSpeed: 36.6, // ~132 km/h
      maxReverseSpeed: -13.0,
      baseAcceleration: 26.0,
      accelerationCurvePower: 0.78,
      reverseAcceleration: 20.0,
      brakingPower: 34.0,
      handbrakePower: 4.8,
      coastingDrag: 6.5,
      maxSteerAngle: 0.43,
      minSteerSensitivity: 0.35,
      steeringSpeedDropoff: 14.0,
      steerResponseSpeed: 6.5,
      steerReturnSpeed: 8.0,
      baseTurnRate: 1.9,
      lateralGripNormal: 0.93,
      lateralGripDrift: 0.24,
      driftGripRecoverySpeed: 4.4,
      driftMinSpeed: 3.5,
      driftYawMultiplier: 1.3,
      suspensionPitchMax: 0.065, // More pitch & roll for realistic heavy SUV weight
      suspensionRollMax: 0.11,
    },
  },
]

export const DEFAULT_VEHICLE_ID = 'sedan_sports'

export function getVehicleDefinition(id: string): VehicleDefinition {
  const found = VEHICLE_CATALOG.find((v) => v.id === id)
  return found || VEHICLE_CATALOG[0]
}

export function getSelectedVehicleId(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem('browsercar_selected_vehicle')
      if (stored && VEHICLE_CATALOG.some((v) => v.id === stored)) {
        return stored
      }
    }
  } catch {
    // localStorage not accessible
  }
  return DEFAULT_VEHICLE_ID
}

export function setSelectedVehicleId(id: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('browsercar_selected_vehicle', id)
    }
  } catch {
    // Ignore localStorage error
  }
}
