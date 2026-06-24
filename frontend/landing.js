(function () {
  "use strict";

  const canvas = document.getElementById("bg");
  const pre = document.getElementById("shaderError");
  if (!canvas) return;

  // ─── Detección de mobile/low-end ────────────────────────────────────────────
  const isMobile =
    window.innerWidth < 768 ||
    window.matchMedia("(pointer: coarse)").matches ||
    navigator.hardwareConcurrency <= 4;

  // ─── Ruta mobile: gradiente animado vía canvas 2D ───────────────────────────
  // Sin WebGL. Cero iteraciones shader. Fluido en cualquier celular.
  if (isMobile) {
    const ctx = canvas.getContext("2d");
    if (!ctx) { canvas.style.display = "none"; return; }

    let raf = 0, running = false;
    const t0 = performance.now();

    function resizeMobile() {
      // DPR máximo 0.75 en mobile: suficiente resolución sin costo
      const dpr = Math.min(0.75, window.devicePixelRatio || 1);
      canvas.width  = Math.floor((canvas.clientWidth  || window.innerWidth)  * dpr);
      canvas.height = Math.floor((canvas.clientHeight || window.innerHeight) * dpr);
    }

    function frameMobile(now) {
      if (!running) return;
      const t = (now - t0) / 1000;
      const w = canvas.width, h = canvas.height;

      // Dos puntos focales que se mueven lentamente — coste O(1) por frame
      const x1 = w * (0.5 + 0.35 * Math.sin(t * 0.18));
      const y1 = h * (0.5 + 0.30 * Math.cos(t * 0.13));
      const x2 = w * (0.5 + 0.30 * Math.cos(t * 0.11));
      const y2 = h * (0.5 + 0.35 * Math.sin(t * 0.09));

      // Paleta dorada igual que el shader original (warmTint)
      const g1 = ctx.createRadialGradient(x1, y1, 0, x1, y1, Math.max(w, h) * 0.75);
      g1.addColorStop(0,   "rgba(40, 22, 4, 0.95)");
      g1.addColorStop(0.4, "rgba(20, 10, 2, 0.98)");
      g1.addColorStop(1,   "rgba(4,  2,  1, 1.0)");

      const g2 = ctx.createRadialGradient(x2, y2, 0, x2, y2, Math.max(w, h) * 0.60);
      g2.addColorStop(0,   "rgba(60, 34, 6, 0.5)");
      g2.addColorStop(0.5, "rgba(25, 14, 3, 0.3)");
      g2.addColorStop(1,   "rgba(0,  0,  0, 0)");

      ctx.fillStyle = "#060300";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(frameMobile);
    }

    function startMobile() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frameMobile);
    }
    function stopMobile() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resizeMobile, 150);
    }, { passive: true });
    resizeMobile();

    new IntersectionObserver(entries => {
      for (const e of entries) e.isIntersecting ? startMobile() : stopMobile();
    }, { threshold: 0 }).observe(canvas);

    document.addEventListener("visibilitychange", () =>
      document.hidden ? stopMobile() : startMobile()
    );

    startMobile();
    setupScrollFadeIn();
    setupStats();
    return; // ← fin ruta mobile
  }

  // ─── Ruta desktop: WebGL2 shader (iteraciones reducidas) ────────────────────
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false });
  if (!gl) {
    if (pre) pre.textContent = "WebGL2 no disponible";
    canvas.style.display = "none";
    setupScrollFadeIn();
    setupStats();
    return;
  }

  // Desktop: 8 iteraciones (era 50). Visual casi idéntico, 6× menos carga GPU.
  // DPR máximo 1.0 — no hay ganancia visible a 2× con este tipo de shader.
  const MAX_ITERATIONS = 8;
  const FPS_CAP        = 1000 / 60;
  const MAX_DPR        = 1.0;

  const vertSrc = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos,0.0,1.0); }`;

  const fragSrc = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2  u_res;
uniform float u_time;
uniform float u_iterations;

float tanh1(float x){ float e=exp(2.0*x); return(e-1.0)/(e+1.0); }
vec4  tanh4(vec4 v){ return vec4(tanh1(v.x),tanh1(v.y),tanh1(v.z),tanh1(v.w)); }

void main(){
  vec3 FC=vec3(gl_FragCoord.xy,0.0);
  vec3 r=vec3(u_res,max(u_res.x,u_res.y));
  float t=u_time;
  vec4 o=vec4(0.0);
  vec3 p=vec3(0.0);
  vec3 v=vec3(2.4,1.6,0.7);
  float i=0.0,z=1.0,d=1.0,f=1.0;
  float maxIter=u_iterations;
  for(;i++<maxIter;
      o.rgb+=(cos((p.x+z+v)*0.1)+1.0)/d/f/z){
    p=z*normalize(FC*2.0-r.xyy);
    vec4 m=cos((p+sin(p)).y*0.4+vec4(0.0,33.0,11.0,0.0));
    p.xz=mat2(m)*p.xz;
    p.x+=t/0.2;
    z+=(d=length(cos(p/v)*v+v.zxx/7.0)/
        (f=2.0+d/exp(p.y*0.2)));
  }
  o=tanh4(0.05*o);
  o.rgb*=vec3(1.05,0.86,0.55);
  o.a=1.0;
  fragColor=o;
}`;

  function compileShader(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(sh) || "compile error");
    return sh;
  }

  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl.VERTEX_SHADER,   vertSrc));
    gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog) || "link error");
  } catch (e) {
    if (pre) pre.textContent = "Shader error:\n" + e.message;
    canvas.style.display = "none";
    setupScrollFadeIn();
    setupStats();
    return;
  }

  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),
    gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const uRes  = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uIter = gl.getUniformLocation(prog, "u_iterations");
  gl.uniform1f(uIter, MAX_ITERATIONS);

  // Resize con debounce para no reenviar uniform en cada pixel de redimensionado
  let resizeTimer;
  function resize() {
    const dpr = Math.max(0.5, Math.min(MAX_DPR, window.devicePixelRatio || 1));
    const w = Math.floor((canvas.clientWidth  || window.innerWidth)  * dpr);
    const h = Math.floor((canvas.clientHeight || window.innerHeight) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  }
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  }, { passive: true });
  resize();

  let raf = 0, running = false;
  const t0 = performance.now();
  let lastFrameTime = 0;

  function frame(now) {
    if (!running) return;
    const elapsed = now - lastFrameTime;
    if (elapsed < FPS_CAP) { raf = requestAnimationFrame(frame); return; }
    lastFrameTime = now - (elapsed % FPS_CAP);
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

  new IntersectionObserver(entries => {
    for (const e of entries) e.isIntersecting ? startLoop() : stopLoop();
  }, { threshold: 0 }).observe(canvas);

  document.addEventListener("visibilitychange", () =>
    document.hidden ? stopLoop() : startLoop()
  );

  startLoop();
  setupScrollFadeIn();
  setupStats();

  // ─── Helpers compartidos ─────────────────────────────────────────────────────

  function setupScrollFadeIn() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        e.target.classList.add("visible");
        observer.unobserve(e.target);
      });
    }, { threshold: 0.3 });
    document.querySelectorAll(".fade-in").forEach(el => observer.observe(el));
  }

  function setupStats() {
    setupUltimaActualizacion();
    setupContadores();
  }
})();

// ─── Última actualización ────────────────────────────────────────────────────
function setupUltimaActualizacion() {
  const el = document.getElementById("ultimaActualizacion");
  if (!el) return;

  async function cargar() {
    try {
      const resp = await fetch(`${location.origin}/api/accidentes/stats`);
      const json = await resp.json();
      const fecha = new Date(json.ultimaActualizacion);
      const diffMin = Math.round((Date.now() - fecha) / 60000);
      let texto;
      if      (diffMin < 1)    texto = "hace instantes";
      else if (diffMin < 60)   texto = `hace ${diffMin} min`;
      else if (diffMin < 1440) texto = `hace ${Math.round(diffMin / 60)} h`;
      else texto = fecha.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" });
      el.textContent = `Actualizado ${texto}`;
    } catch {
      el.textContent = "";
    }
  }

  cargar();
  setInterval(cargar, 30000);
}

// ─── Contadores animados ─────────────────────────────────────────────────────
function setupContadores() {
  const featureListEl = document.querySelector(".feature-list");
  if (!featureListEl) return;

  function animateNumber(id, target) {
    const el = document.getElementById(id);
    if (!el || typeof target !== "number") { if (el) el.textContent = "—"; return; }
    const dur = 1200, start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round((1 - Math.pow(1 - p, 3)) * target).toLocaleString("es-PE");
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  new IntersectionObserver(entries => {
    entries.forEach(async e => {
      if (!e.isIntersecting) return;
      try {
        const json = await (await fetch(`${location.origin}/api/accidentes/stats`)).json();
        const total = json.reconcile?.sratmaListed ?? json.totalAccidentes;
        animateNumber("statTotal", total);
        animateNumber("statDepartamentos", json.totalDepartamentos);
      } catch {
        /* silencioso */
      }
    });
  }, { threshold: 0.3 }).observe(featureListEl);
}