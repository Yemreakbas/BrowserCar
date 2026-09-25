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
  handbrakePower: number // Handbrake stopping power (m/s^2)
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
  lateralGripDrift: number // Grip while handbrake engaged (allows controllable power-slides)
  driftGripRecoverySpeed: number // Speed at which traction recovers after handbrake release

  // Suspension & Visual Body Dynamics
  suspensionPitchMax: number // Max chassis pitch under hard accel/braking (radians)
  suspensionRollMax: number // Max chassis lean into corners (radians)
  suspensionSmoothing: number // Smoothing lerp factor for body roll/pitch

  // Wheels
  wheelRadius: number // Kenney sports car wheel radius at scale (meters)
}

export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  maxForwardSpeed: 29.0, // ~104.4 km/h
  maxReverseSpeed: -11.0, // ~39.6 km/h

  baseAcceleration: 22.0, // Responsive initial launch
  accelerationCurvePower: 0.85, // Smooth torque tapering as top speed is approached
  reverseAcceleration: 11.0,

  brakingPower: 30.0, // Strong, predictable foot braking
  handbrakePower: 38.0, // Sharp handbrake bite
  coastingDrag: 4.8, // Smooth deceleration when coasting

  maxSteerAngle: 0.48, // ~27.5 degrees at low speed
  minSteerSensitivity: 0.42, // Steering becomes tighter and stable at high speeds
  steeringSpeedDropoff: 14.0, // Transition begins noticeably above ~50 km/h
  steerResponseSpeed: 6.0, // Responsive wheel turning
  steerReturnSpeed: 8.0, // Rapid centering
  baseTurnRate: 2.1, // Dynamic yaw response

  lateralGripNormal: 0.94, // Solid grip tracking wheels
  lateralGripDrift: 0.48, // Smooth slip angle during handbrake slide
  driftGripRecoverySpeed: 3.5, // Natural grip recovery without sudden snap

  suspensionPitchMax: 0.045, // Mild squat on acceleration / dive on braking
  suspensionRollMax: 0.08, // Subtle body lean in sharp turns
  suspensionSmoothing: 0.16, // Smooth spring-damper feel

  wheelRadius: 0.435, // Kenney sedan wheel radius at 1.45x scale
}
