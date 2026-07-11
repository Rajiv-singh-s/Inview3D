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
  
  private xrSession: any = null;
  private xrRefSpace: any = null;
  private xrFrameId: number | null = null;
  
  private boundDeviceOrientation: (e: DeviceOrientationEvent) => void;
  
  // Drag fallback state
  private hasReceivedDeviceOrientation = false;
  private isDragging = false;
  private lastX = 0;
  private lastY = 0;
  private virtualYaw = 0;
  private virtualPitch = 0;
  
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;

  constructor(onUpdate: (update: OrientationUpdate) => void) {
    this.onUpdate = onUpdate;
    this.boundDeviceOrientation = this.handleDeviceOrientation.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
  }

  public async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.baseYaw = null;
    this.hasReceivedDeviceOrientation = false;

    // Attach drag listeners immediately as fallback
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.boundPointerDown);
      window.addEventListener('pointermove', this.boundPointerMove);
      window.addEventListener('pointerup', this.boundPointerUp);
      window.addEventListener('pointercancel', this.boundPointerUp);
    }

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
        console.warn('WebXR AR not supported, falling back', e);
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
          this.hasReceivedDeviceOrientation = true;
          const q = viewerPose.transform.orientation;
          
          const sinp = 2 * (q.w * q.x - q.z * q.y);
          let pitch = 0;
          if (Math.abs(sinp) >= 1) pitch = Math.sign(sinp) * (Math.PI / 2);
          else pitch = Math.asin(sinp);

          const siny_cosp = 2 * (q.w * q.y + q.z * q.x);
          const cosy_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
          const yaw = Math.atan2(siny_cosp, cosy_cosp);

          const sinr_cosp = 2 * (q.w * q.z + q.x * q.y);
          const cosr_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
          const roll = Math.atan2(sinr_cosp, cosr_cosp);

          let yawDeg = yaw * (180 / Math.PI);
          const pitchDeg = pitch * (180 / Math.PI);
          const rollDeg = roll * (180 / Math.PI);

          if (this.baseYaw === null) this.baseYaw = yawDeg;
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
          console.warn('Device orientation permission denied, relying on drag fallback');
          return;
        }
      } catch (e) {
        console.warn('Error requesting device orientation permission (needs user gesture). Relying on drag fallback.', e);
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('deviceorientation', this.boundDeviceOrientation);
    }
  }

  private handleDeviceOrientation(event: DeviceOrientationEvent): void {
    if (!this.active) return;
    
    // Ignore events if they have no actual rotation data (common on desktop mocks)
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    
    this.hasReceivedDeviceOrientation = true;
    
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

  private handlePointerDown(e: PointerEvent): void {
    if (this.hasReceivedDeviceOrientation) return; // Disable drag if hardware works
    this.isDragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.isDragging || this.hasReceivedDeviceOrientation) return;
    
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    
    // Convert drag pixels to degrees (approx 0.2 degrees per pixel)
    this.virtualYaw -= dx * 0.2;
    if (this.virtualYaw < 0) this.virtualYaw += 360;
    if (this.virtualYaw >= 360) this.virtualYaw -= 360;
    
    this.virtualPitch += dy * 0.2; // Invert pitch
    // Clamp pitch between -90 and 90
    this.virtualPitch = Math.max(-90, Math.min(90, this.virtualPitch));
    
    this.onUpdate({
      yaw: this.virtualYaw,
      pitch: this.virtualPitch,
      roll: 0,
      timestamp: performance.now()
    });
  }

  private handlePointerUp(): void {
    this.isDragging = false;
  }

  public stop(): void {
    this.active = false;
    
    if (this.xrSession) {
      if (this.xrFrameId !== null) {
        this.xrSession.cancelAnimationFrame(this.xrFrameId);
        this.xrFrameId = null;
      }
      this.xrSession.end().catch(console.warn);
      this.xrSession = null;
    }
    
    if (typeof window !== 'undefined') {
      window.removeEventListener('deviceorientation', this.boundDeviceOrientation);
      window.removeEventListener('pointerdown', this.boundPointerDown);
      window.removeEventListener('pointermove', this.boundPointerMove);
      window.removeEventListener('pointerup', this.boundPointerUp);
      window.removeEventListener('pointercancel', this.boundPointerUp);
    }
  }
}
