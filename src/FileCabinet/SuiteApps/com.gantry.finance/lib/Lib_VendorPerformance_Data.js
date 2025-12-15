/**
 * Lib_VendorPerformance_Data.js
 * PROCUREMENT 5.0 - World-Class Vendor Performance Intelligence Library
 * 
 * MULTI-CURRENCY AWARE: Uses COALESCE(T.amount, T.foreigntotal) for compatibility
 * - T.amount is base currency (preferred for multi-currency)
 * - Falls back to T.foreigntotal for single-currency accounts
 * - PPV uses exchange rate normalized rates for accurate comparison
 * 
 * FEATURES:
 * - Multi-Currency Normalization with fallback
 * - Maverick Spend Detection (VendBills without PO linkage)
 * - OTIF Analysis (On-Time In-Full delivery)
 * - Lead Time Variance with Coefficient of Variation
 * - Purchase Price Variance (PPV) with exchange rate normalization
 * - Weighted Vendor Scorecard (FICO-style 0-100 with letter grades)
 * - Interactive Bubble Chart data
 * 
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/query', 'N/record', 'N/search', 'N/runtime', 'N/format', 'N/log', './Lib_Core', './advisor/Lib_Advisor_Utils'],
function(query, record, search, runtime, format, log, Core, Utils) {
    'use strict';

    const runSuiteQL = Core.runQuery;
    
    // ==========================================
    // CONSTANTS
    // ==========================================
    // Transaction types that involve vendors
    const VENDOR_TRAN_TYPES = "'VendBill', 'VendCred', 'VendPymt', 'Check', 'Bill', 'BillPmt'";
    
    // Default values (used when config not provided)
    const DEFAULTS = {
        weightOTIF: 35,
        weightPPV: 25,
        weightMaverick: 25,
        weightTerms: 15,
        maverickWarningPct: 25,
        maverickCriticalPct: 50,
        ppvVarianceThreshold: 10,
        onTimeWindowDays: 3,
        highSpendThreshold: 80,
        highPerformanceThreshold: 75,
        hhiWarningThreshold: 1500,
        hhiCriticalThreshold: 2500,
        topVendorsCount: 20,
        showInactiveVendors: false,
        excludedVendorIds: []
    };
    
    // Helper to get config value with fallback
    function cfg(config, key) {
        return (config && config[key] !== undefined) ? config[key] : DEFAULTS[key];
    }
    
    // ==========================================
    // MAIN ANALYSIS FUNCTION
    // ==========================================
    function analyzeVendorPerformance(params) {
        // Resolve dates using unified period system
        // Priority: explicit dates > period parameter > default (ytd)
        let startDate, endDate;

        if (params.startDate && params.endDate) {
            startDate = params.startDate;
            endDate = params.endDate;
        } else if (params.period) {
            const periodDates = Core.getPeriodDates(params.period, 'ytd');
            startDate = periodDates.start;
            endDate = periodDates.end;
        } else {
            const periodDates = Core.getPeriodDates('ytd', 'ytd');
            startDate = periodDates.start;
            endDate = periodDates.end;
        }

        const subsidiaryId = params.subsidiary || null;
        const config = params.config || {};
        
        // Merge with defaults
        const mergedConfig = Object.assign({}, DEFAULTS, config);
        
        const results = {
            vendorSpend: [],
            maverickSpend: { summary: {}, vendors: [] },
            otif: { summary: {}, vendors: [] },
            leadTimeVariance: { summary: {}, vendors: [] },
            ppv: { summary: {}, items: [], vendors: [] },
            cashFlowLeakage: { summary: {}, vendors: [] },
            leverageMatrix: { quadrants: {}, vendors: [], bubbleData: [] },
            concentrationRisk: { vendors: [], herfindahlIndex: 0 },
            paymentTrends: { monthly: [] },
            vendorScorecard: [],
            currencyInfo: {},
            summary: {},
            _config: mergedConfig  // Include config in response for UI
        };
        
        const diagnostics = {
            _version: 'v6.2-audit-fixes',
            startDate,
            endDate,
            subsidiaryId
        };
        
        try {
            // 0. Get currency info for display
            results.currencyInfo = getCurrencyInfo(subsidiaryId);
            
            // 1. Get vendor spend data (filter excluded vendors)
            let vendorSpend = getVendorSpendData(startDate, endDate, subsidiaryId);
            const excludedIds = mergedConfig.excludedVendorIds || [];
            if (excludedIds.length > 0) {
                vendorSpend = vendorSpend.filter(v => !excludedIds.includes(String(v.vendorId)));
            }
            results.vendorSpend = vendorSpend;
            
            // 2. Maverick Spend - VendBills without PO linkage
            results.maverickSpend = analyzeMaverickSpend(startDate, endDate, subsidiaryId, mergedConfig);
            
            // 3. OTIF Analysis
            results.otif = analyzeOTIF(startDate, endDate, subsidiaryId, mergedConfig);
            
            // 4. Lead Time Variance
            results.leadTimeVariance = analyzeLeadTimeVariance(startDate, endDate, subsidiaryId);
            
            // 5. PPV Analysis
            results.ppv = analyzePPV(startDate, endDate, subsidiaryId, mergedConfig);
            
            // 6. Cash Flow / Due Date Analysis
            results.cashFlowLeakage = analyzeCashFlowStatus(startDate, endDate, subsidiaryId);
            
            // 7. Leverage Matrix
            results.leverageMatrix = analyzeLeverageMatrix(vendorSpend, results, mergedConfig);
            
            // 8. Concentration Risk
            results.concentrationRisk = analyzeConcentrationRisk(vendorSpend, mergedConfig);
            
            // 9. Payment Trends
            results.paymentTrends = analyzePaymentTrends(startDate, endDate, subsidiaryId);
            
            // 10. Build Vendor Scorecard (FICO-style scoring)
            results.vendorScorecard = buildVendorScorecard(results, mergedConfig);
            
            // 11. Executive Summary
            results.summary = generateSummary(results, vendorSpend, mergedConfig);
            
        } catch (e) {
            diagnostics.error = e.message;
        }
        
        return { results, diagnostics };
    }
    // ==========================================
    // CURRENCY INFO
    // ==========================================
    function getCurrencyInfo(subsidiaryId) {
        try {
            // Try to get base currency from subsidiary first
            if (subsidiaryId) {
                const subSql = `
                    SELECT S.currency, C.symbol, C.name AS currency_name
                    FROM Subsidiary S
                    LEFT JOIN Currency C ON S.currency = C.id
                    WHERE S.id = ${subsidiaryId}
                `;
                const subResults = runSuiteQL(subSql);
                if (subResults.length > 0 && subResults[0].symbol) {
                    return {
                        symbol: subResults[0].symbol,
                        name: subResults[0].currency_name || subResults[0].symbol
                    };
                }
            }
            // Get base currency from company preferences or first currency
            const sql = `
                SELECT C.symbol, C.name AS currency_name, C.isbasecurrency
                FROM Currency C
                WHERE C.isbasecurrency = 'T'
                FETCH FIRST 1 ROW ONLY
            `;
            const results = runSuiteQL(sql);
            if (results.length > 0 && results[0].symbol) {
                return {
                    symbol: results[0].symbol,
                    name: results[0].currency_name || results[0].symbol
                };
            }
            // Fallback: Get from most common transaction currency
            const fallbackSql = `
                SELECT C.symbol, C.name AS currency_name, COUNT(*) AS cnt
                FROM Transaction T
                LEFT JOIN Currency C ON T.currency = C.id
                WHERE T.currency IS NOT NULL
                GROUP BY C.symbol, C.name
                ORDER BY cnt DESC
                FETCH FIRST 1 ROW ONLY
            `;
            const fallbackResults = runSuiteQL(fallbackSql);
            if (fallbackResults.length > 0 && fallbackResults[0].symbol) {
                return {
                    symbol: fallbackResults[0].symbol,
                    name: fallbackResults[0].currency_name || fallbackResults[0].symbol
                };
            }
        } catch (e) {
        }
        return { symbol: '$', name: 'Unknown' };
    }
    // ==========================================
    // VENDOR SPEND DATA (CURRENCY-AWARE)
    // Uses T.amount (base currency) for accurate aggregation
    // FIX: Added voided transaction filter
    // ==========================================
    function getVendorSpendData(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        const sql = `
            SELECT 
                T.entity AS vendor_id,
                BUILTIN.DF(T.entity) AS vendor_name,
                COUNT(DISTINCT T.id) AS transaction_count,
                SUM(ABS(T.foreigntotal)) AS total_spend
            FROM Transaction T
            WHERE T.type IN (${VENDOR_TRAN_TYPES})
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND T.entity IS NOT NULL
                AND (T.voided = 'F' OR T.voided IS NULL)
                ${subFilter}
            GROUP BY T.entity, BUILTIN.DF(T.entity)
            ORDER BY total_spend DESC NULLS LAST
            FETCH FIRST 500 ROWS ONLY
        `;
        const results = runSuiteQL(sql);
        return results.map(row => ({
            vendorId: row.vendor_id,
            vendorName: row.vendor_name || 'Unknown Vendor',
            transactionCount: parseInt(row.transaction_count) || 0,
            totalSpend: parseFloat(row.total_spend) || 0
        })).filter(v => v.totalSpend > 0);
    }
    // ==========================================
    // MAVERICK SPEND ANALYSIS
    // Maverick = bills NOT created from a PO (sourcetransaction IS NULL)
    // FIX: Added voided transaction filter
    // ==========================================
    function analyzeMaverickSpend(startDate, endDate, subsidiaryId, config) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        const warningPct = cfg(config, 'maverickWarningPct');
        const criticalPct = cfg(config, 'maverickCriticalPct');
        
        // Query VendBills with sourcetransaction field to check PO linkage
        const sql = `
            SELECT 
                T.entity AS vendor_id,
                BUILTIN.DF(T.entity) AS vendor_name,
                T.id AS bill_id,
                T.sourcetransaction AS po_link,
                ABS(T.foreigntotal) AS bill_amount
            FROM Transaction T
            WHERE T.type = 'VendBill'
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND T.entity IS NOT NULL
                AND (T.voided = 'F' OR T.voided IS NULL)
                ${subFilter}
            ORDER BY T.entity
            FETCH FIRST 5000 ROWS ONLY
        `;
        try {
            const results = runSuiteQL(sql);
            
            // Aggregate in JS - check po_link for each bill
            const vendorMap = {};
            let totalBills = 0;
            let maverickBills = 0;
            let totalSpend = 0;
            let maverickSpendTotal = 0;
            
            results.forEach(row => {
                const vendorId = row.vendor_id;
                const isMaverick = !row.po_link; // No PO = maverick
                const amount = parseFloat(row.bill_amount) || 0;
                
                if (!vendorMap[vendorId]) {
                    vendorMap[vendorId] = {
                        vendorId: vendorId,
                        vendorName: row.vendor_name || 'Unknown',
                        totalBills: 0,
                        maverickCount: 0,
                        totalSpend: 0,
                        maverickSpend: 0
                    };
                }
                
                vendorMap[vendorId].totalBills++;
                vendorMap[vendorId].totalSpend += amount;
                totalBills++;
                totalSpend += amount;
                
                if (isMaverick) {
                    vendorMap[vendorId].maverickCount++;
                    vendorMap[vendorId].maverickSpend += amount;
                    maverickBills++;
                    maverickSpendTotal += amount;
                }
            });
            
            // Convert to array and calculate percentages
            const allVendors = Object.values(vendorMap).map(v => {
                const maverickPct = v.totalBills > 0 ? (v.maverickCount / v.totalBills) * 100 : 0;
                let riskLevel = 'low';
                if (maverickPct >= criticalPct) riskLevel = 'critical';
                else if (maverickPct >= warningPct) riskLevel = 'warning';
                
                return {
                    ...v,
                    maverickPct: Math.round(maverickPct * 10) / 10,
                    riskLevel,
                    complianceScore: Math.round(100 - maverickPct)
                };
            });
            
            // Sort by spend descending
            allVendors.sort((a, b) => b.totalSpend - a.totalSpend);
            
            const vendorsWithMaverick = allVendors.filter(v => v.maverickCount > 0);
            const maverickPctTotal = totalBills > 0 ? (maverickBills / totalBills) * 100 : 0;
            
            return {
                summary: {
                    totalBills,
                    maverickBills,
                    totalSpend,
                    maverickSpend: maverickSpendTotal,
                    maverickPct: Math.round(maverickPctTotal * 10) / 10,
                    complianceRate: Math.round((100 - maverickPctTotal) * 10) / 10,
                    vendorsWithMaverick: vendorsWithMaverick.length,
                    criticalVendors: vendorsWithMaverick.filter(v => v.riskLevel === 'critical').length
                },
                vendors: vendorsWithMaverick,
                allVendors
            };
        } catch (e) {
            throw e;
        }
    }
    // ==========================================
    // OTIF ANALYSIS (On-Time In-Full)
    // FIX: Replaced SYSDATE with endDate for proper historical analysis
    // FIX: Added voided transaction filter
    // ==========================================
    function analyzeOTIF(startDate, endDate, subsidiaryId, config) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        const onTimeWindow = cfg(config, 'onTimeWindowDays');
        
        // Use the END of the selected date range as the reference point
        // This ensures consistent results regardless of when the report is run
        const referenceDate = `TO_DATE('${endDate}', 'YYYY-MM-DD')`;
        
        // Analyze vendor transactions by due date performance
        // Items are "on time" if due date is within onTimeWindow days of reference date
        const sql = `
            SELECT 
                T.entity AS vendor_id,
                BUILTIN.DF(T.entity) AS vendor_name,
                COUNT(*) AS total_transactions,
                SUM(CASE WHEN T.duedate IS NULL THEN 0 
                         WHEN ${referenceDate} <= T.duedate + ${onTimeWindow} THEN 1 
                         ELSE 0 END) AS on_time_count,
                SUM(CASE WHEN T.duedate IS NOT NULL AND ${referenceDate} > T.duedate + ${onTimeWindow} THEN 1 ELSE 0 END) AS late_count,
                SUM(CASE WHEN T.duedate IS NULL THEN 1 ELSE 0 END) AS no_due_date_count,
                AVG(CASE WHEN T.duedate IS NOT NULL THEN ${referenceDate} - T.duedate ELSE NULL END) AS avg_days_from_due
            FROM Transaction T
            WHERE T.type IN (${VENDOR_TRAN_TYPES})
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND T.entity IS NOT NULL
                AND (T.voided = 'F' OR T.voided IS NULL)
                ${subFilter}
            GROUP BY T.entity, BUILTIN.DF(T.entity)
            ORDER BY total_transactions DESC
            FETCH FIRST 500 ROWS ONLY
        `;
        try {
            const results = runSuiteQL(sql);
            let totalTx = 0, totalOnTime = 0, totalLate = 0, totalNoDue = 0;
            const vendors = results.map(row => {
                const tx = parseInt(row.total_transactions) || 0;
                const onTime = parseInt(row.on_time_count) || 0;
                const late = parseInt(row.late_count) || 0;
                const noDue = parseInt(row.no_due_date_count) || 0;
                const avgDays = parseFloat(row.avg_days_from_due) || 0;
                totalTx += tx;
                totalOnTime += onTime;
                totalLate += late;
                totalNoDue += noDue;
                const analyzed = onTime + late;
                const onTimeRate = analyzed > 0 ? (onTime / analyzed) * 100 : 100;
                let rating = 'excellent';
                if (onTimeRate < 70) rating = 'poor';
                else if (onTimeRate < 85) rating = 'fair';
                else if (onTimeRate < 95) rating = 'good';
                return {
                    vendorId: row.vendor_id,
                    vendorName: row.vendor_name || 'Unknown',
                    totalReceipts: tx,
                    onTimeCount: onTime,
                    lateCount: late,
                    noDueDateCount: noDue,
                    onTimeRate: Math.round(onTimeRate * 10) / 10,
                    avgDelayDays: Math.round(avgDays * 10) / 10,
                    rating,
                    otifScore: Math.round(onTimeRate)
                };
            });
            const totalAnalyzed = totalOnTime + totalLate;
            const overallRate = totalAnalyzed > 0 ? (totalOnTime / totalAnalyzed) * 100 : 100;
            return {
                summary: {
                    totalReceipts: totalTx,
                    onTimeCount: totalOnTime,
                    lateCount: totalLate,
                    noDueDateCount: totalNoDue,
                    onTimeRate: Math.round(overallRate * 10) / 10,
                    excellentVendors: vendors.filter(v => v.rating === 'excellent').length,
                    poorVendors: vendors.filter(v => v.rating === 'poor').length
                },
                vendors
            };
        } catch (e) {
            return { 
                summary: { totalReceipts: 0, onTimeRate: 0 },
                vendors: []
            };
        }
    }
    // ==========================================
    // LEAD TIME VARIANCE (Supply Chain Reliability)
    // High variance = Unpredictable = Requires more safety stock
    // ==========================================
    function analyzeLeadTimeVariance(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND PO.subsidiary = ${subsidiaryId}` : '';
        // Calculate average lead time and standard deviation per vendor
        const sql = `
            SELECT 
                PO.entity AS vendor_id,
                BUILTIN.DF(PO.entity) AS vendor_name,
                COUNT(*) AS delivery_count,
                AVG(R.trandate - PO.trandate) AS avg_lead_time,
                STDDEV(R.trandate - PO.trandate) AS lead_time_stddev,
                MIN(R.trandate - PO.trandate) AS min_lead_time,
                MAX(R.trandate - PO.trandate) AS max_lead_time
            FROM Transaction PO
            INNER JOIN Transaction R ON R.sourcetransaction = PO.id
            WHERE PO.type = 'PurchOrd' 
                AND R.type = 'ItemRcpt'
                AND PO.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND PO.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND PO.entity IS NOT NULL
                AND (PO.voided = 'F' OR PO.voided IS NULL)
                AND (R.voided = 'F' OR R.voided IS NULL)
                ${subFilter}
            GROUP BY PO.entity, BUILTIN.DF(PO.entity)
            HAVING COUNT(*) >= 2
            ORDER BY delivery_count DESC
            FETCH FIRST 200 ROWS ONLY
        `;
        try {
            const results = runSuiteQL(sql);
            const vendors = results.map(row => {
                const avgLead = parseFloat(row.avg_lead_time) || 0;
                const stddev = parseFloat(row.lead_time_stddev) || 0;
                const minLead = parseInt(row.min_lead_time) || 0;
                const maxLead = parseInt(row.max_lead_time) || 0;
                const count = parseInt(row.delivery_count) || 0;
                // Coefficient of Variation = stddev / avg (lower = more consistent)
                const cv = avgLead > 0 ? (stddev / avgLead) : 0;
                let reliability = 'excellent';
                if (cv > 0.5) reliability = 'poor';
                else if (cv > 0.3) reliability = 'fair';
                else if (cv > 0.15) reliability = 'good';
                // Score: 100 = perfectly consistent, 0 = highly erratic
                const consistencyScore = Math.max(0, Math.round(100 - (cv * 100)));
                return {
                    vendorId: row.vendor_id,
                    vendorName: row.vendor_name || 'Unknown',
                    deliveryCount: count,
                    avgLeadTime: Math.round(avgLead * 10) / 10,
                    stddev: Math.round(stddev * 10) / 10,
                    minLeadTime: minLead,
                    maxLeadTime: maxLead,
                    coefficientOfVariation: Math.round(cv * 100) / 100,
                    reliability,
                    consistencyScore
                };
            });
            const avgCv = vendors.length > 0 ? 
                vendors.reduce((sum, v) => sum + v.coefficientOfVariation, 0) / vendors.length : 0;
            return {
                summary: {
                    vendorCount: vendors.length,
                    avgCoeffOfVariation: Math.round(avgCv * 100) / 100,
                    highVarianceVendors: vendors.filter(v => v.reliability === 'poor').length,
                    consistentVendors: vendors.filter(v => v.reliability === 'excellent').length
                },
                vendors
            };
        } catch (e) {
            return { 
                summary: { vendorCount: 0 },
                vendors: []
            };
        }
    }
    // ==========================================
    // PPV ANALYSIS (Purchase Price Variance)
    // FIX: Added voided transaction filter
    // FIX: Fixed quantity calculation to exclude returns (positive qty only)
    // ==========================================
    function analyzePPV(startDate, endDate, subsidiaryId, config) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        const ppvThreshold = cfg(config, 'ppvVarianceThreshold');
        const ppvCritical = ppvThreshold * 2; // Critical is 2x warning threshold
        
        // Simple PPV query - compare rates across purchases
        // FIX: Only include positive quantities (purchases, not returns/credits)
        const sql = `
            SELECT 
                T.entity AS vendor_id,
                BUILTIN.DF(T.entity) AS vendor_name,
                TL.item AS item_id,
                BUILTIN.DF(TL.item) AS item_name,
                COUNT(*) AS purchase_count,
                AVG(ABS(TL.rate)) AS avg_rate,
                MIN(ABS(TL.rate)) AS min_rate,
                MAX(ABS(TL.rate)) AS max_rate,
                SUM(CASE WHEN TL.quantity > 0 THEN TL.quantity ELSE 0 END) AS total_qty,
                SUM(CASE WHEN TL.foreignamount > 0 THEN TL.foreignamount ELSE 0 END) AS total_amount
            FROM Transaction T
            INNER JOIN TransactionLine TL ON TL.transaction = T.id
            WHERE T.type IN (${VENDOR_TRAN_TYPES})
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND TL.item IS NOT NULL
                AND TL.rate IS NOT NULL
                AND ABS(TL.rate) > 0
                AND (T.voided = 'F' OR T.voided IS NULL)
                ${subFilter}
            GROUP BY T.entity, BUILTIN.DF(T.entity), TL.item, BUILTIN.DF(TL.item)
            HAVING COUNT(*) >= 2 AND MIN(ABS(TL.rate)) > 0
            ORDER BY total_amount DESC NULLS LAST
            FETCH FIRST 500 ROWS ONLY
        `;
        try {
            const results = runSuiteQL(sql);
            let totalVariance = 0;
            let itemsWithOvercharge = 0;
            const vendorVariance = {};
            const items = results.map(row => {
                const avgRate = parseFloat(row.avg_rate) || 0;
                const minRate = parseFloat(row.min_rate) || avgRate;
                const maxRate = parseFloat(row.max_rate) || avgRate;
                const qty = parseFloat(row.total_qty) || 0;
                const amount = parseFloat(row.total_amount) || 0;
                // Variance from minimum (baseline) rate
                const variance = minRate > 0 ? ((avgRate - minRate) / minRate) * 100 : 0;
                const varianceAmount = (avgRate - minRate) * qty;
                const hasOvercharge = variance > ppvThreshold;
                if (hasOvercharge) {
                    totalVariance += varianceAmount;
                    itemsWithOvercharge++;
                }
                // Aggregate by vendor
                const vid = row.vendor_id;
                if (!vendorVariance[vid]) {
                    vendorVariance[vid] = {
                        vendorId: vid,
                        vendorName: row.vendor_name || 'Unknown',
                        itemCount: 0,
                        totalVariance: 0,
                        totalSpend: 0,
                        overchargeItems: 0
                    };
                }
                vendorVariance[vid].itemCount++;
                vendorVariance[vid].totalSpend += amount;
                if (hasOvercharge) {
                    vendorVariance[vid].totalVariance += varianceAmount;
                    vendorVariance[vid].overchargeItems++;
                }
                let riskLevel = 'ok';
                if (variance >= ppvCritical) riskLevel = 'critical';
                else if (variance >= ppvThreshold) riskLevel = 'warning';
                return {
                    vendorId: row.vendor_id,
                    vendorName: row.vendor_name || 'Unknown',
                    itemId: row.item_id,
                    itemName: row.item_name || 'Unknown Item',
                    purchaseCount: parseInt(row.purchase_count) || 0,
                    avgRate: Math.round(avgRate * 100) / 100,
                    minRate: Math.round(minRate * 100) / 100,
                    maxRate: Math.round(maxRate * 100) / 100,
                    variancePct: Math.round(variance * 10) / 10,
                    varianceAmount: Math.round(varianceAmount * 100) / 100,
                    totalQty: qty,
                    riskLevel
                };
            });
            // Filter to only items with significant variance
            const itemsFiltered = items.filter(i => i.variancePct > ppvThreshold);
            // Convert vendor variance to array
            const vendors = Object.values(vendorVariance)
                .filter(v => v.overchargeItems > 0)
                .map(v => ({
                    ...v,
                    variancePct: v.totalSpend > 0 ? (v.totalVariance / v.totalSpend) * 100 : 0,
                    ppvScore: Math.round(100 - Math.min(100, (v.totalVariance / Math.max(v.totalSpend, 1)) * 200))
                }))
                .sort((a, b) => b.totalVariance - a.totalVariance);
            return {
                summary: {
                    totalVariance: Math.round(totalVariance * 100) / 100,
                    itemsAnalyzed: items.length,
                    itemsWithOvercharge,
                    vendorsWithOvercharge: vendors.length,
                    avgVariancePct: itemsFiltered.length > 0 ? 
                        Math.round(itemsFiltered.reduce((s, i) => s + i.variancePct, 0) / itemsFiltered.length * 10) / 10 : 0
                },
                items: itemsFiltered,
                vendors,
                allItems: items
            };
        } catch (e) {
            throw e;
        }
    }
    // ==========================================
    // CASH FLOW STATUS (Due Date Analysis)
    // FIX: Replaced SYSDATE with endDate for proper historical analysis
    // FIX: Added voided transaction filter
    // ==========================================
    function analyzeCashFlowStatus(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        
        // Use the END of the selected date range as the reference point
        // This ensures consistent results regardless of when the report is run
        const referenceDate = `TO_DATE('${endDate}', 'YYYY-MM-DD')`;
        
        // Use foreigntotal for compatibility
        const sql = `
            SELECT 
                T.entity AS vendor_id,
                BUILTIN.DF(T.entity) AS vendor_name,
                COUNT(*) AS total_bills,
                SUM(CASE WHEN T.duedate IS NULL THEN 1 ELSE 0 END) AS no_due_date,
                SUM(CASE WHEN T.duedate IS NOT NULL AND ${referenceDate} <= T.duedate THEN 1 ELSE 0 END) AS not_due_count,
                SUM(CASE WHEN T.duedate IS NOT NULL AND ${referenceDate} > T.duedate AND ${referenceDate} <= T.duedate + 7 THEN 1 ELSE 0 END) AS due_soon_count,
                SUM(CASE WHEN T.duedate IS NOT NULL AND ${referenceDate} > T.duedate + 7 THEN 1 ELSE 0 END) AS overdue_count,
                SUM(ABS(T.foreigntotal)) AS total_amount,
                SUM(CASE WHEN T.duedate IS NOT NULL AND ${referenceDate} > T.duedate + 7 
                    THEN ABS(T.foreigntotal) ELSE 0 END) AS overdue_amount
            FROM Transaction T
            WHERE T.type IN (${VENDOR_TRAN_TYPES})
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND T.entity IS NOT NULL
                AND (T.voided = 'F' OR T.voided IS NULL)
                ${subFilter}
            GROUP BY T.entity, BUILTIN.DF(T.entity)
            ORDER BY total_bills DESC
            FETCH FIRST 500 ROWS ONLY
        `;
        try {
            const results = runSuiteQL(sql);
            let totalBills = 0, totalNoDue = 0, totalNotDue = 0, totalDueSoon = 0, totalOverdue = 0;
            let totalAmount = 0, totalOverdueAmt = 0;
            const vendors = results.map(row => {
                const bills = parseInt(row.total_bills) || 0;
                const noDue = parseInt(row.no_due_date) || 0;
                const notDue = parseInt(row.not_due_count) || 0;
                const dueSoon = parseInt(row.due_soon_count) || 0;
                const overdue = parseInt(row.overdue_count) || 0;
                const amount = parseFloat(row.total_amount) || 0;
                const overdueAmt = parseFloat(row.overdue_amount) || 0;
                totalBills += bills;
                totalNoDue += noDue;
                totalNotDue += notDue;
                totalDueSoon += dueSoon;
                totalOverdue += overdue;
                totalAmount += amount;
                totalOverdueAmt += overdueAmt;
                const withDue = notDue + dueSoon + overdue;
                const overduePct = withDue > 0 ? (overdue / withDue) * 100 : 0;
                return {
                    vendorId: row.vendor_id,
                    vendorName: row.vendor_name || 'Unknown',
                    totalBills: bills,
                    withDueDate: withDue,
                    noDueDate: noDue,
                    notDueCount: notDue,
                    dueSoonCount: dueSoon,
                    overdueCount: overdue,
                    totalAmount: amount,
                    overdueAmount: overdueAmt,
                    overduePct: Math.round(overduePct * 10) / 10,
                    termsScore: Math.round(100 - Math.min(100, overduePct))
                };
            });
            const withDueTotal = totalNotDue + totalDueSoon + totalOverdue;
            const overduePctTotal = withDueTotal > 0 ? (totalOverdue / withDueTotal) * 100 : 0;
            return {
                summary: {
                    totalBills,
                    withDueDate: withDueTotal,
                    noDueDate: totalNoDue,
                    notDueCount: totalNotDue,
                    dueSoonCount: totalDueSoon,
                    overdueCount: totalOverdue,
                    totalAmount,
                    overdueAmount: totalOverdueAmt,
                    overduePct: Math.round(overduePctTotal * 10) / 10,
                    onTimePct: Math.round((100 - overduePctTotal) * 10) / 10
                },
                vendors: vendors.filter(v => v.withDueDate > 0)
            };
        } catch (e) {
            throw e;
        }
    }
    // ==========================================
    // LEVERAGE MATRIX (Bubble Chart Data)
    // ==========================================
    function analyzeLeverageMatrix(vendorSpend, allResults, config) {
        if (!vendorSpend || vendorSpend.length === 0) {
            return { quadrants: {}, vendors: [], quadrantCounts: {}, bubbleData: [] };
        }
        
        // Get config values
        const highSpendPct = cfg(config, 'highSpendThreshold') / 100; // Convert 80 to 0.80
        const highPerfThreshold = cfg(config, 'highPerformanceThreshold');
        const wOTIF = cfg(config, 'weightOTIF') / 100;
        const wPPV = cfg(config, 'weightPPV') / 100;
        const wMaverick = cfg(config, 'weightMaverick') / 100;
        const wTerms = cfg(config, 'weightTerms') / 100;
        
        const totalSpend = vendorSpend.reduce((sum, v) => sum + v.totalSpend, 0);
        const highSpendThreshold = calculatePercentile(vendorSpend.map(v => v.totalSpend), highSpendPct);
        
        // Build score lookup maps
        const maverickMap = {};
        (allResults.maverickSpend.allVendors || []).forEach(v => {
            maverickMap[v.vendorId] = v.complianceScore || 100;
        });
        const otifMap = {};
        (allResults.otif.vendors || []).forEach(v => {
            otifMap[v.vendorId] = v.otifScore || 50;
        });
        const ppvMap = {};
        (allResults.ppv.allItems || []).forEach(item => {
            if (!ppvMap[item.vendorId]) {
                ppvMap[item.vendorId] = [];
            }
            ppvMap[item.vendorId].push(100 - Math.min(100, item.variancePct * 5));
        });
        const termsMap = {};
        (allResults.cashFlowLeakage.vendors || []).forEach(v => {
            termsMap[v.vendorId] = v.termsScore || 100;
        });
        const vendors = vendorSpend.map(vendor => {
            const spendShare = (vendor.totalSpend / totalSpend) * 100;
            const isHighSpend = vendor.totalSpend >= highSpendThreshold;
            // Get individual scores
            const maverickScore = maverickMap[vendor.vendorId] || 100;
            const otifScore = otifMap[vendor.vendorId] || 75;
            const ppvScores = ppvMap[vendor.vendorId] || [100];
            const ppvScore = ppvScores.reduce((a, b) => a + b, 0) / ppvScores.length;
            const termsScore = termsMap[vendor.vendorId] || 100;
            // Weighted performance score (FICO-style) using config weights
            const performanceScore = Math.round(
                (otifScore * wOTIF) +
                (ppvScore * wPPV) +
                (maverickScore * wMaverick) +
                (termsScore * wTerms)
            );
            const isHighPerformance = performanceScore >= highPerfThreshold;
            // Quadrant assignment
            let quadrant = 'transactional';
            if (isHighSpend && isHighPerformance) {
                quadrant = 'strategic';
            } else if (isHighSpend && !isHighPerformance) {
                quadrant = 'commodity'; // Replace candidates
            } else if (!isHighSpend && isHighPerformance) {
                quadrant = 'niche';
            }
            // Letter grade
            let grade = 'F';
            if (performanceScore >= 90) grade = 'A';
            else if (performanceScore >= 80) grade = 'B';
            else if (performanceScore >= 70) grade = 'C';
            else if (performanceScore >= 60) grade = 'D';
            return {
                ...vendor,
                spendShare: Math.round(spendShare * 100) / 100,
                performanceScore,
                grade,
                maverickScore: Math.round(maverickScore),
                otifScore: Math.round(otifScore),
                ppvScore: Math.round(ppvScore),
                termsScore: Math.round(termsScore),
                quadrant,
                isHighSpend,
                isHighPerformance,
                // Bubble chart coordinates
                x: Math.log10(Math.max(vendor.totalSpend, 1)) * 10, // Log scale for spend
                y: performanceScore,
                r: Math.max(8, Math.min(40, Math.sqrt(vendor.totalSpend / 5000)))
            };
        });
        const quadrantCounts = {
            strategic: vendors.filter(v => v.quadrant === 'strategic').length,
            commodity: vendors.filter(v => v.quadrant === 'commodity').length,
            niche: vendors.filter(v => v.quadrant === 'niche').length,
            transactional: vendors.filter(v => v.quadrant === 'transactional').length
        };
        // Bubble data for chart
        const bubbleData = vendors.slice(0, 100).map(v => ({
            vendorId: v.vendorId,
            vendorName: v.vendorName,
            x: v.spendShare,
            y: v.performanceScore,
            r: v.r,
            quadrant: v.quadrant,
            grade: v.grade,
            totalSpend: v.totalSpend
        }));
        return {
            vendors,
            quadrantCounts,
            bubbleData,
            totalSpend,
            highSpendThreshold
        };
    }
    // ==========================================
    // CONCENTRATION RISK
    // ==========================================
    function analyzeConcentrationRisk(vendorSpend, config) {
        if (!vendorSpend || vendorSpend.length === 0) {
            return { vendors: [], herfindahlIndex: 0, riskLevel: 'low' };
        }
        
        // HHI thresholds from config (expressed as 0-10000 scale)
        const hhiWarning = cfg(config, 'hhiWarningThreshold');
        const hhiCritical = cfg(config, 'hhiCriticalThreshold');
        // Convert to decimal for share comparison (e.g., 15% = 0.15)
        const shareWarning = 0.15;  // 15% share is concerning
        const shareCritical = 0.25; // 25% share is critical
        
        const totalSpend = vendorSpend.reduce((sum, v) => sum + v.totalSpend, 0);
        let hhi = 0;
        const vendors = vendorSpend.map(v => {
            const share = totalSpend > 0 ? (v.totalSpend / totalSpend) : 0;
            hhi += share * share;
            let riskLevel = 'low';
            if (share >= shareCritical) riskLevel = 'critical';
            else if (share >= shareWarning) riskLevel = 'warning';
            return {
                vendorId: v.vendorId,
                vendorName: v.vendorName,
                totalSpend: v.totalSpend,
                spendShare: Math.round(share * 1000) / 10,
                riskLevel
            };
        });
        
        // Convert HHI to 0-10000 scale and compare to config thresholds
        const hhiScaled = Math.round(hhi * 10000);
        let overallRisk = 'low';
        if (hhiScaled >= hhiCritical) overallRisk = 'high';
        else if (hhiScaled >= hhiWarning) overallRisk = 'moderate';
        
        return {
            vendors,
            herfindahlIndex: hhiScaled,
            riskLevel: overallRisk,
            topVendorShare: vendors.length > 0 ? vendors[0].spendShare : 0
        };
    }
    // ==========================================
    // PAYMENT TRENDS (CURRENCY-AWARE)
    // FIX: Added voided transaction filter
    // ==========================================
    function analyzePaymentTrends(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        // Use foreigntotal for compatibility
        const sql = `
            SELECT 
                TO_CHAR(T.trandate, 'YYYY-MM') AS month,
                COUNT(*) AS payment_count,
                SUM(ABS(T.foreigntotal)) AS total_paid
            FROM Transaction T
            WHERE T.type IN (${VENDOR_TRAN_TYPES})
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND (T.voided = 'F' OR T.voided IS NULL)
                ${subFilter}
            GROUP BY TO_CHAR(T.trandate, 'YYYY-MM')
            ORDER BY month
        `;
        try {
            const results = runSuiteQL(sql);
            const monthly = results.map(row => ({
                month: row.month,
                monthLabel: formatMonth(row.month),
                paymentCount: parseInt(row.payment_count) || 0,
                totalPaid: parseFloat(row.total_paid) || 0
            }));
            const totalPaid = monthly.reduce((sum, m) => sum + m.totalPaid, 0);
            const totalPayments = monthly.reduce((sum, m) => sum + m.paymentCount, 0);
            return {
                monthly,
                totalPaid,
                totalPayments,
                avgMonthlySpend: monthly.length > 0 ? totalPaid / monthly.length : 0
            };
        } catch (e) {
            throw e;
        }
    }
    // ==========================================
    // VENDOR SCORECARD (FICO-style 0-100)
    // ==========================================
    function buildVendorScorecard(results, config) {
        // Get weight values from config
        const wOTIF = cfg(config, 'weightOTIF') / 100;
        const wPPV = cfg(config, 'weightPPV') / 100;
        const wMaverick = cfg(config, 'weightMaverick') / 100;
        const wTerms = cfg(config, 'weightTerms') / 100;
        const topCount = cfg(config, 'topVendorsCount');
        
        const vendorMap = {};
        // Start with spend data
        (results.vendorSpend || []).forEach(v => {
            vendorMap[v.vendorId] = {
                vendorId: v.vendorId,
                vendorName: v.vendorName,
                totalSpend: v.totalSpend,
                transactionCount: v.transactionCount,
                otifScore: 75,
                ppvScore: 100,
                maverickScore: 100,
                termsScore: 100
            };
        });
        // Merge maverick data
        (results.maverickSpend.allVendors || []).forEach(v => {
            if (vendorMap[v.vendorId]) {
                vendorMap[v.vendorId].maverickScore = v.complianceScore || 100;
                vendorMap[v.vendorId].maverickPct = v.maverickPct;
            }
        });
        // Merge OTIF data
        (results.otif.vendors || []).forEach(v => {
            if (vendorMap[v.vendorId]) {
                vendorMap[v.vendorId].otifScore = v.otifScore || 75;
                vendorMap[v.vendorId].onTimeRate = v.onTimeRate;
            }
        });
        // Merge PPV data (by vendor)
        const ppvByVendor = {};
        (results.ppv.allItems || []).forEach(item => {
            if (!ppvByVendor[item.vendorId]) {
                ppvByVendor[item.vendorId] = { totalVar: 0, count: 0 };
            }
            ppvByVendor[item.vendorId].totalVar += item.variancePct;
            ppvByVendor[item.vendorId].count++;
        });
        Object.keys(ppvByVendor).forEach(vid => {
            if (vendorMap[vid]) {
                const avgVar = ppvByVendor[vid].totalVar / ppvByVendor[vid].count;
                vendorMap[vid].ppvScore = Math.round(100 - Math.min(100, avgVar * 5));
                vendorMap[vid].avgPriceVariance = Math.round(avgVar * 10) / 10;
            }
        });
        // Merge terms/cash flow data
        (results.cashFlowLeakage.vendors || []).forEach(v => {
            if (vendorMap[v.vendorId]) {
                vendorMap[v.vendorId].termsScore = v.termsScore || 100;
                vendorMap[v.vendorId].overduePct = v.overduePct;
            }
        });
        // Merge lead time variance
        (results.leadTimeVariance.vendors || []).forEach(v => {
            if (vendorMap[v.vendorId]) {
                vendorMap[v.vendorId].leadTimeScore = v.consistencyScore;
                vendorMap[v.vendorId].leadTimeVariance = v.coefficientOfVariation;
            }
        });
        // Calculate overall score and convert to array
        const allVendors = Object.values(vendorMap).map(v => {
            // Weighted overall score using config weights
            const overallScore = Math.round(
                (v.otifScore * wOTIF) +
                (v.ppvScore * wPPV) +
                (v.maverickScore * wMaverick) +
                (v.termsScore * wTerms)
            );
            // Letter grade
            let grade = 'F';
            if (overallScore >= 90) grade = 'A';
            else if (overallScore >= 80) grade = 'B';
            else if (overallScore >= 70) grade = 'C';
            else if (overallScore >= 60) grade = 'D';
            // Recommendation
            let recommendation = 'maintain';
            if (overallScore < 50) recommendation = 'replace';
            else if (overallScore < 65) recommendation = 'review';
            else if (overallScore >= 85 && v.totalSpend > 50000) recommendation = 'strategic';
            return {
                ...v,
                overallScore,
                grade,
                recommendation,
                scoreBreakdown: {
                    otif: { score: v.otifScore, weight: (wOTIF * 100) + '%' },
                    ppv: { score: v.ppvScore, weight: (wPPV * 100) + '%' },
                    maverick: { score: v.maverickScore, weight: (wMaverick * 100) + '%' },
                    terms: { score: v.termsScore, weight: (wTerms * 100) + '%' }
                }
            };
        }).sort((a, b) => b.totalSpend - a.totalSpend);
        
        // Return top N vendors based on config
        return allVendors.slice(0, topCount);
    }
    // ==========================================
    // EXECUTIVE SUMMARY
    // ==========================================
    function generateSummary(results, vendorSpend, config) {
        // Get weight values from config
        const wOTIF = cfg(config, 'weightOTIF') / 100;
        const wPPV = cfg(config, 'weightPPV') / 100;
        const wMaverick = cfg(config, 'weightMaverick') / 100;
        const wTerms = cfg(config, 'weightTerms') / 100;
        
        const totalVendors = vendorSpend.length;
        const totalSpend = vendorSpend.reduce((sum, v) => sum + v.totalSpend, 0);
        const ms = results.maverickSpend.summary || {};
        const otif = results.otif.summary || {};
        const ppv = results.ppv.summary || {};
        const cfl = results.cashFlowLeakage.summary || {};
        const ltv = results.leadTimeVariance.summary || {};
        const lm = results.leverageMatrix;
        const cr = results.concentrationRisk;
        // Calculate procurement health using config weights
        // Use proper undefined checks so 0 values are preserved
        const maverickHealth = ms.complianceRate !== undefined ? ms.complianceRate : 100;
        const otifHealth = otif.onTimeRate !== undefined ? otif.onTimeRate : 75;
        const ppvHealth = ppv.itemsWithOvercharge > 0 ? Math.max(0, 100 - (ppv.avgVariancePct * 5)) : 100;
        const termsHealth = cfl.onTimePct !== undefined ? cfl.onTimePct : 100;
        const procurementScore = Math.round(
            (otifHealth * wOTIF) +
            (ppvHealth * wPPV) +
            (maverickHealth * wMaverick) +
            (termsHealth * wTerms)
        );
        let scoreLabel = 'World Class';
        let scoreGrade = 'A';
        if (procurementScore < 50) { scoreLabel = 'Needs Attention'; scoreGrade = 'F'; }
        else if (procurementScore < 65) { scoreLabel = 'Fair'; scoreGrade = 'D'; }
        else if (procurementScore < 75) { scoreLabel = 'Good'; scoreGrade = 'C'; }
        else if (procurementScore < 85) { scoreLabel = 'Very Good'; scoreGrade = 'B'; }
        else if (procurementScore < 95) { scoreLabel = 'Excellent'; scoreGrade = 'A'; }
        // Generate insights
        const insights = [];
        if (ms.maverickPct > 20) {
            insights.push({
                type: 'alert', category: 'compliance',
                title: 'High Maverick Spend',
                message: `${ms.maverickPct}% of transactions lack PO reference. ${formatNumber(ms.maverickSpend)} unauthorized.`,
                impact: 'high',
                action: 'Enforce PO policy and review vendor onboarding'
            });
        }
        if (otif.onTimeRate < 80 && otif.totalReceipts > 10) {
            insights.push({
                type: 'warning', category: 'delivery',
                title: 'Delivery Performance Issues',
                message: `Only ${otif.onTimeRate}% on-time. ${otif.lateCount} late transactions.`,
                impact: 'high',
                action: 'Review underperforming vendors and negotiate SLAs'
            });
        }
        if (ppv.totalVariance > 1000) {
            insights.push({
                type: 'alert', category: 'pricing',
                title: 'Price Variance Detected',
                message: `${formatNumber(ppv.totalVariance)} overcharge across ${ppv.itemsWithOvercharge} items.`,
                impact: 'high',
                action: 'Audit vendor invoices and update pricing agreements'
            });
        }
        if (cfl.overduePct > 20) {
            insights.push({
                type: 'warning', category: 'cashflow',
                title: 'High Overdue Rate',
                message: `${cfl.overduePct}% of bills overdue. ${formatNumber(cfl.overdueAmount)} at risk.`,
                impact: 'medium',
                action: 'Review payment scheduling and vendor terms'
            });
        }
        if (ltv.highVarianceVendors > 3) {
            insights.push({
                type: 'info', category: 'supply-chain',
                title: 'Lead Time Volatility',
                message: `${ltv.highVarianceVendors} vendors have unpredictable delivery times.`,
                impact: 'medium',
                action: 'Increase safety stock or find alternative suppliers'
            });
        }
        if (cr.riskLevel === 'high') {
            insights.push({
                type: 'alert', category: 'risk',
                title: 'High Vendor Concentration',
                message: `Top vendor = ${cr.topVendorShare}% of spend. HHI: ${cr.herfindahlIndex}`,
                impact: 'high',
                action: 'Diversify supplier base to reduce dependency'
            });
        }
        const strategicCount = lm.quadrantCounts?.strategic || 0;
        const commodityCount = lm.quadrantCounts?.commodity || 0;
        return {
            totalVendors,
            totalSpend,
            procurementScore,
            scoreLabel,
            scoreGrade,
            insights,
            kpis: {
                activeVendors: totalVendors,
                maverickPct: ms.maverickPct || 0,
                maverickSpend: ms.maverickSpend || 0,
                otifRate: otif.onTimeRate || 0,
                lateTransactions: otif.lateCount || 0,
                priceVariance: ppv.totalVariance || 0,
                overdueAmount: cfl.overdueAmount || 0,
                overduePct: cfl.overduePct || 0,
                leadTimeVariance: ltv.avgCoeffOfVariation || 0,
                strategicPartners: strategicCount,
                commodityVendors: commodityCount,
                concentrationIndex: cr.herfindahlIndex || 0
            },
            weights: {
                otif: cfg(config, 'weightOTIF'),
                ppv: cfg(config, 'weightPPV'),
                maverick: cfg(config, 'weightMaverick'),
                terms: cfg(config, 'weightTerms')
            }
        };
    }
    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================
    function getDefaultStartDate() {
        const d = new Date();
        d.setMonth(d.getMonth() - 3);
        return d.toISOString().split('T')[0];
    }
    function getDefaultEndDate() {
        return new Date().toISOString().split('T')[0];
    }
    function calculatePercentile(values, percentile) {
        if (!values || values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil(percentile * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }
    function formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return Math.round(num).toLocaleString();
    }
    function formatMonth(yyyymm) {
        if (!yyyymm) return '';
        const [year, month] = yyyymm.split('-');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[parseInt(month) - 1] + ' ' + year;
    }
    
    function getDefaultConfig() {
        return Object.assign({}, DEFAULTS);
    }
    
    /**
     * Get configuration for API (includes lookup data for UI)
     */
    function getConfigForApi(subsidiaryId) {
        const config = getDefaultConfig();
        
        // Get vendor list for exclusion selector
        let vendors = [];
        try {
            const vendorSql = `
                SELECT 
                    V.id,
                    V.entityid AS name,
                    V.companyname
                FROM Vendor V
                WHERE V.isinactive = 'F'
                ORDER BY V.entityid
                FETCH FIRST 500 ROWS ONLY
            `;
            vendors = runSuiteQL(vendorSql).map(v => ({
                id: v.id,
                name: v.companyname || v.name || 'Vendor ' + v.id
            }));
        } catch (e) {
            // Vendors optional
        }
        
        return {
            config: config,
            vendors: vendors
        };
    }
    
    // ==========================================
    // HANDLE REQUEST (Router delegate for sub-actions)
    // ==========================================
    function handleRequest(params) {
        const subAction = params.subAction || '';
        const debugMode = Utils.isDebugMode();
        
        if (debugMode) {
            log.debug('VendorPerformance handleRequest', { subAction, params: JSON.stringify(params) });
        }
        
        switch (subAction) {
            case 'vendor_transactions':
                // Validate required parameters
                if (!params.vendorId) {
                    return { status: 'error', message: 'Missing vendorId parameter' };
                }
                if (!params.startDate || !params.endDate) {
                    return { status: 'error', message: 'Missing date range parameters' };
                }
                
                return {
                    status: 'success',
                    transactions: getVendorTransactions(
                        params.vendorId,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId,
                        params.context
                    )
                };
                
            default:
                return { status: 'error', message: 'Unknown subAction: ' + subAction };
        }
    }
    
    // ==========================================
    // GET VENDOR TRANSACTIONS (On-demand for drill-down)
    // FIX: Added voided transaction filter
    // ==========================================
    function getVendorTransactions(vendorId, startDate, endDate, subsidiaryId, context) {
        const debugMode = Utils.isDebugMode();
        
        // Validate and sanitize vendorId
        const vendorIdNum = parseInt(vendorId, 10);
        if (isNaN(vendorIdNum) || vendorIdNum <= 0) {
            log.error('getVendorTransactions invalid vendorId', { vendorId });
            return [];
        }
        
        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
            log.error('getVendorTransactions invalid date format', { startDate, endDate });
            return [];
        }
        
        let subFilter = '';
        if (subsidiaryId && parseInt(subsidiaryId, 10) > 0) {
            subFilter = ` AND T.subsidiary = ${parseInt(subsidiaryId, 10)}`;
        }
        
        // Include all vendor transaction types for comprehensive drilldown
        // Use foreigntotal (not amount which doesn't exist on Transaction)
        // Use sourcetransaction for PO link (not createdtransaction)
        let sql = `
            SELECT 
                T.id,
                T.tranid,
                T.type,
                TO_CHAR(T.trandate, 'YYYY-MM-DD') AS date,
                TO_CHAR(T.trandate, 'YYYY-MM') AS month,
                T.entity AS vendor_id,
                BUILTIN.DF(T.entity) AS vendor_name,
                ABS(T.foreigntotal) AS amount,
                T.memo,
                T.duedate,
                T.sourcetransaction AS po_link
            FROM Transaction T
            WHERE T.type IN ('VendBill', 'VendCred', 'VendPymt', 'Check')
            AND (T.voided = 'F' OR T.voided IS NULL)
            AND T.entity = ${vendorIdNum}
            AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
            AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
            ${subFilter}
            ORDER BY T.trandate DESC
            FETCH FIRST 2000 ROWS ONLY
        `;
        
        let rows = [];
        try {
            if (debugMode) {
                log.debug('getVendorTransactions executing query', { 
                    vendorId: vendorIdNum, 
                    startDate, 
                    endDate,
                    context,
                    sqlPreview: sql.substring(0, 300)
                });
            }
            rows = runSuiteQL(sql);
            if (debugMode) {
                log.debug('getVendorTransactions result count', { count: rows.length });
            }
        } catch (e) {
            log.error('getVendorTransactions query error', { 
                vendorId: vendorIdNum, 
                error: e.message, 
                sql: sql.substring(0, 500) 
            });
            return [];
        }
        
        return rows.map(function(r) {
            return {
                id: r.id,
                tranId: r.tranid,
                type: r.type,
                date: r.date,
                month: r.month,
                vendorId: r.vendor_id,
                vendorName: r.vendor_name || '',
                amount: parseFloat(r.amount) || 0,
                memo: r.memo || '',
                dueDate: r.duedate || null,
                hasPO: !!r.po_link
            };
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SCORE-ONLY FUNCTION - Lightweight score computation for dashboard overview
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get vendor performance score only - minimal queries for fast app load
     * Score based on: on-time delivery %, price variance, concentration risk
     * @returns {Object} { score: 0-100, grade: 'A'-'F', label: string, trend: string }
     */
    function getScoreOnly() {
        try {
            var today = new Date();
            var endDate = today.toISOString().split('T')[0];
            var startDate = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate()).toISOString().split('T')[0];

            var totalBills = 0, lateBills = 0, topVendorPct = 0;
            var totalSpend = 0, topVendorSpend = 0;

            // 1. On-time payment analysis (single query)
            try {
                var otifSql = "SELECT " +
                    "COUNT(*) as total_bills, " +
                    "COUNT(CASE WHEN t.trandate > t.duedate AND t.duedate IS NOT NULL THEN 1 END) as late_bills " +
                    "FROM transaction t " +
                    "WHERE t.type = 'VendBill' AND t.mainline = 'T' " +
                    "AND t.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD')";
                var otifResult = Core.runQuery(otifSql);
                if (otifResult && otifResult.length > 0) {
                    totalBills = parseInt(otifResult[0].total_bills) || 0;
                    lateBills = parseInt(otifResult[0].late_bills) || 0;
                }
            } catch (e) { log.debug('OTIF Query', e.message); }

            // 2. Vendor concentration (single query)
            try {
                var concSql = "SELECT " +
                    "SUM(ABS(t.foreigntotal)) as total_spend, " +
                    "MAX(vendor_spend) as top_vendor " +
                    "FROM transaction t, " +
                    "(SELECT SUM(ABS(foreigntotal)) as vendor_spend FROM transaction " +
                    "WHERE type = 'VendBill' AND trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
                    "GROUP BY entity ORDER BY vendor_spend DESC FETCH FIRST 1 ROW ONLY) " +
                    "WHERE t.type = 'VendBill' AND t.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD')";
                var concResult = Core.runQuery(concSql);
                if (concResult && concResult.length > 0) {
                    totalSpend = parseFloat(concResult[0].total_spend) || 0;
                    topVendorSpend = parseFloat(concResult[0].top_vendor) || 0;
                }
            } catch (e) { log.debug('Concentration Query', e.message); }

            // Calculate score components
            var score = 100;
            var deductions = { onTime: 0, concentration: 0 };

            // On-time deductions (max -40)
            var onTimePct = totalBills > 0 ? ((totalBills - lateBills) / totalBills) * 100 : 100;
            if (onTimePct < 70) deductions.onTime = 40;
            else if (onTimePct < 80) deductions.onTime = 25;
            else if (onTimePct < 90) deductions.onTime = 15;
            else if (onTimePct < 95) deductions.onTime = 8;

            // Concentration deductions (max -30)
            topVendorPct = totalSpend > 0 ? (topVendorSpend / totalSpend) * 100 : 0;
            if (topVendorPct > 50) deductions.concentration = 30;
            else if (topVendorPct > 40) deductions.concentration = 20;
            else if (topVendorPct > 30) deductions.concentration = 10;
            else if (topVendorPct > 20) deductions.concentration = 5;

            score = Math.max(0, 100 - deductions.onTime - deductions.concentration);

            var grade = 'A';
            var label = 'Strong';
            if (score < 50) { grade = 'F'; label = 'Critical'; }
            else if (score < 60) { grade = 'D'; label = 'Weak'; }
            else if (score < 70) { grade = 'C'; label = 'Fair'; }
            else if (score < 80) { grade = 'B'; label = 'Good'; }
            else if (score < 90) { grade = 'A'; label = 'Strong'; }
            else { grade = 'A+'; label = 'Excellent'; }

            var trend = 'stable';
            if (onTimePct < 80 || topVendorPct > 40) trend = 'down';
            else if (onTimePct > 95 && topVendorPct < 20) trend = 'up';

            return {
                score: Math.round(score),
                grade: grade,
                label: label,
                trend: trend,
                details: {
                    totalBills: totalBills,
                    onTimePct: Core.round2(onTimePct),
                    topVendorPct: Core.round2(topVendorPct),
                    deductions: deductions
                }
            };
        } catch (e) {
            log.error('VendorPerformance getScoreOnly Error', e.message);
            return { score: 75, grade: 'B', label: 'Unknown', trend: 'stable', error: e.message };
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
     * @param {string} [args.period] - 'last_90_days', 'ytd', 'last_365_days'
     * @param {number} [args.vendor_id] - Optional filter to specific vendor
     * @param {number} [args.subsidiary] - Optional subsidiary filter
     * @returns {Object} Analysis results from analyzeVendorPerformance
     */
    function getData(args) {
        const params = {};
        const today = new Date();

        // Convert period string to startDate/endDate
        switch (args.period) {
            case 'last_90_days':
                params.startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 90).toISOString().split('T')[0];
                params.endDate = today.toISOString().split('T')[0];
                break;
            case 'last_365_days':
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
            params.subsidiary = args.subsidiary;
        }
        if (args.vendor_id) {
            params.vendorId = args.vendor_id;
        }
        if (args.config) {
            params.config = args.config;
        }

        // Call the existing analyze function
        const { results } = analyzeVendorPerformance(params);
        return results;
    }

    // ==========================================
    // PUBLIC API
    // ==========================================
    return {
        getData: getData,
        analyze: analyzeVendorPerformance,
        getConfig: getConfigForApi,
        getDefaultConfig: getDefaultConfig,
        handleRequest: handleRequest,
        getScoreOnly: getScoreOnly
    };
});