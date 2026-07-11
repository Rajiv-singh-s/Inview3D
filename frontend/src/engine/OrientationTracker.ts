/**
 * OrientationTracker.ts
 * Unified orientation tracking class supporting WebXR and DeviceOrientationEvent.
 */

export interface OrientationUpdate {
  yaw: number;
  pitch: number;
  roll: number;
  timestamp: number;
}

export class OrientationTracker {
  private active = false;
  private baseYaw: number | null = null;
  private onUpdate: (update: OrientationUpdate) => void;
  
  // Using 'any' for WebXR types to avoid dependency on @types/webxr in strict environments
  private xrSession: any = null;
  private xrRefSpace: any = null;
  private xrFrameId: number | null = null;
  
  private boundDeviceOrientation: (e: DeviceOrientationEvent) => void;

  /**
   * @param onUpdate - Callback triggered when new orientation data is available
   */
  constructor(onUpdate: (update: OrientationUpdate) => void) {
    this.onUpdate = onUpdate;
    this.boundDeviceOrientation = this.handleDeviceOrientation.bind(this);
  }

  /**
   * Starts tracking orientation. Tries WebXR first, then falls back to DeviceOrientationEvent.
   */
  public async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.baseYaw = null;

    const nav = navigator as any;
    const hasWebXR = typeof nav !== 'undefined' && 'xr' in nav;
    if (hasWebXR && nav.xr) {
      try {
        const supported = await nav.xr.isSessionSupported('immersive-ar');
        if (supported) {
          await this.startWebXR(nav.xr);
          return;
        }
      } catch (e) {
        console.warn('WebXR AR not supported or failed to initialize, falling back', e);
      }
    }

    await this.startDeviceOrientation();
  }

  private async startWebXR(xr: any): Promise<void> {
    try {
      this.xrSession = await xr.requestSession('immersive-ar', { requiredFeatures: ['local'] });
      this.xrRefSpace = await this.xrSession.requestReferenceSpace('local');
      
      const onXRFrame = (time: number, frame: any) => {
        if (!this.active) return;
        this.xrFrameId = this.xrSession.requestAnimationFrame(onXRFrame);
        
        const viewerPose = frame.getViewerPose(this.xrRefSpace);
        if (viewerPose) {
          const q = viewerPose.transform.orientation;
          
          // Convert quaternion to Euler angles (yaw, pitch, roll)
          // WebXR coordinate system: Y is up, X is right, Z is back
          const sinp = 2 * (q.w * q.x - q.z * q.y);
          let pitch = 0;
          if (Math.abs(sinp) >= 1) {
            pitch = Math.sign(sinp) * (Math.PI / 2);
          } else {
            pitch = Math.asin(sinp);
          }

          const siny_cosp = 2 * (q.w * q.y + q.z * q.x);
          const cosy_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
          const yaw = Math.atan2(siny_cosp, cosy_cosp);

          const sinr_cosp = 2 * (q.w * q.z + q.x * q.y);
          const cosr_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
          const roll = Math.atan2(sinr_cosp, cosr_cosp);

          // Convert to degrees
          let yawDeg = yaw * (180 / Math.PI);
          const pitchDeg = pitch * (180 / Math.PI);
          const rollDeg = roll * (180 / Math.PI);

          if (this.baseYaw === null) {
            this.baseYaw = yawDeg;
          }
          yawDeg = yawDeg - this.baseYaw;
          if (yawDeg < 0) yawDeg += 360;

          this.onUpdate({ yaw: yawDeg, pitch: pitchDeg, roll: rollDeg, timestamp: performance.now() });
        }
      };
      
      this.xrFrameId = this.xrSession.requestAnimationFrame(onXRFrame);
    } catch (e) {
      console.error('Failed to start WebXR session', e);
      await this.startDeviceOrientation();
    }
  }

  private async startDeviceOrientation(): Promise<void> {
    if (typeof DeviceOrientationEvent !== 'undefined' && 
        typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const permission = await (DeviceOrientationEvent as any).requestPermission();
        if (permission !== 'granted') {
          console.error('Device orientation permission denied');
          return;
        }
      } catch (e) {
        console.error('Error requesting device orientation permission', e);
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('deviceorientation', this.boundDeviceOrientation);
    }
  }

  private handleDeviceOrientation(event: DeviceOrientationEvent): void {
    if (!this.active) return;
    
    // alpha = Z axis (yaw equivalent), beta = X axis (pitch), gamma = Y axis (roll)
    const rawAlpha = event.alpha || 0; 
    const rawBeta = event.beta || 0;   
    const rawGamma = event.gamma || 0; 

    if (this.baseYaw === null) {
      this.baseYaw = rawAlpha;
    }

    let normalizedYaw = rawAlpha - this.baseYaw;
    if (normalizedYaw < 0) normalizedYaw += 360;

    this.onUpdate({
      yaw: normalizedYaw,
      pitch: rawBeta,
      roll: rawGamma,
      timestamp: performance.now()
    });
  }

  /**
   * Stops tracking and cleans up listeners/sessions.
   */
  public stop(): void {
    this.active = false;
    
    if (this.xrSession) {
      if (this.xrFrameId !== null) {
        this.xrSession.cancelAnimationFrame(this.xrFrameId);
        this.xrFrameId = null;
      }
      this.xrSession.end().catch(console.error);
      this.xrSession = null;
    }
    
    if (typeof window !== 'undefined') {
      window.removeEventListener('deviceorientation', this.boundDeviceOrientation);
    }
  }
}
