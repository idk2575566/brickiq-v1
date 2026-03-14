import fs from 'fs';

const input = JSON.parse(fs.readFileSync('sheet.json', 'utf8'));
const rows = input.values || [];
const headers = rows[0] || [];

const idx = (name) => headers.indexOf(name);
const get = (row, name) => row[idx(name)] ?? '';
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const isTruthy = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'x';
};

const mapped = rows.slice(1).map((row) => {
  const setNumber = get(row, 'Number');
  const variant = get(row, 'Variant');
  const setCode = setNumber && variant ? `${setNumber}-${variant}` : setNumber || '';

  const qtyRaw = num(get(row, 'QtyOwned'));
  const qty = qtyRaw && qtyRaw > 0 ? qtyRaw : 1;

  const qtyWanted = num(get(row, 'QtyWanted')) ?? 0;
  const hasOwned = isTruthy(get(row, 'Own')) || qty > 0;
  const hasWishlist = isTruthy(get(row, 'Want')) || qtyWanted > 0;
  const ownershipStatus = hasOwned && hasWishlist ? 'both' : (hasOwned ? 'owned' : (hasWishlist ? 'wishlist' : 'unknown'));

  const nibRaw = num(get(row, 'BrickLinkSoldPriceNew'));
  const usedRaw = num(get(row, 'BrickLinkSoldPriceUsed'));
  const rrpRaw = num(get(row, 'UKRetailPrice')) ?? num(get(row, 'USRetailPrice'));

  const estimated = { nib: false, used: false, rrp: false };

  let nib = nibRaw;
  let used = usedRaw;
  let rrp = rrpRaw;

  if (nib == null) {
    nib = rrp != null ? +(rrp * 1.35).toFixed(2) : 0;
    estimated.nib = true;
  }
  if (used == null) {
    used = nib != null ? +(nib * 0.68).toFixed(2) : (rrp != null ? +(rrp * 0.9).toFixed(2) : 0);
    estimated.used = true;
  }
  if (rrp == null) {
    rrp = used != null ? +(used * 1.15).toFixed(2) : 0;
    estimated.rrp = true;
  }

  return {
    setId: get(row, 'SetID'),
    setNumber: setCode || setNumber,
    name: get(row, 'SetName') || 'Unknown set',
    qty,
    qtyWanted,
    theme: get(row, 'Theme'),
    subtheme: get(row, 'Subtheme'),
    tags: [get(row, 'Category'), get(row, 'ThemeGroup'), get(row, 'Subtheme'), ownershipStatus].filter(Boolean),
    ownershipStatus,
    hasOwned,
    hasWishlist,
    nibPriceGbp: +Number(nib).toFixed(2),
    usedPriceGbp: +Number(used).toFixed(2),
    rrpGbp: +Number(rrp).toFixed(2),
    estimated,
    source: {
      nib: nibRaw != null ? 'BrickLinkSoldPriceNew' : 'estimated',
      used: usedRaw != null ? 'BrickLinkSoldPriceUsed' : 'estimated',
      rrp: num(get(row, 'UKRetailPrice')) != null ? 'UKRetailPrice' : (num(get(row, 'USRetailPrice')) != null ? 'USRetailPrice' : 'estimated')
    }
  };
}).filter(r => r.setNumber && r.name);

const output = {
  generatedAt: new Date().toISOString(),
  sourceSpreadsheetId: '1V8Kup3RLF_yldvq2HYqVGLFK61Myzst5mAdsHqsF7BI',
  sourceRange: input.range,
  rowCount: mapped.length,
  assumptions: [
    'Primary set number mapping: Number + Variant → setNumber (e.g., 6866-1).',
    'Primary quantity mapping: QtyOwned; defaults to 1 if missing/zero.',
    'Ownership mapping: Own + QtyOwned => owned, Want + QtyWanted => wishlist (both allowed).',
    'NIB market price source: BrickLinkSoldPriceNew (GBP assumed from export context).',
    'Used market price source: BrickLinkSoldPriceUsed (GBP assumed from export context).',
    'RRP source priority: UKRetailPrice, fallback to USRetailPrice.',
    'Placeholder formulas when missing: NIB = RRP×1.35, Used = NIB×0.68, RRP = Used×1.15.',
    'Estimated values are explicitly flagged per row/field in `estimated`.'
  ],
  items: mapped
};

fs.writeFileSync('data/portfolio.json', JSON.stringify(output, null, 2));

const estimateStats = mapped.reduce((acc, r) => {
  acc.nib += r.estimated.nib ? 1 : 0;
  acc.used += r.estimated.used ? 1 : 0;
  acc.rrp += r.estimated.rrp ? 1 : 0;
  return acc;
}, { nib: 0, used: 0, rrp: 0 });

const ownershipStats = mapped.reduce((acc, r) => {
  acc[r.ownershipStatus] = (acc[r.ownershipStatus] || 0) + 1;
  return acc;
}, {});

fs.writeFileSync('data/mapping-summary.json', JSON.stringify({
  headers,
  mappedCount: mapped.length,
  estimateStats,
  ownershipStats
}, null, 2));

console.log(`Built ${mapped.length} normalized rows`);
console.log('Estimate stats:', estimateStats);
console.log('Ownership stats:', ownershipStats);
