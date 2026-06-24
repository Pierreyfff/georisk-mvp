/* ===== Dashboard - GeoRisk Analytics ===== */

const API = `${location.origin}/api`;

// ─── State ────────────────────────────────────────────────────
let allData = [];
let filteredData = [];
let allDistritos = [];
let charts = {};
let loading = false;

const filters = {
  departamento: '',
  provincia: '',
  distrito: '',
  gravedad: '',
  desde: '',
  hasta: '',
};

// ─── DOM refs ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const el = {
  dept: $('filterDept'),
  prov: $('filterProv'),
  dist: $('filterDist'),
  grav: $('filterGrav'),
  desde: $('filterFrom'),
  hasta: $('filterTo'),
  clearBtn: $('clearFilters'),
  sidebar: $('sidebar'),
  sidebarToggle: $('sidebarToggle'),
  loadingOverlay: $('loadingOverlay'),
  kpiTotal: $('kpiTotal'),
  kpiVerified: $('kpiVerified'),
  kpiBaja: $('kpiBaja'),
  kpiAlta: $('kpiAlta'),
  tabs: document.querySelectorAll('#tabs button'),
  panels: {
    resumen: $('panelResumen'),
    analisis: $('panelAnalisis'),
    resultados: $('panelResultados'),
  },
  tableBody: $('tableBody'),
};

// ─── Chart.js defaults ────────────────────────────────────────
Chart.defaults.color = '#a09080';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";

const COLORS = {
  gold: '#e9c073',
  green: '#2ecc71',
  yellow: '#f1c40f',
  red: '#e74c3c',
  blue: '#3a7bd5',
  purple: '#8a4fc9',
  cyan: '#22b8c8',
  text: '#eef0f5',
  muted: 'rgba(238,240,245,0.4)',
  border: 'rgba(255,255,255,0.1)',
};

const GRAV_COLORS = { Baja: COLORS.green, Media: COLORS.yellow, Alta: COLORS.red };
const PALETTE = [COLORS.gold, COLORS.blue, COLORS.purple, COLORS.cyan, COLORS.green, '#d18a3a', '#c084fc', '#34d399', '#f472b6', '#fb923c'];

// ─── Distritos loading ────────────────────────────────────────
async function loadDistritos() {
  try {
    const resp = await fetch(`${API}/distritos?limit=2000`);
    const json = await resp.json();
    allDistritos = Array.isArray(json.data) ? json.data : [];
    populateDeptSelect();
  } catch (e) {
    console.error('Error loading distritos:', e.message);
  }
}

function getDepts() {
  const set = new Set();
  for (const d of allDistritos) {
    if (d.departamento) set.add(d.departamento);
  }
  return [...set].sort();
}

function getProvs(dept) {
  const set = new Set();
  for (const d of allDistritos) {
    if (d.departamento === dept && d.provincia) set.add(d.provincia);
  }
  return [...set].sort();
}

function getDists(dept, prov) {
  const set = new Set();
  for (const d of allDistritos) {
    if ((!dept || d.departamento === dept) && (!prov || d.provincia === prov) && d.distrito) set.add(d.distrito);
  }
  return [...set].sort();
}

function populateDeptSelect() {
  const depts = getDepts();
  el.dept.innerHTML = '<option value="">Todos</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
  el.dept.disabled = false;
}

function populateProvSelect(dept) {
  el.prov.innerHTML = '<option value="">Todas</option>';
  el.prov.disabled = !dept;
  if (!dept) return;
  const provs = getProvs(dept);
  el.prov.innerHTML += provs.map(p => `<option value="${p}">${p}</option>`).join('');
}

function populateDistSelect(dept, prov) {
  el.dist.innerHTML = '<option value="">Todos</option>';
  el.dist.disabled = !prov && !dept;
  if (!dept && !prov) return;
  const dists = getDists(dept, prov);
  el.dist.innerHTML += dists.map(d => `<option value="${d}">${d}</option>`).join('');
}

// ─── Data loading ─────────────────────────────────────────────
async function loadData() {
  loading = true;
  el.loadingOverlay.style.display = 'flex';

  try {
    const params = new URLSearchParams();
    params.set('verified', 'true');

    const [filtResp, statsResp] = await Promise.all([
      fetch(`${API}/accidentes/filtrados?${params}`),
      fetch(`${API}/accidentes/stats`),
    ]);

    const filtJson = await filtResp.json();
    if (!filtResp.ok) throw new Error(filtJson?.error || `HTTP ${filtResp.status}`);

    const stats = statsResp.ok ? await statsResp.json() : null;

    allData = filtJson.data || [];
    applyClientFilters();
    updateKPIs(stats);
    buildAllCharts();
  } catch (e) {
    console.error('Error loading data:', e.message);
    showError(e.message);
  } finally {
    loading = false;
    el.loadingOverlay.style.display = 'none';
  }
}

function showError(msg) {
  const area = $('chartsArea');
  const existing = area.querySelector('.error-overlay');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = 'error-overlay';
  div.innerHTML = `<span>${msg}</span><button class="btn-retry">Reintentar</button>`;
  div.querySelector('.btn-retry').onclick = () => { div.remove(); loadData(); };
  area.appendChild(div);
}

// ─── Filtering ────────────────────────────────────────────────
function applyClientFilters() {
  filteredData = allData.filter(a => {
    if (filters.gravedad && a.gravedad !== filters.gravedad) return false;
    if (filters.distrito) {
      const dn = (a.distrito || '').trim().toLowerCase();
      if (dn !== filters.distrito.trim().toLowerCase()) return false;
    }
    if (filters.departamento && !filters.distrito) {
      const dep = a.departamento || a.raw?.departamento || '';
      if (dep !== filters.departamento) return false;
    }
    if (filters.provincia && !filters.distrito) {
      const prov = a.provincia || a.raw?.provincia || '';
      if (prov !== filters.provincia) return false;
    }
    if (filters.desde && a.fecha && a.fecha < filters.desde) return false;
    if (filters.hasta && a.fecha && a.fecha > filters.hasta) return false;
    return true;
  });
}

function updateKPIs(stats) {
  const s = stats || {};
  const r = s.reconcile || {};
  el.kpiTotal.textContent = r.sratmaListed != null ? r.sratmaListed.toLocaleString() : '—';
  el.kpiVerified.textContent = r.verifiedDbTotal != null ? r.verifiedDbTotal.toLocaleString() : '—';

  const pg = s.porGravedad || filteredData.reduce((acc, a) => {
    acc[a.gravedad] = (acc[a.gravedad] || 0) + 1;
    return acc;
  }, {});
  el.kpiBaja.textContent = (pg.Baja || 0).toLocaleString();
  el.kpiAlta.textContent = (pg.Alta || 0).toLocaleString();
}

function readFilters() {
  filters.departamento = el.dept.value;
  filters.provincia = el.prov.value;
  filters.distrito = el.dist.value;
  filters.gravedad = el.grav.value;
  filters.desde = el.desde.value;
  filters.hasta = el.hasta.value;
}

// ─── Chart builders ───────────────────────────────────────────
function destroyCharts() {
  for (const key of Object.keys(charts)) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }
}

function buildAllCharts() {
  destroyCharts();
  buildSeveridad();
  buildTipos();
  buildTendencia();
  buildDeptos();
  buildAnalisisDeptos();
  buildSeveridadDeptos();
  buildHora();
  buildPromedio();
  buildTable();
}

function buildSeveridad() {
  const ctx = document.getElementById('chartSeveridad')?.getContext('2d');
  if (!ctx) return;
  const counts = { Baja: 0, Media: 0, Alta: 0 };
  for (const a of filteredData) { if (counts[a.gravedad] !== undefined) counts[a.gravedad]++; }

  charts.severidad = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Baja', 'Media', 'Alta'],
      datasets: [{
        data: [counts.Baja, counts.Media, counts.Alta],
        backgroundColor: [COLORS.green, COLORS.yellow, COLORS.red],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 8, usePointStyle: true, pointStyleWidth: 8, font: { size: 10 } },
        },
      },
    },
  });
}

function buildTipos() {
  const ctx = document.getElementById('chartTipos')?.getContext('2d');
  if (!ctx) return;
  const counts = {};
  for (const a of filteredData) {
    const t = a.tipo || 'Desconocido';
    counts[t] = (counts[t] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const labels = sorted.map(s => s[0]);
  const values = sorted.map(s => s[1]);

  charts.tipos = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Accidentes',
        data: values,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: COLORS.border }, ticks: { font: { size: 9 } } },
        y: { grid: { display: false }, ticks: { font: { size: 9 } } },
      },
    },
  });
}

function buildTendencia() {
  const ctx = document.getElementById('chartTendencia')?.getContext('2d');
  if (!ctx) return;
  const counts = {};
  for (const a of filteredData) {
    if (a.fecha) counts[a.fecha] = (counts[a.fecha] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(s => s[0].slice(5));
  const values = sorted.map(s => s[1]);

  charts.tendencia = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Accidentes',
        data: values,
        borderColor: COLORS.gold,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 300);
          g.addColorStop(0, 'rgba(233,192,115,0.25)');
          g.addColorStop(1, 'rgba(233,192,115,0)');
          return g;
        },
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 8 }, maxTicksLimit: 10 } },
        y: { beginAtZero: true, grid: { color: COLORS.border }, ticks: { font: { size: 8 }, stepSize: 1 } },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}

function buildDeptos() {
  const ctx = document.getElementById('chartDeptos')?.getContext('2d');
  if (!ctx) return;
  const counts = {};
  for (const a of filteredData) {
    const d = a.departamento || a.raw?.departamento || 'Desconocido';
    counts[d] = (counts[d] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const labels = sorted.map(s => s[0]);
  const values = sorted.map(s => s[1]);

  charts.deptos = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Accidentes',
        data: values,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 8 } } },
        y: { beginAtZero: true, grid: { color: COLORS.border }, ticks: { font: { size: 8 } } },
      },
    },
  });
}

function buildAnalisisDeptos() {
  const ctx = document.getElementById('chartAnalisisDeptos')?.getContext('2d');
  if (!ctx) return;
  const counts = {};
  for (const a of filteredData) {
    const d = a.departamento || a.raw?.departamento || 'Desconocido';
    counts[d] = (counts[d] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(s => s[0]);
  const values = sorted.map(s => s[1]);

  charts.analisisDeptos = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Accidentes',
        data: values,
        backgroundColor: COLORS.blue,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 8 } } },
        y: { beginAtZero: true, grid: { color: COLORS.border }, ticks: { font: { size: 8 } } },
      },
    },
  });
}

function buildSeveridadDeptos() {
  const ctx = document.getElementById('chartSeveridadDeptos')?.getContext('2d');
  if (!ctx) return;
  const deptos = {};
  for (const a of filteredData) {
    const d = a.departamento || a.raw?.departamento || 'Desconocido';
    if (!deptos[d]) deptos[d] = { Baja: 0, Media: 0, Alta: 0 };
    if (deptos[d][a.gravedad] !== undefined) deptos[d][a.gravedad]++;
  }
  const sorted = Object.entries(deptos).sort((a, b) => {
    const totalA = a[1].Baja + a[1].Media + a[1].Alta;
    const totalB = b[1].Baja + b[1].Media + b[1].Alta;
    return totalB - totalA;
  }).slice(0, 8);
  const labels = sorted.map(s => s[0]);

  charts.severidadDeptos = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Baja', data: sorted.map(s => s[1].Baja), backgroundColor: COLORS.green, borderRadius: 2 },
        { label: 'Media', data: sorted.map(s => s[1].Media), backgroundColor: COLORS.yellow, borderRadius: 2 },
        { label: 'Alta', data: sorted.map(s => s[1].Alta), backgroundColor: COLORS.red, borderRadius: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 6, usePointStyle: true, pointStyleWidth: 8, font: { size: 9 } } },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 8 } } },
        y: { stacked: true, beginAtZero: true, grid: { color: COLORS.border }, ticks: { font: { size: 8 } } },
      },
    },
  });
}

function buildHora() {
  const ctx = document.getElementById('chartHora')?.getContext('2d');
  if (!ctx) return;
  const slots = Array(24).fill(0);
  for (const a of filteredData) {
    if (a.hora) {
      const h = parseInt(a.hora.split(':')[0], 10);
      if (!isNaN(h) && h >= 0 && h < 24) slots[h]++;
    }
  }
  const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

  charts.hora = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Accidentes',
        data: slots,
        backgroundColor: slots.map(v => v > 0 ? COLORS.purple : 'transparent'),
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 8 }, maxTicksLimit: 12 } },
        y: { beginAtZero: true, grid: { color: COLORS.border }, ticks: { font: { size: 8 } } },
      },
    },
  });
}

function buildPromedio() {
  const ctx = document.getElementById('chartPromedio')?.getContext('2d');
  if (!ctx) return;
  const dias = {};
  for (const a of filteredData) {
    if (a.fecha) {
      if (!dias[a.fecha]) dias[a.fecha] = { total: 0, suma: 0 };
      dias[a.fecha].total++;
      const score = a.gravedad === 'Baja' ? 1 : a.gravedad === 'Media' ? 2 : 3;
      dias[a.fecha].suma += score;
    }
  }
  const sorted = Object.entries(dias).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(s => s[0].slice(5));
  const values = sorted.map(s => +(s[1].suma / s[1].total).toFixed(1));

  charts.promedio = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Promedio',
        data: values,
        borderColor: COLORS.cyan,
        backgroundColor: 'rgba(34,184,200,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 8 }, maxTicksLimit: 10 } },
        y: { min: 1, max: 3, grid: { color: COLORS.border }, ticks: { font: { size: 8 }, callback: v => v === 1 ? 'Baja' : v === 2 ? 'Media' : 'Alta' } },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}

function buildTable() {
  if (!el.tableBody) return;
  const data = filteredData.slice(0, 500);
  el.tableBody.innerHTML = data.map((a, i) => {
    const sevClass = a.gravedad === 'Baja' ? 'sev-baja' : a.gravedad === 'Media' ? 'sev-media' : 'sev-alta';
    return `<tr>
      <td>${i + 1}</td>
      <td>${a.fecha || '—'}</td>
      <td>${a.hora ? a.hora.slice(0, 5) : '—'}</td>
      <td>${a.distrito || '—'}</td>
      <td>${a.departamento || a.raw?.departamento || '—'}</td>
      <td>${a.tipo || '—'}</td>
      <td><span class="sev-badge ${sevClass}">${a.gravedad}</span></td>
      <td>${a.fallecidos ?? '—'}</td>
      <td>${a.lesionados ?? '—'}</td>
    </tr>`;
  }).join('');
}

// ─── Rebuild after filter change ──────────────────────────────
function onFilterChange() {
  readFilters();
  populateProvSelect(filters.departamento);
  populateDistSelect(filters.departamento, filters.provincia);
  applyClientFilters();
  updateKPIs(null);
  buildAllCharts();
}

// ─── Init ─────────────────────────────────────────────────────
function init() {
  // Filter events
  el.dept.addEventListener('change', () => {
    el.prov.value = '';
    el.dist.value = '';
    onFilterChange();
  });
  el.prov.addEventListener('change', () => {
    el.dist.value = '';
    onFilterChange();
  });
  el.grav.addEventListener('change', onFilterChange);
  el.dist.addEventListener('change', onFilterChange);
  el.desde.addEventListener('change', onFilterChange);
  el.hasta.addEventListener('change', onFilterChange);

  el.clearBtn.addEventListener('click', () => {
    el.dept.value = '';
    el.prov.value = '';
    el.dist.value = '';
    el.grav.value = '';
    el.desde.value = '';
    el.hasta.value = '';
    el.prov.disabled = true;
    el.dist.disabled = true;
    onFilterChange();
  });

  // Sidebar toggle (mobile)
  el.sidebarToggle.addEventListener('click', () => {
    el.sidebar.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && el.sidebar.classList.contains('open') &&
        !el.sidebar.contains(e.target) && !el.sidebarToggle.contains(e.target)) {
      el.sidebar.classList.remove('open');
    }
  });

  // Tabs
  el.tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      el.tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.values(el.panels).forEach(p => p.classList.remove('active'));
      const panel = el.panels[btn.dataset.tab];
      if (panel) panel.classList.add('active');
      // Rebuild table only when switching to resultados
      if (btn.dataset.tab === 'resultados') buildTable();
    });
  });

  // Load
  loadDistritos();
  loadData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
