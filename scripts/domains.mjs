#!/usr/bin/env node
// Zero-dep on purpose: CI runs it on bare Node 22 without npm install.
//
//   node scripts/domains.mjs validate
//   node scripts/domains.mjs add <host> [first|last]
//   node scripts/domains.mjs remove <host>

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const FILE = 'domains.json';
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const KEYS = new Set(['version', 'updated_at', 'domains']);

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch (e) {
    die(`${FILE}: ${e.message}`);
  }
}

function check(data) {
  const errs = [];
  for (const k of Object.keys(data)) if (!KEYS.has(k)) errs.push(`unknown key "${k}"`);
  if (data.version !== 1) errs.push('version must be 1');
  if (typeof data.updated_at !== 'string' || Number.isNaN(Date.parse(data.updated_at)))
    errs.push('updated_at must be ISO 8601');
  if (!Array.isArray(data.domains) || data.domains.length === 0) {
    errs.push('domains must be a non-empty array');
    return errs;
  }
  const seen = new Set();
  data.domains.forEach((h, i) => {
    if (typeof h !== 'string' || !HOST_RE.test(h)) errs.push(`domains[${i}]: invalid host ${JSON.stringify(h)}`);
    else if (seen.has(h)) errs.push(`domains[${i}]: duplicate "${h}"`);
    seen.add(h);
  });
  return errs;
}

function save(data) {
  data.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const errs = check(data);
  if (errs.length) die(errs.join('; '));
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
}

// Forgiving input from the Actions form: "https://Foo.com/path", "foo.com:443" → "foo.com"
function normalize(input) {
  const host = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  if (!HOST_RE.test(host)) die(`invalid domain "${input}"`);
  return host;
}

function report(data, title) {
  const rows = data.domains.map((h, i) => `${i + 1}. \`${h}\`${i === 0 ? ' (primary)' : ''}`);
  console.log(`${title}\n${rows.join('\n')}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${title}\n\n${rows.join('\n')}\n`);
}

const [cmd, arg, pos = 'last'] = process.argv.slice(2);

switch (cmd) {
  case 'validate': {
    const data = load();
    const errs = check(data);
    if (errs.length) die(`${FILE}: ${errs.length} error(s)\n  - ${errs.join('\n  - ')}`);
    console.log(`${FILE}: OK (${data.domains.length} domains)`);
    break;
  }
  case 'add': {
    const host = normalize(arg);
    if (pos !== 'first' && pos !== 'last') die(`position must be first|last, got "${pos}"`);
    const data = load();
    if (data.domains.includes(host)) die(`"${host}" already in list`);
    pos === 'first' ? data.domains.unshift(host) : data.domains.push(host);
    save(data);
    report(data, `Added ${host}`);
    break;
  }
  case 'remove': {
    const host = normalize(arg);
    const data = load();
    if (!data.domains.includes(host)) die(`"${host}" not in list`);
    if (data.domains.length === 1) die('refusing to remove the last domain');
    data.domains = data.domains.filter((h) => h !== host);
    save(data);
    report(data, `Removed ${host}`);
    break;
  }
  default:
    die('usage: domains.mjs validate | add <host> [first|last] | remove <host>');
}
