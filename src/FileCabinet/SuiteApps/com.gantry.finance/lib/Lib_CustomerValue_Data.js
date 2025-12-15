/**
 * Lib_CustomerValue_Data.js
 * Customer Value Intelligence - Data Analysis Library
 * 
 * Provides comprehensive customer analytics:
 * - Customer Lifetime Value (CLV)
 * - RFM Segmentation (Recency, Frequency, Monetary)
 * - Customer Health Scoring
 * - Profitability Analysis
 * - Churn Risk Prediction
 * - Revenue Concentration Risk
 * - Growth Trend Analysis
 * - Project-aware (when enabled)
 * 
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/query', 'N/runtime', 'N/search', 'N/log', './Lib_Core'], function(query, runtime, search, log, Core) {
    'use strict';

    // Use core utilities
    const runSuiteQL = Core.runQuery;

    // ==========================================
    // DEFAULT CONFIGURATION
    // ==========================================
    const DEFAULTS = {
        // Scoring Weights (must sum to 100)
        weightRecency: 25,
        weightFrequency: 25,
        weightMonetary: 30,
        weightPayment: 20,
        
        // RFM Thresholds
        recencyDaysGood: 30,
        recencyDaysWarning: 90,
        recencyDaysCritical: 180,
        
        // Health Score Thresholds
        healthScoreExcellent: 80,
        healthScoreGood: 60,
        healthScoreWarning: 40,
        
        // Churn Risk
        churnRiskHighDays: 120,
        churnRiskMediumDays: 60,
        
        // Concentration Risk
        hhiWarningThreshold: 1500,
        hhiCriticalThreshold: 2500,
        
        // Display Options
        topCustomersCount: 25,
        includeInactiveCustomers: false,
        clvProjectionYears: 3,
        
        // Profitability Settings
        // method: 'project_financials' | 'gl_rollup' | 'estimated' | 'disabled'
        profitabilityMethod: 'project_financials',
        profitabilityEstimatedMarginPct: 35,
        
        // Profitability - Transactions included in calculation (matches NetSuite Setup > Accounting > Project Profitability)
        // Committed Costs
        profitIncludePlannedTime: false,
        profitIncludeActualTime: true,
        profitIncludeAmortization: false,
        profitIncludePurchaseOrders: true,
        profitIncludeExpenseReportsPending: false,
        profitIncludeVendorBillsPending: false,
        profitIncludeJournalEntriesPending: false,
        profitTreatApprovedTimeAsActual: false,
        // Committed Revenue
        profitIncludeSalesOrders: false,
        profitIncludeCharges: false,
        
        // Excluded Customers
        excludedCustomerIds: []
    };

    // Helper to get config value with fallback
    function cfg(config, key) {
        return (config && config[key] !== undefined) ? config[key] : DEFAULTS[key];
    }

    // ==========================================
    // MAIN ANALYSIS FUNCTION
    // ==========================================
    function analyzeCustomerValue(params) {
        // Resolve dates using unified period system
        // Priority: explicit dates > period parameter > default (last_12_months)
        let startDate, endDate;

        if (params.startDate && params.endDate) {
            startDate = params.startDate;
            endDate = params.endDate;
        } else if (params.period) {
            const periodDates = Core.getPeriodDates(params.period, 'last_12_months');
            startDate = periodDates.start;
            endDate = periodDates.end;
        } else {
            const periodDates = Core.getPeriodDates('last_12_months', 'last_12_months');
            startDate = periodDates.start;
            endDate = periodDates.end;
        }

        const subsidiaryId = params.subsidiary || params.subsidiaryId || null;
        const config = params.config || {};
        
        // Merge with defaults
        const mergedConfig = Object.assign({}, DEFAULTS, config);
        
        const results = {
            customerMetrics: [],
            rfmSegmentation: { segments: {}, customers: [] },
            lifetimeValue: { summary: {}, customers: [] },
            profitability: { summary: {}, customers: [] },
            churnRisk: { summary: {}, customers: [] },
            concentrationRisk: { summary: {}, customers: [] },
            growthTrends: { monthly: [], quarterly: [] },
            paymentBehavior: { summary: {}, customers: [] },
            projectAnalysis: { enabled: false, summary: {}, projects: [] },
            customerHealth: [],
            summary: {},
            currencyInfo: {},
            _config: mergedConfig
        };

        const diagnostics = {
            _version: 'v1.1-customer-value',
            startDate,
            endDate,
            subsidiaryId,
            queries: {},
            errors: [],
            timings: {}
        };

        try {
            // 0. Get currency info and check for projects
            results.currencyInfo = getCurrencyInfo(subsidiaryId);
            const hasProjects = checkProjectsEnabled();
            results.projectAnalysis.enabled = hasProjects;

            // 0.5 Sanity check - count transactions in date range
            const sanityCheck = runSanityCheck(startDate, endDate, subsidiaryId);
            diagnostics.sanityCheck = sanityCheck;

            // 1. Get base customer transaction data
            const customerDataResult = getCustomerTransactionData(startDate, endDate, subsidiaryId, mergedConfig, diagnostics);
            const customerData = customerDataResult.data;
            results.customerMetrics = customerData;
            diagnostics.queries.customerData = customerDataResult.diagnostic;

            // 2. RFM Segmentation Analysis
            results.rfmSegmentation = analyzeRFMSegmentation(customerData, mergedConfig);

            // 3. Customer Lifetime Value
            results.lifetimeValue = calculateLifetimeValue(customerData, mergedConfig);

            // 4. Profitability Analysis (now includes jobs for project_financials method)
            results.profitability = analyzeProfitability(startDate, endDate, subsidiaryId, mergedConfig, customerData);

            // 5. Churn Risk Analysis
            results.churnRisk = analyzeChurnRisk(customerData, mergedConfig);

            // 6. Revenue Concentration Risk
            results.concentrationRisk = analyzeConcentrationRisk(customerData, mergedConfig);

            // 7. Growth Trends
            results.growthTrends = analyzeGrowthTrends(startDate, endDate, subsidiaryId);

            // 8. Payment Behavior Analysis
            results.paymentBehavior = analyzePaymentBehavior(startDate, endDate, subsidiaryId);

            // 9. Friction Analysis (Returns, Credits - Churn Signals)
            results.frictionAnalysis = analyzeFriction(startDate, endDate, subsidiaryId);

            // 10. Purchase Velocity (Next Order Due)
            results.purchaseVelocity = analyzePurchaseVelocity(customerData, mergedConfig);

            // 11. Cohort Analysis (Retention by Join Year)
            results.cohortAnalysis = analyzeCohorts(startDate, endDate, subsidiaryId);

            // 12. Build Customer Health Scores (now includes friction)
            results.customerHealth = buildCustomerHealthScores(results, mergedConfig);

            // 13. Executive Summary
            results.summary = generateSummary(results, customerData, mergedConfig);

        } catch (e) {
            log.error('CustomerValue Analysis Error', e.message);
            diagnostics.error = e.message;
        }

        results._diagnostics = diagnostics;
        return { results };
    }

    // ==========================================
    // GET CUSTOMER TRANSACTION DATA
    // ==========================================
    function getCustomerTransactionData(startDate, endDate, subsidiaryId, config, diagnostics) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        const topCount = cfg(config, 'topCustomersCount');
        
        const diagnostic = {
            startDate,
            endDate,
            subsidiaryId,
            subFilter,
            rawRowCount: 0,
            processedCount: 0,
            sampleRow: null,
            error: null
        };
        
        // Use foreigntotal for transaction amounts
        // Note: For true multi-currency, would need to join TransactionLine and use line-level amounts
        // T.foreigntotal is transaction currency, T.total is base currency (if available)
        // IMPORTANT: T.entity could be a Job or Customer - use COALESCE with Job.parent to get actual customer
        // Use Customer table to get proper customer name
        const sql = `
            SELECT 
                COALESCE(J.parent, T.entity) AS customer_id,
                COALESCE(C.companyname, C.firstname || ' ' || C.lastname, C.entityid) AS customer_name,
                COUNT(DISTINCT T.id) AS transaction_count,
                COUNT(DISTINCT CASE WHEN T.type = 'CustInvc' THEN T.id END) AS invoice_count,
                COUNT(DISTINCT CASE WHEN T.type = 'SalesOrd' THEN T.id END) AS order_count,
                SUM(ABS(T.foreigntotal)) AS total_revenue,
                AVG(ABS(T.foreigntotal)) AS avg_transaction_value,
                MIN(T.trandate) AS first_transaction,
                MAX(T.trandate) AS last_transaction,
                TRUNC(SYSDATE) - MAX(T.trandate) AS days_since_last,
                MAX(T.trandate) - MIN(T.trandate) AS customer_tenure_days
            FROM Transaction T
            LEFT JOIN Job J ON J.id = T.entity
            LEFT JOIN Customer C ON C.id = COALESCE(J.parent, T.entity)
            WHERE T.type IN ('CustInvc', 'CashSale')
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND T.entity IS NOT NULL
                ${subFilter}
            GROUP BY COALESCE(J.parent, T.entity), COALESCE(C.companyname, C.firstname || ' ' || C.lastname, C.entityid)
            HAVING SUM(ABS(T.foreigntotal)) > 0
            ORDER BY total_revenue DESC
            FETCH FIRST 1000 ROWS ONLY
        `;
        
        diagnostic.sql = sql.replace(/\s+/g, ' ').trim();

        try {
            const rawResults = runSuiteQL(sql);
            diagnostic.rawRowCount = rawResults.length;
            
            if (rawResults.length > 0) {
                diagnostic.sampleRow = rawResults[0];
                diagnostic.columnNames = Object.keys(rawResults[0]);
            }
            
            const processed = rawResults.map(row => {
                // Handle both lowercase and uppercase column names
                const getVal = (key) => row[key] !== undefined ? row[key] : row[key.toUpperCase()];
                
                return {
                    customerId: String(getVal('customer_id')), // Ensure string for consistent lookup
                    customerName: getVal('customer_name') || 'Unknown',
                    transactionCount: parseInt(getVal('transaction_count')) || 0,
                    invoiceCount: parseInt(getVal('invoice_count')) || 0,
                    orderCount: parseInt(getVal('order_count')) || 0,
                    totalRevenue: parseFloat(getVal('total_revenue')) || 0,
                    avgTransactionValue: parseFloat(getVal('avg_transaction_value')) || 0,
                    firstTransaction: getVal('first_transaction'),
                    lastTransaction: getVal('last_transaction'),
                    daysSinceLast: parseInt(getVal('days_since_last')) || 0,
                    tenureDays: parseInt(getVal('customer_tenure_days')) || 0
                };
            });
            
            diagnostic.processedCount = processed.length;
            if (processed.length > 0) {
                diagnostic.sampleProcessed = processed[0];
            }
            
            return { data: processed, diagnostic };
        } catch (e) {
            log.error('Customer Data Error', e.message);
            diagnostic.error = e.message;
            return { data: [], diagnostic };
        }
    }

    // ==========================================
    // RFM SEGMENTATION ANALYSIS
    // ==========================================
    function analyzeRFMSegmentation(customerData, config) {
        if (!customerData || customerData.length === 0) {
            return { segments: {}, customers: [], distribution: {} };
        }

        const recencyGood = cfg(config, 'recencyDaysGood');
        const recencyWarning = cfg(config, 'recencyDaysWarning');
        const recencyCritical = cfg(config, 'recencyDaysCritical');

        // Calculate percentiles for F and M scoring
        const frequencies = customerData.map(c => c.transactionCount).sort((a, b) => a - b);
        const monetaries = customerData.map(c => c.totalRevenue).sort((a, b) => a - b);
        
        const freqP33 = percentile(frequencies, 0.33);
        const freqP66 = percentile(frequencies, 0.66);
        const monP33 = percentile(monetaries, 0.33);
        const monP66 = percentile(monetaries, 0.66);

        const customers = customerData.map(c => {
            // Recency Score (5 = best, 1 = worst)
            let recencyScore = 1;
            if (c.daysSinceLast <= recencyGood) recencyScore = 5;
            else if (c.daysSinceLast <= recencyWarning) recencyScore = 3;
            else if (c.daysSinceLast <= recencyCritical) recencyScore = 2;

            // Frequency Score
            let frequencyScore = 1;
            if (c.transactionCount > freqP66) frequencyScore = 5;
            else if (c.transactionCount > freqP33) frequencyScore = 3;

            // Monetary Score
            let monetaryScore = 1;
            if (c.totalRevenue > monP66) monetaryScore = 5;
            else if (c.totalRevenue > monP33) monetaryScore = 3;

            // RFM Combined Score
            const rfmScore = (recencyScore + frequencyScore + monetaryScore) / 3;
            
            // Segment Assignment - improved logic with 'regular' segment
            let segment = 'regular';  // Default for average customers
            const rfmCode = `${recencyScore}${frequencyScore}${monetaryScore}`;
            
            if (recencyScore >= 4 && frequencyScore >= 4 && monetaryScore >= 4) {
                segment = 'champions';
            } else if (recencyScore >= 3 && frequencyScore >= 3 && monetaryScore >= 4) {
                segment = 'loyal';
            } else if (recencyScore >= 4 && frequencyScore <= 2) {
                segment = 'new';
            } else if (recencyScore >= 3 && monetaryScore >= 3) {
                segment = 'potential';
            } else if (recencyScore <= 2 && frequencyScore >= 3 && monetaryScore >= 3) {
                segment = 'hibernating';
            } else if (recencyScore <= 2 && monetaryScore <= 2) {
                segment = 'lost';
            } else if (recencyScore <= 2 && frequencyScore <= 2) {
                segment = 'at-risk';  // Only truly at-risk: low recency AND low frequency
            }
            // Otherwise stays 'regular' - moderate engagement customers

            return {
                ...c,
                recencyScore,
                frequencyScore,
                monetaryScore,
                rfmScore: Math.round(rfmScore * 10) / 10,
                rfmCode,
                segment
            };
        });

        // Calculate segment distribution
        const segments = {
            champions: customers.filter(c => c.segment === 'champions'),
            loyal: customers.filter(c => c.segment === 'loyal'),
            potential: customers.filter(c => c.segment === 'potential'),
            new: customers.filter(c => c.segment === 'new'),
            regular: customers.filter(c => c.segment === 'regular'),
            hibernating: customers.filter(c => c.segment === 'hibernating'),
            'at-risk': customers.filter(c => c.segment === 'at-risk'),
            lost: customers.filter(c => c.segment === 'lost')
        };

        const distribution = {};
        Object.keys(segments).forEach(seg => {
            const segCustomers = segments[seg];
            distribution[seg] = {
                count: segCustomers.length,
                percentage: Math.round((segCustomers.length / customers.length) * 100),
                totalRevenue: segCustomers.reduce((sum, c) => sum + c.totalRevenue, 0),
                avgRevenue: segCustomers.length > 0 ? 
                    segCustomers.reduce((sum, c) => sum + c.totalRevenue, 0) / segCustomers.length : 0
            };
        });

        return { segments, customers, distribution };
    }

    // ==========================================
    // CUSTOMER LIFETIME VALUE (CLV)
    // ==========================================
    function calculateLifetimeValue(customerData, config) {
        if (!customerData || customerData.length === 0) {
            return { summary: {}, customers: [] };
        }

        const projectionYears = cfg(config, 'clvProjectionYears');
        
        // Calculate overall metrics for CLV model
        const totalCustomers = customerData.length;
        const avgPurchaseValue = customerData.reduce((sum, c) => sum + c.avgTransactionValue, 0) / totalCustomers;
        const avgPurchaseFrequency = customerData.reduce((sum, c) => sum + c.transactionCount, 0) / totalCustomers;
        
        // Average customer lifespan (based on tenure data)
        const avgTenureDays = customerData.reduce((sum, c) => sum + c.tenureDays, 0) / totalCustomers;
        const avgLifespanYears = Math.max(1, avgTenureDays / 365);

        // First pass: calculate CLV for all customers
        let clvData = customerData.map(c => {
            // Individual purchase frequency per year
            const yearsActive = Math.max(0.25, c.tenureDays / 365);
            const purchaseFreqPerYear = c.transactionCount / yearsActive;
            
            // Customer Value = Avg Purchase Value × Purchase Frequency
            const annualValue = c.avgTransactionValue * purchaseFreqPerYear;
            
            // Retention factor based on recency - smooth continuous function
            // Ranges from 0.95 (very recent) to 0.10 (very old)
            // Uses exponential decay: retention = 0.95 * e^(-days/120) with floor of 0.10
            const retentionFactor = Math.max(0.10, Math.min(0.95, 0.95 * Math.exp(-c.daysSinceLast / 120)));

            // Projected CLV = Annual Value × Projected Years × Retention Factor
            const projectedCLV = annualValue * projectionYears * retentionFactor;
            
            return {
                ...c,
                annualValue: Math.round(annualValue),
                projectedCLV: Math.round(projectedCLV),
                historicalCLV: Math.round(c.totalRevenue),
                retentionFactor: Math.round(retentionFactor * 100),
                purchaseFreqPerYear: Math.round(purchaseFreqPerYear * 10) / 10
            };
        });

        // Sort by projected CLV for percentile calculation
        clvData.sort((a, b) => b.projectedCLV - a.projectedCLV);

        // PERCENTILE-BASED TIERS (World Class)
        // Platinum: Top 10%, Gold: Next 20%, Silver: Next 30%, Bronze: Bottom 40%
        const platinumCutoff = Math.ceil(totalCustomers * 0.10);
        const goldCutoff = Math.ceil(totalCustomers * 0.30); // Top 30%
        const silverCutoff = Math.ceil(totalCustomers * 0.60); // Top 60%

        // Assign tiers based on rank
        const customers = clvData.map((c, index) => {
            let tier = 'bronze';
            let clvScore = 0;
            
            if (index < platinumCutoff) {
                tier = 'platinum';
                clvScore = 90 + Math.round((platinumCutoff - index) / platinumCutoff * 10);
            } else if (index < goldCutoff) {
                tier = 'gold';
                clvScore = 70 + Math.round((goldCutoff - index) / (goldCutoff - platinumCutoff) * 20);
            } else if (index < silverCutoff) {
                tier = 'silver';
                clvScore = 40 + Math.round((silverCutoff - index) / (silverCutoff - goldCutoff) * 30);
            } else {
                tier = 'bronze';
                clvScore = Math.round((totalCustomers - index) / (totalCustomers - silverCutoff) * 40);
            }

            return {
                ...c,
                tier,
                clvScore,
                clvRank: index + 1,
                clvPercentile: Math.round((1 - index / totalCustomers) * 100)
            };
        });

        const totalProjectedCLV = customers.reduce((sum, c) => sum + c.projectedCLV, 0);
        const totalHistoricalCLV = customers.reduce((sum, c) => sum + c.historicalCLV, 0);

        // Get tier threshold values for reference
        const tierThresholds = {
            platinum: customers[platinumCutoff - 1]?.projectedCLV || 0,
            gold: customers[goldCutoff - 1]?.projectedCLV || 0,
            silver: customers[silverCutoff - 1]?.projectedCLV || 0
        };

        return {
            summary: {
                totalCustomers,
                avgPurchaseValue: Math.round(avgPurchaseValue),
                avgPurchaseFrequency: Math.round(avgPurchaseFrequency * 10) / 10,
                avgLifespanYears: Math.round(avgLifespanYears * 10) / 10,
                totalProjectedCLV: Math.round(totalProjectedCLV),
                totalHistoricalCLV: Math.round(totalHistoricalCLV),
                avgCLV: Math.round(totalProjectedCLV / totalCustomers),
                projectionYears,
                tierThresholds,
                tierBreakdown: {
                    platinum: customers.filter(c => c.tier === 'platinum').length,
                    gold: customers.filter(c => c.tier === 'gold').length,
                    silver: customers.filter(c => c.tier === 'silver').length,
                    bronze: customers.filter(c => c.tier === 'bronze').length
                }
            },
            customers
        };
    }

    // ==========================================
    // PROFITABILITY ANALYSIS - Multiple Methods
    // ==========================================
    function analyzeProfitability(startDate, endDate, subsidiaryId, config, customerData) {
        const method = cfg(config, 'profitabilityMethod');
        const estimatedMarginPct = cfg(config, 'profitabilityEstimatedMarginPct');
        
        // Method: disabled - return empty
        if (method === 'disabled') {
            return {
                summary: {
                    method: 'disabled',
                    totalRevenue: 0,
                    totalCost: 0,
                    totalGrossProfit: 0,
                    avgMarginPct: 0,
                    customerCount: 0,
                    fakeChampions: 0,
                    highMarginCustomers: 0,
                    lossCustomers: 0,
                    tierBreakdown: { high: 0, medium: 0, low: 0, marginal: 0, loss: 0 }
                },
                customers: []
            };
        }
        
        // Method: estimated - apply fixed margin to customer revenue
        if (method === 'estimated') {
            return calculateEstimatedProfitability(customerData, estimatedMarginPct);
        }
        
        // Method: project_financials (default) - use NetSuite's pre-calculated ProjectFinancials table
        if (method === 'project_financials') {
            const result = calculateProjectFinancialsProfitability(startDate, endDate, subsidiaryId, config);
            
            // If ProjectFinancials returns no data, fallback to gl_rollup
            if (!result.customers || result.customers.length === 0) {
                log.audit('Profitability Fallback', 'ProjectFinancials returned no data, falling back to gl_rollup');
                const fallbackResult = calculateGLRollupProfitability(startDate, endDate, subsidiaryId, config);
                
                // If gl_rollup also fails, fallback to estimated
                if (!fallbackResult.customers || fallbackResult.customers.length === 0) {
                    log.audit('Profitability Fallback', 'GL rollup also returned no data, falling back to estimated margin');
                    const estimatedFallback = calculateEstimatedProfitability(customerData, estimatedMarginPct);
                    estimatedFallback.summary.method = 'estimated_fallback';
                    // Pass through diagnostic from ProjectFinancials attempt
                    estimatedFallback.summary.pfDiagnostic = result.summary ? result.summary.diagnostic : null;
                    return estimatedFallback;
                }
                
                fallbackResult.summary.method = 'gl_rollup_fallback';
                // Pass through diagnostic from ProjectFinancials attempt
                fallbackResult.summary.pfDiagnostic = result.summary ? result.summary.diagnostic : null;
                return fallbackResult;
            }
            
            result.summary.method = 'project_financials';
            return result;
        }
        
        // Method: gl_rollup - query job line data
        const result = calculateGLRollupProfitability(startDate, endDate, subsidiaryId, config);
        
        // If job cost returns no data, fallback to estimated
        if (!result.customers || result.customers.length === 0) {
            log.audit('Profitability Fallback', 'GL rollup returned no data, falling back to estimated margin');
            const fallback = calculateEstimatedProfitability(customerData, estimatedMarginPct);
            fallback.summary.method = 'estimated_fallback';
            return fallback;
        }
        
        result.summary.method = 'gl_rollup';
        return result;
    }
    
    // Estimated Margin Method - applies fixed % to revenue
    function calculateEstimatedProfitability(customerData, marginPct) {
        if (!customerData || customerData.length === 0) {
            return {
                summary: {
                    method: 'estimated',
                    totalRevenue: 0,
                    totalCost: 0,
                    totalGrossProfit: 0,
                    avgMarginPct: marginPct,
                    customerCount: 0,
                    fakeChampions: 0,
                    highMarginCustomers: 0,
                    lossCustomers: 0,
                    tierBreakdown: { high: 0, medium: 0, low: 0, marginal: 0, loss: 0 }
                },
                customers: []
            };
        }
        
        let totalRevenue = 0;
        
        const customers = customerData.map(c => {
            const revenue = parseFloat(c.totalRevenue) || 0;
            const estimatedCost = revenue * (1 - marginPct / 100);
            const estimatedProfit = revenue * (marginPct / 100);
            
            totalRevenue += revenue;
            
            // All customers get same tier based on configured margin
            let profitTier = 'loss';
            if (marginPct >= 40) profitTier = 'high';
            else if (marginPct >= 25) profitTier = 'medium';
            else if (marginPct >= 10) profitTier = 'low';
            else if (marginPct >= 0) profitTier = 'marginal';
            
            return {
                customerId: c.customerId,
                customerName: c.customerName || 'Unknown',
                transactionCount: parseInt(c.transactionCount) || 0,
                totalRevenue: Math.round(revenue),
                totalCost: Math.round(estimatedCost),
                grossProfit: Math.round(estimatedProfit),
                marginPct: marginPct,
                profitTier,
                isFakeChampion: false,
                isEstimated: true
            };
        });
        
        const totalCost = totalRevenue * (1 - marginPct / 100);
        const totalProfit = totalRevenue * (marginPct / 100);
        
        // Get tier for breakdown
        let tierKey = 'loss';
        if (marginPct >= 40) tierKey = 'high';
        else if (marginPct >= 25) tierKey = 'medium';
        else if (marginPct >= 10) tierKey = 'low';
        else if (marginPct >= 0) tierKey = 'marginal';
        
        const tierBreakdown = { high: 0, medium: 0, low: 0, marginal: 0, loss: 0 };
        tierBreakdown[tierKey] = customers.length;
        
        return {
            summary: {
                method: 'estimated',
                totalRevenue: Math.round(totalRevenue),
                totalCost: Math.round(totalCost),
                totalGrossProfit: Math.round(totalProfit),
                avgMarginPct: marginPct,
                customerCount: customers.length,
                fakeChampions: 0,
                highMarginCustomers: tierKey === 'high' ? customers.length : 0,
                lossCustomers: tierKey === 'loss' ? customers.length : 0,
                tierBreakdown
            },
            customers
        };
    }
    
    // Project Financials Method - uses NetSuite's pre-calculated ProjectFinancials table
    // This is the recommended method as it uses NetSuite's built-in project profitability calculations
    // Uses Account type to determine revenue vs costs - no transaction type filtering
    function calculateProjectFinancialsProfitability(startDate, endDate, subsidiaryId, config) {
        const subFilter = subsidiaryId ? `AND PF.subsidiary = ${subsidiaryId}` : '';
        
        // DIAGNOSTIC: Create object to track what's happening
        const diagnostic = {
            method: 'project_financials',
            startDate: startDate,
            endDate: endDate,
            subsidiaryId: subsidiaryId,
            steps: []
        };
        
        // STEP 1: Test basic table access
        try {
            const testSql = `SELECT COUNT(*) AS cnt FROM ProjectFinancials`;
            const testResult = runSuiteQL(testSql);
            diagnostic.steps.push({
                step: 1,
                name: 'Table row count',
                sql: testSql,
                result: testResult,
                success: true
            });
        } catch (e) {
            diagnostic.steps.push({
                step: 1,
                name: 'Table row count',
                error: e.message || String(e),
                success: false
            });
            // Return diagnostic info for debugging
            return { 
                customers: [], 
                summary: { method: 'project_financials', diagnostic: diagnostic }
            };
        }
        
        // STEP 2: Check job created date range
        try {
            const dateSql = `SELECT MIN(J.datecreated) AS min_date, MAX(J.datecreated) AS max_date FROM Job J WHERE J.parent IS NOT NULL`;
            const dateResult = runSuiteQL(dateSql);
            diagnostic.steps.push({
                step: 2,
                name: 'Job created date range',
                sql: dateSql,
                result: dateResult,
                success: true
            });
        } catch (e) {
            diagnostic.steps.push({
                step: 2,
                name: 'Job created date range',
                error: e.message || String(e),
                success: false
            });
        }
        
        // STEP 3: Count jobs created in date range
        try {
            const countSql = `SELECT COUNT(*) AS cnt FROM Job J WHERE J.datecreated >= TO_DATE('${startDate}', 'YYYY-MM-DD') AND J.datecreated <= TO_DATE('${endDate}', 'YYYY-MM-DD') AND J.parent IS NOT NULL`;
            const countResult = runSuiteQL(countSql);
            diagnostic.steps.push({
                step: 3,
                name: 'Jobs created in date range',
                sql: countSql,
                result: countResult,
                success: true
            });
        } catch (e) {
            diagnostic.steps.push({
                step: 3,
                name: 'Jobs created in date range',
                error: e.message || String(e),
                success: false
            });
        }
        
        // STEP 4: Check jobs with parent
        try {
            const jobSql = `SELECT COUNT(DISTINCT PF."PROJECT") AS job_count FROM ProjectFinancials PF INNER JOIN Job J ON J.id = PF."PROJECT" WHERE J.parent IS NOT NULL`;
            const jobResult = runSuiteQL(jobSql);
            diagnostic.steps.push({
                step: 4,
                name: 'Jobs with parent customer',
                sql: jobSql,
                result: jobResult,
                success: true
            });
        } catch (e) {
            diagnostic.steps.push({
                step: 4,
                name: 'Jobs with parent customer',
                error: e.message || String(e),
                success: false
            });
        }
        
        // STEP 5: Sample row from ProjectFinancials
        try {
            const sampleSql = `SELECT PF."PROJECT", PF."ACCOUNT", PF."TRANSACTION", PF.amount, PF."DATE", PF.subsidiary FROM ProjectFinancials PF FETCH FIRST 1 ROWS ONLY`;
            const sampleResult = runSuiteQL(sampleSql);
            diagnostic.steps.push({
                step: 5,
                name: 'Sample row',
                sql: sampleSql,
                result: sampleResult,
                success: true
            });
        } catch (e) {
            diagnostic.steps.push({
                step: 5,
                name: 'Sample row',
                error: e.message || String(e),
                success: false
            });
        }
        
        // Build actual/committed filter based on config
        // Check if any committed cost options are enabled
        const includeCommittedCosts = cfg(config, 'profitIncludePlannedTime') || 
            cfg(config, 'profitIncludePurchaseOrders') || 
            cfg(config, 'profitIncludeExpenseReportsPending') || 
            cfg(config, 'profitIncludeVendorBillsPending') || 
            cfg(config, 'profitIncludeJournalEntriesPending');
        
        // Check if any committed revenue options are enabled  
        const includeCommittedRevenue = cfg(config, 'profitIncludeSalesOrders') || 
            cfg(config, 'profitIncludeCharges');
        
        // Log config for debugging
        diagnostic.profitConfig = {
            includeCommittedCosts: includeCommittedCosts,
            includeCommittedRevenue: includeCommittedRevenue,
            plannedTime: cfg(config, 'profitIncludePlannedTime'),
            purchaseOrders: cfg(config, 'profitIncludePurchaseOrders'),
            expenseReportsPending: cfg(config, 'profitIncludeExpenseReportsPending'),
            vendorBillsPending: cfg(config, 'profitIncludeVendorBillsPending'),
            journalEntriesPending: cfg(config, 'profitIncludeJournalEntriesPending'),
            salesOrders: cfg(config, 'profitIncludeSalesOrders'),
            charges: cfg(config, 'profitIncludeCharges')
        };
        
        // Build the actual filter clause
        let actualFilter;
        if (includeCommittedCosts && includeCommittedRevenue) {
            // Include both actual and committed for all
            actualFilter = '1=1'; // No filter
        } else if (includeCommittedCosts) {
            // Actual for revenue, actual+committed for costs
            actualFilter = `(PF.actual = 'T' OR (PF.actual = 'F' AND A.accttype IN ('COGS', 'Expense', 'OthExpense')))`;
        } else if (includeCommittedRevenue) {
            // Actual for costs, actual+committed for revenue
            actualFilter = `(PF.actual = 'T' OR (PF.actual = 'F' AND A.accttype IN ('Income', 'OthIncome')))`;
        } else {
            // Only actual transactions
            actualFilter = `PF.actual = 'T'`;
        }
        
        // Build SalesOrd exclusion based on config
        const includeSalesOrders = cfg(config, 'profitIncludeSalesOrders');
        const salesOrdFilter = includeSalesOrders ? '' : `AND (T.type IS NULL OR T.type NOT IN ('SalesOrd'))`;
        
        // Main query
        // Filter by job CREATED date to select which jobs are in period
        // But include ALL transactions for those jobs (no date filter on PF)
        // Join Transaction to get type for proper credit handling
        // Only include INACTIVE jobs (complete with all costs/revenue accounted for)
        const sql = `
            SELECT 
                J.parent AS customer_id,
                COALESCE(C.companyname, C.entityid) AS customer_name,
                PF."PROJECT" AS job_id,
                J.entityid AS job_name,
                J.companyname AS job_company,
                J.startdate AS job_start,
                J.projectedenddate AS job_end,
                J.datecreated AS job_created,
                SUM(CASE 
                    WHEN A.accttype IN ('Income', 'OthIncome') 
                        ${salesOrdFilter}
                        THEN PF.amount
                    ELSE 0 
                END) AS rev,
                SUM(CASE 
                    WHEN A.accttype IN ('COGS', 'Expense', 'OthExpense') 
                        THEN PF.amount
                    ELSE 0 
                END) AS cost,
                COUNT(DISTINCT PF."TRANSACTION") AS txn_count
            FROM Job J
            INNER JOIN ProjectFinancials PF ON PF."PROJECT" = J.id
            LEFT JOIN Transaction T ON T.id = PF."TRANSACTION"
            LEFT JOIN Customer C ON C.id = J.parent
            LEFT JOIN Account A ON A.id = PF."ACCOUNT"
            WHERE J.parent IS NOT NULL
                AND J.isinactive = 'T'
                AND ${actualFilter}
                AND J.datecreated >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND J.datecreated <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                ${subFilter}
            GROUP BY J.parent, COALESCE(C.companyname, C.entityid), PF."PROJECT", J.entityid, J.companyname, J.startdate, J.projectedenddate, J.datecreated
            ORDER BY rev DESC
        `;
        
        diagnostic.mainSql = sql.replace(/\s+/g, ' ').trim();

        try {
            const results = runSuiteQL(sql);
            
            diagnostic.steps.push({
                step: 6,
                name: 'Main query',
                rowCount: results.length,
                sampleRow: results.length > 0 ? results[0] : null,
                success: true
            });
            
            log.audit('ProjectFinancials Query', 'Returned ' + results.length + ' job rows');
            
            // Group by customer
            const customerMap = {};
            
            results.forEach(row => {
                const custId = row.customer_id;
                if (!custId) return;
                
                if (!customerMap[custId]) {
                    customerMap[custId] = {
                        customerId: String(custId), // Ensure string for lookup matching
                        customerName: row.customer_name || 'Customer ' + custId,
                        jobs: [],
                        totalRevenue: 0,
                        totalCost: 0,
                        grossProfit: 0,
                        marginPct: 0,
                        jobCount: 0
                    };
                }
                
                // Revenue and costs from ProjectFinancials
                // Credit transactions (CustCred, VendCred) should reduce totals, not add
                const revenueRaw = parseFloat(row.rev) || 0;
                const costsRaw = parseFloat(row.cost) || 0;
                
                // SQL already handles credit transactions (subtracts CustCred/VendCred)
                // So we use the values directly - they can be negative if credits exceed revenue
                const revenue = revenueRaw;
                const costs = costsRaw;
                
                const profit = revenue - costs;
                const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
                
                // Only add jobs with actual data
                if (revenue > 0 || costs > 0) {
                    customerMap[custId].jobs.push({
                        jobId: row.job_id,
                        jobName: row.job_name || row.job_company || 'Job ' + row.job_id,
                        jobStart: row.job_start,
                        jobEnd: row.job_end,
                        revenue: Math.round(revenue),
                        costs: Math.round(costs),
                        profit: Math.round(profit),
                        marginPct: Math.round(margin * 10) / 10,
                        transactionCount: parseInt(row.txn_count) || 0
                    });
                    
                    customerMap[custId].totalRevenue += revenue;
                    customerMap[custId].totalCost += costs;
                    customerMap[custId].jobCount++;
                }
            });
            
            // Calculate customer-level margins and build output
            const customers = Object.values(customerMap).map(c => {
                c.grossProfit = c.totalRevenue - c.totalCost;
                c.marginPct = c.totalRevenue > 0 ? Math.round((c.grossProfit / c.totalRevenue) * 1000) / 10 : 0;
                c.totalRevenue = Math.round(c.totalRevenue);
                c.totalCost = Math.round(c.totalCost);
                c.grossProfit = Math.round(c.grossProfit);
                
                // Profit tier
                let profitTier = 'loss';
                if (c.marginPct >= 40) profitTier = 'high';
                else if (c.marginPct >= 25) profitTier = 'medium';
                else if (c.marginPct >= 10) profitTier = 'low';
                else if (c.marginPct >= 0) profitTier = 'marginal';
                c.profitTier = profitTier;
                
                // Fake champion detection
                c.isFakeChampion = c.totalRevenue > 100000 && c.marginPct < 15;
                c.isEstimated = false;
                
                // Sort jobs by revenue desc
                c.jobs.sort((a, b) => b.revenue - a.revenue);
                
                return c;
            }).filter(c => c.jobCount > 0);
            
            // Sort customers by revenue desc
            customers.sort((a, b) => b.totalRevenue - a.totalRevenue);

            // Calculate totals
            const totalRevenue = customers.reduce((sum, c) => sum + c.totalRevenue, 0);
            const totalCosts = customers.reduce((sum, c) => sum + c.totalCost, 0);
            const totalGrossProfit = totalRevenue - totalCosts;
            const avgMargin = totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0;

            return {
                summary: {
                    method: 'project_financials',
                    totalRevenue: Math.round(totalRevenue),
                    totalCost: Math.round(totalCosts),
                    totalGrossProfit: Math.round(totalGrossProfit),
                    avgMarginPct: Math.round(avgMargin * 10) / 10,
                    customerCount: customers.length,
                    totalJobs: customers.reduce((sum, c) => sum + c.jobCount, 0),
                    fakeChampions: customers.filter(c => c.isFakeChampion).length,
                    highMarginCustomers: customers.filter(c => c.profitTier === 'high').length,
                    lossCustomers: customers.filter(c => c.profitTier === 'loss').length,
                    tierBreakdown: {
                        high: customers.filter(c => c.profitTier === 'high').length,
                        medium: customers.filter(c => c.profitTier === 'medium').length,
                        low: customers.filter(c => c.profitTier === 'low').length,
                        marginal: customers.filter(c => c.profitTier === 'marginal').length,
                        loss: customers.filter(c => c.profitTier === 'loss').length
                    },
                    // Include active config settings for transparency
                    activeConfig: diagnostic.profitConfig
                },
                customers
            };
        } catch (e) {
            diagnostic.steps.push({
                step: 6,
                name: 'Main query',
                error: e.message || String(e),
                success: false
            });
            log.error('ProjectFinancials Profitability Error', e.message);
            return { 
                summary: { 
                    method: 'project_financials',
                    error: e.message,
                    diagnostic: diagnostic  // Include diagnostic on error for debugging
                }, 
                customers: [] 
            };
        }
    }

    // ==========================================
    // JOB PROFITABILITY DETAIL - For Flyout
    // Gets ALL transactions for a job (full costing, no date filter)
    // ==========================================
    function getJobProfitabilityDetail(jobId, config) {
        if (!jobId) return { job: null, transactions: [], summary: {} };
        config = config || {};
        
        try {
            // Get job info with customer name from Customer table
            const jobSql = `
                SELECT 
                    J.id, J.entityid, J.companyname, 
                    J.parent AS customer_id,
                    COALESCE(C.companyname, C.firstname || ' ' || C.lastname, C.entityid) AS customer_name,
                    J.startdate, J.projectedenddate, J.calculatedenddate,
                    J.jobtype, BUILTIN.DF(J.jobtype) AS jobtype_name
                FROM Job J
                LEFT JOIN Customer C ON C.id = J.parent
                WHERE J.id = ${jobId}
            `;
            const jobResults = runSuiteQL(jobSql);
            
            if (jobResults.length === 0) {
                return { job: null, transactions: [], summary: {} };
            }
            
            const jobRow = jobResults[0];
            const job = {
                id: jobRow.id,
                name: jobRow.entityid || jobRow.companyname || 'Job ' + jobRow.id,
                customerId: jobRow.customer_id,
                customerName: jobRow.customer_name || 'Customer ' + jobRow.customer_id,
                startDate: jobRow.startdate,
                endDate: jobRow.projectedenddate || jobRow.calculatedenddate,
                jobType: jobRow.jobtype_name
            };
            
            // Build actual/committed filter based on config (same logic as main query)
            const includeCommittedCosts = cfg(config, 'profitIncludePlannedTime') || 
                cfg(config, 'profitIncludePurchaseOrders') || 
                cfg(config, 'profitIncludeExpenseReportsPending') || 
                cfg(config, 'profitIncludeVendorBillsPending') || 
                cfg(config, 'profitIncludeJournalEntriesPending');
            
            const includeCommittedRevenue = cfg(config, 'profitIncludeSalesOrders') || 
                cfg(config, 'profitIncludeCharges');
            
            let actualFilter;
            if (includeCommittedCosts && includeCommittedRevenue) {
                actualFilter = '1=1';
            } else if (includeCommittedCosts) {
                actualFilter = `(PF.actual = 'T' OR (PF.actual = 'F' AND A.accttype IN ('COGS', 'Expense', 'OthExpense')))`;
            } else if (includeCommittedRevenue) {
                actualFilter = `(PF.actual = 'T' OR (PF.actual = 'F' AND A.accttype IN ('Income', 'OthIncome')))`;
            } else {
                actualFilter = `PF.actual = 'T'`;
            }
            
            // Get ALL transactions for this job from ProjectFinancials
            const txnSql = `
                SELECT 
                    PF."TRANSACTION" AS transaction_id,
                    T.tranid AS tran_number,
                    T.type AS tran_type,
                    TO_CHAR(PF."DATE", 'YYYY-MM-DD') AS tran_date,
                    PF."ACCOUNT" AS account_id,
                    BUILTIN.DF(PF."ACCOUNT") AS account_name,
                    A.accttype AS account_type,
                    A.acctnumber AS account_number,
                    PF.item AS item_id,
                    BUILTIN.DF(PF.item) AS item_name,
                    PF.projecttask AS task_id,
                    BUILTIN.DF(PF.projecttask) AS task_name,
                    PF.amount AS amount,
                    PF.actual AS actual,
                    T.memo AS memo
                FROM ProjectFinancials PF
                LEFT JOIN Transaction T ON T.id = PF."TRANSACTION"
                LEFT JOIN Account A ON A.id = PF."ACCOUNT"
                WHERE PF."PROJECT" = ${jobId}
                    AND ${actualFilter}
                ORDER BY PF."DATE" DESC, A.accttype, ABS(PF.amount) DESC
            `;
            
            const txnResults = runSuiteQL(txnSql);
            
            let totalRevenue = 0;
            let totalCosts = 0;
            
            // Transaction types to EXCLUDE from revenue based on config
            const includeSalesOrders = cfg(config, 'profitIncludeSalesOrders');
            const excludeFromRevenue = includeSalesOrders ? [] : ['SalesOrd'];
            
            // Map and filter to only include revenue/cost transactions (no balance sheet items)
            const transactions = txnResults.map(row => {
                const amount = parseFloat(row.amount) || 0;
                const isIncomeAccount = ['Income', 'OthIncome'].includes(row.account_type);
                const isCostAccount = ['COGS', 'Expense', 'OthExpense'].includes(row.account_type);
                const isExcludedRevenue = excludeFromRevenue.includes(row.tran_type);
                
                // Use signed amounts - positive = adds, negative = subtracts
                // No need to special-case credits, their sign handles it
                let isRevenue = isIncomeAccount && !isExcludedRevenue;
                let isCost = isCostAccount;
                
                // Update totals using signed amounts
                if (isRevenue) totalRevenue += amount;
                if (isCost) totalCosts += amount;
                
                return {
                    transactionId: row.transaction_id,
                    tranNumber: row.tran_number,
                    tranType: row.tran_type || 'N/A',
                    date: row.tran_date,
                    accountId: row.account_id,
                    accountName: row.account_name,
                    accountType: row.account_type,
                    accountNumber: row.account_number,
                    itemId: row.item_id,
                    itemName: row.item_name,
                    taskId: row.task_id,
                    taskName: row.task_name,
                    amount: amount,
                    displayAmount: Math.abs(amount),
                    isRevenue: isRevenue && amount > 0,
                    isCost: isCost && amount > 0,
                    isRevenueCredit: isRevenue && amount < 0,
                    isCostCredit: isCost && amount < 0,
                    actual: row.actual,
                    memo: row.memo
                };
            }).filter(t => t.isRevenue || t.isCost || t.isRevenueCredit || t.isCostCredit);
            
            // Group transactions by account type for summary
            const byAccountType = {};
            transactions.forEach(t => {
                const key = t.accountType || 'Other';
                if (!byAccountType[key]) {
                    byAccountType[key] = { count: 0, total: 0 };
                }
                byAccountType[key].count++;
                byAccountType[key].total += t.displayAmount;
            });
            
            // Group by task
            const byTask = {};
            transactions.forEach(t => {
                const key = t.taskName || 'No Task';
                if (!byTask[key]) {
                    byTask[key] = { revenue: 0, costs: 0, count: 0 };
                }
                byTask[key].count++;
                if (t.isRevenue) byTask[key].revenue += t.displayAmount;
                if (t.isRevenueCredit) byTask[key].revenue -= t.displayAmount;
                if (t.isCost) byTask[key].costs += t.displayAmount;
                if (t.isCostCredit) byTask[key].costs -= t.displayAmount;
            });
            
            const grossProfit = totalRevenue - totalCosts;
            const marginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
            
            return {
                job,
                transactions,
                summary: {
                    totalRevenue: Math.round(totalRevenue),
                    totalCosts: Math.round(totalCosts),
                    grossProfit: Math.round(grossProfit),
                    marginPct: Math.round(marginPct * 10) / 10,
                    transactionCount: transactions.length,
                    byAccountType,
                    byTask
                }
            };
            
        } catch (e) {
            log.error('Job Profitability Detail Error', e.message);
            return { job: null, transactions: [], summary: {}, error: e.message };
        }
    }

    // ==========================================
    // HANDLE REQUEST - For API sub-actions (like SpendVelocity)
    // ==========================================
    function handleRequest(params) {
        const subAction = params.subAction || '';
        
        // Parse config if provided
        let config = {};
        if (params.config) {
            try {
                config = typeof params.config === 'string' ? JSON.parse(params.config) : params.config;
            } catch (e) {
                log.error('Config Parse Error', e.message);
            }
        }
        
        switch (subAction) {
            case 'job_detail':
                return {
                    status: 'success',
                    ...getJobProfitabilityDetail(params.jobId, config)
                };
                
            default:
                return { status: 'error', message: 'Unknown subAction: ' + subAction };
        }
    }

    // ==========================================
    // PROFITABILITY EXPLORATION - Simplified for debugging
    // ==========================================
    function getProfitabilityExploration(startDate, endDate, subsidiaryId) {
        // This is now handled by the main profitability function which includes jobs
        return { deprecated: true, message: 'Use profitability.customers which now includes jobs' };
    }
    
    // GL Rollup Method - sums revenue/cost transactions on jobs, rolls up to customers
    function calculateGLRollupProfitability(startDate, endDate, subsidiaryId, config) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        
        // Roll up job costs to parent customers
        // Revenue: CustInvc, CashSale (minus CustCred)
        // Costs: VendBill, ExpRept, Check, Journal (minus VendCred)
        // Use Customer table for proper customer name
        // Only include INACTIVE jobs (complete with all costs/revenue accounted for)
        const sql = `
            SELECT 
                J.parent AS customer_id,
                COALESCE(C.companyname, C.firstname || ' ' || C.lastname, C.entityid) AS customer_name,
                COUNT(DISTINCT TL.entity) AS job_count,
                SUM(CASE WHEN T.type IN ('CustInvc', 'CashSale') THEN ABS(TL.foreignamount) ELSE 0 END) AS gross_revenue,
                SUM(CASE WHEN T.type = 'CustCred' THEN ABS(TL.foreignamount) ELSE 0 END) AS credits,
                SUM(CASE WHEN T.type IN ('VendBill', 'ExpRept', 'Check', 'Journal') THEN ABS(TL.foreignamount) ELSE 0 END) AS gross_costs,
                SUM(CASE WHEN T.type = 'VendCred' THEN ABS(TL.foreignamount) ELSE 0 END) AS cost_credits
            FROM TransactionLine TL
            JOIN Transaction T ON T.id = TL.transaction
            JOIN Job J ON J.id = TL.entity
            LEFT JOIN Customer C ON C.id = J.parent
            WHERE T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND TL.mainline = 'F'
                AND J.parent IS NOT NULL
                AND J.isinactive = 'T'
                ${subFilter}
            GROUP BY J.parent, COALESCE(C.companyname, C.firstname || ' ' || C.lastname, C.entityid)
            HAVING SUM(CASE WHEN T.type IN ('CustInvc', 'CashSale') THEN ABS(TL.foreignamount) ELSE 0 END) > 0
            ORDER BY gross_revenue DESC
            FETCH FIRST 500 ROWS ONLY
        `;

        try {
            const results = runSuiteQL(sql);
            
            let totalRevenue = 0;
            let totalCosts = 0;
            
            const customers = results.map(row => {
                const grossRevenue = parseFloat(row.gross_revenue) || 0;
                const credits = parseFloat(row.credits) || 0;
                const grossCosts = parseFloat(row.gross_costs) || 0;
                const costCredits = parseFloat(row.cost_credits) || 0;
                
                const netRevenue = grossRevenue - credits;
                const netCosts = grossCosts - costCredits;
                const grossProfit = netRevenue - netCosts;
                const marginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
                
                totalRevenue += netRevenue;
                totalCosts += netCosts;

                // Profit tier classification
                let profitTier = 'loss';
                if (marginPct >= 40) profitTier = 'high';
                else if (marginPct >= 25) profitTier = 'medium';
                else if (marginPct >= 10) profitTier = 'low';
                else if (marginPct >= 0) profitTier = 'marginal';

                // Identify "Fake Champions" - high revenue, low margin
                const isFakeChampion = netRevenue > 100000 && marginPct < 15;

                return {
                    customerId: String(row.customer_id),
                    customerName: row.customer_name || 'Customer ' + row.customer_id,
                    jobCount: parseInt(row.job_count) || 0,
                    totalRevenue: Math.round(netRevenue),
                    totalCost: Math.round(netCosts),
                    grossProfit: Math.round(grossProfit),
                    marginPct: Math.round(marginPct * 10) / 10,
                    profitTier,
                    isFakeChampion,
                    isEstimated: false
                };
            });

            const totalGrossProfit = totalRevenue - totalCosts;
            const avgMargin = totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0;

            return {
                summary: {
                    method: 'gl_rollup',
                    totalRevenue: Math.round(totalRevenue),
                    totalCost: Math.round(totalCosts),
                    totalGrossProfit: Math.round(totalGrossProfit),
                    avgMarginPct: Math.round(avgMargin * 10) / 10,
                    customerCount: customers.length,
                    fakeChampions: customers.filter(c => c.isFakeChampion).length,
                    highMarginCustomers: customers.filter(c => c.profitTier === 'high').length,
                    lossCustomers: customers.filter(c => c.profitTier === 'loss').length,
                    tierBreakdown: {
                        high: customers.filter(c => c.profitTier === 'high').length,
                        medium: customers.filter(c => c.profitTier === 'medium').length,
                        low: customers.filter(c => c.profitTier === 'low').length,
                        marginal: customers.filter(c => c.profitTier === 'marginal').length,
                        loss: customers.filter(c => c.profitTier === 'loss').length
                    }
                },
                customers
            };
        } catch (e) {
            log.error('Job Cost Profitability Error', e.message);
            return { summary: {}, customers: [] };
        }
    }

    // ==========================================
    // FRICTION SCORE - Leading Churn Indicators
    // ==========================================
    function analyzeFriction(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';

        // Count negative interactions: Returns, Credit Memos
        // Rewritten with JOINs and conditional aggregation for performance
        const sql = `
            SELECT 
                C.id AS customer_id,
                C.companyname AS customer_name,
                COUNT(DISTINCT CASE WHEN T.type = 'RtnAuth' THEN T.id END) AS return_count,
                COUNT(DISTINCT CASE WHEN T.type = 'CustCred' THEN T.id END) AS credit_count,
                SUM(CASE WHEN T.type = 'CustCred' THEN ABS(T.foreigntotal) ELSE 0 END) AS credit_value,
                COUNT(DISTINCT CASE WHEN T.type IN ('CustInvc', 'CashSale') THEN T.id END) AS order_count
            FROM Customer C
            INNER JOIN Transaction T ON T.entity = C.id
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND T.type IN ('RtnAuth', 'CustCred', 'CustInvc', 'CashSale')
                ${subFilter}
            WHERE C.isinactive = 'F'
            GROUP BY C.id, C.companyname
            HAVING COUNT(DISTINCT CASE WHEN T.type IN ('CustInvc', 'CashSale') THEN T.id END) > 0
            ORDER BY C.companyname
            FETCH FIRST 500 ROWS ONLY
        `;

        try {
            const results = runSuiteQL(sql);
            
            const customers = results.map(row => {
                const returnCount = parseInt(row.return_count) || 0;
                const creditCount = parseInt(row.credit_count) || 0;
                const creditValue = parseFloat(row.credit_value) || 0;
                const orderCount = parseInt(row.order_count) || 0;
                
                // Friction Score: Higher = More Problems
                // Returns: 3 points each, Credits: 2 points each
                const frictionPoints = (returnCount * 3) + (creditCount * 2);
                
                // Return Rate: % of orders that had issues
                const returnRate = orderCount > 0 ? ((returnCount + creditCount) / orderCount) * 100 : 0;
                
                // Risk Level based on friction
                let frictionLevel = 'low';
                if (frictionPoints >= 10 || returnRate >= 20) frictionLevel = 'critical';
                else if (frictionPoints >= 5 || returnRate >= 10) frictionLevel = 'high';
                else if (frictionPoints >= 2 || returnRate >= 5) frictionLevel = 'medium';

                return {
                    customerId: row.customer_id,
                    customerName: row.customer_name || 'Unknown',
                    returnCount,
                    creditCount,
                    creditValue: Math.round(creditValue),
                    orderCount,
                    frictionPoints,
                    returnRate: Math.round(returnRate * 10) / 10,
                    frictionLevel
                };
            }).filter(c => c.frictionPoints > 0); // Only customers with friction

            // Sort by friction points descending
            customers.sort((a, b) => b.frictionPoints - a.frictionPoints);

            return {
                summary: {
                    totalCustomersWithFriction: customers.length,
                    criticalFriction: customers.filter(c => c.frictionLevel === 'critical').length,
                    highFriction: customers.filter(c => c.frictionLevel === 'high').length,
                    totalReturns: customers.reduce((sum, c) => sum + c.returnCount, 0),
                    totalCredits: customers.reduce((sum, c) => sum + c.creditCount, 0),
                    totalCreditValue: customers.reduce((sum, c) => sum + c.creditValue, 0)
                },
                customers: customers.slice(0, 50) // Top 50 friction customers
            };
        } catch (e) {
            log.error('Friction Analysis Error', e.message);
            return { summary: {}, customers: [] };
        }
    }

    // ==========================================
    // PURCHASE VELOCITY - Next Order Prediction
    // ==========================================
    function analyzePurchaseVelocity(customerData, config) {
        const today = new Date();
        
        const customers = customerData.map(c => {
            // Calculate average days between orders
            const avgDaysBetweenOrders = c.tenureDays > 0 && c.transactionCount > 1 
                ? c.tenureDays / (c.transactionCount - 1) 
                : 30; // Default 30 days if no pattern
            
            // Days since last order
            const daysSinceLast = c.daysSinceLast || 0;
            
            // Expected next order date
            const nextOrderDays = Math.max(0, avgDaysBetweenOrders - daysSinceLast);
            const nextOrderDate = new Date(today);
            nextOrderDate.setDate(nextOrderDate.getDate() + nextOrderDays);
            
            // Overdue calculation
            const daysOverdue = Math.max(0, daysSinceLast - avgDaysBetweenOrders);
            const isOverdue = daysOverdue > 0;
            
            // Urgency level
            let urgency = 'on-track';
            if (daysOverdue > avgDaysBetweenOrders) urgency = 'critical'; // 2x overdue
            else if (daysOverdue > avgDaysBetweenOrders * 0.5) urgency = 'high'; // 1.5x overdue
            else if (daysOverdue > 0) urgency = 'medium';
            else if (nextOrderDays <= 7) urgency = 'due-soon';

            return {
                customerId: c.customerId,
                customerName: c.customerName,
                transactionCount: c.transactionCount,
                totalRevenue: c.totalRevenue,
                avgDaysBetweenOrders: Math.round(avgDaysBetweenOrders),
                daysSinceLast,
                nextOrderDays: Math.round(nextOrderDays),
                daysOverdue: Math.round(daysOverdue),
                isOverdue,
                urgency
            };
        }).filter(c => c.transactionCount >= 2); // Need pattern

        // Sort by urgency (overdue first)
        customers.sort((a, b) => b.daysOverdue - a.daysOverdue);

        return {
            summary: {
                overdueCustomers: customers.filter(c => c.isOverdue).length,
                criticalOverdue: customers.filter(c => c.urgency === 'critical').length,
                dueSoon: customers.filter(c => c.urgency === 'due-soon').length,
                avgOrderCycle: customers.length > 0 
                    ? Math.round(customers.reduce((sum, c) => sum + c.avgDaysBetweenOrders, 0) / customers.length)
                    : 0
            },
            customers: customers.slice(0, 50)
        };
    }

    // ==========================================
    // COHORT ANALYSIS - Retention by Join Year
    // ==========================================
    function analyzeCohorts(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';

        // Get customers grouped by their first order year
        // Resolve Jobs to parent Customers for consistency with main customer query
        const sql = `
            SELECT 
                COALESCE(J.parent, T.entity) AS customer_id,
                COALESCE(C.companyname, C.firstname || ' ' || C.lastname, C.entityid) AS customer_name,
                TO_CHAR(MIN(T.trandate), 'YYYY') AS cohort_year,
                MIN(T.trandate) AS first_order,
                MAX(T.trandate) AS last_order,
                COUNT(DISTINCT T.id) AS total_orders,
                SUM(ABS(T.foreigntotal)) AS lifetime_revenue,
                -- Check if active in last 6 months
                CASE WHEN MAX(T.trandate) >= ADD_MONTHS(SYSDATE, -6) THEN 1 ELSE 0 END AS is_active
            FROM Transaction T
            LEFT JOIN Job J ON J.id = T.entity
            LEFT JOIN Customer C ON C.id = COALESCE(J.parent, T.entity)
            WHERE T.type IN ('CustInvc', 'CashSale')
                AND T.entity IS NOT NULL
                ${subFilter}
            GROUP BY COALESCE(J.parent, T.entity), COALESCE(C.companyname, C.firstname || ' ' || C.lastname, C.entityid)
            HAVING COUNT(DISTINCT T.id) >= 1
            ORDER BY first_order
        `;

        try {
            const results = runSuiteQL(sql);
            
            // Group by cohort year
            const cohorts = {};
            results.forEach(row => {
                const year = row.cohort_year || 'Unknown';
                if (!cohorts[year]) {
                    cohorts[year] = {
                        year,
                        totalCustomers: 0,
                        activeCustomers: 0,
                        totalRevenue: 0,
                        customers: []
                    };
                }
                cohorts[year].totalCustomers++;
                if (parseInt(row.is_active)) cohorts[year].activeCustomers++;
                cohorts[year].totalRevenue += parseFloat(row.lifetime_revenue) || 0;
                cohorts[year].customers.push({
                    customerId: row.customer_id,
                    customerName: row.customer_name,
                    firstOrder: row.first_order,
                    lastOrder: row.last_order,
                    totalOrders: parseInt(row.total_orders) || 0,
                    lifetimeRevenue: parseFloat(row.lifetime_revenue) || 0,
                    isActive: parseInt(row.is_active) === 1
                });
            });

            // Calculate retention rates
            const cohortList = Object.values(cohorts).map(c => ({
                ...c,
                retentionRate: c.totalCustomers > 0 
                    ? Math.round((c.activeCustomers / c.totalCustomers) * 100) 
                    : 0,
                avgRevenue: c.totalCustomers > 0 
                    ? Math.round(c.totalRevenue / c.totalCustomers) 
                    : 0,
                totalRevenue: Math.round(c.totalRevenue)
            })).sort((a, b) => a.year.localeCompare(b.year));

            return {
                summary: {
                    cohortCount: cohortList.length,
                    totalCustomers: results.length,
                    overallRetention: results.length > 0 
                        ? Math.round((results.filter(r => parseInt(r.is_active)).length / results.length) * 100)
                        : 0
                },
                cohorts: cohortList
            };
        } catch (e) {
            log.error('Cohort Analysis Error', e.message);
            return { summary: {}, cohorts: [] };
        }
    }

    // ==========================================
    // CHURN RISK ANALYSIS
    // ==========================================
    function analyzeChurnRisk(customerData, config) {
        if (!customerData || customerData.length === 0) {
            return { summary: {}, customers: [] };
        }

        const highRiskDays = cfg(config, 'churnRiskHighDays');
        const mediumRiskDays = cfg(config, 'churnRiskMediumDays');

        const customers = customerData.map(c => {
            // Calculate churn risk factors
            let riskScore = 0;
            let riskFactors = [];

            // Recency factor (0-40 points)
            if (c.daysSinceLast > highRiskDays) {
                riskScore += 40;
                riskFactors.push('No activity in ' + c.daysSinceLast + ' days');
            } else if (c.daysSinceLast > mediumRiskDays) {
                riskScore += 25;
                riskFactors.push('Declining engagement');
            } else if (c.daysSinceLast > 30) {
                riskScore += 10;
            }

            // Frequency decline (0-30 points)
            // Compare recent frequency to historical
            const avgDaysBetweenTx = c.tenureDays / Math.max(1, c.transactionCount);
            if (c.daysSinceLast > avgDaysBetweenTx * 2) {
                riskScore += 30;
                riskFactors.push('Below typical purchase pattern');
            } else if (c.daysSinceLast > avgDaysBetweenTx * 1.5) {
                riskScore += 15;
            }

            // Low engagement (0-30 points)
            if (c.transactionCount <= 1) {
                riskScore += 30;
                riskFactors.push('Single transaction customer');
            } else if (c.transactionCount <= 3) {
                riskScore += 15;
                riskFactors.push('Low transaction frequency');
            }

            // Cap at 100
            riskScore = Math.min(100, riskScore);

            // Risk level
            let riskLevel = 'low';
            if (riskScore >= 70) riskLevel = 'critical';
            else if (riskScore >= 50) riskLevel = 'high';
            else if (riskScore >= 30) riskLevel = 'medium';

            // Retention probability
            const retentionProbability = Math.max(0, 100 - riskScore);

            return {
                ...c,
                churnRiskScore: riskScore,
                riskLevel,
                riskFactors,
                retentionProbability,
                avgDaysBetweenPurchases: Math.round(avgDaysBetweenTx)
            };
        });

        // Sort by risk score descending
        customers.sort((a, b) => b.churnRiskScore - a.churnRiskScore);

        const atRiskCustomers = customers.filter(c => c.riskLevel === 'high' || c.riskLevel === 'critical');
        const atRiskRevenue = atRiskCustomers.reduce((sum, c) => sum + c.totalRevenue, 0);

        return {
            summary: {
                totalCustomers: customers.length,
                criticalRisk: customers.filter(c => c.riskLevel === 'critical').length,
                highRisk: customers.filter(c => c.riskLevel === 'high').length,
                mediumRisk: customers.filter(c => c.riskLevel === 'medium').length,
                lowRisk: customers.filter(c => c.riskLevel === 'low').length,
                atRiskRevenue: Math.round(atRiskRevenue),
                avgRetentionProbability: Math.round(
                    customers.reduce((sum, c) => sum + c.retentionProbability, 0) / customers.length
                )
            },
            customers
        };
    }

    // ==========================================
    // REVENUE CONCENTRATION RISK
    // ==========================================
    function analyzeConcentrationRisk(customerData, config) {
        if (!customerData || customerData.length === 0) {
            return { summary: {}, customers: [] };
        }

        const hhiWarning = cfg(config, 'hhiWarningThreshold');
        const hhiCritical = cfg(config, 'hhiCriticalThreshold');

        const totalRevenue = customerData.reduce((sum, c) => sum + c.totalRevenue, 0);
        
        // CRITICAL: Sort by revenue descending BEFORE calculating cumulative share
        // Otherwise customersFor80PctRevenue will be wrong
        const sortedData = [...customerData].sort((a, b) => b.totalRevenue - a.totalRevenue);
        
        let hhi = 0;
        let cumulativeShare = 0;
        let top20PctCount = 0;

        const customers = sortedData.map((c, index) => {
            const share = totalRevenue > 0 ? (c.totalRevenue / totalRevenue) : 0;
            const sharePct = share * 100;
            hhi += share * share;
            cumulativeShare += sharePct;

            // Count customers needed for 80% of revenue
            if (cumulativeShare <= 80) {
                top20PctCount = index + 1;
            }

            let concentrationRisk = 'low';
            if (sharePct >= 25) concentrationRisk = 'critical';
            else if (sharePct >= 15) concentrationRisk = 'high';
            else if (sharePct >= 10) concentrationRisk = 'medium';

            return {
                ...c,
                revenueShare: Math.round(sharePct * 100) / 100,
                cumulativeShare: Math.round(cumulativeShare * 10) / 10,
                concentrationRisk,
                rank: index + 1
            };
        });

        // HHI scale (0-10000)
        const hhiScaled = Math.round(hhi * 10000);
        
        let overallRisk = 'low';
        if (hhiScaled >= hhiCritical) overallRisk = 'high';
        else if (hhiScaled >= hhiWarning) overallRisk = 'moderate';

        // Pareto analysis
        const top10Pct = Math.ceil(customers.length * 0.1);
        const top10Revenue = customers.slice(0, top10Pct).reduce((sum, c) => sum + c.totalRevenue, 0);
        const top10Share = (top10Revenue / totalRevenue) * 100;

        return {
            summary: {
                totalCustomers: customers.length,
                totalRevenue: Math.round(totalRevenue),
                herfindahlIndex: hhiScaled,
                riskLevel: overallRisk,
                top10PctShare: Math.round(top10Share),
                customersFor80PctRevenue: top20PctCount,
                topCustomerShare: customers[0]?.revenueShare || 0,
                criticalConcentration: customers.filter(c => c.concentrationRisk === 'critical').length,
                highConcentration: customers.filter(c => c.concentrationRisk === 'high').length
            },
            customers
        };
    }

    // ==========================================
    // GROWTH TRENDS ANALYSIS
    // ==========================================
    function analyzeGrowthTrends(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';

        // Monthly revenue trends - use base currency amounts
        const sql = `
            SELECT 
                TO_CHAR(T.trandate, 'YYYY-MM') AS month,
                COUNT(DISTINCT T.entity) AS unique_customers,
                COUNT(DISTINCT T.id) AS transaction_count,
                SUM(ABS(T.foreigntotal)) AS revenue,
                COUNT(DISTINCT CASE 
                    WHEN NOT EXISTS (
                        SELECT 1 FROM Transaction T2 
                        WHERE T2.entity = T.entity 
                        AND T2.trandate < T.trandate
                        AND T2.type IN ('CustInvc', 'SalesOrd', 'CashSale')
                    ) THEN T.entity 
                END) AS new_customers
            FROM Transaction T
            WHERE T.type IN ('CustInvc', 'CashSale')
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                ${subFilter}
            GROUP BY TO_CHAR(T.trandate, 'YYYY-MM')
            ORDER BY month
        `;

        try {
            const results = runSuiteQL(sql);
            
            // Calculate median revenue to identify "mature" months
            const revenues = results.map(r => parseFloat(r.revenue) || 0).sort((a, b) => a - b);
            const medianRevenue = revenues.length > 0 
                ? revenues[Math.floor(revenues.length / 2)] 
                : 0;
            
            // Minimum threshold: 10% of median to be considered "mature"
            const minRevenueThreshold = medianRevenue * 0.1;
            
            let prevRevenue = null;
            let prevMatureRevenue = null;
            
            const monthly = results.map((row, index) => {
                const revenue = parseFloat(row.revenue) || 0;
                const isMatureMonth = revenue >= minRevenueThreshold;
                
                // Calculate MoM growth rate
                let growthRate = 0;
                if (prevRevenue !== null && prevRevenue > minRevenueThreshold) {
                    growthRate = ((revenue - prevRevenue) / prevRevenue) * 100;
                    // Cap extreme growth rates for display
                    if (growthRate > 200) growthRate = 200;
                    if (growthRate < -80) growthRate = -80;
                } else if (prevRevenue !== null && prevRevenue > 0 && revenue > minRevenueThreshold) {
                    // Previous was startup month, current is mature - mark as "ramp-up"
                    growthRate = null; // Will display as "—" (ramp-up period)
                }
                
                const result = {
                    month: row.month,
                    monthLabel: formatMonth(row.month),
                    uniqueCustomers: parseInt(row.unique_customers) || 0,
                    transactionCount: parseInt(row.transaction_count) || 0,
                    revenue: Math.round(revenue),
                    newCustomers: parseInt(row.new_customers) || 0,
                    growthRate: growthRate !== null ? Math.round(growthRate * 10) / 10 : null,
                    isMatureMonth
                };
                
                prevRevenue = revenue;
                if (isMatureMonth) prevMatureRevenue = revenue;
                return result;
            });

            // Find first "mature" month for meaningful growth calculation
            const matureMonths = monthly.filter(m => m.isMatureMonth);
            const firstMature = matureMonths[0];
            const lastMature = matureMonths[matureMonths.length - 1];
            
            // Calculate YoY growth if we have enough data
            // Need 15 months to compare last 3 months with same period last year
            let yoyGrowth = null;
            if (monthly.length >= 15) {
                const recent3 = monthly.slice(-3).reduce((sum, m) => sum + m.revenue, 0);
                const prior3 = monthly.slice(-15, -12).reduce((sum, m) => sum + m.revenue, 0);
                if (prior3 > minRevenueThreshold) {
                    yoyGrowth = ((recent3 - prior3) / prior3) * 100;
                }
            }
            
            // Total growth from first mature month to last
            const totalGrowth = firstMature && lastMature && firstMature.revenue > 0
                ? ((lastMature.revenue - firstMature.revenue) / firstMature.revenue) * 100
                : 0;

            // Average monthly growth (only mature months)
            const matureGrowthRates = matureMonths
                .filter(m => m.growthRate !== null)
                .map(m => m.growthRate);
            const avgMonthlyGrowth = matureGrowthRates.length > 0
                ? matureGrowthRates.reduce((sum, r) => sum + r, 0) / matureGrowthRates.length
                : 0;

            // Trend analysis: use recent 6 months vs prior 6 months
            let trend = 'stable';
            if (monthly.length >= 6) {
                const recent6 = monthly.slice(-6).reduce((sum, m) => sum + m.revenue, 0) / 6;
                const prior6 = monthly.length >= 12 
                    ? monthly.slice(-12, -6).reduce((sum, m) => sum + m.revenue, 0) / 6
                    : monthly.slice(0, Math.min(6, monthly.length)).reduce((sum, m) => sum + m.revenue, 0) / Math.min(6, monthly.length);
                
                const trendPct = prior6 > 0 ? ((recent6 - prior6) / prior6) * 100 : 0;
                if (trendPct > 10) trend = 'growing';
                else if (trendPct < -10) trend = 'declining';
            }

            return {
                monthly,
                summary: {
                    totalPeriodGrowth: Math.min(500, Math.max(-90, Math.round(totalGrowth))),
                    avgMonthlyGrowth: Math.round(avgMonthlyGrowth * 10) / 10,
                    yoyGrowth: yoyGrowth !== null ? Math.round(yoyGrowth) : null,
                    totalNewCustomers: monthly.reduce((sum, m) => sum + m.newCustomers, 0),
                    peakMonth: monthly.reduce((max, m) => m.revenue > max.revenue ? m : max, monthly[0]),
                    trend,
                    matureMonthCount: matureMonths.length,
                    medianMonthlyRevenue: Math.round(medianRevenue)
                }
            };
        } catch (e) {
            log.error('Growth Trends Error', e.message);
            return { monthly: [], summary: {} };
        }
    }

    // ==========================================
    // PAYMENT BEHAVIOR ANALYSIS
    // ==========================================
    function analyzePaymentBehavior(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';

        const sql = `
            SELECT 
                T.entity AS customer_id,
                BUILTIN.DF(T.entity) AS customer_name,
                COUNT(*) AS invoice_count,
                SUM(CASE WHEN T.status = 'paidInFull' THEN 1 ELSE 0 END) AS paid_count,
                AVG(CASE 
                    WHEN T.trandate IS NOT NULL AND T.closedate IS NOT NULL 
                    THEN T.closedate - T.trandate 
                    ELSE NULL 
                END) AS avg_days_to_pay,
                SUM(CASE WHEN T.duedate < SYSDATE AND T.status != 'paidInFull' THEN 1 ELSE 0 END) AS overdue_count,
                SUM(ABS(T.foreigntotal)) AS total_invoiced
            FROM Transaction T
            WHERE T.type = 'CustInvc'
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND T.entity IS NOT NULL
                ${subFilter}
            GROUP BY T.entity, BUILTIN.DF(T.entity)
            HAVING COUNT(*) >= 1
            ORDER BY total_invoiced DESC
            FETCH FIRST 500 ROWS ONLY
        `;

        try {
            const results = runSuiteQL(sql);
            
            let totalInvoices = 0;
            let totalPaid = 0;
            let totalOverdue = 0;
            
            const customers = results.map(row => {
                const invoiceCount = parseInt(row.invoice_count) || 0;
                const paidCount = parseInt(row.paid_count) || 0;
                const overdueCount = parseInt(row.overdue_count) || 0;
                const avgDaysToPay = parseFloat(row.avg_days_to_pay) || 0;
                
                totalInvoices += invoiceCount;
                totalPaid += paidCount;
                totalOverdue += overdueCount;

                const paymentRate = invoiceCount > 0 ? (paidCount / invoiceCount) * 100 : 0;
                
                // Payment behavior score (0-100)
                let paymentScore = 100;
                if (avgDaysToPay > 60) paymentScore -= 40;
                else if (avgDaysToPay > 30) paymentScore -= 20;
                else if (avgDaysToPay > 15) paymentScore -= 10;
                
                if (overdueCount > 0) {
                    paymentScore -= Math.min(40, overdueCount * 10);
                }
                
                paymentScore = Math.max(0, paymentScore);

                let paymentRating = 'excellent';
                if (paymentScore < 40) paymentRating = 'poor';
                else if (paymentScore < 60) paymentRating = 'fair';
                else if (paymentScore < 80) paymentRating = 'good';

                return {
                    customerId: row.customer_id,
                    customerName: row.customer_name || 'Unknown',
                    invoiceCount,
                    paidCount,
                    overdueCount,
                    avgDaysToPay: Math.round(avgDaysToPay),
                    paymentRate: Math.round(paymentRate),
                    totalInvoiced: parseFloat(row.total_invoiced) || 0,
                    paymentScore,
                    paymentRating
                };
            });

            return {
                summary: {
                    totalInvoices,
                    totalPaid,
                    totalOverdue,
                    paymentRate: totalInvoices > 0 ? Math.round((totalPaid / totalInvoices) * 100) : 0,
                    avgDaysToPay: customers.length > 0 
                        ? Math.round(customers.reduce((sum, c) => sum + c.avgDaysToPay, 0) / customers.length)
                        : 0,
                    excellentPayers: customers.filter(c => c.paymentRating === 'excellent').length,
                    poorPayers: customers.filter(c => c.paymentRating === 'poor').length
                },
                customers
            };
        } catch (e) {
            log.error('Payment Behavior Error', e.message);
            return { summary: {}, customers: [] };
        }
    }

    // ==========================================
    // PROJECT PERFORMANCE ANALYSIS
    // ==========================================
    function analyzeProjectPerformance(startDate, endDate, subsidiaryId, config) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';

        const sql = `
            SELECT 
                J.id AS project_id,
                J.companyname AS project_name,
                J.parent AS customer_id,
                BUILTIN.DF(J.parent) AS customer_name,
                J.startdate AS start_date,
                J.projectedenddate AS projected_end,
                J.calculatedenddate AS actual_end,
                COUNT(DISTINCT T.id) AS transaction_count,
                SUM(ABS(T.foreigntotal)) AS project_revenue
            FROM Job J
            LEFT JOIN Transaction T ON T.entity = J.id
                AND T.type IN ('CustInvc', 'SalesOrd')
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
            WHERE J.isinactive = 'F'
                ${subFilter ? subFilter.replace('T.subsidiary', 'J.subsidiary') : ''}
            GROUP BY J.id, J.companyname, J.parent, BUILTIN.DF(J.parent), 
                     J.startdate, J.projectedenddate, J.calculatedenddate
            ORDER BY project_revenue DESC NULLS LAST
            FETCH FIRST 200 ROWS ONLY
        `;

        try {
            const results = runSuiteQL(sql);
            
            const projects = results.map(row => {
                const revenue = parseFloat(row.project_revenue) || 0;
                return {
                    projectId: row.project_id,
                    projectName: row.project_name || 'Unnamed Project',
                    customerId: row.customer_id,
                    customerName: row.customer_name || 'Unknown',
                    startDate: row.start_date,
                    projectedEnd: row.projected_end,
                    actualEnd: row.actual_end,
                    transactionCount: parseInt(row.transaction_count) || 0,
                    revenue: Math.round(revenue)
                };
            });

            const activeProjects = projects.filter(p => !p.actualEnd);
            const completedProjects = projects.filter(p => p.actualEnd);
            const totalProjectRevenue = projects.reduce((sum, p) => sum + p.revenue, 0);

            // Group by customer
            const customerProjects = {};
            projects.forEach(p => {
                if (!customerProjects[p.customerId]) {
                    customerProjects[p.customerId] = {
                        customerId: p.customerId,
                        customerName: p.customerName,
                        projectCount: 0,
                        totalRevenue: 0
                    };
                }
                customerProjects[p.customerId].projectCount++;
                customerProjects[p.customerId].totalRevenue += p.revenue;
            });

            return {
                enabled: true,
                summary: {
                    totalProjects: projects.length,
                    activeProjects: activeProjects.length,
                    completedProjects: completedProjects.length,
                    totalProjectRevenue: Math.round(totalProjectRevenue),
                    avgProjectRevenue: projects.length > 0 
                        ? Math.round(totalProjectRevenue / projects.length) 
                        : 0,
                    customersWithProjects: Object.keys(customerProjects).length
                },
                projects,
                customerProjects: Object.values(customerProjects).sort((a, b) => b.totalRevenue - a.totalRevenue)
            };
        } catch (e) {
            log.error('Project Analysis Error', e.message);
            return { enabled: true, summary: {}, projects: [], customerProjects: [] };
        }
    }

    // ==========================================
    // CUSTOMER HEALTH SCORES
    // ==========================================
    function buildCustomerHealthScores(results, config) {
        const wRecency = cfg(config, 'weightRecency') / 100;
        const wFrequency = cfg(config, 'weightFrequency') / 100;
        const wMonetary = cfg(config, 'weightMonetary') / 100;
        const wPayment = cfg(config, 'weightPayment') / 100;
        const topCount = cfg(config, 'topCustomersCount');

        // Build lookup maps
        const rfmMap = {};
        (results.rfmSegmentation.customers || []).forEach(c => {
            rfmMap[c.customerId] = c;
        });

        const clvMap = {};
        (results.lifetimeValue.customers || []).forEach(c => {
            clvMap[c.customerId] = c;
        });

        const churnMap = {};
        (results.churnRisk.customers || []).forEach(c => {
            churnMap[c.customerId] = c;
        });

        const paymentMap = {};
        (results.paymentBehavior.customers || []).forEach(c => {
            paymentMap[c.customerId] = c;
        });

        const profitMap = {};
        (results.profitability.customers || []).forEach(c => {
            profitMap[c.customerId] = c;
        });

        const concentrationMap = {};
        (results.concentrationRisk.customers || []).forEach(c => {
            concentrationMap[c.customerId] = c;
        });

        // NEW: Friction map
        const frictionMap = {};
        (results.frictionAnalysis?.customers || []).forEach(c => {
            frictionMap[c.customerId] = c;
        });

        // NEW: Velocity map
        const velocityMap = {};
        (results.purchaseVelocity?.customers || []).forEach(c => {
            velocityMap[c.customerId] = c;
        });

        // Build comprehensive health scores
        const customerMetrics = results.customerMetrics || [];
        
        const healthScores = customerMetrics.map(c => {
            const rfm = rfmMap[c.customerId] || {};
            const clv = clvMap[c.customerId] || {};
            const churn = churnMap[c.customerId] || {};
            const payment = paymentMap[c.customerId] || {};
            const profit = profitMap[c.customerId] || {};
            const concentration = concentrationMap[c.customerId] || {};
            const friction = frictionMap[c.customerId] || {};
            const velocity = velocityMap[c.customerId] || {};

            // Component scores (0-100 scale)
            const recencyScore = (rfm.recencyScore || 3) * 20; // 1-5 -> 20-100
            const frequencyScore = (rfm.frequencyScore || 3) * 20;
            const monetaryScore = (rfm.monetaryScore || 3) * 20;
            const paymentScore = payment.paymentScore !== undefined ? payment.paymentScore : 75;

            // NEW: Friction penalty (reduces health score)
            const frictionPenalty = friction.frictionLevel === 'critical' ? 25 :
                                    friction.frictionLevel === 'high' ? 15 :
                                    friction.frictionLevel === 'medium' ? 8 : 0;

            // Weighted health score with friction penalty
            let healthScore = Math.round(
                (recencyScore * wRecency) +
                (frequencyScore * wFrequency) +
                (monetaryScore * wMonetary) +
                (paymentScore * wPayment)
            );
            
            // Apply friction penalty
            healthScore = Math.max(0, healthScore - frictionPenalty);

            // Health grade
            let healthGrade = 'F';
            if (healthScore >= 90) healthGrade = 'A+';
            else if (healthScore >= 80) healthGrade = 'A';
            else if (healthScore >= 70) healthGrade = 'B';
            else if (healthScore >= 60) healthGrade = 'C';
            else if (healthScore >= 50) healthGrade = 'D';

            // Enhanced recommendation logic
            let recommendation = 'maintain';
            let recommendationDetail = 'Continue current engagement strategy';
            
            // Priority 1: High friction = immediate attention
            if (friction.frictionLevel === 'critical' || friction.frictionLevel === 'high') {
                recommendation = 'resolve-issues';
                recommendationDetail = `High friction: ${friction.returnCount || 0} returns, ${friction.creditCount || 0} credits - Address issues immediately`;
            }
            // Priority 2: Overdue orders = re-engage
            else if (velocity.urgency === 'critical') {
                recommendation = 'reactivate';
                recommendationDetail = `${velocity.daysOverdue} days overdue for order (avg cycle: ${velocity.avgDaysBetweenOrders} days)`;
            }
            // Priority 3: Churn risk
            else if (churn.riskLevel === 'critical' || churn.riskLevel === 'high') {
                recommendation = 'win-back';
                recommendationDetail = 'At risk of churn - immediate outreach needed';
            }
            // Priority 4: High value nurturing
            else if (healthScore >= 85 && (clv.projectedCLV || 0) > 10000) {
                recommendation = 'nurture';
                recommendationDetail = 'High-value customer - prioritize relationship';
            }
            // Priority 5: New customer onboarding
            else if (rfm.segment === 'new') {
                recommendation = 'onboard';
                recommendationDetail = 'New customer - focus on successful onboarding';
            }
            // Priority 6: Low margin issue
            else if (profit.isFakeChampion) {
                recommendation = 'reprice';
                recommendationDetail = `High revenue (${formatCurrency(profit.totalRevenue)}) but low margin (${profit.marginPct}%) - Review pricing`;
            }
            // Priority 7: Low engagement
            else if (healthScore < 50) {
                recommendation = 'review';
                recommendationDetail = 'Low engagement - evaluate account strategy';
            }

            return {
                customerId: c.customerId,
                customerName: c.customerName,
                healthScore,
                healthGrade,
                totalRevenue: c.totalRevenue,
                projectedCLV: clv.projectedCLV || 0,
                clvTier: clv.tier || 'bronze',
                clvRank: clv.clvRank || 0,
                rfmSegment: rfm.segment || 'unknown',
                rfmCode: rfm.rfmCode || '---',
                churnRisk: churn.riskLevel || 'unknown',
                retentionProbability: churn.retentionProbability || 50,
                paymentRating: payment.paymentRating || 'unknown',
                // Profitability
                grossProfit: profit.grossProfit || 0,
                profitMargin: profit.marginPct || 0,
                isFakeChampion: profit.isFakeChampion || false,
                // Friction
                frictionLevel: friction.frictionLevel || 'low',
                frictionPoints: friction.frictionPoints || 0,
                returnCount: friction.returnCount || 0,
                creditCount: friction.creditCount || 0,
                // Velocity
                avgOrderCycle: velocity.avgDaysBetweenOrders || 0,
                daysOverdue: velocity.daysOverdue || 0,
                nextOrderUrgency: velocity.urgency || 'on-track',
                // Other
                revenueShare: concentration.revenueShare || 0,
                daysSinceLast: c.daysSinceLast,
                transactionCount: c.transactionCount,
                recommendation,
                recommendationDetail,
                scoreBreakdown: {
                    recency: { score: recencyScore, weight: Math.round(wRecency * 100) + '%' },
                    frequency: { score: frequencyScore, weight: Math.round(wFrequency * 100) + '%' },
                    monetary: { score: monetaryScore, weight: Math.round(wMonetary * 100) + '%' },
                    payment: { score: paymentScore, weight: Math.round(wPayment * 100) + '%' },
                    frictionPenalty: { score: -frictionPenalty, applied: frictionPenalty > 0 }
                }
            };
        });

        // Sort by health score descending
        healthScores.sort((a, b) => b.healthScore - a.healthScore);

        // Return all customers - UI will handle pagination/display
        return healthScores;
    }

    // ==========================================
    // EXECUTIVE SUMMARY
    // ==========================================
    function generateSummary(results, customerData, config) {
        const wRecency = cfg(config, 'weightRecency') / 100;
        const wFrequency = cfg(config, 'weightFrequency') / 100;
        const wMonetary = cfg(config, 'weightMonetary') / 100;
        const wPayment = cfg(config, 'weightPayment') / 100;

        const rfm = results.rfmSegmentation || {};
        const clv = results.lifetimeValue.summary || {};
        const churn = results.churnRisk.summary || {};
        const concentration = results.concentrationRisk.summary || {};
        const growth = results.growthTrends.summary || {};
        const payment = results.paymentBehavior.summary || {};
        const profit = results.profitability.summary || {};

        const totalCustomers = customerData.length;
        const totalRevenue = customerData.reduce((sum, c) => sum + c.totalRevenue, 0);

        // Calculate Customer Intelligence Score (0-100)
        // championsRatio is a percentage (e.g., 15 = 15% champions)
        // Normalize: 20% champions = 100 score (excellent), 0% = 0 score
        const championsRatio = rfm.distribution?.champions?.percentage || 0;
        const championsScore = Math.min(100, championsRatio * 5);  // 20% = 100
        const retentionHealth = churn.avgRetentionProbability || 50;
        const concentrationHealth = concentration.riskLevel === 'high' ? 30 : 
                                    concentration.riskLevel === 'moderate' ? 60 : 90;
        const paymentHealth = payment.paymentRate || 50;
        
        const intelligenceScore = Math.round(
            (championsScore * 0.3) + 
            (retentionHealth * 0.3) + 
            (concentrationHealth * 0.2) + 
            (paymentHealth * 0.2)
        );

        let scoreLabel = 'Excellent';
        let scoreGrade = 'A';
        if (intelligenceScore < 40) { scoreLabel = 'Needs Attention'; scoreGrade = 'D'; }
        else if (intelligenceScore < 55) { scoreLabel = 'Fair'; scoreGrade = 'C'; }
        else if (intelligenceScore < 70) { scoreLabel = 'Good'; scoreGrade = 'B'; }
        else if (intelligenceScore < 85) { scoreLabel = 'Very Good'; scoreGrade = 'B+'; }

        // Generate insights
        const insights = [];

        // CLV insight
        if (clv.totalProjectedCLV > 0) {
            insights.push({
                type: 'info',
                category: 'lifetime-value',
                title: 'Projected Customer Value',
                message: `${formatCurrency(clv.totalProjectedCLV)} projected CLV over ${clv.projectionYears} years from ${totalCustomers} customers`,
                impact: 'high'
            });
        }

        // Churn risk insight
        const atRiskCount = (churn.criticalRisk || 0) + (churn.highRisk || 0);
        if (atRiskCount > 0) {
            insights.push({
                type: 'warning',
                category: 'churn',
                title: 'Churn Risk Alert',
                message: `${atRiskCount} customers at high/critical churn risk representing ${formatCurrency(churn.atRiskRevenue || 0)} revenue`,
                impact: 'high',
                action: 'Initiate win-back campaigns for at-risk customers'
            });
        }

        // Champions insight
        const championsCount = rfm.distribution?.champions?.count || 0;
        if (championsCount > 0) {
            insights.push({
                type: 'success',
                category: 'segmentation',
                title: 'Champion Customers',
                message: `${championsCount} champion customers generating ${formatCurrency(rfm.distribution?.champions?.totalRevenue || 0)}`,
                impact: 'high',
                action: 'Maintain VIP treatment and referral programs'
            });
        }

        // Concentration risk
        if (concentration.riskLevel === 'high') {
            insights.push({
                type: 'alert',
                category: 'concentration',
                title: 'Revenue Concentration Risk',
                message: `Top customer accounts for ${concentration.topCustomerShare}% of revenue. HHI: ${concentration.herfindahlIndex}`,
                impact: 'high',
                action: 'Diversify customer base to reduce dependency'
            });
        }

        // Growth trend
        if (growth.trend === 'declining') {
            insights.push({
                type: 'warning',
                category: 'growth',
                title: 'Declining Revenue Trend',
                message: `Average monthly growth of ${growth.avgMonthlyGrowth}%`,
                impact: 'high',
                action: 'Review customer acquisition and retention strategies'
            });
        } else if (growth.trend === 'growing') {
            insights.push({
                type: 'success',
                category: 'growth',
                title: 'Strong Growth Trajectory',
                message: `${growth.avgMonthlyGrowth}% average monthly growth with ${growth.totalNewCustomers} new customers`,
                impact: 'medium'
            });
        }

        // Payment issues
        if (payment.totalOverdue > 5) {
            insights.push({
                type: 'warning',
                category: 'payments',
                title: 'Overdue Invoices',
                message: `${payment.totalOverdue} overdue invoices require attention`,
                impact: 'medium',
                action: 'Review collections process and payment terms'
            });
        }

        return {
            totalCustomers,
            totalRevenue: Math.round(totalRevenue),
            intelligenceScore,
            scoreLabel,
            scoreGrade,
            insights,
            kpis: {
                avgCustomerValue: Math.round(totalRevenue / Math.max(1, totalCustomers)),
                projectedCLV: clv.totalProjectedCLV || 0,
                avgCLV: clv.avgCLV || 0,
                championsCount: championsCount,
                atRiskCount: atRiskCount,
                atRiskRevenue: churn.atRiskRevenue || 0,
                retentionRate: churn.avgRetentionProbability || 0,
                paymentRate: payment.paymentRate || 0,
                avgDaysToPay: payment.avgDaysToPay || 0,
                concentrationIndex: concentration.herfindahlIndex || 0,
                top10Share: concentration.top10PctShare || 0,
                monthlyGrowth: growth.avgMonthlyGrowth || 0,
                newCustomers: growth.totalNewCustomers || 0,
                profitMargin: profit.avgMarginPct || 0
            },
            segmentBreakdown: rfm.distribution || {},
            tierBreakdown: clv.tierBreakdown || {},
            weights: {
                recency: cfg(config, 'weightRecency'),
                frequency: cfg(config, 'weightFrequency'),
                monetary: cfg(config, 'weightMonetary'),
                payment: cfg(config, 'weightPayment')
            }
        };
    }

    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================
    function runSanityCheck(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        const result = {
            totalTransactions: 0,
            customerTransactions: 0,
            transactionTypes: {},
            dateRange: { startDate, endDate },
            error: null
        };
        
        try {
            // Count all transactions in range
            const sql1 = `
                SELECT T.type, COUNT(*) AS cnt
                FROM Transaction T
                WHERE T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                  AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                  ${subFilter}
                GROUP BY T.type
            `;
            const typeResults = runSuiteQL(sql1);
            typeResults.forEach(r => {
                const typeName = r.type || r.TYPE || 'Unknown';
                const cnt = parseInt(r.cnt || r.CNT) || 0;
                result.transactionTypes[typeName] = cnt;
                result.totalTransactions += cnt;
            });
            
            // Count customer transactions specifically
            const sql2 = `
                SELECT COUNT(*) AS cnt
                FROM Transaction T
                WHERE T.type IN ('CustInvc', 'CashSale')
                  AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                  AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                  AND T.entity IS NOT NULL
                  ${subFilter}
            `;
            const custResults = runSuiteQL(sql2);
            if (custResults.length > 0) {
                result.customerTransactions = parseInt(custResults[0].cnt || custResults[0].CNT) || 0;
            }
            
            // Check distinct customers (resolved through Job parent like main query)
            const sql3 = `
                SELECT COUNT(DISTINCT COALESCE(J.parent, T.entity)) AS cnt
                FROM Transaction T
                LEFT JOIN Job J ON J.id = T.entity
                WHERE T.type IN ('CustInvc', 'CashSale')
                  AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                  AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                  AND T.entity IS NOT NULL
                  ${subFilter}
            `;
            const distinctResults = runSuiteQL(sql3);
            if (distinctResults.length > 0) {
                result.distinctCustomers = parseInt(distinctResults[0].cnt || distinctResults[0].CNT) || 0;
            }
            
        } catch (e) {
            result.error = e.message;
        }
        
        return result;
    }

    function checkProjectsEnabled() {
        try {
            const sql = `SELECT COUNT(*) AS cnt FROM Job WHERE ROWNUM <= 1`;
            const results = runSuiteQL(sql);
            return results.length > 0;
        } catch (e) {
            return false;
        }
    }

    function getCurrencyInfo(subsidiaryId) {
        if (!subsidiaryId) {
            return { symbol: '$', code: 'USD', name: 'US Dollar' };
        }
        try {
            const sql = `
                SELECT C.symbol, C.name, C.currencycode 
                FROM Subsidiary S 
                INNER JOIN Currency C ON C.id = S.currency 
                WHERE S.id = ${subsidiaryId}
            `;
            const results = runSuiteQL(sql);
            if (results.length > 0) {
                return {
                    symbol: results[0].symbol || '$',
                    code: results[0].currencycode || 'USD',
                    name: results[0].name || 'US Dollar'
                };
            }
        } catch (e) {
            log.debug('Currency lookup failed', e.message);
        }
        return { symbol: '$', code: 'USD', name: 'US Dollar' };
    }

    function getDefaultStartDate() {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1);
        return d.toISOString().split('T')[0];
    }

    function getDefaultEndDate() {
        return new Date().toISOString().split('T')[0];
    }

    function percentile(arr, p) {
        if (!arr || arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.ceil(p * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    function formatMonth(yyyymm) {
        if (!yyyymm) return '';
        const [year, month] = yyyymm.split('-');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[parseInt(month) - 1] + ' ' + year;
    }

    function formatCurrency(num, symbol) {
        var s = symbol || '$';
        var isNegative = num < 0;
        num = Math.abs(num);
        var formatted;
        if (num >= 1000000) formatted = (num / 1000000).toFixed(1) + 'M';
        else if (num >= 1000) formatted = (num / 1000).toFixed(1) + 'K';
        else formatted = Math.round(num).toLocaleString();
        return (isNegative ? '-' : '') + s + formatted;
    }

    function getDefaultConfig() {
        return Object.assign({}, DEFAULTS);
    }

    function getConfigForApi(subsidiaryId) {
        const config = getDefaultConfig();
        
        // Get customer list for exclusion selector
        let customers = [];
        try {
            const customerSql = `
                SELECT 
                    C.id,
                    C.entityid AS name,
                    C.companyname
                FROM Customer C
                WHERE C.isinactive = 'F'
                ORDER BY C.entityid
                FETCH FIRST 500 ROWS ONLY
            `;
            customers = runSuiteQL(customerSql).map(c => ({
                id: c.id,
                name: c.companyname || c.name || 'Customer ' + c.id
            }));
        } catch (e) {
            // Customers optional
        }
        
        return {
            config: config,
            customers: customers
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SCORE-ONLY FUNCTION - Lightweight score computation for dashboard overview
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get customer value score only - minimal queries for fast app load
     * Score based on: customer health distribution, churn risk, payment behavior
     * @returns {Object} { score: 0-100, grade: 'A'-'F', label: string, trend: string }
     */
    function getScoreOnly() {
        try {
            var today = new Date();
            var endDate = today.toISOString().split('T')[0];
            var startDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString().split('T')[0];

            var totalCustomers = 0, activeCustomers = 0, atRiskCustomers = 0;
            var avgDaysToPay = 30, overdueCount = 0;

            // 1. Customer activity and recency (single query)
            try {
                var custSql = "SELECT " +
                    "COUNT(DISTINCT t.entity) as total_customers, " +
                    "COUNT(DISTINCT CASE WHEN TRUNC(SYSDATE) - TRUNC(MAX(t.trandate)) <= 90 THEN t.entity END) as active_customers, " +
                    "COUNT(DISTINCT CASE WHEN TRUNC(SYSDATE) - TRUNC(MAX(t.trandate)) > 180 THEN t.entity END) as at_risk " +
                    "FROM transaction t " +
                    "WHERE t.type IN ('CustInvc', 'SalesOrd') " +
                    "AND t.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
                    "GROUP BY t.entity";
                // Actually run aggregate
                var custSql2 = "SELECT " +
                    "COUNT(DISTINCT entity) as total, " +
                    "SUM(CASE WHEN last_txn <= 90 THEN 1 ELSE 0 END) as active, " +
                    "SUM(CASE WHEN last_txn > 180 THEN 1 ELSE 0 END) as at_risk " +
                    "FROM (SELECT entity, TRUNC(SYSDATE) - TRUNC(MAX(trandate)) as last_txn " +
                    "FROM transaction WHERE type IN ('CustInvc', 'SalesOrd') " +
                    "AND trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') GROUP BY entity)";
                var custResult = runSuiteQL(custSql2);
                if (custResult && custResult.length > 0) {
                    totalCustomers = parseInt(custResult[0].total) || 0;
                    activeCustomers = parseInt(custResult[0].active) || 0;
                    atRiskCustomers = parseInt(custResult[0].at_risk) || 0;
                }
            } catch (e) { log.debug('Customer Query', e.message); }

            // 2. Payment behavior (single query)
            try {
                var pmtSql = "SELECT " +
                    "AVG(TRUNC(t.closedate) - TRUNC(t.trandate)) as avg_days, " +
                    "COUNT(CASE WHEN t.duedate < TRUNC(SYSDATE) AND t.status != 'paidInFull' THEN 1 END) as overdue " +
                    "FROM transaction t " +
                    "WHERE t.type = 'CustInvc' AND t.closedate IS NOT NULL " +
                    "AND t.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD')";
                var pmtResult = runSuiteQL(pmtSql);
                if (pmtResult && pmtResult.length > 0) {
                    avgDaysToPay = parseFloat(pmtResult[0].avg_days) || 30;
                    overdueCount = parseInt(pmtResult[0].overdue) || 0;
                }
            } catch (e) { log.debug('Payment Query', e.message); }

            // Calculate score components
            var score = 100;
            var deductions = { activity: 0, churn: 0, payment: 0 };

            // Activity deduction (max -30)
            var activePct = totalCustomers > 0 ? (activeCustomers / totalCustomers) * 100 : 100;
            if (activePct < 50) deductions.activity = 30;
            else if (activePct < 60) deductions.activity = 20;
            else if (activePct < 70) deductions.activity = 10;
            else if (activePct < 80) deductions.activity = 5;

            // Churn risk deduction (max -30)
            var churnPct = totalCustomers > 0 ? (atRiskCustomers / totalCustomers) * 100 : 0;
            if (churnPct > 30) deductions.churn = 30;
            else if (churnPct > 20) deductions.churn = 20;
            else if (churnPct > 10) deductions.churn = 10;
            else if (churnPct > 5) deductions.churn = 5;

            // Payment behavior deduction (max -25)
            if (avgDaysToPay > 60) deductions.payment = 25;
            else if (avgDaysToPay > 45) deductions.payment = 15;
            else if (avgDaysToPay > 30) deductions.payment = 8;

            score = Math.max(0, 100 - deductions.activity - deductions.churn - deductions.payment);

            var grade = 'A';
            var label = 'Strong';
            if (score < 50) { grade = 'F'; label = 'Critical'; }
            else if (score < 60) { grade = 'D'; label = 'Weak'; }
            else if (score < 70) { grade = 'C'; label = 'Fair'; }
            else if (score < 80) { grade = 'B'; label = 'Good'; }
            else if (score < 90) { grade = 'A'; label = 'Strong'; }
            else { grade = 'A+'; label = 'Excellent'; }

            var trend = 'stable';
            if (churnPct > 20) trend = 'down';
            else if (activePct > 80 && avgDaysToPay < 30) trend = 'up';

            return {
                score: Math.round(score),
                grade: grade,
                label: label,
                trend: trend,
                details: {
                    totalCustomers: totalCustomers,
                    activeCustomers: activeCustomers,
                    atRiskCustomers: atRiskCustomers,
                    avgDaysToPay: Math.round(avgDaysToPay),
                    deductions: deductions
                }
            };
        } catch (e) {
            log.error('CustomerValue getScoreOnly Error', e.message);
            return { score: 70, grade: 'B', label: 'Unknown', trend: 'stable', error: e.message };
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
     * @param {string} [args.period] - 'last_365_days', 'ytd', 'all_time'
     * @param {number} [args.customer_id] - Optional filter to specific customer
     * @param {number} [args.subsidiary] - Optional subsidiary filter
     * @returns {Object} Analysis results from analyzeCustomerValue
     */
    function getData(args) {
        const params = {};
        const today = new Date();

        // Convert period string to startDate/endDate
        switch (args.period) {
            case 'last_365_days':
                params.startDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString().split('T')[0];
                params.endDate = today.toISOString().split('T')[0];
                break;
            case 'all_time':
                // Use a very old start date for "all time"
                params.startDate = '2000-01-01';
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
        if (args.customer_id) {
            params.customerId = args.customer_id;
        }
        if (args.config) {
            params.config = args.config;
        }

        // Call the existing analyze function
        const { results } = analyzeCustomerValue(params);
        return results;
    }

    // ==========================================
    // PUBLIC API
    // ==========================================
    return {
        getData: getData,
        analyze: analyzeCustomerValue,
        getConfig: getConfigForApi,
        getDefaultConfig: getDefaultConfig,
        getProfitabilityExploration: getProfitabilityExploration,
        handleRequest: handleRequest,
        getScoreOnly: getScoreOnly
    };
});