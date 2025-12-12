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
    './Lib_Advisor_EntityResolver',
    './Lib_Advisor_QueryExecutor',
    './Lib_Advisor_Utils',
    './Lib_Advisor_DashboardCache',
    './Lib_Advisor_DataStore',
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
    EntityResolver,
    QueryExecutor,
    Utils,
    DashboardCache,
    DataStore,
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
            description: `Get available fields and relationships for a NetSuite SuiteQL table.
Use this to understand what data is available before writing custom queries.

IMPORTANT: Tables are NOT the same as transaction types!
- VendBill, CustInvc, etc. are TYPE VALUES in the 'transaction' table, NOT table names
- To query vendor bills: SELECT * FROM transaction WHERE type = 'VendBill'
- The 'transaction' table contains ALL transaction types

Available tables: transaction (all txn types), transactionline (line items),
transactionaccountingline (GL entries), customer, vendor, employee, item, account,
classification, department, location, subsidiary, accountingperiod, project`,
            parameters: {
                type: 'object',
                properties: {
                    table: {
                        type: 'string',
                        enum: ['transaction', 'transactionline', 'transactionaccountingline',
                               'customer', 'vendor', 'employee', 'item', 'account',
                               'classification', 'department', 'location', 'subsidiary',
                               'accountingperiod', 'project'],
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
                        key_fields: ['id', 'periodname', 'startdate', 'enddate', 'isyear', 'isquarter'],
                        notes: [
                            'isyear = \'T\' for year records, \'F\' for months',
                            'isquarter = \'T\' for quarter records',
                            'Use isyear = \'F\' AND isquarter = \'F\' for monthly periods'
                        ]
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

        get_revenue_by_month: {
            name: 'get_revenue_by_month',
            description: `Get monthly revenue trend showing revenue by month.
ALWAYS use this for: "revenue trend", "monthly revenue", "revenue by month", "sales trend", "how is revenue trending"`,
            parameters: {
                type: 'object',
                properties: {
                    months: {
                        type: 'number',
                        description: 'Number of months to show (default: 12)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const months = args.months || 12;

                const query = `
                    SELECT
                        TO_CHAR(t.trandate, 'YYYY-MM') AS month,
                        SUM(t.foreigntotal) AS revenue,
                        COUNT(DISTINCT t.id) AS invoice_count,
                        COUNT(DISTINCT t.entity) AS customer_count
                    FROM transaction t
                    WHERE t.type = 'CustInvc'
                        AND t.posting = 'T'
                        AND t.voided = 'F'
                        AND t.trandate >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -${months})
                    GROUP BY TO_CHAR(t.trandate, 'YYYY-MM')
                    ORDER BY month
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_revenue_by_month');
            },
            displayName: function(args) {
                return `Getting ${args.months || 12} months revenue trend...`;
            }
        },

        get_expense_by_category: {
            name: 'get_expense_by_category',
            description: `Get expense breakdown by expense account category.
ALWAYS use this for: "expense breakdown", "where are we spending", "expense by category", "operating expenses", "cost breakdown"`,
            parameters: {
                type: 'object',
                properties: {
                    period: {
                        type: 'string',
                        enum: ['ytd', 'this_quarter', 'this_month', 'last_month'],
                        description: 'Time period (default: ytd)'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Optional: filter by department ID'
                    }
                },
                required: []
            },
            execute: function(args) {
                const period = args.period || 'ytd';
                const deptFilter = args.department_id ?
                    `AND tl.department = ${args.department_id}` : '';

                let dateFilter = '';
                if (period === 'ytd') {
                    dateFilter = `AND ap.startdate >= (SELECT startdate FROM accountingperiod WHERE isyear = 'T' AND startdate <= SYSDATE ORDER BY startdate DESC FETCH FIRST 1 ROWS ONLY)`;
                } else if (period === 'this_quarter') {
                    dateFilter = `AND ap.startdate >= TRUNC(SYSDATE, 'Q')`;
                } else if (period === 'this_month') {
                    dateFilter = `AND ap.startdate >= TRUNC(SYSDATE, 'MM')`;
                } else if (period === 'last_month') {
                    dateFilter = `AND ap.startdate >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -1) AND ap.enddate < TRUNC(SYSDATE, 'MM')`;
                }

                const query = `
                    SELECT
                        acct.acctnumber AS account_number,
                        acct.accountsearchdisplayname AS account_name,
                        SUM(tal.amount) AS amount,
                        COUNT(DISTINCT tal.transaction) AS transaction_count
                    FROM transactionaccountingline tal
                    INNER JOIN transaction t ON tal.transaction = t.id
                    INNER JOIN accountingperiod ap ON t.postingperiod = ap.id
                    INNER JOIN account acct ON tal.account = acct.id
                    LEFT JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
                    WHERE t.posting = 'T'
                        AND t.voided = 'F'
                        AND acct.accttype IN ('Expense', 'OthExpense')
                        AND ap.isyear = 'F' AND ap.isquarter = 'F'
                        ${dateFilter}
                        ${deptFilter}
                    GROUP BY acct.acctnumber, acct.accountsearchdisplayname
                    ORDER BY amount DESC
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_expense_by_category');

                // Calculate total
                if (formatted.success && formatted.rows) {
                    let totalExpenses = 0;
                    formatted.rows.forEach(row => {
                        totalExpenses += parseFloat(row.amount) || 0;
                    });
                    formatted.summary = {
                        totalExpenses: totalExpenses,
                        categoryCount: formatted.rows.length
                    };
                }

                return formatted;
            },
            displayName: function(args) {
                return `Getting expense breakdown (${args.period || 'ytd'})...`;
            }
        },

        get_recent_transactions: {
            name: 'get_recent_transactions',
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
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER 3: DASHBOARD TOOLS
    // Rich computed metrics from the 8 dashboards
    // ═══════════════════════════════════════════════════════════════════════════

    const DASHBOARD_TOOLS = {
        list_dashboards: {
            name: 'list_dashboards',
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
                    const intelligence = DashboardCache.process('cashflow', rawData, args.requestId);

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
                    const intelligence = DashboardCache.process('health', rawData, args.requestId);
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
                    const intelligence = DashboardCache.process('burden', rawData, args.requestId);
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
                    const intelligence = DashboardCache.process('time', rawData, args.requestId);
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
                    const intelligence = DashboardCache.process('integrity', rawData, args.requestId);
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
                    const intelligence = DashboardCache.process('vendorperformance', rawData, args.requestId);
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
                    const intelligence = DashboardCache.process('customervalue', rawData, args.requestId);
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
                    const intelligence = DashboardCache.process('spendvelocity', rawData, args.requestId);
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
                    const result = DashboardCache.loadCollection(
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
                        const collectionResult = DashboardCache.loadCollection(
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
                            const metricResult = DashboardCache.getMetric(refId, args.metric_name);
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
                            data = DataStore.loadRows(requestId, refId, startRow, endRow);
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
                        enum: ['all', 'discovery', 'data', 'dashboards', 'reports', 'queries'],
                        description: 'Filter by tool category (default: all)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const category = args.category || 'all';

                const capabilities = {
                    discovery: {
                        description: 'Find entities and resolve IDs',
                        tools: [
                            { name: 'resolve_entity', purpose: 'Find customer, vendor, employee, item, project by name' },
                            { name: 'resolve_gl_account', purpose: 'Find GL account by name, number, or type' },
                            { name: 'resolve_classification', purpose: 'Find class, department, location, or subsidiary' }
                        ]
                    },
                    data: {
                        description: 'Get financial data and metrics',
                        tools: [
                            { name: 'get_cash_position', purpose: 'Current bank balances and cash position' },
                            { name: 'get_ap_aging', purpose: 'Accounts payable aging by vendor' },
                            { name: 'get_ar_aging', purpose: 'Accounts receivable aging by customer' },
                            { name: 'get_vendor_spend', purpose: 'Spending analysis by vendor' },
                            { name: 'get_customer_revenue', purpose: 'Revenue analysis by customer' },
                            { name: 'get_gl_activity', purpose: 'GL transactions by account/class/dept' },
                            { name: 'get_trial_balance', purpose: 'Account balances with debits/credits' },
                            { name: 'get_recent_transactions', purpose: 'Recent transactions filtered by type/entity' },
                            { name: 'get_expense_breakdown', purpose: 'Expenses by category' },
                            { name: 'compare_periods', purpose: 'Period over period comparison' },
                            { name: 'find_anomalies', purpose: 'Detect outliers and unusual patterns' }
                        ]
                    },
                    dashboards: {
                        description: 'Comprehensive pre-computed analysis',
                        tools: [
                            { name: 'dashboard_cashflow', purpose: 'Treasury: cash, runway, projections' },
                            { name: 'dashboard_health', purpose: 'Profitability: margins, ratios, health score' },
                            { name: 'dashboard_burden', purpose: 'Rate Engine: overhead, burden rates' },
                            { name: 'dashboard_time', purpose: 'Utilization: billable hours, productivity' },
                            { name: 'dashboard_integrity', purpose: 'Sentinel: fraud detection, anomalies' },
                            { name: 'dashboard_vendorperformance', purpose: 'Procurement: vendor analysis' },
                            { name: 'dashboard_customervalue', purpose: 'Revenue Intelligence: customer CLV, RFM' },
                            { name: 'dashboard_spendvelocity', purpose: 'Cost Dynamics: expense trends' },
                            { name: 'list_dashboards', purpose: 'List all available dashboards' }
                        ]
                    },
                    reports: {
                        description: 'Standard and custom reports',
                        tools: [
                            { name: 'run_report', purpose: 'Execute standard financial reports (P&L, Balance Sheet, etc.)' },
                            { name: 'list_reports', purpose: 'List available reports' },
                            { name: 'run_saved_search', purpose: 'Execute a saved search by ID' },
                            { name: 'list_saved_searches', purpose: 'Find available saved searches' }
                        ]
                    },
                    queries: {
                        description: 'Custom data queries',
                        tools: [
                            { name: 'run_custom_query', purpose: 'Execute custom SuiteQL query for specific data needs' }
                        ]
                    }
                };

                let result = {};
                if (category === 'all') {
                    result = capabilities;
                } else if (capabilities[category]) {
                    result[category] = capabilities[category];
                }

                const totalTools = Object.values(capabilities).reduce((sum, cat) => sum + cat.tools.length, 0);

                return {
                    success: true,
                    capabilities: result,
                    totalTools: totalTools,
                    categories: Object.keys(capabilities),
                    tip: 'Use list_dashboards, list_reports, or list_saved_searches for detailed discovery',
                    tool: 'list_capabilities'
                };
            },
            displayName: function(args) {
                return 'Listing capabilities...';
            }
        },

        list_reports: {
            name: 'list_reports',
            description: `List available reports that can be run with run_report.
Returns both standard financial reports and discovered custom reports.

Use this when:
- User asks "what reports are available?"
- You need to find a specific report type
- You want to see filtering options for reports`,
            parameters: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        enum: ['all', 'financial', 'operational', 'custom'],
                        description: 'Filter by report category (default: all)'
                    },
                    include_custom: {
                        type: 'boolean',
                        description: 'Include custom/saved report definitions (default: true)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const category = args.category || 'all';
                const includeCustom = args.include_custom !== false;

                log.debug('list_reports', { category: category, includeCustom: includeCustom });

                try {
                    // Standard reports available through run_report
                    const standardReports = {
                        financial: [
                            {
                                id: 'income_statement',
                                name: 'Income Statement (P&L)',
                                description: 'Profit & Loss report showing revenue, expenses, and net income',
                                parameters: ['period', 'subsidiary_id', 'class_id', 'department_id', 'location_id']
                            },
                            {
                                id: 'balance_sheet',
                                name: 'Balance Sheet',
                                description: 'Assets, liabilities, and equity as of a specific date',
                                parameters: ['period', 'subsidiary_id', 'class_id', 'department_id', 'location_id']
                            },
                            {
                                id: 'cash_flow',
                                name: 'Cash Flow Statement',
                                description: 'Cash inflows and outflows from operating, investing, and financing activities',
                                parameters: ['period', 'subsidiary_id']
                            },
                            {
                                id: 'trial_balance',
                                name: 'Trial Balance',
                                description: 'All account balances showing debits and credits',
                                parameters: ['period', 'subsidiary_id', 'class_id', 'department_id']
                            },
                            {
                                id: 'general_ledger',
                                name: 'General Ledger Detail',
                                description: 'Detailed GL transactions by account',
                                parameters: ['period', 'account_id', 'subsidiary_id']
                            }
                        ],
                        operational: [
                            {
                                id: 'ar_aging',
                                name: 'AR Aging Summary',
                                description: 'Accounts receivable aging by customer',
                                parameters: ['as_of_date', 'customer_id']
                            },
                            {
                                id: 'ap_aging',
                                name: 'AP Aging Summary',
                                description: 'Accounts payable aging by vendor',
                                parameters: ['as_of_date', 'vendor_id']
                            }
                        ]
                    };

                    // Build result based on category filter
                    let reports = [];

                    if (category === 'all' || category === 'financial') {
                        reports = reports.concat(standardReports.financial.map(r => ({
                            ...r,
                            category: 'financial',
                            type: 'standard'
                        })));
                    }

                    if (category === 'all' || category === 'operational') {
                        reports = reports.concat(standardReports.operational.map(r => ({
                            ...r,
                            category: 'operational',
                            type: 'standard'
                        })));
                    }

                    // Try to find custom reports (saved searches that act as reports)
                    let customReports = [];
                    if (includeCustom && (category === 'all' || category === 'custom')) {
                        try {
                            // Search for report-like saved searches
                            const reportSearch = search.create({
                                type: 'savedsearch',
                                filters: [
                                    ['isinactive', 'is', 'F'],
                                    'AND',
                                    ['ispublic', 'is', 'T'],
                                    'AND',
                                    [
                                        ['title', 'contains', 'report'],
                                        'OR',
                                        ['title', 'contains', 'summary'],
                                        'OR',
                                        ['title', 'contains', 'analysis'],
                                        'OR',
                                        ['title', 'contains', 'dashboard']
                                    ]
                                ],
                                columns: [
                                    search.createColumn({ name: 'internalid' }),
                                    search.createColumn({ name: 'title', sort: search.Sort.ASC }),
                                    search.createColumn({ name: 'recordtype' }),
                                    search.createColumn({ name: 'id' })
                                ]
                            });

                            reportSearch.run().each(function(result) {
                                customReports.push({
                                    id: result.getValue('id') || result.getValue('internalid'),
                                    name: result.getValue('title'),
                                    description: 'Custom saved search report on ' + (result.getText('recordtype') || result.getValue('recordtype') || 'records'),
                                    category: 'custom',
                                    type: 'saved_search',
                                    recordType: result.getText('recordtype') || result.getValue('recordtype'),
                                    parameters: ['filters (optional)']
                                });
                                return customReports.length < 25; // Limit custom reports
                            });
                        } catch (searchErr) {
                            log.debug('Could not search for custom reports', { error: searchErr.message });
                        }
                    }

                    reports = reports.concat(customReports);

                    return {
                        success: true,
                        reports: reports,
                        count: reports.length,
                        standardCount: reports.filter(r => r.type === 'standard').length,
                        customCount: customReports.length,
                        categories: category === 'all' ? ['financial', 'operational', 'custom'] : [category],
                        usage: 'Use run_report({ report_type: "report_id" }) for standard reports, or run_saved_search({ search_id: "id" }) for custom reports',
                        tool: 'list_reports'
                    };

                } catch (e) {
                    log.error('list_reports error', { error: e.message });

                    return {
                        success: false,
                        error: e.message,
                        tool: 'list_reports'
                    };
                }
            },
            displayName: function(args) {
                return 'Listing available reports...';
            }
        },

        run_report: {
            name: 'run_report',
            description: `Execute a financial report from NetSuite's standard reports or custom reports.
This executes the report and returns the data in a structured format.

Common report types:
- income_statement: Profit & Loss report
- balance_sheet: Balance Sheet report
- cash_flow: Cash Flow Statement
- ar_aging: AR Aging Summary
- ap_aging: AP Aging Summary
- trial_balance: Trial Balance
- general_ledger: GL Detail

Use parameters to filter by date range, subsidiary, class, department, etc.`,
            parameters: {
                type: 'object',
                properties: {
                    report_type: {
                        type: 'string',
                        description: 'Type of report to run',
                        enum: ['income_statement', 'balance_sheet', 'cash_flow', 'ar_aging', 'ap_aging', 'trial_balance', 'general_ledger', 'custom']
                    },
                    report_id: {
                        type: 'string',
                        description: 'For custom reports, the internal ID or script ID of the report'
                    },
                    period: {
                        type: 'string',
                        description: 'Time period: "this_month", "last_month", "this_quarter", "last_quarter", "ytd", "last_year", or specific dates as "YYYY-MM-DD to YYYY-MM-DD"'
                    },
                    subsidiary_id: {
                        type: 'number',
                        description: 'Filter by subsidiary internal ID'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Filter by class internal ID'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Filter by department internal ID'
                    },
                    location_id: {
                        type: 'number',
                        description: 'Filter by location internal ID'
                    }
                },
                required: ['report_type']
            },
            execute: function(args) {
                const reportType = args.report_type;
                const period = args.period || 'this_month';

                log.debug('run_report', { reportType: reportType, period: period });

                try {
                    // Map report types to our existing dashboard/data tools
                    // Since N/report is not available, we simulate reports using our data tools
                    let result;

                    switch (reportType) {
                        case 'income_statement':
                            // Use existing income statement query
                            const incomeSQL = `
                                SELECT
                                    account.accttype AS account_type,
                                    account.displaynamewithhierarchy AS account_name,
                                    SUM(CASE WHEN tal.credit IS NOT NULL THEN tal.credit ELSE 0 END) AS credit,
                                    SUM(CASE WHEN tal.debit IS NOT NULL THEN tal.debit ELSE 0 END) AS debit,
                                    SUM(COALESCE(tal.credit, 0) - COALESCE(tal.debit, 0)) AS net_amount
                                FROM transactionaccountingline tal
                                JOIN transaction t ON t.id = tal.transaction
                                JOIN account ON account.id = tal.account
                                WHERE t.posting = 'T'
                                AND account.accttype IN ('Income', 'COGS', 'Expense', 'OthIncome', 'OthExpense')
                                AND t.trandate >= ADD_MONTHS(TRUNC(SYSDATE, 'YEAR'), 0)
                                GROUP BY account.accttype, account.displaynamewithhierarchy
                                ORDER BY account.accttype, account.displaynamewithhierarchy
                                FETCH FIRST 500 ROWS ONLY
                            `;
                            result = QueryExecutor.executeQuery(incomeSQL);
                            result.reportType = 'Income Statement';
                            break;

                        case 'balance_sheet':
                            const balanceSQL = `
                                SELECT
                                    account.accttype AS account_type,
                                    account.displaynamewithhierarchy AS account_name,
                                    SUM(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS balance
                                FROM transactionaccountingline tal
                                JOIN transaction t ON t.id = tal.transaction
                                JOIN account ON account.id = tal.account
                                WHERE t.posting = 'T'
                                AND account.accttype IN ('Bank', 'AcctRec', 'OthCurrAsset', 'FixedAsset', 'OthAsset',
                                                         'AcctPay', 'CreditCard', 'OthCurrLiab', 'LongTermLiab',
                                                         'Equity', 'RetainEarn')
                                GROUP BY account.accttype, account.displaynamewithhierarchy
                                ORDER BY account.accttype, account.displaynamewithhierarchy
                                FETCH FIRST 500 ROWS ONLY
                            `;
                            result = QueryExecutor.executeQuery(balanceSQL);
                            result.reportType = 'Balance Sheet';
                            break;

                        case 'ar_aging':
                            // Delegate to existing get_ar_aging functionality
                            const arResult = DATA_TOOLS.get_ar_aging.execute({});
                            return {
                                success: arResult.success,
                                reportType: 'AR Aging Summary',
                                columns: arResult.columns,
                                rows: arResult.rows,
                                rowCount: arResult.rowCount,
                                tool: 'run_report'
                            };

                        case 'ap_aging':
                            // Delegate to existing get_ap_aging functionality
                            const apResult = DATA_TOOLS.get_ap_aging.execute({});
                            return {
                                success: apResult.success,
                                reportType: 'AP Aging Summary',
                                columns: apResult.columns,
                                rows: apResult.rows,
                                rowCount: apResult.rowCount,
                                tool: 'run_report'
                            };

                        case 'trial_balance':
                            const trialResult = DATA_TOOLS.get_trial_balance.execute({});
                            return {
                                success: trialResult.success,
                                reportType: 'Trial Balance',
                                columns: trialResult.columns,
                                rows: trialResult.rows,
                                rowCount: trialResult.rowCount,
                                tool: 'run_report'
                            };

                        case 'cash_flow':
                            // Use cash flow dashboard
                            const cashResult = DASHBOARD_TOOLS.dashboard_cashflow.execute({});
                            return {
                                success: cashResult.success,
                                reportType: 'Cash Flow Summary',
                                data: cashResult.data,
                                tool: 'run_report'
                            };

                        case 'general_ledger':
                            const glResult = DATA_TOOLS.get_gl_activity.execute({
                                period: period
                            });
                            return {
                                success: glResult.success,
                                reportType: 'General Ledger',
                                columns: glResult.columns,
                                rows: glResult.rows,
                                rowCount: glResult.rowCount,
                                tool: 'run_report'
                            };

                        case 'custom':
                            if (!args.report_id) {
                                return {
                                    success: false,
                                    error: 'report_id is required for custom reports',
                                    tool: 'run_report'
                                };
                            }
                            // For custom reports, try to run as a saved search
                            return UTILITY_TOOLS.run_saved_search.execute({
                                search_id: args.report_id,
                                max_results: 500
                            });

                        default:
                            return {
                                success: false,
                                error: 'Unknown report type: ' + reportType,
                                availableTypes: ['income_statement', 'balance_sheet', 'cash_flow', 'ar_aging', 'ap_aging', 'trial_balance', 'general_ledger', 'custom'],
                                tool: 'run_report'
                            };
                    }

                    const formatted = formatResult(result, 'run_report');
                    formatted.reportType = result.reportType || reportType;
                    return formatted;

                } catch (e) {
                    log.error('run_report error', {
                        reportType: reportType,
                        error: e.message
                    });

                    return {
                        success: false,
                        error: e.message,
                        reportType: reportType,
                        tool: 'run_report'
                    };
                }
            },
            displayName: function(args) {
                return 'Running ' + (args.report_type || 'report') + '...';
            }
        },

        format_response: {
            name: 'format_response',
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
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get lightweight tool manifest (names + one-liners only)
     * Used by Streaming Agent for tool selection phase
     * @returns {object} Map of tool names to one-line descriptions
     */
    function getToolManifest() {
        return {
            // Discovery
            resolve_entity: "Find customer/vendor/employee by name → returns ID",
            resolve_gl_account: "Find GL account by name/number → returns ID",
            resolve_classification: "Find class/department/location/subsidiary → returns ID",

            // Customer/Revenue
            get_customer_revenue: "Revenue by customer for a period",
            get_top_customers: "Top N customers by revenue or transaction volume",

            // Vendor/Spend
            get_vendor_spend: "Spend by vendor for a period",
            get_top_vendors: "Top N vendors by spend amount",

            // Aging
            get_ar_aging: "AR aging buckets by customer (current, 1-30, 31-60, etc.)",
            get_ap_aging: "AP aging buckets by vendor",

            // GL & Financial Statements
            get_gl_activity: "GL account activity and transaction details",
            get_trial_balance: "Trial balance for a period",
            get_income_statement: "Income statement / P&L report",
            get_balance_sheet: "Balance sheet at a point in time",

            // Transactions
            get_recent_transactions: "Recent transactions with optional filters",
            get_transaction_detail: "Details of a specific transaction by ID",

            // Analysis
            compare_periods: "Compare two time periods (YoY, MoM, etc.)",
            get_revenue_by_month: "Monthly revenue trend with optional YoY comparison",
            find_anomalies: "Find unusual transactions or patterns",
            get_cash_position: "Current cash and bank account balances",
            get_expense_breakdown: "Expenses by category or account",

            // Dashboards
            dashboard_cashflow: "Cash flow metrics and projections",
            dashboard_health: "Financial health indicators",
            dashboard_burden: "Administrative burden metrics",
            dashboard_time: "Time-based financial trends",
            dashboard_integrity: "Data integrity checks",
            dashboard_vendorperformance: "Vendor performance analytics",
            dashboard_customervalue: "Customer value and lifetime metrics",
            dashboard_spendvelocity: "Spending velocity and trends",
            list_dashboards: "List all available dashboards",

            // Utility
            get_fiscal_context: "Current fiscal period and date info",
            run_custom_query: "Execute custom SuiteQL query",
            run_saved_search: "Run a NetSuite saved search by ID",
            list_saved_searches: "List available saved searches",
            run_report: "Run a standard financial report",
            list_reports: "List available report types",
            list_capabilities: "List all advisor capabilities",
            explore_schema: "Explore NetSuite record schema",
            format_response: "Format final response with rich blocks"
        };
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
