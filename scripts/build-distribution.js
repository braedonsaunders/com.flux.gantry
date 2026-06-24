#!/usr/bin/env node

/**
 * Build Distribution Script for Gantry Financial Suite
 *
 * Prepares the SuiteApp for distribution via SuiteBundler by copying all
 * source files to dist/bundle/ and writing a build manifest.
 *
 * Usage:
 *   node scripts/build-distribution.js          # Build
 *   node scripts/build-distribution.js --clean  # Clean dist folder first
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    srcDir: path.join(__dirname, '..', 'src', 'FileCabinet', 'SuiteApps', 'com.gantry.finance'),
    distDir: path.join(__dirname, '..', 'dist', 'bundle', 'FileCabinet', 'SuiteApps', 'com.gantry.finance'),
    manifestPath: path.join(__dirname, '..', 'dist', 'bundle-manifest.json'),

    product: {
        name: 'Gantry Financial Suite',
        id: 'com.gantry.finance',
        version: '2.1.0'
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function log(message, type = 'info') {
    const prefix = {
        info: '\x1b[36m[BUILD]\x1b[0m',
        success: '\x1b[32m[BUILD]\x1b[0m',
        error: '\x1b[31m[BUILD]\x1b[0m',
        warn: '\x1b[33m[BUILD]\x1b[0m'
    };
    console.log(`${prefix[type]} ${message}`);
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function copyFile(src, dest) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
}

function getAllFiles(dir, files = [], relativeTo = dir) {
    if (!fs.existsSync(dir)) return files;

    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            getAllFiles(fullPath, files, relativeTo);
        } else {
            files.push({
                absolute: fullPath,
                relative: path.relative(relativeTo, fullPath)
            });
        }
    }
    return files;
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILD PROCESS
// ═══════════════════════════════════════════════════════════════════════════

function buildDistribution(options = {}) {
    const startTime = Date.now();
    const cleanFirst = options.clean || false;

    log('Starting Gantry distribution build...');
    log(`Source: ${CONFIG.srcDir}`);
    log(`Destination: ${CONFIG.distDir}`);

    // Clean if requested
    if (cleanFirst) {
        log('Cleaning dist folder...');
        cleanDir(path.dirname(CONFIG.distDir));
    }

    // Ensure dist directory exists
    ensureDir(CONFIG.distDir);

    // Get all source files
    const sourceFiles = getAllFiles(CONFIG.srcDir);
    log(`Found ${sourceFiles.length} files to process`);

    const manifest = {
        product: CONFIG.product,
        buildDate: new Date().toISOString(),
        files: []
    };

    // Copy every source file verbatim
    for (const file of sourceFiles) {
        const destPath = path.join(CONFIG.distDir, file.relative);
        copyFile(file.absolute, destPath);
        manifest.files.push(file.relative);
    }

    manifest.fileCount = manifest.files.length;

    // Write manifest
    ensureDir(path.dirname(CONFIG.manifestPath));
    fs.writeFileSync(CONFIG.manifestPath, JSON.stringify(manifest, null, 2));

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log('');
    log('═══════════════════════════════════════════════════════════════', 'success');
    log(`Build completed in ${duration}s`, 'success');
    log(`  Total files: ${manifest.fileCount}`, 'success');
    log(`  Output: ${path.dirname(CONFIG.distDir)}`, 'success');
    log(`  Manifest: ${CONFIG.manifestPath}`, 'success');
    log('═══════════════════════════════════════════════════════════════', 'success');

    return manifest;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

function printUsage() {
    console.log(`
Gantry Distribution Builder

Usage:
  node scripts/build-distribution.js [options]

Options:
  --clean    Clean dist folder before building
  --help     Show this help message

Output:
  dist/bundle/              - Ready-to-upload SuiteApp files
  dist/bundle-manifest.json - Build manifest
`);
}

function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        printUsage();
        process.exit(0);
    }

    const options = {
        clean: args.includes('--clean')
    };

    try {
        buildDistribution(options);
        process.exit(0);
    } catch (e) {
        log(`Build failed: ${e.message}`, 'error');
        console.error(e.stack);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = { buildDistribution, CONFIG };
