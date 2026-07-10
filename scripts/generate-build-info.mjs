#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const appVersion = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';

const readGitValue = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (error) {
    // Some restricted runners report EPERM after a successful read-only Git
    // command while still returning status 0 and the complete stdout payload.
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    if (error?.status === 0 && stdout) {
      return stdout;
    }
    throw error;
  }
};

try {
  const gitHash = readGitValue(['rev-parse', '--short', 'HEAD']);
  const gitBranch = readGitValue(['rev-parse', '--abbrev-ref', 'HEAD']);
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
