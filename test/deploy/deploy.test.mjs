import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

test('Dockerfile uses node:24-slim, non-root user, healthcheck, and start.mjs', () => {
  const df = read('Dockerfile');
  assert.match(df, /^FROM node:24-slim/m);
  assert.match(df, /^WORKDIR \/app/m);
  assert.match(df, /npm ci --omit=dev/);
  assert.match(df, /COPY src\/ \.\/src\//);
  assert.match(df, /COPY public\/ \.\/public\//);
  assert.match(df, /COPY openapi\/ \.\/openapi\//);
  assert.match(df, /^USER node/m);
  assert.match(df, /^EXPOSE 3000/m);
  assert.match(df, /^HEALTHCHECK[\s\S]*http:\/\/127\.0\.0\.1:3000\/health/m);
  assert.match(df, /^CMD \["node", "src\/start\.mjs"\]/m);
});

test('.dockerignore excludes git, node_modules, test, docs, env files, and logs', () => {
  const lines = read('.dockerignore')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const entry of ['.git', 'node_modules', 'test', 'docs', '.env*', '*.log']) {
    assert.ok(lines.includes(entry), `.dockerignore missing ${entry}`);
  }
});

test('docker-compose.yml sets single replica, networks, Traefik labels, healthcheck, and all env vars', () => {
  const dc = read('docker-compose.yml');
  assert.match(dc, /container_name:\s*sissi/);
  assert.match(dc, /image:\s*ghcr\.io\/jsilvanus\/sissi:\$\{SISSI_IMAGE_TAG:-latest\}/);
  assert.match(dc, /replicas:\s*1/);
  assert.doesNotMatch(dc, /^\s*ports:/m);
  assert.match(dc, /traefik-public:\s*\n\s*external:\s*true/);
  assert.match(dc, /shared_multi_network:\s*\n\s*external:\s*true/);
  assert.match(dc, /traefik\.enable=true/);
  assert.match(dc, /traefik\.docker\.network=traefik-public/);
  assert.match(dc, /traefik\.http\.routers\.sissi\.rule=Host\(`\$\{SISSI_HOST\}`\) && PathPrefix\(`\$\{SISSI_PUBLIC_PATH:-\/signage\}`\)/);
  assert.match(dc, /traefik\.http\.routers\.sissi\.entrypoints=websecure/);
  assert.match(dc, /traefik\.http\.routers\.sissi\.tls\.certresolver=letsencrypt/);
  assert.match(dc, /traefik\.http\.routers\.sissi\.middlewares=sissi-stripprefix/);
  assert.match(dc, /traefik\.http\.middlewares\.sissi-stripprefix\.stripprefix\.prefixes=\$\{SISSI_PUBLIC_PATH:-\/signage\}/);
  assert.match(dc, /traefik\.http\.services\.sissi\.loadbalancer\.server\.port=3000/);
  assert.match(dc, /http:\/\/127\.0\.0\.1:3000\/health/);
  assert.match(dc, /NODE_ENV=production/);
  assert.match(dc, /PORT=3000/);

  const envExampleVars = read('.env.example')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0])
    .filter((k) => k !== 'SISSI_ALLOW_PRIVATE_DOWNLOADS');

  for (const key of envExampleVars) {
    assert.match(dc, new RegExp(`- ${key}=`), `docker-compose.yml missing ${key}`);
  }
});

test('release.yml runs npm test and pushes ghcr.io/jsilvanus/sissi on main and v* tags', () => {
  const wf = read('.github/workflows/release.yml');
  assert.match(wf, /branches:\s*\n\s*- main/);
  assert.match(wf, /tags:\s*\n\s*- 'v\*'/);
  assert.match(wf, /run:\s*npm test/);
  assert.match(wf, /needs:\s*test/);
  assert.match(wf, /images:\s*ghcr\.io\/jsilvanus\/sissi/);
  assert.match(wf, /docker\/build-push-action/);
  assert.match(wf, /type=sha/);
  assert.match(wf, /type=ref,event=branch/);
  assert.match(wf, /type=semver,pattern=\{\{version\}\}/);
  assert.match(wf, /value=latest,enable=\{\{is_default_branch\}\}/);
});
