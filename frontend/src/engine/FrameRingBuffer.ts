/**
 * FrameRingBuffer.ts
 * A continuous, memory-efficient rolling ring buffer for video frames.
 */

export interface BufferedFrame {
  timestamp: number;
  frame: any; // VideoFrame | HTMLCanvasElement
}

export class FrameRingBuffer {
  private buffer: (BufferedFrame | null)[];
  private capacity: number;
  private head: number = 0;
  
  private active: boolean = false;
  
  // For MediaStreamTrackProcessor
  private reader: ReadableStreamDefaultReader<any> | null = null;
  
  // For fallback canvas loop
  private videoElement: HTMLVideoElement | null = null;
  private requestFrameId: number | null = null;
  
  /**
   * @param size - Maximum number of frames to keep in the buffer
   */
  constructor(size: number) {
    this.capacity = size;
    this.buffer = new Array(size).fill(null);
  }

  /**
   * Starts the continuous frame capture loop from a MediaStreamTrack.
   * @param track - The MediaStreamTrack to read frames from
   */
  public async start(track: MediaStreamTrack): Promise<void> {
    if (this.active) return;
    this.active = true;

    // Use MediaStreamTrackProcessor and VideoFrame for zero-copy frames if available
    if (typeof (window as any).MediaStreamTrackProcessor !== 'undefined' && typeof (window as any).VideoFrame !== 'undefined') {
      await this.startProcessorLoop(track);
    } else {
      await this.startFallbackLoop(track);
    }
  }

  private async startProcessorLoop(track: MediaStreamTrack): Promise<void> {
    const MediaStreamTrackProcessor = (window as any).MediaStreamTrackProcessor;
    const processor = new MediaStreamTrackProcessor({ track });
    this.reader = processor.readable.getReader();

    const readLoop = async () => {
      if (!this.active || !this.reader) return;
      try {
        const { done, value } = await this.reader.read();
        if (done) return;
        
        if (value) {
          this.pushFrame(value);
        }
        
        if (this.active) {
          readLoop();
        } else if (value) {
          // Clean up if we stopped right after getting a frame
          value.close(); 
        }
      } catch (e) {
        console.error('Error reading from MediaStreamTrackProcessor', e);
        this.active = false;
      }
    };

    readLoop();
  }

  private async startFallbackLoop(track: MediaStreamTrack): Promise<void> {
    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    
    const stream = new MediaStream([track]);
    this.videoElement.srcObject = stream;
    
    await this.videoElement.play().catch(e => console.warn('Video auto-play prevented', e));
    
    const loop = () => {
      if (!this.active || !this.videoElement) return;
      
      if (this.videoElement.readyState >= this.videoElement.HAVE_CURRENT_DATA) {
        const width = this.videoElement.videoWidth;
        const height = this.videoElement.videoHeight;
        
        if (width > 0 && height > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(this.videoElement, 0, 0, width, height);
            this.pushFrame(canvas);
          }
        }
      }
      
      this.requestFrameId = requestAnimationFrame(loop);
    };
    
    this.requestFrameId = requestAnimationFrame(loop);
  }

  private pushFrame(frame: any): void {
    const existing = this.buffer[this.head];
    
    // CRITICAL: Call close() on evicted VideoFrames to prevent memory leaks
    if (existing && existing.frame) {
      if ('close' in existing.frame && typeof existing.frame.close === 'function') {
        existing.frame.close();
      }
    }
    
    this.buffer[this.head] = {
      timestamp: Date.now(),
      frame: frame
    };
    
    this.head = (this.head + 1) % this.capacity;
  }

  /**
   * Retrieves the frame that was captured closest to the specified time ago.
   * If a VideoFrame is returned, it is cloned, and the caller is responsible for calling close() on it.
   * @param ms - Milliseconds ago
   * @returns The closest VideoFrame or HTMLCanvasElement, or null if buffer is empty
   */
  public getFrameAgo(ms: number): any | null {
    const targetTime = Date.now() - ms;
    
    let closest: BufferedFrame | null = null;
    let minDiff = Infinity;
    
    for (let i = 0; i < this.capacity; i++) {
      const item = this.buffer[i];
      if (!item) continue;
      
      const diff = Math.abs(item.timestamp - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = item;
      }
    }
    
    if (closest) {
      // Clone VideoFrame so the caller has ownership of the returned frame,
      // avoiding issues when the original is evicted and closed in the buffer.
      if ('clone' in closest.frame && typeof closest.frame.clone === 'function') {
         return closest.frame.clone();
      }
      return closest.frame;
    }
    
    return null;
  }

  /**
   * Stops the ring buffer and cleans up all resources.
   */
  public stop(): void {
    this.active = false;
    
    if (this.reader) {
      this.reader.cancel().catch(console.error);
      this.reader = null;
    }
    
    if (this.requestFrameId !== null) {
      cancelAnimationFrame(this.requestFrameId);
      this.requestFrameId = null;
    }
    
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
    
    for (let i = 0; i < this.capacity; i++) {
      const item = this.buffer[i];
      if (item && item.frame && 'close' in item.frame && typeof item.frame.close === 'function') {
        item.frame.close();
      }
      this.buffer[i] = null;
    }
    this.head = 0;
  }
}
