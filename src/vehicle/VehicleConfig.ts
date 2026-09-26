export interface VehicleConfig {
  // Speed & Limits (m/s)
  maxForwardSpeed: number // ~104 km/h (29.0 m/s)
  maxReverseSpeed: number // ~40 km/h (-11.0 m/s)

  // Acceleration & Powertrain Dynamics
  baseAcceleration: number // Peak acceleration force at low speed (m/s^2)
  accelerationCurvePower: number // Exponent shaping torque dropoff at high speed
  reverseAcceleration: number

  // Braking Dynamics
  brakingPower: number // Foot brake deceleration (m/s^2)
  handbrakePower: number // Handbrake forward deceleration (m/s^2, balanced for sustained slide)
  coastingDrag: number // Natural rolling resistance & aerodynamic drag

  // Steering & Speed-Sensitive Handling
  maxSteerAngle: number // Maximum steer angle at standstill/low speed (radians, ~28 deg)
  minSteerSensitivity: number // Lower bound multiplier at top speed (e.g. 0.45 for high speed stability)
  steeringSpeedDropoff: number // Speed (m/s) at which steering sensitivity reduces by half
  steerResponseSpeed: number // How fast wheels turn to match key input (rad/s)
  steerReturnSpeed: number // How fast wheels return to center when key released
  baseTurnRate: number // Yaw rotation rate multiplier

  // Traction & Drift Dynamics
  lateralGripNormal: number // Normal cornering grip factor (0..1, high = tracks wheels strictly)
  lateralGripDrift: number // Grip while drifting (allows smooth, controllable power-slides)
  driftGripRecoverySpeed: number // Speed at which traction recovers after exiting drift
  driftMinSpeed: number // Minimum speed (m/s) required to initiate/sustain drift (~14 km/h)
  driftMinAngleDeg: number // Minimum slip angle to register drift (~10 deg)
  driftMaxAngleDeg: number // Maximum angle before spin-out risk (~80 deg)
  driftYawMultiplier: number // Angular velocity boost while counter-steering in drift

  // Suspension & Visual Body Dynamics
  suspensionPitchMax: number // Max chassis pitch under hard accel/braking (radians)
  suspensionRollMax: number // Max chassis lean into corners (radians)
  suspensionSmoothing: number // Smoothing lerp factor for body roll/pitch

  // Wheels
  wheelRadius: number // Kenney sports car wheel radius at scale (meters)
}

export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  maxForwardSpeed: 38.0, // ~136.8 km/h high-speed sports sedan
  maxReverseSpeed: -14.0, // ~50.4 km/h
  baseAcceleration: 28.0, // Punchy, responsive sports acceleration
  accelerationCurvePower: 0.75, // Sustained torque across mid-high speeds
  reverseAcceleration: 22.0, // Strong, responsive reverse launch

  brakingPower: 36.0, // Strong, predictable foot braking
  handbrakePower: 4.0, // Balanced slide drag without killing drift momentum
  coastingDrag: 5.5, // Smooth deceleration when coasting

  maxSteerAngle: 0.48, // ~27.5 degrees at low speed
  minSteerSensitivity: 0.38, // High-speed steering stability
  steeringSpeedDropoff: 16.0, // Natural gradual steering transition
  steerResponseSpeed: 7.2, // Responsive wheel turning
  steerReturnSpeed: 8.8, // Rapid centering
  baseTurnRate: 2.2, // Dynamic yaw response

  lateralGripNormal: 0.94, // Solid grip tracking wheels for normal driving
  lateralGripDrift: 0.20, // Low lateral grip allowing long, beautiful arcade slides
  driftGripRecoverySpeed: 4.2, // Smooth, predictable grip recovery
  driftMinSpeed: 2.8, // ~10 km/h minimum speed for sustained low-speed drifts
  driftMinAngleDeg: 10.0, // 10 degrees slip angle
  driftMaxAngleDeg: 80.0, // 80 degrees spin-out threshold
  driftYawMultiplier: 1.55, // Yaw boost during active drift for sharp counter-steering

  suspensionPitchMax: 0.045, // Mild squat on acceleration / dive on braking
  suspensionRollMax: 0.08, // Subtle body lean in sharp turns
  suspensionSmoothing: 0.16, // Smooth spring-damper feel

  wheelRadius: 0.435, // Kenney sedan wheel radius at 1.45x scale
}

