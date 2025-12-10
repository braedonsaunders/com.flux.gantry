/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_QueryPatterns.js
 * Advanced SuiteQL patterns, fragments, and gotchas
 * 
 * This module provides:
 * - FRAGMENTS: Reusable SQL building blocks (joins, CASE logic)
 * - PATTERNS: Complete query patterns for complex scenarios
 * - GOTCHAS: Critical schema knowledge to prevent common errors
 * - BUILTIN_FUNCTIONS: Reference for NetSuite-specific SQL functions
 * 
 * Based on research from:
 * - Advanced SuiteQL Architectures (Doc 1)
 * - SuiteQL Technical Compendium (Doc 2)
 * - Real-World Query Library (Doc 3)
 */
define(['N/log'], function(log) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    // CRITICAL GOTCHAS - Schema knowledge to prevent query failures
    // ═══════════════════════════════════════════════════════════════════════
    
    const GOTCHAS = {
        // Sign inversion for financial reporting
        sign_inversion: {
            description: 'Income accounts stored as negative (credit), need inversion for P&L display',
            affected_tables: ['TransactionAccountingLine'],
            fix: 'Multiply Income/OthIncome by -1, or use ABS() with CASE logic',
            example: `CASE WHEN Account.AcctType IN ('Income', 'OthIncome') THEN -TransactionAccountingLine.Amount ELSE TransactionAccountingLine.Amount END`
        },
        
        // Budget table normalization
        budget_machine: {
            description: 'Budget amounts are in BudgetMachine table, not Budget table',
            affected_tables: ['Budget', 'BudgetMachine'],
            fix: 'Always join Budget to BudgetMachine for period amounts',
            example: 'JOIN BudgetMachine bm ON b.id = bm.budget'
        },
        
        // Budget year is FK, not integer
        budget_year_fk: {
            description: 'Budget.year is a foreign key to AccountingPeriod, not an integer',
            affected_tables: ['Budget'],
            fix: 'Query AccountingPeriod first to get year ID, or join to AccountingPeriod',
            example: 'WHERE b.year = (SELECT id FROM AccountingPeriod WHERE periodname = \'FY 2025\')'
        },
        
        // SystemNote line linkage
        system_note_lineid: {
            description: 'SystemNote.lineid maps to TransactionLine.linesequencenumber, NOT TransactionLine.id',
            affected_tables: ['SystemNote', 'TransactionLine'],
            fix: 'Join on sn.lineid = tl.linesequencenumber for line-level auditing',
            example: 'AND sn.lineid = tl.linesequencenumber'
        },
        
        // Serial numbers location
        serial_lot_location: {
            description: 'Serial/Lot numbers are NOT on TransactionLine - they are in InventoryAssignment linked to InventoryNumber',
            affected_tables: ['TransactionLine', 'InventoryAssignment', 'InventoryNumber'],
            fix: 'Must traverse: TransactionLine -> InventoryAssignment -> InventoryNumber',
            example: 'LEFT JOIN InventoryAssignment ia ON ia.transaction = tl.transaction AND ia.transactionline = tl.id'
        },
        
        // Posting filter required
        posting_filter: {
            description: 'Always filter for posted transactions in financial queries to exclude drafts/pending',
            affected_tables: ['Transaction'],
            fix: 'Add Transaction.Posting = \'T\' to all GL/financial queries',
            example: 'WHERE Transaction.Posting = \'T\''
        },
        
        // Voided transaction handling
        voided_transactions: {
            description: 'Voided transactions remain in database - their GL impact is reversed by Voiding Journal',
            affected_tables: ['Transaction'],
            fix: 'Filter with Transaction.Voided = \'F\' to exclude voided records',
            example: 'AND Transaction.Voided = \'F\''
        },
        
        // RecordTypeID for SystemNote performance
        system_note_recordtype: {
            description: 'SystemNote table is massive - filter by recordtypeid for performance',
            affected_tables: ['SystemNote'],
            fix: 'Use recordtypeid = -30 for transactions (integer filter is faster than string)',
            example: 'WHERE sn.recordtypeid = -30'
        },
        
        // NTLL link types
        ntll_linktype: {
            description: 'NextTransactionLineLink has multiple link types - filter to avoid duplicates',
            affected_tables: ['NextTransactionLineLink'],
            fix: 'Filter linktype for specific document flow (ShipRcpt for fulfillments)',
            example: "AND ntll.linktype = 'ShipRcpt'"
        },
        
        // TAL vs TL for amounts
        tal_vs_tl: {
            description: 'TransactionAccountingLine has true GL impact; TransactionLine.netamount may differ',
            affected_tables: ['TransactionAccountingLine', 'TransactionLine'],
            fix: 'Use TAL for financial reporting, TL for operational data',
            example: 'Use TransactionAccountingLine.amount for P&L accuracy'
        },
        
        // Department not on TAL
        department_not_on_tal: {
            description: 'transactionaccountingline.department does NOT exist - must join through transactionline',
            affected_tables: ['TransactionAccountingLine', 'TransactionLine'],
            fix: 'Join TAL to TL to get department: JOIN transactionline ON transactionline.transaction = tal.transaction',
            example: 'INNER JOIN transactionline ON transactionline.transaction = tal.transaction AND transactionline.mainline = \'F\''
        },
        
        // Mainline filter
        mainline_filter: {
            description: 'TransactionLine includes header/mainline row - filter with mainline = F for detail lines',
            affected_tables: ['TransactionLine'],
            fix: 'Add mainline = \'F\' to get actual line items, not summary row',
            example: 'WHERE transactionline.mainline = \'F\''
        },
        
        // Transaction status field name
        transaction_status_field: {
            description: 'Field "transtatus" does NOT exist on Transaction table - use "status" instead',
            affected_tables: ['Transaction'],
            fix: 'Use transaction.status for internal code, BUILTIN.DF(transaction.status) for display name',
            example: 'SELECT BUILTIN.DF(transaction.status) AS status FROM transaction'
        },
        
        // Transaction linesequencenumber
        transaction_linesequencenumber: {
            description: 'Field "linesequencenumber" does NOT exist on Transaction table - only on TransactionLine',
            affected_tables: ['Transaction', 'TransactionLine'],
            fix: 'Use transactionline.linesequencenumber when joining, not transaction.linesequencenumber',
            example: 'SELECT transactionline.linesequencenumber FROM transactionline'
        },
        
        // Date comparison syntax
        date_comparison_syntax: {
            description: 'SuiteQL requires TO_DATE() for all date comparisons - string dates cause "Invalid search" errors',
            affected_tables: ['Transaction', 'TransactionLine', 'TransactionAccountingLine'],
            fix: 'Always use TO_DATE(\'YYYY-MM-DD\', \'YYYY-MM-DD\') for date literals, never bare strings',
            example: `WHERE trandate >= TO_DATE('2024-04-01', 'YYYY-MM-DD') AND trandate < TO_DATE('2025-04-01', 'YYYY-MM-DD')`
        },
        
        // NO ABS() on accounting line amounts - destroys debit/credit math
        no_abs_on_accounting_amounts: {
            description: 'NEVER use ABS() on transactionaccountingline.amount - it destroys debit/credit sign and breaks accounting math',
            affected_tables: ['TransactionAccountingLine'],
            fix: 'Use raw amount values. Debits are positive, credits are negative. SUM() naturally handles the math correctly.',
            example: `-- WRONG (inflates COGS by adding credits instead of subtracting):
SUM(CASE WHEN account.accttype = 'COGS' THEN ABS(transactionaccountingline.amount) ELSE 0 END)

-- CORRECT (lets debits add and credits subtract naturally):
SUM(CASE WHEN account.accttype = 'COGS' THEN transactionaccountingline.amount ELSE 0 END)`,
            why: `ABS() converts credit entries (negative) to positive, so adjustments/returns ADD to totals instead of reducing them.
Example: $1000 COGS debit + $500 COGS credit (adjustment) should net to $500.
With ABS(): |1000| + |−500| = $1500 (WRONG - 3x overstated!)
Without ABS(): 1000 + (−500) = $500 (CORRECT)`
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // SQL FRAGMENTS - Reusable query building blocks
    // ═══════════════════════════════════════════════════════════════════════
    
    const FRAGMENTS = {
        // ─────────────────────────────────────────────────────────────────
        // JOIN PATTERNS
        // ─────────────────────────────────────────────────────────────────
        
        // System Note to Transaction Line (for audit trails)
        system_note_to_line: {
            description: 'Links system notes to specific transaction lines via linesequencenumber',
            join: `JOIN SystemNote sn ON t.id = sn.recordid 
                   AND sn.lineid = tl.linesequencenumber`,
            requires: ['Transaction t', 'TransactionLine tl'],
            filters: ['sn.recordtypeid = -30'],
            note: 'lineid maps to linesequencenumber, NOT TransactionLine.id'
        },
        
        // Order to Fulfillment via NTLL
        order_to_fulfillment: {
            description: 'Traverses Sales Order to Item Fulfillment via NextTransactionLineLink',
            join: `JOIN NextTransactionLineLink ntll ON ntll.previousdoc = so.id 
                   AND ntll.previousline = sol.id
                   JOIN Transaction fulfill ON fulfill.id = ntll.nextdoc`,
            requires: ['Transaction so', 'TransactionLine sol'],
            filters: ["ntll.linktype = 'ShipRcpt'"],
            note: 'Filter linktype to avoid Pick/Pack intermediate steps'
        },
        
        // Fulfillment to Serial/Lot Numbers
        fulfillment_to_serial: {
            description: 'Links fulfillment line to serial/lot numbers via InventoryAssignment',
            join: `LEFT JOIN InventoryAssignment ia ON ia.transaction = fl.transaction 
                   AND ia.transactionline = fl.id
                   LEFT JOIN InventoryNumber inv ON inv.id = ia.inventorynumber`,
            requires: ['TransactionLine fl (fulfillment line)'],
            filters: [],
            note: 'Use LEFT JOIN for non-serialized items'
        },
        
        // Budget to Period Amounts
        budget_to_amounts: {
            description: 'Links Budget header to period-specific amounts in BudgetMachine',
            join: `JOIN BudgetMachine bm ON b.id = bm.budget
                   JOIN AccountingPeriod ap ON bm.period = ap.id`,
            requires: ['Budget b'],
            filters: [],
            note: 'BudgetMachine has the actual amounts, not Budget table'
        },
        
        // TAL with Department (via TransactionLine)
        tal_with_department: {
            description: 'Gets TransactionAccountingLine with department from TransactionLine - uses 1:1 link to prevent duplication',
            join: `INNER JOIN transactionline tl ON tl.transaction = tal.transaction 
                   AND tl.id = tal.transactionline
                   AND tl.mainline = 'F'`,
            requires: ['TransactionAccountingLine tal'],
            filters: [],
            note: 'CRITICAL: tl.id = tal.transactionline links each GL posting to its specific line item. Never use MIN() subquery - it ignores lines 2-N of multi-line transactions.'
        },
        
        // Invoice to Payment Chain
        invoice_to_payment: {
            description: 'Links invoice to applied payments via NextTransactionLineLink',
            join: `LEFT JOIN NextTransactionLineLink ntll ON ntll.previousdoc = inv.id
                   LEFT JOIN Transaction pymt ON pymt.id = ntll.nextdoc AND pymt.type = 'CustPymt'`,
            requires: ['Transaction inv (invoice)'],
            filters: [],
            note: 'Use for payment application tracking'
        },
        
        // Days to Pay Calculation
        days_to_pay: {
            description: 'Calculate average days between invoice and payment for customers',
            join: `INNER JOIN NextTransactionLineLink ntll ON ntll.previousdoc = inv.id
                   INNER JOIN transaction pymt ON pymt.id = ntll.nextdoc AND pymt.type = 'CustPymt'`,
            select: `BUILTIN.DF(inv.entity) AS customer_name,
                     inv.entity AS customer_id,
                     ROUND(AVG(pymt.trandate - inv.trandate), 1) AS avg_days_to_pay,
                     COUNT(DISTINCT inv.id) AS invoices_analyzed`,
            requires: ['transaction inv (invoices)'],
            filters: ["inv.type = 'CustInvc'", "inv.posting = 'T'"],
            note: `CRITICAL: Use simple date subtraction (date2 - date1).
                   DO NOT use: DAYS_BETWEEN(), DATEDIFF(), DATE_DIFF() - these are NOT valid in SuiteQL.
                   DO NOT use: transaction.dateclosed, transaction.closedate, transaction.paiddate - these fields DO NOT EXIST.
                   DO NOT use: transactionlink table - it is BLOCKED, use NextTransactionLineLink instead.`
        },
        
        // ─────────────────────────────────────────────────────────────────
        // CASE LOGIC PATTERNS
        // ─────────────────────────────────────────────────────────────────
        
        // P&L Sign Correction
        pl_sign_correction: {
            description: 'Corrects sign for P&L display (Income stored as negative)',
            expression: `CASE 
                WHEN Account.AcctType IN ('Income', 'OthIncome') THEN -TransactionAccountingLine.Amount
                ELSE TransactionAccountingLine.Amount
            END`,
            note: 'NetSuite stores Income as negative (credit). Flip for reporting.'
        },
        
        // P&L Category Classification
        pl_category: {
            description: 'Classifies account types into P&L categories',
            expression: `CASE 
                WHEN account.accttype IN ('Income', 'OthIncome') THEN 'Revenue'
                WHEN account.accttype = 'COGS' THEN 'Cost of Goods Sold'
                WHEN account.accttype IN ('Expense', 'OthExpense') THEN 'Expenses'
                ELSE 'Other'
            END`,
            note: 'Standard P&L categorization'
        },
        
        // AR Aging Buckets
        ar_aging_buckets: {
            description: 'Standard AR aging bucket calculation',
            expression: `CASE
                WHEN TRUNC(SYSDATE - Transaction.DueDate) <= 0 THEN 'Current'
                WHEN TRUNC(SYSDATE - Transaction.DueDate) BETWEEN 1 AND 30 THEN '1-30 Days'
                WHEN TRUNC(SYSDATE - Transaction.DueDate) BETWEEN 31 AND 60 THEN '31-60 Days'
                WHEN TRUNC(SYSDATE - Transaction.DueDate) BETWEEN 61 AND 90 THEN '61-90 Days'
                ELSE 'Over 90 Days'
            END`,
            note: 'Uses DueDate, not TranDate for aging'
        },
        
        // System Note Change Type Decode
        system_note_change_type: {
            description: 'Decodes SystemNote type integer to readable string',
            expression: `CASE sn.type 
                WHEN 2 THEN 'Set' 
                WHEN 4 THEN 'Change' 
                ELSE TO_CHAR(sn.type) 
            END`,
            note: 'Type 2 = initial set, Type 4 = subsequent change'
        },
        
        // Balance Sheet Category Sort
        balance_sheet_sort: {
            description: 'Sort order for balance sheet presentation',
            expression: `CASE account.accttype
                WHEN 'Bank' THEN 1
                WHEN 'AcctRec' THEN 2
                WHEN 'OthCurrAsset' THEN 3
                WHEN 'FixedAsset' THEN 4
                WHEN 'OthAsset' THEN 5
                WHEN 'AcctPay' THEN 10
                WHEN 'CredCard' THEN 11
                WHEN 'OthCurrLiab' THEN 12
                WHEN 'LongTermLiab' THEN 13
                WHEN 'Equity' THEN 20
                WHEN 'RetainedEarnings' THEN 21
                ELSE 99
            END`,
            note: 'Groups Assets, Liabilities, Equity in standard order'
        },
        
        // ─────────────────────────────────────────────────────────────────
        // AGGREGATION PATTERNS
        // ─────────────────────────────────────────────────────────────────
        
        // P&L Aggregation by Account Type
        pl_aggregation: {
            description: 'Standard P&L aggregation with proper sign handling',
            expression: `SUM(CASE WHEN account.accttype = 'Income' THEN -1 * tal.amount ELSE 0 END) AS revenue,
                SUM(CASE WHEN account.accttype = 'COGS' THEN tal.amount ELSE 0 END) AS cogs,
                SUM(CASE WHEN account.accttype = 'Expense' THEN tal.amount ELSE 0 END) AS expenses,
                SUM(CASE WHEN account.accttype = 'OthIncome' THEN -1 * tal.amount ELSE 0 END) AS other_income,
                SUM(CASE WHEN account.accttype = 'OthExpense' THEN tal.amount ELSE 0 END) AS other_expense`,
            note: 'Income/OthIncome negated for positive display'
        },
        
        // Open Balance Calculation (AR)
        ar_open_balance: {
            description: 'Calculates open balance from TAL fields',
            expression: `COALESCE(TransactionAccountingLine.AmountUnpaid, 0) - 
                COALESCE(TransactionAccountingLine.PaymentAmountUnused, 0)`,
            note: 'Handles partial payments and unapplied credits'
        },
        
        // Running Balance (Analytic)
        running_balance: {
            description: 'Running balance using window function',
            expression: `SUM(TransactionLine.Quantity) OVER (
                ORDER BY Transaction.TranDate, Transaction.TranID, TransactionLine.ID
                RANGE UNBOUNDED PRECEDING
            )`,
            note: 'Use for inventory running balance or GL activity'
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // COMPLETE QUERY PATTERNS - For complex scenarios
    // ═══════════════════════════════════════════════════════════════════════
    
    const PATTERNS = {
        // ─────────────────────────────────────────────────────────────────
        // FINANCIAL REPORTING
        // ─────────────────────────────────────────────────────────────────
        
        budget_vs_actuals: {
            id: 'budget_vs_actuals',
            name: 'Budget vs Actuals Variance',
            description: 'Compare budget amounts to actual GL postings by period with variance calculation',
            complexity: 'high',
            tables: ['Budget', 'BudgetMachine', 'TransactionAccountingLine', 'Account', 'AccountingPeriod'],
            key_insight: 'Budget amounts are in BudgetMachine (normalized), not Budget table. Must use subquery for actuals to prevent fan-out.',
            gotchas: ['budget_machine', 'budget_year_fk', 'posting_filter'],
            sql: `SELECT
    acct.acctnumber AS account_number,
    BUILTIN.DF(acct.id) AS account_name,
    ap.periodname AS period,
    COALESCE(SUM(bm.amount), 0) AS budget_amount,
    COALESCE(actuals.amount, 0) AS actual_amount,
    (COALESCE(SUM(bm.amount), 0) - COALESCE(actuals.amount, 0)) AS variance,
    CASE 
        WHEN COALESCE(SUM(bm.amount), 0) = 0 THEN 0 
        ELSE ((COALESCE(SUM(bm.amount), 0) - COALESCE(actuals.amount, 0)) / COALESCE(SUM(bm.amount), 0)) * 100 
    END AS variance_pct
FROM Budget b
JOIN BudgetMachine bm ON b.id = bm.budget
JOIN Account acct ON b.account = acct.id
JOIN AccountingPeriod ap ON bm.period = ap.id
LEFT JOIN (
    SELECT
        tal.account,
        t.postingperiod,
        SUM(tal.amount) AS amount
    FROM TransactionAccountingLine tal
    JOIN Transaction t ON tal.transaction = t.id
    WHERE t.posting = 'T' AND t.voided = 'F'
    GROUP BY tal.account, t.postingperiod
) actuals ON actuals.account = b.account AND actuals.postingperiod = bm.period
WHERE b.year = {budget_year_id}
    AND acct.accttype IN ('Expense', 'COGS')
GROUP BY acct.acctnumber, BUILTIN.DF(acct.id), ap.periodname, actuals.amount, ap.startdate
ORDER BY acct.acctnumber, ap.startdate`
        },
        
        system_note_audit: {
            id: 'system_note_audit',
            name: 'Line-Level Change Audit Trail',
            description: 'Track field changes at transaction LINE level for forensic auditing',
            complexity: 'high',
            tables: ['Transaction', 'TransactionLine', 'SystemNote'],
            key_insight: 'SystemNote.lineid maps to TransactionLine.linesequencenumber, NOT TransactionLine.id',
            gotchas: ['system_note_lineid', 'system_note_recordtype'],
            sql: `SELECT
    t.tranid AS transaction_number,
    t.trandate AS transaction_date,
    tl.linesequencenumber AS line_number,
    BUILTIN.DF(tl.item) AS item_name,
    sn.date AS change_date,
    sn.name AS changed_by,
    sn.field AS field_changed,
    sn.oldvalue AS old_value,
    sn.newvalue AS new_value,
    sn.context AS change_context,
    CASE sn.type 
        WHEN 2 THEN 'Set' 
        WHEN 4 THEN 'Change' 
        ELSE TO_CHAR(sn.type) 
    END AS change_type
FROM Transaction t
JOIN TransactionLine tl ON t.id = tl.transaction
JOIN SystemNote sn ON t.id = sn.recordid AND sn.lineid = tl.linesequencenumber
WHERE t.type = '{transaction_type}'
    AND sn.recordtypeid = -30
    AND sn.oldvalue != sn.newvalue
    AND sn.type IN (2, 4)
ORDER BY t.tranid, tl.linesequencenumber, sn.date DESC`
        },
        
        serial_lot_trace: {
            id: 'serial_lot_trace',
            name: 'Serial/Lot Full Traceability',
            description: 'Trace serial/lot from Sales Order through fulfillment to specific bin location',
            complexity: 'very_high',
            tables: ['Transaction', 'TransactionLine', 'NextTransactionLineLink', 'InventoryAssignment', 'InventoryNumber', 'Bin', 'Location', 'Item'],
            key_insight: 'Serial numbers are NOT on TransactionLine. Must traverse: SO -> NTLL -> Fulfillment -> InventoryAssignment -> InventoryNumber',
            gotchas: ['serial_lot_location', 'ntll_linktype'],
            sql: `SELECT
    so.tranid AS sales_order,
    so.trandate AS order_date,
    item.itemid AS item_number,
    BUILTIN.DF(item.id) AS item_description,
    fulfill.tranid AS fulfillment_doc,
    REPLACE(BUILTIN.DF(fulfill.status), 'Item Fulfillment : ', '') AS fulfillment_status,
    inv_num.inventorynumber AS serial_lot_number,
    inv_assign.quantity AS qty_fulfilled,
    bin.binnumber AS bin_picked_from,
    loc.name AS location
FROM Transaction so
JOIN TransactionLine sol ON sol.transaction = so.id
JOIN NextTransactionLineLink ntll ON ntll.previousdoc = sol.transaction
    AND ntll.previousline = sol.id
JOIN Transaction fulfill ON fulfill.id = ntll.nextdoc
JOIN TransactionLine fulfill_line ON fulfill_line.transaction = fulfill.id
    AND fulfill_line.id = ntll.nextline
LEFT JOIN InventoryAssignment inv_assign ON inv_assign.transaction = fulfill_line.transaction
    AND inv_assign.transactionline = fulfill_line.id
LEFT JOIN InventoryNumber inv_num ON inv_num.id = inv_assign.inventorynumber
LEFT JOIN Bin bin ON bin.id = inv_assign.bin
JOIN Location loc ON loc.id = fulfill_line.location
JOIN Item item ON item.id = sol.item
WHERE so.type = 'SalesOrd'
    AND ntll.linktype = 'ShipRcpt'
    AND inv_num.inventorynumber IS NOT NULL
ORDER BY so.tranid, item.itemid, inv_num.inventorynumber`
        },
        
        project_profitability: {
            id: 'project_profitability',
            name: 'Comprehensive Project P&L',
            description: '360-degree project profitability including revenue, labor cost, and material cost',
            complexity: 'high',
            tables: ['Job', 'Transaction', 'TransactionLine', 'TimeBill', 'Employee'],
            key_insight: 'Must handle "orphan" POs not linked to SO by joining Transaction.entity to Job. Use subquery for TimeBill to prevent fan-out.',
            gotchas: ['posting_filter', 'voided_transactions'],
            sql: `SELECT
    Project.companyname AS project_name,
    Project.entityid AS project_id,
    BUILTIN.DF(Project.parent) AS customer,
    COALESCE(SUM(CASE WHEN t.type IN ('SalesOrd', 'CustInvc') THEN tl.creditforeignamount ELSE 0 END), 0) AS total_revenue,
    COALESCE(tb_stats.total_labor_cost, 0) AS total_labor_cost,
    COALESCE(SUM(CASE WHEN t.type IN ('VendBill', 'PurchOrd') THEN tl.amount ELSE 0 END), 0) AS total_material_cost,
    COALESCE(SUM(CASE WHEN t.type IN ('SalesOrd', 'CustInvc') THEN tl.creditforeignamount ELSE 0 END), 0) -
        COALESCE(tb_stats.total_labor_cost, 0) -
        COALESCE(SUM(CASE WHEN t.type IN ('VendBill', 'PurchOrd') THEN tl.amount ELSE 0 END), 0) AS gross_profit
FROM Job AS Project
LEFT JOIN Transaction t ON t.entity = Project.id
LEFT JOIN TransactionLine tl ON tl.transaction = t.id
LEFT JOIN (
    SELECT
        tb.customer AS project_id,
        SUM(tb.durationdecimal * CASE WHEN e.laborcost > 0 THEN e.laborcost ELSE 0 END) AS total_labor_cost
    FROM TimeBill tb
    JOIN Employee e ON tb.employee = e.id
    GROUP BY tb.customer
) tb_stats ON tb_stats.project_id = Project.id
WHERE Project.entityid LIKE 'PRJ-%'
    AND t.voided = 'F'
GROUP BY Project.companyname, Project.entityid, Project.parent, tb_stats.total_labor_cost`
        },
        
        order_lifecycle: {
            id: 'order_lifecycle',
            name: 'Order-to-Cash Lifecycle',
            description: 'Complete document chain: Sales Order → Fulfillment → Invoice → Payment',
            complexity: 'high',
            tables: ['Transaction', 'TransactionLine', 'NextTransactionLineLink', 'Item'],
            key_insight: 'Use NextTransactionLineLink to traverse document relationships. May have one-to-many (one SO → multiple invoices).',
            gotchas: ['mainline_filter'],
            sql: `SELECT
    so.tranid AS sales_order,
    so.trandate AS order_date,
    BUILTIN.DF(so.entity) AS customer,
    item.itemid AS item_sold,
    sol.quantity AS qty_ordered,
    fulfill.tranid AS fulfillment_doc,
    fulfill.trandate AS ship_date,
    inv.tranid AS invoice_doc,
    inv.trandate AS invoice_date,
    pymt.tranid AS payment_doc,
    pymt.trandate AS payment_date
FROM Transaction so
JOIN TransactionLine sol ON sol.transaction = so.id
LEFT JOIN Item ON sol.item = Item.id
LEFT JOIN NextTransactionLineLink link_ship ON so.id = link_ship.previousdoc AND link_ship.previousline = sol.id
LEFT JOIN Transaction fulfill ON link_ship.nextdoc = fulfill.id AND fulfill.type = 'ItemShip'
LEFT JOIN NextTransactionLineLink link_inv ON so.id = link_inv.previousdoc
LEFT JOIN Transaction inv ON link_inv.nextdoc = inv.id AND inv.type = 'CustInvc'
LEFT JOIN NextTransactionLineLink link_pymt ON inv.id = link_pymt.previousdoc
LEFT JOIN Transaction pymt ON link_pymt.nextdoc = pymt.id AND pymt.type = 'CustPymt'
WHERE so.type = 'SalesOrd'
    AND sol.mainline = 'F'
ORDER BY so.tranid, sol.linesequencenumber`
        },
        
        // ─────────────────────────────────────────────────────────────────
        // INVENTORY PATTERNS
        // ─────────────────────────────────────────────────────────────────
        
        inventory_by_bin: {
            id: 'inventory_by_bin',
            name: 'Inventory Balance by Bin',
            description: 'Stock levels with bin-level detail for multi-bin warehouses',
            complexity: 'medium',
            tables: ['Transaction', 'TransactionLine', 'InventoryAssignment', 'Item', 'Bin'],
            key_insight: 'InventoryAssignment contains the bin ID, not TransactionLine. Rebuild balance by summing historical movements.',
            gotchas: ['posting_filter'],
            sql: `SELECT
    Item.itemid AS item_number,
    Item.displayname AS item_name,
    BUILTIN.DF(InventoryAssignment.bin) AS bin_number,
    BUILTIN.DF(Transaction.location) AS location,
    SUM(InventoryAssignment.quantity) AS bin_quantity
FROM Transaction
INNER JOIN TransactionLine ON Transaction.id = TransactionLine.transaction
INNER JOIN InventoryAssignment ON TransactionLine.id = InventoryAssignment.transactionline
INNER JOIN Item ON TransactionLine.item = Item.id
WHERE Transaction.posting = 'T'
    AND Item.itemtype = 'InvtPart'
GROUP BY Item.itemid, Item.displayname, BUILTIN.DF(InventoryAssignment.bin), BUILTIN.DF(Transaction.location)
HAVING SUM(InventoryAssignment.quantity) != 0
ORDER BY location, item_number`
        },
        
        inventory_running_balance: {
            id: 'inventory_running_balance',
            name: 'Inventory Running Balance',
            description: 'Transaction-by-transaction inventory balance with analytic function',
            complexity: 'medium',
            tables: ['Transaction', 'TransactionLine', 'Entity', 'Item'],
            key_insight: 'Uses SUM() OVER() window function for running total. Filter IsInventoryAffecting for accuracy.',
            gotchas: ['voided_transactions'],
            sql: `SELECT
    TransactionLine.transaction AS transaction_id,
    Transaction.trandate,
    Transaction.type,
    Transaction.tranid,
    TransactionLine.rate,
    TransactionLine.netamount,
    TransactionLine.quantity,
    Entity.altname AS entity_name,
    SUM(TransactionLine.quantity) OVER (
        ORDER BY Transaction.trandate, Transaction.tranid, TransactionLine.id
        RANGE UNBOUNDED PRECEDING
    ) AS running_balance
FROM TransactionLine
INNER JOIN Transaction ON Transaction.id = TransactionLine.transaction
LEFT OUTER JOIN Entity ON Entity.id = Transaction.entity
WHERE TransactionLine.item = {item_id}
    AND TransactionLine.isinventoryaffecting = 'T'
    AND Transaction.voided = 'F'
ORDER BY Transaction.trandate, Transaction.tranid, TransactionLine.id`
        },
        
        // ─────────────────────────────────────────────────────────────────
        // AR/AP PATTERNS
        // ─────────────────────────────────────────────────────────────────
        
        ar_aging_detail_tal: {
            id: 'ar_aging_detail_tal',
            name: 'AR Aging Detail (TAL-based)',
            description: 'Accounts receivable aging using TransactionAccountingLine for accurate open balance',
            complexity: 'medium',
            tables: ['Transaction', 'TransactionAccountingLine', 'Customer'],
            key_insight: 'Uses TAL.AmountUnpaid and PaymentAmountUnused for accurate open balance including partial payments.',
            gotchas: ['posting_filter', 'voided_transactions'],
            sql: `SELECT 
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
    AND ((TransactionAccountingLine.amountunpaid <> 0) 
         OR (TransactionAccountingLine.paymentamountunused <> 0))
ORDER BY Transaction.duedate, Transaction.tranid`
        },
        
        ar_aging_summary_tal: {
            id: 'ar_aging_summary_tal',
            name: 'AR Aging Summary by Customer',
            description: 'Summarized AR aging with buckets grouped by customer',
            complexity: 'medium',
            tables: ['Transaction', 'TransactionAccountingLine', 'Customer'],
            key_insight: 'Uses CASE statements within SUM to calculate each aging bucket in single pass.',
            gotchas: ['posting_filter', 'voided_transactions'],
            sql: `SELECT
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
INNER JOIN Customer ON Customer.id = Transaction.entity
WHERE Transaction.posting = 'T'
    AND Transaction.voided = 'F'
    AND ((TransactionAccountingLine.amountunpaid <> 0) OR (TransactionAccountingLine.paymentamountunused <> 0))
GROUP BY BUILTIN.DF(Transaction.entity)
ORDER BY total DESC`
        },
        
        gl_detail: {
            id: 'gl_detail',
            name: 'General Ledger Detail',
            description: 'GL impact detail for specific transaction with debit/credit breakdown',
            complexity: 'low',
            tables: ['Transaction', 'TransactionAccountingLine', 'TransactionLine', 'Account'],
            key_insight: 'TransactionAccountingLine is the source of truth for GL impact.',
            gotchas: [],
            sql: `SELECT
    BUILTIN.DF(TransactionAccountingLine.account) AS account,
    TransactionAccountingLine.debit,
    TransactionAccountingLine.credit,
    TransactionAccountingLine.posting,
    TransactionLine.memo
FROM TransactionAccountingLine
INNER JOIN TransactionLine ON TransactionLine.transaction = TransactionAccountingLine.transaction
    AND TransactionLine.id = TransactionAccountingLine.transactionline
WHERE TransactionAccountingLine.transaction = {transaction_id}
    AND (TransactionAccountingLine.debit IS NOT NULL OR TransactionAccountingLine.credit IS NOT NULL)
ORDER BY TransactionLine.id`
        },
        
        trial_balance_ytd: {
            id: 'trial_balance_ytd',
            name: 'Trial Balance Year-to-Date',
            description: 'Account balances through specified date with proper aggregation',
            complexity: 'medium',
            tables: ['Transaction', 'TransactionAccountingLine', 'Account'],
            key_insight: 'Sum all transactions from beginning of time through date for cumulative balance.',
            gotchas: ['posting_filter'],
            sql: `SELECT 
    Account.acctnumber AS account_code,
    BUILTIN.DF(Account.id) AS account_name,
    BUILTIN.DF(Account.accttype) AS account_type,
    SUM(TransactionAccountingLine.debit) AS total_debit,
    SUM(TransactionAccountingLine.credit) AS total_credit,
    SUM(COALESCE(TransactionAccountingLine.debit, 0)) - SUM(COALESCE(TransactionAccountingLine.credit, 0)) AS net_balance
FROM Transaction
INNER JOIN TransactionAccountingLine ON Transaction.id = TransactionAccountingLine.transaction
INNER JOIN Account ON TransactionAccountingLine.account = Account.id
WHERE Transaction.trandate <= TO_DATE('{as_of_date}', 'YYYY-MM-DD')
    AND Transaction.posting = 'T'
    AND Account.isinactive = 'F'
    AND Account.issummary = 'F'
GROUP BY Account.acctnumber, BUILTIN.DF(Account.id), BUILTIN.DF(Account.accttype)
HAVING SUM(COALESCE(TransactionAccountingLine.debit, 0)) - SUM(COALESCE(TransactionAccountingLine.credit, 0)) != 0
ORDER BY Account.acctnumber`
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // BUILTIN FUNCTIONS REFERENCE
    // ═══════════════════════════════════════════════════════════════════════
    
    const BUILTIN_FUNCTIONS = {
        'BUILTIN.DF': {
            description: 'Display Function - Returns display name instead of internal ID',
            usage: 'BUILTIN.DF(field_id)',
            example: 'BUILTIN.DF(Transaction.entity) AS customer_name',
            note: 'More efficient than joining to entity table just for name'
        },
        'BUILTIN.CF': {
            description: 'Criteria Field - Returns filter-ready format for status fields',
            usage: 'BUILTIN.CF(field)',
            example: "WHERE BUILTIN.CF(Transaction.status) = 'SalesOrd:B'",
            note: 'Use for status filtering in WHERE clauses'
        },
        'BUILTIN.RELATIVE_RANGES': {
            description: 'Dynamic date ranges - Returns date based on code',
            usage: "BUILTIN.RELATIVE_RANGES('code', 'START'|'END')",
            example: "Transaction.trandate >= BUILTIN.RELATIVE_RANGES('DAGO30', 'START')",
            codes: {
                'TFY': 'This Fiscal Year',
                'LFYTD': 'Last Fiscal Year to Date',
                'DAGO30': '30 Days Ago',
                'DAGO60': '60 Days Ago',
                'DAGO90': '90 Days Ago',
                'SDLW': 'Same Day Last Week',
                'LRH': 'Last Rolling Half (6 months)'
            }
        },
        'BUILTIN.CONSOLIDATE': {
            description: 'Multi-subsidiary currency consolidation',
            usage: "BUILTIN.CONSOLIDATE(amount, 'viewType', 'rateType', 'subRateType', subsidiaryId, currencyId, 'DEFAULT')",
            example: "BUILTIN.CONSOLIDATE(TransactionAccountingLine.credit, 'INCOME', 'DEFAULT', 'DEFAULT', 3, 263, 'DEFAULT')",
            note: 'Required for consolidated financial reporting in OneWorld'
        },
        'BUILTIN.CURRENCY_CONVERT': {
            description: 'Currency conversion',
            usage: 'BUILTIN.CURRENCY_CONVERT(amount, targetCurrencyId, optionalDate)',
            example: 'BUILTIN.CURRENCY_CONVERT(Transaction.foreigntotal, 1, Transaction.trandate)',
            note: 'Converts amount to target currency at rate for given date'
        },
        'BUILTIN.HIERARCHY': {
            description: 'Returns hierarchical path for nested records',
            usage: "BUILTIN.HIERARCHY(field, 'DISPLAY_JOINED')",
            example: "BUILTIN.HIERARCHY(account, 'DISPLAY_JOINED') AS account_path",
            note: 'Returns format like "4000 Revenue: 4200 Revenue Sales"'
        },
        'BUILTIN.MNFILTER': {
            description: 'Multi-select field filtering',
            usage: "BUILTIN.MNFILTER(field, 'MN_INCLUDE', '', 'FALSE', NULL, value1, value2...)",
            example: "WHERE BUILTIN.MNFILTER(T.custbody_link_types, 'MN_INCLUDE', '', 'FALSE', NULL, 4) = 'T'",
            note: 'Filter records where multi-select contains specified values'
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get relevant gotchas for a set of tables
     */
    function getGotchasForTables(tableNames) {
        const relevant = [];
        for (const [key, gotcha] of Object.entries(GOTCHAS)) {
            if (gotcha.affected_tables.some(t => tableNames.includes(t))) {
                relevant.push({ id: key, ...gotcha });
            }
        }
        return relevant;
    }
    
    /**
     * Get pattern by ID
     */
    function getPattern(patternId) {
        return PATTERNS[patternId] || null;
    }
    
    /**
     * Get all patterns matching complexity level
     */
    function getPatternsByComplexity(complexity) {
        return Object.values(PATTERNS).filter(p => p.complexity === complexity);
    }
    
    /**
     * Get fragment by ID
     */
    function getFragment(fragmentId) {
        return FRAGMENTS[fragmentId] || null;
    }
    
    /**
     * Get all fragments of a type (join, case, aggregation)
     */
    function getFragmentsByType(type) {
        const joinFragments = ['system_note_to_line', 'order_to_fulfillment', 'fulfillment_to_serial', 
                               'budget_to_amounts', 'tal_with_department', 'invoice_to_payment'];
        const caseFragments = ['pl_sign_correction', 'pl_category', 'ar_aging_buckets', 
                               'system_note_change_type', 'balance_sheet_sort'];
        const aggregationFragments = ['pl_aggregation', 'ar_open_balance', 'running_balance'];
        
        switch (type) {
            case 'join': return joinFragments.map(id => ({ id, ...FRAGMENTS[id] }));
            case 'case': return caseFragments.map(id => ({ id, ...FRAGMENTS[id] }));
            case 'aggregation': return aggregationFragments.map(id => ({ id, ...FRAGMENTS[id] }));
            default: return [];
        }
    }
    
    /**
     * Build pattern reference for planning prompt
     * Gives planner awareness of available patterns without full SQL
     */
    function getPatternSummaryForPlanning() {
        let summary = '';
        
        for (const [id, pattern] of Object.entries(PATTERNS)) {
            summary += `\n• ${id}: ${pattern.description}`;
            summary += `\n  Complexity: ${pattern.complexity}`;
            summary += `\n  Tables: ${pattern.tables.join(', ')}`;
            summary += `\n  Key insight: ${pattern.key_insight}\n`;
        }
        
        return summary;
    }
    
    /**
     * Build gotchas reference for query generation
     */
    function getGotchasSummary() {
        let summary = '';
        
        for (const [id, gotcha] of Object.entries(GOTCHAS)) {
            summary += `\n• ${id}: ${gotcha.description}`;
            summary += `\n  Fix: ${gotcha.fix}\n`;
        }
        
        return summary;
    }
    
    /**
     * Get BUILTIN function reference
     */
    function getBuiltinFunctionsSummary() {
        let summary = '';
        
        for (const [name, func] of Object.entries(BUILTIN_FUNCTIONS)) {
            summary += `\n${name}`;
            summary += `\n  ${func.description}`;
            summary += `\n  Usage: ${func.usage}`;
            summary += `\n  Example: ${func.example}\n`;
        }
        
        return summary;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // QUERY ERROR GUIDANCE - SQL-specific error detection and fix suggestions
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * SQL-specific error patterns and their fixes
     * This is the right place for SuiteQL domain knowledge about common mistakes
     */
    const QUERY_ERROR_PATTERNS = {
        // Non-existent date fields (common hallucination for days-to-pay queries)
        nonExistentDateFields: {
            detect: function(query) {
                var q = query.toLowerCase();
                return q.includes('dateclosed') || q.includes('closedate') || 
                       q.includes('paiddate') || q.includes('paymentdate');
            },
            guidance: '⚠️ NON-EXISTENT FIELD: transaction.dateclosed/closedate/paiddate do NOT exist in SuiteQL. ' +
                'To find payment dates, you must join to the actual payment transaction via NextTransactionLineLink. ' +
                'Pattern: FROM transaction inv INNER JOIN NextTransactionLineLink ntll ON ntll.previousdoc = inv.id ' +
                'INNER JOIN transaction pymt ON pymt.id = ntll.nextdoc AND pymt.type = \'CustPymt\'. ' +
                'Then use: (pymt.trandate - inv.trandate) AS days_to_pay',
            example: 'SELECT inv.entity, ROUND(AVG(pymt.trandate - inv.trandate), 1) AS avg_days_to_pay ' +
                'FROM transaction inv ' +
                'INNER JOIN NextTransactionLineLink ntll ON ntll.previousdoc = inv.id ' +
                'INNER JOIN transaction pymt ON pymt.id = ntll.nextdoc AND pymt.type = \'CustPymt\' ' +
                'WHERE inv.type = \'CustInvc\' GROUP BY inv.entity'
        },
        
        // Invalid date functions
        invalidDateFunctions: {
            detect: function(query) {
                var q = query.toLowerCase();
                return q.includes('days_between') || q.includes('datediff') || q.includes('date_diff');
            },
            guidance: '⚠️ INVALID FUNCTION: DAYS_BETWEEN(), DATEDIFF(), DATE_DIFF() are NOT valid in SuiteQL. ' +
                'Use simple date subtraction: (date2 - date1) returns the number of days. ' +
                'Example: (pymt.trandate - inv.trandate) AS days_to_pay',
            example: 'SELECT (transaction.duedate - transaction.trandate) AS days_until_due, ' +
                '(TRUNC(SYSDATE) - transaction.duedate) AS days_overdue FROM transaction'
        },
        
        // Blocked transactionlink table
        blockedTransactionlink: {
            detect: function(query) {
                var q = query.toLowerCase();
                return q.includes('transactionlink') && !q.includes('nexttransactionlinelink');
            },
            guidance: '⚠️ BLOCKED TABLE: transactionlink is not allowed in SuiteQL. ' +
                'Use NextTransactionLineLink instead to link invoices to payments. ' +
                'Pattern: INNER JOIN NextTransactionLineLink ntll ON ntll.previousdoc = invoice.id ' +
                'INNER JOIN transaction payment ON payment.id = ntll.nextdoc',
            example: 'FROM transaction inv ' +
                'INNER JOIN NextTransactionLineLink ntll ON ntll.previousdoc = inv.id ' +
                'INNER JOIN transaction pymt ON pymt.id = ntll.nextdoc AND pymt.type = \'CustPymt\''
        },
        
        // Date syntax without TO_DATE
        bareDateStrings: {
            detect: function(query) {
                var hasBetweenWithStringDates = /BETWEEN\s+['"][0-9]{4}-[0-9]{2}-[0-9]{2}['"]/.test(query);
                var hasDateCompareWithStringDates = /(>=|<=|>|<|=)\s*['"][0-9]{4}-[0-9]{2}-[0-9]{2}['"]/.test(query);
                return (hasBetweenWithStringDates || hasDateCompareWithStringDates) && 
                       !query.toUpperCase().includes('TO_DATE');
            },
            guidance: '⚠️ DATE SYNTAX ERROR: SuiteQL requires TO_DATE() for all date comparisons. ' +
                'You used bare string dates which causes "Invalid search" errors. ' +
                'ALWAYS wrap date literals with TO_DATE(\'YYYY-MM-DD\', \'YYYY-MM-DD\').',
            example: 'WHERE trandate >= TO_DATE(\'2024-04-01\', \'YYYY-MM-DD\') AND trandate < TO_DATE(\'2025-04-01\', \'YYYY-MM-DD\')'
        },
        
        // Fan-out join bug (TAL + TL without proper link)
        fanOutJoin: {
            detect: function(query) {
                var q = query.toLowerCase();
                var hasTAL = q.includes('transactionaccountingline');
                var hasTL = q.includes('transactionline');
                var hasProperLink = q.includes('transactionaccountingline.transactionline') || 
                                    q.includes('tal.transactionline') ||
                                    q.includes('.transactionline');
                // Has both tables but missing the 1:1 link
                return hasTAL && hasTL && !hasProperLink && q.includes('transactionline.transaction');
            },
            guidance: '⚠️ FAN-OUT BUG: Joining TransactionAccountingLine and TransactionLine only on transaction.id creates a Cartesian product. ' +
                'You MUST add: AND transactionline.id = transactionaccountingline.transactionline to link them 1:1.',
            example: 'INNER JOIN transactionline ON transactionline.transaction = transaction.id ' +
                'AND transactionline.id = transactionaccountingline.transactionline AND transactionline.mainline = \'F\''
        },
        
        // Ghost field: transactionline.account
        ghostAccountField: {
            detect: function(query) {
                var q = query.toLowerCase();
                return q.includes('transactionline.account') && !q.includes('transactionaccountingline.account');
            },
            guidance: '⚠️ GHOST FIELD: transactionline.account is NOT EXPOSED in SuiteQL and returns NULL. ' +
                'You must get the account from TransactionAccountingLine instead.',
            example: 'INNER JOIN account ON account.id = transactionaccountingline.account (NOT transactionline.account)'
        }
    };
    
    /**
     * Analyze a failed query and return specific guidance based on SQL patterns
     * @param {string} query - The failed SQL query
     * @param {string} error - The error message (optional, for context)
     * @returns {object|null} - { guidance, example } or null if no specific pattern matched
     */
    function getQueryErrorGuidance(query, error) {
        if (!query) return null;
        
        // Check each error pattern
        for (var patternId in QUERY_ERROR_PATTERNS) {
            var pattern = QUERY_ERROR_PATTERNS[patternId];
            if (pattern.detect(query)) {
                return {
                    patternId: patternId,
                    guidance: pattern.guidance,
                    example: pattern.example
                };
            }
        }
        
        return null;
    }

    return {
        GOTCHAS: GOTCHAS,
        FRAGMENTS: FRAGMENTS,
        PATTERNS: PATTERNS,
        BUILTIN_FUNCTIONS: BUILTIN_FUNCTIONS,
        QUERY_ERROR_PATTERNS: QUERY_ERROR_PATTERNS,
        getGotchasForTables: getGotchasForTables,
        getPattern: getPattern,
        getPatternsByComplexity: getPatternsByComplexity,
        getFragment: getFragment,
        getFragmentsByType: getFragmentsByType,
        getPatternSummaryForPlanning: getPatternSummaryForPlanning,
        getGotchasSummary: getGotchasSummary,
        getBuiltinFunctionsSummary: getBuiltinFunctionsSummary,
        getQueryErrorGuidance: getQueryErrorGuidance
    };
});