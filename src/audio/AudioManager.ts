/**
 * AudioManager coordinates all driving sound effects, dynamic engine modulation,
 * tire skids, collisions, race countdowns, and UI feedback using Web Audio API (Phase 22).
 */

export interface DrivingAudioState {
  speedKmh: number
  throttle: number
  isBraking: boolean
  isDrifting: boolean
  slipAngleRad: number
}

export type SoundKey =
  | 'engine_idle'
  | 'engine_accel'
  | 'brake'
  | 'skid'
  | 'collision'
  | 'countdown_beep'
  | 'countdown_go'
  | 'race_finish'
  | 'menu_click'

export class AudioManager {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private engineMasterGain: GainNode | null = null

  // Engine audio nodes
  private engineIdleSource: AudioBufferSourceNode | null = null
  private engineIdleGain: GainNode | null = null
  private engineAccelSource: AudioBufferSourceNode | null = null
  private engineAccelGain: GainNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private isEngineRunning: boolean = false

  // Tire skid audio nodes
  private skidSource: AudioBufferSourceNode | null = null
  private skidGain: GainNode | null = null
  private skidFilter: BiquadFilterNode | null = null
  private isSkidRunning: boolean = false

  // Brake audio throttle
  private lastBrakeSoundTime: number = 0

  // Asset buffer storage
  private audioBuffers: Map<SoundKey, AudioBuffer> = new Map()
  private isUnlocked: boolean = false
  private isMuted: boolean = false
  private masterVolume: number = 0.85
  private lastCollisionTime: number = 0

  constructor() {
    this.checkMutePreference()
    this.setupUnlockListeners()
  }

  /**
   * Reads initial mute setting from localStorage
   */
  private checkMutePreference(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem('browsercar_audio_muted')
        if (stored === 'true') {
          this.isMuted = true
        }
      }
    } catch {
      // LocalStorage access may fail in private mode; silently ignore
    }
  }

  /**
   * Attaches one-time gesture listeners to unlock Web Audio on first user interaction
   */
  private setupUnlockListeners(): void {
    if (typeof window === 'undefined') return

    const unlock = () => {
      this.unlockAudio().catch(() => {})
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('click', unlock)
      window.removeEventListener('touchstart', unlock)
    }

    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('keydown', unlock, { passive: true })
    window.addEventListener('click', unlock, { passive: true })
    window.addEventListener('touchstart', unlock, { passive: true })
  }

  /**
   * Ensures AudioContext exists and is running after user interaction
   */
  public async unlockAudio(): Promise<boolean> {
    if (this.isUnlocked && this.ctx && this.ctx.state === 'running') {
      return true
    }

    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!AudioCtx) return false
        this.ctx = new AudioCtx()

        // Create Master Gain Graph
        this.masterGain = this.ctx.createGain()
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime)
        this.masterGain.connect(this.ctx.destination)

        this.sfxGain = this.ctx.createGain()
        this.sfxGain.gain.setValueAtTime(1.0, this.ctx.currentTime)
        this.sfxGain.connect(this.masterGain)

        this.engineMasterGain = this.ctx.createGain()
        this.engineMasterGain.gain.setValueAtTime(0.75, this.ctx.currentTime)
        this.engineMasterGain.connect(this.masterGain)
      }

      if (this.ctx.state === 'suspended') {
        await this.ctx.resume()
      }

      this.isUnlocked = true

      // Preload assets and start background engine loops once unlocked
      this.loadAllAssets().then(() => {
        this.startEngineLoops()
        this.startSkidLoop()
      }).catch(() => {})

      return true
    } catch {
      return false
    }
  }

  /**
   * Preloads all WAV audio files from /assets/audio/
   */
  public async loadAllAssets(): Promise<void> {
    if (!this.ctx) return

    const soundFiles: Array<{ key: SoundKey; path: string }> = [
      { key: 'engine_idle', path: '/assets/audio/engine_idle.wav' },
      { key: 'engine_accel', path: '/assets/audio/engine_accel.wav' },
      { key: 'brake', path: '/assets/audio/brake.wav' },
      { key: 'skid', path: '/assets/audio/skid.wav' },
      { key: 'collision', path: '/assets/audio/collision.wav' },
      { key: 'countdown_beep', path: '/assets/audio/countdown_beep.wav' },
      { key: 'countdown_go', path: '/assets/audio/countdown_go.wav' },
      { key: 'race_finish', path: '/assets/audio/race_finish.wav' },
      { key: 'menu_click', path: '/assets/audio/menu_click.wav' },
    ]

    await Promise.all(
      soundFiles.map(async ({ key, path }) => {
        try {
          const res = await fetch(path)
          if (res.ok) {
            const arrayBuf = await res.arrayBuffer()
            if (this.ctx) {
              const audioBuf = await this.ctx.decodeAudioData(arrayBuf)
              this.audioBuffers.set(key, audioBuf)
            }
          }
        } catch {
          // Graceful fallback: built-in procedural audio synthesizers will handle any missing assets
        }
      })
    )
  }

  /**
   * Starts looping engine sounds (idle + acceleration blend)
   */
  private startEngineLoops(): void {
    if (!this.ctx || !this.engineMasterGain || this.isEngineRunning) return
    const now = this.ctx.currentTime

    // Filter node for engine tone warmth
    this.engineFilter = this.ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.setValueAtTime(1400, now)
    this.engineFilter.connect(this.engineMasterGain)

    // 1. Idle Source
    const idleBuf = this.audioBuffers.get('engine_idle')
    if (idleBuf) {
      this.engineIdleSource = this.ctx.createBufferSource()
      this.engineIdleSource.buffer = idleBuf
      this.engineIdleSource.loop = true
      this.engineIdleGain = this.ctx.createGain()
      this.engineIdleGain.gain.setValueAtTime(0.6, now)

      this.engineIdleSource.connect(this.engineIdleGain)
      this.engineIdleGain.connect(this.engineFilter)
      this.engineIdleSource.start()
    }

    // 2. Acceleration Source
    const accelBuf = this.audioBuffers.get('engine_accel')
    if (accelBuf) {
      this.engineAccelSource = this.ctx.createBufferSource()
      this.engineAccelSource.buffer = accelBuf
      this.engineAccelSource.loop = true
      this.engineAccelGain = this.ctx.createGain()
      this.engineAccelGain.gain.setValueAtTime(0.0, now)

      this.engineAccelSource.connect(this.engineAccelGain)
      this.engineAccelGain.connect(this.engineFilter)
      this.engineAccelSource.start()
    }

    this.isEngineRunning = true
  }

  /**
   * Starts looping tire skid node with gain initially muted (0)
   */
  private startSkidLoop(): void {
    if (!this.ctx || !this.sfxGain || this.isSkidRunning) return
    const skidBuf = this.audioBuffers.get('skid')
    if (!skidBuf) return

    const now = this.ctx.currentTime
    this.skidFilter = this.ctx.createBiquadFilter()
    this.skidFilter.type = 'bandpass'
    this.skidFilter.frequency.setValueAtTime(1200, now)
    this.skidFilter.Q.setValueAtTime(1.8, now)
    this.skidFilter.connect(this.sfxGain)

    this.skidGain = this.ctx.createGain()
    this.skidGain.gain.setValueAtTime(0.0, now)
    this.skidGain.connect(this.skidFilter)

    this.skidSource = this.ctx.createBufferSource()
    this.skidSource.buffer = skidBuf
    this.skidSource.loop = true
    this.skidSource.connect(this.skidGain)
    this.skidSource.start()

    this.isSkidRunning = true
  }

  /**
   * Continuously updates vehicle driving audio parameters based on physics state
   */
  public updateDrivingAudio(state: DrivingAudioState): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return
    const now = this.ctx.currentTime
    const absSpeed = Math.abs(state.speedKmh)
    const speedRatio = Math.min(absSpeed / 140, 1.0)
    const throttle = Math.max(0, Math.min(1, state.throttle))

    // 1. Engine RPM & Pitch Modulation
    const basePitch = 0.82 + speedRatio * 1.35 + throttle * 0.22
    if (this.engineIdleSource && this.engineIdleSource.playbackRate) {
      this.engineIdleSource.playbackRate.setTargetAtTime(basePitch, now, 0.08)
    }
    if (this.engineAccelSource && this.engineAccelSource.playbackRate) {
      this.engineAccelSource.playbackRate.setTargetAtTime(basePitch * 1.08, now, 0.08)
    }

    // 2. Idle vs Accel Cross-fade
    if (this.engineIdleGain) {
      // Idle volume fades down slightly as car speeds up
      const targetIdleGain = Math.max(0.18, 0.55 - speedRatio * 0.35)
      this.engineIdleGain.gain.setTargetAtTime(targetIdleGain, now, 0.08)
    }
    if (this.engineAccelGain) {
      // Accel volume increases with throttle and speed
      const targetAccelGain = throttle > 0.05 ? Math.min(0.85, 0.25 + throttle * 0.45 + speedRatio * 0.2) : speedRatio * 0.15
      this.engineAccelGain.gain.setTargetAtTime(targetAccelGain, now, 0.08)
    }

    // 3. Engine Filter (opens up on throttle)
    if (this.engineFilter) {
      const targetFreq = 950 + speedRatio * 2800 + throttle * 1600
      this.engineFilter.frequency.setTargetAtTime(targetFreq, now, 0.08)
    }

    // 4. Tire Skid Audio Modulation
    const slipMagnitude = Math.abs(state.slipAngleRad)
    const isDriftingHard = state.isDrifting || (slipMagnitude > 0.26 && absSpeed > 8)

    if (this.skidGain) {
      if (isDriftingHard) {
        const targetSkidVol = Math.min(Math.max((slipMagnitude - 0.2) * 1.5, 0.3), 0.95)
        this.skidGain.gain.setTargetAtTime(targetSkidVol, now, 0.06)
        if (this.skidSource && this.skidSource.playbackRate) {
          this.skidSource.playbackRate.setTargetAtTime(0.9 + speedRatio * 0.35, now, 0.06)
        }
      } else {
        this.skidGain.gain.setTargetAtTime(0.0, now, 0.12)
      }
    }

    // 5. Brake Disc Friction Audio
    if (state.isBraking && absSpeed > 10 && !isDriftingHard) {
      if (now - this.lastBrakeSoundTime > 0.65) {
        this.lastBrakeSoundTime = now
        this.playBrake(Math.min(absSpeed / 70, 1.0))
      }
    }
  }

  /**
   * Plays brake pad friction squeal
   */
  public playBrake(intensity: number = 0.5): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return
    const buf = this.audioBuffers.get('brake')
    if (buf && this.sfxGain) {
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(Math.min(0.6 * intensity, 0.7), this.ctx.currentTime)
      src.connect(gain)
      gain.connect(this.sfxGain)
      src.start()
    } else {
      // Procedural brake squeal synthesis
      this.synthesizeBrake(intensity)
    }
  }

  /**
   * Plays collision impact sound
   */
  public playCollision(intensity: number = 0.5): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return
    const now = this.ctx.currentTime
    if (now - this.lastCollisionTime < 0.15) return // Throttle repetitive collision ticks
    this.lastCollisionTime = now

    const clampedIntensity = Math.max(0.15, Math.min(1.0, intensity))
    const buf = this.audioBuffers.get('collision')

    if (buf && this.sfxGain) {
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(Math.min(0.4 + clampedIntensity * 0.6, 1.0), now)

      // Slight random pitch detune for variety
      src.playbackRate.setValueAtTime(0.9 + Math.random() * 0.25, now)
      src.connect(gain)
      gain.connect(this.sfxGain)
      src.start()
    } else {
      this.synthesizeCollision(clampedIntensity)
    }
  }

  /**
   * Plays race countdown beeps: 3, 2, 1 (short beep) or GO! (high chime)
   */
  public playCountdown(isGo: boolean = false): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return
    const key: SoundKey = isGo ? 'countdown_go' : 'countdown_beep'
    const buf = this.audioBuffers.get(key)

    if (buf && this.sfxGain) {
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(isGo ? 0.9 : 0.75, this.ctx.currentTime)
      src.connect(gain)
      gain.connect(this.sfxGain)
      src.start()
    } else {
      this.synthesizeCountdown(isGo)
    }
  }

  /**
   * Plays race finish victory fanfare
   */
  public playFinish(): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return
    const buf = this.audioBuffers.get('race_finish')

    if (buf && this.sfxGain) {
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(0.85, this.ctx.currentTime)
      src.connect(gain)
      gain.connect(this.sfxGain)
      src.start()
    } else {
      this.synthesizeFinish()
    }
  }

  /**
   * Plays snappy menu UI button click
   */
  public playClick(): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return
    const buf = this.audioBuffers.get('menu_click')

    if (buf && this.sfxGain) {
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(0.4, this.ctx.currentTime)
      src.connect(gain)
      gain.connect(this.sfxGain)
      src.start()
    } else {
      this.synthesizeClick()
    }
  }

  /**
   * Plays respawn / vehicle reset whoosh
   */
  public playRespawn(): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return
    const now = this.ctx.currentTime

    // Synthesize futuristic warp whoosh
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(220, now)
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.28)

    gain.gain.setValueAtTime(0.35, now)
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.32)

    osc.connect(gain)
    if (this.sfxGain) gain.connect(this.sfxGain)
    osc.start(now)
    osc.stop(now + 0.35)
  }

  // --- PROCEDURAL AUDIO SYNTHESIZERS (FALLBACK & ZERO ASSET DEPENDENCY) ---

  private synthesizeCountdown(isGo: boolean): void {
    if (!this.ctx || !this.sfxGain) return
    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = isGo ? 'triangle' : 'sine'
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now)

    const duration = isGo ? 0.35 : 0.16
    gain.gain.setValueAtTime(isGo ? 0.7 : 0.6, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    osc.connect(gain)
    gain.connect(this.sfxGain)
    osc.start(now)
    osc.stop(now + duration)
  }

  private synthesizeCollision(intensity: number): void {
    if (!this.ctx || !this.sfxGain) return
    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(110, now)
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.35)

    const vol = Math.min(0.8 * intensity, 0.9)
    gain.gain.setValueAtTime(vol, now)
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45)

    osc.connect(gain)
    gain.connect(this.sfxGain)
    osc.start(now)
    osc.stop(now + 0.45)
  }

  private synthesizeFinish(): void {
    if (!this.ctx || !this.sfxGain) return
    const now = this.ctx.currentTime
    const notes = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6

    notes.forEach((freq, idx) => {
      const noteTime = now + idx * 0.18
      const osc = this.ctx!.createOscillator()
      const gain = this.ctx!.createGain()

      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, noteTime)

      gain.gain.setValueAtTime(0.5, noteTime)
      gain.gain.exponentialRampToValueAtTime(0.01, noteTime + 0.4)

      osc.connect(gain)
      gain.connect(this.sfxGain!)
      osc.start(noteTime)
      osc.stop(noteTime + 0.42)
    })
  }

  private synthesizeClick(): void {
    if (!this.ctx || !this.sfxGain) return
    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(1200, now)

    gain.gain.setValueAtTime(0.35, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)

    osc.connect(gain)
    gain.connect(this.sfxGain)
    osc.start(now)
    osc.stop(now + 0.045)
  }

  private synthesizeBrake(intensity: number): void {
    if (!this.ctx || !this.sfxGain) return
    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(2900, now)

    const vol = Math.min(0.25 * intensity, 0.4)
    gain.gain.setValueAtTime(vol, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)

    osc.connect(gain)
    gain.connect(this.sfxGain)
    osc.start(now)
    osc.stop(now + 0.36)
  }

  // --- VOLUME & MUTE CONTROLS ---

  public setMuted(muted: boolean): void {
    this.isMuted = muted
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('browsercar_audio_muted', muted ? 'true' : 'false')
      }
    } catch {
      // Ignore localStorage errors
    }

    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime)
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted)
    return this.isMuted
  }

  public getIsMuted(): boolean {
    return this.isMuted
  }

  public setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol))
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime)
    }
  }

  public getMasterVolume(): number {
    return this.masterVolume
  }

  public getIsUnlocked(): boolean {
    return this.isUnlocked
  }

  public getContextState(): string {
    return this.ctx ? this.ctx.state : 'uninitialized'
  }

  public dispose(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {})
      this.ctx = null
    }
  }
}
