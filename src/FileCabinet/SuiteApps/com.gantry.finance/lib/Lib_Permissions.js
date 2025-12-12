/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module Lib_Permissions
 * @description Role-based access control for Gantry dashboards.
 *              Uses the existing customrecord_gantry_config pattern with name='permissions'.
 *              Supports dashboard-level and subsidiary-level permissions per role.
 */
define(['N/runtime', 'N/log', './Lib_Config'], function(runtime, log, ConfigLib) {
    'use strict';

    // Admin role ID in NetSuite (Administrator)
    const ADMIN_ROLE_ID = 3;

    // Cache for permissions config
    let _permissionsCache = null;
    let _permissionsCacheTime = 0;
    const CACHE_TTL = 60000; // 1 minute

    /**
     * Get the permissions configuration
     * Uses the existing Lib_Config pattern with name='permissions'
     * @returns {Object} Permissions configuration
     */
    function getPermissionsConfig() {
        const now = Date.now();
        if (_permissionsCache && (now - _permissionsCacheTime) < CACHE_TTL) {
            return _permissionsCache;
        }

        try {
            _permissionsCache = ConfigLib.getStoredConfiguration('permissions');
            _permissionsCacheTime = now;
            return _permissionsCache;
        } catch (e) {
            log.error('Lib_Permissions', 'Error loading permissions config: ' + e.message);
            return getDefaultPermissions();
        }
    }

    /**
     * Generate default permissions configuration
     * By default, all roles have access to all dashboards (opt-out model)
     * @returns {Object} Default permissions config
     */
    function getDefaultPermissions() {
        return {
            // When enabled=false, permissions are not enforced (all roles see all dashboards)
            enabled: false,

            // Role-specific permissions
            // Key is NetSuite role internal ID (as string)
            roles: {
                // Administrator always has full access (built-in, cannot be changed)
                '3': {
                    dashboards: ['*'],
                    subsidiaries: ['*']
                }
            },

            // Default permissions for roles not explicitly listed
            // When enabled=true, this is what unlisted roles get
            defaultPermissions: {
                dashboards: ['*'],  // '*' means all dashboards
                subsidiaries: ['*'] // '*' means all subsidiaries
            },

            // Audit logging
            auditEnabled: false
        };
    }

    /**
     * Check if the current user is an administrator
     * @returns {boolean}
     */
    function isAdmin() {
        const currentUser = runtime.getCurrentUser();
        return currentUser.role === ADMIN_ROLE_ID;
    }

    /**
     * Check if permissions system is enabled
     * @returns {boolean}
     */
    function isEnabled() {
        const config = getPermissionsConfig();
        return config.enabled === true;
    }

    /**
     * Get permissions for a specific role
     * @param {number|string} roleId - NetSuite role internal ID
     * @returns {Object} Role permissions { dashboards: [], subsidiaries: [] }
     */
    function getRolePermissions(roleId) {
        const config = getPermissionsConfig();
        const roleKey = String(roleId);

        // Admin always gets full access
        if (parseInt(roleId) === ADMIN_ROLE_ID) {
            return {
                dashboards: ['*'],
                subsidiaries: ['*']
            };
        }

        // Check for role-specific permissions
        if (config.roles && config.roles[roleKey]) {
            return config.roles[roleKey];
        }

        // Fall back to default permissions
        return config.defaultPermissions || {
            dashboards: ['*'],
            subsidiaries: ['*']
        };
    }

    /**
     * Get permitted dashboards for the current user
     * @returns {string[]} Array of dashboard IDs, or ['*'] for all
     */
    function getPermittedDashboards() {
        const config = getPermissionsConfig();

        // If permissions not enabled, everyone sees everything
        if (!config.enabled) {
            return ['*'];
        }

        const currentUser = runtime.getCurrentUser();
        const rolePerms = getRolePermissions(currentUser.role);

        return rolePerms.dashboards || ['*'];
    }

    /**
     * Get permitted subsidiaries for the current user
     * @returns {(number|string)[]} Array of subsidiary IDs, or ['*'] for all
     */
    function getPermittedSubsidiaries() {
        const config = getPermissionsConfig();

        // If permissions not enabled, everyone sees everything
        if (!config.enabled) {
            return ['*'];
        }

        const currentUser = runtime.getCurrentUser();
        const rolePerms = getRolePermissions(currentUser.role);

        return rolePerms.subsidiaries || ['*'];
    }

    /**
     * Check if the current user has permission to access a specific dashboard
     * @param {string} dashboardId - Dashboard ID (e.g., 'cashflow', 'health')
     * @returns {boolean}
     */
    function hasPermission(dashboardId) {
        const config = getPermissionsConfig();

        // If permissions not enabled, allow all
        if (!config.enabled) {
            return true;
        }

        // Admin always has access
        if (isAdmin()) {
            return true;
        }

        const permitted = getPermittedDashboards();

        // '*' means all dashboards
        if (permitted.includes('*')) {
            return true;
        }

        return permitted.includes(dashboardId);
    }

    /**
     * Check if the current user can access a specific subsidiary
     * @param {number|string} subsidiaryId - Subsidiary internal ID
     * @returns {boolean}
     */
    function hasSubsidiaryAccess(subsidiaryId) {
        const config = getPermissionsConfig();

        // If permissions not enabled, allow all
        if (!config.enabled) {
            return true;
        }

        // Admin always has access
        if (isAdmin()) {
            return true;
        }

        const permitted = getPermittedSubsidiaries();

        // '*' means all subsidiaries
        if (permitted.includes('*')) {
            return true;
        }

        return permitted.includes(String(subsidiaryId)) || permitted.includes(parseInt(subsidiaryId));
    }

    /**
     * Filter a list of dashboards based on current user permissions
     * @param {Object[]} dashboards - Array of dashboard objects with 'id' property
     * @returns {Object[]} Filtered array of dashboards
     */
    function filterDashboards(dashboards) {
        const config = getPermissionsConfig();

        // If permissions not enabled, return all
        if (!config.enabled) {
            return dashboards;
        }

        // Admin gets all
        if (isAdmin()) {
            return dashboards;
        }

        const permitted = getPermittedDashboards();

        // '*' means all
        if (permitted.includes('*')) {
            return dashboards;
        }

        // Filter to only permitted dashboards
        // Always include 'settings' and 'advisor' as they're utility dashboards
        const alwaysAllowed = ['settings', 'advisor'];

        return dashboards.filter(d =>
            alwaysAllowed.includes(d.id) || permitted.includes(d.id)
        );
    }

    /**
     * Get all available roles for the permissions UI
     * Returns roles that make sense to configure (excludes system roles)
     * @returns {Object[]} Array of { id, name } objects
     */
    function getConfigurableRoles() {
        // This would ideally query NetSuite for roles, but that requires additional permissions
        // For now, return a structure that the UI can populate via search
        return [];
    }

    /**
     * Save permissions configuration
     * @param {Object} permissionsData - Permissions configuration to save
     * @returns {Object} Result { status: 'success'|'error', message?: string }
     */
    function savePermissions(permissionsData) {
        try {
            // Validate structure
            if (!permissionsData || typeof permissionsData !== 'object') {
                return { status: 'error', message: 'Invalid permissions data' };
            }

            // Ensure admin always has full access (cannot be restricted)
            if (!permissionsData.roles) {
                permissionsData.roles = {};
            }
            permissionsData.roles['3'] = {
                dashboards: ['*'],
                subsidiaries: ['*']
            };

            // Save using existing config pattern
            const result = ConfigLib.save(permissionsData, 'permissions');

            // Clear cache
            _permissionsCache = null;
            _permissionsCacheTime = 0;

            return result;
        } catch (e) {
            log.error('Lib_Permissions', 'Error saving permissions: ' + e.message);
            return { status: 'error', message: e.message };
        }
    }

    /**
     * Clear the permissions cache (useful after saving)
     */
    function clearCache() {
        _permissionsCache = null;
        _permissionsCacheTime = 0;
    }

    /**
     * Get current user context for client-side
     * @returns {Object} User context with permissions info
     */
    function getCurrentUserContext() {
        const currentUser = runtime.getCurrentUser();
        const config = getPermissionsConfig();

        return {
            userId: currentUser.id,
            userName: currentUser.name,
            roleId: currentUser.role,
            subsidiaryId: currentUser.subsidiary,
            isAdmin: isAdmin(),
            permissionsEnabled: config.enabled === true,
            permittedDashboards: getPermittedDashboards(),
            permittedSubsidiaries: getPermittedSubsidiaries()
        };
    }

    return {
        // Core permission checks
        hasPermission: hasPermission,
        hasSubsidiaryAccess: hasSubsidiaryAccess,
        isAdmin: isAdmin,
        isEnabled: isEnabled,

        // Get permissions
        getPermissionsConfig: getPermissionsConfig,
        getDefaultPermissions: getDefaultPermissions,
        getRolePermissions: getRolePermissions,
        getPermittedDashboards: getPermittedDashboards,
        getPermittedSubsidiaries: getPermittedSubsidiaries,

        // Filtering
        filterDashboards: filterDashboards,

        // Configuration
        savePermissions: savePermissions,
        clearCache: clearCache,

        // User context
        getCurrentUserContext: getCurrentUserContext
    };
});
