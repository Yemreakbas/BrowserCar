import { io } from 'socket.io-client'

const SERVER_URL = 'http://localhost:3001'

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runPhase19Tests() {
  console.log('--- STARTING PHASE 19 AUTOMATED TESTS ---')
  let passedTests = 0

  // Connect Client 1
  const socket1 = io(SERVER_URL, { reconnection: false })
  let player1Id = ''
  const initPromise1 = new Promise((resolve) => {
    socket1.on('player:init', (payload) => {
      player1Id = payload.playerId
      resolve(payload)
    })
  })
  await new Promise((resolve) => socket1.on('connect', resolve))
  await initPromise1
  console.log(`[Test] Client 1 connected: playerId=${player1Id}`)

  // Connect Client 2
  const socket2 = io(SERVER_URL, { reconnection: false })
  let player2Id = ''
  const initPromise2 = new Promise((resolve) => {
    socket2.on('player:init', (payload) => {
      player2Id = payload.playerId
      resolve(payload)
    })
  })
  await new Promise((resolve) => socket2.on('connect', resolve))
  await initPromise2
  console.log(`[Test] Client 2 connected: playerId=${player2Id}`)

  // Test 1: Authoritative Out-of-Bounds Fall Recovery
  console.log('\n[Test 1] Testing Authoritative Out-of-Bounds Fall Recovery (y < -5.0)...')
  let reconcileReceived = false
  let correctedPos = null

  socket1.on('player:reconcile', (payload) => {
    if (payload.playerId === player1Id && payload.reason === 'OUT_OF_BOUNDS_FALL') {
      reconcileReceived = true
      correctedPos = payload.correctedPosition
    }
  })

  // Send falling telemetry (y = -8.5)
  socket1.emit('player:state', {
    playerId: player1Id,
    roomId: 'room_city_global',
    position: [12.0, -8.5, 45.0],
    rotation: [0, 0, 0, 1],
    velocity: [0, -15.0, 0],
    speed: 15,
    steering: 0,
    isBraking: false,
    isDrifting: false,
    sequence: 1,
    timestamp: Date.now(),
  })

  await sleep(150)

  if (reconcileReceived && correctedPos && correctedPos[1] >= 0) {
    console.log(`✅ Test 1 Passed: Authoritative server detected fall and reconciled position to [${correctedPos.join(', ')}]`)
    passedTests++
  } else {
    throw new Error('Test 1 Failed: Fall reconcile was not triggered or invalid position returned')
  }

  // Test 2: Mode-Aware Reset Request (City Mode Legal Respawn)
  console.log('\n[Test 2] Testing Mode-Aware Reset Request (City Mode Legal Respawn)...')
  let client2ReceivedRespawn = false

  socket2.on('player:state', (state) => {
    if (state.playerId === player1Id && state.isRespawn) {
      client2ReceivedRespawn = true
    }
  })

  const resetReq = {
    roomId: 'room_city_global',
    position: [45.0, 0.45, 45.0],
    rotation: [0, -0.7071, 0, 0.7071],
    reason: 'manual',
  }

  const resetRes = await new Promise((resolve) => {
    socket1.emit('player:reset', resetReq, (res) => {
      resolve(res)
    })
  })

  await sleep(100)

  if (resetRes && resetRes.success && client2ReceivedRespawn) {
    console.log(`✅ Test 2 Passed: Reset acknowledged by server and broadcasted with isRespawn to other players: pos=[${resetRes.position.join(', ')}]`)
    passedTests++
  } else {
    throw new Error(`Test 2 Failed: Reset response invalid or not broadcasted: ${JSON.stringify(resetRes)}`)
  }

  // Test 3: Illegal Respawn Coordinates Clamping
  console.log('\n[Test 3] Testing Illegal Respawn Coordinates Clamping...')
  const illegalResetReq = {
    roomId: 'room_city_global',
    position: [9999.0, 500.0, -9999.0], // Out of bounds
    rotation: [0, 0, 0, 1],
    reason: 'fall',
  }

  const illegalRes = await new Promise((resolve) => {
    socket1.emit('player:reset', illegalResetReq, (res) => {
      resolve(res)
    })
  })

  if (illegalRes && illegalRes.success && Math.abs(illegalRes.position[0]) < 100) {
    console.log(`✅ Test 3 Passed: Out-of-bounds reset clamped to valid coordinate: [${illegalRes.position.join(', ')}]`)
    passedTests++
  } else {
    throw new Error(`Test 3 Failed: Server did not clamp illegal coordinates: ${JSON.stringify(illegalRes)}`)
  }

  // Test 4: Race Room Checkpoint Respawn Validation
  console.log('\n[Test 4] Testing Race Room Respawn in Race Bounds...')
  // Client 1 joins race room
  await new Promise((resolve) => {
    socket1.emit('room:join', { roomId: 'room_race_circuit' }, resolve)
  })

  const raceResetReq = {
    roomId: 'room_race_circuit',
    position: [2.5, 0.45, 570], // Starting grid position
    rotation: [0, 0, 0, 1],
    reason: 'flipped',
  }

  const raceRes = await new Promise((resolve) => {
    socket1.emit('player:reset', raceResetReq, (res) => {
      resolve(res)
    })
  })

  if (raceRes && raceRes.success && raceRes.position[0] === 2.5 && raceRes.position[2] === 570) {
    console.log(`✅ Test 4 Passed: Race room checkpoint reset accepted at [${raceRes.position.join(', ')}] with reason "${raceRes.reason}"`)
    passedTests++
  } else {
    throw new Error(`Test 4 Failed: Race room reset failed: ${JSON.stringify(raceRes)}`)
  }

  socket1.disconnect()
  socket2.disconnect()

  console.log(`\n===========================================`)
  console.log(`🎉 ALL ${passedTests}/4 TESTS PASSED SUCCESSFULLY!`)
  console.log(`===========================================`)
}

runPhase19Tests().catch((err) => {
  console.error('Test suite failed:', err)
  process.exit(1)
})
