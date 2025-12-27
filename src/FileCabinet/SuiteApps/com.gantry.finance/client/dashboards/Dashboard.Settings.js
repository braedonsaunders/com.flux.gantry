/**
 * Dashboard.Settings.js
 * Global Application Settings Controller
 *
 * Uses a declarative SETTINGS_SCHEMA with tabs for easy extensibility.
 * Add new settings by simply extending the schema.
 */
(function(window) {
    'use strict';

    // ==========================================
    // SETTINGS SCHEMA - Tab-based organization
    // ==========================================
    const SETTINGS_SCHEMA = {
        // Dashboard definitions
        dashboards: [
            { id: 'advisor', icon: 'fa-robot', color: 'text-primary', defaultName: 'Advisor', route: 'advisor' },
            { id: 'cashflow', icon: 'fa-money-bill-wave', color: 'text-success', defaultName: 'Liquidity', route: 'cashflow' },
            { id: 'health', icon: 'fa-heartbeat', color: 'text-danger', defaultName: 'P&L', route: 'health' },
            { id: 'burden', icon: 'fa-weight-hanging', color: 'text-warning', defaultName: 'True Cost', route: 'burden' },
            { id: 'time', icon: 'fa-clock', color: 'text-info', defaultName: 'Billable IQ', route: 'time' },
            { id: 'integrity', icon: 'fa-shield-alt', color: 'text-danger', defaultName: 'Sentinel', route: 'integrity' },
            { id: 'vendorperformance', icon: 'fa-handshake', color: 'text-purple', defaultName: 'Procurement', route: 'vendorperformance' },
            { id: 'customervalue', icon: 'fa-users', color: 'text-success', defaultName: 'Revenue Intelligence', route: 'customervalue' },
            { id: 'spendvelocity', icon: 'fa-tachometer-alt', color: 'text-indigo', defaultName: 'Spend Velocity', route: 'spendvelocity' }
        ],

        // Tab definitions - dynamically rendered
        tabs: [
            {
                id: 'license',
                label: 'License',
                icon: 'fa-id-card',
                order: 1,
                sections: [
                    {
                        id: 'licenseKey',
                        title: 'License Key',
                        icon: 'fa-key',
                        description: 'Enter your Gantry license key to activate the application.',
                        fields: [
                            {
                                id: 'licenseKey',
                                type: 'password',
                                label: 'License Key',
                                placeholder: 'GANTRY-XXXX-XXXX-XXXX'
                            }
                        ],
                        actions: [
                            { id: 'checkLicense', label: 'Verify License', icon: 'fa-check-circle', handler: 'onCheckLicense' }
                        ]
                    },
                    {
                        id: 'licenseStatus',
                        title: 'License Status',
                        icon: 'fa-info-circle',
                        type: 'license_status' // Special type for license status display
                    }
                ]
            },
            {
                id: 'ai',
                label: 'AI Provider',
                icon: 'fa-robot',
                order: 2,
                sections: [
                    {
                        id: 'aiModel',
                        title: 'AI Configuration',
                        icon: 'fa-brain',
                        description: 'Configure how the AI Advisor processes your queries.',
                        fields: [
                            {
                                id: 'aiMode',
                                type: 'mode_select_compact',
                                label: 'AI Mode',
                                default: 'smart',
                                options: [
                                    { value: 'smart', label: 'Smart', icon: 'fa-magic', color: '#3b82f6', desc: 'Auto-selects model by task', recommended: true },
                                    { value: 'max', label: 'Max', icon: 'fa-gem', color: '#8b5cf6', desc: 'Always premium models' },
                                    { value: 'light', label: 'Light', icon: 'fa-feather', color: '#10b981', desc: 'Always fast models' },
                                    { value: 'custom', label: 'Custom', icon: 'fa-sliders-h', color: '#f59e0b', desc: 'Pick models per tier' }
                                ]
                            },
                            {
                                id: 'aiProvider',
                                type: 'select',
                                label: 'Provider',
                                default: 'gemini',
                                options: [
                                    { value: 'gemini', label: 'Google Gemini' },
                                    { value: 'anthropic', label: 'Anthropic Claude' },
                                    { value: 'openai', label: 'OpenAI' },
                                    { value: 'openrouter', label: 'OpenRouter (100+ models)' },
                                    { value: 'grok', label: 'xAI Grok' },
                                    { value: 'netsuite', label: 'NetSuite (Free)' }
                                ],
                                showWhen: { field: 'aiMode', notValue: 'custom' }
                            },
                            {
                                id: 'openrouterModel',
                                type: 'openrouter_model_select',
                                label: 'OpenRouter Model',
                                description: 'Select from 100+ models - click Refresh to load latest',
                                default: 'anthropic/claude-sonnet-4',
                                showWhen: { field: 'aiProvider', value: 'openrouter' }
                            },
                            {
                                id: 'aiTemperature',
                                type: 'select',
                                label: 'Response Style',
                                default: '0.2',
                                options: [
                                    { value: '0.1', label: 'Precise' },
                                    { value: '0.2', label: 'Balanced' },
                                    { value: '0.5', label: 'Creative' },
                                    { value: '0.8', label: 'Very Creative' }
                                ]
                            },
                            {
                                id: 'tier1Model',
                                type: 'model_select',
                                label: 'Tier 1 (Fast)',
                                description: 'Planning, classification',
                                default: 'gemini-2.5-flash-lite',
                                showWhen: { field: 'aiMode', value: 'custom' }
                            },
                            {
                                id: 'tier2Model',
                                type: 'model_select',
                                label: 'Tier 2 (Balanced)',
                                description: 'Query generation',
                                default: 'gemini-2.5-flash',
                                showWhen: { field: 'aiMode', value: 'custom' }
                            },
                            {
                                id: 'tier3Model',
                                type: 'model_select',
                                label: 'Tier 3 (Premium)',
                                description: 'Complex reasoning',
                                default: 'gemini-2.5-pro',
                                showWhen: { field: 'aiMode', value: 'custom' }
                            }
                        ]
                    },
                    {
                        id: 'apiKeys',
                        title: 'API Keys',
                        icon: 'fa-key',
                        description: 'Configure API keys for external AI providers.',
                        fields: [
                            {
                                id: 'netsuiteUsage',
                                type: 'usage',
                                label: 'NetSuite AI Usage',
                                description: 'Free monthly quota'
                            },
                            {
                                id: 'geminiApiKey',
                                type: 'password',
                                label: 'Google AI (Gemini)',
                                placeholder: 'AIza...'
                            },
                            {
                                id: 'anthropicApiKey',
                                type: 'password',
                                label: 'Anthropic (Claude)',
                                placeholder: 'sk-ant-...'
                            },
                            {
                                id: 'openaiApiKey',
                                type: 'password',
                                label: 'OpenAI',
                                placeholder: 'sk-...'
                            },
                            {
                                id: 'openrouterApiKey',
                                type: 'password',
                                label: 'OpenRouter',
                                placeholder: 'sk-or-...'
                            },
                            {
                                id: 'grokApiKey',
                                type: 'password',
                                label: 'xAI (Grok)',
                                placeholder: 'xai-...'
                            }
                        ]
                    }
                ]
            },
            {
                id: 'dashboards',
                label: 'Dashboards',
                icon: 'fa-th-large',
                order: 3,
                sections: [
                    {
                        id: 'dashboards',
                        title: 'Dashboard Management',
                        icon: 'fa-th-large',
                        description: 'Control dashboard visibility, names, and order in the sidebar.',
                        type: 'dashboards' // Special type for dashboard management
                    }
                ]
            },
            {
                id: 'permissions',
                label: 'Permissions',
                icon: 'fa-user-shield',
                order: 4,
                adminOnly: true,
                sections: [
                    {
                        id: 'rolePermissions',
                        title: 'Role Permissions',
                        icon: 'fa-user-shield',
                        description: 'Control which dashboards each role can access. Admin-only setting.',
                        type: 'permissions',
                        adminOnly: true
                    }
                ]
            }
        ],

        // Legacy sections array for compatibility - maps to tabs
        get sections() {
            const allSections = [];
            this.tabs.forEach(tab => {
                if (tab.sections) {
                    tab.sections.forEach(section => {
                        allSections.push(section);
                    });
                }
            });
            return allSections;
        }
    };

    const SettingsController = {
        data: null,
        draggedItem: null,

        // Permissions data
        _permissionsData: null,
        _rolesList: [],
        _subsidiariesList: [],
        _selectedRoleId: null,

        async init() {
            // Render template first
            el('#gantry-view-container').innerHTML = this.renderTemplate();
            
            // Show skeleton in dashboard order list while loading
            const listEl = el("#dashboardOrderList");
            if (listEl) {
                let html = '';
                for (let i = 0; i < 4; i++) {
                    html += `<div class="d-flex align-items-center p-2 border-bottom">
                        ${Skeleton.render('custom', { width: '20px', height: '20px' })}
                        <div class="ml-3 flex-grow-1">
                            ${Skeleton.render('custom', { width: '60%', height: '1rem' })}
                        </div>
                    </div>`;
                }
                listEl.innerHTML = html;
            }
            
            try {
                const res = await API.get('main_config');
                this.data = { ...this.getDefaults(), ...(res.config || {}) };
                
                // Merge any new dashboards from schema into saved order
                this.mergeDashboardsFromSchema();
                
                this.render();
                this.setupEventListeners();
            } catch(e) {
                console.error("Settings load error", e);
                el('#gantry-view-container').innerHTML = ErrorBoundary.renderError(e, {
                    title: 'Failed to Load Settings',
                    retryAction: "SettingsController.init()"
                });
            }
        },

        getDefaults() {
            const defaults = {
                dashboardOrder: SETTINGS_SCHEMA.dashboards.map(d => d.id),
                dashboardNames: {},
                dashboardVisibility: {}
            };
            
            // Set default visibility and names from schema
            SETTINGS_SCHEMA.dashboards.forEach(d => {
                defaults.dashboardVisibility[d.id] = true;
                defaults.dashboardNames[d.id] = d.defaultName;
            });
            
            // Set defaults from other sections
            SETTINGS_SCHEMA.sections.forEach(section => {
                if (section.fields) {
                    section.fields.forEach(field => {
                        defaults[field.id] = field.default;
                    });
                }
            });
            
            return defaults;
        },

        /**
         * Merge any new dashboards from schema into saved data
         * This ensures newly added dashboards appear in settings even if user has saved config
         */
        mergeDashboardsFromSchema() {
            const schemaIds = SETTINGS_SCHEMA.dashboards.map(d => d.id);
            const savedOrder = this.data.dashboardOrder || [];
            
            // Find dashboards in schema but not in saved order
            const missingDashboards = schemaIds.filter(id => !savedOrder.includes(id));
            
            // Add missing dashboards to the end of the order
            if (missingDashboards.length > 0) {
                this.data.dashboardOrder = [...savedOrder, ...missingDashboards];
                
                // Also set default visibility and names for new dashboards
                missingDashboards.forEach(id => {
                    const dash = SETTINGS_SCHEMA.dashboards.find(d => d.id === id);
                    if (dash) {
                        if (this.data.dashboardVisibility[id] === undefined) {
                            this.data.dashboardVisibility[id] = true;
                        }
                        if (!this.data.dashboardNames[id]) {
                            this.data.dashboardNames[id] = dash.defaultName;
                        }
                    }
                });
            }
            
            // Also remove any dashboards that no longer exist in schema
            this.data.dashboardOrder = this.data.dashboardOrder.filter(id => schemaIds.includes(id));
        },

        renderTemplate() {
            const isAdmin = window.GANTRY_CONFIG?.user?.isAdmin || window.GANTRY_CONFIG?.permissions?.isAdmin;

            // Get visible tabs
            const visibleTabs = SETTINGS_SCHEMA.tabs
                .filter(tab => !tab.adminOnly || isAdmin)
                .sort((a, b) => a.order - b.order);

            // Generate tab navigation
            const tabNavHtml = visibleTabs.map((tab, idx) => `
                <li class="nav-item">
                    <a class="nav-link settings-tab-link ${idx === 0 ? 'active' : ''}"
                       href="#"
                       data-tab="${tab.id}"
                       id="settings-tab-${tab.id}">
                        <i class="fas ${tab.icon} mr-2"></i>${tab.label}
                    </a>
                </li>
            `).join('');

            // Generate tab content panels
            const tabContentHtml = visibleTabs.map((tab, idx) => {
                const sectionsHtml = tab.sections.map(section => {
                    if (section.adminOnly && !isAdmin) return '';
                    if (section.type === 'dashboards') return this.renderDashboardSection(section);
                    if (section.type === 'permissions') return this.renderPermissionsSection(section);
                    if (section.type === 'license_status') return this.renderLicenseStatusSection(section);
                    return this.renderFieldSection(section);
                }).join('');

                return `
                <div class="settings-tab-pane ${idx === 0 ? 'active' : ''}"
                     id="settings-pane-${tab.id}"
                     data-tab="${tab.id}">
                    ${sectionsHtml}
                </div>`;
            }).join('');

            return `
            <div class="container-fluid cf-dashboard p-4">
                <div class="d-flex align-items-center mb-4">
                    <div class="icon-box bg-purple-soft text-purple mr-3" style="width:50px;height:50px;font-size:1.2rem;">
                        <i class="fas fa-cog"></i>
                    </div>
                    <div>
                        <h4 class="m-0 font-weight-bold">Settings</h4>
                        <small class="text-muted">Configure application preferences and behavior</small>
                    </div>
                </div>

                <!-- Tab Navigation -->
                <ul class="nav nav-tabs settings-tabs mb-4" id="settingsTabNav">
                    ${tabNavHtml}
                </ul>

                <!-- Tab Content -->
                <div class="settings-tab-content">
                    ${tabContentHtml}
                </div>

                <div class="text-right mt-4">
                    <button class="btn btn-outline-secondary mr-2" id="btnResetSettings">
                        <i class="fas fa-undo mr-2"></i>Reset to Defaults
                    </button>
                    <button class="btn btn-primary shadow-sm px-4" id="btnSaveSettings">
                        <i class="fas fa-save mr-2"></i>Save Settings
                    </button>
                </div>
            </div>

            <style>
                /* Settings Tabs */
                .settings-tabs {
                    border-bottom: 2px solid #e2e8f0;
                    flex-wrap: nowrap;
                    overflow-x: auto;
                }
                .settings-tabs .nav-item {
                    flex-shrink: 0;
                }
                .settings-tabs .nav-link {
                    color: #64748b;
                    border: none;
                    border-bottom: 2px solid transparent;
                    margin-bottom: -2px;
                    padding: 12px 20px;
                    font-weight: 500;
                    transition: all 0.15s ease;
                    white-space: nowrap;
                }
                .settings-tabs .nav-link:hover {
                    color: #3b82f6;
                    border-bottom-color: #93c5fd;
                }
                .settings-tabs .nav-link.active {
                    color: #3b82f6;
                    border-bottom-color: #3b82f6;
                    background: transparent;
                }
                .dark-mode .settings-tabs {
                    border-bottom-color: #374151;
                }
                .dark-mode .settings-tabs .nav-link {
                    color: #9ca3af;
                }
                .dark-mode .settings-tabs .nav-link:hover,
                .dark-mode .settings-tabs .nav-link.active {
                    color: #60a5fa;
                    border-bottom-color: #60a5fa;
                }

                /* Tab Panes */
                .settings-tab-pane {
                    display: none;
                }
                .settings-tab-pane.active {
                    display: block;
                    animation: fadeIn 0.2s ease;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(4px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                /* Tier pill styles for model selects */
                .model-select option,
                .openrouter-model-select option {
                    padding: 8px 12px;
                }

                /* Tier badge styles */
                .tier-badge {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 2px 8px;
                    border-radius: 9999px;
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.025em;
                }

                .tier-badge.t1 {
                    background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
                    color: #166534;
                    border: 1px solid #86efac;
                }

                .tier-badge.t2 {
                    background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
                    color: #1e40af;
                    border: 1px solid #93c5fd;
                }

                .tier-badge.t3 {
                    background: linear-gradient(135deg, #fae8ff 0%, #f5d0fe 100%);
                    color: #86198f;
                    border: 1px solid #e879f9;
                }

                /* Dark mode tier badges */
                .dark-mode .tier-badge.t1 {
                    background: linear-gradient(135deg, #166534 0%, #14532d 100%);
                    color: #dcfce7;
                    border: 1px solid #22c55e;
                }

                .dark-mode .tier-badge.t2 {
                    background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%);
                    color: #dbeafe;
                    border: 1px solid #3b82f6;
                }

                .dark-mode .tier-badge.t3 {
                    background: linear-gradient(135deg, #86198f 0%, #701a75 100%);
                    color: #fae8ff;
                    border: 1px solid #d946ef;
                }

                /* Model select with tier indicator */
                .model-tier-indicator {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 4px;
                    font-size: 12px;
                    color: #64748b;
                }

                .dark-mode .model-tier-indicator {
                    color: #94a3b8;
                }

                /* License Status Styles */
                .license-status-card {
                    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 20px;
                }
                .dark-mode .license-status-card {
                    background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
                    border-color: #374151;
                }
                .license-status-badge {
                    display: inline-flex;
                    align-items: center;
                    padding: 6px 14px;
                    border-radius: 20px;
                    font-weight: 600;
                    font-size: 13px;
                }
                .license-status-badge.valid {
                    background: #dcfce7;
                    color: #166534;
                }
                .license-status-badge.invalid {
                    background: #fef2f2;
                    color: #dc2626;
                }
                .license-status-badge.expired {
                    background: #fef3c7;
                    color: #d97706;
                }
                .license-status-badge.offline {
                    background: #e0e7ff;
                    color: #4f46e5;
                }
                .dark-mode .license-status-badge.valid {
                    background: #166534;
                    color: #dcfce7;
                }
                .dark-mode .license-status-badge.invalid {
                    background: #7f1d1d;
                    color: #fecaca;
                }
                .dark-mode .license-status-badge.expired {
                    background: #78350f;
                    color: #fef3c7;
                }
                .license-tier-badge {
                    display: inline-block;
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-weight: 600;
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                .license-info-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 10px 0;
                    border-bottom: 1px solid #e2e8f0;
                }
                .license-info-row:last-child {
                    border-bottom: none;
                }
                .dark-mode .license-info-row {
                    border-bottom-color: #374151;
                }
                .license-info-label {
                    color: #64748b;
                    font-size: 13px;
                }
                .dark-mode .license-info-label {
                    color: #9ca3af;
                }
                .license-info-value {
                    font-weight: 500;
                    font-size: 14px;
                }
            </style>`;
        },

        /**
         * Render license status section
         */
        renderLicenseStatusSection(section) {
            const licenseData = window.GANTRY_CONFIG?.license || { valid: false, status: 'unknown' };
            const statusClass = licenseData.valid ? 'valid' :
                               (licenseData.status === 'expired' ? 'expired' :
                               (licenseData.isOffline ? 'offline' : 'invalid'));
            const statusLabel = licenseData.valid ? 'Active' :
                               (licenseData.status === 'expired' ? 'Expired' :
                               (licenseData.isOffline ? 'Offline Mode' : 'Invalid'));
            const statusIcon = licenseData.valid ? 'fa-check-circle' :
                              (licenseData.status === 'expired' ? 'fa-clock' :
                              (licenseData.isOffline ? 'fa-wifi' : 'fa-times-circle'));

            return `
            <div class="card shadow-sm mb-4" id="licenseStatusSection">
                <div class="card-header bg-light py-2">
                    <h6 class="mb-0 font-weight-bold"><i class="fas ${section.icon} mr-2"></i>${section.title}</h6>
                </div>
                <div class="card-body">
                    <div class="license-status-card">
                        <div class="d-flex align-items-center justify-content-between mb-3">
                            <span class="license-status-badge ${statusClass}">
                                <i class="fas ${statusIcon} mr-2"></i>${statusLabel}
                            </span>
                            ${licenseData.tier ? License.getTierBadge(licenseData.tier, licenseData.tierLabel) : ''}
                        </div>

                        <div class="license-info-row">
                            <span class="license-info-label">Licensed To</span>
                            <span class="license-info-value" id="licensedToDisplay">${licenseData.licensedTo || 'Not licensed'}</span>
                        </div>

                        <div class="license-info-row">
                            <span class="license-info-label">Subscription Tier</span>
                            <span class="license-info-value" id="licenseTierDisplay">${licenseData.tierLabel || licenseData.tier || 'N/A'}</span>
                        </div>

                        <div class="license-info-row">
                            <span class="license-info-label">Expires</span>
                            <span class="license-info-value" id="licenseExpiresDisplay">${licenseData.expiresAt ? License.formatExpiry(licenseData.expiresAt) : 'N/A'}</span>
                        </div>

                        ${licenseData.isOffline ? `
                        <div class="license-info-row">
                            <span class="license-info-label">Offline Grace Period</span>
                            <span class="license-info-value text-warning">
                                <i class="fas fa-exclamation-triangle mr-1"></i>Active (24 hours)
                            </span>
                        </div>` : ''}

                        ${!licenseData.valid ? `
                        <div class="mt-3 p-3 bg-light rounded">
                            <p class="mb-2 small text-muted">
                                <i class="fas fa-info-circle mr-1"></i>
                                Don't have a license? Visit our website to purchase one.
                            </p>
                            <a href="https://fluxfornetsuite.com/gantry" target="_blank" class="btn btn-sm btn-primary">
                                <i class="fas fa-external-link-alt mr-1"></i>Get License
                            </a>
                            <a href="mailto:sales@fluxfornetsuite.com" class="btn btn-sm btn-outline-secondary ml-2">
                                <i class="fas fa-envelope mr-1"></i>Contact Sales
                            </a>
                        </div>` : ''}
                    </div>
                </div>
            </div>`;
        },

        renderDashboardSection(section) {
            return `
            <div class="card shadow-sm mb-4">
                <div class="card-header bg-light py-2">
                    <h6 class="mb-0 font-weight-bold"><i class="fas ${section.icon} mr-2"></i>${section.title}</h6>
                </div>
                <div class="card-body">
                    <p class="text-muted small mb-3">${section.description}</p>

                    <div class="row">
                        <div class="col-lg-8">
                            <label class="cf-label mb-2">Dashboard Order & Visibility</label>
                            <p class="text-muted small">Drag to reorder. Toggle visibility with the switch. Click name to edit.</p>
                            <div id="dashboardOrderList" class="border rounded"></div>
                        </div>
                        <div class="col-lg-4">
                            <label class="cf-label mb-2">Sidebar Preview</label>
                            <p class="text-muted small">How the sidebar will appear.</p>
                            <div id="sidebarPreview" class="border rounded bg-dark p-2" style="min-height: 200px;">
                                <!-- Populated dynamically -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        },

        renderPermissionsSection(section) {
            return `
            <div class="card shadow-sm mb-4" id="permissionsSection">
                <div class="card-header bg-light py-2 d-flex align-items-center justify-content-between">
                    <h6 class="mb-0 font-weight-bold"><i class="fas ${section.icon} mr-2"></i>${section.title}</h6>
                    <span class="badge badge-warning"><i class="fas fa-crown mr-1"></i>Admin Only</span>
                </div>
                <div class="card-body">
                    <p class="text-muted small mb-3">${section.description}</p>

                    <div class="row mb-3">
                        <div class="col-md-6">
                            <div class="custom-control custom-switch">
                                <input type="checkbox" class="custom-control-input" id="permissionsEnabled">
                                <label class="custom-control-label" for="permissionsEnabled">
                                    <strong>Enable Role-Based Access Control</strong>
                                </label>
                            </div>
                            <small class="text-muted d-block mt-1">When disabled, all roles can access all dashboards.</small>
                        </div>
                    </div>

                    <div id="permissionsConfigArea" style="display: none;">
                        <hr class="my-3">

                        <div class="row">
                            <div class="col-md-4">
                                <label class="cf-label mb-2">Select Role to Configure</label>
                                <select class="form-control form-control-sm" id="roleSelector">
                                    <option value="">Loading roles...</option>
                                </select>
                                <small class="text-muted">Administrator role always has full access.</small>
                            </div>
                            <div class="col-md-8">
                                <label class="cf-label mb-2">Dashboard Access for Selected Role</label>
                                <div id="roleDashboardPermissions" class="border rounded p-3" style="min-height: 150px;">
                                    <p class="text-muted mb-0">Select a role to configure permissions</p>
                                </div>
                            </div>
                        </div>

                        <div class="row mt-3">
                            <div class="col-12">
                                <label class="cf-label mb-2">Subsidiary Access for Selected Role</label>
                                <div id="roleSubsidiaryPermissions" class="border rounded p-3">
                                    <p class="text-muted mb-0">Select a role to configure subsidiary access</p>
                                </div>
                            </div>
                        </div>

                        <div class="mt-3">
                            <button class="btn btn-sm btn-outline-primary" id="btnSavePermissions">
                                <i class="fas fa-save mr-1"></i>Save Permissions
                            </button>
                            <button class="btn btn-sm btn-outline-secondary ml-2" id="btnResetPermissions">
                                <i class="fas fa-undo mr-1"></i>Reset to Defaults
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <style>
                .perm-dash-item {
                    display: flex;
                    align-items: center;
                    padding: 8px 12px;
                    border-bottom: 1px solid #e2e8f0;
                    transition: background 0.15s;
                }
                .perm-dash-item:last-child {
                    border-bottom: none;
                }
                .perm-dash-item:hover {
                    background: #f8fafc;
                }
                .dark-mode .perm-dash-item:hover {
                    background: #374151;
                }
                .perm-dash-item .custom-switch {
                    margin-right: 12px;
                }
                .perm-sub-item {
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 12px;
                    margin: 4px;
                    border: 1px solid #e2e8f0;
                    border-radius: 20px;
                    background: #fff;
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .perm-sub-item.selected {
                    background: #3b82f6;
                    border-color: #3b82f6;
                    color: #fff;
                }
                .perm-sub-item:hover:not(.selected) {
                    border-color: #3b82f6;
                    background: #eff6ff;
                }
                .dark-mode .perm-sub-item {
                    background: #374151;
                    border-color: #4b5563;
                }
                .dark-mode .perm-sub-item.selected {
                    background: #3b82f6;
                    border-color: #3b82f6;
                }
                .perm-all-access {
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 12px;
                    margin: 4px;
                    border: 2px dashed #10b981;
                    border-radius: 20px;
                    background: #ecfdf5;
                    color: #059669;
                    cursor: pointer;
                    font-weight: 500;
                }
                .perm-all-access.selected {
                    background: #10b981;
                    border-style: solid;
                    color: #fff;
                }
                .dark-mode .perm-all-access {
                    background: #064e3b;
                    color: #6ee7b7;
                }
                .dark-mode .perm-all-access.selected {
                    background: #10b981;
                    color: #fff;
                }
            </style>`;
        },

        renderFieldSection(section) {
            const fieldsHtml = (section.fields || []).map(field => this.renderField(field)).join('');

            // Render action buttons if defined
            let actionsHtml = '';
            if (section.actions && section.actions.length > 0) {
                actionsHtml = `
                    <div class="mt-3 pt-3 border-top">
                        ${section.actions.map(action => `
                            <button class="btn btn-sm btn-primary mr-2" id="btn${action.id.charAt(0).toUpperCase() + action.id.slice(1)}">
                                <i class="fas ${action.icon} mr-2"></i>${action.label}
                            </button>
                        `).join('')}
                    </div>`;
            }

            // Build showWhen for section
            let showWhenAttr = '';
            if (section.showWhen) {
                showWhenAttr = `data-show-when-field="${section.showWhen.field}"`;
                if (section.showWhen.value !== undefined) {
                    showWhenAttr += ` data-show-when-value="${section.showWhen.value}"`;
                }
                if (section.showWhen.notValue !== undefined) {
                    showWhenAttr += ` data-show-when-not-value="${section.showWhen.notValue}"`;
                }
            }

            return `
            <div class="card shadow-sm mb-4 settings-card" ${showWhenAttr}>
                <div class="card-header bg-light py-2">
                    <h6 class="mb-0 font-weight-bold"><i class="fas ${section.icon} mr-2"></i>${section.title}</h6>
                </div>
                <div class="card-body">
                    <p class="text-muted small mb-3">${section.description}</p>
                    <div class="row">
                        ${fieldsHtml}
                    </div>
                    ${actionsHtml}
                </div>
            </div>`;
        },

        renderField(field) {
            let inputHtml = '';
            
            // Build showWhen data attribute if present
            let showWhenAttr = '';
            if (field.showWhen) {
                showWhenAttr = `data-show-when-field="${field.showWhen.field}"`;
                if (field.showWhen.value !== undefined) {
                    showWhenAttr += ` data-show-when-value="${field.showWhen.value}"`;
                }
                if (field.showWhen.notValue !== undefined) {
                    showWhenAttr += ` data-show-when-not-value="${field.showWhen.notValue}"`;
                }
            }
            
            switch (field.type) {
                case 'switch':
                    inputHtml = `
                        <div class="custom-control custom-switch">
                            <input type="checkbox" class="custom-control-input settings-field" id="setting_${field.id}" data-field="${field.id}">
                            <label class="custom-control-label" for="setting_${field.id}">${field.label}</label>
                        </div>`;
                    break;
                    
                case 'select':
                    const options = (field.options || []).map(opt => 
                        `<option value="${opt.value}">${opt.label}</option>`
                    ).join('');
                    inputHtml = `
                        <label class="cf-label" for="setting_${field.id}">${field.label}</label>
                        <select class="form-control form-control-sm settings-field" id="setting_${field.id}" data-field="${field.id}">
                            ${options}
                        </select>`;
                    break;
                    
                case 'text':
                    inputHtml = `
                        <label class="cf-label" for="setting_${field.id}">${field.label}</label>
                        <input type="text" class="form-control form-control-sm settings-field" id="setting_${field.id}" data-field="${field.id}"
                            placeholder="${field.placeholder || ''}">`;
                    break;
                    
                case 'password':
                    inputHtml = `
                        <label class="cf-label" for="setting_${field.id}">${field.label}</label>
                        <div class="input-group input-group-sm">
                            <input type="password" class="form-control settings-field" id="setting_${field.id}" data-field="${field.id}"
                                placeholder="${field.placeholder || ''}" autocomplete="off">
                            <div class="input-group-append">
                                <button class="btn btn-outline-secondary toggle-password" type="button" data-target="setting_${field.id}">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                        </div>`;
                    break;
                    
                case 'number':
                    inputHtml = `
                        <label class="cf-label" for="setting_${field.id}">${field.label}</label>
                        <input type="number" class="form-control form-control-sm settings-field" id="setting_${field.id}" data-field="${field.id}" 
                            min="${field.min || 0}" max="${field.max || 9999}" step="${field.step || 1}">`;
                    break;
                    
                case 'usage':
                    // Special field type for NetSuite AI usage display
                    inputHtml = `
                        <label class="cf-label">${field.label}</label>
                        <div class="ai-usage-container" id="setting_${field.id}">
                            <div class="d-flex justify-content-between align-items-center mb-1">
                                <span class="usage-label">Text Generation</span>
                                <span class="usage-value" id="usage_generate_value">Loading...</span>
                            </div>
                            <div class="usage-bar mb-2" style="display: flex; height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden;">
                                <div id="usage_generate_bar" role="progressbar" style="flex: 0 0 0%; border-radius: 4px; transition: flex-basis 0.3s ease;"></div>
                            </div>
                            <div class="d-flex justify-content-between align-items-center mb-1">
                                <span class="usage-label">Embeddings</span>
                                <span class="usage-value" id="usage_embed_value">Loading...</span>
                            </div>
                            <div class="usage-bar" style="display: flex; height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden;">
                                <div id="usage_embed_bar" role="progressbar" style="flex: 0 0 0%; border-radius: 4px; transition: flex-basis 0.3s ease;"></div>
                            </div>
                            <button class="btn btn-sm btn-outline-secondary mt-2" onclick="SettingsController.refreshAIUsage()">
                                <i class="fas fa-sync-alt"></i> Refresh
                            </button>
                        </div>`;
                    break;
                    
                case 'info':
                    // Informational display field (no input)
                    inputHtml = `
                        <label class="cf-label">${field.label}</label>
                        <div class="info-content" style="padding: 12px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
                            ${field.content || ''}
                        </div>`;
                    break;
                    
                case 'model_select':
                    // Dynamic model selector - loads ALL models from Model Registry
                    inputHtml = `
                        <label class="cf-label" for="setting_${field.id}">${field.label}</label>
                        <select class="form-control form-control-sm settings-field model-select" id="setting_${field.id}" data-field="${field.id}" data-default="${field.default || ''}">
                            <option value="">Loading models...</option>
                        </select>`;
                    break;
                    
                case 'provider_model_select':
                    // Dynamic model selector filtered by provider
                    inputHtml = `
                        <label class="cf-label" for="setting_${field.id}">${field.label}</label>
                        <select class="form-control form-control-sm settings-field provider-model-select" id="setting_${field.id}" data-field="${field.id}" data-provider="${field.provider || ''}" data-default="${field.default || ''}">
                            <option value="">Loading models...</option>
                        </select>`;
                    break;
                    
                case 'openrouter_model_select':
                    // OpenRouter searchable model selector - matches form-control-sm height
                    inputHtml = `
                        <label class="cf-label" for="setting_${field.id}">${field.label}</label>
                        <div class="openrouter-search-container">
                            <div class="input-group input-group-sm">
                                <input type="text" 
                                    class="form-control form-control-sm openrouter-search-input" 
                                    id="setting_${field.id}_search" 
                                    placeholder="Search models..." 
                                    autocomplete="off">
                                <input type="hidden" 
                                    class="settings-field openrouter-model-value" 
                                    id="setting_${field.id}" 
                                    data-field="${field.id}" 
                                    data-default="${field.default || ''}">
                                <div class="input-group-append">
                                    <button class="btn btn-outline-secondary btn-sm" type="button" onclick="SettingsController.loadOpenRouterModels(true)" title="Refresh models">
                                        <i class="fas fa-sync-alt"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="openrouter-dropdown" id="openrouter_dropdown" style="display:none;">
                                <div class="openrouter-dropdown-list"></div>
                            </div>
                            <small class="text-muted mt-1 d-block">
                                <span id="openrouter_model_count">—</span> models available
                            </small>
                        </div>
                        <style>
                            .openrouter-search-container {
                                position: relative;
                            }
                            .openrouter-search-container .input-group {
                                height: auto;
                            }
                            .openrouter-search-container .form-control-sm {
                                height: calc(1.5em + 0.5rem + 2px);
                                padding: 0.25rem 0.5rem;
                                font-size: 0.875rem;
                            }
                            .openrouter-dropdown {
                                position: absolute;
                                top: 100%;
                                left: 0;
                                right: 0;
                                z-index: 1000;
                                background: var(--dropdown-bg, #fff);
                                border: 1px solid var(--border-color, #ced4da);
                                border-radius: 0 0 4px 4px;
                                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                                max-height: 280px;
                                overflow-y: auto;
                            }
                            .openrouter-dropdown-item {
                                padding: 8px 12px;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: space-between;
                                font-size: 13px;
                                border-bottom: 1px solid var(--border-light, #f1f5f9);
                            }
                            .openrouter-dropdown-item:last-child {
                                border-bottom: none;
                            }
                            .openrouter-dropdown-item:hover,
                            .openrouter-dropdown-item.highlighted {
                                background: var(--hover-bg, #f8fafc);
                            }
                            .openrouter-dropdown-item.selected {
                                background: var(--selected-bg, #eff6ff);
                            }
                            .openrouter-dropdown-group {
                                padding: 6px 12px;
                                font-size: 11px;
                                font-weight: 600;
                                color: var(--text-muted, #64748b);
                                background: var(--group-bg, #f8fafc);
                                text-transform: uppercase;
                                letter-spacing: 0.05em;
                                position: sticky;
                                top: 0;
                            }
                            .openrouter-tier {
                                padding: 2px 6px;
                                border-radius: 4px;
                                font-size: 10px;
                                font-weight: 600;
                                flex-shrink: 0;
                                margin-left: 8px;
                            }
                            .openrouter-tier.t1 { background: #dcfce7; color: #166534; }
                            .openrouter-tier.t2 { background: #dbeafe; color: #1e40af; }
                            .openrouter-tier.t3 { background: #fae8ff; color: #86198f; }
                            .openrouter-no-results {
                                padding: 12px;
                                text-align: center;
                                color: var(--text-muted, #64748b);
                                font-size: 13px;
                            }
                            /* Dark mode */
                            .dark-mode .openrouter-dropdown {
                                --dropdown-bg: #1f2937;
                                --border-color: #374151;
                                --border-light: #374151;
                                --hover-bg: #374151;
                                --selected-bg: #1e3a5f;
                                --group-bg: #111827;
                                --text-muted: #9ca3af;
                            }
                            .dark-mode .openrouter-tier.t1 { background: #166534; color: #dcfce7; }
                            .dark-mode .openrouter-tier.t2 { background: #1e40af; color: #dbeafe; }
                            .dark-mode .openrouter-tier.t3 { background: #86198f; color: #fae8ff; }
                        </style>`;
                    break;
                    
                case 'mode_select_compact':
                    // Compact 2x2 grid AI Mode selector with dark mode support
                    const compactModeOptions = (field.options || []).map(opt => `
                        <div class="mode-option-compact" data-mode="${opt.value}">
                            <div class="mode-icon-compact" style="background: ${opt.color}20; color: ${opt.color};">
                                <i class="fas ${opt.icon}"></i>
                            </div>
                            <div class="mode-label-compact">${opt.label}</div>
                            <div class="mode-desc-compact">${opt.desc}</div>
                            ${opt.recommended ? '<div class="mode-badge">✓</div>' : ''}
                        </div>
                    `).join('');
                    inputHtml = `
                        <input type="hidden" class="settings-field" id="setting_${field.id}" data-field="${field.id}" value="${field.default || 'smart'}">
                        <div class="mode-selector-compact" data-for="setting_${field.id}">
                            ${compactModeOptions}
                        </div>
                        <style>
                            .mode-selector-compact {
                                display: grid;
                                grid-template-columns: 1fr 1fr;
                                gap: 8px;
                                margin-bottom: 12px;
                            }
                            .mode-option-compact {
                                position: relative;
                                padding: 10px;
                                border: 2px solid var(--border-color, #e2e8f0);
                                border-radius: 8px;
                                cursor: pointer;
                                transition: all 0.15s ease;
                                background: var(--card-bg, #fff);
                            }
                            .mode-option-compact:hover {
                                border-color: var(--border-hover, #cbd5e1);
                                background: var(--hover-bg, #f8fafc);
                            }
                            .mode-option-compact.selected {
                                border-color: var(--mode-color, #3b82f6);
                                background: var(--selected-bg, rgba(59, 130, 246, 0.05));
                            }
                            .mode-icon-compact {
                                width: 32px;
                                height: 32px;
                                border-radius: 6px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 14px;
                                margin-bottom: 6px;
                            }
                            .mode-label-compact {
                                font-weight: 600;
                                font-size: 13px;
                                color: var(--text-primary, #1e293b);
                                margin-bottom: 2px;
                            }
                            .mode-desc-compact {
                                font-size: 11px;
                                color: var(--text-secondary, #64748b);
                                line-height: 1.3;
                            }
                            .mode-badge {
                                position: absolute;
                                top: 6px;
                                right: 6px;
                                width: 16px;
                                height: 16px;
                                border-radius: 50%;
                                background: var(--mode-color, #3b82f6);
                                color: #fff;
                                font-size: 9px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            }
                            /* Dark mode overrides */
                            .dark-mode .mode-option-compact {
                                --border-color: #374151;
                                --card-bg: #1f2937;
                                --border-hover: #4b5563;
                                --hover-bg: #374151;
                                --text-primary: #f3f4f6;
                                --text-secondary: #9ca3af;
                            }
                            .dark-mode .mode-option-compact.selected {
                                --selected-bg: rgba(59, 130, 246, 0.15);
                            }
                        </style>`;
                    break;
                    
                case 'mode_select':
                    // AI Mode selector with visual cards
                    const modeOptions = (field.options || []).map(opt => `
                        <div class="mode-option" data-mode="${opt.value}" style="
                            padding: 14px 16px; margin-bottom: 8px; cursor: pointer;
                            border: 2px solid #e2e8f0; border-radius: 10px;
                            background: #fff; transition: all 0.15s ease;
                            display: flex; align-items: flex-start; gap: 14px;
                        ">
                            <div class="mode-icon" style="
                                width: 40px; height: 40px; border-radius: 10px;
                                background: ${opt.color}15; color: ${opt.color};
                                display: flex; align-items: center; justify-content: center;
                                font-size: 18px; flex-shrink: 0;
                            ">
                                <i class="fas ${opt.icon}"></i>
                            </div>
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-weight: 600; font-size: 14px; color: #1e293b;">${opt.label}</span>
                                    ${opt.recommended ? '<span style="font-size: 10px; padding: 2px 8px; border-radius: 4px; background: #dbeafe; color: #1d4ed8; font-weight: 500;">Recommended</span>' : ''}
                                </div>
                                <div style="font-size: 12px; color: #64748b; margin-top: 4px; line-height: 1.4;">${opt.desc}</div>
                            </div>
                            <div class="mode-check" style="
                                width: 22px; height: 22px; border-radius: 50%;
                                border: 2px solid #e2e8f0; background: #fff;
                                display: flex; align-items: center; justify-content: center;
                                flex-shrink: 0; transition: all 0.15s ease;
                            ">
                                <i class="fas fa-check" style="font-size: 10px; color: #fff; display: none;"></i>
                            </div>
                        </div>
                    `).join('');
                    inputHtml = `
                        <label class="cf-label">${field.label}</label>
                        <input type="hidden" class="settings-field" id="setting_${field.id}" data-field="${field.id}" value="${field.default || 'smart'}">
                        <div class="mode-selector" data-for="setting_${field.id}">
                            ${modeOptions}
                        </div>`;
                    break;
            }
            
            // Determine column width - full width for mode selectors and usage displays
            const fullWidthTypes = ['mode_select', 'mode_select_compact', 'usage', 'info'];
            const colClass = fullWidthTypes.includes(field.type) ? 'col-12' : 'col-md-6';
            
            return `
                <div class="${colClass} mb-3 settings-field-container" ${showWhenAttr}>
                    ${inputHtml}
                    ${field.description ? `<small class="text-muted">${field.description}</small>` : ''}
                </div>`;
        },

        render() {
            this.renderDashboardList();
            this.renderSidebarPreview();
            this.renderFieldValues();
            this.refreshAIUsage(); // Load AI usage on render
            this.loadModelOptions(); // Load model options for tier selects

            // Load permissions if admin
            const isAdmin = window.GANTRY_CONFIG?.user?.isAdmin || window.GANTRY_CONFIG?.permissions?.isAdmin;
            if (isAdmin) {
                this.loadPermissionsConfig();
            }
        },
        
        /**
         * Load model options from API (which reads from Model Registry)
         * No fallback - Registry is the single source of truth
         */
        async loadModelOptions() {
            try {
                // Get models from API - calls ModelRegistry.getModelsForSettings()
                const res = await API.get('models');
                
                if (!res || !res.models) {
                    console.error('API did not return models - check that models endpoint calls ModelRegistry.getModelsForSettings()');
                    return;
                }
                
                const allModels = res.models;
                const modelsByProvider = res.modelsByProvider || {};
                
                // Populate model_select dropdowns (ALL models for tier config)
                document.querySelectorAll('.model-select').forEach(select => {
                    const defaultVal = select.dataset.default || '';
                    const currentVal = this.data[select.dataset.field] || defaultVal;
                    
                    select.innerHTML = allModels.map(m => 
                        `<option value="${m.value}" ${m.value === currentVal ? 'selected' : ''}>${m.label}</option>`
                    ).join('');
                    
                    if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
                        select.value = currentVal;
                    }
                });
                
                // Populate provider_model_select dropdowns (filtered by provider)
                document.querySelectorAll('.provider-model-select').forEach(select => {
                    const provider = select.dataset.provider;
                    const defaultVal = select.dataset.default || '';
                    const currentVal = this.data[select.dataset.field] || defaultVal;
                    
                    const providerModels = modelsByProvider[provider] || [];
                    
                    select.innerHTML = providerModels.map(m => 
                        `<option value="${m.value}" ${m.value === currentVal ? 'selected' : ''}>${m.label}</option>`
                    ).join('');
                    
                    if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
                        select.value = currentVal;
                    }
                });
            } catch (e) {
                console.error('Failed to load models from API:', e);
                // Show error state in dropdowns
                document.querySelectorAll('.model-select, .provider-model-select').forEach(select => {
                    select.innerHTML = '<option value="">Error loading models</option>';
                });
            }
            
            // Also load OpenRouter models if that input exists
            this.loadOpenRouterModels(false);
        },

        // Store OpenRouter models for search filtering
        _openRouterModels: [],
        _openRouterHighlightIndex: -1,

        /**
         * Load OpenRouter models dynamically
         * @param {boolean} forceRefresh - If true, fetches fresh from API
         */
        async loadOpenRouterModels(forceRefresh = false) {
            const searchInput = document.querySelector('.openrouter-search-input');
            const hiddenInput = document.querySelector('.openrouter-model-value');
            if (!searchInput || !hiddenInput) return;
            
            const countEl = document.getElementById('openrouter_model_count');
            
            try {
                // Get API key to use for fetching (if available)
                const apiKey = this.data?.openrouterApiKey || '';
                
                // Show loading state
                if (forceRefresh) {
                    searchInput.placeholder = 'Refreshing models...';
                }
                
                // Fetch models from API
                const res = await API.get('openrouter_models', { apiKey: apiKey });
                
                let models = [];
                if (res && res.models && res.models.length > 0) {
                    models = res.models;
                } else {
                    // Fall back to curated list
                    models = this.getCuratedOpenRouterModels();
                    if (countEl) countEl.textContent = 'curated';
                }
                
                // Store models for filtering
                this._openRouterModels = models;
                
                // Update count
                if (countEl && res?.models?.length) {
                    countEl.textContent = res.count || res.models.length;
                }
                
                // Set current value display
                const defaultVal = hiddenInput.dataset.default || 'anthropic/claude-sonnet-4';
                const currentVal = this.data?.openrouterModel || defaultVal;
                hiddenInput.value = currentVal;
                
                // Find and display current model name
                const currentModel = models.find(m => m.value === currentVal);
                if (currentModel) {
                    searchInput.value = currentModel.label.replace(/\s*\[T\d.*?\]/, '');
                } else {
                    searchInput.value = currentVal;
                }
                
                searchInput.placeholder = 'Search models...';
                
                // Setup search behavior
                this.setupOpenRouterSearch(searchInput, hiddenInput);
                
                if (forceRefresh) {
                    showToast('OpenRouter models refreshed');
                }
                
            } catch (e) {
                console.error('Failed to load OpenRouter models:', e);
                this._openRouterModels = this.getCuratedOpenRouterModels();
                searchInput.placeholder = 'Search models...';
                this.setupOpenRouterSearch(searchInput, hiddenInput);
                if (countEl) countEl.textContent = 'curated (refresh failed)';
            }
        },
        
        /**
         * Get curated OpenRouter models as fallback (client-side)
         * Only includes models that support tool calling
         * NOTE: This mirrors Lib_Model_Registry.getCuratedOpenRouterModels() on the server.
         * Kept as client-side copy because client code cannot import server-side modules.
         * If you modify this list, update Lib_Model_Registry.js:610 as well.
         */
        getCuratedOpenRouterModels() {
            return [
                // Anthropic - all support tools
                { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', tier: 3, tierLabel: 'T3', provider: 'Anthropic' },
                { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', tier: 3, tierLabel: 'T3', provider: 'Anthropic' },
                { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku', tier: 1, tierLabel: 'T1', provider: 'Anthropic' },
                // OpenAI - gpt models support tools (not o1/reasoning)
                { value: 'openai/gpt-4o', label: 'GPT-4o', tier: 3, tierLabel: 'T3', provider: 'OpenAI' },
                { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', tier: 2, tierLabel: 'T2', provider: 'OpenAI' },
                { value: 'openai/gpt-4-turbo', label: 'GPT-4 Turbo', tier: 3, tierLabel: 'T3', provider: 'OpenAI' },
                // Google - Gemini supports tools
                { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', tier: 2, tierLabel: 'T2', provider: 'Google' },
                { value: 'google/gemini-pro-1.5', label: 'Gemini Pro 1.5', tier: 3, tierLabel: 'T3', provider: 'Google' },
                // Meta Llama - instruct models support tools
                { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', tier: 2, tierLabel: 'T2', provider: 'Meta' },
                { value: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B', tier: 2, tierLabel: 'T2', provider: 'Meta' },
                // Mistral - supports tools
                { value: 'mistralai/mistral-large-2411', label: 'Mistral Large', tier: 3, tierLabel: 'T3', provider: 'Mistral' },
                { value: 'mistralai/mistral-small-2503', label: 'Mistral Small', tier: 1, tierLabel: 'T1', provider: 'Mistral' },
                // Qwen - instruct models support tools (not reasoning models)
                { value: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B', tier: 2, tierLabel: 'T2', provider: 'Qwen' },
                { value: 'qwen/qwen-2.5-32b-instruct', label: 'Qwen 2.5 32B', tier: 2, tierLabel: 'T2', provider: 'Qwen' }
                // NOTE: Excluded - DeepSeek R1, QwQ, o1-preview (reasoning models don't support tools)
            ];
        },
        
        /**
         * Setup search input behavior for OpenRouter model selector
         */
        setupOpenRouterSearch(searchInput, hiddenInput) {
            const dropdown = document.getElementById('openrouter_dropdown');
            const dropdownList = dropdown?.querySelector('.openrouter-dropdown-list');
            if (!dropdown || !dropdownList) return;
            
            // Remove old listeners by cloning
            const newInput = searchInput.cloneNode(true);
            searchInput.parentNode.replaceChild(newInput, searchInput);
            
            // Focus handler - show dropdown
            newInput.addEventListener('focus', () => {
                this._openRouterHighlightIndex = -1;
                this.filterOpenRouterModels(newInput.value, dropdownList, hiddenInput);
                dropdown.style.display = 'block';
            });
            
            // Input handler - filter as you type
            newInput.addEventListener('input', () => {
                this._openRouterHighlightIndex = -1;
                this.filterOpenRouterModels(newInput.value, dropdownList, hiddenInput);
                dropdown.style.display = 'block';
            });
            
            // Keyboard navigation
            newInput.addEventListener('keydown', (e) => {
                const items = dropdownList.querySelectorAll('.openrouter-dropdown-item');
                if (!items.length) return;
                
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this._openRouterHighlightIndex = Math.min(this._openRouterHighlightIndex + 1, items.length - 1);
                    this.updateOpenRouterHighlight(items);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this._openRouterHighlightIndex = Math.max(this._openRouterHighlightIndex - 1, 0);
                    this.updateOpenRouterHighlight(items);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (this._openRouterHighlightIndex >= 0 && items[this._openRouterHighlightIndex]) {
                        items[this._openRouterHighlightIndex].click();
                    }
                } else if (e.key === 'Escape') {
                    dropdown.style.display = 'none';
                    newInput.blur();
                }
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.openrouter-search-container')) {
                    dropdown.style.display = 'none';
                }
            });
        },
        
        /**
         * Filter and display OpenRouter models in dropdown
         */
        filterOpenRouterModels(query, dropdownList, hiddenInput) {
            const q = query.toLowerCase().trim();
            let filtered = this._openRouterModels;
            
            if (q) {
                filtered = this._openRouterModels.filter(m => 
                    m.label.toLowerCase().includes(q) || 
                    m.value.toLowerCase().includes(q) ||
                    (m.provider && m.provider.toLowerCase().includes(q))
                );
            }
            
            if (filtered.length === 0) {
                dropdownList.innerHTML = '<div class="openrouter-no-results">No models found</div>';
                return;
            }
            
            // Group by provider
            const grouped = {};
            filtered.forEach(m => {
                const provider = m.provider || 'Other';
                if (!grouped[provider]) grouped[provider] = [];
                grouped[provider].push(m);
            });
            
            // Build dropdown HTML
            let html = '';
            Object.keys(grouped).sort().forEach(provider => {
                html += `<div class="openrouter-dropdown-group">${provider}</div>`;
                grouped[provider].forEach(m => {
                    const tierClass = (m.tierLabel || 'T2').toLowerCase();
                    const selected = hiddenInput.value === m.value ? 'selected' : '';
                    html += `
                        <div class="openrouter-dropdown-item ${selected}" data-value="${m.value}" data-label="${m.label}">
                            <span>${m.label}</span>
                            <span class="openrouter-tier ${tierClass}">${m.tierLabel || 'T2'}</span>
                        </div>
                    `;
                });
            });
            
            dropdownList.innerHTML = html;
            
            // Add click handlers to items
            dropdownList.querySelectorAll('.openrouter-dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    const value = item.dataset.value;
                    const label = item.dataset.label;
                    
                    hiddenInput.value = value;
                    const searchInput = document.querySelector('.openrouter-search-input');
                    if (searchInput) searchInput.value = label;
                    
                    // Update data
                    this.data.openrouterModel = value;
                    
                    // Hide dropdown
                    document.getElementById('openrouter_dropdown').style.display = 'none';
                    
                    // Update selection visual
                    dropdownList.querySelectorAll('.openrouter-dropdown-item').forEach(i => i.classList.remove('selected'));
                    item.classList.add('selected');
                });
            });
        },
        
        /**
         * Update keyboard highlight in OpenRouter dropdown
         */
        updateOpenRouterHighlight(items) {
            items.forEach((item, i) => {
                item.classList.toggle('highlighted', i === this._openRouterHighlightIndex);
            });
            
            // Scroll into view
            if (this._openRouterHighlightIndex >= 0 && items[this._openRouterHighlightIndex]) {
                items[this._openRouterHighlightIndex].scrollIntoView({ block: 'nearest' });
            }
        },

        async refreshAIUsage() {
            try {
                const res = await API.get('ai_usage');
                if (res && res.success !== false) {
                    this.updateUsageDisplay(res);
                }
            } catch (e) {
                console.error('Failed to load AI usage', e);
                // Show error state
                const genValue = el('#usage_generate_value');
                const embedValue = el('#usage_embed_value');
                if (genValue) genValue.textContent = 'Unable to load';
                if (embedValue) embedValue.textContent = 'Unable to load';
            }
        },

        updateUsageDisplay(usage) {
            // Text generation usage
            const genBar = el('#usage_generate_bar');
            const genValue = el('#usage_generate_value');
            if (genBar && genValue && usage.generate) {
                const remaining = usage.generate.remaining || 0;
                const total = usage.generate.total || 1000;
                const usedPct = Math.round(((total - remaining) / total) * 100);

                // Bar shows used percentage (full = quota exhausted)
                genBar.style.flex = `0 0 ${usedPct}%`;
                genBar.style.backgroundColor = usedPct > 80 ? '#dc3545' : usedPct > 50 ? '#ffc107' : '#28a745';
                genValue.textContent = `${remaining.toLocaleString()} / ${total.toLocaleString()} remaining`;
            }

            // Embedding usage
            const embedBar = el('#usage_embed_bar');
            const embedValue = el('#usage_embed_value');
            if (embedBar && embedValue && usage.embed) {
                const remaining = usage.embed.remaining || 0;
                const total = usage.embed.total || 1000;
                const usedPct = Math.round(((total - remaining) / total) * 100);

                // Bar shows used percentage (full = quota exhausted)
                embedBar.style.flex = `0 0 ${usedPct}%`;
                embedBar.style.backgroundColor = usedPct > 80 ? '#dc3545' : usedPct > 50 ? '#ffc107' : '#17a2b8';
                embedValue.textContent = `${remaining.toLocaleString()} / ${total.toLocaleString()} remaining`;
            }
        },

        renderDashboardList() {
            const listEl = el("#dashboardOrderList");
            if (!listEl) return;

            const order = this.data.dashboardOrder || SETTINGS_SCHEMA.dashboards.map(d => d.id);
            
            listEl.innerHTML = order.map((id, idx) => {
                const dash = SETTINGS_SCHEMA.dashboards.find(d => d.id === id);
                if (!dash) return '';
                
                const name = this.data.dashboardNames?.[id] || dash.defaultName;
                const visible = this.data.dashboardVisibility?.[id] !== false;
                
                return `
                    <div class="d-flex align-items-center p-2 border-bottom dashboard-order-item ${!visible ? 'bg-light' : ''}" 
                         data-dashboard="${id}" draggable="true">
                        <i class="fas fa-grip-vertical text-muted mr-3" style="cursor: grab;"></i>
                        <div class="custom-control custom-switch mr-3">
                            <input type="checkbox" class="custom-control-input dashboard-visibility" 
                                id="vis_${id}" data-dashboard="${id}" ${visible ? 'checked' : ''}>
                            <label class="custom-control-label" for="vis_${id}"></label>
                        </div>
                        <i class="fas ${dash.icon} ${dash.color} mr-2"></i>
                        <input type="text" class="form-control form-control-sm border-0 bg-transparent dashboard-name" 
                            data-dashboard="${id}" value="${name}" style="max-width: 200px;">
                        <span class="badge badge-secondary ml-auto">${dash.route}</span>
                    </div>
                `;
            }).join('');
            
            // Re-setup drag handlers after re-render
            this.setupDragHandlers();
        },

        renderSidebarPreview() {
            const previewEl = el("#sidebarPreview");
            if (!previewEl) return;

            const order = this.data.dashboardOrder || SETTINGS_SCHEMA.dashboards.map(d => d.id);
            
            let html = '<ul class="list-unstyled mb-0">';
            order.forEach(id => {
                const dash = SETTINGS_SCHEMA.dashboards.find(d => d.id === id);
                if (!dash) return;
                
                const name = this.data.dashboardNames?.[id] || dash.defaultName;
                const visible = this.data.dashboardVisibility?.[id] !== false;
                
                if (visible) {
                    html += `
                        <li class="py-2 px-3 text-light d-flex align-items-center" style="font-size: 0.85rem;">
                            <i class="fas ${dash.icon} mr-2" style="width: 16px;"></i>
                            <span class="text-truncate">${name}</span>
                        </li>
                    `;
                }
            });
            html += `
                <li class="py-2 px-3 text-muted d-flex align-items-center border-top border-secondary mt-2" style="font-size: 0.85rem;">
                    <i class="fas fa-cog mr-2" style="width: 16px;"></i>
                    <span>Settings</span>
                </li>
            </ul>`;
            
            previewEl.innerHTML = html;
        },

        renderFieldValues() {
            // Populate field values from data
            SETTINGS_SCHEMA.sections.forEach(section => {
                if (section.fields) {
                    section.fields.forEach(field => {
                        const fieldEl = el(`#setting_${field.id}`);
                        if (!fieldEl) return;
                        
                        // Handle localStorage fields specially
                        let value;
                        if (field.localStorage) {
                            if (field.id === 'darkMode') {
                                value = localStorage.getItem('gantry-dark-mode') === 'true';
                            } else {
                                value = localStorage.getItem(`gantry-${field.id}`);
                            }
                        } else {
                            value = this.data[field.id];
                            // Handle the string "undefined" as if it were undefined
                            if (value === 'undefined' || value === undefined || value === null) {
                                value = field.default || '';
                            }
                        }
                        
                        if (field.type === 'switch') {
                            fieldEl.checked = value === true;
                        } else {
                            fieldEl.value = value;
                        }
                        
                        // Update mode selector visuals (both compact and full versions)
                        if (field.type === 'mode_select') {
                            const selector = document.querySelector(`.mode-selector[data-for="setting_${field.id}"]`);
                            if (selector) {
                                this.updateModeVisuals(selector, value || field.default || 'smart');
                            }
                        } else if (field.type === 'mode_select_compact') {
                            const selector = document.querySelector(`.mode-selector-compact[data-for="setting_${field.id}"]`);
                            if (selector) {
                                this.updateCompactModeVisuals(selector, value || field.default || 'smart');
                            }
                        }
                    });
                }
            });
            
            // Update conditional visibility after values are set
            this.updateConditionalVisibility();
        },

        setupEventListeners() {
            // Tab switching
            document.querySelectorAll('.settings-tab-link').forEach(tabLink => {
                tabLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    const tabId = tabLink.dataset.tab;
                    this.switchTab(tabId);
                });
            });

            // License check button
            el('#btnCheckLicense')?.addEventListener('click', () => this.onCheckLicense());

            // Dashboard visibility toggles (use event delegation)
            el("#dashboardOrderList")?.addEventListener('change', (e) => {
                if (e.target.classList.contains('dashboard-visibility')) {
                    const id = e.target.dataset.dashboard;
                    if (!this.data.dashboardVisibility) this.data.dashboardVisibility = {};
                    this.data.dashboardVisibility[id] = e.target.checked;
                    this.renderDashboardList();
                    this.renderSidebarPreview();
                }
            });

            // Dashboard name changes (use event delegation)
            el("#dashboardOrderList")?.addEventListener('change', (e) => {
                if (e.target.classList.contains('dashboard-name')) {
                    const id = e.target.dataset.dashboard;
                    if (!this.data.dashboardNames) this.data.dashboardNames = {};
                    this.data.dashboardNames[id] = e.target.value;
                    this.renderSidebarPreview();
                }
            });
            
            // Dark mode toggle - immediate effect via localStorage
            el("#setting_darkMode")?.addEventListener('change', (e) => {
                const isDark = e.target.checked;
                localStorage.setItem('gantry-dark-mode', isDark ? 'true' : 'false');
                document.body.classList.toggle('dark-mode', isDark);
                // Update sidebar icon
                const sidebarIcon = document.querySelector('#darkModeToggle i');
                if (sidebarIcon) {
                    sidebarIcon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
                }
            });

            // Save button
            el("#btnSaveSettings")?.addEventListener('click', () => this.save());
            
            // Reset button
            el("#btnResetSettings")?.addEventListener('click', () => {
                if (confirm('Reset all settings to defaults? This cannot be undone.')) {
                    this.data = this.getDefaults();
                    // Reset dark mode
                    localStorage.setItem('gantry-dark-mode', 'false');
                    document.body.classList.remove('dark-mode');
                    const sidebarIcon = document.querySelector('#darkModeToggle i');
                    if (sidebarIcon) sidebarIcon.className = 'fas fa-moon';
                    
                    this.render();
                    showToast('Settings reset to defaults');
                }
            });
            
            // Password visibility toggle
            document.querySelectorAll('.toggle-password').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const targetId = btn.dataset.target;
                    const input = el('#' + targetId);
                    if (input) {
                        const isPassword = input.type === 'password';
                        input.type = isPassword ? 'text' : 'password';
                        btn.querySelector('i').className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
                    }
                });
            });
            
            // Compact mode selector handlers (2x2 grid version)
            document.querySelectorAll('.mode-selector-compact').forEach(selector => {
                const hiddenInput = el('#' + selector.dataset.for);
                
                // Set initial visual state
                this.updateCompactModeVisuals(selector, hiddenInput?.value || 'smart');
                
                selector.querySelectorAll('.mode-option-compact').forEach(option => {
                    option.addEventListener('click', () => {
                        const mode = option.dataset.mode;
                        if (hiddenInput) {
                            hiddenInput.value = mode;
                            hiddenInput.dispatchEvent(new Event('change'));
                        }
                        this.updateCompactModeVisuals(selector, mode);
                    });
                });
            });
            
            // Original mode selector click handlers (vertical list version)
            document.querySelectorAll('.mode-selector:not(.mode-selector-compact)').forEach(selector => {
                const hiddenInput = el('#' + selector.dataset.for);
                
                // Set initial visual state
                this.updateModeVisuals(selector, hiddenInput?.value || 'smart');
                
                selector.querySelectorAll('.mode-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const mode = option.dataset.mode;
                        if (hiddenInput) {
                            hiddenInput.value = mode;
                            // Trigger change event for conditional visibility
                            hiddenInput.dispatchEvent(new Event('change'));
                        }
                        this.updateModeVisuals(selector, mode);
                    });
                    
                    // Hover effects
                    option.addEventListener('mouseenter', () => {
                        if (!option.classList.contains('selected')) {
                            option.style.borderColor = '#cbd5e1';
                            option.style.background = '#f8fafc';
                        }
                    });
                    option.addEventListener('mouseleave', () => {
                        if (!option.classList.contains('selected')) {
                            option.style.borderColor = '#e2e8f0';
                            option.style.background = '#fff';
                        }
                    });
                });
            });
            
            // Conditional field visibility (showWhen)
            this.updateConditionalVisibility();
            document.querySelectorAll('.settings-field').forEach(field => {
                field.addEventListener('change', () => this.updateConditionalVisibility());
            });
            
            this.setupDragHandlers();
        },
        
        updateConditionalVisibility() {
            document.querySelectorAll('.settings-field-container[data-show-when-field], .settings-card[data-show-when-field]').forEach(container => {
                const watchField = container.dataset.showWhenField;
                const watchValue = container.dataset.showWhenValue;
                const watchNotValue = container.dataset.showWhenNotValue;
                const watchEl = el('#setting_' + watchField);
                
                if (watchEl) {
                    const currentValue = watchEl.type === 'checkbox' ? watchEl.checked.toString() : watchEl.value;
                    let shouldShow = true;
                    
                    if (watchValue !== undefined) {
                        shouldShow = currentValue === watchValue;
                    } else if (watchNotValue !== undefined) {
                        shouldShow = currentValue !== watchNotValue;
                    }
                    
                    container.style.display = shouldShow ? '' : 'none';
                }
            });
        },
        
        /**
         * Update mode selector visual state
         */
        updateModeVisuals(selector, selectedMode) {
            selector.querySelectorAll('.mode-option').forEach(option => {
                const isSelected = option.dataset.mode === selectedMode;
                const color = isSelected ? this.getModeColor(selectedMode) : '#e2e8f0';
                
                option.classList.toggle('selected', isSelected);
                option.style.borderColor = isSelected ? color : '#e2e8f0';
                option.style.background = isSelected ? `${color}08` : '#fff';
                
                const checkEl = option.querySelector('.mode-check');
                if (checkEl) {
                    checkEl.style.borderColor = isSelected ? color : '#e2e8f0';
                    checkEl.style.background = isSelected ? color : '#fff';
                    const checkIcon = checkEl.querySelector('i');
                    if (checkIcon) {
                        checkIcon.style.display = isSelected ? 'block' : 'none';
                    }
                }
            });
        },
        
        /**
         * Update compact mode selector visual state (CSS-based, dark mode aware)
         */
        updateCompactModeVisuals(selector, selectedMode) {
            const colors = this.getModeColor;
            selector.querySelectorAll('.mode-option-compact').forEach(option => {
                const isSelected = option.dataset.mode === selectedMode;
                const color = this.getModeColor(option.dataset.mode);
                
                option.classList.toggle('selected', isSelected);
                option.style.setProperty('--mode-color', color);
            });
        },
        
        getModeColor(mode) {
            const colors = {
                smart: '#3b82f6',
                max: '#8b5cf6', 
                light: '#10b981',
                custom: '#f59e0b'
            };
            return colors[mode] || '#3b82f6';
        },
        
        setupDragHandlers() {
            const listEl = el("#dashboardOrderList");
            if (!listEl) return;
            
            listEl.querySelectorAll('.dashboard-order-item').forEach(item => {
                item.addEventListener('dragstart', (e) => {
                    this.draggedItem = item;
                    item.classList.add('dragging');
                    item.style.opacity = '0.5';
                    e.dataTransfer.effectAllowed = 'move';
                });
                
                item.addEventListener('dragend', () => {
                    item.classList.remove('dragging');
                    item.style.opacity = '';
                    this.draggedItem = null;
                    this.updateOrderFromDOM();
                });
                
                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (!this.draggedItem || this.draggedItem === item) return;
                    
                    const rect = item.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    
                    if (e.clientY < midY) {
                        item.parentNode.insertBefore(this.draggedItem, item);
                    } else {
                        item.parentNode.insertBefore(this.draggedItem, item.nextSibling);
                    }
                });
            });
        },

        updateOrderFromDOM() {
            const items = document.querySelectorAll('.dashboard-order-item');
            this.data.dashboardOrder = Array.from(items).map(item => item.dataset.dashboard);
            this.renderSidebarPreview();
        },
        
        // Helper to find field definition by id
        getFieldDef(fieldId) {
            for (const section of SETTINGS_SCHEMA.sections) {
                if (section.fields) {
                    const field = section.fields.find(f => f.id === fieldId);
                    if (field) return field;
                }
            }
            return null;
        },

        collectFieldData() {
            // Collect values from all settings fields (skip localStorage fields)
            document.querySelectorAll('.settings-field').forEach(fieldEl => {
                const fieldId = fieldEl.dataset.field;
                const fieldDef = this.getFieldDef(fieldId);
                
                // Skip localStorage fields - they're not saved to server
                if (fieldDef?.localStorage) return;
                
                if (fieldEl.type === 'checkbox') {
                    this.data[fieldId] = fieldEl.checked;
                } else if (fieldEl.type === 'number') {
                    this.data[fieldId] = parseFloat(fieldEl.value);
                } else {
                    let value = fieldEl.value;
                    // Don't save empty strings as "undefined"
                    if (value === '' || value === 'undefined') {
                        value = '';
                    }
                    this.data[fieldId] = value;
                }
            });
            
            // Collect dashboard names
            this.data.dashboardNames = {};
            document.querySelectorAll('.dashboard-name').forEach(input => {
                this.data.dashboardNames[input.dataset.dashboard] = input.value;
            });
            
            // Collect dashboard visibility
            this.data.dashboardVisibility = {};
            document.querySelectorAll('.dashboard-visibility').forEach(cb => {
                this.data.dashboardVisibility[cb.dataset.dashboard] = cb.checked;
            });
        },

        async save() {
            this.collectFieldData();
            this.updateOrderFromDOM();

            try {
                const res = await API.post('save_main_config', this.data);
                if (res.status === 'success') {
                    showToast("Settings saved!");
                    this.applySidebarSettings();
                } else {
                    alert('Error saving: ' + res.message);
                }
            } catch(e) {
                console.error(e);
                alert('Error saving settings');
            }
        },

        // ==========================================
        // PERMISSIONS MANAGEMENT
        // ==========================================

        /**
         * Load permissions configuration and roles list
         */
        async loadPermissionsConfig() {
            try {
                // Load permissions config and roles in parallel
                const [permRes, rolesRes, mainConfigRes] = await Promise.all([
                    API.get('permissions_config'),
                    API.get('roles'),
                    API.get('main_config')
                ]);

                // Store permissions data
                this._permissionsData = permRes?.config || this.getDefaultPermissions();
                this._rolesList = rolesRes?.roles || [];
                this._subsidiariesList = mainConfigRes?.subsidiaries || [];

                // Render permissions UI
                this.renderPermissionsUI();
                this.setupPermissionsEventListeners();

            } catch (e) {
                console.error('Failed to load permissions config:', e);
                // Show error state
                const section = el('#permissionsSection');
                if (section) {
                    section.querySelector('.card-body').innerHTML = `
                        <div class="alert alert-warning">
                            <i class="fas fa-exclamation-triangle mr-2"></i>
                            Failed to load permissions configuration.
                            <button class="btn btn-sm btn-link" onclick="SettingsController.loadPermissionsConfig()">Retry</button>
                        </div>
                    `;
                }
            }
        },

        /**
         * Get default permissions configuration (client-side fallback)
         * NOTE: This mirrors Lib_Permissions.getDefaultPermissions() on the server.
         * Kept as client-side copy because client code cannot import server-side modules.
         * If you modify this, update Lib_Permissions.js:46 as well.
         */
        getDefaultPermissions() {
            return {
                enabled: false,
                roles: {
                    '3': { dashboards: ['*'], subsidiaries: ['*'] }
                },
                defaultPermissions: {
                    dashboards: ['*'],
                    subsidiaries: ['*']
                },
                auditEnabled: false
            };
        },

        renderPermissionsUI() {
            // Update enabled checkbox
            const enabledCheckbox = el('#permissionsEnabled');
            if (enabledCheckbox) {
                enabledCheckbox.checked = this._permissionsData?.enabled === true;
            }

            // Show/hide config area based on enabled state
            const configArea = el('#permissionsConfigArea');
            if (configArea) {
                configArea.style.display = this._permissionsData?.enabled ? 'block' : 'none';
            }

            // Populate roles dropdown
            const roleSelector = el('#roleSelector');
            if (roleSelector) {
                let html = '<option value="">Select a role...</option>';

                // Filter out Administrator (ID 3) as it always has full access
                const configurableRoles = this._rolesList.filter(r => String(r.id) !== '3');

                configurableRoles.forEach(role => {
                    const hasCustomConfig = this._permissionsData?.roles?.[String(role.id)];
                    const badge = hasCustomConfig ? ' (configured)' : '';
                    html += `<option value="${role.id}">${role.name}${badge}</option>`;
                });

                roleSelector.innerHTML = html;
            }

            // If a role was previously selected, keep it selected and render its permissions
            if (this._selectedRoleId) {
                const roleSelector = el('#roleSelector');
                if (roleSelector) {
                    roleSelector.value = this._selectedRoleId;
                }
                this.renderRolePermissions(this._selectedRoleId);
            }
        },

        renderRolePermissions(roleId) {
            this._selectedRoleId = roleId;

            const dashContainer = el('#roleDashboardPermissions');
            const subContainer = el('#roleSubsidiaryPermissions');

            if (!roleId) {
                if (dashContainer) dashContainer.innerHTML = '<p class="text-muted mb-0">Select a role to configure permissions</p>';
                if (subContainer) subContainer.innerHTML = '<p class="text-muted mb-0">Select a role to configure subsidiary access</p>';
                return;
            }

            // Get role permissions (or defaults)
            const rolePerms = this._permissionsData?.roles?.[String(roleId)] ||
                              this._permissionsData?.defaultPermissions ||
                              { dashboards: ['*'], subsidiaries: ['*'] };

            // Render dashboard permissions
            if (dashContainer) {
                const allDashboards = rolePerms.dashboards?.includes('*');

                let html = `
                    <div class="mb-2">
                        <span class="perm-all-access ${allDashboards ? 'selected' : ''}" data-value="*">
                            <i class="fas fa-check-double mr-1"></i>All Dashboards
                        </span>
                    </div>
                    <div class="perm-dash-list" style="${allDashboards ? 'opacity: 0.5; pointer-events: none;' : ''}">
                `;

                SETTINGS_SCHEMA.dashboards.forEach(dash => {
                    const isAllowed = allDashboards || rolePerms.dashboards?.includes(dash.id);
                    html += `
                        <div class="perm-dash-item">
                            <div class="custom-control custom-switch">
                                <input type="checkbox" class="custom-control-input perm-dash-checkbox"
                                    id="perm_dash_${dash.id}" data-dashboard="${dash.id}" ${isAllowed ? 'checked' : ''}>
                                <label class="custom-control-label" for="perm_dash_${dash.id}"></label>
                            </div>
                            <i class="fas ${dash.icon} ${dash.color} mr-2"></i>
                            <span>${dash.defaultName}</span>
                        </div>
                    `;
                });

                html += '</div>';
                dashContainer.innerHTML = html;
            }

            // Render subsidiary permissions
            if (subContainer) {
                const allSubsidiaries = rolePerms.subsidiaries?.includes('*');

                let html = `
                    <div class="mb-2">
                        <span class="perm-all-access ${allSubsidiaries ? 'selected' : ''}" data-sub-value="*">
                            <i class="fas fa-check-double mr-1"></i>All Subsidiaries
                        </span>
                    </div>
                    <div class="perm-sub-list" style="${allSubsidiaries ? 'opacity: 0.5; pointer-events: none;' : ''}">
                `;

                if (this._subsidiariesList.length === 0) {
                    html += '<span class="text-muted">No subsidiaries found (single-company account)</span>';
                } else {
                    this._subsidiariesList.forEach(sub => {
                        const isAllowed = allSubsidiaries || rolePerms.subsidiaries?.includes(String(sub.id)) || rolePerms.subsidiaries?.includes(parseInt(sub.id));
                        html += `
                            <span class="perm-sub-item ${isAllowed ? 'selected' : ''}" data-subsidiary="${sub.id}">
                                ${sub.name}
                            </span>
                        `;
                    });
                }

                html += '</div>';
                subContainer.innerHTML = html;
            }
        },

        setupPermissionsEventListeners() {
            // Enable/disable toggle
            el('#permissionsEnabled')?.addEventListener('change', (e) => {
                this._permissionsData.enabled = e.target.checked;
                const configArea = el('#permissionsConfigArea');
                if (configArea) {
                    configArea.style.display = e.target.checked ? 'block' : 'none';
                }
            });

            // Role selector
            el('#roleSelector')?.addEventListener('change', (e) => {
                this.renderRolePermissions(e.target.value);
            });

            // Dashboard "All Dashboards" toggle
            el('#roleDashboardPermissions')?.addEventListener('click', (e) => {
                const allAccess = e.target.closest('.perm-all-access[data-value="*"]');
                if (allAccess) {
                    const isSelected = allAccess.classList.toggle('selected');
                    this.updateRoleDashboardPermissions(isSelected ? ['*'] : []);

                    // Update visual state
                    const dashList = el('.perm-dash-list');
                    if (dashList) {
                        dashList.style.opacity = isSelected ? '0.5' : '1';
                        dashList.style.pointerEvents = isSelected ? 'none' : 'auto';
                    }
                }
            });

            // Individual dashboard toggles
            el('#roleDashboardPermissions')?.addEventListener('change', (e) => {
                if (e.target.classList.contains('perm-dash-checkbox')) {
                    this.collectAndUpdateDashboardPermissions();
                }
            });

            // Subsidiary "All Subsidiaries" toggle
            el('#roleSubsidiaryPermissions')?.addEventListener('click', (e) => {
                const allAccess = e.target.closest('.perm-all-access[data-sub-value="*"]');
                if (allAccess) {
                    const isSelected = allAccess.classList.toggle('selected');
                    this.updateRoleSubsidiaryPermissions(isSelected ? ['*'] : []);

                    // Update visual state
                    const subList = el('.perm-sub-list');
                    if (subList) {
                        subList.style.opacity = isSelected ? '0.5' : '1';
                        subList.style.pointerEvents = isSelected ? 'none' : 'auto';
                    }
                }

                // Individual subsidiary toggles
                const subItem = e.target.closest('.perm-sub-item');
                if (subItem && !subItem.classList.contains('perm-all-access')) {
                    subItem.classList.toggle('selected');
                    this.collectAndUpdateSubsidiaryPermissions();
                }
            });

            // Save button
            el('#btnSavePermissions')?.addEventListener('click', () => this.savePermissions());

            // Reset button
            el('#btnResetPermissions')?.addEventListener('click', () => {
                if (confirm('Reset permissions to defaults? All roles will have access to all dashboards.')) {
                    this._permissionsData = this.getDefaultPermissions();
                    this.renderPermissionsUI();
                    showToast('Permissions reset to defaults (not saved yet)');
                }
            });
        },

        updateRoleDashboardPermissions(dashboards) {
            if (!this._selectedRoleId) return;

            const roleKey = String(this._selectedRoleId);
            if (!this._permissionsData.roles) {
                this._permissionsData.roles = {};
            }
            if (!this._permissionsData.roles[roleKey]) {
                this._permissionsData.roles[roleKey] = {
                    dashboards: ['*'],
                    subsidiaries: ['*']
                };
            }
            this._permissionsData.roles[roleKey].dashboards = dashboards;
        },

        updateRoleSubsidiaryPermissions(subsidiaries) {
            if (!this._selectedRoleId) return;

            const roleKey = String(this._selectedRoleId);
            if (!this._permissionsData.roles) {
                this._permissionsData.roles = {};
            }
            if (!this._permissionsData.roles[roleKey]) {
                this._permissionsData.roles[roleKey] = {
                    dashboards: ['*'],
                    subsidiaries: ['*']
                };
            }
            this._permissionsData.roles[roleKey].subsidiaries = subsidiaries;
        },

        collectAndUpdateDashboardPermissions() {
            const checkboxes = document.querySelectorAll('.perm-dash-checkbox:checked');
            const dashboards = Array.from(checkboxes).map(cb => cb.dataset.dashboard);
            this.updateRoleDashboardPermissions(dashboards.length > 0 ? dashboards : []);
        },

        collectAndUpdateSubsidiaryPermissions() {
            const selected = document.querySelectorAll('.perm-sub-item.selected:not(.perm-all-access)');
            const subsidiaries = Array.from(selected).map(el => el.dataset.subsidiary);
            this.updateRoleSubsidiaryPermissions(subsidiaries.length > 0 ? subsidiaries : []);
        },

        async savePermissions() {
            try {
                // Ensure admin always has full access
                if (!this._permissionsData.roles) {
                    this._permissionsData.roles = {};
                }
                this._permissionsData.roles['3'] = {
                    dashboards: ['*'],
                    subsidiaries: ['*']
                };

                const res = await API.post('save_permissions_config', this._permissionsData);

                if (res.status === 'success') {
                    showToast('Permissions saved successfully!');
                    // Update the role selector to show (configured) badges
                    this.renderPermissionsUI();
                } else {
                    alert('Error saving permissions: ' + (res.message || 'Unknown error'));
                }
            } catch (e) {
                console.error('Failed to save permissions:', e);
                alert('Error saving permissions: ' + e.message);
            }
        },

        /**
         * Apply settings to the actual sidebar
         */
        applySidebarSettings() {
            const nav = document.querySelector('.gantry-nav');
            if (!nav) return;

            const order = this.data.dashboardOrder || [];
            
            // Update visibility and names
            SETTINGS_SCHEMA.dashboards.forEach(dash => {
                const navItem = nav.querySelector(`[data-route="${dash.route}"]`)?.closest('.gantry-nav-item');
                const navLink = nav.querySelector(`[data-route="${dash.route}"]`);
                
                if (navItem) {
                    const visible = this.data.dashboardVisibility?.[dash.id] !== false;
                    navItem.style.display = visible ? '' : 'none';
                }
                
                if (navLink) {
                    const name = this.data.dashboardNames?.[dash.id] || dash.defaultName;
                    // Update the text inside span (preserve span for collapsed state CSS)
                    const icon = navLink.querySelector('i');
                    const existingSpan = navLink.querySelector('span');
                    if (existingSpan) {
                        existingSpan.textContent = name;
                    } else if (icon) {
                        // Rebuild with span wrapper for collapsed state compatibility
                        navLink.innerHTML = '';
                        navLink.appendChild(icon);
                        const span = document.createElement('span');
                        span.textContent = name;
                        navLink.appendChild(document.createTextNode(' '));
                        navLink.appendChild(span);
                    }
                }
            });

            // Reorder sidebar items based on dashboardOrder
            const settingsItem = nav.querySelector('[data-route="settings"]')?.closest('.gantry-nav-item');
            const ul = nav.querySelector('ul') || nav;
            
            order.forEach(dashId => {
                const dash = SETTINGS_SCHEMA.dashboards.find(d => d.id === dashId);
                if (dash) {
                    const navItem = nav.querySelector(`[data-route="${dash.route}"]`)?.closest('.gantry-nav-item');
                    if (navItem && settingsItem) {
                        ul.insertBefore(navItem, settingsItem);
                    }
                }
            });
        },

        /**
         * Load and apply sidebar settings on app startup
         * Call this from Gantry.App.js after Router setup
         */
        async loadAndApplySidebarSettings() {
            try {
                const res = await API.get('main_config');
                if (res.config) {
                    this.data = { ...this.getDefaults(), ...res.config };
                    this.mergeDashboardsFromSchema();
                    this.applySidebarSettings();
                }
            } catch(e) {
                // Could not load main config, using defaults
            }
        },

        // ==========================================
        // TAB MANAGEMENT
        // ==========================================

        /**
         * Switch to a specific tab
         */
        switchTab(tabId) {
            // Update tab links
            document.querySelectorAll('.settings-tab-link').forEach(link => {
                link.classList.toggle('active', link.dataset.tab === tabId);
            });

            // Update tab panes
            document.querySelectorAll('.settings-tab-pane').forEach(pane => {
                pane.classList.toggle('active', pane.dataset.tab === tabId);
            });

            // Store current tab
            this._currentTab = tabId;
        },

        // ==========================================
        // LICENSE MANAGEMENT
        // ==========================================

        /**
         * Handle license check/refresh
         */
        async onCheckLicense() {
            const btn = el('#btnCheckLicense');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Checking...';
            }

            try {
                // Collect and save the license key first if it changed
                const licenseKeyInput = el('#setting_licenseKey');
                if (licenseKeyInput && licenseKeyInput.value) {
                    this.data.licenseKey = licenseKeyInput.value;

                    // Save to server to trigger license refresh
                    const saveRes = await API.post('save_main_config', this.data);

                    if (saveRes.licenseStatus) {
                        // Update global config and License object
                        window.GANTRY_CONFIG.license = saveRes.licenseStatus;
                        License.update(saveRes.licenseStatus);

                        // Re-render license status section
                        this.updateLicenseStatusDisplay(saveRes.licenseStatus);

                        if (saveRes.licenseStatus.valid) {
                            showToast('License activated successfully!');
                        } else {
                            showToast('License key is invalid or expired', 'error');
                        }
                    }
                } else {
                    // Just refresh status without saving
                    const status = await License.refresh();
                    this.updateLicenseStatusDisplay(status);
                    showToast('License status refreshed');
                }
            } catch (e) {
                console.error('License check failed:', e);
                showToast('Failed to check license: ' + e.message, 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-check-circle mr-2"></i>Verify License';
                }
            }
        },

        /**
         * Update license status display after refresh
         */
        updateLicenseStatusDisplay(licenseData) {
            const statusSection = el('#licenseStatusSection');
            if (!statusSection) return;

            const statusClass = licenseData.valid ? 'valid' :
                               (licenseData.status === 'expired' ? 'expired' :
                               (licenseData.isOffline ? 'offline' : 'invalid'));
            const statusLabel = licenseData.valid ? 'Active' :
                               (licenseData.status === 'expired' ? 'Expired' :
                               (licenseData.isOffline ? 'Offline Mode' : 'Invalid'));
            const statusIcon = licenseData.valid ? 'fa-check-circle' :
                              (licenseData.status === 'expired' ? 'fa-clock' :
                              (licenseData.isOffline ? 'fa-wifi' : 'fa-times-circle'));

            // Update badge
            const badge = statusSection.querySelector('.license-status-badge');
            if (badge) {
                badge.className = `license-status-badge ${statusClass}`;
                badge.innerHTML = `<i class="fas ${statusIcon} mr-2"></i>${statusLabel}`;
            }

            // Update info rows
            const licensedTo = el('#licensedToDisplay');
            if (licensedTo) licensedTo.textContent = licenseData.licensedTo || 'Not licensed';

            const tierDisplay = el('#licenseTierDisplay');
            if (tierDisplay) tierDisplay.textContent = licenseData.tierLabel || licenseData.tier || 'N/A';

            const expiresDisplay = el('#licenseExpiresDisplay');
            if (expiresDisplay) expiresDisplay.textContent = licenseData.expiresAt ? License.formatExpiry(licenseData.expiresAt) : 'N/A';
        }
    };

    // ==========================================
    // EXPOSE & REGISTER
    // ==========================================
    window.SettingsController = SettingsController;
    window.MainConfigController = SettingsController; // Alias for backwards compatibility
    
    Router.register('settings', () => SettingsController.init());

})(window);