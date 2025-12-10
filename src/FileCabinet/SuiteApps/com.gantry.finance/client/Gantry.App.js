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
     * Works whether Gantry is in an iframe or embedded directly
     */
    function syncNetSuiteColor() {
        try {
            // Try parent document first, fall back to current document
            const docs = [];
            try {
                if (window.parent && window.parent.document) {
                    docs.push({ doc: window.parent.document, win: window.parent, name: 'parent' });
                }
            } catch (e) {
                // Cross-origin, can't access parent
            }
            docs.push({ doc: document, win: window, name: 'current' });

            // NetSuite header selectors - includes Redwood theme classes
            const headerSelectors = [
                '.div__header',                         // Redwood theme header (BEM style)
                '.ns-child-component.div__header',      // Redwood with ns-child-component
                '[class*="div__header"]',               // Any header class
                '#ns-header',                           // Modern NetSuite header
                '.ns-header',                           // Alternative class
                '#ns_navigation',                       // Navigation bar
                '.ns_navigation',                       // Navigation class
                '.uir-page-header',                     // Classic UI header
                '#nscm',                                // NetSuite Center Menu
                '.ns-role-header',                      // Role-based header
                '[data-role="header"]',                 // Data attribute header
                '.bgdk',                                // Dark background nav
                '.bgmd',                                // Medium background nav
                '.bglt'                                 // Light background nav
            ];

            let detectedColor = null;
            let sourceElement = null;
            let sourceDoc = null;

            // Try each document
            for (const { doc, win, name } of docs) {
                if (detectedColor) break;

                // Try each selector
                for (const selector of headerSelectors) {
                    try {
                        const element = doc.querySelector(selector);
                        if (element) {
                            const computedStyle = win.getComputedStyle(element);
                            const bgColor = computedStyle.backgroundColor;

                            // Skip transparent or pure white backgrounds
                            if (bgColor && bgColor !== 'transparent' &&
                                bgColor !== 'rgba(0, 0, 0, 0)' &&
                                bgColor !== 'rgb(255, 255, 255)') {
                                detectedColor = bgColor;
                                sourceElement = selector;
                                sourceDoc = name;
                                break;
                            }
                        }
                    } catch (e) {
                        continue;
                    }
                }

                // If no selector matched, try elementsFromPoint
                if (!detectedColor) {
                    try {
                        const topElements = doc.elementsFromPoint(win.innerWidth / 2, 50);
                        for (const element of topElements) {
                            // Skip body/html
                            if (element.tagName === 'BODY' || element.tagName === 'HTML') continue;

                            const computedStyle = win.getComputedStyle(element);
                            const bgColor = computedStyle.backgroundColor;

                            if (bgColor && bgColor !== 'transparent' &&
                                bgColor !== 'rgba(0, 0, 0, 0)' &&
                                bgColor !== 'rgb(255, 255, 255)') {
                                detectedColor = bgColor;
                                sourceElement = `elementsFromPoint (${element.className || element.tagName})`;
                                sourceDoc = name;
                                break;
                            }
                        }
                    } catch (e) {
                        // elementsFromPoint failed
                    }
                }
            }

            if (detectedColor) {
                const applied = applyDetectedColor(detectedColor);
                if (applied) {
                    console.log('[Gantry] Synced sidebar with NetSuite color:', detectedColor, 'from:', sourceElement, `(${sourceDoc})`);
                    return true;
                }
            }

            console.log('[Gantry] No suitable NetSuite header color detected, using defaults');
            return false;

        } catch (e) {
            console.log('[Gantry] Color sync error:', e.message);
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
     * Calculate relative luminance (0 = black, 1 = white)
     */
    function getLuminance(rgb) {
        return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    }

    /**
     * Apply detected color to sidebar CSS variables
     * Returns true if color was applied, false if skipped
     */
    function applyDetectedColor(color) {
        const rgb = parseRgb(color);
        if (!rgb) return false;

        const luminance = getLuminance(rgb);
        const isLightTheme = luminance > 0.5;
        const root = document.documentElement;

        // Apply the detected color as sidebar background
        root.style.setProperty('--sidebar-bg', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);

        // For light themes: darken for hover/borders, use dark text
        // For dark themes: lighten for hover/borders, use light text
        let hoverR, hoverG, hoverB, borderR, borderG, borderB;

        if (isLightTheme) {
            // Light theme: darken for hover/border states
            hoverR = Math.max(0, rgb.r - 15);
            hoverG = Math.max(0, rgb.g - 15);
            hoverB = Math.max(0, rgb.b - 15);
            borderR = Math.max(0, rgb.r - 25);
            borderG = Math.max(0, rgb.g - 25);
            borderB = Math.max(0, rgb.b - 25);

            // Add light-sidebar class for text color adjustments
            document.querySelector('.gantry-sidebar')?.classList.add('light-theme');
        } else {
            // Dark theme: lighten for hover/border states
            hoverR = Math.min(255, rgb.r + 30);
            hoverG = Math.min(255, rgb.g + 30);
            hoverB = Math.min(255, rgb.b + 30);
            borderR = Math.min(255, rgb.r + 40);
            borderG = Math.min(255, rgb.g + 40);
            borderB = Math.min(255, rgb.b + 40);

            // Remove light-sidebar class if present
            document.querySelector('.gantry-sidebar')?.classList.remove('light-theme');
        }

        root.style.setProperty('--sidebar-bg-hover', `rgb(${hoverR}, ${hoverG}, ${hoverB})`);
        root.style.setProperty('--sidebar-border', `rgb(${borderR}, ${borderG}, ${borderB})`);

        // Store the synced color for reference
        window.GANTRY_SIDEBAR_COLOR = {
            detected: color,
            luminance: luminance,
            isLightTheme: isLightTheme,
            applied: {
                bg: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                hover: `rgb(${hoverR}, ${hoverG}, ${hoverB})`,
                border: `rgb(${borderR}, ${borderG}, ${borderB})`
            }
        };

        return true;
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

    // Sidebar collapse toggle handler
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.gantry-sidebar');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', function() {
            sidebar.classList.toggle('collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem('gantry-sidebar-collapsed', isCollapsed ? 'true' : 'false');

            // Update button title
            this.title = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
        });
    }

    // Apply saved sidebar collapsed preference
    if (localStorage.getItem('gantry-sidebar-collapsed') === 'true') {
        if (sidebar) {
            sidebar.classList.add('collapsed');
            if (sidebarToggle) sidebarToggle.title = 'Expand sidebar';
        }
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
