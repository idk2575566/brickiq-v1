const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 });

let state = {
  rows: [],
  sortKey: 'nibValue',
  sortDir: 'desc',
  search: '',
  filter: 'all',
  generatedAt: null,
  assumptions: []
};

const byId = (id) => document.getElementById(id);
const SNAPSHOT_KEY = 'brickiq:lastSnapshot';

function valueRows(rows) {
  return rows.map((r) => ({
    ...r,
    nibValue: r.qty * r.nibPriceGbp,
    usedValue: r.qty * r.usedPriceGbp,
    rrpValue: r.qty * r.rrpGbp,
    delta: r.qty * (r.nibPriceGbp - r.rrpGbp)
  }));
}

function total(rows, key) {
  return rows.reduce((sum, r) => sum + (r[key] || 0), 0);
}

function imageUrlForSet(setNumber) {
  return `https://images.brickset.com/sets/images/${encodeURIComponent(setNumber)}.jpg`;
}

function placeholderImage(setNumber) {
  const safeSet = String(setNumber || 'LEGO');
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='600' height='450'>
      <defs>
        <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='#233252'/>
          <stop offset='100%' stop-color='#4f7cc9'/>
        </linearGradient>
      </defs>
      <rect width='100%' height='100%' fill='url(#g)'/>
      <g fill='none' stroke='rgba(255,255,255,0.25)'>
        <rect x='34' y='34' width='532' height='382' rx='22'/>
      </g>
      <text x='50%' y='47%' fill='white' font-size='48' text-anchor='middle' font-family='Inter,Arial,sans-serif' font-weight='700'>Set ${safeSet}</text>
      <text x='50%' y='57%' fill='rgba(255,255,255,0.8)' font-size='24' text-anchor='middle' font-family='Inter,Arial,sans-serif'>Image pending catalog match</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function renderKpis(rows) {
  const nib = total(rows, 'nibValue');
  const used = total(rows, 'usedValue');
  const rrp = total(rows, 'rrpValue');
  const deltaNib = nib - rrp;
  const deltaUsed = used - rrp;

  const cards = [
    ['Portfolio value (NIB)', GBP.format(nib), 'Boxed market estimate'],
    ['Portfolio value (Used)', GBP.format(used), 'Opened market estimate'],
    ['Portfolio value (RRP baseline)', GBP.format(rrp), 'Retail baseline'],
    ['Delta vs RRP (NIB)', GBP.format(deltaNib), deltaNib >= 0 ? 'Ahead of baseline' : 'Below baseline'],
    ['Delta vs RRP (Used)', GBP.format(deltaUsed), deltaUsed >= 0 ? 'Ahead of baseline' : 'Below baseline']
  ];

  byId('kpis').innerHTML = cards.map(([label, value, sub]) => `
    <article class="kpi">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="sub">${sub}</div>
    </article>
  `).join('');
}

function renderConfidence(rows) {
  const fields = [
    { key: 'nib', label: 'NIB confidence', pick: (r) => r.estimated?.nib },
    { key: 'used', label: 'Used confidence', pick: (r) => r.estimated?.used },
    { key: 'rrp', label: 'RRP confidence', pick: (r) => r.estimated?.rrp }
  ];

  byId('confidenceBars').innerHTML = fields.map((f) => {
    const estimatedCount = rows.filter((r) => f.pick(r)).length;
    const exactCount = rows.length - estimatedCount;
    const confidencePct = rows.length ? Math.round((exactCount / rows.length) * 100) : 100;
    return `
      <div class="bar-row">
        <div class="bar-label"><span>${f.label}</span><strong>${confidencePct}% exact</strong></div>
        <div class="bar-track"><div class="bar-fill" style="width:${confidencePct}%"></div></div>
      </div>
    `;
  }).join('');
}

function filteredSortedRows() {
  let rows = [...state.rows];
  if (state.search) {
    const q = state.search.toLowerCase();
    rows = rows.filter(r => `${r.setNumber} ${r.name} ${r.theme}`.toLowerCase().includes(q));
  }
  if (state.filter === 'estimated') {
    rows = rows.filter(r => r.estimated.nib || r.estimated.used || r.estimated.rrp);
  }

  rows.sort((a, b) => {
    const av = a[state.sortKey];
    const bv = b[state.sortKey];
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return state.sortDir === 'asc' ? cmp : -cmp;
  });
  return rows;
}

function renderTable() {
  const rows = filteredSortedRows();
  const tbody = document.querySelector('#setsTable tbody');
  tbody.innerHTML = rows.map((r) => {
    const estNib = r.estimated.nib ? '<span class="est">est.</span>' : '';
    const estUsed = r.estimated.used ? '<span class="est">est.</span>' : '';
    const estRrp = r.estimated.rrp ? '<span class="est">est.</span>' : '';
    return `
      <tr>
        <td>${r.setNumber}</td>
        <td>${r.name}</td>
        <td>${r.qty}</td>
        <td>${GBP.format(r.nibPriceGbp)}${estNib}</td>
        <td>${GBP.format(r.usedPriceGbp)}${estUsed}</td>
        <td>${GBP.format(r.rrpGbp)}${estRrp}</td>
        <td>${GBP.format(r.nibValue)}</td>
        <td>${GBP.format(r.usedValue)}</td>
        <td>${GBP.format(r.rrpValue)}</td>
        <td class="${r.delta >= 0 ? 'delta-plus' : 'delta-minus'}">${GBP.format(r.delta)}</td>
      </tr>
    `;
  }).join('');
  renderKpis(rows);
}

function updateFreshness() {
  const dt = new Date(state.generatedAt);
  byId('freshness').textContent = `Snapshot freshness: ${dt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function renderGallery(rows) {
  const top = [...rows]
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 8);

  byId('galleryRail').innerHTML = top.map((r) => {
    const fallback = placeholderImage(r.setNumber);
    return `
    <article class="story-card">
      <img loading="lazy" src="${imageUrlForSet(r.setNumber)}" alt="LEGO set ${r.setNumber}: ${r.name}" onerror="this.onerror=null;this.src='${fallback}';" />
      <div class="story-meta">
        <p class="title">${r.name}</p>
        <p class="set">Set ${r.setNumber} · Qty ${r.qty}</p>
        <p class="delta">Momentum ${GBP.format(r.delta)} vs RRP</p>
      </div>
    </article>
  `;
  }).join('');
}

function safeLoadPreviousSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeSaveSnapshot(payload) {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload)); } catch {}
}

function renderSnapshotChanges(rows) {
  const now = {
    generatedAt: state.generatedAt,
    setCount: rows.length,
    nib: total(rows, 'nibValue'),
    used: total(rows, 'usedValue'),
    estimatedRows: rows.filter((r) => r.estimated.nib || r.estimated.used || r.estimated.rrp).length
  };

  const prev = safeLoadPreviousSnapshot();
  let items;

  if (!prev) {
    items = [
      ['Previous snapshot', 'No previous local snapshot yet'],
      ['Set coverage', `${now.setCount} sets tracked`],
      ['Estimated rows', `${now.estimatedRows} rows contain estimates`]
    ];
  } else {
    const pct = prev.nib ? (((now.nib - prev.nib) / prev.nib) * 100).toFixed(1) : '0.0';
    items = [
      ['Snapshot transition', `${new Date(prev.generatedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} → ${new Date(now.generatedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`],
      ['NIB portfolio move', `${GBP.format(now.nib - prev.nib)} (${pct}%)`],
      ['Used portfolio move', `${GBP.format(now.used - prev.used)}`],
      ['Set count change', `${now.setCount - prev.setCount >= 0 ? '+' : ''}${now.setCount - prev.setCount}`],
      ['Estimate row change', `${now.estimatedRows - prev.estimatedRows >= 0 ? '+' : ''}${now.estimatedRows - prev.estimatedRows}`]
    ];
  }

  byId('changesList').innerHTML = items.map(([label, value]) => `
    <div class="change-item">
      <span class="change-label">${label}</span>
      <span class="change-value">${value}</span>
    </div>
  `).join('');

  safeSaveSnapshot(now);
}

async function loadData() {
  const bust = `?v=${Date.now()}`;
  const data = await fetch(`data/portfolio.json${bust}`).then(r => r.json());
  state.generatedAt = data.generatedAt;
  state.assumptions = data.assumptions;
  state.rows = valueRows(data.items);

  updateFreshness();
  renderTable();
  renderGallery(state.rows);
  renderConfidence(state.rows);
  renderSnapshotChanges(state.rows);
}

byId('searchInput').addEventListener('input', (e) => {
  state.search = e.target.value.trim();
  renderTable();
});

byId('filterSelect').addEventListener('change', (e) => {
  state.filter = e.target.value;
  renderTable();
});

byId('refreshBtn').addEventListener('click', async () => {
  byId('refreshBtn').textContent = 'Refreshing...';
  await new Promise(r => setTimeout(r, 450));
  await loadData();
  byId('refreshBtn').textContent = 'Refresh valuations';
});

document.querySelectorAll('#setsTable th').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortKey = key; state.sortDir = 'desc'; }
    renderTable();
  });
});

loadData();
