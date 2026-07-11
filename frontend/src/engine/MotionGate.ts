/**
 * MotionGate.ts
 * Implements a stability check using the device's accelerometer.
 */

export class MotionGate {
  private smoothedAcceleration: number = 0;
  private threshold: number;
  private alpha: number; // Smoothing factor
  private boundHandleMotion: (event: DeviceMotionEvent) => void;

  // State for gravity low-pass filter (used if linear acceleration is unavailable)
  private gravity = { x: 0, y: 0, z: 0 };
  private gravityInitialized = false;

  /**
   * Initializes the MotionGate listener for device motion.
   * @param threshold - Maximum allowed acceleration magnitude to be considered stable (m/s²). Default is 0.8.
   * @param smoothing - Smoothing factor between 0 and 1 (lower means more smoothing). Default is 0.2.
   */
  constructor(threshold: number = 0.8, smoothing: number = 0.2) {
    this.threshold = threshold;
    this.alpha = smoothing;
    this.boundHandleMotion = this.handleMotion.bind(this);
    
    if (typeof window !== 'undefined') {
      window.addEventListener('devicemotion', this.boundHandleMotion);
    }
  }

  /**
   * Event handler for devicemotion.
   * Computes the linear acceleration magnitude without gravity.
   */
  private handleMotion(event: DeviceMotionEvent): void {
    let accelX = 0;
    let accelY = 0;
    let accelZ = 0;

    // Prefer linear acceleration (excluding gravity) if provided by the device
    if (event.acceleration && (event.acceleration.x !== null)) {
      accelX = event.acceleration.x || 0;
      accelY = event.acceleration.y || 0;
      accelZ = event.acceleration.z || 0;
    } 
    // Fallback for devices that only provide acceleration including gravity
    else if (event.accelerationIncludingGravity && (event.accelerationIncludingGravity.x !== null)) {
      const ax = event.accelerationIncludingGravity.x || 0;
      const ay = event.accelerationIncludingGravity.y || 0;
      const az = event.accelerationIncludingGravity.z || 0;

      // Apply a low-pass filter to isolate gravity
      const alphaGravity = 0.8;
      if (!this.gravityInitialized) {
        this.gravity = { x: ax, y: ay, z: az };
        this.gravityInitialized = true;
      } else {
        this.gravity.x = alphaGravity * this.gravity.x + (1 - alphaGravity) * ax;
        this.gravity.y = alphaGravity * this.gravity.y + (1 - alphaGravity) * ay;
        this.gravity.z = alphaGravity * this.gravity.z + (1 - alphaGravity) * az;
      }

      // High-pass filter: subtract gravity to get linear acceleration
      accelX = ax - this.gravity.x;
      accelY = ay - this.gravity.y;
      accelZ = az - this.gravity.z;
    } else {
      return; // No usable acceleration data
    }

    const magnitude = Math.sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);
    this.updateSmoothed(magnitude);
  }

  /**
   * Applies an Exponential Moving Average (EMA) to smooth out acceleration spikes.
   */
  private updateSmoothed(magnitude: number): void {
    this.smoothedAcceleration = this.alpha * magnitude + (1 - this.alpha) * this.smoothedAcceleration;
  }

  /**
   * Checks if the device is currently stable.
   * @returns true if the smoothed acceleration is below or equal to the threshold, false otherwise.
   */
  public isStable(): boolean {
    return this.smoothedAcceleration <= this.threshold;
  }
  
  /**
   * Gets the current smoothed acceleration magnitude.
   * @returns The smoothed linear acceleration magnitude in m/s²
   */
  public getSmoothedAcceleration(): number {
    return this.smoothedAcceleration;
  }

  /**
   * Cleans up event listeners. Must be called when the instance is no longer needed.
   */
  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('devicemotion', this.boundHandleMotion);
    }
  }
}
