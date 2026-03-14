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

function valueRows(rows) {
  return rows.map((r) => ({
    ...r,
    nibValue: r.qty * r.nibPriceGbp,
    usedValue: r.qty * r.usedPriceGbp,
    rrpValue: r.qty * r.rrpGbp,
    delta: r.qty * (r.nibPriceGbp - r.rrpGbp)
  }));
}

function renderKpis(rows) {
  const total = (k) => rows.reduce((sum, r) => sum + r[k], 0);
  const nib = total('nibValue');
  const used = total('usedValue');
  const rrp = total('rrpValue');
  const deltaNib = nib - rrp;
  const deltaUsed = used - rrp;

  const cards = [
    ['Portfolio value (NIB)', GBP.format(nib), 'New in box market total'],
    ['Portfolio value (Used)', GBP.format(used), 'Used market total'],
    ['Portfolio value (RRP baseline)', GBP.format(rrp), 'Retail baseline total'],
    ['Delta vs RRP (NIB)', GBP.format(deltaNib), deltaNib >= 0 ? 'Above baseline' : 'Below baseline'],
    ['Delta vs RRP (Used)', GBP.format(deltaUsed), deltaUsed >= 0 ? 'Above baseline' : 'Below baseline']
  ];

  byId('kpis').innerHTML = cards.map(([label, value, sub]) => `
    <article class="kpi">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="sub">${sub}</div>
    </article>
  `).join('');
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
  byId('freshness').textContent = `Data freshness: ${dt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

async function loadData() {
  const bust = `?v=${Date.now()}`;
  const data = await fetch(`data/portfolio.json${bust}`).then(r => r.json());
  state.generatedAt = data.generatedAt;
  state.assumptions = data.assumptions;
  state.rows = valueRows(data.items);

  updateFreshness();
  renderTable();
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
  await new Promise(r => setTimeout(r, 600));
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