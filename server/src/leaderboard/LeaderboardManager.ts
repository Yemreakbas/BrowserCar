import fs from 'node:fs'
import path from 'node:path'
import type { Server as SocketIOServer } from 'socket.io'
import { SOCKET_EVENTS } from '../../../shared/src/constants.ts'
import type {
  LeaderboardCategory,
  LeaderboardEntry,
  LeaderboardDataPayload,
  LeaderboardAllPayload,
  LeaderboardSubmitRequest,
  LeaderboardSubmitResponse,
} from '../../../shared/src/messages.ts'

export class LeaderboardManager {
  private io?: SocketIOServer
  private storageFilePath: string
  private entries: Record<LeaderboardCategory, LeaderboardEntry[]> = {
    fastest_lap: [],
    best_drift_score: [],
    best_drift_combo: [],
    city_top_speed: [],
  }
  private lastSubmissionByPlayer = new Map<string, number>()

  constructor(io?: SocketIOServer, customStoragePath?: string) {
    this.io = io
    const defaultDataDir = process.cwd().endsWith('server')
      ? path.resolve(process.cwd(), 'data')
      : path.resolve(process.cwd(), 'server', 'data')
    this.storageFilePath = customStoragePath || path.join(defaultDataDir, 'leaderboards.json')
    this.initStorage()
  }

  public setSocketServer(io: SocketIOServer): void {
    this.io = io
  }

  private initStorage(): void {
    try {
      const dir = path.dirname(this.storageFilePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          this.entries.fastest_lap = Array.isArray(parsed.fastest_lap) ? parsed.fastest_lap : []
          this.entries.best_drift_score = Array.isArray(parsed.best_drift_score) ? parsed.best_drift_score : []
          this.entries.best_drift_combo = Array.isArray(parsed.best_drift_combo) ? parsed.best_drift_combo : []
          this.entries.city_top_speed = Array.isArray(parsed.city_top_speed) ? parsed.city_top_speed : []
        }
      }
    } catch (err) {
      console.warn('[Leaderboard] Failed to load from disk, using fallback/seed:', err)
    }

    // Seed defaults if empty
    if (this.entries.fastest_lap.length === 0) {
      this.seedDefaults()
      this.saveToDisk()
    } else {
      this.reSortAll()
    }
  }

  private seedDefaults(): void {
    const now = Date.now()
    const oneDay = 24 * 60 * 60 * 1000

    this.entries.fastest_lap = [
      {
        id: 'seed-fl-1',
        category: 'fastest_lap',
        playerId: 'pilot_apex',
        playerName: 'Apex Predator',
        carId: 'car-hypercar',
        carName: 'Vortex R1 Hypercar',
        score: 18.421,
        formattedScore: '0:18.421',
        trackId: 'circuit',
        date: now - oneDay * 3,
        rank: 1,
      },
      {
        id: 'seed-fl-2',
        category: 'fastest_lap',
        playerId: 'pilot_ghost',
        playerName: 'Ghost Racer',
        carId: 'car-sports',
        carName: 'Apex GT Sport',
        score: 20.895,
        formattedScore: '0:20.895',
        trackId: 'circuit',
        date: now - oneDay * 2,
        rank: 2,
      },
      {
        id: 'seed-fl-3',
        category: 'fastest_lap',
        playerId: 'pilot_turbo',
        playerName: 'Turbo Nova',
        carId: 'car-muscle',
        carName: 'Torque SS Muscle',
        score: 22.340,
        formattedScore: '0:22.340',
        trackId: 'circuit',
        date: now - oneDay,
        rank: 3,
      },
      {
        id: 'seed-fl-4',
        category: 'fastest_lap',
        playerId: 'pilot_speedy',
        playerName: 'Speedy Gonzales',
        carId: 'car-tuner',
        carName: 'Fujin Drift Spec',
        score: 24.110,
        formattedScore: '0:24.110',
        trackId: 'circuit',
        date: now - 3600000 * 5,
        rank: 4,
      },
    ]

    this.entries.best_drift_score = [
      {
        id: 'seed-ds-1',
        category: 'best_drift_score',
        playerId: 'pilot_drift_king',
        playerName: 'DK Drift King',
        carId: 'car-tuner',
        carName: 'Fujin Drift Spec',
        score: 84500,
        formattedScore: '84,500 Puan',
        date: now - oneDay * 4,
        rank: 1,
      },
      {
        id: 'seed-ds-2',
        category: 'best_drift_score',
        playerId: 'pilot_smoke',
        playerName: 'Smoke Machine',
        carId: 'car-muscle',
        carName: 'Torque SS Muscle',
        score: 62200,
        formattedScore: '62,200 Puan',
        date: now - oneDay * 2,
        rank: 2,
      },
      {
        id: 'seed-ds-3',
        category: 'best_drift_score',
        playerId: 'pilot_slide',
        playerName: 'Sideways Sam',
        carId: 'car-sports',
        carName: 'Apex GT Sport',
        score: 41800,
        formattedScore: '41,800 Puan',
        date: now - 3600000 * 12,
        rank: 3,
      },
    ]

    this.entries.best_drift_combo = [
      {
        id: 'seed-dc-1',
        category: 'best_drift_combo',
        playerId: 'pilot_drift_king',
        playerName: 'DK Drift King',
        carId: 'car-tuner',
        carName: 'Fujin Drift Spec',
        score: 5.0,
        formattedScore: '5.0x Kombo',
        date: now - oneDay * 4,
        rank: 1,
      },
      {
        id: 'seed-dc-2',
        category: 'best_drift_combo',
        playerId: 'pilot_smoke',
        playerName: 'Smoke Machine',
        carId: 'car-muscle',
        carName: 'Torque SS Muscle',
        score: 4.5,
        formattedScore: '4.5x Kombo',
        date: now - oneDay * 2,
        rank: 2,
      },
      {
        id: 'seed-dc-3',
        category: 'best_drift_combo',
        playerId: 'pilot_slide',
        playerName: 'Sideways Sam',
        carId: 'car-sports',
        carName: 'Apex GT Sport',
        score: 3.5,
        formattedScore: '3.5x Kombo',
        date: now - 3600000 * 8,
        rank: 3,
      },
    ]

    this.entries.city_top_speed = [
      {
        id: 'seed-ts-1',
        category: 'city_top_speed',
        playerId: 'pilot_apex',
        playerName: 'Apex Predator',
        carId: 'car-hypercar',
        carName: 'Vortex R1 Hypercar',
        score: 254,
        formattedScore: '254 km/h',
        date: now - oneDay * 3,
        rank: 1,
      },
      {
        id: 'seed-ts-2',
        category: 'city_top_speed',
        playerId: 'pilot_ghost',
        playerName: 'Ghost Racer',
        carId: 'car-sports',
        carName: 'Apex GT Sport',
        score: 228,
        formattedScore: '228 km/h',
        date: now - oneDay,
        rank: 2,
      },
      {
        id: 'seed-ts-3',
        category: 'city_top_speed',
        playerId: 'pilot_turbo',
        playerName: 'Turbo Nova',
        carId: 'car-muscle',
        carName: 'Torque SS Muscle',
        score: 215,
        formattedScore: '215 km/h',
        date: now - 3600000 * 4,
        rank: 3,
      },
    ]
  }

  private saveToDisk(): void {
    try {
      const serialized = JSON.stringify(this.entries, null, 2)
      fs.writeFileSync(this.storageFilePath, serialized, 'utf8')
    } catch (err) {
      console.error('[Leaderboard] Error saving to disk:', err)
    }
  }

  public formatScore(category: LeaderboardCategory, score: number): string {
    switch (category) {
      case 'fastest_lap': {
        const totalMs = Math.round(score * 1000)
        const mins = Math.floor(totalMs / 60000)
        const secs = Math.floor((totalMs % 60000) / 1000)
        const ms = totalMs % 1000
        return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
      }
      case 'best_drift_score':
        return `${Math.round(score).toLocaleString('tr-TR')} Puan`
      case 'best_drift_combo':
        return `${score.toFixed(1)}x Kombo`
      case 'city_top_speed':
        return `${Math.round(score)} km/h`
    }
  }

  /**
   * Validate server-authoritative limits to reject arbitrary user-submitted data.
   */
  public validateScore(category: LeaderboardCategory, score: number): { valid: boolean; reason?: string } {
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      return { valid: false, reason: 'Geçersiz skor sayısı' }
    }

    switch (category) {
      case 'fastest_lap':
        // Circuit lap cannot physically be completed under 10 seconds, and over 10 minutes is invalid
        if (score < 10.0 || score > 600.0) {
          return { valid: false, reason: `Tur süresi makul sınırlar dışında: ${score.toFixed(3)}s (Min: 10s)` }
        }
        return { valid: true }

      case 'best_drift_score':
        // Single drift bank or session score bounded by physics rate
        if (score < 50 || score > 1000000) {
          return { valid: false, reason: `Drift skoru sınırların dışında: ${score} (Min: 50, Max: 1,000,000)` }
        }
        return { valid: true }

      case 'best_drift_combo':
        // Drift multiplier max is 5.0 in the physics engine
        if (score < 1.0 || score > 5.0) {
          return { valid: false, reason: `Drift kombosu sınırların dışında: ${score.toFixed(1)}x (Max: 5.0x)` }
        }
        return { valid: true }

      case 'city_top_speed':
        // Top speed bounded by Hypercar physics (max ~260 km/h + downhill)
        if (score < 30 || score > 330) {
          return { valid: false, reason: `Hız değeri makul sınırlar dışında: ${Math.round(score)} km/h` }
        }
        return { valid: true }

      default:
        return { valid: false, reason: 'Bilinmeyen liderlik kategorisi' }
    }
  }

  private reSortCategory(category: LeaderboardCategory): void {
    const list = this.entries[category]
    if (category === 'fastest_lap') {
      // Ascending (lower time is better)
      list.sort((a, b) => a.score - b.score)
    } else {
      // Descending (higher score is better)
      list.sort((a, b) => b.score - a.score)
    }

    // Keep top 50 and re-assign ranks
    this.entries[category] = list.slice(0, 50)
    this.entries[category].forEach((entry, idx) => {
      entry.rank = idx + 1
    })
  }

  private reSortAll(): void {
    this.reSortCategory('fastest_lap')
    this.reSortCategory('best_drift_score')
    this.reSortCategory('best_drift_combo')
    this.reSortCategory('city_top_speed')
  }

  /**
   * Authoritatively record or update an entry.
   */
  public recordRecord(
    category: LeaderboardCategory,
    playerId: string,
    playerName: string,
    carId: string,
    carName: string,
    score: number,
    trackId?: string
  ): { success: boolean; rank?: number; isNewBest?: boolean; reason?: string } {
    const validation = this.validateScore(category, score)
    if (!validation.valid) {
      console.warn(`[Leaderboard] Validation rejected for ${playerName} (${category}): ${validation.reason}`)
      return { success: false, reason: validation.reason }
    }

    const list = this.entries[category]
    const existingIndex = list.findIndex((e) => e.playerId === playerId)
    const isFastestLap = category === 'fastest_lap'

    let isBetter = false
    if (existingIndex >= 0) {
      const existing = list[existingIndex]
      if (isFastestLap) {
        isBetter = score < existing.score
      } else {
        isBetter = score > existing.score
      }

      if (isBetter) {
        existing.score = score
        existing.formattedScore = this.formatScore(category, score)
        existing.carId = carId || existing.carId
        existing.carName = carName || existing.carName
        existing.playerName = playerName || existing.playerName
        existing.date = Date.now()
        if (trackId) existing.trackId = trackId
      } else {
        return { success: true, rank: existing.rank, isNewBest: false }
      }
    } else {
      isBetter = true
      const newEntry: LeaderboardEntry = {
        id: `rec-${category}-${playerId}-${Date.now()}`,
        category,
        playerId,
        playerName: playerName || 'Anonim Pilot',
        carId: carId || 'car-sedan',
        carName: carName || 'Standart Sedan',
        score,
        formattedScore: this.formatScore(category, score),
        trackId,
        date: Date.now(),
      }
      list.push(newEntry)
    }

    this.reSortCategory(category)
    this.saveToDisk()

    const updatedEntry = this.entries[category].find((e) => e.playerId === playerId)
    const rank = updatedEntry?.rank || 1

    // Broadcast realtime update to all clients
    this.broadcastLeaderboardAll()

    return { success: true, rank, isNewBest: isBetter }
  }

  /**
   * Process a client-submitted record with rate limiting and strict server validation.
   */
  public processClientSubmission(
    playerId: string,
    playerName: string,
    data: LeaderboardSubmitRequest
  ): LeaderboardSubmitResponse {
    const now = Date.now()
    const lastTime = this.lastSubmissionByPlayer.get(playerId) || 0
    if (now - lastTime < 1000) {
      return { success: false, error: 'İstekler çok hızlı gönderiliyor (Rate limit).' }
    }
    this.lastSubmissionByPlayer.set(playerId, now)

    const res = this.recordRecord(
      data.category,
      playerId,
      playerName,
      data.carId || 'car-sedan',
      data.carName || 'Standart Sedan',
      data.score,
      data.trackId
    )

    if (!res.success) {
      return { success: false, error: res.reason }
    }

    return { success: true, rank: res.rank, isNewBest: res.isNewBest }
  }

  public getCategory(category: LeaderboardCategory, limit = 25): LeaderboardDataPayload {
    const list = this.entries[category] || []
    return {
      category,
      entries: list.slice(0, limit),
      updatedAt: Date.now(),
    }
  }

  public getAll(limit = 25): LeaderboardAllPayload {
    return {
      fastest_lap: this.entries.fastest_lap.slice(0, limit),
      best_drift_score: this.entries.best_drift_score.slice(0, limit),
      best_drift_combo: this.entries.best_drift_combo.slice(0, limit),
      city_top_speed: this.entries.city_top_speed.slice(0, limit),
      updatedAt: Date.now(),
    }
  }

  public getUserRank(category: LeaderboardCategory, playerId: string): { rank: number; entry: LeaderboardEntry } | null {
    const list = this.entries[category] || []
    const idx = list.findIndex((e) => e.playerId === playerId)
    if (idx === -1) return null
    return {
      rank: idx + 1,
      entry: list[idx],
    }
  }

  public broadcastLeaderboardAll(): void {
    if (!this.io) return
    const all = this.getAll(25)
    this.io.emit(SOCKET_EVENTS.LEADERBOARD_UPDATE, all)
  }
}
