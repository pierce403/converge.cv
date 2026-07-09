#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const appVersion = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';

try {
  const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  const buildTime = new Date().toISOString();

  const buildInfo = {
    gitHash,
    gitBranch,
    buildTime,
    version: appVersion,
  };

  const outputPath = join(__dirname, '..', 'src', 'build-info.json');
  writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2));

  console.log('[generate-build-info] Build info generated:', buildInfo);
} catch (error) {
  console.error('[generate-build-info] Failed to generate build info:', error);
  // Write fallback
  const fallbackInfo = {
    gitHash: 'unknown',
    gitBranch: 'unknown',
    buildTime: new Date().toISOString(),
    version: appVersion,
  };
  const outputPath = join(__dirname, '..', 'src', 'build-info.json');
  writeFileSync(outputPath, JSON.stringify(fallbackInfo, null, 2));
}
