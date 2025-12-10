#!/usr/bin/env node

/**
 * Smart NetSuite Sync Script
 * Only uploads files that have changed since the last sync
 *
 * Usage:
 *   node scripts/sync.js           # Sync changed files since last sync (local dev)
 *   node scripts/sync.js --ci      # Sync only files changed in latest commit (for CI/CD)
 *   node scripts/sync.js --all     # Force sync all files
 *   node scripts/sync.js --watch   # Watch for changes and auto-sync
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SYNC_STATE_FILE = '.sync-state.json';
const FILE_CABINET_PATH = 'src/FileCabinet/SuiteApps/com.gantry.finance';

// File extensions to sync
const SYNCABLE_EXTENSIONS = ['.js', '.css', '.html', '.json', '.xml'];

function log(message, type = 'info') {
    const prefix = {
        info: '\x1b[36m[SYNC]\x1b[0m',
        success: '\x1b[32m[SYNC]\x1b[0m',
        error: '\x1b[31m[SYNC]\x1b[0m',
        warn: '\x1b[33m[SYNC]\x1b[0m'
    };
    console.log(`${prefix[type]} ${message}`);
}

function loadSyncState() {
    try {
        if (fs.existsSync(SYNC_STATE_FILE)) {
            return JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8'));
        }
    } catch (e) {
        log('Could not load sync state, starting fresh', 'warn');
    }
    return { lastSync: null, fileHashes: {} };
}

function saveSyncState(state) {
    fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
}

function getFileHash(filePath) {
    try {
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath);
        // Simple hash: mtime + size + first/last bytes
        return `${stats.mtimeMs}-${stats.size}-${content.slice(0, 100).toString('hex')}`;
    } catch (e) {
        return null;
    }
}

function getAllFiles(dir, files = []) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            getAllFiles(fullPath, files);
        } else if (SYNCABLE_EXTENSIONS.includes(path.extname(item).toLowerCase())) {
            files.push(fullPath);
        }
    }
    return files;
}

function getChangedFiles(state) {
    const allFiles = getAllFiles(FILE_CABINET_PATH);
    const changedFiles = [];
    const newHashes = {};

    for (const file of allFiles) {
        const hash = getFileHash(file);
        newHashes[file] = hash;

        if (!state.fileHashes[file] || state.fileHashes[file] !== hash) {
            changedFiles.push(file);
        }
    }

    return { changedFiles, newHashes };
}

function getGitChangedFiles() {
    try {
        // Get files changed since last commit (staged + unstaged)
        const output = execSync('git diff --name-only HEAD 2>/dev/null || git diff --name-only', {
            encoding: 'utf8'
        }).trim();

        if (!output) return [];

        return output.split('\n')
            .filter(f => f.startsWith(FILE_CABINET_PATH))
            .filter(f => SYNCABLE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    } catch (e) {
        return [];
    }
}

function getGitCommitChangedFiles() {
    try {
        // Get files changed in the latest commit (for CI mode)
        const output = execSync('git diff --name-only HEAD~1 HEAD 2>/dev/null', {
            encoding: 'utf8'
        }).trim();

        if (!output) return [];

        return output.split('\n')
            .filter(f => f.startsWith(FILE_CABINET_PATH))
            .filter(f => SYNCABLE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
            .filter(f => fs.existsSync(f)); // Only include files that exist (not deleted)
    } catch (e) {
        // Fallback: if git diff fails (e.g., first commit), return all files
        log('Could not detect changed files, syncing all files', 'warn');
        return getAllFiles(FILE_CABINET_PATH);
    }
}

function uploadFile(filePath) {
    try {
        log(`Uploading: ${filePath}`);
        execSync(`suitecloud file:upload --paths "${filePath}"`, {
            stdio: 'pipe',
            encoding: 'utf8'
        });
        return true;
    } catch (e) {
        log(`Failed to upload ${filePath}: ${e.message}`, 'error');
        return false;
    }
}

function uploadFiles(files) {
    if (files.length === 0) {
        log('No files to sync', 'success');
        return { success: 0, failed: 0 };
    }

    log(`Syncing ${files.length} file(s)...`);

    let success = 0;
    let failed = 0;

    for (const file of files) {
        if (uploadFile(file)) {
            success++;
        } else {
            failed++;
        }
    }

    return { success, failed };
}

function watchMode() {
    log('Starting watch mode... (Ctrl+C to stop)', 'info');

    const state = loadSyncState();
    let debounceTimer = null;
    let pendingFiles = new Set();

    const watcher = fs.watch(FILE_CABINET_PATH, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = path.join(FILE_CABINET_PATH, filename);
        const ext = path.extname(filename).toLowerCase();

        if (!SYNCABLE_EXTENSIONS.includes(ext)) return;
        if (!fs.existsSync(fullPath)) return;

        pendingFiles.add(fullPath);

        // Debounce: wait 500ms after last change before syncing
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const filesToSync = Array.from(pendingFiles);
            pendingFiles.clear();

            const { success, failed } = uploadFiles(filesToSync);

            if (success > 0) {
                // Update state for successfully synced files
                for (const file of filesToSync) {
                    state.fileHashes[file] = getFileHash(file);
                }
                state.lastSync = new Date().toISOString();
                saveSyncState(state);
                log(`Synced ${success} file(s)${failed > 0 ? `, ${failed} failed` : ''}`, 'success');
            }
        }, 500);
    });

    process.on('SIGINT', () => {
        watcher.close();
        log('Watch mode stopped', 'info');
        process.exit(0);
    });
}

function main() {
    const args = process.argv.slice(2);
    const forceAll = args.includes('--all');
    const ciMode = args.includes('--ci');
    const watchModeEnabled = args.includes('--watch');

    if (watchModeEnabled) {
        watchMode();
        return;
    }

    const state = loadSyncState();
    let filesToSync;

    if (forceAll) {
        log('Force syncing all files...');
        filesToSync = getAllFiles(FILE_CABINET_PATH);
    } else if (ciMode) {
        // CI mode: only sync files changed in the latest commit
        log('CI mode: detecting files changed in latest commit...');
        filesToSync = getGitCommitChangedFiles();
        if (filesToSync.length === 0) {
            log('No SuiteApp files changed in this commit', 'success');
            return;
        }
    } else {
        // Local dev: combine git changes and hash-based detection
        const gitChanges = getGitChangedFiles();
        const { changedFiles, newHashes } = getChangedFiles(state);

        // Merge both detection methods
        filesToSync = [...new Set([...gitChanges, ...changedFiles])];
        state.fileHashes = { ...state.fileHashes, ...newHashes };
    }

    const { success, failed } = uploadFiles(filesToSync);

    if ((success > 0 || forceAll) && !ciMode) {
        state.lastSync = new Date().toISOString();
        // Update hashes for synced files
        for (const file of filesToSync) {
            state.fileHashes[file] = getFileHash(file);
        }
        saveSyncState(state);
    }

    if (failed > 0) {
        log(`Completed with errors: ${success} succeeded, ${failed} failed`, 'warn');
        process.exit(1);
    } else if (success > 0) {
        log(`Successfully synced ${success} file(s)`, 'success');
    }
}

main();
