/**
 * ViewportMaskShader.ts
 * Manages a WebGL2 fragment shader to render a masked viewport with a border over a video feed.
 */

export class ViewportMaskShader {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private vbo: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  
  private uniformLocs: {
    cameraTexture: WebGLUniformLocation | null;
    viewportRect: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
  };

  /**
   * Initializes the WebGL2 context and compiles shaders.
   * @param canvas - The HTML canvas element to render onto.
   */
  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    this.gl = gl;

    const vsSource = `#version 300 es
      in vec4 a_position;
      in vec2 a_texCoord;
      out vec2 v_texCoord;
      void main() {
        gl_Position = a_position;
        v_texCoord = a_texCoord;
      }
    `;

    // Render logic: video inside the viewportRect, pure black outside, and a 2px white border
    const fsSource = `#version 300 es
      precision highp float;
      
      in vec2 v_texCoord;
      out vec4 outColor;
      
      uniform sampler2D u_cameraTexture;
      uniform vec4 u_viewportRect;
      uniform vec2 u_resolution;
      
      void main() {
        vec2 ndc = (gl_FragCoord.xy / u_resolution) * 2.0 - 1.0;
        
        float left = u_viewportRect.x;
        float bottom = u_viewportRect.y;
        float right = u_viewportRect.x + u_viewportRect.z;
        float top = u_viewportRect.y + u_viewportRect.w;
        
        bool inX = ndc.x >= left && ndc.x <= right;
        bool inY = ndc.y >= bottom && ndc.y <= top;
        
        if (inX && inY) {
          // Calculate 2 pixels in NDC space for the border
          vec2 pxSize = 4.0 / u_resolution;
          
          bool borderX = ndc.x < (left + pxSize.x) || ndc.x > (right - pxSize.x);
          bool borderY = ndc.y < (bottom + pxSize.y) || ndc.y > (top - pxSize.y);
          
          if (borderX || borderY) {
            outColor = vec4(1.0, 1.0, 1.0, 1.0); // White border
          } else {
            // Flip Y-axis when sampling the texture because canvas/video origins are top-left
            outColor = texture(u_cameraTexture, vec2(v_texCoord.x, 1.0 - v_texCoord.y));
          }
        } else {
          outColor = vec4(0.0, 0.0, 0.0, 1.0); // Black outside
        }
      }
    `;

    const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fsSource);

    this.program = this.gl.createProgram()!;
    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);
    
    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + this.gl.getProgramInfoLog(this.program));
    }

    this.uniformLocs = {
      cameraTexture: this.gl.getUniformLocation(this.program, 'u_cameraTexture'),
      viewportRect: this.gl.getUniformLocation(this.program, 'u_viewportRect'),
      resolution: this.gl.getUniformLocation(this.program, 'u_resolution')
    };

    // Full screen quad setup
    const positions = new Float32Array([
      // X,  Y,    U, V
      -1, -1,    0, 0,
       1, -1,    1, 0,
      -1,  1,    0, 1,
      -1,  1,    0, 1,
       1, -1,    1, 0,
       1,  1,    1, 1,
    ]);

    this.vao = this.gl.createVertexArray()!;
    this.gl.bindVertexArray(this.vao);

    this.vbo = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

    const posLoc = this.gl.getAttribLocation(this.program, 'a_position');
    this.gl.enableVertexAttribArray(posLoc);
    this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 16, 0);

    const texLoc = this.gl.getAttribLocation(this.program, 'a_texCoord');
    this.gl.enableVertexAttribArray(texLoc);
    this.gl.vertexAttribPointer(texLoc, 2, this.gl.FLOAT, false, 16, 8);

    this.texture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error: ' + this.gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  /**
   * Updates the texture from the video and draws the viewport mask.
   * @param video - The video element serving as the camera feed.
   * @param viewportRect - Defines the visible area as [x, y, width, height] in NDC coordinates [-1, 1], where x, y is the bottom-left corner.
   */
  public render(video: HTMLVideoElement, viewportRect: [number, number, number, number]): void {
    if (video.readyState < video.HAVE_CURRENT_DATA) return;

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);

    // Upload new video frame
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, video);
    this.gl.uniform1i(this.uniformLocs.cameraTexture, 0);

    // Pass viewport rect and resolution
    this.gl.uniform4f(this.uniformLocs.viewportRect, viewportRect[0], viewportRect[1], viewportRect[2], viewportRect[3]);
    this.gl.uniform2f(this.uniformLocs.resolution, this.canvas.width, this.canvas.height);

    // Draw full screen quad
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  /**
   * Cleans up WebGL resources and forcibly loses the context.
   */
  public dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
    
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (ext) {
      ext.loseContext();
    }
  }
}
