# BrickIQ v1 Prototype

Private single-user prototype for LEGO portfolio valuation (GBP-focused) built from canonical sheet:

- **Sheet:** Brickset Export Used for Explorer
- **Spreadsheet ID:** `1V8Kup3RLF_yldvq2HYqVGLFK61Myzst5mAdsHqsF7BI`

## Included v1 features

- KPI cards for NIB / Used / RRP + delta vs RRP
- Search + filter + sortable set table
- Manual **Refresh valuations** button (simulated)
- Data freshness + assumptions badges
- Responsive mobile/desktop layout
- Estimated field flags (`est.`)

## Data adapter + assumptions

See:
- `data/adapter.js`
- `DATA_MAPPING.md`
- `data/mapping-summary.json`

## Local run

```bash
npm install
python3 -m http.server 4173
# open http://127.0.0.1:4173
```

## Smoke tests

```bash
python3 -m http.server 4173
npx playwright test --config=playwright.config.cjs
```
