/**
 * Dashboard.Burden.js
 * RATE ENGINE 2.0 - World-Class Overhead Rate Calculator
 * 
 * A comprehensive burden/overhead costing suite with:
 * - Multi-base allocation visualization (hours, labor$, headcount, revenue)
 * - Interactive rate matrix with cell-level drilldown
 * - Drag-drop account classification with auto-matching
 * - Real-time scenario modeling with save/load
 * - Selling rate calculator with sensitivity analysis
 * - 6-period trend charts per category
 * - Budget variance tracking and absorption monitoring
 * - Rich flyout system for all drilldowns
 * - Full pagination and sortable columns
 * - Professional export capabilities
 */
(function(window) {
    'use strict';

    const BurdenController = {
        _version: 'v2.0-world-class',
        latestData: null,
        subsidiaries: [],
        subsidiaryId: null,
        currencySymbol: '$',
        fiscalCalendar: null,
        activeTab: 'dashboard',
        
        // Pagination state for each table
        pagination: {
            accounts: { page: 1, pageSize: 25, sortCol: 'amount', sortDir: 'desc' },
            unassigned: { page: 1, pageSize: 20, sortCol: 'amount', sortDir: 'desc' },
            categoryAccounts: { page: 1, pageSize: 15, sortCol: 'amount', sortDir: 'desc' },
            transactions: { page: 1, pageSize: 25, sortCol: 'date', sortDir: 'desc' },
            unbilled: { page: 1, pageSize: 20, sortCol: 'totalCost', sortDir: 'desc' },
            scenarios: { page: 1, pageSize: 10, sortCol: 'updatedAt', sortDir: 'desc' }
        },
        
        // Sort state
        tableSort: {},
        
        // Flyout context
        flyoutContext: null,
        
        // Category colors
        colors: {
            L: '#3b82f6',
            EMC: '#10b981',
            T: '#f59e0b',
            A: '#8b5cf6',
            O: '#ec4899',
            U: '#6b7280'
        },
        
        // View state
        ratesGroupedByType: false,

        // ════════════════════════════════════════════════════════════════════════
        // INITIALIZATION
        // ════════════════════════════════════════════════════════════════════════

        init: function() {
            this.loadPersistedRateBuilds();
            this.setupUI();
        },

        setupUI: function() {
            el('#gantry-view-container').innerHTML = this.getTemplate();
            this.showLoadingState();
            this.bindEvents();
            this.loadConfig();
        },

        getTemplate: function() {
            return '<div class="cf-dashboard burden-dashboard p-0">' +
                // Controls Row with Profile Selector
                '<div class="row mb-3">' +
                    '<div class="col-md-12">' +
                        '<form class="form-inline justify-content-center align-items-center" id="burdenDateForm" onsubmit="return false;">' +
                            // Profile Selector with action icons
                            '<div class="profile-selector-inline mr-3">' +
                                '<label class="small text-muted mr-1"><i class="fas fa-folder-open mr-1"></i>Profile:</label>' +
                                '<select class="form-control form-control-sm" id="burdenProfileSelect" style="min-width: 140px;" onchange="BurdenController.switchProfile(this.value)"></select>' +
                                '<button type="button" class="btn btn-sm btn-link p-1 ml-1" onclick="BurdenController.showAddProfileFlyout()" title="New Profile"><i class="fas fa-plus"></i></button>' +
                                '<button type="button" class="btn btn-sm btn-link p-1" onclick="BurdenController.showProfileSettings()" title="Edit Profile"><i class="fas fa-cog"></i></button>' +
                            '</div>' +
                            '<div class="border-left mx-2" style="height: 24px;"></div>' +
                            '<select class="form-control form-control-sm mr-3" id="burdenSubsidiary" style="max-width: 200px;"></select>' +
                            '<label class="mr-2 small text-muted">From:</label>' +
                            '<input type="date" class="form-control form-control-sm mr-2" id="burdenStartDate">' +
                            '<label class="mr-2 small text-muted">To:</label>' +
                            '<input type="date" class="form-control form-control-sm mr-3" id="burdenEndDate">' +
                            '<button type="button" class="btn btn-sm btn-primary" id="burdenApplyRange"><i class="fas fa-sync-alt mr-1"></i> Apply</button>' +
                        '</form>' +
                    '</div>' +
                '</div>' +
                // KPI Row
                '<div class="row mb-2 gutters-sm cf-kpi-row">' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-blue-soft"><i class="fas fa-tachometer-alt text-blue"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Composite Rate</span>' +
                                '<span class="kpi-value" id="burdenCompositeRate">--</span>' +
                                '<span class="kpi-sub" id="burdenRateChange">--</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-red-soft"><i class="fas fa-money-bill-wave text-red"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Total Overhead</span>' +
                                '<span class="kpi-value" id="totalexpenses">--</span>' +
                                '<span class="kpi-sub" id="burdenAccountCount">-- accounts</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-green-soft"><i class="fas fa-hand-holding-usd text-green"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Burden Applied</span>' +
                                '<span class="kpi-value" id="burdenapplied">--</span>' +
                                '<span class="kpi-sub" id="burdenAppliedStatus">--</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-purple-soft" id="spread-icon-bg"><i class="fas fa-balance-scale text-purple" id="spread-icon"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Absorption</span>' +
                                '<span class="kpi-value" id="burdenexpensesspread">--</span>' +
                                '<span class="kpi-sub" id="spread-status">--</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-yellow-soft"><i class="fas fa-clock text-yellow"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Billed Hours</span>' +
                                '<span class="kpi-value" id="burdenTotalHours">--</span>' +
                                '<span class="kpi-sub"><span id="burdenUtilization">--</span> utilization</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // Main Card with Tabs
                '<div class="card cf-main-card shadow-sm">' +
                    '<div class="card-header border-0 bg-white pt-3 pb-1 px-3">' +
                        '<ul class="nav nav-tabs cf-tabs" id="burdenTabs">' +
                            '<li class="nav-item"><a class="nav-link active" id="dash-tab" data-toggle="tab" href="#burden-dashboard"><i class="fas fa-home mr-2"></i>Overview</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="cat-tab" data-toggle="tab" href="#burden-categories"><i class="fas fa-layer-group mr-2"></i>Categories</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="rates-tab" data-toggle="tab" href="#burden-rates"><i class="fas fa-table mr-2"></i>Matrix</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="mod-tab" data-toggle="tab" href="#burden-modeler"><i class="fas fa-balance-scale mr-2"></i>Absorption</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="sell-tab" data-toggle="tab" href="#burden-selling"><i class="fas fa-calculator mr-2"></i>Selling Rate</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="hist-tab" data-toggle="tab" href="#burden-history"><i class="fas fa-chart-line mr-2"></i>Trends</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="cfg-tab" data-toggle="tab" href="#burden-config"><i class="fas fa-cogs mr-2"></i>Configuration</a></li>' +
                        '</ul>' +
                    '</div>' +
                    '<div class="card-body p-0">' +
                        '<div class="tab-content">' +
                            '<div class="tab-pane fade show active" id="burden-dashboard"><div class="tab-inner p-3" id="burdenDashboardContent"></div></div>' +
                            '<div class="tab-pane fade" id="burden-categories"><div class="tab-inner p-3" id="burdenCategoriesContent"></div></div>' +
                            '<div class="tab-pane fade" id="burden-rates"><div class="tab-inner p-3" id="burdenRatesContent"></div></div>' +
                            '<div class="tab-pane fade" id="burden-modeler"><div class="tab-inner p-3" id="burdenModelerContent"></div></div>' +
                            '<div class="tab-pane fade" id="burden-selling"><div class="tab-inner p-3" id="burdenSellingContent"></div></div>' +
                            '<div class="tab-pane fade" id="burden-history"><div class="tab-inner p-3" id="burdenHistoryContent"></div></div>' +
                            '<div class="tab-pane fade" id="burden-config"><div class="tab-inner p-3" id="burdenConfigContent"></div></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // Flyout Panel
                '<div id="burdenFlyout" class="burden-flyout">' +
                    '<div class="flyout-overlay" onclick="BurdenController.closeFlyout()"></div>' +
                    '<div class="flyout-panel">' +
                        '<div class="flyout-header">' +
                            '<span id="flyoutTitle"><i class="fas fa-cog mr-2"></i>Configuration</span>' +
                            '<button class="flyout-close" onclick="BurdenController.closeFlyout()"><i class="fas fa-times"></i></button>' +
                        '</div>' +
                        '<div class="flyout-subtitle text-muted small px-3 py-1 bg-light border-bottom" id="flyoutSubtitle" style="display:none;"></div>' +
                        '<div class="flyout-stats" id="flyoutStats"></div>' +
                        '<div class="flyout-tabs" id="flyoutTabs" style="display:none;"></div>' +
                        '<div class="flyout-body" id="flyoutBody"></div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        },

        bindEvents: function() {
            var self = this;

            // Subsidiary dropdown
            var subEl = el('#burdenSubsidiary');
            if (subEl) {
                subEl.addEventListener('change', function(e) {
                    self.subsidiaryId = e.target.value;
                    self.loadData();
                });
            }

            // Apply date range
            var applyBtn = el('#burdenApplyRange');
            if (applyBtn) {
                applyBtn.addEventListener('click', function() { self.loadData(); });
            }

            // Tab events
            if (window.jQuery) {
                jQuery('#burdenTabs a[data-toggle="tab"]').on('click', function(e) {
                    e.preventDefault();
                    jQuery(this).tab('show');
                });

                jQuery(document).on('shown.bs.tab', '#dash-tab', function() { self.renderDashboardTab(); });
                jQuery(document).on('shown.bs.tab', '#cat-tab', function() { self.renderCategoriesTab(); });
                jQuery(document).on('shown.bs.tab', '#rates-tab', function() { self.renderRatesTab(); });
                jQuery(document).on('shown.bs.tab', '#mod-tab', function() { self.renderModelerTab(); });
                jQuery(document).on('shown.bs.tab', '#sell-tab', function() { self.renderSellingTab(); });
                jQuery(document).on('shown.bs.tab', '#hist-tab', function() { self.renderHistoryTab(); });
                jQuery(document).on('shown.bs.tab', '#cfg-tab', function() { self.renderConfigTab(); });
            }

            // Keyboard escape to close flyout
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') self.closeFlyout();
            });
        },

        showLoadingState: function() {
            var self = this;
            
            // Set loading flag to true
            this.isLoading = true;
            if (typeof Utils !== 'undefined' && Utils.isDebugMode) {
                console.log('%c[Burden] Loading state: START', 'color: #f59e0b;');
            }
            
            // KPI skeletons
            var kpiIds = ['burdenCompositeRate', 'totalexpenses', 'burdenapplied', 'burdenexpensesspread', 'burdenTotalHours'];
            kpiIds.forEach(function(id) {
                var el_ = el('#' + id);
                if (el_) el_.innerHTML = Skeleton.render('custom', { width: '60px', height: '1.5rem' });
            });

            // Show skeletons for ALL tabs based on loading state
            this.showTabSkeletons();
        },
        
        showTabSkeletons: function() {
            var self = this;
            
            // Dashboard tab skeleton
            var dashContent = el('#burdenDashboardContent');
            if (dashContent) {
                dashContent.innerHTML = '<div class="overview-skeleton p-3">' +
                    '<div class="row mb-3">' +
                        '<div class="col-md-5"><div class="chart-skeleton skeleton-loading"></div></div>' +
                        '<div class="col-md-7"><div class="chart-skeleton skeleton-loading"></div></div>' +
                    '</div>' +
                    Skeleton.render('table', { rows: 6, cols: 5 }) +
                '</div>';
            }
            
            // Categories tab skeleton  
            var catContent = el('#burdenCategoriesContent');
            if (catContent) {
                catContent.innerHTML = '<div class="category-table-skeleton">' +
                    '<div class="d-flex justify-content-between align-items-center mb-3">' +
                        '<div class="skeleton-cell name skeleton-loading" style="width: 200px; height: 24px;"></div>' +
                        '<div class="skeleton-cell skeleton-loading" style="width: 100px; height: 32px;"></div>' +
                    '</div>' +
                    [1,2,3,4,5,6,7,8].map(function() {
                        return '<div class="skeleton-row">' +
                            '<div class="skeleton-cell color skeleton-loading"></div>' +
                            '<div class="skeleton-cell name skeleton-loading"></div>' +
                            '<div class="skeleton-cell type skeleton-loading"></div>' +
                            '<div class="skeleton-cell amount skeleton-loading"></div>' +
                            '<div class="skeleton-cell rate skeleton-loading"></div>' +
                            '<div class="skeleton-cell actions skeleton-loading"></div>' +
                        '</div>';
                    }).join('') +
                '</div>';
            }
            
            // Rates tab skeleton
            var ratesContent = el('#burdenRatesContent');
            if (ratesContent) {
                ratesContent.innerHTML = '<div class="p-3">' +
                    Skeleton.render('kpi', { count: 4 }) +
                    '<div class="row mt-3">' +
                        '<div class="col-lg-8"><div class="chart-skeleton skeleton-loading" style="height: 350px;"></div></div>' +
                        '<div class="col-lg-4"><div class="chart-skeleton skeleton-loading" style="height: 350px;"></div></div>' +
                    '</div>' +
                '</div>';
            }
            
            // Modeler tab skeleton
            var modelerContent = el('#burdenModelerContent');
            if (modelerContent) {
                modelerContent.innerHTML = '<div class="p-3">' +
                    Skeleton.render('kpi', { count: 4 }) +
                    '<div class="row mt-3">' +
                        '<div class="col-12"><div class="chart-skeleton skeleton-loading" style="height: 300px;"></div></div>' +
                    '</div>' +
                    '<div class="mt-3">' + Skeleton.render('table', { rows: 6, cols: 8 }) + '</div>' +
                '</div>';
            }
            
            // Selling tab skeleton
            var sellingContent = el('#burdenSellingContent');
            if (sellingContent) {
                sellingContent.innerHTML = '<div class="p-3">' +
                    '<div class="row">' +
                        '<div class="col-md-4"><div class="chart-skeleton skeleton-loading" style="height: 100px;"></div></div>' +
                        '<div class="col-md-4"><div class="chart-skeleton skeleton-loading" style="height: 100px;"></div></div>' +
                        '<div class="col-md-4"><div class="chart-skeleton skeleton-loading" style="height: 100px;"></div></div>' +
                    '</div>' +
                    '<div class="mt-3">' + Skeleton.render('table', { rows: 5, cols: 4 }) + '</div>' +
                '</div>';
            }
            
            // Trends/History tab skeleton
            var historyContent = el('#burdenHistoryContent');
            if (historyContent) {
                historyContent.innerHTML = '<div class="p-3">' +
                    '<div class="row">' +
                        '<div class="col-lg-7"><div class="chart-skeleton skeleton-loading" style="height: 400px;"></div></div>' +
                        '<div class="col-lg-5"><div class="chart-skeleton skeleton-loading" style="height: 400px;"></div></div>' +
                    '</div>' +
                '</div>';
            }
            
            // Config tab skeleton
            var configContent = el('#burdenConfigContent');
            if (configContent) {
                configContent.innerHTML = '<div class="p-3">' +
                    '<div class="row mb-3">' +
                        '<div class="col-md-6"><div class="chart-skeleton skeleton-loading" style="height: 200px;"></div></div>' +
                        '<div class="col-md-6"><div class="chart-skeleton skeleton-loading" style="height: 200px;"></div></div>' +
                    '</div>' +
                    Skeleton.render('table', { rows: 8, cols: 5 }) +
                '</div>';
            }
        },

        // ════════════════════════════════════════════════════════════════════════
        // DATA LOADING
        // ════════════════════════════════════════════════════════════════════════

        loadConfig: function() {
            var self = this;
            API.get('burden_config').then(function(res) {
                self.subsidiaries = res.subsidiaries || [];
                self.fiscalCalendar = res.fiscalCalendar || {};
                self.renderSubsidiaryDropdown();
                
                // Set fiscal year defaults
                var startEl = el('#burdenStartDate');
                var endEl = el('#burdenEndDate');
                if (self.fiscalCalendar.fiscalYearStartDate) {
                    if (startEl && !startEl.value) startEl.value = self.fiscalCalendar.fiscalYearStartDate;
                }
                
                // For end date, prefer latest closed period (complete data) over current date
                if (endEl && !endEl.value) {
                    var closedPeriod = self.fiscalCalendar.latestClosedPeriod;
                    if (closedPeriod && closedPeriod.endDate) {
                        // Use latest closed period end date for burden (ensures complete accounting data)
                        endEl.value = closedPeriod.endDate;
                        console.log('[Burden] Using latest closed period end date:', closedPeriod.endDate, '(' + closedPeriod.periodName + ')');
                    } else if (self.fiscalCalendar.fiscalYearEndDate) {
                        // Fallback: use fiscal year end or today, whichever is earlier
                        var fyEnd = new Date(self.fiscalCalendar.fiscalYearEndDate);
                        var today = new Date();
                        endEl.value = fyEnd > today ? today.toISOString().split('T')[0] : self.fiscalCalendar.fiscalYearEndDate;
                    }
                }
                
                self.loadData();
            }).catch(function(err) {
                console.error('Config load error:', err);
                self.loadData();
            });
        },

        renderSubsidiaryDropdown: function() {
            var dd = el('#burdenSubsidiary');
            if (!dd) return;

            var opts = '<option value="">All Subsidiaries</option>';
            this.subsidiaries.forEach(function(s) {
                opts += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>';
            });
            dd.innerHTML = opts;
        },

        loadData: function(lightRefresh) {
            var self = this;
            this.showLoadingState();

            // Set button loading state
            var applyBtn = el('#burdenApplyRange');
            if (applyBtn) applyBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading';

            var startEl = el('#burdenStartDate');
            var endEl = el('#burdenEndDate');
            var params = {};
            
            if (startEl && startEl.value) params.startDate = startEl.value;
            if (endEl && endEl.value) params.endDate = endEl.value;
            if (this.subsidiaryId) params.subsidiaryId = this.subsidiaryId;
            
            // Light refresh mode - skips expensive calculations (history, forecast, unbilledDetail)
            if (lightRefresh) {
                params.lightRefresh = true;
                console.log('%c[Burden] LIGHT REFRESH MODE ACTIVATED - skipping history/forecast', 'color: #f59e0b; font-weight: bold; font-size: 14px;');
            } else {
                console.log('%c[Burden] FULL REFRESH - loading all data', 'color: #3b82f6; font-weight: bold;');
            }

            return API.get('burden', params).then(function(res) {
                var newData = res.data || res;
                
                // If this was a light refresh, merge with existing data
                if (lightRefresh && self.latestData && newData.meta?.lightRefresh) {
                    console.log('%c[Burden] Merging light refresh data with existing data', 'color: #10b981;');
                    
                    // Keep existing heavy data that wasn't recalculated
                    if (!newData.history && self.latestData.history) {
                        newData.history = self.latestData.history;
                    }
                    if (!newData.categoryHistory && self.latestData.categoryHistory) {
                        newData.categoryHistory = self.latestData.categoryHistory;
                    }
                    if (!newData.unbilledDetail && self.latestData.unbilledDetail) {
                        newData.unbilledDetail = self.latestData.unbilledDetail;
                    }
                    if (!newData.forecast && self.latestData.forecast) {
                        newData.forecast = self.latestData.forecast;
                    }
                }
                
                self.latestData = newData;
                self.isLoading = false; // Clear loading state
                
                if (typeof Utils !== 'undefined' && Utils.isDebugMode) {
                    console.log('%c[Burden] Loading state: COMPLETE (isLoading=' + self.isLoading + ')', 'color: #10b981;');
                }
                
                // Log diagnostics if available (debug mode)
                if (self.latestData.diagnostics) {
                    console.group('%c[BURDEN] Performance Diagnostics' + (lightRefresh ? ' (LIGHT REFRESH)' : ''), 'color: #3b82f6; font-weight: bold;');
                    console.log('%cTotal Time: ' + self.latestData.diagnostics.timings.total + 'ms', 'font-weight: bold;');
                    console.log('%cSlowest Operations:', 'color: #ef4444;');
                    console.table(self.latestData.diagnostics.slowestOperations);
                    console.log('%cAll Timings (sorted by duration):', 'color: #f59e0b;');
                    console.table(self.latestData.diagnostics.timings);
                    console.log('%cData Counts:', 'color: #10b981;');
                    console.table(self.latestData.diagnostics.counts);
                    console.groupEnd();
                } else {
                    console.log('%c[Burden] No diagnostics in response (advisorDebugMode may be disabled in Settings > Main Config)', 'color: #f59e0b;');
                }
                
                if (applyBtn) applyBtn.innerHTML = '<i class="fas fa-sync-alt mr-1"></i> Apply';
                self.updateProfileSelector();
                self.renderAll();
                return self.latestData;
            }).catch(function(err) {
                console.error('Data load error:', err);
                self.isLoading = false; // Clear loading state on error too
                if (applyBtn) applyBtn.innerHTML = '<i class="fas fa-sync-alt mr-1"></i> Apply';
                showToast('Error loading data: ' + (err.message || err), 'danger');
                throw err;
            });
        },

        updateProfileSelector: function() {
            var select = el('#burdenProfileSelect');
            if (!select || !this.latestData) return;
            
            var profiles = (this.latestData.meta && this.latestData.meta.profiles) || [];
            var activeId = (this.latestData.meta && this.latestData.meta.activeProfileId) || 'default';
            
            // Build options
            select.innerHTML = profiles.map(function(p) {
                return '<option value="' + p.id + '"' + (p.id === activeId ? ' selected' : '') + '>' + 
                    escapeHtml(p.name) + '</option>';
            }).join('');
            
            // If no profiles, add default
            if (profiles.length === 0) {
                select.innerHTML = '<option value="default" selected>Default</option>';
            }
        },

        renderAll: function() {
            if (!this.latestData) return;
            this.renderKPIs();
            
            // Render based on active tab - extract from href attribute
            var activeTab = document.querySelector('.burden-dashboard .nav-link.active');
            var href = activeTab ? activeTab.getAttribute('href') : '#burden-dashboard';
            var tabId = href ? href.replace('#burden-', '') : 'dashboard';
            
            switch (tabId) {
                case 'dashboard':
                    this.renderDashboardTab();
                    break;
                case 'categories':
                    this.renderCategoriesTab();
                    break;
                case 'rates':
                    this.renderRatesTab();
                    break;
                case 'modeler':
                    this.renderModelerTab();
                    break;
                case 'selling':
                    this.renderSellingTab();
                    break;
                case 'history':
                    this.renderHistoryTab();
                    break;
                case 'config':
                    this.renderConfigTab();
                    break;
                default:
                    this.renderDashboardTab();
            }
        },

        // ════════════════════════════════════════════════════════════════════════
        // KPI RENDERING
        // ════════════════════════════════════════════════════════════════════════

        renderKPIs: function() {
            var data = this.latestData;
            if (!data) return;

            var kpis = data.kpis || {};
            var absorption = data.absorption || {};
            var classification = data.classification || {};

            // Composite Rate
            var rateEl = el('#burdenCompositeRate');
            if (rateEl) {
                rateEl.innerHTML = '$' + this.fmtNum(kpis.compositeRate || 0, 2) + '<small>/hr</small>';
            }

            // Rate change indicator
            var changeEl = el('#burdenRateChange');
            if (changeEl && kpis.compositeRateChange !== undefined) {
                var change = kpis.compositeRateChange || 0;
                var changeClass = change > 0 ? 'text-danger' : change < 0 ? 'text-success' : 'text-muted';
                var changeIcon = change > 0 ? 'arrow-up' : change < 0 ? 'arrow-down' : 'minus';
                changeEl.innerHTML = '<span class="' + changeClass + '"><i class="fas fa-' + changeIcon + ' mr-1"></i>' + Math.abs(change).toFixed(1) + '% vs prior</span>';
            }

            // Total Overhead
            var expEl = el('#totalexpenses');
            if (expEl) expEl.innerHTML = this.formatCurrency(kpis.totalExpenses || 0);

            // Account count
            var countEl = el('#burdenAccountCount');
            if (countEl && classification.stats) {
                countEl.textContent = (classification.stats.assigned || 0) + ' accounts';
            }

            // Burden Applied
            var appliedEl = el('#burdenapplied');
            if (appliedEl) appliedEl.innerHTML = this.formatCurrency(kpis.burdenApplied || 0);
            
            var appliedStatusEl = el('#burdenAppliedStatus');
            if (appliedStatusEl) {
                appliedStatusEl.textContent = kpis.burdenApplied > 0 ? 'recovered' : 'no recovery';
            }

            // Absorption/Spread
            var spreadEl = el('#burdenexpensesspread');
            var statusEl = el('#spread-status');
            var iconBg = el('#spread-icon-bg');
            var icon = el('#spread-icon');

            if (spreadEl) {
                var spread = absorption.variance || 0;
                var isOver = absorption.status === 'over_absorbed';
                spreadEl.innerHTML = (spread >= 0 ? '+' : '') + this.formatCurrency(spread);
                spreadEl.className = 'kpi-value ' + (isOver ? 'text-success' : 'text-danger');

                if (statusEl) {
                    statusEl.innerHTML = isOver ? '<i class="fas fa-check-circle mr-1"></i>Over-absorbed' : '<i class="fas fa-exclamation-triangle mr-1"></i>Under-absorbed';
                    statusEl.className = 'kpi-sub ' + (isOver ? 'text-success' : 'text-danger');
                }

                if (iconBg) iconBg.className = 'icon-wrapper ' + (isOver ? 'bg-green-soft' : 'bg-red-soft');
                if (icon) icon.className = 'fas fa-balance-scale ' + (isOver ? 'text-green' : 'text-red');
            }

            // Billed Hours
            var hoursEl = el('#burdenTotalHours');
            if (hoursEl) hoursEl.textContent = this.fmtNum(kpis.billedHours || 0, 0);

            // Utilization
            var utilEl = el('#burdenUtilization');
            if (utilEl) utilEl.textContent = ((kpis.utilization || 0) * 100).toFixed(0) + '%';

            // Set date range display
            var meta = data.meta || {};
            var startEl = el('#burdenStartDate');
            var endEl = el('#burdenEndDate');
            if (startEl && meta.startDate && !startEl.value) startEl.value = meta.startDate;
            if (endEl && meta.endDate && !endEl.value) endEl.value = meta.endDate;
        },

        // ════════════════════════════════════════════════════════════════════════
        // DASHBOARD TAB
        // ════════════════════════════════════════════════════════════════════════

        renderDashboardTab: function() {
            var container = el('#burdenDashboardContent');
            if (!container) return;
            
            // Show skeleton while loading
            if (this.isLoading || !this.latestData) {
                container.innerHTML = '<div class="overview-skeleton p-3">' +
                    '<div class="row mb-3">' +
                        '<div class="col-lg-12"><div class="skeleton-loading" style="height: 400px; border-radius: 12px;"></div></div>' +
                    '</div>' +
                '</div>';
                return;
            }

            var self = this;
            var kpis = this.latestData.kpis || {};
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            categories = categories.slice().sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
            var classification = this.latestData.classification || {};
            var unassigned = classification.unassigned || [];
            var dismissed = (this.latestData.meta && this.latestData.meta.dismissedAccounts) || [];
            var activeUnassigned = unassigned.filter(function(a) { return !dismissed.includes(a.id); });
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var allocationBases = this.latestData.allocationBases || {};
            
            // Calculate totals from categories
            var totalBurden = categories.reduce(function(sum, c) { return sum + (c.totalBurden || 0); }, 0);
            var totalAnnual = categories.reduce(function(sum, c) { return sum + (c.totalAmount || 0); }, 0) || kpis.totalExpenses || kpis.totalBurdenCost || 0;
            var laborHours = (allocationBases.hours && allocationBases.hours.totalBilled) || kpis.billedHours || kpis.directLaborHours || 0;
            var compositeRate = kpis.compositeRate || totalBurden;
            var employeeCount = (allocationBases.hours && allocationBases.hours.employeeCount) || kpis.employeeCount || depts.reduce(function(sum, d) { return sum + (d.employeeCount || 0); }, 0) || 0;

            var html = '' +
                // ═══════════════════════════════════════════════════════════════════
                // STYLES
                // ═══════════════════════════════════════════════════════════════════
                '<style>' +
                    // Overview Cards
                    '.ov-card { background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; overflow: hidden; }' +
                    '.ov-card-header { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; }' +
                    '.ov-card-title { font-weight: 600; font-size: 0.8rem; color: #1e293b; display: flex; align-items: center; gap: 8px; }' +
                    '.ov-card-title i { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; }' +
                    '.ov-card-body { padding: 12px; }' +
                    
                    // Summary Header
                    '.ov-summary { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-bottom: 1px solid #e2e8f0; }' +
                    '.ov-summary-rate { }' +
                    '.ov-summary-label { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }' +
                    '.ov-summary-value { font-size: 1.5rem; font-weight: 700; color: #1e293b; }' +
                    '.ov-summary-value small { font-size: 0.8rem; font-weight: 400; color: #64748b; }' +
                    '.ov-summary-stats { display: flex; gap: 20px; }' +
                    '.ov-summary-stat { text-align: right; }' +
                    '.ov-summary-stat-label { font-size: 0.6rem; color: #94a3b8; text-transform: uppercase; }' +
                    '.ov-summary-stat-value { font-size: 0.85rem; font-weight: 600; color: #475569; }' +
                    
                    // Rate Bar
                    '.ov-rate-bar { height: 6px; border-radius: 3px; overflow: hidden; display: flex; background: #e2e8f0; margin: 12px 0; }' +
                    '.ov-rate-segment { height: 100%; transition: width 0.3s; }' +
                    
                    // Category Cards - Grid Layout
                    '.ov-categories-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }' +
                    '@media (max-width: 1200px) { .ov-categories-grid { grid-template-columns: repeat(2, 1fr); } }' +
                    '@media (max-width: 768px) { .ov-categories-grid { grid-template-columns: 1fr; } }' +
                    '.ov-cat-card { background: #f8fafc; border-radius: 10px; padding: 12px; cursor: pointer; transition: all 0.15s; border: 1px solid transparent; display: flex; flex-direction: column; }' +
                    '.ov-cat-card:hover { background: white; border-color: #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }' +
                    '.ov-cat-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }' +
                    '.ov-cat-chart { width: 44px !important; height: 44px !important; flex-shrink: 0; overflow: hidden; }' +
                    '.ov-cat-chart .js-plotly-plot, .ov-cat-chart .plot-container, .ov-cat-chart .svg-container { width: 44px !important; height: 44px !important; }' +
                    '.ov-cat-info { flex: 1; min-width: 0; }' +
                    '.ov-cat-name { font-size: 0.8rem; font-weight: 600; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
                    '.ov-cat-type { font-size: 0.6rem; color: #64748b; }' +
                    '.ov-cat-rate { font-size: 1.1rem; font-weight: 700; color: #1e293b; text-align: right; }' +
                    '.ov-cat-rate small { font-size: 0.65rem; font-weight: 400; color: #64748b; }' +
                    '.ov-cat-stats { display: flex; justify-content: space-between; padding-top: 8px; border-top: 1px solid #e2e8f0; }' +
                    '.ov-cat-stat { text-align: center; flex: 1; }' +
                    '.ov-cat-stat-label { font-size: 0.55rem; color: #94a3b8; text-transform: uppercase; }' +
                    '.ov-cat-stat-value { font-size: 0.75rem; font-weight: 600; color: #475569; }' +
                    
                    // Unassigned Badge Button
                    '.ov-unassigned-btn { display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; color: #92400e; font-size: 0.7rem; font-weight: 500; cursor: pointer; transition: all 0.15s; }' +
                    '.ov-unassigned-btn:hover { background: #fde68a; border-color: #fcd34d; }' +
                    '.ov-unassigned-btn .badge { background: #f59e0b; color: white; padding: 1px 6px; border-radius: 8px; font-size: 0.65rem; }' +
                    
                    // Department Breakdown
                    '.ov-dept-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }' +
                    '.ov-dept-card { background: #f8fafc; border-radius: 8px; padding: 10px; text-align: center; cursor: pointer; transition: all 0.15s; border: 1px solid transparent; }' +
                    '.ov-dept-card:hover { background: white; border-color: #e2e8f0; }' +
                    '.ov-dept-name { font-size: 0.7rem; font-weight: 500; color: #475569; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
                    '.ov-dept-rate { font-size: 0.9rem; font-weight: 700; color: #1e293b; }' +
                    '.ov-dept-rate small { font-size: 0.6rem; color: #94a3b8; }' +
                    
                    // Data Source Info
                    '.ov-data-info { display: flex; gap: 16px; padding: 10px 12px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 0.7rem; color: #64748b; }' +
                    '.ov-data-item { display: flex; align-items: center; gap: 5px; }' +
                    '.ov-data-item i { color: #94a3b8; font-size: 0.65rem; }' +
                '</style>';

            // ═══════════════════════════════════════════════════════════════════
            // MAIN CARD - Rate Composition
            // ═══════════════════════════════════════════════════════════════════
            html += '<div class="ov-card mb-3">' +
                // Header with summary and actions
                '<div class="ov-card-header">' +
                    '<div class="ov-card-title">' +
                        '<i style="background: #dbeafe; color: #2563eb;"><span class="fas fa-layer-group"></span></i>' +
                        'Rate Composition' +
                    '</div>' +
                    '<div class="d-flex align-items-center gap-2">';
            
            // Unassigned accounts button (if any)
            if (activeUnassigned.length > 0) {
                html += '<button class="ov-unassigned-btn" onclick="BurdenController.showUnassignedFlyout()">' +
                    '<i class="fas fa-exclamation-triangle"></i>' +
                    '<span class="badge">' + activeUnassigned.length + '</span>' +
                    'Unassigned' +
                '</button>';
            }
            
            html += '<button class="btn btn-sm btn-outline-primary" onclick="BurdenController.switchTab(\'cat-tab\')" style="font-size: 0.7rem; padding: 4px 10px;">' +
                        '<i class="fas fa-cog mr-1"></i>Manage' +
                    '</button>' +
                    '</div>' +
                '</div>' +
                
                // Summary row
                '<div class="ov-summary">' +
                    '<div class="ov-summary-rate">' +
                        '<div class="ov-summary-label">Composite Burden Rate</div>' +
                        '<div class="ov-summary-value">$' + self.fmtNum(compositeRate, 2) + '<small>/hr</small></div>' +
                    '</div>' +
                    '<div class="ov-summary-stats">' +
                        '<div class="ov-summary-stat">' +
                            '<div class="ov-summary-stat-label">Annual Burden</div>' +
                            '<div class="ov-summary-stat-value">' + self.formatCurrency(totalAnnual) + '</div>' +
                        '</div>' +
                        '<div class="ov-summary-stat">' +
                            '<div class="ov-summary-stat-label">Labor Hours</div>' +
                            '<div class="ov-summary-stat-value">' + self.fmtNum(laborHours, 0) + '</div>' +
                        '</div>' +
                        '<div class="ov-summary-stat">' +
                            '<div class="ov-summary-stat-label">Categories</div>' +
                            '<div class="ov-summary-stat-value">' + categories.length + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            
            // Rate composition bar
            if (categories.length > 0 && compositeRate > 0) {
                html += '<div style="padding: 0 12px;"><div class="ov-rate-bar">';
                categories.forEach(function(c) {
                    var pct = (c.totalBurden || 0) / compositeRate * 100;
                    if (pct > 0) {
                        html += '<div class="ov-rate-segment" style="width: ' + pct + '%; background: ' + (c.color || '#6b7280') + ';"></div>';
                    }
                });
                html += '</div></div>';
            }
            
            // Category cards with pie charts
            // Category cards in grid
            html += '<div class="ov-card-body">' +
                '<div class="ov-categories-grid">';
            
            categories.forEach(function(c, idx) {
                var pct = compositeRate > 0 ? ((c.totalBurden || 0) / compositeRate * 100) : 0;
                var accountCount = (c.accounts && c.accounts.length) || 0;
                var typeLabel = c.type === 'expense' ? 'Expense' : c.type === 'timebill' ? 'Time' : c.type === 'manual' ? 'Manual' : 'Derived';
                
                html += '<div class="ov-cat-card" onclick="BurdenController.showCategoryFlyout(\'' + c.id + '\')">' +
                    '<div class="ov-cat-top">' +
                        '<div class="ov-cat-chart" id="ovCatChart' + idx + '"></div>' +
                        '<div class="ov-cat-info">' +
                            '<div class="ov-cat-name" title="' + escapeHtml(c.label) + '">' + escapeHtml(c.label) + '</div>' +
                            '<div class="ov-cat-type">' + typeLabel + ' • ' + self.fmtNum(pct, 0) + '%</div>' +
                        '</div>' +
                        '<div class="ov-cat-rate">$' + self.fmtNum(c.totalBurden || 0, 2) + '<small>/hr</small></div>' +
                    '</div>' +
                    '<div class="ov-cat-stats">' +
                        '<div class="ov-cat-stat">' +
                            '<div class="ov-cat-stat-label">Annual</div>' +
                            '<div class="ov-cat-stat-value">' + self.formatCurrency(c.totalAmount || 0) + '</div>' +
                        '</div>' +
                        '<div class="ov-cat-stat">' +
                            '<div class="ov-cat-stat-label">Accounts</div>' +
                            '<div class="ov-cat-stat-value">' + accountCount + '</div>' +
                        '</div>' +
                        '<div class="ov-cat-stat">' +
                            '<div class="ov-cat-stat-label">Allocation</div>' +
                            '<div class="ov-cat-stat-value">' + (c.allocation === 'all' || !c.allocation ? 'All' : 'Specific') + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            });
            
            html += '</div></div>'; // categories-grid, card-body
            
            // Data info footer
            var dataDate = this.latestData.dataAsOf || new Date().toLocaleDateString();
            html += '<div class="ov-data-info">' +
                '<div class="ov-data-item"><i class="fas fa-calendar"></i> Data as of ' + dataDate + '</div>' +
                '<div class="ov-data-item"><i class="fas fa-building"></i> ' + depts.length + ' Departments</div>' +
                '<div class="ov-data-item"><i class="fas fa-users"></i> ' + self.fmtNum(employeeCount, 0) + ' Employees</div>' +
            '</div>';
            
            html += '</div>'; // main card
            
            // ═══════════════════════════════════════════════════════════════════
            // DEPARTMENT BREAKDOWN CARD
            // ═══════════════════════════════════════════════════════════════════
            if (depts.length > 0) {
                var deptRates = this.latestData.summary && this.latestData.summary.totals && this.latestData.summary.totals.burden || {};
                
                html += '<div class="ov-card mt-3">' +
                    '<div class="ov-card-header">' +
                        '<div class="ov-card-title">' +
                            '<i style="background: #f3e8ff; color: #7c3aed;"><span class="fas fa-building"></span></i>' +
                            'Rate by Department' +
                        '</div>' +
                        '<button class="btn btn-sm btn-link p-0" onclick="BurdenController.switchTab(\'rates-tab\')" style="font-size: 0.7rem;">View Full Matrix →</button>' +
                    '</div>' +
                    '<div class="ov-card-body">' +
                        '<div class="ov-dept-grid">';
                
                depts.forEach(function(d) {
                    var rate = deptRates[d.id] || deptRates[String(d.id)] || compositeRate;
                    html += '<div class="ov-dept-card" onclick="BurdenController.showDeptRateFlyout(\'' + d.id + '\')">' +
                        '<div class="ov-dept-name" title="' + escapeHtml(d.name) + '">' + escapeHtml(d.name) + '</div>' +
                        '<div class="ov-dept-rate">$' + self.fmtNum(rate, 2) + '<small>/hr</small></div>' +
                    '</div>';
                });
                
                html += '</div></div></div>';
            }

            container.innerHTML = html;

            // Render mini pie charts for each category
            this.renderCategoryMiniCharts(categories);
        },

        renderCategoryMiniCharts: function(categories) {
            var self = this;
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            
            categories.forEach(function(c, idx) {
                var container = el('#ovCatChart' + idx);
                if (!container) return;
                
                var values = [];
                var labels = [];
                var colors = [];
                var baseColor = c.color || '#6b7280';
                
                // Try department breakdown first
                if (c.burden && depts.length > 0) {
                    depts.forEach(function(d, i) {
                        var rate = c.burden[d.id] || c.burden[String(d.id)] || 0;
                        if (rate > 0) {
                            values.push(rate);
                            labels.push(d.name.length > 10 ? d.name.substring(0, 8) + '…' : d.name);
                            var opacity = 1 - (i * 0.2);
                            colors.push(self.adjustColorOpacity(baseColor, Math.max(0.3, opacity)));
                        }
                    });
                }
                
                // Fallback to accounts if no dept data
                if (values.length === 0 && c.accounts && c.accounts.length > 0) {
                    var sorted = c.accounts.slice().sort(function(a, b) { return (b.amount || 0) - (a.amount || 0); });
                    var top = sorted.slice(0, 4);
                    var otherTotal = sorted.slice(4).reduce(function(sum, a) { return sum + (a.amount || 0); }, 0);
                    
                    top.forEach(function(a, i) {
                        values.push(a.amount || 0);
                        var name = a.name || a.id || 'Account';
                        labels.push(name.length > 10 ? name.substring(0, 8) + '…' : name);
                        var opacity = 1 - (i * 0.2);
                        colors.push(self.adjustColorOpacity(baseColor, Math.max(0.3, opacity)));
                    });
                    
                    if (otherTotal > 0) {
                        values.push(otherTotal);
                        labels.push('Other');
                        colors.push(self.adjustColorOpacity(baseColor, 0.3));
                    }
                }
                
                // Final fallback - single solid ring
                if (values.length === 0) {
                    values = [1];
                    labels = [c.label || 'Total'];
                    colors = [baseColor];
                }
                
                var data = [{
                    values: values,
                    labels: labels,
                    type: 'pie',
                    hole: 0.55,
                    marker: { colors: colors, line: { color: '#fff', width: 1 } },
                    textinfo: 'none',
                    hoverinfo: 'label+percent',
                    showlegend: false,
                    sort: false
                }];
                
                var layout = {
                    width: 44,
                    height: 44,
                    margin: { t: 0, b: 0, l: 0, r: 0 },
                    showlegend: false,
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent'
                };
                
                Plotly.newPlot(container, data, layout, { responsive: false, displayModeBar: false, staticPlot: true });
            });
        },

        adjustColorOpacity: function(hex, opacity) {
            // Convert hex to rgba with opacity
            var r = parseInt(hex.slice(1, 3), 16);
            var g = parseInt(hex.slice(3, 5), 16);
            var b = parseInt(hex.slice(5, 7), 16);
            return 'rgba(' + r + ',' + g + ',' + b + ',' + opacity + ')';
        },

        showUnassignedFlyout: function() {
            var classification = this.latestData.classification || {};
            var unassigned = classification.unassigned || [];
            var dismissed = (this.latestData.meta && this.latestData.meta.dismissedAccounts) || [];
            var activeUnassigned = unassigned.filter(function(a) { return !dismissed.includes(a.id); });
            
            if (activeUnassigned.length === 0) {
                showToast('No unassigned accounts', 'info');
                return;
            }
            
            var self = this;
            this.openFlyout();
            el('#flyoutTitle').innerHTML = '<i class="fas fa-exclamation-triangle text-warning mr-2"></i>Unassigned Accounts';
            var subtitleEl = el('#flyoutSubtitle');
            if (subtitleEl) {
                subtitleEl.textContent = 'Classify for accurate rate calculation';
                subtitleEl.style.display = '';
            }
            el('#flyoutStats').innerHTML = '<span class="badge badge-warning">' + activeUnassigned.length + ' accounts</span>';
            
            var totalAmount = activeUnassigned.reduce(function(sum, a) { return sum + (a.amount || 0); }, 0);
            
            var html = '<div class="p-3">' +
                '<div class="alert alert-warning mb-3" style="font-size: 0.8rem;">' +
                    '<i class="fas fa-info-circle mr-2"></i>' +
                    'These expense accounts have costs but aren\'t assigned to any category. Assign them for accurate burden rates.' +
                '</div>' +
                '<div class="d-flex justify-content-between align-items-center mb-3">' +
                    '<span class="text-muted small">Total: ' + this.formatCurrency(totalAmount) + '</span>' +
                    '<button class="btn btn-sm btn-primary" onclick="BurdenController.switchTab(\'cat-tab\'); BurdenController.closeFlyout();">' +
                        '<i class="fas fa-cog mr-1"></i>Manage Categories' +
                    '</button>' +
                '</div>' +
                '<div class="list-group">';
            
            activeUnassigned.slice(0, 20).forEach(function(a) {
                html += '<div class="list-group-item d-flex justify-content-between align-items-center py-2">' +
                    '<div>' +
                        '<div class="font-weight-medium" style="font-size: 0.85rem;">' + escapeHtml(a.name || a.id) + '</div>' +
                        '<div class="text-muted small">' + escapeHtml(a.number || '') + '</div>' +
                    '</div>' +
                    '<div class="text-right">' +
                        '<div class="font-weight-bold">' + self.formatCurrency(a.amount || 0) + '</div>' +
                    '</div>' +
                '</div>';
            });
            
            if (activeUnassigned.length > 20) {
                html += '<div class="list-group-item text-center text-muted small py-2">' +
                    '+ ' + (activeUnassigned.length - 20) + ' more accounts' +
                '</div>';
            }
            
            html += '</div></div>';
            
            el('#flyoutBody').innerHTML = html;
        },

        showDeptRateFlyout: function(deptId) {
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var dept = depts.find(function(d) { return String(d.id) === String(deptId); });
            if (!dept) return;
            
            var self = this;
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var deptRates = {};
            
            // Collect rates for this department from each category
            categories.forEach(function(c) {
                if (c.burden && c.burden[deptId]) {
                    deptRates[c.id] = { label: c.label, color: c.color, rate: c.burden[deptId] };
                }
            });
            
            var totalRate = Object.values(deptRates).reduce(function(sum, r) { return sum + r.rate; }, 0);
            
            this.openFlyout();
            el('#flyoutTitle').innerHTML = '<i class="fas fa-building text-purple mr-2"></i>' + escapeHtml(dept.name);
            var subtitleEl = el('#flyoutSubtitle');
            if (subtitleEl) {
                subtitleEl.textContent = 'Department burden breakdown';
                subtitleEl.style.display = '';
            }
            el('#flyoutStats').innerHTML = '<span class="badge badge-primary">$' + this.fmtNum(totalRate, 2) + '/hr</span>';
            
            var html = '<div class="p-3">' +
                '<table class="table table-sm">' +
                    '<thead class="thead-light"><tr><th>Category</th><th class="text-right">Rate</th></tr></thead>' +
                    '<tbody>';
            
            Object.keys(deptRates).forEach(function(catId) {
                var r = deptRates[catId];
                html += '<tr>' +
                    '<td><span class="category-dot" style="background: ' + r.color + '; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 8px;"></span>' + escapeHtml(r.label) + '</td>' +
                    '<td class="text-right font-weight-bold">$' + self.fmtNum(r.rate, 2) + '</td>' +
                '</tr>';
            });
            
            html += '<tr class="table-active font-weight-bold"><td>Total</td><td class="text-right">$' + self.fmtNum(totalRate, 2) + '</td></tr>' +
                '</tbody></table>' +
            '</div>';
            
            el('#flyoutBody').innerHTML = html;
        },

        renderSummaryTable: function() {
            var thead = el('#burdenSummaryHead');
            var tbody = el('#burdenSummaryBody');
            if (!thead || !tbody || !this.latestData) return;

            var summary = this.latestData.summary || {};
            var categories = (summary.categories || []).slice().sort(function(a, b) {
                return (a.order || 0) - (b.order || 0);
            });
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var self = this;

            // Limit to first 4 depts for dashboard view
            var displayDepts = depts.slice(0, 4);

            // Header
            var headerHtml = '<tr><th>Category</th>';
            displayDepts.forEach(function(d) {
                headerHtml += '<th class="text-right">' + escapeHtml(d.name.substring(0, 15)) + '</th>';
            });
            headerHtml += '<th class="text-right font-weight-bold">Overall</th></tr>';
            thead.innerHTML = headerHtml;

            // Rows
            var rowsHtml = categories.map(function(cat) {
                var row = '<tr class="clickable-row" onclick="BurdenController.showCategoryFlyout(\'' + cat.id + '\')">';
                row += '<td><span class="category-badge" style="background: ' + cat.color + '20; color: ' + cat.color + ';">' +
                    '<span class="category-dot" style="background: ' + cat.color + ';"></span>' + escapeHtml(cat.label) + '</span></td>';

                displayDepts.forEach(function(d) {
                    var rate = cat.burden && cat.burden[d.id] ? cat.burden[d.id] : 0;
                    row += '<td class="text-right">$' + self.fmtNum(rate, 2) + '</td>';
                });

                row += '<td class="text-right font-weight-bold">$' + self.fmtNum(cat.totalBurden || 0, 2) + '</td>';
                row += '</tr>';
                return row;
            }).join('');

            // Totals row
            var totals = summary.totals || {};
            var totalRow = '<tr class="table-active font-weight-bold"><td>Total</td>';
            displayDepts.forEach(function(d) {
                var rate = totals.burden && totals.burden[d.id] ? totals.burden[d.id] : 0;
                totalRow += '<td class="text-right">$' + self.fmtNum(rate, 2) + '</td>';
            });
            totalRow += '<td class="text-right">$' + self.fmtNum(totals.burden && totals.burden.Overall ? totals.burden.Overall : 0, 2) + '</td></tr>';

            tbody.innerHTML = rowsHtml + totalRow;
        },

        // ════════════════════════════════════════════════════════════════════════
        // TAB RENDERERS (Categories, Rates, Modeler, Selling, History, Unbilled, Config)
        // ════════════════════════════════════════════════════════════════════════

        renderCategoriesTab: function() {
            var container = el('#burdenCategoriesContent');
            if (!container) return;
            
            // Show skeleton while loading - check both isLoading flag and data
            if (this.isLoading || !this.latestData) {
                container.innerHTML = '<div class="category-table-skeleton">' +
                    '<div class="d-flex justify-content-between align-items-center mb-3">' +
                        '<div class="skeleton-cell name skeleton-loading" style="width: 200px; height: 24px;"></div>' +
                        '<div class="skeleton-cell skeleton-loading" style="width: 100px; height: 32px;"></div>' +
                    '</div>' +
                    [1,2,3,4,5,6,7,8].map(function() {
                        return '<div class="skeleton-row">' +
                            '<div class="skeleton-cell color skeleton-loading"></div>' +
                            '<div class="skeleton-cell name skeleton-loading"></div>' +
                            '<div class="skeleton-cell type skeleton-loading"></div>' +
                            '<div class="skeleton-cell amount skeleton-loading"></div>' +
                            '<div class="skeleton-cell rate skeleton-loading"></div>' +
                            '<div class="skeleton-cell actions skeleton-loading"></div>' +
                        '</div>';
                    }).join('') +
                '</div>';
                return;
            }

            var self = this;
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var classification = this.latestData.classification || {};
            var unassigned = classification.unassigned || [];
            var dismissed = (this.latestData.meta && this.latestData.meta.dismissedAccounts) || [];
            var activeUnassigned = unassigned.filter(function(a) { return !dismissed.includes(a.id); });
            
            // Initialize pending changes tracking
            if (!this.pendingCategoryChanges) {
                this.pendingCategoryChanges = { added: {}, removed: {}, confirmed: {} };
            }
            
            // Check if there are pending changes
            var hasPendingChanges = Object.keys(this.pendingCategoryChanges.added).length > 0 ||
                                    Object.keys(this.pendingCategoryChanges.removed).length > 0;
            
            // Initialize sort direction only (categorySortField can be null for manual drag order)
            if (!this.categorySortDir) this.categorySortDir = 'asc';

            // Category type definitions
            var categoryTypes = {
                expense: { label: 'Expense', icon: 'receipt', color: '#3b82f6' },
                timebill: { label: 'Time', icon: 'clock', color: '#f59e0b' },
                manual: { label: 'Manual', icon: 'edit', color: '#10b981' },
                derived: { label: 'Derived', icon: 'percentage', color: '#06b6d4' },
                formula: { label: 'Formula', icon: 'function', color: '#8b5cf6' },
                // Legacy types map to manual
                headcount: { label: 'Manual', icon: 'edit', color: '#10b981' },
                revenue: { label: 'Manual', icon: 'edit', color: '#10b981' },
                custom: { label: 'Custom', icon: 'cog', color: '#6b7280' }
            };
            
            // Sort categories - preserve array order when no sort field active (null = drag-drop order)
            var sortedCategories;
            if (!self.categorySortField) {
                // No sort field - use array order as-is (reflects drag-drop reorder)
                sortedCategories = categories.slice();
            } else {
                sortedCategories = categories.slice().sort(function(a, b) {
                    var aVal, bVal;
                    switch (self.categorySortField) {
                        case 'type':
                            aVal = a.categoryType || 'expense';
                            bVal = b.categoryType || 'expense';
                            break;
                        case 'expense':
                            aVal = a.totalExpense || 0;
                            bVal = b.totalExpense || 0;
                            break;
                        case 'rate':
                            aVal = a.totalBurden || 0;
                            bVal = b.totalBurden || 0;
                            break;
                        default:
                            aVal = (a.label || '').toLowerCase();
                            bVal = (b.label || '').toLowerCase();
                    }
                    if (typeof aVal === 'number') {
                        return self.categorySortDir === 'asc' ? aVal - bVal : bVal - aVal;
                    }
                    return self.categorySortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                });
            }
            
            var sortIcon = function(field) {
                if (self.categorySortField !== field) return '<i class="fas fa-sort text-muted opacity-50 ml-1"></i>';
                return self.categorySortDir === 'asc' 
                    ? '<i class="fas fa-sort-up text-primary ml-1"></i>' 
                    : '<i class="fas fa-sort-down text-primary ml-1"></i>';
            };

            var html = '<style>' +
                // Categories manager card wrapper
                '.categories-manager { background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; overflow: hidden; }' +
                '.categories-manager > .d-flex:first-child { padding: 12px 16px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-bottom: 1px solid #e2e8f0; margin-bottom: 0 !important; }' +
                '.categories-manager h6 { font-size: 0.85rem; color: #1e293b; }' +
                '.categories-manager .badge-secondary { background: #e2e8f0; color: #475569; font-size: 0.7rem; }' +
                // Modern table styling
                '.categories-table { margin: 0 !important; }' +
                '.categories-table thead th { background: #fafbfc !important; border-bottom: 1px solid #e2e8f0 !important; font-size: 0.7rem; text-transform: uppercase; color: #64748b; font-weight: 600; padding: 10px 12px !important; }' +
                '.categories-table tbody td { padding: 10px 12px !important; border-bottom: 1px solid #f1f5f9 !important; font-size: 0.8rem; vertical-align: middle !important; }' +
                '.categories-table tbody tr:hover { background: #f8fafc !important; }' +
                '.categories-table tbody tr:last-child td { border-bottom: none !important; }' +
                '.cat-icon-mini { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; }' +
                '.categories-table .drag-handle { color: #cbd5e1; transition: color 0.15s; }' +
                '.categories-table .drag-handle:hover { color: #64748b; }' +
                '.categories-table .badge-light { background: #f1f5f9; font-size: 0.65rem; padding: 3px 8px; }' +
                '.categories-manager .btn { border-radius: 6px; }' +
                '.sortable-header { cursor: pointer; transition: color 0.15s; }' +
                '.sortable-header:hover { color: #3b82f6 !important; }' +
            '</style>' +
            '<div class="categories-manager">' +
                // Header with actions
                '<div class="d-flex justify-content-between align-items-center mb-3">' +
                    '<div class="d-flex align-items-center">' +
                        '<h6 class="mb-0"><i class="fas fa-layer-group text-primary mr-2"></i>Burden Categories</h6>' +
                        '<span class="badge badge-secondary ml-2">' + categories.length + '</span>' +
                        (activeUnassigned.length > 0 ? 
                            '<span class="badge badge-light text-muted ml-2" style="cursor: pointer; transition: all 0.15s;" title="Click to view unassigned accounts" onclick="BurdenController.showUnassignedAccountsFlyout()" onmouseover="this.style.background=\'#e2e8f0\'; this.style.color=\'#1e293b\';" onmouseout="this.style.background=\'\'; this.style.color=\'\';">' +
                                '<i class="fas fa-inbox mr-1"></i>' + activeUnassigned.length + ' unassigned' +
                            '</span>' : '') +
                    '</div>' +
                    '<div>' +
                        '<button class="btn btn-sm btn-primary" onclick="BurdenController.showAddCategoryFlyout()">' +
                            '<i class="fas fa-plus mr-1"></i>Add' +
                        '</button>' +
                    '</div>' +
                '</div>' +
                
                // Tabular categories list
                '<table class="table table-sm table-hover categories-table mb-0" style="width: 100%;">' +
                    '<thead class="thead-light">' +
                        '<tr>' +
                            '<th style="width: 28px;"></th>' +
                            '<th style="width: 36px;"></th>' +
                            '<th class="sortable-header" onclick="BurdenController.sortCategories(\'label\')">Category ' + sortIcon('label') + '</th>' +
                            '<th class="sortable-header" onclick="BurdenController.sortCategories(\'type\')" style="width: 100px;">Type ' + sortIcon('type') + '</th>' +
                            '<th class="sortable-header text-right" onclick="BurdenController.sortCategories(\'expense\')" style="width: 110px;">Expense ' + sortIcon('expense') + '</th>' +
                            '<th class="sortable-header text-right" onclick="BurdenController.sortCategories(\'rate\')" style="width: 90px;">Rate ' + sortIcon('rate') + '</th>' +
                            '<th style="width: 50px;"></th>' +
                        '</tr>' +
                    '</thead>' +
                    '<tbody id="categoriesTableBody">';
            
            if (sortedCategories.length === 0) {
                html += '<tr><td colspan="7" class="text-center py-4 text-muted">' +
                    '<i class="fas fa-layer-group fa-2x mb-2 d-block opacity-50"></i>' +
                    '<p class="small mb-2">No categories configured</p>' +
                    '<button class="btn btn-sm btn-primary" onclick="BurdenController.showAddCategoryFlyout()"><i class="fas fa-plus mr-1"></i>Add Category</button>' +
                '</td></tr>';
            } else {
                sortedCategories.forEach(function(cat) {
                    var catType = cat.categoryType || self.inferCategoryType(cat.allocationBase);
                    var typeInfo = categoryTypes[catType] || categoryTypes.expense;
                    var catIdStr = String(cat.id);
                    var catClass = classification.byCategory && classification.byCategory[catIdStr];
                    var accountCount = catClass ? (catClass.accounts || catClass || []).length : 0;
                    // Handle both formats: {accounts: [...]} or just [...]
                    if (Array.isArray(catClass)) {
                        accountCount = catClass.length;
                    } else if (catClass && catClass.accounts) {
                        accountCount = catClass.accounts.length;
                    } else if (catClass && typeof catClass.count === 'number') {
                        accountCount = catClass.count;
                    }
                    
                    html += '<tr class="category-row" data-category-id="' + cat.id + '" style="cursor: pointer;">' +
                        '<td class="align-middle text-center drag-handle" style="cursor: grab;">' +
                            '<i class="fas fa-grip-vertical text-muted"></i>' +
                        '</td>' +
                        '<td class="align-middle text-center" onclick="BurdenController.showCategoryFlyout(\'' + cat.id + '\')">' +
                            '<div class="cat-icon-mini" style="background: ' + (cat.color || typeInfo.color) + '20; color: ' + (cat.color || typeInfo.color) + ';">' +
                                '<i class="fas fa-' + typeInfo.icon + '"></i>' +
                            '</div>' +
                        '</td>' +
                        '<td class="align-middle" onclick="BurdenController.showCategoryFlyout(\'' + cat.id + '\')">' +
                            '<span class="font-weight-medium">' + escapeHtml(cat.label) + '</span>' +
                            (catType === 'expense' && accountCount > 0 ? '<span class="text-muted small ml-2">(' + accountCount + ')</span>' : '') +
                        '</td>' +
                        '<td class="align-middle" onclick="BurdenController.showCategoryFlyout(\'' + cat.id + '\')">' +
                            '<span class="badge badge-light" style="border-left: 3px solid ' + typeInfo.color + ';">' + typeInfo.label + '</span>' +
                        '</td>' +
                        '<td class="align-middle text-right font-monospace small" onclick="BurdenController.showCategoryFlyout(\'' + cat.id + '\')">' + self.formatCurrency(cat.totalExpense || 0) + '</td>' +
                        '<td class="align-middle text-right" onclick="BurdenController.showCategoryFlyout(\'' + cat.id + '\')">' +
                            '<span class="text-success font-weight-bold font-monospace">$' + self.fmtNum(cat.totalBurden || 0, 2) + '</span>' +
                        '</td>' +
                        '<td class="align-middle text-center">' +
                            '<button class="btn btn-sm btn-link p-0" onclick="event.stopPropagation(); BurdenController.showEditCategoryFlyout(\'' + cat.id + '\')" title="Configure">' +
                                '<i class="fas fa-cog text-muted"></i>' +
                            '</button>' +
                        '</td>' +
                    '</tr>';
                });
            }
            
            html += '</tbody></table></div>';

            container.innerHTML = html;
            
            // Initialize drag-and-drop sorting
            this.initCategoryDragSort();
        },
        
        sortCategories: function(field) {
            if (this.categorySortField === field) {
                this.categorySortDir = this.categorySortDir === 'asc' ? 'desc' : 'asc';
            } else {
                this.categorySortField = field;
                this.categorySortDir = 'asc';
            }
            this.renderCategoriesTab();
        },
        
        initCategoryDragSort: function() {
            var self = this;
            var tbody = document.getElementById('categoriesTableBody');
            if (!tbody) return;
            
            var draggedRow = null;
            
            // Add draggable attribute and event listeners to each row
            var rows = tbody.querySelectorAll('tr[data-category-id]');
            rows.forEach(function(row) {
                row.draggable = true;
                
                row.addEventListener('dragstart', function(e) {
                    draggedRow = row;
                    row.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', row.getAttribute('data-category-id'));
                });
                
                row.addEventListener('dragend', function(e) {
                    row.classList.remove('dragging');
                    draggedRow = null;
                    // Remove all drag-over states
                    tbody.querySelectorAll('.drag-over').forEach(function(r) {
                        r.classList.remove('drag-over');
                    });
                });
                
                row.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    
                    if (draggedRow && draggedRow !== row) {
                        row.classList.add('drag-over');
                    }
                });
                
                row.addEventListener('dragleave', function(e) {
                    row.classList.remove('drag-over');
                });
                
                row.addEventListener('drop', function(e) {
                    e.preventDefault();
                    row.classList.remove('drag-over');
                    
                    if (draggedRow && draggedRow !== row) {
                        // Determine if dropping above or below
                        var rect = row.getBoundingClientRect();
                        var midY = rect.top + rect.height / 2;
                        var insertBefore = e.clientY < midY;
                        
                        if (insertBefore) {
                            tbody.insertBefore(draggedRow, row);
                        } else {
                            tbody.insertBefore(draggedRow, row.nextSibling);
                        }
                        
                        // Get new order
                        var newOrder = [];
                        tbody.querySelectorAll('tr[data-category-id]').forEach(function(r) {
                            newOrder.push(r.getAttribute('data-category-id'));
                        });
                        
                        self.reorderCategories(newOrder);
                    }
                });
            });
        },
        
        reorderCategories: function(newOrder) {
            var self = this;
            
            // Reorder in summary.categories
            if (this.latestData.summary && this.latestData.summary.categories) {
                var catMap = {};
                this.latestData.summary.categories.forEach(function(c) { catMap[c.id] = c; });
                this.latestData.summary.categories = newOrder.map(function(id) { return catMap[id]; }).filter(Boolean);
            }
            
            // Reorder in meta.categoryDefinitions
            if (this.latestData.meta && this.latestData.meta.categoryDefinitions) {
                var defMap = {};
                this.latestData.meta.categoryDefinitions.forEach(function(c) { defMap[c.id] = c; });
                this.latestData.meta.categoryDefinitions = newOrder.map(function(id) { return defMap[id]; }).filter(Boolean);
            }
            
            // Clear any sort field to preserve manual order
            this.categorySortField = null;
            this.categorySortDir = null;
            
            // Save order to server
            API.post('burden', { subAction: 'save_category_order', order: newOrder }).then(function() {
                showToast('Category order saved', 'success');
            }).catch(function(err) {
                console.error('Error saving order:', err);
            });
        },

        renderCategoriesTable: function() {
            // Now integrated into renderCategoriesTab
            this.renderCategoriesTab();
        },

        inferCategoryType: function(allocationBase) {
            // IMPORTANT: allocationBase does NOT determine category type
            // Categories with headcount/revenue allocation bases are still expense categories
            // Only explicitly set categoryType should determine the type
            // Default to expense for all cases
            return 'expense';
        },

        getCategoryTypeConfig: function(cat, catType) {
            return '';
        },

        filterUnassigned: function() {
            // No longer on categories tab
        },

        renderUnassignedList: function() {
            // No longer on categories tab - handled in flyout
        },

        truncateText: function(text, maxLen) {
            if (!text) return '';
            return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
        },

        toggleCategoryExpand: function(categoryId) {
            if (!this.expandedCategories) this.expandedCategories = {};
            this.expandedCategories[categoryId] = !this.expandedCategories[categoryId];
            this.renderCategoriesTable();
        },

        initCategoryDragDrop: function() {
            // Drag/drop no longer on categories tab
        },

        stageAccountAssignment: function(accountId, categoryId) {
            // Stage the change instead of immediately saving
            if (!this.pendingCategoryChanges.added[categoryId]) {
                this.pendingCategoryChanges.added[categoryId] = [];
            }
            if (!this.pendingCategoryChanges.added[categoryId].includes(accountId)) {
                this.pendingCategoryChanges.added[categoryId].push(accountId);
            }
            
            // Show visual feedback
            this.updatePendingChangesUI();
            
            // Temporarily move account to category in the UI
            // Find account info from unassigned
            var classification = this.latestData.classification || {};
            var unassigned = classification.unassigned || [];
            var account = unassigned.find(function(a) { return a.id === accountId; });
            var catIdStr = String(categoryId);
            
            if (account) {
                // Add to category's accounts temporarily
                var catClass = classification.byCategory && classification.byCategory[catIdStr];
                if (!catClass) {
                    classification.byCategory = classification.byCategory || {};
                    classification.byCategory[catIdStr] = { accounts: [], autoAssigned: [] };
                    catClass = classification.byCategory[catIdStr];
                }
                catClass.accounts = catClass.accounts || [];
                catClass.accounts.push(account);
                
                // Remove from unassigned
                classification.unassigned = unassigned.filter(function(a) { return a.id !== accountId; });
            }
        },

        removeAccountFromCategory: function(accountId, categoryId) {
            var catIdStr = String(categoryId);
            if (!this.pendingCategoryChanges.removed[catIdStr]) {
                this.pendingCategoryChanges.removed[catIdStr] = [];
            }
            if (!this.pendingCategoryChanges.removed[catIdStr].includes(accountId)) {
                this.pendingCategoryChanges.removed[catIdStr].push(accountId);
            }
            
            // Update UI
            var classification = this.latestData.classification || {};
            var catClass = classification.byCategory && classification.byCategory[catIdStr];
            if (catClass && catClass.accounts) {
                var account = catClass.accounts.find(function(a) { return a.id === accountId; });
                catClass.accounts = catClass.accounts.filter(function(a) { return a.id !== accountId; });
                if (account) {
                    classification.unassigned = classification.unassigned || [];
                    classification.unassigned.push(account);
                }
            }
            
            this.updatePendingChangesUI();
        },

        confirmAutoAssign: function(accountId, categoryId) {
            var catIdStr = String(categoryId);
            if (!this.pendingCategoryChanges.confirmed[catIdStr]) {
                this.pendingCategoryChanges.confirmed[catIdStr] = [];
            }
            if (!this.pendingCategoryChanges.confirmed[catIdStr].includes(accountId)) {
                this.pendingCategoryChanges.confirmed[catIdStr].push(accountId);
            }
            
            // Move from auto to confirmed in UI
            var classification = this.latestData.classification || {};
            var catClass = classification.byCategory && classification.byCategory[catIdStr];
            if (catClass && catClass.autoAssigned) {
                var account = catClass.autoAssigned.find(function(a) { return a.id === accountId; });
                catClass.autoAssigned = catClass.autoAssigned.filter(function(a) { return a.id !== accountId; });
                if (account) {
                    catClass.accounts = catClass.accounts || [];
                    catClass.accounts.push(account);
                }
            }
            
            this.updatePendingChangesUI();
            this.renderCategoriesTable();
            this.initCategoryDragDrop();
        },

        rejectAutoAssign: function(accountId, categoryId) {
            // Move from auto to unassigned
            var classification = this.latestData.classification || {};
            var catIdStr = String(categoryId);
            var catClass = classification.byCategory && classification.byCategory[catIdStr];
            if (catClass && catClass.autoAssigned) {
                var account = catClass.autoAssigned.find(function(a) { return a.id === accountId; });
                catClass.autoAssigned = catClass.autoAssigned.filter(function(a) { return a.id !== accountId; });
                if (account) {
                    classification.unassigned = classification.unassigned || [];
                    classification.unassigned.push(account);
                }
            }
            
            this.renderCategoriesTable();
            this.renderUnassignedList();
            this.initCategoryDragDrop();
            el('#unassignedCount').textContent = (classification.unassigned || []).length;
        },

        updatePendingChangesUI: function() {
            var count = 0;
            var changes = this.pendingCategoryChanges;
            Object.keys(changes.added).forEach(function(k) { count += changes.added[k].length; });
            Object.keys(changes.removed).forEach(function(k) { count += changes.removed[k].length; });
            Object.keys(changes.confirmed).forEach(function(k) { count += changes.confirmed[k].length; });
            
            var badge = el('#pendingChangesCount');
            var saveBtn = el('#saveCategoryChanges');
            
            if (count > 0) {
                if (badge) { badge.style.display = 'inline'; badge.textContent = count + ' pending'; }
                if (saveBtn) saveBtn.style.display = 'inline-block';
            } else {
                if (badge) badge.style.display = 'none';
                if (saveBtn) saveBtn.style.display = 'none';
            }
        },

        saveCategoryChanges: function() {
            var self = this;
            var changes = this.pendingCategoryChanges;
            var saveBtn = el('#saveCategoryChanges');
            
            // Check if there are any changes
            var hasChanges = Object.keys(changes.added).length > 0 || 
                             Object.keys(changes.removed).length > 0 || 
                             Object.keys(changes.confirmed).length > 0;
            
            if (!hasChanges) {
                showToast('No changes to save', 'info');
                return;
            }
            
            // Build the save request
            var payload = {
                subAction: 'save_category_assignments',
                added: changes.added,
                removed: changes.removed,
                confirmed: changes.confirmed
            };
            
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...';
            }
            
            var resetButton = function() {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fas fa-save mr-1"></i>Save Changes';
                }
            };
            
            // Use fetch if API.post doesn't work
            if (typeof API !== 'undefined' && API.post) {
                API.post('burden', payload)
                    .then(function(res) {
                        showToast('Category assignments saved', 'success');
                        self.pendingCategoryChanges = { added: {}, removed: {}, confirmed: {} };
                        self.updatePendingChangesUI();
                        self.loadData(true); // Light refresh
                    })
                    .catch(function(err) {
                        showToast('Error saving: ' + (err.message || err), 'danger');
                    })
                    .finally(resetButton);
            } else {
                // Fallback - simulate save
                setTimeout(function() {
                    showToast('Category assignments saved (locally)', 'success');
                    self.pendingCategoryChanges = { added: {}, removed: {}, confirmed: {} };
                    self.updatePendingChangesUI();
                    resetButton();
                }, 500);
            }
        },

        // Keep legacy function for compatibility
        initDragDrop: function() {
            this.initCategoryDragDrop();
        },

        renderCategoryGrid: function() {
            var container = el('#burdenCategoryGrid');
            if (!container) return;

            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            // Sort by order property to maintain user-defined ordering
            categories = categories.slice().sort(function(a, b) {
                return (a.order || 0) - (b.order || 0);
            });
            var classification = this.latestData.classification || {};
            var self = this;

            var html = categories.map(function(cat) {
                var catIdStr = String(cat.id);
                var catClass = classification.byCategory && classification.byCategory[catIdStr];
                var patternCount = catClass ? catClass.pattern : 0;
                // Get account count from classification, not stale cat.accountCount
                var accountCount = catClass ? (catClass.count || (catClass.accounts ? catClass.accounts.length : 0)) : 0;
                var pctOfTotal = cat.percentOfTotal || 0;
                var rateFormat = cat.rateFormat || 'per_hour';
                var allocationMethod = cat.allocationMethod || 'simple';
                var displayRate = self.formatRateValue(cat.totalBurden || 0, rateFormat, cat);
                var scopeBadge = cat.scope === 'company' ? '<span class="badge badge-info badge-sm ml-1" title="Company-wide rate">CO</span>' : '';
                var methodBadge = allocationMethod !== 'simple' ? '<span class="badge badge-secondary badge-sm ml-1" title="' + self.getMethodLabel(allocationMethod) + '">' + allocationMethod.charAt(0).toUpperCase() + '</span>' : '';

                return '<div class="burden-cat-card" data-category-id="' + cat.id + '" onclick="BurdenController.showCategoryFlyout(\'' + cat.id + '\')">' +
                    '<div class="bcc-header" style="border-color: ' + cat.color + ';">' +
                        '<div class="bcc-color" style="background: ' + cat.color + ';"></div>' +
                        '<div class="bcc-title">' + escapeHtml(cat.label) + scopeBadge + methodBadge + '</div>' +
                        '<div class="bcc-edit" onclick="event.stopPropagation(); BurdenController.showEditCategoryFlyout(\'' + cat.id + '\');"><i class="fas fa-cog"></i></div>' +
                    '</div>' +
                    '<div class="bcc-body">' +
                        '<div class="bcc-rate">' + displayRate + '</div>' +
                        '<div class="bcc-expense">' + self.formatCurrency(cat.totalExpense || 0) + ' expense</div>' +
                        '<div class="bcc-bar"><div class="bcc-bar-fill" style="width: ' + pctOfTotal + '%; background: ' + cat.color + ';"></div></div>' +
                        '<div class="bcc-meta">' +
                            '<span><i class="fas fa-receipt"></i> ' + accountCount + ' accounts</span>' +
                            '<span><i class="fas fa-' + self.getBaseIcon(cat.allocationBase) + '"></i> ' + self.getBaseLabel(cat.allocationBase) + '</span>' +
                        '</div>' +
                        '<div class="bcc-meta mt-1">' +
                            '<span><i class="fas fa-' + self.getMethodIcon(allocationMethod) + '"></i> ' + self.getMethodLabel(allocationMethod) + '</span>' +
                            '<span>' + self.getFormatLabel(rateFormat) + '</span>' +
                        '</div>' +
                        (patternCount > 0 ? '<div class="bcc-auto-badge"><i class="fas fa-magic"></i> ' + patternCount + ' auto</div>' : '') +
                        (cat.includeInComposite === false ? '<div class="bcc-exclude-badge"><i class="fas fa-ban"></i> Excluded</div>' : '') +
                        '<div class="bcc-drop-zone"><i class="fas fa-plus-circle"></i> Drop account here</div>' +
                    '</div></div>';
            }).join('');

            container.innerHTML = html;
        },

        renderUnassignedAccounts: function() {
            var container = el('#burdenUnassignedList');
            if (!container || !this.latestData) return;

            var classification = this.latestData.classification || {};
            var unassigned = classification.unassigned || [];
            var categories = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
            var self = this;

            if (unassigned.length === 0) {
                container.innerHTML = '<div class="p-4 text-center text-muted"><i class="fas fa-check-circle fa-2x text-success mb-3 d-block"></i>All accounts assigned!</div>';
                return;
            }

            var html = '<div class="unassigned-list p-2">' + unassigned.slice(0, 50).map(function(acct) {
                var catOptions = categories.map(function(c) {
                    return '<a class="dropdown-item" href="#" onclick="BurdenController.assignAccount(\'' + acct.id + '\', \'' + c.id + '\'); return false;"><span class="category-dot mr-2" style="background: ' + c.color + ';"></span>' + escapeHtml(c.label) + '</a>';
                }).join('');

                return '<div class="unassigned-account" draggable="true" data-account-id="' + acct.id + '">' +
                    '<div class="ua-drag-handle"><i class="fas fa-grip-vertical"></i></div>' +
                    '<div class="ua-info"><span class="ua-number">' + escapeHtml(acct.number || '') + '</span><span class="ua-name">' + escapeHtml(acct.name) + '</span></div>' +
                    '<span class="ua-amount">' + self.formatCurrency(acct.amount || 0) + '</span>' +
                    '<div class="ua-actions dropdown"><button class="btn btn-sm btn-outline-primary dropdown-toggle" data-toggle="dropdown">Assign</button>' +
                        '<div class="dropdown-menu dropdown-menu-right">' + catOptions + '</div></div></div>';
            }).join('') + '</div>' +
            (unassigned.length > 50 ? '<div class="text-center py-2 text-muted small">Showing 50 of ' + unassigned.length + ' accounts</div>' : '');

            container.innerHTML = html;
        },

        renderRatesTab: function() {
            var container = el('#burdenRatesContent');
            if (!container) return;
            
            // Show skeleton while loading
            if (this.isLoading || !this.latestData) {
                container.innerHTML = '<div class="burden-matrix-container">' +
                    '<div class="bm-toolbar skeleton-toolbar">' +
                        '<div class="skeleton-cell skeleton-loading" style="width: 200px; height: 28px;"></div>' +
                        '<div class="skeleton-cell skeleton-loading" style="width: 100px; height: 28px;"></div>' +
                    '</div>' +
                    '<div class="bm-table-wrap">' +
                        [1,2,3,4,5,6,7,8].map(function() {
                            return '<div class="skeleton-row">' +
                                '<div class="skeleton-cell name skeleton-loading"></div>' +
                                '<div class="skeleton-cell amount skeleton-loading"></div>' +
                                '<div class="skeleton-cell amount skeleton-loading"></div>' +
                                '<div class="skeleton-cell amount skeleton-loading"></div>' +
                                '<div class="skeleton-cell rate skeleton-loading"></div>' +
                            '</div>';
                        }).join('') +
                    '</div>' +
                '</div>';
                return;
            }

            var self = this;
            var summary = this.latestData.summary || {};
            var categories = summary.categories || [];
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var totals = summary.totals || {};
            var totalBurden = totals.burden && totals.burden.Overall ? totals.burden.Overall : 0;

            // Calculate stats for legend coloring
            var rates = categories.map(function(c) { return c.totalBurden || 0; }).filter(function(r) { return r > 0; });
            var avgRate = rates.length > 0 ? rates.reduce(function(a, b) { return a + b; }, 0) / rates.length : 0;

            // Compact toolbar with inline legend
            var html = '<style>' +
                // Burden matrix card wrapper
                '.burden-matrix-container { background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; overflow: hidden; }' +
                '.bm-toolbar { padding: 12px 16px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }' +
                '.bm-legend { display: flex; gap: 12px; align-items: center; }' +
                '.bm-leg-item { display: flex; align-items: center; gap: 5px; font-size: 0.7rem; color: #64748b; }' +
                '.bm-leg-dot { width: 10px; height: 10px; border-radius: 3px; }' +
                '.bm-leg-dot.low { background: #10b981; }' +
                '.bm-leg-dot.mid { background: #94a3b8; }' +
                '.bm-leg-dot.high { background: #ef4444; }' +
                '.bm-actions { display: flex; gap: 6px; }' +
                '.bm-actions .btn { border-radius: 6px; padding: 5px 10px; }' +
                // Table styling
                '.bm-table-wrap { overflow-x: auto; }' +
                '.bm-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }' +
                '.bm-table th { background: #fafbfc; border-bottom: 1px solid #e2e8f0; font-size: 0.65rem; text-transform: uppercase; color: #64748b; font-weight: 600; padding: 10px 8px; text-align: left; white-space: nowrap; }' +
                '.bm-table td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; }' +
                '.bm-table tr:hover td { background: #f8fafc; }' +
                '.bm-table tr:last-child td { border-bottom: none; }' +
                '.bm-th-cat { min-width: 140px; }' +
                '.bm-th-type { width: 70px; }' +
                '.bm-th-base { width: 70px; }' +
                '.bm-td-type { }' +
                '.bm-td-base { }' +
                '.bm-th-dept { min-width: 80px; text-align: right !important; }' +
                '.bm-th-overall { width: 90px; text-align: right !important; font-weight: 700 !important; }' +
                '.bm-td-cat { font-weight: 500; }' +
                '.bm-td-rate { text-align: right; font-variant-numeric: tabular-nums; cursor: pointer; transition: background 0.15s; }' +
                '.bm-td-rate:hover { background: #eff6ff !important; }' +
                '.bm-td-rate.low { color: #10b981; }' +
                '.bm-td-rate.high { color: #ef4444; }' +
                '.bm-td-overall { text-align: right; font-weight: 600; background: #fafbfc; }' +
                '.bm-cat-cell { display: flex; align-items: center; gap: 8px; }' +
                '.bm-cat-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }' +
                '.bm-cat-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
                '.bm-type-badge { font-size: 0.6rem; padding: 2px 6px; border-radius: 4px; background: #f1f5f9; color: #64748b; }' +
                '.bm-type-badge.expense { background: #dbeafe; color: #2563eb; }' +
                '.bm-type-badge.time, .bm-type-badge.timebill { background: #d1fae5; color: #059669; }' +
                '.bm-type-badge.manual { background: #fef3c7; color: #d97706; }' +
                '.bm-type-badge.derived { background: #ede9fe; color: #7c3aed; }' +
                '.bm-base-label { font-size: 0.7rem; color: #64748b; }' +
                '.bm-rate-val { font-variant-numeric: tabular-nums; }' +
                '.bm-excluded { opacity: 0.5; }' +
                '.bm-excluded-icon { color: #ef4444; font-size: 0.65rem; margin-left: 4px; }' +
                '.bm-row-total td { background: #f8fafc !important; font-weight: 600; border-top: 2px solid #e2e8f0 !important; }' +
                '.bm-td-rate.total, .bm-td-overall.total { font-weight: 700; color: #1e293b; }' +
                '.bm-group-header td { font-weight: 600 !important; }' +
                '.bm-group-child td { font-size: 0.75rem; }' +
                '.bm-group-toggle { color: #64748b; font-size: 0.65rem; }' +
            '</style>' +
            '<div class="burden-matrix-container">' +
                '<div class="bm-toolbar">' +
                    '<div class="bm-legend">' +
                        '<span class="bm-leg-item"><span class="bm-leg-dot low"></span>Below avg</span>' +
                        '<span class="bm-leg-item"><span class="bm-leg-dot mid"></span>Average</span>' +
                        '<span class="bm-leg-item"><span class="bm-leg-dot high"></span>Above avg</span>' +
                    '</div>' +
                    '<div class="bm-actions">' +
                        '<button class="btn btn-sm ' + (this.ratesGroupedByType ? 'btn-primary' : 'btn-outline-secondary') + '" onclick="BurdenController.toggleRatesGrouping()" title="Group by category type"><i class="fas fa-layer-group"></i></button>' +
                        '<button class="btn btn-sm btn-outline-secondary ml-1" onclick="BurdenController.exportRates()" title="Export to CSV"><i class="fas fa-download"></i></button>' +
                    '</div>' +
                '</div>';

            // Matrix table
            html += '<div class="bm-table-wrap"><table class="bm-table">' +
                '<thead><tr>' +
                    '<th class="bm-th-cat">Category</th>' +
                    '<th class="bm-th-type">Type</th>' +
                    '<th class="bm-th-base">Base</th>';

            depts.forEach(function(d) {
                html += '<th class="bm-th-dept">' + escapeHtml(d.name) + '</th>';
            });

            html += '<th class="bm-th-overall">Overall</th>' +
                '</tr></thead><tbody>';

            // Category rows - grouped or flat
            if (this.ratesGroupedByType) {
                // Group categories by type
                var typeOrder = ['expense', 'time', 'timebill', 'manual', 'derived'];
                var typeLabels = {
                    expense: 'Expense',
                    time: 'Time',
                    timebill: 'Time',
                    manual: 'Manual',
                    derived: 'Derived'
                };
                var typeColors = {
                    expense: '#3b82f6',
                    time: '#10b981',
                    timebill: '#10b981',
                    manual: '#f59e0b',
                    derived: '#8b5cf6'
                };
                
                var grouped = {};
                categories.forEach(function(cat) {
                    var catType = cat.categoryType || 'expense';
                    // Normalize time types
                    var groupKey = (catType === 'time' || catType === 'timebill') ? 'time' : catType;
                    if (!grouped[groupKey]) grouped[groupKey] = [];
                    grouped[groupKey].push(cat);
                });
                
                typeOrder.forEach(function(typeKey) {
                    if (typeKey === 'timebill') return; // Skip, merged with time
                    var cats = grouped[typeKey];
                    if (!cats || cats.length === 0) return;
                    
                    // Calculate group totals
                    var groupTotals = { byDept: {}, overall: 0 };
                    cats.forEach(function(cat) {
                        var catOverall = cat.totalBurden || 0;
                        groupTotals.overall += catOverall;
                        depts.forEach(function(d) {
                            var rate = cat.burden && cat.burden[d.id] ? cat.burden[d.id] : 0;
                            groupTotals.byDept[d.id] = (groupTotals.byDept[d.id] || 0) + rate;
                        });
                    });
                    
                    // Group header row (parent)
                    var typeLabel = typeLabels[typeKey] || 'Other';
                    var typeColor = typeColors[typeKey] || '#6b7280';
                    html += '<tr class="bm-row bm-group-header" data-group="' + typeKey + '" onclick="BurdenController.toggleTypeGroup(\'' + typeKey + '\')" style="cursor:pointer; background: linear-gradient(90deg, ' + typeColor + '15 0%, transparent 100%);">' +
                        '<td class="bm-td-cat" colspan="3">' +
                            '<div class="bm-cat-cell">' +
                                '<i class="fas fa-chevron-down bm-group-toggle mr-2" id="groupToggle_' + typeKey + '" style="transition: transform 0.2s;"></i>' +
                                '<span class="bm-type-badge ' + typeKey + ' mr-2">' + typeLabel + '</span>' +
                                '<strong>' + cats.length + ' categor' + (cats.length === 1 ? 'y' : 'ies') + '</strong>' +
                            '</div>' +
                        '</td>';
                    
                    // Group totals by dept
                    depts.forEach(function(d) {
                        var rate = groupTotals.byDept[d.id] || 0;
                        html += '<td class="bm-td-rate" style="font-weight:600; background:' + typeColor + '10;">$' + self.fmtNum(rate, 2) + '</td>';
                    });
                    
                    html += '<td class="bm-td-overall" style="font-weight:600; background:' + typeColor + '15;">$' + self.fmtNum(groupTotals.overall, 2) + '/hr</td></tr>';
                    
                    // Child rows
                    cats.forEach(function(cat) {
                        var catType = cat.categoryType || 'expense';
                        var isTimeType = catType === 'time' || catType === 'timebill';
                        var childTypeLabel = isTimeType ? 'Time' : (catType === 'manual' ? 'Manual' : (catType === 'derived' ? 'Derived' : 'Expense'));
                        var typeClass = isTimeType ? 'time' : catType;
                        var baseLabel = self.getBaseLabel(cat.allocationBase || 'hours');
                        var overallRate = cat.totalBurden || 0;
                        var excludedClass = cat.includeInComposite === false ? ' bm-excluded' : '';

                        html += '<tr class="bm-row bm-group-child' + excludedClass + '" data-parent-group="' + typeKey + '">' +
                            '<td class="bm-td-cat" style="padding-left: 2.5rem;">' +
                                '<div class="bm-cat-cell">' +
                                    '<span class="bm-cat-dot" style="background:' + (cat.color || '#6b7280') + ';"></span>' +
                                    '<span class="bm-cat-name">' + escapeHtml(cat.label) + '</span>' +
                                    (cat.includeInComposite === false ? '<i class="fas fa-ban bm-excluded-icon" title="Excluded from composite"></i>' : '') +
                                '</div>' +
                            '</td>' +
                            '<td class="bm-td-type"><span class="bm-type-badge ' + typeClass + '">' + childTypeLabel + '</span></td>' +
                            '<td class="bm-td-base"><span class="bm-base-label">' + baseLabel + '</span></td>';

                        // Department cells
                        depts.forEach(function(d) {
                            var rate = cat.burden && cat.burden[d.id] ? cat.burden[d.id] : 0;
                            var rateClass = self.getBurdenRateClass(rate, avgRate);
                            var displayRate = self.formatRateValue(rate, cat.rateFormat || 'per_hour', cat);
                            html += '<td class="bm-td-rate ' + rateClass + '" onclick="event.stopPropagation(); BurdenController.showCellFlyout(\'' + cat.id + '\', \'' + d.id + '\')">' +
                                '<span class="bm-rate-val">' + displayRate + '</span>' +
                            '</td>';
                        });

                        // Overall cell
                        var overallDisplay = self.formatRateValue(overallRate, cat.rateFormat || 'per_hour', cat);
                        html += '<td class="bm-td-overall">' + overallDisplay + '</td></tr>';
                    });
                });
            } else {
                // Flat view (original)
                categories.forEach(function(cat) {
                    var catType = cat.categoryType || 'expense';
                    var isTimeType = catType === 'time' || catType === 'timebill';
                    var typeLabel = isTimeType ? 'Time' : (catType === 'manual' ? 'Manual' : (catType === 'derived' ? 'Derived' : 'Expense'));
                    var typeClass = isTimeType ? 'time' : catType;
                    var baseLabel = self.getBaseLabel(cat.allocationBase || 'hours');
                    var overallRate = cat.totalBurden || 0;
                    var excludedClass = cat.includeInComposite === false ? ' bm-excluded' : '';

                    html += '<tr class="bm-row' + excludedClass + '">' +
                        '<td class="bm-td-cat">' +
                            '<div class="bm-cat-cell">' +
                                '<span class="bm-cat-dot" style="background:' + (cat.color || '#6b7280') + ';"></span>' +
                                '<span class="bm-cat-name">' + escapeHtml(cat.label) + '</span>' +
                                (cat.includeInComposite === false ? '<i class="fas fa-ban bm-excluded-icon" title="Excluded from composite"></i>' : '') +
                            '</div>' +
                        '</td>' +
                        '<td class="bm-td-type"><span class="bm-type-badge ' + typeClass + '">' + typeLabel + '</span></td>' +
                        '<td class="bm-td-base"><span class="bm-base-label">' + baseLabel + '</span></td>';

                    // Department cells
                    depts.forEach(function(d) {
                        var rate = cat.burden && cat.burden[d.id] ? cat.burden[d.id] : 0;
                        var rateClass = self.getBurdenRateClass(rate, avgRate);
                        var displayRate = self.formatRateValue(rate, cat.rateFormat || 'per_hour', cat);
                        html += '<td class="bm-td-rate ' + rateClass + '" onclick="BurdenController.showCellFlyout(\'' + cat.id + '\', \'' + d.id + '\')">' +
                            '<span class="bm-rate-val">' + displayRate + '</span>' +
                        '</td>';
                    });

                    // Overall cell
                    var overallDisplay = self.formatRateValue(overallRate, cat.rateFormat || 'per_hour', cat);
                    html += '<td class="bm-td-overall">' + overallDisplay + '</td></tr>';
                });
            }

            // Totals row
            html += '<tr class="bm-row-total">' +
                '<td class="bm-td-cat"><strong>Total Burden</strong></td>' +
                '<td class="bm-td-type"></td>' +
                '<td class="bm-td-base"></td>';

            depts.forEach(function(d) {
                var rate = totals.burden && totals.burden[d.id] ? totals.burden[d.id] : 0;
                html += '<td class="bm-td-rate total">$' + self.fmtNum(rate, 2) + '</td>';
            });

            html += '<td class="bm-td-overall total">$' + self.fmtNum(totalBurden, 2) + '/hr</td>' +
                '</tr></tbody></table></div></div>';

            container.innerHTML = html;
        },

        getBurdenRateClass: function(rate, avgRate) {
            if (rate === 0) return 'zero';
            var threshold = 0.15;
            if (rate < avgRate * (1 - threshold)) return 'low';
            if (rate > avgRate * (1 + threshold)) return 'high';
            return 'mid';
        },
        
        toggleRatesGrouping: function() {
            this.ratesGroupedByType = !this.ratesGroupedByType;
            this.renderRatesTab();
        },
        
        toggleTypeGroup: function(typeKey) {
            var childRows = document.querySelectorAll('.bm-group-child[data-parent-group="' + typeKey + '"]');
            var toggleIcon = document.getElementById('groupToggle_' + typeKey);
            
            var isHidden = childRows.length > 0 && childRows[0].style.display === 'none';
            
            childRows.forEach(function(row) {
                row.style.display = isHidden ? '' : 'none';
            });
            
            if (toggleIcon) {
                toggleIcon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
            }
        },

        renderModelerTab: function() {
            var container = el('#burdenModelerContent');
            if (!container) return;
            
            // Show skeleton while loading
            if (this.isLoading || !this.latestData) {
                container.innerHTML = '<div class="p-3"><div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-muted"></i></div></div>';
                return;
            }

            var self = this;
            var kpis = this.latestData.kpis || {};
            var absorption = this.latestData.absorption || {};
            var allocationBases = this.latestData.allocationBases || {};
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var summary = this.latestData.summary || {};
            
            // Core metrics
            var totalOverhead = kpis.totalExpenses || summary.totalExpense || 0;
            var totalAbsorbed = absorption.applied || kpis.burdenApplied || 0;
            var totalHours = (allocationBases.hours && allocationBases.hours.totalBilled) || kpis.billedHours || 1;
            var hoursByDeptData = (allocationBases.hours && allocationBases.hours.byDept) || {};
            
            // Calculate utilization data
            var hoursData = allocationBases.hours || {};
            var totalUnbilledHours = hoursData.totalUnbilled || 0;
            var totalAvailableHours = totalHours + totalUnbilledHours;
            var currentUtilization = totalAvailableHours > 0 ? (totalHours / totalAvailableHours * 100) : 70; // Default 70% if unknown
            
            // Find unbilled-only timebill categories (for utilization lever)
            var categories = (summary.categories) || [];
            var categoryDefs = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
            var catDefMap = {};
            categoryDefs.forEach(function(c) { catDefMap[c.id] = c; });
            
            var unbilledOnlyOverhead = 0;
            categories.forEach(function(cat) {
                var def = catDefMap[cat.id];
                if (def && def.categoryType === 'timebill') {
                    var tf = def.timeFilters || {};
                    // Only unbilled: includeNonBillable=true AND includeBillable=false
                    var isUnbilledOnly = tf.includeNonBillable === true && tf.includeBillable === false;
                    if (isUnbilledOnly) {
                        unbilledOnlyOverhead += (cat.totalExpense || 0);
                    }
                }
            });
            
            // THE GAP
            var theGap = totalAbsorbed - totalOverhead;
            var gapPerHour = totalHours > 0 ? theGap / totalHours : 0;
            var absorptionPct = totalOverhead > 0 ? (totalAbsorbed / totalOverhead * 100) : 100;
            
            // Rates
            var calculatedRate = kpis.compositeRate || (totalHours > 0 ? totalOverhead / totalHours : 0);
            var chargedRate = totalHours > 0 ? totalAbsorbed / totalHours : 0;
            var budgetRate = (this.latestData.meta && this.latestData.meta.config && this.latestData.meta.config.budgetedRates && this.latestData.meta.config.budgetedRates.overall) || calculatedRate;
            var breakEvenRate = calculatedRate;
            
            // Gap status
            var isUnderAbsorbed = theGap < 0;
            var gapStatusClass = isUnderAbsorbed ? 'danger' : 'success';
            var gapStatusText = isUnderAbsorbed ? 'Under-Absorbed' : 'Over-Absorbed';
            
            // Department data with distribution controls
            var deptData = depts.map(function(d) {
                var deptId = d.id;
                var deptIdStr = String(d.id);
                var deptHoursObj = hoursByDeptData[deptId] || hoursByDeptData[deptIdStr] || {};
                var deptHours = typeof deptHoursObj === 'object' ? (deptHoursObj.billed || deptHoursObj.total || 0) : (deptHoursObj || 0);
                if (deptHours === 0 && d.hours) deptHours = d.hours;
                if (deptHours === 0 && d.billedHours) deptHours = d.billedHours;
                
                var deptCalcRate = (summary.compositeByDept && (summary.compositeByDept[deptId] || summary.compositeByDept[deptIdStr])) || calculatedRate;
                var hoursPct = totalHours > 0 ? (deptHours / totalHours * 100) : 0;
                var deptGapContribution = gapPerHour * deptHours;
                
                return { 
                    id: deptId, 
                    name: d.name, 
                    rate: deptCalcRate, 
                    hours: deptHours, 
                    hoursPct: hoursPct,
                    gapContribution: deptGapContribution,
                    gapContributionPct: Math.abs(theGap) > 0 ? (Math.abs(deptGapContribution) / Math.abs(theGap) * 100) : 0,
                    // Distribution controls (defaults)
                    weight: 100,
                    cap: null,
                    locked: false
                };
            }).sort(function(a, b) { return Math.abs(b.gapContribution) - Math.abs(a.gapContribution); });
            
            // Store for live updates
            this.modelerData = {
                totalOverhead: totalOverhead,
                totalAbsorbed: totalAbsorbed,
                totalHours: totalHours,
                theGap: theGap,
                gapPerHour: gapPerHour,
                chargedRate: chargedRate,
                calculatedRate: calculatedRate,
                budgetRate: budgetRate,
                absorptionPct: absorptionPct,
                deptData: deptData,
                // Utilization data
                unbilledOnlyOverhead: unbilledOnlyOverhead,
                currentUtilization: currentUtilization,
                totalAvailableHours: totalAvailableHours,
                // Recovery timeline settings
                recoveryMonths: 6,
                recoveryMethod: 'balanced',
                // Lever values (will be modified by sliders)
                rateAdjust: 0,
                hoursAdjust: 0,
                costAdjust: 0,
                utilizationAdjust: 0
            };
            
            var maxRate = Math.max(calculatedRate, chargedRate, budgetRate, breakEvenRate) * 1.2;

            var html = 
                '<style>' +
                    // Lever section - no header needed
                    '.gm-levers-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }' +
                    '@media (max-width: 1200px) { .gm-levers-grid { grid-template-columns: repeat(2, 1fr); } }' +
                    '@media (max-width: 768px) { .gm-levers-grid { grid-template-columns: 1fr; } }' +
                    
                    // Individual lever cards
                    '.gm-lever { background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; transition: all 0.2s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }' +
                    '.gm-lever:hover { border-color: #3b82f6; box-shadow: 0 4px 12px rgba(59,130,246,0.12); }' +
                    '.gm-lever.active { border-color: #3b82f6; background: #eff6ff; }' +
                    '.gm-lever-top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }' +
                    '.gm-lever-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0; }' +
                    '.gm-lever-info { flex: 1; }' +
                    '.gm-lever-name { font-weight: 600; font-size: 0.9rem; color: #1e293b; }' +
                    '.gm-lever-desc { font-size: 0.7rem; color: #64748b; line-height: 1.3; }' +
                    '.gm-lever-control { margin-bottom: 8px; }' +
                    '.gm-lever-slider { -webkit-appearance: none; width: 100%; height: 6px; border-radius: 3px; background: #e2e8f0; outline: none; cursor: pointer; }' +
                    '.gm-lever-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #3b82f6; cursor: pointer; box-shadow: 0 2px 4px rgba(59,130,246,0.3); transition: transform 0.15s; }' +
                    '.gm-lever-slider::-webkit-slider-thumb:hover { transform: scale(1.1); }' +
                    '.gm-lever-slider.negative::-webkit-slider-thumb { background: #10b981; }' +
                    '.gm-lever-value-row { display: flex; justify-content: space-between; align-items: center; }' +
                    '.gm-lever-input { width: 80px; text-align: right; font-weight: 600; font-size: 0.9rem; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px 8px; }' +
                    '.gm-lever-input:focus { border-color: #3b82f6; outline: none; box-shadow: 0 0 0 2px rgba(59,130,246,0.1); }' +
                    '.gm-lever-impact { font-size: 0.75rem; padding: 6px 10px; border-radius: 6px; margin-top: 10px; text-align: center; font-weight: 600; }' +
                    '.gm-lever-impact.positive { background: #dcfce7; color: #15803d; }' +
                    '.gm-lever-impact.negative { background: #fee2e2; color: #dc2626; }' +
                    '.gm-lever-impact.neutral { background: #f1f5f9; color: #64748b; }' +
                    
                    // Presets bar
                    '.gm-presets-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; padding: 12px 16px; background: #f8fafc; border-radius: 8px; }' +
                    '.gm-preset { padding: 6px 12px; border-radius: 16px; border: 1px solid #e2e8f0; background: white; font-size: 0.75rem; font-weight: 500; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 5px; }' +
                    '.gm-preset:hover { border-color: #3b82f6; background: #eff6ff; }' +
                    '.gm-preset.active { border-color: #3b82f6; background: #3b82f6; color: white; }' +
                    '.gm-preset i { font-size: 0.7rem; }' +
                    
                    // Results section with progress bar
                    '.gm-results-section { background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; margin-bottom: 20px; overflow: hidden; }' +
                    '.gm-results-header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }' +
                    '.gm-results-title { font-weight: 600; font-size: 0.95rem; color: #1e293b; display: flex; align-items: center; gap: 8px; }' +
                    '.gm-results-actions { display: flex; gap: 8px; }' +
                    '.gm-results-grid { display: grid; grid-template-columns: repeat(5, 1fr); border-bottom: 1px solid #e2e8f0; }' +
                    '@media (max-width: 992px) { .gm-results-grid { grid-template-columns: repeat(3, 1fr); } }' +
                    '@media (max-width: 576px) { .gm-results-grid { grid-template-columns: repeat(2, 1fr); } }' +
                    '.gm-result-item { padding: 16px; text-align: center; border-right: 1px solid #f1f5f9; }' +
                    '.gm-result-item:last-child { border-right: none; }' +
                    '.gm-result-value { font-size: 1.25rem; font-weight: 700; color: #1e293b; margin-bottom: 2px; }' +
                    '.gm-result-label { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }' +
                    '.gm-result-delta { font-size: 0.75rem; margin-top: 4px; font-weight: 500; }' +
                    
                    // Progress bar inside results
                    '.gm-progress-section { padding: 16px 20px; }' +
                    '.gm-progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }' +
                    '.gm-progress-label { font-size: 0.8rem; color: #64748b; font-weight: 500; }' +
                    '.gm-progress-pct { font-size: 1.1rem; font-weight: 700; color: #1e293b; }' +
                    '.gm-progress-bar { height: 12px; background: #e2e8f0; border-radius: 6px; overflow: hidden; }' +
                    '.gm-progress-fill { height: 100%; border-radius: 6px; transition: width 0.4s ease, background 0.3s ease; }' +
                    '.gm-progress-labels { display: flex; justify-content: space-between; margin-top: 6px; font-size: 0.65rem; color: #94a3b8; }' +
                    
                    // Department table in results
                    '.gm-dept-section { border-top: 1px solid #e2e8f0; }' +
                    '.gm-dept-header { padding: 12px 20px; background: #f8fafc; font-weight: 600; font-size: 0.85rem; color: #475569; display: flex; align-items: center; gap: 8px; }' +
                    '.gm-dept-table { width: 100%; border-collapse: collapse; table-layout: fixed; }' +
                    '.gm-dept-table th { font-size: 0.65rem; text-transform: uppercase; color: #64748b; font-weight: 600; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; background: #fafbfc; }' +
                    '.gm-dept-table th:nth-child(1) { width: 22%; }' +
                    '.gm-dept-table th:nth-child(2) { width: 12%; }' +
                    '.gm-dept-table th:nth-child(3) { width: 11%; }' +
                    '.gm-dept-table th:nth-child(4) { width: 13%; }' +
                    '.gm-dept-table th:nth-child(5) { width: 10%; }' +
                    '.gm-dept-table th:nth-child(6) { width: 8%; }' +
                    '.gm-dept-table th:nth-child(7) { width: 12%; }' +
                    '.gm-dept-table th:nth-child(8) { width: 12%; }' +
                    '.gm-dept-table td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; font-size: 0.8rem; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
                    '.gm-dept-table tr:last-child td { border-bottom: none; }' +
                    '.gm-dept-table tr:hover td { background: #f8fafc; }' +
                    '.gm-dept-table .dept-name { font-weight: 500; }' +
                    '.gm-dept-weight { width: 100%; font-size: 0.75rem; padding: 3px 4px; }' +
                    '.gm-dept-cap { width: 100%; font-size: 0.75rem; padding: 3px 4px; text-align: right; }' +
                    '.gm-dept-lock { width: 16px; height: 16px; cursor: pointer; }' +
                    '.gm-dept-table tr.locked td { opacity: 0.5; }' +
                    '.gm-dept-table tr.locked td:nth-child(6) { opacity: 1; }' +
                    
                    // Recovery timeline (inside results)
                    '.gm-recovery-section { border-top: 1px solid #e2e8f0; padding: 16px 20px; }' +
                    '.gm-recovery-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 20px; background: #f8fafc; margin: -16px -20px 12px -20px; border-bottom: 1px solid #e2e8f0; }' +
                    '.gm-recovery-title { font-weight: 600; font-size: 0.85rem; color: #475569; display: flex; align-items: center; gap: 8px; }' +
                    '.gm-recovery-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }' +
                    '.gm-recovery-periods { display: flex; gap: 4px; }' +
                    '.gm-recovery-period { padding: 5px 10px; border-radius: 4px; border: 1px solid #e2e8f0; background: white; font-size: 0.7rem; font-weight: 500; cursor: pointer; transition: all 0.15s; }' +
                    '.gm-recovery-period:hover { border-color: #3b82f6; background: #eff6ff; }' +
                    '.gm-recovery-period.active { border-color: #3b82f6; background: #3b82f6; color: white; }' +
                    '.gm-recovery-method { font-size: 0.75rem; padding: 4px 8px; }' +
                    '.gm-recovery-steps { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 10px; }' +
                    '.gm-recovery-step { flex: 1; min-width: 70px; background: white; border-radius: 6px; padding: 8px 4px; text-align: center; border: 1px solid #e2e8f0; transition: all 0.2s; }' +
                    '.gm-recovery-step.complete { border-color: #10b981; background: #ecfdf5; }' +
                    '.gm-recovery-step-month { font-weight: 600; font-size: 0.7rem; margin-bottom: 2px; color: #475569; }' +
                    '.gm-recovery-step-rate { font-size: 0.65rem; color: #64748b; }' +
                    '.gm-recovery-step-pct { font-size: 0.6rem; margin-top: 2px; font-weight: 600; }' +
                    '.gm-recovery-summary { font-size: 0.75rem; color: #64748b; padding: 8px 12px; background: #f8fafc; border-radius: 6px; display: flex; gap: 16px; flex-wrap: wrap; }' +
                    '.gm-recovery-summary span { display: flex; align-items: center; gap: 4px; }' +
                    '.gm-recovery-summary strong { color: #1e293b; }' +
                    
                    // Timeline (OLD - keeping for backwards compat but hiding)
                    '.gm-timeline { display: none; }' +
                    
                    // Saved scenarios & actions
                    '.gm-saved-scenarios { margin-bottom: 12px; }' +
                    '.gm-scenario-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: #f1f5f9; border-radius: 16px; font-size: 0.75rem; margin-right: 6px; margin-bottom: 6px; cursor: pointer; transition: all 0.15s; }' +
                    '.gm-scenario-chip:hover { background: #e2e8f0; }' +
                    '.gm-scenario-chip .delete { opacity: 0.5; }' +
                    '.gm-scenario-chip .delete:hover { opacity: 1; color: #dc2626; }' +
                    '.gm-actions { display: flex; gap: 10px; flex-wrap: wrap; }' +
                    '.gm-action-btn { padding: 10px 16px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; font-weight: 500; font-size: 0.8rem; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 6px; }' +
                    '.gm-action-btn:hover { background: #f8fafc; border-color: #cbd5e1; }' +
                '</style>' +
                
                // ═══════════════════════════════════════════════════════════════════
                // SECTION 1: KPI CARDS - Using global cf-kpi-card style (4 KPIs)
                // ═══════════════════════════════════════════════════════════════════
                '<div class="row mb-3 gutters-sm cf-kpi-row">' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-blue-soft"><i class="fas fa-tachometer-alt text-blue"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Avg Charged Rate</span>' +
                                '<span class="kpi-value">$' + this.fmtNum(chargedRate, 2) + '/hr</span>' +
                                '<span class="kpi-sub">Break-even: $' + this.fmtNum(calculatedRate, 2) + '</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-purple-soft"><i class="fas fa-percentage text-purple"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Absorption</span>' +
                                '<span class="kpi-value">' + this.fmtNum(absorptionPct, 1) + '%</span>' +
                                '<span class="kpi-sub">' + gapStatusText + '</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card" style="border-color: ' + (isUnderAbsorbed ? '#fecaca' : '#a7f3d0') + '; background: ' + (isUnderAbsorbed ? '#fef2f2' : '#ecfdf5') + ';">' +
                            '<div class="icon-wrapper" style="background: ' + (isUnderAbsorbed ? '#fee2e2' : '#dcfce7') + ';"><i class="fas fa-' + (isUnderAbsorbed ? 'exclamation-triangle text-danger' : 'check-circle text-success') + '"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">The Gap</span>' +
                                '<span class="kpi-value" style="color: ' + (isUnderAbsorbed ? '#dc2626' : '#059669') + ';">' + (theGap >= 0 ? '+' : '') + this.formatCurrency(theGap) + '</span>' +
                                '<span class="kpi-sub">' + this.fmtNum(totalHours, 0) + ' hrs × ' + depts.length + ' depts</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card" style="border-color: ' + (isUnderAbsorbed ? '#fecaca' : '#a7f3d0') + '; background: ' + (isUnderAbsorbed ? '#fef2f2' : '#ecfdf5') + ';">' +
                            '<div class="icon-wrapper" style="background: ' + (isUnderAbsorbed ? '#fee2e2' : '#dcfce7') + ';"><i class="fas fa-' + (isUnderAbsorbed ? 'arrow-down text-danger' : 'arrow-up text-success') + '"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Gap / Hour</span>' +
                                '<span class="kpi-value" style="color: ' + (isUnderAbsorbed ? '#dc2626' : '#059669') + ';">' + (gapPerHour >= 0 ? '+' : '') + '$' + this.fmtNum(gapPerHour, 2) + '</span>' +
                                '<span class="kpi-sub">per billed hour</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                // ═══════════════════════════════════════════════════════════════════
                // SECTION 2: INTERACTIVE LEVERS (directly under KPIs, no title)
                // ═══════════════════════════════════════════════════════════════════
                // Presets bar
                '<div class="gm-presets-bar">' +
                    '<span class="text-muted small">Quick scenarios:</span>' +
                    '<button class="gm-preset" onclick="BurdenController.applyPreset(\'full_rate\')"><i class="fas fa-arrow-up"></i>100% Rate</button>' +
                    '<button class="gm-preset" onclick="BurdenController.applyPreset(\'full_hours\')"><i class="fas fa-clock"></i>100% Hours</button>' +
                    '<button class="gm-preset" onclick="BurdenController.applyPreset(\'full_cut\')"><i class="fas fa-cut"></i>100% Cut</button>' +
                    '<button class="gm-preset" onclick="BurdenController.applyPreset(\'balanced\')"><i class="fas fa-balance-scale"></i>Balanced</button>' +
                    '<button class="gm-preset" onclick="BurdenController.applyPreset(\'rate_hours\')"><i class="fas fa-exchange-alt"></i>50/50</button>' +
                    '<button class="gm-preset" onclick="BurdenController.applyPreset(\'conservative\')"><i class="fas fa-shield-alt"></i>Conservative</button>' +
                    '<div class="ml-auto">' +
                        '<button class="btn btn-sm btn-outline-secondary" onclick="BurdenController.resetAllLevers()" title="Reset all levers"><i class="fas fa-undo"></i></button>' +
                    '</div>' +
                '</div>' +
                
                // Four Levers
                '<div class="gm-levers-grid">' +
                    // Lever 1: Rate Increase
                    '<div class="gm-lever" id="leverRate">' +
                        '<div class="gm-lever-top">' +
                            '<div class="gm-lever-icon" style="background: #fee2e2; color: #dc2626;"><i class="fas fa-arrow-up"></i></div>' +
                            '<div class="gm-lever-info">' +
                                '<div class="gm-lever-name">Raise Burden Rate</div>' +
                                '<div class="gm-lever-desc">Increase rate per billable hour</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="gm-lever-control">' +
                            '<input type="range" class="gm-lever-slider" id="sliderRate" min="0" max="' + Math.ceil(Math.abs(gapPerHour) * 2) + '" step="0.25" value="0" oninput="BurdenController.onLeverChange()">' +
                        '</div>' +
                        '<div class="gm-lever-value-row">' +
                            '<span class="text-muted small">+$/hr</span>' +
                            '<input type="number" class="gm-lever-input" id="inputRate" value="0.00" step="0.25" oninput="BurdenController.onLeverInputChange(\'rate\')">' +
                        '</div>' +
                        '<div class="gm-lever-impact neutral" id="impactRate">No change</div>' +
                    '</div>' +
                    
                    // Lever 2: Hours Increase
                    '<div class="gm-lever" id="leverHours">' +
                        '<div class="gm-lever-top">' +
                            '<div class="gm-lever-icon" style="background: #dbeafe; color: #2563eb;"><i class="fas fa-clock"></i></div>' +
                            '<div class="gm-lever-info">' +
                                '<div class="gm-lever-name">Add Billable Hours</div>' +
                                '<div class="gm-lever-desc">Win more work or utilization</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="gm-lever-control">' +
                            '<input type="range" class="gm-lever-slider" id="sliderHours" min="0" max="' + Math.ceil(chargedRate > 0 ? Math.abs(theGap) / chargedRate * 2 : 5000) + '" step="10" value="0" oninput="BurdenController.onLeverChange()">' +
                        '</div>' +
                        '<div class="gm-lever-value-row">' +
                            '<span class="text-muted small">+hours</span>' +
                            '<input type="number" class="gm-lever-input" id="inputHours" value="0" step="10" oninput="BurdenController.onLeverInputChange(\'hours\')">' +
                        '</div>' +
                        '<div class="gm-lever-impact neutral" id="impactHours">No change</div>' +
                    '</div>' +
                    
                    // Lever 3: Cost Reduction
                    '<div class="gm-lever" id="leverCost">' +
                        '<div class="gm-lever-top">' +
                            '<div class="gm-lever-icon" style="background: #dcfce7; color: #059669;"><i class="fas fa-cut"></i></div>' +
                            '<div class="gm-lever-info">' +
                                '<div class="gm-lever-name">Reduce Overhead</div>' +
                                '<div class="gm-lever-desc">Cut indirect costs</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="gm-lever-control">' +
                            '<input type="range" class="gm-lever-slider negative" id="sliderCost" min="0" max="' + Math.ceil(Math.abs(theGap) * 1.5) + '" step="100" value="0" oninput="BurdenController.onLeverChange()">' +
                        '</div>' +
                        '<div class="gm-lever-value-row">' +
                            '<span class="text-muted small">-$</span>' +
                            '<input type="number" class="gm-lever-input" id="inputCost" value="0" step="100" oninput="BurdenController.onLeverInputChange(\'cost\')">' +
                        '</div>' +
                        '<div class="gm-lever-impact neutral" id="impactCost">No change</div>' +
                    '</div>' +
                    
                    // Lever 4: Utilization
                    '<div class="gm-lever" id="leverUtil">' +
                        '<div class="gm-lever-top">' +
                            '<div class="gm-lever-icon" style="background: #f3e8ff; color: #7c3aed;"><i class="fas fa-percentage"></i></div>' +
                            '<div class="gm-lever-info">' +
                                '<div class="gm-lever-name">Improve Utilization</div>' +
                                '<div class="gm-lever-desc">Convert non-billable time</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="gm-lever-control">' +
                            '<input type="range" class="gm-lever-slider" id="sliderUtil" min="0" max="20" step="1" value="0" oninput="BurdenController.onLeverChange()">' +
                        '</div>' +
                        '<div class="gm-lever-value-row">' +
                            '<span class="text-muted small">+% pts</span>' +
                            '<input type="number" class="gm-lever-input" id="inputUtil" value="0" step="1" max="30" oninput="BurdenController.onLeverInputChange(\'util\')">' +
                        '</div>' +
                        '<div class="gm-lever-impact neutral" id="impactUtil">No change</div>' +
                    '</div>' +
                '</div>' +
                
                // ═══════════════════════════════════════════════════════════════════
                // SECTION 3: PROJECTED RESULTS (with progress bar & dept table)
                // ═══════════════════════════════════════════════════════════════════
                '<div class="gm-results-section">' +
                    '<div class="gm-results-header">' +
                        '<div class="gm-results-title"><i class="fas fa-chart-line text-success"></i> Projected Results</div>' +
                        '<div class="gm-results-actions">' +
                            '<button class="btn btn-sm btn-outline-secondary" onclick="BurdenController.exportScenario()"><i class="fas fa-file-export mr-1"></i>Export</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="gm-results-grid">' +
                        '<div class="gm-result-item">' +
                            '<div class="gm-result-value" id="resultNewRate">$' + this.fmtNum(chargedRate, 2) + '</div>' +
                            '<div class="gm-result-label">New Rate</div>' +
                            '<div class="gm-result-delta" id="resultRateDelta">--</div>' +
                        '</div>' +
                        '<div class="gm-result-item">' +
                            '<div class="gm-result-value" id="resultNewHours">' + this.fmtNum(totalHours, 0) + '</div>' +
                            '<div class="gm-result-label">New Hours</div>' +
                            '<div class="gm-result-delta" id="resultHoursDelta">--</div>' +
                        '</div>' +
                        '<div class="gm-result-item">' +
                            '<div class="gm-result-value" id="resultNewOverhead">' + this.formatCurrency(totalOverhead) + '</div>' +
                            '<div class="gm-result-label">New Overhead</div>' +
                            '<div class="gm-result-delta" id="resultOverheadDelta">--</div>' +
                        '</div>' +
                        '<div class="gm-result-item">' +
                            '<div class="gm-result-value" id="resultNewAbsorption">' + this.fmtNum(absorptionPct, 1) + '%</div>' +
                            '<div class="gm-result-label">New Absorption</div>' +
                            '<div class="gm-result-delta" id="resultAbsorptionDelta">--</div>' +
                        '</div>' +
                        '<div class="gm-result-item">' +
                            '<div class="gm-result-value" id="resultNewGap">' + this.formatCurrency(theGap) + '</div>' +
                            '<div class="gm-result-label">Remaining Gap</div>' +
                            '<div class="gm-result-delta" id="resultGapDelta">--</div>' +
                        '</div>' +
                    '</div>' +
                    
                    // Gap Closure Progress Bar
                    '<div class="gm-progress-section">' +
                        '<div class="gm-progress-header">' +
                            '<span class="gm-progress-label"><i class="fas fa-bullseye mr-1"></i>Gap Closure Progress</span>' +
                            '<span class="gm-progress-pct" id="closurePct">' + (isUnderAbsorbed ? '0' : '100') + '%</span>' +
                        '</div>' +
                        '<div class="gm-progress-bar">' +
                            '<div class="gm-progress-fill" id="closureFill" style="width: ' + (isUnderAbsorbed ? '0' : '100') + '%; background: ' + (isUnderAbsorbed ? 'linear-gradient(90deg, #ef4444, #f87171)' : '#10b981') + ';"></div>' +
                        '</div>' +
                        '<div class="gm-progress-labels">' +
                            '<span>0% Current</span>' +
                            '<span>50%</span>' +
                            '<span>100% Full Recovery</span>' +
                        '</div>' +
                    '</div>' +
                    
                    // Recovery Timeline (inside results)
                    '<div class="gm-recovery-section" id="recoverySection">' +
                        '<div class="gm-recovery-header">' +
                            '<span class="gm-recovery-title"><i class="fas fa-calendar-alt text-info"></i> Gap Recovery Timeline</span>' +
                            '<div class="gm-recovery-controls">' +
                                '<span class="text-muted small mr-2">Recover over:</span>' +
                                '<div class="gm-recovery-periods">' +
                                    '<button class="gm-recovery-period" data-months="1" onclick="BurdenController.setRecoveryPeriod(1)">1mo</button>' +
                                    '<button class="gm-recovery-period" data-months="2" onclick="BurdenController.setRecoveryPeriod(2)">2mo</button>' +
                                    '<button class="gm-recovery-period" data-months="3" onclick="BurdenController.setRecoveryPeriod(3)">3mo</button>' +
                                    '<button class="gm-recovery-period active" data-months="6" onclick="BurdenController.setRecoveryPeriod(6)">6mo</button>' +
                                    '<button class="gm-recovery-period" data-months="12" onclick="BurdenController.setRecoveryPeriod(12)">12mo</button>' +
                                    '<button class="gm-recovery-period" data-months="fye" onclick="BurdenController.setRecoveryPeriod(\'fye\')">FYE</button>' +
                                '</div>' +
                                '<select class="form-control form-control-sm gm-recovery-method" id="recoveryMethod" onchange="BurdenController.updateRecoveryTimeline()">' +
                                    '<option value="rate">Rate Only</option>' +
                                    '<option value="cost">Cost Cut Only</option>' +
                                    '<option value="balanced" selected>Balanced</option>' +
                                '</select>' +
                            '</div>' +
                        '</div>' +
                        '<div class="gm-recovery-steps" id="recoverySteps"></div>' +
                        '<div class="gm-recovery-summary" id="recoverySummary"></div>' +
                    '</div>' +
                    
                    // Department-Level Adjustments (always visible)
                    '<div class="gm-dept-section" id="deptBreakdownSection">' +
                        '<div class="gm-dept-header"><i class="fas fa-building"></i> Department Distribution Controls</div>' +
                        '<div style="max-height: 300px; overflow-y: auto;">' +
                            '<table class="gm-dept-table">' +
                                '<thead><tr>' +
                                    '<th>Department</th>' +
                                    '<th style="text-align:right">Hours</th>' +
                                    '<th style="text-align:right">Current</th>' +
                                    '<th style="text-align:center">Weight</th>' +
                                    '<th style="text-align:center" title="Maximum new rate for this department">Max Rate</th>' +
                                    '<th style="text-align:center">Lock</th>' +
                                    '<th style="text-align:right">New Rate</th>' +
                                    '<th style="text-align:right">Impact</th>' +
                                '</tr></thead>' +
                                '<tbody>' + deptData.map(function(d) {
                                    return '<tr data-dept="' + d.id + '">' +
                                        '<td class="dept-name" title="' + escapeHtml(d.name) + '">' + escapeHtml(d.name) + '</td>' +
                                        '<td style="text-align:right">' + self.fmtNum(d.hours, 0) + ' <span class="text-muted small">(' + self.fmtNum(d.hoursPct, 0) + '%)</span></td>' +
                                        '<td style="text-align:right">$' + self.fmtNum(d.rate, 2) + '</td>' +
                                        '<td style="text-align:center">' +
                                            '<select class="form-control form-control-sm gm-dept-weight" data-dept="' + d.id + '" onchange="BurdenController.onDeptControlChange()">' +
                                                '<option value="50">50%</option>' +
                                                '<option value="75">75%</option>' +
                                                '<option value="100" selected>100%</option>' +
                                                '<option value="125">125%</option>' +
                                                '<option value="150">150%</option>' +
                                                '<option value="200">200%</option>' +
                                            '</select>' +
                                        '</td>' +
                                        '<td style="text-align:center">' +
                                            '<input type="number" class="form-control form-control-sm gm-dept-cap" data-dept="' + d.id + '" placeholder="--" step="0.5" onchange="BurdenController.onDeptControlChange()" title="Max new rate (leave empty for no cap)">' +
                                        '</td>' +
                                        '<td style="text-align:center">' +
                                            '<input type="checkbox" class="gm-dept-lock" data-dept="' + d.id + '" onchange="BurdenController.onDeptLockChange(this)">' +
                                        '</td>' +
                                        '<td style="text-align:right" class="dept-new-rate" data-dept="' + d.id + '">$' + self.fmtNum(d.rate, 2) + '</td>' +
                                        '<td style="text-align:right" class="dept-gap-impact" data-dept="' + d.id + '">--</td>' +
                                    '</tr>';
                                }).join('') + '</tbody>' +
                            '</table>' +
                        '</div>' +
                    '</div>' +
                '</div>';

            container.innerHTML = html;
            
            // Initialize
            this.initModelerState();
            this.updateRecoveryTimeline();
            this.updateDeptDistribution(0); // Initialize dept distribution
        },
        
        initModelerState: function() {
            var self = this;
            var kpis = this.latestData.kpis || {};
            var allocationBases = this.latestData.allocationBases || {};
            var absorption = this.latestData.absorption || {};
            
            this.modelerState = {
                currentRate: kpis.compositeRate || 0,
                totalHours: (allocationBases.hours && allocationBases.hours.totalBilled) || kpis.billedHours || 1,
                totalOverhead: kpis.totalExpenses || kpis.totalOverhead || 0,
                currentAbsorption: absorption.pct || 100,
                currentVariance: absorption.variance || 0,
                chargedRate: this.modelerData?.chargedRate || kpis.compositeRate || 0
            };
        },
        
        onLeverChange: function() {
            // Read all slider values
            var rateAdj = parseFloat(el('#sliderRate')?.value) || 0;
            var hoursAdj = parseFloat(el('#sliderHours')?.value) || 0;
            var costAdj = parseFloat(el('#sliderCost')?.value) || 0;
            var utilAdj = parseFloat(el('#sliderUtil')?.value) || 0;
            
            // Sync input fields
            if (el('#inputRate')) el('#inputRate').value = rateAdj.toFixed(2);
            if (el('#inputHours')) el('#inputHours').value = Math.round(hoursAdj);
            if (el('#inputCost')) el('#inputCost').value = Math.round(costAdj);
            if (el('#inputUtil')) el('#inputUtil').value = Math.round(utilAdj);
            
            // Calculate and update
            this.calculateLeverImpact(rateAdj, hoursAdj, costAdj, utilAdj);
        },
        
        onLeverInputChange: function(lever) {
            var rateAdj = parseFloat(el('#inputRate')?.value) || 0;
            var hoursAdj = parseFloat(el('#inputHours')?.value) || 0;
            var costAdj = parseFloat(el('#inputCost')?.value) || 0;
            var utilAdj = parseFloat(el('#inputUtil')?.value) || 0;
            
            // Sync sliders
            if (el('#sliderRate')) el('#sliderRate').value = rateAdj;
            if (el('#sliderHours')) el('#sliderHours').value = hoursAdj;
            if (el('#sliderCost')) el('#sliderCost').value = costAdj;
            if (el('#sliderUtil')) el('#sliderUtil').value = utilAdj;
            
            this.calculateLeverImpact(rateAdj, hoursAdj, costAdj, utilAdj);
        },
        
        calculateLeverImpact: function(rateAdj, hoursAdj, costAdj, utilAdj) {
            var self = this;
            var d = this.modelerData;
            if (!d) return;
            
            // Current state
            var baseOverhead = d.totalOverhead;
            var baseHours = d.totalHours;
            var baseRate = d.chargedRate;
            var baseGap = d.theGap;
            
            // Calculate utilization impact (TWO effects)
            // 1. Hours boost from improved utilization
            var utilHoursBoost = (utilAdj / 100) * baseHours;
            
            // 2. Overhead reduction from unbilled-only categories
            var currentUnbilledPct = 100 - d.currentUtilization;
            var unbilledReduction = 0;
            if (currentUnbilledPct > 0 && d.unbilledOnlyOverhead > 0 && utilAdj > 0) {
                // Proportional reduction: if utilization improves by X% points, unbilled overhead decreases
                unbilledReduction = (utilAdj / currentUnbilledPct) * d.unbilledOnlyOverhead;
                unbilledReduction = Math.min(unbilledReduction, d.unbilledOnlyOverhead); // Can't reduce more than exists
            }
            
            // New values (apply both cost reduction AND unbilled reduction)
            var newRate = baseRate + rateAdj;
            var newHours = baseHours + hoursAdj + utilHoursBoost;
            var newOverhead = baseOverhead - costAdj - unbilledReduction;
            
            // New absorption
            var newAbsorbed = newRate * newHours;
            var newGap = newAbsorbed - newOverhead;
            var newAbsorptionPct = newOverhead > 0 ? (newAbsorbed / newOverhead * 100) : 100;
            
            // Gap closure percentage
            var gapClosed = baseGap < 0 ? Math.min(100, Math.max(0, ((newGap - baseGap) / Math.abs(baseGap)) * 100)) : 100;
            
            // Individual lever impacts
            var rateImpact = rateAdj * baseHours;
            var hoursImpact = (hoursAdj + utilHoursBoost) * baseRate;
            var costImpact = costAdj;
            var utilImpact = (utilHoursBoost * baseRate) + unbilledReduction; // Combined impact
            
            // Update lever impact displays
            this.updateLeverImpact('Rate', rateImpact, rateAdj > 0);
            this.updateLeverImpact('Hours', hoursImpact, (hoursAdj + utilHoursBoost) > 0);
            this.updateLeverImpact('Cost', costImpact, costAdj > 0);
            this.updateUtilImpact(utilHoursBoost, unbilledReduction, utilAdj > 0);
            
            // Update result panel
            el('#resultNewRate').textContent = '$' + this.fmtNum(newRate, 2);
            el('#resultRateDelta').innerHTML = rateAdj !== 0 ? '<span class="' + (rateAdj > 0 ? 'text-warning' : 'text-success') + '">+$' + this.fmtNum(rateAdj, 2) + '</span>' : '--';
            
            el('#resultNewHours').textContent = this.fmtNum(newHours, 0);
            el('#resultHoursDelta').innerHTML = (hoursAdj + utilHoursBoost) !== 0 ? '<span class="text-success">+' + this.fmtNum(hoursAdj + utilHoursBoost, 0) + '</span>' : '--';
            
            el('#resultNewOverhead').textContent = this.formatCurrency(newOverhead);
            var totalOverheadReduction = costAdj + unbilledReduction;
            el('#resultOverheadDelta').innerHTML = totalOverheadReduction > 0 ? '<span class="text-success">-' + this.formatCurrency(totalOverheadReduction) + '</span>' : '--';
            
            el('#resultNewAbsorption').textContent = this.fmtNum(newAbsorptionPct, 1) + '%';
            var absChange = newAbsorptionPct - d.absorptionPct;
            el('#resultAbsorptionDelta').innerHTML = Math.abs(absChange) > 0.1 ? '<span class="' + (absChange > 0 ? 'text-success' : 'text-danger') + '">' + (absChange > 0 ? '+' : '') + this.fmtNum(absChange, 1) + '%</span>' : '--';
            
            el('#resultNewGap').textContent = this.formatCurrency(newGap);
            el('#resultNewGap').className = 'gm-result-value ' + (newGap >= 0 ? 'text-success' : '');
            var gapChange = newGap - baseGap;
            el('#resultGapDelta').innerHTML = Math.abs(gapChange) > 1 ? '<span class="' + (gapChange > 0 ? 'text-success' : 'text-danger') + '">' + (gapChange > 0 ? '+' : '') + this.formatCurrency(gapChange) + '</span>' : '--';
            
            // Update closure meter
            el('#closurePct').textContent = this.fmtNum(gapClosed, 0) + '%';
            var closureFill = el('#closureFill');
            if (closureFill) {
                closureFill.style.width = gapClosed + '%';
                if (gapClosed >= 100) {
                    closureFill.style.background = '#10b981';
                    closureFill.textContent = '✓ CLOSED';
                } else if (gapClosed >= 75) {
                    closureFill.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
                    closureFill.textContent = '';
                } else if (gapClosed >= 50) {
                    closureFill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
                    closureFill.textContent = '';
                } else {
                    closureFill.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
                    closureFill.textContent = '';
                }
            }
            
            // Highlight active levers
            document.querySelectorAll('.gm-lever').forEach(function(l) { l.classList.remove('active'); });
            if (rateAdj > 0) el('#leverRate')?.classList.add('active');
            if (hoursAdj > 0) el('#leverHours')?.classList.add('active');
            if (costAdj > 0) el('#leverCost')?.classList.add('active');
            if (utilAdj > 0) el('#leverUtil')?.classList.add('active');
            
            // Update department distribution based on rate adjustment
            this.updateDeptDistribution(rateAdj);
            
            // Update recovery timeline
            this.updateRecoveryTimeline();
        },
        
        updateUtilImpact: function(hoursBoost, overheadReduction, isActive) {
            var impactEl = el('#impactUtil');
            if (!impactEl) return;
            
            if (!isActive || (Math.abs(hoursBoost) < 1 && Math.abs(overheadReduction) < 1)) {
                impactEl.className = 'gm-lever-impact neutral';
                impactEl.textContent = 'No change';
            } else {
                impactEl.className = 'gm-lever-impact positive';
                var parts = [];
                if (hoursBoost > 0) parts.push('+' + this.fmtNum(hoursBoost, 0) + ' hrs');
                if (overheadReduction > 0) parts.push('-' + this.formatCurrency(overheadReduction) + ' OH');
                impactEl.innerHTML = '<i class="fas fa-arrow-up mr-1"></i>' + parts.join(', ');
            }
        },
        
        updateLeverImpact: function(lever, impact, isActive) {
            var impactEl = el('#impact' + lever);
            if (!impactEl) return;
            
            if (Math.abs(impact) < 1) {
                impactEl.className = 'gm-lever-impact neutral';
                impactEl.textContent = 'No change';
            } else {
                impactEl.className = 'gm-lever-impact positive';
                impactEl.innerHTML = '<i class="fas fa-arrow-up mr-1"></i>+' + this.formatCurrency(impact) + ' absorbed';
            }
        },
        
        applyPreset: function(preset) {
            var d = this.modelerData;
            if (!d || d.theGap >= 0) return;
            
            var gap = Math.abs(d.theGap);
            var gapPerHour = gap / d.totalHours;
            var hoursToClose = d.chargedRate > 0 ? gap / d.chargedRate : 0;
            
            // Clear all presets active state
            document.querySelectorAll('.gm-preset').forEach(function(p) { p.classList.remove('active'); });
            
            var rateAdj = 0, hoursAdj = 0, costAdj = 0, utilAdj = 0;
            
            switch(preset) {
                case 'full_rate':
                    rateAdj = gapPerHour;
                    break;
                case 'full_hours':
                    hoursAdj = hoursToClose;
                    break;
                case 'full_cut':
                    costAdj = gap;
                    break;
                case 'balanced':
                    rateAdj = gapPerHour / 3;
                    hoursAdj = hoursToClose / 3;
                    costAdj = gap / 3;
                    break;
                case 'rate_hours':
                    rateAdj = gapPerHour / 2;
                    hoursAdj = hoursToClose / 2;
                    break;
                case 'conservative':
                    rateAdj = gapPerHour * 0.25;
                    hoursAdj = hoursToClose * 0.25;
                    costAdj = gap * 0.25;
                    utilAdj = 5;
                    break;
            }
            
            // Set slider values
            if (el('#sliderRate')) el('#sliderRate').value = rateAdj;
            if (el('#sliderHours')) el('#sliderHours').value = hoursAdj;
            if (el('#sliderCost')) el('#sliderCost').value = costAdj;
            if (el('#sliderUtil')) el('#sliderUtil').value = utilAdj;
            
            // Trigger update
            this.onLeverChange();
            
            // Mark preset active
            var presetEl = document.querySelector('.gm-preset[onclick*="' + preset + '"]');
            if (presetEl) presetEl.classList.add('active');
            
            showToast('Applied ' + preset.replace('_', ' ') + ' scenario', 'success');
        },
        
        resetAllLevers: function() {
            if (el('#sliderRate')) el('#sliderRate').value = 0;
            if (el('#sliderHours')) el('#sliderHours').value = 0;
            if (el('#sliderCost')) el('#sliderCost').value = 0;
            if (el('#sliderUtil')) el('#sliderUtil').value = 0;
            
            document.querySelectorAll('.gm-preset').forEach(function(p) { p.classList.remove('active'); });
            
            this.onLeverChange();
            showToast('All levers reset', 'info');
        },
        
        saveScenario: function() {
            var self = this;
            var rateAdj = parseFloat(el('#inputRate')?.value) || 0;
            var hoursAdj = parseFloat(el('#inputHours')?.value) || 0;
            var costAdj = parseFloat(el('#inputCost')?.value) || 0;
            var utilAdj = parseFloat(el('#inputUtil')?.value) || 0;
            
            if (rateAdj === 0 && hoursAdj === 0 && costAdj === 0 && utilAdj === 0) {
                showToast('Adjust at least one lever before saving', 'warning');
                return;
            }
            
            var name = prompt('Name this scenario:', 'Scenario ' + (this.savedScenarios.length + 1));
            if (!name) return;
            
            var scenario = {
                id: Date.now(),
                name: name,
                rateAdj: rateAdj,
                hoursAdj: hoursAdj,
                costAdj: costAdj,
                utilAdj: utilAdj,
                created: new Date().toISOString()
            };
            
            this.savedScenarios.push(scenario);
            localStorage.setItem('burdenScenarios', JSON.stringify(this.savedScenarios));
            
            this.loadSavedScenarios();
            showToast('Scenario "' + name + '" saved', 'success');
        },
        
        loadSavedScenarios: function() {
            var self = this;
            var container = el('#savedScenarios');
            if (!container) return;
            
            if (!this.savedScenarios || this.savedScenarios.length === 0) {
                container.innerHTML = '';
                return;
            }
            
            container.innerHTML = '<div class="small text-muted mb-2">Saved Scenarios:</div>' +
                this.savedScenarios.map(function(s) {
                    return '<span class="gm-scenario-chip" onclick="BurdenController.loadScenario(' + s.id + ')">' +
                        '<i class="fas fa-bookmark text-primary"></i>' + escapeHtml(s.name) +
                        '<i class="fas fa-times delete" onclick="event.stopPropagation(); BurdenController.deleteScenario(' + s.id + ')"></i>' +
                    '</span>';
                }).join('');
        },
        
        loadScenario: function(id) {
            var scenario = this.savedScenarios.find(function(s) { return s.id === id; });
            if (!scenario) return;
            
            if (el('#sliderRate')) el('#sliderRate').value = scenario.rateAdj;
            if (el('#sliderHours')) el('#sliderHours').value = scenario.hoursAdj;
            if (el('#sliderCost')) el('#sliderCost').value = scenario.costAdj;
            if (el('#sliderUtil')) el('#sliderUtil').value = scenario.utilAdj;
            
            this.onLeverChange();
            showToast('Loaded "' + scenario.name + '"', 'success');
        },
        
        deleteScenario: function(id) {
            this.savedScenarios = this.savedScenarios.filter(function(s) { return s.id !== id; });
            localStorage.setItem('burdenScenarios', JSON.stringify(this.savedScenarios));
            this.loadSavedScenarios();
            showToast('Scenario deleted', 'info');
        },
        
        updateTimeline: function() {
            // Deprecated - use updateRecoveryTimeline
            this.updateRecoveryTimeline();
        },
        
        setRecoveryPeriod: function(months) {
            var d = this.modelerData;
            if (!d) return;
            
            // Handle 'fye' (fiscal year end)
            if (months === 'fye') {
                // Use fiscalCalendar from app infrastructure
                var fyeDate = this.fiscalCalendar?.fiscalYearEndDate;
                if (fyeDate) {
                    var fye = new Date(fyeDate);
                    var now = new Date();
                    // Calculate months until fiscal year end
                    months = (fye.getFullYear() - now.getFullYear()) * 12 + (fye.getMonth() - now.getMonth());
                    if (months <= 0) months = 12; // If past FYE, assume next year
                } else {
                    // Fallback if no fiscalCalendar
                    months = 6;
                }
            }
            
            d.recoveryMonths = months;
            
            // Update active state - only FYE button stays active for FYE selection
            var self = this;
            document.querySelectorAll('.gm-recovery-period').forEach(function(btn) {
                btn.classList.remove('active');
            });
            // Find the right button to activate
            var activeBtn = document.querySelector('.gm-recovery-period[data-months="' + months + '"]');
            if (activeBtn) {
                activeBtn.classList.add('active');
            } else {
                // If FYE resulted in a non-standard month count, keep FYE active
                var fyeBtn = document.querySelector('.gm-recovery-period[data-months="fye"]');
                if (fyeBtn) fyeBtn.classList.add('active');
            }
            
            this.updateRecoveryTimeline();
        },
        
        updateRecoveryTimeline: function() {
            var container = el('#recoverySteps');
            var summaryEl = el('#recoverySummary');
            if (!container) return;
            
            var d = this.modelerData;
            if (!d) return;
            
            var months = d.recoveryMonths || 6;
            var method = el('#recoveryMethod')?.value || 'balanced';
            d.recoveryMethod = method;
            
            var gap = Math.abs(d.theGap);
            
            if (gap < 1 || d.theGap >= 0) {
                container.innerHTML = '<div class="text-center text-muted py-2" style="font-size:0.8rem;"><i class="fas fa-check-circle text-success mr-1"></i>No gap to recover</div>';
                if (summaryEl) summaryEl.innerHTML = '';
                return;
            }
            
            // KEY CONCEPT: Calculate what rate is needed to close the gap in X months
            // If totalHours is annual (12 months), then hours available in X months = totalHours * (X/12)
            // Required rate increase = gap / hoursInPeriod
            // Fewer months = fewer hours to spread recovery = higher rate needed
            
            var monthlyRecoveryNeeded = gap / months;
            var hoursInPeriod = d.totalHours * (months / 12); // Pro-rate hours by recovery period
            var requiredRateIncrease = 0;
            var requiredCostCut = 0;
            
            if (method === 'rate') {
                // All recovery via rate: spread gap over hours in the recovery period
                requiredRateIncrease = gap / hoursInPeriod;
            } else if (method === 'cost') {
                requiredCostCut = monthlyRecoveryNeeded;
            } else { // balanced
                requiredRateIncrease = (gap / 2) / hoursInPeriod;
                requiredCostCut = monthlyRecoveryNeeded / 2;
            }
            
            // The target rate is what we need to charge to close the gap
            var targetRate = d.chargedRate + requiredRateIncrease;
            
            var self = this;
            var now = new Date();
            var steps = [];
            
            // Show cumulative progress month by month
            for (var i = 0; i < Math.min(months, 12); i++) {
                var stepDate = new Date(now);
                stepDate.setMonth(stepDate.getMonth() + i + 1);
                var monthLabel = stepDate.toLocaleDateString('en-US', { month: 'short' });
                
                var cumulativePct = ((i + 1) / months) * 100;
                var cumulativeRecovery = monthlyRecoveryNeeded * (i + 1);
                
                steps.push({
                    month: monthLabel,
                    rate: targetRate, // Same rate throughout - this IS the required rate
                    cumulativePct: Math.min(100, cumulativePct),
                    cumulativeRecovery: cumulativeRecovery,
                    isComplete: i === months - 1
                });
            }
            
            // If more than 12 months, show ellipsis
            if (months > 12) {
                steps.push({ isEllipsis: true, totalMonths: months });
            }
            
            container.innerHTML = steps.map(function(s) {
                if (s.isEllipsis) {
                    return '<div class="gm-recovery-step" style="background: #f8fafc;"><div class="gm-recovery-step-month">...</div><div class="gm-recovery-step-rate" style="font-size:0.6rem;">' + s.totalMonths + ' mo total</div></div>';
                }
                return '<div class="gm-recovery-step ' + (s.isComplete ? 'complete' : '') + '">' +
                    '<div class="gm-recovery-step-month">' + s.month + '</div>' +
                    '<div class="gm-recovery-step-pct ' + (s.isComplete ? 'text-success' : 'text-muted') + '">' + 
                        self.fmtNum(s.cumulativePct, 0) + '%' +
                    '</div>' +
                '</div>';
            }).join('');
            
            // Summary - emphasize what rate is needed
            if (summaryEl) {
                var summaryParts = [];
                summaryParts.push('<span><i class="fas fa-clock text-info"></i> Close in <strong>' + months + '</strong> month' + (months > 1 ? 's' : '') + '</span>');
                if (requiredRateIncrease > 0) {
                    summaryParts.push('<span><i class="fas fa-arrow-up text-warning"></i> Charge <strong>$' + this.fmtNum(targetRate, 2) + '/hr</strong> (+$' + this.fmtNum(requiredRateIncrease, 2) + ')</span>');
                }
                if (requiredCostCut > 0) {
                    summaryParts.push('<span><i class="fas fa-cut text-danger"></i> Cut <strong>' + this.formatCurrency(requiredCostCut) + '</strong>/mo</span>');
                }
                summaryParts.push('<span class="text-muted">= <strong>' + this.formatCurrency(monthlyRecoveryNeeded) + '</strong>/mo recovery</span>');
                summaryEl.innerHTML = summaryParts.join('');
            }
        },
        
        updateDeptDistribution: function(globalRateAdj) {
            var self = this;
            var d = this.modelerData;
            if (!d || !d.deptData) return;
            
            // Read current control values from DOM
            d.deptData.forEach(function(dept) {
                var weightEl = document.querySelector('.gm-dept-weight[data-dept="' + dept.id + '"]');
                var capEl = document.querySelector('.gm-dept-cap[data-dept="' + dept.id + '"]');
                var lockEl = document.querySelector('.gm-dept-lock[data-dept="' + dept.id + '"]');
                
                dept.weight = parseInt(weightEl?.value) || 100;
                // Max Rate = the maximum new rate this dept can have
                var capValue = capEl?.value;
                dept.maxRate = (capValue !== '' && capValue !== null && !isNaN(parseFloat(capValue))) ? parseFloat(capValue) : null;
                dept.locked = lockEl?.checked || false;
            });
            
            // Get active (non-locked) departments
            var activeDepts = d.deptData.filter(function(dept) { return !dept.locked; });
            var totalActiveHours = activeDepts.reduce(function(sum, dept) { return sum + dept.hours; }, 0);
            
            // STEP 1: Calculate the total gap impact we need to achieve
            // This comes from the global rate lever: globalRateAdj * totalHours
            var targetTotalImpact = globalRateAdj * d.totalHours;
            
            // STEP 2: First, apply max rate constraints and calculate forced adjustments
            // If maxRate < currentRate, that dept MUST go down, pushing load to others
            var forcedImpact = 0; // Total $ impact from forced reductions
            activeDepts.forEach(function(dept) {
                dept.forcedAdj = 0;
                if (dept.maxRate !== null && dept.maxRate < dept.rate) {
                    // Max rate is below current - force reduction
                    dept.forcedAdj = dept.maxRate - dept.rate; // negative
                    forcedImpact += dept.forcedAdj * dept.hours; // negative $ amount
                }
            });
            
            // STEP 3: Calculate remaining impact needed from flexible depts
            // targetTotalImpact is what we want overall
            // forcedImpact is what constrained depts are contributing (usually negative if capped down)
            // remainingImpact is what flexible depts need to provide
            var remainingImpact = targetTotalImpact - forcedImpact;
            
            // STEP 4: Find flexible depts (no maxRate OR maxRate > currentRate)
            var flexibleDepts = activeDepts.filter(function(dept) {
                return dept.maxRate === null || dept.maxRate > dept.rate;
            });
            var totalWeightedFlexHours = flexibleDepts.reduce(function(sum, dept) {
                return sum + (dept.hours * dept.weight / 100);
            }, 0);
            
            // STEP 5: Distribute remaining impact to flexible depts based on weight
            flexibleDepts.forEach(function(dept) {
                if (totalWeightedFlexHours > 0) {
                    var share = (dept.hours * dept.weight / 100) / totalWeightedFlexHours;
                    var rawAdj = (remainingImpact * share) / dept.hours;
                    
                    // Check if this would exceed maxRate
                    if (dept.maxRate !== null && dept.rate + rawAdj > dept.maxRate) {
                        dept.adjustment = dept.maxRate - dept.rate;
                    } else {
                        dept.adjustment = rawAdj;
                    }
                } else {
                    dept.adjustment = 0;
                }
            });
            
            // STEP 6: Apply forced adjustments to constrained depts
            activeDepts.forEach(function(dept) {
                if (dept.forcedAdj !== 0) {
                    dept.adjustment = dept.forcedAdj;
                }
            });
            
            // Locked depts get no adjustment
            d.deptData.forEach(function(dept) {
                if (dept.locked) {
                    dept.adjustment = 0;
                }
            });
            
            // Update displays
            d.deptData.forEach(function(dept) {
                var row = document.querySelector('tr[data-dept="' + dept.id + '"]');
                var rateEl = document.querySelector('.dept-new-rate[data-dept="' + dept.id + '"]');
                var impactEl = document.querySelector('.dept-gap-impact[data-dept="' + dept.id + '"]');
                
                if (row) {
                    row.classList.toggle('locked', dept.locked);
                }
                
                var adj = dept.adjustment || 0;
                var newRate = dept.rate + adj;
                var impact = adj * dept.hours;
                
                if (rateEl) rateEl.textContent = '$' + self.fmtNum(newRate, 2);
                if (impactEl) {
                    if (Math.abs(impact) < 1 || dept.locked) {
                        impactEl.innerHTML = '<span class="text-muted">--</span>';
                    } else {
                        impactEl.innerHTML = '<span class="' + (impact > 0 ? 'text-success' : 'text-danger') + '">' + 
                            (impact > 0 ? '+' : '') + self.formatCurrency(impact) + '</span>';
                    }
                }
            });
        },
        
        onDeptControlChange: function() {
            // Re-run distribution with current rate adjustment
            var rateAdj = parseFloat(el('#inputRate')?.value) || 0;
            this.updateDeptDistribution(rateAdj);
        },
        
        onDeptLockChange: function(checkbox) {
            var deptId = checkbox.getAttribute('data-dept');
            var row = document.querySelector('tr[data-dept="' + deptId + '"]');
            if (row) {
                row.classList.toggle('locked', checkbox.checked);
            }
            this.onDeptControlChange();
        },
        
        showDeptBreakdown: function() {
            var section = el('#deptBreakdownSection');
            if (section) {
                section.style.display = 'block';
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        },
        
        hideDeptBreakdown: function() {
            var section = el('#deptBreakdownSection');
            if (section) section.style.display = 'none';
        },
        
        // Legacy function - kept for backwards compatibility but no longer used
        onDeptSliderChange: function(slider) {
            // Deprecated - now using onDeptControlChange
        },
        
        showSensitivityAnalysis: function() {
            var section = el('#sensitivitySection');
            if (section) {
                section.style.display = 'block';
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                this.renderSensitivityChart();
            }
        },
        
        hideSensitivity: function() {
            var section = el('#sensitivitySection');
            if (section) section.style.display = 'none';
        },
        
        renderSensitivityChart: function() {
            var container = el('#sensitivityChart');
            if (!container || !this.modelerData) return;
            
            var d = this.modelerData;
            var baseAbsorption = d.absorptionPct;
            
            // Generate sensitivity data
            var rateChanges = [-5, -2.5, 0, 2.5, 5, 7.5, 10];
            var rateImpact = rateChanges.map(function(r) {
                var newAbsorbed = (d.chargedRate + r) * d.totalHours;
                return d.totalOverhead > 0 ? (newAbsorbed / d.totalOverhead * 100) : 100;
            });
            
            var hoursChanges = [-20, -10, 0, 10, 20, 30, 40];
            var hoursImpact = hoursChanges.map(function(h) {
                var pctChange = h / 100;
                var newHours = d.totalHours * (1 + pctChange);
                var newAbsorbed = d.chargedRate * newHours;
                return d.totalOverhead > 0 ? (newAbsorbed / d.totalOverhead * 100) : 100;
            });
            
            var traces = [
                {
                    x: rateChanges.map(function(r) { return '$' + (r >= 0 ? '+' : '') + r; }),
                    y: rateImpact,
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: 'Rate Change',
                    line: { color: '#dc2626', width: 3 },
                    marker: { size: 8 }
                },
                {
                    x: hoursChanges.map(function(h) { return (h >= 0 ? '+' : '') + h + '%'; }),
                    y: hoursImpact,
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: 'Hours Change',
                    line: { color: '#2563eb', width: 3 },
                    marker: { size: 8 },
                    xaxis: 'x2'
                }
            ];
            
            var layout = {
                height: 180,
                margin: { t: 20, r: 40, b: 40, l: 50 },
                yaxis: { 
                    title: { text: 'Absorption %', font: { size: 10 } },
                    ticksuffix: '%',
                    tickfont: { size: 9 },
                    range: [Math.min(80, baseAbsorption - 10), Math.max(120, baseAbsorption + 30)]
                },
                xaxis: { 
                    title: { text: 'Rate Change', font: { size: 10 } },
                    tickfont: { size: 9 },
                    domain: [0, 0.45]
                },
                xaxis2: { 
                    title: { text: 'Hours Change', font: { size: 10 } },
                    tickfont: { size: 9 },
                    domain: [0.55, 1],
                    anchor: 'y'
                },
                shapes: [{
                    type: 'line',
                    x0: 0, x1: 1, xref: 'paper',
                    y0: 100, y1: 100,
                    line: { color: '#10b981', width: 2, dash: 'dash' }
                }],
                showlegend: true,
                legend: { orientation: 'h', y: 1.15, x: 0.5, xanchor: 'center', font: { size: 10 } },
                paper_bgcolor: 'transparent',
                plot_bgcolor: '#f8fafc'
            };
            
            Plotly.newPlot(container, traces, layout, { responsive: true, displayModeBar: false });
        },
        
        exportScenario: function() {
            var d = this.modelerData;
            var rateAdj = parseFloat(el('#inputRate')?.value) || 0;
            var hoursAdj = parseFloat(el('#inputHours')?.value) || 0;
            var costAdj = parseFloat(el('#inputCost')?.value) || 0;
            var utilAdj = parseFloat(el('#inputUtil')?.value) || 0;
            
            var report = 'BURDEN RATE GAP ANALYSIS\n';
            report += '========================\n\n';
            report += 'Current State:\n';
            report += '  Total Overhead: ' + this.formatCurrency(d.totalOverhead) + '\n';
            report += '  Total Absorbed: ' + this.formatCurrency(d.totalAbsorbed) + '\n';
            report += '  The Gap: ' + this.formatCurrency(d.theGap) + '\n';
            report += '  Absorption: ' + this.fmtNum(d.absorptionPct, 1) + '%\n\n';
            report += 'Proposed Adjustments:\n';
            report += '  Rate Increase: +$' + this.fmtNum(rateAdj, 2) + '/hr\n';
            report += '  Hours Increase: +' + this.fmtNum(hoursAdj, 0) + ' hours\n';
            report += '  Cost Reduction: -' + this.formatCurrency(costAdj) + '\n';
            report += '  Utilization Boost: +' + this.fmtNum(utilAdj, 0) + '% pts\n';
            
            // Create download
            var blob = new Blob([report], { type: 'text/plain' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'gap-analysis-' + new Date().toISOString().split('T')[0] + '.txt';
            a.click();
            
            showToast('Report exported', 'success');
        },
        
        applyToRateBuilder: function() {
            var rateAdj = parseFloat(el('#inputRate')?.value) || 0;
            if (rateAdj <= 0) {
                showToast('Set a rate adjustment first', 'warning');
                return;
            }
            
            // Apply to rate builder
            var currentProfile = this.getActiveProfile();
            if (currentProfile && currentProfile.rateBuilder) {
                currentProfile.rateBuilder.customRate = (this.modelerData.chargedRate + rateAdj).toFixed(2);
                currentProfile.rateBuilder.rateSource = 'custom';
                this.saveActiveProfile(currentProfile);
                showToast('Rate applied to Rate Builder: $' + (this.modelerData.chargedRate + rateAdj).toFixed(2), 'success');
            } else {
                showToast('Configure Rate Builder first', 'warning');
            }
        },

        renderDeptTrendChart: function() {
            var container = el('#deptTrendChart');
            if (!container || !this.latestData) return;
            
            var viewType = el('#trendChartView')?.value || 'composite';
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var trendData = this.latestData.trendData || {};
            var history = this.latestData.history || {};
            
            // Generate sample/historical data if not available
            var labels = history.months || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
            var traces = [];
            var colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
            
            if (viewType === 'composite') {
                // Single line for composite rate trend
                var compositeHistory = history.compositeRate || labels.map(function(_, i) { 
                    return 28 + Math.sin(i * 0.5) * 3 + Math.random() * 2; 
                });
                
                traces.push({
                    x: labels,
                    y: compositeHistory,
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: 'Composite Rate',
                    line: { color: '#3b82f6', width: 3 },
                    marker: { size: 6 },
                    fill: 'tozeroy',
                    fillcolor: 'rgba(59, 130, 246, 0.1)'
                });
            } else if (viewType === 'department') {
                // Line per department
                depts.slice(0, 6).forEach(function(d, i) {
                    var deptTrend = (trendData[d.id] || []).length > 0 ? trendData[d.id] : 
                        labels.map(function() { return 25 + Math.random() * 20; });
                    
                    traces.push({
                        x: labels,
                        y: deptTrend,
                        type: 'scatter',
                        mode: 'lines+markers',
                        name: d.name,
                        line: { color: colors[i % colors.length], width: 2 },
                        marker: { size: 4 }
                    });
                });
            } else if (viewType === 'category') {
                // Line per category
                categories.slice(0, 6).forEach(function(cat, i) {
                    var catTrend = (trendData['cat_' + cat.id] || []).length > 0 ? trendData['cat_' + cat.id] : 
                        labels.map(function() { return 5 + Math.random() * 15; });
                    
                    traces.push({
                        x: labels,
                        y: catTrend,
                        type: 'scatter',
                        mode: 'lines+markers',
                        name: cat.label,
                        line: { color: cat.color || colors[i % colors.length], width: 2 },
                        marker: { size: 4 }
                    });
                });
            }
            
            if (traces.length === 0) {
                container.innerHTML = '<div class="text-center text-muted py-4 small">No trend data</div>';
                return;
            }
            
            var layout = {
                height: 140,
                margin: { t: 5, r: 10, b: 30, l: 45 },
                xaxis: { 
                    tickfont: { size: 9 },
                    gridcolor: '#f3f4f6'
                },
                yaxis: { 
                    tickformat: '$,.0f',
                    tickfont: { size: 9 },
                    gridcolor: '#f3f4f6'
                },
                legend: {
                    orientation: 'h',
                    y: -0.3,
                    x: 0.5,
                    xanchor: 'center',
                    font: { size: 8 }
                },
                showlegend: viewType !== 'composite',
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                hovermode: 'x unified'
            };
            
            Plotly.newPlot(container, traces, layout, { responsive: true, displayModeBar: false });
        },

        renderDeptSparklines: function() {
            var self = this;
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var trendData = this.latestData.trendData || {};
            
            // Find all sparkline cells in the dept table
            document.querySelectorAll('[data-dept-sparkline]').forEach(function(cell) {
                var deptId = cell.getAttribute('data-dept-sparkline');
                var deptTrend = trendData[deptId] || [];
                
                // Generate sample data if not available
                if (deptTrend.length < 2) {
                    deptTrend = [25, 27, 26, 29, 28, 30].map(function(v) { return v + Math.random() * 5; });
                }
                
                // Use global Sparkline if available
                if (window.Sparkline) {
                    cell.innerHTML = Sparkline.generate(deptTrend, {
                        width: 60,
                        height: 20,
                        stroke: 'auto',
                        showDot: true
                    });
                } else {
                    // Fallback: simple text indicator
                    var trend = deptTrend[deptTrend.length - 1] - deptTrend[0];
                    var icon = trend > 0 ? 'fa-arrow-up text-success' : trend < 0 ? 'fa-arrow-down text-danger' : 'fa-minus text-muted';
                    cell.innerHTML = '<i class="fas ' + icon + '"></i>';
                }
            });
        },

        calculateBalanceRate: function() {
            var self = this;
            var absorption = this.latestData.absorption || {};
            var hours = this.latestData.kpis?.totalHours || 1;
            var actualExpense = absorption.actual || 0;
            
            // Rate needed to balance = actual expense / hours
            var balanceRate = actualExpense / hours;
            var currentRate = this.latestData.kpis?.compositeRate || 0;
            var diff = balanceRate - currentRate;
            
            el('#balanceRateResult').innerHTML = '<div class="alert alert-' + (Math.abs(diff) < 1 ? 'success' : 'info') + '">' +
                '<div class="small text-muted mb-1">Rate needed for $0 variance:</div>' +
                '<div class="h5 mb-1">$' + self.fmtNum(balanceRate, 2) + '/hr</div>' +
                '<div class="small">' + (diff >= 0 ? 'Increase' : 'Decrease') + ' by $' + self.fmtNum(Math.abs(diff), 2) + '/hr (' + self.fmtNum(Math.abs(diff / currentRate * 100), 1) + '%)</div>' +
            '</div>';
        },

        modelRateChange: function() {
            var self = this;
            var targetRate = parseFloat(el('#modelTargetRate').value) || 0;
            var currentRate = this.latestData.kpis?.compositeRate || 0;
            var hours = this.latestData.kpis?.totalHours || 1;
            var actualExpense = this.latestData.absorption?.actual || 0;
            
            var projectedApplied = targetRate * hours;
            var projectedVariance = projectedApplied - actualExpense;
            var rateChange = targetRate - currentRate;
            var pctChange = (rateChange / currentRate) * 100;
            
            el('#rateChangeResult').innerHTML = '<div class="alert alert-info">' +
                '<div class="row text-center">' +
                    '<div class="col-6 border-right">' +
                        '<div class="small text-muted">Rate Change</div>' +
                        '<div class="font-weight-bold ' + (rateChange >= 0 ? 'text-danger' : 'text-success') + '">' +
                            (rateChange >= 0 ? '+' : '') + '$' + self.fmtNum(rateChange, 2) + '/hr' +
                        '</div>' +
                        '<div class="small">(' + (pctChange >= 0 ? '+' : '') + self.fmtNum(pctChange, 1) + '%)</div>' +
                    '</div>' +
                    '<div class="col-6">' +
                        '<div class="small text-muted">New Variance</div>' +
                        '<div class="font-weight-bold ' + (projectedVariance >= 0 ? 'text-success' : 'text-danger') + '">' +
                            self.formatCurrency(projectedVariance) +
                        '</div>' +
                        '<div class="small">' + (projectedVariance >= 0 ? 'Over-absorbed' : 'Under-absorbed') + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        },

        onDeptRateChange: function(deptId) {
            // When a department target rate changes, calculate impact
            this.recalculateDeptAbsorption();
        },
        
        resetDeptRates: function() {
            var self = this;
            var currentRate = this.latestData.kpis?.compositeRate || 0;
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            
            depts.forEach(function(d) {
                var input = document.querySelector('.dept-target-input[data-dept="' + d.id + '"]');
                if (!input) input = document.querySelector('.dept-target-rate[data-dept="' + d.id + '"]');
                if (input) {
                    var deptRate = (self.latestData.summary?.compositeByDept && self.latestData.summary.compositeByDept[d.id]) || currentRate;
                    input.value = self.fmtNum(deptRate, 2);
                }
            });
            
            this.recalculateDeptAbsorption();
            showToast('Rates reset to current values', 'info');
        },

        recalculateDeptAbsorption: function() {
            var self = this;
            var allocationBases = this.latestData.allocationBases || {};
            var currentRate = this.latestData.kpis?.compositeRate || 0;
            var actualExpense = this.latestData.absorption?.actual || 0;
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            
            var totalWeightedRate = 0;
            var totalHours = 0;
            var totalImpact = 0;
            
            depts.forEach(function(d) {
                var input = document.querySelector('.dept-target-input[data-dept="' + d.id + '"]');
                if (!input) input = document.querySelector('.dept-target-rate[data-dept="' + d.id + '"]');
                var impactCell = document.querySelector('.dept-impact[data-dept="' + d.id + '"]');
                
                if (input && impactCell) {
                    var targetRate = parseFloat(input.value) || 0;
                    var deptHours = (allocationBases.hours && allocationBases.hours.byDept && allocationBases.hours.byDept[d.id]) || 0;
                    var currentDeptRate = (self.latestData.summary?.compositeByDept && self.latestData.summary.compositeByDept[d.id]) || currentRate;
                    
                    var impact = (targetRate - currentDeptRate) * deptHours;
                    totalImpact += impact;
                    totalWeightedRate += targetRate * deptHours;
                    totalHours += deptHours;
                    
                    impactCell.innerHTML = '<span class="' + (impact >= 0 ? 'text-success' : 'text-danger') + '">' +
                        (impact >= 0 ? '+' : '') + self.formatCurrency(impact) + '</span>';
                }
            });
            
            // Update totals
            var weightedAvg = totalHours > 0 ? totalWeightedRate / totalHours : 0;
            var weightedRateEl = el('#weightedTargetRate');
            if (weightedRateEl) {
                weightedRateEl.innerHTML = '<strong>$' + self.fmtNum(weightedAvg, 2) + '</strong>';
            }
            
            var totalImpactEl = el('#totalImpact');
            if (totalImpactEl) {
                totalImpactEl.innerHTML = '<strong class="' + (totalImpact >= 0 ? 'text-success' : 'text-danger') + '">' +
                    (totalImpact >= 0 ? '+' : '') + self.formatCurrency(totalImpact) + '</strong>';
            }
        },

        calculateAbsorptionBalance: function() {
            var self = this;
            var lockedDeptId = el('#lockedDeptSelect')?.value;
            var targetAbsorptionPct = parseFloat(el('#targetAbsorptionPct')?.value) || 100;
            var resultContainer = el('#absorptionBalanceResult');
            
            if (!lockedDeptId) {
                resultContainer.innerHTML = '<div class="alert alert-warning small py-2">Select a department to lock.</div>';
                return;
            }
            
            var allocationBases = this.latestData.allocationBases || {};
            var currentRate = this.latestData.kpis?.compositeRate || 0;
            var actualExpense = this.latestData.absorption?.actual || 0;
            var targetApplied = actualExpense * (targetAbsorptionPct / 100);
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            
            // Get locked department's current rate and hours
            var lockedInput = document.querySelector('.dept-target-input[data-dept="' + lockedDeptId + '"]');
            if (!lockedInput) lockedInput = document.querySelector('.dept-target-rate[data-dept="' + lockedDeptId + '"]');
            var lockedRate = parseFloat(lockedInput?.value) || currentRate;
            var lockedHours = (allocationBases.hours && allocationBases.hours.byDept && allocationBases.hours.byDept[lockedDeptId]) || 0;
            var lockedApplied = lockedRate * lockedHours;
            
            // Calculate remaining needed from other departments
            var remainingNeeded = targetApplied - lockedApplied;
            var otherHours = 0;
            
            depts.forEach(function(d) {
                if (d.id != lockedDeptId) {
                    otherHours += (allocationBases.hours && allocationBases.hours.byDept && allocationBases.hours.byDept[d.id]) || 0;
                }
            });
            
            var requiredOtherRate = otherHours > 0 ? remainingNeeded / otherHours : 0;
            var rateIncrease = requiredOtherRate - currentRate;
            var pctIncrease = currentRate > 0 ? (rateIncrease / currentRate * 100) : 0;
            
            var lockedDeptName = depts.find(function(d) { return d.id == lockedDeptId; })?.name || 'Selected';
            
            resultContainer.innerHTML = '<div class="alert ' + (rateIncrease > 0 ? 'alert-warning' : 'alert-success') + '">' +
                '<h6 class="alert-heading mb-2">Results</h6>' +
                '<p class="small mb-2"><strong>' + escapeHtml(lockedDeptName) + '</strong> locked at $' + self.fmtNum(lockedRate, 2) + '/hr</p>' +
                '<p class="small mb-2">To reach <strong>' + targetAbsorptionPct + '% absorption</strong>, other departments need:</p>' +
                '<div class="text-center">' +
                    '<div class="h4 mb-0">$' + self.fmtNum(requiredOtherRate, 2) + '/hr</div>' +
                    '<div class="small text-muted">' +
                        (rateIncrease >= 0 ? '+' : '') + '$' + self.fmtNum(rateIncrease, 2) + ' (' +
                        (pctIncrease >= 0 ? '+' : '') + self.fmtNum(pctIncrease, 1) + '%)' +
                    '</div>' +
                '</div>' +
            '</div>';
        },

        renderSellingTab: function() {
            var container = el('#burdenSellingContent');
            if (!container) return;
            
            // Show skeleton while loading
            if (this.isLoading || !this.latestData) {
                container.innerHTML = '<div class="p-3">' +
                    '<div class="row mb-3 gutters-sm">' +
                        '<div class="col"><div class="chart-skeleton skeleton-loading" style="height: 90px; border-radius: 12px;"></div></div>'.repeat(4) +
                    '</div>' +
                    '<div class="chart-skeleton skeleton-loading" style="height: 400px; border-radius: 12px;"></div>' +
                '</div>';
                return;
            }

            var self = this;
            var currentRate = (this.latestData.kpis && this.latestData.kpis.compositeRate) || 0;
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var summary = this.latestData.summary || {};
            var totals = summary.totals || {};
            var burdenByDept = totals.burden || {};
            
            // Calculate initial values for display
            var baseLaborRate = 0; // Will be populated from employees or manual
            var baseMargin = 25;

            if (!this.savedRateBuilds) this.savedRateBuilds = [];

            container.innerHTML = 
                // ═══════════════════════════════════════════════════════════════════
                // STYLES
                // ═══════════════════════════════════════════════════════════════════
                '<style>' +
                    // Rate Builder Card
                    '.srb-card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; overflow: hidden; }' +
                    '.srb-card-header { padding: 10px 16px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; }' +
                    '.srb-card-title { font-weight: 600; font-size: 0.85rem; color: #1e293b; display: flex; align-items: center; gap: 8px; }' +
                    '.srb-card-title i { width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; }' +
                    
                    // Rate Components
                    '.srb-components { padding: 0; }' +
                    '.srb-component { display: flex; align-items: center; padding: 10px 16px; border-bottom: 1px solid #f1f5f9; transition: background 0.15s; }' +
                    '.srb-component:hover { background: #fafbfc; }' +
                    '.srb-component:last-child { border-bottom: none; }' +
                    '.srb-component-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0; }' +
                    '.srb-component-info { flex: 1; padding: 0 12px; }' +
                    '.srb-component-name { font-weight: 500; font-size: 0.8rem; color: #1e293b; }' +
                    '.srb-component-desc { font-size: 0.7rem; color: #64748b; }' +
                    '.srb-component-value { font-weight: 600; font-size: 0.95rem; color: #1e293b; text-align: right; min-width: 90px; }' +
                    '.srb-component-value small { font-weight: 400; color: #94a3b8; }' +
                    
                    // Expandable sections
                    '.srb-expand-trigger { cursor: pointer; user-select: none; }' +
                    '.srb-expand-trigger:hover { background: #f8fafc; }' +
                    '.srb-expand-content { display: none; padding: 8px 16px 10px 60px; background: #f8fafc; border-bottom: 1px solid #f1f5f9; }' +
                    '.srb-expand-content.show { display: block; }' +
                    
                    // Filter Pills
                    '.srb-filter-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }' +
                    '.srb-filter { display: flex; align-items: center; gap: 4px; padding: 4px 10px; background: white; border: 1px solid #e2e8f0; border-radius: 16px; font-size: 0.7rem; }' +
                    '.srb-filter select { border: none; background: transparent; font-size: 0.7rem; color: #475569; padding: 0; cursor: pointer; outline: none; max-width: 100px; }' +
                    '.srb-filter-badge { background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 8px; font-size: 0.65rem; font-weight: 500; }' +
                    
                    // Additional Costs
                    '.srb-costs-container { padding: 0; }' +
                    '.srb-cost-row { display: flex; align-items: center; padding: 6px 16px 6px 60px; border-bottom: 1px solid #f1f5f9; gap: 8px; background: #fafbfc; }' +
                    '.srb-cost-row:last-child { border-bottom: none; }' +
                    '.srb-cost-input { border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 8px; font-size: 0.75rem; }' +
                    '.srb-cost-name { width: 90px; }' +
                    '.srb-cost-type { width: 95px; }' +
                    '.srb-cost-val { width: 55px; text-align: right; }' +
                    '.srb-cost-result { flex: 1; text-align: right; font-weight: 500; color: #475569; font-size: 0.8rem; }' +
                    '.srb-cost-delete { width: 24px; height: 24px; border: none; background: #fef2f2; color: #dc2626; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: opacity 0.15s; font-size: 0.7rem; }' +
                    '.srb-cost-delete:hover { opacity: 1; }' +
                    '.srb-add-cost { display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px; color: #3b82f6; font-size: 0.75rem; cursor: pointer; border-top: 1px dashed #e2e8f0; transition: background 0.15s; }' +
                    '.srb-add-cost:hover { background: #f0f9ff; }' +
                    
                    // Totals Section
                    '.srb-totals { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 12px 16px; border-top: 2px solid #e2e8f0; }' +
                    '.srb-total-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }' +
                    '.srb-total-row.subtotal { border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 4px; }' +
                    '.srb-total-label { font-size: 0.75rem; color: #64748b; }' +
                    '.srb-total-value { font-weight: 600; font-size: 0.8rem; color: #1e293b; }' +
                    
                    // Final Rate Display
                    '.srb-final-rate { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 14px 16px; color: white; display: flex; align-items: center; justify-content: space-between; }' +
                    '.srb-final-label { font-size: 0.75rem; opacity: 0.9; }' +
                    '.srb-final-value { font-size: 1.5rem; font-weight: 700; }' +
                    '.srb-final-sub { font-size: 0.7rem; opacity: 0.75; margin-top: 2px; }' +
                    
                    // Margin Control
                    '.srb-margin-control { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #fefce8; border-top: 1px solid #fef08a; border-bottom: 1px solid #fef08a; }' +
                    '.srb-margin-icon { width: 32px; height: 32px; border-radius: 8px; background: #fef08a; color: #a16207; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; }' +
                    '.srb-margin-slider-container { flex: 1; }' +
                    '.srb-margin-slider { width: 100%; height: 5px; border-radius: 3px; background: #fde68a; appearance: none; cursor: pointer; }' +
                    '.srb-margin-slider::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #f59e0b; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); cursor: pointer; }' +
                    '.srb-margin-value { font-size: 1.1rem; font-weight: 700; color: #92400e; min-width: 50px; text-align: right; }' +
                    
                    // Rate Visualization
                    '.srb-rate-visual { padding: 12px 16px; background: #fafbfc; }' +
                    '.srb-rate-bar-container { height: 24px; background: #e2e8f0; border-radius: 6px; overflow: hidden; display: flex; position: relative; }' +
                    '.srb-rate-bar { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; font-weight: 500; color: white; transition: width 0.3s; white-space: nowrap; overflow: hidden; }' +
                    '.srb-rate-bar.labor { background: #3b82f6; }' +
                    '.srb-rate-bar.burden { background: #8b5cf6; }' +
                    '.srb-rate-bar.additional { background: #ec4899; }' +
                    '.srb-rate-bar.profit { background: #10b981; }' +
                    '.srb-rate-legend { display: flex; justify-content: center; gap: 14px; margin-top: 8px; }' +
                    '.srb-legend-item { display: flex; align-items: center; gap: 4px; font-size: 0.65rem; color: #64748b; }' +
                    '.srb-legend-dot { width: 8px; height: 8px; border-radius: 2px; }' +
                    
                    // Premium Rates
                    '.srb-premium { border-top: 1px solid #e2e8f0; }' +
                    '.srb-premium-header { padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; background: #fafbfc; font-size: 0.75rem; }' +
                    '.srb-premium-header:hover { background: #f1f5f9; }' +
                    '.srb-premium-content { display: none; padding: 10px 16px; background: #fafbfc; }' +
                    '.srb-premium-content.show { display: block; }' +
                    '.srb-premium-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }' +
                    '.srb-premium-item { display: flex; flex-direction: column; gap: 4px; }' +
                    '.srb-premium-item label { display: flex; align-items: center; gap: 6px; font-size: 0.7rem; color: #475569; }' +
                    '.srb-premium-inputs { display: flex; gap: 6px; align-items: center; font-size: 0.75rem; }' +
                    '.srb-premium-mult { width: 50px; text-align: center; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px; font-size: 0.75rem; }' +
                    '.srb-premium-result { flex: 1; padding: 4px 8px; background: white; border: 1px solid #e2e8f0; border-radius: 4px; font-weight: 500; text-align: right; font-size: 0.75rem; }' +
                    
                    // Comparison Cards
                    '.srb-comparison-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; padding: 12px; }' +
                    '.srb-comparison-card { background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; position: relative; transition: all 0.15s; }' +
                    '.srb-comparison-card:hover { border-color: #3b82f6; box-shadow: 0 4px 12px rgba(59,130,246,0.15); }' +
                    '.srb-comparison-card.current { border-color: #3b82f6; background: #f0f9ff; }' +
                    '.srb-comparison-name { font-weight: 500; font-size: 0.75rem; color: #1e293b; margin-bottom: 4px; }' +
                    '.srb-comparison-rate { font-size: 1.25rem; font-weight: 700; color: #3b82f6; }' +
                    '.srb-comparison-details { margin-top: 6px; font-size: 0.65rem; color: #64748b; }' +
                    '.srb-comparison-delete { position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; border: none; background: transparent; color: #94a3b8; cursor: pointer; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; }' +
                    '.srb-comparison-delete:hover { background: #fef2f2; color: #dc2626; }' +
                    
                    // Right Panel
                    '.srb-explorer { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; overflow: hidden; }' +
                    '.srb-explorer-header { padding: 10px 16px; border-bottom: 1px solid #f1f5f9; }' +
                    '.srb-explorer-body { padding: 14px; }' +
                    '.srb-explorer-slider { width: 100%; margin: 10px 0; }' +
                    '.srb-explorer-results { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }' +
                    '.srb-explorer-stat { background: #f8fafc; border-radius: 8px; padding: 10px; text-align: center; }' +
                    '.srb-explorer-stat-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 2px; }' +
                    '.srb-explorer-stat-value { font-size: 1rem; font-weight: 700; color: #1e293b; }' +
                    '.srb-explorer-presets { display: flex; justify-content: center; gap: 4px; margin-top: 12px; }' +
                    '.srb-explorer-preset { padding: 4px 10px; border: 1px solid #e2e8f0; background: white; border-radius: 14px; font-size: 0.7rem; font-weight: 500; color: #475569; cursor: pointer; transition: all 0.15s; }' +
                    '.srb-explorer-preset:hover { border-color: #3b82f6; color: #3b82f6; }' +
                    '.srb-explorer-preset.active { background: #3b82f6; border-color: #3b82f6; color: white; }' +
                    
                    // Chart Container
                    '.srb-chart-container { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; overflow: hidden; margin-top: 12px; }' +
                '</style>' +
                
                // ═══════════════════════════════════════════════════════════════════
                // SECTION 1: KPI CARDS
                // ═══════════════════════════════════════════════════════════════════
                '<div class="row mb-3 gutters-sm cf-kpi-row">' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-blue-soft"><i class="fas fa-tag text-blue"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Selling Rate</span>' +
                                '<span class="kpi-value" id="kpiSellingRate">$0.00<small>/hr</small></span>' +
                                '<span class="kpi-sub" id="kpiSellingMult">1.00× cost</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-purple-soft"><i class="fas fa-layer-group text-purple"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Total Cost</span>' +
                                '<span class="kpi-value" id="kpiTotalCost">$0.00<small>/hr</small></span>' +
                                '<span class="kpi-sub" id="kpiCostBreakdown">Labor + Burden + G&A</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card" style="border-color: #a7f3d0; background: #ecfdf5;">' +
                            '<div class="icon-wrapper" style="background: #dcfce7;"><i class="fas fa-dollar-sign text-success"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Profit / Hour</span>' +
                                '<span class="kpi-value text-success" id="kpiProfitHr">$0.00</span>' +
                                '<span class="kpi-sub" id="kpiProfitPer1k">$0 per 1K hours</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card" style="border-color: #fde68a; background: #fefce8;">' +
                            '<div class="icon-wrapper" style="background: #fef08a;"><i class="fas fa-percentage text-warning"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Gross Margin</span>' +
                                '<span class="kpi-value" style="color: #92400e;" id="kpiMargin">0%</span>' +
                                '<span class="kpi-sub" id="kpiMarkup">0% markup</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                // ═══════════════════════════════════════════════════════════════════
                // SECTION 2: MAIN CONTENT
                // ═══════════════════════════════════════════════════════════════════
                '<div class="row" style="display: flex; flex-wrap: wrap;">' +
                    // LEFT: Rate Builder
                    '<div class="col-lg-7" style="display: flex; flex-direction: column;">' +
                        '<div class="srb-card" style="flex: 1; display: flex; flex-direction: column;">' +
                            // Header
                            '<div class="srb-card-header">' +
                                '<div class="srb-card-title">' +
                                    '<i style="background: #dbeafe; color: #2563eb;"><span class="fas fa-calculator"></span></i>' +
                                    'Selling Rate Builder' +
                                '</div>' +
                                '<button class="btn btn-sm btn-outline-secondary" onclick="BurdenController.clearRateBuilder()" title="Reset to defaults"><i class="fas fa-undo"></i></button>' +
                            '</div>' +
                            
                            // Rate Components
                            '<div class="srb-components">' +
                                // Direct Labor
                                '<div class="srb-component srb-expand-trigger" onclick="BurdenController.toggleLaborExpand()">' +
                                    '<div class="srb-component-icon" style="background: #dbeafe; color: #2563eb;"><i class="fas fa-user"></i></div>' +
                                    '<div class="srb-component-info">' +
                                        '<div class="srb-component-name">Direct Labor <i class="fas fa-chevron-down text-muted ml-2" style="font-size: 0.7rem;" id="laborExpandIcon"></i></div>' +
                                        '<div class="srb-component-desc" id="laborSourceDesc">Calculating from employees...</div>' +
                                    '</div>' +
                                    '<div class="srb-component-value">' +
                                        '<span id="laborRateDisplay">$0.00</span><small>/hr</small>' +
                                    '</div>' +
                                '</div>' +
                                // Labor Filters (expandable)
                                '<div class="srb-expand-content" id="laborExpandContent">' +
                                    '<div class="srb-filter-row">' +
                                        '<div class="srb-filter">' +
                                            '<i class="fas fa-database text-muted"></i>' +
                                            '<select id="laborSourceType" onchange="BurdenController.toggleLaborSource()">' +
                                                '<option value="employee">From Employees</option>' +
                                                '<option value="manual">Manual Entry</option>' +
                                            '</select>' +
                                        '</div>' +
                                        '<div class="srb-filter" id="laborDeptFilterWrap">' +
                                            '<i class="fas fa-building text-muted"></i>' +
                                            '<select id="laborDeptFilter" onchange="BurdenController.loadLaborRates()">' +
                                                '<option value="">All Depts</option>' +
                                                depts.map(function(d) { return '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>'; }).join('') +
                                            '</select>' +
                                        '</div>' +
                                        '<div class="srb-filter" id="laborTitleFilterWrap">' +
                                            '<i class="fas fa-id-badge text-muted"></i>' +
                                            '<select id="laborTitleFilter" onchange="BurdenController.loadLaborRates()">' +
                                                '<option value="">All Titles</option>' +
                                            '</select>' +
                                        '</div>' +
                                        '<div class="srb-filter" id="laborServiceFilterWrap">' +
                                            '<i class="fas fa-briefcase text-muted"></i>' +
                                            '<select id="laborServiceFilter" onchange="BurdenController.loadLaborRates()">' +
                                                '<option value="">All Services</option>' +
                                            '</select>' +
                                        '</div>' +
                                        '<div class="srb-filter" id="laborAggFilterWrap">' +
                                            '<i class="fas fa-calculator text-muted"></i>' +
                                            '<select id="laborAggregation" onchange="BurdenController.loadLaborRates()">' +
                                                '<option value="average">Average</option>' +
                                                '<option value="median">Median</option>' +
                                                '<option value="weighted">Weighted</option>' +
                                            '</select>' +
                                        '</div>' +
                                        '<div class="srb-filter-badge" id="laborEmpBadge">-- employees</div>' +
                                    '</div>' +
                                    '<div class="mt-3" id="laborManualInput" style="display: none;">' +
                                        '<div class="d-flex align-items-center gap-2">' +
                                            '<span class="text-muted small">Enter rate:</span>' +
                                            '<div class="input-group input-group-sm" style="width: 140px;">' +
                                                '<div class="input-group-prepend"><span class="input-group-text">$</span></div>' +
                                                '<input type="number" class="form-control text-right" id="rbBaseLaborRate" value="0.00" step="0.50" onchange="BurdenController.updateRatePreview()">' +
                                                '<div class="input-group-append"><span class="input-group-text">/hr</span></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                                
                                // Overhead Burden
                                '<div class="srb-component srb-expand-trigger" onclick="BurdenController.toggleBurdenExpand()">' +
                                    '<div class="srb-component-icon" style="background: #f3e8ff; color: #7c3aed;"><i class="fas fa-layer-group"></i></div>' +
                                    '<div class="srb-component-info">' +
                                        '<div class="srb-component-name">Overhead Burden <i class="fas fa-chevron-down text-muted ml-2" style="font-size: 0.7rem;" id="burdenExpandIcon"></i></div>' +
                                        '<div class="srb-component-desc" id="burdenSourceDesc">All Departments</div>' +
                                    '</div>' +
                                    '<div class="srb-component-value">' +
                                        '<span id="burdenRateDisplay">$' + self.fmtNum(currentRate, 2) + '</span><small>/hr</small>' +
                                    '</div>' +
                                '</div>' +
                                // Burden Source (expandable)
                                '<div class="srb-expand-content" id="burdenExpandContent">' +
                                    '<div class="srb-filter-row">' +
                                        '<div class="srb-filter">' +
                                            '<i class="fas fa-building text-muted"></i>' +
                                            '<select id="rbBurdenSource" onchange="BurdenController.updateBurdenFromSource()">' +
                                                '<option value="all" data-rate="' + currentRate.toFixed(2) + '">All Departments ($' + self.fmtNum(currentRate, 2) + ')</option>' +
                                                depts.map(function(d) {
                                                    var deptId = String(d.id);
                                                    var rate = burdenByDept[deptId] || burdenByDept[d.id] || currentRate;
                                                    return '<option value="' + d.id + '" data-rate="' + rate.toFixed(2) + '">' + escapeHtml(d.name) + ' ($' + self.fmtNum(rate, 2) + ')</option>';
                                                }).join('') +
                                                '<option value="manual">Manual Entry</option>' +
                                            '</select>' +
                                        '</div>' +
                                    '</div>' +
                                    '<div class="mt-3" id="burdenManualInput" style="display: none;">' +
                                        '<div class="d-flex align-items-center gap-2">' +
                                            '<span class="text-muted small">Enter rate:</span>' +
                                            '<div class="input-group input-group-sm" style="width: 140px;">' +
                                                '<div class="input-group-prepend"><span class="input-group-text">$</span></div>' +
                                                '<input type="number" class="form-control text-right" id="rbBurdenRate" value="' + currentRate.toFixed(2) + '" step="0.50" onchange="BurdenController.updateRatePreview()">' +
                                                '<div class="input-group-append"><span class="input-group-text">/hr</span></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                                
                                // Additional Costs Header
                                '<div class="srb-component">' +
                                    '<div class="srb-component-icon" style="background: #fce7f3; color: #db2777;"><i class="fas fa-plus-circle"></i></div>' +
                                    '<div class="srb-component-info">' +
                                        '<div class="srb-component-name">Additional Costs</div>' +
                                        '<div class="srb-component-desc">G&A, fees, surcharges</div>' +
                                    '</div>' +
                                    '<div class="srb-component-value" id="additionalCostsTotal">' +
                                        '$0.00<small>/hr</small>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Additional Costs Rows
                            '<div class="srb-costs-container" id="additionalCostsContainer">' +
                                '<div class="srb-cost-row">' +
                                    '<input type="text" class="srb-cost-input srb-cost-name" value="G&A" placeholder="Name">' +
                                    '<select class="srb-cost-input srb-cost-type" onchange="BurdenController.updateRatePreview()">' +
                                        '<option value="percent_labor">% of Labor</option>' +
                                        '<option value="percent_subtotal">% of Subtotal</option>' +
                                        '<option value="flat">$/hr</option>' +
                                    '</select>' +
                                    '<input type="number" class="srb-cost-input srb-cost-val" value="10" step="0.5" onchange="BurdenController.updateRatePreview()">' +
                                    '<div class="srb-cost-result">$0.00/hr</div>' +
                                    '<button class="srb-cost-delete" onclick="this.closest(\'.srb-cost-row\').remove(); BurdenController.updateRatePreview();"><i class="fas fa-times"></i></button>' +
                                '</div>' +
                            '</div>' +
                            '<div class="srb-add-cost" onclick="BurdenController.addCostRow()">' +
                                '<i class="fas fa-plus"></i> Add Cost Component' +
                            '</div>' +
                            
                            // Margin Control
                            '<div class="srb-margin-control">' +
                                '<div class="srb-margin-icon"><i class="fas fa-percentage"></i></div>' +
                                '<div class="srb-component-info" style="padding: 0 16px;">' +
                                    '<div class="srb-component-name">Target Margin</div>' +
                                    '<div class="d-flex align-items-center gap-2">' +
                                        '<select class="srb-cost-input" id="rbMarginType" style="width: 85px;" onchange="BurdenController.updateRatePreview()">' +
                                            '<option value="margin">Margin</option>' +
                                            '<option value="markup">Markup</option>' +
                                        '</select>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="srb-margin-slider-container">' +
                                    '<input type="range" class="srb-margin-slider" id="marginSliderMain" min="0" max="50" value="25" step="1" oninput="BurdenController.onMarginSliderChange(this.value)">' +
                                '</div>' +
                                '<div class="srb-margin-value" id="marginValueDisplay">25%</div>' +
                            '</div>' +
                            
                            // Rate Visualization
                            '<div class="srb-rate-visual">' +
                                '<div class="srb-rate-bar-container" id="rateBarContainer">' +
                                    '<div class="srb-rate-bar labor" id="rateBarLabor" style="width: 40%;">Labor</div>' +
                                    '<div class="srb-rate-bar burden" id="rateBarBurden" style="width: 30%;">Burden</div>' +
                                    '<div class="srb-rate-bar additional" id="rateBarAdditional" style="width: 10%;">+Costs</div>' +
                                    '<div class="srb-rate-bar profit" id="rateBarProfit" style="width: 20%;">Profit</div>' +
                                '</div>' +
                                '<div class="srb-rate-legend">' +
                                    '<div class="srb-legend-item"><div class="srb-legend-dot" style="background: #3b82f6;"></div> Labor</div>' +
                                    '<div class="srb-legend-item"><div class="srb-legend-dot" style="background: #8b5cf6;"></div> Burden</div>' +
                                    '<div class="srb-legend-item"><div class="srb-legend-dot" style="background: #ec4899;"></div> Additional</div>' +
                                    '<div class="srb-legend-item"><div class="srb-legend-dot" style="background: #10b981;"></div> Profit</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Totals
                            '<div class="srb-totals">' +
                                '<div class="srb-total-row">' +
                                    '<span class="srb-total-label">Labor Cost</span>' +
                                    '<span class="srb-total-value" id="totalLaborCost">$0.00/hr</span>' +
                                '</div>' +
                                '<div class="srb-total-row">' +
                                    '<span class="srb-total-label">Burden Cost</span>' +
                                    '<span class="srb-total-value" id="totalBurdenCost">$0.00/hr</span>' +
                                '</div>' +
                                '<div class="srb-total-row">' +
                                    '<span class="srb-total-label">Additional Costs</span>' +
                                    '<span class="srb-total-value" id="totalAdditionalCost">$0.00/hr</span>' +
                                '</div>' +
                                '<div class="srb-total-row subtotal">' +
                                    '<span class="srb-total-label"><strong>Total Cost</strong></span>' +
                                    '<span class="srb-total-value"><strong id="grandTotalCost">$0.00/hr</strong></span>' +
                                '</div>' +
                                '<div class="srb-total-row">' +
                                    '<span class="srb-total-label">Profit / Margin</span>' +
                                    '<span class="srb-total-value text-success" id="totalProfit">+$0.00/hr</span>' +
                                '</div>' +
                            '</div>' +
                            
                            // Final Rate
                            '<div class="srb-final-rate">' +
                                '<div>' +
                                    '<div class="srb-final-label">Selling Rate</div>' +
                                    '<div class="srb-final-sub" id="finalRateSub">Ready to price your services</div>' +
                                '</div>' +
                                '<div class="srb-final-value" id="finalSellingRate">$0.00<small style="font-size: 0.5em; opacity: 0.8;">/hr</small></div>' +
                            '</div>' +
                            
                            // Premium Rates Section
                            '<div class="srb-premium">' +
                                '<div class="srb-premium-header" onclick="BurdenController.togglePremiumRates()">' +
                                    '<span class="text-muted small"><i class="fas fa-clock mr-2"></i>Premium Rates (OT, DT)</span>' +
                                    '<i class="fas fa-chevron-down text-muted" id="premiumToggleIcon"></i>' +
                                '</div>' +
                                '<div class="srb-premium-content" id="premiumRatesContent">' +
                                    '<div class="srb-premium-grid">' +
                                        '<div class="srb-premium-item">' +
                                            '<label><input type="checkbox" id="showOvertimeRate" onchange="BurdenController.updatePremiumRates()"> Overtime Rate</label>' +
                                            '<div class="srb-premium-inputs">' +
                                                '<input type="number" class="srb-premium-mult" id="otMultiplier" value="1.5" step="0.1" min="1" max="3" onchange="BurdenController.updatePremiumRates()">' +
                                                '<span>×</span>' +
                                                '<div class="srb-premium-result" id="otRateDisplay">$0.00/hr</div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="srb-premium-item">' +
                                            '<label><input type="checkbox" id="showDoubletimeRate" onchange="BurdenController.updatePremiumRates()"> Double Time</label>' +
                                            '<div class="srb-premium-inputs">' +
                                                '<input type="number" class="srb-premium-mult" id="dtMultiplier" value="2" step="0.1" min="1" max="3" onchange="BurdenController.updatePremiumRates()">' +
                                                '<span>×</span>' +
                                                '<div class="srb-premium-result" id="dtRateDisplay">$0.00/hr</div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Footer Actions
                            '<div style="padding: 8px 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 6px;">' +
                                '<button class="btn btn-sm btn-outline-primary" onclick="BurdenController.saveRateBuild()" style="font-size: 0.75rem;"><i class="fas fa-bookmark mr-1"></i>Save</button>' +
                                '<button class="btn btn-sm btn-primary" onclick="BurdenController.exportRateBuild()" style="font-size: 0.75rem;"><i class="fas fa-file-export mr-1"></i>Export</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    // RIGHT: Margin Explorer & Chart
                    '<div class="col-lg-5" style="display: flex; flex-direction: column; gap: 12px;">' +
                        // Margin Explorer
                        '<div class="srb-explorer">' +
                            '<div class="srb-explorer-header">' +
                                '<div class="srb-card-title">' +
                                    '<i style="background: #fef3c7; color: #d97706;"><span class="fas fa-sliders-h"></span></i>' +
                                    'Margin Explorer' +
                                '</div>' +
                            '</div>' +
                            '<div class="srb-explorer-body">' +
                                '<div class="text-center">' +
                                    '<div style="font-size: 1.75rem; font-weight: 700; color: #1e293b;" id="explorerMarginValue">25%</div>' +
                                    '<div class="text-muted" style="font-size: 0.7rem;">Target Margin</div>' +
                                '</div>' +
                                '<input type="range" class="custom-range srb-explorer-slider" id="marginSlider" min="0" max="50" value="25" step="1" oninput="BurdenController.updateMarginSlider(this.value)">' +
                                '<div class="srb-explorer-results">' +
                                    '<div class="srb-explorer-stat">' +
                                        '<div class="srb-explorer-stat-label">Selling Rate</div>' +
                                        '<div class="srb-explorer-stat-value text-primary" id="sliderSellingRate">$0.00</div>' +
                                    '</div>' +
                                    '<div class="srb-explorer-stat">' +
                                        '<div class="srb-explorer-stat-label">Profit / Hour</div>' +
                                        '<div class="srb-explorer-stat-value text-success" id="sliderProfitAmount">$0.00</div>' +
                                    '</div>' +
                                    '<div class="srb-explorer-stat">' +
                                        '<div class="srb-explorer-stat-label">Markup %</div>' +
                                        '<div class="srb-explorer-stat-value" id="sliderMarkup">0%</div>' +
                                    '</div>' +
                                    '<div class="srb-explorer-stat">' +
                                        '<div class="srb-explorer-stat-label">Per 1K Hours</div>' +
                                        '<div class="srb-explorer-stat-value" id="sliderPer1000">$0</div>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="srb-explorer-presets">' +
                                    '<button class="srb-explorer-preset" onclick="BurdenController.setMarginSlider(15)">15%</button>' +
                                    '<button class="srb-explorer-preset" onclick="BurdenController.setMarginSlider(20)">20%</button>' +
                                    '<button class="srb-explorer-preset active" onclick="BurdenController.setMarginSlider(25)">25%</button>' +
                                    '<button class="srb-explorer-preset" onclick="BurdenController.setMarginSlider(30)">30%</button>' +
                                    '<button class="srb-explorer-preset" onclick="BurdenController.setMarginSlider(35)">35%</button>' +
                                    '<button class="srb-explorer-preset" onclick="BurdenController.setMarginSlider(40)">40%</button>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        
                        // Cost Breakdown Chart
                        '<div class="srb-chart-container" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">' +
                            '<div class="srb-card-header">' +
                                '<div class="srb-card-title">' +
                                    '<i style="background: #f3e8ff; color: #7c3aed;"><span class="fas fa-chart-pie"></span></i>' +
                                    'Cost Breakdown' +
                                '</div>' +
                            '</div>' +
                            '<div id="rateBreakdownChart" style="flex: 1; min-height: 0;"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                // ═══════════════════════════════════════════════════════════════════
                // SECTION 3: SAVED RATES COMPARISON
                // ═══════════════════════════════════════════════════════════════════
                '<div class="srb-card mt-2">' +
                    '<div class="srb-card-header">' +
                        '<div class="srb-card-title">' +
                            '<i style="background: #fef3c7; color: #d97706;"><span class="fas fa-bookmark"></span></i>' +
                            'Saved Rates' +
                            '<span class="badge badge-secondary ml-2" id="comparisonCount">0</span>' +
                        '</div>' +
                    '</div>' +
                    '<div id="savedComparisonsContainer">' +
                        '<div class="text-center text-muted py-3" style="font-size: 0.8rem;"><i class="fas fa-bookmark mr-2 opacity-50"></i>Save rates to compare scenarios</div>' +
                    '</div>' +
                '</div>';
            
            // Restore saved rate builder configuration FIRST (before other init)
            this.restoreRateBuilderConfig();
            
            this.toggleLaborSource();
            this.updateBurdenFromSource();
            this.updateRatePreview();
            this.renderSavedComparisons();
            this.loadLaborFilters();
            this.loadLaborRates();
        },
        
        toggleLaborExpand: function() {
            var content = el('#laborExpandContent');
            var icon = el('#laborExpandIcon');
            if (content) {
                content.classList.toggle('show');
                if (icon) icon.classList.toggle('fa-chevron-down');
                if (icon) icon.classList.toggle('fa-chevron-up');
            }
        },
        
        toggleBurdenExpand: function() {
            var content = el('#burdenExpandContent');
            var icon = el('#burdenExpandIcon');
            if (content) {
                content.classList.toggle('show');
                if (icon) icon.classList.toggle('fa-chevron-down');
                if (icon) icon.classList.toggle('fa-chevron-up');
            }
        },
        
        onMarginSliderChange: function(value) {
            // Update the margin value in rate builder
            if (el('#marginValueDisplay')) el('#marginValueDisplay').textContent = value + '%';
            if (el('#explorerMarginValue')) el('#explorerMarginValue').textContent = value + '%';
            if (el('#marginSlider')) el('#marginSlider').value = value;
            if (el('#rbMarginValue')) el('#rbMarginValue').value = value;
            
            // Update presets
            document.querySelectorAll('.srb-explorer-preset').forEach(function(btn) {
                btn.classList.remove('active');
                if (btn.textContent.trim() === value + '%') {
                    btn.classList.add('active');
                }
            });
            
            this.updateRatePreview();
        },

        toggleLaborSource: function() {
            var sourceType = el('#laborSourceType')?.value || 'employee';
            var manualInput = el('#laborManualInput');
            var filterWraps = ['#laborDeptFilterWrap', '#laborTitleFilterWrap', '#laborServiceFilterWrap', '#laborAggFilterWrap', '#laborEmpBadge'];
            var laborInput = el('#rbBaseLaborRate');
            var descEl = el('#laborSourceDesc');
            
            if (sourceType === 'manual') {
                // Show manual input, hide filters
                if (manualInput) manualInput.style.display = 'block';
                filterWraps.forEach(function(id) { 
                    var wrap = el(id); 
                    if (wrap) wrap.style.display = 'none'; 
                });
                if (laborInput) laborInput.readOnly = false;
                if (descEl) descEl.textContent = 'Manual entry';
            } else {
                // Hide manual input, show filters
                if (manualInput) manualInput.style.display = 'none';
                filterWraps.forEach(function(id) { 
                    var wrap = el(id); 
                    if (wrap) wrap.style.display = ''; 
                });
                if (laborInput) laborInput.readOnly = true;
                if (descEl) descEl.textContent = 'Calculating from employees...';
                this.loadLaborRates();
            }
        },

        toggleLaborMode: function() {
            // Legacy - now handled by toggleLaborSource
        },

        loadLaborFilters: function() {
            var self = this;
            API.post('burden', { subAction: 'get_labor_filters' }).then(function(res) {
                var data = res.data || res;
                
                var titleSelect = el('#laborTitleFilter');
                if (titleSelect && data.titles) {
                    titleSelect.innerHTML = '<option value="">All Titles</option>' +
                        data.titles.map(function(t) { return '<option value="' + t.id + '">' + escapeHtml(t.name || t.id) + '</option>'; }).join('');
                }
                
                var serviceSelect = el('#laborServiceFilter');
                if (serviceSelect && data.serviceItems) {
                    serviceSelect.innerHTML = '<option value="">All Services</option>' +
                        data.serviceItems.map(function(s) { return '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; }).join('');
                }
                
                // Store in latestData.meta for use in category config
                if (!self.latestData.meta) self.latestData.meta = {};
                if (data.employeeTypes) self.latestData.meta.employeeTypes = data.employeeTypes;
                if (data.serviceItems) self.latestData.meta.serviceItems = data.serviceItems;
            }).catch(function(err) {
                console.error('Error loading labor filters:', err);
            });
        },

        loadEmployeeTypes: function() {
            var self = this;
            // Use get_labor_filters which returns employee types AND service items
            API.post('burden', { subAction: 'get_labor_filters' }).then(function(res) {
                var data = res.data || res;
                var empTypes = data.employeeTypes || [];
                var serviceItems = data.serviceItems || [];
                
                // Store in meta
                if (!self.latestData.meta) self.latestData.meta = {};
                self.latestData.meta.employeeTypes = empTypes;
                self.latestData.meta.serviceItems = serviceItems;
                
                // Get current category's saved filters
                var catId = el('#catId')?.value;
                var categories = (self.latestData.meta && self.latestData.meta.categoryDefinitions) || [];
                var cat = categories.find(function(c) { return c.id === catId; });
                if (!cat) {
                    var summaryCategories = (self.latestData.summary && self.latestData.summary.categories) || [];
                    cat = summaryCategories.find(function(c) { return c.id === catId; });
                }
                
                var timeFilters = (cat && cat.timeFilters) || {};
                var savedExcludeTypes = (timeFilters.excludeEmpTypes || []).map(function(t) { return String(t); });
                var savedServiceItems = (timeFilters.serviceItems || []).map(function(s) { return String(s); });
                
                // Update employee types UI if visible
                var empMultiselect = document.querySelector('.emp-type-multiselect');
                if (empMultiselect && empTypes.length > 0) {
                    empMultiselect.innerHTML = empTypes.map(function(t) {
                        var excluded = savedExcludeTypes.includes(String(t.id));
                        return '<label class="emp-type-option d-flex align-items-center px-2 py-1 border-bottom' + (excluded ? ' bg-danger-soft' : '') + '" style="cursor: pointer; margin: 0;" data-emp-type="' + t.id + '">' +
                            '<input type="checkbox" class="time-exclude-emp mr-2" value="' + t.id + '"' + (excluded ? ' checked' : '') + ' onchange="BurdenController.onEmpTypeExcludeChange(this)" style="margin: 0;">' +
                            '<span class="small">' + escapeHtml(t.name) + '</span>' +
                        '</label>';
                    }).join('');
                    
                    // Update badge count
                    var badge = el('#excludedEmpCount');
                    if (badge) badge.textContent = savedExcludeTypes.length + ' excluded';
                }
                
                // Update service items UI if visible
                var serviceSelect = el('#serviceItemSelect');
                if (serviceSelect && serviceItems.length > 0) {
                    serviceSelect.innerHTML = serviceItems.map(function(s) {
                        var selected = savedServiceItems.includes(String(s.id));
                        return '<label class="service-item-option d-flex align-items-center px-2 py-1 border-bottom' + (selected ? ' bg-primary-soft' : '') + '" style="cursor: pointer; margin: 0;" data-service="' + s.id + '">' +
                            '<input type="checkbox" class="time-service-item mr-2" value="' + s.id + '"' + (selected ? ' checked' : '') + ' onchange="BurdenController.onServiceItemChange(this)" style="margin: 0;">' +
                            '<span class="small">' + escapeHtml(s.name) + '</span>' +
                        '</label>';
                    }).join('');
                    
                    // Update badge count
                    var badge = el('#selectedServiceCount');
                    if (badge) badge.textContent = savedServiceItems.length || 'All';
                }
            }).catch(function(err) {
                console.error('Error loading labor filters:', err);
            });
        },

        toggleTimeCustomRate: function() {
            var method = el('#timeCostMethod')?.value || 'employee_rate';
            var group = el('#timeCustomRateGroup');
            if (group) {
                group.style.display = (method === 'custom_rate') ? '' : 'none';
            }
        },
        
        onEmpTypeExcludeChange: function(checkbox) {
            var label = checkbox.closest('.emp-type-option');
            if (label) {
                label.classList.toggle('bg-danger-soft', checkbox.checked);
            }
            // Update badge count
            var count = document.querySelectorAll('.time-exclude-emp:checked').length;
            var badge = el('#excludedEmpCount');
            if (badge) badge.textContent = count + ' excluded';
            this.updateTimeCategoryPreview();
        },
        
        onServiceItemChange: function(checkbox) {
            var label = checkbox.closest('.service-item-option');
            if (label) {
                label.classList.toggle('bg-primary-soft', checkbox.checked);
            }
            // Update badge count
            var count = document.querySelectorAll('.time-service-item:checked').length;
            var badge = el('#selectedServiceCount');
            if (badge) badge.textContent = count || 'All';
            this.updateTimeCategoryPreview();
        },
        
        onDeptFilterChange: function(checkbox) {
            var label = checkbox.closest('.dept-option');
            if (label) {
                label.classList.toggle('bg-primary-soft', checkbox.checked);
            }
            // Update badge count - show "All" if all are checked or none are checked
            var total = document.querySelectorAll('.time-dept-filter').length;
            var checked = document.querySelectorAll('.time-dept-filter:checked').length;
            var badge = el('#selectedDeptCount');
            if (badge) {
                if (checked === 0 || checked === total) {
                    badge.textContent = 'All';
                } else {
                    badge.textContent = checked + ' selected';
                }
            }
            this.updateTimeCategoryPreview();
        },
        
        onHcExcludeChange: function(checkbox) {
            var label = checkbox.closest('.emp-type-option');
            if (label) {
                label.classList.toggle('bg-danger-soft', checkbox.checked);
            }
            // Update badge count
            var count = document.querySelectorAll('.hc-exclude-type:checked').length;
            var badge = el('#excludedHcCount');
            if (badge) badge.textContent = count + ' excluded';
        },
        
        // Global Exclusion Handlers for Config tab
        onGlobalEmpExcludeChange: function(checkbox) {
            var label = checkbox.closest('label');
            if (label) {
                label.classList.toggle('bg-danger-soft', checkbox.checked);
            }
            // Update badge count
            var count = document.querySelectorAll('.cfg-global-emp-exclude:checked').length;
            var badge = el('#cfgGlobalEmpExcludeCount');
            if (badge) badge.textContent = count + ' excluded';
        },
        
        onGlobalDeptHideChange: function(checkbox) {
            var label = checkbox.closest('label');
            if (label) {
                label.classList.toggle('bg-danger-soft', checkbox.checked);
            }
            // Update badge count
            var count = document.querySelectorAll('.cfg-hidden-dept:checked').length;
            var badge = el('#cfgHiddenDeptCount');
            if (badge) badge.textContent = count + ' hidden';
        },
        
        loadGlobalEmpTypesForConfig: function() {
            var self = this;
            var container = el('#cfgGlobalEmpTypes');
            if (!container) return;
            
            // Get employee types from meta or fetch them
            var empTypes = (this.latestData.meta && this.latestData.meta.employeeTypes) || [];
            var config = (this.latestData.meta && this.latestData.meta.config) || {};
            var globalExcluded = (config.globalExcludeEmpTypes || []).map(function(t) { return String(t); });
            
            if (empTypes.length > 0) {
                container.innerHTML = empTypes.map(function(t) {
                    var excluded = globalExcluded.includes(String(t.id));
                    return '<label class="d-flex align-items-center px-2 py-1 border-bottom' + (excluded ? ' bg-danger-soft' : '') + '" style="cursor: pointer; margin: 0;">' +
                        '<input type="checkbox" class="cfg-global-emp-exclude mr-2" value="' + t.id + '"' + (excluded ? ' checked' : '') + ' onchange="BurdenController.onGlobalEmpExcludeChange(this)" style="margin: 0;">' +
                        '<span class="small">' + escapeHtml(t.name) + '</span>' +
                    '</label>';
                }).join('');
            } else {
                // Fetch employee types
                API.post('burden', { subAction: 'get_labor_filters' }).then(function(res) {
                    var data = res.data || res;
                    var fetchedTypes = data.employeeTypes || [];
                    
                    // Store in meta
                    if (!self.latestData.meta) self.latestData.meta = {};
                    self.latestData.meta.employeeTypes = fetchedTypes;
                    
                    container.innerHTML = fetchedTypes.map(function(t) {
                        var excluded = globalExcluded.includes(String(t.id));
                        return '<label class="d-flex align-items-center px-2 py-1 border-bottom' + (excluded ? ' bg-danger-soft' : '') + '" style="cursor: pointer; margin: 0;">' +
                            '<input type="checkbox" class="cfg-global-emp-exclude mr-2" value="' + t.id + '"' + (excluded ? ' checked' : '') + ' onchange="BurdenController.onGlobalEmpExcludeChange(this)" style="margin: 0;">' +
                            '<span class="small">' + escapeHtml(t.name) + '</span>' +
                        '</label>';
                    }).join('');
                }).catch(function(err) {
                    container.innerHTML = '<div class="p-2 text-danger small">Error loading employee types</div>';
                    console.error('Error loading employee types for config:', err);
                });
            }
        },
        
        updateRevenueCategoryPreview: function() {
            // Revenue category preview - update stats based on current selections
            var source = el('#revSource')?.value || 'all';
            var deptId = el('#revDeptFilter')?.value || '';
            var fixedAmount = parseFloat(el('#revFixedAmount')?.value) || 0;
            
            var revenueData = this.latestData.allocationBases?.revenue || { byDept: {}, total: 0 };
            var total = revenueData.total || 0;
            
            // If department filtered, use that dept's revenue
            if (deptId && revenueData.byDept[deptId]) {
                total = revenueData.byDept[deptId].value || 0;
            }
            
            // Calculate burden and rate
            var burden = fixedAmount || 0; // Would come from allocated expenses
            var rate = total > 0 ? (burden / total * 100) : 0;
            
            var totalEl = el('#revPreviewTotal');
            var burdenEl = el('#revPreviewBurden');
            var rateEl = el('#revPreviewRate');
            
            if (totalEl) totalEl.textContent = this.formatCurrency(total);
            if (burdenEl) burdenEl.textContent = this.formatCurrency(burden);
            if (rateEl) rateEl.textContent = this.fmtNum(rate, 2) + '%';
        },
        
        updateTimeCategoryPreview: function() {
            var self = this;
            var liveTotals = el('#timeLiveTotals');
            if (!liveTotals) return;
            
            // Show loading state
            liveTotals.style.opacity = '0.6';
            
            // Get the category ID we're editing
            var categoryId = el('#catOriginalId')?.value || el('#catId')?.value || '';
            
            // Get saved category config as baseline (prevents race conditions with async UI loading)
            var savedCat = null;
            if (categoryId) {
                var categoryDefs = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
                savedCat = categoryDefs.find(function(c) { return c.id === categoryId; });
            }
            var savedFilters = (savedCat && savedCat.timeFilters) || {};
            
            // Gather current UI filter settings, falling back to saved config if UI not ready
            var filters = {
                // Use UI value if checkbox exists, otherwise use saved config
                includeBillable: el('#timeIncludeBillable') ? el('#timeIncludeBillable').checked : (savedFilters.includeBillable !== false),
                includeNonBillable: el('#timeIncludeNonBillable') ? el('#timeIncludeNonBillable').checked : (savedFilters.includeNonBillable || false),
                billableDefinition: el('#timeBillableDefinition')?.value || savedFilters.billableDefinition || 'customer',
                costMethod: el('#timeCostMethod')?.value || savedFilters.costMethod || 'employee_rate',
                customRate: parseFloat(el('#timeCustomRate')?.value) || savedFilters.customRate || 50
            };
            
            // Collect selected departments (multiselect)
            // If checkboxes exist, read from UI; otherwise use saved config
            var deptCheckboxes = document.querySelectorAll('.time-dept-filter');
            if (deptCheckboxes.length > 0) {
                var departmentIds = [];
                var checkedDepts = document.querySelectorAll('.time-dept-filter:checked');
                // Only set departmentIds if not all are checked (partial selection)
                if (checkedDepts.length > 0 && checkedDepts.length < deptCheckboxes.length) {
                    checkedDepts.forEach(function(cb) {
                        departmentIds.push(cb.value);
                    });
                }
                filters.departmentIds = departmentIds;
            } else {
                // UI not loaded yet, use saved config
                filters.departmentIds = savedFilters.departmentIds || [];
            }
            
            // Employee type exclusions - critical for accurate cost calculation
            var empTypeCheckboxes = document.querySelectorAll('.time-exclude-emp');
            if (empTypeCheckboxes.length > 0) {
                var excludeEmpTypes = [];
                document.querySelectorAll('.time-exclude-emp:checked').forEach(function(cb) {
                    excludeEmpTypes.push(cb.value);
                });
                filters.excludeEmpTypes = excludeEmpTypes;
            } else {
                // UI not loaded yet, use saved config - THIS WAS THE BUG!
                filters.excludeEmpTypes = savedFilters.excludeEmpTypes || [];
            }
            
            // Service items
            var serviceCheckboxes = document.querySelectorAll('.time-service-item');
            if (serviceCheckboxes.length > 0) {
                var serviceItems = [];
                document.querySelectorAll('.time-service-item:checked').forEach(function(cb) {
                    serviceItems.push(cb.value);
                });
                filters.serviceItems = serviceItems;
            } else {
                // UI not loaded yet, use saved config
                filters.serviceItems = savedFilters.serviceItems || [];
            }
            
            var meta = this.latestData.meta || {};
            API.post('burden', { 
                subAction: 'preview_time_category', 
                filters: filters,
                startDate: meta.startDate, 
                endDate: meta.endDate 
            }).then(function(res) {
                var data = res.data || res;
                var totalHours = data.hours || 0;        // Total hours from filtered query
                var billedHours = data.billedHours || 0; // Hours with customer assigned
                var cost = data.cost || 0;
                var avgWage = totalHours > 0 ? cost / totalHours : 0;
                
                // Get allocation base from selector (default to billed_hours)
                var allocationBase = el('#catBase')?.value || 'billed_hours';
                var bases = self.latestData.allocationBases || {};
                var baseLabel = 'per billed hour';
                
                // Use GLOBAL allocation base for rate calculation (matches tabular/matrix)
                // The category cost is spread across ALL company hours, not just this category's hours
                var baseValue;
                var burdenRate;
                
                switch (allocationBase) {
                    case 'billed_hours':
                        baseValue = bases.hours?.totalBilled || 1;
                        baseLabel = 'per billed hour';
                        burdenRate = cost / baseValue;
                        break;
                    case 'total_hours':
                        baseValue = bases.hours?.total || 1;
                        baseLabel = 'per total hour';
                        burdenRate = cost / baseValue;
                        break;
                    case 'labor_dollars':
                        baseValue = bases.laborDollars?.total || 1;
                        baseLabel = '% of labor';
                        burdenRate = cost / baseValue;
                        break;
                    case 'headcount':
                        baseValue = bases.headcount?.total || 1;
                        baseLabel = 'per employee';
                        burdenRate = cost / baseValue;
                        break;
                    case 'revenue':
                        baseValue = bases.revenue?.total || 1;
                        baseLabel = '% of revenue';
                        burdenRate = cost / baseValue;
                        break;
                    default:
                        baseValue = bases.hours?.totalBilled || 1;
                        baseLabel = 'per billed hour';
                        burdenRate = cost / baseValue;
                }
                
                // Update display elements
                var costEl = el('#timePreviewCost');
                var hoursEl = el('#timePreviewHours');
                var rateEl = el('#timePreviewRate');
                var wageEl = el('#timeAvgWage');
                var methodEl = el('#timeCostMethodLabel');
                var baseLabelEl = el('#timePreviewBaseLabel');
                var baseValueEl = el('#timePreviewBaseValue');
                
                if (costEl) costEl.textContent = self.formatCurrency(cost);
                // Always show TOTAL hours captured by the filter (not just hours with customer)
                if (hoursEl) hoursEl.textContent = self.fmtNum(totalHours, 0) + ' hours';
                if (rateEl) {
                    if (allocationBase === 'labor_dollars' || allocationBase === 'revenue') {
                        rateEl.textContent = self.fmtNum(burdenRate * 100, 2) + '%';
                    } else {
                        rateEl.textContent = '$' + self.fmtNum(burdenRate, 2);
                    }
                }
                if (wageEl) wageEl.textContent = '$' + self.fmtNum(avgWage, 2) + '/hr';
                if (baseLabelEl) baseLabelEl.textContent = baseLabel;
                if (baseValueEl) {
                    // Show GLOBAL base value (what we divide by)
                    if (allocationBase === 'labor_dollars' || allocationBase === 'revenue') {
                        baseValueEl.textContent = self.formatCurrency(baseValue);
                    } else if (allocationBase === 'headcount') {
                        baseValueEl.textContent = self.fmtNum(baseValue, 0) + ' employees';
                    } else {
                        baseValueEl.textContent = self.fmtNum(baseValue, 0) + ' hours';
                    }
                }
                if (methodEl) {
                    var methodNames = {
                        'employee_rate': 'Employee Rate',
                        'average_rate': 'Average Rate', 
                        'service_rate': 'Service Rate',
                        'custom_rate': 'Custom Rate'
                    };
                    methodEl.textContent = methodNames[filters.costMethod] || 'Employee Rate';
                }
                
                liveTotals.style.opacity = '1';
            }).catch(function(err) {
                console.error('Time preview error:', err);
                liveTotals.style.opacity = '1';
            });
        },

        // ════════════════════════════════════════════════════════════════════════
        // MANUAL CATEGORY TYPE
        // ════════════════════════════════════════════════════════════════════════

        renderManualModeConfig: function(mode, config, depts, bases) {
            var self = this;
            var html = '';
            
            if (mode === 'fixed_total') {
                html = '<div class="form-group px-2">' +
                    '<label class="small font-weight-bold">Total Amount</label>' +
                    '<div class="input-group input-group-sm" style="max-width: 200px;">' +
                        '<div class="input-group-prepend"><span class="input-group-text">$</span></div>' +
                        '<input type="number" class="form-control" id="manualFixedTotal" value="' + (config.fixedTotal || '') + '" placeholder="Enter amount" oninput="BurdenController.updateManualPreview()">' +
                    '</div>' +
                    '<small class="text-muted">This amount will be allocated across departments based on your allocation base.</small>' +
                '</div>';
            } else if (mode === 'by_dept') {
                var byDeptAmounts = config.byDeptAmounts || {};
                html = '<div class="form-group px-2">' +
                    '<label class="small font-weight-bold">Amount per Department</label>' +
                    '<div class="dept-amounts-list" style="max-height: 200px; overflow-y: auto; border: 1px solid #dee2e6; border-radius: 4px;">' +
                        depts.map(function(d) {
                            var amt = byDeptAmounts[d.id] || 0;
                            return '<div class="d-flex align-items-center px-2 py-1 border-bottom">' +
                                '<span class="small flex-grow-1">' + escapeHtml(d.name) + '</span>' +
                                '<div class="input-group input-group-sm" style="width: 120px;">' +
                                    '<div class="input-group-prepend"><span class="input-group-text py-0">$</span></div>' +
                                    '<input type="number" class="form-control dept-amount-input" data-dept-id="' + d.id + '" value="' + (amt || '') + '" oninput="BurdenController.updateManualPreview()">' +
                                '</div>' +
                            '</div>';
                        }).join('') +
                    '</div>' +
                    '<small class="text-muted">Enter specific amounts for each department.</small>' +
                '</div>';
            } else if (mode === 'per_unit') {
                var unitType = config.unitType || 'headcount';
                var perUnitRate = config.perUnitRate || 0;
                var isPercent = unitType === 'revenue' || unitType === 'direct_cost';
                
                html = '<div class="form-group px-2">' +
                    '<label class="small font-weight-bold">Unit Type</label>' +
                    '<select class="form-control form-control-sm" id="manualUnitType" onchange="BurdenController.updateManualPreview()">' +
                        '<option value="headcount"' + (unitType === 'headcount' ? ' selected' : '') + '>Per Employee (Headcount)</option>' +
                        '<option value="billed_hours"' + (unitType === 'billed_hours' ? ' selected' : '') + '>Per Billed Hour</option>' +
                        '<option value="total_hours"' + (unitType === 'total_hours' ? ' selected' : '') + '>Per Total Hour</option>' +
                        '<option value="revenue"' + (unitType === 'revenue' ? ' selected' : '') + '>% of Revenue</option>' +
                        '<option value="direct_cost"' + (unitType === 'direct_cost' ? ' selected' : '') + '>% of Direct Cost</option>' +
                        '<option value="square_feet"' + (unitType === 'square_feet' ? ' selected' : '') + '>Per Square Foot</option>' +
                    '</select>' +
                '</div>' +
                '<div class="form-group px-2">' +
                    '<label class="small font-weight-bold" id="perUnitRateLabel">' + (isPercent ? 'Rate (%)' : 'Rate ($)') + '</label>' +
                    '<div class="input-group input-group-sm" style="max-width: 200px;">' +
                        '<div class="input-group-prepend"><span class="input-group-text" id="perUnitRatePrefix">' + (isPercent ? '%' : '$') + '</span></div>' +
                        '<input type="number" class="form-control" id="manualPerUnitRate" value="' + (perUnitRate || '') + '" step="0.01" placeholder="Enter rate" oninput="BurdenController.updateManualPreview()">' +
                    '</div>' +
                    '<small class="text-muted" id="perUnitRateHelp">e.g., $5,000 per employee for benefits</small>' +
                '</div>' +
                
                // Show current base values
                '<div class="px-2 mt-2">' +
                    '<div class="small text-muted mb-1">Current Values:</div>' +
                    '<div class="d-flex flex-wrap gap-2" id="manualBaseValues">' +
                        '<span class="badge badge-light">Headcount: ' + self.fmtNum(bases.headcount?.total || 0, 0) + '</span>' +
                        '<span class="badge badge-light">Billed Hrs: ' + self.fmtNum(bases.hours?.totalBilled || 0, 0) + '</span>' +
                        '<span class="badge badge-light">Revenue: ' + self.formatCurrency(bases.revenue?.total || 0) + '</span>' +
                    '</div>' +
                '</div>';
            }
            
            return html;
        },
        
        setManualEntryMode: function(mode) {
            var self = this;
            
            // Update button states
            document.querySelectorAll('.manual-mode-btn').forEach(function(btn) {
                btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
            });
            
            // Get current config from flyout
            var catId = el('#catId')?.value || '';
            var categories = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
            var cat = categories.find(function(c) { return c.id === catId; }) || {};
            var manualConfig = cat.manualConfig || {};
            manualConfig.entryMode = mode;
            
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var bases = this.latestData.allocationBases || {};
            
            // Re-render mode config
            var configContainer = el('#manualModeConfig');
            if (configContainer) {
                configContainer.innerHTML = this.renderManualModeConfig(mode, manualConfig, depts, bases);
            }
            
            // Update preview
            this.updateManualPreview();
        },
        
        updateManualPreview: function() {
            var self = this;
            var preview = el('#manualPreview');
            if (!preview) return;
            
            var bases = this.latestData.allocationBases || {};
            var allocationBase = el('#catBase')?.value || 'billed_hours';
            
            // Determine mode from active button
            var activeBtn = document.querySelector('.manual-mode-btn.active');
            var mode = activeBtn ? activeBtn.getAttribute('data-mode') : 'fixed_total';
            
            var totalExpense = 0;
            
            if (mode === 'fixed_total') {
                totalExpense = parseFloat(el('#manualFixedTotal')?.value) || 0;
            } else if (mode === 'by_dept') {
                document.querySelectorAll('.dept-amount-input').forEach(function(input) {
                    totalExpense += parseFloat(input.value) || 0;
                });
            } else if (mode === 'per_unit') {
                var unitType = el('#manualUnitType')?.value || 'headcount';
                var rate = parseFloat(el('#manualPerUnitRate')?.value) || 0;
                var isPercent = unitType === 'revenue' || unitType === 'direct_cost';
                
                // Update labels when unit type changes
                var labelEl = el('#perUnitRateLabel');
                var prefixEl = el('#perUnitRatePrefix');
                var helpEl = el('#perUnitRateHelp');
                
                if (isPercent) {
                    if (labelEl) labelEl.textContent = 'Rate (%)';
                    if (prefixEl) prefixEl.textContent = '%';
                    if (helpEl) helpEl.textContent = 'e.g., 5% of revenue for royalties';
                } else {
                    if (labelEl) labelEl.textContent = 'Rate ($)';
                    if (prefixEl) prefixEl.textContent = '$';
                    if (helpEl) helpEl.textContent = unitType === 'headcount' ? 'e.g., $5,000 per employee for benefits' : 'e.g., $10 per hour for equipment';
                }
                
                // Calculate total based on unit type
                var baseValue = 0;
                switch (unitType) {
                    case 'headcount':
                        baseValue = bases.headcount?.total || 0;
                        break;
                    case 'billed_hours':
                        baseValue = bases.hours?.totalBilled || 0;
                        break;
                    case 'total_hours':
                        baseValue = bases.hours?.total || 0;
                        break;
                    case 'revenue':
                        baseValue = bases.revenue?.total || 0;
                        break;
                    case 'direct_cost':
                        baseValue = bases.directCost?.total || 0;
                        break;
                    case 'square_feet':
                        baseValue = bases.squareFeet?.total || 0;
                        break;
                }
                
                if (isPercent) {
                    totalExpense = baseValue * (rate / 100);
                } else {
                    totalExpense = baseValue * rate;
                }
            }
            
            // Calculate rate per hour
            var billedHours = bases.hours?.totalBilled || 1;
            var ratePerHour = totalExpense / billedHours;
            
            // Update display
            var totalEl = el('#manualPreviewTotal');
            var rateEl = el('#manualPreviewRate');
            
            if (totalEl) totalEl.textContent = '$' + this.fmtNum(totalExpense, 2);
            if (rateEl) rateEl.textContent = '$' + this.fmtNum(ratePerHour, 2);
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // DERIVED CATEGORY FUNCTIONS
        // ═══════════════════════════════════════════════════════════════════════════

        updateDerivedPreview: function() {
            var self = this;
            var liveTotals = el('#derivedLiveTotals');
            if (!liveTotals) return;
            
            var sourceId = el('#derivedSourceCategory')?.value || '';
            var percentage = parseFloat(el('#derivedPercentage')?.value) || 0;
            
            // Update badge
            if (el('#derivedPercentBadge')) el('#derivedPercentBadge').textContent = percentage + '%';
            
            if (!sourceId) {
                if (el('#derivedPreviewAmount')) el('#derivedPreviewAmount').textContent = '$0.00';
                if (el('#derivedPreviewRate')) el('#derivedPreviewRate').textContent = '$0.00';
                if (el('#derivedSourceName')) el('#derivedSourceName').textContent = 'Not selected';
                if (el('#derivedSourceExpense')) el('#derivedSourceExpense').textContent = '$0.00';
                return;
            }
            
            // Find source category
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var source = categories.find(function(c) { return c.id === sourceId; });
            
            if (!source) {
                if (el('#derivedPreviewAmount')) el('#derivedPreviewAmount').textContent = '$0.00';
                if (el('#derivedPreviewRate')) el('#derivedPreviewRate').textContent = '$0.00';
                if (el('#derivedSourceName')) el('#derivedSourceName').textContent = 'Unknown';
                if (el('#derivedSourceExpense')) el('#derivedSourceExpense').textContent = '$0.00';
                return;
            }
            
            var sourceExpense = source.totalExpense || 0;
            var derivedAmount = sourceExpense * (percentage / 100);
            var bases = this.latestData.allocationBases || {};
            var billedHours = bases.hours?.totalBilled || 1;
            var rate = derivedAmount / billedHours;
            
            if (el('#derivedPreviewAmount')) el('#derivedPreviewAmount').textContent = this.formatCurrency(derivedAmount);
            if (el('#derivedPreviewRate')) el('#derivedPreviewRate').textContent = '$' + this.fmtNum(rate, 2);
            if (el('#derivedSourceName')) el('#derivedSourceName').textContent = source.label || sourceId;
            if (el('#derivedSourceExpense')) el('#derivedSourceExpense').textContent = this.formatCurrency(sourceExpense);
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // FORMULA CATEGORY FUNCTIONS
        // ═══════════════════════════════════════════════════════════════════════════

        insertFormulaVar: function(varText) {
            var textarea = el('#formulaExpression');
            if (!textarea) return;
            
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            var value = textarea.value;
            
            textarea.value = value.substring(0, start) + varText + value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + varText.length;
            textarea.focus();
            
            this.validateFormula();
        },

        validateFormula: function() {
            var self = this;
            var textarea = el('#formulaExpression');
            var validation = el('#formulaValidation');
            if (!textarea || !validation) return;
            
            var formula = textarea.value.trim();
            if (!formula) {
                validation.innerHTML = '<span class="text-muted">Enter a formula to calculate</span>';
                el('#formulaPreviewAmount').textContent = '$0.00';
                el('#formulaPreviewRate').textContent = '$0.00';
                return;
            }
            
            try {
                // Build context with available values
                var context = this.buildFormulaContext();
                
                // Replace variable references with values
                var evalFormula = formula;
                
                // Replace cat["XXX"] bracket notation (preferred for IDs with special chars)
                evalFormula = evalFormula.replace(/cat\["([^"]+)"\]/g, function(match, catId) {
                    if (context.categories[catId] !== undefined) {
                        return context.categories[catId];
                    }
                    throw new Error('Unknown category: ' + catId);
                });
                
                // Replace cat.XXX dot notation (for simple IDs)
                evalFormula = evalFormula.replace(/cat\.([a-zA-Z0-9_]+)/g, function(match, catId) {
                    if (context.categories[catId] !== undefined) {
                        return context.categories[catId];
                    }
                    throw new Error('Unknown category: ' + catId);
                });
                
                // Replace base.XXX references
                evalFormula = evalFormula.replace(/base\.([a-zA-Z0-9_]+)/g, function(match, baseId) {
                    if (context.bases[baseId] !== undefined) {
                        return context.bases[baseId];
                    }
                    throw new Error('Unknown base: ' + baseId);
                });
                
                // Validate parentheses
                var openCount = (evalFormula.match(/\(/g) || []).length;
                var closeCount = (evalFormula.match(/\)/g) || []).length;
                if (openCount !== closeCount) {
                    throw new Error('Mismatched parentheses');
                }
                
                // Evaluate safely (only allow math operations and numbers)
                var safeFormula = evalFormula.replace(/[^0-9+\-*/.()e\s]/gi, '');
                
                var result = eval(safeFormula);
                
                if (isNaN(result) || !isFinite(result)) {
                    throw new Error('Invalid result (division by zero?)');
                }
                
                validation.innerHTML = '<span class="text-success"><i class="fas fa-check-circle mr-1"></i>Valid formula</span>';
                
                // Update preview
                var billedHours = context.bases.billed_hours || 1;
                var rate = result / billedHours;
                
                if (el('#formulaPreviewAmount')) el('#formulaPreviewAmount').textContent = this.formatCurrency(result);
                if (el('#formulaPreviewRate')) el('#formulaPreviewRate').textContent = '$' + this.fmtNum(rate, 2);
                
            } catch (err) {
                validation.innerHTML = '<span class="text-danger"><i class="fas fa-exclamation-circle mr-1"></i>' + (err.message || 'Invalid formula') + '</span>';
                el('#formulaPreviewAmount').textContent = '$0.00';
                el('#formulaPreviewRate').textContent = '$0.00';
            }
        },

        buildFormulaContext: function() {
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var bases = this.latestData.allocationBases || {};
            
            var context = {
                categories: {},
                bases: {
                    billed_hours: bases.hours?.totalBilled || 0,
                    total_hours: bases.hours?.total || 0,
                    headcount: bases.headcount?.total || 0,
                    revenue: bases.revenue?.total || 0,
                    labor_dollars: bases.laborDollars?.total || 0,
                    direct_cost: bases.directCost?.total || 0
                }
            };
            
            categories.forEach(function(c) {
                context.categories[c.id] = c.totalExpense || 0;
            });
            
            return context;
        },

        applyFormulaPreset: function(preset) {
            var textarea = el('#formulaExpression');
            if (!textarea) return;
            
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            // Filter out current category being edited to avoid self-reference
            var currentCatId = el('#catIdInput')?.value || '';
            var otherCats = categories.filter(function(c) { return c.id !== currentCatId; });
            
            if (otherCats.length === 0) {
                showToast('No other categories available for formula', 'warning');
                return;
            }
            
            var formula = '';
            switch (preset) {
                case 'overhead_ratio':
                    // Total overhead as percentage of labor dollars
                    if (otherCats.length === 1) {
                        formula = 'cat["' + otherCats[0].id + '"] / base.labor_dollars * 100';
                    } else {
                        formula = '(' + otherCats.map(function(c) { return 'cat["' + c.id + '"]'; }).join(' + ') + ') / base.labor_dollars * 100';
                    }
                    break;
                case 'labor_multiplier':
                    // Total overhead per billed hour
                    if (otherCats.length === 1) {
                        formula = 'cat["' + otherCats[0].id + '"] / base.billed_hours';
                    } else {
                        formula = '(' + otherCats.map(function(c) { return 'cat["' + c.id + '"]'; }).join(' + ') + ') / base.billed_hours';
                    }
                    break;
                case 'combined_pool':
                    // Sum of first two categories
                    if (otherCats.length >= 2) {
                        formula = 'cat["' + otherCats[0].id + '"] + cat["' + otherCats[1].id + '"]';
                    } else {
                        formula = 'cat["' + otherCats[0].id + '"]';
                    }
                    break;
            }
            
            textarea.value = formula;
            this.validateFormula();
        },

        loadLaborRates: function() {
            var self = this;
            var deptId = el('#laborDeptFilter')?.value || '';
            var titleId = el('#laborTitleFilter')?.value || '';
            var serviceId = el('#laborServiceFilter')?.value || '';
            var aggregation = el('#laborAggregation')?.value || 'average';
            
            var rateDisplay = el('#laborRateDisplay');
            var empBadge = el('#laborEmpBadge');
            var descEl = el('#laborSourceDesc');
            
            if (rateDisplay) {
                rateDisplay.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            }
            if (descEl) descEl.textContent = 'Calculating...';
            
            API.post('burden', { 
                subAction: 'get_labor_rates', 
                departmentId: deptId,
                titleId: titleId,
                serviceItemId: serviceId,
                aggregation: aggregation
            }).then(function(res) {
                var data = res.data || res;
                
                if (data.error) {
                    if (rateDisplay) rateDisplay.textContent = '$0.00';
                    if (empBadge) empBadge.textContent = '0 employees';
                    if (descEl) descEl.textContent = 'No data available';
                    el('#rbBaseLaborRate').value = '0.00';
                    self.updateRatePreview();
                    return;
                }
                
                var rate = data.rate || 0;
                var count = data.employeeCount || 0;
                var min = data.min || 0;
                var max = data.max || 0;
                
                // If no employees match filters, show 0
                if (count === 0 || rate === 0) {
                    if (rateDisplay) rateDisplay.textContent = '$0.00';
                    if (empBadge) empBadge.textContent = '0 employees';
                    if (descEl) descEl.textContent = 'No employees match filters';
                    el('#rbBaseLaborRate').value = '0.00';
                    self.updateRatePreview();
                    return;
                }
                
                // Update rate display
                if (rateDisplay) {
                    rateDisplay.textContent = '$' + self.fmtNum(rate, 2);
                }
                
                // Update employee badge
                if (empBadge) empBadge.textContent = count + ' employee' + (count !== 1 ? 's' : '');
                
                // Update description
                if (descEl) {
                    var desc = aggregation.charAt(0).toUpperCase() + aggregation.slice(1) + ' from ' + count + ' employee' + (count !== 1 ? 's' : '');
                    if (min > 0 && max > 0 && min !== max) {
                        desc += ' ($' + self.fmtNum(min, 0) + '-$' + self.fmtNum(max, 0) + ')';
                    }
                    descEl.textContent = desc;
                }
                
                // Auto-apply rate to builder
                el('#rbBaseLaborRate').value = rate.toFixed(2);
                self.updateRatePreview();
            }).catch(function(err) {
                if (rateDisplay) rateDisplay.textContent = 'Error';
                if (descEl) descEl.textContent = 'Failed to load rates';
                el('#rbBaseLaborRate').value = '0.00';
                self.updateRatePreview();
            });
        },

        updateBurdenFromSource: function() {
            var sourceSelect = el('#rbBurdenSource');
            var rateInput = el('#rbBurdenRate');
            var manualInput = el('#burdenManualInput');
            var descEl = el('#burdenSourceDesc');
            var displayEl = el('#burdenRateDisplay');
            
            if (!sourceSelect) return;
            
            var source = sourceSelect.value || 'all';
            
            if (source === 'manual') {
                if (rateInput) rateInput.readOnly = false;
                if (manualInput) manualInput.style.display = 'block';
                if (descEl) descEl.textContent = 'Manual entry';
            } else {
                var option = sourceSelect.querySelector('option:checked');
                var rate = parseFloat(option?.dataset.rate) || 0;
                if (rateInput) {
                    rateInput.value = rate.toFixed(2);
                    rateInput.readOnly = true;
                }
                if (manualInput) manualInput.style.display = 'none';
                if (displayEl) displayEl.textContent = '$' + this.fmtNum(rate, 2);
                if (descEl) descEl.textContent = option?.textContent?.split('($')[0]?.trim() || 'All Departments';
            }
            
            this.updateRatePreview();
        },

        useLaborRate: function(rate) {
            var laborInput = el('#rbBaseLaborRate');
            if (laborInput) {
                laborInput.value = rate.toFixed(2);
            }
            // Switch to manual mode
            if (el('#laborSourceType')) {
                el('#laborSourceType').value = 'manual';
                this.toggleLaborSource();
            }
            this.updateRatePreview();
            showToast('Labor rate applied', 'success');
        },

        addCostRow: function() {
            var container = el('#additionalCostsContainer');
            if (!container) return;
            
            var row = document.createElement('div');
            row.className = 'srb-cost-row';
            row.innerHTML = 
                '<input type="text" class="srb-cost-input srb-cost-name" placeholder="Name">' +
                '<select class="srb-cost-input srb-cost-type" onchange="BurdenController.updateRatePreview()">' +
                    '<option value="percent_labor">% of Labor</option>' +
                    '<option value="percent_subtotal">% of Subtotal</option>' +
                    '<option value="flat">$/hr</option>' +
                '</select>' +
                '<input type="number" class="srb-cost-input srb-cost-val" value="0" step="0.5" onchange="BurdenController.updateRatePreview()">' +
                '<div class="srb-cost-result">$0.00/hr</div>' +
                '<button class="srb-cost-delete" onclick="this.closest(\'.srb-cost-row\').remove(); BurdenController.updateRatePreview();"><i class="fas fa-times"></i></button>';
            container.appendChild(row);
        },

        clearRateBuilder: function() {
            if (el('#rbBaseLaborRate')) el('#rbBaseLaborRate').value = '0.00';
            if (el('#rbBurdenRate')) el('#rbBurdenRate').value = (this.latestData.kpis?.compositeRate || 0).toFixed(2);
            if (el('#rbMarginValue')) el('#rbMarginValue').value = '15';
            if (el('#rbMarginType')) el('#rbMarginType').value = 'margin';
            if (el('#rbBurdenSource')) el('#rbBurdenSource').value = 'all';
            if (el('#laborSourceType')) el('#laborSourceType').value = 'employee';
            if (el('#laborDeptFilter')) el('#laborDeptFilter').value = '';
            if (el('#laborAggregation')) el('#laborAggregation').value = 'average';
            
            // Reset premium rates
            if (el('#showOvertimeRate')) el('#showOvertimeRate').checked = false;
            if (el('#showDoubletimeRate')) el('#showDoubletimeRate').checked = false;
            if (el('#otMultiplier')) el('#otMultiplier').value = '1.5';
            if (el('#dtMultiplier')) el('#dtMultiplier').value = '2';
            
            var container = el('#additionalCostsContainer');
            if (container) {
                container.innerHTML = '<tr class="rb-cost-row">' +
                    '<td>' +
                        '<div class="d-flex align-items-center gap-2">' +
                            '<input type="text" class="form-control form-control-sm rb-cost-name" value="G&A" style="width: 100px;">' +
                            '<select class="form-control form-control-sm rb-cost-type" style="width: 100px;" onchange="BurdenController.updateRatePreview()">' +
                                '<option value="percent_labor">% Labor</option>' +
                                '<option value="percent_subtotal">% Subtotal</option>' +
                                '<option value="flat">$/hr</option>' +
                            '</select>' +
                            '<input type="number" class="form-control form-control-sm rb-cost-value text-right" value="10" style="width: 70px;" onchange="BurdenController.updateRatePreview()">' +
                            '<button class="btn btn-sm btn-link text-danger p-0" onclick="this.closest(\'tr\').remove(); BurdenController.updateRatePreview();"><i class="fas fa-times"></i></button>' +
                        '</div>' +
                    '</td><td class="rb-value rb-cost-total">$0.00/hr</td>' +
                '</tr>';
            }
            
            this.toggleLaborSource();
            this.updateBurdenFromSource();
            this.updateRatePreview();
            
            // Schedule save of cleared/default state (debounced)
            this.scheduleRateBuilderSave();
            showToast('Rate builder reset', 'info');
        },
        
        // Save rate builder configuration to backend
        saveRateBuilderConfig: function() {
            var self = this;
            
            // Gather additional costs
            var additionalCosts = [];
            document.querySelectorAll('.rb-cost-row').forEach(function(row) {
                var name = row.querySelector('.rb-cost-name')?.value || 'Cost';
                var type = row.querySelector('.rb-cost-type')?.value || 'flat';
                var value = parseFloat(row.querySelector('.rb-cost-value')?.value) || 0;
                additionalCosts.push({ name: name, type: type, value: value });
            });
            
            var rateBuilderConfig = {
                laborSourceType: el('#laborSourceType')?.value || 'employee',
                laborDeptFilter: el('#laborDeptFilter')?.value || '',
                laborAggregation: el('#laborAggregation')?.value || 'average',
                burdenSource: el('#rbBurdenSource')?.value || 'all',
                marginType: el('#rbMarginType')?.value || 'margin',
                marginValue: parseFloat(el('#rbMarginValue')?.value) || 15,
                additionalCosts: additionalCosts,
                showOvertime: el('#showOvertimeRate')?.checked || false,
                showDoubletime: el('#showDoubletimeRate')?.checked || false,
                otMultiplier: parseFloat(el('#otMultiplier')?.value) || 1.5,
                dtMultiplier: parseFloat(el('#dtMultiplier')?.value) || 2
            };
            
            // Save only the rateBuilder key - backend should merge with existing config
            API.post('burden_config', { 
                config: { rateBuilder: rateBuilderConfig },
                mergeOnly: true  // Signal to merge, not replace
            }).then(function() {
                console.log('[RateBuilder] Config saved');
                // Update local cache so next restore uses latest
                if (self.latestData && self.latestData.meta && self.latestData.meta.config) {
                    self.latestData.meta.config.rateBuilder = rateBuilderConfig;
                }
            }).catch(function(err) {
                console.error('[RateBuilder] Config save error:', err);
            });
        },
        
        // Restore rate builder configuration from config
        restoreRateBuilderConfig: function() {
            var config = (this.latestData.meta && this.latestData.meta.config) || {};
            var rb = config.rateBuilder;
            if (!rb) return; // No saved config
            
            // Set flag to skip auto-save during restore
            this._restoringRateBuilder = true;
            
            // Restore labor settings
            if (el('#laborSourceType') && rb.laborSourceType) {
                el('#laborSourceType').value = rb.laborSourceType;
            }
            if (el('#laborDeptFilter') && rb.laborDeptFilter !== undefined) {
                el('#laborDeptFilter').value = rb.laborDeptFilter;
            }
            if (el('#laborAggregation') && rb.laborAggregation) {
                el('#laborAggregation').value = rb.laborAggregation;
            }
            
            // Restore burden source
            if (el('#rbBurdenSource') && rb.burdenSource) {
                el('#rbBurdenSource').value = rb.burdenSource;
            }
            
            // Restore margin settings
            if (el('#rbMarginType') && rb.marginType) {
                el('#rbMarginType').value = rb.marginType;
            }
            if (el('#rbMarginValue') && rb.marginValue !== undefined) {
                el('#rbMarginValue').value = rb.marginValue;
            }
            
            // Restore premium rates
            if (el('#showOvertimeRate')) el('#showOvertimeRate').checked = rb.showOvertime || false;
            if (el('#showDoubletimeRate')) el('#showDoubletimeRate').checked = rb.showDoubletime || false;
            if (el('#otMultiplier') && rb.otMultiplier) el('#otMultiplier').value = rb.otMultiplier;
            if (el('#dtMultiplier') && rb.dtMultiplier) el('#dtMultiplier').value = rb.dtMultiplier;
            
            // Restore additional costs
            if (rb.additionalCosts && rb.additionalCosts.length > 0) {
                var container = el('#additionalCostsContainer');
                if (container) {
                    container.innerHTML = rb.additionalCosts.map(function(cost) {
                        return '<tr class="rb-cost-row">' +
                            '<td>' +
                                '<div class="d-flex align-items-center gap-2">' +
                                    '<input type="text" class="form-control form-control-sm rb-cost-name" value="' + (cost.name || 'Cost') + '" style="width: 100px;">' +
                                    '<select class="form-control form-control-sm rb-cost-type" style="width: 100px;" onchange="BurdenController.updateRatePreview()">' +
                                        '<option value="percent_labor"' + (cost.type === 'percent_labor' ? ' selected' : '') + '>% Labor</option>' +
                                        '<option value="percent_subtotal"' + (cost.type === 'percent_subtotal' ? ' selected' : '') + '>% Subtotal</option>' +
                                        '<option value="flat"' + (cost.type === 'flat' ? ' selected' : '') + '>$/hr</option>' +
                                    '</select>' +
                                    '<input type="number" class="form-control form-control-sm rb-cost-value text-right" value="' + (cost.value || 0) + '" style="width: 70px;" onchange="BurdenController.updateRatePreview()">' +
                                    '<button class="btn btn-sm btn-link text-danger p-0" onclick="this.closest(\'tr\').remove(); BurdenController.updateRatePreview();"><i class="fas fa-times"></i></button>' +
                                '</div>' +
                            '</td><td class="rb-value rb-cost-total">$0.00/hr</td>' +
                        '</tr>';
                    }).join('');
                }
            }
            
            // Trigger UI updates after restoring
            this.toggleLaborSource();
            this.updateBurdenFromSource();
            this.updateRatePreview();
            this.updatePremiumRates();
            
            // Clear flag after restore complete
            this._restoringRateBuilder = false;
            
            console.log('[RateBuilder] Config restored:', rb);
        },

        updateRatePreview: function() {
            var self = this;
            var baseLaborRate = parseFloat(el('#rbBaseLaborRate')?.value) || 0;
            var burdenRate = parseFloat(el('#rbBurdenRate')?.value) || 0;
            var marginType = el('#rbMarginType')?.value || 'margin';
            var marginValue = parseFloat(el('#marginSliderMain')?.value) || parseFloat(el('#rbMarginValue')?.value) || 25;
            
            var subtotal = baseLaborRate + burdenRate;
            
            // Add additional costs and update per-row totals
            var additionalTotal = 0;
            document.querySelectorAll('.srb-cost-row').forEach(function(row) {
                var type = row.querySelector('.srb-cost-type')?.value || 'flat';
                var value = parseFloat(row.querySelector('.srb-cost-val')?.value) || 0;
                var rowTotal = 0;
                
                if (type === 'percent_labor') {
                    rowTotal = baseLaborRate * (value / 100);
                } else if (type === 'percent_subtotal') {
                    rowTotal = subtotal * (value / 100);
                } else {
                    rowTotal = value;
                }
                
                additionalTotal += rowTotal;
                
                // Update row total display
                var totalCell = row.querySelector('.srb-cost-result');
                if (totalCell) {
                    totalCell.textContent = '$' + self.fmtNum(rowTotal, 2) + '/hr';
                }
            });
            
            var totalCost = subtotal + additionalTotal;
            var sellingRate, margin;
            
            if (marginType === 'margin') {
                sellingRate = marginValue > 0 && marginValue < 100 ? totalCost / (1 - marginValue / 100) : totalCost;
                margin = sellingRate - totalCost;
            } else {
                margin = totalCost * (marginValue / 100);
                sellingRate = totalCost + margin;
            }
            
            // Calculate additional metrics
            var markup = totalCost > 0 ? ((sellingRate - totalCost) / totalCost * 100) : 0;
            var multiplier = totalCost > 0 ? (sellingRate / totalCost) : 1;
            var profitPer1k = margin * 1000;
            
            // Update component displays
            if (el('#laborRateDisplay')) el('#laborRateDisplay').textContent = '$' + this.fmtNum(baseLaborRate, 2);
            if (el('#burdenRateDisplay')) el('#burdenRateDisplay').textContent = '$' + this.fmtNum(burdenRate, 2);
            if (el('#additionalCostsTotal')) el('#additionalCostsTotal').innerHTML = '$' + this.fmtNum(additionalTotal, 2) + '<small>/hr</small>';
            
            // Update totals section
            if (el('#totalLaborCost')) el('#totalLaborCost').textContent = '$' + this.fmtNum(baseLaborRate, 2) + '/hr';
            if (el('#totalBurdenCost')) el('#totalBurdenCost').textContent = '$' + this.fmtNum(burdenRate, 2) + '/hr';
            if (el('#totalAdditionalCost')) el('#totalAdditionalCost').textContent = '$' + this.fmtNum(additionalTotal, 2) + '/hr';
            if (el('#grandTotalCost')) el('#grandTotalCost').textContent = '$' + this.fmtNum(totalCost, 2) + '/hr';
            if (el('#totalProfit')) el('#totalProfit').textContent = '+$' + this.fmtNum(margin, 2) + '/hr';
            
            // Update final selling rate
            if (el('#finalSellingRate')) el('#finalSellingRate').innerHTML = '$' + this.fmtNum(sellingRate, 2) + '<small style="font-size: 0.5em; opacity: 0.8;">/hr</small>';
            if (el('#finalRateSub')) el('#finalRateSub').textContent = this.fmtNum(multiplier, 2) + '× cost | ' + this.fmtNum(markup, 0) + '% markup';
            
            // Update KPI cards
            if (el('#kpiSellingRate')) el('#kpiSellingRate').innerHTML = '$' + this.fmtNum(sellingRate, 2) + '<small>/hr</small>';
            if (el('#kpiSellingMult')) el('#kpiSellingMult').textContent = this.fmtNum(multiplier, 2) + '× cost';
            if (el('#kpiTotalCost')) el('#kpiTotalCost').innerHTML = '$' + this.fmtNum(totalCost, 2) + '<small>/hr</small>';
            if (el('#kpiProfitHr')) el('#kpiProfitHr').textContent = '$' + this.fmtNum(margin, 2);
            if (el('#kpiProfitPer1k')) el('#kpiProfitPer1k').textContent = '$' + this.fmtNum(profitPer1k, 0) + ' per 1K hours';
            if (el('#kpiMargin')) el('#kpiMargin').textContent = this.fmtNum(marginValue, 0) + '%';
            if (el('#kpiMarkup')) el('#kpiMarkup').textContent = this.fmtNum(markup, 0) + '% markup';
            
            // Update rate visualization bar
            if (sellingRate > 0) {
                var laborPct = (baseLaborRate / sellingRate) * 100;
                var burdenPct = (burdenRate / sellingRate) * 100;
                var addPct = (additionalTotal / sellingRate) * 100;
                var profitPct = (margin / sellingRate) * 100;
                
                if (el('#rateBarLabor')) el('#rateBarLabor').style.width = laborPct + '%';
                if (el('#rateBarBurden')) el('#rateBarBurden').style.width = burdenPct + '%';
                if (el('#rateBarAdditional')) el('#rateBarAdditional').style.width = addPct + '%';
                if (el('#rateBarProfit')) el('#rateBarProfit').style.width = profitPct + '%';
            }
            
            // Legacy updates for compatibility
            if (el('#rsTotalCost')) el('#rsTotalCost').textContent = '$' + this.fmtNum(totalCost, 2) + '/hr';
            if (el('#rsMarginAmount')) el('#rsMarginAmount').textContent = '$' + this.fmtNum(margin, 2) + '/hr';
            if (el('#rsSellingRate')) el('#rsSellingRate').textContent = '$' + this.fmtNum(sellingRate, 2) + '/hr';
            
            // Update margin slider/explorer
            this.updateMarginSlider(marginValue);
            this.renderRateBreakdownChart(baseLaborRate, burdenRate, additionalTotal, margin);
            this.updatePremiumRates();
            
            // Debounced auto-save rate builder config
            this.scheduleRateBuilderSave();
        },
        
        // Debounced save to avoid excessive API calls
        scheduleRateBuilderSave: function() {
            // Skip auto-save during restore
            if (this._restoringRateBuilder) return;
            
            var self = this;
            if (this._rateBuilderSaveTimeout) {
                clearTimeout(this._rateBuilderSaveTimeout);
            }
            this._rateBuilderSaveTimeout = setTimeout(function() {
                self.saveRateBuilderConfig();
            }, 1500); // Save after 1.5s of inactivity
        },
        
        togglePremiumRates: function() {
            var content = el('#premiumRatesContent');
            var icon = el('#premiumToggleIcon');
            if (content) {
                content.classList.toggle('show');
                if (icon) {
                    icon.classList.toggle('fa-chevron-down');
                    icon.classList.toggle('fa-chevron-up');
                }
            }
        },
        
        updatePremiumRates: function() {
            var sellingRateEl = el('#finalSellingRate');
            var sellingRateText = sellingRateEl?.textContent || '$0.00';
            var sellingRate = parseFloat(sellingRateText.replace(/[^0-9.-]/g, '')) || 0;
            
            var showOT = el('#showOvertimeRate')?.checked || false;
            var showDT = el('#showDoubletimeRate')?.checked || false;
            var otMult = parseFloat(el('#otMultiplier')?.value) || 1.5;
            var dtMult = parseFloat(el('#dtMultiplier')?.value) || 2.0;
            
            var otRate = sellingRate * otMult;
            var dtRate = sellingRate * dtMult;
            
            // Update display fields
            var otDisplay = el('#otRateDisplay');
            var dtDisplay = el('#dtRateDisplay');
            
            if (otDisplay) {
                otDisplay.textContent = showOT && sellingRate > 0 ? '$' + this.fmtNum(otRate, 2) + '/hr' : '--';
            }
            
            if (dtDisplay) {
                dtDisplay.textContent = showDT && sellingRate > 0 ? '$' + this.fmtNum(dtRate, 2) + '/hr' : '--';
            }
        },
        
        updateMarginSlider: function(marginValue) {
            var self = this;
            var margin = parseInt(marginValue) || 25;
            
            // Get current total cost from the rate builder
            var baseLaborRate = parseFloat(el('#rbBaseLaborRate')?.value) || 0;
            var burdenRate = parseFloat(el('#rbBurdenRate')?.value) || 0;
            var subtotal = baseLaborRate + burdenRate;
            var additionalTotal = 0;
            
            document.querySelectorAll('.srb-cost-row').forEach(function(row) {
                var type = row.querySelector('.srb-cost-type')?.value || 'flat';
                var value = parseFloat(row.querySelector('.srb-cost-val')?.value) || 0;
                if (type === 'percent_labor') {
                    additionalTotal += baseLaborRate * (value / 100);
                } else if (type === 'percent_subtotal') {
                    additionalTotal += subtotal * (value / 100);
                } else {
                    additionalTotal += value;
                }
            });
            
            var totalCost = subtotal + additionalTotal;
            var sellingRate = margin > 0 && margin < 100 ? totalCost / (1 - margin / 100) : totalCost;
            var profit = sellingRate - totalCost;
            var markup = totalCost > 0 ? ((sellingRate - totalCost) / totalCost) * 100 : 0;
            var per1000 = profit * 1000;
            
            // Update display elements
            if (el('#explorerMarginValue')) el('#explorerMarginValue').textContent = margin + '%';
            if (el('#sliderSellingRate')) el('#sliderSellingRate').textContent = '$' + this.fmtNum(sellingRate, 2);
            if (el('#sliderProfitAmount')) el('#sliderProfitAmount').textContent = '$' + this.fmtNum(profit, 2);
            if (el('#sliderMarkup')) el('#sliderMarkup').textContent = this.fmtNum(markup, 0) + '%';
            if (el('#sliderPer1000')) el('#sliderPer1000').textContent = '$' + this.fmtNum(per1000, 0);
            
            // Update quick select buttons
            document.querySelectorAll('.srb-explorer-preset').forEach(function(btn) {
                var btnMargin = parseInt(btn.textContent);
                btn.classList.toggle('active', btnMargin === margin);
            });
        },
        
        setMarginSlider: function(margin) {
            var slider = el('#marginSlider');
            var mainSlider = el('#marginSliderMain');
            if (slider) {
                slider.value = margin;
            }
            if (mainSlider) {
                mainSlider.value = margin;
            }
            if (el('#marginValueDisplay')) {
                el('#marginValueDisplay').textContent = margin + '%';
            }
            this.updateMarginSlider(margin);
            this.updateRatePreview();
        },

        renderRateBreakdownChart: function(labor, burden, additional, margin) {
            var container = el('#rateBreakdownChart');
            if (!container) return;
            
            var data = [{
                values: [labor, burden, additional, margin].map(function(v) { return Math.max(0, v); }),
                labels: ['Labor', 'Burden', 'Additional', 'Profit'],
                type: 'pie',
                hole: 0.4,
                marker: {
                    colors: ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981']
                },
                textinfo: 'label+percent',
                textposition: 'inside',
                insidetextorientation: 'horizontal',
                textfont: { size: 9, color: '#fff' },
                hoverinfo: 'label+value+percent',
                hovertemplate: '%{label}: $%{value:.2f}/hr (%{percent})<extra></extra>'
            }];
            
            var layout = {
                autosize: true,
                margin: { t: 8, b: 8, l: 8, r: 8 },
                showlegend: false,
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent'
            };
            
            Plotly.newPlot(container, data, layout, { responsive: true, displayModeBar: false });
        },

        renderSensitivityTable: function(baseCost) {
            var container = el('#sensitivityTable');
            if (!container) return;
            
            var self = this;
            var margins = [15, 20, 25, 30, 35, 40];
            var maxRate = baseCost / (1 - 0.40);
            
            var html = '<table class="table table-sm mb-0 sensitivity-table">' +
                '<thead class="thead-light"><tr><th style="width:60px;">Margin</th><th>Rate</th><th class="text-right" style="width:70px;">Markup</th></tr></thead>' +
                '<tbody>' + margins.map(function(m) {
                    var sellRate = baseCost / (1 - m / 100);
                    var markup = ((sellRate - baseCost) / baseCost) * 100;
                    var barWidth = (sellRate / maxRate) * 100;
                    var isHighlight = (m === 25);
                    return '<tr' + (isHighlight ? ' class="table-active"' : '') + '>' +
                        '<td class="font-weight-medium">' + m + '%</td>' +
                        '<td>' +
                            '<div class="d-flex align-items-center">' +
                                '<div class="sensitivity-bar mr-2" style="width: 80px; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">' +
                                    '<div style="width: ' + barWidth + '%; height: 100%; background: linear-gradient(90deg, #3b82f6, #8b5cf6); border-radius: 4px;"></div>' +
                                '</div>' +
                                '<span class="font-weight-bold' + (isHighlight ? ' text-primary' : '') + '">$' + self.fmtNum(sellRate, 2) + '</span>' +
                            '</div>' +
                        '</td>' +
                        '<td class="text-right text-muted small">' + self.fmtNum(markup, 0) + '%</td>' +
                    '</tr>';
                }).join('') + '</tbody></table>';
            
            container.innerHTML = html;
        },

        saveRateBuild: function() {
            var self = this;
            var baseLaborRate = parseFloat(el('#rbBaseLaborRate')?.value) || 0;
            var burdenRate = parseFloat(el('#rbBurdenRate')?.value) || 0;
            var marginType = el('#rbMarginType')?.value || 'margin';
            var marginValue = parseFloat(el('#marginSliderMain')?.value) || 25;
            
            // Calculate totals using same logic as updateRatePreview
            var subtotal = baseLaborRate + burdenRate;
            var additionalTotal = 0;
            var additionalCosts = [];
            
            document.querySelectorAll('.srb-cost-row').forEach(function(row) {
                var name = row.querySelector('.srb-cost-name')?.value || 'Cost';
                var type = row.querySelector('.srb-cost-type')?.value || 'flat';
                var value = parseFloat(row.querySelector('.srb-cost-val')?.value) || 0;
                var rowTotal = 0;
                
                if (type === 'percent_labor') {
                    rowTotal = baseLaborRate * (value / 100);
                } else if (type === 'percent_subtotal') {
                    rowTotal = subtotal * (value / 100);
                } else {
                    rowTotal = value;
                }
                
                additionalTotal += rowTotal;
                additionalCosts.push({ name: name, type: type, value: value, total: rowTotal });
            });
            
            var totalCost = subtotal + additionalTotal;
            var sellingRate, margin;
            
            if (marginType === 'margin') {
                sellingRate = marginValue > 0 && marginValue < 100 ? totalCost / (1 - marginValue / 100) : totalCost;
                margin = sellingRate - totalCost;
            } else {
                margin = totalCost * (marginValue / 100);
                sellingRate = totalCost + margin;
            }
            
            var markup = totalCost > 0 ? ((sellingRate - totalCost) / totalCost * 100) : 0;
            
            // Store pending rate build for saving
            this.pendingRateBuild = {
                laborRate: baseLaborRate,
                burdenRate: burdenRate,
                additionalCosts: additionalCosts,
                additionalTotal: additionalTotal,
                totalCost: totalCost,
                marginType: marginType,
                marginValue: marginValue,
                margin: margin,
                markup: markup,
                sellingRate: sellingRate
            };
            
            // Open flyout for naming
            this.openFlyout();
            this.setFlyoutTitle('<i class="fas fa-bookmark text-warning mr-2"></i>Save Rate Build', null);
            el('#flyoutStats').innerHTML = '<span class="badge badge-primary"><i class="fas fa-dollar-sign mr-1"></i>$' + this.fmtNum(sellingRate, 2) + '/hr</span>';
            
            // Build additional costs display
            var additionalHtml = additionalCosts.map(function(c) {
                var typeLabel = c.type === 'percent_labor' ? '% Labor' : (c.type === 'percent_subtotal' ? '% Subtotal' : '$/hr');
                return '<div class="d-flex justify-content-between text-muted small"><span class="pl-2">• ' + escapeHtml(c.name) + ' (' + c.value + ' ' + typeLabel + ')</span><span>$' + self.fmtNum(c.total, 2) + '</span></div>';
            }).join('');
            
            el('#flyoutBody').innerHTML = '<div class="p-3">' +
                '<div class="form-group">' +
                    '<label class="small font-weight-bold">Rate Build Name</label>' +
                    '<input type="text" class="form-control" id="newRateBuildName" placeholder="e.g. Standard Labor Rate, Senior Engineer" value="Rate Build ' + ((this.savedRateBuilds?.length || 0) + 1) + '">' +
                '</div>' +
                '<div class="card mb-3">' +
                    '<div class="card-header py-2 small"><strong>Rate Summary</strong></div>' +
                    '<div class="card-body p-2 small">' +
                        '<div class="d-flex justify-content-between"><span>Labor:</span><span>$' + this.fmtNum(baseLaborRate, 2) + '/hr</span></div>' +
                        '<div class="d-flex justify-content-between"><span>Overhead:</span><span>$' + this.fmtNum(burdenRate, 2) + '/hr</span></div>' +
                        (additionalCosts.length > 0 ? '<div class="d-flex justify-content-between"><span>Additional:</span><span>$' + this.fmtNum(additionalTotal, 2) + '/hr</span></div>' + additionalHtml : '') +
                        '<div class="d-flex justify-content-between font-weight-bold border-top pt-1 mt-1"><span>Total Cost:</span><span>$' + this.fmtNum(totalCost, 2) + '/hr</span></div>' +
                        '<div class="d-flex justify-content-between text-success"><span>Profit (' + this.fmtNum(marginValue, 0) + '% ' + marginType + '):</span><span>+$' + this.fmtNum(margin, 2) + '/hr</span></div>' +
                        '<div class="d-flex justify-content-between text-muted small"><span class="pl-2">(' + this.fmtNum(markup, 1) + '% markup)</span><span></span></div>' +
                        '<div class="d-flex justify-content-between font-weight-bold text-primary border-top pt-1 mt-1"><span><i class="fas fa-tag mr-1"></i>Selling Rate:</span><span>$' + this.fmtNum(sellingRate, 2) + '/hr</span></div>' +
                    '</div>' +
                '</div>' +
                '<button class="btn btn-success btn-block" onclick="BurdenController.confirmSaveRateBuild()"><i class="fas fa-save mr-2"></i>Save Rate Build</button>' +
            '</div>';
            
            // Focus the name input
            setTimeout(function() {
                var input = el('#newRateBuildName');
                if (input) { input.focus(); input.select(); }
            }, 100);
        },
        
        confirmSaveRateBuild: function() {
            var name = el('#newRateBuildName')?.value.trim();
            if (!name) {
                showToast('Please enter a name', 'warning');
                return;
            }
            
            if (!this.pendingRateBuild) return;
            
            if (!this.savedRateBuilds) this.savedRateBuilds = [];
            this.savedRateBuilds.push({
                id: Date.now(),
                name: name,
                ...this.pendingRateBuild
            });
            
            this.pendingRateBuild = null;
            this.persistRateBuilds();
            this.renderSavedComparisons();
            this.closeFlyout();
            showToast('Rate "' + name + '" saved', 'success');
        },

        persistRateBuilds: function() {
            try {
                localStorage.setItem('burdenRateBuilds', JSON.stringify(this.savedRateBuilds || []));
            } catch(e) { console.warn('Could not persist rate builds'); }
        },

        loadPersistedRateBuilds: function() {
            try {
                var saved = localStorage.getItem('burdenRateBuilds');
                if (saved) {
                    this.savedRateBuilds = JSON.parse(saved);
                }
            } catch(e) { console.warn('Could not load rate builds'); }
        },

        renderSavedComparisons: function() {
            var container = el('#savedComparisonsContainer');
            var countEl = el('#comparisonCount');
            if (!container) return;
            
            var builds = this.savedRateBuilds || [];
            if (countEl) countEl.textContent = builds.length;
            
            if (builds.length === 0) {
                container.innerHTML = '<div class="text-center text-muted py-3" style="font-size: 0.8rem;"><i class="fas fa-bookmark mr-2 opacity-50"></i>Save rates to compare scenarios</div>';
                return;
            }
            
            var self = this;
            container.innerHTML = '<div class="srb-comparison-grid">' +
                builds.map(function(b) {
                    var profit = b.sellingRate - b.totalCost;
                    var marginPct = b.totalCost > 0 ? (profit / b.sellingRate * 100) : 0;
                    return '<div class="srb-comparison-card" onclick="BurdenController.showRateBuildFlyout(' + b.id + ')">' +
                        '<button class="srb-comparison-delete" onclick="event.stopPropagation(); BurdenController.removeRateBuild(' + b.id + ')" title="Remove"><i class="fas fa-times"></i></button>' +
                        '<div class="srb-comparison-name">' + escapeHtml(b.name) + '</div>' +
                        '<div class="srb-comparison-rate">$' + self.fmtNum(b.sellingRate, 2) + '<small style="font-size: 0.5em; color: #64748b;">/hr</small></div>' +
                        '<div class="srb-comparison-details">' +
                            'Cost: $' + self.fmtNum(b.totalCost, 2) + ' | ' +
                            'Margin: ' + self.fmtNum(marginPct, 0) + '%' +
                        '</div>' +
                    '</div>';
                }).join('') +
            '</div>';
        },
        
        loadSavedRate: function(id) {
            var build = (this.savedRateBuilds || []).find(function(b) { return b.id === id; });
            if (!build) return;
            
            // Load the saved rate into the builder
            if (el('#rbBaseLaborRate')) el('#rbBaseLaborRate').value = (build.laborRate || build.baseLaborRate || 0).toFixed(2);
            if (el('#rbBurdenRate')) el('#rbBurdenRate').value = (build.burdenRate || 0).toFixed(2);
            if (el('#laborRateDisplay')) el('#laborRateDisplay').textContent = '$' + this.fmtNum(build.laborRate || build.baseLaborRate || 0, 2);
            if (el('#burdenRateDisplay')) el('#burdenRateDisplay').textContent = '$' + this.fmtNum(build.burdenRate || 0, 2);
            
            // Set margin
            var marginPct = build.marginValue || (build.totalCost > 0 ? ((build.sellingRate - build.totalCost) / build.sellingRate * 100) : 0);
            if (el('#marginSliderMain')) el('#marginSliderMain').value = Math.round(marginPct);
            if (el('#marginValueDisplay')) el('#marginValueDisplay').textContent = Math.round(marginPct) + '%';
            if (el('#rbMarginType')) el('#rbMarginType').value = build.marginType || 'margin';
            
            // Rebuild additional costs
            this.rebuildAdditionalCosts(build.additionalCosts);
            
            this.updateRatePreview();
            showToast('Rate loaded: ' + build.name, 'success');
        },

        showRateBuildFlyout: function(id) {
            var build = (this.savedRateBuilds || []).find(function(b) { return b.id === id; });
            if (!build) return;
            
            var self = this;
            this.openFlyout();
            el('#flyoutTitle').innerHTML = '<i class="fas fa-calculator text-primary mr-2"></i>' + escapeHtml(build.name);
            var subtitleEl = el('#flyoutSubtitle');
            if (subtitleEl) {
                subtitleEl.textContent = 'Saved rate comparison';
                subtitleEl.style.display = '';
            }
            el('#flyoutStats').innerHTML = '<span class="badge badge-success"><i class="fas fa-dollar-sign mr-1"></i>$' + this.fmtNum(build.sellingRate, 2) + '/hr</span>';
            
            // Build additional costs display
            var additionalCostsHtml = '';
            if (build.additionalCosts && Array.isArray(build.additionalCosts) && build.additionalCosts.length > 0) {
                additionalCostsHtml = build.additionalCosts.map(function(cost) {
                    var typeLabel = cost.type === 'percent_labor' ? '% Labor' : (cost.type === 'percent_subtotal' ? '% Subtotal' : '$/hr');
                    return '<tr class="text-muted" style="font-size: 0.8rem;"><td class="pl-4 py-1">• ' + escapeHtml(cost.name || 'Cost') + ' <small>(' + cost.value + ' ' + typeLabel + ')</small></td><td class="text-right py-1">$' + self.fmtNum(cost.total || 0, 2) + '</td></tr>';
                }).join('');
            }
            
            // Calculate markup if not stored
            var markup = build.markup || (build.totalCost > 0 ? ((build.sellingRate - build.totalCost) / build.totalCost * 100) : 0);
            var marginPct = build.totalCost > 0 ? ((build.sellingRate - build.totalCost) / build.sellingRate * 100) : 0;
            
            el('#flyoutBody').innerHTML = '<div class="p-3">' +
                '<div class="card mb-3">' +
                    '<div class="card-header py-2"><strong>Rate Breakdown</strong></div>' +
                    '<div class="card-body p-0">' +
                        '<table class="table table-sm mb-0">' +
                            '<tbody>' +
                                '<tr><td>Base Labor</td><td class="text-right">$' + this.fmtNum(build.laborRate || build.baseLaborRate || 0, 2) + '/hr</td></tr>' +
                                '<tr><td>Overhead Burden</td><td class="text-right">$' + this.fmtNum(build.burdenRate || 0, 2) + '/hr</td></tr>' +
                                (build.additionalTotal > 0 ? '<tr><td>Additional Costs</td><td class="text-right">$' + this.fmtNum(build.additionalTotal, 2) + '/hr</td></tr>' : '') +
                                additionalCostsHtml +
                                '<tr class="font-weight-bold table-light"><td>Total Cost</td><td class="text-right">$' + this.fmtNum(build.totalCost, 2) + '/hr</td></tr>' +
                                '<tr><td>Profit (' + this.fmtNum(build.marginValue || marginPct, 0) + '% ' + (build.marginType || 'margin') + ')</td><td class="text-right text-success">+$' + this.fmtNum(build.margin || (build.sellingRate - build.totalCost), 2) + '/hr</td></tr>' +
                                '<tr class="text-muted" style="font-size: 0.8rem;"><td class="pl-4 py-1">' + this.fmtNum(markup, 1) + '% markup</td><td></td></tr>' +
                                '<tr style="background: linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%); border-top: 2px solid #3b82f6;"><td><strong class="text-primary"><i class="fas fa-tag mr-1"></i>Selling Rate</strong></td><td class="text-right"><strong class="text-primary" style="font-size: 1.1rem;">$' + this.fmtNum(build.sellingRate, 2) + '/hr</strong></td></tr>' +
                            '</tbody>' +
                        '</table>' +
                    '</div>' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="small font-weight-bold">Rename</label>' +
                    '<input type="text" class="form-control form-control-sm" id="rateBuildName" value="' + escapeHtml(build.name) + '">' +
                '</div>' +
                '<div class="d-flex gap-2 mt-3">' +
                    '<button class="btn btn-outline-primary btn-sm flex-1" onclick="BurdenController.loadRateBuild(' + id + ')"><i class="fas fa-upload mr-1"></i>Load to Builder</button>' +
                    '<button class="btn btn-outline-secondary btn-sm" onclick="BurdenController.renameRateBuild(' + id + ')"><i class="fas fa-save mr-1"></i>Save Name</button>' +
                '</div>' +
            '</div>';
        },

        loadRateBuild: function(id) {
            var build = (this.savedRateBuilds || []).find(function(b) { return b.id === id; });
            if (!build) return;
            
            // Apply to rate builder
            if (el('#rbBaseLaborRate')) el('#rbBaseLaborRate').value = (build.laborRate || build.baseLaborRate || 35).toFixed(2);
            if (el('#rbBurdenRate')) el('#rbBurdenRate').value = (build.burdenRate || 0).toFixed(2);
            if (el('#rbMarginType')) el('#rbMarginType').value = build.marginType || 'margin';
            if (el('#marginSliderMain')) el('#marginSliderMain').value = build.marginValue || 25;
            if (el('#marginValueDisplay')) el('#marginValueDisplay').textContent = (build.marginValue || 25) + '%';
            if (el('#laborRateDisplay')) el('#laborRateDisplay').textContent = '$' + this.fmtNum(build.laborRate || build.baseLaborRate || 0, 2);
            if (el('#burdenRateDisplay')) el('#burdenRateDisplay').textContent = '$' + this.fmtNum(build.burdenRate || 0, 2);
            
            // Rebuild additional costs
            this.rebuildAdditionalCosts(build.additionalCosts);
            
            this.closeFlyout();
            this.updateRatePreview();
            showToast('Rate build loaded', 'success');
        },
        
        rebuildAdditionalCosts: function(costs) {
            var container = el('#additionalCostsContainer');
            if (!container) return;
            
            // Clear existing rows
            container.innerHTML = '';
            
            // If no costs or empty, add default G&A row
            if (!costs || !Array.isArray(costs) || costs.length === 0) {
                var defaultRow = document.createElement('div');
                defaultRow.className = 'srb-cost-row';
                defaultRow.innerHTML = 
                    '<input type="text" class="srb-cost-input srb-cost-name" value="G&A" placeholder="Name">' +
                    '<select class="srb-cost-input srb-cost-type" onchange="BurdenController.updateRatePreview()">' +
                        '<option value="percent_labor">% of Labor</option>' +
                        '<option value="percent_subtotal">% of Subtotal</option>' +
                        '<option value="flat">$/hr</option>' +
                    '</select>' +
                    '<input type="number" class="srb-cost-input srb-cost-val" value="10" step="0.5" onchange="BurdenController.updateRatePreview()">' +
                    '<div class="srb-cost-result">$0.00/hr</div>' +
                    '<button class="srb-cost-delete" onclick="this.closest(\'.srb-cost-row\').remove(); BurdenController.updateRatePreview();"><i class="fas fa-times"></i></button>';
                container.appendChild(defaultRow);
                return;
            }
            
            // Rebuild rows from saved costs
            costs.forEach(function(cost) {
                var row = document.createElement('div');
                row.className = 'srb-cost-row';
                row.innerHTML = 
                    '<input type="text" class="srb-cost-input srb-cost-name" value="' + escapeHtml(cost.name || 'Cost') + '" placeholder="Name">' +
                    '<select class="srb-cost-input srb-cost-type" onchange="BurdenController.updateRatePreview()">' +
                        '<option value="percent_labor"' + (cost.type === 'percent_labor' ? ' selected' : '') + '>% of Labor</option>' +
                        '<option value="percent_subtotal"' + (cost.type === 'percent_subtotal' ? ' selected' : '') + '>% of Subtotal</option>' +
                        '<option value="flat"' + (cost.type === 'flat' ? ' selected' : '') + '>$/hr</option>' +
                    '</select>' +
                    '<input type="number" class="srb-cost-input srb-cost-val" value="' + (cost.value || 0) + '" step="0.5" onchange="BurdenController.updateRatePreview()">' +
                    '<div class="srb-cost-result">$0.00/hr</div>' +
                    '<button class="srb-cost-delete" onclick="this.closest(\'.srb-cost-row\').remove(); BurdenController.updateRatePreview();"><i class="fas fa-times"></i></button>';
                container.appendChild(row);
            });
        },

        renameRateBuild: function(id) {
            var newName = el('#rateBuildName')?.value.trim();
            if (!newName) return;
            
            var build = (this.savedRateBuilds || []).find(function(b) { return b.id === id; });
            if (build) {
                build.name = newName;
                this.persistRateBuilds();
                this.renderSavedComparisons();
                showToast('Name updated', 'success');
            }
        },

        removeRateBuild: function(id) {
            this.savedRateBuilds = (this.savedRateBuilds || []).filter(function(b) { return b.id !== id; });
            this.persistRateBuilds();
            this.renderSavedComparisons();
        },

        calculateSellingRate: function() {
            var self = this;
            var data = {
                baseLaborRate: parseFloat(el('#sellingBaseLaborRate').value) || 0,
                burdenRate: parseFloat(el('#sellingBurdenRate').value) || 0,
                otherDirectCosts: parseFloat(el('#sellingODC').value) || 0,
                marginType: el('#sellingMarginType').value,
                marginValue: parseFloat(el('#sellingMarginValue').value) || 0
            };

            API.post('burden', { subAction: 'selling_rate', ...data }).then(function(res) {
                var r = res.data || res;
                var b = r.breakdown || {};
                var a = r.analysis || {};
                el('#sellingResults').innerHTML = '<div class="card mb-3"><div class="card-header py-2" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white;"><strong><i class="fas fa-check-circle mr-2"></i>Result</strong></div>' +
                    '<div class="card-body text-center"><div class="h1 font-weight-bold text-success">$' + self.fmtNum(b.sellingRate, 2) + '<small>/hr</small></div>' +
                    '<div class="selling-breakdown mt-3"><div class="sb-row"><span>Base Labor</span><span>$' + self.fmtNum(b.baseLaborRate, 2) + '</span></div>' +
                    '<div class="sb-row"><span>Burden</span><span>$' + self.fmtNum(b.burdenRate, 2) + '</span></div>' +
                    '<div class="sb-row"><span>Other Direct</span><span>$' + self.fmtNum(b.otherDirectCosts, 2) + '</span></div>' +
                    '<div class="sb-row sb-total"><span>Total Cost</span><span>$' + self.fmtNum(b.totalCost, 2) + '</span></div>' +
                    '<div class="sb-row"><span>Margin</span><span class="text-success">+$' + self.fmtNum(b.margin, 2) + '</span></div></div>' +
                    '<hr><div class="selling-analysis"><div class="sa-stat"><span class="sa-value">' + self.fmtNum(a.effectiveMargin, 1) + '%</span><span class="sa-label">Margin</span></div>' +
                    '<div class="sa-stat"><span class="sa-value">' + self.fmtNum(a.effectiveMarkup, 1) + '%</span><span class="sa-label">Markup</span></div>' +
                    '<div class="sa-stat"><span class="sa-value">$' + self.fmtNum(a.breakeven, 2) + '</span><span class="sa-label">Breakeven</span></div></div></div></div>';
            }).catch(function(err) { showToast('Error: ' + (err.message || err), 'danger'); });
        },

        renderHistoryTab: function() {
            var container = el('#burdenHistoryContent');
            if (!container) return;
            
            // Show skeleton while loading
            if (this.isLoading || !this.latestData) {
                container.innerHTML = '<div class="p-3">' +
                    '<div class="row mb-3">' +
                        '<div class="col-md-3"><div class="kpi-skeleton skeleton-loading"><div class="value"></div><div class="label"></div></div></div>' +
                        '<div class="col-md-3"><div class="kpi-skeleton skeleton-loading"><div class="value"></div><div class="label"></div></div></div>' +
                        '<div class="col-md-3"><div class="kpi-skeleton skeleton-loading"><div class="value"></div><div class="label"></div></div></div>' +
                        '<div class="col-md-3"><div class="kpi-skeleton skeleton-loading"><div class="value"></div><div class="label"></div></div></div>' +
                    '</div>' +
                    '<div class="row">' +
                        '<div class="col-12"><div class="chart-skeleton skeleton-loading" style="height: 300px;"></div></div>' +
                    '</div>' +
                    '<div class="mt-3 category-table-skeleton">' +
                        [1,2,3,4,5,6].map(function() {
                            return '<div class="skeleton-row">' +
                                '<div class="skeleton-cell name skeleton-loading"></div>' +
                                '<div class="skeleton-cell amount skeleton-loading"></div>' +
                                '<div class="skeleton-cell amount skeleton-loading"></div>' +
                                '<div class="skeleton-cell rate skeleton-loading"></div>' +
                            '</div>';
                        }).join('') +
                    '</div>' +
                '</div>';
                return;
            }

            var self = this;
            var history = this.latestData.history || {};
            var forecast = this.latestData.forecast || {};
            var periods = history.periods || [];
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            
            // Store for chart toggling
            this.trendViewMode = this.trendViewMode || 'composite';
            
            // Calculate insights
            var currentRate = periods.length > 0 ? periods[periods.length - 1].totalRate || 0 : 0;
            var prevRate = periods.length > 1 ? periods[periods.length - 2].totalRate || 0 : currentRate;
            var rateChange = prevRate > 0 ? ((currentRate - prevRate) / prevRate * 100) : 0;
            var avgRate = periods.length > 0 ? periods.reduce(function(s, p) { return s + (p.totalRate || 0); }, 0) / periods.length : 0;
            var minRate = periods.length > 0 ? Math.min.apply(null, periods.map(function(p) { return p.totalRate || 0; })) : 0;
            var maxRate = periods.length > 0 ? Math.max.apply(null, periods.map(function(p) { return p.totalRate || 0; })) : 0;
            
            // Find biggest movers - use categoryHistory from response
            var categoryHistory = this.latestData.categoryHistory || {};
            var categoryChanges = categories.map(function(cat) {
                var catHist = categoryHistory[cat.id] || {};
                var hist = catHist.periods || [];
                if (hist.length < 2) return { cat: cat, change: 0, curr: cat.totalBurden || 0, prev: 0 };
                var curr = hist[hist.length - 1]?.rate || 0;
                var prev = hist[hist.length - 2]?.rate || 0;
                return { cat: cat, change: prev > 0 ? ((curr - prev) / prev * 100) : 0, curr: curr, prev: prev };
            }).sort(function(a, b) { return Math.abs(b.change) - Math.abs(a.change); });

            container.innerHTML = 
                // Inline styles for new trend components - COMPACT version
                '<style>' +
                    '.category-movers-grid { display: flex; flex-direction: column; gap: 6px; }' +
                    '.mover-item { padding: 4px 0; border-bottom: 1px solid #f0f0f0; }' +
                    '.mover-item:last-child { border-bottom: none; padding-bottom: 0; }' +
                    '.mover-header { display: flex; align-items: center; margin-bottom: 3px; }' +
                    '.mover-rank { font-weight: 600; color: #9ca3af; font-size: 10px; min-width: 22px; }' +
                    '.mover-name { flex: 1; font-weight: 500; font-size: 12px; display: flex; align-items: center; gap: 6px; }' +
                    '.mover-name .category-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }' +
                    '.mover-rate { font-weight: 600; color: #374151; font-size: 12px; }' +
                    '.mover-bar-container { display: flex; align-items: center; gap: 8px; }' +
                    '.mover-bar { height: 4px; border-radius: 2px; transition: width 0.3s ease; }' +
                    '.mover-bar-success { background: linear-gradient(90deg, #10b981, #34d399); }' +
                    '.mover-bar-danger { background: linear-gradient(90deg, #ef4444, #f87171); }' +
                    '.mover-bar-neutral { background: #e5e7eb; }' +
                    '.mover-change { font-size: 11px; font-weight: 600; white-space: nowrap; }' +
                    '.text-neutral { color: #9ca3af; }' +
                    
                    '.dept-scorecard-grid { display: flex; flex-direction: column; gap: 6px; }' +
                    '.dept-score-item { display: flex; align-items: center; gap: 8px; padding: 3px 0; }' +
                    '.dept-score-left { display: flex; align-items: center; gap: 6px; min-width: 110px; }' +
                    '.dept-medal { font-size: 13px; }' +
                    '.dept-medal-gold { color: #f59e0b; }' +
                    '.dept-medal-silver { color: #9ca3af; }' +
                    '.dept-medal-bronze { color: #d97706; }' +
                    '.dept-rank { width: 16px; height: 16px; background: #f3f4f6; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: #6b7280; }' +
                    '.dept-score-name { font-weight: 500; font-size: 12px; color: #374151; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
                    '.dept-score-middle { flex: 1; }' +
                    '.dept-bar-bg { height: 6px; background: #f3f4f6; border-radius: 3px; overflow: hidden; }' +
                    '.dept-bar-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); border-radius: 3px; transition: width 0.4s ease; }' +
                    '.dept-score-right { display: flex; flex-direction: column; align-items: flex-end; min-width: 60px; }' +
                    '.dept-score-rate { font-weight: 600; font-size: 12px; color: #1f2937; line-height: 1.2; }' +
                    '.dept-score-change { font-size: 10px; font-weight: 500; line-height: 1.2; }' +
                    
                    '.trends-bottom-row .card { box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; }' +
                    '.trends-bottom-row .card-header { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-bottom: 1px solid #e5e7eb; padding: 8px 12px !important; }' +
                    '.trends-bottom-row .card-body { padding: 10px 12px !important; }' +
                    '.trends-bottom-row .badge-light { background: #fff; border: 1px solid #e5e7eb; color: #6b7280; font-weight: 500; font-size: 10px; }' +
                '</style>' +
                
                // Key Metrics Row - Using global KPI card style
                '<div class="cf-kpi-row mb-4">' +
                    '<div class="cf-kpi-card">' +
                        '<div class="icon-wrapper bg-primary-soft"><i class="fas fa-dollar-sign text-primary"></i></div>' +
                        '<div class="kpi-content">' +
                            '<div class="kpi-value">$' + this.fmtNum(currentRate, 2) + '</div>' +
                            '<div class="kpi-label">Current Rate</div>' +
                            '<div class="kpi-sub ' + (rateChange >= 0 ? 'text-danger' : 'text-success') + '">' +
                                '<i class="fas fa-arrow-' + (rateChange >= 0 ? 'up' : 'down') + ' mr-1"></i>' +
                                (rateChange >= 0 ? '+' : '') + this.fmtNum(rateChange, 1) + '% vs prior' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="cf-kpi-card">' +
                        '<div class="icon-wrapper bg-info-soft"><i class="fas fa-chart-line text-info"></i></div>' +
                        '<div class="kpi-content">' +
                            '<div class="kpi-value">$' + this.fmtNum(avgRate, 2) + '</div>' +
                            '<div class="kpi-label">Period Average</div>' +
                            '<div class="kpi-sub">' + periods.length + ' periods</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="cf-kpi-card">' +
                        '<div class="icon-wrapper bg-warning-soft"><i class="fas fa-arrows-alt-v text-warning"></i></div>' +
                        '<div class="kpi-content">' +
                            '<div class="kpi-value">$' + this.fmtNum(maxRate - minRate, 2) + '</div>' +
                            '<div class="kpi-label">Rate Variance</div>' +
                            '<div class="kpi-sub">$' + this.fmtNum(minRate, 2) + ' - $' + this.fmtNum(maxRate, 2) + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="cf-kpi-card">' +
                        '<div class="icon-wrapper bg-purple-soft"><i class="fas fa-percentage text-purple"></i></div>' +
                        '<div class="kpi-content">' +
                            '<div class="kpi-value">' + this.fmtNum(avgRate > 0 ? ((maxRate - minRate) / avgRate * 100) : 0, 1) + '%</div>' +
                            '<div class="kpi-label">Volatility</div>' +
                            '<div class="kpi-sub">Range / Average</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                // Main Trend Chart - Combined History & Forecast
                '<div class="card mb-4">' +
                    '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                        '<strong><i class="fas fa-chart-area text-primary mr-2"></i>Rate Trend & Forecast</strong>' +
                        '<div class="d-flex align-items-center">' +
                            '<div class="custom-control custom-switch mr-3">' +
                                '<input type="checkbox" class="custom-control-input" id="showForecast" checked onchange="BurdenController.renderMainTrendChart()">' +
                                '<label class="custom-control-label small" for="showForecast">Show Forecast</label>' +
                            '</div>' +
                            '<div class="btn-group btn-group-sm" id="trendViewToggle">' +
                                '<button class="btn btn-outline-secondary' + (this.trendViewMode === 'composite' ? ' active' : '') + '" onclick="BurdenController.setTrendView(\'composite\')">Composite</button>' +
                                '<button class="btn btn-outline-secondary' + (this.trendViewMode === 'department' ? ' active' : '') + '" onclick="BurdenController.setTrendView(\'department\')">By Dept</button>' +
                                '<button class="btn btn-outline-secondary' + (this.trendViewMode === 'stacked' ? ' active' : '') + '" onclick="BurdenController.setTrendView(\'stacked\')">By Category</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="card-body p-2">' +
                        '<div id="mainTrendChart" style="height: 320px;"></div>' +
                    '</div>' +
                '</div>' +
                
                '<div class="row">' +
                    // Historical Data Table - By Department
                    '<div class="col-12">' +
                        '<div class="card mb-4">' +
                            '<div class="card-header py-2"><strong><i class="fas fa-history text-info mr-2"></i>Period History by Department</strong></div>' +
                            '<div class="card-body p-0" style="overflow-x: auto;">' +
                                '<table class="table table-sm mb-0">' +
                                    '<thead class="thead-light sticky-top">' +
                                        '<tr>' +
                                            '<th>Period</th>' +
                                            depts.slice(0, 6).map(function(d) {
                                                return '<th class="text-right">' + escapeHtml(self.truncateText(d.name, 12)) + '</th>';
                                            }).join('') +
                                            '<th class="text-right font-weight-bold" style="background: #e2e8f0;">Total</th>' +
                                            '<th class="text-right">Δ</th>' +
                                        '</tr>' +
                                    '</thead>' +
                                    '<tbody>' +
                                        periods.slice().reverse().map(function(p, i, arr) {
                                            var prevP = arr[i + 1];
                                            // Total rate is calculated independently (from period data), NOT sum of depts
                                            var totalRate = p.totalRate || 0;
                                            var prevTotalRate = prevP ? (prevP.totalRate || 0) : 0;
                                            var change = prevTotalRate > 0 ? ((totalRate - prevTotalRate) / prevTotalRate * 100) : 0;
                                            var isUp = change > 0;
                                            
                                            // Get department data for this period - structure is deptData[id] = { name, hours, rate }
                                            var deptData = p.deptData || {};
                                            var hasRealDeptExpense = p.hasRealDeptExpense !== false;
                                            
                                            return '<tr>' +
                                                '<td class="font-weight-medium">' + (p.label || p.period) + '</td>' +
                                                depts.slice(0, 6).map(function(d) {
                                                    var deptInfo = deptData[d.id] || deptData[String(d.id)] || {};
                                                    var deptRate = deptInfo.rate || 0;
                                                    var isAllocated = deptInfo.isAllocated || !hasRealDeptExpense;
                                                    
                                                    // Show rate with indicator if allocated vs actual
                                                    var displayVal = '';
                                                    if (deptRate > 0) {
                                                        if (isAllocated) {
                                                            displayVal = '<span class="text-muted" title="Allocated proportionally by hours">$' + self.fmtNum(deptRate, 2) + '</span>';
                                                        } else {
                                                            displayVal = '$' + self.fmtNum(deptRate, 2);
                                                        }
                                                    } else {
                                                        displayVal = '<span class="text-light">--</span>';
                                                    }
                                                    
                                                    return '<td class="text-right">' + displayVal + '</td>';
                                                }).join('') +
                                                '<td class="text-right font-weight-bold" style="background: #f8fafc;">$' + self.fmtNum(totalRate, 2) + '</td>' +
                                                '<td class="text-right ' + (change === 0 ? 'text-muted' : isUp ? 'text-danger' : 'text-success') + '">' +
                                                    (i === arr.length - 1 ? '-' : '<i class="fas fa-caret-' + (isUp ? 'up' : 'down') + '"></i> ' + (isUp ? '+' : '') + self.fmtNum(change, 1) + '%') +
                                                '</td>' +
                                            '</tr>';
                                        }).join('') +
                                    '</tbody>' +
                                '</table>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                '<div class="row trends-bottom-row" style="display: flex; align-items: stretch;">' +
                    // Left: Category Insights - Visual breakdown
                    '<div class="col-lg-6 d-flex">' +
                        '<div class="card mb-4 flex-fill">' +
                            '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                '<strong><i class="fas fa-fire text-danger mr-2"></i>Category Movers</strong>' +
                                '<span class="badge badge-light">vs Prior Period</span>' +
                            '</div>' +
                            '<div class="card-body">' +
                                '<div class="category-movers-grid">' +
                                    categoryChanges.slice(0, 6).map(function(item, idx) {
                                        var isUp = item.change > 0;
                                        var changeAbs = Math.abs(item.change);
                                        var barWidth = Math.min(changeAbs * 2, 100); // Scale for visual
                                        var direction = isUp ? 'increase' : 'decrease';
                                        var colorClass = item.change === 0 ? 'neutral' : (isUp ? 'danger' : 'success');
                                        var changeIcon = item.change === 0 ? 'minus' : (isUp ? 'arrow-up' : 'arrow-down');
                                        
                                        return '<div class="mover-item">' +
                                            '<div class="mover-header">' +
                                                '<span class="mover-rank">#' + (idx + 1) + '</span>' +
                                                '<span class="mover-name"><span class="category-dot" style="background: ' + item.cat.color + ';"></span>' + escapeHtml(item.cat.label) + '</span>' +
                                                '<span class="mover-rate">$' + self.fmtNum(item.curr, 2) + '</span>' +
                                            '</div>' +
                                            '<div class="mover-bar-container">' +
                                                '<div class="mover-bar mover-bar-' + colorClass + '" style="width: ' + barWidth + '%;"></div>' +
                                                '<span class="mover-change text-' + colorClass + '">' +
                                                    '<i class="fas fa-' + changeIcon + '"></i> ' +
                                                    (item.change === 0 ? 'No change' : (isUp ? '+' : '') + self.fmtNum(item.change, 1) + '%') +
                                                '</span>' +
                                            '</div>' +
                                        '</div>';
                                    }).join('') +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    // Right: Department Scorecard
                    '<div class="col-lg-6 d-flex">' +
                        '<div class="card mb-4 flex-fill">' +
                            '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                '<strong><i class="fas fa-medal text-warning mr-2"></i>Department Scorecard</strong>' +
                                '<span class="badge badge-light">Burden Rate Ranking</span>' +
                            '</div>' +
                            '<div class="card-body">' +
                                (function() {
                                    var depts = (self.latestData.meta && self.latestData.meta.departments) || [];
                                    var currentPeriod = periods[periods.length - 1] || {};
                                    var prevPeriod = periods[periods.length - 2] || {};
                                    var deptData = currentPeriod.deptData || {};
                                    var prevDeptData = prevPeriod.deptData || {};
                                    
                                    // Build dept stats with current and previous rates
                                    var deptStats = depts.slice(0, 6).map(function(d) {
                                        var curr = deptData[d.id] || deptData[String(d.id)] || {};
                                        var prev = prevDeptData[d.id] || prevDeptData[String(d.id)] || {};
                                        var currRate = curr.rate || 0;
                                        var prevRate = prev.rate || 0;
                                        var change = prevRate > 0 ? ((currRate - prevRate) / prevRate * 100) : 0;
                                        return { dept: d, rate: currRate, change: change, hours: curr.hours || 0 };
                                    }).sort(function(a, b) { return a.rate - b.rate; }); // Sort by rate (lowest = best)
                                    
                                    var maxRate = Math.max.apply(null, deptStats.map(function(d) { return d.rate || 1; }));
                                    
                                    return '<div class="dept-scorecard-grid">' +
                                        deptStats.map(function(item, idx) {
                                            var isUp = item.change > 0;
                                            var barWidth = maxRate > 0 ? (item.rate / maxRate * 100) : 0;
                                            var medalClass = idx === 0 ? 'gold' : (idx === 1 ? 'silver' : (idx === 2 ? 'bronze' : ''));
                                            var medalIcon = idx < 3 ? '<i class="fas fa-medal dept-medal dept-medal-' + medalClass + '"></i>' : '<span class="dept-rank">' + (idx + 1) + '</span>';
                                            
                                            return '<div class="dept-score-item">' +
                                                '<div class="dept-score-left">' +
                                                    medalIcon +
                                                    '<span class="dept-score-name">' + escapeHtml(item.dept.name) + '</span>' +
                                                '</div>' +
                                                '<div class="dept-score-middle">' +
                                                    '<div class="dept-bar-bg">' +
                                                        '<div class="dept-bar-fill" style="width: ' + barWidth + '%;"></div>' +
                                                    '</div>' +
                                                '</div>' +
                                                '<div class="dept-score-right">' +
                                                    '<span class="dept-score-rate">$' + self.fmtNum(item.rate, 2) + '</span>' +
                                                    '<span class="dept-score-change ' + (item.change === 0 ? 'text-muted' : (isUp ? 'text-danger' : 'text-success')) + '">' +
                                                        (item.change === 0 ? '-' : '<i class="fas fa-caret-' + (isUp ? 'up' : 'down') + '"></i> ' + self.fmtNum(Math.abs(item.change), 1) + '%') +
                                                    '</span>' +
                                                '</div>' +
                                            '</div>';
                                        }).join('') +
                                    '</div>';
                                })() +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';

            this.renderMainTrendChart();
        },

        setTrendView: function(view) {
            this.trendViewMode = view;
            // Update button states
            var btns = document.querySelectorAll('#trendViewToggle .btn');
            btns.forEach(function(btn) {
                btn.classList.remove('active');
                var text = btn.textContent.toLowerCase();
                if ((view === 'composite' && text.includes('composite')) ||
                    (view === 'department' && text.includes('dept')) ||
                    (view === 'stacked' && text.includes('category'))) {
                    btn.classList.add('active');
                }
            });
            this.renderMainTrendChart();
        },

        renderMainTrendChart: function() {
            var container = el('#mainTrendChart');
            if (!container) return;

            var self = this;
            var history = this.latestData.history || {};
            var forecast = this.latestData.forecast || {};
            var periods = history.periods || [];
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var showForecast = el('#showForecast')?.checked !== false;
            
            if (periods.length === 0) {
                container.innerHTML = '<div class="text-center text-muted py-5">No historical data available</div>';
                return;
            }

            var traces = [];
            var currentRate = periods.length > 0 ? periods[periods.length - 1].totalRate : 0;
            
            // Generate forecast periods (next 6 months)
            var forecastPeriods = [];
            var forecastRates = [];
            if (showForecast) {
                var lastPeriod = periods[periods.length - 1];
                var baseDate = new Date();
                for (var i = 1; i <= 6; i++) {
                    var forecastDate = new Date(baseDate);
                    forecastDate.setMonth(forecastDate.getMonth() + i);
                    var label = forecastDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                    forecastPeriods.push(label);
                    // Simple linear forecast with slight variance
                    var forecastRate = currentRate * (1 + (forecast.trendPct || 0) / 100 * i / 12);
                    forecastRates.push(forecastRate);
                }
            }
            
            if (this.trendViewMode === 'department') {
                // Line chart by department
                var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
                var deptRates = history.deptRates || {};
                var colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
                
                // If no deptRates data, try to build from periods' deptData
                var hasDeptRatesData = Object.keys(deptRates).length > 0;
                
                depts.slice(0, 8).forEach(function(d, i) {
                    var deptTrend = [];
                    
                    if (hasDeptRatesData) {
                        // Get trend from deptRates which has { name, rates: [{label, rate}] }
                        var deptRateData = deptRates[d.id] || deptRates[String(d.id)] || {};
                        var deptRatesArray = deptRateData.rates || [];
                        if (deptRatesArray.length > 0) {
                            deptTrend = deptRatesArray.map(function(r) { return r.rate || 0; });
                        }
                    }
                    
                    // Fall back to extracting from periods' deptData if no rates found
                    if (deptTrend.length === 0 || deptTrend.every(function(r) { return r === 0; })) {
                        deptTrend = periods.map(function(p) { 
                            var deptData = p.deptData || {};
                            var deptInfo = deptData[d.id] || deptData[String(d.id)] || {};
                            return deptInfo.rate || 0;
                        });
                    }
                    
                    // Skip departments with no data
                    var hasData = deptTrend.some(function(r) { return r > 0; });
                    if (!hasData) return;
                    
                    var historyLabels = periods.map(function(p) { return p.label; });
                    
                    // Calculate department-specific trend for forecast
                    var lastRate = deptTrend[deptTrend.length - 1] || 0;
                    var firstRate = deptTrend[0] || lastRate;
                    var deptTrendPct = firstRate > 0 ? ((lastRate - firstRate) / firstRate * 100) : 0;
                    
                    // Add historical trace
                    traces.push({
                        x: historyLabels,
                        y: deptTrend.slice(0, periods.length),
                        type: 'scatter',
                        mode: 'lines+markers',
                        name: d.name,
                        line: { color: colors[i % colors.length], width: 2 },
                        marker: { size: 5 },
                        hovertemplate: '%{y:$.2f}<extra>' + escapeHtml(d.name) + '</extra>'
                    });
                    
                    // Add forecast for this department if enabled - use DEPT-SPECIFIC trend
                    if (showForecast && forecastPeriods.length > 0 && lastRate > 0) {
                        var deptForecastRates = forecastPeriods.map(function(_, idx) {
                            // Use department-specific trend percentage
                            return lastRate * (1 + deptTrendPct / 100 * (idx + 1) / 12);
                        });
                        
                        var connectLabels = [historyLabels[historyLabels.length - 1]].concat(forecastPeriods);
                        var connectRates = [lastRate].concat(deptForecastRates);
                        
                        traces.push({
                            x: connectLabels,
                            y: connectRates,
                            type: 'scatter',
                            mode: 'lines',
                            name: d.name + ' (Forecast)',
                            line: { color: colors[i % colors.length], width: 2, dash: 'dash' },
                            showlegend: false,
                            hovertemplate: '%{y:$.2f}<extra>' + escapeHtml(d.name) + ' forecast</extra>'
                        });
                    }
                });
            } else if (this.trendViewMode === 'stacked' && categories.length > 0) {
                // Stacked area chart by category - use categoryHistory from response
                var categoryHistory = self.latestData.categoryHistory || {};
                categories.forEach(function(cat) {
                    var catHist = categoryHistory[cat.id] || {};
                    var hist = catHist.periods || [];
                    if (hist.length === 0) {
                        // Use current rate for all periods as fallback
                        hist = periods.map(function(p) { return { label: p.label, rate: cat.totalBurden || 0 }; });
                    }
                    traces.push({
                        x: hist.map(function(h) { return h.label || h.period; }),
                        y: hist.map(function(h) { return h.rate || 0; }),
                        type: 'scatter',
                        mode: 'lines',
                        fill: 'tonexty',
                        name: cat.label,
                        line: { color: cat.color, width: 1 },
                        stackgroup: 'one',
                        hovertemplate: '%{y:$.2f}<extra>' + escapeHtml(cat.label) + '</extra>'
                    });
                });
            } else {
                // Composite line chart with history
                var historyLabels = periods.map(function(p) { return p.label; });
                var historyRates = periods.map(function(p) { return p.totalRate || 0; });
                
                traces.push({
                    x: historyLabels,
                    y: historyRates,
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: 'Historical',
                    fill: 'tozeroy',
                    line: { color: '#3b82f6', width: 3, shape: 'spline' },
                    marker: { size: 8, color: '#3b82f6' },
                    fillcolor: 'rgba(59, 130, 246, 0.1)',
                    hovertemplate: '%{y:$.2f}<extra>Composite Rate</extra>'
                });
                
                // Add forecast trace if enabled
                if (showForecast && forecastPeriods.length > 0) {
                    // Add connecting line from last history to first forecast
                    var connectLabels = [historyLabels[historyLabels.length - 1]].concat(forecastPeriods);
                    var connectRates = [historyRates[historyRates.length - 1]].concat(forecastRates);
                    
                    traces.push({
                        x: connectLabels,
                        y: connectRates,
                        type: 'scatter',
                        mode: 'lines+markers',
                        name: 'Forecast',
                        line: { color: '#f59e0b', width: 3, dash: 'dash', shape: 'spline' },
                        marker: { size: 8, color: '#f59e0b', symbol: 'diamond' },
                        fill: 'tozeroy',
                        fillcolor: 'rgba(245, 158, 11, 0.05)',
                        hovertemplate: '%{y:$.2f}<extra>Forecast</extra>'
                    });
                    
                    // Add confidence band
                    var upperBand = connectRates.map(function(r, i) { return r * (1 + i * 0.02); });
                    var lowerBand = connectRates.map(function(r, i) { return r * (1 - i * 0.02); });
                    
                    traces.push({
                        x: connectLabels,
                        y: upperBand,
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Upper Bound',
                        line: { color: 'rgba(245, 158, 11, 0.3)', width: 0 },
                        showlegend: false,
                        hoverinfo: 'skip'
                    });
                    
                    traces.push({
                        x: connectLabels,
                        y: lowerBand,
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Lower Bound',
                        fill: 'tonexty',
                        fillcolor: 'rgba(245, 158, 11, 0.1)',
                        line: { color: 'rgba(245, 158, 11, 0.3)', width: 0 },
                        showlegend: false,
                        hoverinfo: 'skip'
                    });
                }
            }
            
            // Add "Now" annotation
            var shapes = [];
            var annotations = [];
            if (showForecast && this.trendViewMode === 'composite') {
                var lastHistoryLabel = periods[periods.length - 1].label;
                annotations.push({
                    x: lastHistoryLabel,
                    y: currentRate,
                    xref: 'x',
                    yref: 'y',
                    text: 'Now',
                    showarrow: true,
                    arrowhead: 2,
                    ax: 0,
                    ay: -30,
                    font: { size: 11, color: '#3b82f6' }
                });
            }

            var layout = {
                margin: { t: 20, b: 50, l: 60, r: 20 },
                xaxis: { showgrid: false },
                yaxis: { title: '$/hr', tickprefix: '$', gridcolor: '#f0f0f0' },
                showlegend: true,
                legend: { orientation: 'h', y: -0.15, x: 0.5, xanchor: 'center' },
                hovermode: 'x unified',
                shapes: shapes,
                annotations: annotations
            };

            Plotly.newPlot(container, traces, layout, { responsive: true, displayModeBar: false });
        },

        renderCategorySparklines: function() {
            // Legacy - replaced by inline category data in trends tab
        },

        renderDeptComparisonChart: function() {
            var container = el('#deptComparisonChart');
            if (!container) return;

            var self = this;
            var summary = this.latestData.summary || {};
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var totals = summary.totals || {};
            var burdenByDept = totals.burden || {};

            if (depts.length === 0) {
                container.innerHTML = '<div class="text-center text-muted py-5">No department data</div>';
                return;
            }

            var colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
            var deptData = depts.map(function(d, i) {
                var deptId = String(d.id);
                var rate = burdenByDept[deptId] || burdenByDept[d.id] || 
                           (summary.compositeByDept && (summary.compositeByDept[deptId] || summary.compositeByDept[d.id])) || 0;
                return { name: d.name, rate: rate, color: colors[i % colors.length] };
            }).sort(function(a, b) { return b.rate - a.rate; });

            var trace = {
                x: deptData.map(function(d) { return d.rate; }),
                y: deptData.map(function(d) { return d.name; }),
                type: 'bar',
                orientation: 'h',
                marker: { color: deptData.map(function(d) { return d.color; }) },
                text: deptData.map(function(d) { return '$' + self.fmtNum(d.rate, 2); }),
                textposition: 'outside'
            };

            Plotly.newPlot(container, [trace], {
                margin: { t: 5, b: 30, l: 100, r: 50 },
                xaxis: { tickprefix: '$' },
                yaxis: { automargin: true },
                showlegend: false
            }, { responsive: true, displayModeBar: false });
        },

        renderForecastMiniChart: function() {
            var container = el('#forecastMiniChart');
            if (!container) return;

            var self = this;
            var history = this.latestData.history || {};
            var forecast = this.latestData.forecast || {};
            var periods = history.periods || [];
            var forecasts = forecast.forecasts || [];

            // Get last 3 historical periods
            var histPeriods = periods.slice(-3);
            var histX = histPeriods.map(function(p) { return p.label; });
            var histY = histPeriods.map(function(p) { return p.totalRate || 0; });

            // Get forecast periods
            var forecastX = forecasts.slice(0, 6).map(function(f) { return f.monthLabel || f.label; });
            var forecastY = forecasts.slice(0, 6).map(function(f) { return f.compositeRate || f.rate || 0; });

            var traces = [];
            
            // Historical line
            if (histX.length > 0) {
                traces.push({
                    x: histX,
                    y: histY,
                    type: 'scatter',
                    mode: 'lines+markers',
                    line: { color: '#3b82f6', width: 2 },
                    marker: { size: 6 },
                    name: 'Historical'
                });
            }

            // Forecast line (connect from last historical point)
            if (forecastX.length > 0) {
                var connectX = histX.length > 0 ? [histX[histX.length - 1]].concat(forecastX) : forecastX;
                var connectY = histY.length > 0 ? [histY[histY.length - 1]].concat(forecastY) : forecastY;
                
                traces.push({
                    x: connectX,
                    y: connectY,
                    type: 'scatter',
                    mode: 'lines+markers',
                    line: { color: '#f97316', width: 2, dash: 'dot' },
                    marker: { size: 6 },
                    name: 'Forecast'
                });
            }

            if (traces.length === 0) {
                container.innerHTML = '<div class="text-center text-muted py-4">No forecast data</div>';
                return;
            }

            Plotly.newPlot(container, traces, {
                margin: { t: 5, b: 30, l: 50, r: 10 },
                xaxis: { showgrid: false, tickfont: { size: 10 } },
                yaxis: { tickprefix: '$', tickfont: { size: 10 } },
                showlegend: false,
                hovermode: 'x unified'
            }, { responsive: true, displayModeBar: false });
        },

        // Legacy functions - kept for compatibility
        renderForecastTable: function() {},
        renderHistoryTrendChart: function() {},
        renderForecastChart: function() {},

        renderUnbilledTab: function() {
            var container = el('#burdenUnbilledContent');
            if (!container) return;
            
            // Show skeleton while loading
            if (this.isLoading || !this.latestData) {
                container.innerHTML = '<div class="p-3">' +
                    '<div class="row mb-4">' +
                        '<div class="col-md-4"><div class="kpi-skeleton skeleton-loading"><div class="value"></div><div class="label"></div></div></div>' +
                        '<div class="col-md-4"><div class="kpi-skeleton skeleton-loading"><div class="value"></div><div class="label"></div></div></div>' +
                        '<div class="col-md-4"><div class="kpi-skeleton skeleton-loading"><div class="value"></div><div class="label"></div></div></div>' +
                    '</div>' +
                    '<div class="category-table-skeleton">' +
                        [1,2,3,4,5].map(function() {
                            return '<div class="skeleton-row">' +
                                '<div class="skeleton-cell name skeleton-loading"></div>' +
                                '<div class="skeleton-cell amount skeleton-loading"></div>' +
                                '<div class="skeleton-cell amount skeleton-loading"></div>' +
                                '<div class="skeleton-cell rate skeleton-loading"></div>' +
                            '</div>';
                        }).join('') +
                    '</div>' +
                '</div>';
                return;
            }

            var unbilled = this.latestData.unbilledDetail;
            if (!unbilled) { 
                container.innerHTML = '<div class="text-center text-muted py-5"><i class="fas fa-info-circle fa-3x mb-3 d-block"></i><p>Unbilled hours tracking disabled</p></div>'; 
                return; 
            }

            var depts = unbilled.departments || [];
            var totals = unbilled.totals || {};
            var self = this;

            container.innerHTML = '<div class="row mb-4">' +
                '<div class="col-md-4"><div class="card bg-light"><div class="card-body text-center">' +
                    '<div class="h2 mb-0">' + this.fmtNum(totals.hours || 0, 0) + '</div>' +
                    '<div class="text-muted small">Unbilled Hours</div>' +
                '</div></div></div>' +
                '<div class="col-md-4"><div class="card bg-light"><div class="card-body text-center">' +
                    '<div class="h2 mb-0">' + this.formatCurrency(totals.cost || 0) + '</div>' +
                    '<div class="text-muted small">Total Cost</div>' +
                '</div></div></div>' +
                '<div class="col-md-4"><div class="card bg-light"><div class="card-body text-center">' +
                    '<div class="h2 mb-0">' + ((unbilled.laborOverheadFactor - 1) * 100).toFixed(0) + '%</div>' +
                    '<div class="text-muted small">Overhead Factor</div>' +
                '</div></div></div>' +
            '</div>' +
            '<h6 class="text-muted text-uppercase mb-3">By Department</h6>' +
            '<div class="unbilled-depts">' + 
                depts.map(function(d) {
                    return '<div class="unbilled-dept-card">' +
                        '<div class="udc-header" onclick="jQuery(this).next().slideToggle()">' +
                            '<div class="udc-name">' + escapeHtml(d.name) + '</div>' +
                            '<div class="udc-stats">' +
                                '<span>' + self.fmtNum(d.totalHours, 0) + ' hrs</span>' +
                                '<span>' + self.formatCurrency(d.totalCost) + '</span>' +
                            '</div>' +
                            '<i class="fas fa-chevron-down"></i>' +
                        '</div>' +
                        '<div class="udc-body" style="display:none;">' +
                            '<table class="table table-sm mb-0">' +
                                '<thead class="thead-light"><tr><th>Employee</th><th class="text-right">Hours</th><th class="text-right">Rate</th><th class="text-right">Cost</th></tr></thead>' +
                                '<tbody>' +
                                    d.employees.slice(0, 10).map(function(e) { 
                                        return '<tr>' +
                                            '<td>' + escapeHtml(e.name) + '</td>' +
                                            '<td class="text-right">' + self.fmtNum(e.hours, 1) + '</td>' +
                                            '<td class="text-right">' + self.formatCurrency(e.hourlyCost) + '</td>' +
                                            '<td class="text-right font-weight-bold">' + self.formatCurrency(e.totalCost) + '</td>' +
                                        '</tr>'; 
                                    }).join('') +
                                '</tbody>' +
                            '</table>' +
                        '</div>' +
                    '</div>';
                }).join('') +
            '</div>';
        },

        renderConfigTab: function() {
            var container = el('#burdenConfigContent');
            if (!container) return;
            
            // Show skeleton while loading
            if (this.isLoading || !this.latestData) {
                container.innerHTML = '<div class="p-3">' +
                    '<div class="row">' +
                        '<div class="col-md-6"><div class="chart-skeleton skeleton-loading" style="height: 200px;"></div></div>' +
                        '<div class="col-md-6"><div class="chart-skeleton skeleton-loading" style="height: 200px;"></div></div>' +
                    '</div>' +
                '</div>';
                return;
            }

            var self = this;
            var meta = this.latestData.meta || {};
            var config = meta.config || {};
            var compositeConfig = config.compositeRate || { method: 'sum' };
            var profiles = meta.profiles || [];
            var activeProfileId = meta.activeProfileId || 'job_costing';

            // Configuration tab with internal navigation
            container.innerHTML = 
                // Sub-tabs Navigation
                '<ul class="nav nav-pills nav-sm mb-3" id="configSubTabs">' +
                    '<li class="nav-item"><a class="nav-link active py-1 px-2" data-toggle="tab" href="#cfg-general"><i class="fas fa-sliders-h mr-1"></i>General</a></li>' +
                    '<li class="nav-item"><a class="nav-link py-1 px-2" data-toggle="tab" href="#cfg-advanced"><i class="fas fa-cogs mr-1"></i>Advanced</a></li>' +
                    '<li class="nav-item"><a class="nav-link py-1 px-2" data-toggle="tab" href="#cfg-tools"><i class="fas fa-tools mr-1"></i>Tools</a></li>' +
                '</ul>' +
                
                '<div class="tab-content" id="configSubContent">' +
                    // General Settings Tab
                    '<div class="tab-pane fade show active" id="cfg-general">' +
                        '<div class="row">' +
                            '<div class="col-md-6">' +
                                // Composite Rate Method
                                '<div class="card mb-3">' +
                                    '<div class="card-header py-2"><strong><i class="fas fa-layer-group mr-2"></i>Composite Rate</strong></div>' +
                                    '<div class="card-body">' +
                                        '<select class="form-control form-control-sm" id="cfgCompositeMethod">' +
                                            '<option value="sum"' + (compositeConfig.method === 'sum' ? ' selected' : '') + '>Sum - Add all rates</option>' +
                                            '<option value="weighted"' + (compositeConfig.method === 'weighted' ? ' selected' : '') + '>Weighted - By expense volume</option>' +
                                            '<option value="cascading"' + (compositeConfig.method === 'cascading' ? ' selected' : '') + '>Cascading - Wrap rate</option>' +
                                        '</select>' +
                                    '</div>' +
                                '</div>' +
                                // Labor Cost Field Config
                                '<div class="card mb-3">' +
                                    '<div class="card-header py-2"><strong><i class="fas fa-user-cog mr-2"></i>Labor Cost Field</strong></div>' +
                                    '<div class="card-body">' +
                                        '<input type="text" class="form-control form-control-sm" id="cfgLaborCostField" value="' + escapeHtml(config.laborCostFieldId || 'laborcost') + '" style="max-width: 180px;">' +
                                        '<small class="text-muted">Employee field ID (default: laborcost)</small>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            '<div class="col-md-6">' +
                                // Budget Rates
                                '<div class="card mb-3">' +
                                    '<div class="card-header py-2"><strong><i class="fas fa-bullseye mr-2"></i>Budget Rate</strong></div>' +
                                    '<div class="card-body">' +
                                        '<div class="input-group input-group-sm" style="max-width: 180px;">' +
                                            '<div class="input-group-prepend"><span class="input-group-text">$</span></div>' +
                                            '<input type="number" class="form-control" id="cfgBudgetOverall" value="' + (config.budgetedRates?.overall || '') + '" step="0.01">' +
                                            '<div class="input-group-append"><span class="input-group-text">/hr</span></div>' +
                                        '</div>' +
                                        '<small class="text-muted">Target composite rate</small>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        // Absorption Tracking - Full width row with account selector
                        '<div class="row">' +
                            '<div class="col-12">' +
                                '<div class="card mb-3">' +
                                    '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                        '<strong><i class="fas fa-receipt mr-2"></i>Absorption Tracking</strong>' +
                                        '<span class="badge badge-' + ((config.burdenAppliedAccountIds || []).length > 0 ? 'success' : 'secondary') + '" id="absorptionAccountCount">' + 
                                            ((config.burdenAppliedAccountIds || []).length > 0 ? (config.burdenAppliedAccountIds.length + ' accounts selected') : 'Using pattern match') + 
                                        '</span>' +
                                    '</div>' +
                                    '<div class="card-body">' +
                                        '<p class="small text-muted mb-2">Select specific accounts OR use pattern matching to identify burden applied/absorbed accounts.</p>' +
                                        
                                        // Account Selection Mode Toggle
                                        '<div class="btn-group btn-group-sm mb-3" role="group">' +
                                            '<button type="button" class="btn ' + ((config.burdenAppliedAccountIds || []).length > 0 ? 'btn-primary' : 'btn-outline-primary') + '" id="absorptionModeAccounts" onclick="BurdenController.setAbsorptionMode(\'accounts\')"><i class="fas fa-list mr-1"></i>Select Accounts</button>' +
                                            '<button type="button" class="btn ' + ((config.burdenAppliedAccountIds || []).length === 0 ? 'btn-primary' : 'btn-outline-primary') + '" id="absorptionModePattern" onclick="BurdenController.setAbsorptionMode(\'pattern\')"><i class="fas fa-search mr-1"></i>Pattern Match</button>' +
                                        '</div>' +
                                        
                                        // Account Selection Panel (shown when accounts mode active)
                                        '<div id="absorptionAccountsPanel" style="' + ((config.burdenAppliedAccountIds || []).length > 0 ? '' : 'display:none;') + '">' +
                                            '<input type="text" class="form-control form-control-sm mb-2" placeholder="Search accounts..." id="absorptionAccountSearch" oninput="BurdenController.filterAbsorptionAccounts()">' +
                                            '<div class="absorption-account-list" id="absorptionAccountList" style="max-height: 200px; overflow-y: auto; border: 1px solid #dee2e6; border-radius: 4px; background: #fff;">' +
                                                (function() {
                                                    var accounts = self.latestData.accounts?.all || [];
                                                    var selectedIds = (config.burdenAppliedAccountIds || []).map(function(id) { return String(id); });
                                                    // Sort: selected first, then by number
                                                    var sorted = accounts.slice().sort(function(a, b) {
                                                        var aSelected = selectedIds.includes(String(a.id));
                                                        var bSelected = selectedIds.includes(String(b.id));
                                                        if (aSelected && !bSelected) return -1;
                                                        if (!aSelected && bSelected) return 1;
                                                        return (a.number || '').localeCompare(b.number || '');
                                                    });
                                                    return sorted.map(function(acct) {
                                                        var isSelected = selectedIds.includes(String(acct.id));
                                                        return '<label class="absorption-account-item d-flex align-items-center px-2 py-1 border-bottom' + (isSelected ? ' selected bg-light' : '') + '" data-account="' + acct.id + '" data-number="' + escapeHtml(acct.number || '') + '" data-name="' + escapeHtml(acct.name || '') + '">' +
                                                            '<input type="checkbox" class="mr-2 absorption-account-cb" value="' + acct.id + '"' + (isSelected ? ' checked' : '') + ' onchange="BurdenController.onAbsorptionAccountChange(this)">' +
                                                            '<span class="text-monospace small mr-2" style="min-width:60px;">' + escapeHtml(acct.number || '') + '</span>' +
                                                            '<span class="small flex-grow-1 text-truncate">' + escapeHtml(acct.name || '') + '</span>' +
                                                        '</label>';
                                                    }).join('');
                                                })() +
                                            '</div>' +
                                            '<div class="mt-2 d-flex justify-content-between">' +
                                                '<span class="small text-muted" id="absorptionSelectedCount">' + (config.burdenAppliedAccountIds || []).length + ' selected</span>' +
                                                '<button class="btn btn-sm btn-outline-secondary" onclick="BurdenController.clearAbsorptionAccounts()">Clear All</button>' +
                                            '</div>' +
                                        '</div>' +
                                        
                                        // Pattern Matching Panel (shown when pattern mode active)
                                        '<div id="absorptionPatternPanel" style="' + ((config.burdenAppliedAccountIds || []).length === 0 ? '' : 'display:none;') + '">' +
                                            '<div class="form-group mb-2">' +
                                                '<label class="small font-weight-bold">Account Name Pattern</label>' +
                                                '<input type="text" class="form-control form-control-sm" id="cfgAppliedPattern" value="' + escapeHtml(config.burdenAppliedAccountNamePattern || '%burden applied%') + '">' +
                                                '<small class="text-muted">Use % as wildcard (e.g., %burden applied%)</small>' +
                                            '</div>' +
                                            '<div class="form-group mb-0">' +
                                                '<label class="small font-weight-bold">Account Number Pattern</label>' +
                                                '<input type="text" class="form-control form-control-sm" id="cfgAppliedNumberPattern" value="' + escapeHtml(config.burdenAppliedAccountNumberPattern || '500%') + '">' +
                                                '<small class="text-muted">Use % as wildcard (e.g., 500%)</small>' +
                                            '</div>' +
                                            '<button class="btn btn-sm btn-outline-info mt-2" onclick="BurdenController.testAbsorptionPattern()"><i class="fas fa-vial mr-1"></i>Test Pattern</button>' +
                                            '<div id="absorptionPatternResults" class="mt-2 small"></div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        // Global Exclusions - Full width row
                        '<div class="row">' +
                            '<div class="col-12">' +
                                '<div class="card mb-3">' +
                                    '<div class="card-header py-2"><strong><i class="fas fa-filter mr-2"></i>Global Exclusions</strong></div>' +
                                    '<div class="card-body">' +
                                        '<p class="small text-muted mb-3">These exclusions apply to ALL time-based burden calculations globally.</p>' +
                                        '<div class="row">' +
                                            // Global Employee Type Exclusions
                                            '<div class="col-md-6">' +
                                                '<label class="small font-weight-bold d-flex justify-content-between">' +
                                                    '<span><i class="fas fa-user-slash mr-1"></i>Exclude Employee Types</span>' +
                                                    '<span class="badge badge-secondary" id="cfgGlobalEmpExcludeCount">' + ((config.globalExcludeEmpTypes || []).length) + ' excluded</span>' +
                                                '</label>' +
                                                '<div class="global-emp-exclude-list" style="max-height: 150px; overflow-y: auto; border: 1px solid #dee2e6; border-radius: 4px; background: #fff;" id="cfgGlobalEmpTypes">' +
                                                    '<div class="p-2 text-muted small"><i class="fas fa-spinner fa-spin mr-1"></i>Loading employee types...</div>' +
                                                '</div>' +
                                                '<small class="text-muted mt-1 d-block">Excluded employees won\'t be included in any time-based burden calculations</small>' +
                                            '</div>' +
                                            // Global Department Exclusions
                                            '<div class="col-md-6">' +
                                                '<label class="small font-weight-bold d-flex justify-content-between">' +
                                                    '<span><i class="fas fa-building mr-1"></i>Hidden Departments</span>' +
                                                    '<span class="badge badge-secondary" id="cfgHiddenDeptCount">' + ((config.burdenHiddenDepts || []).length) + ' hidden</span>' +
                                                '</label>' +
                                                '<div class="hidden-dept-list" style="max-height: 150px; overflow-y: auto; border: 1px solid #dee2e6; border-radius: 4px; background: #fff;">' +
                                                    (meta.allDepartments || []).map(function(d) {
                                                        var isHidden = (config.burdenHiddenDepts || []).includes(String(d.id));
                                                        return '<label class="dept-hide-option d-flex align-items-center px-2 py-1 border-bottom' + (isHidden ? ' bg-danger-soft' : '') + '" style="cursor: pointer; margin: 0;" data-dept="' + d.id + '">' +
                                                            '<input type="checkbox" class="cfg-hidden-dept mr-2" value="' + d.id + '"' + (isHidden ? ' checked' : '') + ' onchange="BurdenController.onGlobalDeptHideChange(this)" style="margin: 0;">' +
                                                            '<span class="small">' + escapeHtml(d.name) + '</span>' +
                                                        '</label>';
                                                    }).join('') +
                                                '</div>' +
                                                '<small class="text-muted mt-1 d-block">Hidden departments are excluded from burden calculations</small>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    // Advanced Tab
                    '<div class="tab-pane fade" id="cfg-advanced">' +
                        // Forecast Assumptions
                        '<div class="card mb-3">' +
                            '<div class="card-header py-2"><strong><i class="fas fa-chart-line mr-2"></i>Forecast</strong></div>' +
                            '<div class="card-body">' +
                                '<div class="row">' +
                                    '<div class="col-md-4">' +
                                        '<label class="small">Periods</label>' +
                                        '<select class="form-control form-control-sm" id="cfgForecastPeriods">' +
                                            '<option value="3"' + ((config.forecastAssumptions?.periods || 6) === 3 ? ' selected' : '') + '>3 months</option>' +
                                            '<option value="6"' + ((config.forecastAssumptions?.periods || 6) === 6 ? ' selected' : '') + '>6 months</option>' +
                                            '<option value="12"' + ((config.forecastAssumptions?.periods || 6) === 12 ? ' selected' : '') + '>12 months</option>' +
                                        '</select>' +
                                    '</div>' +
                                    '<div class="col-md-4">' +
                                        '<label class="small">Escalation</label>' +
                                        '<div class="input-group input-group-sm">' +
                                            '<input type="number" class="form-control" id="cfgDefaultEscalation" value="' + ((config.forecastAssumptions?.defaultEscalation || 0.03) * 100).toFixed(1) + '" step="0.1">' +
                                            '<div class="input-group-append"><span class="input-group-text">%/yr</span></div>' +
                                        '</div>' +
                                    '</div>' +
                                    '<div class="col-md-4">' +
                                        '<label class="small">Volume Change</label>' +
                                        '<div class="input-group input-group-sm">' +
                                            '<input type="number" class="form-control" id="cfgVolumeChange" value="' + ((config.forecastAssumptions?.volumeChange || 0) * 100).toFixed(1) + '" step="0.1">' +
                                            '<div class="input-group-append"><span class="input-group-text">%/yr</span></div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        // Cascading Rate Config
                        '<div class="card mb-3">' +
                            '<div class="card-header py-2"><strong><i class="fas fa-layer-group mr-2"></i>Cascading Rate</strong></div>' +
                            '<div class="card-body">' +
                                '<div class="row">' +
                                    '<div class="col-md-6">' +
                                        '<label class="small">Base Labor Rate</label>' +
                                        '<div class="input-group input-group-sm" style="max-width: 150px;">' +
                                            '<div class="input-group-prepend"><span class="input-group-text">$</span></div>' +
                                            '<input type="number" class="form-control" id="cfgBaseLaborRate" value="' + (compositeConfig.baseLaborRate || 50) + '" step="0.01">' +
                                        '</div>' +
                                    '</div>' +
                                    '<div class="col-md-6">' +
                                        '<label class="small">Labor Overhead</label>' +
                                        '<div class="input-group input-group-sm" style="max-width: 120px;">' +
                                            '<input type="number" class="form-control" id="cfgLaborOverhead" value="' + ((meta.laborOverheadFactor || 1.15) * 100 - 100).toFixed(0) + '" min="0" max="100">' +
                                            '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        // Weights & Tiers (now managed per-category)
                        '<div class="card mb-3">' +
                            '<div class="card-header py-2">' +
                                '<strong><i class="fas fa-sliders-h mr-2"></i>Weights & Tiers</strong>' +
                            '</div>' +
                            '<div class="card-body py-2">' +
                                '<p class="small text-muted mb-2">Weighted and stepped allocation settings are configured per-category.</p>' +
                                '<p class="small mb-2">To configure:</p>' +
                                '<ol class="small mb-2 pl-3">' +
                                    '<li>Go to the <strong>Burden</strong> tab</li>' +
                                    '<li>Click on a category to open details</li>' +
                                    '<li>Click <strong>Edit</strong></li>' +
                                    '<li>Under <strong>Allocation Settings</strong>, select <em>Weighted</em> or <em>Stepped</em> method</li>' +
                                '</ol>' +
                                '<button class="btn btn-sm btn-outline-primary" onclick="BurdenController.switchTab(\'burden-tab\')"><i class="fas fa-arrow-right mr-1"></i>Go to Burden Tab</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    // Tools Tab
                    '<div class="tab-pane fade" id="cfg-tools">' +
                        '<div class="row">' +
                            '<div class="col-md-4">' +
                                '<div class="card h-100">' +
                                    '<div class="card-body text-center">' +
                                        '<i class="fas fa-magic fa-3x text-primary mb-3"></i>' +
                                        '<h6>Setup Wizard</h6>' +
                                        '<p class="small text-muted">Guided setup for new users</p>' +
                                        '<button class="btn btn-outline-primary btn-block" onclick="BurdenController.showFirstRunWizard()">Launch Wizard</button>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            '<div class="col-md-4">' +
                                '<div class="card h-100">' +
                                    '<div class="card-body text-center">' +
                                        '<i class="fas fa-file-import fa-3x text-info mb-3"></i>' +
                                        '<h6>Import / Migrate</h6>' +
                                        '<p class="small text-muted">Import from file or custom fields</p>' +
                                        '<button class="btn btn-outline-info btn-block" onclick="BurdenController.showMigrationTool()">Import Data</button>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            '<div class="col-md-4">' +
                                '<div class="card h-100">' +
                                    '<div class="card-body text-center">' +
                                        '<i class="fas fa-file-export fa-3x text-success mb-3"></i>' +
                                        '<h6>Export Configuration</h6>' +
                                        '<p class="small text-muted">Backup settings to JSON</p>' +
                                        '<button class="btn btn-outline-success btn-block" onclick="BurdenController.exportConfiguration()">Export</button>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                // Save Button
                '<div class="mt-4 border-top pt-3">' +
                    '<button class="btn btn-primary" onclick="BurdenController.saveConfig()"><i class="fas fa-save mr-2"></i>Save Configuration</button>' +
                '</div>';
            
            // Render categories list for categories tab
            this.renderCategoryConfigList();
            
            // Load global employee types for exclusion settings
            this.loadGlobalEmpTypesForConfig();
        },

        renderHeadcountExclusionSettings: function(config) {
            var empTypes = (this.latestData.meta && this.latestData.meta.employeeTypes) || 
                           ['Full-Time', 'Part-Time', 'Contractor', 'Intern', 'Temp'];
            var excludedTypes = (config && config.headcountExclusions) || [];
            
            return empTypes.map(function(t) {
                var isExcluded = excludedTypes.includes(t);
                return '<div class="form-check">' +
                    '<input class="form-check-input cfg-hc-exclude" type="checkbox" value="' + t + '"' + (isExcluded ? ' checked' : '') + '>' +
                    '<label class="form-check-label">' + t + '</label>' +
                '</div>';
            }).join('');
        },

        renderCategoryConfigList: function() {
            var container = el('#categoryConfigList');
            if (!container || !this.latestData) return;
            
            var self = this;
            var categories = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
            
            if (categories.length === 0) {
                container.innerHTML = '<div class="text-center text-muted py-4">No categories configured. Click "Add Category" to create one.</div>';
                return;
            }
            
            container.innerHTML = categories.map(function(cat) {
                return '<div class="category-config-item">' +
                    '<div class="cci-color" style="background: ' + cat.color + ';"></div>' +
                    '<div class="cci-info">' +
                        '<div class="cci-name">' + escapeHtml(cat.label) + ' <span class="badge badge-light">' + cat.id + '</span></div>' +
                        '<div class="cci-meta">' +
                            '<span><i class="fas fa-' + self.getBaseIcon(cat.allocationBase) + '"></i> ' + self.getBaseLabel(cat.allocationBase) + '</span>' +
                            '<span><i class="fas fa-' + self.getMethodIcon(cat.allocationMethod) + '"></i> ' + self.getMethodLabel(cat.allocationMethod) + '</span>' +
                            '<span>' + (cat.scope === 'company' ? '<i class="fas fa-building"></i> Company' : '<i class="fas fa-sitemap"></i> Dept') + '</span>' +
                            (cat.includeInComposite === false ? '<span class="text-warning"><i class="fas fa-ban"></i> Excluded</span>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div class="cci-actions">' +
                        '<button class="btn btn-sm btn-outline-secondary" onclick="BurdenController.showEditCategoryFlyout(\'' + cat.id + '\')"><i class="fas fa-edit"></i></button>' +
                        '<button class="btn btn-sm btn-outline-danger" onclick="BurdenController.deleteCategory(\'' + cat.id + '\')"><i class="fas fa-trash"></i></button>' +
                    '</div>' +
                '</div>';
            }).join('');
        },

        switchProfile: function(profileId) {
            var self = this;
            API.post('burden', { subAction: 'set_active_profile', profileId: profileId }).then(function() {
                showToast('Profile switched', 'success');
                self.loadData();
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        showAddProfileFlyout: function() {
            this.openFlyout();
            el('#flyoutTitle').innerHTML = '<i class="fas fa-plus-circle text-success mr-2"></i>New Profile';
            el('#flyoutSubtitle').textContent = 'Create a new overhead profile';
            el('#flyoutStats').innerHTML = '';

            var profiles = (this.latestData.meta && this.latestData.meta.profiles) || [];

            el('#flyoutBody').innerHTML = '<div class="p-3">' +
                '<div class="alert alert-info"><i class="fas fa-info-circle mr-2"></i>Profiles allow you to maintain different overhead configurations for different purposes (e.g., Job Costing vs Billing Rates).</div>' +
                '<div class="form-group">' +
                    '<label class="font-weight-bold">Profile Name</label>' +
                    '<input type="text" class="form-control" id="newProfileName" placeholder="e.g., Billing Rates">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="font-weight-bold">Description</label>' +
                    '<textarea class="form-control" id="newProfileDesc" rows="2" placeholder="Optional description"></textarea>' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="font-weight-bold">Copy Settings From</label>' +
                    '<select class="form-control" id="newProfileSource">' +
                        '<option value="">Start Fresh</option>' +
                        profiles.map(function(p) { return '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>'; }).join('') +
                    '</select>' +
                '</div>' +
                '<button class="btn btn-success btn-block mt-4" onclick="BurdenController.createProfile()"><i class="fas fa-plus mr-2"></i>Create Profile</button>' +
            '</div>';
        },

        createProfile: function() {
            var self = this;
            var name = el('#newProfileName').value.trim();
            var desc = el('#newProfileDesc').value.trim();
            var sourceId = el('#newProfileSource').value;
            
            if (!name) {
                showToast('Please enter a profile name', 'warning');
                return;
            }
            
            var newId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            
            if (sourceId) {
                API.post('burden', { subAction: 'duplicate_profile', sourceProfileId: sourceId, newName: name, newId: newId }).then(function(res) {
                    showToast('Profile created', 'success');
                    self.closeFlyout();
                    // Switch to new profile after creation
                    API.post('burden', { subAction: 'set_active_profile', profileId: newId }).then(function() {
                        self.loadData();
                    });
                }).catch(function(err) {
                    showToast('Error: ' + (err.message || err), 'danger');
                });
            } else {
                var newProfile = {
                    id: newId,
                    name: name,
                    description: desc,
                    color: '#6b7280',
                    icon: 'folder',
                    isDefault: false,
                    categories: [],
                    accountMappings: {},
                    excludedAccounts: [],
                    settings: { compositeMethod: 'sum', baseLaborRate: 50, laborOverheadFactor: 1.15 }
                };
                
                API.post('burden', { subAction: 'save_profile', profile: newProfile }).then(function() {
                    showToast('Profile created', 'success');
                    self.closeFlyout();
                    // Switch to new profile after creation
                    API.post('burden', { subAction: 'set_active_profile', profileId: newId }).then(function() {
                        self.loadData();
                    });
                }).catch(function(err) {
                    showToast('Error: ' + (err.message || err), 'danger');
                });
            }
        },

        showProfileSettings: function() {
            this.openFlyout();
            var meta = this.latestData.meta || {};
            var profiles = meta.profiles || [];
            var activeProfileId = meta.activeProfileId || 'default';
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var self = this;

            el('#flyoutTitle').innerHTML = '<i class="fas fa-cog text-info mr-2"></i>Manage Profiles';
            el('#flyoutSubtitle').textContent = profiles.length + ' profiles configured';
            el('#flyoutStats').innerHTML = '';

            el('#flyoutBody').innerHTML = '<div class="p-2">' +
                profiles.map(function(p) {
                    var isActive = p.id === activeProfileId;
                    // Show category count from main categories if this is active profile
                    var catCount = isActive ? categories.length : (p.categoryCount || 0);
                    return '<div class="profile-settings-item' + (isActive ? ' active-profile' : '') + '">' +
                        '<div class="psi-icon" style="background: ' + (p.color || '#6b7280') + ';"><i class="fas fa-' + (p.icon || 'folder') + '"></i></div>' +
                        '<div class="psi-info">' +
                            '<div class="psi-name">' + escapeHtml(p.name) + 
                                (p.isDefault ? ' <span class="badge badge-primary">Default</span>' : '') +
                                (isActive ? ' <span class="badge badge-success">Active</span>' : '') +
                            '</div>' +
                            '<div class="psi-desc small text-muted">' + escapeHtml(p.description || '') + '</div>' +
                            '<div class="psi-meta small">' + catCount + ' categories</div>' +
                        '</div>' +
                        '<div class="psi-actions">' +
                            (!p.isDefault ? '<button class="btn btn-sm btn-outline-danger" onclick="BurdenController.showDeleteProfileModal(\'' + p.id + '\', \'' + escapeHtml(p.name).replace(/'/g, "\\'") + '\')"><i class="fas fa-trash"></i></button>' : '') +
                        '</div>' +
                    '</div>';
                }).join('') +
            '</div>';
        },

        showDeleteProfileModal: function(profileId, profileName) {
            var self = this;
            var modalHtml = '<div class="modal fade" id="deleteProfileModal" tabindex="-1" style="z-index: 10600;">' +
                '<div class="modal-dialog modal-sm modal-dialog-centered">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header border-0 pb-0">' +
                            '<h6 class="modal-title"><i class="fas fa-exclamation-triangle text-danger mr-2"></i>Delete Profile</h6>' +
                            '<button type="button" class="close delete-modal-close"><span>&times;</span></button>' +
                        '</div>' +
                        '<div class="modal-body pt-2">' +
                            '<p class="mb-0">Delete profile <strong>"' + escapeHtml(profileName) + '"</strong>?</p>' +
                            '<p class="small text-muted mb-0">This action cannot be undone.</p>' +
                        '</div>' +
                        '<div class="modal-footer border-0 pt-0">' +
                            '<button type="button" class="btn btn-sm btn-secondary delete-modal-close">Cancel</button>' +
                            '<button type="button" class="btn btn-sm btn-danger" id="confirmDeleteProfile">Delete</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
            
            // Remove any existing modal
            var existing = document.getElementById('deleteProfileModal');
            if (existing) existing.remove();
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            var modal = document.getElementById('deleteProfileModal');
            jQuery(modal).modal('show');
            
            // Handle close
            modal.querySelectorAll('.delete-modal-close').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    jQuery(modal).modal('hide');
                });
            });
            
            // Handle confirm delete
            document.getElementById('confirmDeleteProfile').addEventListener('click', function() {
                jQuery(modal).modal('hide');
                self.deleteProfile(profileId);
            });
        },

        deleteProfile: function(profileId) {
            var self = this;
            var meta = this.latestData.meta || {};
            var profiles = meta.profiles || [];
            
            API.post('burden', { subAction: 'delete_profile', profileId: profileId }).then(function(res) {
                if (res.success === false && res.error) {
                    showToast(res.error, 'warning');
                    return;
                }
                
                showToast('Profile deleted', 'success');
                
                // Remove from local profiles list immediately
                var updatedProfiles = profiles.filter(function(p) { return p.id !== profileId; });
                if (self.latestData.meta) {
                    self.latestData.meta.profiles = updatedProfiles;
                }
                
                // Update profile selector immediately
                self.updateProfileSelector();
                
                // If we deleted the active profile, switch to default or first available
                if (meta.activeProfileId === profileId) {
                    var newActiveProfile = updatedProfiles.find(function(p) { return p.isDefault; }) || updatedProfiles[0];
                    if (newActiveProfile) {
                        self.switchProfile(newActiveProfile.id);
                    } else {
                        // No profiles left - show create profile UI
                        self.showNoProfilesState();
                    }
                } else {
                    // Just refresh the flyout
                    self.showProfileSettings();
                }
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        showNoProfilesState: function() {
            var container = el('#burdenDashboardContent') || el('#burdenCategoriesContent');
            if (!container) return;
            
            container.innerHTML = '<div class="text-center py-5">' +
                '<i class="fas fa-folder-open fa-3x text-muted mb-3"></i>' +
                '<h5 class="text-muted">No Profiles Configured</h5>' +
                '<p class="text-muted mb-3">Create a profile to start configuring burden categories.</p>' +
                '<button class="btn btn-primary" onclick="BurdenController.showAddProfileFlyout()">' +
                    '<i class="fas fa-plus mr-2"></i>Create Profile' +
                '</button>' +
            '</div>';
            
            this.closeFlyout();
        },

        deleteProfileConfirm: function(profileId) {
            // Legacy - redirect to new modal
            var meta = this.latestData.meta || {};
            var profiles = meta.profiles || [];
            var profile = profiles.find(function(p) { return p.id === profileId; });
            this.showDeleteProfileModal(profileId, profile ? profile.name : profileId);
        },

        saveConfig: function() {
            var self = this;
            var compositeMethod = el('#cfgCompositeMethod') ? el('#cfgCompositeMethod').value : 'sum';
            var baseLaborRate = el('#cfgBaseLaborRate') ? parseFloat(el('#cfgBaseLaborRate').value) || 50 : 50;
            var laborCostFieldId = el('#cfgLaborCostField') ? el('#cfgLaborCostField').value.trim() || 'laborcost' : 'laborcost';
            var laborOverhead = el('#cfgLaborOverhead') ? parseFloat(el('#cfgLaborOverhead').value) || 15 : 15;
            var forecastPeriods = el('#cfgForecastPeriods') ? parseInt(el('#cfgForecastPeriods').value) || 6 : 6;
            var defaultEscalation = el('#cfgDefaultEscalation') ? (parseFloat(el('#cfgDefaultEscalation').value) || 3) / 100 : 0.03;
            var volumeChange = el('#cfgVolumeChange') ? (parseFloat(el('#cfgVolumeChange').value) || 0) / 100 : 0;
            
            // Gather global employee type exclusions
            var globalExcludeEmpTypes = [];
            document.querySelectorAll('.cfg-global-emp-exclude:checked').forEach(function(cb) {
                globalExcludeEmpTypes.push(cb.value);
            });
            
            // Gather hidden departments
            var burdenHiddenDepts = [];
            document.querySelectorAll('.cfg-hidden-dept:checked').forEach(function(cb) {
                burdenHiddenDepts.push(cb.value);
            });
            
            // Gather absorption tracking settings
            var burdenAppliedAccountIds = [];
            document.querySelectorAll('.absorption-account-cb:checked').forEach(function(cb) {
                burdenAppliedAccountIds.push(cb.value);
            });
            
            API.post('burden_config', { 
                config: { 
                    laborOverheadFactor: 1 + laborOverhead / 100, 
                    laborCostFieldId: laborCostFieldId,
                    // Absorption tracking - save both accounts and patterns
                    burdenAppliedAccountIds: burdenAppliedAccountIds,
                    burdenAppliedAccountNamePattern: el('#cfgAppliedPattern')?.value || '%burden applied%',
                    burdenAppliedAccountNumberPattern: el('#cfgAppliedNumberPattern')?.value || '500%',
                    budgetedRates: { overall: parseFloat(el('#cfgBudgetOverall')?.value) || null },
                    compositeRate: {
                        method: compositeMethod,
                        baseLaborRate: baseLaborRate
                    },
                    forecastAssumptions: {
                        periods: forecastPeriods,
                        periodUnit: 'month',
                        defaultEscalation: defaultEscalation,
                        volumeChange: volumeChange
                    },
                    // Global exclusions
                    globalExcludeEmpTypes: globalExcludeEmpTypes,
                    burdenHiddenDepts: burdenHiddenDepts
                } 
            }).then(function() { 
                showToast('Configuration saved', 'success');
                self.loadData(); // Reload data to apply new config
            }).catch(function(err) { 
                showToast('Error: ' + (err.message || err), 'danger'); 
            });
        },
        
        // ════════════════════════════════════════════════════════════════════════
        // ABSORPTION ACCOUNT SELECTOR
        // ════════════════════════════════════════════════════════════════════════
        
        setAbsorptionMode: function(mode) {
            var accountsPanel = document.getElementById('absorptionAccountsPanel');
            var patternPanel = document.getElementById('absorptionPatternPanel');
            var accountsBtn = document.getElementById('absorptionModeAccounts');
            var patternBtn = document.getElementById('absorptionModePattern');
            
            if (mode === 'accounts') {
                if (accountsPanel) accountsPanel.style.display = '';
                if (patternPanel) patternPanel.style.display = 'none';
                if (accountsBtn) { accountsBtn.classList.remove('btn-outline-primary'); accountsBtn.classList.add('btn-primary'); }
                if (patternBtn) { patternBtn.classList.remove('btn-primary'); patternBtn.classList.add('btn-outline-primary'); }
            } else {
                if (accountsPanel) accountsPanel.style.display = 'none';
                if (patternPanel) patternPanel.style.display = '';
                if (accountsBtn) { accountsBtn.classList.remove('btn-primary'); accountsBtn.classList.add('btn-outline-primary'); }
                if (patternBtn) { patternBtn.classList.remove('btn-outline-primary'); patternBtn.classList.add('btn-primary'); }
                // Clear account selections when switching to pattern mode
                this.clearAbsorptionAccounts();
            }
        },
        
        filterAbsorptionAccounts: function() {
            var searchInput = document.getElementById('absorptionAccountSearch');
            var container = document.getElementById('absorptionAccountList');
            
            if (!searchInput || !container) return;
            
            var search = (searchInput.value || '').toLowerCase();
            var items = container.querySelectorAll('.absorption-account-item');
            
            items.forEach(function(item) {
                var number = (item.getAttribute('data-number') || '').toLowerCase();
                var name = (item.getAttribute('data-name') || '').toLowerCase();
                var matches = !search || number.indexOf(search) !== -1 || name.indexOf(search) !== -1;
                
                if (matches) {
                    item.style.cssText = item.style.cssText.replace(/display\s*:\s*none\s*!important\s*;?/gi, '');
                    item.classList.remove('d-none');
                } else {
                    item.style.setProperty('display', 'none', 'important');
                    item.classList.add('d-none');
                }
            });
        },
        
        onAbsorptionAccountChange: function(checkbox) {
            var label = checkbox.closest('.absorption-account-item');
            if (label) {
                if (checkbox.checked) {
                    label.classList.add('selected', 'bg-light');
                } else {
                    label.classList.remove('selected', 'bg-light');
                }
            }
            
            // Update count
            var count = document.querySelectorAll('.absorption-account-cb:checked').length;
            var countEl = document.getElementById('absorptionSelectedCount');
            if (countEl) countEl.textContent = count + ' selected';
            
            var badgeEl = document.getElementById('absorptionAccountCount');
            if (badgeEl) {
                badgeEl.textContent = count > 0 ? count + ' accounts selected' : 'Using pattern match';
                badgeEl.className = 'badge badge-' + (count > 0 ? 'success' : 'secondary');
            }
        },
        
        clearAbsorptionAccounts: function() {
            document.querySelectorAll('.absorption-account-cb:checked').forEach(function(cb) {
                cb.checked = false;
                var label = cb.closest('.absorption-account-item');
                if (label) {
                    label.classList.remove('selected', 'bg-light');
                }
            });
            
            var countEl = document.getElementById('absorptionSelectedCount');
            if (countEl) countEl.textContent = '0 selected';
            
            var badgeEl = document.getElementById('absorptionAccountCount');
            if (badgeEl) {
                badgeEl.textContent = 'Using pattern match';
                badgeEl.className = 'badge badge-secondary';
            }
        },
        
        testAbsorptionPattern: function() {
            var self = this;
            var namePatternEl = document.getElementById('cfgAppliedPattern');
            var numberPatternEl = document.getElementById('cfgAppliedNumberPattern');
            var resultsEl = document.getElementById('absorptionPatternResults');
            
            var namePattern = namePatternEl ? namePatternEl.value : '%burden applied%';
            var numberPattern = numberPatternEl ? numberPatternEl.value : '500%';
            
            if (!resultsEl) return;
            
            resultsEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Testing patterns...';
            
            // Test against loaded accounts
            var accounts = this.latestData.accounts?.all || [];
            var matches = accounts.filter(function(acct) {
                var nameMatch = false;
                var numberMatch = false;
                
                if (namePattern) {
                    var regex = new RegExp('^' + namePattern.toLowerCase().replace(/%/g, '.*') + '$', 'i');
                    nameMatch = regex.test(acct.name || '');
                }
                if (numberPattern) {
                    var regex = new RegExp('^' + numberPattern.replace(/%/g, '.*') + '$', 'i');
                    numberMatch = regex.test(acct.number || '');
                }
                
                return nameMatch || numberMatch;
            });
            
            if (matches.length === 0) {
                resultsEl.innerHTML = '<span class="text-warning"><i class="fas fa-exclamation-triangle mr-1"></i>No matching accounts found. Check your patterns.</span>';
            } else {
                resultsEl.innerHTML = '<span class="text-success"><i class="fas fa-check mr-1"></i>' + matches.length + ' matching account(s):</span>' +
                    '<ul class="mb-0 pl-3 mt-1">' +
                    matches.slice(0, 5).map(function(a) {
                        return '<li>' + escapeHtml(a.number || '') + ' - ' + escapeHtml(self.truncateText(a.name || '', 40)) + '</li>';
                    }).join('') +
                    (matches.length > 5 ? '<li class="text-muted">...and ' + (matches.length - 5) + ' more</li>' : '') +
                    '</ul>';
            }
        },

        // ════════════════════════════════════════════════════════════════════════
        // FIRST-RUN WIZARD
        // ════════════════════════════════════════════════════════════════════════

        showFirstRunWizard: function() {
            this.openFlyout();
            this.wizardStep = 1;

            el('#flyoutTitle').innerHTML = '<i class="fas fa-magic text-primary mr-2"></i>Setup Wizard';
            el('#flyoutSubtitle').textContent = 'Step 1 of 4: Welcome';
            el('#flyoutStats').innerHTML = '<div class="wizard-progress"><div class="wp-bar" style="width: 25%;"></div></div>';

            this.renderWizardStep();
        },

        renderWizardStep: function() {
            var self = this;
            var step = this.wizardStep || 1;

            el('#flyoutSubtitle').textContent = 'Step ' + step + ' of 4';
            el('#flyoutStats').innerHTML = '<div class="wizard-progress"><div class="wp-bar" style="width: ' + (step * 25) + '%;"></div></div>';

            switch (step) {
                case 1:
                    el('#flyoutBody').innerHTML = '<div class="wizard-content p-3">' +
                        '<div class="text-center mb-4">' +
                            '<i class="fas fa-rocket fa-4x text-primary mb-3"></i>' +
                            '<h4>Welcome to Rate Engine 2.0</h4>' +
                            '<p class="text-muted">This wizard will help you set up your burden rate calculation in just a few steps.</p>' +
                        '</div>' +
                        '<div class="wizard-checklist">' +
                            '<div class="wc-item"><i class="fas fa-check-circle text-success"></i>Configure allocation bases</div>' +
                            '<div class="wc-item"><i class="fas fa-check-circle text-success"></i>Set up expense categories</div>' +
                            '<div class="wc-item"><i class="fas fa-check-circle text-success"></i>Auto-classify accounts</div>' +
                            '<div class="wc-item"><i class="fas fa-check-circle text-success"></i>Review your rates</div>' +
                        '</div>' +
                        '<button class="btn btn-primary btn-block mt-4" onclick="BurdenController.nextWizardStep()">Get Started <i class="fas fa-arrow-right ml-2"></i></button>' +
                    '</div>';
                    break;

                case 2:
                    var categories = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
                    el('#flyoutBody').innerHTML = '<div class="wizard-content p-3">' +
                        '<h5 class="mb-3"><i class="fas fa-layer-group text-primary mr-2"></i>Review Categories</h5>' +
                        '<p class="text-muted small">These are the default burden categories. You can customize them later.</p>' +
                        '<div class="wizard-category-list">' +
                            categories.filter(function(c) { return c.id !== 'U'; }).map(function(c) {
                                return '<div class="wizard-cat-item">' +
                                    '<span class="category-dot" style="background: ' + c.color + ';"></span>' +
                                    '<span class="wcl-label">' + escapeHtml(c.label) + '</span>' +
                                    '<span class="wcl-base text-muted small">' + self.getBaseLabel(c.allocationBase) + '</span>' +
                                '</div>';
                            }).join('') +
                        '</div>' +
                        '<div class="d-flex justify-content-between mt-4">' +
                            '<button class="btn btn-outline-secondary" onclick="BurdenController.prevWizardStep()"><i class="fas fa-arrow-left mr-2"></i>Back</button>' +
                            '<button class="btn btn-primary" onclick="BurdenController.nextWizardStep()">Continue <i class="fas fa-arrow-right ml-2"></i></button>' +
                        '</div>' +
                    '</div>';
                    break;

                case 3:
                    var stats = (this.latestData.classification && this.latestData.classification.stats) || {};
                    el('#flyoutBody').innerHTML = '<div class="wizard-content p-3">' +
                        '<h5 class="mb-3"><i class="fas fa-magic text-warning mr-2"></i>Auto-Classify Accounts</h5>' +
                        '<div class="wizard-stats mb-4">' +
                            '<div class="ws-item"><span class="ws-value">' + (stats.total || 0) + '</span><span class="ws-label">Total Accounts</span></div>' +
                            '<div class="ws-item"><span class="ws-value text-success">' + (stats.assigned || 0) + '</span><span class="ws-label">Assigned</span></div>' +
                            '<div class="ws-item"><span class="ws-value text-warning">' + (stats.unassigned || 0) + '</span><span class="ws-label">Unassigned</span></div>' +
                        '</div>' +
                        '<p class="text-muted small">Click below to auto-classify accounts using category patterns.</p>' +
                        '<button class="btn btn-warning btn-block mb-3" onclick="BurdenController.wizardAutoClassify()">' +
                            '<i class="fas fa-magic mr-2"></i>Auto-Classify Now' +
                        '</button>' +
                        '<div id="wizardClassifyResult"></div>' +
                        '<div class="d-flex justify-content-between mt-4">' +
                            '<button class="btn btn-outline-secondary" onclick="BurdenController.prevWizardStep()"><i class="fas fa-arrow-left mr-2"></i>Back</button>' +
                            '<button class="btn btn-primary" onclick="BurdenController.nextWizardStep()">Continue <i class="fas fa-arrow-right ml-2"></i></button>' +
                        '</div>' +
                    '</div>';
                    break;

                case 4:
                    var compositeRate = (this.latestData.kpis && this.latestData.kpis.compositeRate) || 0;
                    el('#flyoutBody').innerHTML = '<div class="wizard-content p-3">' +
                        '<div class="text-center mb-4">' +
                            '<i class="fas fa-check-circle fa-4x text-success mb-3"></i>' +
                            '<h4>Setup Complete!</h4>' +
                            '<p class="text-muted">Your burden rate engine is ready to use.</p>' +
                        '</div>' +
                        '<div class="wizard-result text-center">' +
                            '<div class="h1 text-primary">$' + this.fmtNum(compositeRate, 2) + '<small>/hr</small></div>' +
                            '<div class="text-muted">Current Composite Rate</div>' +
                        '</div>' +
                        '<div class="wizard-next-steps mt-4">' +
                            '<h6 class="text-muted mb-2">Recommended Next Steps:</h6>' +
                            '<div class="wns-item"><i class="fas fa-receipt text-info"></i>Review unassigned accounts in Categories tab</div>' +
                            '<div class="wns-item"><i class="fas fa-bullseye text-warning"></i>Set budget rates in Config tab</div>' +
                            '<div class="wns-item"><i class="fas fa-flask text-purple"></i>Try scenario modeling in Modeler tab</div>' +
                        '</div>' +
                        '<button class="btn btn-success btn-block mt-4" onclick="BurdenController.closeFlyout()">' +
                            '<i class="fas fa-check mr-2"></i>Done' +
                        '</button>' +
                    '</div>';
                    break;
            }
        },

        nextWizardStep: function() {
            if (this.wizardStep < 4) {
                this.wizardStep++;
                this.renderWizardStep();
            }
        },

        prevWizardStep: function() {
            if (this.wizardStep > 1) {
                this.wizardStep--;
                this.renderWizardStep();
            }
        },

        wizardAutoClassify: function() {
            var self = this;
            API.post('burden', { subAction: 'auto_assign_all' }).then(function(res) {
                var assigned = res.assigned || 0;
                el('#wizardClassifyResult').innerHTML = '<div class="alert alert-success"><i class="fas fa-check-circle mr-2"></i>' + assigned + ' accounts auto-classified!</div>';
                self.loadData(true); // Light refresh
            }).catch(function(err) {
                el('#wizardClassifyResult').innerHTML = '<div class="alert alert-danger">Error: ' + (err.message || err) + '</div>';
            });
        },

        // ════════════════════════════════════════════════════════════════════════
        // MIGRATION TOOL
        // ════════════════════════════════════════════════════════════════════════

        showMigrationTool: function() {
            this.openFlyout();

            el('#flyoutTitle').innerHTML = '<i class="fas fa-file-import text-info mr-2"></i>Import / Migration';
            el('#flyoutSubtitle').textContent = 'Import configuration or migrate from existing setup';
            el('#flyoutStats').innerHTML = '';

            el('#flyoutBody').innerHTML = '<div class="p-2">' +
                // Import from JSON
                '<div class="flyout-form-section mb-3">' +
                    '<h6 class="text-muted mb-2"><i class="fas fa-file-code mr-1"></i>Import Configuration</h6>' +
                    '<p class="small text-muted">Import categories and settings from a JSON file.</p>' +
                    '<div class="custom-file mb-2">' +
                        '<input type="file" class="custom-file-input" id="importFile" accept=".json" onchange="BurdenController.previewImport()">' +
                        '<label class="custom-file-label" for="importFile">Choose file...</label>' +
                    '</div>' +
                    '<div id="importPreview"></div>' +
                '</div>' +
                
                // Migrate from Custom Fields
                '<div class="flyout-form-section mb-3">' +
                    '<h6 class="text-muted mb-2"><i class="fas fa-exchange-alt mr-1"></i>Migrate from Custom Fields</h6>' +
                    '<p class="small text-muted">Import existing burden classification from NetSuite custom fields.</p>' +
                    '<div class="form-group">' +
                        '<label class="small font-weight-bold">Account Custom Field ID</label>' +
                        '<input type="text" class="form-control" id="migrateFieldId" placeholder="e.g., custbody_burden_category">' +
                        '<small class="text-muted">The custom field that stores burden category on accounts</small>' +
                    '</div>' +
                    '<button class="btn btn-outline-info btn-block" onclick="BurdenController.previewMigration()">' +
                        '<i class="fas fa-search mr-2"></i>Preview Migration' +
                    '</button>' +
                    '<div id="migrationPreview"></div>' +
                '</div>' +
                
                // CSV Import
                '<div class="flyout-form-section mb-3">' +
                    '<h6 class="text-muted mb-2"><i class="fas fa-file-csv mr-1"></i>Import from CSV</h6>' +
                    '<p class="small text-muted">Import account classifications from a CSV file.</p>' +
                    '<div class="custom-file mb-2">' +
                        '<input type="file" class="custom-file-input" id="csvImportFile" accept=".csv" onchange="BurdenController.previewCSVImport()">' +
                        '<label class="custom-file-label" for="csvImportFile">Choose CSV file...</label>' +
                    '</div>' +
                    '<small class="text-muted">CSV should have columns: AccountNumber, CategoryID</small>' +
                    '<div id="csvImportPreview"></div>' +
                '</div>' +
            '</div>';
        },

        previewImport: function() {
            var fileInput = el('#importFile');
            if (!fileInput || !fileInput.files || !fileInput.files[0]) return;

            var file = fileInput.files[0];
            var reader = new FileReader();
            var self = this;

            reader.onload = function(e) {
                try {
                    var config = JSON.parse(e.target.result);
                    var categories = config.categories || [];
                    el('#importPreview').innerHTML = '<div class="alert alert-info mt-2">' +
                        '<strong>Found:</strong> ' + categories.length + ' categories<br>' +
                        '<small>' + categories.map(function(c) { return c.label; }).join(', ') + '</small>' +
                    '</div>' +
                    '<button class="btn btn-success btn-block" onclick="BurdenController.executeImport()"><i class="fas fa-check mr-2"></i>Import Now</button>';
                    self.importData = config;
                } catch (err) {
                    el('#importPreview').innerHTML = '<div class="alert alert-danger mt-2">Invalid JSON file</div>';
                }
            };
            reader.readAsText(file);
        },

        executeImport: function() {
            if (!this.importData) return;
            var self = this;

            API.post('burden', { subAction: 'import_config', config: this.importData }).then(function(res) {
                showToast('Configuration imported successfully', 'success');
                self.closeFlyout();
                self.loadData();
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        previewMigration: function() {
            var fieldId = el('#migrateFieldId').value;
            if (!fieldId) {
                el('#migrationPreview').innerHTML = '<div class="alert alert-warning mt-2">Enter a field ID</div>';
                return;
            }

            var self = this;
            API.post('burden', { subAction: 'preview_migration', fieldId: fieldId }).then(function(res) {
                var accounts = res.accounts || [];
                var categories = res.categories || [];
                el('#migrationPreview').innerHTML = '<div class="alert alert-info mt-2">' +
                    '<strong>Found:</strong> ' + accounts.length + ' accounts with classification<br>' +
                    '<strong>Categories:</strong> ' + categories.join(', ') +
                '</div>' +
                '<button class="btn btn-success btn-block" onclick="BurdenController.executeMigration(\'' + fieldId + '\')"><i class="fas fa-check mr-2"></i>Migrate Now</button>';
            }).catch(function(err) {
                el('#migrationPreview').innerHTML = '<div class="alert alert-danger mt-2">Error: ' + (err.message || err) + '</div>';
            });
        },

        executeMigration: function(fieldId) {
            var self = this;
            API.post('burden', { subAction: 'execute_migration', fieldId: fieldId }).then(function(res) {
                showToast('Migration completed: ' + (res.migrated || 0) + ' accounts', 'success');
                self.closeFlyout();
                self.loadData(true); // Light refresh
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        previewCSVImport: function() {
            var fileInput = el('#csvImportFile');
            if (!fileInput || !fileInput.files || !fileInput.files[0]) return;

            var file = fileInput.files[0];
            var reader = new FileReader();
            var self = this;

            reader.onload = function(e) {
                var lines = e.target.result.split('\n').filter(function(l) { return l.trim(); });
                if (lines.length <= 1) {
                    el('#csvImportPreview').innerHTML = '<div class="alert alert-warning mt-2">CSV file is empty</div>';
                    return;
                }

                var count = lines.length - 1;
                el('#csvImportPreview').innerHTML = '<div class="alert alert-info mt-2">' +
                    '<strong>Found:</strong> ' + count + ' account mappings' +
                '</div>' +
                '<button class="btn btn-success btn-block" onclick="BurdenController.executeCSVImport()"><i class="fas fa-check mr-2"></i>Import Now</button>';
                self.csvData = e.target.result;
            };
            reader.readAsText(file);
        },

        executeCSVImport: function() {
            if (!this.csvData) return;
            var self = this;

            API.post('burden', { subAction: 'import_csv', csv: this.csvData }).then(function(res) {
                showToast('Imported ' + (res.imported || 0) + ' account mappings', 'success');
                self.closeFlyout();
                self.loadData(true); // Light refresh
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        exportConfiguration: function() {
            var config = (this.latestData.meta && this.latestData.meta.config) || {};
            var categories = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];

            var exportData = {
                version: '2.0',
                exportDate: new Date().toISOString(),
                categories: categories,
                config: config
            };

            var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'burden_config_' + new Date().toISOString().split('T')[0] + '.json';
            a.click();
            URL.revokeObjectURL(url);

            showToast('Configuration exported', 'success');
        },

        // ════════════════════════════════════════════════════════════════════════
        // FLYOUT SYSTEM
        // ════════════════════════════════════════════════════════════════════════

        // Pure CSS tooltips are used - no Bootstrap initialization needed
        initTooltips: function() {
            // No-op: Using pure CSS tooltips via .info-tooltip class and data-tip attribute
        },

        openFlyout: function() { 
            var f = el('#burdenFlyout'); 
            if (f) { 
                f.classList.add('open'); 
                document.body.classList.add('flyout-open'); 
            } 
        },
        
        closeFlyout: function() { 
            var f = el('#burdenFlyout'); 
            if (f) { 
                f.classList.remove('open'); 
                document.body.classList.remove('flyout-open'); 
            } 
            this.flyoutContext = null; 
        },
        
        setFlyoutTitle: function(title, subtitle) {
            var titleEl = el('#flyoutTitle');
            var subtitleEl = el('#flyoutSubtitle');
            if (titleEl) titleEl.innerHTML = title;
            if (subtitleEl) {
                if (subtitle) {
                    subtitleEl.textContent = subtitle;
                    subtitleEl.style.display = '';
                } else {
                    subtitleEl.style.display = 'none';
                }
            }
        },

        showCategoryFlyout: function(categoryId) {
            var self = this;
            this.openFlyout();
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var classification = this.latestData.classification || {};
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var cat = categories.find(function(c) { return c.id === categoryId; });
            if (!cat) return;
            
            // Get account count from classification
            var catIdStr = String(categoryId);
            var catClass = classification.byCategory && classification.byCategory[catIdStr];
            var accountCount = catClass ? (catClass.count || (catClass.accounts ? catClass.accounts.length : 0)) : 0;
            var catColor = cat.color || '#3b82f6';
            
            // Get historical data for sparkline
            var history = this.latestData.history || {};
            var periods = history.periods || [];
            
            // Calculate trend
            var currentRate = cat.totalBurden || 0;
            var prevRate = 0;
            var trendPct = 0;
            if (periods.length >= 2) {
                var catHistory = periods.map(function(p) {
                    var catData = (p.categoryData || {})[categoryId];
                    return catData ? (catData.rate || 0) : 0;
                });
                if (catHistory.length >= 2 && catHistory[catHistory.length - 2] > 0) {
                    prevRate = catHistory[catHistory.length - 2];
                    trendPct = ((currentRate - prevRate) / prevRate * 100);
                }
            }
            
            // Get category type info
            var catType = cat.categoryType || 'expense';
            var typeIcon = { expense: 'receipt', timebill: 'clock', manual: 'edit', derived: 'percentage', formula: 'function', headcount: 'users', revenue: 'dollar-sign' };
            var typeLabel = { expense: 'Expense', timebill: 'Time', manual: 'Manual', derived: 'Derived', formula: 'Formula', headcount: 'Headcount', revenue: 'Revenue' };
            
            // Header - minimal, we'll put everything in body
            el('#flyoutTitle').innerHTML = '';
            el('#flyoutSubtitle').textContent = '';
            el('#flyoutStats').innerHTML = '';
            el('#flyoutBody').innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';

            var meta = this.latestData.meta || {};
            API.post('burden', { subAction: 'category_drilldown', categoryId: categoryId, startDate: meta.startDate, endDate: meta.endDate, page: 1, pageSize: 10 }).then(function(res) {
                var data = res.data || res;
                var accounts = data.accounts || [];
                
                // Build sparkline data
                var sparklineMax = 0;
                var sparklineData = periods.slice(-12).map(function(p) {
                    var catData = (p.categoryData || {})[categoryId];
                    var val = catData ? (catData.expense || 0) : 0;
                    if (val > sparklineMax) sparklineMax = val;
                    return { label: p.label, value: val };
                });
                
                // Get department breakdown from cat.expense and cat.burden
                var deptBreakdown = [];
                var maxDeptExp = 0;
                depts.forEach(function(d) {
                    var exp = (cat.expense && cat.expense[d.id]) || 0;
                    var rate = (cat.burden && cat.burden[d.id]) || 0;
                    if (exp > 0) {
                        deptBreakdown.push({ id: d.id, name: d.name, expense: exp, rate: rate });
                        if (exp > maxDeptExp) maxDeptExp = exp;
                    }
                });
                deptBreakdown.sort(function(a, b) { return b.expense - a.expense; });
                
                // Calculate total for percentages
                var totalExp = cat.totalExpense || cat.expense?.['Overall'] || 0;
                
                var html = '<div class="category-detail-flyout" style="--cat-color: ' + catColor + ';">' +
                    // Hero Header
                    '<div class="cat-detail-hero">' +
                        '<div class="cat-detail-title-row">' +
                            '<div class="cat-detail-color-bar"></div>' +
                            '<div>' +
                                '<h2 class="cat-detail-name">' + escapeHtml(cat.label) + '</h2>' +
                                '<div class="cat-detail-badges">' +
                                    '<span class="cat-detail-badge"><i class="fas fa-' + (typeIcon[catType] || 'layer-group') + '"></i> ' + (typeLabel[catType] || 'Expense') + '</span>' +
                                    '<span class="cat-detail-badge"><i class="fas fa-receipt"></i> ' + accountCount + ' accounts</span>' +
                                    '<span class="cat-detail-badge"><i class="fas fa-' + self.getBaseIcon(cat.allocationBase) + '"></i> ' + self.getBaseLabel(cat.allocationBase) + '</span>' +
                                    (cat.scope === 'company' ? '<span class="cat-detail-badge"><i class="fas fa-building"></i> Company-wide</span>' : '') +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        
                        // KPI Cards
                        '<div class="cat-detail-kpis">' +
                            '<div class="cat-kpi-card" style="--kpi-color: ' + catColor + ';">' +
                                '<div class="cat-kpi-value">$' + self.fmtNum(currentRate, 2) + '</div>' +
                                '<div class="cat-kpi-label">Rate/Hr</div>' +
                                '<div class="cat-kpi-trend ' + (trendPct > 0 ? 'up' : trendPct < 0 ? 'down' : 'neutral') + '">' +
                                    (trendPct !== 0 ? '<i class="fas fa-caret-' + (trendPct > 0 ? 'up' : 'down') + '"></i> ' + (trendPct > 0 ? '+' : '') + self.fmtNum(trendPct, 1) + '%' : '—') +
                                '</div>' +
                            '</div>' +
                            '<div class="cat-kpi-card" style="--kpi-color: #10b981;">' +
                                '<div class="cat-kpi-value">' + self.formatCurrency(totalExp) + '</div>' +
                                '<div class="cat-kpi-label">Total Expense</div>' +
                            '</div>' +
                            '<div class="cat-kpi-card" style="--kpi-color: #f59e0b;">' +
                                '<div class="cat-kpi-value">' + self.fmtNum(cat.percentOfTotal || 0, 1) + '%</div>' +
                                '<div class="cat-kpi-label">of Burden</div>' +
                            '</div>' +
                            '<div class="cat-kpi-card" style="--kpi-color: #8b5cf6;">' +
                                '<div class="cat-kpi-value">' + deptBreakdown.length + '</div>' +
                                '<div class="cat-kpi-label">Departments</div>' +
                            '</div>' +
                        '</div>' +
                        
                        // Sparkline
                        (sparklineData.length > 0 ? 
                        '<div class="cat-detail-sparkline">' +
                            '<div class="cat-sparkline-header">' +
                                '<span class="cat-sparkline-title"><i class="fas fa-chart-line mr-1"></i>12-Month Trend</span>' +
                                '<span class="cat-sparkline-value">' + self.formatCurrency(sparklineData[sparklineData.length - 1]?.value || 0) + '/mo</span>' +
                            '</div>' +
                            '<div class="cat-sparkline-chart">' +
                                sparklineData.map(function(d) {
                                    var pct = sparklineMax > 0 ? (d.value / sparklineMax * 100) : 0;
                                    return '<div class="cat-sparkline-bar" style="height: ' + Math.max(pct, 5) + '%;" title="' + d.label + ': ' + self.formatCurrency(d.value) + '"></div>';
                                }).join('') +
                            '</div>' +
                        '</div>' : '') +
                    '</div>' +
                    
                    // Department Breakdown Section
                    (deptBreakdown.length > 0 ?
                    '<div class="cat-detail-section">' +
                        '<div class="cat-section-header">' +
                            '<span class="cat-section-title"><i class="fas fa-sitemap"></i>Department Breakdown</span>' +
                        '</div>' +
                        '<div class="cat-dept-list">' +
                            deptBreakdown.slice(0, 6).map(function(d) {
                                var pct = maxDeptExp > 0 ? (d.expense / maxDeptExp * 100) : 0;
                                var expPct = totalExp > 0 ? (d.expense / totalExp * 100) : 0;
                                return '<div class="cat-dept-item">' +
                                    '<div class="cat-dept-name">' + escapeHtml(self.truncateText(d.name, 15)) + '</div>' +
                                    '<div class="cat-dept-bar-container"><div class="cat-dept-bar" style="width: ' + pct + '%;"></div></div>' +
                                    '<div class="cat-dept-values">' +
                                        '<span class="cat-dept-value">' + self.formatCurrency(d.expense) + '</span>' +
                                        '<span class="cat-dept-rate">$' + self.fmtNum(d.rate, 2) + '/hr</span>' +
                                    '</div>' +
                                '</div>';
                            }).join('') +
                        '</div>' +
                    '</div>' : '') +
                    
                    // Top Accounts Section
                    (accounts.length > 0 ?
                    '<div class="cat-detail-section">' +
                        '<div class="cat-section-header">' +
                            '<span class="cat-section-title"><i class="fas fa-list-ol"></i>Top Accounts</span>' +
                            '<a href="#" class="cat-view-all" onclick="BurdenController.showAllAccountsFlyout(\'' + categoryId + '\'); return false;">View all ' + accountCount + ' <i class="fas fa-chevron-right"></i></a>' +
                        '</div>' +
                        '<div class="cat-account-list">' +
                            accounts.slice(0, 5).map(function(a, i) {
                                var acctPct = totalExp > 0 ? (a.amount / totalExp * 100) : 0;
                                return '<div class="cat-account-item" onclick="BurdenController.showAccountFlyout(' + a.id + ', \'' + escapeHtml(a.name).replace(/'/g, "\\'") + '\')">' +
                                    '<div class="cat-account-rank">' + (i + 1) + '</div>' +
                                    '<div class="cat-account-info">' +
                                        '<div class="cat-account-name">' + escapeHtml(a.name) + '</div>' +
                                        '<div class="cat-account-number">' + escapeHtml(a.number || '') + '</div>' +
                                    '</div>' +
                                    '<div class="cat-account-amount">' + self.formatCurrency(a.amount) + '</div>' +
                                    '<div class="cat-account-pct">' + self.fmtNum(acctPct, 1) + '%</div>' +
                                '</div>';
                            }).join('') +
                        '</div>' +
                    '</div>' : 
                    '<div class="cat-detail-section"><div class="text-center text-muted py-3"><i class="fas fa-info-circle mr-1"></i>No account data</div></div>') +
                    
                    // Actions Footer
                    '<div class="cat-detail-actions">' +
                        '<button class="btn btn-primary" onclick="BurdenController.showEditCategoryFlyout(\'' + categoryId + '\')"><i class="fas fa-edit mr-1"></i>Edit</button>' +
                        '<button class="btn btn-outline-danger" onclick="BurdenController.confirmDeleteCategory(\'' + categoryId + '\')"><i class="fas fa-trash mr-1"></i>Delete</button>' +
                    '</div>' +
                '</div>';
                
                el('#flyoutBody').innerHTML = html;
            }).catch(function(err) { 
                el('#flyoutBody').innerHTML = '<div class="p-4 text-danger">Error: ' + (err.message || err) + '</div>'; 
            });
        },
        
        showAllAccountsFlyout: function(categoryId) {
            var self = this;
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var cat = categories.find(function(c) { return c.id === categoryId; });
            
            el('#flyoutTitle').innerHTML = '<span class="category-dot mr-2" style="background: ' + (cat ? cat.color : '#666') + ';"></span>' + escapeHtml(cat ? cat.label : 'Category') + ' - All Accounts';
            el('#flyoutSubtitle').textContent = 'Complete account listing';
            el('#flyoutStats').innerHTML = '';
            el('#flyoutBody').innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';

            var meta = this.latestData.meta || {};
            API.post('burden', { subAction: 'category_drilldown', categoryId: categoryId, startDate: meta.startDate, endDate: meta.endDate, page: 1, pageSize: 100 }).then(function(res) {
                var data = res.data || res;
                var accounts = data.accounts || [];
                if (accounts.length === 0) { 
                    el('#flyoutBody').innerHTML = '<div class="p-4 text-center text-muted">No accounts</div>'; 
                    return; 
                }
                el('#flyoutBody').innerHTML = '<table class="flyout-table"><thead><tr><th>Account</th><th class="text-right">Amount</th><th class="text-right">Rate</th></tr></thead><tbody>' +
                    accounts.map(function(a) { 
                        return '<tr class="clickable-row" onclick="BurdenController.showAccountFlyout(' + a.id + ', \'' + escapeHtml(a.name).replace(/'/g, "\\'") + '\')">' +
                            '<td><div class="small text-muted">' + escapeHtml(a.number || '') + '</div><div>' + escapeHtml(a.name) + '</div></td>' +
                            '<td class="text-right">' + self.formatCurrency(a.amount) + '</td>' +
                            '<td class="text-right">$' + self.fmtNum(a.rate, 2) + '</td></tr>'; 
                    }).join('') +
                    '</tbody></table>';
            }).catch(function(err) { 
                el('#flyoutBody').innerHTML = '<div class="p-4 text-danger">Error: ' + (err.message || err) + '</div>'; 
            });
        },

        showAccountFlyout: function(accountId, accountName) {
            var self = this;
            this.openFlyout();
            el('#flyoutTitle').textContent = accountName;
            el('#flyoutSubtitle').textContent = 'Transaction Detail';
            el('#flyoutStats').innerHTML = '';
            el('#flyoutBody').innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';

            var meta = this.latestData.meta || {};
            API.post('burden', { subAction: 'account_transactions', accountId: accountId, startDate: meta.startDate, endDate: meta.endDate, page: 1, pageSize: 25 }).then(function(res) {
                var txns = (res.data || res).transactions || [];
                if (txns.length === 0) { el('#flyoutBody').innerHTML = '<div class="p-4 text-center text-muted">No transactions</div>'; return; }
                el('#flyoutBody').innerHTML = '<table class="flyout-table"><thead><tr><th>Date</th><th>Type</th><th>Doc</th><th>Dept</th><th class="text-right">Amount</th></tr></thead><tbody>' +
                    txns.map(function(t) { return '<tr><td>' + (t.trandate || '--') + '</td><td><span class="badge badge-secondary">' + escapeHtml(t.type_name || t.type) + '</span></td><td><a href="/app/accounting/transactions/transaction.nl?id=' + t.id + '" target="_blank">' + escapeHtml(t.tranid || t.id) + '</a></td><td class="small">' + escapeHtml(t.dept_name || '--') + '</td><td class="text-right">' + self.formatCurrency(t.amount) + '</td></tr>'; }).join('') +
                    '</tbody></table>';
            }).catch(function(err) { el('#flyoutBody').innerHTML = '<div class="p-4 text-danger">Error: ' + (err.message || err) + '</div>'; });
        },

        showCellFlyout: function(categoryId, deptId) {
            var self = this;
            this.openFlyout();
            
            var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var totals = (this.latestData.summary && this.latestData.summary.totals) || {};
            var allocationBases = this.latestData.allocationBases || {};
            var categoryHistory = this.latestData.categoryHistory || {};
            
            var cat = categories.find(function(c) { return c.id === categoryId; });
            var dept = depts.find(function(d) { return String(d.id) === String(deptId); });
            
            if (!cat || !dept) {
                el('#flyoutBody').innerHTML = '<div class="p-4 text-center text-muted">Category or department not found</div>';
                return;
            }

            // Get values
            var rate = cat.burden && cat.burden[deptId] ? cat.burden[deptId] : 0;
            var expense = cat.expense && cat.expense[deptId] ? cat.expense[deptId] : 0;
            var overallRate = cat.totalBurden || 0;
            var totalExpense = cat.totalExpense || 0;
            var totalBurdenRate = totals.burden && totals.burden[deptId] ? totals.burden[deptId] : 0;
            
            // Get hours for this dept
            var deptHours = 0;
            if (allocationBases.hours && allocationBases.hours.byDept) {
                var hObj = allocationBases.hours.byDept[deptId] || allocationBases.hours.byDept[String(deptId)] || {};
                deptHours = typeof hObj === 'object' ? (hObj.billed || hObj.total || 0) : hObj;
            }
            
            // Calculate percentages
            var pctOfCategory = totalExpense > 0 ? (expense / totalExpense * 100) : 0;
            var pctOfTotal = totalBurdenRate > 0 ? (rate / totalBurdenRate * 100) : 0;
            var vsOverall = overallRate > 0 ? ((rate - overallRate) / overallRate * 100) : 0;

            // Get sparkline data from category history
            var catHist = categoryHistory[categoryId] || {};
            var sparkData = catHist.rates || catHist.expenses || [];

            // Header
            el('#flyoutTitle').innerHTML = '<span class="bm-cat-dot" style="background:' + (cat.color || '#6b7280') + '; width: 10px; height: 10px; display: inline-block; border-radius: 50%; margin-right: 8px;"></span>' + escapeHtml(cat.label);
            el('#flyoutSubtitle').textContent = dept.name;
            
            // Use global KPI card style for stats
            el('#flyoutStats').innerHTML = '';

            // Loading state for body
            el('#flyoutBody').innerHTML = '<div class="cell-flyout-loading"><div class="spinner-border spinner-border-sm text-primary"></div><span>Loading details...</span></div>';

            // Fetch drilldown data
            var meta = this.latestData.meta || {};
            API.post('burden', { 
                subAction: 'cell_drilldown', 
                categoryId: categoryId, 
                departmentId: deptId, 
                startDate: meta.startDate, 
                endDate: meta.endDate 
            }).then(function(res) {
                var data = res.data || res;
                var accounts = data.accounts || [];
                
                // Build rich flyout content
                var html = '<div class="cell-flyout-content">';
                
                // KPI Cards Row - EXACT same structure as Trends tab
                html += '<div class="cf-kpi-row mb-3">' +
                    '<div class="cf-kpi-card">' +
                        '<div class="icon-wrapper" style="background: ' + (cat.color || '#3b82f6') + '20;"><i class="fas fa-tachometer-alt" style="color: ' + (cat.color || '#3b82f6') + ';"></i></div>' +
                        '<div class="kpi-content">' +
                            '<div class="kpi-value">$' + self.fmtNum(rate, 2) + '<small>/hr</small></div>' +
                            '<div class="kpi-label">Rate</div>' +
                            '<div class="kpi-sub ' + (vsOverall >= 0 ? 'text-danger' : 'text-success') + '">' + (vsOverall >= 0 ? '+' : '') + vsOverall.toFixed(1) + '% vs overall</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="cf-kpi-card">' +
                        '<div class="icon-wrapper bg-red-soft"><i class="fas fa-receipt text-red"></i></div>' +
                        '<div class="kpi-content">' +
                            '<div class="kpi-value">' + self.formatCurrency(expense) + '</div>' +
                            '<div class="kpi-label">Expense</div>' +
                            '<div class="kpi-sub">' + pctOfCategory.toFixed(1) + '% of category</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="cf-kpi-card">' +
                        '<div class="icon-wrapper bg-yellow-soft"><i class="fas fa-clock text-yellow"></i></div>' +
                        '<div class="kpi-content">' +
                            '<div class="kpi-value">' + self.fmtNum(deptHours, 0) + '</div>' +
                            '<div class="kpi-label">Hours</div>' +
                            '<div class="kpi-sub">allocation base</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';

                // Sparkline section (if history available)
                if (sparkData.length >= 2) {
                    html += '<div class="cf-sparkline-section">' +
                        '<div class="cf-section-header">' +
                            '<span><i class="fas fa-chart-line"></i> Rate Trend</span>' +
                            '<span class="cf-spark-range">' + sparkData.length + ' periods</span>' +
                        '</div>' +
                        '<div class="cf-sparkline-wrap">' +
                            self.renderSparklineSVG(sparkData, cat.color || '#3b82f6', 280, 50) +
                        '</div>' +
                    '</div>';
                }

                // Rate comparison bar
                html += '<div class="cf-comparison">' +
                    '<div class="cf-comp-header">' +
                        '<span>Rate vs Overall</span>' +
                        '<span class="cf-comp-overall">$' + self.fmtNum(overallRate, 2) + '/hr</span>' +
                    '</div>' +
                    '<div class="cf-comp-bar">' +
                        '<div class="cf-comp-fill" style="width: ' + Math.min(100, (rate / Math.max(rate, overallRate) * 100)) + '%;"></div>' +
                        '<div class="cf-comp-marker" style="left: ' + (overallRate / Math.max(rate, overallRate) * 100) + '%;"></div>' +
                    '</div>' +
                    '<div class="cf-comp-labels">' +
                        '<span>$0</span>' +
                        '<span>$' + self.fmtNum(Math.max(rate, overallRate), 2) + '</span>' +
                    '</div>' +
                '</div>';

                // Get category type for appropriate labeling
                var catType = data.categoryType || cat.categoryType || 'expense';
                var isTimeType = catType === 'time' || catType === 'timebill';
                var sectionIcon = isTimeType ? 'users' : (catType === 'manual' ? 'sliders-h' : 'list-ul');
                var sectionLabel = isTimeType ? 'Employee Breakdown' : (catType === 'manual' ? 'Manual Configuration' : 'Account Breakdown');
                var itemLabel = isTimeType ? 'employees' : (catType === 'manual' ? 'entries' : 'accounts');
                var emptyMessage = isTimeType ? 'No time entries for this department in period' : 
                                   (catType === 'manual' ? 'Manual category - no transaction data' : 
                                    'No transactions for this department in period');

                // Account/Item breakdown
                if (accounts.length > 0) {
                    var maxAmount = Math.max.apply(null, accounts.map(function(a) { return Math.abs(a.amount || 0); }));
                    
                    html += '<div class="cf-accounts">' +
                        '<div class="cf-section-header">' +
                            '<span><i class="fas fa-' + sectionIcon + '"></i> ' + sectionLabel + '</span>' +
                            '<span class="cf-acct-count">' + accounts.length + ' ' + itemLabel + '</span>' +
                        '</div>' +
                        '<div class="cf-acct-list">';
                    
                    accounts.forEach(function(acct) {
                        var amt = acct.amount || 0;
                        var acctRate = acct.rate || 0;
                        var pctOfCat = expense > 0 ? (amt / expense * 100) : 0;
                        var barWidth = maxAmount > 0 ? (Math.abs(amt) / maxAmount * 100) : 0;

                        // For timebill, show hours alongside amount
                        var extraInfo = isTimeType && acct.hours ? ' (' + self.fmtNum(acct.hours, 1) + ' hrs)' : '';

                        html += '<div class="cf-acct-row">' +
                            '<div class="cf-acct-info">' +
                                '<div class="cf-acct-num">' + escapeHtml(acct.number || '') + '</div>' +
                                '<div class="cf-acct-name">' + escapeHtml(acct.name || '') + extraInfo + '</div>' +
                            '</div>' +
                            '<div class="cf-acct-rate">' +
                                '<span class="cf-rate-value">$' + self.fmtNum(acctRate, 2) + '</span>' +
                                '<span class="cf-rate-label">/hr</span>' +
                            '</div>' +
                            '<div class="cf-acct-data">' +
                                '<div class="cf-acct-bar-wrap">' +
                                    '<div class="cf-acct-bar" style="width: ' + barWidth + '%;"></div>' +
                                '</div>' +
                                '<div class="cf-acct-vals">' +
                                    '<span class="cf-acct-amt">' + self.formatCurrency(amt) + '</span>' +
                                    '<span class="cf-acct-pct">' + pctOfCat.toFixed(1) + '%</span>' +
                                '</div>' +
                            '</div>' +
                        '</div>';
                    });
                    
                    html += '</div></div>';
                } else {
                    html += '<div class="cf-empty"><i class="fas fa-inbox"></i><span>' + emptyMessage + '</span></div>';
                }

                // Category info footer
                var typeLabel = isTimeType ? 'Time' : (catType === 'manual' ? 'Manual' : (catType === 'derived' ? 'Derived' : 'Expense'));
                html += '<div class="cf-footer">' +
                    '<span class="bm-type-badge ' + (isTimeType ? 'time' : catType) + '">' + typeLabel + '</span>' +
                    '<span class="cf-base-info"><i class="fas fa-ruler"></i> ' + self.getBaseLabel(cat.allocationBase || 'hours') + '</span>' +
                '</div>';

                html += '</div>';
                el('#flyoutBody').innerHTML = html;

            }).catch(function(err) {
                el('#flyoutBody').innerHTML = '<div class="cf-error"><i class="fas fa-exclamation-circle"></i><span>' + (err.message || err) + '</span></div>';
            });
        },

        renderSparklineSVG: function(data, color, width, height) {
            if (!data || data.length < 2) return '';
            
            var padding = 4;
            var w = width - (padding * 2);
            var h = height - (padding * 2);
            
            var min = Math.min.apply(null, data);
            var max = Math.max.apply(null, data);
            var range = max - min || 1;
            
            // Generate points
            var points = data.map(function(val, i) {
                var x = padding + (i / (data.length - 1)) * w;
                var y = padding + h - ((val - min) / range) * h;
                return x + ',' + y;
            });
            
            // Area fill points (add bottom corners)
            var areaPoints = points.slice();
            areaPoints.push((padding + w) + ',' + (padding + h));
            areaPoints.push(padding + ',' + (padding + h));
            
            var lastVal = data[data.length - 1];
            var firstVal = data[0];
            var trend = lastVal >= firstVal ? 'up' : 'down';
            var trendColor = trend === 'up' ? '#ef4444' : '#10b981';
            
            return '<svg class="cf-sparkline" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
                '<defs>' +
                    '<linearGradient id="sparkGrad-' + color.replace('#', '') + '" x1="0%" y1="0%" x2="0%" y2="100%">' +
                        '<stop offset="0%" style="stop-color:' + color + ';stop-opacity:0.3"/>' +
                        '<stop offset="100%" style="stop-color:' + color + ';stop-opacity:0.05"/>' +
                    '</linearGradient>' +
                '</defs>' +
                '<polygon points="' + areaPoints.join(' ') + '" fill="url(#sparkGrad-' + color.replace('#', '') + ')"/>' +
                '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                '<circle cx="' + points[points.length - 1].split(',')[0] + '" cy="' + points[points.length - 1].split(',')[1] + '" r="3" fill="' + trendColor + '"/>' +
            '</svg>';
        },

        showScenarioFlyout: function(scenarioType) {
            this.openFlyout();
            var labels = { hire: 'Hire Employees', terminate: 'Reduce Staff', win_contract: 'Win Contract', lose_contract: 'Lose Contract', cost_change: 'Cost Change', utilization_change: 'Utilization Change' };
            el('#flyoutTitle').textContent = labels[scenarioType] || 'Scenario';
            el('#flyoutSubtitle').textContent = 'Model rate impact';
            el('#flyoutStats').innerHTML = '';

            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var deptOpts = depts.map(function(d) { return '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>'; }).join('');
            var html = '<div class="scenario-flyout-form">';

            if (scenarioType === 'hire' || scenarioType === 'terminate') {
                html += '<div class="form-group"><label>Employees</label><input type="number" class="form-control" id="scenCount" value="1" min="1"></div>' +
                    '<div class="form-group"><label>Avg Annual Salary</label><input type="number" class="form-control" id="scenSalary" value="75000"></div>' +
                    '<div class="form-group"><label>Department</label><select class="form-control" id="scenDept"><option value="">All</option>' + deptOpts + '</select></div>';
                if (scenarioType === 'hire') html += '<div class="form-group"><label>Expected Utilization (%)</label><input type="number" class="form-control" id="scenUtil" value="75" min="0" max="100"></div>';
            } else if (scenarioType === 'win_contract' || scenarioType === 'lose_contract') {
                html += '<div class="form-group"><label>Annual Hours</label><input type="number" class="form-control" id="scenHours" value="2000"></div><div class="form-group"><label>Annual Revenue ($)</label><input type="number" class="form-control" id="scenRevenue" value="150000"></div>';
            } else if (scenarioType === 'cost_change') {
                html += '<div class="form-group"><label>Category</label><select class="form-control" id="scenCategory">' + ((this.latestData.summary && this.latestData.summary.categories) || []).map(function(c) { return '<option value="' + c.id + '">' + escapeHtml(c.label) + '</option>'; }).join('') + '</select></div>' +
                    '<div class="form-group"><label>Change Type</label><select class="form-control" id="scenChangeType"><option value="percent">Percentage Change</option><option value="absolute">Absolute Amount</option></select></div>' +
                    '<div class="form-group"><label>Amount</label><input type="number" class="form-control" id="scenAmount" value="10"></div>';
            } else if (scenarioType === 'utilization_change') {
                html += '<div class="form-group"><label>Department</label><select class="form-control" id="scenDept"><option value="">All</option>' + deptOpts + '</select></div>' +
                    '<div class="form-group"><label>New Utilization (%)</label><input type="number" class="form-control" id="scenNewUtil" value="80" min="0" max="100"></div>';
            }

            html += '<div class="form-group mb-0 mt-4"><button class="btn btn-primary btn-block" onclick="BurdenController.calculateScenario(\'' + scenarioType + '\')"><i class="fas fa-calculator mr-2"></i>Calculate Impact</button></div></div>' +
                '<div id="scenarioResult" class="mt-4"></div>';

            el('#flyoutBody').innerHTML = html;
        },

        calculateScenario: function(scenarioType) {
            var self = this;
            var meta = this.latestData.meta || {};
            var params = {
                subAction: 'scenario_calculate',
                scenarioType: scenarioType,
                startDate: meta.startDate,
                endDate: meta.endDate
            };

            // Gather scenario-specific params
            if (scenarioType === 'hire' || scenarioType === 'terminate') {
                params.employeeCount = parseInt(el('#scenCount').value) || 1;
                params.avgSalary = parseFloat(el('#scenSalary').value) || 75000;
                params.departmentId = el('#scenDept').value || null;
                if (scenarioType === 'hire') {
                    params.expectedUtilization = (parseFloat(el('#scenUtil').value) || 75) / 100;
                }
            } else if (scenarioType === 'win_contract' || scenarioType === 'lose_contract') {
                params.annualHours = parseFloat(el('#scenHours').value) || 2000;
                params.annualRevenue = parseFloat(el('#scenRevenue').value) || 150000;
            } else if (scenarioType === 'cost_change') {
                params.categoryId = el('#scenCategory').value;
                params.changeType = el('#scenChangeType').value;
                params.amount = parseFloat(el('#scenAmount').value) || 0;
            } else if (scenarioType === 'utilization_change') {
                params.departmentId = el('#scenDept').value || null;
                params.newUtilization = (parseFloat(el('#scenNewUtil').value) || 80) / 100;
            }

            var resultEl = el('#scenarioResult');
            resultEl.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm"></div></div>';

            API.post('burden', params).then(function(res) {
                var data = res.data || res;
                self.renderScenarioResult(data, scenarioType);
            }).catch(function(err) {
                resultEl.innerHTML = '<div class="alert alert-danger">' + (err.message || err) + '</div>';
            });
        },

        renderScenarioResult: function(data, scenarioType) {
            var resultEl = el('#scenarioResult');
            if (!resultEl) return;

            var current = data.currentRate || 0;
            var projected = data.projectedRate || 0;
            var change = projected - current;
            var changePct = current > 0 ? (change / current) * 100 : 0;
            var isIncrease = change > 0;
            var self = this;

            var html = '<div class="scenario-result-card">' +
                '<div class="src-header"><span class="src-title">Impact Analysis</span></div>' +
                '<div class="src-body">' +
                    '<div class="src-comparison">' +
                        '<div class="src-current"><div class="src-label">Current</div><div class="src-value">$' + this.fmtNum(current, 2) + '<span>/hr</span></div></div>' +
                        '<div class="src-arrow ' + (isIncrease ? 'up' : 'down') + '"><i class="fas fa-arrow-' + (isIncrease ? 'up' : 'down') + '"></i></div>' +
                        '<div class="src-projected"><div class="src-label">Projected</div><div class="src-value">$' + this.fmtNum(projected, 2) + '<span>/hr</span></div></div>' +
                    '</div>' +
                    '<div class="src-change ' + (isIncrease ? 'text-danger' : 'text-success') + '">' +
                        (change >= 0 ? '+' : '') + '$' + this.fmtNum(change, 2) + ' (' + (changePct >= 0 ? '+' : '') + changePct.toFixed(1) + '%)' +
                    '</div>';

            // Waterfall breakdown if available
            if (data.breakdown) {
                html += '<div class="src-waterfall mt-3"><div class="small text-muted text-uppercase mb-2">Breakdown</div>';
                var breakdown = data.breakdown;
                if (breakdown.hoursChange) {
                    html += '<div class="sw-row"><span>Hours Change</span><span>' + (breakdown.hoursChange >= 0 ? '+' : '') + this.fmtNum(breakdown.hoursChange, 0) + '</span></div>';
                }
                if (breakdown.expenseChange) {
                    html += '<div class="sw-row"><span>Expense Change</span><span>' + (breakdown.expenseChange >= 0 ? '+' : '') + this.formatCurrency(breakdown.expenseChange) + '</span></div>';
                }
                if (breakdown.headcountChange) {
                    html += '<div class="sw-row"><span>Headcount Change</span><span>' + (breakdown.headcountChange >= 0 ? '+' : '') + breakdown.headcountChange + '</span></div>';
                }
                html += '</div>';
            }

            html += '<div class="src-actions mt-3">' +
                '<button class="btn btn-sm btn-outline-primary mr-2" onclick="BurdenController.saveScenario(\'' + scenarioType + '\')"><i class="fas fa-save mr-1"></i>Save</button>' +
                '<button class="btn btn-sm btn-outline-secondary" onclick="BurdenController.closeFlyout()">Close</button>' +
            '</div></div></div>';

            resultEl.innerHTML = html;
        },

        saveScenario: function(scenarioType) {
            var self = this;
            var name = prompt('Enter a name for this scenario:', scenarioType + ' - ' + new Date().toLocaleDateString());
            if (!name) return;

            var params = { subAction: 'scenario_save', name: name, scenarioType: scenarioType };
            
            // Re-gather params based on scenario type
            if (scenarioType === 'hire' || scenarioType === 'terminate') {
                params.employeeCount = parseInt(el('#scenCount').value) || 1;
                params.avgSalary = parseFloat(el('#scenSalary').value) || 75000;
                params.departmentId = el('#scenDept').value || null;
                if (scenarioType === 'hire') params.expectedUtilization = (parseFloat(el('#scenUtil').value) || 75) / 100;
            } else if (scenarioType === 'win_contract' || scenarioType === 'lose_contract') {
                params.annualHours = parseFloat(el('#scenHours').value) || 2000;
                params.annualRevenue = parseFloat(el('#scenRevenue').value) || 150000;
            } else if (scenarioType === 'cost_change') {
                params.categoryId = el('#scenCategory').value;
                params.changeType = el('#scenChangeType').value;
                params.amount = parseFloat(el('#scenAmount').value) || 0;
            } else if (scenarioType === 'utilization_change') {
                params.departmentId = el('#scenDept').value || null;
                params.newUtilization = (parseFloat(el('#scenNewUtil').value) || 80) / 100;
            }

            API.post('burden', params).then(function(res) {
                showToast('Scenario saved', 'success');
                self.closeFlyout();
                // Refresh modeler tab if open
                if (self.activeTab === 'modeler') self.renderModelerTab();
            }).catch(function(err) {
                showToast('Error saving scenario: ' + (err.message || err), 'danger');
            });
        },

        deleteScenario: function(scenarioId) {
            var self = this;
            if (!confirm('Delete this scenario?')) return;

            API.post('burden', { subAction: 'scenario_delete', scenarioId: scenarioId }).then(function() {
                showToast('Scenario deleted', 'success');
                self.renderModelerTab();
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        // ════════════════════════════════════════════════════════════════════════
        // CATEGORY MANAGEMENT
        // ════════════════════════════════════════════════════════════════════════

        showAddCategoryFlyout: function() {
            this.openFlyout();
            var self = this;
            
            // Default new category
            var cat = {
                id: '',
                label: '',
                color: '#3b82f6',
                categoryType: 'expense',
                allocationBase: 'billed_hours',
                allocationMethod: 'simple',
                scope: 'department',
                rateFormat: 'per_hour',
                includeInComposite: true,
                patterns: []
            };
            
            var catType = 'expense';
            
            el('#flyoutTitle').innerHTML = '<i class="fas fa-plus-circle text-success mr-2"></i>Add Category';
            el('#flyoutSubtitle').textContent = 'Create a new burden category';
            el('#flyoutStats').innerHTML = '';

            var colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444', '#06b6d4', '#84cc16'];
            var colorOpts = colors.map(function(c) {
                return '<option value="' + c + '" style="background: ' + c + '; color: white;">' + c + '</option>';
            }).join('');

            el('#flyoutBody').innerHTML = '<div class="category-form p-2" style="font-size: 0.85rem;">' +
                '<input type="hidden" id="catId" value="">' +
                
                // Basic info section - compact
                '<div class="flyout-form-section mb-2">' +
                    '<h6 class="text-muted mb-1" style="font-size: 0.8rem;"><i class="fas fa-tag mr-1"></i>Basic Info</h6>' +
                    '<div class="row">' +
                        '<div class="col-4"><div class="form-group mb-2"><label class="small">ID <span class="text-danger">*</span></label><input type="text" class="form-control form-control-sm" id="catIdInput" placeholder="MAT"></div></div>' +
                        '<div class="col-5"><div class="form-group mb-2"><label class="small">Label <span class="text-danger">*</span></label><input type="text" class="form-control form-control-sm" id="catLabel" placeholder="Materials"></div></div>' +
                        '<div class="col-3"><div class="form-group mb-2"><label class="small">Color</label><select class="form-control form-control-sm" id="catColor">' + colorOpts + '</select></div></div>' +
                    '</div>' +
                '</div>' +
                
                // Category Type section - compact grid (same as edit flyout)
                '<div class="flyout-form-section mb-2">' +
                    '<h6 class="text-muted mb-1 d-flex align-items-center" style="font-size: 0.8rem;">' +
                        '<i class="fas fa-layer-group mr-1"></i>Category Type' +
                        '<span class="info-tooltip ml-2" data-tip="Expense: GL accounts. Time: Timebill records. Manual: Fixed amounts. Derived: % of another category. Formula: Complex calculations.">' +
                            '<i class="fas fa-question-circle text-muted"></i>' +
                        '</span>' +
                    '</h6>' +
                    '<div class="category-type-selector-compact">' +
                        '<label class="ct-opt-sm ct-selected">' +
                            '<input type="radio" name="catType" value="expense" checked onchange="BurdenController.updateCategoryTypeUI()">' +
                            '<i class="fas fa-receipt text-primary"></i> Expense' +
                        '</label>' +
                        '<label class="ct-opt-sm">' +
                            '<input type="radio" name="catType" value="timebill" onchange="BurdenController.updateCategoryTypeUI()">' +
                            '<i class="fas fa-clock text-warning"></i> Time' +
                        '</label>' +
                        '<label class="ct-opt-sm">' +
                            '<input type="radio" name="catType" value="manual" onchange="BurdenController.updateCategoryTypeUI()">' +
                            '<i class="fas fa-edit text-success"></i> Manual' +
                        '</label>' +
                        '<label class="ct-opt-sm">' +
                            '<input type="radio" name="catType" value="derived" onchange="BurdenController.updateCategoryTypeUI()">' +
                            '<i class="fas fa-percentage text-info"></i> Derived' +
                        '</label>' +
                        '<label class="ct-opt-sm">' +
                            '<input type="radio" name="catType" value="formula" onchange="BurdenController.updateCategoryTypeUI()">' +
                            '<i class="fas fa-function text-purple"></i> Formula' +
                        '</label>' +
                    '</div>' +
                '</div>' +
                
                // Type-specific config area
                '<div id="catTypeConfig">' + this.renderCategoryTypeConfig(cat, catType) + '</div>' +
                
                '<button class="btn btn-success btn-block mt-3" onclick="BurdenController.saveNewCategory()"><i class="fas fa-plus mr-2"></i>Create Category</button>' +
            '</div>';
            
            // Initialize tooltips and live totals after DOM update
            setTimeout(function() { 
                self.initTooltips(); 
                self.updateCategoryLiveTotals();
            }, 50);
        },
        
        saveNewCategory: function() {
            var self = this;
            var catId = (el('#catIdInput')?.value || '').trim().toUpperCase();
            var catLabel = (el('#catLabel')?.value || '').trim();
            var catType = document.querySelector('input[name="catType"]:checked')?.value || 'expense';
            var patterns = (el('#catPatterns')?.value || '').split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; });

            if (!catId || !catLabel) {
                showToast('ID and Label are required', 'warning');
                return;
            }
            
            // Check for duplicate ID
            var existingCategories = (self.latestData.meta?.categoryDefinitions) || [];
            var duplicate = existingCategories.find(function(c) { return String(c.id).toUpperCase() === catId; });
            if (duplicate) {
                showToast('Category ID "' + catId + '" already exists', 'warning');
                return;
            }

            var categoryData = {
                id: catId,
                label: catLabel,
                color: el('#catColor')?.value || '#3b82f6',
                categoryType: catType,
                allocationBase: el('#catBase')?.value || 'billed_hours',
                allocationMethod: el('#catMethod')?.value || 'simple',
                scope: el('#catScope')?.value || 'department',
                rateFormat: el('#catFormat')?.value || 'per_hour',
                includeInComposite: el('#catIncludeComposite')?.checked !== false,
                patterns: patterns,
                totalExpense: 0,
                totalBurden: 0
            };

            // Capture allocation method configuration
            if (categoryData.allocationMethod === 'weighted') {
                var weights = {};
                document.querySelectorAll('.dept-weight-input').forEach(function(input) {
                    var deptId = input.getAttribute('data-dept-id');
                    weights[deptId] = parseFloat(input.value) || 1.0;
                });
                categoryData.allocationWeights = weights;
            } else if (categoryData.allocationMethod === 'stepped') {
                var tiers = [];
                document.querySelectorAll('.tier-row').forEach(function(row) {
                    var minHours = parseFloat(row.querySelector('.tier-min')?.value) || 0;
                    var maxHours = parseFloat(row.querySelector('.tier-max')?.value) || 999999;
                    var rate = parseFloat(row.querySelector('.tier-rate')?.value) || 0;
                    tiers.push({ min: minHours, max: maxHours, rate: rate });
                });
                categoryData.allocationTiers = tiers;
            }

            // Add type-specific filters
            if (catType === 'timebill') {
                var excludeEmpTypes = [];
                document.querySelectorAll('.time-exclude-emp:checked').forEach(function(cb) {
                    excludeEmpTypes.push(cb.value);
                });
                
                var serviceItems = [];
                document.querySelectorAll('.time-service-item:checked').forEach(function(cb) {
                    serviceItems.push(cb.value);
                });
                
                // Gather selected departments (multiselect)
                var deptCheckboxes = document.querySelectorAll('.time-dept-filter');
                var allDeptsChecked = true;
                var departmentIds = [];
                deptCheckboxes.forEach(function(cb) {
                    if (cb.checked) {
                        departmentIds.push(cb.value);
                    } else {
                        allDeptsChecked = false;
                    }
                });
                // If all are checked, store empty array (means "all departments")
                if (allDeptsChecked) {
                    departmentIds = [];
                }
                
                categoryData.timeFilters = {
                    includeBillable: el('#timeIncludeBillable')?.checked !== false,
                    includeNonBillable: el('#timeIncludeNonBillable')?.checked || false,
                    billableDefinition: el('#timeBillableDefinition')?.value || 'customer',
                    departmentIds: departmentIds,
                    excludeEmpTypes: excludeEmpTypes,
                    serviceItems: serviceItems,
                    costMethod: el('#timeCostMethod')?.value || 'employee_rate',
                    customRate: parseFloat(el('#timeCustomRate')?.value) || 50
                };
            } else if (catType === 'manual') {
                // Determine mode from active button
                var activeBtn = document.querySelector('.manual-mode-btn.active');
                var entryMode = activeBtn ? activeBtn.getAttribute('data-mode') : 'fixed_total';
                
                var manualConfig = {
                    entryMode: entryMode
                };
                
                if (entryMode === 'fixed_total') {
                    manualConfig.fixedTotal = parseFloat(el('#manualFixedTotal')?.value) || 0;
                } else if (entryMode === 'by_dept') {
                    var byDeptAmounts = {};
                    document.querySelectorAll('.dept-amount-input').forEach(function(input) {
                        var deptId = input.getAttribute('data-dept-id');
                        var amt = parseFloat(input.value) || 0;
                        if (amt > 0) byDeptAmounts[deptId] = amt;
                    });
                    manualConfig.byDeptAmounts = byDeptAmounts;
                } else if (entryMode === 'per_unit') {
                    manualConfig.unitType = el('#manualUnitType')?.value || 'headcount';
                    manualConfig.perUnitRate = parseFloat(el('#manualPerUnitRate')?.value) || 0;
                }
                
                categoryData.manualConfig = manualConfig;
            } else if (catType === 'derived') {
                // Derived category configuration
                categoryData.derivedConfig = {
                    sourceCategory: el('#derivedSourceCategory')?.value || '',
                    percentage: parseFloat(el('#derivedPercentage')?.value) || 100,
                    allocationBase: el('#derivedAllocationBase')?.value || 'same'
                };
            } else if (catType === 'formula') {
                // Formula category configuration
                categoryData.formulaConfig = {
                    formula: (el('#formulaExpression')?.value || '').trim()
                };
            }
            
            // ALWAYS capture account assignments if the multiselect container exists
            // This is done OUTSIDE the catType check to ensure accounts are captured
            var accountMultiselect = el('#accountMultiselect');
            if (accountMultiselect) {
                var accountIds = [];
                accountMultiselect.querySelectorAll('input[type="checkbox"]:checked').forEach(function(cb) {
                    var label = cb.closest('.account-select-item');
                    if (label) {
                        var accountId = label.getAttribute('data-account');
                        if (accountId) accountIds.push(accountId);
                    }
                });
                categoryData.accountIds = accountIds;
                console.log('[SaveNewCategory] Captured', accountIds.length, 'accounts');
            }

            // Add to local data
            if (!self.latestData.summary) self.latestData.summary = {};
            if (!self.latestData.summary.categories) self.latestData.summary.categories = [];
            self.latestData.summary.categories.push(categoryData);
            
            if (!self.latestData.meta) self.latestData.meta = {};
            if (!self.latestData.meta.categoryDefinitions) self.latestData.meta.categoryDefinitions = [];
            self.latestData.meta.categoryDefinitions.push(categoryData);
            
            // Re-render and close
            self.renderCategoriesTab();
            self.closeFlyout();

            // Save to server, then do LIGHT refresh to get recalculated rates
            API.post('burden', { subAction: 'save_category', category: categoryData, isNew: true }).then(function() {
                showToast('Category "' + categoryData.label + '" created - refreshing...', 'success');
                return self.loadData(true);
            }).then(function() {
                showToast('Data refreshed', 'success');
            }).catch(function(err) {
                showToast('Error saving: ' + (err.message || err), 'danger');
            });
        },

        showBulkAssignFlyout: function() {
            this.openFlyout();
            var classification = this.latestData.classification || {};
            var unassigned = classification.unassigned || [];
            var categories = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
            var self = this;

            el('#flyoutTitle').innerHTML = '<i class="fas fa-magic text-warning mr-2"></i>Bulk Assign Accounts';
            el('#flyoutSubtitle').textContent = unassigned.length + ' unassigned accounts';
            el('#flyoutStats').innerHTML = '';

            var catOptions = categories.map(function(c) {
                return '<option value="' + c.id + '">' + c.label + '</option>';
            }).join('');

            el('#flyoutBody').innerHTML = '<div class="p-2">' +
                '<div class="alert alert-info"><i class="fas fa-info-circle mr-2"></i>Use patterns to automatically assign accounts based on account name keywords.</div>' +
                
                '<div class="flyout-form-section mb-3">' +
                    '<h6 class="text-muted mb-2"><i class="fas fa-search mr-1"></i>Pattern Match</h6>' +
                    '<div class="form-group"><label class="small font-weight-bold">Search Pattern</label>' +
                        '<input type="text" class="form-control" id="bulkPattern" placeholder="e.g., rent, utilities, insurance">' +
                        '<small class="text-muted">Accounts containing these keywords will be selected</small>' +
                    '</div>' +
                    '<div class="form-group"><label class="small font-weight-bold">Assign to Category</label>' +
                        '<select class="form-control" id="bulkCategory">' + catOptions + '</select>' +
                    '</div>' +
                    '<button class="btn btn-warning btn-block" onclick="BurdenController.previewBulkAssign()"><i class="fas fa-eye mr-2"></i>Preview Matches</button>' +
                '</div>' +
                
                '<div id="bulkPreviewResults"></div>' +
                
                '<div class="flyout-form-section mb-3">' +
                    '<h6 class="text-muted mb-2"><i class="fas fa-list-check mr-1"></i>Quick Actions</h6>' +
                    '<button class="btn btn-outline-secondary btn-block mb-2" onclick="BurdenController.autoAssignAll()"><i class="fas fa-magic mr-2"></i>Auto-Assign All (use category patterns)</button>' +
                    '<button class="btn btn-outline-danger btn-block" onclick="BurdenController.excludeRemaining()"><i class="fas fa-ban mr-2"></i>Exclude All Remaining</button>' +
                '</div>' +
            '</div>';
        },

        previewBulkAssign: function() {
            var pattern = (el('#bulkPattern').value || '').toLowerCase().trim();
            var categoryId = el('#bulkCategory').value;
            var classification = this.latestData.classification || {};
            var unassigned = classification.unassigned || [];
            var self = this;

            if (!pattern) {
                el('#bulkPreviewResults').innerHTML = '<div class="alert alert-warning">Enter a pattern to preview matches</div>';
                return;
            }

            var keywords = pattern.split(',').map(function(k) { return k.trim(); }).filter(function(k) { return k.length > 0; });
            var matches = unassigned.filter(function(acct) {
                var name = (acct.name || '').toLowerCase();
                return keywords.some(function(kw) { return name.indexOf(kw) >= 0; });
            });

            if (matches.length === 0) {
                el('#bulkPreviewResults').innerHTML = '<div class="alert alert-warning">No accounts match this pattern</div>';
                return;
            }

            el('#bulkPreviewResults').innerHTML = '<div class="flyout-form-section mb-3">' +
                '<h6 class="text-muted mb-2"><i class="fas fa-check-circle text-success mr-1"></i>' + matches.length + ' Matches Found</h6>' +
                '<div style="max-height: 200px; overflow-y: auto;">' +
                    matches.slice(0, 20).map(function(acct) {
                        return '<div class="d-flex justify-content-between align-items-center py-1 border-bottom">' +
                            '<small>' + escapeHtml(acct.name) + '</small>' +
                            '<small class="text-muted">' + self.formatCurrency(acct.amount) + '</small></div>';
                    }).join('') +
                    (matches.length > 20 ? '<div class="text-center text-muted small py-2">+ ' + (matches.length - 20) + ' more</div>' : '') +
                '</div>' +
                '<button class="btn btn-success btn-block mt-3" onclick="BurdenController.executeBulkAssign()"><i class="fas fa-check mr-2"></i>Assign ' + matches.length + ' Accounts</button>' +
            '</div>';

            this.bulkAssignData = { matches: matches, categoryId: categoryId };
        },

        executeBulkAssign: function() {
            var self = this;
            if (!this.bulkAssignData) return;

            var promises = this.bulkAssignData.matches.map(function(acct) {
                return API.post('burden', { subAction: 'save_classification', accountId: acct.id, categoryId: self.bulkAssignData.categoryId });
            });

            Promise.all(promises).then(function() {
                showToast(self.bulkAssignData.matches.length + ' accounts assigned', 'success');
                self.closeFlyout();
                self.loadData(true); // Light refresh
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        autoAssignAll: function() {
            var self = this;
            API.post('burden', { subAction: 'auto_assign_all' }).then(function(res) {
                var assigned = res.assigned || 0;
                showToast(assigned + ' accounts auto-assigned', 'success');
                self.closeFlyout();
                self.loadData(true); // Light refresh
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        excludeRemaining: function() {
            var self = this;
            if (!confirm('Exclude all remaining unassigned accounts from burden calculation?')) return;

            API.post('burden', { subAction: 'exclude_remaining' }).then(function(res) {
                var excluded = res.excluded || 0;
                showToast(excluded + ' accounts excluded', 'success');
                self.closeFlyout();
                self.loadData(true); // Light refresh
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        showEditCategoryFlyout: function(categoryId) {
            this.openFlyout();
            
            // Get category definition (for config/editing)
            var categoryDefs = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
            var catDef = categoryDefs.find(function(c) { return c.id === categoryId; });
            
            // Get calculated values from summary (for display)
            var summaryCategories = (this.latestData.summary && this.latestData.summary.categories) || [];
            var catSummary = summaryCategories.find(function(c) { return c.id === categoryId; });
            
            // Merge definition with summary - summary values override for calculated fields
            var cat = catDef ? Object.assign({}, catDef, catSummary || {}) : catSummary;
            
            // Special handling for Unbilled category
            if (!cat && categoryId === 'U') {
                cat = {
                    id: 'U',
                    label: 'Unbilled Hours',
                    color: '#6b7280',
                    categoryType: 'timebill',
                    allocationBase: 'billed_hours',
                    allocationMethod: 'simple',
                    scope: 'department',
                    rateFormat: 'per_hour',
                    includeInComposite: true,
                    patterns: []
                };
            }
            
            if (!cat) {
                el('#flyoutTitle').textContent = 'Category Not Found';
                el('#flyoutSubtitle').textContent = '';
                el('#flyoutStats').innerHTML = '';
                el('#flyoutBody').innerHTML = '<div class="p-4 text-danger"><i class="fas fa-exclamation-triangle mr-2"></i>Category "' + escapeHtml(categoryId) + '" not found in configuration.</div>';
                return;
            }

            var self = this;
            var catType = cat.categoryType || this.inferCategoryType(cat.allocationBase);
            
            
            el('#flyoutTitle').innerHTML = '<span class="category-dot mr-2" style="background: ' + cat.color + ';"></span>Edit ' + escapeHtml(cat.label);
            el('#flyoutSubtitle').textContent = 'Configure category settings';
            el('#flyoutStats').innerHTML = '';

            var colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444', '#06b6d4', '#84cc16', '#6b7280'];
            var colorOpts = colors.map(function(c) {
                return '<option value="' + c + '"' + (c === cat.color ? ' selected' : '') + ' style="background: ' + c + '; color: white;">' + c + '</option>';
            }).join('');

            var includeInComposite = cat.includeInComposite !== false;

            el('#flyoutBody').innerHTML = '<div class="category-form p-2" style="font-size: 0.85rem;">' +
                '<input type="hidden" id="catOriginalId" value="' + cat.id + '">' +
                
                // Basic info section - compact
                '<div class="flyout-form-section mb-2">' +
                    '<h6 class="text-muted mb-1" style="font-size: 0.8rem;"><i class="fas fa-tag mr-1"></i>Basic Info</h6>' +
                    '<div class="row">' +
                        '<div class="col-4"><div class="form-group mb-2"><label class="small">ID</label><input type="text" class="form-control form-control-sm" id="catId" value="' + escapeHtml(cat.id) + '" style="font-family: monospace;"></div></div>' +
                        '<div class="col-5"><div class="form-group mb-2"><label class="small">Label</label><input type="text" class="form-control form-control-sm" id="catLabel" value="' + escapeHtml(cat.label) + '"></div></div>' +
                        '<div class="col-3"><div class="form-group mb-2"><label class="small">Color</label><select class="form-control form-control-sm" id="catColor">' + colorOpts + '</select></div></div>' +
                    '</div>' +
                '</div>' +
                
                // Category Type section - compact grid
                '<div class="flyout-form-section mb-2">' +
                    '<h6 class="text-muted mb-1 d-flex align-items-center" style="font-size: 0.8rem;">' +
                        '<i class="fas fa-layer-group mr-1"></i>Category Type' +
                        '<span class="info-tooltip ml-2" data-tip="Expense: GL accounts. Time: Timebill records. Manual: Fixed amounts. Derived: % of another category. Formula: Complex calculations.">' +
                            '<i class="fas fa-question-circle text-muted"></i>' +
                        '</span>' +
                    '</h6>' +
                    '<div class="category-type-selector-compact">' +
                        '<label class="ct-opt-sm' + (catType === 'expense' ? ' ct-selected' : '') + '">' +
                            '<input type="radio" name="catType" value="expense"' + (catType === 'expense' ? ' checked' : '') + ' onchange="BurdenController.updateCategoryTypeUI()">' +
                            '<i class="fas fa-receipt text-primary"></i> Expense' +
                        '</label>' +
                        '<label class="ct-opt-sm' + (catType === 'timebill' ? ' ct-selected' : '') + '">' +
                            '<input type="radio" name="catType" value="timebill"' + (catType === 'timebill' ? ' checked' : '') + ' onchange="BurdenController.updateCategoryTypeUI()">' +
                            '<i class="fas fa-clock text-warning"></i> Time' +
                        '</label>' +
                        '<label class="ct-opt-sm' + (catType === 'manual' || catType === 'headcount' || catType === 'revenue' ? ' ct-selected' : '') + '">' +
                            '<input type="radio" name="catType" value="manual"' + (catType === 'manual' || catType === 'headcount' || catType === 'revenue' ? ' checked' : '') + ' onchange="BurdenController.updateCategoryTypeUI()">' +
                            '<i class="fas fa-edit text-success"></i> Manual' +
                        '</label>' +
                        '<label class="ct-opt-sm' + (catType === 'derived' ? ' ct-selected' : '') + '">' +
                            '<input type="radio" name="catType" value="derived"' + (catType === 'derived' ? ' checked' : '') + ' onchange="BurdenController.updateCategoryTypeUI()">' +
                            '<i class="fas fa-percentage text-info"></i> Derived' +
                        '</label>' +
                        '<label class="ct-opt-sm' + (catType === 'formula' ? ' ct-selected' : '') + '">' +
                            '<input type="radio" name="catType" value="formula"' + (catType === 'formula' ? ' checked' : '') + ' onchange="BurdenController.updateCategoryTypeUI()">' +
                            '<i class="fas fa-function text-purple"></i> Formula' +
                        '</label>' +
                    '</div>' +
                '</div>' +
                
                // Type-specific configuration (dynamic)
                '<div id="catTypeConfig">' + this.renderCategoryTypeConfig(cat, catType) + '</div>' +
                
                '<div class="d-flex gap-2 mt-3">' +
                    '<button class="btn btn-primary btn-sm flex-grow-1" onclick="event.stopPropagation(); BurdenController.saveCategory(\'' + cat.id + '\')"><i class="fas fa-save mr-1"></i>Save</button>' +
                    '<button class="btn btn-outline-danger btn-sm" onclick="event.stopPropagation(); BurdenController.deleteCategory(\'' + cat.id + '\')"><i class="fas fa-trash"></i></button>' +
                '</div>' +
            '</div>';
            
            // Initialize tooltips only - live totals already show correct values from cat
            // updateCategoryLiveTotals will be called when user changes account selections
            setTimeout(function() { 
                self.initTooltips(); 
            }, 50);
        },
        
        // Show flyout with unassigned accounts (read-only view)
        showUnassignedAccountsFlyout: function() {
            this.openFlyout();
            
            var self = this;
            var classification = this.latestData.classification || {};
            var unassigned = classification.unassigned || [];
            var dismissed = this.dismissedAutoAccounts || [];
            var activeUnassigned = unassigned.filter(function(a) { return !dismissed.includes(a.id); });
            
            // Calculate total amount
            var totalAmount = activeUnassigned.reduce(function(sum, a) {
                return sum + Math.abs(parseFloat(a.amount || a.balance || 0));
            }, 0);
            
            el('#flyoutTitle').innerHTML = '<i class="fas fa-inbox text-muted mr-2"></i>Unassigned Accounts';
            el('#flyoutSubtitle').textContent = 'Accounts not assigned to any burden category';
            
            // Stats in header using global KPI card style
            el('#flyoutStats').innerHTML = 
                '<div class="px-3 py-2">' +
                    '<div class="row gutters-sm cf-kpi-row mb-0">' +
                        '<div class="col-6">' +
                            '<div class="cf-kpi-card">' +
                                '<div class="icon-wrapper bg-blue-soft"><i class="fas fa-list text-blue"></i></div>' +
                                '<div class="kpi-content">' +
                                    '<span class="kpi-label">Accounts</span>' +
                                    '<span class="kpi-value">' + activeUnassigned.length + '</span>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="col-6">' +
                            '<div class="cf-kpi-card">' +
                                '<div class="icon-wrapper bg-yellow-soft"><i class="fas fa-dollar-sign text-yellow"></i></div>' +
                                '<div class="kpi-content">' +
                                    '<span class="kpi-label">Total Amount</span>' +
                                    '<span class="kpi-value">' + this.formatCurrency(totalAmount) + '</span>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            
            if (activeUnassigned.length === 0) {
                el('#flyoutBody').innerHTML = 
                    '<div class="text-center py-5">' +
                        '<i class="fas fa-check-circle fa-3x text-success mb-3"></i>' +
                        '<h5 class="text-muted">All accounts assigned!</h5>' +
                        '<p class="small text-muted">Every expense account is assigned to a burden category.</p>' +
                    '</div>';
                return;
            }
            
            // Type color mapping (expanded for all account types)
            var typeColors = {
                'Expense': { label: 'Expense', color: '#3b82f6', bg: '#dbeafe' },
                'COGS': { label: 'COGS', color: '#f59e0b', bg: '#fef3c7' },
                'OthExpense': { label: 'Other Exp', color: '#8b5cf6', bg: '#ede9fe' },
                'OthAsset': { label: 'Other Asset', color: '#06b6d4', bg: '#cffafe' },
                'FixedAsset': { label: 'Fixed Asset', color: '#14b8a6', bg: '#ccfbf1' },
                'AcctPay': { label: 'Acct Pay', color: '#ec4899', bg: '#fce7f3' },
                'AcctRec': { label: 'Acct Rec', color: '#10b981', bg: '#d1fae5' },
                'Bank': { label: 'Bank', color: '#6366f1', bg: '#e0e7ff' },
                'Equity': { label: 'Equity', color: '#84cc16', bg: '#ecfccb' },
                'Income': { label: 'Income', color: '#22c55e', bg: '#dcfce7' },
                'OthIncome': { label: 'Other Inc', color: '#a3e635', bg: '#ecfccb' },
                'LongTermLiab': { label: 'LT Liab', color: '#f43f5e', bg: '#ffe4e6' },
                'OthCurrLiab': { label: 'Curr Liab', color: '#fb7185', bg: '#ffe4e6' },
                'NonPosting': { label: 'Non-Post', color: '#94a3b8', bg: '#f1f5f9' },
                'Stat': { label: 'Statistical', color: '#64748b', bg: '#e2e8f0' }
            };
            
            // Get type info with fallback
            function getTypeInfo(type) {
                return typeColors[type] || { label: type || 'Unknown', color: '#6b7280', bg: '#f3f4f6' };
            }
            
            // Group accounts by type
            var byType = {};
            activeUnassigned.forEach(function(acct) {
                var type = acct.type || 'Unknown';
                if (!byType[type]) byType[type] = [];
                byType[type].push(acct);
            });
            
            // Sort types by count (descending)
            var sortedTypes = Object.keys(byType).sort(function(a, b) {
                return byType[b].length - byType[a].length;
            });
            
            // Build type summary pills
            var typeSummary = sortedTypes.map(function(type) {
                var info = getTypeInfo(type);
                var count = byType[type].length;
                return '<span class="unassigned-type-pill" style="background: ' + info.bg + '; color: ' + info.color + '; border: 1px solid ' + info.color + ';">' +
                    info.label + ' <strong>' + count + '</strong>' +
                '</span>';
            }).join('');
            
            // Sort accounts by amount (highest first)
            var sortedAccounts = activeUnassigned.slice().sort(function(a, b) {
                return Math.abs(parseFloat(b.amount || b.balance || 0)) - Math.abs(parseFloat(a.amount || a.balance || 0));
            });
            
            var html = 
                '<style>' +
                    '.unassigned-flyout { padding: 16px; }' +
                    '.unassigned-summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; padding: 12px; background: #f8fafc; border-radius: 8px; }' +
                    '.unassigned-type-pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 500; }' +
                    '.unassigned-info-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 4px; }' +
                    '.unassigned-search { margin-bottom: 12px; }' +
                    '.unassigned-list { max-height: 400px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; background: white; }' +
                    '.unassigned-item { display: grid; grid-template-columns: 80px 70px 1fr 100px; gap: 12px; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; transition: background 0.15s; }' +
                    '.unassigned-item:last-child { border-bottom: none; }' +
                    '.unassigned-item:hover { background: #f8fafc; }' +
                    '.unassigned-number { font-family: monospace; font-weight: 600; font-size: 0.85rem; color: #1e293b; }' +
                    '.unassigned-type-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }' +
                    '.unassigned-name { font-size: 0.85rem; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
                    '.unassigned-amount { text-align: right; font-weight: 600; font-size: 0.9rem; color: #1e293b; }' +
                    '.unassigned-amount.negative { color: #dc2626; }' +
                    '.unassigned-amount.zero { color: #94a3b8; }' +
                    '.unassigned-empty { text-align: center; padding: 40px; color: #64748b; }' +
                    '.unassigned-cta { margin-top: 16px; padding: 16px; background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%); border-radius: 8px; border: 1px solid #e0e7ff; }' +
                    '.unassigned-cta-title { font-weight: 600; font-size: 0.9rem; color: #1e40af; margin-bottom: 8px; }' +
                    '.unassigned-cta-text { font-size: 0.8rem; color: #475569; margin-bottom: 12px; }' +
                '</style>' +
                
                '<div class="unassigned-flyout">' +
                    // Type Summary
                    '<div class="unassigned-summary">' + typeSummary + '</div>' +
                    
                    // Search
                    '<div class="unassigned-search">' +
                        '<input type="text" class="form-control form-control-sm" placeholder="Search by account number or name..." id="unassignedSearch" oninput="BurdenController.filterUnassignedList()">' +
                    '</div>' +
                    
                    // Info bar
                    '<div class="unassigned-info-bar">' +
                        '<span class="text-muted small">Sorted by amount (highest first)</span>' +
                        '<span class="badge badge-light" id="unassignedVisibleCount">' + sortedAccounts.length + ' accounts</span>' +
                    '</div>' +
                    
                    // Account List
                    '<div class="unassigned-list" id="unassignedAccountsList">' +
                        sortedAccounts.map(function(acct) {
                            var amt = parseFloat(acct.amount || acct.balance || 0);
                            var amtClass = amt < 0 ? 'negative' : (amt === 0 ? 'zero' : '');
                            var typeInfo = getTypeInfo(acct.type);
                            
                            return '<div class="unassigned-item" data-number="' + escapeHtml((acct.number || '').toLowerCase()) + '" data-name="' + escapeHtml((acct.name || '').toLowerCase()) + '">' +
                                '<span class="unassigned-number">' + escapeHtml(acct.number || '--') + '</span>' +
                                '<span class="unassigned-type-badge" style="background: ' + typeInfo.bg + '; color: ' + typeInfo.color + ';">' + typeInfo.label + '</span>' +
                                '<span class="unassigned-name" title="' + escapeHtml(acct.name || '') + '">' + escapeHtml(acct.name || 'Unnamed Account') + '</span>' +
                                '<span class="unassigned-amount ' + amtClass + '">' + self.formatCurrency(amt) + '</span>' +
                            '</div>';
                        }).join('') +
                    '</div>' +
                    
                    // CTA section
                    '<div class="unassigned-cta">' +
                        '<div class="unassigned-cta-title"><i class="fas fa-lightbulb mr-1"></i>Assign These Accounts</div>' +
                        '<div class="unassigned-cta-text">To assign accounts to burden categories, click <strong>Add</strong> to create a new category, or click an existing category to edit its account assignments.</div>' +
                        '<button class="btn btn-sm btn-primary" onclick="BurdenController.closeFlyout(); BurdenController.showAddCategoryFlyout();">' +
                            '<i class="fas fa-plus mr-1"></i>Create New Category' +
                        '</button>' +
                    '</div>' +
                '</div>';
            
            el('#flyoutBody').innerHTML = html;
        },
        
        // Filter unassigned accounts list
        filterUnassignedList: function() {
            var searchInput = el('#unassignedSearch');
            var list = el('#unassignedAccountsList');
            var countBadge = el('#unassignedVisibleCount');
            if (!searchInput || !list) return;
            
            var term = searchInput.value.toLowerCase().trim();
            var items = list.querySelectorAll('.unassigned-item');
            var visibleCount = 0;
            
            items.forEach(function(item) {
                var number = item.getAttribute('data-number') || '';
                var name = item.getAttribute('data-name') || '';
                var match = !term || number.includes(term) || name.includes(term);
                item.style.display = match ? '' : 'none';
                if (match) visibleCount++;
            });
            
            if (countBadge) {
                countBadge.textContent = visibleCount + ' account' + (visibleCount !== 1 ? 's' : '');
            }
        },
        
        // Helper to render full allocation settings with popup explainer
        renderAllocationSettings: function(cat, includeInComposite) {
            var self = this;
            includeInComposite = includeInComposite !== false;
            var method = cat.allocationMethod || 'simple';
            var format = cat.rateFormat || 'per_hour';
            
            return '<div class="allocation-settings-section mt-3 mb-2 p-2 bg-light rounded border">' +
                '<div class="d-flex align-items-center justify-content-between mb-2">' +
                    '<h6 class="text-muted mb-0" style="font-size: 0.8rem;">' +
                        '<i class="fas fa-cogs mr-1"></i>Allocation Settings' +
                    '</h6>' +
                    '<button type="button" class="btn btn-link btn-sm p-0 text-info" onclick="BurdenController.showAllocationExplainer()" title="Learn about allocation settings">' +
                        '<i class="fas fa-question-circle"></i> Help' +
                    '</button>' +
                '</div>' +
                '<div class="row">' +
                    '<div class="col-6"><div class="form-group mb-2">' +
                        '<label class="small font-weight-bold">Allocation Base</label>' +
                        '<select class="form-control form-control-sm" id="catBase" onchange="BurdenController.updateCategoryLiveTotals(); BurdenController.updateTimeCategoryPreview();">' +
                            '<option value="billed_hours"' + ((cat.allocationBase || 'billed_hours') === 'billed_hours' ? ' selected' : '') + '>Billed Hours</option>' +
                            '<option value="total_hours"' + (cat.allocationBase === 'total_hours' ? ' selected' : '') + '>Total Hours</option>' +
                            '<option value="labor_dollars"' + (cat.allocationBase === 'labor_dollars' ? ' selected' : '') + '>Labor $</option>' +
                            '<option value="headcount"' + (cat.allocationBase === 'headcount' ? ' selected' : '') + '>Headcount</option>' +
                            '<option value="revenue"' + (cat.allocationBase === 'revenue' ? ' selected' : '') + '>Revenue</option>' +
                        '</select>' +
                    '</div></div>' +
                    '<div class="col-6"><div class="form-group mb-2">' +
                        '<label class="small font-weight-bold">Method</label>' +
                        '<select class="form-control form-control-sm" id="catMethod" onchange="BurdenController.updateAllocationMethodUI()">' +
                            '<option value="simple"' + (method === 'simple' ? ' selected' : '') + '>Simple</option>' +
                            '<option value="weighted"' + (method === 'weighted' ? ' selected' : '') + '>Weighted</option>' +
                            '<option value="stepped"' + (method === 'stepped' ? ' selected' : '') + '>Stepped</option>' +
                        '</select>' +
                    '</div></div>' +
                '</div>' +
                // Dynamic method config (weights/tiers)
                '<div id="allocationMethodConfig">' + this.renderAllocationMethodConfig(cat) + '</div>' +
                '<div class="row">' +
                    '<div class="col-6"><div class="form-group mb-2">' +
                        '<label class="small font-weight-bold">Scope</label>' +
                        '<select class="form-control form-control-sm" id="catScope">' +
                            '<option value="department"' + ((cat.scope || 'department') === 'department' ? ' selected' : '') + '>By Department</option>' +
                            '<option value="company"' + (cat.scope === 'company' ? ' selected' : '') + '>Company-wide</option>' +
                        '</select>' +
                    '</div></div>' +
                    '<div class="col-6"><div class="form-group mb-2">' +
                        '<label class="small font-weight-bold">Format</label>' +
                        '<select class="form-control form-control-sm" id="catFormat">' +
                            '<option value="per_hour"' + (format === 'per_hour' ? ' selected' : '') + '>$/Hour</option>' +
                            '<option value="percent_labor"' + (format === 'percent_labor' ? ' selected' : '') + '>% Labor</option>' +
                            '<option value="percent_cost"' + (format === 'percent_cost' ? ' selected' : '') + '>% Cost</option>' +
                            '<option value="per_fte"' + (format === 'per_fte' ? ' selected' : '') + '>$/FTE</option>' +
                        '</select>' +
                    '</div></div>' +
                '</div>' +
                '<div class="form-check">' +
                    '<input type="checkbox" class="form-check-input" id="catIncludeComposite"' + (includeInComposite ? ' checked' : '') + '>' +
                    '<label class="form-check-label small" for="catIncludeComposite">Include in Composite Rate</label>' +
                '</div>' +
            '</div>';
        },
        
        // Show detailed allocation settings explainer popup
        showAllocationExplainer: function() {
            var html = '<style>' +
                '.allocation-explainer .explainer-section { margin-bottom: 1.25rem; padding-bottom: 1rem; border-bottom: 1px solid #e5e7eb; }' +
                '.allocation-explainer .explainer-section:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }' +
                '.allocation-explainer h6 { color: #1f2937; font-size: 0.95rem; margin-bottom: 0.5rem; }' +
                '.allocation-explainer table th { background: #f8fafc; font-weight: 600; vertical-align: top; }' +
                '.allocation-explainer table td { vertical-align: top; }' +
                '.allocation-explainer table em { color: #6b7280; font-style: italic; }' +
                '.allocation-explainer code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 0.85em; }' +
            '</style>' +
            '<div class="allocation-explainer">' +
                '<div class="explainer-section">' +
                    '<h6><i class="fas fa-balance-scale text-primary mr-2"></i>Allocation Base</h6>' +
                    '<p class="text-muted small mb-2">Determines HOW the category expense is distributed. The rate is calculated as: <code>Total Expense ÷ Base Value</code></p>' +
                    '<table class="table table-sm table-bordered small mb-3">' +
                        '<tr><th style="width:30%">Billed Hours</th><td>Allocate based on billable time worked. <em>Best for: Labor-related overhead, timekeeping costs.</em> Creates a $/hour rate applied to billable time.</td></tr>' +
                        '<tr><th>Total Hours</th><td>Allocate based on all time worked (billable + non-billable). <em>Best for: Office costs, utilities, equipment that supports all work.</em></td></tr>' +
                        '<tr><th>Labor $</th><td>Allocate proportionally to labor costs. <em>Best for: Benefits, payroll taxes, insurance that scales with wages.</em> Creates a % rate applied to labor.</td></tr>' +
                        '<tr><th>Headcount</th><td>Allocate equally per employee. <em>Best for: Per-seat licenses, training costs, HR expenses.</em> Creates a $/employee rate.</td></tr>' +
                        '<tr><th>Revenue</th><td>Allocate based on department revenue. <em>Best for: Commissions, sales support, revenue-dependent costs.</em> Creates a % of revenue rate.</td></tr>' +
                    '</table>' +
                '</div>' +
                
                '<div class="explainer-section">' +
                    '<h6><i class="fas fa-calculator text-success mr-2"></i>Allocation Method</h6>' +
                    '<p class="text-muted small mb-2">Controls the CALCULATION strategy for determining rates.</p>' +
                    '<table class="table table-sm table-bordered small mb-3">' +
                        '<tr><th style="width:30%">Simple</th><td>Direct division: <code>Expense ÷ Base Value</code>. Each department gets its own rate based on its share of the base. <em>Most common choice.</em></td></tr>' +
                        '<tr><th>Weighted</th><td>Applies multipliers to department allocations. Useful when some departments should absorb more/less burden due to operational factors. E.g., assign 1.5x weight to high-overhead departments.</td></tr>' +
                        '<tr><th>Stepped</th><td>Tiered rates based on volume thresholds. E.g., $50/hr for first 1000 hours, $40/hr for hours 1001-2000. <em>Best for: Volume discounts, progressive burden models.</em></td></tr>' +
                    '</table>' +
                '</div>' +
                
                '<div class="explainer-section">' +
                    '<h6><i class="fas fa-sitemap text-warning mr-2"></i>Scope</h6>' +
                    '<p class="text-muted small mb-2">Determines whether rates are calculated per-department or company-wide.</p>' +
                    '<table class="table table-sm table-bordered small mb-3">' +
                        '<tr><th style="width:30%">By Department</th><td>Each department gets its own burden rate based on its specific expense and base values. Departments with higher expenses per hour will have higher rates. <em>Best for: Accurate cost attribution.</em></td></tr>' +
                        '<tr><th>Company-wide</th><td>A single blended rate is calculated from total company expense ÷ total base, then applied uniformly to all departments. <em>Best for: Simplified billing, uniform pricing.</em></td></tr>' +
                    '</table>' +
                '</div>' +
                
                '<div class="explainer-section">' +
                    '<h6><i class="fas fa-percent text-info mr-2"></i>Rate Format</h6>' +
                    '<p class="text-muted small mb-2">How the calculated rate is expressed and applied.</p>' +
                    '<table class="table table-sm table-bordered small mb-3">' +
                        '<tr><th style="width:30%">$/Hour</th><td>Rate expressed in dollars per hour. Applied by multiplying by hours worked. E.g., $25.50/hr × 160 hours = $4,080 burden.</td></tr>' +
                        '<tr><th>% Labor</th><td>Rate expressed as a percentage of labor cost. E.g., 35% × $5,000 labor = $1,750 burden. <em>Best for: Costs that scale with wages.</em></td></tr>' +
                        '<tr><th>$/FTE</th><td>Rate expressed per full-time equivalent employee. E.g., $500/FTE × 3 FTEs = $1,500 burden. <em>Best for: Fixed per-person costs.</em></td></tr>' +
                    '</table>' +
                '</div>' +
                
                '<div class="explainer-section">' +
                    '<h6><i class="fas fa-layer-group text-purple mr-2"></i>Include in Composite Rate</h6>' +
                    '<p class="text-muted small mb-0">When checked, this category\'s rate is summed into the overall "Composite Burden Rate" shown in the main dashboard. The composite rate represents the total burden per unit of the primary allocation base. Uncheck if this category should be tracked separately (e.g., a one-time cost or pass-through expense).</p>' +
                '</div>' +
            '</div>';
            
            this.showModal('Allocation Settings Guide', html, { size: 'lg' });
        },
        
        // Show a modal dialog
        showModal: function(title, content, options) {
            options = options || {};
            var size = options.size || 'md';
            var modalId = 'burdenModal' + Date.now();
            
            var modalHtml = '<div class="modal fade burden-modal" id="' + modalId + '" tabindex="-1" style="z-index: 10700;">' +
                '<div class="modal-dialog modal-' + size + ' modal-dialog-centered modal-dialog-scrollable">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header">' +
                            '<h5 class="modal-title">' + title + '</h5>' +
                            '<button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>' +
                        '</div>' +
                        '<div class="modal-body">' + content + '</div>' +
                        '<div class="modal-footer">' +
                            '<button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
            
            // Remove any existing modal
            var existing = document.getElementById(modalId);
            if (existing) existing.remove();
            
            // Add modal to DOM
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            var modalEl = document.getElementById(modalId);
            
            // Handle close button clicks
            modalEl.querySelectorAll('[data-dismiss="modal"]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    modalEl.classList.remove('show');
                    modalEl.style.display = 'none';
                    document.body.classList.remove('modal-open');
                    var backdrop = document.querySelector('.modal-backdrop');
                    if (backdrop) backdrop.remove();
                    setTimeout(function() { modalEl.remove(); }, 100);
                });
            });
            
            // Show modal
            modalEl.classList.add('show');
            modalEl.style.display = 'block';
            document.body.classList.add('modal-open');
            
            // Add backdrop if not exists - use z-index 10650 to appear above flyout but below modal
            if (!document.querySelector('.modal-backdrop')) {
                document.body.insertAdjacentHTML('beforeend', '<div class="modal-backdrop fade show burden-modal-backdrop" style="z-index: 10650;"></div>');
            }
            
            // Close on backdrop click
            modalEl.addEventListener('click', function(e) {
                if (e.target === modalEl) {
                    modalEl.querySelector('[data-dismiss="modal"]').click();
                }
            });
        },
        
        renderAllocationMethodConfig: function(cat) {
            var method = cat.allocationMethod || 'simple';
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            
            if (method === 'simple') {
                return ''; // No additional config needed
            }
            
            if (method === 'weighted') {
                var weights = cat.allocationWeights || {};
                return '<div class="allocation-config p-2 bg-light rounded mb-2">' +
                    '<label class="small font-weight-bold"><i class="fas fa-balance-scale mr-1"></i>Department Weights</label>' +
                    '<small class="d-block text-muted mb-2">Weight how expenses are distributed. Default 1.0 = proportional to base.</small>' +
                    '<div class="dept-weight-list" style="max-height: 150px; overflow-y: auto;">' +
                        depts.map(function(d) {
                            var w = weights[d.id] || 1.0;
                            return '<div class="d-flex align-items-center mb-1">' +
                                '<span class="small flex-grow-1">' + escapeHtml(d.name) + '</span>' +
                                '<input type="number" class="form-control form-control-sm dept-weight-input" ' +
                                    'data-dept-id="' + d.id + '" value="' + w.toFixed(2) + '" ' +
                                    'step="0.1" min="0" style="width: 70px;">' +
                            '</div>';
                        }).join('') +
                    '</div>' +
                '</div>';
            }
            
            if (method === 'stepped') {
                var tiers = cat.allocationTiers || [
                    { min: 0, max: 500, rate: 0 },
                    { min: 501, max: 1000, rate: 0 },
                    { min: 1001, max: 999999, rate: 0 }
                ];
                return '<div class="allocation-config p-2 bg-light rounded mb-2">' +
                    '<label class="small font-weight-bold"><i class="fas fa-layer-group mr-1"></i>Rate Tiers</label>' +
                    '<small class="d-block text-muted mb-2">Define rate per tier of allocation base (e.g., hours).</small>' +
                    '<table class="table table-sm mb-1" style="font-size: 0.8rem;">' +
                        '<thead><tr><th>From</th><th>To</th><th>Rate/Hr</th><th></th></tr></thead>' +
                        '<tbody id="tierRows">' +
                            tiers.map(function(t, i) {
                                return '<tr class="tier-row">' +
                                    '<td><input type="number" class="form-control form-control-sm tier-min" value="' + t.min + '" style="width: 70px;"></td>' +
                                    '<td><input type="number" class="form-control form-control-sm tier-max" value="' + (t.max >= 999999 ? '' : t.max) + '" placeholder="∞" style="width: 70px;"></td>' +
                                    '<td><div class="input-group input-group-sm" style="width: 90px;"><div class="input-group-prepend"><span class="input-group-text py-0">$</span></div><input type="number" class="form-control tier-rate" value="' + (t.rate || '') + '" step="0.01"></div></td>' +
                                    '<td><button class="btn btn-sm btn-link text-danger p-0" onclick="BurdenController.removeTierRow(this)"><i class="fas fa-times"></i></button></td>' +
                                '</tr>';
                            }).join('') +
                        '</tbody>' +
                    '</table>' +
                    '<button class="btn btn-sm btn-outline-secondary" onclick="BurdenController.addTierRow()"><i class="fas fa-plus mr-1"></i>Add Tier</button>' +
                '</div>';
            }
            
            return '';
        },
        
        updateAllocationMethodUI: function() {
            var method = el('#catMethod')?.value || 'simple';
            var catId = el('#catId')?.value;
            
            // Get current category to pass to renderer
            var categories = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
            var cat = categories.find(function(c) { return c.id === catId; }) || { allocationMethod: method };
            cat.allocationMethod = method; // Override with current selection
            
            var configContainer = el('#allocationMethodConfig');
            if (configContainer) {
                configContainer.innerHTML = this.renderAllocationMethodConfig(cat);
            }
        },
        
        addTierRow: function() {
            var tbody = el('#tierRows');
            if (!tbody) return;
            
            var lastRow = tbody.querySelector('tr:last-child');
            var lastMax = lastRow ? (parseInt(lastRow.querySelector('.tier-max')?.value) || 0) : 0;
            var newMin = lastMax > 0 ? lastMax + 1 : 0;
            
            var tr = document.createElement('tr');
            tr.className = 'tier-row';
            tr.innerHTML = '<td><input type="number" class="form-control form-control-sm tier-min" value="' + newMin + '" style="width: 70px;"></td>' +
                '<td><input type="number" class="form-control form-control-sm tier-max" value="" placeholder="∞" style="width: 70px;"></td>' +
                '<td><div class="input-group input-group-sm" style="width: 90px;"><div class="input-group-prepend"><span class="input-group-text py-0">$</span></div><input type="number" class="form-control tier-rate" value="" step="0.01"></div></td>' +
                '<td><button class="btn btn-sm btn-link text-danger p-0" onclick="BurdenController.removeTierRow(this)"><i class="fas fa-times"></i></button></td>';
            tbody.appendChild(tr);
        },
        
        removeTierRow: function(btn) {
            var row = btn.closest('tr');
            if (row) row.remove();
        },

        renderCategoryTypeConfig: function(cat, catType) {
            var self = this;
            var html = '';
            
            if (catType === 'timebill') {
                var timeFilters = cat.timeFilters || {};
                var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
                var empTypes = (this.latestData.meta && this.latestData.meta.employeeTypes) || [];
                var serviceItems = (this.latestData.meta && this.latestData.meta.serviceItems) || [];
                var excludedTypes = timeFilters.excludeEmpTypes || [];
                var selectedServices = timeFilters.serviceItems || [];
                
                html = '<div class="flyout-form-section mb-3">' +
                    '<h6 class="text-muted mb-2 d-flex align-items-center">' +
                        '<i class="fas fa-clock mr-1"></i>Time Record Configuration' +
                        '<span class="info-tooltip ml-2" data-tip="Time categories calculate burden based on actual timebill records. The cost shown is the wage cost (hours × labor rate), which gets divided by billable hours to create the burden rate.">' +
                            '<i class="fas fa-question-circle text-muted"></i>' +
                        '</span>' +
                    '</h6>' +
                    '<p class="small text-muted mb-3">Configure which time records to include. Stats update as you change filters.</p>' +
                    
                    // Time Status Filters - Simplified
                    '<div class="form-group px-2">' +
                        '<label class="small font-weight-bold">Time Status</label>' +
                        '<div class="time-status-grid">' +
                            '<div class="form-check">' +
                                '<input class="form-check-input" type="checkbox" id="timeIncludeBillable"' + (timeFilters.includeBillable !== false ? ' checked' : '') + ' onchange="BurdenController.updateTimeCategoryPreview()">' +
                                '<label class="form-check-label">Billable Time</label>' +
                            '</div>' +
                            '<div class="form-check">' +
                                '<input class="form-check-input" type="checkbox" id="timeIncludeNonBillable"' + (timeFilters.includeNonBillable ? ' checked' : '') + ' onchange="BurdenController.updateTimeCategoryPreview()">' +
                                '<label class="form-check-label">Non-Billable Time</label>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +

                    // Billable Definition - How to determine billable vs non-billable
                    '<div class="form-group px-2">' +
                        '<label class="small font-weight-bold">Billable Definition</label>' +
                        '<select class="form-control form-control-sm" id="timeBillableDefinition" onchange="BurdenController.updateTimeCategoryPreview()">' +
                            '<option value="customer"' + ((timeFilters.billableDefinition || 'customer') === 'customer' ? ' selected' : '') + '>Customer Assignment (has customer = billable)</option>' +
                            '<option value="flag"' + (timeFilters.billableDefinition === 'flag' ? ' selected' : '') + '>IsBillable Flag (isbillable = T/F)</option>' +
                        '</select>' +
                        '<small class="text-muted mt-1 d-block">How to determine if time is billable or non-billable</small>' +
                    '</div>' +

                    // Department Filter - Multiselect
                    '<div class="form-group px-2">' +
                        '<label class="small font-weight-bold d-flex justify-content-between">' +
                            '<span>Departments</span>' +
                            '<span class="badge badge-secondary" id="selectedDeptCount">' + 
                                ((timeFilters.departmentIds && timeFilters.departmentIds.length > 0) ? timeFilters.departmentIds.length + ' selected' : 'All') + 
                            '</span>' +
                        '</label>' +
                        '<div class="dept-multiselect" style="max-height: 120px; overflow-y: auto; border: 1px solid #dee2e6; border-radius: 4px; background: #fff;">' +
                            (depts.length > 0 ? 
                                depts.map(function(d) {
                                    var selectedDepts = timeFilters.departmentIds || [];
                                    var isSelected = selectedDepts.length === 0 || selectedDepts.includes(String(d.id));
                                    return '<label class="dept-option d-flex align-items-center px-2 py-1 border-bottom' + (isSelected ? ' bg-primary-soft' : '') + '" style="cursor: pointer; margin: 0;" data-dept="' + d.id + '">' +
                                        '<input type="checkbox" class="time-dept-filter mr-2" value="' + d.id + '"' + (isSelected ? ' checked' : '') + ' onchange="BurdenController.onDeptFilterChange(this)" style="margin: 0;">' +
                                        '<span class="small">' + escapeHtml(d.name) + '</span>' +
                                    '</label>';
                                }).join('') 
                                : '<div class="p-2 text-muted small">No departments available</div>'
                            ) +
                        '</div>' +
                        '<small class="text-muted mt-1 d-block">Leave all checked to include all departments</small>' +
                    '</div>' +
                    
                    // Employee Type Filter - Multiselect Dropdown
                    '<div class="form-group px-2">' +
                        '<label class="small font-weight-bold d-flex justify-content-between">' +
                            '<span>Exclude Employee Types</span>' +
                            '<span class="badge badge-secondary" id="excludedEmpCount">' + excludedTypes.length + ' excluded</span>' +
                        '</label>' +
                        '<div class="emp-type-multiselect" style="max-height: 120px; overflow-y: auto; border: 1px solid #dee2e6; border-radius: 4px; background: #fff;">' +
                            (empTypes.length > 0 ? 
                                empTypes.map(function(t) {
                                    var excluded = excludedTypes.includes(String(t.id));
                                    return '<label class="emp-type-option d-flex align-items-center px-2 py-1 border-bottom' + (excluded ? ' bg-danger-soft' : '') + '" style="cursor: pointer; margin: 0;" data-emp-type="' + t.id + '">' +
                                        '<input type="checkbox" class="time-exclude-emp mr-2" value="' + t.id + '"' + (excluded ? ' checked' : '') + ' onchange="BurdenController.onEmpTypeExcludeChange(this)" style="margin: 0;">' +
                                        '<span class="small">' + escapeHtml(t.name) + '</span>' +
                                    '</label>';
                                }).join('') 
                                : '<div class="p-2 text-muted small"><i class="fas fa-spinner fa-spin mr-1"></i>Loading...</div>'
                            ) +
                        '</div>' +
                    '</div>' +
                    
                    // Service Item Filter - Multiselect
                    '<div class="form-group px-2">' +
                        '<label class="small font-weight-bold d-flex justify-content-between">' +
                            '<span>Service Items</span>' +
                            '<span class="badge badge-secondary" id="selectedServiceCount">' + (selectedServices.length || 'All') + '</span>' +
                        '</label>' +
                        '<div class="service-item-multiselect" id="serviceItemSelect" style="max-height: 120px; overflow-y: auto; border: 1px solid #dee2e6; border-radius: 4px; background: #fff;">' +
                            (serviceItems.length > 0 ?
                                serviceItems.map(function(s) {
                                    var selected = selectedServices.includes(String(s.id));
                                    return '<label class="service-item-option d-flex align-items-center px-2 py-1 border-bottom' + (selected ? ' bg-primary-soft' : '') + '" style="cursor: pointer; margin: 0;" data-service="' + s.id + '">' +
                                        '<input type="checkbox" class="time-service-item mr-2" value="' + s.id + '"' + (selected ? ' checked' : '') + ' onchange="BurdenController.onServiceItemChange(this)" style="margin: 0;">' +
                                        '<span class="small">' + escapeHtml(s.name) + '</span>' +
                                    '</label>';
                                }).join('')
                                : '<div class="p-2 text-muted small">All service items</div>'
                            ) +
                        '</div>' +
                    '</div>' +
                    
                    // Cost Calculation Method
                    '<div class="form-group px-2">' +
                        '<label class="small font-weight-bold">Cost Calculation</label>' +
                        '<select class="form-control form-control-sm" id="timeCostMethod" onchange="BurdenController.toggleTimeCustomRate(); BurdenController.updateTimeCategoryPreview()">' +
                            '<option value="employee_rate"' + ((timeFilters.costMethod || 'employee_rate') === 'employee_rate' ? ' selected' : '') + '>Employee Labor Rate</option>' +
                            '<option value="average_rate"' + (timeFilters.costMethod === 'average_rate' ? ' selected' : '') + '>Average Labor Rate</option>' +
                            '<option value="service_rate"' + (timeFilters.costMethod === 'service_rate' ? ' selected' : '') + '>Service Item Rate</option>' +
                            '<option value="custom_rate"' + (timeFilters.costMethod === 'custom_rate' ? ' selected' : '') + '>Custom Rate</option>' +
                        '</select>' +
                    '</div>' +
                    
                    // Custom Rate (conditional)
                    '<div class="form-group px-2" id="timeCustomRateGroup" style="' + (timeFilters.costMethod === 'custom_rate' ? '' : 'display:none;') + '">' +
                        '<div class="input-group input-group-sm" style="max-width: 180px;">' +
                            '<div class="input-group-prepend"><span class="input-group-text">$</span></div>' +
                            '<input type="number" class="form-control" id="timeCustomRate" value="' + (timeFilters.customRate || 50) + '" step="0.50" onchange="BurdenController.updateTimeCategoryPreview()">' +
                            '<div class="input-group-append"><span class="input-group-text">/hr</span></div>' +
                        '</div>' +
                    '</div>' +
                    
                    // Full Allocation Settings section
                    this.renderAllocationSettings(cat, cat.includeInComposite !== false) +
                    
                    // Live Category Totals - Enhanced design (matching expense type)
                    '<div class="category-live-totals mt-3" id="timeLiveTotals">' +
                        '<div class="live-totals-header d-flex justify-content-between align-items-center mb-2">' +
                            '<span class="small font-weight-bold text-muted"><i class="fas fa-calculator mr-1"></i>LIVE CALCULATION</span>' +
                            '<button class="btn btn-sm btn-outline-primary py-0 px-2" onclick="BurdenController.updateTimeCategoryPreview()" style="font-size: 0.7rem;"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>' +
                        '</div>' +
                        '<div class="live-totals-grid">' +
                            '<div class="live-total-card">' +
                                '<div class="live-total-value" id="timePreviewCost">' + self.formatCurrency(cat.totalCost || cat.totalExpense || 0) + '</div>' +
                                '<div class="live-total-label">Total Cost</div>' +
                                '<div class="live-total-sublabel text-muted" id="timePreviewHours">' + self.fmtNum(cat.totalHours || 0, 0) + ' hours</div>' +
                            '</div>' +
                            '<div class="live-total-divider"></div>' +
                            '<div class="live-total-card">' +
                                '<div class="live-total-value text-primary" id="timePreviewRate">$' + self.fmtNum(cat.totalBurden || (cat.totalExpense || cat.totalCost || 0) / Math.max(1, self.latestData.allocationBases?.hours?.totalBilled || 1), 2) + '</div>' +
                                '<div class="live-total-label">Burden Rate</div>' +
                                '<div class="live-total-sublabel text-muted" id="timePreviewBaseLabel">per billed hour</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="live-totals-footer mt-2 pt-2 border-top">' +
                            '<div class="d-flex justify-content-between small">' +
                                '<span class="text-muted">Base Value:</span>' +
                                '<span class="font-weight-bold" id="timePreviewBaseValue">' + self.fmtNum(self.latestData.allocationBases?.hours?.totalBilled || 0, 0) + '</span>' +
                            '</div>' +
                            '<div class="d-flex justify-content-between small">' +
                                '<span class="text-muted">Cost Method:</span>' +
                                '<span class="font-weight-bold" id="timeCostMethodLabel">' + (timeFilters.costMethod === 'custom' ? 'Custom Rate' : 'Employee Rate') + '</span>' +
                            '</div>' +
                            '<div class="d-flex justify-content-between small">' +
                                '<span class="text-muted">Avg Wage:</span>' +
                                '<span id="timeAvgWage">$' + self.fmtNum((cat.totalCost || 0) / Math.max(1, cat.totalHours || 1), 2) + '/hr</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
                
                // Load labor filters if not already loaded (gets both employee types AND service items)
                if (empTypes.length === 0 || serviceItems.length === 0) {
                    this.loadEmployeeTypes();
                }
                
                // NOTE: We do NOT auto-call updateTimeCategoryPreview here.
                // The initial HTML uses cat.totalBurden from the merged summary.categories,
                // which is already correct. updateTimeCategoryPreview should only run
                // when the user CHANGES a filter, not on initial load.
            } else if (catType === 'manual' || catType === 'headcount' || catType === 'revenue') {
                // Manual category type - handles legacy headcount/revenue types
                var manualConfig = cat.manualConfig || {};
                var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
                var bases = this.latestData.allocationBases || {};
                
                // Migrate from legacy types
                var entryMode = manualConfig.entryMode || 'fixed_total';
                if (catType === 'headcount' && !manualConfig.entryMode) {
                    entryMode = 'per_unit';
                    manualConfig.unitType = 'headcount';
                } else if (catType === 'revenue' && !manualConfig.entryMode) {
                    entryMode = 'per_unit';
                    manualConfig.unitType = 'revenue';
                }
                
                var unitType = manualConfig.unitType || 'headcount';
                var fixedTotal = manualConfig.fixedTotal || 0;
                var perUnitRate = manualConfig.perUnitRate || 0;
                var byDeptAmounts = manualConfig.byDeptAmounts || {};
                
                html = '<div class="flyout-form-section mb-3">' +
                    '<h6 class="text-muted mb-2 d-flex align-items-center">' +
                        '<i class="fas fa-edit mr-1"></i>Manual Entry' +
                        '<span class="info-tooltip ml-2" data-tip="Manual categories let you specify exact burden amounts. Use for corporate allocations, estimates, or costs not in the GL.">' +
                            '<i class="fas fa-question-circle text-muted"></i>' +
                        '</span>' +
                    '</h6>' +
                    '<p class="small text-muted mb-3">Enter burden amounts directly rather than pulling from GL accounts.</p>' +
                    
                    // Entry Mode Selector
                    '<div class="form-group px-2 mb-3">' +
                        '<label class="small font-weight-bold">Entry Mode</label>' +
                        '<div class="btn-group btn-group-sm d-flex" role="group">' +
                            '<button type="button" class="btn btn-outline-primary manual-mode-btn' + (entryMode === 'fixed_total' ? ' active' : '') + '" data-mode="fixed_total" onclick="BurdenController.setManualEntryMode(\'fixed_total\')">' +
                                '<i class="fas fa-dollar-sign mr-1"></i>Fixed Total' +
                            '</button>' +
                            '<button type="button" class="btn btn-outline-primary manual-mode-btn' + (entryMode === 'by_dept' ? ' active' : '') + '" data-mode="by_dept" onclick="BurdenController.setManualEntryMode(\'by_dept\')">' +
                                '<i class="fas fa-sitemap mr-1"></i>By Department' +
                            '</button>' +
                            '<button type="button" class="btn btn-outline-primary manual-mode-btn' + (entryMode === 'per_unit' ? ' active' : '') + '" data-mode="per_unit" onclick="BurdenController.setManualEntryMode(\'per_unit\')">' +
                                '<i class="fas fa-calculator mr-1"></i>Per-Unit Rate' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                    
                    // Mode-specific config container
                    '<div id="manualModeConfig">' +
                        this.renderManualModeConfig(entryMode, manualConfig, depts, bases) +
                    '</div>' +
                    
                    // Full Allocation Settings section
                    this.renderAllocationSettings(cat, cat.includeInComposite !== false) +
                    
                    // Live Category Totals - Enhanced design (matching expense type)
                    '<div class="category-live-totals mt-3" id="manualLiveTotals">' +
                        '<div class="live-totals-header d-flex justify-content-between align-items-center mb-2">' +
                            '<span class="small font-weight-bold text-muted"><i class="fas fa-calculator mr-1"></i>LIVE CALCULATION</span>' +
                            '<span class="badge badge-light">' + (entryMode === 'by_dept' ? depts.length + ' depts' : entryMode === 'per_unit' ? 'Per Unit' : 'Fixed') + '</span>' +
                        '</div>' +
                        '<div class="live-totals-grid">' +
                            '<div class="live-total-card">' +
                                '<div class="live-total-value" id="manualPreviewTotal">' + this.formatCurrency(fixedTotal) + '</div>' +
                                '<div class="live-total-label">Total Expense</div>' +
                                '<div class="live-total-sublabel text-muted">manual entry</div>' +
                            '</div>' +
                            '<div class="live-total-divider"></div>' +
                            '<div class="live-total-card">' +
                                '<div class="live-total-value text-primary" id="manualPreviewRate">$0.00</div>' +
                                '<div class="live-total-label">Burden Rate</div>' +
                                '<div class="live-total-sublabel text-muted">per billed hour</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="live-totals-footer mt-2 pt-2 border-top">' +
                            '<div class="d-flex justify-content-between small">' +
                                '<span class="text-muted">Entry Mode:</span>' +
                                '<span class="font-weight-bold" id="manualModeLabel">' + (entryMode === 'by_dept' ? 'By Department' : entryMode === 'per_unit' ? 'Per-Unit Rate' : 'Fixed Total') + '</span>' +
                            '</div>' +
                            '<div class="d-flex justify-content-between small">' +
                                '<span class="text-muted">Billed Hours:</span>' +
                                '<span>' + this.fmtNum(bases.hours?.totalBilled || 0, 0) + '</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
                
                // Schedule preview update
                var self = this;
                setTimeout(function() { self.updateManualPreview(); }, 100);
            } else if (catType === 'expense') {
                // Integrated account assignment with auto-classification
                var catId = cat.id || '';
                var isNewCategory = !catId || catId === 'new';
                
                var classification = this.latestData.classification || {};
                var catIdStr = String(catId);
                var catClass = !isNewCategory && classification.byCategory ? classification.byCategory[catIdStr] : null;
                var assignedAccounts = catClass ? catClass.accounts || [] : [];
                var autoAccounts = catClass ? catClass.autoAssigned || [] : [];
                var unassigned = classification.unassigned || [];
                var currentPatterns = (cat.patterns || []).join(', ');
                
                // Combine all for multiselect - assigned accounts first
                var allAccounts = [];
                var assignedIds = {};
                
                assignedAccounts.forEach(function(a) { 
                    assignedIds[a.id] = true; 
                    allAccounts.push({ id: a.id, number: a.number, name: a.name || a.fullname, type: a.type, amount: a.amount || 0, assigned: true, auto: false });
                });
                autoAccounts.forEach(function(a) { 
                    if (!assignedIds[a.id]) {
                        assignedIds[a.id] = true;
                        allAccounts.push({ id: a.id, number: a.number, name: a.name || a.fullname, type: a.type, amount: a.amount || 0, assigned: true, auto: true });
                    }
                });
                unassigned.forEach(function(a) { 
                    if (!assignedIds[a.id]) {
                        allAccounts.push({ id: a.id, number: a.number, name: a.name || a.fullname, type: a.type, amount: a.amount || 0, assigned: false, auto: false });
                    }
                });
                
                // Sort: assigned first, then by number
                allAccounts.sort(function(a, b) {
                    if (a.assigned !== b.assigned) return a.assigned ? -1 : 1;
                    return (a.number || '').localeCompare(b.number || '');
                });
                
                // Helper to get short type label and color
                var getTypePill = function(type) {
                    var typeMap = {
                        'Expense': { label: 'Exp', color: '#3b82f6' },
                        'COGS': { label: 'COGS', color: '#f59e0b' },
                        'OthExpense': { label: 'Other', color: '#8b5cf6' }
                    };
                    var info = typeMap[type] || { label: type || '?', color: '#6b7280' };
                    return '<span class="acct-type-pill" style="background: ' + info.color + ';">' + info.label + '</span>';
                };
                
                html = '<div class="flyout-form-section mb-2">' +
                    // Auto-Classification Patterns - at top
                    '<div class="mb-3 p-2 bg-light rounded">' +
                        '<label class="small font-weight-bold d-flex align-items-center">' +
                            '<i class="fas fa-magic text-warning mr-1"></i>Pattern Matching' +
                        '</label>' +
                        '<input type="text" class="form-control form-control-sm mb-2" id="catPatterns" placeholder="e.g., 6%, Rent, Insurance (comma-separated)" value="' + escapeHtml(currentPatterns) + '">' +
                        '<div class="d-flex align-items-center mb-2">' +
                            '<div class="btn-group btn-group-sm flex-grow-1" role="group">' +
                                '<button type="button" class="btn btn-outline-secondary" onclick="BurdenController.previewPatternMatches()" title="Preview which accounts match">' +
                                    '<i class="fas fa-search mr-1"></i>Preview' +
                                '</button>' +
                                '<button type="button" class="btn btn-outline-primary" onclick="BurdenController.applyPatternMatches(false)" title="Select matches (one-time, patterns not saved)">' +
                                    '<i class="fas fa-check mr-1"></i>Apply Once' +
                                '</button>' +
                                '<button type="button" class="btn btn-outline-success" onclick="BurdenController.applyPatternMatches(true)" title="Select matches AND save patterns for auto-matching">' +
                                    '<i class="fas fa-sync mr-1"></i>Apply & Save' +
                                '</button>' +
                            '</div>' +
                        '</div>' +
                        '<small class="text-muted d-block"><strong>Apply Once:</strong> Selects matches now, patterns not saved.<br><strong>Apply & Save:</strong> Selects matches AND saves patterns for future auto-matching.</small>' +
                        '<div id="patternMatchPreview" class="mt-2 small"></div>' +
                    '</div>' +
                    
                    // Account Selection
                    '<div class="d-flex justify-content-between align-items-center mb-2">' +
                        '<h6 class="text-muted mb-0" style="font-size: 0.85rem;"><i class="fas fa-list-check mr-1"></i>Account Assignment</h6>' +
                        '<span class="badge badge-primary" id="accountSelectCount">' + assignedAccounts.length + ' selected</span>' +
                    '</div>' +
                    '<input type="text" class="form-control form-control-sm mb-2" placeholder="Search accounts..." id="accountMultiSearch" oninput="BurdenController.filterAccountMultiselect()">' +
                    '<div class="account-multiselect" id="accountMultiselect" data-category="' + catId + '" style="max-height: 220px; overflow-y: auto; border: 1px solid #dee2e6; border-radius: 4px;">' +
                        allAccounts.map(function(acct) {
                            var amt = parseFloat(acct.amount || acct.balance || acct.total || acct.value || 0);
                            return '<label class="account-select-item' + (acct.assigned ? ' selected' : '') + (acct.auto ? ' auto-suggested' : '') + '" data-account="' + acct.id + '" data-number="' + escapeHtml(acct.number || '') + '" data-name="' + escapeHtml(acct.name || '') + '" data-amount="' + amt + '">' +
                                '<input type="checkbox" ' + (acct.assigned ? 'checked' : '') + ' onchange="BurdenController.onAccountSelectChange(this, \'' + acct.id + '\', \'' + catId + '\')">' +
                                '<span class="acct-number">' + escapeHtml(acct.number || '') + '</span>' +
                                getTypePill(acct.type) +
                                '<span class="acct-name">' + escapeHtml(self.truncateText(acct.name || '', 60)) + '</span>' +
                                '<span class="acct-amount' + (amt <= 0 ? ' text-muted' : '') + '">' + self.formatCurrency(amt) + '</span>' +
                                (acct.auto ? '<i class="fas fa-lightbulb text-warning ml-1" title="Pattern match"></i>' : '') +
                            '</label>';
                        }).join('') +
                    '</div>' +
                    '<div class="mt-2 d-flex justify-content-between">' +
                        '<div>' +
                            '<button class="btn btn-sm btn-outline-secondary mr-1" onclick="BurdenController.selectAllAccounts(\'' + catId + '\', false)">Clear</button>' +
                            '<button class="btn btn-sm btn-outline-primary mr-1" onclick="BurdenController.selectAllAccounts(\'' + catId + '\', true)">Select All</button>' +
                            '<button class="btn btn-sm btn-outline-info" onclick="BurdenController.reorderAccountListSelectedFirst()" title="Move selected accounts to top"><i class="fas fa-sort-amount-up"></i></button>' +
                        '</div>' +
                    '</div>' +
                    
                    // Full Allocation Settings section
                    this.renderAllocationSettings(cat, cat.includeInComposite !== false) +
                    
                    // Live Category Totals - Enhanced design
                    (function() {
                        var bases = self.latestData.allocationBases || {};
                        var allocationBase = cat.allocationBase || 'billed_hours';
                        var baseValue = 0;
                        var baseName = 'Billed Hours';
                        var baseLabel = 'per billed hour';
                        
                        switch (allocationBase) {
                            case 'billed_hours':
                                baseValue = bases.hours?.totalBilled || 0;
                                baseName = 'Billed Hours';
                                baseLabel = 'per billed hour';
                                break;
                            case 'total_hours':
                                baseValue = bases.hours?.total || 0;
                                baseName = 'Total Hours';
                                baseLabel = 'per total hour';
                                break;
                            case 'labor_dollars':
                                baseValue = bases.laborDollars?.total || 0;
                                baseName = 'Labor Dollars';
                                baseLabel = 'per labor $';
                                break;
                            case 'headcount':
                                baseValue = bases.headcount?.total || 0;
                                baseName = 'Headcount';
                                baseLabel = 'per employee';
                                break;
                            case 'revenue':
                                baseValue = bases.revenue?.total || 0;
                                baseName = 'Revenue';
                                baseLabel = '% of revenue';
                                break;
                        }
                        
                        var totalExpense = cat.totalExpense || 0;
                        var rate = cat.totalBurden || (baseValue > 0 ? totalExpense / baseValue : 0);
                        var rateDisplay = (allocationBase === 'revenue' || allocationBase === 'direct_cost') 
                            ? self.fmtNum(rate * 100, 2) + '%'
                            : '$' + self.fmtNum(rate, 2);
                        var baseValueDisplay = (allocationBase === 'revenue' || allocationBase === 'direct_cost' || allocationBase === 'labor_dollars')
                            ? self.formatCurrency(baseValue)
                            : self.fmtNum(baseValue, 0);
                        var accountCount = cat.accountCount || 0;
                        
                        // Show correct initial values from saved category data
                        // updateCategoryLiveTotals() will update when user changes checkboxes
                        return '<div class="category-live-totals" id="categoryLiveTotals">' +
                            '<div class="live-totals-header d-flex justify-content-between align-items-center mb-2">' +
                                '<span class="small font-weight-bold text-muted"><i class="fas fa-calculator mr-1"></i>LIVE CALCULATION</span>' +
                                '<span class="badge badge-light" id="liveAccountCount">' + accountCount + ' account' + (accountCount !== 1 ? 's' : '') + '</span>' +
                            '</div>' +
                            '<div class="live-totals-grid">' +
                                '<div class="live-total-card">' +
                                    '<div class="live-total-value" id="liveTotalExpense">' + self.formatCurrency(totalExpense) + '</div>' +
                                    '<div class="live-total-label">Total Expense</div>' +
                                    '<div class="live-total-sublabel text-muted" id="livePeriodLabel">for selected period</div>' +
                                '</div>' +
                                '<div class="live-total-divider"></div>' +
                                '<div class="live-total-card">' +
                                    '<div class="live-total-value text-primary" id="liveTotalRate">' + rateDisplay + '</div>' +
                                    '<div class="live-total-label">Burden Rate</div>' +
                                    '<div class="live-total-sublabel text-muted" id="liveBaseLabel">' + baseLabel + '</div>' +
                                '</div>' +
                            '</div>' +
                            '<div class="live-totals-footer mt-2 pt-2 border-top">' +
                                '<div class="d-flex justify-content-between small">' +
                                    '<span class="text-muted">Allocation Base:</span>' +
                                    '<span class="font-weight-bold" id="liveBaseName">' + baseName + '</span>' +
                                '</div>' +
                                '<div class="d-flex justify-content-between small">' +
                                    '<span class="text-muted">Base Value:</span>' +
                                    '<span id="liveBaseValue">' + baseValueDisplay + '</span>' +
                                '</div>' +
                            '</div>' +
                        '</div>';
                    })() +
                '</div>';
            } else if (catType === 'derived') {
                // Derived category - percentage of another category
                var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
                var derivedConfig = cat.derivedConfig || {};
                var sourceCategory = derivedConfig.sourceCategory || '';
                var percentage = derivedConfig.percentage || 100;
                
                html = '<div class="flyout-form-section mb-3">' +
                    '<h6 class="text-muted mb-2 d-flex align-items-center">' +
                        '<i class="fas fa-percentage mr-1"></i>Derived Category' +
                        '<span class="info-tooltip ml-2" data-tip="Calculates burden as a percentage of another category\'s expense. Useful for allocating shared costs proportionally.">' +
                            '<i class="fas fa-question-circle text-muted"></i>' +
                        '</span>' +
                    '</h6>' +
                    '<p class="small text-muted mb-3">Calculate this category as a percentage of another category\'s expense.</p>' +
                    
                    '<div class="form-group">' +
                        '<label class="small font-weight-bold">Source Category</label>' +
                        '<select class="form-control form-control-sm" id="derivedSourceCategory" onchange="BurdenController.updateDerivedPreview()">' +
                            '<option value="">Select a category...</option>' +
                            categories.filter(function(c) { return c.id !== cat.id; }).map(function(c) {
                                return '<option value="' + c.id + '"' + (c.id === sourceCategory ? ' selected' : '') + '>' + 
                                    escapeHtml(c.label) + ' (' + self.formatCurrency(c.totalExpense || 0) + ')' +
                                '</option>';
                            }).join('') +
                        '</select>' +
                    '</div>' +
                    
                    '<div class="form-group">' +
                        '<label class="small font-weight-bold">Percentage</label>' +
                        '<div class="input-group input-group-sm">' +
                            '<input type="number" class="form-control" id="derivedPercentage" value="' + percentage + '" min="0" max="1000" step="0.1" oninput="BurdenController.updateDerivedPreview()">' +
                            '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                        '</div>' +
                        '<small class="text-muted">% of source category to allocate</small>' +
                    '</div>' +
                    
                    '<div class="form-group">' +
                        '<label class="small font-weight-bold">Allocation Base (for this category)</label>' +
                        '<select class="form-control form-control-sm" id="derivedAllocationBase" onchange="BurdenController.updateDerivedPreview()">' +
                            '<option value="same"' + ((derivedConfig.allocationBase || 'same') === 'same' ? ' selected' : '') + '>Same as source category</option>' +
                            '<option value="billed_hours"' + (derivedConfig.allocationBase === 'billed_hours' ? ' selected' : '') + '>Billed Hours</option>' +
                            '<option value="total_hours"' + (derivedConfig.allocationBase === 'total_hours' ? ' selected' : '') + '>Total Hours</option>' +
                            '<option value="headcount"' + (derivedConfig.allocationBase === 'headcount' ? ' selected' : '') + '>Headcount</option>' +
                            '<option value="revenue"' + (derivedConfig.allocationBase === 'revenue' ? ' selected' : '') + '>Revenue</option>' +
                        '</select>' +
                        '<small class="text-muted">Allows derived amount to be allocated differently than source</small>' +
                    '</div>' +
                    
                    // Full Allocation Settings section (without base, as derived has special handling)
                    '<div class="allocation-settings-section mt-3 mb-2 p-2 bg-light rounded border">' +
                        '<div class="d-flex align-items-center justify-content-between mb-2">' +
                            '<h6 class="text-muted mb-0" style="font-size: 0.8rem;"><i class="fas fa-cogs mr-1"></i>Additional Settings</h6>' +
                            '<button type="button" class="btn btn-link btn-sm p-0 text-info" onclick="BurdenController.showAllocationExplainer()" title="Learn about allocation settings">' +
                                '<i class="fas fa-question-circle"></i> Help' +
                            '</button>' +
                        '</div>' +
                        '<div class="row">' +
                            '<div class="col-6"><div class="form-group mb-2">' +
                                '<label class="small font-weight-bold">Scope</label>' +
                                '<select class="form-control form-control-sm" id="catScope">' +
                                    '<option value="department"' + ((cat.scope || 'department') === 'department' ? ' selected' : '') + '>By Department</option>' +
                                    '<option value="company"' + (cat.scope === 'company' ? ' selected' : '') + '>Company-wide</option>' +
                                '</select>' +
                            '</div></div>' +
                            '<div class="col-6"><div class="form-group mb-2">' +
                                '<label class="small font-weight-bold">Format</label>' +
                                '<select class="form-control form-control-sm" id="catFormat">' +
                                    '<option value="per_hour"' + ((cat.rateFormat || 'per_hour') === 'per_hour' ? ' selected' : '') + '>$/Hour</option>' +
                                    '<option value="percent_labor"' + (cat.rateFormat === 'percent_labor' ? ' selected' : '') + '>% Labor</option>' +
                                    '<option value="per_fte"' + (cat.rateFormat === 'per_fte' ? ' selected' : '') + '>$/FTE</option>' +
                                '</select>' +
                            '</div></div>' +
                        '</div>' +
                        '<div class="form-check">' +
                            '<input type="checkbox" class="form-check-input" id="catIncludeComposite"' + (cat.includeInComposite !== false ? ' checked' : '') + '>' +
                            '<label class="form-check-label small" for="catIncludeComposite">Include in Composite Rate</label>' +
                        '</div>' +
                    '</div>' +
                    
                    // Live Category Totals - Enhanced design (matching expense type)
                    '<div class="category-live-totals mt-3" id="derivedLiveTotals">' +
                        '<div class="live-totals-header d-flex justify-content-between align-items-center mb-2">' +
                            '<span class="small font-weight-bold text-muted"><i class="fas fa-calculator mr-1"></i>LIVE CALCULATION</span>' +
                            '<span class="badge badge-light" id="derivedPercentBadge">' + percentage + '%</span>' +
                        '</div>' +
                        '<div class="live-totals-grid">' +
                            '<div class="live-total-card">' +
                                '<div class="live-total-value" id="derivedPreviewAmount">$0.00</div>' +
                                '<div class="live-total-label">Derived Amount</div>' +
                                '<div class="live-total-sublabel text-muted" id="derivedSourceLabel">from source category</div>' +
                            '</div>' +
                            '<div class="live-total-divider"></div>' +
                            '<div class="live-total-card">' +
                                '<div class="live-total-value text-primary" id="derivedPreviewRate">$0.00</div>' +
                                '<div class="live-total-label">Burden Rate</div>' +
                                '<div class="live-total-sublabel text-muted">per billed hour</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="live-totals-footer mt-2 pt-2 border-top">' +
                            '<div class="d-flex justify-content-between small">' +
                                '<span class="text-muted">Source Category:</span>' +
                                '<span class="font-weight-bold" id="derivedSourceName">Not selected</span>' +
                            '</div>' +
                            '<div class="d-flex justify-content-between small">' +
                                '<span class="text-muted">Source Expense:</span>' +
                                '<span id="derivedSourceExpense">$0.00</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
                
                // Schedule preview update
                var self = this;
                setTimeout(function() { self.updateDerivedPreview(); }, 100);
            } else if (catType === 'formula') {
                // Formula category - complex calculations
                var self = this;
                var formulaConfig = cat.formulaConfig || {};
                var formula = formulaConfig.formula || '';
                var categories = (this.latestData.summary && this.latestData.summary.categories) || [];
                var bases = this.latestData.allocationBases || {};
                
                html = '<div class="flyout-form-section mb-3">' +
                    '<h6 class="text-muted mb-2 d-flex align-items-center">' +
                        '<i class="fas fa-function mr-1"></i>Formula Category' +
                        '<span class="info-tooltip ml-2" data-tip="Define complex calculations using category values, allocation bases, and arithmetic operators. For advanced cost allocation scenarios.">' +
                            '<i class="fas fa-question-circle text-muted"></i>' +
                        '</span>' +
                    '</h6>' +
                    '<p class="small text-muted mb-3">Create custom calculations using available variables and operators.</p>' +
                    
                    // Available variables reference
                    '<div class="formula-variables mb-3 p-2 bg-light rounded" style="max-height: 150px; overflow-y: auto;">' +
                        '<div class="small font-weight-bold mb-2">Available Variables:</div>' +
                        '<div class="formula-var-grid">' +
                            '<div class="formula-var-section">' +
                                '<div class="text-muted small mb-1">Categories:</div>' +
                                categories.map(function(c) {
                                    return '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\'cat.' + c.id + '\')" title="' + escapeHtml(c.label) + ' ($' + self.fmtNum(c.totalExpense || 0, 0) + ')">cat.' + c.id + '</code>';
                                }).join(' ') +
                            '</div>' +
                            '<div class="formula-var-section mt-2">' +
                                '<div class="text-muted small mb-1">Bases:</div>' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\'base.billed_hours\')" title="Total Billed Hours">base.billed_hours</code> ' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\'base.total_hours\')" title="Total Hours">base.total_hours</code> ' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\'base.headcount\')" title="Total Headcount">base.headcount</code> ' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\'base.revenue\')" title="Total Revenue">base.revenue</code> ' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\'base.labor_dollars\')" title="Labor Dollars">base.labor_dollars</code>' +
                            '</div>' +
                            '<div class="formula-var-section mt-2">' +
                                '<div class="text-muted small mb-1">Operators:</div>' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\' + \')">+</code> ' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\' - \')">-</code> ' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\' * \')">*</code> ' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\' / \')">/</code> ' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\'(\')">( )</code> ' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\'min(\')">min()</code> ' +
                                '<code class="formula-var" onclick="BurdenController.insertFormulaVar(\'max(\')">max()</code>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    '<div class="form-group">' +
                        '<label class="small font-weight-bold">Formula</label>' +
                        '<textarea class="form-control form-control-sm font-monospace" id="formulaExpression" rows="3" placeholder="e.g., (cat.facilities + cat.admin) * 0.5" oninput="BurdenController.validateFormula()">' + escapeHtml(formula) + '</textarea>' +
                        '<div id="formulaValidation" class="small mt-1"></div>' +
                    '</div>' +
                    
                    // Preset formulas
                    '<div class="form-group">' +
                        '<label class="small font-weight-bold">Quick Presets</label>' +
                        '<div class="btn-group btn-group-sm d-flex flex-wrap" style="gap: 4px;">' +
                            '<button type="button" class="btn btn-outline-secondary" onclick="BurdenController.applyFormulaPreset(\'overhead_ratio\')">Overhead Ratio</button>' +
                            '<button type="button" class="btn btn-outline-secondary" onclick="BurdenController.applyFormulaPreset(\'labor_multiplier\')">Labor Multiplier</button>' +
                            '<button type="button" class="btn btn-outline-secondary" onclick="BurdenController.applyFormulaPreset(\'combined_pool\')">Combined Pool</button>' +
                        '</div>' +
                    '</div>' +
                    
                    // Full Allocation Settings section
                    this.renderAllocationSettings(cat, cat.includeInComposite !== false) +
                    
                    // Live Category Totals - Enhanced design (matching expense type)
                    '<div class="category-live-totals mt-3" id="formulaLiveTotals">' +
                        '<div class="live-totals-header d-flex justify-content-between align-items-center mb-2">' +
                            '<span class="small font-weight-bold text-muted"><i class="fas fa-calculator mr-1"></i>LIVE CALCULATION</span>' +
                            '<span id="formulaValidationStatus" class="small"></span>' +
                        '</div>' +
                        '<div class="live-totals-grid">' +
                            '<div class="live-total-card">' +
                                '<div class="live-total-value" id="formulaPreviewAmount">$0.00</div>' +
                                '<div class="live-total-label">Calculated Amount</div>' +
                                '<div class="live-total-sublabel text-muted">from formula</div>' +
                            '</div>' +
                            '<div class="live-total-divider"></div>' +
                            '<div class="live-total-card">' +
                                '<div class="live-total-value text-primary" id="formulaPreviewRate">$0.00</div>' +
                                '<div class="live-total-label">Burden Rate</div>' +
                                '<div class="live-total-sublabel text-muted">per billed hour</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="live-totals-footer mt-2 pt-2 border-top">' +
                            '<div class="d-flex justify-content-between small">' +
                                '<span class="text-muted">Billed Hours:</span>' +
                                '<span>' + self.fmtNum(bases.hours?.totalBilled || 0, 0) + '</span>' +
                            '</div>' +
                            '<div class="d-flex justify-content-between small">' +
                                '<span class="text-muted">Labor Dollars:</span>' +
                                '<span>' + self.formatCurrency(bases.laborDollars?.total || 0) + '</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
                
                // Schedule validation
                setTimeout(function() { self.validateFormula(); }, 100);
            }
            
            return html;
        },

        // Direct account action functions (called from onclick)
        onAccountSelectChange: function(checkbox, accountId, categoryId) {
            var self = this;
            if (!this.pendingCategoryChanges) {
                this.pendingCategoryChanges = { added: {}, removed: {}, confirmed: {} };
            }
            
            var label = checkbox.closest('.account-select-item');
            if (checkbox.checked) {
                // Add account
                this.stageAccountAssignment(accountId, categoryId);
                if (label) label.classList.add('selected');
            } else {
                // Remove account
                this.removeAccountFromCategory(accountId, categoryId);
                if (label) label.classList.remove('selected');
            }
            
            // Update count badge
            var container = el('#accountMultiselect');
            if (container) {
                var checkedCount = container.querySelectorAll('input[type="checkbox"]:checked').length;
                var countBadge = el('#accountSelectCount');
                if (countBadge) countBadge.textContent = checkedCount + ' selected';
            }
            
            this.updatePendingChangesUI();
            this.updateCategoryLiveTotals();
        },
        
        filterAccountMultiselect: function() {
            var searchInput = el('#accountMultiSearch');
            var container = el('#accountMultiselect');
            if (!searchInput || !container) return;
            
            var term = searchInput.value.toLowerCase();
            var items = container.querySelectorAll('.account-select-item');
            
            items.forEach(function(item) {
                var number = (item.getAttribute('data-number') || '').toLowerCase();
                var name = (item.getAttribute('data-name') || '').toLowerCase();
                var match = !term || number.includes(term) || name.includes(term);
                item.style.display = match ? '' : 'none';
            });
        },
        
        updateCategoryLiveTotals: function() {
            var self = this;
            var container = el('#accountMultiselect');
            var totalsContainer = el('#categoryLiveTotals');
            if (!container || !totalsContainer) return;
            
            // Get category ID we're editing
            var categoryId = el('#catOriginalId')?.value || el('#catId')?.value || container.getAttribute('data-category') || '';
            
            // Get saved category data (merged definition + summary)
            var savedCat = null;
            if (categoryId) {
                var categoryDefs = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
                var catDef = categoryDefs.find(function(c) { return c.id === categoryId; });
                var summaryCategories = (this.latestData.summary && this.latestData.summary.categories) || [];
                var catSummary = summaryCategories.find(function(c) { return c.id === categoryId; });
                savedCat = catDef ? Object.assign({}, catDef, catSummary || {}) : catSummary;
            }
            
            // Calculate total from selected accounts using data-amount attribute
            var totalExpense = 0;
            var accountCount = 0;
            var selectedAccountIds = [];
            var checkedItems = container.querySelectorAll('input[type="checkbox"]:checked');
            checkedItems.forEach(function(cb) {
                var label = cb.closest('.account-select-item');
                if (label) {
                    var amount = parseFloat(label.getAttribute('data-amount')) || 0;
                    var accountId = label.getAttribute('data-account');
                    totalExpense += amount;
                    accountCount++;
                    if (accountId) selectedAccountIds.push(accountId);
                }
            });
            
            // Get allocation base from catBase selector
            var mainBase = el('#catBase');
            var allocationBase = mainBase ? mainBase.value : 'billed_hours';
            
            // Check if allocation base changed from saved value
            var savedAllocationBase = savedCat?.allocationBase || 'billed_hours';
            var allocationBaseChanged = allocationBase !== savedAllocationBase;
            
            // Check if accounts changed from saved - compare selected IDs with saved assignment
            var savedAccountIds = [];
            if (categoryId && this.latestData.classification?.byCategory?.[categoryId]?.accounts) {
                savedAccountIds = this.latestData.classification.byCategory[categoryId].accounts.map(function(a) { return String(a.id); });
            }
            selectedAccountIds = selectedAccountIds.map(function(id) { return String(id); }).sort();
            savedAccountIds = savedAccountIds.sort();
            var accountsChanged = selectedAccountIds.join(',') !== savedAccountIds.join(',');
            
            var bases = this.latestData.allocationBases || {};
            var baseValue = 0;
            var baseName = 'Billed Hours';
            var baseLabel = 'per billed hour';
            
            switch (allocationBase) {
                case 'billed_hours':
                    baseValue = bases.hours?.totalBilled || 0;
                    baseName = 'Billed Hours';
                    baseLabel = 'per billed hour';
                    break;
                case 'total_hours':
                    baseValue = bases.hours?.total || 0;
                    baseName = 'Total Hours';
                    baseLabel = 'per total hour';
                    break;
                case 'labor_dollars':
                    baseValue = bases.laborDollars?.total || 0;
                    baseName = 'Labor Dollars';
                    baseLabel = 'per labor $';
                    break;
                case 'headcount':
                    baseValue = bases.headcount?.total || 0;
                    baseName = 'Headcount';
                    baseLabel = 'per employee';
                    break;
                case 'revenue':
                    baseValue = bases.revenue?.total || 0;
                    baseName = 'Revenue';
                    baseLabel = '% of revenue';
                    break;
                case 'direct_cost':
                    baseValue = bases.directCost?.total || 0;
                    baseName = 'Direct Cost';
                    baseLabel = '% of direct cost';
                    break;
                default:
                    baseValue = bases.hours?.totalBilled || 0;
            }
            
            // Use saved values if nothing changed, recalculate if accounts or base changed
            var rate;
            var displayExpense;
            
            if (!accountsChanged && !allocationBaseChanged && savedCat && savedCat.totalBurden !== undefined) {
                // Use saved values - these match the backend calculation exactly
                rate = savedCat.totalBurden || 0;
                displayExpense = savedCat.totalExpense || 0;
            } else {
                // User changed something - recalculate (will be approximate until saved)
                rate = baseValue > 0 ? totalExpense / baseValue : 0;
                displayExpense = totalExpense;
            }
            
            // Update all display elements
            var expenseEl = el('#liveTotalExpense');
            var rateEl = el('#liveTotalRate');
            var countEl = el('#liveAccountCount');
            var baseNameEl = el('#liveBaseName');
            var baseValueEl = el('#liveBaseValue');
            var baseLabelEl = el('#liveBaseLabel');
            
            if (expenseEl) expenseEl.textContent = this.formatCurrency(displayExpense);
            if (rateEl) {
                if (allocationBase === 'revenue' || allocationBase === 'direct_cost') {
                    rateEl.textContent = this.fmtNum(rate * 100, 2) + '%';
                } else {
                    rateEl.textContent = '$' + this.fmtNum(rate, 2);
                }
            }
            if (countEl) countEl.textContent = accountCount + ' account' + (accountCount !== 1 ? 's' : '');
            if (baseNameEl) baseNameEl.textContent = baseName;
            if (baseValueEl) {
                if (allocationBase === 'revenue' || allocationBase === 'direct_cost' || allocationBase === 'labor_dollars') {
                    baseValueEl.textContent = this.formatCurrency(baseValue);
                } else {
                    baseValueEl.textContent = this.fmtNum(baseValue, 0);
                }
            }
            if (baseLabelEl) baseLabelEl.textContent = baseLabel;
        },
        
        
        selectAllAccounts: function(categoryId, selectAll) {
            var self = this;
            var container = el('#accountMultiselect');
            if (!container) return;
            
            if (!this.pendingCategoryChanges) {
                this.pendingCategoryChanges = { added: {}, removed: {}, confirmed: {} };
            }
            
            var checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(function(cb) {
                var label = cb.closest('.account-select-item');
                var accountId = label ? label.getAttribute('data-account') : null;
                if (!accountId) return;
                
                // Only process visible items
                if (label && label.style.display === 'none') return;
                
                if (selectAll && !cb.checked) {
                    cb.checked = true;
                    self.stageAccountAssignment(accountId, categoryId);
                    if (label) label.classList.add('selected');
                } else if (!selectAll && cb.checked) {
                    cb.checked = false;
                    self.removeAccountFromCategory(accountId, categoryId);
                    if (label) label.classList.remove('selected');
                }
            });
            
            // Update count
            var checkedCount = container.querySelectorAll('input[type="checkbox"]:checked').length;
            var countBadge = el('#accountSelectCount');
            if (countBadge) countBadge.textContent = checkedCount + ' selected';
            
            this.updatePendingChangesUI();
            this.updateCategoryLiveTotals();
        },

        previewPatternMatches: function() {
            var self = this;
            var patternsInput = el('#catPatterns');
            var previewEl = el('#patternMatchPreview');
            if (!patternsInput || !previewEl) return;
            
            var patterns = patternsInput.value.split(',').map(function(p) { return p.trim().toLowerCase(); }).filter(function(p) { return p.length > 0; });
            if (patterns.length === 0) {
                previewEl.innerHTML = '<span class="text-warning"><i class="fas fa-exclamation-circle mr-1"></i>Enter patterns to search</span>';
                return;
            }
            
            // Find matching accounts in the multiselect
            var container = el('#accountMultiselect');
            if (!container) return;
            
            var matches = [];
            var alreadySelected = [];
            container.querySelectorAll('.account-select-item').forEach(function(item) {
                var number = (item.getAttribute('data-number') || '').toLowerCase();
                var name = (item.getAttribute('data-name') || '').toLowerCase();
                var isChecked = item.querySelector('input[type="checkbox"]')?.checked;
                
                var matched = patterns.some(function(p) {
                    if (p.endsWith('%')) {
                        // Prefix match on account number
                        return number.startsWith(p.slice(0, -1));
                    }
                    return number.includes(p) || name.includes(p);
                });
                
                if (matched) {
                    if (!isChecked) {
                        matches.push({
                            number: item.getAttribute('data-number'),
                            name: item.getAttribute('data-name')
                        });
                        // Highlight the item
                        item.classList.add('pattern-match');
                    } else {
                        alreadySelected.push(item.getAttribute('data-number'));
                        item.classList.remove('pattern-match');
                    }
                } else {
                    item.classList.remove('pattern-match');
                }
            });
            
            // Build preview message
            var msg = '';
            if (matches.length > 0) {
                msg = '<div class="text-success mb-1"><i class="fas fa-check-circle mr-1"></i><strong>' + matches.length + ' new matches</strong> will be selected:</div>';
                msg += '<div class="small text-muted" style="max-height: 80px; overflow-y: auto;">';
                matches.slice(0, 10).forEach(function(m) {
                    msg += '<div class="text-truncate">' + escapeHtml(m.number) + ' - ' + escapeHtml(m.name) + '</div>';
                });
                if (matches.length > 10) {
                    msg += '<div class="text-muted">...and ' + (matches.length - 10) + ' more</div>';
                }
                msg += '</div>';
            } else {
                msg = '<span class="text-muted"><i class="fas fa-info-circle mr-1"></i>No new matches (patterns: ' + patterns.join(', ') + ')</span>';
            }
            if (alreadySelected.length > 0) {
                msg += '<div class="text-muted small mt-1">' + alreadySelected.length + ' already selected</div>';
            }
            previewEl.innerHTML = msg;
        },
        
        applyPatternMatches: function(savePatterns) {
            var self = this;
            var container = el('#accountMultiselect');
            if (!container) return;
            
            var catId = container.getAttribute('data-category');
            var applied = 0;
            
            // First run preview to highlight matches
            this.previewPatternMatches();
            
            container.querySelectorAll('.account-select-item.pattern-match').forEach(function(item) {
                var cb = item.querySelector('input[type="checkbox"]');
                var accountId = item.getAttribute('data-account');
                
                if (cb && !cb.checked && accountId) {
                    cb.checked = true;
                    item.classList.add('selected');
                    item.classList.remove('pattern-match');
                    self.stageAccountAssignment(accountId, catId);
                    applied++;
                }
            });
            
            // Update count
            var checkedCount = container.querySelectorAll('input[type="checkbox"]:checked').length;
            var countBadge = el('#accountSelectCount');
            if (countBadge) countBadge.textContent = checkedCount + ' selected';
            
            // Handle pattern saving
            var previewEl = el('#patternMatchPreview');
            var patternsInput = el('#catPatterns');
            if (savePatterns) {
                // Keep patterns in input - they will be saved with the category
                this._savePatternOnCategorySave = true;
                if (previewEl) {
                    previewEl.innerHTML = '<span class="text-success"><i class="fas fa-check mr-1"></i>Applied ' + applied + ' accounts. Patterns will be saved.</span>';
                }
                showToast(applied + ' accounts selected. Patterns will be saved when you click Save.', 'success');
            } else {
                // Clear patterns from input since this is one-time only
                this._savePatternOnCategorySave = false;
                if (patternsInput) {
                    patternsInput.value = ''; // Clear so patterns won't be saved
                }
                if (previewEl) {
                    previewEl.innerHTML = '<span class="text-success"><i class="fas fa-check mr-1"></i>Applied ' + applied + ' accounts (one-time, patterns cleared).</span>';
                }
                showToast(applied + ' accounts selected (one-time, patterns not saved).', 'info');
            }
            
            // Reorder list so selected items appear at top
            this.reorderAccountListSelectedFirst();
            
            this.updatePendingChangesUI();
        },
        
        reorderAccountListSelectedFirst: function() {
            var container = el('#accountMultiselect');
            if (!container) return;
            
            var items = Array.from(container.querySelectorAll('.account-select-item'));
            if (items.length === 0) return;
            
            // Partition: selected first, then unselected
            var selected = [];
            var unselected = [];
            
            items.forEach(function(item) {
                var cb = item.querySelector('input[type="checkbox"]');
                if (cb && cb.checked) {
                    selected.push(item);
                } else {
                    unselected.push(item);
                }
            });
            
            // Re-append in order (selected first, then unselected)
            // This moves DOM nodes without cloning
            selected.forEach(function(item) {
                container.appendChild(item);
            });
            unselected.forEach(function(item) {
                container.appendChild(item);
            });
            
            // Scroll to top to show selected items
            container.scrollTop = 0;
        },

        doAddAccount: function(accountId, categoryId) {
            console.log('doAddAccount called:', accountId, categoryId);
            if (!this.pendingCategoryChanges) {
                this.pendingCategoryChanges = { added: {}, removed: {}, confirmed: {} };
            }
            this.stageAccountAssignment(accountId, categoryId);
            this.refreshFlyoutAccountsSection(categoryId);
        },
        
        doRemoveAccount: function(accountId, categoryId) {
            console.log('doRemoveAccount called:', accountId, categoryId);
            if (!this.pendingCategoryChanges) {
                this.pendingCategoryChanges = { added: {}, removed: {}, confirmed: {} };
            }
            this.removeAccountFromCategory(accountId, categoryId);
            this.refreshFlyoutAccountsSection(categoryId);
        },
        
        doConfirmAccount: function(accountId, categoryId) {
            console.log('doConfirmAccount called:', accountId, categoryId);
            if (!this.pendingCategoryChanges) {
                this.pendingCategoryChanges = { added: {}, removed: {}, confirmed: {} };
            }
            this.confirmAutoAssign(accountId, categoryId);
            this.refreshFlyoutAccountsSection(categoryId);
        },
        
        doRejectAccount: function(accountId, categoryId) {
            console.log('doRejectAccount called:', accountId, categoryId);
            if (!this.pendingCategoryChanges) {
                this.pendingCategoryChanges = { added: {}, removed: {}, confirmed: {} };
            }
            this.rejectAutoAssign(accountId, categoryId);
            this.refreshFlyoutAccountsSection(categoryId);
        },
        
        removeAccountInFlyout: function(accountId, categoryId, event) {
            if (event) { event.preventDefault(); event.stopPropagation(); }
            this.removeAccountFromCategory(accountId, categoryId);
            this.refreshFlyoutAccountsSection(categoryId);
        },

        confirmAccountInFlyout: function(accountId, categoryId, event) {
            if (event) { event.preventDefault(); event.stopPropagation(); }
            this.confirmAutoAssign(accountId, categoryId);
            this.refreshFlyoutAccountsSection(categoryId);
        },

        rejectAccountInFlyout: function(accountId, categoryId, event) {
            if (event) { event.preventDefault(); event.stopPropagation(); }
            this.rejectAutoAssign(accountId, categoryId);
            this.refreshFlyoutAccountsSection(categoryId);
        },

        addAccountInFlyout: function(accountId, categoryId, event) {
            if (event) { event.preventDefault(); event.stopPropagation(); }
            this.stageAccountAssignment(accountId, categoryId);
            this.refreshFlyoutAccountsSection(categoryId);
        },
        
        dismissUnassignedAccount: function(accountId) {
            // Add to dismissed list
            if (!this.latestData.meta) this.latestData.meta = {};
            if (!this.latestData.meta.dismissedAccounts) this.latestData.meta.dismissedAccounts = [];
            if (!this.latestData.meta.dismissedAccounts.includes(accountId)) {
                this.latestData.meta.dismissedAccounts.push(accountId);
            }
            
            // Save to server
            API.post('burden', { 
                subAction: 'dismiss_account', 
                accountId: accountId 
            }).then(function() {
                showToast('Account dismissed', 'info');
            });
            
            // Refresh flyout if open
            var catId = el('#catId')?.value;
            if (catId) {
                this.refreshFlyoutAccountsSection(catId);
            }
            this.renderCategoriesTab();
        },
        
        refreshCategoryData: function() {
            var self = this;
            showToast('Refreshing data...', 'info');
            this.loadData().then(function() {
                showToast('Data refreshed', 'success');
            });
        },
        
        refreshFlyoutAccountsSection: function(categoryId) {
            var self = this;
            var classification = this.latestData.classification || {};
            var catIdStr = String(categoryId);
            var catClass = classification.byCategory && classification.byCategory[catIdStr];
            var accounts = catClass ? catClass.accounts || [] : [];
            var autoAccounts = catClass ? catClass.autoAssigned || [] : [];
            var unassigned = classification.unassigned || [];
            
            // Update assigned accounts list
            var assignedList = el('#flyoutAccountsList');
            if (assignedList) {
                assignedList.innerHTML = accounts.length > 0 ? accounts.map(function(acct) {
                    return '<div class="flyout-account-item d-flex align-items-center">' +
                        '<div class="fai-info flex-grow-1">' +
                            '<span class="fai-number">' + escapeHtml(acct.number || '') + '</span>' +
                            '<span class="fai-name">' + escapeHtml(self.truncateText(acct.name || acct.fullname || '', 30)) + '</span>' +
                        '</div>' +
                        '<div class="fai-amount mr-2">' + self.formatCurrency(acct.amount || 0) + '</div>' +
                        '<button type="button" class="btn btn-sm btn-link text-danger p-0" onclick="BurdenController.doRemoveAccount(\'' + acct.id + '\', \'' + categoryId + '\')" title="Remove"><i class="fas fa-times"></i></button>' +
                    '</div>';
                }).join('') : '<div class="text-muted small py-1 px-2">No accounts assigned</div>';
            }
            
            // Update unassigned list
            var unassignedList = el('#flyoutUnassignedList');
            if (unassignedList) {
                unassignedList.innerHTML = unassigned.slice(0, 20).map(function(acct) {
                    return '<div class="flyout-account-item flyout-add-item d-flex align-items-center" style="cursor: pointer;" onclick="BurdenController.doAddAccount(\'' + acct.id + '\', \'' + categoryId + '\')">' +
                        '<div class="fai-info flex-grow-1">' +
                            '<span class="fai-number">' + escapeHtml(acct.number || '') + '</span>' +
                            '<span class="fai-name">' + escapeHtml(self.truncateText(acct.name || acct.fullname || '', 25)) + '</span>' +
                        '</div>' +
                        '<div class="fai-amount mr-2">' + self.formatCurrency(acct.amount || 0) + '</div>' +
                        '<i class="fas fa-plus-circle text-success"></i>' +
                    '</div>';
                }).join('') + (unassigned.length > 20 ? '<div class="text-muted small text-center py-1">+' + (unassigned.length - 20) + ' more</div>' : '');
            }
            
            // Update count badges
            var assignedHeader = document.querySelector('#catTypeConfig h6 .badge-secondary');
            if (assignedHeader) assignedHeader.textContent = accounts.length;
        },

        filterFlyoutAccounts: function() {
            var searchTerm = (el('#flyoutAccountSearch')?.value || '').toLowerCase();
            var items = document.querySelectorAll('#flyoutUnassignedList .flyout-add-item');
            items.forEach(function(item) {
                var text = item.textContent.toLowerCase();
                item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
            });
        },

        updateCategoryTypeUI: function() {
            var selectedType = document.querySelector('input[name="catType"]:checked')?.value || 'expense';
            var catId = el('#catId')?.value || el('#catIdInput')?.value || '';
            
            // For new categories, create a temporary cat object
            var cat;
            if (catId) {
                // Get category definition (for config)
                var categoryDefs = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
                var catDef = categoryDefs.find(function(c) { return c.id === catId; });
                
                // Get calculated values from summary (for display) 
                var summaryCategories = (this.latestData.summary && this.latestData.summary.categories) || [];
                var catSummary = summaryCategories.find(function(c) { return c.id === catId; });
                
                // Merge definition with summary - summary values override for calculated fields
                // This ensures totalBurden, totalExpense etc are available
                cat = catDef ? Object.assign({}, catDef, catSummary || {}) : catSummary;
            }
            
            // Ensure we have a valid cat object
            if (!cat) {
                cat = { 
                    id: catId || 'new', 
                    label: el('#catLabel')?.value || '', 
                    color: el('#catColor')?.value || '#3b82f6',
                    categoryType: selectedType
                };
            }
            
            // Update selected styling for both compact and full-size selectors
            document.querySelectorAll('.ct-option, .ct-opt-sm').forEach(function(opt) {
                var input = opt.querySelector('input');
                if (input) {
                    opt.classList.toggle('ct-selected', input.value === selectedType);
                }
            });
            
            // Update type-specific config
            var configContainer = el('#catTypeConfig');
            if (configContainer) {
                configContainer.innerHTML = this.renderCategoryTypeConfig(cat, selectedType);
                // Initialize tooltips and update live calculation after DOM update
                var self = this;
                setTimeout(function() { 
                    self.initTooltips(); 
                    self.updateCategoryLiveTotals();
                    // Also trigger type-specific preview updates
                    if (selectedType === 'timebill') {
                        self.updateTimeCategoryPreview();
                    } else if (selectedType === 'manual') {
                        self.updateManualPreview();
                    } else if (selectedType === 'derived') {
                        self.updateDerivedPreview();
                    } else if (selectedType === 'formula') {
                        self.validateFormula();
                    }
                }, 50);
            }
        },

        saveCategory: function(existingId) {
            var self = this;
            var newCatId = el('#catId').value.trim();
            var originalId = el('#catOriginalId')?.value || existingId;
            var catType = document.querySelector('input[name="catType"]:checked')?.value || 'expense';
            var patterns = (el('#catPatterns')?.value || '').split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; });
            
            // Validate category ID
            if (!newCatId) {
                alert('Category ID is required');
                return;
            }
            
            // Check if ID changed and new ID already exists
            var idChanged = originalId && newCatId !== originalId;
            if (idChanged) {
                var summaryCategories = (self.latestData.summary && self.latestData.summary.categories) || [];
                var idExists = summaryCategories.some(function(c) { return c.id === newCatId; });
                if (idExists) {
                    alert('Category ID "' + newCatId + '" already exists. Please choose a different ID.');
                    return;
                }
            }
            
            console.log('[SaveCategory] catType:', catType, 'newCatId:', newCatId, 'originalId:', originalId, 'idChanged:', idChanged);
            console.log('[SaveCategory] pendingCategoryChanges:', JSON.stringify(self.pendingCategoryChanges || {}));

            // Get existing category to preserve calculated values
            var existingCat = null;
            if (originalId) {
                var summaryCategories = (self.latestData.summary && self.latestData.summary.categories) || [];
                existingCat = summaryCategories.find(function(c) { return c.id === originalId; });
            }

            var categoryData = {
                id: newCatId,
                originalId: idChanged ? originalId : undefined, // Signal backend to handle ID change
                label: el('#catLabel').value,
                color: el('#catColor').value,
                categoryType: catType,
                allocationBase: el('#catBase')?.value || 'billed_hours',
                allocationMethod: el('#catMethod') ? el('#catMethod').value : 'simple',
                scope: el('#catScope').value,
                rateFormat: el('#catFormat') ? el('#catFormat').value : 'per_hour',
                includeInComposite: el('#catIncludeComposite') ? el('#catIncludeComposite').checked : true,
                patterns: patterns
            };
            
            // Preserve calculated values from existing category (except accountCount which is dynamic)
            if (existingCat) {
                categoryData.totalExpense = existingCat.totalExpense || 0;
                categoryData.totalBurden = existingCat.totalBurden || 0;
                categoryData.expense = existingCat.expense;
                categoryData.burden = existingCat.burden;
                // Note: accountCount is NOT preserved - it should be calculated dynamically from classification
            }

            // Capture allocation method configuration
            if (categoryData.allocationMethod === 'weighted') {
                var weights = {};
                document.querySelectorAll('.dept-weight-input').forEach(function(input) {
                    var deptId = input.getAttribute('data-dept-id');
                    weights[deptId] = parseFloat(input.value) || 1.0;
                });
                categoryData.allocationWeights = weights;
            } else if (categoryData.allocationMethod === 'stepped') {
                var tiers = [];
                document.querySelectorAll('.tier-row').forEach(function(row) {
                    var minHours = parseFloat(row.querySelector('.tier-min')?.value) || 0;
                    var maxHours = parseFloat(row.querySelector('.tier-max')?.value) || 999999;
                    var rate = parseFloat(row.querySelector('.tier-rate')?.value) || 0;
                    tiers.push({ min: minHours, max: maxHours, rate: rate });
                });
                categoryData.allocationTiers = tiers;
            }

            // Add type-specific filters
            if (catType === 'timebill') {
                // Get saved filters as baseline (in case UI elements not fully loaded)
                var savedCat = null;
                var categoryDefs = (this.latestData.meta && this.latestData.meta.categoryDefinitions) || [];
                savedCat = categoryDefs.find(function(c) { return c.id === originalId; });
                var savedFilters = (savedCat && savedCat.timeFilters) || {};
                
                // Employee type exclusions - preserve saved if UI not loaded
                var empTypeCheckboxes = document.querySelectorAll('.time-exclude-emp');
                var excludeEmpTypes;
                if (empTypeCheckboxes.length > 0) {
                    excludeEmpTypes = [];
                    document.querySelectorAll('.time-exclude-emp:checked').forEach(function(cb) {
                        excludeEmpTypes.push(cb.value);
                    });
                } else {
                    // UI not loaded, preserve saved config
                    excludeEmpTypes = savedFilters.excludeEmpTypes || [];
                }
                
                // Service items - preserve saved if UI not loaded
                var serviceCheckboxes = document.querySelectorAll('.time-service-item');
                var serviceItems;
                if (serviceCheckboxes.length > 0) {
                    serviceItems = [];
                    document.querySelectorAll('.time-service-item:checked').forEach(function(cb) {
                        serviceItems.push(cb.value);
                    });
                } else {
                    serviceItems = savedFilters.serviceItems || [];
                }
                
                // Gather selected departments (multiselect) - preserve saved if UI not loaded
                var deptCheckboxes = document.querySelectorAll('.time-dept-filter');
                var departmentIds;
                if (deptCheckboxes.length > 0) {
                    var allDeptsChecked = true;
                    departmentIds = [];
                    deptCheckboxes.forEach(function(cb) {
                        if (cb.checked) {
                            departmentIds.push(cb.value);
                        } else {
                            allDeptsChecked = false;
                        }
                    });
                    // If all are checked, store empty array (means "all departments")
                    if (allDeptsChecked) {
                        departmentIds = [];
                    }
                } else {
                    departmentIds = savedFilters.departmentIds || [];
                }
                
                categoryData.timeFilters = {
                    includeBillable: el('#timeIncludeBillable') ? el('#timeIncludeBillable').checked : (savedFilters.includeBillable !== false),
                    includeNonBillable: el('#timeIncludeNonBillable') ? el('#timeIncludeNonBillable').checked : (savedFilters.includeNonBillable || false),
                    billableDefinition: el('#timeBillableDefinition')?.value || savedFilters.billableDefinition || 'customer',
                    departmentIds: departmentIds,
                    excludeEmpTypes: excludeEmpTypes,
                    serviceItems: serviceItems,
                    costMethod: el('#timeCostMethod')?.value || savedFilters.costMethod || 'employee_rate',
                    customRate: parseFloat(el('#timeCustomRate')?.value) || savedFilters.customRate || 50
                };
            } else if (catType === 'manual' || catType === 'headcount' || catType === 'revenue') {
                // Manual type (includes migrated headcount/revenue)
                var activeBtn = document.querySelector('.manual-mode-btn.active');
                var entryMode = activeBtn ? activeBtn.getAttribute('data-mode') : 'fixed_total';
                
                var manualConfig = {
                    entryMode: entryMode
                };
                
                if (entryMode === 'fixed_total') {
                    manualConfig.fixedTotal = parseFloat(el('#manualFixedTotal')?.value) || 0;
                } else if (entryMode === 'by_dept') {
                    var byDeptAmounts = {};
                    document.querySelectorAll('.dept-amount-input').forEach(function(input) {
                        var deptId = input.getAttribute('data-dept-id');
                        var amt = parseFloat(input.value) || 0;
                        if (amt > 0) byDeptAmounts[deptId] = amt;
                    });
                    manualConfig.byDeptAmounts = byDeptAmounts;
                } else if (entryMode === 'per_unit') {
                    manualConfig.unitType = el('#manualUnitType')?.value || 'headcount';
                    manualConfig.perUnitRate = parseFloat(el('#manualPerUnitRate')?.value) || 0;
                }
                
                categoryData.manualConfig = manualConfig;
                categoryData.categoryType = 'manual'; // Normalize legacy types
            } else if (catType === 'derived') {
                // Derived category configuration
                var derivedAllocBase = el('#derivedAllocationBase')?.value || 'same';
                categoryData.derivedConfig = {
                    sourceCategory: el('#derivedSourceCategory')?.value || '',
                    percentage: parseFloat(el('#derivedPercentage')?.value) || 100,
                    allocationBase: derivedAllocBase
                };
                // Set main allocationBase for consistent handling (unless "same")
                if (derivedAllocBase !== 'same') {
                    categoryData.allocationBase = derivedAllocBase;
                }
            } else if (catType === 'formula') {
                // Formula category configuration
                categoryData.formulaConfig = {
                    formula: (el('#formulaExpression')?.value || '').trim()
                };
            }
            
            // ALWAYS capture account assignments if the multiselect container exists
            // This is done OUTSIDE the catType check to ensure accounts are captured
            // regardless of what category type is detected
            var accountMultiselect = el('#accountMultiselect');
            console.log('[SaveCategory] accountMultiselect element:', accountMultiselect);
            if (accountMultiselect) {
                var accountIds = [];
                var checkboxes = accountMultiselect.querySelectorAll('input[type="checkbox"]');
                console.log('[SaveCategory] Total checkboxes found:', checkboxes.length);
                
                var checkedCount = 0;
                var uncheckedCount = 0;
                var uncheckedIds = [];
                checkboxes.forEach(function(cb) {
                    var label = cb.closest('.account-select-item');
                    if (label) {
                        var accountId = label.getAttribute('data-account');
                        // Use the actual checkbox checked state from the DOM
                        var isChecked = cb.checked;
                        if (isChecked) {
                            checkedCount++;
                            if (accountId) accountIds.push(accountId);
                        } else {
                            uncheckedCount++;
                            if (accountId) uncheckedIds.push(accountId);
                        }
                    }
                });
                
                console.log('[SaveCategory] Checked:', checkedCount, 'Unchecked:', uncheckedCount);
                console.log('[SaveCategory] Unchecked IDs:', JSON.stringify(uncheckedIds));
                
                // Cross-check with pendingCategoryChanges
                var catIdStr = String(newCatId);
                var pendingRemoved = (self.pendingCategoryChanges && self.pendingCategoryChanges.removed && self.pendingCategoryChanges.removed[catIdStr]) || [];
                console.log('[SaveCategory] pendingCategoryChanges.removed:', JSON.stringify(pendingRemoved));
                
                // If there are pending removed accounts that ARE in the checked list, something is wrong
                // Remove them explicitly
                if (pendingRemoved.length > 0) {
                    var beforeCount = accountIds.length;
                    accountIds = accountIds.filter(function(id) {
                        return !pendingRemoved.includes(id) && !pendingRemoved.includes(String(id));
                    });
                    if (accountIds.length !== beforeCount) {
                        console.warn('[SaveCategory] FIXED: Removed', beforeCount - accountIds.length, 'accounts that were in pendingRemoved but still checked in DOM!');
                    }
                }
                
                // ALWAYS set accountIds when multiselect exists (even if empty to clear assignments)
                categoryData.accountIds = accountIds;
                console.log('[SaveCategory] Final accountIds array (' + accountIds.length + ' accounts):', JSON.stringify(accountIds.slice(0, 10)) + (accountIds.length > 10 ? '...' : ''));
                
                // Update local classification immediately
                if (self.latestData.classification && self.latestData.classification.byCategory) {
                    var allAccounts = self.latestData.accounts?.all || [];
                    var unassigned = self.latestData.classification.unassigned || [];
                    var catIdStr = String(categoryData.id);
                    
                    console.log('[SaveCategory] Updating local classification for category:', catIdStr);
                    
                    // Get OLD accounts from this category before update
                    var oldCatData = self.latestData.classification.byCategory[catIdStr];
                    var oldAccounts = (oldCatData && oldCatData.accounts) ? oldCatData.accounts : [];
                    console.log('[SaveCategory] Previous count:', oldAccounts.length);
                    
                    // Build set of new account IDs
                    var newAccountSet = {};
                    accountIds.forEach(function(id) { newAccountSet[String(id)] = true; });
                    
                    // Find accounts that were REMOVED (in old but not in new)
                    var removedAccounts = oldAccounts.filter(function(a) {
                        return !newAccountSet[String(a.id)];
                    });
                    console.log('[SaveCategory] Removed accounts:', removedAccounts.length);
                    
                    // Add removed accounts to unassigned
                    if (removedAccounts.length > 0) {
                        // Make sure we don't add duplicates
                        var unassignedSet = {};
                        unassigned.forEach(function(a) { unassignedSet[String(a.id)] = true; });
                        
                        removedAccounts.forEach(function(acct) {
                            if (!unassignedSet[String(acct.id)]) {
                                unassigned.push(acct);
                                unassignedSet[String(acct.id)] = true;
                            }
                        });
                    }
                    
                    // Build new assigned accounts list
                    var newAssigned = accountIds.map(function(aid) {
                        var acct = allAccounts.find(function(a) { return String(a.id) === String(aid); });
                        if (!acct) {
                            acct = unassigned.find(function(a) { return String(a.id) === String(aid); });
                        }
                        return acct || { id: aid, number: '', name: '', amount: 0 };
                    });
                    
                    // Update classification using STRING category ID
                    if (!self.latestData.classification.byCategory[catIdStr]) {
                        self.latestData.classification.byCategory[catIdStr] = { count: 0, accounts: [] };
                    }
                    self.latestData.classification.byCategory[catIdStr].accounts = newAssigned;
                    self.latestData.classification.byCategory[catIdStr].count = newAssigned.length;
                    
                    console.log('[SaveCategory] New count:', self.latestData.classification.byCategory[catIdStr].count);
                    
                    // Update unassigned list - remove accounts that are now assigned
                    self.latestData.classification.unassigned = unassigned.filter(function(a) {
                        return !newAccountSet[String(a.id)];
                    });
                    
                    console.log('[SaveCategory] Unassigned count:', self.latestData.classification.unassigned.length);
                }
            } else {
                console.log('[SaveCategory] WARNING: No accountMultiselect element found!');
            }

            if (!categoryData.id || !categoryData.label) {
                showToast('ID and Label are required', 'warning');
                return;
            }
            
            var isNew = !existingId;
            
            // Update local data immediately (no server refresh)
            if (isNew) {
                // Add to summary.categories with order at end
                if (!self.latestData.summary) self.latestData.summary = {};
                if (!self.latestData.summary.categories) self.latestData.summary.categories = [];
                var maxOrder = self.latestData.summary.categories.reduce(function(max, c) { return Math.max(max, c.order || 0); }, -1);
                categoryData.order = maxOrder + 1;
                self.latestData.summary.categories.push(categoryData);
                
                // Add to meta.categoryDefinitions
                if (!self.latestData.meta) self.latestData.meta = {};
                if (!self.latestData.meta.categoryDefinitions) self.latestData.meta.categoryDefinitions = [];
                self.latestData.meta.categoryDefinitions.push(categoryData);
            } else {
                // Update existing in local data
                var catIdStr = String(categoryData.id);
                var updateInArray = function(arr) {
                    var idx = arr.findIndex(function(c) { return String(c.id) === catIdStr; });
                    if (idx >= 0) arr[idx] = Object.assign({}, arr[idx], categoryData);
                };
                if (self.latestData.summary?.categories) updateInArray(self.latestData.summary.categories);
                if (self.latestData.meta?.categoryDefinitions) updateInArray(self.latestData.meta.categoryDefinitions);
            }
            
            // Re-render immediately
            self.renderCategoriesTab();
            
            // Close flyout
            self.closeFlyout();

            console.log('[SaveCategory] Sending to server:', JSON.stringify(categoryData, null, 2));
            console.log('[SaveCategory] isNew:', isNew);
            
            // Save to server, then do LIGHT refresh to get recalculated rates
            // Light refresh skips expensive history/forecast calculations
            API.post('burden', { subAction: 'save_category', category: categoryData, isNew: isNew }).then(function(response) {
                console.log('[SaveCategory] Server response received, starting light refresh...');
                showToast('Category saved - refreshing...', 'success');
                // LIGHT REFRESH: Skip history/forecast recalculation for faster save
                return self.loadData(true);
            }).then(function() {
                console.log('[SaveCategory] Light refresh complete');
                showToast('Data refreshed', 'success');
            }).catch(function(err) {
                console.error('[SaveCategory] Error:', err);
                showToast('Error saving: ' + (err.message || err), 'danger');
            });
        },

        confirmDeleteCategory: function(categoryId) {
            // Just calls deleteCategory which already has confirmation modal
            this.deleteCategory(categoryId);
        },

        deleteCategory: function(categoryId) {
            var self = this;
            
            // Show custom confirmation modal over flyout (don't close flyout yet)
            var modalHtml = '<div class="modal fade" id="deleteCategoryModal" tabindex="-1" style="z-index: 10600;">' +
                '<div class="modal-dialog modal-sm modal-dialog-centered">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header border-0 pb-0">' +
                            '<h6 class="modal-title"><i class="fas fa-exclamation-triangle text-danger mr-2"></i>Delete Category</h6>' +
                            '<button type="button" class="close delete-modal-close"><span>&times;</span></button>' +
                        '</div>' +
                        '<div class="modal-body py-3">' +
                            '<p class="mb-0">Delete this category? Any assigned accounts will become unassigned.</p>' +
                        '</div>' +
                        '<div class="modal-footer border-0 pt-0">' +
                            '<button type="button" class="btn btn-sm btn-secondary delete-modal-cancel">Cancel</button>' +
                            '<button type="button" class="btn btn-sm btn-danger" id="confirmDeleteCat">Delete</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="modal-backdrop fade show" id="deleteCategoryBackdrop" style="z-index: 10599;"></div>';
            
            // Remove any existing modal
            var existingModal = document.getElementById('deleteCategoryModal');
            var existingBackdrop = document.getElementById('deleteCategoryBackdrop');
            if (existingModal) existingModal.remove();
            if (existingBackdrop) existingBackdrop.remove();
            
            // Add modal to body
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            var modal = document.getElementById('deleteCategoryModal');
            var backdrop = document.getElementById('deleteCategoryBackdrop');
            
            var closeModal = function() {
                modal.classList.remove('show');
                modal.style.display = 'none';
                backdrop.remove();
                modal.remove();
            };
            
            // Show modal
            setTimeout(function() {
                modal.classList.add('show');
                modal.style.display = 'block';
            }, 10);
            
            // Handle confirm click
            document.getElementById('confirmDeleteCat').onclick = function() {
                closeModal();
                
                // Close flyout
                self.closeFlyout();

                // Remove from local data
                if (self.latestData.summary && self.latestData.summary.categories) {
                    self.latestData.summary.categories = self.latestData.summary.categories.filter(function(c) {
                        return c.id !== categoryId;
                    });
                }
                if (self.latestData.meta && self.latestData.meta.categoryDefinitions) {
                    self.latestData.meta.categoryDefinitions = self.latestData.meta.categoryDefinitions.filter(function(c) {
                        return c.id !== categoryId;
                    });
                }
                
                // Re-render immediately
                self.renderCategoriesTab();

                // Save to server, then light refresh
                API.post('burden', { subAction: 'delete_category', categoryId: categoryId }).then(function() {
                    showToast('Category deleted - refreshing...', 'success');
                    return self.loadData(true); // Light refresh to recalculate rates
                }).then(function() {
                    showToast('Data refreshed', 'success');
                }).catch(function(err) {
                    showToast('Error: ' + (err.message || err), 'danger');
                });
            };
            
            // Handle cancel/close - just close modal, flyout stays open
            modal.querySelector('.delete-modal-close').onclick = closeModal;
            modal.querySelector('.delete-modal-cancel').onclick = closeModal;
            backdrop.onclick = closeModal;
        },

        // ════════════════════════════════════════════════════════════════════════
        // ACCOUNT CLASSIFICATION
        // ════════════════════════════════════════════════════════════════════════

        assignAccount: function(accountId, categoryId) {
            var self = this;
            API.post('burden', { subAction: 'save_classification', accountId: accountId, categoryId: categoryId }).then(function() {
                showToast('Account assigned', 'success');
                self.loadData(true); // Light refresh
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        excludeAccount: function(accountId) {
            var self = this;
            API.post('burden', { subAction: 'save_classification', accountId: accountId, excluded: true }).then(function() {
                showToast('Account excluded', 'success');
                self.loadData(true); // Light refresh
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        autoMatchAccounts: function() {
            var self = this;
            showToast('Running auto-match...', 'info');
            API.post('burden', { subAction: 'auto_match' }).then(function(res) {
                var matched = (res.data || res).matchedCount || 0;
                showToast('Auto-matched ' + matched + ' accounts', 'success');
                self.loadData(true); // Light refresh
            }).catch(function(err) {
                showToast('Error: ' + (err.message || err), 'danger');
            });
        },

        // Drag-drop support placeholders
        handleDragStart: function(e, accountId) {
            e.dataTransfer.setData('text/plain', accountId);
            e.target.classList.add('dragging');
        },

        handleDragOver: function(e) {
            e.preventDefault();
            e.currentTarget.classList.add('drag-over');
        },

        handleDrop: function(e, categoryId) {
            e.preventDefault();
            e.currentTarget.classList.remove('drag-over');
            var accountId = e.dataTransfer.getData('text/plain');
            if (accountId && categoryId) {
                this.assignAccount(accountId, categoryId);
            }
        },

        // ════════════════════════════════════════════════════════════════════════
        // EXPORT
        // ════════════════════════════════════════════════════════════════════════

        exportRates: function() {
            var self = this;
            var summary = this.latestData.summary || {};
            var categories = summary.categories || [];
            var depts = (this.latestData.meta && this.latestData.meta.departments) || [];
            var meta = this.latestData.meta || {};

            if (categories.length === 0) {
                showToast('No data to export', 'warning');
                return;
            }

            // Build CSV
            var rows = [];
            
            // Header row
            var header = ['Category'];
            depts.forEach(function(d) { header.push(d.name); });
            header.push('Overall');
            rows.push(header.join(','));

            // Data rows
            categories.forEach(function(cat) {
                var row = ['"' + cat.label.replace(/"/g, '""') + '"'];
                depts.forEach(function(d) {
                    var rate = cat.burden && cat.burden[d.id] ? cat.burden[d.id] : 0;
                    row.push(rate.toFixed(2));
                });
                row.push((cat.totalBurden || 0).toFixed(2));
                rows.push(row.join(','));
            });

            // Composite row
            var compositeRow = ['Composite Rate'];
            depts.forEach(function(d) {
                var compRate = summary.compositeByDept && summary.compositeByDept[d.id] ? summary.compositeByDept[d.id] : 0;
                compositeRow.push(compRate.toFixed(2));
            });
            compositeRow.push((self.latestData.kpis.compositeRate || 0).toFixed(2));
            rows.push(compositeRow.join(','));

            var csv = rows.join('\n');
            var blob = new Blob([csv], { type: 'text/csv' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'burden_rates_' + (meta.dateRange?.start || new Date().toISOString().split('T')[0]) + '.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Rates exported to CSV', 'success');
        },

        // ════════════════════════════════════════════════════════════════════════
        // UTILITIES
        // ════════════════════════════════════════════════════════════════════════

        fmtNum: function(val, decimals) {
            if (val === null || val === undefined || isNaN(val)) return '0';
            var num = parseFloat(val);
            if (decimals === 0) {
                return Math.round(num).toLocaleString();
            }
            return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        },

        formatCurrency: function(val) {
            if (val === null || val === undefined || isNaN(val)) return this.currencySymbol + '0';
            var num = parseFloat(val);
            var absNum = Math.abs(num);
            var formatted;
            if (absNum >= 1000000) {
                formatted = (num / 1000000).toFixed(1) + 'M';
            } else if (absNum >= 1000) {
                formatted = (num / 1000).toFixed(1) + 'K';
            } else {
                formatted = num.toFixed(0);
            }
            return this.currencySymbol + formatted;
        },

        getBaseLabel: function(base) {
            var labels = {
                billed_hours: 'Billed Hrs',
                total_hours: 'Total Hrs',
                labor_dollars: 'Labor $',
                headcount: 'Headcount',
                revenue: 'Revenue',
                direct_cost: 'Direct Cost',
                square_feet: 'Sq Feet',
                units: 'Units',
                custom: 'Custom'
            };
            return labels[base] || base;
        },

        getBaseIcon: function(base) {
            var icons = {
                billed_hours: 'clock',
                total_hours: 'clock',
                labor_dollars: 'dollar-sign',
                headcount: 'users',
                revenue: 'chart-line',
                direct_cost: 'receipt',
                square_feet: 'building',
                units: 'boxes',
                custom: 'sliders-h'
            };
            return icons[base] || 'cube';
        },

        getMethodLabel: function(method) {
            var labels = {
                simple: 'Simple',
                weighted: 'Weighted',
                stepped: 'Stepped'
            };
            return labels[method] || method || 'Simple';
        },

        getMethodIcon: function(method) {
            var icons = {
                simple: 'divide',
                weighted: 'balance-scale',
                stepped: 'layer-group'
            };
            return icons[method] || 'calculator';
        },

        getFormatLabel: function(format) {
            var labels = {
                per_hour: '$/Hour',
                percent_labor: '% Labor',
                percent_cost: '% Cost',
                per_fte: '$/FTE',
                per_unit: '$/Unit'
            };
            return labels[format] || format || '$/Hour';
        },

        formatRateValue: function(rate, format, category) {
            var self = this;
            format = format || 'per_hour';
            
            switch (format) {
                case 'per_hour':
                    return self.currencySymbol + self.fmtNum(rate, 2) + '/hr';
                case 'percent_labor':
                case 'percent_cost':
                    return self.fmtNum(rate, 1) + '%';
                case 'per_fte':
                    return self.currencySymbol + self.fmtNum(rate, 0) + '/FTE';
                case 'per_unit':
                    return self.currencySymbol + self.fmtNum(rate, 2) + '/unit';
                default:
                    return self.currencySymbol + self.fmtNum(rate, 2) + '/hr';
            }
        },

        switchTab: function(tabId) {
            var tab = el('#' + tabId);
            if (tab && window.jQuery) {
                jQuery(tab).tab('show');
            }
            // Track active tab
            this.activeTab = tabId.replace('-tab', '');
        },

        renderPagination: function(containerId, currentPage, totalPages, onPageChange) {
            var container = el('#' + containerId);
            if (!container || totalPages <= 1) {
                if (container) container.innerHTML = '';
                return;
            }

            var html = '<nav><ul class="pagination pagination-sm justify-content-center mb-0">';
            
            // Previous
            html += '<li class="page-item' + (currentPage === 1 ? ' disabled' : '') + '">' +
                '<a class="page-link" href="#" onclick="' + onPageChange + '(' + (currentPage - 1) + '); return false;">&laquo;</a></li>';
            
            // Page numbers
            var startPage = Math.max(1, currentPage - 2);
            var endPage = Math.min(totalPages, currentPage + 2);
            
            if (startPage > 1) {
                html += '<li class="page-item"><a class="page-link" href="#" onclick="' + onPageChange + '(1); return false;">1</a></li>';
                if (startPage > 2) html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            }
            
            for (var p = startPage; p <= endPage; p++) {
                html += '<li class="page-item' + (p === currentPage ? ' active' : '') + '">' +
                    '<a class="page-link" href="#" onclick="' + onPageChange + '(' + p + '); return false;">' + p + '</a></li>';
            }
            
            if (endPage < totalPages) {
                if (endPage < totalPages - 1) html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
                html += '<li class="page-item"><a class="page-link" href="#" onclick="' + onPageChange + '(' + totalPages + '); return false;">' + totalPages + '</a></li>';
            }
            
            // Next
            html += '<li class="page-item' + (currentPage === totalPages ? ' disabled' : '') + '">' +
                '<a class="page-link" href="#" onclick="' + onPageChange + '(' + (currentPage + 1) + '); return false;">&raquo;</a></li>';
            
            html += '</ul></nav>';
            container.innerHTML = html;
        },

        changePage: function(table, page) {
            if (this.pagination[table]) {
                this.pagination[table].page = page;
            }
            // Re-render appropriate content
            if (table === 'unassigned') this.renderUnassignedAccounts();
            else if (table === 'categoryAccounts') this.showCategoryFlyout(this.flyoutContext);
        },

        // ════════════════════════════════════════════════════════════════════════
        // RATE LEGEND AND COLORING
        // ════════════════════════════════════════════════════════════════════════

        getRateClass: function(rate, average) {
            if (!average || average === 0) return '';
            var deviation = (rate - average) / average;
            if (deviation < -0.15) return 'rate-low';
            if (deviation > 0.15) return 'rate-high';
            return 'rate-avg';
        },

        renderSavedScenarios: function() {
            var container = el('.saved-scenario-list');
            if (!container) return;

            var scenarios = this.latestData.savedScenarios || [];
            if (scenarios.length === 0) {
                container.innerHTML = '<div class="p-3 text-center text-muted">No saved scenarios</div>';
                return;
            }

            var self = this;
            var typeIcons = { hire: 'user-plus', terminate: 'user-minus', win_contract: 'file-signature', lose_contract: 'file-excel', cost_change: 'dollar-sign', utilization_change: 'chart-line' };

            container.innerHTML = scenarios.map(function(s) {
                return '<div class="saved-scenario-card">' +
                    '<div class="ssc-icon"><i class="fas fa-' + (typeIcons[s.scenarioType] || 'flask') + '"></i></div>' +
                    '<div class="ssc-content">' +
                        '<div class="ssc-name">' + escapeHtml(s.name) + '</div>' +
                        '<div class="ssc-meta">' + (s.projectedRate ? '$' + self.fmtNum(s.projectedRate, 2) + '/hr' : '') + '</div>' +
                    '</div>' +
                    '<div class="ssc-actions">' +
                        '<button class="btn btn-sm btn-link text-danger" onclick="BurdenController.deleteScenario(\'' + s.id + '\')"><i class="fas fa-trash"></i></button>' +
                    '</div>' +
                '</div>';
            }).join('');
        }
    };

    // ════════════════════════════════════════════════════════════════════════
    // GLOBAL REGISTRATION
    // ════════════════════════════════════════════════════════════════════════

    // escapeHtml is now provided globally by Gantry.Core.js (window.escapeHtml)
    // Removed local duplicate - use the global version which includes single-quote escaping

    // Expose to global scope
    window.BurdenController = BurdenController;

    // Register route
    Router.register('burden', function() { BurdenController.init(); });

    console.log('[Dashboard.Burden] Rate Engine 2.0 Loaded');

})(window);