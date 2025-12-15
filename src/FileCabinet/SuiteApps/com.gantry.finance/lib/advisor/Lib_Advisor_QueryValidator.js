/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_QueryValidator.js
 * Query validation and safety checks for Advisor
 * 
 * Provides:
 * - Syntax validation
 * - Table blacklist enforcement (block sensitive, allow all else)
 * - Custom record support (custrecord_*, customrecord_*)
 * - Dangerous operation blocking
 * - Row limit enforcement
 */
define(['N/log'], function(log) {
    'use strict';

    /**
     * BLOCKED tables - security-sensitive, NEVER allow queries
     * These contain authentication, permissions, and audit data
     */
    const BLOCKED_TABLES = [
        'loginaudit',
        'role',
        'rolerecord', 
        'rolefieldpermission',
        'rolepermission',
        'usernotes',
        'systemnote',
        'password',
        'accesstoken',
        'token',
        'integrationapplication',
        'oauth',
        'oauthtoken',
        'apitoken'
    ];

    // DEPRECATED: Dynamic discovery now used via Utils.discoverTableSchema().
    // Tables are now validated dynamically - blocked tables are rejected,
    // all others are allowed and will fail at query time if invalid.
    // Kept for historical reference only.
    // const STANDARD_TABLES = [
    //     'transaction', 'transactionline', 'transactionaccountingline',
    //     'customer', 'vendor', 'employee', 'contact', 'partner', 'entity',
    //     'account', 'accountingperiod', 'accounttype',
    //     'item', 'inventoryitem', 'noninventoryitem', 'serviceitem',
    //     'assemblyitem', 'kititem', 'itemgroup',
    //     'subsidiary', 'department', 'classification', 'location',
    //     'job', 'projecttask', 'projecttaskassignment',
    //     'timebill', 'timeentry',
    //     'currency', 'customlist', 'file', 'note', 'message',
    //     'billingaccount', 'nexus', 'unitstype', 'dual'
    // ];

    /**
     * Check if a table is allowed for querying
     * Strategy: Block known-bad, allow everything else (including custom records)
     * Dynamic discovery will catch truly invalid tables at query time
     * @param {string} tableName - The table name to check
     * @returns {Object} { allowed: boolean, isCustomRecord?: boolean, reason?: string }
     */
    function isTableAllowed(tableName) {
        const normalized = tableName.toLowerCase();

        // Always block sensitive tables - security boundary
        if (BLOCKED_TABLES.includes(normalized)) {
            return {
                allowed: false,
                reason: `Access to table '${tableName}' is not permitted`
            };
        }

        // Allow all custom records (custrecord_*, customrecord_*)
        if (normalized.startsWith('custrecord') || normalized.startsWith('customrecord')) {
            return { allowed: true, isCustomRecord: true };
        }

        // Allow custom lists (customlist_*)
        if (normalized.startsWith('customlist')) {
            return { allowed: true, isCustomList: true };
        }

        // Allow custom transaction types (customtransaction_*)
        if (normalized.startsWith('customtransaction')) {
            return { allowed: true, isCustomTransaction: true };
        }

        // All other tables - allow through
        // Log for monitoring but allow - dynamic discovery will catch invalid tables at query time
        log.debug('Non-standard table queried:', tableName);
        return { allowed: true };
    }

    /**
     * Patterns that indicate dangerous operations
     * These are NEVER allowed
     */
    const BLOCKED_PATTERNS = [
        { pattern: /\bDELETE\b/i, reason: 'DELETE operations are not allowed' },
        { pattern: /\bUPDATE\b/i, reason: 'UPDATE operations are not allowed' },
        { pattern: /\bINSERT\b/i, reason: 'INSERT operations are not allowed' },
        { pattern: /\bDROP\b/i, reason: 'DROP operations are not allowed' },
        { pattern: /\bTRUNCATE\b/i, reason: 'TRUNCATE operations are not allowed' },
        { pattern: /\bALTER\b/i, reason: 'ALTER operations are not allowed' },
        { pattern: /\bCREATE\b/i, reason: 'CREATE operations are not allowed' },
        { pattern: /\bGRANT\b/i, reason: 'GRANT operations are not allowed' },
        { pattern: /\bREVOKE\b/i, reason: 'REVOKE operations are not allowed' },
        { pattern: /\bEXEC\b/i, reason: 'EXEC operations are not allowed' },
        { pattern: /\bEXECUTE\b/i, reason: 'EXECUTE operations are not allowed' },
        { pattern: /--/, reason: 'SQL comments are not allowed (potential injection)' },
        { pattern: /\/\*/, reason: 'Block comments are not allowed' },
        { pattern: /;\s*SELECT/i, reason: 'Multiple statements are not allowed' },
        { pattern: /;\s*$/, reason: 'Trailing semicolons are not allowed' },
        { pattern: /UNION\s+ALL\s+SELECT/i, reason: 'UNION injections are not allowed' }
    ];

    /**
     * Maximum rows that can be returned
     */
    const MAX_ROWS = 5000;

    /**
     * Validate a SuiteQL query
     * @param {string} sql - The query to validate
     * @returns {Object} { valid: boolean, reason?: string, suggestion?: string }
     */
    function validateQuery(sql) {
        if (!sql || typeof sql !== 'string') {
            return { valid: false, reason: 'Query is empty or not a string' };
        }

        const normalizedSql = sql.trim();
        const upperSql = normalizedSql.toUpperCase();

        // Check if it's a SELECT or WITH statement (CTEs are allowed)
        if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WITH')) {
            return { 
                valid: false, 
                reason: 'Only SELECT or WITH statements are allowed',
                suggestion: 'Start your query with SELECT or WITH (for CTEs)'
            };
        }

        // Check for blocked patterns
        for (const blocked of BLOCKED_PATTERNS) {
            if (blocked.pattern.test(normalizedSql)) {
                return { 
                    valid: false, 
                    reason: blocked.reason,
                    suggestion: 'Remove the dangerous operation and use only SELECT queries'
                };
            }
        }

        // Extract table names and validate
        const tableValidation = validateTables(normalizedSql);
        if (!tableValidation.valid) {
            return tableValidation;
        }

        // Check for column references to tables not in FROM/JOIN
        const columnRefValidation = validateColumnReferences(normalizedSql, tableValidation.tables || []);
        if (!columnRefValidation.valid) {
            return columnRefValidation;
        }

        // Check for row limit
        if (!hasRowLimit(normalizedSql)) {
            log.debug('Query Missing Row Limit', { sql: normalizedSql.substring(0, 200) });
            // We'll add the limit during execution, but warn
        }

        // Check for recommended transaction filters and return warnings
        const filterWarnings = checkTransactionFilters(normalizedSql, tableValidation.tables || []);
        
        return { valid: true, warnings: filterWarnings };
    }

    /**
     * Check for recommended transaction table filters
     * Returns array of warnings for missing best-practice filters
     */
    function checkTransactionFilters(sql, tablesInQuery) {
        const warnings = [];
        const upperSql = sql.toUpperCase();
        const lowerSql = sql.toLowerCase();
        
        // Only check if querying transaction table
        if (!tablesInQuery.includes('transaction')) {
            return warnings;
        }
        
        // Check for voided filter
        const hasVoidedFilter = /\.voided\s*=\s*['"]?F['"]?/i.test(sql) ||
                               /voided\s*=\s*['"]?F['"]?/i.test(sql) ||
                               /voided\s*=\s*'F'/i.test(sql);
        
        if (!hasVoidedFilter) {
            warnings.push({
                type: 'missing_filter',
                filter: 'voided',
                message: 'Missing voided = \'F\' filter - may include voided/cancelled transactions',
                suggestion: 'AND transaction.voided = \'F\''
            });
        }
        
        // Check for posting filter on financial queries (SUM, amount, total)
        const isFinancialQuery = /\bSUM\s*\(/i.test(sql) || 
                                 /amount/i.test(sql) || 
                                 /total/i.test(sql) ||
                                 /foreigntotal/i.test(sql);
        
        const hasPostingFilter = /\.posting\s*=\s*['"]?T['"]?/i.test(sql) ||
                                 /posting\s*=\s*['"]?T['"]?/i.test(sql);
        
        if (isFinancialQuery && !hasPostingFilter) {
            warnings.push({
                type: 'missing_filter',
                filter: 'posting',
                message: 'Missing posting = \'T\' filter - may include non-posting transactions',
                suggestion: 'AND transaction.posting = \'T\''
            });
        }
        
        return warnings;
    }

    /**
     * Check if columns reference tables that are in the query
     */
    function validateColumnReferences(sql, tablesInQuery) {
        // Common table prefixes that might be referenced
        const knownTables = ['transaction', 'transactionline', 'transactionaccountingline', 
                           'customer', 'vendor', 'employee', 'account', 'item', 'subsidiary',
                           'department', 'location', 'classification'];
        
        // Look for table.column patterns
        const columnRefPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        const referencedTables = new Set();
        
        while ((match = columnRefPattern.exec(sql)) !== null) {
            const tableName = match[1].toLowerCase();
            // Only check known table names (ignore aliases like 't' or 'tl')
            if (knownTables.includes(tableName)) {
                referencedTables.add(tableName);
            }
        }
        
        // Check if any referenced table is not in FROM/JOIN
        for (const refTable of referencedTables) {
            if (!tablesInQuery.includes(refTable)) {
                return {
                    valid: false,
                    reason: `Column references table '${refTable}' but it is not in FROM or JOIN clause`,
                    suggestion: `Add: INNER JOIN ${refTable} ON ${refTable}.transaction = transaction.id`
                };
            }
        }
        
        return { valid: true };
    }

    /**
     * Extract and validate table names from query
     * Handles CTEs (WITH clause) by treating them as valid table aliases
     */
    function validateTables(sql) {
        // First, extract CTE names from WITH clause
        // Pattern matches: WITH cte_name AS (...), cte_name2 AS (...)
        const cteNames = [];
        const ctePattern = /\bWITH\s+/i;
        
        if (ctePattern.test(sql)) {
            // Extract CTE definitions - match "name AS (" patterns
            const cteDefPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+AS\s*\(/gi;
            let cteMatch;
            while ((cteMatch = cteDefPattern.exec(sql)) !== null) {
                cteNames.push(cteMatch[1].toLowerCase());
            }
        }
        
        // Simple table extraction - look for FROM and JOIN clauses
        const tablePattern = /(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
        const tables = [];
        let match;

        while ((match = tablePattern.exec(sql)) !== null) {
            tables.push(match[1].toLowerCase());
        }

        // Check each table using the isTableAllowed function
        const warnings = [];
        for (const tableName of tables) {
            // Skip CTE references - they're valid aliases
            if (cteNames.includes(tableName)) {
                continue;
            }
            
            const check = isTableAllowed(tableName);
            if (!check.allowed) {
                return {
                    valid: false,
                    reason: check.reason,
                    suggestion: 'This table is blocked for security reasons. Use standard tables or custom records (custrecord_*).'
                };
            }
            if (check.warning) {
                warnings.push(check.warning);
            }
        }

        return { 
            valid: true, 
            tables: tables, 
            cteNames: cteNames,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    /**
     * Check if query has a proper SuiteQL row limit (ROWNUM)
     * Note: FETCH FIRST is NOT supported by SuiteQL despite being Oracle syntax
     */
    function hasRownumLimit(sql) {
        return /ROWNUM\s*<=?\s*\d+/i.test(sql);
    }

    /**
     * Check if query has FETCH FIRST clause (Oracle 12c+ syntax, NOT valid in SuiteQL)
     */
    function hasFetchFirst(sql) {
        return /FETCH\s+FIRST\s+\d+\s+ROWS?\s+ONLY/i.test(sql);
    }

    /**
     * Check if query has LIMIT clause (not valid SuiteQL but LLM might write it)
     */
    function hasLimitClause(sql) {
        return /\bLIMIT\s+\d+/i.test(sql);
    }

    /**
     * Check if query has any row limit
     */
    function hasRowLimit(sql) {
        return hasRownumLimit(sql) ||
               hasFetchFirst(sql) ||
               hasLimitClause(sql);
    }

    /**
     * Convert LIMIT N to ROWNUM (SuiteQL syntax)
     * LLMs often write standard SQL LIMIT which SuiteQL doesn't support
     */
    function convertLimitToRownum(sql, limit) {
        // Match LIMIT N (with optional OFFSET which SuiteQL also doesn't support)
        const limitMatch = sql.match(/\bLIMIT\s+(\d+)(?:\s+OFFSET\s+\d+)?/i);
        if (!limitMatch) {
            return wrapWithRownum(sql, limit);
        }

        const limitValue = parseInt(limitMatch[1], 10);

        // Remove the LIMIT clause
        let cleanSql = sql.replace(/\bLIMIT\s+\d+(?:\s+OFFSET\s+\d+)?/i, '').trim();

        // Remove any trailing semicolon
        cleanSql = cleanSql.replace(/;\s*$/, '');

        return wrapWithRownum(cleanSql, limitValue);
    }

    /**
     * Convert FETCH FIRST N ROWS ONLY to ROWNUM (SuiteQL syntax)
     * FETCH FIRST is Oracle 12c+ syntax that SuiteQL does NOT support
     */
    function convertFetchFirstToRownum(sql) {
        const fetchMatch = sql.match(/FETCH\s+FIRST\s+(\d+)\s+ROWS?\s+ONLY/i);
        if (!fetchMatch) {
            return sql;
        }

        const limitValue = parseInt(fetchMatch[1], 10);

        // Remove the FETCH FIRST clause
        let cleanSql = sql.replace(/\s*FETCH\s+FIRST\s+\d+\s+ROWS?\s+ONLY/i, '').trim();

        // Remove any trailing semicolon
        cleanSql = cleanSql.replace(/;\s*$/, '');

        return wrapWithRownum(cleanSql, limitValue);
    }

    /**
     * Wrap a query with ROWNUM limit using subquery pattern
     * This is required because ROWNUM is evaluated BEFORE ORDER BY
     * Pattern: SELECT * FROM (original_query) WHERE ROWNUM <= N
     */
    function wrapWithRownum(sql, limit) {
        // Remove any trailing semicolon
        let cleanSql = sql.trim().replace(/;\s*$/, '');

        // Wrap in subquery with ROWNUM
        return `SELECT * FROM (${cleanSql}) WHERE ROWNUM <= ${limit}`;
    }

    /**
     * Add row limit to query if missing, or convert invalid syntax to ROWNUM
     * SuiteQL requires ROWNUM <= N syntax (not FETCH FIRST or LIMIT)
     */
    function ensureRowLimit(sql, limit = MAX_ROWS) {
        // Remove any trailing semicolon first
        let cleanSql = sql.trim().replace(/;\s*$/, '');

        // If query already has proper ROWNUM limit, return as-is
        if (hasRownumLimit(cleanSql)) {
            return cleanSql;
        }

        // If query has FETCH FIRST (invalid SuiteQL), convert to ROWNUM
        if (hasFetchFirst(cleanSql)) {
            log.debug('QueryValidator converting FETCH FIRST to ROWNUM', {
                originalSql: cleanSql.substring(0, 200)
            });
            return convertFetchFirstToRownum(cleanSql);
        }

        // If query has LIMIT (invalid SuiteQL), convert to ROWNUM
        if (hasLimitClause(cleanSql)) {
            log.debug('QueryValidator converting LIMIT to ROWNUM', {
                originalSql: cleanSql.substring(0, 200)
            });
            return convertLimitToRownum(cleanSql, limit);
        }

        // No limit at all - wrap with ROWNUM
        return wrapWithRownum(cleanSql, limit);
    }

    /**
     * Suggest fixes for common query errors
     */
    function suggestFix(errorMessage, failedQuery) {
        const suggestions = [];
        const lowerError = errorMessage.toLowerCase();

        if (lowerError.includes('invalid column')) {
            suggestions.push('Check column names against the table schema');
            suggestions.push('Use BUILTIN.DF() for display names of ID fields');
        }

        if (lowerError.includes('invalid table')) {
            suggestions.push('Verify the table name is correct');
            suggestions.push('Check if the table is in the allowed list');
        }

        if (lowerError.includes('syntax error')) {
            suggestions.push('Check for missing commas or parentheses');
            suggestions.push('Verify JOIN conditions are complete');
        }

        if (lowerError.includes('ambiguous')) {
            suggestions.push('Use table aliases to qualify column names');
        }

        // LIMIT or FETCH FIRST syntax error - common LLM mistake
        if (lowerError.includes('limit') || lowerError.includes('fetch') ||
            (lowerError.includes('syntax') && failedQuery && /\b(LIMIT|FETCH\s+FIRST)\b/i.test(failedQuery))) {
            suggestions.push('SuiteQL does NOT support LIMIT or FETCH FIRST syntax');
            suggestions.push('Use: ROWNUM <= N in WHERE clause, or wrap query in subquery');
            suggestions.push('Example: SELECT * FROM (SELECT * FROM customer ORDER BY name) WHERE ROWNUM <= 100');
        }

        return suggestions;
    }

    return {
        validateQuery: validateQuery,
        ensureRowLimit: ensureRowLimit,
        convertLimitToRownum: convertLimitToRownum,
        convertFetchFirstToRownum: convertFetchFirstToRownum,
        wrapWithRownum: wrapWithRownum,
        hasRownumLimit: hasRownumLimit,
        hasFetchFirst: hasFetchFirst,
        hasLimitClause: hasLimitClause,
        hasRowLimit: hasRowLimit,
        suggestFix: suggestFix,
        isTableAllowed: isTableAllowed,
        checkTransactionFilters: checkTransactionFilters,
        // STANDARD_TABLES removed - use dynamic discovery via Utils.discoverTableSchema()
        BLOCKED_TABLES: BLOCKED_TABLES,
        MAX_ROWS: MAX_ROWS
    };
});