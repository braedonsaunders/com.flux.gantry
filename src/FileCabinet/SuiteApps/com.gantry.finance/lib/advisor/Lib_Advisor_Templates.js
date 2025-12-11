/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * NOTE: This file is not directly used by the v2 architecture
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The v2 architecture (Lib_Advisor_Agent.js, Lib_Advisor_Tools.js) uses
 * pre-optimized tool functions instead of matching query templates.
 *
 * However, this file remains valuable as:
 * - Reference for validated SuiteQL queries
 * - Documentation of SuiteQL field limitations
 * - Template patterns for creating new tools
 *
 * When adding new tools to Lib_Advisor_Tools.js, these templates serve as
 * tested query patterns that are known to work in NetSuite.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Lib_Advisor_Templates.js
 * Curated SuiteQL query templates for common financial questions
 *
 * Total: 50 templates covering:
 * - Cash & Liquidity (4)
 * - Accounts Receivable (5)
 * - Accounts Payable (4)
 * - Revenue & Sales (7)
 * - Profitability (3)
 * - Expenses (4)
 * - Orders (3)
 * - Employees (3)
 * - General Ledger (3)
 * - Inventory (2)
 * - Projects (2)
 * - Transaction Lookup (10) - NEW
 *
 * VALIDATED: All queries tested against SuiteQL - November 2024
 *
 * IMPORTANT FIELD NOTES (SuiteQL limitations):
 * - transaction.amount, transaction.amountremaining: NOT EXPOSED - use foreigntotal, foreignamountunpaid
 * - transactionline.amount, transactionline.account, transactionline.amountremaining: NOT EXPOSED
 * - transactionaccountingline.department: NOT EXPOSED - use transactionline.department via join
 * - item.type: NOT EXPOSED - use item.itemtype
 * - Use transactionaccountingline for GL-level amount/account data
 * - Use transaction.foreignamountunpaid for unpaid/remaining amounts
 */
define(['N/log'], function(log) {
    'use strict';

    /**
     * Query Templates Library
     */
    const TEMPLATES = [
        // ==========================================
        // CASH & LIQUIDITY
        // ==========================================
        {
            id: 'cash_position_current',
            name: 'Current Cash Position',
            description: 'Total cash across all bank accounts',
            category: 'CASH',
            keywords: ['cash', 'position', 'balance', 'bank', 'how much cash', 'cash on hand', 'liquidity', 'bank balance'],
            parameters: [],
            query: `
                SELECT 
                    account.accountsearchdisplayname AS account_name,
                    BUILTIN.DF(account.subsidiary) AS subsidiary,
                    account.balance AS balance
                FROM account
                WHERE account.accttype = 'Bank'
                    AND account.isinactive = 'F'
                ORDER BY account.balance DESC
            `,
            resultFormat: {
                type: 'table',
                columns: ['Account', 'Subsidiary', 'Balance'],
                formatting: { balance: 'currency' },
                showTotal: true,
                totalColumn: 'balance'
            },
            followUpSuggestions: [
                'How has our cash changed over the past 6 months?',
                'What are our largest upcoming payables?'
            ]
        },
        {
            id: 'cash_flow_by_period',
            name: 'Cash Flow Summary',
            description: 'Cash inflows and outflows by month',
            category: 'CASH',
            keywords: ['cash flow', 'inflows', 'outflows', 'cash movement', 'monthly cash'],
            parameters: [
                { name: 'months', type: 'number', required: false, default: 6 }
            ],
            query: `
                SELECT 
                    TO_CHAR(transaction.trandate, 'YYYY-MM') AS period,
                    SUM(CASE WHEN transaction.type IN ('CustPymt', 'Deposit', 'CashSale') THEN ABS(transaction.foreigntotal) ELSE 0 END) AS inflows,
                    SUM(CASE WHEN transaction.type IN ('VendPymt', 'Check', 'ExpRept') THEN ABS(transaction.foreigntotal) ELSE 0 END) AS outflows,
                    SUM(CASE WHEN transaction.type IN ('CustPymt', 'Deposit', 'CashSale') THEN ABS(transaction.foreigntotal) ELSE 0 END) - 
                    SUM(CASE WHEN transaction.type IN ('VendPymt', 'Check', 'ExpRept') THEN ABS(transaction.foreigntotal) ELSE 0 END) AS net_cash_flow
                FROM transaction
                WHERE transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    
                    AND transaction.trandate >= ADD_MONTHS(TRUNC(CURRENT_DATE, 'MM'), -6)
                    AND transaction.type IN ('CustPymt', 'Deposit', 'CashSale', 'VendPymt', 'Check', 'ExpRept')
                GROUP BY TO_CHAR(transaction.trandate, 'YYYY-MM')
                ORDER BY period
            `,
            resultFormat: {
                type: 'table',
                columns: ['Period', 'Inflows', 'Outflows', 'Net Cash Flow'],
                formatting: { inflows: 'currency', outflows: 'currency', net_cash_flow: 'currency' },
                chartOption: { type: 'bar', xAxis: 'period', series: ['inflows', 'outflows'], xLabel: 'Period', yLabel: 'Amount', yFormat: 'currency' }
            }
        },
        {
            id: 'largest_cash_receipts',
            name: 'Largest Cash Receipts',
            description: 'Top cash receipts in recent period',
            category: 'CASH',
            keywords: ['largest', 'receipts', 'deposits', 'biggest', 'cash received', 'payments received'],
            parameters: [
                { name: 'days', type: 'number', required: false, default: 30 },
                { name: 'limit', type: 'number', required: false, default: 20 }
            ],
            query: `
                SELECT 
                    transaction.trandate AS date,
                    transaction.tranid AS reference,
                    BUILTIN.DF(transaction.entity) AS customer,
                    transaction.type AS type,
                    transaction.foreigntotal AS amount
                FROM transaction
                WHERE transaction.type IN ('CustPymt', 'Deposit', 'CashSale')
                    AND transaction.trandate >= CURRENT_DATE - 30
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    
                ORDER BY transaction.foreigntotal DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Date', 'Reference', 'Customer', 'Type', 'Amount'],
                formatting: { date: 'date', amount: 'currency' }
            }
        },
        {
            id: 'largest_cash_disbursements',
            name: 'Largest Cash Disbursements',
            description: 'Top cash payments/disbursements',
            category: 'CASH',
            keywords: ['largest', 'payments', 'disbursements', 'spending', 'paid out', 'checks'],
            parameters: [
                { name: 'days', type: 'number', required: false, default: 30 },
                { name: 'limit', type: 'number', required: false, default: 20 }
            ],
            query: `
                SELECT 
                    transaction.trandate AS date,
                    transaction.tranid AS reference,
                    BUILTIN.DF(transaction.entity) AS vendor,
                    transaction.type AS type,
                    ABS(transaction.foreigntotal) AS amount
                FROM transaction
                WHERE transaction.type IN ('VendPymt', 'Check', 'CashRfnd', 'ExpRept')
                    AND transaction.trandate >= CURRENT_DATE - 30
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    
                ORDER BY ABS(transaction.foreigntotal) DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Date', 'Reference', 'Vendor', 'Type', 'Amount'],
                formatting: { date: 'date', amount: 'currency' }
            }
        },

        // ==========================================
        // ACCOUNTS RECEIVABLE
        // ==========================================
        {
            id: 'ar_aging_summary',
            name: 'AR Aging Summary',
            description: 'Accounts receivable aging by bucket with grand totals',
            category: 'AR',
            keywords: ['ar', 'aging', 'receivables', 'overdue', 'past due', 'outstanding invoices', 'owed to us'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(transaction.entity) AS customer,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END) AS current_bucket,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 1 AND 30 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_1_30,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_31_60,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_61_90,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_over_90,
                    SUM(transaction.foreignamountunpaid) AS total_outstanding,
                    SUM(SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END)) OVER() AS grand_total_current,
                    SUM(SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 0 THEN transaction.foreignamountunpaid ELSE 0 END)) OVER() AS grand_total_overdue,
                    SUM(SUM(transaction.foreignamountunpaid)) OVER() AS grand_total_ar
                FROM transaction
                WHERE transaction.type IN ('CustInvc', 'CustCred')
                    AND transaction.foreignamountunpaid != 0
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    
                GROUP BY BUILTIN.DF(transaction.entity)
                ORDER BY total_outstanding DESC
            `,
            resultFormat: {
                type: 'table',
                columns: ['Customer', 'Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days', 'Total'],
                formatting: { 
                    current_bucket: 'currency', days_1_30: 'currency', days_31_60: 'currency',
                    days_61_90: 'currency', days_over_90: 'currency', total_outstanding: 'currency'
                },
                showTotal: true,
                
                hideColumns: ['grand_total_current', 'grand_total_overdue', 'grand_total_ar']
            },
            followUpSuggestions: [
                'Which customers have the most overdue invoices?',
                'What is our average days sales outstanding?'
            ]
        },
        {
            id: 'ar_aging_totals',
            name: 'AR Aging Totals',
            description: 'Total AR by aging bucket (summary)',
            category: 'AR',
            keywords: ['total ar', 'receivables total', 'ar summary', 'how much ar'],
            parameters: [],
            query: `
                SELECT 
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END) AS current_bucket,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 1 AND 30 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_1_30,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_31_60,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_61_90,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_over_90,
                    SUM(transaction.foreignamountunpaid) AS total_ar
                FROM transaction
                WHERE transaction.type IN ('CustInvc', 'CustCred')
                    AND transaction.foreignamountunpaid != 0
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    
            `,
            resultFormat: {
                type: 'metric',
                primary: 'total_ar',
                breakdown: ['current_bucket', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90']
            }
        },
        {
            id: 'top_customers_ar',
            name: 'Top Customers by AR',
            description: 'Customers with highest outstanding AR',
            category: 'AR',
            keywords: ['top customers', 'who owes', 'largest ar', 'biggest receivables', 'top ar'],
            parameters: [
                { name: 'limit', type: 'number', required: false, default: 10 }
            ],
            query: `
                SELECT 
                    BUILTIN.DF(transaction.entity) AS customer,
                    COUNT(transaction.id) AS invoice_count,
                    MIN(transaction.duedate) AS oldest_due_date,
                    SUM(transaction.foreignamountunpaid) AS total_outstanding
                FROM transaction
                WHERE transaction.type IN ('CustInvc', 'CustCred')
                    AND transaction.foreignamountunpaid != 0
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    
                GROUP BY BUILTIN.DF(transaction.entity)
                ORDER BY total_outstanding DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Customer', 'Invoices', 'Oldest Due', 'Outstanding'],
                formatting: { oldest_due_date: 'date', total_outstanding: 'currency' }
            }
        },
        {
            id: 'days_sales_outstanding',
            name: 'Days Sales Outstanding',
            description: 'Calculate DSO',
            category: 'AR',
            keywords: ['dso', 'days sales outstanding', 'collection period', 'how fast collect'],
            parameters: [],
            query: `
                SELECT 
                    (SELECT SUM(foreignamountunpaid) FROM transaction WHERE type = 'CustInvc' AND foreignamountunpaid > 0 AND posting = 'T' AND voided = 'F') AS current_ar,
                    (SELECT SUM(foreigntotal) FROM transaction WHERE type = 'CustInvc' AND posting = 'T' AND voided = 'F' AND trandate >= CURRENT_DATE - 90) / 90 AS avg_daily_sales,
                    ROUND(
                        (SELECT SUM(foreignamountunpaid) FROM transaction WHERE type = 'CustInvc' AND foreignamountunpaid > 0 AND posting = 'T' AND voided = 'F') /
                        NULLIF((SELECT SUM(foreigntotal) FROM transaction WHERE type = 'CustInvc' AND posting = 'T' AND voided = 'F' AND trandate >= CURRENT_DATE - 90) / 90, 0)
                    , 1) AS dso
                FROM DUAL
            `,
            resultFormat: {
                type: 'metric',
                primary: 'dso',
                suffix: ' days'
            }
        },
        {
            id: 'recent_customer_payments',
            name: 'Recent Customer Payments',
            description: 'Customer payments received recently',
            category: 'AR',
            keywords: ['payments received', 'customer payments', 'recent payments', 'collections'],
            parameters: [
                { name: 'days', type: 'number', required: false, default: 30 }
            ],
            query: `
                SELECT 
                    transaction.trandate AS date,
                    transaction.tranid AS reference,
                    BUILTIN.DF(transaction.entity) AS customer,
                    transaction.foreigntotal AS amount
                FROM transaction
                WHERE transaction.type = 'CustPymt'
                    AND transaction.trandate >= CURRENT_DATE - 30
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Date', 'Reference', 'Customer', 'Amount'],
                formatting: { date: 'date', amount: 'currency' }
            }
        },
        {
            id: 'avg_days_to_pay',
            name: 'Average Days to Pay by Customer',
            description: 'Calculate how quickly customers pay their invoices by linking invoices to payments via NextTransactionLineLink',
            category: 'AR',
            complexity: 'medium',
            primary_table: 'NextTransactionLineLink',
            keywords: ['days to pay', 'payment speed', 'how long to pay', 'average payment time', 'payment history', 'slow payers', 'fast payers', 'customer payment behavior', 'collection speed', 'how quickly pay', 'quickly pay', 'pay invoices', 'invoice payment speed', 'how fast pay'],
            answers: [
                'How long does it take customers to pay?',
                'What is the average days to pay?',
                'Who are the slowest payers?',
                'Payment speed by customer',
                'How quickly does customer X pay?',
                'How fast do they pay invoices?'
            ],
            does_not_answer: [
                'DSO calculation (use days_sales_outstanding)',
                'Overdue invoices (use ar_aging templates)'
            ],
            parameters: [
                { name: 'months', type: 'number', required: false, default: 12, description: 'Months of history to analyze' }
            ],
            query: `
                SELECT 
                    BUILTIN.DF(inv.entity) AS customer_name,
                    inv.entity AS customer_id,
                    ROUND(AVG(pymt.trandate - inv.trandate), 1) AS avg_days_to_pay,
                    ROUND(AVG(pymt.trandate - inv.duedate), 1) AS avg_days_past_due,
                    COUNT(DISTINCT inv.id) AS invoices_analyzed,
                    MIN(pymt.trandate - inv.trandate) AS fastest_payment,
                    MAX(pymt.trandate - inv.trandate) AS slowest_payment
                FROM transaction inv
                INNER JOIN NextTransactionLineLink ntll ON ntll.previousdoc = inv.id
                INNER JOIN transaction pymt ON pymt.id = ntll.nextdoc AND pymt.type = 'CustPymt'
                WHERE inv.type = 'CustInvc'
                    AND inv.posting = 'T'
                    AND inv.voided = 'F'
                    AND inv.trandate >= ADD_MONTHS(CURRENT_DATE, -{months})
                GROUP BY inv.entity, BUILTIN.DF(inv.entity)
                HAVING COUNT(DISTINCT inv.id) >= 3
                ORDER BY avg_days_to_pay DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Customer', 'ID', 'Avg Days to Pay', 'Avg Days Past Due', 'Invoices', 'Fastest', 'Slowest'],
                formatting: { 
                    avg_days_to_pay: 'number', 
                    avg_days_past_due: 'number',
                    fastest_payment: 'number',
                    slowest_payment: 'number'
                }
            },
            followUpSuggestions: [
                'Show overdue invoices for this customer',
                'What is our overall DSO?',
                'Show payment history for a specific customer'
            ]
        },
        {
            id: 'customer_days_to_pay',
            name: 'Customer Days to Pay',
            description: 'Calculate how quickly a specific customer pays their invoices',
            category: 'AR',
            complexity: 'medium',
            primary_table: 'NextTransactionLineLink',
            keywords: ['how quickly pay', 'quickly pay', 'how fast pay', 'customer payment speed', 'days to pay customer', 'pay invoices speed'],
            answers: [
                'How quickly does customer X pay?',
                'How fast does customer pay their invoices?',
                'What is the average days to pay for customer?',
                'How long does it take customer to pay?'
            ],
            parameters: [
                { name: 'customer_id', type: 'integer', required: true, description: 'Customer ID from entity resolution' },
                { name: 'months', type: 'number', required: false, default: 12, description: 'Months of history to analyze' }
            ],
            query: `
                SELECT 
                    BUILTIN.DF(inv.entity) AS customer_name,
                    inv.entity AS customer_id,
                    ROUND(AVG(pymt.trandate - inv.trandate), 1) AS avg_days_to_pay,
                    ROUND(AVG(pymt.trandate - inv.duedate), 1) AS avg_days_past_due,
                    COUNT(DISTINCT inv.id) AS invoices_analyzed,
                    MIN(pymt.trandate - inv.trandate) AS fastest_payment,
                    MAX(pymt.trandate - inv.trandate) AS slowest_payment,
                    MIN(inv.trandate) AS first_invoice_date,
                    MAX(inv.trandate) AS last_invoice_date
                FROM transaction inv
                INNER JOIN NextTransactionLineLink ntll ON ntll.previousdoc = inv.id
                INNER JOIN transaction pymt ON pymt.id = ntll.nextdoc AND pymt.type = 'CustPymt'
                WHERE inv.type = 'CustInvc'
                    AND inv.posting = 'T'
                    AND inv.voided = 'F'
                    AND inv.trandate >= ADD_MONTHS(CURRENT_DATE, -{months})
                    AND inv.entity = {customer_id}
                GROUP BY inv.entity, BUILTIN.DF(inv.entity)
            `,
            resultFormat: {
                type: 'metric',
                primary: 'avg_days_to_pay',
                suffix: ' days',
                additionalMetrics: ['invoices_analyzed', 'fastest_payment', 'slowest_payment']
            },
            followUpSuggestions: [
                'Show recent invoices for this customer',
                'Compare to company average days to pay',
                'Show their payment history'
            ]
        },
        {
            id: 'customer_payment_history',
            name: 'Customer Payment History',
            description: 'Detailed payment history for a specific customer showing invoice-to-payment timing',
            category: 'AR',
            complexity: 'medium',
            primary_table: 'NextTransactionLineLink',
            keywords: ['customer payment history', 'payment details', 'invoice payments', 'when did they pay'],
            parameters: [
                { name: 'customer_id', type: 'number', required: true, description: 'Customer internal ID' }
            ],
            query: `
                SELECT 
                    inv.tranid AS invoice_number,
                    inv.trandate AS invoice_date,
                    inv.duedate AS due_date,
                    pymt.trandate AS payment_date,
                    (pymt.trandate - inv.trandate) AS days_to_pay,
                    (pymt.trandate - inv.duedate) AS days_past_due,
                    inv.foreigntotal AS invoice_amount
                FROM transaction inv
                INNER JOIN NextTransactionLineLink ntll ON ntll.previousdoc = inv.id
                INNER JOIN transaction pymt ON pymt.id = ntll.nextdoc AND pymt.type = 'CustPymt'
                WHERE inv.type = 'CustInvc'
                    AND inv.posting = 'T'
                    AND inv.voided = 'F'
                    AND inv.entity = {customer_id}
                    AND inv.trandate >= ADD_MONTHS(CURRENT_DATE, -24)
                ORDER BY inv.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Invoice #', 'Invoice Date', 'Due Date', 'Payment Date', 'Days to Pay', 'Days Past Due', 'Amount'],
                formatting: { 
                    invoice_date: 'date',
                    due_date: 'date',
                    payment_date: 'date',
                    invoice_amount: 'currency'
                }
            }
        },

        // ==========================================
        // ACCOUNTS PAYABLE
        // ==========================================
        {
            id: 'ap_aging_summary',
            name: 'AP Aging Summary',
            description: 'Accounts payable aging by bucket with grand totals',
            category: 'AP',
            keywords: ['ap', 'payables', 'aging', 'what we owe', 'bills due', 'vendor bills'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(transaction.entity) AS vendor,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END) AS current_bucket,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 1 AND 30 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_1_30,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 31 AND 60 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_31_60,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate BETWEEN 61 AND 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_61_90,
                    SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 90 THEN transaction.foreignamountunpaid ELSE 0 END) AS days_over_90,
                    SUM(transaction.foreignamountunpaid) AS total_outstanding,
                    SUM(SUM(CASE WHEN CURRENT_DATE - transaction.duedate <= 0 THEN transaction.foreignamountunpaid ELSE 0 END)) OVER() AS grand_total_current,
                    SUM(SUM(CASE WHEN CURRENT_DATE - transaction.duedate > 0 THEN transaction.foreignamountunpaid ELSE 0 END)) OVER() AS grand_total_overdue,
                    SUM(SUM(transaction.foreignamountunpaid)) OVER() AS grand_total_ap
                FROM transaction
                WHERE transaction.type IN ('VendBill', 'VendCred')
                    AND transaction.foreignamountunpaid != 0
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    
                GROUP BY BUILTIN.DF(transaction.entity)
                ORDER BY total_outstanding DESC
            `,
            resultFormat: {
                type: 'table',
                columns: ['Vendor', 'Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days', 'Total'],
                formatting: { 
                    current_bucket: 'currency', days_1_30: 'currency', days_31_60: 'currency',
                    days_61_90: 'currency', days_over_90: 'currency', total_outstanding: 'currency'
                },
                showTotal: true,
                
                hideColumns: ['grand_total_current', 'grand_total_overdue', 'grand_total_ap']
            }
        },
        {
            id: 'bills_due_this_week',
            name: 'Bills Due This Week',
            description: 'Vendor bills due in the next 7 days',
            category: 'AP',
            keywords: ['bills due', 'upcoming payments', 'due this week', 'payables due', 'what do we need to pay'],
            parameters: [],
            query: `
                SELECT 
                    transaction.duedate AS due_date,
                    transaction.tranid AS bill_number,
                    BUILTIN.DF(transaction.entity) AS vendor,
                    transaction.foreignamountunpaid AS amount_due,
                    SUM(transaction.foreignamountunpaid) OVER() AS grand_total_due
                FROM transaction
                WHERE transaction.type = 'VendBill'
                    AND transaction.foreignamountunpaid > 0
                    AND transaction.duedate BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    
                ORDER BY transaction.duedate, transaction.foreignamountunpaid DESC
            `,
            resultFormat: {
                type: 'table',
                columns: ['Due Date', 'Bill #', 'Vendor', 'Amount Due'],
                formatting: { due_date: 'date', amount_due: 'currency' },
                showTotal: true,
                totalColumn: 'amount_due',
                hideColumns: ['grand_total_due']
            }
        },
        {
            id: 'top_vendors_spend',
            name: 'Top Vendors by Spend',
            description: 'Vendors with highest spend this fiscal year (includes vendor credits)',
            category: 'AP',
            keywords: ['top vendors', 'biggest vendors', 'most spend', 'vendor spend', 'vendor spend ytd', 'who do we pay most'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(transaction.entity) AS vendor,
                    COUNT(DISTINCT transaction.id) AS bill_count,
                    SUM(
                        ABS(transaction.foreigntotal)
                        * (CASE WHEN transaction.type = 'VendCred' THEN -1 ELSE 1 END)
                    ) AS total_spend
                FROM transaction
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type IN ('VendBill', 'VendCred')
                    AND ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                GROUP BY BUILTIN.DF(transaction.entity)
                ORDER BY total_spend DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Vendor', 'Bill Count', 'Total Spend'],
                formatting: { total_spend: 'currency' }
            }
        },
        {
            id: 'days_payable_outstanding',
            name: 'Days Payable Outstanding',
            description: 'Calculate DPO',
            category: 'AP',
            keywords: ['dpo', 'days payable', 'payment period', 'how fast pay'],
            parameters: [],
            query: `
                SELECT 
                    (SELECT SUM(foreignamountunpaid) FROM transaction WHERE type = 'VendBill' AND foreignamountunpaid > 0 AND posting = 'T' AND voided = 'F') AS current_ap,
                    (SELECT SUM(ABS(foreigntotal)) FROM transaction WHERE type = 'VendBill' AND posting = 'T' AND voided = 'F' AND trandate >= CURRENT_DATE - 90) / 90 AS avg_daily_purchases,
                    ROUND(
                        (SELECT SUM(foreignamountunpaid) FROM transaction WHERE type = 'VendBill' AND foreignamountunpaid > 0 AND posting = 'T' AND voided = 'F') /
                        NULLIF((SELECT SUM(ABS(foreigntotal)) FROM transaction WHERE type = 'VendBill' AND posting = 'T' AND voided = 'F' AND trandate >= CURRENT_DATE - 90) / 90, 0)
                    , 1) AS dpo
                FROM DUAL
            `,
            resultFormat: {
                type: 'metric',
                primary: 'dpo',
                suffix: ' days'
            }
        },

        // ==========================================
        // REVENUE & SALES
        // ==========================================
        {
            id: 'revenue_by_month',
            name: 'Revenue by Month',
            description: 'Monthly revenue by accounting period (includes invoices, cash sales, minus credit memos)',
            category: 'REVENUE',
            keywords: ['revenue by month', 'monthly revenue', 'sales by month', 'monthly sales', 'revenue trend', 'sales trend', 'total sales ytd', 'total revenue ytd', 'ytd revenue', 'ytd sales', 'this year revenue', 'this year sales'],
            parameters: [],
            query: `
                SELECT 
                    TO_CHAR(ap.startdate, 'YYYY-MM') AS month,
                    ap.periodname AS period_name,
                    COUNT(DISTINCT transaction.id) AS invoice_count,
                    SUM(
                        CASE 
                            WHEN transaction.type = 'CustCred' THEN -1 * ABS(transaction.foreigntotal)
                            ELSE ABS(transaction.foreigntotal)
                        END
                    ) AS revenue
                FROM transaction
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                    AND ap.startdate >= TO_DATE('{fiscalYearStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                GROUP BY TO_CHAR(ap.startdate, 'YYYY-MM'), ap.periodname
                ORDER BY month
            `,
            resultFormat: {
                type: 'table',
                columns: ['Month', 'Period', 'Invoices', 'Revenue'],
                formatting: { revenue: 'currency' },
                showTotal: true,
                totalColumn: 'revenue',
                hideColumns: ['period_name'],
                chartOption: { type: 'line', xAxis: 'month', series: ['revenue'], xLabel: 'Month', yLabel: 'Revenue', yFormat: 'currency' }
            },
            followUpSuggestions: [
                'Show revenue by department',
                'Who are our top customers?',
                'Compare to last year'
            ]
        },
        {
            id: 'revenue_by_month_by_department',
            name: 'Revenue by Month by Department',
            description: 'Monthly revenue trend broken out by department (by accounting period)',
            category: 'REVENUE',
            keywords: ['revenue by month department', 'monthly revenue department', 'department monthly revenue', 'revenue trend by department', 'monthly department breakdown', 'department revenue pivot'],
            parameters: [],
            query: `
                SELECT 
                    TO_CHAR(ap.startdate, 'YYYY-MM') AS month,
                    BUILTIN.DF(transactionline.department) AS department,
                    SUM(-1 * transactionline.netamount) AS revenue
                FROM transactionline
                INNER JOIN transaction ON transactionline.transaction = transaction.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                    AND ap.startdate >= TO_DATE('{fiscalYearStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND transactionline.department IS NOT NULL
                    AND transactionline.mainline = 'F'
                GROUP BY TO_CHAR(ap.startdate, 'YYYY-MM'), BUILTIN.DF(transactionline.department)
                ORDER BY month, department
            `,
            resultFormat: {
                type: 'table',
                columns: ['Month', 'Department', 'Revenue'],
                formatting: { revenue: 'currency' },
                pivotConfig: {
                    enabled: true,
                    rowField: 'month',
                    columnField: 'department',
                    valueField: 'revenue',
                    showTotalColumn: true
                }
            },
            followUpSuggestions: [
                'Show total revenue by department',
                'Which department has the highest growth?',
                'Compare departments year over year'
            ]
        },
        {
            id: 'top_customers_revenue',
            name: 'Top Customers by Revenue',
            description: 'Highest revenue customers this fiscal year (net of credit memos)',
            category: 'REVENUE',
            keywords: ['top customers', 'best customers', 'biggest customers', 'customer revenue', 'who buys most', 'customer revenue ytd'],
            parameters: [
                { name: 'limit', type: 'number', required: false, default: 10 }
            ],
            query: `
                SELECT 
                    BUILTIN.DF(transaction.entity) AS customer,
                    COUNT(DISTINCT transaction.id) AS transaction_count,
                    SUM(
                        CASE 
                            WHEN transaction.type = 'CustCred' THEN -1 * ABS(transaction.foreigntotal)
                            ELSE ABS(transaction.foreigntotal)
                        END
                    ) AS total_revenue
                FROM transaction
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                    AND ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                GROUP BY BUILTIN.DF(transaction.entity)
                ORDER BY total_revenue DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Customer', 'Transactions', 'Total Revenue'],
                formatting: { total_revenue: 'currency' }
            }
        },
        {
            id: 'revenue_by_item',
            name: 'Revenue by Product',
            description: 'Revenue breakdown by item/product this fiscal year',
            category: 'REVENUE',
            keywords: ['product revenue', 'item sales', 'what sells', 'top products', 'best sellers', 'product revenue ytd'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(transactionline.item) AS item,
                    SUM(transactionline.quantity) AS quantity_sold,
                    SUM(-1 * transactionline.netamount) AS revenue
                FROM transactionline
                INNER JOIN transaction ON transactionline.transaction = transaction.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                    AND ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND transactionline.item IS NOT NULL
                    AND transactionline.mainline = 'F'
                GROUP BY BUILTIN.DF(transactionline.item)
                ORDER BY revenue DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Item', 'Qty Sold', 'Revenue'],
                formatting: { quantity_sold: 'number', revenue: 'currency' }
            }
        },
        {
            id: 'revenue_by_department',
            name: 'Revenue by Department',
            description: 'Revenue breakdown by department (by accounting period)',
            category: 'REVENUE',
            keywords: ['department revenue', 'sales by department', 'revenue by department', 'department sales', 'sales per department', 'by department', 'department breakdown', 'ytd by department', 'ytd department'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(transactionline.department) AS department,
                    COUNT(DISTINCT transaction.id) AS transaction_count,
                    SUM(-1 * transactionline.netamount) AS revenue
                FROM transactionline
                INNER JOIN transaction ON transactionline.transaction = transaction.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                    AND ap.startdate >= TO_DATE('{fiscalYearStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND transactionline.department IS NOT NULL
                    AND transactionline.mainline = 'F'
                GROUP BY BUILTIN.DF(transactionline.department)
                ORDER BY revenue DESC
            `,
            resultFormat: {
                type: 'table',
                columns: ['Department', 'Transactions', 'Revenue'],
                formatting: { revenue: 'currency' },
                chartOption: { type: 'pie', labelField: 'department', valueField: 'revenue', yFormat: 'currency' }
            },
            followUpSuggestions: [
                'Show P&L for a specific department',
                'Show me monthly revenue trend',
                'What are the top customers by department?'
            ]
        },
        {
            id: 'top_customers_by_department',
            name: 'Top Customers by Department',
            description: 'Top customers for a specific department by revenue. Use department ID (not name) from entity resolution.',
            category: 'REVENUE',
            keywords: ['top customers department', 'customers by department', 'best customers department', 'top customers for department', 'department customers', 'customers ytd department', 'who buys from department'],
            parameters: [
                { name: 'department_id', type: 'number', required: true, description: 'Department internal ID from entity resolution' },
                { name: 'fiscal_year', type: 'string', required: false, default: 'current', description: 'REQUIRED for comparisons: "current", "previous", "2 years ago", "3 years ago", or "-1", "-2", etc. MUST pass "previous" when querying last year.' }
            ],
            query: `
                SELECT 
                    transaction.entity AS customer_id,
                    BUILTIN.DF(transaction.entity) AS customer,
                    SUM(-1 * transactionline.netamount) AS revenue,
                    COUNT(DISTINCT transaction.id) AS invoice_count
                FROM transaction
                INNER JOIN transactionline ON transactionline.transaction = transaction.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type = 'CustInvc'
                    AND transactionline.mainline = 'F'
                    AND ap.startdate >= TO_DATE('{fiscalYearStart}', 'YYYY-MM-DD')
                    AND ap.enddate < TO_DATE('{fiscalYearEnd}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND transactionline.department = {department_id}
                GROUP BY transaction.entity, BUILTIN.DF(transaction.entity)
                HAVING SUM(-1 * transactionline.netamount) > 0
                ORDER BY revenue DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Customer ID', 'Customer', 'Revenue', 'Invoice Count'],
                formatting: { revenue: 'currency' }
            },
            followUpSuggestions: [
                'What items are selling best for this department?',
                'Show me monthly trend for this department',
                'Compare to other departments'
            ]
        },
        {
            id: 'department_performance',
            name: 'Department Performance',
            description: 'Performance metrics for all departments over the last 6 months (by accounting period)',
            category: 'REVENUE',
            keywords: ['department performance', 'how are departments doing', 'department trend', 'department metrics', 'department revenue trend'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(transactionline.department) AS department,
                    TO_CHAR(ap.startdate, 'YYYY-MM') AS month,
                    COUNT(DISTINCT transaction.id) AS transactions,
                    SUM(-1 * transactionline.netamount) AS revenue
                FROM transactionline
                INNER JOIN transaction ON transactionline.transaction = transaction.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                    AND ap.startdate >= ADD_MONTHS(CURRENT_DATE, -6)
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND transactionline.department IS NOT NULL
                    AND transactionline.mainline = 'F'
                GROUP BY BUILTIN.DF(transactionline.department), TO_CHAR(ap.startdate, 'YYYY-MM')
                ORDER BY department, month
            `,
            resultFormat: {
                type: 'table',
                columns: ['Department', 'Month', 'Transactions', 'Revenue'],
                formatting: { revenue: 'currency' },
                chartOption: { type: 'bar', xAxis: 'month', series: ['revenue'], xLabel: 'Month', yLabel: 'Revenue', yFormat: 'currency' }
            },
            followUpSuggestions: [
                'Who are the top customers for this department?',
                'Show expenses by department',
                'Compare departments'
            ]
        },
        {
            id: 'revenue_yoy_comparison',
            name: 'Revenue YoY Comparison',
            description: 'Compare revenue by accounting period to same period last year',
            category: 'REVENUE',
            keywords: ['yoy', 'year over year', 'compared to last year', 'growth', 'revenue trend'],
            parameters: [],
            query: `
                SELECT 
                    TO_CHAR(ap.startdate, 'MM') AS month_num,
                    TO_CHAR(ap.startdate, 'Mon') AS month_name,
                    SUM(CASE WHEN EXTRACT(YEAR FROM ap.startdate) = EXTRACT(YEAR FROM CURRENT_DATE) THEN transaction.foreigntotal ELSE 0 END) AS current_year,
                    SUM(CASE WHEN EXTRACT(YEAR FROM ap.startdate) = EXTRACT(YEAR FROM CURRENT_DATE) - 1 THEN transaction.foreigntotal ELSE 0 END) AS prior_year
                FROM transaction
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                    AND ap.startdate >= ADD_MONTHS(TRUNC(CURRENT_DATE, 'YYYY'), -12)
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                GROUP BY TO_CHAR(ap.startdate, 'MM'), TO_CHAR(ap.startdate, 'Mon')
                ORDER BY month_num
            `,
            resultFormat: {
                type: 'table',
                columns: ['Month', 'This Year', 'Last Year'],
                formatting: { current_year: 'currency', prior_year: 'currency' },
                chartOption: { type: 'grouped_bar', xAxis: 'month_name', series: [{ name: 'This Year', values: 'current_year' }, { name: 'Last Year', values: 'prior_year' }], xLabel: 'Month', yLabel: 'Revenue', yFormat: 'currency' }
            }
        },
        {
            id: 'customer_spend_yoy',
            name: 'Customer Spend Year-over-Year',
            description: 'Compare customer spending YTD vs same period last year',
            category: 'REVENUE',
            preferredEntityType: 'customer',
            keywords: ['customer spend', 'yoy customer', 'customer comparison', 'spend this year vs last year', 'invoices comparison', 'customer revenue yoy', 'compare invoices'],
            answers: [
                'Compare customer spend this year vs last year',
                'Show me YoY customer revenue',
                'Which customers spent more this year?'
            ],
            parameters: [
                { name: 'months', type: 'integer', required: false, default: 6, description: 'Number of months to look back for recent spend' },
                { name: 'years_back', type: 'integer', required: false, default: 1, description: 'Years back to compare' },
                { name: 'customerId', type: 'integer', required: false, description: 'Optional customer ID to filter for a specific customer' }
            ],
            query: `
                SELECT 
                    customer.id AS customer_id,
                    customer.companyname AS customer_name,
                    SUM(CASE WHEN ap.startdate >= ADD_MONTHS(CURRENT_DATE, -{months}) THEN transaction.foreigntotal ELSE 0 END) AS recent_spend,
                    SUM(CASE WHEN ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD') AND ap.enddate <= TO_DATE('{currentPeriodEnd}', 'YYYY-MM-DD') THEN transaction.foreigntotal ELSE 0 END) AS spend_this_ytd,
                    SUM(CASE WHEN ap.startdate >= TO_DATE('{priorPeriodStart}', 'YYYY-MM-DD') AND ap.enddate <= TO_DATE('{priorPeriodEnd}', 'YYYY-MM-DD') THEN transaction.foreigntotal ELSE 0 END) AS spend_prior_ytd
                FROM transaction
                INNER JOIN customer ON transaction.entity = customer.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type = 'CustInvc'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND ap.startdate >= TO_DATE('{priorPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    {customerFilter}
                GROUP BY customer.id, customer.companyname
                HAVING SUM(CASE WHEN ap.startdate >= ADD_MONTHS(CURRENT_DATE, -{months}) THEN transaction.foreigntotal ELSE 0 END) > 0
                ORDER BY recent_spend DESC
            `,
            resultFormat: {
                type: 'table',
                columns: ['Customer ID', 'Customer', 'Recent Spend', 'This YTD', 'Prior YTD'],
                formatting: { recent_spend: 'currency', spend_this_ytd: 'currency', spend_prior_ytd: 'currency' }
            }
        },
        {
            id: 'vendor_spend_yoy',
            name: 'Vendor Spend Year-over-Year',
            description: 'Compare vendor spending YTD vs same period last year',
            category: 'AP',
            preferredEntityType: 'vendor',
            keywords: ['vendor spend', 'yoy vendor', 'vendor comparison', 'bills comparison', 'vendor bills yoy', 'compare bills', 'ap yoy', 'vendor spend year over year', 'vendor yoy', 'year over year vendor', 'compare vendor spend'],
            answers: [
                'Compare vendor spend this year vs last year',
                'Show me YoY vendor payments',
                'Which vendors did we pay more this year?',
                'Show vendor spend comparison year over year',
                'Vendor spend year over year'
            ],
            parameters: [
                { name: 'months', type: 'integer', required: false, default: 6, description: 'Number of months to look back for recent spend' },
                { name: 'years_back', type: 'integer', required: false, default: 1, description: 'Years back to compare' },
                { name: 'vendorId', type: 'integer', required: false, description: 'Optional vendor ID to filter for a specific vendor' }
            ],
            query: `
                SELECT 
                    vendor.id AS vendor_id,
                    vendor.companyname AS vendor_name,
                    SUM(CASE WHEN ap.startdate >= ADD_MONTHS(CURRENT_DATE, -{months}) THEN ABS(transaction.foreigntotal) ELSE 0 END) AS recent_spend,
                    SUM(CASE WHEN ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD') AND ap.enddate <= TO_DATE('{currentPeriodEnd}', 'YYYY-MM-DD') THEN ABS(transaction.foreigntotal) ELSE 0 END) AS spend_this_ytd,
                    SUM(CASE WHEN ap.startdate >= TO_DATE('{priorPeriodStart}', 'YYYY-MM-DD') AND ap.enddate <= TO_DATE('{priorPeriodEnd}', 'YYYY-MM-DD') THEN ABS(transaction.foreigntotal) ELSE 0 END) AS spend_prior_ytd
                FROM transaction
                INNER JOIN vendor ON transaction.entity = vendor.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type = 'VendBill'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND ap.startdate >= TO_DATE('{priorPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    {vendorFilter}
                GROUP BY vendor.id, vendor.companyname
                HAVING SUM(CASE WHEN ap.startdate >= ADD_MONTHS(CURRENT_DATE, -{months}) THEN ABS(transaction.foreigntotal) ELSE 0 END) > 0
                ORDER BY recent_spend DESC
            `,
            resultFormat: {
                type: 'table',
                columns: ['Vendor ID', 'Vendor', 'Recent Spend', 'This YTD', 'Prior YTD'],
                formatting: { recent_spend: 'currency', spend_this_ytd: 'currency', spend_prior_ytd: 'currency' }
            }
        },

        // ==========================================
        // PROFITABILITY
        // ==========================================
        {
            id: 'gross_margin_by_month',
            name: 'Gross Margin by Month',
            description: 'Monthly gross margin trend',
            category: 'PROFITABILITY',
            keywords: ['gross margin', 'gm', 'profit margin', 'margin trend', 'profitability'],
            parameters: [],
            query: `
                SELECT 
                    TO_CHAR(ap.startdate, 'YYYY-MM') AS month,
                    SUM(CASE WHEN account.accttype = 'Income' THEN -1 * transactionaccountingline.amount ELSE 0 END) AS revenue,
                    SUM(CASE WHEN account.accttype = 'COGS' THEN transactionaccountingline.amount ELSE 0 END) AS cogs,
                    SUM(CASE WHEN account.accttype = 'Income' THEN -1 * transactionaccountingline.amount ELSE 0 END) - 
                        SUM(CASE WHEN account.accttype = 'COGS' THEN transactionaccountingline.amount ELSE 0 END) AS gross_profit
                FROM transactionaccountingline
                INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id
                INNER JOIN account ON transactionaccountingline.account = account.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND ap.startdate >= ADD_MONTHS(TRUNC(CURRENT_DATE, 'MM'), -12)
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND account.accttype IN ('Income', 'COGS')
                GROUP BY TO_CHAR(ap.startdate, 'YYYY-MM')
                ORDER BY month
            `,
            resultFormat: {
                type: 'table',
                columns: ['Month', 'Revenue', 'COGS', 'Gross Profit'],
                formatting: { revenue: 'currency', cogs: 'currency', gross_profit: 'currency' }
            }
        },
        {
            id: 'profitability_by_customer',
            name: 'Customer Profitability',
            description: 'Profit margin by customer this fiscal year',
            category: 'PROFITABILITY',
            keywords: ['customer profit', 'which customers profitable', 'customer margin', 'customer gm', 'customer profitability ytd', 'gross margin percentage', 'margin percent'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(transaction.entity) AS customer,
                    SUM(CASE WHEN account.accttype = 'Income' THEN -1 * transactionaccountingline.amount ELSE 0 END) AS revenue,
                    SUM(CASE WHEN account.accttype = 'COGS' THEN transactionaccountingline.amount ELSE 0 END) AS cogs,
                    SUM(CASE WHEN account.accttype = 'Income' THEN -1 * transactionaccountingline.amount ELSE 0 END) - 
                        SUM(CASE WHEN account.accttype = 'COGS' THEN transactionaccountingline.amount ELSE 0 END) AS gross_profit,
                    ROUND(
                        CASE 
                            WHEN SUM(CASE WHEN account.accttype = 'Income' THEN -1 * transactionaccountingline.amount ELSE 0 END) > 0
                            THEN (
                                (SUM(CASE WHEN account.accttype = 'Income' THEN -1 * transactionaccountingline.amount ELSE 0 END) - 
                                 SUM(CASE WHEN account.accttype = 'COGS' THEN transactionaccountingline.amount ELSE 0 END))
                                / SUM(CASE WHEN account.accttype = 'Income' THEN -1 * transactionaccountingline.amount ELSE 0 END)
                            ) * 100
                            ELSE 0
                        END, 2
                    ) AS gross_margin_pct
                FROM transactionaccountingline
                INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id
                INNER JOIN account ON transactionaccountingline.account = account.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND transaction.entity IS NOT NULL
                    AND ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND account.accttype IN ('Income', 'COGS')
                GROUP BY BUILTIN.DF(transaction.entity)
                HAVING SUM(CASE WHEN account.accttype = 'Income' THEN -1 * transactionaccountingline.amount ELSE 0 END) > 0
                ORDER BY gross_margin_pct DESC, gross_profit DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Customer', 'Revenue', 'COGS', 'Gross Profit', 'Margin %'],
                formatting: { revenue: 'currency', cogs: 'currency', gross_profit: 'currency', gross_margin_pct: 'percent' }
            }
        },
        {
            id: 'profitability_by_item',
            name: 'Product Profitability',
            description: 'Profit margin by product/item this fiscal year',
            category: 'PROFITABILITY',
            keywords: ['product profit', 'item margin', 'which products profitable', 'product gm', 'item profitability ytd'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(transactionline.item) AS item,
                    SUM(transactionline.quantity) AS qty_sold,
                    SUM(-1 * transactionline.netamount) AS revenue,
                    SUM(COALESCE(transactionline.costestimate, 0)) AS cost,
                    SUM(-1 * transactionline.netamount) - SUM(COALESCE(transactionline.costestimate, 0)) AS gross_profit,
                    ROUND(
                        CASE 
                            WHEN SUM(-1 * transactionline.netamount) > 0
                            THEN ((SUM(-1 * transactionline.netamount) - SUM(COALESCE(transactionline.costestimate, 0))) 
                                  / SUM(-1 * transactionline.netamount)) * 100
                            ELSE 0
                        END, 2
                    ) AS gross_margin_pct
                FROM transactionline
                INNER JOIN transaction ON transactionline.transaction = transaction.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                    AND ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND transactionline.item IS NOT NULL
                    AND transactionline.mainline = 'F'
                GROUP BY BUILTIN.DF(transactionline.item)
                HAVING SUM(-1 * transactionline.netamount) > 0
                ORDER BY gross_margin_pct DESC, gross_profit DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Item', 'Qty Sold', 'Revenue', 'Cost', 'Gross Profit', 'Margin %'],
                formatting: { revenue: 'currency', cost: 'currency', gross_profit: 'currency', gross_margin_pct: 'percent' }
            }
        },

        // ==========================================
        // EXPENSES
        // ==========================================
        {
            id: 'expenses_by_category',
            name: 'Expenses by Category',
            description: 'Expense breakdown by account category this fiscal year',
            category: 'EXPENSES',
            keywords: ['expenses', 'spending', 'costs', 'by category', 'expense breakdown', 'expenses ytd', 'spending ytd'],
            parameters: [],
            query: `
                SELECT 
                    account.accountsearchdisplayname AS expense_account,
                    SUM(transactionaccountingline.amount) AS amount
                FROM transactionaccountingline
                INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id
                INNER JOIN account ON transactionaccountingline.account = account.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE account.accttype = 'Expense'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                GROUP BY account.accountsearchdisplayname
                ORDER BY amount DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Expense Account', 'Amount'],
                formatting: { amount: 'currency' },
                chartOption: { type: 'pie', labelField: 'expense_account', valueField: 'amount', yFormat: 'currency' }
            }
        },
        {
            id: 'expenses_by_month',
            name: 'Expenses by Month',
            description: 'Monthly expense trend',
            category: 'EXPENSES',
            keywords: ['monthly expenses', 'expense trend', 'spending trend'],
            parameters: [],
            query: `
                SELECT 
                    TO_CHAR(ap.startdate, 'YYYY-MM') AS month,
                    SUM(transactionaccountingline.amount) AS total_expenses
                FROM transactionaccountingline
                INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id
                INNER JOIN account ON transactionaccountingline.account = account.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE account.accttype = 'Expense'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND ap.startdate >= ADD_MONTHS(TRUNC(CURRENT_DATE, 'MM'), -12)
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                GROUP BY TO_CHAR(ap.startdate, 'YYYY-MM')
                ORDER BY month
            `,
            resultFormat: {
                type: 'table',
                columns: ['Month', 'Total Expenses'],
                formatting: { total_expenses: 'currency' },
                chartOption: { type: 'line', xAxis: 'month', series: ['total_expenses'], xLabel: 'Month', yLabel: 'Expenses', yFormat: 'currency' }
            }
        },
        {
            id: 'expenses_by_department',
            name: 'Expenses by Department',
            description: 'Expense breakdown by department this fiscal year',
            category: 'EXPENSES',
            keywords: ['department expenses', 'departmental spending', 'expense by dept', 'department spending ytd'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(transactionline.department) AS department,
                    SUM(transactionaccountingline.amount) AS amount
                FROM transactionaccountingline
                INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id
                INNER JOIN transactionline ON transactionline.id = transactionaccountingline.transactionline
                INNER JOIN account ON transactionaccountingline.account = account.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE account.accttype = 'Expense'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transactionline.department IS NOT NULL
                GROUP BY BUILTIN.DF(transactionline.department)
                ORDER BY amount DESC
            `,
            resultFormat: {
                type: 'table',
                columns: ['Department', 'Amount'],
                formatting: { amount: 'currency' }
            }
        },
        {
            id: 'recent_expense_reports',
            name: 'Recent Expense Reports',
            description: 'Recent employee expense reports',
            category: 'EXPENSES',
            keywords: ['expense reports', 'employee expenses', 'reimbursements'],
            parameters: [],
            query: `
                SELECT 
                    transaction.trandate AS date,
                    transaction.tranid AS report_number,
                    BUILTIN.DF(transaction.entity) AS employee,
                    transaction.foreigntotal AS amount,
                    transaction.status AS status
                FROM transaction
                WHERE transaction.type = 'ExpRept'
                    AND transaction.trandate >= CURRENT_DATE - 60
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Date', 'Report #', 'Employee', 'Amount', 'Status'],
                formatting: { date: 'date', amount: 'currency' }
            }
        },

        // ==========================================
        // ORDERS
        // ==========================================
        {
            id: 'open_sales_orders',
            name: 'Open Sales Orders',
            description: 'Unfulfilled sales orders',
            category: 'ORDERS',
            keywords: ['open sales orders', 'pending orders', 'unfulfilled orders', 'sales backlog'],
            parameters: [],
            query: `
                SELECT 
                    transaction.trandate AS order_date,
                    transaction.tranid AS order_number,
                    BUILTIN.DF(transaction.entity) AS customer,
                    transaction.foreigntotal AS amount,
                    BUILTIN.DF(transaction.status) AS status
                FROM transaction
                WHERE transaction.type = 'SalesOrd'
                    AND BUILTIN.CF(transaction.status) NOT IN ('SalesOrd:C', 'SalesOrd:G', 'SalesOrd:H')
                ORDER BY transaction.trandate

            `,
            resultFormat: {
                type: 'table',
                columns: ['Order Date', 'Order #', 'Customer', 'Amount', 'Status'],
                formatting: { order_date: 'date', amount: 'currency' }
            }
        },
        {
            id: 'sales_backlog',
            name: 'Sales Backlog Value',
            description: 'Total value of open sales orders',
            category: 'ORDERS',
            keywords: ['backlog', 'order backlog', 'unfulfilled value', 'pending sales'],
            parameters: [],
            query: `
                SELECT 
                    COUNT(transaction.id) AS order_count,
                    SUM(transaction.foreigntotal) AS backlog_value,
                    MIN(transaction.trandate) AS oldest_order
                FROM transaction
                WHERE transaction.type = 'SalesOrd'
                    AND BUILTIN.CF(transaction.status) NOT IN ('SalesOrd:C', 'SalesOrd:G', 'SalesOrd:H')
            `,
            resultFormat: {
                type: 'metric',
                primary: 'backlog_value',
                context: ['order_count', 'oldest_order']
            }
        },
        {
            id: 'open_purchase_orders',
            name: 'Open Purchase Orders',
            description: 'Unreceived purchase orders',
            category: 'ORDERS',
            keywords: ['open po', 'purchase orders', 'pending purchases', 'on order'],
            parameters: [],
            query: `
                SELECT 
                    transaction.trandate AS order_date,
                    transaction.tranid AS po_number,
                    BUILTIN.DF(transaction.entity) AS vendor,
                    transaction.foreigntotal AS amount,
                    BUILTIN.DF(transaction.status) AS status
                FROM transaction
                WHERE transaction.type = 'PurchOrd'
                    AND BUILTIN.CF(transaction.status) NOT IN ('PurchOrd:C', 'PurchOrd:G', 'PurchOrd:H')
                ORDER BY transaction.trandate

            `,
            resultFormat: {
                type: 'table',
                columns: ['Order Date', 'PO #', 'Vendor', 'Amount', 'Status'],
                formatting: { order_date: 'date', amount: 'currency' }
            }
        },

        // ==========================================
        // EMPLOYEES
        // ==========================================
        {
            id: 'employee_headcount',
            name: 'Employee Headcount',
            description: 'Active employees by department',
            category: 'EMPLOYEES',
            keywords: ['headcount', 'employees', 'staff', 'how many employees', 'team size'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(employee.department) AS department,
                    COUNT(employee.id) AS employee_count
                FROM employee
                WHERE employee.isinactive = 'F'
                GROUP BY BUILTIN.DF(employee.department)
                ORDER BY employee_count DESC
            `,
            resultFormat: {
                type: 'table',
                columns: ['Department', 'Count'],
                showTotal: true
            }
        },
        {
            id: 'employee_time_summary',
            name: 'Employee Time Summary',
            description: 'Billable and non-billable hours by employee - use for time tracking, billable hours, employee hours questions',
            category: 'EMPLOYEES',
            keywords: ['time tracking', 'hours logged', 'employee hours', 'time summary', 'billable hours', 'billable hours by employee', 'hours by employee', 'time by employee', 'employee time', 'show hours', 'show billable'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(timebill.employee) AS employee,
                    SUM(timebill.hours) AS total_hours,
                    SUM(CASE WHEN timebill.isbillable = 'T' THEN timebill.hours ELSE 0 END) AS billable_hours,
                    SUM(CASE WHEN timebill.isbillable = 'F' THEN timebill.hours ELSE 0 END) AS non_billable_hours
                FROM timebill
                WHERE timebill.trandate >= ADD_MONTHS(CURRENT_DATE, -1)
                GROUP BY BUILTIN.DF(timebill.employee)
                ORDER BY total_hours DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Employee', 'Total Hours', 'Billable', 'Non-Billable'],
                formatting: { total_hours: 'number', billable_hours: 'number', non_billable_hours: 'number' }
            }
        },
        {
            id: 'utilization_by_employee',
            name: 'Utilization by Employee',
            description: 'Employee utilization rates and billable percentages',
            category: 'EMPLOYEES',
            keywords: ['utilization', 'billable percent', 'billability', 'employee utilization', 'utilization rate', 'billable ratio'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(timebill.employee) AS employee,
                    SUM(timebill.hours) AS total_hours,
                    SUM(CASE WHEN timebill.isbillable = 'T' THEN timebill.hours ELSE 0 END) AS billable_hours,
                    ROUND(
                        SUM(CASE WHEN timebill.isbillable = 'T' THEN timebill.hours ELSE 0 END) / 
                        NULLIF(SUM(timebill.hours), 0) * 100
                    , 1) AS utilization_pct
                FROM timebill
                WHERE timebill.trandate >= ADD_MONTHS(CURRENT_DATE, -1)
                GROUP BY BUILTIN.DF(timebill.employee)
                HAVING SUM(timebill.hours) > 0
                ORDER BY utilization_pct DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Employee', 'Total Hours', 'Billable Hours', 'Utilization %'],
                formatting: { utilization_pct: 'percent' }
            }
        },

        // ==========================================
        // GENERAL LEDGER
        // ==========================================
        {
            id: 'trial_balance',
            name: 'Trial Balance',
            description: 'Account balances as of now',
            category: 'GL',
            keywords: ['trial balance', 'tb', 'account balances', 'gl balances'],
            parameters: [],
            query: `
                SELECT 
                    account.acctnumber AS account_number,
                    account.accountsearchdisplayname AS account_name,
                    account.accttype AS type,
                    account.balance AS balance
                FROM account
                WHERE account.isinactive = 'F'
                    AND account.balance != 0
                ORDER BY account.acctnumber

            `,
            resultFormat: {
                type: 'table',
                variant: 'financial_statement',
                columns: ['Acct #', 'Account', 'Type', 'Balance'],
                formatting: { balance: 'currency' },
                groupBy: 'type',
                hideGroupColumn: true
            }
        },
        {
            id: 'income_statement_summary',
            name: 'Income Statement Summary',
            description: 'High-level P&L summary',
            category: 'GL',
            keywords: ['income statement', 'p&l', 'profit and loss', 'pnl', 'net income'],
            parameters: [],
            query: `
                SELECT 
                    account.accttype AS category,
                    SUM(CASE 
                        WHEN account.accttype IN ('Income', 'OthIncome') THEN -1 * transactionaccountingline.amount
                        ELSE transactionaccountingline.amount
                    END) AS amount
                FROM transactionaccountingline
                INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id
                INNER JOIN account ON transactionaccountingline.account = account.id
                WHERE transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND transaction.trandate >= TRUNC(CURRENT_DATE, 'YYYY')
                    AND account.accttype IN ('Income', 'COGS', 'Expense', 'OthIncome', 'OthExpense')
                GROUP BY account.accttype
                ORDER BY 
                    CASE account.accttype 
                        WHEN 'Income' THEN 1 
                        WHEN 'OthIncome' THEN 2
                        WHEN 'COGS' THEN 3 
                        WHEN 'Expense' THEN 4 
                        WHEN 'OthExpense' THEN 5 
                    END
            `,
            resultFormat: {
                type: 'table',
                columns: ['Category', 'Amount'],
                formatting: { amount: 'currency' }
            }
        },
        {
            id: 'recent_journal_entries',
            name: 'Recent Journal Entries',
            description: 'Journal entries in recent period',
            category: 'GL',
            keywords: ['journal entries', 'je', 'adjustments', 'manual entries'],
            parameters: [],
            query: `
                SELECT 
                    transaction.trandate AS date,
                    transaction.tranid AS je_number,
                    transaction.memo AS memo,
                    BUILTIN.DF(transaction.createdby) AS created_by
                FROM transaction
                WHERE transaction.type = 'Journal'
                    AND transaction.trandate >= CURRENT_DATE - 30
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Date', 'JE #', 'Memo', 'Created By'],
                formatting: { date: 'date' }
            }
        },

        // ==========================================
        // INVENTORY
        // ==========================================
        {
            id: 'inventory_valuation',
            name: 'Inventory Valuation',
            description: 'Current inventory value by item',
            category: 'INVENTORY',
            keywords: ['inventory value', 'stock value', 'inventory on hand'],
            parameters: [],
            query: `
                SELECT 
                    item.itemid AS item_code,
                    item.displayname AS item_name,
                    item.quantityonhand AS qty_on_hand,
                    item.averagecost AS avg_cost,
                    item.quantityonhand * item.averagecost AS total_value
                FROM item
                WHERE item.itemtype IN ('InvtPart', 'Assembly')
                    AND item.isinactive = 'F'
                    AND item.quantityonhand > 0
                ORDER BY item.quantityonhand * item.averagecost DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Item Code', 'Name', 'Qty', 'Avg Cost', 'Total Value'],
                formatting: { avg_cost: 'currency', total_value: 'currency' }
            }
        },
        {
            id: 'low_stock_items',
            name: 'Low Stock Items',
            description: 'Items at or below reorder point',
            category: 'INVENTORY',
            keywords: ['low stock', 'reorder', 'out of stock', 'need to order'],
            parameters: [],
            query: `
                SELECT 
                    item.itemid AS item_code,
                    item.displayname AS item_name,
                    item.quantityonhand AS qty_on_hand,
                    item.reorderpoint AS reorder_point,
                    item.quantityonorder AS qty_on_order
                FROM item
                WHERE item.itemtype IN ('InvtPart', 'Assembly')
                    AND item.isinactive = 'F'
                    AND item.quantityonhand <= item.reorderpoint
                    AND item.reorderpoint > 0
                ORDER BY (item.quantityonhand - item.reorderpoint)

            `,
            resultFormat: {
                type: 'table',
                columns: ['Item', 'Name', 'On Hand', 'Reorder Point', 'On Order']
            }
        },

        // ==========================================
        // PROJECTS
        // ==========================================
        {
            id: 'project_list',
            name: 'Active Projects',
            description: 'List of active projects',
            category: 'PROJECTS',
            keywords: ['projects', 'active projects', 'jobs', 'project list'],
            parameters: [],
            query: `
                SELECT 
                    job.entityid AS project_id,
                    job.companyname AS project_name,
                    BUILTIN.DF(job.parent) AS customer,
                    job.entitystatus AS status,
                    job.startdate AS start_date,
                    job.projectedenddate AS projected_end
                FROM job
                WHERE job.isinactive = 'F'
                ORDER BY job.startdate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Project ID', 'Name', 'Customer', 'Status', 'Start', 'Projected End'],
                formatting: { start_date: 'date', projected_end: 'date' }
            }
        },
        {
            id: 'project_revenue',
            name: 'Revenue by Project',
            description: 'Revenue recognized by project this fiscal year',
            category: 'PROJECTS',
            keywords: ['project revenue', 'job revenue', 'project billing', 'revenue by project', 'project sales', 'project revenue ytd'],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(transactionline.entity) AS project,
                    COUNT(DISTINCT transaction.id) AS invoice_count,
                    SUM(-1 * transactionline.netamount) AS revenue
                FROM transactionline
                INNER JOIN transaction ON transactionline.transaction = transaction.id
                INNER JOIN accountingperiod ap ON transaction.postingperiod = ap.id
                WHERE transaction.type IN ('CustInvc', 'CashSale', 'CustCred')
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                    AND ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                    AND transactionline.entity IS NOT NULL
                    AND transactionline.mainline = 'F'
                GROUP BY BUILTIN.DF(transactionline.entity)
                HAVING SUM(-1 * transactionline.netamount) > 0
                ORDER BY revenue DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Project', 'Invoices', 'Revenue'],
                formatting: { revenue: 'currency' }
            }
        },

        // ==========================================
        // TRANSACTION LOOKUP (NEW)
        // ==========================================
        {
            id: 'find_transaction_by_number',
            name: 'Find Transaction by Number',
            description: 'Look up a specific transaction by its number/ID',
            category: 'TRANSACTIONS',
            keywords: ['find transaction', 'lookup transaction', 'transaction number', 'tranid', 'find invoice', 'find bill', 'find order', 'transaction details', 'show transaction', 'get transaction'],
            parameters: [
                { name: 'tranid', type: 'string', required: true, extractPattern: /(?:transaction|invoice|bill|order|po|so|je|check)?\s*#?\s*(\w+[-]?\w*)/i }
            ],
            query: `
                SELECT 
                    transaction.id AS internal_id,
                    transaction.tranid AS transaction_number,
                    transaction.type AS type,
                    transaction.trandate AS date,
                    BUILTIN.DF(transaction.entity) AS entity,
                    BUILTIN.DF(transaction.subsidiary) AS subsidiary,
                    transaction.foreigntotal AS amount,
                    transaction.status AS status,
                    transaction.memo AS memo,
                    BUILTIN.DF(transaction.createdby) AS created_by
                FROM transaction
                WHERE transaction.tranid = '{tranid}'
                   OR transaction.tranid LIKE '%{tranid}%'
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['ID', 'Number', 'Type', 'Date', 'Entity', 'Subsidiary', 'Amount', 'Status', 'Memo', 'Created By'],
                formatting: { date: 'date', amount: 'currency' }
            }
        },
        {
            id: 'find_invoice_by_number',
            name: 'Find Invoice By Number',
            description: 'Look up a specific invoice by its document number',
            category: 'TRANSACTIONS',
            keywords: ['invoice number', 'invoice lookup', 'show invoice', 'invoice details', 'inv #'],
            parameters: [
                { 
                    name: 'tranid', 
                    type: 'string', 
                    required: true, 
                    // FIX #4: Require "invoice/inv" and capture only alphanumeric patterns
                    extractPattern: /(?:invoice|inv)\s*#?\s*([A-Z0-9][-A-Z0-9]*)/i,
                    // FIX #5: Stop words that should never be extracted as params
                    stopWords: ['find', 'show', 'get', 'the', 'latest', 'recent', 'from', 'for']
                }
            ],
            query: `
                SELECT 
                    transaction.id AS internal_id,
                    transaction.tranid AS invoice_number,
                    transaction.trandate AS date,
                    transaction.duedate AS due_date,
                    BUILTIN.DF(transaction.entity) AS customer,
                    transaction.foreigntotal AS total,
                    transaction.foreignamountunpaid AS amount_due,
                    transaction.status AS status,
                    transaction.memo AS memo
                FROM transaction
                WHERE transaction.type = 'CustInvc'
                    AND (transaction.tranid = '{tranid}' OR transaction.tranid LIKE '%{tranid}%')
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['ID', 'Invoice #', 'Date', 'Due Date', 'Customer', 'Total', 'Amount Due', 'Status', 'Memo'],
                formatting: { date: 'date', due_date: 'date', total: 'currency', amount_due: 'currency' }
            }
        },
        {
            id: 'find_bill_by_number',
            name: 'Find Vendor Bill',
            description: 'Look up a specific vendor bill by number',
            category: 'TRANSACTIONS',
            keywords: ['find vendor bill', 'vendor bill number', 'bill number lookup', 'lookup bill', 'bill details', 'get bill'],
            parameters: [
                { name: 'tranid', type: 'string', required: true, extractPattern: /(?:vendor\s+)?bill\s*#?\s*(\w+[-]?\w*)/i }
            ],
            query: `
                SELECT 
                    transaction.id AS internal_id,
                    transaction.tranid AS bill_number,
                    transaction.trandate AS date,
                    transaction.duedate AS due_date,
                    BUILTIN.DF(transaction.entity) AS vendor,
                    transaction.foreigntotal AS total,
                    transaction.foreignamountunpaid AS amount_due,
                    transaction.status AS status,
                    transaction.memo AS memo
                FROM transaction
                WHERE transaction.type = 'VendBill'
                    AND (transaction.tranid = '{tranid}' OR transaction.tranid LIKE '%{tranid}%')
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['ID', 'Bill #', 'Date', 'Due Date', 'Vendor', 'Total', 'Amount Due', 'Status', 'Memo'],
                formatting: { date: 'date', due_date: 'date', total: 'currency', amount_due: 'currency' }
            }
        },
        {
            id: 'find_sales_order_by_number',
            name: 'Find Sales Order',
            description: 'Look up a specific sales order',
            category: 'TRANSACTIONS',
            keywords: ['find sales order', 'sales order number', 'so number', 'order lookup', 'show sales order', 'so details'],
            parameters: [
                { name: 'tranid', type: 'string', required: true, extractPattern: /(?:sales order|so|order)?\s*#?\s*(\w+[-]?\w*)/i }
            ],
            query: `
                SELECT 
                    transaction.id AS internal_id,
                    transaction.tranid AS order_number,
                    transaction.trandate AS date,
                    BUILTIN.DF(transaction.entity) AS customer,
                    transaction.foreigntotal AS total,
                    transaction.status AS status,
                    transaction.memo AS memo,
                    transaction.shipdate AS ship_date
                FROM transaction
                WHERE transaction.type = 'SalesOrd'
                    AND (transaction.tranid = '{tranid}' OR transaction.tranid LIKE '%{tranid}%')
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['ID', 'Order #', 'Date', 'Customer', 'Total', 'Status', 'Memo', 'Ship Date'],
                formatting: { date: 'date', total: 'currency', ship_date: 'date' }
            }
        },
        {
            id: 'find_purchase_order_by_number',
            name: 'Find Purchase Order',
            description: 'Look up a specific purchase order',
            category: 'TRANSACTIONS',
            keywords: ['find purchase order', 'purchase order number', 'po number', 'po lookup', 'show po', 'po details'],
            parameters: [
                { name: 'tranid', type: 'string', required: true, extractPattern: /(?:purchase order|po)?\s*#?\s*(\w+[-]?\w*)/i }
            ],
            query: `
                SELECT 
                    transaction.id AS internal_id,
                    transaction.tranid AS po_number,
                    transaction.trandate AS date,
                    BUILTIN.DF(transaction.entity) AS vendor,
                    transaction.foreigntotal AS total,
                    transaction.status AS status,
                    transaction.memo AS memo
                FROM transaction
                WHERE transaction.type = 'PurchOrd'
                    AND (transaction.tranid = '{tranid}' OR transaction.tranid LIKE '%{tranid}%')
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['ID', 'PO #', 'Date', 'Vendor', 'Total', 'Status', 'Memo'],
                formatting: { date: 'date', total: 'currency' }
            }
        },
        {
            id: 'transaction_line_details',
            name: 'Transaction Line Details',
            description: 'Show line items for a specific transaction',
            category: 'TRANSACTIONS',
            keywords: ['transaction lines', 'line items', 'invoice lines', 'bill lines', 'order lines', 'line details', 'what is on'],
            parameters: [
                { name: 'tranid', type: 'string', required: true, extractPattern: /(?:transaction|invoice|bill|order)?\s*#?\s*(\w+[-]?\w*)/i }
            ],
            query: `
                SELECT 
                    transactionline.linesequencenumber AS line,
                    BUILTIN.DF(transactionline.item) AS item,
                    transactionline.quantity AS qty,
                    transactionline.rate AS rate,
                    transactionline.netamount AS amount,
                    BUILTIN.DF(transactionline.department) AS department,
                    BUILTIN.DF(transactionline.class) AS class,
                    transactionline.memo AS memo
                FROM transactionline
                INNER JOIN transaction ON transactionline.transaction = transaction.id
                WHERE (transaction.tranid = '{tranid}' OR transaction.tranid LIKE '%{tranid}%')
                    AND transactionline.mainline = 'F'
                    AND transactionline.item IS NOT NULL
                ORDER BY transactionline.linesequencenumber
            `,
            resultFormat: {
                type: 'table',
                columns: ['Line', 'Item', 'Qty', 'Rate', 'Amount', 'Department', 'Class', 'Memo'],
                formatting: { rate: 'currency', amount: 'currency' }
            }
        },
        {
            id: 'transactions_by_customer',
            name: 'Transactions by Customer',
            description: 'Find all transactions for a specific customer. Use customer ID (not name) from entity resolution.',
            category: 'TRANSACTIONS',
            keywords: ['customer transactions', 'transactions for customer', 'customer history', 'customer invoices', 'what did we bill'],
            parameters: [
                { 
                    name: 'customer_id', 
                    type: 'number', 
                    required: true,
                    description: 'Customer internal ID from entity resolution'
                }
            ],
            query: `
                SELECT 
                    transaction.trandate AS date,
                    transaction.type AS type,
                    transaction.tranid AS number,
                    BUILTIN.DF(transaction.entity) AS customer,
                    transaction.foreigntotal AS amount,
                    transaction.foreignamountunpaid AS unpaid,
                    transaction.status AS status
                FROM transaction
                WHERE transaction.entity = {customer_id}
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Date', 'Type', 'Number', 'Customer', 'Amount', 'Unpaid', 'Status'],
                formatting: { date: 'date', amount: 'currency', unpaid: 'currency' }
            }
        },
        {
            id: 'transactions_by_vendor',
            name: 'Transactions by Vendor',
            description: 'Find all transactions for a specific vendor. Use vendor ID (not name) from entity resolution.',
            category: 'TRANSACTIONS',
            keywords: ['vendor transactions', 'transactions for vendor', 'vendor history', 'vendor bills', 'what did we pay'],
            parameters: [
                { 
                    name: 'vendor_id', 
                    type: 'number', 
                    required: true,
                    description: 'Vendor internal ID from entity resolution'
                }
            ],
            query: `
                SELECT 
                    transaction.trandate AS date,
                    transaction.type AS type,
                    transaction.tranid AS number,
                    BUILTIN.DF(transaction.entity) AS vendor,
                    ABS(transaction.foreigntotal) AS amount,
                    transaction.foreignamountunpaid AS unpaid,
                    transaction.status AS status
                FROM transaction
                WHERE transaction.entity = {vendor_id}
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Date', 'Type', 'Number', 'Amount', 'Unpaid', 'Status'],
                formatting: { date: 'date', amount: 'currency', unpaid: 'currency' }
            }
        },
        {
            id: 'recent_transactions_by_type',
            name: 'Recent Transactions by Type',
            description: 'Show recent transactions of a specific type',
            category: 'TRANSACTIONS',
            keywords: ['recent invoices', 'recent bills', 'recent payments', 'recent orders', 'last invoices', 'last bills', 'show invoices', 'show bills'],
            parameters: [
                { name: 'type', type: 'string', required: true, extractPattern: /(?:recent|last|show)?\s*(invoices?|bills?|payments?|orders?|checks?|journals?|estimates?|quotes?)/i }
            ],
            query: `
                SELECT 
                    transaction.trandate AS date,
                    transaction.tranid AS number,
                    BUILTIN.DF(transaction.entity) AS entity,
                    transaction.foreigntotal AS amount,
                    transaction.status AS status,
                    transaction.memo AS memo
                FROM transaction
                WHERE transaction.type = '{type}'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Date', 'Number', 'Entity', 'Amount', 'Status', 'Memo'],
                formatting: { date: 'date', amount: 'currency' }
            },
            typeMapping: {
                'invoice': 'CustInvc',
                'invoices': 'CustInvc',
                'bill': 'VendBill',
                'bills': 'VendBill',
                'payment': 'CustPymt',
                'payments': 'CustPymt',
                'order': 'SalesOrd',
                'orders': 'SalesOrd',
                'check': 'Check',
                'checks': 'Check',
                'journal': 'Journal',
                'journals': 'Journal',
                'estimate': 'Estimate',
                'estimates': 'Estimate',
                'quote': 'Estimate',
                'quotes': 'Estimate'
            }
        },
        {
            id: 'latest_vendor_transaction',
            name: 'Latest Vendor Transaction',
            description: 'Get the most recent bill/invoice/payment from a specific vendor',
            category: 'TRANSACTIONS',
            keywords: ['latest bill from', 'latest invoice from', 'most recent bill', 'most recent invoice from vendor', 'last bill from', 'last invoice from', 'newest bill'],
            answers: [
                'Show me the latest invoice from vendor X',
                'What is the most recent bill from supplier Y?',
                'Get the last payment to vendor Z'
            ],
            parameters: [
                { name: 'vendor', type: 'string', required: true, description: 'Vendor name' },
                { name: 'vendor_id', type: 'integer', required: true, description: 'Vendor internal ID' },
                { name: 'type', type: 'string', required: false, default: 'VendBill', description: 'Transaction type (VendBill, VendCred, VendPymt)' }
            ],
            query: `
                SELECT 
                    transaction.id AS id,
                    transaction.tranid AS document_number,
                    transaction.type AS trantype,
                    transaction.trandate AS date,
                    BUILTIN.DF(transaction.entity) AS vendor_name,
                    transaction.foreigntotal AS amount,
                    transaction.status AS status,
                    transaction.memo AS memo,
                    transaction.duedate AS due_date
                FROM transaction
                WHERE transaction.entity = {vendor_id}
                    AND transaction.type = '{type}'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                ORDER BY transaction.trandate DESC, transaction.id DESC
                FETCH FIRST 1 ROW ONLY
            `,
            resultFormat: {
                type: 'transaction_card',
                columns: ['ID', 'Document Number', 'Date', 'Vendor', 'Amount', 'Status', 'Memo', 'Due Date'],
                formatting: { date: 'date', due_date: 'date', amount: 'currency' }
            },
            typeMapping: {
                'bill': 'VendBill',
                'bills': 'VendBill',
                'invoice': 'VendBill',
                'invoices': 'VendBill',
                'credit': 'VendCred',
                'credits': 'VendCred',
                'payment': 'VendPymt',
                'payments': 'VendPymt'
            }
        },
        {
            id: 'latest_customer_transaction',
            name: 'Latest Customer Transaction',
            description: 'Get the most recent invoice/payment from a specific customer',
            category: 'TRANSACTIONS',
            keywords: ['latest invoice to', 'latest invoice for customer', 'most recent invoice', 'last invoice to', 'last invoice for', 'newest invoice for customer'],
            answers: [
                'Show me the latest invoice for customer X',
                'What is the most recent invoice to customer Y?',
                'Get the last payment from customer Z'
            ],
            parameters: [
                { name: 'customer', type: 'string', required: true, description: 'Customer name' },
                { name: 'customer_id', type: 'integer', required: true, description: 'Customer internal ID' },
                { name: 'type', type: 'string', required: false, default: 'CustInvc', description: 'Transaction type (CustInvc, CustCred, CustPymt)' }
            ],
            query: `
                SELECT 
                    transaction.id AS id,
                    transaction.tranid AS document_number,
                    transaction.type AS trantype,
                    transaction.trandate AS date,
                    BUILTIN.DF(transaction.entity) AS customer_name,
                    transaction.foreigntotal AS amount,
                    transaction.status AS status,
                    transaction.memo AS memo,
                    transaction.duedate AS due_date
                FROM transaction
                WHERE transaction.entity = {customer_id}
                    AND transaction.type = '{type}'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                ORDER BY transaction.trandate DESC, transaction.id DESC
                FETCH FIRST 1 ROW ONLY
            `,
            resultFormat: {
                type: 'transaction_card',
                columns: ['ID', 'Document Number', 'Date', 'Customer', 'Amount', 'Status', 'Memo', 'Due Date'],
                formatting: { date: 'date', due_date: 'date', amount: 'currency' }
            },
            typeMapping: {
                'invoice': 'CustInvc',
                'invoices': 'CustInvc',
                'credit': 'CustCred',
                'credits': 'CustCred',
                'payment': 'CustPymt',
                'payments': 'CustPymt'
            }
        },
        {
            id: 'recent_vendor_transactions',
            name: 'Recent Vendor Bills',
            description: 'Get recent bills/invoices from a specific vendor (multiple transactions)',
            category: 'TRANSACTIONS',
            keywords: ['recent bills from', 'bills from vendor', 'vendor bills', 'invoices from vendor', 'show bills from', 'last bills from', 'vendor transactions'],
            answers: [
                'Show me recent bills from vendor X',
                'What bills have we received from supplier Y?',
                'Show the last 10 invoices from vendor Z'
            ],
            parameters: [
                { name: 'vendor', type: 'string', required: true, description: 'Vendor name' },
                { name: 'vendor_id', type: 'integer', required: true, description: 'Vendor internal ID' },
                { name: 'limit', type: 'integer', required: false, default: 10, description: 'Number of transactions to return' }
            ],
            query: `
                SELECT 
                    transaction.id AS id,
                    transaction.tranid AS document_number,
                    transaction.trandate AS date,
                    BUILTIN.DF(transaction.entity) AS vendor_name,
                    transaction.foreigntotal AS amount,
                    transaction.foreignamountunpaid AS amount_due,
                    transaction.status AS status,
                    transaction.memo AS memo
                FROM transaction
                WHERE transaction.entity = {vendor_id}
                    AND transaction.type = 'VendBill'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                ORDER BY transaction.trandate DESC, transaction.id DESC
                FETCH FIRST {limit} ROWS ONLY
            `,
            resultFormat: {
                type: 'table',
                columns: ['ID', 'Document Number', 'Date', 'Vendor', 'Amount', 'Amount Due', 'Status', 'Memo'],
                formatting: { date: 'date', amount: 'currency', amount_due: 'currency' }
            }
        },
        {
            id: 'recent_customer_transactions',
            name: 'Recent Customer Invoices',
            description: 'Get recent invoices for a specific customer (multiple transactions)',
            category: 'TRANSACTIONS',
            keywords: ['recent invoices for', 'invoices for customer', 'customer invoices', 'show invoices for', 'last invoices for', 'customer transactions'],
            answers: [
                'Show me recent invoices for customer X',
                'What invoices have we sent to customer Y?',
                'Show the last 10 invoices for customer Z'
            ],
            parameters: [
                { name: 'customer', type: 'string', required: true, description: 'Customer name' },
                { name: 'customer_id', type: 'integer', required: true, description: 'Customer internal ID' },
                { name: 'limit', type: 'integer', required: false, default: 10, description: 'Number of transactions to return' }
            ],
            query: `
                SELECT 
                    transaction.id AS id,
                    transaction.tranid AS document_number,
                    transaction.trandate AS date,
                    BUILTIN.DF(transaction.entity) AS customer_name,
                    transaction.foreigntotal AS amount,
                    transaction.foreignamountunpaid AS amount_due,
                    transaction.status AS status,
                    transaction.memo AS memo
                FROM transaction
                WHERE transaction.entity = {customer_id}
                    AND transaction.type = 'CustInvc'
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                ORDER BY transaction.trandate DESC, transaction.id DESC
                FETCH FIRST {limit} ROWS ONLY
            `,
            resultFormat: {
                type: 'table',
                columns: ['ID', 'Document Number', 'Date', 'Customer', 'Amount', 'Amount Due', 'Status', 'Memo'],
                formatting: { date: 'date', amount: 'currency', amount_due: 'currency' }
            }
        },
        {
            id: 'transactions_by_date_range',
            name: 'Transactions by Date Range',
            description: 'Find transactions within a date range',
            category: 'TRANSACTIONS',
            keywords: ['transactions between', 'transactions from', 'transactions in', 'activity for', 'transactions this month', 'transactions last month', 'transactions this week'],
            parameters: [
                { name: 'start_date', type: 'date', required: false, default: 'FIRST_DAY_OF_MONTH' },
                { name: 'end_date', type: 'date', required: false, default: 'TODAY' }
            ],
            query: `
                SELECT 
                    transaction.trandate AS date,
                    transaction.type AS type,
                    transaction.tranid AS number,
                    BUILTIN.DF(transaction.entity) AS entity,
                    transaction.foreigntotal AS amount,
                    transaction.status AS status
                FROM transaction
                WHERE transaction.trandate BETWEEN TO_DATE('{start_date}', 'YYYY-MM-DD') AND TO_DATE('{end_date}', 'YYYY-MM-DD')
                    AND transaction.posting = 'T'
                    AND transaction.voided = 'F'
                ORDER BY transaction.trandate DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Date', 'Type', 'Number', 'Entity', 'Amount', 'Status'],
                formatting: { date: 'date', amount: 'currency' }
            }
        },
        // ==========================================
        // FINANCIAL STATEMENTS
        // ==========================================
        {
            id: 'balance_sheet',
            name: 'Balance Sheet',
            description: 'Assets, Liabilities, and Equity balances as of a specific date',
            category: 'FINANCIAL_STATEMENTS',
            keywords: ['balance sheet', 'assets', 'liabilities', 'equity', 'financial position', 'net worth'],
            parameters: [
                { name: 'as_of_date', type: 'date', required: false, description: 'Balance sheet date', default: 'TODAY' }
            ],
            query: `
                SELECT 
                    account.acctnumber AS account_number,
                    account.accountsearchdisplayname AS account_name,
                    account.accttype AS account_type,
                    CASE 
                        WHEN account.accttype IN ('Bank', 'AcctRec', 'OthCurrAsset', 'FixedAsset', 'OthAsset', 'UnbilledRec', 'DeferExpense') THEN 'Assets'
                        WHEN account.accttype IN ('AcctPay', 'CredCard', 'OthCurrLiab', 'LongTermLiab', 'DeferRevenue') THEN 'Liabilities'
                        WHEN account.accttype IN ('Equity', 'RetainEarn', 'NetIncome') THEN 'Equity'
                        ELSE 'Other'
                    END AS category,
                    CASE 
                        WHEN account.accttype IN ('Bank', 'AcctRec', 'OthCurrAsset', 'FixedAsset', 'OthAsset', 'UnbilledRec', 'DeferExpense') THEN account.balance
                        ELSE -account.balance
                    END AS balance,
                    CASE 
                        WHEN account.accttype = 'Bank' THEN 1
                        WHEN account.accttype = 'AcctRec' THEN 2
                        WHEN account.accttype = 'UnbilledRec' THEN 3
                        WHEN account.accttype = 'OthCurrAsset' THEN 4
                        WHEN account.accttype = 'FixedAsset' THEN 5
                        WHEN account.accttype = 'OthAsset' THEN 6
                        WHEN account.accttype = 'DeferExpense' THEN 7
                        WHEN account.accttype = 'AcctPay' THEN 10
                        WHEN account.accttype = 'CredCard' THEN 11
                        WHEN account.accttype = 'OthCurrLiab' THEN 12
                        WHEN account.accttype = 'LongTermLiab' THEN 13
                        WHEN account.accttype = 'DeferRevenue' THEN 14
                        WHEN account.accttype = 'Equity' THEN 20
                        WHEN account.accttype = 'RetainEarn' THEN 21
                        WHEN account.accttype = 'NetIncome' THEN 22
                        ELSE 99
                    END AS sort_order
                FROM account
                WHERE account.isinactive = 'F'
                    AND account.accttype IN ('Bank', 'AcctRec', 'OthCurrAsset', 'FixedAsset', 'OthAsset', 'UnbilledRec', 'DeferExpense',
                                             'AcctPay', 'CredCard', 'OthCurrLiab', 'LongTermLiab', 'DeferRevenue',
                                             'Equity', 'RetainEarn')
                    AND account.balance != 0
                ORDER BY sort_order, account.acctnumber
            `,
            resultFormat: {
                type: 'table',
                variant: 'balance_sheet',
                columns: ['Account #', 'Account', 'Type', 'Category', 'Balance'],
                formatting: { balance: 'currency' },
                groupBy: 'category',
                showSubtotals: true,
                reportHeader: true
            },
            followUpSuggestions: [
                'Show AR aging breakdown',
                'What are our current liabilities?',
                'Show cash position'
            ]
        },

        // ==========================================
        // ADVANCED FINANCIAL REPORTING (from research)
        // ==========================================
        {
            id: 'income_statement',
            name: 'Income Statement',
            description: 'Profit & Loss statement showing revenue, expenses, and net income by account. Uses TransactionAccountingLine for accurate GL impact.',
            category: 'FINANCIAL_STATEMENTS',
            complexity: 'medium',
            primary_table: 'TransactionAccountingLine',
            keywords: ['income statement', 'profit and loss', 'p&l', 'pnl', 'profit loss', 'net income', 'revenue expenses', 'accurate income statement', 'gl income statement'],
            answers: [
                'What is our P&L?',
                'Show income statement',
                'Revenue and expenses',
                'What is our profit?'
            ],
            does_not_answer: [
                'P&L by department (use department_pl_summary)',
                'Quick summary (use income_statement_summary)'
            ],
            parameters: [
                { name: 'start_date', type: 'date', required: false, default: 'FISCAL_YEAR_START' },
                { name: 'end_date', type: 'date', required: false, default: 'TODAY' }
            ],
            query: `
                SELECT
                    BUILTIN.DF(Account.accttype) AS account_type_name,
                    Account.accttype AS account_type,
                    Account.acctnumber AS account_number,
                    Account.accountsearchdisplayname AS account_name,
                    SUM(
                        CASE
                            WHEN Account.accttype IN ('Income', 'OthIncome') THEN -TransactionAccountingLine.amount
                            ELSE TransactionAccountingLine.amount
                        END
                    ) AS amount
                FROM Transaction
                INNER JOIN TransactionAccountingLine ON Transaction.id = TransactionAccountingLine.transaction
                INNER JOIN Account ON TransactionAccountingLine.account = Account.id
                INNER JOIN accountingperiod ap ON Transaction.postingperiod = ap.id
                WHERE Transaction.posting = 'T'
                    AND Transaction.voided = 'F'
                    AND Account.accttype IN ('Income', 'COGS', 'Expense', 'OthIncome', 'OthExpense')
                    AND ap.startdate >= TO_DATE('{fiscalYearStart}', 'YYYY-MM-DD')
                    AND ap.enddate <= TO_DATE('{fiscalYearEnd}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                GROUP BY BUILTIN.DF(Account.accttype), Account.accttype, Account.acctnumber, Account.accountsearchdisplayname
                HAVING SUM(TransactionAccountingLine.amount) != 0
                ORDER BY 
                    CASE Account.accttype
                        WHEN 'Income' THEN 1
                        WHEN 'OthIncome' THEN 2
                        WHEN 'COGS' THEN 3
                        WHEN 'Expense' THEN 4
                        WHEN 'OthExpense' THEN 5
                    END,
                    Account.acctnumber
            `,
            resultFormat: {
                type: 'table',
                variant: 'income_statement',
                columns: ['Type', 'Account #', 'Account', 'Amount'],
                formatting: { amount: 'currency' },
                groupBy: 'account_type',
                reportHeader: true,
                calculatedTotals: [
                    { id: 'gross_profit', label: 'Gross Profit', formula: 'income + othincome - cogs', style: 'subtotal' },
                    { id: 'net_income', label: 'Net Income', formula: 'income + othincome - cogs - expense - othexpense', style: 'grand' }
                ]
            },
            followUpSuggestions: [
                'Show P&L for a specific department',
                'What is our gross margin?',
                'Show expenses by category'
            ]
        },
        {
            id: 'income_statement_by_department',
            name: 'Department P&L',
            description: 'Profit and Loss breakdown for a specific department showing Revenue, COGS, Expenses by account with full detail.',
            category: 'FINANCIAL_STATEMENTS',
            complexity: 'medium',
            primary_table: 'TransactionLine',
            keywords: ['department p&l', 'p&l for department', 'show p&l for', 'income statement for department', 'department income statement', 'p&l breakdown department', 'department profit loss', 'how is department doing', 'department profitability', 'single department p&l', 'one department p&l', 'specific department p&l'],
            answers: [
                'Show P&L for a specific department',
                'What is the income statement for department X?',
                'Department breakdown by account type',
                'How is department X doing?'
            ],
            does_not_answer: [
                'All departments at once (use income_statement_by_all_departments)',
                'Comparative P&L across multiple departments (use income_statement_by_all_departments)',
                'Departmental P&L without specifying which department (use income_statement_by_all_departments)'
            ],
            parameters: [
                { name: 'department_id', type: 'number', required: true, description: 'Department internal ID from entity resolution' },
                { name: 'fiscal_year', type: 'string', required: false, default: 'current', description: 'current, previous, or specific year' }
            ],
            query: `
                SELECT 
                    BUILTIN.DF(TransactionLine.department) AS department,
                    Account.acctnumber AS account_number,
                    Account.accountsearchdisplayname AS account_name,
                    BUILTIN.DF(Account.accttype) AS account_type_name,
                    Account.accttype AS account_type,
                    SUM(
                        CASE
                            WHEN Account.accttype IN ('Income', 'OthIncome') THEN -TransactionLine.netamount
                            ELSE TransactionLine.netamount
                        END
                    ) AS amount
                FROM TransactionLine
                INNER JOIN Transaction ON TransactionLine.transaction = Transaction.id
                INNER JOIN Account ON TransactionLine.expenseaccount = Account.id
                INNER JOIN accountingperiod ap ON Transaction.postingperiod = ap.id
                WHERE Transaction.posting = 'T'
                    AND Transaction.voided = 'F'
                    AND TransactionLine.department = {department_id}
                    AND TransactionLine.expenseaccount IS NOT NULL
                    AND Account.accttype IN ('Income', 'COGS', 'Expense', 'OthIncome', 'OthExpense')
                    AND ap.startdate >= TO_DATE('{fiscalYearStart}', 'YYYY-MM-DD')
                    AND ap.enddate <= TO_DATE('{fiscalYearEnd}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                GROUP BY BUILTIN.DF(TransactionLine.department), Account.acctnumber, 
                         Account.accountsearchdisplayname, BUILTIN.DF(Account.accttype), Account.accttype
                HAVING SUM(TransactionLine.netamount) != 0
                ORDER BY 
                    CASE Account.accttype
                        WHEN 'Income' THEN 1
                        WHEN 'OthIncome' THEN 2
                        WHEN 'COGS' THEN 3
                        WHEN 'Expense' THEN 4
                        WHEN 'OthExpense' THEN 5
                    END,
                    Account.acctnumber
            `,
            resultFormat: {
                type: 'table',
                variant: 'income_statement',
                columns: ['Department', 'Account #', 'Account', 'Type', 'Amount'],
                formatting: { amount: 'currency' },
                groupBy: 'account_type',
                reportHeader: true,
                calculatedTotals: [
                    { id: 'gross_profit', label: 'Gross Profit', formula: 'income + othincome - cogs', style: 'subtotal' },
                    { id: 'net_income', label: 'Net Income', formula: 'income + othincome - cogs - expense - othexpense', style: 'grand' }
                ]
            },
            followUpSuggestions: [
                'How does this compare to last year?',
                'What are the biggest expenses?',
                'What about another department?'
            ]
        },
        {
            id: 'income_statement_by_all_departments',
            name: 'Departmental P&L (All Departments)',
            description: 'Comparative Profit and Loss showing all departments as columns with account-level detail. Shows Revenue, COGS, Expenses, Gross Profit, and Net Income for each department side by side.',
            category: 'FINANCIAL_STATEMENTS',
            complexity: 'medium',
            primary_table: 'TransactionLine',
            keywords: ['departmental p&l', 'departmental pnl', 'departmental income statement', 'p&l all departments', 'comparative p&l by department', 'p&l by department', 'department comparison', 'compare departments p&l', 'all departments p&l', 'multi department p&l', 'departments as columns'],
            answers: [
                'Show departmental P&L',
                'P&L by department',
                'Compare all departments',
                'Departmental income statement',
                'How are departments performing?',
                'Show me a departmental p&l with departments as columns'
            ],
            does_not_answer: [
                'P&L for a specific single department (use income_statement_by_department)',
                'Department filtered view (use income_statement_by_department)'
            ],
            parameters: [
                { name: 'fiscal_year', type: 'string', required: false, default: 'current', description: 'current, previous, or specific year' }
            ],
            query: `
                SELECT
                    Account.acctnumber AS account_number,
                    Account.accountsearchdisplayname AS account_name,
                    Account.accttype AS account_type,
                    BUILTIN.DF(Account.accttype) AS account_type_name,
                    BUILTIN.DF(TransactionLine.department) AS department,
                    SUM(
                        CASE
                            WHEN Account.accttype IN ('Income', 'OthIncome') THEN -TransactionLine.netamount
                            ELSE TransactionLine.netamount
                        END
                    ) AS amount
                FROM TransactionLine
                INNER JOIN Transaction ON TransactionLine.transaction = Transaction.id
                INNER JOIN Account ON TransactionLine.expenseaccount = Account.id
                INNER JOIN accountingperiod ap ON Transaction.postingperiod = ap.id
                WHERE Transaction.posting = 'T'
                    AND Transaction.voided = 'F'
                    AND TransactionLine.department IS NOT NULL
                    AND TransactionLine.expenseaccount IS NOT NULL
                    AND Account.accttype IN ('Income', 'COGS', 'Expense', 'OthIncome', 'OthExpense')
                    AND ap.startdate >= TO_DATE('{fiscalYearStart}', 'YYYY-MM-DD')
                    AND ap.enddate <= TO_DATE('{fiscalYearEnd}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                GROUP BY Account.acctnumber, Account.accountsearchdisplayname, Account.accttype, 
                         BUILTIN.DF(Account.accttype), BUILTIN.DF(TransactionLine.department)
                HAVING SUM(TransactionLine.netamount) != 0
                ORDER BY 
                    CASE Account.accttype
                        WHEN 'Income' THEN 1
                        WHEN 'OthIncome' THEN 2
                        WHEN 'COGS' THEN 3
                        WHEN 'Expense' THEN 4
                        WHEN 'OthExpense' THEN 5
                    END,
                    Account.acctnumber
            `,
            resultFormat: {
                type: 'table',
                variant: 'grouped',
                columns: ['Account #', 'Account', 'Type', 'Department', 'Amount'],
                groupBy: 'account_type',
                formatting: { amount: 'currency' },
                showSubtotals: true,
                hideGroupColumn: true,
                pivotConfig: {
                    enabled: true,
                    rowField: 'account_name',
                    columnField: 'department',
                    valueField: 'amount',
                    showTotalColumn: true,
                    rowGroupField: 'account_type'
                },
                calculatedTotals: [
                    { id: 'gross_profit', label: 'Gross Profit', formula: 'income + othincome - cogs', style: 'subtotal' },
                    { id: 'net_income', label: 'Net Income', formula: 'income + othincome - cogs - expense - othexpense', style: 'grand' }
                ]
            },
            followUpSuggestions: [
                'Show P&L for just one department',
                'Which department is most profitable?',
                'Compare to last year'
            ]
        },
        {
            id: 'ar_aging_detail_tal',
            name: 'AR Aging Detail (Accurate)',
            description: 'Accounts receivable aging using TransactionAccountingLine for accurate open balance including partial payments and credits.',
            category: 'AR',
            complexity: 'medium',
            primary_table: 'TransactionAccountingLine',
            keywords: ['ar aging detail', 'detailed ar aging', 'accurate ar', 'ar with payments', 'open invoices detail'],
            answers: [
                'Show detailed AR aging',
                'What invoices are open with accurate balances?',
                'AR detail including partial payments'
            ],
            does_not_answer: [
                'Summary by customer (use ar_aging_summary)',
                'Just totals (use ar_aging_totals)',
                'AP aging (use ap_aging templates)'
            ],
            parameters: [],
            query: `
                SELECT 
                    BUILTIN.DF(Transaction.entity) AS customer,
                    Transaction.type AS transaction_type,
                    Transaction.trandate AS date,
                    Transaction.tranid AS document_number,
                    Transaction.otherrefnum AS po_number,
                    Transaction.duedate,
                    (TRUNC(SYSDATE) - Transaction.duedate) AS days_overdue,
                    (COALESCE(TransactionAccountingLine.amountunpaid, 0) - 
                     COALESCE(TransactionAccountingLine.paymentamountunused, 0)) AS open_balance,
                    CASE
                        WHEN TRUNC(SYSDATE - Transaction.duedate) <= 0 THEN 'Current'
                        WHEN TRUNC(SYSDATE - Transaction.duedate) BETWEEN 1 AND 30 THEN '1-30 Days'
                        WHEN TRUNC(SYSDATE - Transaction.duedate) BETWEEN 31 AND 60 THEN '31-60 Days'
                        WHEN TRUNC(SYSDATE - Transaction.duedate) BETWEEN 61 AND 90 THEN '61-90 Days'
                        ELSE 'Over 90 Days'
                    END AS aging_bucket
                FROM Transaction
                INNER JOIN TransactionAccountingLine ON TransactionAccountingLine.transaction = Transaction.id
                WHERE Transaction.posting = 'T'
                    AND Transaction.voided = 'F'
                    AND Transaction.voided = 'F'
                    AND Transaction.type IN ('CustInvc', 'CustCred')
                    AND ((TransactionAccountingLine.amountunpaid <> 0) 
                         OR (TransactionAccountingLine.paymentamountunused <> 0))
                ORDER BY Transaction.duedate, Transaction.tranid

            `,
            resultFormat: {
                type: 'table',
                columns: ['Customer', 'Type', 'Date', 'Doc #', 'PO #', 'Due Date', 'Days Over', 'Balance', 'Bucket'],
                formatting: { date: 'date', duedate: 'date', open_balance: 'currency' }
            }
        },
        {
            id: 'ar_aging_summary_tal',
            name: 'AR Aging Summary (Accurate)',
            description: 'Summarized AR aging with buckets grouped by customer using TransactionAccountingLine for accuracy.',
            category: 'AR',
            complexity: 'medium',
            primary_table: 'TransactionAccountingLine',
            keywords: ['ar summary by customer', 'customer ar aging', 'aging buckets', 'ar buckets by customer'],
            answers: [
                'Show AR aging by customer',
                'What do customers owe by aging bucket?',
                'Customer balances with aging breakdown'
            ],
            does_not_answer: [
                'Individual invoice details (use ar_aging_detail_tal)',
                'Just total AR (use ar_aging_totals)',
                'Single customer balance (use customer_balance)'
            ],
            parameters: [],
            query: `
                SELECT
                    BUILTIN.DF(Transaction.entity) AS customer,
                    SUM(CASE WHEN (TRUNC(SYSDATE) - Transaction.duedate) < 1 
                        THEN COALESCE(TransactionAccountingLine.amountunpaid, 0) - COALESCE(TransactionAccountingLine.paymentamountunused, 0) 
                        ELSE 0 END) AS current_balance,
                    SUM(CASE WHEN (TRUNC(SYSDATE) - Transaction.duedate) BETWEEN 1 AND 30 
                        THEN COALESCE(TransactionAccountingLine.amountunpaid, 0) - COALESCE(TransactionAccountingLine.paymentamountunused, 0) 
                        ELSE 0 END) AS days_1_30,
                    SUM(CASE WHEN (TRUNC(SYSDATE) - Transaction.duedate) BETWEEN 31 AND 60 
                        THEN COALESCE(TransactionAccountingLine.amountunpaid, 0) - COALESCE(TransactionAccountingLine.paymentamountunused, 0) 
                        ELSE 0 END) AS days_31_60,
                    SUM(CASE WHEN (TRUNC(SYSDATE) - Transaction.duedate) BETWEEN 61 AND 90 
                        THEN COALESCE(TransactionAccountingLine.amountunpaid, 0) - COALESCE(TransactionAccountingLine.paymentamountunused, 0) 
                        ELSE 0 END) AS days_61_90,
                    SUM(CASE WHEN (TRUNC(SYSDATE) - Transaction.duedate) > 90 
                        THEN COALESCE(TransactionAccountingLine.amountunpaid, 0) - COALESCE(TransactionAccountingLine.paymentamountunused, 0) 
                        ELSE 0 END) AS over_90_days,
                    SUM(COALESCE(TransactionAccountingLine.amountunpaid, 0) - COALESCE(TransactionAccountingLine.paymentamountunused, 0)) AS total
                FROM Transaction
                INNER JOIN TransactionAccountingLine ON TransactionAccountingLine.transaction = Transaction.id
                WHERE Transaction.posting = 'T'
                    AND Transaction.voided = 'F'
                    AND Transaction.voided = 'F'
                    AND Transaction.type IN ('CustInvc', 'CustCred')
                    AND ((TransactionAccountingLine.amountunpaid <> 0) OR (TransactionAccountingLine.paymentamountunused <> 0))
                GROUP BY BUILTIN.DF(Transaction.entity)
                HAVING SUM(COALESCE(TransactionAccountingLine.amountunpaid, 0) - COALESCE(TransactionAccountingLine.paymentamountunused, 0)) > 0
                ORDER BY total DESC

            `,
            resultFormat: {
                type: 'table',
                columns: ['Customer', 'Current', '1-30', '31-60', '61-90', '90+', 'Total'],
                formatting: { 
                    current_balance: 'currency', days_1_30: 'currency', days_31_60: 'currency',
                    days_61_90: 'currency', over_90_days: 'currency', total: 'currency'
                },
                showTotal: true
            }
        },
        {
            id: 'trial_balance_ytd',
            name: 'Trial Balance (YTD)',
            description: 'Year-to-date trial balance showing account balances with debit/credit breakdown',
            category: 'FINANCIAL_STATEMENTS',
            complexity: 'medium',
            primary_table: 'TransactionAccountingLine',
            keywords: ['trial balance ytd', 'ytd trial balance', 'account balances ytd', 'tb ytd', 'debit credit balances'],
            answers: [
                'Show trial balance for this year',
                'What are account balances YTD?',
                'Debit and credit totals by account'
            ],
            does_not_answer: [
                'As-of-date balance (use balance_sheet)',
                'Single account detail (use gl_account_detail)',
                'Monthly breakdown (use gl_by_month)'
            ],
            parameters: [
                { name: 'as_of_date', type: 'date', required: false, default: 'TODAY' }
            ],
            query: `
                SELECT 
                    Account.acctnumber AS account_code,
                    Account.accountsearchdisplayname AS account_name,
                    BUILTIN.DF(Account.accttype) AS account_type,
                    SUM(COALESCE(TransactionAccountingLine.debit, 0)) AS total_debit,
                    SUM(COALESCE(TransactionAccountingLine.credit, 0)) AS total_credit,
                    SUM(COALESCE(TransactionAccountingLine.debit, 0)) - SUM(COALESCE(TransactionAccountingLine.credit, 0)) AS net_balance
                FROM Transaction
                INNER JOIN TransactionAccountingLine ON Transaction.id = TransactionAccountingLine.transaction
                INNER JOIN Account ON TransactionAccountingLine.account = Account.id
                WHERE Transaction.trandate >= TO_DATE('{fiscalYearStart}', 'YYYY-MM-DD')
                    AND Transaction.trandate <= TO_DATE('{fiscalYearEnd}', 'YYYY-MM-DD')
                    AND Transaction.posting = 'T'
                    AND Transaction.voided = 'F'
                    AND Account.isinactive = 'F'
                    AND Account.issummary = 'F'
                GROUP BY Account.acctnumber, Account.accountsearchdisplayname, BUILTIN.DF(Account.accttype)
                HAVING SUM(COALESCE(TransactionAccountingLine.debit, 0)) - SUM(COALESCE(TransactionAccountingLine.credit, 0)) != 0
                ORDER BY Account.acctnumber
            `,
            resultFormat: {
                type: 'table',
                variant: 'financial_statement',
                columns: ['Account #', 'Account Name', 'Type', 'Debit', 'Credit', 'Net Balance'],
                formatting: { total_debit: 'currency', total_credit: 'currency', net_balance: 'currency' },
                groupBy: 'account_type',
                hideGroupColumn: true
            }
        },
        {
            id: 'gl_detail_by_transaction',
            name: 'GL Impact Detail',
            description: 'Shows the general ledger debit/credit impact of a specific transaction',
            category: 'GL',
            complexity: 'low',
            primary_table: 'TransactionAccountingLine',
            keywords: ['gl detail', 'gl impact', 'journal entry detail', 'transaction gl', 'debit credit detail', 'accounting entry'],
            answers: [
                'Show GL impact of transaction X',
                'What accounts were debited/credited?',
                'Journal entry details'
            ],
            does_not_answer: [
                'All transactions for an account (use gl_account_detail)',
                'Summary balances (use trial_balance)'
            ],
            parameters: [
                { name: 'transaction_id', type: 'number', required: true, description: 'Internal ID of transaction' }
            ],
            query: `
                SELECT
                    BUILTIN.DF(TransactionAccountingLine.account) AS account,
                    Account.acctnumber AS account_number,
                    TransactionAccountingLine.debit,
                    TransactionAccountingLine.credit,
                    TransactionLine.memo,
                    BUILTIN.DF(TransactionLine.department) AS department,
                    BUILTIN.DF(TransactionLine.class) AS class
                FROM TransactionAccountingLine
                INNER JOIN TransactionLine ON TransactionLine.transaction = TransactionAccountingLine.transaction
                    AND TransactionLine.id = TransactionAccountingLine.transactionline
                INNER JOIN Account ON Account.id = TransactionAccountingLine.account
                WHERE TransactionAccountingLine.transaction = {transaction_id}
                    AND (TransactionAccountingLine.debit IS NOT NULL OR TransactionAccountingLine.credit IS NOT NULL)
                ORDER BY TransactionLine.linesequencenumber
            `,
            resultFormat: {
                type: 'table',
                columns: ['Account', 'Account #', 'Debit', 'Credit', 'Memo', 'Department', 'Class'],
                formatting: { debit: 'currency', credit: 'currency' }
            }
        },
        {
            id: 'journal_entries_by_period',
            name: 'Journal Entries',
            description: 'List journal entries for a period with full debit/credit detail',
            category: 'GL',
            complexity: 'medium',
            primary_table: 'TransactionAccountingLine',
            keywords: ['journal entries', 'je list', 'journals', 'manual entries', 'adjusting entries'],
            answers: [
                'Show journal entries this month',
                'List all JEs',
                'What journal entries were made?'
            ],
            does_not_answer: [
                'Specific JE detail (use gl_detail_by_transaction)',
                'Non-JE transactions (use transaction templates)'
            ],
            parameters: [
                { name: 'start_date', type: 'date', required: false, default: 'FIRST_DAY_OF_MONTH' },
                { name: 'end_date', type: 'date', required: false, default: 'TODAY' }
            ],
            query: `
                SELECT 
                    Transaction.id AS internal_id,
                    Transaction.tranid AS document_number,
                    Transaction.trandate AS date,
                    BUILTIN.DF(Transaction.postingperiod) AS posting_period,
                    Transaction.memo,
                    BUILTIN.DF(TransactionAccountingLine.account) AS account,
                    TransactionAccountingLine.debit,
                    TransactionAccountingLine.credit,
                    BUILTIN.DF(TransactionLine.department) AS department
                FROM Transaction
                INNER JOIN TransactionAccountingLine ON TransactionAccountingLine.transaction = Transaction.id
                LEFT JOIN TransactionLine ON TransactionLine.transaction = Transaction.id 
                    AND TransactionLine.id = TransactionAccountingLine.transactionline
                WHERE Transaction.type = 'Journal'
                    AND Transaction.voided = 'F'
                    AND Transaction.trandate >= TO_DATE('{fiscalYearStart}', 'YYYY-MM-DD')
                    AND Transaction.trandate <= TO_DATE('{fiscalYearEnd}', 'YYYY-MM-DD')
                    AND (TransactionAccountingLine.debit IS NOT NULL OR TransactionAccountingLine.credit IS NOT NULL)
                ORDER BY Transaction.trandate DESC, Transaction.tranid, TransactionLine.linesequencenumber

            `,
            resultFormat: {
                type: 'table',
                columns: ['ID', 'Doc #', 'Date', 'Period', 'Memo', 'Account', 'Debit', 'Credit', 'Dept'],
                formatting: { date: 'date', debit: 'currency', credit: 'currency' }
            }
        },
        {
            id: 'order_lifecycle',
            name: 'Order Lifecycle Tracking',
            description: 'Track complete order-to-cash lifecycle: Sales Order → Fulfillment → Invoice → Payment',
            category: 'TRANSACTIONS',
            complexity: 'high',
            primary_table: 'NextTransactionLineLink',
            keywords: ['order lifecycle', 'order to cash', 'so to invoice', 'order status', 'fulfillment status', 'order tracking'],
            answers: [
                'Track order through fulfillment to invoice',
                'What is the status of order X through payment?',
                'Order-to-cash tracking'
            ],
            does_not_answer: [
                'Single order details (use find_sales_order)',
                'Unfulfilled orders only (use open_sales_orders)',
                'Payment details only (use payment templates)'
            ],
            parameters: [
                { name: 'days', type: 'number', required: false, default: 30 }
            ],
            query: `
                SELECT
                    so.tranid AS sales_order,
                    so.trandate AS order_date,
                    BUILTIN.DF(so.entity) AS customer,
                    BUILTIN.DF(sol.item) AS item,
                    ABS(sol.quantity) AS qty_ordered,
                    fulfill.tranid AS fulfillment,
                    fulfill.trandate AS ship_date,
                    inv.tranid AS invoice,
                    inv.trandate AS invoice_date,
                    pymt.tranid AS payment,
                    pymt.trandate AS payment_date
                FROM Transaction so
                INNER JOIN TransactionLine sol ON sol.transaction = so.id AND sol.mainline = 'F'
                LEFT JOIN NextTransactionLineLink link_ship ON so.id = link_ship.previousdoc AND link_ship.previousline = sol.id
                LEFT JOIN Transaction fulfill ON link_ship.nextdoc = fulfill.id AND fulfill.type = 'ItemShip'
                LEFT JOIN NextTransactionLineLink link_inv ON so.id = link_inv.previousdoc
                LEFT JOIN Transaction inv ON link_inv.nextdoc = inv.id AND inv.type = 'CustInvc'
                LEFT JOIN NextTransactionLineLink link_pymt ON inv.id = link_pymt.previousdoc
                LEFT JOIN Transaction pymt ON link_pymt.nextdoc = pymt.id AND pymt.type = 'CustPymt'
                WHERE so.type = 'SalesOrd'
                    AND so.trandate >= CURRENT_DATE - 30
                ORDER BY so.trandate DESC, so.tranid

            `,
            resultFormat: {
                type: 'table',
                columns: ['SO #', 'Order Date', 'Customer', 'Item', 'Qty', 'Fulfillment', 'Ship Date', 'Invoice', 'Inv Date', 'Payment', 'Pmt Date'],
                formatting: { 
                    order_date: 'date', ship_date: 'date', invoice_date: 'date', payment_date: 'date'
                }
            }
        },
        {
            id: 'invoice_payment_application',
            name: 'Invoice Payment Application',
            description: 'Shows payments applied to invoices with application details',
            category: 'AR',
            complexity: 'medium',
            primary_table: 'NextTransactionLineLink',
            keywords: ['payment application', 'invoice payments', 'applied payments', 'payment to invoice', 'payment allocation'],
            answers: [
                'What payments are applied to invoice X?',
                'Show payment application details',
                'How was this invoice paid?'
            ],
            does_not_answer: [
                'Open invoices (use ar_aging templates)',
                'All payments (use recent_customer_payments)',
                'Unapplied payments (need different query)'
            ],
            parameters: [
                { name: 'invoice_id', type: 'number', required: false, description: 'Invoice internal ID (optional)' }
            ],
            query: `
                SELECT 
                    inv.tranid AS invoice_number,
                    inv.trandate AS invoice_date,
                    inv.foreigntotal AS invoice_total,
                    BUILTIN.DF(inv.entity) AS customer,
                    pymt.tranid AS payment_number,
                    pymt.trandate AS payment_date,
                    pymt.foreigntotal AS payment_amount,
                    REPLACE(BUILTIN.DF(pymt.status), BUILTIN.DF(pymt.type) || ' : ', '') AS payment_status
                FROM Transaction inv
                INNER JOIN NextTransactionLineLink ntll ON ntll.previousdoc = inv.id
                INNER JOIN Transaction pymt ON pymt.id = ntll.nextdoc AND pymt.type = 'CustPymt'
                WHERE inv.type = 'CustInvc'
                    AND inv.trandate >= ADD_MONTHS(CURRENT_DATE, -6)
                ORDER BY inv.trandate DESC, inv.tranid, pymt.trandate

            `,
            resultFormat: {
                type: 'table',
                columns: ['Invoice #', 'Inv Date', 'Invoice Total', 'Customer', 'Payment #', 'Pmt Date', 'Payment Amt', 'Status'],
                formatting: { 
                    invoice_date: 'date', payment_date: 'date', 
                    invoice_total: 'currency', payment_amount: 'currency'
                }
            }
        },
        {
            id: 'inventory_by_location_bin',
            name: 'Inventory by Location and Bin',
            description: 'Inventory quantities by location and bin for detailed warehouse management',
            category: 'INVENTORY',
            complexity: 'medium',
            primary_table: 'InventoryItemLocations',
            keywords: ['inventory by bin', 'bin inventory', 'warehouse inventory', 'stock by location', 'inventory location'],
            answers: [
                'Where is item X located?',
                'Show inventory by bin',
                'Stock levels by warehouse location'
            ],
            does_not_answer: [
                'Total inventory only (use inventory_summary)',
                'Serial/lot numbers (use inventory_serial_lots)',
                'Inventory value (use inventory_valuation)'
            ],
            parameters: [
                { name: 'item_id', type: 'number', required: false, description: 'Specific item ID (optional)' }
            ],
            query: `
                SELECT
                    item.itemid AS item_number,
                    item.displayname AS item_name,
                    BUILTIN.DF(iil.location) AS location,
                    iil.quantityonhand AS on_hand,
                    iil.quantityavailable AS available,
                    iil.quantitycommitted AS committed,
                    iil.quantityonorder AS on_order,
                    iil.quantitybackordered AS backordered
                FROM inventoryitemlocations iil
                INNER JOIN item ON item.id = iil.item
                WHERE item.isinactive = 'F'
                    AND (iil.quantityonhand != 0 OR iil.quantityonorder != 0)
                ORDER BY item.itemid, location

            `,
            resultFormat: {
                type: 'table',
                columns: ['Item #', 'Item Name', 'Location', 'On Hand', 'Available', 'Committed', 'On Order', 'Backordered'],
                formatting: {}
            }
        },
        {
            id: 'sales_velocity',
            name: 'Item Sales Velocity',
            description: 'Sales velocity analysis showing quantities sold over 30, 90, 365 days with inventory metrics',
            category: 'INVENTORY',
            complexity: 'high',
            primary_table: 'Item',
            keywords: ['sales velocity', 'item velocity', 'fast movers', 'slow movers', 'inventory turnover', 'item sales rate'],
            answers: [
                'What are our fastest selling items?',
                'Item sales velocity',
                'How fast do items sell?'
            ],
            does_not_answer: [
                'Total sales by item (use item_revenue templates)',
                'Current inventory only (use inventory templates)',
                'Revenue analysis (use revenue templates)'
            ],
            parameters: [],
            query: `
                SELECT
                    Item.itemid AS item_number,
                    BUILTIN.DF(Item.parent) AS parent_item,
                    Item.description,
                    Item.quantityonhand AS on_hand,
                    Item.quantityavailable AS available,
                    (SELECT SUM(ABS(tl.quantity))
                     FROM TransactionLine tl
                     INNER JOIN Transaction t ON t.id = tl.transaction
                     WHERE tl.item = Item.id AND t.type = 'CustInvc' AND t.posting = 'T' AND t.voided = 'F'
                     AND t.trandate >= CURRENT_DATE - 30) AS qty_sold_30d,
                    (SELECT SUM(ABS(tl.quantity))
                     FROM TransactionLine tl
                     INNER JOIN Transaction t ON t.id = tl.transaction
                     WHERE tl.item = Item.id AND t.type = 'CustInvc' AND t.posting = 'T' AND t.voided = 'F'
                     AND t.trandate >= CURRENT_DATE - 90) AS qty_sold_90d,
                    (SELECT SUM(ABS(tl.quantity))
                     FROM TransactionLine tl
                     INNER JOIN Transaction t ON t.id = tl.transaction
                     WHERE tl.item = Item.id AND t.type = 'CustInvc' AND t.posting = 'T' AND t.voided = 'F'
                     AND t.trandate >= CURRENT_DATE - 365) AS qty_sold_1yr
                FROM Item
                WHERE Item.itemtype = 'InvtPart'
                    AND Item.isinactive = 'F'
                    AND (Item.quantityonhand > 0 OR Item.quantityonorder > 0)
                ORDER BY qty_sold_90d DESC NULLS LAST

            `,
            resultFormat: {
                type: 'table',
                columns: ['Item #', 'Parent', 'Description', 'On Hand', 'Available', '30-Day Sales', '90-Day Sales', '1-Yr Sales'],
                formatting: {}
            }
        },
        {
            id: 'gl_account_activity',
            name: 'GL Account Activity',
            description: 'Detailed general ledger activity for a specific account showing all transactions',
            category: 'GL',
            complexity: 'medium',
            primary_table: 'TransactionAccountingLine',
            keywords: ['account activity', 'gl activity', 'account detail', 'account transactions', 'account history'],
            answers: [
                'Show activity for account X',
                'What transactions hit this GL account?',
                'Account transaction detail'
            ],
            does_not_answer: [
                'All account balances (use trial_balance)',
                'Balance sheet (use balance_sheet)',
                'Summary only (use account_balance)'
            ],
            parameters: [
                { name: 'account_id', type: 'number', required: true, description: 'GL Account internal ID' }
            ],
            query: `
                SELECT
                    Transaction.trandate AS date,
                    Transaction.tranid AS document,
                    BUILTIN.DF(Transaction.type) AS type,
                    BUILTIN.DF(Transaction.entity) AS entity,
                    TransactionLine.memo,
                    TransactionAccountingLine.debit,
                    TransactionAccountingLine.credit,
                    SUM(COALESCE(TransactionAccountingLine.debit, 0) - COALESCE(TransactionAccountingLine.credit, 0)) 
                        OVER (ORDER BY Transaction.trandate, Transaction.id) AS running_balance
                FROM TransactionAccountingLine
                INNER JOIN Transaction ON Transaction.id = TransactionAccountingLine.transaction
                LEFT JOIN TransactionLine ON TransactionLine.transaction = TransactionAccountingLine.transaction
                    AND TransactionLine.id = TransactionAccountingLine.transactionline
                WHERE TransactionAccountingLine.account = {account_id}
                    AND Transaction.posting = 'T'
                    AND Transaction.voided = 'F'
                    AND Transaction.trandate >= TO_DATE('{fiscalYearStart}', 'YYYY-MM-DD')
                ORDER BY Transaction.trandate, Transaction.id

            `,
            resultFormat: {
                type: 'table',
                columns: ['Date', 'Document', 'Type', 'Entity', 'Memo', 'Debit', 'Credit', 'Running Bal'],
                formatting: { date: 'date', debit: 'currency', credit: 'currency', running_balance: 'currency' }
            }
        },
        {
            id: 'comparative_pl',
            name: 'Comparative P&L (YTD vs Prior YTD)',
            description: 'Income statement comparing current YTD to same period last year. AI can customize date ranges.',
            category: 'FINANCIAL_STATEMENTS',
            complexity: 'high',
            primary_table: 'TransactionAccountingLine',
            keywords: ['comparative p&l', 'comparative pnl', 'comparative profit and loss', 'pl comparison', 'pnl comparison', 'year over year', 'year over year p&l', 'yoy p&l', 'yoy pnl', 'yoy comparison', 'this year vs last year', 'this year vs last', 'pl vs prior year', 'p&l vs prior year', 'compare p&l', 'compare pnl', 'p&l year over year', 'income statement comparison', 'income statement vs last year', 'ytd vs prior ytd', 'ytd comparison'],
            answers: [
                'Compare P&L to last year',
                'Year over year income statement',
                'How does revenue compare to last year?',
                'YTD vs prior YTD'
            ],
            does_not_answer: [
                'Single period P&L (use income_statement)',
                'Monthly trend (use income_statement_monthly)',
                'Budget comparison (use budget_vs_actual)'
            ],
            parameters: [
                { name: 'current_start', type: 'date', required: false, default: 'FISCAL_YEAR_START', description: 'Start of current period' },
                { name: 'current_end', type: 'date', required: false, default: 'TODAY', description: 'End of current period (default: today for YTD)' },
                { name: 'prior_start', type: 'date', required: false, default: 'PRIOR_FISCAL_YEAR_START', description: 'Start of prior period' },
                { name: 'prior_end', type: 'date', required: false, default: 'PRIOR_YTD_END', description: 'End of prior period (default: same day last year)' },
                { name: 'years_back', type: 'integer', required: false, default: 1, description: 'How many years back to compare (1, 2, or 3)' }
            ],
            query: `
                SELECT
                    Account.acctnumber AS account_number,
                    Account.accountsearchdisplayname AS account_name,
                    Account.accttype AS account_type,
                    SUM(CASE 
                        WHEN ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD')
                             AND ap.enddate <= TO_DATE('{currentPeriodEnd}', 'YYYY-MM-DD')
                        THEN CASE WHEN Account.accttype IN ('Income', 'OthIncome') 
                             THEN -TransactionAccountingLine.amount 
                             ELSE TransactionAccountingLine.amount END
                        ELSE 0 
                    END) AS current_period,
                    SUM(CASE 
                        WHEN ap.startdate >= TO_DATE('{priorPeriodStart}', 'YYYY-MM-DD')
                             AND ap.enddate <= TO_DATE('{priorPeriodEnd}', 'YYYY-MM-DD')
                        THEN CASE WHEN Account.accttype IN ('Income', 'OthIncome') 
                             THEN -TransactionAccountingLine.amount 
                             ELSE TransactionAccountingLine.amount END
                        ELSE 0 
                    END) AS prior_period,
                    SUM(CASE 
                        WHEN ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD')
                             AND ap.enddate <= TO_DATE('{currentPeriodEnd}', 'YYYY-MM-DD')
                        THEN CASE WHEN Account.accttype IN ('Income', 'OthIncome') 
                             THEN -TransactionAccountingLine.amount 
                             ELSE TransactionAccountingLine.amount END
                        ELSE 0 
                    END) - SUM(CASE 
                        WHEN ap.startdate >= TO_DATE('{priorPeriodStart}', 'YYYY-MM-DD')
                             AND ap.enddate <= TO_DATE('{priorPeriodEnd}', 'YYYY-MM-DD')
                        THEN CASE WHEN Account.accttype IN ('Income', 'OthIncome') 
                             THEN -TransactionAccountingLine.amount 
                             ELSE TransactionAccountingLine.amount END
                        ELSE 0 
                    END) AS variance
                FROM TransactionAccountingLine
                INNER JOIN Transaction ON Transaction.id = TransactionAccountingLine.transaction
                INNER JOIN Account ON Account.id = TransactionAccountingLine.account
                INNER JOIN accountingperiod ap ON Transaction.postingperiod = ap.id
                WHERE Transaction.posting = 'T'
                    AND Transaction.voided = 'F'
                    AND Account.accttype IN ('Income', 'OthIncome', 'COGS', 'Expense', 'OthExpense')
                    AND ap.startdate >= TO_DATE('{priorPeriodStart}', 'YYYY-MM-DD')
                    AND ap.isyear = 'F'
                    AND ap.isquarter = 'F'
                GROUP BY Account.acctnumber, Account.accountsearchdisplayname, Account.accttype
                HAVING SUM(CASE WHEN ap.startdate >= TO_DATE('{currentPeriodStart}', 'YYYY-MM-DD') AND ap.enddate <= TO_DATE('{currentPeriodEnd}', 'YYYY-MM-DD') THEN TransactionAccountingLine.amount ELSE 0 END) != 0
                    OR SUM(CASE WHEN ap.startdate >= TO_DATE('{priorPeriodStart}', 'YYYY-MM-DD') AND ap.enddate <= TO_DATE('{priorPeriodEnd}', 'YYYY-MM-DD') THEN TransactionAccountingLine.amount ELSE 0 END) != 0
                ORDER BY 
                    CASE Account.accttype
                        WHEN 'Income' THEN 1 WHEN 'OthIncome' THEN 2 WHEN 'COGS' THEN 3 
                        WHEN 'Expense' THEN 4 WHEN 'OthExpense' THEN 5 
                    END,
                    Account.acctnumber
            `,
            resultFormat: {
                type: 'table',
                variant: 'income_statement',
                columns: ['Account #', 'Account', 'Type', 'Current Period', 'Prior Period', 'Variance'],
                formatting: { current_period: 'currency', prior_period: 'currency', variance: 'currency' },
                groupBy: 'account_type',
                reportHeader: true,
                calculatedTotals: [
                    { id: 'gross_profit', label: 'Gross Profit', formula: 'income + othincome - cogs', style: 'subtotal' },
                    { id: 'net_income', label: 'Net Income', formula: 'income + othincome - cogs - expense - othexpense', style: 'grand' }
                ]
            }
        }
    ];

    /**
     * Find a matching template for a user question
     * @param {string} question - User's question
     * @returns {Object|null} { template, params } or null if no match
     */
    function findMatchingTemplate(question, resolvedEntities) {
        const normalized = question.toLowerCase();
        const words = normalized.split(/\s+/);
        
        // ═══════════════════════════════════════════════════════════════
        // FIX #9: Detect entity types for better template selection
        // ═══════════════════════════════════════════════════════════════
        var hasVendorEntity = false;
        var hasCustomerEntity = false;
        if (resolvedEntities) {
            for (var term in resolvedEntities) {
                if (resolvedEntities.hasOwnProperty(term)) {
                    var entity = resolvedEntities[term];
                    if (entity.type === 'vendor') hasVendorEntity = true;
                    if (entity.type === 'customer') hasCustomerEntity = true;
                }
            }
        }
        
        // Score each template
        const scored = TEMPLATES.map(template => {
            let score = 0;
            let matchedKeywords = [];
            
            // ═══════════════════════════════════════════════════════════════
            // FIX #3: TEMPLATE NAME/ID MATCHING - Reduced bonus for short names
            // Short names like "Find Invoice" (2 words) are too generic
            // ═══════════════════════════════════════════════════════════════
            const templateNameWords = template.name.toLowerCase().split(/\s+/);
            const templateIdWords = template.id.toLowerCase().replace(/_/g, ' ').split(/\s+/);
            
            // Count how many template name words appear in the query
            const nameMatchCount = templateNameWords.filter(tw => 
                words.some(qw => qw === tw || qw.includes(tw) || tw.includes(qw))
            ).length;
            const nameMatchRatio = nameMatchCount / templateNameWords.length;
            
            // Count how many template ID words appear in the query  
            const idMatchCount = templateIdWords.filter(tw => 
                words.some(qw => qw === tw || qw.includes(tw) || tw.includes(qw))
            ).length;
            const idMatchRatio = idMatchCount / templateIdWords.length;
            
            // FIX #3: Cap bonus based on template name length
            // Short names (2 words) get max +20, longer names (3+) get up to +40
            const bestRatio = Math.max(nameMatchRatio, idMatchRatio);
            const nameWordCount = Math.max(templateNameWords.length, templateIdWords.length);
            
            if (bestRatio >= 0.8) {
                if (nameWordCount >= 3) {
                    score += 40;  // Strong match for specific templates
                } else {
                    score += 20;  // Reduced bonus for generic 2-word names
                }
                matchedKeywords.push('[name:' + Math.round(bestRatio * 100) + '%]');
            } else if (bestRatio >= 0.6) {
                if (nameWordCount >= 3) {
                    score += 25;
                } else {
                    score += 15;
                }
                matchedKeywords.push('[name:' + Math.round(bestRatio * 100) + '%]');
            } else if (bestRatio >= 0.4) {
                score += 10;
            }
            
            template.keywords.forEach(keyword => {
                const keywordLower = keyword.toLowerCase();
                if (normalized.includes(keywordLower)) {
                    // Base score for keyword match
                    let keywordScore = 10;
                    
                    // Bonus for multi-word keyword matches
                    if (keyword.includes(' ')) {
                        keywordScore *= 2;
                    }
                    
                    // Exact word match bonus (not just substring)
                    const keywordWords = keywordLower.split(/\s+/);
                    const allWordsMatch = keywordWords.every(kw => words.includes(kw));
                    if (allWordsMatch) {
                        keywordScore += 5;
                    }
                    
                    score += keywordScore;
                    matchedKeywords.push(keyword);
                }
            });
            
            // Category relevance bonus for certain question patterns
            if (normalized.includes('department') && template.id.includes('department')) {
                score += 15;
            }
            if (normalized.includes('customer') && template.id.includes('customer')) {
                score += 15;
            }
            if (normalized.includes('vendor') && template.id.includes('vendor')) {
                score += 15;
            }
            if ((normalized.includes('ytd') || normalized.includes('year to date') || normalized.includes('this year')) 
                && template.id.includes('revenue')) {
                score += 10;
            }
            // Transaction lookup bonuses
            if ((normalized.includes('find') || normalized.includes('lookup') || normalized.includes('show')) 
                && template.category === 'TRANSACTIONS') {
                score += 10;
            }
            if (normalized.match(/\b(inv|so|po|je|bill)\s*#?\s*\d+/i) && template.category === 'TRANSACTIONS') {
                score += 20;
            }
            
            // ═══════════════════════════════════════════════════════════════
            // FIX #9: Entity-type aware scoring
            // If we know entity type, boost/penalize templates accordingly
            // ═══════════════════════════════════════════════════════════════
            if (hasVendorEntity) {
                // Boost vendor-related templates
                if (template.category === 'AP' || template.category === 'VENDOR' || 
                    template.id.includes('vendor') || template.id.includes('bill')) {
                    score += 25;
                    matchedKeywords.push('[vendor-entity-boost]');
                }
                // Penalize customer templates when we have a vendor entity
                if (template.category === 'AR' || template.id.includes('customer') ||
                    template.id.includes('invoice_by_number')) {
                    score -= 30;
                    matchedKeywords.push('[vendor-entity-penalty]');
                }
            }
            
            if (hasCustomerEntity) {
                // Boost customer-related templates
                if (template.category === 'AR' || template.category === 'CUSTOMER' ||
                    template.id.includes('customer') || template.id.includes('invoice')) {
                    score += 25;
                    matchedKeywords.push('[customer-entity-boost]');
                }
                // Penalize vendor templates when we have a customer entity
                if (template.category === 'AP' || template.id.includes('vendor')) {
                    score -= 30;
                    matchedKeywords.push('[customer-entity-penalty]');
                }
            }
            
            return { template, score, matchedKeywords };
        });
        
        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);
        
        const best = scored[0];
        
        // Minimum threshold for a match
        if (best.score >= 10) {
            log.debug('Template Match', { 
                templateId: best.template.id, 
                score: best.score,
                keywords: best.matchedKeywords.join(', '),
                question: question.substring(0, 50)
            });
            
            // Extract parameters from question
            const params = extractParameters(question, best.template);
            
            return {
                template: best.template,
                params: params,
                score: best.score
            };
        }
        
        log.debug('No Template Match', { 
            bestId: best.template.id, 
            bestScore: best.score,
            question: question.substring(0, 50)
        });
        
        return null;
    }

    /**
     * Extract parameter values from question
     */
    function extractParameters(question, template) {
        const params = {};
        
        if (!template.parameters || template.parameters.length === 0) {
            return params;
        }
        
        // ═══════════════════════════════════════════════════════════════
        // FIX #5: Global stop words - values that should never be params
        // ═══════════════════════════════════════════════════════════════
        const GLOBAL_STOP_WORDS = [
            'find', 'show', 'get', 'list', 'display', 'what', 'who', 'how', 'when', 'where',
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'latest', 'recent', 'last', 'first', 'new', 'old', 'all', 'any', 'some',
            'from', 'for', 'with', 'about', 'into', 'through', 'during', 'before', 'after',
            'their', 'them', 'they', 'this', 'that', 'these', 'those', 'my', 'our', 'your'
        ];
        
        // Extract numbers for limit parameters
        const numbers = question.match(/\b(\d+)\b/g);
        const questionLower = question.toLowerCase();
        
        template.parameters.forEach(param => {
            if (param.type === 'number' && numbers && numbers.length > 0) {
                params[param.name] = parseInt(numbers[0], 10);
            } else if (param.type === 'string' && param.extractPattern) {
                // Use regex pattern to extract string parameters
                const match = question.match(param.extractPattern);
                if (match) {
                    // Use the first captured group that has a value
                    const value = match.slice(1).find(g => g);
                    if (value) {
                        // Clean up the value and SANITIZE for SQL injection
                        let cleanValue = value.trim();
                        // Remove dangerous SQL characters
                        cleanValue = cleanValue.replace(/['";\\%_]/g, '');
                        // Remove SQL keywords that could be injection attempts
                        cleanValue = cleanValue.replace(/\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|OR|AND|WHERE|FROM|INTO)\b/gi, '');
                        // Limit length to prevent overflow attacks
                        cleanValue = cleanValue.substring(0, 100);
                        
                        // FIX #5: Validate against stop words
                        const cleanLower = cleanValue.toLowerCase();
                        const paramStopWords = param.stopWords || [];
                        const allStopWords = GLOBAL_STOP_WORDS.concat(paramStopWords);
                        
                        if (allStopWords.indexOf(cleanLower) >= 0) {
                            log.debug('Rejected stop word as param', { 
                                param: param.name, 
                                value: cleanValue,
                                template: template.id 
                            });
                            // Don't set param - it's a stop word
                            return;
                        }
                        
                        // Capitalize first letter for department names
                        if (param.name === 'department') {
                            cleanValue = cleanValue.charAt(0).toUpperCase() + cleanValue.slice(1).toLowerCase();
                        }
                        params[param.name] = cleanValue;
                    }
                }
            } else if (param.type === 'string' && param.name === 'type' && template.typeMapping) {
                // Handle type mapping for transaction types
                for (const [keyword, typeValue] of Object.entries(template.typeMapping)) {
                    if (questionLower.includes(keyword)) {
                        params[param.name] = typeValue;
                        break;
                    }
                }
            } else if (param.default !== undefined) {
                // Use default value
                if (param.default === 'TODAY') {
                    params[param.name] = new Date().toISOString().split('T')[0];
                } else if (param.default === 'FIRST_DAY_OF_YEAR') {
                    const year = new Date().getFullYear();
                    params[param.name] = `${year}-01-01`;
                } else if (param.default === 'FIRST_DAY_OF_MONTH') {
                    const now = new Date();
                    params[param.name] = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                } else {
                    params[param.name] = param.default;
                }
            }
        });
        
        return params;
    }

    /**
     * Get template by ID
     */
    function getTemplate(id) {
        return TEMPLATES.find(t => t.id === id);
    }

    /**
     * Get all templates in a category
     */
    function getTemplatesByCategory(category) {
        return TEMPLATES.filter(t => t.category === category);
    }

    /**
     * Get template categories summary
     */
    function getCategorySummary() {
        const summary = {};
        TEMPLATES.forEach(t => {
            if (!summary[t.category]) {
                summary[t.category] = { count: 0, templates: [] };
            }
            summary[t.category].count++;
            summary[t.category].templates.push(t.id);
        });
        return summary;
    }

    /**
     * Get all templates (for planner context)
     */
    function getAllTemplates() {
        return TEMPLATES;
    }

    /**
     * Get template library formatted for AI reference
     * This gives the AI a condensed view of available query patterns
     */
    function getTemplateLibrary() {
        const categories = {};
        
        // Group by category
        TEMPLATES.forEach(t => {
            if (!categories[t.category]) {
                categories[t.category] = [];
            }
            categories[t.category].push(t);
        });
        
        let library = '';
        
        for (const [category, templates] of Object.entries(categories)) {
            library += `\n=== ${category} ===\n`;
            
            templates.forEach(t => {
                library += `\n[${t.id}] ${t.name}\n`;
                library += `Use for: ${t.description}\n`;
                library += `SQL:\n${t.query.trim()}\n`;
            });
        }
        
        return library;
    }
    
    /**
     * Find a template by its ID
     * Used for contextual queries where we need to reuse the previous template
     */
    function findTemplateById(templateId) {
        if (!templateId) return null;
        
        const normalizedId = templateId.toLowerCase().trim();
        
        for (const template of TEMPLATES) {
            if (template.id.toLowerCase() === normalizedId) {
                return template;
            }
        }
        
        return null;
    }

    return {
        TEMPLATES: TEMPLATES,
        findMatchingTemplate: findMatchingTemplate,
        findTemplateById: findTemplateById,
        getTemplate: getTemplate,
        getTemplatesByCategory: getTemplatesByCategory,
        getCategorySummary: getCategorySummary,
        getTemplateLibrary: getTemplateLibrary,
        getAllTemplates: getAllTemplates
    };
});