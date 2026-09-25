import type * as THREE from 'three'
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts'
import type { Vehicle } from '../vehicle/Vehicle.ts'
import type { CityWorld } from '../world/CityWorld.ts'
import type { RaceTrack } from '../world/RaceTrack.ts'

export const GameModeType = {
  CITY_FREE_ROAM: 'CITY_FREE_ROAM',
  RACE: 'RACE',
  DRIFT: 'DRIFT',
} as const
export type GameModeType = (typeof GameModeType)[keyof typeof GameModeType]

export const MapType = {
  CITY: 'CITY',
  RACE_TRACK: 'RACE_TRACK',
  DRIFT_TRACK: 'DRIFT_TRACK',
} as const
export type MapType = (typeof MapType)[keyof typeof MapType]

import type { TireSmokeSystem } from '../effects/TireSmoke.ts'
import type { RaceResult } from '../race/RaceSystem.ts'
import type { NetworkManager } from '../networking/NetworkManager.ts'
import type { RaceParticipantResult } from '../../shared/src/messages.ts'

export interface ModeHUDController {
  setSubtitle(text: string, color?: string): void
  setTelemetryVisible(visible: boolean): void
  setSpawnButtonVisible(visible: boolean): void
  setSpawnText?(text: string): void
  setDriftCardVisible(visible: boolean): void
  updateRaceTelemetry(lapText: string, timeText: string, bestText: string, checkpointText: string): void
  setRaceCountdown?(text: string | null, color?: string | null): void
  setWrongWayVisible?(visible: boolean): void
  showRaceResults?(result: RaceResult): void
  showMultiplayerRaceResults?(results: RaceParticipantResult[]): void
  hideRaceResults?(): void
  updateDriftTelemetry(
    scoreText: string,
    comboText: string,
    statusText: string,
    angleText?: string,
    totalText?: string,
    isDrifting?: boolean
  ): void
}

import type { DriftTrack } from '../world/DriftTrack.ts'

export interface ModeContext {
  scene: THREE.Scene
  physicsWorld: PhysicsWorld
  vehicle: Vehicle
  cityWorld: CityWorld
  raceTrack: RaceTrack
  driftTrack: DriftTrack
  hud: ModeHUDController
  tireSmoke: TireSmokeSystem
  networkManager?: NetworkManager
}

export interface IGameMode {
  readonly modeType: GameModeType
  readonly mapType: MapType
  readonly title: string
  readonly subtitle: string
  readonly description: string
  readonly icon: string
  readonly badgeColor: string

  onEnter(context: ModeContext): void
  onUpdate(delta: number, context: ModeContext): void
  onExit(context: ModeContext): void
  onReset(context: ModeContext): void
  cycleSpawn?(context: ModeContext): void
}
