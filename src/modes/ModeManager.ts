import { GameModeType, type IGameMode, type ModeContext } from './types.ts'
import { CityFreeRoamMode } from './CityFreeRoamMode.ts'
import { RaceMode } from './RaceMode.ts'
import { DriftMode } from './DriftMode.ts'

export class ModeManager {
  private modes: Map<GameModeType, IGameMode> = new Map()
  private activeMode!: IGameMode
  private context: ModeContext

  constructor(context: ModeContext) {
    this.context = context

    // Register all game modes
    this.registerMode(new CityFreeRoamMode())
    this.registerMode(new RaceMode())
    this.registerMode(new DriftMode())

    // Default starting mode
    this.setMode(GameModeType.CITY_FREE_ROAM)
  }

  public registerMode(mode: IGameMode): void {
    this.modes.set(mode.modeType, mode)
  }

  public setMode(type: GameModeType): void {
    const nextMode = this.modes.get(type)
    if (!nextMode) {
      console.warn(`Mode not found: ${type}`)
      return
    }

    if (this.activeMode) {
      this.activeMode.onExit(this.context)
    }

    this.activeMode = nextMode
    this.activeMode.onEnter(this.context)
    console.log(`✓ Switched to Game Mode: ${this.activeMode.title}`)
  }

  public update(delta: number): void {
    if (this.activeMode) {
      this.activeMode.onUpdate(delta, this.context)
    }
  }

  public reset(): void {
    if (this.activeMode) {
      this.activeMode.onReset(this.context)
    }
  }

  public cycleSpawn(): void {
    if (this.activeMode && this.activeMode.cycleSpawn) {
      this.activeMode.cycleSpawn(this.context)
    }
  }

  public getActiveMode(): IGameMode {
    return this.activeMode
  }

  public getMode(type: GameModeType): IGameMode | undefined {
    return this.modes.get(type)
  }

  public getAllModes(): IGameMode[] {
    return Array.from(this.modes.values())
  }
}
