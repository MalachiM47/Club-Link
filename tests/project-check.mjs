import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const requiredFiles = [
  'index.html',
  'privacy.html',
  'terms.html',
  'styles/styles.css',
  'js/app.js',
  'js/auth.js',
  'js/config.js',
  'js/database.js',
  'js/utils.js',
  'assets/favicon.svg',
  'supabase-setup.sql',
  'vercel.json',
  '.vercelignore',
  'README.md',
];

const failures = [];
for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) failures.push(`Missing required file: ${file}`);
}

for (const page of ['index.html', 'privacy.html', 'terms.html']) {
  const html = readFileSync(join(root, page), 'utf8');
  const pageIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = pageIds.filter((id, position) => pageIds.indexOf(id) !== position);
  if (duplicateIds.length) failures.push(`${page} has duplicate ids: ${[...new Set(duplicateIds)].join(', ')}`);
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const path = match[1];
    if (/^(?:https?:|mailto:|data:)/.test(path)) continue;
    const cleanPath = path.split('?')[0];
    if (!existsSync(resolve(dirname(join(root, page)), cleanPath))) {
      failures.push(`${page} references missing local file: ${path}`);
    }
  }
  if (!/<title>[^<]+<\/title>/.test(html)) failures.push(`${page} is missing a page title`);
  if (!/<meta name="description"/.test(html)) failures.push(`${page} is missing a meta description`);
  if (!/rel="icon"/.test(html)) failures.push(`${page} is missing the favicon`);
}

const index = readFileSync(join(root, 'index.html'), 'utf8');
if (!index.includes('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')) {
  failures.push('index.html is missing the Supabase JavaScript v2 browser client');
}
const ids = new Set([...index.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
for (const match of index.matchAll(/<label[^>]+for="([^"]+)"/g)) {
  if (!ids.has(match[1])) failures.push(`index.html label points to missing field: #${match[1]}`);
}
for (const match of index.matchAll(/<button(?![^>]*\stype=)[^>]*>/g)) {
  failures.push(`index.html has a button without an explicit type: ${match[0].slice(0, 80)}`);
}
for (const match of index.matchAll(/href="#([^"]+)"/g)) {
  if (!ids.has(match[1])) failures.push(`index.html links to missing id: #${match[1]}`);
}

const app = readFileSync(join(root, 'js/app.js'), 'utf8');
if (/\.innerHTML\s*=/.test(app)) failures.push('app.js assigns innerHTML; render database text with textContent instead');

const sql = readFileSync(join(root, 'supabase-setup.sql'), 'utf8');
for (const table of ['events', 'event_officer_details', 'announcements', 'club_settings', 'admins']) {
  if (!new RegExp(`alter table public\\.${table} enable row level security`, 'i').test(sql)) {
    failures.push(`RLS is not enabled for ${table}`);
  }
}
if (!/security definer[\s\S]+set search_path = ''/i.test(sql)) failures.push('Officer authorization function needs a fixed search_path');
if (!/revoke all on table public\.events from anon, authenticated/i.test(sql)) failures.push('Least-privilege grants are missing');
if (!/revoke all on table public\.event_officer_details from anon, authenticated/i.test(sql)) failures.push('Private meeting details grants are not restricted');
if (!/Officers can read private meeting details[\s\S]+using \(\(select private\.is_officer\(\)\)\)/i.test(sql)) {
  failures.push('Private meeting details are missing officer-only SELECT protection');
}

const config = readFileSync(join(root, 'js/config.js'), 'utf8');
const configPlaceholders = (config.match(/YOUR_SUPABASE_/g) || []).length;
if (configPlaceholders === 1) failures.push('Supabase config is only partially configured');

for (const jsonFile of ['package.json', 'vercel.json']) {
  try {
    JSON.parse(readFileSync(join(root, jsonFile), 'utf8'));
  } catch (error) {
    failures.push(`${jsonFile} is not valid JSON: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`Project structure check passed (${requiredFiles.length} required files).`);
