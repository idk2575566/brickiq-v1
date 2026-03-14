# BrickIQ v1 Data Mapping Notes

Source sheet: **Brickset Export Used for Explorer**  
Spreadsheet ID: `1V8Kup3RLF_yldvq2HYqVGLFK61Myzst5mAdsHqsF7BI`  
Range snapshot used: `Sheet1!A1:BA200`

## Exact column usage

- **Set #** = `Number` + `-` + `Variant` (e.g. `6866-1`)
- **Name** = `SetName`
- **Theme** = `Theme`
- **Subtheme** = `Subtheme`
- **Qty owned (display quantity)** = `QtyOwned` (fallback `1`)
- **Qty wanted (for wishlist classification)** = `QtyWanted` (fallback `0`)
- **Owned flag** = `Own` OR `QtyOwned > 0`
- **Wishlist flag** = `Want` OR `QtyWanted > 0`
- **Ownership status** =
  - `owned` when owned=true and wishlist=false
  - `wishlist` when wishlist=true and owned=false
  - `both` when owned=true and wishlist=true
  - `unknown` when both false
- **NIB price (GBP)** = `BrickLinkSoldPriceNew`
- **Used price (GBP)** = `BrickLinkSoldPriceUsed`
- **RRP (GBP baseline)** = `UKRetailPrice` (fallback `USRetailPrice`)

## Estimation fallback rules

Used only when source field is missing:

- `NIB = RRP × 1.35`
- `Used = NIB × 0.68`
- `RRP = Used × 1.15`

These estimates are flagged in UI (`est.` badge next to the affected field).

## Owned vs Wishlist recheck result

- Source columns verified in headers: `Own`, `Want`, `QtyOwned`, `QtyWanted`.
- In this snapshot, rows are effectively owned (e.g. `Own = X`, `QtyOwned > 0`) and `Want`/`QtyWanted` are mostly empty/zero.
- App now explicitly supports **Owned / Wishlist / All** filtering and keeps logic active for future data where wishlist rows exist.

## Snapshot caveats

- In this snapshot (199 rows), missing values required estimates in:
  - NIB: **1** row
  - Used: **3** rows
  - RRP: **61** rows
- BrickLink sold-price fields are treated as GBP for this prototype display context.
