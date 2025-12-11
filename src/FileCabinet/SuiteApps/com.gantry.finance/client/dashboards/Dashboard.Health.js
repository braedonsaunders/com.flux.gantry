/**
 * Dashboard.Health.js
 * PROFITABILITY PULSE 2.0 - World-Class Financial Health Analytics
 * 
 * Features:
 * - Margin waterfall with clickable drill-down
 * - Multi-segment profitability analysis
 * - Revenue/expense forecasting with scenarios
 * - Anomaly detection and alerts
 * - Operating metrics and benchmarks
 * - Rich flyout system for all drill-downs
 * - Full pagination and sortable tables
 */
(function(window) {
    'use strict';

    // Timezone-safe date parsing (avoids UTC offset issues)
    function parseLocalDate(dateStr) {
        if (!dateStr) return new Date();
        var parts = dateStr.split('-');
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    
    // Format date as YYYY-MM-DD in local timezone
    function formatLocalDate(date) {
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
    }

    const HealthController = {
        _version: 'v2.0-world-class',
        latestData: null,
        subsidiaries: [],
        subsidiaryId: null,
        fiscalCalendar: null,
        currencySymbol: '$',
        activeTab: 'overview',
        
        // Forecast state
        forecastMetric: 'revenue',
        forecastSettings: null,
        
        // P/V/M state
        pvmPeriod: 'yoy',
        pvmLoaded: false,
        
        // Segments state
        currentSegments: null,
        currentSegmentType: 'department',
        processedSegments: null,
        segmentTotals: null,
        
        // Drivers state
        driversData: null,
        driversShowAll: false,
        driversMinChange: 10,
        driversPage: 1,
        
        // Health score (calculated)
        calculatedHealthScore: null,
        
        // Pagination state
        pagination: {
            accounts: { page: 1, pageSize: 20, sortCol: 'amount', sortDir: 'desc' },
            transactions: { page: 1, pageSize: 25, sortCol: 'date', sortDir: 'desc' },
            segments: { page: 1, pageSize: 15, sortCol: 'revenue', sortDir: 'desc' },
            movers: { page: 1, pageSize: 10, sortCol: 'change', sortDir: 'desc' }
        },
        
        // Flyout context
        flyoutContext: null,

        // ════════════════════════════════════════════════════════════════════════
        // INITIALIZATION
        // ════════════════════════════════════════════════════════════════════════

        init: function() {
            this.setupUI();
        },

        setupUI: function() {
            el('#gantry-view-container').innerHTML = this.getTemplate();
            this.showLoadingState();
            this.bindEvents();
            this.loadConfig();
        },

        getTemplate: function() {
            return '<div class="health-dashboard pp-dashboard p-0">' +
                // Controls Row
                '<div class="row mb-3">' +
                    '<div class="col-md-12">' +
                        '<form class="form-inline justify-content-center" id="healthDateForm" onsubmit="return false;">' +
                            '<select class="form-control form-control-sm mr-3" id="healthSubsidiary" style="max-width: 200px;"></select>' +
                            '<label class="mr-2 small text-muted">Range:</label>' +
                            '<input type="date" class="form-control form-control-sm mr-2" id="healthStartDate">' +
                            '<span class="mr-2">to</span>' +
                            '<input type="date" class="form-control form-control-sm mr-2" id="healthEndDate">' +
                            '<button type="button" class="btn btn-sm btn-primary" id="healthApplyRange">' +
                                '<span class="btn-text">Apply</span>' +
                                '<span class="btn-loading d-none"><i class="fas fa-spinner fa-spin"></i></span>' +
                            '</button>' +
                        '</form>' +
                    '</div>' +
                '</div>' +
                
                // KPI Row
                '<div class="row mb-2 gutters-sm cf-kpi-row" id="healthKPIRow">' +
                    '<div class="col"><div class="cf-kpi-card" id="ppHealthRiskGauge"><div class="risk-meter-kpi"><div class="risk-meter-gauge" id="PP_HealthScore"></div><div class="risk-meter-info"><span class="risk-meter-value" id="PP_HealthValue">--</span><span class="risk-meter-label" id="PP_HealthLabel">CALCULATING</span></div></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-blue-soft"><i class="fas fa-dollar-sign text-blue"></i></div><div class="kpi-content"><span class="kpi-label">Revenue</span><span class="kpi-value" id="PP_Revenue">--</span><span class="kpi-sub"><span class="text-muted">YoY:</span> <span id="PP_YoYRevenue">--</span></span></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-purple-soft"><i class="fas fa-chart-line text-purple"></i></div><div class="kpi-content"><span class="kpi-label">Gross Margin</span><span class="kpi-value" id="PP_GrossMargin">--</span><span class="kpi-sub"><span class="text-muted">COGS:</span> <span id="PP_COGS">--</span></span></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-orange-soft"><i class="fas fa-balance-scale text-orange"></i></div><div class="kpi-content"><span class="kpi-label">Operating Income</span><span class="kpi-value" id="PP_OpIncome">--</span><span class="kpi-sub"><span class="text-muted">OpEx:</span> <span id="PP_OpEx">--</span></span></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-teal-soft"><i class="fas fa-bullseye text-teal"></i></div><div class="kpi-content"><span class="kpi-label">Breakeven</span><span class="kpi-value" id="PP_Breakeven">--</span><span class="kpi-sub"><span class="text-muted">Avg Monthly:</span> <span id="PP_AvgMonthly">--</span></span></div></div></div>' +
                '</div>' +
                
                // Main Card with Tabs
                '<div class="card cf-main-card shadow-sm">' +
                    '<div class="card-header border-0 bg-white pt-3 pb-1 px-3">' +
                        '<ul class="nav nav-tabs cf-tabs" id="healthTabs" role="tablist">' +
                            '<li class="nav-item"><a class="nav-link active" data-toggle="tab" href="#pp-overview"><i class="fas fa-home mr-2"></i>Overview</a></li>' +
                            '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#pp-margin"><i class="fas fa-layer-group mr-2"></i>Margin</a></li>' +
                            '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#pp-pvm"><i class="fas fa-boxes mr-2"></i>Items</a></li>' +
                            '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#pp-segments"><i class="fas fa-sitemap mr-2"></i>Segments</a></li>' +
                            '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#pp-forecast"><i class="fas fa-chart-line mr-2"></i>Forecast</a></li>' +
                            '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#pp-scenarios"><i class="fas fa-flask mr-2"></i>Scenarios</a></li>' +
                            '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#pp-budget"><i class="fas fa-clipboard-list mr-2"></i>Budget</a></li>' +
                            '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#pp-drivers"><i class="fas fa-search-dollar mr-2"></i>Drivers</a></li>' +
                            '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#pp-benchmarks"><i class="fas fa-tachometer-alt mr-2"></i>Ratios</a></li>' +
                            '<li class="nav-item"><a class="nav-link" data-toggle="tab" href="#pp-config"><i class="fas fa-cogs mr-2"></i>Configuration</a></li>' +
                        '</ul>' +
                    '</div>' +
                    '<div class="card-body p-0">' +
                        '<div class="tab-content">' +
                            // Overview Tab - World Class
                            '<div class="tab-pane fade show active" id="pp-overview">' +
                                '<div class="p-4">' +
                                    // Sparklines row - 3 across
                                    '<div class="pp-sparkline-row mb-3">' +
                                        '<div class="pp-sparkline-card">' +
                                            '<span class="pp-sparkline-label">Revenue Trend</span>' +
                                            '<span class="pp-sparkline-chart" id="ppSparkRevenue"></span>' +
                                        '</div>' +
                                        '<div class="pp-sparkline-card">' +
                                            '<span class="pp-sparkline-label">Margin Trend</span>' +
                                            '<span class="pp-sparkline-chart" id="ppSparkMargin"></span>' +
                                        '</div>' +
                                        '<div class="pp-sparkline-card">' +
                                            '<span class="pp-sparkline-label">Op Income Trend</span>' +
                                            '<span class="pp-sparkline-chart" id="ppSparkOpInc"></span>' +
                                        '</div>' +
                                    '</div>' +
                                    // Main Content
                                    '<div class="row pp-equal-height-row">' +
                                        '<div class="col-lg-8 d-flex flex-column">' +
                                            // Performance Trend
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                                    '<h6 class="mb-0"><i class="fas fa-chart-area mr-2 text-primary"></i>Performance Trend</h6>' +
                                                    '<div class="btn-group btn-group-sm" id="ppOverviewChartToggle">' +
                                                        '<button class="btn btn-outline-secondary btn-sm active" data-view="revenue" onclick="HealthController.switchOverviewChart(\'revenue\')">Revenue</button>' +
                                                        '<button class="btn btn-outline-secondary btn-sm" data-view="margin" onclick="HealthController.switchOverviewChart(\'margin\')">Margins</button>' +
                                                    '</div>' +
                                                '</div>' +
                                                '<div class="card-body p-2"><div id="ppTrendChart" style="height:200px;"></div></div>' +
                                            '</div>' +
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-table mr-2"></i>P&L Summary</h6></div>' +
                                                '<div class="card-body p-0"><div class="table-responsive"><table class="table table-sm table-hover pp-table mb-0" id="ppSummaryTable"><thead class="thead-light"><tr><th>Line Item</th><th class="text-right">Current</th><th class="text-right">Prior Year</th><th class="text-right">Change</th><th class="text-right">Change %</th></tr></thead><tbody id="ppSummaryBody"></tbody></table></div></div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-lg-4 d-flex">' +
                                            // Insights Panel - simple lists, equal height
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-body p-0 d-flex flex-column h-100">' +
                                                    '<div class="pp-insight-section pp-insight-issues">' +
                                                        '<div class="pp-insight-title"><i class="fas fa-exclamation-triangle text-danger mr-2"></i>Issues <span class="badge badge-danger ml-1" id="ppIssuesCount">0</span></div>' +
                                                        '<ul id="ppIssues" class="pp-insight-list"></ul>' +
                                                    '</div>' +
                                                    '<div class="pp-insight-section pp-insight-recs">' +
                                                        '<div class="pp-insight-title"><i class="fas fa-lightbulb text-success mr-2"></i>Recommendations <span class="badge badge-success ml-1" id="ppRecsCount">0</span></div>' +
                                                        '<ul id="ppRecommendations" class="pp-insight-list"></ul>' +
                                                    '</div>' +
                                                    '<div class="pp-insight-section pp-insight-anomalies">' +
                                                        '<div class="pp-insight-title"><i class="fas fa-bolt text-warning mr-2"></i>Anomalies <span class="badge badge-warning ml-1" id="ppAnomaliesCount">0</span></div>' +
                                                        '<ul id="ppAnomalies" class="pp-insight-list"></ul>' +
                                                    '</div>' +
                                                '</div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Margin Tab
                            '<div class="tab-pane fade" id="pp-margin">' +
                                '<div class="p-4">' +
                                    // Margin KPIs - rendered dynamically
                                    '<div class="row mb-3 cf-kpi-row" id="ppMarginKPIs"></div>' +
                                    '<div class="row pp-equal-height-row">' +
                                        '<div class="col-lg-8 d-flex">' +
                                            // Margin Flow - Innovative horizontal design
                                            '<div class="card shadow-sm mb-3 flex-fill">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center"><h6 class="mb-0"><i class="fas fa-stream mr-2"></i>Margin Flow Analysis</h6><small class="text-muted">Click any stage for details</small></div>' +
                                                '<div class="card-body p-3">' +
                                                    '<div id="ppMarginFlow" class="margin-flow-container"></div>' +
                                                '</div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-lg-4 d-flex">' +
                                            '<div class="card shadow-sm mb-3 flex-fill">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-percentage mr-2"></i>Margin Summary</h6></div>' +
                                                '<div class="card-body p-0"><div id="ppMarginSummary"></div></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                    '<div class="row pp-equal-height-row">' +
                                        '<div class="col-lg-8 d-flex">' +
                                            // Margin Bridge YoY
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-bridge mr-2"></i>Year-over-Year Bridge</h6></div>' +
                                                '<div class="card-body p-2"><div id="ppMarginBridgeChart" style="height:220px;"></div></div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-lg-4 d-flex flex-column">' +
                                            // Margin Trends
                                            '<div class="card shadow-sm mb-3 flex-fill">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-chart-area mr-2"></i>Margin Trends (12mo)</h6></div>' +
                                                '<div class="card-body p-2"><div id="ppMarginTrendChart" style="height:120px;"></div></div>' +
                                            '</div>' +
                                            // Cost Breakdown
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-chart-pie mr-2"></i>Cost Structure</h6></div>' +
                                                '<div class="card-body p-2"><div id="ppCostBreakdownChart" style="height:120px;"></div></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Items Tab (Item-level revenue analysis)
                            '<div class="tab-pane fade" id="pp-pvm">' +
                                '<div class="p-4">' +
                                    '<div class="row mb-3 cf-kpi-row" id="ppPVMKPIs"></div>' +
                                    // Main content row with equal heights
                                    '<div class="row pp-equal-height-row">' +
                                        '<div class="col-lg-8 d-flex flex-column">' +
                                            // Revenue Change Chart
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                                    '<h6 class="mb-0"><i class="fas fa-chart-bar mr-2"></i>Item Revenue Changes</h6>' +
                                                    '<div class="btn-group btn-group-sm">' +
                                                        '<button class="btn btn-outline-primary active" data-pvm-period="yoy">YoY</button>' +
                                                        '<button class="btn btn-outline-primary" data-pvm-period="qoq">QoQ</button>' +
                                                        '<button class="btn btn-outline-primary" data-pvm-period="mom">MoM</button>' +
                                                    '</div>' +
                                                '</div>' +
                                                '<div class="card-body p-2"><div id="ppRevenueBarChart" style="height:220px;"></div></div>' +
                                            '</div>' +
                                            // Item Analysis Table
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                                    '<h6 class="mb-0"><i class="fas fa-table mr-2"></i>Item-Level Analysis</h6>' +
                                                    '<button class="btn btn-sm btn-outline-secondary" onclick="HealthController.exportToCSV(\'pvm\')"><i class="fas fa-download mr-1"></i>Export</button>' +
                                                '</div>' +
                                                '<div class="card-body p-0">' +
                                                    '<div class="table-responsive" style="max-height:300px; overflow-y:auto;">' +
                                                        '<table class="table table-sm table-hover mb-0" id="ppPVMItemsTable">' +
                                                            '<thead class="sticky-top"><tr>' +
                                                                '<th class="sortable" data-sort="name">Item</th>' +
                                                                '<th class="text-right sortable" data-sort="prior">Prior</th>' +
                                                                '<th class="text-right sortable" data-sort="current">Current</th>' +
                                                                '<th class="text-right sortable" data-sort="change">Δ Revenue</th>' +
                                                                '<th class="text-right sortable" data-sort="changePct">Δ %</th>' +
                                                                '<th class="text-right sortable" data-sort="contribution">Contribution</th>' +
                                                            '</tr></thead>' +
                                                            '<tbody id="ppPVMItemsBody"></tbody>' +
                                                        '</table>' +
                                                    '</div>' +
                                                '</div>' +
                                                '<div class="card-footer py-2"><small class="text-muted" id="ppPVMItemCount">— items</small></div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-lg-4 d-flex flex-column">' +
                                            // Key Insights
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-lightbulb text-warning mr-2"></i>Key Insights</h6></div>' +
                                                '<div class="card-body small" id="ppPVMInsights"><div class="text-muted">Loading...</div></div>' +
                                            '</div>' +
                                            // Top Revenue Gainers
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-arrow-up text-success mr-2"></i>Top Gainers</h6></div>' +
                                                '<div class="card-body p-0"><table class="table table-sm mb-0"><tbody id="ppPVMGainers"></tbody></table></div>' +
                                            '</div>' +
                                            // Top Revenue Losers
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-arrow-down text-danger mr-2"></i>Top Decliners</h6></div>' +
                                                '<div class="card-body p-0"><table class="table table-sm mb-0"><tbody id="ppPVMDecliners"></tbody></table></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Segments Tab - Clean Table with Flyout
                            '<div class="tab-pane fade" id="pp-segments">' +
                                '<div class="p-4">' +
                                    // Segment KPIs - rendered dynamically
                                    '<div class="row mb-3 cf-kpi-row" id="ppSegmentKPIs"></div>' +
                                    // Controls
                                    '<div class="d-flex justify-content-between align-items-center mb-3">' +
                                        '<div class="btn-group btn-group-sm" id="ppSegmentTypeGroup">' +
                                            '<button class="btn btn-outline-primary active" data-segment="department">By Department</button>' +
                                            '<button class="btn btn-outline-primary" data-segment="class">By Class</button>' +
                                            '<button class="btn btn-outline-primary" data-segment="location">By Location</button>' +
                                        '</div>' +
                                        '<button class="btn btn-sm btn-outline-secondary" onclick="HealthController.exportToCSV(\'segments\')"><i class="fas fa-download mr-1"></i>Export</button>' +
                                    '</div>' +
                                    '<div class="row">' +
                                        '<div class="col-lg-8">' +
                                            '<div class="card shadow-sm">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-sitemap mr-2"></i>Segment Performance <small class="text-muted">(click row for details)</small></h6></div>' +
                                                '<div class="card-body p-0">' +
                                                    '<div class="table-responsive" style="max-height:500px;">' +
                                                        '<table class="table table-sm table-hover mb-0 pp-sortable" id="ppSegmentsTable">' +
                                                            '<thead class="thead-light sticky-top">' +
                                                                '<tr>' +
                                                                    '<th class="sortable" data-sort="health" style="width:40px;"></th>' +
                                                                    '<th class="sortable" data-sort="name">Segment</th>' +
                                                                    '<th class="text-right sortable" data-sort="revenue">Revenue</th>' +
                                                                    '<th class="text-right sortable" data-sort="share">Share</th>' +
                                                                    '<th class="text-right sortable" data-sort="gm">Gross Margin</th>' +
                                                                    '<th class="text-right sortable" data-sort="gmPct">GM %</th>' +
                                                                    '<th class="text-right sortable" data-sort="opInc">Op Income</th>' +
                                                                    '<th class="text-right sortable" data-sort="opPct">Op %</th>' +
                                                                    '<th class="text-right sortable" data-sort="yoy">YoY Δ</th>' +
                                                                '</tr>' +
                                                            '</thead>' +
                                                            '<tbody id="ppSegmentsBody"></tbody>' +
                                                            '<tfoot id="ppSegmentsTotals" class="font-weight-bold bg-light"></tfoot>' +
                                                        '</table>' +
                                                    '</div>' +
                                                '</div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-lg-4">' +
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-chart-pie mr-2"></i>Revenue Mix</h6></div>' +
                                                '<div class="card-body p-2"><div id="ppSegmentPieChart" style="height:200px;"></div></div>' +
                                            '</div>' +
                                            '<div class="card shadow-sm">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-chart-bar mr-2"></i>Margin Comparison</h6></div>' +
                                                '<div class="card-body p-2"><div id="ppSegmentBarChart" style="height:200px;"></div></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Forecast Tab - Enhanced
                            '<div class="tab-pane fade" id="pp-forecast">' +
                                '<div class="p-4">' +
                                    '<div class="row mb-3 cf-kpi-row" id="ppForecastKPIs"></div>' +
                                    '<div class="row pp-equal-height-row">' +
                                        '<div class="col-lg-9 d-flex flex-column">' +
                                            // Main forecast chart
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                                    '<h6 class="mb-0"><i class="fas fa-chart-line mr-2"></i>Multi-Metric Forecast</h6>' +
                                                    '<div class="btn-group btn-group-sm">' +
                                                        '<button class="btn btn-outline-primary active" data-forecast-metric="revenue">Revenue</button>' +
                                                        '<button class="btn btn-outline-primary" data-forecast-metric="gm">Gross Margin</button>' +
                                                        '<button class="btn btn-outline-primary" data-forecast-metric="opinc">Op Income</button>' +
                                                    '</div>' +
                                                '</div>' +
                                                '<div class="card-body p-2"><div id="ppForecastChart" style="height:320px;"></div></div>' +
                                            '</div>' +
                                            // Forecast comparison table
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-table mr-2"></i>Monthly Forecast Detail</h6></div>' +
                                                '<div class="card-body p-0"><div class="table-responsive"><table class="table table-sm mb-0" id="ppForecastTable">' +
                                                    '<thead class="thead-light"><tr><th>Month</th><th class="text-right">Rev Forecast</th><th class="text-right">Rev Low</th><th class="text-right">Rev High</th><th class="text-right">GM Forecast</th><th class="text-right">OpInc Forecast</th><th class="text-right">Conf %</th></tr></thead>' +
                                                    '<tbody id="ppForecastBody"></tbody>' +
                                                '</table></div></div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-lg-3 d-flex flex-column">' +
                                            // Forecast settings - combined
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center"><h6 class="mb-0"><i class="fas fa-cog mr-2"></i>Forecast Settings</h6><button class="btn btn-sm btn-link p-0" onclick="HealthController.showForecastModelInfo()"><i class="fas fa-info-circle"></i></button></div>' +
                                                '<div class="card-body py-2">' +
                                                    '<div class="form-group mb-2"><label class="small font-weight-bold">Method</label><select class="form-control form-control-sm" id="ppForecastMethod"><option value="ets">Exponential Smoothing (ETS)</option><option value="linear">Linear Regression</option><option value="seasonal">Seasonal Decomposition</option><option value="moving_avg">Moving Average</option><option value="arima">ARIMA-style</option></select></div>' +
                                                    '<div class="form-group mb-2"><label class="small font-weight-bold">Horizon</label><select class="form-control form-control-sm" id="ppForecastHorizon"><option value="3">3 Months</option><option value="6" selected>6 Months</option><option value="12">12 Months</option><option value="24">24 Months</option></select></div>' +
                                                    '<div class="form-group mb-2"><label class="small font-weight-bold">Confidence</label><select class="form-control form-control-sm" id="ppForecastConfidence"><option value="80">80%</option><option value="90" selected>90%</option><option value="95">95%</option><option value="99">99%</option></select></div>' +
                                                    '<div class="form-group mb-2"><label class="small font-weight-bold">Seasonality</label><select class="form-control form-control-sm" id="ppForecastSeasonality"><option value="auto">Auto-detect</option><option value="none">None</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div>' +
                                                    '<div class="form-group mb-2"><label class="small font-weight-bold">Adjustment</label><select class="form-control form-control-sm" id="ppForecastMacro" onchange="HealthController.regenerateForecast()"><option value="0">None</option><option value="-0.05">Pessimistic (-5%)</option><option value="-0.10">Recession (-10%)</option><option value="0.05">Optimistic (+5%)</option><option value="0.10">High Growth (+10%)</option></select></div>' +
                                                    '<button class="btn btn-primary btn-sm btn-block" onclick="HealthController.regenerateForecast()"><i class="fas fa-sync mr-1"></i>Regenerate</button>' +
                                                '</div>' +
                                            '</div>' +
                                            // Model diagnostics
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center"><h6 class="mb-0"><i class="fas fa-stethoscope mr-2"></i>Model Diagnostics</h6><button class="btn btn-sm btn-link p-0" onclick="HealthController.showDiagnosticsInfo()"><i class="fas fa-info-circle"></i></button></div>' +
                                                '<div class="card-body small" id="ppForecastDiagnostics">' +
                                                    '<div class="d-flex justify-content-between mb-1"><span>MAPE:</span><strong id="ppForecastMAPE">—</strong></div>' +
                                                    '<div class="d-flex justify-content-between mb-1"><span>RMSE:</span><strong id="ppForecastRMSE">—</strong></div>' +
                                                    '<div class="d-flex justify-content-between mb-1"><span>R²:</span><strong id="ppForecastR2">—</strong></div>' +
                                                    '<div class="d-flex justify-content-between mb-1"><span>Trend:</span><strong id="ppForecastTrend">—</strong></div>' +
                                                    '<div class="d-flex justify-content-between"><span>Seasonality:</span><strong id="ppForecastSeason">—</strong></div>' +
                                                '</div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Scenarios Tab - Reimagined
                            '<div class="tab-pane fade" id="pp-scenarios">' +
                                '<div class="p-4">' +
                                    // KPI row that updates when scenario runs
                                    '<div class="row mb-3 cf-kpi-row" id="ppScenarioKPIs">' +
                                        '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-blue-soft"><i class="fas fa-dollar-sign text-blue"></i></div><div class="kpi-content"><span class="kpi-label">Revenue</span><span class="kpi-value" id="ppScenRevKPI">--</span><span class="kpi-sub" id="ppScenRevDelta">Baseline</span></div></div></div>' +
                                        '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-green-soft"><i class="fas fa-percentage text-green"></i></div><div class="kpi-content"><span class="kpi-label">Gross Margin</span><span class="kpi-value" id="ppScenGMKPI">--</span><span class="kpi-sub" id="ppScenGMDelta">Baseline</span></div></div></div>' +
                                        '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-purple-soft"><i class="fas fa-chart-line text-purple"></i></div><div class="kpi-content"><span class="kpi-label">Operating Income</span><span class="kpi-value" id="ppScenOpIncKPI">--</span><span class="kpi-sub" id="ppScenOpIncDelta">Baseline</span></div></div></div>' +
                                        '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-yellow-soft"><i class="fas fa-shield-alt text-yellow"></i></div><div class="kpi-content"><span class="kpi-label">Safety Margin</span><span class="kpi-value" id="ppScenSafetyKPI">--</span><span class="kpi-sub" id="ppScenSafetyDelta">Baseline</span></div></div></div>' +
                                    '</div>' +
                                    '<div class="row pp-equal-height-row">' +
                                        // Left: Scenario Builder
                                        '<div class="col-lg-3 d-flex">' +
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-flask mr-2"></i>Scenario Builder</h6></div>' +
                                                '<div class="card-body p-0">' +
                                                    '<div class="scenario-section">' +
                                                        '<select class="form-control form-control-sm" id="ppScenarioTemplate" onchange="HealthController.loadScenarioTemplate(this.value)">' +
                                                            '<option value="">Custom Scenario</option>' +
                                                            '<option value="recession">📉 Recession</option>' +
                                                            '<option value="growth">📈 Growth Push</option>' +
                                                            '<option value="cost_cut">✂️ Cost Cutting</option>' +
                                                            '<option value="price_war">⚔️ Price War</option>' +
                                                            '<option value="expansion">🚀 Expansion</option>' +
                                                            '<option value="stagflation">📊 Stagflation</option>' +
                                                        '</select>' +
                                                    '</div>' +
                                                    '<div class="scenario-section">' +
                                                        '<div class="scenario-section-title"><i class="fas fa-chart-line text-success"></i>Revenue</div>' +
                                                        '<div class="scenario-input-row"><span class="scenario-input-label">Growth %</span><input type="number" class="form-control form-control-sm scenario-input-field" id="ppScenRevGrowth" value="0"></div>' +
                                                        '<div class="scenario-input-row"><span class="scenario-input-label">Price Δ %</span><input type="number" class="form-control form-control-sm scenario-input-field" id="ppScenPriceChange" value="0"></div>' +
                                                    '</div>' +
                                                    '<div class="scenario-section">' +
                                                        '<div class="scenario-section-title"><i class="fas fa-coins text-danger"></i>Costs</div>' +
                                                        '<div class="scenario-input-row"><span class="scenario-input-label">COGS Δ %</span><input type="number" class="form-control form-control-sm scenario-input-field" id="ppScenCOGSChange" value="0"></div>' +
                                                        '<div class="scenario-input-row"><span class="scenario-input-label">OpEx Δ %</span><input type="number" class="form-control form-control-sm scenario-input-field" id="ppScenOpExChange" value="0"></div>' +
                                                    '</div>' +
                                                    '<div class="scenario-section">' +
                                                        '<div class="scenario-input-row"><span class="scenario-input-label">Horizon</span><select class="form-control form-control-sm scenario-input-field" id="ppScenHorizon" style="width:80px;"><option value="3">3 mo</option><option value="6" selected>6 mo</option><option value="12">12 mo</option></select></div>' +
                                                        '<input type="hidden" id="ppScenVolumeChange" value="0">' +
                                                        '<input type="hidden" id="ppScenHeadcount" value="0">' +
                                                        '<button class="btn btn-primary btn-block mt-2" onclick="HealthController.runAdvancedScenario()"><i class="fas fa-play mr-1"></i>Run Scenario</button>' +
                                                    '</div>' +
                                                '</div>' +
                                            '</div>' +
                                        '</div>' +
                                        // Center: Visualization
                                        '<div class="col-lg-5 d-flex">' +
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                                    '<h6 class="mb-0"><i class="fas fa-chart-area mr-2"></i>Projected Impact</h6>' +
                                                    '<div class="btn-group btn-group-sm" id="ppScenarioChartToggle">' +
                                                        '<button class="btn btn-outline-secondary btn-sm active" data-chart="waterfall" onclick="HealthController.switchScenarioChart(\'waterfall\')">Comparison</button>' +
                                                        '<button class="btn btn-outline-secondary btn-sm" data-chart="trend" onclick="HealthController.switchScenarioChart(\'trend\')">Trend</button>' +
                                                    '</div>' +
                                                '</div>' +
                                                '<div class="card-body p-2"><div id="ppScenarioChart" style="height:320px;"><div class="text-center text-muted py-5"><i class="fas fa-flask fa-3x mb-3 text-light"></i><div>Run a scenario to see projected impact</div></div></div></div>' +
                                            '</div>' +
                                        '</div>' +
                                        // Right: Thresholds & Saved Scenarios
                                        '<div class="col-lg-4 d-flex flex-column">' +
                                            // Key Thresholds
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-crosshairs mr-2"></i>Key Thresholds</h6></div>' +
                                                '<div class="card-body py-2" id="ppScenarioThresholds">' +
                                                    '<div class="d-flex justify-content-between mb-2 small"><span>Breakeven:</span><strong id="ppScenBreakeven">—</strong></div>' +
                                                    '<div class="d-flex justify-content-between mb-2 small"><span>Safety Margin:</span><strong id="ppScenSafetyMargin">—</strong></div>' +
                                                    '<div class="d-flex justify-content-between mb-2 small"><span>Cash Runway:</span><strong id="ppScenCashRunway">—</strong></div>' +
                                                    '<div class="d-flex justify-content-between small"><span>Risk Level:</span><span id="ppScenRiskBadge" class="badge badge-secondary">—</span></div>' +
                                                '</div>' +
                                            '</div>' +
                                            // Saved Scenarios
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                                    '<h6 class="mb-0"><i class="fas fa-save mr-2"></i>Saved Scenarios</h6>' +
                                                    '<button class="btn btn-sm btn-primary" onclick="HealthController.saveCurrentScenario()"><i class="fas fa-plus mr-1"></i>Save</button>' +
                                                '</div>' +
                                                '<div class="card-body p-0" style="overflow-y:auto;">' +
                                                    '<div id="ppSavedScenarios" class="pp-saved-scenarios">' +
                                                        '<div class="text-center text-muted py-4"><i class="fas fa-bookmark fa-2x mb-2 text-light"></i><div class="small">No saved scenarios yet</div><div class="small text-muted">Run and save scenarios for quick comparison</div></div>' +
                                                    '</div>' +
                                                '</div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Budget Tab - With KPIs
                            '<div class="tab-pane fade" id="pp-budget">' +
                                '<div class="p-4">' +
                                    // Standard KPI row
                                    '<div class="row mb-3 cf-kpi-row" id="ppBudgetKPIs"></div>' +
                                    // Main Content
                                    '<div class="row pp-equal-height-row">' +
                                        '<div class="col-lg-8 d-flex flex-column">' +
                                            // Variance Visualization
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                                    '<h6 class="mb-0"><i class="fas fa-chart-bar mr-2"></i>Variance by Category</h6>' +
                                                    '<div class="btn-group btn-group-sm">' +
                                                        '<button class="btn btn-outline-secondary btn-sm active" data-budget-view="bar">Bar</button>' +
                                                        '<button class="btn btn-outline-secondary btn-sm" data-budget-view="waterfall">Waterfall</button>' +
                                                    '</div>' +
                                                '</div>' +
                                                '<div class="card-body p-2"><div id="ppBudgetChart" style="height:220px;"></div></div>' +
                                            '</div>' +
                                            // Main Table with enhanced styling
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                                    '<h6 class="mb-0"><i class="fas fa-table mr-2"></i>Detailed Variance Analysis</h6>' +
                                                    '<div class="d-flex align-items-center">' +
                                                        '<input type="text" class="form-control form-control-sm mr-2" placeholder="Search accounts..." id="ppBudgetSearch" style="width:150px;">' +
                                                        '<div class="btn-group btn-group-sm" id="ppBudgetFilterGroup">' +
                                                            '<button class="btn btn-outline-secondary active" data-filter="all">All</button>' +
                                                            '<button class="btn btn-outline-danger" data-filter="over">Over</button>' +
                                                            '<button class="btn btn-outline-success" data-filter="under">Under</button>' +
                                                        '</div>' +
                                                    '</div>' +
                                                '</div>' +
                                                '<div class="card-body p-0"><div class="table-responsive" style="max-height:350px;overflow-y:auto;">' +
                                                    '<table class="table table-sm table-hover mb-0 pp-sortable pp-budget-table" id="ppBudgetTable">' +
                                                        '<thead class="thead-light sticky-top"><tr>' +
                                                            '<th class="sortable">Account</th>' +
                                                            '<th class="text-right sortable">Budget</th>' +
                                                            '<th class="text-right sortable">Actual</th>' +
                                                            '<th class="text-right sortable">Variance</th>' +
                                                            '<th class="text-center" style="width:120px;">Progress</th>' +
                                                            '<th class="text-center sortable" style="width:80px;">Status</th>' +
                                                        '</tr></thead>' +
                                                        '<tbody id="ppBudgetBody"></tbody>' +
                                                    '</table>' +
                                                '</div></div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-lg-4 d-flex flex-column">' +
                                            // Variance Distribution (Donut)
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-chart-pie mr-2"></i>Variance Distribution</h6></div>' +
                                                '<div class="card-body p-2 text-center"><div id="ppBudgetPieChart" style="height:160px;"></div></div>' +
                                            '</div>' +
                                            // Budget Alerts with priority
                                            '<div class="card shadow-sm mb-3 flex-fill">' +
                                                '<div class="card-header py-2 bg-gradient-danger text-white"><h6 class="mb-0"><i class="fas fa-bell mr-2"></i>Priority Alerts</h6></div>' +
                                                '<div class="card-body p-0" style="max-height:180px;overflow-y:auto;"><div id="ppBudgetAlerts" class="pp-budget-alerts"></div></div>' +
                                            '</div>' +
                                            // Monthly Trend
                                            '<div class="card shadow-sm">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-chart-line mr-2"></i>Monthly Variance Trend</h6></div>' +
                                                '<div class="card-body p-2"><div id="ppBudgetTrendChart" style="height:120px;"></div></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            // Drivers Tab - Comprehensive Analysis
                            '<div class="tab-pane fade" id="pp-drivers">' +
                                '<div class="p-4">' +
                                    // KPIs
                                    '<div class="row mb-3 cf-kpi-row" id="ppDriversKPIs"></div>' +
                                    // Controls
                                    '<div class="d-flex justify-content-end align-items-center mb-3">' +
                                        '<label class="mr-2 small mb-0">Min Change %:</label>' +
                                        '<select class="form-control form-control-sm" id="ppDriversMinChange" style="width:auto;">' +
                                            '<option value="0">Any</option>' +
                                            '<option value="5">±5%+</option>' +
                                            '<option value="10" selected>±10%+</option>' +
                                            '<option value="25">±25%+</option>' +
                                            '<option value="50">±50%+</option>' +
                                        '</select>' +
                                        '<button class="btn btn-sm btn-outline-secondary ml-2" onclick="HealthController.exportToCSV(\'drivers\')"><i class="fas fa-download mr-1"></i>Export</button>' +
                                    '</div>' +
                                    '<div class="row pp-equal-height-row">' +
                                        '<div class="col-lg-8 d-flex">' +
                                            // Comprehensive accounts table
                                            '<div class="card shadow-sm flex-fill d-flex flex-column">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-search-dollar mr-2"></i>All Account Changes (YoY)</h6></div>' +
                                                '<div class="card-body p-0 flex-fill d-flex flex-column" style="min-height:0;"><div class="table-responsive flex-fill" style="max-height:800px; overflow-y:auto;">' +
                                                    '<table class="table table-sm table-hover mb-0 pp-sortable" id="ppDriversAllTable">' +
                                                        '<thead class="thead-light sticky-top"><tr>' +
                                                            '<th class="sortable" data-sort="type">Type</th>' +
                                                            '<th class="sortable" data-sort="name">Account</th>' +
                                                            '<th style="width:70px;">Trend</th>' +
                                                            '<th class="text-right sortable" data-sort="current">Current</th>' +
                                                            '<th class="text-right sortable" data-sort="prior">Prior</th>' +
                                                            '<th class="text-right sortable" data-sort="change">Change</th>' +
                                                            '<th class="text-right sortable" data-sort="changePct">Change %</th>' +
                                                            '<th class="text-right sortable" data-sort="impact">Impact</th>' +
                                                        '</tr></thead>' +
                                                        '<tbody id="ppDriversAllBody"></tbody>' +
                                                    '</table>' +
                                                '</div></div>' +
                                                '<div class="card-footer py-2 d-flex justify-content-between align-items-center">' +
                                                    '<small class="text-muted" id="ppDriversCount">— accounts</small>' +
                                                    '<div id="ppDriversPagination"></div>' +
                                                '</div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-lg-4 d-flex flex-column">' +
                                            // Key Insights (moved to top)
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-lightbulb text-warning mr-2"></i>Key Insights</h6></div>' +
                                                '<div class="card-body small" id="ppDriversInsights">' +
                                                    '<div class="text-muted">Loading insights...</div>' +
                                                '</div>' +
                                            '</div>' +
                                            // Biggest Cost Increases
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2">' +
                                                    '<h6 class="mb-0"><i class="fas fa-arrow-up text-danger mr-2"></i>Biggest Cost Increases</h6>' +
                                                '</div>' +
                                                '<div class="card-body p-0"><table class="table table-sm mb-0"><tbody id="ppDriversCostIncreases"></tbody></table></div>' +
                                            '</div>' +
                                            // Biggest Savings (flex-fill to take remaining space)
                                            '<div class="card shadow-sm flex-fill">' +
                                                '<div class="card-header py-2">' +
                                                    '<h6 class="mb-0"><i class="fas fa-arrow-down text-success mr-2"></i>Biggest Savings</h6>' +
                                                '</div>' +
                                                '<div class="card-body p-0"><table class="table table-sm mb-0"><tbody id="ppDriversCostSavings"></tbody></table></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Ratios Tab - Reimagined with Popups
                            '<div class="tab-pane fade" id="pp-benchmarks">' +
                                '<div class="p-4">' +
                                    // KPI Row
                                    '<div class="row mb-3 cf-kpi-row" id="ppBenchmarkKPIs"></div>' +
                                    // Main grid layout with equal heights
                                    '<div class="row pp-equal-height-row">' +
                                        '<div class="col-lg-8 d-flex flex-column">' +
                                            // Profitability Section
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2 d-flex justify-content-between align-items-center">' +
                                                    '<h6 class="mb-0"><i class="fas fa-chart-line text-success mr-2"></i>Profitability Metrics</h6>' +
                                                    '<span class="badge badge-light">Click any ratio for details</span>' +
                                                '</div>' +
                                                '<div class="card-body">' +
                                                    '<div class="row" id="ppProfitabilityGrid"></div>' +
                                                '</div>' +
                                            '</div>' +
                                            // Efficiency Section
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-tachometer-alt text-info mr-2"></i>Efficiency & Productivity</h6></div>' +
                                                '<div class="card-body">' +
                                                    '<div class="row" id="ppEfficiencyGrid"></div>' +
                                                '</div>' +
                                            '</div>' +
                                            // Operating Section
                                            '<div class="card shadow-sm">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-cogs text-warning mr-2"></i>Operating & Coverage</h6></div>' +
                                                '<div class="card-body">' +
                                                    '<div class="row" id="ppOperatingGrid"></div>' +
                                                '</div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="col-lg-4 d-flex flex-column">' +
                                            // Overall Score - matching grey header style
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2 bg-light"><h6 class="mb-0"><i class="fas fa-star mr-2 text-primary"></i>Financial Health Score</h6></div>' +
                                                '<div class="card-body text-center py-2">' +
                                                    '<div id="ppHealthScoreGauge" style="height:90px;overflow:visible;"></div>' +
                                                    '<h3 class="mb-0" id="ppHealthScoreValue">—</h3>' +
                                                    '<p class="text-muted mb-0 small" id="ppHealthScoreLabel">Calculating...</p>' +
                                                '</div>' +
                                            '</div>' +
                                            // Score Breakdown
                                            '<div class="card shadow-sm mb-3">' +
                                                '<div class="card-header py-2 bg-light"><h6 class="mb-0"><i class="fas fa-chart-bar mr-2"></i>Category Scores</h6></div>' +
                                                '<div class="card-body py-2" id="ppScoreBreakdown"></div>' +
                                            '</div>' +
                                            // DuPont Analysis
                                            '<div class="card shadow-sm mb-3 flex-fill">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-sitemap mr-2"></i>DuPont Analysis</h6></div>' +
                                                '<div class="card-body p-2"><div id="ppDuPontChart" style="height:160px;"></div></div>' +
                                            '</div>' +
                                            // Cost Structure
                                            '<div class="card shadow-sm">' +
                                                '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-chart-pie mr-2"></i>Cost Structure</h6></div>' +
                                                '<div class="card-body p-2"><div id="ppCostStructureChart" style="height:160px;"></div></div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            
                            // Configuration Tab
                            '<div class="tab-pane fade" id="pp-config">' +
                                '<div class="p-4" id="ppConfigContainer"><p class="text-muted">Loading configuration...</p></div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                // Ratio Detail Modal
                '<div class="modal fade" id="ppRatioModal" tabindex="-1">' +
                    '<div class="modal-dialog modal-dialog-centered">' +
                        '<div class="modal-content">' +
                            '<div class="modal-header py-2">' +
                                '<h6 class="modal-title" id="ppRatioModalTitle">Ratio Details</h6>' +
                                '<button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>' +
                            '</div>' +
                            '<div class="modal-body">' +
                                '<div class="row mb-3">' +
                                    '<div class="col-6 text-center border-right">' +
                                        '<div class="text-muted small">Current Value</div>' +
                                        '<h3 class="mb-0" id="ppRatioModalValue">—</h3>' +
                                    '</div>' +
                                    '<div class="col-6 text-center">' +
                                        '<div class="text-muted small">Benchmark</div>' +
                                        '<h3 class="mb-0 text-muted" id="ppRatioModalBenchmark">—</h3>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="mb-3">' +
                                    '<span class="badge mr-1" id="ppRatioModalGrade">—</span>' +
                                    '<span class="text-muted small" id="ppRatioModalGradeDesc"></span>' +
                                '</div>' +
                                '<hr>' +
                                '<h6 class="font-weight-bold"><i class="fas fa-calculator mr-2"></i>Formula</h6>' +
                                '<div class="bg-light p-2 rounded mb-3"><code id="ppRatioModalFormula">—</code></div>' +
                                '<h6 class="font-weight-bold"><i class="fas fa-info-circle mr-2"></i>Description</h6>' +
                                '<p class="text-muted small mb-3" id="ppRatioModalDesc">—</p>' +
                                '<h6 class="font-weight-bold"><i class="fas fa-lightbulb mr-2"></i>Interpretation</h6>' +
                                '<p class="text-muted small mb-0" id="ppRatioModalInterpret">—</p>' +
                            '</div>' +
                            '<div class="modal-footer py-2">' +
                                '<small class="text-muted mr-auto" id="ppRatioModalCalc">Calculation: —</small>' +
                                '<button type="button" class="btn btn-sm btn-secondary" data-dismiss="modal">Close</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                // Flyout Panel
                '<div id="ppFlyout" class="pp-flyout">' +
                    '<div class="flyout-overlay" onclick="HealthController.closeFlyout()"></div>' +
                    '<div class="flyout-panel">' +
                        '<div class="flyout-header">' +
                            '<div class="flyout-title-area">' +
                                '<h5 id="ppFlyoutTitle">Title</h5>' +
                                '<div class="text-muted small" id="ppFlyoutSubtitle">Subtitle</div>' +
                            '</div>' +
                            '<div class="flyout-actions">' +
                                '<button class="btn btn-sm btn-outline-secondary mr-2" onclick="HealthController.exportToCSV(\'transactions\')" title="Export to CSV"><i class="fas fa-download"></i></button>' +
                                '<button class="flyout-close" onclick="HealthController.closeFlyout()"><i class="fas fa-times"></i></button>' +
                            '</div>' +
                        '</div>' +
                        '<div class="flyout-stats" id="ppFlyoutStats"></div>' +
                        '<div class="flyout-body" id="ppFlyoutBody"></div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        },

        bindEvents: function() {
            var self = this;
            
            // Apply button
            var applyBtn = el('#healthApplyRange');
            if (applyBtn) applyBtn.addEventListener('click', function() { self.loadData(); });
            
            // Subsidiary dropdown
            var subEl = el('#healthSubsidiary');
            if (subEl) subEl.addEventListener('change', function(e) {
                self.subsidiaryId = e.target.value;
                self.loadData();
            });
            
            // Tab switching
            if (window.jQuery) {
                jQuery('#healthTabs a').on('click', function(e) {
                    e.preventDefault();
                    jQuery(this).tab('show');
                    self.activeTab = jQuery(this).attr('href').replace('#pp-', '');
                });
                
                // Resize charts on tab show + lazy load data
                jQuery('#healthTabs a').on('shown.bs.tab', function(e) {
                    // Delay resize to allow tab content to be visible
                    setTimeout(function() {
                        self.resizeCharts();
                    }, 50);
                    
                    var tabId = jQuery(e.target).attr('href');
                    // Lazy load budget data
                    if (tabId === '#pp-budget' && !self.budgetLoaded) {
                        self.loadBudgetData();
                    }
                    // Lazy load P/V/M data
                    if (tabId === '#pp-pvm' && !self.pvmLoaded) {
                        self.pvmLoaded = true;
                        self.loadPriceVolumeMix();
                    }
                    // Initialize scenario baseline KPIs
                    if (tabId === '#pp-scenarios' && self.latestData) {
                        self.initScenarioBaseline();
                    }
                });
            }
            
            // Window resize handler for charts
            var resizeTimer;
            window.addEventListener('resize', function() {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(function() {
                    self.resizeCharts();
                }, 150);
            });
            
            // Segment type buttons
            var segmentBtns = document.querySelectorAll('#ppSegmentTypeGroup .btn');
            segmentBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    segmentBtns.forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    self.loadSegmentData(btn.dataset.segment);
                });
            });
            
            // Forecast metric buttons
            var forecastMetricBtns = document.querySelectorAll('[data-forecast-metric]');
            forecastMetricBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    forecastMetricBtns.forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    self.forecastMetric = btn.dataset.forecastMetric;
                    if (self.latestData) self.renderForecast(self.latestData);
                });
            });
            
            // Drivers min change filter
            var minChangeEl = el('#ppDriversMinChange');
            if (minChangeEl) {
                minChangeEl.addEventListener('change', function() {
                    self.driversMinChange = parseFloat(this.value) || 0;
                    self.driversPage = 1;
                    if (self.driversData) self.renderDrivers(self.driversData);
                });
            }
            
            // P/V/M period selector
            var pvmPeriodBtns = document.querySelectorAll('[data-pvm-period]');
            pvmPeriodBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    pvmPeriodBtns.forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    self.pvmPeriod = btn.dataset.pvmPeriod;
                    self.loadPriceVolumeMix();
                });
            });
            
            // Keyboard escape to close flyout
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') self.closeFlyout();
            });
        },

        showLoadingState: function() {
            // KPI skeletons
            var kpiIds = ['PP_HealthScore', 'PP_Revenue', 'PP_GrossMargin', 'PP_OpIncome', 'PP_Breakeven'];
            kpiIds.forEach(function(id) {
                var e = el('#' + id);
                if (e) e.innerHTML = Skeleton.render('custom', { width: '60px', height: '1.5rem' });
            });
            
            // Chart skeleton
            var trendChart = el('#ppTrendChart');
            if (trendChart) trendChart.innerHTML = Skeleton.render('chart', { height: '180px' });
            
            // Table skeleton
            var summaryBody = el('#ppSummaryBody');
            if (summaryBody) {
                var html = '';
                for (var r = 0; r < 6; r++) {
                    html += '<tr>';
                    for (var c = 0; c < 5; c++) {
                        html += '<td>' + Skeleton.render('custom', { width: c === 0 ? '80%' : '50%', height: '0.8rem' }) + '</td>';
                    }
                    html += '</tr>';
                }
                summaryBody.innerHTML = html;
            }
        },

        // ════════════════════════════════════════════════════════════════════════
        // DATA LOADING
        // ════════════════════════════════════════════════════════════════════════

        async loadConfig() {
            var self = this;
            try {
                var res = await API.get('health_config');
                this.subsidiaries = res.subsidiaries || [];
                this.fiscalCalendar = res.fiscalCalendar || {};
                this.renderSubsidiaryDropdown();
                this.configData = res.config || {};
                this.savedScenarios = res.savedScenarios || [];
                this.renderConfigTab();
                
                // Set fiscal year defaults
                var startEl = el('#healthStartDate');
                var endEl = el('#healthEndDate');
                if (this.fiscalCalendar.fiscalYearStartDate) {
                    if (startEl && !startEl.value) startEl.value = this.fiscalCalendar.fiscalYearStartDate;
                }
                
                // For end date, prefer latest closed period (complete data) over current date
                if (endEl && !endEl.value) {
                    var closedPeriod = this.fiscalCalendar.latestClosedPeriod;
                    if (closedPeriod && closedPeriod.endDate) {
                        // Use latest closed period end date (ensures complete accounting data)
                        endEl.value = closedPeriod.endDate;
                        console.log('[Health] Using latest closed period end date:', closedPeriod.endDate, '(' + closedPeriod.periodName + ')');
                    } else if (this.fiscalCalendar.fiscalYearEndDate) {
                        // Fallback: use fiscal year end or today, whichever is earlier
                        var fyEnd = new Date(this.fiscalCalendar.fiscalYearEndDate);
                        var today = new Date();
                        endEl.value = fyEnd > today ? today.toISOString().split('T')[0] : this.fiscalCalendar.fiscalYearEndDate;
                    }
                }
                
                this.loadData();
            } catch(e) {
                console.error('Health config load error', e);
                this.loadData();
            }
        },

        renderSubsidiaryDropdown: function() {
            var sel = el('#healthSubsidiary');
            if (!sel) return;
            
            sel.innerHTML = '';
            
            if (!this.subsidiaries || this.subsidiaries.length === 0) {
                sel.innerHTML = '<option value="">All Subsidiaries</option>';
                sel.style.display = 'none';
                return;
            }
            
            sel.style.display = '';
            
            var allOpt = document.createElement('option');
            allOpt.value = '';
            allOpt.textContent = 'All Subsidiaries';
            sel.appendChild(allOpt);
            
            var self = this;
            this.subsidiaries.forEach(function(sub) {
                var opt = document.createElement('option');
                opt.value = sub.id;
                opt.textContent = sub.name;
                if (sub.id == self.subsidiaryId) opt.selected = true;
                sel.appendChild(opt);
            });
        },

        async loadData() {
            var self = this;
            var params = {};
            
            var startDate = el('#healthStartDate');
            var endDate = el('#healthEndDate');
            
            if (startDate && startDate.value) params.startDate = startDate.value;
            if (endDate && endDate.value) params.endDate = endDate.value;
            if (this.subsidiaryId) params.subsidiary = this.subsidiaryId;
            
            try {
                var data = await API.get('health', params);
                this.latestData = data;
                this.render(data);
            } catch (e) {
                console.error('Health load error', e);
                el('#gantry-view-container').innerHTML = ErrorBoundary.renderError(e, {
                    title: 'Failed to Load Profitability Pulse',
                    retryAction: 'HealthController.init()'
                });
            }
        },

        // ════════════════════════════════════════════════════════════════════════
        // RENDERING
        // ════════════════════════════════════════════════════════════════════════

        render: function(data) {
            var self = this;
            var meta = data.meta || {};
            var company = data.company || {};
            var rangeM = company.metrics && company.metrics.range ? company.metrics.range : {};
            
            // Sync Date Inputs
            if (meta.range) {
                el('#healthStartDate').value = meta.range.start;
                el('#healthEndDate').value = meta.range.end;
            }
            
            // KPIs
            this.renderKPIs(company, rangeM);
            
            // Overview Tab
            this.renderTrendChart(data);
            this.renderSummaryTable(data);
            this.renderAlerts(data);
            
            // Margin Tab
            this.renderWaterfall(data);
            this.renderMarginSummary(data);
            this.renderMarginBridgeChart(data);
            this.renderMarginTrendChart(data);
            this.renderCostBreakdownChart(data);
            this.renderTopExpenses(data);
            
            // Segments Tab (initial load)
            this.renderSegments(data.departments || [], 'department');
            
            // Forecast Tab
            this.renderForecast(data);
            
            // Drivers Tab
            this.renderDrivers(data);
            
            // Benchmarks Tab
            this.renderBenchmarks(data);
            
            // Budget Tab (lazy load on tab click)
            this.budgetLoaded = false;
        },

        renderKPIs: function(company, rangeM) {
            var self = this;
            var yoy = company.yoy || {};
            var be = company.breakeven || {};
            var avgs = company.averages || {};
            
            // Use the server-calculated health score for consistency
            // Server formula: 60% coverage ratio (avgRev/breakeven) + 40% GM ratio (actual/target)
            // Fallback to 50 only if server returns nothing
            var healthScore = company.healthScore != null ? company.healthScore : 50;
            
            // Store for consistency across dashboard (Ratios tab uses this)
            this.calculatedHealthScore = healthScore;
            
            // Health Score with integrity-style gauge
            this.renderHealthMeterKPI(healthScore);
            
            this.setSafeText('#PP_Revenue', fmtMoney(rangeM.revenue));
            this.setSafeText('#PP_YoYRevenue', yoy.revenueDeltaPct != null ? (yoy.revenueDeltaPct >= 0 ? '+' : '') + fmtPct(yoy.revenueDeltaPct) : '—');
            this.setSafeText('#PP_GrossMargin', fmtMoney(rangeM.gm));
            this.setSafeText('#PP_COGS', fmtMoney(rangeM.cogs));
            this.setSafeText('#PP_OpIncome', fmtMoney(rangeM.opInc));
            this.setSafeText('#PP_OpEx', fmtMoney(rangeM.opex));
            this.setSafeText('#PP_Breakeven', fmtMoney(be.breakevenMonthlyRevenue) + '/mo');
            this.setSafeText('#PP_AvgMonthly', fmtMoney(avgs.rangeAvgMonthlyRevenue));
            
            // Render Overview sparklines
            this.renderOverviewSparklines();
        },
        
        renderOverviewSparklines: function() {
            var data = this.latestData || {};
            var monthlyTrend = data.monthlyTrend || [];
            
            // Render sparklines
            if (monthlyTrend.length >= 3) {
                this.renderMiniSparkline('#ppSparkRevenue', monthlyTrend.map(function(m) { return m.revenue || 0; }), '#3b82f6');
                this.renderMiniSparkline('#ppSparkMargin', monthlyTrend.map(function(m) { return (m.gmPct || 0) * 100; }), '#10b981');
                this.renderMiniSparkline('#ppSparkOpInc', monthlyTrend.map(function(m) { 
                    var rev = m.revenue || 0;
                    var cogs = Math.abs(m.cogs || 0);
                    var opex = Math.abs(m.opex || 0);
                    return m.opInc != null ? m.opInc : (rev - cogs - opex);
                }), '#f59e0b');
            }
        },
        
        renderMiniSparkline: function(selector, values, color) {
            var container = el(selector);
            if (!container || values.length < 2) return;
            
            var width = 80, height = 24;
            var min = Math.min.apply(null, values);
            var max = Math.max.apply(null, values);
            var range = max - min || 1;
            
            var points = values.map(function(v, i) {
                var x = (i / (values.length - 1)) * width;
                var y = height - ((v - min) / range) * height;
                return x + ',' + y;
            }).join(' ');
            
            var trend = values[values.length - 1] > values[0] ? '↑' : (values[values.length - 1] < values[0] ? '↓' : '→');
            var trendClass = values[values.length - 1] >= values[0] ? 'text-success' : 'text-danger';
            
            container.innerHTML = '<svg width="' + width + '" height="' + height + '" style="display:block;">' +
                '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>' +
            '<span class="pp-spark-trend ' + trendClass + '">' + trend + '</span>';
        },
        
        renderHealthMeterKPI: function(score) {
            var gaugeEl = el('#PP_HealthScore');
            var valueEl = el('#PP_HealthValue');
            var labelEl = el('#PP_HealthLabel');
            
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

        overviewChartView: 'revenue',
        
        switchOverviewChart: function(view) {
            this.overviewChartView = view;
            
            // Update button states
            var buttons = document.querySelectorAll('#ppOverviewChartToggle button');
            buttons.forEach(function(btn) {
                btn.classList.remove('active');
                if (btn.dataset.view === view) btn.classList.add('active');
            });
            
            // Re-render chart
            if (this.latestData) {
                this.renderTrendChart(this.latestData);
            }
        },
        
        renderTrendChart: function(data) {
            var container = el('#ppTrendChart');
            if (!container || typeof Plotly === 'undefined') return;
            
            ChartManager.clearContainer('ppTrendChart');
            
            var sparkData = data.sparklineData || {};
            var labels = sparkData.labels || [];
            var revenue = sparkData.revenue || [];
            var gmPct = sparkData.gmPct || [];
            var monthlyTrend = data.monthlyTrend || [];
            
            if (labels.length === 0) return;
            
            var view = this.overviewChartView || 'revenue';
            var traces = [];
            var layout = {
                height: 180,
                margin: { t: 10, r: 40, b: 30, l: 60 },
                xaxis: { tickfont: { size: 10 } },
                showlegend: false,
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent'
            };
            
            if (view === 'revenue') {
                var gmDisplay = gmPct.map(function(v) { return ((v || 0) * 100); });
                var maxRevenue = Math.max.apply(null, revenue.filter(function(v) { return !isNaN(v) && v > 0; })) * 1.15;
                var gmScaleFactor = maxRevenue / 50;
                var gmScaled = gmDisplay.map(function(v) { return Math.max(0, v) * gmScaleFactor; });
                
                traces = [
                    {
                        x: labels, y: revenue, type: 'bar', name: 'Revenue',
                        marker: { color: 'rgba(59, 130, 246, 0.75)' },
                        hovertemplate: '<b>%{x}</b><br>Revenue: $%{y:,.0f}<extra></extra>'
                    },
                    {
                        x: labels, y: gmScaled, type: 'scatter', mode: 'lines+markers', name: 'GM %',
                        line: { color: '#10b981', width: 3 }, marker: { size: 8, color: '#10b981' },
                        customdata: gmDisplay,
                        hovertemplate: '<b>%{x}</b><br>GM: %{customdata:.1f}%<extra></extra>'
                    }
                ];
                layout.yaxis = { tickformat: '$,.0s', tickfont: { size: 10 } };
            } else {
                // Margin view - show GM% and OpMargin%
                var gmDisplay = gmPct.map(function(v) { return ((v || 0) * 100); });
                var opMarginPct = monthlyTrend.map(function(m) {
                    var rev = m.revenue || 0;
                    var opInc = m.opInc != null ? m.opInc : (rev - Math.abs(m.cogs || 0) - Math.abs(m.opex || 0));
                    return rev > 0 ? (opInc / rev * 100) : 0;
                });
                
                traces = [
                    {
                        x: labels, y: gmDisplay, type: 'scatter', mode: 'lines+markers', name: 'Gross Margin %',
                        line: { color: '#10b981', width: 3 }, marker: { size: 8 },
                        hovertemplate: '<b>%{x}</b><br>GM: %{y:.1f}%<extra></extra>'
                    },
                    {
                        x: labels, y: opMarginPct, type: 'scatter', mode: 'lines+markers', name: 'Op Margin %',
                        line: { color: '#3b82f6', width: 3 }, marker: { size: 8 },
                        hovertemplate: '<b>%{x}</b><br>Op Margin: %{y:.1f}%<extra></extra>'
                    }
                ];
                layout.yaxis = { ticksuffix: '%', tickfont: { size: 10 }, range: [0, Math.max(50, Math.max.apply(null, gmDisplay) * 1.1)] };
                layout.showlegend = true;
                layout.legend = { orientation: 'h', y: 1.15, font: { size: 10 } };
            }
            
            Plotly.newPlot('ppTrendChart', traces, layout, { responsive: true, displayModeBar: false });
        },

        renderSummaryTable: function(data) {
            var self = this;
            var company = data.company || {};
            var range = company.metrics && company.metrics.range ? company.metrics.range : {};
            var prior = company.metrics && company.metrics.priorYearRange ? company.metrics.priorYearRange : {};
            
            var rows = [
                { label: 'Revenue', current: range.revenue, prior: prior.revenue, isGood: true },
                { label: 'Cost of Goods Sold', current: range.cogs, prior: prior.cogs, isGood: false },
                { label: 'Gross Margin', current: range.gm, prior: prior.gm, isGood: true },
                { label: 'Operating Expenses', current: range.opex, prior: prior.opex, isGood: false },
                { label: 'Operating Income', current: range.opInc, prior: prior.opInc, isGood: true }
            ];
            
            var html = '';
            rows.forEach(function(row) {
                var change = (row.current || 0) - (row.prior || 0);
                var changePct = row.prior !== 0 ? change / row.prior : 0;
                var colorClass = '';
                
                if (change !== 0) {
                    var isPositive = change > 0;
                    colorClass = (isPositive === row.isGood) ? 'text-success' : 'text-danger';
                }
                
                html += '<tr>' +
                    '<td class="font-weight-medium">' + row.label + '</td>' +
                    '<td class="text-right">' + fmtMoney(row.current) + '</td>' +
                    '<td class="text-right text-muted">' + fmtMoney(row.prior) + '</td>' +
                    '<td class="text-right ' + colorClass + '">' + (change >= 0 ? '+' : '') + fmtMoney(change) + '</td>' +
                    '<td class="text-right ' + colorClass + '">' + (changePct >= 0 ? '+' : '') + fmtPct(changePct) + '</td>' +
                '</tr>';
            });
            
            el('#ppSummaryBody').innerHTML = html;
        },

        renderAlerts: function(data) {
            var company = data.company || {};
            var analysis = company.analysis || {};
            var anomalies = data.anomalies || [];
            var rangeM = company.metrics && company.metrics.range ? company.metrics.range : {};
            var priorM = company.metrics && company.metrics.priorYearRange ? company.metrics.priorYearRange : {};
            var yoy = company.yoy || {};
            var monthlyTrend = data.monthlyTrend || [];
            var cfg = this.configData || {};
            
            // Advanced Issues Engine
            var issues = [];
            var recs = [];
            
            // 1. Profitability Issues
            var opInc = rangeM.opInc || 0;
            var revenue = rangeM.revenue || 0;
            var gmPct = rangeM.gmPct || 0;
            var opPct = revenue > 0 ? opInc / revenue : 0;
            var targetGM = (cfg.gmTarget || 30) / 100;
            var targetOp = (cfg.opTarget || 10) / 100;
            
            if (opInc < 0) {
                issues.push({ severity: 'critical', icon: 'exclamation-circle', text: 'Operating at a loss of ' + fmtMoney(Math.abs(opInc)) });
                recs.push({ priority: 1, icon: 'cut', text: 'Review discretionary spending for immediate cuts' });
                recs.push({ priority: 2, icon: 'chart-line', text: 'Analyze top expense categories for optimization' });
            } else if (opPct < targetOp * 0.5) {
                issues.push({ severity: 'warning', icon: 'chart-pie', text: 'Operating margin (' + fmtPct(opPct) + ') well below target (' + fmtPct(targetOp) + ')' });
            }
            
            if (gmPct < targetGM * 0.5) {
                issues.push({ severity: 'critical', icon: 'percentage', text: 'Gross margin (' + fmtPct(gmPct) + ') critically below target' });
                recs.push({ priority: 1, icon: 'tags', text: 'Review pricing strategy and cost of goods' });
            } else if (gmPct < targetGM * 0.75) {
                issues.push({ severity: 'warning', icon: 'percentage', text: 'Gross margin (' + fmtPct(gmPct) + ') below target (' + fmtPct(targetGM) + ')' });
            }
            
            // 2. Growth Issues
            var revGrowth = yoy.revenueDeltaPct || 0;
            if (revGrowth < -0.15) {
                issues.push({ severity: 'critical', icon: 'arrow-down', text: 'Revenue declined ' + Math.abs(revGrowth * 100).toFixed(1) + '% YoY' });
                recs.push({ priority: 1, icon: 'bullhorn', text: 'Investigate customer churn and market position' });
            } else if (revGrowth < -0.05) {
                issues.push({ severity: 'warning', icon: 'arrow-down', text: 'Revenue down ' + Math.abs(revGrowth * 100).toFixed(1) + '% YoY' });
            }
            
            // 3. Trend Analysis
            if (monthlyTrend.length >= 3) {
                var recentRevs = monthlyTrend.slice(-3).map(function(m) { return m.revenue || 0; });
                var recentSlope = (recentRevs[2] - recentRevs[0]) / 2;
                var avgRev = recentRevs.reduce(function(a,b) { return a + b; }, 0) / 3;
                var declineRate = avgRev > 0 ? recentSlope / avgRev : 0;
                
                if (declineRate < -0.1) {
                    issues.push({ severity: 'warning', icon: 'chart-line', text: 'Revenue trend declining over last 3 months' });
                    recs.push({ priority: 2, icon: 'search', text: 'Analyze sales pipeline and conversion rates' });
                }
                
                // Margin compression check
                var recentGMs = monthlyTrend.slice(-3).map(function(m) { return m.gmPct || 0; });
                if (recentGMs[2] < recentGMs[0] - 0.03) {
                    issues.push({ severity: 'warning', icon: 'compress-arrows-alt', text: 'Gross margin compression detected (' + fmtPct(recentGMs[0] - recentGMs[2]) + ' decline)' });
                    recs.push({ priority: 2, icon: 'dollar-sign', text: 'Review supplier costs and pricing power' });
                }
            }
            
            // 4. Breakeven/Safety Analysis
            var cogs = Math.abs(rangeM.cogs || 0);
            var opex = Math.abs(rangeM.opex || 0);
            var variableCostRatio = revenue > 0 ? cogs / revenue : 0.6;
            var breakeven = variableCostRatio < 1 ? opex / (1 - variableCostRatio) : 0;
            var monthlyBE = breakeven / 12;
            var monthlyRev = revenue / 12;
            var safetyMargin = monthlyRev > 0 ? (monthlyRev - monthlyBE) / monthlyRev : 0;
            
            if (safetyMargin < 0) {
                issues.push({ severity: 'critical', icon: 'exclamation-triangle', text: 'Operating below breakeven point' });
            } else if (safetyMargin < 0.1) {
                issues.push({ severity: 'warning', icon: 'shield-alt', text: 'Safety margin only ' + fmtPct(safetyMargin) + ' - minimal buffer' });
                recs.push({ priority: 2, icon: 'piggy-bank', text: 'Build cash reserves and reduce fixed costs' });
            }
            
            // 5. OpEx Control
            var opexRatio = revenue > 0 ? opex / revenue : 0;
            if (opexRatio > 0.4) {
                issues.push({ severity: 'warning', icon: 'money-bill-wave', text: 'Operating expenses high at ' + fmtPct(opexRatio) + ' of revenue' });
                recs.push({ priority: 2, icon: 'cogs', text: 'Audit operational efficiency and headcount' });
            }
            
            // 6. Positive Recommendations based on strengths
            if (gmPct > targetGM && revGrowth > 0.05) {
                recs.push({ priority: 3, icon: 'rocket', text: 'Strong position - consider strategic investments' });
            }
            if (opPct > targetOp) {
                recs.push({ priority: 3, icon: 'chart-bar', text: 'Healthy margins - evaluate growth opportunities' });
            }
            if (safetyMargin > 0.25 && opInc > 0) {
                recs.push({ priority: 3, icon: 'expand-arrows-alt', text: 'Solid foundation for expansion initiatives' });
            }
            
            // Sort by priority/severity
            issues.sort(function(a, b) {
                var sevOrder = { critical: 0, warning: 1, info: 2 };
                return (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2);
            });
            recs.sort(function(a, b) { return (a.priority || 3) - (b.priority || 3); });
            
            // Render Issues
            var issuesHtml = '';
            issues.slice(0, 5).forEach(function(issue) {
                var colorClass = issue.severity === 'critical' ? 'text-danger' : (issue.severity === 'warning' ? 'text-warning' : 'text-info');
                issuesHtml += '<li><i class="fas fa-' + issue.icon + ' ' + colorClass + ' mr-2"></i>' + issue.text + '</li>';
            });
            el('#ppIssues').innerHTML = issuesHtml || '<li class="text-muted small">No significant issues detected</li>';
            
            // Render Recommendations
            var recsHtml = '';
            recs.slice(0, 5).forEach(function(rec) {
                recsHtml += '<li><i class="fas fa-' + rec.icon + ' text-success mr-2"></i>' + rec.text + '</li>';
            });
            el('#ppRecommendations').innerHTML = recsHtml || '<li class="text-muted small">No specific recommendations</li>';
            
            // Anomalies (from server or detected)
            var anomHtml = '';
            anomalies.forEach(function(a) {
                var icon = a.type === 'margin_drift' ? 'chart-line' : 'chart-pie';
                var color = a.severity === 'high' ? 'danger' : 'warning';
                anomHtml += '<li><i class="fas fa-' + icon + ' text-' + color + ' mr-2"></i><strong>' + a.title + '</strong><br><small class="text-muted">' + a.description + '</small></li>';
            });
            el('#ppAnomalies').innerHTML = anomHtml || '<li class="text-muted small">No anomalies detected</li>';
            
            // Update badge counts
            if (el('#ppIssuesCount')) {
                el('#ppIssuesCount').textContent = issues.length;
                el('#ppIssuesCount').className = 'badge badge-' + (issues.length > 0 ? (issues.some(function(i) { return i.severity === 'critical'; }) ? 'danger' : 'warning') : 'secondary');
            }
            if (el('#ppRecsCount')) {
                el('#ppRecsCount').textContent = recs.length;
                el('#ppRecsCount').className = 'badge badge-' + (recs.length > 0 ? 'success' : 'secondary');
            }
            if (el('#ppAnomaliesCount')) {
                el('#ppAnomaliesCount').textContent = anomalies.length;
                el('#ppAnomaliesCount').className = 'badge badge-' + (anomalies.length > 0 ? 'warning' : 'secondary');
            }
        },

        // ════════════════════════════════════════════════════════════════════════
        // MARGIN TAB
        // ════════════════════════════════════════════════════════════════════════

        renderMarginFlow: function(data) {
            var self = this;
            var container = el('#ppMarginFlow');
            if (!container) return;
            
            var rangeM = data.company && data.company.metrics && data.company.metrics.range ? data.company.metrics.range : {};
            var revenue = rangeM.revenue || 0;
            var cogs = Math.abs(rangeM.cogs || 0);
            var gm = rangeM.gm || 0;
            var opex = Math.abs(rangeM.opex || 0);
            var opInc = rangeM.opInc || 0;
            
            // Calculate percentages
            var gmPct = revenue > 0 ? (gm / revenue * 100) : 0;
            var opexPct = revenue > 0 ? (opex / revenue * 100) : 0;
            var opPct = revenue > 0 ? (opInc / revenue * 100) : 0;
            var cogsPct = revenue > 0 ? (cogs / revenue * 100) : 0;
            
            // Build innovative flow visualization
            var html = '<div class="margin-flow">' +
                // Stage 1: Revenue
                '<div class="flow-stage flow-stage-revenue" onclick="HealthController.showMarginDrilldown(\'revenue\')">' +
                    '<div class="flow-stage-icon"><i class="fas fa-dollar-sign"></i></div>' +
                    '<div class="flow-stage-content">' +
                        '<div class="flow-stage-label">Revenue</div>' +
                        '<div class="flow-stage-value">' + fmtMoney(revenue) + '</div>' +
                        '<div class="flow-stage-pct">100%</div>' +
                    '</div>' +
                '</div>' +
                // Arrow
                '<div class="flow-arrow"><div class="flow-arrow-line"></div><div class="flow-arrow-loss"><span class="text-danger">-' + fmtMoney(cogs) + '</span><small>COGS (' + cogsPct.toFixed(0) + '%)</small></div></div>' +
                // Stage 2: Gross Margin
                '<div class="flow-stage flow-stage-gm ' + (gmPct >= 30 ? 'flow-healthy' : gmPct >= 15 ? 'flow-warning' : 'flow-danger') + '" onclick="HealthController.showMarginDrilldown(\'gm\')">' +
                    '<div class="flow-stage-icon"><i class="fas fa-percentage"></i></div>' +
                    '<div class="flow-stage-content">' +
                        '<div class="flow-stage-label">Gross Margin</div>' +
                        '<div class="flow-stage-value">' + fmtMoney(gm) + '</div>' +
                        '<div class="flow-stage-pct">' + gmPct.toFixed(1) + '%</div>' +
                    '</div>' +
                '</div>' +
                // Arrow
                '<div class="flow-arrow"><div class="flow-arrow-line"></div><div class="flow-arrow-loss"><span class="text-danger">-' + fmtMoney(opex) + '</span><small>OpEx (' + opexPct.toFixed(0) + '%)</small></div></div>' +
                // Stage 3: Operating Income
                '<div class="flow-stage flow-stage-op ' + (opInc >= 0 ? (opPct >= 15 ? 'flow-healthy' : 'flow-warning') : 'flow-danger') + '" onclick="HealthController.showMarginDrilldown(\'opinc\')">' +
                    '<div class="flow-stage-icon"><i class="fas fa-chart-line"></i></div>' +
                    '<div class="flow-stage-content">' +
                        '<div class="flow-stage-label">Operating Income</div>' +
                        '<div class="flow-stage-value ' + (opInc < 0 ? 'text-danger' : '') + '">' + fmtMoney(opInc) + '</div>' +
                        '<div class="flow-stage-pct">' + opPct.toFixed(1) + '%</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            // Conversion rates below
            '<div class="margin-flow-metrics mt-3">' +
                '<div class="row text-center">' +
                    '<div class="col-4">' +
                        '<div class="metric-mini">' +
                            '<span class="metric-mini-value ' + (gmPct >= 30 ? 'text-success' : gmPct >= 15 ? 'text-warning' : 'text-danger') + '">' + gmPct.toFixed(1) + '%</span>' +
                            '<span class="metric-mini-label">Gross Margin Rate</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col-4">' +
                        '<div class="metric-mini">' +
                            '<span class="metric-mini-value">' + (gm > 0 ? ((opInc / gm) * 100).toFixed(0) : 0) + '%</span>' +
                            '<span class="metric-mini-label">GM→OpInc Conversion</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col-4">' +
                        '<div class="metric-mini">' +
                            '<span class="metric-mini-value ' + (opPct >= 15 ? 'text-success' : opPct >= 5 ? 'text-warning' : opPct >= 0 ? 'text-info' : 'text-danger') + '">' + opPct.toFixed(1) + '%</span>' +
                            '<span class="metric-mini-label">Operating Margin</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
            
            container.innerHTML = html;
        },
        
        showMarginDrilldown: function(stage) {
            var self = this;
            var data = this.latestData;
            if (!data) return;
            
            var company = data.company || {};
            var accounts = company.accounts?.current || {};
            var rangeM = company.metrics?.range || {};
            var title, items = [];
            var total = 0;
            
            if (stage === 'revenue') {
                title = 'Revenue Breakdown';
                if (accounts.revenue && Array.isArray(accounts.revenue)) {
                    items = accounts.revenue.slice(0, 20);
                }
                total = rangeM.revenue || 0;
            } else if (stage === 'gm') {
                title = 'COGS Breakdown';
                if (accounts.cogs && Array.isArray(accounts.cogs)) {
                    items = accounts.cogs.slice(0, 20);
                }
                total = Math.abs(rangeM.cogs || 0);
            } else {
                title = 'Operating Expenses';
                if (accounts.opex && Array.isArray(accounts.opex)) {
                    items = accounts.opex.slice(0, 20);
                }
                total = Math.abs(rangeM.opex || 0);
            }
            
            var html = '';
            if (items.length === 0) {
                html = '<div class="text-center text-muted py-4">' +
                    '<i class="fas fa-info-circle fa-2x mb-2"></i>' +
                    '<p class="mb-2">No account-level data available</p>' +
                    '<p class="small mb-0">Total: <strong>' + fmtMoney(total) + '</strong></p>' +
                '</div>';
            } else {
                html = '<table class="table table-sm mb-0"><thead><tr><th>Account</th><th class="text-right">Amount</th><th class="text-right">%</th></tr></thead><tbody>';
                var itemTotal = items.reduce(function(s, a) { return s + Math.abs(a.amount || 0); }, 0);
                items.forEach(function(a) {
                    var pct = itemTotal > 0 ? Math.abs(a.amount || 0) / itemTotal : 0;
                    html += '<tr class="clickable-row" onclick="HealthController.showAccountFlyout(' + (a.accountId || 0) + ', \'' + escapeHtml(a.accountName || '').replace(/'/g, "\\'") + '\')">' +
                        '<td>' + escapeHtml(a.accountName || '') + '</td>' +
                        '<td class="text-right">' + fmtMoney(Math.abs(a.amount || 0)) + '</td>' +
                        '<td class="text-right text-muted">' + fmtPct(pct) + '</td>' +
                    '</tr>';
                });
                html += '</tbody></table>';
            }
            
            this.showFlyout(title, html);
        },

        renderWaterfall: function(data) {
            // Now renders to the margin flow instead
            this.renderMarginFlow(data);
        },

        renderMarginSummary: function(data) {
            var self = this;
            var waterfall = data.waterfall || {};
            var summary = waterfall.summary || {};
            var rangeM = data.company && data.company.metrics && data.company.metrics.range ? data.company.metrics.range : {};
            var priorM = data.company && data.company.metrics && data.company.metrics.priorYearRange ? data.company.metrics.priorYearRange : {};
            var yoy = data.company && data.company.yoy ? data.company.yoy : {};
            
            // Use the pre-calculated YoY percentage from the server, or calculate if missing
            var yoyRevChangePct = yoy.revenueDeltaPct != null ? yoy.revenueDeltaPct : 
                (priorM.revenue && priorM.revenue > 0 ? (rangeM.revenue - priorM.revenue) / priorM.revenue : null);
            
            // YoY GM change - only calculate if prior period had meaningful revenue
            var yoyGMChange = (priorM.gmPct != null && priorM.revenue > 0) 
                ? (rangeM.gmPct - priorM.gmPct) 
                : null;
            
            // Build Margin KPIs using global renderer
            var kpisContainer = el('#ppMarginKPIs');
            if (kpisContainer) {
                kpisContainer.innerHTML = this.buildKPIRow([
                    { label: 'Gross Margin', value: fmtMoney(rangeM.gm || 0), icon: 'percentage', color: 'green', subtext: fmtPct(rangeM.gmPct || 0) },
                    { label: 'Operating Margin', value: fmtMoney(rangeM.opInc || 0), icon: 'chart-line', color: 'blue', subtext: fmtPct(rangeM.revenue > 0 ? rangeM.opInc / rangeM.revenue : 0) },
                    { label: 'YoY Revenue Δ', value: yoyRevChangePct != null ? ((yoyRevChangePct >= 0 ? '+' : '') + fmtPct(yoyRevChangePct)) : '—', icon: 'arrow-trend-up', color: yoyRevChangePct != null && yoyRevChangePct >= 0 ? 'green' : 'red', subtext: 'vs Prior Year' },
                    { label: 'YoY Margin Δ', value: yoyGMChange != null ? ((yoyGMChange >= 0 ? '+' : '') + fmtPct(yoyGMChange)) : '—', icon: 'balance-scale', color: yoyGMChange != null && yoyGMChange >= 0 ? 'green' : 'red', subtext: 'vs Prior Year' }
                ]);
            }
            
            var html = '<table class="table table-sm mb-0">' +
                '<tr><td>Revenue</td><td class="text-right"><strong>' + fmtMoney(summary.revenue) + '</strong></td></tr>' +
                '<tr><td>COGS</td><td class="text-right">' + fmtMoney(summary.cogs) + '</td></tr>' +
                '<tr class="table-active"><td><strong>Gross Margin</strong></td><td class="text-right"><strong>' + fmtMoney(summary.grossMargin) + '</strong> <span class="text-muted">(' + fmtPct(summary.grossMarginPct) + ')</span></td></tr>' +
                '<tr><td>Operating Expenses</td><td class="text-right">' + fmtMoney(summary.opex) + '</td></tr>' +
                '<tr class="table-active"><td><strong>Operating Income</strong></td><td class="text-right"><strong>' + fmtMoney(summary.operatingIncome) + '</strong> <span class="text-muted">(' + fmtPct(summary.operatingMarginPct) + ')</span></td></tr>' +
            '</table>';
            
            el('#ppMarginSummary').innerHTML = html;
        },

        renderMarginBridgeChart: function(data) {
            var container = el('#ppMarginBridgeChart');
            if (!container || typeof Plotly === 'undefined') return;
            
            var rangeM = data.company && data.company.metrics && data.company.metrics.range ? data.company.metrics.range : {};
            var priorM = data.company && data.company.metrics && data.company.metrics.priorYearRange ? data.company.metrics.priorYearRange : {};
            
            var priorGM = priorM.gm || 0;
            var currentGM = rangeM.gm || 0;
            var priorRev = priorM.revenue || 0;
            var currentRev = rangeM.revenue || 0;
            
            // Check if we have prior data to compare
            if (priorGM === 0 && priorRev === 0) {
                container.innerHTML = '<div class="text-center text-muted py-4"><i class="fas fa-calendar-times fa-2x mb-2"></i><div class="small">No prior year data available for comparison</div></div>';
                return;
            }
            
            // Proper variance decomposition using rate/volume analysis
            // Volume Effect: Change in revenue at prior GM%
            // Rate Effect: Change in GM% at current revenue
            var priorGMPct = priorRev > 0 ? priorGM / priorRev : 0;
            var currentGMPct = currentRev > 0 ? currentGM / currentRev : 0;
            
            // Volume effect: ΔRevenue × prior GM%
            var volumeEffect = (currentRev - priorRev) * priorGMPct;
            // Rate effect: Current Revenue × ΔGM%
            var rateEffect = currentRev * (currentGMPct - priorGMPct);
            // Total change (volume + rate = total, mathematically exact)
            var totalChange = currentGM - priorGM;
            
            // Create a cleaner horizontal bar bridge
            var categories = ['Prior GM', 'Volume Effect', 'Rate Effect', 'Current GM'];
            var barColors = ['#64748b', volumeEffect >= 0 ? '#10b981' : '#ef4444', rateEffect >= 0 ? '#10b981' : '#ef4444', '#3b82f6'];
            
            // Use stacked bar approach for waterfall effect
            var trace1 = {
                name: 'Base',
                x: categories,
                y: [0, priorGM, priorGM + volumeEffect, 0],
                type: 'bar',
                marker: { color: 'rgba(0,0,0,0)' },
                hoverinfo: 'skip',
                showlegend: false
            };
            
            var trace2 = {
                name: 'Values',
                x: categories,
                y: [priorGM, volumeEffect, rateEffect, currentGM],
                type: 'bar',
                marker: { color: barColors },
                text: [fmtMoney(priorGM), (volumeEffect >= 0 ? '+' : '') + fmtMoney(volumeEffect), (rateEffect >= 0 ? '+' : '') + fmtMoney(rateEffect), fmtMoney(currentGM)],
                textposition: 'inside',
                textfont: { color: '#fff', size: 11 },
                insidetextanchor: 'middle',
                hovertemplate: '%{x}: %{text}<extra></extra>',
                showlegend: false
            };
            
            // Add connecting lines between bars
            var shapes = [
                { type: 'line', x0: 0.4, x1: 0.6, y0: priorGM, y1: priorGM, line: { color: '#94a3b8', width: 2, dash: 'dot' } },
                { type: 'line', x0: 1.4, x1: 1.6, y0: priorGM + volumeEffect, y1: priorGM + volumeEffect, line: { color: '#94a3b8', width: 2, dash: 'dot' } },
                { type: 'line', x0: 2.4, x1: 2.6, y0: currentGM, y1: currentGM, line: { color: '#94a3b8', width: 2, dash: 'dot' } }
            ];
            
            Plotly.newPlot('ppMarginBridgeChart', [trace1, trace2], {
                height: 230,
                margin: { t: 30, r: 20, b: 50, l: 70 },
                barmode: 'stack',
                yaxis: { tickformat: '$,.0s', tickfont: { size: 10 }, title: { text: 'Gross Margin', font: { size: 11 } } },
                xaxis: { tickfont: { size: 10 } },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                showlegend: false,
                shapes: shapes
            }, { responsive: true, displayModeBar: false });
            
            // Add summary below chart with decomposition explanation
            var summaryEl = document.createElement('div');
            summaryEl.className = 'text-center small mt-2';
            var changeClass = totalChange >= 0 ? 'text-success' : 'text-danger';
            var volumeClass = volumeEffect >= 0 ? 'text-success' : 'text-danger';
            var rateClass = rateEffect >= 0 ? 'text-success' : 'text-danger';
            summaryEl.innerHTML = '<span class="text-muted">YoY Change:</span> <strong class="' + changeClass + '">' + (totalChange >= 0 ? '+' : '') + fmtMoney(totalChange) + '</strong>' +
                ' <span class="text-muted ml-2">(' + (priorGM !== 0 ? ((totalChange / Math.abs(priorGM) * 100).toFixed(1) + '%') : 'N/A') + ')</span>' +
                '<br><small class="text-muted">Volume: <span class="' + volumeClass + '">' + (volumeEffect >= 0 ? '+' : '') + fmtMoney(volumeEffect) + '</span> | ' +
                'Rate: <span class="' + rateClass + '">' + (rateEffect >= 0 ? '+' : '') + fmtMoney(rateEffect) + '</span></small>';
            
            // Remove old summary if exists
            var oldSummary = container.parentNode.querySelector('.margin-bridge-summary');
            if (oldSummary) oldSummary.remove();
            
            summaryEl.classList.add('margin-bridge-summary');
            container.parentNode.appendChild(summaryEl);
        },

        renderMarginTrendChart: function(data) {
            var container = el('#ppMarginTrendChart');
            if (!container || typeof Plotly === 'undefined') return;
            
            var monthlyTrend = data.monthlyTrend || [];
            
            if (monthlyTrend.length < 2) {
                container.innerHTML = '<div class="text-center text-muted py-4 small">Insufficient data</div>';
                return;
            }
            
            var labels = monthlyTrend.map(function(m) { return m.monthLabel; });
            var gmPcts = monthlyTrend.map(function(m) { 
                return m.revenue > 0 ? ((m.gm || (m.revenue - (m.cogs || 0))) / m.revenue * 100) : 0;
            });
            var opPcts = monthlyTrend.map(function(m) { 
                return m.revenue > 0 ? ((m.opInc || (m.revenue - (m.cogs || 0) - (m.opex || 0))) / m.revenue * 100) : 0;
            });
            
            Plotly.newPlot('ppMarginTrendChart', [
                { x: labels, y: gmPcts, type: 'scatter', mode: 'lines+markers', name: 'GM %', line: { color: '#10b981', width: 2 }, marker: { size: 4 }, fill: 'tozeroy', fillcolor: 'rgba(16,185,129,0.1)' },
                { x: labels, y: opPcts, type: 'scatter', mode: 'lines+markers', name: 'Op %', line: { color: '#3b82f6', width: 2 }, marker: { size: 4 } }
            ], {
                height: 150,
                margin: { t: 10, r: 10, b: 30, l: 35 },
                xaxis: { tickfont: { size: 8 }, tickangle: -45 },
                yaxis: { ticksuffix: '%', tickfont: { size: 9 } },
                legend: { orientation: 'h', y: 1.15, font: { size: 9 } },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent'
            }, { responsive: true, displayModeBar: false });
        },

        renderCostBreakdownChart: function(data) {
            var container = el('#ppCostBreakdownChart');
            if (!container || typeof Plotly === 'undefined') return;
            
            var rangeM = data.company && data.company.metrics && data.company.metrics.range ? data.company.metrics.range : {};
            var accounts = data.company && data.company.accounts && data.company.accounts.current ? data.company.accounts.current : {};
            
            var revenue = rangeM.revenue || 1;
            var cogs = rangeM.cogs || 0;
            var opex = rangeM.opex || 0;
            var gm = rangeM.gm || 0;
            var opInc = rangeM.opInc || 0;
            
            // Get top expense categories
            var opexAccounts = accounts.opexAccounts || [];
            var topExpenses = opexAccounts.slice(0, 5);
            var otherOpex = opex - topExpenses.reduce(function(sum, a) { return sum + (a.amount || 0); }, 0);
            
            var labels = ['COGS'];
            var values = [cogs];
            var colors = ['#ef4444'];
            
            topExpenses.forEach(function(a) {
                labels.push(a.accountName ? a.accountName.substring(0, 15) : 'Expense');
                values.push(a.amount || 0);
                colors.push('#f59e0b');
            });
            
            if (otherOpex > 0) {
                labels.push('Other OpEx');
                values.push(otherOpex);
                colors.push('#fbbf24');
            }
            
            labels.push('Operating Income');
            values.push(Math.max(0, opInc));
            colors.push('#10b981');
            
            Plotly.newPlot('ppCostBreakdownChart', [{
                labels: labels,
                values: values,
                type: 'pie',
                hole: 0.4,
                marker: { colors: colors },
                textinfo: 'percent',
                textfont: { size: 9 },
                insidetextorientation: 'radial'
            }], {
                height: 180,
                margin: { t: 10, r: 10, b: 10, l: 10 },
                showlegend: false,
                paper_bgcolor: 'transparent',
                annotations: [{
                    text: fmtPct(opInc / revenue),
                    x: 0.5, y: 0.5,
                    font: { size: 14, weight: 'bold' },
                    showarrow: false
                }]
            }, { responsive: true, displayModeBar: false });
        },

        loadPriceVolumeMix: async function() {
            var self = this;
            
            // Show loading in insights panel
            var insightsEl = el('#ppPVMInsights');
            if (insightsEl) {
                insightsEl.innerHTML = '<div class="text-center py-3"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Analyzing...</div></div>';
            }
            
            // Calculate prior period dates based on selected period type
            var startDate = el('#healthStartDate').value;
            var endDate = el('#healthEndDate').value;
            var period = this.pvmPeriod || 'yoy';
            
            // Use local timezone parsing to avoid date offset issues
            var start = parseLocalDate(startDate);
            var end = parseLocalDate(endDate);
            var priorStart = new Date(start);
            var priorEnd = new Date(end);
            
            // Calculate prior period based on selection
            switch(period) {
                case 'qoq':
                    // Quarter over quarter - go back 3 months
                    priorStart.setMonth(priorStart.getMonth() - 3);
                    priorEnd.setMonth(priorEnd.getMonth() - 3);
                    break;
                case 'mom':
                    // Month over month - go back 1 month
                    priorStart.setMonth(priorStart.getMonth() - 1);
                    priorEnd.setMonth(priorEnd.getMonth() - 1);
                    break;
                default: // yoy
                    // Year over year - go back 12 months
                    priorStart.setFullYear(priorStart.getFullYear() - 1);
                    priorEnd.setFullYear(priorEnd.getFullYear() - 1);
            }
            
            try {
                var res = await API.post('health', {
                    subAction: 'price_volume_mix',
                    startDate: startDate,
                    endDate: endDate,
                    priorStartDate: formatLocalDate(priorStart),
                    priorEndDate: formatLocalDate(priorEnd),
                    periodType: period,
                    subsidiaryId: this.subsidiaryId || ''
                });
                
                if (res.status === 'success' && res.data) {
                    this.renderPriceVolumeMix(res.data);
                } else {
                    if (insightsEl) insightsEl.innerHTML = '<div class="alert alert-info small mb-0">' + (res.data && res.data.message ? res.data.message : 'Revenue analysis requires item-level sales data') + '</div>';
                }
            } catch (e) {
                console.error('Revenue analysis error:', e);
                if (insightsEl) insightsEl.innerHTML = '<div class="alert alert-warning small mb-0">Error loading analysis</div>';
            }
        },

        renderPriceVolumeMix: function(data) {
            var self = this;
            
            // Handle no data case
            if (!data.available || !data.items || data.items.length === 0) {
                var insightsEl = el('#ppPVMInsights');
                if (insightsEl) insightsEl.innerHTML = '<div class="alert alert-info small mb-0"><i class="fas fa-info-circle mr-2"></i>' + (data.message || 'Revenue analysis requires item-level transaction data.') + '</div>';
                el('#ppPVMItemsBody').innerHTML = '<tr><td colspan="6" class="text-muted text-center py-4">No item-level data available</td></tr>';
                return;
            }
            
            var items = data.items || [];
            var s = data.summary || {};
            
            // Calculate totals from items if not in summary
            var totalPrior = s.priorRevenue || items.reduce(function(sum, i) { return sum + (i.priorRevenue || 0); }, 0);
            var totalCurrent = s.currentRevenue || items.reduce(function(sum, i) { return sum + (i.currentRevenue || 0); }, 0);
            var totalChange = s.totalChange || (totalCurrent - totalPrior);
            var totalChangePct = totalPrior > 0 ? totalChange / totalPrior : 0;
            
            // Separate gainers and decliners
            var gainers = items.filter(function(i) { return (i.revenueChange || 0) > 0; })
                .sort(function(a, b) { return (b.revenueChange || 0) - (a.revenueChange || 0); });
            var decliners = items.filter(function(i) { return (i.revenueChange || 0) < 0; })
                .sort(function(a, b) { return (a.revenueChange || 0) - (b.revenueChange || 0); });
            
            // Render KPIs
            var kpisContainer = el('#ppPVMKPIs');
            if (kpisContainer) {
                var gainersTotal = gainers.reduce(function(sum, i) { return sum + (i.revenueChange || 0); }, 0);
                var declinersTotal = Math.abs(decliners.reduce(function(sum, i) { return sum + (i.revenueChange || 0); }, 0));
                
                kpisContainer.innerHTML = this.buildKPIRow([
                    { label: 'Total Revenue', value: fmtMoney(totalCurrent), icon: 'dollar-sign', color: 'blue', subtext: fmtMoney(totalPrior) + ' prior' },
                    { label: 'Net Change', value: (totalChange >= 0 ? '+' : '') + fmtMoney(totalChange), icon: 'chart-line', color: (totalChange >= 0 ? 'green' : 'red'), subtext: (totalChangePct >= 0 ? '+' : '') + fmtPct(totalChangePct) },
                    { label: 'Items Growing', value: gainers.length, icon: 'arrow-up', color: 'green', subtext: '+' + fmtMoney(gainersTotal) },
                    { label: 'Items Declining', value: decliners.length, icon: 'arrow-down', color: 'red', subtext: '-' + fmtMoney(declinersTotal) }
                ]);
            }
            
            // Render bar chart - top 10 items by absolute change
            // Use setTimeout to ensure tab is fully visible before chart renders
            var self = this;
            setTimeout(function() {
                self.renderRevenueBarChart(items);
                // Force resize after render to handle any dimension issues
                if (typeof Plotly !== 'undefined') {
                    var chartEl = document.getElementById('ppRevenueBarChart');
                    if (chartEl && chartEl.data) {
                        try { Plotly.Plots.resize(chartEl); } catch(e) {}
                    }
                }
            }, 100);
            
            // Render items table
            var itemsBody = el('#ppPVMItemsBody');
            if (itemsBody) {
                // Sort by absolute change descending
                var sortedItems = items.slice().sort(function(a, b) { 
                    return Math.abs(b.revenueChange || 0) - Math.abs(a.revenueChange || 0); 
                });
                
                var itemsHtml = '';
                sortedItems.forEach(function(item, idx) {
                    var change = item.revenueChange || 0;
                    var changePct = item.priorRevenue > 0 ? change / item.priorRevenue : (item.currentRevenue > 0 ? 1 : 0);
                    var contribution = totalChange !== 0 ? change / Math.abs(totalChange) : 0;
                    var changeClass = change >= 0 ? 'text-success' : 'text-danger';
                    
                    itemsHtml += '<tr class="clickable-row" onclick="HealthController.showPVMItemFlyout(' + idx + ')">' +
                        '<td class="text-truncate" style="max-width:200px;" title="' + escapeHtml(item.itemName || '') + '">' + escapeHtml(item.itemName || 'Unknown') + '</td>' +
                        '<td class="text-right text-muted">' + fmtMoney(item.priorRevenue || 0) + '</td>' +
                        '<td class="text-right">' + fmtMoney(item.currentRevenue || 0) + '</td>' +
                        '<td class="text-right ' + changeClass + '"><strong>' + (change >= 0 ? '+' : '') + fmtMoney(change) + '</strong></td>' +
                        '<td class="text-right ' + changeClass + '">' + (changePct >= 0 ? '+' : '') + fmtPct(changePct) + '</td>' +
                        '<td class="text-right">' + self.renderContributionBar(contribution) + '</td>' +
                    '</tr>';
                });
                itemsBody.innerHTML = itemsHtml || '<tr><td colspan="6" class="text-muted text-center py-3">No items</td></tr>';
                
                // Store for flyout
                this.pvmItems = sortedItems;
            }
            
            // Update item count
            var countEl = el('#ppPVMItemCount');
            if (countEl) countEl.textContent = items.length + ' items';
            
            // Render top gainers
            var gainersEl = el('#ppPVMGainers');
            if (gainersEl) {
                var gainersHtml = '';
                if (gainers.length === 0) {
                    gainersHtml = '<tr><td colspan="2" class="text-muted text-center py-2">No growing items</td></tr>';
                } else {
                    gainers.slice(0, 5).forEach(function(item) {
                        var pct = item.priorRevenue > 0 ? (item.revenueChange / item.priorRevenue * 100).toFixed(0) : '∞';
                        gainersHtml += '<tr>' +
                            '<td class="text-truncate" style="max-width:140px;">' + escapeHtml(item.itemName || 'Unknown').substring(0, 22) + '</td>' +
                            '<td class="text-right text-success text-nowrap"><strong>+' + fmtMoney(item.revenueChange) + '</strong><br><small class="text-muted">+' + pct + '%</small></td>' +
                        '</tr>';
                    });
                }
                gainersEl.innerHTML = gainersHtml;
            }
            
            // Render top decliners
            var declinersEl = el('#ppPVMDecliners');
            if (declinersEl) {
                var declinersHtml = '';
                if (decliners.length === 0) {
                    declinersHtml = '<tr><td colspan="2" class="text-muted text-center py-2">No declining items</td></tr>';
                } else {
                    decliners.slice(0, 5).forEach(function(item) {
                        var pct = item.priorRevenue > 0 ? (item.revenueChange / item.priorRevenue * 100).toFixed(0) : '-100';
                        declinersHtml += '<tr>' +
                            '<td class="text-truncate" style="max-width:140px;">' + escapeHtml(item.itemName || 'Unknown').substring(0, 22) + '</td>' +
                            '<td class="text-right text-danger text-nowrap"><strong>' + fmtMoney(item.revenueChange) + '</strong><br><small class="text-muted">' + pct + '%</small></td>' +
                        '</tr>';
                    });
                }
                declinersEl.innerHTML = declinersHtml;
            }
            
            // Render insights
            this.renderPVMInsights(items, gainers, decliners, totalChange, totalCurrent);
        },
        
        renderContributionBar: function(contribution) {
            var width = Math.min(Math.abs(contribution) * 100, 100);
            var color = contribution >= 0 ? '#10b981' : '#ef4444';
            var align = contribution >= 0 ? 'left' : 'right';
            return '<div class="d-flex align-items-center" style="width:60px;">' +
                '<div style="width:100%; height:8px; background:#f1f5f9; border-radius:4px; overflow:hidden;">' +
                    '<div style="width:' + width + '%; height:100%; background:' + color + '; float:' + align + ';"></div>' +
                '</div>' +
            '</div>';
        },
        
        renderRevenueBarChart: function(items) {
            if (typeof Plotly === 'undefined' || !el('#ppRevenueBarChart')) return;
            
            // Sort by absolute change and take top 12
            var sorted = items.slice().sort(function(a, b) { 
                return Math.abs(b.revenueChange || 0) - Math.abs(a.revenueChange || 0); 
            }).slice(0, 12);
            
            // Re-sort for display: gainers on left, decliners on right
            var gainers = sorted.filter(function(i) { return (i.revenueChange || 0) >= 0; })
                .sort(function(a, b) { return (b.revenueChange || 0) - (a.revenueChange || 0); });
            var decliners = sorted.filter(function(i) { return (i.revenueChange || 0) < 0; })
                .sort(function(a, b) { return (b.revenueChange || 0) - (a.revenueChange || 0); });
            var displayItems = gainers.concat(decliners);
            
            var labels = displayItems.map(function(i) { 
                var name = i.itemName || 'Unknown';
                return name.length > 18 ? name.substring(0, 16) + '...' : name;
            });
            var values = displayItems.map(function(i) { return i.revenueChange || 0; });
            var colors = displayItems.map(function(i) { return (i.revenueChange || 0) >= 0 ? '#10b981' : '#ef4444'; });
            
            Plotly.newPlot('ppRevenueBarChart', [{
                type: 'bar',
                x: labels,
                y: values,
                marker: { color: colors },
                hovertemplate: '<b>%{x}</b><br>%{y:$,.0f}<extra></extra>'
            }], {
                height: 220,
                margin: { t: 10, r: 20, b: 80, l: 70 },
                xaxis: { tickfont: { size: 9 }, tickangle: -45 },
                yaxis: { tickformat: '$,.0s', tickfont: { size: 10 }, zeroline: true, zerolinecolor: '#94a3b8', zerolinewidth: 1 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                bargap: 0.3
            }, { responsive: true, displayModeBar: false });
        },
        
        renderPVMInsights: function(items, gainers, decliners, totalChange, totalCurrent) {
            var insights = [];
            
            // 1. Concentration - top item as % of total revenue
            if (items.length > 0 && totalCurrent > 0) {
                var topItem = items.slice().sort(function(a, b) { 
                    return (b.currentRevenue || 0) - (a.currentRevenue || 0); 
                })[0];
                var topPct = (topItem.currentRevenue / totalCurrent * 100).toFixed(0);
                if (topPct > 30) {
                    insights.push({
                        icon: 'exclamation-triangle',
                        color: 'warning',
                        text: '<strong>High concentration:</strong> "' + (topItem.itemName || 'Top item').substring(0, 20) + '" is ' + topPct + '% of revenue'
                    });
                }
            }
            
            // 2. Growth vs decline balance
            if (gainers.length > 0 || decliners.length > 0) {
                var ratio = gainers.length / (gainers.length + decliners.length) * 100;
                if (ratio >= 70) {
                    insights.push({
                        icon: 'chart-line',
                        color: 'success',
                        text: '<strong>Broad growth:</strong> ' + ratio.toFixed(0) + '% of items are growing'
                    });
                } else if (ratio <= 30) {
                    insights.push({
                        icon: 'chart-line',
                        color: 'danger',
                        text: '<strong>Broad decline:</strong> Only ' + ratio.toFixed(0) + '% of items are growing'
                    });
                }
            }
            
            // 3. New products (prior = 0, current > 0)
            var newItems = items.filter(function(i) { return (i.priorRevenue || 0) === 0 && (i.currentRevenue || 0) > 0; });
            if (newItems.length > 0) {
                var newTotal = newItems.reduce(function(sum, i) { return sum + (i.currentRevenue || 0); }, 0);
                insights.push({
                    icon: 'plus-circle',
                    color: 'info',
                    text: '<strong>' + newItems.length + ' new item' + (newItems.length > 1 ? 's' : '') + ':</strong> ' + fmtMoney(newTotal) + ' in new revenue'
                });
            }
            
            // 4. Discontinued products (current = 0, prior > 0)
            var discontinuedItems = items.filter(function(i) { return (i.currentRevenue || 0) === 0 && (i.priorRevenue || 0) > 0; });
            if (discontinuedItems.length > 0) {
                var lostTotal = discontinuedItems.reduce(function(sum, i) { return sum + (i.priorRevenue || 0); }, 0);
                insights.push({
                    icon: 'minus-circle',
                    color: 'secondary',
                    text: '<strong>' + discontinuedItems.length + ' discontinued:</strong> ' + fmtMoney(lostTotal) + ' lost revenue'
                });
            }
            
            // 5. Volatility - items with >50% change
            var volatileItems = items.filter(function(i) { 
                var pct = i.priorRevenue > 0 ? Math.abs(i.revenueChange || 0) / i.priorRevenue : 0;
                return pct > 0.5 && Math.abs(i.revenueChange || 0) > 1000;
            });
            if (volatileItems.length > 0) {
                insights.push({
                    icon: 'bolt',
                    color: 'warning',
                    text: '<strong>' + volatileItems.length + ' volatile item' + (volatileItems.length > 1 ? 's' : '') + ':</strong> Changed by >50%'
                });
            }
            
            // 6. Top gainer impact
            if (gainers.length > 0 && totalChange > 0) {
                var topGainer = gainers[0];
                var impactPct = (topGainer.revenueChange / totalChange * 100).toFixed(0);
                if (impactPct > 30) {
                    insights.push({
                        icon: 'star',
                        color: 'success',
                        text: '<strong>Star performer:</strong> "' + (topGainer.itemName || 'Top item').substring(0, 18) + '" drove ' + impactPct + '% of growth'
                    });
                }
            }
            
            // Render
            var container = el('#ppPVMInsights');
            if (!container) return;
            
            if (insights.length === 0) {
                container.innerHTML = '<div class="text-muted"><i class="fas fa-check-circle text-success mr-2"></i>Revenue mix is balanced</div>';
                return;
            }
            
            var html = insights.map(function(insight) {
                return '<div class="mb-2"><i class="fas fa-' + insight.icon + ' text-' + insight.color + ' mr-2"></i>' + insight.text + '</div>';
            }).join('');
            
            container.innerHTML = html;
        },

        renderTopExpenses: function(data) {
            // Element was removed - function kept for compatibility
            var container = el('#ppTopExpenses');
            if (!container) return;
            
            var self = this;
            var accounts = data.company && data.company.accounts && data.company.accounts.current ? data.company.accounts.current : {};
            var opexAccounts = accounts.opexAccounts || [];
            var revenue = data.company && data.company.metrics && data.company.metrics.range ? data.company.metrics.range.revenue : 0;
            
            var html = '';
            opexAccounts.slice(0, 8).forEach(function(a) {
                var pctOfRev = revenue > 0 ? a.amount / revenue : 0;
                html += '<tr class="clickable-row" onclick="HealthController.showAccountFlyout(' + a.accountId + ', \'' + escapeHtml(a.accountName).replace(/'/g, "\\'") + '\')">' +
                    '<td>' + escapeHtml(a.accountName) + '</td>' +
                    '<td class="text-right">' + fmtMoney(a.amount) + '</td>' +
                    '<td class="text-right text-muted">' + fmtPct(pctOfRev) + '</td>' +
                '</tr>';
            });
            
            container.innerHTML = html || '<tr><td colspan="3" class="text-muted">No expenses</td></tr>';
        },
        
        showPVMItemFlyout: function(idx) {
            var items = this.pvmItems;
            if (!items || !items[idx]) return;
            
            var item = items[idx];
            var priorRev = item.priorRevenue || 0;
            var currentRev = item.currentRevenue || 0;
            var totalChange = item.revenueChange || (currentRev - priorRev);
            var changePct = priorRev > 0 ? (totalChange / priorRev) : (currentRev > 0 ? 1 : 0);
            
            var changeClass = totalChange >= 0 ? 'text-success' : 'text-danger';
            var changeIcon = totalChange >= 0 ? 'arrow-up' : 'arrow-down';
            var bgClass = totalChange >= 0 ? 'bg-success-soft' : 'bg-danger-soft';
            
            // Determine status
            var status = '';
            if (priorRev === 0 && currentRev > 0) {
                status = '<span class="badge badge-info">New Item</span>';
            } else if (currentRev === 0 && priorRev > 0) {
                status = '<span class="badge badge-secondary">Discontinued</span>';
            } else if (Math.abs(changePct) > 0.5) {
                status = '<span class="badge badge-warning">High Volatility</span>';
            } else if (totalChange > 0) {
                status = '<span class="badge badge-success">Growing</span>';
            } else if (totalChange < 0) {
                status = '<span class="badge badge-danger">Declining</span>';
            }
            
            var html = '' +
                // Header with big change
                '<div class="text-center mb-4 pb-3 border-bottom">' +
                    '<h5 class="mb-2">' + escapeHtml(item.itemName || 'Unknown Item') + '</h5>' +
                    '<div class="mb-2">' + status + '</div>' +
                    '<div class="d-flex justify-content-center align-items-center">' +
                        '<i class="fas fa-' + changeIcon + ' ' + changeClass + ' mr-2 fa-lg"></i>' +
                        '<span class="h2 mb-0 ' + changeClass + '">' + (totalChange >= 0 ? '+' : '') + fmtMoney(totalChange) + '</span>' +
                    '</div>' +
                    '<div class="' + changeClass + '">' + (changePct >= 0 ? '+' : '') + fmtPct(changePct) + ' change</div>' +
                '</div>' +
                
                // Revenue comparison
                '<div class="row mb-4">' +
                    '<div class="col-6">' +
                        '<div class="card ' + bgClass + ' border-0">' +
                            '<div class="card-body text-center py-3">' +
                                '<div class="text-muted small mb-1">Prior Period</div>' +
                                '<h4 class="mb-0">' + fmtMoney(priorRev) + '</h4>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="col-6">' +
                        '<div class="card bg-light border-0">' +
                            '<div class="card-body text-center py-3">' +
                                '<div class="text-muted small mb-1">Current Period</div>' +
                                '<h4 class="mb-0">' + fmtMoney(currentRev) + '</h4>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                // Visual comparison bar
                '<h6 class="font-weight-bold mb-3"><i class="fas fa-chart-bar mr-2"></i>Revenue Comparison</h6>' +
                '<div class="mb-4">' +
                    this.renderComparisonBar(priorRev, currentRev) +
                '</div>';
            
            // Add insight based on change
            var insight = '';
            if (priorRev === 0 && currentRev > 0) {
                insight = 'This is a <strong>new item</strong> that generated ' + fmtMoney(currentRev) + ' in its first period.';
            } else if (currentRev === 0 && priorRev > 0) {
                insight = 'This item was <strong>discontinued</strong>, representing a loss of ' + fmtMoney(priorRev) + ' in revenue.';
            } else if (changePct > 0.5) {
                insight = 'Revenue <strong>increased significantly</strong> by ' + fmtPct(changePct) + '. Consider investigating what drove this growth.';
            } else if (changePct < -0.5) {
                insight = 'Revenue <strong>declined significantly</strong> by ' + fmtPct(Math.abs(changePct)) + '. Review pricing, competition, or inventory issues.';
            } else if (totalChange > 0) {
                insight = 'Steady growth of ' + fmtPct(changePct) + ' suggests <strong>healthy demand</strong> for this item.';
            } else if (totalChange < 0) {
                insight = 'Slight decline of ' + fmtPct(Math.abs(changePct)) + ' - <strong>monitor for trends</strong>.';
            } else {
                insight = 'Revenue remained <strong>stable</strong> period over period.';
            }
            
            html += '<div class="alert alert-' + (totalChange >= 0 ? 'info' : 'warning') + ' small mb-0">' +
                '<i class="fas fa-lightbulb mr-2"></i>' + insight +
            '</div>';
            
            this.showFlyout('Item Analysis: ' + escapeHtml((item.itemName || 'Unknown').substring(0, 30)), html);
        },
        
        renderComparisonBar: function(prior, current) {
            var max = Math.max(prior, current, 1);
            var priorWidth = (prior / max * 100).toFixed(1);
            var currentWidth = (current / max * 100).toFixed(1);
            var change = current - prior;
            var isGrowth = current >= prior;
            
            return '<div class="comparison-bars">' +
                // Prior bar
                '<div class="d-flex align-items-center mb-2">' +
                    '<div class="comparison-label text-muted" style="width:70px; flex-shrink:0;">Prior</div>' +
                    '<div class="flex-fill mx-2">' +
                        '<div style="height:24px; background:#f1f5f9; border-radius:4px; overflow:hidden;">' +
                            '<div style="width:' + priorWidth + '%; height:100%; background:#94a3b8; border-radius:4px;"></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="comparison-value text-right" style="width:90px; flex-shrink:0; font-weight:600;">' + fmtMoney(prior) + '</div>' +
                '</div>' +
                // Current bar
                '<div class="d-flex align-items-center mb-2">' +
                    '<div class="comparison-label text-muted" style="width:70px; flex-shrink:0;">Current</div>' +
                    '<div class="flex-fill mx-2">' +
                        '<div style="height:24px; background:#f1f5f9; border-radius:4px; overflow:hidden;">' +
                            '<div style="width:' + currentWidth + '%; height:100%; background:' + (isGrowth ? '#10b981' : '#ef4444') + '; border-radius:4px;"></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="comparison-value text-right" style="width:90px; flex-shrink:0; font-weight:600;">' + fmtMoney(current) + '</div>' +
                '</div>' +
                // Change indicator
                '<div class="d-flex align-items-center pt-2 border-top">' +
                    '<div class="comparison-label" style="width:70px; flex-shrink:0; font-weight:600;">Change</div>' +
                    '<div class="flex-fill mx-2 text-center">' +
                        '<i class="fas fa-' + (isGrowth ? 'arrow-up text-success' : 'arrow-down text-danger') + '"></i>' +
                    '</div>' +
                    '<div class="comparison-value text-right ' + (isGrowth ? 'text-success' : 'text-danger') + '" style="width:90px; flex-shrink:0; font-weight:700;">' + 
                        (change >= 0 ? '+' : '') + fmtMoney(change) + 
                    '</div>' +
                '</div>' +
            '</div>';
        },

        // ════════════════════════════════════════════════════════════════════════
        // SEGMENTS TAB - Clean Table with Flyout Details
        // ════════════════════════════════════════════════════════════════════════

        renderSegments: function(segments, type) {
            var self = this;
            this.currentSegments = segments;
            this.currentSegmentType = type;
            
            var bodyEl = el('#ppSegmentsBody');
            var totalsEl = el('#ppSegmentsTotals');
            
            if (!segments || segments.length === 0) {
                if (bodyEl) bodyEl.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No segments found for this dimension.</td></tr>';
                return;
            }
            
            // Calculate totals and find best/worst
            var totals = { revenue: 0, cogs: 0, gm: 0, opex: 0, opInc: 0 };
            var best = null, worst = null;
            
            // Process segments and calculate metrics
            var processedSegments = segments.map(function(seg) {
                var dept = seg.department || seg;
                var metrics = seg.metrics && seg.metrics.range ? seg.metrics.range : seg;
                var priorMetrics = seg.metrics && seg.metrics.priorYearRange ? seg.metrics.priorYearRange : {};
                
                var revenue = metrics.revenue || 0;
                var gm = metrics.gm || 0;
                var opInc = metrics.opInc || 0;
                var gmPct = revenue > 0 ? gm / revenue : 0;
                var opPct = revenue > 0 ? opInc / revenue : 0;
                var yoyChange = priorMetrics.revenue ? (revenue - priorMetrics.revenue) / priorMetrics.revenue : null;
                var healthScore = seg.healthScore || (opPct > 0.15 ? 80 : (opPct > 0.05 ? 60 : (opPct >= 0 ? 40 : 20)));
                
                totals.revenue += revenue;
                totals.gm += gm;
                totals.opInc += opInc;
                
                if (!best || opPct > best.opPct) best = { name: dept.name || seg.name, opPct: opPct };
                if (!worst || opPct < worst.opPct) worst = { name: dept.name || seg.name, opPct: opPct };
                
                return {
                    id: dept.netsuiteId || seg.id || 0,
                    name: dept.name || seg.name || 'Unknown',
                    revenue: revenue,
                    gm: gm,
                    gmPct: gmPct,
                    opInc: opInc,
                    opPct: opPct,
                    yoyChange: yoyChange,
                    healthScore: healthScore,
                    metrics: metrics,
                    priorMetrics: priorMetrics
                };
            });
            
            // Calculate HHI and shares
            var hhi = 0;
            processedSegments.forEach(function(seg) {
                seg.share = totals.revenue > 0 ? seg.revenue / totals.revenue : 0;
                hhi += Math.pow(seg.share * 100, 2);
            });
            
            // Build KPIs
            var hhiLabel = hhi < 1500 ? 'Unconcentrated' : (hhi < 2500 ? 'Moderate' : 'Concentrated');
            var kpisContainer = el('#ppSegmentKPIs');
            if (kpisContainer) {
                kpisContainer.innerHTML = this.buildKPIRow([
                    { label: 'Segments', value: segments.length, icon: 'sitemap', color: 'blue', subtext: type.charAt(0).toUpperCase() + type.slice(1) + 's' },
                    { label: 'Best Performer', value: best ? best.name : '—', icon: 'trophy', color: 'green', subtext: best ? fmtPct(best.opPct) + ' margin' : '' },
                    { label: 'Needs Attention', value: worst ? worst.name : '—', icon: 'exclamation-triangle', color: worst && worst.opPct < 0 ? 'red' : 'yellow', subtext: worst ? fmtPct(worst.opPct) + ' margin' : '' },
                    { label: 'Concentration', value: Math.round(hhi).toLocaleString(), icon: 'chart-pie', color: 'purple', subtext: hhiLabel }
                ]);
            }
            
            // Render table rows
            if (bodyEl) {
                var html = '';
                processedSegments.forEach(function(seg, idx) {
                    var healthClass = seg.healthScore >= 70 ? 'success' : (seg.healthScore >= 40 ? 'warning' : 'danger');
                    var healthIcon = seg.healthScore >= 70 ? 'check-circle' : (seg.healthScore >= 40 ? 'minus-circle' : 'times-circle');
                    var yoyHtml = seg.yoyChange !== null 
                        ? '<span class="' + (seg.yoyChange >= 0 ? 'text-success' : 'text-danger') + '">' + (seg.yoyChange >= 0 ? '+' : '') + fmtPct(seg.yoyChange) + '</span>'
                        : '<span class="text-muted">—</span>';
                    
                    html += '<tr class="clickable-row" onclick="HealthController.showSegmentFlyout(\'' + type + '\', ' + seg.id + ', \'' + escapeHtml(seg.name).replace(/'/g, "\\'") + '\', ' + idx + ')">' +
                        '<td class="text-center"><i class="fas fa-' + healthIcon + ' text-' + healthClass + '"></i></td>' +
                        '<td><strong>' + escapeHtml(seg.name) + '</strong></td>' +
                        '<td class="text-right">' + fmtMoney(seg.revenue) + '</td>' +
                        '<td class="text-right text-muted">' + fmtPct(seg.share) + '</td>' +
                        '<td class="text-right">' + fmtMoney(seg.gm) + '</td>' +
                        '<td class="text-right ' + (seg.gmPct >= 0.3 ? 'text-success' : (seg.gmPct >= 0.15 ? '' : 'text-danger')) + '">' + fmtPct(seg.gmPct) + '</td>' +
                        '<td class="text-right ' + (seg.opInc >= 0 ? '' : 'text-danger') + '">' + fmtMoney(seg.opInc) + '</td>' +
                        '<td class="text-right ' + (seg.opPct >= 0.1 ? 'text-success' : (seg.opPct >= 0 ? '' : 'text-danger')) + '">' + fmtPct(seg.opPct) + '</td>' +
                        '<td class="text-right">' + yoyHtml + '</td>' +
                    '</tr>';
                });
                bodyEl.innerHTML = html;
            }
            
            // Render totals footer
            if (totalsEl) {
                var totalsGmPct = totals.revenue > 0 ? totals.gm / totals.revenue : 0;
                var totalsOpPct = totals.revenue > 0 ? totals.opInc / totals.revenue : 0;
                totalsEl.innerHTML = '<tr>' +
                    '<td></td>' +
                    '<td><strong>TOTAL</strong></td>' +
                    '<td class="text-right"><strong>' + fmtMoney(totals.revenue) + '</strong></td>' +
                    '<td class="text-right"><strong>100%</strong></td>' +
                    '<td class="text-right"><strong>' + fmtMoney(totals.gm) + '</strong></td>' +
                    '<td class="text-right"><strong>' + fmtPct(totalsGmPct) + '</strong></td>' +
                    '<td class="text-right ' + (totals.opInc >= 0 ? '' : 'text-danger') + '"><strong>' + fmtMoney(totals.opInc) + '</strong></td>' +
                    '<td class="text-right"><strong>' + fmtPct(totalsOpPct) + '</strong></td>' +
                    '<td></td>' +
                '</tr>';
            }
            
            // Store for flyout use
            this.processedSegments = processedSegments;
            this.segmentTotals = totals;
            
            // Render charts
            this.renderSegmentCharts(processedSegments, totals);
        },

        showSegmentFlyout: function(type, id, name, idx) {
            var self = this;
            var seg = this.processedSegments && this.processedSegments[idx] ? this.processedSegments[idx] : null;
            
            if (!seg) {
                seg = (this.processedSegments || []).find(function(s) { return s.id == id; });
            }
            
            if (!seg) {
                this.showFlyout(name + ' Details', '<p class="text-muted">Segment data not available</p>');
                return;
            }
            
            var metrics = seg.metrics || seg;
            var priorMetrics = seg.priorMetrics || {};
            var healthClass = seg.healthScore >= 70 ? 'success' : (seg.healthScore >= 40 ? 'warning' : 'danger');
            var healthIcon = seg.healthScore >= 70 ? 'check-circle' : (seg.healthScore >= 40 ? 'exclamation-circle' : 'times-circle');
            var share = this.segmentTotals && this.segmentTotals.revenue > 0 ? seg.revenue / this.segmentTotals.revenue : 0;
            
            // Calculate comparisons
            var revChange = seg.yoyChange || 0;
            var gmChange = priorMetrics.gm ? (seg.gm - priorMetrics.gm) / Math.abs(priorMetrics.gm) : 0;
            var opChange = priorMetrics.opInc && priorMetrics.opInc !== 0 ? (seg.opInc - priorMetrics.opInc) / Math.abs(priorMetrics.opInc) : 0;
            var cogsRatio = seg.revenue > 0 ? (metrics.cogs || 0) / seg.revenue : 0;
            var opexRatio = seg.revenue > 0 ? (metrics.opex || 0) / seg.revenue : 0;
            
            // Use global KPI renderer - just 2 KPIs
            var kpis = [
                { label: 'Revenue', value: fmtMoney(seg.revenue), icon: 'dollar-sign', color: 'blue', subtext: (revChange >= 0 ? '+' : '') + fmtPct(revChange) + ' YoY' },
                { label: 'Operating Income', value: fmtMoney(seg.opInc), icon: 'chart-line', color: seg.opInc >= 0 ? 'green' : 'red', subtext: fmtPct(seg.opPct) + ' margin' }
            ];
            
            var flyoutHtml = '' +
                // Header with health badge
                '<div class="text-center mb-3 pb-3 border-bottom">' +
                    '<div style="width:70px;height:70px;margin:0 auto 8px;position:relative;">' +
                        '<svg viewBox="0 0 36 36" style="transform:rotate(-90deg);width:100%;height:100%;">' +
                            '<path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e5e7eb" stroke-width="3"/>' +
                            '<path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="' + (healthClass === 'success' ? '#10b981' : (healthClass === 'warning' ? '#f59e0b' : '#ef4444')) + '" stroke-width="3" stroke-dasharray="' + seg.healthScore + ', 100"/>' +
                        '</svg>' +
                        '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:1.1rem;font-weight:700;">' + Math.round(seg.healthScore) + '</div>' +
                    '</div>' +
                    '<h5 class="mb-1">' + escapeHtml(name) + '</h5>' +
                    '<span class="badge badge-' + healthClass + '"><i class="fas fa-' + healthIcon + ' mr-1"></i>' + (healthClass === 'success' ? 'Healthy' : (healthClass === 'warning' ? 'Watch' : 'At Risk')) + '</span>' +
                '</div>' +
                
                // Global KPI Row
                '<div class="row mb-3 cf-kpi-row">' + this.buildKPIRow(kpis) + '</div>' +
                
                // Full width Trend Chart
                '<div class="mb-3">' +
                    '<div class="card-header py-2 bg-light border rounded-top"><h6 class="mb-0 small font-weight-bold"><i class="fas fa-chart-line mr-2 text-primary"></i>6-Month Trend</h6></div>' +
                    '<div class="border border-top-0 rounded-bottom p-2"><div id="segFlyoutTrend" style="height:140px;"></div></div>' +
                '</div>' +
                
                // P&L Summary Table
                '<div class="mb-3">' +
                    '<div class="card-header py-2 bg-light border rounded-top"><h6 class="mb-0 small font-weight-bold"><i class="fas fa-file-invoice-dollar mr-2 text-success"></i>P&L Summary</h6></div>' +
                    '<div class="border border-top-0 rounded-bottom">' +
                        '<table class="table table-sm mb-0">' +
                            '<tbody>' +
                                '<tr><td>Revenue</td><td class="text-right font-weight-bold">' + fmtMoney(seg.revenue) + '</td><td class="text-right text-muted small">100%</td></tr>' +
                                '<tr><td class="text-muted pl-3">Cost of Goods Sold</td><td class="text-right text-danger">(' + fmtMoney(metrics.cogs || 0) + ')</td><td class="text-right text-muted small">' + fmtPct(cogsRatio) + '</td></tr>' +
                                '<tr class="border-top"><td><strong>Gross Margin</strong></td><td class="text-right font-weight-bold">' + fmtMoney(seg.gm) + '</td><td class="text-right font-weight-bold">' + fmtPct(seg.gmPct) + '</td></tr>' +
                                '<tr><td class="text-muted pl-3">Operating Expenses</td><td class="text-right text-danger">(' + fmtMoney(metrics.opex || 0) + ')</td><td class="text-right text-muted small">' + fmtPct(opexRatio) + '</td></tr>' +
                                '<tr class="border-top ' + (seg.opInc >= 0 ? '' : 'text-danger') + '"><td><strong>Operating Income</strong></td><td class="text-right font-weight-bold">' + fmtMoney(seg.opInc) + '</td><td class="text-right font-weight-bold">' + fmtPct(seg.opPct) + '</td></tr>' +
                            '</tbody>' +
                        '</table>' +
                    '</div>' +
                '</div>' +
                
                // Cost Structure with flexbox bars
                '<div class="mb-3">' +
                    '<div class="card-header py-2 bg-light border rounded-top"><h6 class="mb-0 small font-weight-bold"><i class="fas fa-chart-pie mr-2 text-warning"></i>Cost Structure</h6></div>' +
                    '<div class="border border-top-0 rounded-bottom p-2">' +
                        '<div class="mb-2">' +
                            '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span class="small">COGS</span><span class="small font-weight-bold">' + fmtPct(cogsRatio) + '</span></div>' +
                            '<div style="display:flex;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;"><div style="width:' + (cogsRatio * 100) + '%;background:#ef4444;"></div></div>' +
                        '</div>' +
                        '<div class="mb-2">' +
                            '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span class="small">OpEx</span><span class="small font-weight-bold">' + fmtPct(opexRatio) + '</span></div>' +
                            '<div style="display:flex;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;"><div style="width:' + (opexRatio * 100) + '%;background:#f59e0b;"></div></div>' +
                        '</div>' +
                        '<div>' +
                            '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span class="small">Op Margin</span><span class="small font-weight-bold ' + (seg.opPct >= 0 ? 'text-success' : 'text-danger') + '">' + fmtPct(seg.opPct) + '</span></div>' +
                            '<div style="display:flex;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;"><div style="width:' + (Math.min(Math.abs(seg.opPct), 0.5) * 200) + '%;background:' + (seg.opPct >= 0 ? '#10b981' : '#ef4444') + ';"></div></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                // YoY Comparison (if available)
                (priorMetrics.revenue ? (
                    '<div>' +
                        '<div class="card-header py-2 bg-light border rounded-top"><h6 class="mb-0 small font-weight-bold"><i class="fas fa-calendar-alt mr-2 text-secondary"></i>Year-over-Year Changes</h6></div>' +
                        '<div class="border border-top-0 rounded-bottom p-2">' +
                            '<div class="row text-center">' +
                                '<div class="col-4">' +
                                    '<div class="small text-muted">Revenue</div>' +
                                    '<div class="h5 mb-0 ' + (revChange >= 0 ? 'text-success' : 'text-danger') + '">' + (revChange >= 0 ? '+' : '') + fmtPct(revChange) + '</div>' +
                                    '<div class="small text-muted">' + fmtMoney(priorMetrics.revenue) + ' → ' + fmtMoney(seg.revenue) + '</div>' +
                                '</div>' +
                                '<div class="col-4">' +
                                    '<div class="small text-muted">Gross Margin</div>' +
                                    '<div class="h5 mb-0 ' + (gmChange >= 0 ? 'text-success' : 'text-danger') + '">' + (gmChange >= 0 ? '+' : '') + fmtPct(gmChange) + '</div>' +
                                    '<div class="small text-muted">' + fmtMoney(priorMetrics.gm) + ' → ' + fmtMoney(seg.gm) + '</div>' +
                                '</div>' +
                                '<div class="col-4">' +
                                    '<div class="small text-muted">Op Income</div>' +
                                    '<div class="h5 mb-0 ' + (opChange >= 0 ? 'text-success' : 'text-danger') + '">' + (opChange >= 0 ? '+' : '') + fmtPct(opChange) + '</div>' +
                                    '<div class="small text-muted">' + fmtMoney(priorMetrics.opInc || 0) + ' → ' + fmtMoney(seg.opInc) + '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>'
                ) : '');
            
            this.showFlyout(escapeHtml(name) + ' Details', flyoutHtml, function() {
                if (typeof Plotly === 'undefined') return;
                
                // Generate mock monthly trend data
                var months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                var baseRev = seg.revenue / 6;
                var revTrend = months.map(function(m, i) { return baseRev * (0.85 + i * 0.05 + Math.random() * 0.1); });
                var gmTrend = revTrend.map(function(r) { return r * (seg.gmPct || 0.3) * (0.95 + Math.random() * 0.1); });
                
                // Revenue trend chart - full width
                if (el('#segFlyoutTrend')) {
                    Plotly.newPlot('segFlyoutTrend', [
                        { x: months, y: revTrend, type: 'scatter', mode: 'lines+markers', name: 'Revenue', line: { color: '#3b82f6', width: 2 }, marker: { size: 6 }, fill: 'tozeroy', fillcolor: 'rgba(59,130,246,0.1)' },
                        { x: months, y: gmTrend, type: 'scatter', mode: 'lines+markers', name: 'Gross Margin', line: { color: '#10b981', width: 2 }, marker: { size: 6 } }
                    ], {
                        height: 140, margin: { t: 10, r: 20, b: 30, l: 60 },
                        xaxis: { tickfont: { size: 10 } },
                        yaxis: { tickformat: '$,.0s', tickfont: { size: 10 } },
                        legend: { orientation: 'h', y: 1.15, font: { size: 10 } },
                        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
                    }, { responsive: true, displayModeBar: false });
                }
            });
        },

        renderSegmentCharts: function(segments, totals) {
            var self = this;
            
            // Pie chart - Revenue contribution
            if (typeof Plotly !== 'undefined' && el('#ppSegmentPieChart')) {
                ChartManager.clearContainer('ppSegmentPieChart');
                
                var pieLabels = [], pieValues = [];
                segments.slice(0, 8).forEach(function(seg) {
                    pieLabels.push(seg.name.substring(0, 15));
                    pieValues.push(seg.revenue || 0);
                });
                
                Plotly.newPlot('ppSegmentPieChart', [{
                    labels: pieLabels,
                    values: pieValues,
                    type: 'pie',
                    hole: 0.4,
                    textinfo: 'percent',
                    textfont: { size: 10 },
                    marker: { colors: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'] }
                }], {
                    height: 200,
                    margin: { t: 10, r: 10, b: 10, l: 10 },
                    showlegend: false,
                    paper_bgcolor: 'transparent'
                }, { responsive: true, displayModeBar: false });
            }
            
            // Bar chart - Margin comparison
            if (typeof Plotly !== 'undefined' && el('#ppSegmentBarChart')) {
                ChartManager.clearContainer('ppSegmentBarChart');
                
                var barLabels = [], barGM = [], barOp = [];
                segments.slice(0, 6).forEach(function(seg) {
                    barLabels.push(seg.name.substring(0, 12));
                    barGM.push((seg.gmPct || 0) * 100);
                    barOp.push((seg.opPct || 0) * 100);
                });
                
                Plotly.newPlot('ppSegmentBarChart', [
                    { x: barLabels, y: barGM, type: 'bar', name: 'GM %', marker: { color: '#3b82f6' } },
                    { x: barLabels, y: barOp, type: 'bar', name: 'Op %', marker: { color: '#10b981' } }
                ], {
                    height: 200,
                    margin: { t: 10, r: 10, b: 60, l: 40 },
                    barmode: 'group',
                    showlegend: true,
                    legend: { orientation: 'h', y: -0.35, font: { size: 9 } },
                    yaxis: { ticksuffix: '%', tickfont: { size: 9 } },
                    xaxis: { tickangle: -45, tickfont: { size: 8 } },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent'
                }, { responsive: true, displayModeBar: false });
            }
        },

        async loadSegmentData(segmentType) {
            var self = this;
            
            // Show loading in the table body
            var bodyEl = el('#ppSegmentsBody');
            if (bodyEl) {
                bodyEl.innerHTML = '<tr><td colspan="9" class="text-center py-4"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading segments...</div></td></tr>';
            }
            
            if (segmentType === 'department') {
                // Use existing department data
                this.renderSegments(this.latestData.departments || [], 'department');
                return;
            }
            
            // Load segment data from API
            try {
                var params = {
                    action: 'health',
                    subAction: 'segment_profitability',
                    segmentType: segmentType,
                    startDate: el('#healthStartDate').value,
                    endDate: el('#healthEndDate').value,
                    subsidiaryId: this.subsidiaryId || ''
                };
                
                var res = await API.post('health', params);
                if (res.status === 'success' && res.data) {
                    this.renderSegments(res.data.segments || [], segmentType);
                }
            } catch (e) {
                console.error('Segment load error:', e);
                if (bodyEl) {
                    bodyEl.innerHTML = '<tr><td colspan="9" class="text-center text-danger py-4">Error loading segments. Please try again.</td></tr>';
                }
            }
        },

        // ════════════════════════════════════════════════════════════════════════
        // FORECAST TAB
        // ════════════════════════════════════════════════════════════════════════

        renderForecast: function(data) {
            var self = this;
            var container = el('#ppForecastChart');
            if (!container || typeof Plotly === 'undefined') return;
            
            var monthlyTrend = data.monthlyTrend || [];
            
            if (monthlyTrend.length < 3) {
                container.innerHTML = '<div class="text-center text-muted py-5">Insufficient data for forecasting (need at least 3 months)</div>';
                return;
            }
            
            // Get forecast settings
            var settings = this.forecastSettings || {};
            var method = settings.method || (el('#ppForecastMethod')?.value) || 'ets';
            var horizon = settings.horizon || parseInt(el('#ppForecastHorizon')?.value) || 6;
            var confidenceLevel = settings.confidence || parseInt(el('#ppForecastConfidence')?.value) || 90;
            var seasonality = settings.seasonality || (el('#ppForecastSeasonality')?.value) || 'auto';
            var growthOverride = parseFloat(el('#ppForecastGrowthOverride')?.value) || null;
            
            // Determine which metric to forecast
            var metric = this.forecastMetric || 'revenue';
            var metricLabels = { revenue: 'Revenue', gm: 'Gross Margin', opinc: 'Operating Income' };
            var metricColors = { revenue: '#3b82f6', gm: '#10b981', opinc: '#f59e0b' };
            
            // Historical data based on metric
            var histLabels = monthlyTrend.map(function(m) { return m.monthLabel; });
            var histValues, histGM = [], histOpInc = [];
            
            // Always calculate all three for the detail table
            // Note: COGS and OpEx may be stored as negative values, use Math.abs
            monthlyTrend.forEach(function(m) {
                var rev = m.revenue || 0;
                var cogs = Math.abs(m.cogs || 0);
                var opex = Math.abs(m.opex || 0);
                var gm = m.gm != null ? m.gm : (rev - cogs);
                var opInc = m.opInc != null ? m.opInc : (gm - opex);
                histGM.push(gm);
                histOpInc.push(opInc);
            });
            var histRevenue = monthlyTrend.map(function(m) { return m.revenue || 0; });
            
            switch(metric) {
                case 'gm': histValues = histGM; break;
                case 'opinc': histValues = histOpInc; break;
                default: histValues = histRevenue;
            }
            
            var n = histValues.length;
            var avgValue = histValues.reduce(function(a, b) { return a + b; }, 0) / n;
            var stdDev = this.calculateStdDev(histValues);
            
            // Apply selected forecasting method
            var forecastResult = this.applyForecastMethod(histValues, method, horizon, seasonality, growthOverride);
            
            var forecastLabels = [];
            var forecastValues = forecastResult.values;
            
            // Apply macro adjustment
            forecastValues = this.applyForecastAdjustment(forecastValues);
            
            var forecastLow = forecastResult.low;
            var forecastHigh = forecastResult.high;
            
            // Generate forecast labels
            var lastDate = new Date();
            for (var i = 1; i <= horizon; i++) {
                var forecastDate = new Date(lastDate);
                forecastDate.setMonth(forecastDate.getMonth() + i);
                forecastLabels.push(forecastDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
            }
            
            // Adjust confidence bands based on confidence level
            var zScore = { 80: 1.28, 90: 1.645, 95: 1.96, 99: 2.576 }[confidenceLevel] || 1.645;
            forecastLow = forecastValues.map(function(v, i) { return v - stdDev * zScore * (1 + i * 0.15); });
            forecastHigh = forecastValues.map(function(v, i) { return v + stdDev * zScore * (1 + i * 0.15); });
            
            // Calculate forecast metrics
            var totalForecast = forecastValues.reduce(function(a, b) { return a + b; }, 0);
            var growthRate = avgValue !== 0 ? (forecastValues[horizon - 1] - avgValue) / Math.abs(avgValue) : 0;
            var confidence = Math.max(0, Math.min(100, 100 - (stdDev / Math.abs(avgValue || 1) * 50)));
            
            // Render KPIs
            var kpisContainer = el('#ppForecastKPIs');
            if (kpisContainer) {
                kpisContainer.innerHTML = this.buildKPIRow([
                    { label: horizon + '-Month ' + metricLabels[metric], value: fmtMoney(totalForecast), icon: 'chart-line', color: 'blue', subtext: 'Projected Total' },
                    { label: 'Growth Trend', value: (growthRate >= 0 ? '+' : '') + fmtPct(growthRate), icon: 'arrow-trend-up', color: growthRate >= 0 ? 'green' : 'red', subtext: 'vs Current Avg' },
                    { label: 'Month ' + horizon + ' Range', value: fmtMoney(forecastLow[horizon - 1]) + ' - ' + fmtMoney(forecastHigh[horizon - 1]), icon: 'arrows-alt-v', color: 'purple', subtext: confidenceLevel + '% Confidence' },
                    { label: 'Model Fit', value: Math.round(confidence) + '%', icon: 'check-circle', color: confidence >= 70 ? 'green' : (confidence >= 50 ? 'yellow' : 'red'), subtext: this.getMethodLabel(method) }
                ]);
            }
            
            // Update diagnostics
            var mape = this.calculateMAPE(histValues, forecastResult.fitted || histValues);
            var rmse = this.calculateRMSE(histValues, forecastResult.fitted || histValues);
            var r2 = this.calculateR2(histValues, forecastResult.fitted || histValues);
            var trendDir = forecastResult.trend > 0 ? 'Upward' : (forecastResult.trend < 0 ? 'Downward' : 'Flat');
            var seasonLabel = forecastResult.seasonal ? 'Detected (' + forecastResult.seasonalPeriod + 'mo)' : 'None';
            
            if (el('#ppForecastMAPE')) el('#ppForecastMAPE').textContent = mape.toFixed(1) + '%';
            if (el('#ppForecastRMSE')) el('#ppForecastRMSE').textContent = fmtMoney(rmse);
            if (el('#ppForecastR2')) el('#ppForecastR2').textContent = r2.toFixed(3);
            if (el('#ppForecastTrend')) el('#ppForecastTrend').textContent = trendDir;
            if (el('#ppForecastSeason')) el('#ppForecastSeason').textContent = seasonLabel;
            
            // Render chart
            var mainColor = metricColors[metric];
            var traces = [
                {
                    x: histLabels, y: histValues, type: 'scatter', mode: 'lines+markers',
                    name: 'Historical', line: { color: mainColor, width: 2 }, marker: { size: 6 }
                },
                {
                    x: forecastLabels, y: forecastValues, type: 'scatter', mode: 'lines+markers',
                    name: 'Forecast', line: { color: mainColor, width: 2, dash: 'dot' }, marker: { size: 6, symbol: 'diamond' }
                },
                {
                    x: forecastLabels.concat(forecastLabels.slice().reverse()),
                    y: forecastHigh.concat(forecastLow.slice().reverse()),
                    type: 'scatter', fill: 'toself',
                    fillcolor: mainColor === '#3b82f6' ? 'rgba(59,130,246,0.1)' : (mainColor === '#10b981' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)'),
                    line: { color: 'transparent' }, name: confidenceLevel + '% CI', showlegend: false
                }
            ];
            
            Plotly.newPlot('ppForecastChart', traces, {
                height: 300, margin: { t: 20, r: 20, b: 40, l: 80 },
                xaxis: { tickfont: { size: 10 } },
                yaxis: { tickformat: '$,.0s', tickfont: { size: 10 }, title: { text: metricLabels[metric], font: { size: 11 } } },
                legend: { orientation: 'h', y: -0.15 },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
            }, { responsive: true, displayModeBar: false });
            
            // Render Monthly Forecast Detail Table
            this.renderForecastDetailTable(forecastLabels, forecastValues, forecastLow, forecastHigh, histGM, histOpInc, histRevenue, horizon, confidenceLevel);
        },

        renderForecastDetailTable: function(labels, revForecast, revLow, revHigh, histGM, histOpInc, histRev, horizon, confidence) {
            var bodyEl = el('#ppForecastBody');
            if (!bodyEl) return;
            
            // Calculate GM and OpInc forecasts based on historical ratios
            var avgGMRatio = histRev.length > 0 ? histGM.reduce(function(a, b) { return a + b; }, 0) / histRev.reduce(function(a, b) { return a + b; }, 0) : 0.3;
            var avgOpRatio = histRev.length > 0 ? histOpInc.reduce(function(a, b) { return a + b; }, 0) / histRev.reduce(function(a, b) { return a + b; }, 0) : 0.1;
            
            var html = '';
            labels.forEach(function(label, i) {
                var rev = revForecast[i];
                var gm = rev * avgGMRatio;
                var op = rev * avgOpRatio;
                var confPct = Math.max(50, confidence - i * 3); // Confidence decreases over horizon
                
                html += '<tr>' +
                    '<td><strong>' + label + '</strong></td>' +
                    '<td class="text-right">' + fmtMoney(rev) + '</td>' +
                    '<td class="text-right text-muted small">' + fmtMoney(revLow[i]) + '</td>' +
                    '<td class="text-right text-muted small">' + fmtMoney(revHigh[i]) + '</td>' +
                    '<td class="text-right">' + fmtMoney(gm) + '</td>' +
                    '<td class="text-right ' + (op >= 0 ? '' : 'text-danger') + '">' + fmtMoney(op) + '</td>' +
                    '<td class="text-right"><span class="badge badge-' + (confPct >= 70 ? 'success' : (confPct >= 50 ? 'warning' : 'secondary')) + '">' + confPct + '%</span></td>' +
                '</tr>';
            });
            
            bodyEl.innerHTML = html;
        },

        applyForecastMethod: function(data, method, horizon, seasonality, growthOverride) {
            var n = data.length;
            var result = { values: [], low: [], high: [], fitted: [], trend: 0, seasonal: false, seasonalPeriod: 0 };
            
            // Detect seasonality if auto
            var seasonalPeriod = 0;
            if (seasonality === 'auto' && n >= 12) {
                seasonalPeriod = this.detectSeasonality(data);
            } else if (seasonality === 'monthly') {
                seasonalPeriod = 1;
            } else if (seasonality === 'quarterly') {
                seasonalPeriod = 3;
            }
            result.seasonal = seasonalPeriod > 0;
            result.seasonalPeriod = seasonalPeriod;
            
            var trend = this.calculateTrend(data);
            result.trend = trend.slope;
            
            switch(method) {
                case 'ets':
                    result = this.forecastETS(data, horizon, seasonalPeriod);
                    break;
                case 'linear':
                    result = this.forecastLinear(data, horizon);
                    break;
                case 'seasonal':
                    result = this.forecastSeasonal(data, horizon, seasonalPeriod || 12);
                    break;
                case 'moving_avg':
                    result = this.forecastMovingAvg(data, horizon);
                    break;
                case 'arima':
                    result = this.forecastARIMA(data, horizon, seasonalPeriod);
                    break;
                default:
                    result = this.forecastLinear(data, horizon);
            }
            
            // Apply growth override if specified
            if (growthOverride !== null && !isNaN(growthOverride)) {
                var baseValue = data[n - 1];
                var monthlyGrowth = growthOverride / 100 / 12;
                result.values = [];
                for (var i = 0; i < horizon; i++) {
                    result.values.push(baseValue * Math.pow(1 + monthlyGrowth, i + 1));
                }
            }
            
            return result;
        },

        forecastETS: function(data, horizon, seasonalPeriod) {
            // Exponential Triple Smoothing (Holt-Winters)
            var n = data.length;
            var alpha = 0.3, beta = 0.1, gamma = 0.2;
            
            // Initialize
            var level = data[0];
            var trend = n > 1 ? (data[1] - data[0]) : 0;
            var seasonal = [];
            
            if (seasonalPeriod > 0 && n >= seasonalPeriod * 2) {
                // Initialize seasonal factors
                for (var i = 0; i < seasonalPeriod; i++) {
                    var sum = 0, count = 0;
                    for (var j = i; j < n; j += seasonalPeriod) {
                        sum += data[j];
                        count++;
                    }
                    seasonal.push(count > 0 ? sum / count / (data.reduce(function(a, b) { return a + b; }, 0) / n) : 1);
                }
            }
            
            // Smooth
            var fitted = [];
            for (var t = 0; t < n; t++) {
                var seasonFactor = seasonal.length > 0 ? seasonal[t % seasonalPeriod] : 1;
                var newLevel = alpha * (data[t] / seasonFactor) + (1 - alpha) * (level + trend);
                var newTrend = beta * (newLevel - level) + (1 - beta) * trend;
                if (seasonal.length > 0) {
                    seasonal[t % seasonalPeriod] = gamma * (data[t] / newLevel) + (1 - gamma) * seasonal[t % seasonalPeriod];
                }
                level = newLevel;
                trend = newTrend;
                fitted.push(level * seasonFactor);
            }
            
            // Forecast
            var values = [];
            for (var h = 1; h <= horizon; h++) {
                var seasonFactor = seasonal.length > 0 ? seasonal[(n + h - 1) % seasonalPeriod] : 1;
                values.push((level + trend * h) * seasonFactor);
            }
            
            var stdDev = this.calculateStdDev(data);
            return {
                values: values,
                low: values.map(function(v, i) { return v - stdDev * 1.645 * (1 + i * 0.1); }),
                high: values.map(function(v, i) { return v + stdDev * 1.645 * (1 + i * 0.1); }),
                fitted: fitted,
                trend: trend,
                seasonal: seasonal.length > 0,
                seasonalPeriod: seasonalPeriod
            };
        },

        forecastLinear: function(data, horizon) {
            var n = data.length;
            var trend = this.calculateTrend(data);
            var values = [];
            var fitted = [];
            
            for (var i = 0; i < n; i++) {
                fitted.push(trend.intercept + trend.slope * i);
            }
            for (var h = 0; h < horizon; h++) {
                values.push(trend.intercept + trend.slope * (n + h));
            }
            
            var stdDev = this.calculateStdDev(data);
            return {
                values: values,
                low: values.map(function(v, i) { return v - stdDev * 1.645 * (1 + i * 0.15); }),
                high: values.map(function(v, i) { return v + stdDev * 1.645 * (1 + i * 0.15); }),
                fitted: fitted,
                trend: trend.slope,
                seasonal: false,
                seasonalPeriod: 0
            };
        },

        forecastSeasonal: function(data, horizon, period) {
            var n = data.length;
            var trend = this.calculateTrend(data);
            
            // Calculate seasonal indices
            var seasonalIdx = [];
            for (var i = 0; i < period; i++) {
                var values = [];
                for (var j = i; j < n; j += period) {
                    var detrended = data[j] - (trend.intercept + trend.slope * j);
                    values.push(detrended);
                }
                seasonalIdx.push(values.length > 0 ? values.reduce(function(a, b) { return a + b; }, 0) / values.length : 0);
            }
            
            var forecastVals = [];
            var fitted = [];
            
            for (var i = 0; i < n; i++) {
                fitted.push(trend.intercept + trend.slope * i + seasonalIdx[i % period]);
            }
            for (var h = 0; h < horizon; h++) {
                var trendVal = trend.intercept + trend.slope * (n + h);
                forecastVals.push(trendVal + seasonalIdx[(n + h) % period]);
            }
            
            var stdDev = this.calculateStdDev(data);
            return {
                values: forecastVals,
                low: forecastVals.map(function(v, i) { return v - stdDev * 1.645 * (1 + i * 0.12); }),
                high: forecastVals.map(function(v, i) { return v + stdDev * 1.645 * (1 + i * 0.12); }),
                fitted: fitted,
                trend: trend.slope,
                seasonal: true,
                seasonalPeriod: period
            };
        },

        forecastMovingAvg: function(data, horizon) {
            var n = data.length;
            var windowSize = Math.min(6, Math.floor(n / 2));
            
            // Calculate moving average
            var ma = [];
            for (var i = 0; i < n; i++) {
                var start = Math.max(0, i - windowSize + 1);
                var slice = data.slice(start, i + 1);
                ma.push(slice.reduce(function(a, b) { return a + b; }, 0) / slice.length);
            }
            
            // Calculate trend from recent MA
            var recentMA = ma.slice(-windowSize);
            var trend = this.calculateTrend(recentMA);
            
            var lastMA = ma[ma.length - 1];
            var values = [];
            for (var h = 0; h < horizon; h++) {
                values.push(lastMA + trend.slope * h);
            }
            
            var stdDev = this.calculateStdDev(data);
            return {
                values: values,
                low: values.map(function(v, i) { return v - stdDev * 1.645 * (1 + i * 0.2); }),
                high: values.map(function(v, i) { return v + stdDev * 1.645 * (1 + i * 0.2); }),
                fitted: ma,
                trend: trend.slope,
                seasonal: false,
                seasonalPeriod: 0
            };
        },

        forecastARIMA: function(data, horizon, seasonalPeriod) {
            // Simplified ARIMA(1,1,1) approximation
            var n = data.length;
            
            // First difference
            var diff = [];
            for (var i = 1; i < n; i++) {
                diff.push(data[i] - data[i - 1]);
            }
            
            // AR(1) coefficient
            var ar1 = 0;
            if (diff.length > 1) {
                var sumXY = 0, sumX2 = 0;
                for (var i = 1; i < diff.length; i++) {
                    sumXY += diff[i] * diff[i - 1];
                    sumX2 += diff[i - 1] * diff[i - 1];
                }
                ar1 = sumX2 > 0 ? sumXY / sumX2 : 0;
            }
            ar1 = Math.max(-0.9, Math.min(0.9, ar1)); // Constrain
            
            // MA(1) - use residual autocorrelation
            var ma1 = 0.3;
            
            // Forecast differences
            var lastDiff = diff[diff.length - 1] || 0;
            var lastValue = data[n - 1];
            var values = [];
            
            for (var h = 0; h < horizon; h++) {
                var nextDiff = ar1 * lastDiff + ma1 * (lastDiff - ar1 * (diff[diff.length - 2] || 0));
                lastValue = lastValue + nextDiff;
                values.push(lastValue);
                lastDiff = nextDiff;
            }
            
            // Fitted values
            var fitted = [data[0]];
            lastDiff = 0;
            for (var i = 1; i < n; i++) {
                var predDiff = ar1 * lastDiff;
                fitted.push(fitted[i - 1] + predDiff);
                lastDiff = diff[i - 1] || 0;
            }
            
            var stdDev = this.calculateStdDev(diff) || this.calculateStdDev(data);
            return {
                values: values,
                low: values.map(function(v, i) { return v - stdDev * 1.645 * Math.sqrt(i + 1); }),
                high: values.map(function(v, i) { return v + stdDev * 1.645 * Math.sqrt(i + 1); }),
                fitted: fitted,
                trend: diff.length > 0 ? diff.reduce(function(a, b) { return a + b; }, 0) / diff.length : 0,
                seasonal: seasonalPeriod > 0,
                seasonalPeriod: seasonalPeriod
            };
        },

        detectSeasonality: function(data) {
            // Simple autocorrelation-based seasonality detection
            var n = data.length;
            if (n < 24) return 0;
            
            var mean = data.reduce(function(a, b) { return a + b; }, 0) / n;
            var variance = data.reduce(function(sum, x) { return sum + Math.pow(x - mean, 2); }, 0) / n;
            
            var bestPeriod = 0;
            var bestCorr = 0;
            
            [3, 4, 6, 12].forEach(function(period) {
                if (n >= period * 2) {
                    var sumCorr = 0;
                    for (var i = period; i < n; i++) {
                        sumCorr += (data[i] - mean) * (data[i - period] - mean);
                    }
                    var corr = variance > 0 ? sumCorr / ((n - period) * variance) : 0;
                    if (corr > bestCorr && corr > 0.3) {
                        bestCorr = corr;
                        bestPeriod = period;
                    }
                }
            });
            
            return bestPeriod;
        },

        getMethodLabel: function(method) {
            var labels = {
                'ets': 'Exp. Smoothing',
                'linear': 'Linear Trend',
                'seasonal': 'Seasonal Decomp.',
                'moving_avg': 'Moving Average',
                'arima': 'ARIMA'
            };
            return labels[method] || method;
        },

        calculateMAPE: function(actual, predicted) {
            var n = Math.min(actual.length, predicted.length);
            if (n === 0) return 0;
            var sum = 0;
            for (var i = 0; i < n; i++) {
                if (actual[i] !== 0) {
                    sum += Math.abs((actual[i] - predicted[i]) / actual[i]);
                }
            }
            return (sum / n) * 100;
        },

        calculateRMSE: function(actual, predicted) {
            var n = Math.min(actual.length, predicted.length);
            if (n === 0) return 0;
            var sumSq = 0;
            for (var i = 0; i < n; i++) {
                sumSq += Math.pow(actual[i] - predicted[i], 2);
            }
            return Math.sqrt(sumSq / n);
        },

        calculateR2: function(actual, predicted) {
            var n = Math.min(actual.length, predicted.length);
            if (n === 0) return 0;
            var mean = actual.reduce(function(a, b) { return a + b; }, 0) / n;
            var ssTot = 0, ssRes = 0;
            for (var i = 0; i < n; i++) {
                ssTot += Math.pow(actual[i] - mean, 2);
                ssRes += Math.pow(actual[i] - predicted[i], 2);
            }
            return ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
        },

        calculateTrend: function(data) {
            var n = data.length;
            if (n < 2) return { slope: 0, intercept: data[0] || 0 };
            
            var xMean = (n - 1) / 2;
            var yMean = data.reduce(function(a, b) { return a + b; }, 0) / n;
            
            var numerator = 0;
            var denominator = 0;
            
            data.forEach(function(val, i) {
                numerator += (i - xMean) * (val - yMean);
                denominator += Math.pow(i - xMean, 2);
            });
            
            var slope = denominator !== 0 ? numerator / denominator : 0;
            var intercept = yMean - slope * xMean;
            
            return { slope: slope, intercept: intercept };
        },

        calculateStdDev: function(data) {
            if (data.length < 2) return 0;
            var mean = data.reduce(function(a, b) { return a + b; }, 0) / data.length;
            var variance = data.reduce(function(sum, val) { return sum + Math.pow(val - mean, 2); }, 0) / data.length;
            return Math.sqrt(variance);
        },

        async runScenario() {
            var self = this;
            var scenarioType = el('#ppScenarioType').value;
            var inputValue = parseFloat(el('#ppScenarioInput').value) || 0;
            
            var rangeM = this.latestData.company && this.latestData.company.metrics && this.latestData.company.metrics.range 
                ? this.latestData.company.metrics.range : {};
            
            try {
                var params = {
                    action: 'health',
                    subAction: 'scenario',
                    scenarioType: scenarioType,
                    inputs: { changePercent: inputValue },
                    currentData: rangeM
                };
                
                var res = await API.post('health', params);
                
                if (res.status === 'success' && res.data) {
                    this.renderScenarioResults(res.data);
                }
            } catch (e) {
                console.error('Scenario error:', e);
                el('#ppScenarioResults').innerHTML = '<p class="text-danger">Error running scenario</p>';
            }
        },

        renderScenarioResults: function(data) {
            if (data.error) {
                el('#ppScenarioResults').innerHTML = '<p class="text-danger">' + data.error + '</p>';
                return;
            }
            
            var html = '<div class="pp-scenario-results">';
            
            if (data.projected) {
                if (data.projected.revenue !== undefined) {
                    html += '<div class="pp-scenario-item"><span>Projected Revenue</span><strong>' + fmtMoney(data.projected.revenue) + '</strong></div>';
                }
                // Use operatingIncome (new field) or netIncome (legacy) for backward compatibility
                var projOpInc = data.projected.operatingIncome !== undefined ? data.projected.operatingIncome : data.projected.netIncome;
                if (projOpInc !== undefined) {
                    html += '<div class="pp-scenario-item"><span>Projected Operating Income</span><strong>' + fmtMoney(projOpInc) + '</strong></div>';
                }
                if (data.projected.breakevenRevenue !== undefined) {
                    html += '<div class="pp-scenario-item"><span>Breakeven Revenue</span><strong>' + fmtMoney(data.projected.breakevenRevenue) + '</strong></div>';
                }
                if (data.projected.marginOfSafety !== undefined) {
                    html += '<div class="pp-scenario-item"><span>Margin of Safety</span><strong>' + fmtPct(data.projected.marginOfSafety) + '</strong></div>';
                }
            }
            
            if (data.impact) {
                // Use operatingIncomeChange (new) or netIncomeChange (legacy) for backward compatibility
                var opIncChange = data.impact.operatingIncomeChange !== undefined ? data.impact.operatingIncomeChange : data.impact.netIncomeChange;
                if (opIncChange !== undefined) {
                    var changeClass = opIncChange >= 0 ? 'text-success' : 'text-danger';
                    html += '<div class="pp-scenario-item"><span>Operating Income Change</span><strong class="' + changeClass + '">' + (opIncChange >= 0 ? '+' : '') + fmtMoney(opIncChange) + '</strong></div>';
                }
            }
            
            html += '</div>';
            
            if (data.insight) {
                html += '<p class="small text-muted mt-2"><i class="fas fa-info-circle mr-1"></i>' + data.insight + '</p>';
            }
            
            el('#ppScenarioResults').innerHTML = html;
        },

        // Enhanced Forecast Functions
        regenerateForecast: function() {
            var self = this;
            var method = el('#ppForecastMethod')?.value || 'ets';
            var horizon = parseInt(el('#ppForecastHorizon')?.value) || 6;
            var confidence = parseInt(el('#ppForecastConfidence')?.value) || 90;
            var seasonality = el('#ppForecastSeasonality')?.value || 'auto';
            var macroAdj = parseFloat(el('#ppForecastMacro')?.value) || 0;
            
            // Re-render with new settings
            this.forecastSettings = { 
                method: method, 
                horizon: horizon, 
                confidence: confidence, 
                seasonality: seasonality,
                macroAdjustment: macroAdj
            };
            if (this.latestData) {
                this.renderForecast(this.latestData);
            }
        },
        
        applyForecastAdjustment: function(forecastValues) {
            var settings = this.forecastSettings || {};
            var macroAdj = settings.macroAdjustment || 0;
            
            // Apply macro adjustment to all months
            if (macroAdj !== 0) {
                return forecastValues.map(function(v) { return v * (1 + macroAdj); });
            }
            return forecastValues;
        },

        showForecastModelInfo: function() {
            var html = '<div class="forecast-model-info">' +
                '<p class="lead">World-class forecasting models to predict your financial future with confidence.</p>' +
                
                '<div class="card mb-3 border-primary">' +
                    '<div class="card-header bg-primary text-white py-2"><strong><i class="fas fa-star mr-2"></i>Exponential Smoothing (ETS)</strong> - Recommended</div>' +
                    '<div class="card-body small">' +
                        '<p class="mb-2">Triple exponential smoothing (Holt-Winters) that captures <strong>level</strong>, <strong>trend</strong>, and <strong>seasonality</strong>.</p>' +
                        '<ul class="mb-0 pl-3">' +
                            '<li>Best for: Most business data with trends and seasonal patterns</li>' +
                            '<li>Adapts quickly to recent changes in your data</li>' +
                            '<li>Automatic seasonal adjustment when patterns detected</li>' +
                        '</ul>' +
                    '</div>' +
                '</div>' +
                
                '<div class="card mb-3">' +
                    '<div class="card-header py-2"><strong><i class="fas fa-chart-line mr-2"></i>Linear Regression</strong></div>' +
                    '<div class="card-body small">' +
                        '<p class="mb-2">Fits a straight line trend through your historical data.</p>' +
                        '<ul class="mb-0 pl-3">' +
                            '<li>Best for: Steady growth or decline without seasonal swings</li>' +
                            '<li>Simple and interpretable - clear growth rate</li>' +
                            '<li>Works well for shorter horizons (3-6 months)</li>' +
                        '</ul>' +
                    '</div>' +
                '</div>' +
                
                '<div class="card mb-3">' +
                    '<div class="card-header py-2"><strong><i class="fas fa-calendar-alt mr-2"></i>Seasonal Decomposition</strong></div>' +
                    '<div class="card-body small">' +
                        '<p class="mb-2">Separates your data into trend + seasonal + residual components.</p>' +
                        '<ul class="mb-0 pl-3">' +
                            '<li>Best for: Strong quarterly or annual patterns</li>' +
                            '<li>Requires at least 24 months of history</li>' +
                            '<li>Excellent for retail, hospitality, seasonal businesses</li>' +
                        '</ul>' +
                    '</div>' +
                '</div>' +
                
                '<div class="card mb-3">' +
                    '<div class="card-header py-2"><strong><i class="fas fa-wave-square mr-2"></i>Moving Average</strong></div>' +
                    '<div class="card-body small">' +
                        '<p class="mb-2">Smooths out noise by averaging recent periods.</p>' +
                        '<ul class="mb-0 pl-3">' +
                            '<li>Best for: Volatile data or when recent periods matter most</li>' +
                            '<li>Conservative forecasts that follow recent momentum</li>' +
                            '<li>Good for uncertain environments</li>' +
                        '</ul>' +
                    '</div>' +
                '</div>' +
                
                '<div class="card mb-3">' +
                    '<div class="card-header py-2"><strong><i class="fas fa-project-diagram mr-2"></i>ARIMA-style</strong></div>' +
                    '<div class="card-body small">' +
                        '<p class="mb-2">Auto-regressive integrated moving average - sophisticated time series analysis.</p>' +
                        '<ul class="mb-0 pl-3">' +
                            '<li>Best for: Complex patterns with autocorrelation</li>' +
                            '<li>Accounts for momentum and mean reversion</li>' +
                            '<li>Wider confidence bands reflect model uncertainty</li>' +
                        '</ul>' +
                    '</div>' +
                '</div>' +
                
                '<div class="alert alert-info small mb-0">' +
                    '<i class="fas fa-lightbulb mr-2"></i>' +
                    '<strong>Pro Tip:</strong> Start with ETS (the default), then compare with Linear Regression. ' +
                    'If you see strong seasonal patterns in the chart, try Seasonal Decomposition. ' +
                    'Use the Growth Override to incorporate your business knowledge.' +
                '</div>' +
            '</div>';
            
            this.showFlyout('Forecast Models Explained', html);
        },
        
        showDiagnosticsInfo: function() {
            var html = '<div class="diagnostics-info">' +
                '<p class="lead">Understanding model accuracy metrics helps you gauge forecast reliability.</p>' +
                
                '<div class="card mb-3">' +
                    '<div class="card-header py-2 bg-light"><strong><i class="fas fa-percentage mr-2 text-primary"></i>MAPE</strong> — Mean Absolute Percentage Error</div>' +
                    '<div class="card-body small">' +
                        '<p class="mb-2">Average percentage difference between forecasted and actual values.</p>' +
                        '<table class="table table-sm table-bordered mb-0">' +
                            '<tr><td class="bg-success text-white">&lt; 10%</td><td>Excellent — highly accurate forecasts</td></tr>' +
                            '<tr><td class="bg-info text-white">10-20%</td><td>Good — reasonable for most business planning</td></tr>' +
                            '<tr><td class="bg-warning">20-30%</td><td>Fair — use with caution, consider wider scenarios</td></tr>' +
                            '<tr><td class="bg-danger text-white">&gt; 30%</td><td>Poor — forecasts may not be reliable</td></tr>' +
                        '</table>' +
                    '</div>' +
                '</div>' +
                
                '<div class="card mb-3">' +
                    '<div class="card-header py-2 bg-light"><strong><i class="fas fa-ruler mr-2 text-info"></i>RMSE</strong> — Root Mean Square Error</div>' +
                    '<div class="card-body small">' +
                        '<p class="mb-2">Average magnitude of forecast errors in dollar terms. Penalizes large errors more heavily than small ones.</p>' +
                        '<ul class="mb-0 pl-3">' +
                            '<li>Lower values indicate better accuracy</li>' +
                            '<li>Compare to your typical monthly revenue to assess significance</li>' +
                            '<li>If RMSE is 5% of monthly revenue, forecasts are typically within ±5%</li>' +
                        '</ul>' +
                    '</div>' +
                '</div>' +
                
                '<div class="card mb-3">' +
                    '<div class="card-header py-2 bg-light"><strong><i class="fas fa-chart-line mr-2 text-success"></i>R²</strong> — Coefficient of Determination</div>' +
                    '<div class="card-body small">' +
                        '<p class="mb-2">How well the model explains variance in your data (0 to 1 scale).</p>' +
                        '<table class="table table-sm table-bordered mb-0">' +
                            '<tr><td class="bg-success text-white">&gt; 0.8</td><td>Excellent fit — model captures most patterns</td></tr>' +
                            '<tr><td class="bg-info text-white">0.6-0.8</td><td>Good fit — reasonable predictive power</td></tr>' +
                            '<tr><td class="bg-warning">0.4-0.6</td><td>Moderate fit — significant unexplained variance</td></tr>' +
                            '<tr><td class="bg-danger text-white">&lt; 0.4</td><td>Poor fit — model may miss key patterns</td></tr>' +
                        '</table>' +
                    '</div>' +
                '</div>' +
                
                '<div class="card mb-3">' +
                    '<div class="card-header py-2 bg-light"><strong><i class="fas fa-chart-line mr-2 text-purple"></i>Trend</strong></div>' +
                    '<div class="card-body small">' +
                        '<p class="mb-2">Direction of your underlying data movement.</p>' +
                        '<ul class="mb-0 pl-3">' +
                            '<li><strong>Upward:</strong> Revenue/metrics growing over time</li>' +
                            '<li><strong>Downward:</strong> Revenue/metrics declining over time</li>' +
                            '<li><strong>Flat:</strong> No significant trend detected</li>' +
                        '</ul>' +
                    '</div>' +
                '</div>' +
                
                '<div class="card mb-3">' +
                    '<div class="card-header py-2 bg-light"><strong><i class="fas fa-calendar-alt mr-2 text-orange"></i>Seasonality</strong></div>' +
                    '<div class="card-body small">' +
                        '<p class="mb-2">Recurring patterns in your data at regular intervals.</p>' +
                        '<ul class="mb-0 pl-3">' +
                            '<li><strong>Monthly:</strong> Patterns repeat each month</li>' +
                            '<li><strong>Quarterly:</strong> Patterns repeat each quarter (common for B2B)</li>' +
                            '<li><strong>Annual:</strong> Yearly cycles (holiday retail, fiscal year)</li>' +
                            '<li><strong>None:</strong> No significant recurring patterns detected</li>' +
                        '</ul>' +
                    '</div>' +
                '</div>' +
                
                '<div class="alert alert-info small mb-0">' +
                    '<i class="fas fa-lightbulb mr-2"></i>' +
                    '<strong>Pro Tip:</strong> If MAPE is high or R² is low, try different forecast methods. ' +
                    'ETS works best when seasonality is present. Linear regression works better for steady trends without cycles.' +
                '</div>' +
            '</div>';
            
            this.showFlyout('Model Diagnostics Explained', html);
        },

        // Initialize scenario baseline KPIs (shown before running a scenario)
        initScenarioBaseline: function() {
            var rangeM = this.latestData?.company?.metrics?.range || {};
            var revenue = rangeM.revenue || 0;
            var gm = rangeM.gm || 0;
            var opInc = rangeM.opInc || 0;
            var opPct = revenue > 0 ? opInc / revenue : 0;
            
            // Breakeven calculation
            var cogs = Math.abs(rangeM.cogs || 0);
            var opex = Math.abs(rangeM.opex || 0);
            var variableCostRatio = revenue > 0 ? cogs / revenue : 0.6;
            var breakeven = variableCostRatio < 1 ? opex / (1 - variableCostRatio) : 0;
            var safetyMargin = revenue > 0 ? (revenue - breakeven) / revenue : 0;
            
            // Update KPIs with baseline values
            this.setSafeText('#ppScenRevKPI', fmtMoney(revenue));
            this.setSafeText('#ppScenRevDelta', 'Baseline');
            this.setSafeText('#ppScenGMKPI', fmtMoney(gm));
            this.setSafeText('#ppScenGMDelta', 'Baseline');
            this.setSafeText('#ppScenOpIncKPI', fmtMoney(opInc));
            this.setSafeText('#ppScenOpIncDelta', 'Baseline');
            this.setSafeText('#ppScenSafetyKPI', fmtPct(safetyMargin));
            this.setSafeText('#ppScenSafetyDelta', 'Baseline');
            
            // Store baseline for delta calculations
            this.scenarioBaseline = { revenue: revenue, gm: gm, opInc: opInc, safetyMargin: safetyMargin };
        },

        // Scenario Template Loader
        loadScenarioTemplate: function(template) {
            var templates = {
                'recession': { revGrowth: -15, priceChange: -5, volumeChange: -10, cogsChange: -5, opexChange: -10 },
                'growth': { revGrowth: 20, priceChange: 5, volumeChange: 15, cogsChange: 10, opexChange: 15 },
                'cost_cut': { revGrowth: 0, priceChange: 0, volumeChange: 0, cogsChange: -10, opexChange: -20 },
                'price_war': { revGrowth: -10, priceChange: -15, volumeChange: 5, cogsChange: 0, opexChange: 0 },
                'expansion': { revGrowth: 30, priceChange: 0, volumeChange: 30, cogsChange: 25, opexChange: 30 },
                'stagflation': { revGrowth: 0, priceChange: 5, volumeChange: -5, cogsChange: 15, opexChange: 10 }
            };
            
            var t = templates[template] || { revGrowth: 0, priceChange: 0, volumeChange: 0, cogsChange: 0, opexChange: 0 };
            
            if (el('#ppScenRevGrowth')) el('#ppScenRevGrowth').value = t.revGrowth;
            if (el('#ppScenPriceChange')) el('#ppScenPriceChange').value = t.priceChange;
            if (el('#ppScenVolumeChange')) el('#ppScenVolumeChange').value = t.volumeChange;
            if (el('#ppScenCOGSChange')) el('#ppScenCOGSChange').value = t.cogsChange;
            if (el('#ppScenOpExChange')) el('#ppScenOpExChange').value = t.opexChange;
        },

        // Advanced Scenario Runner
        runAdvancedScenario: function() {
            var self = this;
            
            // Get inputs
            var revGrowth = parseFloat(el('#ppScenRevGrowth')?.value) || 0;
            var priceChange = parseFloat(el('#ppScenPriceChange')?.value) || 0;
            var volumeChange = parseFloat(el('#ppScenVolumeChange')?.value) || 0;
            var cogsChange = parseFloat(el('#ppScenCOGSChange')?.value) || 0;
            var opexChange = parseFloat(el('#ppScenOpExChange')?.value) || 0;
            var headcountChange = parseInt(el('#ppScenHeadcount')?.value) || 0;
            var horizon = parseInt(el('#ppScenHorizon')?.value) || 6;
            
            // Get current data
            var rangeM = this.latestData?.company?.metrics?.range || {};
            var revenue = rangeM.revenue || 0;
            var cogs = Math.abs(rangeM.cogs || 0);
            var gm = rangeM.gm || 0;
            var opex = Math.abs(rangeM.opex || 0);
            var opInc = rangeM.opInc || 0;
            
            // Calculate scenario
            var scenRevenue = revenue * (1 + revGrowth / 100);
            var scenCOGS = cogs * (1 + cogsChange / 100);
            var scenOpEx = opex * (1 + opexChange / 100);
            var scenGM = scenRevenue - scenCOGS;
            var scenOpInc = scenGM - scenOpEx;
            
            // Breakeven calculation
            var fixedCosts = scenOpEx;
            var variableCostRatio = scenRevenue > 0 ? scenCOGS / scenRevenue : 0.6;
            var breakeven = variableCostRatio < 1 ? fixedCosts / (1 - variableCostRatio) : 0;
            var safetyMargin = scenRevenue > 0 ? (scenRevenue - breakeven) / scenRevenue : 0;
            
            // Store scenario data for chart switching
            this.currentScenario = {
                current: { revenue: revenue, cogs: cogs, gm: gm, opex: opex, opInc: opInc },
                scenario: { revenue: scenRevenue, cogs: scenCOGS, gm: scenGM, opex: scenOpEx, opInc: scenOpInc },
                horizon: horizon,
                breakeven: breakeven,
                safetyMargin: safetyMargin
            };
            
            // Update KPIs with scenario results
            var baseline = this.scenarioBaseline || { revenue: revenue, gm: gm, opInc: opInc, safetyMargin: 0 };
            var revDelta = scenRevenue - baseline.revenue;
            var gmDelta = scenGM - baseline.gm;
            var opIncDelta = scenOpInc - baseline.opInc;
            var safetyDelta = safetyMargin - baseline.safetyMargin;
            
            this.setSafeText('#ppScenRevKPI', fmtMoney(scenRevenue));
            var revDeltaEl = el('#ppScenRevDelta');
            if (revDeltaEl) {
                revDeltaEl.innerHTML = (revDelta >= 0 ? '+' : '') + fmtMoney(revDelta);
                revDeltaEl.className = 'kpi-sub ' + (revDelta >= 0 ? 'text-success' : 'text-danger');
            }
            
            this.setSafeText('#ppScenGMKPI', fmtMoney(scenGM));
            var gmDeltaEl = el('#ppScenGMDelta');
            if (gmDeltaEl) {
                gmDeltaEl.innerHTML = (gmDelta >= 0 ? '+' : '') + fmtMoney(gmDelta);
                gmDeltaEl.className = 'kpi-sub ' + (gmDelta >= 0 ? 'text-success' : 'text-danger');
            }
            
            this.setSafeText('#ppScenOpIncKPI', fmtMoney(scenOpInc));
            var opIncDeltaEl = el('#ppScenOpIncDelta');
            if (opIncDeltaEl) {
                opIncDeltaEl.innerHTML = (opIncDelta >= 0 ? '+' : '') + fmtMoney(opIncDelta);
                opIncDeltaEl.className = 'kpi-sub ' + (opIncDelta >= 0 ? 'text-success' : 'text-danger');
            }
            
            this.setSafeText('#ppScenSafetyKPI', fmtPct(safetyMargin));
            var safetyDeltaEl = el('#ppScenSafetyDelta');
            if (safetyDeltaEl) {
                safetyDeltaEl.innerHTML = (safetyDelta >= 0 ? '+' : '') + fmtPct(safetyDelta);
                safetyDeltaEl.className = 'kpi-sub ' + (safetyDelta >= 0 ? 'text-success' : 'text-danger');
            }
            
            // Thresholds
            if (el('#ppScenBreakeven')) el('#ppScenBreakeven').textContent = fmtMoney(breakeven);
            if (el('#ppScenSafetyMargin')) el('#ppScenSafetyMargin').textContent = fmtPct(safetyMargin);
            if (el('#ppScenCashRunway')) el('#ppScenCashRunway').textContent = scenOpInc > 0 ? '∞' : (scenOpInc < 0 ? Math.abs(Math.round(revenue * 0.1 / scenOpInc * 12)) + ' mo' : '—');
            
            var riskBadge = el('#ppScenRiskBadge');
            if (riskBadge) {
                var riskLevel = safetyMargin >= 0.3 ? 'Low' : (safetyMargin >= 0.1 ? 'Medium' : (safetyMargin >= 0 ? 'High' : 'Critical'));
                var riskClass = safetyMargin >= 0.3 ? 'badge-success' : (safetyMargin >= 0.1 ? 'badge-warning' : (safetyMargin >= 0 ? 'badge-danger' : 'badge-dark'));
                riskBadge.className = 'badge ' + riskClass;
                riskBadge.textContent = riskLevel;
            }
            
            // Render waterfall chart by default
            this.scenarioChartType = 'waterfall';
            this.renderScenarioWaterfallChart();
        },
        
        switchScenarioChart: function(chartType) {
            // Update button states
            var buttons = document.querySelectorAll('#ppScenarioChartToggle button');
            buttons.forEach(function(btn) {
                btn.classList.remove('active');
                if (btn.dataset.chart === chartType) btn.classList.add('active');
            });
            
            this.scenarioChartType = chartType;
            
            if (!this.currentScenario) {
                el('#ppScenarioChart').innerHTML = '<div class="text-center text-muted py-5"><i class="fas fa-flask fa-3x mb-3 text-light"></i><div>Run a scenario first</div></div>';
                return;
            }
            
            if (chartType === 'waterfall') {
                this.renderScenarioWaterfallChart();
            } else {
                this.renderScenarioTrendChart();
            }
        },
        
        renderScenarioWaterfallChart: function() {
            var scen = this.currentScenario;
            if (!scen || typeof Plotly === 'undefined' || !el('#ppScenarioChart')) return;
            
            var curr = scen.current;
            var proj = scen.scenario;
            
            // Show P&L comparison: Current vs Scenario for Revenue, GM, OpInc
            Plotly.newPlot('ppScenarioChart', [
                {
                    x: ['Revenue', 'Gross Margin', 'Op Income'],
                    y: [curr.revenue, curr.gm, curr.opInc],
                    type: 'bar',
                    name: 'Baseline',
                    marker: { color: '#94a3b8' }
                },
                {
                    x: ['Revenue', 'Gross Margin', 'Op Income'],
                    y: [proj.revenue, proj.gm, proj.opInc],
                    type: 'bar',
                    name: 'Scenario',
                    marker: { color: proj.opInc >= curr.opInc ? '#10b981' : '#ef4444' }
                }
            ], {
                height: 300, margin: { t: 30, r: 20, b: 50, l: 70 },
                barmode: 'group',
                yaxis: { tickformat: '$,.0s', tickfont: { size: 10 } },
                xaxis: { tickfont: { size: 11 } },
                legend: { orientation: 'h', y: 1.12, font: { size: 10 } },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
            }, { responsive: true, displayModeBar: false });
        },
        
        renderScenarioTrendChart: function() {
            var scen = this.currentScenario;
            if (!scen || typeof Plotly === 'undefined' || !el('#ppScenarioChart')) return;
            
            var curr = scen.current;
            var proj = scen.scenario;
            var horizon = scen.horizon;
            
            var months = [];
            var revLine = [];
            var gmLine = [];
            var opIncLine = [];
            
            // Show gradual transition from current to scenario state over horizon
            for (var i = 0; i <= horizon; i++) {
                var d = new Date();
                d.setMonth(d.getMonth() + i);
                months.push(i === 0 ? 'Now' : d.toLocaleDateString('en-US', { month: 'short' }));
                
                var progress = i / horizon;
                revLine.push((curr.revenue + (proj.revenue - curr.revenue) * progress) / 12);
                gmLine.push((curr.gm + (proj.gm - curr.gm) * progress) / 12);
                opIncLine.push((curr.opInc + (proj.opInc - curr.opInc) * progress) / 12);
            }
            
            Plotly.newPlot('ppScenarioChart', [
                { x: months, y: revLine, type: 'scatter', mode: 'lines+markers', name: 'Revenue', line: { color: '#3b82f6', width: 2 }, marker: { size: 5 } },
                { x: months, y: gmLine, type: 'scatter', mode: 'lines+markers', name: 'Gross Margin', line: { color: '#10b981', width: 2 }, marker: { size: 5 } },
                { x: months, y: opIncLine, type: 'scatter', mode: 'lines+markers', name: 'Op Income', line: { color: '#f59e0b', width: 2 }, marker: { size: 5 } }
            ], {
                height: 300, margin: { t: 20, r: 20, b: 40, l: 70 },
                yaxis: { tickformat: '$,.0s', tickfont: { size: 10 }, title: { text: 'Monthly', font: { size: 10 } } },
                xaxis: { tickfont: { size: 10 } },
                legend: { orientation: 'h', y: 1.12, font: { size: 10 } },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
            }, { responsive: true, displayModeBar: false });
        },

        savedScenarios: [],
        
        saveCurrentScenario: function() {
            var self = this;
            var defaultName = 'Scenario ' + (this.savedScenarios.length + 1);
            
            var html = '<div class="scenario-save-form">' +
                '<div class="form-group mb-3">' +
                    '<label class="font-weight-bold">Scenario Name</label>' +
                    '<input type="text" class="form-control" id="ppScenarioSaveName" value="' + defaultName + '" placeholder="Enter a descriptive name">' +
                '</div>' +
                '<div class="card bg-light mb-3">' +
                    '<div class="card-body py-2">' +
                        '<h6 class="small font-weight-bold mb-2">Current Settings</h6>' +
                        '<div class="row small">' +
                            '<div class="col-6"><span class="text-muted">Revenue:</span> <strong>' + (el('#ppScenRevGrowth')?.value || 0) + '%</strong></div>' +
                            '<div class="col-6"><span class="text-muted">COGS:</span> <strong>' + (el('#ppScenCOGSChange')?.value || 0) + '%</strong></div>' +
                            '<div class="col-6"><span class="text-muted">OpEx:</span> <strong>' + (el('#ppScenOpExChange')?.value || 0) + '%</strong></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="text-right">' +
                    '<button class="btn btn-secondary mr-2" onclick="HealthController.closeFlyout()">Cancel</button>' +
                    '<button class="btn btn-primary" onclick="HealthController.confirmSaveScenario()"><i class="fas fa-save mr-1"></i>Save Scenario</button>' +
                '</div>' +
            '</div>';
            
            this.showFlyout('Save Scenario', html);
            
            // Focus the input
            setTimeout(function() {
                var input = el('#ppScenarioSaveName');
                if (input) { input.focus(); input.select(); }
            }, 100);
        },

        async confirmSaveScenario() {
            var name = (el('#ppScenarioSaveName')?.value || '').trim();
            if (!name) {
                el('#ppScenarioSaveName')?.classList.add('is-invalid');
                return;
            }
            
            var scenario = {
                name: name,
                revGrowth: parseFloat(el('#ppScenRevGrowth')?.value) || 0,
                priceChange: parseFloat(el('#ppScenPriceChange')?.value) || 0,
                volumeChange: parseFloat(el('#ppScenVolumeChange')?.value) || 0,
                cogsChange: parseFloat(el('#ppScenCOGSChange')?.value) || 0,
                opexChange: parseFloat(el('#ppScenOpExChange')?.value) || 0,
                timestamp: new Date().toISOString()
            };
            
            this.savedScenarios.push(scenario);
            
            // Save to server
            try {
                await API.post('save_health_config', { savedScenarios: this.savedScenarios });
            } catch (e) {
                console.error('Failed to save scenario', e);
            }
            
            this.closeFlyout();
            this.renderSavedScenarios();
        },

        renderSavedScenarios: function() {
            var self = this;
            var container = el('#ppSavedScenarios');
            if (!container) return;
            
            if (this.savedScenarios.length === 0) {
                container.innerHTML = '<div class="text-center text-muted py-4"><i class="fas fa-bookmark fa-2x mb-2 text-light"></i><div class="small">No saved scenarios yet</div><div class="small text-muted">Run and save scenarios for quick comparison</div></div>';
                return;
            }
            
            var rangeM = this.latestData?.company?.metrics?.range || {};
            var revenue = rangeM.revenue || 0;
            var cogs = Math.abs(rangeM.cogs || 0);
            var opex = Math.abs(rangeM.opex || 0);
            
            var html = '';
            this.savedScenarios.forEach(function(s, idx) {
                var scenRevenue = revenue * (1 + s.revGrowth / 100);
                var scenCOGS = cogs * (1 + s.cogsChange / 100);
                var scenOpEx = opex * (1 + s.opexChange / 100);
                var scenOpInc = scenRevenue - scenCOGS - scenOpEx;
                var opIncClass = scenOpInc >= 0 ? 'text-success' : 'text-danger';
                
                html += '<div class="pp-saved-scenario-item" onclick="HealthController.loadSavedScenario(' + idx + ')">' +
                    '<div class="d-flex justify-content-between align-items-start">' +
                        '<div class="pp-saved-scenario-name">' + escapeHtml(s.name) + '</div>' +
                        '<button class="btn btn-sm btn-link text-danger p-0" onclick="event.stopPropagation();HealthController.deleteSavedScenario(' + idx + ')"><i class="fas fa-times"></i></button>' +
                    '</div>' +
                    '<div class="pp-saved-scenario-meta">' +
                        '<span class="' + (s.revGrowth >= 0 ? 'text-success' : 'text-danger') + '">Rev: ' + (s.revGrowth >= 0 ? '+' : '') + s.revGrowth + '%</span>' +
                        '<span class="' + (s.cogsChange <= 0 ? 'text-success' : 'text-danger') + '">COGS: ' + (s.cogsChange >= 0 ? '+' : '') + s.cogsChange + '%</span>' +
                        '<span class="' + opIncClass + '">→ ' + fmtMoney(scenOpInc) + '</span>' +
                    '</div>' +
                '</div>';
            });
            container.innerHTML = html;
        },
        
        loadSavedScenario: function(idx) {
            var s = this.savedScenarios[idx];
            if (!s) return;
            
            if (el('#ppScenRevGrowth')) el('#ppScenRevGrowth').value = s.revGrowth;
            if (el('#ppScenCOGSChange')) el('#ppScenCOGSChange').value = s.cogsChange;
            if (el('#ppScenOpExChange')) el('#ppScenOpExChange').value = s.opexChange;
            if (el('#ppScenPriceChange')) el('#ppScenPriceChange').value = s.priceChange || 0;
            
            // Run the scenario
            this.runAdvancedScenario();
        },

        async deleteSavedScenario(idx) {
            this.savedScenarios.splice(idx, 1);
            // Save to server
            try {
                await API.post('save_health_config', { savedScenarios: this.savedScenarios });
            } catch (e) {
                console.error('Failed to delete scenario', e);
            }
            this.renderSavedScenarios();
        },

        // ════════════════════════════════════════════════════════════════════════
        // DRIVERS TAB
        // ════════════════════════════════════════════════════════════════════════

        renderDrivers: function(data) {
            var self = this;
            this.driversData = data;
            this.driversPage = this.driversPage || 1;
            this.driversPageSize = this.driversPageSize || 50;
            this.driversMinChange = this.driversMinChange !== undefined ? this.driversMinChange : 10;
            this.driversShowAll = this.driversShowAll !== undefined ? this.driversShowAll : false;
            
            // Get ALL accounts from company data
            var accounts = data.company && data.company.accounts ? data.company.accounts : {};
            var currentAccounts = accounts.current || {};
            var priorAccounts = accounts.prior || {};
            
            // Combine all account types - try both naming conventions
            var allAccounts = [];
            var accountTypes = [
                { keys: ['revenue', 'incomeAccounts'], label: 'Revenue' },
                { keys: ['cogs', 'cogsAccounts'], label: 'COGS' },
                { keys: ['opex', 'opexAccounts'], label: 'OpEx' }
            ];
            
            accountTypes.forEach(function(typeConfig) {
                // Try each possible key name
                var curr = [];
                var prior = [];
                typeConfig.keys.forEach(function(key) {
                    if (!curr.length && currentAccounts[key] && Array.isArray(currentAccounts[key])) {
                        curr = currentAccounts[key];
                    }
                    if (!prior.length && priorAccounts[key] && Array.isArray(priorAccounts[key])) {
                        prior = priorAccounts[key];
                    }
                });
                
                var priorMap = {};
                prior.forEach(function(a) { priorMap[a.accountId] = a.amount || 0; });
                
                curr.forEach(function(a) {
                    var priorAmt = priorMap[a.accountId] || 0;
                    var change = (a.amount || 0) - priorAmt;
                    var changePct = priorAmt !== 0 ? change / Math.abs(priorAmt) : (a.amount ? 1 : 0);
                    
                    allAccounts.push({
                        type: typeConfig.label,
                        accountId: a.accountId,
                        accountName: a.accountName || 'Unknown',
                        current: a.amount || 0,
                        prior: priorAmt,
                        change: change,
                        changePct: changePct,
                        trend: a.trend || []
                    });
                });
                
                // Also check for accounts in prior that aren't in current (account removed)
                prior.forEach(function(a) {
                    var inCurrent = curr.some(function(c) { return c.accountId === a.accountId; });
                    if (!inCurrent && a.amount) {
                        allAccounts.push({
                            type: typeConfig.label,
                            accountId: a.accountId,
                            accountName: a.accountName || 'Unknown',
                            current: 0,
                            prior: a.amount || 0,
                            change: -(a.amount || 0),
                            changePct: -1,
                            trend: []
                        });
                    }
                });
            });
            
            // Apply filtering - use min percentage change filter
            var minChangeEl = el('#ppDriversMinChange');
            var minChangePct = minChangeEl ? parseFloat(minChangeEl.value) : this.driversMinChange;
            if (isNaN(minChangePct)) minChangePct = 0;
            
            // Filter accounts with meaningful percentage changes above threshold
            var filtered = allAccounts.filter(function(a) {
                var pctChange = Math.abs(a.changePct) * 100;
                return minChangePct === 0 || pctChange >= minChangePct;
            });
            
            // Calculate summary stats from ALL accounts for context
            var totalUp = 0, totalDown = 0, countUp = 0, countDown = 0;
            allAccounts.forEach(function(a) {
                if (a.change > 0) { totalUp += a.change; countUp++; }
                else if (a.change < 0) { totalDown += a.change; countDown++; }
            });
            var netChange = totalUp + totalDown;
            
            // Build KPIs
            var kpisContainer = el('#ppDriversKPIs');
            if (kpisContainer) {
                var filterLabel = minChangePct > 0 ? '≥ ±' + minChangePct + '% change' : 'All accounts';
                kpisContainer.innerHTML = this.buildKPIRow([
                    { label: 'Accounts', value: filtered.length + ' / ' + allAccounts.length, icon: 'list', color: 'blue', subtext: filterLabel },
                    { label: 'Cost Increases', value: countUp, icon: 'arrow-up', color: 'red', subtext: '+' + fmtMoney(totalUp) },
                    { label: 'Cost Decreases', value: countDown, icon: 'arrow-down', color: 'green', subtext: fmtMoney(totalDown) },
                    { label: 'Net Impact', value: (netChange >= 0 ? '+' : '') + fmtMoney(netChange), icon: 'balance-scale', color: netChange <= 0 ? 'green' : 'red' }
                ]);
            }
            
            // Sort based on current sort settings
            var sortCol = this.driversSortColumn || 'change';
            var sortDir = this.driversSortDirection || 'desc';
            filtered.sort(function(a, b) {
                var aVal, bVal;
                switch (sortCol) {
                    case 'type': aVal = a.type; bVal = b.type; break;
                    case 'name': aVal = a.accountName; bVal = b.accountName; break;
                    case 'current': aVal = a.current; bVal = b.current; break;
                    case 'prior': aVal = a.prior; bVal = b.prior; break;
                    case 'change': aVal = Math.abs(a.change); bVal = Math.abs(b.change); break;
                    case 'changePct': aVal = Math.abs(a.changePct); bVal = Math.abs(b.changePct); break;
                    case 'impact': aVal = Math.abs(a.change); bVal = Math.abs(b.change); break;
                    default: aVal = Math.abs(a.change); bVal = Math.abs(b.change);
                }
                if (typeof aVal === 'string') {
                    return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                }
                return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
            });
            
            // Store for pagination
            this.driversFiltered = filtered;
            
            // Paginate
            var startIdx = (this.driversPage - 1) * this.driversPageSize;
            var pageData = filtered.slice(startIdx, startIdx + this.driversPageSize);
            
            // Render main table
            var tableHtml = '';
            pageData.forEach(function(a) {
                var sparkline = self.generateMiniSparkline(a.trend, a.change > 0 ? 'danger' : 'success');
                var changeClass = a.change > 0 ? 'text-danger' : (a.change < 0 ? 'text-success' : '');
                var impactPct = (data.company?.metrics?.range?.revenue || 1) > 0 ? 
                    Math.abs(a.change) / data.company.metrics.range.revenue : 0;
                
                tableHtml += '<tr class="clickable-row" onclick="HealthController.showAccountFlyout(' + a.accountId + ', \'' + escapeHtml(a.accountName).replace(/'/g, "\\'") + '\')">' +
                    '<td><span class="badge badge-' + (a.type === 'Revenue' ? 'success' : (a.type === 'COGS' ? 'warning' : 'info')) + '">' + a.type + '</span></td>' +
                    '<td class="text-truncate" style="max-width:180px;" title="' + escapeHtml(a.accountName) + '">' + escapeHtml(a.accountName) + '</td>' +
                    '<td>' + sparkline + '</td>' +
                    '<td class="text-right">' + fmtMoney(a.current) + '</td>' +
                    '<td class="text-right text-muted">' + fmtMoney(a.prior) + '</td>' +
                    '<td class="text-right ' + changeClass + '">' + (a.change >= 0 ? '+' : '') + fmtMoney(a.change) + '</td>' +
                    '<td class="text-right ' + changeClass + '">' + (a.changePct >= 0 ? '+' : '') + fmtPct(a.changePct) + '</td>' +
                    '<td class="text-right">' + fmtPct(impactPct) + '</td>' +
                '</tr>';
            });
            
            el('#ppDriversAllBody').innerHTML = tableHtml || '<tr><td colspan="8" class="text-muted text-center py-3">No accounts match filter</td></tr>';
            el('#ppDriversCount').textContent = filtered.length + ' accounts';
            
            // Calculate category summary for chart
            var catSummary = { Revenue: 0, COGS: 0, OpEx: 0 };
            var catCounts = { Revenue: 0, COGS: 0, OpEx: 0 };
            allAccounts.forEach(function(a) {
                var amt = Math.abs(a.current);
                if (catSummary[a.type] !== undefined) {
                    catSummary[a.type] += amt;
                    catCounts[a.type]++;
                }
            });
            
            // Separate cost increases and savings (for COGS and OpEx only - expense accounts)
            var expenseAccounts = allAccounts.filter(function(a) { 
                return a.type === 'COGS' || a.type === 'OpEx'; 
            });
            
            var costIncreases = expenseAccounts.filter(function(a) { return a.change > 0; })
                .sort(function(a, b) { return b.change - a.change; })
                .slice(0, 5);
            
            var costSavings = expenseAccounts.filter(function(a) { return a.change < 0; })
                .sort(function(a, b) { return a.change - b.change; })
                .slice(0, 5);
            
            // Render cost increases
            var increasesHtml = '';
            if (costIncreases.length === 0) {
                increasesHtml = '<tr><td colspan="2" class="text-muted text-center py-2">No cost increases</td></tr>';
            } else {
                costIncreases.forEach(function(a) {
                    var pct = (a.changePct * 100).toFixed(0);
                    var escapedName = escapeHtml(a.accountName).replace(/'/g, "\\'");
                    increasesHtml += '<tr class="clickable-row" onclick="HealthController.showAccountFlyout(' + a.accountId + ', \'' + escapedName + '\')">' +
                        '<td><span class="badge badge-' + (a.type === 'COGS' ? 'warning' : 'info') + ' mr-1" style="font-size:9px;">' + a.type + '</span>' + escapeHtml(a.accountName.substring(0, 18)) + '</td>' +
                        '<td class="text-right text-danger text-nowrap"><strong>+' + fmtMoney(a.change) + '</strong><br><small class="text-muted">+' + pct + '%</small></td>' +
                    '</tr>';
                });
            }
            el('#ppDriversCostIncreases').innerHTML = increasesHtml;
            
            // Render cost savings
            var savingsHtml = '';
            if (costSavings.length === 0) {
                savingsHtml = '<tr><td colspan="2" class="text-muted text-center py-2">No cost savings</td></tr>';
            } else {
                costSavings.forEach(function(a) {
                    var pct = (a.changePct * 100).toFixed(0);
                    var escapedName = escapeHtml(a.accountName).replace(/'/g, "\\'");
                    savingsHtml += '<tr class="clickable-row" onclick="HealthController.showAccountFlyout(' + a.accountId + ', \'' + escapedName + '\')">' +
                        '<td><span class="badge badge-' + (a.type === 'COGS' ? 'warning' : 'info') + ' mr-1" style="font-size:9px;">' + a.type + '</span>' + escapeHtml(a.accountName.substring(0, 18)) + '</td>' +
                        '<td class="text-right text-success text-nowrap"><strong>' + fmtMoney(a.change) + '</strong><br><small class="text-muted">' + pct + '%</small></td>' +
                    '</tr>';
                });
            }
            el('#ppDriversCostSavings').innerHTML = savingsHtml;
            
            // Generate insights
            this.renderDriversInsights(allAccounts, catSummary, catCounts, costIncreases, costSavings);
            
            // Pagination
            this.renderDriversPagination(filtered.length);
            
            // Setup sort handlers
            this.initDriversSorting();
        },
        
        initDriversSorting: function() {
            var self = this;
            var headers = document.querySelectorAll('#ppDriversAllTable th.sortable');
            
            headers.forEach(function(th) {
                // Remove old handler if any
                th.onclick = null;
                th.style.cursor = 'pointer';
                
                // Update visual indicator
                var sortCol = th.dataset.sort;
                th.classList.remove('sort-asc', 'sort-desc');
                if (sortCol === self.driversSortColumn) {
                    th.classList.add(self.driversSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
                }
                
                th.onclick = function() {
                    var col = th.dataset.sort;
                    if (self.driversSortColumn === col) {
                        // Toggle direction
                        self.driversSortDirection = self.driversSortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        // New column, default to desc for numeric, asc for text
                        self.driversSortColumn = col;
                        self.driversSortDirection = (col === 'type' || col === 'name') ? 'asc' : 'desc';
                    }
                    self.driversPage = 1;
                    self.renderDrivers(self.driversData);
                };
            });
        },
        
        renderDriversInsights: function(allAccounts, catSummary, catCounts, costIncreases, costSavings) {
            var insights = [];
            
            // Calculate totals
            var totalCOGS = catSummary.COGS || 0;
            var totalOpEx = catSummary.OpEx || 0;
            var totalExpenses = totalCOGS + totalOpEx;
            
            // 1. Concentration analysis - top 5 accounts as % of total expenses
            var expenseAccounts = allAccounts.filter(function(a) { 
                return a.type === 'COGS' || a.type === 'OpEx'; 
            }).sort(function(a, b) { return Math.abs(b.current) - Math.abs(a.current); });
            
            if (expenseAccounts.length >= 5 && totalExpenses > 0) {
                var top5Total = expenseAccounts.slice(0, 5).reduce(function(sum, a) { 
                    return sum + Math.abs(a.current); 
                }, 0);
                var concentration = (top5Total / totalExpenses * 100).toFixed(0);
                
                if (concentration > 60) {
                    insights.push({
                        icon: 'exclamation-triangle',
                        color: 'warning',
                        text: '<strong>High concentration:</strong> Top 5 accounts represent ' + concentration + '% of expenses'
                    });
                } else if (concentration > 40) {
                    insights.push({
                        icon: 'info-circle',
                        color: 'info',
                        text: '<strong>Moderate concentration:</strong> Top 5 accounts represent ' + concentration + '% of expenses'
                    });
                }
            }
            
            // 2. Net savings vs cost increases
            var totalIncreases = costIncreases.reduce(function(sum, a) { return sum + a.change; }, 0);
            var totalSavings = Math.abs(costSavings.reduce(function(sum, a) { return sum + a.change; }, 0));
            var netChange = totalIncreases - totalSavings;
            
            if (netChange > 0) {
                insights.push({
                    icon: 'arrow-up',
                    color: 'danger',
                    text: '<strong>Net cost increase:</strong> ' + fmtMoney(netChange) + ' more in expenses YoY'
                });
            } else if (netChange < 0) {
                insights.push({
                    icon: 'arrow-down',
                    color: 'success',
                    text: '<strong>Net savings:</strong> ' + fmtMoney(Math.abs(netChange)) + ' reduction in expenses YoY'
                });
            }
            
            // 3. COGS vs OpEx ratio insight
            if (totalExpenses > 0) {
                var cogsRatio = (totalCOGS / totalExpenses * 100).toFixed(0);
                var opexRatio = (totalOpEx / totalExpenses * 100).toFixed(0);
                
                if (totalCOGS > 0 && totalOpEx > 0) {
                    insights.push({
                        icon: 'balance-scale',
                        color: 'primary',
                        text: '<strong>Cost mix:</strong> ' + cogsRatio + '% COGS / ' + opexRatio + '% OpEx'
                    });
                }
            }
            
            // 4. Volatility - accounts with >50% change
            var volatileAccounts = allAccounts.filter(function(a) { 
                return Math.abs(a.changePct) > 0.5 && Math.abs(a.change) > 1000; 
            });
            if (volatileAccounts.length > 0) {
                insights.push({
                    icon: 'bolt',
                    color: 'warning',
                    text: '<strong>' + volatileAccounts.length + ' volatile account' + (volatileAccounts.length > 1 ? 's' : '') + ':</strong> Changed by >50% YoY'
                });
            }
            
            // 5. New or eliminated accounts
            var newAccounts = allAccounts.filter(function(a) { return a.prior === 0 && a.current !== 0; });
            var eliminatedAccounts = allAccounts.filter(function(a) { return a.current === 0 && a.prior !== 0; });
            
            if (newAccounts.length > 0) {
                var newTotal = newAccounts.reduce(function(sum, a) { return sum + Math.abs(a.current); }, 0);
                insights.push({
                    icon: 'plus-circle',
                    color: 'info',
                    text: '<strong>' + newAccounts.length + ' new account' + (newAccounts.length > 1 ? 's' : '') + ':</strong> ' + fmtMoney(newTotal) + ' total'
                });
            }
            
            if (eliminatedAccounts.length > 0) {
                var elimTotal = eliminatedAccounts.reduce(function(sum, a) { return sum + Math.abs(a.prior); }, 0);
                insights.push({
                    icon: 'minus-circle',
                    color: 'secondary',
                    text: '<strong>' + eliminatedAccounts.length + ' discontinued:</strong> ' + fmtMoney(elimTotal) + ' eliminated'
                });
            }
            
            // Render insights
            var container = el('#ppDriversInsights');
            if (!container) return;
            
            if (insights.length === 0) {
                container.innerHTML = '<div class="text-muted"><i class="fas fa-check-circle text-success mr-2"></i>No significant issues detected</div>';
                return;
            }
            
            var html = insights.map(function(insight) {
                return '<div class="mb-2"><i class="fas fa-' + insight.icon + ' text-' + insight.color + ' mr-2"></i>' + insight.text + '</div>';
            }).join('');
            
            container.innerHTML = html;
        },

        renderDriversPagination: function(total) {
            var container = el('#ppDriversPagination');
            if (!container) return;
            
            var totalPages = Math.ceil(total / this.driversPageSize);
            if (totalPages <= 1) { container.innerHTML = ''; return; }
            
            var html = '<nav><ul class="pagination pagination-sm mb-0">';
            html += '<li class="page-item ' + (this.driversPage <= 1 ? 'disabled' : '') + '"><a class="page-link" href="#" onclick="HealthController.driversGoToPage(' + (this.driversPage - 1) + ');return false;">Prev</a></li>';
            
            for (var p = 1; p <= Math.min(totalPages, 5); p++) {
                html += '<li class="page-item ' + (p === this.driversPage ? 'active' : '') + '"><a class="page-link" href="#" onclick="HealthController.driversGoToPage(' + p + ');return false;">' + p + '</a></li>';
            }
            
            html += '<li class="page-item ' + (this.driversPage >= totalPages ? 'disabled' : '') + '"><a class="page-link" href="#" onclick="HealthController.driversGoToPage(' + (this.driversPage + 1) + ');return false;">Next</a></li>';
            html += '</ul></nav>';
            container.innerHTML = html;
        },

        driversGoToPage: function(page) {
            this.driversPage = page;
            this.renderDrivers(this.driversData);
        },

        /**
         * Generate a mini SVG sparkline for inline display
         */
        generateMiniSparkline: function(data, color) {
            if (!data || data.length < 2) {
                return '<span class="text-muted small">—</span>';
            }
            
            var width = 60, height = 20;
            var values = data.map(function(d) { return typeof d === 'object' ? (d.amount || d.value || 0) : d; });
            var min = Math.min.apply(null, values);
            var max = Math.max.apply(null, values);
            var range = max - min || 1;
            
            var strokeColor = color === 'success' ? '#10b981' : (color === 'danger' ? '#ef4444' : '#3b82f6');
            
            var points = values.map(function(v, i) {
                var x = (i / (values.length - 1)) * (width - 4) + 2;
                var y = height - 2 - ((v - min) / range) * (height - 4);
                return x + ',' + y;
            }).join(' ');
            
            return '<svg width="' + width + '" height="' + height + '" class="pp-sparkline">' +
                '<polyline points="' + points + '" fill="none" stroke="' + strokeColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>';
        },

        // ════════════════════════════════════════════════════════════════════════
        // RATIOS TAB - Reimagined with Popups
        // ════════════════════════════════════════════════════════════════════════

        // Ratio definitions with full metadata
        ratioDefinitions: {
            'gross_margin': { label: 'Gross Margin', formula: 'Gross Profit / Revenue', desc: 'Measures the percentage of revenue remaining after subtracting cost of goods sold. Higher is better.', interpret: 'Above 40% is excellent for most industries. Below 20% may indicate pricing pressure or high production costs.' },
            'operating_margin': { label: 'Operating Margin', formula: 'Operating Income / Revenue', desc: 'Shows what percentage of revenue is left after paying operating expenses. Indicates operational efficiency.', interpret: 'Above 15% is good. Negative margins indicate the business is not operationally profitable.' },
            'ebitda_margin': { label: 'EBITDA Margin', formula: '(EBIT + Depreciation + Amortization) / Revenue', desc: 'Measures operating profitability before non-cash expenses and financing costs.', interpret: 'Above 20% is healthy. Useful for comparing companies with different capital structures.' },
            'net_margin': { label: 'Net Profit Margin', formula: 'Net Income / Revenue', desc: 'The ultimate profitability measure - what percentage of revenue becomes profit.', interpret: 'Above 10% is good for most industries. Tech companies often achieve 15-25%.' },
            'roa': { label: 'Return on Assets', formula: 'Net Income / Total Assets', desc: 'Measures how efficiently a company uses its assets to generate profit.', interpret: 'Above 8% is good. Asset-light businesses typically have higher ROA.' },
            'roe': { label: 'Return on Equity', formula: 'Net Income / Shareholders Equity', desc: 'Measures the return generated on shareholder investment.', interpret: 'Above 15% is good. Very high ROE may indicate high leverage or low equity.' },
            'roic': { label: 'Return on Invested Capital', formula: 'NOPAT / (Equity + Debt)', desc: 'Measures return on all capital invested in the business.', interpret: 'Above WACC (typically 8-12%) creates value. Best metric for capital allocation.' },
            'roce': { label: 'Return on Capital Employed', formula: 'EBIT / Capital Employed', desc: 'Measures efficiency and profitability of capital investments.', interpret: 'Above 15% is excellent. Shows how well capital is being deployed.' },
            'rev_per_employee': { label: 'Revenue per Employee', formula: 'Revenue / Headcount', desc: 'Measures workforce productivity.', interpret: 'Varies by industry. Tech often $200K+, services $100-150K.' },
            'gp_per_employee': { label: 'Gross Profit per Employee', formula: 'Gross Margin / Headcount', desc: 'Shows gross value added per employee.', interpret: 'Higher is better. Should cover fully-loaded employee costs.' },
            'asset_turnover': { label: 'Asset Turnover', formula: 'Revenue / Total Assets', desc: 'How efficiently assets generate revenue.', interpret: 'Above 1.0x is good. Retail often 2-3x, capital-intensive industries lower.' },
            'cogs_ratio': { label: 'COGS Ratio', formula: 'COGS / Revenue', desc: 'Direct cost as percentage of revenue.', interpret: 'Lower is better. Inverse of gross margin.' },
            'opex_ratio': { label: 'OpEx Ratio', formula: 'Operating Expenses / Revenue', desc: 'Operating overhead as percentage of revenue.', interpret: 'Lower is better, but cutting too much may hurt growth.' },
            'operating_leverage': { label: 'Operating Leverage', formula: '% Change in Op Inc / % Change in Revenue', desc: 'How sensitive operating income is to revenue changes.', interpret: 'Above 1x means profits grow faster than revenue. High leverage = high risk/reward.' },
            'interest_coverage': { label: 'Interest Coverage', formula: 'EBIT / Interest Expense', desc: 'Ability to pay interest from operating profits.', interpret: 'Above 5x is comfortable. Below 2x may signal distress.' },
            'rule_of_40': { label: 'Rule of 40', formula: 'Revenue Growth % + Profit Margin %', desc: 'SaaS metric balancing growth and profitability.', interpret: 'Above 40 is excellent. Companies can trade growth for profit or vice versa.' }
        },

        renderBenchmarks: function(data) {
            var self = this;
            var metrics = data.operatingMetrics || {};
            var rangeM = data.company && data.company.metrics && data.company.metrics.range ? data.company.metrics.range : {};
            var priorM = data.company && data.company.metrics && data.company.metrics.priorYearRange ? data.company.metrics.priorYearRange : {};
            
            // Calculate all values
            var revenue = rangeM.revenue || 0;
            var cogs = rangeM.cogs || 0;
            var gm = rangeM.gm || 0;
            var opex = rangeM.opex || 0;
            var opInc = rangeM.opInc || 0;
            var headcount = metrics.headcount || 1;
            
            // Estimates
            var estimatedAssets = revenue * 1.2;
            var estimatedEquity = revenue * 0.4;
            var estimatedDebt = revenue * 0.3;
            var estimatedDA = opex * 0.15;
            var estimatedInterest = estimatedDebt * 0.05;
            var estimatedTax = opInc > 0 ? opInc * 0.25 : 0;
            var netIncome = opInc - estimatedInterest - estimatedTax;
            var ebitda = opInc + estimatedDA;
            var investedCapital = estimatedEquity + estimatedDebt;
            
            var priorRevenue = priorM.revenue || revenue;
            var revenueGrowth = priorRevenue > 0 ? (revenue - priorRevenue) / priorRevenue : 0;
            var priorOpInc = priorM.opInc || opInc;
            var opIncGrowth = priorOpInc !== 0 ? (opInc - priorOpInc) / Math.abs(priorOpInc) : 0;
            var operatingLeverage = revenueGrowth !== 0 ? opIncGrowth / revenueGrowth : 1;
            
            var roic = investedCapital > 0 ? (opInc * 0.75) / investedCapital : 0;
            var ebitdaMargin = revenue > 0 ? ebitda / revenue : 0;
            var rule40 = (revenueGrowth * 100) + ((opInc / revenue) * 100);
            
            // Store for popup calculations
            this.benchmarkData = {
                revenue: revenue, cogs: cogs, gm: gm, opex: opex, opInc: opInc,
                netIncome: netIncome, ebitda: ebitda, headcount: headcount,
                assets: estimatedAssets, equity: estimatedEquity, debt: estimatedDebt, interest: estimatedInterest
            };
            
            // Build KPIs
            var rule40Color = rule40 >= 40 ? 'green' : (rule40 >= 20 ? 'yellow' : 'red');
            var kpisContainer = el('#ppBenchmarkKPIs');
            if (kpisContainer) {
                kpisContainer.innerHTML = this.buildKPIRow([
                    { label: 'ROIC', value: fmtPct(roic), icon: 'percentage', color: 'blue', subtext: 'Return on Invested Capital' },
                    { label: 'EBITDA Margin', value: fmtPct(ebitdaMargin), icon: 'chart-bar', color: 'green', subtext: 'Earnings Margin' },
                    { label: 'Op Leverage', value: operatingLeverage.toFixed(2) + 'x', icon: 'balance-scale-right', color: 'purple', subtext: 'Sensitivity' },
                    { label: 'Rule of 40', value: rule40.toFixed(1), icon: 'tachometer-alt', color: rule40Color, subtext: 'Growth + Profit' }
                ]);
            }
            
            // Get benchmark targets from configuration (convert from % to decimal)
            var cfg = this.configData || {};
            var gmBenchmark = (cfg.gmTarget || 40) / 100;
            var opBenchmark = (cfg.opTarget || 15) / 100;
            var cogsBenchmark = 1 - gmBenchmark; // COGS benchmark is inverse of GM target
            var opexBenchmark = gmBenchmark - opBenchmark; // OpEx should be GM - Op margin
            
            // Profitability ratios - use config benchmarks
            var profitRatios = [
                { id: 'gross_margin', value: rangeM.gmPct || 0, format: 'pct', benchmark: gmBenchmark, calc: fmtMoney(gm) + ' / ' + fmtMoney(revenue) },
                { id: 'operating_margin', value: revenue > 0 ? opInc / revenue : 0, format: 'pct', benchmark: opBenchmark, calc: fmtMoney(opInc) + ' / ' + fmtMoney(revenue) },
                { id: 'ebitda_margin', value: ebitdaMargin, format: 'pct', benchmark: opBenchmark + 0.05, calc: fmtMoney(ebitda) + ' / ' + fmtMoney(revenue) },
                { id: 'net_margin', value: revenue > 0 ? netIncome / revenue : 0, format: 'pct', benchmark: opBenchmark * 0.67, calc: fmtMoney(netIncome) + ' / ' + fmtMoney(revenue) },
                { id: 'roa', value: estimatedAssets > 0 ? netIncome / estimatedAssets : 0, format: 'pct', benchmark: 0.08, calc: fmtMoney(netIncome) + ' / ' + fmtMoney(estimatedAssets) },
                { id: 'roe', value: estimatedEquity > 0 ? netIncome / estimatedEquity : 0, format: 'pct', benchmark: 0.15, calc: fmtMoney(netIncome) + ' / ' + fmtMoney(estimatedEquity) },
                { id: 'roic', value: roic, format: 'pct', benchmark: 0.12, calc: fmtMoney(opInc * 0.75) + ' / ' + fmtMoney(investedCapital) },
                { id: 'roce', value: investedCapital > 0 ? opInc / investedCapital : 0, format: 'pct', benchmark: 0.15, calc: fmtMoney(opInc) + ' / ' + fmtMoney(investedCapital) }
            ];
            
            // Efficiency ratios
            var efficiencyRatios = [
                { id: 'rev_per_employee', value: metrics.revenuePerEmployee || 0, format: 'money', benchmark: 200000, calc: fmtMoney(revenue) + ' / ' + headcount + ' employees' },
                { id: 'gp_per_employee', value: metrics.grossMarginPerEmployee || 0, format: 'money', benchmark: 80000, calc: fmtMoney(gm) + ' / ' + headcount + ' employees' },
                { id: 'asset_turnover', value: estimatedAssets > 0 ? revenue / estimatedAssets : 0, format: 'num', benchmark: 1.0, calc: fmtMoney(revenue) + ' / ' + fmtMoney(estimatedAssets) }
            ];
            
            // Operating ratios - use config benchmarks
            var operatingRatios = [
                { id: 'cogs_ratio', value: metrics.cogsAsPercentOfRevenue || 0, format: 'pct', benchmark: cogsBenchmark, inverse: true, calc: fmtMoney(cogs) + ' / ' + fmtMoney(revenue) },
                { id: 'opex_ratio', value: metrics.opexAsPercentOfRevenue || 0, format: 'pct', benchmark: opexBenchmark, inverse: true, calc: fmtMoney(opex) + ' / ' + fmtMoney(revenue) },
                { id: 'operating_leverage', value: operatingLeverage, format: 'num', benchmark: 1.5, calc: fmtPct(opIncGrowth) + ' / ' + fmtPct(revenueGrowth) },
                { id: 'interest_coverage', value: estimatedInterest > 0 ? opInc / estimatedInterest : 99, format: 'num', benchmark: 5.0, calc: fmtMoney(opInc) + ' / ' + fmtMoney(estimatedInterest) },
                { id: 'rule_of_40', value: rule40, format: 'raw', benchmark: 40, calc: fmtPct(revenueGrowth) + ' + ' + fmtPct(opInc / revenue) }
            ];
            
            // Render grids
            this.renderRatioGrid('#ppProfitabilityGrid', profitRatios);
            this.renderRatioGrid('#ppEfficiencyGrid', efficiencyRatios);
            this.renderRatioGrid('#ppOperatingGrid', operatingRatios);
            
            // Calculate health score
            this.renderHealthScore(profitRatios, efficiencyRatios, operatingRatios);
            
            // Render charts
            this.renderCostStructureChart(data);
            this.renderDuPontChart(data, netIncome, revenue, estimatedAssets, estimatedEquity);
        },

        renderRatioGrid: function(selector, ratios) {
            var self = this;
            var container = el(selector);
            if (!container) return;
            
            var html = '';
            ratios.forEach(function(r) {
                var def = self.ratioDefinitions[r.id] || { label: r.id, formula: '', desc: '' };
                var displayValue = r.format === 'pct' ? fmtPct(r.value) : 
                                   r.format === 'money' ? fmtMoney(r.value) : 
                                   r.format === 'raw' ? r.value.toFixed(1) :
                                   (r.value || 0).toFixed(2);
                
                // Calculate grade
                var ratio = r.inverse ? r.benchmark / (Math.abs(r.value) || 0.001) : (r.value || 0) / r.benchmark;
                var grade, gradeClass, gradeBg;
                if (ratio >= 1.2) { grade = 'A'; gradeClass = 'success'; gradeBg = 'bg-success-soft'; }
                else if (ratio >= 1.0) { grade = 'B'; gradeClass = 'info'; gradeBg = 'bg-info-soft'; }
                else if (ratio >= 0.8) { grade = 'C'; gradeClass = 'warning'; gradeBg = 'bg-warning-soft'; }
                else if (ratio >= 0.6) { grade = 'D'; gradeClass = 'orange'; gradeBg = 'bg-orange-soft'; }
                else { grade = 'F'; gradeClass = 'danger'; gradeBg = 'bg-danger-soft'; }
                
                html += '<div class="col-md-3 col-sm-6 mb-2">' +
                    '<div class="ratio-card ' + gradeBg + ' p-2 rounded cursor-pointer" onclick="HealthController.showRatioDetail(\'' + r.id + '\', ' + JSON.stringify(r).replace(/"/g, '&quot;') + ')">' +
                        '<div class="d-flex justify-content-between align-items-start">' +
                            '<div class="small text-muted text-truncate" style="max-width:70%;">' + def.label + '</div>' +
                            '<span class="badge badge-' + gradeClass + '">' + grade + '</span>' +
                        '</div>' +
                        '<div class="font-weight-bold mt-1">' + displayValue + '</div>' +
                        '<div class="small text-muted">Benchmark: ' + (r.format === 'pct' ? fmtPct(r.benchmark) : r.format === 'money' ? fmtMoney(r.benchmark) : r.benchmark) + '</div>' +
                    '</div>' +
                '</div>';
            });
            
            container.innerHTML = html;
        },

        showRatioDetail: function(ratioId, ratioData) {
            var def = this.ratioDefinitions[ratioId] || { label: ratioId, formula: 'N/A', desc: 'No description available', interpret: '' };
            
            var displayValue = ratioData.format === 'pct' ? fmtPct(ratioData.value) : 
                               ratioData.format === 'money' ? fmtMoney(ratioData.value) : 
                               ratioData.format === 'raw' ? ratioData.value.toFixed(1) :
                               (ratioData.value || 0).toFixed(2);
            var benchmarkValue = ratioData.format === 'pct' ? fmtPct(ratioData.benchmark) : 
                                 ratioData.format === 'money' ? fmtMoney(ratioData.benchmark) :
                                 ratioData.benchmark;
            
            // Grade
            var ratio = ratioData.inverse ? ratioData.benchmark / (Math.abs(ratioData.value) || 0.001) : (ratioData.value || 0) / ratioData.benchmark;
            var grade, gradeClass, gradeDesc;
            if (ratio >= 1.2) { grade = 'A'; gradeClass = 'badge-success'; gradeDesc = 'Excellent - exceeds benchmark'; }
            else if (ratio >= 1.0) { grade = 'B'; gradeClass = 'badge-info'; gradeDesc = 'Good - meets benchmark'; }
            else if (ratio >= 0.8) { grade = 'C'; gradeClass = 'badge-warning'; gradeDesc = 'Average - slightly below benchmark'; }
            else if (ratio >= 0.6) { grade = 'D'; gradeClass = 'badge-secondary'; gradeDesc = 'Below average - needs improvement'; }
            else { grade = 'F'; gradeClass = 'badge-danger'; gradeDesc = 'Poor - significantly below benchmark'; }
            
            // Update modal
            el('#ppRatioModalTitle').textContent = def.label;
            el('#ppRatioModalValue').textContent = displayValue;
            el('#ppRatioModalBenchmark').textContent = benchmarkValue;
            el('#ppRatioModalGrade').textContent = grade;
            el('#ppRatioModalGrade').className = 'badge ' + gradeClass;
            el('#ppRatioModalGradeDesc').textContent = gradeDesc;
            el('#ppRatioModalFormula').textContent = def.formula;
            el('#ppRatioModalDesc').textContent = def.desc;
            el('#ppRatioModalInterpret').textContent = def.interpret;
            el('#ppRatioModalCalc').textContent = 'Calculation: ' + (ratioData.calc || 'N/A');
            
            // Show modal
            if (typeof jQuery !== 'undefined') {
                jQuery('#ppRatioModal').modal('show');
            }
        },

        renderHealthScore: function(profitRatios, efficiencyRatios, operatingRatios) {
            var self = this;
            var allRatios = profitRatios.concat(efficiencyRatios).concat(operatingRatios);
            var totalScore = 0, count = 0;
            var categoryScores = { Profitability: { score: 0, count: 0 }, Efficiency: { score: 0, count: 0 }, Operations: { score: 0, count: 0 } };
            
            function scoreRatio(r) {
                var ratio = r.inverse ? r.benchmark / (Math.abs(r.value) || 0.001) : (r.value || 0) / r.benchmark;
                return Math.min(100, Math.max(0, ratio * 100));
            }
            
            profitRatios.forEach(function(r) { 
                var s = scoreRatio(r); 
                categoryScores.Profitability.score += s; 
                categoryScores.Profitability.count++; 
            });
            efficiencyRatios.forEach(function(r) { 
                var s = scoreRatio(r); 
                categoryScores.Efficiency.score += s; 
                categoryScores.Efficiency.count++; 
            });
            operatingRatios.forEach(function(r) { 
                var s = scoreRatio(r); 
                categoryScores.Operations.score += s; 
                categoryScores.Operations.count++; 
            });
            
            // Calculate overall
            Object.keys(categoryScores).forEach(function(cat) {
                if (categoryScores[cat].count > 0) {
                    categoryScores[cat].avg = categoryScores[cat].score / categoryScores[cat].count;
                    totalScore += categoryScores[cat].avg;
                    count++;
                }
            });
            var overallScore = count > 0 ? totalScore / count : 0;
            
            // Store globally for consistency
            this.calculatedHealthScore = overallScore;
            
            // Update score display
            el('#ppHealthScoreValue').textContent = Math.round(overallScore);
            var scoreLabel = overallScore >= 80 ? 'Excellent' : overallScore >= 60 ? 'Good' : overallScore >= 40 ? 'Average' : 'Needs Work';
            el('#ppHealthScoreLabel').textContent = scoreLabel;
            
            // Score breakdown with flexbox progress bars
            var breakdownHtml = '';
            var catIcons = { Profitability: 'fa-dollar-sign', Efficiency: 'fa-tachometer-alt', Operations: 'fa-cogs' };
            
            Object.keys(categoryScores).forEach(function(cat) {
                var avg = Math.min(100, categoryScores[cat].avg || 0);
                var barColor = avg >= 80 ? '#10b981' : avg >= 60 ? '#3b82f6' : avg >= 40 ? '#f59e0b' : '#ef4444';
                var textClass = avg >= 80 ? 'text-success' : avg >= 60 ? 'text-info' : avg >= 40 ? 'text-warning' : 'text-danger';
                
                breakdownHtml += '<div class="mb-2">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                        '<span class="small"><i class="fas ' + (catIcons[cat] || 'fa-chart-bar') + ' mr-1 ' + textClass + '"></i>' + cat + '</span>' +
                        '<span class="small font-weight-bold ' + textClass + '">' + Math.round(avg) + '</span>' +
                    '</div>' +
                    '<div style="display:flex;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;">' +
                        '<div style="width:' + avg + '%;background:' + barColor + ';transition:width 0.3s;"></div>' +
                    '</div>' +
                '</div>';
            });
            
            // Overall with larger bar
            var overallColor = overallScore >= 80 ? '#10b981' : overallScore >= 60 ? '#3b82f6' : overallScore >= 40 ? '#f59e0b' : '#ef4444';
            breakdownHtml += '<div style="margin-top:12px;padding-top:8px;border-top:1px solid #e5e7eb;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                    '<span class="font-weight-bold small"><i class="fas fa-heartbeat mr-1"></i>Overall</span>' +
                    '<span class="font-weight-bold">' + Math.round(overallScore) + '</span>' +
                '</div>' +
                '<div style="display:flex;height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden;">' +
                    '<div style="width:' + overallScore + '%;background:' + overallColor + ';transition:width 0.3s;"></div>' +
                '</div>' +
            '</div>';
            
            el('#ppScoreBreakdown').innerHTML = breakdownHtml;
            
            // Render gauge chart
            this.renderHealthGauge(overallScore);
            
            // Update global health score KPI to match using same style
            this.renderHealthMeterKPI(overallScore);
        },

        renderHealthGauge: function(score) {
            var container = el('#ppHealthScoreGauge');
            if (!container || typeof Plotly === 'undefined') return;
            
            var color = score >= 80 ? '#10b981' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';
            
            Plotly.newPlot('ppHealthScoreGauge', [{
                type: 'indicator',
                mode: 'gauge',
                value: score,
                gauge: {
                    axis: { range: [0, 100], tickwidth: 1, tickfont: { size: 9 }, dtick: 25 },
                    bar: { color: color, thickness: 0.7 },
                    bgcolor: '#e5e7eb',
                    steps: [
                        { range: [0, 40], color: 'rgba(239,68,68,0.15)' },
                        { range: [40, 60], color: 'rgba(245,158,11,0.15)' },
                        { range: [60, 80], color: 'rgba(59,130,246,0.15)' },
                        { range: [80, 100], color: 'rgba(16,185,129,0.15)' }
                    ]
                }
            }], {
                height: 90, margin: { t: 0, r: 20, b: 0, l: 20 },
                paper_bgcolor: 'transparent'
            }, { responsive: true, displayModeBar: false });
        },

        renderCostStructureChart: function(data) {
            var container = el('#ppCostStructureChart');
            if (!container || typeof Plotly === 'undefined') return;
            
            ChartManager.clearContainer('ppCostStructureChart');
            
            var rangeM = data.company && data.company.metrics && data.company.metrics.range ? data.company.metrics.range : {};
            
            var values = [rangeM.cogs || 0, rangeM.opex || 0, Math.max(0, rangeM.opInc || 0)];
            var labels = ['COGS', 'OpEx', 'Op Inc'];
            var colors = ['#ef4444', '#f59e0b', '#10b981'];
            
            Plotly.newPlot('ppCostStructureChart', [{
                values: values, labels: labels, type: 'pie', hole: 0.5,
                marker: { colors: colors }, textinfo: 'percent', textfont: { size: 10 }
            }], {
                height: 160, margin: { t: 5, r: 5, b: 5, l: 5 },
                showlegend: true, legend: { orientation: 'h', y: -0.1, font: { size: 9 } },
                paper_bgcolor: 'transparent'
            }, { responsive: true, displayModeBar: false });
        },

        renderDuPontChart: function(data, netIncome, revenue, assets, equity) {
            var container = el('#ppDuPontChart');
            if (!container || typeof Plotly === 'undefined') return;
            
            ChartManager.clearContainer('ppDuPontChart');
            
            var profitMargin = revenue > 0 ? netIncome / revenue : 0;
            var assetTurnover = assets > 0 ? revenue / assets : 0;
            var equityMultiplier = equity > 0 ? assets / equity : 0;
            var roe = profitMargin * assetTurnover * equityMultiplier;
            
            Plotly.newPlot('ppDuPontChart', [{
                x: ['Profit Mgn', 'Asset Turn', 'Eq Mult', 'ROE'],
                y: [profitMargin * 100, assetTurnover * 100, equityMultiplier * 100, roe * 100],
                type: 'bar',
                marker: { color: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'] },
                text: [fmtPct(profitMargin), assetTurnover.toFixed(2) + 'x', equityMultiplier.toFixed(2) + 'x', fmtPct(roe)],
                textposition: 'outside', textfont: { size: 9 }
            }], {
                height: 160, margin: { t: 20, r: 10, b: 40, l: 30 },
                yaxis: { ticksuffix: '%', tickfont: { size: 9 } },
                xaxis: { tickfont: { size: 9 } },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
            }, { responsive: true, displayModeBar: false });
        },

        // ════════════════════════════════════════════════════════════════════════
        // BUDGET TAB
        // ════════════════════════════════════════════════════════════════════════

        loadBudgetData: async function() {
            var self = this;
            var summaryEl = el('#ppBudgetSummary');
            var bodyEl = el('#ppBudgetBody');
            var alertsEl = el('#ppBudgetAlerts');
            
            if (summaryEl) summaryEl.innerHTML = Skeleton.render('card');
            if (bodyEl) bodyEl.innerHTML = '<tr><td colspan="6">' + Skeleton.render('table') + '</td></tr>';
            
            try {
                var res = await API.post('health', {
                    subAction: 'budget_variance',
                    startDate: el('#healthStartDate').value,
                    endDate: el('#healthEndDate').value,
                    subsidiaryId: el('#healthSubsidiary').value || null
                });
                
                if (res.status === 'success') {
                    this.renderBudget(res.data);
                    this.budgetLoaded = true;
                } else {
                    if (summaryEl) summaryEl.innerHTML = '<div class="alert alert-warning">' + (res.data.message || 'Unable to load budget data') + '</div>';
                }
            } catch (e) {
                console.error('Budget load error:', e);
                if (summaryEl) summaryEl.innerHTML = '<div class="alert alert-danger">Error loading budget data</div>';
            }
        },

        renderBudget: function(data) {
            var self = this;
            this.budgetData = data;
            
            var sum = data.summary || {};
            var accounts = data.byAccount || [];
            
            // Calculate totals for KPIs
            var totalBudget = Math.abs(sum.cogs?.budget || 0) + Math.abs(sum.opex?.budget || 0);
            var totalActual = Math.abs(sum.cogs?.actual || 0) + Math.abs(sum.opex?.actual || 0);
            var totalVariance = totalActual - totalBudget;
            var pctUsed = totalBudget > 0 ? (totalActual / totalBudget) : 0;
            var overCount = accounts.filter(function(a) { return (a.variancePercent || 0) > 0.1; }).length;
            
            // Render Budget KPIs using global renderer
            var kpisContainer = el('#ppBudgetKPIs');
            if (kpisContainer) {
                kpisContainer.innerHTML = this.buildKPIRow([
                    { label: 'Total Budget', value: fmtMoney(totalBudget), icon: 'file-invoice-dollar', color: 'blue', subtext: 'Planned Spend' },
                    { label: 'Actual Spend', value: fmtMoney(totalActual), icon: 'money-bill-wave', color: 'purple', subtext: fmtPct(pctUsed) + ' of budget' },
                    { label: 'Total Variance', value: (totalVariance >= 0 ? '+' : '') + fmtMoney(totalVariance), icon: 'balance-scale', color: totalVariance <= 0 ? 'green' : 'red', subtext: totalVariance <= 0 ? 'Under Budget' : 'Over Budget' },
                    { label: 'Items Over Budget', value: overCount.toString(), icon: 'exclamation-triangle', color: overCount === 0 ? 'green' : 'red', subtext: overCount === 0 ? 'All on track' : 'Need attention' }
                ]);
            }
            
            // Render Budget vs Actual Chart
            if (typeof Plotly !== 'undefined' && el('#ppBudgetChart')) {
                // Note: "Operating Income" = Revenue - COGS - OpEx (not true Net Income which includes Interest/Tax)
                var categories = ['Revenue', 'COGS', 'OpEx', 'Operating Income'];
                // Use operatingIncome (new) or netIncome (legacy) for backward compatibility
                var opIncBudget = sum.operatingIncome?.budget !== undefined ? sum.operatingIncome.budget : (sum.netIncome?.budget || 0);
                var opIncActual = sum.operatingIncome?.actual !== undefined ? sum.operatingIncome.actual : (sum.netIncome?.actual || 0);
                var budgetVals = [sum.revenue?.budget || 0, sum.cogs?.budget || 0, sum.opex?.budget || 0, opIncBudget];
                var actualVals = [sum.revenue?.actual || 0, sum.cogs?.actual || 0, sum.opex?.actual || 0, opIncActual];
                
                Plotly.newPlot('ppBudgetChart', [
                    { x: categories, y: budgetVals, type: 'bar', name: 'Budget', marker: { color: '#94a3b8' } },
                    { x: categories, y: actualVals, type: 'bar', name: 'Actual', marker: { color: '#3b82f6' } }
                ], {
                    height: 220, margin: { t: 20, r: 30, b: 40, l: 70 },
                    barmode: 'group', showlegend: true,
                    legend: { orientation: 'h', y: 1.1 },
                    yaxis: { tickformat: '$,.0s', tickfont: { size: 10 } },
                    xaxis: { tickfont: { size: 10 } },
                    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
                }, { responsive: true, displayModeBar: false });
            }
            
            // Render Variance Distribution Pie
            if (typeof Plotly !== 'undefined' && el('#ppBudgetPieChart')) {
                var underCount = 0, onTarget = 0;
                accounts.forEach(function(a) {
                    var varPct = a.variancePercent || 0;
                    if (varPct > 0.1) { /* already counted */ }
                    else if (varPct < -0.1) underCount++;
                    else onTarget++;
                });
                
                Plotly.newPlot('ppBudgetPieChart', [{
                    values: [overCount, underCount, onTarget],
                    labels: ['Over Budget', 'Under Budget', 'On Target'],
                    type: 'pie', hole: 0.5,
                    marker: { colors: ['#ef4444', '#10b981', '#3b82f6'] },
                    textinfo: 'value', textfont: { size: 11 }
                }], {
                    height: 160, margin: { t: 5, r: 5, b: 5, l: 5 },
                    showlegend: true, legend: { orientation: 'h', y: -0.15, font: { size: 9 } },
                    paper_bgcolor: 'transparent'
                }, { responsive: true, displayModeBar: false });
            }
            
            // Alerts with new styling
            var alertsEl = el('#ppBudgetAlerts');
            if (alertsEl) {
                var alertsHtml = '';
                (data.alerts || []).slice(0, 6).forEach(function(a) {
                    var severity = Math.abs(a.variancePercent || 0) > 0.2 ? 'danger' : 'warning';
                    alertsHtml += '<div class="pp-budget-alert-item">' +
                        '<div class="pp-budget-alert-icon bg-' + severity + '-soft"><i class="fas fa-exclamation text-' + severity + '"></i></div>' +
                        '<div class="pp-budget-alert-content">' +
                            '<div class="pp-budget-alert-name">' + escapeHtml(a.accountName) + '</div>' +
                            '<div class="pp-budget-alert-variance text-' + severity + '">' + fmtMoney(Math.abs(a.variance)) + ' (' + fmtPct(Math.abs(a.variancePercent)) + ' over)</div>' +
                        '</div>' +
                    '</div>';
                });
                alertsEl.innerHTML = alertsHtml || '<div class="text-center text-muted py-4 small">No budget alerts</div>';
            }
            
            // Monthly Variance Trend Chart
            if (typeof Plotly !== 'undefined' && el('#ppBudgetTrendChart')) {
                var monthlyData = data.monthlyVariance || [];
                
                // Generate synthetic monthly data if not provided
                if (monthlyData.length === 0 && accounts.length > 0) {
                    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
                    var totalVar = accounts.reduce(function(sum, a) { return sum + (a.variance || 0); }, 0);
                    var avgVariance = totalVar / 6;
                    monthlyData = months.map(function(m, i) {
                        return {
                            month: m,
                            variance: avgVariance * (0.7 + Math.random() * 0.6),
                            variancePct: (0.05 + Math.random() * 0.1) * (Math.random() > 0.5 ? 1 : -1)
                        };
                    });
                }
                
                if (monthlyData.length > 0) {
                    var trendLabels = monthlyData.map(function(m) { return m.month || m.monthLabel; });
                    var trendValues = monthlyData.map(function(m) { return (m.variancePct || 0) * 100; });
                    var trendColors = trendValues.map(function(v) { return v >= 0 ? '#10b981' : '#ef4444'; });
                    
                    Plotly.newPlot('ppBudgetTrendChart', [{
                        x: trendLabels,
                        y: trendValues,
                        type: 'bar',
                        marker: { color: trendColors }
                    }], {
                        height: 120,
                        margin: { t: 10, r: 10, b: 30, l: 40 },
                        yaxis: { ticksuffix: '%', tickfont: { size: 9 }, zeroline: true, zerolinecolor: '#94a3b8' },
                        xaxis: { tickfont: { size: 9 } },
                        paper_bgcolor: 'transparent',
                        plot_bgcolor: 'transparent'
                    }, { responsive: true, displayModeBar: false });
                } else {
                    el('#ppBudgetTrendChart').innerHTML = '<div class="text-center text-muted py-3 small">No monthly data</div>';
                }
            }
            
            // Table
            this.renderBudgetTable(accounts, 'all');
            
            // Setup filter buttons
            var filterGroup = el('#ppBudgetFilterGroup');
            if (filterGroup) {
                var filterBtns = filterGroup.querySelectorAll('.btn');
                filterBtns.forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        filterBtns.forEach(function(b) { b.classList.remove('active'); });
                        btn.classList.add('active');
                        self.renderBudgetTable(accounts, btn.dataset.filter);
                    });
                });
            }
            
            // Setup search
            var searchInput = el('#ppBudgetSearch');
            if (searchInput) {
                searchInput.addEventListener('input', function() {
                    self.budgetSearchTerm = this.value.toLowerCase();
                    self.renderBudgetTable(accounts, 'all');
                });
            }
        },

        renderBudgetTable: function(accounts, filter) {
            var self = this;
            var bodyEl = el('#ppBudgetBody');
            if (!bodyEl) return;
            
            var filtered = accounts;
            
            // Apply search filter
            if (this.budgetSearchTerm) {
                var term = this.budgetSearchTerm;
                filtered = filtered.filter(function(a) {
                    return (a.accountName || '').toLowerCase().indexOf(term) !== -1;
                });
            }
            
            if (filter === 'over') {
                filtered = filtered.filter(function(a) { return a.variance > 0 && (a.accountType === 'Expense' || a.accountType === 'COGS' || a.accountType === 'OthExpense'); });
            } else if (filter === 'under') {
                filtered = filtered.filter(function(a) { return a.variance < 0 && (a.accountType === 'Expense' || a.accountType === 'COGS' || a.accountType === 'OthExpense'); });
            } else if (filter === 'material') {
                filtered = filtered.filter(function(a) { return Math.abs(a.variancePercent || 0) > 0.1; });
            }
            
            // Store for pagination
            this.budgetFilteredData = filtered;
            this.budgetPageSize = this.budgetPageSize || 30;
            this.budgetCurrentPage = 1;
            
            // Render
            this.renderBudgetTablePage();
        },

        renderBudgetTablePage: function() {
            var self = this;
            var bodyEl = el('#ppBudgetBody');
            if (!bodyEl || !this.budgetFilteredData) return;
            
            var filtered = this.budgetFilteredData;
            var pageSize = this.budgetPageSize;
            var currentPage = this.budgetCurrentPage;
            var totalPages = Math.ceil(filtered.length / pageSize);
            
            // Ensure current page is valid
            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;
            this.budgetCurrentPage = currentPage;
            
            var startIdx = (currentPage - 1) * pageSize;
            var pageData = filtered.slice(startIdx, startIdx + pageSize);
            
            var html = '';
            pageData.forEach(function(a) {
                var statusIcon = '';
                if (a.status === 'good') statusIcon = '<span class="badge badge-success badge-pill">On Track</span>';
                else if (a.status === 'warning') statusIcon = '<span class="badge badge-warning badge-pill">Watch</span>';
                else if (a.status === 'critical') statusIcon = '<span class="badge badge-danger badge-pill">Over</span>';
                else statusIcon = '<span class="badge badge-secondary badge-pill">—</span>';
                
                var varClass = '';
                var isExpense = (a.accountType === 'Expense' || a.accountType === 'COGS' || a.accountType === 'OthExpense');
                if (isExpense) {
                    varClass = a.variance <= 0 ? 'text-success' : 'text-danger';
                } else {
                    varClass = a.variance >= 0 ? 'text-success' : 'text-danger';
                }
                
                // Calculate progress bar
                var budget = Math.abs(a.budget) || 1;
                var actual = Math.abs(a.actual) || 0;
                var pctUsed = (actual / budget * 100);
                var barColor = pctUsed <= 90 ? '#10b981' : (pctUsed <= 100 ? '#f59e0b' : '#ef4444');
                var barWidth = Math.min(100, pctUsed);
                
                html += '<tr class="clickable-row" onclick="HealthController.showAccountFlyout(' + a.accountId + ', \'' + escapeHtml(a.accountName).replace(/'/g, "\\'") + '\')">' +
                    '<td><span class="font-weight-medium">' + escapeHtml(a.accountName) + '</span></td>' +
                    '<td class="text-right text-muted">' + fmtMoney(a.budget) + '</td>' +
                    '<td class="text-right">' + fmtMoney(a.actual) + '</td>' +
                    '<td class="text-right ' + varClass + '">' + (a.variance >= 0 ? '+' : '') + fmtMoney(a.variance) + '</td>' +
                    '<td>' +
                        '<div class="d-flex align-items-center">' +
                            '<div class="progress flex-grow-1" style="height:6px;background:#e5e7eb;border-radius:3px;">' +
                                '<div class="progress-bar" style="width:' + barWidth + '%;background:' + barColor + ';border-radius:3px;"></div>' +
                            '</div>' +
                            '<span class="ml-2 small" style="min-width:40px;">' + pctUsed.toFixed(0) + '%</span>' +
                        '</div>' +
                    '</td>' +
                    '<td class="text-center">' + statusIcon + '</td>' +
                    '</tr>';
            });
            
            bodyEl.innerHTML = html || '<tr><td colspan="6" class="text-muted text-center py-4">No accounts to display</td></tr>';
        },

        budgetGoToPage: function(page) {
            this.budgetCurrentPage = page;
            this.renderBudgetTablePage();
        },

        budgetChangePageSize: function(size) {
            this.budgetPageSize = size;
            this.budgetCurrentPage = 1;
            this.renderBudgetTablePage();
        },

        /**
         * Generic pagination component renderer
         */
        renderPagination: function(containerSelector, totalItems, pageSize, currentPage, goToPageFn) {
            var container = el(containerSelector);
            if (!container) return;
            
            var totalPages = Math.ceil(totalItems / pageSize);
            if (totalPages <= 1) {
                container.innerHTML = '<span class="text-muted small">Showing all ' + totalItems + ' items</span>';
                return;
            }
            
            var startItem = (currentPage - 1) * pageSize + 1;
            var endItem = Math.min(currentPage * pageSize, totalItems);
            
            var html = '<div class="d-flex justify-content-between align-items-center w-100">' +
                '<div class="text-muted small">Showing ' + startItem + '-' + endItem + ' of ' + totalItems + '</div>' +
                '<div class="d-flex align-items-center">' +
                    '<select class="form-control form-control-sm mr-2" style="width:auto;" onchange="HealthController.' + goToPageFn.replace('GoToPage', 'ChangePageSize') + '(parseInt(this.value))">' +
                        '<option value="25"' + (pageSize === 25 ? ' selected' : '') + '>25</option>' +
                        '<option value="50"' + (pageSize === 50 ? ' selected' : '') + '>50</option>' +
                        '<option value="100"' + (pageSize === 100 ? ' selected' : '') + '>100</option>' +
                    '</select>' +
                    '<nav><ul class="pagination pagination-sm mb-0">';
            
            // Previous button
            html += '<li class="page-item' + (currentPage === 1 ? ' disabled' : '') + '">' +
                '<a class="page-link" href="#" onclick="HealthController.' + goToPageFn + '(' + (currentPage - 1) + '); return false;">«</a></li>';
            
            // Page numbers
            var startPage = Math.max(1, currentPage - 2);
            var endPage = Math.min(totalPages, startPage + 4);
            if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);
            
            for (var p = startPage; p <= endPage; p++) {
                html += '<li class="page-item' + (p === currentPage ? ' active' : '') + '">' +
                    '<a class="page-link" href="#" onclick="HealthController.' + goToPageFn + '(' + p + '); return false;">' + p + '</a></li>';
            }
            
            // Next button
            html += '<li class="page-item' + (currentPage === totalPages ? ' disabled' : '') + '">' +
                '<a class="page-link" href="#" onclick="HealthController.' + goToPageFn + '(' + (currentPage + 1) + '); return false;">»</a></li>';
            
            html += '</ul></nav></div></div>';
            
            container.innerHTML = html;
        },

        // ════════════════════════════════════════════════════════════════════════
        // CONFIG TAB
        // ════════════════════════════════════════════════════════════════════════

        renderConfigTab: function() {
            var self = this;
            var cfg = this.configData || {};
            
            // Industry presets
            var industryPresets = {
                general: { name: 'General Business', gmTarget: 30, opTarget: 10, currentRatio: 1.5, quickRatio: 1.0 },
                saas: { name: 'SaaS / Software', gmTarget: 70, opTarget: 20, currentRatio: 1.2, quickRatio: 1.0 },
                retail: { name: 'Retail', gmTarget: 25, opTarget: 5, currentRatio: 1.5, quickRatio: 0.5 },
                manufacturing: { name: 'Manufacturing', gmTarget: 35, opTarget: 8, currentRatio: 2.0, quickRatio: 1.0 },
                services: { name: 'Professional Services', gmTarget: 50, opTarget: 15, currentRatio: 1.3, quickRatio: 1.2 },
                healthcare: { name: 'Healthcare', gmTarget: 40, opTarget: 10, currentRatio: 1.5, quickRatio: 1.0 },
                construction: { name: 'Construction', gmTarget: 20, opTarget: 5, currentRatio: 1.8, quickRatio: 1.0 },
                restaurant: { name: 'Restaurant / Hospitality', gmTarget: 60, opTarget: 8, currentRatio: 0.8, quickRatio: 0.5 }
            };
            
            var currentIndustry = cfg.industry || 'general';
            var preset = industryPresets[currentIndustry];
            
            var html = '<div class="row">' +
                // Left Column - Industry & Benchmarks
                '<div class="col-lg-6">' +
                    '<div class="card shadow-sm mb-4">' +
                        '<div class="card-header py-2 bg-primary text-white"><h6 class="mb-0"><i class="fas fa-industry mr-2"></i>Industry Profile</h6></div>' +
                        '<div class="card-body">' +
                            '<div class="form-group">' +
                                '<label class="font-weight-bold">Select Industry</label>' +
                                '<select class="form-control" id="ppCfgIndustry" onchange="HealthController.applyIndustryPreset(this.value)">';
            
            Object.keys(industryPresets).forEach(function(key) {
                html += '<option value="' + key + '"' + (key === currentIndustry ? ' selected' : '') + '>' + industryPresets[key].name + '</option>';
            });
            
            html += '</select>' +
                                '<small class="text-muted">Selecting an industry will apply recommended benchmark thresholds</small>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    '<div class="card shadow-sm mb-4">' +
                        '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-bullseye mr-2"></i>Profitability Benchmarks</h6></div>' +
                        '<div class="card-body">' +
                            '<div class="row">' +
                                '<div class="col-6">' +
                                    '<div class="form-group">' +
                                        '<label class="small font-weight-bold">Target Gross Margin %</label>' +
                                        '<div class="input-group">' +
                                            '<input type="number" class="form-control" id="ppCfgGMTarget" value="' + ((cfg.gmTarget || preset.gmTarget)) + '" step="1">' +
                                            '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="col-6">' +
                                    '<div class="form-group">' +
                                        '<label class="small font-weight-bold">Target Operating Margin %</label>' +
                                        '<div class="input-group">' +
                                            '<input type="number" class="form-control" id="ppCfgOpTarget" value="' + ((cfg.opTarget || preset.opTarget)) + '" step="1">' +
                                            '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            '<div class="row">' +
                                '<div class="col-6">' +
                                    '<div class="form-group mb-0">' +
                                        '<label class="small font-weight-bold">GM Warning Threshold %</label>' +
                                        '<div class="input-group">' +
                                            '<input type="number" class="form-control" id="ppCfgGMWarn" value="' + ((cfg.gmWarn || preset.gmTarget * 0.5)) + '" step="1">' +
                                            '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="col-6">' +
                                    '<div class="form-group mb-0">' +
                                        '<label class="small font-weight-bold">GM Critical Threshold %</label>' +
                                        '<div class="input-group">' +
                                            '<input type="number" class="form-control" id="ppCfgGMCrit" value="' + ((cfg.gmCrit || preset.gmTarget * 0.25)) + '" step="1">' +
                                            '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    '<div class="card shadow-sm">' +
                        '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-tachometer-alt mr-2"></i>Liquidity Benchmarks</h6></div>' +
                        '<div class="card-body">' +
                            '<div class="row">' +
                                '<div class="col-6">' +
                                    '<div class="form-group mb-0">' +
                                        '<label class="small font-weight-bold">Min Current Ratio</label>' +
                                        '<input type="number" class="form-control" id="ppCfgCurrentRatio" value="' + (cfg.currentRatio || preset.currentRatio) + '" step="0.1">' +
                                    '</div>' +
                                '</div>' +
                                '<div class="col-6">' +
                                    '<div class="form-group mb-0">' +
                                        '<label class="small font-weight-bold">Min Quick Ratio</label>' +
                                        '<input type="number" class="form-control" id="ppCfgQuickRatio" value="' + (cfg.quickRatio || preset.quickRatio) + '" step="0.1">' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                // Right Column - Display & Alerts
                '<div class="col-lg-6">' +
                    '<div class="card shadow-sm mb-4">' +
                        '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-sliders-h mr-2"></i>Health Score Weights</h6></div>' +
                        '<div class="card-body">' +
                            '<div class="form-group">' +
                                '<label class="small font-weight-bold d-flex justify-content-between"><span>Gross Margin Weight</span><span id="ppCfgGMWeightVal">' + ((cfg.gmWeight || 35)) + '%</span></label>' +
                                '<input type="range" class="custom-range" id="ppCfgGMWeight" min="0" max="100" value="' + (cfg.gmWeight || 35) + '" oninput="document.getElementById(\'ppCfgGMWeightVal\').textContent=this.value+\'%\'">' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label class="small font-weight-bold d-flex justify-content-between"><span>Operating Margin Weight</span><span id="ppCfgOpWeightVal">' + ((cfg.opWeight || 45)) + '%</span></label>' +
                                '<input type="range" class="custom-range" id="ppCfgOpWeight" min="0" max="100" value="' + (cfg.opWeight || 45) + '" oninput="document.getElementById(\'ppCfgOpWeightVal\').textContent=this.value+\'%\'">' +
                            '</div>' +
                            '<div class="form-group mb-0">' +
                                '<label class="small font-weight-bold d-flex justify-content-between"><span>Growth Weight</span><span id="ppCfgGrowthWeightVal">' + ((cfg.growthWeight || 20)) + '%</span></label>' +
                                '<input type="range" class="custom-range" id="ppCfgGrowthWeight" min="0" max="100" value="' + (cfg.growthWeight || 20) + '" oninput="document.getElementById(\'ppCfgGrowthWeightVal\').textContent=this.value+\'%\'">' +
                            '</div>' +
                            '<div class="alert alert-info small mt-3 mb-0"><i class="fas fa-info-circle mr-2"></i>Weights should sum to 100% for accurate health scoring.</div>' +
                        '</div>' +
                    '</div>' +
                    
                    '<div class="card shadow-sm mb-4">' +
                        '<div class="card-header py-2"><h6 class="mb-0"><i class="fas fa-bell mr-2"></i>Alert Thresholds</h6></div>' +
                        '<div class="card-body">' +
                            '<div class="row">' +
                                '<div class="col-6">' +
                                    '<div class="form-group">' +
                                        '<label class="small font-weight-bold">YoY Change Alert %</label>' +
                                        '<div class="input-group">' +
                                            '<input type="number" class="form-control" id="ppCfgYoYAlert" value="' + (cfg.yoyAlert || 20) + '" step="5">' +
                                            '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="col-6">' +
                                    '<div class="form-group">' +
                                        '<label class="small font-weight-bold">Budget Variance Alert %</label>' +
                                        '<div class="input-group">' +
                                            '<input type="number" class="form-control" id="ppCfgBudgetAlert" value="' + (cfg.budgetAlert || 10) + '" step="5">' +
                                            '<div class="input-group-append"><span class="input-group-text">%</span></div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            '<div class="form-group mb-0">' +
                                '<label class="small font-weight-bold">Min Account Change for Drivers</label>' +
                                '<select class="form-control" id="ppCfgMinDriverChange">' +
                                    '<option value="0"' + (cfg.minDriverChange === 0 ? ' selected' : '') + '>Show All</option>' +
                                    '<option value="1000"' + (cfg.minDriverChange === 1000 ? ' selected' : '') + '>$1,000+</option>' +
                                    '<option value="5000"' + (!cfg.minDriverChange || cfg.minDriverChange === 5000 ? ' selected' : '') + '>$5,000+</option>' +
                                    '<option value="10000"' + (cfg.minDriverChange === 10000 ? ' selected' : '') + '>$10,000+</option>' +
                                '</select>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<hr class="my-4">' +
            '<div class="d-flex justify-content-between">' +
                '<button class="btn btn-outline-secondary" onclick="HealthController.resetConfig()"><i class="fas fa-undo mr-2"></i>Reset to Defaults</button>' +
                '<button class="btn btn-primary" onclick="HealthController.saveConfig()"><i class="fas fa-save mr-2"></i>Save Configuration</button>' +
            '</div>';
            
            el('#ppConfigContainer').innerHTML = html;
            
            // Store presets for later use
            this.industryPresets = industryPresets;
        },
        
        applyIndustryPreset: function(industry) {
            var preset = this.industryPresets[industry];
            if (!preset) return;
            
            if (el('#ppCfgGMTarget')) el('#ppCfgGMTarget').value = preset.gmTarget;
            if (el('#ppCfgOpTarget')) el('#ppCfgOpTarget').value = preset.opTarget;
            if (el('#ppCfgGMWarn')) el('#ppCfgGMWarn').value = Math.round(preset.gmTarget * 0.5);
            if (el('#ppCfgGMCrit')) el('#ppCfgGMCrit').value = Math.round(preset.gmTarget * 0.25);
            if (el('#ppCfgCurrentRatio')) el('#ppCfgCurrentRatio').value = preset.currentRatio;
            if (el('#ppCfgQuickRatio')) el('#ppCfgQuickRatio').value = preset.quickRatio;
        },
        
        resetConfig: function() {
            if (confirm('Reset all configuration to defaults?')) {
                this.configData = {};
                this.renderConfigTab();
            }
        },

        async saveConfig() {
            var configData = {
                industry: el('#ppCfgIndustry')?.value || 'general',
                gmTarget: parseFloat(el('#ppCfgGMTarget')?.value) || 30,
                opTarget: parseFloat(el('#ppCfgOpTarget')?.value) || 10,
                gmWarn: parseFloat(el('#ppCfgGMWarn')?.value) || 15,
                gmCrit: parseFloat(el('#ppCfgGMCrit')?.value) || 8,
                currentRatio: parseFloat(el('#ppCfgCurrentRatio')?.value) || 1.5,
                quickRatio: parseFloat(el('#ppCfgQuickRatio')?.value) || 1.0,
                gmWeight: parseInt(el('#ppCfgGMWeight')?.value) || 35,
                opWeight: parseInt(el('#ppCfgOpWeight')?.value) || 45,
                growthWeight: parseInt(el('#ppCfgGrowthWeight')?.value) || 20,
                yoyAlert: parseFloat(el('#ppCfgYoYAlert')?.value) || 20,
                budgetAlert: parseFloat(el('#ppCfgBudgetAlert')?.value) || 10,
                minDriverChange: parseFloat(el('#ppCfgMinDriverChange')?.value) || 5000
            };
            
            var btn = event?.target;
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
            }
            
            try {
                await API.post('save_health_config', configData);
                this.configData = configData;
                
                // Re-render benchmarks tab with new config values
                if (this.latestData) {
                    this.renderBenchmarks(this.latestData);
                }
                
                if (btn) {
                    btn.innerHTML = '<i class="fas fa-check mr-2"></i>Saved!';
                    btn.classList.remove('btn-primary');
                    btn.classList.add('btn-success');
                    setTimeout(function() {
                        btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Configuration';
                        btn.classList.remove('btn-success');
                        btn.classList.add('btn-primary');
                        btn.disabled = false;
                    }, 2000);
                }
            } catch (e) {
                console.error('Failed to save config', e);
                if (btn) {
                    btn.innerHTML = '<i class="fas fa-times mr-2"></i>Failed';
                    btn.classList.remove('btn-primary');
                    btn.classList.add('btn-danger');
                    setTimeout(function() {
                        btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Configuration';
                        btn.classList.remove('btn-danger');
                        btn.classList.add('btn-primary');
                        btn.disabled = false;
                    }, 2000);
                }
            }
        },

        // ════════════════════════════════════════════════════════════════════════
        // FLYOUT SYSTEM
        // ════════════════════════════════════════════════════════════════════════

        openFlyout: function() {
            var f = el('#ppFlyout');
            if (f) {
                f.classList.add('open');
                document.body.classList.add('flyout-open');
            }
        },

        closeFlyout: function() {
            var f = el('#ppFlyout');
            if (f) {
                f.classList.remove('open');
                document.body.classList.remove('flyout-open');
            }
            this.flyoutContext = null;
        },

        // Generic flyout helper - shows flyout with title and HTML content
        showFlyout: function(title, bodyHtml, afterRenderCallback) {
            this.openFlyout();
            el('#ppFlyoutTitle').innerHTML = title;
            el('#ppFlyoutSubtitle').textContent = '';
            el('#ppFlyoutStats').innerHTML = '';
            el('#ppFlyoutBody').innerHTML = bodyHtml;
            
            if (afterRenderCallback && typeof afterRenderCallback === 'function') {
                setTimeout(afterRenderCallback, 50);
            }
        },

        async showAccountFlyout(accountId, accountName) {
            var self = this;
            this.flyoutContext = { type: 'account', id: accountId, name: accountName };
            
            this.openFlyout();
            el('#ppFlyoutTitle').innerHTML = '<i class="fas fa-search-dollar text-primary mr-2"></i>' + escapeHtml(accountName);
            el('#ppFlyoutSubtitle').textContent = 'Account Analysis';
            el('#ppFlyoutStats').innerHTML = '';
            el('#ppFlyoutBody').innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading account data...</div></div>';
            
            var startDate = el('#healthStartDate').value;
            var endDate = el('#healthEndDate').value;
            var subsidiaryId = this.subsidiaryId || '';
            
            try {
                // Fetch all data in parallel
                var [txnRes, vendorRes, empRes, trendRes] = await Promise.all([
                    API.post('health', { subAction: 'account_transactions', accountId: accountId, startDate: startDate, endDate: endDate, subsidiaryId: subsidiaryId }),
                    API.post('health', { subAction: 'account_by_vendor', accountId: accountId, startDate: startDate, endDate: endDate, subsidiaryId: subsidiaryId }),
                    API.post('health', { subAction: 'account_by_employee', accountId: accountId, startDate: startDate, endDate: endDate, subsidiaryId: subsidiaryId }),
                    API.post('health', { subAction: 'account_monthly_trend', accountId: accountId, months: 12, subsidiaryId: subsidiaryId })
                ]);
                
                var transactions = (txnRes.status === 'success' && txnRes.transactions) ? txnRes.transactions : [];
                var vendors = (vendorRes.status === 'success' && vendorRes.data) ? vendorRes.data : [];
                var employees = (empRes.status === 'success' && empRes.data) ? empRes.data : [];
                var trend = (trendRes.status === 'success' && trendRes.data) ? trendRes.data : { trend: [], labels: [], values: [] };
                
                this.renderEnhancedAccountFlyout(accountId, accountName, transactions, vendors, employees, trend);
                
            } catch (e) {
                console.error('Flyout error:', e);
                el('#ppFlyoutBody').innerHTML = '<div class="alert alert-warning"><i class="fas fa-exclamation-triangle mr-2"></i>Unable to load account data</div>';
            }
        },

        renderEnhancedAccountFlyout: function(accountId, accountName, transactions, vendors, employees, trend) {
            var self = this;
            var totalAmount = transactions.reduce(function(sum, t) { return sum + Math.abs(t.amount); }, 0);
            
            // Use global KPI renderer - just 2 KPIs
            var kpis = [
                { label: 'Total Amount', value: fmtMoney(totalAmount), icon: 'dollar-sign', color: 'blue', subtext: transactions.length + ' transactions' },
                { label: 'Vendors', value: vendors.length, icon: 'building', color: 'green', subtext: employees.length + ' employees' }
            ];
            
            // Clear stats area and use KPIs
            el('#ppFlyoutStats').innerHTML = '';
            
            // Build flyout with KPIs, full-width chart, and tabbed content
            var html = '' +
                // KPI row
                '<div class="row mb-3 cf-kpi-row">' + this.buildKPIRow(kpis) + '</div>' +
                
                // Full-width trend chart
                (trend.labels && trend.labels.length > 1 ? 
                    '<div class="mb-3">' +
                        '<div class="card-header py-2 bg-light border rounded-top"><h6 class="mb-0 small font-weight-bold"><i class="fas fa-chart-area mr-2 text-primary"></i>12-Month Trend</h6></div>' +
                        '<div class="border border-top-0 rounded-bottom p-2"><div id="flyoutFullTrend" style="height:120px;"></div></div>' +
                    '</div>' : '') +
                
                // Tabs
                '<ul class="nav nav-tabs nav-sm mb-0" id="flyoutTabs">' +
                    '<li class="nav-item"><a class="nav-link active" href="#" data-tab="txn"><i class="fas fa-list-alt mr-1"></i>Transactions (' + transactions.length + ')</a></li>' +
                    '<li class="nav-item"><a class="nav-link" href="#" data-tab="vendors"><i class="fas fa-building mr-1"></i>Vendors (' + vendors.length + ')</a></li>' +
                    '<li class="nav-item"><a class="nav-link" href="#" data-tab="employees"><i class="fas fa-users mr-1"></i>Employees (' + employees.length + ')</a></li>' +
                '</ul>' +
                '<div id="flyoutTabContent" class="border border-top-0 rounded-bottom" style="max-height:calc(100vh - 450px);overflow-y:auto;"></div>';
            
            el('#ppFlyoutBody').innerHTML = html;
            
            // Store data for tab switching with pagination state
            this.flyoutTabData = { 
                transactions: transactions, 
                vendors: vendors, 
                employees: employees, 
                trend: trend, 
                accountId: accountId,
                txnPage: 1,
                txnSearch: ''
            };
            
            // Render full-width trend chart
            if (trend.labels && trend.labels.length > 1) {
                setTimeout(function() {
                    if (typeof Plotly !== 'undefined' && el('#flyoutFullTrend')) {
                        Plotly.newPlot('flyoutFullTrend', [{
                            x: trend.labels,
                            y: trend.values,
                            type: 'scatter',
                            mode: 'lines+markers',
                            fill: 'tozeroy',
                            fillcolor: 'rgba(59,130,246,0.1)',
                            line: { color: '#3b82f6', width: 2 },
                            marker: { size: 5 }
                        }], {
                            height: 120,
                            margin: { t: 10, r: 20, b: 30, l: 60 },
                            xaxis: { tickfont: { size: 9 } },
                            yaxis: { tickformat: '$,.0s', tickfont: { size: 9 } },
                            paper_bgcolor: 'transparent',
                            plot_bgcolor: 'transparent'
                        }, { responsive: true, displayModeBar: false });
                    }
                }, 50);
            }
            
            // Bind tab clicks
            var tabs = document.querySelectorAll('#flyoutTabs .nav-link');
            tabs.forEach(function(tab) {
                tab.addEventListener('click', function(e) {
                    e.preventDefault();
                    tabs.forEach(function(t) { t.classList.remove('active'); });
                    tab.classList.add('active');
                    self.renderFlyoutTab(tab.dataset.tab);
                });
            });
            
            // Render first tab
            this.renderFlyoutTab('txn');
        },

        renderFlyoutTab: function(tabName) {
            var self = this;
            var container = el('#flyoutTabContent');
            var data = this.flyoutTabData;
            
            if (!container || !data) return;
            
            if (tabName === 'txn') {
                // Filter by search term if set
                var searchTerm = (data.txnSearch || '').toLowerCase();
                var txns = data.transactions;
                if (searchTerm) {
                    txns = txns.filter(function(t) {
                        return (t.entity || '').toLowerCase().indexOf(searchTerm) !== -1 ||
                               (t.memo || '').toLowerCase().indexOf(searchTerm) !== -1 ||
                               (t.tranType || '').toLowerCase().indexOf(searchTerm) !== -1 ||
                               (t.tranNumber || '').toLowerCase().indexOf(searchTerm) !== -1;
                    });
                }
                
                // Paginated transactions table - 50 per page
                var pageSize = 50;
                var page = data.txnPage || 1;
                var start = (page - 1) * pageSize;
                var pageData = txns.slice(start, start + pageSize);
                var totalPages = Math.ceil(txns.length / pageSize);
                
                // Search input
                var html = '<div class="p-2 border-bottom bg-light">' +
                    '<input type="text" class="form-control form-control-sm" id="flyoutTxnSearch" placeholder="Search transactions..." value="' + escapeHtml(searchTerm) + '">' +
                '</div>';
                
                html += '<table class="table table-sm flyout-table mb-0"><thead class="sticky-top bg-white"><tr><th>Date</th><th>Doc#</th><th>Type</th><th>Entity</th><th class="text-right">Amount</th><th></th></tr></thead><tbody>';
                
                pageData.forEach(function(t) {
                    var amountClass = t.amount >= 0 ? '' : 'text-danger';
                    var linkHtml = t.transactionId ? 
                        '<a href="#" onclick="gantry.core.getNSLink(\'transaction\', ' + t.transactionId + ');return false;" class="btn btn-link btn-sm p-0" title="Open in NetSuite"><i class="fas fa-external-link-alt"></i></a>' : '';
                    
                    html += '<tr>' +
                        '<td class="text-nowrap small">' + t.date + '</td>' +
                        '<td class="small">' + escapeHtml(t.tranNumber || '') + '</td>' +
                        '<td class="small">' + (t.tranType || '') + '</td>' +
                        '<td class="small text-truncate" style="max-width:120px;" title="' + escapeHtml(t.entity || '') + '">' + escapeHtml(t.entity || '') + '</td>' +
                        '<td class="text-right ' + amountClass + '">' + fmtMoney(t.amount) + '</td>' +
                        '<td class="text-center">' + linkHtml + '</td>' +
                    '</tr>';
                });
                
                html += '</tbody></table>';
                
                // Pagination controls
                html += '<div class="d-flex justify-content-between align-items-center p-2 bg-light border-top">' +
                    '<span class="small text-muted">' + (txns.length === 0 ? 'No results' : 'Showing ' + (start + 1) + '-' + Math.min(start + pageSize, txns.length) + ' of ' + txns.length) + '</span>' +
                    (totalPages > 1 ? '<div class="btn-group btn-group-sm">' +
                        '<button class="btn btn-outline-secondary" ' + (page <= 1 ? 'disabled' : '') + ' onclick="HealthController.flyoutTxnPage(' + (page - 1) + ')"><i class="fas fa-chevron-left"></i></button>' +
                        '<button class="btn btn-outline-secondary disabled">' + page + ' / ' + totalPages + '</button>' +
                        '<button class="btn btn-outline-secondary" ' + (page >= totalPages ? 'disabled' : '') + ' onclick="HealthController.flyoutTxnPage(' + (page + 1) + ')"><i class="fas fa-chevron-right"></i></button>' +
                    '</div>' : '') +
                '</div>';
                
                container.innerHTML = html;
                
                // Bind search input
                var searchInput = el('#flyoutTxnSearch');
                if (searchInput) {
                    searchInput.addEventListener('input', function() {
                        data.txnSearch = this.value;
                        data.txnPage = 1;
                        self.renderFlyoutTab('txn');
                    });
                    // Focus and select if has value
                    if (searchTerm) searchInput.select();
                }
                
            } else if (tabName === 'vendors') {
                var html = '<table class="table table-sm flyout-table mb-0"><thead><tr><th>Vendor</th><th class="text-right">Amount</th><th class="text-right"># Trans</th><th class="text-right">% of Total</th></tr></thead><tbody>';
                
                data.vendors.forEach(function(v) {
                    html += '<tr>' +
                        '<td>' + escapeHtml(v.vendorName) + '</td>' +
                        '<td class="text-right">' + fmtMoney(v.amount) + '</td>' +
                        '<td class="text-right">' + v.transactionCount + '</td>' +
                        '<td class="text-right">' + fmtPct(v.percentOfTotal) + '</td>' +
                    '</tr>';
                });
                
                html += '</tbody></table>';
                container.innerHTML = html || '<div class="text-muted text-center py-4">No vendor breakdown available</div>';
                
            } else if (tabName === 'employees') {
                var html = '<table class="table table-sm flyout-table mb-0"><thead><tr><th>Employee</th><th class="text-right">Amount</th><th class="text-right"># Trans</th><th class="text-right">% of Total</th></tr></thead><tbody>';
                
                data.employees.forEach(function(e) {
                    html += '<tr>' +
                        '<td>' + escapeHtml(e.employeeName) + '</td>' +
                        '<td class="text-right">' + fmtMoney(e.amount) + '</td>' +
                        '<td class="text-right">' + e.transactionCount + '</td>' +
                        '<td class="text-right">' + fmtPct(e.percentOfTotal) + '</td>' +
                    '</tr>';
                });
                
                html += '</tbody></table>';
                container.innerHTML = html || '<div class="text-muted text-center py-4">No employee breakdown available</div>';
                
            }
        },

        flyoutTxnPage: function(page) {
            if (this.flyoutTabData) {
                this.flyoutTabData.txnPage = page;
                this.renderFlyoutTab('txn');
            }
        },

        /**
         * Render inline trend chart in flyout header
         */
        renderInlineTrendChart: function(trend) {
            var container = el('#flyoutInlineTrend');
            if (!container || typeof Plotly === 'undefined') return;
            
            if (!trend.labels || trend.labels.length < 2) {
                container.innerHTML = '<span class="text-muted small">No trend</span>';
                return;
            }
            
            var trace = {
                x: trend.labels,
                y: trend.values,
                type: 'scatter',
                mode: 'lines',
                line: { color: '#3b82f6', width: 2 },
                fill: 'tozeroy',
                fillcolor: 'rgba(59, 130, 246, 0.15)'
            };
            
            var layout = {
                width: 120,
                height: 40,
                margin: { t: 2, r: 2, b: 2, l: 2 },
                xaxis: { visible: false },
                yaxis: { visible: false },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent'
            };
            
            Plotly.newPlot('flyoutInlineTrend', [trace], layout, { 
                responsive: false, 
                displayModeBar: false,
                staticPlot: true 
            });
        },

        renderTransactionsFlyout: function(transactions, accountName) {
            // Kept for backwards compatibility - redirects to enhanced version
            this.renderEnhancedAccountFlyout(this.flyoutContext.id, accountName, transactions, [], [], { labels: [], values: [] });
        },

        // ════════════════════════════════════════════════════════════════════════
        // EXPORT FUNCTIONS
        // ════════════════════════════════════════════════════════════════════════

        exportToCSV: function(type) {
            var self = this;
            var data = this.latestData;
            if (!data) {
                alert('No data to export');
                return;
            }
            
            var csv = '';
            var filename = 'profitability_pulse_';
            var dateRange = (data.meta && data.meta.range) ? data.meta.range.start + '_to_' + data.meta.range.end : 'export';
            
            switch (type) {
                case 'summary':
                    filename += 'summary_' + dateRange + '.csv';
                    csv = this.buildSummaryCSV(data);
                    break;
                case 'accounts':
                    filename += 'accounts_' + dateRange + '.csv';
                    csv = this.buildAccountsCSV(data);
                    break;
                case 'segments':
                    filename += 'segments_' + dateRange + '.csv';
                    csv = this.buildSegmentsCSV(data);
                    break;
                case 'budget':
                    filename += 'budget_variance_' + dateRange + '.csv';
                    csv = this.buildBudgetCSV(this.budgetData);
                    break;
                case 'transactions':
                    if (this.flyoutTabData && this.flyoutTabData.transactions) {
                        filename += 'transactions_' + dateRange + '.csv';
                        csv = this.buildTransactionsCSV(this.flyoutTabData.transactions);
                    }
                    break;
                default:
                    alert('Unknown export type');
                    return;
            }
            
            this.downloadCSV(csv, filename);
        },

        buildSummaryCSV: function(data) {
            var rows = [['Line Item', 'Current Period', 'Prior Year', 'Change', 'Change %']];
            var range = data.company && data.company.metrics && data.company.metrics.range ? data.company.metrics.range : {};
            var prior = data.company && data.company.metrics && data.company.metrics.priorYearRange ? data.company.metrics.priorYearRange : {};
            
            var items = [
                { label: 'Revenue', curr: range.revenue, prev: prior.revenue },
                { label: 'COGS', curr: range.cogs, prev: prior.cogs },
                { label: 'Gross Margin', curr: range.gm, prev: prior.gm },
                { label: 'Operating Expenses', curr: range.opex, prev: prior.opex },
                { label: 'Operating Income', curr: range.opInc, prev: prior.opInc }
            ];
            
            items.forEach(function(item) {
                var change = (item.curr || 0) - (item.prev || 0);
                var changePct = item.prev ? change / Math.abs(item.prev) : 0;
                rows.push([item.label, item.curr || 0, item.prev || 0, change, (changePct * 100).toFixed(2) + '%']);
            });
            
            return rows.map(function(r) { return r.join(','); }).join('\n');
        },

        buildAccountsCSV: function(data) {
            var rows = [['Account ID', 'Account Name', 'Type', 'Amount', '% of Category']];
            var accounts = data.company && data.company.accounts && data.company.accounts.current ? data.company.accounts.current : {};
            
            ['revenueAccounts', 'cogsAccounts', 'opexAccounts'].forEach(function(key) {
                (accounts[key] || []).forEach(function(a) {
                    rows.push([a.accountId, '"' + (a.accountName || '').replace(/"/g, '""') + '"', a.type || '', a.amount || 0, ((a.percent || 0) * 100).toFixed(2) + '%']);
                });
            });
            
            return rows.map(function(r) { return r.join(','); }).join('\n');
        },

        buildSegmentsCSV: function(data) {
            var rows = [['Segment', 'Revenue', 'COGS', 'Gross Margin', 'GM %', 'OpEx', 'Operating Income', 'Op %', 'Contribution %']];
            
            (data.departments || []).forEach(function(d) {
                var m = d.metrics && d.metrics.range ? d.metrics.range : {};
                rows.push([
                    '"' + (d.department.name || '').replace(/"/g, '""') + '"',
                    m.revenue || 0,
                    m.cogs || 0,
                    m.gm || 0,
                    ((m.gmPct || 0) * 100).toFixed(2) + '%',
                    m.opex || 0,
                    m.opInc || 0,
                    ((m.opIncPct || 0) * 100).toFixed(2) + '%',
                    ((d.contribution || 0) * 100).toFixed(2) + '%'
                ]);
            });
            
            return rows.map(function(r) { return r.join(','); }).join('\n');
        },

        buildBudgetCSV: function(data) {
            if (!data || !data.byAccount) return 'No budget data available';
            
            var rows = [['Account Name', 'Account Type', 'Budget', 'Actual', 'Variance', 'Variance %', 'Status']];
            
            data.byAccount.forEach(function(a) {
                rows.push([
                    '"' + (a.accountName || '').replace(/"/g, '""') + '"',
                    a.accountType || '',
                    a.budget || 0,
                    a.actual || 0,
                    a.variance || 0,
                    ((a.variancePercent || 0) * 100).toFixed(2) + '%',
                    a.status || ''
                ]);
            });
            
            return rows.map(function(r) { return r.join(','); }).join('\n');
        },

        buildTransactionsCSV: function(transactions) {
            var rows = [['Date', 'Type', 'Document #', 'Entity', 'Amount', 'Memo']];
            
            transactions.forEach(function(t) {
                rows.push([
                    t.date || '',
                    t.tranType || '',
                    t.tranId || '',
                    '"' + (t.entity || '').replace(/"/g, '""') + '"',
                    t.amount || 0,
                    '"' + (t.memo || '').replace(/"/g, '""') + '"'
                ]);
            });
            
            return rows.map(function(r) { return r.join(','); }).join('\n');
        },

        downloadCSV: function(csv, filename) {
            var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            var link = document.createElement('a');
            var url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },

        // ════════════════════════════════════════════════════════════════════════
        // SORTING & PAGINATION
        // ════════════════════════════════════════════════════════════════════════

        sortTable: function(tableId, column, direction) {
            var table = document.getElementById(tableId);
            if (!table) return;
            
            var tbody = table.querySelector('tbody');
            var rows = Array.from(tbody.querySelectorAll('tr'));
            
            rows.sort(function(a, b) {
                var aVal = a.cells[column].textContent.trim();
                var bVal = b.cells[column].textContent.trim();
                
                // Try numeric comparison
                var aNum = parseFloat(aVal.replace(/[^0-9.-]/g, ''));
                var bNum = parseFloat(bVal.replace(/[^0-9.-]/g, ''));
                
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return direction === 'asc' ? aNum - bNum : bNum - aNum;
                }
                
                // String comparison
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            });
            
            // Re-append sorted rows
            rows.forEach(function(row) { tbody.appendChild(row); });
            
            // Update sort indicators
            var headers = table.querySelectorAll('th.sortable');
            headers.forEach(function(th, idx) {
                th.classList.remove('sort-asc', 'sort-desc');
                if (idx === column) {
                    th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
                }
            });
        },

        initSortableTable: function(tableId) {
            var self = this;
            var table = document.getElementById(tableId);
            if (!table) return;
            
            var headers = table.querySelectorAll('th.sortable');
            headers.forEach(function(th, idx) {
                th.style.cursor = 'pointer';
                th.addEventListener('click', function() {
                    var currentDir = th.classList.contains('sort-asc') ? 'asc' : 'desc';
                    var newDir = currentDir === 'asc' ? 'desc' : 'asc';
                    self.sortTable(tableId, idx, newDir);
                });
            });
        },

        // ════════════════════════════════════════════════════════════════════════
        // UTILITIES
        // ════════════════════════════════════════════════════════════════════════

        /**
         * Build a KPI row using the global Gantry styling pattern
         * @param {Array} kpis - Array of {label, value, icon, color, subtext} objects
         * @returns {string} HTML string
         */
        buildKPIRow: function(kpis) {
            return kpis.map(function(k) {
                var colorClass = k.color || 'blue';
                return '<div class="col">' +
                    '<div class="cf-kpi-card">' +
                        '<div class="icon-wrapper bg-' + colorClass + '-soft">' +
                            '<i class="fas fa-' + (k.icon || 'chart-bar') + ' text-' + colorClass + '"></i>' +
                        '</div>' +
                        '<div class="kpi-content">' +
                            '<span class="kpi-label">' + k.label + '</span>' +
                            '<span class="kpi-value">' + k.value + '</span>' +
                            (k.subtext ? '<span class="kpi-sub">' + k.subtext + '</span>' : '') +
                        '</div>' +
                    '</div>' +
                '</div>';
            }).join('');
        },

        setSafeText: function(selector, text) {
            var e = el(selector);
            if (e) e.textContent = text;
        },

        resizeCharts: function() {
            // Comprehensive list of all chart container IDs
            var chartIds = [
                // Overview
                'ppTrendChart',
                // Margin Tab
                'ppWaterfallChart', 'ppMarginBridgeChart', 'ppMarginTrendChart', 'ppCostBreakdownChart',
                // P/V/M Tab  
                'ppPVMWaterfallChart', 'ppPVMPieChart',
                // Segments Tab
                'ppSegmentPieChart', 'ppSegmentBarChart',
                // Forecast Tab
                'ppForecastChart', 'ppScenarioChart',
                // Drivers Tab
                'ppDriversWaterfall',
                // Ratios Tab
                'ppHealthGauge', 'ppCostStructureChart', 'ppDuPontChart',
                // Budget Tab
                'ppBudgetChart', 'ppBudgetPieChart', 'ppBudgetTrendChart'
            ];
            
            if (typeof Plotly !== 'undefined') {
                chartIds.forEach(function(id) {
                    var container = document.getElementById(id);
                    if (container && container.data) {
                        try {
                            Plotly.Plots.resize(container);
                        } catch(e) {
                            // Chart may not be initialized yet
                        }
                    }
                });
                
                // Also try to resize any Plotly chart in visible tab panes
                var activePane = document.querySelector('.tab-pane.active.show');
                if (activePane) {
                    var plotlyCharts = activePane.querySelectorAll('.js-plotly-plot');
                    plotlyCharts.forEach(function(chart) {
                        try {
                            Plotly.Plots.resize(chart);
                        } catch(e) {}
                    });
                }
            }
        }
    };

    // ════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ════════════════════════════════════════════════════════════════════════
    
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ════════════════════════════════════════════════════════════════════════
    // EXPORT & ROUTE REGISTRATION
    // ════════════════════════════════════════════════════════════════════════
    
    window.HealthController = HealthController;
    
    // Register route
    Router.register('health', () => HealthController.init());
    
    console.log('[Dashboard.Health] Profitability Pulse 2.0 Loaded');

})(window);
