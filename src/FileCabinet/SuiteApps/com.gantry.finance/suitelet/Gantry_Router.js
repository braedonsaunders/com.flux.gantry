/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope Public
 * @module Gantry_Router
 * @description Dynamic API router for Gantry dashboards
 *              Auto-routes to appropriate data libraries based on action
 *              Uses centralized Dashboard Registry for dashboard metadata
 *              Includes Advisor AI chat integration
 */
define([
    'N/log',
    'N/search',
    'N/runtime',
    '../lib/Lib_Config',
    '../lib/Lib_Dashboard_Registry',
    '../lib/Lib_Permissions',
    '../lib/Lib_LicenseGuard',
    '../lib/Lib_Health_Data',
    '../lib/Lib_Cashflow_Data',
    '../lib/Lib_Time_Data',
    '../lib/Lib_Burden_Data',
    '../lib/Lib_Integrity_Data',
    '../lib/Lib_VendorPerformance_Data',
    '../lib/Lib_CustomerValue_Data',
    '../lib/Lib_SpendVelocity_Data',
    '../lib/advisor/Lib_Advisor_Orchestrator',
    '../lib/advisor/Lib_Advisor_Cache',
    '../lib/advisor/Lib_Advisor_Utils',
    '../lib/Lib_Model_Registry'
], function(
    log,
    search,
    runtime,
    ConfigLib,
    DashboardRegistry,
    Permissions,
    LicenseGuard,
    HealthData,
    CashflowData,
    TimeData,
    BurdenData,
    IntegrityData,
    VendorPerformanceData,
    CustomerValueData,
    SpendVelocityData,
    AdvisorOrchestrator,
    Cache,
    AdvisorUtils,
    ModelRegistry
) {
    'use strict';

    // Use centralized debug mode from Lib_Advisor_Utils
    const debugLog = AdvisorUtils.debugLog;

    function auditLog(title, details) {
        if (AdvisorUtils.isDebugMode()) log.audit(title, details);
    }

    /**
     * Data library mapping - maps dashboard IDs to their data modules
     * Metadata comes from Lib_Dashboard_Registry
     */
    const DATA_LIBS = {
        health: HealthData,
        profitability: HealthData,  // Alias to avoid collision with system health check endpoint
        cashflow: CashflowData,
        time: TimeData,
        burden: BurdenData,
        integrity: IntegrityData,
        vendorperformance: VendorPerformanceData,
        customervalue: CustomerValueData,
        spendvelocity: SpendVelocityData
    };

    /**
     * Actions that don't require a license (settings access for license key entry)
     */
    const LICENSE_EXEMPT_ACTIONS = [
        'user_permissions',
        'main_config',
        'license_status',
        'license_refresh',
        'roles',
        'models',
        'openrouter_models',
        'health',
        'installationVerify'
    ];

    /**
     * Check if action requires license and validate
     * @param {string} action - Action name
     * @returns {Object|null} Error response if license invalid, null if OK
     */
    function checkLicense(action) {
        // Skip license check for exempt actions
        if (LICENSE_EXEMPT_ACTIONS.indexOf(action) !== -1) {
            return null;
        }

        // Check if this is a config endpoint (allow for settings)
        if (action.endsWith('_config') || action.startsWith('save_')) {
            return null;
        }

        try {
            const license = LicenseGuard.validate();
            if (!license || !license.valid) {
                return {
                    error: 'FLUX_LICENSE_REQUIRED',
                    message: 'Valid Gantry license required. Go to Settings to enter your license key.',
                    licenseStatus: LicenseGuard.getStatus()
                };
            }
        } catch (e) {
            log.error('License Check Error', e.message);
            return {
                error: 'LICENSE_CHECK_FAILED',
                message: 'Unable to validate license: ' + e.message
            };
        }

        return null;
    }

    /**
     * Get health status for installation verification
     * Used by fluxfornetsuite.com to verify SuiteApp installation
     * @param {boolean} detailed - If true, includes component checks
     * @returns {Object} Health status object
     */
    function getHealthStatus(detailed) {
        const health = {
            status: 'healthy',
            version: '2.1.0',
            product: 'gantry',
            account: runtime.accountId,
            environment: runtime.envType === runtime.EnvType.PRODUCTION ? 'PRODUCTION' : 'SANDBOX',
            timestamp: new Date().toISOString()
        };

        // Basic license check (non-blocking)
        try {
            const licenseResult = LicenseGuard.validate();
            health.license = {
                valid: licenseResult && licenseResult.valid === true,
                status: licenseResult ? licenseResult.status : 'unknown',
                tier: licenseResult ? licenseResult.tier : null,
                expires_at: licenseResult ? licenseResult.expires_at : null
            };
        } catch (e) {
            health.license = { valid: false, status: 'error', message: e.message };
        }

        if (detailed) {
            health.components = { records: {}, scripts: {} };

            // Check main config record exists
            try {
                const configSearch = search.create({
                    type: 'customrecord_gantry_config',
                    columns: ['internalid'],
                    filters: [['name', 'is', 'main']]
                });
                const results = configSearch.run().getRange({ start: 0, end: 1 });
                health.components.records.gantry_config = {
                    exists: results.length > 0,
                    count: results.length
                };
            } catch (e) {
                health.components.records.gantry_config = { exists: false, error: e.message };
            }

            // Check permissions config exists
            try {
                const permSearch = search.create({
                    type: 'customrecord_gantry_config',
                    columns: ['internalid'],
                    filters: [['name', 'is', 'permissions']]
                });
                const permResults = permSearch.run().getRange({ start: 0, end: 1 });
                health.components.records.permissions_config = {
                    exists: permResults.length > 0
                };
            } catch (e) {
                health.components.records.permissions_config = { exists: false, error: e.message };
            }

            // Router script is responding (self-check)
            health.components.scripts.router = { exists: true, responding: true };

            // Calculate overall installation status
            health.installed = health.components.records.gantry_config &&
                              health.components.records.gantry_config.exists;

            // Add dashboard count for verification
            try {
                const dashboards = DashboardRegistry.getDataDashboards();
                health.components.dashboards = {
                    count: dashboards.length,
                    ids: dashboards.map(function(d) { return d.id; })
                };
            } catch (e) {
                health.components.dashboards = { count: 0, error: e.message };
            }
        }

        return health;
    }

    /**
     * Handle GET requests
     */
    function doGet(context) {
        const action = context.action;

        try {
            // License status endpoint (always allowed)
            if (action === 'license_status') {
                return LicenseGuard.getStatus();
            }

            // License refresh endpoint (always allowed)
            if (action === 'license_refresh') {
                return LicenseGuard.refresh() ? LicenseGuard.getStatus() : LicenseGuard.getStatus();
            }

            // Health check endpoint (always allowed - for website verification)
            if (action === 'health') {
                return getHealthStatus(false);
            }

            // Installation verification endpoint (always allowed - detailed component check)
            if (action === 'installationVerify') {
                return getHealthStatus(true);
            }

            // Check license for protected actions
            const licenseError = checkLicense(action);
            if (licenseError) {
                return licenseError;
            }
            // Dashboard list from registry (filtered by permissions)
            if (action === 'dashboards') {
                return getDashboardList();
            }

            // Dashboard metadata from registry
            if (action === 'dashboard_meta') {
                return getDashboardMetadata(context.dashboard);
            }

            // AI usage stats
            if (action === 'ai_usage') {
                return getAIUsage();
            }

            // Advisor status polling endpoint (for progressive rendering)
            if (action === 'advisor_status') {
                return getAdvisorStatus(context.id);
            }

            // Models endpoint for Settings UI
            if (action === 'models') {
                return ModelRegistry.getModelsForSettings();
            }

            // OpenRouter models endpoint - fetches dynamic list from OpenRouter API
            if (action === 'openrouter_models') {
                return getOpenRouterModels(context.apiKey);
            }

            // Dashboard Scores - unified endpoint for all health scores
            if (action === 'dashboard_scores') {
                return getDashboardScores();
            }

            // Roles list for permissions UI
            if (action === 'roles') {
                return getRolesList();
            }

            // User permissions context
            if (action === 'user_permissions') {
                return Permissions.getCurrentUserContext();
            }

            // Permissions config (admin only)
            if (action === 'permissions_config') {
                if (!Permissions.isAdmin()) {
                    return { error: 'Access denied', message: 'Only administrators can view permissions configuration' };
                }
                return { config: Permissions.getPermissionsConfig() };
            }

            // Check for dashboard data requests
            if (DATA_LIBS[action]) {
                // Permission check for dashboard data
                if (!Permissions.hasPermission(action)) {
                    return {
                        error: 'Access denied',
                        message: 'You do not have permission to access this dashboard',
                        dashboardId: action
                    };
                }
                return getDashboardData(action, context);
            }
            
            // Vendor Performance specific endpoints
            if (action === 'vendor_performance_data') {
                return getDashboardData('vendorperformance', context);
            }
            
            // Customer Value specific endpoints
            if (action === 'customer_value_data') {
                return getDashboardData('customervalue', context);
            }
            
            // Spend Velocity specific endpoints
            if (action === 'spend_velocity_data') {
                return getDashboardData('spendvelocity', context);
            }
            
            
            // Config endpoints
            if (action.endsWith('_config')) {
                const configName = action.replace('_config', '');
                return ConfigLib.getConfigForApi(configName);
            }
            
            if (action === 'config') {
                return ConfigLib.getConfigForApi('cashflow');
            }
            
            log.error('Unknown GET action', action);
            return { error: 'Unknown action: ' + action };
            
        } catch (e) {
            log.error('Router GET Error', { action: action, error: e.message, stack: e.stack });
            return { error: e.message };
        }
    }
    
    /**
     * Handle POST requests
     */
    function doPost(context) {
        const action = context.action;
        const data = context.data;

        try {
            // Generic save_config action (uses nested data.config format)
            if (action === 'save_config') {
                return ConfigLib.save(data.config, data.configName || 'cashflow');
            }

            // Save config with embedded name (e.g., save_burden_config, save_cashflow_config)
            if (action.startsWith('save_') && action.endsWith('_config')) {
                const configName = action.replace('save_', '').replace('_config', '');
                const result = ConfigLib.save(data, configName);

                // If saving main config and licenseKey was updated, refresh license
                if (configName === 'main' && data.licenseKey !== undefined) {
                    try {
                        LicenseGuard.refresh();
                        result.licenseStatus = LicenseGuard.getStatus();
                    } catch (e) {
                        log.error('License Refresh Error', e.message);
                        result.licenseStatus = { valid: false, status: 'error', message: e.message };
                    }
                }

                return result;
            }

            // Save permissions config (admin only)
            if (action === 'save_permissions_config') {
                if (!Permissions.isAdmin()) {
                    return { status: 'error', message: 'Only administrators can modify permissions' };
                }
                return Permissions.savePermissions(data);
            }

            // Customer Value config save
            if (action === 'customer_value_config') {
                return ConfigLib.save(data, 'customer_value');
            }

            // Advisor AI Chat Async (returns request_id immediately, poll for updates)
            if (action === 'advisor_chat_async') {
                return handleAdvisorChatAsync(data);
            }

            // AI Summary for dashboard
            if (action === 'ai_summary') {
                return getAISummary(context.dashboard, data);
            }
            
            // Spend Velocity sub-actions (drilldowns)
            if (action === 'spend_velocity') {
                return SpendVelocityData.handleRequest(data);
            }
            
            // Vendor Performance sub-actions (vendor drilldowns)
            if (action === 'vendor_performance') {
                return VendorPerformanceData.handleRequest(data);
            }
            
            // Customer Value sub-actions (job drilldowns)
            if (action === 'customer_value') {
                return CustomerValueData.handleRequest(data);
            }
            
            // Integrity sub-actions (audit flyouts)
            if (action === 'integrity') {
                return IntegrityData.handleRequest(data);
            }
            
            // Time sub-actions (employee/item entries flyouts)
            if (action === 'time') {
                return TimeData.handleRequest(data);
            }
            
            // Burden sub-actions (category drilldowns, scenarios, config)
            if (action === 'burden') {
                return BurdenData.handleRequest(data);
            }
            
            // Profitability sub-actions (account drilldowns, segments, forecasts, scenarios)
            if (action === 'profitability') {
                return HealthData.handleRequest(data);
            }
            
            // Cashflow sub-actions (week transactions, entity history, aging buckets)
            if (action === 'cashflow') {
                return CashflowData.handleRequest(data);
            }
            
            // Burden config save - NOW SAVES TO ACTIVE PROFILE
            if (action === 'burden_config') {
                const existingConfig = ConfigLib.getStoredConfiguration('burden') || {};
                
                // Ensure profiles array exists
                if (!existingConfig.profiles) existingConfig.profiles = [];
                
                // Find or create active profile
                const activeProfileId = existingConfig.activeProfileId || 'default';
                let profile = existingConfig.profiles.find(p => p.id === activeProfileId);
                
                if (!profile) {
                    profile = {
                        id: 'default',
                        name: 'Default',
                        color: '#3b82f6',
                        isDefault: true,
                        categories: [],
                        accountMappings: {},
                        excludedAccounts: []
                    };
                    existingConfig.profiles.push(profile);
                    existingConfig.activeProfileId = 'default';
                }
                
                // Merge incoming config INTO the profile (not root)
                Object.assign(profile, data.config);
                
                return ConfigLib.save(existingConfig, 'burden');
            }
            
            log.error('Unknown POST action', action);
            return { status: 'error', message: 'Unknown action: ' + action };
            
        } catch (e) {
            log.error('Router POST Error', { action: action, error: e.message, stack: e.stack });
            return { status: 'error', message: e.message };
        }
    }

    /**
     * Handle Advisor AI chat request (async mode)
     * Returns request_id immediately, frontend polls for updates
     * @param {Object} data - Request data with message, history, context, sessionContext
     */
    function handleAdvisorChatAsync(data) {
        try {
            auditLog('Advisor Chat Async Request', {
                messageLength: data.message?.length || 0,
                historyLength: data.history?.length || 0
            });

            // Validate message
            if (!data.message || typeof data.message !== 'string') {
                return {
                    error: 'Message is required',
                    status: 'error'
                };
            }

            // Start async processing
            const result = AdvisorOrchestrator.processChatAsync({
                message: data.message.trim(),
                history: data.history || [],
                context: data.context || {},
                sessionContext: data.sessionContext || {},
                aiSettings: data.aiSettings || {}
            });

            return result;

        } catch (e) {
            log.error('Advisor Chat Async Error', {
                message: e.message,
                stack: e.stack
            });

            return {
                status: 'error',
                error: e.message
            };
        }
    }

    /**
     * Get advisor request status and advance agent one step (for polling)
     * Each call runs ONE step of the agent loop for progressive rendering
     * @param {string} requestId - Request ID from advisor_chat_async
     */
    function getAdvisorStatus(requestId) {
        if (!requestId) {
            return {
                status: 'error',
                error: 'request_id is required'
            };
        }

        try {
            // Use orchestrator's getStatus which runs the next agent step
            return AdvisorOrchestrator.getStatus(requestId);
        } catch (e) {
            log.error('Advisor Status Error', {
                requestId: requestId,
                error: e.message
            });

            return {
                status: 'error',
                error: e.message
            };
        }
    }

    /**
     * Get list of all available dashboards from registry (filtered by permissions)
     */
    function getDashboardList() {
        let dashboards = DashboardRegistry.getDataDashboards().map(function(d) {
            return {
                id: d.id,
                name: d.name,
                icon: d.icon,
                description: d.description,
                order: d.sortOrder,
                features: d.features || []
            };
        });

        // Filter by user permissions
        dashboards = Permissions.filterDashboards(dashboards);

        return { dashboards: dashboards };
    }

    /**
     * Get list of roles for permissions configuration UI
     * Returns active roles that can be configured
     */
    function getRolesList() {
        const roles = [];
        try {
            const roleSearch = search.create({
                type: 'role',
                filters: [
                    ['isinactive', 'is', 'F']
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'name', sort: search.Sort.ASC })
                ]
            });

            roleSearch.run().each(function(result) {
                roles.push({
                    id: result.getValue('internalid'),
                    name: result.getValue('name')
                });
                return true;
            });
        } catch (e) {
            log.error('getRolesList', e.message);
        }
        return { roles: roles };
    }
    
    /**
     * Get metadata for a specific dashboard from registry
     */
    function getDashboardMetadata(dashboardId) {
        const dashboard = DashboardRegistry.getDashboard(dashboardId);
        
        if (!dashboard) {
            return { error: 'Dashboard not found: ' + dashboardId };
        }
        
        return {
            id: dashboardId,
            metadata: {
                name: dashboard.name,
                shortName: dashboard.shortName,
                description: dashboard.description,
                icon: dashboard.icon,
                color: dashboard.color,
                order: dashboard.sortOrder,
                dataSchema: dashboard.dataSchema,
                keywords: dashboard.keywords
            }
        };
    }

    /**
     * Get all dashboard health scores in a single call
     * Optimized for fast app load - uses lightweight score-only functions
     * @returns {Object} { scores: {...}, computedAt: string }
     */
    function getDashboardScores() {
        const startTime = Date.now();
        const scores = {};
        const errors = [];

        // Define dashboard order and metadata
        const dashboardMeta = {
            health: { name: 'Financial Health', icon: 'heartbeat', color: '#4CAF50' },
            time: { name: 'Time Utilization', icon: 'clock', color: '#2196F3' },
            integrity: { name: 'Data Integrity', icon: 'shield', color: '#9C27B0' },
            customervalue: { name: 'Customer Value', icon: 'users', color: '#FF9800' },
            vendorperformance: { name: 'Vendor Performance', icon: 'truck', color: '#00BCD4' },
            spendvelocity: { name: 'Spend Velocity', icon: 'trending-up', color: '#F44336' },
            cashflow: { name: 'Cash Flow', icon: 'dollar-sign', color: '#4CAF50' },
            burden: { name: 'Burden Rates', icon: 'layers', color: '#795548' }
        };

        // Call getScoreOnly for each dashboard that has the function
        Object.keys(DATA_LIBS).forEach(function(dashboardId) {
            if (!dashboardMeta[dashboardId]) return; // Skip if not in our list

            try {
                const lib = DATA_LIBS[dashboardId];
                if (lib && typeof lib.getScoreOnly === 'function') {
                    const result = lib.getScoreOnly();
                    scores[dashboardId] = {
                        ...result,
                        ...dashboardMeta[dashboardId]
                    };
                }
            } catch (e) {
                errors.push({ dashboard: dashboardId, error: e.message });
                // Provide fallback score
                scores[dashboardId] = {
                    score: 50,
                    grade: 'C',
                    label: 'Unable to calculate',
                    trend: 'stable',
                    error: e.message,
                    ...dashboardMeta[dashboardId]
                };
            }
        });

        return {
            scores: scores,
            computedAt: new Date().toISOString(),
            computeTimeMs: Date.now() - startTime,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * Get data for a specific dashboard
     */
    function getDashboardData(dashboardId, context) {
        const dataLib = DATA_LIBS[dashboardId];
        const dashboard = DashboardRegistry.getDashboard(dashboardId);

        if (!dataLib) {
            return { error: 'No data library for dashboard: ' + dashboardId };
        }
        
        const params = {
            startDate: context.startDate,
            endDate: context.endDate,
            horizonWeeks: context.horizonWeeks ? parseInt(context.horizonWeeks) : undefined,
            departmentId: context.departmentId,
            subsidiaryId: context.subsidiaryId,
            subsidiary: context.subsidiary,
            lightRefresh: context.lightRefresh, // Performance: skip expensive history/forecast calculations
            config: context.config ? (typeof context.config === 'string' ? JSON.parse(context.config) : context.config) : undefined
        };
        
        // Clean undefined params
        Object.keys(params).forEach(function(key) {
            if (params[key] === undefined) {
                delete params[key];
            }
        });
        
        // Call appropriate method based on data library
        let data;
        try {
            if (dataLib.analyze) {
                data = dataLib.analyze(params);
            } else if (dataLib.getData) {
                data = dataLib.getData(params);
            } else {
                return { error: 'No data method found for dashboard: ' + dashboardId };
            }
        } catch (dataError) {
            log.error('Dashboard Data Error', { dashboardId: dashboardId, error: dataError.message, stack: dataError.stack });
            return { error: 'Failed to load dashboard data: ' + (dataError.message || 'Unknown error'), dashboardId: dashboardId };
        }

        // Ensure data is not null/undefined before adding metadata
        if (!data) {
            log.error('Dashboard Null Data', { dashboardId: dashboardId });
            return { error: 'No data returned from dashboard: ' + dashboardId };
        }

        // Add metadata
        data._meta = {
            dashboardId: dashboardId,
            dashboardName: dashboard ? dashboard.name : dashboardId
        };

        return data;
    }
    
    /**
     * Get AI summary for dashboard data
     */
    function getAISummary(dashboardId, data) {
        const dashboard = DashboardRegistry.getDashboard(dashboardId);
        
        if (!dashboard) {
            return { error: 'Dashboard not found: ' + dashboardId };
        }
        
        // Build AI context from dashboard schema
        const schemaDesc = DashboardRegistry.getSchemaDescription(dashboardId);
        
        return {
            status: 'ok',
            dashboardId: dashboardId,
            schemaDescription: schemaDesc,
            context: {
                dashboard: dashboard.name,
                description: dashboard.description
            }
        };
    }
    
    /**
     * Get NetSuite AI usage statistics
     */
    function getAIUsage() {
        try {
            return AdvisorOrchestrator.getUsage();
        } catch (e) {
            log.error('AI Usage Error', e.message);
            return { error: e.message };
        }
    }
    
    /**
     * Get OpenRouter models - either from API or curated list
     * @param {string} apiKey - Optional API key for dynamic fetch
     */
    function getOpenRouterModels(apiKey) {
        try {
            if (ModelRegistry.getOpenRouterModelsForSettings) {
                return ModelRegistry.getOpenRouterModelsForSettings(apiKey);
            }
            // Fallback to curated list
            return {
                models: ModelRegistry.getCuratedOpenRouterModels ? 
                    ModelRegistry.getCuratedOpenRouterModels().map(function(m) {
                        return {
                            value: m.id,
                            label: m.name + ' [T' + m.tier + ']',
                            tier: m.tier,
                            tierLabel: 'T' + m.tier
                        };
                    }) : [],
                count: 0
            };
        } catch (e) {
            log.error('OpenRouter Models Error', e.message);
            return { error: e.message, models: [] };
        }
    }
    
    return {
        get: doGet,
        post: doPost
    };
});