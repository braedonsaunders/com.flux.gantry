#!/usr/bin/env node

/**
 * Smart NetSuite Sync Script
 * Only uploads files that have changed since the last sync
 *
 * Usage:
 *   node scripts/sync.js              # Sync changed files since last sync (local dev)
 *   node scripts/sync.js --ci         # Sync only files changed in latest commit (for CI/CD)
 *   node scripts/sync.js --all        # Force sync all files
 *   node scripts/sync.js --watch      # Watch for changes and auto-sync
 *   node scripts/sync.js --no-delete  # Skip deletion of removed files
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

function getGitCommitDeletedFiles() {
    try {
        // Get files deleted in the latest commit using --diff-filter=D
        const output = execSync('git diff --name-only --diff-filter=D HEAD~1 HEAD 2>/dev/null', {
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

function deleteFile(filePath) {
    try {
        // Transform local path to File Cabinet path
        const fileCabinetPath = '/' + filePath.replace(/^src\/FileCabinet\//, '');

        log(`Deleting: ${filePath}`);
        log(`  File Cabinet path: ${fileCabinetPath}`);

        const output = execSync(`suitecloud file:delete --paths "${fileCabinetPath}"`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });

        if (output) {
            log(`  Output: ${output.trim()}`, 'success');
        }
        return true;
    } catch (e) {
        const errorMsg = e.stderr || e.stdout || e.message;
        log(`Failed to delete ${filePath}: ${errorMsg}`, 'error');
        return false;
    }
}

function deleteFiles(files) {
    if (files.length === 0) {
        return { success: 0, failed: 0 };
    }

    log(`Deleting ${files.length} file(s)...`);

    let success = 0;
    let failed = 0;

    for (const file of files) {
        if (deleteFile(file)) {
            success++;
        } else {
            failed++;
        }
    }

    return { success, failed };
}

function uploadFile(filePath) {
    try {
        // Transform local path to File Cabinet path
        // Local: src/FileCabinet/SuiteApps/com.gantry.finance/lib/utils.js
        // CLI needs: /SuiteApps/com.gantry.finance/lib/utils.js
        const fileCabinetPath = '/' + filePath.replace(/^src\/FileCabinet\//, '');

        log(`Uploading: ${filePath}`);
        log(`  File Cabinet path: ${fileCabinetPath}`);

        const output = execSync(`suitecloud file:upload --paths "${fileCabinetPath}"`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Check for failure indicators in the response (CLI returns 0 even on failure)
        if (output && (output.includes('were not uploaded') || output.includes('problem when uploading') || output.includes('does not exist'))) {
            log(`  FAILED: ${output.trim()}`, 'error');
            return false;
        }

        if (output) {
            log(`  Output: ${output.trim()}`, 'success');
        }
        return true;
    } catch (e) {
        const errorMsg = e.stderr || e.stdout || e.message;
        log(`Failed to upload ${filePath}: ${errorMsg}`, 'error');
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
    const noDelete = args.includes('--no-delete');

    if (watchModeEnabled) {
        watchMode();
        return;
    }

    const state = loadSyncState();
    let filesToSync;
    let filesToDelete = [];

    if (forceAll) {
        log('Force syncing all files...');
        filesToSync = getAllFiles(FILE_CABINET_PATH);
    } else if (ciMode) {
        // CI mode: only sync files changed in the latest commit
        log('CI mode: detecting files changed in latest commit...');
        filesToSync = getGitCommitChangedFiles();

        // Detect deleted files unless --no-delete is specified
        if (!noDelete) {
            filesToDelete = getGitCommitDeletedFiles();
        }

        if (filesToSync.length === 0 && filesToDelete.length === 0) {
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

    // Upload new/changed files
    const { success: uploadSuccess, failed: uploadFailed } = uploadFiles(filesToSync);

    // Delete removed files
    const { success: deleteSuccess, failed: deleteFailed } = deleteFiles(filesToDelete);

    // Remove deleted files from sync state
    for (const file of filesToDelete) {
        delete state.fileHashes[file];
    }

    if ((uploadSuccess > 0 || forceAll) && !ciMode) {
        state.lastSync = new Date().toISOString();
        // Update hashes for synced files
        for (const file of filesToSync) {
            state.fileHashes[file] = getFileHash(file);
        }
        saveSyncState(state);
    }

    const totalSuccess = uploadSuccess + deleteSuccess;
    const totalFailed = uploadFailed + deleteFailed;

    if (totalFailed > 0) {
        log(`Completed with errors: ${uploadSuccess} uploaded, ${deleteSuccess} deleted, ${totalFailed} failed`, 'warn');
        process.exit(1);
    } else if (totalSuccess > 0) {
        const parts = [];
        if (uploadSuccess > 0) parts.push(`${uploadSuccess} uploaded`);
        if (deleteSuccess > 0) parts.push(`${deleteSuccess} deleted`);
        log(`Successfully synced: ${parts.join(', ')}`, 'success');
    }
}

main();
