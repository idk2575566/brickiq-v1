#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORTFOLIO_PATH = path.join(ROOT, 'data', 'portfolio.json');

const MAX_SETS = Math.min(20, Number(process.env.BRICKLINK_MAX ?? 20));
const DELAY_MS = Number(process.env.BRICKLINK_DELAY_MS ?? 3500);
const MISSING_ONLY = String(process.env.BRICKLINK_MISSING_ONLY ?? '1') !== '0';
const START_INDEX = Number(process.env.BRICKLINK_START_INDEX ?? 0);
const FETCH_TIMEOUT_MS = Number(process.env.BRICKLINK_FETCH_TIMEOUT_MS ?? 25000);
const FX_BASE = process.env.BRICKLINK_FX_BASE ?? 'GBP';

const USER_AGENT =
  process.env.BRICKLINK_USER_AGENT ||
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function parseMoney(moneyText) {
  const n = Number(String(moneyText || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseStatsColumn(columnHtml) {
  const getNum = (label) => {
    const re = new RegExp(`${label}:\\s*</TD>\\s*<TD[^>]*>\\s*<B>([^<]+)</B>`, 'i');
    const m = columnHtml.match(re);
    if (!m) return null;
    return parseMoney(stripTags(m[1]));
  };

  const avgMatch = columnHtml.match(/Avg Price:\s*<\/TD>\s*<TD[^>]*>\s*<B>([^<]+)<\/B>/i);
  const qtyAvgMatch = columnHtml.match(/Qty Avg Price:\s*<\/TD>\s*<TD[^>]*>\s*<B>([^<]+)<\/B>/i);

  const avgRaw = stripTags(avgMatch?.[1] || '');
  const qtyAvgRaw = stripTags(qtyAvgMatch?.[1] || '');

  const currencyMatch = (avgRaw || qtyAvgRaw).match(/^([A-Z]{2,3})\s*\$/i);
  const currency = currencyMatch?.[1] || null;

  return {
    timesSold: getNum('Times Sold'),
    totalQty: getNum('Total Qty'),
    avgPrice: parseMoney(avgRaw),
    qtyAvgPrice: parseMoney(qtyAvgRaw),
    currency,
  };
}

function parseBrickLinkPriceGuide(html) {
  const section = html.match(/<B>Last 6 Months Sales:\/B>[\s\S]*?<\/TR>\s*<TR BGCOLOR="#C0C0C0">([\s\S]*?)<\/TR>/i);
  if (!section) {
    return { found: false, reason: 'last-6-months-sales-section-missing' };
  }

  const tdMatches = [...section[1].matchAll(/<TD\s+VALIGN="TOP">([\s\S]*?)<\/TD>/gi)];
  if (tdMatches.length < 2) {
    return { found: false, reason: 'sales-columns-missing' };
  }

  const newStats = parseStatsColumn(tdMatches[0][1]);
  const usedStats = parseStatsColumn(tdMatches[1][1]);

  const setTitleMatch = html.match(/<title>\s*BrickLink Price Guide\s*-\s*Set\s+([^<]+)<\/title>/i);
  const resolvedSetNumber = setTitleMatch?.[1]?.trim() || null;

  return {
    found: true,
    resolvedSetNumber,
    window: 'Last 6 Months Sales',
    new: newStats,
    used: usedStats,
  };
}

function computeSteering(parsed) {
  // Pilot default: steer on New completed sales (closest to NIB valuation in app)
  const chosen = parsed?.new || {};
  const value = toNumberOrNull(chosen.avgPrice ?? chosen.qtyAvgPrice);
  const sampleSize = toNumberOrNull(chosen.timesSold);
  const currency = chosen.currency || parsed?.used?.currency || null;

  if (value == null) {
    return { found: false, reason: 'new-avg-price-missing', currency, sampleSize, window: parsed?.window || null };
  }

  return {
    found: true,
    value,
    currency,
    sampleSize,
    window: parsed?.window || null,
    methodology: 'BrickLink catalog price guide > Last 6 Months Sales > New > Avg Price',
  };
}

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }

  if (/quota exceeded|error\.page\?code=429/i.test(body)) {
    const err = new Error(`HTTP 429 quota page for ${url}`);
    err.status = 429;
    throw err;
  }

  if (/just a moment|cf-chl-|captcha|attention required/i.test(body)) {
    const err = new Error(`HTTP 403 challenge page for ${url}`);
    err.status = 403;
    throw err;
  }

  return body;
}

async function checkRobots() {
  const robotsUrl = 'https://www.bricklink.com/robots.txt';
  const text = await fetchText(robotsUrl);
  const disallowAll = /User-agent:\s*\*([\s\S]*?)$/i
    .exec(text)?.[1]
    ?.split(/\r?\n/)
    ?.some((line) => /^\s*Disallow:\s*\/\s*$/i.test(line.trim())) || false;
  return { robotsUrl, disallowAll };
}

async function fetchSetSteering(setNumber) {
  const candidates = [...new Set([setNumber, String(setNumber).replace(/-\d+$/, '')].filter(Boolean))];

  let lastFailure = null;
  for (const candidate of candidates) {
    const url = `https://www.bricklink.com/catalogPG.asp?S=${encodeURIComponent(candidate)}&ColorID=0`;
    const html = await fetchText(url);

    if (/oops,\s*sorry!/i.test(html) || /set not found/i.test(html)) {
      lastFailure = { found: false, reason: 'set-not-found', url, tried: candidate };
      continue;
    }

    const parsed = parseBrickLinkPriceGuide(html);
    if (!parsed.found) {
      lastFailure = { found: false, reason: parsed.reason || 'parse-failed', url, tried: candidate };
      continue;
    }

    const steering = computeSteering(parsed);
    if (!steering.found) {
      lastFailure = { found: false, reason: steering.reason, url, tried: candidate, ...steering };
      continue;
    }

    return {
      found: true,
      setNumber: parsed.resolvedSetNumber || setNumber,
      bricklinkAvgSold: steering.value,
      bricklinkCurrency: steering.currency,
      bricklinkSampleSize: steering.sampleSize,
      bricklinkWindow: steering.window,
      methodology: steering.methodology,
      url,
      tried: candidate,
    };
  }

  return lastFailure || { found: false, reason: 'parse-failed' };
}

async function fetchFxRates(base = FX_BASE) {
  try {
    const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
    const body = await fetchText(url);
    const data = JSON.parse(body);
    if (data?.result !== 'success' || !data?.rates || typeof data.rates !== 'object') return null;
    return { base: data.base_code || base, rates: data.rates, timeLastUpdateUtc: data.time_last_update_utc || null };
  } catch {
    return null;
  }
}

function normalizeToBase(value, currency, fx) {
  if (value == null || !currency || !fx?.rates) return null;
  if (currency === fx.base) return value;
  const rate = fx.rates[currency];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return +(value / rate).toFixed(2);
}

async function main() {
  const robots = await checkRobots();
  if (robots.disallowAll) {
    throw new Error('BrickLink robots.txt indicates full disallow for User-agent *, aborting.');
  }

  const raw = await fs.readFile(PORTFOLIO_PATH, 'utf8');
  const portfolio = JSON.parse(raw);
  const items = Array.isArray(portfolio.items) ? portfolio.items : [];

  const uniqueSetNumbersAll = [...new Set(items.map((i) => i?.setNumber).filter(Boolean))];
  const unresolved = uniqueSetNumbersAll.filter((setNumber) => {
    if (!MISSING_ONLY) return true;
    return !items.some((i) => i?.setNumber === setNumber && toNumberOrNull(i?.bricklinkAvgSold) != null);
  });

  const targetSetNumbers = unresolved.slice(Math.max(0, START_INDEX), Math.max(0, START_INDEX) + Math.max(0, MAX_SETS));

  const bySet = new Map();
  for (const setNumber of targetSetNumbers) {
    try {
      const result = await fetchSetSteering(setNumber);
      bySet.set(setNumber, result);
    } catch (err) {
      bySet.set(setNumber, {
        found: false,
        reason: err?.message || 'request-failed',
        status: err?.status ?? null,
      });
    }
    await sleep(DELAY_MS);
  }

  const fx = await fetchFxRates(FX_BASE);
  const now = new Date().toISOString();

  let enrichedItems = 0;
  for (const item of items) {
    const result = bySet.get(item.setNumber);
    if (!result) continue;

    if (result.found) {
      item.bricklinkAvgSold = result.bricklinkAvgSold;
      item.bricklinkCurrency = result.bricklinkCurrency || null;
      item.bricklinkSampleSize = result.bricklinkSampleSize ?? null;
      item.bricklinkWindow = result.bricklinkWindow || null;
      item.bricklinkUpdatedAt = now;
      item.bricklinkMethodology = result.methodology;
      item.bricklinkPriceGuideUrl = result.url;

      const normalized = normalizeToBase(result.bricklinkAvgSold, result.bricklinkCurrency, fx);
      if (normalized != null) {
        item.bricklinkAvgSoldGbp = normalized;
        item.bricklinkFxBase = fx.base;
      }

      enrichedItems += 1;
    } else {
      if (item.bricklinkAvgSold === undefined) item.bricklinkAvgSold = null;
      if (item.bricklinkCurrency === undefined) item.bricklinkCurrency = null;
      if (item.bricklinkSampleSize === undefined) item.bricklinkSampleSize = null;
      if (item.bricklinkWindow === undefined) item.bricklinkWindow = null;
      if (item.bricklinkUpdatedAt === undefined) item.bricklinkUpdatedAt = null;
    }
  }

  const attempted = [...bySet.keys()];
  const enrichedSets = attempted.filter((setNumber) => bySet.get(setNumber)?.found).length;

  portfolio.bricklinkPilot = {
    attemptedUniqueSets: attempted.length,
    attemptedFromIndex: START_INDEX,
    missingOnly: MISSING_ONLY,
    requestDelayMs: DELAY_MS,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    generatedAt: now,
    methodology: 'Price Guide (catalogPG) > Last 6 Months Sales > New > Avg Price',
    valuationWindow: 'Last 6 Months Sales',
    robotsUrl: robots.robotsUrl,
    fxBase: fx?.base || null,
    fxUpdatedAt: fx?.timeLastUpdateUtc || null,
    enrichedSets,
    missingSets: attempted.length - enrichedSets,
    enrichedItems,
    bySet: attempted.map((setNumber) => ({ setNumber, ...(bySet.get(setNumber) || { found: false }) })),
  };

  await fs.writeFile(PORTFOLIO_PATH, `${JSON.stringify(portfolio, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    attemptedSets: attempted.length,
    enrichedSets,
    enrichedItems,
    missingSets: attempted.length - enrichedSets,
    delayMs: DELAY_MS,
    fxBase: fx?.base || null,
  }, null, 2));
}

main().catch((err) => {
  console.error('[fetch-bricklink-sold] failed:', err.message || err);
  process.exit(1);
});
