# BrickIQ v1 Data Mapping Notes

Source sheet: **Brickset Export Used for Explorer**  
Spreadsheet ID: `1V8Kup3RLF_yldvq2HYqVGLFK61Myzst5mAdsHqsF7BI`  
Range snapshot used: `Sheet1!A1:BA200`

## Field mapping assumptions

- **Set #** = `Number` + `-` + `Variant` (e.g. `6866-1`)
- **Name** = `SetName`
- **Qty** = `QtyOwned` (fallback to `1` if missing/0)
- **NIB price (GBP)** = `BrickLinkSoldPriceNew`
- **Used price (GBP)** = `BrickLinkSoldPriceUsed`
- **RRP (GBP baseline)** = `UKRetailPrice` (fallback `USRetailPrice`)

## Estimation fallback rules

Used only when source field is missing:

- `NIB = RRP × 1.35`
- `Used = NIB × 0.68`
- `RRP = Used × 1.15`

These estimates are flagged in UI (`est.` badge next to the affected field).

## Snapshot caveats

- In this snapshot (199 rows), missing values required estimates in:
  - NIB: **1** row
  - Used: **3** rows
  - RRP: **61** rows
- BrickLink sold-price fields are treated as GBP for this prototype display context.
