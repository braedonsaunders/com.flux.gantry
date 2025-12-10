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
define(['N/log', 'N/runtime', 'N/record', '../Lib_Config'], function(log, runtime, record, ConfigLib) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════
    
    const DEFAULT_MAX_TOKENS = 4000;
    const GOVERNANCE_THRESHOLD_LLM = 1000;
    const GOVERNANCE_THRESHOLD_QUERY = 300;
    
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
     * Build a partial response when we need to exit early due to governance/timeout
     */
    function buildPartialResponse(toolResults, steps, startTime, reason, debugLog) {
        // Summarize what we have so far
        const queryResults = toolResults.filter(tr => 
            (tr.tool === 'query' || tr.tool === 'execute_template') && tr.result?.success
        );
        
        let partialAnswer = 'I had to stop early due to ' + reason + '. ';
        if (queryResults.length > 0) {
            partialAnswer += `Here's what I found so far:\n\n`;
            queryResults.forEach((qr, i) => {
                partialAnswer += `**Query ${i + 1}**: ${qr.purpose || 'Data retrieval'}\n`;
                partialAnswer += `- Found ${qr.result.rowCount} rows\n`;
            });
        } else {
            partialAnswer += 'I was unable to complete any queries before running out of resources.';
        }
        
        steps.push({
            type: 'warning',
            title: 'Early termination',
            status: 'warning',
            content: reason,
            timestamp: Date.now()
        });
        
        const result = {
            text: '',
            richContent: [{ type: 'text', content: partialAnswer }],
            blocksFormat: true,
            steps: steps,
            duration: Date.now() - startTime,
            partialResult: true,
            reason: reason
        };
        
        // Attach debug log if provided
        if (debugLog) {
            result._agentDebugLog = debugLog;
        }
        
        return result;
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

    /**
     * Extract topics from query for session tracking
     */
    function extractTopicsFromQuery(message, description) {
        const topics = [];
        const text = (message + ' ' + (description || '')).toLowerCase();
        
        if (text.includes('revenue') || text.includes('sales')) topics.push('revenue');
        if (text.includes('expense') || text.includes('cost')) topics.push('expenses');
        if (text.includes('customer')) topics.push('customers');
        if (text.includes('vendor')) topics.push('vendors');
        if (text.includes('invoice')) topics.push('invoices');
        if (text.includes('payment')) topics.push('payments');
        if (text.includes('department')) topics.push('departments');
        if (text.includes('receivable') || text.match(/\bar\b/)) topics.push('AR');
        if (text.includes('payable') || text.match(/\bap\b/)) topics.push('AP');
        if (text.includes('cash') || text.includes('flow')) topics.push('cash flow');
        if (text.includes('profit') || text.includes('margin')) topics.push('profitability');
        if (text.includes('balance')) topics.push('balances');
        
        return topics;
    }

    /**
     * Format chat history as text for inclusion in prompt
     */
    function formatChatHistoryAsText(history) {
        if (!history || !Array.isArray(history) || history.length === 0) return '';
        
        const lines = ['Previous conversation:'];
        const recentHistory = history.slice(-6); // Last 6 messages
        
        for (let i = 0; i < recentHistory.length; i++) {
            const msg = recentHistory[i];
            if (msg && (msg.content || msg.text)) {
                const role = msg.role === 'user' ? 'User' : 'Assistant';
                const text = (msg.content || msg.text || '').substring(0, 300);
                lines.push(role + ': ' + text);
            }
        }
        
        return lines.join('\n');
    }

    // ═══════════════════════════════════════════════════════════════
    // SCHEMA DISCOVERY
    // ═══════════════════════════════════════════════════════════════
    // STATIC SCHEMAS FOR SUITEQL-ONLY TABLES
    // These tables can be queried via SuiteQL but are NOT scriptable record types
    // so record.create() will fail for them
    // ═══════════════════════════════════════════════════════════════
    const SUITEQL_TABLE_SCHEMAS = {
        'transaction': {
            description: 'Main transaction header table - use specific types like vendorbill, invoice for record API',
            fields: ['id', 'tranid', 'trandate', 'type', 'entity', 'subsidiary', 'department', 'class', 'location', 
                     'foreigntotal', 'netamount', 'taxtotal', 'status', 'posting', 'voided', 'memo', 'currency',
                     'exchangerate', 'createddate', 'lastmodifieddate', 'postingperiod', 'approvalstatus',
                     'custbody_*'],
            joins: ['transactionline', 'transactionaccountingline', 'entity', 'subsidiary']
        },
        'transactionline': {
            description: 'Transaction line items - JOIN to transaction via transactionline.transaction = transaction.id',
            fields: ['id', 'transaction', 'linesequencenumber', 'item', 'quantity', 'rate', 'amount', 'netamount',
                     'department', 'class', 'location', 'subsidiary', 'mainline', 'taxline', 'memo', 'isclosed',
                     'custcol_*'],
            joins: ['transaction', 'item', 'department', 'location', 'class']
        },
        'transactionaccountingline': {
            description: 'GL impact lines - use for detailed expense/account analysis',
            fields: ['id', 'transaction', 'transactionline', 'account', 'amount', 'debit', 'credit', 
                     'posting', 'accountingbook', 'subsidiary', 'department', 'class', 'location'],
            joins: ['transaction', 'account', 'transactionline']
        },
        'account': {
            description: 'Chart of accounts',
            fields: ['id', 'acctnumber', 'accttype', 'accountsearchdisplayname', 'displaynamewithhierarchy',
                     'fullname', 'description', 'isinactive', 'issummary', 'parent', 'subsidiary'],
            joins: ['transaction (via transactionaccountingline)']
        },
        'accountingperiod': {
            description: 'Fiscal periods',
            fields: ['id', 'periodname', 'startdate', 'enddate', 'isyear', 'isquarter', 'isadjust', 
                     'closed', 'alllocked', 'parent', 'fiscalcalendar'],
            joins: ['transaction']
        },
        'expense': {
            description: 'NOT A VALID RECORD TYPE - Use "expensereport" for expense reports, or query transactionaccountingline with account.accttype = "Expense"',
            fields: [],
            error: true,
            alternatives: ['expensereport', 'vendorbill', 'transactionaccountingline WHERE account.accttype = \'Expense\'']
        },
        'expenses': {
            description: 'NOT A VALID RECORD TYPE - Same as "expense"',
            fields: [],
            error: true,
            alternatives: ['expensereport', 'vendorbill', 'transactionaccountingline WHERE account.accttype = \'Expense\'']
        }
    };

    /**
     * Dynamically get schema for any NetSuite record type
     * Uses dummy record creation to inspect available fields
     * Falls back to static schemas for SuiteQL-only tables
     * @param {string} recordType - The record type ID (e.g., 'customer', 'custrecord_my_log')
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
        // CHECK STATIC SCHEMAS FIRST
        // These are SuiteQL tables that can't be created via record API
        // ═══════════════════════════════════════════════════════════════
        if (SUITEQL_TABLE_SCHEMAS[normalizedType]) {
            const staticSchema = SUITEQL_TABLE_SCHEMAS[normalizedType];
            
            // Handle error cases (like "expense" which isn't a real type)
            if (staticSchema.error) {
                return {
                    success: false,
                    error: staticSchema.description,
                    recordType: normalizedType,
                    alternatives: staticSchema.alternatives,
                    hint: 'Use one of the alternatives: ' + staticSchema.alternatives.join(', ')
                };
            }
            
            // Return static schema
            log.debug('Schema Discovery (static)', { recordType: normalizedType });
            return {
                success: true,
                schema: {
                    type: normalizedType,
                    fields: staticSchema.fields.reduce((acc, f) => {
                        acc[f] = { id: f, label: f, type: 'static', isCustom: f.includes('cust') };
                        return acc;
                    }, {}),
                    sublists: {},
                    isCustomRecord: false,
                    isSuiteQLOnly: true
                },
                fieldCount: staticSchema.fields.length,
                sublistCount: 0,
                summary: `${normalizedType}: ${staticSchema.fields.length} known fields (SuiteQL table)`,
                description: staticSchema.description,
                joins: staticSchema.joins,
                hint: 'This is a SuiteQL table, not a scriptable record type. Use these fields in SuiteQL queries.'
            };
        }
        
        // ═══════════════════════════════════════════════════════════════
        // MAP COMMON TYPE NAMES TO ACTUAL RECORD TYPES
        // ═══════════════════════════════════════════════════════════════
        const typeMapping = {
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
        
        const mappedType = typeMapping[normalizedType] || normalizedType;
        
        try {
            // Create dummy record to inspect fields (lightweight, doesn't save)
            const rec = record.create({ type: mappedType, isDynamic: true });
            const fields = rec.getFields();
            
            const schema = {
                type: mappedType,
                fields: {},
                sublists: {},
                isCustomRecord: mappedType.startsWith('customrecord') || mappedType.startsWith('custrecord')
            };
            
            // Map Body Fields
            fields.forEach(function(fieldId) {
                // Skip internal system fields that aren't useful for queries
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
                } catch (e) {
                    // Skip fields that can't be inspected (permissions, etc.)
                }
            });
            
            // Map Sublists (Critical for Joins)
            try {
                const sublists = rec.getSublists();
                if (sublists && sublists.length > 0) {
                    sublists.forEach(function(sublistId) {
                        schema.sublists[sublistId] = { 
                            id: sublistId,
                            // Try to get sublist fields if possible
                            fields: []
                        };
                        try {
                            const sublistFields = rec.getSublistFields({ sublistId: sublistId });
                            if (sublistFields) {
                                schema.sublists[sublistId].fields = sublistFields.slice(0, 20); // First 20 fields
                            }
                        } catch (e) {
                            // Sublist field inspection failed, that's OK
                        }
                    });
                }
            } catch (e) {
                // Not all records have sublists
            }
            
            const fieldCount = Object.keys(schema.fields).length;
            const sublistCount = Object.keys(schema.sublists).length;
            
            log.debug('Schema Discovery', {
                recordType: mappedType,
                fieldCount: fieldCount,
                sublistCount: sublistCount
            });
            
            return { 
                success: true, 
                schema: schema,
                fieldCount: fieldCount,
                sublistCount: sublistCount,
                summary: `${mappedType}: ${fieldCount} fields, ${sublistCount} sublists`
            };
            
        } catch (e) {
            // Common reasons: record type doesn't exist, not scriptable, insufficient permissions
            log.debug('Schema Discovery Failed', {
                recordType: mappedType,
                error: e.message
            });
            
            // Provide helpful suggestions based on what they tried
            let hint = '';
            let alternatives = [];
            
            if (normalizedType.includes('expens')) {
                hint = 'For expense data, use "expensereport" or query transactionaccountingline with account.accttype = \'Expense\'';
                alternatives = ['expensereport', 'vendorbill'];
            } else if (normalizedType === 'transaction' || normalizedType === 'transactionline') {
                hint = 'This is a SuiteQL table only. For the record API, use specific types: vendorbill, invoice, salesorder, etc.';
                alternatives = ['vendorbill', 'invoice', 'salesorder', 'purchaseorder', 'journalentry'];
            } else {
                alternatives = ['vendorbill', 'invoice', 'salesorder', 'customer', 'vendor'];
            }
            
            return { 
                success: false, 
                error: `Could not load schema for '${recordType}'. ` +
                       `It may not be a scriptable record type, may not exist, or you may lack permissions.`,
                recordType: recordType,
                hint: hint,
                alternatives: alternatives
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
        
        // Query utilities
        cleanQuery: cleanQuery,
        
        // JSON utilities
        extractJsonFromText: extractJsonFromText,
        extractAndRemoveJson: extractAndRemoveJson,
        
        // Governance
        checkGovernance: checkGovernance,
        buildPartialResponse: buildPartialResponse,
        
        // Formatting
        formatDateYMD: formatDateYMD,
        formatResultsCompact: formatResultsCompact,
        formatChatHistoryAsText: formatChatHistoryAsText,
        mapStatus: mapStatus,
        
        // Session
        extractTopicsFromQuery: extractTopicsFromQuery,
        
        // Schema Discovery
        getRecordSchema: getRecordSchema,
        
        // Data Transformation
        applyPivotTransformation: applyPivotTransformation,
        
        // Error handling
        extractErrorDetails: extractErrorDetails,
        
        // Debug mode (centralized control for all advisor modules)
        isDebugMode: isDebugMode,
        resetDebugModeCache: resetDebugModeCache,
        setForceDebugMode: setForceDebugMode
    };
});

/**
 * Apply pivot transformation to convert long-format data to wide-format
 * Example: rows with (account, department, amount) become rows with (account, Dept1, Dept2, ...)
 * 
 * @param {Array} rows - Original rows in long format
 * @param {Array} columns - Original column names
 * @param {Object} pivotConfig - Configuration for pivot
 *   - rowField: Field to use as row identifier (e.g., 'account_name')
 *   - columnField: Field whose values become column headers (e.g., 'department')
 *   - valueField: Field containing values to pivot (e.g., 'amount')
 *   - rowGroupField: Optional field for grouping rows (e.g., 'account_type_name')
 *   - showTotalColumn: Whether to add a total column
 * @returns {Object} { rows: pivotedRows, columns: newColumns }
 */
function applyPivotTransformation(rows, columns, pivotConfig) {
    if (!rows || !rows.length || !pivotConfig || !pivotConfig.enabled) {
        return { rows: rows, columns: columns };
    }
    
    var rowField = pivotConfig.rowField;
    var columnField = pivotConfig.columnField;
    var valueField = pivotConfig.valueField;
    var rowGroupField = pivotConfig.rowGroupField;
    var showTotalColumn = pivotConfig.showTotalColumn !== false;
    
    // Collect unique column values (these become new column headers)
    var columnValues = [];
    var columnValueSet = {};
    rows.forEach(function(row) {
        var colVal = row[columnField];
        if (colVal && !columnValueSet[colVal]) {
            columnValueSet[colVal] = true;
            columnValues.push(colVal);
        }
    });
    
    // Sort column values alphabetically
    columnValues.sort();
    
    // Build map of rowKey -> pivoted row data
    var rowMap = {};
    var rowOrder = []; // Preserve original ordering
    
    rows.forEach(function(row) {
        var rowKey = row[rowField];
        var colVal = row[columnField];
        var value = row[valueField] || 0;
        
        if (!rowMap[rowKey]) {
            rowMap[rowKey] = {
                _rowKey: rowKey,
                _total: 0
            };
            
            // Copy non-pivot fields to the pivoted row
            columns.forEach(function(col) {
                if (col !== columnField && col !== valueField) {
                    rowMap[rowKey][col] = row[col];
                }
            });
            
            // Initialize all pivot columns to 0
            columnValues.forEach(function(cv) {
                rowMap[rowKey][cv] = 0;
            });
            
            rowOrder.push(rowKey);
        }
        
        // Set the value for this column
        rowMap[rowKey][colVal] = value;
        rowMap[rowKey]._total += value;
    });
    
    // Build pivoted rows in original order
    var pivotedRows = rowOrder.map(function(rowKey) {
        var row = rowMap[rowKey];
        var result = {};
        
        // Copy non-pivot fields first
        columns.forEach(function(col) {
            if (col !== columnField && col !== valueField && row[col] !== undefined) {
                result[col] = row[col];
            }
        });
        
        // Add pivot columns
        columnValues.forEach(function(cv) {
            result[cv] = row[cv];
        });
        
        // Add total column if requested
        if (showTotalColumn) {
            result['Total'] = row._total;
        }
        
        return result;
    });
    
    // Build new column list
    var newColumns = [];
    columns.forEach(function(col) {
        if (col !== columnField && col !== valueField) {
            newColumns.push(col);
        }
    });
    newColumns = newColumns.concat(columnValues);
    if (showTotalColumn) {
        newColumns.push('Total');
    }
    
    return {
        rows: pivotedRows,
        columns: newColumns,
        pivotApplied: true,
        groupBy: rowGroupField // Preserve groupBy for the pivoted table
    };
}