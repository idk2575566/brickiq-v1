const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 });

let state = {
  rows: [],
  sortKey: 'marketValue',
  sortDir: 'desc',
  hasBrickEconomyData: false,
  hasBrickLinkData: false,
  marketSource: 'auto',
  search: '',
  filters: {
    ownership: 'all',
    confidence: 'all',
    valueBand: 'all',
    theme: 'all'
  },
  generatedAt: null,
  assumptions: [],
  watchlist: [],
  selectedSet: null,
  isLoading: true,
  pagination: {
    page: 1,
    pageSize: 50
  }
};

const byId = (id) => document.getElementById(id);
const SNAPSHOT_KEY = 'brickiq:lastSnapshot';
const WATCHLIST_KEY = 'brickiq:watchlist';

const BRICKECONOMY_UNIT_KEYS = [
  'brickEconomyEstimateGbp',
  'brickEconomyValueGbp',
  'brickEconomyPriceGbp',
  'brickEconomyEstimate',
  'brickEconomyValue',
  'brickEconomyPrice',
  'brickeconomyEstimateGbp',
  'brickeconomyValueGbp',
  'brickeconomyPriceGbp',
  'brickeconomyEstimate',
  'brickeconomyValue',
  'brickeconomyPrice'
];

function toNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickFirstNumber(obj, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const parsed = toNumberOrNull(obj[key]);
      if (parsed != null) return { key, value: parsed };
    }
  }
  return null;
}

function extractBrickEconomy(row) {
  const unit = pickFirstNumber(row, BRICKECONOMY_UNIT_KEYS);
  if (!unit) return { available: false, unit: null, total: null, source: null };
  return {
    available: true,
    unit: unit.value,
    total: (toNumberOrNull(row.qty) || 0) * unit.value,
    source: unit.key
  };
}

function extractBrickLink(row) {
  const unit = toNumberOrNull(row.bricklinkAvgSoldGbp) ?? toNumberOrNull(row.bricklinkAvgSold);
  if (unit == null) return { available: false, unit: null, total: null };
  return {
    available: true,
    unit,
    total: (toNumberOrNull(row.qty) || 0) * unit
  };
}

function resolveMarket(be, bl) {
  if (state.marketSource === 'brickeconomy') {
    return be.available ? { unit: be.unit, total: be.total, source: 'BrickEconomy' } : { unit: null, total: null, source: 'BrickEconomy' };
  }
  if (state.marketSource === 'bricklink') {
    return bl.available ? { unit: bl.unit, total: bl.total, source: 'BrickLink' } : { unit: null, total: null, source: 'BrickLink' };
  }
  if (be.available) return { unit: be.unit, total: be.total, source: 'BrickEconomy' };
  if (bl.available) return { unit: bl.unit, total: bl.total, source: 'BrickLink' };
  return { unit: null, total: null, source: null };
}

function valueRows(rows) {
  return rows.map((r) => {
    const be = extractBrickEconomy(r);
    const bl = extractBrickLink(r);
    const market = resolveMarket(be, bl);
    return {
      ...r,
      nibValue: r.qty * r.nibPriceGbp,
      usedValue: r.qty * r.usedPriceGbp,
      rrpValue: r.qty * r.rrpGbp,
      delta: r.qty * (r.nibPriceGbp - r.rrpGbp),
      hasBrickEconomy: be.available,
      hasBrickLink: bl.available,
      brickEconomyUnitGbp: be.unit,
      brickEconomyValue: be.total,
      brickEconomySource: be.source,
      brickLinkUnitGbp: bl.unit,
      brickLinkValue: bl.total,
      marketSource: market.source,
      marketUnit: market.unit,
      marketValue: market.total
    };
  });
}

const total = (rows, key) => rows.reduce((sum, r) => sum + (r[key] || 0), 0);

const imageUrlForSet = (setNumber) => `https://images.brickset.com/sets/images/${encodeURIComponent(setNumber)}.jpg`;

const THEME_BADGE_META = {
  all: { label: 'All', palette: ['#4f46e5', '#22d3ee'] },
  'star wars': { label: 'Star', palette: ['#0f172a', '#334155'] },
  'marvel super heroes': { label: 'Hero', palette: ['#991b1b', '#ef4444'] },
  'dc comics super heroes': { label: 'Hero', palette: ['#1d4ed8', '#38bdf8'] },
  ninjago: { label: 'Ninja', palette: ['#14532d', '#22c55e'] },
  city: { label: 'City', palette: ['#1e3a8a', '#60a5fa'] },
  creator: { label: 'Create', palette: ['#7c3aed', '#a78bfa'] },
  creators: { label: 'Create', palette: ['#7c3aed', '#a78bfa'] },
  ideas: { label: 'Ideas', palette: ['#0f766e', '#2dd4bf'] },
  architecture: { label: 'Arch', palette: ['#374151', '#9ca3af'] },
  technic: { label: 'Tech', palette: ['#7f1d1d', '#fb7185'] },
  speed: { label: 'Speed', palette: ['#9a3412', '#fb923c'] },
  friends: { label: 'Friends', palette: ['#be185d', '#f472b6'] },
  icons: { label: 'Icons', palette: ['#0f766e', '#67e8f9'] },
  creator3in1: { label: '3in1', palette: ['#6d28d9', '#22d3ee'] },
  disney: { label: 'Disney', palette: ['#1d4ed8', '#60a5fa'] },
  harrypotter: { label: 'Wizard', palette: ['#6b21a8', '#c084fc'] },
  minecraft: { label: 'Craft', palette: ['#14532d', '#86efac'] },
  'the lord of the rings': { label: 'Fantasy', palette: ['#4d7c0f', '#a3e635'] },
  'pirates of the caribbean': { label: 'Pirates', palette: ['#7c2d12', '#fb923c'] }
};

function normalizeTheme(theme) {
  return String(theme || 'Unknown').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function themeBadgeSpec(theme) {
  const normalized = normalizeTheme(theme);
  const compact = normalized.replace(/\s+/g, '');
  const known = THEME_BADGE_META[normalized] || THEME_BADGE_META[compact];
  if (known) return known;

  const words = String(theme || 'Theme').split(/\s+/).filter(Boolean).slice(0, 2);
  const label = words.length > 1 ? words.map((w) => w[0]).join('').toUpperCase() : words.join('').slice(0, 6);
  return { label, palette: ['#334155', '#64748b'] };
}

function themeBadgeDataUrl(theme, small = false) {
  const spec = themeBadgeSpec(theme);
  const [c1, c2] = spec.palette;
  const w = small ? 96 : 136;
  const h = small ? 28 : 38;
  const fs = small ? 13 : 15;
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>
      <defs>
        <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='${c1}'/>
          <stop offset='100%' stop-color='${c2}'/>
        </linearGradient>
      </defs>
      <rect x='1' y='1' width='${w - 2}' height='${h - 2}' rx='${small ? 12 : 15}' fill='url(#g)' stroke='rgba(255,255,255,0.45)'/>
      <circle cx='${small ? 14 : 18}' cy='${h / 2}' r='${small ? 3.5 : 4}' fill='rgba(255,255,255,0.9)'/>
      <text x='${small ? 24 : 30}' y='${small ? 18 : 24}' fill='white' font-size='${fs}' font-family='Poppins,Inter,Arial,sans-serif' font-weight='700' letter-spacing='.4'>${spec.label}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
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
      <text x='50%' y='47%' fill='white' font-size='48' text-anchor='middle' font-family='Poppins,Inter,Arial,sans-serif' font-weight='700'>Set ${safeSet}</text>
      <text x='50%' y='57%' fill='rgba(255,255,255,0.8)' font-size='24' text-anchor='middle' font-family='Poppins,Inter,Arial,sans-serif'>Image pending catalog match</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function safeLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSave(key, payload) {
  try { localStorage.setItem(key, JSON.stringify(payload)); } catch {}
}

const isWatchlisted = (setNumber) => state.watchlist.includes(String(setNumber));

function ownershipLabel(row) {
  if (row.ownershipStatus === 'both') return 'Owned + Wishlist';
  if (row.ownershipStatus === 'wishlist') return 'Wishlist';
  if (row.ownershipStatus === 'owned') return 'Owned';
  return 'Unknown';
}

function isEstimatedRow(row) {
  return row.estimated?.nib || row.estimated?.used || row.estimated?.rrp;
}

function matchValueBand(row, band) {
  const value = Number.isFinite(row.marketValue) ? row.marketValue : null;
  if (band === 'all') return true;
  if (value == null) return false;
  if (band === 'low') return value < 200;
  if (band === 'mid') return value >= 200 && value <= 1000;
  if (band === 'high') return value > 1000;
  return true;
}

function matchOwnership(row, ownership) {
  if (ownership === 'all') return true;
  if (ownership === 'owned') return row.hasOwned;
  if (ownership === 'wishlist') return row.hasWishlist;
  return true;
}

function scoreSearch(row, q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  let score = 0;
  for (const t of tokens) {
    if (String(row.setNumber).toLowerCase() === t) score += 8;
    if (String(row.setNumber).toLowerCase().includes(t)) score += 6;
    if (String(row.name).toLowerCase().includes(t)) score += 5;
    if (String(row.theme).toLowerCase().includes(t)) score += 4;
    if (ownershipLabel(row).toLowerCase().includes(t)) score += 3;
    if ((row.tags || []).join(' ').toLowerCase().includes(t)) score += 2;
  }
  return score;
}

function filteredSortedRows() {
  let rows = [...state.rows];

  rows = rows.filter((r) => matchOwnership(r, state.filters.ownership));

  if (state.filters.confidence === 'estimated') rows = rows.filter(isEstimatedRow);
  if (state.filters.confidence === 'exact') rows = rows.filter((r) => !isEstimatedRow(r));

  rows = rows.filter((r) => matchValueBand(r, state.filters.valueBand));

  if (state.filters.theme !== 'all') rows = rows.filter((r) => (r.theme || 'Unknown') === state.filters.theme);

  if (state.search) {
    rows = rows
      .map((r) => ({ row: r, score: scoreSearch(r, state.search) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ row }) => row);
  }

  rows.sort((a, b) => {
    const av = a[state.sortKey];
    const bv = b[state.sortKey];

    let cmp = 0;
    if (typeof av === 'string' || typeof bv === 'string') {
      cmp = String(av ?? '').localeCompare(String(bv ?? ''));
    } else {
      const na = Number.isFinite(av) ? av : Number.NEGATIVE_INFINITY;
      const nb = Number.isFinite(bv) ? bv : Number.NEGATIVE_INFINITY;
      cmp = na - nb;
    }

    return state.sortDir === 'asc' ? cmp : -cmp;
  });

  return rows;
}

function pageCount(totalRows) {
  return Math.max(1, Math.ceil(totalRows / state.pagination.pageSize));
}

function pagedRows(rows) {
  const pages = pageCount(rows.length);
  if (state.pagination.page > pages) state.pagination.page = pages;
  const start = (state.pagination.page - 1) * state.pagination.pageSize;
  return rows.slice(start, start + state.pagination.pageSize);
}

function resetPage() {
  state.pagination.page = 1;
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
    { key: 'nib', label: 'NIB data confidence', pick: (r) => r.estimated?.nib },
    { key: 'used', label: 'Used data confidence', pick: (r) => r.estimated?.used },
    { key: 'rrp', label: 'RRP data confidence', pick: (r) => r.estimated?.rrp }
  ];

  byId('confidenceBars').innerHTML = fields.map((f) => {
    const estimatedCount = rows.filter((r) => f.pick(r)).length;
    const exactCount = rows.length - estimatedCount;
    const confidencePct = rows.length ? Math.round((exactCount / rows.length) * 100) : 100;
    return `
      <div class="bar-row">
        <div class="bar-label"><span>${f.label}</span><strong>${confidencePct}% direct</strong></div>
        <div class="bar-track"><div class="bar-fill" style="width:${confidencePct}%"></div></div>
      </div>
    `;
  }).join('');
}

function renderThemeTiles() {
  const groups = state.rows.reduce((acc, row) => {
    const theme = row.theme || 'Unknown';
    acc[theme] = acc[theme] || { theme, count: 0, nibValue: 0 };
    acc[theme].count += 1;
    acc[theme].nibValue += row.nibValue;
    return acc;
  }, {});

  const tiles = [{ theme: 'all', count: state.rows.length, nibValue: total(state.rows, 'nibValue') }, ...Object.values(groups).sort((a, b) => b.count - a.count)];

  byId('themeTiles').innerHTML = tiles.map((t) => {
    const active = state.filters.theme === t.theme;
    const label = t.theme === 'all' ? 'All themes' : t.theme;
    return `
      <button class="theme-tile ${active ? 'active' : ''}" data-theme="${t.theme}" role="listitem">
        <div class="theme-tile-head">
          <img class="theme-badge" loading="lazy" decoding="async" src="${themeBadgeDataUrl(label, true)}" alt="${label} badge" />
          <strong>${label}</strong>
        </div>
        <span>${t.count} sets</span>
        <em>${GBP.format(t.nibValue)}</em>
      </button>
    `;
  }).join('');
}

function renderMobileControls(rows) {
  const themeSelect = byId('mobileThemeFilter');
  if (themeSelect) {
    const themes = [...new Set(rows.map((r) => r.theme || 'Unknown'))].sort((a, b) => a.localeCompare(b));
    const current = state.filters.theme;
    themeSelect.innerHTML = [
      '<option value="all">All themes</option>',
      ...themes.map((theme) => `<option value="${theme}">${theme}</option>`)
    ].join('');
    themeSelect.value = themes.includes(current) || current === 'all' ? current : 'all';
  }

  const ownershipSelect = byId('mobileOwnershipFilter');
  if (ownershipSelect) ownershipSelect.value = state.filters.ownership;
  const desktopOwnership = byId('ownershipFilter');
  if (desktopOwnership) desktopOwnership.value = state.filters.ownership;

  const sortSelect = byId('mobileSortSelect');
  if (sortSelect) sortSelect.value = `${state.sortKey}:${state.sortDir}`;

  const beHint = byId('mobileBrickEconomyHint');
  if (beHint) {
    if (state.hasBrickEconomyData && state.hasBrickLinkData) {
      beHint.textContent = `Auto uses BrickEconomy first, then BrickLink pilot (${state.marketSource}).`;
    } else if (state.hasBrickEconomyData) {
      beHint.textContent = 'BrickEconomy steering available';
    } else if (state.hasBrickLinkData) {
      beHint.textContent = 'BrickLink pilot steering available';
    } else {
      beHint.textContent = 'No steering source available in current snapshot';
    }
  }
}

function renderPagination(totalRows) {
  const totalPages = pageCount(totalRows);
  const current = Math.min(state.pagination.page, totalPages);
  const start = totalRows ? ((current - 1) * state.pagination.pageSize) + 1 : 0;
  const end = totalRows ? Math.min(totalRows, current * state.pagination.pageSize) : 0;

  byId('paginationBar').innerHTML = `
    <div class="pagination-meta">Showing ${start}-${end} of ${totalRows} sets</div>
    <div class="pagination-actions">
      <button class="chip-btn" data-page-nav="prev" ${current <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="pagination-page">Page ${current} / ${totalPages}</span>
      <button class="chip-btn" data-page-nav="next" ${current >= totalPages ? 'disabled' : ''}>Next</button>
    </div>
  `;
}

function renderEmptyState(targetId, title, subtitle) {
  byId(targetId).innerHTML = `<div class="empty-state"><p>${title}</p><span>${subtitle}</span></div>`;
}

function actionButtons(r) {
  const onList = isWatchlisted(r.setNumber);
  return `
    <div class="row-actions">
      <button class="chip-btn detail-btn" data-detail="${r.setNumber}">Details</button>
      <button class="chip-btn watch-btn ${onList ? 'is-on' : ''}" data-watch="${r.setNumber}">${onList ? 'Watching' : 'Add to Watchlist'}</button>
    </div>
  `;
}

function renderTable(rows) {
  const tbody = document.querySelector('#setsTable tbody');
  const pageRows = pagedRows(rows);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="table-empty">No sets match current filters. Try a broader query.</div></td></tr>`;
    renderKpis(rows);
    renderPagination(0);
    renderMobileCards(pageRows);
    return;
  }

  tbody.innerHTML = pageRows.map((r) => {
    return `
      <tr>
        <td class="set-cell">
          <img class="set-thumb" loading="lazy" decoding="async" src="${imageUrlForSet(r.setNumber)}" alt="Set ${r.setNumber}" onerror="this.onerror=null;this.src='${placeholderImage(r.setNumber)}';" />
          <span>${r.setNumber}</span>
        </td>
        <td>
          <div class="name-cell">
            <div>${r.name}<div class="row-sub">${r.theme || 'Theme n/a'} · ${ownershipLabel(r)}</div></div>
            <img class="theme-badge row-badge" loading="lazy" decoding="async" src="${themeBadgeDataUrl(r.theme, true)}" alt="${r.theme || 'Theme'} badge" />
          </div>
        </td>
        <td>${r.qty}</td>
        <td>${r.hasBrickEconomy ? GBP.format(r.brickEconomyUnitGbp) : '—'}</td>
        <td>${GBP.format(r.usedPriceGbp)}</td>
        <td>${GBP.format(r.rrpGbp)}</td>
        <td>${r.hasBrickEconomy ? GBP.format(r.brickEconomyValue) : '—'}</td>
        <td>${GBP.format(r.usedValue)}</td>
        <td>${GBP.format(r.rrpValue)}</td>
        <td class="${r.delta >= 0 ? 'delta-plus' : 'delta-minus'}">${GBP.format(r.delta)}</td>
        <td>${actionButtons(r)}</td>
      </tr>
    `;
  }).join('');
  renderKpis(rows);
  renderPagination(rows.length);
  renderMobileCards(pageRows);
}

function renderMobileCards(rows) {
  if (!rows.length) {
    renderEmptyState('mobileCards', 'No sets found', 'Adjust your search or filter to continue.');
    return;
  }

  const beUnavailableLabel = '<span class="hint-muted">BrickEconomy price unavailable</span>';

  byId('mobileCards').innerHTML = rows.map((r) => {
    return `
    <article class="set-card" data-detail="${r.setNumber}" role="button" tabindex="0" aria-label="View details for ${r.name}">
      <div class="set-card-top">
        <div class="set-card-media">
          <img class="set-card-thumb" loading="lazy" decoding="async" src="${imageUrlForSet(r.setNumber)}" alt="${r.name} thumbnail" onerror="this.onerror=null;this.src='${placeholderImage(r.setNumber)}';" />
        </div>
        <div class="set-card-head">
          <strong>${r.name}</strong>
          <div class="set-card-meta">
            <span class="set-number">Set ${r.setNumber}</span>
            <img class="theme-badge" loading="lazy" decoding="async" src="${themeBadgeDataUrl(r.theme, true)}" alt="${r.theme || 'Theme'} badge" />
          </div>
          <div class="market-price-line">
            <label>Current market price</label>
            <p>${r.hasBrickEconomy ? GBP.format(r.brickEconomyUnitGbp) : '—'}</p>
          </div>
          ${!r.hasBrickEconomy ? `<div class="market-alt-line">${beUnavailableLabel}</div>` : ""}
        </div>
      </div>
      ${actionButtons(r)}
    </article>
  `;
  }).join('');
}

function updateFreshness() {
  const dt = new Date(state.generatedAt);
  byId('freshness').textContent = `Snapshot freshness: ${dt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function renderGallery(rows) {
  const top = [...rows].sort((a, b) => b.delta - a.delta).slice(0, 8);

  if (!top.length) {
    renderEmptyState('galleryRail', 'No momentum sets yet', 'Load a broader list to view movers.');
    return;
  }

  byId('galleryRail').innerHTML = top.map((r) => {
    const fallback = placeholderImage(r.setNumber);
    const onList = isWatchlisted(r.setNumber);
    return `
    <article class="story-card" data-detail="${r.setNumber}">
      <img loading="lazy" decoding="async" src="${imageUrlForSet(r.setNumber)}" alt="LEGO set ${r.setNumber}: ${r.name}" onerror="this.onerror=null;this.src='${fallback}';" />
      <div class="story-meta">
        <p class="title">${r.name}</p>
        <p class="set">Set ${r.setNumber} · Qty ${r.qty} · ${ownershipLabel(r)}</p>
        <p class="delta">Momentum ${GBP.format(r.delta)} vs RRP</p>
      </div>
      <button class="chip-btn watch-btn ${onList ? 'is-on' : ''}" data-watch="${r.setNumber}">${onList ? 'Watching' : 'Add to Watchlist'}</button>
    </article>
  `;
  }).join('');
}

function renderWatchlist() {
  const list = state.watchlist
    .map((setId) => state.rows.find((r) => String(r.setNumber) === String(setId)))
    .filter(Boolean);

  if (!list.length) {
    renderEmptyState('watchlistBody', 'Watchlist is empty', 'Save key sets to monitor price momentum faster.');
    return;
  }

  byId('watchlistBody').innerHTML = list.map((r) => `
    <div class="watch-item">
      <button class="watch-main" data-detail="${r.setNumber}">
        <strong>${r.name}</strong>
        <span>Set ${r.setNumber} · ${r.hasBrickEconomy ? GBP.format(r.brickEconomyValue) : '—'}</span>
      </button>
      <button class="chip-btn watch-btn is-on" data-watch="${r.setNumber}">Remove</button>
    </div>
  `).join('');
}

function renderSnapshotChanges(rows) {
  const now = {
    generatedAt: state.generatedAt,
    setCount: rows.length,
    nib: total(rows, 'nibValue'),
    used: total(rows, 'usedValue'),
    estimatedRows: rows.filter(isEstimatedRow).length
  };

  const prev = safeLoad(SNAPSHOT_KEY, null);
  let items;

  if (!prev) {
    items = [
      ['Previous snapshot', 'No previous local snapshot yet'],
      ['Set coverage', `${now.setCount} sets tracked`],
      ['Inferred rows', `${now.estimatedRows} rows contain inferred fields`]
    ];
  } else {
    const pct = prev.nib ? (((now.nib - prev.nib) / prev.nib) * 100).toFixed(1) : '0.0';
    items = [
      ['Snapshot transition', `${new Date(prev.generatedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} → ${new Date(now.generatedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`],
      ['NIB portfolio move', `${GBP.format(now.nib - prev.nib)} (${pct}%)`],
      ['Used portfolio move', `${GBP.format(now.used - prev.used)}`],
      ['Set count change', `${now.setCount - prev.setCount >= 0 ? '+' : ''}${now.setCount - prev.setCount}`],
      ['Inferred row change', `${now.estimatedRows - prev.estimatedRows >= 0 ? '+' : ''}${now.estimatedRows - prev.estimatedRows}`]
    ];
  }

  byId('changesList').innerHTML = items.map(([label, value]) => `
    <div class="change-item">
      <span class="change-label">${label}</span>
      <span class="change-value">${value}</span>
    </div>
  `).join('');

  safeSave(SNAPSHOT_KEY, now);
}

function skeletons(on) {
  document.body.classList.toggle('loading', on);
}

function toast(message) {
  const node = byId('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => node.classList.remove('show'), 1800);
}

function openDetail(setNumber) {
  const row = state.rows.find((r) => String(r.setNumber) === String(setNumber));
  if (!row) return;
  state.selectedSet = row;

  const fallback = placeholderImage(row.setNumber);
  byId('detailBody').innerHTML = `
    <section class="product-hero">
      <img loading="lazy" decoding="async" src="${imageUrlForSet(row.setNumber)}" alt="${row.name}" onerror="this.onerror=null;this.src='${fallback}';" />
    </section>

    <section class="product-trust-row">
      <div class="product-title">
        <h3>${row.name}</h3>
        <p>Set ${row.setNumber} · ${row.theme || 'Theme n/a'} · ${ownershipLabel(row)}</p>
        <div class="trust-pills">
          <span class="badge subtle">Data snapshot indexed</span>
          <span class="badge ${isEstimatedRow(row) ? 'warn' : ''}">${isEstimatedRow(row) ? 'Contains estimate(s)' : 'Exact in-sheet pricing'}</span>
        </div>
      </div>
      <div class="product-price">
        <p class="main">${row.marketValue != null ? GBP.format(row.marketValue) : '—'}</p>
        <p class="sub">${row.marketSource || 'No source'} market value · Qty ${row.qty}</p>
      </div>
    </section>

    <section class="detail-grid">
      <div class="spec-tile"><label>Quantity</label><strong>${row.qty}</strong></div>
      <div class="spec-tile"><label>Market unit (${row.marketSource || 'n/a'})</label><strong>${row.marketUnit != null ? GBP.format(row.marketUnit) : '—'}</strong></div>
      <div class="spec-tile"><label>Used unit</label><strong>${GBP.format(row.usedPriceGbp)}</strong></div>
      <div class="spec-tile"><label>RRP unit</label><strong>${GBP.format(row.rrpGbp)}</strong></div>
      <div class="spec-tile"><label>Market value (${row.marketSource || 'n/a'})</label><strong>${row.marketValue != null ? GBP.format(row.marketValue) : '—'}</strong></div>
      <div class="spec-tile"><label>Delta vs RRP</label><strong class="${row.delta >= 0 ? 'delta-plus' : 'delta-minus'}">${GBP.format(row.delta)}</strong></div>
    </section>
    ${!state.hasBrickEconomyData && !state.hasBrickLinkData ? '<p class="detail-note">No external market steering values are present in the current data export.</p>' : ''}
  `;
  byId('detailWatchBtn').textContent = isWatchlisted(setNumber) ? 'Remove from Watchlist' : 'Add to Watchlist';
  byId('detailDialog').showModal();
}

function closeDetail() {
  byId('detailDialog').close();
}

function reRender() {
  const rows = filteredSortedRows();
  renderTable(rows);
  renderGallery(rows);
  renderConfidence(rows);
  renderThemeTiles();
  renderMobileControls(state.rows);
}

function clearFilters() {
  state.search = '';
  state.sortKey = 'marketValue';
  state.sortDir = 'desc';
  state.filters = { ownership: 'all', confidence: 'all', valueBand: 'all', theme: 'all' };
  resetPage();
  byId('searchInput').value = '';
  byId('ownershipFilter').value = 'all';
  byId('confidenceFilter').value = 'all';
  byId('valueBandFilter').value = 'all';
  byId('marketSourceFilter').value = state.marketSource;
  reRender();
}

async function loadData() {
  try {
    skeletons(true);
    const bust = `?v=${Date.now()}`;
    const data = await fetch(`data/portfolio.json${bust}`).then(r => r.json());
    state.generatedAt = data.generatedAt;
    state.assumptions = data.assumptions;
    state.rows = valueRows(data.items);
    state.hasBrickEconomyData = state.rows.some((r) => r.hasBrickEconomy);
    state.hasBrickLinkData = state.rows.some((r) => r.hasBrickLink);

    const assumptionBadge = byId('assumptionBadge');
    if (assumptionBadge) {
      if (state.hasBrickEconomyData && state.hasBrickLinkData) {
        assumptionBadge.textContent = 'BrickEconomy + BrickLink steering available.';
      } else if (state.hasBrickEconomyData) {
        assumptionBadge.textContent = 'BrickEconomy values available on supported rows.';
      } else if (state.hasBrickLinkData) {
        assumptionBadge.textContent = 'BrickLink steering values available on pilot rows.';
      } else {
        assumptionBadge.textContent = 'No external steering values in this snapshot.';
      }
    }

    const marketSourceFilter = byId('marketSourceFilter');
    if (marketSourceFilter) marketSourceFilter.value = state.marketSource;

    updateFreshness();
    reRender();
    renderSnapshotChanges(state.rows);
    renderWatchlist();
  } finally {
    state.isLoading = false;
    skeletons(false);
  }
}

byId('searchInput').addEventListener('input', (e) => {
  state.search = e.target.value.trim();
  resetPage();
  reRender();
});

byId('ownershipFilter').addEventListener('change', (e) => {
  state.filters.ownership = e.target.value;
  resetPage();
  reRender();
});

byId('confidenceFilter').addEventListener('change', (e) => {
  state.filters.confidence = e.target.value;
  resetPage();
  reRender();
});

byId('valueBandFilter').addEventListener('change', (e) => {
  state.filters.valueBand = e.target.value;
  resetPage();
  reRender();
});

byId('clearFiltersBtn').addEventListener('click', clearFilters);

byId('marketSourceFilter')?.addEventListener('change', (e) => {
  state.marketSource = e.target.value || 'auto';
  state.rows = valueRows(state.rows);
  resetPage();
  reRender();
});

byId('mobileOwnershipFilter')?.addEventListener('change', (e) => {
  state.filters.ownership = e.target.value;
  resetPage();
  reRender();
});

byId('mobileThemeFilter')?.addEventListener('change', (e) => {
  state.filters.theme = e.target.value;
  resetPage();
  reRender();
});

byId('mobileSortSelect')?.addEventListener('change', (e) => {
  const [sortKey, sortDir] = String(e.target.value || '').split(':');
  if (!sortKey || !sortDir) return;
  state.sortKey = sortKey;
  state.sortDir = sortDir;
  resetPage();
  reRender();
});

byId('mobileClearFiltersBtn')?.addEventListener('click', clearFilters);

byId('printBtn').addEventListener('click', () => window.print());

byId('refreshBtn').addEventListener('click', async () => {
  byId('refreshBtn').textContent = 'Refreshing...';
  byId('refreshBtn').disabled = true;
  await new Promise(r => setTimeout(r, 420));
  await loadData();
  byId('refreshBtn').disabled = false;
  byId('refreshBtn').textContent = 'Refresh valuations';
});

document.querySelectorAll('#setsTable th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortKey = key; state.sortDir = 'desc'; }
    resetPage();
    reRender();
  });
});

document.addEventListener('click', (e) => {
  const pageNav = e.target.closest('[data-page-nav]');
  if (pageNav) {
    if (pageNav.dataset.pageNav === 'prev') state.pagination.page = Math.max(1, state.pagination.page - 1);
    if (pageNav.dataset.pageNav === 'next') state.pagination.page += 1;
    reRender();
    return;
  }

  const tile = e.target.closest('[data-theme]');
  if (tile) {
    state.filters.theme = tile.dataset.theme;
    resetPage();
    reRender();
    return;
  }

  const watch = e.target.closest('[data-watch]');
  if (watch) {
    e.preventDefault();
    e.stopPropagation();
    const id = String(watch.dataset.watch);
    if (state.watchlist.includes(id)) {
      state.watchlist = state.watchlist.filter((v) => v !== id);
      toast(`Removed Set ${id} from watchlist`);
    } else {
      state.watchlist = [id, ...state.watchlist];
      toast(`Added Set ${id} to watchlist`);
    }
    safeSave(WATCHLIST_KEY, state.watchlist);
    renderWatchlist();
    reRender();
    return;
  }

  const detail = e.target.closest('[data-detail]');
  if (detail) openDetail(detail.dataset.detail);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.set-card[data-detail]');
  if (!card) return;
  e.preventDefault();
  openDetail(card.dataset.detail);
});

byId('detailClose').addEventListener('click', closeDetail);
byId('detailDialog').addEventListener('click', (e) => {
  const rect = e.target.getBoundingClientRect?.();
  if (!rect) return;
  const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
  if (outside) closeDetail();
});

byId('detailWatchBtn').addEventListener('click', () => {
  if (!state.selectedSet) return;
  const id = String(state.selectedSet.setNumber);
  if (state.watchlist.includes(id)) state.watchlist = state.watchlist.filter((v) => v !== id);
  else state.watchlist = [id, ...state.watchlist];
  safeSave(WATCHLIST_KEY, state.watchlist);
  byId('detailWatchBtn').textContent = isWatchlisted(state.selectedSet.setNumber) ? 'Remove from Watchlist' : 'Add to Watchlist';
  renderWatchlist();
  reRender();
});

state.watchlist = safeLoad(WATCHLIST_KEY, []);
loadData();
