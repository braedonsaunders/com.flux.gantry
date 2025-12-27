/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module Lib_LicenseGuard
 * @description License validation module for Gantry Financial Suite
 *              Validates licenses against fluxfornetsuite.com API
 *              Implements caching, offline grace period, and tier-based access control
 */
define(['N/https', 'N/runtime', 'N/cache', 'N/error', 'N/encode', 'N/search', 'N/log'],
function(https, runtime, cache, error, encode, search, log) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    // API Endpoint (base64 encoded for light obfuscation)
    const _API_B64 = 'aHR0cHM6Ly9mbHV4Zm9ybmV0c3VpdGUuY29tL2FwaS92MS9saWNlbnNlLWNoZWNr';

    // Product identification
    const PRODUCT_NAME = 'gantry';
    const CLIENT_HEADER = 'gantry-suiteapp';
    const CLIENT_VERSION = '2.1.0';

    // Cache configuration
    const CACHE_NAME = 'FLUX_GANTRY_LICENSE';
    const CACHE_KEY = 'license_data';
    const CACHE_TTL = 3600; // 1 hour in seconds
    const OFFLINE_GRACE_HOURS = 24;

    // Config record
    const CONFIG_RECORD_TYPE = 'customrecord_gantry_config';
    const CONFIG_JSON_FIELD = 'custrecord_gantry_config_json';

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER CONFIGURATION - Easy to modify for future tier changes
    // ═══════════════════════════════════════════════════════════════════════════

    const TIER_CONFIG = {
        // Tier definitions - ordered by level
        tiers: {
            'starter': { level: 1, label: 'Starter', color: '#6b7280', badgeClass: 'badge-secondary' },
            'standard': { level: 2, label: 'Standard', color: '#3b82f6', badgeClass: 'badge-primary' },
            'professional': { level: 3, label: 'Professional', color: '#8b5cf6', badgeClass: 'badge-purple' },
            'enterprise': { level: 4, label: 'Enterprise', color: '#f59e0b', badgeClass: 'badge-warning' }
        },

        // Feature-to-minimum-tier mapping - empty for now, easy to populate later
        // Format: 'feature_name': 'minimum_tier_required'
        features: {
            // Examples for future use:
            // 'advisor_advanced': 'professional',
            // 'api_access': 'enterprise',
            // 'white_label': 'enterprise'
        },

        // Dashboard-to-minimum-tier mapping - all unrestricted for now
        // Format: 'dashboard_id': 'minimum_tier_required'
        dashboards: {
            // Examples for future use:
            // 'integrity': 'professional',
            // 'custom_reports': 'enterprise'
        },

        // Module-to-minimum-tier mapping (from API modules array)
        modules: {
            // Mapped from API response modules array
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Decode base64 string
     */
    function _decode(str) {
        try {
            return encode.convert({
                string: str,
                inputEncoding: encode.Encoding.BASE_64,
                outputEncoding: encode.Encoding.UTF_8
            });
        } catch (e) {
            return '';
        }
    }

    /**
     * Get the API endpoint URL
     */
    function _getApiEndpoint() {
        return _decode(_API_B64);
    }

    /**
     * Get cache instance
     */
    function _getCache() {
        return cache.getCache({
            name: CACHE_NAME,
            scope: cache.Scope.PRIVATE
        });
    }

    /**
     * Generate device fingerprint for this NetSuite instance
     */
    function _generateFingerprint() {
        const envType = runtime.envType === runtime.EnvType.PRODUCTION ? 'PRODUCTION' : 'SANDBOX';
        const parts = [
            runtime.accountId,
            envType,
            PRODUCT_NAME,
            'FLUX'
        ];
        return parts.join('::');
    }

    /**
     * Get license key from main configuration
     */
    function _getLicenseKey() {
        try {
            const configSearch = search.create({
                type: CONFIG_RECORD_TYPE,
                filters: [
                    ['name', 'is', 'main']
                ],
                columns: [CONFIG_JSON_FIELD]
            });

            const results = configSearch.run().getRange({ start: 0, end: 1 });
            if (results.length > 0) {
                const dataStr = results[0].getValue(CONFIG_JSON_FIELD);
                if (dataStr) {
                    const config = JSON.parse(dataStr);
                    return config.licenseKey || '';
                }
            }
        } catch (e) {
            log.debug('LicenseGuard', 'Could not load license key: ' + e.message);
        }
        return '';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CORE LICENSE VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Fetch license from API
     * @returns {Object|null} License data or null on failure
     */
    function _fetchLicense() {
        const endpoint = _getApiEndpoint();
        if (!endpoint) {
            log.error('LicenseGuard', 'Invalid API endpoint configuration');
            return null;
        }

        const licenseKey = _getLicenseKey();
        const accountId = runtime.accountId;

        try {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Flux-Client': CLIENT_HEADER,
                'X-Flux-Account': accountId
            };

            const body = JSON.stringify({
                account: accountId,
                license_key: licenseKey,
                device_fingerprint: _generateFingerprint(),
                product: PRODUCT_NAME,
                client_version: CLIENT_VERSION
            });

            const response = https.post({
                url: endpoint,
                headers: headers,
                body: body
            });

            if (response.code !== 200) {
                log.error('LicenseGuard', 'API returned status ' + response.code);
                return null;
            }

            const result = JSON.parse(response.body);

            // Add cache metadata
            result._fetched = Date.now();
            result._expires = Date.now() + (CACHE_TTL * 1000);

            return result;

        } catch (e) {
            log.error('LicenseGuard', 'API call failed: ' + e.message);
            return null;
        }
    }

    /**
     * Get cached license data
     * @returns {Object|null} Cached license or null
     */
    function _getCachedLicense() {
        try {
            const licenseCache = _getCache();
            const cached = licenseCache.get({ key: CACHE_KEY });

            if (cached) {
                const data = JSON.parse(cached);

                // Check if cache is still valid
                if (data._expires && data._expires > Date.now()) {
                    return data;
                }
            }
        } catch (e) {
            log.debug('LicenseGuard', 'Cache read error: ' + e.message);
        }
        return null;
    }

    /**
     * Save license to cache
     */
    function _cacheLicense(data) {
        try {
            const licenseCache = _getCache();
            licenseCache.put({
                key: CACHE_KEY,
                value: JSON.stringify(data),
                ttl: CACHE_TTL
            });
        } catch (e) {
            log.debug('LicenseGuard', 'Cache write error: ' + e.message);
        }
    }

    /**
     * Get offline fallback license (within grace period)
     * @returns {Object} License object with offline flag
     */
    function _getOfflineFallback() {
        try {
            const licenseCache = _getCache();
            const cached = licenseCache.get({ key: CACHE_KEY });

            if (cached) {
                const data = JSON.parse(cached);

                // Calculate grace period expiry
                const graceExpiry = (data._fetched || 0) + (OFFLINE_GRACE_HOURS * 60 * 60 * 1000);

                if (graceExpiry > Date.now() && data.valid === true) {
                    log.audit('LicenseGuard', 'Using offline fallback license (grace period active)');
                    return {
                        valid: true,
                        status: 'active',
                        tier: data.tier || 'standard',
                        modules: data.modules || [],
                        licensed_to: data.licensed_to,
                        expires_at: data.expires_at,
                        _offline: true,
                        _graceExpiresAt: new Date(graceExpiry).toISOString()
                    };
                }
            }
        } catch (e) {
            log.debug('LicenseGuard', 'Offline fallback error: ' + e.message);
        }

        return {
            valid: false,
            status: 'offline_expired',
            _offline: true
        };
    }

    /**
     * Get license data (with caching and fallback)
     * @returns {Object} License data object
     */
    function getLicense() {
        // Try cache first
        const cached = _getCachedLicense();
        if (cached) {
            return cached;
        }

        // Fetch from API
        const fresh = _fetchLicense();
        if (fresh) {
            _cacheLicense(fresh);
            return fresh;
        }

        // Offline fallback
        return _getOfflineFallback();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Validate license (non-blocking)
     * @returns {Object} License object
     */
    function validate() {
        return getLicense();
    }

    /**
     * Require valid license (blocking - throws on invalid)
     * @returns {Object} Valid license object
     * @throws {Error} If license is invalid
     */
    function require() {
        const license = getLicense();

        if (!license) {
            _block('VALIDATION_FAILED');
        }

        if (!license.valid) {
            _block(license.status || 'INVALID');
        }

        return license;
    }

    /**
     * Block execution with license error
     */
    function _block(reason) {
        throw error.create({
            name: 'FLUX_LICENSE_REQUIRED',
            message: 'Valid Gantry license required. Visit fluxfornetsuite.com or contact sales@fluxfornetsuite.com. [' + reason + ']',
            notifyOff: false
        });
    }

    /**
     * Quick validity check
     * @returns {boolean} True if license is valid
     */
    function isValid() {
        const license = getLicense();
        return license && license.valid === true;
    }

    /**
     * Force refresh license from API
     * @returns {Object} Fresh license data
     */
    function refresh() {
        const licenseCache = _getCache();

        try {
            licenseCache.remove({ key: CACHE_KEY });
        } catch (e) {
            // Ignore cache removal errors
        }

        return getLicense();
    }

    /**
     * Get current license tier
     * @returns {string|null} Tier name or null if not licensed
     */
    function getTier() {
        const license = getLicense();
        if (!license || !license.valid) return null;
        return license.tier || 'standard';
    }

    /**
     * Get tier configuration
     * @param {string} tierName - Tier name
     * @returns {Object|null} Tier configuration
     */
    function getTierConfig(tierName) {
        return TIER_CONFIG.tiers[tierName] || null;
    }

    /**
     * Check if current tier meets minimum requirement
     * @param {string} requiredTier - Minimum tier required
     * @returns {boolean} True if current tier meets requirement
     */
    function hasTierAccess(requiredTier) {
        const license = getLicense();
        if (!license || !license.valid) return false;

        const currentTier = license.tier || 'standard';
        const currentLevel = TIER_CONFIG.tiers[currentTier]?.level || 0;
        const requiredLevel = TIER_CONFIG.tiers[requiredTier]?.level || 999;

        return currentLevel >= requiredLevel;
    }

    /**
     * Check if license has a specific module enabled
     * @param {string} moduleName - Module name to check
     * @returns {boolean} True if module is available
     */
    function hasModule(moduleName) {
        const license = getLicense();
        if (!license || !license.valid) return false;

        // Check API-provided modules array
        if (license.modules && Array.isArray(license.modules)) {
            if (license.modules.indexOf(moduleName) !== -1) {
                return true;
            }
        }

        // Check tier-based module access
        const requiredTier = TIER_CONFIG.modules[moduleName];
        if (requiredTier) {
            return hasTierAccess(requiredTier);
        }

        // Module not restricted = available
        return true;
    }

    /**
     * Require a specific module (throws if not available)
     * @param {string} moduleName - Module name
     * @returns {Object} License object
     */
    function requireModule(moduleName) {
        const license = require(); // First ensure valid license

        if (!hasModule(moduleName)) {
            throw error.create({
                name: 'FLUX_MODULE_REQUIRED',
                message: 'The "' + moduleName + '" feature requires a higher subscription tier. Visit fluxfornetsuite.com to upgrade.',
                notifyOff: false
            });
        }

        return license;
    }

    /**
     * Check if a feature is available at current tier
     * @param {string} featureName - Feature name
     * @returns {boolean} True if feature is available
     */
    function hasFeature(featureName) {
        const requiredTier = TIER_CONFIG.features[featureName];
        if (!requiredTier) return true; // Not tier-gated = available
        return hasTierAccess(requiredTier);
    }

    /**
     * Check if a dashboard is available at current tier
     * @param {string} dashboardId - Dashboard ID
     * @returns {boolean} True if dashboard is available
     */
    function hasDashboardAccess(dashboardId) {
        const requiredTier = TIER_CONFIG.dashboards[dashboardId];
        if (!requiredTier) return true; // Not tier-gated = available
        return hasTierAccess(requiredTier);
    }

    /**
     * Get license status for API response / UI display
     * @returns {Object} License status summary
     */
    function getStatus() {
        const license = getLicense();

        if (!license) {
            return {
                valid: false,
                status: 'unknown',
                message: 'Unable to validate license'
            };
        }

        const tierConfig = license.tier ? TIER_CONFIG.tiers[license.tier] : null;

        return {
            valid: license.valid === true,
            status: license.status || (license.valid ? 'active' : 'invalid'),
            tier: license.tier || null,
            tierLabel: tierConfig?.label || license.tier || null,
            tierColor: tierConfig?.color || null,
            tierBadgeClass: tierConfig?.badgeClass || null,
            modules: license.modules || [],
            licensedTo: license.licensed_to || null,
            expiresAt: license.expires_at || null,
            activatedAt: license.activated_at || null,
            isOffline: license._offline === true,
            graceExpiresAt: license._graceExpiresAt || null
        };
    }

    /**
     * Get full tier configuration for UI
     * @returns {Object} All tier definitions
     */
    function getAllTiers() {
        return TIER_CONFIG.tiers;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        // Core validation
        validate: validate,
        require: require,
        isValid: isValid,
        refresh: refresh,
        getLicense: getLicense,

        // Status
        getStatus: getStatus,
        getTier: getTier,
        getTierConfig: getTierConfig,
        getAllTiers: getAllTiers,

        // Access control
        hasTierAccess: hasTierAccess,
        hasModule: hasModule,
        requireModule: requireModule,
        hasFeature: hasFeature,
        hasDashboardAccess: hasDashboardAccess
    };
});
