import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));
const coverageDir = path.resolve(workspaceRoot, '.v8-coverage');
const outputDir = path.resolve(workspaceRoot, 'coverage');

function getCoverageFiles(dir) {
  try {
    return readdirSync(dir).filter((file) => file.endsWith('.json')).map((file) => path.join(dir, file));
  } catch {
    return [];
  }
}

function collectNewlineOffsets(source) {
  const offsets = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  offsets.push(source.length);
  return offsets;
}

function offsetToLine(offset, newlineOffsets) {
  let low = 0;
  let high = newlineOffsets.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (newlineOffsets[mid] <= offset) low = mid; else high = mid - 1;
  }
  return low + 1; // 1-indexed
}

function mergeRangeHits(lineHits, start, end, count) {
  for (let line = start; line <= end; line += 1) {
    const current = lineHits.get(line) || 0;
    lineHits.set(line, current + count);
  }
}

function summarizeFileCoverage(fileCoverage) {
  if (!existsSync(fileCoverage.url)) {
    return null;
  }
  const source = readFileSync(fileCoverage.url, 'utf8');
  const newlineOffsets = collectNewlineOffsets(source);
  const lineHits = new Map();

  for (const fn of fileCoverage.functions || []) {
    for (const range of fn.ranges || []) {
      const startLine = offsetToLine(range.startOffset, newlineOffsets);
      const endLine = offsetToLine(Math.max(range.endOffset - 1, range.startOffset), newlineOffsets);
      mergeRangeHits(lineHits, startLine, endLine, range.count);
    }
  }

  let total = 0;
  let covered = 0;
  const uncoveredLines = [];

  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    if (lines[i].trim() === '') continue;
    total += 1;
    const hits = lineHits.get(lineNumber) || 0;
    if (hits > 0) covered += 1; else uncoveredLines.push(lineNumber);
  }

  return { total, covered, pct: total === 0 ? 100 : (covered / total) * 100, uncoveredLines };
}

const coverageFiles = getCoverageFiles(coverageDir);
if (coverageFiles.length === 0) {
  console.error(`No V8 coverage files found in ${coverageDir}. Run vitest with NODE_V8_COVERAGE first.`);
  process.exit(1);
}

const perFile = new Map();
for (const file of coverageFiles) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const result of data.result || []) {
    const url = result.url?.startsWith('file://') ? fileURLToPath(result.url) : result.url;
    if (!url || !url.startsWith(workspaceRoot)) continue;
    if (url.includes('/node_modules/')) continue;
    if (!result.functions?.length) continue;
    const existing = perFile.get(url) || { url, functions: [] };
    existing.functions.push(...result.functions);
    perFile.set(url, existing);
  }
}

if (perFile.size === 0) {
  console.error('No project coverage data found.');
  process.exit(1);
}

const summaries = [];
let totalLines = 0;
let coveredLines = 0;
for (const fileCoverage of perFile.values()) {
  const summary = summarizeFileCoverage(fileCoverage);
  if (!summary) continue;
  totalLines += summary.total;
  coveredLines += summary.covered;
  summaries.push({ file: path.relative(workspaceRoot, fileCoverage.url), ...summary });
}

summaries.sort((a, b) => a.file.localeCompare(b.file));
const overallPct = totalLines === 0 ? 100 : (coveredLines / totalLines) * 100;

mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({ totalLines, coveredLines, pct: overallPct, files: summaries }, null, 2));

console.log(`Overall line coverage: ${overallPct.toFixed(2)}% (${coveredLines}/${totalLines})`);
console.log('\nTop uncovered files (by uncovered lines):');
for (const entry of summaries
  .filter((s) => s.uncoveredLines.length > 0)
  .sort((a, b) => b.uncoveredLines.length - a.uncoveredLines.length)
  .slice(0, 10)) {
  console.log(`- ${entry.file}: ${entry.pct.toFixed(2)}% (${entry.covered}/${entry.total}), missing lines ${entry.uncoveredLines.slice(0, 20).join(', ')}${entry.uncoveredLines.length > 20 ? '…' : ''}`);
}
