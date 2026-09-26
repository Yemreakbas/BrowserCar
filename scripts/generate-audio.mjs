import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const outDir = path.resolve(__dirname, '../public/assets/audio')

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true })
}

/**
 * Creates a 16-bit Mono PCM WAV buffer
 * @param {Float32Array} samples Float samples between -1.0 and 1.0
 * @param {number} sampleRate Samples per second (default 22050)
 */
function createWavBuffer(samples, sampleRate = 22050) {
  const numSamples = samples.length
  const bitsPerSample = 16
  const numChannels = 1
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const subChunk2Size = (numSamples * numChannels * bitsPerSample) / 8
  const chunkSize = 36 + subChunk2Size

  const buffer = Buffer.alloc(44 + subChunk2Size)

  // RIFF Chunk
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(chunkSize, 4)
  buffer.write('WAVE', 8)

  // fmt Subchunk
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // Subchunk1Size
  buffer.writeUInt16LE(1, 20) // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)

  // data Subchunk
  buffer.write('data', 36)
  buffer.writeUInt32LE(subChunk2Size, 40)

  // Write 16-bit samples
  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff
    buffer.writeInt16LE(Math.round(intSample), offset)
    offset += 2
  }

  return buffer
}

const sampleRate = 22050

// 1. Engine Idle Loop (1.2s, ~48Hz rhythmic rumble)
function generateEngineIdle() {
  const duration = 1.2
  const length = Math.floor(sampleRate * duration)
  const samples = new Float32Array(length)
  const f0 = 46.0

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    // Pulse harmonics
    const h1 = Math.sin(2 * Math.PI * f0 * t) * 0.45
    const h2 = Math.sin(2 * Math.PI * f0 * 2 * t) * 0.25
    const h3 = Math.sin(2 * Math.PI * f0 * 3 * t) * 0.15
    const h4 = Math.sin(2 * Math.PI * f0 * 4 * t) * 0.08
    // Mechanical cylinder flutter
    const flutter = Math.sin(2 * Math.PI * (f0 / 2) * t) * 0.15
    // Subtle rumble noise
    const noise = (Math.random() * 2 - 1) * 0.07

    // Soft seamless loop cross-fade at ends
    let edgeFade = 1.0
    const fadeSamples = Math.floor(sampleRate * 0.04)
    if (i < fadeSamples) edgeFade = i / fadeSamples
    else if (i > length - fadeSamples) edgeFade = (length - i) / fadeSamples

    samples[i] = (h1 + h2 + h3 + h4 + flutter + noise) * edgeFade * 0.8
  }
  return samples
}

// 2. Engine Accel / High RPM Loop (1.5s, ~130Hz sports car tone)
function generateEngineAccel() {
  const duration = 1.5
  const length = Math.floor(sampleRate * duration)
  const samples = new Float32Array(length)
  const f0 = 125.0

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const h1 = Math.sin(2 * Math.PI * f0 * t) * 0.35
    const h2 = Math.sin(2 * Math.PI * f0 * 2 * t) * 0.28
    const h3 = Math.sin(2 * Math.PI * f0 * 3 * t) * 0.18
    const h4 = Math.sin(2 * Math.PI * f0 * 4 * t) * 0.12
    const h5 = Math.sin(2 * Math.PI * f0 * 5 * t) * 0.07
    // Distortion warmth
    let raw = h1 + h2 + h3 + h4 + h5
    let distorted = Math.tanh(raw * 1.5) * 0.7
    // Exhaust air noise
    const exhaust = (Math.random() * 2 - 1) * 0.06

    let edgeFade = 1.0
    const fadeSamples = Math.floor(sampleRate * 0.04)
    if (i < fadeSamples) edgeFade = i / fadeSamples
    else if (i > length - fadeSamples) edgeFade = (length - i) / fadeSamples

    samples[i] = (distorted + exhaust) * edgeFade * 0.85
  }
  return samples
}

// 3. Brake Squeal & Friction (0.75s)
function generateBrake() {
  const duration = 0.75
  const length = Math.floor(sampleRate * duration)
  const samples = new Float32Array(length)
  let noiseFilter = 0

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const envelope = Math.sin((t / duration) * Math.PI)
    // Metallic resonant squeal
    const squeal = Math.sin(2 * Math.PI * (2850 + Math.sin(t * 30) * 120) * t) * 0.22
    // Pad friction noise (bandpass simulation)
    const rawNoise = Math.random() * 2 - 1
    noiseFilter = noiseFilter * 0.82 + rawNoise * 0.18
    samples[i] = (squeal + noiseFilter * 0.45) * envelope * 0.75
  }
  return samples
}

// 4. Tire Skid / Drift Screech Loop (1.2s)
function generateSkid() {
  const duration = 1.2
  const length = Math.floor(sampleRate * duration)
  const samples = new Float32Array(length)
  let b0 = 0, b1 = 0, b2 = 0

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const white = Math.random() * 2 - 1
    // Resonant bandpass filter around 1100Hz - 1600Hz
    b0 = 0.75 * b0 + white * 0.25
    b1 = 0.82 * b1 + b0 * 0.18
    b2 = 0.85 * b2 + (white - b0) * 0.15

    // Slight tire rubber chirp / resonance
    const chirp = Math.sin(2 * Math.PI * (1280 + Math.sin(t * 45) * 80) * t) * 0.18

    let edgeFade = 1.0
    const fadeSamples = Math.floor(sampleRate * 0.05)
    if (i < fadeSamples) edgeFade = i / fadeSamples
    else if (i > length - fadeSamples) edgeFade = (length - i) / fadeSamples

    samples[i] = ((b1 + b2 * 0.8) * 0.6 + chirp) * edgeFade * 0.85
  }
  return samples
}

// 5. Collision Impact (0.6s)
function generateCollision() {
  const duration = 0.6
  const length = Math.floor(sampleRate * duration)
  const samples = new Float32Array(length)
  let noiseEnv = 1.0

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    // Fast pitch drop bass thud (110Hz -> 35Hz)
    const freq = 35 + 85 * Math.exp(-t * 22)
    const thud = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 8) * 0.65
    // Metallic crunch noise with fast decay
    const crunch = (Math.random() * 2 - 1) * Math.exp(-t * 14) * 0.5
    // Secondary mechanical rattle
    const rattle = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 18) * 0.25

    samples[i] = Math.tanh((thud + crunch + rattle) * 1.4) * 0.95
  }
  return samples
}

// 6. Countdown Beep (0.16s, 440Hz)
function generateCountdownBeep() {
  const duration = 0.16
  const length = Math.floor(sampleRate * duration)
  const samples = new Float32Array(length)
  const freq = 440.0

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    // Smooth bell envelope
    const env = Math.sin((t / duration) * Math.PI)
    const wave = Math.sin(2 * Math.PI * freq * t) * 0.8 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.2
    samples[i] = wave * env * 0.8
  }
  return samples
}

// 7. Countdown Go (0.35s, 880Hz high chime)
function generateCountdownGo() {
  const duration = 0.35
  const length = Math.floor(sampleRate * duration)
  const samples = new Float32Array(length)
  const freq = 880.0

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const env = Math.exp(-t * 7)
    // Rich bright start tone
    const wave = Math.sin(2 * Math.PI * freq * t) * 0.7 + Math.sin(2 * Math.PI * freq * 1.5 * t) * 0.3
    samples[i] = wave * env * 0.85
  }
  return samples
}

// 8. Race Finish Chime (1.2s, uplifting C5 - E5 - G5 - C6 fanfare)
function generateRaceFinish() {
  const duration = 1.2
  const length = Math.floor(sampleRate * duration)
  const samples = new Float32Array(length)
  const notes = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6
  const noteDuration = 0.2

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    let totalSample = 0

    for (let n = 0; n < notes.length; n++) {
      const noteStart = n * noteDuration
      if (t >= noteStart) {
        const noteT = t - noteStart
        const noteEnv = Math.exp(-noteT * 3.5)
        const noteWave =
          Math.sin(2 * Math.PI * notes[n] * noteT) * 0.6 +
          Math.sin(2 * Math.PI * notes[n] * 2 * noteT) * 0.25 +
          Math.sin(2 * Math.PI * notes[n] * 3 * noteT) * 0.1
        totalSample += noteWave * noteEnv * 0.35
      }
    }

    samples[i] = Math.tanh(totalSample) * 0.9
  }
  return samples
}

// 9. Menu UI Click (0.05s, snappy crisp pop)
function generateMenuClick() {
  const duration = 0.05
  const length = Math.floor(sampleRate * duration)
  const samples = new Float32Array(length)

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const env = Math.exp(-t * 90)
    const wave = Math.sin(2 * Math.PI * 1400 * t) * 0.7 + (Math.random() * 2 - 1) * 0.3
    samples[i] = wave * env * 0.6
  }
  return samples
}

const sounds = [
  { name: 'engine_idle.wav', generator: generateEngineIdle },
  { name: 'engine_accel.wav', generator: generateEngineAccel },
  { name: 'brake.wav', generator: generateBrake },
  { name: 'skid.wav', generator: generateSkid },
  { name: 'collision.wav', generator: generateCollision },
  { name: 'countdown_beep.wav', generator: generateCountdownBeep },
  { name: 'countdown_go.wav', generator: generateCountdownGo },
  { name: 'race_finish.wav', generator: generateRaceFinish },
  { name: 'menu_click.wav', generator: generateMenuClick },
]

console.log('Generating game audio assets in:', outDir)

for (const sound of sounds) {
  const samples = sound.generator()
  const wavBuffer = createWavBuffer(samples, sampleRate)
  const filePath = path.join(outDir, sound.name)
  fs.writeFileSync(filePath, wavBuffer)
  console.log(`✓ Generated ${sound.name} (${(wavBuffer.length / 1024).toFixed(1)} KB)`)
}

console.log('All audio assets generated successfully!')
