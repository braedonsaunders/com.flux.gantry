/**
 * Lib_SpendVelocity_Data.js
 * Spend Velocity Analysis - Account-Centric Approach
 * 
 * Primary Focus: GL Expense Accounts (Categories)
 * Secondary: Bills vs Expense Reports breakdown
 * Tertiary: Vendor drill-down
 * 
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/query', 'N/log', './Lib_Core'], function(query, log, Core) {
    'use strict';
    
    // ==========================================
    // SAFE QUERY WRAPPER
    // ==========================================
    function safeQuery(sql, description) {
        try {
            return Core.runQuery(sql);
        } catch (e) {
            log.error('SpendVelocity Query Error: ' + description, {
                error: e.message,
                name: e.name,
                sql: sql.substring(0, 800)
            });
            // Return the error info so it appears in diagnostics
            return { _error: e.message, _sql: sql.substring(0, 300) };
        }
    }
    
    // Helper to check if result is an error
    function isQueryError(result) {
        return result && result._error;
    }
    
    // ==========================================
    // CONFIGURATION
    // ==========================================
    function getDefaultConfig() {
        return {
            velocityHighThreshold: 15,
            velocityMediumThreshold: 5,
            accelerationThreshold: 5,
            anomalyStdDevThreshold: 2.5,
            topAccountsCount: 999,
            topVendorsCount: 30,
            boilingFrogMonths: 6,
            boilingFrogMinIncrease: 3,
            zombieMinMonths: 6,
            fragmentationMinTxns: 20,
            fragmentationMaxAvgSize: 500
        };
    }
    
    // ==========================================
    // CAGR CALCULATION HELPER
    // Calculates Compound Annual Growth Rate - more meaningful than averaging MoM changes
    // Returns monthly CAGR as percentage
    // ==========================================
    function calculateCAGR(startValue, endValue, periods) {
        // Handle edge cases
        if (periods < 1 || startValue <= 0) return 0;
        if (endValue <= 0) return -100; // Complete decline
        
        // CAGR formula: (EndValue/StartValue)^(1/periods) - 1
        // Expressed as monthly percentage
        var cagr = (Math.pow(endValue / startValue, 1 / periods) - 1) * 100;
        
        // Cap extreme values for display sanity (-100% to +200%)
        return Math.max(-100, Math.min(200, cagr));
    }
    
    // Calculate velocity using CAGR from monthly amounts array
    function calculateVelocityCAGR(monthlyAmounts, minBaseAmount) {
        minBaseAmount = minBaseAmount || 100; // Default minimum base to avoid division artifacts
        
        if (!monthlyAmounts || monthlyAmounts.length < 2) return 0;
        
        var startValue = monthlyAmounts[0];
        var endValue = monthlyAmounts[monthlyAmounts.length - 1];
        var periods = monthlyAmounts.length - 1;
        
        // Require minimum starting value to avoid extreme percentages from small bases
        if (startValue < minBaseAmount) {
            // If started small, use first month exceeding threshold as base
            for (var i = 0; i < monthlyAmounts.length - 1; i++) {
                if (monthlyAmounts[i] >= minBaseAmount) {
                    startValue = monthlyAmounts[i];
                    endValue = monthlyAmounts[monthlyAmounts.length - 1];
                    periods = monthlyAmounts.length - 1 - i;
                    break;
                }
            }
            // If never exceeded threshold, return 0 (too small to calculate meaningful velocity)
            if (startValue < minBaseAmount) return 0;
        }
        
        return calculateCAGR(startValue, endValue, periods);
    }
    
    // ==========================================
    // MAIN ANALYSIS FUNCTION
    // ==========================================
    function analyzeSpendVelocity(params) {
        // Use fiscal year defaults if no dates provided
        var fiscalDates = getFiscalYearDates();
        var startDate = params.startDate || fiscalDates.startDate;
        var endDate = params.endDate || fiscalDates.endDate;
        var subsidiaryId = params.subsidiaryId;
        var config = Object.assign(getDefaultConfig(), params.config || {});
        
        var diagnostics = {
            _version: 'v3.0-core-based',
            startDate: startDate,
            endDate: endDate,
            subsidiaryId: subsidiaryId,
            queries: {},
            errors: []
        };
        
        var results = {};
        
        try {
            // DIAGNOSTIC 1: Check field population using EXPOSED fields only
            var fieldDiagSql = "SELECT " +
                "SUM(CASE WHEN TL.expenseaccount IS NOT NULL THEN 1 ELSE 0 END) AS has_expenseaccount, " +
                "SUM(CASE WHEN TL.netamount IS NOT NULL AND TL.netamount <> 0 THEN 1 ELSE 0 END) AS has_netamount, " +
                "COUNT(*) AS total_lines " +
                "FROM TransactionLine TL " +
                "INNER JOIN Transaction T ON TL.transaction = T.id " +
                "WHERE T.type IN ('VendBill', 'VendCred', 'Check', 'ExpRept') AND T.voided = 'F' " +
                "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
                "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
                "AND TL.mainline = 'F'";
            var fieldResult = safeQuery(fieldDiagSql, 'fieldPopulation');
            diagnostics.fieldPopulation = isQueryError(fieldResult) ? fieldResult : fieldResult;
            
            // DIAGNOSTIC 2: Sample transaction lines using EXPOSED fields
            var sampleSql = "SELECT " +
                "T.type, TL.expenseaccount, TL.netamount, BUILTIN.DF(TL.expenseaccount) AS acct_name " +
                "FROM TransactionLine TL " +
                "INNER JOIN Transaction T ON TL.transaction = T.id " +
                "WHERE T.type IN ('VendBill', 'ExpRept') AND T.voided = 'F' " +
                "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
                "AND TL.mainline = 'F' " +
                "AND TL.expenseaccount IS NOT NULL " +
                "AND ROWNUM <= 5";
            var sampleResult = safeQuery(sampleSql, 'sampleLines');
            diagnostics.sampleLines = isQueryError(sampleResult) ? sampleResult : sampleResult;
            
            // 1. Account-level spend by month (PRIMARY)
            var accountSpend = getMonthlyAccountSpend(startDate, endDate, subsidiaryId);
            if (isQueryError(accountSpend)) {
                diagnostics.queries.accountSpend = { count: 0, error: accountSpend._error };
                accountSpend = [];
            } else {
                diagnostics.queries.accountSpend = { count: accountSpend.length };
            }
            
            // 1b. Get account names separately (BUILTIN.DF works in non-aggregate queries)
            var accountNames = {};
            if (accountSpend.length > 0) {
                var accountIds = [];
                accountSpend.forEach(function(row) {
                    if (row.account_id && accountIds.indexOf(row.account_id) === -1) {
                        accountIds.push(row.account_id);
                    }
                });
                
                if (accountIds.length > 0) {
                    var nameSql = "SELECT id, BUILTIN.DF(id) AS account_name FROM Account WHERE id IN (" + accountIds.slice(0, 100).join(',') + ")";
                    var nameResults = safeQuery(nameSql, 'accountNames');
                    if (!isQueryError(nameResults)) {
                        nameResults.forEach(function(row) {
                            accountNames[row.id] = row.account_name;
                        });
                    }
                }
                
                // Merge names back into accountSpend
                accountSpend.forEach(function(row) {
                    if (accountNames[row.account_id]) {
                        row.account_name = accountNames[row.account_id];
                    }
                });
            }
            
            // 2. Bill vs Expense Report breakdown
            var transactionBreakdown = getTransactionTypeBreakdown(startDate, endDate, subsidiaryId);
            if (isQueryError(transactionBreakdown)) {
                diagnostics.queries.transactionBreakdown = { count: 0, error: transactionBreakdown._error };
                transactionBreakdown = [];
            } else {
                diagnostics.queries.transactionBreakdown = { count: transactionBreakdown.length };
            }
            
            // 3. Vendor spend for drill-down
            var vendorSpend = getMonthlyVendorSpend(startDate, endDate, subsidiaryId);
            if (isQueryError(vendorSpend)) {
                diagnostics.queries.vendorSpend = { count: 0, error: vendorSpend._error };
                vendorSpend = [];
            } else {
                diagnostics.queries.vendorSpend = { count: vendorSpend.length };
            }
            
            // 4. Calculate velocities
            results.accountVelocity = calculateAccountVelocity(accountSpend, config);
            results.transactionTypes = analyzeTransactionTypes(transactionBreakdown);
            results.vendorVelocity = calculateVendorVelocity(vendorSpend, config);
            
            // 5. Summary metrics
            results.summary = buildSummary(results.accountVelocity, results.transactionTypes);
            
            // 6. Anomaly detection on accounts
            results.anomalies = detectAccountAnomalies(accountSpend, config);
            
            // 7. Monthly trends (with prior year comparison)
            var priorYearTotals = getPriorYearMonthlyTotals(startDate, endDate, subsidiaryId);
            results.monthlyTrends = buildMonthlyTrends(accountSpend, vendorSpend, priorYearTotals);
            
            // 8. Seasonal patterns
            results.seasonalPatterns = analyzeSeasonalPatterns(accountSpend);
            
            // 9. Boiling frog on accounts
            results.boilingFrog = detectBoilingFrog(accountSpend, config);
            
            // 10. Concentration risk
            results.concentrationRisk = analyzeConcentrationRisk(results.accountVelocity);
            
            // 11. Treemap data for accounts
            results.treemapData = buildTreemapData(results.accountVelocity);
            
            // 12. NEW: Zombie Subscription Detector
            results.zombieSubscriptions = detectZombieSubscriptions(vendorSpend, config);
            
            // 13. NEW: Category Fragmentation Detector
            results.categoryFragmentation = detectCategoryFragmentation(accountSpend, vendorSpend, config);
            
            // 14. NEW: Shadow IT Detector - tracks viral software adoption
            results.shadowIT = detectShadowIT(startDate, endDate, subsidiaryId);
            
            // 15. NEW: Commitment Cliff Detector - PO vs SO velocity analysis
            results.commitmentCliff = detectCommitmentCliff(startDate, endDate, subsidiaryId);
            
            // 16. NEW: Revenue-Normalized Velocity
            results.revenueAnalysis = calculateRevenueNormalizedVelocity(startDate, endDate, subsidiaryId);
            
            // 17. Insights (updated to include new detectors)
            results.insights = generateInsights(results);
            
            // 18. Period Comparison - current vs prior vs 2 back with projections
            results.periodComparison = calculatePeriodComparison(startDate, endDate, subsidiaryId, results.accountVelocity);
            
            // 19. Transaction Details for drill-down
            results.transactions = getTransactionDetails(startDate, endDate, subsidiaryId);
            
            // 20. Expense Analysis - top spenders, categories with changes
            results.expenseAnalysis = analyzeExpenseReports(startDate, endDate, subsidiaryId);
            
            // 21. All Accounts - deep analysis with full metrics
            results.allAccounts = buildAllAccountsDeep(accountSpend, results.accountVelocity, startDate, endDate);
            
            // 22. COMPREHENSIVE HEALTH SCORE - calculated after all detectors
            results.summary.healthScore = calculateComprehensiveHealthScore(results);
            results.summary.healthGrade = getHealthGrade(results.summary.healthScore);
            
            // Currency info and date range used
            results.currencyInfo = { symbol: 'CAD', name: 'CAN' };
            results.dateRange = { startDate: startDate, endDate: endDate };
            results._config = config;
            
        } catch (e) {
            diagnostics.errors.push({ stage: 'analysis', error: e.message, stack: e.stack });
            log.error('Spend Velocity Analysis Error', e);
        }
        
        return {
            results: results,
            diagnostics: diagnostics,
            _meta: { dashboardId: 'spendvelocity', dashboardName: 'Spend Velocity' }
        };
    }
    
    // ==========================================
    // QUERY: MONTHLY ACCOUNT SPEND (PRIMARY)
    // Uses only SuiteQL-EXPOSED fields: expenseaccount, netamount, acctnumber, accttype
    // Note: acctname is NOT_EXPOSED, so use acctnumber for display
    // ==========================================
    function getMonthlyAccountSpend(startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        // IMPORTANT: Filter to ONLY expense-type accounts
        // Excludes: Assets (1xxx), Liabilities (2xxx), Equity (3xxx), Revenue (4xxx)
        // Includes: Expense, OthExpense, and optionally COGS
        var sql = "SELECT " +
            "TL.expenseaccount AS account_id, " +
            "A.acctnumber AS account_number, " +
            "A.acctnumber AS account_name, " +
            "A.accttype AS account_type, " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "EXTRACT(MONTH FROM T.trandate) AS month_num, " +
            "SUM(CASE WHEN T.type = 'VendBill' THEN ABS(TL.netamount) ELSE 0 END) AS bill_amount, " +
            "SUM(CASE WHEN T.type = 'ExpRept' THEN ABS(TL.netamount) ELSE 0 END) AS expense_amount, " +
            "SUM(CASE WHEN T.type = 'Check' THEN ABS(TL.netamount) ELSE 0 END) AS check_amount, " +
            "SUM(CASE WHEN T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END) AS credit_amount, " +
            "SUM(CASE WHEN T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - SUM(CASE WHEN T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END) AS total_amount, " +
            "COUNT(DISTINCT T.id) AS transaction_count, " +
            "COUNT(DISTINCT CASE WHEN T.type = 'VendBill' THEN T.id END) AS bill_count, " +
            "COUNT(DISTINCT CASE WHEN T.type = 'ExpRept' THEN T.id END) AS expense_count " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "INNER JOIN Account A ON A.id = TL.expenseaccount " +
            "WHERE T.type IN ('VendBill', 'VendCred', 'Check', 'ExpRept') AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            "AND TL.expenseaccount IS NOT NULL " +
            "AND A.accttype IN ('Expense', 'OthExpense', 'COGS') " +
            subFilter +
            " GROUP BY TL.expenseaccount, A.acctnumber, A.accttype, TO_CHAR(T.trandate, 'YYYY-MM'), EXTRACT(MONTH FROM T.trandate) " +
            "HAVING (SUM(CASE WHEN T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - SUM(CASE WHEN T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END)) > 0 " +
            "ORDER BY (SUM(CASE WHEN T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - SUM(CASE WHEN T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END)) DESC";
        
        return safeQuery(sql, 'monthlyAccountSpend');
    }
    
    // ==========================================
    // QUERY: TRANSACTION TYPE BREAKDOWN
    // ==========================================
    function getTransactionTypeBreakdown(startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        var sql = "SELECT " +
            "T.type AS transaction_type, " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "SUM(ABS(TL.netamount)) AS total_amount, " +
            "COUNT(DISTINCT T.id) AS transaction_count, " +
            "COUNT(DISTINCT T.entity) AS entity_count " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type IN ('VendBill', 'ExpRept', 'Check', 'VendCred') AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            subFilter +
            " GROUP BY T.type, TO_CHAR(T.trandate, 'YYYY-MM') " +
            "HAVING SUM(ABS(TL.netamount)) > 0 " +
            "ORDER BY T.type, TO_CHAR(T.trandate, 'YYYY-MM')";
        
        return safeQuery(sql, 'transactionTypeBreakdown');
    }
    
    // ==========================================
    // QUERY: MONTHLY VENDOR SPEND (DRILL-DOWN)
    // Note: Cannot use BUILTIN.DF in GROUP BY context
    // Expense reports have Employee entities, not Vendors - handle in post-processing
    // ==========================================
    function getMonthlyVendorSpend(startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        var sql = "SELECT " +
            "T.entity AS vendor_id, " +
            "V.entityid AS vendor_name, " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "SUM(CASE WHEN T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - SUM(CASE WHEN T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END) AS total_amount, " +
            "COUNT(DISTINCT T.id) AS transaction_count " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "LEFT JOIN Vendor V ON V.id = T.entity " +
            "WHERE T.type IN ('VendBill', 'VendCred', 'Check', 'ExpRept') AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            "AND T.entity IS NOT NULL " +
            subFilter +
            " GROUP BY T.entity, V.entityid, TO_CHAR(T.trandate, 'YYYY-MM') " +
            "HAVING (SUM(CASE WHEN T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - SUM(CASE WHEN T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END)) > 0 " +
            "ORDER BY (SUM(CASE WHEN T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - SUM(CASE WHEN T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END)) DESC";
        
        return safeQuery(sql, 'monthlyVendorSpend');
    }
    
    // ==========================================
    // CALCULATE ACCOUNT VELOCITY (PRIMARY)
    // ==========================================
    function calculateAccountVelocity(accountSpend, config) {
        var accountData = {};
        
        accountSpend.forEach(function(row) {
            var accountId = row.account_id;
            if (!accountId) return;
            
            if (!accountData[accountId]) {
                accountData[accountId] = {
                    accountId: accountId,
                    accountNumber: row.account_number || '',
                    accountName: row.account_name || ('Account ' + accountId),
                    accountType: row.account_type,
                    months: [],
                    totalSpend: 0,
                    totalBills: 0,
                    totalExpenses: 0,
                    totalOther: 0,
                    transactionCount: 0,
                    billCount: 0,
                    expenseCount: 0
                };
            }
            
            var amount = Core.toNumber(row.total_amount);
            var billAmt = Core.toNumber(row.bill_amount);
            var expAmt = Core.toNumber(row.expense_amount);
            var checkAmt = Core.toNumber(row.check_amount);
            var creditAmt = Core.toNumber(row.credit_amount);
            var othAmt = checkAmt - creditAmt; // Net of checks minus credits
            
            accountData[accountId].months.push({
                month: row.month,
                amount: amount,
                billAmount: billAmt,
                expenseAmount: expAmt,
                otherAmount: othAmt,
                checkAmount: checkAmt,
                creditAmount: creditAmt,
                txnCount: Core.toNumber(row.transaction_count)
            });
            
            accountData[accountId].totalSpend += amount;
            accountData[accountId].totalBills += billAmt;
            accountData[accountId].totalExpenses += expAmt;
            accountData[accountId].totalOther += othAmt;
            accountData[accountId].totalCredits = (accountData[accountId].totalCredits || 0) + creditAmt;
            accountData[accountId].transactionCount += Core.toNumber(row.transaction_count);
            accountData[accountId].billCount += Core.toNumber(row.bill_count);
            accountData[accountId].expenseCount += Core.toNumber(row.expense_count);
        });
        
        var results = [];
        
        Object.keys(accountData).forEach(function(key) {
            var acct = accountData[key];
            acct.months.sort(function(a, b) { return a.month.localeCompare(b.month); });
            
            var velocity = 0;
            var acceleration = 0;
            var trend = 'stable';
            
            if (acct.months.length >= 2) {
                // Use CAGR for velocity calculation
                var monthlyAmounts = acct.months.map(function(m) { return m.amount; });
                velocity = calculateVelocityCAGR(monthlyAmounts, config.minBaseAmount || 100);
                
                // Calculate acceleration by comparing recent vs early period CAGR
                if (acct.months.length >= 4) {
                    var midpoint = Math.floor(acct.months.length / 2);
                    var earlyAmounts = monthlyAmounts.slice(0, midpoint + 1);
                    var recentAmounts = monthlyAmounts.slice(midpoint);
                    var earlyVelocity = calculateVelocityCAGR(earlyAmounts, config.minBaseAmount || 100);
                    var recentVelocity = calculateVelocityCAGR(recentAmounts, config.minBaseAmount || 100);
                    acceleration = recentVelocity - earlyVelocity;
                }
                
                if (velocity > config.velocityHighThreshold) {
                    trend = acceleration > 0 ? 'accelerating' : 'high';
                } else if (velocity > config.velocityMediumThreshold) {
                    trend = 'rising';
                } else if (velocity < -config.velocityMediumThreshold) {
                    trend = 'declining';
                }
            } else if (acct.months.length === 1) {
                trend = 'new';
            }
            
            var latestMonth = acct.months[acct.months.length - 1];
            var previousMonth = acct.months.length > 1 ? acct.months[acct.months.length - 2] : null;
            
            results.push({
                accountId: acct.accountId,
                accountNumber: acct.accountNumber,
                accountName: acct.accountName,
                accountType: acct.accountType,
                totalSpend: acct.totalSpend,
                totalBills: acct.totalBills,
                totalExpenses: acct.totalExpenses,
                totalOther: acct.totalOther,
                billPct: acct.totalSpend > 0 ? Math.round((acct.totalBills / acct.totalSpend) * 100) : 0,
                expensePct: acct.totalSpend > 0 ? Math.round((acct.totalExpenses / acct.totalSpend) * 100) : 0,
                transactionCount: acct.transactionCount,
                billCount: acct.billCount,
                expenseCount: acct.expenseCount,
                monthCount: acct.months.length,
                velocity: Math.round(velocity * 10) / 10,
                acceleration: Math.round(acceleration * 10) / 10,
                trend: trend,
                latestSpend: latestMonth ? latestMonth.amount : 0,
                previousSpend: previousMonth ? previousMonth.amount : 0,
                avgMonthlySpend: acct.totalSpend / acct.months.length,
                monthlyAmounts: acct.months.map(function(m) { return m.amount; }),
                monthLabels: acct.months.map(function(m) { return m.month; }),
                // For deep linking
                entityId: acct.accountId,
                entityType: 'account',
                // For scatter plot positioning
                x: Math.round(velocity * 10) / 10, // X-axis: Velocity
                y: Math.round(acceleration * 10) / 10 // Y-axis: Acceleration
            });
        });
        
        results.sort(function(a, b) { return b.totalSpend - a.totalSpend; });
        return results.slice(0, config.topAccountsCount);
    }
    
    // ==========================================
    // ANALYZE TRANSACTION TYPES
    // ==========================================
    function analyzeTransactionTypes(breakdown) {
        var typeData = {};
        var monthlyTotals = {};
        
        breakdown.forEach(function(row) {
            var type = row.transaction_type;
            var month = row.month;
            var amount = Core.toNumber(row.total_amount);
            
            if (!typeData[type]) {
                typeData[type] = { type: type, months: [], total: 0, count: 0 };
            }
            
            typeData[type].months.push({
                month: month,
                amount: amount,
                count: Core.toNumber(row.transaction_count)
            });
            typeData[type].total += amount;
            typeData[type].count += Core.toNumber(row.transaction_count);
            
            if (!monthlyTotals[month]) monthlyTotals[month] = 0;
            monthlyTotals[month] += amount;
        });
        
        var results = {
            bills: { total: 0, count: 0, velocity: 0, monthlyAmounts: [], monthLabels: [] },
            expenses: { total: 0, count: 0, velocity: 0, monthlyAmounts: [], monthLabels: [] },
            other: { total: 0, count: 0, velocity: 0, monthlyAmounts: [], monthLabels: [] },
            monthly: []
        };
        
        Object.keys(typeData).forEach(function(type) {
            var data = typeData[type];
            data.months.sort(function(a, b) { return a.month.localeCompare(b.month); });
            
            // Use CAGR for velocity calculation
            var monthlyAmounts = data.months.map(function(m) { return m.amount; });
            var velocity = calculateVelocityCAGR(monthlyAmounts, 100);
            
            var target;
            if (type === 'VendBill') {
                target = results.bills;
            } else if (type === 'ExpRept') {
                target = results.expenses;
            } else {
                target = results.other;
            }
            
            target.total += data.total;
            target.count += data.count;
            target.velocity = Math.round(velocity * 10) / 10;
            target.monthlyAmounts = data.months.map(function(m) { return m.amount; });
            target.monthLabels = data.months.map(function(m) { return m.month; });
        });
        
        var allMonths = Object.keys(monthlyTotals).sort();
        allMonths.forEach(function(month) {
            var billAmt = 0, expAmt = 0;
            
            if (typeData['VendBill']) {
                var billMonth = typeData['VendBill'].months.find(function(m) { return m.month === month; });
                if (billMonth) billAmt = billMonth.amount;
            }
            if (typeData['ExpRept']) {
                var expMonth = typeData['ExpRept'].months.find(function(m) { return m.month === month; });
                if (expMonth) expAmt = expMonth.amount;
            }
            
            results.monthly.push({
                month: month,
                billAmount: billAmt,
                expenseAmount: expAmt,
                total: monthlyTotals[month]
            });
        });
        
        return results;
    }
    
    // ==========================================
    // CALCULATE VENDOR VELOCITY (DRILL-DOWN)
    // ==========================================
    function calculateVendorVelocity(vendorSpend, config) {
        var vendorData = {};
        
        vendorSpend.forEach(function(row) {
            var vendorId = row.vendor_id;
            if (!vendorId) return;
            
            if (!vendorData[vendorId]) {
                vendorData[vendorId] = {
                    vendorId: vendorId,
                    vendorName: row.vendor_name || ('Vendor ' + vendorId),
                    months: [],
                    totalSpend: 0,
                    transactionCount: 0
                };
            }
            
            var amount = Core.toNumber(row.total_amount);
            vendorData[vendorId].months.push({
                month: row.month,
                amount: amount,
                txnCount: Core.toNumber(row.transaction_count)
            });
            vendorData[vendorId].totalSpend += amount;
            vendorData[vendorId].transactionCount += Core.toNumber(row.transaction_count);
        });
        
        var results = [];
        
        Object.keys(vendorData).forEach(function(key) {
            var vendor = vendorData[key];
            vendor.months.sort(function(a, b) { return a.month.localeCompare(b.month); });
            
            var velocity = 0;
            var acceleration = 0;
            var trend = 'stable';
            
            if (vendor.months.length >= 2) {
                // Use CAGR for velocity calculation
                var monthlyAmounts = vendor.months.map(function(m) { return m.amount; });
                velocity = calculateVelocityCAGR(monthlyAmounts, config.minBaseAmount || 100);
                
                // Calculate acceleration by comparing recent vs early period CAGR
                if (vendor.months.length >= 4) {
                    var midpoint = Math.floor(vendor.months.length / 2);
                    var earlyAmounts = monthlyAmounts.slice(0, midpoint + 1);
                    var recentAmounts = monthlyAmounts.slice(midpoint);
                    var earlyVelocity = calculateVelocityCAGR(earlyAmounts, config.minBaseAmount || 100);
                    var recentVelocity = calculateVelocityCAGR(recentAmounts, config.minBaseAmount || 100);
                    acceleration = recentVelocity - earlyVelocity;
                }
                
                if (velocity > config.velocityHighThreshold) {
                    trend = acceleration > 0 ? 'accelerating' : 'high';
                } else if (velocity > config.velocityMediumThreshold) {
                    trend = 'rising';
                } else if (velocity < -config.velocityMediumThreshold) {
                    trend = 'declining';
                }
            } else if (vendor.months.length === 1) {
                trend = 'new';
            }
            
            var latestMonth = vendor.months[vendor.months.length - 1];
            var previousMonth = vendor.months.length > 1 ? vendor.months[vendor.months.length - 2] : null;
            
            results.push({
                vendorId: vendor.vendorId,
                vendorName: vendor.vendorName,
                totalSpend: vendor.totalSpend,
                transactionCount: vendor.transactionCount,
                monthCount: vendor.months.length,
                velocity: Math.round(velocity * 10) / 10,
                acceleration: Math.round(acceleration * 10) / 10,
                trend: trend,
                latestSpend: latestMonth ? latestMonth.amount : 0,
                previousSpend: previousMonth ? previousMonth.amount : 0,
                avgMonthlySpend: vendor.totalSpend / vendor.months.length,
                monthlyAmounts: vendor.months.map(function(m) { return m.amount; }),
                monthLabels: vendor.months.map(function(m) { return m.month; }),
                // For deep linking and scatter plot
                entityId: vendor.vendorId,
                entityType: 'vendor',
                // For scatter plot positioning
                x: Math.round(velocity * 10) / 10, // X-axis: Velocity
                y: Math.round(acceleration * 10) / 10 // Y-axis: Acceleration
            });
        });
        
        results.sort(function(a, b) { return b.totalSpend - a.totalSpend; });
        return results.slice(0, config.topVendorsCount);
    }
    
    // ==========================================
    // BUILD SUMMARY
    // ==========================================
    function buildSummary(accountVelocity, transactionTypes) {
        var totalSpend = accountVelocity.reduce(function(sum, a) { return sum + a.totalSpend; }, 0);
        var avgVelocity = accountVelocity.length > 0 
            ? accountVelocity.reduce(function(sum, a) { return sum + a.velocity; }, 0) / accountVelocity.length 
            : 0;
        var avgAcceleration = accountVelocity.length > 0
            ? accountVelocity.reduce(function(sum, a) { return sum + a.acceleration; }, 0) / accountVelocity.length
            : 0;
        
        var acceleratingCount = accountVelocity.filter(function(a) { return a.trend === 'accelerating'; }).length;
        var deceleratingCount = accountVelocity.filter(function(a) { return a.trend === 'declining'; }).length;
        var highVelocityCount = accountVelocity.filter(function(a) { return a.velocity > 15; }).length;
        
        var healthScore = 100;
        healthScore -= Math.min(30, acceleratingCount * 3);
        healthScore -= Math.min(30, highVelocityCount * 2);
        healthScore = Math.max(0, healthScore);
        
        var healthGrade = 'A';
        if (healthScore < 60) healthGrade = 'F';
        else if (healthScore < 70) healthGrade = 'D';
        else if (healthScore < 80) healthGrade = 'C';
        else if (healthScore < 90) healthGrade = 'B';
        
        return {
            totalSpend: totalSpend,
            accountCount: accountVelocity.length,
            avgVelocity: Math.round(avgVelocity * 10) / 10,
            avgAcceleration: Math.round(avgAcceleration * 10) / 10,
            acceleratingCount: acceleratingCount,
            deceleratingCount: deceleratingCount,
            highVelocityCount: highVelocityCount,
            healthScore: healthScore,
            healthGrade: healthGrade,
            billsTotal: transactionTypes.bills.total,
            expensesTotal: transactionTypes.expenses.total,
            billsVelocity: transactionTypes.bills.velocity,
            expensesVelocity: transactionTypes.expenses.velocity
        };
    }
    
    // ==========================================
    // COMPREHENSIVE HEALTH SCORE
    // Calculated after ALL detectors have run
    // Considers velocity, severity-weighted issues, and financial impact
    // ==========================================
    function calculateComprehensiveHealthScore(results) {
        var score = 100;
        var deductions = {
            velocity: 0,
            critical: 0,
            warning: 0,
            structural: 0,
            financial: 0
        };
        
        // --- VELOCITY HEALTH (max -20 pts) ---
        var summary = results.summary || {};
        var accountVelocity = results.accountVelocity || [];
        
        // High velocity accounts (>15% growth): concerning
        var highVelCount = accountVelocity.filter(function(a) { return a.velocity > 15; }).length;
        deductions.velocity += Math.min(10, highVelCount * 1.5);
        
        // Accelerating accounts: spend is increasing at increasing rate
        var accelCount = accountVelocity.filter(function(a) { return a.trend === 'accelerating'; }).length;
        deductions.velocity += Math.min(10, accelCount * 1.5);
        
        deductions.velocity = Math.min(20, deductions.velocity);
        
        // --- CRITICAL ISSUES (max -25 pts) ---
        var anomalies = results.anomalies || { summary: {} };
        var boilingFrog = results.boilingFrog || { summary: {} };
        var zombies = results.zombieSubscriptions || { summary: {} };
        var shadowIT = results.shadowIT || { summary: {} };
        var commitmentCliff = results.commitmentCliff || { summary: {} };
        
        // Critical anomalies: major unexplained spikes
        var criticalAnomalies = anomalies.summary.criticalCount || 0;
        deductions.critical += Math.min(12, criticalAnomalies * 4);
        
        // Critical boiling frog: >20% creep
        var criticalFrog = boilingFrog.summary.criticalCount || 0;
        deductions.critical += Math.min(8, criticalFrog * 3);
        
        // Critical zombies: 12+ months unchanged
        var criticalZombies = (zombies.subscriptions || []).filter(function(z) { 
            return z.severity === 'critical'; 
        }).length;
        deductions.critical += Math.min(5, criticalZombies * 2);
        
        deductions.critical = Math.min(25, deductions.critical);
        
        // --- WARNING ISSUES (max -15 pts) ---
        // Warning-level anomalies
        var warningAnomalies = (anomalies.summary.count || 0) - criticalAnomalies;
        deductions.warning += Math.min(6, warningAnomalies * 1.5);
        
        // Warning boiling frog (10-20% creep)
        var warningFrog = (boilingFrog.summary.count || 0) - criticalFrog;
        deductions.warning += Math.min(4, warningFrog * 1);
        
        // Warning zombies (6-11 months)
        var warningZombies = (zombies.summary.count || 0) - criticalZombies;
        deductions.warning += Math.min(3, warningZombies * 1);
        
        // Shadow IT viral vendors (software spreading via expense reports)
        var viralCount = shadowIT.summary.viralCount || 0;
        deductions.warning += Math.min(2, viralCount * 0.5);
        
        deductions.warning = Math.min(15, deductions.warning);
        
        // --- STRUCTURAL RISK (max -15 pts) ---
        var concentration = results.concentrationRisk || { summary: {} };
        var fragmentation = results.categoryFragmentation || { summary: {} };
        
        // Concentration risk: over-reliance on single categories
        var top1Share = concentration.summary.top1Share || 0;
        if (top1Share > 30) {
            deductions.structural += 5;
        } else if (top1Share > 25) {
            deductions.structural += 3;
        } else if (top1Share > 20) {
            deductions.structural += 1;
        }
        
        // Category fragmentation: too many small purchases
        var fragmentedCount = fragmentation.summary.fragmentedCategories || 0;
        deductions.structural += Math.min(4, fragmentedCount * 0.5);
        
        // Commitment cliff: PO velocity > SO velocity (cash pressure risk)
        var cliffStatus = commitmentCliff.summary.status || 'healthy';
        if (cliffStatus === 'critical') {
            deductions.structural += 6;
        } else if (cliffStatus === 'warning') {
            deductions.structural += 3;
        }
        
        deductions.structural = Math.min(15, deductions.structural);
        
        // --- FINANCIAL IMPACT (max -10 pts) ---
        // Based on savings potential as % of total spend
        var totalSpend = summary.totalSpend || 0;
        var savingsPotential = (boilingFrog.summary.totalAnnualizedCreep || 0) +
                              (fragmentation.summary.potentialSavings || 0) +
                              (zombies.summary.totalAnnualCost || 0);
        
        if (totalSpend > 0) {
            var savingsRatio = savingsPotential / totalSpend;
            if (savingsRatio > 0.05) {
                deductions.financial = 10;  // >5% of spend is recoverable
            } else if (savingsRatio > 0.03) {
                deductions.financial = 7;
            } else if (savingsRatio > 0.02) {
                deductions.financial = 5;
            } else if (savingsRatio > 0.01) {
                deductions.financial = 3;
            } else if (savingsRatio > 0.005) {
                deductions.financial = 1;
            }
        }
        
        // Calculate final score
        var totalDeductions = deductions.velocity + deductions.critical + 
                             deductions.warning + deductions.structural + deductions.financial;
        
        score = Math.max(0, Math.min(100, 100 - totalDeductions));
        
        // Store breakdown for debugging/display
        results._healthScoreBreakdown = {
            baseScore: 100,
            deductions: deductions,
            totalDeductions: totalDeductions,
            finalScore: score
        };
        
        return Math.round(score);
    }
    
    function getHealthGrade(score) {
        if (score >= 90) return 'A';
        if (score >= 80) return 'B';
        if (score >= 70) return 'C';
        if (score >= 60) return 'D';
        return 'F';
    }
    
    // ==========================================
    // DETECT ACCOUNT ANOMALIES
    // ==========================================
    function detectAccountAnomalies(accountSpend, config) {
        var accountData = {};
        
        accountSpend.forEach(function(row) {
            var accountId = row.account_id;
            if (!accountId) return;
            
            if (!accountData[accountId]) {
                accountData[accountId] = {
                    accountId: accountId,
                    accountName: row.account_name,
                    months: []
                };
            }
            accountData[accountId].months.push({
                month: row.month,
                amount: Core.toNumber(row.total_amount)
            });
        });
        
        var anomalies = [];
        
        Object.keys(accountData).forEach(function(key) {
            var acct = accountData[key];
            if (acct.months.length < 3) return;
            
            var amounts = acct.months.map(function(m) { return m.amount; });
            var mean = amounts.reduce(function(a, b) { return a + b; }, 0) / amounts.length;
            var variance = amounts.reduce(function(sum, val) { 
                return sum + Math.pow(val - mean, 2); 
            }, 0) / amounts.length;
            var stdDev = Math.sqrt(variance);
            
            if (stdDev === 0) return;
            
            acct.months.forEach(function(m) {
                var zScore = (m.amount - mean) / stdDev;
                if (Math.abs(zScore) >= config.anomalyStdDevThreshold) {
                    var deviation = Math.round(((m.amount - mean) / mean) * 100);
                    anomalies.push({
                        accountId: acct.accountId,
                        accountName: acct.accountName,
                        month: m.month,
                        amount: m.amount,
                        expectedAmount: mean,
                        deviation: deviation,
                        zScore: Math.round(zScore * 10) / 10,
                        type: zScore > 0 ? 'spike' : 'drop',
                        severity: Math.abs(zScore) >= 3 ? 'critical' : 'warning'
                    });
                }
            });
        });
        
        anomalies.sort(function(a, b) { return Math.abs(b.zScore) - Math.abs(a.zScore); });
        
        return {
            summary: {
                count: anomalies.length,
                spikeCount: anomalies.filter(function(a) { return a.type === 'spike'; }).length,
                dropCount: anomalies.filter(function(a) { return a.type === 'drop'; }).length,
                criticalCount: anomalies.filter(function(a) { return a.severity === 'critical'; }).length
            },
            items: anomalies.slice(0, 30)
        };
    }
    
    // ==========================================
    // BUILD MONTHLY TRENDS
    // ==========================================
    // ==========================================
    // GET PRIOR YEAR MONTHLY TOTALS
    // For YoY comparison in trends
    // ==========================================
    function getPriorYearMonthlyTotals(startDate, endDate, subsidiaryId) {
        // Calculate prior year date range
        var start = new Date(startDate);
        var end = new Date(endDate);
        start.setFullYear(start.getFullYear() - 1);
        end.setFullYear(end.getFullYear() - 1);
        
        var priorStartDate = start.toISOString().split('T')[0];
        var priorEndDate = end.toISOString().split('T')[0];
        
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        // Filter to expense-type accounts only (consistent with getMonthlyAccountSpend)
        var sql = "SELECT " +
            "TO_CHAR(T.trandate, 'MM') AS month_num, " +
            "SUM(CASE WHEN T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - SUM(CASE WHEN T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END) AS total_amount, " +
            "COUNT(DISTINCT T.id) AS transaction_count " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "INNER JOIN Account A ON A.id = TL.expenseaccount " +
            "WHERE T.type IN ('VendBill', 'VendCred', 'Check', 'ExpRept') AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + priorStartDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + priorEndDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            "AND TL.expenseaccount IS NOT NULL " +
            "AND A.accttype IN ('Expense', 'OthExpense', 'COGS') " +
            subFilter +
            " GROUP BY TO_CHAR(T.trandate, 'MM')";
        
        var rows = safeQuery(sql, 'priorYearMonthly');
        if (isQueryError(rows)) return {};
        
        // Return map keyed by month number (01, 02, etc)
        var result = {};
        rows.forEach(function(r) {
            result[r.month_num] = {
                totalAmount: Core.toNumber(r.total_amount),
                transactionCount: Core.toNumber(r.transaction_count)
            };
        });
        return result;
    }
    
    // ==========================================
    // BUILD MONTHLY TRENDS (Enhanced with YoY)
    // ==========================================
    function buildMonthlyTrends(accountSpend, vendorSpend, priorYearTotals) {
        priorYearTotals = priorYearTotals || {};
        var monthlyData = {};
        
        accountSpend.forEach(function(row) {
            var month = row.month;
            if (!monthlyData[month]) {
                monthlyData[month] = {
                    month: month,
                    totalAmount: 0,
                    accountCount: 0,
                    transactionCount: 0,
                    billAmount: 0,
                    expenseAmount: 0,
                    vendors: {}
                };
            }
            monthlyData[month].totalAmount += Core.toNumber(row.total_amount);
            monthlyData[month].accountCount++;
            monthlyData[month].transactionCount += Core.toNumber(row.transaction_count);
            monthlyData[month].billAmount += Core.toNumber(row.bill_amount);
            monthlyData[month].expenseAmount += Core.toNumber(row.expense_amount);
        });
        
        // Add vendor counts from vendorSpend
        if (vendorSpend && vendorSpend.length > 0) {
            vendorSpend.forEach(function(row) {
                var month = row.month;
                if (monthlyData[month]) {
                    monthlyData[month].vendors[row.vendor_id] = true;
                }
            });
        }
        
        var results = Object.values(monthlyData);
        results.sort(function(a, b) { return a.month.localeCompare(b.month); });
        
        for (var i = 0; i < results.length; i++) {
            // Count unique vendors
            results[i].vendorCount = Object.keys(results[i].vendors || {}).length;
            delete results[i].vendors; // Remove temp object
            
            // Add prior year comparison
            // Month format is "YYYY-MM", extract just the month part (last 2 chars)
            var monthNum = results[i].month.substring(5, 7); // "03" from "2024-03"
            var priorYear = priorYearTotals[monthNum];
            if (priorYear) {
                results[i].priorYearAmount = priorYear.totalAmount;
                results[i].priorYearTxnCount = priorYear.transactionCount;
                results[i].yoyChange = priorYear.totalAmount > 0 
                    ? Math.round(((results[i].totalAmount - priorYear.totalAmount) / priorYear.totalAmount) * 1000) / 10 
                    : 0;
            } else {
                results[i].priorYearAmount = 0;
                results[i].priorYearTxnCount = 0;
                results[i].yoyChange = 0;
            }
            
            // Month-over-month velocity
            if (i === 0) {
                results[i].velocity = 0;
            } else {
                var prev = results[i - 1].totalAmount;
                var curr = results[i].totalAmount;
                results[i].velocity = prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : 0;
            }
        }
        
        return results;
    }
    
    // ==========================================
    // ANALYZE SEASONAL PATTERNS
    // ==========================================
    function analyzeSeasonalPatterns(accountSpend) {
        var monthTotals = {};
        
        accountSpend.forEach(function(row) {
            var monthNum = Core.toNumber(row.month_num);
            var amount = Core.toNumber(row.total_amount);
            
            if (!monthTotals[monthNum]) {
                monthTotals[monthNum] = 0;
            }
            monthTotals[monthNum] += amount;
        });
        
        var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        var allTotals = Object.values(monthTotals);
        var avgMonthlyTotal = allTotals.length > 0 
            ? allTotals.reduce(function(a, b) { return a + b; }, 0) / allTotals.length 
            : 0;
        
        var patterns = [];
        for (var m = 1; m <= 12; m++) {
            var total = monthTotals[m] || 0;
            var deviation = avgMonthlyTotal > 0 
                ? Math.round(((total - avgMonthlyTotal) / avgMonthlyTotal) * 100) 
                : 0;
            
            patterns.push({
                month: m,
                monthName: monthNames[m - 1],
                totalSpend: total,
                avgSpend: total,
                deviation: deviation,
                isHigh: deviation > 15,
                isLow: deviation < -15
            });
        }
        
        var insights = [];
        var highMonths = patterns.filter(function(p) { return p.isHigh; });
        var lowMonths = patterns.filter(function(p) { return p.isLow; });
        
        if (highMonths.length > 0) {
            insights.push({
                type: 'high_season',
                months: highMonths.map(function(m) { return m.monthName; }),
                message: 'Higher spending typically occurs in ' + highMonths.map(function(m) { return m.monthName; }).join(', ')
            });
        }
        
        if (lowMonths.length > 0) {
            insights.push({
                type: 'low_season',
                months: lowMonths.map(function(m) { return m.monthName; }),
                message: 'Lower spending typically occurs in ' + lowMonths.map(function(m) { return m.monthName; }).join(', ')
            });
        }
        
        return { patterns: patterns, insights: insights };
    }
    
    // ==========================================
    // DETECT BOILING FROG (ON ACCOUNTS)
    // ==========================================
    function detectBoilingFrog(accountSpend, config) {
        var accountData = {};
        
        accountSpend.forEach(function(row) {
            var accountId = row.account_id;
            if (!accountId) return;
            
            if (!accountData[accountId]) {
                accountData[accountId] = {
                    accountId: accountId,
                    accountName: row.account_name,
                    months: []
                };
            }
            accountData[accountId].months.push({
                month: row.month,
                amount: Core.toNumber(row.total_amount)
            });
        });
        
        var boilingFrogAccounts = [];
        
        Object.keys(accountData).forEach(function(key) {
            var acct = accountData[key];
            acct.months.sort(function(a, b) { return a.month.localeCompare(b.month); });
            
            if (acct.months.length < config.boilingFrogMonths) return;
            
            var increases = 0;
            var totalCreep = 0;
            
            for (var i = 1; i < acct.months.length; i++) {
                var prev = acct.months[i - 1].amount;
                var curr = acct.months[i].amount;
                if (prev > 0) {
                    var pctChange = ((curr - prev) / prev) * 100;
                    if (pctChange > 0 && pctChange <= 10) {
                        increases++;
                        totalCreep += pctChange;
                    }
                }
            }
            
            var monotonicRatio = (increases / (acct.months.length - 1)) * 100;
            
            if (monotonicRatio >= 50 && totalCreep >= config.boilingFrogMinIncrease) {
                var startAmount = acct.months[0].amount;
                var endAmount = acct.months[acct.months.length - 1].amount;
                
                boilingFrogAccounts.push({
                    vendorId: acct.accountId,
                    vendorName: acct.accountName,
                    accountId: acct.accountId,
                    accountName: acct.accountName,
                    monotonicRatio: Math.round(monotonicRatio),
                    avgMonthlyIncrease: Math.round((totalCreep / increases) * 10) / 10,
                    totalCreep: Math.round(totalCreep),
                    startAmount: startAmount,
                    endAmount: endAmount,
                    monthCount: acct.months.length,
                    annualizedCreep: Math.round((endAmount - startAmount) * 12 / acct.months.length),
                    monthlyAmounts: acct.months.map(function(m) { return m.amount; }),
                    severity: totalCreep > 20 ? 'critical' : totalCreep > 10 ? 'warning' : 'info'
                });
            }
        });
        
        boilingFrogAccounts.sort(function(a, b) { return b.totalCreep - a.totalCreep; });
        
        var criticalCount = boilingFrogAccounts.filter(function(a) { return a.severity === 'critical'; }).length;
        var totalAnnualizedCreep = boilingFrogAccounts.reduce(function(sum, a) {
            return sum + (a.endAmount - a.startAmount) * 12 / a.monthCount;
        }, 0);
        
        return {
            summary: {
                count: boilingFrogAccounts.length,
                criticalCount: criticalCount,
                totalAnnualizedCreep: totalAnnualizedCreep
            },
            vendors: boilingFrogAccounts.slice(0, 20),
            accounts: boilingFrogAccounts.slice(0, 20)
        };
    }
    
    // ==========================================
    // ANALYZE CONCENTRATION RISK
    // ==========================================
    function analyzeConcentrationRisk(accountVelocity) {
        var totalSpend = accountVelocity.reduce(function(sum, a) { return sum + a.totalSpend; }, 0);
        
        var concentrationData = accountVelocity.map(function(acct) {
            return Object.assign({}, acct, {
                spendShare: totalSpend > 0 ? (acct.totalSpend / totalSpend) * 100 : 0
            });
        });
        
        var hhi = concentrationData.reduce(function(sum, acct) {
            return sum + Math.pow(acct.spendShare, 2);
        }, 0);
        
        var hhiStatus = hhi < 1500 ? 'low' : hhi < 2500 ? 'moderate' : 'high';
        
        var top1Share = concentrationData.length > 0 ? concentrationData[0].spendShare : 0;
        var top5Share = concentrationData.slice(0, 5).reduce(function(sum, a) { return sum + a.spendShare; }, 0);
        var top10Share = concentrationData.slice(0, 10).reduce(function(sum, a) { return sum + a.spendShare; }, 0);
        
        var riskAccounts = concentrationData.filter(function(acct) {
            return acct.spendShare > 5 && (acct.trend === 'accelerating' || acct.trend === 'high');
        });
        
        return {
            summary: {
                hhi: Math.round(hhi),
                hhiStatus: hhiStatus,
                top1Share: Math.round(top1Share * 10) / 10,
                top5Share: Math.round(top5Share * 10) / 10,
                top10Share: Math.round(top10Share * 10) / 10,
                riskAccountCount: riskAccounts.length,
                totalSpend: totalSpend
            },
            accounts: riskAccounts.slice(0, 10),
            items: riskAccounts.slice(0, 10)
        };
    }
    
    // ==========================================
    // BUILD TREEMAP DATA
    // CFO-friendly colors: Red=Risk, Grey=Stable, Green=Savings
    // ==========================================
    function buildTreemapData(accountVelocity) {
        return accountVelocity.slice(0, 30).map(function(acct) {
            // Color scheme for CFO dashboard:
            // RED: Accelerating spend (needs attention)
            // ORANGE: High velocity but not accelerating (monitor)
            // GREY: Stable spend (ignore)
            // GREEN: Declining spend (cost savings)
            var color = '#9ca3af'; // Default grey (stable)
            
            if (acct.trend === 'accelerating') {
                color = '#dc2626'; // Red - urgent
            } else if (acct.trend === 'high' || acct.trend === 'rising') {
                color = '#f97316'; // Orange - warning
            } else if (acct.trend === 'declining') {
                color = '#10b981'; // Green - good news
            } else if (acct.velocity > 10) {
                color = '#f59e0b'; // Amber - elevated
            } else if (acct.velocity < -10) {
                color = '#22c55e'; // Light green - savings
            }
            
            return {
                id: acct.accountId,
                name: acct.accountName,
                value: acct.totalSpend,
                velocity: acct.velocity,
                acceleration: acct.acceleration,
                color: color,
                trend: acct.trend,
                billPct: acct.billPct,
                expensePct: acct.expensePct,
                monthlyAmounts: acct.monthlyAmounts,
                // For drill-down linking
                entityId: acct.accountId,
                entityType: 'account'
            };
        });
    }
    
    // ==========================================
    // GENERATE INSIGHTS
    // ==========================================
    function generateInsights(results) {
        var insights = [];
        
        var highVelAccounts = results.accountVelocity.filter(function(a) { return a.velocity > 20; });
        if (highVelAccounts.length > 0) {
            insights.push({
                type: 'alert',
                category: 'velocity',
                title: 'High Growth Expense Categories',
                message: highVelAccounts.length + ' expense account(s) growing >20%/month',
                impact: 'high',
                action: 'Review spending policies for these categories',
                accounts: highVelAccounts.slice(0, 5).map(function(a) { return a.accountName; })
            });
        }
        
        var billVel = results.transactionTypes.bills.velocity;
        var expVel = results.transactionTypes.expenses.velocity;
        if (Math.abs(billVel - expVel) > 20) {
            var faster = billVel > expVel ? 'Bills' : 'Expense Reports';
            insights.push({
                type: 'warning',
                category: 'transaction_mix',
                title: 'Transaction Type Imbalance',
                message: faster + ' growing ' + Math.abs(Math.round(billVel - expVel)) + '% faster than other type',
                impact: 'medium',
                action: 'Review approval workflows and spending controls'
            });
        }
        
        if (results.anomalies.summary.criticalCount > 0) {
            insights.push({
                type: 'alert',
                category: 'anomaly',
                title: 'Spending Anomalies Detected',
                message: results.anomalies.summary.criticalCount + ' critical anomalies require investigation',
                impact: 'medium',
                action: 'Review flagged transactions for errors or unauthorized spend'
            });
        }
        
        if (results.boilingFrog.summary.criticalCount > 0) {
            insights.push({
                type: 'warning',
                category: 'boiling_frog',
                title: 'Gradual Cost Creep Detected',
                message: results.boilingFrog.summary.criticalCount + ' account(s) showing consistent increases',
                impact: 'medium',
                action: 'Negotiate rates or find alternative solutions'
            });
        }
        
        if (results.concentrationRisk.summary.top1Share > 25) {
            insights.push({
                type: 'warning',
                category: 'concentration',
                title: 'High Spend Concentration',
                message: 'Top expense category accounts for ' + Math.round(results.concentrationRisk.summary.top1Share) + '% of spend',
                impact: 'medium',
                action: 'Review for cost optimization opportunities'
            });
        }
        
        // NEW: Zombie Subscription Insights
        if (results.zombieSubscriptions && results.zombieSubscriptions.summary.count > 0) {
            insights.push({
                type: 'info',
                category: 'zombie_subscriptions',
                title: 'Potential Unused Subscriptions',
                message: results.zombieSubscriptions.summary.count + ' vendor(s) with identical recurring charges (' + 
                         formatCurrency(results.zombieSubscriptions.summary.totalAnnualCost) + '/year)',
                impact: 'medium',
                action: 'Review for usage - these may be auto-renewing unused services'
            });
        }
        
        // NEW: Category Fragmentation Insights
        if (results.categoryFragmentation && results.categoryFragmentation.summary.fragmentedCategories > 0) {
            insights.push({
                type: 'warning',
                category: 'fragmentation',
                title: 'Purchasing Fragmentation Detected',
                message: results.categoryFragmentation.summary.fragmentedCategories + ' category(ies) with high transaction volume and low avg size',
                impact: 'low',
                action: 'Consider vendor consolidation or preferred supplier agreements',
                potentialSavings: results.categoryFragmentation.summary.potentialSavings
            });
        }
        
        // NEW: Revenue vs Spend Analysis
        if (results.revenueAnalysis && results.revenueAnalysis.hasData) {
            var spendTotal = results.summary.totalSpend || 0;
            var revTotal = results.revenueAnalysis.totalRevenue || 0;
            var opexRatio = revTotal > 0 ? Math.round((spendTotal / revTotal) * 100) : 0;
            
            if (opexRatio > 50) {
                insights.push({
                    type: 'alert',
                    category: 'efficiency',
                    title: 'High OpEx to Revenue Ratio',
                    message: 'Operating expenses are ' + opexRatio + '% of revenue',
                    impact: 'high',
                    action: 'Review cost structure and identify efficiency opportunities'
                });
            }
        }
        
        // NEW: Shadow IT Insights
        if (results.shadowIT && results.shadowIT.summary.viralCount > 0) {
            insights.push({
                type: results.shadowIT.summary.criticalCount > 0 ? 'alert' : 'warning',
                category: 'shadow_it',
                title: 'Viral Software Adoption Detected',
                message: results.shadowIT.summary.viralCount + ' vendor(s) spreading across employees via expense reports (' + 
                         formatCurrency(results.shadowIT.summary.totalSpend) + ' total)',
                impact: results.shadowIT.summary.criticalCount > 0 ? 'high' : 'medium',
                action: 'Evaluate for enterprise licensing to reduce costs and improve compliance'
            });
        }
        
        // NEW: Commitment Cliff Insights
        if (results.commitmentCliff && results.commitmentCliff.summary.status !== 'healthy') {
            var cliff = results.commitmentCliff.summary;
            insights.push({
                type: cliff.status === 'critical' ? 'alert' : 'warning',
                category: 'commitment_cliff',
                title: 'Purchase-Sales Velocity Imbalance',
                message: 'PO velocity (' + cliff.poVelocity + '%/mo) exceeds SO velocity (' + cliff.soVelocity + '%/mo) by ' + 
                         cliff.velocityGap + '% - PO/SO ratio: ' + cliff.ratio + 'x',
                impact: cliff.status === 'critical' ? 'high' : 'medium',
                action: cliff.monthsToCliff 
                    ? 'Cash pressure risk in ~' + cliff.monthsToCliff + ' months. Review purchase commitments.' 
                    : 'Monitor purchase velocity and align with sales pipeline.'
            });
        }
        
        return insights;
    }
    
    // Helper for formatting currency in insights
    function formatCurrency(amount) {
        return '$' + Math.round(amount).toLocaleString();
    }
    
    // ==========================================
    // ZOMBIE SUBSCRIPTION DETECTOR
    // Identifies vendors with EXACT same amount for extended periods
    // ==========================================
    function detectZombieSubscriptions(vendorSpend, config) {
        var vendorData = {};
        
        vendorSpend.forEach(function(row) {
            var vendorId = row.vendor_id;
            if (!vendorId) return;
            
            if (!vendorData[vendorId]) {
                vendorData[vendorId] = {
                    vendorId: vendorId,
                    vendorName: row.vendor_name || ('Vendor ' + vendorId),
                    amounts: []
                };
            }
            vendorData[vendorId].amounts.push({
                month: row.month,
                amount: Math.round(Core.toNumber(row.total_amount) * 100) / 100 // Round to 2 decimals for comparison
            });
        });
        
        var zombies = [];
        var minMonths = config.zombieMinMonths || 6;
        
        Object.keys(vendorData).forEach(function(key) {
            var vendor = vendorData[key];
            vendor.amounts.sort(function(a, b) { return a.month.localeCompare(b.month); });
            
            if (vendor.amounts.length < minMonths) return;
            
            // Check for exact same amount across all months
            var firstAmount = vendor.amounts[0].amount;
            var isZombie = vendor.amounts.every(function(m) { return m.amount === firstAmount; });
            
            // Also check for very low variance (within 1%)
            if (!isZombie) {
                var amounts = vendor.amounts.map(function(m) { return m.amount; });
                var mean = amounts.reduce(function(a, b) { return a + b; }, 0) / amounts.length;
                var maxDeviation = Math.max.apply(null, amounts.map(function(a) { return Math.abs(a - mean); }));
                var deviationPct = mean > 0 ? (maxDeviation / mean) * 100 : 0;
                isZombie = deviationPct < 1; // Less than 1% deviation = zombie
            }
            
            if (isZombie && firstAmount > 0) {
                zombies.push({
                    vendorId: vendor.vendorId,
                    vendorName: vendor.vendorName,
                    amount: firstAmount,
                    monthCount: vendor.amounts.length,
                    annualCost: firstAmount * 12,
                    firstMonth: vendor.amounts[0].month,
                    lastMonth: vendor.amounts[vendor.amounts.length - 1].month,
                    severity: vendor.amounts.length >= 12 ? 'critical' : 'warning'
                });
            }
        });
        
        zombies.sort(function(a, b) { return b.annualCost - a.annualCost; });
        
        return {
            summary: {
                count: zombies.length,
                criticalCount: zombies.filter(function(z) { return z.severity === 'critical'; }).length,
                totalAnnualCost: zombies.reduce(function(sum, z) { return sum + z.annualCost; }, 0)
            },
            subscriptions: zombies.slice(0, 20)
        };
    }
    
    // ==========================================
    // CATEGORY FRAGMENTATION DETECTOR
    // Flags categories with too many vendors for the spend volume
    // ==========================================
    function detectCategoryFragmentation(accountSpend, vendorSpend, config) {
        // Group vendors by account/category
        var categoryVendors = {};
        
        // We'll approximate by looking at vendor count per account
        // In a full implementation, this would use vendor categories
        var accountToVendors = {};
        
        // First pass: count vendors per account from raw data would require 
        // a different query structure. For now, compute from transactionTypes
        var fragments = [];
        
        // Use accountVelocity data to check for fragmentation signals
        // High transaction count with low avg transaction size = fragmentation
        accountSpend.forEach(function(row) {
            var accountId = row.account_id;
            if (!accountToVendors[accountId]) {
                accountToVendors[accountId] = {
                    accountId: accountId,
                    accountName: row.account_name,
                    totalSpend: 0,
                    transactionCount: 0,
                    months: 0
                };
            }
            accountToVendors[accountId].totalSpend += Core.toNumber(row.total_amount);
            accountToVendors[accountId].transactionCount += Core.toNumber(row.transaction_count);
            accountToVendors[accountId].months++;
        });
        
        Object.keys(accountToVendors).forEach(function(key) {
            var acct = accountToVendors[key];
            var avgTxnSize = acct.transactionCount > 0 ? acct.totalSpend / acct.transactionCount : 0;
            var txnsPerMonth = acct.months > 0 ? acct.transactionCount / acct.months : 0;
            
            // Fragmentation signal: Many small transactions
            // High txn count per month + low avg txn size = fragmented purchasing
            if (txnsPerMonth > 20 && avgTxnSize < 500) {
                fragments.push({
                    accountId: acct.accountId,
                    accountName: acct.accountName,
                    totalSpend: acct.totalSpend,
                    transactionCount: acct.transactionCount,
                    avgTransactionSize: avgTxnSize,
                    txnsPerMonth: Math.round(txnsPerMonth),
                    fragmentationScore: Math.round((txnsPerMonth / avgTxnSize) * 100),
                    recommendation: 'Consider consolidating purchases or establishing preferred vendor agreements'
                });
            }
        });
        
        fragments.sort(function(a, b) { return b.fragmentationScore - a.fragmentationScore; });
        
        return {
            summary: {
                fragmentedCategories: fragments.length,
                potentialSavings: Math.round(fragments.reduce(function(sum, f) { return sum + f.totalSpend * 0.05; }, 0)) // Estimate 5% savings potential
            },
            categories: fragments.slice(0, 15)
        };
    }
    
    // ==========================================
    // SHADOW IT DETECTOR
    // Tracks viral software adoption via expense reports
    // Identifies vendors appearing across multiple employees' expense reports
    // ==========================================
    function detectShadowIT(startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        // Query expense reports grouped by vendor, tracking unique employees
        var sql = "SELECT " +
            "T.entity AS employee_id, " +
            "BUILTIN.DF(T.entity) AS employee_name, " +
            "V.id AS vendor_id, " +
            "V.entityid AS vendor_name, " +
            "V.category AS vendor_category, " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "SUM(ABS(TL.netamount)) AS amount " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "LEFT JOIN Vendor V ON V.id = TL.entity " +
            "WHERE T.type = 'ExpRept' AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            "AND TL.entity IS NOT NULL " +
            subFilter +
            " GROUP BY T.entity, BUILTIN.DF(T.entity), V.id, V.entityid, V.category, TO_CHAR(T.trandate, 'YYYY-MM') " +
            "HAVING SUM(ABS(TL.netamount)) > 0 " +
            "ORDER BY V.entityid, TO_CHAR(T.trandate, 'YYYY-MM')";
        
        var rows = safeQuery(sql, 'shadowIT');
        
        if (isQueryError(rows) || rows.length === 0) {
            return {
                summary: { viralCount: 0 },
                items: []
            };
        }
        
        // Track vendors with employee counts over time
        var vendorEmployees = {};
        
        rows.forEach(function(row) {
            var vendorId = row.vendor_id;
            if (!vendorId) return;
            
            if (!vendorEmployees[vendorId]) {
                vendorEmployees[vendorId] = {
                    vendorId: vendorId,
                    vendorName: row.vendor_name || ('Vendor ' + vendorId),
                    category: row.vendor_category,
                    monthlyEmployees: {},
                    totalAmount: 0
                };
            }
            
            var month = row.month;
            if (!vendorEmployees[vendorId].monthlyEmployees[month]) {
                vendorEmployees[vendorId].monthlyEmployees[month] = new Set();
            }
            vendorEmployees[vendorId].monthlyEmployees[month].add(row.employee_id);
            vendorEmployees[vendorId].totalAmount += Core.toNumber(row.amount);
        });
        
        // Analyze for viral patterns (growing employee adoption)
        var viralVendors = [];
        
        Object.keys(vendorEmployees).forEach(function(vendorId) {
            var vendor = vendorEmployees[vendorId];
            var months = Object.keys(vendor.monthlyEmployees).sort();
            
            if (months.length < 2) return;
            
            // Get employee counts per month
            var employeeCounts = months.map(function(m) {
                return { month: m, count: vendor.monthlyEmployees[m].size };
            });
            
            var startEmployees = employeeCounts[0].count;
            var currentEmployees = employeeCounts[employeeCounts.length - 1].count;
            
            // Calculate growth
            var employeeGrowth = startEmployees > 0 
                ? Math.round(((currentEmployees - startEmployees) / startEmployees) * 100)
                : (currentEmployees > 0 ? 100 : 0);
            
            // Viral = growing adoption (2+ employees, positive growth) 
            // or high adoption (3+ employees using same vendor)
            var isViral = (currentEmployees >= 2 && employeeGrowth > 0) || currentEmployees >= 3;
            
            if (isViral) {
                viralVendors.push({
                    vendorId: vendor.vendorId,
                    vendorName: vendor.vendorName,
                    category: vendor.category,
                    isViral: true,
                    startEmployees: startEmployees,
                    currentEmployees: currentEmployees,
                    employeeGrowth: employeeGrowth,
                    totalAmount: Math.round(vendor.totalAmount),
                    monthsTracked: months.length,
                    severity: employeeGrowth > 50 || currentEmployees >= 5 ? 'critical' : 'warning'
                });
            }
        });
        
        // Sort by employee growth (highest viral spread first)
        viralVendors.sort(function(a, b) { return b.employeeGrowth - a.employeeGrowth; });
        
        return {
            summary: {
                viralCount: viralVendors.length,
                criticalCount: viralVendors.filter(function(v) { return v.severity === 'critical'; }).length,
                totalSpend: viralVendors.reduce(function(sum, v) { return sum + v.totalAmount; }, 0)
            },
            items: viralVendors.slice(0, 10)
        };
    }
    
    // ==========================================
    // COMMITMENT CLIFF DETECTOR
    // Compares PO velocity vs SO velocity to detect cash pressure risk
    // If POs are growing faster than SOs, you're committing to spend faster than revenue
    // ==========================================
    function detectCommitmentCliff(startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        // Query Purchase Orders by month
        var poSql = "SELECT " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "SUM(ABS(TL.netamount)) AS amount, " +
            "COUNT(DISTINCT T.id) AS order_count " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type = 'PurchOrd' AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            subFilter +
            " GROUP BY TO_CHAR(T.trandate, 'YYYY-MM') " +
            "ORDER BY TO_CHAR(T.trandate, 'YYYY-MM')";
        
        // Query Sales Orders by month
        var soSql = "SELECT " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "SUM(ABS(TL.netamount)) AS amount, " +
            "COUNT(DISTINCT T.id) AS order_count " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type = 'SalesOrd' AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            subFilter +
            " GROUP BY TO_CHAR(T.trandate, 'YYYY-MM') " +
            "ORDER BY TO_CHAR(T.trandate, 'YYYY-MM')";
        
        var poData = safeQuery(poSql, 'commitmentCliffPO');
        var soData = safeQuery(soSql, 'commitmentCliffSO');
        
        // Handle query errors or missing data
        if (isQueryError(poData)) poData = [];
        if (isQueryError(soData)) soData = [];
        
        if (poData.length === 0 && soData.length === 0) {
            return {
                summary: {
                    poVelocity: 0,
                    soVelocity: 0,
                    velocityGap: 0,
                    ratio: 0,
                    status: 'healthy',
                    message: 'No PO/SO data available'
                },
                data: { months: [] }
            };
        }
        
        // Build month map
        var monthData = {};
        
        poData.forEach(function(row) {
            if (!monthData[row.month]) {
                monthData[row.month] = { month: row.month, poAmount: 0, soAmount: 0 };
            }
            monthData[row.month].poAmount = Core.toNumber(row.amount);
        });
        
        soData.forEach(function(row) {
            if (!monthData[row.month]) {
                monthData[row.month] = { month: row.month, poAmount: 0, soAmount: 0 };
            }
            monthData[row.month].soAmount = Core.toNumber(row.amount);
        });
        
        // Sort months chronologically
        var months = Object.values(monthData).sort(function(a, b) {
            return a.month.localeCompare(b.month);
        });
        
        if (months.length < 2) {
            return {
                summary: {
                    poVelocity: 0,
                    soVelocity: 0,
                    velocityGap: 0,
                    ratio: 0,
                    status: 'healthy',
                    message: 'Insufficient data for velocity analysis'
                },
                data: { months: months }
            };
        }
        
        // Calculate velocity using CAGR (same method as spend velocity)
        var poAmounts = months.map(function(m) { return m.poAmount; });
        var soAmounts = months.map(function(m) { return m.soAmount; });
        
        // Use CAGR for velocity calculation with minimum base of 1000 for PO/SO
        var poVelocity = Math.round(calculateVelocityCAGR(poAmounts, 1000));
        var soVelocity = Math.round(calculateVelocityCAGR(soAmounts, 1000));
        var velocityGap = poVelocity - soVelocity;
        
        // Calculate PO/SO ratio (total POs vs total SOs)
        var totalPO = poAmounts.reduce(function(a, b) { return a + b; }, 0);
        var totalSO = soAmounts.reduce(function(a, b) { return a + b; }, 0);
        var ratio = totalSO > 0 ? Math.round((totalPO / totalSO) * 100) / 100 : 0;
        
        // Determine status
        var status = 'healthy';
        var monthsToCliff = null;
        
        if (velocityGap > 20 || ratio > 1.5) {
            status = 'critical';
            // Estimate months until cash pressure if gap continues
            if (velocityGap > 0 && totalSO > 0) {
                monthsToCliff = Math.max(1, Math.round(12 / (velocityGap / 10)));
            }
        } else if (velocityGap > 10 || ratio > 1.2) {
            status = 'warning';
            if (velocityGap > 0 && totalSO > 0) {
                monthsToCliff = Math.max(1, Math.round(18 / (velocityGap / 10)));
            }
        }
        
        return {
            summary: {
                poVelocity: poVelocity,
                soVelocity: soVelocity,
                velocityGap: velocityGap,
                ratio: ratio,
                status: status,
                monthsToCliff: monthsToCliff,
                totalPO: Math.round(totalPO),
                totalSO: Math.round(totalSO)
            },
            data: {
                months: months
            }
        };
    }
    
    // ==========================================
    // REVENUE-NORMALIZED VELOCITY
    // Compare spend growth to revenue growth
    // ==========================================
    function calculateRevenueNormalizedVelocity(startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        // Get monthly revenue
        var revenueSql = "SELECT " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "SUM(ABS(TL.netamount)) AS revenue " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type IN ('CustInvc', 'CashSale') " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            subFilter +
            " GROUP BY TO_CHAR(T.trandate, 'YYYY-MM') " +
            "ORDER BY TO_CHAR(T.trandate, 'YYYY-MM')";
        
        var revenueData = safeQuery(revenueSql, 'revenueData');
        
        if (isQueryError(revenueData) || revenueData.length === 0) {
            return {
                hasData: false,
                message: 'Revenue data not available',
                monthlyData: []
            };
        }
        
        var monthlyRevenue = {};
        revenueData.forEach(function(row) {
            monthlyRevenue[row.month] = Core.toNumber(row.revenue);
        });
        
        return {
            hasData: true,
            monthlyRevenue: monthlyRevenue,
            totalRevenue: Object.values(monthlyRevenue).reduce(function(a, b) { return a + b; }, 0)
        };
    }
    
    // ==========================================
    // VELOCITY DRIVERS (WATERFALL DRILL-DOWN DATA)
    // Explains WHY spend changed for a specific vendor/account
    // ==========================================
    function getVelocityDrivers(entityId, entityType, currentMonth, prevMonth, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        var entityFilter = entityType === 'account' 
            ? ' AND TL.expenseaccount = ' + entityId 
            : ' AND T.entity = ' + entityId;
        
        var sql = "SELECT " +
            "T.id AS transaction_id, " +
            "T.type AS transaction_type, " +
            "T.tranid AS transaction_number, " +
            "T.trandate, " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "ABS(TL.netamount) AS amount, " +
            "TL.memo " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type IN ('VendBill', 'VendCred', 'Check', 'ExpRept') AND T.voided = 'F' " +
            "AND (TO_CHAR(T.trandate, 'YYYY-MM') = '" + currentMonth + "' " +
            "     OR TO_CHAR(T.trandate, 'YYYY-MM') = '" + prevMonth + "') " +
            "AND TL.mainline = 'F' " +
            entityFilter +
            subFilter +
            " ORDER BY TL.netamount DESC";
        
        var transactions = safeQuery(sql, 'velocityDrivers');
        
        if (isQueryError(transactions)) {
            return { error: transactions._error, drivers: [] };
        }
        
        var currentTxns = [];
        var prevTxns = [];
        var currentTotal = 0;
        var prevTotal = 0;
        
        transactions.forEach(function(txn) {
            var item = {
                transactionId: txn.transaction_id,
                transactionType: txn.transaction_type,
                transactionNumber: txn.transaction_number,
                date: txn.trandate,
                amount: Core.toNumber(txn.amount),
                memo: txn.memo || ''
            };
            
            if (txn.month === currentMonth) {
                currentTxns.push(item);
                currentTotal += item.amount;
            } else {
                prevTxns.push(item);
                prevTotal += item.amount;
            }
        });
        
        var delta = currentTotal - prevTotal;
        var deltaPct = prevTotal > 0 ? Math.round(((currentTotal - prevTotal) / prevTotal) * 100) : 0;
        
        return {
            currentMonth: currentMonth,
            previousMonth: prevMonth,
            currentTotal: currentTotal,
            previousTotal: prevTotal,
            delta: delta,
            deltaPct: deltaPct,
            currentTransactions: currentTxns.slice(0, 20),
            previousTransactions: prevTxns.slice(0, 20),
            drivers: identifyDrivers(currentTxns, prevTxns, delta)
        };
    }
    
    // Helper: Identify what's driving the change
    function identifyDrivers(currentTxns, prevTxns, delta) {
        var drivers = [];
        
        // Find new transactions (in current but not in previous)
        var prevIds = prevTxns.map(function(t) { return t.transactionId; });
        var newTxns = currentTxns.filter(function(t) { return prevIds.indexOf(t.transactionId) === -1; });
        var newAmount = newTxns.reduce(function(sum, t) { return sum + t.amount; }, 0);
        
        if (newTxns.length > 0) {
            drivers.push({
                type: 'new_transactions',
                description: newTxns.length + ' new transaction(s)',
                amount: newAmount,
                transactions: newTxns.slice(0, 5)
            });
        }
        
        // Find removed transactions
        var currentIds = currentTxns.map(function(t) { return t.transactionId; });
        var removedTxns = prevTxns.filter(function(t) { return currentIds.indexOf(t.transactionId) === -1; });
        var removedAmount = removedTxns.reduce(function(sum, t) { return sum + t.amount; }, 0);
        
        if (removedTxns.length > 0) {
            drivers.push({
                type: 'removed_transactions',
                description: removedTxns.length + ' transaction(s) not repeated',
                amount: -removedAmount,
                transactions: removedTxns.slice(0, 5)
            });
        }
        
        return drivers;
    }
    
    // ==========================================
    // GET FISCAL YEAR DATES
    // ==========================================
    function getFiscalYearDates() {
        var today = new Date();
        var currentMonth = today.getMonth(); // 0-11
        var currentYear = today.getFullYear();
        
        // Assume fiscal year starts in January (most common)
        // Can be configured per company
        var fiscalYearStartMonth = 0; // January = 0
        
        var fyStartYear = currentMonth >= fiscalYearStartMonth ? currentYear : currentYear - 1;
        var fyStart = new Date(fyStartYear, fiscalYearStartMonth, 1);
        
        var formatDate = function(d) {
            var year = d.getFullYear();
            var month = String(d.getMonth() + 1).padStart(2, '0');
            var day = String(d.getDate()).padStart(2, '0');
            return year + '-' + month + '-' + day;
        };
        
        return {
            startDate: formatDate(fyStart),
            endDate: formatDate(today)
        };
    }
    
    // ==========================================
    // PERIOD COMPARISON - Current vs Prior vs 2 Back with Projections
    // ==========================================
    function calculatePeriodComparison(startDate, endDate, subsidiaryId, accountVelocity) {
        // Calculate period length in days
        var start = new Date(startDate);
        var end = new Date(endDate);
        var periodDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
        
        // Calculate prior periods
        var priorStart = new Date(start.getTime() - periodDays * 24 * 60 * 60 * 1000);
        var priorEnd = new Date(end.getTime() - periodDays * 24 * 60 * 60 * 1000);
        var twoBackStart = new Date(priorStart.getTime() - periodDays * 24 * 60 * 60 * 1000);
        var twoBackEnd = new Date(priorEnd.getTime() - periodDays * 24 * 60 * 60 * 1000);
        
        var formatDate = function(d) { return d.toISOString().split('T')[0]; };
        
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        // Query for all three periods - VendCred properly netted against spend
        // Filter to expense-type accounts only (consistent with getMonthlyAccountSpend)
        var sql = "SELECT " +
            "TL.expenseaccount AS account_id, " +
            "BUILTIN.DF(TL.expenseaccount) AS account_name, " +
            "SUM(CASE WHEN T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') AND T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - " +
            "SUM(CASE WHEN T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') AND T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END) AS current_amount, " +
            "SUM(CASE WHEN T.trandate >= TO_DATE('" + formatDate(priorStart) + "', 'YYYY-MM-DD') AND T.trandate < TO_DATE('" + startDate + "', 'YYYY-MM-DD') AND T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - " +
            "SUM(CASE WHEN T.trandate >= TO_DATE('" + formatDate(priorStart) + "', 'YYYY-MM-DD') AND T.trandate < TO_DATE('" + startDate + "', 'YYYY-MM-DD') AND T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END) AS prior_amount, " +
            "SUM(CASE WHEN T.trandate >= TO_DATE('" + formatDate(twoBackStart) + "', 'YYYY-MM-DD') AND T.trandate < TO_DATE('" + formatDate(priorStart) + "', 'YYYY-MM-DD') AND T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - " +
            "SUM(CASE WHEN T.trandate >= TO_DATE('" + formatDate(twoBackStart) + "', 'YYYY-MM-DD') AND T.trandate < TO_DATE('" + formatDate(priorStart) + "', 'YYYY-MM-DD') AND T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END) AS two_back_amount " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "INNER JOIN Account A ON A.id = TL.expenseaccount " +
            "WHERE T.type IN ('VendBill', 'ExpRept', 'Check', 'VendCred') AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + formatDate(twoBackStart) + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' AND TL.expenseaccount IS NOT NULL " +
            "AND A.accttype IN ('Expense', 'OthExpense', 'COGS') " +
            subFilter +
            " GROUP BY TL.expenseaccount, BUILTIN.DF(TL.expenseaccount) " +
            "HAVING (SUM(CASE WHEN T.type IN ('VendBill', 'ExpRept', 'Check') THEN ABS(TL.netamount) ELSE 0 END) - SUM(CASE WHEN T.type = 'VendCred' THEN ABS(TL.netamount) ELSE 0 END)) > 0";
        
        var rows = safeQuery(sql, 'periodComparison');
        if (isQueryError(rows)) return { summary: {}, accounts: [] };
        
        var accounts = [];
        var currentTotal = 0, priorTotal = 0, twoBackTotal = 0;
        
        rows.forEach(function(r) {
            var current = parseFloat(r.current_amount) || 0;
            var prior = parseFloat(r.prior_amount) || 0;
            var twoBack = parseFloat(r.two_back_amount) || 0;
            var changePct = prior > 0 ? ((current - prior) / prior) * 100 : (current > 0 ? 100 : 0);
            
            // Find velocity info from accountVelocity
            var velInfo = accountVelocity.find(function(a) { return a.accountId == r.account_id; }) || {};
            
            // Project next period based on trend
            var avgChange = 0;
            if (prior > 0 && twoBack > 0) {
                avgChange = ((current / prior) + (prior / twoBack)) / 2 - 1;
            } else if (prior > 0) {
                avgChange = (current / prior) - 1;
            }
            var projected = current * (1 + Math.min(Math.max(avgChange, -0.5), 0.5));
            
            accounts.push({
                accountId: r.account_id,
                accountName: r.account_name || 'Account ' + r.account_id,
                currentAmount: current,
                priorAmount: prior,
                twoBackAmount: twoBack,
                changePct: Math.round(changePct * 10) / 10,
                projectedAmount: Math.round(projected),
                isNew: prior === 0 && current > 0,
                monthlyTrend: velInfo.monthlyAmounts || []
            });
            
            currentTotal += current;
            priorTotal += prior;
            twoBackTotal += twoBack;
        });
        
        accounts.sort(function(a, b) { return Math.abs(b.changePct) - Math.abs(a.changePct); });
        
        var overallChange = priorTotal > 0 ? ((currentTotal - priorTotal) / priorTotal) * 100 : 0;
        var projectedTotal = currentTotal * (1 + Math.min(Math.max(overallChange / 100, -0.3), 0.3));
        
        return {
            summary: {
                currentTotal: Math.round(currentTotal),
                priorTotal: Math.round(priorTotal),
                twoBackTotal: Math.round(twoBackTotal),
                projectedTotal: Math.round(projectedTotal),
                changePct: Math.round(overallChange * 10) / 10,
                currentPeriodLabel: startDate + ' to ' + endDate,
                priorPeriodLabel: formatDate(priorStart) + ' to ' + formatDate(priorEnd),
                twoBackLabel: formatDate(twoBackStart) + ' to ' + formatDate(twoBackEnd)
            },
            accounts: accounts
        };
    }
    
    // ==========================================
    // TRANSACTION DETAILS - For drill-down
    // ==========================================
    function getTransactionDetails(startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        // Filter to expense-type accounts only (consistent with getMonthlyAccountSpend)
        var sql = "SELECT " +
            "T.id, T.tranid, T.type, " +
            "TO_CHAR(T.trandate, 'YYYY-MM-DD') AS date, " +
            "TL.expenseaccount AS account_id, " +
            "BUILTIN.DF(TL.expenseaccount) AS account_name, " +
            "T.entity AS entity_id, " +
            "BUILTIN.DF(T.entity) AS entity_name, " +
            "ABS(TL.netamount) AS amount, " +
            "TL.memo " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "INNER JOIN Account A ON A.id = TL.expenseaccount " +
            "WHERE T.type IN ('VendBill', 'ExpRept', 'Check') AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' AND TL.expenseaccount IS NOT NULL " +
            "AND TL.netamount <> 0 " +
            "AND A.accttype IN ('Expense', 'OthExpense', 'COGS') " +
            subFilter +
            " ORDER BY T.trandate DESC " +
            "FETCH FIRST 2000 ROWS ONLY";
        
        var rows = safeQuery(sql, 'transactionDetails');
        if (isQueryError(rows)) return [];
        
        return rows.map(function(r) {
            return {
                id: r.id,
                tranId: r.tranid,
                type: r.type,
                date: r.date,
                accountId: r.account_id,
                accountName: r.account_name || 'Account ' + r.account_id,
                entityId: r.entity_id,
                entityName: r.entity_name || '',
                amount: parseFloat(r.amount) || 0,
                memo: r.memo || ''
            };
        });
    }
    
    // ==========================================
    // EXPENSE ANALYSIS - Top Spenders and Categories
    // ==========================================
    function analyzeExpenseReports(startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        // Calculate prior period
        var start = new Date(startDate);
        var end = new Date(endDate);
        var periodDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
        var priorStart = new Date(start.getTime() - periodDays * 24 * 60 * 60 * 1000);
        var formatDate = function(d) { return d.toISOString().split('T')[0]; };
        
        // Top Spenders (employees)
        var spenderSql = "SELECT " +
            "T.entity AS employee_id, " +
            "BUILTIN.DF(T.entity) AS employee_name, " +
            "SUM(CASE WHEN T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') THEN ABS(TL.netamount) ELSE 0 END) AS current_spend, " +
            "SUM(CASE WHEN T.trandate < TO_DATE('" + startDate + "', 'YYYY-MM-DD') THEN ABS(TL.netamount) ELSE 0 END) AS prior_spend, " +
            "COUNT(DISTINCT CASE WHEN T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') THEN T.id END) AS report_count " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type = 'ExpRept' AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + formatDate(priorStart) + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            subFilter +
            " GROUP BY T.entity, BUILTIN.DF(T.entity) " +
            "HAVING SUM(ABS(TL.netamount)) > 0 " +
            "ORDER BY SUM(CASE WHEN T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') THEN ABS(TL.netamount) ELSE 0 END) DESC " +
            "FETCH FIRST 50 ROWS ONLY";
        
        var spenderRows = safeQuery(spenderSql, 'topSpenders');
        var topSpenders = [];
        var expenseTotal = 0;
        
        if (!isQueryError(spenderRows)) {
            spenderRows.forEach(function(r) {
                var current = parseFloat(r.current_spend) || 0;
                var prior = parseFloat(r.prior_spend) || 0;
                var changePct = prior > 0 ? ((current - prior) / prior) * 100 : 0;
                expenseTotal += current;
                topSpenders.push({
                    employeeId: r.employee_id,
                    employeeName: r.employee_name || 'Employee ' + r.employee_id,
                    totalSpend: current,
                    priorSpend: prior,
                    reportCount: parseInt(r.report_count) || 0,
                    changePct: Math.round(changePct * 10) / 10
                });
            });
        }
        
        // Categories with changes
        // For expense reports: use expense category (expcat)
        // For vendor bills: use expense account
        // Query expense report categories separately for accuracy
        var expCategorySql = "SELECT " +
            "TL.category AS category_id, " +
            "BUILTIN.DF(TL.category) AS category_name, " +
            "SUM(CASE WHEN T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') THEN ABS(TL.netamount) ELSE 0 END) AS current_amount, " +
            "SUM(CASE WHEN T.trandate < TO_DATE('" + startDate + "', 'YYYY-MM-DD') THEN ABS(TL.netamount) ELSE 0 END) AS prior_amount " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type = 'ExpRept' AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + formatDate(priorStart) + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            "AND TL.category IS NOT NULL " +
            subFilter +
            " GROUP BY TL.category, BUILTIN.DF(TL.category) " +
            "ORDER BY SUM(CASE WHEN T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') THEN ABS(TL.netamount) ELSE 0 END) DESC " +
            "FETCH FIRST 50 ROWS ONLY";
        
        var categoryRows = safeQuery(expCategorySql, 'expenseCategories');
        var categories = [];
        var categoryIncreaseTotal = 0;
        var vendorBillTotal = 0;
        
        // If expense categories query fails or returns empty, fall back to expense accounts
        var isExpenseAccount = false;
        if (isQueryError(categoryRows) || categoryRows.length === 0) {
            isExpenseAccount = true;
            // Fallback: use expense accounts for both transaction types
            var accountSql = "SELECT " +
                "TL.expenseaccount AS category_id, " +
                "BUILTIN.DF(TL.expenseaccount) AS category_name, " +
                "SUM(CASE WHEN T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') THEN ABS(TL.netamount) ELSE 0 END) AS current_amount, " +
                "SUM(CASE WHEN T.trandate < TO_DATE('" + startDate + "', 'YYYY-MM-DD') THEN ABS(TL.netamount) ELSE 0 END) AS prior_amount " +
                "FROM TransactionLine TL " +
                "INNER JOIN Transaction T ON TL.transaction = T.id " +
                "WHERE T.type IN ('ExpRept', 'VendBill') AND T.voided = 'F' " +
                "AND T.trandate >= TO_DATE('" + formatDate(priorStart) + "', 'YYYY-MM-DD') " +
                "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
                "AND TL.mainline = 'F' " +
                "AND TL.expenseaccount IS NOT NULL " +
                subFilter +
                " GROUP BY TL.expenseaccount, BUILTIN.DF(TL.expenseaccount) " +
                "ORDER BY SUM(CASE WHEN T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') THEN ABS(TL.netamount) ELSE 0 END) DESC " +
                "FETCH FIRST 50 ROWS ONLY";
            categoryRows = safeQuery(accountSql, 'expenseAccounts');
        }
        
        if (!isQueryError(categoryRows)) {
            categoryRows.forEach(function(r) {
                var current = parseFloat(r.current_amount) || 0;
                var prior = parseFloat(r.prior_amount) || 0;
                var changePct = prior > 0 ? ((current - prior) / prior) * 100 : 0;
                if (changePct > 10) categoryIncreaseTotal += current - prior;
                categories.push({
                    categoryId: r.category_id,
                    categoryName: r.category_name || 'Category ' + r.category_id,
                    currentAmount: current,
                    priorAmount: prior,
                    changePct: Math.round(changePct * 10) / 10,
                    isExpenseAccount: isExpenseAccount
                });
            });
        }
        
        // Monthly trends
        var trendSql = "SELECT " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "SUM(CASE WHEN T.type = 'ExpRept' THEN ABS(TL.netamount) ELSE 0 END) AS expense_amount, " +
            "SUM(CASE WHEN T.type = 'VendBill' THEN ABS(TL.netamount) ELSE 0 END) AS bill_amount " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type IN ('ExpRept', 'VendBill') AND T.voided = 'F' " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            subFilter +
            " GROUP BY TO_CHAR(T.trandate, 'YYYY-MM') ORDER BY month";
        
        var trendRows = safeQuery(trendSql, 'expenseTrends');
        var monthlyTrends = [];
        
        if (!isQueryError(trendRows)) {
            trendRows.forEach(function(r) {
                var expAmt = parseFloat(r.expense_amount) || 0;
                var billAmt = parseFloat(r.bill_amount) || 0;
                vendorBillTotal += billAmt;
                monthlyTrends.push({
                    month: r.month,
                    expenseAmount: expAmt,
                    billAmount: billAmt
                });
            });
        }
        
        return {
            summary: {
                expenseReportTotal: Math.round(expenseTotal),
                vendorBillTotal: Math.round(vendorBillTotal),
                topSpenderCount: topSpenders.filter(function(s) { return s.changePct > 20; }).length,
                categoryIncreaseTotal: Math.round(categoryIncreaseTotal)
            },
            topSpenders: topSpenders,
            categories: categories,
            monthlyTrends: monthlyTrends
        };
    }
    
    // ==========================================
    // ALL ACCOUNTS DEEP - Full metrics for deep analysis
    // ==========================================
    function buildAllAccountsDeep(accountSpend, accountVelocity, startDate, endDate) {
        // Calculate period info
        var start = new Date(startDate);
        var end = new Date(endDate);
        var periodDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
        var periodMonths = Math.max(1, Math.round(periodDays / 30));
        
        // Build map of all account data from velocity results
        var accounts = accountVelocity.map(function(a) {
            // Calculate period amounts
            var monthlyAmounts = a.monthlyAmounts || [];
            var recentMonths = monthlyAmounts.slice(-periodMonths);
            var priorMonths = monthlyAmounts.slice(-periodMonths * 2, -periodMonths);
            var twoBackMonths = monthlyAmounts.slice(-periodMonths * 3, -periodMonths * 2);
            
            var sumArray = function(arr) { return arr.reduce(function(s, v) { return s + v; }, 0); };
            
            var currentPeriod = sumArray(recentMonths);
            var priorPeriod = sumArray(priorMonths);
            var twoBackPeriod = sumArray(twoBackMonths);
            
            return {
                accountId: a.accountId,
                accountName: a.accountName,
                accountNumber: a.accountNumber || '',
                accountType: a.accountType || 'Expense',
                totalSpend: a.totalSpend,
                transactionCount: a.transactionCount,
                billsAmount: a.billsAmount || 0,
                expenseAmount: a.expenseAmount || 0,
                velocity: a.velocity,
                acceleration: a.acceleration || 0,
                trend: a.trend,
                currentPeriod: currentPeriod,
                priorPeriod: priorPeriod,
                twoBackPeriod: twoBackPeriod,
                monthlyTrend: monthlyAmounts
            };
        });
        
        // Sort by total spend
        accounts.sort(function(a, b) { return b.totalSpend - a.totalSpend; });
        
        return accounts;
    }
    
    // ==========================================
    // GET CONFIG
    // ==========================================
    function getConfig() {
        var fiscalDates = getFiscalYearDates();
        return {
            subsidiaries: Core.getSubsidiaries(),
            defaults: getDefaultConfig(),
            fiscalYear: fiscalDates
        };
    }
    
    // ==========================================
    // GET ACCOUNT TRANSACTIONS (On-demand for drill-down)
    // Fetches ALL transactions for a specific account without the 500 limit
    // Handles credit card accounts correctly (excludes Check payments)
    // ==========================================
    function getAccountTransactions(accountId, startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        // First, check if this is a credit card account
        var acctTypeSql = "SELECT accttype FROM Account WHERE id = " + parseInt(accountId);
        var acctTypeResult = safeQuery(acctTypeSql, 'accountType');
        var isCreditCard = !isQueryError(acctTypeResult) && acctTypeResult.length > 0 && 
                          acctTypeResult[0].accttype === 'CCard';
        
        // For credit card accounts: exclude Check transactions (those are payments, not expenses)
        // Only include ExpRept and VendBill which add to the credit card balance
        var typeFilter = isCreditCard 
            ? "T.type IN ('VendBill', 'ExpRept')" 
            : "T.type IN ('VendBill', 'ExpRept', 'Check')";
        
        var sql = "SELECT " +
            "T.id, T.tranid, T.type, " +
            "TO_CHAR(T.trandate, 'YYYY-MM-DD') AS date, " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "TL.expenseaccount AS account_id, " +
            "BUILTIN.DF(TL.expenseaccount) AS account_name, " +
            "T.entity AS entity_id, " +
            "BUILTIN.DF(T.entity) AS entity_name, " +
            "ABS(TL.netamount) AS amount, " +
            "TL.memo AS line_memo, " +
            "T.memo AS header_memo " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE " + typeFilter + " AND T.voided = 'F' " +
            "AND TL.expenseaccount = " + parseInt(accountId) + " " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            "AND TL.netamount <> 0 " +
            subFilter +
            " ORDER BY T.trandate DESC " +
            "FETCH FIRST 2000 ROWS ONLY";
        
        var rows = safeQuery(sql, 'accountTransactions');
        if (isQueryError(rows)) return [];
        
        return rows.map(function(r) {
            return {
                id: r.id,
                tranId: r.tranid,
                type: r.type,
                date: r.date,
                month: r.month,
                accountId: r.account_id,
                accountName: r.account_name || 'Account ' + r.account_id,
                entityId: r.entity_id,
                entityName: r.entity_name || '',
                amount: parseFloat(r.amount) || 0,
                memo: r.line_memo || r.header_memo || ''
            };
        });
    }
    
    // ==========================================
    // GET EMPLOYEE EXPENSES (On-demand for drill-down)
    // Fetches ALL expense reports for a specific employee
    // ==========================================
    function getEmployeeExpenses(employeeId, startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        var sql = "SELECT " +
            "T.id, T.tranid, T.type, " +
            "TO_CHAR(T.trandate, 'YYYY-MM-DD') AS date, " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "TL.expenseaccount AS account_id, " +
            "BUILTIN.DF(TL.expenseaccount) AS account_name, " +
            "T.entity AS entity_id, " +
            "BUILTIN.DF(T.entity) AS entity_name, " +
            "ABS(TL.netamount) AS amount, " +
            "TL.memo AS line_memo, " +
            "T.memo AS header_memo " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type = 'ExpRept' AND T.voided = 'F' " +
            "AND T.entity = " + parseInt(employeeId) + " " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            "AND TL.netamount <> 0 " +
            subFilter +
            " ORDER BY T.trandate DESC " +
            "FETCH FIRST 2000 ROWS ONLY";
        
        var rows = safeQuery(sql, 'employeeExpenses');
        if (isQueryError(rows)) return [];
        
        return rows.map(function(r) {
            return {
                id: r.id,
                tranId: r.tranid,
                type: r.type,
                date: r.date,
                month: r.month,
                accountId: r.account_id,
                accountName: r.account_name || '',
                entityId: r.entity_id,
                entityName: r.entity_name || '',
                amount: parseFloat(r.amount) || 0,
                memo: r.line_memo || r.header_memo || ''
            };
        });
    }
    
    // ==========================================
    // GET VENDOR TRANSACTIONS (On-demand for drill-down)
    // ==========================================
    function getVendorTransactions(vendorId, startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        var sql = "SELECT " +
            "T.id, T.tranid, T.type, " +
            "TO_CHAR(T.trandate, 'YYYY-MM-DD') AS date, " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "TL.expenseaccount AS account_id, " +
            "BUILTIN.DF(TL.expenseaccount) AS account_name, " +
            "T.entity AS entity_id, " +
            "BUILTIN.DF(T.entity) AS entity_name, " +
            "ABS(TL.netamount) AS amount, " +
            "TL.memo AS line_memo, " +
            "T.memo AS header_memo " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type IN ('VendBill', 'ExpRept', 'Check') AND T.voided = 'F' " +
            "AND T.entity = " + parseInt(vendorId) + " " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            "AND TL.netamount <> 0 " +
            subFilter +
            " ORDER BY T.trandate DESC " +
            "FETCH FIRST 2000 ROWS ONLY";
        
        var rows = safeQuery(sql, 'vendorTransactions');
        if (isQueryError(rows)) return [];
        
        return rows.map(function(r) {
            return {
                id: r.id,
                tranId: r.tranid,
                type: r.type,
                date: r.date,
                month: r.month,
                accountId: r.account_id,
                accountName: r.account_name || '',
                entityId: r.entity_id,
                entityName: r.entity_name || '',
                amount: parseFloat(r.amount) || 0,
                memo: r.line_memo || r.header_memo || ''
            };
        });
    }
    
    // ==========================================
    // HANDLE REQUEST (Router delegate for sub-actions)
    // ==========================================
    function handleRequest(params) {
        var subAction = params.subAction || '';
        
        switch (subAction) {
            case 'account_transactions':
                return {
                    status: 'success',
                    transactions: getAccountTransactions(
                        params.accountId,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
                
            case 'employee_expenses':
                return {
                    status: 'success',
                    transactions: getEmployeeExpenses(
                        params.employeeId,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
                
            case 'vendor_transactions':
                return {
                    status: 'success',
                    transactions: getVendorTransactions(
                        params.vendorId,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
            
            case 'category_transactions':
                return {
                    status: 'success',
                    transactions: getCategoryTransactions(
                        params.categoryId,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
                
            default:
                return { status: 'error', message: 'Unknown subAction: ' + subAction };
        }
    }
    
    // ==========================================
    // GET CATEGORY TRANSACTIONS (On-demand for drill-down)
    // Fetches expense reports by category
    // ==========================================
    function getCategoryTransactions(categoryId, startDate, endDate, subsidiaryId) {
        var subFilter = Core.buildSubsidiaryFilter(subsidiaryId, 'T');
        
        var sql = "SELECT " +
            "T.id, T.tranid, T.type, " +
            "TO_CHAR(T.trandate, 'YYYY-MM-DD') AS date, " +
            "TO_CHAR(T.trandate, 'YYYY-MM') AS month, " +
            "TL.category AS category_id, " +
            "BUILTIN.DF(TL.category) AS category_name, " +
            "T.entity AS entity_id, " +
            "BUILTIN.DF(T.entity) AS entity_name, " +
            "ABS(TL.netamount) AS amount, " +
            "TL.memo AS line_memo, " +
            "T.memo AS header_memo " +
            "FROM TransactionLine TL " +
            "INNER JOIN Transaction T ON TL.transaction = T.id " +
            "WHERE T.type = 'ExpRept' AND T.voided = 'F' " +
            "AND TL.category = " + parseInt(categoryId) + " " +
            "AND T.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
            "AND T.trandate <= TO_DATE('" + endDate + "', 'YYYY-MM-DD') " +
            "AND TL.mainline = 'F' " +
            "AND TL.netamount <> 0 " +
            subFilter +
            " ORDER BY T.trandate DESC " +
            "FETCH FIRST 2000 ROWS ONLY";
        
        var rows = safeQuery(sql, 'categoryTransactions');
        if (isQueryError(rows)) return [];
        
        return rows.map(function(r) {
            return {
                id: r.id,
                tranId: r.tranid,
                type: r.type,
                date: r.date,
                month: r.month,
                categoryId: r.category_id,
                categoryName: r.category_name || '',
                entityId: r.entity_id,
                entityName: r.entity_name || '',
                amount: parseFloat(r.amount) || 0,
                memo: r.line_memo || r.header_memo || ''
            };
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SCORE-ONLY FUNCTION - Lightweight score computation for dashboard overview
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get spend velocity score only - minimal queries for fast app load
     * Score starts at 100, deducts for: high velocity accounts, anomalies, acceleration
     * @returns {Object} { score: 0-100, grade: 'A'-'F', label: string, trend: string }
     */
    function getScoreOnly() {
        try {
            var score = 100;
            var deductions = { velocity: 0, anomalies: 0, acceleration: 0 };

            // Get last 6 months of expense data aggregated
            var today = new Date();
            var endDate = new Date(today.getFullYear(), today.getMonth(), 0); // End of last month
            var startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 5, 1); // 6 months back
            var start = formatDateYMD(startDate);
            var end = formatDateYMD(endDate);

            var accountsWithHighVelocity = 0;
            var acceleratingAccounts = 0;
            var totalAccounts = 0;

            // Single query: Get expense growth metrics by account
            try {
                var sql = "SELECT " +
                    "a.id as account_id, " +
                    "SUM(CASE WHEN t.trandate >= ADD_MONTHS(TRUNC(SYSDATE), -3) THEN ABS(tl.amount) ELSE 0 END) as recent_spend, " +
                    "SUM(CASE WHEN t.trandate < ADD_MONTHS(TRUNC(SYSDATE), -3) THEN ABS(tl.amount) ELSE 0 END) as prior_spend " +
                    "FROM transactionline tl " +
                    "JOIN transaction t ON t.id = tl.transaction " +
                    "JOIN account a ON a.id = tl.account " +
                    "WHERE a.accttype IN ('Expense', 'OthExpense') " +
                    "AND t.trandate BETWEEN TO_DATE('" + start + "', 'YYYY-MM-DD') AND TO_DATE('" + end + "', 'YYYY-MM-DD') " +
                    "AND t.posting = 'T' AND tl.mainline = 'F' " +
                    "GROUP BY a.id " +
                    "HAVING SUM(ABS(tl.amount)) > 1000";
                var results = safeQuery(sql, 'scoreVelocity');

                if (!isQueryError(results)) {
                    totalAccounts = results.length;
                    results.forEach(function(r) {
                        var recent = parseFloat(r.recent_spend) || 0;
                        var prior = parseFloat(r.prior_spend) || 0;
                        if (prior > 0) {
                            var growth = ((recent - prior) / prior) * 100;
                            if (growth > 15) accountsWithHighVelocity++;
                            if (growth > 25) acceleratingAccounts++;
                        }
                    });
                }
            } catch (e) { log.debug('Velocity Query', e.message); }

            // Velocity deductions (max -30)
            if (accountsWithHighVelocity > 10) deductions.velocity = 30;
            else if (accountsWithHighVelocity > 7) deductions.velocity = 20;
            else if (accountsWithHighVelocity > 4) deductions.velocity = 12;
            else if (accountsWithHighVelocity > 2) deductions.velocity = 6;

            // Acceleration deductions (max -25)
            if (acceleratingAccounts > 5) deductions.acceleration = 25;
            else if (acceleratingAccounts > 3) deductions.acceleration = 15;
            else if (acceleratingAccounts > 1) deductions.acceleration = 8;

            score = Math.max(0, 100 - deductions.velocity - deductions.acceleration - deductions.anomalies);

            var grade = 'A';
            var label = 'Controlled';
            if (score < 50) { grade = 'F'; label = 'Critical'; }
            else if (score < 60) { grade = 'D'; label = 'High Risk'; }
            else if (score < 70) { grade = 'C'; label = 'Elevated'; }
            else if (score < 80) { grade = 'B'; label = 'Moderate'; }
            else if (score < 90) { grade = 'A'; label = 'Controlled'; }
            else { grade = 'A+'; label = 'Excellent'; }

            var trend = 'stable';
            if (acceleratingAccounts > 3) trend = 'down';
            else if (accountsWithHighVelocity === 0) trend = 'up';

            return {
                score: Math.round(score),
                grade: grade,
                label: label,
                trend: trend,
                details: {
                    totalAccounts: totalAccounts,
                    highVelocityCount: accountsWithHighVelocity,
                    acceleratingCount: acceleratingAccounts,
                    deductions: deductions
                }
            };
        } catch (e) {
            log.error('SpendVelocity getScoreOnly Error', e.message);
            return { score: 80, grade: 'A', label: 'Unknown', trend: 'stable', error: e.message };
        }
    }

    // ==========================================
    // ADVISOR API - getData wrapper
    // ==========================================
    /**
     * getData - Adapter for Advisor tools
     * Converts advisor-style args (period string) to analyze-style params (startDate/endDate)
     *
     * @param {Object} args - Advisor tool arguments
     * @param {string} [args.period] - 'last_6_months', 'last_12_months', 'ytd'
     * @param {number} [args.vendor_id] - Optional filter to specific vendor
     * @param {number} [args.subsidiary] - Optional subsidiary filter
     * @returns {Object} Analysis results from analyzeSpendVelocity
     */
    function getData(args) {
        var params = {};
        var today = new Date();

        // Convert period string to startDate/endDate
        switch (args.period) {
            case 'last_6_months':
                var sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate());
                params.startDate = sixMonthsAgo.toISOString().split('T')[0];
                params.endDate = today.toISOString().split('T')[0];
                break;
            case 'last_12_months':
                params.startDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString().split('T')[0];
                params.endDate = today.toISOString().split('T')[0];
                break;
            case 'ytd':
            default:
                // YTD: January 1 of current year to today
                params.startDate = new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
                params.endDate = today.toISOString().split('T')[0];
                break;
        }

        // Pass through optional filters
        if (args.subsidiary) {
            params.subsidiaryId = args.subsidiary;
        }
        if (args.vendor_id) {
            params.vendorId = args.vendor_id;
        }
        if (args.config) {
            params.config = args.config;
        }

        // Call the existing analyze function
        var result = analyzeSpendVelocity(params);
        return result.results;
    }

    // ==========================================
    // PUBLIC API
    // ==========================================
    return {
        getData: getData,
        analyze: analyzeSpendVelocity,
        analyzeSpendVelocity: analyzeSpendVelocity,
        getConfig: getConfig,
        getFiscalYearDates: getFiscalYearDates,
        getVelocityDrivers: getVelocityDrivers,
        // On-demand transaction fetching for drill-downs
        getAccountTransactions: getAccountTransactions,
        getEmployeeExpenses: getEmployeeExpenses,
        getVendorTransactions: getVendorTransactions,
        getCategoryTransactions: getCategoryTransactions,
        // Router delegate
        handleRequest: handleRequest,
        getScoreOnly: getScoreOnly
    };
});