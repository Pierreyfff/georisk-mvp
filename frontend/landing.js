(function () {
  "use strict";

  const canvas = document.getElementById("bg");
  const pre = document.getElementById("shaderError");
  if (!canvas) return;

  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false });
  if (!gl) {
    if (pre) pre.textContent = "WebGL2 no disponible";
    canvas.style.display = "none";
    return;
  }

  const vertSrc = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos,0.0,1.0); }`;

  const fragSrc = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  u_res;
uniform float u_time;

float tanh1(float x){ float e = exp(2.0*x); return (e-1.0)/(e+1.0); }
vec4 tanh4(vec4 v){ return vec4(tanh1(v.x), tanh1(v.y), tanh1(v.z), tanh1(v.w)); }

void main(){
  vec3 FC = vec3(gl_FragCoord.xy, 0.0);
  vec3 r  = vec3(u_res, max(u_res.x, u_res.y));
  float t = u_time;

  vec4 o = vec4(0.0);

  vec3 p = vec3(0.0);
  vec3 v = vec3(1.0, 2.0, 6.0);
  float i = 0.0, z = 1.0, d = 1.0, f = 1.0;

  for ( ; i++ < 5e1;
        o.rgb += (cos((p.x + z + v) * 0.1) + 1.0) / d / f / z )
  {
    p = z * normalize(FC * 2.0 - r.xyy);

    vec4 m = cos((p + sin(p)).y * 0.4 + vec4(0.0, 33.0, 11.0, 0.0));
    p.xz = mat2(m) * p.xz;

    p.x += t / 0.2;

    z += ( d = length(cos(p / v) * v + v.zxx / 7.0) /
           ( f = 2.0 + d / exp(p.y * 0.2) ) );
  }

  o = tanh4(0.2 * o);
  o.a = 1.0;
  fragColor = o;
}`;

  function compileShader(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || "compile error");
    }
    return sh;
  }

  function linkProgram(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || "link error");
    }
    return p;
  }

  let prog;
  try {
    prog = linkProgram(vertSrc, fragSrc);
  } catch (e) {
    if (pre) pre.textContent = "Shader error:\n" + e.message;
    canvas.style.display = "none";
    return;
  }

  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.floor((canvas.clientWidth || window.innerWidth) * dpr);
    const h = Math.floor((canvas.clientHeight || window.innerHeight) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  }

  window.addEventListener("resize", resize, { passive: true });
  resize();

  let raf = 0;
  const t0 = performance.now();

  function frame(now) {
    const t = (now - t0) / 1000;
    gl.uniform1f(uTime, t);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  /* ========== Counter animation ========== */

  const counters = document.querySelectorAll("[data-count]");

  function animateCounter(el) {
    const target = parseInt(el.getAttribute("data-count"), 10);
    if (!target || target === 0) {
      el.textContent = "0";
      return;
    }
    const dur = 1500;
    const start = performance.now();

    function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("visible");
        const num = entry.target.querySelector("[data-count]");
        if (num && !num.dataset.counted) {
          num.dataset.counted = "1";
          animateCounter(num);
        }
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.3 }
  );

  document.querySelectorAll(".fade-in").forEach((el) => observer.observe(el));
})();
