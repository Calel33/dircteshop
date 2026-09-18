#!/usr/bin/env node

/**
 * Tech Debt Tracker
 * Scans for TODO/FIXME comments that are not linked to GitHub issues
 * Usage: node scripts/check-tech-debt.js
 *
 * Valid formats:
 * - TODO(TICKET-123): description
 * - FIXME(#456): description
 * - TODO: description (warnings only)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  '.git',
  'coverage',
  '.swarm',
]);

const TECH_DEBT_PATTERN = /TODO|FIXME/g;
const LINKED_PATTERN = /(?:TODO|FIXME)\s*\(\s*(?:#\d+|[A-Z]+-\d+)\s*\)/i;

let filesChecked = 0;
let unlinkedCount = 0;
const unlinkedIssues = [];

function shouldIgnoreFile(filePath) {
  const basename = path.basename(filePath);
  return (
    basename.startsWith('.') ||
    basename === 'package.json' ||
    basename === 'package-lock.json' ||
    basename === 'pnpm-lock.yaml' ||
    filePath.endsWith('.min.js') ||
    filePath.endsWith('.min.css')
  );
}

function scanDirectory(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    entries.forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(process.cwd(), fullPath);

      if (EXCLUDED_DIRS.has(entry.name)) return;
      if (shouldIgnoreFile(fullPath)) return;

      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (isSourceFile(entry.name)) {
        scanFile(fullPath, relativePath);
      }
    });
  } catch (err) {
    // Silently skip directories we can't read
  }
}

function isSourceFile(filename) {
  const extensions = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.go',
    '.java',
    '.rs',
    '.rb',
    '.sh',
  ];
  return extensions.some((ext) => filename.endsWith(ext));
}

function scanFile(filePath, relativePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    filesChecked++;

    lines.forEach((line, index) => {
      if (!TECH_DEBT_PATTERN.test(line)) return;

      // Check if it's a linked TODO/FIXME
      if (!LINKED_PATTERN.test(line)) {
        unlinkedCount++;
        unlinkedIssues.push({
          file: relativePath,
          line: index + 1,
          content: line.trim().substring(0, 80),
        });
      }
    });
  } catch (err) {
    // Silently skip files we can't read
  }
}

function formatOutput() {
  console.log(`\n📊 Tech Debt Report`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Files scanned: ${filesChecked}`);
  console.log(`Unlinked TODO/FIXME comments: ${unlinkedCount}`);

  if (unlinkedCount > 0) {
    console.log(`\n⚠️  Unlinked Tech Debt (requires issue reference):\n`);
    unlinkedIssues.forEach((issue) => {
      console.log(
        `  ${issue.file}:${issue.line}`
      );
      console.log(`    ${issue.content}...`);
      console.log(
        `    ✅ Suggestion: Use TODO(#123) or FIXME(TICKET-456) format\n`
      );
    });
    console.log(`\n💡 Format your tech debt:\n`);
    console.log(`  ❌ TODO: Fix this later`);
    console.log(`  ✅ TODO(#123): Fix this in issue #123`);
    console.log(`  ✅ FIXME(TICKET-456): Revisit per TICKET-456\n`);
  } else {
    console.log(`\n✨ No unlinked tech debt found! All TODO/FIXME comments are linked.\n`);
  }
}

// Main execution
const startDir = process.cwd();
scanDirectory(startDir);
formatOutput();

// Exit with error code if unlinked tech debt found and not in --warn mode
if (unlinkedCount > 0 && !process.argv.includes('--warn')) {
  process.exit(1);
}
