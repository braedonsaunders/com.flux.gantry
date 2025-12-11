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

            // NetSuite header container selectors
            const headerContainers = [
                '#div__header',                         // Redwood theme header
                '#ns-header',                           // Modern NetSuite header
                '#ns_navigation',                       // Navigation bar
                '.uir-page-header',                     // Classic UI header
                '#nscm',                                // NetSuite Center Menu
            ];

            let detectedColor = null;
            let sourceElement = null;
            let sourceDoc = null;

            // Try each document
            for (const { doc, win, name } of docs) {
                if (detectedColor) break;

                // Strategy: Find header container, then scan ALL descendants for actual colored element
                for (const containerSelector of headerContainers) {
                    if (detectedColor) break;

                    try {
                        const container = doc.querySelector(containerSelector);
                        if (!container) continue;

                        // Scan all descendants for the actual colored navigation bar
                        const allElements = container.querySelectorAll('*');
                        for (const element of allElements) {
                            // Skip skeleton/placeholder elements
                            if (element.id && element.id.includes('skeleton')) continue;
                            if (element.classList && element.classList.contains('bgoff')) continue;

                            const computedStyle = win.getComputedStyle(element);
                            const bgColor = computedStyle.backgroundColor;

                            // Skip transparent or light/grey backgrounds - we want the COLORED nav bar
                            if (bgColor && bgColor !== 'transparent' &&
                                bgColor !== 'rgba(0, 0, 0, 0)' &&
                                !isLightOrGrey(bgColor)) {
                                detectedColor = bgColor;
                                sourceElement = `${containerSelector} descendant`;
                                sourceDoc = name;
                                break;
                            }
                        }
                    } catch (e) {
                        continue;
                    }
                }

                // Fallback: try elementsFromPoint at nav bar height (~80px down)
                if (!detectedColor) {
                    try {
                        // Try multiple Y positions to find the nav bar
                        for (const yPos of [80, 60, 100, 40]) {
                            if (detectedColor) break;
                            const elements = doc.elementsFromPoint(win.innerWidth / 2, yPos);
                            for (const element of elements) {
                                if (element.tagName === 'BODY' || element.tagName === 'HTML') continue;
                                if (element.id && element.id.includes('skeleton')) continue;

                                const computedStyle = win.getComputedStyle(element);
                                const bgColor = computedStyle.backgroundColor;

                                if (bgColor && bgColor !== 'transparent' &&
                                    bgColor !== 'rgba(0, 0, 0, 0)' &&
                                    !isLightOrGrey(bgColor)) {
                                    detectedColor = bgColor;
                                    sourceElement = `elementsFromPoint y=${yPos}`;
                                    sourceDoc = name;
                                    break;
                                }
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

            return false;

        } catch (e) {
            console.log('[Gantry] Color sync error:', e.message);
            return false;
        }
    }

    /**
     * Retry color detection with exponential backoff for async-loaded themes (Redwood)
     */
    function syncNetSuiteColorWithRetry(maxRetries = 5, initialDelay = 100) {
        let attempts = 0;

        function attempt() {
            attempts++;
            const success = syncNetSuiteColor();

            if (success) {
                console.log('[Gantry] Color sync succeeded on attempt', attempts);
                return;
            }

            if (attempts < maxRetries) {
                const delay = initialDelay * Math.pow(2, attempts - 1); // 100, 200, 400, 800, 1600ms
                console.log('[Gantry] Color detection attempt', attempts, 'failed, retrying in', delay + 'ms');
                setTimeout(attempt, delay);
            } else {
                console.log('[Gantry] No NetSuite header color detected after', maxRetries, 'attempts, using defaults');
                // Apply default dark sidebar
                applyDetectedColor('rgb(30, 41, 59)');
            }
        }

        attempt();
    }

    /**
     * Check if a color is light or grey (for filtering out container backgrounds)
     * We want to skip light greys, whites, and unsaturated colors
     */
    function isLightOrGrey(color) {
        const rgb = parseRgb(color);
        if (!rgb) return false;

        const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
        const max = Math.max(rgb.r, rgb.g, rgb.b);
        const min = Math.min(rgb.r, rgb.g, rgb.b);
        const saturation = max === 0 ? 0 : (max - min) / max;

        // Skip if too light (luminance > 0.85) - catches light greys and whites
        if (luminance > 0.85) return true;

        // Skip if very unsaturated (grey) AND light
        if (saturation < 0.15 && luminance > 0.5) return true;

        return false;
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
     * Adjust color brightness by a percentage (-1 to 1, negative = darker, positive = lighter)
     */
    function adjustBrightness(rgb, amount) {
        if (amount < 0) {
            // Darken: multiply each channel
            const factor = 1 + amount;
            return {
                r: Math.round(Math.max(0, rgb.r * factor)),
                g: Math.round(Math.max(0, rgb.g * factor)),
                b: Math.round(Math.max(0, rgb.b * factor))
            };
        } else {
            // Lighten: move toward 255
            return {
                r: Math.round(Math.min(255, rgb.r + (255 - rgb.r) * amount)),
                g: Math.round(Math.min(255, rgb.g + (255 - rgb.g) * amount)),
                b: Math.round(Math.min(255, rgb.b + (255 - rgb.b) * amount))
            };
        }
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

        // Adjust sidebar to be 15% lighter than detected nav bar color
        // This creates visual distinction while maintaining the color theme
        const sidebarRgb = adjustBrightness(rgb, 0.15);

        // Apply the adjusted color as sidebar background
        root.style.setProperty('--sidebar-bg', `rgb(${sidebarRgb.r}, ${sidebarRgb.g}, ${sidebarRgb.b})`);

        // Check luminance of the SIDEBAR color (after lightening) for text contrast
        const sidebarLuminance = getLuminance(sidebarRgb);
        const needsLightTheme = sidebarLuminance > 0.5;

        // Calculate hover and border colors from the adjusted sidebar color
        let hoverRgb, borderRgb;

        const sidebar = document.querySelector('.gantry-sidebar');

        if (needsLightTheme) {
            // Light sidebar: darken for hover/border, use dark text
            hoverRgb = adjustBrightness(sidebarRgb, -0.08);
            borderRgb = adjustBrightness(sidebarRgb, -0.12);
            sidebar?.classList.add('light-theme');
        } else {
            // Dark sidebar: lighten for hover/border, use light text
            hoverRgb = adjustBrightness(sidebarRgb, 0.15);
            borderRgb = adjustBrightness(sidebarRgb, 0.20);
            sidebar?.classList.remove('light-theme');
        }

        root.style.setProperty('--sidebar-bg-hover', `rgb(${hoverRgb.r}, ${hoverRgb.g}, ${hoverRgb.b})`);
        root.style.setProperty('--sidebar-border', `rgb(${borderRgb.r}, ${borderRgb.g}, ${borderRgb.b})`);

        // Store the synced color for reference/debugging
        window.GANTRY_SIDEBAR_COLOR = {
            detected: color,
            detectedRgb: rgb,
            detectedLuminance: luminance,
            sidebarLuminance: sidebarLuminance,
            needsLightTheme: needsLightTheme,
            applied: {
                bg: `rgb(${sidebarRgb.r}, ${sidebarRgb.g}, ${sidebarRgb.b})`,
                hover: `rgb(${hoverRgb.r}, ${hoverRgb.g}, ${hoverRgb.b})`,
                border: `rgb(${borderRgb.r}, ${borderRgb.g}, ${borderRgb.b})`
            }
        };

        // Mark that color is ready (sidebar reveal happens in DOM init section)
        window.GANTRY_COLOR_READY = true;

        // Try to reveal sidebar if DOM is already ready
        const sidebarEl = document.querySelector('.gantry-sidebar');
        if (sidebarEl && !sidebarEl.classList.contains('sidebar-ready')) {
            requestAnimationFrame(() => {
                sidebarEl.classList.add('sidebar-ready');
                console.log('[Gantry] Sidebar revealed with synced color');
            });
        }

        return true;
    }

    // Expose sync function globally for manual re-sync if needed
    window.GantrySyncNetSuiteColor = syncNetSuiteColor;

    // Run color detection IMMEDIATELY (before DOM setup) for fastest visual match
    syncNetSuiteColorWithRetry();

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
    const sidebarHeader = document.querySelector('.gantry-sidebar-header');

    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', function(e) {
            e.stopPropagation(); // Prevent header click from firing
            sidebar.classList.toggle('collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem('gantry-sidebar-collapsed', isCollapsed ? 'true' : 'false');
            this.title = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
        });
    }

    // Click header/logo to expand when collapsed
    if (sidebarHeader && sidebar) {
        sidebarHeader.addEventListener('click', function(e) {
            // Only expand if currently collapsed and not clicking the toggle button
            if (sidebar.classList.contains('collapsed') && !e.target.closest('.gantry-sidebar-toggle')) {
                sidebar.classList.remove('collapsed');
                localStorage.setItem('gantry-sidebar-collapsed', 'false');
                if (sidebarToggle) sidebarToggle.title = 'Collapse sidebar';
            }
        });
    }

    // Apply saved sidebar collapsed preference
    if (localStorage.getItem('gantry-sidebar-collapsed') === 'true') {
        if (sidebar) {
            sidebar.classList.add('collapsed');
            if (sidebarToggle) sidebarToggle.title = 'Expand sidebar';
        }
    }

    // === SIDEBAR REVEAL FALLBACK ===
    // If color was already detected before DOM was ready, reveal sidebar now
    if (sidebar && window.GANTRY_COLOR_READY && !sidebar.classList.contains('sidebar-ready')) {
        requestAnimationFrame(() => {
            sidebar.classList.add('sidebar-ready');
            console.log('[Gantry] Sidebar revealed (DOM init fallback)');
        });
    }

    // Log loaded state
    console.log('[Gantry.App] Routes registered:', Object.keys(Router.routes));
    
    // ==========================================
    // DEBUG: DOM/CSS VISIBILITY DIAGNOSTICS
    // ==========================================
    function debugLayoutVisibility() {
        console.group('[Gantry.Debug] Layout Visibility Diagnostics');

        const elements = {
            'body': document.body,
            '.gantry-wrapper': document.querySelector('.gantry-wrapper'),
            '.gantry-sidebar': document.querySelector('.gantry-sidebar'),
            '.gantry-main': document.querySelector('.gantry-main'),
            '#gantry-view-container': document.getElementById('gantry-view-container'),
            '#gantry-loading-screen': document.getElementById('gantry-loading-screen')
        };

        for (const [selector, el] of Object.entries(elements)) {
            if (!el) {
                console.warn(`  ${selector}: NOT FOUND`);
                continue;
            }

            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();

            console.log(`  ${selector}:`, {
                exists: true,
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                transform: style.transform,
                position: style.position,
                zIndex: style.zIndex,
                width: rect.width,
                height: rect.height,
                top: rect.top,
                left: rect.left,
                classList: [...el.classList],
                childCount: el.children.length
            });
        }

        // Check if sidebar-ready class is applied
        const sidebar = document.querySelector('.gantry-sidebar');
        if (sidebar) {
            console.log('  Sidebar has sidebar-ready:', sidebar.classList.contains('sidebar-ready'));
        }

        // Check view container content
        const viewContainer = document.getElementById('gantry-view-container');
        if (viewContainer) {
            console.log('  View container innerHTML length:', viewContainer.innerHTML.length);
            console.log('  View container first 200 chars:', viewContainer.innerHTML.substring(0, 200));
        }

        // Check for any elements with problematic styles
        const wrapper = document.querySelector('.gantry-wrapper');
        if (wrapper) {
            const wrapperStyle = window.getComputedStyle(wrapper);
            if (wrapperStyle.display === 'none' || wrapperStyle.visibility === 'hidden' || parseFloat(wrapperStyle.opacity) === 0) {
                console.error('  WARNING: .gantry-wrapper is hidden!');
            }
        }

        console.groupEnd();
    }

    // ==========================================
    // START APPLICATION
    // ==========================================
    async function startApp() {
        console.log('[Gantry.App] startApp() called');

        // === FINAL SIDEBAR REVEAL SAFETY NET ===
        // Ensure sidebar is visible before showing app content
        const sidebarFinal = document.querySelector('.gantry-sidebar');
        if (sidebarFinal && !sidebarFinal.classList.contains('sidebar-ready')) {
            sidebarFinal.classList.add('sidebar-ready');
            console.log('[Gantry] Sidebar revealed (startApp safety net)');
        }

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
        console.log('[Gantry.App] About to navigate to:', defaultRoute);
        Router.navigate(defaultRoute);
        console.log('[Gantry.App] Started - navigated to', defaultRoute);

        // === HIDE LOADING SCREEN ===
        // Fade out the loading screen after app is initialized
        const loadingScreen = document.getElementById('gantry-loading-screen');
        if (loadingScreen) {
            // Small delay to ensure first paint of dashboard content
            setTimeout(() => {
                loadingScreen.classList.add('hidden');
                console.log('[Gantry.App] Loading screen hidden');

                // Remove from DOM after animation completes
                setTimeout(() => {
                    loadingScreen.remove();

                    // Run diagnostics after everything should be visible
                    console.log('[Gantry.App] Running post-load diagnostics...');
                    debugLayoutVisibility();
                }, 500);
            }, 100);
        } else {
            console.warn('[Gantry.App] Loading screen element not found');
            // Run diagnostics anyway
            debugLayoutVisibility();
        }
    }

    // Expose debug function globally for manual testing
    window.GantryDebugLayout = debugLayoutVisibility;

    startApp();

})(window);
