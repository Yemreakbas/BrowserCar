import type * as THREE from 'three'
import { RemoteVehicle } from '../vehicle/RemoteVehicle.ts'
import type { NetworkManager } from './NetworkManager.ts'
import type { P2PNetworkManager } from './P2PNetworkManager.ts'
import type { PlayerStateMessage, RoomSnapshotPayload, AuthoritativePlayerState } from '../../shared/src/messages.ts'

export class RemotePlayerManager {
  private scene: THREE.Scene
  private networkManager: NetworkManager | P2PNetworkManager
  private remoteVehicles = new Map<string, RemoteVehicle>()

  private lastSeenMap = new Map<string, number>()
  private staleCheckAccumulator = 0

  constructor(scene: THREE.Scene, networkManager: NetworkManager | P2PNetworkManager) {
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
      if (!snapshot || !Array.isArray(snapshot.states)) return
      for (const state of snapshot.states) {
        this.handlePlayerState(state)
      }
    })

    // Listen for player leaving room
    this.networkManager.onPlayerLeftRoom(payload => {
      if (payload && payload.playerId) {
        this.removePlayer(payload.playerId)
      }
    })

    // When we leave a room, clear all remote players
    this.networkManager.onRoomLeft(() => {
      this.clearAll()
    })

    // When connection drops or errors, clear remote vehicles to avoid frozen ghost cars
    this.networkManager.onStatusChange(status => {
      if (status === 'disconnected' || status === 'error') {
        this.clearAll()
      }
    })
  }

  public handlePlayerState(state: PlayerStateMessage | AuthoritativePlayerState): void {
    // Malformed message guard
    if (!state || typeof state !== 'object' || !state.playerId) return
    if (!Array.isArray(state.position) || state.position.length !== 3 || !state.position.every(Number.isFinite)) return
    if (!Array.isArray(state.rotation) || state.rotation.length !== 4 || !state.rotation.every(Number.isFinite)) return

    const localId = this.networkManager.getPlayerId()
    if (!localId || state.playerId === localId) return

    this.lastSeenMap.set(state.playerId, Date.now())

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
    this.lastSeenMap.delete(playerId)
    const remoteCar = this.remoteVehicles.get(playerId)
    if (remoteCar) {
      console.log(`[RemotePlayerManager] Removing remote vehicle for player ${playerId}`)
      remoteCar.destroy()
      this.remoteVehicles.delete(playerId)
    }
  }

  public clearAll(): void {
    this.lastSeenMap.clear()
    for (const vehicle of this.remoteVehicles.values()) {
      vehicle.destroy()
    }
    this.remoteVehicles.clear()
  }

  public update(delta: number): void {
    // 1. Prune stale players if no packets received for > 6 seconds
    this.staleCheckAccumulator += delta
    if (this.staleCheckAccumulator >= 1.0) {
      this.staleCheckAccumulator = 0
      const now = Date.now()
      for (const [playerId, lastSeen] of this.lastSeenMap.entries()) {
        if (now - lastSeen > 6000) {
          console.log(`[RemotePlayerManager] Pruning stale remote vehicle: ${playerId}`)
          this.removePlayer(playerId)
        }
      }
    }

    // 2. Update remote vehicle animations and interpolation
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
