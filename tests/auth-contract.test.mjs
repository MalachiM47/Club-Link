import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../js/config.js';

const root = resolve(import.meta.dirname, '..');
const authSource = readFileSync(resolve(root, 'js/auth.js'), 'utf8');
const appSource = readFileSync(resolve(root, 'js/app.js'), 'utf8');
const platformSource = readFileSync(resolve(root, 'js/platform.js'), 'utf8');
const databaseSource = readFileSync(resolve(root, 'js/database.js'), 'utf8');
const runtimeSource = `${authSource}\n${appSource}\n${databaseSource}\n${platformSource}`;

test('Supabase URL is the project base URL, not a REST endpoint', () => {
  const url = new URL(SUPABASE_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.pathname, '/');
  assert.match(url.hostname, /^[a-z0-9-]+\.supabase\.co$/);
});

test('Supabase client uses the current config exports directly', () => {
  assert.match(
    databaseSource,
    /window\.supabase\.createClient\(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,/,
  );
  assert.ok(SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_'));
});

test('officer sign-in uses signInWithPassword with only email trimming', () => {
  assert.match(authSource, /\.auth\.signInWithPassword\(\{\s*email:\s*email\.trim\(\),\s*password,?\s*\}\)/s);
  assert.doesNotMatch(authSource, /password\.trim\s*\(/);
});

test('form submits the exact email and password field values', () => {
  assert.match(
    platformSource,
    /signInOfficer\(data\.get\('email'\),\s*data\.get\('password'\)\)/,
  );
});

test('authentication errors log only their code and message', () => {
  assert.match(authSource, /code:\s*error\.code\s*\?\?\s*null/);
  assert.match(authSource, /message:\s*error\.message/);
  assert.doesNotMatch(authSource, /console\.[a-z]+\([^\n]*password/i);
});

test('no mock or demo authentication branch exists', () => {
  assert.doesNotMatch(runtimeSource, /(?:mock|demo).{0,40}(?:auth|login|sign.?in)|(?:auth|login|sign.?in).{0,40}(?:mock|demo)/i);
});
