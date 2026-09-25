import type * as THREE from 'three'
import { RemoteVehicle } from '../vehicle/RemoteVehicle.ts'
import type { NetworkManager } from './NetworkManager.ts'
import type { PlayerStateMessage, RoomSnapshotPayload, AuthoritativePlayerState } from '../../shared/src/messages.ts'

export class RemotePlayerManager {
  private scene: THREE.Scene
  private networkManager: NetworkManager
  private remoteVehicles = new Map<string, RemoteVehicle>()

  constructor(scene: THREE.Scene, networkManager: NetworkManager) {
    this.scene = scene
    this.networkManager = networkManager

    this.setupListeners()
  }

  private setupListeners(): void {
    // Listen for incoming state updates from other players
    this.networkManager.onPlayerState((state: PlayerStateMessage) => {
      this.handlePlayerState(state)
    })

    // Listen for room snapshots
    this.networkManager.onRoomSnapshot((snapshot: RoomSnapshotPayload) => {
      for (const state of snapshot.states) {
        this.handlePlayerState(state)
      }
    })

    // Listen for player leaving room
    this.networkManager.onPlayerLeftRoom(payload => {
      this.removePlayer(payload.playerId)
    })

    // When we leave a room, clear all remote players
    this.networkManager.onRoomLeft(() => {
      this.clearAll()
    })
  }

  public handlePlayerState(state: PlayerStateMessage | AuthoritativePlayerState): void {
    const localId = this.networkManager.getPlayerId()
    if (!localId || state.playerId === localId) return

    let remoteCar = this.remoteVehicles.get(state.playerId)
    if (!remoteCar) {
      console.log(`[RemotePlayerManager] Adding remote vehicle for player ${state.playerId} (${state.playerName || 'Racer'})`)
      remoteCar = new RemoteVehicle(
        this.scene,
        state.playerId,
        state.playerName || `Racer_${state.playerId.slice(-4)}`,
        state.position,
        state.rotation
      )
      this.remoteVehicles.set(state.playerId, remoteCar)
    }

    remoteCar.setTargetState(state)
  }

  public removePlayer(playerId: string): void {
    const remoteCar = this.remoteVehicles.get(playerId)
    if (remoteCar) {
      console.log(`[RemotePlayerManager] Removing remote vehicle for player ${playerId}`)
      remoteCar.destroy()
      this.remoteVehicles.delete(playerId)
    }
  }

  public clearAll(): void {
    for (const vehicle of this.remoteVehicles.values()) {
      vehicle.destroy()
    }
    this.remoteVehicles.clear()
  }

  public update(delta: number): void {
    for (const vehicle of this.remoteVehicles.values()) {
      vehicle.update(delta)
    }
  }

  public getCount(): number {
    return this.remoteVehicles.size
  }

  public getRemoteVehicle(playerId: string): RemoteVehicle | undefined {
    return this.remoteVehicles.get(playerId)
  }

  public getAllRemoteVehicles(): Map<string, RemoteVehicle> {
    return this.remoteVehicles
  }

  public getPlayerPosition(playerId: string): THREE.Vector3 | null {
    const car = this.remoteVehicles.get(playerId)
    return car ? car.root.position : null
  }
}
