#!/usr/bin/env bash
set -euo pipefail
SHEET_ID="1V8Kup3RLF_yldvq2HYqVGLFK61Myzst5mAdsHqsF7BI"
gog sheets get "$SHEET_ID" 'Sheet1!A1:BA5000' --json > sheet.json
node scripts/build-data.mjs
