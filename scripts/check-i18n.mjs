#!/usr/bin/env node
/**
 * i18n guard (ARCH §16, ADR-0007).
 *
 * Fails when:
 *   1. the message catalogues do not have exactly the same keys;
 *   2. a key used in the source (`t('…')`, `translate(lang, '…')`) is missing from them;
 *   3. a plural entry lacks the `other` form, or a placeholder appears in one language only.
 *
 * Unused keys are reported but do not fail: a key can land one commit before its screen.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const messagesDir = join(root, 'packages/shared/src/messages');
const sourceRoots = ['apps', 'packages'];
const sourceExtensions = ['.ts', '.svelte'];
const skipDirectories = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.svelte-kit',
  'migrations',
  'legacy',
]);

const problems = [];
const notes = [];

/** All catalogues, keyed by language. */
const catalogues = Object.fromEntries(
  readdirSync(messagesDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => [
      file.replace(/\.json$/, ''),
      JSON.parse(readFileSync(join(messagesDir, file), 'utf8')),
    ]),
);

const languages = Object.keys(catalogues).sort();
if (languages.length < 2) {
  problems.push(
    `expected at least two catalogues in ${relative(root, messagesDir)}, found ${languages.length}`,
  );
}

// 1. Key parity between languages.
const reference = languages[0];
const referenceKeys = new Set(Object.keys(catalogues[reference] ?? {}));
for (const language of languages.slice(1)) {
  const keys = new Set(Object.keys(catalogues[language]));
  for (const key of referenceKeys) {
    if (!keys.has(key))
      problems.push(`${language}.json is missing key "${key}" (present in ${reference}.json)`);
  }
  for (const key of keys) {
    if (!referenceKeys.has(key))
      problems.push(`${language}.json has extra key "${key}" (absent from ${reference}.json)`);
  }
}

// 3a. Plural entries must carry `other`; empty strings are never a translation.
for (const language of languages) {
  for (const [key, value] of Object.entries(catalogues[language])) {
    if (typeof value === 'string') {
      if (value.trim() === '') problems.push(`${language}.json: "${key}" is empty`);
      continue;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      problems.push(`${language}.json: "${key}" must be a string or a plural object`);
      continue;
    }
    if (typeof value.other !== 'string') {
      problems.push(`${language}.json: plural "${key}" has no "other" form`);
    }
  }
}

// 3b. A placeholder used in one language must exist in all of them.
const placeholdersOf = (value) => {
  const text = typeof value === 'string' ? value : Object.values(value ?? {}).join(' ');
  return new Set([...String(text).matchAll(/\{(\w+)/g)].map((match) => match[1]));
};
for (const key of referenceKeys) {
  const expected = placeholdersOf(catalogues[reference][key]);
  for (const language of languages.slice(1)) {
    if (!(key in catalogues[language])) continue;
    const actual = placeholdersOf(catalogues[language][key]);
    for (const name of expected) {
      if (!actual.has(name))
        problems.push(`${language}.json: "${key}" does not use placeholder {${name}}`);
    }
    for (const name of actual) {
      if (!expected.has(name))
        problems.push(`${language}.json: "${key}" uses unknown placeholder {${name}}`);
    }
  }
}

// 2. Keys referenced from the source must exist.
function* sourceFiles(directory) {
  for (const entry of readdirSync(directory)) {
    if (skipDirectories.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (sourceExtensions.some((extension) => entry.endsWith(extension))) yield path;
  }
}

/** `t('key')`, `$t('key')`, `translate(language, 'key')`, `tFor(member)('key')`. */
const usagePattern = /(?:^|[^\w$])\$?t\w*\(\s*(?:[^,()'"`]+,\s*)?['"]([\w.-]+)['"]/g;
const isTestFile = (path) => /\.(test|spec)\.[a-z]+$/.test(path);
const used = new Map();
const mentioned = new Set();
for (const sourceRoot of sourceRoots) {
  const directory = join(root, sourceRoot);
  if (!existsSync(directory)) continue;
  for (const file of sourceFiles(directory)) {
    const contents = readFileSync(file, 'utf8');
    // Tests deliberately exercise unknown keys and fallbacks; they cannot vouch for a key either.
    if (isTestFile(file)) continue;
    for (const key of referenceKeys) {
      if (
        contents.includes(`'${key}'`) ||
        contents.includes(`"${key}"`) ||
        contents.includes(`\`${key}\``)
      ) {
        mentioned.add(key);
      }
    }
    for (const match of contents.matchAll(usagePattern)) {
      const key = match[1];
      if (!key.includes('.')) continue; // not a message key, e.g. `test('works')`
      if (!used.has(key)) used.set(key, new Set());
      used.get(key).add(relative(root, file).split(sep).join('/'));
    }
  }
}

for (const [key, files] of used) {
  if (!referenceKeys.has(key)) {
    problems.push(
      `key "${key}" is used in ${[...files].join(', ')} but is not in ${reference}.json`,
    );
  }
}
for (const key of referenceKeys) {
  if (!used.has(key) && !mentioned.has(key)) notes.push(key);
}

if (notes.length > 0) {
  console.log(`i18n: ${notes.length} catalogue key(s) not referenced yet: ${notes.join(', ')}`);
}

if (problems.length > 0) {
  console.error(`i18n check failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `i18n: ${referenceKeys.size} keys × ${languages.length} languages (${languages.join(', ')}) — consistent.`,
);
