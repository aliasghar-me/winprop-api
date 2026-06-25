#!/usr/bin/env node
/**
 * i18n-check.mjs — WinProp API i18n CI guard
 *
 * Checks:
 *   1. Missing Tier-1 keys (ur/ar/fr must have all keys from en/errors.json). EXIT NON-ZERO on failure.
 *      Tier-2 (es/hi/pt/bn) and Tier-3 (ru/zh) missing keys are warnings only.
 *   2. Raw-string AppException: scans src/**‌/*.ts for `new AppException(` whose 3rd argument
 *      is a string literal NOT starting with `errors.`. EXIT NON-ZERO on failure.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const I18N_DIR = join(ROOT, 'src', 'i18n');
const SRC_DIR = join(ROOT, 'src');

const TIER1 = ['ur', 'ar', 'fr'];
const TIER2 = ['es', 'hi', 'pt', 'bn'];
const TIER3 = ['ru', 'zh'];
const ALL_LOCALES = ['ur', 'ar', 'fr', 'es', 'hi', 'pt', 'bn', 'ru', 'zh'];

// ─── helpers ────────────────────────────────────────────────────────────────

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Cannot parse ${path}: ${e.message}`);
    process.exit(1);
  }
}

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function walkFiles(dir, ext) {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and dist
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        results.push(...walkFiles(full, ext));
      } else if (entry.name.endsWith(ext)) {
        results.push(full);
      }
    }
  } catch {
    // dir doesn't exist
  }
  return results;
}

// ─── Check 1: missing Tier-1 keys ───────────────────────────────────────────
// Every user-facing namespace must have full Tier-1 (ur/ar/fr) coverage:
//   errors.json     — AppException business errors
//   validation.json — class-validator messages (H8)
// English is the source of truth for the key set in each namespace.

const NAMESPACES = ['errors', 'validation'];

let keyFailures = 0;

for (const ns of NAMESPACES) {
  const enKeys = flattenKeys(loadJson(join(I18N_DIR, 'en', `${ns}.json`)));

  for (const locale of ALL_LOCALES) {
    const localeJson = loadJson(join(I18N_DIR, locale, `${ns}.json`));
    const localeKeys = new Set(flattenKeys(localeJson));

    const missing = enKeys.filter(k => !localeKeys.has(k));
    if (missing.length === 0) continue;

    const isTier1 = TIER1.includes(locale);
    if (isTier1) {
      console.error(`\n[FAIL] Missing Tier-1 keys in ${locale}/${ns}.json (${missing.length} missing):`);
      for (const k of missing) console.error(`  - ${k}`);
      keyFailures++;
    } else {
      const tier = TIER2.includes(locale) ? 'Tier-2' : 'Tier-3';
      console.warn(`\n[WARN] Missing ${tier} keys in ${locale}/${ns}.json (${missing.length} missing):`);
      for (const k of missing) console.warn(`  - ${k}`);
    }
  }
}

if (keyFailures === 0) {
  console.log(`[OK] Tier-1 locale key coverage (${NAMESPACES.join(', ')}): all present.`);
}

// ─── Check 2: raw-string AppException ───────────────────────────────────────

/**
 * Detects: new AppException(<status>, <code>, '<raw string>')
 * where the 3rd arg is a quoted string NOT starting with errors.
 * We look for the pattern on a single line (multi-line calls are rare and
 * always use errors.* keys per current codebase convention).
 */

const tsFiles = walkFiles(SRC_DIR, '.ts');
const rawStringErrors = [];

// Match new AppException( with at least 3 args, where 3rd is a quoted string
// Pattern: new AppException(<anything>, <anything>, '<not-errors.xxx>')
// We capture the 3rd argument group by looking for the pattern after two commas
const appExPattern = /new AppException\([^,]+,[^,]+,\s*(['"])((?!\s*errors\.)(?!\s*\$\{)[^'"]+)\1/g;

for (const file of tsFiles) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Reset lastIndex for global regex
    appExPattern.lastIndex = 0;
    let match;
    while ((match = appExPattern.exec(line)) !== null) {
      const rawStr = match[2];
      rawStringErrors.push({
        file,
        line: i + 1,
        text: rawStr,
      });
    }
  }
}

if (rawStringErrors.length > 0) {
  console.error(`\n[FAIL] Raw-string AppException detected (use errors.* keys) (${rawStringErrors.length} issues):`);
  for (const err of rawStringErrors) {
    const rel = err.file.replace(ROOT + '/', '');
    console.error(`  ${rel}:${err.line} "${err.text}"`);
  }
} else {
  console.log('[OK] No raw-string AppException found.');
}

// ─── Exit ────────────────────────────────────────────────────────────────────

const totalFailures = keyFailures + (rawStringErrors.length > 0 ? 1 : 0);
if (totalFailures > 0) {
  console.error(`\n✗ i18n check FAILED (${totalFailures} failure type(s)). Fix the issues above.`);
  process.exit(1);
} else {
  console.log('\n✓ i18n check passed.');
}
