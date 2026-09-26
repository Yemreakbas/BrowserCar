import type { ModeHUDController } from '../modes/types.ts'

export interface GameHUDOptions {
  onSpawnClick?: () => void
  onResetClick?: () => void
  onMenuClick?: () => void
  onMultiplayerClick?: () => void
  onAudioClick?: () => void
  onGarageClick?: () => void
}

/**
 * GameHUD coordinates all in-game head-up display components, mode-specific cards
 * (City, Race, Drift), speedometer, telemetry, notifications, audio controls, and animations (Phase 21-23).
 */
export class GameHUD implements ModeHUDController {
  // Common HUD Elements
  private hudAssetStatus: HTMLElement | null
  private hudFpsBadge: HTMLElement | null
  private hudSpeed: HTMLElement | null
  private hudGear: HTMLElement | null
  private hudSpeedBar: HTMLElement | null

  // Action Buttons
  private btnSpawn: HTMLElement | null
  private spawnBtnText: HTMLElement | null
  private btnReset: HTMLElement | null
  private btnMenu: HTMLElement | null
  private btnMultiplayer: HTMLElement | null
  private btnAudio: HTMLElement | null
  private audioBtnIcon: HTMLElement | null
  private audioBtnText: HTMLElement | null
  private btnGarage: HTMLElement | null

  // City Mode Card Elements
  private cityInfoCard: HTMLElement | null
  private citySpawnBadge: HTMLElement | null
  private cityOnlineCount: HTMLElement | null
  private cityLocationName: HTMLElement | null

  // Race Mode Card Elements
  private raceTelemetryCard: HTMLElement | null
  private racePositionBadge: HTMLElement | null
  private raceLapBadge: HTMLElement | null
  private raceLapTime: HTMLElement | null
  private raceBestTime: HTMLElement | null
  private raceCheckpointStatus: HTMLElement | null
  private raceCountdownOverlay: HTMLElement | null
  private raceCountdownText: HTMLElement | null
  private raceWrongWay: HTMLElement | null

  // Drift Mode Card Elements
  private driftTelemetryCard: HTMLElement | null
  private driftComboText: HTMLElement | null
  private driftScoreBadge: HTMLElement | null
  private driftAngleText: HTMLElement | null
  private driftTotalScore: HTMLElement | null
  private driftStatusText: HTMLElement | null

  // Alerts & Notifications
  private resetToast: HTMLElement | null
  private resetToastText: HTMLElement | null
  private resetToastIcon: HTMLElement | null
  private actionHint: HTMLElement | null
  private actionHintText: HTMLElement | null
  private screenFlash: HTMLElement | null

  private toastTimeout: number | null = null

  constructor(options?: GameHUDOptions) {
    // 1. Locate DOM Nodes
    this.hudAssetStatus = document.getElementById('hud-asset-status')
    this.hudFpsBadge = document.getElementById('hud-fps-badge')
    this.hudSpeed = document.getElementById('hud-speed')
    this.hudGear = document.getElementById('hud-gear')
    this.hudSpeedBar = document.getElementById('hud-speed-bar')

    this.btnSpawn = document.getElementById('btn-spawn')
    this.spawnBtnText = document.getElementById('spawn-btn-text')
    this.btnReset = document.getElementById('btn-reset')
    this.btnMenu = document.getElementById('btn-menu')
    this.btnMultiplayer = document.getElementById('btn-multiplayer')
    this.btnAudio = document.getElementById('btn-audio')
    this.audioBtnIcon = document.getElementById('audio-btn-icon')
    this.audioBtnText = document.getElementById('audio-btn-text')
    this.btnGarage = document.getElementById('btn-garage')

    this.cityInfoCard = document.getElementById('city-info-card')
    this.citySpawnBadge = document.getElementById('city-spawn-badge')
    this.cityOnlineCount = document.getElementById('city-online-count')
    this.cityLocationName = document.getElementById('city-location-name')

    this.raceTelemetryCard = document.getElementById('race-telemetry-card')
    this.racePositionBadge = document.getElementById('race-position-badge')
    this.raceLapBadge = document.getElementById('race-lap-badge')
    this.raceLapTime = document.getElementById('race-lap-time')
    this.raceBestTime = document.getElementById('race-best-time')
    this.raceCheckpointStatus = document.getElementById('race-checkpoint-status')
    this.raceCountdownOverlay = document.getElementById('race-countdown-overlay')
    this.raceCountdownText = document.getElementById('race-countdown-text')
    this.raceWrongWay = document.getElementById('race-wrong-way')

    this.driftTelemetryCard = document.getElementById('drift-telemetry-card')
    this.driftComboText = document.getElementById('drift-combo-text')
    this.driftScoreBadge = document.getElementById('drift-score-badge')
    this.driftAngleText = document.getElementById('drift-angle-text')
    this.driftTotalScore = document.getElementById('drift-total-score')
    this.driftStatusText = document.getElementById('drift-status-text')

    this.resetToast = document.getElementById('hud-reset-toast')
    this.resetToastText = document.getElementById('hud-reset-text')
    this.resetToastIcon = document.getElementById('hud-reset-icon')
    this.actionHint = document.getElementById('hud-action-hint')
    this.actionHintText = document.getElementById('hud-action-hint-text')
    this.screenFlash = document.getElementById('reset-screen-flash')

    // 2. Attach Event Handlers if provided
    if (options?.onSpawnClick && this.btnSpawn) {
      this.btnSpawn.addEventListener('click', options.onSpawnClick)
    }
    if (options?.onResetClick && this.btnReset) {
      this.btnReset.addEventListener('click', options.onResetClick)
    }
    if (options?.onMenuClick && this.btnMenu) {
      this.btnMenu.addEventListener('click', options.onMenuClick)
    }
    if (options?.onMultiplayerClick && this.btnMultiplayer) {
      this.btnMultiplayer.addEventListener('click', options.onMultiplayerClick)
    }
    if (options?.onAudioClick && this.btnAudio) {
      this.btnAudio.addEventListener('click', options.onAudioClick)
    }
    if (options?.onGarageClick && this.btnGarage) {
      this.btnGarage.addEventListener('click', options.onGarageClick)
    }
  }

  // --- SPEEDOMETER & TELEMETRY ---
  public updateSpeed(speedKmh: number, gear: 'D' | 'N' | 'R', maxSpeedKmh: number = 137): void {
    if (this.hudSpeed) {
      this.hudSpeed.textContent = Math.round(speedKmh).toString()
    }

    if (this.hudSpeedBar) {
      const speedPercent = Math.min(speedKmh / maxSpeedKmh, 1.0) * 100
      this.hudSpeedBar.style.width = `${speedPercent}%`
    }

    if (this.hudGear) {
      this.hudGear.textContent = gear
      if (gear === 'N') {
        this.hudGear.className = 'gear-badge neutral'
      } else if (gear === 'R') {
        this.hudGear.className = 'gear-badge reverse'
      } else {
        this.hudGear.className = 'gear-badge'
      }
    }
  }

  // --- HEADER & FPS ---
  public setSubtitle(text: string, color: string = '#94a3b8'): void {
    if (this.hudAssetStatus) {
      this.hudAssetStatus.textContent = text
      this.hudAssetStatus.style.color = color
    }
  }

  public setFps(fps: number): void {
    if (this.hudFpsBadge) {
      this.hudFpsBadge.textContent = `${fps} FPS`
      if (fps >= 55) {
        this.hudFpsBadge.style.color = '#34d399'
      } else if (fps >= 35) {
        this.hudFpsBadge.style.color = '#facc15'
      } else {
        this.hudFpsBadge.style.color = '#ef4444'
      }
    }
  }

  public setAudioMuted(isMuted: boolean): void {
    if (this.audioBtnIcon) {
      this.audioBtnIcon.textContent = isMuted ? '🔇' : '🔊'
    }
    if (this.audioBtnText) {
      this.audioBtnText.textContent = isMuted ? 'Sessiz' : 'Ses'
    }
  }

  // --- MODE CONTROLLER INTERFACE METHODS ---
  public setTelemetryVisible(visible: boolean): void {
    if (this.raceTelemetryCard) {
      this.raceTelemetryCard.style.display = visible ? 'block' : 'none'
    }
  }

  public setDriftCardVisible(visible: boolean): void {
    if (this.driftTelemetryCard) {
      this.driftTelemetryCard.style.display = visible ? 'block' : 'none'
    }
  }

  public setCityCardVisible(visible: boolean): void {
    if (this.cityInfoCard) {
      this.cityInfoCard.style.display = visible ? 'block' : 'none'
    }
  }

  public setSpawnButtonVisible(visible: boolean): void {
    if (this.btnSpawn) {
      this.btnSpawn.style.display = visible ? 'flex' : 'none'
    }
  }

  public setSpawnText(text: string): void {
    if (this.spawnBtnText) {
      this.spawnBtnText.textContent = text
    }
  }

  // --- CITY MODE TELEMETRY ---
  public updateCityHUD(onlineCount: number, locationName: string, spawnIndexText: string): void {
    if (this.cityOnlineCount) {
      this.cityOnlineCount.textContent = `${onlineCount} Çevrimiçi`
    }
    if (this.cityLocationName) {
      this.cityLocationName.textContent = locationName
    }
    if (this.citySpawnBadge) {
      this.citySpawnBadge.textContent = spawnIndexText
    }
  }

  // --- RACE MODE TELEMETRY ---
  public updateRaceTelemetry(
    lapText: string,
    timeText: string,
    bestText: string,
    checkpointText: string,
    positionText?: string
  ): void {
    if (this.raceLapBadge) this.raceLapBadge.textContent = lapText
    if (this.raceLapTime) this.raceLapTime.textContent = timeText
    if (this.raceBestTime) this.raceBestTime.textContent = bestText
    if (this.raceCheckpointStatus) this.raceCheckpointStatus.textContent = checkpointText

    if (this.racePositionBadge && positionText) {
      this.racePositionBadge.textContent = positionText
      if (positionText.startsWith('P1') || positionText === '1/1') {
        this.racePositionBadge.className = 'race-position-badge p1'
      } else if (positionText.startsWith('P2')) {
        this.racePositionBadge.className = 'race-position-badge p2'
      } else if (positionText.startsWith('P3')) {
        this.racePositionBadge.className = 'race-position-badge p3'
      } else {
        this.racePositionBadge.className = 'race-position-badge'
      }
    }
  }

  public setRaceCountdown(text: string | null, color?: string | null): void {
    if (!this.raceCountdownOverlay || !this.raceCountdownText) return
    if (text) {
      this.raceCountdownOverlay.style.display = 'flex'
      this.raceCountdownText.textContent = text
      if (color) this.raceCountdownText.style.color = color
    } else {
      this.raceCountdownOverlay.style.display = 'none'
    }
  }

  public setWrongWayVisible(visible: boolean): void {
    if (this.raceWrongWay) {
      this.raceWrongWay.style.display = visible ? 'block' : 'none'
    }
  }

  // --- DRIFT MODE TELEMETRY ---
  public updateDriftTelemetry(
    scoreText: string,
    comboText: string,
    statusText: string,
    angleText?: string,
    totalText?: string,
    isDrifting?: boolean
  ): void {
    if (this.driftScoreBadge) this.driftScoreBadge.textContent = scoreText
    if (this.driftComboText) {
      this.driftComboText.textContent = comboText
      if (isDrifting) {
        this.driftComboText.classList.add('active-drift')
      } else {
        this.driftComboText.classList.remove('active-drift')
      }
    }
    if (this.driftStatusText) this.driftStatusText.textContent = statusText
    if (this.driftAngleText && angleText) this.driftAngleText.textContent = angleText
    if (this.driftTotalScore && totalText) this.driftTotalScore.textContent = totalText
  }

  public setDriftCountdown(text: string | null, color?: string | null): void {
    this.setRaceCountdown(text, color)
  }

  // --- NOTIFICATION TOAST & ACTION HINTS ---
  public showResetToast(message: string, type: 'info' | 'warning' | 'alert' = 'info', durationMs: number = 2200): void {
    if (!this.resetToast || !this.resetToastText) return

    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout)
      this.toastTimeout = null
    }

    this.resetToast.className = ''
    this.resetToast.classList.add('show', type)

    const iconMap = {
      info: '🔄',
      warning: '⚠️',
      alert: '💥',
    }
    if (this.resetToastIcon) {
      this.resetToastIcon.textContent = iconMap[type] || '🔄'
    }
    this.resetToastText.textContent = message

    this.toastTimeout = window.setTimeout(() => {
      if (this.resetToast) this.resetToast.classList.remove('show')
      this.toastTimeout = null
    }, durationMs)
  }

  public setActionHint(hint: string | null): void {
    if (!this.actionHint || !this.actionHintText) return
    if (hint) {
      this.actionHintText.textContent = hint
      this.actionHint.classList.add('show')
    } else {
      this.actionHint.classList.remove('show')
    }
  }

  public triggerScreenFlash(): void {
    if (!this.screenFlash) return
    this.screenFlash.classList.add('flash')
    window.setTimeout(() => {
      if (this.screenFlash) this.screenFlash.classList.remove('flash')
    }, 280)
  }
}
