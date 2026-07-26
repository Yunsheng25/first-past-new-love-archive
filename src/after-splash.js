const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * .5 + .5;
  gl_Position = vec4(a_position, 0., 1.);
}`;

const SPLASH_SHADER = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_previous;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform vec2 u_delta;
uniform vec3 u_color;
uniform float u_radius;
uniform float u_active;
uniform float u_decay;
uniform float u_time;

void main() {
  vec2 px = 1. / u_resolution;
  vec2 p = v_uv - u_pointer;
  p.x *= u_resolution.x / u_resolution.y;
  float distanceToPointer = length(p);
  float influence = exp(-distanceToPointer * distanceToPointer / max(.0001, u_radius));
  vec2 tangent = vec2(-p.y, p.x);
  vec2 flow = u_delta * influence * .055 + tangent * influence * .0035 * sin(u_time * .0015);
  vec3 dye = texture2D(u_previous, v_uv - flow).rgb;
  dye += u_color * influence * u_active * (length(u_delta) * 18. + .055);
  vec3 blur = (
    texture2D(u_previous, v_uv + vec2(px.x, 0.)).rgb +
    texture2D(u_previous, v_uv - vec2(px.x, 0.)).rgb +
    texture2D(u_previous, v_uv + vec2(0., px.y)).rgb +
    texture2D(u_previous, v_uv - vec2(0., px.y)).rgb
  ) * .25;
  dye = mix(dye, blur, .045) * u_decay;
  gl_FragColor = vec4(dye, 1.);
}`;

const PALETTE = [
  [0.62, 0.11, 0.055],
  [0.72, 0.34, 0.12],
  [0.31, 0.20, 0.15],
];

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message || 'Splash shader compilation failed');
  }
  return shader;
}

function createTarget(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return { texture, framebuffer, width, height };
}

export function mountAfterSplash(
  root,
  {
    matchMedia = (query) => globalThis.matchMedia?.(query),
    requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
    cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
    devicePixelRatio = globalThis.devicePixelRatio ?? 1,
    windowRef = globalThis.window,
  } = {},
) {
  try {
    if (matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return () => {};
  } catch {
    return () => {};
  }
  const canvas = root?.querySelector?.('[data-after-splash]');
  if (!canvas) return () => {};
  const gl = canvas.getContext?.('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return () => {};

  let active = true;
  let frameId;
  let targets = [];
  const resources = [];
  const pointer = { x: .5, y: .5, dx: 0, dy: 0, active: 0, movedAt: 0, color: 0 };

  try {
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, SPLASH_SHADER);
    const program = gl.createProgram();
    resources.push(vertex, fragment, program);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const buffer = gl.createBuffer();
    resources.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(
      ['previous', 'resolution', 'pointer', 'delta', 'color', 'radius', 'active', 'decay', 'time']
        .map((name) => [name, gl.getUniformLocation(program, `u_${name}`)]),
    );

    const resize = () => {
      const compact = canvas.clientWidth < 820;
      const scale = Math.min(Number(devicePixelRatio) || 1, compact ? 1 : 1.35);
      const width = Math.max(2, Math.round(canvas.clientWidth * scale));
      const height = Math.max(2, Math.round(canvas.clientHeight * scale));
      if (canvas.width === width && canvas.height === height) return;
      for (const target of targets) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      }
      canvas.width = width;
      canvas.height = height;
      const dyeWidth = compact ? Math.min(width, 512) : Math.min(width, 1024);
      const dyeHeight = Math.max(2, Math.round(dyeWidth * height / width));
      targets = [createTarget(gl, dyeWidth, dyeHeight), createTarget(gl, dyeWidth, dyeHeight)];
      gl.viewport(0, 0, dyeWidth, dyeHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[0].framebuffer);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1].framebuffer);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };

    const move = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const y = 1 - (event.clientY - rect.top) / Math.max(rect.height, 1);
      pointer.dx = Math.max(-.08, Math.min(.08, x - pointer.x));
      pointer.dy = Math.max(-.08, Math.min(.08, y - pointer.y));
      pointer.x = x;
      pointer.y = y;
      pointer.active = 1;
      pointer.movedAt = performance.now();
      pointer.color = (pointer.color + .008) % PALETTE.length;
    };
    const leave = () => { pointer.active = 0; };
    const pointerTarget = root?.querySelector?.('.after-view') ?? canvas;
    pointerTarget.addEventListener?.('pointermove', move, { passive: true });
    pointerTarget.addEventListener?.('pointerleave', leave, { passive: true });
    windowRef?.addEventListener?.('resize', resize, { passive: true });
    resize();

    let read = 0;
    const render = (time) => {
      if (!active) return;
      resize();
      if (time - pointer.movedAt > 90) pointer.active = 0;
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[write].framebuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[read].texture);
      gl.uniform1i(uniforms.previous, 0);
      gl.uniform2f(uniforms.resolution, targets[read].width ?? canvas.width, targets[read].height ?? canvas.height);
      gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
      gl.uniform2f(uniforms.delta, pointer.dx * 75, pointer.dy * 75);
      const base = Math.floor(pointer.color) % PALETTE.length;
      const next = (base + 1) % PALETTE.length;
      const mix = pointer.color - Math.floor(pointer.color);
      const color = PALETTE[base].map((value, index) => value * (1 - mix) + PALETTE[next][index] * mix);
      gl.uniform3fv(uniforms.color, color);
      gl.uniform1f(uniforms.radius, canvas.clientWidth < 820 ? .018 : .012);
      gl.uniform1f(uniforms.active, pointer.active);
      gl.uniform1f(uniforms.decay, canvas.clientWidth < 820 ? .974 : .982);
      gl.uniform1f(uniforms.time, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, targets[write].texture);
      gl.uniform1f(uniforms.active, 0);
      gl.uniform1f(uniforms.decay, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      read = write;
      pointer.dx *= .78;
      pointer.dy *= .78;
      frameId = requestFrame(render);
    };
    frameId = requestFrame(render);

    return () => {
      if (!active) return;
      active = false;
      pointerTarget.removeEventListener?.('pointermove', move);
      pointerTarget.removeEventListener?.('pointerleave', leave);
      windowRef?.removeEventListener?.('resize', resize);
      if (frameId !== undefined) cancelFrame(frameId);
      for (const target of targets) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      }
      for (const resource of resources) {
        if (resource === program) gl.deleteProgram(resource);
        else if (resource === buffer) gl.deleteBuffer(resource);
        else gl.deleteShader(resource);
      }
    };
  } catch {
    canvas.hidden = true;
    return () => {
      if (!active) return;
      active = false;
      if (frameId !== undefined) cancelFrame(frameId);
    };
  }
}
