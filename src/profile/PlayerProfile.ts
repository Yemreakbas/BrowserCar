/**
 * PlayerProfile.ts - Persistent Player Identity & Statistics System (Phase 24)
 *
 * Manages player profile, display name, vehicle selection, and persistent
 * statistics (races, wins, laps, best lap time, drift points, distance, playtime).
 * Survives tab refreshes, disconnects, and browser restarts via localStorage.
 */

export interface PlayerStats {
  totalRaces: number
  racesWon: number
  totalLaps: number
  bestLapTime: number | null // in seconds
  totalDriftPoints: number
  bestDriftScore: number
  maxDriftCombo: number
  totalDistanceMeters: number
  totalPlaytimeSeconds: number
}

export interface PlayerProfile {
  id: string              // Persistent player ID (e.g. usr_a1b2c3d4)
  displayName: string     // Guest or chosen nickname
  selectedCarId: string   // Active car id from VEHICLE_CATALOG
  createdAt: number       // Epoch timestamp ms
  lastSeenAt: number      // Epoch timestamp ms
  stats: PlayerStats
}

const STORAGE_KEY = 'browsercar_player_profile'
const DEFAULT_CAR_ID = 'sedan_sports'

export class PlayerProfileManager {
  private static instance: PlayerProfileManager
  private profile: PlayerProfile
  private listeners: Set<(profile: PlayerProfile) => void> = new Set()

  private constructor() {
    this.profile = this.loadOrCreateProfile()
  }

  public static getInstance(): PlayerProfileManager {
    if (!PlayerProfileManager.instance) {
      PlayerProfileManager.instance = new PlayerProfileManager()
    }
    return PlayerProfileManager.instance
  }

  /**
   * Load existing profile from localStorage or initialize a fresh persistent guest profile.
   */
  private loadOrCreateProfile(): PlayerProfile {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<PlayerProfile>
        if (parsed && typeof parsed.id === 'string' && typeof parsed.displayName === 'string') {
          // Merge with safe defaults in case new fields were added
          const profile: PlayerProfile = {
            id: parsed.id,
            displayName: parsed.displayName.slice(0, 24),
            selectedCarId: parsed.selectedCarId || localStorage.getItem('browsercar_selected_vehicle') || DEFAULT_CAR_ID,
            createdAt: parsed.createdAt || Date.now(),
            lastSeenAt: Date.now(),
            stats: {
              totalRaces: parsed.stats?.totalRaces ?? 0,
              racesWon: parsed.stats?.racesWon ?? 0,
              totalLaps: parsed.stats?.totalLaps ?? 0,
              bestLapTime: parsed.stats?.bestLapTime ?? null,
              totalDriftPoints: parsed.stats?.totalDriftPoints ?? 0,
              bestDriftScore: parsed.stats?.bestDriftScore ?? 0,
              maxDriftCombo: parsed.stats?.maxDriftCombo ?? 1.0,
              totalDistanceMeters: parsed.stats?.totalDistanceMeters ?? 0,
              totalPlaytimeSeconds: parsed.stats?.totalPlaytimeSeconds ?? 0,
            },
          }
          this.persist(profile)
          return profile
        }
      }
    } catch (e) {
      console.warn('[PlayerProfileManager] Failed to read from localStorage:', e)
    }

    // Generate brand new guest profile
    const randomSuffix = Math.floor(1000 + Math.random() * 9000)
    const randomId = 'usr_' + Math.random().toString(36).substring(2, 9)
    const storedVehicle = (typeof localStorage !== 'undefined' ? localStorage.getItem('browsercar_selected_vehicle') : null) || DEFAULT_CAR_ID

    const newProfile: PlayerProfile = {
      id: randomId,
      displayName: `Pilot_${randomSuffix}`,
      selectedCarId: storedVehicle,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      stats: {
        totalRaces: 0,
        racesWon: 0,
        totalLaps: 0,
        bestLapTime: null,
        totalDriftPoints: 0,
        bestDriftScore: 0,
        maxDriftCombo: 1.0,
        totalDistanceMeters: 0,
        totalPlaytimeSeconds: 0,
      },
    }

    this.persist(newProfile)
    return newProfile
  }

  /**
   * Persist current profile to localStorage
   */
  private persist(profile: PlayerProfile): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
      // Also maintain sync with legacy vehicle selection key
      localStorage.setItem('browsercar_selected_vehicle', profile.selectedCarId)
    } catch (e) {
      console.warn('[PlayerProfileManager] Failed to write to localStorage:', e)
    }
  }

  private notify(): void {
    this.persist(this.profile)
    for (const listener of this.listeners) {
      try {
        listener(this.profile)
      } catch (err) {
        console.error('[PlayerProfileManager] Listener error:', err)
      }
    }
  }

  public getProfile(): PlayerProfile {
    return {
      ...this.profile,
      stats: { ...this.profile.stats },
    }
  }

  public setDisplayName(name: string): PlayerProfile {
    const cleaned = name.trim().slice(0, 24)
    if (cleaned && cleaned !== this.profile.displayName) {
      this.profile.displayName = cleaned
      this.profile.lastSeenAt = Date.now()
      this.notify()
    }
    return this.getProfile()
  }

  public setSelectedCar(carId: string): PlayerProfile {
    if (carId && carId !== this.profile.selectedCarId) {
      this.profile.selectedCarId = carId
      this.profile.lastSeenAt = Date.now()
      this.notify()
    }
    return this.getProfile()
  }

  public recordRaceResult(bestLap: number | null, laps: number, isWin: boolean): PlayerProfile {
    this.profile.stats.totalRaces += 1
    if (isWin) {
      this.profile.stats.racesWon += 1
    }
    this.profile.stats.totalLaps += Math.max(0, laps)

    if (bestLap !== null && bestLap > 0) {
      if (this.profile.stats.bestLapTime === null || bestLap < this.profile.stats.bestLapTime) {
        this.profile.stats.bestLapTime = Math.round(bestLap * 100) / 100
      }
    }

    this.profile.lastSeenAt = Date.now()
    this.notify()
    return this.getProfile()
  }

  public recordDriftResult(score: number, maxCombo: number): PlayerProfile {
    if (score > 0) {
      this.profile.stats.totalDriftPoints += Math.round(score)
      if (score > this.profile.stats.bestDriftScore) {
        this.profile.stats.bestDriftScore = Math.round(score)
      }
    }
    if (maxCombo > this.profile.stats.maxDriftCombo) {
      this.profile.stats.maxDriftCombo = Math.round(maxCombo * 10) / 10
    }

    this.profile.lastSeenAt = Date.now()
    this.notify()
    return this.getProfile()
  }

  public addDistanceAndPlaytime(meters: number, seconds: number): PlayerProfile {
    if (meters > 0) {
      this.profile.stats.totalDistanceMeters += Math.round(meters)
    }
    if (seconds > 0) {
      this.profile.stats.totalPlaytimeSeconds += Math.round(seconds)
    }
    this.profile.lastSeenAt = Date.now()
    // Do not notify every second to save DOM render overhead, but persist silently
    this.persist(this.profile)
    return this.getProfile()
  }

  public resetProfile(): PlayerProfile {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000)
    const randomId = 'usr_' + Math.random().toString(36).substring(2, 9)
    this.profile = {
      id: randomId,
      displayName: `Pilot_${randomSuffix}`,
      selectedCarId: DEFAULT_CAR_ID,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      stats: {
        totalRaces: 0,
        racesWon: 0,
        totalLaps: 0,
        bestLapTime: null,
        totalDriftPoints: 0,
        bestDriftScore: 0,
        maxDriftCombo: 1.0,
        totalDistanceMeters: 0,
        totalPlaytimeSeconds: 0,
      },
    }
    this.notify()
    return this.getProfile()
  }

  public onProfileChanged(listener: (profile: PlayerProfile) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
