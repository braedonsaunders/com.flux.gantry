/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module Lib_Config
 * @description Configuration management library - supports multiple named configurations
 *              (cashflow, burden, health, time) stored in custom records.
 *              Automatically detects fiscal year from NetSuite accounting periods.
 */
define(["N/record", "N/search", "N/query", "N/log", "N/runtime", "./Lib_Dashboard_Registry"], function (record, search, query, log, runtime, DashboardRegistry) {

    const CONFIG_RECORD_TYPE = 'customrecord_gantry_config';
    const CONFIG_JSON_FIELD = 'custrecord_gantry_config_json';

    // Cache for fiscal calendar (avoid repeated lookups)
    let _fiscalCalendarCache = null;
    
    // Cache for debug mode check
    let _debugModeCache = null;
    let _debugModeCacheTime = 0;
    const DEBUG_CACHE_TTL = 60000; // 1 minute
    
    /**
     * Check if debug mode is enabled (reads from main config)
     */
    function isDebugMode() {
        const now = Date.now();
        if (_debugModeCache === null || (now - _debugModeCacheTime) > DEBUG_CACHE_TTL) {
            try {
                const mainConfig = getStoredConfiguration('main');
                _debugModeCache = mainConfig && mainConfig.advisorDebugMode === true;
            } catch (e) {
                _debugModeCache = false;
            }
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

    /**
     * Tier 1 Enterprise Fiscal Calendar Detection
     * Queries the source-of-truth AccountingPeriod table to find the exact
     * fiscal year definition active for the current date.
     * 
     * Handles:
     * - Standard Calendar (Jan-Dec)
     * - Shifted Calendar (Jul-Jun, Apr-Mar, etc.)
     * - 4-4-5 / 4-5-4 Retail Calendars
     * - Short/Stub Years (fiscal year transitions)
     * - 53-week years
     * 
     * @returns {Object} Fiscal calendar with exact dates from database
     */
    function getFiscalCalendar() {
        if (_fiscalCalendarCache) {
            return _fiscalCalendarCache;
        }

        try {
            // PRIMARY STRATEGY: Find the Fiscal Year parent record active TODAY
            // This handles all calendar types because it reads exact dates from DB
            const activeYearSql = `
                SELECT 
                    periodname, 
                    startdate, 
                    enddate 
                FROM accountingperiod 
                WHERE isyear = 'T' 
                  AND isinactive = 'F'
                  AND startdate <= CURRENT_DATE 
                  AND enddate >= CURRENT_DATE
            `;
            
            let results = query.runSuiteQL({ query: activeYearSql }).asMappedResults();
            
            // FALLBACK STRATEGY 1: "Latest Started Year"
            // If today is in a gap (e.g., year closed but next not opened), find the 
            // most recent fiscal year that has started.
            if (!results || results.length === 0) {
                const latestYearSql = `
                    SELECT periodname, startdate, enddate 
                    FROM accountingperiod 
                    WHERE isyear = 'T' 
                      AND isinactive = 'F' 
                      AND startdate <= CURRENT_DATE 
                    ORDER BY startdate DESC 
                    FETCH FIRST 1 ROWS ONLY
                `;
                results = query.runSuiteQL({ query: latestYearSql }).asMappedResults();
                if (results.length > 0) {
                    auditLog('Fiscal Context', 'Current date not in open FY, using latest started year: ' + results[0].periodname);
                }
            }

            // Find the latest closed period (for burden default end date)
            let latestClosedPeriod = null;
            try {
                const closedPeriodSql = `
                    SELECT 
                        periodname,
                        startdate,
                        enddate,
                        closed,
                        aplocked
                    FROM accountingperiod 
                    WHERE isyear = 'F'
                      AND isquarter = 'F'
                      AND isinactive = 'F'
                      AND (closed = 'T' OR aplocked = 'T')
                      AND enddate <= CURRENT_DATE
                    ORDER BY enddate DESC 
                    FETCH FIRST 1 ROWS ONLY
                `;
                const closedResults = query.runSuiteQL({ query: closedPeriodSql }).asMappedResults();
                if (closedResults && closedResults.length > 0) {
                    const cp = closedResults[0];
                    latestClosedPeriod = {
                        periodName: cp.periodname,
                        startDate: normalizeDateToYMD(cp.startdate),
                        endDate: normalizeDateToYMD(cp.enddate),
                        isClosed: cp.closed === 'T',
                        isLocked: cp.aplocked === 'T'
                    };
                    debugLog('Latest Closed Period', latestClosedPeriod);
                }
            } catch (closedErr) {
                log.error('Error finding latest closed period', closedErr.message);
            }

            if (results && results.length > 0) {
                const row = results[0];
                const startDate = new Date(row.startdate);
                const endDate = new Date(row.enddate);
                
                // Extract the raw integer year if possible (e.g. "FY 2024" -> 2024)
                // Fallback to calendar year of end date if name doesn't match
                const yearMatch = row.periodname.match(/(\d{4})/);
                const fiscalYearInt = yearMatch ? parseInt(yearMatch[1]) : endDate.getFullYear();

                _fiscalCalendarCache = {
                    // The Critical Data: Exact Dates from Database (normalized to YYYY-MM-DD)
                    fiscalYearStartDate: normalizeDateToYMD(row.startdate),
                    fiscalYearEndDate: normalizeDateToYMD(row.enddate),
                    
                    // Helper Metadata
                    currentFiscalYear: fiscalYearInt,
                    periodName: row.periodname,
                    
                    // Backwards Compatibility (for older logic relying on month index)
                    fiscalYearStartMonth: startDate.getMonth(),  // 0-11
                    fiscalYearStartDay: startDate.getDate(),     // 1-31
                    
                    // Latest closed period info for burden dashboard
                    latestClosedPeriod: latestClosedPeriod,
                    
                    detectedFrom: 'database_authority'
                };
                
                debugLog('Fiscal Calendar Detected', {
                    periodName: row.periodname,
                    startDate: row.startdate,
                    endDate: row.enddate,
                    fiscalYear: fiscalYearInt,
                    latestClosedPeriod: latestClosedPeriod
                });
                
                return _fiscalCalendarCache;
            }

        } catch (e) {
            log.error('CRITICAL: Fiscal Calendar Detection Failed', e.message);
        }

        // ABSOLUTE FALLBACK (System Failure / No Periods Setup)
        // Defaults to standard Jan-Dec of current year to prevent crash
        const now = new Date();
        const fallbackStart = new Date(now.getFullYear(), 0, 1);
        const fallbackEnd = new Date(now.getFullYear(), 11, 31);

        _fiscalCalendarCache = {
            fiscalYearStartDate: formatConfigDate(fallbackStart),
            fiscalYearEndDate: formatConfigDate(fallbackEnd),
            currentFiscalYear: now.getFullYear(),
            periodName: 'FY ' + now.getFullYear(),
            fiscalYearStartMonth: 0,
            fiscalYearStartDay: 1,
            latestClosedPeriod: null,
            detectedFrom: 'fallback_system_failure'
        };
        
        auditLog('Fiscal Calendar Fallback', 'Using default January-December for ' + now.getFullYear());
        return _fiscalCalendarCache;
    }
    
    /**
     * Format a date as YYYY-MM-DD for config consistency
     */
    function formatConfigDate(d) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Normalize a date string from NetSuite to YYYY-MM-DD format
     * NetSuite may return dates in various formats (MM/DD/YYYY, YYYY-MM-DD, etc.)
     * @param {string} dateStr - Date string from NetSuite
     * @returns {string} Date in YYYY-MM-DD format
     */
    function normalizeDateToYMD(dateStr) {
        if (!dateStr) return dateStr;
        
        // If already in YYYY-MM-DD format, return as-is
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
        }
        
        // If in MM/DD/YYYY format, convert
        const mdyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (mdyMatch) {
            const month = mdyMatch[1].padStart(2, '0');
            const day = mdyMatch[2].padStart(2, '0');
            const year = mdyMatch[3];
            return `${year}-${month}-${day}`;
        }
        
        // If in DD/MM/YYYY or other format, try parsing with Date
        try {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
                return formatConfigDate(d);
            }
        } catch (e) {
            // Fall through
        }
        
        // Return original if we can't parse
        return dateStr;
    }

    /**
     * Get stored configuration by name
     * @param {string} configName - Name of the configuration ('cashflow', 'burden', 'health', 'time')
     * @returns {Object} Configuration object merged with defaults
     */
    function getStoredConfiguration(configName) {
        configName = configName || 'cashflow';
        const defaults = generateDefaultConfiguration(configName);
        
        try {
            const configSearch = search.create({
                type: CONFIG_RECORD_TYPE,
                filters: [
                    ['name', 'is', configName]
                ],
                columns: ['internalid', CONFIG_JSON_FIELD]
            });

            let storedConfig = null;
            configSearch.run().each(function (result) {
                const jsonStr = result.getValue(CONFIG_JSON_FIELD);
                if (jsonStr) {
                    try {
                        storedConfig = JSON.parse(jsonStr);
                    } catch (e) {
                        log.error('Config Parse Error', 'Failed to parse config JSON for: ' + configName);
                    }
                }
                return false;
            });

            if (storedConfig) {
                const merged = deepMerge(defaults, storedConfig);
                
                // Normalize groups: merge legacy categoryGroups into groups
                if (merged.categoryGroups && Array.isArray(merged.categoryGroups)) {
                    if (!merged.groups) merged.groups = [];
                    const existingIds = new Set(merged.groups.map(function(g) { return g.id; }));
                    merged.categoryGroups.forEach(function(cg) {
                        if (!existingIds.has(cg.id)) {
                            merged.groups.push(cg);
                        }
                    });
                    delete merged.categoryGroups;
                }
                
                // For main config: ensure new dashboards are added to existing config
                if (configName === 'main' && defaults.dashboardOrder) {
                    // Add any missing dashboards to the order (at end)
                    defaults.dashboardOrder.forEach(function(dashId) {
                        if (merged.dashboardOrder && merged.dashboardOrder.indexOf(dashId) === -1) {
                            merged.dashboardOrder.push(dashId);
                        }
                    });
                    // Add missing dashboard names
                    if (defaults.dashboardNames) {
                        Object.keys(defaults.dashboardNames).forEach(function(dashId) {
                            if (!merged.dashboardNames[dashId]) {
                                merged.dashboardNames[dashId] = defaults.dashboardNames[dashId];
                            }
                        });
                    }
                    // Add missing dashboard visibility (default to true)
                    if (defaults.dashboardVisibility) {
                        Object.keys(defaults.dashboardVisibility).forEach(function(dashId) {
                            if (merged.dashboardVisibility[dashId] === undefined) {
                                merged.dashboardVisibility[dashId] = true;
                            }
                        });
                    }
                }
                
                return merged;
            }
        } catch (e) {
            log.error('getStoredConfiguration', e.message);
        }

        return defaults;
    }

    /**
     * Deep merge two objects (target values override source)
     */
    function deepMerge(source, target) {
        const result = Object.assign({}, source);
        
        for (const key in target) {
            if (target.hasOwnProperty(key)) {
                if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                    result[key] = deepMerge(source[key] || {}, target[key]);
                } else {
                    result[key] = target[key];
                }
            }
        }
        
        return result;
    }

    /**
     * Generate default configuration based on type
     * @param {string} configName - Name of the configuration (may include subsidiary suffix like 'cashflow_1')
     * @returns {Object} Default configuration object
     */
    function generateDefaultConfiguration(configName) {
        // Strip subsidiary suffix if present (e.g., 'cashflow_1' -> 'cashflow')
        // But preserve compound names like 'customer_value', 'vendor_performance'
        var parts = configName.split('_');
        var lastPart = parts[parts.length - 1];
        var baseConfigName = configName;
        // Only strip if last part is numeric (subsidiary ID)
        if (!isNaN(parseInt(lastPart, 10)) && parts.length > 1) {
            baseConfigName = parts.slice(0, -1).join('_');
        }
        
        switch (baseConfigName) {
            case 'main':
                // Build dashboard defaults dynamically from Registry (single source of truth)
                var allDashboards = DashboardRegistry.getAllDashboards();
                var dashboardOrder = [];
                var dashboardNames = {};
                var dashboardVisibility = {};

                allDashboards.forEach(function(dash) {
                    if (dash.id !== 'settings') { // Settings is special, not in user config
                        dashboardOrder.push(dash.id);
                        dashboardNames[dash.id] = dash.name;
                        dashboardVisibility[dash.id] = dash.showInNav !== false;
                    }
                });

                return {
                    dashboardOrder: dashboardOrder,
                    dashboardNames: dashboardNames,
                    dashboardVisibility: dashboardVisibility,
                    compactMode: false,
                    showSparklines: true,
                    defaultDateRange: '30',
                    showAlerts: true,
                    alertSound: false,
                    autoRefresh: false,
                    refreshInterval: '5',
                    // Advisor debug mode - when true, includes detailed debug logs in API responses
                    advisorDebugMode: false
                };

            case 'burden':
                return {
                    burdenHiddenDepts: [],
                    laborOverheadFactor: 1.15,
                    burdenAppliedAccountIds: [],
                    burdenAppliedAccountNumberPattern: '500%',
                    burdenAppliedAccountNamePattern: '%burden applied%',
                    burdenAccountMap: {}
                };

            case 'health':
                return {
                    gmWarningThresholds: {
                        department: 0.10,
                        company: 0.12
                    },
                    opexToRevenueWarningThreshold: 0.30,
                    defaultTargetGM: 0.20,
                    gmBounds: {
                        min: 0.05,
                        max: 0.60
                    },
                    revenueDeclineWarningThreshold: 0.10,
                    hiddenDepartments: [],
                    excludeEmployeeTypes: []
                };

            case 'time':
                return {
                    targetBillablePercent: 70,
                    nonBillableCostSpikeThreshold: 1000,
                    minimumHoursForAnalysis: 10,
                    laborCostField: 'laborcost',
                    hiddenDepartments: [],
                    hiddenEmployees: [],
                    excludeEmployeeTypes: []
                };

                
            case 'integrity':
                return {
                    duplicateThresholdDays: 14,
                    duplicateMinAmount: 100,
                    approvalThreshold: 5000,
                    highRiskAmount: 10000,
                    benfordAlertLevel: 'marginal',
                    weekendAlertEnabled: true,
                    roundNumberAlertEnabled: true,
                    excludedVendors: [],
                    excludedAccounts: []
                };

            case 'vendor_performance':
                return {
                    // Scorecard Weights (must sum to 100)
                    weightOTIF: 35,
                    weightPPV: 25,
                    weightMaverick: 25,
                    weightTerms: 15,
                    // Thresholds
                    maverickWarningPct: 25,
                    maverickCriticalPct: 50,
                    ppvVarianceThreshold: 10,
                    onTimeWindowDays: 3,
                    // Leverage Matrix
                    highSpendThreshold: 80,
                    highPerformanceThreshold: 75,
                    // Concentration Risk
                    hhiWarningThreshold: 1500,
                    hhiCriticalThreshold: 2500,
                    // Display Options
                    topVendorsCount: 20,
                    showInactiveVendors: false,
                    excludedVendorIds: []
                };

            case 'customer_value':
                return {
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
                    // Excluded Customers
                    excludedCustomerIds: []
                };

            case 'spend_velocity':
                return {
                    // Velocity Thresholds
                    velocityHighThreshold: 15,
                    velocityMediumThreshold: 5,
                    accelerationThreshold: 5,
                    // Boiling Frog Detection
                    boilingFrogMinIncrease: 3,
                    boilingFrogMinMonths: 6,
                    boilingFrogMaxIncrease: 10,
                    // Shadow IT Detection
                    shadowITMinEmployees: 3,
                    shadowITGrowthThreshold: 50,
                    shadowITMinSpend: 500,
                    // Anomaly Detection
                    anomalyStdDevThreshold: 2.5,
                    anomalyCriticalThreshold: 3.5,
                    anomalyMinDataPoints: 6,
                    // Zombie Spend Detection
                    zombieMinMonths: 6,
                    zombieVarianceTolerance: 5,
                    zombieMinAmount: 100,
                    // Fragmentation Detection
                    fragmentationMinTxns: 20,
                    fragmentationMaxAvgSize: 500,
                    fragmentationMinVendors: 5,
                    // Concentration Risk
                    concentrationWarning: 25,
                    concentrationCritical: 40,
                    // Commitment Cliff
                    commitmentCliffWarning: 10,
                    commitmentCliffCritical: 25,
                    // Seasonal Detection
                    seasonalThreshold: 30,
                    seasonalMinMonths: 12,
                    // Display Options
                    topAccountsCount: 50,
                    topVendorsCount: 30,
                    rowsPerPage: 15
                };

            case 'cashflow':
            default:
                return {
                    apFilters: {
                        weeklyCap: 0,
                        deferIfNegative: false,
                        preservationMode: false,
                        restrictToSafe: false,
                        excludeVendorCategories: [],
                        priorityVendorCategories: []
                    },
                    categories: [],
                    groups: [],
                    bankAccountIds: [],
                    predictionSettings: {
                        volatilityThresholds: {
                            stable: 5,
                            volatile: 15
                        },
                        overduePushDays: {
                            light: 7,
                            medium: 14,
                            heavy: 28
                        },
                        paymentHistoryDays: 365,
                        defaultDaysToPay: 45
                    }
                };
        }
    }

    /**
     * Save configuration
     * @param {Object} data - Configuration data to save
     * @param {string} [configName='cashflow'] - Name of the configuration
     * @returns {Object} Result with status and message
     */
    function save(data, configName) {
        if (typeof configName === 'undefined') {
            configName = 'cashflow';
        }

        try {
            let recordId = null;
            const configSearch = search.create({
                type: CONFIG_RECORD_TYPE,
                filters: [
                    ['name', 'is', configName]
                ],
                columns: ['internalid']
            });

            configSearch.run().each(function (result) {
                recordId = result.getValue('internalid');
                return false;
            });

            let rec;
            if (recordId) {
                rec = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: recordId,
                    isDynamic: true
                });
            } else {
                rec = record.create({
                    type: CONFIG_RECORD_TYPE,
                    isDynamic: true
                });
                rec.setValue({ fieldId: 'name', value: configName });
            }

            rec.setValue({
                fieldId: CONFIG_JSON_FIELD,
                value: JSON.stringify(data)
            });

            const savedId = rec.save();
            auditLog('Config Saved', 'Config "' + configName + '" saved with ID: ' + savedId);

            return { status: 'success', id: savedId };

        } catch (e) {
            log.error('save config error', e.message);
            return { status: 'error', message: e.message };
        }
    }

    /**
     * Get configuration for API response (includes metadata and lookup lists)
     * @param {string} configName - Name of the configuration
     * @returns {Object} Configuration with supplementary data for UI
     */
    function getConfigForApi(configName) {
        configName = configName || 'cashflow';
        const config = getStoredConfiguration(configName);
        
        const result = {
            config: config,
            fiscalCalendar: getFiscalCalendar(),
            subsidiaries: getSubsidiaryList()
        };

        // Strip subsidiary suffix if present (e.g., 'cashflow_1' -> 'cashflow')
        // But preserve compound names like 'customer_value', 'vendor_performance'
        var parts = configName.split('_');
        var lastPart = parts[parts.length - 1];
        var baseConfigName = configName;
        if (!isNaN(parseInt(lastPart, 10)) && parts.length > 1) {
            baseConfigName = parts.slice(0, -1).join('_');
        }

        switch (baseConfigName) {
            case 'main':
                // Main settings don't need extra lookup data
                break;
                
            case 'cashflow':
                result.accounts = getAccountList();
                result.vendors = getVendorList();
                result.bankAccounts = getBankAccountList();
                result.vendorCategories = getVendorCategoryList();
                break;
                
            case 'burden':
                result.departments = getDepartmentList();
                result.expenseAccounts = getExpenseAccountList();
                result.serviceItems = getServiceItemList();
                break;
                
            case 'health':
                result.departments = getDepartmentList();
                result.employeeTypes = getEmployeeTypeList();
                break;
                
            case 'time':
                result.departments = getDepartmentList();
                result.employees = getEmployeeList();
                result.serviceItems = getServiceItemList();
                break;
                
            case 'integrity':
                result.vendors = getVendorList();
                result.accounts = getAccountList();
                result.departments = getDepartmentList();
                break;
                
            case 'vendor_performance':
                result.vendors = getVendorList();
                break;
                
            case 'customer_value':
                result.customers = getCustomerList();
                break;
                
            case 'spend_velocity':
                result.accounts = getAccountList();
                result.vendors = getVendorList();
                break;
        }

        return result;
    }

    /**
     * Get list of customers for configuration UI
     */
    function getCustomerList() {
        const customers = [];
        try {
            const custSearch = search.create({
                type: search.Type.CUSTOMER,
                filters: [['isinactive', 'is', 'F']],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'entityid', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'companyname' })
                ]
            });

            custSearch.run().each(function (result) {
                customers.push({
                    id: result.getValue('internalid'),
                    name: result.getValue('companyname') || result.getValue('entityid') || 'Customer ' + result.getValue('internalid')
                });
                return customers.length < 500;
            });
        } catch (e) {
            log.error('Error getting customer list', e.message);
        }
        return customers;
    }

    /**
     * Get list of all accounts for configuration UI
     */
    function getAccountList() {
        const accounts = [];
        try {
            const acctSearch = search.create({
                type: search.Type.ACCOUNT,
                filters: [['isinactive', 'is', 'F']],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'number', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'name' }),
                    search.createColumn({ name: 'type' })
                ]
            });

            acctSearch.run().each(function (result) {
                accounts.push({
                    id: result.getValue('internalid'),
                    acctNumber: result.getValue('number'),
                    name: result.getValue('name'),
                    type: result.getValue('type')
                });
                return true;
            });
        } catch (e) {
            log.error('getAccountList', e.message);
        }
        return accounts;
    }

    /**
     * Get list of bank accounts specifically
     */
    function getBankAccountList() {
        const accounts = [];
        try {
            const acctSearch = search.create({
                type: search.Type.ACCOUNT,
                filters: [
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ['type', 'anyof', 'Bank']
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'number', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'name' }),
                    search.createColumn({ name: 'balance' })
                ]
            });

            acctSearch.run().each(function (result) {
                accounts.push({
                    id: result.getValue('internalid'),
                    acctNumber: result.getValue('number'),
                    name: result.getValue('name'),
                    balance: parseFloat(result.getValue('balance')) || 0
                });
                return true;
            });
        } catch (e) {
            log.error('getBankAccountList', e.message);
        }
        return accounts;
    }

    /**
     * Get list of subsidiaries for multi-subsidiary accounts
     */
    function getSubsidiaryList() {
        const subsidiaries = [];
        try {
            // Check if subsidiaries feature is enabled
            var subsidiariesEnabled = runtime.isFeatureInEffect({ feature: 'SUBSIDIARIES' });
            if (!subsidiariesEnabled) {
                // Return a single "parent" subsidiary for non-OneWorld accounts
                return [{ id: '1', name: 'Parent Company', isElimination: false }];
            }
            
            const subSearch = search.create({
                type: search.Type.SUBSIDIARY,
                filters: [
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ['iselimination', 'is', 'F']
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'name', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'iselimination' })
                ]
            });

            subSearch.run().each(function (result) {
                subsidiaries.push({
                    id: result.getValue('internalid'),
                    name: result.getValue('name'),
                    isElimination: result.getValue('iselimination') === 'T'
                });
                return true;
            });
        } catch (e) {
            log.error('getSubsidiaryList', e.message);
            // Return default for non-OneWorld
            return [{ id: '1', name: 'Parent Company', isElimination: false }];
        }
        return subsidiaries.length > 0 ? subsidiaries : [{ id: '1', name: 'Parent Company', isElimination: false }];
    }

    /**
     * Get list of expense accounts for burden configuration
     */
    function getExpenseAccountList() {
        const accounts = [];
        try {
            const acctSearch = search.create({
                type: search.Type.ACCOUNT,
                filters: [
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ['type', 'anyof', ['Expense', 'COGS', 'OthExpense']]
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'number', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'name' }),
                    search.createColumn({ name: 'type' })
                ]
            });

            acctSearch.run().each(function (result) {
                accounts.push({
                    id: result.getValue('internalid'),
                    acctNumber: result.getValue('number'),
                    name: result.getValue('name'),
                    type: result.getValue('type')
                });
                return true;
            });
        } catch (e) {
            log.error('getExpenseAccountList', e.message);
        }
        return accounts;
    }

    /**
     * Get list of vendors for configuration UI
     */
    function getVendorList() {
        const vendors = [];
        try {
            const vendorSearch = search.create({
                type: search.Type.VENDOR,
                filters: [['isinactive', 'is', 'F']],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'entityid', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'companyname' }),
                    search.createColumn({ name: 'category' })
                ]
            });

            vendorSearch.run().each(function (result) {
                vendors.push({
                    id: result.getValue('internalid'),
                    name: result.getValue('companyname') || result.getValue('entityid'),
                    category: result.getValue('category')
                });
                return true;
            });
        } catch (e) {
            log.error('getVendorList', e.message);
        }
        return vendors;
    }

    /**
     * Get list of departments for configuration UI
     */
    function getDepartmentList() {
        const departments = [];
        try {
            const deptSearch = search.create({
                type: search.Type.DEPARTMENT,
                filters: [['isinactive', 'is', 'F']],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'name', sort: search.Sort.ASC })
                ]
            });

            deptSearch.run().each(function (result) {
                departments.push({
                    id: result.getValue('internalid'),
                    name: result.getValue('name')
                });
                return true;
            });
        } catch (e) {
            log.error('getDepartmentList', e.message);
        }
        return departments;
    }

    /**
     * Get list of employees for time configuration
     */
    function getEmployeeList() {
        const employees = [];
        try {
            const empSearch = search.create({
                type: search.Type.EMPLOYEE,
                filters: [
                    ['isinactive', 'is', 'F']
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'entityid', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'firstname' }),
                    search.createColumn({ name: 'lastname' }),
                    search.createColumn({ name: 'department' }),
                    search.createColumn({ name: 'title' })
                ]
            });

            empSearch.run().each(function (result) {
                const firstName = result.getValue('firstname') || '';
                const lastName = result.getValue('lastname') || '';
                const entityId = result.getValue('entityid') || '';
                
                employees.push({
                    id: result.getValue('internalid'),
                    name: (firstName + ' ' + lastName).trim() || entityId,
                    entityId: entityId,
                    department: result.getValue('department'),
                    title: result.getValue('title')
                });
                return true;
            });
        } catch (e) {
            log.error('getEmployeeList', e.message);
        }
        return employees;
    }

    /**
     * Get list of service items for time configuration
     */
    function getServiceItemList() {
        const items = [];
        try {
            const itemSearch = search.create({
                type: search.Type.SERVICE_ITEM,
                filters: [['isinactive', 'is', 'F']],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'itemid', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'displayname' })
                ]
            });

            itemSearch.run().each(function (result) {
                items.push({
                    id: result.getValue('internalid'),
                    name: result.getValue('displayname') || result.getValue('itemid'),
                    itemId: result.getValue('itemid')
                });
                return true;
            });
        } catch (e) {
            log.error('getServiceItemList', e.message);
        }
        return items;
    }

    /**
     * Get vendor categories for configuration UI
     */
    function getVendorCategoryList() {
        const categories = [];
        try {
            const catSearch = search.create({
                type: 'vendorcategory',
                filters: [['isinactive', 'is', 'F']],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'name', sort: search.Sort.ASC })
                ]
            });

            catSearch.run().each(function (result) {
                categories.push({
                    id: result.getValue('internalid'),
                    name: result.getValue('name')
                });
                return true;
            });
        } catch (e) {
            log.error('getVendorCategoryList', e.message);
        }
        return categories;
    }

    /**
     * Get employee types for configuration UI (e.g., Full-Time, Contractor, etc.)
     */
    function getEmployeeTypeList() {
        const employeeTypes = [];
        try {
            const sql = `
                SELECT id, name
                FROM employeetype
                WHERE isinactive = 'F'
                ORDER BY name
            `;
            const results = query.runSuiteQL({ query: sql }).asMappedResults();
            results.forEach(function(row) {
                employeeTypes.push({
                    id: String(row.id),
                    name: row.name
                });
            });
        } catch (e) {
            // Try without isinactive filter (may not exist on all versions)
            try {
                const fallbackSql = `SELECT id, name FROM employeetype ORDER BY name`;
                const results = query.runSuiteQL({ query: fallbackSql }).asMappedResults();
                results.forEach(function(row) {
                    employeeTypes.push({
                        id: String(row.id),
                        name: row.name
                    });
                });
            } catch (e2) {
                log.error('getEmployeeTypeList', e.message);
            }
        }
        return employeeTypes;
    }

    return {
        getStoredConfiguration: getStoredConfiguration,
        generateDefaultConfiguration: generateDefaultConfiguration,
        save: save,
        getConfigForApi: getConfigForApi,
        getFiscalCalendar: getFiscalCalendar,
        getAccountList: getAccountList,
        getBankAccountList: getBankAccountList,
        getSubsidiaryList: getSubsidiaryList,
        getExpenseAccountList: getExpenseAccountList,
        getVendorList: getVendorList,
        getDepartmentList: getDepartmentList,
        getEmployeeList: getEmployeeList,
        getServiceItemList: getServiceItemList,
        getVendorCategoryList: getVendorCategoryList,
        getEmployeeTypeList: getEmployeeTypeList
    };
});