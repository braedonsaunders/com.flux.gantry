/**
 * Lib_Integrity_Data.js
 * Enterprise-Grade Transaction Integrity Analysis Library
 * 
 * WORLD-CLASS FEATURES:
 * - SQL-Based Duplicate Detection (Self-Join for 100k+ rows)
 * - Benford's Law Analysis (First Digit + First-Two Digits 2D)
 * - Relative Size Factor (RSF) - Largest vs 2nd Largest per Vendor
 * - Z-Score per Vendor - Entity-Specific Baselines
 * - Sequential Invoice Detection - Shell Company Indicator
 * - Ghost Vendor Detection - Vendor/Employee Address Match
 * - Weekend Entry Analysis via SQL
 * - Audit Flag Workflow Management
 * 
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/query', 'N/record', 'N/search', 'N/runtime', 'N/format', './Lib_Core', './advisor/Lib_Advisor_Utils'],
function(query, record, search, runtime, format, Core, Utils) {
    'use strict';

    // Use core runQuery
    const runSuiteQL = Core.runQuery;

    // ==========================================
    // CONSTANTS
    // ==========================================
    
    // NetSuite transaction types - include multiple possible values
    // Internal IDs vary by account configuration
    const VENDOR_TRAN_TYPES = "'VendBill', 'VendCred', 'VendPymt', 'Check', 'ExpRept', 'Bill', 'BillPmt', 'CustCred', 'Journal'";
    const VENDOR_TRAN_TYPES_ALT = "'vendorbill', 'vendorcredit', 'vendorpayment', 'check', 'expensereport', 'bill', 'billpayment'";
    
    const DUPLICATE_THRESHOLD_DAYS = 14;
    const DUPLICATE_MIN_AMOUNT = 100;
    const BENFORD_MIN_TRANSACTIONS = 50;
    const HIGH_RISK_AMOUNT = 10000;
    const CRITICAL_RISK_AMOUNT = 25000;
    const Z_SCORE_THRESHOLD = 3;
    const RSF_THRESHOLD = 10;
    const SEQUENTIAL_INVOICE_MIN = 3;
    // Sequential invoice detection - Shell Company Indicator
    // If a vendor's invoices to us are perfectly sequential with NO GAPS over time,
    // it suggests we're their ONLY customer - a key shell company red flag.
    // Same-day sequential invoices are LESS suspicious (normal bulk ordering).
    const SEQUENTIAL_SAME_DAY_THRESHOLD = 1;       // Same day = LOW risk (bulk orders)
    const SEQUENTIAL_MIN_DAYS_FOR_FLAG = 7;        // Need at least 7 days spread to be suspicious
    const SEQUENTIAL_HIGH_RISK_DAYS = 30;          // 30+ days of sequential = HIGH risk (shell company)
    
    // Benford Expected Frequencies - First Digit
    const BENFORD_EXPECTED_1D = {
        1: 0.30103, 2: 0.17609, 3: 0.12494, 4: 0.09691,
        5: 0.07918, 6: 0.06695, 7: 0.05799, 8: 0.05115, 9: 0.04576
    };
    
    // Benford Expected Frequencies - First Two Digits (10-99)
    const BENFORD_EXPECTED_2D = {};
    for (let i = 10; i <= 99; i++) {
        BENFORD_EXPECTED_2D[i] = Math.log10(1 + 1/i);
    }

    // ==========================================
    // MAIN ANALYSIS FUNCTION
    // ==========================================
    
    function analyzeIntegrity(params) {
        // Resolve dates using unified period system
        // Priority: explicit dates > period parameter > default (last_30_days)
        let startDate, endDate;

        if (params.startDate && params.endDate) {
            startDate = params.startDate;
            endDate = params.endDate;
        } else if (params.period) {
            const periodDates = Core.getPeriodDates(params.period, 'last_30_days');
            startDate = periodDates.start;
            endDate = periodDates.end;
        } else {
            // Default to last_30_days for integrity analysis
            const periodDates = Core.getPeriodDates('last_30_days', 'last_30_days');
            startDate = periodDates.start;
            endDate = periodDates.end;
        }

        const subsidiaryId = params.subsidiary || null;
        const config = params.config || getDefaultConfig();
        const debugMode = Utils.isDebugMode();  // Use shared isDebugMode from Lib_Advisor_Utils

        // ENFORCE 30-day maximum date range for performance
        const maxDays = 30;
        const startDt = new Date(startDate);
        const endDt = new Date(endDate);
        const daySpan = Math.ceil((endDt - startDt) / (1000 * 60 * 60 * 24));
        
        if (daySpan > maxDays) {
            // Adjust start date to be maxDays before end
            const newStartDt = new Date(endDt);
            newStartDt.setDate(newStartDt.getDate() - maxDays);
            startDate = newStartDt.toISOString().split('T')[0];
            Utils.auditLog('Integrity Analysis', 'Date range capped from ' + daySpan + ' to ' + maxDays + ' days');
        }

        Utils.auditLog('Integrity Analysis', { startDate, endDate, subsidiaryId, debugMode });
        
        // Diagnostics collector - only populated in debug mode
        const diagnostics = debugMode ? {
            _version: 'v2.5-stable-queries',
            transactionCount: 0,
            vendorTransactionCount: 0,
            errors: [],
            sqlTests: {},
            dateRange: { start: startDate, end: endDate }
        } : null;
        
        // Run diagnostic queries only in debug mode
        if (debugMode) {
            try {
                const anyDataSql = `SELECT MIN(T.trandate) AS min_date, MAX(T.trandate) AS max_date, COUNT(*) AS total FROM Transaction T WHERE T.trandate IS NOT NULL`;
                const anyDataResults = runSuiteQL(anyDataSql);
                if (anyDataResults && anyDataResults.length > 0 && anyDataResults[0]) {
                    diagnostics.dataAvailability = {
                        minDate: anyDataResults[0].min_date,
                        maxDate: anyDataResults[0].max_date,
                        totalTransactions: parseInt(anyDataResults[0].total) || 0
                    };
                }
            } catch (e1) {
                diagnostics.errors.push({ phase: 'dataAvailability', message: e1.message || String(e1) });
            }
        
            try {
                // Now check transactions in the specified date range
                const diagSql = `
                    SELECT T.type, COUNT(*) AS cnt 
                    FROM Transaction T
                    WHERE T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                      AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                    GROUP BY T.type
                    ORDER BY cnt DESC
                `;
                const diagResults = runSuiteQL(diagSql);
                diagnostics.transactionsByType = diagResults || [];
                diagnostics.transactionCount = (diagResults || []).reduce((sum, r) => sum + parseInt(r.cnt || 0), 0);
                
                // Check vendor transactions specifically
                const vendorTypes = ['VendBill', 'VendCred', 'VendPymt', 'Check', 'ExpRept', 
                                     'Bill', 'Vendor Bill', 'Vendor Credit', 'Vendor Payment', 'Expense Report'];
                diagnostics.vendorTransactionCount = (diagResults || [])
                    .filter(r => vendorTypes.some(vt => (r.type || '').toLowerCase().includes(vt.toLowerCase())))
                    .reduce((sum, r) => sum + parseInt(r.cnt || 0), 0);
                    
            } catch (diagErr) {
                diagnostics.errors.push({ phase: 'transactionsByType', message: diagErr.message || String(diagErr) });
            }
            
            // Check what types exist at all in the system
            try {
                const typesSql = `SELECT DISTINCT T.type FROM Transaction T WHERE T.type IS NOT NULL FETCH FIRST 50 ROWS ONLY`;
                const typesResults = runSuiteQL(typesSql);
                diagnostics.availableTypes = (typesResults || []).map(r => r.type);
            } catch (e2) {
                diagnostics.errors.push({ phase: 'availableTypes', message: e2.message || String(e2) });
            }
            
            // Enhanced Weekend Diagnostic - check what day names are returned
            try {
                const weekendDiagSql = `
                    SELECT TRIM(TO_CHAR(T.trandate, 'DAY')) AS day_name, 
                           TO_CHAR(T.trandate, 'D') AS day_num,
                           COUNT(*) AS cnt
                    FROM Transaction T
                    WHERE T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                      AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                      AND T.type IN (${VENDOR_TRAN_TYPES})
                    GROUP BY TRIM(TO_CHAR(T.trandate, 'DAY')), TO_CHAR(T.trandate, 'D')
                    ORDER BY TO_CHAR(T.trandate, 'D')
                `;
                const weekendDiagResults = runSuiteQL(weekendDiagSql);
                diagnostics.dayDistribution = (weekendDiagResults || []).map(r => ({
                    dayName: r.day_name,
                    dayNum: r.day_num,
                    count: parseInt(r.cnt) || 0
                }));
                
                // Check specifically for weekend transactions using day number (1=Sunday, 7=Saturday)
                const weekendCheckSql = `
                    SELECT COUNT(*) AS weekend_count
                    FROM Transaction T
                    WHERE T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                      AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                      AND T.type IN (${VENDOR_TRAN_TYPES})
                      AND TO_CHAR(T.trandate, 'D') IN ('1', '7')
                `;
                const weekendCheckResults = runSuiteQL(weekendCheckSql);
                diagnostics.weekendCheckCount = weekendCheckResults && weekendCheckResults[0] ? parseInt(weekendCheckResults[0].weekend_count) || 0 : 0;
            } catch (e3) {
                diagnostics.errors.push({ phase: 'weekendDiagnostic', message: e3.message || String(e3) });
            }
            
            // RSF and Z-Score diagnostics removed - T.entity field not available in SuiteQL
            
            // Ghost Vendor Diagnostic - check if address tables exist and have data
            try {
                const ghostDiagSql = `
                    SELECT 
                        (SELECT COUNT(*) FROM Vendor WHERE id IS NOT NULL) AS vendor_count,
                        (SELECT COUNT(*) FROM VendorAddressbook WHERE entity IS NOT NULL) AS vendor_addr_count,
                        (SELECT COUNT(DISTINCT entity) FROM VendorAddressbook WHERE entity IS NOT NULL) AS vendor_addr_distinct,
                        (SELECT COUNT(*) FROM Employee WHERE id IS NOT NULL) AS employee_count,
                        (SELECT COUNT(*) FROM EmployeeAddressbook WHERE entity IS NOT NULL) AS employee_addr_count,
                        (SELECT COUNT(DISTINCT entity) FROM EmployeeAddressbook WHERE entity IS NOT NULL) AS employee_addr_distinct
                    FROM DUAL
                `;
                const ghostDiagResults = runSuiteQL(ghostDiagSql);
                if (ghostDiagResults && ghostDiagResults[0]) {
                    const r = ghostDiagResults[0];
                    diagnostics.ghostDiagnostic = {
                        vendorCount: parseInt(r.vendor_count) || 0,
                        vendorAddrCount: parseInt(r.vendor_addr_count) || 0,
                        vendorAddrDistinct: parseInt(r.vendor_addr_distinct) || 0,
                        vendorAddrWithStreet: 0,
                        employeeCount: parseInt(r.employee_count) || 0,
                        employeeAddrCount: parseInt(r.employee_addr_count) || 0,
                        employeeAddrDistinct: parseInt(r.employee_addr_distinct) || 0,
                        employeeAddrWithStreet: 0,
                        possibleTableAliasing: parseInt(r.vendor_addr_count) === parseInt(r.employee_addr_count) && parseInt(r.vendor_addr_count) > 100
                    };
                }
            } catch (e6) {
                diagnostics.errors.push({ phase: 'ghostDiagnostic', message: e6.message || String(e6) });
            }
        }  // End of debugMode block
        
        try {
            const results = {
                meta: {
                    range: { start: startDate, end: endDate },
                    analyzedAt: new Date().toISOString(),
                    daysAnalyzed: daysBetween(startDate, endDate)
                },
                summary: {},
                potentialDuplicates: [],
                benfordAnalysis: null,
                benford2DAnalysis: null,
                weekendEntries: [],
                rsfAnomalies: [],
                zScoreAnomalies: [],
                sequentialInvoices: [],
                ghostVendors: [],
                flaggedTransactions: [],
                vendorRiskAnalysis: [],
                userRiskAnalysis: [],
                existingFlags: [],
                _diagnostics: debugMode ? diagnostics : undefined  // Only include diagnostics in debug mode
            };
            
            // 1. SQL-Based Duplicate Detection
            try {
                results.potentialDuplicates = detectDuplicatesSQL(startDate, endDate, subsidiaryId, config);
                if (diagnostics) diagnostics.sqlTests.duplicates = { success: true, count: results.potentialDuplicates.length };
            } catch (e) {
                if (diagnostics) {
                    diagnostics.errors.push({ phase: 'duplicates', message: e.message });
                    diagnostics.sqlTests.duplicates = { success: false, error: e.message };
                }
            }
            
            // 2. Benford Analysis (1D and 2D)
            try {
                const benfordData = analyzeBenfordSQL(startDate, endDate, subsidiaryId);
                results.benfordAnalysis = benfordData.firstDigit;
                results.benford2DAnalysis = benfordData.firstTwoDigits;
                if (diagnostics) diagnostics.sqlTests.benford = { success: true, has1D: !!benfordData.firstDigit, has2D: !!benfordData.firstTwoDigits };
            } catch (e) {
                if (diagnostics) {
                    diagnostics.errors.push({ phase: 'benford', message: e.message });
                    diagnostics.sqlTests.benford = { success: false, error: e.message };
                }
            }
            
            // 3. Weekend Entries
            try {
                results.weekendEntries = analyzeWeekendSQL(startDate, endDate, subsidiaryId);
                if (diagnostics) diagnostics.sqlTests.weekend = { success: true, count: results.weekendEntries.length };
            } catch (e) {
                if (diagnostics) {
                    diagnostics.errors.push({ phase: 'weekend', message: e.message });
                    diagnostics.sqlTests.weekend = { success: false, error: e.message };
                }
            }
            
            // 4. RSF Analysis
            try {
                results.rsfAnomalies = analyzeRSF(startDate, endDate, subsidiaryId);
                if (diagnostics) diagnostics.sqlTests.rsf = { success: true, count: results.rsfAnomalies.length };
            } catch (e) {
                if (diagnostics) {
                    diagnostics.errors.push({ phase: 'rsf', message: e.message });
                    diagnostics.sqlTests.rsf = { success: false, error: e.message };
                }
            }
            
            // 5. Z-Score Anomalies
            try {
                results.zScoreAnomalies = analyzeZScores(startDate, endDate, subsidiaryId);
                if (diagnostics) diagnostics.sqlTests.zscore = { success: true, count: results.zScoreAnomalies.length };
            } catch (e) {
                if (diagnostics) {
                    diagnostics.errors.push({ phase: 'zscore', message: e.message });
                    diagnostics.sqlTests.zscore = { success: false, error: e.message };
                }
            }
            
            // 6. Sequential Invoices
            try {
                results.sequentialInvoices = detectSequentialInvoices(startDate, endDate, subsidiaryId, config);
                if (diagnostics) diagnostics.sqlTests.sequential = { success: true, count: results.sequentialInvoices.length };
            } catch (e) {
                if (diagnostics) {
                    diagnostics.errors.push({ phase: 'sequential', message: e.message });
                    diagnostics.sqlTests.sequential = { success: false, error: e.message };
                }
            }
            
            // 7. Ghost Vendors
            try {
                results.ghostVendors = detectGhostVendors(subsidiaryId);
                if (diagnostics) diagnostics.sqlTests.ghost = { success: true, count: results.ghostVendors.length };
            } catch (e) {
                if (diagnostics) {
                    diagnostics.errors.push({ phase: 'ghost', message: e.message });
                    diagnostics.sqlTests.ghost = { success: false, error: e.message };
                }
            }
            
            // 8. Audit Trail Analysis - Real System Notes
            try {
                results.auditTrail = analyzeAuditTrail(startDate, endDate, subsidiaryId);
                if (diagnostics) diagnostics.sqlTests.auditTrail = { success: true, count: results.auditTrail.logs ? results.auditTrail.logs.length : 0 };
            } catch (e) {
                if (diagnostics) {
                    diagnostics.errors.push({ phase: 'auditTrail', message: e.message });
                    diagnostics.sqlTests.auditTrail = { success: false, error: e.message };
                }
                results.auditTrail = { logs: [], userAnalysis: [], patterns: [], metrics: {}, summary: {} };
            }
            
            // 9. Enrich with vendor/user names
            try {
                results.weekendEntries = enrichWithNames(results.weekendEntries || [], 'entityId', 'createdById');
                results.rsfAnomalies = enrichWithNames(results.rsfAnomalies || [], 'vendorId', 'createdById');
                results.zScoreAnomalies = enrichWithNames(results.zScoreAnomalies || [], 'vendorId', 'createdById');
                Utils.auditLog('Name Enrichment', {
                    weekend: results.weekendEntries.length,
                    rsf: results.rsfAnomalies.length,
                    zscore: results.zScoreAnomalies.length
                });
            } catch (e) {
                if (diagnostics) {
                    diagnostics.errors.push({ phase: 'nameEnrichment', message: e.message });
                }
            }

            // 9. Aggregate
            results.flaggedTransactions = aggregateFlaggedTransactions(results);
            
            // 10. Risk Analyses
            results.vendorRiskAnalysis = analyzeVendorRisk(results.flaggedTransactions);
            results.userRiskAnalysis = analyzeUserRisk(results.flaggedTransactions);
            
            // 11. Summary
            results.summary = calculateSummary(results);
            
            // 12. AI Context
            results.aiPrepContext = generateAIContext(results);
            
            return results;
            
        } catch (e) {
            log.error('Integrity Analysis Error', e);
            throw e;
        }
    }

    // ==========================================
    // NAME LOOKUP HELPERS
    // ==========================================
    
    function lookupVendorNames(vendorIds) {
        if (!vendorIds || vendorIds.length === 0) return {};
        // Deduplicate using object instead of Set
        var seen = {};
        var uniqueIds = [];
        vendorIds.forEach(function(id) {
            if (id && !seen[id]) { seen[id] = true; uniqueIds.push(id); }
        });
        if (uniqueIds.length === 0) return {};
        
        try {
            const sql = `
                SELECT id, BUILTIN.DF(id) AS name
                FROM Vendor
                WHERE id IN (${uniqueIds.join(',')})
            `;
            const results = runSuiteQL(sql);
            const map = {};
            if (results && Array.isArray(results)) {
                results.forEach(r => { map[r.id] = r.name; });
            }
            return map;
        } catch (e) {
            Utils.debugLog('Vendor lookup failed', e.message);
            return {};
        }
    }

    function lookupUserNames(userIds) {
        if (!userIds || userIds.length === 0) return {};
        // Deduplicate using object instead of Set
        var seen = {};
        var uniqueIds = [];
        userIds.forEach(function(id) {
            if (id && !seen[id]) { seen[id] = true; uniqueIds.push(id); }
        });
        if (uniqueIds.length === 0) return {};
        
        try {
            const sql = `
                SELECT id, BUILTIN.DF(id) AS name
                FROM Employee
                WHERE id IN (${uniqueIds.join(',')})
            `;
            const results = runSuiteQL(sql);
            const map = {};
            if (results && Array.isArray(results)) {
                results.forEach(r => { map[r.id] = r.name; });
            }
            return map;
        } catch (e) {
            Utils.debugLog('User lookup failed', e.message);
            return {};
        }
    }

    function enrichWithNames(items, vendorField, userField) {
        if (!items || items.length === 0) return items;
        
        const vendorIds = items.map(i => i[vendorField]).filter(id => id);
        const userIds = userField ? items.map(i => i[userField]).filter(id => id) : [];
        
        const vendorNames = lookupVendorNames(vendorIds);
        const userNames = userField ? lookupUserNames(userIds) : {};
        
        return items.map(item => {
            const userName = userField && item[userField] ? (userNames[item[userField]] || null) : null;
            // Detect system users by name pattern or missing createdby
            const isSystem = isSystemUser(item[userField], userName);
            
            return {
                ...item,
                vendorName: vendorNames[item[vendorField]] || null,
                createdBy: userName,
                // Update isSystemGenerated based on resolved user name
                isSystemGenerated: item.isSystemGenerated || isSystem
            };
        });
    }

    // ==========================================
    // SQL-BASED DUPLICATE DETECTION
    // CORRECTED: Excludes bill/credit pairs and requires same transaction type
    // ==========================================
    
    function detectDuplicatesSQL(startDate, endDate, subsidiaryId, config) {
        const thresholdDays = config.duplicateThresholdDays || DUPLICATE_THRESHOLD_DAYS;
        const minAmount = config.duplicateMinAmount || DUPLICATE_MIN_AMOUNT;
        
        // Define credit transaction types to exclude from pairing with bills
        const creditTypes = "'VendCred', 'CustCred', 'vendorcredit'";
        const billTypes = "'VendBill', 'Bill', 'vendorbill'";
        
        let sql = `
            SELECT
                t1.id AS id1, t2.id AS id2,
                t1.entity AS vendor_id,
                BUILTIN.DF(t1.entity) AS vendor_name,
                ABS(COALESCE(t1.foreigntotal, 0)) AS amount,
                TO_CHAR(t1.trandate, 'MM/DD/YYYY') AS date1,
                TO_CHAR(t2.trandate, 'MM/DD/YYYY') AS date2,
                t1.tranid AS ref1, t2.tranid AS ref2,
                t1.type AS type1, t2.type AS type2,
                t1.memo AS memo1, t2.memo AS memo2,
                BUILTIN.DF(t1.createdby) AS created_by1,
                BUILTIN.DF(t2.createdby) AS created_by2,
                t1.createdby AS createdbyid1,
                t2.createdby AS createdbyid2,
                ABS(t1.trandate - t2.trandate) AS days_between,
                CASE 
                    WHEN t1.memo = t2.memo AND t1.memo IS NOT NULL THEN 0.95
                    WHEN ABS(t1.trandate - t2.trandate) <= 3 THEN 0.90
                    WHEN ABS(t1.trandate - t2.trandate) <= 7 THEN 0.85
                    ELSE 0.75
                END AS confidence
            FROM Transaction t1
            JOIN Transaction t2 ON t1.entity = t2.entity 
                AND ABS(COALESCE(t1.foreigntotal, 0)) = ABS(COALESCE(t2.foreigntotal, 0))
                AND t1.id < t2.id
                AND t1.type = t2.type
            WHERE t1.type IN (${VENDOR_TRAN_TYPES})
                AND t2.type IN (${VENDOR_TRAN_TYPES})
                AND ABS(t1.trandate - t2.trandate) <= ${thresholdDays}
                AND ABS(COALESCE(t1.foreigntotal, 0)) >= ${minAmount}
                AND t1.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND t1.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND NOT (t1.type IN (${creditTypes}) OR t2.type IN (${creditTypes}))
        `;
        
        if (subsidiaryId) {
            sql += ` AND t1.subsidiary = ${subsidiaryId} AND t2.subsidiary = ${subsidiaryId}`;
        }
        sql += ` ORDER BY amount DESC, days_between ASC`;
        
        try {
            const results = runSuiteQL(sql);
            if (!results || results.length === 0) return [];
            
            return results.map(row => ({
                id1: row.id1, id2: row.id2,
                vendor: row.vendor_name,
                vendorId: row.vendor_id,
                entityId: row.vendor_id,
                entityName: row.vendor_name,
                amount: parseFloat(row.amount) || 0,
                date1: row.date1, date2: row.date2,
                tranId1: row.ref1, tranId2: row.ref2,
                type1: row.type1, type2: row.type2,
                memo: row.memo1 || row.memo2 || '',
                createdBy1: row.created_by1,
                createdBy2: row.created_by2,
                createdById: row.createdbyid1,
                createdBy: row.created_by1,
                daysBetween: parseInt(row.days_between) || 0,
                confidence: parseFloat(row.confidence) || 0.75,
                matchReason: `Same vendor, type (${row.type1}), and amount ($${parseFloat(row.amount).toLocaleString()}), ${row.days_between} days apart`,
                flagType: 'duplicate',
                riskScore: calculateDuplicateRiskScore(row)
            }));
        } catch (e) {
            log.error('Duplicate Detection SQL Error', e);
            return [];
        }
    }
    
    function calculateDuplicateRiskScore(row) {
        let score = 50;
        const amount = parseFloat(row.amount) || 0;
        const days = parseInt(row.days_between) || 0;
        
        if (amount >= CRITICAL_RISK_AMOUNT) score += 25;
        else if (amount >= HIGH_RISK_AMOUNT) score += 15;
        else if (amount >= 1000) score += 5;
        
        if (days <= 1) score += 20;
        else if (days <= 3) score += 15;
        else if (days <= 7) score += 10;
        
        if (row.memo1 && row.memo1 === row.memo2) score += 10;
        
        return Math.min(100, score);
    }

    // ==========================================
    // BENFORD ANALYSIS (1D + 2D)
    // ==========================================
    
    function analyzeBenfordSQL(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        
        // First Digit - use GREATEST of foreigntotal and total for expense reports
        const sql1D = `
            SELECT SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0))), 1, 1) AS first_digit,
                COUNT(*) AS count, SUM(ABS(COALESCE(T.foreigntotal, 0))) AS total_amount
            FROM Transaction T
            WHERE T.type IN (${VENDOR_TRAN_TYPES}) AND ABS(COALESCE(T.foreigntotal, 0)) >= 1
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                ${subFilter}
            GROUP BY SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0))), 1, 1)
            ORDER BY first_digit
        `;
        
        // First Two Digits - use GREATEST of foreigntotal and total for expense reports
        const sql2D = `
            SELECT 
                CASE WHEN ABS(COALESCE(T.foreigntotal, 0)) >= 10 
                    THEN SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0))), 1, 2)
                    WHEN ABS(COALESCE(T.foreigntotal, 0)) >= 1 
                    THEN SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0)) * 10), 1, 2)
                    ELSE NULL
                END AS first_two,
                COUNT(*) AS count, SUM(ABS(COALESCE(T.foreigntotal, 0))) AS total_amount
            FROM Transaction T
            WHERE T.type IN (${VENDOR_TRAN_TYPES}) AND ABS(COALESCE(T.foreigntotal, 0)) >= 1
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                ${subFilter}
            GROUP BY CASE WHEN ABS(COALESCE(T.foreigntotal, 0)) >= 10 
                THEN SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0))), 1, 2)
                WHEN ABS(COALESCE(T.foreigntotal, 0)) >= 1 
                THEN SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0)) * 10), 1, 2)
                ELSE NULL END
            HAVING CASE WHEN ABS(COALESCE(T.foreigntotal, 0)) >= 10 
                THEN SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0))), 1, 2)
                WHEN ABS(COALESCE(T.foreigntotal, 0)) >= 1 
                THEN SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0)) * 10), 1, 2)
                ELSE NULL END IS NOT NULL
        `;
        
        // Flagged transactions for investigation - include IDs for flyout linking
        // Join to TransactionLine to get entity info, use createdby from Transaction
        const sqlFlagged = `
            SELECT T.id, T.tranid, TO_CHAR(T.trandate, 'MM/DD/YYYY') AS trandate, T.type,
                ABS(COALESCE(T.foreigntotal, 0)) AS amount,
                SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0))), 1, 1) AS first_digit,
                CASE WHEN ABS(COALESCE(T.foreigntotal, 0)) >= 10 
                    THEN SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0))), 1, 2)
                    WHEN ABS(COALESCE(T.foreigntotal, 0)) >= 1 
                    THEN SUBSTR(TO_CHAR(ABS(COALESCE(T.foreigntotal, 0)) * 10), 1, 2)
                    ELSE NULL
                END AS first_two,
                TL.entity AS entityid,
                BUILTIN.DF(TL.entity) AS entityname,
                T.createdby AS createdbyid,
                BUILTIN.DF(T.createdby) AS createdby
            FROM Transaction T
            LEFT JOIN TransactionLine TL ON T.id = TL.transaction AND TL.mainline = 'T'
            WHERE T.type IN (${VENDOR_TRAN_TYPES}) AND ABS(COALESCE(T.foreigntotal, 0)) >= 1
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                ${subFilter}
            ORDER BY T.trandate DESC, ABS(COALESCE(T.foreigntotal, 0)) DESC
            FETCH FIRST 1000 ROWS ONLY
        `;
        
        try {
            const results1D = runSuiteQL(sql1D);
            const results2D = runSuiteQL(sql2D);
            
            // Run flagged transactions query - this might have different results than 1D/2D
            let txnData = [];
            try {
                txnData = runSuiteQL(sqlFlagged);
                Utils.debugLog('Benford Flagged Query', { count: (txnData || []).length });
            } catch (flaggedErr) {
                log.error('Benford Flagged SQL Error', flaggedErr.message);
            }
            
            // Process 1D - guard against division by zero
            const total1D = (results1D || []).reduce((s, r) => s + parseInt(r.count || 0), 0);
            const digits1D = [];
            let sumAbsDev1D = 0;
            
            for (let d = 1; d <= 9; d++) {
                const row = (results1D || []).find(r => r.first_digit === String(d));
                const observed = (row && total1D > 0) ? parseInt(row.count) / total1D : 0;
                const expected = BENFORD_EXPECTED_1D[d];
                const deviation = observed - expected;
                const deviationPct = expected > 0 ? (deviation / expected) * 100 : 0;
                sumAbsDev1D += Math.abs(deviation);
                
                digits1D.push({
                    digit: d,
                    count: row ? parseInt(row.count) : 0,
                    amount: row ? parseFloat(row.total_amount) : 0,
                    observed, expected, deviation, deviationPct,
                    isAnomaly: Math.abs(deviationPct) > 25
                });
            }
            const mad1D = sumAbsDev1D / 9;
            
            // Process 2D - guard against division by zero
            const total2D = (results2D || []).reduce((s, r) => s + parseInt(r.count || 0), 0);
            const digits2D = [];
            let sumAbsDev2D = 0;
            const anomalies2D = [];
            
            for (let d = 10; d <= 99; d++) {
                const row = (results2D || []).find(r => parseInt(r.first_two) === d);
                const observed = (row && total2D > 0) ? parseInt(row.count) / total2D : 0;
                const expected = BENFORD_EXPECTED_2D[d];
                const deviation = observed - expected;
                const deviationPct = expected > 0 ? (deviation / expected) * 100 : 0;
                sumAbsDev2D += Math.abs(deviation);
                
                const digit2D = {
                    digits: d,
                    count: row ? parseInt(row.count) : 0,
                    amount: row ? parseFloat(row.total_amount) : 0,
                    observed, expected, deviation, deviationPct,
                    isAnomaly: Math.abs(deviationPct) > 50
                };
                digits2D.push(digit2D);
                
                if (digit2D.isAnomaly && digit2D.count >= 5) {
                    anomalies2D.push(digit2D);
                }
            }
            const mad2D = sumAbsDev2D / 90;
            
            // "Threshold Trap" - amounts ending in 99, 999, 9999 (just under approval limits)
            // This is SEPARATE from Benford's Law analysis
            const thresholdTrapFlags = [];
            txnData.forEach(t => {
                const amount = parseFloat(t.amount) || 0;
                const amountStr = amount.toFixed(2);
                const endsIn99 = amountStr.match(/99\.00$|99\.99$/) !== null;
                const endsIn999 = amountStr.match(/999\.00$|999\.99$/) !== null;
                const endsIn9999 = amountStr.match(/9999\.00$|9999\.99$/) !== null;
                
                if (endsIn99 || endsIn999 || endsIn9999) {
                    thresholdTrapFlags.push({
                        id: t.id,
                        tranId: t.tranid,
                        tranDate: t.trandate,
                        type: t.type,
                        amount: amount,
                        entityId: t.entityid,
                        entityName: t.entityname,
                        createdById: t.createdbyid,
                        createdBy: t.createdby,
                        trapType: endsIn9999 ? '9999' : (endsIn999 ? '999' : '99'),
                        reason: `Amount $${amount.toLocaleString()} ends in ${endsIn9999 ? '9999' : (endsIn999 ? '999' : '99')} (potential threshold avoidance)`,
                        riskScore: endsIn9999 ? 65 : (endsIn999 ? 55 : 45)
                    });
                }
            });
            
            // Benford First-Two-Digit anomalies (for display purposes - not 99 trap)
            const benfordAnomalies2D = digits2D.filter(d => d.isAnomaly && d.count >= 5);
            
            // Build transaction list for drill-down purposes ONLY
            // NOTE: Benford's Law is a dataset-level analysis - individual transactions are NOT flagged
            // These records are for drill-down/investigation context, not risk scoring
            const benfordTransactions = [];

            txnData.forEach(t => {
                const fd = parseInt(t.first_digit);
                const ftd = parseInt(t.first_two);
                const d1 = digits1D.find(x => x.digit === fd);
                const d2 = digits2D.find(x => x.digits === ftd);

                // Track which digit category this transaction falls into (for drill-down grouping)
                const digitDeviates1D = d1 && d1.isAnomaly;
                const digitDeviates2D = d2 && d2.isAnomaly;

                // Include ALL transactions so users can drill down on any digit
                benfordTransactions.push({
                    id: t.id,
                    tranId: t.tranid,
                    tranDate: t.trandate,
                    type: t.type,
                    amount: parseFloat(t.amount) || 0,
                    firstDigit: fd,
                    firstTwoDigits: ftd,
                    entityId: t.entityid,
                    entityName: t.entityname,
                    vendorId: t.entityid,
                    createdById: t.createdbyid,
                    createdBy: t.createdby,
                    // Context info for drill-down - NOT a flag on the transaction itself
                    digitDeviates: digitDeviates1D || digitDeviates2D,
                    digitContext: digitDeviates1D || digitDeviates2D
                        ? (digitDeviates2D
                            ? `Digit pair ${ftd} deviates ${Math.abs(d2.deviationPct).toFixed(0)}% from expected`
                            : `Digit ${fd} deviates ${Math.abs(d1.deviationPct).toFixed(0)}% from expected`)
                        : `Within expected Benford distribution`
                });
            });
            
            // Investigation stats empty until we can query entity/user data separately
            const topVendors = [];
            const topUsers = [];
            const topAccounts = [];
            
            return {
                firstDigit: {
                    totalTransactions: total1D,
                    digits: digits1D,
                    meanAbsoluteDeviation: mad1D,
                    conformityLevel: getConformityLevel(mad1D),
                    message: getBenfordMessage(mad1D, total1D),
                    topVendors, topUsers, topAccounts,
                    // Renamed: these are for drill-down, NOT flagged transactions
                    drillDownTransactions: benfordTransactions.slice(0, 500),
                    // Legacy alias for backward compatibility with frontend
                    flaggedTransactions: benfordTransactions.slice(0, 500),
                    _debug: {
                        txnDataCount: txnData.length,
                        drillDownCount: benfordTransactions.length,
                        deviatingDigitCount: benfordTransactions.filter(t => t.digitDeviates).length
                    }
                },
                firstTwoDigits: {
                    totalTransactions: total2D,
                    digits: digits2D,
                    anomalies: benfordAnomalies2D.sort((a,b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct)),
                    thresholdTrapFlags: thresholdTrapFlags.slice(0, 100),
                    meanAbsoluteDeviation: mad2D,
                    conformityLevel: getConformityLevel2D(mad2D),
                    approvalLimitRisk: thresholdTrapFlags.length > 0
                }
            };
        } catch (e) {
            log.error('Benford SQL Error', e);
            return { firstDigit: null, firstTwoDigits: null };
        }
    }
    
    function getConformityLevel(mad) {
        if (mad <= 0.006) return 'Excellent';
        if (mad <= 0.012) return 'Acceptable';
        if (mad <= 0.015) return 'Marginal';
        return 'Non-Conforming';
    }
    
    function getConformityLevel2D(mad) {
        if (mad <= 0.0012) return 'Excellent';
        if (mad <= 0.0022) return 'Acceptable';
        if (mad <= 0.0033) return 'Marginal';
        return 'Non-Conforming';
    }
    
    function getBenfordMessage(mad, count) {
        if (count < BENFORD_MIN_TRANSACTIONS) {
            return `Insufficient data (${count} transactions). Need at least ${BENFORD_MIN_TRANSACTIONS}.`;
        }
        if (mad <= 0.006) return 'Transaction amounts closely follow Benford\'s Law - low manipulation risk.';
        if (mad <= 0.012) return 'Transaction amounts reasonably follow Benford\'s Law.';
        if (mad <= 0.015) return 'Some deviation detected - warrants review.';
        return 'Significant deviation - possible manipulation.';
    }

    // ==========================================
    // WEEKEND ANALYSIS
    // ==========================================
    
    // System user patterns - transactions created by these are likely automated
    const SYSTEM_USER_PATTERNS = ['system', 'script', 'workflow', 'scheduled', 'integration', 'api', 'sync', 'import', 'batch', 'automated', 'cron', 'job'];
    
    function isSystemUser(userId, userName) {
        // No user = system generated
        if (!userId) return true;
        
        // Check user name against system patterns
        if (userName) {
            const lowerName = userName.toLowerCase();
            return SYSTEM_USER_PATTERNS.some(pattern => lowerName.indexOf(pattern) >= 0);
        }
        
        return false;
    }
    
    function analyzeWeekendSQL(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        
        // CORRECTED: Use numeric day (D format: 1=Sunday, 7=Saturday in Oracle default)
        // Also keep name-based detection as fallback for different NLS settings
        const sql = `
            SELECT T.id, T.tranid, TO_CHAR(T.trandate, 'MM/DD/YYYY') AS trandate, T.type,
                ABS(COALESCE(T.foreigntotal, 0)) AS amount,
                UPPER(TRIM(TO_CHAR(T.trandate, 'DY'))) AS day_name,
                TO_CHAR(T.trandate, 'D') AS day_num,
                T.createdby AS createdbyid,
                BUILTIN.DF(T.createdby) AS createdby
            FROM Transaction T
            WHERE T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND T.type IN (${VENDOR_TRAN_TYPES})
                AND (
                    TO_CHAR(T.trandate, 'D') IN ('1', '7')
                    OR UPPER(TRIM(TO_CHAR(T.trandate, 'DY'))) IN ('SAT', 'SUN', 'SA', 'SO', 'SÁ', 'DO')
                    OR UPPER(TRIM(TO_CHAR(T.trandate, 'DAY'))) LIKE '%SAT%'
                    OR UPPER(TRIM(TO_CHAR(T.trandate, 'DAY'))) LIKE '%SUN%'
                )
                ${subFilter}
            ORDER BY T.trandate DESC
        `;
        
        try {
            const weekendResults = runSuiteQL(sql);
            const fetchedCount = weekendResults ? weekendResults.length : 0;
            Utils.auditLog('Weekend Analysis', {
                phase: 'fetch',
                fetchedCount: fetchedCount
            });
            
            if (!weekendResults || weekendResults.length === 0) {
                return [];
            }
            
            return weekendResults.map(row => {
                const amount = parseFloat(row.amount) || 0;
                const dayNum = row.day_num;
                const dayName = (row.day_name || '').toUpperCase();
                
                // Use numeric day as primary, fall back to name
                const isSunday = dayNum === '1' || dayName.includes('SUN') || dayName === 'SO' || dayName === 'DO';
                const dayType = isSunday ? 'Sunday' : 'Saturday';
                
                let score = 35;
                if (amount >= CRITICAL_RISK_AMOUNT) score += 30;
                else if (amount >= HIGH_RISK_AMOUNT) score += 20;
                if (isSunday) score += 10;
                
                return {
                    id: row.id, tranId: row.tranid, tranDate: row.trandate, type: row.type,
                    amount, dayType: dayType, dayName: row.day_name,
                    createdById: row.createdbyid,
                    createdBy: row.createdby || (row.createdbyid ? 'User #' + row.createdbyid : 'Unknown'),
                    flagType: 'weekend',
                    reason: `Transaction on ${dayType}`,
                    riskScore: Math.min(100, score)
                };
            });
        } catch (e) {
            log.error('Weekend SQL Error', { message: e.message, name: e.name });
            return [];
        }
    }

    // ==========================================
    // RSF ANALYSIS - CORRECTED: Per-Vendor Calculation
    // RSF = Largest Transaction / Second Largest Transaction (per vendor)
    // Uses batch processing to avoid row limits
    // ==========================================
    
    function analyzeRSF(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        
        try {
            // Get transactions in the date range with entity info
            const sqlDateRange = `
                SELECT T.id, T.tranid, TO_CHAR(T.trandate, 'MM/DD/YYYY') AS trandate, T.type,
                    ABS(COALESCE(T.foreigntotal, 0)) AS amount,
                    TL.entity AS entityid,
                    BUILTIN.DF(TL.entity) AS entityname,
                    T.createdby AS createdbyid,
                    BUILTIN.DF(T.createdby) AS createdby
                FROM Transaction T
                LEFT JOIN TransactionLine TL ON T.id = TL.transaction AND TL.mainline = 'T'
                WHERE T.type IN (${VENDOR_TRAN_TYPES}) 
                    AND ABS(COALESCE(T.foreigntotal, 0)) > 0
                    AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                    AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                    ${subFilter}
                ORDER BY TL.entity, ABS(COALESCE(T.foreigntotal, 0)) DESC
            `;
            
            const dateRangeResults = runSuiteQL(sqlDateRange);
            Utils.auditLog('RSF Analysis', { phase: 'fetch_date_range', count: dateRangeResults ? dateRangeResults.length : 0 });
            
            if (!dateRangeResults || dateRangeResults.length === 0) return [];
            
            // Get unique vendor IDs
            const vendorIds = [...new Set(dateRangeResults.map(r => r.entityid).filter(Boolean))];
            if (vendorIds.length === 0) return [];
            
            // Get baseline stats per vendor - process one vendor at a time to get accurate top 2
            const vendorBaselines = {};
            
            // Process in batches
            const batchSize = 20;
            for (let i = 0; i < vendorIds.length; i += batchSize) {
                const batch = vendorIds.slice(i, i + batchSize);
                
                for (const vendorId of batch) {
                    // Get top 5 amounts for this vendor (enough to find 2nd largest reliably)
                    const sqlTop = `
                        SELECT ABS(COALESCE(T.foreigntotal, 0)) AS amount
                        FROM Transaction T
                        LEFT JOIN TransactionLine TL ON T.id = TL.transaction AND TL.mainline = 'T'
                        WHERE T.type IN (${VENDOR_TRAN_TYPES}) 
                            AND ABS(COALESCE(T.foreigntotal, 0)) > 0
                            AND TL.entity = '${vendorId}'
                            AND T.trandate >= ADD_MONTHS(SYSDATE, -36)
                            ${subFilter}
                        ORDER BY ABS(COALESCE(T.foreigntotal, 0)) DESC
                        FETCH FIRST 5 ROWS ONLY
                    `;
                    
                    try {
                        const topResults = runSuiteQL(sqlTop);
                        if (topResults && topResults.length >= 2) {
                            const amounts = topResults.map(r => parseFloat(r.amount) || 0);
                            vendorBaselines[vendorId] = {
                                largest: amounts[0],
                                secondLargest: amounts[1],
                                count: topResults.length
                            };
                        }
                    } catch (e) {
                        // Skip this vendor on error
                        Utils.debugLog('RSF vendor query error', { vendorId, error: e.message });
                    }
                }
            }

            Utils.auditLog('RSF Analysis', { phase: 'baselines_built', vendorCount: Object.keys(vendorBaselines).length });
            
            // Group date range transactions by vendor
            const vendorGroups = {};
            dateRangeResults.forEach(row => {
                const vendorId = row.entityid || 'unknown';
                if (!vendorGroups[vendorId]) {
                    vendorGroups[vendorId] = {
                        vendorId: row.entityid,
                        vendorName: row.entityname || 'Unknown',
                        transactions: []
                    };
                }
                vendorGroups[vendorId].transactions.push({
                    id: row.id,
                    tranId: row.tranid,
                    tranDate: row.trandate,
                    type: row.type,
                    amount: parseFloat(row.amount) || 0,
                    createdById: row.createdbyid,
                    createdBy: row.createdby
                });
            });
            
            const anomalies = [];
            
            // Check each transaction against vendor's historical baseline
            Object.values(vendorGroups).forEach(group => {
                const baseline = vendorBaselines[group.vendorId];
                if (!baseline || baseline.secondLargest <= 0) return;
                
                group.transactions.forEach(txn => {
                    // RSF = this transaction / vendor's historical 2nd largest
                    const rsf = txn.amount / baseline.secondLargest;
                    
                    // Only flag if RSF exceeds threshold
                    if (rsf >= RSF_THRESHOLD) {
                        let riskScore = 40;
                        if (rsf >= 50) riskScore += 40;
                        else if (rsf >= 20) riskScore += 30;
                        else if (rsf >= 15) riskScore += 20;
                        else riskScore += 10;
                        
                        if (txn.amount >= CRITICAL_RISK_AMOUNT) riskScore += 15;
                        else if (txn.amount >= HIGH_RISK_AMOUNT) riskScore += 10;
                        
                        anomalies.push({
                            id: txn.id,
                            tranId: txn.tranId,
                            tranDate: txn.tranDate,
                            type: txn.type,
                            largestAmount: txn.amount,
                            secondLargestAmount: baseline.secondLargest,
                            rsf: rsf,
                            tranCount: baseline.count,
                            avgAmount: (baseline.largest + baseline.secondLargest) / 2,
                            vendorId: group.vendorId,
                            vendorName: group.vendorName,
                            entityId: group.vendorId,
                            entityName: group.vendorName,
                            createdById: txn.createdById,
                            createdBy: txn.createdBy,
                            reason: `Transaction ${rsf.toFixed(1)}x larger than historical 2nd largest for ${group.vendorName}`,
                            flagType: 'rsf',
                            riskScore: Math.min(100, riskScore)
                        });
                    }
                });
            });

            Utils.auditLog('RSF Analysis', {
                phase: 'complete',
                vendorGroups: Object.keys(vendorGroups).length,
                anomaliesFound: anomalies.length
            });
            
            return anomalies.sort((a, b) => b.rsf - a.rsf).slice(0, 50);
        } catch (e) {
            log.error('RSF Error', { message: e.message, name: e.name });
            return [];
        }
    }

    // ==========================================
    // Z-SCORE ANALYSIS
    // Uses batch queries per vendor to get historical data and calculate stats in JS
    // ==========================================
    
    function analyzeZScores(startDate, endDate, subsidiaryId) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        
        try {
            // Get transactions in the date range (what we'll potentially flag)
            const sqlDateRange = `
                SELECT T.id, T.tranid, TO_CHAR(T.trandate, 'MM/DD/YYYY') AS trandate, T.type,
                    ABS(COALESCE(T.foreigntotal, 0)) AS amount,
                    TL.entity AS entityid,
                    BUILTIN.DF(TL.entity) AS entityname,
                    T.createdby AS createdbyid,
                    BUILTIN.DF(T.createdby) AS createdby
                FROM Transaction T
                LEFT JOIN TransactionLine TL ON T.id = TL.transaction AND TL.mainline = 'T'
                WHERE T.type IN (${VENDOR_TRAN_TYPES}) 
                    AND ABS(COALESCE(T.foreigntotal, 0)) > 0
                    AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                    AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                    ${subFilter}
                ORDER BY TL.entity, ABS(COALESCE(T.foreigntotal, 0)) DESC
            `;
            
            const dateRangeResults = runSuiteQL(sqlDateRange);
            Utils.auditLog('Z-Score Analysis', { phase: 'fetch_date_range', count: dateRangeResults ? dateRangeResults.length : 0 });

            // Validate we have a proper array
            if (!dateRangeResults || !Array.isArray(dateRangeResults) || dateRangeResults.length < 5) return [];

            // Get unique vendor IDs - safely extract entityid from each row
            const vendorIdSet = {};
            for (let i = 0; i < dateRangeResults.length; i++) {
                const row = dateRangeResults[i];
                if (row && row.entityid) {
                    vendorIdSet[row.entityid] = true;
                }
            }
            const vendorIds = Object.keys(vendorIdSet);
            if (vendorIds.length === 0) return [];
            
            // Get baseline stats per vendor using SUM/COUNT (supported in SuiteQL)
            const vendorBaselines = {};
            
            // Process in batches
            const batchSize = 30;
            for (let i = 0; i < vendorIds.length; i += batchSize) {
                const batch = vendorIds.slice(i, i + batchSize);
                const vendorIdList = batch.map(id => `'${id}'`).join(',');
                
                // Get sum, count, sum of squares per vendor for manual stddev calculation
                const sqlStats = `
                    SELECT TL.entity AS entityid,
                        COUNT(*) AS txn_count,
                        SUM(ABS(COALESCE(T.foreigntotal, 0))) AS sum_amount,
                        SUM(ABS(COALESCE(T.foreigntotal, 0)) * ABS(COALESCE(T.foreigntotal, 0))) AS sum_sq
                    FROM Transaction T
                    LEFT JOIN TransactionLine TL ON T.id = TL.transaction AND TL.mainline = 'T'
                    WHERE T.type IN (${VENDOR_TRAN_TYPES}) 
                        AND ABS(COALESCE(T.foreigntotal, 0)) > 0
                        AND TL.entity IN (${vendorIdList})
                        AND T.trandate >= ADD_MONTHS(SYSDATE, -36)
                        ${subFilter}
                    GROUP BY TL.entity
                    HAVING COUNT(*) >= 5
                `;
                
                try {
                    const statsResults = runSuiteQL(sqlStats);

                    // Ensure we have a valid array before iterating
                    if (statsResults && Array.isArray(statsResults)) {
                        statsResults.forEach(row => {
                            const n = parseInt(row.txn_count) || 0;
                            const sum = parseFloat(row.sum_amount) || 0;
                            const sumSq = parseFloat(row.sum_sq) || 0;

                            if (n >= 5) {
                                const avg = sum / n;
                                // Variance = E[X²] - (E[X])² with Bessel's correction
                                const variance = (sumSq / n - avg * avg) * n / (n - 1);
                                const stdDev = Math.sqrt(Math.max(0, variance));

                                // Only include if stdDev is meaningful (> $10 to avoid noise)
                                if (stdDev > 10) {
                                    vendorBaselines[row.entityid] = {
                                        count: n,
                                        avg: avg,
                                        stdDev: stdDev
                                    };
                                }
                            }
                        });
                    }
                } catch (e) {
                    Utils.debugLog('Z-Score batch query error', { batch: i, error: e.message });
                }
            }

            Utils.auditLog('Z-Score Analysis', { phase: 'baselines_built', vendorCount: Object.keys(vendorBaselines).length });

            // Group date range transactions by vendor
            const vendorGroups = {};
            for (let i = 0; i < dateRangeResults.length; i++) {
                const row = dateRangeResults[i];
                if (!row) continue;
                const vendorId = row.entityid || 'unknown';
                if (!vendorGroups[vendorId]) {
                    vendorGroups[vendorId] = {
                        vendorId: row.entityid,
                        vendorName: row.entityname || 'Unknown',
                        transactions: []
                    };
                }
                vendorGroups[vendorId].transactions.push({
                    id: row.id,
                    tranId: row.tranid,
                    tranDate: row.trandate,
                    type: row.type,
                    amount: parseFloat(row.amount) || 0,
                    createdById: row.createdbyid,
                    createdBy: row.createdby
                });
            }

            const zScoreAnomalies = [];
            
            // Check each transaction against vendor's historical baseline
            Object.values(vendorGroups).forEach(group => {
                const baseline = vendorBaselines[group.vendorId];
                if (!baseline) return;
                
                group.transactions.forEach(txn => {
                    const zScore = (txn.amount - baseline.avg) / baseline.stdDev;
                    
                    // Sanity check: Z-score should be reasonable (< 50)
                    if (Math.abs(zScore) >= Z_SCORE_THRESHOLD && Math.abs(zScore) < 50) {
                        let score = 45;
                        if (Math.abs(zScore) >= 5) score += 30;
                        else if (Math.abs(zScore) >= 4) score += 20;
                        if (txn.amount >= CRITICAL_RISK_AMOUNT) score += 15;
                        
                        zScoreAnomalies.push({
                            id: txn.id,
                            tranId: txn.tranId,
                            tranDate: txn.tranDate,
                            type: txn.type,
                            amount: txn.amount,
                            avgAmount: baseline.avg,
                            stdDev: baseline.stdDev,
                            zScore: zScore,
                            vendorId: group.vendorId,
                            vendorName: group.vendorName,
                            entityId: group.vendorId,
                            entityName: group.vendorName,
                            createdById: txn.createdById,
                            createdBy: txn.createdBy,
                            vendorTxnCount: baseline.count,
                            flagType: 'zscore',
                            reason: `Z-Score ${Math.abs(zScore).toFixed(2)}σ vs ${group.vendorName} historical avg (${baseline.count} txns)`,
                            riskScore: Math.min(100, score)
                        });
                    }
                });
            });
            
            Utils.auditLog('Z-Score Analysis', { phase: 'complete', vendorGroups: Object.keys(vendorGroups).length, anomaliesFound: zScoreAnomalies.length });
            return zScoreAnomalies.sort((a, b) => b.riskScore - a.riskScore).slice(0, 100);
        } catch (e) {
            log.error('Z-Score Error', { message: e.message, name: e.name });
            return [];
        }
    }

    // ==========================================
    // SEQUENTIAL INVOICE DETECTION - Shell Company Indicator
    // Detects sequential invoices from the SAME vendor with NO GAPS over time.
    //
    // KEY INSIGHT: If a vendor's invoice numbers to us are perfectly sequential
    // (001, 002, 003...) over weeks/months, it means we're their ONLY customer.
    // Legitimate vendors have gaps because they invoice OTHER customers too.
    //
    // Risk levels:
    // - Same day sequential: LOW risk (normal bulk ordering)
    // - Spread over 7-30 days: MEDIUM risk
    // - Spread over 30+ days: HIGH risk (strong shell company indicator)
    // ==========================================

    /**
     * Calculate the number of days between two dates
     */
    function daysBetween(date1, date2) {
        if (!date1 || !date2) return Infinity;
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return Infinity;
        const diffTime = Math.abs(d2 - d1);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * Calculate the date span (first to last date) of a run of invoices
     */
    function calculateDateSpan(invoices) {
        if (!invoices || invoices.length === 0) return { days: Infinity, allSameDay: false };

        const dates = invoices
            .map(inv => inv.rawDate ? new Date(inv.rawDate) : null)
            .filter(d => d && !isNaN(d.getTime()))
            .sort((a, b) => a - b);

        if (dates.length < 2) return { days: 0, allSameDay: true, firstDate: dates[0], lastDate: dates[0] };

        const firstDate = dates[0];
        const lastDate = dates[dates.length - 1];
        const days = daysBetween(firstDate, lastDate);
        const allSameDay = days === 0;

        return { days, allSameDay, firstDate, lastDate };
    }

    function detectSequentialInvoices(startDate, endDate, subsidiaryId, config) {
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        const minCount = (config && config.sequentialMinCount) || SEQUENTIAL_INVOICE_MIN;

        // Get vendor bills with entity information
        const sql = `
            SELECT T.id, T.tranid, TO_CHAR(T.trandate, 'MM/DD/YYYY') AS trandate,
                T.trandate AS raw_date, ABS(T.foreigntotal) AS amount,
                TL.entity AS entityId, BUILTIN.DF(TL.entity) AS entityName
            FROM Transaction T
            LEFT JOIN TransactionLine TL ON T.id = TL.transaction AND TL.mainline = 'T'
            WHERE T.type IN ('VendBill', 'Bill', 'vendorbill')
                AND T.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
                AND T.tranid IS NOT NULL ${subFilter}
            ORDER BY TL.entity, T.tranid
        `;

        try {
            const results = runSuiteQL(sql);
            if (!results || results.length < minCount) return [];

            // Parse invoices and extract invoice numbers
            const invoices = results.map(row => ({
                id: row.id,
                tranId: row.tranid,
                tranDate: row.trandate,
                rawDate: row.raw_date,
                amount: parseFloat(row.amount) || 0,
                invoiceNum: extractInvoiceNumber(row.tranid),
                entityId: row.entityid,
                entityName: row.entityname || 'Unknown'
            })).filter(i => i.invoiceNum !== null);

            if (invoices.length < minCount) return [];

            // Group by vendor FIRST, then look for sequential patterns within each vendor
            const vendorGroups = {};
            invoices.forEach(inv => {
                const vendorId = inv.entityId || 'unknown';
                if (!vendorGroups[vendorId]) {
                    vendorGroups[vendorId] = {
                        vendorId: inv.entityId,
                        vendorName: inv.entityName,
                        invoices: []
                    };
                }
                vendorGroups[vendorId].invoices.push(inv);
            });

            const groups = [];

            // Check each vendor separately for sequential patterns
            Object.values(vendorGroups).forEach(vendorGroup => {
                // Need minimum invoices to detect pattern
                if (vendorGroup.invoices.length < minCount) return;

                // Sort this vendor's invoices by invoice number
                const sortedInvoices = vendorGroup.invoices.slice().sort((a, b) => a.invoiceNum - b.invoiceNum);

                let run = [];

                for (let i = 0; i < sortedInvoices.length; i++) {
                    if (run.length === 0) {
                        run.push(sortedInvoices[i]);
                    } else {
                        // Check if sequential (no need to check vendor - already grouped by vendor)
                        const isSequential = sortedInvoices[i].invoiceNum === run[run.length - 1].invoiceNum + 1;

                        if (isSequential) {
                            run.push(sortedInvoices[i]);
                        } else {
                            // End of run - check if it meets requirements
                            if (run.length >= minCount) {
                                const group = buildSequentialGroup(run, vendorGroup);
                                // Only add if it passes the date spread check (same-day is less suspicious)
                                if (group) groups.push(group);
                            }
                            // Start new run
                            run = [sortedInvoices[i]];
                        }
                    }
                }

                // Check final run for this vendor
                if (run.length >= minCount) {
                    const group = buildSequentialGroup(run, vendorGroup);
                    if (group) groups.push(group);
                }
            });

            return groups.sort((a, b) => b.riskScore - a.riskScore).slice(0, 20);
        } catch (e) {
            log.error('Sequential Invoice Error', { message: e.message });
            return [];
        }
    }

    /**
     * Helper function to build a sequential group object
     * Returns null if same-day invoices (normal bulk ordering behavior)
     *
     * SHELL COMPANY INDICATOR: If sequential invoices are spread over many days,
     * it means we're likely their ONLY customer (no gaps from other customers).
     */
    function buildSequentialGroup(run, vendorGroup) {
        const totalAmt = run.reduce((s, inv) => s + inv.amount, 0);
        const dateSpan = calculateDateSpan(run);

        // SAME DAY = Normal bulk ordering, don't flag (or flag with very low priority)
        if (dateSpan.allSameDay || dateSpan.days < SEQUENTIAL_MIN_DAYS_FOR_FLAG) {
            // Could return null to not flag at all, or return with low risk
            // For now, don't flag same-day sequential invoices - they're normal
            return null;
        }

        // Calculate risk based on DATE SPREAD (more spread = more suspicious)
        let riskScore = 0;
        let riskLevel = 'low';
        let dateReason = '';

        if (dateSpan.days >= SEQUENTIAL_HIGH_RISK_DAYS) {
            // SPREAD OVER 30+ DAYS - HIGH RISK: Shell company indicator
            // This vendor has invoiced us sequentially over a month+ with no gaps
            // Strong indicator that we're their ONLY customer
            riskScore = 75;
            riskLevel = 'high';
            dateReason = `over ${dateSpan.days} days (no gaps - possible shell company)`;
        } else if (dateSpan.days >= SEQUENTIAL_MIN_DAYS_FOR_FLAG) {
            // SPREAD OVER 7-30 DAYS - MEDIUM RISK
            // Sequential with no gaps over multiple weeks
            riskScore = 50;
            riskLevel = 'medium';
            dateReason = `over ${dateSpan.days} days with no gaps`;
        }

        // Additional risk factors
        // More sequential invoices = higher risk (more evidence of being sole customer)
        riskScore += Math.min(run.length * 4, 20);
        // Higher total amount = higher risk
        if (totalAmt > 100000) riskScore += 10;
        else if (totalAmt > 50000) riskScore += 7;
        else if (totalAmt > 25000) riskScore += 5;

        return {
            invoices: run.map(inv => ({
                id: inv.id,
                tranId: inv.tranId,
                tranDate: inv.tranDate,
                amount: inv.amount,
                invoiceNum: inv.invoiceNum,
                entityName: inv.entityName
            })),
            count: run.length,
            totalAmount: totalAmt,
            startInvoice: run[0].invoiceNum,
            endInvoice: run[run.length - 1].invoiceNum,
            dateSpanDays: dateSpan.days,
            allSameDay: dateSpan.allSameDay,
            riskLevel: riskLevel,
            entityName: vendorGroup.vendorName,
            entityId: vendorGroup.vendorId,
            vendorName: vendorGroup.vendorName,
            vendorId: vendorGroup.vendorId,
            flagType: 'sequential',
            reason: `${run.length} sequential invoices (${run[0].invoiceNum}-${run[run.length - 1].invoiceNum}) from ${vendorGroup.vendorName} - ${dateReason}`,
            riskScore: Math.min(100, riskScore)
        };
    }

    /**
     * Extract invoice number from transaction ID
     * Handles multiple common formats:
     * - "INV-001" or "INV001" -> 1
     * - "2024-INV-0042" -> 42
     * - "ABC123" -> 123
     * - "INV-2024-001" -> 1 (extracts the last numeric sequence)
     */
    function extractInvoiceNumber(tranId) {
        if (!tranId) return null;

        // Strategy: Find all numeric sequences and use the last one
        // This handles formats like "INV-2024-001" where we want "001" = 1
        const matches = tranId.match(/\d+/g);
        if (!matches || matches.length === 0) return null;

        // Use the last numeric sequence (most likely to be the invoice number)
        const lastNum = matches[matches.length - 1];
        const parsed = parseInt(lastNum, 10);

        // Sanity check: invoice numbers are typically reasonable
        // Skip if the number is too large (likely a date like 20240115)
        if (parsed > 9999999) return null;

        return parsed;
    }

    // ==========================================
    // GHOST VENDOR DETECTION
    // ==========================================
    
    function detectGhostVendors(subsidiaryId) {
        const subFilter = subsidiaryId ? `AND v.subsidiary = ${subsidiaryId}` : '';
        
        // Simplified query - matches vendor names to employee names
        // Note: Address-based matching disabled due to field availability issues
        const sql = `
            SELECT v.id AS vendor_id, v.entityid AS vendor_name, v.companyname,
                e.id AS employee_id, e.entityid AS employee_name
            FROM Vendor v
            JOIN Employee e ON 
                (
                    UPPER(TRIM(v.entityid)) = UPPER(TRIM(e.entityid))
                    OR UPPER(TRIM(v.companyname)) = UPPER(TRIM(e.firstname || ' ' || e.lastname))
                    OR (v.companyname IS NOT NULL AND UPPER(TRIM(v.companyname)) = UPPER(TRIM(e.entityid)))
                )
            WHERE v.isinactive = 'F' 
                AND e.isinactive = 'F' 
                AND v.isperson = 'F'
                ${subFilter}
            FETCH FIRST 50 ROWS ONLY
        `;
        
        try {
            const results = runSuiteQL(sql);

            // Deduplicate by vendor-employee pair using object instead of Set
            const seen = {};
            const unique = [];
            if (results && Array.isArray(results)) {
                results.forEach(row => {
                    const key = row.vendor_id + '-' + row.employee_id;
                    if (!seen[key]) {
                        seen[key] = true;
                        unique.push(row);
                    }
                });
            }

            return unique.map(row => ({
                vendorId: row.vendor_id,
                vendorName: row.vendor_name || row.companyname,
                vendorAddress: '', // Address matching disabled
                employeeId: row.employee_id,
                employeeName: row.employee_name,
                employeeAddress: '', // Address matching disabled
                flagType: 'ghost',
                reason: 'Vendor "' + (row.vendor_name || row.companyname) + '" name matches employee "' + row.employee_name + '"',
                riskScore: 85
            }));
        } catch (e) {
            log.error('Ghost Vendor Error', e);
            return [];
        }
    }

    // ==========================================
    // AUDIT TRAIL ANALYSIS - Real NetSuite System Notes
    // ==========================================
    
    /**
     * Get human-readable record type label
     * NetSuite recordtypeid values vary by account
     */
    function getRecordTypeLabel(recordTypeId, recordName) {
        // Common NetSuite record type IDs (may vary by account)
        const typeMap = {
            '-9': 'Entity',
            '-7': 'Employee', 
            '-30': 'Transaction',
            '-2': 'Customer',
            '-3': 'Contact',
            '-4': 'Vendor',
            '-5': 'Partner',
            '-6': 'Lead',
            '-8': 'Job',
            '-10': 'Item',
            '-29': 'File',
            '-40': 'Folder'
        };
        
        const mapped = typeMap[String(recordTypeId)];
        if (mapped) return mapped;
        
        // Try to infer from record name patterns
        const nameLower = (recordName || '').toLowerCase();
        if (nameLower.indexOf('vendor') > -1 || nameLower.indexOf('vend') > -1) return 'Vendor';
        if (nameLower.indexOf('customer') > -1 || nameLower.indexOf('cust') > -1) return 'Customer';
        if (nameLower.indexOf('employee') > -1 || nameLower.indexOf('emp') > -1) return 'Employee';
        if (nameLower.indexOf('invoice') > -1 || nameLower.indexOf('inv') > -1) return 'Invoice';
        if (nameLower.indexOf('bill') > -1) return 'Bill';
        if (nameLower.indexOf('payment') > -1 || nameLower.indexOf('pymt') > -1) return 'Payment';
        if (nameLower.indexOf('order') > -1) return 'Order';
        
        // For positive IDs, it's likely a custom record type
        if (recordTypeId > 0) return 'Custom';
        
        return 'Record';
    }
    
    /**
     * Query NetSuite's systemnote table for real audit trail data
     * Returns AGGREGATED data - one row per record for main table
     * Detailed changes fetched on-demand via getAuditRecordDetail
     * 
     * PERFORMANCE OPTIMIZED: Two-phase query approach
     * - Phase 1: Identify high-risk records (banking, address, deletions)
     * - Phase 2: Get aggregates for identified records only
     */
    function analyzeAuditTrail(startDate, endDate, subsidiaryId) {
        try {
            const startTime = Date.now();
            
            // PERFORMANCE: Cap date range at 30 days max
            const maxDays = 30;
            let start = new Date(startDate);
            const end = new Date(endDate);
            const daySpan = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            
            if (daySpan > maxDays) {
                const newStart = new Date(end);
                newStart.setDate(newStart.getDate() - maxDays);
                startDate = newStart.toISOString().split('T')[0];
                Utils.auditLog('Audit Trail', 'Date range capped from ' + daySpan + ' to ' + maxDays + ' days');
            }
            
            // PHASE 1: Quick scan to identify high-risk records (fast - just gets record IDs)
            // Limited to 100 to keep Phase 3 fast
            // Use recordid (internal ID) not record (display name) for reliable lookups
            const phase1Sql = `
                SELECT DISTINCT recordid, record, recordtypeid
                FROM systemnote
                WHERE date >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                    AND date < TO_DATE('${endDate}', 'YYYY-MM-DD') + 1
                    AND recordid IS NOT NULL
                    AND (
                        UPPER(field) LIKE '%BANK%'
                        OR UPPER(field) LIKE '%ACH%'
                        OR UPPER(field) LIKE '%ROUTING%'
                        OR UPPER(field) LIKE '%ADDR%'
                        OR type = 5
                    )
                FETCH FIRST 500 ROWS ONLY
            `;
            
            let phase1Results = null;
            try {
                phase1Results = runSuiteQL(phase1Sql);
            } catch (sqlErr) {
                log.error('Audit Trail Phase 1 SQL Error', { error: sqlErr.message });
            }
            const phase1Time = Date.now() - startTime;
            Utils.auditLog('Audit Trail Phase 1', { count: phase1Results ? phase1Results.length : 0, ms: phase1Time });
            
            // Collect high-risk record identifiers (use object for compatibility)
            // Store both recordid (for queries) and record (display name for UI)
            const highRiskRecords = {};
            const recordDisplayNames = {};
            const recordTypes = {};
            if (phase1Results) {
                phase1Results.forEach(r => {
                    if (r.recordid) {
                        const key = r.recordid + '|' + r.recordtypeid;
                        highRiskRecords[key] = true;
                        recordDisplayNames[r.recordid] = r.record || ('Record #' + r.recordid);
                        recordTypes[r.recordid] = r.recordtypeid;
                    }
                });
            }
            
            // SKIP PHASE 2 for performance - only show high-risk records
            // Phase 2 GROUP BY on full table is too slow (20+ seconds)
            // Users can use flyout to drill into specific records
            
            // No records found
            const highRiskKeys = Object.keys(highRiskRecords);
            if (highRiskKeys.length === 0) {
                return {
                    records: [],
                    patterns: [],
                    metrics: { overallRiskScore: 0, riskLevel: 'LOW' },
                    summary: { 
                        totalRecords: 0, 
                        totalChanges: 0, 
                        uniqueUsers: 0,
                        queryTime: Date.now() - startTime,
                        note: 'No high-risk records found (banking, address, or deletion changes)'
                    }
                };
            }
            
            // PHASE 3: Get data for identified records - simple SELECT, aggregate in JS
            // Avoid GROUP BY for performance
            // Use recordid for the IN clause
            const phase3Start = Date.now();
            const recordIdList = highRiskKeys.map(k => {
                const parts = k.split('|');
                return parts[0];  // Just the recordid, no quotes needed for numbers
            });
            
            // Single query with ROWNUM limit for safety
            // Use recordid for filtering, get both recordid and record (display name)
            const phase3Sql = `
                SELECT 
                    recordid,
                    record AS record_name,
                    recordtypeid,
                    field,
                    type,
                    date AS note_date,
                    name AS user_id
                FROM systemnote
                WHERE date >= TO_DATE('${startDate}', 'YYYY-MM-DD')
                    AND date < TO_DATE('${endDate}', 'YYYY-MM-DD') + 1
                    AND recordid IN (${recordIdList.join(',')})
                    AND ROWNUM <= 25000
            `;
            
            let rawResults = null;
            try {
                rawResults = runSuiteQL(phase3Sql);
            } catch (sqlErr) {
                log.error('Audit Trail Phase 3 SQL Error', { error: sqlErr.message });
            }
            
            const phase3Time = Date.now() - phase3Start;
            Utils.auditLog('Audit Trail Phase 3', { rawCount: rawResults ? rawResults.length : 0, ms: phase3Time });
            
            // Aggregate in JavaScript - use recordid as key
            const recordAggregates = {};
            
            if (rawResults) {
                rawResults.forEach(row => {
                    const recordId = String(row.recordid || '');
                    const recordName = String(row.record_name || 'Record #' + recordId);
                    const key = recordId;
                    
                    if (!recordAggregates[key]) {
                        recordAggregates[key] = {
                            recordId: recordId,  // Internal ID for API calls
                            recordName: recordName,  // Display name for UI
                            recordTypeId: row.recordtypeid,
                            changeCount: 0,
                            users: {},  // Use object instead of Set for compatibility
                            lastDate: null,
                            hasBanking: false,
                            hasAddress: false,
                            hasDeletion: false,
                            bankingChanges: 0,
                            addressChanges: 0,
                            deletionCount: 0
                        };
                    }
                    
                    const agg = recordAggregates[key];
                    agg.changeCount++;
                    if (row.user_id) agg.users[row.user_id] = true;
                    
                    // Track last date
                    if (row.note_date) {
                        const dateStr = String(row.note_date);
                        if (!agg.lastDate || dateStr > agg.lastDate) {
                            agg.lastDate = dateStr;
                        }
                    }
                    
                    // Check field types
                    const fieldLower = String(row.field || '').toLowerCase();
                    if (fieldLower.indexOf('bank') > -1 || fieldLower.indexOf('ach') > -1 || fieldLower.indexOf('routing') > -1) {
                        agg.hasBanking = true;
                        agg.bankingChanges++;
                    }
                    if (fieldLower.indexOf('addr') > -1) {
                        agg.hasAddress = true;
                        agg.addressChanges++;
                    }
                    if (row.type === 5) {
                        agg.hasDeletion = true;
                        agg.deletionCount++;
                    }
                });
            }
            
            // Convert to array and calculate risk scores
            const allRecords = [];
            let totalChanges = 0;
            let totalBanking = 0;
            let totalAddress = 0;
            let totalDeletions = 0;
            
            Object.values(recordAggregates).forEach(agg => {
                const recordId = agg.recordId;  // Internal ID
                const recordName = agg.recordName;  // Display name
                const recordTypeId = agg.recordTypeId;
                const changeCount = agg.changeCount;
                const userCount = Object.keys(agg.users).length;
                const hasBanking = agg.hasBanking;
                const hasAddress = agg.hasAddress;
                const hasDeletion = agg.hasDeletion;
                const bankingChanges = agg.bankingChanges;
                const addressChanges = agg.addressChanges;
                const deletionCount = agg.deletionCount;
                
                // Parse last date
                let lastDate = '';
                if (agg.lastDate) {
                    const dateStr = String(agg.lastDate);
                    const parts = dateStr.split('/');
                    if (parts.length === 3) {
                        lastDate = parts[2] + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0');
                    } else {
                        lastDate = dateStr;
                    }
                }
                
                // Calculate risk score
                const recordTypeLabel = getRecordTypeLabel(recordTypeId, recordName);
                const isEntity = ['Entity', 'Vendor', 'Customer', 'Partner', 'Lead'].indexOf(recordTypeLabel) > -1;
                const isEmployee = recordTypeLabel === 'Employee';
                
                let riskScore = 10;
                if (hasBanking) riskScore += 50 + Math.min(bankingChanges * 10, 30);
                if (hasAddress) riskScore += 30 + Math.min(addressChanges * 5, 15);
                if (hasDeletion) riskScore += 25 + Math.min(deletionCount * 8, 20);
                if (isEntity) riskScore += 20;
                if (isEmployee) riskScore += 25;
                if (changeCount > 50) riskScore += 15;
                else if (changeCount > 20) riskScore += 10;
                else if (changeCount > 10) riskScore += 5;
                if (userCount > 3) riskScore += 10;
                riskScore = Math.min(100, riskScore);
                
                const riskFactors = [];
                if (hasBanking) riskFactors.push('Banking');
                if (hasAddress) riskFactors.push('Address');
                if (hasDeletion) riskFactors.push('Deletion');
                if (isEntity) riskFactors.push('Entity');
                if (isEmployee) riskFactors.push('Employee');
                if (changeCount > 20) riskFactors.push('High Volume');
                if (userCount > 3) riskFactors.push('Multi-User');
                
                const actions = ['E'];
                if (hasDeletion && actions.indexOf('D') === -1) actions.push('D');
                
                allRecords.push({
                    recordId: recordId,  // Internal ID for API calls
                    recordName: recordName,  // Display name for UI
                    recordType: recordTypeLabel,
                    recordTypeId: recordTypeId,
                    changeCount: changeCount,
                    userCount: userCount,
                    users: [],
                    lastDate: lastDate,
                    riskScore: riskScore,
                    riskFactors: riskFactors,
                    actions: actions,
                    hasBanking: hasBanking,
                    hasAddress: hasAddress,
                    hasDeletion: hasDeletion,
                    bankingChanges: bankingChanges,
                    addressChanges: addressChanges,
                    deletionCount: deletionCount
                });
                
                totalChanges += changeCount;
                totalBanking += bankingChanges;
                totalAddress += addressChanges;
                totalDeletions += deletionCount;
            });
            
            // Sort by risk score (default), then by date
            allRecords.sort((a, b) => {
                if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
                return (b.lastDate || '').localeCompare(a.lastDate || '');
            });
            
            const queryTime = Date.now() - startTime;
            Utils.auditLog('Audit Trail Complete', { records: allRecords.length, totalChanges: totalChanges, ms: queryTime });
            
            // Calculate metrics
            const highRiskRecordsList = allRecords.filter(r => r.riskScore >= 70);
            const criticalRecords = allRecords.filter(r => r.hasBanking);
            const overallRiskScore = allRecords.length > 0 
                ? Math.round(allRecords.slice(0, 10).reduce((sum, r) => sum + r.riskScore, 0) / Math.min(10, allRecords.length))
                : 0;
            
            const patterns = detectAuditPatternsFromSummary(allRecords);
            
            return {
                records: allRecords,
                patterns: patterns,
                metrics: {
                    overallRiskScore: overallRiskScore,
                    riskLevel: overallRiskScore >= 70 ? 'CRITICAL' : overallRiskScore >= 40 ? 'HIGH' : overallRiskScore >= 20 ? 'MEDIUM' : 'LOW',
                    criticalRecords: criticalRecords.length,
                    highRiskRecords: highRiskRecordsList.length
                },
                summary: {
                    totalRecords: allRecords.length,
                    totalChanges: totalChanges,
                    uniqueUsers: Math.max(...allRecords.map(r => r.userCount), 0),
                    bankingChanges: totalBanking,
                    addressChanges: totalAddress,
                    deletions: totalDeletions,
                    queryTime: queryTime,
                    dateRangeCapped: daySpan > maxDays
                }
            };
            
        } catch (e) {
            log.error('Audit Trail Analysis Error', { message: e.message, stack: e.stack });
            return {
                records: [],
                patterns: [],
                metrics: { overallRiskScore: 0, riskLevel: 'LOW', error: e.message },
                summary: { totalRecords: 0, totalChanges: 0, uniqueUsers: 0, error: e.message }
            };
        }
    }
    
    /**
     * Get detailed audit trail for a specific record - called by flyout API
     */
    function getAuditRecordDetail(recordId, startDate, endDate) {
        // Log everything immediately
        Utils.auditLog('getAuditRecordDetail CALLED', {
            recordId: recordId,
            recordIdType: typeof recordId,
            startDate: startDate,
            endDate: endDate
        });

        try {
            // Super simple validation
            if (!recordId) {
                Utils.auditLog('getAuditRecordDetail', 'No recordId provided');
                return { 
                    success: true,
                    changes: [], 
                    recordId: '', 
                    recordName: '',
                    error: 'No record ID provided',
                    summary: { totalChanges: 0, uniqueUsers: 0, maxRisk: 0, hasBanking: false, hasAddress: false, weekendChanges: 0 }
                };
            }
            
            // Convert to number - simple approach
            var numericId = parseInt(recordId, 10);
            if (!numericId || numericId <= 0) {
                Utils.auditLog('getAuditRecordDetail', 'Invalid recordId: ' + recordId);
                return { 
                    success: true,
                    changes: [], 
                    recordId: recordId, 
                    recordName: '',
                    error: 'Invalid record ID',
                    summary: { totalChanges: 0, uniqueUsers: 0, maxRisk: 0, hasBanking: false, hasAddress: false, weekendChanges: 0 }
                };
            }
            
            // Default dates if not provided
            if (!endDate) {
                var today = new Date();
                endDate = today.toISOString().split('T')[0];
            }
            if (!startDate) {
                var thirtyAgo = new Date();
                thirtyAgo.setDate(thirtyAgo.getDate() - 30);
                startDate = thirtyAgo.toISOString().split('T')[0];
            }
            
            Utils.auditLog('getAuditRecordDetail params', { numericId: numericId, startDate: startDate, endDate: endDate });
            
            // Query with user name lookup built-in via BUILTIN.DF
            var sql = "SELECT id, record AS record_name, date AS note_date, name AS user_id, " +
                      "BUILTIN.DF(name) AS user_name, " +
                      "type AS action_type_id, field AS field_id, oldvalue, newvalue " +
                      "FROM systemnote " +
                      "WHERE recordid = " + numericId + " " +
                      "AND date >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
                      "AND date < TO_DATE('" + endDate + "', 'YYYY-MM-DD') + 1 " +
                      "ORDER BY date DESC " +
                      "FETCH FIRST 500 ROWS ONLY";

            Utils.auditLog('getAuditRecordDetail SQL', sql);

            var results = null;
            try {
                results = runSuiteQL(sql);
                Utils.auditLog('getAuditRecordDetail results', { count: results ? results.length : 0 });
            } catch (sqlErr) {
                log.error('getAuditRecordDetail SQL Error', sqlErr.message);
                return { 
                    success: true,
                    changes: [], 
                    recordId: recordId,
                    recordName: '',
                    error: 'SQL Error: ' + sqlErr.message,
                    summary: { totalChanges: 0, uniqueUsers: 0, maxRisk: 0, hasBanking: false, hasAddress: false, weekendChanges: 0 }
                };
            }
            
            if (!results || results.length === 0) {
                return { 
                    success: true,
                    changes: [], 
                    recordId: recordId,
                    recordName: '',
                    summary: { totalChanges: 0, uniqueUsers: 0, maxRisk: 0, hasBanking: false, hasAddress: false, weekendChanges: 0 }
                };
            }
            
            // Get display name from first result
            var displayName = results[0].record_name || ('Record #' + recordId);
            
            // Build simple changes array
            var changes = [];
            var userMap = {};
            var maxRisk = 0;
            var hasBanking = false;
            var hasAddress = false;
            var weekendCount = 0;
            
            for (var i = 0; i < results.length; i++) {
                var row = results[i];
                var fieldId = String(row.field_id || '');
                var fieldLower = fieldId.toLowerCase();
                var userId = row.user_id || 'unknown';
                userMap[userId] = true;
                
                // Get user display name from query result
                var userName = row.user_name || ('User #' + userId);
                
                // Simple date handling
                var timestamp = String(row.note_date || '');
                var isWeekend = false;
                
                // Calculate risk
                var riskScore = 20;
                var riskFactors = [];
                
                if (fieldLower.indexOf('bank') > -1 || fieldLower.indexOf('ach') > -1) {
                    riskScore = 95;
                    riskFactors.push('Banking');
                    hasBanking = true;
                } else if (fieldLower.indexOf('addr') > -1) {
                    riskScore = 75;
                    riskFactors.push('Address');
                    hasAddress = true;
                }
                
                if (riskScore > maxRisk) maxRisk = riskScore;
                
                var actionType = 'EDIT';
                if (row.action_type_id === 1 || row.action_type_id === 3) actionType = 'CREATE';
                if (row.action_type_id === 5 || row.action_type_id === 10) actionType = 'DELETE';
                if (row.action_type_id === 6) actionType = 'APPROVE';
                
                changes.push({
                    id: row.id,
                    timestamp: timestamp,
                    user: userName,
                    action: actionType,
                    field: fieldId,
                    oldValue: row.oldvalue || '',
                    newValue: row.newvalue || '',
                    riskScore: riskScore,
                    riskFactors: riskFactors,
                    isWeekend: isWeekend
                });
            }
            
            var uniqueUserCount = Object.keys(userMap).length;
            
            Utils.auditLog('getAuditRecordDetail SUCCESS', { changesCount: changes.length });
            
            return {
                success: true,
                recordId: recordId,
                recordName: displayName,
                changes: changes,
                summary: {
                    totalChanges: changes.length,
                    uniqueUsers: uniqueUserCount,
                    maxRisk: maxRisk,
                    hasBanking: hasBanking,
                    hasAddress: hasAddress,
                    weekendChanges: weekendCount
                }
            };
            
        } catch (e) {
            log.error('getAuditRecordDetail EXCEPTION', { message: e.message, stack: e.stack, name: e.name });
            return { 
                success: true,
                changes: [], 
                recordId: recordId,
                recordName: '',
                error: e.message,
                summary: { totalChanges: 0, uniqueUsers: 0, maxRisk: 0, hasBanking: false, hasAddress: false, weekendChanges: 0 }
            };
        }
    }
    
    /**
     * Detect patterns from aggregated audit summary
     */
    function detectAuditPatternsFromSummary(records) {
        const patterns = [];
        
        // Pattern 1: Banking modifications (CRITICAL)
        const bankingRecords = records.filter(r => r.hasBanking);
        if (bankingRecords.length > 0) {
            patterns.push({
                type: 'BANKING_MODIFICATIONS',
                severity: 'critical',
                title: 'Banking Information Changed',
                description: bankingRecords.length + ' record(s) with bank account modifications',
                count: bankingRecords.length,
                records: bankingRecords.slice(0, 5).map(r => r.recordId),
                icon: 'fa-university'
            });
        }
        
        // Pattern 2: Address changes (ghost vendor indicator)
        const addressRecords = records.filter(r => r.hasAddress && r.addressChanges >= 2);
        if (addressRecords.length >= 3) {
            patterns.push({
                type: 'ADDRESS_CHANGES',
                severity: 'high',
                title: 'Multiple Address Modifications',
                description: addressRecords.length + ' record(s) with address changes',
                count: addressRecords.length,
                records: addressRecords.slice(0, 5).map(r => r.recordId),
                icon: 'fa-map-marker-alt'
            });
        }
        
        // Pattern 3: Deletions
        const deletionRecords = records.filter(r => r.hasDeletion);
        if (deletionRecords.length >= 3) {
            patterns.push({
                type: 'DELETIONS',
                severity: deletionRecords.length > 10 ? 'critical' : 'high',
                title: 'Record Deletions Detected',
                description: deletionRecords.length + ' record(s) with deletions',
                count: deletionRecords.length,
                records: deletionRecords.slice(0, 5).map(r => r.recordId),
                icon: 'fa-trash-alt'
            });
        }
        
        // Pattern 4: High volume changes to single record
        const highVolumeRecords = records.filter(r => r.changeCount > 50);
        if (highVolumeRecords.length > 0) {
            patterns.push({
                type: 'HIGH_VOLUME',
                severity: 'medium',
                title: 'High Volume Record Changes',
                description: highVolumeRecords.length + ' record(s) with 50+ changes',
                count: highVolumeRecords.length,
                records: highVolumeRecords.slice(0, 5).map(r => r.recordId),
                icon: 'fa-bolt'
            });
        }
        
        // Pattern 5: Entity/Employee modifications
        const entityTypes = ['Entity', 'Vendor', 'Customer', 'Employee', 'Partner', 'Lead'];
        const entityRecords = records.filter(r => entityTypes.indexOf(r.recordType) > -1);
        if (entityRecords.length >= 5) {
            patterns.push({
                type: 'ENTITY_MODIFICATIONS',
                severity: 'high',
                title: 'Vendor/Employee Master Data Changes',
                description: entityRecords.length + ' entity/employee records modified',
                count: entityRecords.length,
                records: entityRecords.slice(0, 5).map(r => r.recordId),
                icon: 'fa-user-edit'
            });
        }
        
        return patterns;
    }

    // ==========================================
    // AGGREGATION
    // ==========================================
    
    function aggregateFlaggedTransactions(results) {
        const flagged = [];
        const seen = {};  // Use object instead of Set
        
        (results.potentialDuplicates || []).forEach(d => {
            if (!seen[d.id1]) {
                seen[d.id1] = true;
                flagged.push({
                    id: d.id1, tranId: d.tranId1, tranDate: d.date1, type: d.type1,
                    amount: d.amount, entityName: d.vendor, entityId: d.vendorId,
                    createdBy: d.createdBy1, createdById: d.createdById,
                    flagType: 'duplicate', reason: d.matchReason, riskScore: d.riskScore,
                    confidence: d.confidence, relatedId: d.id2
                });
            }
        });
        
        // NOTE: Benford's Law is a dataset-level analysis, NOT transaction-level
        // Individual transactions cannot violate Benford's Law - only the overall distribution can
        // Therefore we do NOT add benford flags to individual transactions
        
        (results.weekendEntries || []).forEach(w => {
            if (!seen[w.id]) {
                seen[w.id] = true;
                flagged.push({
                    id: w.id, tranId: w.tranId, tranDate: w.tranDate, type: w.type,
                    amount: w.amount, entityName: w.vendorName, entityId: w.entityId,
                    createdBy: w.createdBy, createdById: w.createdById,
                    flagType: 'weekend', reason: w.reason, riskScore: w.riskScore, dayType: w.dayType
                });
            }
        });
        
        (results.rsfAnomalies || []).forEach(r => {
            if (!seen[r.id]) {
                seen[r.id] = true;
                flagged.push({
                    id: r.id, tranId: r.tranId, tranDate: r.tranDate, type: r.type,
                    amount: r.largestAmount, entityName: r.vendorName, entityId: r.vendorId,
                    createdBy: r.createdBy, createdById: r.createdById,
                    flagType: 'rsf', reason: r.reason, riskScore: r.riskScore, rsf: r.rsf
                });
            }
        });
        
        (results.zScoreAnomalies || []).forEach(z => {
            if (!seen[z.id]) {
                seen[z.id] = true;
                flagged.push({
                    id: z.id, tranId: z.tranId, tranDate: z.tranDate, type: z.type,
                    amount: z.amount, entityName: z.vendorName, entityId: z.vendorId,
                    createdBy: z.createdBy, createdById: z.createdById,
                    flagType: 'zscore', reason: z.reason, riskScore: z.riskScore, zScore: z.zScore
                });
            }
        });
        
        (results.sequentialInvoices || []).forEach(s => {
            s.invoices.forEach(inv => {
                if (!seen[inv.id]) {
                    seen[inv.id] = true;
                    flagged.push({
                        id: inv.id, tranId: inv.tranId, tranDate: inv.tranDate, type: 'VendBill',
                        amount: inv.amount, entityName: s.vendorName, entityId: s.vendorId,
                        flagType: 'sequential', reason: s.reason, riskScore: s.riskScore
                    });
                }
            });
        });
        
        // Build dismissed lookup using object instead of Set
        const dismissed = {};
        (results.existingFlags || []).filter(f => f.status === 'Dismissed' || f.status === 'Cleared').forEach(f => {
            dismissed[f.transactionId] = true;
        });
        
        return flagged.filter(f => !dismissed[f.id]).sort((a, b) => b.riskScore - a.riskScore);
    }
    
    function analyzeVendorRisk(flagged) {
        const map = {};
        flagged.forEach(f => {
            // Use entityId/vendorId as the key when available (more reliable)
            const vendorId = f.entityId || f.vendorId;
            const vendorName = f.entityName || (vendorId ? 'Vendor #' + vendorId : null);
            
            if (!vendorName && !vendorId) return; // Skip if no vendor identifier at all
            
            // Use ID as key if available, otherwise use name
            const key = vendorId ? String(vendorId) : vendorName;
            
            if (!map[key]) {
                map[key] = { 
                    vendorName: vendorName || 'Unknown Vendor', 
                    vendorId: vendorId, 
                    flagCount: 0, 
                    totalAmount: 0, 
                    transactionCount: 0, 
                    flagTypes: [], 
                    flagTypeSet: {}, 
                    maxRiskScore: 0 
                };
            }
            
            // Update vendorId if we find it (in case first entry didn't have it)
            if (vendorId && !map[key].vendorId) {
                map[key].vendorId = vendorId;
            }
            // Update vendorName if we have a better one
            if (vendorName && map[key].vendorName === 'Unknown Vendor') {
                map[key].vendorName = vendorName;
            }
            
            map[key].flagCount++;
            map[key].totalAmount += Math.abs(f.amount || 0);
            map[key].transactionCount++;
            map[key].maxRiskScore = Math.max(map[key].maxRiskScore, f.riskScore || 0);
            if (f.flagType && !map[key].flagTypeSet[f.flagType]) {
                map[key].flagTypeSet[f.flagType] = true;
                map[key].flagTypes.push(f.flagType);
            }
        });
        
        return Object.values(map).map(v => {
            v.riskScore = Math.min(100, Math.round(
                Math.min(v.flagCount * 8, 40) +
                (v.totalAmount >= 50000 ? 25 : v.totalAmount >= 10000 ? 15 : 5) +
                v.flagTypes.length * 8 +
                v.maxRiskScore * 0.3
            ));
            delete v.flagTypeSet;
            return v;
        }).sort((a, b) => b.riskScore - a.riskScore);
    }
    
    function analyzeUserRisk(flagged) {
        const map = {};
        flagged.forEach(f => {
            // Use createdById as the key when available (more reliable)
            // Fall back to createdBy name if no ID
            const userId = f.createdById;
            const userName = f.createdBy || (userId ? 'User #' + userId : null);
            
            if (!userName && !userId) return; // Skip if no user identifier at all
            
            // Use ID as key if available, otherwise use name
            const key = userId ? String(userId) : userName;
            
            if (!map[key]) {
                map[key] = { 
                    userName: userName || 'Unknown User', 
                    userId: userId, 
                    flagCount: 0, 
                    totalAmount: 0, 
                    transactionCount: 0, 
                    flagTypes: [], 
                    flagTypeSet: {}, 
                    weekendCount: 0, 
                    maxRiskScore: 0 
                };
            }
            
            // Update userId if we find it (in case first entry didn't have it)
            if (userId && !map[key].userId) {
                map[key].userId = userId;
            }
            // Update userName if we have a better one
            if (userName && map[key].userName === 'Unknown User') {
                map[key].userName = userName;
            }
            
            map[key].flagCount++;
            map[key].totalAmount += Math.abs(f.amount || 0);
            map[key].transactionCount++;
            map[key].maxRiskScore = Math.max(map[key].maxRiskScore, f.riskScore || 0);
            if (f.flagType === 'weekend') map[key].weekendCount++;
            if (f.flagType && !map[key].flagTypeSet[f.flagType]) {
                map[key].flagTypeSet[f.flagType] = true;
                map[key].flagTypes.push(f.flagType);
            }
        });
        
        return Object.values(map).map(u => {
            u.riskScore = Math.min(100, Math.round(
                Math.min(u.flagCount * 6, 35) +
                (u.totalAmount >= 50000 ? 20 : u.totalAmount >= 10000 ? 10 : 5) +
                u.flagTypes.length * 8 +
                u.weekendCount * 5
            ));
            delete u.flagTypeSet;
            return u;
        }).sort((a, b) => b.riskScore - a.riskScore);
    }
    
    function calculateSummary(results) {
        const flagged = results.flaggedTransactions || [];
        const duplicates = results.potentialDuplicates || [];
        const weekend = results.weekendEntries || [];
        const ghost = results.ghostVendors || [];
        const sequential = results.sequentialInvoices || [];
        
        const totalAmount = flagged.reduce((s, f) => s + Math.abs(f.amount || 0), 0);
        const duplicateAmount = duplicates.reduce((s, d) => s + (d.amount || 0), 0);
        
        let risk = 0;
        if (flagged.length > 50) risk += 15;
        else if (flagged.length > 20) risk += 10;
        if (duplicateAmount > 100000) risk += 20;
        else if (duplicateAmount > 50000) risk += 15;
        if (ghost.length > 0) risk += 25;
        if (sequential.length > 0) risk += 15;
        if (results.benfordAnalysis && results.benfordAnalysis.conformityLevel === 'Non-Conforming') risk += 15;
        
        return {
            flaggedCount: flagged.length,
            duplicateCount: duplicates.length,
            totalDuplicateAmount: duplicateAmount,
            weekendEntryCount: weekend.length,
            weekendManualCount: weekend.filter(w => !w.isSystemGenerated).length,
            weekendSystemCount: weekend.filter(w => w.isSystemGenerated).length,
            weekendAmount: weekend.reduce((s, w) => s + (w.amount || 0), 0),
            rsfAnomalyCount: (results.rsfAnomalies || []).length,
            zScoreAnomalyCount: (results.zScoreAnomalies || []).length,
            sequentialInvoiceGroups: sequential.length,
            ghostVendorCount: ghost.length,
            totalAtRisk: totalAmount,
            overallRiskScore: Math.min(100, risk),
            benfordConformity: results.benfordAnalysis ? results.benfordAnalysis.conformityLevel : 'N/A',
            benford2DConformity: results.benford2DAnalysis ? results.benford2DAnalysis.conformityLevel : 'N/A',
            approvalLimitRisk: results.benford2DAnalysis ? results.benford2DAnalysis.approvalLimitRisk : false,
            topRiskAreas: generateTopRiskAreas(results)
        };
    }
    
    function generateTopRiskAreas(results) {
        const areas = [];
        if (results.ghostVendors && results.ghostVendors.length > 0) {
            areas.push({ area: 'Ghost Vendors', severity: 'critical', count: results.ghostVendors.length, message: `${results.ghostVendors.length} vendor(s) match employee addresses` });
        }
        if (results.sequentialInvoices && results.sequentialInvoices.length > 0) {
            areas.push({ area: 'Sequential Invoices', severity: 'high', count: results.sequentialInvoices.length, message: `${results.sequentialInvoices.length} vendor(s) with sequential patterns` });
        }
        if (results.potentialDuplicates && results.potentialDuplicates.length > 10) {
            areas.push({ area: 'Duplicate Payments', severity: 'high', count: results.potentialDuplicates.length, message: `${results.potentialDuplicates.length} potential duplicates` });
        }
        if (results.benford2DAnalysis && results.benford2DAnalysis.approvalLimitRisk && results.benford2DAnalysis.nineEndingAnomalies) {
            areas.push({ area: 'Approval Limit Avoidance', severity: 'high', count: results.benford2DAnalysis.nineEndingAnomalies.length, message: 'Unusual 9-ending amounts detected' });
        }
        return areas.sort((a, b) => ({ critical: 0, high: 1, medium: 2 }[a.severity] || 3) - ({ critical: 0, high: 1, medium: 2 }[b.severity] || 3));
    }
    
    function generateAIContext(results) {
        const recs = [];
        const summary = results.summary || {};
        const flagged = results.flaggedTransactions || [];

        if (results.ghostVendors && results.ghostVendors.length > 0) {
            recs.push({ priority: 'critical', title: 'Investigate Ghost Vendors', description: `${results.ghostVendors.length} vendor(s) share addresses with employees.` });
        }
        if (results.sequentialInvoices && results.sequentialInvoices.length > 0) {
            recs.push({ priority: 'high', title: 'Review Sequential Invoice Vendors', description: `${results.sequentialInvoices.length} vendor(s) with sequential invoices.` });
        }
        if (summary.approvalLimitRisk) {
            recs.push({ priority: 'high', title: 'Review Approval Limit Patterns', description: 'Unusual 9-ending amounts detected.' });
        }
        const riskScore = summary.overallRiskScore || 0;
        return { recommendations: recs, summary: { totalFlags: flagged.length, riskLevel: riskScore >= 70 ? 'HIGH' : riskScore >= 40 ? 'MEDIUM' : 'LOW' } };
    }

    // ==========================================
    // UTILITIES
    // ==========================================
    
    // Note: runSuiteQL is imported from Lib_Core
    
    function getDefaultStartDate() {
        const d = new Date();
        d.setMonth(d.getMonth() - 3);
        return d.toISOString().split('T')[0];
    }
    
    // Core.getDefaultEndDate() removed - use Core.Core.getDefaultEndDate()

    function daysBetween(start, end) {
        return Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24));
    }
    
    function getDefaultConfig() {
        return {
            duplicateThresholdDays: DUPLICATE_THRESHOLD_DAYS,
            duplicateMinAmount: DUPLICATE_MIN_AMOUNT,
            benfordMinTransactions: BENFORD_MIN_TRANSACTIONS,
            weekendHighRiskAmount: 5000,
            approvalThreshold: 5000,
            highRiskAmount: HIGH_RISK_AMOUNT,
            criticalRiskAmount: CRITICAL_RISK_AMOUNT,
            zScoreThreshold: Z_SCORE_THRESHOLD,
            rsfThreshold: RSF_THRESHOLD,
            excludedVendors: [],
            excludedAccounts: [],
            excludedUsers: [],
            excludedTranTypes: []
        };
    }

    // Alias for router compatibility - router calls getData()
    function getData(params) {
        return analyzeIntegrity(params);
    }

    /**
     * Get exclusion options for configuration panel (users, vendors, accounts)
     */
    function getExclusionOptions() {
        const options = {
            vendors: [],
            users: [],
            accounts: [],
            tranTypes: [
                { id: 'VendBill', name: 'Vendor Bill' },
                { id: 'Check', name: 'Check' },
                { id: 'VendPymt', name: 'Vendor Payment' },
                { id: 'ExpRept', name: 'Expense Report' },
                { id: 'Journal', name: 'Journal Entry' },
                { id: 'VendCred', name: 'Vendor Credit' }
            ]
        };
        
        try {
            // Get active vendors (limit to 500 for performance)
            const vendorSql = `
                SELECT id, BUILTIN.DF(id) AS name
                FROM Vendor
                WHERE isinactive = 'F'
                ORDER BY BUILTIN.DF(id)
                FETCH FIRST 500 ROWS ONLY
            `;
            const vendorResults = runSuiteQL(vendorSql);
            options.vendors = (vendorResults || []).map(v => ({ id: String(v.id), name: v.name || 'Vendor #' + v.id }));
        } catch (e) {
            log.error('Get Vendors Error', e.message);
        }
        
        try {
            // Get active employees/users
            const userSql = `
                SELECT id, BUILTIN.DF(id) AS name
                FROM Employee
                WHERE isinactive = 'F'
                ORDER BY BUILTIN.DF(id)
                FETCH FIRST 200 ROWS ONLY
            `;
            const userResults = runSuiteQL(userSql);
            options.users = (userResults || []).map(u => ({ id: String(u.id), name: u.name || 'User #' + u.id }));
        } catch (e) {
            log.error('Get Users Error', e.message);
        }
        
        try {
            // Get expense/liability accounts
            const accountSql = `
                SELECT id, BUILTIN.DF(id) AS name
                FROM Account
                WHERE isinactive = 'F'
                  AND acctnumber IS NOT NULL
                ORDER BY acctnumber
                FETCH FIRST 300 ROWS ONLY
            `;
            const accountResults = runSuiteQL(accountSql);
            options.accounts = (accountResults || []).map(a => ({ id: String(a.id), name: a.name || 'Account #' + a.id }));
        } catch (e) {
            log.error('Get Accounts Error', e.message);
        }
        
        return options;
    }

    /**
     * Handle sub-action requests (flyouts, drilldowns)
     * Matches pattern used by SpendVelocity, CustomerValue
     */
    function handleRequest(params) {
        const subAction = params.subAction || '';
        
        switch (subAction) {
            case 'audit_record_detail':
                return {
                    status: 'success',
                    data: getAuditRecordDetail(
                        params.recordId,
                        params.startDate,
                        params.endDate
                    )
                };
            
            case 'get_exclusion_options':
                return {
                    status: 'success',
                    data: getExclusionOptions()
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
            
            case 'user_transactions':
                return {
                    status: 'success',
                    transactions: getUserTransactions(
                        params.userId,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
            
            case 'weekend_user_entries':
                return {
                    status: 'success',
                    transactions: getWeekendUserEntries(
                        params.userId,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
            
            case 'sequential_detail':
                return {
                    status: 'success',
                    data: getSequentialDetail(
                        params.pattern,
                        params.startDate,
                        params.endDate,
                        params.subsidiaryId
                    )
                };
                
            default:
                return {
                    status: 'error',
                    message: 'Unknown subAction: ' + subAction
                };
        }
    }
    
    /**
     * Get transactions for a specific vendor (for flyout)
     */
    function getVendorTransactions(vendorId, startDate, endDate, subsidiaryId) {
        if (!vendorId) return [];
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        
        const sql = `
            SELECT T.id, T.tranid, TO_CHAR(T.trandate, 'MM/DD/YYYY') AS trandate, 
                T.type, ABS(T.foreigntotal) AS amount,
                BUILTIN.DF(TL.entity) AS entityName
            FROM Transaction T
            LEFT JOIN TransactionLine TL ON T.id = TL.transaction AND TL.mainline = 'F'
            WHERE TL.entity = ${vendorId}
                AND T.trandate >= TO_DATE('${startDate || getDefaultStartDate()}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate || Core.getDefaultEndDate()}', 'YYYY-MM-DD')
                AND T.type IN (${VENDOR_TRAN_TYPES})
                ${subFilter}
            ORDER BY T.trandate DESC
            FETCH FIRST 100 ROWS ONLY
        `;
        
        try {
            const results = runSuiteQL(sql);
            return (results || []).map(row => ({
                id: row.id,
                tranId: row.tranid,
                tranDate: row.trandate,
                type: row.type,
                amount: parseFloat(row.amount) || 0,
                entityName: row.entityname || 'Unknown Vendor'
            }));
        } catch (e) {
            log.error('Vendor Transactions Error', e.message);
            return [];
        }
    }
    
    /**
     * Get transactions created by a specific user (for flyout)
     */
    function getUserTransactions(userId, startDate, endDate, subsidiaryId) {
        if (!userId) return [];
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        
        // Filter by createdby to get transactions created by this user
        const sql = `
            SELECT T.id, T.tranid, TO_CHAR(T.trandate, 'MM/DD/YYYY') AS trandate, 
                T.type, ABS(T.foreigntotal) AS amount,
                BUILTIN.DF(TL.entity) AS entityName,
                BUILTIN.DF(T.createdby) AS createdBy
            FROM Transaction T
            LEFT JOIN TransactionLine TL ON T.id = TL.transaction AND TL.mainline = 'T'
            WHERE T.createdby = ${userId}
                AND T.trandate >= TO_DATE('${startDate || getDefaultStartDate()}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate || Core.getDefaultEndDate()}', 'YYYY-MM-DD')
                ${subFilter}
            ORDER BY T.trandate DESC
            FETCH FIRST 100 ROWS ONLY
        `;
        
        try {
            const results = runSuiteQL(sql);
            return (results || []).map(row => ({
                id: row.id,
                tranId: row.tranid,
                tranDate: row.trandate,
                type: row.type,
                amount: parseFloat(row.amount) || 0,
                entityName: row.entityname || '-',
                createdBy: row.createdby || '-'
            }));
        } catch (e) {
            log.error('User Transactions Error', e.message);
            return [];
        }
    }
    
    /**
     * Get weekend entries for a specific user (for flyout)
     */
    function getWeekendUserEntries(userId, startDate, endDate, subsidiaryId) {
        if (!userId) return [];
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        
        const sql = `
            SELECT T.id, T.tranid, TO_CHAR(T.trandate, 'MM/DD/YYYY') AS trandate, 
                T.type, ABS(T.foreigntotal) AS amount,
                UPPER(TRIM(TO_CHAR(T.trandate, 'DY'))) AS day_name,
                BUILTIN.DF(TL.entity) AS entityName,
                BUILTIN.DF(T.createdby) AS createdBy
            FROM Transaction T
            LEFT JOIN TransactionLine TL ON T.id = TL.transaction AND TL.mainline = 'T'
            WHERE T.createdby = ${userId}
                AND T.trandate >= TO_DATE('${startDate || getDefaultStartDate()}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate || Core.getDefaultEndDate()}', 'YYYY-MM-DD')
                AND (UPPER(TRIM(TO_CHAR(T.trandate, 'DY'))) IN ('SAT', 'SUN')
                     OR UPPER(TRIM(TO_CHAR(T.trandate, 'DAY'))) IN ('SATURDAY', 'SUNDAY'))
                ${subFilter}
            ORDER BY T.trandate DESC
            FETCH FIRST 100 ROWS ONLY
        `;
        
        try {
            const results = runSuiteQL(sql);
            return (results || []).map(row => {
                const dayName = (row.day_name || '').toUpperCase();
                const isSunday = dayName.includes('SUN');
                return {
                    id: row.id,
                    tranId: row.tranid,
                    tranDate: row.trandate,
                    type: row.type,
                    amount: parseFloat(row.amount) || 0,
                    dayType: isSunday ? 'Sunday' : 'Saturday',
                    entityName: row.entityname || '-',
                    createdBy: row.createdby || '-'
                };
            });
        } catch (e) {
            log.error('Weekend User Entries Error', e.message);
            return [];
        }
    }
    
    /**
     * Get sequential invoice detail with entity information (for flyout)
     */
    function getSequentialDetail(pattern, startDate, endDate, subsidiaryId) {
        if (!pattern) return { invoices: [], entityName: null };
        const subFilter = subsidiaryId ? `AND T.subsidiary = ${subsidiaryId}` : '';
        
        // Pattern contains startInvoice and endInvoice numbers
        const startNum = pattern.startInvoice || pattern.startNum;
        const endNum = pattern.endInvoice || pattern.endNum;
        
        if (!startNum || !endNum) return { invoices: [], entityName: null };
        
        // Get the transaction IDs and entity info for the sequential range
        const sql = `
            SELECT T.id, T.tranid, TO_CHAR(T.trandate, 'MM/DD/YYYY') AS trandate, 
                T.type, ABS(T.foreigntotal) AS amount,
                TL.entity AS entityId, BUILTIN.DF(TL.entity) AS entityName
            FROM Transaction T
            LEFT JOIN TransactionLine TL ON T.id = TL.transaction AND TL.mainline = 'T'
            WHERE T.type IN ('VendBill', 'Bill', 'vendorbill')
                AND T.trandate >= TO_DATE('${startDate || getDefaultStartDate()}', 'YYYY-MM-DD')
                AND T.trandate <= TO_DATE('${endDate || Core.getDefaultEndDate()}', 'YYYY-MM-DD')
                ${subFilter}
            ORDER BY T.tranid
        `;
        
        try {
            const results = runSuiteQL(sql);
            if (!results || results.length === 0) return { invoices: [], entityName: null };
            
            // Filter to invoices in the sequential range
            const invoices = [];
            let entityName = null;
            let entityId = null;
            
            results.forEach(row => {
                const invNum = extractInvoiceNumber(row.tranid);
                if (invNum !== null && invNum >= startNum && invNum <= endNum) {
                    invoices.push({
                        id: row.id,
                        tranId: row.tranid,
                        tranDate: row.trandate,
                        amount: parseFloat(row.amount) || 0,
                        invoiceNum: invNum,
                        entityName: row.entityname
                    });
                    if (!entityName && row.entityname) {
                        entityName = row.entityname;
                        entityId = row.entityid;
                    }
                }
            });
            
            return {
                invoices: invoices.sort((a, b) => a.invoiceNum - b.invoiceNum),
                entityName: entityName,
                entityId: entityId,
                startInvoice: startNum,
                endInvoice: endNum,
                count: invoices.length,
                totalAmount: invoices.reduce((s, i) => s + i.amount, 0)
            };
        } catch (e) {
            log.error('Sequential Detail Error', e.message);
            return { invoices: [], entityName: null };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SCORE-ONLY FUNCTION - Lightweight score computation for dashboard overview
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get integrity score only - minimal queries for fast app load
     * Score is INVERTED (100 = clean, 0 = many issues) unlike internal risk score
     * @returns {Object} { score: 0-100, grade: 'A'-'F', label: string, trend: string }
     */
    function getScoreOnly() {
        try {
            var riskScore = 0;
            var today = new Date();
            var endDate = today.toISOString().split('T')[0];
            var startDate = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()).toISOString().split('T')[0];

            // Count key risk indicators with minimal queries
            var duplicateCount = 0, weekendCount = 0, ghostCount = 0;

            // 1. Potential duplicates (single query)
            try {
                var dupSql = "SELECT COUNT(*) as cnt FROM ( " +
                    "SELECT t1.id FROM transaction t1 " +
                    "JOIN transaction t2 ON t1.id < t2.id AND t1.entity = t2.entity " +
                    "AND ABS(t1.foreigntotal) = ABS(t2.foreigntotal) AND ABS(t1.foreigntotal) > 100 " +
                    "AND ABS(TRUNC(t1.trandate) - TRUNC(t2.trandate)) <= 30 " +
                    "AND t1.type IN ('VendBill', 'Check') AND t2.type IN ('VendBill', 'Check') " +
                    "AND t1.trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
                    "FETCH FIRST 50 ROWS ONLY)";
                var dupResult = Core.runQuery(dupSql);
                if (dupResult && dupResult.length > 0) {
                    duplicateCount = parseInt(dupResult[0].cnt) || 0;
                }
            } catch (e) { log.debug('Dup Query', e.message); }

            // 2. Weekend entries (single query)
            try {
                var wkndSql = "SELECT COUNT(*) as cnt FROM transaction " +
                    "WHERE type IN ('VendBill', 'Check', 'ExpRept') " +
                    "AND trandate >= TO_DATE('" + startDate + "', 'YYYY-MM-DD') " +
                    "AND TO_CHAR(trandate, 'DY') IN ('SAT', 'SUN') " +
                    "AND ABS(foreigntotal) > 1000";
                var wkndResult = Core.runQuery(wkndSql);
                if (wkndResult && wkndResult.length > 0) {
                    weekendCount = parseInt(wkndResult[0].cnt) || 0;
                }
            } catch (e) { log.debug('Weekend Query', e.message); }

            // Calculate risk score using simplified formula
            if (duplicateCount > 10) riskScore += 15;
            else if (duplicateCount > 5) riskScore += 10;
            else if (duplicateCount > 0) riskScore += 5;

            if (weekendCount > 20) riskScore += 15;
            else if (weekendCount > 10) riskScore += 10;
            else if (weekendCount > 5) riskScore += 5;

            // Cap at 100
            riskScore = Math.min(100, riskScore);

            // INVERT: Integrity score = 100 - risk score (higher is better)
            var score = 100 - riskScore;

            var grade = 'A';
            var label = 'Clean';
            if (score < 50) { grade = 'F'; label = 'High Risk'; }
            else if (score < 60) { grade = 'D'; label = 'Elevated Risk'; }
            else if (score < 70) { grade = 'C'; label = 'Moderate Risk'; }
            else if (score < 80) { grade = 'B'; label = 'Low Risk'; }
            else if (score < 95) { grade = 'A'; label = 'Very Clean'; }
            else { grade = 'A+'; label = 'Excellent'; }

            var trend = 'stable';
            if (duplicateCount > 10 || weekendCount > 15) trend = 'down';
            else if (duplicateCount === 0 && weekendCount < 3) trend = 'up';

            return {
                score: Math.round(score),
                grade: grade,
                label: label,
                trend: trend,
                details: {
                    riskScore: riskScore,
                    duplicateCount: duplicateCount,
                    weekendCount: weekendCount
                }
            };
        } catch (e) {
            log.error('Integrity getScoreOnly Error', e.message);
            return { score: 85, grade: 'A', label: 'Unknown', trend: 'stable', error: e.message };
        }
    }

    return {
        getData,  // Router expects this
        handleRequest,  // For flyout/drilldown sub-actions
        analyzeIntegrity,
        getExclusionOptions,
        detectDuplicatesSQL,
        analyzeBenfordSQL,
        analyzeWeekendSQL,
        analyzeRSF,
        analyzeZScores,
        detectSequentialInvoices,
        detectGhostVendors,
        analyzeAuditTrail,
        getAuditRecordDetail,
        getDefaultConfig,
        getVendorTransactions,
        getUserTransactions,
        getWeekendUserEntries,
        getSequentialDetail,
        getScoreOnly
    };
});