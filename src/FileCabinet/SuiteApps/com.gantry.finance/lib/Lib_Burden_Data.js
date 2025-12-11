/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module Lib_Burden_Data
 * @description Rate Engine 2.0 - World-Class Overhead Rate Calculator
 * 
 * CAPABILITIES:
 * - Multi-base allocation (hours, labor$, headcount, revenue, direct cost)
 * - Config-based account classification with pattern matching
 * - Per-category allocation settings (base, scope, method)
 * - Composite rate calculation across all bases
 * - Full pagination support for all tables
 * - Transaction-level drilldown (account, category, dept, cell)
 * - Category trend history for charts
 * - Saved scenarios CRUD
 * - Budget variance tracking
 * - Export-ready data formats
 */
define(["N/query", "N/search", "N/log", "N/runtime", "./Lib_Shared", "./Lib_Config", "./advisor/Lib_Advisor_Utils"], function (
    query,
    search,
    log,
    runtime,
    Shared,
    ConfigLib,
    Utils
) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // DEBUG LOGGING HELPERS
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Cache debug mode to avoid repeated config lookups
    let _debugModeCache = null;
    let _debugModeCacheTime = 0;
    const DEBUG_CACHE_TTL = 60000; // 1 minute cache
    
    function isDebugMode() {
        const now = Date.now();
        if (_debugModeCache === null || (now - _debugModeCacheTime) > DEBUG_CACHE_TTL) {
            _debugModeCache = Utils.isDebugMode();
            _debugModeCacheTime = now;
        }
        return _debugModeCache;
    }
    
    // Conditional logging - only logs if debug mode is enabled
    function debugLog(title, details) {
        if (isDebugMode()) {
            log.debug(title, details);
        }
    }
    
    function auditLog(title, details) {
        if (isDebugMode()) {
            log.audit(title, details);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    const CATEGORY_TEMPLATES = [
        { 
            id: 'L', 
            label: 'Indirect Labour', 
            order: 1, 
            color: '#3b82f6', 
            categoryType: 'expense',
            allocationBase: 'billed_hours', 
            allocationMethod: 'simple',
            scope: 'department', 
            rateFormat: 'per_hour',
            includeInComposite: true,
            patterns: ['indirect', 'supervision', 'foreman'] 
        },
        { 
            id: 'EMC', 
            label: 'Equipment & Consumables', 
            order: 2, 
            color: '#10b981', 
            categoryType: 'expense',
            allocationBase: 'billed_hours', 
            allocationMethod: 'simple',
            scope: 'department', 
            rateFormat: 'per_hour',
            includeInComposite: true,
            patterns: ['equipment', 'tools', 'supplies', 'consumable'] 
        },
        { 
            id: 'T', 
            label: 'Training & Safety', 
            order: 3, 
            color: '#f59e0b', 
            categoryType: 'expense',
            allocationBase: 'billed_hours', 
            allocationMethod: 'simple',
            scope: 'department', 
            rateFormat: 'per_hour',
            includeInComposite: true,
            patterns: ['training', 'safety', 'environment'] 
        },
        { 
            id: 'A', 
            label: 'Admin & Executive', 
            order: 4, 
            color: '#8b5cf6', 
            categoryType: 'expense',
            allocationBase: 'headcount', 
            allocationMethod: 'simple',
            scope: 'company', 
            rateFormat: 'per_hour',
            includeInComposite: true,
            patterns: ['admin', 'executive', 'payroll', 'management'] 
        },
        { 
            id: 'O', 
            label: 'Office & Facilities', 
            order: 5, 
            color: '#ec4899', 
            categoryType: 'expense',
            allocationBase: 'headcount', 
            allocationMethod: 'simple',
            scope: 'company', 
            rateFormat: 'per_hour',
            includeInComposite: true,
            patterns: ['office', 'rent', 'utilities', 'facilities', 'insurance'] 
        }
    ];

    // All supported allocation bases
    const ALLOCATION_BASES = {
        billed_hours: { label: 'Billed Hours', unit: 'hrs', icon: 'clock', format: 'number' },
        total_hours: { label: 'Total Hours', unit: 'hrs', icon: 'clock', format: 'number' },
        labor_dollars: { label: 'Labor Dollars', unit: '$', icon: 'dollar-sign', format: 'currency' },
        headcount: { label: 'Headcount', unit: 'FTE', icon: 'users', format: 'number' },
        revenue: { label: 'Revenue', unit: '$', icon: 'chart-line', format: 'currency' },
        direct_cost: { label: 'Direct Cost', unit: '$', icon: 'receipt', format: 'currency' },
        square_feet: { label: 'Square Feet', unit: 'sqft', icon: 'building', format: 'number' },
        units: { label: 'Units Produced', unit: 'units', icon: 'boxes', format: 'number' },
        custom: { label: 'Custom Metric', unit: 'custom', icon: 'sliders-h', format: 'number' }
    };

    // Allocation methods
    const ALLOCATION_METHODS = {
        simple: { 
            label: 'Simple Division', 
            description: 'Rate = Total Expense / Total Base',
            formula: 'expense / base'
        },
        weighted: { 
            label: 'Weighted', 
            description: 'Rate = Σ(Expense × Weight) / Σ(Base × Weight)',
            formula: 'weighted_expense / weighted_base'
        },
        stepped: { 
            label: 'Stepped/Tiered', 
            description: 'Different rates based on volume thresholds',
            formula: 'tiered_lookup'
        }
    };

    // Rate output formats
    const RATE_FORMATS = {
        per_hour: { 
            label: '$/Hour', 
            suffix: '/hr', 
            prefix: '$',
            decimals: 2,
            unit: 'hour'
        },
        percent_labor: { 
            label: '% of Labor', 
            suffix: '%', 
            prefix: '',
            decimals: 1,
            unit: 'percent'
        },
        percent_cost: { 
            label: '% of Cost', 
            suffix: '%', 
            prefix: '',
            decimals: 1,
            unit: 'percent'
        },
        per_fte: { 
            label: '$/FTE', 
            suffix: '/FTE', 
            prefix: '$',
            decimals: 0,
            unit: 'fte'
        },
        per_unit: { 
            label: '$/Unit', 
            suffix: '/unit', 
            prefix: '$',
            decimals: 2,
            unit: 'unit'
        }
    };

    // Composite rate calculation methods
    const COMPOSITE_METHODS = {
        sum: {
            label: 'Sum',
            description: 'Add all category rates together'
        },
        weighted: {
            label: 'Weighted',
            description: 'Weight by expense volume'
        },
        cascading: {
            label: 'Cascading/Wrap',
            description: 'Each layer applies to running subtotal'
        }
    };

    const DEFAULT_PAGE_SIZE = 25;
    const MAX_TRANSACTIONS = 500;

    // ═══════════════════════════════════════════════════════════════════════════
    // PROFILE HELPER
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Get the active profile from config, with fallback to default
     * All profile-specific data (accountMappings, categories, excludedAccounts) 
     * should be stored in the profile, NOT at the root config level.
     */
    function getActiveProfile(config) {
        // Ensure profiles array exists
        if (!config.profiles) config.profiles = [];
        
        const profiles = config.profiles;
        const activeProfileId = config.activeProfileId || 'default';
        
        let profile = profiles.find(p => p.id === activeProfileId);
        
        // If no profile found, CREATE and ADD to config.profiles
        // This ensures modifications are saved when config is saved
        if (!profile) {
            profile = {
                id: 'default',
                name: 'Default',
                color: '#3b82f6',
                isDefault: true,
                categories: [],  // Empty - wizard will populate
                accountMappings: {},
                excludedAccounts: []
            };
            // CRITICAL: Add to config.profiles so it persists when config is saved
            config.profiles.push(profile);
            config.activeProfileId = 'default';
        }
        
        // Ensure profile has required properties (but don't auto-populate categories)
        if (!profile.categories) profile.categories = [];
        if (!profile.accountMappings) profile.accountMappings = {};
        if (!profile.excludedAccounts) profile.excludedAccounts = [];
        
        // ═══════════════════════════════════════════════════════════════════════════
        // MIGRATE CONFIG SETTINGS TO PROFILE LEVEL
        // All settings should live on the profile, with fallback to root config for
        // backwards compatibility during migration
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Absorption tracking
        if (profile.burdenAppliedAccountIds === undefined) {
            profile.burdenAppliedAccountIds = config.burdenAppliedAccountIds || [];
        }
        if (profile.burdenAppliedAccountNumberPattern === undefined) {
            profile.burdenAppliedAccountNumberPattern = config.burdenAppliedAccountNumberPattern || '500%';
        }
        if (profile.burdenAppliedAccountNamePattern === undefined) {
            profile.burdenAppliedAccountNamePattern = config.burdenAppliedAccountNamePattern || '%burden applied%';
        }
        
        // Labor settings
        if (profile.laborOverheadFactor === undefined) {
            profile.laborOverheadFactor = config.laborOverheadFactor || 1.15;
        }
        if (profile.laborCostFieldId === undefined) {
            profile.laborCostFieldId = config.laborCostFieldId || 'laborcost';
        }
        
        // Department visibility
        if (profile.burdenHiddenDepts === undefined) {
            profile.burdenHiddenDepts = config.burdenHiddenDepts || [];
        }
        
        // Unbilled hours settings
        if (profile.unbilledHoursMode === undefined) {
            profile.unbilledHoursMode = config.unbilledHoursMode || 'all';
        }
        if (profile.unbilledHoursDepts === undefined) {
            profile.unbilledHoursDepts = config.unbilledHoursDepts || [];
        }
        if (profile.unbilledItemPattern === undefined) {
            profile.unbilledItemPattern = config.unbilledItemPattern || '%Direct Labour%';
        }
        
        // Rates and budgets
        if (profile.budgetedRates === undefined) {
            profile.budgetedRates = config.budgetedRates || {};
        }
        if (profile.compositeRate === undefined) {
            profile.compositeRate = config.compositeRate || { method: 'sum' };
        }
        if (profile.categoryWeights === undefined) {
            profile.categoryWeights = config.categoryWeights || {};
        }
        if (profile.rateTiers === undefined) {
            profile.rateTiers = config.rateTiers || {};
        }
        
        // Forecast
        if (profile.forecastAssumptions === undefined) {
            profile.forecastAssumptions = config.forecastAssumptions || {};
        }
        
        // Global exclusions
        if (profile.globalExcludeEmpTypes === undefined) {
            profile.globalExcludeEmpTypes = config.globalExcludeEmpTypes || [];
        }
        
        // Rate builder
        if (profile.rateBuilder === undefined) {
            profile.rateBuilder = config.rateBuilder || null;
        }
        
        // Saved scenarios
        if (profile.savedScenarios === undefined) {
            profile.savedScenarios = config.savedScenarios || [];
        }
        
        return profile;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN ENTRY POINT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Main data fetch - returns everything needed for dashboard
     * @param {Object} context - Request context with startDate, endDate, lightRefresh flag
     * @param {boolean} context.lightRefresh - If true, skip expensive operations (history, unbilledDetail, forecast)
     */
    function getData(context) {
        const startTime = Date.now();
        const timings = {}; // Track timing for each operation
        
        // Check for light refresh mode - skips expensive historical calculations
        const lightRefresh = context.lightRefresh === true || context.lightRefresh === 'true';
        
        if (lightRefresh) {
            auditLog('GET_DATA', 'LIGHT REFRESH MODE - skipping history, unbilledDetail, forecast');
        }
        
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        
        // AUDIT LOG: Track what config was loaded
        auditLog('GET_DATA_CONFIG_LOADED', 'Profile: ' + profile.id + ', accountMappings count: ' + Object.keys(profile.accountMappings || {}).length + 
            ', categories count: ' + (profile.categories || []).length);
        
        // ALL SETTINGS NOW READ FROM PROFILE (with migration fallback built into getActiveProfile)
        const laborOverheadFactor = parseFloat(profile.laborOverheadFactor) || 1.15;

        // Date range
        let t0 = Date.now();
        const { start, end } = resolveDateRange(context, config);
        timings.dateRange = Date.now() - t0;

        // Get profiles for profile selector
        const profiles = config.profiles || [{ id: 'default', name: 'Default', color: '#3b82f6', isDefault: true }];
        const activeProfileId = config.activeProfileId || 'default';

        // Core data
        t0 = Date.now();
        const allDepts = getAllDepartments();
        timings.getDepartments = Date.now() - t0;
        
        const hiddenDepts = profile.burdenHiddenDepts || [];
        const activeDepts = allDepts.filter(d => !hiddenDepts.includes(String(d.id)));
        const categories = profile.categories || [];
        
        t0 = Date.now();
        const allAccounts = loadAllExpenseAccounts();
        timings.loadAccounts = Date.now() - t0;

        // Classification - pass profile for accountMappings
        t0 = Date.now();
        const classified = classifyAccounts(allAccounts, profile, categories);
        timings.classifyAccounts = Date.now() - t0;

        // Allocation bases (pass profile for custom bases like square_feet, units, custom)
        t0 = Date.now();
        const allocationBases = fetchAllAllocationBases(start, end, activeDepts, profile);
        timings.fetchAllocationBases = Date.now() - t0;

        // Financial data
        t0 = Date.now();
        const financialData = fetchFinancialsDetailed(start, end);
        timings.fetchFinancials = Date.now() - t0;
        
        t0 = Date.now();
        const processedFinancials = processFinancials(financialData, activeDepts, allAccounts);
        timings.processFinancials = Date.now() - t0;

        // Unbilled hours
        const unbilledMode = profile.unbilledHoursMode || 'all';
        t0 = Date.now();
        const unbilledLabourData = fetchUnbilledLabour(start, end, activeDepts, laborOverheadFactor, profile);
        timings.fetchUnbilledLabour = Date.now() - t0;

        // Build summary with rates
        t0 = Date.now();
        const summary = buildSummaryMultiBase(
            processedFinancials,
            allocationBases,
            activeDepts,
            unbilledLabourData,
            profile,
            classified,
            categories,
            start,
            end
        );
        timings.buildSummary = Date.now() - t0;

        // Burden applied (absorption)
        t0 = Date.now();
        const burdenApplied = fetchBurdenApplied(start, end, profile);
        timings.fetchBurdenApplied = Date.now() - t0;

        // Historical data - SKIP IN LIGHT REFRESH MODE
        // This is the most expensive operation (~2+ seconds)
        let history = null;
        let categoryHistory = null;
        if (!lightRefresh) {
            t0 = Date.now();
            const historyResult = calculateCombinedHistory(start, end, activeDepts, profile, laborOverheadFactor, categories, classified);
            history = historyResult.history;
            categoryHistory = historyResult.categoryHistory;
            timings.calculateHistory = Date.now() - t0;
        } else {
            timings.calculateHistory = 0;
            auditLog('GET_DATA', 'Skipped calculateHistory (light refresh)');
        }

        // Budget variance
        t0 = Date.now();
        const budgetVariance = calculateBudgetVariance(summary, profile, activeDepts);
        timings.budgetVariance = Date.now() - t0;

        // Unbilled detail by employee - SKIP IN LIGHT REFRESH MODE
        let unbilledDetail = null;
        if (!lightRefresh && unbilledMode !== 'disabled') {
            t0 = Date.now();
            unbilledDetail = fetchUnbilledDetailByEmployee(start, end, activeDepts, laborOverheadFactor, profile);
            timings.unbilledDetail = Date.now() - t0;
        } else {
            timings.unbilledDetail = 0;
            if (lightRefresh) {
                auditLog('GET_DATA', 'Skipped unbilledDetail (light refresh)');
            }
        }

        // Absorption analysis
        const absorption = {
            actual: summary.totalExpense,
            applied: burdenApplied,
            variance: burdenApplied - summary.totalExpense,
            variancePercent: summary.totalExpense > 0 ? ((burdenApplied - summary.totalExpense) / summary.totalExpense) * 100 : 0,
            status: burdenApplied >= summary.totalExpense ? 'over_absorbed' : 'under_absorbed'
        };

        // Alerts
        t0 = Date.now();
        const alerts = generateAlerts(summary, absorption, classified, budgetVariance, profile);
        timings.generateAlerts = Date.now() - t0;

        // Saved scenarios
        const savedScenarios = profile.savedScenarios || [];

        // Rate forecast - SKIP IN LIGHT REFRESH MODE (depends on history)
        let forecast = null;
        if (!lightRefresh && history) {
            t0 = Date.now();
            forecast = forecastRates(
                { periods: history.periods, categoryTrends: categoryHistory },
                profile,
                summary
            );
            timings.forecast = Date.now() - t0;
        } else {
            timings.forecast = 0;
            if (lightRefresh) {
                auditLog('GET_DATA', 'Skipped forecast (light refresh)');
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // SINGLE SOURCE OF TRUTH: Calculate per-department composite rates from summary
        // ═══════════════════════════════════════════════════════════════════════════
        // The summary already has correctly calculated expense per dept for ALL category types
        // (expense, timebill, manual, derived, formula). Sum them up per department.
        const compositeByDept = {};
        
        activeDepts.forEach(d => {
            const deptId = d.id;
            const deptIdStr = String(d.id);
            const deptHoursObj = allocationBases.hours?.byDept?.[deptId] || {};
            const deptHours = deptHoursObj.billed || 0;
            
            // Sum expense from ALL categories for this department
            let deptExpense = 0;
            (summary.categories || []).forEach(cat => {
                // Only include categories that contribute to composite
                if (cat.includeInComposite !== false) {
                    const catExpense = cat.expense?.[deptId] || cat.expense?.[deptIdStr] || 0;
                    deptExpense += catExpense;
                }
            });
            
            compositeByDept[deptId] = deptHours > 0 ? deptExpense / deptHours : 0;
        });

        // Calculate total time and log
        timings.total = Date.now() - startTime;
        debugLog('getData', 'Completed in ' + timings.total + 'ms');
        
        // Sort timings by duration for easy identification of slow operations
        const sortedTimings = Object.entries(timings)
            .filter(([k]) => k !== 'total')
            .sort((a, b) => b[1] - a[1])
            .reduce((obj, [k, v]) => { obj[k] = v; return obj; }, {});
        sortedTimings.total = timings.total;
        
        // Log diagnostics
        debugLog('getData diagnostics', {
            totalMs: timings.total,
            slowest: Object.keys(sortedTimings).slice(0, 3).join(', ')
        });

        return {
            meta: {
                startDate: start,
                endDate: end,
                generatedAt: new Date().toISOString(),
                lightRefresh: lightRefresh, // Flag so frontend knows to merge data
                departments: activeDepts,
                allDepartments: allDepts,
                laborOverheadFactor: laborOverheadFactor,
                allocationBases: ALLOCATION_BASES,
                allocationMethods: ALLOCATION_METHODS,
                rateFormats: RATE_FORMATS,
                compositeMethods: COMPOSITE_METHODS,
                categoryDefinitions: categories,
                profiles: profiles.map(p => ({ 
                    id: p.id, 
                    name: p.name, 
                    color: p.color || '#6b7280', 
                    isDefault: p.isDefault || false,
                    description: p.description || '',
                    categoryCount: (p.categories || []).length
                })),
                activeProfileId: activeProfileId,
                config: {
                    // ALL CONFIG NOW READS FROM PROFILE
                    burdenAppliedAccountIds: profile.burdenAppliedAccountIds || [],
                    burdenAppliedAccountNumberPattern: profile.burdenAppliedAccountNumberPattern || '500%',
                    burdenAppliedAccountNamePattern: profile.burdenAppliedAccountNamePattern || '%burden applied%',
                    laborOverheadFactor: profile.laborOverheadFactor || 1.15,
                    laborCostFieldId: profile.laborCostFieldId || 'laborcost',
                    unbilledHoursMode: unbilledMode,
                    unbilledHoursDepts: profile.unbilledHoursDepts || [],
                    unbilledItemPattern: profile.unbilledItemPattern || '%Direct Labour%',
                    budgetedRates: profile.budgetedRates || {},
                    compositeRate: profile.compositeRate || { method: 'sum' },
                    categoryWeights: profile.categoryWeights || {},
                    rateTiers: profile.rateTiers || {},
                    forecastAssumptions: profile.forecastAssumptions || {},
                    globalExcludeEmpTypes: profile.globalExcludeEmpTypes || [],
                    burdenHiddenDepts: profile.burdenHiddenDepts || [],
                    rateBuilder: profile.rateBuilder || null
                }
            },
            kpis: {
                compositeRate: summary.compositeRate,
                compositeRateInfo: summary.compositeRateInfo,
                compositeRateChange: history ? history.rateChange : null,
                totalExpenses: summary.totalExpense,
                burdenApplied: burdenApplied,
                spread: absorption.variance,
                spreadPercent: absorption.variancePercent,
                billedHours: allocationBases.hours.totalBilled,
                utilization: allocationBases.hours.totalBilled / (allocationBases.hours.total || 1)
            },
            absorption: absorption,
            allocationBases: {
                hours: allocationBases.hours,
                laborDollars: allocationBases.laborDollars,
                headcount: allocationBases.headcount,
                revenue: allocationBases.revenue,
                directCost: allocationBases.directCost,
                squareFeet: allocationBases.squareFeet,
                units: allocationBases.units,
                custom: allocationBases.custom
            },
            summary: {
                categories: summary.categories,
                totals: summary.totals,
                rateMatrix: summary.rateMatrix,
                formattedRates: summary.formattedRates,
                compositeByDept: compositeByDept
            },
            classification: {
                categories: categories,
                byCategory: buildClassificationSummary(classified, categories, processedFinancials),
                unassigned: classified.unassigned.map(a => ({
                    id: a.id,
                    number: a.number,
                    name: a.name,
                    type: a.type,
                    amount: processedFinancials.byAccount[a.id]?.total || 0
                })).sort((a, b) => b.amount - a.amount),
                excluded: classified.excluded,
                stats: {
                    total: allAccounts.length,
                    assigned: allAccounts.length - classified.unassigned.length - classified.excluded.length,
                    unassigned: classified.unassigned.length,
                    excluded: classified.excluded.length,
                    autoMatched: countAutoMatched(classified)
                }
            },
            accounts: {
                burden: summary.burdenDetails,
                all: allAccounts,
                totalCount: allAccounts.length
            },
            hours: {
                byDept: allocationBases.hours.byDept,
                totals: {
                    billed: allocationBases.hours.totalBilled,
                    unbilled: allocationBases.hours.totalUnbilled,
                    total: allocationBases.hours.total
                }
            },
            history: history,
            categoryHistory: categoryHistory,
            budgetVariance: budgetVariance,
            unbilledDetail: unbilledDetail,
            alerts: alerts,
            savedScenarios: savedScenarios,
            forecast: forecast,
            // Include diagnostics only in debug mode
            diagnostics: isDebugMode() ? {
                timings: sortedTimings,
                slowestOperations: Object.entries(sortedTimings)
                    .filter(([k]) => k !== 'total')
                    .slice(0, 5)
                    .map(([name, ms]) => ({ name, ms, percent: Math.round(ms / sortedTimings.total * 100) })),
                counts: {
                    departments: activeDepts.length,
                    accounts: allAccounts.length,
                    categories: categories.length,
                    historyPeriods: (history && history.periods ? history.periods.length : 0)
                }
            } : undefined
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DATE HANDLING
    // ═══════════════════════════════════════════════════════════════════════════

    function resolveDateRange(context, config) {
        const today = new Date();
        const fiscalCalendar = ConfigLib.getFiscalCalendar();
        const fiscalYearStartMonth = fiscalCalendar.fiscalYearStartMonth || 0;

        let end;
        if (context.endDate) {
            end = context.endDate;
        } else {
            // Default to end of last closed month (6 weeks ago)
            const sixWeeksAgo = new Date(today);
            sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
            const lastClosedEnd = new Date(sixWeeksAgo.getFullYear(), sixWeeksAgo.getMonth() + 1, 0);
            end = Shared.formatDateYMD(lastClosedEnd);
        }

        let start;
        if (context.startDate) {
            start = context.startDate;
        } else {
            // Default to fiscal year start
            const endDate = new Date(end);
            const fyYear = endDate.getMonth() < fiscalYearStartMonth ? endDate.getFullYear() - 1 : endDate.getFullYear();
            const fyStart = new Date(fyYear, fiscalYearStartMonth, 1);
            start = Shared.formatDateYMD(fyStart);
        }

        return { start, end };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ACCOUNT LOADING & CLASSIFICATION
    // ═══════════════════════════════════════════════════════════════════════════

    function loadAllExpenseAccounts() {
        // Load expense-type accounts only - balance sheet accounts are not used in burden costing
        const sql = `
            SELECT 
                a.id, 
                a.acctnumber, 
                a.fullname,
                a.accttype,
                a.description,
                a.custrecordincluded_in_burden,
                a.custrecordburden_category
            FROM account a
            WHERE a.accttype IN ('Expense', 'COGS', 'OthExpense')
              AND a.isinactive = 'F'
            ORDER BY a.acctnumber
        `;
        try {
            const results = Shared.runSuiteQL(sql);
            return (results || []).map(r => ({
                id: r.id,
                number: r.acctnumber,
                name: r.fullname,
                type: r.accttype,
                description: r.description,
                includedInBurden: r.custrecordincluded_in_burden,
                burdenCategory: r.custrecordburden_category
            }));
        } catch (e) {
            log.error({ title: 'loadAllExpenseAccounts Error', details: e.message });
            // Try fallback without custom fields
            try {
                const fallbackSql = `
                    SELECT id, acctnumber, fullname, accttype, description
                    FROM account
                    WHERE accttype IN ('Expense', 'COGS', 'OthExpense')
                      AND isinactive = 'F'
                    ORDER BY acctnumber
                `;
                const fallbackResults = Shared.runSuiteQL(fallbackSql);
                return (fallbackResults || []).map(r => ({
                    id: r.id,
                    number: r.acctnumber,
                    name: r.fullname,
                    type: r.accttype,
                    description: r.description
                }));
            } catch (e2) {
                log.error({ title: 'loadAllExpenseAccounts Fallback Error', details: e2.message });
                return [];
            }
        }
    }

    function classifyAccounts(allAccounts, profile, categories) {
        // profile contains accountMappings and excludedAccounts
        const mappings = profile.accountMappings || {};
        const excludedIds = (profile.excludedAccounts || []).map(String);

        const classified = {
            byCategory: {},
            unassigned: [],
            excluded: []
        };

        // Initialize with STRING category IDs
        categories.forEach(cat => {
            classified.byCategory[String(cat.id)] = [];
        });
        
        // Debug: log mapping info
        const mappingCount = Object.keys(mappings).length;
        const confirmedCount = Object.values(mappings).filter(m => m.status === 'confirmed').length;
        const rejectedCount = Object.values(mappings).filter(m => m.status === 'rejected').length;
        auditLog('CLASSIFY_ACCOUNTS', 'Total mappings: ' + mappingCount + ' (confirmed: ' + confirmedCount + ', rejected: ' + rejectedCount + '), Categories: ' + categories.map(c => c.id).join(', '));

        allAccounts.forEach(acct => {
            const acctId = String(acct.id);

            // Check if explicitly excluded
            if (excludedIds.includes(acctId)) {
                classified.excluded.push(acct);
                return;
            }

            // Check explicit mapping
            const mapping = mappings[acctId];
            if (mapping) {
                if (mapping.included === false) {
                    classified.excluded.push(acct);
                } else if (mapping.status === 'rejected') {
                    // Account was explicitly REMOVED from this category - goes to unassigned
                    // Do NOT try pattern matching for rejected accounts
                    classified.unassigned.push(acct);
                } else if (mapping.category) {
                    // Use STRING comparison for category
                    const catIdStr = String(mapping.category);
                    if (classified.byCategory[catIdStr]) {
                        classified.byCategory[catIdStr].push({
                            ...acct,
                            mappingSource: 'explicit'
                        });
                    } else {
                        // Category doesn't exist - log this
                        auditLog('CLASSIFY_ACCOUNTS', 'Mapping category not found: ' + catIdStr + ' for account ' + acctId);
                        classified.unassigned.push(acct);
                    }
                } else {
                    classified.unassigned.push(acct);
                }
                return;
            }

            // Try pattern matching (only for accounts with NO mapping at all)
            const match = findCategoryByPattern(acct, categories);
            if (match) {
                classified.byCategory[String(match.id)].push({
                    ...acct,
                    mappingSource: 'pattern',
                    matchedPattern: match.matchedPattern
                });
                return;
            }

            // Unassigned
            classified.unassigned.push(acct);
        });
        
        // Debug: log result counts
        categories.forEach(cat => {
            const catIdStr = String(cat.id);
            const count = classified.byCategory[catIdStr].length;
            if (count > 0) {
                auditLog('CLASSIFY_RESULT', 'Category ' + catIdStr + ': ' + count + ' accounts');
            }
        });

        return classified;
    }

    function findCategoryByPattern(account, categories) {
        const searchText = `${account.number || ''} ${account.name || ''} ${account.description || ''}`.toLowerCase();

        for (const cat of categories) {
            const patterns = cat.patterns || [];
            for (const pattern of patterns) {
                if (searchText.includes(pattern.toLowerCase())) {
                    return { ...cat, matchedPattern: pattern };
                }
            }
        }
        return null;
    }

    function countAutoMatched(classified) {
        let count = 0;
        Object.values(classified.byCategory).forEach(accounts => {
            accounts.forEach(a => {
                if (a.mappingSource === 'pattern') count++;
            });
        });
        return count;
    }

    function buildClassificationSummary(classified, categories, processedFinancials = {}) {
        const result = {};
        const byAccount = processedFinancials.byAccount || {};
        categories.forEach(cat => {
            const catIdStr = String(cat.id);
            const accounts = classified.byCategory[catIdStr] || [];
            result[catIdStr] = {
                count: accounts.length,
                explicit: accounts.filter(a => a.mappingSource === 'explicit').length,
                pattern: accounts.filter(a => a.mappingSource === 'pattern').length,
                accounts: accounts.map(a => ({
                    id: a.id,
                    number: a.number,
                    name: a.name,
                    type: a.type,
                    amount: byAccount[a.id]?.total || 0,
                    mappingSource: a.mappingSource,
                    matchedPattern: a.matchedPattern
                }))
            };
        });
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ALLOCATION BASES
    // ═══════════════════════════════════════════════════════════════════════════

    function fetchAllAllocationBases(start, end, depts, config = {}) {
        return {
            hours: fetchHoursData(start, end, depts),
            laborDollars: fetchLaborDollars(start, end, depts),
            headcount: fetchHeadcount(start, end, depts),
            revenue: fetchRevenue(start, end, depts),
            directCost: fetchDirectCosts(start, end, depts),
            squareFeet: fetchSquareFeet(depts, config),
            units: fetchUnits(start, end, depts, config),
            custom: fetchCustomMetrics(start, end, depts, config)
        };
    }

    function fetchHoursData(start, end, depts) {
        const sql = `
            SELECT 
                t.department,
                BUILTIN.DF(t.department) as deptname,
                SUM(t.hours) as total_hours,
                SUM(CASE WHEN t.customer IS NOT NULL THEN t.hours ELSE 0 END) as billed_hours,
                SUM(CASE WHEN t.customer IS NULL THEN t.hours ELSE 0 END) as unbilled_hours
            FROM timebill t
            WHERE t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
            GROUP BY t.department, BUILTIN.DF(t.department)
        `;
        const results = Shared.runSuiteQL(sql);

        const byDept = {};
        let totalBilled = 0, totalUnbilled = 0, totalAll = 0;

        // Build lookup for active department IDs
        const activeDeptIds = new Set();
        depts.forEach(d => {
            byDept[d.id] = { id: d.id, name: d.name, billed: 0, unbilled: 0, total: 0, utilization: 0 };
            activeDeptIds.add(String(d.id));
        });

        results.forEach(r => {
            const deptId = r.department;
            const billed = parseFloat(r.billed_hours) || 0;
            const unbilled = parseFloat(r.unbilled_hours) || 0;
            const total = parseFloat(r.total_hours) || 0;

            // Include in totals if:
            // 1. Department is NULL (untagged time - always include)
            // 2. Department is in active list
            // Do NOT include if department is set but not in active list (hidden dept)
            const isNullDept = deptId === null || deptId === undefined;
            const isActiveDept = activeDeptIds.has(String(deptId));
            
            if (isNullDept || isActiveDept) {
                totalBilled += billed;
                totalUnbilled += unbilled;
                totalAll += total;
                
                // Update per-department data if this is a tracked department
                if (byDept[deptId]) {
                    byDept[deptId].billed = billed;
                    byDept[deptId].unbilled = unbilled;
                    byDept[deptId].total = total;
                    byDept[deptId].utilization = total > 0 ? billed / total : 0;
                }
            }
            // Hours from hidden departments are NOT counted in totals
        });

        return {
            byDept,
            totalBilled,
            totalUnbilled,
            total: totalAll,
            utilization: totalAll > 0 ? totalBilled / totalAll : 0
        };
    }

    function fetchLaborDollars(start, end, depts) {
        const sql = `
            SELECT 
                tl.department,
                BUILTIN.DF(tl.department) as deptname,
                SUM(tal.amount) as labor_dollars
            FROM transaction t
            JOIN transactionaccountingline tal ON t.id = tal.transaction
            JOIN transactionline tl ON tal.transaction = tl.transaction AND tal.transactionline = tl.id
            JOIN account a ON tal.account = a.id
            WHERE t.posting = 'T'
              AND t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
              AND a.accttype = 'Expense'
              AND (LOWER(BUILTIN.DF(a.id)) LIKE '%wage%' OR LOWER(BUILTIN.DF(a.id)) LIKE '%salary%' 
                   OR LOWER(BUILTIN.DF(a.id)) LIKE '%payroll%' OR LOWER(BUILTIN.DF(a.id)) LIKE '%labor%'
                   OR LOWER(BUILTIN.DF(a.id)) LIKE '%labour%')
            GROUP BY tl.department, BUILTIN.DF(tl.department)
        `;
        return buildBaseResult(Shared.runSuiteQL(sql), depts, 'labor_dollars');
    }

    function fetchHeadcount(start, end, depts) {
        const sql = `
            SELECT 
                department,
                BUILTIN.DF(department) as deptname,
                COUNT(DISTINCT id) as headcount
            FROM employee
            WHERE isinactive = 'F'
              AND (hiredate IS NULL OR hiredate <= TO_DATE('${end}', 'YYYY-MM-DD'))
              AND (releasedate IS NULL OR releasedate >= TO_DATE('${start}', 'YYYY-MM-DD'))
            GROUP BY department, BUILTIN.DF(department)
        `;
        return buildBaseResult(Shared.runSuiteQL(sql), depts, 'headcount');
    }

    function fetchRevenue(start, end, depts) {
        const sql = `
            SELECT 
                tl.department,
                BUILTIN.DF(tl.department) as deptname,
                SUM(tal.amount) * -1 as revenue
            FROM transaction t
            JOIN transactionaccountingline tal ON t.id = tal.transaction
            JOIN transactionline tl ON tal.transaction = tl.transaction AND tal.transactionline = tl.id
            JOIN account a ON tal.account = a.id
            WHERE t.posting = 'T'
              AND t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
              AND a.accttype = 'Income'
            GROUP BY tl.department, BUILTIN.DF(tl.department)
        `;
        return buildBaseResult(Shared.runSuiteQL(sql), depts, 'revenue');
    }

    function fetchDirectCosts(start, end, depts) {
        const sql = `
            SELECT 
                tl.department,
                BUILTIN.DF(tl.department) as deptname,
                SUM(tal.amount) as direct_costs
            FROM transaction t
            JOIN transactionaccountingline tal ON t.id = tal.transaction
            JOIN transactionline tl ON tal.transaction = tl.transaction AND tal.transactionline = tl.id
            JOIN account a ON tal.account = a.id
            WHERE t.posting = 'T'
              AND t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
              AND a.accttype = 'COGS'
            GROUP BY tl.department, BUILTIN.DF(tl.department)
        `;
        return buildBaseResult(Shared.runSuiteQL(sql), depts, 'direct_costs');
    }

    /**
     * Fetch square feet allocation base from config or location records
     * Square feet are typically static and stored in configuration
     */
    function fetchSquareFeet(depts, config) {
        const squareFeetConfig = config.allocationSources?.square_feet || {};
        const byDept = {};
        let total = 0;

        depts.forEach(d => {
            // Get from config, default to 0
            const sqft = squareFeetConfig.byDept?.[d.id] || 0;
            byDept[d.id] = { id: d.id, name: d.name, value: sqft };
            total += sqft;
        });

        // If total is 0 and we have a total configured, distribute evenly
        if (total === 0 && squareFeetConfig.total) {
            total = squareFeetConfig.total;
            const perDept = total / depts.length;
            depts.forEach(d => {
                byDept[d.id].value = perDept;
            });
        }

        return { byDept, total };
    }

    /**
     * Fetch units produced from item fulfillments or work orders
     */
    function fetchUnits(start, end, depts, config) {
        const unitsConfig = config.allocationSources?.units || {};
        const itemPattern = unitsConfig.itemPattern || '%';
        
        try {
            const sql = `
                SELECT 
                    tl.department,
                    BUILTIN.DF(tl.department) as deptname,
                    SUM(ABS(tl.quantity)) as units
                FROM transaction t
                JOIN transactionline tl ON t.id = tl.transaction
                JOIN item i ON tl.item = i.id
                WHERE t.posting = 'T'
                  AND t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
                  AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
                  AND t.type IN ('ItemShip', 'ItemRcpt', 'WorkOrd')
                  AND UPPER(i.itemid) LIKE UPPER('${itemPattern}')
                GROUP BY tl.department, BUILTIN.DF(tl.department)
            `;
            return buildBaseResult(Shared.runSuiteQL(sql), depts, 'units');
        } catch (e) {
            debugLog('fetchUnits', 'Error fetching units: ' + e.message);
            // Return empty result
            const byDept = {};
            depts.forEach(d => { byDept[d.id] = { id: d.id, name: d.name, value: 0 }; });
            return { byDept, total: 0 };
        }
    }

    /**
     * Fetch custom metrics from config
     * Custom metrics are user-defined and stored in configuration
     */
    function fetchCustomMetrics(start, end, depts, config) {
        const customConfig = config.allocationSources?.custom || {};
        const byDept = {};
        let total = 0;

        depts.forEach(d => {
            const value = customConfig.byDept?.[d.id] || 0;
            byDept[d.id] = { id: d.id, name: d.name, value };
            total += value;
        });

        // Override total if configured
        if (customConfig.total !== undefined) {
            total = customConfig.total;
        }

        return { byDept, total };
    }

    function buildBaseResult(results, depts, valueField) {
        const byDept = {};
        let total = 0;

        // Build lookup for active department IDs
        const activeDeptIds = new Set();
        depts.forEach(d => {
            byDept[d.id] = { id: d.id, name: d.name, value: 0 };
            activeDeptIds.add(String(d.id));
        });

        results.forEach(r => {
            const deptId = r.department;
            const val = parseFloat(r[valueField]) || 0;
            
            // Include in total if:
            // 1. Department is NULL (untagged - always include)
            // 2. Department is in active list
            const isNullDept = deptId === null || deptId === undefined;
            const isActiveDept = activeDeptIds.has(String(deptId));
            
            if (isNullDept || isActiveDept) {
                total += val;
                
                // Update per-department data if this is a tracked department
                if (byDept[deptId]) {
                    byDept[deptId].value = val;
                }
            }
            // Values from hidden departments are NOT counted in total
        });

        return { byDept, total };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CATEGORY TYPE CALCULATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Calculate data for time-based categories
     */
    function calculateTimeCategoryData(cat, depts, allocationBases, config, start, end) {
        const timeFilters = cat.timeFilters || {};
        const result = {
            expense: {},
            burden: {},
            totalHours: 0,
            totalCost: 0,
            filteredHoursByDept: {} // Track filtered hours per dept for accurate rate calc
        };
        
        // Initialize dept values
        depts.forEach(d => {
            result.expense[d.id] = 0;
            result.burden[d.id] = 0;
            result.filteredHoursByDept[d.id] = 0;
        });
        result.expense['Overall'] = 0;
        result.burden['Overall'] = 0;
        
        // Build WHERE clause based on filters
        let whereClause = `WHERE t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')`;
        
        // Time status filter
        // billableDefinition determines how we identify billable vs non-billable:
        //   - 'customer' (default): Billable = has customer, Non-Billable = no customer
        //   - 'flag': Billable = isbillable='T', Non-Billable = isbillable='F'
        const billableDefinition = timeFilters.billableDefinition || 'customer';
        const statusConditions = [];
        if (timeFilters.includeBillable !== false) {
            if (billableDefinition === 'flag') {
                statusConditions.push("(t.isbillable = 'T')");
            } else {
                statusConditions.push("(t.customer IS NOT NULL)");
            }
        }
        if (timeFilters.includeNonBillable) {
            if (billableDefinition === 'flag') {
                statusConditions.push("(t.isbillable = 'F')");
            } else {
                statusConditions.push("(t.customer IS NULL)");
            }
        }
        if (statusConditions.length > 0) {
            whereClause += ` AND (${statusConditions.join(' OR ')})`;
        } else {
            // No status selected = no data
            return result;
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // DEPARTMENT FILTERING
        // Only filter by department if category has explicit department filter
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Category-level department filter
        const categoryDeptIds = timeFilters.departmentIds || (timeFilters.departmentId ? [timeFilters.departmentId] : []);
        const categoryDeptList = categoryDeptIds.map(id => parseInt(id)).filter(id => !isNaN(id));
        
        // Only apply department filter if category explicitly specifies departments
        if (categoryDeptList.length > 0) {
            whereClause += ` AND t.department IN (${categoryDeptList.join(',')})`;
        }
        // If no category department filter, include ALL departments (including NULL)
        
        // Service item filter
        if (timeFilters.serviceItems && timeFilters.serviceItems.length > 0) {
            whereClause += ` AND t.item IN (${timeFilters.serviceItems.join(',')})`;
        }
        
        // Employee type exclusion - combine category-level and global exclusions
        const categoryExclusions = (timeFilters.excludeEmpTypes || []).map(t => String(t));
        const globalExclusions = (config.globalExcludeEmpTypes || []).map(t => String(t));
        const combinedExclusions = [...new Set([...categoryExclusions, ...globalExclusions])]; // Dedupe
        
        // Track if we have any exclusions that would affect hours
        const hasExclusions = combinedExclusions.length > 0;
        
        let empTypeJoin = '';
        if (hasExclusions) {
            empTypeJoin = `LEFT JOIN employee emp ON t.employee = emp.id`;
            whereClause += ` AND (emp.employeetype IS NULL OR emp.employeetype NOT IN (${combinedExclusions.join(',')}))`;
        }
        
        // Cost calculation based on method
        let costExpr = 't.hours * COALESCE(e.laborcost, 0)'; // Default: employee rate
        
        if (timeFilters.costMethod === 'custom_rate') {
            costExpr = `t.hours * ${parseFloat(timeFilters.customRate) || 50}`;
        } else if (timeFilters.costMethod === 'service_rate') {
            costExpr = 't.hours * COALESCE(i.cost, i.rate, e.laborcost, 0)';
        } else if (timeFilters.costMethod === 'average_rate') {
            costExpr = `t.hours * COALESCE((SELECT AVG(laborcost) FROM employee WHERE isinactive = 'F' AND laborcost > 0), e.laborcost, 0)`;
        }
        
        // Also get BILLED hours separately for accurate rate calculation
        // This query returns cost based on filters, plus billed hours for rate denominator
        const sql = `
            SELECT 
                t.department,
                SUM(t.hours) as total_hours,
                SUM(CASE WHEN t.customer IS NOT NULL THEN t.hours ELSE 0 END) as billed_hours,
                SUM(${costExpr}) as total_cost
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            LEFT JOIN item i ON t.item = i.id
            ${empTypeJoin}
            ${whereClause}
            GROUP BY t.department
        `;
        
        try {
            const results = Shared.runSuiteQL(sql) || [];
            
            // Track total filtered billed hours for Overall rate calculation
            let totalFilteredBilledHours = 0;
            
            results.forEach(r => {
                const deptId = r.department;
                const hours = parseFloat(r.total_hours) || 0;
                const billedHours = parseFloat(r.billed_hours) || 0;
                const cost = parseFloat(r.total_cost) || 0;
                
                // Always include in totals
                result.totalHours += hours;
                result.totalCost += cost;
                totalFilteredBilledHours += billedHours;
                
                // Track per-department if we have a valid dept ID
                if (deptId) {
                    result.expense[deptId] = cost;
                    result.filteredHoursByDept[deptId] = billedHours;
                    
                    // Calculate burden per hour - ALWAYS use GLOBAL allocation base
                    // The category cost is spread across ALL hours, not just filtered hours
                    const allocationBase = cat.allocationBase || 'billed_hours';
                    const base = getAllocationBaseValue(allocationBase, allocationBases, deptId);
                    result.burden[deptId] = base > 0 ? cost / base : 0;
                }
            });
            
            result.expense['Overall'] = result.totalCost;
            result.filteredBilledHours = totalFilteredBilledHours;
            
            // For Overall burden, use GLOBAL allocation base (not filtered hours)
            // The category cost is allocated across ALL billed hours in the company
            const allocationBase = cat.allocationBase || 'billed_hours';
            const totalBase = getAllocationBaseValue(allocationBase, allocationBases, 'Overall');
            result.burden['Overall'] = totalBase > 0 ? result.totalCost / totalBase : 0;
            
        } catch (e) {
            log.error('calculateTimeCategoryData', e.message);
        }
        
        return result;
    }

    /**
     * Calculate data for headcount-based categories
     */
    function calculateHeadcountCategoryData(cat, depts, allocationBases, config) {
        const hcFilters = cat.headcountFilters || {};
        const result = {
            expense: {},
            burden: {},
            headcount: 0
        };
        
        // Initialize dept values
        depts.forEach(d => {
            result.expense[d.id] = 0;
            result.burden[d.id] = 0;
        });
        result.expense['Overall'] = 0;
        result.burden['Overall'] = 0;
        
        // Use headcount allocation base
        const headcountData = allocationBases.headcount || { byDept: {}, total: 0 };
        const allocationBase = cat.allocationBase || 'headcount';
        
        let totalHeadcount = 0;
        depts.forEach(d => {
            const hc = headcountData.byDept[d.id]?.value || 0;
            totalHeadcount += hc;
            
            // For headcount categories, expense is typically derived from salary data
            // This is a simplified version
            const avgSalary = config.avgSalary || 75000;
            const expense = hc * avgSalary;
            
            result.expense[d.id] = expense;
            const base = getAllocationBaseValue(allocationBase, allocationBases, d.id);
            result.burden[d.id] = base > 0 ? expense / base : 0;
        });
        
        result.headcount = totalHeadcount;
        result.expense['Overall'] = Object.values(result.expense).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0) - result.expense['Overall'];
        const totalBase = getAllocationBaseValue(allocationBase, allocationBases, 'Overall');
        result.burden['Overall'] = totalBase > 0 ? result.expense['Overall'] / totalBase : 0;
        
        return result;
    }

    /**
     * Calculate data for revenue-based categories
     */
    function calculateRevenueCategoryData(cat, depts, allocationBases, config) {
        const revFilters = cat.revenueFilters || {};
        const result = {
            expense: {},
            burden: {},
            totalRevenue: 0
        };
        
        // Initialize dept values
        depts.forEach(d => {
            result.expense[d.id] = 0;
            result.burden[d.id] = 0;
        });
        result.expense['Overall'] = 0;
        result.burden['Overall'] = 0;
        
        // Use revenue allocation base
        const revenueData = allocationBases.revenue || { byDept: {}, total: 0 };
        const allocationBase = cat.allocationBase || 'revenue';
        
        let totalRevenue = 0;
        depts.forEach(d => {
            const rev = revenueData.byDept[d.id]?.value || 0;
            totalRevenue += rev;
            
            // For revenue categories, we typically want to see burden as a % of revenue
            // But for rate calculation, we still divide by the allocation base
            result.expense[d.id] = rev;
            const base = getAllocationBaseValue(allocationBase, allocationBases, d.id);
            result.burden[d.id] = base > 0 ? rev / base : 0;
        });
        
        result.totalRevenue = totalRevenue;
        result.expense['Overall'] = totalRevenue;
        const totalBase = getAllocationBaseValue(allocationBase, allocationBases, 'Overall');
        result.burden['Overall'] = totalBase > 0 ? totalRevenue / totalBase : 0;
        
        return result;
    }

    /**
     * Calculate data for manual/user-entered categories
     * Replaces broken headcount/revenue category types
     */
    function calculateManualCategoryData(cat, depts, allocationBases, config) {
        const manualConfig = cat.manualConfig || {};
        const entryMode = manualConfig.entryMode || 'fixed_total';
        const allocationBase = cat.allocationBase || 'billed_hours';
        
        const result = {
            expense: {},
            burden: {},
            totalExpense: 0
        };
        
        // Initialize dept values
        depts.forEach(d => {
            result.expense[d.id] = 0;
            result.burden[d.id] = 0;
        });
        result.expense['Overall'] = 0;
        result.burden['Overall'] = 0;
        
        let totalExpense = 0;
        
        if (entryMode === 'fixed_total') {
            // Fixed total amount - allocate by base
            totalExpense = parseFloat(manualConfig.fixedTotal) || 0;
            const totalBase = getAllocationBaseValue(allocationBase, allocationBases, 'Overall');
            
            depts.forEach(d => {
                const deptBase = getAllocationBaseValue(allocationBase, allocationBases, d.id);
                const pct = totalBase > 0 ? deptBase / totalBase : 0;
                result.expense[d.id] = totalExpense * pct;
                result.burden[d.id] = deptBase > 0 ? result.expense[d.id] / deptBase : 0;
            });
            
        } else if (entryMode === 'by_dept') {
            // Per-department amounts - use directly
            const byDeptAmounts = manualConfig.byDeptAmounts || {};
            
            depts.forEach(d => {
                const amt = parseFloat(byDeptAmounts[d.id]) || 0;
                result.expense[d.id] = amt;
                totalExpense += amt;
                
                const deptBase = getAllocationBaseValue(allocationBase, allocationBases, d.id);
                result.burden[d.id] = deptBase > 0 ? amt / deptBase : 0;
            });
            
        } else if (entryMode === 'per_unit') {
            // Per-unit rate - calculate from base values
            const unitType = manualConfig.unitType || 'headcount';
            const perUnitRate = parseFloat(manualConfig.perUnitRate) || 0;
            const isPercent = unitType === 'revenue' || unitType === 'direct_cost';
            
            depts.forEach(d => {
                const unitBase = getAllocationBaseValue(unitType, allocationBases, d.id);
                const expense = isPercent ? unitBase * (perUnitRate / 100) : unitBase * perUnitRate;
                result.expense[d.id] = expense;
                totalExpense += expense;
                
                const allocBase = getAllocationBaseValue(allocationBase, allocationBases, d.id);
                result.burden[d.id] = allocBase > 0 ? expense / allocBase : 0;
            });
        }
        
        result.totalExpense = totalExpense;
        result.expense['Overall'] = totalExpense;
        const totalBase = getAllocationBaseValue(allocationBase, allocationBases, 'Overall');
        result.burden['Overall'] = totalBase > 0 ? totalExpense / totalBase : 0;
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DERIVED CATEGORY CALCULATION
    // ═══════════════════════════════════════════════════════════════════════════

    function calculateDerivedCategoryData(cat, categoryTotals, depts, allocationBases, config) {
        const result = {
            expense: { Overall: 0 },
            burden: { Overall: 0 },
            totalExpense: 0
        };
        
        depts.forEach(d => {
            result.expense[d.id] = 0;
            result.burden[d.id] = 0;
        });
        
        const derivedConfig = cat.derivedConfig || {};
        const sourceId = derivedConfig.sourceCategory;
        const percentage = derivedConfig.percentage || 100;
        const derivedAllocationBase = derivedConfig.allocationBase || 'same';
        
        if (!sourceId || !categoryTotals[sourceId]) {
            return result;
        }
        
        const sourceCategory = categoryTotals[sourceId];
        const sourceExpense = sourceCategory.expense || {};
        
        // Calculate derived amount as percentage of source
        const totalDerivedExpense = (sourceExpense['Overall'] || 0) * (percentage / 100);
        result.totalExpense = totalDerivedExpense;
        result.expense['Overall'] = totalDerivedExpense;
        
        // Determine allocation base for this category
        const allocationBase = derivedAllocationBase === 'same' 
            ? (cat.allocationBase || 'billed_hours')
            : derivedAllocationBase;
        
        // Allocate to departments based on chosen allocation base
        const totalBase = getAllocationBaseValue(allocationBase, allocationBases, 'Overall');
        
        depts.forEach(d => {
            const deptBase = getAllocationBaseValue(allocationBase, allocationBases, d.id);
            const deptShare = totalBase > 0 ? deptBase / totalBase : 0;
            const deptExpense = totalDerivedExpense * deptShare;
            
            result.expense[d.id] = deptExpense;
            result.burden[d.id] = deptBase > 0 ? deptExpense / deptBase : 0;
        });
        
        result.burden['Overall'] = totalBase > 0 ? totalDerivedExpense / totalBase : 0;
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FORMULA CATEGORY CALCULATION
    // ═══════════════════════════════════════════════════════════════════════════

    function calculateFormulaCategoryData(cat, categoryTotals, depts, allocationBases, config) {
        const result = {
            expense: { Overall: 0 },
            burden: { Overall: 0 },
            totalExpense: 0
        };
        
        depts.forEach(d => {
            result.expense[d.id] = 0;
            result.burden[d.id] = 0;
        });
        
        const formulaConfig = cat.formulaConfig || {};
        const formula = formulaConfig.formula || '';
        
        if (!formula) {
            return result;
        }
        
        try {
            // Build context with category and base values
            const context = {
                categories: {},
                bases: {
                    billed_hours: allocationBases.hours?.totalBilled || 0,
                    total_hours: allocationBases.hours?.total || 0,
                    headcount: allocationBases.headcount?.total || 0,
                    revenue: allocationBases.revenue?.total || 0,
                    labor_dollars: allocationBases.laborDollars?.total || 0,
                    direct_cost: allocationBases.directCost?.total || 0
                }
            };
            
            Object.keys(categoryTotals).forEach(catId => {
                context.categories[catId] = categoryTotals[catId].expense?.['Overall'] || 0;
            });
            
            // Replace variable references
            let evalFormula = formula;
            
            // Replace cat.XXX references
            evalFormula = evalFormula.replace(/cat\.([a-zA-Z0-9_]+)/g, (match, catId) => {
                return context.categories[catId] !== undefined ? context.categories[catId] : 0;
            });
            
            // Replace base.XXX references
            evalFormula = evalFormula.replace(/base\.([a-zA-Z0-9_]+)/g, (match, baseId) => {
                return context.bases[baseId] !== undefined ? context.bases[baseId] : 0;
            });
            
            // Safe evaluation
            const safeFormula = evalFormula.replace(/[^0-9+\-*/.()minax\s]/gi, '');
            const finalFormula = safeFormula.replace(/min/g, 'Math.min').replace(/max/g, 'Math.max');
            
            const calculatedExpense = eval(finalFormula);
            
            if (isNaN(calculatedExpense) || !isFinite(calculatedExpense)) {
                return result;
            }
            
            result.totalExpense = Math.max(0, calculatedExpense);
            result.expense['Overall'] = result.totalExpense;
            
            // Allocate to departments based on allocation base
            const allocationBase = cat.allocationBase || 'billed_hours';
            const totalBase = getAllocationBaseValue(allocationBase, allocationBases, 'Overall');
            
            depts.forEach(d => {
                const deptBase = getAllocationBaseValue(allocationBase, allocationBases, d.id);
                const deptShare = totalBase > 0 ? deptBase / totalBase : 0;
                const deptExpense = result.totalExpense * deptShare;
                
                result.expense[d.id] = deptExpense;
                result.burden[d.id] = deptBase > 0 ? deptExpense / deptBase : 0;
            });
            
            result.burden['Overall'] = totalBase > 0 ? result.totalExpense / totalBase : 0;
            
        } catch (err) {
            log.error('Formula evaluation error', err.toString());
        }
        
        return result;
    }

    function getAllocationBaseValue(baseType, allocationBases, deptId) {
        switch (baseType) {
            case 'billed_hours':
                return deptId === 'Overall'
                    ? allocationBases.hours.totalBilled
                    : (allocationBases.hours.byDept[deptId]?.billed || 0);
            case 'total_hours':
                return deptId === 'Overall'
                    ? allocationBases.hours.total
                    : (allocationBases.hours.byDept[deptId]?.total || 0);
            case 'labor_dollars':
                return deptId === 'Overall'
                    ? allocationBases.laborDollars.total
                    : (allocationBases.laborDollars.byDept[deptId]?.value || 0);
            case 'headcount':
                return deptId === 'Overall'
                    ? allocationBases.headcount.total
                    : (allocationBases.headcount.byDept[deptId]?.value || 0);
            case 'revenue':
                return deptId === 'Overall'
                    ? allocationBases.revenue.total
                    : (allocationBases.revenue.byDept[deptId]?.value || 0);
            case 'direct_cost':
                return deptId === 'Overall'
                    ? allocationBases.directCost.total
                    : (allocationBases.directCost.byDept[deptId]?.value || 0);
            case 'square_feet':
                return deptId === 'Overall'
                    ? (allocationBases.squareFeet?.total || 0)
                    : (allocationBases.squareFeet?.byDept[deptId]?.value || 0);
            case 'units':
                return deptId === 'Overall'
                    ? (allocationBases.units?.total || 0)
                    : (allocationBases.units?.byDept[deptId]?.value || 0);
            case 'custom':
                return deptId === 'Overall'
                    ? (allocationBases.custom?.total || 0)
                    : (allocationBases.custom?.byDept[deptId]?.value || 0);
            default:
                return deptId === 'Overall'
                    ? allocationBases.hours.totalBilled
                    : (allocationBases.hours.byDept[deptId]?.billed || 0);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RATE CALCULATION ENGINE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Calculate rate using the specified allocation method
     * @param {Object} category - Category definition with allocation settings
     * @param {number|Object} expenses - Total expense or expense by dept
     * @param {number|Object} baseValue - Total base value or base by dept
     * @param {string} method - Allocation method: 'simple', 'weighted', 'stepped'
     * @param {Object} config - Configuration with weights and tiers
     * @returns {number} Calculated rate
     */
    function calculateRate(category, expenses, baseValue, method, config = {}) {
        // Handle case where baseValue is 0
        if (typeof baseValue === 'number' && baseValue === 0) return 0;
        if (typeof baseValue === 'object' && !Object.values(baseValue).some(v => v > 0)) return 0;

        const allocationMethod = method || category.allocationMethod || 'simple';

        switch (allocationMethod) {
            case 'simple':
                // Simple: Rate = Total Expense / Total Base
                if (typeof expenses === 'number' && typeof baseValue === 'number') {
                    return Shared.safeDiv(expenses, baseValue);
                }
                // If passed objects, sum them
                const totalExp = typeof expenses === 'object' 
                    ? Object.values(expenses).reduce((s, v) => s + (v || 0), 0) 
                    : expenses;
                const totalBase = typeof baseValue === 'object'
                    ? Object.values(baseValue).reduce((s, v) => s + (v || 0), 0)
                    : baseValue;
                return Shared.safeDiv(totalExp, totalBase);

            case 'weighted':
                // Weighted: Rate = Σ(Expense × Weight) / Σ(Base × Weight)
                // Look for weights in category first, then config
                const weights = category.allocationWeights || config.categoryWeights?.[category.id] || {};
                let weightedExpense = 0;
                let weightedBase = 0;

                if (typeof expenses === 'object' && typeof baseValue === 'object') {
                    Object.keys(expenses).forEach(deptId => {
                        const w = parseFloat(weights[deptId]) || 1.0;
                        weightedExpense += (expenses[deptId] || 0) * w;
                        weightedBase += (baseValue[deptId] || 0) * w;
                    });
                    return Shared.safeDiv(weightedExpense, weightedBase);
                }
                // Fallback to simple if not department data
                return Shared.safeDiv(expenses, baseValue);

            case 'stepped':
                // Stepped/Tiered: Different rates based on volume thresholds
                // Look for tiers in category first, then config
                const tiers = category.allocationTiers || config.rateTiers?.[category.id] || [];
                const baseVal = typeof baseValue === 'number' 
                    ? baseValue 
                    : Object.values(baseValue).reduce((s, v) => s + (v || 0), 0);

                if (tiers.length > 0) {
                    // Sort tiers by min value ascending
                    const sortedTiers = [...tiers].sort((a, b) => (a.min || 0) - (b.min || 0));
                    
                    // Find the tier that matches the base value
                    for (let i = sortedTiers.length - 1; i >= 0; i--) {
                        const tier = sortedTiers[i];
                        const tierMin = parseFloat(tier.min) || 0;
                        const tierMax = parseFloat(tier.max) || 999999;
                        
                        if (baseVal >= tierMin && baseVal <= tierMax) {
                            // If tier has a specific rate, use it
                            if (tier.rate && tier.rate > 0) {
                                return parseFloat(tier.rate);
                            }
                        }
                    }
                }
                
                // If no tier matched or no tiers defined, fall back to simple
                const expVal = typeof expenses === 'number'
                    ? expenses
                    : Object.values(expenses).reduce((s, v) => s + (v || 0), 0);
                return Shared.safeDiv(expVal, baseVal);

            default:
                return Shared.safeDiv(
                    typeof expenses === 'number' ? expenses : Object.values(expenses).reduce((s, v) => s + (v || 0), 0),
                    typeof baseValue === 'number' ? baseValue : Object.values(baseValue).reduce((s, v) => s + (v || 0), 0)
                );
        }
    }

    /**
     * Format a raw rate value according to the specified output format
     * @param {number} rawRate - The raw calculated rate (typically $/hr)
     * @param {string} format - Output format: 'per_hour', 'percent_labor', 'percent_cost', 'per_fte', 'per_unit'
     * @param {Object} periodData - Period data containing bases for conversion
     * @param {Object} category - Category data with expense totals
     * @returns {Object} { value, display, unit, rawRate }
     */
    function formatRate(rawRate, format, periodData = {}, category = {}) {
        const rateFormat = format || 'per_hour';
        const formatDef = RATE_FORMATS[rateFormat] || RATE_FORMATS.per_hour;

        switch (rateFormat) {
            case 'per_hour':
                return {
                    value: rawRate,
                    display: `$${rawRate.toFixed(formatDef.decimals)}/hr`,
                    unit: 'hour',
                    rawRate: rawRate
                };

            case 'percent_labor':
                // Convert to percentage of labor dollars
                const laborBase = periodData.laborDollars?.total || periodData.laborDollars || 1;
                const totalExpense = category.totalExpense || category.expense?.['Overall'] || 0;
                const pctLabor = laborBase > 0 ? (totalExpense / laborBase) * 100 : 0;
                return {
                    value: pctLabor,
                    display: `${pctLabor.toFixed(formatDef.decimals)}%`,
                    unit: 'percent',
                    rawRate: rawRate
                };

            case 'percent_cost':
                // Convert to percentage of direct costs
                const costBase = periodData.directCost?.total || periodData.directCost || 1;
                const catExpense = category.totalExpense || category.expense?.['Overall'] || 0;
                const pctCost = costBase > 0 ? (catExpense / costBase) * 100 : 0;
                return {
                    value: pctCost,
                    display: `${pctCost.toFixed(formatDef.decimals)}%`,
                    unit: 'percent',
                    rawRate: rawRate
                };

            case 'per_fte':
                // Convert hourly rate to annual per-FTE
                // Assuming 2080 work hours per year
                const monthCount = periodData.monthCount || 1;
                const annualizationFactor = 12 / monthCount;
                const fteRate = rawRate * (2080 / 12) * monthCount * annualizationFactor;
                return {
                    value: fteRate,
                    display: `$${fmtNum(fteRate, 0)}/FTE`,
                    unit: 'fte',
                    rawRate: rawRate
                };

            case 'per_unit':
                // Calculate per-unit rate
                const unitCount = periodData.units?.total || periodData.unitCount || 1;
                const expenseTotal = category.totalExpense || category.expense?.['Overall'] || 0;
                const unitRate = Shared.safeDiv(expenseTotal, unitCount);
                return {
                    value: unitRate,
                    display: `$${unitRate.toFixed(formatDef.decimals)}/unit`,
                    unit: 'unit',
                    rawRate: rawRate
                };

            default:
                return {
                    value: rawRate,
                    display: `$${rawRate.toFixed(2)}/hr`,
                    unit: 'hour',
                    rawRate: rawRate
                };
        }
    }

    /**
     * Helper to format numbers
     */
    function fmtNum(num, decimals = 0) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toFixed(decimals);
    }

    /**
     * Calculate composite/blended rate from multiple categories
     * @param {Array} categories - Array of category objects with rates
     * @param {Object} config - Configuration with composite rate settings
     * @param {Object} periodData - Period data for cascading calculations
     * @returns {Object} { value, display, method, includedCategories }
     */
    function calculateCompositeRate(categories, config, periodData = {}) {
        const compositeConfig = config.compositeRate || {};
        const method = compositeConfig.method || 'sum';
        const includeCategories = compositeConfig.includeCategories || categories.map(c => c.id);
        const excludeCategories = compositeConfig.excludeCategories || [];

        // Filter to included categories
        const includedCats = categories.filter(c => {
            // Check includeInComposite flag on category
            if (c.includeInComposite === false) return false;
            // Check config include/exclude lists
            if (excludeCategories.includes(c.id)) return false;
            if (includeCategories.length > 0 && !includeCategories.includes(c.id)) return false;
            return true;
        });

        let compositeValue = 0;

        switch (method) {
            case 'sum':
                // Simple sum of all category rates
                compositeValue = includedCats.reduce((sum, cat) => {
                    const rate = cat.rate?.value || cat.totalBurden || cat.burden?.['Overall'] || 0;
                    return sum + rate;
                }, 0);
                break;

            case 'weighted':
                // Weighted by expense volume
                const totalExpense = includedCats.reduce((sum, cat) => {
                    return sum + (cat.totalExpense || cat.expense?.['Overall'] || 0);
                }, 0);

                if (totalExpense > 0) {
                    compositeValue = includedCats.reduce((sum, cat) => {
                        const catExpense = cat.totalExpense || cat.expense?.['Overall'] || 0;
                        const weight = catExpense / totalExpense;
                        const rate = cat.rate?.value || cat.totalBurden || cat.burden?.['Overall'] || 0;
                        return sum + (rate * weight);
                    }, 0);
                }
                break;

            case 'cascading':
                // Each layer applies to running subtotal (wrap rates)
                // Start with base labor rate
                let runningTotal = periodData.avgLaborRate || compositeConfig.baseLaborRate || 50;
                const cascadeOrder = compositeConfig.cascadeOrder || includeCategories;

                cascadeOrder.forEach(catId => {
                    const cat = includedCats.find(c => c.id === catId);
                    if (!cat) return;

                    const rate = cat.rate?.value || cat.totalBurden || cat.burden?.['Overall'] || 0;
                    const rateFormat = cat.rateFormat || 'per_hour';

                    if (rateFormat === 'percent_labor' || rateFormat === 'percent_cost') {
                        // Percentage: multiply running total by (1 + rate/100)
                        runningTotal = runningTotal * (1 + rate / 100);
                    } else {
                        // Flat rate: add to running total
                        runningTotal += rate;
                    }
                });

                // Composite is the total minus the base
                compositeValue = runningTotal - (periodData.avgLaborRate || compositeConfig.baseLaborRate || 50);
                break;

            default:
                // Default to sum
                compositeValue = includedCats.reduce((sum, cat) => {
                    return sum + (cat.rate?.value || cat.totalBurden || cat.burden?.['Overall'] || 0);
                }, 0);
        }

        return {
            value: compositeValue,
            display: `$${compositeValue.toFixed(2)}/hr`,
            method: method,
            includedCategories: includedCats.map(c => c.id),
            excludedCategories: excludeCategories,
            categoryCount: includedCats.length
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FINANCIAL DATA
    // ═══════════════════════════════════════════════════════════════════════════

    function fetchFinancialsDetailed(start, end) {
        const sql = `
            SELECT 
                tal.account,
                tl.department,
                SUM(tal.amount) as amount,
                COUNT(DISTINCT t.id) as transaction_count
            FROM transaction t
            JOIN transactionaccountingline tal ON t.id = tal.transaction
            JOIN transactionline tl ON tal.transaction = tl.transaction AND tal.transactionline = tl.id
            JOIN account a ON tal.account = a.id
            WHERE t.posting = 'T'
              AND t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
              AND a.accttype IN ('Expense', 'COGS', 'OthExpense')
            GROUP BY tal.account, tl.department
        `;
        return Shared.runSuiteQL(sql);
    }

    function processFinancials(financialData, depts, allAccounts) {
        const byAccount = {};

        allAccounts.forEach(acct => {
            byAccount[acct.id] = {
                id: acct.id,
                name: acct.name,
                number: acct.number,
                byDept: {},
                total: 0,
                transactionCount: 0
            };
            depts.forEach(d => {
                byAccount[acct.id].byDept[d.id] = 0;
            });
        });

        financialData.forEach(row => {
            const acctId = row.account;
            const deptId = row.department;
            const amount = parseFloat(row.amount) || 0;
            const txnCount = parseInt(row.transaction_count) || 0;

            if (byAccount[acctId]) {
                byAccount[acctId].byDept[deptId] = (byAccount[acctId].byDept[deptId] || 0) + amount;
                byAccount[acctId].total += amount;
                byAccount[acctId].transactionCount += txnCount;
            }
        });

        return { byAccount };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UNBILLED LABOUR
    // ═══════════════════════════════════════════════════════════════════════════

    function fetchUnbilledLabour(start, end, depts, laborOverheadFactor, config) {
        const unbilledMode = config.unbilledHoursMode || 'all';

        if (unbilledMode === 'disabled') {
            return { byDept: {}, total: 0, baseCost: 0, totalHours: 0, overheadFactor: laborOverheadFactor };
        }

        if (unbilledMode === 'selected_items') {
            const itemPattern = config.unbilledItemPattern || '%Direct Labour%';
            return fetchUnbilledLabourByItem(start, end, depts, laborOverheadFactor, itemPattern);
        }

        return fetchUnbilledLabourAll(start, end, depts, laborOverheadFactor);
    }

    function fetchUnbilledLabourAll(start, end, depts, laborOverheadFactor) {
        const sql = `
            SELECT 
                t.department,
                BUILTIN.DF(t.department) as deptname,
                SUM(t.hours * COALESCE(e.laborcost, 0)) as base_labour_cost,
                SUM(t.hours) as unbilled_hours
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            WHERE t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
              AND t.customer IS NULL
            GROUP BY t.department, BUILTIN.DF(t.department)
        `;

        return processUnbilledResults(Shared.runSuiteQL(sql), depts, laborOverheadFactor);
    }

    function fetchUnbilledLabourByItem(start, end, depts, laborOverheadFactor, itemPattern) {
        const sql = `
            SELECT 
                t.department,
                BUILTIN.DF(t.department) as deptname,
                SUM(t.hours * COALESCE(e.laborcost, 0)) as base_labour_cost,
                SUM(t.hours) as unbilled_hours
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            JOIN item i ON t.item = i.id
            WHERE t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
              AND t.customer IS NULL
              AND UPPER(i.itemid) LIKE UPPER('${itemPattern}')
            GROUP BY t.department, BUILTIN.DF(t.department)
        `;

        return processUnbilledResults(Shared.runSuiteQL(sql), depts, laborOverheadFactor);
    }

    function processUnbilledResults(results, depts, laborOverheadFactor) {
        const byDept = {};
        let totalBaseCost = 0;
        let totalHours = 0;

        // Build lookup for active department IDs
        const activeDeptIds = new Set();
        depts.forEach(d => {
            byDept[d.id] = { id: d.id, name: d.name, baseCost: 0, cost: 0, hours: 0 };
            activeDeptIds.add(String(d.id));
        });

        results.forEach(r => {
            const deptId = r.department;
            const baseCost = parseFloat(r.base_labour_cost) || 0;
            const hours = parseFloat(r.unbilled_hours) || 0;
            const costWithOverhead = baseCost * laborOverheadFactor;

            // Include in totals if:
            // 1. Department is NULL (untagged - always include)
            // 2. Department is in active list
            const isNullDept = deptId === null || deptId === undefined;
            const isActiveDept = activeDeptIds.has(String(deptId));
            
            if (isNullDept || isActiveDept) {
                totalBaseCost += baseCost;
                totalHours += hours;
                
                // Update per-department data if this is a tracked department
                if (byDept[deptId]) {
                    byDept[deptId].baseCost = baseCost;
                    byDept[deptId].cost = costWithOverhead;
                    byDept[deptId].hours = hours;
                }
            }
            // Values from hidden departments are NOT counted in totals
        });

        return {
            byDept,
            baseCost: totalBaseCost,
            total: totalBaseCost * laborOverheadFactor,
            totalHours,
            overheadFactor: laborOverheadFactor
        };
    }

    function fetchUnbilledDetailByEmployee(start, end, activeDepts, laborOverheadFactor, config) {
        const unbilledMode = config.unbilledHoursMode || 'all';
        const unbilledDepts = config.unbilledHoursDepts || activeDepts.map(d => String(d.id));

        const sql = `
            SELECT 
                t.employee,
                BUILTIN.DF(t.employee) as employee_name,
                t.department,
                BUILTIN.DF(t.department) as dept_name,
                e.laborcost as hourly_cost,
                SUM(t.hours) as unbilled_hours,
                SUM(t.hours * COALESCE(e.laborcost, 0)) as base_cost
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            WHERE t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
              AND t.customer IS NULL
            GROUP BY t.employee, BUILTIN.DF(t.employee), t.department, BUILTIN.DF(t.department), e.laborcost
            ORDER BY t.department, BUILTIN.DF(t.employee)
        `;

        const results = Shared.runSuiteQL(sql);
        const activeDeptIds = activeDepts.map(d => String(d.id));
        const byDept = {};
        let grandTotalHours = 0;
        let grandTotalCost = 0;

        results.forEach(r => {
            const deptId = r.department;
            if (!activeDeptIds.includes(String(deptId))) return;

            const deptIncluded = unbilledMode === 'all' ||
                unbilledMode === 'selected_items' ||
                (unbilledMode === 'selected_depts' && unbilledDepts.includes(String(deptId)));

            if (!byDept[deptId]) {
                byDept[deptId] = {
                    id: deptId,
                    name: r.dept_name || 'Unknown',
                    included: deptIncluded,
                    employees: [],
                    totalHours: 0,
                    totalCost: 0
                };
            }

            const hours = parseFloat(r.unbilled_hours) || 0;
            const baseCost = parseFloat(r.base_cost) || 0;
            const costWithOverhead = baseCost * laborOverheadFactor;

            if (costWithOverhead > 0) {
                byDept[deptId].employees.push({
                    id: r.employee,
                    name: r.employee_name || 'Unknown',
                    hourlyCost: parseFloat(r.hourly_cost) || 0,
                    hours,
                    baseCost,
                    totalCost: costWithOverhead
                });
            }

            byDept[deptId].totalHours += hours;
            byDept[deptId].totalCost += costWithOverhead;

            if (deptIncluded) {
                grandTotalHours += hours;
                grandTotalCost += costWithOverhead;
            }
        });

        const departments = Object.values(byDept)
            .filter(dept => dept.employees.length > 0)
            .map(dept => {
                dept.employees.sort((a, b) => b.totalCost - a.totalCost);
                return dept;
            })
            .sort((a, b) => b.totalCost - a.totalCost);

        return {
            laborOverheadFactor,
            unbilledMode,
            departments,
            totals: { hours: grandTotalHours, cost: grandTotalCost }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUMMARY BUILDING
    // ═══════════════════════════════════════════════════════════════════════════

    function buildSummaryMultiBase(financials, allocationBases, depts, unbilledLabour, config, classified, categories, startDate, endDate, preCalcTimebill = null) {
        const unbilledMode = config.unbilledHoursMode || 'all';
        const unbilledDepts = config.unbilledHoursDepts || depts.map(d => String(d.id));

        const categoryTotals = {};
        const burdenDetails = [];
        let totalExpense = 0;
        const rateMatrix = {}; // dept -> category -> rate
        const formattedRates = {}; // Store formatted rate info

        // Period data for rate formatting
        const periodData = {
            laborDollars: allocationBases.laborDollars,
            directCost: allocationBases.directCost,
            units: allocationBases.units,
            monthCount: 1 // Could be calculated from date range
        };

        // Initialize
        depts.forEach(d => {
            rateMatrix[d.id] = { name: d.name };
            formattedRates[d.id] = {};
        });
        rateMatrix['Overall'] = { name: 'Overall' };
        formattedRates['Overall'] = {};

        categories.forEach(cat => {
            categoryTotals[cat.id] = {
                label: cat.label,
                color: cat.color,
                allocationBase: cat.allocationBase || 'billed_hours',
                allocationMethod: cat.allocationMethod || 'simple',
                scope: cat.scope || 'department',
                rateFormat: cat.rateFormat || 'per_hour',
                includeInComposite: cat.includeInComposite !== false,
                expense: {},
                burden: {},
                rate: {},
                accountCount: 0
            };
            depts.forEach(d => {
                categoryTotals[cat.id].expense[d.id] = 0;
                categoryTotals[cat.id].burden[d.id] = 0;
            });
            categoryTotals[cat.id].expense['Overall'] = 0;
            categoryTotals[cat.id].burden['Overall'] = 0;
        });

        // Process each category
        categories.forEach(cat => {
            const categoryType = cat.categoryType || 'expense';
            const allocationBase = cat.allocationBase || 'billed_hours';
            const allocationMethod = cat.allocationMethod || 'simple';
            const scope = cat.scope || 'department';
            const rateFormat = cat.rateFormat || 'per_hour';

            categoryTotals[cat.id].accountCount = 0;
            categoryTotals[cat.id].categoryType = categoryType;

            // Branch based on category type
            if (categoryType === 'timebill') {
                // Time-based category - use pre-calculated data if available, else calculate
                const timeData = (preCalcTimebill && preCalcTimebill[cat.id]) 
                    ? preCalcTimebill[cat.id]
                    : calculateTimeCategoryData(cat, depts, allocationBases, config, startDate, endDate);
                categoryTotals[cat.id].expense = timeData.expense;
                categoryTotals[cat.id].burden = timeData.burden;
                categoryTotals[cat.id].totalHours = timeData.totalHours;
                categoryTotals[cat.id].totalCost = timeData.totalCost;
                totalExpense += timeData.expense['Overall'] || 0;
                
            } else if (categoryType === 'manual' || categoryType === 'headcount' || categoryType === 'revenue') {
                // Manual category (includes legacy headcount/revenue types)
                const manualData = calculateManualCategoryData(cat, depts, allocationBases, config);
                categoryTotals[cat.id].expense = manualData.expense;
                categoryTotals[cat.id].burden = manualData.burden;
                categoryTotals[cat.id].totalExpense = manualData.totalExpense;
                totalExpense += manualData.expense['Overall'] || 0;
                
            } else if (categoryType === 'derived') {
                // Derived category - percentage of another category
                const derivedData = calculateDerivedCategoryData(cat, categoryTotals, depts, allocationBases, config);
                categoryTotals[cat.id].expense = derivedData.expense;
                categoryTotals[cat.id].burden = derivedData.burden;
                categoryTotals[cat.id].totalExpense = derivedData.totalExpense;
                totalExpense += derivedData.expense['Overall'] || 0;
                
            } else if (categoryType === 'formula') {
                // Formula category - custom calculation
                const formulaData = calculateFormulaCategoryData(cat, categoryTotals, depts, allocationBases, config);
                categoryTotals[cat.id].expense = formulaData.expense;
                categoryTotals[cat.id].burden = formulaData.burden;
                categoryTotals[cat.id].totalExpense = formulaData.totalExpense;
                totalExpense += formulaData.expense['Overall'] || 0;
                
            } else {
                // Default: expense account-based (original logic)
                const catIdStr = String(cat.id);
                const categoryAccounts = classified.byCategory[catIdStr] || [];
                categoryTotals[cat.id].accountCount = categoryAccounts.length;

                // Collect expense data by department for weighted calculation
                const categoryExpenseByDept = {};
                const categoryBaseByDept = {};

                categoryAccounts.forEach(acct => {
                    const acctData = financials.byAccount[acct.id];
                    if (!acctData) return;

                    const deptValues = {};
                    let acctTotal = 0;

                    depts.forEach(d => {
                        const exp = acctData.byDept[d.id] || 0;
                        acctTotal += exp;

                        categoryExpenseByDept[d.id] = (categoryExpenseByDept[d.id] || 0) + exp;
                        categoryBaseByDept[d.id] = getAllocationBaseValue(allocationBase, allocationBases, d.id);

                        let burden;
                        if (scope === 'company') {
                            burden = 0; // Will be calculated after all depts
                        } else {
                            const base = getAllocationBaseValue(allocationBase, allocationBases, d.id);
                            burden = Shared.safeDiv(exp, base);
                        }

                        deptValues[d.id] = { expense: exp, burden: burden };
                        categoryTotals[cat.id].expense[d.id] += exp;
                    });

                    // Overall calculation
                    const totalBase = getAllocationBaseValue(allocationBase, allocationBases, 'Overall');
                    const totalBurden = Shared.safeDiv(acctTotal, totalBase);
                    deptValues['Overall'] = { expense: acctTotal, burden: totalBurden };

                    // For company scope, use overall rate for all depts
                    if (scope === 'company') {
                        depts.forEach(d => {
                            deptValues[d.id].burden = totalBurden;
                        });
                    }

                    categoryTotals[cat.id].expense['Overall'] += acctTotal;
                    totalExpense += acctTotal;

                    burdenDetails.push({
                        id: acct.id,
                        number: acct.number,
                    name: acct.name,
                    categoryId: cat.id,
                    categoryLabel: cat.label,
                    categoryColor: cat.color,
                    allocationBase: allocationBase,
                    allocationMethod: allocationMethod,
                    scope: scope,
                    rateFormat: rateFormat,
                    dept: deptValues,
                    total: acctTotal,
                    totalBurden: totalBurden,
                    transactionCount: acctData.transactionCount,
                    mappingSource: acct.mappingSource,
                    matchedPattern: acct.matchedPattern
                });
            });

            // Calculate category burden rates using the selected allocation method
            depts.forEach(d => {
                const exp = categoryTotals[cat.id].expense[d.id];
                const base = getAllocationBaseValue(allocationBase, allocationBases, d.id);
                
                let rate;
                if (scope === 'company') {
                    // For company scope, calculate overall first
                    rate = 0; // Will be set below
                } else {
                    // Use calculateRate with the specified method
                    rate = calculateRate(
                        cat,
                        categoryExpenseByDept,
                        categoryBaseByDept,
                        allocationMethod,
                        config
                    );
                    // For simple method, just use per-dept calculation
                    if (allocationMethod === 'simple') {
                        rate = Shared.safeDiv(exp, base);
                    }
                }
                
                categoryTotals[cat.id].burden[d.id] = rate;
                rateMatrix[d.id][cat.id] = rate;

                // Format the rate
                const formatted = formatRate(rate, rateFormat, periodData, {
                    totalExpense: categoryTotals[cat.id].expense['Overall'],
                    expense: categoryTotals[cat.id].expense
                });
                formattedRates[d.id][cat.id] = formatted;
            });

            // Calculate overall rate
            const overallExp = categoryTotals[cat.id].expense['Overall'];
            const overallBase = getAllocationBaseValue(allocationBase, allocationBases, 'Overall');
            
            let overallRate;
            if (allocationMethod === 'weighted') {
                // For weighted, use the calculateRate function with all dept data
                overallRate = calculateRate(cat, categoryExpenseByDept, categoryBaseByDept, allocationMethod, config);
            } else if (allocationMethod === 'stepped') {
                // For stepped, use overall base to find the tier
                overallRate = calculateRate(cat, overallExp, overallBase, allocationMethod, config);
            } else {
                // Simple
                overallRate = Shared.safeDiv(overallExp, overallBase);
            }

            categoryTotals[cat.id].burden['Overall'] = overallRate;
            rateMatrix['Overall'][cat.id] = overallRate;

            // For company scope, propagate overall rate to all depts
            if (scope === 'company') {
                depts.forEach(d => {
                    categoryTotals[cat.id].burden[d.id] = overallRate;
                    rateMatrix[d.id][cat.id] = overallRate;
                });
            }

            // Format overall rate
            const formattedOverall = formatRate(overallRate, rateFormat, periodData, {
                totalExpense: overallExp,
                expense: categoryTotals[cat.id].expense
            });
            formattedRates['Overall'][cat.id] = formattedOverall;
            categoryTotals[cat.id].rate = formattedOverall;
            } // End of else block for expense categories
        });

        // NOTE: Unbilled Hours is no longer auto-inserted as a pseudo-category.
        // Users should create their own timebill categories if they want time-based burden tracking.

        // Build totals
        const totals = { expense: {}, burden: {} };
        depts.forEach(d => {
            let deptExp = 0;
            let deptBurden = 0;
            Object.keys(categoryTotals).forEach(catId => {
                deptExp += categoryTotals[catId].expense[d.id] || 0;
                deptBurden += categoryTotals[catId].burden[d.id] || 0;
            });
            totals.expense[d.id] = deptExp;
            totals.burden[d.id] = deptBurden;
            rateMatrix[d.id]['Total'] = deptBurden;
        });

        let overallExp = 0;
        let overallBurden = 0;
        Object.keys(categoryTotals).forEach(catId => {
            overallExp += categoryTotals[catId].expense['Overall'] || 0;
            overallBurden += categoryTotals[catId].burden['Overall'] || 0;
        });
        totals.expense['Overall'] = overallExp;
        totals.burden['Overall'] = overallBurden;
        rateMatrix['Overall']['Total'] = overallBurden;

        // Build categories output with enhanced properties
        const categoriesOutput = categories
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map(cat => ({
                id: cat.id,
                label: cat.label,
                color: cat.color,
                categoryType: cat.categoryType || 'expense',  // CRITICAL: Include categoryType!
                allocationBase: cat.allocationBase || 'billed_hours',
                allocationMethod: cat.allocationMethod || 'simple',
                scope: cat.scope || 'department',
                rateFormat: cat.rateFormat || 'per_hour',
                includeInComposite: cat.includeInComposite !== false,
                patterns: cat.patterns || [],
                timeFilters: cat.timeFilters || {},
                headcountFilters: cat.headcountFilters || {},
                revenueFilters: cat.revenueFilters || {},
                allocationWeights: cat.allocationWeights || {},
                allocationTiers: cat.allocationTiers || [],
                accountIds: cat.accountIds || [],
                accountCount: categoryTotals[cat.id]?.accountCount || 0,
                expense: categoryTotals[cat.id]?.expense || {},
                burden: categoryTotals[cat.id]?.burden || {},
                rate: categoryTotals[cat.id]?.rate || {},
                totalExpense: categoryTotals[cat.id]?.expense?.['Overall'] || 0,
                totalBurden: categoryTotals[cat.id]?.burden?.['Overall'] || 0,
                totalHours: categoryTotals[cat.id]?.totalHours || 0,
                totalCost: categoryTotals[cat.id]?.totalCost || 0,
                percentOfTotal: totalExpense > 0 ? ((categoryTotals[cat.id]?.expense?.['Overall'] || 0) / totalExpense) * 100 : 0
            }));

        // NOTE: Unbilled Hours category is no longer auto-inserted.
        // Users create their own timebill categories for time-based tracking.

        // Calculate composite rate using the new function
        const compositeResult = calculateCompositeRate(categoriesOutput, config, periodData);

        return {
            categories: categoriesOutput,
            totals,
            totalExpense,
            compositeRate: compositeResult.value,
            compositeRateInfo: compositeResult,
            burdenDetails: burdenDetails.sort((a, b) => b.total - a.total),
            rateMatrix,
            formattedRates
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BURDEN APPLIED (ABSORPTION)
    // ═══════════════════════════════════════════════════════════════════════════

    function fetchBurdenApplied(start, end, profile) {
        const accountIds = profile.burdenAppliedAccountIds || [];
        const numberPattern = profile.burdenAppliedAccountNumberPattern || '500%';
        const namePattern = profile.burdenAppliedAccountNamePattern || '%burden applied%';

        let whereClause = '';

        if (accountIds.length > 0) {
            whereClause = `AND a.id IN (${accountIds.join(',')})`;
        } else {
            const conditions = [];
            if (numberPattern) {
                conditions.push(`a.acctnumber LIKE '${numberPattern}'`);
            }
            if (namePattern) {
                // Use BUILTIN.DF(a.id) instead of acctname which is NOT_EXPOSED in SuiteQL
                conditions.push(`LOWER(BUILTIN.DF(a.id)) LIKE '${namePattern.toLowerCase()}'`);
            }
            if (conditions.length > 0) {
                whereClause = `AND (${conditions.join(' OR ')})`;
            }
        }

        const sql = `
            SELECT SUM(tal.amount) as applied
            FROM transaction t
            JOIN transactionaccountingline tal ON t.id = tal.transaction
            JOIN account a ON tal.account = a.id
            WHERE t.posting = 'T'
              AND t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
              ${whereClause}
        `;

        try {
            const results = Shared.runSuiteQL(sql);
            if (results.length > 0 && results[0].applied) {
                return Math.abs(parseFloat(results[0].applied) || 0);
            }
        } catch (e) {
            log.error('fetchBurdenApplied', e.message);
        }

        return 0;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BATCH DATA FETCHING (FOR HISTORY OPTIMIZATION)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Batch fetch GL financials for a date range, indexed by YYYY-MM
     * Returns: { 'YYYY-MM': [{ account, department, amount, transaction_count }] }
     */
    function batchFetchFinancials(startDate, endDate) {
        const sql = `
            SELECT 
                tal.account,
                tl.department,
                TO_CHAR(t.trandate, 'YYYY-MM') as period_month,
                SUM(tal.amount) as amount,
                COUNT(DISTINCT t.id) as transaction_count
            FROM transaction t
            JOIN transactionaccountingline tal ON t.id = tal.transaction
            JOIN transactionline tl ON tal.transaction = tl.transaction AND tal.transactionline = tl.id
            JOIN account a ON tal.account = a.id
            WHERE t.posting = 'T'
              AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
              AND a.accttype IN ('Expense', 'COGS', 'OthExpense')
            GROUP BY tal.account, tl.department, TO_CHAR(t.trandate, 'YYYY-MM')
        `;
        const results = Shared.runSuiteQL(sql) || [];
        
        // Index by month
        const byMonth = {};
        results.forEach(r => {
            if (!byMonth[r.period_month]) byMonth[r.period_month] = [];
            byMonth[r.period_month].push(r);
        });
        return byMonth;
    }
    
    /**
     * Batch fetch hours data, indexed by YYYY-MM
     */
    function batchFetchHours(startDate, endDate) {
        const sql = `
            SELECT 
                t.department,
                TO_CHAR(t.trandate, 'YYYY-MM') as period_month,
                SUM(t.hours) as total_hours,
                SUM(CASE WHEN t.customer IS NOT NULL THEN t.hours ELSE 0 END) as billed_hours,
                SUM(CASE WHEN t.customer IS NULL THEN t.hours ELSE 0 END) as unbilled_hours
            FROM timebill t
            WHERE t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
            GROUP BY t.department, TO_CHAR(t.trandate, 'YYYY-MM')
        `;
        const results = Shared.runSuiteQL(sql) || [];
        
        const byMonth = {};
        results.forEach(r => {
            if (!byMonth[r.period_month]) byMonth[r.period_month] = [];
            byMonth[r.period_month].push(r);
        });
        return byMonth;
    }
    
    /**
     * Batch fetch timebill cost data for timebill categories, indexed by YYYY-MM
     * Includes all fields needed by calculateTimeCategoryData
     */
    function batchFetchTimebillCosts(startDate, endDate) {
        const sql = `
            SELECT 
                t.department,
                t.employee,
                e.laborcost,
                e.employeetype,
                t.isbillable,
                t.item,
                t.customer,
                TO_CHAR(t.trandate, 'YYYY-MM') as period_month,
                SUM(t.hours) as hours
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            WHERE t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
            GROUP BY t.department, t.employee, e.laborcost, e.employeetype, t.isbillable, t.item, t.customer, TO_CHAR(t.trandate, 'YYYY-MM')
        `;
        const results = Shared.runSuiteQL(sql) || [];
        
        const byMonth = {};
        results.forEach(r => {
            if (!byMonth[r.period_month]) byMonth[r.period_month] = [];
            byMonth[r.period_month].push(r);
        });
        return byMonth;
    }
    
    /**
     * Batch fetch labor dollars, indexed by YYYY-MM
     */
    function batchFetchLaborDollars(startDate, endDate) {
        const sql = `
            SELECT 
                t.department,
                TO_CHAR(t.trandate, 'YYYY-MM') as period_month,
                SUM(t.hours * COALESCE(e.laborcost, 0)) as labor_cost
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            WHERE t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
            GROUP BY t.department, TO_CHAR(t.trandate, 'YYYY-MM')
        `;
        const results = Shared.runSuiteQL(sql) || [];
        
        const byMonth = {};
        results.forEach(r => {
            if (!byMonth[r.period_month]) byMonth[r.period_month] = [];
            byMonth[r.period_month].push(r);
        });
        return byMonth;
    }
    
    /**
     * Batch fetch revenue, indexed by YYYY-MM
     */
    function batchFetchRevenue(startDate, endDate) {
        const sql = `
            SELECT 
                tl.department,
                TO_CHAR(t.trandate, 'YYYY-MM') as period_month,
                SUM(tl.netamount) as revenue
            FROM transaction t
            JOIN transactionline tl ON t.id = tl.transaction
            WHERE t.type = 'CustInvc'
              AND t.posting = 'T'
              AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
            GROUP BY tl.department, TO_CHAR(t.trandate, 'YYYY-MM')
        `;
        const results = Shared.runSuiteQL(sql) || [];
        
        const byMonth = {};
        results.forEach(r => {
            if (!byMonth[r.period_month]) byMonth[r.period_month] = [];
            byMonth[r.period_month].push(r);
        });
        return byMonth;
    }
    
    /**
     * Batch fetch direct costs, indexed by YYYY-MM
     */
    function batchFetchDirectCosts(startDate, endDate) {
        const sql = `
            SELECT 
                tl.department,
                TO_CHAR(t.trandate, 'YYYY-MM') as period_month,
                SUM(tal.amount) as cost
            FROM transaction t
            JOIN transactionaccountingline tal ON t.id = tal.transaction
            JOIN transactionline tl ON tal.transaction = tl.transaction AND tal.transactionline = tl.id
            JOIN account a ON tal.account = a.id
            WHERE t.posting = 'T'
              AND a.accttype = 'COGS'
              AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
            GROUP BY tl.department, TO_CHAR(t.trandate, 'YYYY-MM')
        `;
        const results = Shared.runSuiteQL(sql) || [];
        
        const byMonth = {};
        results.forEach(r => {
            if (!byMonth[r.period_month]) byMonth[r.period_month] = [];
            byMonth[r.period_month].push(r);
        });
        return byMonth;
    }
    
    /**
     * Get months in a date range as YYYY-MM strings
     */
    function getMonthsInRange(startStr, endStr) {
        const months = [];
        // Parse YYYY-MM-DD strings directly to avoid timezone issues
        const [startYear, startMonth] = startStr.split('-').map(Number);
        const [endYear, endMonth] = endStr.split('-').map(Number);
        
        let year = startYear;
        let month = startMonth;
        
        while (year < endYear || (year === endYear && month <= endMonth)) {
            // Format as YYYY-MM with zero-padding
            months.push(`${year}-${String(month).padStart(2, '0')}`);
            month++;
            if (month > 12) {
                month = 1;
                year++;
            }
        }
        return months;
    }
    
    /**
     * Aggregate batch financials for a specific period
     * Returns same format as fetchFinancialsDetailed
     */
    function aggregateFinancialsFromBatch(batchData, periodStart, periodEnd) {
        const months = getMonthsInRange(periodStart, periodEnd);
        const aggregated = {};
        
        months.forEach(m => {
            (batchData[m] || []).forEach(r => {
                const key = `${r.account}|${r.department}`;
                if (!aggregated[key]) {
                    aggregated[key] = { account: r.account, department: r.department, amount: 0, transaction_count: 0 };
                }
                aggregated[key].amount += parseFloat(r.amount) || 0;
                aggregated[key].transaction_count += parseInt(r.transaction_count) || 0;
            });
        });
        
        return Object.values(aggregated);
    }
    
    /**
     * Aggregate batch hours for a specific period
     * Returns same format as fetchHoursData
     */
    function aggregateHoursFromBatch(batchData, periodStart, periodEnd, depts) {
        const months = getMonthsInRange(periodStart, periodEnd);
        const byDept = {};
        let totalBilled = 0, totalUnbilled = 0, totalAll = 0;
        
        // Initialize
        const activeDeptIds = new Set();
        depts.forEach(d => {
            byDept[d.id] = { id: d.id, name: d.name, billed: 0, unbilled: 0, total: 0, utilization: 0 };
            activeDeptIds.add(String(d.id));
        });
        
        months.forEach(m => {
            (batchData[m] || []).forEach(r => {
                const deptId = r.department;
                const billed = parseFloat(r.billed_hours) || 0;
                const unbilled = parseFloat(r.unbilled_hours) || 0;
                const total = parseFloat(r.total_hours) || 0;
                
                // Include if NULL dept or active dept
                const isNullDept = deptId === null || deptId === undefined;
                const isActiveDept = activeDeptIds.has(String(deptId));
                
                if (isNullDept || isActiveDept) {
                    totalBilled += billed;
                    totalUnbilled += unbilled;
                    totalAll += total;
                    
                    if (byDept[deptId]) {
                        byDept[deptId].billed += billed;
                        byDept[deptId].unbilled += unbilled;
                        byDept[deptId].total += total;
                    }
                }
            });
        });
        
        // Calculate utilization
        Object.values(byDept).forEach(d => {
            d.utilization = d.total > 0 ? d.billed / d.total : 0;
        });
        
        return {
            byDept,
            totalBilled,
            totalUnbilled,
            total: totalAll,
            utilization: totalAll > 0 ? totalBilled / totalAll : 0
        };
    }
    
    /**
     * Aggregate batch labor dollars for a specific period
     */
    function aggregateLaborDollarsFromBatch(batchData, periodStart, periodEnd, depts) {
        const months = getMonthsInRange(periodStart, periodEnd);
        const byDept = {};
        let total = 0;
        
        depts.forEach(d => { byDept[d.id] = 0; });
        
        months.forEach(m => {
            (batchData[m] || []).forEach(r => {
                const deptId = r.department;
                const cost = parseFloat(r.labor_cost) || 0;
                if (byDept[deptId] !== undefined) {
                    byDept[deptId] += cost;
                }
                total += cost;
            });
        });
        
        return { byDept, total };
    }
    
    /**
     * Aggregate batch revenue for a specific period
     */
    function aggregateRevenueFromBatch(batchData, periodStart, periodEnd, depts) {
        const months = getMonthsInRange(periodStart, periodEnd);
        const byDept = {};
        let total = 0;
        
        depts.forEach(d => { byDept[d.id] = 0; });
        
        months.forEach(m => {
            (batchData[m] || []).forEach(r => {
                const deptId = r.department;
                const rev = parseFloat(r.revenue) || 0;
                if (byDept[deptId] !== undefined) {
                    byDept[deptId] += rev;
                }
                total += rev;
            });
        });
        
        return { byDept, total };
    }
    
    /**
     * Aggregate batch direct costs for a specific period
     */
    function aggregateDirectCostsFromBatch(batchData, periodStart, periodEnd, depts) {
        const months = getMonthsInRange(periodStart, periodEnd);
        const byDept = {};
        let total = 0;
        
        depts.forEach(d => { byDept[d.id] = 0; });
        
        months.forEach(m => {
            (batchData[m] || []).forEach(r => {
                const deptId = r.department;
                const cost = parseFloat(r.cost) || 0;
                if (byDept[deptId] !== undefined) {
                    byDept[deptId] += cost;
                }
                total += cost;
            });
        });
        
        return { byDept, total };
    }
    
    /**
     * Calculate timebill category data from batch for a specific period
     * Replicates calculateTimeCategoryData logic using pre-fetched data
     * CRITICAL: Must use allocationBases for burden calculation, same as original!
     */
    function calculateTimebillFromBatch(batchData, cat, periodStart, periodEnd, depts, config, allocationBases) {
        const months = getMonthsInRange(periodStart, periodEnd);
        const timeFilters = cat.timeFilters || {};
        const costMethod = timeFilters.costMethod || 'labor_cost';
        const laborConfig = config.laborConfig || {};
        const allocationBase = cat.allocationBase || 'billed_hours';
        
        const result = {
            expense: {},
            burden: {},
            totalHours: 0,
            totalCost: 0,
            filteredHoursByDept: {},
            billedHoursByDept: {}
        };
        
        // Initialize
        depts.forEach(d => {
            result.expense[d.id] = 0;
            result.burden[d.id] = 0;
            result.filteredHoursByDept[d.id] = 0;
            result.billedHoursByDept[d.id] = 0;
        });
        result.expense['Overall'] = 0;
        result.burden['Overall'] = 0;
        
        // Filter settings
        const includeBillable = timeFilters.includeBillable !== false;
        const includeNonBillable = !!timeFilters.includeNonBillable;
        const billableDefinition = timeFilters.billableDefinition || 'customer';
        const categoryDeptIds = timeFilters.departmentIds || (timeFilters.departmentId ? [timeFilters.departmentId] : []);
        const categoryDeptSet = new Set(categoryDeptIds.map(id => String(id)));
        const serviceItems = timeFilters.serviceItems || [];
        const serviceItemSet = new Set(serviceItems.map(id => String(id)));
        
        // Employee type exclusions - combine category-level and global
        const categoryExclusions = (timeFilters.excludeEmpTypes || []).map(t => String(t));
        const globalExclusions = (config.globalExcludeEmpTypes || []).map(t => String(t));
        const excludedEmpTypes = new Set([...categoryExclusions, ...globalExclusions]);
        
        // If neither billable option selected, return empty
        if (!includeBillable && !includeNonBillable) {
            return result;
        }
        
        months.forEach(m => {
            (batchData[m] || []).forEach(r => {
                // Apply billable filter
                // billableDefinition determines how we identify billable vs non-billable:
                //   - 'customer' (default): Billable = has customer, Non-Billable = no customer
                //   - 'flag': Billable = isbillable='T', Non-Billable = isbillable='F'
                const isBillable = billableDefinition === 'flag'
                    ? (r.isbillable === 'T')
                    : (r.customer != null);
                if (isBillable && !includeBillable) return;
                if (!isBillable && !includeNonBillable) return;
                
                // Apply department filter (if category specifies departments)
                if (categoryDeptSet.size > 0 && !categoryDeptSet.has(String(r.department))) return;
                
                // Apply service item filter
                if (serviceItemSet.size > 0 && !serviceItemSet.has(String(r.item))) return;
                
                // Apply employee type exclusion
                if (excludedEmpTypes.size > 0 && r.employeetype && excludedEmpTypes.has(String(r.employeetype))) return;
                
                const hours = parseFloat(r.hours) || 0;
                const laborCost = parseFloat(r.laborcost) || 0;
                const deptId = r.department;
                
                // Calculate cost based on method
                let cost = 0;
                if (costMethod === 'labor_cost' || costMethod === 'employee_rate') {
                    cost = hours * laborCost;
                } else if (costMethod === 'loaded_labor') {
                    const loadingFactor = laborConfig.loadingFactor || 1.0;
                    cost = hours * laborCost * loadingFactor;
                } else if (costMethod === 'custom_rate') {
                    const customRate = parseFloat(timeFilters.customRate) || 50;
                    cost = hours * customRate;
                } else if (costMethod === 'fixed_rate') {
                    const fixedRate = cat.fixedRate || 0;
                    cost = hours * fixedRate;
                } else {
                    // Default to labor cost
                    cost = hours * laborCost;
                }
                
                result.totalHours += hours;
                result.totalCost += cost;
                result.expense['Overall'] += cost;
                
                if (result.expense[deptId] !== undefined) {
                    result.expense[deptId] += cost;
                    result.filteredHoursByDept[deptId] += hours;
                }
            });
        });
        
        // ═══════════════════════════════════════════════════════════════════════════
        // CRITICAL: Calculate burden using GLOBAL allocation base, NOT filtered hours!
        // This matches the original calculateTimeCategoryData logic.
        // The category cost is spread across ALL hours in the allocation base.
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Per-department burden: expense / global allocation base for that dept
        depts.forEach(d => {
            const base = getAllocationBaseValue(allocationBase, allocationBases, d.id);
            result.burden[d.id] = base > 0 ? result.expense[d.id] / base : 0;
        });
        
        // Overall burden: total expense / global allocation base overall
        const totalBase = getAllocationBaseValue(allocationBase, allocationBases, 'Overall');
        result.burden['Overall'] = totalBase > 0 ? result.totalCost / totalBase : 0;
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HISTORY CALCULATIONS (OPTIMIZED)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Combined history calculation for both rolling and category trends.
     * 
     * ═══════════════════════════════════════════════════════════════════════════
     * RUTHLESSLY EFFICIENT BATCH ARCHITECTURE
     * ═══════════════════════════════════════════════════════════════════════════
     * 
     * Before: 6 periods × (1 financials + 8 allocation bases + N timebill) = ~60+ SQL queries
     * After:  6 batch queries + 4 static queries = ~10 SQL queries total
     * 
     * Strategy:
     * 1. Batch fetch ALL date-dependent data with YYYY-MM grouping (6 SQL)
     * 2. Fetch static data once (headcount, sqft, units, custom)
     * 3. For each period: aggregate from batch in memory (NO SQL)
     * 4. Pre-calculate timebill categories from batch (NO SQL)
     * 5. Pass pre-calculated data to buildSummaryMultiBase
     * 
     * SINGLE SOURCE OF TRUTH: buildSummaryMultiBase is still the ONLY calculation
     * function. We just feed it data more efficiently.
     * 
     * @returns {{ history: Object, categoryHistory: Object }}
     */
    function calculateCombinedHistory(start, end, activeDepts, config, laborOverheadFactor, categories, classified) {
        const endDate = new Date(end);
        const startDate = new Date(start);
        const periodMonths = Math.max(1, Math.round((endDate - startDate) / (30 * 24 * 60 * 60 * 1000)));
        const profile = getActiveProfile(config);
        
        // Build 6 periods
        // CRITICAL: Period 0 (current) must use EXACT user date range
        // Historical periods use month-based calculation
        const periods = [];
        for (let i = 0; i <= 5; i++) {
            if (i === 0) {
                // Current period: use EXACT dates passed in (matches main dashboard)
                periods.push({
                    index: i,
                    start: start,
                    end: end,
                    label: endDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                    monthLabel: endDate.toLocaleDateString('en-US', { month: 'short' })
                });
            } else {
                // Historical periods: calculate based on months back
                // Use day=1 first to avoid month overflow issues
                const pEnd = new Date(endDate.getFullYear(), endDate.getMonth() - i + 1, 0); // Last day of month
                const pStart = new Date(pEnd.getFullYear(), pEnd.getMonth() - periodMonths + 1, 1); // First day of start month

                periods.push({
                    index: i,
                    start: Shared.formatDateYMD(pStart),
                    end: Shared.formatDateYMD(pEnd),
                    label: pEnd.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                    monthLabel: pEnd.toLocaleDateString('en-US', { month: 'short' })
                });
            }
        }

        // Initialize category trends structure
        const categoryTrends = {};
        categories.forEach(cat => {
            categoryTrends[cat.id] = {
                label: cat.label,
                color: cat.color,
                periods: []
            };
        });

        // ═══════════════════════════════════════════════════════════════════════════
        // BATCH FETCH: Get ALL data for entire date range in ~6 SQL queries
        // Then slice/aggregate per period in memory
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Determine full date range needed
        const oldestStart = periods[periods.length - 1].start;
        const newestEnd = periods[0].end;
        
        // Static data (fetched once)
        const allAccounts = loadAllExpenseAccounts();
        const staticHeadcount = fetchHeadcount(newestEnd, newestEnd, activeDepts);
        const staticSquareFeet = fetchSquareFeet(activeDepts, config);
        const staticUnits = fetchUnits(oldestStart, newestEnd, activeDepts, config);
        const staticCustom = fetchCustomMetrics(oldestStart, newestEnd, activeDepts, config);
        
        // Batch fetch date-dependent data for GL financials and allocation bases
        // NOTE: Timebill categories use SQL directly (complex cost methods like service_rate)
        const batchFinancials = batchFetchFinancials(oldestStart, newestEnd);
        const batchHours = batchFetchHours(oldestStart, newestEnd);
        const batchLaborDollars = batchFetchLaborDollars(oldestStart, newestEnd);
        const batchRevenue = batchFetchRevenue(oldestStart, newestEnd);
        const batchDirectCosts = batchFetchDirectCosts(oldestStart, newestEnd);
        
        const rollingPeriods = [];
        
        periods.forEach(p => {
            let financialData, processedFinancials, allocationBases;
            
            if (p.index === 0) {
                // ═══════════════════════════════════════════════════════════════
                // PERIOD 0 (CURRENT): Use DIRECT SQL for exact date matching
                // This ensures trends current period matches main dashboard exactly
                // ═══════════════════════════════════════════════════════════════
                financialData = fetchFinancialsDetailed(p.start, p.end);
                processedFinancials = processFinancials(financialData, activeDepts, allAccounts);
                allocationBases = fetchAllAllocationBases(p.start, p.end, activeDepts, config);
            } else {
                // ═══════════════════════════════════════════════════════════════
                // PERIODS 1-5 (HISTORICAL): Use batch for GL financials, SQL for timebill
                // GL expense aggregation is simple (sum by month) - batch is safe
                // Timebill has complex cost methods (service_rate, average_rate) - use SQL
                // ═══════════════════════════════════════════════════════════════
                financialData = aggregateFinancialsFromBatch(batchFinancials, p.start, p.end);
                processedFinancials = processFinancials(financialData, activeDepts, allAccounts);
                allocationBases = {
                    hours: aggregateHoursFromBatch(batchHours, p.start, p.end, activeDepts),
                    laborDollars: aggregateLaborDollarsFromBatch(batchLaborDollars, p.start, p.end, activeDepts),
                    revenue: aggregateRevenueFromBatch(batchRevenue, p.start, p.end, activeDepts),
                    directCost: aggregateDirectCostsFromBatch(batchDirectCosts, p.start, p.end, activeDepts),
                    headcount: staticHeadcount,
                    squareFeet: staticSquareFeet,
                    units: staticUnits,
                    custom: staticCustom
                };
            }
            
            // ═══════════════════════════════════════════════════════════════
            // SINGLE SOURCE OF TRUTH: buildSummaryMultiBase
            // Timebill categories ALWAYS use SQL (preCalcTimebill = null)
            // This ensures complex cost methods (service_rate, average_rate) work correctly
            // ═══════════════════════════════════════════════════════════════
            const summary = buildSummaryMultiBase(
                processedFinancials,
                allocationBases,
                activeDepts,
                {}, // unbilled data not needed for history
                config,
                classified,
                categories,
                p.start,
                p.end,
                null  // ALWAYS use SQL for timebill - batch can't handle service_rate/average_rate
            );
            
            // Extract data from summary (same structure as main dashboard)
            const totalExpense = summary.totalExpense || 0;
            const totalBilledHours = allocationBases.hours?.totalBilled || 1;
            const totalRate = summary.compositeRate || 0;
            
            // Build category trends from summary
            (summary.categories || []).forEach(cat => {
                if (categoryTrends[cat.id]) {
                    categoryTrends[cat.id].periods.push({
                        label: p.label,
                        expense: cat.totalExpense || 0,
                        rate: cat.totalBurden || 0
                    });
                }
            });
            
            // Build per-department data from summary
            const deptData = {};
            activeDepts.forEach(d => {
                const deptId = String(d.id);
                const deptIdNum = d.id;
                
                // Sum expense and rate from ALL categories for this dept
                let deptExpense = 0;
                let deptRate = 0;
                (summary.categories || []).forEach(cat => {
                    if (cat.includeInComposite !== false) {
                        deptExpense += cat.expense?.[deptId] || cat.expense?.[deptIdNum] || 0;
                        deptRate += cat.burden?.[deptId] || cat.burden?.[deptIdNum] || 0;
                    }
                });
                
                const deptHours = allocationBases.hours?.byDept?.[deptId]?.billed || 
                                  allocationBases.hours?.byDept?.[deptIdNum]?.billed || 0;
                
                deptData[deptId] = {
                    name: d.name,
                    expense: deptExpense,
                    rate: deptRate,
                    hours: deptHours
                };
                deptData[deptIdNum] = deptData[deptId];
            });
            
            rollingPeriods.push({
                label: p.label,
                monthLabel: p.monthLabel,
                start: p.start,
                end: p.end,
                totalExpense: totalExpense,
                totalHours: totalBilledHours,
                totalRate: totalRate,
                deptData
            });
        });

        // Reverse to chronological order
        rollingPeriods.reverse();
        Object.keys(categoryTrends).forEach(catId => {
            categoryTrends[catId].periods.reverse();
        });

        // Calculate rate change
        const firstRate = rollingPeriods[0]?.totalRate || 0;
        const lastRate = rollingPeriods[rollingPeriods.length - 1]?.totalRate || 0;
        const rateChange = firstRate > 0 ? ((lastRate - firstRate) / firstRate) * 100 : 0;

        // Build history object matching expected structure
        const history = {
            periodMonths,
            periods: rollingPeriods,
            currentRate: lastRate,
            previousRate: rollingPeriods.length > 1 ? rollingPeriods[rollingPeriods.length - 2]?.totalRate : 0,
            rateChange,
            deptRates: buildDeptRateHistory(rollingPeriods, activeDepts)
        };

        return {
            history,
            categoryHistory: categoryTrends
        };
    }

    function calculateRollingHistory(start, end, activeDepts, config, laborOverheadFactor, categories, classified) {
        const endDate = new Date(end);
        const startDate = new Date(start);
        const periodMonths = Math.max(1, Math.round((endDate - startDate) / (30 * 24 * 60 * 60 * 1000)));

        const periods = [];

        // Calculate 6 rolling periods for trend chart
        for (let i = 0; i <= 5; i++) {
            const pEnd = new Date(endDate);
            pEnd.setMonth(pEnd.getMonth() - i);
            pEnd.setDate(1);
            pEnd.setMonth(pEnd.getMonth() + 1);
            pEnd.setDate(0);

            const pStart = new Date(pEnd);
            pStart.setMonth(pStart.getMonth() - periodMonths + 1);
            pStart.setDate(1);

            const pStartStr = Shared.formatDateYMD(pStart);
            const pEndStr = Shared.formatDateYMD(pEnd);

            const periodData = calculatePeriodBurden(pStartStr, pEndStr, activeDepts, config, laborOverheadFactor);

            periods.push({
                index: i,
                start: pStartStr,
                end: pEndStr,
                label: pEnd.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                monthLabel: pEnd.toLocaleDateString('en-US', { month: 'short' }),
                ...periodData
            });
        }

        // Calculate rate change
        const currentRate = periods[0]?.totalRate || 0;
        const previousRate = periods[1]?.totalRate || 0;
        const rateChange = previousRate > 0 ? ((currentRate - previousRate) / previousRate) * 100 : 0;

        return {
            periodMonths,
            periods: periods.reverse(), // Oldest first for charts
            currentRate,
            previousRate,
            rateChange,
            deptRates: buildDeptRateHistory(periods, activeDepts)
        };
    }

    function calculatePeriodBurden(start, end, activeDepts, config, laborOverheadFactor) {
        const hoursData = fetchHoursData(start, end, activeDepts);
        const unbilledMode = config.unbilledHoursMode || 'all';

        let unbilledLabourData = { byDept: {}, total: 0 };
        if (unbilledMode !== 'disabled') {
            if (unbilledMode === 'selected_items') {
                unbilledLabourData = fetchUnbilledLabourByItem(start, end, activeDepts, laborOverheadFactor, config.unbilledItemPattern || '%Direct Labour%');
            } else {
                unbilledLabourData = fetchUnbilledLabourAll(start, end, activeDepts, laborOverheadFactor);
            }
        }

        const financialData = fetchFinancialsDetailed(start, end);
        
        // Build set of allowed department IDs for filtering
        const allowedDeptIds = new Set(activeDepts.map(d => String(d.id)));
        
        // Build expense by department from actual transaction data - ONLY from active departments
        const expenseByDept = {};
        let totalExpense = 0;
        
        financialData.forEach(row => {
            const amount = parseFloat(row.amount) || 0;
            const rawDeptId = row.department;
            const deptId = rawDeptId != null ? String(rawDeptId) : 'none';
            
            // CRITICAL: Only include expense from active departments
            if (allowedDeptIds.has(deptId) || deptId === 'none') {
                totalExpense += amount;
                expenseByDept[deptId] = (expenseByDept[deptId] || 0) + amount;
            }
        });
        
        // Add unbilled labour expense (already filtered to active depts)
        totalExpense += unbilledLabourData.total || 0;
        const unbilledByDept = unbilledLabourData.byDept || {};
        Object.keys(unbilledByDept).forEach(deptIdKey => {
            const unbilledAmt = unbilledByDept[deptIdKey]?.cost || unbilledByDept[deptIdKey]?.total || 
                               (typeof unbilledByDept[deptIdKey] === 'number' ? unbilledByDept[deptIdKey] : 0);
            const strKey = String(deptIdKey);
            if (allowedDeptIds.has(strKey)) {
                expenseByDept[strKey] = (expenseByDept[strKey] || 0) + unbilledAmt;
            }
        });
        
        const totalBilledHours = hoursData.totalBilled || 1;
        const totalRate = Shared.safeDiv(totalExpense, totalBilledHours);

        // Check if we have meaningful department-level expense data
        // If most expense is untagged (no dept), we'll allocate proportionally by hours
        const taggedExpense = activeDepts.reduce((sum, d) => {
            return sum + (expenseByDept[String(d.id)] || 0);
        }, 0);
        const untaggedExpense = totalExpense - taggedExpense;
        const hasRealDeptExpense = taggedExpense > totalExpense * 0.1; // Lower threshold to 10%

        // Calculate per-department data
        const deptData = {};
        activeDepts.forEach(d => {
            const strId = String(d.id);
            const deptHoursObj = hoursData.byDept[d.id] || hoursData.byDept[strId] || {};
            const deptHours = deptHoursObj.billed || 0;
            const hoursPct = totalBilledHours > 0 ? deptHours / totalBilledHours : 0;
            
            let deptExpense, deptRate;
            
            if (hasRealDeptExpense) {
                // Use actual expense for this department
                deptExpense = expenseByDept[strId] || 0;
                deptRate = deptHours > 0 ? deptExpense / deptHours : 0;
            } else {
                // Allocate total expense proportionally by hours (since expenses aren't tagged to depts)
                deptExpense = totalExpense * hoursPct;
                deptRate = totalRate; // Same rate for all depts when allocating by hours
            }
            
            deptData[d.id] = {
                name: d.name,
                hours: deptHours,
                expense: deptExpense,
                rate: deptRate,
                hoursPct: hoursPct * 100,
                isAllocated: !hasRealDeptExpense // Flag if this is allocated vs actual
            };
        });

        return {
            totalExpense,
            totalHours: totalBilledHours,
            totalRate,
            deptData,
            hasRealDeptExpense
        };
    }

    function buildDeptRateHistory(periods, depts) {
        const result = {};
        depts.forEach(d => {
            const deptId = d.id;
            const strDeptId = String(d.id);
            result[deptId] = {
                name: d.name,
                rates: periods.map(p => {
                    // Handle both numeric and string keys
                    const deptData = p.deptData || {};
                    const deptInfo = deptData[deptId] || deptData[strDeptId] || {};
                    return {
                        label: p.label,
                        rate: deptInfo.rate || 0
                    };
                })
            };
        });
        return result;
    }

    function calculateCategoryHistory(start, end, activeDepts, config, laborOverheadFactor, categories, classified) {
        const endDate = new Date(end);
        const periods = [];

        // 6 months of history per category
        for (let i = 0; i <= 5; i++) {
            const pEnd = new Date(endDate);
            pEnd.setMonth(pEnd.getMonth() - i);
            pEnd.setDate(1);
            pEnd.setMonth(pEnd.getMonth() + 1);
            pEnd.setDate(0);

            const pStart = new Date(pEnd);
            pStart.setDate(1);

            periods.push({
                start: Shared.formatDateYMD(pStart),
                end: Shared.formatDateYMD(pEnd),
                label: pEnd.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
            });
        }

        // OPTIMIZATION: Fetch data ONCE per period, then calculate all categories
        // This reduces queries from (categories × periods × 9) to (periods × 9)
        const periodDataCache = {};
        
        periods.forEach(p => {
            // Fetch allocation bases and financials ONCE per period
            periodDataCache[p.label] = {
                allocationBases: fetchAllAllocationBases(p.start, p.end, activeDepts, config),
                financials: fetchFinancialsDetailed(p.start, p.end)
            };
        });

        // For each category, calculate rate over each period using cached data
        const categoryTrends = {};

        categories.forEach(cat => {
            categoryTrends[cat.id] = {
                label: cat.label,
                color: cat.color,
                periods: []
            };

            const catIdStr = String(cat.id);
            const categoryAccounts = classified.byCategory[catIdStr] || [];
            const accountIds = new Set(categoryAccounts.map(a => String(a.id)));

            periods.forEach(p => {
                const cached = periodDataCache[p.label];
                const allocationBases = cached.allocationBases;
                const financials = cached.financials;

                // Calculate expense for this category from cached financials
                let categoryExpense = 0;
                financials.forEach(f => {
                    if (accountIds.has(String(f.account))) {
                        categoryExpense += parseFloat(f.amount) || 0;
                    }
                });

                const base = getAllocationBaseValue(cat.allocationBase || 'billed_hours', allocationBases, 'Overall');
                const rate = Shared.safeDiv(categoryExpense, base);

                categoryTrends[cat.id].periods.push({
                    label: p.label,
                    expense: categoryExpense,
                    rate
                });
            });

            categoryTrends[cat.id].periods.reverse(); // Oldest first
        });

        return categoryTrends;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BUDGET VARIANCE
    // ═══════════════════════════════════════════════════════════════════════════

    function calculateBudgetVariance(summary, config, activeDepts) {
        const budgetedRates = config.budgetedRates || {};
        const variance = {
            byCategory: {},
            byDept: {},
            overall: null
        };

        // Overall variance
        if (budgetedRates.overall) {
            const actual = summary.compositeRate;
            const budget = parseFloat(budgetedRates.overall);
            variance.overall = {
                budgeted: budget,
                actual: actual,
                variance: actual - budget,
                variancePercent: budget > 0 ? ((actual - budget) / budget) * 100 : 0,
                status: actual <= budget ? 'favorable' : 'unfavorable'
            };
        }

        // Per-category variance
        summary.categories.forEach(cat => {
            if (budgetedRates[cat.id]) {
                const actual = cat.totalBurden;
                const budget = parseFloat(budgetedRates[cat.id]);
                variance.byCategory[cat.id] = {
                    label: cat.label,
                    budgeted: budget,
                    actual: actual,
                    variance: actual - budget,
                    variancePercent: budget > 0 ? ((actual - budget) / budget) * 100 : 0,
                    status: actual <= budget ? 'favorable' : 'unfavorable'
                };
            }
        });

        // Per-department variance
        activeDepts.forEach(d => {
            if (budgetedRates[`dept_${d.id}`]) {
                const actual = summary.totals.burden[d.id] || 0;
                const budget = parseFloat(budgetedRates[`dept_${d.id}`]);
                variance.byDept[d.id] = {
                    name: d.name,
                    budgeted: budget,
                    actual: actual,
                    variance: actual - budget,
                    variancePercent: budget > 0 ? ((actual - budget) / budget) * 100 : 0,
                    status: actual <= budget ? 'favorable' : 'unfavorable'
                };
            }
        });

        return variance;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ALERTS
    // ═══════════════════════════════════════════════════════════════════════════

    function generateAlerts(summary, absorption, classified, budgetVariance, config) {
        const alerts = [];

        // Unassigned accounts with significant amounts
        if (classified.unassigned.length > 0) {
            alerts.push({
                type: 'warning',
                icon: 'exclamation-triangle',
                title: `${classified.unassigned.length} Unassigned Accounts`,
                message: 'Expense accounts need category assignment for accurate rate calculation.',
                action: { label: 'Classify Now', tab: 'accounts' }
            });
        }

        // Under-absorption
        if (absorption.status === 'under_absorbed' && Math.abs(absorption.variancePercent) > 5) {
            alerts.push({
                type: 'danger',
                icon: 'arrow-down',
                title: 'Under-Absorption Detected',
                message: `Burden applied is ${Math.abs(absorption.variancePercent).toFixed(1)}% below actual overhead expenses.`,
                action: { label: 'View Details', tab: 'dashboard' }
            });
        }

        // Budget variance
        if (budgetVariance.overall && budgetVariance.overall.status === 'unfavorable' && budgetVariance.overall.variancePercent > 10) {
            alerts.push({
                type: 'warning',
                icon: 'chart-line',
                title: 'Budget Variance',
                message: `Actual rate exceeds budget by ${budgetVariance.overall.variancePercent.toFixed(1)}%.`,
                action: { label: 'View Variance', tab: 'rates' }
            });
        }

        return alerts;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RATE FORECASTING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Calculate linear regression trend from historical data points
     * @param {Array} dataPoints - Array of { x: period, y: value } or just values
     * @returns {Object} { slope, intercept, r2, trend: 'up'|'down'|'stable' }
     */
    function calculateTrend(dataPoints) {
        if (!dataPoints || dataPoints.length < 2) {
            return { slope: 0, intercept: 0, r2: 0, trend: 'stable' };
        }

        // Normalize to array of values if needed
        const values = dataPoints.map((p, i) => ({
            x: typeof p === 'object' ? (p.x || i) : i,
            y: typeof p === 'object' ? (p.y || p.rate || p.value || 0) : p
        }));

        const n = values.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

        values.forEach(p => {
            sumX += p.x;
            sumY += p.y;
            sumXY += p.x * p.y;
            sumX2 += p.x * p.x;
            sumY2 += p.y * p.y;
        });

        const denominator = (n * sumX2 - sumX * sumX);
        if (denominator === 0) {
            return { slope: 0, intercept: sumY / n, r2: 0, trend: 'stable' };
        }

        const slope = (n * sumXY - sumX * sumY) / denominator;
        const intercept = (sumY - slope * sumX) / n;

        // Calculate R-squared (coefficient of determination)
        const yMean = sumY / n;
        let ssTotal = 0, ssResidual = 0;
        values.forEach(p => {
            const predicted = slope * p.x + intercept;
            ssTotal += Math.pow(p.y - yMean, 2);
            ssResidual += Math.pow(p.y - predicted, 2);
        });
        const r2 = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;

        // Determine trend direction
        const avgY = sumY / n;
        const slopePercent = avgY > 0 ? (slope / avgY) * 100 : 0;
        let trend = 'stable';
        if (slopePercent > 2) trend = 'up';
        else if (slopePercent < -2) trend = 'down';

        return { slope, intercept, r2, trend, slopePercent };
    }

    /**
     * Calculate confidence level for forecast based on trend strength and distance
     * @param {Object} trend - Trend data from calculateTrend
     * @param {number} periodsAhead - How many periods into future
     * @returns {number} Confidence level 0-1
     */
    function calculateConfidence(trend, periodsAhead) {
        // Base confidence from R-squared (how well data fits trend)
        const baseConfidence = Math.max(0.5, Math.min(0.95, trend.r2 || 0.7));
        
        // Decay confidence as we project further into future
        // Each period reduces confidence by ~5%
        const decayFactor = Math.pow(0.95, periodsAhead);
        
        return Math.max(0.3, baseConfidence * decayFactor);
    }

    /**
     * Get forecast assumptions from config with defaults
     */
    function getForecastAssumptions(config) {
        const assumptions = config.forecastAssumptions || {};
        return {
            periods: assumptions.periods || 6,
            periodUnit: assumptions.periodUnit || 'month',
            defaultEscalation: assumptions.defaultEscalation || 0.03,  // 3% annual
            volumeChange: assumptions.volumeChange || 0,
            categoryEscalation: assumptions.categoryEscalation || {},
            includeConfidenceBands: assumptions.includeConfidenceBands !== false
        };
    }

    /**
     * Project rates forward based on historical trends and assumptions
     * @param {Object} historicalData - History data with periods and category trends
     * @param {Object} config - Configuration with forecast assumptions
     * @param {Object} currentSummary - Current period summary data
     * @returns {Object} Forecast data with projections and confidence intervals
     */
    function forecastRates(historicalData, config, currentSummary) {
        const assumptions = getForecastAssumptions(config);
        const categoryTrends = historicalData.categoryTrends || {};
        const historyPeriods = historicalData.periods || [];
        
        // Calculate trends for each category from history
        const categoryAnalysis = {};
        Object.keys(categoryTrends).forEach(catId => {
            const catHistory = categoryTrends[catId];
            const periods = catHistory.periods || [];
            const rateHistory = periods.map((p, i) => ({ x: i, y: p.rate || 0 }));
            const expenseHistory = periods.map((p, i) => ({ x: i, y: p.expense || 0 }));
            
            categoryAnalysis[catId] = {
                label: catHistory.label,
                color: catHistory.color,
                rateTrend: calculateTrend(rateHistory),
                expenseTrend: calculateTrend(expenseHistory),
                currentRate: periods.length > 0 ? periods[periods.length - 1].rate : 0,
                currentExpense: periods.length > 0 ? periods[periods.length - 1].expense : 0
            };
        });

        // Calculate composite trend from history
        const compositeHistory = historyPeriods.map((p, i) => ({ x: i, y: p.totalRate || 0 }));
        const compositeTrend = calculateTrend(compositeHistory);

        // Generate forecasts for future periods
        const forecasts = [];
        const currentCompositeRate = currentSummary.compositeRate || 0;
        const currentDate = new Date();

        for (let i = 1; i <= assumptions.periods; i++) {
            const forecastDate = new Date(currentDate);
            forecastDate.setMonth(forecastDate.getMonth() + i);
            
            const forecast = {
                period: i,
                label: `+${i} ${assumptions.periodUnit}${i > 1 ? 's' : ''}`,
                monthLabel: forecastDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                date: forecastDate.toISOString().split('T')[0],
                categories: {},
                compositeRate: 0,
                confidenceLow: 0,
                confidenceHigh: 0
            };

            let projectedComposite = 0;

            // Project each category
            Object.keys(categoryAnalysis).forEach(catId => {
                const cat = categoryAnalysis[catId];
                const escalation = assumptions.categoryEscalation[catId] || assumptions.defaultEscalation;
                
                // Monthly escalation factor (convert annual to monthly)
                const monthlyEscalation = Math.pow(1 + escalation, 1/12) - 1;
                
                // Project using trend + escalation
                const trendProjection = cat.currentRate + (cat.rateTrend.slope * i);
                const escalationProjection = cat.currentRate * Math.pow(1 + monthlyEscalation, i);
                
                // Blend: weight trend more for near-term, escalation more for far-term
                const trendWeight = Math.max(0.3, 1 - (i * 0.1));
                const projectedRate = (trendProjection * trendWeight) + (escalationProjection * (1 - trendWeight));
                
                // Calculate confidence
                const confidence = calculateConfidence(cat.rateTrend, i);
                
                // Confidence band (wider as confidence decreases)
                const bandWidth = projectedRate * (1 - confidence) * 0.5;

                forecast.categories[catId] = {
                    label: cat.label,
                    color: cat.color,
                    projectedRate: Math.max(0, projectedRate),
                    confidence: confidence,
                    confidenceLow: Math.max(0, projectedRate - bandWidth),
                    confidenceHigh: projectedRate + bandWidth,
                    trend: cat.rateTrend.trend,
                    escalationApplied: escalation
                };

                // Add to composite (if category is included)
                const catData = (currentSummary.categories || []).find(c => c.id === catId);
                if (!catData || catData.includeInComposite !== false) {
                    projectedComposite += Math.max(0, projectedRate);
                }
            });

            // Composite rate forecast
            forecast.compositeRate = projectedComposite;
            
            // Composite confidence bands
            const compositeConfidence = calculateConfidence(compositeTrend, i);
            const compositeBand = projectedComposite * (1 - compositeConfidence) * 0.3;
            forecast.confidenceLow = Math.max(0, projectedComposite - compositeBand);
            forecast.confidenceHigh = projectedComposite + compositeBand;
            forecast.confidence = compositeConfidence;

            forecasts.push(forecast);
        }

        // Calculate projected annual impact
        const avgForecastRate = forecasts.reduce((sum, f) => sum + f.compositeRate, 0) / forecasts.length;
        const rateChange = currentCompositeRate > 0 
            ? ((avgForecastRate - currentCompositeRate) / currentCompositeRate) * 100 
            : 0;

        return {
            assumptions,
            categoryAnalysis,
            compositeTrend: {
                ...compositeTrend,
                currentRate: currentCompositeRate
            },
            forecasts,
            summary: {
                currentRate: currentCompositeRate,
                avgForecastRate,
                rateChange,
                direction: rateChange > 1 ? 'increasing' : rateChange < -1 ? 'decreasing' : 'stable',
                periodsForecast: assumptions.periods,
                generatedAt: new Date().toISOString()
            }
        };
    }

    /**
     * Get forecast data via request handler
     */
    function getForecast(data) {
        const { startDate, endDate } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const categories = profile.categories || [];
        const hiddenDepts = config.burdenHiddenDepts || [];
        const allDepts = getAllDepartments();
        const activeDepts = allDepts.filter(d => !hiddenDepts.includes(String(d.id)));
        const laborOverheadFactor = config.laborOverheadFactor || 1.15;

        // Get current summary - SAME PATTERN AS getData()
        const allAccounts = loadAllExpenseAccounts();
        const classified = classifyAccounts(allAccounts, profile, categories);
        const allocationBases = fetchAllAllocationBases(startDate, endDate, activeDepts, config);
        const financialData = fetchFinancialsDetailed(startDate, endDate);
        const processedFinancials = processFinancials(financialData, activeDepts, allAccounts);
        const unbilledLabourData = fetchUnbilledLabour(startDate, endDate, activeDepts, laborOverheadFactor, config);
        
        const summary = buildSummaryMultiBase(
            processedFinancials,
            allocationBases,
            activeDepts,
            unbilledLabourData,
            config,
            classified,
            categories,
            startDate,
            endDate
        );

        // Get historical data for trends (using combined function for efficiency)
        const { history, categoryHistory } = calculateCombinedHistory(startDate, endDate, activeDepts, config, laborOverheadFactor, categories, classified);

        // Generate forecast
        const forecast = forecastRates(
            { periods: history.periods, categoryTrends: categoryHistory },
            config,
            summary
        );

        return forecast;
    }

    /**
     * Save forecast assumptions to config
     */
    function saveForecastAssumptions(data) {
        const { assumptions } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        
        config.forecastAssumptions = {
            periods: parseInt(assumptions.periods) || 6,
            periodUnit: assumptions.periodUnit || 'month',
            defaultEscalation: parseFloat(assumptions.defaultEscalation) || 0.03,
            volumeChange: parseFloat(assumptions.volumeChange) || 0,
            categoryEscalation: assumptions.categoryEscalation || {},
            includeConfidenceBands: assumptions.includeConfidenceBands !== false
        };

        return ConfigLib.save(config, 'burden');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DEPARTMENTS
    // ═══════════════════════════════════════════════════════════════════════════

    function getAllDepartments() {
        return Shared.runSuiteQL(`SELECT id, name FROM department WHERE isinactive = 'F' ORDER BY name`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REQUEST HANDLER
    // ═══════════════════════════════════════════════════════════════════════════

    function handleRequest(data) {
        const action = data.subAction || data.action;
        auditLog('HANDLE_REQUEST', 'Action: ' + action);

        switch (action) {
            case 'category_drilldown':
                return getCategoryDrilldown(data);
            case 'account_transactions':
                return getAccountTransactions(data);
            case 'cell_drilldown':
                return getCellDrilldown(data);
            case 'save_classification':
                return saveAccountClassification(data);
            case 'save_category':
                auditLog('HANDLE_REQUEST', 'Calling saveCategory...');
                return saveCategory(data);
            case 'save_category_order':
                return saveCategoryOrder(data);
            case 'delete_category':
                return deleteCategory(data);
            case 'preview_time_category':
                return previewTimeCategory(data);
            case 'scenario_calculate':
                return calculateScenario(data);
            case 'scenario_save':
                return saveScenario(data);
            case 'scenario_delete':
                return deleteScenario(data);
            case 'scenario_list':
                return listScenarios(data);
            case 'selling_rate':
                return calculateSellingRate(data);
            case 'export_rates':
                return exportRates(data);
            case 'search_accounts':
                return searchAccounts(data);
            case 'get_forecast':
                return getForecast(data);
            case 'save_forecast_assumptions':
                return saveForecastAssumptions(data);
            case 'auto_assign_all':
                return autoAssignAll(data);
            case 'exclude_remaining':
                return excludeRemaining(data);
            case 'import_config':
                return importConfig(data);
            case 'preview_migration':
                return previewMigration(data);
            case 'execute_migration':
                return executeMigration(data);
            case 'import_csv':
                return importCSV(data);
            case 'set_active_profile':
                return setActiveProfile(data);
            case 'save_profile':
                return saveProfile(data);
            case 'delete_profile':
                return deleteProfile(data);
            case 'duplicate_profile':
                return duplicateProfile(data);
            case 'get_labor_filters':
                return getLaborFilters();
            case 'get_labor_rates':
                return getLaborRates(data);
            case 'get_employee_types':
                return getEmployeeTypes();
            default:
                return { error: 'Unknown burden action: ' + action };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LABOR COST FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getLaborFilters() {
        // Get unique job titles from employee.title field
        const titlesSql = `
            SELECT DISTINCT 
                e.title as id,
                e.title as name
            FROM employee e
            WHERE e.isinactive = 'F'
              AND e.title IS NOT NULL
            ORDER BY e.title
        `;
        
        // Get service items actually used in time entries
        const servicesSql = `
            SELECT DISTINCT
                tb.item as id,
                i.itemid as name
            FROM timebill tb
            INNER JOIN item i ON tb.item = i.id
            WHERE tb.item IS NOT NULL
              AND i.isinactive = 'F'
            ORDER BY i.itemid
            FETCH FIRST 100 ROWS ONLY
        `;
        
        // Get employee types
        const empTypesSql = `
            SELECT 
                id,
                name
            FROM employeetype
            ORDER BY name
        `;
        
        try {
            let titles = [];
            try {
                titles = Shared.runSuiteQL(titlesSql) || [];
            } catch (te) {
                debugLog('Title query failed', te.message);
            }
            
            let serviceItems = [];
            try {
                serviceItems = Shared.runSuiteQL(servicesSql) || [];
            } catch (se) {
                debugLog('Service items query failed', se.message);
            }
            
            let employeeTypes = [];
            try {
                employeeTypes = Shared.runSuiteQL(empTypesSql) || [];
            } catch (ete) {
                debugLog('Employee types query failed', ete.message);
            }
            
            return {
                titles: titles,
                serviceItems: serviceItems,
                employeeTypes: employeeTypes
            };
        } catch (e) {
            return { titles: [], serviceItems: [], employeeTypes: [], error: e.message };
        }
    }

    function getEmployeeTypes() {
        const sql = `
            SELECT 
                id,
                name
            FROM employeetype
            WHERE isinactive = 'F'
            ORDER BY name
        `;
        
        try {
            const employeeTypes = Shared.runSuiteQL(sql) || [];
            return { employeeTypes: employeeTypes };
        } catch (e) {
            // Try without isinactive filter (may not exist on all versions)
            try {
                const fallbackSql = `SELECT id, name FROM employeetype ORDER BY name`;
                const employeeTypes = Shared.runSuiteQL(fallbackSql) || [];
                return { employeeTypes: employeeTypes };
            } catch (e2) {
                return { employeeTypes: [], error: e.message };
            }
        }
    }

    function previewTimeCategory(data) {
        const { filters, startDate, endDate } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        
        // Build WHERE clause based on filters
        let whereClause = `WHERE t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')`;
        
        // Time status filter
        // billableDefinition determines how we identify billable vs non-billable:
        //   - 'customer' (default): Billable = has customer, Non-Billable = no customer
        //   - 'flag': Billable = isbillable='T', Non-Billable = isbillable='F'
        const billableDefinition = filters.billableDefinition || 'customer';
        const statusConditions = [];
        if (filters.includeBillable) {
            if (billableDefinition === 'flag') {
                statusConditions.push("(t.isbillable = 'T')");
            } else {
                statusConditions.push("(t.customer IS NOT NULL)");
            }
        }
        if (filters.includeNonBillable) {
            if (billableDefinition === 'flag') {
                statusConditions.push("(t.isbillable = 'F')");
            } else {
                statusConditions.push("(t.customer IS NULL)");
            }
        }
        if (statusConditions.length > 0) {
            whereClause += ` AND (${statusConditions.join(' OR ')})`;
        } else {
            whereClause += ` AND 1=0`; // No status selected = no data
        }
        
        // Department filter (category-level only for preview)
        const categoryDeptIds = filters.departmentIds || (filters.departmentId ? [filters.departmentId] : []);
        const categoryDeptList = categoryDeptIds.map(id => parseInt(id)).filter(id => !isNaN(id));
        if (categoryDeptList.length > 0) {
            whereClause += ` AND t.department IN (${categoryDeptList.join(',')})`;
        }
        // Note: Do NOT filter by global hidden depts here - preview shows what this category captures
        
        // Service item filter
        if (filters.serviceItems && filters.serviceItems.length > 0) {
            whereClause += ` AND t.item IN (${filters.serviceItems.join(',')})`;
        }
        
        // Employee type exclusion - combine category-level and global exclusions
        const categoryExclusions = (filters.excludeEmpTypes || []).map(t => String(t));
        const globalExclusions = (config.globalExcludeEmpTypes || []).map(t => String(t));
        const combinedExclusions = [...new Set([...categoryExclusions, ...globalExclusions])]; // Dedupe
        
        let empTypeJoin = '';
        if (combinedExclusions.length > 0) {
            empTypeJoin = `LEFT JOIN employee emp ON t.employee = emp.id`;
            whereClause += ` AND (emp.employeetype IS NULL OR emp.employeetype NOT IN (${combinedExclusions.join(',')}))`;
        }
        
        // Cost calculation based on method
        let costExpr = 't.hours * COALESCE(e.laborcost, 0)'; // Default: employee rate
        let avgRateSubquery = '';
        
        if (filters.costMethod === 'custom_rate') {
            costExpr = `t.hours * ${parseFloat(filters.customRate) || 50}`;
        } else if (filters.costMethod === 'service_rate') {
            costExpr = 't.hours * COALESCE(i.cost, i.rate, e.laborcost, 0)';
        } else if (filters.costMethod === 'average_rate') {
            // Use company average labor rate
            avgRateSubquery = `(SELECT AVG(laborcost) FROM employee WHERE isinactive = 'F' AND laborcost > 0)`;
            costExpr = `t.hours * COALESCE(${avgRateSubquery}, e.laborcost, 0)`;
        }
        
        // Get both total hours and billed hours for accurate rate calculation
        const sql = `
            SELECT 
                SUM(t.hours) as total_hours,
                SUM(CASE WHEN t.customer IS NOT NULL THEN t.hours ELSE 0 END) as billed_hours,
                SUM(${costExpr}) as total_cost
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            LEFT JOIN item i ON t.item = i.id
            ${empTypeJoin}
            ${whereClause}
        `;
        
        try {
            const results = Shared.runSuiteQL(sql) || [];
            const row = results[0] || {};
            const hours = parseFloat(row.total_hours) || 0;
            const billedHours = parseFloat(row.billed_hours) || 0;
            const cost = parseFloat(row.total_cost) || 0;
            
            // Return both hours values so frontend can calculate rate correctly
            return {
                hours: hours,
                billedHours: billedHours,
                cost: cost,
                // Pre-calculate rate using billed hours (matches tabular data logic)
                rate: billedHours > 0 ? cost / billedHours : 0
            };
        } catch (e) {
            log.error('previewTimeCategory', e.message);
            return { hours: 0, billedHours: 0, cost: 0, rate: 0, error: e.message };
        }
    }

    function getLaborRates(data) {
        const { departmentId, titleId, serviceItemId, aggregation } = data;
        
        // If service item filter is specified, we need to get employees from timebill
        if (serviceItemId) {
            return getLaborRatesFromTimebill(data);
        }
        
        // Build dynamic WHERE clause for direct employee query
        let whereClause = "WHERE e.isinactive = 'F' AND e.laborcost IS NOT NULL AND e.laborcost > 0";
        
        if (departmentId) {
            whereClause += " AND e.department = " + parseInt(departmentId);
        }
        if (titleId) {
            whereClause += " AND e.title = '" + String(titleId).replace(/'/g, "''") + "'";
        }
        
        const sql = `
            SELECT 
                e.id,
                e.entityid as name,
                e.laborcost,
                e.department
            FROM employee e
            ${whereClause}
            ORDER BY e.laborcost
        `;
        
        try {
            const employees = Shared.runSuiteQL(sql) || [];
            
            if (employees.length === 0) {
                return { rate: 0, employeeCount: 0, error: 'No employees found with labor costs' };
            }
            
            const rates = employees.map(e => parseFloat(e.laborcost) || 0).filter(r => r > 0);
            
            let rate = 0;
            if (aggregation === 'median') {
                rates.sort((a, b) => a - b);
                const mid = Math.floor(rates.length / 2);
                rate = rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
            } else if (aggregation === 'weighted') {
                rate = rates.reduce((a, b) => a + b, 0) / rates.length;
            } else {
                rate = rates.reduce((a, b) => a + b, 0) / rates.length;
            }
            
            return {
                rate: rate,
                employeeCount: employees.length,
                min: Math.min(...rates),
                max: Math.max(...rates),
                aggregation: aggregation
            };
        } catch (e) {
            return { rate: 0, employeeCount: 0, error: e.message };
        }
    }

    function getLaborRatesFromTimebill(data) {
        const { departmentId, titleId, serviceItemId, aggregation } = data;
        
        // Get employees who have logged time to this service item
        let whereClause = "WHERE e.isinactive = 'F' AND e.laborcost IS NOT NULL AND e.laborcost > 0";
        whereClause += " AND tb.item = " + parseInt(serviceItemId);
        
        if (departmentId) {
            whereClause += " AND e.department = " + parseInt(departmentId);
        }
        if (titleId) {
            whereClause += " AND e.title = '" + String(titleId).replace(/'/g, "''") + "'";
        }
        
        const sql = `
            SELECT DISTINCT
                e.id,
                e.entityid as name,
                e.laborcost,
                e.department,
                SUM(tb.hours) as totalHours
            FROM timebill tb
            INNER JOIN employee e ON tb.employee = e.id
            ${whereClause}
            GROUP BY e.id, e.entityid, e.laborcost, e.department
            ORDER BY e.laborcost
        `;
        
        try {
            const employees = Shared.runSuiteQL(sql) || [];
            
            if (employees.length === 0) {
                return { rate: 0, employeeCount: 0, error: 'No employees found for this service item' };
            }
            
            const rates = employees.map(e => parseFloat(e.laborcost) || 0).filter(r => r > 0);
            const hours = employees.map(e => parseFloat(e.totalhours) || 0);
            
            let rate = 0;
            if (aggregation === 'median') {
                rates.sort((a, b) => a - b);
                const mid = Math.floor(rates.length / 2);
                rate = rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
            } else if (aggregation === 'weighted' && hours.reduce((a,b) => a+b, 0) > 0) {
                // Weighted average by hours
                let totalWeighted = 0;
                let totalHrs = 0;
                employees.forEach((e, i) => {
                    const r = parseFloat(e.laborcost) || 0;
                    const h = parseFloat(e.totalhours) || 0;
                    if (r > 0) {
                        totalWeighted += r * h;
                        totalHrs += h;
                    }
                });
                rate = totalHrs > 0 ? totalWeighted / totalHrs : 0;
            } else {
                rate = rates.reduce((a, b) => a + b, 0) / rates.length;
            }
            
            return {
                rate: rate,
                employeeCount: employees.length,
                min: Math.min(...rates),
                max: Math.max(...rates),
                aggregation: aggregation,
                totalHours: hours.reduce((a, b) => a + b, 0)
            };
        } catch (e) {
            return { rate: 0, employeeCount: 0, error: e.message };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PROFILE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    function setActiveProfile(data) {
        const { profileId } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        config.activeProfileId = profileId;
        ConfigLib.save(config, 'burden');
        return { success: true, activeProfileId: profileId };
    }

    function saveProfile(data) {
        const { profile } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        
        if (!config.profiles) {
            config.profiles = [];
        }
        
        const existingIndex = config.profiles.findIndex(p => p.id === profile.id);
        if (existingIndex >= 0) {
            config.profiles[existingIndex] = profile;
        } else {
            config.profiles.push(profile);
        }
        
        ConfigLib.save(config, 'burden');
        return { success: true, profile };
    }

    function deleteProfile(data) {
        const { profileId } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        
        if (!config.profiles || config.profiles.length <= 1) {
            return { success: false, error: 'Cannot delete the only profile' };
        }
        
        config.profiles = config.profiles.filter(p => p.id !== profileId);
        
        if (config.activeProfileId === profileId) {
            config.activeProfileId = config.profiles[0]?.id;
        }
        
        ConfigLib.save(config, 'burden');
        return { success: true };
    }

    function duplicateProfile(data) {
        const { sourceProfileId, newName, newId } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profiles = config.profiles || [];
        
        const source = profiles.find(p => p.id === sourceProfileId);
        if (!source) {
            return { success: false, error: 'Source profile not found' };
        }
        
        const newProfile = JSON.parse(JSON.stringify(source));
        newProfile.id = newId || 'profile_' + Date.now();
        newProfile.name = newName || source.name + ' (Copy)';
        newProfile.isDefault = false;
        
        if (!config.profiles) {
            config.profiles = [];
        }
        config.profiles.push(newProfile);
        
        ConfigLib.save(config, 'burden');
        return { success: true, profile: newProfile };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTO-ASSIGNMENT & BULK OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function autoAssignAll(data) {
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const categories = profile.categories || [];
        const allAccounts = loadAllExpenseAccounts();
        const classified = classifyAccounts(allAccounts, profile, categories);
        
        let assignedCount = 0;
        const mappings = profile.accountMappings || {};
        
        // Go through unassigned accounts and try to match patterns
        classified.unassigned.forEach(account => {
            const accountName = (account.name || '').toLowerCase();
            
            for (const category of categories) {
                const patterns = category.patterns || [];
                for (const pattern of patterns) {
                    if (accountName.indexOf(pattern.toLowerCase()) >= 0) {
                        mappings[String(account.id)] = { category: category.id, status: 'auto' };
                        assignedCount++;
                        break;
                    }
                }
                if (mappings[String(account.id)]) break;
            }
        });
        
        profile.accountMappings = mappings;
        ConfigLib.save(config, 'burden');
        
        return { success: true, assigned: assignedCount };
    }

    function excludeRemaining(data) {
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const categories = profile.categories || [];
        const allAccounts = loadAllExpenseAccounts();
        const classified = classifyAccounts(allAccounts, profile, categories);
        
        let excludedIds = profile.excludedAccounts || [];
        let excludedCount = 0;
        
        classified.unassigned.forEach(account => {
            const acctIdStr = String(account.id);
            if (!excludedIds.includes(acctIdStr)) {
                excludedIds.push(acctIdStr);
                excludedCount++;
            }
        });
        
        profile.excludedAccounts = excludedIds;
        ConfigLib.save(config, 'burden');
        
        return { success: true, excluded: excludedCount };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // IMPORT & MIGRATION
    // ═══════════════════════════════════════════════════════════════════════════

    function importConfig(data) {
        const { config: importedConfig } = data;
        const currentConfig = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(currentConfig);
        
        // Merge categories into active profile
        if (importedConfig.categories) {
            profile.categories = importedConfig.categories;
        }
        
        // Merge account mappings into active profile
        if (importedConfig.accountMappings) {
            profile.accountMappings = { ...profile.accountMappings, ...importedConfig.accountMappings };
        }
        
        // Merge other top-level settings (not profile-specific)
        if (importedConfig.config) {
            Object.keys(importedConfig.config).forEach(key => {
                if (key !== 'categories' && key !== 'accountMappings' && key !== 'excludedAccounts') {
                    currentConfig[key] = importedConfig.config[key];
                }
            });
        }
        
        ConfigLib.save(currentConfig, 'burden');
        return { success: true };
    }

    function previewMigration(data) {
        const { fieldId } = data;
        
        // Query accounts with the custom field value
        // Use BUILTIN.DF(id) instead of acctname which is NOT_EXPOSED in SuiteQL
        const sql = `
            SELECT 
                id,
                BUILTIN.DF(id) as name,
                acctnumber as number,
                ${fieldId} as category_value
            FROM account
            WHERE ${fieldId} IS NOT NULL
                AND accttype = 'Expense'
        `;
        
        try {
            const results = Shared.runSuiteQL(sql);
            const categories = [...new Set(results.map(r => r.category_value).filter(Boolean))];
            
            return {
                accounts: results,
                categories: categories,
                count: results.length
            };
        } catch (e) {
            return { error: 'Field not found or invalid: ' + fieldId };
        }
    }

    function executeMigration(data) {
        const { fieldId } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const mappings = profile.accountMappings || {};
        
        const preview = previewMigration(data);
        if (preview.error) {
            return preview;
        }
        
        let migratedCount = 0;
        preview.accounts.forEach(account => {
            if (account.category_value) {
                // Map the custom field value to a category ID with proper structure
                mappings[String(account.id)] = {
                    category: account.category_value,
                    status: 'migrated'
                };
                migratedCount++;
            }
        });
        
        profile.accountMappings = mappings;
        ConfigLib.save(config, 'burden');
        
        return { success: true, migrated: migratedCount };
    }

    function importCSV(data) {
        const { csv } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const mappings = profile.accountMappings || {};
        
        // Parse CSV
        const lines = csv.split('\n').filter(l => l.trim());
        if (lines.length <= 1) {
            return { error: 'CSV file is empty' };
        }
        
        // Skip header row
        let importedCount = 0;
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',').map(p => p.trim().replace(/"/g, ''));
            if (parts.length >= 2) {
                const accountNumber = parts[0];
                const categoryId = parts[1];
                
                // Look up account by number
                const accounts = Shared.runSuiteQL(`
                    SELECT id FROM account WHERE acctnumber = '${accountNumber}'
                `);
                
                if (accounts.length > 0) {
                    mappings[String(accounts[0].id)] = {
                        category: categoryId,
                        status: 'imported'
                    };
                    importedCount++;
                }
            }
        }
        
        profile.accountMappings = mappings;
        ConfigLib.save(config, 'burden');
        
        return { success: true, imported: importedCount };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DRILLDOWN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getCategoryDrilldown(data) {
        const { categoryId, startDate, endDate, page = 1, pageSize = DEFAULT_PAGE_SIZE, sortBy = 'amount', sortDir = 'desc' } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const categories = profile.categories || [];
        const category = categories.find(c => c.id === categoryId);

        if (!category) {
            return { error: 'Category not found: ' + categoryId };
        }

        const allAccounts = loadAllExpenseAccounts();
        const classified = classifyAccounts(allAccounts, profile, categories);
        const catIdStr = String(categoryId);
        const categoryAccounts = classified.byCategory[catIdStr] || [];

        const financials = fetchFinancialsDetailed(startDate, endDate);
        const hiddenDepts = config.burdenHiddenDepts || [];
        const allDepts = getAllDepartments();
        const activeDepts = allDepts.filter(d => !hiddenDepts.includes(String(d.id)));
        const allocationBases = fetchAllAllocationBases(startDate, endDate, activeDepts, config);

        // Build account data with amounts
        let accountData = categoryAccounts.map(acct => {
            let total = 0;
            const byDept = {};

            financials.forEach(f => {
                if (f.account == acct.id) {
                    total += parseFloat(f.amount) || 0;
                    byDept[f.department] = (byDept[f.department] || 0) + parseFloat(f.amount) || 0;
                }
            });

            const base = getAllocationBaseValue(category.allocationBase || 'billed_hours', allocationBases, 'Overall');
            const rate = Shared.safeDiv(total, base);

            return {
                id: acct.id,
                number: acct.number,
                name: acct.name,
                amount: total,
                rate: rate,
                byDept: byDept,
                mappingSource: acct.mappingSource,
                matchedPattern: acct.matchedPattern
            };
        });

        // Sort
        accountData.sort((a, b) => {
            const aVal = a[sortBy] || 0;
            const bVal = b[sortBy] || 0;
            return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
        });

        // Paginate
        const totalCount = accountData.length;
        const startIdx = (page - 1) * pageSize;
        const paginatedData = accountData.slice(startIdx, startIdx + pageSize);

        // Category totals
        const categoryTotal = accountData.reduce((sum, a) => sum + a.amount, 0);
        const categoryBase = getAllocationBaseValue(category.allocationBase || 'billed_hours', allocationBases, 'Overall');
        const categoryRate = Shared.safeDiv(categoryTotal, categoryBase);

        return {
            category: {
                id: category.id,
                label: category.label,
                color: category.color,
                allocationBase: category.allocationBase,
                scope: category.scope
            },
            accounts: paginatedData,
            pagination: {
                page,
                pageSize,
                totalCount,
                totalPages: Math.ceil(totalCount / pageSize)
            },
            totals: {
                amount: categoryTotal,
                rate: categoryRate,
                accountCount: totalCount
            }
        };
    }

    function getAccountTransactions(data) {
        const { accountId, startDate, endDate, page = 1, pageSize = DEFAULT_PAGE_SIZE } = data;

        const sql = `
            SELECT 
                t.id,
                t.tranid,
                t.trandate,
                t.type,
                BUILTIN.DF(t.type) as type_name,
                tl.department,
                BUILTIN.DF(tl.department) as dept_name,
                tal.amount,
                t.memo,
                BUILTIN.DF(t.entity) as entity_name
            FROM transaction t
            JOIN transactionaccountingline tal ON t.id = tal.transaction
            JOIN transactionline tl ON tal.transaction = tl.transaction AND tal.transactionline = tl.id
            WHERE t.posting = 'T'
              AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
              AND tal.account = ${accountId}
            ORDER BY t.trandate DESC
        `;

        const transactions = Shared.runSuiteQL(sql);
        const totalCount = transactions.length;

        // Paginate
        const startIdx = (page - 1) * pageSize;
        const paginatedData = transactions.slice(startIdx, Math.min(startIdx + pageSize, MAX_TRANSACTIONS));

        // Calculate totals
        const totalAmount = transactions.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

        return {
            accountId,
            transactions: paginatedData,
            pagination: {
                page,
                pageSize,
                totalCount: Math.min(totalCount, MAX_TRANSACTIONS),
                totalPages: Math.ceil(Math.min(totalCount, MAX_TRANSACTIONS) / pageSize)
            },
            totals: {
                amount: totalAmount,
                count: totalCount
            }
        };
    }

    function getCellDrilldown(data) {
        const { categoryId, departmentId, startDate, endDate } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const categories = profile.categories || [];
        const category = categories.find(c => c.id === categoryId);

        if (!category) {
            return { error: 'Category not found: ' + categoryId, accounts: [], items: [] };
        }

        const hiddenDepts = config.burdenHiddenDepts || [];
        const allDepts = getAllDepartments();
        const activeDepts = allDepts.filter(d => !hiddenDepts.includes(String(d.id)));
        const catType = category.categoryType || 'expense';
        
        // Get hours for rate calculations
        const allocationBases = fetchAllAllocationBases(
            startDate,
            endDate,
            activeDepts,
            config
        );
        
        let deptHours = 0;
        if (departmentId && departmentId !== 'Overall') {
            const byDept = allocationBases.hours?.byDept || {};
            const deptData = byDept[departmentId] || byDept[String(departmentId)] || {};
            deptHours = typeof deptData === 'object' ? (deptData.billed || deptData.total || 0) : deptData;
        } else {
            deptHours = allocationBases.hours?.totalBilled || 0;
        }

        // Handle based on category type
        if (catType === 'timebill') {
            return getTimebillCellDrilldown(category, departmentId, startDate, endDate, deptHours, profile);
        } else if (catType === 'manual') {
            return getManualCellDrilldown(category, departmentId, deptHours, allocationBases);
        } else {
            // Expense-based category
            return getExpenseCellDrilldown(category, categoryId, departmentId, startDate, endDate, deptHours, profile, categories);
        }
    }

    function getTimebillCellDrilldown(category, departmentId, startDate, endDate, deptHours, profile) {
        // Build WHERE clause matching calculateTimeCategoryData logic
        const timeFilters = category.timeFilters || {};
        
        let whereClause = `WHERE t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')`;
        
        // Time status filter (same as main calc)
        // billableDefinition determines how we identify billable vs non-billable:
        //   - 'customer' (default): Billable = has customer, Non-Billable = no customer
        //   - 'flag': Billable = isbillable='T', Non-Billable = isbillable='F'
        const billableDefinition = timeFilters.billableDefinition || 'customer';
        const statusConditions = [];
        if (timeFilters.includeBillable !== false) {
            if (billableDefinition === 'flag') {
                statusConditions.push("(t.isbillable = 'T')");
            } else {
                statusConditions.push("(t.customer IS NOT NULL)");
            }
        }
        if (timeFilters.includeNonBillable) {
            if (billableDefinition === 'flag') {
                statusConditions.push("(t.isbillable = 'F')");
            } else {
                statusConditions.push("(t.customer IS NULL)");
            }
        }
        if (statusConditions.length > 0) {
            whereClause += ` AND (${statusConditions.join(' OR ')})`;
        }

        // Department filter for drilldown
        if (departmentId && departmentId !== 'Overall') {
            whereClause += ` AND t.department = ${departmentId}`;
        }
        
        // Service item filter
        if (timeFilters.serviceItems && timeFilters.serviceItems.length > 0) {
            whereClause += ` AND t.item IN (${timeFilters.serviceItems.join(',')})`;
        }
        
        // Employee type exclusions
        const laborConfig = profile.laborConfig || {};
        const config = ConfigLib.getStoredConfiguration('burden');
        const categoryExclusions = (timeFilters.excludeEmpTypes || []).map(t => String(t));
        const globalExclusions = (config.globalExcludeEmpTypes || []).map(t => String(t));
        const combinedExclusions = [...new Set([...categoryExclusions, ...globalExclusions])];
        
        let empTypeJoin = '';
        if (combinedExclusions.length > 0) {
            empTypeJoin = `LEFT JOIN employee emp ON t.employee = emp.id`;
            whereClause += ` AND (emp.employeetype IS NULL OR emp.employeetype NOT IN (${combinedExclusions.join(',')}))`;
        }
        
        // Cost calculation (same as main calc)
        let costExpr = 't.hours * COALESCE(e.laborcost, 0)';
        if (timeFilters.costMethod === 'custom_rate') {
            costExpr = `t.hours * ${parseFloat(timeFilters.customRate) || 50}`;
        } else if (timeFilters.costMethod === 'service_rate') {
            costExpr = 't.hours * COALESCE(i.cost, i.rate, e.laborcost, 0)';
        }

        // Query timebill data grouped by employee
        const sql = `
            SELECT 
                t.employee as id,
                e.entityid as number,
                BUILTIN.DF(t.employee) as name,
                'Employee' as type,
                SUM(t.hours) as hours,
                SUM(${costExpr}) as amount
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            LEFT JOIN item i ON t.item = i.id
            ${empTypeJoin}
            ${whereClause}
            GROUP BY t.employee, e.entityid, BUILTIN.DF(t.employee)
            ORDER BY SUM(t.hours) DESC
        `;

        let items = [];
        try {
            const results = Shared.runSuiteQL(sql);
            items = (results || []).map(r => ({
                id: r.id,
                number: r.number || 'Unknown',
                name: r.name || 'Unknown Employee',
                type: 'Employee',
                hours: parseFloat(r.hours) || 0,
                amount: parseFloat(r.amount) || 0
            }));
        } catch (e) {
            log.error({ title: 'getTimebillCellDrilldown Error', details: e.message });
        }

        const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);
        const totalHours = items.reduce((sum, i) => sum + i.hours, 0);

        // Add rate to each item
        items = items.map(i => ({
            ...i,
            rate: deptHours > 0 ? i.amount / deptHours : 0
        }));

        return {
            category: { id: category.id, label: category.label },
            categoryType: 'timebill',
            departmentId,
            items,
            accounts: items, // Alias for frontend compatibility
            totals: {
                amount: totalAmount,
                hours: totalHours,
                count: items.length
            }
        };
    }

    function getManualCellDrilldown(category, departmentId, deptHours, allocationBases) {
        const manualConfig = category.manualConfig || {};
        let totalAmount = 0;
        let breakdown = [];

        if (manualConfig.mode === 'fixed_total') {
            totalAmount = parseFloat(manualConfig.fixedTotal) || 0;
            breakdown = [{
                id: 'fixed',
                number: 'MANUAL',
                name: 'Fixed Amount',
                type: 'Manual',
                amount: totalAmount,
                rate: deptHours > 0 ? totalAmount / deptHours : 0
            }];
        } else {
            // Per-unit calculation
            const perUnit = parseFloat(manualConfig.perUnit) || 0;
            const headcount = allocationBases.headcount?.total || 0;
            totalAmount = perUnit * headcount;
            breakdown = [{
                id: 'per_unit',
                number: 'MANUAL',
                name: `${headcount} units × $${perUnit.toFixed(2)}`,
                type: 'Manual',
                amount: totalAmount,
                rate: deptHours > 0 ? totalAmount / deptHours : 0
            }];
        }

        return {
            category: { id: category.id, label: category.label },
            categoryType: 'manual',
            departmentId,
            accounts: breakdown,
            totals: {
                amount: totalAmount,
                count: 1,
                hours: deptHours
            }
        };
    }

    function getExpenseCellDrilldown(category, categoryId, departmentId, startDate, endDate, deptHours, profile, categories) {
        const allAccounts = loadAllExpenseAccounts();
        const classified = classifyAccounts(allAccounts, profile, categories);
        const catIdStr = String(categoryId);
        const categoryAccounts = classified.byCategory[catIdStr] || [];
        const accountIds = categoryAccounts.map(a => a.id);

        if (accountIds.length === 0) {
            return { 
                category: { id: category.id, label: category.label },
                categoryType: 'expense',
                accounts: [], 
                totals: { amount: 0, count: 0, hours: deptHours } 
            };
        }

        // Build department clause
        let deptClause = '';
        if (departmentId && departmentId !== 'Overall') {
            deptClause = `AND tl.department = ${departmentId}`;
        }

        // Query to get aggregated amounts by account
        const sql = `
            SELECT 
                a.id,
                a.acctnumber as number,
                a.fullname as name,
                a.accttype as type,
                SUM(tal.amount) as amount
            FROM transaction t
            JOIN transactionaccountingline tal ON t.id = tal.transaction
            JOIN transactionline tl ON tal.transaction = tl.transaction AND tal.transactionline = tl.id
            JOIN account a ON tal.account = a.id
            WHERE t.posting = 'T'
              AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
              AND tal.account IN (${accountIds.join(',')})
              ${deptClause}
            GROUP BY a.id, a.acctnumber, a.fullname, a.accttype
            ORDER BY SUM(tal.amount) DESC
        `;

        let accounts = [];
        try {
            const results = Shared.runSuiteQL(sql);
            accounts = (results || []).map(r => ({
                id: r.id,
                number: r.number,
                name: r.name,
                type: r.type,
                amount: parseFloat(r.amount) || 0
            }));
        } catch (e) {
            log.error({ title: 'getExpenseCellDrilldown Error', details: e.message });
        }

        // Calculate total
        const totalAmount = accounts.reduce((sum, a) => sum + a.amount, 0);

        // Add rate to each account
        accounts = accounts.map(a => ({
            ...a,
            rate: deptHours > 0 ? a.amount / deptHours : 0
        }));

        return {
            category: { id: category.id, label: category.label },
            categoryType: 'expense',
            departmentId,
            accounts,
            totals: {
                amount: totalAmount,
                count: accounts.length,
                hours: deptHours
            }
        };
    }

    function searchAccounts(data) {
        const { query, excludeAssigned = false, page = 1, pageSize = DEFAULT_PAGE_SIZE } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const categories = profile.categories || [];

        let allAccounts = loadAllExpenseAccounts();
        const classified = classifyAccounts(allAccounts, profile, categories);

        // Filter by search query
        if (query) {
            const lowerQuery = query.toLowerCase();
            allAccounts = allAccounts.filter(a =>
                (a.number || '').toLowerCase().includes(lowerQuery) ||
                (a.name || '').toLowerCase().includes(lowerQuery)
            );
        }

        // Optionally exclude assigned accounts
        if (excludeAssigned) {
            const assignedIds = new Set();
            Object.values(classified.byCategory).forEach(accounts => {
                accounts.forEach(a => assignedIds.add(String(a.id)));
            });
            allAccounts = allAccounts.filter(a => !assignedIds.has(String(a.id)));
        }

        // Paginate
        const totalCount = allAccounts.length;
        const startIdx = (page - 1) * pageSize;
        const paginatedData = allAccounts.slice(startIdx, startIdx + pageSize);

        return {
            accounts: paginatedData,
            pagination: {
                page,
                pageSize,
                totalCount,
                totalPages: Math.ceil(totalCount / pageSize)
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLASSIFICATION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    function saveAccountClassification(data) {
        const { accountMappings, excludedAccounts } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);

        if (accountMappings) {
            profile.accountMappings = { ...profile.accountMappings, ...accountMappings };
        }
        if (excludedAccounts) {
            profile.excludedAccounts = excludedAccounts;
        }

        return ConfigLib.save(config, 'burden');
    }

    function saveCategory(data) {
        // FIRST: Log everything we received
        auditLog('SAVE_CAT_RECEIVED', 'Full data keys: ' + Object.keys(data).join(', '));
        auditLog('SAVE_CAT_RECEIVED', 'data.category exists: ' + (data.category !== undefined));
        
        const { category } = data;
        
        if (!category) {
            auditLog('SAVE_CAT_ERROR', 'NO CATEGORY IN DATA! Full data: ' + JSON.stringify(data).substring(0, 500));
            return { error: 'No category provided' };
        }
        
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        
        // Use AUDIT level so it shows in NetSuite Execution Log regardless of filter settings
        auditLog('SAVE_CAT_START', 'Profile: ' + profile.id + ', Category ID: ' + category.id + ', has accountIds: ' + (Array.isArray(category.accountIds)) + ', accountIds count: ' + (category.accountIds ? category.accountIds.length : 'N/A'));
        
        // Log what we loaded from profile
        auditLog('SAVE_CAT_CONFIG', 'Loaded profile. accountMappings count: ' + Object.keys(profile.accountMappings || {}).length);
        
        const categories = profile.categories || [];

        // Use string comparison to avoid type mismatch issues
        const categoryIdStr = String(category.id);
        const existingIdx = categories.findIndex(c => String(c.id) === categoryIdStr);
        
        // Ensure categoryType defaults to 'expense' if not set
        if (!category.categoryType) {
            category.categoryType = 'expense';
        }
        
        if (existingIdx >= 0) {
            // Preserve existing order if not specified
            if (category.order === undefined && categories[existingIdx].order !== undefined) {
                category.order = categories[existingIdx].order;
            }
            categories[existingIdx] = { ...categories[existingIdx], ...category };
            auditLog('SAVE_CAT_UPDATE', 'Updated category at index ' + existingIdx);
        } else {
            // New category - assign order at the end
            const maxOrder = categories.reduce((max, c) => Math.max(max, c.order || 0), -1);
            category.order = maxOrder + 1;
            categories.push(category);
            auditLog('SAVE_CAT_ADD', 'Added new category with order ' + category.order);
        }

        // Handle account assignments - ALWAYS process if accountIds array exists
        if (category.accountIds !== undefined && Array.isArray(category.accountIds)) {
            if (!profile.accountMappings) profile.accountMappings = {};
            
            auditLog('SAVE_CAT_ACCOUNTS', 'Processing ' + category.accountIds.length + ' accounts');
            if (category.accountIds.length > 0) {
                auditLog('SAVE_CAT_ACCOUNTS', 'First 5 IDs: ' + category.accountIds.slice(0, 5).join(', '));
            }
            
            // Build set of new account IDs for quick lookup
            const newAccountSet = {};
            category.accountIds.forEach(id => { newAccountSet[String(id)] = true; });
            
            // Find accounts that were previously mapped to this category
            const previouslyMapped = Object.keys(profile.accountMappings).filter(acctId => 
                String(profile.accountMappings[acctId].category) === categoryIdStr
            );
            auditLog('SAVE_CAT_EXISTING', 'Existing mappings before update: ' + previouslyMapped.length);
            
            // For accounts that were mapped but are NOT in new list, mark as REJECTED
            // This prevents pattern matching from re-adding them
            let rejectedCount = 0;
            previouslyMapped.forEach(acctId => {
                if (!newAccountSet[acctId]) {
                    // Account was unchecked - mark as rejected from this category
                    profile.accountMappings[acctId] = {
                        category: category.id,
                        status: 'rejected'  // This tells classifyAccounts to skip it
                    };
                    rejectedCount++;
                }
            });
            if (rejectedCount > 0) {
                auditLog('SAVE_CAT_REJECTED', 'Marked ' + rejectedCount + ' accounts as rejected from ' + categoryIdStr);
            }
            
            // Add/update mappings for all selected accounts (using string keys)
            category.accountIds.forEach(acctId => {
                profile.accountMappings[String(acctId)] = {
                    category: category.id,
                    status: 'confirmed'
                };
            });
            
            auditLog('SAVE_CAT_MAPPINGS', 'New total mappings: ' + Object.keys(profile.accountMappings).length);
        } else {
            auditLog('SAVE_CAT_NO_ACCTS', 'accountIds missing. Type: ' + typeof category.accountIds);
        }

        profile.categories = categories;
        
        // Debug: log what we're about to save
        auditLog('SAVE_CAT_PRESAVE', 'About to save. Categories: ' + profile.categories.length + ', Mappings: ' + Object.keys(profile.accountMappings || {}).length);
        
        try {
            const saveResult = ConfigLib.save(config, 'burden');
            auditLog('SAVE_CAT_DONE', 'Save completed. Result type: ' + typeof saveResult);
            return saveResult;
        } catch (e) {
            log.error('SAVE_CAT_ERROR', 'ConfigLib.save failed: ' + e.message);
            throw e;
        }
    }

    function deleteCategory(data) {
        const { categoryId } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const categories = profile.categories || [];

        profile.categories = categories.filter(c => c.id !== categoryId);

        // Also remove any account mappings to this category
        if (profile.accountMappings) {
            Object.keys(profile.accountMappings).forEach(acctId => {
                if (String(profile.accountMappings[acctId].category) === String(categoryId)) {
                    delete profile.accountMappings[acctId];
                }
            });
        }

        return ConfigLib.save(config, 'burden');
    }

    function saveCategoryOrder(data) {
        const { order } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const categories = profile.categories || [];
        
        // Create map of existing categories
        const catMap = {};
        categories.forEach(c => { catMap[c.id] = c; });
        
        // Reorder based on provided order array and assign order index
        const reordered = order.map((id, idx) => {
            const cat = catMap[id];
            if (cat) {
                cat.order = idx; // Assign order property for consistent sorting
            }
            return cat;
        }).filter(Boolean);
        
        // Add any categories not in the order array at the end
        let nextOrder = reordered.length;
        categories.forEach(c => {
            if (!order.includes(c.id)) {
                c.order = nextOrder++;
                reordered.push(c);
            }
        });
        
        profile.categories = reordered;
        return ConfigLib.save(config, 'burden');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SCENARIO MODELING
    // ═══════════════════════════════════════════════════════════════════════════

    function calculateScenario(data) {
        const { scenarioType, startDate, endDate, employeeCount, avgSalary, departmentId, expectedUtilization, 
                annualHours, annualRevenue, categoryId, changeType, amount, newUtilization } = data;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // SINGLE SOURCE OF TRUTH: Use same calculation as main dashboard
        // ═══════════════════════════════════════════════════════════════════════════
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const categories = profile.categories || [];
        const hiddenDepts = config.burdenHiddenDepts || [];
        const allDepts = getAllDepartments();
        const activeDepts = allDepts.filter(d => !hiddenDepts.includes(String(d.id)));
        
        // Load same data as main dashboard
        const allAccounts = loadAllExpenseAccounts();
        const classified = classifyAccounts(allAccounts, profile, categories);
        const financials = fetchFinancialsDetailed(startDate, endDate);
        const processedFinancials = processFinancials(financials, activeDepts, allAccounts);
        const allocationBases = fetchAllAllocationBases(startDate, endDate, activeDepts, config);
        
        // Use EXACT SAME calculation as main dashboard
        const summary = buildSummaryMultiBase(
            processedFinancials, 
            allocationBases, 
            activeDepts, 
            {}, // unbilled hours data not needed for scenario
            config, 
            classified, 
            categories, 
            startDate, 
            endDate
        );
        
        // Get current values from summary (same as what dashboard displays)
        const currentExpense = summary.totalExpense || 0;
        const currentHours = allocationBases.hours?.totalBilled || 1;
        const currentRate = summary.compositeRate || 0;
        const currentUtilization = allocationBases.hours?.totalBilled > 0 && allocationBases.hours?.total > 0
            ? allocationBases.hours.totalBilled / allocationBases.hours.total
            : 0.75;

        let impact = {
            currentRate,
            currentExpense,
            currentHours,
            projectedRate: 0,
            change: 0,
            changePercent: 0,
            insight: '',
            breakdown: {}
        };

        switch (scenarioType) {
            case 'hire': {
                const count = employeeCount || 1;
                const utilization = expectedUtilization || 0.75;
                const salary = avgSalary || 75000;

                const newHours = count * utilization * 2080 / 12;
                const projectedHours = currentHours + newHours;
                const fringeCost = count * salary * 0.25 / 12;
                const projectedExpense = currentExpense + fringeCost;

                impact.projectedRate = Shared.safeDiv(projectedExpense, projectedHours);
                impact.change = impact.projectedRate - currentRate;
                impact.changePercent = Shared.safeDiv(impact.change, currentRate) * 100;
                impact.insight = `Adding ${count} employee(s) at ${(utilization * 100).toFixed(0)}% utilization adds ${Shared.round2(newHours)} monthly billable hours.`;
                impact.breakdown = { 
                    hoursChange: newHours, 
                    expenseChange: fringeCost,
                    projectedHours, 
                    projectedExpense 
                };
                break;
            }

            case 'terminate':
            case 'reduce_staff': {
                const count = employeeCount || 1;
                const utilization = expectedUtilization || 0.75;
                const salary = avgSalary || 75000;

                const lostHours = count * utilization * 2080 / 12;
                const projectedHours = Math.max(currentHours - lostHours, 1);
                const savingsFringe = count * salary * 0.25 / 12;
                const projectedExpense = currentExpense - savingsFringe;

                impact.projectedRate = Shared.safeDiv(projectedExpense, projectedHours);
                impact.change = impact.projectedRate - currentRate;
                impact.changePercent = Shared.safeDiv(impact.change, currentRate) * 100;
                impact.insight = `Reducing ${count} employee(s) saves $${Shared.round2(savingsFringe)} in overhead but loses ${Shared.round2(lostHours)} billable hours.`;
                impact.breakdown = { 
                    hoursChange: -lostHours, 
                    expenseChange: -savingsFringe,
                    projectedHours, 
                    projectedExpense 
                };
                break;
            }

            case 'win_contract': {
                const contractHours = (annualHours || 0) / 12;
                const projectedHours = currentHours + contractHours;

                impact.projectedRate = Shared.safeDiv(currentExpense, projectedHours);
                impact.change = impact.projectedRate - currentRate;
                impact.changePercent = Shared.safeDiv(impact.change, currentRate) * 100;
                impact.insight = `Winning contract adds ${Shared.round2(contractHours)} monthly hours, spreading overhead across more volume.`;
                impact.breakdown = { 
                    hoursChange: contractHours, 
                    projectedHours 
                };
                break;
            }

            case 'lose_contract': {
                const lostHours = (annualHours || 0) / 12;
                const projectedHours = Math.max(currentHours - lostHours, 1);

                impact.projectedRate = Shared.safeDiv(currentExpense, projectedHours);
                impact.change = impact.projectedRate - currentRate;
                impact.changePercent = Shared.safeDiv(impact.change, currentRate) * 100;
                impact.insight = `Losing contract removes ${Shared.round2(lostHours)} monthly hours, concentrating overhead on fewer hours.`;
                impact.breakdown = { 
                    hoursChange: -lostHours, 
                    projectedHours 
                };
                break;
            }

            case 'cost_change': {
                const delta = changeType === 'decrease' ? -(amount || 0) : (amount || 0);
                const projectedExpense = currentExpense + delta;

                impact.projectedRate = Shared.safeDiv(projectedExpense, currentHours);
                impact.change = impact.projectedRate - currentRate;
                impact.changePercent = Shared.safeDiv(impact.change, currentRate) * 100;
                impact.insight = `${changeType === 'decrease' ? 'Reducing' : 'Adding'} $${Shared.round2(Math.abs(delta))} in overhead costs.`;
                impact.breakdown = { 
                    expenseChange: delta, 
                    projectedExpense 
                };
                break;
            }

            case 'utilization_change': {
                const newUtil = (newUtilization || 0.80);
                const totalHrs = currentUtilization > 0 ? currentHours / currentUtilization : currentHours;
                const newBilledHrs = totalHrs * newUtil;

                impact.projectedRate = Shared.safeDiv(currentExpense, newBilledHrs);
                impact.change = impact.projectedRate - currentRate;
                impact.changePercent = Shared.safeDiv(impact.change, currentRate) * 100;
                impact.insight = `Changing utilization from ${(currentUtilization * 100).toFixed(0)}% to ${(newUtil * 100).toFixed(0)}% ${newUtil > currentUtilization ? 'increases' : 'decreases'} billable hours.`;
                impact.breakdown = { 
                    currentUtilization: currentUtilization * 100,
                    newUtilization: newUtil * 100,
                    hoursChange: newBilledHrs - currentHours,
                    totalHrs, 
                    newBilledHrs 
                };
                break;
            }
        }

        // Calculate breakeven
        impact.breakeven = {
            hoursNeeded: currentExpense > 0 ? Shared.safeDiv(currentExpense, currentRate) : 0,
            atCurrentHours: currentHours
        };

        return impact;
    }

    function saveScenario(data) {
        const { scenario } = data;
        const config = ConfigLib.getStoredConfiguration('burden');

        if (!config.savedScenarios) {
            config.savedScenarios = [];
        }

        // Generate ID if new
        if (!scenario.id) {
            scenario.id = 'scenario_' + Date.now();
            scenario.createdAt = new Date().toISOString();
        }
        scenario.updatedAt = new Date().toISOString();

        const existingIdx = config.savedScenarios.findIndex(s => s.id === scenario.id);
        if (existingIdx >= 0) {
            config.savedScenarios[existingIdx] = scenario;
        } else {
            config.savedScenarios.push(scenario);
        }

        ConfigLib.save(config, 'burden');
        return { success: true, scenario };
    }

    function deleteScenario(data) {
        const { scenarioId } = data;
        const config = ConfigLib.getStoredConfiguration('burden');

        if (config.savedScenarios) {
            config.savedScenarios = config.savedScenarios.filter(s => s.id !== scenarioId);
            ConfigLib.save(config, 'burden');
        }

        return { success: true };
    }

    function listScenarios(data) {
        const config = ConfigLib.getStoredConfiguration('burden');
        return { scenarios: config.savedScenarios || [] };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SELLING RATE CALCULATOR
    // ═══════════════════════════════════════════════════════════════════════════

    function calculateSellingRate(data) {
        const { baseLaborRate, burdenRate, otherDirectCosts, marginType, marginValue } = data;

        const base = parseFloat(baseLaborRate) || 0;
        const burden = parseFloat(burdenRate) || 0;
        const odc = parseFloat(otherDirectCosts) || 0;
        const margin = parseFloat(marginValue) || 0;

        const totalCost = base + burden + odc;

        let sellingRate;
        if (marginType === 'markup') {
            sellingRate = totalCost * (1 + margin / 100);
        } else {
            sellingRate = totalCost / (1 - margin / 100);
        }

        const profit = sellingRate - totalCost;

        // Sensitivity table: what selling rate at different margins
        const sensitivityMargins = [10, 15, 20, 25, 30, 35, 40, 45, 50];
        const sensitivity = sensitivityMargins.map(m => {
            let rate;
            if (marginType === 'markup') {
                rate = totalCost * (1 + m / 100);
            } else {
                rate = totalCost / (1 - m / 100);
            }
            return {
                margin: m,
                sellingRate: rate,
                profit: rate - totalCost
            };
        });

        return {
            breakdown: {
                baseLaborRate: base,
                burdenRate: burden,
                otherDirectCosts: odc,
                totalCost,
                margin: profit,
                sellingRate
            },
            analysis: {
                effectiveMargin: (profit / sellingRate) * 100,
                effectiveMarkup: (profit / totalCost) * 100,
                breakeven: totalCost,
                profitPerHour: profit
            },
            sensitivity
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT
    // ═══════════════════════════════════════════════════════════════════════════

    function exportRates(data) {
        const { startDate, endDate, format = 'json' } = data;
        const config = ConfigLib.getStoredConfiguration('burden');
        const profile = getActiveProfile(config);
        const categories = profile.categories || [];
        const activeDepts = getAllDepartments();
        const hiddenDepts = config.burdenHiddenDepts || [];
        const visibleDepts = activeDepts.filter(d => !hiddenDepts.includes(String(d.id)));

        const allocationBases = fetchAllAllocationBases(startDate, endDate, visibleDepts, config);
        const allAccounts = loadAllExpenseAccounts();
        const classified = classifyAccounts(allAccounts, profile, categories);
        const financials = fetchFinancialsDetailed(startDate, endDate);
        const processedFinancials = processFinancials(financials, visibleDepts, allAccounts);

        // Build export data
        const exportData = {
            meta: {
                startDate,
                endDate,
                exportedAt: new Date().toISOString()
            },
            departments: visibleDepts.map(d => ({ id: d.id, name: d.name })),
            categories: categories.map(c => ({ id: c.id, label: c.label, allocationBase: c.allocationBase })),
            rateMatrix: [],
            accountDetails: []
        };

        // Rate matrix rows
        visibleDepts.forEach(d => {
            const row = { department: d.name };
            categories.forEach(cat => {
                const catIdStr = String(cat.id);
                const catAccounts = classified.byCategory[catIdStr] || [];
                let deptExp = 0;
                catAccounts.forEach(acct => {
                    deptExp += processedFinancials.byAccount[acct.id]?.byDept[d.id] || 0;
                });
                const base = getAllocationBaseValue(cat.allocationBase || 'billed_hours', allocationBases, d.id);
                row[cat.label] = Shared.safeDiv(deptExp, base);
            });
            exportData.rateMatrix.push(row);
        });

        // Account details
        categories.forEach(cat => {
            const catIdStr = String(cat.id);
            const catAccounts = classified.byCategory[catIdStr] || [];
            catAccounts.forEach(acct => {
                const acctData = processedFinancials.byAccount[acct.id];
                if (acctData && acctData.total > 0) {
                    exportData.accountDetails.push({
                        category: cat.label,
                        accountNumber: acct.number,
                        accountName: acct.name,
                        amount: acctData.total
                    });
                }
            });
        });

        return exportData;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        getData,
        handleRequest,
        CATEGORY_TEMPLATES,
        ALLOCATION_BASES,
        ALLOCATION_METHODS,
        RATE_FORMATS,
        COMPOSITE_METHODS,
        // Export calculation functions for external use
        calculateRate,
        formatRate,
        calculateCompositeRate,
        getAllocationBaseValue,
        // Forecasting functions
        forecastRates,
        calculateTrend,
        calculateConfidence
    };
});