/**
 * Gantry.App.js
 * Application entry point - navigation setup and initialization
 *
 * LOAD ORDER: This file MUST be loaded LAST after all dashboard files
 */
(function(window) {
    'use strict';

    // ==========================================
    // NETSUITE COLOR SYNC
    // ==========================================

    /**
     * Detects NetSuite's header bar color and syncs the Gantry sidebar
     * Looks for the NetSuite navigation bar in the parent frame
     */
    function syncNetSuiteColor() {
        try {
            // Check if we're in an iframe with access to parent
            if (!window.parent || window.parent === window) {
                console.log('[Gantry] Not in iframe, using default sidebar color');
                return false;
            }

            const parentDoc = window.parent.document;

            // NetSuite header selectors to try (in order of preference)
            // These cover various NetSuite UI versions and themes
            const headerSelectors = [
                '#ns-header',                           // Modern NetSuite header
                '.ns-header',                           // Alternative class
                '#ns_navigation',                       // Navigation bar
                '.ns_navigation',                       // Navigation class
                '#nscm',                                // NetSuite Center Menu
                '.uir-page-header',                     // Classic UI header
                'header',                               // Generic header fallback
                '[data-role="header"]',                 // Data attribute header
                '.ns-role-header',                      // Role-based header
                '#spn_cMP_header',                      // Company header
                '.bglt',                                // Light background nav
                '.bgmd',                                // Medium background nav
                '.bgdk'                                 // Dark background nav
            ];

            let detectedColor = null;
            let sourceElement = null;

            // Try each selector until we find a colored element
            for (const selector of headerSelectors) {
                try {
                    const element = parentDoc.querySelector(selector);
                    if (element) {
                        const computedStyle = window.parent.getComputedStyle(element);
                        const bgColor = computedStyle.backgroundColor;

                        // Skip transparent or white backgrounds
                        if (bgColor && bgColor !== 'transparent' &&
                            bgColor !== 'rgba(0, 0, 0, 0)' &&
                            bgColor !== 'rgb(255, 255, 255)' &&
                            bgColor !== '#ffffff') {
                            detectedColor = bgColor;
                            sourceElement = selector;
                            break;
                        }
                    }
                } catch (e) {
                    // Selector failed, try next
                    continue;
                }
            }

            // If no header found, try to find any prominent colored bar at the top
            if (!detectedColor) {
                try {
                    // Look for elements in the top 100px of the page
                    const topElements = parentDoc.elementsFromPoint(
                        window.parent.innerWidth / 2,
                        50
                    );

                    for (const element of topElements) {
                        const computedStyle = window.parent.getComputedStyle(element);
                        const bgColor = computedStyle.backgroundColor;

                        // Look for a non-white, non-transparent colored background
                        if (bgColor && bgColor !== 'transparent' &&
                            bgColor !== 'rgba(0, 0, 0, 0)' &&
                            !bgColor.includes('255, 255, 255')) {

                            // Parse the color to check if it's dark enough to be a header
                            const rgb = parseRgb(bgColor);
                            if (rgb) {
                                const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
                                // Accept colors that aren't too bright (luminance < 0.85)
                                if (luminance < 0.85) {
                                    detectedColor = bgColor;
                                    sourceElement = 'elementsFromPoint';
                                    break;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.log('[Gantry] elementsFromPoint detection failed:', e.message);
                }
            }

            if (detectedColor) {
                applyDetectedColor(detectedColor);
                console.log('[Gantry] Synced sidebar with NetSuite color:', detectedColor, 'from:', sourceElement);
                return true;
            } else {
                console.log('[Gantry] No NetSuite header color detected, using defaults');
                return false;
            }

        } catch (e) {
            // Cross-origin or other access error
            console.log('[Gantry] Cannot access parent frame (cross-origin?):', e.message);
            return false;
        }
    }

    /**
     * Parse RGB color string to components
     */
    function parseRgb(color) {
        // Handle rgb(r, g, b) format
        const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return {
                r: parseInt(rgbMatch[1], 10),
                g: parseInt(rgbMatch[2], 10),
                b: parseInt(rgbMatch[3], 10)
            };
        }

        // Handle rgba(r, g, b, a) format
        const rgbaMatch = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)/);
        if (rgbaMatch) {
            return {
                r: parseInt(rgbaMatch[1], 10),
                g: parseInt(rgbaMatch[2], 10),
                b: parseInt(rgbaMatch[3], 10)
            };
        }

        // Handle hex format
        const hexMatch = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
        if (hexMatch) {
            return {
                r: parseInt(hexMatch[1], 16),
                g: parseInt(hexMatch[2], 16),
                b: parseInt(hexMatch[3], 16)
            };
        }

        return null;
    }

    /**
     * Apply detected color to sidebar CSS variables
     */
    function applyDetectedColor(color) {
        const rgb = parseRgb(color);
        if (!rgb) return;

        const root = document.documentElement;

        // Set main sidebar background
        root.style.setProperty('--sidebar-bg', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);

        // Calculate hover color (slightly lighter)
        const hoverR = Math.min(255, rgb.r + 30);
        const hoverG = Math.min(255, rgb.g + 30);
        const hoverB = Math.min(255, rgb.b + 30);
        root.style.setProperty('--sidebar-bg-hover', `rgb(${hoverR}, ${hoverG}, ${hoverB})`);

        // Calculate border color (even lighter, with some transparency for subtlety)
        const borderR = Math.min(255, rgb.r + 40);
        const borderG = Math.min(255, rgb.g + 40);
        const borderB = Math.min(255, rgb.b + 40);
        root.style.setProperty('--sidebar-border', `rgb(${borderR}, ${borderG}, ${borderB})`);

        // Store the synced color for reference
        window.GANTRY_SIDEBAR_COLOR = {
            detected: color,
            applied: {
                bg: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                hover: `rgb(${hoverR}, ${hoverG}, ${hoverB})`,
                border: `rgb(${borderR}, ${borderG}, ${borderB})`
            }
        };
    }

    // Expose sync function globally for manual re-sync if needed
    window.GantrySyncNetSuiteColor = syncNetSuiteColor;

    // ==========================================
    // INITIALIZATION
    // ==========================================
    
    // Set up navigation click handlers
    document.querySelectorAll('.gantry-nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const route = e.target.closest('a').dataset.route;
            Router.navigate(route);
        });
    });
    
    // Handle Add Category button click (delegated)
    document.addEventListener('click', function(e) {
        if (e.target && e.target.id == 'btnAddCategory') {
            ConfigController.addCategory();
        }
    });
    
    // Dark mode toggle handler
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', function() {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('gantry-dark-mode', isDark ? 'true' : 'false');
            
            // Update icon
            const icon = document.getElementById('darkModeIcon') || this.querySelector('i');
            if (icon) {
                icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
            }
        });
    }
    
    // Apply saved dark mode preference
    if (localStorage.getItem('gantry-dark-mode') === 'true') {
        document.body.classList.add('dark-mode');
        const icon = document.getElementById('darkModeIcon') || document.querySelector('#darkModeToggle i');
        if (icon) icon.className = 'fas fa-sun';
    }

    // Log loaded state
    console.log('[Gantry.App] Routes registered:', Object.keys(Router.routes));
    
    // ==========================================
    // START APPLICATION
    // ==========================================
    async function startApp() {
        // Sync sidebar color with NetSuite header (runs early for fast visual match)
        syncNetSuiteColor();

        // Default to advisor as the first route
        let defaultRoute = 'advisor';

        // Load saved settings and apply to sidebar
        if (window.SettingsController && SettingsController.loadAndApplySidebarSettings) {
            try {
                await SettingsController.loadAndApplySidebarSettings();
                
                // Check if a specific default is set in settings
                if (SettingsController.data && SettingsController.data.defaultDashboard) {
                    defaultRoute = SettingsController.data.defaultDashboard;
                }
            } catch (e) {
                console.warn('[Gantry.App] Could not load settings, using defaults', e);
            }
        }
        
        // Navigate to default route
        Router.navigate(defaultRoute);
        console.log('[Gantry.App] Started - navigated to', defaultRoute);
    }
    
    startApp();

})(window);
