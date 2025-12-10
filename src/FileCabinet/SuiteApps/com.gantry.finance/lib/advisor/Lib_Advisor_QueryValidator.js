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

    /**
     * STANDARD tables - known good tables for autocomplete/suggestions
     * These are always allowed and used for schema hints
     */
    const STANDARD_TABLES = [
        // Core transaction tables
        'transaction',
        'transactionline',
        'transactionaccountingline',
        
        // Entity tables
        'customer',
        'vendor',
        'employee',
        'contact',
        'partner',
        'entity',  // Generic entity table for joins
        
        // Accounting tables
        'account',
        'accountingperiod',
        'accounttype',
        
        // Item tables
        'item',
        'inventoryitem',
        'noninventoryitem',
        'serviceitem',
        'assemblyitem',
        'kititem',
        'itemgroup',
        
        // Organization tables
        'subsidiary',
        'department',
        'classification',
        'location',
        
        // Project/Job tables
        'job',
        'projecttask',
        'projecttaskassignment',
        
        // Time tracking
        'timebill',
        'timeentry',
        
        // Other common tables
        'currency',
        'customlist',
        'file',
        'note',
        'message',
        'billingaccount',
        'nexus',
        'unitstype',
        
        // System/utility
        'dual'
    ];

    /**
     * Check if a table is allowed for querying
     * Strategy: Block known-bad, allow everything else (including custom records)
     * @param {string} tableName - The table name to check
     * @returns {Object} { allowed: boolean, isStandard?: boolean, isCustomRecord?: boolean, reason?: string }
     */
    function isTableAllowed(tableName) {
        const normalized = tableName.toLowerCase();
        
        // Always block sensitive tables
        if (BLOCKED_TABLES.includes(normalized)) {
            return { 
                allowed: false, 
                reason: `Table '${tableName}' contains sensitive security data and cannot be queried`
            };
        }
        
        // Always allow standard tables
        if (STANDARD_TABLES.includes(normalized)) {
            return { allowed: true, isStandard: true };
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
        
        // Unknown table - allow but flag as potentially unknown
        // The query will fail at runtime if the table doesn't exist
        return { 
            allowed: true, 
            isUnknown: true, 
            warning: `Table '${tableName}' is not a known standard table - query may fail if it doesn't exist`
        };
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
     * Check if query has a row limit
     */
    function hasRowLimit(sql) {
        return /FETCH\s+FIRST\s+\d+\s+ROWS?\s+ONLY/i.test(sql) ||
               /ROWNUM\s*<=?\s*\d+/i.test(sql) ||
               /LIMIT\s+\d+/i.test(sql);
    }

    /**
     * Add row limit to query if missing
     */
    function ensureRowLimit(sql, limit = MAX_ROWS) {
        if (hasRowLimit(sql)) {
            return sql;
        }

        // Remove any trailing semicolon
        let cleanSql = sql.trim().replace(/;\s*$/, '');
        
        // Add FETCH FIRST clause
        return cleanSql + ` FETCH FIRST ${limit} ROWS ONLY`;
    }

    /**
     * Get schema information for tables
     * This helps the AI understand what fields are available
     */
    function getTableSchema(tableNames) {
        // Return commonly used fields for known tables
        // This is a simplified schema - in production you might query metadata
        
        const schemas = {
            transaction: {
                description: 'Header-level transaction data',
                fields: [
                    'id', 'tranid', 'trandate', 'type', 'entity', 'subsidiary',
                    'status', 'foreigntotal', 'amountremaining', 'duedate', 'posting',
                    'memo', 'createddate', 'lastmodifieddate', 'foreignamountremaining'
                ],
                commonTypes: [
                    'CustInvc (Customer Invoice)', 'CashSale', 'CustPymt (Customer Payment)',
                    'VendBill (Vendor Bill)', 'VendPymt (Vendor Payment)', 'Check',
                    'Journal', 'Deposit', 'ExpRept (Expense Report)', 'SalesOrd',
                    'PurchOrd', 'ItemRcpt', 'ItemShip'
                ],
                notes: 'Use foreigntotal for amounts. amount/currency fields are NOT exposed in SuiteQL.'
            },
            transactionline: {
                description: 'Line-level transaction data',
                fields: [
                    'id', 'transaction', 'linesequencenumber', 'item',
                    'netamount', 'quantity', 'rate', 'department', 'class', 'location',
                    'memo', 'entity', 'mainline', 'costestimate'
                ],
                notes: 'Use netamount instead of amount. amount/account/debit/credit fields are NOT exposed in SuiteQL. Filter mainline=F for line items.'
            },
            customer: {
                description: 'Customer records',
                fields: [
                    'id', 'entityid', 'companyname', 'email', 'phone', 'subsidiary',
                    'salesrep', 'territory', 'category', 'stage', 'status',
                    'balance', 'overduebalance', 'creditlimit', 'isinactive'
                ]
            },
            vendor: {
                description: 'Vendor records',
                fields: [
                    'id', 'entityid', 'companyname', 'email', 'phone', 'subsidiary',
                    'category', 'balance', 'unbilledorders', 'isinactive',
                    'paymentterms', 'currency'
                ]
            },
            employee: {
                description: 'Employee records',
                fields: [
                    'id', 'entityid', 'firstname', 'lastname', 'email', 'supervisor',
                    'department', 'subsidiary', 'title', 'hiredate', 'releasedate',
                    'laborcost', 'isinactive', 'issalesrep'
                ]
            },
            account: {
                description: 'Chart of accounts',
                fields: [
                    'id', 'acctnumber', 'accountsearchdisplayname', 'accttype',
                    'balance', 'subsidiary', 'isinactive', 'parent',
                    'generalrate', 'cashflowrate'
                ],
                commonTypes: [
                    'Bank', 'AcctRec (Accounts Receivable)', 'AcctPay (Accounts Payable)',
                    'Income', 'COGS', 'Expense', 'OthIncome', 'OthExpense',
                    'Equity', 'FixedAsset', 'OthAsset', 'LongTermLiab'
                ],
                notes: 'currency field is NOT exposed in SuiteQL. Use subsidiary to infer currency.'
            },
            item: {
                description: 'Items (products and services)',
                fields: [
                    'id', 'itemid', 'displayname', 'description', 'type',
                    'salesprice', 'cost', 'averagecost', 'quantityonhand',
                    'quantityonorder', 'reorderpoint', 'subsidiary', 'isinactive',
                    'incomeaccount', 'cogsaccount', 'assetaccount'
                ]
            },
            department: {
                description: 'Departments',
                fields: ['id', 'name', 'parent', 'subsidiary', 'isinactive']
            },
            subsidiary: {
                description: 'Subsidiaries',
                fields: ['id', 'name', 'currency', 'parent', 'isinactive', 'country']
            },
            job: {
                description: 'Projects/Jobs',
                fields: [
                    'id', 'entityid', 'companyname', 'parent', 'subsidiary',
                    'entitystatus', 'startdate', 'projectedenddate', 'actualenddate',
                    'isinactive'
                ]
            },
            timebill: {
                description: 'Time entries',
                fields: [
                    'id', 'employee', 'customer', 'item', 'hours', 'trandate',
                    'department', 'class', 'location', 'memo', 'isbillable',
                    'price', 'rate'
                ]
            },
            transactionaccountingline: {
                description: 'Accounting line data with account and debit/credit amounts',
                fields: [
                    'id', 'transaction', 'account', 'amount', 'debit', 'credit',
                    'department', 'class', 'location', 'posting'
                ],
                notes: 'Use this table when you need account-level financial data with debit/credit/amount fields. Joins to account table via account field.'
            }
        };

        if (!tableNames || tableNames.length === 0) {
            return schemas;
        }

        const result = {};
        tableNames.forEach(name => {
            const lower = name.toLowerCase();
            if (schemas[lower]) {
                result[lower] = schemas[lower];
            }
        });

        return result;
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

        return suggestions;
    }

    return {
        validateQuery: validateQuery,
        ensureRowLimit: ensureRowLimit,
        getTableSchema: getTableSchema,
        suggestFix: suggestFix,
        isTableAllowed: isTableAllowed,
        checkTransactionFilters: checkTransactionFilters,
        STANDARD_TABLES: STANDARD_TABLES,
        BLOCKED_TABLES: BLOCKED_TABLES,
        MAX_ROWS: MAX_ROWS
    };
});