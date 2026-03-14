#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORTFOLIO_PATH = path.join(ROOT, 'data', 'portfolio.json');
const MAX_SETS = Number(process.env.BRICKECONOMY_MAX ?? 20);
const DELAY_MS = Number(process.env.BRICKECONOMY_DELAY_MS ?? 2500);
const MISSING_ONLY = String(process.env.BRICKECONOMY_MISSING_ONLY ?? process.env.BRICKECONOMY_REMAINING_ONLY ?? '1') !== '0';
const START_INDEX = Number(process.env.BRICKECONOMY_START_INDEX ?? 0);
const FETCH_TIMEOUT_MS = Number(process.env.BRICKECONOMY_FETCH_TIMEOUT_MS ?? 20000);
const FETCH_TIMEOUT_FALLBACK_MS = Number(process.env.BRICKECONOMY_FETCH_TIMEOUT_FALLBACK_MS ?? 35000);
const CONSECUTIVE_FAILURE_THRESHOLD = Number(process.env.BRICKECONOMY_CONSECUTIVE_FAILURE_THRESHOLD ?? 3);
const COOLDOWN_BASE_MS = Number(process.env.BRICKECONOMY_COOLDOWN_BASE_MS ?? 15000);
const COOLDOWN_MAX_MS = Number(process.env.BRICKECONOMY_COOLDOWN_MAX_MS ?? 120000);
const EARLY_STOP_CONSECUTIVE_FAILURES = Number(process.env.BRICKECONOMY_EARLY_STOP_CONSECUTIVE_FAILURES ?? 9);
const USER_AGENT =
  process.env.BRICKECONOMY_USER_AGENT ||
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

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

function isTimeoutError(err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timed?\s*out/i.test(String(err?.message || ''));
}

async function fetchText(url, extraHeaders = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json,text/html,application/xhtml+xml,text/plain,*/*',
      ...extraHeaders
    }
  });

  const body = await res.text();

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }

  if (/just a moment|cf-chl-|captcha|attention required/i.test(body)) {
    const err = new Error(`HTTP 403 challenge page for ${url}`);
    err.status = 403;
    throw err;
  }

  return body;
}

async function fetchTextWithTimeoutFallback(url, extraHeaders = {}) {
  try {
    const body = await fetchText(url, extraHeaders, FETCH_TIMEOUT_MS);
    return { body, timeoutUsedMs: FETCH_TIMEOUT_MS, usedFallbackTimeout: false };
  } catch (err) {
    if (!isTimeoutError(err) || FETCH_TIMEOUT_FALLBACK_MS <= FETCH_TIMEOUT_MS) throw err;

    const body = await fetchText(url, extraHeaders, FETCH_TIMEOUT_FALLBACK_MS);
    return { body, timeoutUsedMs: FETCH_TIMEOUT_FALLBACK_MS, usedFallbackTimeout: true };
  }
}

async function checkRobots() {
  const robotsUrl = 'https://www.brickeconomy.com/robots.txt';
  const { body: txt } = await fetchTextWithTimeoutFallback(robotsUrl);

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

function buildSearchQueries(setNumber) {
  const primary = String(setNumber || '').trim();
  const sanitized = primary.replace(/\s+/g, '').replace(/[^a-zA-Z0-9-]/g, '');
  const baseVariant = sanitized.includes('-') ? sanitized.split('-')[0] : sanitized;

  return [...new Set([primary, sanitized, baseVariant].filter(Boolean))];
}

function pickBestSuggestion(suggestions, setNumber) {
  const expected = String(setNumber || '').toLowerCase();

  const exact = suggestions.find((s) => String(s?.value || '').toLowerCase().startsWith(`${expected}:`));
  if (exact) return exact;

  const normalizedExpected = expected.replace(/[^a-z0-9]/g, '');
  return (
    suggestions.find((s) => {
      const lead = String(s?.value || '').split(':')[0].toLowerCase();
      return lead.replace(/[^a-z0-9]/g, '') === normalizedExpected;
    }) || null
  );
}

async function lookupSetPath(setNumber) {
  const queries = buildSearchQueries(setNumber);
  const attempts = [];

  for (const query of queries) {
    const url = `https://www.brickeconomy.com/search.ashx?query=${encodeURIComponent(query)}`;
    const { body, usedFallbackTimeout, timeoutUsedMs } = await fetchTextWithTimeoutFallback(url, {
      referer: 'https://www.brickeconomy.com/',
      'x-requested-with': 'XMLHttpRequest'
    });

    attempts.push({ query, usedFallbackTimeout, timeoutUsedMs });
    if (!body.trim()) continue;

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }

    const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    const best = pickBestSuggestion(suggestions, setNumber);
    if (best?.data) {
      return { setPath: best.data, searchAttempts: attempts };
    }
  }

  return { setPath: null, searchAttempts: attempts };
}

async function fetchBrickEconomyValue(setNumber) {
  const { setPath, searchAttempts } = await lookupSetPath(setNumber);
  if (!setPath) return { found: false, reason: 'no-search-match', searchAttempts };

  const setUrl = `https://www.brickeconomy.com${setPath}`;
  const { body: html, usedFallbackTimeout, timeoutUsedMs } = await fetchTextWithTimeoutFallback(setUrl, {
    referer: 'https://www.brickeconomy.com/'
  });
  const value = extractValue(html);

  if (!value || value.brickeconomyValue == null) {
    return { found: false, reason: 'value-not-found', setUrl, searchAttempts, usedFallbackTimeout, timeoutUsedMs };
  }

  return {
    found: true,
    setUrl,
    ...value,
    searchAttempts,
    usedFallbackTimeout,
    timeoutUsedMs
  };
}

async function main() {
  const raw = await fs.readFile(PORTFOLIO_PATH, 'utf8');
  const portfolio = JSON.parse(raw);
  const items = Array.isArray(portfolio.items) ? portfolio.items : [];

  const uniqueSetNumbersAll = [...new Set(items.map((i) => i?.setNumber).filter(Boolean))];

  const unresolvedSetNumbers = uniqueSetNumbersAll.filter((setNumber) => {
    if (!MISSING_ONLY) return true;
    const setItems = items.filter((i) => i?.setNumber === setNumber);
    return !setItems.some((i) => toNumberOrNull(i?.brickeconomyValue) != null);
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
  let consecutiveFailures = 0;
  let blockedPatternDetected = false;
  let haltedEarly = false;

  for (const setNumber of uniqueSetNumbers) {
    try {
      const result = await fetchBrickEconomyValue(setNumber);
      resultBySet.set(setNumber, result);

      if (result.found) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures += 1;
      }
    } catch (err) {
      resultBySet.set(setNumber, {
        found: false,
        reason: err.message || 'request-failed',
        status: err?.status ?? null,
        timeout: isTimeoutError(err)
      });
      consecutiveFailures += 1;
    }

    if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      blockedPatternDetected = true;
      const level = Math.max(0, consecutiveFailures - CONSECUTIVE_FAILURE_THRESHOLD);
      const cooldownMs = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** level);
      await sleep(cooldownMs);

      if (
        EARLY_STOP_CONSECUTIVE_FAILURES > 0 &&
        consecutiveFailures >= EARLY_STOP_CONSECUTIVE_FAILURES
      ) {
        haltedEarly = true;
        break;
      }
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

  const attemptedSetNumbers = [...resultBySet.keys()];

  portfolio.brickeconomyPilot = {
    attemptedUniqueSets: attemptedSetNumbers.length,
    attemptedFromIndex: START_INDEX,
    missingOnly: MISSING_ONLY,
    requestDelayMs: DELAY_MS,
    robotsUrl: robots.robotsUrl,
    generatedAt: new Date().toISOString(),
    enrichedItems: enrichedCount,
    missingItems: missingCount,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    fetchTimeoutFallbackMs: FETCH_TIMEOUT_FALLBACK_MS,
    consecutiveFailureThreshold: CONSECUTIVE_FAILURE_THRESHOLD,
    cooldownBaseMs: COOLDOWN_BASE_MS,
    cooldownMaxMs: COOLDOWN_MAX_MS,
    earlyStopConsecutiveFailures: EARLY_STOP_CONSECUTIVE_FAILURES,
    blockedPatternDetected,
    haltedEarly,
    bySet: attemptedSetNumbers.map((setNumber) => ({
      setNumber,
      ...(resultBySet.get(setNumber) || { found: false, reason: 'unknown' })
    }))
  };

  await fs.writeFile(PORTFOLIO_PATH, `${JSON.stringify(portfolio, null, 2)}\n`, 'utf8');

  const enrichedSets = attemptedSetNumbers.filter((n) => resultBySet.get(n)?.found).length;
  const missingSets = attemptedSetNumbers.length - enrichedSets;
  const cumulativeEnrichedSets = uniqueSetNumbersAll.filter((setNumber) =>
    items.some((i) => i?.setNumber === setNumber && toNumberOrNull(i?.brickeconomyValue) != null)
  ).length;
  const remainingSetsWithoutBrickEconomy = uniqueSetNumbersAll.length - cumulativeEnrichedSets;

  console.log(
    JSON.stringify(
      {
        attemptedSets: attemptedSetNumbers.length,
        startIndex: START_INDEX,
        missingOnly: MISSING_ONLY,
        unresolvedSetPool: unresolvedSetNumbers.length,
        enrichedSets,
        missingSets,
        enrichedItems: enrichedCount,
        missingItems: missingCount,
        delayMs: DELAY_MS,
        cumulativeEnrichedSets,
        remainingSetsWithoutBrickEconomy,
        fetchTimeoutMs: FETCH_TIMEOUT_MS,
        fetchTimeoutFallbackMs: FETCH_TIMEOUT_FALLBACK_MS,
        blockedPatternDetected,
        haltedEarly
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
