/**
 * Dashboard.SpendVelocity.js
 * PHYSICS FOR FINANCE - World-Class Spend Velocity Intelligence Dashboard
 * 
 * "Where is your money GOING, not just WHERE it IS"
 * 
 * Features:
 * - Velocity-based spend analysis (speed of growth)
 * - Acceleration detection (is growth accelerating?)
 * - Boiling Frog Detector (subscription creep)
 * - Shadow IT Detection (viral software adoption)
 * - Commitment Cliff (PO vs SO velocity)
 * - Interactive Velocity Treemap
 * - Anomaly Heat Signatures
 * - Seasonal Pattern Recognition
 * - Multi-subsidiary support
 * - International currency handling
 */
(function(window) {
    'use strict';

    const SpendVelocityController = {
        _version: 'v2.0-physics-for-finance',
        latestData: null,
        subsidiaries: [],
        subsidiaryId: null,
        configData: null,
        currencySymbol: '$',
        fiscalCalendar: null,
        
        // Pagination state for all tables
        pagination: {
            velocity: { page: 1, pageSize: 15, sortCol: 'totalSpend', sortDir: 'desc' },
            vendors: { page: 1, pageSize: 15, sortCol: 'totalSpend', sortDir: 'desc' },
            periods: { page: 1, pageSize: 15, sortCol: 'changePct', sortDir: 'desc' },
            transactions: { page: 1, pageSize: 20, sortCol: 'date', sortDir: 'desc' },
            expenses: { page: 1, pageSize: 15, sortCol: 'totalSpend', sortDir: 'desc' },
            categories: { page: 1, pageSize: 15, sortCol: 'totalSpend', sortDir: 'desc' },
            deep: { page: 1, pageSize: 20, sortCol: 'totalSpend', sortDir: 'desc' },
            detectors: { page: 1, pageSize: 10, sortCol: 'severity', sortDir: 'desc' }
        },
        
        // Drill-down state
        drilldown: { active: false, type: null, id: null, name: null },

        init: function() {
            this.setupUI();
        },
        
        setupUI: function() {
            el('#gantry-view-container').innerHTML = this.getTemplate();
            this.showLoadingState();
            this.bindEvents();
            this.loadConfig();
        },
        
        bindEvents: function() {
            var self = this;
            
            var subsidiaryEl = el("#svSubsidiary");
            if (subsidiaryEl) {
                subsidiaryEl.addEventListener("change", function(e) {
                    self.subsidiaryId = e.target.value;
                    self.loadData();
                });
            }
            
            var btnApply = el("#svApplyRange");
            if (btnApply) btnApply.addEventListener("click", function() { self.loadData(); });

            if (window.jQuery) {
                $('#svTabs a').on('click', function (e) {
                    e.preventDefault();
                    $(this).tab('show');
                });
                
                jQuery(document).on("shown.bs.tab", "#sv-overview-tab", function() { self.renderOverviewTab(); });
                jQuery(document).on("shown.bs.tab", "#sv-velocity-tab", function() { self.renderVelocityTab(); });
                jQuery(document).on("shown.bs.tab", "#sv-accounts-tab", function() { self.renderAccountsTab(); });
                jQuery(document).on("shown.bs.tab", "#sv-detectors-tab", function() { self.renderDetectorsTab(); });
                jQuery(document).on("shown.bs.tab", "#sv-expenses-tab", function() { self.renderExpensesTab(); });
                jQuery(document).on("shown.bs.tab", "#sv-trends-tab", function() { self.renderTrendsTab(); });
                jQuery(document).on("shown.bs.tab", "#sv-config-tab", function() { self.renderConfigTab(); });
            }
        },
        
        getTemplate: function() {
            return '<div class="cf-dashboard spend-velocity-dashboard p-0">' +
                // Controls Row (like CustomerValue)
                '<div class="row mb-3">' +
                    '<div class="col-md-12">' +
                        '<form class="form-inline justify-content-center" id="svDateForm" onsubmit="return false;">' +
                            '<select class="form-control form-control-sm mr-3" id="svSubsidiary" style="max-width: 200px;"></select>' +
                            '<label class="mr-2 small text-muted">From:</label>' +
                            '<input type="date" class="form-control form-control-sm mr-2" id="svStartDate">' +
                            '<label class="mr-2 small text-muted">To:</label>' +
                            '<input type="date" class="form-control form-control-sm mr-3" id="svEndDate">' +
                            '<button type="button" class="btn btn-sm btn-primary" id="svApplyRange">Apply</button>' +
                        '</form>' +
                    '</div>' +
                '</div>' +
                // Standard KPI Row (like Cashflow/CustomerValue)
                '<div class="row mb-2 gutters-sm cf-kpi-row">' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card" id="svHealthGaugeCard">' +
                            '<div class="risk-meter-kpi">' +
                                '<div class="risk-meter-gauge" id="SV_HealthGauge"></div>' +
                                '<div class="risk-meter-info">' +
                                    '<span class="risk-meter-value" id="SV_HealthValue">--</span>' +
                                    '<span class="risk-meter-label" id="SV_HealthLabel">CALCULATING</span>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-blue-soft"><i class="fas fa-dollar-sign text-blue"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Total Spend</span>' +
                                '<span class="kpi-value" id="SV_TotalSpend">--</span>' +
                                '<span class="kpi-sub" id="SV_VendorCount">-- vendors</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-green-soft"><i class="fas fa-chart-line text-green"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Avg Velocity</span>' +
                                '<span class="kpi-value" id="SV_AvgVelocity">--</span>' +
                                '<span class="kpi-sub" id="SV_AcceleratingCount">-- accelerating</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-purple-soft"><i class="fas fa-piggy-bank text-purple"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Savings Potential</span>' +
                                '<span class="kpi-value" id="SV_SavingsPotential">--</span>' +
                                '<span class="kpi-sub" id="SV_SavingsSource">from detectors</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col">' +
                        '<div class="cf-kpi-card">' +
                            '<div class="icon-wrapper bg-red-soft"><i class="fas fa-exclamation-triangle text-red"></i></div>' +
                            '<div class="kpi-content">' +
                                '<span class="kpi-label">Alerts</span>' +
                                '<span class="kpi-value" id="SV_AlertCount">--</span>' +
                                '<span class="kpi-sub" id="SV_AlertType">-- anomalies</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // Main Card with Tabs
                '<div class="card cf-main-card shadow-sm">' +
                    '<div class="card-header border-0 bg-white pt-3 pb-1 px-3">' +
                        '<ul class="nav nav-tabs cf-tabs" id="svTabs">' +
                            '<li class="nav-item"><a class="nav-link active" id="sv-overview-tab" data-toggle="tab" href="#sv-overview"><i class="fas fa-home mr-2"></i>Overview</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="sv-velocity-tab" data-toggle="tab" href="#sv-velocity"><i class="fas fa-chart-line mr-2"></i>Velocity</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="sv-detectors-tab" data-toggle="tab" href="#sv-detectors"><i class="fas fa-search-dollar mr-2"></i>Detectors <span class="badge badge-danger ml-1" id="svDetectorBadge" style="display:none;"></span></a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="sv-accounts-tab" data-toggle="tab" href="#sv-accounts"><i class="fas fa-layer-group mr-2"></i>Accounts</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="sv-expenses-tab" data-toggle="tab" href="#sv-expenses"><i class="fas fa-file-invoice-dollar mr-2"></i>Expenses</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="sv-trends-tab" data-toggle="tab" href="#sv-trends"><i class="fas fa-chart-area mr-2"></i>Trends</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="sv-config-tab" data-toggle="tab" href="#sv-config"><i class="fas fa-cog mr-2"></i>Configuration</a></li>' +
                        '</ul>' +
                    '</div>' +
                    '<div class="card-body p-0">' +
                        '<div class="tab-content">' +
                            '<div class="tab-pane fade show active" id="sv-overview"><div class="tab-inner p-3" id="svOverviewContent"></div></div>' +
                            '<div class="tab-pane fade" id="sv-velocity"><div class="tab-inner p-3" id="svVelocityContent"></div></div>' +
                            '<div class="tab-pane fade" id="sv-detectors"><div class="tab-inner p-3" id="svDetectorsContent"></div></div>' +
                            '<div class="tab-pane fade" id="sv-accounts"><div class="tab-inner p-3" id="svAccountsContent"></div></div>' +
                            '<div class="tab-pane fade" id="sv-expenses"><div class="tab-inner p-3" id="svExpensesContent"></div></div>' +
                            '<div class="tab-pane fade" id="sv-trends"><div class="tab-inner p-3" id="svTrendsContent"></div></div>' +
                            '<div class="tab-pane fade" id="sv-config"><div class="tab-inner p-3" id="svConfigContent"></div></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // Drill-down panel
                '<div id="svDrilldownPanel" class="sv-drilldown-panel" style="display:none;">' +
                    '<div class="sv-drilldown-header"><span id="svDrilldownTitle"></span><button class="btn-close" onclick="SpendVelocityController.closeDrilldown()"><i class="fas fa-times"></i></button></div>' +
                    '<div id="svDrilldownBody" class="sv-drilldown-body"></div>' +
                '</div>' +
            '</div>';
        },
        
        getVelocityMetricsSkeleton: function() {
            return ''; // No longer needed - KPIs are in standard row
        },
        
        showLoadingState: function() {
            // KPI area skeleton
            ['SV_TotalSpend', 'SV_AvgVelocity', 'SV_SavingsPotential', 'SV_AlertCount'].forEach(function(id) {
                var el_ = el('#' + id);
                if (el_) el_.innerHTML = Skeleton.render('custom', { width: '50px', height: '1.5rem' });
            });
            
            // Health gauge skeleton (risk-meter style)
            var gaugeEl = el('#SV_HealthGauge');
            if (gaugeEl) gaugeEl.innerHTML = Skeleton.render('custom', { width: '100px', height: '55px' });
            var valueEl = el('#SV_HealthValue');
            if (valueEl) { valueEl.textContent = '--'; valueEl.className = 'risk-meter-value'; }
            var labelEl = el('#SV_HealthLabel');
            if (labelEl) { labelEl.textContent = 'LOADING'; labelEl.className = 'risk-meter-label'; }
            
            var overviewEl = el('#svOverviewContent');
            if (overviewEl) {
                overviewEl.innerHTML = '<div class="row">' +
                    '<div class="col-lg-8">' + Skeleton.render('custom', { width: '100%', height: '400px' }) + '</div>' +
                    '<div class="col-lg-4">' + Skeleton.render('custom', { width: '100%', height: '400px' }) + '</div>' +
                '</div>';
            }
        },
        
        loadConfig: function() {
            var self = this;
            API.get('spend_velocity_config').then(function(res) {
                self.subsidiaries = res.subsidiaries || [];
                self.renderSubsidiaryDropdown();
                self.configData = res.config || {};
                
                // Store fiscal calendar from shared infrastructure
                self.fiscalCalendar = res.fiscalCalendar || {};
                
                // Set fiscal year default dates from Lib_Config
                var startEl = el('#svStartDate');
                var endEl = el('#svEndDate');
                if (self.fiscalCalendar.fiscalYearStartDate) {
                    if (startEl && !startEl.value) startEl.value = self.fiscalCalendar.fiscalYearStartDate;
                }
                if (self.fiscalCalendar.fiscalYearEndDate) {
                    if (endEl && !endEl.value) {
                        // Use today if fiscal year end is in the future
                        var fyEnd = new Date(self.fiscalCalendar.fiscalYearEndDate);
                        var today = new Date();
                        endEl.value = fyEnd > today ? today.toISOString().split('T')[0] : self.fiscalCalendar.fiscalYearEndDate;
                    }
                }
                
                self.loadData();
            }).catch(function(e) {
                console.error("SV config load error", e);
                self.loadData();
            });
        },
        
        renderSubsidiaryDropdown: function() {
            var selectEl = el("#svSubsidiary");
            if (!selectEl) return;
            
            var html = '<option value="">All Subsidiaries</option>';
            this.subsidiaries.forEach(function(sub) {
                html += '<option value="' + sub.id + '">' + escapeHtml(sub.name) + '</option>';
            });
            selectEl.innerHTML = html;
        },
        
        loadData: function() {
            var self = this;
            self.showLoadingState();
            
            // Set Apply button to loading state
            var applyBtn = el('#svApplyRange');
            if (applyBtn) applyBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading';
            
            var startEl = el('#svStartDate');
            var endEl = el('#svEndDate');
            
            // Fiscal year defaults (Jan 1 to today)
            if (!startEl.value) {
                var today = new Date();
                var fyStart = new Date(today.getFullYear(), 0, 1); // Jan 1 of current year
                startEl.value = fyStart.toISOString().split('T')[0];
            }
            if (!endEl.value) {
                endEl.value = new Date().toISOString().split('T')[0];
            }
            
            var params = {
                startDate: startEl.value,
                endDate: endEl.value,
                subsidiary: self.subsidiaryId || '',
                config: JSON.stringify(self.configData || {})
            };
            
            API.get('spend_velocity_data', params).then(function(res) {
                self.latestData = res;
                self.currencySymbol = (res.results && res.results.currencyInfo && res.results.currencyInfo.symbol) || '$';
                self.renderDashboard();
                // Reset Apply button
                if (applyBtn) applyBtn.textContent = 'Apply';
            }).catch(function(e) {
                console.error("SV data load error", e);
                self.renderError("Failed to load spend velocity data: " + e.message);
                // Reset Apply button
                if (applyBtn) applyBtn.textContent = 'Apply';
            });
        },
        
        renderError: function(message) {
            var container = el('#svOverviewContent');
            if (container) {
                container.innerHTML = ErrorBoundary.renderError(new Error(message), {
                    title: 'Data Load Error',
                    retryAction: 'SpendVelocityController.loadData()'
                });
            }
        },
        
        renderDashboard: function() {
            if (!this.latestData || !this.latestData.results) return;
            
            this.renderVelocityMetrics();
            this.updateDetectorBadge();
            this.renderOverviewTab();
        },
        
        renderVelocityMetrics: function() {
            var data = this.latestData.results;
            var summary = data.summary || {};
            var boiling = data.boilingFrog?.summary || {};
            var anomalies = data.anomalies?.summary || {};
            var shadow = data.shadowIT?.summary || {};
            var concentration = data.vendorConcentration?.summary || {};
            var fragmentation = data.categoryFragmentation?.summary || {};
            var zombie = data.zombieSubscriptions?.summary || {};
            var self = this;
            
            // Use comprehensive health score calculated by backend
            // Backend considers: velocity health, severity-weighted issues, structural risk, financial impact
            var healthScore = summary.healthScore || 50;
            
            // Render health gauge using risk-meter pattern (like Health dashboard)
            this.renderSpendHealthMeterKPI(healthScore);
            
            // Total Spend
            var spendEl = el('#SV_TotalSpend');
            if (spendEl) spendEl.textContent = this.formatCurrency(summary.totalSpend || 0);
            
            var accountCountEl = el('#SV_VendorCount');
            if (accountCountEl) accountCountEl.textContent = (summary.accountCount || 0) + ' accounts';
            
            // Avg Velocity
            var velocityEl = el('#SV_AvgVelocity');
            if (velocityEl) {
                var vel = summary.avgVelocity || 0;
                var arrow = vel > 0 ? '↑' : vel < 0 ? '↓' : '';
                velocityEl.innerHTML = arrow + ' ' + Math.abs(vel).toFixed(1) + '%';
                velocityEl.className = 'kpi-value ' + (vel > 5 ? 'text-danger' : vel < -5 ? 'text-success' : '');
            }
            
            var accelEl = el('#SV_AcceleratingCount');
            if (accelEl) accelEl.textContent = (summary.acceleratingCount || 0) + ' accelerating';
            
            // Savings Potential - sum from all detectors
            var savingsEl = el('#SV_SavingsPotential');
            var savingsTotal = (boiling.totalAnnualizedCreep || 0) + 
                              (fragmentation.potentialSavings || 0) +
                              (zombie.totalAnnualCost || 0);
            if (savingsEl) {
                savingsEl.textContent = this.formatCurrency(savingsTotal);
                savingsEl.className = 'kpi-value ' + (savingsTotal > 0 ? 'text-purple' : '');
            }
            
            var savingsSourceEl = el('#SV_SavingsSource');
            if (savingsSourceEl) {
                var sources = [];
                if (boiling.totalAnnualizedCreep) sources.push('creep');
                if (fragmentation.potentialSavings) sources.push('consolidation');
                if (zombie.totalAnnualCost) sources.push('zombies');
                savingsSourceEl.textContent = sources.length > 0 ? 'from ' + sources.join(', ') : 'no issues found';
            }
            
            // Alerts - sum of all detector counts
            var totalAlerts = (boiling.count || 0) + (anomalies.count || 0) + 
                             (shadow.viralCount || 0) + (zombie.count || 0) +
                             (fragmentation.fragmentedCount || 0);
            var alertEl = el('#SV_AlertCount');
            if (alertEl) {
                alertEl.textContent = totalAlerts;
                alertEl.className = 'kpi-value ' + (totalAlerts > 0 ? 'text-danger' : 'text-success');
            }
            
            var alertTypeEl = el('#SV_AlertType');
            if (alertTypeEl) {
                var types = [];
                if (boiling.count) types.push(boiling.count + ' frogs');
                if (anomalies.count) types.push(anomalies.count + ' anomalies');
                if (shadow.viralCount) types.push(shadow.viralCount + ' shadow');
                alertTypeEl.textContent = types.length > 0 ? types.slice(0, 2).join(', ') : 'No issues';
            }
        },
        
        updateDetectorBadge: function() {
            var data = this.latestData.results;
            var alertCount = (data.boilingFrog?.summary?.count || 0) +
                            (data.shadowIT?.summary?.viralCount || 0) +
                            (data.anomalies?.summary?.criticalCount || 0);
            
            var badge = el('#svDetectorBadge');
            if (badge) {
                badge.textContent = alertCount;
                badge.style.display = alertCount > 0 ? 'inline' : 'none';
            }
        },
        
        renderOverviewTab: function() {
            var container = el('#svOverviewContent');
            if (!container || !this.latestData) return;
            
            var data = this.latestData.results;
            var insights = data.insights || [];
            var self = this;
            
            var html = '<div class="row">';
            
            // Left Column - Charts
            html += '<div class="col-lg-8">';
            
            // Row 1: Velocity/Accel Scatter (full width)
            html += '<div class="row mb-3">' +
                '<div class="col-12"><div class="card h-100">' +
                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                '<strong><i class="fas fa-bullseye text-danger mr-2"></i>Velocity vs Acceleration</strong>' +
                '<button class="btn btn-xs btn-link p-0" data-toggle="tooltip" title="Velocity = rate of spend change. Acceleration = rate of velocity change. High acceleration means spending is changing faster."><i class="fas fa-info-circle text-muted"></i></button>' +
                '</div>' +
                '<div class="card-body p-2">' +
                '<div class="d-flex small text-muted mb-1">' +
                '<span class="mr-3"><i class="fas fa-arrow-right text-primary mr-1"></i><strong>Velocity:</strong> Monthly spend change %</span>' +
                '<span><i class="fas fa-arrows-alt-v text-warning mr-1"></i><strong>Acceleration:</strong> Change in velocity</span>' +
                '</div>' +
                '<div id="svOverviewScatterChart" style="height:180px;"></div>' +
                '</div></div></div></div>';
            
            // Row 2: Pie + Trend
            html += '<div class="row mb-3">' +
                '<div class="col-md-5"><div class="card h-100"><div class="card-header py-2"><strong><i class="fas fa-chart-pie text-primary mr-2"></i>Top 10 by Spend</strong></div>' +
                '<div class="card-body p-2"><div id="svOverviewPieChart" style="height:200px;"></div></div></div></div>' +
                '<div class="col-md-7"><div class="card h-100"><div class="card-header py-2"><strong><i class="fas fa-chart-area text-success mr-2"></i>Monthly Trend</strong></div>' +
                '<div class="card-body p-2"><div id="svOverviewTrendChart" style="height:200px;"></div></div></div></div></div>';
            
            // Row 3: Top Velocity Accounts Table (sorted by velocity)
            html += '<div class="card mb-3">' +
                '<div class="card-header py-2"><strong><i class="fas fa-fire text-danger mr-2"></i>Highest Velocity Accounts</strong></div>' +
                '<div class="card-body p-0">' +
                    '<table class="table table-hover table-sm mb-0"><thead class="thead-light"><tr>' +
                        '<th class="sv-sortable" onclick="SpendVelocityController.sortOverviewTable(\'name\')">Account <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                        '<th class="sv-sortable text-right" onclick="SpendVelocityController.sortOverviewTable(\'spend\')">Spend <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                        '<th class="sv-sortable text-right" onclick="SpendVelocityController.sortOverviewTable(\'velocity\')">Velocity <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                        '<th class="text-center">Trend</th>' +
                    '</tr></thead><tbody id="svOverviewTableBody">';
            
            // Sort by velocity (descending) to show highest velocity accounts
            var topAccounts = (data.accountVelocity || []).slice().sort(function(a, b) { return b.velocity - a.velocity; }).slice(0, 6);
            topAccounts.forEach(function(acct) {
                var velClass = acct.velocity > 15 ? 'sv-vel-hot' : acct.velocity > 5 ? 'sv-vel-warm' : acct.velocity < -5 ? 'sv-vel-cold' : 'sv-vel-cool';
                var trendIcon = self.getTrendIcon(acct.trend);
                html += '<tr class="sv-clickable" onclick="SpendVelocityController.drilldownAccount(' + acct.accountId + ', \'' + escapeHtml(acct.accountName).replace(/'/g, "\\'") + '\')">' +
                    '<td><strong>' + escapeHtml(acct.accountName) + '</strong></td>' +
                    '<td class="text-right">' + self.formatCurrency(acct.totalSpend) + '</td>' +
                    '<td class="text-right"><span class="sv-velocity-pill ' + velClass + '">' + (acct.velocity >= 0 ? '+' : '') + acct.velocity.toFixed(1) + '%</span></td>' +
                    '<td class="text-center"><i class="fas fa-' + trendIcon + '"></i></td></tr>';
            });
            html += '</tbody></table></div></div>';
            html += '</div>'; // col-lg-8
            
            // Right Column - Insights + Detector Mini Summary
            html += '<div class="col-lg-4">';
            
            // Insights Panel
            html += '<div class="card mb-3">' +
                '<div class="card-header py-2"><strong><i class="fas fa-lightbulb text-warning mr-2"></i>AI Insights</strong>' +
                    '<span class="badge badge-' + (insights.length > 3 ? 'danger' : insights.length > 0 ? 'warning' : 'success') + ' float-right">' + insights.length + '</span></div>' +
                '<div class="card-body p-0" style="max-height:280px;overflow-y:auto;">';
            
            if (insights.length === 0) {
                html += '<div class="p-3 text-center text-muted"><i class="fas fa-check-circle text-success"></i> No anomalies detected</div>';
            } else {
                insights.slice(0, 6).forEach(function(insight) {
                    var iconColor = insight.type === 'alert' ? 'text-danger' : 'text-warning';
                    html += '<div class="px-3 py-2 border-bottom"><div class="d-flex align-items-start">' +
                        '<i class="fas fa-exclamation-circle ' + iconColor + ' mr-2 mt-1"></i>' +
                        '<div><strong class="small">' + escapeHtml(insight.title) + '</strong>' +
                        '<div class="text-muted small">' + escapeHtml(insight.message) + '</div></div></div></div>';
                });
            }
            html += '</div></div>';
            
            // Detector Quick Summary - compact grid showing all 8
            html += '<div class="card"><div class="card-header py-2"><strong><i class="fas fa-search-dollar text-info mr-2"></i>Detector Summary</strong></div>' +
                '<div class="card-body p-2"><div class="row text-center">';
            
            var frogCount = (data.boilingFrog && data.boilingFrog.summary.count) || 0;
            var anomalyCount = (data.anomalies && data.anomalies.summary.count) || 0;
            var zombieCount = (data.zombieSubscriptions && data.zombieSubscriptions.summary.count) || 0;
            var shadowCount = (data.shadowIT && data.shadowIT.summary.viralCount) || 0;
            var fragCount = (data.categoryFragmentation && data.categoryFragmentation.summary.fragmentedCategories) || 0;
            var concRisk = Math.round((data.concentrationRisk && data.concentrationRisk.summary.top1Share) || 0);
            var cliffGap = Math.round((data.commitmentCliff && data.commitmentCliff.summary.velocityGap) || 0);
            var seasonalCount = (data.seasonalPatterns && data.seasonalPatterns.anomalies && data.seasonalPatterns.anomalies.length) || 0;
            
            html += '<div class="col-3 mb-2"><div class="p-1 rounded ' + (frogCount > 0 ? 'bg-purple-soft' : 'bg-light') + '">' +
                '<i class="fas fa-frog text-purple fa-sm"></i><div class="font-weight-bold">' + frogCount + '</div><div class="small text-muted" style="font-size:10px;">Frog</div></div></div>';
            html += '<div class="col-3 mb-2"><div class="p-1 rounded ' + (anomalyCount > 0 ? 'bg-danger-soft' : 'bg-light') + '">' +
                '<i class="fas fa-bolt text-danger fa-sm"></i><div class="font-weight-bold">' + anomalyCount + '</div><div class="small text-muted" style="font-size:10px;">Anomaly</div></div></div>';
            html += '<div class="col-3 mb-2"><div class="p-1 rounded ' + (zombieCount > 0 ? 'bg-secondary-soft' : 'bg-light') + '">' +
                '<i class="fas fa-ghost text-secondary fa-sm"></i><div class="font-weight-bold">' + zombieCount + '</div><div class="small text-muted" style="font-size:10px;">Zombie</div></div></div>';
            html += '<div class="col-3 mb-2"><div class="p-1 rounded ' + (shadowCount > 0 ? 'bg-pink-soft' : 'bg-light') + '">' +
                '<i class="fas fa-virus text-pink fa-sm"></i><div class="font-weight-bold">' + shadowCount + '</div><div class="small text-muted" style="font-size:10px;">Shadow</div></div></div>';
            html += '<div class="col-3"><div class="p-1 rounded ' + (fragCount > 0 ? 'bg-orange-soft' : 'bg-light') + '">' +
                '<i class="fas fa-puzzle-piece text-orange fa-sm"></i><div class="font-weight-bold">' + fragCount + '</div><div class="small text-muted" style="font-size:10px;">Frag</div></div></div>';
            html += '<div class="col-3"><div class="p-1 rounded ' + (concRisk > 25 ? 'bg-warning-soft' : 'bg-light') + '">' +
                '<i class="fas fa-chart-pie text-warning fa-sm"></i><div class="font-weight-bold">' + concRisk + '%</div><div class="small text-muted" style="font-size:10px;">Conc</div></div></div>';
            html += '<div class="col-3"><div class="p-1 rounded ' + (cliffGap > 10 ? 'bg-info-soft' : 'bg-light') + '">' +
                '<i class="fas fa-mountain text-info fa-sm"></i><div class="font-weight-bold">' + cliffGap + '%</div><div class="small text-muted" style="font-size:10px;">Cliff</div></div></div>';
            html += '<div class="col-3"><div class="p-1 rounded ' + (seasonalCount > 0 ? 'bg-teal-soft' : 'bg-light') + '">' +
                '<i class="fas fa-snowflake text-teal fa-sm"></i><div class="font-weight-bold">' + seasonalCount + '</div><div class="small text-muted" style="font-size:10px;">Season</div></div></div>';
            
            html += '</div></div></div>';
            
            html += '</div>'; // col-lg-4
            html += '</div>'; // row
            
            container.innerHTML = html;
            
            // Render charts
            this.renderOverviewCharts();
        },
        
        renderOverviewCharts: function() {
            var data = this.latestData.results;
            var self = this;
            
            // Pie Chart - Top 10 Accounts by spend
            var pieEl = el('#svOverviewPieChart');
            if (pieEl && typeof Plotly !== 'undefined') {
                var accounts = (data.accountVelocity || []).slice(0, 10);
                if (accounts.length > 0) {
                    var trace = { type: 'pie', labels: accounts.map(function(a) { return a.accountName; }), 
                        values: accounts.map(function(a) { return a.totalSpend; }), hole: 0.4, textinfo: 'percent',
                        marker: { colors: ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308'] }
                    };
                    Plotly.newPlot(pieEl, [trace], { margin: { t: 10, r: 10, b: 10, l: 10 }, showlegend: false, height: 200 }, { responsive: true, displayModeBar: false });
                }
            }
            
            // Scatter Chart - Velocity vs Acceleration with IQR-based zoom (excludes outliers)
            var scatterEl = el('#svOverviewScatterChart');
            if (scatterEl && typeof Plotly !== 'undefined') {
                var accounts = data.accountVelocity || [];
                if (accounts.length > 0) {
                    var velocities = accounts.map(function(a) { return a.velocity || 0; });
                    var accelerations = accounts.map(function(a) { return a.acceleration || 0; });
                    
                    // Calculate IQR bounds to exclude outliers
                    var getIQRBounds = function(arr) {
                        var sorted = arr.slice().sort(function(a, b) { return a - b; });
                        var q1 = sorted[Math.floor(sorted.length * 0.25)];
                        var q3 = sorted[Math.floor(sorted.length * 0.75)];
                        var iqr = q3 - q1;
                        return { min: q1 - 1.5 * iqr, max: q3 + 1.5 * iqr };
                    };
                    
                    var vBounds = getIQRBounds(velocities);
                    var aBounds = getIQRBounds(accelerations);
                    
                    // Use IQR bounds or actual range if smaller (with padding)
                    var vMin = Math.max(vBounds.min, Math.min.apply(null, velocities));
                    var vMax = Math.min(vBounds.max, Math.max.apply(null, velocities));
                    var aMin = Math.max(aBounds.min, Math.min.apply(null, accelerations));
                    var aMax = Math.min(aBounds.max, Math.max.apply(null, accelerations));
                    var vPad = Math.max(2, (vMax - vMin) * 0.15);
                    var aPad = Math.max(1, (aMax - aMin) * 0.15);
                    
                    // Size based on relative spend
                    var maxSpend = Math.max.apply(null, accounts.map(function(a) { return a.totalSpend || 1; }));
                    
                    var trace = { type: 'scatter', mode: 'markers',
                        x: velocities, y: accelerations,
                        text: accounts.map(function(a) { return a.accountName; }),
                        marker: { 
                            size: accounts.map(function(a) { return Math.max(8, Math.min(25, 8 + (a.totalSpend / maxSpend) * 17)); }),
                            color: velocities, colorscale: 'RdYlGn', reversescale: true,
                            line: { width: 1, color: 'rgba(255,255,255,0.5)' }
                        },
                        hovertemplate: '<b>%{text}</b><br>Velocity: %{x:.1f}%<br>Accel: %{y:.1f}%<extra></extra>'
                    };
                    Plotly.newPlot(scatterEl, [trace], { 
                        margin: { t: 5, r: 10, b: 35, l: 45 }, height: 175,
                        xaxis: { title: { text: 'Velocity %', font: { size: 11 } }, zeroline: true, zerolinecolor: '#ddd', range: [vMin - vPad, vMax + vPad] }, 
                        yaxis: { title: { text: 'Accel', font: { size: 11 } }, zeroline: true, zerolinecolor: '#ddd', range: [aMin - aPad, aMax + aPad] }
                    }, { responsive: true, displayModeBar: false });
                }
            }
            
            // Area Chart - Monthly Trend (uses totalAmount from backend)
            var trendEl = el('#svOverviewTrendChart');
            if (trendEl && typeof Plotly !== 'undefined') {
                var trends = data.monthlyTrends || [];
                if (trends.length >= 2) {
                    var trace = { type: 'scatter', mode: 'lines', fill: 'tozeroy',
                        x: trends.map(function(t) { return t.month; }), 
                        y: trends.map(function(t) { return Math.round(t.totalAmount || 0); }),
                        fillcolor: 'rgba(99, 102, 241, 0.2)', line: { color: '#6366f1', width: 2 },
                        hovertemplate: '%{x}<br>' + self.currencySymbol + '%{y:,.0f}<extra></extra>'
                    };
                    Plotly.newPlot(trendEl, [trace], { 
                        margin: { t: 10, r: 20, b: 40, l: 70 }, height: 200, 
                        yaxis: { 
                            tickprefix: self.currencySymbol,
                            tickformat: ',.0f',
                            hoverformat: ',.0f'
                        }
                    }, { responsive: true, displayModeBar: false });
                } else {
                    trendEl.innerHTML = '<div class="text-center text-muted py-5">Insufficient trend data</div>';
                }
            }
        },
        
        renderAcceleration: function(acceleration) {
            // Show acceleration as a compact indicator with value and trend arrow
            var absVal = Math.abs(acceleration || 0);
            var sign = acceleration >= 0 ? '+' : '-';
            var color, icon;
            
            if (acceleration > 3) {
                color = 'danger'; icon = 'angle-double-up';
            } else if (acceleration > 1) {
                color = 'warning'; icon = 'angle-up';
            } else if (acceleration < -3) {
                color = 'success'; icon = 'angle-double-down';
            } else if (acceleration < -1) {
                color = 'info'; icon = 'angle-down';
            } else {
                color = 'secondary'; icon = 'minus';
            }
            
            return '<span class="sv-accel-indicator text-' + color + '" title="Acceleration: ' + sign + absVal.toFixed(1) + '%">' +
                '<i class="fas fa-' + icon + '"></i> ' + sign + absVal.toFixed(1) + '%</span>';
        },
        
        renderVelocityTab: function() {
            var container = el('#svVelocityContent');
            if (!container || !this.latestData) return;
            
            var data = this.latestData.results;
            var accounts = data.accountVelocity || [];
            var vendors = data.vendorVelocity || [];
            var self = this;
            
            var html = '<div class="row">';
            
            // Account Velocity Table (PRIMARY)
            html += '<div class="col-lg-7">';
            html += '<div class="card mb-3">' +
                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                '<strong><i class="fas fa-layer-group text-primary mr-2"></i>Expense Account Velocity</strong>' +
                '<span class="badge badge-primary">' + accounts.length + '</span></div>' +
                '<div class="card-body p-0">' +
                    '<div class="table-responsive" style="max-height: 500px; overflow-y: auto;">' +
                        '<table class="table table-hover sv-velocity-table mb-0">' +
                            '<thead class="thead-light sticky-top"><tr>' +
                                '<th class="sv-sortable" onclick="SpendVelocityController.sortVelocityTable(\'accounts\', \'accountName\')">Account <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                                '<th class="sv-sortable text-right" onclick="SpendVelocityController.sortVelocityTable(\'accounts\', \'totalSpend\')">Spend <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                                '<th class="text-right">Bills/Exp</th>' +
                                '<th class="sv-sortable text-right" onclick="SpendVelocityController.sortVelocityTable(\'accounts\', \'velocity\')">Velocity <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                                '<th class="sv-sortable text-center" onclick="SpendVelocityController.sortVelocityTable(\'accounts\', \'acceleration\')">Accel. <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                                '<th>Sparkline</th>' +
                            '</tr></thead>' +
                            '<tbody id="svVelocityAccountsBody">';
            
            this.velocityAccounts = accounts;
            this.velocityAccountsSort = { col: 'totalSpend', dir: 'desc' };
            
            html += this.renderVelocityAccountRows(accounts);
            
            html += '</tbody></table></div></div></div>';
            html += '</div>';
            
            // Vendor Velocity (DRILL-DOWN)
            html += '<div class="col-lg-5">';
            html += '<div class="card mb-3">' +
                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                '<strong><i class="fas fa-users text-info mr-2"></i>Vendor Drill-Down</strong>' +
                '<span class="badge badge-info">' + vendors.length + '</span></div>' +
                '<div class="card-body p-0">' +
                    '<div class="table-responsive" style="max-height: 500px; overflow-y: auto;">' +
                        '<table class="table table-hover sv-velocity-table mb-0">' +
                            '<thead class="thead-light sticky-top"><tr>' +
                                '<th class="sv-sortable" onclick="SpendVelocityController.sortVelocityTable(\'vendors\', \'vendorName\')">Vendor <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                                '<th class="sv-sortable text-right" onclick="SpendVelocityController.sortVelocityTable(\'vendors\', \'totalSpend\')">Spend <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                                '<th class="sv-sortable text-right" onclick="SpendVelocityController.sortVelocityTable(\'vendors\', \'velocity\')">Velocity <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                            '</tr></thead>' +
                            '<tbody id="svVelocityVendorsBody">';
            
            this.velocityVendors = vendors;
            this.velocityVendorsSort = { col: 'totalSpend', dir: 'desc' };
            
            html += this.renderVelocityVendorRows(vendors);
            
            html += '</tbody></table></div></div></div>';
            html += '</div>';
            
            html += '</div>';
            
            container.innerHTML = html;
        },
        
        renderVelocityAccountRows: function(accounts) {
            var self = this;
            var sorted = this.sortData(accounts, this.velocityAccountsSort.col, this.velocityAccountsSort.dir);
            var html = '';
            
            sorted.forEach(function(acct) {
                var velocityClass = acct.velocity > 15 ? 'hot' : acct.velocity > 5 ? 'warm' : acct.velocity < -5 ? 'cold' : 'cool';
                var sparkData = acct.monthlyAmounts || [];
                
                html += '<tr class="sv-clickable" onclick="SpendVelocityController.drilldownAccount(' + acct.accountId + ', \'' + escapeHtml(acct.accountName || '').replace(/'/g, "\\'") + '\')">' +
                    '<td>' +
                        '<div class="sv-vendor-cell">' +
                            '<div class="sv-vendor-avatar">' + (acct.accountNumber || acct.accountName || 'A').charAt(0).toUpperCase() + '</div>' +
                            '<div class="sv-vendor-info">' +
                                '<div class="sv-vendor-name">' + escapeHtml(acct.accountName || 'Unknown') + '</div>' +
                                '<div class="sv-vendor-category">' + acct.transactionCount + ' txns | ' + acct.monthCount + ' months</div>' +
                            '</div>' +
                        '</div>' +
                    '</td>' +
                    '<td class="text-right">' + self.formatCurrency(acct.totalSpend) + '</td>' +
                    '<td class="text-right">' +
                        '<span class="badge badge-light">' + acct.billPct + '%</span> / ' +
                        '<span class="badge badge-light">' + acct.expensePct + '%</span>' +
                    '</td>' +
                    '<td class="text-right">' +
                        '<span class="sv-velocity-indicator ' + velocityClass + '">' +
                            '<i class="fas fa-' + (acct.velocity >= 0 ? 'arrow-up' : 'arrow-down') + '"></i> ' +
                            Math.abs(acct.velocity).toFixed(1) + '%' +
                        '</span>' +
                    '</td>' +
                    '<td class="text-center">' + self.renderAcceleration(acct.acceleration) + '</td>' +
                    '<td>' + Sparkline.generate(sparkData, { width: 60, height: 20 }) + '</td>' +
                '</tr>';
            });
            return html;
        },
        
        renderVelocityVendorRows: function(vendors) {
            var self = this;
            var sorted = this.sortData(vendors, this.velocityVendorsSort.col, this.velocityVendorsSort.dir);
            var html = '';
            
            sorted.forEach(function(vendor) {
                var velocityClass = vendor.velocity > 15 ? 'hot' : vendor.velocity > 5 ? 'warm' : vendor.velocity < -5 ? 'cold' : 'cool';
                
                html += '<tr class="sv-clickable" onclick="SpendVelocityController.drilldownVendor(' + vendor.vendorId + ', \'' + escapeHtml(vendor.vendorName || '').replace(/'/g, "\\'") + '\')">' +
                    '<td>' +
                        '<div class="sv-vendor-name">' + escapeHtml(vendor.vendorName || 'Unknown') + '</div>' +
                        '<div class="sv-vendor-category">' + vendor.transactionCount + ' txns</div>' +
                    '</td>' +
                    '<td class="text-right">' + self.formatCurrency(vendor.totalSpend) + '</td>' +
                    '<td class="text-right">' +
                        '<span class="sv-velocity-indicator ' + velocityClass + '">' +
                            '<i class="fas fa-' + (vendor.velocity >= 0 ? 'arrow-up' : 'arrow-down') + '"></i> ' +
                            Math.abs(vendor.velocity).toFixed(1) + '%' +
                        '</span>' +
                    '</td>' +
                '</tr>';
            });
            return html;
        },
        
        sortVelocityTable: function(tableType, col) {
            if (tableType === 'accounts') {
                if (this.velocityAccountsSort.col === col) {
                    this.velocityAccountsSort.dir = this.velocityAccountsSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    this.velocityAccountsSort.col = col;
                    this.velocityAccountsSort.dir = 'desc';
                }
                el('#svVelocityAccountsBody').innerHTML = this.renderVelocityAccountRows(this.velocityAccounts);
            } else {
                if (this.velocityVendorsSort.col === col) {
                    this.velocityVendorsSort.dir = this.velocityVendorsSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    this.velocityVendorsSort.col = col;
                    this.velocityVendorsSort.dir = 'desc';
                }
                el('#svVelocityVendorsBody').innerHTML = this.renderVelocityVendorRows(this.velocityVendors);
            }
        },
        
        renderDetectorsTab: function() {
            var container = el('#svDetectorsContent');
            if (!container || !this.latestData) return;
            
            var data = this.latestData.results;
            var self = this;
            
            // Store detector data for filtering
            this.detectorData = {
                frog: data.boilingFrog || { summary: {}, vendors: [] },
                shadow: data.shadowIT || { summary: {}, items: [] },
                anomaly: data.anomalies || { summary: {}, items: [] },
                zombie: data.zombieSubscriptions || { summary: {}, subscriptions: [] },
                concentration: data.concentrationRisk || { summary: {}, items: [] },
                fragmentation: data.categoryFragmentation || { summary: {}, categories: [] },
                cliff: data.commitmentCliff || { summary: {} },
                seasonal: data.seasonalPatterns || { summary: {}, anomalies: [] }
            };
            
            // Detector summary counts
            var frogCount = (this.detectorData.frog.summary.count) || 0;
            var shadowCount = (this.detectorData.shadow.summary.viralCount) || 0;
            var anomalyCount = (this.detectorData.anomaly.summary.count) || 0;
            var zombieCount = (this.detectorData.zombie.summary.count) || 0;
            var fragCount = (this.detectorData.fragmentation.summary.fragmentedCategories) || 0;
            var concRisk = (this.detectorData.concentration.summary.top1Share) || 0;
            var cliffGap = (this.detectorData.cliff.summary.velocityGap) || 0;
            var seasonalCount = (this.detectorData.seasonal.anomalies && this.detectorData.seasonal.anomalies.length) || 0;
            
            var totalAlerts = frogCount + shadowCount + anomalyCount + zombieCount + fragCount + seasonalCount;
            
            // Summary header
            var html = '<div class="row mb-3">' +
                '<div class="col-12"><div class="alert alert-' + (totalAlerts > 5 ? 'danger' : totalAlerts > 0 ? 'warning' : 'success') + ' py-2 mb-0">' +
                '<i class="fas fa-' + (totalAlerts > 0 ? 'exclamation-triangle' : 'check-circle') + ' mr-2"></i>' +
                '<strong>' + totalAlerts + ' Total Alerts</strong> across 8 detectors — <span class="text-muted">Click a card to see details</span></div></div></div>';
            
            // Compact detector cards grid - 4 per row, all clickable
            html += '<div class="row" id="svDetectorCards">';
            
            // 1. Boiling Frog
            html += '<div class="col-lg-3 col-md-6 mb-3">' +
                '<div class="card h-100 sv-detector-mini sv-detector-clickable ' + (frogCount > 0 ? 'border-purple' : '') + '" data-detector="frog" onclick="SpendVelocityController.selectDetector(\'frog\')">' +
                '<div class="card-body p-3">' +
                '<div class="d-flex justify-content-between align-items-start mb-2">' +
                '<div><i class="fas fa-frog text-purple mr-2"></i><strong>Boiling Frog</strong></div>' +
                '<span class="badge badge-' + (frogCount > 0 ? 'purple' : 'light') + '">' + frogCount + '</span></div>' +
                '<div class="small text-muted mb-2">Silent subscription creep</div>' +
                '<div class="sv-detector-metric"><span class="h4 mb-0">' + self.formatCurrency(this.detectorData.frog.summary.totalAnnualizedCreep || 0) + '</span><span class="small text-muted ml-1">annual impact</span></div>' +
                '</div></div></div>';
            
            // 2. Shadow IT
            html += '<div class="col-lg-3 col-md-6 mb-3">' +
                '<div class="card h-100 sv-detector-mini sv-detector-clickable ' + (shadowCount > 0 ? 'border-pink' : '') + '" data-detector="shadow" onclick="SpendVelocityController.selectDetector(\'shadow\')">' +
                '<div class="card-body p-3">' +
                '<div class="d-flex justify-content-between align-items-start mb-2">' +
                '<div><i class="fas fa-virus text-pink mr-2"></i><strong>Shadow IT</strong></div>' +
                '<span class="badge badge-' + (shadowCount > 0 ? 'pink' : 'light') + '">' + shadowCount + '</span></div>' +
                '<div class="small text-muted mb-2">Viral software adoption</div>' +
                '<div class="sv-detector-metric"><span class="h4 mb-0">' + (this.detectorData.shadow.summary.totalEmployeesTouchpoints || 0) + '</span><span class="small text-muted ml-1">employee touchpoints</span></div>' +
                '</div></div></div>';
            
            // 3. Anomalies
            html += '<div class="col-lg-3 col-md-6 mb-3">' +
                '<div class="card h-100 sv-detector-mini sv-detector-clickable ' + (anomalyCount > 0 ? 'border-danger' : '') + '" data-detector="anomaly" onclick="SpendVelocityController.selectDetector(\'anomaly\')">' +
                '<div class="card-body p-3">' +
                '<div class="d-flex justify-content-between align-items-start mb-2">' +
                '<div><i class="fas fa-bolt text-danger mr-2"></i><strong>Anomalies</strong></div>' +
                '<span class="badge badge-' + (anomalyCount > 0 ? 'danger' : 'light') + '">' + anomalyCount + '</span></div>' +
                '<div class="small text-muted mb-2">Statistical outliers (>2σ)</div>' +
                '<div class="sv-detector-metric"><span class="h4 mb-0">' + (this.detectorData.anomaly.summary.criticalCount || 0) + '</span><span class="small text-muted ml-1">critical</span></div>' +
                '</div></div></div>';
            
            // 4. Zombie Subscriptions
            html += '<div class="col-lg-3 col-md-6 mb-3">' +
                '<div class="card h-100 sv-detector-mini sv-detector-clickable ' + (zombieCount > 0 ? 'border-secondary' : '') + '" data-detector="zombie" onclick="SpendVelocityController.selectDetector(\'zombie\')">' +
                '<div class="card-body p-3">' +
                '<div class="d-flex justify-content-between align-items-start mb-2">' +
                '<div><i class="fas fa-ghost text-secondary mr-2"></i><strong>Zombies</strong></div>' +
                '<span class="badge badge-' + (zombieCount > 0 ? 'secondary' : 'light') + '">' + zombieCount + '</span></div>' +
                '<div class="small text-muted mb-2">Unchanged recurring costs</div>' +
                '<div class="sv-detector-metric"><span class="h4 mb-0">' + self.formatCurrency(this.detectorData.zombie.summary.totalAnnualCost || 0) + '</span><span class="small text-muted ml-1">annual cost</span></div>' +
                '</div></div></div>';
            
            // 5. Concentration Risk
            html += '<div class="col-lg-3 col-md-6 mb-3">' +
                '<div class="card h-100 sv-detector-mini sv-detector-clickable ' + (concRisk > 25 ? 'border-warning' : '') + '" data-detector="concentration" onclick="SpendVelocityController.selectDetector(\'concentration\')">' +
                '<div class="card-body p-3">' +
                '<div class="d-flex justify-content-between align-items-start mb-2">' +
                '<div><i class="fas fa-chart-pie text-warning mr-2"></i><strong>Concentration</strong></div>' +
                '<span class="badge badge-' + (concRisk > 25 ? 'warning' : 'light') + '">' + Math.round(concRisk) + '%</span></div>' +
                '<div class="small text-muted mb-2">Top vendor share risk</div>' +
                '<div class="sv-detector-metric"><span class="h4 mb-0">' + Math.round(this.detectorData.concentration.summary.top3Share || 0) + '%</span><span class="small text-muted ml-1">top 3 share</span></div>' +
                '</div></div></div>';
            
            // 6. Fragmentation
            html += '<div class="col-lg-3 col-md-6 mb-3">' +
                '<div class="card h-100 sv-detector-mini sv-detector-clickable ' + (fragCount > 0 ? 'border-orange' : '') + '" data-detector="fragmentation" onclick="SpendVelocityController.selectDetector(\'fragmentation\')">' +
                '<div class="card-body p-3">' +
                '<div class="d-flex justify-content-between align-items-start mb-2">' +
                '<div><i class="fas fa-puzzle-piece text-orange mr-2"></i><strong>Fragmentation</strong></div>' +
                '<span class="badge badge-' + (fragCount > 0 ? 'orange' : 'light') + '">' + fragCount + '</span></div>' +
                '<div class="small text-muted mb-2">Many small purchases</div>' +
                '<div class="sv-detector-metric"><span class="h4 mb-0">' + self.formatCurrency(this.detectorData.fragmentation.summary.potentialSavings || 0) + '</span><span class="small text-muted ml-1">savings potential</span></div>' +
                '</div></div></div>';
            
            // 7. Commitment Cliff
            var cliffStatus = this.detectorData.cliff.summary.status || 'healthy';
            html += '<div class="col-lg-3 col-md-6 mb-3">' +
                '<div class="card h-100 sv-detector-mini sv-detector-clickable ' + (cliffStatus !== 'healthy' ? 'border-info' : '') + '" data-detector="cliff" onclick="SpendVelocityController.selectDetector(\'cliff\')">' +
                '<div class="card-body p-3">' +
                '<div class="d-flex justify-content-between align-items-start mb-2">' +
                '<div><i class="fas fa-mountain text-info mr-2"></i><strong>Commit. Cliff</strong></div>' +
                '<span class="badge badge-' + (cliffStatus !== 'healthy' ? 'info' : 'light') + '">' + (cliffGap || 0) + '%</span></div>' +
                '<div class="small text-muted mb-2">PO vs SO velocity gap</div>' +
                '<div class="sv-detector-metric"><span class="h4 mb-0">' + (this.detectorData.cliff.summary.poVelocity || 0) + '%</span><span class="small text-muted ml-1">PO velocity</span></div>' +
                '</div></div></div>';
            
            // 8. Seasonal Anomalies
            var seasonSummary = this.detectorData.seasonal.summary || {};
            html += '<div class="col-lg-3 col-md-6 mb-3">' +
                '<div class="card h-100 sv-detector-mini sv-detector-clickable ' + (seasonalCount > 0 ? 'border-teal' : '') + '" data-detector="seasonal" onclick="SpendVelocityController.selectDetector(\'seasonal\')">' +
                '<div class="card-body p-3">' +
                '<div class="d-flex justify-content-between align-items-start mb-2">' +
                '<div><i class="fas fa-snowflake text-teal mr-2"></i><strong>Seasonal</strong></div>' +
                '<span class="badge badge-' + (seasonalCount > 0 ? 'teal' : 'light') + '">' + seasonalCount + '</span></div>' +
                '<div class="small text-muted mb-2">Off-pattern spending</div>' +
                '<div class="sv-detector-metric"><span class="h4 mb-0">' + (seasonSummary.seasonalityStrength || 0) + '%</span><span class="small text-muted ml-1">seasonality</span></div>' +
                '</div></div></div>';
            
            html += '</div>'; // row
            
            // Detailed table with filter state
            html += '<div class="card mt-2">' +
                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                '<div><strong><i class="fas fa-list mr-2"></i>Alert Details</strong> <span id="svDetectorFilterLabel" class="badge badge-primary ml-2" style="display:none;">Filtered</span></div>' +
                '<button class="btn btn-sm btn-outline-secondary" id="svDetectorClearFilter" style="display:none;" onclick="SpendVelocityController.selectDetector(\'all\')"><i class="fas fa-times mr-1"></i>Clear Filter</button>' +
                '</div>' +
                '<div class="card-body p-0"><div class="table-responsive" style="max-height:400px;"><table class="table table-hover table-sm mb-0">' +
                '<thead class="thead-light sticky-top"><tr><th>Detector</th><th>Item</th><th>Severity</th><th class="text-right">Impact</th><th>Details</th></tr></thead>' +
                '<tbody id="svDetectorTableBody"></tbody></table></div></div></div>';
            
            container.innerHTML = html;
            this.selectedDetector = 'all';
            this.renderDetectorTable();
        },
        
        selectDetector: function(detector) {
            this.selectedDetector = detector;
            
            // Update card selection state
            document.querySelectorAll('.sv-detector-clickable').forEach(function(card) {
                card.classList.remove('sv-detector-selected');
                if (detector !== 'all' && card.dataset.detector === detector) {
                    card.classList.add('sv-detector-selected');
                }
            });
            
            // Show/hide filter UI
            var filterLabel = el('#svDetectorFilterLabel');
            var clearBtn = el('#svDetectorClearFilter');
            if (detector === 'all') {
                filterLabel.style.display = 'none';
                clearBtn.style.display = 'none';
            } else {
                filterLabel.textContent = detector.charAt(0).toUpperCase() + detector.slice(1);
                filterLabel.style.display = 'inline';
                clearBtn.style.display = 'inline-block';
            }
            
            this.renderDetectorTable();
        },
        
        renderDetectorTable: function() {
            var tbody = el('#svDetectorTableBody');
            if (!tbody || !this.detectorData) return;
            
            var self = this;
            var filter = this.selectedDetector;
            var allAlerts = [];
            
            // Build alerts from each detector
            if (filter === 'all' || filter === 'frog') {
                (this.detectorData.frog.vendors || []).forEach(function(v) {
                    allAlerts.push({ detector: 'frog', label: 'Boiling Frog', icon: 'frog', color: 'purple', item: v.vendorName, severity: v.totalCreep > 20 ? 'High' : 'Medium', impact: v.annualizedCreep || 0, details: '+' + (v.avgMonthlyIncrease || 0).toFixed(1) + '%/mo for ' + v.monthCount + ' months', actionable: true, vendorId: v.vendorId });
                });
            }
            if (filter === 'all' || filter === 'shadow') {
                (this.detectorData.shadow.items || []).forEach(function(i) {
                    allAlerts.push({ detector: 'shadow', label: 'Shadow IT', icon: 'virus', color: 'pink', item: i.vendorName, severity: i.isViral ? 'High' : 'Low', impact: i.totalSpend || 0, details: (i.startEmployees || 0) + ' → ' + (i.currentEmployees || 0) + ' employees', actionable: true, vendorId: i.vendorId });
                });
            }
            if (filter === 'all' || filter === 'anomaly') {
                (this.detectorData.anomaly.items || []).forEach(function(a) {
                    allAlerts.push({ detector: 'anomaly', label: 'Anomaly', icon: 'bolt', color: 'danger', item: a.accountName, severity: a.zScore > 3 ? 'Critical' : 'High', impact: a.amount || 0, details: (a.zScore || 0).toFixed(1) + 'σ from mean', actionable: true, accountId: a.accountId });
                });
            }
            if (filter === 'all' || filter === 'zombie') {
                (this.detectorData.zombie.subscriptions || []).forEach(function(z) {
                    allAlerts.push({ detector: 'zombie', label: 'Zombie', icon: 'ghost', color: 'secondary', item: z.vendorName, severity: 'Medium', impact: (z.amount || 0) * 12, details: 'Unchanged for ' + (z.monthCount || 0) + ' months', actionable: true, vendorId: z.vendorId });
                });
            }
            if (filter === 'all' || filter === 'concentration') {
                (this.detectorData.concentration.items || []).forEach(function(c) {
                    allAlerts.push({ detector: 'concentration', label: 'Concentration', icon: 'chart-pie', color: 'warning', item: c.vendorName || c.name, severity: c.share > 30 ? 'High' : 'Medium', impact: c.spend || 0, details: (c.share || 0).toFixed(1) + '% of spend', actionable: true, vendorId: c.vendorId });
                });
            }
            if (filter === 'all' || filter === 'fragmentation') {
                (this.detectorData.fragmentation.categories || []).forEach(function(f) {
                    allAlerts.push({ detector: 'fragmentation', label: 'Fragmentation', icon: 'puzzle-piece', color: 'orange', item: f.accountName || f.categoryName || 'Unknown', severity: f.txnsPerMonth > 50 ? 'High' : 'Medium', impact: f.totalSpend || 0, details: f.txnsPerMonth + ' txns/mo, avg ' + self.formatCurrency(f.avgTransactionSize || 0), actionable: true, accountId: f.accountId || f.categoryId });
                });
            }
            if (filter === 'all' || filter === 'seasonal') {
                (this.detectorData.seasonal.anomalies || []).forEach(function(s) {
                    allAlerts.push({ detector: 'seasonal', label: 'Seasonal', icon: 'snowflake', color: 'teal', item: s.month || s.period, severity: s.deviation > 50 ? 'High' : 'Low', impact: s.amount || 0, details: (s.deviation || 0).toFixed(0) + '% from expected', actionable: false });
                });
            }
            
            // Sort by impact
            allAlerts.sort(function(a, b) { return b.impact - a.impact; });
            
            var html = '';
            if (allAlerts.length === 0) {
                html = '<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-check-circle text-success fa-2x mb-2"></i><br>No alerts detected' + (filter !== 'all' ? ' for this detector' : '') + '</td></tr>';
            } else {
                allAlerts.forEach(function(a) {
                    var sevClass = a.severity === 'Critical' ? 'danger' : a.severity === 'High' ? 'warning' : 'secondary';
                    var clickHandler = '';
                    if (a.actionable && a.accountId) {
                        clickHandler = 'onclick="SpendVelocityController.drilldownAccount(' + a.accountId + ', \'' + escapeHtml(a.item).replace(/'/g, "\\'") + '\')"';
                    } else if (a.actionable && a.vendorId) {
                        clickHandler = 'onclick="SpendVelocityController.drilldownVendor(' + a.vendorId + ', \'' + escapeHtml(a.item).replace(/'/g, "\\'") + '\')"';
                    }
                    var rowClass = a.actionable ? 'sv-clickable' : '';
                    html += '<tr class="' + rowClass + '" ' + clickHandler + '>' +
                        '<td><i class="fas fa-' + a.icon + ' text-' + a.color + ' mr-2"></i>' + a.label + '</td>' +
                        '<td><strong>' + escapeHtml(a.item || 'Unknown') + '</strong></td>' +
                        '<td><span class="badge badge-' + sevClass + '">' + a.severity + '</span></td>' +
                        '<td class="text-right">' + self.formatCurrency(a.impact) + '</td>' +
                        '<td class="small text-muted">' + a.details + '</td></tr>';
                });
            }
            
            tbody.innerHTML = html;
        },
        
        drilldownVendor: async function(vendorId, vendorName) {
            var self = this;
            this.drilldown = { active: true, type: 'vendor', id: vendorId, name: vendorName };
            
            var panel = el('#svDrilldownPanel');
            var title = el('#svDrilldownTitle');
            var body = el('#svDrilldownBody');
            
            title.innerHTML = '<i class="fas fa-building mr-2"></i>' + escapeHtml(vendorName) + ' — Vendor Transactions';
            body.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading transactions...</div></div>';
            panel.style.display = 'flex';
            
            try {
                var params = {
                    action: 'spend_velocity',
                    subAction: 'vendor_transactions',
                    vendorId: vendorId,
                    startDate: el('#svStartDate').value,
                    endDate: el('#svEndDate').value,
                    subsidiaryId: el('#svSubsidiary').value || ''
                };
                var res = await API.post('spend_velocity', params);
                if (res.status === 'success' && res.transactions) {
                    this.renderDrilldownContent(res.transactions, vendorName);
                } else {
                    body.innerHTML = '<div class="text-center py-5 text-muted"><i class="fas fa-inbox fa-2x mb-2"></i><div>No transactions found</div></div>';
                }
            } catch (e) {
                body.innerHTML = '<div class="alert alert-warning"><i class="fas fa-exclamation-triangle mr-2"></i>Unable to load transactions</div>';
            }
        },
        
        renderBoilingFrogDetector: function(frogData) {
            var self = this;
            var summary = frogData.summary || {};
            var vendors = frogData.vendors || [];
            var status = summary.criticalCount > 0 ? 'critical' : summary.count > 0 ? 'warning' : 'healthy';
            
            var html = '<div class="sv-detector-card">' +
                '<div class="sv-detector-header">' +
                    '<div class="sv-detector-icon boiling-frog"><i class="fas fa-frog"></i></div>' +
                    '<div class="sv-detector-title-group">' +
                        '<div class="sv-detector-title">Boiling Frog Detector</div>' +
                        '<div class="sv-detector-subtitle">Catches silent subscription creep (1-3% monthly increases)</div>' +
                    '</div>' +
                    '<span class="sv-detector-badge ' + status + '">' + (summary.count || 0) + ' found</span>' +
                '</div>' +
                '<div class="sv-detector-body">' +
                    '<div class="sv-frog-list">';
            
            if (vendors.length === 0) {
                html += '<div class="text-center py-3"><i class="fas fa-check-circle text-success fa-2x mb-2"></i><p class="mb-0 text-muted small">No subscription creep detected</p></div>';
            } else {
                vendors.slice(0, 5).forEach(function(vendor) {
                    html += '<div class="sv-frog-item">' +
                        '<div class="sv-frog-header">' +
                            '<span class="sv-frog-vendor">' + escapeHtml(vendor.vendorName) + '</span>' +
                            '<span class="sv-frog-badge">+' + vendor.totalCreep + '% total</span>' +
                        '</div>' +
                        '<div class="sv-frog-progress">' +
                            '<div class="sv-frog-progress-bar" style="width: ' + Math.min(vendor.monotonicRatio, 100) + '%;"></div>' +
                        '</div>' +
                        '<div class="sv-frog-stats">' +
                            '<span>' + self.formatCurrency(vendor.startAmount) + ' → ' + self.formatCurrency(vendor.endAmount) + '</span>' +
                            '<span>+' + vendor.avgMonthlyIncrease + '%/mo</span>' +
                        '</div>' +
                    '</div>';
                });
            }
            
            html += '</div></div></div>';
            return html;
        },
        
        renderShadowITDetector: function(shadowData) {
            var self = this;
            var summary = shadowData.summary || {};
            var items = shadowData.items || [];
            var status = summary.viralCount > 0 ? 'warning' : 'healthy';
            
            var html = '<div class="sv-detector-card">' +
                '<div class="sv-detector-header">' +
                    '<div class="sv-detector-icon shadow-it"><i class="fas fa-virus"></i></div>' +
                    '<div class="sv-detector-title-group">' +
                        '<div class="sv-detector-title">Shadow IT Radar</div>' +
                        '<div class="sv-detector-subtitle">Tracks viral software adoption via expense reports</div>' +
                    '</div>' +
                    '<span class="sv-detector-badge ' + status + '">' + (summary.viralCount || 0) + ' viral</span>' +
                '</div>' +
                '<div class="sv-detector-body">' +
                    '<div class="sv-viral-list">';
            
            if (items.length === 0) {
                html += '<div class="text-center py-3"><i class="fas fa-shield-alt text-success fa-2x mb-2"></i><p class="mb-0 text-muted small">No viral software detected</p></div>';
            } else {
                items.slice(0, 5).forEach(function(item) {
                    html += '<div class="sv-viral-item">' +
                        '<div class="sv-viral-icon"><i class="fas fa-' + (item.isViral ? 'fire' : 'desktop') + '"></i></div>' +
                        '<div class="sv-viral-info">' +
                            '<div class="sv-viral-name">' + escapeHtml(item.vendorName) + '</div>' +
                            '<div class="sv-viral-spread">' + item.startEmployees + ' → ' + item.currentEmployees + ' employees</div>' +
                        '</div>' +
                        '<div class="sv-viral-trend">' +
                            '<div class="sv-viral-count">' + item.currentEmployees + '</div>' +
                            '<div class="sv-viral-growth">+' + item.employeeGrowth + '%</div>' +
                        '</div>' +
                    '</div>';
                });
            }
            
            html += '</div></div></div>';
            return html;
        },
        
        renderAnomalyDetector: function(anomalyData) {
            var self = this;
            var summary = anomalyData.summary || {};
            var items = anomalyData.items || [];
            var status = summary.criticalCount > 0 ? 'critical' : summary.count > 0 ? 'warning' : 'healthy';
            
            var html = '<div class="sv-detector-card">' +
                '<div class="sv-detector-header">' +
                    '<div class="sv-detector-icon anomaly"><i class="fas fa-chart-bar"></i></div>' +
                    '<div class="sv-detector-title-group">' +
                        '<div class="sv-detector-title">Anomaly Detector</div>' +
                        '<div class="sv-detector-subtitle">Statistical outliers (±2.5σ from mean)</div>' +
                    '</div>' +
                    '<span class="sv-detector-badge ' + status + '">' + (summary.count || 0) + ' found</span>' +
                '</div>' +
                '<div class="sv-detector-body">';
            
            if (items.length === 0) {
                html += '<div class="text-center py-3"><i class="fas fa-chart-line text-success fa-2x mb-2"></i><p class="mb-0 text-muted small">No statistical anomalies</p></div>';
            } else {
                html += '<div class="sv-frog-list">';
                items.slice(0, 5).forEach(function(item) {
                    var typeIcon = item.type === 'spike' ? 'arrow-up text-danger' : 'arrow-down text-success';
                    html += '<div class="sv-frog-item">' +
                        '<div class="d-flex justify-content-between align-items-center">' +
                            '<div>' +
                                '<strong>' + escapeHtml(item.accountName || item.vendorName || 'Unknown') + '</strong>' +
                                '<div class="small text-muted">' + item.month + '</div>' +
                            '</div>' +
                            '<div class="text-right">' +
                                '<div><i class="fas fa-' + typeIcon + ' mr-1"></i>' + self.formatCurrency(item.amount) + '</div>' +
                                '<div class="small text-muted">' + item.deviation + '% from avg</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
                });
                html += '</div>';
            }
            
            html += '</div></div>';
            return html;
        },
        
        renderCommitmentCliffFull: function(cliffData) {
            var summary = cliffData.summary || {};
            var status = summary.status || 'healthy';
            var self = this;
            
            var html = '<div class="sv-cliff-container">' +
                '<div class="sv-cliff-header">' +
                    '<div class="sv-cliff-title"><i class="fas fa-mountain"></i> Commitment Cliff Analysis</div>' +
                    '<span class="badge badge-' + (status === 'critical' ? 'danger' : status === 'warning' ? 'warning' : 'success') + '">' +
                        status.toUpperCase() + '</span>' +
                '</div>' +
                '<div class="row mb-3">' +
                    '<div class="col-md-3 text-center">' +
                        '<div class="h5 mb-0 text-primary">' + (summary.poVelocity || 0) + '%</div>' +
                        '<div class="small text-muted">PO Velocity/mo</div>' +
                    '</div>' +
                    '<div class="col-md-3 text-center">' +
                        '<div class="h5 mb-0 text-success">' + (summary.soVelocity || 0) + '%</div>' +
                        '<div class="small text-muted">SO Velocity/mo</div>' +
                    '</div>' +
                    '<div class="col-md-3 text-center">' +
                        '<div class="h5 mb-0 ' + (status === 'healthy' ? 'text-success' : 'text-danger') + '">' + 
                            (summary.velocityGap || 0) + '%</div>' +
                        '<div class="small text-muted">Velocity Gap</div>' +
                    '</div>' +
                    '<div class="col-md-3 text-center">' +
                        '<div class="h5 mb-0">' + (summary.ratio || 0) + 'x</div>' +
                        '<div class="small text-muted">PO/SO Ratio</div>' +
                    '</div>' +
                '</div>' +
                '<div class="sv-cliff-chart" id="svCliffChart"></div>';
            
            if (status !== 'healthy') {
                html += '<div class="sv-cliff-alert">' +
                    '<div class="sv-cliff-alert-icon"><i class="fas fa-exclamation-triangle"></i></div>' +
                    '<div class="sv-cliff-alert-text">' +
                        '<div class="sv-cliff-alert-title">Commitment Velocity Imbalance</div>' +
                        '<div class="sv-cliff-alert-desc">' +
                            'You are signing purchase commitments faster than closing sales. ' +
                            (summary.monthsToCliff ? 'At current trajectory, expect cash pressure in ~' + summary.monthsToCliff + ' months.' : '') +
                        '</div>' +
                    '</div>' +
                '</div>';
            }
            
            html += '</div>';
            return html;
        },
        
        renderCliffChart: function() {
            var chartEl = el('#svCliffChart');
            if (!chartEl || typeof Plotly === 'undefined' || !this.latestData) return;
            
            var cliffData = this.latestData.results.commitmentCliff || { data: {} };
            var months = cliffData.data.months || [];
            
            if (months.length < 2) {
                chartEl.innerHTML = '<div class="text-center text-muted py-4">Insufficient data for chart</div>';
                return;
            }
            
            var traces = [
                {
                    x: months.map(m => m.month),
                    y: months.map(m => m.poAmount),
                    name: 'Purchase Orders',
                    type: 'scatter',
                    mode: 'lines+markers',
                    line: { color: '#3b82f6', width: 2 },
                    marker: { size: 6 }
                },
                {
                    x: months.map(m => m.month),
                    y: months.map(m => m.soAmount),
                    name: 'Sales Orders',
                    type: 'scatter',
                    mode: 'lines+markers',
                    line: { color: '#10b981', width: 2 },
                    marker: { size: 6 }
                }
            ];
            
            var layout = {
                margin: { t: 20, r: 20, b: 40, l: 60 },
                height: 200,
                showlegend: true,
                legend: { orientation: 'h', y: -0.2 },
                xaxis: { tickfont: { size: 10 } },
                yaxis: { tickfont: { size: 10 }, tickprefix: this.currencySymbol }
            };
            
            Plotly.newPlot(chartEl, traces, layout, { responsive: true, displayModeBar: false });
        },
        
        renderConcentrationRisk: function(concData) {
            var summary = concData.summary || {};
            var vendors = concData.vendors || [];
            var self = this;
            
            var hhiStatus = summary.hhiStatus || 'low';
            var statusClass = hhiStatus === 'high' ? 'danger' : hhiStatus === 'moderate' ? 'warning' : 'success';
            
            var html = '<div class="card mt-3">' +
                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                    '<strong><i class="fas fa-chart-pie text-info mr-2"></i>Concentration Risk</strong>' +
                    '<span class="badge badge-' + statusClass + '">HHI: ' + (summary.hhi || 0) + '</span>' +
                '</div>' +
                '<div class="card-body">' +
                    '<div class="row mb-3">' +
                        '<div class="col-md-3 text-center">' +
                            '<div class="h5 mb-0">' + (summary.top1Share || 0) + '%</div>' +
                            '<div class="small text-muted">Top Vendor Share</div>' +
                        '</div>' +
                        '<div class="col-md-3 text-center">' +
                            '<div class="h5 mb-0">' + (summary.top5Share || 0) + '%</div>' +
                            '<div class="small text-muted">Top 5 Share</div>' +
                        '</div>' +
                        '<div class="col-md-3 text-center">' +
                            '<div class="h5 mb-0">' + (summary.top10Share || 0) + '%</div>' +
                            '<div class="small text-muted">Top 10 Share</div>' +
                        '</div>' +
                        '<div class="col-md-3 text-center">' +
                            '<div class="h5 mb-0 ' + (vendors.length > 0 ? 'text-warning' : 'text-success') + '">' + vendors.length + '</div>' +
                            '<div class="small text-muted">At-Risk Vendors</div>' +
                        '</div>' +
                    '</div>';
            
            if (vendors.length > 0) {
                html += '<div class="alert alert-warning small mb-0">' +
                    '<strong>High Concentration + High Velocity:</strong> These vendors have significant spend share AND are accelerating - double the risk.' +
                    '<ul class="mb-0 mt-2">';
                vendors.slice(0, 5).forEach(function(v) {
                    html += '<li>' + escapeHtml(v.vendorName) + ' (' + v.spendShare.toFixed(1) + '% share, +' + v.velocity + '% velocity)</li>';
                });
                html += '</ul></div>';
            }
            
            html += '</div></div>';
            return html;
        },
        
        renderTreemapTab: function() {
            var container = el('#svTreemapContent');
            if (!container || !this.latestData) return;
            
            var html = '<div class="sv-treemap-container">' +
                '<div class="sv-treemap-header">' +
                    '<div class="sv-treemap-title"><i class="fas fa-th-large"></i> Velocity Treemap</div>' +
                    '<div class="sv-treemap-legend">' +
                        '<div class="sv-legend-item"><div class="sv-legend-dot accelerating"></div><span>Accelerating (Red)</span></div>' +
                        '<div class="sv-legend-item"><div class="sv-legend-dot stable"></div><span>Stable (Gray)</span></div>' +
                        '<div class="sv-legend-item"><div class="sv-legend-dot decelerating"></div><span>Decelerating (Green)</span></div>' +
                    '</div>' +
                '</div>' +
                '<div class="sv-treemap-body">' +
                    '<div id="svTreemap"></div>' +
                '</div>' +
            '</div>' +
            '<div class="alert alert-info mt-3">' +
                '<i class="fas fa-info-circle mr-2"></i>' +
                '<strong>How to read this map:</strong> Box SIZE = Total Spend (bigger = more spend). Box COLOR = Acceleration (red = growing faster, green = slowing down). ' +
                'Your eyes should naturally find the small red boxes - these are emerging problems while they\'re still small.' +
            '</div>';
            
            container.innerHTML = html;
            
            this.renderTreemap();
        },
        
        renderTreemap: function() {
            var chartEl = el('#svTreemap');
            if (!chartEl || typeof Plotly === 'undefined' || !this.latestData) return;
            
            var treemapData = this.latestData.results.treemapData || [];
            
            if (treemapData.length === 0) {
                chartEl.innerHTML = '<div class="text-center text-muted py-5">No treemap data available</div>';
                return;
            }
            
            var labels = treemapData.map(d => d.name);
            var values = treemapData.map(d => d.value);
            var colors = treemapData.map(d => d.color);
            var customdata = treemapData.map(d => [d.velocity, d.acceleration, d.trend]);
            var self = this;
            
            var trace = {
                type: 'treemap',
                labels: labels,
                parents: labels.map(() => ''),
                values: values,
                marker: {
                    colors: colors,
                    line: { width: 2, color: '#fff' }
                },
                customdata: customdata,
                hovertemplate: '<b>%{label}</b><br>' +
                    'Spend: ' + self.currencySymbol + '%{value:,.0f}<br>' +
                    'Velocity: %{customdata[0]}%<br>' +
                    'Acceleration: %{customdata[1]}%<br>' +
                    'Trend: %{customdata[2]}<extra></extra>',
                textinfo: 'label+value',
                texttemplate: '<b>%{label}</b><br>' + self.currencySymbol + '%{value:,.0f}',
                textfont: { size: 11 }
            };
            
            var layout = {
                margin: { t: 10, r: 10, b: 10, l: 10 },
                height: 400
            };
            
            Plotly.newPlot(chartEl, [trace], layout, { responsive: true, displayModeBar: false });
        },
        
        renderTrendsTab: function() {
            var container = el('#svTrendsContent');
            if (!container || !this.latestData) return;
            
            var data = this.latestData.results;
            var monthlyTrends = data.monthlyTrends || [];
            var seasonalPatterns = data.seasonalPatterns || { patterns: [], insights: [] };
            var self = this;
            
            var html = '<div class="row">';
            
            // Monthly Spend Trend Chart
            html += '<div class="col-lg-8">' +
                '<div class="card mb-3">' +
                    '<div class="card-header py-2"><strong><i class="fas fa-chart-area text-primary mr-2"></i>Monthly Spend Velocity</strong></div>' +
                    '<div class="card-body">' +
                        '<div id="svTrendChart" style="height: 300px;"></div>' +
                    '</div>' +
                '</div>' +
            '</div>';
            
            // Seasonal Pattern Analysis
            html += '<div class="col-lg-4">' +
                '<div class="card mb-3">' +
                    '<div class="card-header py-2"><strong><i class="fas fa-calendar-alt text-info mr-2"></i>Seasonal Patterns</strong></div>' +
                    '<div class="card-body">';
            
            if (seasonalPatterns.insights.length > 0) {
                seasonalPatterns.insights.forEach(function(insight) {
                    var icon = insight.type === 'high_season' ? 'arrow-up text-danger' : 'arrow-down text-success';
                    html += '<div class="mb-2">' +
                        '<i class="fas fa-' + icon + ' mr-2"></i>' +
                        '<span class="small">' + escapeHtml(insight.message) + '</span>' +
                    '</div>';
                });
            } else {
                html += '<div class="text-muted small">No significant seasonal patterns detected</div>';
            }
            
            // Monthly pattern bars
            html += '<div class="mt-3"><small class="text-muted d-block mb-2">Monthly Deviation from Average</small>';
            seasonalPatterns.patterns.forEach(function(p) {
                var barWidth = Math.min(Math.abs(p.deviation), 50);
                var barColor = p.deviation > 0 ? '#ef4444' : '#10b981';
                var barAlign = p.deviation > 0 ? 'left: 50%;' : 'right: 50%;';
                
                html += '<div class="d-flex align-items-center mb-1">' +
                    '<span class="small" style="width: 30px;">' + p.monthName + '</span>' +
                    '<div class="flex-grow-1 position-relative" style="height: 12px; background: #f1f5f9;">' +
                        '<div style="position: absolute; ' + barAlign + ' width: ' + barWidth + '%; height: 100%; background: ' + barColor + ';"></div>' +
                    '</div>' +
                    '<span class="small ml-2" style="width: 40px; text-align: right;">' + (p.deviation > 0 ? '+' : '') + p.deviation + '%</span>' +
                '</div>';
            });
            html += '</div>';
            
            html += '</div></div></div>';
            
            // Monthly Data Table - with Prior Year comparison
            html += '<div class="col-12">' +
                '<div class="card">' +
                    '<div class="card-header py-2"><strong><i class="fas fa-table text-secondary mr-2"></i>Monthly Summary</strong></div>' +
                    '<div class="card-body p-0">' +
                        '<div class="table-responsive">' +
                            '<table class="table table-hover sv-velocity-table mb-0">' +
                                '<thead class="thead-light"><tr>' +
                                    '<th>Month</th>' +
                                    '<th class="text-right">Total Spend</th>' +
                                    '<th class="text-right">Prior Year</th>' +
                                    '<th class="text-right">YoY Change</th>' +
                                    '<th class="text-right">Velocity</th>' +
                                    '<th class="text-right">Vendors</th>' +
                                    '<th class="text-right">Txns</th>' +
                                '</tr></thead>' +
                                '<tbody>';
            
            monthlyTrends.forEach(function(m) {
                var velocityClass = m.velocity > 10 ? 'text-danger' : m.velocity < -10 ? 'text-success' : 'text-muted';
                var yoyChange = m.yoyChange || 0;
                var changeClass = yoyChange > 10 ? 'text-danger' : yoyChange < -10 ? 'text-success' : '';
                var priorAmount = m.priorYearAmount || 0;
                
                html += '<tr>' +
                    '<td><strong>' + m.month + '</strong></td>' +
                    '<td class="text-right font-weight-bold">' + self.formatCurrency(m.totalAmount) + '</td>' +
                    '<td class="text-right text-muted">' + (priorAmount > 0 ? self.formatCurrency(priorAmount) : '—') + '</td>' +
                    '<td class="text-right ' + changeClass + '">' + (priorAmount > 0 ? (yoyChange > 0 ? '+' : '') + yoyChange + '%' : '—') + '</td>' +
                    '<td class="text-right ' + velocityClass + '">' + 
                        (m.velocity > 0 ? '+' : '') + m.velocity + '%</td>' +
                    '<td class="text-right">' + m.vendorCount + '</td>' +
                    '<td class="text-right">' + m.transactionCount + '</td>' +
                '</tr>';
            });
            
            html += '</tbody></table></div></div></div></div>';
            
            html += '</div>';
            
            container.innerHTML = html;
            
            this.renderTrendChart();
        },
        
        renderTrendChart: function() {
            var chartEl = el('#svTrendChart');
            if (!chartEl || typeof Plotly === 'undefined' || !this.latestData) return;
            
            var monthlyTrends = this.latestData.results.monthlyTrends || [];
            
            if (monthlyTrends.length < 2) {
                chartEl.innerHTML = '<div class="text-center text-muted py-4">Insufficient data</div>';
                return;
            }
            
            var traces = [
                {
                    x: monthlyTrends.map(m => m.month),
                    y: monthlyTrends.map(m => m.totalAmount),
                    name: 'Total Spend',
                    type: 'scatter',
                    mode: 'lines+markers',
                    fill: 'tozeroy',
                    line: { color: '#6366f1', width: 2 },
                    marker: { size: 6 }
                },
                {
                    x: monthlyTrends.map(m => m.month),
                    y: monthlyTrends.map(m => m.velocity * (monthlyTrends[0].totalAmount / 100)),
                    name: 'Velocity',
                    type: 'bar',
                    yaxis: 'y2',
                    marker: {
                        color: monthlyTrends.map(m => m.velocity > 0 ? 'rgba(239,68,68,0.6)' : 'rgba(16,185,129,0.6)')
                    }
                }
            ];
            
            var layout = {
                margin: { t: 20, r: 60, b: 40, l: 60 },
                height: 300,
                showlegend: true,
                legend: { orientation: 'h', y: -0.15 },
                xaxis: { tickfont: { size: 10 } },
                yaxis: { 
                    title: 'Spend', 
                    tickfont: { size: 10 }, 
                    tickprefix: this.currencySymbol 
                },
                yaxis2: {
                    title: 'Velocity',
                    overlaying: 'y',
                    side: 'right',
                    tickfont: { size: 10 },
                    ticksuffix: '%',
                    showgrid: false
                }
            };
            
            Plotly.newPlot(chartEl, traces, layout, { responsive: true, displayModeBar: false });
        },
        
        renderConfigTab: function() {
            var container = el('#svConfigContent');
            if (!container) return;
            
            var cfg = this.configData || {};
            var self = this;
            
            // Sub-nav tabs matching main tabs styling (cf-tabs)
            var html = '<ul class="nav nav-tabs cf-tabs mb-3" id="configSubNav">' +
                '<li class="nav-item"><a class="nav-link active" data-toggle="tab" href="#cfgCore"><i class="fas fa-sliders-h mr-1"></i>Core Thresholds</a></li>' +
                '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#cfgDetectors"><i class="fas fa-radar mr-1"></i>Detectors</a></li>' +
                '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#cfgDisplay"><i class="fas fa-desktop mr-1"></i>Display</a></li>' +
                '</ul>';
            
            html += '<div class="tab-content">';
            
            // Core Thresholds Section
            html += '<div class="tab-pane fade show active" id="cfgCore">' +
                '<div class="row">' +
                '<div class="col-md-6">' +
                '<div class="card mb-3"><div class="card-header py-2 bg-primary text-white"><i class="fas fa-tachometer-alt mr-2"></i>Velocity Thresholds</div>' +
                '<div class="card-body">' +
                '<div class="form-group mb-3"><label class="font-weight-bold">High Velocity (%)</label>' +
                '<input type="range" class="custom-range" id="cfgVelocityHigh" min="5" max="50" value="' + (cfg.velocityHighThreshold || 15) + '" oninput="document.getElementById(\'cfgVelHighVal\').textContent=this.value">' +
                '<div class="d-flex justify-content-between small text-muted"><span>5%</span><span id="cfgVelHighVal">' + (cfg.velocityHighThreshold || 15) + '</span><span>50%</span></div></div>' +
                '<div class="form-group mb-3"><label class="font-weight-bold">Medium Velocity (%)</label>' +
                '<input type="range" class="custom-range" id="cfgVelocityMedium" min="1" max="20" value="' + (cfg.velocityMediumThreshold || 5) + '" oninput="document.getElementById(\'cfgVelMedVal\').textContent=this.value">' +
                '<div class="d-flex justify-content-between small text-muted"><span>1%</span><span id="cfgVelMedVal">' + (cfg.velocityMediumThreshold || 5) + '</span><span>20%</span></div></div>' +
                '<div class="form-group mb-0"><label class="font-weight-bold">Acceleration Threshold (%)</label>' +
                '<input type="number" class="form-control" id="cfgAccelThreshold" value="' + (cfg.accelerationThreshold || 5) + '" min="1" max="20">' +
                '<small class="text-muted">Change in velocity considered significant</small></div>' +
                '</div></div></div>' +
                '<div class="col-md-6">' +
                '<div class="card mb-3"><div class="card-header py-2 bg-danger text-white"><i class="fas fa-bolt mr-2"></i>Anomaly Detection</div>' +
                '<div class="card-body">' +
                '<div class="form-group mb-3"><label class="font-weight-bold">Warning Threshold (σ)</label>' +
                '<input type="number" class="form-control" id="cfgAnomalyStdDev" value="' + (cfg.anomalyStdDevThreshold || 2.5) + '" min="1.5" max="4" step="0.5"></div>' +
                '<div class="form-group mb-3"><label class="font-weight-bold">Critical Threshold (σ)</label>' +
                '<input type="number" class="form-control" id="cfgAnomalyCritical" value="' + (cfg.anomalyCriticalThreshold || 3.5) + '" min="2" max="5" step="0.5"></div>' +
                '<div class="form-group mb-0"><label class="font-weight-bold">Min Data Points</label>' +
                '<input type="number" class="form-control" id="cfgAnomalyMinPoints" value="' + (cfg.anomalyMinDataPoints || 6) + '" min="3" max="12">' +
                '<small class="text-muted">Minimum months of data for detection</small></div>' +
                '</div></div></div></div></div>';
            
            // Detectors Section
            html += '<div class="tab-pane fade" id="cfgDetectors">' +
                '<div class="row">' +
                // Boiling Frog
                '<div class="col-md-4 mb-3"><div class="card h-100">' +
                '<div class="card-header py-2" style="background:#7c3aed;color:white;"><i class="fas fa-frog mr-2"></i>Boiling Frog</div>' +
                '<div class="card-body">' +
                '<div class="form-group mb-2"><label class="small font-weight-bold">Min Monthly Increase (%)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgFrogMinIncrease" value="' + (cfg.boilingFrogMinIncrease || 3) + '" min="1" max="10"></div>' +
                '<div class="form-group mb-2"><label class="small font-weight-bold">Max Monthly Increase (%)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgFrogMaxIncrease" value="' + (cfg.boilingFrogMaxIncrease || 10) + '" min="5" max="25"></div>' +
                '<div class="form-group mb-0"><label class="small font-weight-bold">Min Consecutive Months</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgFrogMinMonths" value="' + (cfg.boilingFrogMinMonths || 6) + '" min="3" max="12"></div>' +
                '</div></div></div>' +
                // Shadow IT
                '<div class="col-md-4 mb-3"><div class="card h-100">' +
                '<div class="card-header py-2" style="background:#ec4899;color:white;"><i class="fas fa-virus mr-2"></i>Shadow IT</div>' +
                '<div class="card-body">' +
                '<div class="form-group mb-2"><label class="small font-weight-bold">Min Employees</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgShadowMinEmps" value="' + (cfg.shadowITMinEmployees || 3) + '" min="2" max="10"></div>' +
                '<div class="form-group mb-2"><label class="small font-weight-bold">Growth Threshold (%)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgShadowGrowth" value="' + (cfg.shadowITGrowthThreshold || 50) + '" min="20" max="200"></div>' +
                '<div class="form-group mb-0"><label class="small font-weight-bold">Min Spend ($)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgShadowMinSpend" value="' + (cfg.shadowITMinSpend || 500) + '" min="100" max="5000"></div>' +
                '</div></div></div>' +
                // Zombie Subscriptions
                '<div class="col-md-4 mb-3"><div class="card h-100">' +
                '<div class="card-header py-2 bg-secondary text-white"><i class="fas fa-ghost mr-2"></i>Zombie Subscriptions</div>' +
                '<div class="card-body">' +
                '<div class="form-group mb-2"><label class="small font-weight-bold">Min Flat Months</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgZombieMinMonths" value="' + (cfg.zombieMinMonths || 6) + '" min="3" max="12"></div>' +
                '<div class="form-group mb-2"><label class="small font-weight-bold">Variance Tolerance (%)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgZombieVariance" value="' + (cfg.zombieVarianceTolerance || 5) + '" min="1" max="15"></div>' +
                '<div class="form-group mb-0"><label class="small font-weight-bold">Min Monthly ($)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgZombieMinAmount" value="' + (cfg.zombieMinAmount || 100) + '" min="50" max="1000"></div>' +
                '</div></div></div>' +
                // Concentration Risk
                '<div class="col-md-4 mb-3"><div class="card h-100">' +
                '<div class="card-header py-2 bg-warning text-dark"><i class="fas fa-chart-pie mr-2"></i>Concentration Risk</div>' +
                '<div class="card-body">' +
                '<div class="form-group mb-2"><label class="small font-weight-bold">Warning Threshold (%)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgConcWarning" value="' + (cfg.concentrationWarning || 25) + '" min="10" max="40"></div>' +
                '<div class="form-group mb-0"><label class="small font-weight-bold">Critical Threshold (%)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgConcCritical" value="' + (cfg.concentrationCritical || 40) + '" min="20" max="60"></div>' +
                '</div></div></div>' +
                // Commitment Cliff
                '<div class="col-md-4 mb-3"><div class="card h-100">' +
                '<div class="card-header py-2 bg-info text-white"><i class="fas fa-mountain mr-2"></i>Commitment Cliff</div>' +
                '<div class="card-body">' +
                '<div class="form-group mb-2"><label class="small font-weight-bold">Warning Gap (%)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgCliffWarning" value="' + (cfg.commitmentCliffWarning || 10) + '" min="5" max="30"></div>' +
                '<div class="form-group mb-0"><label class="small font-weight-bold">Critical Gap (%)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgCliffCritical" value="' + (cfg.commitmentCliffCritical || 25) + '" min="15" max="50"></div>' +
                '</div></div></div>' +
                // Fragmentation + Seasonal
                '<div class="col-md-4 mb-3"><div class="card h-100">' +
                '<div class="card-header py-2" style="background:#f97316;color:white;"><i class="fas fa-puzzle-piece mr-2"></i>Fragmentation</div>' +
                '<div class="card-body">' +
                '<div class="form-group mb-2"><label class="small font-weight-bold">Min Transactions</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgFragMinTxns" value="' + (cfg.fragmentationMinTxns || 20) + '" min="5" max="50"></div>' +
                '<div class="form-group mb-2"><label class="small font-weight-bold">Max Avg Txn ($)</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgFragMaxAvg" value="' + (cfg.fragmentationMaxAvgSize || 500) + '" min="100" max="2000"></div>' +
                '<div class="form-group mb-0"><label class="small font-weight-bold">Min Vendors</label>' +
                '<input type="number" class="form-control form-control-sm" id="cfgFragMinVendors" value="' + (cfg.fragmentationMinVendors || 5) + '" min="3" max="20"></div>' +
                '</div></div></div>' +
                '</div></div>';
            
            // Display Section
            html += '<div class="tab-pane fade" id="cfgDisplay">' +
                '<div class="row">' +
                '<div class="col-md-6">' +
                '<div class="card mb-3"><div class="card-header py-2 bg-dark text-white"><i class="fas fa-table mr-2"></i>Table Settings</div>' +
                '<div class="card-body">' +
                '<div class="form-group mb-3"><label class="font-weight-bold">Rows per Page</label>' +
                '<select class="form-control" id="cfgRowsPerPage">' +
                '<option value="10"' + (cfg.rowsPerPage == 10 ? ' selected' : '') + '>10 rows</option>' +
                '<option value="15"' + ((cfg.rowsPerPage || 15) == 15 ? ' selected' : '') + '>15 rows</option>' +
                '<option value="20"' + (cfg.rowsPerPage == 20 ? ' selected' : '') + '>20 rows</option>' +
                '<option value="25"' + (cfg.rowsPerPage == 25 ? ' selected' : '') + '>25 rows</option>' +
                '<option value="50"' + (cfg.rowsPerPage == 50 ? ' selected' : '') + '>50 rows</option>' +
                '</select></div>' +
                '<div class="form-group mb-3"><label class="font-weight-bold">Top Accounts to Show</label>' +
                '<input type="number" class="form-control" id="cfgTopAccounts" value="' + (cfg.topAccountsCount || 50) + '" min="10" max="100"></div>' +
                '<div class="form-group mb-0"><label class="font-weight-bold">Top Vendors to Show</label>' +
                '<input type="number" class="form-control" id="cfgTopVendors" value="' + (cfg.topVendorsCount || 30) + '" min="10" max="100"></div>' +
                '</div></div></div>' +
                '<div class="col-md-6">' +
                '<div class="card mb-3"><div class="card-header py-2" style="background:#14b8a6;color:white;"><i class="fas fa-snowflake mr-2"></i>Seasonal Detection</div>' +
                '<div class="card-body">' +
                '<div class="form-group mb-3"><label class="font-weight-bold">Seasonality Threshold (%)</label>' +
                '<input type="number" class="form-control" id="cfgSeasonalThreshold" value="' + (cfg.seasonalThreshold || 30) + '" min="10" max="60"></div>' +
                '<div class="form-group mb-0"><label class="font-weight-bold">Min Months for Pattern</label>' +
                '<input type="number" class="form-control" id="cfgSeasonalMinMonths" value="' + (cfg.seasonalMinMonths || 12) + '" min="6" max="24">' +
                '<small class="text-muted">Months of data to detect patterns</small></div>' +
                '</div></div></div>' +
                '</div></div>';
            
            html += '</div>'; // tab-content
            
            // Action Buttons
            html += '<div class="d-flex justify-content-between align-items-center mt-4 pt-3 border-top">' +
                '<button class="btn btn-outline-secondary" onclick="SpendVelocityController.resetConfig()"><i class="fas fa-undo mr-2"></i>Reset to Defaults</button>' +
                '<button class="btn btn-primary shadow-sm px-4" onclick="SpendVelocityController.saveConfig()"><i class="fas fa-save mr-2"></i>Save Configuration</button>' +
            '</div>';
            
            container.innerHTML = html;
        },
        
        resetConfig: function() {
            if (confirm('Reset all configuration to default values?')) {
                this.configData = {};
                this.renderConfigTab();
                showToast('Configuration reset to defaults');
            }
        },
        
        saveConfig: async function() {
            var configToSave = {
                // Velocity
                velocityHighThreshold: parseInt(el('#cfgVelocityHigh').value) || 15,
                velocityMediumThreshold: parseInt(el('#cfgVelocityMedium').value) || 5,
                accelerationThreshold: parseInt(el('#cfgAccelThreshold').value) || 5,
                // Boiling Frog
                boilingFrogMinIncrease: parseInt(el('#cfgFrogMinIncrease').value) || 3,
                boilingFrogMinMonths: parseInt(el('#cfgFrogMinMonths').value) || 6,
                boilingFrogMaxIncrease: parseInt(el('#cfgFrogMaxIncrease').value) || 10,
                // Shadow IT
                shadowITMinEmployees: parseInt(el('#cfgShadowMinEmps').value) || 3,
                shadowITGrowthThreshold: parseInt(el('#cfgShadowGrowth').value) || 50,
                shadowITMinSpend: parseInt(el('#cfgShadowMinSpend').value) || 500,
                // Anomaly
                anomalyStdDevThreshold: parseFloat(el('#cfgAnomalyStdDev').value) || 2.5,
                anomalyCriticalThreshold: parseFloat(el('#cfgAnomalyCritical').value) || 3.5,
                anomalyMinDataPoints: parseInt(el('#cfgAnomalyMinPoints').value) || 6,
                // Zombie
                zombieMinMonths: parseInt(el('#cfgZombieMinMonths').value) || 6,
                zombieVarianceTolerance: parseInt(el('#cfgZombieVariance').value) || 5,
                zombieMinAmount: parseInt(el('#cfgZombieMinAmount').value) || 100,
                // Fragmentation
                fragmentationMinTxns: parseInt(el('#cfgFragMinTxns').value) || 20,
                fragmentationMaxAvgSize: parseInt(el('#cfgFragMaxAvg').value) || 500,
                fragmentationMinVendors: parseInt(el('#cfgFragMinVendors').value) || 5,
                // Concentration
                concentrationWarning: parseInt(el('#cfgConcWarning').value) || 25,
                concentrationCritical: parseInt(el('#cfgConcCritical').value) || 40,
                // Commitment Cliff
                commitmentCliffWarning: parseInt(el('#cfgCliffWarning').value) || 10,
                commitmentCliffCritical: parseInt(el('#cfgCliffCritical').value) || 25,
                // Seasonal
                seasonalThreshold: parseInt(el('#cfgSeasonalThreshold').value) || 30,
                seasonalMinMonths: parseInt(el('#cfgSeasonalMinMonths').value) || 12,
                // Display
                topAccountsCount: parseInt(el('#cfgTopAccounts').value) || 50,
                topVendorsCount: parseInt(el('#cfgTopVendors').value) || 30,
                rowsPerPage: parseInt(el('#cfgRowsPerPage').value) || 15
            };
            
            try {
                var res = await API.post('save_spend_velocity_config', configToSave);
                if (res.status === 'success') {
                    showToast('Configuration saved!');
                    this.configData = configToSave;
                    this.loadData();
                } else {
                    showToast('Error: ' + res.message, 'error');
                }
            } catch(e) {
                console.error(e);
                showToast('Error saving configuration', 'error');
            }
        },
        
        // ==========================================
        // PAGINATION & SORTING HELPERS
        // ==========================================
        sortData: function(data, sortCol, sortDir) {
            if (!data || !sortCol) return data;
            return data.slice().sort(function(a, b) {
                var aVal = a[sortCol], bVal = b[sortCol];
                if (aVal == null) return 1;
                if (bVal == null) return -1;
                if (typeof aVal === 'string') aVal = aVal.toLowerCase();
                if (typeof bVal === 'string') bVal = bVal.toLowerCase();
                var cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                return sortDir === 'desc' ? -cmp : cmp;
            });
        },
        
        paginate: function(data, pag) {
            var start = (pag.page - 1) * pag.pageSize;
            return data.slice(start, start + pag.pageSize);
        },
        
        renderSortHeader: function(label, col, pagKey, extraClass) {
            var pag = this.pagination[pagKey];
            var isActive = pag.sortCol === col;
            var icon = isActive ? (pag.sortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
            var activeClass = isActive ? 'sv-sort-active' : '';
            return '<th class="sv-sortable ' + activeClass + ' ' + (extraClass || '') + '" onclick="SpendVelocityController.toggleSort(\'' + col + '\', \'' + pagKey + '\')">' + 
                label + ' <i class="fas ' + icon + ' ml-1 sv-sort-icon"></i></th>';
        },
        
        // Helper for inline sortable headers (velocity tab)
        sortIcon: function(tableType, col) {
            var sortState = tableType === 'accounts' ? this.velocityAccountsSort : this.velocityVendorsSort;
            if (!sortState) return '<i class="fas fa-sort ml-1 sv-sort-icon"></i>';
            var isActive = sortState.col === col;
            var icon = isActive ? (sortState.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
            return '<i class="fas ' + icon + ' ml-1 sv-sort-icon"></i>';
        },
        
        toggleSort: function(col, pagKey) {
            var pag = this.pagination[pagKey];
            if (pag.sortCol === col) {
                pag.sortDir = pag.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                pag.sortCol = col;
                pag.sortDir = 'desc';
            }
            pag.page = 1;
            this.rerenderTable(pagKey);
        },
        
        changePage: function(pagKey, newPage) {
            this.pagination[pagKey].page = newPage;
            this.rerenderTable(pagKey);
        },
        
        rerenderTable: function(pagKey) {
            switch (pagKey) {
                case 'velocity': this.renderVelocityTab(); break;
                case 'vendors': this.renderVelocityTab(); break;
                case 'periods': case 'accounts': this.renderAccountsTable(); break;
                case 'expenses': this.renderExpenseSpendersTable(); break;
                case 'categories': this.renderExpenseCategoriesTable(); break;
            }
        },
        
        renderPagination: function(totalItems, pagKey) {
            var pag = this.pagination[pagKey];
            var totalPages = Math.ceil(totalItems / pag.pageSize);
            if (totalPages <= 1) return '<div class="sv-pagination-info">Showing all ' + totalItems + ' items</div>';
            
            var html = '<div class="sv-pagination d-flex justify-content-between align-items-center py-2 px-3 border-top">';
            html += '<span class="text-muted small">Showing ' + ((pag.page - 1) * pag.pageSize + 1) + '-' + Math.min(pag.page * pag.pageSize, totalItems) + ' of ' + totalItems + '</span>';
            html += '<div class="btn-group btn-group-sm">';
            html += '<button class="btn btn-outline-secondary" ' + (pag.page <= 1 ? 'disabled' : '') + ' onclick="SpendVelocityController.changePage(\'' + pagKey + '\', ' + (pag.page - 1) + ')"><i class="fas fa-chevron-left"></i></button>';
            
            var startPage = Math.max(1, pag.page - 2);
            var endPage = Math.min(totalPages, startPage + 4);
            for (var i = startPage; i <= endPage; i++) {
                html += '<button class="btn btn-outline-secondary ' + (i === pag.page ? 'active' : '') + '" onclick="SpendVelocityController.changePage(\'' + pagKey + '\', ' + i + ')">' + i + '</button>';
            }
            
            html += '<button class="btn btn-outline-secondary" ' + (pag.page >= totalPages ? 'disabled' : '') + ' onclick="SpendVelocityController.changePage(\'' + pagKey + '\', ' + (pag.page + 1) + ')"><i class="fas fa-chevron-right"></i></button>';
            html += '</div></div>';
            return html;
        },
        
        // ==========================================
        // PERIODS TAB - Period-over-Period Analysis
        // ==========================================
        // ==========================================
        // ACCOUNTS TAB - Combined Period & Deep Analysis
        // ==========================================
        renderAccountsTab: function() {
            var container = el('#svAccountsContent');
            if (!container || !this.latestData) return;
            
            var data = this.latestData.results;
            var periods = data.periodComparison || {};
            var summary = periods.summary || {};
            var accounts = data.allAccounts || data.accountVelocity || [];
            var self = this;
            
            // Period summary cards using cf-kpi-card shared infrastructure
            var changePct = summary.changePct || 0;
            var html = '<div class="cf-kpi-row row mb-3 flex-nowrap" style="overflow:hidden;">';
            html += '<div class="col px-1"><div class="cf-kpi-card" style="min-width:0;">' +
                '<div class="icon-wrapper bg-primary-soft"><i class="fas fa-calendar-check text-primary"></i></div>' +
                '<div class="kpi-content" style="min-width:0;overflow:hidden;"><span class="kpi-label">Current Period</span>' +
                '<span class="kpi-value text-primary" style="font-size:clamp(0.75rem,2vw,1.1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this.formatCurrency(summary.currentTotal || 0) + '</span></div></div></div>';
            html += '<div class="col px-1"><div class="cf-kpi-card" style="min-width:0;">' +
                '<div class="icon-wrapper bg-secondary-soft"><i class="fas fa-history text-secondary"></i></div>' +
                '<div class="kpi-content" style="min-width:0;overflow:hidden;"><span class="kpi-label">Prior Period</span>' +
                '<span class="kpi-value" style="font-size:clamp(0.75rem,2vw,1.1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this.formatCurrency(summary.priorTotal || 0) + '</span>' +
                '<span class="kpi-sub ' + (changePct > 0 ? 'text-danger' : 'text-success') + '" style="font-size:0.7rem;">' + 
                (changePct > 0 ? '↑' : '↓') + ' ' + Math.abs(changePct).toFixed(1) + '%</span></div></div></div>';
            html += '<div class="col px-1"><div class="cf-kpi-card" style="min-width:0;">' +
                '<div class="icon-wrapper bg-muted-soft"><i class="fas fa-backward text-muted"></i></div>' +
                '<div class="kpi-content" style="min-width:0;overflow:hidden;"><span class="kpi-label">2 Periods Back</span>' +
                '<span class="kpi-value text-muted" style="font-size:clamp(0.75rem,2vw,1.1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this.formatCurrency(summary.twoBackTotal || 0) + '</span></div></div></div>';
            html += '<div class="col px-1"><div class="cf-kpi-card" style="min-width:0;">' +
                '<div class="icon-wrapper bg-info-soft"><i class="fas fa-crystal-ball text-info"></i></div>' +
                '<div class="kpi-content" style="min-width:0;overflow:hidden;"><span class="kpi-label">Projected Next</span>' +
                '<span class="kpi-value text-info" style="font-size:clamp(0.75rem,2vw,1.1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this.formatCurrency(summary.projectedTotal || 0) + '</span>' +
                '<span class="kpi-sub text-muted" style="font-size:0.7rem;">Based on trend</span></div></div></div>';
            html += '</div>';
            
            // Velocity/Acceleration explanation
            html += '<div class="alert alert-light py-2 mb-2 small">' +
                '<i class="fas fa-info-circle text-primary mr-2"></i>' +
                '<strong>Velocity</strong> = Monthly spend change rate. ' +
                '<strong>Acceleration</strong> = Change in velocity (speeding up/slowing down). ' +
                '<span class="text-danger">Red = increasing spend</span>, <span class="text-success">Green = decreasing</span>.' +
                '</div>';
            
            // Filters and controls - consistent toolbar row
            html += '<div class="sv-toolbar d-flex flex-wrap align-items-center mb-2" style="gap:8px;">' +
                '<div class="input-group input-group-sm" style="width:180px;">' +
                '<div class="input-group-prepend"><span class="input-group-text"><i class="fas fa-search"></i></span></div>' +
                '<input type="text" class="form-control" id="svAccountSearch" placeholder="Search accounts..." oninput="SpendVelocityController.searchAccounts(this.value)">' +
                '</div>' +
                '<div class="sv-filter-pills">' +
                '<button class="sv-pill active" data-filter="all" onclick="SpendVelocityController.filterAccounts(\'all\', this)">All</button>' +
                '<button class="sv-pill sv-pill-danger" data-filter="increases" onclick="SpendVelocityController.filterAccounts(\'increases\', this)"><i class="fas fa-arrow-up"></i> Increases</button>' +
                '<button class="sv-pill sv-pill-success" data-filter="decreases" onclick="SpendVelocityController.filterAccounts(\'decreases\', this)"><i class="fas fa-arrow-down"></i> Decreases</button>' +
                '<button class="sv-pill sv-pill-warning" data-filter="highvel" onclick="SpendVelocityController.filterAccounts(\'highvel\', this)"><i class="fas fa-fire"></i> High Vel</button>' +
                '<button class="sv-pill sv-pill-info" data-filter="new" onclick="SpendVelocityController.filterAccounts(\'new\', this)"><i class="fas fa-plus"></i> New</button>' +
                '</div>' +
                '<select class="form-control form-control-sm" id="svAcctSortBy" style="width:150px;" onchange="SpendVelocityController.sortAccounts()">' +
                '<option value="totalSpend">Sort: Spend</option>' +
                '<option value="velocity">Sort: Velocity</option>' +
                '<option value="changePct">Sort: Change %</option>' +
                '<option value="acceleration">Sort: Accel</option>' +
                '</select>' +
                '<div class="ml-auto d-flex align-items-center" style="gap:8px;">' +
                '<button class="btn btn-sm btn-outline-success" onclick="SpendVelocityController.exportAccounts()"><i class="fas fa-download"></i> CSV</button>' +
                '<span class="badge badge-secondary" id="svAccountsCount">' + accounts.length + ' accounts</span>' +
                '</div></div>';
            
            html += '<div class="card shadow-sm"><div class="card-body p-0"><div id="svAccountsTableContainer"></div></div></div>';
            container.innerHTML = html;
            this.accountsFilter = 'all';
            this.renderAccountsTable();
        },
        
        filterAccounts: function(filter, btn) {
            this.accountsFilter = filter;
            this.pagination.accounts = this.pagination.accounts || { page: 1, pageSize: 20, sortCol: 'totalSpend', sortDir: 'desc' };
            this.pagination.accounts.page = 1;
            document.querySelectorAll('#svAccountsContent .sv-filter-pills .sv-pill').forEach(function(b) { b.classList.remove('active'); });
            if (btn) btn.classList.add('active');
            this.renderAccountsTable();
        },
        
        searchAccounts: function(query) {
            this.accountsSearch = (query || '').toLowerCase().trim();
            this.pagination.accounts = this.pagination.accounts || { page: 1, pageSize: 20, sortCol: 'totalSpend', sortDir: 'desc' };
            this.pagination.accounts.page = 1;
            this.renderAccountsTable();
        },
        
        sortAccounts: function() {
            this.pagination.accounts = this.pagination.accounts || { page: 1, pageSize: 20, sortCol: 'totalSpend', sortDir: 'desc' };
            this.pagination.accounts.sortCol = el('#svAcctSortBy').value;
            this.pagination.accounts.page = 1;
            this.renderAccountsTable();
        },
        
        renderAccountsTable: function() {
            var container = el('#svAccountsTableContainer');
            if (!container || !this.latestData) return;
            
            var data = this.latestData.results;
            var periodAccts = (data.periodComparison && data.periodComparison.accounts) || [];
            var velAccts = data.allAccounts || data.accountVelocity || [];
            var self = this;
            
            // Merge period and velocity data
            var periodMap = {};
            periodAccts.forEach(function(p) { periodMap[p.accountId] = p; });
            
            var accounts = velAccts.map(function(a) {
                var p = periodMap[a.accountId] || {};
                return {
                    accountId: a.accountId,
                    accountName: a.accountName || p.accountName || 'Account ' + a.accountId,
                    accountNumber: a.accountNumber || '',
                    totalSpend: a.totalSpend || 0,
                    transactionCount: a.transactionCount || 0,
                    velocity: a.velocity || 0,
                    acceleration: a.acceleration || 0,
                    trend: a.trend || 'stable',
                    currentPeriod: p.currentAmount || a.currentPeriod || 0,
                    priorPeriod: p.priorAmount || a.priorPeriod || 0,
                    twoBackPeriod: p.twoBackAmount || a.twoBackPeriod || 0,
                    changePct: p.changePct || 0,
                    projectedAmount: p.projectedAmount || 0,
                    isNew: p.isNew || false,
                    monthlyTrend: a.monthlyTrend || p.monthlyTrend || []
                };
            });
            
            // Apply search filter
            var searchQuery = this.accountsSearch || '';
            if (searchQuery) {
                accounts = accounts.filter(function(a) {
                    return (a.accountName || '').toLowerCase().indexOf(searchQuery) !== -1 ||
                           (a.accountNumber || '').toLowerCase().indexOf(searchQuery) !== -1;
                });
            }
            
            // Apply type filter
            var filtered = accounts;
            switch (this.accountsFilter) {
                case 'increases': filtered = accounts.filter(function(a) { return a.changePct > 5; }); break;
                case 'decreases': filtered = accounts.filter(function(a) { return a.changePct < -5; }); break;
                case 'highvel': filtered = accounts.filter(function(a) { return Math.abs(a.velocity) > 10; }); break;
                case 'new': filtered = accounts.filter(function(a) { return a.isNew; }); break;
            }
            
            el('#svAccountsCount').textContent = filtered.length + ' accounts';
            
            // Initialize pagination if not exists
            this.pagination.accounts = this.pagination.accounts || { page: 1, pageSize: 20, sortCol: 'totalSpend', sortDir: 'desc' };
            var pag = this.pagination.accounts;
            
            var sorted = this.sortData(filtered, pag.sortCol, pag.sortDir);
            var paged = this.paginate(sorted, pag);
            
            var html = '<div class="table-responsive"><table class="table table-hover table-sm mb-0"><thead class="thead-light"><tr>' +
                '<th>#</th>' +
                '<th onclick="SpendVelocityController.toggleAccountSort(\'accountName\')" class="sv-sortable">Account <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                '<th onclick="SpendVelocityController.toggleAccountSort(\'totalSpend\')" class="sv-sortable text-right">Total <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                '<th onclick="SpendVelocityController.toggleAccountSort(\'velocity\')" class="sv-sortable text-right">Velocity <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                '<th class="text-center">Accel</th>' +
                '<th onclick="SpendVelocityController.toggleAccountSort(\'currentPeriod\')" class="sv-sortable text-right">Current <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                '<th onclick="SpendVelocityController.toggleAccountSort(\'priorPeriod\')" class="sv-sortable text-right">Prior <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                '<th onclick="SpendVelocityController.toggleAccountSort(\'changePct\')" class="sv-sortable text-right">Δ% <i class="fas fa-sort ml-1 sv-sort-icon"></i></th>' +
                '<th class="text-right">Projected</th>' +
                '<th>Trend</th></tr></thead><tbody>';
            
            paged.forEach(function(a, idx) {
                var rowNum = (pag.page - 1) * pag.pageSize + idx + 1;
                var velClass = a.velocity > 15 ? 'sv-vel-hot' : a.velocity > 5 ? 'sv-vel-warm' : a.velocity < -5 ? 'sv-vel-cold' : 'sv-vel-cool';
                var changeClass = a.changePct > 10 ? 'text-danger' : a.changePct < -10 ? 'text-success' : '';
                var accelHeat = self.renderAcceleration(a.acceleration);
                var trendIcon = self.getTrendIcon(a.trend);
                var sparkHtml = (a.monthlyTrend && a.monthlyTrend.length > 1) ? Sparkline.generate(a.monthlyTrend, { width: 60, height: 20 }) : '<span class="text-muted">—</span>';
                
                html += '<tr class="sv-clickable" onclick="SpendVelocityController.drilldownAccount(' + a.accountId + ', \'' + escapeHtml(a.accountName).replace(/'/g, "\\'") + '\')">' +
                    '<td class="text-muted small">' + rowNum + '</td>' +
                    '<td><strong>' + escapeHtml(a.accountName) + '</strong>' + (a.isNew ? ' <span class="badge badge-info badge-sm">NEW</span>' : '') + '</td>' +
                    '<td class="text-right">' + self.formatCurrency(a.totalSpend) + '</td>' +
                    '<td class="text-right"><span class="sv-velocity-pill ' + velClass + '">' + (a.velocity >= 0 ? '+' : '') + (a.velocity || 0).toFixed(1) + '%</span></td>' +
                    '<td class="text-center">' + accelHeat + '</td>' +
                    '<td class="text-right">' + self.formatCurrency(a.currentPeriod) + '</td>' +
                    '<td class="text-right text-muted">' + self.formatCurrency(a.priorPeriod) + '</td>' +
                    '<td class="text-right ' + changeClass + '">' + (a.changePct > 0 ? '+' : '') + (a.changePct || 0).toFixed(1) + '%</td>' +
                    '<td class="text-right text-info">' + self.formatCurrency(a.projectedAmount) + '</td>' +
                    '<td>' + sparkHtml + '</td>' +
                    '</tr>';
            });
            
            html += '</tbody></table></div>';
            html += this.renderPagination(filtered.length, 'accounts');
            container.innerHTML = html;
        },
        
        toggleAccountSort: function(col) {
            this.pagination.accounts = this.pagination.accounts || { page: 1, pageSize: 20, sortCol: 'totalSpend', sortDir: 'desc' };
            var pag = this.pagination.accounts;
            if (pag.sortCol === col) {
                pag.sortDir = pag.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                pag.sortCol = col;
                pag.sortDir = 'desc';
            }
            pag.page = 1;
            this.renderAccountsTable();
        },
        
        exportAccounts: function() {
            var data = this.latestData.results;
            var accounts = data.allAccounts || data.accountVelocity || [];
            var csv = 'Account Name,Total Spend,Velocity %,Acceleration,Current,Prior,2 Back,Change %,Projected,Trend\n';
            accounts.forEach(function(a) {
                csv += '"' + (a.accountName || '').replace(/"/g, '""') + '",' +
                    (a.totalSpend || 0) + ',' + (a.velocity || 0) + ',' + (a.acceleration || 0) + ',' +
                    (a.currentPeriod || 0) + ',' + (a.priorPeriod || 0) + ',' + (a.twoBackPeriod || 0) + ',' +
                    (a.changePct || 0) + ',' + (a.projectedAmount || 0) + ',"' + (a.trend || '') + '"\n';
            });
            var blob = new Blob([csv], { type: 'text/csv' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = 'spend_velocity_accounts_' + new Date().toISOString().slice(0, 10) + '.csv';
            a.click(); URL.revokeObjectURL(url);
        },
        
        // Keep old function names for backward compatibility
        renderPeriodsTab: function() { this.renderAccountsTab(); },
        filterPeriods: function(filter) { this.filterAccounts(filter); },
        renderPeriodsTable: function() { this.renderAccountsTable(); },
        
        // ==========================================
        // TRANSACTIONS TAB
        // ==========================================
        renderTransactionsTab: function() {
            var container = el('#svTransactionsContent');
            if (!container || !this.latestData) return;
            
            var txns = this.latestData.results.transactions || [];
            var accounts = this.latestData.results.accountVelocity || [];
            var self = this;
            
            // Note about transaction limits
            var html = '<div class="alert alert-info py-2 mb-3 small">' +
                '<i class="fas fa-info-circle mr-1"></i>' +
                '<strong>Showing recent transactions.</strong> For complete transaction history, select an account and click "Load All" or click on any account row in the Accounts tab.' +
                '</div>';
            
            html += '<div class="d-flex flex-wrap align-items-center gap-2 mb-3">' +
                '<select class="form-control form-control-sm" id="svTxnTypeFilter" style="width:140px;" onchange="SpendVelocityController.filterTransactions()">' +
                '<option value="">All Types</option><option value="VendBill">Vendor Bills</option><option value="ExpRept">Expense Reports</option><option value="Check">Checks</option></select>' +
                '<select class="form-control form-control-sm" id="svTxnAccountFilter" style="width:200px;" onchange="SpendVelocityController.filterTransactions()">' +
                '<option value="">All Accounts</option>';
            accounts.forEach(function(a) { html += '<option value="' + a.accountId + '">' + escapeHtml(a.accountName) + '</option>'; });
            html += '</select>' +
                '<input type="number" class="form-control form-control-sm" id="svTxnMinAmount" placeholder="Min Amount" style="width:120px;" onchange="SpendVelocityController.filterTransactions()">' +
                '<button class="btn btn-sm btn-primary" id="svTxnLoadAll" style="display:none;" onclick="SpendVelocityController.loadAllAccountTransactions()"><i class="fas fa-sync mr-1"></i>Load All</button>' +
                '<button class="btn btn-sm btn-outline-success" onclick="SpendVelocityController.exportTransactions()"><i class="fas fa-download mr-1"></i>Export</button>' +
                '<span class="badge badge-primary ml-auto" id="svTxnCount">' + txns.length + ' transactions</span>' +
                '</div>';
            
            html += '<div class="card shadow-sm"><div class="card-body p-0"><div id="svTransactionsTableContainer"></div></div></div>';
            container.innerHTML = html;
            this.txnFullLoaded = false;
            this.renderTransactionsTable();
        },
        
        filterTransactions: function() {
            this.pagination.transactions.page = 1;
            // Show/hide Load All button based on account selection
            var accountFilter = el('#svTxnAccountFilter') ? el('#svTxnAccountFilter').value : '';
            var loadAllBtn = el('#svTxnLoadAll');
            if (loadAllBtn) {
                loadAllBtn.style.display = accountFilter && !this.txnFullLoaded ? 'inline-block' : 'none';
            }
            this.renderTransactionsTable();
        },
        
        loadAllAccountTransactions: async function() {
            var accountFilter = el('#svTxnAccountFilter').value;
            if (!accountFilter) return;
            
            var accountName = el('#svTxnAccountFilter').options[el('#svTxnAccountFilter').selectedIndex].text;
            var loadBtn = el('#svTxnLoadAll');
            if (loadBtn) {
                loadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Loading...';
                loadBtn.disabled = true;
            }
            
            try {
                var params = {
                    action: 'spend_velocity',
                    subAction: 'account_transactions',
                    accountId: accountFilter,
                    startDate: el('#svStartDate').value,
                    endDate: el('#svEndDate').value,
                    subsidiaryId: el('#svSubsidiary').value || ''
                };
                var res = await API.post('spend_velocity', params);
                if (res.status === 'success' && res.transactions) {
                    // Replace transactions for this account
                    this.txnFullData = this.txnFullData || {};
                    this.txnFullData[accountFilter] = res.transactions;
                    this.txnFullLoaded = true;
                    if (loadBtn) loadBtn.style.display = 'none';
                    this.renderTransactionsTable();
                    showToast('Loaded ' + res.transactions.length + ' transactions for ' + accountName, 'success');
                }
            } catch (e) {
                showToast('Failed to load transactions', 'error');
            }
            
            if (loadBtn) {
                loadBtn.innerHTML = '<i class="fas fa-sync mr-1"></i>Load All';
                loadBtn.disabled = false;
            }
        },
        
        exportTransactions: function() {
            var txns = this.getFilteredTransactions();
            if (txns.length === 0) {
                showToast('No transactions to export', 'error');
                return;
            }
            
            var csv = 'Date,Type,Document,Entity,Account,Amount,Memo\n';
            txns.forEach(function(t) {
                csv += '"' + (t.date || '') + '",' +
                    '"' + (t.type || '') + '",' +
                    '"' + (t.tranId || '') + '",' +
                    '"' + (t.entityName || '').replace(/"/g, '""') + '",' +
                    '"' + (t.accountName || '').replace(/"/g, '""') + '",' +
                    (t.amount || 0) + ',' +
                    '"' + (t.memo || '').replace(/"/g, '""') + '"\n';
            });
            
            var blob = new Blob([csv], { type: 'text/csv' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'transactions_' + new Date().toISOString().slice(0, 10) + '.csv';
            a.click();
            URL.revokeObjectURL(url);
        },
        
        getFilteredTransactions: function() {
            var accountFilter = el('#svTxnAccountFilter') ? el('#svTxnAccountFilter').value : '';
            var typeFilter = el('#svTxnTypeFilter') ? el('#svTxnTypeFilter').value : '';
            var minAmount = el('#svTxnMinAmount') ? parseFloat(el('#svTxnMinAmount').value) || 0 : 0;
            
            // Use full data for account if loaded, otherwise use preloaded
            var txns;
            if (accountFilter && this.txnFullData && this.txnFullData[accountFilter]) {
                txns = this.txnFullData[accountFilter];
            } else {
                txns = this.latestData.results.transactions || [];
            }
            
            return txns.filter(function(t) {
                if (typeFilter && t.type !== typeFilter) return false;
                if (accountFilter && t.accountId != accountFilter) return false;
                if (minAmount && Math.abs(t.amount) < minAmount) return false;
                return true;
            });
        },
        
        renderTransactionsTable: function() {
            var container = el('#svTransactionsTableContainer');
            if (!container || !this.latestData) return;
            
            var self = this;
            
            // Use the helper that handles full data for filtered accounts
            var filtered = this.getFilteredTransactions();
            
            el('#svTxnCount').textContent = filtered.length + ' transactions';
            
            var sorted = this.sortData(filtered, this.pagination.transactions.sortCol, this.pagination.transactions.sortDir);
            var paged = this.paginate(sorted, this.pagination.transactions);
            
            var html = '<table class="table table-hover table-sm mb-0"><thead class="thead-light"><tr>' +
                this.renderSortHeader('Date', 'date', 'transactions') +
                '<th>Type</th>' +
                this.renderSortHeader('Document', 'tranId', 'transactions') +
                this.renderSortHeader('Entity', 'entityName', 'transactions') +
                '<th>Account</th>' +
                this.renderSortHeader('Amount', 'amount', 'transactions', 'text-right') +
                '<th></th></tr></thead><tbody>';
            
            if (paged.length === 0) {
                html += '<tr><td colspan="7" class="text-center text-muted py-4">No transactions found</td></tr>';
            } else {
                paged.forEach(function(t) {
                    var typeClass = t.type === 'VendBill' ? 'badge-primary' : t.type === 'ExpRept' ? 'badge-info' : 'badge-secondary';
                    var typeLabel = t.type === 'VendBill' ? 'Bill' : t.type === 'ExpRept' ? 'Expense' : t.type;
                    html += '<tr>' +
                        '<td>' + (t.date || '--') + '</td>' +
                        '<td><span class="badge ' + typeClass + '">' + typeLabel + '</span></td>' +
                        '<td><a href="#" onclick="SpendVelocityController.openRecord(\'' + t.type + '\', ' + t.id + '); return false;">' + escapeHtml(t.tranId || '#' + t.id) + '</a></td>' +
                        '<td>' + escapeHtml(t.entityName || '--') + '</td>' +
                        '<td class="text-truncate" style="max-width:150px;">' + escapeHtml(t.accountName || '--') + '</td>' +
                        '<td class="text-right font-weight-bold">' + self.formatCurrency(t.amount) + '</td>' +
                        '<td><button class="btn btn-xs btn-outline-primary" onclick="SpendVelocityController.openRecord(\'' + t.type + '\', ' + t.id + ')"><i class="fas fa-external-link-alt"></i></button></td>' +
                        '</tr>';
                });
            }
            
            html += '</tbody></table>';
            html += this.renderPagination(filtered.length, 'transactions');
            container.innerHTML = html;
        },
        
        openRecord: function(type, id) {
            // Use generic transaction.nl URL - works for all transaction types
            window.open('/app/accounting/transactions/transaction.nl?id=' + id, '_blank');
        },
        
        // ==========================================
        // EXPENSES TAB - Advanced Expense Analysis
        // ==========================================
        renderExpensesTab: function() {
            var container = el('#svExpensesContent');
            if (!container || !this.latestData) return;
            
            var expenses = this.latestData.results.expenseAnalysis || {};
            var summary = expenses.summary || {};
            var self = this;
            
            // KPI cards using cf-kpi-card shared infrastructure
            var html = '<div class="cf-kpi-row row mb-3 flex-nowrap" style="overflow:hidden;">';
            html += '<div class="col px-1"><div class="cf-kpi-card" style="min-width:0;">' +
                '<div class="icon-wrapper bg-info-soft"><i class="fas fa-file-invoice text-info"></i></div>' +
                '<div class="kpi-content" style="min-width:0;overflow:hidden;"><span class="kpi-label">Expense Reports</span>' +
                '<span class="kpi-value text-info" style="font-size:clamp(0.75rem,2vw,1.1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this.formatCurrency(summary.expenseReportTotal || 0) + '</span></div></div></div>';
            html += '<div class="col px-1"><div class="cf-kpi-card" style="min-width:0;">' +
                '<div class="icon-wrapper bg-primary-soft"><i class="fas fa-file-alt text-primary"></i></div>' +
                '<div class="kpi-content" style="min-width:0;overflow:hidden;"><span class="kpi-label">Vendor Bills</span>' +
                '<span class="kpi-value text-primary" style="font-size:clamp(0.75rem,2vw,1.1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this.formatCurrency(summary.vendorBillTotal || 0) + '</span></div></div></div>';
            html += '<div class="col px-1"><div class="cf-kpi-card" style="min-width:0;">' +
                '<div class="icon-wrapper bg-warning-soft"><i class="fas fa-user-clock text-warning"></i></div>' +
                '<div class="kpi-content" style="min-width:0;overflow:hidden;"><span class="kpi-label">High Spenders</span>' +
                '<span class="kpi-value text-warning" style="font-size:clamp(0.75rem,2vw,1.1rem);">' + (summary.topSpenderCount || 0) + '</span>' +
                '<span class="kpi-sub" style="font-size:0.7rem;">>20% increase</span></div></div></div>';
            html += '<div class="col px-1"><div class="cf-kpi-card" style="min-width:0;">' +
                '<div class="icon-wrapper bg-danger-soft"><i class="fas fa-arrow-trend-up text-danger"></i></div>' +
                '<div class="kpi-content" style="min-width:0;overflow:hidden;"><span class="kpi-label">Category Increases</span>' +
                '<span class="kpi-value text-danger" style="font-size:clamp(0.75rem,2vw,1.1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this.formatCurrency(summary.categoryIncreaseTotal || 0) + '</span></div></div></div>';
            html += '</div>';
            
            // Charts row - categories pie + monthly trend bar
            html += '<div class="row mb-3">' +
                '<div class="col-lg-5">' +
                '<div class="card shadow-sm h-100"><div class="card-header py-2 bg-white"><strong><i class="fas fa-chart-pie text-info mr-2"></i>Expense Categories Breakdown</strong></div>' +
                '<div class="card-body p-2"><div id="svExpenseCategoriesChart" style="height:280px;"></div></div></div></div>' +
                '<div class="col-lg-7">' +
                '<div class="card shadow-sm h-100"><div class="card-header py-2 bg-white"><strong><i class="fas fa-chart-bar text-success mr-2"></i>Monthly Expense Trends</strong></div>' +
                '<div class="card-body p-2"><div id="svExpenseTrendChart" style="height:280px;"></div></div></div></div>' +
                '</div>';
            
            // Tables row - equal height
            html += '<div class="row">' +
                '<div class="col-lg-6">' +
                '<div class="card shadow-sm mb-3"><div class="card-header py-2 bg-white"><strong><i class="fas fa-user-tie text-primary mr-2"></i>Top Spenders</strong></div>' +
                '<div class="card-body p-0"><div id="svExpenseSpendersTable" class="table-responsive" style="max-height:350px;overflow-y:auto;"></div></div></div>' +
                '</div>' +
                '<div class="col-lg-6">' +
                '<div class="card shadow-sm mb-3"><div class="card-header py-2 bg-white"><strong><i class="fas fa-tags text-info mr-2"></i>Expense Categories</strong></div>' +
                '<div class="card-body p-0"><div id="svExpenseCategoriesTable" class="table-responsive" style="max-height:350px;overflow-y:auto;"></div></div></div>' +
                '</div>' +
                '</div>';
            
            container.innerHTML = html;
            this.renderExpenseSpendersTable();
            this.renderExpenseCategoriesTable();
            this.renderExpenseCategoriesChart();
            this.renderExpenseTrendChart();
        },
        
        renderExpenseCategoriesChart: function() {
            var chartEl = el('#svExpenseCategoriesChart');
            if (!chartEl || typeof Plotly === 'undefined') return;
            
            var expenses = this.latestData.results.expenseAnalysis || {};
            var categories = expenses.categories || [];
            
            if (categories.length < 2) {
                chartEl.innerHTML = '<div class="text-center text-muted py-5">Insufficient category data</div>';
                return;
            }
            
            // Top 8 categories for pie chart
            var top = categories.slice(0, 8);
            var trace = {
                type: 'pie',
                labels: top.map(function(c) { return c.categoryName; }),
                values: top.map(function(c) { return c.currentAmount; }),
                hole: 0.45,
                textinfo: 'percent',
                textposition: 'outside',
                marker: { colors: ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#ef4444', '#f97316'] }
            };
            Plotly.newPlot(chartEl, [trace], { 
                margin: { t: 20, r: 20, b: 20, l: 20 }, 
                showlegend: true,
                legend: { orientation: 'h', y: -0.1, font: { size: 10 } },
                height: 280 
            }, { responsive: true, displayModeBar: false });
        },
        
        renderExpenseSpendersTable: function() {
            var container = el('#svExpenseSpendersTable');
            if (!container || !this.latestData) return;
            
            var expenses = this.latestData.results.expenseAnalysis || {};
            var spenders = expenses.topSpenders || [];
            var self = this;
            
            var sorted = this.sortData(spenders, this.pagination.expenses.sortCol, this.pagination.expenses.sortDir);
            var paged = this.paginate(sorted, this.pagination.expenses);
            
            var html = '<table class="table table-hover table-sm mb-0"><thead class="thead-light sticky-top"><tr>' +
                '<th>#</th>' +
                this.renderSortHeader('Employee', 'employeeName', 'expenses') +
                this.renderSortHeader('Total', 'totalSpend', 'expenses', 'text-right') +
                this.renderSortHeader('Reports', 'reportCount', 'expenses', 'text-right') +
                this.renderSortHeader('Change %', 'changePct', 'expenses', 'text-right') +
                '</tr></thead><tbody>';
            
            paged.forEach(function(s, idx) {
                var rank = (self.pagination.expenses.page - 1) * self.pagination.expenses.pageSize + idx + 1;
                var changeClass = s.changePct > 20 ? 'text-danger' : s.changePct < -10 ? 'text-success' : '';
                html += '<tr class="sv-clickable" onclick="SpendVelocityController.drilldownEmployee(' + s.employeeId + ', \'' + escapeHtml(s.employeeName).replace(/'/g, "\\'") + '\')">' +
                    '<td><span class="badge badge-' + (rank <= 3 ? 'danger' : 'secondary') + '">#' + rank + '</span></td>' +
                    '<td><strong>' + escapeHtml(s.employeeName) + '</strong></td>' +
                    '<td class="text-right font-weight-bold">' + self.formatCurrency(s.totalSpend) + '</td>' +
                    '<td class="text-right">' + (s.reportCount || 0) + '</td>' +
                    '<td class="text-right ' + changeClass + '">' + (s.changePct > 0 ? '+' : '') + (s.changePct || 0).toFixed(1) + '%</td>' +
                    '</tr>';
            });
            
            html += '</tbody></table>';
            html += this.renderPagination(spenders.length, 'expenses');
            container.innerHTML = html;
        },
        
        renderExpenseCategoriesTable: function() {
            var container = el('#svExpenseCategoriesTable');
            if (!container || !this.latestData) return;
            
            var expenses = this.latestData.results.expenseAnalysis || {};
            var categories = expenses.categories || [];
            var self = this;
            
            var sorted = this.sortData(categories, this.pagination.categories.sortCol, this.pagination.categories.sortDir);
            var paged = this.paginate(sorted, this.pagination.categories);
            
            var html = '<table class="table table-hover table-sm mb-0"><thead class="thead-light sticky-top"><tr>' +
                this.renderSortHeader('Category', 'categoryName', 'categories') +
                this.renderSortHeader('Current', 'currentAmount', 'categories', 'text-right') +
                this.renderSortHeader('Prior', 'priorAmount', 'categories', 'text-right') +
                this.renderSortHeader('Change %', 'changePct', 'categories', 'text-right') +
                '</tr></thead><tbody>';
            
            if (paged.length === 0) {
                html += '<tr><td colspan="4" class="text-center text-muted py-3">No expense categories found</td></tr>';
            } else {
                paged.forEach(function(c) {
                    var changeClass = c.changePct > 20 ? 'text-danger font-weight-bold' : c.changePct < -10 ? 'text-success' : '';
                    var arrow = c.changePct > 0 ? '↑' : c.changePct < 0 ? '↓' : '';
                    // Use isExpenseAccount flag to determine which drilldown to use
                    var drilldownFunc = c.isExpenseAccount ? 'drilldownAccount' : 'drilldownCategory';
                    html += '<tr class="sv-clickable" onclick="SpendVelocityController.' + drilldownFunc + '(' + (c.categoryId || c.accountId) + ', \'' + escapeHtml(c.categoryName).replace(/'/g, "\\'") + '\')">' +
                        '<td><strong>' + escapeHtml(c.categoryName) + '</strong></td>' +
                        '<td class="text-right">' + self.formatCurrency(c.currentAmount) + '</td>' +
                        '<td class="text-right text-muted">' + self.formatCurrency(c.priorAmount) + '</td>' +
                        '<td class="text-right ' + changeClass + '">' + arrow + ' ' + Math.abs(c.changePct || 0).toFixed(1) + '%</td>' +
                        '</tr>';
                });
            }
            
            html += '</tbody></table>';
            html += this.renderPagination(categories.length, 'categories');
            container.innerHTML = html;
        },
        
        renderExpenseTrendChart: function() {
            var chartEl = el('#svExpenseTrendChart');
            if (!chartEl || typeof Plotly === 'undefined' || !this.latestData) return;
            
            var expenses = this.latestData.results.expenseAnalysis || {};
            var trends = expenses.monthlyTrends || [];
            if (trends.length < 2) { chartEl.innerHTML = '<div class="text-center text-muted py-5">Insufficient data</div>'; return; }
            
            var traces = [
                { x: trends.map(function(t) { return t.month; }), y: trends.map(function(t) { return t.expenseAmount || 0; }), name: 'Expense Reports', type: 'bar', marker: { color: '#17a2b8' } },
                { x: trends.map(function(t) { return t.month; }), y: trends.map(function(t) { return t.billAmount || 0; }), name: 'Vendor Bills', type: 'bar', marker: { color: '#6366f1' } }
            ];
            Plotly.newPlot(chartEl, traces, { margin: { t: 20, r: 20, b: 50, l: 60 }, barmode: 'group', showlegend: true, legend: { orientation: 'h', y: -0.15 } }, { responsive: true, displayModeBar: false });
        },
        
        // ==========================================
        // DEEP ANALYSIS TAB - All Accounts World-Class
        // ==========================================
        // Deep tab functions redirect to Accounts (for backwards compatibility)
        renderDeepTab: function() { this.renderAccountsTab(); },
        updateDeepSort: function() { this.sortAccounts(); },
        filterDeep: function() { this.filterAccounts('all'); },
        renderDeepTable: function() { this.renderAccountsTable(); },
        exportDeep: function() { this.exportAccounts(); },
        
        getTrendIcon: function(trend) {
            switch (trend) {
                case 'accelerating': return 'rocket text-danger';
                case 'high': return 'fire text-danger';
                case 'rising': return 'arrow-up text-warning';
                case 'stable': return 'minus text-muted';
                case 'declining': return 'arrow-down text-success';
                default: return 'question text-muted';
            }
        },
        
        renderAccelPill: function(value) {
            var v = value || 0;
            var absV = Math.abs(v);
            var color, bgColor, icon;
            
            if (absV < 2) {
                // Stable
                return '<span class="badge badge-light text-muted" title="Acceleration: stable"><i class="fas fa-minus fa-xs"></i></span>';
            } else if (v > 0) {
                // Accelerating (spend increasing faster)
                color = absV > 10 ? '#dc3545' : '#fd7e14';
                bgColor = absV > 10 ? 'rgba(220,53,69,0.15)' : 'rgba(253,126,20,0.15)';
                icon = 'fa-chevron-double-up';
                return '<span class="badge" style="background:' + bgColor + ';color:' + color + '" title="Accelerating: spend increasing faster">+' + v.toFixed(0) + '</span>';
            } else {
                // Decelerating (spend slowing down)
                color = absV > 10 ? '#28a745' : '#20c997';
                bgColor = absV > 10 ? 'rgba(40,167,69,0.15)' : 'rgba(32,201,151,0.15)';
                return '<span class="badge" style="background:' + bgColor + ';color:' + color + '" title="Decelerating: spend slowing">' + v.toFixed(0) + '</span>';
            }
        },
        
        // Keep old name for compatibility
        renderAcceleration: function(value) {
            return this.renderAccelPill(value);
        },
        
        // ==========================================
        // DRILL-DOWN PANEL
        // ==========================================
        drilldownAccount: async function(accountId, accountName) {
            var self = this;
            this.drilldown = { active: true, type: 'account', id: accountId, name: accountName };
            
            var panel = el('#svDrilldownPanel');
            var title = el('#svDrilldownTitle');
            var body = el('#svDrilldownBody');
            
            title.innerHTML = '<i class="fas fa-search-dollar mr-2"></i>' + escapeHtml(accountName) + ' — Transaction Details';
            body.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading transactions...</div></div>';
            panel.style.display = 'flex';
            
            try {
                // Fetch transactions via main spend_velocity action with sub-action
                var params = {
                    action: 'spend_velocity',
                    subAction: 'account_transactions',
                    accountId: accountId,
                    startDate: el('#svStartDate').value,
                    endDate: el('#svEndDate').value,
                    subsidiaryId: el('#svSubsidiary').value || ''
                };
                var res = await API.post('spend_velocity', params);
                if (res.status === 'success' && res.transactions) {
                    this.renderDrilldownContent(res.transactions, accountName);
                } else {
                    body.innerHTML = '<div class="text-center py-5 text-muted"><i class="fas fa-inbox fa-2x mb-2"></i><div>No transactions found for this account</div></div>';
                }
            } catch (e) {
                console.error('Drilldown error:', e);
                body.innerHTML = '<div class="alert alert-warning"><i class="fas fa-exclamation-triangle mr-2"></i>Unable to load transactions. Please try again.</div>';
            }
        },
        
        // Drill down by expense category
        drilldownCategory: async function(categoryId, categoryName) {
            var self = this;
            this.drilldown = { active: true, type: 'category', id: categoryId, name: categoryName };
            
            var panel = el('#svDrilldownPanel');
            var title = el('#svDrilldownTitle');
            var body = el('#svDrilldownBody');
            
            title.innerHTML = '<i class="fas fa-tag mr-2"></i>' + escapeHtml(categoryName) + ' — Expense Category';
            body.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading category transactions...</div></div>';
            panel.style.display = 'flex';
            
            try {
                var params = {
                    action: 'spend_velocity',
                    subAction: 'category_transactions',
                    categoryId: categoryId,
                    startDate: el('#svStartDate').value,
                    endDate: el('#svEndDate').value,
                    subsidiaryId: el('#svSubsidiary').value || ''
                };
                var res = await API.post('spend_velocity', params);
                if (res.status === 'success' && res.transactions) {
                    this.renderDrilldownContent(res.transactions, categoryName);
                } else {
                    body.innerHTML = '<div class="text-center py-5 text-muted"><i class="fas fa-inbox fa-2x mb-2"></i><div>No transactions found for this category</div></div>';
                }
            } catch (e) {
                console.error('Category drilldown error:', e);
                body.innerHTML = '<div class="alert alert-warning"><i class="fas fa-exclamation-triangle mr-2"></i>Unable to load category transactions. Please try again.</div>';
            }
        },
        
        // Drill down by employee (for expense reports)
        drilldownEmployee: async function(employeeId, employeeName) {
            var self = this;
            this.drilldown = { active: true, type: 'employee', id: employeeId, name: employeeName };
            
            var panel = el('#svDrilldownPanel');
            var title = el('#svDrilldownTitle');
            var body = el('#svDrilldownBody');
            
            title.innerHTML = '<i class="fas fa-user mr-2"></i>' + escapeHtml(employeeName) + ' — Expense Reports';
            body.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading expense reports...</div></div>';
            panel.style.display = 'flex';
            
            try {
                var params = {
                    action: 'spend_velocity',
                    subAction: 'employee_expenses',
                    employeeId: employeeId,
                    startDate: el('#svStartDate').value,
                    endDate: el('#svEndDate').value,
                    subsidiaryId: el('#svSubsidiary').value || ''
                };
                var res = await API.post('spend_velocity', params);
                if (res.status === 'success' && res.transactions) {
                    this.renderDrilldownContent(res.transactions, employeeName);
                } else {
                    body.innerHTML = '<div class="text-center py-5 text-muted"><i class="fas fa-inbox fa-2x mb-2"></i><div>No expense reports found</div></div>';
                }
            } catch (e) {
                body.innerHTML = '<div class="alert alert-warning"><i class="fas fa-exclamation-triangle mr-2"></i>Unable to load expense reports</div>';
            }
        },
        
        renderDrilldownContent: function(txns, entityName) {
            var body = el('#svDrilldownBody');
            var self = this;
            
            var total = 0;
            txns.forEach(function(t) { total += t.amount || 0; });
            
            // Initialize drilldown state
            this.drilldownPagination = { page: 1, perPage: 50, sortCol: 'date', sortDir: 'desc' };
            this.drilldownData = txns;
            this.drilldownSearch = '';
            this.drilldownGroupBy = 'none';
            
            // Build monthly totals for sparkline
            var monthlyTotals = {};
            txns.forEach(function(t) {
                var month = t.month || (t.date || '').substring(0, 7);
                if (month) {
                    monthlyTotals[month] = (monthlyTotals[month] || 0) + (t.amount || 0);
                }
            });
            var sortedMonths = Object.keys(monthlyTotals).sort();
            var sparkData = sortedMonths.map(function(m) { return monthlyTotals[m]; });
            
            // Generate sparkline (full width area chart)
            var sparklineHtml = '';
            if (typeof Sparkline !== 'undefined' && sparkData.length >= 2) {
                var svgContent = Sparkline.generateArea(sparkData, { 
                    width: 800, 
                    height: 50, 
                    stroke: '#6366f1', 
                    fill: 'rgba(99, 102, 241, 0.15)',
                    strokeWidth: 2
                });
                // Make SVG responsive by adding viewBox and removing fixed dimensions
                svgContent = svgContent
                    .replace(/<svg width="(\d+)" height="(\d+)"/, '<svg viewBox="0 0 $1 $2" preserveAspectRatio="none"');
                
                sparklineHtml = '<div class="sv-drilldown-sparkline mb-3" style="flex-shrink:0;">' +
                    '<div class="d-flex justify-content-between align-items-center mb-1">' +
                    '<span class="small text-muted"><i class="fas fa-chart-area mr-1"></i>Activity Over Period</span>' +
                    '<span class="small text-muted">' + sortedMonths[0] + ' → ' + sortedMonths[sortedMonths.length - 1] + '</span>' +
                    '</div>' +
                    '<div class="sv-sparkline-container">' + svgContent + '</div></div>';
            }
            
            // KPI cards using cf-kpi-card shared infrastructure
            var html = '<div class="cf-kpi-row row mb-3" style="flex-shrink:0;">';
            html += '<div class="col-4"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-primary-soft"><i class="fas fa-receipt text-primary"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Transactions</span>' +
                '<span class="kpi-value text-primary" id="svDrilldownTxnCount">' + txns.length + '</span></div></div></div>';
            html += '<div class="col-4"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-success-soft"><i class="fas fa-dollar-sign text-success"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Total Amount</span>' +
                '<span class="kpi-value text-success">' + this.formatCurrency(total) + '</span></div></div></div>';
            html += '<div class="col-4"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-info-soft"><i class="fas fa-calculator text-info"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Avg per Txn</span>' +
                '<span class="kpi-value text-info">' + this.formatCurrency(txns.length > 0 ? total / txns.length : 0) + '</span></div></div></div>';
            html += '</div>';
            
            // Add sparkline after KPIs
            html += sparklineHtml;
            
            // Toolbar with search, group by, export
            html += '<div class="sv-toolbar d-flex flex-wrap align-items-center mb-2" style="flex-shrink:0;gap:8px;">' +
                '<div class="input-group input-group-sm" style="width:200px;">' +
                '<div class="input-group-prepend"><span class="input-group-text"><i class="fas fa-search"></i></span></div>' +
                '<input type="text" class="form-control" id="svDrilldownSearch" placeholder="Search..." oninput="SpendVelocityController.searchDrilldown(this.value)">' +
                '</div>' +
                '<select class="form-control form-control-sm" style="width:160px;" id="svDrilldownGroupBy" onchange="SpendVelocityController.groupDrilldown(this.value)">' +
                '<option value="none">No grouping</option>' +
                '<option value="type">Group: Type</option>' +
                '<option value="month">Group: Month</option>' +
                '<option value="entity">Group: Entity</option>' +
                '<option value="memo">Group: Smart Memo</option>' +
                '</select>' +
                '<div class="ml-auto d-flex align-items-center" style="gap:8px;">';
            if (txns.length >= 2000) {
                html += '<span class="badge badge-warning"><i class="fas fa-info-circle mr-1"></i>Max 2000</span>';
            }
            html += '<button class="btn btn-sm btn-outline-success" onclick="SpendVelocityController.exportDrilldown()"><i class="fas fa-download"></i> CSV</button>' +
                '</div></div>';
            
            // Table container (will be filled by renderDrilldownTable)
            html += '<div class="table-responsive" id="svDrilldownTableContainer"></div>';
            
            // Pagination
            html += '<div id="svDrilldownPagination" class="mt-2" style="flex-shrink:0;"></div>';
            
            body.innerHTML = html;
            this.renderDrilldownTable();
        },
        
        searchDrilldown: function(query) {
            this.drilldownSearch = (query || '').toLowerCase().trim();
            this.drilldownPagination.page = 1;
            this.renderDrilldownTable();
        },
        
        groupDrilldown: function(groupBy) {
            this.drilldownGroupBy = groupBy;
            this.drilldownPagination.page = 1;
            this.renderDrilldownTable();
        },
        
        getFilteredDrilldownData: function() {
            var txns = this.drilldownData || [];
            var search = this.drilldownSearch;
            
            if (search) {
                txns = txns.filter(function(t) {
                    return (t.entityName || '').toLowerCase().indexOf(search) >= 0 ||
                           (t.tranId || '').toLowerCase().indexOf(search) >= 0 ||
                           (t.accountName || '').toLowerCase().indexOf(search) >= 0 ||
                           (t.memo || '').toLowerCase().indexOf(search) >= 0;
                });
            }
            
            // Update count display
            var countEl = el('#svDrilldownTxnCount');
            if (countEl) countEl.textContent = txns.length;
            
            return txns;
        },
        
        renderDrilldownTable: function() {
            var container = el('#svDrilldownTableContainer');
            var paginationContainer = el('#svDrilldownPagination');
            if (!container || !this.drilldownData) return;
            
            var self = this;
            var txns = this.getFilteredDrilldownData();
            var pag = this.drilldownPagination;
            var groupBy = this.drilldownGroupBy;
            
            // Handle grouping
            if (groupBy && groupBy !== 'none') {
                this.renderGroupedDrilldownTable(txns, groupBy);
                return;
            }
            
            // Sort
            var sorted = txns.slice().sort(function(a, b) {
                var aVal = a[pag.sortCol], bVal = b[pag.sortCol];
                if (pag.sortCol === 'amount') {
                    aVal = parseFloat(aVal) || 0;
                    bVal = parseFloat(bVal) || 0;
                }
                if (aVal < bVal) return pag.sortDir === 'asc' ? -1 : 1;
                if (aVal > bVal) return pag.sortDir === 'asc' ? 1 : -1;
                return 0;
            });
            
            // Paginate
            var start = (pag.page - 1) * pag.perPage;
            var paged = sorted.slice(start, start + pag.perPage);
            var totalPages = Math.ceil(sorted.length / pag.perPage);
            
            var dateIcon = pag.sortCol === 'date' ? 'fa-sort-' + (pag.sortDir === 'asc' ? 'up' : 'down') : 'fa-sort';
            var amtIcon = pag.sortCol === 'amount' ? 'fa-sort-' + (pag.sortDir === 'asc' ? 'up' : 'down') : 'fa-sort';
            var entityIcon = pag.sortCol === 'entityName' ? 'fa-sort-' + (pag.sortDir === 'asc' ? 'up' : 'down') : 'fa-sort';
            
            var html = '<table class="table table-sm table-hover mb-0"><thead class="thead-light sticky-top"><tr>' +
                '<th class="sv-sortable" onclick="SpendVelocityController.sortDrilldownCol(\'date\')">Date <i class="fas ' + dateIcon + ' ml-1 sv-sort-icon"></i></th>' +
                '<th>Type</th><th>Document</th>' +
                '<th class="sv-sortable" onclick="SpendVelocityController.sortDrilldownCol(\'entityName\')">Entity <i class="fas ' + entityIcon + ' ml-1 sv-sort-icon"></i></th>' +
                '<th class="sv-sortable text-right" onclick="SpendVelocityController.sortDrilldownCol(\'amount\')">Amount <i class="fas ' + amtIcon + ' ml-1 sv-sort-icon"></i></th>' +
                '<th>Memo</th></tr></thead><tbody>';
            
            if (paged.length === 0) {
                html += '<tr><td colspan="6" class="text-center text-muted py-4">No transactions found</td></tr>';
            } else {
                paged.forEach(function(t) {
                    var typeClass = t.type === 'VendBill' ? 'badge-primary' : t.type === 'ExpRept' ? 'badge-info' : 'badge-secondary';
                    var memoText = (t.memo || '').length > 40 ? t.memo.substring(0, 40) + '...' : (t.memo || '--');
                    html += '<tr><td>' + (t.date || '--') + '</td>' +
                        '<td><span class="badge ' + typeClass + '">' + (t.type === 'VendBill' ? 'Bill' : t.type === 'ExpRept' ? 'Exp' : t.type) + '</span></td>' +
                        '<td><a href="#" onclick="SpendVelocityController.openRecord(\'' + t.type + '\', ' + t.id + '); return false;">' + escapeHtml(t.tranId || '#' + t.id) + '</a></td>' +
                        '<td>' + escapeHtml(t.entityName || '--') + '</td>' +
                        '<td class="text-right font-weight-bold">' + self.formatCurrency(t.amount) + '</td>' +
                        '<td class="small text-muted" title="' + escapeHtml(t.memo || '') + '">' + escapeHtml(memoText) + '</td></tr>';
                });
            }
            html += '</tbody></table>';
            container.innerHTML = html;
            
            // Pagination controls
            if (totalPages > 1) {
                var pagHtml = '<nav><ul class="pagination pagination-sm justify-content-center mb-0">';
                pagHtml += '<li class="page-item ' + (pag.page <= 1 ? 'disabled' : '') + '">' +
                    '<a class="page-link" href="#" onclick="SpendVelocityController.drilldownPage(' + (pag.page - 1) + '); return false;">&laquo;</a></li>';
                
                var startPage = Math.max(1, pag.page - 2);
                var endPage = Math.min(totalPages, startPage + 4);
                for (var p = startPage; p <= endPage; p++) {
                    pagHtml += '<li class="page-item ' + (p === pag.page ? 'active' : '') + '">' +
                        '<a class="page-link" href="#" onclick="SpendVelocityController.drilldownPage(' + p + '); return false;">' + p + '</a></li>';
                }
                
                pagHtml += '<li class="page-item ' + (pag.page >= totalPages ? 'disabled' : '') + '">' +
                    '<a class="page-link" href="#" onclick="SpendVelocityController.drilldownPage(' + (pag.page + 1) + '); return false;">&raquo;</a></li>';
                pagHtml += '</ul></nav>';
                pagHtml += '<div class="text-center small text-muted mt-1">Showing ' + (start + 1) + '-' + Math.min(start + pag.perPage, sorted.length) + ' of ' + sorted.length + '</div>';
                paginationContainer.innerHTML = pagHtml;
            } else {
                paginationContainer.innerHTML = '';
            }
        },
        
        sortDrilldownCol: function(col) {
            if (this.drilldownPagination.sortCol === col) {
                this.drilldownPagination.sortDir = this.drilldownPagination.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                this.drilldownPagination.sortCol = col;
                this.drilldownPagination.sortDir = (col === 'amount') ? 'desc' : (col === 'date' ? 'desc' : 'asc');
            }
            this.drilldownPagination.page = 1;
            this.renderDrilldownTable();
        },
        
        drilldownPage: function(page) {
            var filteredCount = this.getFilteredDrilldownData().length;
            var totalPages = Math.ceil(filteredCount / this.drilldownPagination.perPage);
            if (page < 1 || page > totalPages) return;
            this.drilldownPagination.page = page;
            this.renderDrilldownTable();
        },
        
        renderGroupedDrilldownTable: function(txns, groupBy) {
            var container = el('#svDrilldownTableContainer');
            var paginationContainer = el('#svDrilldownPagination');
            var self = this;
            
            // For smart memo grouping, use fuzzy matching
            if (groupBy === 'memo') {
                this.renderSmartMemoGrouping(txns);
                return;
            }
            
            // Group the transactions
            var groups = {};
            txns.forEach(function(t) {
                var key;
                switch (groupBy) {
                    case 'type': key = t.type || 'Unknown'; break;
                    case 'month': key = (t.date || '').substring(0, 7) || 'Unknown'; break;
                    case 'entity': key = t.entityName || 'Unknown'; break;
                    default: key = 'All';
                }
                if (!groups[key]) groups[key] = { txns: [], total: 0 };
                groups[key].txns.push(t);
                groups[key].total += t.amount || 0;
            });
            
            // Sort groups by total
            var sortedKeys = Object.keys(groups).sort(function(a, b) { return groups[b].total - groups[a].total; });
            
            var html = '<table class="table table-sm mb-0"><thead class="thead-light sticky-top"><tr>' +
                '<th>' + (groupBy === 'type' ? 'Type' : groupBy === 'month' ? 'Month' : 'Entity') + '</th>' +
                '<th class="text-right">Transactions</th>' +
                '<th class="text-right">Total Amount</th>' +
                '<th class="text-right">Avg per Txn</th>' +
                '</tr></thead><tbody>';
            
            sortedKeys.forEach(function(key) {
                var g = groups[key];
                html += '<tr>' +
                    '<td><strong>' + escapeHtml(key) + '</strong></td>' +
                    '<td class="text-right">' + g.txns.length + '</td>' +
                    '<td class="text-right font-weight-bold">' + self.formatCurrency(g.total) + '</td>' +
                    '<td class="text-right text-muted">' + self.formatCurrency(g.total / g.txns.length) + '</td>' +
                    '</tr>';
            });
            
            html += '</tbody></table>';
            container.innerHTML = html;
            paginationContainer.innerHTML = '<div class="text-center small text-muted mt-1">' + sortedKeys.length + ' groups, ' + txns.length + ' transactions</div>';
        },
        
        // Smart memo grouping with fuzzy matching
        renderSmartMemoGrouping: function(txns) {
            var container = el('#svDrilldownTableContainer');
            var paginationContainer = el('#svDrilldownPagination');
            var self = this;
            
            // ===== STOPWORDS: Common words + accounting/transaction terms =====
            // These appear everywhere and don't help categorize spending
            var stopwords = {
                // English stopwords
                'the': 1, 'and': 1, 'for': 1, 'with': 1, 'from': 1, 'that': 1, 'this': 1,
                'are': 1, 'was': 1, 'were': 1, 'been': 1, 'being': 1, 'have': 1, 'has': 1,
                'had': 1, 'does': 1, 'did': 1, 'will': 1, 'would': 1, 'could': 1, 'should': 1,
                'may': 1, 'might': 1, 'must': 1, 'shall': 1, 'can': 1, 'need': 1, 'our': 1,
                'you': 1, 'your': 1, 'yours': 1, 'they': 1, 'them': 1, 'their': 1, 'its': 1,
                'his': 1, 'her': 1, 'she': 1, 'him': 1, 'who': 1, 'whom': 1, 'which': 1,
                'what': 1, 'where': 1, 'when': 1, 'why': 1, 'how': 1, 'all': 1, 'each': 1,
                'every': 1, 'both': 1, 'few': 1, 'more': 1, 'most': 1, 'other': 1, 'some': 1,
                'such': 1, 'only': 1, 'own': 1, 'same': 1, 'than': 1, 'too': 1, 'very': 1,
                'just': 1, 'also': 1, 'now': 1, 'here': 1, 'there': 1, 'then': 1, 'once': 1,
                'into': 1, 'over': 1, 'after': 1, 'before': 1, 'between': 1, 'under': 1,
                'again': 1, 'further': 1, 'about': 1, 'above': 1, 'below': 1, 'during': 1,
                'through': 1, 'against': 1, 'but': 1, 'not': 1, 'nor': 1, 'yet': 1,
                
                // Tax identifiers (global)
                'gst': 1, 'hst': 1, 'pst': 1, 'qst': 1, 'vat': 1, 'tax': 1, 'taxes': 1,
                'taxable': 1, 'exempt': 1, 'duty': 1, 'tariff': 1, 'levy': 1,
                
                // Common transaction/accounting terms
                'purchase': 1, 'purchased': 1, 'purchasing': 1, 'payment': 1, 'paid': 1,
                'pay': 1, 'paying': 1, 'invoice': 1, 'invoiced': 1, 'invoicing': 1,
                'bill': 1, 'billed': 1, 'billing': 1, 'charge': 1, 'charged': 1, 'charges': 1,
                'fee': 1, 'fees': 1, 'cost': 1, 'costs': 1, 'costing': 1, 'expense': 1,
                'expenses': 1, 'expensed': 1, 'total': 1, 'subtotal': 1, 'amount': 1,
                'balance': 1, 'credit': 1, 'debit': 1, 'refund': 1, 'refunded': 1,
                'discount': 1, 'discounted': 1, 'rebate': 1, 'deposit': 1, 'prepaid': 1,
                'prepay': 1, 'prepayment': 1, 'accrual': 1, 'accrued': 1, 'accrue': 1,
                'order': 1, 'ordered': 1, 'orders': 1, 'receipt': 1, 'receipts': 1,
                'received': 1, 'receive': 1, 'receiving': 1, 'ship': 1, 'shipped': 1,
                'shipping': 1, 'shipment': 1, 'delivery': 1, 'delivered': 1, 'deliver': 1,
                'vendor': 1, 'vendors': 1, 'supplier': 1, 'suppliers': 1, 'customer': 1,
                'account': 1, 'accounts': 1, 'accounting': 1, 'transaction': 1, 'trans': 1,
                'item': 1, 'items': 1, 'product': 1, 'products': 1, 'service': 1, 'services': 1,
                'monthly': 1, 'annual': 1, 'annually': 1, 'weekly': 1, 'daily': 1, 'quarterly': 1,
                'period': 1, 'date': 1, 'dated': 1, 'due': 1, 'net': 1, 'gross': 1,
                'per': 1, 'each': 1, 'unit': 1, 'units': 1, 'qty': 1, 'quantity': 1,
                'number': 1, 'num': 1, 'ref': 1, 'reference': 1, 'memo': 1, 'note': 1, 'notes': 1,
                'description': 1, 'desc': 1, 'detail': 1, 'details': 1, 'info': 1, 'information': 1,
                'record': 1, 'records': 1, 'entry': 1, 'entries': 1, 'line': 1, 'lines': 1,
                'inc': 1, 'ltd': 1, 'llc': 1, 'corp': 1, 'corporation': 1, 'company': 1,
                'business': 1, 'enterprise': 1, 'group': 1, 'holding': 1, 'holdings': 1,
                'office': 1, 'dept': 1, 'department': 1, 'division': 1, 'branch': 1,
                'new': 1, 'old': 1, 'previous': 1, 'current': 1, 'next': 1, 'last': 1, 'first': 1,
                'one': 1, 'two': 1, 'three': 1, 'four': 1, 'five': 1, 'six': 1, 'seven': 1,
                'eight': 1, 'nine': 1, 'ten': 1, 'year': 1, 'years': 1, 'month': 1, 'months': 1,
                'week': 1, 'weeks': 1, 'day': 1, 'days': 1, 'hour': 1, 'hours': 1,
                
                // Currency codes (extended)
                'usd': 1, 'cad': 1, 'eur': 1, 'gbp': 1, 'aud': 1, 'nzd': 1, 'chf': 1, 'jpy': 1,
                'cny': 1, 'inr': 1, 'mxn': 1, 'brl': 1, 'krw': 1, 'sgd': 1, 'hkd': 1,
                
                // Common filler words in memos
                'please': 1, 'thank': 1, 'thanks': 1, 'regards': 1, 'see': 1, 'attached': 1,
                'attachment': 1, 'copy': 1, 'original': 1, 'final': 1, 'revised': 1, 'updated': 1,
                'approved': 1, 'pending': 1, 'review': 1, 'reviewed': 1, 'submitted': 1, 'submit': 1,
                'processed': 1, 'process': 1, 'processing': 1, 'complete': 1, 'completed': 1,
                'partial': 1, 'full': 1, 'paid': 1, 'unpaid': 1, 'outstanding': 1, 'open': 1,
                'closed': 1, 'cancelled': 1, 'cancel': 1, 'void': 1, 'voided': 1,
                'adjustment': 1, 'adjust': 1, 'adjusted': 1, 'correction': 1, 'corrected': 1,
                'transfer': 1, 'transferred': 1, 'allocation': 1, 'allocated': 1, 'allocate': 1,
                'reimbursement': 1, 'reimburse': 1, 'reimbursed': 1, 'claim': 1, 'claimed': 1,
                'request': 1, 'requested': 1, 'require': 1, 'required': 1, 'requirement': 1
            };
            
            // ===== PHASE 1: TOKENIZE ALL MEMOS =====
            var tokenizeMemo = function(memo) {
                if (!memo) return [];
                var words = memo.toLowerCase()
                    .replace(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g, '') // dates
                    .replace(/\$[\d,]+\.?\d*/g, '') // dollar amounts
                    .replace(/\b(invoice|inv|po|ref|receipt|#|no)\s*[\d\-]+/gi, '') // invoice/po numbers
                    .replace(/[^a-z\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .split(' ')
                    .filter(function(w) { 
                        return w.length >= 3 && !stopwords[w]; 
                    });
                return words;
            };
            
            // ===== PHASE 2: COUNT WORD/BIGRAM FREQUENCY =====
            var wordFreq = {};
            var bigramFreq = {};
            var memoTokens = []; // Store tokens per transaction
            
            txns.forEach(function(t, idx) {
                var tokens = tokenizeMemo(t.memo);
                memoTokens[idx] = tokens;
                
                // Count unique words per memo (not total occurrences)
                var seenWords = {};
                var seenBigrams = {};
                
                tokens.forEach(function(word, i) {
                    if (!seenWords[word]) {
                        wordFreq[word] = (wordFreq[word] || 0) + 1;
                        seenWords[word] = true;
                    }
                    
                    // Bigrams (consecutive pairs)
                    if (i < tokens.length - 1) {
                        var bigram = word + ' ' + tokens[i + 1];
                        if (!seenBigrams[bigram]) {
                            bigramFreq[bigram] = (bigramFreq[bigram] || 0) + 1;
                            seenBigrams[bigram] = true;
                        }
                    }
                });
            });
            
            // ===== PHASE 3: IDENTIFY CATEGORY MARKERS =====
            // Words/bigrams appearing in 3+ memos OR 5%+ of transactions
            var minFreq = Math.max(3, Math.ceil(txns.length * 0.03));
            
            var categoryMarkers = [];
            
            // Prioritize bigrams (more specific)
            Object.keys(bigramFreq).forEach(function(bigram) {
                if (bigramFreq[bigram] >= minFreq) {
                    categoryMarkers.push({ 
                        term: bigram, 
                        freq: bigramFreq[bigram], 
                        isBigram: true,
                        score: bigramFreq[bigram] * 2 // Bigrams get higher weight
                    });
                }
            });
            
            // Add single words not already covered by bigrams
            Object.keys(wordFreq).forEach(function(word) {
                if (wordFreq[word] >= minFreq) {
                    // Check if this word is already part of a high-freq bigram
                    var inBigram = categoryMarkers.some(function(m) {
                        return m.isBigram && m.term.indexOf(word) !== -1;
                    });
                    if (!inBigram) {
                        categoryMarkers.push({ 
                            term: word, 
                            freq: wordFreq[word], 
                            isBigram: false,
                            score: wordFreq[word]
                        });
                    }
                }
            });
            
            // Sort by score (frequency * weight)
            categoryMarkers.sort(function(a, b) { return b.score - a.score; });
            
            // ===== PHASE 4: ASSIGN EACH TXN TO BEST CATEGORY =====
            var groups = {};
            
            txns.forEach(function(t, idx) {
                var tokens = memoTokens[idx];
                var memoLower = (t.memo || '').toLowerCase();
                var bestMatch = null;
                var bestScore = 0;
                
                // Find the highest-scoring marker that appears in this memo
                for (var i = 0; i < categoryMarkers.length; i++) {
                    var marker = categoryMarkers[i];
                    var matches = false;
                    
                    if (marker.isBigram) {
                        matches = memoLower.indexOf(marker.term) !== -1;
                    } else {
                        matches = tokens.indexOf(marker.term) !== -1;
                    }
                    
                    if (matches && marker.score > bestScore) {
                        bestMatch = marker.term;
                        bestScore = marker.score;
                    }
                }
                
                var groupKey = bestMatch || 'Other';
                if (!groups[groupKey]) {
                    groups[groupKey] = { 
                        txns: [], 
                        total: 0, 
                        freq: bestMatch ? (bigramFreq[bestMatch] || wordFreq[bestMatch] || 0) : 0
                    };
                }
                groups[groupKey].txns.push(t);
                groups[groupKey].total += t.amount || 0;
            });
            
            // ===== PHASE 5: MERGE SMALL GROUPS =====
            // Groups with <2 transactions go to "Other" unless total is significant
            var avgGroupSize = txns.length / Object.keys(groups).length;
            var mergedGroups = {};
            
            Object.keys(groups).forEach(function(key) {
                var g = groups[key];
                if (key === 'Other' || g.txns.length >= 2 || g.total > (self.latestData?.results?.summary?.totalSpend || 0) * 0.01) {
                    mergedGroups[key] = g;
                } else {
                    // Merge into Other
                    if (!mergedGroups['Other']) mergedGroups['Other'] = { txns: [], total: 0, freq: 0 };
                    mergedGroups['Other'].txns = mergedGroups['Other'].txns.concat(g.txns);
                    mergedGroups['Other'].total += g.total;
                }
            });
            
            // Sort groups by total spend
            var sortedKeys = Object.keys(mergedGroups).sort(function(a, b) { 
                if (a === 'Other') return 1;
                if (b === 'Other') return -1;
                return mergedGroups[b].total - mergedGroups[a].total; 
            });
            
            // Store for expansion
            this.memoGroups = mergedGroups;
            this.expandedMemoGroups = this.expandedMemoGroups || {};
            
            // ===== PHASE 6: RENDER =====
            var html = '<div class="sv-memo-groups">';
            
            sortedKeys.forEach(function(key) {
                var g = mergedGroups[key];
                var isExpanded = self.expandedMemoGroups[key];
                var displayName = key.split(' ').map(function(w) { 
                    return w.charAt(0).toUpperCase() + w.slice(1); 
                }).join(' ');
                
                // Group header
                html += '<div class="sv-memo-group">' +
                    '<div class="sv-memo-group-header" onclick="SpendVelocityController.toggleMemoGroup(\'' + escapeHtml(key).replace(/'/g, "\\'") + '\')">' +
                    '<div class="d-flex align-items-center">' +
                    '<i class="fas fa-chevron-' + (isExpanded ? 'down' : 'right') + ' mr-2 text-muted"></i>' +
                    '<strong>' + escapeHtml(displayName) + '</strong>' +
                    '<span class="badge badge-secondary ml-2">' + g.txns.length + '</span>' +
                    '</div>' +
                    '<div class="text-right">' +
                    '<span class="font-weight-bold">' + self.formatCurrency(g.total) + '</span>' +
                    '<span class="text-muted ml-2 small">avg ' + self.formatCurrency(g.total / g.txns.length) + '</span>' +
                    '</div>' +
                    '</div>';
                
                // Expanded transactions
                if (isExpanded) {
                    html += '<div class="sv-memo-group-body">' +
                        '<table class="table table-sm mb-0"><thead class="thead-light"><tr>' +
                        '<th>Date</th><th>Type</th><th>Entity</th><th class="text-right">Amount</th><th>Memo</th>' +
                        '</tr></thead><tbody>';
                    
                    // Sort transactions by amount desc
                    var sortedTxns = g.txns.slice().sort(function(a, b) { return (b.amount || 0) - (a.amount || 0); });
                    
                    sortedTxns.forEach(function(t) {
                        var typeClass = t.type === 'VendBill' ? 'badge-primary' : t.type === 'ExpRept' ? 'badge-info' : 'badge-secondary';
                        html += '<tr>' +
                            '<td>' + (t.date || '--') + '</td>' +
                            '<td><span class="badge ' + typeClass + '">' + (t.type === 'VendBill' ? 'Bill' : t.type === 'ExpRept' ? 'Exp' : t.type) + '</span></td>' +
                            '<td>' + escapeHtml(t.entityName || '--') + '</td>' +
                            '<td class="text-right">' + self.formatCurrency(t.amount) + '</td>' +
                            '<td class="small text-muted" title="' + escapeHtml(t.memo || '') + '">' + escapeHtml((t.memo || '').substring(0, 35)) + (t.memo && t.memo.length > 35 ? '...' : '') + '</td>' +
                            '</tr>';
                    });
                    
                    html += '</tbody></table></div>';
                }
                
                html += '</div>';
            });
            
            html += '</div>';
            container.innerHTML = html;
            
            // Stats
            var markerInfo = categoryMarkers.length > 0 
                ? categoryMarkers.slice(0, 5).map(function(m) { return m.term; }).join(', ')
                : 'none detected';
            paginationContainer.innerHTML = '<div class="text-center small text-muted mt-1">' + 
                sortedKeys.length + ' smart groups from ' + txns.length + ' transactions' +
                '<br><span class="text-info">Top patterns: ' + markerInfo + '</span></div>';
        },
        
        toggleMemoGroup: function(key) {
            this.expandedMemoGroups = this.expandedMemoGroups || {};
            this.expandedMemoGroups[key] = !this.expandedMemoGroups[key];
            this.renderSmartMemoGrouping(this.getFilteredDrilldownData());
        },
        
        exportDrilldown: function() {
            var txns = this.drilldownData || [];
            if (txns.length === 0) return;
            
            var csv = 'Date,Type,Document,Entity,Account,Amount,Memo\n';
            txns.forEach(function(t) {
                csv += '"' + (t.date || '') + '",' +
                    '"' + (t.type || '') + '",' +
                    '"' + (t.tranId || '') + '",' +
                    '"' + (t.entityName || '').replace(/"/g, '""') + '",' +
                    '"' + (t.accountName || '').replace(/"/g, '""') + '",' +
                    (t.amount || 0) + ',' +
                    '"' + (t.memo || '').replace(/"/g, '""') + '"\n';
            });
            
            var blob = new Blob([csv], { type: 'text/csv' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'transactions_' + (this.drilldown.name || 'export').replace(/[^a-z0-9]/gi, '_') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
            a.click();
            URL.revokeObjectURL(url);
        },
        
        closeDrilldown: function() {
            this.drilldown = { active: false, type: null, id: null, name: null };
            el('#svDrilldownPanel').style.display = 'none';
        },
        
        // Render spend health gauge exactly like Health dashboard's renderHealthMeterKPI
        renderSpendHealthMeterKPI: function(score) {
            var gaugeEl = el('#SV_HealthGauge');
            var valueEl = el('#SV_HealthValue');
            var labelEl = el('#SV_HealthLabel');
            
            if (!gaugeEl) return;
            
            // Determine color and label based on score
            var color, label, colorClass;
            if (score >= 80) {
                color = '#10b981'; colorClass = 'text-success'; label = 'EXCELLENT';
            } else if (score >= 60) {
                color = '#3b82f6'; colorClass = 'text-info'; label = 'GOOD';
            } else if (score >= 40) {
                color = '#f59e0b'; colorClass = 'text-warning'; label = 'FAIR';
            } else {
                color = '#ef4444'; colorClass = 'text-danger'; label = 'NEEDS WORK';
            }
            
            // Calculate arc offset (full arc = 141.37, higher score = less offset)
            var arcLength = 141.37;
            var offset = arcLength * (1 - score / 100);
            
            gaugeEl.innerHTML = '<svg width="100" height="55" class="health-gauge-semi">' +
                '<path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke="#e5e7eb" stroke-width="10" stroke-linecap="round"></path>' +
                '<path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + arcLength + '" stroke-dashoffset="' + offset + '" style="transition: stroke-dashoffset 0.5s ease;"></path>' +
            '</svg>';
            
            if (valueEl) {
                valueEl.textContent = Math.round(score);
                valueEl.className = 'risk-meter-value ' + colorClass;
            }
            if (labelEl) {
                labelEl.textContent = label;
                labelEl.className = 'risk-meter-label ' + colorClass;
            }
        },
        
        formatCurrency: function(amount) {
            if (amount == null || isNaN(amount)) return this.currencySymbol + '0';
            
            var absAmount = Math.abs(amount);
            var formatted;
            
            if (absAmount >= 1000000) {
                formatted = (amount / 1000000).toFixed(1) + 'M';
            } else if (absAmount >= 1000) {
                formatted = (amount / 1000).toFixed(1) + 'K';
            } else {
                formatted = amount.toFixed(0);
            }
            
            return this.currencySymbol + formatted;
        }
    };
    
    // escapeHtml is now provided globally by Gantry.Core.js (window.escapeHtml)
    // Removed local duplicate - use the global version which includes single-quote escaping
    
    // Expose to global scope
    window.SpendVelocityController = SpendVelocityController;
    
    // Register route
    Router.register('spendvelocity', function() { SpendVelocityController.init(); });

})(window);