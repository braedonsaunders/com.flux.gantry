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
    './Lib_Advisor_EntityResolver',
    './Lib_Advisor_QueryExecutor',
    './Lib_Advisor_Utils',
    '../Lib_Dashboard_Registry',
    '../Lib_Config'
], function(
    log,
    EntityResolver,
    QueryExecutor,
    Utils,
    DashboardRegistry,
    ConfigLib
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
     * Build date filter based on period string
     */
    function buildPeriodFilter(period, dateField) {
        dateField = dateField || 'transaction.trandate';
        const periodFilters = {
            'today': `${dateField} = CURRENT_DATE`,
            'yesterday': `${dateField} = CURRENT_DATE - 1`,
            'this_week': `${dateField} >= TRUNC(CURRENT_DATE, 'IW')`,
            'last_week': `${dateField} >= TRUNC(CURRENT_DATE, 'IW') - 7 AND ${dateField} < TRUNC(CURRENT_DATE, 'IW')`,
            'this_month': `${dateField} >= TRUNC(CURRENT_DATE, 'MM')`,
            'last_month': `${dateField} >= ADD_MONTHS(TRUNC(CURRENT_DATE, 'MM'), -1) AND ${dateField} < TRUNC(CURRENT_DATE, 'MM')`,
            'this_quarter': `${dateField} >= TRUNC(CURRENT_DATE, 'Q')`,
            'last_quarter': `${dateField} >= ADD_MONTHS(TRUNC(CURRENT_DATE, 'Q'), -3) AND ${dateField} < TRUNC(CURRENT_DATE, 'Q')`,
            'ytd': `${dateField} >= TRUNC(CURRENT_DATE, 'YYYY')`,
            'last_30_days': `${dateField} >= CURRENT_DATE - 30`,
            'last_60_days': `${dateField} >= CURRENT_DATE - 60`,
            'last_90_days': `${dateField} >= CURRENT_DATE - 90`,
            'last_365_days': `${dateField} >= CURRENT_DATE - 365`
        };
        return periodFilters[period] || periodFilters['last_90_days'];
    }

    /**
     * Format query result for LLM consumption
     */
    function formatResult(result, toolName) {
        if (!result.success) {
            return {
                success: false,
                error: result.error || 'Query failed',
                tool: toolName
            };
        }

        return {
            success: true,
            rowCount: result.rows ? result.rows.length : 0,
            columns: result.columns || [],
            rows: result.rows || [],
            tool: toolName
        };
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
Examples: "Oracle", "John Smith", "Widget Pro", "Project Alpha"`,
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
                        description: 'Expected entity type. Use "auto" to search all types.'
                    }
                },
                required: ['term']
            },
            execute: function(args) {
                const term = args.term;
                const typeHint = args.type_hint || 'auto';

                try {
                    const result = EntityResolver.resolveEntityWithFallback(term, typeHint);

                    if (result.resolved && result.entity) {
                        return {
                            success: true,
                            found: true,
                            entity: {
                                id: result.entity.id,
                                name: result.entity.name,
                                type: result.actualType || 'unknown'
                            },
                            confidence: result.confidence || 1.0,
                            tool: 'resolve_entity'
                        };
                    } else {
                        return {
                            success: true,
                            found: false,
                            searchTerm: term,
                            typeHint: typeHint,
                            message: `No entity found matching "${term}"`,
                            tool: 'resolve_entity'
                        };
                    }
                } catch (e) {
                    return {
                        success: false,
                        error: e.message,
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
                const term = escapeSql(args.term);
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
                            LOWER(account.accountsearchdisplayname) LIKE '%${termLower}%'
                            OR account.acctnumber LIKE '%${term}%'
                            OR LOWER(account.accttype) = '${termLower}'
                        )
                    ORDER BY
                        CASE
                            WHEN LOWER(account.accountsearchdisplayname) = '${termLower}' THEN 0
                            WHEN LOWER(account.accountsearchdisplayname) LIKE '${termLower}%' THEN 1
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
                const termLower = term.toLowerCase();
                const dimension = args.dimension || 'auto';

                // Build queries for each dimension
                const queries = [];

                if (dimension === 'auto' || dimension === 'class') {
                    queries.push(`
                        SELECT id, name, 'class' AS dimension_type
                        FROM classification
                        WHERE isinactive = 'F'
                            AND LOWER(name) LIKE '%${termLower}%'
                    `);
                }

                if (dimension === 'auto' || dimension === 'location') {
                    queries.push(`
                        SELECT id, name, 'location' AS dimension_type
                        FROM location
                        WHERE isinactive = 'F'
                            AND LOWER(name) LIKE '%${termLower}%'
                    `);
                }

                if (dimension === 'auto' || dimension === 'department') {
                    queries.push(`
                        SELECT id, name, 'department' AS dimension_type
                        FROM department
                        WHERE isinactive = 'F'
                            AND LOWER(name) LIKE '%${termLower}%'
                    `);
                }

                if (dimension === 'auto' || dimension === 'subsidiary') {
                    queries.push(`
                        SELECT id, name, 'subsidiary' AS dimension_type
                        FROM subsidiary
                        WHERE isinactive = 'F'
                            AND LOWER(name) LIKE '%${termLower}%'
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
            description: `Get available fields and relationships for a NetSuite table.
Use this to understand what data is available before writing custom queries.
Only use when specific data tools don't provide what you need.`,
            parameters: {
                type: 'object',
                properties: {
                    table: {
                        type: 'string',
                        enum: ['transaction', 'transactionline', 'transactionaccountingline',
                               'customer', 'vendor', 'employee', 'item', 'account',
                               'classification', 'department', 'location', 'subsidiary',
                               'accountingperiod', 'project'],
                        description: 'Table name to explore'
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
Use for: "AP aging", "what do we owe", "overdue bills", "vendor balances"`,
            parameters: {
                type: 'object',
                properties: {
                    vendor_id: {
                        type: 'number',
                        description: 'Optional: filter to specific vendor ID'
                    }
                },
                required: []
            },
            execute: function(args) {
                const vendorFilter = args.vendor_id ? `AND transaction.entity = ${args.vendor_id}` : '';

                const query = `
                    SELECT
                        vendor.id AS vendor_id,
                        vendor.companyname AS vendor_name,
                        SUM(transaction.foreignamountunpaid) AS total_unpaid,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END) AS current_amount,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 1 AND 30 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_1_30,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_31_60,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_61_90,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_over_90
                    FROM transaction
                    INNER JOIN vendor ON transaction.entity = vendor.id
                    WHERE transaction.type = 'VendBill'
                        AND transaction.foreignamountunpaid != 0
                        AND transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        ${vendorFilter}
                    GROUP BY vendor.id, vendor.companyname
                    ORDER BY total_unpaid DESC
                    FETCH FIRST 50 ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_ap_aging');
            },
            displayName: function(args) {
                return args.vendor_id ? 'Getting vendor AP details...' : 'Getting AP aging summary...';
            }
        },

        get_ar_aging: {
            name: 'get_ar_aging',
            description: `Get accounts receivable aging summary by bucket (Current, 1-30, 31-60, 61-90, 90+).
Shows what customers owe us, broken down by how overdue.
Use for: "AR aging", "what are we owed", "overdue invoices", "customer balances"`,
            parameters: {
                type: 'object',
                properties: {
                    customer_id: {
                        type: 'number',
                        description: 'Optional: filter to specific customer ID'
                    }
                },
                required: []
            },
            execute: function(args) {
                const customerFilter = args.customer_id ? `AND transaction.entity = ${args.customer_id}` : '';

                const query = `
                    SELECT
                        customer.id AS customer_id,
                        customer.companyname AS customer_name,
                        SUM(transaction.foreignamountunpaid) AS total_unpaid,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END) AS current_amount,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 1 AND 30 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_1_30,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_31_60,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_61_90,
                        SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_over_90
                    FROM transaction
                    INNER JOIN customer ON transaction.entity = customer.id
                    WHERE transaction.type = 'CustInvc'
                        AND transaction.foreignamountunpaid != 0
                        AND transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        ${customerFilter}
                    GROUP BY customer.id, customer.companyname
                    ORDER BY total_unpaid DESC
                    FETCH FIRST 50 ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_ar_aging');
            },
            displayName: function(args) {
                return args.customer_id ? 'Getting customer AR details...' : 'Getting AR aging summary...';
            }
        },

        get_vendor_spend: {
            name: 'get_vendor_spend',
            description: `Get vendor spending analysis.
Shows total spend by vendor for a given period.
Use for: "vendor spend", "who do we pay most", "top vendors", "AP by vendor"`,
            parameters: {
                type: 'object',
                properties: {
                    vendor_id: {
                        type: 'number',
                        description: 'Optional: filter to specific vendor ID'
                    },
                    period: {
                        type: 'string',
                        enum: ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'ytd', 'last_30_days', 'last_90_days', 'last_365_days'],
                        description: 'Time period (default: last_90_days)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Max vendors to return (default: 25)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const vendorFilter = args.vendor_id ? `AND transaction.entity = ${args.vendor_id}` : '';
                const periodFilter = buildPeriodFilter(args.period || 'last_90_days');
                const limit = args.limit || 25;

                const query = `
                    SELECT
                        vendor.id AS vendor_id,
                        vendor.companyname AS vendor_name,
                        COUNT(DISTINCT transaction.id) AS transaction_count,
                        SUM(ABS(transaction.foreigntotal)) AS total_spend,
                        MIN(transaction.trandate) AS first_transaction,
                        MAX(transaction.trandate) AS last_transaction
                    FROM transaction
                    INNER JOIN vendor ON transaction.entity = vendor.id
                    WHERE transaction.type IN ('VendBill', 'VendCred')
                        AND transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        AND ${periodFilter}
                        ${vendorFilter}
                    GROUP BY vendor.id, vendor.companyname
                    ORDER BY total_spend DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_vendor_spend');
            },
            displayName: function(args) {
                return 'Analyzing vendor spending...';
            }
        },

        get_customer_revenue: {
            name: 'get_customer_revenue',
            description: `Get customer revenue analysis.
Shows total revenue by customer for a given period.
Use for: "customer revenue", "top customers", "sales by customer"`,
            parameters: {
                type: 'object',
                properties: {
                    customer_id: {
                        type: 'number',
                        description: 'Optional: filter to specific customer ID'
                    },
                    period: {
                        type: 'string',
                        enum: ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'ytd', 'last_30_days', 'last_90_days', 'last_365_days'],
                        description: 'Time period (default: last_90_days)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Max customers to return (default: 25)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const customerFilter = args.customer_id ? `AND transaction.entity = ${args.customer_id}` : '';
                const periodFilter = buildPeriodFilter(args.period || 'last_90_days');
                const limit = args.limit || 25;

                const query = `
                    SELECT
                        customer.id AS customer_id,
                        customer.companyname AS customer_name,
                        COUNT(DISTINCT transaction.id) AS transaction_count,
                        SUM(transaction.foreigntotal) AS total_revenue,
                        MIN(transaction.trandate) AS first_transaction,
                        MAX(transaction.trandate) AS last_transaction
                    FROM transaction
                    INNER JOIN customer ON transaction.entity = customer.id
                    WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                        AND transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        AND ${periodFilter}
                        ${customerFilter}
                    GROUP BY customer.id, customer.companyname
                    ORDER BY total_revenue DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_customer_revenue');
            },
            displayName: function(args) {
                return 'Analyzing customer revenue...';
            }
        },

        get_gl_activity: {
            name: 'get_gl_activity',
            description: `Get GL (General Ledger) transaction activity.
Shows transactions and their GL impact filtered by account, class, location, and/or period.
Use for: "GL activity", "account activity", "what hit this account", "GL variance", "class expenses"`,
            parameters: {
                type: 'object',
                properties: {
                    account_id: {
                        type: 'number',
                        description: 'GL account ID to filter by'
                    },
                    class_id: {
                        type: 'number',
                        description: 'Class ID to filter by'
                    },
                    department_id: {
                        type: 'number',
                        description: 'Department ID to filter by'
                    },
                    location_id: {
                        type: 'number',
                        description: 'Location ID to filter by'
                    },
                    period: {
                        type: 'string',
                        enum: ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'ytd', 'last_30_days', 'last_90_days'],
                        description: 'Time period (default: last_90_days)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Max transactions to return (default: 50)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const filters = [];
                if (args.account_id) filters.push(`tal.account = ${args.account_id}`);
                if (args.class_id) filters.push(`tl.class = ${args.class_id}`);
                if (args.department_id) filters.push(`tl.department = ${args.department_id}`);
                if (args.location_id) filters.push(`tl.location = ${args.location_id}`);

                const periodFilter = buildPeriodFilter(args.period || 'last_90_days');
                const limit = args.limit || 50;

                const query = `
                    SELECT
                        transaction.id AS transaction_id,
                        transaction.tranid AS document_number,
                        transaction.type AS transaction_type,
                        transaction.trandate,
                        transaction.memo,
                        account.acctnumber AS account_number,
                        account.accountsearchdisplayname AS account_name,
                        BUILTIN.DF(tl.class) AS class_name,
                        BUILTIN.DF(tl.department) AS department_name,
                        tal.debit,
                        tal.credit,
                        (COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) AS net_amount
                    FROM transactionaccountingline tal
                    INNER JOIN transaction ON tal.transaction = transaction.id
                    INNER JOIN account ON tal.account = account.id
                    LEFT JOIN transactionline tl ON tl.transaction = transaction.id AND tl.mainline = 'F'
                    WHERE transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        AND ${periodFilter}
                        ${filters.length > 0 ? 'AND ' + filters.join(' AND ') : ''}
                    ORDER BY ABS(COALESCE(tal.debit, 0) - COALESCE(tal.credit, 0)) DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_gl_activity');
            },
            displayName: function(args) {
                return 'Pulling GL activity...';
            }
        },

        get_trial_balance: {
            name: 'get_trial_balance',
            description: `Get trial balance - account balances as of now.
Shows all accounts with their debit/credit totals.
Use for: "trial balance", "account balances", "GL balances"`,
            parameters: {
                type: 'object',
                properties: {
                    account_type: {
                        type: 'string',
                        enum: ['Bank', 'AcctRec', 'OthCurrAsset', 'FixedAsset', 'AcctPay',
                               'OthCurrLiab', 'LongTermLiab', 'Equity', 'Income', 'COGS', 'Expense'],
                        description: 'Optional: filter by account type'
                    }
                },
                required: []
            },
            execute: function(args) {
                const typeFilter = args.account_type ?
                    `AND account.accttype = '${escapeSql(args.account_type)}'` : '';

                const query = `
                    SELECT
                        account.acctnumber AS account_number,
                        account.accountsearchdisplayname AS account_name,
                        account.accttype AS account_type,
                        account.balance AS balance
                    FROM account
                    WHERE account.isinactive = 'F'
                        ${typeFilter}
                    ORDER BY account.acctnumber
                    FETCH FIRST 200 ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_trial_balance');
            },
            displayName: function(args) {
                return 'Getting trial balance...';
            }
        },

        get_recent_transactions: {
            name: 'get_recent_transactions',
            description: `Get recent transactions, optionally filtered by type or entity.
Use for: "recent transactions", "latest invoices", "recent bills", "show transactions"`,
            parameters: {
                type: 'object',
                properties: {
                    transaction_type: {
                        type: 'string',
                        enum: ['CustInvc', 'CustPymt', 'CashSale', 'VendBill', 'VendPymt',
                               'VendCred', 'CustCred', 'Journal', 'Check', 'Deposit'],
                        description: 'Filter by transaction type'
                    },
                    entity_id: {
                        type: 'number',
                        description: 'Filter by customer/vendor ID'
                    },
                    period: {
                        type: 'string',
                        enum: ['today', 'this_week', 'this_month', 'last_30_days'],
                        description: 'Time period (default: last_30_days)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Max transactions to return (default: 25)'
                    }
                },
                required: []
            },
            execute: function(args) {
                const typeFilter = args.transaction_type ?
                    `AND transaction.type = '${escapeSql(args.transaction_type)}'` : '';
                const entityFilter = args.entity_id ?
                    `AND transaction.entity = ${args.entity_id}` : '';
                const periodFilter = buildPeriodFilter(args.period || 'last_30_days');
                const limit = args.limit || 25;

                const query = `
                    SELECT
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
                    WHERE transaction.posting = 'T'
                        AND transaction.voided = 'F'
                        AND ${periodFilter}
                        ${typeFilter}
                        ${entityFilter}
                    ORDER BY transaction.trandate DESC, transaction.id DESC
                    FETCH FIRST ${limit} ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'get_recent_transactions');
            },
            displayName: function(args) {
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
Use for: "variance analysis", "compare to last month", "YoY change", "period comparison"`,
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
                        description: 'First period in YYYY-MM format (e.g., "2024-10")'
                    },
                    period2: {
                        type: 'string',
                        description: 'Second period in YYYY-MM format (e.g., "2024-11")'
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
                        enum: ['last_30_days', 'last_90_days', 'last_365_days', 'ytd'],
                        description: 'Period to analyze (default: last_90_days)'
                    }
                },
                required: ['data_type']
            },
            execute: function(args) {
                const periodFilter = buildPeriodFilter(args.period || 'last_90_days');
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
                        FETCH FIRST 20 ROWS ONLY
                    `;

                    const result = QueryExecutor.executeQuery(query);
                    return formatResult(result, 'find_anomalies');
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
                        FETCH FIRST 20 ROWS ONLY
                    `;

                    const result = QueryExecutor.executeQuery(query);
                    return formatResult(result, 'find_anomalies');
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
                    FETCH FIRST 20 ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                return formatResult(result, 'find_anomalies');
            },
            displayName: function(args) {
                return 'Looking for anomalies...';
            }
        },

        get_cash_position: {
            name: 'get_cash_position',
            description: `Get current cash position across all bank accounts.
Use for: "cash balance", "how much cash", "bank balances", "cash on hand"`,
            parameters: {
                type: 'object',
                properties: {},
                required: []
            },
            execute: function(args) {
                const query = `
                    SELECT
                        account.id AS account_id,
                        account.accountsearchdisplayname AS account_name,
                        BUILTIN.DF(account.subsidiary) AS subsidiary,
                        account.balance AS balance
                    FROM account
                    WHERE account.accttype = 'Bank'
                        AND account.isinactive = 'F'
                    ORDER BY account.balance DESC
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_cash_position');

                // Calculate total
                if (formatted.success && formatted.rows) {
                    formatted.totalCash = formatted.rows.reduce((sum, row) => sum + (row.balance || 0), 0);
                }

                return formatted;
            },
            displayName: function(args) {
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
                        enum: ['this_month', 'last_month', 'this_quarter', 'ytd', 'last_90_days'],
                        description: 'Time period (default: ytd)'
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
                    FETCH FIRST 30 ROWS ONLY
                `;

                const result = QueryExecutor.executeQuery(query);
                const formatted = formatResult(result, 'get_expense_breakdown');

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
                    // Import the data module dynamically
                    const CashflowData = require('../Lib_Cashflow_Data');
                    const data = CashflowData.getData(args);

                    return {
                        success: true,
                        dashboard: 'cashflow',
                        data: data,
                        schema: DashboardRegistry.getDashboard('cashflow').dataSchema,
                        tool: 'dashboard_cashflow'
                    };
                } catch (e) {
                    log.error('dashboard_cashflow failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
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

Use for: "financial health", "profitability", "margins", "how are we doing", "P&L summary", "health score"`,
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
                    const HealthData = require('../Lib_Health_Data');
                    const data = HealthData.getData(args);

                    return {
                        success: true,
                        dashboard: 'health',
                        data: data,
                        schema: DashboardRegistry.getDashboard('health').dataSchema,
                        tool: 'dashboard_health'
                    };
                } catch (e) {
                    log.error('dashboard_health failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
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
                    const BurdenData = require('../Lib_Burden_Data');
                    const data = BurdenData.getData(args);

                    return {
                        success: true,
                        dashboard: 'burden',
                        data: data,
                        schema: DashboardRegistry.getDashboard('burden').dataSchema,
                        tool: 'dashboard_burden'
                    };
                } catch (e) {
                    log.error('dashboard_burden failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
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
                    const TimeData = require('../Lib_Time_Data');
                    const data = TimeData.getData(args);

                    return {
                        success: true,
                        dashboard: 'time',
                        data: data,
                        schema: DashboardRegistry.getDashboard('time').dataSchema,
                        tool: 'dashboard_time'
                    };
                } catch (e) {
                    log.error('dashboard_time failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
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
                    const IntegrityData = require('../Lib_Integrity_Data');
                    const data = IntegrityData.getData(args);

                    return {
                        success: true,
                        dashboard: 'integrity',
                        data: data,
                        schema: DashboardRegistry.getDashboard('integrity').dataSchema,
                        tool: 'dashboard_integrity'
                    };
                } catch (e) {
                    log.error('dashboard_integrity failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
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
                    const VendorData = require('../Lib_VendorPerformance_Data');
                    const data = VendorData.getData(args);

                    return {
                        success: true,
                        dashboard: 'vendorperformance',
                        data: data,
                        schema: DashboardRegistry.getDashboard('vendorperformance').dataSchema,
                        tool: 'dashboard_vendorperformance'
                    };
                } catch (e) {
                    log.error('dashboard_vendorperformance failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
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
                    const CustomerData = require('../Lib_CustomerValue_Data');
                    const data = CustomerData.getData(args);

                    return {
                        success: true,
                        dashboard: 'customervalue',
                        data: data,
                        schema: DashboardRegistry.getDashboard('customervalue').dataSchema,
                        tool: 'dashboard_customervalue'
                    };
                } catch (e) {
                    log.error('dashboard_customervalue failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
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
                    const VelocityData = require('../Lib_SpendVelocity_Data');
                    const data = VelocityData.getData(args);

                    return {
                        success: true,
                        dashboard: 'spendvelocity',
                        data: data,
                        schema: DashboardRegistry.getDashboard('spendvelocity').dataSchema,
                        tool: 'dashboard_spendvelocity'
                    };
                } catch (e) {
                    log.error('dashboard_spendvelocity failed', { error: e.message });
                    return {
                        success: false,
                        error: e.message,
                        tool: 'dashboard_spendvelocity'
                    };
                }
            },
            displayName: function(args) {
                return 'Analyzing spend velocity...';
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

        run_custom_query: {
            name: 'run_custom_query',
            description: `Execute a custom SuiteQL query when no other tool provides the needed data.
USE SPARINGLY - prefer specific data tools when available.
Only use for complex queries that combine multiple data sources.

IMPORTANT SuiteQL notes:
- Use transaction.foreigntotal, NOT transaction.amount (not exposed)
- Use transaction.foreignamountunpaid for unpaid amounts
- Use transactionaccountingline for GL-level debit/credit data
- Always include posting = 'T' AND voided = 'F' filters
- Use BUILTIN.DF() to get display names for foreign key fields`,
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

    // Public API
    return {
        // Tool execution
        getToolDefinitions: getToolDefinitions,
        executeTool: executeTool,
        getTool: getTool,
        getToolDisplayName: getToolDisplayName,
        listToolsByCategory: listToolsByCategory,

        // Individual tool categories (for direct access if needed)
        DISCOVERY_TOOLS: DISCOVERY_TOOLS,
        DATA_TOOLS: DATA_TOOLS,
        DASHBOARD_TOOLS: DASHBOARD_TOOLS,
        UTILITY_TOOLS: UTILITY_TOOLS,
        ALL_TOOLS: ALL_TOOLS
    };
});
