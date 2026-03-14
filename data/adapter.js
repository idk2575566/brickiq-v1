// BrickIQ v1 data adapter assumptions for sheet:
// 'Brickset Export Used for Explorer' (1V8Kup3RLF_yldvq2HYqVGLFK61Myzst5mAdsHqsF7BI)

export const DATA_ADAPTER = {
  source: {
    spreadsheetId: '1V8Kup3RLF_yldvq2HYqVGLFK61Myzst5mAdsHqsF7BI',
    title: 'Brickset Export Used for Explorer',
    tab: 'Sheet1'
  },
  mapping: {
    setNumber: 'Number + Variant => `${Number}-${Variant}`',
    setName: 'SetName',
    qtyOwned: 'QtyOwned (fallback: 1)',
    qtyWanted: 'QtyWanted (fallback: 0)',
    ownershipOwned: 'Own OR QtyOwned > 0',
    ownershipWishlist: 'Want OR QtyWanted > 0',
    ownershipStatus: 'owned | wishlist | both | unknown',
    nibPriceGbp: 'BrickLinkSoldPriceNew',
    usedPriceGbp: 'BrickLinkSoldPriceUsed',
    rrpGbp: 'UKRetailPrice (fallback: USRetailPrice)'
  },
  estimationRules: {
    nibIfMissing: 'RRP * 1.35',
    usedIfMissing: 'NIB * 0.68',
    rrpIfMissing: 'Used * 1.15'
  },
  caveats: [
    'Sheet export does not explicitly specify currency for BrickLinkSoldPrice fields in this extract; app assumes GBP display context.',
    'Rows with missing QtyOwned are treated as quantity=1 for conservative inclusion.',
    'Estimated fields are flagged in UI as est.',
    'In the current snapshot, most rows resolve to owned due to QtyOwned > 0 and Own = X; wishlist handling remains active for future rows with Want/QtyWanted.'
  ]
};
