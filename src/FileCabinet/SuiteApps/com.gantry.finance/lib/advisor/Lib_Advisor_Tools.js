/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_Tools.js
 * Comprehensive tool definitions for LLM-driven advisor
 *
 * ARCHITECTURE:
 * - LLM decides which tools to call (no regex, no preprocessing)
 * - Tools are organized into tiers:
 *   1. Discovery Tools - Find entities, accounts, classifications
 *   2. Data Tools - Pre-optimized queries for specific data needs
 *   3. Dashboard Tools - Rich computed metrics from 8 dashboards
 *   4. Utility Tools - Fiscal context, custom queries, validation
 *
 * DESIGN PRINCIPLES:
 * - Each tool has a clear, specific purpose
 * - Pre-optimized SQL queries for speed
 * - Rich descriptions help LLM choose the right tool
 * - Tools can be composed for complex analysis
 */
define([
    'N/log',
    'N/search',
    'N/dataset',
    'N/workbook',
    './Lib_Advisor_EntityResolver',
    './Lib_Advisor_QueryExecutor',
    './Lib_Advisor_Utils',
    './Lib_Advisor_Cache',
    '../Lib_Dashboard_Registry',
    '../Lib_Config',
    // Dashboard data modules - loaded as dependencies to avoid dynamic require() errors
    '../Lib_Cashflow_Data',
    '../Lib_Health_Data',
    '../Lib_Burden_Data',
    '../Lib_Time_Data',
    '../Lib_Integrity_Data',
    '../Lib_VendorPerformance_Data',
    '../Lib_CustomerValue_Data',
    '../Lib_SpendVelocity_Data'
], function(
    log,
    search,
    dataset,
    workbook,
    EntityResolver,
    QueryExecutor,
    Utils,
    Cache,
    DashboardRegistry,
    ConfigLib,
    // Dashboard data modules
    CashflowData,
    HealthData,
    BurdenData,
    TimeData,
    IntegrityData,
    VendorPerformanceData,
    CustomerValueData,
    SpendVelocityData
) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Escape SQL string to prevent injection
     */
    function escapeSql(str) {
        if (!str) return '';
        return String(str).replace(/'/g, "''");
    }

    /**
     * Escape SQL LIKE pattern characters (% and _) in addition to SQL escaping
     * Use this when the value will be used in a LIKE clause
     */
    function escapeSqlLike(str) {
        if (!str) return '';
        // First escape SQL quotes, then escape LIKE wildcards
        return String(str).replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RUNTIME SORT COLUMN VALIDATION
    // Prevents SQL injection via ORDER BY clause even though enums provide protection
    // Defense-in-depth: validate at runtime before interpolation
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Validate sort column against an explicit whitelist
     * Returns the validated column or the default if invalid
     * @param {string} sortBy - The sort_by value from args
     * @param {Array<string>} allowedColumns - Whitelist of allowed column names
     * @param {string} defaultColumn - Default column if validation fails
     * @returns {string} Validated column name
     */
    function validateSortColumn(sortBy, allowedColumns, defaultColumn) {
        if (!sortBy) {
            return defaultColumn;
        }

        if (allowedColumns.includes(sortBy)) {
            return sortBy;
        }

        // Log rejected column for audit
        log.audit('Invalid sort column rejected', {
            received: sortBy,
            allowed: allowedColumns,
            usingDefault: defaultColumn
        });

        return defaultColumn;
    }

    /**
     * Build a safe ORDER BY clause with runtime validation
     * Maps validated sort_by values to SQL expressions
     * @param {string} sortBy - The sort_by value from args
     * @param {Object} sortMappings - Map of sort_by values to SQL expressions
     * @param {string} defaultOrderBy - Default ORDER BY expression
     * @returns {string} Safe ORDER BY expression
     */
    function buildSafeOrderBy(sortBy, sortMappings, defaultOrderBy) {
        if (!sortBy) {
            return defaultOrderBy;
        }

        // Validate against mapping keys
        const validatedSort = validateSortColumn(sortBy, Object.keys(sortMappings), null);

        if (validatedSort && sortMappings[validatedSort]) {
            return sortMappings[validatedSort];
        }

        return defaultOrderBy;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTO-BROADEN ON EMPTY RESULTS
    // When a query returns 0 rows, suggest broader parameters automatically
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Suggest broader parameters when a query returns empty results
     * Used by REFLECT phase to automatically retry with less restrictive filters
     *
     * @param {Object} args - Original tool arguments
     * @param {string} toolName - Name of the tool that returned empty
     * @returns {Object} { canBroaden: boolean, broadenedArgs: Object, suggestions: Array }
     */
    function suggestBroaderParams(args, toolName) {
        const suggestions = [];
        const broadenedArgs = { ...args };
        let canBroaden = false;

        // 1. Broaden date/period filter
        if (args.period && args.period !== 'all') {
            const periodBroadening = {
                'last_30_days': 'last_90_days',
                'last_60_days': 'last_180_days',
                'last_90_days': 'last_365_days',
                'last_180_days': 'last_2_years',
                'last_365_days': 'last_3_years',
                'this_month': 'last_90_days',
                'this_quarter': 'this_fiscal_year',
                'this_fiscal_year': 'last_2_fiscal_years',
                'last_fiscal_year': 'last_3_fiscal_years'
            };

            if (periodBroadening[args.period]) {
                broadenedArgs.period = periodBroadening[args.period];
                suggestions.push(`Expanded date range from ${args.period} to ${broadenedArgs.period}`);
                canBroaden = true;
            } else if (args.period !== 'all') {
                broadenedArgs.period = 'all';
                suggestions.push(`Removed date filter (was: ${args.period})`);
                canBroaden = true;
            }
        }

        // 2. Remove explicit date filters if present
        if (args.start_date || args.end_date) {
            delete broadenedArgs.start_date;
            delete broadenedArgs.end_date;
            suggestions.push('Removed explicit date range filters');
            canBroaden = true;
        }

        // 3. Remove transaction type filter
        if (args.transaction_type) {
            delete broadenedArgs.transaction_type;
            suggestions.push(`Removed transaction type filter (was: ${args.transaction_type})`);
            canBroaden = true;
        }

        // 4. Increase limit if it was restrictive
        if (args.limit && args.limit < 50) {
            broadenedArgs.limit = Math.min(args.limit * 2, 100);
            suggestions.push(`Increased result limit from ${args.limit} to ${broadenedArgs.limit}`);
            canBroaden = true;
        }

        // 5. Remove min/max threshold filters
        if (args.min_spend) {
            delete broadenedArgs.min_spend;
            suggestions.push(`Removed minimum spend filter (was: ${args.min_spend})`);
            canBroaden = true;
        }
        if (args.min_revenue) {
            delete broadenedArgs.min_revenue;
            suggestions.push(`Removed minimum revenue filter (was: ${args.min_revenue})`);
            canBroaden = true;
        }
        if (args.min_amount) {
            delete broadenedArgs.min_amount;
            suggestions.push(`Removed minimum amount filter (was: ${args.min_amount})`);
            canBroaden = true;
        }

        // 6. Don't remove entity_id, customer_id, vendor_id - those are intentional filters
        // that changing would give completely different results

        return {
            canBroaden,
            broadenedArgs,
            suggestions,
            originalArgs: args
        };
    }

    /**
     * Build date filter based on period string
     * Uses fiscal calendar from ConfigLib for accurate fiscal year handling
     */
    function buildPeriodFilter(period, dateField) {
        dateField = dateField || 'transaction.trandate';

        // Get fiscal calendar for smart period detection
        const fiscalCalendar = ConfigLib.getFiscalCalendar();
        const fyStartDate = fiscalCalendar.fiscalYearStartDate;  // YYYY-MM-DD
        const fyEndDate = fiscalCalendar.fiscalYearEndDate;      // YYYY-MM-DD
        const fyStartMonth = fiscalCalendar.fiscalYearStartMonth || 0;  // 0-11
        const fyStartDay = fiscalCalendar.fiscalYearStartDay || 1;

        // Calculate prior fiscal year dates
        const now = new Date();
        const fyStart = new Date(fyStartDate);
        const fyEnd = new Date(fyEndDate);

        // Last fiscal year
        const lastFyStart = new Date(fyStart);
        lastFyStart.setFullYear(lastFyStart.getFullYear() - 1);
        const lastFyEnd = new Date(fyEnd);
        lastFyEnd.setFullYear(lastFyEnd.getFullYear() - 1);

        // 2 fiscal years ago
        const twoFyStart = new Date(fyStart);
        twoFyStart.setFullYear(twoFyStart.getFullYear() - 2);
        const twoFyEnd = new Date(fyEnd);
        twoFyEnd.setFullYear(twoFyEnd.getFullYear() - 2);

        // 3 fiscal years ago
        const threeFyStart = new Date(fyStart);
        threeFyStart.setFullYear(threeFyStart.getFullYear() - 3);
        const threeFyEnd = new Date(fyEnd);
        threeFyEnd.setFullYear(threeFyEnd.getFullYear() - 3);

        // Helper to format date for SQL
        const toSqlDate = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // Calculate fiscal quarters based on fiscal year start
        const getFiscalQuarterDates = (fyStartDate, quarterNum) => {
            const fy = new Date(fyStartDate);
            const qStart = new Date(fy);
            qStart.setMonth(fy.getMonth() + (quarterNum - 1) * 3);
            const qEnd = new Date(qStart);
            qEnd.setMonth(qStart.getMonth() + 3);
            qEnd.setDate(qEnd.getDate() - 1);
            return { start: toSqlDate(qStart), end: toSqlDate(qEnd) };
        };

        // Current fiscal year quarters
        const fyQ1 = getFiscalQuarterDates(fyStart, 1);
        const fyQ2 = getFiscalQuarterDates(fyStart, 2);
        const fyQ3 = getFiscalQuarterDates(fyStart, 3);
        const fyQ4 = getFiscalQuarterDates(fyStart, 4);

        // Last fiscal year quarters
        const lastFyQ1 = getFiscalQuarterDates(lastFyStart, 1);
        const lastFyQ2 = getFiscalQuarterDates(lastFyStart, 2);
        const lastFyQ3 = getFiscalQuarterDates(lastFyStart, 3);
        const lastFyQ4 = getFiscalQuarterDates(lastFyStart, 4);

        // YTD comparison point in prior year (same elapsed time)
        const daysIntoFy = Math.floor((now - fyStart) / (1000 * 60 * 60 * 24));
        const priorYtdEnd = new Date(lastFyStart);
        priorYtdEnd.setDate(priorYtdEnd.getDate() + daysIntoFy);

        // Latest closed period end date (for complete accounting data)
        const closedPeriodEnd = fiscalCalendar.latestClosedPeriod ?
            fiscalCalendar.latestClosedPeriod.endDate : toSqlDate(now);

        const periodFilters = {
            // === Daily ===
            'today': `${dateField} = CURRENT_DATE`,
            'yesterday': `${dateField} = CURRENT_DATE - 1`,

            // === Weekly ===
            'this_week': `${dateField} >= TRUNC(CURRENT_DATE, 'IW')`,
            'last_week': `${dateField} >= TRUNC(CURRENT_DATE, 'IW') - 7 AND ${dateField} < TRUNC(CURRENT_DATE, 'IW')`,

            // === Monthly ===
            'this_month': `${dateField} >= TRUNC(CURRENT_DATE, 'MM')`,
            'last_month': `${dateField} >= ADD_MONTHS(TRUNC(CURRENT_DATE, 'MM'), -1) AND ${dateField} < TRUNC(CURRENT_DATE, 'MM')`,

            // === Calendar Quarters ===
            'this_quarter': `${dateField} >= TRUNC(CURRENT_DATE, 'Q')`,
            'last_quarter': `${dateField} >= ADD_MONTHS(TRUNC(CURRENT_DATE, 'Q'), -3) AND ${dateField} < TRUNC(CURRENT_DATE, 'Q')`,

            // === Fiscal Year-to-Date (uses actual fiscal year start) ===
            'ytd': `${dateField} >= TO_DATE('${fyStartDate}', 'YYYY-MM-DD')`,
            'fytd': `${dateField} >= TO_DATE('${fyStartDate}', 'YYYY-MM-DD')`,  // Alias

            // === Fiscal YTD to last closed period (complete accounting data) ===
            'ytd_closed': `${dateField} >= TO_DATE('${fyStartDate}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${closedPeriodEnd}', 'YYYY-MM-DD')`,
            'fytd_closed': `${dateField} >= TO_DATE('${fyStartDate}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${closedPeriodEnd}', 'YYYY-MM-DD')`,  // Alias

            // === Full Fiscal Years ===
            'this_fiscal_year': `${dateField} >= TO_DATE('${fyStartDate}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${fyEndDate}', 'YYYY-MM-DD')`,
            'last_fiscal_year': `${dateField} >= TO_DATE('${toSqlDate(lastFyStart)}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${toSqlDate(lastFyEnd)}', 'YYYY-MM-DD')`,
            '2_fiscal_years_ago': `${dateField} >= TO_DATE('${toSqlDate(twoFyStart)}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${toSqlDate(twoFyEnd)}', 'YYYY-MM-DD')`,
            '3_fiscal_years_ago': `${dateField} >= TO_DATE('${toSqlDate(threeFyStart)}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${toSqlDate(threeFyEnd)}', 'YYYY-MM-DD')`,

            // === Prior Year YTD Comparison (same point in last fiscal year) ===
            'prior_year_ytd': `${dateField} >= TO_DATE('${toSqlDate(lastFyStart)}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${toSqlDate(priorYtdEnd)}', 'YYYY-MM-DD')`,

            // === Current Fiscal Year Quarters ===
            'fiscal_q1': `${dateField} >= TO_DATE('${fyQ1.start}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${fyQ1.end}', 'YYYY-MM-DD')`,
            'fiscal_q2': `${dateField} >= TO_DATE('${fyQ2.start}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${fyQ2.end}', 'YYYY-MM-DD')`,
            'fiscal_q3': `${dateField} >= TO_DATE('${fyQ3.start}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${fyQ3.end}', 'YYYY-MM-DD')`,
            'fiscal_q4': `${dateField} >= TO_DATE('${fyQ4.start}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${fyQ4.end}', 'YYYY-MM-DD')`,

            // === Last Fiscal Year Quarters ===
            'last_fiscal_q1': `${dateField} >= TO_DATE('${lastFyQ1.start}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${lastFyQ1.end}', 'YYYY-MM-DD')`,
            'last_fiscal_q2': `${dateField} >= TO_DATE('${lastFyQ2.start}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${lastFyQ2.end}', 'YYYY-MM-DD')`,
            'last_fiscal_q3': `${dateField} >= TO_DATE('${lastFyQ3.start}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${lastFyQ3.end}', 'YYYY-MM-DD')`,
            'last_fiscal_q4': `${dateField} >= TO_DATE('${lastFyQ4.start}', 'YYYY-MM-DD') AND ${dateField} <= TO_DATE('${lastFyQ4.end}', 'YYYY-MM-DD')`,

            // === Rolling Periods (calendar-based) ===
            'last_30_days': `${dateField} >= CURRENT_DATE - 30`,
            'last_60_days': `${dateField} >= CURRENT_DATE - 60`,
            'last_90_days': `${dateField} >= CURRENT_DATE - 90`,
            'last_180_days': `${dateField} >= CURRENT_DATE - 180`,
            'last_365_days': `${dateField} >= CURRENT_DATE - 365`,
            'last_2_years': `${dateField} >= CURRENT_DATE - 730`,
            'last_3_years': `${dateField} >= CURRENT_DATE - 1095`,

            // === Multi-Year Fiscal ===
            'last_2_fiscal_years': `${dateField} >= TO_DATE('${toSqlDate(lastFyStart)}', 'YYYY-MM-DD')`,
            'last_3_fiscal_years': `${dateField} >= TO_DATE('${toSqlDate(twoFyStart)}', 'YYYY-MM-DD')`,

            // === All Time ===
            'all': '1=1'
        };
        return periodFilters[period] || periodFilters['all'];
    }

    /**
     * Format query result for LLM consumption
     *
     * TRUNCATION AWARENESS: When results hit the query limit, the response includes
     * truncation metadata so the LLM can inform the user and suggest using DataStore
     * to fetch additional rows if needed.
     *
     * @param {object} result - Query result with rows, columns
     * @param {string} toolName - Name of the tool for context
     * @param {object} [options] - Optional settings
     * @param {number} [options.limit] - The limit used in the query (for truncation detection)
     * @returns {object} Formatted result with truncation awareness
     */
    function formatResult(result, toolName, options) {
        options = options || {};

        if (!result.success) {
            return {
                success: false,
                error: result.error || 'Query failed',
                tool: toolName
            };
        }

        const rowCount = result.rows ? result.rows.length : 0;
        const formatted = {
            success: true,
            rowCount: rowCount,
            columns: result.columns || [],
            rows: result.rows || [],
            tool: toolName
        };

        // TRUNCATION AWARENESS: Detect when we hit the limit
        // If the number of rows equals the limit, there may be more data
        if (options.limit && rowCount >= options.limit) {
            formatted.truncated = true;
            formatted.queryLimit = options.limit;
            formatted.truncationNote = `Results limited to ${options.limit} rows. More data may be available. ` +
                `To see additional records, the user can ask for more results or use more specific filters.`;

            log.debug('formatResult: Results truncated', {
                tool: toolName,
                limit: options.limit,
                rowCount: rowCount
            });
        }

        return formatted;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER 1: DISCOVERY TOOLS
    // Find entities, accounts, classifications
    // ═══════════════════════════════════════════════════════════════════════════

    const DISCOVERY_TOOLS = {
        resolve_entity: {
            name: 'resolve_entity',
            shortDescription: 'Find customer/vendor/employee by name → returns ID',
            category: 'discovery',
            description: `Find a business entity (customer, vendor, employee, item, project) by name.
Returns the entity's ID, full name, and type.
Use this when the user mentions a company name, person name, product, or project.
Examples: "Oracle", "John Smith", "Widget Pro", "Project Alpha"

IMPORTANT: Use transaction_context to help determine entity type:
- For bills/payments to vendors → use type_hint: "vendor"
- For invoices/payments from customers → use type_hint: "customer"`,
            parameters: {
                type: 'object',
                properties: {
                    term: {
                        type: 'string',
                        description: 'The name to search for'
                    },
                    type_hint: {
                        type: 'string',
                        enum: ['customer', 'vendor', 'employee', 'item', 'project', 'auto'],
                        description: 'Expected entity type. Use "vendor" for AP/bill queries, "customer" for AR/invoice queries, or "auto" to search all types.'
                    },
                    transaction_context: {
                        type: 'string',
                        enum: ['VendBill', 'VendPymt', 'VendCred', 'CustInvc', 'CustPymt', 'CustCred', 'ExpRept', 'PurchOrd', 'SalesOrd'],
                        description: 'Optional: NetSuite transaction type code. VendBill/VendPymt/VendCred/ExpRept/PurchOrd → vendor, CustInvc/CustPymt/CustCred/SalesOrd → customer'
                    }
                },
                required: ['term']
            },
            execute: function(args) {
                const term = args.term;
                let typeHint = args.type_hint || 'auto';

                // Infer type_hint from transaction_context if not explicitly set
                if (typeHint === 'auto' && args.transaction_context) {
                    const vendorTypes = ['VendBill', 'VendPymt', 'VendCred', 'ExpRept', 'PurchOrd'];
                    const customerTypes = ['CustInvc', 'CustPymt', 'CustCred', 'SalesOrd'];

                    if (vendorTypes.includes(args.transaction_context)) {
                        typeHint = 'vendor';
                    } else if (customerTypes.includes(args.transaction_context)) {
                        typeHint = 'customer';
                    }
                    log.debug('resolve_entity inferred type from transaction_context', {
                        term: term,
                        transaction_context: args.transaction_context,
                        inferred_type: typeHint
                    });
                }

                try {
                    let result = EntityResolver.resolveEntityWithFallback(term, typeHint);

                    // ═══════════════════════════════════════════════════════════════════════
                    // FALLBACK: If specific type_hint search fails, try searching all types
                    // This prevents misclassification issues (e.g., "birla" as vendor when
                    // it's actually a customer) from causing complete entity resolution failure
                    // ═══════════════════════════════════════════════════════════════════════
                    if ((!result.resolved || !result.entity) && typeHint && typeHint !== 'auto') {
                        log.debug('resolve_entity fallback: specific type not found, trying auto', {
                            term: term,
                            failedTypeHint: typeHint
                        });
                        result = EntityResolver.resolveEntityWithFallback(term, 'auto');
                        if (result.resolved && result.entity) {
                            log.debug('resolve_entity fallback succeeded', {
                                term: term,
                                originalTypeHint: typeHint,
                                foundType: result.actualType
                            });
                        }
                    }

                    if (result.resolved && result.entity) {
                        // ═══════════════════════════════════════════════════════════════════════
                        // FIX: Include proper rowCount metadata
                        // rowCount: 1 when entity found, enables correct downstream processing
                        // Alternative matches included for disambiguation
                        // ═══════════════════════════════════════════════════════════════════════
                        return {
                            success: true,
                            found: true,
                            entity: {
                                id: result.entity.id,
                                name: result.entity.name,
                                type: result.actualType || 'unknown'
                            },
                            confidence: result.confidence || 1.0,
                            // FIXED: rowCount reflects that we found an entity
                            rowCount: 1,
                            // Include alternative matches if available (for ambiguity detection)
                            alternatives: result.alternatives || [],
                            ambiguous: result.ambiguous || false,
                            tool: 'resolve_entity'
                        };
                    } else {
                        // ═══════════════════════════════════════════════════════════════════════
                        // FIX: rowCount: 0 when entity NOT found
                        // This enables proper failure mode detection in REFLECT phase
                        // ═══════════════════════════════════════════════════════════════════════
                        return {
                            success: true,
                            found: false,
                            searchTerm: term,
                            typeHint: typeHint,
                            message: `No entity found matching "${term}"`,
                            // FIXED: rowCount reflects no matches
                            rowCount: 0,
                            // Include suggestions if available
                            suggestions: result.suggestions || [],
                            tool: 'resolve_entity'
                        };
                    }
                } catch (e) {
                    return {
                        success: false,
                        error: e.message,
                        rowCount: 0,
                        tool: 'resolve_entity'
                    };
                }
            },
            displayName: function(args) {
                return `Searching for "${args.term}"...`;
            }
        },

        resolve_gl_account: {
            name: 'resolve_gl_account',
            shortDescription: 'Find GL account by name/number → returns ID',
            category: 'discovery',
            description: `Find a GL (General Ledger) account by name, number, or type.
Use for questions about specific accounts, expense categories, revenue accounts.
Returns account ID, name, number, and type (Bank, Income, Expense, COGS, etc.)
Examples: "Travel expenses", "4000", "Bank accounts", "COGS"`,
            parameters: {
                type: 'object',
                properties: {
                    term: {
                        type: 'string',
                        description: 'Account name, number, or type to search'
                    },
                    account_type: {
                        type: 'string',
                        enum: ['Bank', 'AcctRec', 'OthCurrAsset', 'FixedAsset', 'OthAsset',
                               'AcctPay', 'CreditCard', 'OthCurrLiab', 'LongTermLiab',
                               'Equity', 'Income', 'COGS', 'Expense', 'OthIncome', 'OthExpense'],
                        description: 'Optional: filter by account type'
                    }
                },
                required: ['term']
            },
            execute: function(args) {
                // FIXED: Use escapeSqlLike for LIKE clauses to prevent SQL injection via wildcards
                const term = escapeSql(args.term);
                const termLike = escapeSqlLike(args.term).toLowerCase();
                const termLower = term.toLowerCase();

                let typeFilter = '';
                if (args.account_type) {
                    typeFilter = `AND account.accttype = '${escapeSql(args.account_type)}'`;
                }

                const query = `
                    SELECT
                        account.id,
                        account.acctnumber AS account_number,
                        account.accountsearchdisplayname AS account_name,
                        account.accttype AS account_type,
                        BUILTIN.DF(account.parent) AS parent_account
                    FROM account
                    WHERE account.isinactive = 'F'
                        ${typeFilter}
                        AND (
                            LOWER(account.accountsearchdisplayname) LIKE '%${termLike}%' ESCAPE '\\'
                            OR account.acctnumber LIKE '%${escapeSqlLike(args.term)}%' ESCAPE '\\'
                            OR LOWER(account.accttype) = '${termLower}'
                        )
                    ORDER BY
                        CASE
                            WHEN LOWER(account.accountsearchdisplayname) = '${termLower}' THEN 0
                            WHEN LOWER(account.accountsearchdisplayname) LIKE '${termLike}%' ESCAPE '\\' THEN 1
                            WHEN account.acctnumber = '${term}' THEN 2
                            ELSE 3
                        END,
                        account.accountsearchdisplayname
                    FETCH FIRST 10 ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'resolve_gl_account');

                if (formatted.success && formatted.rowCount > 0) {
                    formatted.found = true;
                    formatted.accounts = formatted.rows;
                    formatted.bestMatch = formatted.rows[0];
                } else {
                    formatted.found = false;
                    formatted.message = `No GL account found matching "${args.term}"`;
                }

                return formatted;
            },
            displayName: function(args) {
                return `Looking up GL account "${args.term}"...`;
            }
        },

        resolve_classification: {
            name: 'resolve_classification',
            shortDescription: 'Find class/department/location/subsidiary → returns ID',
            category: 'discovery',
            description: `Find a NetSuite classification dimension: class, location, department, or subsidiary.
Use when user mentions business segments, categories, regions, divisions, or departments.
Examples: "Hotels", "West Coast", "Engineering", "US subsidiary"`,
            parameters: {
                type: 'object',
                properties: {
                    term: {
                        type: 'string',
                        description: 'Name to search for'
                    },
                    dimension: {
                        type: 'string',
                        enum: ['class', 'location', 'department', 'subsidiary', 'auto'],
                        description: 'Which dimension to search. Use "auto" to search all.'
                    }
                },
                required: ['term']
            },
            execute: function(args) {
                const term = escapeSql(args.term);
                // FIXED: Use escapeSqlLike for LIKE clauses to prevent SQL injection via wildcards
                const termLike = escapeSqlLike(args.term).toLowerCase();
                const termLower = term.toLowerCase();
                const dimension = args.dimension || 'auto';

                // Build queries for each dimension
                const queries = [];

                if (dimension === 'auto' || dimension === 'class') {
                    queries.push(`
                        SELECT id, name, 'class' AS dimension_type
                        FROM classification
                        WHERE isinactive = 'F'
                            AND LOWER(name) LIKE '%${termLike}%' ESCAPE '\\'
                    `);
                }

                if (dimension === 'auto' || dimension === 'location') {
                    queries.push(`
                        SELECT id, name, 'location' AS dimension_type
                        FROM location
                        WHERE isinactive = 'F'
                            AND LOWER(name) LIKE '%${termLike}%' ESCAPE '\\'
                    `);
                }

                if (dimension === 'auto' || dimension === 'department') {
                    queries.push(`
                        SELECT id, name, 'department' AS dimension_type
                        FROM department
                        WHERE isinactive = 'F'
                            AND LOWER(name) LIKE '%${termLike}%' ESCAPE '\\'
                    `);
                }

                if (dimension === 'auto' || dimension === 'subsidiary') {
                    queries.push(`
                        SELECT id, name, 'subsidiary' AS dimension_type
                        FROM subsidiary
                        WHERE isinactive = 'F'
                            AND LOWER(name) LIKE '%${termLike}%' ESCAPE '\\'
                    `);
                }

                const unionQuery = queries.join(' UNION ALL ') + `
                    ORDER BY
                        CASE WHEN LOWER(name) = '${termLower}' THEN 0 ELSE 1 END,
                        name
                    FETCH FIRST 10 ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(unionQuery);
                const formatted = formatResult(result, 'resolve_classification');

                if (formatted.success && formatted.rowCount > 0) {
                    formatted.found = true;
                    formatted.classifications = formatted.rows;
                    formatted.bestMatch = formatted.rows[0];
                } else {
                    formatted.found = false;
                    formatted.message = `No classification found matching "${args.term}"`;
                }

                return formatted;
            },
            displayName: function(args) {
                return `Finding classification "${args.term}"...`;
            }
        },

        explore_schema: {
            name: 'explore_schema',
            shortDescription: 'Explore NetSuite record schema and fields',
            category: 'discovery',
            description: `Get available fields and relationships for a NetSuite SuiteQL table.
Use this to understand what data is available before writing custom queries.

IMPORTANT: Tables are NOT the same as transaction types!
- VendBill, CustInvc, etc. are TYPE VALUES in the 'transaction' table, NOT table names
- To query vendor bills: SELECT * FROM transaction WHERE type = 'VendBill'
- The 'transaction' table contains ALL transaction types

Available tables: transaction (all txn types), transactionline (line items),
transactionaccountingline (GL entries), customer, vendor, employee, item, account,
classification, department, location, subsidiary, accountingperiod, project,
inventorybalance (stock levels), budget (budget data), ProjectFinancials (project P&L)`,
            parameters: {
                type: 'object',
                properties: {
                    table: {
                        type: 'string',
                        enum: ['transaction', 'transactionline', 'transactionaccountingline',
                               'customer', 'vendor', 'employee', 'item', 'account',
                               'classification', 'department', 'location', 'subsidiary',
                               'accountingperiod', 'project', 'inventorybalance', 'budget',
                               'ProjectFinancials'],
                        description: 'SuiteQL table name (NOT transaction type - use transaction table with type filter)'
                    }
                },
                required: ['table']
            },
            execute: function(args) {
                // Pre-defined schema knowledge for key tables
                const schemas = {
                    transaction: {
                        key_fields: ['id', 'type', 'tranid', 'entity', 'trandate', 'postingperiod',
                                    'foreigntotal', 'foreignamountunpaid', 'status', 'posting',
                                    'voided', 'memo', 'duedate', 'subsidiary'],
                        notes: [
                            'transaction.amount NOT EXPOSED in SuiteQL - use foreigntotal',
                            'transaction.entity is customer for sales txns, vendor for purchase txns',
                            'type values: CustInvc, CustPymt, VendBill, VendPymt, CashSale, etc.',
                            'Use posting = \'T\' and voided = \'F\' for posted transactions'
                        ],
                        joins: {
                            'entity': 'customer.id or vendor.id (depends on transaction type)',
                            'postingperiod': 'accountingperiod.id',
                            'subsidiary': 'subsidiary.id'
                        }
                    },
                    transactionline: {
                        key_fields: ['id', 'transaction', 'item', 'quantity', 'rate', 'netamount',
                                    'class', 'department', 'location', 'mainline'],
                        notes: [
                            'Use mainline = \'F\' for detail lines, \'T\' for summary line',
                            'class, department, location are classification dimensions',
                            'Join to transaction via transactionline.transaction = transaction.id'
                        ],
                        joins: {
                            'transaction': 'transaction.id',
                            'item': 'item.id',
                            'class': 'classification.id',
                            'department': 'department.id',
                            'location': 'location.id'
                        }
                    },
                    transactionaccountingline: {
                        key_fields: ['transaction', 'account', 'debit', 'credit', 'amount'],
                        notes: [
                            'This is the GL impact of transactions - debits and credits',
                            'Use for GL-level analysis and account activity',
                            'department NOT directly available here - join through transactionline',
                            'amount = debit - credit (net impact)'
                        ],
                        joins: {
                            'transaction': 'transaction.id',
                            'account': 'account.id'
                        }
                    },
                    customer: {
                        key_fields: ['id', 'entityid', 'companyname', 'email', 'phone',
                                    'balance', 'overduebalance', 'depositbalance', 'subsidiary'],
                        notes: [
                            'companyname is the display name',
                            'balance is total outstanding AR',
                            'overduebalance is past due AR'
                        ]
                    },
                    vendor: {
                        key_fields: ['id', 'entityid', 'companyname', 'email', 'phone',
                                    'balance', 'subsidiary'],
                        notes: [
                            'companyname is the display name',
                            'balance is total outstanding AP'
                        ]
                    },
                    account: {
                        key_fields: ['id', 'acctnumber', 'accountsearchdisplayname', 'accttype',
                                    'balance', 'parent', 'isinactive', 'subsidiary'],
                        notes: [
                            'accountsearchdisplayname is the full account name',
                            'accttype: Bank, Income, Expense, COGS, AcctRec, AcctPay, etc.',
                            'balance is current balance for balance sheet accounts'
                        ]
                    },
                    accountingperiod: {
                        key_fields: ['id', 'periodname', 'startdate', 'enddate', 'isyear', 'isquarter',
                                    'closed', 'alllocked', 'arlocked', 'aplocked', 'fiscalyear'],
                        notes: [
                            'isyear = \'T\' for year records, \'F\' for months',
                            'isquarter = \'T\' for quarter records',
                            'Use isyear = \'F\' AND isquarter = \'F\' for monthly periods'
                        ]
                    },
                    inventorybalance: {
                        key_fields: ['item', 'location', 'quantityonhand', 'quantityavailable',
                                    'quantityonorder', 'quantitybackordered'],
                        notes: ['Real-time inventory by item/location', 'Join to item for details'],
                        joins: { 'item': 'item.id', 'location': 'location.id' }
                    },
                    budget: {
                        key_fields: ['id', 'account', 'accountingperiod', 'amount', 'subsidiary', 'department', 'class'],
                        notes: ['Budget amounts by account/period', 'Compare with transactionaccountingline for variance'],
                        joins: { 'account': 'account.id', 'accountingperiod': 'accountingperiod.id' }
                    },
                    ProjectFinancials: {
                        key_fields: ['PROJECT', 'projecttask', 'item', 'ACCOUNT', 'actual', 'amount', 'DATE', 'subsidiary'],
                        notes: ['Project P&L data', 'actual=T for actuals', 'Negative=revenue, positive=cost'],
                        joins: { 'PROJECT': 'project.id', 'ACCOUNT': 'account.id' }
                    }
                };

                const schema = schemas[args.table];
                if (!schema) {
                    return {
                        success: true,
                        table: args.table,
                        message: 'Schema details not pre-cached. Use with caution.',
                        tool: 'explore_schema'
                    };
                }

                return {
                    success: true,
                    table: args.table,
                    schema: schema,
                    tool: 'explore_schema'
                };
            },
            displayName: function(args) {
                return `Exploring ${args.table} schema...`;
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER 2: DATA TOOLS
    // Pre-optimized queries for specific data needs
    // ═══════════════════════════════════════════════════════════════════════════

    const DATA_TOOLS = {
        get_ap_aging: {
            name: 'get_ap_aging',
            shortDescription: 'AP aging buckets by vendor (current, 1-30, 31-60, etc.)',
            category: 'data',
            description: `Get accounts payable aging summary by bucket (Current, 1-30, 31-60, 61-90, 90+).
Shows what we owe to vendors, broken down by how overdue.
Use for: "AP aging", "what do we owe", "overdue bills", "vendor balances"

Supports batch vendor lookups via vendor_ids array for efficient multi-vendor queries.
Can filter by minimum outstanding amount, specific aging buckets, and subsidiary.`,
            parameters: {
                type: 'object',
                properties: {
                    vendor_id: {
                        type: 'number',
                        description: 'Filter to specific vendor ID (use vendor_ids for multiple)'
                    },
                    vendor_ids: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Array of vendor IDs for batch lookup (more efficient than multiple calls)'
                    },
                    min_outstanding: {
                        type: 'number',
                        description: 'Minimum total outstanding amount to include (e.g., 10000 for $10K+)'
                    },
                    min_overdue: {
                        type: 'number',
                        description: 'Minimum overdue amount (amounts past due date)'
                    },
                    aging_bucket: {
                        type: 'string',
                        enum: ['current', '1_30', '31_60', '61_90', 'over_90', 'over_60', 'over_30'],
                        description: 'Filter to vendors with amounts in specific aging bucket'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary ID'
                    },
                    include_details: {
                        type: 'boolean',
                        description: 'Include bill-level detail instead of vendor summary'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum vendors to return (default: 500, no hard limit - ask for more if needed)'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['total_outstanding', 'overdue_amount', 'vendor_name', 'days_over_90'],
                        description: 'Sort results by field (default: total_outstanding)'
                    }
                },
                required: []
            },
            execute: function(args) {
                // Handle single vendor_id or batch vendor_ids
                let vendorFilter = '';
                if (args.vendor_ids && args.vendor_ids.length > 0) {
                    vendorFilter = `AND transaction.entity IN (${args.vendor_ids.join(',')})`;
                } else if (args.vendor_id) {
                    vendorFilter = `AND transaction.entity = ${args.vendor_id}`;
                }

                const subsidiaryFilter = args.subsidiary_id ? `AND transaction.subsidiary = ${args.subsidiary_id}` : '';
                const limit = args.limit || 500;  // Increased default - no unnecessary restriction

                // Determine sort order
                let orderBy = 'total_unpaid DESC';
                if (args.sort_by === 'overdue_amount') orderBy = '(days_1_30 + days_31_60 + days_61_90 + days_over_90) DESC';
                else if (args.sort_by === 'vendor_name') orderBy = 'vendor_name ASC';
                else if (args.sort_by === 'days_over_90') orderBy = 'days_over_90 DESC';

                // Build HAVING clause for filters
                const havingClauses = [];
                if (args.min_outstanding) havingClauses.push(`SUM(transaction.foreignamountunpaid) >= ${args.min_outstanding}`);
                if (args.min_overdue) havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 0 THEN transaction.foreignamountunpaid ELSE 0 END) >= ${args.min_overdue}`);

                // Aging bucket filters
                if (args.aging_bucket === 'over_60') {
                    havingClauses.push(`(SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) + SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END)) > 0`);
                } else if (args.aging_bucket === 'over_90') {
                    havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END) > 0`);
                } else if (args.aging_bucket === 'over_30') {
                    havingClauses.push(`(SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) + SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) + SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END)) > 0`);
                } else if (args.aging_bucket === '61_90') {
                    havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) > 0`);
                } else if (args.aging_bucket === '31_60') {
                    havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) > 0`);
                } else if (args.aging_bucket === '1_30') {
                    havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 1 AND 30 THEN transaction.foreignamountunpaid ELSE 0 END) > 0`);
                } else if (args.aging_bucket === 'current') {
                    havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END) > 0`);
                }

                const havingClause = havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : '';

                // Detail query if requested
                if (args.include_details) {
                    const detailQuery = `
                        SELECT
                            vendor.id AS vendor_id,
                            vendor.companyname AS vendor_name,
                            transaction.id AS bill_id,
                            transaction.tranid AS bill_number,
                            transaction.trandate AS bill_date,
                            transaction.duedate AS due_date,
                            transaction.foreigntotal AS bill_amount,
                            transaction.foreignamountunpaid AS amount_due,
                            CURRENT_DATE - transaction.duedate AS days_overdue,
                            transaction.memo
                        FROM transaction
                        INNER JOIN vendor ON transaction.entity = vendor.id
                        WHERE transaction.type = 'VendBill'
                            AND transaction.foreignamountunpaid != 0
                            AND transaction.posting = 'T'
                            AND transaction.voided = 'F'
                            ${vendorFilter}
                            ${subsidiaryFilter}
                        ORDER BY vendor.companyname, transaction.duedate
                        FETCH FIRST ${limit * 10} ROWS ONLY
                    `;
                    const detailLimit = limit * 10;
                    const result = QueryExecutor.executeQuery(detailQuery);
                    return formatResult(result, 'get_ap_aging', { limit: detailLimit });
                }

                const query = `
                    SELECT
                        vendor.id AS vendor_id,
                        vendor.companyname AS vendor_name,
                        SUM(transaction.foreignamountunpaid) AS total_unpaid,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END) AS current_amount,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 1 AND 30 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_1_30,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_31_60,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_61_90,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_over_90,
                        COUNT(transaction.id) AS bill_count
                    FROM transaction
                    INNER JOIN vendor ON transaction.entity = vendor.id
                    WHERE transaction.type = 'VendBill'
                        AND transaction.foreignamountunpaid != 0
                        AND transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        ${vendorFilter}
                        ${subsidiaryFilter}
                    GROUP BY vendor.id, vendor.companyname
                    ${havingClause}
                    ORDER BY ${orderBy}
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_ap_aging', { limit: limit });
            },
            displayName: function(args) {
                if (args.vendor_ids && args.vendor_ids.length > 0) {
                    return `Getting AP aging for ${args.vendor_ids.length} vendors...`;
                }
                return args.vendor_id ? 'Getting vendor AP details...' : 'Getting AP aging summary...';
            }
        },

        get_ar_aging: {
            name: 'get_ar_aging',
            shortDescription: 'AR aging buckets by customer (current, 1-30, 31-60, etc.)',
            category: 'data',
            description: `Get accounts receivable aging summary by bucket (Current, 1-30, 31-60, 61-90, 90+).
Shows what customers owe us, broken down by how overdue.
Use for: "AR aging", "what are we owed", "overdue invoices", "customer balances"

Supports batch customer lookups via customer_ids array for efficient multi-customer queries.
Can filter by minimum outstanding amount, specific aging buckets, subsidiary, and sales rep.`,
            parameters: {
                type: 'object',
                properties: {
                    customer_id: {
                        type: 'number',
                        description: 'Filter to specific customer ID (use customer_ids for multiple)'
                    },
                    customer_ids: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Array of customer IDs for batch lookup (more efficient than multiple calls)'
                    },
                    min_outstanding: {
                        type: 'number',
                        description: 'Minimum total outstanding amount to include (e.g., 10000 for $10K+)'
                    },
                    min_overdue: {
                        type: 'number',
                        description: 'Minimum overdue amount (amounts past due date)'
                    },
                    aging_bucket: {
                        type: 'string',
                        enum: ['current', '1_30', '31_60', '61_90', 'over_90', 'over_60', 'over_30'],
                        description: 'Filter to customers with amounts in specific aging bucket'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary ID'
                    },
                    sales_rep_id: {
                        type: 'number',
                        description: 'Filter by sales rep ID'
                    },
                    include_details: {
                        type: 'boolean',
                        description: 'Include invoice-level detail instead of customer summary'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum customers to return (default: 500, no hard limit - ask for more if needed)'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['total_outstanding', 'overdue_amount', 'customer_name', 'days_over_90'],
                        description: 'Sort results by field (default: total_outstanding)'
                    }
                },
                required: []
            },
            execute: function(args) {
                // Handle single customer_id or batch customer_ids
                let customerFilter = '';
                if (args.customer_ids && args.customer_ids.length > 0) {
                    customerFilter = `AND transaction.entity IN (${args.customer_ids.join(',')})`;
                } else if (args.customer_id) {
                    customerFilter = `AND transaction.entity = ${args.customer_id}`;
                }

                const subsidiaryFilter = args.subsidiary_id ? `AND transaction.subsidiary = ${args.subsidiary_id}` : '';
                const salesRepFilter = args.sales_rep_id ? `AND transaction.salesrep = ${args.sales_rep_id}` : '';
                const limit = args.limit || 500;  // Increased default - no unnecessary restriction

                // Determine sort order
                let orderBy = 'total_unpaid DESC';
                if (args.sort_by === 'overdue_amount') orderBy = '(days_1_30 + days_31_60 + days_61_90 + days_over_90) DESC';
                else if (args.sort_by === 'customer_name') orderBy = 'customer_name ASC';
                else if (args.sort_by === 'days_over_90') orderBy = 'days_over_90 DESC';

                // Build HAVING clause for filters
                const havingClauses = [];
                if (args.min_outstanding) havingClauses.push(`SUM(transaction.foreignamountunpaid) >= ${args.min_outstanding}`);
                if (args.min_overdue) havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 0 THEN transaction.foreignamountunpaid ELSE 0 END) >= ${args.min_overdue}`);

                // Aging bucket filters
                if (args.aging_bucket === 'over_60') {
                    havingClauses.push(`(SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) + SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END)) > 0`);
                } else if (args.aging_bucket === 'over_90') {
                    havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END) > 0`);
                } else if (args.aging_bucket === 'over_30') {
                    havingClauses.push(`(SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) + SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) + SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END)) > 0`);
                } else if (args.aging_bucket === '61_90') {
                    havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) > 0`);
                } else if (args.aging_bucket === '31_60') {
                    havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) > 0`);
                } else if (args.aging_bucket === '1_30') {
                    havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 1 AND 30 THEN transaction.foreignamountunpaid ELSE 0 END) > 0`);
                } else if (args.aging_bucket === 'current') {
                    havingClauses.push(`SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END) > 0`);
                }

                const havingClause = havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : '';

                // Detail query if requested
                if (args.include_details) {
                    const detailQuery = `
                        SELECT
                            customer.id AS customer_id,
                            customer.companyname AS customer_name,
                            transaction.id AS invoice_id,
                            transaction.tranid AS invoice_number,
                            transaction.trandate AS invoice_date,
                            transaction.duedate AS due_date,
                            transaction.foreigntotal AS invoice_amount,
                            transaction.foreignamountunpaid AS amount_due,
                            CURRENT_DATE - transaction.duedate AS days_overdue,
                            transaction.memo
                        FROM transaction
                        INNER JOIN customer ON transaction.entity = customer.id
                        WHERE transaction.type = 'CustInvc'
                            AND transaction.foreignamountunpaid != 0
                            AND transaction.posting = 'T'
                            AND transaction.voided = 'F'
                            ${customerFilter}
                            ${subsidiaryFilter}
                            ${salesRepFilter}
                        ORDER BY customer.companyname, transaction.duedate
                        FETCH FIRST ${limit * 10} ROWS ONLY
                    `;
                    const detailLimit = limit * 10;  // More rows for detail view
                    const result = QueryExecutor.executeQuery(detailQuery);
                    return formatResult(result, 'get_ar_aging', { limit: detailLimit });
                }

                const query = `
                    SELECT
                        customer.id AS customer_id,
                        customer.companyname AS customer_name,
                        SUM(transaction.foreignamountunpaid) AS total_unpaid,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END) AS current_amount,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 1 AND 30 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_1_30,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_31_60,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_61_90,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_over_90,
                        COUNT(transaction.id) AS invoice_count
                    FROM transaction
                    INNER JOIN customer ON transaction.entity = customer.id
                    WHERE transaction.type = 'CustInvc'
                        AND transaction.foreignamountunpaid != 0
                        AND transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        ${customerFilter}
                        ${subsidiaryFilter}
                        ${salesRepFilter}
                    GROUP BY customer.id, customer.companyname
                    ${havingClause}
                    ORDER BY ${orderBy}
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_ar_aging', { limit: limit });
            },
            displayName: function(args) {
                if (args.customer_ids && args.customer_ids.length > 0) {
                    return `Getting AR aging for ${args.customer_ids.length} customers...`;
                }
                return args.customer_id ? 'Getting customer AR details...' : 'Getting AR aging summary...';
            }
        },

        get_vendor_spend: {
            name: 'get_vendor_spend',
            shortDescription: 'Spend by vendor for a period',
            category: 'data',
            description: `Get vendor spending analysis.
Shows total spend by vendor for a given period.
Use for: "vendor spend", "who do we pay most", "top vendors", "AP by vendor"

Supports batch vendor lookups, spend thresholds, and dimensional filtering.
Can filter by minimum/maximum spend, class, department, and subsidiary.`,
            parameters: {
                type: 'object',
                properties: {
                    vendor_id: {
                        type: 'number',
                        description: 'Filter to specific vendor ID (use vendor_ids for multiple)'
                    },
                    vendor_ids: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Array of vendor IDs for batch lookup'
                    },
                    period: {
                        type: 'string',
                        enum: [
                            'today', 'yesterday', 'this_week', 'last_week',
                            'this_month', 'last_month', 'this_quarter', 'last_quarter',
                            'ytd', 'fytd', 'ytd_closed', 'prior_year_ytd',
                            'this_fiscal_year', 'last_fiscal_year', '2_fiscal_years_ago', '3_fiscal_years_ago',
                            'fiscal_q1', 'fiscal_q2', 'fiscal_q3', 'fiscal_q4',
                            'last_fiscal_q1', 'last_fiscal_q2', 'last_fiscal_q3', 'last_fiscal_q4',
                            'last_30_days', 'last_60_days', 'last_90_days', 'last_180_days', 'last_365_days',
                            'last_2_years', 'last_3_years', 'last_2_fiscal_years', 'last_3_fiscal_years',
                            'all'
                        ],
                        description: 'Time period filter. Fiscal periods use actual fiscal year from accounting periods. ytd_closed uses last closed period for complete data. prior_year_ytd matches same point in last fiscal year for comparison. (default: all)'
                    },
                    min_spend: {
                        type: 'number',
                        description: 'Minimum total spend threshold (e.g., 100000 for $100K+)'
                    },
                    max_spend: {
                        type: 'number',
                        description: 'Maximum total spend cap'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Filter by class ID'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Filter by department ID'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary ID'
                    },
                    include_ap_aging: {
                        type: 'boolean',
                        description: 'Include current AP aging data for each vendor'
                    },
                    limit: {
                        type: 'number',
                        description: 'Max vendors to return (default: 25)'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['total_spend', 'transaction_count', 'vendor_name', 'recent_activity'],
                        description: 'Sort results by field (default: total_spend)'
                    }
                },
                required: []
            },
            execute: function(args) {
                // Handle single vendor_id or batch vendor_ids
                let vendorFilter = '';
                if (args.vendor_ids && args.vendor_ids.length > 0) {
                    vendorFilter = `AND transaction.entity IN (${args.vendor_ids.join(',')})`;
                } else if (args.vendor_id) {
                    vendorFilter = `AND transaction.entity = ${args.vendor_id}`;
                }

                const periodFilter = buildPeriodFilter(args.period || 'all');
                const subsidiaryFilter = args.subsidiary_id ? `AND transaction.subsidiary = ${args.subsidiary_id}` : '';
                const limit = args.limit || 25;

                // Class/department filters require joining transactionline
                const hasLineFilters = args.class_id || args.department_id;
                const lineJoin = hasLineFilters ? 'LEFT JOIN transactionline tl ON tl.transaction = transaction.id AND tl.mainline = \'F\'' : '';
                const classFilter = args.class_id ? `AND tl.class = ${args.class_id}` : '';
                const deptFilter = args.department_id ? `AND tl.department = ${args.department_id}` : '';

                // Determine sort order with runtime validation (defense-in-depth)
                const sortMappings = {
                    'total_spend': 'total_spend DESC',
                    'transaction_count': 'transaction_count DESC',
                    'vendor_name': 'vendor_name ASC',
                    'recent_activity': 'last_transaction DESC'
                };
                const orderBy = buildSafeOrderBy(args.sort_by, sortMappings, 'total_spend DESC');

                // Build HAVING clause for spend thresholds
                const havingClauses = [];
                if (args.min_spend) havingClauses.push(`SUM(ABS(transaction.foreigntotal)) >= ${args.min_spend}`);
                if (args.max_spend) havingClauses.push(`SUM(ABS(transaction.foreigntotal)) <= ${args.max_spend}`);
                const havingClause = havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : '';

                // Base query with optional AP aging
                let selectFields = `
                    vendor.id AS vendor_id,
                    vendor.companyname AS vendor_name,
                    COUNT(DISTINCT transaction.id) AS transaction_count,
                    SUM(ABS(transaction.foreigntotal)) AS total_spend,
                    MIN(transaction.trandate) AS first_transaction,
                    MAX(transaction.trandate) AS last_transaction`;

                // Add AP aging subquery if requested
                let apAgingJoin = '';
                if (args.include_ap_aging) {
                    selectFields += `,
                    ap_aging.total_outstanding,
                    ap_aging.overdue_amount`;
                    apAgingJoin = `
                    LEFT JOIN (
                        SELECT
                            t.entity,
                            SUM(t.foreignamountunpaid) AS total_outstanding,
                            SUM(CASE WHEN CURRENT_DATE - t.duedate > 0 THEN t.foreignamountunpaid ELSE 0 END) AS overdue_amount
                        FROM transaction t
                        WHERE t.type = 'VendBill'
                            AND t.foreignamountunpaid != 0
                            AND t.posting = 'T'
                            AND t.voided = 'F'
                        GROUP BY t.entity
                    ) ap_aging ON ap_aging.entity = vendor.id`;
                }

                const query = `
                    SELECT ${selectFields}
                    FROM transaction
                    INNER JOIN vendor ON transaction.entity = vendor.id
                    ${lineJoin}
                    ${apAgingJoin}
                    WHERE transaction.type IN ('VendBill', 'VendCred')
                        AND transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        AND ${periodFilter}
                        ${vendorFilter}
                        ${subsidiaryFilter}
                        ${classFilter}
                        ${deptFilter}
                    GROUP BY vendor.id, vendor.companyname${args.include_ap_aging ? ', ap_aging.total_outstanding, ap_aging.overdue_amount' : ''}
                    ${havingClause}
                    ORDER BY ${orderBy}
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_vendor_spend');
            },
            displayName: function(args) {
                if (args.vendor_ids && args.vendor_ids.length > 0) {
                    return `Analyzing spend for ${args.vendor_ids.length} vendors...`;
                }
                return args.vendor_id ? 'Getting vendor spend details...' : 'Analyzing vendor spending...';
            }
        },

        get_customer_revenue: {
            name: 'get_customer_revenue',
            shortDescription: 'Revenue by customer for a period',
            category: 'data',
            description: `Get customer revenue analysis.
Shows total revenue by customer for a given period.
Use for: "customer revenue", "top customers", "sales by customer"

Supports batch customer lookups, revenue thresholds, and dimensional filtering.
Can filter by minimum/maximum revenue, class, department, subsidiary, and sales rep.`,
            parameters: {
                type: 'object',
                properties: {
                    customer_id: {
                        type: 'number',
                        description: 'Filter to specific customer ID (use customer_ids for multiple)'
                    },
                    customer_ids: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Array of customer IDs for batch lookup'
                    },
                    period: {
                        type: 'string',
                        enum: [
                            'today', 'yesterday', 'this_week', 'last_week',
                            'this_month', 'last_month', 'this_quarter', 'last_quarter',
                            'ytd', 'fytd', 'ytd_closed', 'prior_year_ytd',
                            'this_fiscal_year', 'last_fiscal_year', '2_fiscal_years_ago', '3_fiscal_years_ago',
                            'fiscal_q1', 'fiscal_q2', 'fiscal_q3', 'fiscal_q4',
                            'last_fiscal_q1', 'last_fiscal_q2', 'last_fiscal_q3', 'last_fiscal_q4',
                            'last_30_days', 'last_60_days', 'last_90_days', 'last_180_days', 'last_365_days',
                            'last_2_years', 'last_3_years', 'last_2_fiscal_years', 'last_3_fiscal_years',
                            'all'
                        ],
                        description: 'Time period filter. Fiscal periods use actual fiscal year from accounting periods. ytd_closed uses last closed period for complete data. prior_year_ytd matches same point in last fiscal year for comparison. (default: all)'
                    },
                    min_revenue: {
                        type: 'number',
                        description: 'Minimum total revenue threshold (e.g., 100000 for $100K+)'
                    },
                    max_revenue: {
                        type: 'number',
                        description: 'Maximum total revenue cap'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Filter by class ID'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Filter by department ID'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary ID'
                    },
                    sales_rep_id: {
                        type: 'number',
                        description: 'Filter by sales rep ID'
                    },
                    include_ar_aging: {
                        type: 'boolean',
                        description: 'Include current AR aging data for each customer'
                    },
                    limit: {
                        type: 'number',
                        description: 'Max customers to return (default: 25)'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['total_revenue', 'transaction_count', 'customer_name', 'recent_activity'],
                        description: 'Sort results by field (default: total_revenue)'
                    }
                },
                required: []
            },
            execute: function(args) {
                // Handle single customer_id or batch customer_ids
                let customerFilter = '';
                if (args.customer_ids && args.customer_ids.length > 0) {
                    customerFilter = `AND transaction.entity IN (${args.customer_ids.join(',')})`;
                } else if (args.customer_id) {
                    customerFilter = `AND transaction.entity = ${args.customer_id}`;
                }

                const periodFilter = buildPeriodFilter(args.period || 'all');
                const subsidiaryFilter = args.subsidiary_id ? `AND transaction.subsidiary = ${args.subsidiary_id}` : '';
                const salesRepFilter = args.sales_rep_id ? `AND transaction.salesrep = ${args.sales_rep_id}` : '';
                const limit = args.limit || 25;

                // Class/department filters require joining transactionline
                const hasLineFilters = args.class_id || args.department_id;
                const lineJoin = hasLineFilters ? 'LEFT JOIN transactionline tl ON tl.transaction = transaction.id AND tl.mainline = \'F\'' : '';
                const classFilter = args.class_id ? `AND tl.class = ${args.class_id}` : '';
                const deptFilter = args.department_id ? `AND tl.department = ${args.department_id}` : '';

                // Determine sort order
                let orderBy = 'total_revenue DESC';
                if (args.sort_by === 'transaction_count') orderBy = 'transaction_count DESC';
                else if (args.sort_by === 'customer_name') orderBy = 'customer_name ASC';
                else if (args.sort_by === 'recent_activity') orderBy = 'last_transaction DESC';

                // Build HAVING clause for revenue thresholds
                const havingClauses = [];
                if (args.min_revenue) havingClauses.push(`SUM(transaction.foreigntotal) >= ${args.min_revenue}`);
                if (args.max_revenue) havingClauses.push(`SUM(transaction.foreigntotal) <= ${args.max_revenue}`);
                const havingClause = havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : '';

                // Base query with optional AR aging
                let selectFields = `
                    customer.id AS customer_id,
                    customer.companyname AS customer_name,
                    COUNT(DISTINCT transaction.id) AS transaction_count,
                    SUM(transaction.foreigntotal) AS total_revenue,
                    MIN(transaction.trandate) AS first_transaction,
                    MAX(transaction.trandate) AS last_transaction`;

                // Add AR aging subquery if requested
                let arAgingJoin = '';
                if (args.include_ar_aging) {
                    selectFields += `,
                    ar_aging.total_outstanding,
                    ar_aging.overdue_amount`;
                    arAgingJoin = `
                    LEFT JOIN (
                        SELECT
                            t.entity,
                            SUM(t.foreignamountunpaid) AS total_outstanding,
                            SUM(CASE WHEN CURRENT_DATE - t.duedate > 0 THEN t.foreignamountunpaid ELSE 0 END) AS overdue_amount
                        FROM transaction t
                        WHERE t.type = 'CustInvc'
                            AND t.foreignamountunpaid != 0
                            AND t.posting = 'T'
                            AND t.voided = 'F'
                        GROUP BY t.entity
                    ) ar_aging ON ar_aging.entity = customer.id`;
                }

                const query = `
                    SELECT ${selectFields}
                    FROM transaction
                    INNER JOIN customer ON transaction.entity = customer.id
                    ${lineJoin}
                    ${arAgingJoin}
                    WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                        AND transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        AND ${periodFilter}
                        ${customerFilter}
                        ${subsidiaryFilter}
                        ${salesRepFilter}
                        ${classFilter}
                        ${deptFilter}
                    GROUP BY customer.id, customer.companyname${args.include_ar_aging ? ', ar_aging.total_outstanding, ar_aging.overdue_amount' : ''}
                    ${havingClause}
                    ORDER BY ${orderBy}
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_customer_revenue');
            },
            displayName: function(args) {
                if (args.customer_ids && args.customer_ids.length > 0) {
                    return `Analyzing revenue for ${args.customer_ids.length} customers...`;
                }
                return args.customer_id ? 'Getting customer revenue details...' : 'Analyzing customer revenue...';
            }
        },

        get_gl_activity: {
            name: 'get_gl_activity',
            shortDescription: 'GL account activity and transaction details',
            category: 'data',
            description: `Get GL (General Ledger) transaction activity.
Shows transactions and their GL impact filtered by account, class, location, and/or period.
Use for: "GL activity", "account activity", "what hit this account", "GL variance", "class expenses"

Supports filtering by amount ranges, transaction type, entity, and multiple dimensions.
NOTE: Class/department/location filters use the segment values from the GL accounting lines directly.`,
            parameters: {
                type: 'object',
                properties: {
                    account_id: {
                        type: 'number',
                        description: 'GL account ID to filter by'
                    },
                    account_ids: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Array of GL account IDs for batch lookup'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Class ID to filter by (uses GL line segment)'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Department ID to filter by (uses GL line segment)'
                    },
                    location_id: {
                        type: 'number',
                        description: 'Location ID to filter by (uses GL line segment)'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary ID'
                    },
                    entity_id: {
                        type: 'number',
                        description: 'Filter by customer or vendor ID'
                    },
                    transaction_type: {
                        type: 'string',
                        enum: ['VendBill', 'VendPymt', 'CustInvc', 'CustPymt', 'Journal', 'Check', 'Deposit', 'ExpRept'],
                        description: 'Filter by transaction type'
                    },
                    min_amount: {
                        type: 'number',
                        description: 'Minimum absolute amount to include'
                    },
                    max_amount: {
                        type: 'number',
                        description: 'Maximum absolute amount to include'
                    },
                    memo_contains: {
                        type: 'string',
                        description: 'Filter by memo text (case-insensitive search)'
                    },
                    period: {
                        type: 'string',
                        enum: [
                            'today', 'yesterday', 'this_week', 'last_week',
                            'this_month', 'last_month', 'this_quarter', 'last_quarter',
                            'ytd', 'fytd', 'ytd_closed', 'prior_year_ytd',
                            'this_fiscal_year', 'last_fiscal_year', '2_fiscal_years_ago', '3_fiscal_years_ago',
                            'fiscal_q1', 'fiscal_q2', 'fiscal_q3', 'fiscal_q4',
                            'last_fiscal_q1', 'last_fiscal_q2', 'last_fiscal_q3', 'last_fiscal_q4',
                            'last_30_days', 'last_60_days', 'last_90_days', 'last_180_days', 'last_365_days',
                            'last_2_years', 'last_3_years', 'last_2_fiscal_years', 'last_3_fiscal_years',
                            'all'
                        ],
                        description: 'Time period filter. Fiscal periods use actual fiscal year from accounting periods. ytd_closed uses last closed period for complete data. prior_year_ytd matches same point in last fiscal year for comparison. (default: all)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Max transactions to return (default: 50)'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['date', 'amount', 'account', 'entity'],
                        description: 'Sort results by field (default: date desc)'
                    },
                    group_by: {
                        type: 'string',
                        enum: ['none', 'account', 'period', 'class', 'department'],
                        description: 'Group results (default: none - individual transactions)'
                    }
                },
                required: []
            },
            execute: function(args) {
                // Build filters - using transactionaccountingline's own segment fields
                const filters = [];

                // Account filter (single or batch)
                if (args.account_ids && args.account_ids.length > 0) {
                    filters.push(`tal.account IN (${args.account_ids.join(',')})`);
                } else if (args.account_id) {
                    filters.push(`tal.account = ${args.account_id}`);
                }

                if (args.class_id) filters.push(`tal.class = ${args.class_id}`);
                if (args.department_id) filters.push(`tal.department = ${args.department_id}`);
                if (args.location_id) filters.push(`tal.location = ${args.location_id}`);
                if (args.subsidiary_id) filters.push(`transaction.subsidiary = ${args.subsidiary_id}`);
                if (args.entity_id) filters.push(`transaction.entity = ${args.entity_id}`);
                if (args.transaction_type) filters.push(`transaction.type = '${escapeSql(args.transaction_type)}'`);
                // FIXED: Use escapeSqlLike for LIKE clause to prevent SQL injection via wildcards
                if (args.memo_contains) filters.push(`LOWER(transaction.memo) LIKE '%${escapeSqlLike(args.memo_contains.toLowerCase())}%' ESCAPE '\\'`);

                // Amount filters
                if (args.min_amount) filters.push(`ABS(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) >= ${args.min_amount}`);
                if (args.max_amount) filters.push(`ABS(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) <= ${args.max_amount}`);

                const periodFilter = buildPeriodFilter(args.period || 'all');
                const limit = args.limit || 50;

                // Determine sort order
                let orderBy = 'transaction.trandate DESC, ABS(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) DESC';
                if (args.sort_by === 'amount') orderBy = 'ABS(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) DESC';
                else if (args.sort_by === 'account') orderBy = 'account.acctnumber ASC, transaction.trandate DESC';
                else if (args.sort_by === 'entity') orderBy = 'BUILTIN.DF(transaction.entity), transaction.trandate DESC';

                // Handle group_by option
                if (args.group_by && args.group_by !== 'none') {
                    let groupQuery;
                    if (args.group_by === 'account') {
                        groupQuery = `
                            SELECT
                                account.acctnumber AS account_number,
                                account.accountsearchdisplayname AS account_name,
                                COUNT(DISTINCT transaction.id) AS transaction_count,
                                SUM(COALESCE(tal.debit, 0)) AS total_debit,
                                SUM(COALESCE(tal.credit, 0)) AS total_credit,
                                SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS net_amount
                            FROM transactionaccountingline tal
                            INNER JOIN transaction ON tal.transaction = transaction.id
                            INNER JOIN account ON tal.account = account.id
                            WHERE transaction.posting = 'T'
                                AND transaction.voided = 'F'
                                AND ${periodFilter}
                                ${filters.length > 0 ? 'AND ' + filters.join(' AND ') : ''}
                            GROUP BY account.acctnumber, account.accountsearchdisplayname
                            ORDER BY ABS(SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0))) DESC
                            FETCH FIRST ${limit} ROWS ONLY
                        `;
                    } else if (args.group_by === 'period') {
                        groupQuery = `
                            SELECT
                                TO_CHAR(transaction.trandate, 'YYYY-MM') AS period,
                                COUNT(DISTINCT transaction.id) AS transaction_count,
                                SUM(COALESCE(tal.debit, 0)) AS total_debit,
                                SUM(COALESCE(tal.credit, 0)) AS total_credit,
                                SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS net_amount
                            FROM transactionaccountingline tal
                            INNER JOIN transaction ON tal.transaction = transaction.id
                            INNER JOIN account ON tal.account = account.id
                            WHERE transaction.posting = 'T'
                                AND transaction.voided = 'F'
                                AND ${periodFilter}
                                ${filters.length > 0 ? 'AND ' + filters.join(' AND ') : ''}
                            GROUP BY TO_CHAR(transaction.trandate, 'YYYY-MM')
                            ORDER BY period DESC
                            FETCH FIRST ${limit} ROWS ONLY
                        `;
                    } else if (args.group_by === 'class') {
                        groupQuery = `
                            SELECT
                                BUILTIN.DF(tal.class) AS class_name,
                                COUNT(DISTINCT transaction.id) AS transaction_count,
                                SUM(COALESCE(tal.debit, 0)) AS total_debit,
                                SUM(COALESCE(tal.credit, 0)) AS total_credit,
                                SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS net_amount
                            FROM transactionaccountingline tal
                            INNER JOIN transaction ON tal.transaction = transaction.id
                            INNER JOIN account ON tal.account = account.id
                            WHERE transaction.posting = 'T'
                                AND transaction.voided = 'F'
                                AND ${periodFilter}
                                ${filters.length > 0 ? 'AND ' + filters.join(' AND ') : ''}
                            GROUP BY tal.class, BUILTIN.DF(tal.class)
                            ORDER BY ABS(SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0))) DESC
                            FETCH FIRST ${limit} ROWS ONLY
                        `;
                    } else if (args.group_by === 'department') {
                        groupQuery = `
                            SELECT
                                BUILTIN.DF(tal.department) AS department_name,
                                COUNT(DISTINCT transaction.id) AS transaction_count,
                                SUM(COALESCE(tal.debit, 0)) AS total_debit,
                                SUM(COALESCE(tal.credit, 0)) AS total_credit,
                                SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS net_amount
                            FROM transactionaccountingline tal
                            INNER JOIN transaction ON tal.transaction = transaction.id
                            INNER JOIN account ON tal.account = account.id
                            WHERE transaction.posting = 'T'
                                AND transaction.voided = 'F'
                                AND ${periodFilter}
                                ${filters.length > 0 ? 'AND ' + filters.join(' AND ') : ''}
                            GROUP BY tal.department, BUILTIN.DF(tal.department)
                            ORDER BY ABS(SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0))) DESC
                            FETCH FIRST ${limit} ROWS ONLY
                        `;
                    }
                    const result = QueryExecutor.executeQuery(groupQuery);
                    return formatResult(result, 'get_gl_activity');
                }

                // Default: individual transactions
                const query = `
                    SELECT
                        transaction.id AS transaction_id,
                        transaction.tranid AS document_number,
                        transaction.type AS transaction_type,
                        transaction.trandate,
                        transaction.memo,
                        BUILTIN.DF(transaction.entity) AS entity_name,
                        account.acctnumber AS account_number,
                        account.accountsearchdisplayname AS account_name,
                        BUILTIN.DF(tal.class) AS class_name,
                        BUILTIN.DF(tal.department) AS department_name,
                        BUILTIN.DF(tal.location) AS location_name,
                        tal.debit,
                        tal.credit,
                        (COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS net_amount
                    FROM transactionaccountingline tal
                    INNER JOIN transaction ON tal.transaction = transaction.id
                    INNER JOIN account ON tal.account = account.id
                    WHERE transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        AND ${periodFilter}
                        ${filters.length > 0 ? 'AND ' + filters.join(' AND ') : ''}
                    ORDER BY ${orderBy}
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_gl_activity');
            },
            displayName: function(args) {
                if (args.group_by && args.group_by !== 'none') {
                    return `Getting GL activity by ${args.group_by}...`;
                }
                return 'Pulling GL activity...';
            }
        },

        get_trial_balance: {
            name: 'get_trial_balance',
            shortDescription: 'Trial balance for a period',
            category: 'data',
            description: `Get trial balance - account balances as of now.
Shows all accounts with their debit/credit totals.

**For INCOME STATEMENT / P&L:** Call 3 times with account_type filters:
1. get_trial_balance({account_type: "Income"}) - Revenue
2. get_trial_balance({account_type: "COGS"}) - Cost of Goods Sold
3. get_trial_balance({account_type: "Expense"}) - Operating Expenses
Then calculate: Gross Profit = Revenue - COGS, Net Income = Gross Profit - Expenses

**For BALANCE SHEET:** Call 3 times:
1. get_trial_balance({account_type: "Bank"}) + AcctRec + OthCurrAsset + FixedAsset = Assets
2. get_trial_balance({account_type: "AcctPay"}) + OthCurrLiab + LongTermLiab = Liabilities
3. get_trial_balance({account_type: "Equity"}) = Equity

Use for: "trial balance", "account balances", "GL balances", "income statement", "P&L", "profit and loss", "balance sheet", "financial statements"`,
            parameters: {
                type: 'object',
                properties: {
                    account_type: {
                        type: 'string',
                        enum: ['Bank', 'AcctRec', 'OthCurrAsset', 'FixedAsset', 'AcctPay',
                               'OthCurrLiab', 'LongTermLiab', 'Equity', 'Income', 'COGS', 'Expense', 'OthIncome', 'OthExpense'],
                        description: 'Filter by account type. For income statement: use Income, COGS, Expense. For balance sheet: use asset/liability/equity types.'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Optional: filter by subsidiary ID'
                    }
                },
                required: []
            },
            execute: function(args) {
                const typeFilter = args.account_type ?
                    `AND account.accttype = '${escapeSql(args.account_type)}'` : '';
                const subFilter = args.subsidiary_id ?
                    `AND account.subsidiary = ${args.subsidiary_id}` : '';

                const query = `
                    SELECT
                        account.acctnumber AS account_number,
                        account.accountsearchdisplayname AS account_name,
                        account.accttype AS account_type,
                        account.balance AS balance
                    FROM account
                    WHERE account.isinactive = 'F'
                        ${typeFilter}
                        ${subFilter}
                    ORDER BY account.acctnumber
                    FETCH FIRST 200 ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_trial_balance');
            },
            displayName: function(args) {
                const type = args.account_type ? ` (${args.account_type})` : '';
                return `Getting trial balance${type}...`;
            }
        },

        // ═══════════════════════════════════════════════════════════════════
        // FINANCIAL STATEMENTS - Pre-computed Income Statement / Balance Sheet
        // ═══════════════════════════════════════════════════════════════════

        get_income_statement: {
            name: 'get_income_statement',
            shortDescription: 'Income statement / P&L report',
            category: 'data',
            description: `Get a complete Income Statement / P&L (Profit and Loss) for a period.
Returns Revenue, COGS, Gross Profit, Operating Expenses, and Net Income with proper calculations.
ALWAYS use this for: "income statement", "P&L", "profit and loss", "show me P&L", "how much profit", "net income"`,
            parameters: {
                type: 'object',
                properties: {
                    period: {
                        type: 'string',
                        enum: ['ytd', 'this_month', 'last_month', 'this_quarter', 'last_quarter'],
                        description: 'Period for the income statement (default: ytd)'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Optional: filter by department ID'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Optional: filter by class ID'
                    }
                },
                required: []
            },
            execute: function(args) {
                const period = args.period || 'ytd';
                const deptFilter = args.department_id ?
                    `AND tl.department = ${args.department_id}` : '';
                const classFilter = args.class_id ?
                    `AND tl.class = ${args.class_id}` : '';

                // Get fiscal year start dynamically
                let dateFilter = '';
                if (period === 'ytd') {
                    dateFilter = `AND ap.startdate >= (SELECT startdate FROM accountingperiod WHERE isyear = 'T' AND startdate <= SYSDATE ORDER BY startdate DESC FETCH FIRST 1 ROWS ONLY)`;
                } else if (period === 'this_month') {
                    dateFilter = `AND ap.startdate >= TRUNC(SYSDATE, 'MM')`;
                } else if (period === 'last_month') {
                    dateFilter = `AND ap.startdate >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -1) AND ap.enddate < TRUNC(SYSDATE, 'MM')`;
                } else if (period === 'this_quarter') {
                    dateFilter = `AND ap.startdate >= TRUNC(SYSDATE, 'Q')`;
                } else if (period === 'last_quarter') {
                    dateFilter = `AND ap.startdate >= ADD_MONTHS(TRUNC(SYSDATE, 'Q'), -3) AND ap.enddate < TRUNC(SYSDATE, 'Q')`;
                }

                const query = `
                    SELECT
                        CASE
                            WHEN acct.accttype IN ('Income', 'OthIncome') THEN 'Revenue'
                            WHEN acct.accttype = 'COGS' THEN 'Cost of Goods Sold'
                            WHEN acct.accttype IN ('Expense', 'OthExpense') THEN 'Operating Expenses'
                            ELSE 'Other'
                        END AS category,
                        acct.accttype AS account_type,
                        acct.acctnumber AS account_number,
                        acct.accountsearchdisplayname AS account_name,
                        SUM(CASE
                            WHEN acct.accttype IN ('Income', 'OthIncome') THEN -tal.amount
                            ELSE tal.amount
                        END) AS amount
                    FROM transactionaccountingline tal
                    INNER JOIN transaction t ON tal.transaction = t.id
                    INNER JOIN accountingperiod ap ON t.postingperiod = ap.id
                    INNER JOIN account acct ON tal.account = acct.id
                    LEFT JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
                    WHERE t.posting = 'T'
                        AND t.voided = 'F'
                        AND acct.accttype IN ('Income', 'OthIncome', 'COGS', 'Expense', 'OthExpense')
                        AND ap.isyear = 'F' AND ap.isquarter = 'F'
                        ${dateFilter}
                        ${deptFilter}
                        ${classFilter}
                    GROUP BY
                        CASE
                            WHEN acct.accttype IN ('Income', 'OthIncome') THEN 'Revenue'
                            WHEN acct.accttype = 'COGS' THEN 'Cost of Goods Sold'
                            WHEN acct.accttype IN ('Expense', 'OthExpense') THEN 'Operating Expenses'
                            ELSE 'Other'
                        END,
                        acct.accttype,
                        acct.acctnumber,
                        acct.accountsearchdisplayname
                    ORDER BY
                        CASE
                            WHEN acct.accttype IN ('Income', 'OthIncome') THEN 1
                            WHEN acct.accttype = 'COGS' THEN 2
                            WHEN acct.accttype IN ('Expense', 'OthExpense') THEN 3
                            ELSE 4
                        END,
                        acct.acctnumber
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_income_statement');

                // Calculate totals
                if (formatted.success && formatted.rows) {
                    let totalRevenue = 0;
                    let totalCOGS = 0;
                    let totalExpenses = 0;

                    formatted.rows.forEach(row => {
                        const amt = parseFloat(row.amount) || 0;
                        if (row.category === 'Revenue') totalRevenue += amt;
                        else if (row.category === 'Cost of Goods Sold') totalCOGS += amt;
                        else if (row.category === 'Operating Expenses') totalExpenses += amt;
                    });

                    formatted.summary = {
                        totalRevenue: totalRevenue,
                        totalCOGS: totalCOGS,
                        grossProfit: totalRevenue - totalCOGS,
                        grossMargin: totalRevenue > 0 ? ((totalRevenue - totalCOGS) / totalRevenue * 100).toFixed(1) + '%' : '0%',
                        totalExpenses: totalExpenses,
                        netIncome: totalRevenue - totalCOGS - totalExpenses,
                        netMargin: totalRevenue > 0 ? ((totalRevenue - totalCOGS - totalExpenses) / totalRevenue * 100).toFixed(1) + '%' : '0%'
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                const period = args.period || 'ytd';
                return `Building income statement (${period})...`;
            }
        },

        get_balance_sheet: {
            name: 'get_balance_sheet',
            shortDescription: 'Balance sheet at a point in time',
            category: 'data',
            description: `Get a complete Balance Sheet showing Assets, Liabilities, and Equity.
Returns all balance sheet accounts organized by category.
ALWAYS use this for: "balance sheet", "assets and liabilities", "financial position", "what do we own", "net worth"`,
            parameters: {
                type: 'object',
                properties: {
                    as_of_date: {
                        type: 'string',
                        description: 'Optional: date for balance sheet in YYYY-MM-DD format. Use current year! Examples: "2025-12-31", "2025-06-30". Default is today.'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Optional: filter by subsidiary ID'
                    }
                },
                required: []
            },
            execute: function(args) {
                const subFilter = args.subsidiary_id ?
                    `AND account.subsidiary = ${args.subsidiary_id}` : '';

                const query = `
                    SELECT
                        CASE
                            WHEN account.accttype IN ('Bank', 'AcctRec', 'OthCurrAsset') THEN 'Current Assets'
                            WHEN account.accttype = 'FixedAsset' THEN 'Fixed Assets'
                            WHEN account.accttype = 'OthAsset' THEN 'Other Assets'
                            WHEN account.accttype IN ('AcctPay', 'OthCurrLiab', 'CredCard') THEN 'Current Liabilities'
                            WHEN account.accttype = 'LongTermLiab' THEN 'Long-term Liabilities'
                            WHEN account.accttype IN ('Equity', 'RetainedEarnings') THEN 'Equity'
                            ELSE 'Other'
                        END AS category,
                        account.accttype AS account_type,
                        account.acctnumber AS account_number,
                        account.accountsearchdisplayname AS account_name,
                        account.balance AS balance
                    FROM account
                    WHERE account.isinactive = 'F'
                        AND account.accttype IN ('Bank', 'AcctRec', 'OthCurrAsset', 'FixedAsset', 'OthAsset',
                                                  'AcctPay', 'OthCurrLiab', 'CredCard', 'LongTermLiab', 'Equity', 'RetainedEarnings')
                        ${subFilter}
                    ORDER BY
                        CASE
                            WHEN account.accttype IN ('Bank', 'AcctRec', 'OthCurrAsset') THEN 1
                            WHEN account.accttype = 'FixedAsset' THEN 2
                            WHEN account.accttype = 'OthAsset' THEN 3
                            WHEN account.accttype IN ('AcctPay', 'OthCurrLiab', 'CredCard') THEN 4
                            WHEN account.accttype = 'LongTermLiab' THEN 5
                            WHEN account.accttype IN ('Equity', 'RetainedEarnings') THEN 6
                            ELSE 7
                        END,
                        account.acctnumber
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_balance_sheet');

                // Calculate totals
                if (formatted.success && formatted.rows) {
                    let totalCurrentAssets = 0;
                    let totalFixedAssets = 0;
                    let totalOtherAssets = 0;
                    let totalCurrentLiabilities = 0;
                    let totalLongTermLiabilities = 0;
                    let totalEquity = 0;

                    formatted.rows.forEach(row => {
                        const bal = parseFloat(row.balance) || 0;
                        if (row.category === 'Current Assets') totalCurrentAssets += bal;
                        else if (row.category === 'Fixed Assets') totalFixedAssets += bal;
                        else if (row.category === 'Other Assets') totalOtherAssets += bal;
                        else if (row.category === 'Current Liabilities') totalCurrentLiabilities += bal;
                        else if (row.category === 'Long-term Liabilities') totalLongTermLiabilities += bal;
                        else if (row.category === 'Equity') totalEquity += bal;
                    });

                    const totalAssets = totalCurrentAssets + totalFixedAssets + totalOtherAssets;
                    const totalLiabilities = totalCurrentLiabilities + totalLongTermLiabilities;

                    formatted.summary = {
                        totalCurrentAssets: totalCurrentAssets,
                        totalFixedAssets: totalFixedAssets,
                        totalOtherAssets: totalOtherAssets,
                        totalAssets: totalAssets,
                        totalCurrentLiabilities: totalCurrentLiabilities,
                        totalLongTermLiabilities: totalLongTermLiabilities,
                        totalLiabilities: totalLiabilities,
                        totalEquity: totalEquity,
                        liabilitiesAndEquity: totalLiabilities + totalEquity,
                        balanceCheck: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01 ? 'Balanced' : 'Out of Balance'
                    };
                }

                return formatted;
            },
            displayName: function() {
                return 'Building balance sheet...';
            }
        },

        // NOTE: get_ar_aging and get_ap_aging are defined earlier in this file
        // with comprehensive filtering options (batch IDs, filters, sorting).
        // Duplicate definitions were removed to prevent shadowing.

        get_top_customers: {
            name: 'get_top_customers',
            shortDescription: 'Top N customers by revenue or transaction volume',
            category: 'data',
            description: `Get top customers by revenue for current fiscal year.
ALWAYS use this for: "top customers", "best customers", "biggest customers", "customer revenue", "who are our best customers"

Supports filtering by minimum revenue, subsidiary, class, and can include AR aging data.`,
            parameters: {
                type: 'object',
                properties: {
                    limit: {
                        type: 'number',
                        description: 'Number of customers to return (default: 10)'
                    },
                    period: {
                        type: 'string',
                        enum: ['ytd', 'this_quarter', 'this_month', 'last_12_months'],
                        description: 'Time period (default: ytd)'
                    },
                    min_revenue: {
                        type: 'number',
                        description: 'Minimum revenue threshold (e.g., 100000 for $100K+)'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Filter by department ID'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Filter by class ID'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary ID'
                    },
                    sales_rep_id: {
                        type: 'number',
                        description: 'Filter by sales rep ID'
                    },
                    include_ar_aging: {
                        type: 'boolean',
                        description: 'Include AR aging summary for each customer'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['revenue', 'invoice_count', 'outstanding_ar', 'customer_name'],
                        description: 'Sort results by field (default: revenue)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const limit = args.limit || 10;
                const period = args.period || 'ytd';

                // Build filters - only use line-level filters when needed
                const needsLineJoin = args.department_id || args.class_id;
                const subsidiaryFilter = args.subsidiary_id ? `AND t.subsidiary = ${args.subsidiary_id}` : '';
                const salesRepFilter = args.sales_rep_id ? `AND t.salesrep = ${args.sales_rep_id}` : '';

                // Build HAVING clause for min_revenue
                const havingClause = args.min_revenue ? `HAVING SUM(t.foreigntotal) >= ${args.min_revenue}` : '';

                // Determine sort order
                let orderBy = 'total_revenue DESC';
                if (args.sort_by === 'invoice_count') orderBy = 'invoice_count DESC';
                else if (args.sort_by === 'outstanding_ar') orderBy = 'outstanding_ar DESC';
                else if (args.sort_by === 'customer_name') orderBy = 'customer_name ASC';

                let dateFilter = '';
                if (period === 'ytd') {
                    dateFilter = `AND ap.startdate >= (SELECT startdate FROM accountingperiod WHERE isyear = 'T' AND startdate <= SYSDATE ORDER BY startdate DESC FETCH FIRST 1 ROWS ONLY)`;
                } else if (period === 'this_quarter') {
                    dateFilter = `AND ap.startdate >= TRUNC(SYSDATE, 'Q')`;
                } else if (period === 'this_month') {
                    dateFilter = `AND ap.startdate >= TRUNC(SYSDATE, 'MM')`;
                } else if (period === 'last_12_months') {
                    dateFilter = `AND t.trandate >= ADD_MONTHS(SYSDATE, -12)`;
                }

                // Optional AR aging join
                let arAgingSelect = '';
                let arAgingJoin = '';
                let arAgingGroupBy = '';
                if (args.include_ar_aging) {
                    arAgingSelect = `, ar.current_bucket, ar.days_1_30, ar.days_31_60, ar.days_61_90, ar.days_over_90`;
                    arAgingJoin = `
                    LEFT JOIN (
                        SELECT
                            entity,
                            SUM(CASE WHEN CURRENT_DATE - duedate <= 0 THEN foreignamountunpaid ELSE 0 END) AS current_bucket,
                            SUM(CASE WHEN CURRENT_DATE - duedate BETWEEN 1 AND 30 THEN foreignamountunpaid ELSE 0 END) AS days_1_30,
                            SUM(CASE WHEN CURRENT_DATE - duedate BETWEEN 31 AND 60 THEN foreignamountunpaid ELSE 0 END) AS days_31_60,
                            SUM(CASE WHEN CURRENT_DATE - duedate BETWEEN 61 AND 90 THEN foreignamountunpaid ELSE 0 END) AS days_61_90,
                            SUM(CASE WHEN CURRENT_DATE - duedate > 90 THEN foreignamountunpaid ELSE 0 END) AS days_over_90
                        FROM transaction
                        WHERE type = 'CustInvc' AND foreignamountunpaid != 0 AND posting = 'T' AND voided = 'F'
                        GROUP BY entity
                    ) ar ON ar.entity = t.entity`;
                    arAgingGroupBy = ', ar.current_bucket, ar.days_1_30, ar.days_31_60, ar.days_61_90, ar.days_over_90';
                }

                let query;
                if (needsLineJoin) {
                    // Use subquery with line-level filtering to avoid double-counting
                    const deptFilter = args.department_id ? `AND tl.department = ${args.department_id}` : '';
                    const classFilter = args.class_id ? `AND tl.class = ${args.class_id}` : '';

                    query = `
                        SELECT
                            BUILTIN.DF(t.entity) AS customer_name,
                            t.entity AS customer_id,
                            COUNT(DISTINCT t.id) AS invoice_count,
                            SUM(t.foreigntotal) AS total_revenue,
                            SUM(t.foreignamountunpaid) AS outstanding_ar,
                            MIN(t.trandate) AS first_invoice,
                            MAX(t.trandate) AS last_invoice
                            ${arAgingSelect}
                        FROM transaction t
                        INNER JOIN accountingperiod ap ON t.postingperiod = ap.id
                        ${arAgingJoin}
                        WHERE t.type = 'CustInvc'
                            AND t.posting = 'T'
                            AND t.voided = 'F'
                            AND ap.isyear = 'F' AND ap.isquarter = 'F'
                            ${dateFilter}
                            ${subsidiaryFilter}
                            ${salesRepFilter}
                            AND t.id IN (
                                SELECT DISTINCT tl.transaction
                                FROM transactionline tl
                                WHERE tl.mainline = 'F'
                                ${deptFilter}
                                ${classFilter}
                            )
                        GROUP BY t.entity, BUILTIN.DF(t.entity)${arAgingGroupBy}
                        ${havingClause}
                        ORDER BY ${orderBy}
                        FETCH FIRST ${limit} ROWS ONLY
                    `;
                } else {
                    // Simple query without line join - no risk of double-counting
                    query = `
                        SELECT
                            BUILTIN.DF(t.entity) AS customer_name,
                            t.entity AS customer_id,
                            COUNT(DISTINCT t.id) AS invoice_count,
                            SUM(t.foreigntotal) AS total_revenue,
                            SUM(t.foreignamountunpaid) AS outstanding_ar,
                            MIN(t.trandate) AS first_invoice,
                            MAX(t.trandate) AS last_invoice
                            ${arAgingSelect}
                        FROM transaction t
                        INNER JOIN accountingperiod ap ON t.postingperiod = ap.id
                        ${arAgingJoin}
                        WHERE t.type = 'CustInvc'
                            AND t.posting = 'T'
                            AND t.voided = 'F'
                            AND ap.isyear = 'F' AND ap.isquarter = 'F'
                            ${dateFilter}
                            ${subsidiaryFilter}
                            ${salesRepFilter}
                        GROUP BY t.entity, BUILTIN.DF(t.entity)${arAgingGroupBy}
                        ${havingClause}
                        ORDER BY ${orderBy}
                        FETCH FIRST ${limit} ROWS ONLY
                    `;
                }

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_top_customers');
            },
            displayName: function(args) {
                return `Getting top ${args.limit || 10} customers...`;
            }
        },

        get_top_vendors: {
            name: 'get_top_vendors',
            shortDescription: 'Top N vendors by spend amount',
            category: 'data',
            description: `Get top vendors by spend for current fiscal year.
ALWAYS use this for: "top vendors", "biggest vendors", "vendor spend", "who do we pay most", "where do we spend"

Supports filtering by minimum spend, subsidiary, class, department, and can include AP aging data.`,
            parameters: {
                type: 'object',
                properties: {
                    limit: {
                        type: 'number',
                        description: 'Number of vendors to return (default: 10)'
                    },
                    period: {
                        type: 'string',
                        enum: ['ytd', 'this_quarter', 'this_month', 'last_12_months'],
                        description: 'Time period (default: ytd)'
                    },
                    min_spend: {
                        type: 'number',
                        description: 'Minimum spend threshold (e.g., 100000 for $100K+)'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Filter by department ID'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Filter by class ID'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary ID'
                    },
                    include_ap_aging: {
                        type: 'boolean',
                        description: 'Include AP aging summary for each vendor'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['spend', 'bill_count', 'outstanding_ap', 'vendor_name'],
                        description: 'Sort results by field (default: spend)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const limit = args.limit || 10;
                const period = args.period || 'ytd';

                // Build filters
                const deptFilter = args.department_id ? `AND tl.department = ${args.department_id}` : '';
                const classFilter = args.class_id ? `AND tl.class = ${args.class_id}` : '';
                const subsidiaryFilter = args.subsidiary_id ? `AND t.subsidiary = ${args.subsidiary_id}` : '';

                // Build HAVING clause for min_spend
                const havingClause = args.min_spend ? `HAVING SUM(ABS(t.foreigntotal) * (CASE WHEN t.type = 'VendCred' THEN -1 ELSE 1 END)) >= ${args.min_spend}` : '';

                // Determine sort order
                let orderBy = 'total_spend DESC';
                if (args.sort_by === 'bill_count') orderBy = 'bill_count DESC';
                else if (args.sort_by === 'outstanding_ap') orderBy = 'outstanding_ap DESC';
                else if (args.sort_by === 'vendor_name') orderBy = 'vendor_name ASC';

                let dateFilter = '';
                if (period === 'ytd') {
                    dateFilter = `AND ap.startdate >= (SELECT startdate FROM accountingperiod WHERE isyear = 'T' AND startdate <= SYSDATE ORDER BY startdate DESC FETCH FIRST 1 ROWS ONLY)`;
                } else if (period === 'this_quarter') {
                    dateFilter = `AND ap.startdate >= TRUNC(SYSDATE, 'Q')`;
                } else if (period === 'this_month') {
                    dateFilter = `AND ap.startdate >= TRUNC(SYSDATE, 'MM')`;
                } else if (period === 'last_12_months') {
                    dateFilter = `AND t.trandate >= ADD_MONTHS(SYSDATE, -12)`;
                }

                // Optional AP aging join
                let apAgingSelect = '';
                let apAgingJoin = '';
                let apAgingGroupBy = '';
                const hasLineFilters = args.department_id || args.class_id;
                const lineJoin = hasLineFilters ? 'LEFT JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = \'F\'' : '';

                if (args.include_ap_aging) {
                    apAgingSelect = `, ap_aging.current_bucket, ap_aging.days_1_30, ap_aging.days_31_60, ap_aging.days_61_90, ap_aging.days_over_90`;
                    apAgingJoin = `
                    LEFT JOIN (
                        SELECT
                            entity,
                            SUM(CASE WHEN CURRENT_DATE - duedate <= 0 THEN foreignamountunpaid ELSE 0 END) AS current_bucket,
                            SUM(CASE WHEN CURRENT_DATE - duedate BETWEEN 1 AND 30 THEN foreignamountunpaid ELSE 0 END) AS days_1_30,
                            SUM(CASE WHEN CURRENT_DATE - duedate BETWEEN 31 AND 60 THEN foreignamountunpaid ELSE 0 END) AS days_31_60,
                            SUM(CASE WHEN CURRENT_DATE - duedate BETWEEN 61 AND 90 THEN foreignamountunpaid ELSE 0 END) AS days_61_90,
                            SUM(CASE WHEN CURRENT_DATE - duedate > 90 THEN foreignamountunpaid ELSE 0 END) AS days_over_90
                        FROM transaction
                        WHERE type = 'VendBill' AND foreignamountunpaid != 0 AND posting = 'T' AND voided = 'F'
                        GROUP BY entity
                    ) ap_aging ON ap_aging.entity = t.entity`;
                    apAgingGroupBy = ', ap_aging.current_bucket, ap_aging.days_1_30, ap_aging.days_31_60, ap_aging.days_61_90, ap_aging.days_over_90';
                }

                const query = `
                    SELECT
                        BUILTIN.DF(t.entity) AS vendor_name,
                        t.entity AS vendor_id,
                        COUNT(DISTINCT t.id) AS bill_count,
                        SUM(ABS(t.foreigntotal) * (CASE WHEN t.type = 'VendCred' THEN -1 ELSE 1 END)) AS total_spend,
                        SUM(t.foreignamountunpaid) AS outstanding_ap,
                        MIN(t.trandate) AS first_bill,
                        MAX(t.trandate) AS last_bill
                        ${apAgingSelect}
                    FROM transaction t
                    INNER JOIN accountingperiod ap ON t.postingperiod = ap.id
                    ${lineJoin}
                    ${apAgingJoin}
                    WHERE t.type IN ('VendBill', 'VendCred')
                        AND t.posting = 'T'
                        AND t.voided = 'F'
                        AND ap.isyear = 'F' AND ap.isquarter = 'F'
                        ${dateFilter}
                        ${deptFilter}
                        ${classFilter}
                        ${subsidiaryFilter}
                    GROUP BY t.entity, BUILTIN.DF(t.entity)${apAgingGroupBy}
                    ${havingClause}
                    ORDER BY ${orderBy}
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_top_vendors');
            },
            displayName: function(args) {
                return `Getting top ${args.limit || 10} vendors...`;
            }
        },

        get_recent_transactions: {
            name: 'get_recent_transactions',
            shortDescription: 'Recent transactions with optional filters',
            category: 'data',
            description: `Get recent transactions, optionally filtered by type or entity.
Use for: "recent transactions", "latest invoices", "recent bills", "show transactions"

Supports filtering by amount range, status, memo text, and multiple dimensions.

IMPORTANT: You MUST use exact NetSuite type codes from the enum:
- VendBill = Vendor Bills (use for "bills from vendor")
- VendPymt = Vendor Payments
- VendCred = Vendor Credits
- CustInvc = Customer Invoices (use for "invoices to customer")
- CustPymt = Customer Payments
- CustCred = Customer Credits / Credit Memos
- CashSale = Cash Sales
- Journal = Journal Entries
- Check = Checks
- Deposit = Deposits
- ExpRept = Expense Reports
- PurchOrd = Purchase Orders
- SalesOrd = Sales Orders`,
            parameters: {
                type: 'object',
                properties: {
                    transaction_type: {
                        type: 'string',
                        enum: ['VendBill', 'VendPymt', 'VendCred', 'CustInvc', 'CustPymt', 'CustCred', 'CashSale', 'Journal', 'Check', 'Deposit', 'ExpRept', 'PurchOrd', 'SalesOrd'],
                        description: 'NetSuite transaction type code. Must be exact value from enum.'
                    },
                    entity_id: {
                        type: 'number',
                        description: 'Filter by customer/vendor ID'
                    },
                    entity_ids: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Array of entity IDs for batch lookup'
                    },
                    period: {
                        type: 'string',
                        enum: ['today', 'this_week', 'this_month', 'last_30_days', 'last_90_days', 'last_365_days', 'last_year', 'last_2_years', 'all'],
                        description: 'Time period filter (default: all)'
                    },
                    min_amount: {
                        type: 'number',
                        description: 'Minimum transaction amount'
                    },
                    max_amount: {
                        type: 'number',
                        description: 'Maximum transaction amount'
                    },
                    status: {
                        type: 'string',
                        enum: ['open', 'paid', 'partially_paid'],
                        description: 'Filter by payment status'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary ID'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Filter by class ID'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Filter by department ID'
                    },
                    memo_contains: {
                        type: 'string',
                        description: 'Filter by memo text (case-insensitive search)'
                    },
                    created_by: {
                        type: 'number',
                        description: 'Filter by employee who created the transaction'
                    },
                    limit: {
                        type: 'number',
                        description: 'Max transactions to return (default: 50)'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['date', 'amount', 'entity', 'type'],
                        description: 'Sort results by field (default: date desc)'
                    }
                },
                required: []
            },
            execute: function(args) {
                // Transaction type filter
                const transactionType = args.transaction_type;
                const typeFilter = transactionType ?
                    `AND transaction.type = '${escapeSql(transactionType)}'` : '';

                // Entity filter (single or batch)
                let entityFilter = '';
                if (args.entity_ids && args.entity_ids.length > 0) {
                    entityFilter = `AND transaction.entity IN (${args.entity_ids.join(',')})`;
                } else if (args.entity_id) {
                    entityFilter = `AND transaction.entity = ${args.entity_id}`;
                }

                // Additional filters
                const subsidiaryFilter = args.subsidiary_id ? `AND transaction.subsidiary = ${args.subsidiary_id}` : '';
                // FIXED: Use escapeSqlLike for LIKE clause to prevent SQL injection via wildcards
                const memoFilter = args.memo_contains ? `AND LOWER(transaction.memo) LIKE '%${escapeSqlLike(args.memo_contains.toLowerCase())}%' ESCAPE '\\'` : '';
                const createdByFilter = args.created_by ? `AND transaction.createdby = ${args.created_by}` : '';

                // Amount filters
                const minAmountFilter = args.min_amount ? `AND ABS(transaction.foreigntotal) >= ${args.min_amount}` : '';
                const maxAmountFilter = args.max_amount ? `AND ABS(transaction.foreigntotal) <= ${args.max_amount}` : '';

                // Status filter
                let statusFilter = '';
                if (args.status === 'open') {
                    statusFilter = 'AND transaction.foreignamountunpaid = transaction.foreigntotal';
                } else if (args.status === 'paid') {
                    statusFilter = 'AND transaction.foreignamountunpaid = 0';
                } else if (args.status === 'partially_paid') {
                    statusFilter = 'AND transaction.foreignamountunpaid > 0 AND transaction.foreignamountunpaid < transaction.foreigntotal';
                }

                // Class/department filters require line join
                const hasLineFilters = args.class_id || args.department_id;
                const lineJoin = hasLineFilters ? 'LEFT JOIN transactionline tl ON tl.transaction = transaction.id AND tl.mainline = \'F\'' : '';
                const classFilter = args.class_id ? `AND tl.class = ${args.class_id}` : '';
                const deptFilter = args.department_id ? `AND tl.department = ${args.department_id}` : '';

                const periodFilter = buildPeriodFilter(args.period || 'all');
                const limit = args.limit || 50;

                // Determine sort order
                let orderBy = 'transaction.trandate DESC, transaction.id DESC';
                if (args.sort_by === 'amount') orderBy = 'ABS(transaction.foreigntotal) DESC';
                else if (args.sort_by === 'entity') orderBy = 'BUILTIN.DF(transaction.entity), transaction.trandate DESC';
                else if (args.sort_by === 'type') orderBy = 'transaction.type, transaction.trandate DESC';

                const query = `
                    SELECT ${hasLineFilters ? 'DISTINCT' : ''}
                        transaction.id,
                        transaction.tranid AS document_number,
                        transaction.type AS transaction_type,
                        transaction.trandate,
                        BUILTIN.DF(transaction.entity) AS entity_name,
                        transaction.foreigntotal AS amount,
                        transaction.foreignamountunpaid AS amount_remaining,
                        transaction.status,
                        transaction.memo
                    FROM transaction
                    ${lineJoin}
                    WHERE transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        AND ${periodFilter}
                        ${typeFilter}
                        ${entityFilter}
                        ${subsidiaryFilter}
                        ${memoFilter}
                        ${createdByFilter}
                        ${minAmountFilter}
                        ${maxAmountFilter}
                        ${statusFilter}
                        ${classFilter}
                        ${deptFilter}
                    ORDER BY ${orderBy}
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_recent_transactions');

                // Add helpful suggestions if no results found
                if (formatted.success && formatted.rowCount === 0) {
                    formatted.suggestions = [];

                    if (args.entity_id) {
                        formatted.suggestions.push(
                            'Try get_vendor_spend or get_customer_revenue for entity-specific analysis',
                            'Try get_ap_aging or get_ar_aging to see outstanding balances',
                            'Try without the transaction_type filter to see all transactions for this entity',
                            'Try period: "all" to search all time periods'
                        );
                    }

                    if (args.transaction_type) {
                        formatted.note = `Searched for transaction type "${args.transaction_type}" - verify this is the correct NetSuite type code`;
                    }
                }

                return formatted;
            },
            displayName: function(args) {
                if (args.entity_ids && args.entity_ids.length > 0) {
                    return `Getting transactions for ${args.entity_ids.length} entities...`;
                }
                return 'Getting recent transactions...';
            }
        },

        get_transaction_detail: {
            name: 'get_transaction_detail',
            shortDescription: 'Details of a specific transaction by ID',
            category: 'data',
            description: `Get full details of a specific transaction including line items and GL impact.
Use when you need to drill into a specific transaction.`,
            parameters: {
                type: 'object',
                properties: {
                    transaction_id: {
                        type: 'number',
                        description: 'Internal ID of the transaction'
                    }
                },
                required: ['transaction_id']
            },
            execute: function(args) {
                // Get header
                const headerQuery = `
                    SELECT
                        transaction.id,
                        transaction.tranid AS document_number,
                        transaction.type AS transaction_type,
                        transaction.trandate,
                        BUILTIN.DF(transaction.entity) AS entity_name,
                        transaction.foreigntotal AS amount,
                        transaction.foreignamountunpaid AS amount_remaining,
                        transaction.status,
                        transaction.memo,
                        BUILTIN.DF(transaction.subsidiary) AS subsidiary
                    FROM transaction
                    WHERE transaction.id = ${args.transaction_id}
                `;

                // Get GL impact
                const glQuery = `
                    SELECT
                        account.acctnumber AS account_number,
                        account.accountsearchdisplayname AS account_name,
                        tal.debit,
                        tal.credit
                    FROM transactionaccountingline tal
                    INNER JOIN account ON tal.account = account.id
                    WHERE tal.transaction = ${args.transaction_id}
                    ORDER BY account.acctnumber
                `;

                const headerResult = QueryExecutor.executeQuery(headerQuery);
                const glResult = QueryExecutor.executeQuery(glQuery);

                return {
                    success: true,
                    header: headerResult.rows ? headerResult.rows[0] : null,
                    glLines: glResult.rows || [],
                    tool: 'get_transaction_detail'
                };
            },
            displayName: function(args) {
                return 'Getting transaction details...';
            }
        },

        compare_periods: {
            name: 'compare_periods',
            shortDescription: 'Compare two time periods (YoY, MoM, etc.)',
            category: 'data',
            description: `Compare a metric between two periods to find variance.
Use for: "variance analysis", "compare to last month", "YoY change", "period comparison"

CRITICAL: Always use CURRENT YEAR from date context. Never use old years like 2023/2024 unless user explicitly requests historical data.
Example period formats (assuming current date is Dec 2025):
- "compare to last month" → period1="2025-11", period2="2025-12"
- "YoY this month" → period1="2024-12", period2="2025-12"
- "Q3 vs Q2" → use get_revenue_by_month instead`,
            parameters: {
                type: 'object',
                properties: {
                    metric: {
                        type: 'string',
                        enum: ['revenue', 'expenses', 'net_income', 'ap_balance', 'ar_balance'],
                        description: 'Which metric to compare'
                    },
                    period1: {
                        type: 'string',
                        description: 'Earlier period in YYYY-MM format. Use current year! Format: "2025-01" for Jan 2025, "2025-11" for Nov 2025'
                    },
                    period2: {
                        type: 'string',
                        description: 'Later period in YYYY-MM format. Use current year! Format: "2025-12" for Dec 2025, "2025-06" for Jun 2025'
                    },
                    account_id: {
                        type: 'number',
                        description: 'Optional: specific account to analyze'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Optional: filter by class'
                    }
                },
                required: ['metric', 'period1', 'period2']
            },
            execute: function(args) {
                const metric = args.metric;
                const p1 = escapeSql(args.period1);
                const p2 = escapeSql(args.period2);

                let query;

                if (metric === 'revenue') {
                    query = `
                        SELECT
                            TO_CHAR(ap.startdate, 'YYYY-MM') AS period,
                            SUM(transaction.foreigntotal) AS amount
                        FROM transaction
                        INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                        WHERE transaction.type IN ('CustInvc', 'CashSale')
                            AND transaction.posting = 'T'
                            AND transaction.voided = 'F'
                            AND TO_CHAR(ap.startdate, 'YYYY-MM') IN ('${p1}', '${p2}')
                        GROUP BY TO_CHAR(ap.startdate, 'YYYY-MM')
                        ORDER BY period
                    `;
                } else if (metric === 'expenses') {
                    query = `
                        SELECT
                            TO_CHAR(ap.startdate, 'YYYY-MM') AS period,
                            SUM(ABS(transaction.foreigntotal)) AS amount
                        FROM transaction
                        INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                        WHERE transaction.type IN ('VendBill', 'ExpRept')
                            AND transaction.posting = 'T'
                            AND transaction.voided = 'F'
                            AND TO_CHAR(ap.startdate, 'YYYY-MM') IN ('${p1}', '${p2}')
                        GROUP BY TO_CHAR(ap.startdate, 'YYYY-MM')
                        ORDER BY period
                    `;
                } else {
                    // Default: GL account activity comparison
                    const acctFilter = args.account_id ? `AND tal.account = ${args.account_id}` : '';
                    const classFilter = args.class_id ?
                        `AND EXISTS (SELECT 1 FROM transactionline tl WHERE tl.transaction = transaction.id AND tl.class = ${args.class_id})` : '';

                    query = `
                        SELECT
                            TO_CHAR(ap.startdate, 'YYYY-MM') AS period,
                            SUM(COALESCE(tal.debit, 0)) AS total_debit,
                            SUM(COALESCE(tal.credit, 0)) AS total_credit,
                            SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS net_amount
                        FROM transactionaccountingline tal
                        INNER JOIN transaction ON tal.transaction = transaction.id
                        INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                        WHERE transaction.posting = 'T'
                            AND transaction.voided = 'F'
                            AND TO_CHAR(ap.startdate, 'YYYY-MM') IN ('${p1}', '${p2}')
                            ${acctFilter}
                            ${classFilter}
                        GROUP BY TO_CHAR(ap.startdate, 'YYYY-MM')
                        ORDER BY period
                    `;
                }

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'compare_periods');

                // Calculate variance
                if (formatted.success && formatted.rows && formatted.rows.length === 2) {
                    const row1 = formatted.rows[0];
                    const row2 = formatted.rows[1];
                    const val1 = row1.amount || row1.net_amount || 0;
                    const val2 = row2.amount || row2.net_amount || 0;

                    formatted.variance = {
                        period1: { period: row1.period, value: val1 },
                        period2: { period: row2.period, value: val2 },
                        absoluteChange: val2 - val1,
                        percentChange: val1 !== 0 ? ((val2 - val1) / Math.abs(val1) * 100).toFixed(2) + '%' : 'N/A'
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return `Comparing ${args.metric} between periods...`;
            }
        },

        get_revenue_by_month: {
            name: 'get_revenue_by_month',
            shortDescription: 'Monthly revenue trend with optional YoY comparison',
            category: 'data',
            description: `Get monthly revenue breakdown showing trend over time.
ALWAYS use this for: "revenue trend", "monthly revenue", "revenue by month", "revenue over time", "sales trend"

Returns revenue for each month with optional year-over-year comparison.`,
            parameters: {
                type: 'object',
                properties: {
                    months: {
                        type: 'number',
                        description: 'Number of months to show (default: 12, max: 24)'
                    },
                    include_yoy: {
                        type: 'boolean',
                        description: 'Include year-over-year comparison (default: false)'
                    },
                    customer_id: {
                        type: 'number',
                        description: 'Filter by specific customer'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Filter by class'
                    }
                },
                required: []
            },
            execute: function(args) {
                const months = Math.min(args.months || 12, 24);
                const customerFilter = args.customer_id ? `AND t.entity = ${args.customer_id}` : '';
                const subsidiaryFilter = args.subsidiary_id ? `AND t.subsidiary = ${args.subsidiary_id}` : '';
                const classFilter = args.class_id ? `AND t.id IN (SELECT transaction FROM transactionline WHERE class = ${args.class_id})` : '';

                let query;
                if (args.include_yoy) {
                    // Include year-over-year comparison
                    query = `
                        SELECT
                            TO_CHAR(t.trandate, 'YYYY-MM') AS month,
                            TO_CHAR(t.trandate, 'Mon YYYY') AS month_label,
                            SUM(t.foreigntotal) AS revenue,
                            COUNT(DISTINCT t.id) AS invoice_count,
                            LAG(SUM(t.foreigntotal), 12) OVER (ORDER BY TO_CHAR(t.trandate, 'YYYY-MM')) AS prior_year_revenue
                        FROM transaction t
                        WHERE t.type = 'CustInvc'
                            AND t.posting = 'T'
                            AND t.voided = 'F'
                            AND t.trandate >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -${months + 12})
                            ${customerFilter}
                            ${subsidiaryFilter}
                            ${classFilter}
                        GROUP BY TO_CHAR(t.trandate, 'YYYY-MM'), TO_CHAR(t.trandate, 'Mon YYYY')
                        ORDER BY month DESC
                        FETCH FIRST ${months} ROWS ONLY
                    `;
                } else {
                    // Simple monthly breakdown
                    query = `
                        SELECT
                            TO_CHAR(t.trandate, 'YYYY-MM') AS month,
                            TO_CHAR(t.trandate, 'Mon YYYY') AS month_label,
                            SUM(t.foreigntotal) AS revenue,
                            COUNT(DISTINCT t.id) AS invoice_count,
                            AVG(t.foreigntotal) AS avg_invoice_amount
                        FROM transaction t
                        WHERE t.type = 'CustInvc'
                            AND t.posting = 'T'
                            AND t.voided = 'F'
                            AND t.trandate >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -${months})
                            ${customerFilter}
                            ${subsidiaryFilter}
                            ${classFilter}
                        GROUP BY TO_CHAR(t.trandate, 'YYYY-MM'), TO_CHAR(t.trandate, 'Mon YYYY')
                        ORDER BY month DESC
                    `;
                }

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_revenue_by_month');
            },
            displayName: function(args) {
                const months = args.months || 12;
                return `Getting ${months}-month revenue trend...`;
            }
        },

        find_anomalies: {
            name: 'find_anomalies',
            shortDescription: 'Find unusual transactions or patterns',
            category: 'data',
            description: `Find unusual transactions or outliers in the data.
Identifies transactions that are significantly different from average.
Use for: "anomalies", "unusual transactions", "what caused the spike", "outliers"`,
            parameters: {
                type: 'object',
                properties: {
                    data_type: {
                        type: 'string',
                        enum: ['gl_activity', 'vendor_bills', 'customer_invoices', 'all_transactions'],
                        description: 'What data to analyze for anomalies'
                    },
                    account_id: {
                        type: 'number',
                        description: 'Optional: specific GL account'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Optional: filter by class'
                    },
                    threshold: {
                        type: 'number',
                        description: 'Standard deviations to flag as anomaly (default: 2.0)'
                    },
                    period: {
                        type: 'string',
                        enum: ['last_30_days', 'last_90_days', 'last_365_days', 'last_year', 'last_2_years', 'ytd', 'all'],
                        description: 'Period to analyze (default: last_year). Use for narrowing or expanding analysis window.'
                    }
                },
                required: ['data_type']
            },
            execute: function(args) {
                const periodFilter = buildPeriodFilter(args.period || 'last_year');
                const threshold = args.threshold || 2.0;

                // For GL activity anomalies
                if (args.data_type === 'gl_activity') {
                    const acctFilter = args.account_id ? `AND tal.account = ${args.account_id}` : '';
                    const classJoin = args.class_id ?
                        `INNER JOIN transactionline tl ON tl.transaction = transaction.id AND tl.class = ${args.class_id}` : '';

                    const query = `
                        WITH stats AS (
                            SELECT
                                AVG(ABS(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0))) AS avg_amount,
                                STDDEV(ABS(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0))) AS stddev_amount
                            FROM transactionaccountingline tal
                            INNER JOIN transaction ON tal.transaction = transaction.id
                            ${classJoin}
                            WHERE transaction.posting = 'T'
                                AND transaction.voided = 'F'
                                AND ${periodFilter}
                                ${acctFilter}
                        )
                        SELECT
                            transaction.id AS transaction_id,
                            transaction.tranid AS document_number,
                            transaction.type AS transaction_type,
                            transaction.trandate,
                            transaction.memo,
                            account.accountsearchdisplayname AS account_name,
                            (COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS net_amount,
                            stats.avg_amount,
                            CASE
                                WHEN stats.stddev_amount > 0
                                THEN (ABS(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) - stats.avg_amount) / stats.stddev_amount
                                ELSE 0
                            END AS z_score
                        FROM transactionaccountingline tal
                        INNER JOIN transaction ON tal.transaction = transaction.id
                        INNER JOIN account ON tal.account = account.id
                        ${classJoin}
                        CROSS JOIN stats
                        WHERE transaction.posting = 'T'
                            AND transaction.voided = 'F'
                            AND ${periodFilter}
                            ${acctFilter}
                            AND CASE
                                WHEN stats.stddev_amount > 0
                                THEN (ABS(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) - stats.avg_amount) / stats.stddev_amount
                                ELSE 0
                            END > ${threshold}
                        ORDER BY z_score DESC
                        FETCH FIRST 100 ROWS ONLY
                    `;

                    const result = QueryExecutor.executeQuery(query);
                    return formatResult(result, 'find_anomalies', { limit: 100 });
                }

                // For vendor bills anomalies
                if (args.data_type === 'vendor_bills') {
                    const query = `
                        WITH stats AS (
                            SELECT
                                AVG(ABS(transaction.foreigntotal)) AS avg_amount,
                                STDDEV(ABS(transaction.foreigntotal)) AS stddev_amount
                            FROM transaction
                            WHERE transaction.type = 'VendBill'
                                AND transaction.posting = 'T'
                                AND transaction.voided = 'F'
                                AND ${periodFilter}
                        )
                        SELECT
                            transaction.id AS transaction_id,
                            transaction.tranid AS document_number,
                            transaction.trandate,
                            BUILTIN.DF(transaction.entity) AS vendor_name,
                            ABS(transaction.foreigntotal) AS amount,
                            transaction.memo,
                            stats.avg_amount,
                            CASE
                                WHEN stats.stddev_amount > 0
                                THEN (ABS(transaction.foreigntotal) - stats.avg_amount) / stats.stddev_amount
                                ELSE 0
                            END AS z_score
                        FROM transaction
                        CROSS JOIN stats
                        WHERE transaction.type = 'VendBill'
                            AND transaction.posting = 'T'
                            AND transaction.voided = 'F'
                            AND ${periodFilter}
                            AND CASE
                                WHEN stats.stddev_amount > 0
                                THEN (ABS(transaction.foreigntotal) - stats.avg_amount) / stats.stddev_amount
                                ELSE 0
                            END > ${threshold}
                        ORDER BY z_score DESC
                        FETCH FIRST 100 ROWS ONLY
                    `;

                    const result = QueryExecutor.executeQuery(query);
                    return formatResult(result, 'find_anomalies', { limit: 100 });
                }

                // Default: all transactions
                const query = `
                    WITH stats AS (
                        SELECT
                            AVG(ABS(transaction.foreigntotal)) AS avg_amount,
                            STDDEV(ABS(transaction.foreigntotal)) AS stddev_amount
                        FROM transaction
                        WHERE transaction.posting = 'T'
                            AND transaction.voided = 'F'
                            AND ${periodFilter}
                    )
                    SELECT
                        transaction.id AS transaction_id,
                        transaction.tranid AS document_number,
                        transaction.type AS transaction_type,
                        transaction.trandate,
                        BUILTIN.DF(transaction.entity) AS entity_name,
                        ABS(transaction.foreigntotal) AS amount,
                        transaction.memo,
                        CASE
                            WHEN stats.stddev_amount > 0
                            THEN (ABS(transaction.foreigntotal) - stats.avg_amount) / stats.stddev_amount
                            ELSE 0
                        END AS z_score
                    FROM transaction
                    CROSS JOIN stats
                    WHERE transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        AND ${periodFilter}
                        AND CASE
                            WHEN stats.stddev_amount > 0
                            THEN (ABS(transaction.foreigntotal) - stats.avg_amount) / stats.stddev_amount
                            ELSE 0
                        END > ${threshold}
                    ORDER BY z_score DESC
                    FETCH FIRST 100 ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'find_anomalies', { limit: 100 });
            },
            displayName: function(args) {
                return 'Looking for anomalies...';
            }
        },

        get_cash_position: {
            name: 'get_cash_position',
            shortDescription: 'Current cash and bank account balances',
            category: 'data',
            description: `Get current cash position across all bank accounts.
Use for: "cash balance", "how much cash", "bank balances", "cash on hand"

Supports filtering by subsidiary and including credit card balances.`,
            parameters: {
                type: 'object',
                properties: {
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary ID'
                    },
                    include_credit_cards: {
                        type: 'boolean',
                        description: 'Include credit card account balances (default: false)'
                    },
                    min_balance: {
                        type: 'number',
                        description: 'Minimum account balance to include'
                    },
                    include_inactive: {
                        type: 'boolean',
                        description: 'Include inactive accounts (default: false)'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['balance', 'name', 'subsidiary'],
                        description: 'Sort results by field (default: balance desc)'
                    }
                },
                required: []
            },
            execute: function(args) {
                // Build account type filter
                let acctTypeFilter = `account.accttype = 'Bank'`;
                if (args.include_credit_cards) {
                    acctTypeFilter = `account.accttype IN ('Bank', 'CredCard')`;
                }

                // Build filters (NOTE: currency field removed from NetSuite - do not filter by currency)
                const subsidiaryFilter = args.subsidiary_id ? `AND account.subsidiary = ${args.subsidiary_id}` : '';
                const minBalanceFilter = args.min_balance ? `AND account.balance >= ${args.min_balance}` : '';
                const inactiveFilter = args.include_inactive ? '' : `AND account.isinactive = 'F'`;

                // Determine sort order
                let orderBy = 'account.balance DESC';
                if (args.sort_by === 'name') orderBy = 'account.accountsearchdisplayname ASC';
                else if (args.sort_by === 'subsidiary') orderBy = 'BUILTIN.DF(account.subsidiary), account.balance DESC';

                const query = `
                    SELECT
                        account.id AS account_id,
                        account.accountsearchdisplayname AS account_name,
                        account.accttype AS account_type,
                        BUILTIN.DF(account.subsidiary) AS subsidiary,
                        account.balance AS balance
                    FROM account
                    WHERE ${acctTypeFilter}
                        ${inactiveFilter}
                        ${subsidiaryFilter}
                        ${minBalanceFilter}
                    ORDER BY ${orderBy}
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_cash_position');

                // Calculate totals by type
                if (formatted.success && formatted.rows) {
                    let totalBank = 0;
                    let totalCreditCards = 0;

                    formatted.rows.forEach(row => {
                        if (row.account_type === 'Bank') {
                            totalBank += row.balance || 0;
                        } else if (row.account_type === 'CredCard') {
                            totalCreditCards += row.balance || 0;
                        }
                    });

                    formatted.summary = {
                        totalBankBalance: totalBank,
                        totalCreditCardBalance: totalCreditCards,
                        netCashPosition: totalBank + totalCreditCards,
                        accountCount: formatted.rows.length
                    };
                    // Keep backward compat
                    formatted.totalCash = totalBank + totalCreditCards;
                }

                return formatted;
            },
            displayName: function(args) {
                if (args.subsidiary_id) {
                    return 'Getting subsidiary cash position...';
                }
                return 'Getting cash position...';
            }
        },

        get_expense_breakdown: {
            name: 'get_expense_breakdown',
            shortDescription: 'Expenses by category or account',
            category: 'data',
            description: `Get expense breakdown by category/account.
Use for: "expense breakdown", "where is money going", "expenses by category"`,
            parameters: {
                type: 'object',
                properties: {
                    period: {
                        type: 'string',
                        enum: [
                            'this_month', 'last_month', 'this_quarter', 'last_quarter',
                            'ytd', 'fytd', 'ytd_closed', 'prior_year_ytd',
                            'this_fiscal_year', 'last_fiscal_year', '2_fiscal_years_ago', '3_fiscal_years_ago',
                            'fiscal_q1', 'fiscal_q2', 'fiscal_q3', 'fiscal_q4',
                            'last_fiscal_q1', 'last_fiscal_q2', 'last_fiscal_q3', 'last_fiscal_q4',
                            'last_90_days', 'last_365_days', 'last_2_fiscal_years', 'last_3_fiscal_years'
                        ],
                        description: 'Time period. Fiscal periods use actual fiscal year from accounting periods. ytd_closed uses last closed period for complete data. prior_year_ytd matches same point in last fiscal year for comparison. (default: ytd)'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Optional: filter by department'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Optional: filter by class'
                    }
                },
                required: []
            },
            execute: function(args) {
                const periodFilter = buildPeriodFilter(args.period || 'ytd');
                const deptFilter = args.department_id ?
                    `AND tl.department = ${args.department_id}` : '';
                const classFilter = args.class_id ?
                    `AND tl.class = ${args.class_id}` : '';

                const query = `
                    SELECT
                        account.acctnumber AS account_number,
                        account.accountsearchdisplayname AS account_name,
                        SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS amount
                    FROM transactionaccountingline tal
                    INNER JOIN transaction ON tal.transaction = transaction.id
                    INNER JOIN account ON tal.account = account.id
                    LEFT JOIN transactionline tl ON tl.transaction = transaction.id AND tl.mainline = 'F'
                    WHERE account.accttype = 'Expense'
                        AND transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        AND ${periodFilter}
                        ${deptFilter}
                        ${classFilter}
                    GROUP BY account.acctnumber, account.accountsearchdisplayname
                    HAVING SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) > 0
                    ORDER BY amount DESC
                    FETCH FIRST 200 ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_expense_breakdown', { limit: 200 });

                // Calculate total
                if (formatted.success && formatted.rows) {
                    formatted.totalExpenses = formatted.rows.reduce((sum, row) => sum + (row.amount || 0), 0);
                }

                return formatted;
            },
            displayName: function(args) {
                return 'Getting expense breakdown...';
            }
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // NEW FINANCIAL ANALYSIS TOOLS
        // ═══════════════════════════════════════════════════════════════════════════

        get_budget_variance: {
            name: 'get_budget_variance',
            shortDescription: 'Actual vs budget comparison',
            category: 'data',
            description: `Compare actual financial results vs budget by account and period.
Use for: "budget variance", "actual vs budget", "budget comparison", "are we over budget", "budget performance"

Shows variance amount, variance percentage, and whether over/under budget.
Can filter by account type, department, class, and specific accounts.`,
            parameters: {
                type: 'object',
                properties: {
                    period: {
                        type: 'string',
                        enum: [
                            'this_month', 'last_month', 'this_quarter', 'last_quarter',
                            'ytd', 'fytd', 'ytd_closed',
                            'this_fiscal_year', 'last_fiscal_year',
                            'fiscal_q1', 'fiscal_q2', 'fiscal_q3', 'fiscal_q4'
                        ],
                        description: 'Time period for comparison (default: ytd)'
                    },
                    account_type: {
                        type: 'string',
                        enum: ['Expense', 'Income', 'COGS', 'all'],
                        description: 'Filter by account type (default: all)'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Filter by department'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Filter by class'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary'
                    },
                    min_variance_pct: {
                        type: 'number',
                        description: 'Minimum absolute variance % to include (e.g., 10 for 10%+)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum accounts to return (default: 50)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const periodFilter = buildPeriodFilter(args.period || 'ytd');
                const limit = Math.min(args.limit || 50, 100);

                // Account type filter
                let acctTypeFilter = '';
                if (args.account_type && args.account_type !== 'all') {
                    if (args.account_type === 'Expense') {
                        acctTypeFilter = `AND acct.accttype IN ('Expense', 'OthExpense')`;
                    } else if (args.account_type === 'Income') {
                        acctTypeFilter = `AND acct.accttype IN ('Income', 'OthIncome')`;
                    } else if (args.account_type === 'COGS') {
                        acctTypeFilter = `AND acct.accttype = 'COGS'`;
                    }
                } else {
                    acctTypeFilter = `AND acct.accttype IN ('Expense', 'OthExpense', 'Income', 'OthIncome', 'COGS')`;
                }

                const deptFilter = args.department_id ? `AND tl.department = ${args.department_id}` : '';
                const classFilter = args.class_id ? `AND tl.class = ${args.class_id}` : '';
                const subsidiaryFilter = args.subsidiary_id ? `AND t.subsidiary = ${args.subsidiary_id}` : '';

                const varianceFilter = args.min_variance_pct ?
                    `HAVING ABS(CASE WHEN SUM(budget.amount) = 0 THEN 100 ELSE (SUM(actual_amt) - SUM(budget.amount)) / NULLIF(ABS(SUM(budget.amount)), 0) * 100 END) >= ${args.min_variance_pct}` : '';

                const query = `
                    WITH actuals AS (
                        SELECT
                            tal.account,
                            SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS actual_amt
                        FROM transactionaccountingline tal
                        INNER JOIN transaction t ON tal.transaction = t.id
                        LEFT JOIN transactionline tl ON tl.transaction = t.id AND tl.id = tal.transactionline
                        WHERE t.posting = 'T'
                            AND t.voided = 'F'
                            AND ${periodFilter}
                            ${subsidiaryFilter}
                            ${deptFilter}
                            ${classFilter}
                        GROUP BY tal.account
                    ),
                    budgets AS (
                        SELECT
                            b.account,
                            SUM(b.amount) AS amount
                        FROM budget b
                        INNER JOIN accountingperiod ap ON b.accountingperiod = ap.id
                        WHERE ap.isyear = 'F' AND ap.isquarter = 'F'
                            AND ${periodFilter.replace(/t\.trandate/g, 'ap.startdate')}
                        GROUP BY b.account
                    )
                    SELECT
                        acct.acctnumber AS account_number,
                        acct.accountsearchdisplayname AS account_name,
                        acct.accttype AS account_type,
                        COALESCE(actuals.actual_amt, 0) AS actual_amount,
                        COALESCE(budgets.amount, 0) AS budget_amount,
                        COALESCE(actuals.actual_amt, 0) - COALESCE(budgets.amount, 0) AS variance_amount,
                        CASE
                            WHEN COALESCE(budgets.amount, 0) = 0 THEN NULL
                            ELSE ROUND((COALESCE(actuals.actual_amt, 0) - COALESCE(budgets.amount, 0)) / NULLIF(ABS(budgets.amount), 0) * 100, 1)
                        END AS variance_pct,
                        CASE
                            WHEN acct.accttype IN ('Expense', 'OthExpense', 'COGS') THEN
                                CASE WHEN COALESCE(actuals.actual_amt, 0) > COALESCE(budgets.amount, 0) THEN 'OVER' ELSE 'UNDER' END
                            ELSE
                                CASE WHEN COALESCE(actuals.actual_amt, 0) < COALESCE(budgets.amount, 0) THEN 'UNDER' ELSE 'OVER' END
                        END AS variance_status
                    FROM account acct
                    LEFT JOIN actuals ON actuals.account = acct.id
                    LEFT JOIN budgets ON budgets.account = acct.id
                    WHERE (actuals.actual_amt IS NOT NULL OR budgets.amount IS NOT NULL)
                        ${acctTypeFilter}
                    ${varianceFilter}
                    ORDER BY ABS(COALESCE(actuals.actual_amt, 0) - COALESCE(budgets.amount, 0)) DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_budget_variance', { limit: limit });

                // Add summary statistics
                if (formatted.success && formatted.rows && formatted.rows.length > 0) {
                    let totalActual = 0, totalBudget = 0, overCount = 0, underCount = 0;
                    formatted.rows.forEach(row => {
                        totalActual += parseFloat(row.actual_amount) || 0;
                        totalBudget += parseFloat(row.budget_amount) || 0;
                        if (row.variance_status === 'OVER') overCount++;
                        if (row.variance_status === 'UNDER') underCount++;
                    });
                    formatted.summary = {
                        total_actual: totalActual,
                        total_budget: totalBudget,
                        total_variance: totalActual - totalBudget,
                        accounts_over_budget: overCount,
                        accounts_under_budget: underCount
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return `Getting budget variance (${args.period || 'ytd'})...`;
            }
        },

        get_project_profitability: {
            name: 'get_project_profitability',
            shortDescription: 'Project P&L and margin analysis',
            category: 'profitability',
            description: `Get project profitability analysis showing revenue, costs, and margin by project.
Use for: "project profitability", "project P&L", "project margin", "project performance", "which projects are profitable"

Uses ProjectFinancials data to show actuals by project with revenue/cost breakdown.
Can filter by subsidiary, specific project, or transaction type.`,
            parameters: {
                type: 'object',
                properties: {
                    project_id: {
                        type: 'number',
                        description: 'Filter by specific project ID'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary'
                    },
                    include_tasks: {
                        type: 'boolean',
                        description: 'Include task-level breakdown (default: false)'
                    },
                    min_amount: {
                        type: 'number',
                        description: 'Minimum absolute amount to include'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum projects to return (default: 50)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const limit = Math.min(args.limit || 50, 100);
                const projectFilter = args.project_id ? `AND pf.PROJECT = ${args.project_id}` : '';
                const subsidiaryFilter = args.subsidiary_id ? `AND pf.subsidiary = ${args.subsidiary_id}` : '';
                const amountFilter = args.min_amount ? `HAVING ABS(SUM(pf.amount)) >= ${args.min_amount}` : '';

                let query;
                if (args.include_tasks) {
                    // Task-level breakdown
                    query = `
                        SELECT
                            pf.PROJECT AS project_id,
                            BUILTIN.DF(pf.PROJECT) AS project_name,
                            pf.projecttask AS task_id,
                            BUILTIN.DF(pf.projecttask) AS task_name,
                            pf.ACCOUNT AS account_id,
                            BUILTIN.DF(pf.ACCOUNT) AS account_name,
                            SUM(CASE WHEN pf.amount < 0 THEN ABS(pf.amount) ELSE 0 END) AS revenue,
                            SUM(CASE WHEN pf.amount > 0 THEN pf.amount ELSE 0 END) AS cost,
                            SUM(-pf.amount) AS net_amount,
                            COUNT(DISTINCT pf.TRANSACTION) AS transaction_count,
                            MIN(pf.DATE) AS first_date,
                            MAX(pf.DATE) AS last_date
                        FROM ProjectFinancials pf
                        WHERE pf.actual = 'T'
                            ${projectFilter}
                            ${subsidiaryFilter}
                        GROUP BY pf.PROJECT, BUILTIN.DF(pf.PROJECT), pf.projecttask, BUILTIN.DF(pf.projecttask),
                                 pf.ACCOUNT, BUILTIN.DF(pf.ACCOUNT)
                        ${amountFilter}
                        ORDER BY pf.PROJECT, net_amount DESC
                        FETCH FIRST ${limit * 3} ROWS ONLY
                    `;
                } else {
                    // Project-level summary
                    query = `
                        SELECT
                            pf.PROJECT AS project_id,
                            BUILTIN.DF(pf.PROJECT) AS project_name,
                            SUM(CASE WHEN pf.amount < 0 THEN ABS(pf.amount) ELSE 0 END) AS revenue,
                            SUM(CASE WHEN pf.amount > 0 THEN pf.amount ELSE 0 END) AS cost,
                            SUM(-pf.amount) AS net_profit,
                            CASE
                                WHEN SUM(CASE WHEN pf.amount < 0 THEN ABS(pf.amount) ELSE 0 END) = 0 THEN NULL
                                ELSE ROUND(SUM(-pf.amount) / NULLIF(SUM(CASE WHEN pf.amount < 0 THEN ABS(pf.amount) ELSE 0 END), 0) * 100, 1)
                            END AS margin_pct,
                            COUNT(DISTINCT pf.TRANSACTION) AS transaction_count,
                            COUNT(DISTINCT pf.projecttask) AS task_count,
                            MIN(pf.DATE) AS first_date,
                            MAX(pf.DATE) AS last_date
                        FROM ProjectFinancials pf
                        WHERE pf.actual = 'T'
                            ${projectFilter}
                            ${subsidiaryFilter}
                        GROUP BY pf.PROJECT, BUILTIN.DF(pf.PROJECT)
                        ${amountFilter}
                        ORDER BY net_profit DESC
                        FETCH FIRST ${limit} ROWS ONLY
                    `;
                }

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_project_profitability', { limit: limit });

                // Add summary
                if (formatted.success && formatted.rows && formatted.rows.length > 0) {
                    let totalRevenue = 0, totalCost = 0, profitableCount = 0;
                    formatted.rows.forEach(row => {
                        totalRevenue += parseFloat(row.revenue) || 0;
                        totalCost += parseFloat(row.cost) || 0;
                        if ((parseFloat(row.net_profit) || parseFloat(row.net_amount) || 0) > 0) profitableCount++;
                    });
                    formatted.summary = {
                        total_revenue: totalRevenue,
                        total_cost: totalCost,
                        total_profit: totalRevenue - totalCost,
                        overall_margin_pct: totalRevenue > 0 ? Math.round((totalRevenue - totalCost) / totalRevenue * 1000) / 10 : null,
                        profitable_projects: profitableCount,
                        total_projects: formatted.rows.length
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return args.project_id ? `Getting project ${args.project_id} profitability...` : 'Getting project profitability...';
            }
        },

        get_department_profitability: {
            name: 'get_department_profitability',
            shortDescription: 'Department-level P&L breakdown',
            category: 'profitability',
            description: `Get P&L breakdown by department showing revenue, expenses, and margin.
Use for: "department profitability", "department P&L", "segment analysis", "departmental performance", "revenue by department"

Shows income, expenses, and net margin for each department.
Can filter by subsidiary and time period.`,
            parameters: {
                type: 'object',
                properties: {
                    period: {
                        type: 'string',
                        enum: [
                            'this_month', 'last_month', 'this_quarter', 'last_quarter',
                            'ytd', 'fytd', 'ytd_closed',
                            'this_fiscal_year', 'last_fiscal_year',
                            'last_90_days', 'last_365_days'
                        ],
                        description: 'Time period (default: ytd)'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary'
                    },
                    include_inactive: {
                        type: 'boolean',
                        description: 'Include inactive departments (default: false)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum departments to return (default: 50)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const periodFilter = buildPeriodFilter(args.period || 'ytd');
                const limit = Math.min(args.limit || 50, 100);
                const subsidiaryFilter = args.subsidiary_id ? `AND t.subsidiary = ${args.subsidiary_id}` : '';
                const inactiveFilter = args.include_inactive ? '' : `AND dept.isinactive = 'F'`;

                const query = `
                    SELECT
                        tl.department AS department_id,
                        BUILTIN.DF(tl.department) AS department_name,
                        SUM(CASE WHEN acct.accttype IN ('Income', 'OthIncome')
                            THEN COALESCE(tal.credit, 0) - COALESCE(tal.debit, 0) ELSE 0 END) AS revenue,
                        SUM(CASE WHEN acct.accttype IN ('Expense', 'OthExpense')
                            THEN COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0) ELSE 0 END) AS expenses,
                        SUM(CASE WHEN acct.accttype = 'COGS'
                            THEN COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0) ELSE 0 END) AS cogs,
                        SUM(CASE WHEN acct.accttype IN ('Income', 'OthIncome')
                            THEN COALESCE(tal.credit, 0) - COALESCE(tal.debit, 0) ELSE 0 END) -
                        SUM(CASE WHEN acct.accttype IN ('Expense', 'OthExpense', 'COGS')
                            THEN COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0) ELSE 0 END) AS net_income,
                        COUNT(DISTINCT tal.transaction) AS transaction_count
                    FROM transactionaccountingline tal
                    INNER JOIN transaction t ON tal.transaction = t.id
                    INNER JOIN account acct ON tal.account = acct.id
                    INNER JOIN transactionline tl ON tl.transaction = t.id AND tl.id = tal.transactionline
                    LEFT JOIN department dept ON tl.department = dept.id
                    WHERE t.posting = 'T'
                        AND t.voided = 'F'
                        AND tl.department IS NOT NULL
                        AND acct.accttype IN ('Income', 'OthIncome', 'Expense', 'OthExpense', 'COGS')
                        AND ${periodFilter}
                        ${subsidiaryFilter}
                        ${inactiveFilter}
                    GROUP BY tl.department, BUILTIN.DF(tl.department)
                    ORDER BY net_income DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_department_profitability', { limit: limit });

                // Add margin calculations and summary
                if (formatted.success && formatted.rows) {
                    let totalRevenue = 0, totalExpenses = 0, totalCogs = 0;
                    formatted.rows.forEach(row => {
                        const revenue = parseFloat(row.revenue) || 0;
                        row.margin_pct = revenue > 0 ? Math.round((parseFloat(row.net_income) || 0) / revenue * 1000) / 10 : null;
                        totalRevenue += revenue;
                        totalExpenses += parseFloat(row.expenses) || 0;
                        totalCogs += parseFloat(row.cogs) || 0;
                    });
                    formatted.summary = {
                        total_revenue: totalRevenue,
                        total_expenses: totalExpenses,
                        total_cogs: totalCogs,
                        total_net_income: totalRevenue - totalExpenses - totalCogs,
                        department_count: formatted.rows.length
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return `Getting department profitability (${args.period || 'ytd'})...`;
            }
        },

        get_employee_expenses: {
            name: 'get_employee_expenses',
            shortDescription: 'Expense report analysis by employee',
            category: 'data',
            description: `Get expense report analysis by employee.
Use for: "employee expenses", "expense reports", "who is spending", "T&E analysis", "travel expenses"

Shows expense totals, categories, and status by employee.
Can filter by period, expense category, and approval status.`,
            parameters: {
                type: 'object',
                properties: {
                    period: {
                        type: 'string',
                        enum: [
                            'this_month', 'last_month', 'this_quarter', 'last_quarter',
                            'ytd', 'fytd', 'this_fiscal_year', 'last_fiscal_year',
                            'last_30_days', 'last_90_days', 'last_365_days'
                        ],
                        description: 'Time period (default: ytd)'
                    },
                    employee_id: {
                        type: 'number',
                        description: 'Filter by specific employee'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Filter by department'
                    },
                    expense_category: {
                        type: 'string',
                        description: 'Filter by expense category name (partial match)'
                    },
                    status: {
                        type: 'string',
                        enum: ['all', 'approved', 'pending', 'rejected'],
                        description: 'Filter by approval status (default: all)'
                    },
                    min_amount: {
                        type: 'number',
                        description: 'Minimum expense amount'
                    },
                    group_by: {
                        type: 'string',
                        enum: ['employee', 'category', 'department'],
                        description: 'How to group results (default: employee)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum rows to return (default: 50)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const periodFilter = buildPeriodFilter(args.period || 'ytd');
                const limit = Math.min(args.limit || 50, 100);
                const groupBy = args.group_by || 'employee';

                const employeeFilter = args.employee_id ? `AND t.entity = ${args.employee_id}` : '';
                const deptFilter = args.department_id ? `AND tl.department = ${args.department_id}` : '';
                const categoryFilter = args.expense_category ?
                    `AND LOWER(acct.accountsearchdisplayname) LIKE LOWER('%${escapeSqlLike(args.expense_category)}%') ESCAPE '\\'` : '';
                const minAmountFilter = args.min_amount ? `HAVING SUM(tl.amount) >= ${args.min_amount}` : '';

                let statusFilter = '';
                if (args.status && args.status !== 'all') {
                    if (args.status === 'approved') {
                        statusFilter = `AND t.approvalstatus = 'Approved'`;
                    } else if (args.status === 'pending') {
                        statusFilter = `AND t.approvalstatus = 'Pending Approval'`;
                    } else if (args.status === 'rejected') {
                        statusFilter = `AND t.approvalstatus = 'Rejected'`;
                    }
                }

                let selectFields, groupByFields, orderBy;
                if (groupBy === 'category') {
                    selectFields = `
                        acct.acctnumber AS category_number,
                        acct.accountsearchdisplayname AS category_name,
                        COUNT(DISTINCT t.entity) AS employee_count`;
                    groupByFields = `acct.acctnumber, acct.accountsearchdisplayname`;
                    orderBy = 'total_amount DESC';
                } else if (groupBy === 'department') {
                    selectFields = `
                        tl.department AS department_id,
                        BUILTIN.DF(tl.department) AS department_name,
                        COUNT(DISTINCT t.entity) AS employee_count`;
                    groupByFields = `tl.department, BUILTIN.DF(tl.department)`;
                    orderBy = 'total_amount DESC';
                } else {
                    // Default: group by employee
                    selectFields = `
                        t.entity AS employee_id,
                        BUILTIN.DF(t.entity) AS employee_name,
                        tl.department AS department_id,
                        BUILTIN.DF(tl.department) AS department_name`;
                    groupByFields = `t.entity, BUILTIN.DF(t.entity), tl.department, BUILTIN.DF(tl.department)`;
                    orderBy = 'total_amount DESC';
                }

                const query = `
                    SELECT
                        ${selectFields},
                        SUM(tl.amount) AS total_amount,
                        COUNT(DISTINCT t.id) AS report_count,
                        COUNT(tl.id) AS line_count,
                        MIN(t.trandate) AS first_expense,
                        MAX(t.trandate) AS last_expense
                    FROM transaction t
                    INNER JOIN transactionline tl ON tl.transaction = t.id
                    LEFT JOIN account acct ON tl.expenseaccount = acct.id
                    WHERE t.type = 'ExpRept'
                        AND t.voided = 'F'
                        AND tl.mainline = 'F'
                        AND ${periodFilter}
                        ${employeeFilter}
                        ${deptFilter}
                        ${categoryFilter}
                        ${statusFilter}
                    GROUP BY ${groupByFields}
                    ${minAmountFilter}
                    ORDER BY ${orderBy}
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_employee_expenses', { limit: limit });

                // Add summary
                if (formatted.success && formatted.rows && formatted.rows.length > 0) {
                    let totalExpenses = 0, totalReports = 0;
                    formatted.rows.forEach(row => {
                        totalExpenses += parseFloat(row.total_amount) || 0;
                        totalReports += parseInt(row.report_count) || 0;
                    });
                    formatted.summary = {
                        total_expenses: totalExpenses,
                        total_reports: totalReports,
                        row_count: formatted.rows.length,
                        grouped_by: groupBy
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return `Getting employee expenses (${args.period || 'ytd'})...`;
            }
        },

        get_purchase_orders: {
            name: 'get_purchase_orders',
            shortDescription: 'PO status and procurement pipeline',
            category: 'data',
            description: `Get purchase order status and analysis.
Use for: "purchase orders", "PO status", "outstanding orders", "pending deliveries", "procurement pipeline"

Shows PO status, amounts, receipt status, and aging.
Can filter by vendor, status, department, and date.`,
            parameters: {
                type: 'object',
                properties: {
                    period: {
                        type: 'string',
                        enum: [
                            'this_month', 'last_month', 'this_quarter', 'last_quarter',
                            'ytd', 'fytd', 'this_fiscal_year', 'last_fiscal_year',
                            'last_30_days', 'last_90_days', 'last_365_days', 'all'
                        ],
                        description: 'Time period for PO creation date (default: ytd)'
                    },
                    vendor_id: {
                        type: 'number',
                        description: 'Filter by vendor'
                    },
                    status: {
                        type: 'string',
                        enum: ['all', 'open', 'pending_receipt', 'partially_received', 'fully_received', 'closed'],
                        description: 'Filter by PO status (default: open)'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Filter by department'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary'
                    },
                    min_amount: {
                        type: 'number',
                        description: 'Minimum PO amount'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum POs to return (default: 100)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const limit = Math.min(args.limit || 100, 200);
                const status = args.status || 'open';

                // Build period filter - different for 'all'
                let periodFilter;
                if (args.period === 'all') {
                    periodFilter = '1=1';
                } else {
                    periodFilter = buildPeriodFilter(args.period || 'ytd');
                }

                const vendorFilter = args.vendor_id ? `AND t.entity = ${args.vendor_id}` : '';
                const deptFilter = args.department_id ? `AND t.id IN (SELECT transaction FROM transactionline WHERE department = ${args.department_id})` : '';
                const subsidiaryFilter = args.subsidiary_id ? `AND t.subsidiary = ${args.subsidiary_id}` : '';
                const minAmountFilter = args.min_amount ? `AND ABS(t.foreigntotal) >= ${args.min_amount}` : '';

                let statusFilter = '';
                if (status !== 'all') {
                    if (status === 'open') {
                        statusFilter = `AND t.status IN ('PurchOrd:A', 'PurchOrd:B', 'PurchOrd:D', 'PurchOrd:E')`;
                    } else if (status === 'pending_receipt') {
                        statusFilter = `AND t.status = 'PurchOrd:B'`;
                    } else if (status === 'partially_received') {
                        statusFilter = `AND t.status = 'PurchOrd:D'`;
                    } else if (status === 'fully_received') {
                        statusFilter = `AND t.status = 'PurchOrd:E'`;
                    } else if (status === 'closed') {
                        statusFilter = `AND t.status = 'PurchOrd:H'`;
                    }
                }

                const query = `
                    SELECT
                        t.id AS po_id,
                        t.tranid AS po_number,
                        t.trandate AS po_date,
                        t.entity AS vendor_id,
                        BUILTIN.DF(t.entity) AS vendor_name,
                        t.subsidiary AS subsidiary_id,
                        BUILTIN.DF(t.subsidiary) AS subsidiary_name,
                        ABS(t.foreigntotal) AS total_amount,
                        t.status AS status_code,
                        BUILTIN.DF(t.status) AS status_name,
                        t.duedate AS expected_date,
                        TRUNC(SYSDATE) - TRUNC(t.trandate) AS days_since_created,
                        CASE WHEN t.duedate < SYSDATE THEN TRUNC(SYSDATE) - TRUNC(t.duedate) ELSE 0 END AS days_overdue,
                        t.memo
                    FROM transaction t
                    WHERE t.type = 'PurchOrd'
                        AND t.voided = 'F'
                        AND ${periodFilter}
                        ${vendorFilter}
                        ${statusFilter}
                        ${deptFilter}
                        ${subsidiaryFilter}
                        ${minAmountFilter}
                    ORDER BY t.trandate DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_purchase_orders', { limit: limit });

                // Add summary
                if (formatted.success && formatted.rows && formatted.rows.length > 0) {
                    let totalAmount = 0, overdueCount = 0, overdueAmount = 0;
                    formatted.rows.forEach(row => {
                        const amount = parseFloat(row.total_amount) || 0;
                        totalAmount += amount;
                        if ((parseInt(row.days_overdue) || 0) > 0) {
                            overdueCount++;
                            overdueAmount += amount;
                        }
                    });
                    formatted.summary = {
                        total_amount: totalAmount,
                        po_count: formatted.rows.length,
                        overdue_count: overdueCount,
                        overdue_amount: overdueAmount
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return `Getting purchase orders (${args.status || 'open'})...`;
            }
        },

        get_sales_orders: {
            name: 'get_sales_orders',
            shortDescription: 'SO backlog and fulfillment status',
            category: 'data',
            description: `Get sales order pipeline and backlog analysis.
Use for: "sales orders", "order backlog", "pending fulfillment", "sales pipeline", "order status"

Shows SO status, amounts, fulfillment status, and customer details.
Can filter by customer, status, and date.`,
            parameters: {
                type: 'object',
                properties: {
                    period: {
                        type: 'string',
                        enum: [
                            'this_month', 'last_month', 'this_quarter', 'last_quarter',
                            'ytd', 'fytd', 'this_fiscal_year', 'last_fiscal_year',
                            'last_30_days', 'last_90_days', 'last_365_days', 'all'
                        ],
                        description: 'Time period for SO creation date (default: ytd)'
                    },
                    customer_id: {
                        type: 'number',
                        description: 'Filter by customer'
                    },
                    status: {
                        type: 'string',
                        enum: ['all', 'open', 'pending_fulfillment', 'partially_fulfilled', 'pending_billing', 'fully_billed', 'closed'],
                        description: 'Filter by SO status (default: open)'
                    },
                    sales_rep_id: {
                        type: 'number',
                        description: 'Filter by sales rep'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Filter by class'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary'
                    },
                    min_amount: {
                        type: 'number',
                        description: 'Minimum SO amount'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum SOs to return (default: 100)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const limit = Math.min(args.limit || 100, 200);
                const status = args.status || 'open';

                // Build period filter
                let periodFilter;
                if (args.period === 'all') {
                    periodFilter = '1=1';
                } else {
                    periodFilter = buildPeriodFilter(args.period || 'ytd');
                }

                const customerFilter = args.customer_id ? `AND t.entity = ${args.customer_id}` : '';
                const salesRepFilter = args.sales_rep_id ? `AND t.salesrep = ${args.sales_rep_id}` : '';
                const classFilter = args.class_id ? `AND t.id IN (SELECT transaction FROM transactionline WHERE class = ${args.class_id})` : '';
                const subsidiaryFilter = args.subsidiary_id ? `AND t.subsidiary = ${args.subsidiary_id}` : '';
                const minAmountFilter = args.min_amount ? `AND t.foreigntotal >= ${args.min_amount}` : '';

                let statusFilter = '';
                if (status !== 'all') {
                    if (status === 'open') {
                        statusFilter = `AND t.status IN ('SalesOrd:A', 'SalesOrd:B', 'SalesOrd:D', 'SalesOrd:E', 'SalesOrd:F')`;
                    } else if (status === 'pending_fulfillment') {
                        statusFilter = `AND t.status = 'SalesOrd:B'`;
                    } else if (status === 'partially_fulfilled') {
                        statusFilter = `AND t.status = 'SalesOrd:D'`;
                    } else if (status === 'pending_billing') {
                        statusFilter = `AND t.status = 'SalesOrd:E'`;
                    } else if (status === 'fully_billed') {
                        statusFilter = `AND t.status = 'SalesOrd:F'`;
                    } else if (status === 'closed') {
                        statusFilter = `AND t.status = 'SalesOrd:H'`;
                    }
                }

                const query = `
                    SELECT
                        t.id AS so_id,
                        t.tranid AS so_number,
                        t.trandate AS order_date,
                        t.entity AS customer_id,
                        BUILTIN.DF(t.entity) AS customer_name,
                        t.subsidiary AS subsidiary_id,
                        BUILTIN.DF(t.subsidiary) AS subsidiary_name,
                        t.salesrep AS sales_rep_id,
                        BUILTIN.DF(t.salesrep) AS sales_rep_name,
                        t.foreigntotal AS total_amount,
                        t.status AS status_code,
                        BUILTIN.DF(t.status) AS status_name,
                        t.shipdate AS expected_ship_date,
                        TRUNC(SYSDATE) - TRUNC(t.trandate) AS days_since_created,
                        t.memo
                    FROM transaction t
                    WHERE t.type = 'SalesOrd'
                        AND t.voided = 'F'
                        AND ${periodFilter}
                        ${customerFilter}
                        ${statusFilter}
                        ${salesRepFilter}
                        ${classFilter}
                        ${subsidiaryFilter}
                        ${minAmountFilter}
                    ORDER BY t.trandate DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_sales_orders', { limit: limit });

                // Add summary
                if (formatted.success && formatted.rows && formatted.rows.length > 0) {
                    let totalAmount = 0;
                    const statusCounts = {};
                    formatted.rows.forEach(row => {
                        totalAmount += parseFloat(row.total_amount) || 0;
                        const s = row.status_name || 'Unknown';
                        statusCounts[s] = (statusCounts[s] || 0) + 1;
                    });
                    formatted.summary = {
                        total_backlog_amount: totalAmount,
                        order_count: formatted.rows.length,
                        status_breakdown: statusCounts
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return `Getting sales orders (${args.status || 'open'})...`;
            }
        },

        get_inventory_status: {
            name: 'get_inventory_status',
            shortDescription: 'Stock levels and reorder alerts',
            category: 'data',
            description: `Get inventory status including stock levels and reorder alerts.
Use for: "inventory status", "stock levels", "low stock", "reorder items", "inventory value"

Shows quantity on hand, available, on order, and reorder point status.
Can filter by location, item type, and low stock alerts.`,
            parameters: {
                type: 'object',
                properties: {
                    location_id: {
                        type: 'number',
                        description: 'Filter by inventory location'
                    },
                    item_type: {
                        type: 'string',
                        enum: ['all', 'InvtPart', 'Assembly', 'Kit'],
                        description: 'Filter by item type (default: all inventory items)'
                    },
                    low_stock_only: {
                        type: 'boolean',
                        description: 'Only show items at or below reorder point (default: false)'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary'
                    },
                    min_value: {
                        type: 'number',
                        description: 'Minimum inventory value to include'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum items to return (default: 100)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const limit = Math.min(args.limit || 100, 200);

                const locationFilter = args.location_id ? `AND ib.location = ${args.location_id}` : '';
                const subsidiaryFilter = args.subsidiary_id ?
                    `AND i.id IN (SELECT item FROM itemsubsidiary WHERE subsidiary = ${args.subsidiary_id})` : '';

                let itemTypeFilter = '';
                if (args.item_type && args.item_type !== 'all') {
                    itemTypeFilter = `AND i.itemtype = '${escapeSql(args.item_type)}'`;
                } else {
                    itemTypeFilter = `AND i.itemtype IN ('InvtPart', 'Assembly', 'Kit')`;
                }

                const lowStockFilter = args.low_stock_only ?
                    `AND ib.quantityavailable <= COALESCE(i.reorderpoint, 0)` : '';
                const minValueFilter = args.min_value ?
                    `HAVING SUM(ib.quantityonhand * COALESCE(i.averagecost, i.cost, 0)) >= ${args.min_value}` : '';

                const query = `
                    SELECT
                        i.id AS item_id,
                        i.itemid AS item_name,
                        i.displayname AS display_name,
                        i.itemtype AS item_type,
                        ib.location AS location_id,
                        BUILTIN.DF(ib.location) AS location_name,
                        SUM(ib.quantityonhand) AS qty_on_hand,
                        SUM(ib.quantityavailable) AS qty_available,
                        SUM(ib.quantityonorder) AS qty_on_order,
                        SUM(ib.quantitybackordered) AS qty_backordered,
                        i.reorderpoint AS reorder_point,
                        i.preferredstocklevel AS preferred_stock_level,
                        COALESCE(i.averagecost, i.cost, 0) AS unit_cost,
                        SUM(ib.quantityonhand * COALESCE(i.averagecost, i.cost, 0)) AS inventory_value,
                        CASE
                            WHEN SUM(ib.quantityavailable) <= 0 THEN 'OUT_OF_STOCK'
                            WHEN SUM(ib.quantityavailable) <= COALESCE(i.reorderpoint, 0) THEN 'LOW_STOCK'
                            ELSE 'IN_STOCK'
                        END AS stock_status
                    FROM item i
                    INNER JOIN inventorybalance ib ON ib.item = i.id
                    WHERE i.isinactive = 'F'
                        ${itemTypeFilter}
                        ${locationFilter}
                        ${subsidiaryFilter}
                        ${lowStockFilter}
                    GROUP BY i.id, i.itemid, i.displayname, i.itemtype, ib.location, BUILTIN.DF(ib.location),
                             i.reorderpoint, i.preferredstocklevel, COALESCE(i.averagecost, i.cost, 0)
                    ${minValueFilter}
                    ORDER BY inventory_value DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_inventory_status', { limit: limit });

                // Add summary
                if (formatted.success && formatted.rows && formatted.rows.length > 0) {
                    let totalValue = 0, lowStockCount = 0, outOfStockCount = 0;
                    formatted.rows.forEach(row => {
                        totalValue += parseFloat(row.inventory_value) || 0;
                        if (row.stock_status === 'LOW_STOCK') lowStockCount++;
                        if (row.stock_status === 'OUT_OF_STOCK') outOfStockCount++;
                    });
                    formatted.summary = {
                        total_inventory_value: totalValue,
                        item_count: formatted.rows.length,
                        low_stock_items: lowStockCount,
                        out_of_stock_items: outOfStockCount
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return args.low_stock_only ? 'Getting low stock items...' : 'Getting inventory status...';
            }
        },

        get_journal_entries: {
            name: 'get_journal_entries',
            shortDescription: 'Journal entry analysis',
            category: 'data',
            description: `Get journal entry analysis for adjustments, accruals, and manual entries.
Use for: "journal entries", "adjusting entries", "accruals", "manual entries", "JE analysis"

Shows journal entries with line details, amounts, and classifications.
Can filter by period, memo text, account, and amount.`,
            parameters: {
                type: 'object',
                properties: {
                    period: {
                        type: 'string',
                        enum: [
                            'this_month', 'last_month', 'this_quarter', 'last_quarter',
                            'ytd', 'fytd', 'this_fiscal_year', 'last_fiscal_year',
                            'last_30_days', 'last_90_days'
                        ],
                        description: 'Time period (default: this_month)'
                    },
                    account_id: {
                        type: 'number',
                        description: 'Filter by account'
                    },
                    memo_contains: {
                        type: 'string',
                        description: 'Filter by memo text (partial match)'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary'
                    },
                    min_amount: {
                        type: 'number',
                        description: 'Minimum line amount'
                    },
                    created_by: {
                        type: 'number',
                        description: 'Filter by user who created the entry'
                    },
                    include_lines: {
                        type: 'boolean',
                        description: 'Include line-level detail (default: false, shows header summary)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum entries to return (default: 100)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const periodFilter = buildPeriodFilter(args.period || 'this_month');
                const limit = Math.min(args.limit || 100, 200);

                const accountFilter = args.account_id ? `AND tal.account = ${args.account_id}` : '';
                const memoFilter = args.memo_contains ?
                    `AND (LOWER(t.memo) LIKE LOWER('%${escapeSqlLike(args.memo_contains)}%') ESCAPE '\\' OR LOWER(tl.memo) LIKE LOWER('%${escapeSqlLike(args.memo_contains)}%') ESCAPE '\\')` : '';
                const subsidiaryFilter = args.subsidiary_id ? `AND t.subsidiary = ${args.subsidiary_id}` : '';
                const minAmountFilter = args.min_amount ? `AND ABS(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) >= ${args.min_amount}` : '';
                const createdByFilter = args.created_by ? `AND t.createdby = ${args.created_by}` : '';

                let query;
                if (args.include_lines) {
                    // Line-level detail
                    query = `
                        SELECT
                            t.id AS je_id,
                            t.tranid AS je_number,
                            t.trandate AS je_date,
                            t.memo AS header_memo,
                            tal.account AS account_id,
                            BUILTIN.DF(tal.account) AS account_name,
                            tl.memo AS line_memo,
                            COALESCE(tal.debit, 0) AS debit,
                            COALESCE(tal.credit, 0) AS credit,
                            tl.department AS department_id,
                            BUILTIN.DF(tl.department) AS department_name,
                            tl.class AS class_id,
                            BUILTIN.DF(tl.class) AS class_name,
                            t.createdby AS created_by_id,
                            BUILTIN.DF(t.createdby) AS created_by_name
                        FROM transaction t
                        INNER JOIN transactionaccountingline tal ON tal.transaction = t.id
                        LEFT JOIN transactionline tl ON tl.transaction = t.id AND tl.id = tal.transactionline
                        WHERE t.type = 'Journal'
                            AND t.posting = 'T'
                            AND t.voided = 'F'
                            AND ${periodFilter}
                            ${accountFilter}
                            ${memoFilter}
                            ${subsidiaryFilter}
                            ${minAmountFilter}
                            ${createdByFilter}
                        ORDER BY t.trandate DESC, t.id, tal.id
                        FETCH FIRST ${limit * 5} ROWS ONLY
                    `;
                } else {
                    // Header summary
                    query = `
                        SELECT
                            t.id AS je_id,
                            t.tranid AS je_number,
                            t.trandate AS je_date,
                            t.memo,
                            t.subsidiary AS subsidiary_id,
                            BUILTIN.DF(t.subsidiary) AS subsidiary_name,
                            SUM(COALESCE(tal.debit, 0)) AS total_debit,
                            SUM(COALESCE(tal.credit, 0)) AS total_credit,
                            COUNT(DISTINCT tal.account) AS account_count,
                            t.createdby AS created_by_id,
                            BUILTIN.DF(t.createdby) AS created_by_name,
                            t.datecreated AS created_date
                        FROM transaction t
                        INNER JOIN transactionaccountingline tal ON tal.transaction = t.id
                        LEFT JOIN transactionline tl ON tl.transaction = t.id AND tl.id = tal.transactionline
                        WHERE t.type = 'Journal'
                            AND t.posting = 'T'
                            AND t.voided = 'F'
                            AND ${periodFilter}
                            ${accountFilter}
                            ${memoFilter}
                            ${subsidiaryFilter}
                            ${createdByFilter}
                        GROUP BY t.id, t.tranid, t.trandate, t.memo, t.subsidiary, BUILTIN.DF(t.subsidiary),
                                 t.createdby, BUILTIN.DF(t.createdby), t.datecreated
                        ${args.min_amount ? `HAVING SUM(COALESCE(tal.debit, 0)) >= ${args.min_amount}` : ''}
                        ORDER BY t.trandate DESC
                        FETCH FIRST ${limit} ROWS ONLY
                    `;
                }

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_journal_entries', { limit: limit });

                // Add summary
                if (formatted.success && formatted.rows && formatted.rows.length > 0) {
                    let totalDebits = 0, totalCredits = 0;
                    const uniqueJEs = new Set();
                    formatted.rows.forEach(row => {
                        totalDebits += parseFloat(row.total_debit || row.debit) || 0;
                        totalCredits += parseFloat(row.total_credit || row.credit) || 0;
                        uniqueJEs.add(row.je_id);
                    });
                    formatted.summary = {
                        total_debits: totalDebits,
                        total_credits: totalCredits,
                        je_count: uniqueJEs.size,
                        row_count: formatted.rows.length
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return `Getting journal entries (${args.period || 'this_month'})...`;
            }
        },

        get_period_close_status: {
            name: 'get_period_close_status',
            shortDescription: 'Accounting period open/closed status',
            category: 'data',
            description: `Get accounting period status showing which periods are open, closed, or locked.
Use for: "period status", "which periods are open", "period close status", "can I post to", "locked periods"

Shows all accounting periods with their current status for AR, AP, Payroll, and All.`,
            parameters: {
                type: 'object',
                properties: {
                    fiscal_year: {
                        type: 'number',
                        description: 'Filter by fiscal year (e.g., 2024)'
                    },
                    status_filter: {
                        type: 'string',
                        enum: ['all', 'open', 'closed', 'locked'],
                        description: 'Filter by status (default: all)'
                    },
                    include_quarters: {
                        type: 'boolean',
                        description: 'Include quarter-level periods (default: false, only months)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum periods to return (default: 24)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const limit = Math.min(args.limit || 24, 60);

                const yearFilter = args.fiscal_year ? `AND ap.fiscalyear = ${args.fiscal_year}` : '';
                const quarterFilter = args.include_quarters ? '' : `AND ap.isquarter = 'F'`;

                let statusFilter = '';
                if (args.status_filter && args.status_filter !== 'all') {
                    if (args.status_filter === 'open') {
                        statusFilter = `AND ap.closed = 'F' AND ap.alllocked = 'F'`;
                    } else if (args.status_filter === 'closed') {
                        statusFilter = `AND ap.closed = 'T'`;
                    } else if (args.status_filter === 'locked') {
                        statusFilter = `AND ap.alllocked = 'T'`;
                    }
                }

                const query = `
                    SELECT
                        ap.id AS period_id,
                        ap.periodname AS period_name,
                        ap.startdate,
                        ap.enddate,
                        ap.fiscalyear AS fiscal_year,
                        ap.isyear AS is_year,
                        ap.isquarter AS is_quarter,
                        ap.closed AS is_closed,
                        ap.alllocked AS all_locked,
                        ap.arlocked AS ar_locked,
                        ap.aplocked AS ap_locked,
                        CASE
                            WHEN ap.alllocked = 'T' THEN 'LOCKED'
                            WHEN ap.closed = 'T' THEN 'CLOSED'
                            ELSE 'OPEN'
                        END AS overall_status,
                        CASE WHEN SYSDATE BETWEEN ap.startdate AND ap.enddate THEN 'Y' ELSE 'N' END AS is_current
                    FROM accountingperiod ap
                    WHERE ap.isyear = 'F'
                        ${quarterFilter}
                        ${yearFilter}
                        ${statusFilter}
                    ORDER BY ap.startdate DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_period_close_status', { limit: limit });

                // Add summary
                if (formatted.success && formatted.rows && formatted.rows.length > 0) {
                    let openCount = 0, closedCount = 0, lockedCount = 0, currentPeriod = null;
                    formatted.rows.forEach(row => {
                        if (row.overall_status === 'OPEN') openCount++;
                        if (row.overall_status === 'CLOSED') closedCount++;
                        if (row.overall_status === 'LOCKED') lockedCount++;
                        if (row.is_current === 'Y') currentPeriod = row.period_name;
                    });
                    formatted.summary = {
                        current_period: currentPeriod,
                        open_periods: openCount,
                        closed_periods: closedCount,
                        locked_periods: lockedCount,
                        total_periods: formatted.rows.length
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return 'Getting period close status...';
            }
        },

        get_intercompany_balances: {
            name: 'get_intercompany_balances',
            shortDescription: 'IC receivables/payables between subsidiaries',
            category: 'data',
            description: `Get intercompany receivable/payable balances between subsidiaries.
Use for: "intercompany balances", "IC balances", "intercompany receivables", "intercompany payables", "eliminate intercompany"

Shows balances owed between subsidiaries for elimination and reconciliation.`,
            parameters: {
                type: 'object',
                properties: {
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by specific subsidiary (shows both receivables and payables)'
                    },
                    as_of_date: {
                        type: 'string',
                        description: 'Balance as of date (YYYY-MM-DD format, default: today)'
                    },
                    min_balance: {
                        type: 'number',
                        description: 'Minimum absolute balance to include'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum rows to return (default: 50)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const limit = Math.min(args.limit || 50, 100);
                const asOfDate = args.as_of_date || 'SYSDATE';
                const dateFilter = args.as_of_date ?
                    `AND t.trandate <= TO_DATE('${escapeSql(args.as_of_date)}', 'YYYY-MM-DD')` : '';

                const subsidiaryFilter = args.subsidiary_id ?
                    `AND (t.subsidiary = ${args.subsidiary_id} OR tl.subsidiary = ${args.subsidiary_id})` : '';
                const minBalanceFilter = args.min_balance ?
                    `HAVING ABS(SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0))) >= ${args.min_balance}` : '';

                // Query for intercompany account balances between subsidiaries
                const query = `
                    SELECT
                        t.subsidiary AS from_subsidiary_id,
                        BUILTIN.DF(t.subsidiary) AS from_subsidiary_name,
                        acct.deferralaccount AS to_subsidiary_id,
                        BUILTIN.DF(acct.deferralaccount) AS to_account_name,
                        acct.acctnumber AS account_number,
                        acct.accountsearchdisplayname AS account_name,
                        SUM(COALESCE(tal.debit, 0)) AS total_debit,
                        SUM(COALESCE(tal.credit, 0)) AS total_credit,
                        SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS balance,
                        COUNT(DISTINCT t.id) AS transaction_count,
                        MAX(t.trandate) AS last_activity
                    FROM transactionaccountingline tal
                    INNER JOIN transaction t ON tal.transaction = t.id
                    INNER JOIN account acct ON tal.account = acct.id
                    LEFT JOIN transactionline tl ON tl.transaction = t.id AND tl.id = tal.transactionline
                    WHERE t.posting = 'T'
                        AND t.voided = 'F'
                        AND acct.accttype IN ('OthCurrAsset', 'OthCurrLiab')
                        AND (LOWER(acct.accountsearchdisplayname) LIKE '%intercompany%'
                             OR LOWER(acct.accountsearchdisplayname) LIKE '%interco%'
                             OR LOWER(acct.accountsearchdisplayname) LIKE '%ic %'
                             OR LOWER(acct.accountsearchdisplayname) LIKE '% ic'
                             OR acct.eliminate = 'T')
                        ${dateFilter}
                        ${subsidiaryFilter}
                    GROUP BY t.subsidiary, BUILTIN.DF(t.subsidiary), acct.deferralaccount,
                             BUILTIN.DF(acct.deferralaccount), acct.acctnumber, acct.accountsearchdisplayname
                    ${minBalanceFilter}
                    ORDER BY ABS(SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0))) DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_intercompany_balances', { limit: limit });

                // Add summary
                if (formatted.success && formatted.rows && formatted.rows.length > 0) {
                    let totalReceivables = 0, totalPayables = 0;
                    formatted.rows.forEach(row => {
                        const balance = parseFloat(row.balance) || 0;
                        if (balance > 0) totalReceivables += balance;
                        else totalPayables += Math.abs(balance);
                    });
                    formatted.summary = {
                        total_ic_receivables: totalReceivables,
                        total_ic_payables: totalPayables,
                        net_ic_position: totalReceivables - totalPayables,
                        relationship_count: formatted.rows.length
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return 'Getting intercompany balances...';
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER 3: DASHBOARD TOOLS
    // Rich computed metrics from the 8 dashboards
    // ═══════════════════════════════════════════════════════════════════════════

    const DASHBOARD_TOOLS = {
        list_dashboards: {
            name: 'list_dashboards',
            shortDescription: 'List all available dashboards',
            category: 'dashboard',
            description: `List all available financial dashboards and their purposes.
Use this when:
- User asks "what dashboards are available?"
- User asks "what can you show me?"
- You need to recommend the right dashboard for a question`,
            parameters: {
                type: 'object',
                properties: {},
                required: []
            },
            execute: function(args) {
                const dashboards = [
                    {
                        id: 'dashboard_cashflow',
                        name: 'Treasury / Cash Flow Dashboard',
                        description: 'Cash position, projections, runway, AR/AP aging, burn rate analysis',
                        use_cases: ['cash flow', 'runway', 'liquidity', 'working capital', 'will we run out of cash'],
                        key_metrics: ['cash_position', 'cash_runway_days', 'burn_rate', 'ar_total', 'ap_total', 'projected_cash']
                    },
                    {
                        id: 'dashboard_health',
                        name: 'Profitability Pulse Dashboard',
                        description: 'Financial health score, margins, profitability metrics, key ratios',
                        use_cases: ['profitability', 'margins', 'financial health', 'how are we doing'],
                        key_metrics: ['health_score', 'gross_margin', 'net_margin', 'current_ratio', 'quick_ratio']
                    },
                    {
                        id: 'dashboard_burden',
                        name: 'Rate Engine / Burden Dashboard',
                        description: 'Overhead rates, burden calculations, cost allocation analysis',
                        use_cases: ['overhead', 'burden rate', 'indirect costs', 'cost allocation'],
                        key_metrics: ['burden_rate', 'overhead_ratio', 'indirect_costs', 'cost_per_hour']
                    },
                    {
                        id: 'dashboard_time',
                        name: 'Utilization Dashboard',
                        description: 'Time tracking, billable hours, utilization rates, resource efficiency',
                        use_cases: ['utilization', 'billable hours', 'time tracking', 'productivity'],
                        key_metrics: ['utilization_rate', 'billable_hours', 'non_billable_hours', 'effective_rate']
                    },
                    {
                        id: 'dashboard_integrity',
                        name: 'Sentinel / Data Integrity Dashboard',
                        description: 'Fraud detection, anomaly identification, data quality checks',
                        use_cases: ['fraud', 'anomalies', 'data integrity', 'suspicious activity'],
                        key_metrics: ['anomaly_count', 'risk_score', 'flagged_transactions', 'data_quality_score']
                    },
                    {
                        id: 'dashboard_vendorperformance',
                        name: 'Procurement / Vendor Performance Dashboard',
                        description: 'Vendor analysis, payment terms, spend concentration, vendor risk',
                        use_cases: ['vendor analysis', 'procurement', 'supplier performance', 'vendor spend'],
                        key_metrics: ['top_vendors', 'avg_payment_days', 'spend_concentration', 'vendor_count']
                    },
                    {
                        id: 'dashboard_customervalue',
                        name: 'Revenue Intelligence / Customer Value Dashboard',
                        description: 'Customer lifetime value, RFM analysis, revenue concentration, churn risk',
                        use_cases: ['customer value', 'CLV', 'revenue analysis', 'customer concentration', 'churn'],
                        key_metrics: ['top_customers', 'customer_clv', 'revenue_concentration', 'avg_order_value']
                    },
                    {
                        id: 'dashboard_spendvelocity',
                        name: 'Cost Dynamics / Spend Velocity Dashboard',
                        description: 'Expense trends, cost analysis, spending velocity, budget variance',
                        use_cases: ['expenses', 'cost trends', 'spending analysis', 'budget variance'],
                        key_metrics: ['total_spend', 'spend_trend', 'top_expense_categories', 'yoy_change']
                    }
                ];

                return {
                    success: true,
                    dashboards: dashboards,
                    count: dashboards.length,
                    usage: 'Call the dashboard tool directly, e.g., dashboard_cashflow() for cash flow analysis',
                    tool: 'list_dashboards'
                };
            },
            displayName: function(args) {
                return 'Listing available dashboards...';
            }
        },

        dashboard_cashflow: {
            name: 'dashboard_cashflow',
            shortDescription: 'Cash projections, runway, burn rate, forecasts',
            category: 'dashboard',
            description: `Get comprehensive TREASURY/CASHFLOW dashboard data including:
- Current cash position across all bank accounts
- Cash projections for 30/60/90 days
- Cash runway (days until zero at current burn rate)
- AR aging (money coming in from customers)
- AP aging (money we owe to vendors)
- Burn rate analysis

Use for: "cash flow", "runway", "cash projection", "liquidity", "treasury", "working capital", "will we run out of cash"`,
            parameters: {
                type: 'object',
                properties: {
                    subsidiary_id: {
                        type: 'number',
                        description: 'Optional: filter by subsidiary'
                    }
                },
                required: []
            },
            execute: function(args) {
                try {
                    // Get raw data from dashboard module
                    const rawData = CashflowData.getData(args);

                    // Process through intelligence layer - extracts key metrics, generates insights
                    const intelligence = Cache.processDashboard('cashflow', rawData, args.requestId);

                    // Calculate rowCount from metrics for proper data detection
                    const metricsCount = Object.keys(intelligence?.metrics || {}).length;

                    // Debug: Log if metrics extraction seems to have failed
                    if (metricsCount === 0 && rawData?.company?.cash) {
                        log.debug('dashboard_cashflow: metrics empty but rawData exists', {
                            hasRawData: !!rawData,
                            hasCash: !!rawData?.company?.cash,
                            startingCash: rawData?.company?.cash?.startingCash,
                            intelligenceKeys: Object.keys(intelligence || {})
                        });
                    }

                    return {
                        success: true,
                        dashboard: 'cashflow',
                        intelligence: intelligence,
                        // CRITICAL: Include rowCount so system knows we have data
                        // Use at least 1 if we have ANY data to prevent false "no data" detection
                        rowCount: metricsCount > 0 ? metricsCount : (rawData ? 1 : 0),
                        tool: 'dashboard_cashflow'
                    };
                } catch (e) {
                    log.error('dashboard_cashflow failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
                        rowCount: 0,
                        tool: 'dashboard_cashflow'
                    };
                }
            },
            displayName: function(args) {
                return 'Running Treasury analysis...';
            }
        },

        dashboard_health: {
            name: 'dashboard_health',
            shortDescription: 'Financial health score, margins, ratios',
            category: 'dashboard',
            description: `Get comprehensive PROFITABILITY PULSE dashboard data including:
- Overall health score (0-100)
- Gross margin, net margin, operating margin
- Revenue YTD, MTD, and trends
- Expense breakdown
- Profitability by department
- Revenue vs expense comparison
- Income statement summary data

PREFERRED for: "income statement", "P&L", "profit and loss", "financial health", "profitability", "margins", "how are we doing", "health score", "revenue and expenses"`,
            parameters: {
                type: 'object',
                properties: {
                    subsidiary_id: {
                        type: 'number',
                        description: 'Optional: filter by subsidiary'
                    },
                    period: {
                        type: 'string',
                        enum: ['ytd', 'this_quarter', 'this_month'],
                        description: 'Period for analysis (default: ytd)'
                    }
                },
                required: []
            },
            execute: function(args) {
                try {
                    // Get raw data from dashboard module
                    const rawData = HealthData.getData(args);

                    // Process through intelligence layer - extracts key metrics, generates insights
                    const intelligence = Cache.processDashboard('health', rawData, args.requestId);
                    const metricsCount = Object.keys(intelligence.metrics || {}).length;

                    return {
                        success: true,
                        dashboard: 'health',
                        intelligence: intelligence,
                        rowCount: metricsCount > 0 ? metricsCount : 1,
                        tool: 'dashboard_health'
                    };
                } catch (e) {
                    log.error('dashboard_health failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
                        rowCount: 0,
                        tool: 'dashboard_health'
                    };
                }
            },
            displayName: function(args) {
                return 'Analyzing financial health...';
            }
        },

        dashboard_burden: {
            name: 'dashboard_burden',
            shortDescription: 'Rate Engine: overhead, burden rates',
            category: 'dashboard',
            description: `Get comprehensive RATE ENGINE/BURDEN RATE dashboard data including:
- Current burden rate (overhead / direct labor)
- Target burden rate
- Total overhead costs
- Total direct labor costs
- Overhead recovery percentage
- Breakdown by overhead category

Use for: "burden rate", "overhead", "labor burden", "cost recovery", "fringe rate", "wrap rate", "fully burdened cost"`,
            parameters: {
                type: 'object',
                properties: {
                    department_id: {
                        type: 'number',
                        description: 'Optional: filter by department'
                    },
                    period: {
                        type: 'string',
                        enum: ['ytd', 'this_quarter', 'this_month', 'last_quarter'],
                        description: 'Period for analysis (default: ytd)'
                    }
                },
                required: []
            },
            execute: function(args) {
                try {
                    // Get raw data from dashboard module
                    const rawData = BurdenData.getData(args);

                    // Process through intelligence layer - extracts key metrics, generates insights
                    const intelligence = Cache.processDashboard('burden', rawData, args.requestId);
                    const metricsCount = Object.keys(intelligence.metrics || {}).length;

                    return {
                        success: true,
                        dashboard: 'burden',
                        intelligence: intelligence,
                        rowCount: metricsCount > 0 ? metricsCount : 1,
                        tool: 'dashboard_burden'
                    };
                } catch (e) {
                    log.error('dashboard_burden failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
                        rowCount: 0,
                        tool: 'dashboard_burden'
                    };
                }
            },
            displayName: function(args) {
                return 'Calculating burden rates...';
            }
        },

        dashboard_time: {
            name: 'dashboard_time',
            shortDescription: 'Utilization: billable hours, productivity',
            category: 'dashboard',
            description: `Get comprehensive UTILIZATION dashboard data including:
- Total billable vs non-billable hours
- Utilization rate
- Unbilled time value
- Average billing rate
- Effective rate
- Hours by employee
- Hours by customer

Use for: "utilization", "billable hours", "time tracking", "unbilled time", "employee hours", "how busy are we"`,
            parameters: {
                type: 'object',
                properties: {
                    employee_id: {
                        type: 'number',
                        description: 'Optional: filter by employee'
                    },
                    project_id: {
                        type: 'number',
                        description: 'Optional: filter by project'
                    },
                    period: {
                        type: 'string',
                        enum: ['this_week', 'this_month', 'last_month', 'this_quarter', 'ytd'],
                        description: 'Period for analysis (default: this_month)'
                    }
                },
                required: []
            },
            execute: function(args) {
                try {
                    // Get raw data from dashboard module
                    const rawData = TimeData.getData(args);

                    // Process through intelligence layer - extracts key metrics, generates insights
                    const intelligence = Cache.processDashboard('time', rawData, args.requestId);
                    const metricsCount = Object.keys(intelligence.metrics || {}).length;

                    return {
                        success: true,
                        dashboard: 'time',
                        intelligence: intelligence,
                        rowCount: metricsCount > 0 ? metricsCount : 1,
                        tool: 'dashboard_time'
                    };
                } catch (e) {
                    log.error('dashboard_time failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
                        rowCount: 0,
                        tool: 'dashboard_time'
                    };
                }
            },
            displayName: function(args) {
                return 'Analyzing time utilization...';
            }
        },

        dashboard_integrity: {
            name: 'dashboard_integrity',
            shortDescription: 'Sentinel: fraud detection, anomalies',
            category: 'dashboard',
            description: `Get comprehensive SENTINEL/INTEGRITY dashboard data including:
- Overall risk score
- Flagged transaction count
- Duplicate detection results
- Weekend entry analysis
- Benford's Law deviation analysis
- List of flagged transactions with risk levels

Use for: "fraud detection", "anomalies", "duplicates", "Benford's law", "suspicious transactions", "audit", "integrity check"`,
            parameters: {
                type: 'object',
                properties: {
                    period: {
                        type: 'string',
                        enum: ['last_30_days', 'last_90_days', 'ytd'],
                        description: 'Period for analysis (default: last_90_days)'
                    }
                },
                required: []
            },
            execute: function(args) {
                try {
                    // Get raw data from dashboard module
                    const rawData = IntegrityData.getData(args);

                    // Process through intelligence layer - extracts key metrics, generates insights
                    const intelligence = Cache.processDashboard('integrity', rawData, args.requestId);
                    const metricsCount = Object.keys(intelligence.metrics || {}).length;

                    return {
                        success: true,
                        dashboard: 'integrity',
                        intelligence: intelligence,
                        rowCount: metricsCount > 0 ? metricsCount : 1,
                        tool: 'dashboard_integrity'
                    };
                } catch (e) {
                    log.error('dashboard_integrity failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
                        rowCount: 0,
                        tool: 'dashboard_integrity'
                    };
                }
            },
            displayName: function(args) {
                return 'Running integrity analysis...';
            }
        },

        dashboard_vendorperformance: {
            name: 'dashboard_vendorperformance',
            shortDescription: 'Procurement: vendor analysis, payment trends',
            category: 'dashboard',
            description: `Get comprehensive PROCUREMENT/VENDOR PERFORMANCE dashboard data including:
- Vendor leverage matrix (strategic/commodity/niche/transactional)
- Payment term compliance (early/on-time/late rates)
- Cash flow leakage from early payments
- Contract renewal radar
- Auto-renew risks
- Vendor concentration analysis (HHI index)
- Full vendor scorecard

Use for: "vendor performance", "procurement", "vendor leverage", "payment terms", "contract renewals", "vendor concentration", "strategic vendors"`,
            parameters: {
                type: 'object',
                properties: {
                    vendor_id: {
                        type: 'number',
                        description: 'Optional: filter to specific vendor'
                    },
                    period: {
                        type: 'string',
                        enum: ['last_90_days', 'ytd', 'last_365_days'],
                        description: 'Period for analysis (default: ytd)'
                    }
                },
                required: []
            },
            execute: function(args) {
                try {
                    // Get raw data from dashboard module
                    const rawData = VendorPerformanceData.getData(args);

                    // Process through intelligence layer - extracts key metrics, generates insights
                    const intelligence = Cache.processDashboard('vendorperformance', rawData, args.requestId);
                    const metricsCount = Object.keys(intelligence.metrics || {}).length;

                    return {
                        success: true,
                        dashboard: 'vendorperformance',
                        intelligence: intelligence,
                        rowCount: metricsCount > 0 ? metricsCount : 1,
                        tool: 'dashboard_vendorperformance'
                    };
                } catch (e) {
                    log.error('dashboard_vendorperformance failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
                        rowCount: 0,
                        tool: 'dashboard_vendorperformance'
                    };
                }
            },
            displayName: function(args) {
                return 'Analyzing vendor performance...';
            }
        },

        dashboard_customervalue: {
            name: 'dashboard_customervalue',
            shortDescription: 'Revenue Intelligence: customer CLV, RFM',
            category: 'dashboard',
            description: `Get comprehensive REVENUE INTELLIGENCE/CUSTOMER VALUE dashboard data including:
- Customer lifetime value (CLV) projections
- RFM segmentation (Recency, Frequency, Monetary)
- Churn risk analysis
- Revenue concentration
- Customer health scores
- Champions vs at-risk customers
- Retention rates

Use for: "customer value", "CLV", "lifetime value", "RFM", "churn risk", "customer health", "revenue concentration", "customer segmentation"`,
            parameters: {
                type: 'object',
                properties: {
                    customer_id: {
                        type: 'number',
                        description: 'Optional: filter to specific customer'
                    },
                    period: {
                        type: 'string',
                        enum: ['last_365_days', 'ytd', 'all_time'],
                        description: 'Period for analysis (default: last_365_days)'
                    }
                },
                required: []
            },
            execute: function(args) {
                try {
                    // Get raw data from dashboard module
                    const rawData = CustomerValueData.getData(args);

                    // Process through intelligence layer - extracts key metrics, generates insights
                    const intelligence = Cache.processDashboard('customervalue', rawData, args.requestId);
                    const metricsCount = Object.keys(intelligence.metrics || {}).length;

                    return {
                        success: true,
                        dashboard: 'customervalue',
                        intelligence: intelligence,
                        rowCount: metricsCount > 0 ? metricsCount : 1,
                        tool: 'dashboard_customervalue'
                    };
                } catch (e) {
                    log.error('dashboard_customervalue failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
                        rowCount: 0,
                        tool: 'dashboard_customervalue'
                    };
                }
            },
            displayName: function(args) {
                return 'Analyzing customer value...';
            }
        },

        dashboard_spendvelocity: {
            name: 'dashboard_spendvelocity',
            shortDescription: 'Cost Dynamics: expense trends, velocity',
            category: 'dashboard',
            description: `Get comprehensive COST DYNAMICS/SPEND VELOCITY dashboard data including:
- Spend velocity by vendor (growth speed)
- Spend acceleration (is growth speeding up)
- Subscription creep detection ("boiling frog")
- Shadow IT radar (software spreading virally)
- Commitment cliff analysis (PO vs SO velocity)
- Spending anomalies
- Vendor trajectory analysis

Use for: "spend velocity", "subscription creep", "shadow IT", "commitment cliff", "cost growth", "expense trends", "vendor velocity", "price increases"`,
            parameters: {
                type: 'object',
                properties: {
                    vendor_id: {
                        type: 'number',
                        description: 'Optional: filter to specific vendor'
                    },
                    period: {
                        type: 'string',
                        enum: ['last_6_months', 'last_12_months', 'ytd'],
                        description: 'Period for analysis (default: last_12_months)'
                    }
                },
                required: []
            },
            execute: function(args) {
                try {
                    // Get raw data from dashboard module
                    const rawData = SpendVelocityData.getData(args);

                    // Process through intelligence layer - extracts key metrics, generates insights
                    const intelligence = Cache.processDashboard('spendvelocity', rawData, args.requestId);
                    const metricsCount = Object.keys(intelligence.metrics || {}).length;

                    return {
                        success: true,
                        dashboard: 'spendvelocity',
                        intelligence: intelligence,
                        rowCount: metricsCount > 0 ? metricsCount : 1,
                        tool: 'dashboard_spendvelocity'
                    };
                } catch (e) {
                    log.error('dashboard_spendvelocity failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
                        rowCount: 0,
                        tool: 'dashboard_spendvelocity'
                    };
                }
            },
            displayName: function(args) {
                return 'Analyzing spend velocity...';
            }
        },

        load_collection: {
            name: 'load_collection',
            shortDescription: 'Load dashboard collection for deep-dive',
            category: 'dashboard',
            description: `Load detailed collection data from a cached dashboard for deep-dive analysis.
After calling a dashboard tool, you receive a summary with key metrics and collection references.
Use this tool to drill down into specific collections when the user asks for details.

Example flow:
1. User asks "what's our cash position?" → call dashboard_cashflow
2. Response includes: collections: { arAgingItems: { count: 47, refId: 'cash_abc123' } }
3. User asks "show me the overdue invoices" → call load_collection(refId='cash_abc123', collection='arAgingItems', filter='overdue')

Parameters:
- refId: The cache reference ID from the dashboard response
- collection: Name of the collection to load (e.g., 'arAgingItems', 'topVendors', 'departments')
- limit: Max items to return (default 20)
- filter: Optional filter (varies by collection - 'overdue', 'top5', 'critical', etc.)
- sort: Optional sort override (asc/desc)

Use this for: "show me details", "list the vendors", "which customers", "break it down", "drill into"`,
            parameters: {
                type: 'object',
                properties: {
                    refId: {
                        type: 'string',
                        description: 'Cache reference ID from dashboard response (e.g., "cashflow_abc123")'
                    },
                    collection: {
                        type: 'string',
                        description: 'Name of collection to load (e.g., "arAgingItems", "topVendors", "departments")'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum items to return (default: 20)'
                    },
                    filter: {
                        type: 'string',
                        description: 'Filter criteria (e.g., "overdue", "top5", "critical", "warning")'
                    },
                    sort: {
                        type: 'string',
                        enum: ['asc', 'desc'],
                        description: 'Sort direction override'
                    }
                },
                required: ['refId', 'collection']
            },
            execute: function(args) {
                try {
                    const result = Cache.loadCollection(
                        args.refId,
                        args.collection,
                        {
                            limit: args.limit || 20,
                            filter: args.filter,
                            sort: args.sort
                        }
                    );

                    if (!result) {
                        return {
                            success: false,
                            error: 'Collection not found or cache expired. Call the dashboard tool again to refresh data.',
                            tool: 'load_collection'
                        };
                    }

                    return {
                        success: true,
                        collection: args.collection,
                        data: result.items,
                        count: result.count,
                        totalAvailable: result.totalAvailable,
                        appliedFilter: result.appliedFilter,
                        tool: 'load_collection'
                    };
                } catch (e) {
                    log.error('load_collection failed', { error: e.message, args: args });
                    return {
                        success: false,
                        error: e.message,
                        tool: 'load_collection'
                    };
                }
            },
            displayName: function(args) {
                return 'Loading ' + (args.collection || 'collection') + ' details...';
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER 4: UTILITY TOOLS
    // Fiscal context, custom queries, validation
    // ═══════════════════════════════════════════════════════════════════════════

    const UTILITY_TOOLS = {
        get_fiscal_context: {
            name: 'get_fiscal_context',
            shortDescription: 'Current fiscal period and date info',
            category: 'utility',
            description: `Get current fiscal calendar context including:
- Current date
- Fiscal year start/end dates
- Current period name
- Prior year dates for comparisons

Use to understand what "YTD", "this quarter", etc. mean for this organization.`,
            parameters: {
                type: 'object',
                properties: {},
                required: []
            },
            execute: function(args) {
                try {
                    const now = new Date();
                    const fiscalCalendar = ConfigLib.getFiscalCalendar() || { fiscalYearStartMonth: 0, fiscalYearStartDay: 1 };

                    const fyStartMonth = fiscalCalendar.fiscalYearStartMonth || 0;
                    const fyStartDay = fiscalCalendar.fiscalYearStartDay || 1;

                    let fyYear = now.getFullYear();
                    if (now.getMonth() < fyStartMonth || (now.getMonth() === fyStartMonth && now.getDate() < fyStartDay)) {
                        fyYear = fyYear - 1;
                    }

                    const fyStart = new Date(fyYear, fyStartMonth, fyStartDay);
                    const fyEnd = new Date(fyYear + 1, fyStartMonth, fyStartDay - 1);

                    return {
                        success: true,
                        context: {
                            currentDate: Utils.formatDateYMD(now),
                            currentYear: now.getFullYear(),
                            currentMonth: now.getMonth() + 1,
                            fiscalYearStart: Utils.formatDateYMD(fyStart),
                            fiscalYearEnd: Utils.formatDateYMD(fyEnd),
                            fiscalYear: fyYear,
                            fiscalYearName: 'FY' + fyYear
                        },
                        tool: 'get_fiscal_context'
                    };
                } catch (e) {
                    return {
                        success: false,
                        error: e.message,
                        tool: 'get_fiscal_context'
                    };
                }
            },
            displayName: function(args) {
                return 'Getting fiscal context...';
            }
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // CACHED DATA ACCESS TOOL
        // Allows LLM to query any data stored in cache from previous tool calls
        // ═══════════════════════════════════════════════════════════════════════════

        load_cached_data: {
            name: 'load_cached_data',
            shortDescription: 'Load/drill-down into previously fetched data',
            category: 'utility',
            description: `Load data from cache - use this to access previously fetched data or drill into dashboard collections.

USE THIS TOOL WHEN:
1. User asks for more details about data you already have (drill-down)
2. User wants to see a specific collection from a dashboard (e.g., "show me the weekly projection")
3. User asks to filter or sort previously loaded data
4. You need to access data stored with a refId from a previous response

TYPES OF DATA YOU CAN ACCESS:
1. Dashboard Collections: Use refId from dashboard + collection_name (e.g., "weeklyProjection", "arBuckets")
2. Query Results: Use refId from previous query to load more rows or filter
3. Any cached data: Use the refId shown in previous responses

EXAMPLES:
- Load weekly projection: { "ref_id": "dash_cash_abc123", "collection_name": "weeklyProjection" }
- Load with filter: { "ref_id": "dash_cash_abc123", "collection_name": "arBuckets", "filter": { "amount": { "min": 10000 } } }
- Load query rows: { "ref_id": "ref_geta_xyz789", "start_row": 0, "end_row": 49 }`,
            parameters: {
                type: 'object',
                properties: {
                    ref_id: {
                        type: 'string',
                        description: 'The refId from a previous tool result (e.g., "dash_cash_abc123" or "ref_geta_xyz789")'
                    },
                    request_id: {
                        type: 'string',
                        description: 'Optional: The requestId if loading from a different request (usually not needed)'
                    },
                    collection_name: {
                        type: 'string',
                        description: 'For dashboards: name of the collection to load (e.g., "weeklyProjection", "arBuckets", "topCustomers")'
                    },
                    start_row: {
                        type: 'number',
                        description: 'For query results: starting row index (0-based). Default: 0'
                    },
                    end_row: {
                        type: 'number',
                        description: 'For query results: ending row index (inclusive). Default: 49'
                    },
                    filter: {
                        type: 'object',
                        description: 'Optional filter for collections. Format: { "fieldName": value } or { "fieldName": { "min": N, "max": N, "contains": "text" } }'
                    },
                    sort: {
                        type: 'object',
                        description: 'Optional sort for collections. Format: { "field": "fieldName", "direction": "asc" or "desc" }'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of items to return. Default: 50'
                    }
                },
                required: ['ref_id']
            },
            execute: function(args) {
                const refId = args.ref_id;
                const requestId = args.request_id;

                log.debug('load_cached_data', {
                    refId: refId,
                    collectionName: args.collection_name,
                    hasFilter: !!args.filter
                });

                // Validate ref_id is provided
                if (!refId) {
                    return {
                        success: false,
                        error: 'ref_id is required. Look for refId in the previous tool results (e.g., "dash_cash_abc123" or "ref_geta_xyz789") and provide it.',
                        hint: args.collection_name
                            ? `You requested collection "${args.collection_name}" but did not provide the ref_id. Check the previous response for dashboard refId.`
                            : 'No ref_id provided. Check previous tool results for available refIds.'
                    };
                }

                try {
                    // Determine data source based on refId pattern
                    const isDashboardRef = refId.startsWith('dash_');

                    if (isDashboardRef && args.collection_name) {
                        // Load dashboard collection from DashboardCache
                        const collectionResult = Cache.loadCollection(
                            refId,
                            args.collection_name,
                            {
                                filter: args.filter,
                                sort: args.sort,
                                limit: args.limit || 50
                            }
                        );

                        if (!collectionResult.success) {
                            return {
                                success: false,
                                error: collectionResult.error || 'Failed to load collection',
                                hint: collectionResult.hint || 'The data may have expired. Try calling the dashboard tool again.',
                                available: collectionResult.available,
                                tool: 'load_cached_data'
                            };
                        }

                        // Convert items to rows format for consistency
                        const items = collectionResult.items || [];
                        const columns = items.length > 0 ? Object.keys(items[0]) : collectionResult.columns || [];

                        return {
                            success: true,
                            source: 'dashboard_collection',
                            collection: args.collection_name,
                            refId: refId,
                            rows: items,
                            columns: columns,
                            rowCount: items.length,
                            totalCount: collectionResult.totalCount,
                            aggregates: collectionResult.aggregates,
                            tool: 'load_cached_data'
                        };

                    } else if (isDashboardRef && !args.collection_name) {
                        // Load dashboard metric
                        if (args.metric_name) {
                            const metricResult = Cache.getMetric(refId, args.metric_name);
                            return {
                                success: metricResult.success,
                                source: 'dashboard_metric',
                                ...metricResult,
                                tool: 'load_cached_data'
                            };
                        }

                        // No collection specified - return available collections
                        return {
                            success: false,
                            error: 'Please specify collection_name to load dashboard data',
                            hint: 'Available collections can be found in the dashboard response (e.g., weeklyProjection, arBuckets)',
                            tool: 'load_cached_data'
                        };

                    } else {
                        // Load from DataStore (query results)
                        const startRow = args.start_row || 0;
                        const endRow = args.end_row || 49;

                        // Try to load with provided requestId, then fall back to refId-only lookup
                        let data = null;
                        if (requestId) {
                            data = Cache.loadRows(requestId, refId, startRow, endRow);
                        }

                        if (!data) {
                            return {
                                success: false,
                                error: 'Data not found or expired',
                                hint: 'The cached data may have expired. Try re-running the original query.',
                                refId: refId,
                                tool: 'load_cached_data'
                            };
                        }

                        return {
                            success: true,
                            source: 'query_cache',
                            refId: refId,
                            rows: data.rows,
                            columns: data.columns,
                            rowCount: data.rows.length,
                            range: data.range,
                            tool: 'load_cached_data'
                        };
                    }

                } catch (e) {
                    log.error('load_cached_data error', { refId: refId, error: e.message });
                    return {
                        success: false,
                        error: e.message,
                        tool: 'load_cached_data'
                    };
                }
            },
            displayName: function(args) {
                if (args.collection_name) {
                    return `Loading ${args.collection_name} collection...`;
                }
                return 'Loading cached data...';
            }
        },

        run_custom_query: {
            name: 'run_custom_query',
            shortDescription: 'Execute custom SuiteQL query',
            category: 'utility',
            description: `Execute a custom SuiteQL query when no other tool provides the needed data.
USE SPARINGLY - prefer specific data tools when available.
Only use for complex queries that combine multiple data sources.

CRITICAL SuiteQL SYNTAX (NOT standard SQL!):
- Row limits: Use "FETCH FIRST N ROWS ONLY" at END of query (NOT "LIMIT N")
  Example: SELECT * FROM customer FETCH FIRST 100 ROWS ONLY
- String comparison: Use single quotes ('value'), NOT double quotes
- Boolean fields: Use 'T' for true, 'F' for false (e.g., posting = 'T')
- Date comparison: Use TO_DATE('2024-01-01', 'YYYY-MM-DD')

IMPORTANT field notes:
- Use transaction.foreigntotal, NOT transaction.amount (not exposed)
- Use transaction.foreignamountunpaid for unpaid amounts
- Use transactionaccountingline for GL-level debit/credit data
- Always include posting = 'T' AND voided = 'F' filters on transaction table
- Use BUILTIN.DF() to get display names for foreign key fields

TABLE vs TYPE: VendBill, CustInvc etc are TYPE values in 'transaction' table, NOT table names.
Query vendor bills: SELECT * FROM transaction WHERE type = 'VendBill'`,
            parameters: {
                type: 'object',
                properties: {
                    sql: {
                        type: 'string',
                        description: 'The SuiteQL query to execute'
                    },
                    purpose: {
                        type: 'string',
                        description: 'Brief description of what this query is trying to find'
                    }
                },
                required: ['sql', 'purpose']
            },
            execute: function(args) {
                log.debug('run_custom_query', { purpose: args.purpose, sqlPreview: args.sql.substring(0, 200) });

                const result = QueryExecutor.executeQuery(args.sql);
                const formatted = formatResult(result, 'run_custom_query');
                formatted.purpose = args.purpose;

                return formatted;
            },
            displayName: function(args) {
                return args.purpose || 'Running custom query...';
            }
        },

        run_saved_search: {
            name: 'run_saved_search',
            shortDescription: 'Run a NetSuite saved search by ID',
            category: 'reports',
            description: `Execute a NetSuite saved search by its internal ID or script ID.
Use this when:
- User mentions a specific saved search name or ID
- User wants to run a pre-built report
- You need data from a custom search the user has created

The search returns up to 1000 rows with all available columns.
Use list_saved_searches first if you need to find available searches.

Examples:
- run_saved_search({ search_id: "customsearch_ar_aging" })
- run_saved_search({ search_id: "123", filters: [["customer", "is", "456"]] })`,
            parameters: {
                type: 'object',
                properties: {
                    search_id: {
                        type: 'string',
                        description: 'The internal ID (e.g., "123") or script ID (e.g., "customsearch_ar_aging") of the saved search'
                    },
                    filters: {
                        type: 'array',
                        description: 'Optional additional filters to apply. Format: [["fieldname", "operator", "value"], ...]. Operators: is, isnot, anyof, noneof, greaterthan, lessthan, contains, doesnotcontain, startswith, isempty, isnotempty',
                        items: {
                            type: 'array',
                            items: { type: 'string' }
                        }
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 500, max: 1000)'
                    }
                },
                required: ['search_id']
            },
            execute: function(args) {
                const searchId = args.search_id;
                const additionalFilters = args.filters || [];
                const maxResults = Math.min(args.max_results || 500, 1000);

                log.debug('run_saved_search', {
                    searchId: searchId,
                    filterCount: additionalFilters.length,
                    maxResults: maxResults
                });

                try {
                    // Load the saved search
                    const savedSearch = search.load({ id: searchId });

                    // Add additional filters if provided
                    if (additionalFilters.length > 0) {
                        const existingFilters = savedSearch.filters || [];
                        additionalFilters.forEach(function(filter) {
                            if (Array.isArray(filter) && filter.length >= 3) {
                                existingFilters.push(search.createFilter({
                                    name: filter[0],
                                    operator: search.Operator[filter[1].toUpperCase()] || filter[1],
                                    values: filter.slice(2)
                                }));
                            }
                        });
                        savedSearch.filters = existingFilters;
                    }

                    // Execute and collect results
                    const rows = [];
                    const columns = [];
                    let columnsMapped = false;

                    savedSearch.run().each(function(result) {
                        // Map column names on first result
                        if (!columnsMapped) {
                            result.columns.forEach(function(col) {
                                const colName = col.label || col.name || col.join + '_' + col.name;
                                columns.push(colName);
                            });
                            columnsMapped = true;
                        }

                        // Build row object
                        const row = {};
                        result.columns.forEach(function(col, idx) {
                            const colName = columns[idx];
                            const value = result.getValue(col);
                            const text = result.getText(col);
                            // Use text if available (for select fields), otherwise value
                            row[colName] = text || value;
                        });
                        rows.push(row);

                        return rows.length < maxResults;
                    });

                    return {
                        success: true,
                        searchId: searchId,
                        searchTitle: savedSearch.title || searchId,
                        recordType: savedSearch.searchType,
                        columns: columns,
                        rows: rows,
                        rowCount: rows.length,
                        truncated: rows.length >= maxResults,
                        tool: 'run_saved_search'
                    };

                } catch (e) {
                    log.error('run_saved_search error', {
                        searchId: searchId,
                        error: e.message
                    });

                    return {
                        success: false,
                        error: e.message,
                        searchId: searchId,
                        hint: e.message.includes('Invalid search') ?
                            'The search ID may be incorrect. Use list_saved_searches to find available searches.' :
                            'Check that you have permission to run this search.',
                        tool: 'run_saved_search'
                    };
                }
            },
            displayName: function(args) {
                return 'Running saved search ' + (args.search_id || '') + '...';
            }
        },

        list_saved_searches: {
            name: 'list_saved_searches',
            shortDescription: 'List available saved searches',
            category: 'reports',
            description: `List available saved searches in the system, optionally filtered by record type or title.
Use this to:
- Find available searches before running them
- Help user identify the right search by name
- Discover what pre-built reports exist

Returns search ID, title, record type, and description.`,
            parameters: {
                type: 'object',
                properties: {
                    record_type: {
                        type: 'string',
                        description: 'Filter by record type (e.g., "transaction", "customer", "vendor", "invoice", "salesorder"). Leave empty for all types.',
                        enum: ['transaction', 'customer', 'vendor', 'employee', 'invoice', 'salesorder', 'purchaseorder', 'item', 'account', 'journalentry', 'creditmemo', 'vendorbill', 'vendorpayment', 'customerpayment', '']
                    },
                    title_contains: {
                        type: 'string',
                        description: 'Filter searches where title contains this text (case-insensitive)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of searches to return (default: 50, max: 200)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const recordType = args.record_type || '';
                const titleContains = (args.title_contains || '').toLowerCase();
                const maxResults = Math.min(args.max_results || 50, 200);

                log.debug('list_saved_searches', {
                    recordType: recordType,
                    titleContains: titleContains
                });

                try {
                    // Build search for saved searches
                    const filters = [
                        ['isinactive', 'is', 'F'],
                        'AND',
                        ['ispublic', 'is', 'T']  // Only public searches
                    ];

                    if (recordType) {
                        filters.push('AND');
                        filters.push(['recordtype', 'is', recordType]);
                    }

                    if (titleContains) {
                        filters.push('AND');
                        filters.push(['title', 'contains', titleContains]);
                    }

                    const searchSearch = search.create({
                        type: 'savedsearch',
                        filters: filters,
                        columns: [
                            search.createColumn({ name: 'internalid' }),
                            search.createColumn({ name: 'title', sort: search.Sort.ASC }),
                            search.createColumn({ name: 'recordtype' }),
                            search.createColumn({ name: 'id' })  // Script ID
                        ]
                    });

                    const searches = [];
                    searchSearch.run().each(function(result) {
                        searches.push({
                            internalId: result.getValue('internalid'),
                            scriptId: result.getValue('id'),
                            title: result.getValue('title'),
                            recordType: result.getText('recordtype') || result.getValue('recordtype')
                        });
                        return searches.length < maxResults;
                    });

                    return {
                        success: true,
                        searches: searches,
                        count: searches.length,
                        truncated: searches.length >= maxResults,
                        filters: {
                            recordType: recordType || 'all',
                            titleContains: titleContains || 'none'
                        },
                        tool: 'list_saved_searches'
                    };

                } catch (e) {
                    log.error('list_saved_searches error', { error: e.message });

                    return {
                        success: false,
                        error: e.message,
                        tool: 'list_saved_searches'
                    };
                }
            },
            displayName: function(args) {
                const type = args.record_type ? ' for ' + args.record_type : '';
                return 'Listing saved searches' + type + '...';
            }
        },

        list_capabilities: {
            name: 'list_capabilities',
            shortDescription: 'List all advisor capabilities',
            category: 'utility',
            description: `Get a summary of all available tools and capabilities.
Use this when user asks:
- "What can you do?"
- "What tools do you have?"
- "Help me understand your capabilities"`,
            parameters: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        enum: ['all', 'discovery', 'data', 'profitability', 'dashboards', 'reports', 'utility', 'queries'],
                        description: 'Filter by tool category (default: all). Note: "queries" is an alias for "utility"'
                    }
                },
                required: []
            },
            execute: function(args) {
                const requestedCategory = args.category || 'all';

                // Category metadata for display
                const categoryDescriptions = {
                    discovery: 'Find entities and resolve IDs',
                    data: 'Get financial data and metrics',
                    profitability: 'Segment-level P&L analysis',
                    dashboard: 'Comprehensive pre-computed analysis',
                    reports: 'Standard and custom reports',
                    utility: 'Helper tools and custom queries'
                };

                // Map category names for backwards compatibility
                const categoryAliases = {
                    dashboards: 'dashboard',
                    queries: 'utility'
                };

                // DYNAMICALLY build capabilities from ALL_TOOLS
                const capabilities = {};

                for (const toolName in ALL_TOOLS) {
                    const tool = ALL_TOOLS[toolName];

                    // Skip internal/unexposed tools
                    if (tool.exposed === false || tool.category === 'internal') {
                        continue;
                    }

                    const category = tool.category || 'utility';
                    const displayCategory = category === 'dashboard' ? 'dashboards' : category;

                    // Initialize category if needed
                    if (!capabilities[displayCategory]) {
                        capabilities[displayCategory] = {
                            description: categoryDescriptions[category] || category,
                            tools: []
                        };
                    }

                    // Add tool to category
                    capabilities[displayCategory].tools.push({
                        name: toolName,
                        purpose: tool.shortDescription || tool.description.split('\n')[0].trim()
                    });
                }

                // Resolve category alias (e.g., 'queries' -> 'utility')
                const normalizedCategory = categoryAliases[requestedCategory] || requestedCategory;

                let result = {};
                if (requestedCategory === 'all') {
                    result = capabilities;
                } else if (capabilities[requestedCategory]) {
                    result[requestedCategory] = capabilities[requestedCategory];
                } else if (capabilities[normalizedCategory]) {
                    result[normalizedCategory] = capabilities[normalizedCategory];
                }

                const totalTools = Object.values(capabilities).reduce((sum, cat) => sum + cat.tools.length, 0);

                return {
                    success: true,
                    capabilities: result,
                    totalTools: totalTools,
                    categories: Object.keys(capabilities),
                    tip: 'Use list_dashboards, list_datasets, or list_saved_searches for detailed discovery',
                    tool: 'list_capabilities'
                };
            },
            displayName: function(args) {
                return 'Listing capabilities...';
            }
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // DATASET TOOLS - Using real N/dataset module for SuiteAnalytics Workbooks
        // ═══════════════════════════════════════════════════════════════════════════

        list_datasets: {
            name: 'list_datasets',
            shortDescription: 'List all SuiteAnalytics datasets',
            category: 'data',
            description: `List all available datasets created in SuiteAnalytics Workbooks.
Datasets are pre-built queries that users have created and saved.
Use this to discover what datasets are available before running them.

Use this when:
- User asks "what datasets are available?"
- User mentions a dataset by name and you need to find its ID
- You want to see what pre-built data sources exist`,
            parameters: {
                type: 'object',
                properties: {
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of datasets to return (default: 50, max: 200)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const maxResults = Math.min(args.max_results || 50, 200);

                log.debug('list_datasets', { maxResults: maxResults });

                try {
                    // Use N/dataset.list() to get all available datasets
                    const allDatasets = dataset.list();

                    if (!allDatasets || allDatasets.length === 0) {
                        return {
                            success: true,
                            datasets: [],
                            count: 0,
                            message: 'No datasets found. Datasets are created in SuiteAnalytics Workbook.',
                            tip: 'Use list_saved_searches to find saved searches, or use specific data tools like get_income_statement, get_ar_aging, etc.',
                            tool: 'list_datasets'
                        };
                    }

                    // Format dataset list
                    const datasets = allDatasets.slice(0, maxResults).map(function(ds) {
                        return {
                            id: ds.id,
                            name: ds.name || ds.id,
                            description: ds.description || 'SuiteAnalytics Dataset'
                        };
                    });

                    return {
                        success: true,
                        datasets: datasets,
                        count: datasets.length,
                        totalAvailable: allDatasets.length,
                        usage: 'Use run_dataset({ dataset_id: "id" }) to execute a dataset',
                        tool: 'list_datasets'
                    };

                } catch (e) {
                    log.error('list_datasets error', { error: e.message, stack: e.stack });

                    // Provide helpful error message
                    let errorMessage = e.message;
                    if (e.message.indexOf('INSUFFICIENT_PERMISSION') > -1) {
                        errorMessage = 'Insufficient permissions to list datasets. The SuiteAnalytics Workbook feature may not be enabled or accessible.';
                    }

                    return {
                        success: false,
                        error: errorMessage,
                        tip: 'Datasets require SuiteAnalytics Workbook. Use list_saved_searches for saved searches instead.',
                        tool: 'list_datasets'
                    };
                }
            },
            displayName: function(args) {
                return 'Listing available datasets...';
            }
        },

        run_dataset: {
            name: 'run_dataset',
            shortDescription: 'Execute a SuiteAnalytics dataset by ID',
            category: 'data',
            description: `Run a SuiteAnalytics dataset and return its results.
Datasets are pre-built queries created in SuiteAnalytics Workbook.

Use list_datasets first to discover available datasets and their IDs.

The dataset is executed and returns results similar to a saved search or SuiteQL query.`,
            parameters: {
                type: 'object',
                properties: {
                    dataset_id: {
                        type: 'string',
                        description: 'The internal ID of the dataset to run (use list_datasets to find IDs)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 500, max: 1000)'
                    }
                },
                required: ['dataset_id']
            },
            execute: function(args) {
                const datasetId = args.dataset_id;
                const maxResults = Math.min(args.max_results || 500, 1000);

                log.debug('run_dataset', { datasetId: datasetId, maxResults: maxResults });

                if (!datasetId) {
                    return {
                        success: false,
                        error: 'dataset_id is required. Use list_datasets to find available datasets.',
                        tool: 'run_dataset'
                    };
                }

                try {
                    // Load the dataset
                    const loadedDataset = dataset.load({ id: datasetId });

                    if (!loadedDataset) {
                        return {
                            success: false,
                            error: 'Dataset not found: ' + datasetId,
                            tip: 'Use list_datasets to see available datasets',
                            tool: 'run_dataset'
                        };
                    }

                    // Run the dataset - returns a query.ResultSet
                    const resultSet = loadedDataset.run();

                    // Extract columns
                    const columns = [];
                    if (resultSet.columns && resultSet.columns.length > 0) {
                        resultSet.columns.forEach(function(col) {
                            columns.push(col.label || col.alias || col.fieldId || 'column');
                        });
                    }

                    // Extract rows (up to maxResults)
                    const rows = [];
                    const iterator = resultSet.iterator();
                    let rowCount = 0;

                    iterator.each(function(result) {
                        if (rowCount >= maxResults) {
                            return false; // Stop iteration
                        }

                        const row = {};
                        columns.forEach(function(colName, idx) {
                            const value = result.getValue(idx);
                            row[colName] = value;
                        });
                        rows.push(row);
                        rowCount++;

                        return true; // Continue iteration
                    });

                    return {
                        success: true,
                        datasetId: datasetId,
                        datasetName: loadedDataset.name || datasetId,
                        columns: columns,
                        rows: rows,
                        rowCount: rows.length,
                        maxResults: maxResults,
                        hasMore: rowCount >= maxResults,
                        tool: 'run_dataset'
                    };

                } catch (e) {
                    log.error('run_dataset error', {
                        datasetId: datasetId,
                        error: e.message,
                        stack: e.stack
                    });

                    // Provide helpful error messages
                    let errorMessage = e.message;
                    let tip = 'Use list_datasets to verify the dataset exists.';

                    if (e.message.indexOf('INVALID_KEY_OR_REF') > -1 || e.message.indexOf('Invalid dataset') > -1) {
                        errorMessage = 'Dataset not found: ' + datasetId;
                    } else if (e.message.indexOf('INSUFFICIENT_PERMISSION') > -1) {
                        errorMessage = 'Insufficient permissions to run this dataset.';
                        tip = 'Check that you have access to SuiteAnalytics Workbook and this specific dataset.';
                    }

                    return {
                        success: false,
                        error: errorMessage,
                        datasetId: datasetId,
                        tip: tip,
                        tool: 'run_dataset'
                    };
                }
            },
            displayName: function(args) {
                return 'Running dataset ' + (args.dataset_id || '') + '...';
            }
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // WORKBOOK TOOLS - Using real N/workbook module for SuiteAnalytics Workbooks
        // ═══════════════════════════════════════════════════════════════════════════

        list_workbooks: {
            name: 'list_workbooks',
            shortDescription: 'List all SuiteAnalytics workbooks',
            category: 'data',
            description: `List all available workbooks created in SuiteAnalytics.
Workbooks contain pivot tables, charts, and data visualizations built from datasets.
Use this to discover what pre-built analytical workbooks are available.

Use this when:
- User asks "what workbooks are available?"
- User mentions a workbook by name and you need to find its ID
- You want to see what pre-built analytics exist
- User wants pivot table or aggregated data (workbooks have pivots, datasets have raw data)`,
            parameters: {
                type: 'object',
                properties: {
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of workbooks to return (default: 50, max: 200)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const maxResults = Math.min(args.max_results || 50, 200);

                log.debug('list_workbooks', { maxResults: maxResults });

                try {
                    // Use N/workbook.list() to get all available workbooks
                    const allWorkbooks = workbook.list();

                    if (!allWorkbooks || allWorkbooks.length === 0) {
                        return {
                            success: true,
                            workbooks: [],
                            count: 0,
                            message: 'No workbooks found. Workbooks are created in SuiteAnalytics.',
                            tip: 'Use list_datasets for datasets, or list_saved_searches for saved searches.',
                            tool: 'list_workbooks'
                        };
                    }

                    // Format workbook list
                    const workbooks = allWorkbooks.slice(0, maxResults).map(function(wb) {
                        return {
                            id: wb.id,
                            name: wb.name || wb.id,
                            description: wb.description || 'SuiteAnalytics Workbook'
                        };
                    });

                    return {
                        success: true,
                        workbooks: workbooks,
                        count: workbooks.length,
                        totalAvailable: allWorkbooks.length,
                        usage: 'Use run_workbook({ workbook_id: "id" }) to execute a workbook pivot',
                        tool: 'list_workbooks'
                    };

                } catch (e) {
                    log.error('list_workbooks error', { error: e.message, stack: e.stack });

                    // Provide helpful error message
                    let errorMessage = e.message;
                    if (e.message.indexOf('INSUFFICIENT_PERMISSION') > -1) {
                        errorMessage = 'Insufficient permissions to list workbooks. The SuiteAnalytics Workbook feature may not be enabled or accessible.';
                    }

                    return {
                        success: false,
                        error: errorMessage,
                        tip: 'Workbooks require SuiteAnalytics Workbook. Use list_saved_searches for saved searches instead.',
                        tool: 'list_workbooks'
                    };
                }
            },
            displayName: function(args) {
                return 'Listing available workbooks...';
            }
        },

        run_workbook: {
            name: 'run_workbook',
            shortDescription: 'Execute a SuiteAnalytics workbook component',
            category: 'data',
            description: `Run a SuiteAnalytics workbook and return data from pivots, charts, or tables.

Workbooks can contain:
- PIVOTS: Pre-aggregated data with groupings and measures (e.g., revenue by department)
- CHARTS: Visual data (bar, line, pie) - returns the underlying data that feeds the chart
- TABLES: Raw data tables

Use list_workbooks first to discover available workbooks.

By default runs the first pivot table. Use component_type and component_id for specific components.`,
            parameters: {
                type: 'object',
                properties: {
                    workbook_id: {
                        type: 'string',
                        description: 'The internal ID of the workbook to run (use list_workbooks to find IDs)'
                    },
                    component_type: {
                        type: 'string',
                        description: 'Type of component to run: "pivot", "chart", or "table" (default: "pivot")'
                    },
                    component_id: {
                        type: 'string',
                        description: 'Optional: specific component ID within the workbook. If not provided, uses the first component of the specified type.'
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of rows to return (default: 500, max: 1000)'
                    }
                },
                required: ['workbook_id']
            },
            execute: function(args) {
                const workbookId = args.workbook_id;
                const componentType = (args.component_type || 'pivot').toLowerCase();
                const componentId = args.component_id || args.pivot_id; // backwards compat
                const maxResults = Math.min(args.max_results || 500, 1000);

                log.debug('run_workbook', { workbookId: workbookId, componentType: componentType, componentId: componentId, maxResults: maxResults });

                if (!workbookId) {
                    return {
                        success: false,
                        error: 'workbook_id is required. Use list_workbooks to find available workbooks.',
                        tool: 'run_workbook'
                    };
                }

                try {
                    // Load the workbook
                    const loadedWorkbook = workbook.load({ id: workbookId });

                    if (!loadedWorkbook) {
                        return {
                            success: false,
                            error: 'Workbook not found: ' + workbookId,
                            tip: 'Use list_workbooks to see available workbooks',
                            tool: 'run_workbook'
                        };
                    }

                    // Build workbook contents summary
                    const workbookContents = {
                        pivots: (loadedWorkbook.pivots || []).map(function(p) { return { id: p.id, name: p.name }; }),
                        charts: (loadedWorkbook.charts || []).map(function(c) { return { id: c.id, name: c.name, type: c.chartType }; }),
                        tables: (loadedWorkbook.tables || []).map(function(t) { return { id: t.id, name: t.name }; })
                    };

                    // Helper function to extract rows from result iterator
                    function extractRows(resultSet, maxRows) {
                        const rows = [];
                        let rowCount = 0;
                        const iterator = resultSet.iterator();

                        iterator.each(function(result) {
                            if (rowCount >= maxRows) {
                                return false;
                            }

                            const row = {};
                            const resultValues = result.getAllValues();

                            for (var key in resultValues) {
                                if (resultValues.hasOwnProperty(key)) {
                                    row[key] = resultValues[key];
                                }
                            }
                            rows.push(row);
                            rowCount++;

                            return true;
                        });

                        return rows;
                    }

                    // Run based on component type
                    if (componentType === 'pivot') {
                        const pivots = loadedWorkbook.pivots;
                        if (!pivots || pivots.length === 0) {
                            return {
                                success: false,
                                error: 'No pivot tables found in workbook: ' + workbookId,
                                workbookContents: workbookContents,
                                tip: 'Try component_type: "chart" or "table" instead.',
                                tool: 'run_workbook'
                            };
                        }

                        // Select the pivot
                        var selectedPivot = null;
                        if (componentId) {
                            for (var i = 0; i < pivots.length; i++) {
                                if (pivots[i].id === componentId) {
                                    selectedPivot = pivots[i];
                                    break;
                                }
                            }
                            if (!selectedPivot) {
                                return {
                                    success: false,
                                    error: 'Pivot not found: ' + componentId,
                                    workbookContents: workbookContents,
                                    tool: 'run_workbook'
                                };
                            }
                        } else {
                            selectedPivot = pivots[0];
                        }

                        const pivotResult = selectedPivot.run();
                        const rows = extractRows(pivotResult, maxResults);
                        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

                        return {
                            success: true,
                            workbookId: workbookId,
                            workbookName: loadedWorkbook.name || workbookId,
                            componentType: 'pivot',
                            componentId: selectedPivot.id,
                            componentName: selectedPivot.name || selectedPivot.id,
                            workbookContents: workbookContents,
                            columns: columns,
                            rows: rows,
                            rowCount: rows.length,
                            hasMore: rows.length >= maxResults,
                            tool: 'run_workbook'
                        };

                    } else if (componentType === 'chart') {
                        const charts = loadedWorkbook.charts;
                        if (!charts || charts.length === 0) {
                            return {
                                success: false,
                                error: 'No charts found in workbook: ' + workbookId,
                                workbookContents: workbookContents,
                                tip: 'Try component_type: "pivot" or "table" instead.',
                                tool: 'run_workbook'
                            };
                        }

                        // Select the chart
                        var selectedChart = null;
                        if (componentId) {
                            for (var j = 0; j < charts.length; j++) {
                                if (charts[j].id === componentId) {
                                    selectedChart = charts[j];
                                    break;
                                }
                            }
                            if (!selectedChart) {
                                return {
                                    success: false,
                                    error: 'Chart not found: ' + componentId,
                                    workbookContents: workbookContents,
                                    tool: 'run_workbook'
                                };
                            }
                        } else {
                            selectedChart = charts[0];
                        }

                        // Get chart data - charts have underlying data we can extract
                        const chartResult = selectedChart.run();
                        const chartRows = extractRows(chartResult, maxResults);
                        const chartColumns = chartRows.length > 0 ? Object.keys(chartRows[0]) : [];

                        return {
                            success: true,
                            workbookId: workbookId,
                            workbookName: loadedWorkbook.name || workbookId,
                            componentType: 'chart',
                            componentId: selectedChart.id,
                            componentName: selectedChart.name || selectedChart.id,
                            chartType: selectedChart.chartType,
                            chartInfo: {
                                type: selectedChart.chartType,
                                note: 'Chart data returned. UI can render as ' + selectedChart.chartType + ' chart.'
                            },
                            workbookContents: workbookContents,
                            columns: chartColumns,
                            rows: chartRows,
                            rowCount: chartRows.length,
                            hasMore: chartRows.length >= maxResults,
                            tool: 'run_workbook'
                        };

                    } else if (componentType === 'table') {
                        const tables = loadedWorkbook.tables;
                        if (!tables || tables.length === 0) {
                            return {
                                success: false,
                                error: 'No tables found in workbook: ' + workbookId,
                                workbookContents: workbookContents,
                                tip: 'Try component_type: "pivot" or "chart" instead.',
                                tool: 'run_workbook'
                            };
                        }

                        // Select the table
                        var selectedTable = null;
                        if (componentId) {
                            for (var k = 0; k < tables.length; k++) {
                                if (tables[k].id === componentId) {
                                    selectedTable = tables[k];
                                    break;
                                }
                            }
                            if (!selectedTable) {
                                return {
                                    success: false,
                                    error: 'Table not found: ' + componentId,
                                    workbookContents: workbookContents,
                                    tool: 'run_workbook'
                                };
                            }
                        } else {
                            selectedTable = tables[0];
                        }

                        const tableResult = selectedTable.run();
                        const tableRows = extractRows(tableResult, maxResults);
                        const tableColumns = tableRows.length > 0 ? Object.keys(tableRows[0]) : [];

                        return {
                            success: true,
                            workbookId: workbookId,
                            workbookName: loadedWorkbook.name || workbookId,
                            componentType: 'table',
                            componentId: selectedTable.id,
                            componentName: selectedTable.name || selectedTable.id,
                            workbookContents: workbookContents,
                            columns: tableColumns,
                            rows: tableRows,
                            rowCount: tableRows.length,
                            hasMore: tableRows.length >= maxResults,
                            tool: 'run_workbook'
                        };

                    } else {
                        return {
                            success: false,
                            error: 'Invalid component_type: ' + componentType + '. Use "pivot", "chart", or "table".',
                            workbookContents: workbookContents,
                            tool: 'run_workbook'
                        };
                    }

                } catch (e) {
                    log.error('run_workbook error', {
                        workbookId: workbookId,
                        componentType: componentType,
                        componentId: componentId,
                        error: e.message,
                        stack: e.stack
                    });

                    // Provide helpful error messages
                    let errorMessage = e.message;
                    let tip = 'Use list_workbooks to verify the workbook exists.';

                    if (e.message.indexOf('INVALID_KEY_OR_REF') > -1 || e.message.indexOf('Invalid workbook') > -1) {
                        errorMessage = 'Workbook not found: ' + workbookId;
                    } else if (e.message.indexOf('INSUFFICIENT_PERMISSION') > -1) {
                        errorMessage = 'Insufficient permissions to run this workbook.';
                        tip = 'Check that you have access to SuiteAnalytics Workbook and this specific workbook.';
                    }

                    return {
                        success: false,
                        error: errorMessage,
                        workbookId: workbookId,
                        tip: tip,
                        tool: 'run_workbook'
                    };
                }
            },
            displayName: function(args) {
                var componentInfo = args.component_type ? ' (' + args.component_type + ')' : '';
                return 'Running workbook ' + (args.workbook_id || '') + componentInfo + '...';
            }
        },

        format_response: {
            name: 'format_response',
            shortDescription: 'Format final response with rich blocks',
            category: 'internal',
            exposed: false,  // Internal tool - not shown in LLM tool selection
            description: `REQUIRED: Format your final response with rich structured content.
Use this tool when you are ready to provide your final answer to the user.
This creates professional, visually appealing responses with multiple content types.

ALWAYS use this tool for your final response instead of plain text.

## Block Types:
- **text**: Narrative analysis, insights, and explanations
- **metrics**: Key numbers displayed prominently with optional trend indicators
- **table**: Structured data with headers and rows
- **chart**: Data visualization (bar, line, pie charts)
- **list**: Bullet points for key takeaways or action items

## Example:
{
    "title": "AR Aging Analysis",
    "summary": "Brief one-liner summary",
    "blocks": [
        { "type": "text", "content": "Analysis summary..." },
        { "type": "metrics", "items": [
            { "label": "Total AR", "value": "$125,000", "change": "+5%", "trend": "up" }
        ]},
        { "type": "table", "title": "Top Customers", "headers": ["Customer", "Amount"], "rows": [["ABC Corp", "$50,000"]] },
        { "type": "list", "title": "Key Insights", "items": ["Insight 1", "Insight 2"] }
    ]
}`,
            parameters: {
                type: 'object',
                properties: {
                    title: {
                        type: 'string',
                        description: 'Title for the response (e.g., "AR Aging Analysis")'
                    },
                    summary: {
                        type: 'string',
                        description: 'Brief one-line summary of the analysis'
                    },
                    blocks: {
                        type: 'array',
                        description: 'Array of content blocks',
                        items: {
                            type: 'object',
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: ['text', 'metrics', 'table', 'chart', 'list'],
                                    description: 'Block type'
                                },
                                content: {
                                    type: 'string',
                                    description: 'For text blocks: the narrative content'
                                },
                                title: {
                                    type: 'string',
                                    description: 'Optional title for tables, lists, charts'
                                },
                                items: {
                                    type: 'array',
                                    description: 'For metrics: array of {label, value, change?, trend?}. For list: array of strings',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            label: { type: 'string', description: 'Label for the metric or list item text' },
                                            value: { type: 'string', description: 'Value for the metric' },
                                            change: { type: 'string', description: 'Change indicator (e.g., "+5%")' },
                                            trend: { type: 'string', enum: ['up', 'down'], description: 'Trend direction' }
                                        }
                                    }
                                },
                                headers: {
                                    type: 'array',
                                    description: 'For table: column headers',
                                    items: { type: 'string' }
                                },
                                rows: {
                                    type: 'array',
                                    description: 'For table: array of row arrays',
                                    items: {
                                        type: 'array',
                                        items: { type: 'string' }
                                    }
                                },
                                chartType: {
                                    type: 'string',
                                    enum: ['bar', 'line', 'pie'],
                                    description: 'For chart: type of chart'
                                },
                                data: {
                                    type: 'array',
                                    description: 'For chart: array of {label, value} objects',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            label: { type: 'string', description: 'Data point label' },
                                            value: { type: 'number', description: 'Data point value' }
                                        },
                                        required: ['label', 'value']
                                    }
                                }
                            },
                            required: ['type']
                        }
                    }
                },
                required: ['blocks']
            },
            execute: function(args) {
                // Validate blocks
                if (!args.blocks || !Array.isArray(args.blocks) || args.blocks.length === 0) {
                    return {
                        success: false,
                        error: 'blocks array is required and must not be empty',
                        tool: 'format_response'
                    };
                }

                // Transform blocks into richContent format
                const richContent = [];

                // Add title if provided
                if (args.title) {
                    richContent.push({
                        type: 'heading',
                        content: args.title,
                        level: 2
                    });
                }

                // Add summary if provided
                if (args.summary) {
                    richContent.push({
                        type: 'text',
                        content: args.summary,
                        style: 'summary'
                    });
                }

                // Process each block
                for (const block of args.blocks) {
                    switch (block.type) {
                        case 'text':
                            richContent.push({
                                type: 'text',
                                content: block.content || ''
                            });
                            break;

                        case 'metrics':
                            if (block.items && Array.isArray(block.items)) {
                                richContent.push({
                                    type: 'metrics',
                                    title: block.title,
                                    items: block.items.map(item => ({
                                        label: item.label,
                                        value: item.value,
                                        change: item.change,
                                        trend: item.trend,
                                        color: item.trend === 'up' ? 'green' : item.trend === 'down' ? 'red' : 'neutral'
                                    }))
                                });
                            }
                            break;

                        case 'table':
                            if (block.headers && block.rows) {
                                richContent.push({
                                    type: 'table',
                                    title: block.title,
                                    headers: block.headers,
                                    rows: block.rows
                                });
                            }
                            break;

                        case 'chart':
                            if (block.data && Array.isArray(block.data)) {
                                richContent.push({
                                    type: 'chart',
                                    title: block.title,
                                    chartType: block.chartType || 'bar',
                                    data: block.data
                                });
                            }
                            break;

                        case 'list':
                            if (block.items && Array.isArray(block.items)) {
                                richContent.push({
                                    type: 'list',
                                    title: block.title,
                                    items: block.items
                                });
                            }
                            break;

                        default:
                            // Pass through unknown types
                            richContent.push(block);
                    }
                }

                return {
                    success: true,
                    isFormatResponse: true,
                    richContent: richContent,
                    title: args.title,
                    summary: args.summary,
                    blockCount: args.blocks.length,
                    tool: 'format_response'
                };
            },
            displayName: function(args) {
                return 'Formatting response...';
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // TOOL REGISTRY & EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    // Combine all tools
    const ALL_TOOLS = {
        ...DISCOVERY_TOOLS,
        ...DATA_TOOLS,
        ...DASHBOARD_TOOLS,
        ...UTILITY_TOOLS
    };

    /**
     * Get tool definitions formatted for LLM
     * Returns flat format for NetSuite N/llm compatibility
     * @returns {Array} Array of tool definitions for LLM function calling
     */
    function getToolDefinitions() {
        const definitions = [];

        for (const toolName in ALL_TOOLS) {
            const tool = ALL_TOOLS[toolName];
            // Use flat format compatible with NetSuite N/llm
            definitions.push({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            });
        }

        return definitions;
    }

    /**
     * Execute a tool by name
     * @param {string} toolName - Name of the tool
     * @param {object} args - Arguments for the tool
     * @returns {object} Tool result
     */
    function executeTool(toolName, args) {
        const tool = ALL_TOOLS[toolName];

        if (!tool) {
            return {
                success: false,
                error: `Unknown tool: ${toolName}`,
                tool: toolName
            };
        }

        try {
            log.debug('Executing tool', { toolName: toolName, args: JSON.stringify(args) });
            const startTime = Date.now();

            const result = tool.execute(args);

            const duration = Date.now() - startTime;
            log.debug('Tool executed', { toolName: toolName, duration: duration, success: result.success });

            result.duration = duration;
            return result;
        } catch (e) {
            log.error('Tool execution failed', { toolName: toolName, error: e.message, stack: e.stack });
            return {
                success: false,
                error: e.message,
                tool: toolName
            };
        }
    }

    /**
     * Get display name for a tool call (for progress display)
     * @param {string} toolName - Name of the tool
     * @param {object} args - Arguments for the tool
     * @returns {string} Human-readable description
     */
    function getToolDisplayName(toolName, args) {
        const tool = ALL_TOOLS[toolName];
        if (tool && tool.displayName) {
            return tool.displayName(args || {});
        }
        return `Running ${toolName}...`;
    }

    /**
     * Get tool by name
     * @param {string} toolName - Name of the tool
     * @returns {object|null} Tool object or null
     */
    function getTool(toolName) {
        return ALL_TOOLS[toolName] || null;
    }

    /**
     * List all available tools by category
     * @returns {object} Tools organized by category
     */
    function listToolsByCategory() {
        return {
            discovery: Object.keys(DISCOVERY_TOOLS),
            data: Object.keys(DATA_TOOLS),
            dashboard: Object.keys(DASHBOARD_TOOLS),
            utility: Object.keys(UTILITY_TOOLS)
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIGHTWEIGHT TOOL MANIFEST (for Streaming Context Architecture)
    // Tool names + one-line descriptions only - no schemas, no parameters
    // This reduces token usage from ~15,000 to ~300 for tool selection
    // DYNAMIC: Generated from tool definitions (single source of truth)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get lightweight tool manifest (names + one-liners only)
     * Used by Streaming Agent for tool selection phase
     * DYNAMICALLY generated from ALL_TOOLS - no more manual maintenance!
     * @returns {object} Map of tool names to one-line descriptions
     */
    function getToolManifest() {
        const manifest = {};

        for (const toolName in ALL_TOOLS) {
            const tool = ALL_TOOLS[toolName];

            // Skip internal/unexposed tools (e.g., format_response)
            if (tool.exposed === false) {
                continue;
            }

            // Use shortDescription if available, otherwise extract first line of description
            const description = tool.shortDescription ||
                (tool.description ? tool.description.split('\n')[0].trim() : toolName);

            manifest[toolName] = description;
        }

        return manifest;
    }

    /**
     * Get formatted tool list for LLM prompt (names + descriptions as text)
     * @returns {string} Formatted tool list for prompt injection
     */
    function getToolListForPrompt() {
        const manifest = getToolManifest();
        return Object.entries(manifest)
            .map(([name, desc]) => `• ${name}: ${desc}`)
            .join('\n');
    }

    /**
     * Get a single tool's full definition (schema on demand)
     * @param {string} toolName - Name of the tool
     * @returns {object|null} Tool definition with parameters, or null
     */
    function getToolDefinition(toolName) {
        const tool = ALL_TOOLS[toolName];
        if (!tool) return null;

        return {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        };
    }

    /**
     * Get minimal schema for a tool (for lightweight invocation prompts)
     * @param {string} toolName - Name of the tool
     * @returns {string} Minimal schema as formatted text
     */
    function getToolSchemaText(toolName) {
        const tool = ALL_TOOLS[toolName];
        if (!tool) return 'Unknown tool';

        const lines = [`TOOL: ${toolName}`];
        lines.push(tool.description.split('\n')[0]); // First line of description only

        if (tool.parameters && tool.parameters.properties) {
            lines.push('\nPARAMETERS:');
            const required = tool.parameters.required || [];

            for (const [param, def] of Object.entries(tool.parameters.properties)) {
                const req = required.includes(param) ? ' (required)' : '';
                let typeInfo = def.type;

                // Add enum values if present (abbreviated)
                if (def.enum) {
                    const enumStr = def.enum.slice(0, 5).join('|');
                    typeInfo += ` [${enumStr}${def.enum.length > 5 ? '|...' : ''}]`;
                }

                lines.push(`  • ${param}: ${typeInfo}${req}`);

                // Brief description
                if (def.description) {
                    const shortDesc = def.description.split('.')[0].substring(0, 60);
                    lines.push(`    ${shortDesc}`);
                }
            }
        } else {
            lines.push('\nNo parameters required');
        }

        return lines.join('\n');
    }

    // Public API
    return {
        // Tool execution
        getToolDefinitions: getToolDefinitions,
        executeTool: executeTool,
        getTool: getTool,
        getToolDisplayName: getToolDisplayName,
        listToolsByCategory: listToolsByCategory,

        // Streaming Context Architecture (lightweight manifest)
        getToolManifest: getToolManifest,
        getToolListForPrompt: getToolListForPrompt,
        getToolDefinition: getToolDefinition,
        getToolSchemaText: getToolSchemaText,

        // ReAct Pattern Support
        suggestBroaderParams: suggestBroaderParams,  // Auto-broaden on empty results

        // Individual tool categories (for direct access if needed)
        DISCOVERY_TOOLS: DISCOVERY_TOOLS,
        DATA_TOOLS: DATA_TOOLS,
        DASHBOARD_TOOLS: DASHBOARD_TOOLS,
        UTILITY_TOOLS: UTILITY_TOOLS,
        ALL_TOOLS: ALL_TOOLS
    };
});
