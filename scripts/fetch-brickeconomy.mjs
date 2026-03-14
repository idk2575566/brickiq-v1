#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORTFOLIO_PATH = path.join(ROOT, 'data', 'portfolio.json');
const MAX_SETS = Number(process.env.BRICKECONOMY_MAX ?? 20);
const DELAY_MS = Number(process.env.BRICKECONOMY_DELAY_MS ?? 2500);
const REMAINING_ONLY = String(process.env.BRICKECONOMY_REMAINING_ONLY ?? '1') !== '0';
const START_INDEX = Number(process.env.BRICKECONOMY_START_INDEX ?? 0);
const FETCH_TIMEOUT_MS = Number(process.env.BRICKECONOMY_FETCH_TIMEOUT_MS ?? 20000);
const USER_AGENT =
  process.env.BRICKECONOMY_USER_AGENT ||
  'BrickIQ-Pilot/0.1 (+local data-enrichment; non-commercial; contact: local-runner)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMoney(raw) {
  if (!raw) return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractValue(html) {
  const metaCurrent = html.match(/current value of .*? is around\s*\$([\d,.]+)\s*([A-Z]{3})/i);
  if (metaCurrent) {
    return { brickeconomyValue: parseMoney(metaCurrent[1]), brickeconomyCurrency: metaCurrent[2] };
  }

  const jsonLike = html.match(/"current(?:\s+set)?\s*value"\s*:\s*"?\$?([\d,.]+)\s*([A-Z]{3})?/i);
  if (jsonLike) {
    return {
      brickeconomyValue: parseMoney(jsonLike[1]),
      brickeconomyCurrency: jsonLike[2] || 'USD'
    };
  }

  return null;
}

async function fetchText(url, extraHeaders = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json,text/html,application/xhtml+xml,text/plain,*/*',
      ...extraHeaders
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.text();
}

async function checkRobots() {
  const robotsUrl = 'https://www.brickeconomy.com/robots.txt';
  const txt = await fetchText(robotsUrl);

  const lines = txt.split(/\r?\n/);
  let inWildcardBlock = false;
  let wildcardDisallowRoot = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^User-agent:/i.test(trimmed)) {
      inWildcardBlock = /^User-agent:\s*\*$/i.test(trimmed);
      continue;
    }

    if (inWildcardBlock && /^Disallow:\s*\/$/i.test(trimmed)) {
      wildcardDisallowRoot = true;
      break;
    }
  }

  return { robotsUrl, disallowAll: wildcardDisallowRoot, snippet: txt.slice(0, 800) };
}

async function lookupSetPath(setNumber) {
  const url = `https://www.brickeconomy.com/search.ashx?query=${encodeURIComponent(setNumber)}`;
  const body = await fetchText(url, {
    referer: 'https://www.brickeconomy.com/',
    'x-requested-with': 'XMLHttpRequest'
  });

  if (!body.trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const exact = suggestions.find((s) => String(s?.value || '').startsWith(`${setNumber}:`));
  return exact?.data || null;
}

async function fetchBrickEconomyValue(setNumber) {
  const setPath = await lookupSetPath(setNumber);
  if (!setPath) return { found: false, reason: 'no-search-match' };

  const setUrl = `https://www.brickeconomy.com${setPath}`;
  const html = await fetchText(setUrl, { referer: 'https://www.brickeconomy.com/' });
  const value = extractValue(html);

  if (!value || value.brickeconomyValue == null) {
    return { found: false, reason: 'value-not-found', setUrl };
  }

  return {
    found: true,
    setUrl,
    ...value
  };
}

async function main() {
  const raw = await fs.readFile(PORTFOLIO_PATH, 'utf8');
  const portfolio = JSON.parse(raw);
  const items = Array.isArray(portfolio.items) ? portfolio.items : [];

  const uniqueSetNumbersAll = [...new Set(items.map((i) => i?.setNumber).filter(Boolean))];
  const unresolvedSetNumbers = uniqueSetNumbersAll.filter((setNumber) => {
    if (!REMAINING_ONLY) return true;
    const hit = items.find((i) => i?.setNumber === setNumber);
    return toNumberOrNull(hit?.brickeconomyValue) == null;
  });

  const uniqueSetNumbers = unresolvedSetNumbers.slice(
    Math.max(0, START_INDEX),
    Math.max(0, START_INDEX) + Math.max(0, MAX_SETS)
  );

  const robots = await checkRobots();
  if (robots.disallowAll) {
    throw new Error('BrickEconomy robots.txt indicates full disallow for User-agent *, aborting.');
  }

  const resultBySet = new Map();
  for (const setNumber of uniqueSetNumbers) {
    try {
      const result = await fetchBrickEconomyValue(setNumber);
      resultBySet.set(setNumber, result);
    } catch (err) {
      resultBySet.set(setNumber, { found: false, reason: err.message || 'request-failed' });
    }

    await sleep(DELAY_MS);
  }

  let enrichedCount = 0;
  let missingCount = 0;

  for (const item of items) {
    const result = resultBySet.get(item.setNumber);
    if (!result) continue;

    if (result.found) {
      item.brickeconomyValue = result.brickeconomyValue;
      item.brickeconomyCurrency = result.brickeconomyCurrency || 'USD';
      item.brickeconomyUrl = result.setUrl;
      item.brickeconomyUpdatedAt = new Date().toISOString();
      enrichedCount += 1;
    } else {
      if (item.brickeconomyValue === undefined) item.brickeconomyValue = null;
      if (item.brickeconomyCurrency === undefined) item.brickeconomyCurrency = null;
      if (item.brickeconomyUrl === undefined) item.brickeconomyUrl = null;
      if (item.brickeconomyUpdatedAt === undefined) item.brickeconomyUpdatedAt = null;
      missingCount += 1;
    }
  }

  portfolio.brickeconomyPilot = {
    attemptedUniqueSets: uniqueSetNumbers.length,
    attemptedFromIndex: START_INDEX,
    remainingOnly: REMAINING_ONLY,
    requestDelayMs: DELAY_MS,
    robotsUrl: robots.robotsUrl,
    generatedAt: new Date().toISOString(),
    enrichedItems: enrichedCount,
    missingItems: missingCount,
    bySet: uniqueSetNumbers.map((setNumber) => ({
      setNumber,
      ...(resultBySet.get(setNumber) || { found: false, reason: 'unknown' })
    }))
  };

  await fs.writeFile(PORTFOLIO_PATH, `${JSON.stringify(portfolio, null, 2)}\n`, 'utf8');

  const enrichedSets = uniqueSetNumbers.filter((n) => resultBySet.get(n)?.found).length;
  const missingSets = uniqueSetNumbers.length - enrichedSets;
  const cumulativeEnrichedSets = uniqueSetNumbersAll.filter((setNumber) =>
    items.some((i) => i?.setNumber === setNumber && toNumberOrNull(i?.brickeconomyValue) != null)
  ).length;
  const remainingSetsWithoutBrickEconomy = uniqueSetNumbersAll.length - cumulativeEnrichedSets;

  console.log(
    JSON.stringify(
      {
        attemptedSets: uniqueSetNumbers.length,
        startIndex: START_INDEX,
        remainingOnly: REMAINING_ONLY,
        unresolvedSetPool: unresolvedSetNumbers.length,
        enrichedSets,
        missingSets,
        enrichedItems: enrichedCount,
        missingItems: missingCount,
        delayMs: DELAY_MS,
        cumulativeEnrichedSets,
        remainingSetsWithoutBrickEconomy,
        fetchTimeoutMs: FETCH_TIMEOUT_MS
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[fetch-brickeconomy] failed:', err.message || err);
  process.exit(1);
});
