/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_QueryExecutor.js
 * Safe query execution for Advisor
 * 
 * Provides:
 * - Row limit enforcement
 * - Timeout handling
 * - Result formatting
 * - Error categorization
 */
define([
    'N/log',
    'N/query',
    './Lib_Advisor_QueryValidator',
    './Lib_Advisor_AIProviders'
], function(log, query, QueryValidator, AIProviders) {
    'use strict';

    const DEFAULT_ROW_LIMIT = 1000;
    const MAX_ROW_LIMIT = 5000;

    /**
     * Execute a SuiteQL query safely
     * @param {string} sql - The query to execute
     * @param {Object} params - Optional parameter values
     * @returns {Object} Result object with success, columns, rows, etc.
     */
    function executeQuery(sql, params = {}) {
        const startTime = Date.now();

        try {
            // Ensure row limit is present
            const safeSql = QueryValidator.ensureRowLimit(sql, DEFAULT_ROW_LIMIT);
            
            log.debug('Executing Query', { 
                sql: safeSql.substring(0, 500),
                paramCount: Object.keys(params).length 
            });

            // Build parameter array (SuiteQL uses positional parameters)
            const paramValues = Object.values(params);

            // Execute the query
            const results = query.runSuiteQL({
                query: safeSql,
                params: paramValues
            });

            // Check if results are valid
            if (!results) {
                throw new Error('Query returned no results object');
            }

            // Get row data as mapped results (with null check)
            const mappedResults = results.asMappedResults ? results.asMappedResults() : [];
            
            if (!mappedResults || !Array.isArray(mappedResults)) {
                // No results returned
                return {
                    success: true,
                    columns: [],
                    rows: [],
                    rowCount: 0,
                    truncated: false,
                    executionTime: Date.now() - startTime,
                    sql: safeSql
                };
            }

            // Get column metadata - try multiple approaches
            let columns = [];
            
            // First try results.columns
            if (results.columns && results.columns.length > 0) {
                columns = results.columns.map(col => {
                    return col.label || col.alias || col.fieldId || 'column';
                });
            }
            
            // If no columns from metadata, extract from first row keys
            if (columns.length === 0 && mappedResults.length > 0) {
                columns = Object.keys(mappedResults[0]);
            }

            // Also get as array for easier iteration
            const rows = mappedResults.map(row => {
                // Clean up the row data
                const cleanRow = {};
                Object.keys(row).forEach(key => {
                    let value = row[key];
                    
                    // Handle null values
                    if (value === null || value === undefined) {
                        cleanRow[key] = null;
                    }
                    // Handle dates
                    else if (value instanceof Date) {
                        cleanRow[key] = value.toISOString().split('T')[0];
                    }
                    // Handle numbers - preserve precision
                    else if (typeof value === 'number') {
                        cleanRow[key] = value;
                    }
                    // Everything else as string
                    else {
                        cleanRow[key] = String(value);
                    }
                });
                return cleanRow;
            });

            const executionTime = Date.now() - startTime;

            log.debug('Query Success', { 
                rowCount: rows.length, 
                executionTime: executionTime + 'ms' 
            });

            return {
                success: true,
                columns: columns,
                rows: rows,
                rowCount: rows.length,
                truncated: rows.length >= DEFAULT_ROW_LIMIT,
                executionTime: executionTime,
                sql: safeSql
            };

        } catch (e) {
            const executionTime = Date.now() - startTime;
            
            log.error('Query Error', { 
                message: e.message, 
                sql: sql.substring(0, 500) 
            });

            return {
                success: false,
                error: e.message,
                errorType: categorizeError(e),
                sql: sql,
                executionTime: executionTime
            };
        }
    }

    /**
     * Execute a query and return a single value
     * Useful for aggregations like COUNT, SUM, etc.
     */
    function executeScalar(sql, params = {}) {
        const result = executeQuery(sql, params);
        
        if (!result.success) {
            return result;
        }

        if (result.rows.length === 0) {
            return {
                success: true,
                value: null
            };
        }

        // Return the first column of the first row
        const firstRow = result.rows[0];
        const firstKey = Object.keys(firstRow)[0];
        
        return {
            success: true,
            value: firstRow[firstKey]
        };
    }

    /**
     * Classify a SQL error semantically using fast LLM call
     * @param {string} errorMessage - The error message to classify
     * @returns {Object} - { category, recoverable, suggestion }
     */
    function classifySQLErrorSemantically(errorMessage) {
        const errorText = errorMessage || 'Unknown error';

        try {
            // Fast LLM classification (< 50 tokens response)
            const result = AIProviders.callAI(
                `Classify this SuiteQL/SQL error into ONE category:

Error: "${errorText.substring(0, 500)}"

Categories:
- INVALID_COLUMN: Unknown column/field/identifier
- INVALID_TABLE: Table or view does not exist
- SYNTAX_ERROR: SQL syntax error (ORA-00xxx errors)
- PERMISSION_DENIED: Access/role issues
- TIMEOUT: Query took too long
- AMBIGUOUS_COLUMN: Column reference is ambiguous
- GROUP_BY_ERROR: GROUP BY clause issue
- TYPE_ERROR: Type conversion/mismatch
- UNKNOWN: Can't determine

Respond with JSON only: {"category":"...","recoverable":true/false,"suggestion":"one line fix"}`,
                { max_tokens: 100, temperature: 0 }
            );

            const responseText = result.text || result;

            // Try to parse the JSON response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    category: parsed.category || 'UNKNOWN',
                    recoverable: parsed.recoverable !== false,
                    suggestion: parsed.suggestion || 'Check query syntax'
                };
            }
        } catch (classificationError) {
            log.debug('Semantic SQL error classification failed', { error: classificationError.message });
        }

        // Fallback if LLM response isn't valid JSON or call failed
        return {
            category: 'UNKNOWN',
            recoverable: true,
            suggestion: 'Check query syntax'
        };
    }

    /**
     * Categorize error for better AI understanding
     * Uses semantic classification with fallback for when LLM unavailable
     * @param {Error} error - The error to categorize
     * @param {Object} options - Optional settings: { useSemanticClassification: boolean }
     * @returns {string} - Error category
     */
    function categorizeError(error, options) {
        const msg = (error.message || '').toLowerCase();
        options = options || {};

        // ═══════════════════════════════════════════════════════════════════════
        // SECURITY-CRITICAL CHECKS - Always run these regardless of LLM
        // ═══════════════════════════════════════════════════════════════════════
        if (msg.includes('permission') || msg.includes('access denied') || msg.includes('insufficient')) {
            return 'PERMISSION_DENIED';
        }

        // ═══════════════════════════════════════════════════════════════════════
        // SEMANTIC CLASSIFICATION - Use LLM for intelligent error categorization
        // ═══════════════════════════════════════════════════════════════════════
        if (options.useSemanticClassification !== false) {
            try {
                const semanticResult = classifySQLErrorSemantically(error.message);
                return semanticResult.category;
            } catch (e) {
                log.debug('Semantic SQL classification failed, using fallback', { error: e.message });
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FALLBACK: Simple pattern matching when LLM unavailable
        // ═══════════════════════════════════════════════════════════════════════
        if (msg.includes('invalid column') || msg.includes('invalid identifier')) {
            return 'INVALID_COLUMN';
        }
        if (msg.includes('invalid table') || msg.includes('table or view does not exist')) {
            return 'INVALID_TABLE';
        }
        if (msg.includes('syntax error') || msg.includes('ora-00')) {
            return 'SYNTAX_ERROR';
        }
        if (msg.includes('timeout') || msg.includes('timed out')) {
            return 'TIMEOUT';
        }
        if (msg.includes('ambiguous')) {
            return 'AMBIGUOUS_COLUMN';
        }
        if (msg.includes('group by') || msg.includes('not a group by expression')) {
            return 'GROUP_BY_ERROR';
        }
        if (msg.includes('conversion') || msg.includes('cannot convert')) {
            return 'TYPE_ERROR';
        }

        return 'UNKNOWN';
    }

    /**
     * Build a helpful error message for the AI
     */
    function buildErrorContext(error, errorType, sql) {
        const context = {
            message: error.message || error,
            type: errorType,
            suggestions: []
        };

        switch (errorType) {
            case 'INVALID_COLUMN':
                context.suggestions.push(
                    'Check that the column name exists in the table',
                    'Use BUILTIN.DF(columnname) for display fields',
                    'Check column aliases are defined before use'
                );
                break;

            case 'INVALID_TABLE':
                // Check if user tried to use a transaction type as a table name
                const txnTypes = ['vendbill', 'custinvc', 'custpymt', 'vendpymt', 'check', 'journal', 'salesord', 'purchord', 'exprept', 'deposit', 'cashsale', 'itemrcpt', 'itemship'];
                const lowerSql = sql ? sql.toLowerCase() : '';
                const usedTxnType = txnTypes.find(t => lowerSql.includes('from ' + t) || lowerSql.includes('join ' + t));

                if (usedTxnType) {
                    context.suggestions.push(
                        `CRITICAL: "${usedTxnType}" is a transaction TYPE, not a table!`,
                        'Query the "transaction" table with a type filter instead',
                        `Example: SELECT * FROM transaction WHERE type = '${usedTxnType.charAt(0).toUpperCase() + usedTxnType.slice(1)}'`
                    );
                } else {
                    context.suggestions.push(
                        'Verify the table name is spelled correctly',
                        'Check if the table is in the allowed list',
                        'Note: VendBill, CustInvc, etc. are TYPE values in "transaction" table, NOT table names'
                    );
                }
                break;

            case 'SYNTAX_ERROR':
                // Check for common SuiteQL-specific syntax issues
                if (sql && /\b(LIMIT\s+\d+|FETCH\s+FIRST)/i.test(sql)) {
                    context.suggestions.push(
                        'CRITICAL: SuiteQL does NOT support LIMIT or FETCH FIRST syntax!',
                        'Use ROWNUM for row limits: SELECT * FROM (your_query ORDER BY ...) WHERE ROWNUM <= N',
                        'Example: SELECT * FROM (SELECT * FROM customer ORDER BY id) WHERE ROWNUM <= 100'
                    );
                } else {
                    context.suggestions.push(
                        'Check for missing commas between columns',
                        'Verify JOIN syntax is complete',
                        'Check parentheses are balanced',
                        'Ensure string literals use single quotes',
                        'For row limits, use: SELECT * FROM (query) WHERE ROWNUM <= N'
                    );
                }
                break;

            case 'AMBIGUOUS_COLUMN':
                context.suggestions.push(
                    'Use table alias to qualify column names',
                    'Example: transaction.id instead of just id'
                );
                break;

            case 'GROUP_BY_ERROR':
                context.suggestions.push(
                    'All non-aggregated columns must be in GROUP BY',
                    'Or wrap them in an aggregate function like MAX()'
                );
                break;

            case 'TIMEOUT':
                context.suggestions.push(
                    'Simplify the query',
                    'Add more specific WHERE conditions',
                    'Reduce the number of JOINs'
                );
                break;

            default:
                context.suggestions.push(
                    'Review the query for common issues',
                    'Check the NetSuite SuiteQL documentation'
                );
        }

        return context;
    }

    /**
     * Format query results for display
     * Applies formatting hints for currency, dates, etc.
     */
    function formatResults(results, formatting = {}) {
        if (!results.success || !results.rows) {
            return results;
        }

        const formattedRows = results.rows.map(row => {
            const formatted = {};
            Object.keys(row).forEach(key => {
                let value = row[key];
                const format = formatting[key.toLowerCase()];

                if (value === null || value === undefined) {
                    formatted[key] = '—';
                } else if (format === 'currency') {
                    formatted[key] = formatCurrency(value);
                } else if (format === 'percent') {
                    formatted[key] = formatPercent(value);
                } else if (format === 'date') {
                    formatted[key] = formatDate(value);
                } else if (format === 'number') {
                    formatted[key] = formatNumber(value);
                } else {
                    formatted[key] = value;
                }
            });
            return formatted;
        });

        return {
            ...results,
            rows: formattedRows
        };
    }

    /**
     * Format as currency
     */
    function formatCurrency(value) {
        const num = Number(value);
        if (isNaN(num)) return value;
        
        if (Math.abs(num) >= 1000000) {
            return '$' + (num / 1000000).toFixed(1) + 'M';
        } else if (Math.abs(num) >= 1000) {
            return '$' + (num / 1000).toFixed(1) + 'K';
        }
        return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    /**
     * Format as percent
     */
    function formatPercent(value) {
        const num = Number(value);
        if (isNaN(num)) return value;
        return num.toFixed(1) + '%';
    }

    /**
     * Format as date
     */
    function formatDate(value) {
        if (!value) return '—';
        
        try {
            const date = new Date(value);
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        } catch (e) {
            return value;
        }
    }

    /**
     * Format as number
     */
    function formatNumber(value) {
        const num = Number(value);
        if (isNaN(num)) return value;
        return num.toLocaleString('en-US');
    }

    return {
        executeQuery: executeQuery,
        executeScalar: executeScalar,
        categorizeError: categorizeError,
        buildErrorContext: buildErrorContext,
        formatResults: formatResults
    };
});