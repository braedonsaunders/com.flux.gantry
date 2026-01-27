/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 * @module Gantry_Suitelet
 * @description Main Suitelet for Gantry Financial Suite
 *              Uses iframe to preserve NetSuite menu while serving app
 * 
 * DEPLOYMENT REQUIREMENTS:
 * - This Suitelet: ID = customscript_gantry_suitelet, Deploy ID = customdeploy_gantry_suitelet
 * - Router Restlet: ID = customscript_gantry_router, Deploy ID = customdeploy_gantry_router
 */
define([
    'N/file',
    'N/ui/serverWidget',
    'N/url',
    'N/runtime',
    'N/log',
    'N/search',
    '../lib/Lib_Permissions',
    '../lib/Lib_LicenseGuard'
], function(file, serverWidget, url, runtime, log, search, Permissions, LicenseGuard) {
    'use strict';

    /**
     * Configuration - uses string IDs for portability across NetSuite instances
     */
    const CONFIG = {
        // Router Restlet - MUST use these exact IDs when deploying
        routerScriptId: 'customscript_gantry_router',
        routerDeploymentId: 'customdeploy_gantry_router'
    };

    // Cached base path (detected at runtime)
    let _cachedBasePath = null;

    /**
     * Dynamically detect the base path by looking up the script's own file location.
     * This handles both SuiteApps installations and SuiteBundle installations.
     * - SuiteApps: SuiteApps/com.gantry.finance
     * - SuiteBundle: SuiteBundles/Bundle XXXXX/com.gantry.finance
     */
    function getBasePath() {
        if (_cachedBasePath) {
            return _cachedBasePath;
        }

        // Method 1: Look up the current script's file to get the path
        try {
            const currentScript = runtime.getCurrentScript();
            log.debug('Current Script ID', currentScript.id);

            // Search for the script record to get its file
            const scriptSearch = search.create({
                type: search.Type.SCRIPT,
                filters: [['scriptid', 'is', currentScript.id]],
                columns: ['scriptfile']
            });

            const scriptResults = scriptSearch.run().getRange({ start: 0, end: 1 });
            if (scriptResults.length > 0) {
                const scriptFileId = scriptResults[0].getValue('scriptfile');
                log.debug('Script File ID', scriptFileId);

                const scriptFile = file.load({ id: scriptFileId });
                const fullPath = scriptFile.path;
                log.debug('Script File Path', fullPath);

                // Path will be like '/SuiteBundles/Bundle 590174/com.gantry.finance/suitelet/Gantry_Suitelet.js'
                // Extract base path by removing '/suitelet/Gantry_Suitelet.js'
                _cachedBasePath = fullPath.replace(/^\//, '').replace(/\/suitelet\/Gantry_Suitelet\.js$/i, '');
                log.debug('Detected Base Path', _cachedBasePath);
                return _cachedBasePath;
            }
        } catch (e) {
            log.error('Script File Lookup Failed', { message: e.message, stack: e.stack });
        }

        // Method 2: Fallback - try direct file load to test SuiteApps path
        try {
            file.load({ id: 'SuiteApps/com.gantry.finance/App/gantry_index.html' });
            _cachedBasePath = 'SuiteApps/com.gantry.finance';
            log.debug('Using SuiteApps Path (verified)', _cachedBasePath);
            return _cachedBasePath;
        } catch (e) {
            log.debug('SuiteApps path not found', e.message);
        }

        // Method 3: Final fallback
        _cachedBasePath = 'SuiteApps/com.gantry.finance';
        log.audit('Using Fallback Base Path (unverified)', _cachedBasePath);
        return _cachedBasePath;
    }

    /**
     * File manifest for dev mode - maps script keys to file paths
     */
    const FILE_MANIFEST = {
        // CSS - Individual modules (loaded in order)
        'css_base': 'App/css/base.css',
        'css_components': 'App/css/components.css',
        'css_widgets': 'App/css/widgets.css',
        'css_dark_mode': 'App/css/dark-mode.css',
        'css_advisor': 'App/css/advisor.css',
        'css_financial_vitals': 'App/css/financial-vitals.css',
        'css_financial_statements': 'App/css/financial-statements.css',
        'css_pivot_tables': 'App/css/pivot-tables.css',
        'css_integrity': 'App/css/integrity.css',
        'css_vendor_performance': 'App/css/vendor-performance.css',
        'css_customer_value': 'App/css/customer-value.css',
        'css_spend_velocity': 'App/css/spend-velocity.css',
        'css_burden': 'App/css/burden.css',
        'css_health': 'App/css/health.css',
        'css_cashflow': 'App/css/cashflow.css',
        
        // Core
        'core/Gantry.Core.js': 'client/core/Gantry.Core.js',
        
        // Dashboard controllers
        'dashboards/Dashboard.Cashflow.js': 'client/dashboards/Dashboard.Cashflow.js',
        'dashboards/Dashboard.Health.js': 'client/dashboards/Dashboard.Health.js',
        'dashboards/Dashboard.Time.js': 'client/dashboards/Dashboard.Time.js',
        'dashboards/Dashboard.Burden.js': 'client/dashboards/Dashboard.Burden.js',
        'dashboards/Dashboard.Integrity.js': 'client/dashboards/Dashboard.Integrity.js',
        'dashboards/Dashboard.VendorPerformance.js': 'client/dashboards/Dashboard.VendorPerformance.js',
        'dashboards/Dashboard.CustomerValue.js': 'client/dashboards/Dashboard.CustomerValue.js',
        'dashboards/Dashboard.SpendVelocity.js': 'client/dashboards/Dashboard.SpendVelocity.js',
        'dashboards/Dashboard.Settings.js': 'client/dashboards/Dashboard.Settings.js',
        'dashboards/Dashboard.Advisor.js': 'client/dashboards/Dashboard.Advisor.js',
        
        // Advisor client scripts
        'advisor/Gantry.AdvisorRenderer.js': 'client/advisor/Gantry.AdvisorRenderer.js',
        
        // App entry
        'Gantry.App.js': 'client/Gantry.App.js',
        
        // Bundle (for production mode)
        'bundle': 'App/gantry_bundle.js'
    };

    /**
     * Handle Suitelet requests
     */
    function onRequest(context) {
        if (context.request.method !== 'GET') {
            context.response.write('Method not allowed');
            return;
        }

        try {
            const isInnerFrame = context.request.parameters.gantry_mode === 'app';

            if (isInnerFrame) {
                serveAppContent(context);
            } else {
                serveWrapper(context);
            }
        } catch (e) {
            log.error('Suitelet Error', { message: e.message, stack: e.stack });
            context.response.write('Error loading application: ' + e.message);
        }
    }

    /**
     * MODE 1: APP CONTENT (Raw HTML inside Iframe)
     */
    function serveAppContent(context) {
        // 1. Resolve Router Restlet URL
        const routerUrl = resolveRouterUrl();
        log.debug('Router URL', routerUrl);

        // 2. Validate license (non-blocking)
        let licenseStatus = null;
        try {
            licenseStatus = LicenseGuard.getStatus();
        } catch (e) {
            log.error('License Validation Error', e.message);
            licenseStatus = { valid: false, status: 'error', message: e.message };
        }

        // 3. Resolve file URLs for all scripts
        const fileUrls = resolveFileUrls();

        // 4. Load HTML Template
        const htmlPath = getBasePath() + '/App/gantry_index.html';
        const htmlFile = file.load({ id: htmlPath });
        let htmlContent = htmlFile.getContents();

        // 4. Replace CSS placeholders with actual URLs (individual modules)
        htmlContent = htmlContent.replace('{{CSS_BASE_URL}}', fileUrls['css_base'] || '');
        htmlContent = htmlContent.replace('{{CSS_COMPONENTS_URL}}', fileUrls['css_components'] || '');
        htmlContent = htmlContent.replace('{{CSS_WIDGETS_URL}}', fileUrls['css_widgets'] || '');
        htmlContent = htmlContent.replace('{{CSS_DARK_MODE_URL}}', fileUrls['css_dark_mode'] || '');
        htmlContent = htmlContent.replace('{{CSS_ADVISOR_URL}}', fileUrls['css_advisor'] || '');
        htmlContent = htmlContent.replace('{{CSS_FINANCIAL_VITALS_URL}}', fileUrls['css_financial_vitals'] || '');
        htmlContent = htmlContent.replace('{{CSS_FINANCIAL_STATEMENTS_URL}}', fileUrls['css_financial_statements'] || '');
        htmlContent = htmlContent.replace('{{CSS_PIVOT_TABLES_URL}}', fileUrls['css_pivot_tables'] || '');
        htmlContent = htmlContent.replace('{{CSS_INTEGRITY_URL}}', fileUrls['css_integrity'] || '');
        htmlContent = htmlContent.replace('{{CSS_VENDOR_PERFORMANCE_URL}}', fileUrls['css_vendor_performance'] || '');
        htmlContent = htmlContent.replace('{{CSS_CUSTOMER_VALUE_URL}}', fileUrls['css_customer_value'] || '');
        htmlContent = htmlContent.replace('{{CSS_SPEND_VELOCITY_URL}}', fileUrls['css_spend_velocity'] || '');
        htmlContent = htmlContent.replace('{{CSS_BURDEN_URL}}', fileUrls['css_burden'] || '');
        htmlContent = htmlContent.replace('{{CSS_HEALTH_URL}}', fileUrls['css_health'] || '');
        htmlContent = htmlContent.replace('{{CSS_CASHFLOW_URL}}', fileUrls['css_cashflow'] || '');
      
        // 6. Build configuration injection
        const currentUser = runtime.getCurrentUser();
        const accountId = runtime.accountId;

        // Get user permissions context
        const userPermissions = Permissions.getCurrentUserContext();

        const configScript = `
    <script>
        // Gantry Configuration - Injected by Suitelet
        window.GANTRY_API_URL = "${routerUrl}";
        window.NS_ACCOUNT_ID = "${accountId}";

        window.GANTRY_CONFIG = {
            apiUrl: "${routerUrl}",
            accountId: "${accountId}",
            user: {
                id: "${currentUser.id}",
                name: "${currentUser.name}",
                role: ${currentUser.role},
                subsidiary: ${currentUser.subsidiary || 'null'},
                isAdmin: ${userPermissions.isAdmin}
            },
            permissions: {
                enabled: ${userPermissions.permissionsEnabled},
                dashboards: ${JSON.stringify(userPermissions.permittedDashboards)},
                subsidiaries: ${JSON.stringify(userPermissions.permittedSubsidiaries)},
                isAdmin: ${userPermissions.isAdmin}
            },
            license: ${JSON.stringify(licenseStatus)},
            version: "2.1.0",
            buildDate: "${new Date().toISOString().split('T')[0]}",
            features: {
                advisor: true,
                vendorPerformance: true,
                customerValue: true
            }
        };

        // File URLs for dev mode
        window.GANTRY_FILE_URLS = ${JSON.stringify(fileUrls)};
    </script>`;

        // 6. Inject configuration before </head>
        htmlContent = htmlContent.replace('</head>', configScript + '\n</head>');

        // 7. Serve Raw HTML
        context.response.write(htmlContent);
    }

    /**
     * MODE 2: NETSUITE WRAPPER (Preserves Menu, No Grey Bar)
     */
    function serveWrapper(context) {
        const form = serverWidget.createForm({ title: 'Gantry' });
        
        // Get the URL of *this* Suitelet with app mode flag
        const currentScript = runtime.getCurrentScript();
        const suiteletUrl = url.resolveScript({
            scriptId: currentScript.id,
            deploymentId: currentScript.deploymentId
        }) + '&gantry_mode=app';

        // Add an Inline HTML field to host the Iframe
        const field = form.addField({
            id: 'custpage_gantry_frame',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });

        // Styling for full-width iframe below NS header (no grey bar)
        // Use visibility:hidden (not opacity:0) so descendants can override with visibility:visible
        field.defaultValue = `
            <style>
                /* === Hide form title elements without breaking iframe === */
                /* IMPORTANT: Use visibility:hidden (not opacity:0) because:
                   - opacity:0 on parent makes ALL descendants invisible (cannot be overridden)
                   - visibility:hidden CAN be overridden by descendants with visibility:visible
                   This keeps elements in DOM flow so NS can reference them (for highlightElementId) */
                #main_form > table:first-child,
                .uir-page-title-secondline,
                .uir-page-title,
                .uir-page-title-firstline,
                #main_form > tbody > tr:first-child,
                #main_form > table > tbody > tr:first-child {
                    visibility: hidden !important;
                    pointer-events: none !important;
                    height: 0 !important;
                    min-height: 0 !important;
                    max-height: 0 !important;
                    overflow: visible !important; /* Allow positioned children to escape */
                    padding: 0 !important;
                    margin: 0 !important;
                    border: none !important;
                    line-height: 0 !important;
                    font-size: 0 !important;
                }

                /* Iframe container - full width, positioned below NS header */
                .gantry-frame-wrapper {
                    position: fixed;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    top: 103px; /* Fallback, will be overridden by JS */
                    width: 100vw;
                    z-index: 100;
                    /* Override inherited styles from NetSuite's anti-flash CSS */
                    visibility: visible !important;
                    opacity: 1 !important;
                    pointer-events: auto !important;
                }

                .gantry-iframe {
                    width: 100%;
                    height: 100%;
                    border: none;
                    display: block;
                    visibility: visible !important;
                    opacity: 1 !important;
                    pointer-events: auto !important;
                }
            </style>
            <div class="gantry-frame-wrapper">
                <iframe
                    src="${suiteletUrl}"
                    class="gantry-iframe"
                    title="Gantry Financial Suite"
                ></iframe>
            </div>
            <script>
                (function() {
                    /**
                     * Detect NetSuite header bottom position and adjust iframe accordingly
                     */
                    function adjustIframePosition() {
                        var wrapper = document.querySelector('.gantry-frame-wrapper');
                        if (!wrapper) return false;

                        // NetSuite header selectors (order matters - most specific first)
                        var headerSelectors = [
                            '#div__header',           // Redwood theme header
                            '#ns-header',             // Modern NetSuite header
                            '#ns_navigation',         // Navigation bar
                            '.uir-page-header',       // Classic UI header
                            '#nscm'                   // NetSuite Center Menu
                        ];

                        var headerBottom = 0;

                        // Try each selector to find the header
                        for (var i = 0; i < headerSelectors.length; i++) {
                            var header = document.querySelector(headerSelectors[i]);
                            if (header) {
                                var rect = header.getBoundingClientRect();
                                // Use the highest bottom value found (in case of nested headers)
                                if (rect.bottom > headerBottom) {
                                    headerBottom = rect.bottom;
                                }
                            }
                        }

                        // Fallback: scan for navigation elements by checking elements at top of page
                        if (headerBottom === 0) {
                            var yPositions = [40, 60, 80, 100];
                            for (var j = 0; j < yPositions.length; j++) {
                                var elements = document.elementsFromPoint(window.innerWidth / 2, yPositions[j]);
                                for (var k = 0; k < elements.length; k++) {
                                    var el = elements[k];
                                    if (el.tagName === 'BODY' || el.tagName === 'HTML') continue;
                                    var rect = el.getBoundingClientRect();
                                    if (rect.bottom > headerBottom && rect.bottom < 200) {
                                        headerBottom = rect.bottom;
                                    }
                                }
                            }
                        }

                        // Apply detected position (minimum 80px, maximum 120px for safety)
                        if (headerBottom > 0) {
                            headerBottom = Math.max(80, Math.min(120, headerBottom));
                            wrapper.style.top = headerBottom + 'px';
                            return true;
                        }

                        return false;
                    }

                    // Run immediately
                    var success = adjustIframePosition();

                    // Retry with delays for async-loading themes (like Redwood)
                    if (!success) {
                        var retries = [100, 200, 400, 800];
                        retries.forEach(function(delay) {
                            setTimeout(adjustIframePosition, delay);
                        });
                    }

                    // Also adjust on window resize
                    window.addEventListener('resize', adjustIframePosition);
                })();
            </script>
        `;

        context.response.writePage(form);
    }

    /**
     * Resolve File Cabinet URLs for all script files
     */
    function resolveFileUrls() {
        const fileUrls = {};
        
        Object.keys(FILE_MANIFEST).forEach(function(key) {
            const relativePath = FILE_MANIFEST[key];
            const fullPath = getBasePath() + '/' + relativePath;
            
            try {
                const fileObj = file.load({ id: fullPath });
                fileUrls[key] = fileObj.url;
            } catch (e) {
                log.error('Failed to resolve file URL', { key: key, path: fullPath, error: e.message });
                fileUrls[key] = null;
            }
        });
        
        return fileUrls;
    }

    /**
     * Resolve the Router Restlet URL using string IDs
     */
    function resolveRouterUrl() {
        try {
            return url.resolveScript({
                scriptId: CONFIG.routerScriptId,
                deploymentId: CONFIG.routerDeploymentId
            });
        } catch (e) {
            log.error('Router URL Resolution Failed', {
                error: e.message,
                expectedScriptId: CONFIG.routerScriptId,
                expectedDeploymentId: CONFIG.routerDeploymentId
            });
            throw new Error(
                'Could not resolve Router URL. ' +
                'Ensure the Router Restlet has Script ID "' + CONFIG.routerScriptId + '" ' +
                'and Deployment ID "' + CONFIG.routerDeploymentId + '"'
            );
        }
    }

    return {
        onRequest: onRequest
    };
});