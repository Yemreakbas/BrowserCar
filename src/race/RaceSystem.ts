import * as THREE from 'three'
import type { RaceTrack } from '../world/RaceTrack.ts'

export const RaceState = {
  PRE_RACE: 'PRE_RACE',
  COUNTDOWN: 'COUNTDOWN',
  RACING: 'RACING',
  FINISHED: 'FINISHED',
} as const
export type RaceState = (typeof RaceState)[keyof typeof RaceState]

export interface RaceResult {
  totalTime: number
  bestLapTime: number
  lapTimes: number[]
  rating: string
  ratingIcon: string
}

export interface RaceHUDUpdate {
  state: RaceState
  countdownText: string | null
  countdownColor: string | null
  isControlLocked: boolean
  isWrongWay: boolean
  currentLap: number
  totalLaps: number
  currentLapTime: number
  bestLapTime: number | null
  lapMessage: string | null
  checkpointText: string
  result: RaceResult | null
}

export class RaceSystem {
  public state: RaceState = RaceState.PRE_RACE
  public readonly totalLaps: number = 3

  public currentLap: number = 1
  public currentLapTime: number = 0
  public totalRaceTime: number = 0
  public bestLapTime: number | null = null
  public lapTimes: number[] = []

  public nextCheckpointIndex: number = 1
  public isWrongWay: boolean = false
  public lapMessage: string | null = null

  private countdownTimer: number = 3.6
  private result: RaceResult | null = null
  private tempCarForward = new THREE.Vector3()

  public startRace(raceTrack: RaceTrack): void {
    this.state = RaceState.COUNTDOWN
    this.countdownTimer = 3.6
    this.currentLap = 1
    this.currentLapTime = 0
    this.totalRaceTime = 0
    this.bestLapTime = null
    this.lapTimes = []
    this.nextCheckpointIndex = 1
    this.isWrongWay = false
    this.lapMessage = '3 Tur Grand Prix Mücadelesi Başlıyor!'
    this.result = null

    // Reset race track lap state
    raceTrack.lapState.currentLap = 1
    raceTrack.lapState.currentLapTime = 0
    raceTrack.lapState.bestLapTime = null
    raceTrack.lapState.nextCheckpointIndex = 1
    raceTrack.lapState.isLapComplete = false
  }

  public update(
    delta: number,
    carPos: THREE.Vector3,
    carQuaternion: THREE.Quaternion,
    carSpeed: number,
    raceTrack: RaceTrack
  ): RaceHUDUpdate {
    let countdownText: string | null = null
    let countdownColor: string | null = null
    let isControlLocked = false

    // 1. COUNTDOWN STATE
    if (this.state === RaceState.COUNTDOWN) {
      isControlLocked = true
      this.countdownTimer -= delta

      if (this.countdownTimer > 2.6) {
        countdownText = '3'
        countdownColor = '#ef4444' // Red
      } else if (this.countdownTimer > 1.6) {
        countdownText = '2'
        countdownColor = '#f59e0b' // Amber
      } else if (this.countdownTimer > 0.6) {
        countdownText = '1'
        countdownColor = '#eab308' // Yellow
      } else if (this.countdownTimer > 0.0) {
        countdownText = 'BAŞLA! 🏁'
        countdownColor = '#22c55e' // Green
        isControlLocked = false // Release controls on "GO!"
      } else {
        // Countdown completed -> transition to RACING
        this.state = RaceState.RACING
        isControlLocked = false
        countdownText = null
        this.countdownTimer = 0
        this.lapMessage = 'Yarış Başladı! 1. Sektöre İlerle'
      }
    }

    // 2. RACING STATE
    if (this.state === RaceState.RACING) {
      this.currentLapTime += delta
      this.totalRaceTime += delta

      // Get target checkpoint
      const checkpoints = raceTrack.checkpoints
      const targetCp = checkpoints[this.nextCheckpointIndex]

      // Check Direction Alignment (Prevent reverse direction driving)
      this.tempCarForward.set(0, 0, 1).applyQuaternion(carQuaternion)
      const dot = this.tempCarForward.dot(targetCp.forward)

      if (Math.abs(carSpeed) > 3.0 && dot < -0.3) {
        this.isWrongWay = true
      } else if (dot > 0.1) {
        this.isWrongWay = false
      }

      // Check Checkpoint Crossing Proximity
      const dist = Math.hypot(carPos.x - targetCp.position.x, carPos.z - targetCp.position.z)

      // Only register checkpoint if close AND not driving completely backwards
      if (dist <= targetCp.radius && dot > -0.2) {
        if (this.nextCheckpointIndex === 0) {
          // Completed a full lap!
          this.lapTimes.push(this.currentLapTime)

          if (this.bestLapTime === null || this.currentLapTime < this.bestLapTime) {
            this.bestLapTime = this.currentLapTime
          }

          if (this.currentLap < this.totalLaps) {
            // Advance to next lap
            this.lapMessage = `★ Tur ${this.currentLap} Bitti! (${this.formatTime(this.currentLapTime)}) ★`
            this.currentLap++
            this.currentLapTime = 0
            this.nextCheckpointIndex = 1
          } else {
            // ALL LAPS COMPLETED -> FINISH RACE!
            this.finishRace()
          }
        } else {
          // Intermediate Sector Checkpoint passed
          this.lapMessage = `${targetCp.name} Geçildi (${this.nextCheckpointIndex}/${checkpoints.length - 1})`
          this.nextCheckpointIndex = (this.nextCheckpointIndex + 1) % checkpoints.length
        }
      }
    }

    // 3. FINISHED STATE
    if (this.state === RaceState.FINISHED) {
      isControlLocked = false
    }

    const checkpointText =
      this.nextCheckpointIndex === 0
        ? 'Bitiş Çizgisine İlerle!'
        : `Sektör ${this.nextCheckpointIndex}/${raceTrack.checkpoints.length - 1}`

    return {
      state: this.state,
      countdownText,
      countdownColor,
      isControlLocked,
      isWrongWay: this.isWrongWay,
      currentLap: this.currentLap,
      totalLaps: this.totalLaps,
      currentLapTime: this.currentLapTime,
      bestLapTime: this.bestLapTime,
      lapMessage: this.lapMessage,
      checkpointText,
      result: this.result,
    }
  }

  private finishRace(): void {
    this.state = RaceState.FINISHED
    const total = this.lapTimes.reduce((acc, t) => acc + t, 0)
    const best = Math.min(...this.lapTimes)

    let rating = 'BAŞARILI BİTİRİŞ'
    let ratingIcon = '🥉'

    if (total <= 75.0) {
      rating = 'EFSANE PİLOT'
      ratingIcon = '🏆'
    } else if (total <= 95.0) {
      rating = 'PRO YARIŞÇI'
      ratingIcon = '🥈'
    }

    this.result = {
      totalTime: total,
      bestLapTime: best,
      lapTimes: [...this.lapTimes],
      rating,
      ratingIcon,
    }

    this.lapMessage = `🏁 YARIŞ BİTTİ! Toplam: ${this.formatTime(total)} (${rating})`
  }

  public reset(raceTrack: RaceTrack): void {
    this.startRace(raceTrack)
  }

  public formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 10)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`
  }
}
