/**
 * Dashboard.VendorPerformance.js
 * PROCUREMENT 4.0 - World-Class Vendor Performance Intelligence Dashboard
 * 
 * Features:
 * - Maverick Spend Detection (bills without POs)
 * - OTIF Analysis (On-Time In-Full delivery)
 * - Purchase Price Variance (PPV) detection
 * - True Cash Flow Leakage analysis
 * - Interactive Plotly Bubble Chart for vendor positioning
 * - Vendor Scorecard with combined metrics
 */
(function(window) {
    'use strict';

    const VendorPerformanceController = {
        _version: 'v5.2-audit-fixes-pagination',
        latestData: null,
        subsidiaries: [],
        subsidiaryId: null,
        configData: null,
        currencySymbol: '$',
        
        // Drilldown state
        drilldown: { active: false, type: null, id: null, name: null },
        drilldownData: [],
        drilldownPagination: { page: 1, perPage: 50, sortCol: 'date', sortDir: 'desc' },
        drilldownSearch: '',
        drilldownGroupBy: 'none',
        
        // Tab pagination state
        tabPagination: {
            leakage: { page: 1, perPage: 25 },
            maverick: { page: 1, perPage: 25 },
            otif: { page: 1, perPage: 25 },
            ppv: { page: 1, perPage: 25 },
            scorecard: { page: 1, perPage: 25 },
            leadtime: { page: 1, perPage: 25 }
        },

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
            
            var subsidiaryEl = el("#vpSubsidiary");
            if (subsidiaryEl) {
                subsidiaryEl.addEventListener("change", function(e) {
                    self.subsidiaryId = e.target.value;
                    self.loadData();
                });
            }
            
            var btnApply = el("#vpApplyRange");
            if (btnApply) btnApply.addEventListener("click", function() { self.applyRange(); });

            if (window.jQuery) {
                $('#vpTabs a').on('click', function (e) {
                    e.preventDefault();
                    $(this).tab('show');
                });
                
                jQuery(document).on("shown.bs.tab", "#vp-maverick-tab", function() { self.renderMaverickTab(); });
                jQuery(document).on("shown.bs.tab", "#vp-otif-tab", function() { self.renderOTIFTab(); });
                jQuery(document).on("shown.bs.tab", "#vp-leadtime-tab", function() { self.renderLeadTimeTab(); });
                jQuery(document).on("shown.bs.tab", "#vp-ppv-tab", function() { self.renderPPVTab(); });
                jQuery(document).on("shown.bs.tab", "#vp-leakage-tab", function() { self.renderLeakageTab(); });
                jQuery(document).on("shown.bs.tab", "#vp-matrix-tab", function() { self.renderMatrixTab(); });
                jQuery(document).on("shown.bs.tab", "#vp-scorecard-tab", function() { self.renderScorecardTab(); });
                jQuery(document).on("shown.bs.tab", "#vp-config-tab", function() { self.renderConfigTab(); });
            }
        },
        
        getTemplate: function() {
            return '<div class="cf-dashboard vendor-performance-dashboard">' +
                // Header with controls
                '<div class="row mb-3">' +
                    '<div class="col-md-12">' +
                        '<form class="form-inline justify-content-center" id="vpDateForm" onsubmit="return false;">' +
                            '<select class="form-control form-control-sm mr-3" id="vpSubsidiary" style="max-width: 200px;"><option value="">All Subsidiaries</option></select>' +
                            '<label class="mr-2 small text-muted">Range:</label>' +
                            '<input type="date" class="form-control form-control-sm mr-2" id="vpStartDate">' +
                            '<span class="mr-2">to</span>' +
                            '<input type="date" class="form-control form-control-sm mr-2" id="vpEndDate">' +
                            '<button type="button" class="btn btn-sm btn-primary" id="vpApplyRange"><i class="fas fa-sync-alt mr-1"></i>Analyze</button>' +
                        '</form>' +
                    '</div>' +
                '</div>' +
                // KPI Row - 5 cards max
                '<div class="row mb-2 gutters-sm cf-kpi-row">' +
                    '<div class="col"><div class="cf-kpi-card" id="vpScoreCard"><div class="risk-meter-kpi"><div class="risk-meter-gauge" id="VP_PerformanceGauge"></div><div class="risk-meter-info"><span class="risk-meter-value" id="VP_PerformanceScore">--</span><span class="risk-meter-label" id="VP_ScoreLabel">CALCULATING</span></div></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-green-soft"><i class="fas fa-check-circle text-green"></i></div><div class="kpi-content"><span class="kpi-label">PO Compliance</span><span class="kpi-value" id="VP_MaverickPct">--</span><span class="kpi-sub" id="VP_MaverickAmount">Maverick spend</span></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-blue-soft"><i class="fas fa-clock text-blue"></i></div><div class="kpi-content"><span class="kpi-label">On-Time Rate</span><span class="kpi-value" id="VP_OTIFRate">--</span><span class="kpi-sub" id="VP_LateTx">Delivery performance</span></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-yellow-soft"><i class="fas fa-dollar-sign text-yellow"></i></div><div class="kpi-content"><span class="kpi-label">Price Variance</span><span class="kpi-value" id="VP_PPVAmount">--</span><span class="kpi-sub" id="VP_PPVItems">Overcharges</span></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-red-soft"><i class="fas fa-exclamation-triangle text-red"></i></div><div class="kpi-content"><span class="kpi-label">Overdue</span><span class="kpi-value" id="VP_OverdueAmt">--</span><span class="kpi-sub" id="VP_OverduePct">Past due amount</span></div></div></div>' +
                '</div>' +
                // Main Card with Tabs
                '<div class="card cf-main-card shadow-sm">' +
                    '<div class="card-header border-0 bg-white pt-3 pb-1 px-3">' +
                        '<ul class="nav nav-tabs cf-tabs" id="vpTabs">' +
                            '<li class="nav-item"><a class="nav-link active" id="vp-overview-tab" data-toggle="tab" href="#vp-overview"><i class="fas fa-home"></i> Overview</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="vp-maverick-tab" data-toggle="tab" href="#vp-maverick"><i class="fas fa-ban"></i> Maverick</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="vp-otif-tab" data-toggle="tab" href="#vp-otif"><i class="fas fa-clock"></i> OTIF</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="vp-leadtime-tab" data-toggle="tab" href="#vp-leadtime"><i class="fas fa-stopwatch"></i> Lead Time</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="vp-ppv-tab" data-toggle="tab" href="#vp-ppv"><i class="fas fa-dollar-sign"></i> PPV</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="vp-leakage-tab" data-toggle="tab" href="#vp-leakage"><i class="fas fa-file-invoice-dollar"></i> Payment Status</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="vp-matrix-tab" data-toggle="tab" href="#vp-matrix"><i class="fas fa-th-large"></i> Matrix</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="vp-scorecard-tab" data-toggle="tab" href="#vp-scorecard"><i class="fas fa-clipboard-list"></i> Scorecard</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="vp-config-tab" data-toggle="tab" href="#vp-config"><i class="fas fa-cog"></i> Configuration</a></li>' +
                        '</ul>' +
                    '</div>' +
                    '<div class="card-body p-0">' +
                        '<div class="tab-content">' +
                            '<div class="tab-pane fade show active" id="vp-overview"><div class="tab-inner p-3" id="vpOverviewContent"></div></div>' +
                            '<div class="tab-pane fade" id="vp-maverick"><div class="tab-inner p-3" id="vpMaverickContent"></div></div>' +
                            '<div class="tab-pane fade" id="vp-otif"><div class="tab-inner p-3" id="vpOTIFContent"></div></div>' +
                            '<div class="tab-pane fade" id="vp-leadtime"><div class="tab-inner p-3" id="vpLeadTimeContent"></div></div>' +
                            '<div class="tab-pane fade" id="vp-ppv"><div class="tab-inner p-3" id="vpPPVContent"></div></div>' +
                            '<div class="tab-pane fade" id="vp-leakage"><div class="tab-inner p-3" id="vpLeakageContent"></div></div>' +
                            '<div class="tab-pane fade" id="vp-matrix"><div class="tab-inner p-3" id="vpMatrixContent"></div></div>' +
                            '<div class="tab-pane fade" id="vp-scorecard"><div class="tab-inner p-3" id="vpScorecardContent"></div></div>' +
                            '<div class="tab-pane fade" id="vp-config"><div class="tab-inner p-3" id="vpConfigContent"></div></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // Drilldown flyout panel
                '<div id="vpDrilldownPanel" class="vp-drilldown-panel" style="display:none;">' +
                    '<div class="vp-drilldown-header"><span id="vpDrilldownTitle"></span><button class="btn-close" onclick="VendorPerformanceController.closeDrilldown()"><i class="fas fa-times"></i></button></div>' +
                    '<div id="vpDrilldownBody" class="vp-drilldown-body"></div>' +
                '</div>' +
            '</div>';
        },
        
        showLoadingState: function() {
            // Performance gauge skeleton (risk-meter style)
            var gaugeEl = el('#VP_PerformanceGauge');
            if (gaugeEl) gaugeEl.innerHTML = Skeleton.render('custom', { width: '100px', height: '55px' });
            var valueEl = el('#VP_PerformanceScore');
            if (valueEl) { valueEl.textContent = '--'; valueEl.className = 'risk-meter-value'; }
            var labelEl = el('#VP_ScoreLabel');
            if (labelEl) { labelEl.textContent = 'LOADING'; labelEl.className = 'risk-meter-label'; }
            
            // KPI values skeleton
            var kpiIds = ['VP_MaverickPct', 'VP_OTIFRate', 'VP_PPVAmount', 'VP_OverdueAmt'];
            kpiIds.forEach(function(id) {
                var el_ = el('#' + id);
                if (el_) el_.innerHTML = Skeleton.render('custom', { width: '60px', height: '1.5rem' });
            });
            
            // Overview tab skeleton
            var overviewEl = el('#vpOverviewContent');
            if (overviewEl) {
                overviewEl.innerHTML = '<div class="row">' +
                    '<div class="col-md-8">' + Skeleton.render('custom', { width: '100%', height: '400px' }) + '</div>' +
                    '<div class="col-md-4">' + Skeleton.render('custom', { width: '100%', height: '400px' }) + '</div>' +
                '</div>';
            }
        },
        
        loadConfig: function() {
            var self = this;
            API.get('vendor_performance_config').then(function(res) {
                self.subsidiaries = res.subsidiaries || [];
                self.renderSubsidiaryDropdown();
                self.configData = res.config || {};
                self.loadData();
            }).catch(function(e) {
                console.error("VP config load error", e);
                self.loadData();
            });
        },
        
        renderSubsidiaryDropdown: function() {
            var selectEl = el("#vpSubsidiary");
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
            
            var startEl = el('#vpStartDate');
            var endEl = el('#vpEndDate');
            
            if (!startEl.value) {
                var d = new Date();
                d.setMonth(d.getMonth() - 3);
                startEl.value = d.toISOString().split('T')[0];
            }
            if (!endEl.value) {
                endEl.value = new Date().toISOString().split('T')[0];
            }
            
            var params = {
                startDate: startEl.value,
                endDate: endEl.value,
                subsidiary: self.subsidiaryId || '',
                config: JSON.stringify(self.configData || {})  // JSON stringify config for URL
            };
            
            API.get('vendor_performance_data', params).then(function(res) {
                self.latestData = res;
                self.renderDashboard();
            }).catch(function(e) {
                console.error("VP data load error", e);
                self.renderError("Failed to load vendor performance data: " + e.message);
            });
        },
        
        applyRange: function() {
            this.loadData();
        },
        
        renderDashboard: function() {
            if (!this.latestData || !this.latestData.results) return;
            
            this.renderKPIs();
            this.renderOverviewTab();
        },
        
        renderKPIs: function() {
            var data = this.latestData.results;
            var summary = data.summary || {};
            var kpis = summary.kpis || {};
            var currencySymbol = (data.currencyInfo && data.currencyInfo.symbol) || '$';
            
            // Store currency for use elsewhere
            this.currencySymbol = currencySymbol;
            
            // Procurement Score using risk-meter pattern (like Health dashboard)
            var score = summary.procurementScore || 0;
            this.renderPerformanceMeterKPI(score);
            
            // PO Compliance (inverse of maverick)
            var complianceRate = kpis.maverickPct !== undefined ? (100 - kpis.maverickPct) : 100;
            var complianceColor = complianceRate >= 80 ? 'text-success' : complianceRate >= 60 ? 'text-warning' : 'text-danger';
            el('#VP_MaverickPct').innerHTML = '<span class="' + complianceColor + '">' + complianceRate.toFixed(0) + '%</span>';
            el('#VP_MaverickAmount').textContent = this.formatCurrency(kpis.maverickSpend || 0) + ' maverick';
            
            // OTIF Rate
            var otifRate = kpis.otifRate || 0;
            var otifColor = otifRate >= 90 ? 'text-success' : otifRate >= 70 ? 'text-warning' : 'text-danger';
            el('#VP_OTIFRate').innerHTML = '<span class="' + otifColor + '">' + otifRate + '%</span>';
            el('#VP_LateTx').textContent = (kpis.lateTransactions || 0) + ' late transactions';
            
            // PPV
            el('#VP_PPVAmount').textContent = this.formatCurrency(kpis.priceVariance || 0);
            el('#VP_PPVItems').textContent = 'Price overcharges';
            
            // Overdue Amount
            var overduePct = kpis.overduePct || 0;
            var overdueColor = overduePct > 20 ? 'text-danger' : overduePct > 10 ? 'text-warning' : 'text-success';
            el('#VP_OverdueAmt').innerHTML = '<span class="' + overdueColor + '">' + this.formatCurrency(kpis.overdueAmount || 0) + '</span>';
            el('#VP_OverduePct').textContent = overduePct + '% overdue';
        },
        
        // Render performance gauge exactly like Health dashboard's renderHealthMeterKPI
        renderPerformanceMeterKPI: function(score) {
            var gaugeEl = el('#VP_PerformanceGauge');
            var valueEl = el('#VP_PerformanceScore');
            var labelEl = el('#VP_ScoreLabel');
            
            if (!gaugeEl) return;
            
            // Determine color and label based on score
            var color, label, colorClass;
            if (score >= 85) {
                color = '#10b981'; colorClass = 'text-success'; label = 'EXCELLENT';
            } else if (score >= 70) {
                color = '#3b82f6'; colorClass = 'text-info'; label = 'GOOD';
            } else if (score >= 55) {
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
        
        renderOverviewTab: function() {
            var container = el('#vpOverviewContent');
            if (!container || !this.latestData) return;
            
            var data = this.latestData.results;
            var summary = data.summary || {};
            var insights = summary.insights || [];
            var kpis = summary.kpis || {};
            var self = this;
            
            var html = '<div class="row">';
            
            // Left: Insights & Quick Stats
            html += '<div class="col-lg-8">';
            
            // Executive Summary Card
            html += '<div class="card mb-3"><div class="card-header py-2"><strong><i class="fas fa-briefcase text-primary mr-2"></i>Executive Summary</strong></div><div class="card-body">';
            
            // Quick stats grid - use standard cf-kpi-card structure
            html += '<div class="row mb-3 gutters-sm cf-kpi-row">';
            html += '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-primary-soft"><i class="fas fa-building text-primary"></i></div><div class="kpi-content"><span class="kpi-label">Active Vendors</span><span class="kpi-value text-primary">' + (summary.totalVendors || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-blue-soft"><i class="fas fa-coins text-blue"></i></div><div class="kpi-content"><span class="kpi-label">Total Spend</span><span class="kpi-value">' + this.formatCurrency(summary.totalSpend || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-green-soft"><i class="fas fa-handshake text-green"></i></div><div class="kpi-content"><span class="kpi-label">Strategic</span><span class="kpi-value text-success">' + (kpis.strategicPartners || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-red-soft"><i class="fas fa-exclamation-circle text-red"></i></div><div class="kpi-content"><span class="kpi-label">At Risk</span><span class="kpi-value text-danger">' + (kpis.commodityVendors || 0) + '</span></div></div></div>';
            html += '</div>';
            
            // Procurement 4.0 metrics bar - use inline flex styling for reliability
            html += '<div class="mb-3"><strong class="d-block mb-2">Performance Breakdown</strong>';
            html += '<div class="row">';
            
            var ms = data.maverickSpend?.summary || {};
            var otif = data.otif?.summary || {};
            var cfl = data.cashFlowLeakage?.summary || {};
            
            // PO Compliance bar - parse as float and ensure valid percentage
            var complianceRate = parseFloat(ms.complianceRate);
            if (isNaN(complianceRate)) complianceRate = 0;
            complianceRate = Math.min(100, Math.max(0, complianceRate));
            var complianceColor = complianceRate >= 80 ? '#10b981' : complianceRate >= 60 ? '#f59e0b' : '#ef4444';
            html += '<div class="col-md-4 mb-2"><small class="text-muted d-block mb-1">PO Compliance</small>';
            html += '<div style="height: 10px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">';
            html += '<div style="height: 100%; width: ' + complianceRate.toFixed(1) + '%; background: ' + complianceColor + '; transition: width 0.3s;"></div></div>';
            html += '<small class="font-weight-bold">' + complianceRate.toFixed(1) + '%</small></div>';
            
            // OTIF bar - parse as float
            var otifRate = parseFloat(otif.onTimeRate);
            if (isNaN(otifRate)) otifRate = 0;
            otifRate = Math.min(100, Math.max(0, otifRate));
            var otifColor = otifRate >= 90 ? '#10b981' : otifRate >= 70 ? '#f59e0b' : '#ef4444';
            html += '<div class="col-md-4 mb-2"><small class="text-muted d-block mb-1">On-Time Delivery</small>';
            html += '<div style="height: 10px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">';
            html += '<div style="height: 100%; width: ' + otifRate.toFixed(1) + '%; background: ' + otifColor + '; transition: width 0.3s;"></div></div>';
            html += '<small class="font-weight-bold">' + otifRate.toFixed(1) + '%</small></div>';
            
            // Payment Timing bar - parse as float
            var onTimePct = parseFloat(cfl.onTimePct);
            if (isNaN(onTimePct)) onTimePct = 0;
            onTimePct = Math.min(100, Math.max(0, onTimePct));
            var onTimeColor = onTimePct >= 70 ? '#10b981' : onTimePct >= 50 ? '#f59e0b' : '#ef4444';
            html += '<div class="col-md-4 mb-2"><small class="text-muted d-block mb-1">Payment Timing</small>';
            html += '<div style="height: 10px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">';
            html += '<div style="height: 100%; width: ' + onTimePct.toFixed(1) + '%; background: ' + onTimeColor + '; transition: width 0.3s;"></div></div>';
            html += '<small class="font-weight-bold">' + onTimePct.toFixed(1) + '% on-time</small></div>';
            
            html += '</div></div>';
            html += '</div></div>';
            
            // Insights Panel - improved spacing
            html += '<div class="card mb-3"><div class="card-header py-2"><strong><i class="fas fa-lightbulb text-warning mr-2"></i>Action Items</strong></div>';
            html += '<div class="card-body p-0">';
            if (insights.length === 0) {
                html += '<div class="p-3"><p class="text-muted mb-0"><i class="fas fa-check-circle text-success mr-2"></i>No critical issues. Procurement operations are healthy.</p></div>';
            } else {
                insights.slice(0, 5).forEach(function(insight, idx) {
                    var iconClass = insight.type === 'alert' ? 'exclamation-triangle' : insight.type === 'warning' ? 'exclamation-circle' : 'info-circle';
                    var iconColor = insight.type === 'alert' ? 'text-danger' : insight.type === 'warning' ? 'text-warning' : 'text-info';
                    var bgColor = insight.type === 'alert' ? 'rgba(239,68,68,0.08)' : insight.type === 'warning' ? 'rgba(245,158,11,0.08)' : 'transparent';
                    var borderBottom = idx < insights.length - 1 && idx < 4 ? 'border-bottom' : '';
                    
                    html += '<div class="p-3 ' + borderBottom + '" style="background: ' + bgColor + ';">';
                    html += '<div class="d-flex">';
                    html += '<div class="mr-3"><i class="fas fa-' + iconClass + ' ' + iconColor + ' fa-lg"></i></div>';
                    html += '<div class="flex-grow-1">';
                    html += '<div class="d-flex justify-content-between align-items-start mb-1">';
                    html += '<strong>' + escapeHtml(insight.title) + '</strong>';
                    html += '<span class="badge badge-' + (insight.impact === 'high' ? 'danger' : 'warning') + ' ml-2">' + (insight.impact || 'medium').toUpperCase() + '</span>';
                    html += '</div>';
                    html += '<p class="mb-2 text-secondary">' + escapeHtml(insight.message) + '</p>';
                    if (insight.action) {
                        html += '<div class="text-primary small"><i class="fas fa-arrow-circle-right mr-1"></i>' + escapeHtml(insight.action) + '</div>';
                    }
                    html += '</div>';
                    html += '</div>';
                    html += '</div>';
                });
            }
            html += '</div></div>';
            
            html += '</div>'; // col-lg-8
            
            // Right: Mini Bubble Chart Preview
            html += '<div class="col-lg-4">';
            html += '<div class="card"><div class="card-header py-2"><strong><i class="fas fa-th-large text-info mr-2"></i>Vendor Positioning</strong></div>';
            html += '<div class="card-body" id="vpMiniMatrix" style="height: 340px;"></div>';
            html += '<div class="card-footer py-2 text-center"><a href="#" onclick="jQuery(\'#vp-matrix-tab\').tab(\'show\'); return false;" class="small">View Full Matrix →</a></div>';
            html += '</div>';
            html += '</div>'; // col-lg-4
            
            html += '</div>'; // row
            
            container.innerHTML = html;
            
            // Render mini bubble chart
            this.renderMiniBubbleChart();
        },
        
        renderMiniBubbleChart: function() {
            var container = el('#vpMiniMatrix');
            if (!container || !this.latestData || typeof Plotly === 'undefined') {
                if (container) container.innerHTML = '<p class="text-muted text-center pt-5">Plotly not available</p>';
                return;
            }
            
            var bubbleData = this.latestData.results.leverageMatrix?.bubbleData || [];
            if (bubbleData.length === 0) {
                container.innerHTML = '<p class="text-muted text-center pt-5">No vendor data for matrix</p>';
                return;
            }
            
            var colors = bubbleData.map(function(d) {
                if (d.quadrant === 'strategic') return '#10b981';
                if (d.quadrant === 'commodity') return '#ef4444';
                if (d.quadrant === 'niche') return '#3b82f6';
                return '#9ca3af';
            });
            
            var trace = {
                x: bubbleData.map(function(d) { return d.x; }),
                y: bubbleData.map(function(d) { return d.y; }),
                mode: 'markers',
                marker: {
                    size: bubbleData.map(function(d) { return d.r; }),
                    color: colors,
                    opacity: 0.7,
                    line: { width: 1, color: '#fff' }
                },
                text: bubbleData.map(function(d) { return d.vendorName; }),
                hovertemplate: '<b>%{text}</b><br>Spend: %{x:.1f}%<br>Performance: %{y}<extra></extra>'
            };
            
            // Calculate data bounds to auto-zoom to where data is
            var allX = bubbleData.map(function(d) { return d.x; });
            var allY = bubbleData.map(function(d) { return d.y; });
            var maxDataX = Math.max.apply(null, allX);
            var minDataY = Math.min.apply(null, allY);
            var maxDataY = Math.max.apply(null, allY);
            
            // Add padding and set bounds
            var maxX = Math.min(100, Math.max(15, maxDataX * 1.3));
            var yPadding = Math.max(10, (maxDataY - minDataY) * 0.2);
            var minY = Math.max(0, minDataY - yPadding);
            var maxY = Math.min(105, maxDataY + yPadding);
            
            // Ensure minimum vertical range
            if (maxY - minY < 40) {
                var midY = (maxY + minY) / 2;
                minY = Math.max(0, midY - 25);
                maxY = Math.min(105, midY + 25);
            }
            
            var layout = {
                showlegend: false,
                margin: { t: 10, r: 10, b: 40, l: 40 },
                xaxis: { title: 'Spend %', range: [0, maxX] },
                yaxis: { title: 'Score', range: [minY, maxY] },
                shapes: [
                    { type: 'line', x0: 0, x1: maxX, y0: 75, y1: 75, line: { color: '#e5e7eb', width: 1, dash: 'dot' }, visible: (minY <= 75 && maxY >= 75) },
                    { type: 'line', x0: 10, x1: 10, y0: minY, y1: maxY, line: { color: '#e5e7eb', width: 1, dash: 'dot' }, visible: (maxX >= 10) }
                ],
                annotations: [
                    { x: maxX * 0.7, y: Math.min(90, maxY - 5), text: 'Strategic', showarrow: false, font: { size: 10, color: '#10b981' }, visible: (maxY >= 70) },
                    { x: maxX * 0.7, y: Math.max(40, minY + 10), text: 'Replace', showarrow: false, font: { size: 10, color: '#ef4444' }, visible: (minY <= 60) },
                    { x: 2, y: Math.min(90, maxY - 5), text: 'Niche', showarrow: false, font: { size: 10, color: '#3b82f6' }, visible: (maxY >= 70) }
                ]
            };
            
            Plotly.newPlot(container, [trace], layout, { displayModeBar: false, responsive: true });
        },
        
        // ==========================================
        // MAVERICK SPEND TAB
        // ==========================================
        
        renderMaverickTab: function(page) {
            var container = el('#vpMaverickContent');
            if (!container || !this.latestData) return;
            
            var ms = this.latestData.results.maverickSpend || {};
            var summary = ms.summary || {};
            var vendors = ms.vendors || [];
            var allVendors = ms.allVendors || [];
            var self = this;
            
            // Show all vendors if no maverick vendors but we have vendor data
            var displayVendors = vendors.length > 0 ? vendors : allVendors;
            
            // Pagination setup
            var pag = this.tabPagination.maverick;
            if (typeof page === 'number') pag.page = page;
            var perPage = pag.perPage;
            var totalPages = Math.ceil(displayVendors.length / perPage);
            if (pag.page > totalPages) pag.page = Math.max(1, totalPages);
            var startIdx = (pag.page - 1) * perPage;
            var pagedVendors = displayVendors.slice(startIdx, startIdx + perPage);
            
            var html = '<h6 class="mb-3"><i class="fas fa-ban mr-2 text-danger"></i>Maverick Spend Analysis</h6>';
            html += '<p class="text-muted mb-3">Bills processed without a Purchase Order reference indicate unauthorized or unmanaged spend.</p>';
            
            // Summary cards using shared KPI card infrastructure
            html += '<div class="row mb-3 gutters-sm cf-kpi-row">';
            html += '<div class="col"><div class="cf-kpi-card ' + (summary.complianceRate < 70 ? 'border-left-danger' : '') + '">' +
                '<div class="icon-wrapper ' + (summary.complianceRate >= 80 ? 'bg-green-soft' : summary.complianceRate >= 60 ? 'bg-yellow-soft' : 'bg-red-soft') + '"><i class="fas fa-check-circle ' + (summary.complianceRate >= 80 ? 'text-green' : summary.complianceRate >= 60 ? 'text-yellow' : 'text-red') + '"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">PO Compliance</span><span class="kpi-value ' + (summary.complianceRate >= 80 ? 'text-success' : summary.complianceRate >= 60 ? 'text-warning' : 'text-danger') + '">' + (summary.complianceRate || 0) + '%</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-red-soft"><i class="fas fa-ban text-red"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Maverick Spend</span><span class="kpi-value text-danger">' + this.formatCurrency(summary.maverickSpend || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-blue-soft"><i class="fas fa-file-invoice text-blue"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Maverick / Total</span><span class="kpi-value">' + (summary.maverickBills || 0) + ' / ' + (summary.totalBills || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-yellow-soft"><i class="fas fa-exclamation-triangle text-yellow"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Unmanaged Vendors</span><span class="kpi-value text-warning">' + (summary.criticalVendors || 0) + '</span></div></div></div>';
            html += '</div>';
            
            if (displayVendors.length === 0) {
                html += '<div class="alert alert-info"><i class="fas fa-info-circle mr-2"></i>No vendor transaction data available for analysis.</div>';
            } else if (vendors.length === 0 && allVendors.length > 0) {
                html += '<div class="alert alert-success"><i class="fas fa-check-circle mr-2"></i>Excellent! All vendor bills have PO references. No maverick spend detected.</div>';
            } else {
                // Show count and pagination info
                html += '<div class="d-flex justify-content-between align-items-center mb-2">';
                html += '<span class="text-muted small">' + displayVendors.length + ' vendors total</span>';
                if (totalPages > 1) {
                    html += '<span class="text-muted small">Page ' + pag.page + ' of ' + totalPages + '</span>';
                }
                html += '</div>';
                
                html += '<div class="table-responsive"><table class="table table-sm table-hover vp-sortable-table vp-clickable-table" id="maverickTable">';
                html += '<thead class="thead-light"><tr>';
                html += '<th class="sortable" data-sort="name">Vendor <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right" data-sort="total">Total Bills <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right" data-sort="maverick">Maverick <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right" data-sort="pct">Maverick % <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right" data-sort="spend">Maverick Spend <i class="fas fa-sort"></i></th>';
                html += '<th>Risk</th>';
                html += '</tr></thead>';
                html += '<tbody>';
                
                pagedVendors.forEach(function(v) {
                    var riskClass = v.riskLevel === 'critical' ? 'danger' : v.riskLevel === 'warning' ? 'warning' : 'success';
                    html += '<tr class="vp-clickable-row" onclick="VendorPerformanceController.drilldownVendor(' + v.vendorId + ', \'' + escapeHtml(v.vendorName).replace(/'/g, "\\'") + '\', \'maverick\')">';
                    html += '<td><strong>' + escapeHtml(v.vendorName) + '</strong></td>';
                    html += '<td class="text-right">' + v.totalBills + '</td>';
                    html += '<td class="text-right text-danger">' + v.maverickCount + '</td>';
                    html += '<td class="text-right"><span class="text-' + riskClass + '">' + v.maverickPct + '%</span></td>';
                    html += '<td class="text-right">' + self.formatCurrency(v.maverickSpend) + '</td>';
                    html += '<td><span class="badge badge-' + riskClass + '">' + v.riskLevel + '</span></td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table></div>';
                
                // Pagination controls
                if (totalPages > 1) {
                    html += this.renderTabPagination('maverick', pag.page, totalPages);
                }
            }
            
            container.innerHTML = html;
            this.initSortableTable('maverickTable');
        },
        
        // ==========================================
        // OTIF TAB
        // ==========================================
        
        renderOTIFTab: function(page) {
            var container = el('#vpOTIFContent');
            if (!container || !this.latestData) return;
            
            var otif = this.latestData.results.otif || {};
            var summary = otif.summary || {};
            var vendors = otif.vendors || [];
            var self = this;
            
            // Pagination setup
            var pag = this.tabPagination.otif;
            if (typeof page === 'number') pag.page = page;
            var perPage = pag.perPage;
            var totalPages = Math.ceil(vendors.length / perPage);
            if (pag.page > totalPages) pag.page = Math.max(1, totalPages);
            var startIdx = (pag.page - 1) * perPage;
            var pagedVendors = vendors.slice(startIdx, startIdx + perPage);
            
            var html = '<h6 class="mb-3"><i class="fas fa-truck mr-2 text-blue"></i>On-Time In-Full (OTIF) Delivery Analysis</h6>';
            html += '<p class="text-muted mb-3">Measures vendor delivery performance by comparing actual receipt dates to PO expected dates.</p>';
            
            // Calculate avg delay days from vendors if not in summary
            var avgDelayDays = summary.avgDelayDays;
            if (avgDelayDays === undefined && vendors.length > 0) {
                var totalDelay = 0;
                var delayCount = 0;
                vendors.forEach(function(v) {
                    if (v.avgDelayDays !== undefined && v.avgDelayDays !== null) {
                        totalDelay += v.avgDelayDays;
                        delayCount++;
                    }
                });
                avgDelayDays = delayCount > 0 ? Math.round((totalDelay / delayCount) * 10) / 10 : 0;
            }
            
            // Summary cards using shared KPI card infrastructure
            html += '<div class="row mb-3 gutters-sm cf-kpi-row">';
            html += '<div class="col"><div class="cf-kpi-card ' + (summary.onTimeRate < 80 ? 'border-left-warning' : '') + '">' +
                '<div class="icon-wrapper ' + (summary.onTimeRate >= 90 ? 'bg-green-soft' : summary.onTimeRate >= 70 ? 'bg-yellow-soft' : 'bg-red-soft') + '"><i class="fas fa-clock ' + (summary.onTimeRate >= 90 ? 'text-green' : summary.onTimeRate >= 70 ? 'text-yellow' : 'text-red') + '"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">On-Time Rate</span><span class="kpi-value ' + (summary.onTimeRate >= 90 ? 'text-success' : summary.onTimeRate >= 70 ? 'text-warning' : 'text-danger') + '">' + (summary.onTimeRate || 0) + '%</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-blue-soft"><i class="fas fa-boxes text-blue"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Total Receipts</span><span class="kpi-value">' + (summary.totalReceipts || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-red-soft"><i class="fas fa-exclamation-circle text-red"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Late Deliveries</span><span class="kpi-value text-danger">' + (summary.lateCount || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-yellow-soft"><i class="fas fa-hourglass-half text-yellow"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Avg Delay</span><span class="kpi-value">' + (avgDelayDays || 0) + ' days</span></div></div></div>';
            html += '</div>';
            
            if (vendors.length === 0) {
                html += '<div class="alert alert-info"><i class="fas fa-info-circle mr-2"></i>No purchase order receipt data available. OTIF analysis requires PO → Item Receipt linkage.</div>';
            } else {
                // Show count and pagination info
                html += '<div class="d-flex justify-content-between align-items-center mb-2">';
                html += '<span class="text-muted small">' + vendors.length + ' vendors total</span>';
                if (totalPages > 1) {
                    html += '<span class="text-muted small">Page ' + pag.page + ' of ' + totalPages + '</span>';
                }
                html += '</div>';
                
                html += '<div class="table-responsive"><table class="table table-sm table-hover vp-sortable-table vp-clickable-table" id="otifTable">';
                html += '<thead class="thead-light"><tr>';
                html += '<th class="sortable">Vendor <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Receipts <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">On-Time <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Late <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">OTIF % <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Avg Delay <i class="fas fa-sort"></i></th>';
                html += '<th>Rating</th>';
                html += '</tr></thead>';
                html += '<tbody>';
                
                pagedVendors.forEach(function(v) {
                    var ratingClass = v.rating === 'excellent' ? 'success' : v.rating === 'good' ? 'info' : v.rating === 'fair' ? 'warning' : 'danger';
                    html += '<tr class="vp-clickable-row" onclick="VendorPerformanceController.drilldownVendor(' + v.vendorId + ', \'' + escapeHtml(v.vendorName).replace(/'/g, "\\'") + '\', \'otif\')">';
                    html += '<td><strong>' + escapeHtml(v.vendorName) + '</strong></td>';
                    html += '<td class="text-right">' + v.totalReceipts + '</td>';
                    html += '<td class="text-right text-success">' + v.onTimeCount + '</td>';
                    html += '<td class="text-right text-danger">' + v.lateCount + '</td>';
                    html += '<td class="text-right"><strong class="text-' + ratingClass + '">' + v.onTimeRate + '%</strong></td>';
                    html += '<td class="text-right">' + v.avgDelayDays + ' days</td>';
                    html += '<td><span class="badge badge-' + ratingClass + '">' + v.rating + '</span></td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table></div>';
                
                // Pagination controls
                if (totalPages > 1) {
                    html += this.renderTabPagination('otif', pag.page, totalPages);
                }
            }
            
            container.innerHTML = html;
            this.initSortableTable('otifTable');
        },
        
        // ==========================================
        // LEAD TIME VARIANCE TAB
        // ==========================================
        
        renderLeadTimeTab: function(page) {
            var container = el('#vpLeadTimeContent');
            if (!container || !this.latestData) return;
            
            var ltv = this.latestData.results.leadTimeVariance || {};
            var summary = ltv.summary || {};
            var vendors = ltv.vendors || [];
            var self = this;
            
            // Pagination setup
            var pag = this.tabPagination.leadtime;
            if (typeof page === 'number') pag.page = page;
            var perPage = pag.perPage;
            var totalPages = Math.ceil(vendors.length / perPage);
            if (pag.page > totalPages) pag.page = Math.max(1, totalPages);
            var startIdx = (pag.page - 1) * perPage;
            var pagedVendors = vendors.slice(startIdx, startIdx + perPage);
            
            var html = '<h6 class="mb-3"><i class="fas fa-stopwatch mr-2 text-info"></i>Lead Time Variance Analysis</h6>';
            html += '<p class="text-muted mb-3">Measures delivery consistency. High variance = unpredictable suppliers requiring more safety stock. Lower coefficient of variation (CV) = more reliable.</p>';
            
            // Summary cards using shared KPI card infrastructure
            html += '<div class="row mb-3 gutters-sm cf-kpi-row">';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-blue-soft"><i class="fas fa-users text-blue"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Vendors Analyzed</span><span class="kpi-value">' + (summary.vendorCount || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-purple-soft"><i class="fas fa-chart-bar text-purple"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Avg CV</span><span class="kpi-value">' + (summary.avgCoeffOfVariation || 0) + '</span><span class="kpi-sub">lower is better</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card border-left-success">' +
                '<div class="icon-wrapper bg-green-soft"><i class="fas fa-check-circle text-green"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Consistent</span><span class="kpi-value text-success">' + (summary.consistentVendors || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card border-left-danger">' +
                '<div class="icon-wrapper bg-red-soft"><i class="fas fa-exclamation-triangle text-red"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Volatile</span><span class="kpi-value text-danger">' + (summary.highVarianceVendors || 0) + '</span></div></div></div>';
            html += '</div>';
            
            if (vendors.length === 0) {
                html += '<div class="alert alert-info"><i class="fas fa-info-circle mr-2"></i>Lead time variance requires Purchase Order → Item Receipt linkage with at least 2 receipts per vendor. No qualifying data found.</div>';
            } else {
                // Show count and pagination info
                html += '<div class="d-flex justify-content-between align-items-center mb-2">';
                html += '<span class="text-muted small">' + vendors.length + ' vendors total</span>';
                if (totalPages > 1) {
                    html += '<span class="text-muted small">Page ' + pag.page + ' of ' + totalPages + '</span>';
                }
                html += '</div>';
                
                html += '<div class="table-responsive"><table class="table table-sm table-hover vp-sortable-table vp-clickable-table" id="leadTimeTable">';
                html += '<thead class="thead-light"><tr>';
                html += '<th class="sortable">Vendor <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Deliveries <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Avg Lead (days) <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Std Dev <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">CV <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Min <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Max <i class="fas fa-sort"></i></th>';
                html += '<th>Reliability</th>';
                html += '</tr></thead>';
                html += '<tbody>';
                
                pagedVendors.forEach(function(v) {
                    var reliabilityClass = v.reliability === 'excellent' ? 'success' : v.reliability === 'good' ? 'info' : v.reliability === 'fair' ? 'warning' : 'danger';
                    html += '<tr class="vp-clickable-row" onclick="VendorPerformanceController.drilldownVendor(' + v.vendorId + ', \'' + escapeHtml(v.vendorName).replace(/'/g, "\\'") + '\', \'leadtime\')">';
                    html += '<td><strong>' + escapeHtml(v.vendorName) + '</strong></td>';
                    html += '<td class="text-right">' + v.deliveryCount + '</td>';
                    html += '<td class="text-right">' + v.avgLeadTime + '</td>';
                    html += '<td class="text-right">' + v.stddev + '</td>';
                    html += '<td class="text-right text-' + reliabilityClass + '">' + v.coefficientOfVariation + '</td>';
                    html += '<td class="text-right">' + v.minLeadTime + '</td>';
                    html += '<td class="text-right">' + v.maxLeadTime + '</td>';
                    html += '<td><span class="badge badge-' + reliabilityClass + '">' + v.reliability + '</span></td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table></div>';
                
                // Pagination controls
                if (totalPages > 1) {
                    html += this.renderTabPagination('leadtime', pag.page, totalPages);
                }
                
                // Explanation
                html += '<div class="mt-3 p-3 bg-light rounded">';
                html += '<strong>Understanding Lead Time Variance:</strong><br>';
                html += '<small class="text-muted">';
                html += '• <strong>Coefficient of Variation (CV)</strong> = Standard Deviation ÷ Average Lead Time<br>';
                html += '• <strong>CV < 0.15</strong>: Excellent consistency (minimal safety stock needed)<br>';
                html += '• <strong>CV 0.15-0.30</strong>: Good consistency<br>';
                html += '• <strong>CV 0.30-0.50</strong>: Fair (consider buffer stock)<br>';
                html += '• <strong>CV > 0.50</strong>: Poor - highly unpredictable supplier';
                html += '</small></div>';
            }
            
            container.innerHTML = html;
            this.initSortableTable('leadTimeTable');
        },
        
        // ==========================================
        // PPV TAB
        // ==========================================
        
        renderPPVTab: function(page) {
            var container = el('#vpPPVContent');
            if (!container || !this.latestData) return;
            
            var ppv = this.latestData.results.ppv || {};
            var summary = ppv.summary || {};
            var items = ppv.items || [];
            var self = this;
            
            // Pagination setup
            var pag = this.tabPagination.ppv;
            if (typeof page === 'number') pag.page = page;
            var perPage = pag.perPage;
            var totalPages = Math.ceil(items.length / perPage);
            if (pag.page > totalPages) pag.page = Math.max(1, totalPages);
            var startIdx = (pag.page - 1) * perPage;
            var pagedItems = items.slice(startIdx, startIdx + perPage);
            
            var html = '<h6 class="mb-3"><i class="fas fa-dollar-sign mr-2 text-yellow"></i>Purchase Price Variance (PPV) Analysis</h6>';
            html += '<p class="text-muted mb-3">Detects price creep by comparing rates across multiple purchases. Items with >5% variance from minimum rate are flagged.</p>';
            
            // Summary cards using shared KPI card infrastructure
            html += '<div class="row mb-3 gutters-sm cf-kpi-row">';
            html += '<div class="col"><div class="cf-kpi-card ' + (summary.totalVariance > 1000 ? 'border-left-danger' : '') + '">' +
                '<div class="icon-wrapper bg-red-soft"><i class="fas fa-dollar-sign text-red"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Total Overcharge</span><span class="kpi-value text-danger">' + this.formatCurrency(summary.totalVariance || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-blue-soft"><i class="fas fa-boxes text-blue"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Items Analyzed</span><span class="kpi-value">' + (summary.itemsAnalyzed || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-yellow-soft"><i class="fas fa-exclamation-circle text-yellow"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Items Overcharged</span><span class="kpi-value text-warning">' + (summary.itemsWithOvercharge || 0) + '</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-purple-soft"><i class="fas fa-percent text-purple"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Avg Variance</span><span class="kpi-value">' + (summary.avgVariancePct || 0) + '%</span></div></div></div>';
            html += '</div>';
            
            if (items.length === 0) {
                html += '<div class="alert alert-success"><i class="fas fa-check-circle mr-2"></i>No significant price variances detected. Pricing is consistent across purchases.</div>';
            } else {
                // Show count and pagination info
                html += '<div class="d-flex justify-content-between align-items-center mb-2">';
                html += '<span class="text-muted small">' + items.length + ' items with variance</span>';
                if (totalPages > 1) {
                    html += '<span class="text-muted small">Page ' + pag.page + ' of ' + totalPages + '</span>';
                }
                html += '</div>';
                
                html += '<div class="table-responsive"><table class="table table-sm table-hover vp-sortable-table vp-clickable-table" id="ppvTable">';
                html += '<thead class="thead-light"><tr>';
                html += '<th class="sortable">Item <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable">Vendor <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Avg Rate <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Min Rate <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Max Rate <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Variance <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Impact <i class="fas fa-sort"></i></th>';
                html += '</tr></thead>';
                html += '<tbody>';
                
                pagedItems.forEach(function(item) {
                    var varClass = item.riskLevel === 'critical' ? 'danger' : 'warning';
                    html += '<tr class="vp-clickable-row" onclick="VendorPerformanceController.drilldownVendor(' + item.vendorId + ', \'' + escapeHtml(item.vendorName).replace(/'/g, "\\'") + '\', \'ppv\')">';
                    html += '<td><strong>' + escapeHtml(item.itemName) + '</strong></td>';
                    html += '<td>' + escapeHtml(item.vendorName) + '</td>';
                    html += '<td class="text-right">' + self.formatCurrency(item.avgRate) + '</td>';
                    html += '<td class="text-right">' + self.formatCurrency(item.minRate) + '</td>';
                    html += '<td class="text-right">' + self.formatCurrency(item.maxRate) + '</td>';
                    html += '<td class="text-right text-' + varClass + '">+' + item.variancePct + '%</td>';
                    html += '<td class="text-right text-danger">' + self.formatCurrency(item.varianceAmount) + '</td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table></div>';
                
                // Pagination controls
                if (totalPages > 1) {
                    html += this.renderTabPagination('ppv', pag.page, totalPages);
                }
            }
            
            container.innerHTML = html;
            this.initSortableTable('ppvTable');
        },
        
        // ==========================================
        // PAYMENT STATUS TAB (formerly Cash Flow)
        // FIX: Corrected field mapping semantics - noDueDate means "missing due date", not "not yet due"
        // FIX: Added pagination for large vendor lists
        // ==========================================
        
        renderLeakageTab: function(page) {
            var container = el('#vpLeakageContent');
            if (!container || !this.latestData) return;
            
            var cfl = this.latestData.results.cashFlowLeakage || {};
            var summary = cfl.summary || {};
            var vendors = cfl.vendors || [];
            var self = this;
            
            // Pagination setup
            var pag = this.tabPagination.leakage;
            if (typeof page === 'number') pag.page = page;
            var perPage = pag.perPage;
            var totalPages = Math.ceil(vendors.length / perPage);
            if (pag.page > totalPages) pag.page = Math.max(1, totalPages);
            var startIdx = (pag.page - 1) * perPage;
            var pagedVendors = vendors.slice(startIdx, startIdx + perPage);
            
            var html = '<h6 class="mb-3"><i class="fas fa-file-invoice-dollar mr-2 text-info"></i>Payment Status & Due Date Analysis</h6>';
            html += '<p class="text-muted mb-3">Analyzes vendor transactions by due date status as of the selected end date. Overdue amounts represent payment risk.</p>';
            
            // Summary cards with corrected field names
            var withDue = parseInt(summary.withDueDate) || 0;
            var notDueCount = parseInt(summary.notDueCount) || 0;
            var dueSoonCount = parseInt(summary.dueSoonCount) || 0;
            var overdueCount = parseInt(summary.overdueCount) || 0;
            var noDueDateCount = parseInt(summary.noDueDate) || 0;
            
            // Calculate percentages with proper rounding (only for bills WITH due dates)
            var notDuePct = withDue > 0 ? Math.round((notDueCount / withDue) * 1000) / 10 : 0;
            var dueSoonPct = withDue > 0 ? Math.round((dueSoonCount / withDue) * 1000) / 10 : 0;
            var overduePct = withDue > 0 ? Math.round((overdueCount / withDue) * 1000) / 10 : 0;
            
            // Ensure percentages add up to approximately 100% (handle rounding)
            var totalPct = notDuePct + dueSoonPct + overduePct;
            if (totalPct > 0 && Math.abs(totalPct - 100) > 1) {
                var scale = 100 / totalPct;
                notDuePct = Math.round(notDuePct * scale * 10) / 10;
                dueSoonPct = Math.round(dueSoonPct * scale * 10) / 10;
                overduePct = Math.round(overduePct * scale * 10) / 10;
            }
            
            // Summary cards using shared KPI card infrastructure
            html += '<div class="row mb-3 gutters-sm cf-kpi-row">';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-blue-soft"><i class="fas fa-file-invoice text-blue"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Total Bills</span><span class="kpi-value">' + (summary.totalBills || 0) + '</span>' +
                (noDueDateCount > 0 ? '<span class="kpi-sub text-muted">' + noDueDateCount + ' missing due date</span>' : '') +
                '</div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-green-soft"><i class="fas fa-check-circle text-green"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Not Yet Due</span><span class="kpi-value text-success">' + notDuePct.toFixed(1) + '%</span><span class="kpi-sub">' + notDueCount + ' bills</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-yellow-soft"><i class="fas fa-clock text-yellow"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Due Soon</span><span class="kpi-value text-warning">' + dueSoonPct.toFixed(1) + '%</span><span class="kpi-sub">' + dueSoonCount + ' bills</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-red-soft"><i class="fas fa-exclamation-circle text-red"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Overdue</span><span class="kpi-value text-danger">' + overduePct.toFixed(1) + '%</span><span class="kpi-sub">' + overdueCount + ' bills</span></div></div></div>';
            html += '<div class="col"><div class="cf-kpi-card border-left-danger">' +
                '<div class="icon-wrapper bg-red-soft"><i class="fas fa-dollar-sign text-red"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Overdue Amount</span><span class="kpi-value text-danger">' + this.formatCurrency(summary.overdueAmount || 0) + '</span></div></div></div>';
            html += '</div>';
            
            // Status distribution bar
            if (withDue > 0) {
                html += '<div class="mb-4"><strong>Due Date Status Distribution</strong> <small class="text-muted">(bills with due dates only)</small>';
                html += '<div class="d-flex mt-2" style="height: 30px; font-size: 13px; font-weight: 500; border-radius: 4px; overflow: hidden;">';
                if (notDuePct > 0) {
                    html += '<div class="bg-success d-flex align-items-center justify-content-center text-white" style="flex: 0 0 ' + notDuePct.toFixed(1) + '%; min-width: ' + (notDuePct > 5 ? '0' : '20px') + ';">' + (notDuePct > 8 ? notDuePct.toFixed(1) + '% Not Due' : '') + '</div>';
                }
                if (dueSoonPct > 0) {
                    html += '<div class="bg-warning d-flex align-items-center justify-content-center" style="flex: 0 0 ' + dueSoonPct.toFixed(1) + '%; min-width: ' + (dueSoonPct > 5 ? '0' : '20px') + '; color: #333;">' + (dueSoonPct > 8 ? dueSoonPct.toFixed(1) + '% Soon' : '') + '</div>';
                }
                if (overduePct > 0) {
                    html += '<div class="bg-danger d-flex align-items-center justify-content-center text-white" style="flex: 0 0 ' + overduePct.toFixed(1) + '%; min-width: ' + (overduePct > 5 ? '0' : '20px') + ';">' + (overduePct > 8 ? overduePct.toFixed(1) + '% Overdue' : '') + '</div>';
                }
                html += '</div></div>';
            }
            
            if (vendors.length === 0) {
                html += '<div class="alert alert-info"><i class="fas fa-info-circle mr-2"></i>No vendor transactions with due dates found for analysis.</div>';
            } else {
                // Show count and pagination info
                html += '<div class="d-flex justify-content-between align-items-center mb-2">';
                html += '<span class="text-muted small">' + vendors.length + ' vendors total</span>';
                if (totalPages > 1) {
                    html += '<span class="text-muted small">Page ' + pag.page + ' of ' + totalPages + '</span>';
                }
                html += '</div>';
                
                html += '<div class="table-responsive"><table class="table table-sm table-hover vp-sortable-table vp-clickable-table" id="leakageTable">';
                html += '<thead class="thead-light"><tr>';
                html += '<th class="sortable" data-sort="name">Vendor <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right" data-sort="bills">Bills <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right" data-sort="notdue">Not Yet Due <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right" data-sort="soon">Due Soon <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right" data-sort="overdue">Overdue <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right" data-sort="amount">Overdue Amt <i class="fas fa-sort"></i></th>';
                html += '</tr></thead>';
                html += '<tbody>';
                
                pagedVendors.forEach(function(v) {
                    var overdueClass = v.overduePct > 30 ? 'danger' : v.overduePct > 10 ? 'warning' : 'success';
                    html += '<tr class="vp-clickable-row" onclick="VendorPerformanceController.drilldownVendor(' + v.vendorId + ', \'' + escapeHtml(v.vendorName).replace(/'/g, "\\'") + '\', \'payment\')">';
                    html += '<td><strong>' + escapeHtml(v.vendorName) + '</strong></td>';
                    html += '<td class="text-right">' + v.withDueDate + '</td>';
                    html += '<td class="text-right text-success">' + v.notDueCount + '</td>';
                    html += '<td class="text-right text-warning">' + v.dueSoonCount + '</td>';
                    html += '<td class="text-right text-' + overdueClass + '">' + v.overdueCount + '</td>';
                    html += '<td class="text-right text-danger">' + self.formatCurrency(v.overdueAmount || 0) + '</td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table></div>';
                
                // Pagination controls
                if (totalPages > 1) {
                    html += '<nav class="mt-3"><ul class="pagination pagination-sm justify-content-center mb-0">';
                    html += '<li class="page-item ' + (pag.page <= 1 ? 'disabled' : '') + '"><a class="page-link" href="#" onclick="VendorPerformanceController.renderLeakageTab(' + (pag.page - 1) + '); return false;">«</a></li>';
                    
                    var startPage = Math.max(1, pag.page - 2);
                    var endPage = Math.min(totalPages, startPage + 4);
                    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);
                    
                    for (var i = startPage; i <= endPage; i++) {
                        html += '<li class="page-item ' + (i === pag.page ? 'active' : '') + '"><a class="page-link" href="#" onclick="VendorPerformanceController.renderLeakageTab(' + i + '); return false;">' + i + '</a></li>';
                    }
                    
                    html += '<li class="page-item ' + (pag.page >= totalPages ? 'disabled' : '') + '"><a class="page-link" href="#" onclick="VendorPerformanceController.renderLeakageTab(' + (pag.page + 1) + '); return false;">»</a></li>';
                    html += '</ul></nav>';
                }
            }
            
            container.innerHTML = html;
            this.initSortableTable('leakageTable');
        },
        
        // ==========================================
        // LEVERAGE MATRIX TAB (Bubble Chart)
        // ==========================================
        
        renderMatrixTab: function() {
            var container = el('#vpMatrixContent');
            if (!container || !this.latestData) return;
            
            var lm = this.latestData.results.leverageMatrix || {};
            var counts = lm.quadrantCounts || {};
            var bubbleData = lm.bubbleData || [];
            
            var html = '<h6 class="mb-3"><i class="fas fa-th-large mr-2 text-primary"></i>Vendor Positioning Matrix</h6>';
            html += '<p class="text-muted mb-3">Interactive bubble chart showing vendor positioning by spend (X) and performance score (Y). Bubble size indicates spend volume.</p>';
            
            // Quadrant summary - simplified cards to prevent overflow
            html += '<div class="row mb-4">';
            html += '<div class="col-6 col-md-3 mb-2"><div class="card h-100 border-left-success" style="border-left:3px solid #10b981;">' +
                '<div class="card-body py-2 px-3">' +
                '<div class="text-muted small">Strategic</div>' +
                '<div class="h4 mb-0 text-success">' + (counts.strategic || 0) + '</div>' +
                '<div class="small text-muted">High $, High Score</div>' +
                '</div></div></div>';
            html += '<div class="col-6 col-md-3 mb-2"><div class="card h-100" style="border-left:3px solid #3b82f6;">' +
                '<div class="card-body py-2 px-3">' +
                '<div class="text-muted small">Niche</div>' +
                '<div class="h4 mb-0 text-primary">' + (counts.niche || 0) + '</div>' +
                '<div class="small text-muted">Low $, High Score</div>' +
                '</div></div></div>';
            html += '<div class="col-6 col-md-3 mb-2"><div class="card h-100" style="border-left:3px solid #ef4444;">' +
                '<div class="card-body py-2 px-3">' +
                '<div class="text-muted small">Review</div>' +
                '<div class="h4 mb-0 text-danger">' + (counts.commodity || 0) + '</div>' +
                '<div class="small text-muted">High $, Low Score</div>' +
                '</div></div></div>';
            html += '<div class="col-6 col-md-3 mb-2"><div class="card h-100" style="border-left:3px solid #9ca3af;">' +
                '<div class="card-body py-2 px-3">' +
                '<div class="text-muted small">Transactional</div>' +
                '<div class="h4 mb-0 text-secondary">' + (counts.transactional || 0) + '</div>' +
                '<div class="small text-muted">Low $, Low Score</div>' +
                '</div></div></div>';
            html += '</div>';
            
            html += '<div id="vpFullBubbleChart" style="height: 450px;"></div>';
            
            container.innerHTML = html;
            
            // Render full bubble chart
            this.renderFullBubbleChart();
        },
        
        renderFullBubbleChart: function() {
            var container = el('#vpFullBubbleChart');
            if (!container || !this.latestData || typeof Plotly === 'undefined') {
                if (container) container.innerHTML = '<p class="text-muted text-center pt-5">Plotly library required for interactive chart</p>';
                return;
            }
            
            var bubbleData = this.latestData.results.leverageMatrix?.bubbleData || [];
            if (bubbleData.length === 0) {
                container.innerHTML = '<p class="text-muted text-center pt-5">No vendor data available for matrix visualization</p>';
                return;
            }
            
            var self = this;
            
            // Group by quadrant for different colors
            var strategic = bubbleData.filter(function(d) { return d.quadrant === 'strategic'; });
            var niche = bubbleData.filter(function(d) { return d.quadrant === 'niche'; });
            var commodity = bubbleData.filter(function(d) { return d.quadrant === 'commodity'; });
            var transactional = bubbleData.filter(function(d) { return d.quadrant === 'transactional'; });
            
            function makeTrace(data, name, color) {
                return {
                    x: data.map(function(d) { return d.x; }),
                    y: data.map(function(d) { return d.y; }),
                    mode: 'markers',
                    name: name,
                    marker: {
                        size: data.map(function(d) { return d.r; }),
                        color: color,
                        opacity: 0.7,
                        line: { width: 1, color: '#fff' }
                    },
                    text: data.map(function(d) { return d.vendorName + '<br>$' + self.formatNumber(d.totalSpend); }),
                    hovertemplate: '<b>%{text}</b><br>Spend Share: %{x:.1f}%<br>Performance: %{y}<extra></extra>'
                };
            }
            
            var traces = [
                makeTrace(strategic, 'Strategic', '#10b981'),
                makeTrace(commodity, 'Review', '#ef4444'),
                makeTrace(niche, 'Niche', '#3b82f6'),
                makeTrace(transactional, 'Transactional', '#9ca3af')
            ];
            
            // Calculate data bounds to auto-zoom to where data is
            var allX = bubbleData.map(function(d) { return d.x; });
            var allY = bubbleData.map(function(d) { return d.y; });
            var maxDataX = Math.max.apply(null, allX);
            var minDataY = Math.min.apply(null, allY);
            var maxDataY = Math.max.apply(null, allY);
            
            // Add padding around the data (20% padding)
            var xPadding = Math.max(5, maxDataX * 0.2);
            var yPadding = Math.max(10, (maxDataY - minDataY) * 0.2);
            
            // Set ranges based on actual data distribution
            var maxX = Math.max(15, maxDataX + xPadding);
            var minY = Math.max(0, minDataY - yPadding);
            var maxY = Math.min(105, maxDataY + yPadding);
            
            // Ensure we don't cut off any data and keep reasonable bounds
            maxX = Math.min(100, maxX); // Never exceed 100% 
            if (maxY - minY < 40) {
                // Ensure minimum vertical range of 40 for readability
                var midY = (maxY + minY) / 2;
                minY = Math.max(0, midY - 25);
                maxY = Math.min(105, midY + 25);
            }
            
            var layout = {
                showlegend: true,
                legend: { orientation: 'h', y: -0.15 },
                margin: { t: 20, r: 20, b: 60, l: 50 },
                xaxis: { 
                    title: 'Spend Share (%)', 
                    range: [0, maxX],
                    gridcolor: '#f0f0f0'
                },
                yaxis: { 
                    title: 'Performance Score', 
                    range: [minY, maxY],
                    gridcolor: '#f0f0f0'
                },
                shapes: [
                    // Horizontal line at 75 (performance threshold) - only show if in range
                    { type: 'line', x0: 0, x1: maxX, y0: 75, y1: 75, line: { color: '#cbd5e1', width: 2, dash: 'dash' }, visible: (minY <= 75 && maxY >= 75) },
                    // Vertical line at high spend threshold - only show if in range
                    { type: 'line', x0: 10, x1: 10, y0: minY, y1: maxY, line: { color: '#cbd5e1', width: 2, dash: 'dash' }, visible: (maxX >= 10) }
                ],
                annotations: [
                    { x: maxX * 0.7, y: Math.min(95, maxY - 5), text: 'STRATEGIC', showarrow: false, font: { size: 12, color: '#10b981', weight: 'bold' }, visible: (maxY >= 80) },
                    { x: maxX * 0.7, y: Math.max(30, minY + 10), text: 'REVIEW/REPLACE', showarrow: false, font: { size: 12, color: '#ef4444', weight: 'bold' }, visible: (minY <= 50) },
                    { x: 3, y: Math.min(95, maxY - 5), text: 'NICHE', showarrow: false, font: { size: 12, color: '#3b82f6', weight: 'bold' }, visible: (maxY >= 80) },
                    { x: 3, y: Math.max(30, minY + 10), text: 'TRANSACTIONAL', showarrow: false, font: { size: 12, color: '#9ca3af', weight: 'bold' }, visible: (minY <= 50) }
                ]
            };
            
            Plotly.newPlot(container, traces, layout, { responsive: true });
        },
        
        // ==========================================
        // VENDOR SCORECARD TAB
        // FIX: Dynamic weights in headers instead of hardcoded values
        // FIX: Fallback weights match backend defaults (35/25/25/15)
        // ==========================================
        
        renderScorecardTab: function(page) {
            var container = el('#vpScorecardContent');
            if (!container || !this.latestData) return;
            
            var scorecard = this.latestData.results.vendorScorecard || [];
            // FIX: Use backend default weights as fallback (35/25/25/15) instead of (40/30/20/10)
            var weights = this.latestData.results.summary?.weights || { otif: 35, ppv: 25, maverick: 25, terms: 15 };
            var self = this;
            
            // Pagination setup
            var pag = this.tabPagination.scorecard;
            if (typeof page === 'number') pag.page = page;
            var perPage = pag.perPage;
            var totalPages = Math.ceil(scorecard.length / perPage);
            if (pag.page > totalPages) pag.page = Math.max(1, totalPages);
            var startIdx = (pag.page - 1) * perPage;
            var pagedScorecard = scorecard.slice(startIdx, startIdx + perPage);
            
            var html = '<h6 class="mb-3"><i class="fas fa-clipboard-list mr-2 text-info"></i>Vendor Scorecard (FICO-Style)</h6>';
            html += '<p class="text-muted mb-3">Weighted score: OTIF ' + weights.otif + '% | Pricing ' + weights.ppv + '% | PO Compliance ' + weights.maverick + '% | Terms ' + weights.terms + '%</p>';
            
            // Grade legend
            html += '<div class="mb-3 d-flex flex-wrap" style="gap: 15px;">';
            html += '<span><span class="badge badge-success" style="width: 24px;">A</span> 90+</span>';
            html += '<span><span class="badge badge-primary" style="width: 24px;">B</span> 80-89</span>';
            html += '<span><span class="badge badge-warning" style="width: 24px;">C</span> 70-79</span>';
            html += '<span><span class="badge badge-secondary" style="width: 24px;">D</span> 60-69</span>';
            html += '<span><span class="badge badge-danger" style="width: 24px;">F</span> &lt;60</span>';
            html += '</div>';
            
            if (scorecard.length === 0) {
                html += '<div class="alert alert-info">No vendor data available for scorecard.</div>';
            } else {
                // Show count and pagination info
                html += '<div class="d-flex justify-content-between align-items-center mb-2">';
                html += '<span class="text-muted small">' + scorecard.length + ' vendors scored</span>';
                if (totalPages > 1) {
                    html += '<span class="text-muted small">Page ' + pag.page + ' of ' + totalPages + '</span>';
                }
                html += '</div>';
                
                html += '<div class="table-responsive"><table class="table table-sm table-hover vp-sortable-table vp-clickable-table" id="scorecardTable">';
                html += '<thead class="thead-light"><tr>';
                html += '<th class="sortable">Vendor <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-right">Spend <i class="fas fa-sort"></i></th>';
                // FIX: Use dynamic weights from config instead of hardcoded values
                html += '<th class="sortable text-center">OTIF<br><small>' + weights.otif + '%</small> <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-center">Pricing<br><small>' + weights.ppv + '%</small> <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-center">PO Comp<br><small>' + weights.maverick + '%</small> <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-center">Terms<br><small>' + weights.terms + '%</small> <i class="fas fa-sort"></i></th>';
                html += '<th class="sortable text-center">Score <i class="fas fa-sort"></i></th>';
                html += '<th class="text-center">Grade</th>';
                html += '<th>Action</th>';
                html += '</tr></thead>';
                html += '<tbody>';
                
                pagedScorecard.forEach(function(v) {
                    var gradeColors = { 'A': 'success', 'B': 'primary', 'C': 'warning', 'D': 'secondary', 'F': 'danger' };
                    var gradeClass = gradeColors[v.grade] || 'secondary';
                    var actionClass = v.recommendation === 'strategic' ? 'success' : v.recommendation === 'replace' ? 'danger' : v.recommendation === 'review' ? 'warning' : 'secondary';
                    
                    html += '<tr class="vp-clickable-row" onclick="VendorPerformanceController.drilldownVendor(' + v.vendorId + ', \'' + escapeHtml(v.vendorName).replace(/'/g, "\\'") + '\', \'scorecard\')">';
                    html += '<td><strong>' + escapeHtml(v.vendorName) + '</strong></td>';
                    html += '<td class="text-right">' + self.formatCurrency(v.totalSpend) + '</td>';
                    html += '<td class="text-center">' + self.renderScoreBadge(v.otifScore) + '</td>';
                    html += '<td class="text-center">' + self.renderScoreBadge(v.ppvScore) + '</td>';
                    html += '<td class="text-center">' + self.renderScoreBadge(v.maverickScore) + '</td>';
                    html += '<td class="text-center">' + self.renderScoreBadge(v.termsScore) + '</td>';
                    html += '<td class="text-center"><strong>' + v.overallScore + '</strong></td>';
                    html += '<td class="text-center"><span class="badge badge-' + gradeClass + '" style="font-size: 1rem; min-width: 28px;">' + v.grade + '</span></td>';
                    html += '<td><span class="badge badge-' + actionClass + '">' + v.recommendation + '</span></td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table></div>';
                
                // Pagination controls
                if (totalPages > 1) {
                    html += this.renderTabPagination('scorecard', pag.page, totalPages);
                }
            }
            
            container.innerHTML = html;
            this.initSortableTable('scorecardTable');
        },
        
        renderScoreBadge: function(score) {
            if (score === null || score === undefined) return '<span class="text-muted">-</span>';
            var color = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger';
            return '<span class="badge badge-' + color + '" style="min-width: 35px;">' + Math.round(score) + '</span>';
        },
        
        // ==========================================
        // UTILITY FUNCTIONS
        // ==========================================
        
        // Shared pagination renderer for tabs
        renderTabPagination: function(tabName, currentPage, totalPages) {
            var html = '<nav class="mt-3"><ul class="pagination pagination-sm justify-content-center mb-0">';
            html += '<li class="page-item ' + (currentPage <= 1 ? 'disabled' : '') + '"><a class="page-link" href="#" onclick="VendorPerformanceController.render' + this.capitalizeFirst(tabName) + 'Tab(' + (currentPage - 1) + '); return false;">«</a></li>';
            
            var startPage = Math.max(1, currentPage - 2);
            var endPage = Math.min(totalPages, startPage + 4);
            if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);
            
            for (var i = startPage; i <= endPage; i++) {
                html += '<li class="page-item ' + (i === currentPage ? 'active' : '') + '"><a class="page-link" href="#" onclick="VendorPerformanceController.render' + this.capitalizeFirst(tabName) + 'Tab(' + i + '); return false;">' + i + '</a></li>';
            }
            
            html += '<li class="page-item ' + (currentPage >= totalPages ? 'disabled' : '') + '"><a class="page-link" href="#" onclick="VendorPerformanceController.render' + this.capitalizeFirst(tabName) + 'Tab(' + (currentPage + 1) + '); return false;">»</a></li>';
            html += '</ul></nav>';
            return html;
        },
        
        capitalizeFirst: function(str) {
            // Convert tab names to method name format: maverick -> Maverick, otif -> OTIF, ppv -> PPV, leadtime -> LeadTime
            var map = { 'maverick': 'Maverick', 'otif': 'OTIF', 'ppv': 'PPV', 'leakage': 'Leakage', 'scorecard': 'Scorecard', 'leadtime': 'LeadTime' };
            return map[str] || str.charAt(0).toUpperCase() + str.slice(1);
        },
        
        formatCurrency: function(num) {
            var cs = this.currencySymbol || '$';
            if (num === null || num === undefined) return cs + ' --';
            if (num >= 1000000) return cs + ' ' + (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return cs + ' ' + (num / 1000).toFixed(1) + 'K';
            return cs + ' ' + Math.round(num).toLocaleString();
        },
        
        formatNumber: function(num) {
            if (num === null || num === undefined) return '--';
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return Math.round(num).toLocaleString();
        },
        
        initSortableTable: function(tableId) {
            var table = el('#' + tableId);
            if (!table) return;
            
            var headers = table.querySelectorAll('th.sortable');
            var tbody = table.querySelector('tbody');
            if (!headers.length || !tbody) return;
            
            headers.forEach(function(header, colIndex) {
                header.style.cursor = 'pointer';
                header.addEventListener('click', function() {
                    var rows = Array.from(tbody.querySelectorAll('tr'));
                    var isAsc = header.classList.contains('sort-asc');
                    
                    // Reset all headers
                    headers.forEach(function(h) { 
                        h.classList.remove('sort-asc', 'sort-desc');
                        var icon = h.querySelector('i');
                        if (icon) icon.className = 'fas fa-sort';
                    });
                    
                    // Sort rows
                    rows.sort(function(a, b) {
                        var aVal = a.cells[colIndex].textContent.trim();
                        var bVal = b.cells[colIndex].textContent.trim();
                        
                        // Try numeric comparison first
                        var aNum = parseFloat(aVal.replace(/[^0-9.-]/g, ''));
                        var bNum = parseFloat(bVal.replace(/[^0-9.-]/g, ''));
                        
                        if (!isNaN(aNum) && !isNaN(bNum)) {
                            return isAsc ? bNum - aNum : aNum - bNum;
                        }
                        
                        // String comparison
                        return isAsc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
                    });
                    
                    // Update header state
                    header.classList.add(isAsc ? 'sort-desc' : 'sort-asc');
                    var icon = header.querySelector('i');
                    if (icon) icon.className = 'fas fa-sort-' + (isAsc ? 'down' : 'up');
                    
                    // Re-append sorted rows
                    rows.forEach(function(row) { tbody.appendChild(row); });
                });
            });
        },
        
        renderError: function(message) {
            var container = el('#vpOverviewContent');
            if (container) {
                container.innerHTML = ErrorBoundary.renderError(new Error(message), {
                    title: 'Vendor Performance Error',
                    retryAction: 'VendorPerformanceController.loadData()'
                });
            }
        },
        
        // === CONFIGURATION TAB ===
        renderConfigTab: function() {
            var container = el('#vpConfigContent');
            if (!container) return;
            
            var cfg = this.configData || {};
            var vendors = this.vendors || [];
            var excludedVendorIds = cfg.excludedVendorIds || [];
            
            container.innerHTML = 
                '<div class="p-4">' +
                    '<div class="row">' +
                        // Left Column - Scoring Weights
                        '<div class="col-lg-6">' +
                            '<div class="card shadow-sm mb-4">' +
                                '<div class="card-header bg-white py-2">' +
                                    '<h6 class="mb-0"><i class="fas fa-balance-scale mr-2 text-primary"></i>Scorecard Weights</h6>' +
                                '</div>' +
                                '<div class="card-body">' +
                                    '<p class="small text-muted mb-3">Adjust how each factor contributes to the vendor score. Weights must sum to 100%.</p>' +
                                    '<div class="row">' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">OTIF (On-Time In-Full)</label>' +
                                            '<div class="input-group">' +
                                                '<input type="number" class="form-control" id="cfgWeightOTIF" value="' + (cfg.weightOTIF || 35) + '" min="0" max="100">' +
                                                '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">PPV (Price Variance)</label>' +
                                            '<div class="input-group">' +
                                                '<input type="number" class="form-control" id="cfgWeightPPV" value="' + (cfg.weightPPV || 25) + '" min="0" max="100">' +
                                                '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">Maverick Compliance</label>' +
                                            '<div class="input-group">' +
                                                '<input type="number" class="form-control" id="cfgWeightMaverick" value="' + (cfg.weightMaverick || 25) + '" min="0" max="100">' +
                                                '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">Payment Terms</label>' +
                                            '<div class="input-group">' +
                                                '<input type="number" class="form-control" id="cfgWeightTerms" value="' + (cfg.weightTerms || 15) + '" min="0" max="100">' +
                                                '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                    '<div id="weightSumAlert" class="alert alert-warning small py-2 d-none">' +
                                        '<i class="fas fa-exclamation-triangle mr-1"></i>Weights must sum to 100%' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Thresholds Card
                            '<div class="card shadow-sm mb-4">' +
                                '<div class="card-header bg-white py-2">' +
                                    '<h6 class="mb-0"><i class="fas fa-sliders-h mr-2 text-primary"></i>Alert Thresholds</h6>' +
                                '</div>' +
                                '<div class="card-body">' +
                                    '<div class="row">' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">Maverick Warning (%)</label>' +
                                            '<input type="number" class="form-control" id="cfgMaverickWarning" value="' + (cfg.maverickWarningPct || 25) + '" min="0" max="100">' +
                                            '<small class="text-muted">Yellow alert threshold</small>' +
                                        '</div>' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">Maverick Critical (%)</label>' +
                                            '<input type="number" class="form-control" id="cfgMaverickCritical" value="' + (cfg.maverickCriticalPct || 50) + '" min="0" max="100">' +
                                            '<small class="text-muted">Red alert threshold</small>' +
                                        '</div>' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">PPV Variance Threshold (%)</label>' +
                                            '<input type="number" class="form-control" id="cfgPPVThreshold" value="' + (cfg.ppvVarianceThreshold || 10) + '" min="0" max="100">' +
                                            '<small class="text-muted">Flag items with variance above this</small>' +
                                        '</div>' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">On-Time Window (days)</label>' +
                                            '<input type="number" class="form-control" id="cfgOnTimeWindow" value="' + (cfg.onTimeWindowDays || 3) + '" min="0" max="30">' +
                                            '<small class="text-muted">Days early/late still considered on-time</small>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        
                        // Right Column - Matrix & Display
                        '<div class="col-lg-6">' +
                            '<div class="card shadow-sm mb-4">' +
                                '<div class="card-header bg-white py-2">' +
                                    '<h6 class="mb-0"><i class="fas fa-th-large mr-2 text-primary"></i>Leverage Matrix</h6>' +
                                '</div>' +
                                '<div class="card-body">' +
                                    '<div class="row">' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">High Spend Threshold (%)</label>' +
                                            '<input type="number" class="form-control" id="cfgHighSpend" value="' + (cfg.highSpendThreshold || 80) + '" min="50" max="99">' +
                                            '<small class="text-muted">Top X% of spend = strategic</small>' +
                                        '</div>' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">High Performance Score</label>' +
                                            '<input type="number" class="form-control" id="cfgHighPerformance" value="' + (cfg.highPerformanceThreshold || 75) + '" min="50" max="100">' +
                                            '<small class="text-muted">Score >= X = high performer</small>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Concentration Risk Card
                            '<div class="card shadow-sm mb-4">' +
                                '<div class="card-header bg-white py-2">' +
                                    '<h6 class="mb-0"><i class="fas fa-chart-pie mr-2 text-primary"></i>Concentration Risk (HHI)</h6>' +
                                '</div>' +
                                '<div class="card-body">' +
                                    '<p class="small text-muted mb-2">Herfindahl-Hirschman Index thresholds for supply concentration</p>' +
                                    '<div class="row">' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">Warning (Moderate)</label>' +
                                            '<input type="number" class="form-control" id="cfgHHIWarning" value="' + (cfg.hhiWarningThreshold || 1500) + '" min="0" max="10000">' +
                                        '</div>' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">Critical (High)</label>' +
                                            '<input type="number" class="form-control" id="cfgHHICritical" value="' + (cfg.hhiCriticalThreshold || 2500) + '" min="0" max="10000">' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Display Options Card
                            '<div class="card shadow-sm mb-4">' +
                                '<div class="card-header bg-white py-2">' +
                                    '<h6 class="mb-0"><i class="fas fa-eye mr-2 text-primary"></i>Display Options</h6>' +
                                '</div>' +
                                '<div class="card-body">' +
                                    '<div class="row">' +
                                        '<div class="col-md-6 mb-3">' +
                                            '<label class="small font-weight-bold">Top Vendors to Show</label>' +
                                            '<input type="number" class="form-control" id="cfgTopVendors" value="' + (cfg.topVendorsCount || 20) + '" min="5" max="100">' +
                                        '</div>' +
                                        '<div class="col-md-6 mb-3 d-flex align-items-end">' +
                                            '<div class="custom-control custom-switch">' +
                                                '<input type="checkbox" class="custom-control-input" id="cfgShowInactive" ' + (cfg.showInactiveVendors ? 'checked' : '') + '>' +
                                                '<label class="custom-control-label" for="cfgShowInactive">Show Inactive Vendors</label>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    // Save Button
                    '<div class="text-center mt-3 mb-4">' +
                        '<button class="btn btn-primary shadow-sm px-4" onclick="VendorPerformanceController.saveConfig()">' +
                            '<i class="fas fa-save mr-2"></i>Save Configuration' +
                        '</button>' +
                    '</div>' +
                '</div>';
            
            // Add weight validation
            var weightInputs = ['cfgWeightOTIF', 'cfgWeightPPV', 'cfgWeightMaverick', 'cfgWeightTerms'];
            var self = this;
            weightInputs.forEach(function(id) {
                var input = el('#' + id);
                if (input) {
                    input.addEventListener('change', function() { self.validateWeights(); });
                }
            });
        },
        
        validateWeights: function() {
            var otif = parseInt(el('#cfgWeightOTIF').value) || 0;
            var ppv = parseInt(el('#cfgWeightPPV').value) || 0;
            var maverick = parseInt(el('#cfgWeightMaverick').value) || 0;
            var terms = parseInt(el('#cfgWeightTerms').value) || 0;
            var sum = otif + ppv + maverick + terms;
            
            var alert = el('#weightSumAlert');
            if (alert) {
                if (sum !== 100) {
                    alert.classList.remove('d-none');
                    alert.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>Weights sum to ' + sum + '% (must be 100%)';
                } else {
                    alert.classList.add('d-none');
                }
            }
            return sum === 100;
        },
        
        saveConfig: async function() {
            // Validate weights
            if (!this.validateWeights()) {
                showToast('Weights must sum to 100%', 'error');
                return;
            }
            
            var configToSave = {
                // Weights
                weightOTIF: parseInt(el('#cfgWeightOTIF').value) || 35,
                weightPPV: parseInt(el('#cfgWeightPPV').value) || 25,
                weightMaverick: parseInt(el('#cfgWeightMaverick').value) || 25,
                weightTerms: parseInt(el('#cfgWeightTerms').value) || 15,
                // Thresholds
                maverickWarningPct: parseInt(el('#cfgMaverickWarning').value) || 25,
                maverickCriticalPct: parseInt(el('#cfgMaverickCritical').value) || 50,
                ppvVarianceThreshold: parseInt(el('#cfgPPVThreshold').value) || 10,
                onTimeWindowDays: parseInt(el('#cfgOnTimeWindow').value) || 3,
                // Leverage Matrix
                highSpendThreshold: parseInt(el('#cfgHighSpend').value) || 80,
                highPerformanceThreshold: parseInt(el('#cfgHighPerformance').value) || 75,
                // Concentration Risk
                hhiWarningThreshold: parseInt(el('#cfgHHIWarning').value) || 1500,
                hhiCriticalThreshold: parseInt(el('#cfgHHICritical').value) || 2500,
                // Display Options
                topVendorsCount: parseInt(el('#cfgTopVendors').value) || 20,
                showInactiveVendors: el('#cfgShowInactive') ? el('#cfgShowInactive').checked : false,
                excludedVendorIds: this.configData.excludedVendorIds || []
            };
            
            try {
                var res = await API.post('save_vendor_performance_config', configToSave);
                if (res.status === 'success') {
                    showToast('Configuration saved!');
                    this.configData = configToSave;
                    // Reload data with new config
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
        // DRILLDOWN / FLYOUT PANEL
        // ==========================================
        
        drilldownVendor: async function(vendorId, vendorName, context) {
            var self = this;
            this.drilldown = { active: true, type: 'vendor', id: vendorId, name: vendorName, context: context };
            
            var panel = el('#vpDrilldownPanel');
            var title = el('#vpDrilldownTitle');
            var body = el('#vpDrilldownBody');
            
            var contextLabel = context === 'maverick' ? 'Maverick Bills' : 
                              context === 'otif' ? 'Delivery Performance' :
                              context === 'leadtime' ? 'Lead Time Analysis' :
                              context === 'ppv' ? 'Price Variance' :
                              context === 'payment' ? 'Payment Status' :
                              context === 'scorecard' ? 'All Transactions' : 'Transactions';
            
            title.innerHTML = '<i class="fas fa-search-dollar mr-2"></i>' + escapeHtml(vendorName) + ' — ' + contextLabel;
            body.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading transactions...</div></div>';
            panel.style.display = 'flex';
            
            try {
                // Build request params - do not include redundant 'action' property
                var params = {
                    subAction: 'vendor_transactions',
                    vendorId: parseInt(vendorId),
                    context: context,
                    startDate: el('#vpStartDate').value || '',
                    endDate: el('#vpEndDate').value || '',
                    subsidiaryId: el('#vpSubsidiary').value || ''
                };
                var res = await API.post('vendor_performance', params);
                if (res.status === 'success' && res.transactions && res.transactions.length > 0) {
                    this.renderDrilldownContent(res.transactions, vendorName, context);
                } else {
                    body.innerHTML = '<div class="text-center py-5 text-muted"><i class="fas fa-inbox fa-2x mb-2"></i><div>No transactions found for this vendor in the selected date range</div></div>';
                }
            } catch (e) {
                console.error('Drilldown error:', e);
                body.innerHTML = '<div class="alert alert-warning"><i class="fas fa-exclamation-triangle mr-2"></i>Unable to load transactions. Please try again.</div>';
            }
        },
        
        renderDrilldownContent: function(txns, entityName, context) {
            var body = el('#vpDrilldownBody');
            var self = this;
            
            var total = 0;
            txns.forEach(function(t) { total += Math.abs(t.amount || 0); });
            
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
                    monthlyTotals[month] = (monthlyTotals[month] || 0) + Math.abs(t.amount || 0);
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
                svgContent = svgContent
                    .replace(/<svg width="(\d+)" height="(\d+)"/, '<svg viewBox="0 0 $1 $2" preserveAspectRatio="none"');
                
                sparklineHtml = '<div class="vp-drilldown-sparkline mb-3" style="flex-shrink:0;">' +
                    '<div class="d-flex justify-content-between align-items-center mb-1">' +
                    '<span class="small text-muted"><i class="fas fa-chart-area mr-1"></i>Activity Over Period</span>' +
                    '<span class="small text-muted">' + sortedMonths[0] + ' → ' + sortedMonths[sortedMonths.length - 1] + '</span>' +
                    '</div>' +
                    '<div class="vp-sparkline-container">' + svgContent + '</div></div>';
            }
            
            // KPI cards using cf-kpi-card shared infrastructure
            var html = '<div class="cf-kpi-row row mb-3 gutters-sm" style="flex-shrink:0;">';
            html += '<div class="col-4"><div class="cf-kpi-card">' +
                '<div class="icon-wrapper bg-primary-soft"><i class="fas fa-receipt text-primary"></i></div>' +
                '<div class="kpi-content"><span class="kpi-label">Transactions</span>' +
                '<span class="kpi-value text-primary" id="vpDrilldownTxnCount">' + txns.length + '</span></div></div></div>';
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
            html += '<div class="vp-toolbar d-flex flex-wrap align-items-center mb-2" style="flex-shrink:0;gap:8px;">' +
                '<div class="input-group input-group-sm" style="width:200px;">' +
                '<div class="input-group-prepend"><span class="input-group-text"><i class="fas fa-search"></i></span></div>' +
                '<input type="text" class="form-control" id="vpDrilldownSearch" placeholder="Search..." oninput="VendorPerformanceController.searchDrilldown(this.value)">' +
                '</div>' +
                '<select class="form-control form-control-sm" style="width:160px;" id="vpDrilldownGroupBy" onchange="VendorPerformanceController.groupDrilldown(this.value)">' +
                '<option value="none">No grouping</option>' +
                '<option value="type">Group: Type</option>' +
                '<option value="month">Group: Month</option>' +
                '</select>' +
                '<div class="ml-auto d-flex align-items-center" style="gap:8px;">';
            if (txns.length >= 2000) {
                html += '<span class="badge badge-warning"><i class="fas fa-info-circle mr-1"></i>Max 2000</span>';
            }
            html += '<button class="btn btn-sm btn-outline-success" onclick="VendorPerformanceController.exportDrilldown()"><i class="fas fa-download"></i> CSV</button>' +
                '</div></div>';
            
            // Table container
            html += '<div class="table-responsive" id="vpDrilldownTableContainer"></div>';
            
            // Pagination
            html += '<div id="vpDrilldownPagination" class="mt-2" style="flex-shrink:0;"></div>';
            
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
            
            var countEl = el('#vpDrilldownTxnCount');
            if (countEl) countEl.textContent = txns.length;
            
            return txns;
        },
        
        renderDrilldownTable: function() {
            var container = el('#vpDrilldownTableContainer');
            var paginationContainer = el('#vpDrilldownPagination');
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
            
            var html = '<table class="table table-sm table-hover mb-0"><thead class="thead-light sticky-top"><tr>' +
                '<th class="vp-sortable" onclick="VendorPerformanceController.sortDrilldownCol(\'date\')">Date <i class="fas ' + dateIcon + ' ml-1"></i></th>' +
                '<th>Type</th><th>Document</th>' +
                '<th class="vp-sortable text-right" onclick="VendorPerformanceController.sortDrilldownCol(\'amount\')">Amount <i class="fas ' + amtIcon + ' ml-1"></i></th>' +
                '<th>Memo</th></tr></thead><tbody>';
            
            if (paged.length === 0) {
                html += '<tr><td colspan="5" class="text-center text-muted py-4">No transactions found</td></tr>';
            } else {
                paged.forEach(function(t) {
                    var typeClass = t.type === 'VendBill' ? 'badge-primary' : t.type === 'VendCred' ? 'badge-info' : 'badge-secondary';
                    var typeLabel = t.type === 'VendBill' ? 'Bill' : t.type === 'VendCred' ? 'Credit' : t.type;
                    var memoText = (t.memo || '').length > 40 ? t.memo.substring(0, 40) + '...' : (t.memo || '--');
                    html += '<tr><td>' + (t.date || '--') + '</td>' +
                        '<td><span class="badge ' + typeClass + '">' + typeLabel + '</span></td>' +
                        '<td><a href="#" onclick="VendorPerformanceController.openRecord(\'' + t.type + '\', ' + t.id + '); return false;">' + escapeHtml(t.tranId || '#' + t.id) + '</a></td>' +
                        '<td class="text-right font-weight-bold">' + self.formatCurrency(t.amount) + '</td>' +
                        '<td class="small text-muted" title="' + escapeHtml(t.memo || '') + '">' + escapeHtml(memoText) + '</td></tr>';
                });
            }
            html += '</tbody></table>';
            container.innerHTML = html;
            
            // Render pagination
            if (totalPages > 1) {
                var pagHtml = '<nav><ul class="pagination pagination-sm justify-content-center mb-0">';
                pagHtml += '<li class="page-item ' + (pag.page <= 1 ? 'disabled' : '') + '"><a class="page-link" href="#" onclick="VendorPerformanceController.changeDrilldownPage(' + (pag.page - 1) + '); return false;">«</a></li>';
                
                var startPage = Math.max(1, pag.page - 2);
                var endPage = Math.min(totalPages, startPage + 4);
                for (var i = startPage; i <= endPage; i++) {
                    pagHtml += '<li class="page-item ' + (i === pag.page ? 'active' : '') + '"><a class="page-link" href="#" onclick="VendorPerformanceController.changeDrilldownPage(' + i + '); return false;">' + i + '</a></li>';
                }
                
                pagHtml += '<li class="page-item ' + (pag.page >= totalPages ? 'disabled' : '') + '"><a class="page-link" href="#" onclick="VendorPerformanceController.changeDrilldownPage(' + (pag.page + 1) + '); return false;">»</a></li>';
                pagHtml += '</ul></nav>';
                paginationContainer.innerHTML = pagHtml;
            } else {
                paginationContainer.innerHTML = '<div class="text-center small text-muted">' + sorted.length + ' transactions</div>';
            }
        },
        
        renderGroupedDrilldownTable: function(txns, groupBy) {
            var container = el('#vpDrilldownTableContainer');
            var paginationContainer = el('#vpDrilldownPagination');
            var self = this;
            
            var groups = {};
            txns.forEach(function(t) {
                var key;
                switch (groupBy) {
                    case 'type': key = t.type || 'Unknown'; break;
                    case 'month': key = (t.date || '').substring(0, 7) || 'Unknown'; break;
                    default: key = 'All';
                }
                if (!groups[key]) groups[key] = { txns: [], total: 0 };
                groups[key].txns.push(t);
                groups[key].total += Math.abs(t.amount || 0);
            });
            
            var sortedKeys = Object.keys(groups).sort(function(a, b) { return groups[b].total - groups[a].total; });
            
            var html = '<table class="table table-sm mb-0"><thead class="thead-light sticky-top"><tr>' +
                '<th>' + (groupBy === 'type' ? 'Type' : 'Month') + '</th>' +
                '<th class="text-right">Transactions</th>' +
                '<th class="text-right">Total Amount</th>' +
                '<th class="text-right">Avg per Txn</th>' +
                '</tr></thead><tbody>';
            
            sortedKeys.forEach(function(key) {
                var g = groups[key];
                var typeLabel = key === 'VendBill' ? 'Bill' : key === 'VendCred' ? 'Credit' : key;
                html += '<tr>' +
                    '<td><strong>' + escapeHtml(typeLabel) + '</strong></td>' +
                    '<td class="text-right">' + g.txns.length + '</td>' +
                    '<td class="text-right font-weight-bold">' + self.formatCurrency(g.total) + '</td>' +
                    '<td class="text-right text-muted">' + self.formatCurrency(g.total / g.txns.length) + '</td>' +
                    '</tr>';
            });
            
            html += '</tbody></table>';
            container.innerHTML = html;
            paginationContainer.innerHTML = '<div class="text-center small text-muted mt-1">' + sortedKeys.length + ' groups, ' + txns.length + ' transactions</div>';
        },
        
        sortDrilldownCol: function(col) {
            var pag = this.drilldownPagination;
            if (pag.sortCol === col) {
                pag.sortDir = pag.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                pag.sortCol = col;
                pag.sortDir = 'desc';
            }
            this.renderDrilldownTable();
        },
        
        changeDrilldownPage: function(page) {
            this.drilldownPagination.page = page;
            this.renderDrilldownTable();
        },
        
        exportDrilldown: function() {
            var txns = this.drilldownData || [];
            if (txns.length === 0) return;
            
            var csv = 'Date,Type,Document,Amount,Memo\n';
            txns.forEach(function(t) {
                csv += '"' + (t.date || '') + '",' +
                    '"' + (t.type || '') + '",' +
                    '"' + (t.tranId || '') + '",' +
                    (t.amount || 0) + ',' +
                    '"' + (t.memo || '').replace(/"/g, '""') + '"\n';
            });
            
            var blob = new Blob([csv], { type: 'text/csv' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'vendor_transactions_' + (this.drilldown.name || 'export').replace(/[^a-z0-9]/gi, '_') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
            a.click();
            URL.revokeObjectURL(url);
        },
        
        // FIX: Corrected NetSuite record URL construction
        // NetSuite uses different URL patterns for different record types
        openRecord: function(type, id) {
            // Map transaction types to their correct NetSuite URL paths
            var typeToPath = {
                'VendBill': 'vendbill',
                'VendCred': 'vendcred',
                'VendPymt': 'vendpymt',
                'Check': 'check',
                'Bill': 'vendbill',
                'BillPmt': 'vendpymt',
                'PurchOrd': 'purchord',
                'ItemRcpt': 'itemrcpt',
                'ExpRept': 'exprept'
            };
            
            var path = typeToPath[type] || type.toLowerCase();
            var url = '/app/accounting/transactions/' + path + '.nl?id=' + id;
            window.open(url, '_blank');
        },
        
        closeDrilldown: function() {
            this.drilldown = { active: false, type: null, id: null, name: null };
            el('#vpDrilldownPanel').style.display = 'none';
        }
    };
    
    // escapeHtml is now provided globally by Gantry.Core.js (window.escapeHtml)
    // Removed local duplicate - use the global version which includes single-quote escaping
    
    // Expose to global scope
    window.VendorPerformanceController = VendorPerformanceController;
    
    // Register route
    Router.register('vendorperformance', function() { VendorPerformanceController.init(); });
    
    console.log('[Dashboard.VendorPerformance] Procurement 5.2 Audit Fixes + Pagination Loaded');

})(window);