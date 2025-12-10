/**
 * @NApiVersion 2.1
 * Lib_Health_Data.js
 * PROFITABILITY PULSE 2.0 - World-Class Financial Health Analytics
 * 
 * Features:
 * - Margin waterfall with drill-down
 * - Multi-segment profitability (dept, class, location)
 * - Revenue/expense forecasting with confidence bands
 * - Budget vs actual variance analysis
 * - Anomaly detection (Z-score)
 * - Operating metrics and benchmarks
 * - Transaction-level drill-downs
 */
define(["N/search", "N/query", "N/log", "./Lib_Shared", "./Lib_Config"], function (search, query, log, Shared, ConfigLib) {

    // Timezone-safe date parsing (avoids UTC offset issues with date strings like "2025-01-15")
    function parseLocalDate(dateStr) {
        if (!dateStr) return new Date();
        if (dateStr instanceof Date) return dateStr;
        const parts = String(dateStr).split('-');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN DATA FUNCTION
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getData(context) {
        try {
            const today = new Date();
            
            // Load configuration
            const config = ConfigLib.getStoredConfiguration('health');
            const fiscalCalendar = ConfigLib.getFiscalCalendar();
            const fiscalYearStartMonth = fiscalCalendar.fiscalYearStartMonth;

            // 1. Resolve Dates (using timezone-safe parsing)
            let rangeEnd, rangeStart;
            
            if (context.endDate) {
                rangeEnd = parseLocalDate(context.endDate);
            } else {
                const sixWeeksAgo = new Date(today);
                sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
                rangeEnd = new Date(sixWeeksAgo.getFullYear(), sixWeeksAgo.getMonth(), 0);
            }

            if (context.startDate) {
                rangeStart = parseLocalDate(context.startDate);
            } else {
                const fyYear = rangeEnd.getMonth() < fiscalYearStartMonth ? rangeEnd.getFullYear() - 1 : rangeEnd.getFullYear();
                rangeStart = new Date(fyYear, fiscalYearStartMonth, 1);
            }

            // Fiscal Context
            const fyYear = rangeEnd.getMonth() < fiscalYearStartMonth ? rangeEnd.getFullYear() - 1 : rangeEnd.getFullYear();
            const fyStart = new Date(fyYear, fiscalYearStartMonth, 1);
            const fyEnd = new Date(fyStart);
            fyEnd.setFullYear(fyEnd.getFullYear() + 1);
            fyEnd.setDate(fyEnd.getDate() - 1);

            // Date Calculations
            const msPerDay = 1000 * 60 * 60 * 24;
            const fyDays = Math.ceil((fyEnd - fyStart) / msPerDay);
            const fyDaysElapsed = Math.ceil((rangeEnd - fyStart) / msPerDay);
            const daysInRange = Math.max(1, Math.ceil((rangeEnd - rangeStart) / msPerDay));
            const monthsInRange = (rangeEnd.getFullYear() - rangeStart.getFullYear()) * 12 + (rangeEnd.getMonth() - rangeStart.getMonth()) + 1;
            const percentFY = Math.min(100, Math.max(0, (fyDaysElapsed / fyDays) * 100));

            // Period Definitions
            const currentMonthStart = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
            const currentMonthEnd = new Date(rangeEnd);

            const prevMonthEnd = new Date(currentMonthStart);
            prevMonthEnd.setDate(prevMonthEnd.getDate() - 1);
            const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1);

            const priorYearStart = new Date(rangeStart);
            priorYearStart.setFullYear(priorYearStart.getFullYear() - 1);
            const priorYearEnd = new Date(rangeEnd);
            priorYearEnd.setFullYear(priorYearEnd.getFullYear() - 1);

            const periods = {
                range: { start: Shared.formatDateYMD(rangeStart), end: Shared.formatDateYMD(rangeEnd) },
                currentMonth: { start: Shared.formatDateYMD(currentMonthStart), end: Shared.formatDateYMD(currentMonthEnd) },
                previousMonth: { start: Shared.formatDateYMD(prevMonthStart), end: Shared.formatDateYMD(prevMonthEnd) },
                priorYearRange: { start: Shared.formatDateYMD(priorYearStart), end: Shared.formatDateYMD(priorYearEnd) }
            };

            // 2. Fetch Data
            const rawByPeriod = {};
            let allAccountIds = new Set();

            Object.keys(periods).forEach(key => {
                const rows = fetchPLRange(periods[key].start, periods[key].end, context.subsidiary);
                rawByPeriod[key] = rows;
                rows.forEach(r => allAccountIds.add(r.account));
            });

            // 3. Metadata
            const accountMap = getAccountMetadata(Array.from(allAccountIds));
            const departments = getDepartments(config.hiddenDepartments || []);

            // 4. Company Metrics
            const companyMetrics = {};
            Object.keys(periods).forEach(key => {
                companyMetrics[key] = aggregatePLForScope(rawByPeriod[key], accountMap, null);
            });

            const compRange = companyMetrics.range;
            const avgMonthlyRev = compRange.revenue / monthsInRange;
            const avgMonthlyOpex = compRange.opex / monthsInRange;

            const compTargetGM = chooseTargetGMPct(
                companyMetrics.previousMonth.gmPct,
                companyMetrics.currentMonth.gmPct,
                compRange.gmPct,
                config
            );

            const compBreakeven = compTargetGM > 0 ? (avgMonthlyOpex / compTargetGM) : null;
            const compRunRate = compRange.revenue * (fyDays / daysInRange);
            
            const compPriorRev = companyMetrics.priorYearRange.revenue;
            const compYoyRevPct = compPriorRev !== 0 ? (compRange.revenue - compPriorRev) / compPriorRev : null;

            const compHealthScore = computeHealthScore(avgMonthlyRev, compBreakeven, compRange.gmPct, compTargetGM);

            const companyAccountsCurrent = buildAccountBreakdown(rawByPeriod.range, accountMap, null);
            const companyAccountsPrior = buildAccountBreakdown(rawByPeriod.priorYearRange, accountMap, null);

            // 5. Department Metrics
            const deptPayload = departments.map(dept => {
                const metrics = {};
                Object.keys(periods).forEach(key => {
                    metrics[key] = aggregatePLForScope(rawByPeriod[key], accountMap, dept.id);
                });

                const rMet = metrics.range;
                const dAvgRev = rMet.revenue / monthsInRange;
                const dAvgOpex = rMet.opex / monthsInRange;
                const dTargetGM = chooseTargetGMPct(metrics.previousMonth.gmPct, metrics.currentMonth.gmPct, rMet.gmPct, config);
                const dBreakeven = dTargetGM > 0 ? (dAvgOpex / dTargetGM) : null;
                const dRunRate = rMet.revenue * (fyDays / daysInRange);
                
                const dPriorRev = metrics.priorYearRange.revenue;
                const dYoy = dPriorRev !== 0 ? (rMet.revenue - dPriorRev) / dPriorRev : null;
                
                const dScore = computeHealthScore(dAvgRev, dBreakeven, rMet.gmPct, dTargetGM);
                const narrative = buildDeptNarrative(dept.name, rMet, metrics.currentMonth, metrics.previousMonth, dAvgRev, dBreakeven, dTargetGM, dYoy, config);

                const dAcctsCurr = buildAccountBreakdown(rawByPeriod.range, accountMap, dept.id);
                const dAcctsPrior = buildAccountBreakdown(rawByPeriod.priorYearRange, accountMap, dept.id);

                return {
                    department: { netsuiteId: dept.id, name: dept.name },
                    metrics: metrics,
                    averages: { rangeAvgMonthlyRevenue: Shared.round2(dAvgRev), rangeAvgMonthlyOpEx: Shared.round2(dAvgOpex) },
                    breakeven: { targetGMPct: Shared.round2(dTargetGM), breakevenMonthlyRevenue: dBreakeven ? Shared.round2(dBreakeven) : null },
                    forecast: { runRateRevenueFy: Shared.round2(dRunRate) },
                    yoy: { revenueDeltaPct: dYoy ? Shared.round2(dYoy) : null },
                    healthScore: dScore,
                    analysis: narrative,
                    accounts: { current: dAcctsCurr, prior: dAcctsPrior }
                };
            });

            // 6. Company Narrative
            const compNarrative = buildCompanyNarrative(compRange, companyMetrics.currentMonth, companyMetrics.previousMonth, avgMonthlyRev, compBreakeven, compTargetGM, compYoyRevPct, config);

            // 7. Sparkline Data (last 6 months)
            const sparklineData = getSparklineData(rangeEnd, 6, context.subsidiary);

            // 8. Margin Waterfall
            const waterfall = buildMarginWaterfall(companyAccountsCurrent, compRange);

            // 9. Monthly Trend (for forecasting)
            const monthlyTrend = getMonthlyTrend(rangeEnd, 12, context.subsidiary);

            // 10. Anomaly Detection
            const anomalies = detectAnomalies(monthlyTrend, companyAccountsCurrent, config);

            // 11. Operating Metrics
            const operatingMetrics = calculateOperatingMetrics(compRange, companyMetrics, monthsInRange, context.subsidiary);

            // 12. Top Movers (Drivers)
            const topMovers = calculateTopMovers(companyAccountsCurrent, companyAccountsPrior);

            return {
                meta: {
                    fiscal: { 
                        start: Shared.formatDateYMD(fyStart), 
                        end: Shared.formatDateYMD(fyEnd), 
                        percentComplete: percentFY,
                        startMonth: fiscalYearStartMonth,
                        detectedFrom: fiscalCalendar.detectedFrom
                    },
                    range: { start: Shared.formatDateYMD(rangeStart), end: Shared.formatDateYMD(rangeEnd), monthsInRange: monthsInRange, daysInRange: daysInRange },
                    config: {
                        gmWarningThresholds: config.gmWarningThresholds,
                        opexToRevenueWarningThreshold: config.opexToRevenueWarningThreshold,
                        defaultTargetGM: config.defaultTargetGM
                    }
                },
                company: {
                    metrics: companyMetrics,
                    averages: { rangeAvgMonthlyRevenue: Shared.round2(avgMonthlyRev), rangeAvgMonthlyOpEx: Shared.round2(avgMonthlyOpex) },
                    breakeven: { targetGMPct: Shared.round2(compTargetGM), breakevenMonthlyRevenue: compBreakeven ? Shared.round2(compBreakeven) : null },
                    forecast: { runRateRevenueFy: Shared.round2(compRunRate) },
                    yoy: { revenueDeltaPct: compYoyRevPct ? Shared.round2(compYoyRevPct) : null },
                    healthScore: compHealthScore,
                    analysis: compNarrative,
                    accounts: { current: companyAccountsCurrent, prior: companyAccountsPrior }
                },
                departments: deptPayload,
                sparklineData: sparklineData,
                waterfall: waterfall,
                monthlyTrend: monthlyTrend,
                anomalies: anomalies,
                operatingMetrics: operatingMetrics,
                topMovers: topMovers
            };

        } catch (e) {
            log.error('Health Error', e);
            return { error: e.message };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HANDLE REQUEST (Sub-actions for drill-downs)
    // ═══════════════════════════════════════════════════════════════════════════
    
    function handleRequest(params) {
        const subAction = params.subAction || '';
        
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
                
            case 'department_pl':
                return {
                    status: 'success',
                    data: getDepartmentPL(
                        params.departmentId,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
                
            case 'segment_profitability':
                return {
                    status: 'success',
                    data: getSegmentProfitability(
                        params.segmentType,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
                
            case 'forecast':
                return {
                    status: 'success',
                    data: generateForecast(
                        params.endDate,
                        params.periodsForward || 6,
                        params.subsidiaryId
                    )
                };
                
            case 'budget_variance':
                return {
                    status: 'success',
                    data: getBudgetVariance(
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
                
            case 'scenario':
                return {
                    status: 'success',
                    data: calculateScenario(params)
                };
                
            case 'revenue_by_customer':
                return {
                    status: 'success',
                    data: getRevenueByCustomer(
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
            
            case 'account_by_vendor':
                return {
                    status: 'success',
                    data: getAccountByVendor(
                        params.accountId,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
            
            case 'account_by_employee':
                return {
                    status: 'success',
                    data: getAccountByEmployee(
                        params.accountId,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
            
            case 'account_monthly_trend':
                return {
                    status: 'success',
                    data: getAccountMonthlyTrend(
                        params.accountId,
                        params.months || 12,
                        params.subsidiaryId
                    )
                };
            
            case 'margin_bridge':
                return {
                    status: 'success',
                    data: getMarginBridge(
                        params.startDate,
                        params.endDate,
                        params.priorStartDate,
                        params.priorEndDate,
                        params.subsidiaryId
                    )
                };
            
            case 'account_anomalies':
                return {
                    status: 'success',
                    data: detectAccountLevelAnomalies(
                        params.months || 12,
                        params.subsidiaryId
                    )
                };
            
            case 'segment_comparison':
                return {
                    status: 'success',
                    data: getSegmentComparison(
                        params.segmentType,
                        params.segmentIds,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
            
            case 'price_volume_mix':
                return {
                    status: 'success',
                    data: getPriceVolumeMixAnalysis(
                        params.startDate,
                        params.endDate,
                        params.priorStartDate,
                        params.priorEndDate,
                        params.subsidiaryId
                    )
                };
            
            default:
                return { status: 'error', message: 'Unknown subAction: ' + subAction };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARGIN WATERFALL
    // ═══════════════════════════════════════════════════════════════════════════
    
    function buildMarginWaterfall(accounts, metrics) {
        const topCOGS = (accounts.cogsAccounts || []).slice(0, 5);
        const topOpex = (accounts.opexAccounts || []).slice(0, 8);
        
        const cogsTotal = topCOGS.reduce((sum, a) => sum + a.amount, 0);
        const opexTotal = topOpex.reduce((sum, a) => sum + a.amount, 0);
        const otherCogs = metrics.cogs - cogsTotal;
        const otherOpex = metrics.opex - opexTotal;
        
        const steps = [
            { label: 'Revenue', value: metrics.revenue, cumulative: metrics.revenue, type: 'total', accountType: 'Income' }
        ];
        
        // COGS breakdown
        topCOGS.forEach(a => {
            steps.push({ 
                label: truncateName(a.accountName, 20), 
                value: -a.amount, 
                type: 'decrease', 
                accountType: 'COGS',
                accountId: a.accountId,
                fullName: a.accountName
            });
        });
        
        if (otherCogs > 0) {
            steps.push({ label: 'Other COGS', value: -otherCogs, type: 'decrease', accountType: 'COGS' });
        }
        
        steps.push({ label: 'Gross Margin', value: metrics.gm, cumulative: metrics.gm, type: 'subtotal', percent: metrics.gmPct });
        
        // OpEx breakdown
        topOpex.forEach(a => {
            steps.push({ 
                label: truncateName(a.accountName, 20), 
                value: -a.amount, 
                type: 'decrease', 
                accountType: 'Expense',
                accountId: a.accountId,
                fullName: a.accountName
            });
        });
        
        if (otherOpex > 0) {
            steps.push({ label: 'Other OpEx', value: -otherOpex, type: 'decrease', accountType: 'Expense' });
        }
        
        steps.push({ 
            label: 'Operating Income', 
            value: metrics.opInc, 
            cumulative: metrics.opInc, 
            type: 'total',
            percent: metrics.revenue > 0 ? metrics.opInc / metrics.revenue : 0
        });
        
        // Calculate cumulative for relative items
        let running = metrics.revenue;
        steps.forEach((step, i) => {
            if (step.type !== 'total' && step.type !== 'subtotal') {
                running += step.value;
                step.cumulative = running;
            }
        });
        
        return {
            steps: steps,
            summary: {
                revenue: metrics.revenue,
                cogs: metrics.cogs,
                grossMargin: metrics.gm,
                grossMarginPct: metrics.gmPct,
                opex: metrics.opex,
                operatingIncome: metrics.opInc,
                operatingMarginPct: metrics.revenue > 0 ? metrics.opInc / metrics.revenue : 0
            }
        };
    }
    
    function truncateName(name, maxLen) {
        if (!name) return '';
        return name.length > maxLen ? name.substring(0, maxLen - 2) + '...' : name;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ACCOUNT TRANSACTIONS (Drill-down)
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getAccountTransactions(accountId, startDate, endDate, subsidiaryId) {
        const sql = `
            SELECT 
                t.id AS transaction_id,
                t.tranid AS tran_number,
                t.type AS tran_type,
                TO_CHAR(t.trandate, 'YYYY-MM-DD') AS tran_date,
                t.memo,
                tal.amount,
                tl.department,
                BUILTIN.DF(tl.department) AS dept_name,
                t.entity,
                BUILTIN.DF(t.entity) AS entity_name
            FROM 
                Transaction t
                JOIN TransactionAccountingLine tal ON t.id = tal.transaction
                JOIN TransactionLine tl ON t.id = tl.transaction AND tal.transactionline = tl.id
            WHERE 
                t.posting = 'T'
                AND tal.posting = 'T'
                AND tal.account = ${accountId}
                AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
            ORDER BY 
                t.trandate DESC, ABS(tal.amount) DESC
            FETCH FIRST 2000 ROWS ONLY
        `;
        
        const results = Shared.runSuiteQL(sql);
        
        return results.map(r => ({
            transactionId: r.transaction_id,
            tranNumber: r.tran_number,
            tranType: r.tran_type,
            date: r.tran_date,
            memo: r.memo || '',
            amount: parseFloat(r.amount) || 0,
            department: r.dept_name || '',
            entity: r.entity_name || ''
        }));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEGMENT PROFITABILITY
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getSegmentProfitability(segmentType, startDate, endDate, subsidiaryId) {
        // segmentType: 'department', 'class', 'location'
        let segmentField, segmentTable;
        
        switch (segmentType) {
            case 'class':
                segmentField = 'tl.class';
                segmentTable = 'Classification';
                break;
            case 'location':
                segmentField = 'tl.location';
                segmentTable = 'Location';
                break;
            default:
                segmentField = 'tl.department';
                segmentTable = 'Department';
        }
        
        const sql = `
            SELECT 
                ${segmentField} AS segment_id,
                BUILTIN.DF(${segmentField}) AS segment_name,
                a.accttype,
                SUM(tal.amount) AS amount
            FROM 
                Transaction t
                JOIN TransactionAccountingLine tal ON t.id = tal.transaction
                JOIN TransactionLine tl ON t.id = tl.transaction AND tal.transactionline = tl.id
                JOIN Account a ON tal.account = a.id
            WHERE 
                t.posting = 'T'
                AND tal.posting = 'T'
                AND a.accttype IN ('Income', 'OthIncome', 'COGS', 'Expense', 'OthExpense')
                AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
            GROUP BY 
                ${segmentField}, BUILTIN.DF(${segmentField}), a.accttype
        `;
        
        const results = Shared.runSuiteQL(sql);
        
        // Aggregate by segment
        const segments = {};
        results.forEach(r => {
            const segId = r.segment_id || 'unassigned';
            const segName = r.segment_name || 'Unassigned';
            
            if (!segments[segId]) {
                segments[segId] = { id: segId, name: segName, revenue: 0, cogs: 0, opex: 0 };
            }
            
            const amt = parseFloat(r.amount) || 0;
            const type = String(r.accttype);
            
            if (type === 'Income' || type === 'OthIncome') {
                segments[segId].revenue += (amt * -1);
            } else if (type === 'COGS') {
                segments[segId].cogs += amt;
            } else if (type === 'Expense' || type === 'OthExpense') {
                segments[segId].opex += amt;
            }
        });
        
        // Calculate metrics
        let totalRevenue = 0;
        const segmentList = Object.values(segments).map(s => {
            const gm = s.revenue - s.cogs;
            const opInc = gm - s.opex;
            totalRevenue += s.revenue;
            
            return {
                id: s.id,
                name: s.name,
                revenue: Shared.round2(s.revenue),
                cogs: Shared.round2(s.cogs),
                grossMargin: Shared.round2(gm),
                gmPercent: s.revenue > 0 ? Shared.round2(gm / s.revenue) : 0,
                opex: Shared.round2(s.opex),
                operatingIncome: Shared.round2(opInc),
                opMarginPercent: s.revenue > 0 ? Shared.round2(opInc / s.revenue) : 0
            };
        });
        
        // Add contribution %
        segmentList.forEach(s => {
            s.contribution = totalRevenue > 0 ? Shared.round2(s.revenue / totalRevenue) : 0;
        });
        
        // Sort by revenue descending
        segmentList.sort((a, b) => b.revenue - a.revenue);
        
        return {
            segmentType: segmentType,
            segments: segmentList,
            totals: {
                revenue: Shared.round2(totalRevenue),
                segments: segmentList.length
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FORECASTING
    // ═══════════════════════════════════════════════════════════════════════════
    
    function generateForecast(endDate, periodsForward, subsidiaryId) {
        // Get 12 months of history
        const historical = getMonthlyTrend(parseLocalDate(endDate), 12, subsidiaryId);
        
        if (!historical || historical.length < 3) {
            return { error: 'Insufficient historical data for forecasting' };
        }
        
        // Calculate trends
        const revenues = historical.map(h => h.revenue);
        const expenses = historical.map(h => h.cogs + h.opex);
        
        const revTrend = calculateLinearTrend(revenues);
        const expTrend = calculateLinearTrend(expenses);
        
        // Generate forecasts
        const forecasts = [];
        const n = historical.length;
        
        for (let i = 1; i <= periodsForward; i++) {
            const projRevenue = revTrend.intercept + revTrend.slope * (n + i - 1);
            const projExpense = expTrend.intercept + expTrend.slope * (n + i - 1);
            const projNetIncome = projRevenue - projExpense;
            
            // Confidence bands (widen over time)
            const confidence = Math.max(0.5, 1 - (i * 0.08));
            const revStdDev = calculateStdDev(revenues);
            const bandWidth = revStdDev * (1 + i * 0.2);
            
            // Get month label
            const forecastDate = parseLocalDate(endDate);
            forecastDate.setMonth(forecastDate.getMonth() + i);
            
            forecasts.push({
                period: i,
                monthLabel: forecastDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                revenue: {
                    projected: Math.max(0, Shared.round2(projRevenue)),
                    low: Math.max(0, Shared.round2(projRevenue - bandWidth)),
                    high: Shared.round2(projRevenue + bandWidth)
                },
                expenses: {
                    projected: Math.max(0, Shared.round2(projExpense)),
                    low: Math.max(0, Shared.round2(projExpense - bandWidth * 0.5)),
                    high: Shared.round2(projExpense + bandWidth * 0.5)
                },
                netIncome: {
                    projected: Shared.round2(projNetIncome),
                    low: Shared.round2(projRevenue - bandWidth - projExpense),
                    high: Shared.round2(projRevenue + bandWidth - projExpense)
                },
                confidence: Shared.round2(confidence)
            });
        }
        
        return {
            historical: historical,
            forecasts: forecasts,
            model: {
                revenueGrowthRate: revTrend.slope > 0 ? Shared.round2(revTrend.slope / (revenues[0] || 1)) : 0,
                expenseGrowthRate: expTrend.slope > 0 ? Shared.round2(expTrend.slope / (expenses[0] || 1)) : 0
            }
        };
    }
    
    function calculateLinearTrend(data) {
        const n = data.length;
        if (n < 2) return { slope: 0, intercept: data[0] || 0 };
        
        const xMean = (n - 1) / 2;
        const yMean = data.reduce((a, b) => a + b, 0) / n;
        
        let numerator = 0;
        let denominator = 0;
        
        data.forEach((val, i) => {
            numerator += (i - xMean) * (val - yMean);
            denominator += (i - xMean) ** 2;
        });
        
        const slope = denominator !== 0 ? numerator / denominator : 0;
        const intercept = yMean - slope * xMean;
        
        return { slope, intercept };
    }
    
    function calculateStdDev(data) {
        if (data.length < 2) return 0;
        const mean = data.reduce((a, b) => a + b, 0) / data.length;
        const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
        return Math.sqrt(variance);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SCENARIO CALCULATOR
    // ═══════════════════════════════════════════════════════════════════════════
    
    function calculateScenario(params) {
        const { scenarioType, inputs, currentData } = params;
        
        const currentRevenue = currentData.revenue || 0;
        const currentCogs = currentData.cogs || 0;
        const currentOpex = currentData.opex || 0;
        const currentGM = currentRevenue - currentCogs;
        const currentNetIncome = currentGM - currentOpex;
        
        let result = {
            current: {
                revenue: currentRevenue,
                cogs: currentCogs,
                grossMargin: currentGM,
                opex: currentOpex,
                netIncome: currentNetIncome
            },
            projected: {},
            impact: {},
            insight: ''
        };
        
        switch (scenarioType) {
            case 'revenue_change': {
                const changePercent = parseFloat(inputs.changePercent) || 0;
                const newRevenue = currentRevenue * (1 + changePercent / 100);
                const gmRatio = currentRevenue > 0 ? currentGM / currentRevenue : 0;
                const newGM = newRevenue * gmRatio;
                const newCogs = newRevenue - newGM;
                const newNetIncome = newGM - currentOpex;
                
                result.projected = {
                    revenue: Shared.round2(newRevenue),
                    cogs: Shared.round2(newCogs),
                    grossMargin: Shared.round2(newGM),
                    opex: currentOpex,
                    netIncome: Shared.round2(newNetIncome)
                };
                result.impact = {
                    revenueChange: Shared.round2(newRevenue - currentRevenue),
                    netIncomeChange: Shared.round2(newNetIncome - currentNetIncome)
                };
                result.insight = `A ${changePercent}% revenue change results in ${newNetIncome > currentNetIncome ? 'an increase' : 'a decrease'} of ${Math.abs(Shared.round2(newNetIncome - currentNetIncome))} in net income.`;
                break;
            }
            
            case 'opex_change': {
                const changePercent = parseFloat(inputs.changePercent) || 0;
                const newOpex = currentOpex * (1 + changePercent / 100);
                const newNetIncome = currentGM - newOpex;
                
                result.projected = {
                    revenue: currentRevenue,
                    cogs: currentCogs,
                    grossMargin: currentGM,
                    opex: Shared.round2(newOpex),
                    netIncome: Shared.round2(newNetIncome)
                };
                result.impact = {
                    opexChange: Shared.round2(newOpex - currentOpex),
                    netIncomeChange: Shared.round2(newNetIncome - currentNetIncome)
                };
                result.insight = `A ${changePercent}% OpEx change directly impacts net income by ${Shared.round2(currentNetIncome - newNetIncome)}.`;
                break;
            }
            
            case 'breakeven': {
                const gmRatio = currentRevenue > 0 ? currentGM / currentRevenue : 0;
                const breakevenRevenue = gmRatio > 0 ? currentOpex / gmRatio : 0;
                const marginOfSafety = currentRevenue > 0 ? (currentRevenue - breakevenRevenue) / currentRevenue : 0;
                
                result.projected = {
                    breakevenRevenue: Shared.round2(breakevenRevenue),
                    marginOfSafety: Shared.round2(marginOfSafety),
                    revenueAboveBreakeven: Shared.round2(currentRevenue - breakevenRevenue)
                };
                result.insight = `Breakeven revenue is ${Shared.round2(breakevenRevenue)}. Current revenue is ${marginOfSafety > 0 ? Shared.round2(marginOfSafety * 100) + '% above' : 'below'} breakeven.`;
                break;
            }
            
            default:
                result.error = 'Unknown scenario type';
        }
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANOMALY DETECTION
    // ═══════════════════════════════════════════════════════════════════════════
    
    function detectAnomalies(monthlyTrend, currentAccounts, config) {
        const anomalies = [];
        const threshold = config.anomalyThreshold || 2.0;
        
        // Check for margin drift
        if (monthlyTrend && monthlyTrend.length >= 3) {
            const gmPcts = monthlyTrend.map(m => m.gmPct);
            const recent3 = gmPcts.slice(-3);
            const isDecreasing = recent3[0] > recent3[1] && recent3[1] > recent3[2];
            
            if (isDecreasing) {
                const decline = (recent3[0] - recent3[2]) * 100;
                anomalies.push({
                    type: 'margin_drift',
                    severity: decline > 5 ? 'high' : 'medium',
                    title: 'Margin Decline Detected',
                    description: `Gross margin has declined ${decline.toFixed(1)}pp over the last 3 months`,
                    metric: Shared.round2(decline)
                });
            }
        }
        
        // Check for account spikes
        const allAccounts = [
            ...(currentAccounts.cogsAccounts || []),
            ...(currentAccounts.opexAccounts || [])
        ];
        
        // Simple check: flag any account > 20% of revenue as concentrated
        if (currentAccounts.revenueAccounts && currentAccounts.revenueAccounts.length > 0) {
            const totalRevenue = currentAccounts.revenueAccounts.reduce((sum, a) => sum + a.amount, 0);
            const topAccount = currentAccounts.revenueAccounts[0];
            
            if (topAccount && totalRevenue > 0 && topAccount.amount / totalRevenue > 0.5) {
                anomalies.push({
                    type: 'concentration',
                    severity: 'medium',
                    title: 'Revenue Concentration',
                    description: `${topAccount.accountName} represents ${((topAccount.amount / totalRevenue) * 100).toFixed(0)}% of revenue`,
                    accountId: topAccount.accountId
                });
            }
        }
        
        return anomalies;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OPERATING METRICS
    // ═══════════════════════════════════════════════════════════════════════════
    
    function calculateOperatingMetrics(metrics, periodMetrics, monthsInRange, subsidiaryId) {
        // Try to get headcount (simplified - count employees with payroll)
        const headcount = getApproximateHeadcount(subsidiaryId) || 10;
        
        const revenuePerEmployee = headcount > 0 ? metrics.revenue / headcount : 0;
        const gmPerEmployee = headcount > 0 ? metrics.gm / headcount : 0;
        const opIncPerEmployee = headcount > 0 ? metrics.opInc / headcount : 0;
        
        const opexRatio = metrics.revenue > 0 ? metrics.opex / metrics.revenue : 0;
        const cogsRatio = metrics.revenue > 0 ? metrics.cogs / metrics.revenue : 0;
        
        return {
            headcount: headcount,
            revenuePerEmployee: Shared.round2(revenuePerEmployee),
            grossMarginPerEmployee: Shared.round2(gmPerEmployee),
            netIncomePerEmployee: Shared.round2(opIncPerEmployee),
            opexAsPercentOfRevenue: Shared.round2(opexRatio),
            cogsAsPercentOfRevenue: Shared.round2(cogsRatio),
            monthsInRange: monthsInRange,
            annualizedRevenue: Shared.round2(metrics.revenue * (12 / monthsInRange)),
            annualizedNetIncome: Shared.round2(metrics.opInc * (12 / monthsInRange))
        };
    }
    
    function getApproximateHeadcount(subsidiaryId) {
        try {
            const sql = `
                SELECT COUNT(DISTINCT e.id) AS headcount
                FROM Employee e
                WHERE e.isinactive = 'F'
                ${subsidiaryId ? `AND e.subsidiary = ${subsidiaryId}` : ''}
            `;
            const results = Shared.runSuiteQL(sql);
            return results.length > 0 ? parseInt(results[0].headcount) || 0 : 0;
        } catch (e) {
            return 0;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TOP MOVERS (DRIVERS)
    // ═══════════════════════════════════════════════════════════════════════════
    
    function calculateTopMovers(current, prior) {
        const movers = [];
        
        // Combine all account types
        const currentAll = {};
        const priorAll = {};
        
        ['revenueAccounts', 'cogsAccounts', 'opexAccounts'].forEach(type => {
            (current[type] || []).forEach(a => {
                currentAll[a.accountId] = { ...a, type: type };
            });
            (prior[type] || []).forEach(a => {
                priorAll[a.accountId] = { ...a, type: type };
            });
        });
        
        // Calculate changes
        const allIds = new Set([...Object.keys(currentAll), ...Object.keys(priorAll)]);
        
        allIds.forEach(id => {
            const curr = currentAll[id];
            const prev = priorAll[id];
            
            const currAmt = curr ? curr.amount : 0;
            const prevAmt = prev ? prev.amount : 0;
            const change = currAmt - prevAmt;
            const changePct = prevAmt !== 0 ? change / prevAmt : (currAmt !== 0 ? 1 : 0);
            
            if (Math.abs(change) > 100) { // Minimum threshold
                movers.push({
                    accountId: id,
                    accountName: (curr || prev).accountName,
                    accountType: (curr || prev).type,
                    currentAmount: Shared.round2(currAmt),
                    priorAmount: Shared.round2(prevAmt),
                    change: Shared.round2(change),
                    changePercent: Shared.round2(changePct),
                    direction: change > 0 ? 'increase' : 'decrease'
                });
            }
        });
        
        // Sort by absolute change
        movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        
        return {
            increases: movers.filter(m => m.direction === 'increase').slice(0, 10),
            decreases: movers.filter(m => m.direction === 'decrease').slice(0, 10)
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REVENUE BY CUSTOMER
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getRevenueByCustomer(startDate, endDate, subsidiaryId) {
        const sql = `
            SELECT 
                t.entity AS customer_id,
                BUILTIN.DF(t.entity) AS customer_name,
                SUM(tal.amount) * -1 AS revenue,
                COUNT(DISTINCT t.id) AS transaction_count
            FROM 
                Transaction t
                JOIN TransactionAccountingLine tal ON t.id = tal.transaction
                JOIN Account a ON tal.account = a.id
            WHERE 
                t.posting = 'T'
                AND tal.posting = 'T'
                AND a.accttype IN ('Income', 'OthIncome')
                AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND t.entity IS NOT NULL
                ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
            GROUP BY 
                t.entity, BUILTIN.DF(t.entity)
            HAVING SUM(tal.amount) < 0
            ORDER BY 
                revenue DESC
            FETCH FIRST 50 ROWS ONLY
        `;
        
        const results = Shared.runSuiteQL(sql);
        const totalRevenue = results.reduce((sum, r) => sum + (parseFloat(r.revenue) || 0), 0);
        
        return results.map(r => ({
            customerId: r.customer_id,
            customerName: r.customer_name || 'Unknown',
            revenue: Shared.round2(parseFloat(r.revenue) || 0),
            transactionCount: parseInt(r.transaction_count) || 0,
            shareOfRevenue: totalRevenue > 0 ? Shared.round2((parseFloat(r.revenue) || 0) / totalRevenue) : 0
        }));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BUDGET VS ACTUAL
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getBudgetVariance(startDate, endDate, subsidiaryId) {
        // Try to fetch budget data from NetSuite
        try {
            // Get actual P&L data
            const actualData = fetchPLRange(startDate, endDate, subsidiaryId);
            const accountIds = [...new Set(actualData.map(r => r.account))];
            const accountMap = getAccountMetadata(accountIds);
            
            // Aggregate actuals by account
            const actualsByAccount = {};
            actualData.forEach(row => {
                const accId = row.account;
                if (!actualsByAccount[accId]) {
                    actualsByAccount[accId] = { amount: 0, type: row.accounttype };
                }
                actualsByAccount[accId].amount += parseFloat(row.amount) || 0;
            });
            
            // Try to get budget data - NetSuite stores budgets in Budget record type
            let budgetData = [];
            try {
                const budgetSql = `
                    SELECT 
                        b.account AS account_id,
                        BUILTIN.DF(b.account) AS account_name,
                        a.accttype,
                        SUM(b.amount) AS budget_amount
                    FROM 
                        Budget b
                        JOIN Account a ON b.account = a.id
                    WHERE 
                        b.year = EXTRACT(YEAR FROM TO_DATE('${startDate}', 'YYYY-MM-DD'))
                        AND a.accttype IN ('Income', 'OthIncome', 'COGS', 'Expense', 'OthExpense')
                        ${subsidiaryId ? `AND b.subsidiary = ${subsidiaryId}` : ''}
                    GROUP BY 
                        b.account, BUILTIN.DF(b.account), a.accttype
                `;
                budgetData = Shared.runSuiteQL(budgetSql);
            } catch (e) {
                // Budget records may not exist
                log.debug('Budget query failed', e.message);
            }
            
            if (!budgetData || budgetData.length === 0) {
                // No budget data - return actuals with zero budgets
                return buildVarianceFromActualsOnly(actualsByAccount, accountMap);
            }
            
            // Build variance report
            const byAccount = [];
            const summary = { revenue: { budget: 0, actual: 0 }, cogs: { budget: 0, actual: 0 }, opex: { budget: 0, actual: 0 } };
            
            budgetData.forEach(b => {
                const accId = b.account_id;
                const budgetAmt = parseFloat(b.budget_amount) || 0;
                const actualRaw = actualsByAccount[accId] ? actualsByAccount[accId].amount : 0;
                const type = b.accttype;
                
                // Normalize signs
                let actualAmt = actualRaw;
                if (type === 'Income' || type === 'OthIncome') {
                    actualAmt = actualRaw * -1;
                }
                
                const variance = actualAmt - budgetAmt;
                const variancePct = budgetAmt !== 0 ? variance / budgetAmt : 0;
                const isGood = (type === 'Income' || type === 'OthIncome') ? variance >= 0 : variance <= 0;
                
                byAccount.push({
                    accountId: accId,
                    accountName: b.account_name || accountMap[accId]?.acctName || 'Unknown',
                    accountType: type,
                    budget: Shared.round2(budgetAmt),
                    actual: Shared.round2(actualAmt),
                    variance: Shared.round2(variance),
                    variancePercent: Shared.round2(variancePct),
                    status: isGood ? 'good' : (Math.abs(variancePct) > 0.1 ? 'critical' : 'warning')
                });
                
                // Aggregate to summary
                if (type === 'Income' || type === 'OthIncome') {
                    summary.revenue.budget += budgetAmt;
                    summary.revenue.actual += actualAmt;
                } else if (type === 'COGS') {
                    summary.cogs.budget += budgetAmt;
                    summary.cogs.actual += actualAmt;
                } else {
                    summary.opex.budget += budgetAmt;
                    summary.opex.actual += actualAmt;
                }
            });
            
            // Calculate summary variances
            ['revenue', 'cogs', 'opex'].forEach(key => {
                summary[key].variance = summary[key].actual - summary[key].budget;
                summary[key].variancePercent = summary[key].budget !== 0 ? summary[key].variance / summary[key].budget : 0;
            });
            
            // Net income
            summary.netIncome = {
                budget: summary.revenue.budget - summary.cogs.budget - summary.opex.budget,
                actual: summary.revenue.actual - summary.cogs.actual - summary.opex.actual
            };
            summary.netIncome.variance = summary.netIncome.actual - summary.netIncome.budget;
            summary.netIncome.variancePercent = summary.netIncome.budget !== 0 ? summary.netIncome.variance / summary.netIncome.budget : 0;
            
            // Alerts for accounts significantly over budget
            const alerts = byAccount
                .filter(a => a.status === 'critical' && (a.accountType === 'Expense' || a.accountType === 'OthExpense' || a.accountType === 'COGS'))
                .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
                .slice(0, 5);
            
            return {
                available: true,
                summary: summary,
                byAccount: byAccount.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
                alerts: alerts,
                periodLabel: `${startDate} to ${endDate}`
            };
            
        } catch (e) {
            log.error('Budget variance error', e.message);
            return {
                available: false,
                message: 'Unable to retrieve budget data: ' + e.message
            };
        }
    }
    
    function buildVarianceFromActualsOnly(actualsByAccount, accountMap) {
        const byAccount = [];
        const summary = { revenue: { budget: 0, actual: 0 }, cogs: { budget: 0, actual: 0 }, opex: { budget: 0, actual: 0 } };
        
        Object.keys(actualsByAccount).forEach(accId => {
            const data = actualsByAccount[accId];
            const meta = accountMap[accId] || {};
            const type = data.type;
            let amt = data.amount;
            
            if (type === 'Income' || type === 'OthIncome') {
                amt = amt * -1;
                summary.revenue.actual += amt;
            } else if (type === 'COGS') {
                summary.cogs.actual += amt;
            } else {
                summary.opex.actual += amt;
            }
            
            byAccount.push({
                accountId: accId,
                accountName: meta.acctName || 'Unknown',
                accountType: type,
                budget: 0,
                actual: Shared.round2(amt),
                variance: Shared.round2(amt),
                variancePercent: 1,
                status: 'no-budget'
            });
        });
        
        summary.netIncome = {
            budget: 0,
            actual: summary.revenue.actual - summary.cogs.actual - summary.opex.actual,
            variance: summary.revenue.actual - summary.cogs.actual - summary.opex.actual,
            variancePercent: 1
        };
        
        return {
            available: false,
            message: 'No budget data found. Showing actuals only.',
            summary: summary,
            byAccount: byAccount.sort((a, b) => Math.abs(b.actual) - Math.abs(a.actual)),
            alerts: []
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ACCOUNT BY VENDOR (Flyout drill-down)
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getAccountByVendor(accountId, startDate, endDate, subsidiaryId) {
        const sql = `
            SELECT 
                t.entity AS vendor_id,
                BUILTIN.DF(t.entity) AS vendor_name,
                SUM(tal.amount) AS amount,
                COUNT(DISTINCT t.id) AS transaction_count
            FROM 
                Transaction t
                JOIN TransactionAccountingLine tal ON t.id = tal.transaction
            WHERE 
                t.posting = 'T'
                AND tal.posting = 'T'
                AND tal.account = ${accountId}
                AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND t.entity IS NOT NULL
                ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
            GROUP BY 
                t.entity, BUILTIN.DF(t.entity)
            ORDER BY 
                ABS(SUM(tal.amount)) DESC
            FETCH FIRST 20 ROWS ONLY
        `;
        
        const results = Shared.runSuiteQL(sql);
        const total = results.reduce((sum, r) => sum + Math.abs(parseFloat(r.amount) || 0), 0);
        
        return results.map(r => ({
            vendorId: r.vendor_id,
            vendorName: r.vendor_name || 'Unknown',
            amount: Shared.round2(parseFloat(r.amount) || 0),
            transactionCount: parseInt(r.transaction_count) || 0,
            percentOfTotal: total > 0 ? Shared.round2(Math.abs(parseFloat(r.amount) || 0) / total) : 0
        }));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ACCOUNT BY EMPLOYEE (Flyout drill-down)
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getAccountByEmployee(accountId, startDate, endDate, subsidiaryId) {
        const sql = `
            SELECT 
                tl.employee AS employee_id,
                BUILTIN.DF(tl.employee) AS employee_name,
                SUM(tal.amount) AS amount,
                COUNT(DISTINCT t.id) AS transaction_count
            FROM 
                Transaction t
                JOIN TransactionAccountingLine tal ON t.id = tal.transaction
                JOIN TransactionLine tl ON t.id = tl.transaction AND tal.transactionline = tl.id
            WHERE 
                t.posting = 'T'
                AND tal.posting = 'T'
                AND tal.account = ${accountId}
                AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND tl.employee IS NOT NULL
                ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
            GROUP BY 
                tl.employee, BUILTIN.DF(tl.employee)
            ORDER BY 
                ABS(SUM(tal.amount)) DESC
            FETCH FIRST 20 ROWS ONLY
        `;
        
        const results = Shared.runSuiteQL(sql);
        const total = results.reduce((sum, r) => sum + Math.abs(parseFloat(r.amount) || 0), 0);
        
        return results.map(r => ({
            employeeId: r.employee_id,
            employeeName: r.employee_name || 'Unknown',
            amount: Shared.round2(parseFloat(r.amount) || 0),
            transactionCount: parseInt(r.transaction_count) || 0,
            percentOfTotal: total > 0 ? Shared.round2(Math.abs(parseFloat(r.amount) || 0) / total) : 0
        }));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ACCOUNT MONTHLY TREND (Flyout sparkline)
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getAccountMonthlyTrend(accountId, months, subsidiaryId) {
        const results = [];
        const today = new Date();
        
        for (let i = months - 1; i >= 0; i--) {
            const monthEnd = new Date(today.getFullYear(), today.getMonth() - i, 0);
            const monthStart = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 1);
            
            const sql = `
                SELECT 
                    SUM(tal.amount) AS amount
                FROM 
                    Transaction t
                    JOIN TransactionAccountingLine tal ON t.id = tal.transaction
                WHERE 
                    t.posting = 'T'
                    AND tal.posting = 'T'
                    AND tal.account = ${accountId}
                    AND t.trandate >= TO_DATE('${Shared.formatDateYMD(monthStart)}', 'YYYY-MM-DD')
                    AND t.trandate <= TO_DATE('${Shared.formatDateYMD(monthEnd)}', 'YYYY-MM-DD')
                    ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
            `;
            
            const rows = Shared.runSuiteQL(sql);
            const amt = rows.length > 0 ? parseFloat(rows[0].amount) || 0 : 0;
            
            results.push({
                monthLabel: monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                amount: Shared.round2(amt)
            });
        }
        
        return {
            trend: results,
            labels: results.map(r => r.monthLabel),
            values: results.map(r => r.amount)
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARGIN BRIDGE (Period Comparison)
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getMarginBridge(startDate, endDate, priorStartDate, priorEndDate, subsidiaryId) {
        // Get current period data
        const currentRows = fetchPLRange(startDate, endDate, subsidiaryId);
        const priorRows = fetchPLRange(priorStartDate, priorEndDate, subsidiaryId);
        
        const allAccountIds = new Set();
        currentRows.forEach(r => allAccountIds.add(r.account));
        priorRows.forEach(r => allAccountIds.add(r.account));
        
        const accountMap = getAccountMetadata(Array.from(allAccountIds));
        
        const currentMetrics = aggregatePLForScope(currentRows, accountMap, null);
        const priorMetrics = aggregatePLForScope(priorRows, accountMap, null);
        
        const currentAccounts = buildAccountBreakdown(currentRows, accountMap, null);
        const priorAccounts = buildAccountBreakdown(priorRows, accountMap, null);
        
        // Build bridge steps
        const bridge = [];
        
        // Start with prior net income
        bridge.push({
            label: 'Prior Period Net Income',
            value: priorMetrics.opInc,
            cumulative: priorMetrics.opInc,
            type: 'total'
        });
        
        // Revenue change
        const revenueChange = currentMetrics.revenue - priorMetrics.revenue;
        bridge.push({
            label: 'Revenue Change',
            value: revenueChange,
            type: revenueChange >= 0 ? 'increase' : 'decrease',
            detail: `${priorMetrics.revenue} → ${currentMetrics.revenue}`
        });
        
        // COGS change (negative is good)
        const cogsChange = currentMetrics.cogs - priorMetrics.cogs;
        bridge.push({
            label: 'COGS Change',
            value: -cogsChange,
            type: cogsChange <= 0 ? 'increase' : 'decrease',
            detail: `${priorMetrics.cogs} → ${currentMetrics.cogs}`
        });
        
        // OpEx change (negative is good)
        const opexChange = currentMetrics.opex - priorMetrics.opex;
        bridge.push({
            label: 'OpEx Change',
            value: -opexChange,
            type: opexChange <= 0 ? 'increase' : 'decrease',
            detail: `${priorMetrics.opex} → ${currentMetrics.opex}`
        });
        
        // End with current net income
        bridge.push({
            label: 'Current Period Net Income',
            value: currentMetrics.opInc,
            cumulative: currentMetrics.opInc,
            type: 'total'
        });
        
        // Top drivers (which accounts changed most)
        const drivers = calculateTopMovers(currentAccounts, priorAccounts);
        
        return {
            bridge: bridge,
            summary: {
                priorRevenue: priorMetrics.revenue,
                currentRevenue: currentMetrics.revenue,
                priorGM: priorMetrics.gm,
                currentGM: currentMetrics.gm,
                priorNetIncome: priorMetrics.opInc,
                currentNetIncome: currentMetrics.opInc,
                netIncomeChange: currentMetrics.opInc - priorMetrics.opInc,
                netIncomeChangePct: priorMetrics.opInc !== 0 ? (currentMetrics.opInc - priorMetrics.opInc) / Math.abs(priorMetrics.opInc) : 0
            },
            drivers: drivers,
            periods: {
                current: { start: startDate, end: endDate },
                prior: { start: priorStartDate, end: priorEndDate }
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ACCOUNT-LEVEL ANOMALY DETECTION (Z-Score)
    // ═══════════════════════════════════════════════════════════════════════════
    
    function detectAccountLevelAnomalies(months, subsidiaryId) {
        const anomalies = [];
        const today = new Date();
        
        // Get all expense accounts with activity
        const accountSql = `
            SELECT DISTINCT tal.account, a.accttype, BUILTIN.DF(tal.account) AS account_name
            FROM Transaction t
            JOIN TransactionAccountingLine tal ON t.id = tal.transaction
            JOIN Account a ON tal.account = a.id
            WHERE t.posting = 'T' AND tal.posting = 'T'
            AND a.accttype IN ('COGS', 'Expense', 'OthExpense')
            AND t.trandate >= ADD_MONTHS(SYSDATE, -${months})
            ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
        `;
        
        const accounts = Shared.runSuiteQL(accountSql);
        
        accounts.forEach(acc => {
            // Get monthly totals for this account
            const monthlyData = [];
            
            for (let i = months - 1; i >= 0; i--) {
                const monthEnd = new Date(today.getFullYear(), today.getMonth() - i, 0);
                const monthStart = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 1);
                
                const sql = `
                    SELECT SUM(tal.amount) AS amount
                    FROM Transaction t
                    JOIN TransactionAccountingLine tal ON t.id = tal.transaction
                    WHERE t.posting = 'T' AND tal.posting = 'T'
                    AND tal.account = ${acc.account}
                    AND t.trandate >= TO_DATE('${Shared.formatDateYMD(monthStart)}', 'YYYY-MM-DD')
                    AND t.trandate <= TO_DATE('${Shared.formatDateYMD(monthEnd)}', 'YYYY-MM-DD')
                    ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
                `;
                
                const rows = Shared.runSuiteQL(sql);
                const amt = rows.length > 0 ? parseFloat(rows[0].amount) || 0 : 0;
                monthlyData.push(amt);
            }
            
            // Calculate Z-score for most recent month
            if (monthlyData.length >= 3) {
                const historical = monthlyData.slice(0, -1);
                const current = monthlyData[monthlyData.length - 1];
                
                const mean = historical.reduce((a, b) => a + b, 0) / historical.length;
                const variance = historical.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historical.length;
                const stdDev = Math.sqrt(variance);
                
                if (stdDev > 0) {
                    const zScore = (current - mean) / stdDev;
                    
                    if (Math.abs(zScore) >= 2) {
                        anomalies.push({
                            accountId: acc.account,
                            accountName: acc.account_name,
                            accountType: acc.accttype,
                            currentAmount: Shared.round2(current),
                            historicalMean: Shared.round2(mean),
                            standardDeviation: Shared.round2(stdDev),
                            zScore: Shared.round2(zScore),
                            severity: Math.abs(zScore) >= 3 ? 'critical' : 'warning',
                            direction: zScore > 0 ? 'spike' : 'drop',
                            description: zScore > 0 
                                ? `${acc.account_name} is ${Math.abs(zScore).toFixed(1)}σ above normal`
                                : `${acc.account_name} is ${Math.abs(zScore).toFixed(1)}σ below normal`,
                            monthlyTrend: monthlyData
                        });
                    }
                }
            }
        });
        
        // Sort by severity and z-score
        anomalies.sort((a, b) => {
            if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
            return Math.abs(b.zScore) - Math.abs(a.zScore);
        });
        
        return {
            anomalies: anomalies.slice(0, 20),
            totalChecked: accounts.length,
            anomalyCount: anomalies.length
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEGMENT COMPARISON (Side-by-side)
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getSegmentComparison(segmentType, segmentIds, startDate, endDate, subsidiaryId) {
        if (!segmentIds || segmentIds.length === 0) {
            return { error: 'No segments specified' };
        }
        
        const segments = [];
        
        segmentIds.forEach(segId => {
            const data = getSegmentProfitabilityForId(segmentType, segId, startDate, endDate, subsidiaryId);
            if (data) {
                segments.push(data);
            }
        });
        
        // Calculate rankings
        const ranked = {
            byRevenue: [...segments].sort((a, b) => b.revenue - a.revenue),
            byGMPercent: [...segments].sort((a, b) => b.gmPercent - a.gmPercent),
            byNetIncome: [...segments].sort((a, b) => b.operatingIncome - a.operatingIncome)
        };
        
        // Best and worst
        const best = ranked.byNetIncome[0];
        const worst = ranked.byNetIncome[ranked.byNetIncome.length - 1];
        
        return {
            segments: segments,
            rankings: ranked,
            best: best,
            worst: worst,
            comparison: {
                revenueRange: { min: Math.min(...segments.map(s => s.revenue)), max: Math.max(...segments.map(s => s.revenue)) },
                gmRange: { min: Math.min(...segments.map(s => s.gmPercent)), max: Math.max(...segments.map(s => s.gmPercent)) }
            }
        };
    }
    
    function getSegmentProfitabilityForId(segmentType, segmentId, startDate, endDate, subsidiaryId) {
        let segmentField;
        
        switch (segmentType) {
            case 'class': segmentField = 'tl.class'; break;
            case 'location': segmentField = 'tl.location'; break;
            default: segmentField = 'tl.department';
        }
        
        const sql = `
            SELECT 
                BUILTIN.DF(${segmentField}) AS segment_name,
                a.accttype,
                SUM(tal.amount) AS amount
            FROM 
                Transaction t
                JOIN TransactionAccountingLine tal ON t.id = tal.transaction
                JOIN TransactionLine tl ON t.id = tl.transaction AND tal.transactionline = tl.id
                JOIN Account a ON tal.account = a.id
            WHERE 
                t.posting = 'T'
                AND tal.posting = 'T'
                AND ${segmentField} = ${segmentId}
                AND a.accttype IN ('Income', 'OthIncome', 'COGS', 'Expense', 'OthExpense')
                AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
            GROUP BY 
                BUILTIN.DF(${segmentField}), a.accttype
        `;
        
        const results = Shared.runSuiteQL(sql);
        
        if (results.length === 0) return null;
        
        let revenue = 0, cogs = 0, opex = 0;
        let segmentName = '';
        
        results.forEach(r => {
            segmentName = r.segment_name || 'Unknown';
            const amt = parseFloat(r.amount) || 0;
            const type = String(r.accttype);
            
            if (type === 'Income' || type === 'OthIncome') revenue += (amt * -1);
            else if (type === 'COGS') cogs += amt;
            else opex += amt;
        });
        
        const gm = revenue - cogs;
        const opInc = gm - opex;
        
        return {
            id: segmentId,
            name: segmentName,
            revenue: Shared.round2(revenue),
            cogs: Shared.round2(cogs),
            grossMargin: Shared.round2(gm),
            gmPercent: revenue > 0 ? Shared.round2(gm / revenue) : 0,
            opex: Shared.round2(opex),
            operatingIncome: Shared.round2(opInc),
            opMarginPercent: revenue > 0 ? Shared.round2(opInc / revenue) : 0
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRICE / VOLUME / MIX ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Decompose revenue change into Price, Volume, and Mix effects
     * This is a CFO-grade analysis technique
     */
    function getPriceVolumeMixAnalysis(startDate, endDate, priorStartDate, priorEndDate, subsidiaryId) {
        // Get item-level sales data for both periods
        const currentItemSales = getItemLevelSales(startDate, endDate, subsidiaryId);
        const priorItemSales = getItemLevelSales(priorStartDate, priorEndDate, subsidiaryId);
        
        if (currentItemSales.length === 0 && priorItemSales.length === 0) {
            return {
                available: false,
                message: 'Insufficient item-level sales data for Price/Volume/Mix analysis',
                methodology: 'This analysis requires item-level transaction data with quantity and rate information.'
            };
        }
        
        // Build maps keyed by item
        const priorMap = {};
        priorItemSales.forEach(s => {
            priorMap[s.itemId] = s;
        });
        
        const currentMap = {};
        currentItemSales.forEach(s => {
            currentMap[s.itemId] = s;
        });
        
        // Calculate totals
        let totalPriorRevenue = 0, totalCurrentRevenue = 0;
        let totalPriorQty = 0, totalCurrentQty = 0;
        
        priorItemSales.forEach(s => {
            totalPriorRevenue += s.revenue;
            totalPriorQty += s.quantity;
        });
        
        currentItemSales.forEach(s => {
            totalCurrentRevenue += s.revenue;
            totalCurrentQty += s.quantity;
        });
        
        // Calculate average prices
        const priorAvgPrice = totalPriorQty > 0 ? totalPriorRevenue / totalPriorQty : 0;
        const currentAvgPrice = totalCurrentQty > 0 ? totalCurrentRevenue / totalCurrentQty : 0;
        
        // Revenue change decomposition
        const totalChange = totalCurrentRevenue - totalPriorRevenue;
        
        // PRICE EFFECT: (Current Price - Prior Price) × Prior Quantity
        // How much revenue changed due to price changes alone
        const priceEffect = (currentAvgPrice - priorAvgPrice) * totalPriorQty;
        
        // VOLUME EFFECT: (Current Quantity - Prior Quantity) × Prior Price
        // How much revenue changed due to volume changes alone
        const volumeEffect = (totalCurrentQty - totalPriorQty) * priorAvgPrice;
        
        // MIX EFFECT: The residual (interaction of price and volume changes)
        // Can also be calculated as: Total Change - Price Effect - Volume Effect
        const mixEffect = totalChange - priceEffect - volumeEffect;
        
        // Item-level breakdown (top movers)
        const itemAnalysis = [];
        const allItemIds = new Set([...Object.keys(priorMap), ...Object.keys(currentMap)]);
        
        allItemIds.forEach(itemId => {
            const prior = priorMap[itemId] || { revenue: 0, quantity: 0, avgPrice: 0, itemName: 'Unknown' };
            const current = currentMap[itemId] || { revenue: 0, quantity: 0, avgPrice: 0, itemName: prior.itemName };
            
            const revChange = current.revenue - prior.revenue;
            const qtyChange = current.quantity - prior.quantity;
            const priceChange = current.avgPrice - prior.avgPrice;
            
            // Item-level effects
            const itemPriceEffect = priceChange * prior.quantity;
            const itemVolumeEffect = qtyChange * prior.avgPrice;
            const itemMixEffect = revChange - itemPriceEffect - itemVolumeEffect;
            
            if (Math.abs(revChange) > 100) { // Minimum threshold
                itemAnalysis.push({
                    itemId: itemId,
                    itemName: current.itemName || prior.itemName,
                    priorRevenue: Shared.round2(prior.revenue),
                    currentRevenue: Shared.round2(current.revenue),
                    revenueChange: Shared.round2(revChange),
                    priorQuantity: prior.quantity,
                    currentQuantity: current.quantity,
                    quantityChange: qtyChange,
                    priorPrice: Shared.round2(prior.avgPrice),
                    currentPrice: Shared.round2(current.avgPrice),
                    priceChange: Shared.round2(priceChange),
                    priceEffect: Shared.round2(itemPriceEffect),
                    volumeEffect: Shared.round2(itemVolumeEffect),
                    mixEffect: Shared.round2(itemMixEffect)
                });
            }
        });
        
        // Sort by absolute revenue change
        itemAnalysis.sort((a, b) => Math.abs(b.revenueChange) - Math.abs(a.revenueChange));
        
        // Summary percentages
        const pricePct = totalChange !== 0 ? priceEffect / totalChange : 0;
        const volumePct = totalChange !== 0 ? volumeEffect / totalChange : 0;
        const mixPct = totalChange !== 0 ? mixEffect / totalChange : 0;
        
        return {
            available: true,
            summary: {
                priorRevenue: Shared.round2(totalPriorRevenue),
                currentRevenue: Shared.round2(totalCurrentRevenue),
                totalChange: Shared.round2(totalChange),
                totalChangePct: totalPriorRevenue > 0 ? Shared.round2(totalChange / totalPriorRevenue) : 0,
                
                priceEffect: Shared.round2(priceEffect),
                priceEffectPct: Shared.round2(pricePct),
                
                volumeEffect: Shared.round2(volumeEffect),
                volumeEffectPct: Shared.round2(volumePct),
                
                mixEffect: Shared.round2(mixEffect),
                mixEffectPct: Shared.round2(mixPct),
                
                priorAvgPrice: Shared.round2(priorAvgPrice),
                currentAvgPrice: Shared.round2(currentAvgPrice),
                priceChangePct: priorAvgPrice > 0 ? Shared.round2((currentAvgPrice - priorAvgPrice) / priorAvgPrice) : 0,
                
                priorTotalQty: totalPriorQty,
                currentTotalQty: totalCurrentQty,
                volumeChangePct: totalPriorQty > 0 ? Shared.round2((totalCurrentQty - totalPriorQty) / totalPriorQty) : 0
            },
            items: itemAnalysis,
            methodology: 'Price Effect = ΔPrice × Prior Qty | Volume Effect = ΔQty × Prior Price | Mix Effect = Residual'
        };
    }
    
    /**
     * Get item-level sales data with quantity and price info
     */
    function getItemLevelSales(startDate, endDate, subsidiaryId) {
        const sql = `
            SELECT 
                tl.item AS item_id,
                BUILTIN.DF(tl.item) AS item_name,
                SUM(tl.quantity) AS total_qty,
                SUM(tl.netamount) * -1 AS revenue,
                CASE WHEN SUM(tl.quantity) <> 0 
                    THEN (SUM(tl.netamount) * -1) / SUM(tl.quantity) 
                    ELSE 0 
                END AS avg_price
            FROM 
                Transaction t
                JOIN TransactionLine tl ON t.id = tl.transaction
            WHERE 
                t.posting = 'T'
                AND t.type IN ('CustInvc', 'CashSale', 'CustCred')
                AND tl.item IS NOT NULL
                AND tl.mainline = 'F'
                AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
            GROUP BY 
                tl.item, BUILTIN.DF(tl.item)
            HAVING SUM(tl.quantity) <> 0
        `;
        
        try {
            const results = Shared.runSuiteQL(sql);
            return results.map(r => ({
                itemId: r.item_id,
                itemName: r.item_name || 'Unknown',
                quantity: parseFloat(r.total_qty) || 0,
                revenue: parseFloat(r.revenue) || 0,
                avgPrice: parseFloat(r.avg_price) || 0
            }));
        } catch (e) {
            log.debug('Item sales query failed', e.message);
            return [];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS (Original)
    // ═══════════════════════════════════════════════════════════════════════════

    function fetchPLRange(start, end, subsidiaryId) {
        const sql = `
            SELECT 
                tal.account, 
                tl.department, 
                SUM(tal.amount) as amount,
                a.accttype as accounttype
            FROM 
                Transaction t 
            JOIN 
                TransactionAccountingLine tal ON t.id = tal.transaction
            JOIN 
                TransactionLine tl ON tal.transaction = tl.transaction AND tal.transactionline = tl.id
            JOIN 
                Account a ON tal.account = a.id
            WHERE 
                t.posting = 'T' 
                AND t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD') 
                AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
                AND a.accttype IN ('Income', 'OthIncome', 'COGS', 'Expense', 'OthExpense')
                ${subsidiaryId ? `AND t.subsidiary = ${subsidiaryId}` : ''}
            GROUP BY 
                tal.account, tl.department, a.accttype
        `;
        return Shared.runSuiteQL(sql);
    }

    function getAccountMetadata(ids) {
        if (!ids || ids.length === 0) return {};
        const map = {};
        search.create({
            type: search.Type.ACCOUNT,
            filters: [['internalid', 'anyof', ids]],
            columns: ['name', 'number', 'type']
        }).run().each(res => {
            map[res.id] = {
                id: res.id,
                acctName: res.getValue('name'),
                acctNumber: res.getValue('number'),
                acctType: res.getValue('type')
            };
            return true;
        });
        return map;
    }

    function getDepartments(hiddenDeptIds) {
        const list = [];
        const hiddenSet = new Set((hiddenDeptIds || []).map(String));
        
        search.create({
            type: search.Type.DEPARTMENT,
            filters: [['isinactive', 'is', 'F']],
            columns: ['name', 'internalid']
        }).run().each(res => {
            if (!hiddenSet.has(String(res.id))) {
                list.push({ id: res.id, name: res.getValue('name') });
            }
            return true;
        });
        return list;
    }

    function aggregatePLForScope(rows, accountMap, deptId) {
        let rev = 0, cogs = 0, opex = 0;
        
        rows.forEach(row => {
            if (deptId && String(row.department) !== String(deptId)) return;
            
            const amt = parseFloat(row.amount) || 0;
            if (amt === 0) return;

            const type = String(row.accounttype);
            
            if (type === 'Income' || type === 'OthIncome') {
                rev += (amt * -1);
            } else if (type === 'COGS') {
                cogs += amt;
            } else if (type === 'Expense' || type === 'OthExpense') {
                opex += amt;
            }
        });

        const gm = rev - cogs;
        const opInc = gm - opex;
        const gmPct = rev !== 0 ? gm / rev : 0;

        return { revenue: Shared.round2(rev), cogs: Shared.round2(cogs), opex: Shared.round2(opex), gm: Shared.round2(gm), opInc: Shared.round2(opInc), gmPct: Shared.round2(gmPct) };
    }

    function buildAccountBreakdown(rows, accountMap, deptId) {
        const rev = [], cogs = [], opex = [];
        
        const agg = {};
        rows.forEach(row => {
            if (deptId && String(row.department) !== String(deptId)) return;
            if (!agg[row.account]) agg[row.account] = { amount: 0, type: row.accounttype };
            agg[row.account].amount += parseFloat(row.amount);
        });

        Object.keys(agg).forEach(accId => {
            const meta = accountMap[accId] || { acctName: 'Unknown', acctNumber: '000' };
            const amt = agg[accId].amount;
            const type = agg[accId].type;
            
            const obj = { 
                accountId: accId, 
                accountName: meta.acctName, 
                accountNumber: meta.acctNumber, 
                amount: (type === 'Income' || type === 'OthIncome') ? (amt * -1) : amt 
            };

            if (obj.amount === 0) return;

            if (type === 'Income' || type === 'OthIncome') rev.push(obj);
            else if (type === 'COGS') cogs.push(obj);
            else if (type === 'Expense' || type === 'OthExpense') opex.push(obj);
        });

        const sortFn = (a,b) => b.amount - a.amount;
        return { revenueAccounts: rev.sort(sortFn), cogsAccounts: cogs.sort(sortFn), opexAccounts: opex.sort(sortFn) };
    }

    function chooseTargetGMPct(last, curr, ytd, config) {
        const defaultGM = config.defaultTargetGM || 0.20;
        const minGM = config.gmBounds ? config.gmBounds.min : 0.05;
        const maxGM = config.gmBounds ? config.gmBounds.max : 0.60;
        
        const candidates = [last, curr, ytd, defaultGM];
        for (let gm of candidates) {
            if (gm > minGM) {
                return Math.min(Math.max(gm, minGM), maxGM);
            }
        }
        return defaultGM;
    }

    function computeHealthScore(avgRev, breakeven, actGM, targetGM) {
        if (!breakeven || breakeven <= 0 || targetGM <= 0) return 50;
        const coverage = avgRev != 0 ? avgRev / breakeven : 0;
        const gmRatio = actGM / targetGM;
        const score = (60 * Math.min(coverage, 1.5) / 1.5) + (40 * Math.min(gmRatio, 1.5) / 1.5);
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    function buildDeptNarrative(name, range, cm, pm, avgRev, be, targetGM, yoy, config) {
        const issues = [], recs = [];
        
        const gmThreshold = config.gmWarningThresholds ? config.gmWarningThresholds.department : 0.10;
        const opexThreshold = config.opexToRevenueWarningThreshold || 0.30;
        
        if (range.gmPct < gmThreshold) {
            issues.push(`Gross margin (${(range.gmPct * 100).toFixed(1)}%) is below threshold`);
            recs.push('Review pricing and cost structure');
        }
        
        if (range.revenue > 0 && range.opex / range.revenue > opexThreshold) {
            issues.push(`OpEx is ${((range.opex / range.revenue) * 100).toFixed(0)}% of revenue`);
            recs.push('Evaluate operating expense efficiency');
        }
        
        if (be && avgRev < be * 0.8) {
            issues.push('Operating below breakeven threshold');
            recs.push('Focus on revenue growth or cost reduction');
        }
        
        if (yoy != null && yoy < -0.1) {
            issues.push(`YoY revenue down ${(Math.abs(yoy) * 100).toFixed(0)}%`);
        }
        
        return { issues, recommendations: recs };
    }

    function buildCompanyNarrative(range, cm, pm, avgRev, be, targetGM, yoy, config) {
        const issues = [], recs = [];
        
        const gmThreshold = config.gmWarningThresholds ? config.gmWarningThresholds.company : 0.15;
        
        if (range.gmPct < gmThreshold) {
            issues.push(`Company gross margin (${(range.gmPct * 100).toFixed(1)}%) needs attention`);
            recs.push('Review product/service mix and pricing strategy');
        }
        
        if (be && avgRev && avgRev < be) {
            issues.push('Average monthly revenue is below breakeven');
            recs.push('Urgent: Address revenue or cost structure');
        } else if (be && avgRev && avgRev < be * 1.2) {
            issues.push('Operating close to breakeven - limited buffer');
            recs.push('Build revenue cushion above breakeven');
        }
        
        if (yoy != null && yoy > 0.2) {
            recs.push('Strong YoY growth - ensure scalable operations');
        }
        
        return { issues, recommendations: recs };
    }

    function getSparklineData(endDate, months, subsidiaryId) {
        const data = getMonthlyTrend(endDate, months, subsidiaryId);
        
        return {
            labels: data.map(d => d.monthLabel),
            revenue: data.map(d => d.revenue),
            gm: data.map(d => d.gm),
            gmPct: data.map(d => d.gmPct),
            opex: data.map(d => d.opex),
            netIncome: data.map(d => d.opInc)
        };
    }

    function getMonthlyTrend(endDate, months, subsidiaryId) {
        const results = [];
        const end = endDate instanceof Date ? endDate : parseLocalDate(endDate);
        
        for (let i = months - 1; i >= 0; i--) {
            const monthEnd = new Date(end.getFullYear(), end.getMonth() - i + 1, 0);
            const monthStart = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 1);
            
            const startStr = Shared.formatDateYMD(monthStart);
            const endStr = Shared.formatDateYMD(monthEnd);
            
            const rows = fetchPLRange(startStr, endStr, subsidiaryId);
            const accountMap = {};
            rows.forEach(r => {
                accountMap[r.account] = { acctType: r.accounttype };
            });
            
            const metrics = aggregatePLForScope(rows, accountMap, null);
            
            results.push({
                monthLabel: monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                monthStart: startStr,
                monthEnd: endStr,
                ...metrics
            });
        }
        
        return results;
    }
    
    function getDepartmentPL(departmentId, startDate, endDate, subsidiaryId) {
        const rows = fetchPLRange(startDate, endDate, subsidiaryId);
        let allAccountIds = new Set();
        rows.forEach(r => allAccountIds.add(r.account));
        
        const accountMap = getAccountMetadata(Array.from(allAccountIds));
        const metrics = aggregatePLForScope(rows, accountMap, departmentId);
        const accounts = buildAccountBreakdown(rows, accountMap, departmentId);
        
        return {
            metrics: metrics,
            accounts: accounts
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        getData: getData,
        handleRequest: handleRequest
    };
});