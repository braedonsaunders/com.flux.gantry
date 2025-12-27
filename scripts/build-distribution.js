#!/usr/bin/env node

/**
 * Build Distribution Script for Gantry Financial Suite
 *
 * Prepares the SuiteApp for distribution via SuiteBundler:
 * 1. Copies all files to dist/bundle/
 * 2. Obfuscates client-side JavaScript (browser-executed code)
 * 3. Generates bundle manifest with file classifications
 *
 * Usage:
 *   node scripts/build-distribution.js              # Full build
 *   node scripts/build-distribution.js --no-obfuscate  # Skip obfuscation (dev mode)
 *   node scripts/build-distribution.js --clean      # Clean dist folder first
 *
 * File Classifications:
 *   - Server-side (lib/, suitelet/): Can use "Hide in SuiteBundle" - source hidden from customers
 *   - Client-side (client/): Must be obfuscated - served to browser, cannot be hidden
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    // Source and destination directories
    srcDir: path.join(__dirname, '..', 'src', 'FileCabinet', 'SuiteApps', 'com.gantry.finance'),
    distDir: path.join(__dirname, '..', 'dist', 'bundle', 'FileCabinet', 'SuiteApps', 'com.gantry.finance'),
    manifestPath: path.join(__dirname, '..', 'dist', 'bundle-manifest.json'),

    // Product info for manifest
    product: {
        name: 'Gantry Financial Suite',
        id: 'com.gantry.finance',
        version: '2.1.0',
        vendor: 'Flux for NetSuite'
    },

    // Files that should have "Hide in SuiteBundle" flag (server-side)
    // These files run on NetSuite servers and can be hidden from bundle viewers
    hideScriptFiles: [
        // Suitelets and RESTlets
        'suitelet/Gantry_Suitelet.js',
        'suitelet/Gantry_Router.js',

        // Core libraries
        'lib/Lib_Config.js',
        'lib/Lib_Core.js',
        'lib/Lib_LicenseGuard.js',
        'lib/Lib_Permissions.js',
        'lib/Lib_Dashboard_Registry.js',
        'lib/Lib_Model_Registry.js',

        // Data libraries
        'lib/Lib_Health_Data.js',
        'lib/Lib_Cashflow_Data.js',
        'lib/Lib_Time_Data.js',
        'lib/Lib_Burden_Data.js',
        'lib/Lib_Integrity_Data.js',
        'lib/Lib_VendorPerformance_Data.js',
        'lib/Lib_CustomerValue_Data.js',
        'lib/Lib_SpendVelocity_Data.js',

        // Advisor modules
        'lib/advisor/Lib_Advisor_Orchestrator.js',
        'lib/advisor/Lib_Advisor_StreamingAgent.js',
        'lib/advisor/Lib_Advisor_Cache.js',
        'lib/advisor/Lib_Advisor_Tools.js',
        'lib/advisor/Lib_Advisor_Utils.js',
        'lib/advisor/Lib_Advisor_QueryExecutor.js',
        'lib/advisor/Lib_Advisor_QueryValidator.js',
        'lib/advisor/Lib_Advisor_EntityResolver.js',
        'lib/advisor/Lib_Advisor_AIProviders.js'
    ],

    // Files that need obfuscation (client-side - loaded in browser)
    // These cannot be hidden because browsers need to execute them
    obfuscateFiles: [
        'client/Gantry.App.js',
        'client/core/Gantry.Core.js',
        'client/dashboards/Dashboard.Advisor.js',
        'client/dashboards/Dashboard.Burden.js',
        'client/dashboards/Dashboard.Cashflow.js',
        'client/dashboards/Dashboard.CustomerValue.js',
        'client/dashboards/Dashboard.Health.js',
        'client/dashboards/Dashboard.Integrity.js',
        'client/dashboards/Dashboard.Settings.js',
        'client/dashboards/Dashboard.SpendVelocity.js',
        'client/dashboards/Dashboard.Time.js',
        'client/dashboards/Dashboard.VendorPerformance.js',
        'client/advisor/Gantry.AdvisorRenderer.js'
    ],

    // JavaScript obfuscation settings
    // Balanced for protection while maintaining performance
    obfuscatorOptions: {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.5,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.2,
        debugProtection: false,  // Can cause issues in some browsers
        disableConsoleOutput: false,  // Keep console for debugging in production
        identifierNamesGenerator: 'hexadecimal',
        log: false,
        numbersToExpressions: true,
        renameGlobals: false,  // Don't rename globals - breaks NetSuite integration
        rotateStringArray: true,
        selfDefending: false,  // Can cause issues
        shuffleStringArray: true,
        simplify: true,
        splitStrings: true,
        splitStringsChunkLength: 10,
        stringArray: true,
        stringArrayCallsTransform: true,
        stringArrayCallsTransformThreshold: 0.5,
        stringArrayEncoding: ['base64'],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 1,
        stringArrayWrappersChainedCalls: true,
        stringArrayWrappersParametersMaxCount: 2,
        stringArrayWrappersType: 'variable',
        stringArrayThreshold: 0.75,
        target: 'browser',
        transformObjectKeys: false,  // Keep object keys readable for NS compatibility
        unicodeEscapeSequence: false
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

function getFileExtension(filePath) {
    return path.extname(filePath).toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// OBFUSCATION
// ═══════════════════════════════════════════════════════════════════════════

let JavaScriptObfuscator = null;

function loadObfuscator() {
    if (JavaScriptObfuscator) return true;

    try {
        JavaScriptObfuscator = require('javascript-obfuscator');
        return true;
    } catch (e) {
        log('javascript-obfuscator not installed. Run: npm install javascript-obfuscator', 'warn');
        return false;
    }
}

function obfuscateCode(code, filename) {
    if (!JavaScriptObfuscator) {
        throw new Error('Obfuscator not loaded');
    }

    try {
        const result = JavaScriptObfuscator.obfuscate(code, {
            ...CONFIG.obfuscatorOptions,
            sourceFileName: filename
        });
        return result.getObfuscatedCode();
    } catch (e) {
        log(`Failed to obfuscate ${filename}: ${e.message}`, 'error');
        throw e;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILD PROCESS
// ═══════════════════════════════════════════════════════════════════════════

function buildDistribution(options = {}) {
    const startTime = Date.now();
    const skipObfuscation = options.noObfuscate || false;
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

    // Load obfuscator if needed
    const canObfuscate = !skipObfuscation && loadObfuscator();
    if (skipObfuscation) {
        log('Obfuscation skipped (--no-obfuscate flag)', 'warn');
    } else if (!canObfuscate) {
        log('Proceeding without obfuscation', 'warn');
    }

    // Get all source files
    const sourceFiles = getAllFiles(CONFIG.srcDir);
    log(`Found ${sourceFiles.length} files to process`);

    // Track file classifications
    const manifest = {
        product: CONFIG.product,
        buildDate: new Date().toISOString(),
        buildOptions: {
            obfuscated: canObfuscate && !skipObfuscation,
            obfuscatorVersion: canObfuscate ? require('javascript-obfuscator/package.json').version : null
        },
        files: {
            total: 0,
            hidden: [],      // Server-side files (can be hidden in SuiteBundle)
            obfuscated: [],  // Client-side files (were obfuscated)
            plain: []        // Other files (CSS, HTML, etc.)
        }
    };

    // Convert config arrays to Sets for faster lookup
    const hideSet = new Set(CONFIG.hideScriptFiles.map(f => f.replace(/\//g, path.sep)));
    const obfuscateSet = new Set(CONFIG.obfuscateFiles.map(f => f.replace(/\//g, path.sep)));

    // Process each file
    for (const file of sourceFiles) {
        const destPath = path.join(CONFIG.distDir, file.relative);
        const ext = getFileExtension(file.relative);

        manifest.files.total++;

        // Determine file type and processing
        if (ext === '.js') {
            if (hideSet.has(file.relative)) {
                // Server-side file - copy as-is, mark for hiding
                copyFile(file.absolute, destPath);
                manifest.files.hidden.push(file.relative);
                log(`  [HIDE] ${file.relative}`);

            } else if (obfuscateSet.has(file.relative)) {
                // Client-side file - obfuscate if possible
                if (canObfuscate && !skipObfuscation) {
                    try {
                        const code = fs.readFileSync(file.absolute, 'utf8');
                        const obfuscated = obfuscateCode(code, file.relative);
                        ensureDir(path.dirname(destPath));
                        fs.writeFileSync(destPath, obfuscated);
                        manifest.files.obfuscated.push(file.relative);
                        log(`  [OBFS] ${file.relative}`);
                    } catch (e) {
                        // Fall back to plain copy on error
                        copyFile(file.absolute, destPath);
                        manifest.files.plain.push(file.relative);
                        log(`  [SKIP] ${file.relative} (obfuscation failed)`, 'warn');
                    }
                } else {
                    copyFile(file.absolute, destPath);
                    manifest.files.plain.push(file.relative);
                    log(`  [COPY] ${file.relative}`);
                }

            } else {
                // Unknown JS file - just copy
                copyFile(file.absolute, destPath);
                manifest.files.plain.push(file.relative);
                log(`  [COPY] ${file.relative}`);
            }
        } else {
            // Non-JS file (CSS, HTML, XML, etc.) - copy as-is
            copyFile(file.absolute, destPath);
            manifest.files.plain.push(file.relative);
        }
    }

    // Write manifest
    ensureDir(path.dirname(CONFIG.manifestPath));
    fs.writeFileSync(CONFIG.manifestPath, JSON.stringify(manifest, null, 2));

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log('');
    log('═══════════════════════════════════════════════════════════════', 'success');
    log(`Build completed in ${duration}s`, 'success');
    log(`  Total files: ${manifest.files.total}`, 'success');
    log(`  Hidden (server-side): ${manifest.files.hidden.length}`, 'success');
    log(`  Obfuscated (client-side): ${manifest.files.obfuscated.length}`, 'success');
    log(`  Plain copy: ${manifest.files.plain.length}`, 'success');
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
  --no-obfuscate    Skip JavaScript obfuscation (faster, for testing)
  --clean           Clean dist folder before building
  --help            Show this help message

Examples:
  node scripts/build-distribution.js                    # Full production build
  node scripts/build-distribution.js --clean            # Clean build
  node scripts/build-distribution.js --no-obfuscate     # Dev build without obfuscation

Output:
  dist/bundle/          - Ready-to-upload SuiteApp files
  dist/bundle-manifest.json - Build manifest with file classifications
`);
}

function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        printUsage();
        process.exit(0);
    }

    const options = {
        noObfuscate: args.includes('--no-obfuscate'),
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
