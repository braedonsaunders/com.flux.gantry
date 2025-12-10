/**
 * Gantry.App.js
 * Application entry point - navigation setup and initialization
 * 
 * LOAD ORDER: This file MUST be loaded LAST after all dashboard files
 */
(function(window) {
    'use strict';

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
