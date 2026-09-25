import type { PlayerInfo } from '../../../shared/src/messages.ts'

export class PlayerManager {
  private playersBySocket = new Map<string, PlayerInfo & { socketId: string; roomId?: string }>()
  private counter = 0

  /**
   * Register a newly connected client socket and assign a unique player ID.
   */
  public registerPlayer(socketId: string, customName?: string): PlayerInfo {
    this.counter++
    const shortId = Math.random().toString(36).substring(2, 7)
    const playerId = `p_${shortId}`
    const defaultName = customName || `Racer_${this.counter}`

    const playerRecord = {
      id: playerId,
      name: defaultName,
      connectedAt: Date.now(),
      socketId,
    }

    this.playersBySocket.set(socketId, playerRecord)
    return {
      id: playerRecord.id,
      name: playerRecord.name,
      connectedAt: playerRecord.connectedAt,
    }
  }

  public getPlayerBySocket(socketId: string): (PlayerInfo & { socketId: string; roomId?: string }) | undefined {
    return this.playersBySocket.get(socketId)
  }

  public getPlayerById(playerId: string): (PlayerInfo & { socketId: string; roomId?: string }) | undefined {
    for (const player of this.playersBySocket.values()) {
      if (player.id === playerId) return player
    }
    return undefined
  }

  public setPlayerRoom(socketId: string, roomId?: string): void {
    const player = this.playersBySocket.get(socketId)
    if (player) {
      player.roomId = roomId
    }
  }

  public updatePlayerName(socketId: string, name: string): PlayerInfo | undefined {
    const player = this.playersBySocket.get(socketId)
    if (player) {
      player.name = name.trim().slice(0, 20) || player.name
      return {
        id: player.id,
        name: player.name,
        connectedAt: player.connectedAt,
      }
    }
    return undefined
  }

  public unregisterPlayer(socketId: string): (PlayerInfo & { socketId: string; roomId?: string }) | undefined {
    const player = this.playersBySocket.get(socketId)
    if (player) {
      this.playersBySocket.delete(socketId)
    }
    return player
  }

  public getPlayerCount(): number {
    return this.playersBySocket.size
  }

  public getAllPlayers(): PlayerInfo[] {
    return Array.from(this.playersBySocket.values()).map(p => ({
      id: p.id,
      name: p.name,
      connectedAt: p.connectedAt,
    }))
  }
}
