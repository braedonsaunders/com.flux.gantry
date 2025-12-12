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
    '../lib/Lib_Config',
    '../lib/Lib_Dashboard_Registry',
    '../lib/Lib_Permissions',
    '../lib/Lib_Health_Data',
    '../lib/Lib_Cashflow_Data',
    '../lib/Lib_Time_Data',
    '../lib/Lib_Burden_Data',
    '../lib/Lib_Integrity_Data',
    '../lib/Lib_VendorPerformance_Data',
    '../lib/Lib_CustomerValue_Data',
    '../lib/Lib_SpendVelocity_Data',
    '../lib/advisor/Lib_Advisor_Orchestrator',
    '../lib/advisor/Lib_Advisor_ProgressStore',
    '../lib/Lib_Model_Registry'
], function(
    log,
    search,
    ConfigLib,
    DashboardRegistry,
    Permissions,
    HealthData,
    CashflowData,
    TimeData,
    BurdenData,
    IntegrityData,
    VendorPerformanceData,
    CustomerValueData,
    SpendVelocityData,
    AdvisorOrchestrator,
    ProgressStore,
    ModelRegistry
) {
    'use strict';
    
    // Cache for debug mode
    let _debugModeCache = null;
    let _debugModeCacheTime = 0;
    const DEBUG_CACHE_TTL = 60000;
    
    function isDebugMode() {
        const now = Date.now();
        if (_debugModeCache === null || (now - _debugModeCacheTime) > DEBUG_CACHE_TTL) {
            try {
                const mainConfig = ConfigLib.getStoredConfiguration('main');
                _debugModeCache = mainConfig && mainConfig.advisorDebugMode === true;
            } catch (e) {
                _debugModeCache = false;
            }
            _debugModeCacheTime = now;
        }
        return _debugModeCache;
    }
    
    function debugLog(title, details) {
        if (isDebugMode()) log.debug(title, details);
    }
    
    function auditLog(title, details) {
        if (isDebugMode()) log.audit(title, details);
    }
    
    /**
     * Data library mapping - maps dashboard IDs to their data modules
     * Metadata comes from Lib_Dashboard_Registry
     */
    const DATA_LIBS = {
        health: HealthData,
        cashflow: CashflowData,
        time: TimeData,
        burden: BurdenData,
        integrity: IntegrityData,
        vendorperformance: VendorPerformanceData,
        customervalue: CustomerValueData,
        spendvelocity: SpendVelocityData
    };
    
    /**
     * Handle GET requests
     */
    function doGet(context) {
        const action = context.action;

        try {
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
            // Save config
            if (action.startsWith('save_') && action.endsWith('_config')) {
                const configName = action.replace('save_', '').replace('_config', '');
                return ConfigLib.save(data, configName);
            }
            
            if (action === 'save_config') {
                return ConfigLib.save(data, 'cashflow');
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
            
            // Health sub-actions (account drilldowns, segments, forecasts, scenarios)
            if (action === 'health') {
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
        if (dataLib.analyze) {
            data = dataLib.analyze(params);
        } else if (dataLib.getData) {
            data = dataLib.getData(params);
        } else {
            return { error: 'No data method found for dashboard: ' + dashboardId };
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