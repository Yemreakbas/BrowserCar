import './style.css'
import * as THREE from 'three'
import { PhysicsWorld } from './physics/PhysicsWorld.ts'
import { Vehicle, type VehicleInput } from './vehicle/Vehicle.ts'
import { CityWorld } from './world/CityWorld.ts'
import { RaceTrack } from './world/RaceTrack.ts'
import { DriftTrack } from './world/DriftTrack.ts'

import { GameModeType, type ModeHUDController } from './modes/types.ts'
import { ModeManager } from './modes/ModeManager.ts'
import { CityFreeRoamMode } from './modes/CityFreeRoamMode.ts'
import { RaceMode } from './modes/RaceMode.ts'
import { DriftMode } from './modes/DriftMode.ts'
import { TireSmokeSystem } from './effects/TireSmoke.ts'
import type { RaceResult } from './race/RaceSystem.ts'
import { NetworkManager } from './networking/NetworkManager.ts'
import { RemotePlayerManager } from './networking/RemotePlayerManager.ts'
import { getPlayerColorHex } from './vehicle/RemoteVehicle.ts'
import { VehicleResetSystem } from './vehicle/VehicleResetSystem.ts'
import { OnlineRaceState, OnlineDriftState } from '../shared/src/constants.ts'
import type { RaceParticipantResult, DriftParticipantProgress } from '../shared/src/messages.ts'
import { FollowCamera, type CameraPreset } from './camera/FollowCamera.ts'
import { AudioManager } from './audio/AudioManager.ts'
import {
  VEHICLE_CATALOG,
  getVehicleDefinition,
  getSelectedVehicleId,
  setSelectedVehicleId,
} from './vehicle/VehicleDefinition.ts'
import { PlayerProfileManager } from './profile/PlayerProfile.ts'

// --- 1. DOM & HUD SETUP ---
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div id="canvas-container"></div>
  <div id="hud-overlay">
    <header class="hud-header">
      <div class="brand-badge">
        <span class="status-dot"></span>
        <span class="brand-title">BrowserCar 3D</span>
        <span id="hud-asset-status" class="brand-subtitle">Mod Yükleniyor...</span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <div id="hud-fps-badge" class="brand-badge" style="font-family: monospace; font-size: 13px; font-weight: 700; color: #34d399; letter-spacing: 0.5px; padding: 6px 12px;">
          -- FPS
        </div>
        <button id="btn-multiplayer" class="reset-btn" type="button" title="Çok Oyunculu Lobi (Multiplayer)">
          <span id="hud-net-dot" class="status-dot disconnected"></span>
          <span id="hud-net-text">Multiplayer</span>
          <span id="hud-net-id" class="reset-key-hint" style="display: none; background: rgba(56, 189, 248, 0.2); color: #38bdf8;">--</span>
        </button>
        <button id="btn-menu" class="reset-btn" type="button" title="Oyun Modları ve Harita Seçimi (ESC)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
            <polyline points="2 17 12 22 22 17"/>
            <polyline points="2 12 12 17 22 12"/>
          </svg>
          <span id="menu-btn-text">Modlar</span>
          <span class="reset-key-hint">ESC</span>
        </button>
        <button id="btn-garage" class="reset-btn" type="button" title="Garaj ve Araç Seçimi (G)">
          <span style="font-size: 13px;">🏎️</span>
          <span>Garaj</span>
          <span class="reset-key-hint">G</span>
        </button>
        <button id="btn-profile" class="reset-btn" type="button" title="Sürücü Profili ve İstatistikler (P)">
          <span style="font-size: 13px;">👤</span>
          <span>Profil</span>
          <span class="reset-key-hint">P</span>
        </button>
        <button id="btn-spawn" class="reset-btn" type="button" title="Başlangıç Konumunu Değiştir (C)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <span id="spawn-btn-text">Konum Değiştir</span>
          <span class="reset-key-hint">C</span>
        </button>
        <button id="btn-reset" class="reset-btn" type="button" title="Arabayı Başlangıç Konumuna Getir (R)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          <span>Sıfırla</span>
          <span class="reset-key-hint">R</span>
        </button>
        <button id="btn-audio" class="reset-btn" type="button" title="Sesi Aç / Kapat (M)">
          <span id="audio-btn-icon" style="font-size: 13px;">🔊</span>
          <span id="audio-btn-text">Ses</span>
          <span class="reset-key-hint">M</span>
        </button>
      </div>
    </header>

    <!-- Vehicle Reset Alert Toast & Action Hint (Phase 19) -->
    <div id="hud-reset-toast">
      <span id="hud-reset-icon" class="toast-icon">🔄</span>
      <span id="hud-reset-text">Araç Sıfırlandı</span>
    </div>

    <div id="hud-action-hint">
      <span id="hud-action-hint-text">⚠️ Araç Ters Döndü! [R] ile Düzelt</span>
    </div>

    <div id="reset-screen-flash" class="reset-screen-flash"></div>

    <!-- Online City Player List Overlay (Phase 15) -->
    <div id="city-player-list-card" class="city-player-list-card" style="display: none;">
      <div id="player-list-header" class="player-list-header" title="Genişlet / Daralt (TAB)">
        <div class="player-list-title">
          <span class="online-indicator"></span>
          <span id="player-list-room-title">ŞEHİR SÜRÜCÜLERİ</span>
          <span id="player-list-count-badge" class="count-badge">1</span>
        </div>
        <span class="player-list-toggle-hint">TAB</span>
      </div>
      <div id="player-list-items" class="player-list-items">
        <!-- Injected dynamically -->
      </div>
      <div class="player-list-footer">
        <span id="player-list-ping">Gecikme: -- ms</span>
        <span style="color: #64748b;">[R] Sıfırla • [C] Konum</span>
      </div>
    </div>

    <!-- Dedicated Online Race Room HUD Card (Phase 16) -->
    <div id="online-race-card" class="online-race-card" style="display: none;">
      <div class="online-race-header">
        <div class="online-race-title-group">
          <span style="font-size: 14px;">🏁</span>
          <span id="online-race-room-name" class="online-race-title">YARIŞ ODASI</span>
        </div>
        <span id="online-race-status-badge" class="online-race-badge">LOBİ</span>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span id="online-race-grid-badge" class="online-race-grid-badge">Grid #1</span>
        <span id="online-race-players-count" style="font-size: 11px; color: #94a3b8; font-family: var(--font-mono);">0/8 Sürücü</span>
      </div>

      <button id="btn-race-ready" class="online-race-btn-ready" type="button">
        <span id="btn-race-ready-icon">⚪</span>
        <span id="btn-race-ready-text">HAZIRIM (BOŞLUK)</span>
      </button>

      <div id="online-race-standings" class="online-race-standings">
        <!-- Live standings rows injected dynamically -->
      </div>
    </div>

    <!-- Dedicated Online Drift Room HUD Card (Phase 17) -->
    <div id="online-drift-card" class="online-race-card" style="display: none;">
      <div class="online-race-header">
        <div class="online-race-title-group">
          <span style="font-size: 14px;">⚡</span>
          <span id="online-drift-room-name" class="online-race-title">DRIFT ARENASI</span>
        </div>
        <span id="online-drift-status-badge" class="online-race-badge online-drift-badge">LOBİ</span>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span id="online-drift-timer-badge" class="online-drift-timer">⏱️ 60s</span>
        <span id="online-drift-players-count" style="font-size: 11px; color: #94a3b8; font-family: var(--font-mono);">0/16 Pilot</span>
      </div>

      <button id="btn-drift-ready" class="online-race-btn-ready" type="button">
        <span id="btn-drift-ready-icon">⚪</span>
        <span id="btn-drift-ready-text">HAZIRIM (BOŞLUK)</span>
      </button>

      <div id="online-drift-standings" class="online-race-standings">
        <!-- Live drift leaderboard injected dynamically -->
      </div>
    </div>

    <footer class="hud-footer">
      <div class="speedometer-card">
        <div class="speed-main">
          <span id="hud-speed" class="speed-value">0</span>
          <span class="speed-unit">KM/H</span>
          <span id="hud-gear" class="gear-badge neutral">N</span>
        </div>
        <div class="speed-bar-track">
          <div id="hud-speed-bar" class="speed-bar-fill"></div>
        </div>
      </div>

      <!-- Dedicated City Free Roam HUD Card (Phase 21) -->
      <div id="city-info-card" class="speedometer-card city-info-card" style="display: block;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 13px;">🏙️</span>
            <span style="font-size: 11px; text-transform: uppercase; color: #38bdf8; font-weight: 800; letter-spacing: 0.5px;">ŞEHİR GEZİNTİSİ</span>
          </div>
          <span id="city-spawn-badge" class="city-spawn-badge">Konum 1/4</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-family: monospace;">
          <span style="font-size: 11px; color: #94a3b8;">SÜRÜCÜLER</span>
          <span id="city-online-count" class="city-online-count">1 Çevrimiçi</span>
        </div>
        <div id="city-location-name" style="font-size: 11px; color: #cbd5e1; font-weight: 600; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          Başlangıç Çizgisi (Güney Bulvarı)
        </div>
      </div>

      <!-- Dedicated Racing Telemetry Card for Race Track Mode -->
      <div id="race-telemetry-card" class="speedometer-card" style="display: none; min-width: 220px; padding: 12px 18px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span id="race-position-badge" class="race-position-badge p1">P1</span>
            <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.5px;">YARIŞ</span>
          </div>
          <span id="race-lap-badge" style="font-size: 11px; font-weight: 800; background: #2563eb; color: white; padding: 2px 8px; border-radius: 6px;">TUR 1/3</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-family: monospace;">
          <span style="font-size: 11px; color: #94a3b8;">SÜRE</span>
          <span id="race-lap-time" style="font-size: 18px; font-weight: 800; color: #f8fafc;">00:00.0</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-family: monospace; margin-top: 2px;">
          <span style="font-size: 11px; color: #94a3b8;">EN İYİ</span>
          <span id="race-best-time" style="font-size: 13px; font-weight: 700; color: #34d399;">--:--.--</span>
        </div>
        <div id="race-checkpoint-status" style="font-size: 11px; color: #38bdf8; font-weight: 600; margin-top: 5px; text-align: right;">
          1. Sektöre İlerle
        </div>
      </div>

      <!-- Dedicated Drift Telemetry Card for Drift Mode (Phase 9) -->
      <div id="drift-telemetry-card" class="speedometer-card" style="display: none; min-width: 250px; padding: 14px 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; box-shadow: 0 0 8px #f59e0b;"></span>
            <span style="font-size: 11px; text-transform: uppercase; color: #fbbf24; font-weight: 800; letter-spacing: 0.6px;">DRIFT TELEMETRİSİ</span>
          </div>
          <span id="drift-combo-text" class="drift-combo-text" style="font-size: 12px; font-weight: 800; background: linear-gradient(135deg, #d97706, #b45309); color: white; padding: 2px 10px; border-radius: 999px; box-shadow: 0 0 10px rgba(245, 158, 11, 0.4);">1.0x</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-family: monospace;">
          <span style="font-size: 11px; color: #94a3b8;">SKOR</span>
          <span id="drift-score-badge" style="font-size: 20px; font-weight: 800; color: #fde047; letter-spacing: 0.5px;">0 PUAN</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-family: monospace; margin-top: 4px;">
          <span id="drift-angle-text" style="font-size: 11px; font-weight: 700; color: #38bdf8;">0° AÇI</span>
          <span id="drift-total-score" style="font-size: 11px; font-weight: 600; color: #94a3b8;">En İyi: 0</span>
        </div>
        <div id="drift-status-text" style="font-size: 11px; color: #f59e0b; font-weight: 700; margin-top: 6px; text-align: right; text-shadow: 0 0 8px rgba(245, 158, 11, 0.3);">
          Hızlan ve Viraja Gir (Boşluk: El Freni)
        </div>
      </div>

      <div class="controls-card">
        <div class="controls-title">Kontroller</div>
        <div class="wasd-grid">
          <div class="wasd-row">
            <div id="key-w" class="key-box">
              <span>W</span>
              <span class="key-hint">Gaz</span>
            </div>
          </div>
          <div class="wasd-row">
            <div id="key-a" class="key-box">
              <span>A</span>
              <span class="key-hint">Sol</span>
            </div>
            <div id="key-s" class="key-box">
              <span>S</span>
              <span class="key-hint">Fren</span>
            </div>
            <div id="key-d" class="key-box">
              <span>D</span>
              <span class="key-hint">Sağ</span>
            </div>
          </div>
        </div>
        <div class="controls-legend">
          <span>Modlar: ESC</span>
          <span>•</span>
          <span>Kamera: V</span>
          <span>•</span>
          <span>Konum: C</span>
          <span>•</span>
          <span>Sıfırla: R</span>
        </div>
      </div>
    </footer>
  </div>

  <!-- Game Mode Selection Modal (Phase 8) -->
  <div id="mode-modal" class="modal-backdrop">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title-group">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
            Oyun Modu & Harita Seçimi
          </h2>
          <p>İstediğin haritayı ve sürüş disiplinini seçip hemen başla (ESC ile aç/kapat)</p>
        </div>
        <button id="modal-close" class="modal-close-btn" type="button" title="Kapat (ESC)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div id="mode-grid-container" class="mode-grid">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>

  <!-- Master Menu & Multiplayer Lobby Modal (Phase 18) -->
  <div id="multiplayer-modal" class="modal-backdrop">
    <div class="modal-card master-menu-card">
      <div class="modal-header">
        <div class="modal-title-group">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            BrowserCar Menü & Çok Oyunculu Lobi
          </h2>
          <p>Oyun modunu seç veya çevrimiçi sunucuda arkadaşlarınla yarış/drift yap</p>
        </div>
        <button id="mp-modal-close" class="modal-close-btn" type="button" title="Kapat (ESC)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Master Navigation Tabs: PLAY (SOLO) vs GARAGE (CARS) vs PROFILE (DRIVER) vs ONLINE (MULTIPLAYER) -->
      <div class="mp-master-tabs">
        <button id="main-nav-play" class="mp-master-tab-btn" type="button">
          <span>🎮</span>
          <span>OYNA (MODLAR)</span>
        </button>
        <button id="main-nav-garage" class="mp-master-tab-btn" type="button">
          <span>🏎️</span>
          <span>GARAJ (ARAÇLAR)</span>
        </button>
        <button id="main-nav-profile" class="mp-master-tab-btn" type="button">
          <span>👤</span>
          <span>PROFİL (SÜRÜCÜ)</span>
        </button>
        <button id="main-nav-online" class="mp-master-tab-btn active" type="button">
          <span>🌐</span>
          <span>ONLINE (ÇOK OYUNCULU)</span>
        </button>
      </div>

      <!-- Solo Modes View -->
      <div id="mp-play-view" style="display: none;">
        <div style="font-size: 13px; color: #94a3b8; margin-bottom: 12px; font-weight: 600;">
          İstediğin oyun modunu seçip tek oyunculu antrenman ve meydan okumaya başla:
        </div>
        <div id="master-mode-grid" class="mode-grid">
          <!-- Rendered dynamically -->
        </div>
      </div>

      <!-- Garage / Vehicle Selection View (Phase 23) -->
      <div id="mp-garage-view" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
          <div style="font-size: 13px; color: #94a3b8; font-weight: 600;">
            Kullanmak istediğin aracı seç; her aracın hızı, ivmelenmesi, ağırlığı ve yol tutuşu farklıdır:
          </div>
          <span id="garage-active-badge" class="badge-pill" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700;">
            Aktif: Apex GT Sedan
          </span>
        </div>
        <div id="garage-car-grid" class="garage-car-grid">
          <!-- Rendered dynamically -->
        </div>
      </div>

      <!-- Player Profile View (Phase 24) -->
      <div id="mp-profile-view" style="display: none;">
        <div class="profile-view-container">
          <!-- Profile Header Card -->
          <div class="profile-card-glass profile-header-card">
            <div class="profile-avatar-box">
              <div class="profile-avatar-inner">🏎️</div>
            </div>
            <div class="profile-info-col">
              <div class="profile-name-row">
                <input id="profile-name-input" class="profile-display-name-input" type="text" maxlength="24" placeholder="Sürücü Adı" />
                <button id="btn-save-profile-name" class="btn-profile-save-name" type="button">Kaydet</button>
              </div>
              <div class="profile-meta-row">
                <span id="profile-id-badge" class="profile-id-pill">ID: usr_...</span>
                <span class="profile-tag-pill">Kalıcı Oturum</span>
                <span id="profile-member-since">Üyelik: Yeni</span>
              </div>
            </div>
          </div>

          <!-- Active Car Showcase Banner -->
          <div class="profile-car-banner">
            <div class="profile-car-info">
              <span class="profile-car-icon">🏎️</span>
              <div>
                <div style="font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase;">Aktif Sürüş Aracı</div>
                <div id="profile-active-car-name" style="font-size: 15px; font-weight: 800; color: #f8fafc;">Apex GT Sedan</div>
              </div>
            </div>
            <button id="btn-profile-go-garage" class="btn-select-car choose" style="width: auto; padding: 6px 14px; font-size: 11px;" type="button">
              Garajda Değiştir ➔
            </button>
          </div>

          <!-- Driver Statistics Grid -->
          <div class="profile-stats-grid-cols">
            <!-- Race Career -->
            <div class="profile-stat-category-card">
              <div class="profile-category-title">
                <span>🏁</span>
                <span>Yarış Kariyeri</span>
              </div>
              <div class="profile-stat-entry">
                <span class="profile-stat-entry-label">Katılınan Yarışlar</span>
                <span id="stat-total-races" class="profile-stat-entry-val">0</span>
              </div>
              <div class="profile-stat-entry">
                <span class="profile-stat-entry-label">Kazanılan Yarışlar</span>
                <span id="stat-races-won" class="profile-stat-entry-val" style="color: #fbbf24;">0 (%0)</span>
              </div>
              <div class="profile-stat-entry">
                <span class="profile-stat-entry-label">Tamamlanan Turlar</span>
                <span id="stat-total-laps" class="profile-stat-entry-val">0</span>
              </div>
              <div class="profile-stat-entry">
                <span class="profile-stat-entry-label">En Hızlı Tur Zamanı</span>
                <span id="stat-best-lap" class="profile-stat-entry-val" style="color: #38bdf8;">--:--.--</span>
              </div>
            </div>

            <!-- Drift Master -->
            <div class="profile-stat-category-card">
              <div class="profile-category-title">
                <span>⚡</span>
                <span>Drift Ustalığı</span>
              </div>
              <div class="profile-stat-entry">
                <span class="profile-stat-entry-label">En İyi Skor</span>
                <span id="stat-best-drift" class="profile-stat-entry-val" style="color: #facc15;">0 Puan</span>
              </div>
              <div class="profile-stat-entry">
                <span class="profile-stat-entry-label">Toplam Drift Puanı</span>
                <span id="stat-total-drift" class="profile-stat-entry-val">0 Puan</span>
              </div>
              <div class="profile-stat-entry">
                <span class="profile-stat-entry-label">Maksimum Kombo</span>
                <span id="stat-max-combo" class="profile-stat-entry-val" style="color: #f97316;">1.0x</span>
              </div>
            </div>

            <!-- Driving Mileage & Playtime -->
            <div class="profile-stat-category-card">
              <div class="profile-category-title">
                <span>🧭</span>
                <span>Sürüş İstatistikleri</span>
              </div>
              <div class="profile-stat-entry">
                <span class="profile-stat-entry-label">Kat Edilen Mesafe</span>
                <span id="stat-total-distance" class="profile-stat-entry-val">0.0 km</span>
              </div>
              <div class="profile-stat-entry">
                <span class="profile-stat-entry-label">Sürüş Süresi</span>
                <span id="stat-total-playtime" class="profile-stat-entry-val">0 dk 0 sn</span>
              </div>
              <div class="profile-stat-entry">
                <span class="profile-stat-entry-label">Oturum Durumu</span>
                <span class="profile-stat-entry-val" style="color: #34d399;">Aktif (Kalıcı Oturum)</span>
              </div>
            </div>
          </div>

          <!-- Footer Actions -->
          <div class="profile-footer-actions">
            <span style="font-size: 11px; color: #64748b;">
              * Profil ve istatistiklerin tarayıcında kalıcı olarak saklanır ve sunucuya otomatik iletilir.
            </span>
            <button id="btn-profile-reset" class="btn-profile-reset" type="button">
              Profili Sıfırla (Yeni Sürücü)
            </button>
          </div>
        </div>
      </div>

      <!-- Online Multiplayer View -->
      <div id="mp-online-view" style="display: flex; flex-direction: column; gap: 14px;">
        <!-- Network Status Banner -->
        <div class="mp-status-banner">
          <div class="mp-status-left">
            <span id="mp-status-dot" class="status-dot disconnected"></span>
            <div>
              <div id="mp-status-title" class="mp-status-title">Sunucuya Bağlanılıyor...</div>
              <div id="mp-status-sub" class="mp-status-sub">URL: http://localhost:3001</div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <div id="mp-player-id-badge" class="mp-id-badge" style="display: none;">
              <span>ID:</span>
              <span id="mp-player-id-text">--</span>
            </div>
            <div id="mp-ping-badge" class="mp-id-badge" style="display: none; color: #34d399; border-color: rgba(52, 211, 153, 0.3);">
              <span>⚡</span>
              <span id="mp-ping-text">-- ms</span>
            </div>
            <button id="btn-mp-reconnect" class="action-btn secondary" type="button" style="display: none; padding: 6px 12px; font-size: 11px;">Yeniden Bağlan</button>
          </div>
        </div>

        <!-- Player Name Row -->
        <div class="mp-name-bar">
          <span class="mp-name-label">Oyuncu Adı:</span>
          <input id="mp-name-input" class="mp-input" type="text" placeholder="Racer_1" maxlength="20" style="flex: 1;" />
        </div>

        <!-- Quick Matchmaking & Private Room Code Grid (Phase 18) -->
        <div class="mp-quick-match-grid">
          <div class="mp-quick-card">
            <div class="mp-quick-card-title">
              <span>⚡</span>
              <span>HIZLI EŞLEŞME (QUICK JOIN)</span>
            </div>
            <div class="mp-quick-row">
              <select id="mp-quick-mode" class="mp-select" style="flex: 1; padding: 7px 10px; font-size: 12px;">
                <option value="">Herhangi Bir Mod</option>
                <option value="CITY_FREE_ROAM">🏙️ Serbest Şehir</option>
                <option value="RACE">🏁 Yarış Pisti</option>
                <option value="DRIFT">🔥 Drift Arenası</option>
              </select>
              <button id="btn-quick-join" class="action-btn primary" type="button" style="padding: 7px 14px; font-size: 12px; white-space: nowrap;">
                ⚡ Hemen Oyna
              </button>
            </div>
          </div>
          <div class="mp-quick-card">
            <div class="mp-quick-card-title">
              <span>🔑</span>
              <span>ÖZEL ODA KODU (PRIVATE CODE)</span>
            </div>
            <div class="mp-quick-row">
              <input id="mp-room-code-input" class="mp-input mp-code-input" type="text" placeholder="A7X9" maxlength="6" style="flex: 1; padding: 7px 10px; font-size: 12px;" />
              <button id="btn-join-code" class="action-btn secondary" type="button" style="padding: 7px 14px; font-size: 12px; white-space: nowrap;">
                Koda Katıl
              </button>
            </div>
          </div>
        </div>

        <!-- Lobby Views (Switch between Rooms list and Active Room) -->
        <div id="mp-lobby-view" class="mp-content-section">
          <div class="mp-tabs">
            <button id="mp-tab-rooms" class="mp-tab-btn active" type="button">
              <span>Aktif Odalar</span>
              <span id="mp-rooms-count" class="mp-room-count-badge" style="margin-left: 4px;">0</span>
            </button>
            <button id="mp-tab-create" class="mp-tab-btn" type="button">+ Yeni Oda Kur</button>
          </div>

          <!-- Rooms List Tab -->
          <div id="mp-rooms-tab-content">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <span style="font-size: 12px; font-weight: 700; color: #94a3b8;">AÇIK VE KATILINABİLİR ODALAR</span>
              <button id="btn-refresh-rooms" class="reset-btn" type="button" style="padding: 4px 10px; font-size: 11px;">🔄 Yenile</button>
            </div>
            <div id="mp-room-list" class="mp-room-list">
              <!-- Injected dynamically -->
            </div>
          </div>

          <!-- Create Room Tab -->
          <div id="mp-create-tab-content" style="display: none;">
            <form id="mp-create-form" class="mp-create-form" onsubmit="return false;">
              <div class="mp-form-group full-width">
                <label class="mp-form-label" for="mp-room-name">Oda Adı</label>
                <input id="mp-room-name" class="mp-input" type="text" placeholder="Örn: Hızlı Yarış #1" value="Hızlı Yarış" maxlength="30" />
              </div>
              <div class="mp-form-group">
                <label class="mp-form-label" for="mp-room-mode">Oyun Modu</label>
                <select id="mp-room-mode" class="mp-select">
                  <option value="CITY_FREE_ROAM">🏙️ Serbest Şehir (City Free Roam)</option>
                  <option value="RACE">🏁 Yarış Pisti (Race Track)</option>
                  <option value="DRIFT">🔥 Drift Alanı (Drift Track)</option>
                </select>
              </div>
              <div class="mp-form-group">
                <label class="mp-form-label" for="mp-room-max">Maksimum Oyuncu</label>
                <select id="mp-room-max" class="mp-select">
                  <option value="4">4 Oyuncu</option>
                  <option value="8" selected>8 Oyuncu</option>
                  <option value="16">16 Oyuncu</option>
                </select>
              </div>
              <div class="mp-form-group full-width" style="margin-top: 4px;">
                <label class="mp-checkbox-label">
                  <input type="checkbox" id="mp-room-is-private" />
                  <span>🔒 Gizli Oda (Listede görünmez, sadece 4 haneli kod ile katılınabilir)</span>
                </label>
              </div>
              <div class="mp-form-group full-width" style="margin-top: 8px;">
                <button id="btn-submit-create-room" class="action-btn primary" type="button" style="width: 100%;">Odayı Başlat</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Active Room View (Shown when inside a room) -->
        <div id="mp-room-view" class="mp-active-room-card" style="display: none;">
          <div class="mp-active-room-header">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span id="mp-active-room-name" style="font-size: 16px; font-weight: 800; color: #f8fafc;">Oda Adı</span>
                <span id="mp-active-room-privacy-badge" class="mp-code-pill" style="display: none; background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">🔒 GİZLİ</span>
              </div>
              <div id="mp-active-room-sub" style="font-size: 12px; color: #38bdf8; font-weight: 600; margin-top: 2px;">Mod: Serbest Şehir</div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <div class="mp-room-code-display-wrap">
                <span style="font-size: 11px; color: #94a3b8; font-weight: 700;">ODA KODU:</span>
                <span id="mp-room-code-display" class="mp-code-pill" style="font-size: 13px; letter-spacing: 1px;">----</span>
                <button id="btn-copy-code" class="btn-copy-code" type="button" title="Kodu Kopyala">📋 Kopyala</button>
              </div>
              <button id="btn-leave-room" class="action-btn secondary" type="button" style="background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.4); color: #f87171; padding: 6px 14px; font-size: 12px;">Odadan Ayrıl</button>
            </div>
          </div>
          <div>
            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px;">ODADAKİ OYUNCULAR (<span id="mp-member-count">1</span>)</div>
            <div id="mp-member-list" class="mp-member-list">
              <!-- Members injected dynamically -->
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Race Starting Countdown Overlay (Phase 11) -->
  <div id="race-countdown-overlay" class="race-countdown-overlay" style="display: none;">
    <span id="race-countdown-text" class="race-countdown-text">3</span>
  </div>

  <!-- Race Wrong Way Warning (Phase 11) -->
  <div id="race-wrong-way" class="race-wrong-way" style="display: none;">
    ⚠️ TERS YÖN! GERİ DÖN ⚠️
  </div>

  <!-- Race Results Modal (Phase 11) -->
  <div id="race-results-modal" class="modal-backdrop">
    <div class="modal-card race-results-card">
      <div class="results-header">
        <span class="results-trophy" id="race-results-trophy">🏆</span>
        <h2 id="race-results-title">YARIŞ TAMAMLANDI!</h2>
        <p id="race-results-subtitle">Grand Prix 3 Tur Mücadelesi</p>
      </div>
      <div id="race-singleplayer-results" class="results-grid">
        <div class="result-stat-box">
          <span class="stat-label">TOPLAM SÜRE</span>
          <span class="stat-value" id="race-total-time">00:00.0</span>
        </div>
        <div class="result-stat-box highlight">
          <span class="stat-label">EN İYİ TUR</span>
          <span class="stat-value" id="race-best-lap">00:00.0</span>
        </div>
      </div>
      <div class="lap-times-list" id="race-lap-times-list">
        <!-- Injected dynamically -->
      </div>
      <!-- Multiplayer Podium Leaderboard Table (Phase 16) -->
      <div id="race-multiplayer-results-container" style="display: none; width: 100%;">
        <table class="online-race-results-table">
          <thead>
            <tr>
              <th style="width: 55px;">SIRA</th>
              <th>SÜRÜCÜ</th>
              <th>TOPLAM</th>
              <th>EN İYİ TUR</th>
            </tr>
          </thead>
          <tbody id="race-multiplayer-results-body">
            <!-- Dynamically injected rows -->
          </tbody>
        </table>
      </div>
      <div class="results-actions">
        <button id="btn-race-restart" class="action-btn primary" type="button">Tekrar Yarış (R)</button>
        <button id="btn-race-menu" class="action-btn secondary" type="button">Mod Değiştir (ESC)</button>
      </div>
    </div>
  </div>

  <!-- Drift Results Modal (Phase 17) -->
  <div id="drift-results-modal" class="modal-backdrop">
    <div class="modal-card race-results-card">
      <div class="results-header">
        <span class="results-trophy" id="drift-results-trophy">⚡</span>
        <h2 id="drift-results-title">DRIFT SEANSI TAMAMLANDI!</h2>
        <p id="drift-results-subtitle">Çevrimiçi Drift Arenası • 60 Saniye Sıralaması</p>
      </div>
      <div id="drift-multiplayer-results-container" style="width: 100%;">
        <table class="online-race-results-table">
          <thead>
            <tr>
              <th style="width: 55px;">SIRA</th>
              <th>SÜRÜCÜ</th>
              <th>TOPLAM SKOR</th>
              <th>EN İYİ DRIFT</th>
            </tr>
          </thead>
          <tbody id="drift-multiplayer-results-body">
            <!-- Dynamically injected rows -->
          </tbody>
        </table>
      </div>
      <div class="results-actions">
        <button id="btn-drift-restart" class="action-btn primary" type="button">Tekrar Oyna (R)</button>
        <button id="btn-drift-menu" class="action-btn secondary" type="button">Mod Değiştir (ESC)</button>
      </div>
    </div>
  </div>
`

// HUD Elements
const hudSpeed = document.querySelector<HTMLSpanElement>('#hud-speed')!
const hudGear = document.querySelector<HTMLSpanElement>('#hud-gear')!
const hudSpeedBar = document.querySelector<HTMLDivElement>('#hud-speed-bar')!
const keyW = document.querySelector<HTMLDivElement>('#key-w')!
const keyA = document.querySelector<HTMLDivElement>('#key-a')!
const keyS = document.querySelector<HTMLDivElement>('#key-s')!
const keyD = document.querySelector<HTMLDivElement>('#key-d')!
const btnReset = document.querySelector<HTMLButtonElement>('#btn-reset')!
const btnSpawn = document.querySelector<HTMLButtonElement>('#btn-spawn')!
const btnMenu = document.querySelector<HTMLButtonElement>('#btn-menu')!
const btnGarage = document.querySelector<HTMLButtonElement>('#btn-garage')!
const btnProfile = document.querySelector<HTMLButtonElement>('#btn-profile')!
const btnAudio = document.querySelector<HTMLButtonElement>('#btn-audio')!
const audioBtnIcon = document.querySelector<HTMLSpanElement>('#audio-btn-icon')!
const audioBtnText = document.querySelector<HTMLSpanElement>('#audio-btn-text')!
const spawnBtnText = document.querySelector<HTMLSpanElement>('#spawn-btn-text')!
const hudAssetStatus = document.querySelector<HTMLSpanElement>('#hud-asset-status')!
const hudFpsBadge = document.querySelector<HTMLDivElement>('#hud-fps-badge')!
const cityInfoCard = document.querySelector<HTMLDivElement>('#city-info-card')!
const citySpawnBadge = document.querySelector<HTMLSpanElement>('#city-spawn-badge')!
const cityOnlineCount = document.querySelector<HTMLSpanElement>('#city-online-count')!
const cityLocationName = document.querySelector<HTMLDivElement>('#city-location-name')!
const raceTelemetryCard = document.querySelector<HTMLDivElement>('#race-telemetry-card')!
const racePositionBadge = document.querySelector<HTMLSpanElement>('#race-position-badge')!
const raceLapBadge = document.querySelector<HTMLSpanElement>('#race-lap-badge')!
const raceLapTime = document.querySelector<HTMLSpanElement>('#race-lap-time')!
const raceBestTime = document.querySelector<HTMLSpanElement>('#race-best-time')!
const raceCheckpointStatus = document.querySelector<HTMLDivElement>('#race-checkpoint-status')!
const driftTelemetryCard = document.querySelector<HTMLDivElement>('#drift-telemetry-card')!
const driftScoreBadge = document.querySelector<HTMLSpanElement>('#drift-score-badge')!
const driftComboText = document.querySelector<HTMLSpanElement>('#drift-combo-text')!
const driftAngleText = document.querySelector<HTMLSpanElement>('#drift-angle-text')!
const driftTotalScore = document.querySelector<HTMLSpanElement>('#drift-total-score')!
const driftStatusText = document.querySelector<HTMLDivElement>('#drift-status-text')!
const modeModal = document.querySelector<HTMLDivElement>('#mode-modal')!
const modalClose = document.querySelector<HTMLButtonElement>('#modal-close')!
const modeGridContainer = document.querySelector<HTMLDivElement>('#mode-grid-container')!

// Race Flow HUD Elements (Phase 11)
const raceCountdownOverlay = document.querySelector<HTMLDivElement>('#race-countdown-overlay')!
const raceCountdownText = document.querySelector<HTMLSpanElement>('#race-countdown-text')!
const raceWrongWay = document.querySelector<HTMLDivElement>('#race-wrong-way')!
const raceResultsModal = document.querySelector<HTMLDivElement>('#race-results-modal')!
const raceResultsTrophy = document.querySelector<HTMLSpanElement>('#race-results-trophy')!
const raceResultsTitle = document.querySelector<HTMLHeadingElement>('#race-results-title')!
const raceResultsSubtitle = document.querySelector<HTMLParagraphElement>('#race-results-subtitle')!
const raceTotalTime = document.querySelector<HTMLSpanElement>('#race-total-time')!
const raceBestLap = document.querySelector<HTMLSpanElement>('#race-best-lap')!
const raceLapTimesList = document.querySelector<HTMLDivElement>('#race-lap-times-list')!
const btnRaceRestart = document.querySelector<HTMLButtonElement>('#btn-race-restart')!
const btnRaceMenu = document.querySelector<HTMLButtonElement>('#btn-race-menu')!
const raceSingleplayerResults = document.querySelector<HTMLDivElement>('#race-singleplayer-results')!
const raceMultiplayerResultsContainer = document.querySelector<HTMLDivElement>('#race-multiplayer-results-container')!
const raceMultiplayerResultsBody = document.querySelector<HTMLTableSectionElement>('#race-multiplayer-results-body')!

// Online Race HUD Overlay Elements (Phase 16)
const onlineRaceCard = document.querySelector<HTMLDivElement>('#online-race-card')!
const onlineRaceRoomName = document.querySelector<HTMLSpanElement>('#online-race-room-name')!
const onlineRaceStatusBadge = document.querySelector<HTMLSpanElement>('#online-race-status-badge')!
const onlineRaceGridBadge = document.querySelector<HTMLSpanElement>('#online-race-grid-badge')!
const onlineRacePlayersCount = document.querySelector<HTMLSpanElement>('#online-race-players-count')!
const btnRaceReady = document.querySelector<HTMLButtonElement>('#btn-race-ready')!
const btnRaceReadyIcon = document.querySelector<HTMLSpanElement>('#btn-race-ready-icon')!
const btnRaceReadyText = document.querySelector<HTMLSpanElement>('#btn-race-ready-text')!
const onlineRaceStandings = document.querySelector<HTMLDivElement>('#online-race-standings')!

// Online Drift HUD Overlay Elements (Phase 17)
const onlineDriftCard = document.querySelector<HTMLDivElement>('#online-drift-card')!
const onlineDriftRoomName = document.querySelector<HTMLSpanElement>('#online-drift-room-name')!
const onlineDriftStatusBadge = document.querySelector<HTMLSpanElement>('#online-drift-status-badge')!
const onlineDriftTimerBadge = document.querySelector<HTMLSpanElement>('#online-drift-timer-badge')!
const onlineDriftPlayersCount = document.querySelector<HTMLSpanElement>('#online-drift-players-count')!
const btnDriftReady = document.querySelector<HTMLButtonElement>('#btn-drift-ready')!
const btnDriftReadyIcon = document.querySelector<HTMLSpanElement>('#btn-drift-ready-icon')!
const btnDriftReadyText = document.querySelector<HTMLSpanElement>('#btn-drift-ready-text')!
const onlineDriftStandings = document.querySelector<HTMLDivElement>('#online-drift-standings')!

const driftResultsModal = document.querySelector<HTMLDivElement>('#drift-results-modal')!
const driftResultsTrophy = document.querySelector<HTMLSpanElement>('#drift-results-trophy')!
const driftResultsTitle = document.querySelector<HTMLHeadingElement>('#drift-results-title')!
const driftResultsSubtitle = document.querySelector<HTMLParagraphElement>('#drift-results-subtitle')!
const driftMultiplayerResultsBody = document.querySelector<HTMLTableSectionElement>('#drift-multiplayer-results-body')!
const btnDriftRestart = document.querySelector<HTMLButtonElement>('#btn-drift-restart')!
const btnDriftMenu = document.querySelector<HTMLButtonElement>('#btn-drift-menu')!

// Multiplayer HUD & Modal Elements (Phase 12)
const btnMultiplayer = document.querySelector<HTMLButtonElement>('#btn-multiplayer')!
const hudNetDot = document.querySelector<HTMLSpanElement>('#hud-net-dot')!
const hudNetText = document.querySelector<HTMLSpanElement>('#hud-net-text')!
const hudNetId = document.querySelector<HTMLSpanElement>('#hud-net-id')!
const mpModal = document.querySelector<HTMLDivElement>('#multiplayer-modal')!
const mpModalClose = document.querySelector<HTMLButtonElement>('#mp-modal-close')!
const mpStatusDot = document.querySelector<HTMLSpanElement>('#mp-status-dot')!
const mpStatusTitle = document.querySelector<HTMLDivElement>('#mp-status-title')!
const mpStatusSub = document.querySelector<HTMLDivElement>('#mp-status-sub')!
const mpPlayerIdBadge = document.querySelector<HTMLDivElement>('#mp-player-id-badge')!
const mpPlayerIdText = document.querySelector<HTMLSpanElement>('#mp-player-id-text')!
const btnMpReconnect = document.querySelector<HTMLButtonElement>('#btn-mp-reconnect')!
const mpNameInput = document.querySelector<HTMLInputElement>('#mp-name-input')!
const mpLobbyView = document.querySelector<HTMLDivElement>('#mp-lobby-view')!
const mpRoomView = document.querySelector<HTMLDivElement>('#mp-room-view')!
const mpTabRooms = document.querySelector<HTMLButtonElement>('#mp-tab-rooms')!
const mpTabCreate = document.querySelector<HTMLButtonElement>('#mp-tab-create')!
const mpRoomsTabContent = document.querySelector<HTMLDivElement>('#mp-rooms-tab-content')!
const mpCreateTabContent = document.querySelector<HTMLDivElement>('#mp-create-tab-content')!
const btnRefreshRooms = document.querySelector<HTMLButtonElement>('#btn-refresh-rooms')!
const mpRoomList = document.querySelector<HTMLDivElement>('#mp-room-list')!
const mpRoomName = document.querySelector<HTMLInputElement>('#mp-room-name')!
const mpRoomMode = document.querySelector<HTMLSelectElement>('#mp-room-mode')!
const mpRoomMax = document.querySelector<HTMLSelectElement>('#mp-room-max')!
const btnSubmitCreateRoom = document.querySelector<HTMLButtonElement>('#btn-submit-create-room')!
const mpActiveRoomName = document.querySelector<HTMLDivElement>('#mp-active-room-name')!
const mpActiveRoomSub = document.querySelector<HTMLDivElement>('#mp-active-room-sub')!
const btnLeaveRoom = document.querySelector<HTMLButtonElement>('#btn-leave-room')!
const mpMemberCount = document.querySelector<HTMLSpanElement>('#mp-member-count')!
const mpMemberList = document.querySelector<HTMLDivElement>('#mp-member-list')!

// Phase 18, 23 & 24 Lobby & Navigation Elements
const mainNavPlay = document.querySelector<HTMLButtonElement>('#main-nav-play')!
const mainNavGarage = document.querySelector<HTMLButtonElement>('#main-nav-garage')!
const mainNavProfile = document.querySelector<HTMLButtonElement>('#main-nav-profile')!
const mainNavOnline = document.querySelector<HTMLButtonElement>('#main-nav-online')!
const mpPlayView = document.querySelector<HTMLDivElement>('#mp-play-view')!
const mpGarageView = document.querySelector<HTMLDivElement>('#mp-garage-view')!
const garageActiveBadge = document.querySelector<HTMLSpanElement>('#garage-active-badge')!
const garageCarGrid = document.querySelector<HTMLDivElement>('#garage-car-grid')!
const mpProfileView = document.querySelector<HTMLDivElement>('#mp-profile-view')!
const profileNameInput = document.querySelector<HTMLInputElement>('#profile-name-input')!
const btnSaveProfileName = document.querySelector<HTMLButtonElement>('#btn-save-profile-name')!
const profileIdBadge = document.querySelector<HTMLSpanElement>('#profile-id-badge')!
const profileMemberSince = document.querySelector<HTMLSpanElement>('#profile-member-since')!
const profileActiveCarName = document.querySelector<HTMLDivElement>('#profile-active-car-name')!
const btnProfileGoGarage = document.querySelector<HTMLButtonElement>('#btn-profile-go-garage')!
const statTotalRaces = document.querySelector<HTMLSpanElement>('#stat-total-races')!
const statRacesWon = document.querySelector<HTMLSpanElement>('#stat-races-won')!
const statTotalLaps = document.querySelector<HTMLSpanElement>('#stat-total-laps')!
const statBestLap = document.querySelector<HTMLSpanElement>('#stat-best-lap')!
const statBestDrift = document.querySelector<HTMLSpanElement>('#stat-best-drift')!
const statTotalDrift = document.querySelector<HTMLSpanElement>('#stat-total-drift')!
const statMaxCombo = document.querySelector<HTMLSpanElement>('#stat-max-combo')!
const statTotalDistance = document.querySelector<HTMLSpanElement>('#stat-total-distance')!
const statTotalPlaytime = document.querySelector<HTMLSpanElement>('#stat-total-playtime')!
const btnProfileReset = document.querySelector<HTMLButtonElement>('#btn-profile-reset')!
const masterModeGrid = document.querySelector<HTMLDivElement>('#master-mode-grid')!
const mpOnlineView = document.querySelector<HTMLDivElement>('#mp-online-view')!
const mpPingBadge = document.querySelector<HTMLDivElement>('#mp-ping-badge')!
const mpPingText = document.querySelector<HTMLSpanElement>('#mp-ping-text')!
const mpQuickMode = document.querySelector<HTMLSelectElement>('#mp-quick-mode')!
const btnQuickJoin = document.querySelector<HTMLButtonElement>('#btn-quick-join')!
const mpRoomCodeInput = document.querySelector<HTMLInputElement>('#mp-room-code-input')!
const btnJoinCode = document.querySelector<HTMLButtonElement>('#btn-join-code')!
const mpRoomsCount = document.querySelector<HTMLSpanElement>('#mp-rooms-count')!
const mpRoomIsPrivate = document.querySelector<HTMLInputElement>('#mp-room-is-private')!
const mpActiveRoomPrivacyBadge = document.querySelector<HTMLSpanElement>('#mp-active-room-privacy-badge')!
const mpRoomCodeDisplay = document.querySelector<HTMLSpanElement>('#mp-room-code-display')!
const btnCopyCode = document.querySelector<HTMLButtonElement>('#btn-copy-code')!

// Online City Player List Overlay Elements (Phase 15)
const cityPlayerListCard = document.querySelector<HTMLDivElement>('#city-player-list-card')!
const playerListHeader = document.querySelector<HTMLDivElement>('#player-list-header')!
const playerListRoomTitle = document.querySelector<HTMLSpanElement>('#player-list-room-title')!
const playerListCountBadge = document.querySelector<HTMLSpanElement>('#player-list-count-badge')!
const playerListItems = document.querySelector<HTMLDivElement>('#player-list-items')!
const playerListPing = document.querySelector<HTMLSpanElement>('#player-list-ping')!

// Vehicle Reset & Respawn Alerts (Phase 19)
const hudResetToast = document.querySelector<HTMLDivElement>('#hud-reset-toast')!
const hudResetIcon = document.querySelector<HTMLSpanElement>('#hud-reset-icon')!
const hudResetText = document.querySelector<HTMLSpanElement>('#hud-reset-text')!
const hudActionHint = document.querySelector<HTMLDivElement>('#hud-action-hint')!
const hudActionHintText = document.querySelector<HTMLSpanElement>('#hud-action-hint-text')!
const resetScreenFlash = document.querySelector<HTMLDivElement>('#reset-screen-flash')!

let toastTimeout: number | null = null
const showResetToast = (message: string, type: 'info' | 'warning' | 'alert' = 'info', durationMs: number = 2200) => {
  if (toastTimeout !== null) {
    window.clearTimeout(toastTimeout)
    toastTimeout = null
  }
  hudResetToast.className = `show ${type}`
  hudResetText.textContent = message
  hudResetIcon.textContent = type === 'alert' ? '🚨' : type === 'warning' ? '⚠️' : '🔄'

  toastTimeout = window.setTimeout(() => {
    hudResetToast.classList.remove('show')
    toastTimeout = null
  }, durationMs)
}

const setActionHint = (hint: string | null) => {
  if (hint) {
    hudActionHintText.textContent = hint
    hudActionHint.classList.add('active')
  } else {
    hudActionHint.classList.remove('active')
  }
}

const triggerScreenFlash = () => {
  if (!resetScreenFlash) return
  resetScreenFlash.classList.add('flash')
  setTimeout(() => {
    resetScreenFlash.classList.remove('flash')
  }, 280)
}

// --- 2. THREE.JS SCENE SETUP ---
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x93c5fd)
scene.fog = new THREE.Fog(0x93c5fd, 60, 260)

// --- 3. CAMERA SETUP ---
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)

// --- 4. RENDERER & PERFORMANCE OPTIMIZATIONS ---
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1

const container = document.querySelector<HTMLDivElement>('#canvas-container')!
container.appendChild(renderer.domElement)

// --- 5. LIGHTING SETUP ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.85)
scene.add(ambientLight)

const hemisphereLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.6)
scene.add(hemisphereLight)

const sunLight = new THREE.DirectionalLight(0xfffef5, 2.3)
sunLight.position.set(40, 60, 30)
sunLight.castShadow = true
sunLight.shadow.mapSize.width = 1024
sunLight.shadow.mapSize.height = 1024
sunLight.shadow.camera.near = 1.0
sunLight.shadow.camera.far = 160
sunLight.shadow.camera.left = -30
sunLight.shadow.camera.right = 30
sunLight.shadow.camera.top = 30
sunLight.shadow.camera.bottom = -30
sunLight.shadow.bias = -0.0006
scene.add(sunLight)
scene.add(sunLight.target)

// --- 6. INITIALIZE RAPIER 3D, CITY MAP & RACING TRACK ---
async function bootstrap() {
  const physicsWorld = new PhysicsWorld()
  await physicsWorld.init()

  // 1. Build City World (Centered at Z = 0)
  const city = new CityWorld(scene, physicsWorld, () => {
    console.log('✓ City environment ready')
  })

  // 2. Build Closed Racing Circuit (Centered at Z = 600)
  const raceTrack = new RaceTrack(scene, physicsWorld)

  // 3. Build Dedicated Drift Arena & Slalom Playground (Centered at Z = -600, Phase 10)
  const driftTrack = new DriftTrack(scene, physicsWorld)

  // 4. Build Physics Vehicle & Player Profile (Phase 23 & 24)
  const playerProfileManager = PlayerProfileManager.getInstance()
  const initialVehicleId = getSelectedVehicleId()
  const vehicle = new Vehicle(
    scene,
    physicsWorld,
    undefined,
    () => {
      hudAssetStatus.textContent = 'Harita Hazır • 60 FPS'
      hudAssetStatus.style.color = '#34d399'
    },
    initialVehicleId
  )

  // 5. Build Particle & Visual Effect Systems (Phase 9)
  const tireSmoke = new TireSmokeSystem(scene)

  // Helper to format seconds as mm:ss.d
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 10)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`
  }

  // 6. Initialize HUD Controller for Modes
  const modeHud: ModeHUDController = {
    setSubtitle(text: string, color = '#94a3b8') {
      hudAssetStatus.textContent = text
      hudAssetStatus.style.color = color
    },
    setTelemetryVisible(visible: boolean) {
      raceTelemetryCard.style.display = visible ? 'block' : 'none'
    },
    setSpawnButtonVisible(visible: boolean) {
      btnSpawn.style.display = visible ? 'flex' : 'none'
    },
    setSpawnText(text: string) {
      spawnBtnText.textContent = text
    },
    setDriftCardVisible(visible: boolean) {
      driftTelemetryCard.style.display = visible ? 'block' : 'none'
    },
    setCityCardVisible(visible: boolean) {
      cityInfoCard.style.display = visible ? 'block' : 'none'
    },
    updateCityHUD(onlineCount: number, locationName: string, spawnIndexText: string) {
      cityOnlineCount.textContent = `${onlineCount} Çevrimiçi`
      cityLocationName.textContent = locationName
      citySpawnBadge.textContent = spawnIndexText
    },
    updateRaceTelemetry(lapText: string, timeText: string, bestText: string, checkpointText: string, positionText?: string) {
      raceLapBadge.textContent = lapText
      raceLapTime.textContent = timeText
      raceBestTime.textContent = bestText
      raceCheckpointStatus.textContent = checkpointText
      if (racePositionBadge && positionText) {
        racePositionBadge.textContent = positionText
        if (positionText.startsWith('P1') || positionText === '1/1') {
          racePositionBadge.className = 'race-position-badge p1'
        } else if (positionText.startsWith('P2')) {
          racePositionBadge.className = 'race-position-badge p2'
        } else if (positionText.startsWith('P3')) {
          racePositionBadge.className = 'race-position-badge p3'
        } else {
          racePositionBadge.className = 'race-position-badge'
        }
      }
    },
    setRaceCountdown(text: string | null, color?: string | null) {
      if (text) {
        raceCountdownOverlay.style.display = 'flex'
        raceCountdownText.textContent = text
        if (color) raceCountdownText.style.color = color
      } else {
        raceCountdownOverlay.style.display = 'none'
      }
    },
    setWrongWayVisible(visible: boolean) {
      raceWrongWay.style.display = visible ? 'block' : 'none'
    },
    showRaceResults(result: RaceResult) {
      raceSingleplayerResults.style.display = 'grid'
      raceLapTimesList.style.display = 'flex'
      raceMultiplayerResultsContainer.style.display = 'none'

      raceResultsTrophy.textContent = result.ratingIcon
      raceResultsTitle.textContent = `${result.rating}!`
      raceResultsSubtitle.textContent = `Grand Prix 3 Tur • Toplam: ${formatTime(result.totalTime)}`
      raceTotalTime.textContent = formatTime(result.totalTime)
      raceBestLap.textContent = formatTime(result.bestLapTime)

      raceLapTimesList.innerHTML = result.lapTimes
        .map(
          (t, i) => `
          <div class="lap-time-row ${t === result.bestLapTime ? 'fastest-lap' : ''}">
            <span class="lap-name">TUR ${i + 1} ${t === result.bestLapTime ? '★ EN HIZLI' : ''}</span>
            <span class="lap-val">${formatTime(t)}</span>
          </div>
        `
        )
        .join('')

      playerProfileManager.recordRaceResult(result.bestLapTime, result.lapTimes.length, true)
      raceResultsModal.classList.add('open')
    },
    showMultiplayerRaceResults(results: RaceParticipantResult[]) {
      raceSingleplayerResults.style.display = 'none'
      raceLapTimesList.style.display = 'none'
      raceMultiplayerResultsContainer.style.display = 'block'

      const myId = networkManager.getPlayerId()
      const myResult = results.find((r) => r.playerId === myId)
      const myRank = myResult ? myResult.rank : 1

      const trophy = myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : '🏁'
      const title = myRank === 1 ? '1. OLDUN! TEBRİKLER 🏆' : `${myRank}. SIRA TAMAMLANDI!`

      raceResultsTrophy.textContent = trophy
      raceResultsTitle.textContent = title
      raceResultsSubtitle.textContent = `Grand Prix Çevrimiçi Yarışı • ${results.length} Pilot Mücadelesi`

      const isWin = myRank === 1
      const completedLaps = myResult && !myResult.dnf ? 3 : 0
      playerProfileManager.recordRaceResult(myResult?.bestLapTime ?? null, completedLaps, isWin)

      raceMultiplayerResultsBody.innerHTML = results
        .map((r) => {
          const isMe = r.playerId === myId
          const rankIcon = r.rank === 1 ? '🥇 1.' : r.rank === 2 ? '🥈 2.' : r.rank === 3 ? '🥉 3.' : `${r.rank}.`
          const carColor = r.color ? `#${r.color.toString(16).padStart(6, '0')}` : getPlayerColorHex(r.playerId)
          const totalStr = r.dnf ? '<span style="color: #ef4444; font-weight: 700;">DNF</span>' : formatTime(r.totalTime)
          const bestStr = r.bestLapTime !== null ? formatTime(r.bestLapTime) : '--:--.--'

          return `
          <tr class="${isMe ? 'is-me' : ''}">
            <td style="font-weight: 800; color: #fbbf24;">${rankIcon}</td>
            <td>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${carColor};"></span>
                <span style="font-weight: 700;">${r.playerName}</span>
                ${isMe ? '<span class="mp-you-badge" style="font-size: 9px; padding: 1px 4px;">SEN</span>' : ''}
              </div>
            </td>
            <td style="font-weight: 700;">${totalStr}</td>
            <td style="color: #38bdf8;">${bestStr}</td>
          </tr>
        `
        })
        .join('')

      raceResultsModal.classList.add('open')
    },
    hideRaceResults() {
      raceResultsModal.classList.remove('open')
    },
    setDriftCountdown(text: string | null, color?: string | null) {
      if (text) {
        raceCountdownOverlay.style.display = 'flex'
        raceCountdownText.textContent = text
        if (color) raceCountdownText.style.color = color
      } else {
        raceCountdownOverlay.style.display = 'none'
      }
    },
    updateDriftLeaderboard(leaderboard: DriftParticipantProgress[], remainingSeconds: number, driftState: OnlineDriftState) {
      onlineDriftTimerBadge.textContent = `⏱️ ${remainingSeconds}s`
      if (driftState === OnlineDriftState.ACTIVE) {
        onlineDriftStatusBadge.className = 'online-race-badge online-drift-badge active'
        onlineDriftStatusBadge.textContent = 'CANLI SEANS'
      }

      const myId = networkManager.getPlayerId() || ''
      const rowsHtml = leaderboard
        .map((p) => {
          const isMe = p.playerId === myId
          const pColor = p.color ? `#${p.color.toString(16).padStart(6, '0')}` : getPlayerColorHex(p.playerId)
          const isDriftingPill = p.isDrifting ? '<span class="online-drift-combo-pill">🔥 YANLIYOR</span>' : ''

          return `
            <div class="online-race-standings-row ${isMe ? 'is-me' : ''}">
              <div class="online-race-row-left">
                <span class="online-race-rank">#${p.rank}</span>
                <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${pColor};"></span>
                <span class="online-race-driver-name">${p.playerName}</span>
                ${isMe ? '<span class="mp-you-badge" style="font-size: 9px; padding: 1px 4px;">SEN</span>' : ''}
                ${isDriftingPill}
              </div>
              <div class="online-race-row-right">
                <span class="online-drift-score-pill">${p.totalScore.toLocaleString()}</span>
              </div>
            </div>
          `
        })
        .join('')

      onlineDriftStandings.innerHTML = rowsHtml
    },
    showMultiplayerDriftResults(leaderboard: DriftParticipantProgress[], winner: DriftParticipantProgress | null) {
      const myId = networkManager.getPlayerId()
      const myResult = leaderboard.find((p) => p.playerId === myId)
      const myRank = myResult ? myResult.rank : 1

      const trophy = myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : '⚡'
      const title = myRank === 1 ? 'DRIFT KRALI OLDUN! 👑' : `${myRank}. SIRA TAMAMLANDI!`

      driftResultsTrophy.textContent = trophy
      driftResultsTitle.textContent = title
      driftResultsSubtitle.textContent = winner
        ? `Kazanan: ${winner.playerName} (${winner.totalScore.toLocaleString()} Puan) • ${leaderboard.length} Pilot Yarıştı`
        : `Çevrimiçi Drift Arenası • ${leaderboard.length} Pilot Mücadelesi`

      driftMultiplayerResultsBody.innerHTML = leaderboard
        .map((p) => {
          const isMe = p.playerId === myId
          const rankIcon = p.rank === 1 ? '🥇 1.' : p.rank === 2 ? '🥈 2.' : p.rank === 3 ? '🥉 3.' : `${p.rank}.`
          const carColor = p.color ? `#${p.color.toString(16).padStart(6, '0')}` : getPlayerColorHex(p.playerId)

          return `
            <tr class="${isMe ? 'is-me' : ''}">
              <td style="font-weight: 800; color: #fbbf24;">${rankIcon}</td>
              <td>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${carColor};"></span>
                  <span style="font-weight: 700;">${p.playerName}</span>
                  ${isMe ? '<span class="mp-you-badge" style="font-size: 9px; padding: 1px 4px;">SEN</span>' : ''}
                </div>
              </td>
              <td style="font-weight: 800; color: #fde047;">${p.totalScore.toLocaleString()} Puan</td>
              <td style="color: #38bdf8;">${p.bestDriftScore.toLocaleString()}</td>
            </tr>
          `
        })
        .join('')

      if (myResult) {
        playerProfileManager.recordDriftResult(myResult.totalScore, 1.0)
      }
      driftResultsModal.classList.add('open')
    },
    hideDriftResults() {
      driftResultsModal.classList.remove('open')
    },
    updateDriftTelemetry(
      scoreText: string,
      comboText: string,
      statusText: string,
      angleText?: string,
      totalText?: string,
      isDrifting?: boolean
    ) {
      driftScoreBadge.textContent = scoreText
      driftComboText.textContent = comboText
      driftStatusText.textContent = statusText
      if (angleText) driftAngleText.textContent = angleText
      if (totalText) driftTotalScore.textContent = totalText

      if (comboText) {
        const comboMatch = comboText.match(/([\d.]+)x/)
        if (comboMatch) {
          const comboVal = parseFloat(comboMatch[1])
          if (!isNaN(comboVal) && comboVal > 1.0) {
            playerProfileManager.recordDriftResult(0, comboVal)
          }
        }
      }

      if (isDrifting) {
        driftTelemetryCard.classList.add('drifting-active')
      } else {
        driftTelemetryCard.classList.remove('drifting-active')
      }
    },
  }

  // 7. Initialize Multiplayer Network Manager
  const networkManager = new NetworkManager()
  const remotePlayerManager = new RemotePlayerManager(scene, networkManager)

  // 7b. Initialize Driving Audio Manager (Phase 22)
  const audioManager = new AudioManager()

  const toggleMute = () => {
    const isMuted = audioManager.toggleMute()
    if (audioBtnIcon) audioBtnIcon.textContent = isMuted ? '🔇' : '🔊'
    if (audioBtnText) audioBtnText.textContent = isMuted ? 'Sessiz' : 'Ses'
    btnAudio.classList.toggle('muted', isMuted)
    showResetToast(isMuted ? 'Ses Kapatıldı' : 'Ses Açıldı', 'info', 1100)
  }

  if (audioManager.getIsMuted()) {
    if (audioBtnIcon) audioBtnIcon.textContent = '🔇'
    if (audioBtnText) audioBtnText.textContent = 'Sessiz'
    btnAudio.classList.add('muted')
  }

  btnAudio.addEventListener('click', () => {
    audioManager.playClick()
    toggleMute()
  })

  // 8. Initialize Mode Manager (Default: City Free Roam)
  const modeManager = new ModeManager({
    scene,
    physicsWorld,
    vehicle,
    cityWorld: city,
    raceTrack,
    driftTrack,
    hud: modeHud,
    tireSmoke,
    networkManager,
    audio: audioManager,
  })

  // 8b. Initialize Polished Follow Camera System (Phase 20)
  const followCamera = new FollowCamera(camera, vehicle)

  // 8c. Initialize Vehicle Reset & Respawn System (Phase 19)
  const vehicleResetSystem = new VehicleResetSystem({
    vehicle,
    modeManager,
    networkManager,
    tireSmoke,
    onNotice: (msg, type, duration) => {
      showResetToast(msg, type, duration)
      triggerScreenFlash()
    },
    onHint: (hint) => {
      setActionHint(hint)
    },
    onRespawn: (reason) => {
      followCamera.snap()
      audioManager.playRespawn()
      if (reason === 'flipped' || reason === 'fall') {
        audioManager.playCollision(0.85)
        followCamera.addTrauma(0.55)
      } else if (reason === 'stuck') {
        followCamera.addTrauma(0.3)
      }
    },
  })

  // 6. Mode Selection Modal Management & Master Front-End Flow (Phase 18, 23 & 24)
  let isModalOpen = false
  let isMpModalOpen = false
  let activeMasterTab: 'play' | 'garage' | 'profile' | 'online' = 'online'

  const renderProfileView = () => {
    const profile = playerProfileManager.getProfile()
    const activeDef = vehicle.getActiveDefinition()

    if (profileNameInput) profileNameInput.value = profile.displayName
    if (profileIdBadge) profileIdBadge.textContent = `ID: ${profile.id}`
    if (profileMemberSince) {
      profileMemberSince.textContent = `Üyelik: ${new Date(profile.createdAt).toLocaleDateString('tr-TR')}`
    }
    if (profileActiveCarName) {
      profileActiveCarName.textContent = `${activeDef.name} (${activeDef.badge})`
    }

    if (statTotalRaces) statTotalRaces.textContent = profile.stats.totalRaces.toString()
    if (statRacesWon) {
      const winPct = profile.stats.totalRaces > 0 ? Math.round((profile.stats.racesWon / profile.stats.totalRaces) * 100) : 0
      statRacesWon.textContent = `${profile.stats.racesWon} (%${winPct})`
    }
    if (statTotalLaps) statTotalLaps.textContent = profile.stats.totalLaps.toString()
    if (statBestLap) {
      statBestLap.textContent = profile.stats.bestLapTime !== null ? formatTime(profile.stats.bestLapTime) : '--:--.--'
    }

    if (statBestDrift) statBestDrift.textContent = `${profile.stats.bestDriftScore.toLocaleString()} Puan`
    if (statTotalDrift) statTotalDrift.textContent = `${profile.stats.totalDriftPoints.toLocaleString()} Puan`
    if (statMaxCombo) statMaxCombo.textContent = `${profile.stats.maxDriftCombo.toFixed(1)}x`

    if (statTotalDistance) {
      const distKm = profile.stats.totalDistanceMeters / 1000
      statTotalDistance.textContent = distKm >= 1.0 ? `${distKm.toFixed(1)} km` : `${profile.stats.totalDistanceMeters} m`
    }
    if (statTotalPlaytime) {
      const mins = Math.floor(profile.stats.totalPlaytimeSeconds / 60)
      const secs = profile.stats.totalPlaytimeSeconds % 60
      statTotalPlaytime.textContent = `${mins} dk ${secs} sn`
    }
  }

  const renderGarageCars = () => {
    const currentDef = vehicle.getActiveDefinition()
    const currentId = currentDef.id
    if (garageActiveBadge) {
      garageActiveBadge.textContent = `Aktif: ${currentDef.name}`
    }

    if (!garageCarGrid) return

    const categoryColors: Record<string, { bg: string; color: string; border: string }> = {
      SPORTS: { bg: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: 'rgba(56, 189, 248, 0.4)' },
      RACE: { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: 'rgba(239, 68, 68, 0.4)' },
      DRIFT: { bg: 'rgba(234, 179, 8, 0.15)', color: '#facc15', border: 'rgba(234, 179, 8, 0.4)' },
      PROTOTYPE: { bg: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: 'rgba(168, 85, 247, 0.4)' },
      POLICE: { bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: 'rgba(59, 130, 246, 0.4)' },
      SUV: { bg: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', border: 'rgba(34, 197, 94, 0.4)' },
    }

    const html = VEHICLE_CATALOG.map((car) => {
      const isSelected = car.id === currentId
      const catStyle = categoryColors[car.category] || { bg: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8', border: 'rgba(148, 163, 184, 0.4)' }

      const speedPct = Math.min(100, Math.round((car.stats.topSpeedKmh / 175) * 100))
      const accelPct = Math.min(100, Math.round((car.stats.acceleration / 10) * 100))
      const handlingPct = Math.min(100, Math.round((car.stats.handling / 10) * 100))
      const driftPct = Math.min(100, Math.round((car.stats.driftMultiplier / 1.5) * 100))
      const massPct = Math.min(100, Math.round((car.stats.massKg / 2200) * 100))

      return `
        <div class="garage-car-card ${isSelected ? 'active' : ''}" data-car-id="${car.id}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <div>
              <div style="font-weight: 800; font-size: 15px; color: #f8fafc; letter-spacing: -0.01em;">${car.name}</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">${car.description}</div>
            </div>
            <span class="garage-card-badge" style="background: ${catStyle.bg}; color: ${catStyle.color}; border: 1px solid ${catStyle.border};">
              ${car.badge}
            </span>
          </div>

          <div class="garage-stats-grid">
            <div class="garage-stat-row">
              <span class="garage-stat-label">Maks Hız</span>
              <div class="garage-stat-bar"><div class="garage-stat-fill" style="width: ${speedPct}%; background: linear-gradient(90deg, #38bdf8, #818cf8);"></div></div>
              <span class="garage-stat-val">${car.stats.topSpeedKmh} km/h</span>
            </div>
            <div class="garage-stat-row">
              <span class="garage-stat-label">İvmelenme</span>
              <div class="garage-stat-bar"><div class="garage-stat-fill" style="width: ${accelPct}%; background: linear-gradient(90deg, #34d399, #10b981);"></div></div>
              <span class="garage-stat-val">${car.stats.acceleration}/10</span>
            </div>
            <div class="garage-stat-row">
              <span class="garage-stat-label">Yol Tutuş</span>
              <div class="garage-stat-bar"><div class="garage-stat-fill" style="width: ${handlingPct}%; background: linear-gradient(90deg, #38bdf8, #0ea5e9);"></div></div>
              <span class="garage-stat-val">${car.stats.handling}/10</span>
            </div>
            <div class="garage-stat-row">
              <span class="garage-stat-label">Drift Çarpanı</span>
              <div class="garage-stat-bar"><div class="garage-stat-fill" style="width: ${driftPct}%; background: linear-gradient(90deg, #f59e0b, #ef4444);"></div></div>
              <span class="garage-stat-val">${car.stats.driftMultiplier}x</span>
            </div>
            <div class="garage-stat-row">
              <span class="garage-stat-label">Kütle</span>
              <div class="garage-stat-bar"><div class="garage-stat-fill" style="width: ${massPct}%; background: #64748b;"></div></div>
              <span class="garage-stat-val">${car.stats.massKg} kg</span>
            </div>
          </div>

          <button class="btn-select-car ${isSelected ? 'active' : ''}" data-car-id="${car.id}" type="button">
            ${isSelected ? '✓ SEÇİLDİ (AKTİF)' : 'BU ARACI KULLAN'}
          </button>
        </div>
      `
    }).join('')

    garageCarGrid.innerHTML = html

    const selectVehicle = (carId: string) => {
      if (carId === currentId) return
      const def = getVehicleDefinition(carId)
      if (def) {
        audioManager.playClick()
        setSelectedVehicleId(def.id)
        playerProfileManager.setSelectedCar(def.id)
        vehicle.setDefinition(def, () => {
          showResetToast(`🏎️ Araç Değiştirildi: ${def.name}`, 'info', 2200)
        })
        renderGarageCars()
      }
    }

    garageCarGrid.querySelectorAll<HTMLButtonElement>('.btn-select-car').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const carId = btn.dataset.carId
        if (carId) selectVehicle(carId)
      })
    })

    garageCarGrid.querySelectorAll<HTMLDivElement>('.garage-car-card').forEach((card) => {
      card.addEventListener('click', () => {
        const carId = card.dataset.carId
        if (carId) selectVehicle(carId)
      })
    })
  }

  const renderModeCards = () => {
    const active = modeManager.getActiveMode()
    const html = modeManager
      .getAllModes()
      .map(
        (m) => `
        <div class="mode-card-item ${m.modeType === active.modeType ? 'active' : ''}" data-mode="${m.modeType}">
          <div class="mode-icon-badge">
            <span class="mode-icon">${m.icon}</span>
            <span class="mode-badge" style="background: ${m.badgeColor}">${m.mapType}</span>
          </div>
          <div class="mode-info">
            <h3>${m.title}</h3>
            <div class="mode-subtitle">${m.subtitle}</div>
            <div class="mode-desc">${m.description}</div>
          </div>
          <div class="mode-action-btn">
            ${m.modeType === active.modeType ? 'Aktif Mod' : 'Bu Modu Seç'}
          </div>
        </div>
      `
      )
      .join('')

    if (modeGridContainer) modeGridContainer.innerHTML = html
    if (masterModeGrid) masterModeGrid.innerHTML = html

    const onCardClick = (card: HTMLElement) => {
      const modeType = card.dataset.mode as GameModeType
      if (modeType) {
        modeManager.setMode(modeType)
        followCamera.snap()
        if (modeType === GameModeType.DRIFT) {
          followCamera.setPreset('DRIFT')
        } else {
          followCamera.setPreset('NORMAL')
        }
        renderModeCards()
        closeMasterModal()
      }
    }

    modeGridContainer?.querySelectorAll<HTMLDivElement>('.mode-card-item').forEach((card) => {
      card.addEventListener('click', () => onCardClick(card))
    })
    masterModeGrid?.querySelectorAll<HTMLDivElement>('.mode-card-item').forEach((card) => {
      card.addEventListener('click', () => onCardClick(card))
    })
  }

  const switchMasterTab = (tab: 'play' | 'garage' | 'profile' | 'online') => {
    activeMasterTab = tab
    mainNavPlay.classList.toggle('active', tab === 'play')
    mainNavGarage.classList.toggle('active', tab === 'garage')
    mainNavProfile.classList.toggle('active', tab === 'profile')
    mainNavOnline.classList.toggle('active', tab === 'online')

    mpPlayView.style.display = tab === 'play' ? 'block' : 'none'
    mpGarageView.style.display = tab === 'garage' ? 'block' : 'none'
    mpProfileView.style.display = tab === 'profile' ? 'block' : 'none'
    mpOnlineView.style.display = tab === 'online' ? 'flex' : 'none'

    if (tab === 'play') {
      renderModeCards()
    } else if (tab === 'garage') {
      renderGarageCars()
    } else if (tab === 'profile') {
      renderProfileView()
    } else if (tab === 'online') {
      networkManager.refreshRooms()
    }
  }

  mainNavPlay.addEventListener('click', () => {
    audioManager.playClick()
    switchMasterTab('play')
  })
  mainNavGarage.addEventListener('click', () => {
    audioManager.playClick()
    switchMasterTab('garage')
  })
  mainNavProfile.addEventListener('click', () => {
    audioManager.playClick()
    switchMasterTab('profile')
  })
  mainNavOnline.addEventListener('click', () => {
    audioManager.playClick()
    switchMasterTab('online')
  })

  const openMasterModal = (tab: 'play' | 'garage' | 'profile' | 'online' = 'online') => {
    isMpModalOpen = true
    isModalOpen = true
    mpModal.classList.add('open')
    switchMasterTab(tab)
  }

  const closeMasterModal = () => {
    isMpModalOpen = false
    isModalOpen = false
    mpModal.classList.remove('open')
    modeModal.classList.remove('open')
  }

  const openModal = () => openMasterModal('play')
  const closeModal = () => closeMasterModal()
  const toggleModal = () => {
    if (isMpModalOpen && activeMasterTab === 'play') closeMasterModal()
    else openMasterModal('play')
  }

  const toggleGarageModal = () => {
    if (isMpModalOpen && activeMasterTab === 'garage') closeMasterModal()
    else openMasterModal('garage')
  }

  const toggleProfileModal = () => {
    if (isMpModalOpen && activeMasterTab === 'profile') closeMasterModal()
    else openMasterModal('profile')
  }

  const closeMpModal = () => closeMasterModal()
  const toggleMpModal = () => {
    if (isMpModalOpen && activeMasterTab === 'online') closeMasterModal()
    else openMasterModal('online')
  }

  btnMenu.addEventListener('click', toggleModal)
  btnGarage.addEventListener('click', () => {
    audioManager.playClick()
    toggleGarageModal()
  })
  btnProfile.addEventListener('click', () => {
    audioManager.playClick()
    toggleProfileModal()
  })
  btnProfileGoGarage.addEventListener('click', () => {
    audioManager.playClick()
    switchMasterTab('garage')
  })

  const saveProfileName = () => {
    const newName = profileNameInput.value.trim()
    if (newName) {
      audioManager.playClick()
      playerProfileManager.setDisplayName(newName)
      networkManager.setPlayerName(newName)
      mpNameInput.value = newName
      showResetToast(`Sürücü Adı Güncellendi: ${newName}`, 'info', 1800)
      renderProfileView()
    }
  }

  btnSaveProfileName.addEventListener('click', saveProfileName)
  profileNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveProfileName()
  })

  btnProfileReset.addEventListener('click', () => {
    if (confirm('Sürücü profilini ve istatistiklerini sıfırlamak istiyor musun?')) {
      audioManager.playClick()
      const fresh = playerProfileManager.resetProfile()
      networkManager.setPlayerName(fresh.displayName)
      mpNameInput.value = fresh.displayName
      const def = getVehicleDefinition(fresh.selectedCarId)
      if (def) vehicle.setDefinition(def)
      showResetToast('Profil ve istatistikler sıfırlandı!', 'warning', 2500)
      renderProfileView()
    }
  })
  modalClose.addEventListener('click', closeModal)
  modeModal.addEventListener('click', (e) => {
    if (e.target === modeModal) closeModal()
  })

  // Race Results Action Listeners (Phase 11 & 16)
  btnRaceRestart.addEventListener('click', () => {
    raceResultsModal.classList.remove('open')
    const activeMode = modeManager.getActiveMode()
    if (activeMode.modeType === GameModeType.RACE) {
      const currentRoom = networkManager.getCurrentRoom()
      if (currentRoom && currentRoom.mode === 'RACE') {
        networkManager.sendRematch()
        return
      }
    }
    modeManager.reset()
  })

  btnRaceMenu.addEventListener('click', () => {
    raceResultsModal.classList.remove('open')
    openModal()
  })

  // Drift Results Action Listeners (Phase 17)
  btnDriftRestart.addEventListener('click', () => {
    driftResultsModal.classList.remove('open')
    const activeMode = modeManager.getActiveMode()
    if (activeMode.modeType === GameModeType.DRIFT) {
      const currentRoom = networkManager.getCurrentRoom()
      if (currentRoom && currentRoom.mode === 'DRIFT') {
        networkManager.sendDriftRematch()
        return
      }
    }
    modeManager.reset()
  })

  btnDriftMenu.addEventListener('click', () => {
    driftResultsModal.classList.remove('open')
    openModal()
  })

  // 8. Multiplayer Manager & Modal Management (Phase 12, 13 & 18)
  let netSyncAccumulator = 0

  btnMultiplayer.addEventListener('click', toggleMpModal)
  mpModalClose.addEventListener('click', closeMpModal)
  mpModal.addEventListener('click', (e) => {
    if (e.target === mpModal) closeMpModal()
  })

  // Tabs
  mpTabRooms.addEventListener('click', () => {
    mpTabRooms.classList.add('active')
    mpTabCreate.classList.remove('active')
    mpRoomsTabContent.style.display = 'block'
    mpCreateTabContent.style.display = 'none'
  })

  mpTabCreate.addEventListener('click', () => {
    mpTabCreate.classList.add('active')
    mpTabRooms.classList.remove('active')
    mpRoomsTabContent.style.display = 'none'
    mpCreateTabContent.style.display = 'block'
  })

  btnRefreshRooms.addEventListener('click', () => {
    networkManager.refreshRooms()
  })

  btnMpReconnect.addEventListener('click', () => {
    btnMpReconnect.disabled = true
    btnMpReconnect.textContent = 'Bağlanıyor...'
    networkManager.connect()
    setTimeout(() => {
      btnMpReconnect.disabled = false
      btnMpReconnect.textContent = 'Yeniden Bağlan'
    }, 2500)
  })

  mpNameInput.value = playerProfileManager.getProfile().displayName
  mpNameInput.addEventListener('input', () => {
    const val = mpNameInput.value.trim()
    networkManager.setPlayerName(val)
    playerProfileManager.setDisplayName(val)
  })

  // Phase 18: Quick Join
  btnQuickJoin.addEventListener('click', async () => {
    btnQuickJoin.disabled = true
    btnQuickJoin.textContent = 'Eşleşiliyor...'
    try {
      const preferredMode = mpQuickMode.value || undefined
      await networkManager.quickJoin({
        preferredMode,
        playerName: mpNameInput.value.trim() || undefined,
      })
    } catch (err: any) {
      alert(err.message || 'Hızlı eşleşme başarısız oldu')
    } finally {
      btnQuickJoin.disabled = false
      btnQuickJoin.textContent = '⚡ Hemen Oyna'
    }
  })

  // Phase 18: Join by Private Room Code
  btnJoinCode.addEventListener('click', async () => {
    const code = mpRoomCodeInput.value.trim().toUpperCase()
    if (!code) {
      alert('Lütfen katılmak için 4 haneli oda kodunu girin (Örn: A7X9)')
      return
    }
    btnJoinCode.disabled = true
    btnJoinCode.textContent = 'Katılınıyor...'
    try {
      await networkManager.joinRoomByCode(code, mpNameInput.value.trim() || undefined)
      mpRoomCodeInput.value = ''
    } catch (err: any) {
      alert(err.message || 'Odaya katılınamadı. Kod geçersiz veya oda dolu olabilir.')
    } finally {
      btnJoinCode.disabled = false
      btnJoinCode.textContent = 'Koda Katıl'
    }
  })

  // Phase 18: Copy Room Code
  btnCopyCode.addEventListener('click', () => {
    const code = mpRoomCodeDisplay.textContent || ''
    if (code && code !== '----') {
      navigator.clipboard.writeText(code).then(() => {
        btnCopyCode.textContent = 'Kopyalandı! ✔'
        btnCopyCode.classList.add('copied')
        setTimeout(() => {
          btnCopyCode.textContent = '📋 Kopyala'
          btnCopyCode.classList.remove('copied')
        }, 2000)
      }).catch(() => {
        btnCopyCode.textContent = 'Kopyalanamadı'
      })
    }
  })

  // Create room
  btnSubmitCreateRoom.addEventListener('click', async () => {
    const name = mpRoomName.value.trim() || 'Hızlı Yarış'
    const mode = mpRoomMode.value
    const maxPlayers = Number(mpRoomMax.value) || 8
    const isPrivate = mpRoomIsPrivate.checked

    try {
      btnSubmitCreateRoom.disabled = true
      btnSubmitCreateRoom.textContent = 'Oda Kuruluyor...'
      await networkManager.createRoom({
        name,
        mode,
        map: mode === 'CITY_FREE_ROAM' ? 'CITY' : mode === 'RACE' ? 'RACE_TRACK' : 'DRIFT_TRACK',
        maxPlayers,
        isPrivate,
        playerName: mpNameInput.value.trim() || undefined,
      })
    } catch (err: any) {
      alert(err.message || 'Oda kurulamadı')
    } finally {
      btnSubmitCreateRoom.disabled = false
      btnSubmitCreateRoom.textContent = 'Odayı Başlat'
    }
  })

  // Leave room
  btnLeaveRoom.addEventListener('click', async () => {
    await networkManager.leaveRoom()
  })

  // Render Rooms (Phase 18 UX: Full state, roomCode badges, disabled button)
  const renderRoomsList = (rooms: ReturnType<typeof networkManager.getAvailableRooms>) => {
    mpRoomsCount.textContent = String(rooms ? rooms.length : 0)

    if (!rooms || rooms.length === 0) {
      mpRoomList.innerHTML = `
        <div class="mp-empty-state">
          <div style="font-size: 24px;">🏎️</div>
          <div style="font-weight: 700; margin-top: 6px; color: #f8fafc;">Şu anda açık oda yok</div>
          <div style="margin-top: 4px;">"+ Yeni Oda Kur" sekmesinden yeni bir oda açabilir veya "Hızlı Eşleşme"yi deneyebilirsin!</div>
        </div>
      `
      return
    }

    mpRoomList.innerHTML = rooms
      .map((r) => {
        const modeLabel = r.mode === 'CITY_FREE_ROAM' ? '🏙️ Serbest Şehir' : r.mode === 'RACE' ? '🏁 Yarış Pisti' : '🔥 Drift Alanı'
        const isFull = r.currentPlayers >= r.maxPlayers
        const codePill = r.roomCode ? `<span class="mp-code-pill">#${r.roomCode}</span>` : ''
        const statusBadge = isFull ? '<span class="mp-full-badge">DOLU</span>' : '<span class="mp-open-badge">AÇIK</span>'
        const buttonHtml = isFull
          ? `<button disabled class="action-btn disabled" style="padding: 8px 16px; font-size: 12px; flex: 0 0 auto;">Oda Dolu</button>`
          : `<button class="action-btn primary btn-join-room" data-room-id="${r.id}" style="padding: 8px 16px; font-size: 12px; flex: 0 0 auto;">Katıl</button>`

        return `
          <div class="mp-room-item" data-room-id="${r.id}">
            <div class="mp-room-item-info">
              <div class="mp-room-name-row">
                <span class="mp-room-name">${r.name}</span>
                ${codePill}
                ${statusBadge}
                <span class="mp-room-count-badge">${r.currentPlayers}/${r.maxPlayers}</span>
              </div>
              <div class="mp-room-meta">
                <span>${modeLabel}</span>
                <span>•</span>
                <span>Oda Sahibi: ${r.players[0]?.name || 'Bilinmiyor'}</span>
              </div>
            </div>
            ${buttonHtml}
          </div>
        `
      })
      .join('')

    mpRoomList.querySelectorAll<HTMLButtonElement>('.btn-join-room').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const roomId = btn.dataset.roomId
        if (!roomId) return
        btn.disabled = true
        btn.textContent = 'Katılınıyor...'
        try {
          await networkManager.joinRoom(roomId, mpNameInput.value.trim() || undefined)
        } catch (err: any) {
          alert(err.message || 'Odaya katılınamadı')
          btn.disabled = false
          btn.textContent = 'Katıl'
        }
      })
    })
  }

  // Render Room Members (Phase 18 UX: Room Code Display, Copy Button, Privacy Badge)
  const renderRoomView = (room: NonNullable<ReturnType<typeof networkManager.getCurrentRoom>>) => {
    mpLobbyView.style.display = 'none'
    mpRoomView.style.display = 'block'

    mpActiveRoomName.textContent = room.name
    const modeLabel = room.mode === 'CITY_FREE_ROAM' ? '🏙️ Serbest Şehir' : room.mode === 'RACE' ? '🏁 Yarış Pisti' : '🔥 Drift Alanı'
    mpActiveRoomSub.textContent = `Mod: ${modeLabel} | Kapasite: ${room.currentPlayers}/${room.maxPlayers}`
    mpMemberCount.textContent = `${room.currentPlayers}/${room.maxPlayers}`

    mpRoomCodeDisplay.textContent = room.roomCode || room.id.slice(-4).toUpperCase()
    mpActiveRoomPrivacyBadge.style.display = room.isPrivate ? 'inline-block' : 'none'

    const myId = networkManager.getPlayerId()
    mpMemberList.innerHTML = room.players
      .map((p) => {
        const isMe = p.id === myId
        return `
          <div class="mp-member-item">
            <div class="mp-member-info">
              <span class="mp-member-name">${p.name}</span>
              <span class="mp-member-id">#${p.id}</span>
              ${p.isHost ? '<span class="mp-host-badge">👑 ODA SAHİBİ</span>' : ''}
              ${isMe ? '<span class="mp-you-badge">SEN</span>' : ''}
            </div>
            <span style="font-size: 11px; color: #10b981; font-weight: 700;">🟢 Hazır</span>
          </div>
        `
      })
      .join('')
  }

  // NetworkManager event bindings & Reconnect Tracking (Phase 18)
  networkManager.onReconnectAttempt((attempt) => {
    hudNetDot.className = 'status-dot reconnecting'
    hudNetText.textContent = `Yeniden deneniyor (${attempt}/10)...`
    mpStatusDot.className = 'status-dot reconnecting'
    mpStatusTitle.textContent = `Sunucuya Yeniden Bağlanılıyor (Deneme ${attempt}/10)...`
    mpStatusSub.textContent = 'WebSocket bağlantısı bekleniyor...'
    btnMpReconnect.style.display = 'none'
  })

  networkManager.onStatusChange((status, playerId) => {
    hudNetDot.className = `status-dot ${status}`
    mpStatusDot.className = `status-dot ${status}`

    if (status === 'connected' && playerId) {
      hudNetText.textContent = 'Online'
      hudNetId.style.display = 'inline-block'
      hudNetId.textContent = `#${playerId}`

      mpStatusTitle.textContent = 'Çok Oyunculu Sunucuya Bağlandı'
      mpStatusSub.textContent = `WebSocket Aktif • Sunucu: http://localhost:3001`
      mpPlayerIdBadge.style.display = 'flex'
      mpPlayerIdText.textContent = playerId
      mpPingBadge.style.display = 'flex'
      mpPingText.textContent = `${networkManager.getPing()} ms`
      btnMpReconnect.style.display = 'none'

      if (!mpNameInput.value) {
        mpNameInput.value = playerProfileManager.getProfile().displayName || `Racer_${playerId.slice(-4)}`
        networkManager.setPlayerName(mpNameInput.value)
      }
    } else if (status === 'connecting') {
      hudNetText.textContent = 'Bağlanıyor...'
      hudNetId.style.display = 'none'
      mpStatusTitle.textContent = 'Sunucuya Bağlanılıyor...'
      mpStatusSub.textContent = 'WebSocket el sıkışması başlatıldı...'
      mpPlayerIdBadge.style.display = 'none'
      mpPingBadge.style.display = 'none'
      btnMpReconnect.style.display = 'none'
    } else {
      hudNetText.textContent = 'Çevrimdışı'
      hudNetId.style.display = 'none'
      mpStatusTitle.textContent = 'Sunucu Bağlantısı Yok'
      mpStatusSub.textContent = 'Yerel sunucu (localhost:3001) çalışmıyor olabilir.'
      mpPlayerIdBadge.style.display = 'none'
      mpPingBadge.style.display = 'none'
      btnMpReconnect.style.display = 'inline-block'
    }
  })

  // 8.1 Mode-Aware Vehicle Respawn & Fall Recovery (Phase 19 & 20)
  const doRespawn = () => {
    vehicleResetSystem.respawn('manual')
    followCamera.snap()
  }

  const doCycleSpawn = () => {
    modeManager.cycleSpawn()
    followCamera.snap()
    if (vehicle && vehicle.rigidBody) {
      const p = vehicle.root.position
      const q = vehicle.root.quaternion
      networkManager.sendRespawn([p.x, p.y, p.z], [q.x, q.y, q.z, q.w])
    }
  }

  // 8.2 Online City Player List Overlay Controller (Phase 15)
  playerListHeader.addEventListener('click', () => {
    cityPlayerListCard.classList.toggle('collapsed')
  })

  const updateCityPlayerList = () => {
    const isOnline = networkManager.isConnected()
    const activeMode = modeManager.getActiveMode()
    const isCity = activeMode.modeType === GameModeType.CITY_FREE_ROAM

    if (!isOnline || !isCity) {
      cityPlayerListCard.style.display = 'none'
      return
    }

    cityPlayerListCard.style.display = 'flex'
    const currentRoom = networkManager.getCurrentRoom()
    const myId = networkManager.getPlayerId() || ''
    const myName = networkManager.getPlayerName() || 'Sen'
    const myColor = getPlayerColorHex(myId)
    const myPing = networkManager.getPing()

    playerListRoomTitle.textContent = currentRoom ? currentRoom.name : 'ŞEHİR SÜRÜCÜLERİ'
    playerListPing.textContent = `Gecikme: ${myPing} ms`

    const remoteVehicles = remotePlayerManager.getAllRemoteVehicles()
    const totalCount = 1 + remoteVehicles.size
    playerListCountBadge.textContent = totalCount.toString()

    const localPos = vehicle.root.position

    let itemsHtml = `
      <div class="player-list-item is-me">
        <div class="item-left">
          <span class="item-car-dot" style="background: ${myColor}; color: ${myColor};"></span>
          <span class="item-name">${myName}</span>
          <span class="mp-you-badge">SEN</span>
        </div>
        <div class="item-right">
          <span class="item-dist">BURADA</span>
          <span class="item-ping">${myPing}ms</span>
        </div>
      </div>
    `

    for (const [rId, remoteCar] of remoteVehicles.entries()) {
      const rColor = getPlayerColorHex(rId)
      const dist = Math.round(localPos.distanceTo(remoteCar.root.position))
      const isHost = currentRoom && currentRoom.hostId === rId

      itemsHtml += `
        <div class="player-list-item">
          <div class="item-left">
            <span class="item-car-dot" style="background: ${rColor}; color: ${rColor};"></span>
            <span class="item-name" title="${remoteCar.playerName}">${remoteCar.playerName}</span>
            ${isHost ? '<span class="mp-host-badge">👑</span>' : ''}
          </div>
          <div class="item-right">
            <span class="item-dist">${dist}m</span>
            <span class="item-ping">🟢</span>
          </div>
        </div>
      `
    }

    playerListItems.innerHTML = itemsHtml
  }

  // 8.3 Online Race Room Overlay & Standings Controller (Phase 16)
  btnRaceReady.addEventListener('click', () => {
    const activeMode = modeManager.getActiveMode()
    if (activeMode.modeType === GameModeType.RACE) {
      const raceMode = modeManager.getMode(GameModeType.RACE) as RaceMode
      if (raceMode) {
        raceMode.toggleReady(modeManager['context'])
        updateOnlineRaceCard()
      }
    }
  })

  const updateOnlineRaceCard = () => {
    const isOnline = networkManager.isConnected()
    const activeMode = modeManager.getActiveMode()
    const isRace = activeMode.modeType === GameModeType.RACE

    if (!isOnline || !isRace) {
      onlineRaceCard.style.display = 'none'
      return
    }

    const currentRoom = networkManager.getCurrentRoom()
    if (!currentRoom || currentRoom.mode !== 'RACE') {
      onlineRaceCard.style.display = 'none'
      return
    }

    onlineRaceCard.style.display = 'flex'
    onlineRaceRoomName.textContent = currentRoom.name || 'YARIŞ ODASI'

    const raceState = currentRoom.raceState || OnlineRaceState.LOBBY
    const myId = networkManager.getPlayerId() || ''
    const myPlayer = currentRoom.players.find((p) => p.id === myId)
    const isReady = !!myPlayer?.isReady
    const gridIdx = myPlayer?.gridIndex ?? (currentRoom.players.findIndex((p) => p.id === myId) % 8)

    onlineRaceGridBadge.textContent = `Grid #${gridIdx + 1}`
    onlineRacePlayersCount.textContent = `${currentRoom.currentPlayers}/${currentRoom.maxPlayers} Sürücü`

    // Status badge & Ready button state
    if (raceState === OnlineRaceState.LOBBY) {
      onlineRaceStatusBadge.className = 'online-race-badge'
      onlineRaceStatusBadge.textContent = 'LOBİ'
      btnRaceReady.style.display = 'flex'
      if (isReady) {
        btnRaceReady.classList.add('is-ready')
        btnRaceReadyIcon.textContent = '🟢'
        btnRaceReadyText.textContent = 'HAZIRSIN (İPTAL ET)'
      } else {
        btnRaceReady.classList.remove('is-ready')
        btnRaceReadyIcon.textContent = '⚪'
        btnRaceReadyText.textContent = 'HAZIRIM (BOŞLUK)'
      }
    } else if (raceState === OnlineRaceState.COUNTDOWN) {
      onlineRaceStatusBadge.className = 'online-race-badge countdown'
      onlineRaceStatusBadge.textContent = `BAŞLIYOR: ${currentRoom.countdownRemaining || 3}s`
      btnRaceReady.style.display = 'none'
    } else if (raceState === OnlineRaceState.RACING) {
      onlineRaceStatusBadge.className = 'online-race-badge racing'
      onlineRaceStatusBadge.textContent = 'YARIŞTA'
      btnRaceReady.style.display = 'none'
    } else {
      onlineRaceStatusBadge.className = 'online-race-badge'
      onlineRaceStatusBadge.textContent = 'BİTTİ'
      btnRaceReady.style.display = 'none'
    }

    // Render drivers or standings rows during lobby
    if (raceState === OnlineRaceState.LOBBY) {
      const rowsHtml = currentRoom.players
        .map((p, idx) => {
          const isMe = p.id === myId
          const pColor = getPlayerColorHex(p.id)
          const pGrid = p.gridIndex !== undefined ? p.gridIndex + 1 : idx + 1
          const readyBadge = p.isReady
            ? '<span style="color: #34d399; font-weight: 700;">🟢 Hazır</span>'
            : '<span style="color: #94a3b8; font-weight: 600;">⚪ Bekliyor</span>'

          return `
            <div class="online-race-standings-row ${isMe ? 'is-me' : ''}">
              <div class="online-race-row-left">
                <span class="online-race-rank">#${pGrid}</span>
                <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${pColor};"></span>
                <span class="online-race-driver-name">${p.name}</span>
                ${isMe ? '<span class="mp-you-badge" style="font-size: 9px; padding: 1px 4px;">SEN</span>' : ''}
              </div>
              <div class="online-race-row-right">
                ${readyBadge}
              </div>
            </div>
          `
        })
        .join('')

      onlineRaceStandings.innerHTML = rowsHtml
    }
  }

  networkManager.onRaceRoomUpdate(() => {
    updateOnlineRaceCard()
  })

  networkManager.onRaceProgress((payload) => {
    if (onlineRaceCard.style.display !== 'none' && payload.participants) {
      const myId = networkManager.getPlayerId() || ''
      const rowsHtml = payload.participants
        .map((p) => {
          const isMe = p.playerId === myId
          const pColor = getPlayerColorHex(p.playerId)
          const statusText = p.finished
            ? '<span style="color: #facc15; font-weight: 700;">🏁 BİTTİ</span>'
            : `Tur ${p.currentLap}/2`

          return `
            <div class="online-race-standings-row ${isMe ? 'is-me' : ''}">
              <div class="online-race-row-left">
                <span class="online-race-rank">P${p.rank}</span>
                <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${pColor};"></span>
                <span class="online-race-driver-name">${p.playerName}</span>
                ${isMe ? '<span class="mp-you-badge" style="font-size: 9px; padding: 1px 4px;">SEN</span>' : ''}
              </div>
              <div class="online-race-row-right">
                <span class="online-race-lap-badge">${statusText}</span>
              </div>
            </div>
          `
        })
        .join('')
      onlineRaceStandings.innerHTML = rowsHtml
    }
  })

  // 8.4 Online Drift Room Overlay & Leaderboard Controller (Phase 17)
  btnDriftReady.addEventListener('click', () => {
    const activeMode = modeManager.getActiveMode()
    if (activeMode.modeType === GameModeType.DRIFT) {
      const driftMode = modeManager.getMode(GameModeType.DRIFT) as DriftMode
      if (driftMode) {
        driftMode.toggleReady(modeManager['context'])
        updateOnlineDriftCard()
      }
    }
  })

  const updateOnlineDriftCard = () => {
    const isOnline = networkManager.isConnected()
    const activeMode = modeManager.getActiveMode()
    const isDrift = activeMode.modeType === GameModeType.DRIFT

    if (!isOnline || !isDrift) {
      onlineDriftCard.style.display = 'none'
      return
    }

    const currentRoom = networkManager.getCurrentRoom()
    if (!currentRoom || currentRoom.mode !== 'DRIFT') {
      onlineDriftCard.style.display = 'none'
      return
    }

    onlineDriftCard.style.display = 'flex'
    onlineDriftRoomName.textContent = currentRoom.name || 'DRIFT ARENASI'

    const driftState = currentRoom.driftState || OnlineDriftState.LOBBY
    const myId = networkManager.getPlayerId() || ''
    const myPlayer = currentRoom.players.find((p) => p.id === myId)
    const isReady = !!myPlayer?.isReady

    onlineDriftPlayersCount.textContent = `${currentRoom.currentPlayers}/${currentRoom.maxPlayers} Pilot`

    if (driftState === OnlineDriftState.LOBBY) {
      onlineDriftStatusBadge.className = 'online-race-badge online-drift-badge'
      onlineDriftStatusBadge.textContent = 'LOBİ'
      onlineDriftTimerBadge.textContent = '⏱️ 60s'
      btnDriftReady.style.display = 'flex'
      if (isReady) {
        btnDriftReady.classList.add('is-ready')
        btnDriftReadyIcon.textContent = '🟢'
        btnDriftReadyText.textContent = 'HAZIRSIN (İPTAL ET)'
      } else {
        btnDriftReady.classList.remove('is-ready')
        btnDriftReadyIcon.textContent = '⚪'
        btnDriftReadyText.textContent = 'HAZIRIM (BOŞLUK)'
      }

      const rowsHtml = currentRoom.players
        .map((p, idx) => {
          const isMe = p.id === myId
          const pColor = getPlayerColorHex(p.id)
          const readyBadge = p.isReady
            ? '<span style="color: #34d399; font-weight: 700;">🟢 Hazır</span>'
            : '<span style="color: #94a3b8; font-weight: 600;">⚪ Bekliyor</span>'

          return `
            <div class="online-race-standings-row ${isMe ? 'is-me' : ''}">
              <div class="online-race-row-left">
                <span class="online-race-rank">#${idx + 1}</span>
                <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${pColor};"></span>
                <span class="online-race-driver-name">${p.name}</span>
                ${isMe ? '<span class="mp-you-badge" style="font-size: 9px; padding: 1px 4px;">SEN</span>' : ''}
              </div>
              <div class="online-race-row-right">
                ${readyBadge}
              </div>
            </div>
          `
        })
        .join('')

      onlineDriftStandings.innerHTML = rowsHtml
    } else if (driftState === OnlineDriftState.COUNTDOWN) {
      onlineDriftStatusBadge.className = 'online-race-badge countdown'
      onlineDriftStatusBadge.textContent = `BAŞLIYOR: ${currentRoom.countdownRemaining || 3}s`
      btnDriftReady.style.display = 'none'
    } else if (driftState === OnlineDriftState.ACTIVE) {
      onlineDriftStatusBadge.className = 'online-race-badge online-drift-badge active'
      onlineDriftStatusBadge.textContent = 'CANLI SEANS'
      btnDriftReady.style.display = 'none'
    } else {
      onlineDriftStatusBadge.className = 'online-race-badge'
      onlineDriftStatusBadge.textContent = 'BİTTİ'
      btnDriftReady.style.display = 'none'
    }
  }

  networkManager.onDriftRoomUpdate(() => {
    updateOnlineDriftCard()
  })

  networkManager.onRoomsUpdated((rooms) => {
    renderRoomsList(rooms)
  })

  networkManager.onRoomJoined((payload) => {
    renderRoomView(payload.room)
    // Synchronize local game mode with room mode
    if (payload.room.mode && payload.room.mode in GameModeType) {
      modeManager.setMode(payload.room.mode as GameModeType)
      followCamera.snap()
    }
    // Distributed spawn assignment for City Free Roam
    if (payload.room.mode === GameModeType.CITY_FREE_ROAM && payload.player.spawnIndex !== undefined) {
      const cityMode = modeManager.getMode(GameModeType.CITY_FREE_ROAM) as CityFreeRoamMode
      if (cityMode) {
        cityMode.currentSpawnIndex = payload.player.spawnIndex
        doRespawn()
      }
    }
    // Starting grid assignment for Race Track (Phase 16)
    if (payload.room.mode === GameModeType.RACE) {
      const raceMode = modeManager.getMode(GameModeType.RACE) as RaceMode
      if (raceMode) {
        raceMode.checkAndInitSession(modeManager['context'])
      }
    }
    // Drift Track session assignment (Phase 17)
    if (payload.room.mode === GameModeType.DRIFT) {
      const driftMode = modeManager.getMode(GameModeType.DRIFT) as DriftMode
      if (driftMode) {
        driftMode.checkAndInitSession(modeManager['context'])
      }
    }
    updateOnlineRaceCard()
    updateOnlineDriftCard()
  })

  networkManager.onRoomLeft(() => {
    mpRoomView.style.display = 'none'
    mpLobbyView.style.display = 'flex'
    networkManager.refreshRooms()
    updateOnlineRaceCard()
    updateOnlineDriftCard()
  })

  networkManager.onPlayerJoinedRoom((payload) => {
    renderRoomView(payload.room)
    updateOnlineRaceCard()
    updateOnlineDriftCard()
  })

  networkManager.onPlayerLeftRoom((payload) => {
    renderRoomView(payload.room)
    updateOnlineRaceCard()
    updateOnlineDriftCard()
    updateOnlineRaceCard()
  })

  // Authoritative State Reconciliation (Phase 14)
  networkManager.onReconcile((payload) => {
    const currentPos = vehicle.root.position
    const dx = currentPos.x - payload.correctedPosition[0]
    const dy = currentPos.y - payload.correctedPosition[1]
    const dz = currentPos.z - payload.correctedPosition[2]
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (dist > 1.2) {
      console.log(`[Reconciliation] Local vehicle position reconciled with authoritative server (dist: ${dist.toFixed(2)}m, reason: ${payload.reason || 'desync'})`)
      vehicle.reconcile(payload.correctedPosition, payload.correctedRotation, payload.correctedVelocity)
    }
  })

  // Start connection
  networkManager.connect()

  // Keyboard controls
  const keys: VehicleInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    handbrake: false,
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return

    const target = e.target as HTMLElement | null
    const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')

    if (e.code === 'Escape') {
      if (isMpModalOpen) {
        closeMpModal()
        return
      }
      if (isModalOpen) {
        closeModal()
        return
      }
      toggleModal()
      return
    }

    if (e.code === 'Tab') {
      e.preventDefault()
      cityPlayerListCard.classList.toggle('collapsed')
      return
    }

    if (isTyping) return

    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = true
        keyW.classList.add('active')
        break
      case 'KeyS':
      case 'ArrowDown':
        keys.backward = true
        keyS.classList.add('active')
        break
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = true
        keyA.classList.add('active')
        break
      case 'KeyD':
      case 'ArrowRight':
        keys.right = true
        keyD.classList.add('active')
        break
      case 'Space': {
        const activeMode = modeManager.getActiveMode()
        if (activeMode.modeType === GameModeType.RACE) {
          const currentRoom = networkManager.getCurrentRoom()
          if (currentRoom && currentRoom.mode === 'RACE' && (!currentRoom.raceState || currentRoom.raceState === OnlineRaceState.LOBBY)) {
            e.preventDefault()
            const raceMode = modeManager.getMode(GameModeType.RACE) as RaceMode
            if (raceMode) {
              raceMode.toggleReady(modeManager['context'])
              updateOnlineRaceCard()
            }
            break
          }
        } else if (activeMode.modeType === GameModeType.DRIFT) {
          const currentRoom = networkManager.getCurrentRoom()
          if (currentRoom && currentRoom.mode === 'DRIFT' && (!currentRoom.driftState || currentRoom.driftState === OnlineDriftState.LOBBY)) {
            e.preventDefault()
            const driftMode = modeManager.getMode(GameModeType.DRIFT) as DriftMode
            if (driftMode) {
              driftMode.toggleReady(modeManager['context'])
              updateOnlineDriftCard()
            }
            break
          }
        }
        keys.handbrake = true
        break
      }
      case 'KeyM':
      case 'KeyU':
        toggleMute()
        break
      case 'KeyR':
        doRespawn()
        break
      case 'KeyC':
        doCycleSpawn()
        break
      case 'KeyV': {
        const nextPreset = followCamera.cyclePreset()
        const presetLabels: Record<CameraPreset, string> = {
          NORMAL: 'Normal Takip (Dengeli)',
          CLOSE: 'Yakın Takip (Dinamik)',
          FAR: 'Uzak / Geniş Açı (Sinematik)',
          DRIFT: 'Drift Modu (Geniş Savrulma)',
        }
        showResetToast(`Kamera: ${presetLabels[nextPreset]}`, 'info', 1200)
        break
      }
      case 'KeyG':
        openMasterModal('garage')
        break
      case 'KeyP':
        openMasterModal('profile')
        break
    }
  })

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = false
        keyW.classList.remove('active')
        break
      case 'KeyS':
      case 'ArrowDown':
        keys.backward = false
        keyS.classList.remove('active')
        break
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = false
        keyA.classList.remove('active')
        break
      case 'KeyD':
      case 'ArrowRight':
        keys.right = false
        keyD.classList.remove('active')
        break
      case 'Space':
        keys.handbrake = false
        break
    }
  })

  btnReset.addEventListener('click', () => {
    audioManager.playClick()
    doRespawn()
  })

  btnSpawn.addEventListener('click', () => {
    audioManager.playClick()
    doCycleSpawn()
  })

  btnMenu.addEventListener('click', () => {
    audioManager.playClick()
    openModal()
  })

  btnMultiplayer.addEventListener('click', () => {
    audioManager.playClick()
    openMasterModal('online')
  })

  // --- 8. PERFORMANCE & FPS MONITOR ---
  let frameCount = 0
  let lastFpsUpdateTime = performance.now()

  // --- 9. MAIN ANIMATION & PHYSICS LOOP ---
  let lastTime = performance.now()
  let playerListTimer = 0
  let previousVehicleSpeed = 0
  let profileStatsTimer = 0
  let accumulatedDistanceMeters = 0

  function animate() {
    requestAnimationFrame(animate)

    const now = performance.now()
    const rawDelta = (now - lastTime) / 1000
    lastTime = now
    const delta = Math.min(rawDelta, 0.05)

    // 9.1 Physics Simulation Step
    physicsWorld.step()

    // 9.2 Vehicle Dynamics Update
    vehicle.update(delta, keys)

    // 9.2b Vehicle Reset & Out-Of-Bounds Fall / Flip Monitor (Phase 19)
    vehicleResetSystem.update(delta, keys)

    // 9.2c Driving Audio Engine (Phase 22)
    const speedKmh = vehicle.getSpeedKmh()
    const speedDrop = previousVehicleSpeed - vehicle.currentSpeed
    if (previousVehicleSpeed > 3.5 && speedDrop > 3.2 && !keys.backward) {
      audioManager.playCollision(Math.min(speedDrop / 10, 1.0))
      followCamera.addTrauma(Math.min(speedDrop / 15, 0.7))
    }
    previousVehicleSpeed = vehicle.currentSpeed

    const throttle = keys.forward ? 1.0 : (keys.backward && vehicle.currentSpeed < -0.2 ? 0.75 : 0.0)
    const isBraking = keys.backward && vehicle.currentSpeed > 0.5
    audioManager.updateDrivingAudio({
      speedKmh,
      throttle,
      isBraking,
      isDrifting: vehicle.isDrifting,
      slipAngleRad: vehicle.slipAngle,
    })

    // 9.3 Active Game Mode Update
    modeManager.update(delta)

    // 9.4 Tire Smoke Simulation Update (Phase 9)
    tireSmoke.update(delta)

    // 9.4b Remote Players Update & Local Telemetry Sync (Phase 13)
    remotePlayerManager.update(delta)

    // 9.4c Online City & Race Player List Throttle Update (Phase 15 & 16)
    playerListTimer += delta
    if (playerListTimer >= 0.25) {
      playerListTimer = 0
      updateCityPlayerList()
      updateOnlineRaceCard()
      updateOnlineDriftCard()
    }

    // 9.4d Player Profile Mileage & Playtime Tracking (Phase 24)
    profileStatsTimer += delta
    accumulatedDistanceMeters += Math.abs(vehicle.currentSpeed) * delta
    if (profileStatsTimer >= 3.0) {
      playerProfileManager.addDistanceAndPlaytime(accumulatedDistanceMeters, profileStatsTimer)
      accumulatedDistanceMeters = 0
      profileStatsTimer = 0
    }

    netSyncAccumulator += delta
    if (netSyncAccumulator >= 0.05) {
      netSyncAccumulator = 0
      if (vehicle && vehicle.rigidBody) {
        const pos = vehicle.root.position
        const rot = vehicle.root.quaternion
        const linvel = vehicle.rigidBody.linvel()
        networkManager.sendPlayerState({
          position: [pos.x, pos.y, pos.z],
          rotation: [rot.x, rot.y, rot.z, rot.w],
          velocity: [linvel.x, linvel.y, linvel.z],
          speed: vehicle.currentSpeed,
          steering: vehicle.currentSteerAngle,
          isBraking: keys.backward,
          isDrifting: vehicle.isDrifting,
          inputs: {
            forward: keys.forward,
            backward: keys.backward,
            left: keys.left,
            right: keys.right,
            handbrake: keys.handbrake,
          },
        })
      }
    }

    // 9.5 Directional Sunlight Cascade (follows vehicle for sharp local shadows)
    sunLight.position.set(
      vehicle.root.position.x + 40,
      60,
      vehicle.root.position.z + 30
    )
    sunLight.target.position.copy(vehicle.root.position)
    sunLight.target.updateMatrixWorld()

    // 9.5 Polished Third-Person Follow Camera (Phase 20)
    followCamera.update(delta)

    // 9.6 HUD Speedometer & Gear Update
    hudSpeed.textContent = speedKmh.toString()

    const speedPercent = Math.min(speedKmh / (vehicle.config.maxForwardSpeed * 3.6), 1.0) * 100
    hudSpeedBar.style.width = `${speedPercent}%`

    if (Math.abs(vehicle.currentSpeed) < 0.2) {
      hudGear.textContent = 'N'
      hudGear.className = 'gear-badge neutral'
    } else if (vehicle.currentSpeed > 0) {
      hudGear.textContent = 'D'
      hudGear.className = 'gear-badge'
    } else {
      hudGear.textContent = 'R'
      hudGear.className = 'gear-badge reverse'
    }

    // 9.7 FPS Monitor Update
    frameCount++
    if (now - lastFpsUpdateTime >= 500) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdateTime))
      hudFpsBadge.textContent = `${fps} FPS`
      if (fps >= 55) {
        hudFpsBadge.style.color = '#34d399'
      } else if (fps >= 35) {
        hudFpsBadge.style.color = '#facc15'
      } else {
        hudFpsBadge.style.color = '#ef4444'
      }
      frameCount = 0
      lastFpsUpdateTime = now
    }

    // 9.8 Render Scene
    renderer.render(scene, camera)
  }

  animate()
}

// --- 10. RESPONSIVE WINDOW RESIZE ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
})

// Start Application
bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err)
  hudAssetStatus.textContent = 'BAŞLATMA HATASI'
  hudAssetStatus.style.color = '#ef4444'
})
