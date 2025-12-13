/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_Utils.js
 * Shared utility functions for the Advisor module
 * 
 * Contains:
 * - Query cleaning
 * - JSON extraction
 * - Governance checking
 * - Date formatting
 * - Result formatting
 * - Partial response building
 * - Debug mode management
 */
define(['N/log', 'N/runtime', 'N/record', 'N/query', '../Lib_Config'], function(log, runtime, record, query, ConfigLib) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════

    const DEFAULT_MAX_TOKENS = 4000;
    const GOVERNANCE_THRESHOLD_LLM = 1000;
    const GOVERNANCE_THRESHOLD_QUERY = 300;

    // ═══════════════════════════════════════════════════════════════
    // STREAMING CONTEXT ARCHITECTURE (SCA) CONSTANTS
    // Lightweight phases use smaller token limits for faster responses
    // ═══════════════════════════════════════════════════════════════

    const SCA_TOKEN_LIMITS = {
        'SCA:intent': 200,      // Intent classification - very short
        'SCA:select': 300,      // Tool selection - short list
        'SCA:invoke': 400,      // Tool invocation - minimal schema
        'SCA:analyze': 1500,    // Analysis - moderate
        'SCA:format': 2000      // Response formatting - needs room for blocks
    };
    
    // ═══════════════════════════════════════════════════════════════
    // DEBUG MODE - Centralized control for all advisor modules
    // ═══════════════════════════════════════════════════════════════
    
    // Cache for debug mode (avoid repeated config lookups within a request)
    let _debugModeCache = null;
    let _forceDebugMode = false;
    
    /**
     * Force debug mode on (call at start of request based on aiSettings)
     * @param {boolean} enabled - Whether to force debug mode on
     */
    function setForceDebugMode(enabled) {
        _forceDebugMode = enabled === true;
        if (_forceDebugMode) {
            log.debug('DEBUG MODE ENABLED via settings');
        }
    }
    
    /**
     * Check if advisor debug mode is enabled
     * Reads from main config's advisorDebugMode setting OR forced via setForceDebugMode
     * Result is cached for the duration of the request
     * 
     * @returns {boolean} True if debug mode is enabled
     */
    function isDebugMode() {
        // Forced debug mode takes precedence
        if (_forceDebugMode) {
            return true;
        }
        
        if (_debugModeCache !== null) {
            return _debugModeCache;
        }
        
        try {
            var config = ConfigLib.getStoredConfiguration('main') || {};
            _debugModeCache = config.advisorDebugMode === true || config.advisorDebugMode === 'true';
        } catch (e) {
            log.debug('Could not read debug mode from config', { error: e.message });
            _debugModeCache = false;
        }
        
        return _debugModeCache;
    }
    
    /**
     * Reset debug mode cache (call at start of each request if needed)
     */
    function resetDebugModeCache() {
        _debugModeCache = null;
        _forceDebugMode = false;
    }

    /**
     * Gated debug logging - only logs when debug mode is enabled
     * Use this instead of log.debug() for performance-sensitive paths
     *
     * @param {string} title - Log title
     * @param {Object} [details] - Optional log details object
     */
    function debugLog(title, details) {
        if (isDebugMode()) {
            log.debug(title, details);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SQL ESCAPING (Single Source of Truth)
    // Used by EntityResolver, Tools, and any module building SuiteQL
    // ═══════════════════════════════════════════════════════════════

    /**
     * Escape SQL string to prevent injection
     * Use for values in WHERE clauses with = operator
     * @param {string} str - String to escape
     * @returns {string} Escaped string safe for SQL
     */
    function escapeSql(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/'/g, "''");
    }

    /**
     * Escape SQL LIKE pattern characters (% and _) in addition to SQL escaping
     * Use when the value will be used in a LIKE clause
     * @param {string} str - String to escape
     * @returns {string} Escaped string safe for LIKE clauses
     */
    function escapeSqlLike(str) {
        if (str === null || str === undefined) return '';
        // First escape SQL quotes, then escape LIKE wildcards
        return String(str).replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
    }

    // ═══════════════════════════════════════════════════════════════
    // QUERY UTILITIES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Clean SQL query from markdown and other artifacts
     */
    function cleanQuery(query) {
        if (!query) return query;
        
        let cleaned = query.trim();
        
        // Remove markdown code blocks (```sql, ```, etc.)
        cleaned = cleaned.replace(/^```\w*\s*\n?/gi, '');
        cleaned = cleaned.replace(/\n?```\s*$/gi, '');
        cleaned = cleaned.replace(/```/g, '');
        
        // Remove SQL comments FIRST (before semicolon cleanup)
        cleaned = cleaned.replace(/--.*$/gm, '');           // Single line comments
        cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, ''); // Block comments
        
        // Remove ALL semicolons (NetSuite N/query doesn't allow them)
        cleaned = cleaned.replace(/;/g, '');
        
        // Remove any FETCH FIRST that got duplicated (exact duplicates)
        cleaned = cleaned.replace(/(FETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY)\s+\1/gi, '$1');
        
        // Clean up extra whitespace from comment removal
        cleaned = cleaned.replace(/\n\s*\n/g, '\n').trim();
        
        return cleaned;
    }
    
    /**
     * Robust JSON extraction from text
     * Handles cases where models wrap JSON in unexpected text like "Here is the JSON: {...}"
     * Uses balanced brace matching instead of fragile regex patterns
     * 
     * @param {string} text - Text that may contain JSON
     * @param {string} [requiredField] - Optional field that must be present (e.g., 'type')
     * @returns {object|null} - Parsed JSON object or null if not found/invalid
     */
    function extractJsonFromText(text, requiredField) {
        if (!text || typeof text !== 'string') return null;
        
        // First, try to extract from markdown code blocks (most reliable)
        const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (codeBlockMatch) {
            try {
                const parsed = JSON.parse(codeBlockMatch[1].trim());
                if (!requiredField || parsed[requiredField] !== undefined) {
                    return parsed;
                }
            } catch (e) {
                // Continue to other methods
            }
        }
        
        // Find all potential JSON objects using balanced brace matching
        const jsonCandidates = [];
        let depth = 0;
        let startIndex = -1;
        
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '{') {
                if (depth === 0) startIndex = i;
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0 && startIndex !== -1) {
                    jsonCandidates.push(text.substring(startIndex, i + 1));
                    startIndex = -1;
                }
            }
        }
        
        // Try parsing each candidate, prefer ones with required field
        for (const candidate of jsonCandidates) {
            try {
                const parsed = JSON.parse(candidate);
                if (typeof parsed === 'object' && parsed !== null) {
                    if (!requiredField || parsed[requiredField] !== undefined) {
                        return parsed;
                    }
                }
            } catch (e) {
                // Not valid JSON, try next candidate
            }
        }
        
        // If we have a required field but didn't find it, try any valid JSON
        if (requiredField && jsonCandidates.length > 0) {
            for (const candidate of jsonCandidates) {
                try {
                    const parsed = JSON.parse(candidate);
                    if (typeof parsed === 'object' && parsed !== null) {
                        return parsed;
                    }
                } catch (e) {
                    // Continue
                }
            }
        }
        
        return null;
    }
    
    /**
     * Extract and remove JSON from text, returning both the JSON and cleaned text
     * @param {string} text - Text containing JSON
     * @param {string} [requiredField] - Optional field that must be present
     * @returns {object} - { json: parsed object or null, cleanedText: text with JSON removed }
     */
    function extractAndRemoveJson(text, requiredField) {
        if (!text || typeof text !== 'string') {
            return { json: null, cleanedText: text || '' };
        }
        
        let cleanedText = text;
        
        // Remove markdown code blocks first
        cleanedText = cleanedText.replace(/```(?:json)?[\s\S]*?```/gi, '');
        
        // Find and remove JSON objects using balanced brace matching
        const toRemove = [];
        let depth = 0;
        let startIndex = -1;
        
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '{') {
                if (depth === 0) startIndex = i;
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0 && startIndex !== -1) {
                    const candidate = text.substring(startIndex, i + 1);
                    try {
                        const parsed = JSON.parse(candidate);
                        if (typeof parsed === 'object' && parsed !== null) {
                            // Check if it looks like rich content (has 'type' field)
                            if (parsed.type) {
                                toRemove.push(candidate);
                            }
                        }
                    } catch (e) {
                        // Not valid JSON, don't remove
                    }
                    startIndex = -1;
                }
            }
        }
        
        // Remove found JSON objects from text
        for (const jsonStr of toRemove) {
            cleanedText = cleanedText.replace(jsonStr, '');
        }
        
        // Clean up orphaned backticks and excessive whitespace
        cleanedText = cleanedText
            .replace(/`+/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        
        // Extract the JSON using the main function
        const json = extractJsonFromText(text, requiredField);
        
        return { json, cleanedText };
    }

    /**
     * Check if we have enough governance units to continue
     * @param {number} requiredUnits - Minimum units needed for the operation
     * @returns {object} { hasEnough: boolean, remaining: number, warning: string|null }
     */
    function checkGovernance(requiredUnits) {
        try {
            const script = runtime.getCurrentScript();
            const remaining = script.getRemainingUsage();
            const hasEnough = remaining > requiredUnits;
            
            let warning = null;
            if (!hasEnough) {
                warning = `Low governance: ${remaining} units remaining, need ${requiredUnits}`;
                log.audit('Governance check failed', { remaining, required: requiredUnits });
            } else if (remaining < requiredUnits * 2) {
                // Warning if we're getting close
                log.debug('Governance running low', { remaining, required: requiredUnits });
            }
            
            return { hasEnough, remaining, warning };
        } catch (e) {
            // If runtime not available (e.g., in testing), assume we have enough
            log.debug('Could not check governance', { error: e.message });
            return { hasEnough: true, remaining: 9999, warning: null };
        }
    }
    
    /**
     * Format a date as YYYY-MM-DD
     */
    function formatDateYMD(d) {
        return d.getFullYear() + '-' + 
               String(d.getMonth() + 1).padStart(2, '0') + '-' + 
               String(d.getDate()).padStart(2, '0');
    }

    /**
     * Format results compactly for agent
     */
    function formatResultsCompact(result, maxRows, options) {
        if (!result.rows?.length) return 'No data';
        options = options || {};
        const limit = maxRows || 10;
        const rows = result.rows.slice(0, limit);
        const cols = result.columns || Object.keys(rows[0] || {});
        const decimalPlaces = options.decimals !== undefined ? options.decimals : 0;
        
        const formatted = rows.map(row => {
            return cols.map(col => {
                const val = row[col.toLowerCase()] ?? row[col];
                if (val === null || val === undefined) return options.nullValue || '-';
                if (typeof val === 'number') {
                    return val.toLocaleString('en-US', { maximumFractionDigits: decimalPlaces });
                }
                const strVal = String(val);
                return options.truncate !== false ? strVal.substring(0, options.maxColWidth || 25) : strVal;
            }).join(' | ');
        }).join('\n');
        
        const remaining = result.rows.length - limit;
        if (remaining > 0) {
            return formatted + `\n... +${remaining} more`;
        }
        return formatted;
    }

    /**
     * Map NetSuite status codes to human-readable labels
     * Handles both single-letter codes and long-form values
     */
    function mapStatus(statusCode) {
        if (!statusCode) return null;
        
        // Common NetSuite transaction status codes
        const statusMap = {
            'A': 'Pending Approval',
            'B': 'Open',           // Open/Pending Billing
            'C': 'Closed',
            'D': 'Cancelled',
            'E': 'Fully Billed',
            'F': 'Fulfilled',
            'G': 'Pending Fulfillment',
            'H': 'Partially Fulfilled',
            'P': 'Paid In Full',
            'V': 'Voided',
            'R': 'Rejected',
            // Long-form status values (pass through)
            'Open': 'Open',
            'Closed': 'Closed',
            'Paid In Full': 'Paid',
            'Pending Approval': 'Pending Approval',
            'Pending Fulfillment': 'Pending Fulfillment'
        };
        
        return statusMap[statusCode] || statusCode;
    }

    // ═══════════════════════════════════════════════════════════════
    // VALUE FORMATTERS (Single Source of Truth)
    // Used by Cache, QueryExecutor, and any module formatting output
    // ═══════════════════════════════════════════════════════════════

    /**
     * Format a number as currency with intelligent scaling
     * @param {number} value - The value to format
     * @param {Object} [options] - Formatting options
     * @param {boolean} [options.compact=true] - Use K/M abbreviations for large numbers
     * @param {boolean} [options.showSign=true] - Show negative sign
     * @param {number} [options.decimals=0] - Decimal places for non-compact format
     * @returns {string} Formatted currency string
     */
    function formatCurrency(value, options) {
        if (value === null || value === undefined || isNaN(value)) return 'N/A';
        options = options || {};
        const compact = options.compact !== false;
        const showSign = options.showSign !== false;
        const decimals = options.decimals || 0;

        const num = Number(value);
        const absNum = Math.abs(num);
        const sign = (showSign && num < 0) ? '-' : '';

        if (compact) {
            if (absNum >= 1000000) return sign + '$' + (absNum / 1000000).toFixed(2) + 'M';
            if (absNum >= 1000) return sign + '$' + (absNum / 1000).toFixed(1) + 'K';
        }

        return sign + '$' + absNum.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    /**
     * Format a number as percentage
     * @param {number} value - The value to format (e.g., 45.5 for 45.5%)
     * @param {number} [decimals=1] - Decimal places
     * @returns {string} Formatted percentage string
     */
    function formatPercent(value, decimals) {
        if (value === null || value === undefined || isNaN(value)) return 'N/A';
        decimals = decimals !== undefined ? decimals : 1;
        return Number(value).toFixed(decimals) + '%';
    }

    /**
     * Format a number with locale-aware thousands separators
     * @param {number} value - The value to format
     * @param {Object} [options] - Formatting options
     * @param {number} [options.decimals=0] - Decimal places
     * @param {boolean} [options.compact=false] - Use K/M abbreviations
     * @returns {string} Formatted number string
     */
    function formatNumber(value, options) {
        if (value === null || value === undefined || isNaN(value)) return 'N/A';
        options = options || {};
        const decimals = options.decimals || 0;
        const compact = options.compact === true;
        const num = Number(value);
        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';

        if (compact) {
            if (absNum >= 1000000) return sign + (absNum / 1000000).toFixed(1) + 'M';
            if (absNum >= 1000) return sign + (absNum / 1000).toFixed(1) + 'K';
        }

        return num.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    /**
     * Format a date value
     * @param {string|Date} value - The date to format
     * @param {string} [format='short'] - Format style: 'short', 'medium', 'iso'
     * @returns {string} Formatted date string
     */
    function formatDate(value, format) {
        if (!value) return '—';

        try {
            const date = value instanceof Date ? value : new Date(value);
            if (isNaN(date.getTime())) return String(value);

            format = format || 'short';

            switch (format) {
                case 'iso':
                    return date.toISOString().split('T')[0]; // YYYY-MM-DD
                case 'medium':
                    return date.toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                    });
                case 'short':
                default:
                    return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    });
            }
        } catch (e) {
            return String(value);
        }
    }

    /**
     * Format a value based on detected or specified type
     * @param {*} value - The value to format
     * @param {string} type - Type hint: 'currency', 'percent', 'number', 'date', 'score'
     * @returns {string} Formatted value
     */
    function formatValue(value, type) {
        switch (type) {
            case 'currency':
                return formatCurrency(value);
            case 'percent':
                return formatPercent(value);
            case 'number':
                return formatNumber(value);
            case 'date':
                return formatDate(value);
            case 'score':
                return value !== null && value !== undefined ? value + '/100' : 'N/A';
            default:
                return value !== null && value !== undefined ? String(value) : 'N/A';
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // CONVERSATION HISTORY
    // ═══════════════════════════════════════════════════════════════

    /**
     * Format chat history as text for inclusion in prompt
     * RECOMMENDATION 5: Implements conversation memory compression
     * - Semantic compression: Recent messages get full context, older ones get summaries
     * - Entity persistence: Extracted entities are tracked separately
     * - Intent chain: Tracks sequence of user intents for context continuity
     */
    function formatChatHistoryAsText(history, options) {
        if (!history || !Array.isArray(history) || history.length === 0) return '';

        options = options || {};
        const maxRecentMessages = options.maxRecent || 4;  // Full detail for recent
        const maxOlderMessages = options.maxOlder || 4;    // Compressed for older
        const includeIntentChain = options.includeIntentChain !== false;

        const lines = ['Previous conversation:'];

        // Split history into recent (full detail) and older (compressed)
        const totalMessages = history.length;
        const recentStart = Math.max(0, totalMessages - maxRecentMessages);
        const olderStart = Math.max(0, recentStart - maxOlderMessages);

        // SEMANTIC COMPRESSION: Summarize older messages
        if (olderStart < recentStart) {
            const olderMessages = history.slice(olderStart, recentStart);
            if (olderMessages.length > 0) {
                lines.push('[Earlier context - summarized]:');
                const summaries = olderMessages.map(msg => {
                    if (!msg || !(msg.content || msg.text)) return null;
                    const text = (msg.content || msg.text || '');
                    const role = msg.role === 'user' ? 'Q' : 'A';
                    // Extract key information: first sentence or first 80 chars
                    const firstSentence = text.split(/[.!?]/)[0].trim();
                    const summary = firstSentence.length > 80
                        ? firstSentence.substring(0, 77) + '...'
                        : firstSentence;
                    return `${role}: ${summary}`;
                }).filter(s => s !== null);
                lines.push(summaries.join(' → '));
            }
        }

        // FULL DETAIL: Recent messages
        if (recentStart < totalMessages) {
            lines.push('[Recent messages]:');
            const recentMessages = history.slice(recentStart);
            for (const msg of recentMessages) {
                if (msg && (msg.content || msg.text)) {
                    const role = msg.role === 'user' ? 'User' : 'Assistant';
                    const text = (msg.content || msg.text || '').substring(0, 400);
                    lines.push(role + ': ' + text);
                }
            }
        }

        // INTENT CHAIN: Track sequence of user intents
        if (includeIntentChain) {
            const intents = history
                .filter(msg => msg && msg.intent)
                .map(msg => msg.intent)
                .slice(-5);
            if (intents.length > 0) {
                lines.push('[Intent flow]: ' + intents.join(' → '));
            }
        }

        // ENTITY PERSISTENCE: Note any resolved entities from history
        const entities = [];
        history.forEach(msg => {
            if (msg && msg.resolvedEntities) {
                Object.entries(msg.resolvedEntities).forEach(([key, entity]) => {
                    if (entity && entity.name && !entities.find(e => e.id === entity.id)) {
                        entities.push(entity);
                    }
                });
            }
        });
        if (entities.length > 0) {
            const entitySummary = entities.slice(0, 5).map(e =>
                `${e.name} (${e.type || 'entity'}: ${e.id})`
            ).join(', ');
            lines.push('[Known entities]: ' + entitySummary);
        }

        return lines.join('\n');
    }

    // ═══════════════════════════════════════════════════════════════
    // SCHEMA DISCOVERY (Fully Dynamic)
    // Discovers schema for ANY record type or SuiteQL table dynamically
    // No hardcoded schemas - uses N/record and N/query at runtime
    // ═══════════════════════════════════════════════════════════════

    /**
     * Dynamically discover table/record schema via SuiteQL
     * Used as fallback when record.create() fails (for SuiteQL-only tables)
     * @param {string} tableName - The table name to discover
     * @returns {Object} Schema information or error
     */
    function discoverTableSchema(tableName) {
        try {
            // Run a query to get column metadata (fetch 0 rows, just need metadata)
            const sql = 'SELECT * FROM ' + tableName + ' FETCH FIRST 1 ROWS ONLY';
            const results = query.runSuiteQL({ query: sql });

            // Get column metadata from result
            const columns = results.columns || [];
            const fields = {};

            columns.forEach(function(col) {
                const fieldId = col.fieldId || col.alias || 'unknown';
                fields[fieldId] = {
                    id: fieldId,
                    label: col.label || fieldId,
                    type: col.type || 'unknown',
                    isCustom: fieldId.startsWith('cust')
                };
            });

            const fieldCount = Object.keys(fields).length;

            log.debug('Schema Discovery (SuiteQL)', {
                tableName: tableName,
                fieldCount: fieldCount
            });

            return {
                success: true,
                schema: {
                    type: tableName,
                    fields: fields,
                    sublists: {},
                    isCustomRecord: tableName.startsWith('customrecord') || tableName.startsWith('custrecord'),
                    isSuiteQLTable: true
                },
                fieldCount: fieldCount,
                sublistCount: 0,
                summary: tableName + ': ' + fieldCount + ' fields (SuiteQL table)',
                hint: 'This is a SuiteQL table. Use these fields in SuiteQL queries.'
            };
        } catch (e) {
            log.debug('SuiteQL Schema Discovery Failed', {
                tableName: tableName,
                error: e.message
            });
            return null; // Signal that SuiteQL discovery failed
        }
    }

    /**
     * Dynamically get schema for any NetSuite record type or SuiteQL table
     * FULLY DYNAMIC - no hardcoded schemas
     *
     * Discovery strategy:
     * 1. First try N/record.create() for scriptable record types
     * 2. If that fails, try SuiteQL to discover table columns
     *
     * @param {string} recordType - The record/table type (e.g., 'customer', 'transaction', 'custrecord_xyz')
     * @returns {Object} Schema information or error
     */
    function getRecordSchema(recordType) {
        if (!recordType || typeof recordType !== 'string') {
            return {
                success: false,
                error: 'Record type must be a non-empty string',
                recordType: recordType
            };
        }

        const normalizedType = recordType.toLowerCase().trim();

        // ═══════════════════════════════════════════════════════════════
        // COMMON TYPE ALIASES (convenience mapping)
        // Maps user-friendly names to NetSuite internal type IDs
        // ═══════════════════════════════════════════════════════════════
        const typeAliases = {
            'bill': 'vendorbill',
            'bills': 'vendorbill',
            'vendor_bill': 'vendorbill',
            'inv': 'invoice',
            'invoices': 'invoice',
            'so': 'salesorder',
            'sales_order': 'salesorder',
            'po': 'purchaseorder',
            'purchase_order': 'purchaseorder',
            'cust': 'customer',
            'customers': 'customer',
            'vend': 'vendor',
            'vendors': 'vendor',
            'emp': 'employee',
            'employees': 'employee',
            'items': 'inventoryitem',
            'credit_memo': 'creditmemo',
            'journal': 'journalentry',
            'journals': 'journalentry',
            'transfer': 'inventorytransfer',
            'adjustment': 'inventoryadjustment',
            'expense_report': 'expensereport',
            'project': 'job',
            'projects': 'job'
        };

        const mappedType = typeAliases[normalizedType] || normalizedType;

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 1: Try N/record.create() for scriptable record types
        // ═══════════════════════════════════════════════════════════════
        try {
            const rec = record.create({ type: mappedType, isDynamic: true });
            const fields = rec.getFields();

            const schema = {
                type: mappedType,
                fields: {},
                sublists: {},
                isCustomRecord: mappedType.startsWith('customrecord') || mappedType.startsWith('custrecord'),
                discoveryMethod: 'record'
            };

            // Map Body Fields
            fields.forEach(function(fieldId) {
                // Skip internal system fields
                if (fieldId.startsWith('sys') || fieldId.startsWith('_') || fieldId.startsWith('nsapi')) {
                    return;
                }

                try {
                    const f = rec.getField({ fieldId: fieldId });
                    if (f) {
                        schema.fields[fieldId] = {
                            id: fieldId,
                            label: f.label || fieldId,
                            type: f.type,
                            isMandatory: f.isMandatory || false,
                            isCustom: fieldId.startsWith('custbody') ||
                                      fieldId.startsWith('custrecord') ||
                                      fieldId.startsWith('custentity') ||
                                      fieldId.startsWith('custitem') ||
                                      fieldId.startsWith('custevent')
                        };
                    }
                } catch (fieldErr) {
                    // Skip fields that can't be inspected
                }
            });

            // Map Sublists
            try {
                const sublists = rec.getSublists();
                if (sublists && sublists.length > 0) {
                    sublists.forEach(function(sublistId) {
                        schema.sublists[sublistId] = {
                            id: sublistId,
                            fields: []
                        };
                        try {
                            const sublistFields = rec.getSublistFields({ sublistId: sublistId });
                            if (sublistFields) {
                                schema.sublists[sublistId].fields = sublistFields.slice(0, 30);
                            }
                        } catch (subErr) {
                            // Sublist field inspection failed
                        }
                    });
                }
            } catch (sublistErr) {
                // Not all records have sublists
            }

            const fieldCount = Object.keys(schema.fields).length;
            const sublistCount = Object.keys(schema.sublists).length;

            log.debug('Schema Discovery (Record)', {
                recordType: mappedType,
                fieldCount: fieldCount,
                sublistCount: sublistCount
            });

            return {
                success: true,
                schema: schema,
                fieldCount: fieldCount,
                sublistCount: sublistCount,
                summary: mappedType + ': ' + fieldCount + ' fields, ' + sublistCount + ' sublists'
            };

        } catch (recordErr) {
            // ═══════════════════════════════════════════════════════════════
            // STRATEGY 2: Try SuiteQL for tables that aren't scriptable records
            // (e.g., transaction, transactionline, account, etc.)
            // ═══════════════════════════════════════════════════════════════
            log.debug('Record creation failed, trying SuiteQL discovery', {
                recordType: mappedType,
                error: recordErr.message
            });

            const suiteqlResult = discoverTableSchema(mappedType);

            if (suiteqlResult && suiteqlResult.success) {
                return suiteqlResult;
            }

            // ═══════════════════════════════════════════════════════════════
            // BOTH STRATEGIES FAILED - provide helpful error message
            // ═══════════════════════════════════════════════════════════════
            return {
                success: false,
                error: 'Could not discover schema for "' + recordType + '". ' +
                       'It may not be a valid record type or table, or you may lack permissions.',
                recordType: recordType,
                triedMethods: ['record.create()', 'SuiteQL SELECT'],
                suggestions: [
                    'Check spelling of record/table name',
                    'For custom records, use the full ID (e.g., custrecord_myrecord)',
                    'Common tables: transaction, transactionline, customer, vendor, item, account',
                    'Common records: vendorbill, invoice, salesorder, purchaseorder, journalentry'
                ]
            };
        }
    }

    /**
     * Extract comprehensive error details from any error object
     * Handles NetSuite errors, HTTP errors, and standard JS errors
     * Use for debugging only - never expose to end users
     * 
     * @param {Error|Object} e - The error object to extract details from
     * @returns {Object} - Structured error details for debugging
     */
    function extractErrorDetails(e) {
        if (!e) {
            return { message: 'Unknown error (null/undefined)' };
        }
        
        var details = {};
        
        // Standard error properties
        if (e.message) details.message = e.message;
        if (e.name) details.name = e.name;
        if (e.code) details.code = e.code;
        if (e.stack) {
            // Truncate stack to first 5 lines to avoid huge logs
            var stackLines = String(e.stack).split('\n').slice(0, 5);
            details.stack = stackLines;
        }
        
        // NetSuite-specific error properties
        if (e.id) details.nsErrorId = e.id;
        if (e.cause) {
            // cause could be nested error or object
            if (typeof e.cause === 'object') {
                details.cause = extractErrorDetails(e.cause);
            } else {
                details.cause = String(e.cause);
            }
        }
        
        // HTTP response errors (from N/https)
        if (e.response) {
            details.httpResponse = {
                code: e.response.code,
                body: e.response.body ? String(e.response.body).substring(0, 500) : null
            };
        }
        
        // Try to extract any additional enumerable properties
        // This catches provider-specific error fields
        try {
            var knownKeys = ['message', 'name', 'code', 'stack', 'id', 'cause', 'response'];
            Object.keys(e).forEach(function(key) {
                if (knownKeys.indexOf(key) === -1 && details[key] === undefined) {
                    var val = e[key];
                    // Only include primitives and simple objects
                    if (val !== null && val !== undefined) {
                        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                            details[key] = val;
                        } else if (typeof val === 'object') {
                            // Try to stringify, but truncate
                            try {
                                details[key] = JSON.stringify(val).substring(0, 200);
                            } catch (jsonErr) {
                                details[key] = '[Object - could not stringify]';
                            }
                        }
                    }
                }
            });
        } catch (enumErr) {
            // Ignore enumeration errors
        }
        
        // If we got nothing, convert the whole thing to string
        if (Object.keys(details).length === 0) {
            details.message = String(e);
        }

        return details;
    }

    return {
        // Constants
        DEFAULT_MAX_TOKENS: DEFAULT_MAX_TOKENS,
        GOVERNANCE_THRESHOLD_LLM: GOVERNANCE_THRESHOLD_LLM,
        GOVERNANCE_THRESHOLD_QUERY: GOVERNANCE_THRESHOLD_QUERY,
        SCA_TOKEN_LIMITS: SCA_TOKEN_LIMITS,

        // SQL escaping (single source of truth)
        escapeSql: escapeSql,
        escapeSqlLike: escapeSqlLike,

        // Query utilities
        cleanQuery: cleanQuery,

        // JSON utilities
        extractJsonFromText: extractJsonFromText,
        extractAndRemoveJson: extractAndRemoveJson,

        // Governance
        checkGovernance: checkGovernance,

        // Value formatters (single source of truth)
        formatCurrency: formatCurrency,
        formatPercent: formatPercent,
        formatNumber: formatNumber,
        formatDate: formatDate,
        formatValue: formatValue,

        // Legacy formatters (kept for compatibility)
        formatDateYMD: formatDateYMD,
        formatResultsCompact: formatResultsCompact,
        formatChatHistoryAsText: formatChatHistoryAsText,
        mapStatus: mapStatus,

        // Schema Discovery (for LLM tools)
        getRecordSchema: getRecordSchema,

        // Error handling
        extractErrorDetails: extractErrorDetails,

        // Debug mode (centralized control for all advisor modules)
        isDebugMode: isDebugMode,
        resetDebugModeCache: resetDebugModeCache,
        setForceDebugMode: setForceDebugMode,
        debugLog: debugLog
    };
});