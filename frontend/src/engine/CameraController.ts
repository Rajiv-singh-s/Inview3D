/**
 * CameraController.ts
 * Manages the MediaStream lifecycle, applying advanced constraints like manual focus/exposure.
 */

export class CameraController {
  private stream: MediaStream | null = null;
  private videoTrack: MediaStreamTrack | null = null;

  /**
   * Initializes the camera with specific constraints.
   * Requests environment facing camera at ideally 1080p resolution.
   * Attempts to lock focus and exposure if supported.
   */
  public async init(): Promise<void> {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
        throw new Error('MediaDevices API not available');
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      const tracks = this.stream.getVideoTracks();
      if (tracks.length > 0) {
        this.videoTrack = tracks[0];
        await this.tryLockSettings();
      }
    } catch (error) {
      console.error('Failed to initialize camera', error);
      throw error;
    }
  }

  /**
   * Attempts to apply manual focus and exposure if the track capabilities allow it.
   */
  private async tryLockSettings(): Promise<void> {
    if (!this.videoTrack) return;

    try {
      const trackAny = this.videoTrack as any;
      const capabilities = trackAny.getCapabilities ? trackAny.getCapabilities() : {};
      const constraints: any = {};
      let constraintsUpdated = false;

      // Check and apply Focus
      if (capabilities.focusMode && capabilities.focusMode.includes('manual')) {
        constraints.advanced = constraints.advanced || [];
        constraints.advanced.push({ focusMode: 'manual' });
        constraintsUpdated = true;
      }

      // Check and apply Exposure
      if (capabilities.exposureMode && capabilities.exposureMode.includes('manual')) {
        constraints.advanced = constraints.advanced || [];
        if (constraints.advanced.length > 0) {
           constraints.advanced[0].exposureMode = 'manual';
        } else {
           constraints.advanced.push({ exposureMode: 'manual' });
        }
        constraintsUpdated = true;
      }

      if (constraintsUpdated) {
        await this.videoTrack.applyConstraints(constraints);
      }
    } catch (e) {
      console.warn('Could not apply advanced camera constraints', e);
    }
  }

  /**
   * Verifies if focus and exposure are actually locked.
   * @returns boolean true if both (or the supported ones) are set to manual or unsupported.
   */
  public isLocked(): boolean {
    if (!this.videoTrack) return false;

    try {
      const settings: any = this.videoTrack.getSettings();
      // If undefined, it means the API doesn't expose it, so we count it as 'locked' by default 
      // since we can't do anything else.
      const focusLocked = settings.focusMode === 'manual' || settings.focusMode === undefined;
      const exposureLocked = settings.exposureMode === 'manual' || settings.exposureMode === undefined;

      return focusLocked && exposureLocked;
    } catch (e) {
      return false;
    }
  }

  /**
   * Gets the active MediaStream.
   * @returns MediaStream or null if not initialized.
   */
  public getStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Stops the camera and releases resources.
   */
  public destroy(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.videoTrack = null;
    }
  }
}
