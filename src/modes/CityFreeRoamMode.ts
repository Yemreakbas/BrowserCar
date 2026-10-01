import * as THREE from 'three'
import { type IGameMode, GameModeType, MapType, type ModeContext } from './types.ts'
import { DEFAULT_GLOBAL_ROOM_ID } from '../../shared/src/constants.ts'

export class CityFreeRoamMode implements IGameMode {
  public readonly modeType = GameModeType.CITY_FREE_ROAM
  public readonly mapType = MapType.CITY
  public readonly title = 'Şehirde Serbest Gezinti'
  public readonly subtitle = 'Serbest Sürüş & Keşif'
  public readonly description = 'Caddeler, kavşaklar, gökdelenler ve parklar arasında kuralsız serbest sürüş keyfi.'
  public readonly icon = '🏙️'
  public readonly badgeColor = '#3b82f6'

  public currentSpawnIndex: number = 0

  public onEnter(context: ModeContext): void {
    context.cityWorld.group.visible = true
    context.raceTrack.setVisible(false)
    context.driftTrack.setVisible(false)

    context.hud.setTelemetryVisible(false)
    context.hud.setDriftCardVisible(false)
    context.hud.setCityCardVisible?.(true)
    context.hud.setSpawnButtonVisible(true)
    context.hud.setSubtitle('Şehir • Serbest Gezinti', this.badgeColor)

    const net = context.networkManager
    const isOnline = !!(net && net.isConnected())
    const currentRoom = net?.getCurrentRoom()

    // Auto-join global city room if online and returning from drift/race modes
    if (isOnline && (!currentRoom || currentRoom.mode !== 'CITY_FREE_ROAM')) {
      net.joinRoom(DEFAULT_GLOBAL_ROOM_ID, net.getPlayerName() || undefined).catch((err) => {
        console.warn('[CityFreeRoamMode] Auto-join city room failed:', err)
      })
    }

    this.applySpawn(context, this.currentSpawnIndex)
    // Traffic removed per user request: open city streets for multiplayer
    context.weatherSystem?.registerAsphaltMaterials(context.cityWorld.getAsphaltMaterials())
  }


  private smokeTimer = 0
  private cityHudTimer = 0
  private tempWheelL = new THREE.Vector3()
  private tempWheelR = new THREE.Vector3()
  private tempCarVel = new THREE.Vector3()

  public onUpdate(delta: number, context: ModeContext): void {
    // Update ambient city traffic & night street lighting
    const isNight = context.dayNightCycle ? context.dayNightCycle.isNight() : false
    context.cityWorld.setNightMode(isNight)
    context.aiManager?.update(delta, context.vehicle, isNight)

    if (
      context.tireSmoke &&
      (context.vehicle.isDrifting ||
        (context.vehicle.isHandbrakeActive && Math.abs(context.vehicle.currentSpeed) > 3.0) ||
        context.vehicle.isRevLimiterActive)
    ) {
      this.smokeTimer += delta
      const smokeInterval = context.vehicle.isRevLimiterActive ? 0.022 : 0.035
      if (this.smokeTimer >= smokeInterval) {
        this.smokeTimer = 0
        context.vehicle.getRearWheelPositions(this.tempWheelL, this.tempWheelR)
        const linvel = context.vehicle.rigidBody.linvel()
        if (context.vehicle.isRevLimiterActive) {
          this.tempCarVel.set((Math.random() - 0.5) * 5.0, 1.5, (Math.random() - 0.5) * 5.0)
        } else {
          this.tempCarVel.set(linvel.x, linvel.y, linvel.z)
        }
        context.tireSmoke.emit(this.tempWheelL, this.tempCarVel)
        context.tireSmoke.emit(this.tempWheelR, this.tempCarVel)
      }
    }

    // Refresh city HUD online count periodically
    this.cityHudTimer += delta
    if (this.cityHudTimer >= 0.5) {
      this.cityHudTimer = 0
      const currentRoom = context.networkManager?.getCurrentRoom()
      const onlineCount = currentRoom && currentRoom.mode === 'CITY_FREE_ROAM' ? currentRoom.players.length : 1
      const locations = context.cityWorld.spawnLocations
      const spawn = locations[this.currentSpawnIndex % locations.length]
      context.hud.updateCityHUD?.(onlineCount, spawn.name, `Konum ${this.currentSpawnIndex + 1}/${locations.length}`)
    }
  }

  public onExit(context: ModeContext): void {
    context.aiManager?.clear()
    context.hud.setCityCardVisible?.(false)
    if (context.tireSmoke) {
      context.tireSmoke.reset()
    }
  }

  public onReset(context: ModeContext): void {
    this.applySpawn(context, this.currentSpawnIndex)
  }

  public getRespawnPoint(context: ModeContext): { position: THREE.Vector3; rotationY: number; name: string } {
    const loc = context.cityWorld.getNearestSpawnLocation(context.vehicle.root.position)
    return {
      position: loc.position.clone(),
      rotationY: loc.rotationY,
      name: loc.name,
    }
  }

  public cycleSpawn(context: ModeContext): void {
    const locations = context.cityWorld.spawnLocations
    this.currentSpawnIndex = (this.currentSpawnIndex + 1) % locations.length
    this.applySpawn(context, this.currentSpawnIndex)
  }

  private applySpawn(context: ModeContext, index: number): void {
    const locations = context.cityWorld.spawnLocations
    const spawn = locations[index % locations.length]
    context.vehicle.reset(spawn.position.x, spawn.position.z, spawn.rotationY)
    context.hud.setSubtitle(`${spawn.name} (${index + 1}/${locations.length})`, '#38bdf8')
    context.hud.setSpawnText?.(`Konum ${index + 1}/${locations.length}`)

    const currentRoom = context.networkManager?.getCurrentRoom()
    const onlineCount = currentRoom && currentRoom.mode === 'CITY_FREE_ROAM' ? currentRoom.players.length : 1
    context.hud.updateCityHUD?.(onlineCount, spawn.name, `Konum ${index + 1}/${locations.length}`)
  }
}
