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

  const isMobile = window.innerWidth < 768 || window.matchMedia("(pointer: coarse)").matches;
  const MAX_ITERATIONS = isMobile ? 8 : 50;
  const FPS_INTERVAL = 1000 / (isMobile ? 20 : 60);
  const MAX_DPR = isMobile ? 0.5 : 2;

  const vertSrc = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos,0.0,1.0); }`;

  /*
   * Paleta ajustada respecto al original:
   * - v controla el "color seed" del bucle (antes vec3(1.0, 2.0, 6.0), azul/morado/cian)
   *   ahora usa tonos calidos (dorado/ambar/marron oscuro) para que combine con --gold
   * - el factor final de tanh4 bajo de 0.2 a 0.05: esto reduce muchisimo el brillo
   *   general, dejando un fondo predominantemente negro con destellos sutiles
   * - se suma un pequeño sesgo de color (warmTint) para que el resplandor que se
   *   forma en una esquina del shader tienda a dorado en vez de cian
   */
  const fragSrc = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  u_res;
uniform float u_time;
uniform float u_iterations;

float tanh1(float x){ float e = exp(2.0*x); return (e-1.0)/(e+1.0); }
vec4 tanh4(vec4 v){ return vec4(tanh1(v.x), tanh1(v.y), tanh1(v.z), tanh1(v.w)); }

void main(){
  vec3 FC = vec3(gl_FragCoord.xy, 0.0);
  vec3 r  = vec3(u_res, max(u_res.x, u_res.y));
  float t = u_time;

  vec4 o = vec4(0.0);

  vec3 p = vec3(0.0);
  vec3 v = vec3(2.4, 1.6, 0.7);
  float i = 0.0, z = 1.0, d = 1.0, f = 1.0;

  float maxIter = u_iterations;
  for ( ; i++ < maxIter;
        o.rgb += (cos((p.x + z + v) * 0.1) + 1.0) / d / f / z )
  {
    p = z * normalize(FC * 2.0 - r.xyy);

    vec4 m = cos((p + sin(p)).y * 0.4 + vec4(0.0, 33.0, 11.0, 0.0));
    p.xz = mat2(m) * p.xz;

    p.x += t / 0.2;

    z += ( d = length(cos(p / v) * v + v.zxx / 7.0) /
           ( f = 2.0 + d / exp(p.y * 0.2) ) );
  }

  o = tanh4(0.05 * o);

  vec3 warmTint = vec3(1.05, 0.86, 0.55);
  o.rgb *= warmTint;

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
  const uIterations = gl.getUniformLocation(prog, "u_iterations");
  gl.uniform1f(uIterations, MAX_ITERATIONS);

  function resize() {
    const dpr = Math.max(0.5, Math.min(MAX_DPR, window.devicePixelRatio || 1));
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
  let running = false;
  const t0 = performance.now();
  let lastFrameTime = 0;

  function frame(now) {
    if (!running) return;
    const elapsed = now - lastFrameTime;
    if (elapsed < FPS_INTERVAL) {
      raf = requestAnimationFrame(frame);
      return;
    }
    lastFrameTime = now - (elapsed % FPS_INTERVAL);
    gl.uniform1f(uTime, (now - t0) / 1000);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    raf = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastFrameTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stopLoop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  const visObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) startLoop();
        else stopLoop();
      }
    },
    { threshold: 0 }
  );
  visObserver.observe(canvas);

  startLoop();

  /* ========== Fade-in al hacer scroll ========== */

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.3 }
  );

  document.querySelectorAll(".fade-in").forEach((el) => observer.observe(el));
})();

/* ========== Última actualización ========== */

async function cargarUltimaActualizacion() {
  const el = document.getElementById("ultimaActualizacion");
  if (!el) return;
  try {
    const resp = await fetch(`${location.origin}/api/accidentes/stats`);
    const json = await resp.json();
    const fecha = new Date(json.ultimaActualizacion);
    const ahora = new Date();
    const diffMin = Math.round((ahora - fecha) / 60000);
    let texto;
    if (diffMin < 1) texto = "hace instantes";
    else if (diffMin < 60) texto = `hace ${diffMin} min`;
    else if (diffMin < 1440) texto = `hace ${Math.round(diffMin / 60)} h`;
    else texto = fecha.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" });
    el.textContent = `Actualizado ${texto}`;
  } catch (e) {
    console.error("No se pudo cargar última actualización:", e.message);
    el.textContent = "";
  }
}
cargarUltimaActualizacion();
setInterval(cargarUltimaActualizacion, 30000); // refrescar cada 30s

/* ========== Contadores animados al hacer scroll ========== */

async function cargarStats() {
  try {
    const resp = await fetch(`${location.origin}/api/accidentes/stats`);
    const json = await resp.json();
    const total = json.reconcile?.sratmaListed != null ? json.reconcile.sratmaListed : json.totalAccidentes;
    animateNumber("statTotal", total);
    animateNumber("statDepartamentos", json.totalDepartamentos);
  } catch (e) {
    console.error("No se pudieron cargar las estadísticas:", e.message);
  }
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el || typeof target !== "number") { if (el) el.textContent = "—"; return; }
  const dur = 1200;
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(eased * target).toLocaleString("es-PE");
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    cargarStats();
    statsObserver.disconnect();
  });
}, { threshold: 0.3 });

const featureListEl = document.querySelector(".feature-list");
if (featureListEl) statsObserver.observe(featureListEl);