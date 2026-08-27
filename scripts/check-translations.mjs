#!/usr/bin/env node
/**
 * Verifies that every locale under public/locales stays in step with English.
 *
 * `i18n.ts` sets `fallbackLng: 'en'`, so a locale that is missing a key does
 * not crash — it silently renders English inside an otherwise translated page.
 * That is exactly how the Roadmap nav entry, the whole Daily Challenge card,
 * and the course duration filter ended up untranslated in eleven languages
 * without anything failing. Nothing in the build compared the key sets, so
 * there was no moment at which the drift could be noticed.
 *
 * Three things are checked, all against `en` as the source of truth:
 *
 *   1. Missing keys   — present in en, absent from the locale.
 *   2. Stray keys     — present in the locale, no longer in en. These are dead
 *                       weight and usually mean a key was renamed in en only.
 *   3. Placeholders   — every `{{name}}` in the English string must appear in
 *                       the translation. A dropped or renamed placeholder
 *                       renders literally ("+{{xp}} XP") to the user.
 *
 * And one check in the other direction:
 *
 *   4. Unknown keys   — every literal `t('some.key')` in the source must exist
 *                       in en. i18next returns the key itself when it cannot
 *                       resolve one, so a typo or a stale namespace renders the
 *                       raw string "some.key" on screen in every language.
 *
 * Usage:
 *   node scripts/check-translations.mjs
 *   npm run check:translations
 *
 * Exits 0 when every locale matches, 1 otherwise.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = join(ROOT, 'public', 'locales');
const SOURCE_LOCALE = 'en';
const FILENAME = 'translation.json';

const PLACEHOLDER_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Matches `t('a.b.c')` / `t("a.b.c")` only. Dynamic keys built from template
 * literals (e.g. `t(\`categoryView.categories.${id}.title\`)`) cannot be
 * resolved statically and are deliberately skipped — those call sites pass a
 * `defaultValue` for exactly that reason.
 */
const T_CALL_PATTERN = /\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g;

/** Directories that never contain app source. */
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'functions', 'public']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/** Flattens a nested translation object into `a.b.c` -> value pairs. */
const flatten = (value, prefix = '', out = new Map()) => {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      flatten(entry, path, out);
    } else {
      out.set(path, entry);
    }
  }
  return out;
};

/** Every `{{placeholder}}` name used in a string, de-duplicated. */
const placeholdersIn = (value) => {
  if (typeof value !== 'string') return new Set();
  const names = new Set();
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    names.add(match[1]);
  }
  return names;
};

const readLocale = (locale) => {
  const path = join(LOCALES_DIR, locale, FILENAME);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
};

/** Recursively collects every app source file worth scanning for t() calls. */
const listSourceFiles = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;

    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      listSourceFiles(full, out);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Every statically-resolvable translation key referenced in the source, mapped
 * to the files that reference it (so a failure points somewhere).
 */
const collectUsedKeys = () => {
  const used = new Map();

  for (const file of listSourceFiles(ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(T_CALL_PATTERN)) {
      const key = match[1];
      if (!used.has(key)) used.set(key, new Set());
      used.get(key).add(file.slice(ROOT.length + 1));
    }
  }

  return used;
};

const listLocales = () =>
  readdirSync(LOCALES_DIR)
    .filter((entry) => statSync(join(LOCALES_DIR, entry)).isDirectory())
    .sort();

const main = () => {
  const locales = listLocales();

  if (!locales.includes(SOURCE_LOCALE)) {
    console.error(`✖ No "${SOURCE_LOCALE}" locale found in ${LOCALES_DIR}`);
    process.exit(1);
  }

  const source = flatten(readLocale(SOURCE_LOCALE));
  const sourceKeys = [...source.keys()];

  console.log(`Comparing ${locales.length - 1} locales against "${SOURCE_LOCALE}" (${sourceKeys.length} keys)\n`);

  let failed = false;

  for (const locale of locales) {
    if (locale === SOURCE_LOCALE) continue;

    const target = flatten(readLocale(locale));

    const missing = sourceKeys.filter((key) => !target.has(key));
    const stray = [...target.keys()].filter((key) => !source.has(key));

    const placeholderIssues = [];
    for (const key of sourceKeys) {
      if (!target.has(key)) continue;

      const expected = placeholdersIn(source.get(key));
      if (expected.size === 0) continue;

      const actual = placeholdersIn(target.get(key));
      const dropped = [...expected].filter((name) => !actual.has(name));
      if (dropped.length > 0) {
        placeholderIssues.push({ key, dropped });
      }
    }

    if (missing.length === 0 && stray.length === 0 && placeholderIssues.length === 0) {
      console.log(`✔ ${locale} — ${target.size} keys, in sync`);
      continue;
    }

    failed = true;
    console.log(`✖ ${locale}`);

    if (missing.length > 0) {
      console.log(`   ${missing.length} missing key(s):`);
      for (const key of missing) console.log(`     - ${key}`);
    }

    if (stray.length > 0) {
      console.log(`   ${stray.length} key(s) not in ${SOURCE_LOCALE}:`);
      for (const key of stray) console.log(`     + ${key}`);
    }

    for (const { key, dropped } of placeholderIssues) {
      console.log(`   ${key} is missing placeholder(s): ${dropped.map((n) => `{{${n}}}`).join(', ')}`);
    }

    console.log('');
  }

  // --- Direction 2: keys the code asks for that en does not define -----------
  const usedKeys = collectUsedKeys();
  const unknownKeys = [...usedKeys.keys()].filter((key) => !source.has(key)).sort();

  if (unknownKeys.length === 0) {
    console.log(`\n✔ source — ${usedKeys.size} translation key(s) referenced, all defined in "${SOURCE_LOCALE}"`);
  } else {
    failed = true;
    console.log(`\n✖ source — ${unknownKeys.length} key(s) referenced but not defined in "${SOURCE_LOCALE}":`);
    for (const key of unknownKeys) {
      console.log(`     - ${key}  (${[...usedKeys.get(key)].sort().join(', ')})`);
    }
    console.log(
      '\n   i18next returns the key itself when it cannot resolve one, so each of\n' +
        '   these renders as the literal string above, in every language.'
    );
  }

  if (failed) {
    console.error(
      '\nOne or more locales have drifted from English.\n' +
        'Add the missing strings to every file under public/locales/<lang>/translation.json.\n' +
        'Because i18n.ts falls back to English, a missing key does not crash — it just\n' +
        'renders English text inside a translated page, which is why this check exists.'
    );
    process.exit(1);
  }

  console.log('\nAll locales are in sync.');
};

main();
