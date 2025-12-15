/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_Cache.js
 * Unified caching system for the Advisor
 *
 * Consolidates all caching operations:
 * - Progress: Request state for polling/progressive rendering
 * - Data: Tool results with reference IDs for lightweight LLM prompts
 * - Tool: Cached tool execution results to avoid redundant queries
 * - Dashboard: Dashboard intelligence objects
 *
 * Uses N/cache with different key prefixes for each domain.
 */
define(['N/cache', 'N/log', '../Lib_Dashboard_Registry'], function(cache, log, DashboardRegistry) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CACHE_NAME = 'ADVISOR_CACHE';
    const REF_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

    // TTL Configuration (in seconds)
    const TTL = {
        PROGRESS: 900,      // 15 minutes - request state
        DATA: 600,          // 10 minutes - tool result data
        TOOL: 300,          // 5 minutes - tool result caching
        DASHBOARD: 600,     // 10 minutes - dashboard intelligence
        LOCK: 300           // 5 minutes (NetSuite minimum)
    };

    // Size limits
    const MAX_CACHE_SIZE_KB = 450;
    const MAX_CACHE_SIZE_BYTES = MAX_CACHE_SIZE_KB * 1024;
    const MAX_DATA_SIZE_KB = 400;
    const MAX_DATA_SIZE_BYTES = MAX_DATA_SIZE_KB * 1024;

    // Lock timeouts (logical expiration in ms, since NetSuite min TTL is 300s)
    const LOCK_TIMEOUT_MS = 30000;      // Completion lock
    const PROC_LOCK_TIMEOUT_MS = 15000; // Processing lock

    // Key prefixes
    const PREFIX = {
        PROGRESS: 'prog_',
        DATA: 'data_',
        TOOL: 'tool_',
        DASHBOARD: 'dash_',
        LOCK: 'lock_',
        PROC_LOCK: 'proc_'
    };

    // In-memory cache for dashboard data (per-request optimization)
    let memoryCache = {};

    // ═══════════════════════════════════════════════════════════════════════════
    // LOW-LEVEL CACHE OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getCache() {
        return cache.getCache({
            name: CACHE_NAME,
            scope: cache.Scope.PUBLIC
        });
    }

    function getByteSize(str) {
        let bytes = 0;
        for (let i = 0; i < str.length; i++) {
            const charCode = str.charCodeAt(i);
            if (charCode < 0x80) bytes += 1;
            else if (charCode < 0x800) bytes += 2;
            else if (charCode < 0x10000) bytes += 3;
            else bytes += 4;
        }
        return bytes;
    }

    function safePut(key, data, ttl, maxBytes) {
        try {
            const json = JSON.stringify(data);
            const sizeBytes = getByteSize(json);
            const limit = maxBytes || MAX_CACHE_SIZE_BYTES;

            if (sizeBytes > limit) {
                log.error('Cache.safePut - data too large', {
                    key: key,
                    sizeKB: Math.round(sizeBytes / 1024),
                    maxKB: Math.round(limit / 1024)
                });
                return false;
            }

            getCache().put({ key: key, value: json, ttl: ttl });
            return true;
        } catch (e) {
            log.error('Cache.safePut failed', { key: key, error: e.message });
            return false;
        }
    }

    function safeGet(key) {
        try {
            const raw = getCache().get({ key: key });
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            log.error('Cache.safeGet failed', { key: key, error: e.message });
            return null;
        }
    }

    function safeRemove(key) {
        try {
            getCache().remove({ key: key });
        } catch (e) {
            // Ignore removal errors
        }
    }

    function generateId(prefix) {
        let id = '';
        for (let i = 0; i < 6; i++) {
            id += REF_CHARS.charAt(Math.floor(Math.random() * REF_CHARS.length));
        }
        const timestamp = Date.now().toString(36);
        return `${prefix}${timestamp}_${id}`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PROGRESS STORE - Request State Management
    // ═══════════════════════════════════════════════════════════════════════════

    function generateRequestId() {
        return generateId('adv_');
    }

    function generateLockOwnerId() {
        return Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    }

    function trimAgentStateForStorage(agentState) {
        if (!agentState) return null;
        return {
            ...agentState,
            toolDefinitions: null,
            allToolCalls: (agentState.allToolCalls || []).map(tc => ({
                tool: tc.tool,
                args: tc.args,
                displayName: tc.displayName,
                duration: tc.duration,
                result: tc.result ? {
                    success: tc.result.success,
                    rowCount: tc.result.rowCount || (tc.result.rows ? tc.result.rows.length : 0),
                    found: tc.result.found,
                    entity: tc.result.entity,
                    bestMatch: tc.result.bestMatch,
                    error: tc.result.error,
                    isFormatResponse: tc.result.isFormatResponse,
                    verificationPending: tc.result.verificationPending
                } : null
            }))
        };
    }

    // Completion Lock
    function acquireCompletionLock(requestId) {
        const lockKey = PREFIX.LOCK + requestId;
        const ownerId = generateLockOwnerId();

        try {
            const existing = getCache().get({ key: lockKey });
            if (existing) {
                const lockData = JSON.parse(existing);
                if (Date.now() - lockData.timestamp < LOCK_TIMEOUT_MS) {
                    return false;
                }
            }

            const lockData = { locked: true, timestamp: Date.now(), ownerId: ownerId };
            getCache().put({ key: lockKey, value: JSON.stringify(lockData), ttl: TTL.LOCK });

            const verification = getCache().get({ key: lockKey });
            if (verification) {
                const verifyData = JSON.parse(verification);
                if (verifyData.ownerId !== ownerId) return false;
            }
            return true;
        } catch (e) {
            log.error('acquireCompletionLock failed', { requestId: requestId, error: e.message });
            return false;
        }
    }

    function hasCompletionLock(requestId) {
        const lockKey = PREFIX.LOCK + requestId;
        try {
            const existing = getCache().get({ key: lockKey });
            if (!existing) return false;
            const lockData = JSON.parse(existing);
            return Date.now() - lockData.timestamp < LOCK_TIMEOUT_MS;
        } catch (e) {
            return false;
        }
    }

    function releaseCompletionLock(requestId) {
        safeRemove(PREFIX.LOCK + requestId);
    }

    // Processing Lock
    function acquireProcessingLock(requestId) {
        const lockKey = PREFIX.PROC_LOCK + requestId;
        const ownerId = generateLockOwnerId();

        try {
            const existing = getCache().get({ key: lockKey });
            if (existing) {
                const lockData = JSON.parse(existing);
                if (Date.now() - lockData.timestamp < PROC_LOCK_TIMEOUT_MS) {
                    return false;
                }
            }

            const lockData = { processing: true, timestamp: Date.now(), ownerId: ownerId };
            getCache().put({ key: lockKey, value: JSON.stringify(lockData), ttl: TTL.LOCK });

            const verification = getCache().get({ key: lockKey });
            if (verification) {
                const verifyData = JSON.parse(verification);
                if (verifyData.ownerId !== ownerId) return false;
            }
            return true;
        } catch (e) {
            log.error('acquireProcessingLock failed', { requestId: requestId, error: e.message });
            return false;
        }
    }

    function releaseProcessingLock(requestId) {
        safeRemove(PREFIX.PROC_LOCK + requestId);
    }

    function hasProcessingLock(requestId) {
        const lockKey = PREFIX.PROC_LOCK + requestId;
        try {
            const existing = getCache().get({ key: lockKey });
            if (!existing) return false;
            const lockData = JSON.parse(existing);
            return Date.now() - lockData.timestamp < PROC_LOCK_TIMEOUT_MS;
        } catch (e) {
            return false;
        }
    }

    function isCompleteOrLocked(requestId) {
        if (hasCompletionLock(requestId)) return true;
        const state = safeGet(PREFIX.PROGRESS + requestId);
        return state && (state.status === 'complete' || state.status === 'error');
    }

    // Progress CRUD
    function progressCreate(requestId, message, agentState) {
        const key = PREFIX.PROGRESS + requestId;
        const state = {
            requestId: requestId,
            status: 'processing',
            message: message,
            steps: [],
            startTime: Date.now(),
            lastUpdate: Date.now(),
            answer: null,
            richContent: null,
            sessionContext: null,
            error: null,
            blocks: [],
            agentState: trimAgentStateForStorage(agentState)
        };

        safePut(key, state, TTL.PROGRESS);
        return state;
    }

    function progressGet(requestId) {
        return safeGet(PREFIX.PROGRESS + requestId);
    }

    function progressAddStep(requestId, step) {
        const key = PREFIX.PROGRESS + requestId;
        const state = safeGet(key);
        if (!state) return;

        if (!step.timestamp) step.timestamp = Date.now();
        if (!step.status) step.status = 'complete';

        state.steps.push(step);
        state.lastUpdate = Date.now();
        safePut(key, state, TTL.PROGRESS);
    }

    function progressUpdateStep(requestId, stepData) {
        const key = PREFIX.PROGRESS + requestId;
        const state = safeGet(key);
        if (!state || !state.steps || state.steps.length === 0) return false;

        const phase = stepData.context?.phase;
        if (!phase) {
            Object.assign(state.steps[state.steps.length - 1], stepData);
        } else {
            let stepIndex = -1;
            for (let i = state.steps.length - 1; i >= 0; i--) {
                if (state.steps[i].context?.phase === phase) {
                    stepIndex = i;
                    break;
                }
            }
            if (stepIndex === -1) {
                if (!stepData.timestamp) stepData.timestamp = Date.now();
                state.steps.push(stepData);
            } else {
                Object.assign(state.steps[stepIndex], stepData);
            }
        }

        state.lastUpdate = Date.now();
        return safePut(key, state, TTL.PROGRESS);
    }

    function progressUpdateLastStep(requestId, updates) {
        const key = PREFIX.PROGRESS + requestId;
        const state = safeGet(key);
        if (!state || state.steps.length === 0) return;

        Object.assign(state.steps[state.steps.length - 1], updates);
        state.lastUpdate = Date.now();
        safePut(key, state, TTL.PROGRESS);
    }

    function progressUpdateStepByType(requestId, stepType, updates) {
        const key = PREFIX.PROGRESS + requestId;
        const state = safeGet(key);
        if (!state) return false;

        const stepIndex = state.steps.findIndex(s => s.type === stepType);
        if (stepIndex === -1) return false;

        Object.assign(state.steps[stepIndex], updates);
        state.lastUpdate = Date.now();
        return safePut(key, state, TTL.PROGRESS);
    }

    function progressAddBlock(requestId, block) {
        const key = PREFIX.PROGRESS + requestId;
        const state = safeGet(key);
        if (!state) return;

        if (!state.blocks) state.blocks = [];
        if (!block.timestamp) block.timestamp = Date.now();
        if (!block.id) block.id = 'block_' + state.blocks.length + '_' + Date.now().toString(36);

        state.blocks.push(block);
        state.lastUpdate = Date.now();
        safePut(key, state, TTL.PROGRESS);
    }

    function progressUpdateBlock(requestId, blockId, updates) {
        const key = PREFIX.PROGRESS + requestId;
        const state = safeGet(key);
        if (!state || !state.blocks) return;

        const blockIndex = state.blocks.findIndex(b => b.id === blockId);
        if (blockIndex === -1) return;

        Object.assign(state.blocks[blockIndex], updates);
        state.lastUpdate = Date.now();
        safePut(key, state, TTL.PROGRESS);
    }

    function progressComplete(requestId, result) {
        if (!acquireCompletionLock(requestId)) return false;

        const key = PREFIX.PROGRESS + requestId;
        const state = safeGet(key);
        if (!state) {
            releaseCompletionLock(requestId);
            return false;
        }

        if (state.status === 'complete' || state.status === 'error') {
            releaseCompletionLock(requestId);
            return false;
        }

        state.status = 'complete';
        state.answer = result.answer || result.text || '';
        state.richContent = result.richContent || null;
        state.sessionContext = result.sessionContext || null;
        state.duration = Date.now() - state.startTime;
        state.lastUpdate = Date.now();
        state.model = result.model || null;
        state.provider = result.provider || null;
        state.agentState = null;

        return safePut(key, state, TTL.PROGRESS);
    }

    function progressFail(requestId, error) {
        const key = PREFIX.PROGRESS + requestId;
        let state = safeGet(key);

        if (!state) {
            state = {
                requestId: requestId,
                status: 'error',
                message: '',
                steps: [{ type: 'error', title: 'Request failed', status: 'error', error: error, timestamp: Date.now() }],
                startTime: Date.now(),
                lastUpdate: Date.now(),
                error: error,
                agentState: null,
                duration: 0
            };
        } else {
            state.status = 'error';
            state.error = error;
            state.duration = Date.now() - state.startTime;
            state.lastUpdate = Date.now();
            state.agentState = null;

            if (!state.steps.some(s => s.type === 'error')) {
                state.steps.push({ type: 'error', title: 'An error occurred', status: 'error', error: error, timestamp: Date.now() });
            }
        }

        safePut(key, state, TTL.PROGRESS);
    }

    function progressGetAgentState(requestId) {
        const state = safeGet(PREFIX.PROGRESS + requestId);
        return state?.agentState || null;
    }

    function progressSetAgentState(requestId, agentState) {
        const key = PREFIX.PROGRESS + requestId;
        const state = safeGet(key);
        if (!state) return false;

        state.agentState = trimAgentStateForStorage(agentState);
        state.lastUpdate = Date.now();
        return safePut(key, state, TTL.PROGRESS);
    }

    function progressExists(requestId) {
        return !!safeGet(PREFIX.PROGRESS + requestId);
    }

    function progressRemove(requestId) {
        safeRemove(PREFIX.PROGRESS + requestId);
    }

    function progressGetPollingResponse(requestId) {
        const state = progressGet(requestId);
        if (!state) {
            return { status: 'not_found', error: 'Request not found or expired' };
        }

        const response = {
            requestId: state.requestId,
            status: state.status,
            steps: state.steps,
            duration: Date.now() - state.startTime
        };

        // Include progressive narration if available (from agent state)
        if (state.agentState && state.agentState.narration && state.agentState.narration.text) {
            response.narration = state.agentState.narration;
        }

        if (state.blocks && state.blocks.length > 0) {
            response.blocks = state.blocks;
        }

        if (state.status === 'complete') {
            response.answer = state.answer;
            response.richContent = state.richContent;
            response.sessionContext = state.sessionContext;
            response.model = state.model;
            response.provider = state.provider;
            response.totalDuration = state.duration;
        }

        if (state.status === 'error') {
            response.error = state.error;
        }

        return response;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DATA STORE - Tool Result Storage with References
    // ═══════════════════════════════════════════════════════════════════════════

    function generateDataRefId(toolName) {
        let id = '';
        for (let i = 0; i < 6; i++) {
            id += REF_CHARS.charAt(Math.floor(Math.random() * REF_CHARS.length));
        }
        const prefix = (toolName || 'data').substring(0, 4).toLowerCase();
        return `ref_${prefix}_${id}`;
    }

    function buildDataCacheKey(requestId, refId) {
        return PREFIX.DATA + `${requestId}_${refId}`;
    }

    function generateColumnStats(rows, columnName) {
        const values = rows.map(row => row[columnName]).filter(v => typeof v === 'number' && !isNaN(v));
        if (values.length === 0) return null;

        const sum = values.reduce((a, b) => a + b, 0);
        const sorted = [...values].sort((a, b) => a - b);

        return { sum, avg: sum / values.length, min: sorted[0], max: sorted[sorted.length - 1], count: values.length };
    }

    function detectColumnType(rows, columnName) {
        const samples = rows.slice(0, 10).map(row => row[columnName]).filter(v => v != null);
        if (samples.length === 0) return 'unknown';

        const types = samples.map(v => {
            if (typeof v === 'number') return 'number';
            if (typeof v === 'boolean') return 'boolean';
            if (typeof v === 'string') {
                if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v) || /^\d{4}-\d{2}-\d{2}/.test(v)) return 'date';
                if (/^\$[\d,]+(\.\d{2})?$/.test(v)) return 'currency';
                return 'string';
            }
            return 'unknown';
        });

        const counts = {};
        types.forEach(t => counts[t] = (counts[t] || 0) + 1);
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }

    function formatNumber(num) {
        if (num === null || num === undefined) return 'N/A';
        const isNegative = num < 0;
        const absNum = Math.abs(num);
        const sign = isNegative ? '-' : '';

        if (absNum >= 1000000) return sign + '$' + (absNum / 1000000).toFixed(2) + 'M';
        if (absNum >= 1000) return sign + '$' + (absNum / 1000).toFixed(1) + 'K';
        return sign + '$' + absNum.toFixed(2);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENTIC STRUCTURAL DATA AWARENESS
    // Auto-detect categorical columns, compute distributions, stratified sampling
    // This ensures LLM knows the COMPLETE structure of data, not just first N rows
    // ═══════════════════════════════════════════════════════════════════════════

    const CATEGORICAL_THRESHOLD = 50; // Max unique values to be considered categorical

    function generateDataSummary(result, toolName) {
        const rows = result.rows || [];
        const columns = result.columns || Object.keys(rows[0] || {});

        const summary = {
            tool: toolName,
            rowCount: rows.length,
            columnCount: columns.length,
            columns: columns,
            isEmpty: rows.length === 0
        };

        if (rows.length === 0) {
            summary.message = 'No data returned';
            return summary;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 1: Schema detection with column types and stats
        // ═══════════════════════════════════════════════════════════════════════
        summary.schema = {};
        columns.forEach(col => {
            const type = detectColumnType(rows, col);
            summary.schema[col] = { type };
            if (type === 'number' || type === 'currency') {
                const stats = generateColumnStats(rows, col);
                if (stats) summary.schema[col].stats = stats;
            }
        });

        const numericColumns = columns.filter(col =>
            summary.schema[col].type === 'number' || summary.schema[col].type === 'currency'
        );

        // Find the "main" numeric column for aggregations
        const mainNumericCol = numericColumns.find(c =>
            c.includes('total') || c.includes('revenue') || c.includes('amount') || c.includes('spend')
        ) || numericColumns[0];

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 2: CATEGORICAL COLUMN DETECTION & DISTRIBUTION
        // This is the KEY agentic feature - LLM sees ALL categories that exist
        // ═══════════════════════════════════════════════════════════════════════
        summary.categoricalColumns = [];

        columns.forEach(col => {
            const colType = summary.schema[col].type;
            // Only analyze string columns or columns that look categorical
            if (colType !== 'string' && colType !== 'unknown') return;

            // Get unique values
            const uniqueValues = new Set();
            rows.forEach(row => {
                const val = row[col];
                if (val !== null && val !== undefined && val !== '') {
                    uniqueValues.add(val);
                }
            });

            // If under threshold, treat as categorical
            if (uniqueValues.size > 0 && uniqueValues.size <= CATEGORICAL_THRESHOLD) {
                // Compute distribution: count and sum per category
                const distribution = {};
                rows.forEach(row => {
                    const catValue = row[col];
                    if (catValue === null || catValue === undefined || catValue === '') return;

                    if (!distribution[catValue]) {
                        distribution[catValue] = { count: 0, sum: 0 };
                    }
                    distribution[catValue].count++;

                    // Sum the main numeric column for this category
                    if (mainNumericCol) {
                        const numVal = row[mainNumericCol];
                        if (typeof numVal === 'number' && !isNaN(numVal)) {
                            distribution[catValue].sum += numVal;
                        }
                    }
                });

                // Convert to sorted array (by count descending)
                const distArray = Object.entries(distribution)
                    .map(([value, stats]) => ({
                        value,
                        count: stats.count,
                        sum: stats.sum,
                        sumFormatted: mainNumericCol ? formatNumber(stats.sum) : null
                    }))
                    .sort((a, b) => b.count - a.count);

                summary.categoricalColumns.push({
                    column: col,
                    uniqueCount: uniqueValues.size,
                    distribution: distArray,
                    sumColumn: mainNumericCol || null
                });

                // Mark in schema
                summary.schema[col].categorical = true;
                summary.schema[col].uniqueCount = uniqueValues.size;
            }
        });

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 3: Generate insights from ALL numeric columns
        // ═══════════════════════════════════════════════════════════════════════
        summary.insights = [];
        if (numericColumns.length > 0 && mainNumericCol) {
            const stats = summary.schema[mainNumericCol].stats;
            if (stats) {
                summary.insights.push(`Total ${mainNumericCol}: ${formatNumber(stats.sum)}`);
                summary.insights.push(`Average: ${formatNumber(stats.avg)}`);
                summary.insights.push(`Range: ${formatNumber(stats.min)} - ${formatNumber(stats.max)}`);

                if (rows.length > 0 && Math.abs(stats.sum) > 0) {
                    const topValue = Math.max(...rows.map(r => Math.abs(r[mainNumericCol] || 0)));
                    const concentration = ((topValue / Math.abs(stats.sum)) * 100).toFixed(1);
                    summary.insights.push(`Top item: ${concentration}% of total`);
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 4: STRATIFIED SAMPLING - Show representative rows from each category
        // Instead of just "first 5 rows", show diversity of data
        // ═══════════════════════════════════════════════════════════════════════
        const nameCol = columns.find(c =>
            c.includes('name') || c.includes('Name') || c === 'customer_name' || c === 'vendor_name'
        );

        // If we have categorical columns, do stratified sampling
        if (summary.categoricalColumns.length > 0) {
            const primaryCatCol = summary.categoricalColumns[0].column;
            const sampledCategories = new Set();
            const stratifiedSample = [];

            // Get one representative row per category (up to 10 categories)
            for (const row of rows) {
                const catValue = row[primaryCatCol];
                if (catValue && !sampledCategories.has(catValue) && stratifiedSample.length < 10) {
                    sampledCategories.add(catValue);
                    const sampleRow = { category: catValue };
                    if (nameCol) sampleRow.name = row[nameCol];
                    if (mainNumericCol) {
                        sampleRow.value = row[mainNumericCol];
                        sampleRow.valueColumn = mainNumericCol;
                    }
                    // Include a few other columns for context
                    columns.slice(0, 4).forEach(col => {
                        if (col !== primaryCatCol && col !== nameCol && col !== mainNumericCol) {
                            sampleRow[col] = row[col];
                        }
                    });
                    stratifiedSample.push(sampleRow);
                }
            }

            summary.stratifiedSample = stratifiedSample;
            summary.stratifiedBy = primaryCatCol;
        }

        // Also keep traditional preview for backwards compatibility
        summary.preview = rows.slice(0, 5).map((row, idx) => {
            const preview = { rank: idx + 1 };
            if (nameCol) preview.name = row[nameCol];
            if (numericColumns.length > 0) {
                preview.value = row[numericColumns[0]];
                preview.valueColumn = numericColumns[0];
            }
            return preview;
        });

        return summary;
    }

    function dataStore(requestId, toolName, result) {
        const refId = generateDataRefId(toolName);
        const cacheKey = buildDataCacheKey(requestId, refId);

        const dataPayload = {
            rows: result.rows || [],
            columns: result.columns || Object.keys((result.rows || [])[0] || {}),
            metadata: { tool: toolName, timestamp: Date.now(), rowCount: (result.rows || []).length }
        };

        if (result.isDashboard) {
            dataPayload.isDashboard = true;
            dataPayload.dashboardId = result.dashboardId;
            dataPayload.dashboardName = result.dashboardName;
            dataPayload.textSummary = result.textSummary;
            dataPayload.intelligence = result.intelligence;
        }

        const json = JSON.stringify(dataPayload);
        if (json.length > MAX_DATA_SIZE_BYTES) {
            dataPayload.rows = dataPayload.rows.slice(0, 100);
            dataPayload.metadata.truncated = true;
            dataPayload.metadata.originalRowCount = result.rows.length;
        }

        try {
            getCache().put({ key: cacheKey, value: JSON.stringify(dataPayload), ttl: TTL.DATA });
        } catch (e) {
            log.error('dataStore failed', { refId: refId, error: e.message });
        }

        const summary = generateDataSummary(result, toolName);
        return {
            refId: refId,
            requestId: requestId,
            stored: true,
            summary: summary,
            commands: {
                loadRows: `LOAD_ROWS(${refId}, start, end)`,
                loadColumns: `LOAD_COLUMNS(${refId}, [col1, col2])`,
                aggregate: `AGGREGATE(${refId}, column, operation)`
            }
        };
    }

    function dataLoad(requestId, refId) {
        const cacheKey = buildDataCacheKey(requestId, refId);
        try {
            const cached = getCache().get({ key: cacheKey });
            return cached ? JSON.parse(cached) : null;
        } catch (e) {
            log.error('dataLoad failed', { refId: refId, error: e.message });
            return null;
        }
    }

    function dataLoadRows(requestId, refId, start, end) {
        const data = dataLoad(requestId, refId);
        if (!data) return null;

        const rows = data.rows.slice(start, end + 1);
        const result = { refId, rows, columns: data.columns, range: { start, end, total: data.rows.length } };

        if (data.isDashboard) {
            result.isDashboard = true;
            result.dashboardId = data.dashboardId;
            result.dashboardName = data.dashboardName;
            result.textSummary = data.textSummary;
            result.intelligence = data.intelligence;
        }

        return result;
    }

    function dataLoadColumns(requestId, refId, columns) {
        const data = dataLoad(requestId, refId);
        if (!data) return null;

        const filteredRows = data.rows.map(row => {
            const filtered = {};
            columns.forEach(col => {
                if (row.hasOwnProperty(col)) filtered[col] = row[col];
            });
            return filtered;
        });

        return { refId, rows: filteredRows, columns, totalColumns: data.columns };
    }

    function dataAggregate(requestId, refId, column, operation) {
        const data = dataLoad(requestId, refId);
        if (!data) return null;

        const values = data.rows.map(row => row[column]).filter(v => typeof v === 'number' && !isNaN(v));
        if (values.length === 0) {
            return { refId, column, operation, result: null, message: 'No numeric values' };
        }

        let result;
        switch (operation.toLowerCase()) {
            case 'sum': result = values.reduce((a, b) => a + b, 0); break;
            case 'avg':
            case 'average': result = values.reduce((a, b) => a + b, 0) / values.length; break;
            case 'min': result = Math.min(...values); break;
            case 'max': result = Math.max(...values); break;
            case 'count': result = values.length; break;
            default: return { refId, column, operation, result: null, message: 'Unknown operation' };
        }

        return { refId, column, operation, result, count: values.length };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENTIC DATA ACCESS: Filter and Group-By Aggregate for cached query results
    // Enables LLM to drill into ANY cached data, not just dashboards
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Filter cached data rows by column value(s)
     * @param {string} requestId - Request ID
     * @param {string} refId - Data reference ID
     * @param {Object} filterObj - Filter criteria: { column: value } or { column: { op: 'eq'|'gt'|'lt'|'gte'|'lte'|'contains'|'in', value: X } }
     * @returns {Object} Filtered rows with metadata
     */
    function dataFilter(requestId, refId, filterObj) {
        const data = dataLoad(requestId, refId);
        if (!data) return null;

        if (!filterObj || typeof filterObj !== 'object') {
            return { refId, rows: data.rows, columns: data.columns, totalRows: data.rows.length, filtered: false };
        }

        const filteredRows = data.rows.filter(row => {
            for (const [column, condition] of Object.entries(filterObj)) {
                const rowValue = row[column];

                // Simple equality: { category: 'Expense' }
                if (typeof condition !== 'object' || condition === null) {
                    if (rowValue !== condition) return false;
                    continue;
                }

                // Complex condition: { amount: { op: 'gt', value: 1000 } }
                const op = condition.op || 'eq';
                const compareValue = condition.value;

                switch (op) {
                    case 'eq':
                        if (rowValue !== compareValue) return false;
                        break;
                    case 'neq':
                        if (rowValue === compareValue) return false;
                        break;
                    case 'gt':
                        if (!(rowValue > compareValue)) return false;
                        break;
                    case 'gte':
                        if (!(rowValue >= compareValue)) return false;
                        break;
                    case 'lt':
                        if (!(rowValue < compareValue)) return false;
                        break;
                    case 'lte':
                        if (!(rowValue <= compareValue)) return false;
                        break;
                    case 'contains':
                        if (!String(rowValue).toLowerCase().includes(String(compareValue).toLowerCase())) return false;
                        break;
                    case 'in':
                        if (!Array.isArray(compareValue) || !compareValue.includes(rowValue)) return false;
                        break;
                    default:
                        if (rowValue !== compareValue) return false;
                }
            }
            return true;
        });

        return {
            refId,
            rows: filteredRows,
            columns: data.columns,
            rowCount: filteredRows.length,
            totalRows: data.rows.length,
            filtered: true,
            filterApplied: filterObj
        };
    }

    /**
     * Aggregate cached data with GROUP BY support
     * @param {string} requestId - Request ID
     * @param {string} refId - Data reference ID
     * @param {string} groupByColumn - Column to group by (null for overall aggregate)
     * @param {string} aggregateColumn - Column to aggregate
     * @param {string} operation - sum, avg, min, max, count
     * @returns {Object} Aggregated results by group
     */
    function dataAggregateGroupBy(requestId, refId, groupByColumn, aggregateColumn, operation) {
        const data = dataLoad(requestId, refId);
        if (!data) return null;

        operation = (operation || 'sum').toLowerCase();

        // If no groupBy, return overall aggregate
        if (!groupByColumn) {
            const result = dataAggregate(requestId, refId, aggregateColumn, operation);
            return {
                refId,
                grouped: false,
                aggregateColumn,
                operation,
                result: result ? result.result : null
            };
        }

        // Group rows by the groupBy column
        const groups = {};
        data.rows.forEach(row => {
            const groupKey = row[groupByColumn];
            if (groupKey === undefined || groupKey === null) return;

            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(row);
        });

        // Compute aggregate for each group
        const results = [];
        for (const [groupValue, groupRows] of Object.entries(groups)) {
            const values = groupRows
                .map(row => row[aggregateColumn])
                .filter(v => typeof v === 'number' && !isNaN(v));

            let aggregateResult = null;
            if (values.length > 0) {
                switch (operation) {
                    case 'sum':
                        aggregateResult = values.reduce((a, b) => a + b, 0);
                        break;
                    case 'avg':
                    case 'average':
                        aggregateResult = values.reduce((a, b) => a + b, 0) / values.length;
                        break;
                    case 'min':
                        aggregateResult = Math.min(...values);
                        break;
                    case 'max':
                        aggregateResult = Math.max(...values);
                        break;
                    case 'count':
                        aggregateResult = values.length;
                        break;
                }
            }

            results.push({
                [groupByColumn]: groupValue,
                rowCount: groupRows.length,
                [aggregateColumn + '_' + operation]: aggregateResult
            });
        }

        // Sort by aggregate value descending (for sum/avg/max) or ascending (for min)
        const sortDesc = ['sum', 'avg', 'average', 'max', 'count'].includes(operation);
        results.sort((a, b) => {
            const aVal = a[aggregateColumn + '_' + operation] || 0;
            const bVal = b[aggregateColumn + '_' + operation] || 0;
            return sortDesc ? bVal - aVal : aVal - bVal;
        });

        return {
            refId,
            grouped: true,
            groupByColumn,
            aggregateColumn,
            operation,
            groups: results,
            groupCount: results.length
        };
    }

    function dataExecuteCommand(requestId, command) {
        const { action, refId, start, end, columns, column, operation, filter, groupBy } = command;

        switch (action) {
            case 'LOAD_ROWS': return dataLoadRows(requestId, refId, start || 0, end || 9);
            case 'LOAD_COLUMNS': return dataLoadColumns(requestId, refId, columns || []);
            case 'AGGREGATE': return dataAggregate(requestId, refId, column, operation || 'sum');
            case 'FILTER': return dataFilter(requestId, refId, filter);
            case 'GROUP_BY': return dataAggregateGroupBy(requestId, refId, groupBy, column, operation || 'sum');
            case 'LOAD_ALL': return dataLoad(requestId, refId);
            default: return { error: `Unknown command: ${action}` };
        }
    }

    function dataFormatReferenceForPrompt(reference) {
        const s = reference.summary;
        const lines = [];

        lines.push(`═══ DATA: ${reference.refId} ═══`);
        lines.push(`Source: ${s.tool} | Rows: ${s.rowCount} | Columns: ${s.columnCount}`);

        if (s.isEmpty) {
            lines.push('Status: NO DATA RETURNED');
            return lines.join('\n');
        }

        if (s.insights && s.insights.length > 0) {
            lines.push('', 'KEY STATS:');
            s.insights.forEach(insight => lines.push(`  • ${insight}`));
        }

        lines.push('', 'COLUMNS: ' + s.columns.join(', '));

        if (s.preview && s.preview.length > 0) {
            lines.push('', 'TOP 5 PREVIEW:');
            s.preview.forEach(p => {
                const val = p.value !== undefined ? ` (${formatNumber(p.value)})` : '';
                lines.push(`  ${p.rank}. ${p.name || 'Row ' + p.rank}${val}`);
            });
        }

        lines.push('', 'COMMANDS:');
        lines.push(`  • LOAD_ROWS(${reference.refId}, 0, 9) - Get rows 0-9`);
        lines.push(`  • LOAD_ALL(${reference.refId}) - Get all data`);

        return lines.join('\n');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TOOL CACHING - Cached Tool Execution Results
    // ═══════════════════════════════════════════════════════════════════════════

    function buildToolCacheKey(toolName, args) {
        const normalizedArgs = args ? JSON.stringify(args, Object.keys(args).sort()) : '';
        const argsHash = normalizedArgs.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0).toString(36);
        return PREFIX.TOOL + `${toolName}_${argsHash}`;
    }

    function getToolCacheTTL(toolName) {
        return toolName.startsWith('resolve_') ? TTL.TOOL : TTL.TOOL;
    }

    function toolGetCached(toolName, args) {
        const cacheKey = buildToolCacheKey(toolName, args);

        try {
            const cached = getCache().get({ key: cacheKey });
            if (cached) {
                const result = JSON.parse(cached);
                log.debug('Tool cache HIT', { tool: toolName });
                result._cached = true;
                result._cacheKey = cacheKey;
                return result;
            }
        } catch (e) {
            log.debug('Tool cache miss', { tool: toolName });
        }

        return null;
    }

    function toolCache(toolName, args, result) {
        if (!result || !result.success) return;

        const cacheKey = buildToolCacheKey(toolName, args);
        const ttl = getToolCacheTTL(toolName);

        try {
            const payload = JSON.stringify(result);
            if (payload.length < 50 * 1024) {
                getCache().put({ key: cacheKey, value: payload, ttl: ttl });
            }
        } catch (e) {
            log.debug('Failed to cache tool result', { tool: toolName, error: e.message });
        }
    }

    function toolClearCache() {
        log.debug('Tool cache clear requested - results will expire per TTL');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DASHBOARD INTELLIGENCE - Dashboard Data Processing
    // ═══════════════════════════════════════════════════════════════════════════

    function getPath(obj, path) {
        if (!obj || !path) return undefined;
        return path.split('.').reduce((o, p) => (o && o[p] !== undefined) ? o[p] : undefined, obj);
    }

    function formatCurrency(value) {
        if (value === null || value === undefined || isNaN(value)) return 'N/A';
        const absVal = Math.abs(value);
        const sign = value < 0 ? '-' : '';
        if (absVal >= 1000000) return sign + '$' + (absVal / 1000000).toFixed(2) + 'M';
        if (absVal >= 1000) return sign + '$' + (absVal / 1000).toFixed(0) + 'K';
        return sign + '$' + Math.round(absVal).toLocaleString();
    }

    function formatPercent(value) {
        if (value === null || value === undefined || isNaN(value)) return 'N/A';
        return value.toFixed(1) + '%';
    }

    function formatDashboardNumber(value) {
        if (value === null || value === undefined || isNaN(value)) return 'N/A';
        if (value === 999) return 'Sustainable';
        return Math.round(value).toLocaleString();
    }

    function formatValue(value, type) {
        switch (type) {
            case 'currency': return formatCurrency(value);
            case 'percent': return formatPercent(value);
            case 'number': return formatDashboardNumber(value);
            case 'score': return value !== null ? value + '/100' : 'N/A';
            default: return value !== null && value !== undefined ? String(value) : 'N/A';
        }
    }

    function calculateTrend(values) {
        if (!Array.isArray(values) || values.length < 2) return null;
        const nums = values.filter(v => typeof v === 'number' && !isNaN(v));
        if (nums.length < 2) return null;

        const recent = nums[nums.length - 1];
        const prior = nums[nums.length - 2];
        if (prior === 0) return { direction: 'stable', change: null };

        const change = ((recent - prior) / Math.abs(prior)) * 100;
        return {
            direction: change > 2 ? 'up' : change < -2 ? 'down' : 'stable',
            change: (change >= 0 ? '+' : '') + change.toFixed(1) + '%'
        };
    }

    function calculateStatus(value, thresholds, invertScale) {
        if (value === null || value === undefined || !thresholds) return null;

        if (invertScale) {
            if (thresholds.healthy !== undefined && value <= thresholds.healthy) return 'healthy';
            if (thresholds.warning !== undefined && value <= thresholds.warning) return 'warning';
            return 'danger';
        } else {
            if (thresholds.danger !== undefined && value < thresholds.danger) return 'danger';
            if (thresholds.warning !== undefined && value < thresholds.warning) return 'warning';
            return 'healthy';
        }
    }

    function evaluateFormula(formula, metrics) {
        if (!formula || !metrics) return null;

        let result = formula;
        for (const [name, metric] of Object.entries(metrics)) {
            const regex = new RegExp(`\\b${name}\\b`, 'g');
            const value = metric.value !== undefined ? metric.value : 0;
            result = result.replace(regex, value);
        }

        try {
            if (!/^[\d\s+\-*/().]+$/.test(result)) return null;
            if ((result.match(/\(/g) || []).length > 20) return null;

            const evaluated = Function('"use strict"; return (' + result + ')')();
            if (typeof evaluated !== 'number' || !isFinite(evaluated)) return null;
            return evaluated;
        } catch (e) {
            return null;
        }
    }

    function generateDashboardInsights(dashboardId, metrics, schema) {
        const insights = [];
        const templates = schema.extraction?.insightTemplates || [];

        for (const template of templates) {
            try {
                let condition = template.condition;
                for (const [name, metric] of Object.entries(metrics)) {
                    const regex = new RegExp(`\\b${name}\\b`, 'g');
                    const value = metric.value !== undefined ? metric.value : 0;
                    condition = condition.replace(regex, value);
                }

                if (/^[\d\s+\-*/<>=!&|().]+$/.test(condition)) {
                    const result = Function('"use strict"; return (' + condition + ')')();
                    if (result) {
                        let insight = template.template;
                        for (const [name, metric] of Object.entries(metrics)) {
                            insight = insight.replace(`{${name}}`, metric.formatted);
                        }
                        insights.push(insight);
                    }
                }
            } catch (e) {
                // Skip invalid template
            }
        }

        for (const [name, metric] of Object.entries(metrics)) {
            if (metric.status === 'danger') {
                const fieldDef = schema.fields?.[name];
                if (fieldDef && insights.length < 5) {
                    insights.push(`${fieldDef.desc}: ${metric.formatted} [CRITICAL]`);
                }
            }
        }

        return insights.slice(0, 5);
    }

    function dashboardProcess(dashboardId, rawData, requestId) {
        const startTime = Date.now();

        const dashboard = DashboardRegistry.getDashboard(dashboardId);
        if (!dashboard || !dashboard.dataSchema) {
            return { dashboard: dashboardId, error: 'No schema defined', rawData: rawData };
        }

        const schema = dashboard.dataSchema;
        const refId = PREFIX.DASHBOARD + dashboardId.substring(0, 4) + '_' + Date.now().toString(36);
        const timestamp = Date.now();

        // Extract metrics
        const allMetrics = {};
        const computedQueue = [];

        for (const [fieldName, fieldDef] of Object.entries(schema.fields || {})) {
            if (fieldDef.type === 'array') continue;
            if (fieldDef.computed) {
                computedQueue.push({ fieldName, fieldDef });
                continue;
            }
            if (!fieldDef.path) continue;

            let value = getPath(rawData, fieldDef.path);

            if (value === undefined || value === null) {
                allMetrics[fieldName] = { value: null, formatted: 'N/A', type: fieldDef.type, desc: fieldDef.desc, priority: fieldDef.priority || 2 };
                continue;
            }

            const metric = {
                value: value,
                formatted: formatValue(value, fieldDef.type),
                type: fieldDef.type,
                desc: fieldDef.desc,
                priority: fieldDef.priority || 2
            };

            if (fieldDef.thresholds && value !== null) {
                const invertScale = fieldDef.type === 'number' && fieldDef.thresholds.healthy !== undefined && fieldDef.thresholds.healthy < (fieldDef.thresholds.danger || 0);
                metric.status = calculateStatus(value, fieldDef.thresholds, invertScale);
            }

            if (fieldDef.trendPath) {
                const trendData = getPath(rawData, fieldDef.trendPath);
                if (Array.isArray(trendData)) {
                    const trend = calculateTrend(trendData);
                    if (trend) {
                        metric.trend = trend.direction;
                        metric.change = trend.change;
                    }
                }
            }

            allMetrics[fieldName] = metric;
        }

        for (const { fieldName, fieldDef } of computedQueue) {
            const value = evaluateFormula(fieldDef.computed, allMetrics);
            allMetrics[fieldName] = {
                value: value,
                formatted: formatValue(value, fieldDef.type),
                type: fieldDef.type,
                desc: fieldDef.desc,
                priority: fieldDef.priority || 2,
                computed: true
            };
        }

        // Key metrics
        const keyMetricNames = schema.extraction?.keyMetrics ||
            Object.entries(schema.fields || {}).filter(([_, def]) => def.priority === 1 && def.type !== 'array').map(([name]) => name);

        const keyMetrics = {};
        for (const name of keyMetricNames) {
            if (allMetrics[name]) keyMetrics[name] = allMetrics[name];
        }

        // Collections
        const collections = {};
        const collectionData = {};

        for (const [fieldName, fieldDef] of Object.entries(schema.fields || {})) {
            if (fieldDef.type !== 'array' || !fieldDef.path) continue;

            let items = getPath(rawData, fieldDef.path) || [];
            if (!Array.isArray(items)) items = [];

            const colRefId = refId + '_' + fieldName;

            let sortedItems = items;
            if (fieldDef.sortField && items.length > 0) {
                sortedItems = [...items].sort((a, b) => {
                    const aVal = getPath(a, fieldDef.sortField) || 0;
                    const bVal = getPath(b, fieldDef.sortField) || 0;
                    if (typeof aVal === 'number' && typeof bVal === 'number') {
                        return fieldDef.sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
                    }
                    return fieldDef.sortDirection === 'desc' ? String(bVal).localeCompare(String(aVal)) : String(aVal).localeCompare(String(bVal));
                });
            }

            const preview = sortedItems.slice(0, 3).map(item => {
                const label = fieldDef.labelField ? getPath(item, fieldDef.labelField) : 'Item';
                const value = fieldDef.valueField ? getPath(item, fieldDef.valueField) : null;
                if (value !== null && typeof value === 'number') {
                    return `${label} (${formatCurrency(value)})`;
                }
                return String(label);
            });

            collections[fieldName] = {
                count: items.length,
                refId: colRefId,
                preview: preview,
                columns: Object.keys(fieldDef.itemFields || {}),
                desc: fieldDef.desc
            };

            collectionData[fieldName] = {
                items: sortedItems,
                labelField: fieldDef.labelField,
                valueField: fieldDef.valueField,
                itemFields: fieldDef.itemFields
            };
        }

        // Alerts
        const alerts = [];
        const alertFields = schema.extraction?.alertFields || [];

        for (const fieldName of alertFields) {
            const metric = allMetrics[fieldName];
            const fieldDef = schema.fields?.[fieldName];

            if (metric && metric.status && metric.status !== 'healthy') {
                alerts.push({
                    type: metric.status,
                    field: fieldName,
                    message: `${fieldDef?.desc || fieldName}: ${metric.formatted}`,
                    value: metric.value
                });
            }
        }

        // Insights
        const insights = generateDashboardInsights(dashboardId, allMetrics, schema);

        // Cache
        try {
            const cachePayload = {
                dashboardId: dashboardId,
                timestamp: timestamp,
                rawData: rawData,
                allMetrics: allMetrics,
                collections: collectionData
            };

            getCache().put({ key: refId, value: JSON.stringify(cachePayload), ttl: TTL.DASHBOARD });
            memoryCache[refId] = cachePayload;
        } catch (e) {
            log.error('Dashboard cache failed', { error: e.message });
        }

        return {
            dashboard: dashboardId,
            refId: refId,
            timestamp: timestamp,
            metrics: keyMetrics,
            insights: insights,
            alerts: alerts,
            collections: collections,
            schemaHint: schema.summary,
            processingTime: Date.now() - startTime
        };
    }

    function dashboardLoadCollection(refId, collectionName, options) {
        options = options || {};
        const baseRefId = refId.split('_').slice(0, 3).join('_');

        let cached = memoryCache[baseRefId];
        if (!cached) {
            try {
                const cacheValue = getCache().get({ key: baseRefId });
                if (cacheValue) {
                    cached = JSON.parse(cacheValue);
                    memoryCache[baseRefId] = cached;
                }
            } catch (e) {
                log.debug('Dashboard cache read failed', { error: e.message });
            }
        }

        if (!cached) {
            return { success: false, error: 'Data expired - please re-fetch dashboard', hint: 'Call the dashboard tool again' };
        }

        const collection = cached.collections?.[collectionName];
        if (!collection) {
            return { success: false, error: `Collection '${collectionName}' not found`, available: Object.keys(cached.collections || {}) };
        }

        let items = collection.items || [];

        // Apply filter
        if (options.filter && typeof options.filter === 'object') {
            items = items.filter(item => {
                for (const [field, condition] of Object.entries(options.filter)) {
                    const itemValue = getPath(item, field);
                    if (typeof condition === 'object') {
                        if (condition.min !== undefined && itemValue < condition.min) return false;
                        if (condition.max !== undefined && itemValue > condition.max) return false;
                        if (condition.equals !== undefined && itemValue !== condition.equals) return false;
                        if (condition.contains !== undefined) {
                            if (!String(itemValue).toLowerCase().includes(String(condition.contains).toLowerCase())) return false;
                        }
                    } else {
                        if (itemValue !== condition) return false;
                    }
                }
                return true;
            });
        }

        // Apply sort
        if (options.sort && options.sort.field) {
            const { field, direction } = options.sort;
            const dir = direction === 'desc' ? -1 : 1;
            items = [...items].sort((a, b) => {
                const aVal = getPath(a, field);
                const bVal = getPath(b, field);
                if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
                return String(aVal || '').localeCompare(String(bVal || '')) * dir;
            });
        }

        const totalBeforeLimit = items.length;

        if (options.limit && options.limit > 0) {
            items = items.slice(0, options.limit);
        }

        const valueField = collection.valueField;
        let aggregates = null;

        if (valueField) {
            const values = items.map(i => getPath(i, valueField)).filter(v => typeof v === 'number' && !isNaN(v));
            if (values.length > 0) {
                aggregates = {
                    sum: values.reduce((a, b) => a + b, 0),
                    avg: values.reduce((a, b) => a + b, 0) / values.length,
                    min: Math.min(...values),
                    max: Math.max(...values),
                    count: values.length,
                    formatted: {
                        sum: formatCurrency(values.reduce((a, b) => a + b, 0)),
                        avg: formatCurrency(values.reduce((a, b) => a + b, 0) / values.length)
                    }
                };
            }
        }

        return {
            success: true,
            collection: collectionName,
            totalCount: totalBeforeLimit,
            returnedCount: items.length,
            columns: Object.keys(collection.itemFields || {}),
            items: items,
            aggregates: aggregates
        };
    }

    function dashboardAggregate(refId, collectionName, field, operation) {
        const result = dashboardLoadCollection(refId, collectionName, {});
        if (!result.success) return result;

        const values = result.items.map(item => getPath(item, field)).filter(v => typeof v === 'number' && !isNaN(v));

        if (values.length === 0) {
            return { success: true, result: null, message: 'No numeric values found for field: ' + field };
        }

        let value;
        switch ((operation || '').toLowerCase()) {
            case 'sum': value = values.reduce((a, b) => a + b, 0); break;
            case 'avg': value = values.reduce((a, b) => a + b, 0) / values.length; break;
            case 'min': value = Math.min(...values); break;
            case 'max': value = Math.max(...values); break;
            case 'count': value = values.length; break;
            default: return { success: false, error: `Unknown operation: ${operation}` };
        }

        return { success: true, collection: collectionName, field, operation, result: value, formatted: formatCurrency(value), sampleSize: values.length };
    }

    function dashboardGetMetric(refId, metricName) {
        const baseRefId = refId.split('_').slice(0, 3).join('_');

        let cached = memoryCache[baseRefId];
        if (!cached) {
            try {
                const cacheValue = getCache().get({ key: baseRefId });
                if (cacheValue) cached = JSON.parse(cacheValue);
            } catch (e) {
                return { success: false, error: 'Cache read failed' };
            }
        }

        if (!cached) return { success: false, error: 'Data expired' };

        const metric = cached.allMetrics?.[metricName];
        if (!metric) {
            return { success: false, error: `Metric '${metricName}' not found`, available: Object.keys(cached.allMetrics || {}) };
        }

        return { success: true, metric: metricName, ...metric };
    }

    function dashboardClearMemoryCache() {
        memoryCache = {};
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        // Progress Store (request state)
        generateRequestId: generateRequestId,
        create: progressCreate,
        addStep: progressAddStep,
        updateLastStep: progressUpdateLastStep,
        updateStepByType: progressUpdateStepByType,
        updateStep: progressUpdateStep,
        complete: progressComplete,
        fail: progressFail,
        get: progressGet,
        getAgentState: progressGetAgentState,
        setAgentState: progressSetAgentState,
        exists: progressExists,
        remove: progressRemove,
        getPollingResponse: progressGetPollingResponse,
        addBlock: progressAddBlock,
        updateBlock: progressUpdateBlock,
        acquireCompletionLock: acquireCompletionLock,
        hasCompletionLock: hasCompletionLock,
        releaseCompletionLock: releaseCompletionLock,
        isCompleteOrLocked: isCompleteOrLocked,
        acquireProcessingLock: acquireProcessingLock,
        releaseProcessingLock: releaseProcessingLock,
        hasProcessingLock: hasProcessingLock,

        // Data Store (tool results with references)
        storeData: dataStore,
        loadData: dataLoad,
        loadRows: dataLoadRows,
        loadColumns: dataLoadColumns,
        aggregate: dataAggregate,
        filter: dataFilter,
        aggregateGroupBy: dataAggregateGroupBy,
        executeCommand: dataExecuteCommand,
        formatReferenceForPrompt: dataFormatReferenceForPrompt,
        generateSummary: generateDataSummary,

        // Tool Caching
        getCachedToolResult: toolGetCached,
        cacheToolResult: toolCache,
        clearToolCache: toolClearCache,
        buildToolCacheKey: buildToolCacheKey,

        // Dashboard Intelligence
        processDashboard: dashboardProcess,
        loadCollection: dashboardLoadCollection,
        aggregateDashboard: dashboardAggregate,
        getMetric: dashboardGetMetric,
        clearMemoryCache: dashboardClearMemoryCache,

        // Utility exports
        formatCurrency: formatCurrency,
        formatPercent: formatPercent,
        formatValue: formatValue,
        getPath: getPath
    };
});
