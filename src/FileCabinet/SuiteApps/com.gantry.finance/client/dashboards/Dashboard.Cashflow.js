/**
 * Dashboard.Cashflow.js
 * Cashflow Dashboard Controller + Config Controller
 * 
 * World-class version with flyout system, lazy loading, and entity drilldowns
 */
(function(window) {
    'use strict';

    const CashflowController = {
        rawData: null,
        detailPage: 1,
        detailPageSize: 25,
        currentDetailCatData: null,
        viewMode: 'categories', // 'categories' or 'groups'
        subsidiaryId: null,
        subsidiaries: [],

        // Category Analysis state
        categoryAnalysis: {
            search: '',
            sortCol: 'date',
            sortDir: 'desc',
            pageSize: 25,
            currentCategory: null
        },

        // Flyout state
        flyout: {
            open: false,
            type: null, // 'week', 'entity', 'bucket'
            context: null,
            data: null,
            arData: [],
            apData: [],
            activeTab: 'ar',
            search: '',
            groupBy: 'none',
            sortCol: 'amount',
            sortDir: 'desc',
            page: 1,
            pageSize: 25
        },

        getTemplate() {
            return `
        <div class="cf-dashboard p-0">
            <div class="row mb-3">
                <div class="col-md-12">
                    <form class="form-inline justify-content-center" id="cfControlsForm" onsubmit="return false;">
                        <select class="form-control form-control-sm mr-3" id="cfSubsidiary" style="max-width: 200px;"></select>
                        <label class="mr-2 small text-muted">Horizon:</label>
                        <select class="form-control form-control-sm mr-3" id="cfHorizonWeeks" style="width: auto;">
                            <option value="4" selected>4 Weeks</option>
                            <option value="8">8 Weeks</option>
                            <option value="12">12 Weeks</option>
                        </select>
                        <label class="mr-2 small text-muted">View:</label>
                        <select class="form-control form-control-sm mr-3" id="cfViewMode" style="width: auto;">
                            <option value="categories" selected>Categories</option>
                            <option value="groups">Groups</option>
                        </select>
                        <button type="button" class="btn btn-primary btn-sm mr-3" id="cfApplyBtn">
                            <span class="btn-text">Apply</span>
                            <span class="btn-loading d-none"><i class="fas fa-spinner fa-spin"></i> Loading...</span>
                        </button>
                        <span class="small text-muted" id="CF_RangeLabel"></span>
                        <span class="ml-2 text-success small">●</span><span class="small text-muted ml-1">Live</span>
                    </form>
                </div>
            </div>
            <div class="row mb-2 gutters-sm cf-kpi-row">
                <div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-gray-soft"><i class="fas fa-university text-muted"></i></div><div class="kpi-content"><span class="kpi-label">Current Cash</span><span class="kpi-value" id="CF_StartingCash">$0</span></div></div></div>
                <div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-blue-soft"><i class="fas fa-wallet text-blue"></i></div><div class="kpi-content"><span class="kpi-label">Projected End</span><span class="kpi-value" id="CF_ProjectedEndCash">$0</span><span class="kpi-sub" id="CF_NetChange">$0 Net</span></div></div></div>
                <div class="col"><div class="cf-kpi-card" id="cfLowestCashCard"><div class="icon-wrapper bg-amber-soft"><i class="fas fa-exclamation-triangle text-amber"></i></div><div class="kpi-content"><span class="kpi-label">Lowest Point</span><span class="kpi-value" id="CF_LowestCash">$0</span><span class="kpi-sub text-muted" id="CF_LowestCashDate">--</span></div></div></div>
                <div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-green-soft"><i class="fas fa-arrow-down text-green"></i></div><div class="kpi-content"><span class="kpi-label" id="CF_InflowsLabel">Forecast Inflows</span><span class="kpi-value text-green" id="CF_TotalInflows">$0</span></div></div></div>
                <div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-red-soft"><i class="fas fa-arrow-up text-red"></i></div><div class="kpi-content"><span class="kpi-label" id="CF_OutflowsLabel">Forecast Outflows</span><span class="kpi-value text-red" id="CF_TotalOutflows">$0</span></div></div></div>
            </div>
            <div class="card cf-main-card shadow-sm">
                <div class="card-header border-0 bg-white pt-3 pb-1 px-3">
                    <ul class="nav nav-tabs cf-tabs" id="cfMainTabs" role="tablist">
                        <li class="nav-item"><a class="nav-link active" data-toggle="tab" href="#cf-summary-pane"><i class="fas fa-home mr-2"></i>Overview</a></li>
                        <li class="nav-item"><a class="nav-link" data-toggle="tab" href="#cf-weekly-pane"><i class="fas fa-calendar-week mr-2"></i>Weekly Timeline</a></li>
                        <li class="nav-item"><a class="nav-link" data-toggle="tab" href="#cf-details-pane"><i class="fas fa-list-ul mr-2"></i>Category Analysis</a></li>
                        <li class="nav-item"><a class="nav-link" data-toggle="tab" href="#cf-config-pane"><i class="fas fa-sliders-h mr-2"></i>Configuration</a></li>
                    </ul>
                </div>
                <div class="card-body p-0">
                    <div class="tab-content">
                        <div class="tab-pane fade show active" id="cf-summary-pane">
                            <div class="p-4">
                                <!-- Cash Flow Vitals - Premium KPI Display -->
                                <div class="cf-vitals-hero mb-4">
                                    <div class="cf-vitals-grid">
                                        <!-- Burn Rate Card -->
                                        <div class="cf-vital-card cf-vital-burn">
                                            <div class="cf-vital-header">
                                                <div class="cf-vital-icon-ring bg-purple-gradient">
                                                    <i class="fas fa-fire"></i>
                                                </div>
                                                <div class="cf-vital-badge">Weekly</div>
                                            </div>
                                            <div class="cf-vital-body">
                                                <span class="cf-vital-label">Cash Burn Rate</span>
                                                <span class="cf-vital-value" id="cfVitalBurn">$0</span>
                                                <span class="cf-vital-hint">Average weekly outflow</span>
                                            </div>
                                        </div>

                                        <!-- AR Coverage Card -->
                                        <div class="cf-vital-card cf-vital-coverage">
                                            <div class="cf-vital-header">
                                                <div class="cf-vital-icon-ring bg-blue-gradient">
                                                    <i class="fas fa-shield-alt"></i>
                                                </div>
                                            </div>
                                            <div class="cf-vital-body">
                                                <span class="cf-vital-label">AR Coverage</span>
                                                <span class="cf-vital-value" id="cfVitalLiquid">-</span>
                                                <span class="cf-vital-hint">Receivables / Outflows</span>
                                            </div>
                                        </div>

                                        <!-- Cash Cycle Metrics -->
                                        <div class="cf-vital-card cf-vital-cycle">
                                            <div class="cf-vital-header">
                                                <div class="cf-vital-icon-ring bg-teal-gradient">
                                                    <i class="fas fa-sync-alt"></i>
                                                </div>
                                            </div>
                                            <div class="cf-vital-body">
                                                <span class="cf-vital-label">Cash Cycle</span>
                                                <div class="cf-vital-inline">
                                                    <span class="text-green" id="cfVitalDso">-</span>
                                                    <span class="cf-vital-sep">/</span>
                                                    <span class="text-amber" id="cfVitalDpo">-</span>
                                                </div>
                                                <span class="cf-vital-hint">DSO / DPO</span>
                                            </div>
                                        </div>

                                        <!-- Net Flow Card -->
                                        <div class="cf-vital-card cf-vital-flow">
                                            <div class="cf-vital-header">
                                                <div class="cf-vital-icon-ring bg-gray-gradient" id="cfNetFlowIcon">
                                                    <i class="fas fa-exchange-alt" id="cfNetFlowIconI"></i>
                                                </div>
                                            </div>
                                            <div class="cf-vital-body">
                                                <span class="cf-vital-label">Net Period Flow</span>
                                                <span class="cf-vital-value" id="cfVitalNetFlow">$0</span>
                                                <span class="cf-vital-hint">Inflows − Outflows</span>
                                            </div>
                                        </div>

                                        <!-- Runway Card - Compact -->
                                        <div class="cf-vital-card cf-vital-runway">
                                            <div class="cf-vital-header">
                                                <div class="cf-vital-icon-ring bg-indigo-gradient">
                                                    <i class="fas fa-road"></i>
                                                </div>
                                            </div>
                                            <div class="cf-vital-body">
                                                <span class="cf-vital-label">Cash Runway</span>
                                                <span class="cf-vital-value" id="cfRunwayWeeks">-</span>
                                                <span class="cf-vital-hint" id="cfRunwayStatus">Calculating...</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <!-- Hidden runway bar for JS compatibility -->
                                <div id="cfRunwayBar" style="display:none;"></div>

                                <!-- Bridge and Chart Row -->
                                <div class="row mb-3">
                                    <div class="col-lg-5">
                                        <div class="cf-panel-card h-100">
                                            <h6 class="cf-panel-header"><i class="fas fa-project-diagram mr-2"></i>Cash Flow Bridge</h6>
                                            <div class="cf-bridge-container" id="cfCashBridge"></div>
                                        </div>
                                    </div>
                                    <div class="col-lg-7">
                                        <div class="cf-panel-card h-100">
                                            <h6 class="cf-panel-header"><i class="fas fa-chart-area mr-2"></i>Cash Position Forecast</h6>
                                            <div id="cfCashChart" class="chart-container-sm"></div>
                                        </div>
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col-lg-6 mb-3">
                                        <div class="card shadow-sm h-100">
                                            <div class="card-header bg-white d-flex justify-content-between align-items-center" id="cfArHeader">
                                                <h5 class="cf-section-header text-primary mb-0">Accounts Receivable</h5>
                                                <div class="d-flex align-items-center" id="cfArMetrics"></div>
                                            </div>
                                            <div class="card-body"><div id="cfArBucketsBodySummary"></div></div>
                                        </div>
                                    </div>
                                    <div class="col-lg-6 mb-3">
                                        <div class="card shadow-sm h-100">
                                            <div class="card-header bg-white d-flex justify-content-between align-items-center" id="cfApHeader">
                                                <h5 class="cf-section-header text-danger mb-0">Accounts Payable</h5>
                                                <div class="d-flex align-items-center" id="cfApMetrics"></div>
                                            </div>
                                            <div class="card-body"><div id="cfApBucketsBodySummary"></div></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="tab-pane fade" id="cf-weekly-pane">
                            <div class="row no-gutters h-100">
                                <div class="col-12">
                                    <div class="cf-panel-header"><div class="font-weight-bold text-dark">Forecast Model <small class="text-muted ml-2">(Click any row for details)</small></div></div>
                                    <div class="table-responsive cf-table-wrapper">
                                        <table class="table table-hover mb-0 cf-data-table">
                                            <thead class="bg-light"><tr id="cfWeeklyHeader"></tr></thead>
                                            <tbody id="cfWeeklyBody"></tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="tab-pane fade" id="cf-details-pane">
                            <div class="p-4">
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <select class="form-control form-control-sm custom-select shadow-sm" id="cfDetailCatSelect" style="max-width:300px;"></select>
                                    <h3 class="m-0 font-weight-bold text-dark" id="cfDetailTotal">$0</h3>
                                </div>
                                <div id="cfDetailLogic" class="mb-3"></div>
                                <div class="card border shadow-sm">
                                    <div class="table-responsive">
                                        <table class="table table-hover mb-0 cf-data-table" id="cfDetailTable">
                                            <thead class="bg-light"><tr><th>Entity / Description</th><th>Date</th><th class="text-right">Amount</th><th>Type</th></tr></thead>
                                            <tbody></tbody>
                                        </table>
                                    </div>
                                    <div class="card-footer bg-white d-flex justify-content-between align-items-center">
                                        <button class="btn btn-sm btn-light border" id="btnDetailPrev"><i class="fas fa-arrow-left"></i></button>
                                        <span class="small font-weight-bold text-muted" id="detailPageLabel">Page 1</span>
                                        <button class="btn btn-sm btn-light border" id="btnDetailNext"><i class="fas fa-arrow-right"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="tab-pane fade" id="cf-config-pane">
                            <div class="row no-gutters" style="min-height: 600px;">
                                <div class="col-md-3 border-right cf-config-sidebar">
                                    <div class="list-group list-group-flush cf-config-list" id="cfConfigList"></div>
                                </div>
                                <div class="col-md-9 cf-config-main">
                                    <div class="p-5" id="cfConfigContainer">
                                        <div id="cfConfigEmpty" class="text-center text-muted py-5">
                                            <div class="mb-3 icon-box bg-light text-muted mx-auto"><i class="fas fa-cog"></i></div>
                                            <h6>Select an item to configure</h6>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Flyout Overlay -->
            <div id="cfFlyoutOverlay" class="cf-flyout-overlay" onclick="CashflowController.closeFlyout()"></div>

            <!-- Flyout Panel -->
            <div id="cfFlyoutPanel" class="cf-flyout-panel">
                <div class="cf-flyout-header">
                    <span id="cfFlyoutTitle"><i class="fas fa-calendar-week mr-2"></i>Week Detail</span>
                    <button class="btn-close" onclick="CashflowController.closeFlyout()"><i class="fas fa-times"></i></button>
                </div>
                <div class="cf-flyout-summary" id="cfFlyoutSummary"></div>
                <div class="cf-flyout-tabs" id="cfFlyoutTabs" style="display:none;">
                    <div class="cf-flyout-tab active" data-tab="ar" onclick="CashflowController.switchFlyoutTab('ar')">
                        <i class="fas fa-arrow-down text-success mr-1"></i>AR Inflows
                    </div>
                    <div class="cf-flyout-tab" data-tab="ap" onclick="CashflowController.switchFlyoutTab('ap')">
                        <i class="fas fa-arrow-up text-danger mr-1"></i>AP Outflows
                    </div>
                </div>
                <div class="cf-flyout-toolbar" id="cfFlyoutToolbar" style="display:none;">
                    <div class="cf-flyout-search">
                        <i class="fas fa-search"></i>
                        <input type="text" id="cfFlyoutSearch" placeholder="Search..." oninput="CashflowController.filterFlyoutTable(this.value)">
                    </div>
                    <div class="toolbar-actions">
                        <button class="btn btn-sm btn-outline-success" onclick="CashflowController.exportFlyoutCSV()">
                            <i class="fas fa-download mr-1"></i>CSV
                        </button>
                    </div>
                </div>
                <div class="cf-flyout-body" id="cfFlyoutBody">
                    <div class="cf-flyout-loading">
                        <i class="fas fa-spinner fa-spin"></i>
                        <div class="loading-text">Loading data...</div>
                    </div>
                </div>
                <div class="cf-flyout-pagination" id="cfFlyoutPagination" style="display:none;">
                    <div class="page-info" id="cfFlyoutPageInfo">Showing 1-25 of 100</div>
                    <div class="page-buttons">
                        <button onclick="CashflowController.flyoutPrevPage()" id="cfFlyoutPrevBtn"><i class="fas fa-chevron-left"></i></button>
                        <button onclick="CashflowController.flyoutNextPage()" id="cfFlyoutNextBtn"><i class="fas fa-chevron-right"></i></button>
                    </div>
                </div>
            </div>

            <!-- Configuration Flyout Panel -->
            <div id="cfConfigFlyoutOverlay" class="cf-flyout-overlay" onclick="ConfigController.closeConfigFlyout()"></div>
            <div id="cfConfigFlyoutPanel" class="cf-flyout-panel">
                <div class="cf-flyout-header">
                    <span id="cfConfigFlyoutTitle"><i class="fas fa-sliders-h mr-2"></i>Edit Category</span>
                    <button class="btn-close" onclick="ConfigController.closeConfigFlyout()"><i class="fas fa-times"></i></button>
                </div>
                <div class="cf-flyout-config-tabs" id="cfConfigFlyoutTabs" style="display:none;">
                    <div class="cf-flyout-config-tab active" data-tab="details" onclick="ConfigController.switchConfigFlyoutTab('details')">Details</div>
                    <div class="cf-flyout-config-tab" data-tab="preview" onclick="ConfigController.switchConfigFlyoutTab('preview')">Preview</div>
                </div>
                <div class="cf-flyout-body" id="cfConfigFlyoutBody" style="overflow-y:auto; flex:1;">
                    <!-- Form content will be rendered here -->
                </div>
                <div class="cf-config-flyout-footer" id="cfConfigFlyoutFooter">
                    <button class="cf-btn cf-btn-danger" id="cfConfigFlyoutDelete" onclick="ConfigController.deleteFromFlyout()">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                    <div>
                        <button class="cf-btn cf-btn-secondary mr-2" onclick="ConfigController.closeConfigFlyout()">Cancel</button>
                        <button class="cf-btn cf-btn-primary" onclick="ConfigController.saveFromFlyout()">
                            <i class="fas fa-save"></i> Save Changes
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
        },

        init() {
            // Load template immediately (it's instant)
            this.setupUI();
            
            // Keyboard escape to close flyout
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.flyout.open) {
                    this.closeFlyout();
                }
            });
        },
        
        setupUI() {
            el('#gantry-view-container').innerHTML = this.getTemplate();
            
            // Show skeleton loaders in data areas while waiting for API
            this.showLoadingState();
            
            const horizonEl = el("#cfHorizonWeeks");
            if (horizonEl) horizonEl.addEventListener("change", () => this.loadData());
            
            const viewModeEl = el("#cfViewMode");
            if (viewModeEl) viewModeEl.addEventListener("change", (e) => {
                this.viewMode = e.target.value;
                this.render();
            });
            
            const subsidiaryEl = el("#cfSubsidiary");
            if (subsidiaryEl) subsidiaryEl.addEventListener("change", (e) => {
                this.subsidiaryId = e.target.value;
                this.loadData();
                ConfigController.init(true); // Reload config for new subsidiary
            });
            
            const prevBtn = el("#btnDetailPrev");
            if (prevBtn) prevBtn.addEventListener("click", () => {
                if (this.detailPage > 1) {
                    this.detailPage--;
                    this.rerenderDetailTable();
                }
            }); 

            const nextBtn = el("#btnDetailNext");
            if (nextBtn) nextBtn.addEventListener("click", () => {
                this.detailPage++;
                this.rerenderDetailTable();
            });

            // Fix Tabs
            if (window.jQuery) {
                $('#cfMainTabs a').on('click', function (e) {
                    e.preventDefault();
                    $(this).tab('show');
                });
            }

            this.loadInitialData();
        },
        
        showLoadingState() {
            // KPI area skeleton - including Coverage and Lowest Cash
            const kpiIds = ['CF_StartingCash', 'CF_ProjectedEndCash', 'CF_TotalInflows', 'CF_TotalOutflows', 'CF_InlineCoverage', 'CF_LowestCash'];
            kpiIds.forEach(id => {
                const el_ = el('#' + id);
                if (el_) el_.innerHTML = Skeleton.render('custom', { width: '80px', height: '1.5rem' });
            });
            
            // Label
            const labelEl = el("#CF_RangeLabel");
            if (labelEl) labelEl.innerHTML = Skeleton.render('custom', { width: '200px', height: '1rem' });
            
            // Tables
            const summaryBody = el("#cfSummaryBody");
            if (summaryBody) summaryBody.innerHTML = this.renderTableSkeletonRows(5, 4);
            
            const detailBody = el("#cfDetailBody");
            if (detailBody) detailBody.innerHTML = this.renderTableSkeletonRows(8, 6);
            
            // Runway bar
            const runwayEl = el("#cfRunwayBar");
            if (runwayEl) runwayEl.innerHTML = Skeleton.render('custom', { width: '100%', height: '100%' });
            
            // Chart
            const chartEl = el("#cfCashChart");
            if (chartEl) chartEl.innerHTML = Skeleton.render('chart', { height: '100%' });
            
            // Cash Bridge
            const bridgeEl = el("#cfCashBridge");
            if (bridgeEl) bridgeEl.innerHTML = Skeleton.render('custom', { width: '100%', height: '100%' });
            
            // AR/AP Aging Sections on Overview
            const arBody = el("#cfArBucketsBodySummary");
            if (arBody) arBody.innerHTML = this.renderAgingSkeletonRows();
            
            const apBody = el("#cfApBucketsBodySummary");
            if (apBody) apBody.innerHTML = this.renderAgingSkeletonRows();
        },
        
        renderAgingSkeletonRows() {
            const buckets = ['Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days'];
            let html = '';
            buckets.forEach(() => {
                html += `
                    <div class="cf-bucket-row" style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9;">
                        <div style="flex:1;">${Skeleton.render('custom', { width: '60px', height: '0.75rem' })}</div>
                        <div style="flex:2; padding:0 12px;">${Skeleton.render('custom', { width: '100%', height: '8px' })}</div>
                        <div style="width:80px; text-align:right;">${Skeleton.render('custom', { width: '60px', height: '0.75rem' })}</div>
                    </div>
                `;
            });
            return html;
        },
        
        renderTableSkeletonRows(rows, cols) {
            let html = '';
            for (let r = 0; r < rows; r++) {
                html += '<tr>';
                for (let c = 0; c < cols; c++) {
                    const w = c === 0 ? '70%' : '50%';
                    html += `<td>${Skeleton.render('custom', { width: w, height: '0.8rem' })}</td>`;
                }
                html += '</tr>';
            }
            return html;
        },

        async loadInitialData() {
            // First load config to get subsidiaries list
            try {
                const configRes = await API.get('config');
                this.subsidiaries = configRes.subsidiaries || [];
                this.populateSubsidiaryDropdown();
                
                // Now load data
                this.loadData();
                
                // Initialize config controller
                ConfigController.initWithData(configRes);
            } catch (e) {
                console.error("Error loading initial data:", e);
                el('#gantry-view-container').innerHTML = ErrorBoundary.renderError(e, {
                    title: 'Failed to Load Cashflow Dashboard',
                    retryAction: "CashflowController.init()"
                });
            }
        },
        
        populateSubsidiaryDropdown() {
            const sel = el("#cfSubsidiary");
            if (!sel) return;
            
            sel.innerHTML = '';
            
            if (this.subsidiaries.length === 0) {
                sel.innerHTML = '<option value="">All Subsidiaries</option>';
                sel.style.display = 'none';
                return;
            }
            
            // Always show dropdown
            sel.style.display = '';
            
            // Add "All Subsidiaries" option
            const allOpt = document.createElement('option');
            allOpt.value = '';
            allOpt.textContent = 'All Subsidiaries';
            sel.appendChild(allOpt);
            
            this.subsidiaries.forEach((sub, i) => {
                const opt = document.createElement('option');
                opt.value = sub.id;
                opt.textContent = sub.name;
                if (sub.id == this.subsidiaryId) {
                    opt.selected = true;
                }
                sel.appendChild(opt);
            });
        },
        
        getConfigName() {
            // Return subsidiary-specific config name if subsidiary selected
            if (this.subsidiaryId && this.subsidiaries.length > 1) {
                return 'cashflow_' + this.subsidiaryId;
            }
            return 'cashflow';
        },

        async loadData() {
            const horizonEl = el("#cfHorizonWeeks");
            const weeks = horizonEl ? horizonEl.value : 4;
            const labelEl = el("#CF_RangeLabel");
            if(labelEl) labelEl.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Updating Forecast...';
            
            try {
                const params = { horizonWeeks: weeks };
                if (this.subsidiaryId) {
                    params.subsidiary = this.subsidiaryId;
                }
                this.rawData = await API.get('cashflow', params);
                this.render();
                // FIX: If config already loaded, force render the sidebar list again 
                // because the DOM container (#cfConfigList) was destroyed/recreated during view swap.
                if (!ConfigController.data) {
                    ConfigController.init(true); 
                } else {
                    ConfigController.renderList();
                }
            } catch (e) {
                console.error(e);
                showToast("Error loading dashboard.");
                if(labelEl) labelEl.textContent = "System Offline";
            }
        },

        render() {
            // Safety Check: If user navigated away (CF_RangeLabel missing), stop rendering
            if (!el("#CF_RangeLabel")) return;
            if (!this.rawData || !this.rawData.meta) return;

            const co = this.rawData.company;
            const meta = this.rawData.meta;
            const runway = this.rawData.runway || {};
            const sparkData = this.rawData.sparklineData || {};

            // Alert user to any category configuration errors
            if (meta.categoryErrors && meta.categoryErrors.length > 0) {
                const errorNames = meta.categoryErrors.map(e => e.categoryName).join(', ');
                showToast(`Warning: ${meta.categoryErrors.length} category error(s) in: ${errorNames}. Check config.`, 'warning');
                console.warn('Category errors:', meta.categoryErrors);
            }

            // Header Stats
            el("#CF_RangeLabel").textContent = `As of ${meta.asOfDate} • ${meta.range.days} Day Outlook`;
            el("#CF_StartingCash").textContent = fmtMoney(co.cash.startingCash);
            el("#CF_ProjectedEndCash").textContent = fmtMoney(co.cash.projectedEnd);
            el("#CF_TotalInflows").textContent = fmtMoney(co.cash.totalInflows);
            el("#CF_TotalOutflows").textContent = fmtMoney(co.cash.totalOutflows);
            
            // Update labels with timeframe
            const weeks = meta.activeConfig.horizonWeeks || 8;
            if (el("#CF_InflowsLabel")) el("#CF_InflowsLabel").textContent = `Forecast Inflows (${weeks}wk)`;
            if (el("#CF_OutflowsLabel")) el("#CF_OutflowsLabel").textContent = `Forecast Outflows (${weeks}wk)`;
            
            // Find and display lowest cash point
            let lowestCash = co.cash.startingCash || 0;
            let lowestWeek = 'Start';
            if (co.weeklyCash && co.weeklyCash.length > 0) {
                co.weeklyCash.forEach(w => {
                    if (w && typeof w.endingCash === 'number' && w.endingCash < lowestCash) {
                        lowestCash = w.endingCash;
                        lowestWeek = w.weekStart || 'Week';
                    }
                });
            }

            // Update Lowest Point KPI - ensure visibility
            const lowestEl = el("#CF_LowestCash");
            const lowestDateEl = el("#CF_LowestCashDate");
            const lowestCard = el("#cfLowestCashCard");

            if (lowestEl) {
                lowestEl.textContent = fmtMoney(lowestCash);
                lowestEl.className = 'kpi-value' + (lowestCash < 0 ? ' text-danger' : '');
                // Ensure element is visible (fix for skeleton replacement)
                lowestEl.style.display = '';
            }
            if (lowestDateEl) {
                lowestDateEl.textContent = lowestWeek || '--';
                lowestDateEl.style.display = '';
            }
            if (lowestCard) {
                // Ensure the card container is visible
                lowestCard.style.display = '';
                lowestCard.parentElement.style.display = '';
                // Highlight card if lowest point is negative
                if (lowestCash < 0) {
                    lowestCard.classList.add('cf-kpi-warning');
                } else {
                    lowestCard.classList.remove('cf-kpi-warning');
                }
            }
            
            const net = el("#CF_NetChange");
            net.textContent = (co.cash.netChange >= 0 ? "+" : "") + fmtMoney(co.cash.netChange);
            net.className = co.cash.netChange >= 0 ? "kpi-sub text-green" : "kpi-sub text-red";

            // Runway Bar (hidden, for compatibility)
            const runwayContainer = el("#cfRunwayBar");
            if (runwayContainer && runway) {
                runwayContainer.innerHTML = RunwayBar.generate(runway, {
                    maxWeeks: Math.max(26, (meta.activeConfig.horizonWeeks || 8) * 2)
                });
            }

            // Compact Runway Display
            const runwayWeeksEl = el("#cfRunwayWeeks");
            const runwayStatusEl = el("#cfRunwayStatus");
            if (runwayWeeksEl && runway) {
                const weeks = runway.weeksRunway || 0;
                const netChange = runway.netWeeklyChange || (runway.avgWeeklyInflow - runway.avgWeeklyBurn);
                const isNegativeCash = (runway.currentCash || 0) < 0;
                const isNetPositive = netChange > 0;

                if (isNegativeCash) {
                    runwayWeeksEl.textContent = "⚠";
                    runwayWeeksEl.style.color = "#ef4444";
                    if (runwayStatusEl) runwayStatusEl.textContent = "Negative Cash";
                } else if (isNetPositive) {
                    runwayWeeksEl.textContent = "∞";
                    runwayWeeksEl.style.color = "#10b981";
                    if (runwayStatusEl) runwayStatusEl.textContent = "Cash Flow Positive";
                } else if (weeks <= 4) {
                    runwayWeeksEl.textContent = weeks.toFixed(0) + "w";
                    runwayWeeksEl.style.color = "#ef4444";
                    if (runwayStatusEl) runwayStatusEl.textContent = "Critical runway";
                } else if (weeks <= 8) {
                    runwayWeeksEl.textContent = weeks.toFixed(0) + "w";
                    runwayWeeksEl.style.color = "#f59e0b";
                    if (runwayStatusEl) runwayStatusEl.textContent = "Limited runway";
                } else {
                    runwayWeeksEl.textContent = weeks.toFixed(0) + "w+";
                    runwayWeeksEl.style.color = "#10b981";
                    if (runwayStatusEl) runwayStatusEl.textContent = "Healthy runway";
                }
            }

            // Vitals
            const coverage = co.cash.totalOutflows > 0 ? co.cash.totalInflows / co.cash.totalOutflows : 0;
            el("#cfVitalBurn").textContent = fmtMoney(co.cash.totalOutflows / (meta.activeConfig.horizonWeeks || 8));
            
            // AR Coverage = (Cash + Outstanding AR) / Outstanding AP
            // Shows how many times current liquid assets cover payables
            const liquidAssets = co.cash.startingCash + co.ar.outstandingTotal;
            const liquidLiab = co.ap.outstandingTotal;
            const arCoverage = liquidLiab > 0 ? liquidAssets / liquidLiab : 0;
            el("#cfVitalLiquid").textContent = arCoverage > 0 ? arCoverage.toFixed(2) + 'x' : "N/A";
            
            el("#cfVitalDso").textContent = (co.ar.avgDaysToPay || "0");
            el("#cfVitalDpo").textContent = (co.ap.avgDaysToPay || "0");

            const netFlow = co.cash.totalInflows - co.cash.totalOutflows;
            const elNetFlow = el("#cfVitalNetFlow");
            const netFlowIcon = el("#cfNetFlowIcon");
            const netFlowIconI = el("#cfNetFlowIconI");
            if (elNetFlow) {
                elNetFlow.textContent = (netFlow >= 0 ? "+" : "") + fmtMoney(netFlow);
                elNetFlow.style.color = netFlow >= 0 ? "#10b981" : "#ef4444";
            }
            if (netFlowIcon) {
                netFlowIcon.className = netFlow >= 0 ? "cf-vital-icon-ring bg-green-gradient" : "cf-vital-icon-ring bg-red-gradient";
            }
            if (netFlowIconI) {
                netFlowIconI.className = netFlow >= 0 ? "fas fa-arrow-up" : "fas fa-arrow-down";
            }

            // Cash Position Chart
            this.renderCashChart();

            // Components
            this.renderCashBridge(co.cash);
            this.renderARProfile(co.ar, "#cfArBucketsBodySummary");
            this.renderAPProfile(co.ap, "#cfApBucketsBodySummary");
            this.renderWeeklyTable(co.weeklyCash, co.dynamicCategories, meta.activeConfig, co.ar.avgDaysToPay, co.ap.avgDaysToPay);
            
            // Week detail is now shown in flyout when row is clicked

            this.populateCategoryDetails(co.dynamicCategories, meta.activeConfig);
        },

        /**
         * Render cash position chart
         */
        renderCashChart() {
            const container = el("#cfCashChart");
            if (!container || !this.rawData) return;
            
            try {
                // Use container's actual height or default
                const height = container.clientHeight || 120;
                ChartManager.cashPositionChart('cfCashChart', {
                    weekly: this.rawData.company.weeklyCash
                }, { height: height });
            } catch (e) {
                console.error('Cash chart error:', e);
            }
        },

        renderCashBridge(cash) {
            const container = el("#cfCashBridge");
            if (!container) return;
            
            const vals = [cash.startingCash, cash.totalInflows, cash.totalOutflows, cash.projectedEnd];
            const maxVal = Math.max(...vals.map(Math.abs)) || 1;
            const getH = (v) => Math.max(5, Math.round((Math.abs(v) / maxVal) * 80));
            
            const mkBar = (lbl, val, color, icon) => `
                <div class="bridge-col">
                    <div class="bridge-val ${val < 0 ? "text-danger" : "text-dark"}">${fmtMoney(val)}</div>
                    <div class="bridge-bar ${color}" style="height:${getH(val)}%"></div>
                    <div class="bridge-lbl"><i class="fas ${icon} mr-1"></i>${lbl}</div>
                </div>`;

            container.innerHTML = `
                ${mkBar("Start", cash.startingCash, "bg-secondary", "fa-university")}
                <div class="bridge-connector"><i class="fas fa-plus-circle text-success opacity-50"></i></div>
                ${mkBar("Collections", cash.totalInflows, "bg-green", "fa-hand-holding-usd")}
                <div class="bridge-connector"><i class="fas fa-minus-circle text-danger opacity-50"></i></div>
                ${mkBar("Payables", cash.totalOutflows, "bg-red", "fa-file-invoice-dollar")}
                <div class="bridge-connector"><i class="fas fa-equals text-muted"></i></div>
                ${mkBar("Forecast", cash.projectedEnd, "bg-blue", "fa-wallet")}
            `;
        },

        renderARProfile(arData, sel) {
            const div = el(sel);
            if (!div) return;

            const buckets = arData.buckets || [];
            const outstanding = arData.outstandingTotal || arData.totalOutstanding || 0;
            const pctCurrent = arData.pctCurrent || 0;
            const dso = arData.avgDaysToPay || arData.avgDaysUsed || 0;

            // Update header - compact style
            const headerEl = el("#cfArHeader");
            if (headerEl) {
                headerEl.innerHTML = `
                    <div class="cf-arap-header">
                        <div class="header-title">
                            <i class="fas fa-arrow-down text-success mr-2"></i>Accounts Receivable
                        </div>
                        <div class="header-metrics">
                            <div class="metric">
                                <span class="metric-label">Outstanding</span>
                                <span class="metric-value" style="color:#3b82f6;">${fmtMoney(outstanding)}</span>
                            </div>
                            <div class="metric">
                                <span class="metric-label">Current</span>
                                <span class="metric-value">${pctCurrent.toFixed(0)}%</span>
                            </div>
                            <div class="metric">
                                <span class="metric-label">DSO</span>
                                <span class="metric-value">${dso}d</span>
                            </div>
                            <a href="/app/reporting/reportrunner.nl?reporttype=REGISTER&accttype=AcctRec" target="_blank" class="btn btn-sm btn-link py-0 px-1" title="Open AR Register">
                                <i class="fas fa-external-link-alt fa-xs"></i>
                            </a>
                        </div>
                    </div>`;
                headerEl.className = '';
            }

            // Render compact buckets
            let html = '';
            const total = outstanding > 0 ? outstanding : 1;

            buckets.forEach((b, idx) => {
                const pct = (b.amount / total) * 100;
                const isOverdue = b.label !== 'Current' && b.amount > 0;
                const hasItems = b.amount > 0;

                let riskClass = '';
                if (b.label.includes('60') || b.label.includes('90+')) {
                    riskClass = 'risk-high';
                } else if (b.label.includes('30') && isOverdue) {
                    riskClass = 'risk-medium';
                }

                html += `
                <div class="cf-bucket-card ${riskClass}"
                     ${hasItems ? `onclick="CashflowController.showBucketFlyout('${b.label}', 'ar')"` : 'style="cursor:default; opacity:0.5;"'}>
                    <div class="bucket-header">
                        <span class="bucket-label">${b.label}</span>
                        <span class="bucket-amount">${fmtMoney(b.amount)}</span>
                    </div>
                    <div class="bucket-bar">
                        <div class="bucket-bar-fill" style="width:${pct.toFixed(1)}%;"></div>
                    </div>
                    <div class="bucket-meta">
                        <span>${pct.toFixed(1)}%</span>
                        ${hasItems ? '<span class="bucket-chevron"><i class="fas fa-chevron-right"></i></span>' : ''}
                    </div>
                </div>`;
            });

            div.innerHTML = html;
        },

        renderAPProfile(apData, sel) {
            const div = el(sel);
            if (!div) return;

            const buckets = apData.buckets || [];
            const outstanding = apData.outstandingTotal || apData.totalOutstanding || 0;
            const pctCurrent = apData.pctCurrent || 0;
            const dpo = apData.avgDaysToPay || apData.avgDaysUsed || 0;

            // Update header - compact style (matching AR)
            const headerEl = el("#cfApHeader");
            if (headerEl) {
                headerEl.innerHTML = `
                    <div class="cf-arap-header">
                        <div class="header-title">
                            <i class="fas fa-arrow-up text-danger mr-2"></i>Accounts Payable
                        </div>
                        <div class="header-metrics">
                            <div class="metric">
                                <span class="metric-label">Outstanding</span>
                                <span class="metric-value" style="color:#ef4444;">${fmtMoney(outstanding)}</span>
                            </div>
                            <div class="metric">
                                <span class="metric-label">Current</span>
                                <span class="metric-value">${pctCurrent.toFixed(0)}%</span>
                            </div>
                            <div class="metric">
                                <span class="metric-label">DPO</span>
                                <span class="metric-value">${dpo}d</span>
                            </div>
                            <a href="/app/reporting/reportrunner.nl?reporttype=REGISTER&accttype=AcctPay" target="_blank" class="btn btn-sm btn-link py-0 px-1" title="Open AP Register">
                                <i class="fas fa-external-link-alt fa-xs"></i>
                            </a>
                        </div>
                    </div>`;
                headerEl.className = '';
            }

            // Render compact buckets (matching AR style)
            let html = '';
            const total = outstanding > 0 ? outstanding : 1;

            buckets.forEach((b, idx) => {
                const pct = (b.amount / total) * 100;
                const isOverdue = b.label !== 'Current' && b.amount > 0;
                const hasItems = b.amount > 0;

                let riskClass = '';
                if (b.label.includes('60') || b.label.includes('90+')) {
                    riskClass = 'risk-high';
                } else if (b.label.includes('30') && isOverdue) {
                    riskClass = 'risk-medium';
                }

                html += `
                <div class="cf-bucket-card ${riskClass}"
                     ${hasItems ? `onclick="CashflowController.showBucketFlyout('${b.label}', 'ap')"` : 'style="cursor:default; opacity:0.5;"'}>
                    <div class="bucket-header">
                        <span class="bucket-label">${b.label}</span>
                        <span class="bucket-amount">${fmtMoney(b.amount)}</span>
                    </div>
                    <div class="bucket-bar">
                        <div class="bucket-bar-fill" style="width:${pct.toFixed(1)}%;"></div>
                    </div>
                    <div class="bucket-meta">
                        <span>${pct.toFixed(1)}%</span>
                        ${hasItems ? '<span class="bucket-chevron"><i class="fas fa-chevron-right"></i></span>' : ''}
                    </div>
                </div>`;
            });

            div.innerHTML = html;
        },

        renderBuckets(buckets, sel) {
            const div = el(sel);
            if (!div) return;
            div.innerHTML = "";
            let maxAmt = 0;
            if (buckets) buckets.forEach((b) => { if (b.amount > maxAmt) maxAmt = b.amount; });
            if (maxAmt === 0) maxAmt = 1;
            
            if (buckets) buckets.forEach((b) => {
                const pct = (b.amount / maxAmt) * 100;
                div.innerHTML += `
                <div class="cf-bucket-row d-flex align-items-center justify-content-between mb-2">
                    <div style="width: 60px;" class="small font-weight-bold text-muted">${b.label}</div>
                    <div class="flex-grow-1 mx-2"><div class="progress" style="height: 6px;"><div class="progress-bar bg-blue-soft" style="width: ${pct}%"></div></div></div>
                    <div class="small font-weight-bold">${fmtMoney(b.amount)}</div>
                </div>`;
            });
        },

        renderWeeklyTable(weeks, cats, config, arDays, apDays) {
            const thead = el("#cfWeeklyHeader");
            const tbody = el("#cfWeeklyBody");
            const tableEl = thead ? thead.closest('table') : null;
            if (!thead || !tbody) return;

            // Apply enhanced table class (keep Bootstrap's table class for base styling)
            if (tableEl) tableEl.className = 'table cf-timeline-table';

            const groups = config.groups || [];
            const isGroupMode = this.viewMode === 'groups' && groups.length > 0;

            // Build enhanced header
            thead.innerHTML = `
                <th>Week</th>
                <th class="text-right">AR Inflow</th>
                <th class="text-right">AP Capacity</th>`;

            if (isGroupMode) {
                groups.forEach(g => {
                    thead.innerHTML += `<th class="text-right">${g.name}</th>`;
                });
            } else {
                const catKeys = Object.keys(cats || {});
                catKeys.forEach(k => {
                    const confCat = config.categories.find(c => c.id === k);
                    thead.innerHTML += `<th class="text-right">${confCat ? confCat.name : k}</th>`;
                });
            }
            thead.innerHTML += `<th class="text-right">Net Change</th><th class="text-right">End Cash</th>`;
            tbody.innerHTML = "";

            const colKeys = isGroupMode ? groups.map(g => g.id) : Object.keys(cats || {});

            if (!weeks.length) {
                tbody.innerHTML = `<tr><td colspan="${5 + colKeys.length}" class="text-center p-4 text-muted">
                    <i class="fas fa-calendar-times mb-2" style="font-size:24px;opacity:0.3;"></i><br>No forecast data available
                </td></tr>`;
                return;
            }

            weeks.forEach((w, idx) => {
                const safeCap = w.safeApCapacity || 0;
                const isOverCap = w.outflows.ap > safeCap;
                const capPct = safeCap > 0 ? Math.min(100, (w.outflows.ap / safeCap) * 100) : (w.outflows.ap > 0 ? 100 : 0);
                const capClass = capPct > 90 ? 'danger' : (capPct > 70 ? 'warning' : 'safe');

                // Week cell with badge
                const weekNum = idx + 1;
                const weekCell = `
                    <div class="week-cell">
                        <span class="week-badge">${weekNum}</span>
                        <span>${w.weekStart}</span>
                    </div>`;

                // AR Inflow cell
                const arCell = `<div class="amount-cell positive">${fmtMoney(w.inflows.ar)}</div>`;

                // AP Capacity cell with mini progress bar
                const apCell = `
                    <div class="ap-capacity-cell">
                        <span class="${isOverCap ? 'text-danger font-weight-bold' : ''}">${fmtMoney(w.outflows.ap)}</span>
                        <div class="capacity-bar">
                            <div class="capacity-fill ${capClass}" style="width:${capPct}%;"></div>
                        </div>
                    </div>`;

                let html = `<td>${weekCell}</td><td>${arCell}</td><td>${apCell}</td>`;

                if (isGroupMode) {
                    groups.forEach(g => {
                        let groupTotal = 0;
                        (g.categoryIds || []).forEach(catId => {
                            if (cats[catId] && cats[catId].weeklyAmounts) {
                                groupTotal += cats[catId].weeklyAmounts[w.weekStart] || 0;
                            }
                        });
                        html += `<td class="category-cell">${groupTotal > 0 ? fmtMoney(groupTotal) : '—'}</td>`;
                    });
                } else {
                    Object.keys(cats || {}).forEach(k => {
                        const val = cats[k].weeklyAmounts ? cats[k].weeklyAmounts[w.weekStart] || 0 : 0;
                        html += `<td class="category-cell">${val > 0 ? fmtMoney(val) : '—'}</td>`;
                    });
                }

                // Net change cell - colored based on value
                const netClass = w.netChange > 0 ? 'positive' : (w.netChange < 0 ? 'negative' : 'neutral');
                html += `<td class="net-cell ${netClass}">${w.netChange >= 0 ? '+' : ''}${fmtMoney(w.netChange)}</td>`;

                // End cash cell - pill style
                const endCashPillClass = w.endingCash >= 0 ? 'positive' : 'negative';
                html += `<td class="end-cash-cell"><span class="end-cash-pill ${endCashPillClass}">${fmtMoney(w.endingCash)}</span></td>`;

                const tr = document.createElement("tr");
                tr.className = w.endingCash < 0 ? 'cf-row-negative' : '';
                tr.innerHTML = html;

                tr.onclick = () => {
                    tbody.querySelectorAll(".cf-row-selected").forEach(r => r.classList.remove("cf-row-selected"));
                    tr.classList.add("cf-row-selected");
                    this.showWeekFlyout(w.weekStart, w, cats);
                };

                tbody.appendChild(tr);
            });
        },

        // showSnapshot REMOVED - all week details are now in the flyout
        // renderList REMOVED - all week details are now in the flyout

        populateCategoryDetails(cats, config) {
            const pane = el("#cf-details-pane");
            if (!pane) return;
            const keys = Object.keys(cats || {});
            if (keys.length === 0) {
                pane.innerHTML = '<div class="cf-empty-state"><i class="fas fa-chart-pie"></i><div class="empty-title">No Categories</div><div class="empty-text">Configure categories to see analysis</div></div>';
                return;
            }

            // Store config for later reference
            this.categoryAnalysis.config = config;
            this.categoryAnalysis.allCategories = cats;

            // Build dynamic tabs - show first N tabs, rest in dropdown
            const maxVisibleTabs = 6;
            const visibleCats = keys.slice(0, maxVisibleTabs);
            const overflowCats = keys.slice(maxVisibleTabs);

            let tabsHtml = '<div class="cf-category-tabs" id="cfCategoryTabs">';
            visibleCats.forEach((k, idx) => {
                const conf = config.categories.find(c => c.id === k);
                const name = conf ? conf.name : k;
                const catData = cats[k];
                const total = catData ? catData.total : 0;
                const isActive = idx === 0 ? 'active' : '';
                tabsHtml += `
                    <div class="cf-category-tab ${isActive}" data-cat-id="${k}" onclick="CashflowController.selectCategoryTab('${k}')">
                        <span>${escapeHtml(name)}</span>
                        <span class="tab-amount">${fmtMoney(total)}</span>
                    </div>`;
            });

            // "More" dropdown for overflow
            if (overflowCats.length > 0) {
                tabsHtml += `
                    <div class="cf-category-more-btn" onclick="CashflowController.toggleCategoryMoreMenu(event)">
                        More (${overflowCats.length}) <i class="fas fa-chevron-down" style="font-size:10px;"></i>
                        <div class="cf-category-more-dropdown" id="cfCategoryMoreDropdown">`;
                overflowCats.forEach(k => {
                    const conf = config.categories.find(c => c.id === k);
                    const name = conf ? conf.name : k;
                    const catData = cats[k];
                    const total = catData ? catData.total : 0;
                    tabsHtml += `
                        <div class="cf-category-more-item" onclick="CashflowController.selectCategoryTab('${k}')">
                            <span>${escapeHtml(name)}</span>
                            <span style="color:#64748b;">${fmtMoney(total)}</span>
                        </div>`;
                });
                tabsHtml += '</div></div>';
            }
            tabsHtml += '</div>';

            // KPI row container and content container
            tabsHtml += '<div id="cfCategoryKpiRow"></div>';
            tabsHtml += '<div id="cfCategoryContent" class="p-4"></div>';

            pane.innerHTML = tabsHtml;

            // Hide the old select dropdown if it exists
            const oldSel = el("#cfDetailCatSelect");
            if (oldSel) oldSel.style.display = 'none';

            this.categoryAnalysis.currentCategory = keys[0];
            this.renderDetailTable(cats[keys[0]]);
        },

        selectCategoryTab(catId) {
            // Close dropdown if open
            const dropdown = el('#cfCategoryMoreDropdown');
            if (dropdown) dropdown.classList.remove('open');

            // Update active tab
            document.querySelectorAll('.cf-category-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.catId === catId);
            });

            this.detailPage = 1;
            this.categoryAnalysis.search = '';
            this.categoryAnalysis.currentCategory = catId;
            this.renderDetailTable(this.categoryAnalysis.allCategories[catId]);
        },

        toggleCategoryMoreMenu(event) {
            event.stopPropagation();
            const dropdown = el('#cfCategoryMoreDropdown');
            if (dropdown) {
                dropdown.classList.toggle('open');
                // Close on outside click
                const closeHandler = (e) => {
                    if (!e.target.closest('.cf-category-more-btn')) {
                        dropdown.classList.remove('open');
                        document.removeEventListener('click', closeHandler);
                    }
                };
                if (dropdown.classList.contains('open')) {
                    setTimeout(() => document.addEventListener('click', closeHandler), 0);
                }
            }
        },

        // Handle category analysis search
        onCategorySearchInput(searchTerm) {
            this.categoryAnalysis.search = searchTerm;
            this.detailPage = 1;
            this.rerenderDetailTable();
        },

        // Handle category analysis sorting
        sortCategoryTable(col) {
            if (this.categoryAnalysis.sortCol === col) {
                this.categoryAnalysis.sortDir = this.categoryAnalysis.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                this.categoryAnalysis.sortCol = col;
                this.categoryAnalysis.sortDir = col === 'amount' ? 'desc' : 'asc';
            }
            this.detailPage = 1;
            this.rerenderDetailTable();
        },

        // Handle page size change
        onCategoryPageSizeChange(size) {
            this.detailPageSize = parseInt(size);
            this.detailPage = 1;
            this.rerenderDetailTable();
        },

        // Jump to specific page
        goToCategoryPage(page) {
            this.detailPage = page;
            this.rerenderDetailTable();
        },

        // Export category data to CSV
        exportCategoryCSV() {
            const catData = this.currentDetailCatData;
            if (!catData || !catData.breakdown || catData.breakdown.length === 0) return;

            const config = this.categoryAnalysis.config || {};
            const catKey = this.categoryAnalysis.currentCategory;
            const catConf = config.categories ? config.categories.find(c => c.id === catKey) : null;
            const catName = catConf ? catConf.name : catKey;

            let csv = `"Category","${catName}"\n`;
            csv += `"Total","${catData.total}"\n\n`;
            csv += '"Entity/Description","Date","Amount","Type"\n';

            catData.breakdown.forEach(row => {
                csv += `"${(row.name || '').replace(/"/g, '""')}","${row.date || ''}","${row.amount}","${row.type || ''}"\n`;
            });

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cashflow_category_${catName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        },

        renderDetailTable(catData) {
            this.currentDetailCatData = catData;
            let detailData = (catData && catData.breakdown) ? [...catData.breakdown] : [];

            // Target containers for dynamic tab layout
            const kpiRow = el("#cfCategoryKpiRow");
            const content = el("#cfCategoryContent");
            if (!kpiRow || !content) return;

            // Get category configuration
            const config = this.categoryAnalysis.config || {};
            const catKey = this.categoryAnalysis.currentCategory;
            const catConf = config.categories ? config.categories.find(c => c.id === catKey) : null;
            const catName = catConf ? catConf.name : catKey;
            const catType = catConf ? catConf.type : 'outflow';
            const catMethod = catData && catData.meta ? catData.meta.method : 'Unknown';

            // Method pill color mapping
            const methodColors = {
                'GL Average': '#3b82f6',
                'Vendor History (Median)': '#8b5cf6',
                'Credit Card Cycle': '#ec4899',
                'Manual Recurring': '#10b981',
                'Vendor Recurring (Auto)': '#f59e0b',
                'Bank Register History': '#06b6d4',
                'Calculated Formula': '#6366f1'
            };
            const methodColor = methodColors[catMethod] || '#64748b';
            const totalColor = catType === 'inflow' ? '#10b981' : '#ef4444';
            const typeClass = catType === 'inflow' ? 'inflow' : 'outflow';

            // Render KPI row header
            const total = catData ? catData.total : 0;
            const itemCount = detailData.length;
            const meta = catData && catData.meta ? catData.meta : {};

            kpiRow.innerHTML = `
                <div class="cf-category-kpi-row">
                    <div class="cf-category-kpi">
                        <div class="kpi-icon" style="background:${catType === 'inflow' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'};">
                            <i class="fas ${catType === 'inflow' ? 'fa-arrow-down' : 'fa-arrow-up'}" style="color:${totalColor};"></i>
                        </div>
                        <div class="kpi-content">
                            <div class="kpi-label">Total Forecast</div>
                            <div class="kpi-value" style="color:${totalColor};">${fmtMoney(total)}</div>
                        </div>
                    </div>
                    <div class="cf-category-kpi">
                        <div class="kpi-icon" style="background:rgba(139,92,246,0.12);">
                            <i class="fas fa-cogs" style="color:#8b5cf6;"></i>
                        </div>
                        <div class="kpi-content">
                            <div class="kpi-label">Method</div>
                            <div class="kpi-value" style="font-size:14px; color:${methodColor};">${catMethod}</div>
                        </div>
                    </div>
                    <div class="cf-category-kpi">
                        <div class="kpi-icon" style="background:rgba(59,130,246,0.12);">
                            <i class="fas fa-list" style="color:#3b82f6;"></i>
                        </div>
                        <div class="kpi-content">
                            <div class="kpi-label">Source Items</div>
                            <div class="kpi-value">${itemCount}</div>
                        </div>
                    </div>
                    <div class="cf-category-kpi" style="flex:0.5;">
                        <button class="cf-btn cf-btn-secondary" onclick="CashflowController.exportCategoryCSV()" style="width:100%;">
                            <i class="fas fa-download"></i> Export
                        </button>
                    </div>
                </div>`;

            // Apply search filter
            const searchTerm = (this.categoryAnalysis.search || '').toLowerCase();
            if (searchTerm) {
                detailData = detailData.filter(row =>
                    (row.name && row.name.toLowerCase().includes(searchTerm)) ||
                    (row.type && row.type.toLowerCase().includes(searchTerm)) ||
                    (row.date && row.date.toLowerCase().includes(searchTerm))
                );
            }

            // Apply sorting
            const sortCol = this.categoryAnalysis.sortCol;
            const sortDir = this.categoryAnalysis.sortDir;
            detailData.sort((a, b) => {
                let valA, valB;
                if (sortCol === 'date') {
                    valA = new Date(a.date || 0).getTime();
                    valB = new Date(b.date || 0).getTime();
                } else if (sortCol === 'amount') {
                    valA = Math.abs(a.amount || 0);
                    valB = Math.abs(b.amount || 0);
                } else if (sortCol === 'name') {
                    valA = (a.name || '').toLowerCase();
                    valB = (b.name || '').toLowerCase();
                } else {
                    valA = (a[sortCol] || '').toString().toLowerCase();
                    valB = (b[sortCol] || '').toString().toLowerCase();
                }
                if (valA < valB) return sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });

            // Pagination
            const totalItems = detailData.length;
            const totalPages = Math.ceil(totalItems / this.detailPageSize) || 1;
            if (this.detailPage > totalPages) this.detailPage = totalPages;
            if (this.detailPage < 1) this.detailPage = 1;

            const startIdx = (this.detailPage - 1) * this.detailPageSize;
            const endIdx = Math.min(startIdx + this.detailPageSize, totalItems);
            const pageData = detailData.slice(startIdx, endIdx);

            // Generate sort indicator
            const sortIndicator = (col) => {
                const isSorted = this.categoryAnalysis.sortCol === col;
                const arrow = this.categoryAnalysis.sortDir === 'asc' ? '▲' : '▼';
                return `<span class="sort-indicator">${isSorted ? arrow : '↕'}</span>`;
            };

            // Build the enhanced HTML - search bar + table
            let html = `
                <!-- Search & Filter Bar -->
                <div class="cf-search-bar">
                    <div class="cf-search-input">
                        <i class="fas fa-search"></i>
                        <input type="text" placeholder="Search transactions..." value="${escapeHtml(searchTerm)}"
                            oninput="CashflowController.onCategorySearchInput(this.value)">
                    </div>
                </div>

                <!-- Enhanced Table -->
                <div class="card border shadow-sm" style="border-radius: var(--cf-radius-lg); overflow: hidden;">
                    <div class="table-responsive">
                        <table class="cf-table-enhanced" id="cfDetailTableEnhanced">
                            <thead>
                                <tr>
                                    <th class="${sortCol === 'name' ? 'sorted' : ''}" onclick="CashflowController.sortCategoryTable('name')">
                                        Entity / Description ${sortIndicator('name')}
                                    </th>
                                    <th class="${sortCol === 'date' ? 'sorted' : ''}" onclick="CashflowController.sortCategoryTable('date')">
                                        Date ${sortIndicator('date')}
                                    </th>
                                    <th class="${sortCol === 'amount' ? 'sorted' : ''}" style="text-align:right;" onclick="CashflowController.sortCategoryTable('amount')">
                                        Amount ${sortIndicator('amount')}
                                    </th>
                                    <th class="${sortCol === 'type' ? 'sorted' : ''}" style="text-align:center;" onclick="CashflowController.sortCategoryTable('type')">
                                        Type ${sortIndicator('type')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>`;

            if (pageData.length === 0) {
                html += `<tr><td colspan="4" class="text-center py-5">
                    <div class="cf-empty-state">
                        <i class="fas fa-search"></i>
                        <div class="empty-title">${searchTerm ? 'No matching transactions' : 'No source data found'}</div>
                        <div class="empty-text">${searchTerm ? 'Try adjusting your search criteria' : 'This category has no transaction data'}</div>
                    </div>
                </td></tr>`;
            } else {
                pageData.forEach(row => {
                    const dateDisplay = row.date || "—";
                    const typeDisplay = row.type || (row.amount < 0 ? 'Credit' : 'Debit');
                    const amountColor = row.amount < 0 ? '#ef4444' : (catType === 'inflow' ? '#10b981' : '#1e293b');

                    // Deep link if internalId is available
                    const nameDisplay = row.internalId
                        ? getNsLink(escapeHtml(row.name), row.internalId)
                        : `<span>${escapeHtml(row.name)}</span>`;

                    html += `
                        <tr>
                            <td>${nameDisplay}</td>
                            <td style="color:#64748b;">${dateDisplay}</td>
                            <td style="text-align:right; font-weight:600; color:${amountColor};">${fmtMoney(row.amount)}</td>
                            <td style="text-align:center;"><span class="badge badge-light border">${typeDisplay}</span></td>
                        </tr>`;
                });
            }

            html += `</tbody></table></div>`;

            // Enhanced Pagination
            if (totalItems > 0) {
                let pageButtons = '';
                const maxVisiblePages = 5;
                let startPage = Math.max(1, this.detailPage - Math.floor(maxVisiblePages / 2));
                let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
                if (endPage - startPage + 1 < maxVisiblePages) {
                    startPage = Math.max(1, endPage - maxVisiblePages + 1);
                }

                // Previous button
                pageButtons += `<button class="page-btn" ${this.detailPage <= 1 ? 'disabled' : ''} onclick="CashflowController.goToCategoryPage(${this.detailPage - 1})"><i class="fas fa-chevron-left"></i></button>`;

                // First page + ellipsis
                if (startPage > 1) {
                    pageButtons += `<button class="page-btn" onclick="CashflowController.goToCategoryPage(1)">1</button>`;
                    if (startPage > 2) pageButtons += `<span style="padding: 0 8px; color: #94a3b8;">...</span>`;
                }

                // Page numbers
                for (let p = startPage; p <= endPage; p++) {
                    pageButtons += `<button class="page-btn ${p === this.detailPage ? 'active' : ''}" onclick="CashflowController.goToCategoryPage(${p})">${p}</button>`;
                }

                // Last page + ellipsis
                if (endPage < totalPages) {
                    if (endPage < totalPages - 1) pageButtons += `<span style="padding: 0 8px; color: #94a3b8;">...</span>`;
                    pageButtons += `<button class="page-btn" onclick="CashflowController.goToCategoryPage(${totalPages})">${totalPages}</button>`;
                }

                // Next button
                pageButtons += `<button class="page-btn" ${this.detailPage >= totalPages ? 'disabled' : ''} onclick="CashflowController.goToCategoryPage(${this.detailPage + 1})"><i class="fas fa-chevron-right"></i></button>`;

                html += `
                    <div class="cf-pagination-full">
                        <div class="page-info">Showing ${startIdx + 1}-${endIdx} of ${totalItems} items</div>
                        <div class="page-controls">
                            ${pageButtons}
                            <select class="page-size-select" onchange="CashflowController.onCategoryPageSizeChange(this.value)">
                                <option value="10" ${this.detailPageSize === 10 ? 'selected' : ''}>10 / page</option>
                                <option value="25" ${this.detailPageSize === 25 ? 'selected' : ''}>25 / page</option>
                                <option value="50" ${this.detailPageSize === 50 ? 'selected' : ''}>50 / page</option>
                                <option value="100" ${this.detailPageSize === 100 ? 'selected' : ''}>100 / page</option>
                            </select>
                        </div>
                    </div>`;
            }

            html += `</div>`;

            // Add forecast logic card if available
            let logicHtml = '';
            if (catData && catData.meta) {
                const m = catData.meta;
                let mathText = '';
                let methodDesc = '';

                // --- FORECAST LOGIC HTML GENERATION ---
                if (m.method === 'GL Average') {
                    const extra = (m.expectedWeek && m.expectedWeek !== "")
                        ? `Implied Monthly: <strong>${fmtMoney(m.rawAverage * 4.345)}</strong><br>Allocated to Week ${m.expectedWeek}`
                        : `Distributed Weekly`;
                    mathText = `<div class="d-flex justify-content-between small mb-1"><span>Total Source:</span> <strong>${fmtMoney(m.sourceTotal)}</strong></div>
                        <div class="d-flex justify-content-between small mb-1"><span>Lookback:</span> <span>${m.weeksUsed} Weeks</span></div>
                        <div class="border-top my-2"></div>
                        <div class="d-flex justify-content-between small mb-1"><span>Raw Avg:</span> <span>${fmtMoney(m.rawAverage)}</span></div>
                        <div class="small text-muted text-right mb-1">${extra}</div>
                        <div class="d-flex justify-content-between small mb-1 text-primary"><span>Adj:</span> <strong>${m.adjustment}%</strong></div>
                        <div class="d-flex justify-content-between font-weight-bold border-top pt-1 mt-2"><span>Final (Wkly):</span> <span>${fmtMoney(m.finalAverage)}</span></div>`;
                    methodDesc = `<p class="mb-2"><strong>GL History Average</strong> analyzes General Ledger activity for selected accounts over a defined lookback period.</p>
                        <div class="small text-muted">
                            <div class="mb-1"><i class="fas fa-calculator text-primary mr-1"></i><strong>Calculation:</strong> Sum of historical GL entries ÷ number of weeks = weekly average</div>
                            <div class="mb-1"><i class="fas fa-percentage text-info mr-1"></i><strong>Adjustment:</strong> Applied as growth/decline factor to the raw average</div>
                            <div><i class="fas fa-calendar text-success mr-1"></i><strong>Timing:</strong> ${m.expectedWeek ? 'Concentrated in Week ' + m.expectedWeek + ' of each month' : 'Distributed evenly across all weeks'}</div>
                        </div>`;
                } else if (m.method === 'Vendor History (Median)') {
                    mathText = `<div class="d-flex justify-content-between small mb-1"><span>Monthly Median:</span> <strong>${fmtMoney(m.monthlyMedian)}</strong></div>
                        <div class="d-flex justify-content-between small mb-1 text-primary"><span>Adj:</span> <strong>${m.adjustment}%</strong></div>
                        <div class="d-flex justify-content-between font-weight-bold border-top pt-1 mt-2"><span>Final (Wkly):</span> <span>${fmtMoney(m.finalWeekly)}</span></div>`;
                    methodDesc = `<p class="mb-2"><strong>Vendor Payment History</strong> aggregates historical payments to selected vendors.</p>`;
                } else if (m.method === 'Credit Card Cycle') {
                    mathText = `<div class="d-flex justify-content-between small mb-1"><span>Balance:</span> <strong>${fmtMoney(m.outstanding)}</strong></div>
                        <div class="d-flex justify-content-between small mb-1 text-primary"><span>+ Growth:</span> <strong>${fmtMoney(m.projectedGrowth)}</strong></div>
                        <div class="border-top my-2"></div>
                        <div class="d-flex justify-content-between font-weight-bold text-dark mb-1"><span>Next Pay:</span> <span>${fmtMoney(m.outstanding + m.projectedGrowth)}</span></div>`;
                    methodDesc = `<p class="mb-2"><strong>Credit Card Cycle</strong> combines real-time liability balances with historical spending.</p>`;
                } else if (m.method === 'Manual Recurring') {
                    mathText = `<div class="d-flex justify-content-between small mb-1"><span>Amount:</span> <strong>${fmtMoney(m.amount)}</strong></div>
                    <div class="d-flex justify-content-between small mb-1"><span>Frequency:</span> <span>${m.frequency}</span></div>`;
                    methodDesc = `<p class="mb-2"><strong>Manual Recurring</strong> creates fixed cash flow events.</p>`;
                } else if (m.method === 'Vendor Recurring (Auto)') {
                    mathText = `<div class="d-flex justify-content-between small mb-1"><span>Detected:</span> <span class="badge badge-soft-primary">${m.frequency}</span></div>
                    <div class="d-flex justify-content-between small mb-1"><span>Interval:</span> <span>${m.interval} Days</span></div>
                    <div class="d-flex justify-content-between align-items-center border-top mt-2 pt-2"><span class="font-weight-bold">Run Rate:</span> <span class="font-weight-bold">${fmtMoney(m.avgAmount)}</span></div>`;
                    methodDesc = `<p class="mb-2"><strong>Vendor Recurring (Auto)</strong> uses pattern recognition.</p>`;
                } else if (m.method === 'Bank Register History') {
                    mathText = `<div class="d-flex justify-content-between small mb-1"><span>Raw Avg:</span> <span>${fmtMoney(m.rawAverage)}</span></div>
                    <div class="d-flex justify-content-between font-weight-bold border-top pt-1 mt-2"><span>Final (Wkly):</span> <span>${fmtMoney(m.finalAverage)}</span></div>`;
                    methodDesc = `<p class="mb-2"><strong>Bank Register History</strong> forecasts from bank cash movements.</p>`;
                } else if (m.method === 'Calculated Formula') {
                    mathText = `<code class="small d-block mb-2" style="background:#f8f9fa; padding:4px;">${m.formula}</code>`;
                    methodDesc = `<p class="mb-2"><strong>Formula Expression</strong> uses programmable logic.</p>`;
                }

                if (mathText) {
                    logicHtml = `
                        <div class="card border mb-3" style="margin-top:16px;">
                            <div class="card-header bg-light py-2">
                                <small class="font-weight-bold"><i class="fas fa-info-circle mr-2" style="color:${methodColor};"></i>Forecast Logic Details</small>
                            </div>
                            <div class="card-body p-3">
                                <div class="row">
                                    <div class="col-md-5 border-right">
                                        <div class="small font-weight-bold text-muted mb-2">CALCULATION</div>
                                        ${mathText}
                                    </div>
                                    <div class="col-md-7">
                                        <div class="small font-weight-bold text-muted mb-2">HOW IT WORKS</div>
                                        ${methodDesc}
                                    </div>
                                </div>
                            </div>
                        </div>`;
                }
            }

            html = logicHtml + html;

            // Update content container (tabs and KPI row are already rendered)
            content.innerHTML = html;
        },

        rerenderDetailTable() {
            if (this.currentDetailCatData) {
                this.renderDetailTable(this.currentDetailCatData);
            }
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // FLYOUT SYSTEM - World-class drilldown panel
        // ═══════════════════════════════════════════════════════════════════════════
        
        openFlyout() {
            this.flyout.open = true;
            el('#cfFlyoutOverlay').classList.add('open');
            el('#cfFlyoutPanel').classList.add('open');
            document.body.style.overflow = 'hidden';
        },
        
        closeFlyout() {
            this.flyout.open = false;
            this.flyout.type = null;
            this.flyout.context = null;
            this.flyout.previousContext = null;
            el('#cfFlyoutOverlay').classList.remove('open');
            el('#cfFlyoutPanel').classList.remove('open');
            document.body.style.overflow = '';

            // Clear any selected rows in the weekly table
            document.querySelectorAll('.cf-row-selected').forEach(row => {
                row.classList.remove('cf-row-selected');
            });
        },
        
        goBackFlyout() {
            const prev = this.flyout.previousContext;
            if (!prev) return;

            this.flyout.previousContext = null;

            if (prev.type === 'week') {
                this.resetFlyoutState();
                this.showWeekFlyout(prev.weekStart);
            } else if (prev.type === 'bucket') {
                this.resetFlyoutState();
                this.showBucketFlyout(prev.bucket, prev.bucketType);
            }
        },
        
        resetFlyoutState() {
            this.flyout.search = '';
            this.flyout.groupBy = 'none';
            this.flyout.sortCol = 'amount';
            this.flyout.sortDir = 'desc';
            this.flyout.page = 1;
            this.flyout.activeTab = 'ar';
            this.flyout.arData = [];
            this.flyout.apData = [];
        },
        
        // ═══════════════════════════════════════════════════════════════════════════
        // WEEK FLYOUT - Click a week row to see AR/AP details
        // ═══════════════════════════════════════════════════════════════════════════
        
        async showWeekFlyout(weekStart, weekDataParam, catsParam) {
            const self = this;
            this.resetFlyoutState();
            this.flyout.type = 'week';
            this.flyout.context = { weekStart };
            
            // Use passed data or look up from rawData
            const weekData = weekDataParam || this.rawData.company.weeklyCash.find(w => w.weekStart === weekStart);
            const cats = catsParam || this.rawData.company.dynamicCategories || {};
            const config = this.rawData.meta.activeConfig || {};
            
            if (!weekData) return;
            
            this.openFlyout();
            
            // Set header (simple single line like Time dashboard)
            el('#cfFlyoutTitle').innerHTML = `<i class="fas fa-calendar-week mr-2"></i>Week of ${weekStart}`;
            
            // Build summary data for both display and CSV export
            const summaryRows = [];
            summaryRows.push({ label: 'Starting Cash', value: weekData.startingCash, icon: 'fa-wallet', type: 'neutral' });
            summaryRows.push({ label: 'Safe AP Capacity', value: weekData.safeApCapacity || 0, icon: 'fa-shield-alt', type: 'info' });
            summaryRows.push({ label: 'Inflow (AR)', value: weekData.inflows.ar, icon: 'fa-arrow-down', type: 'inflow' });
            
            const otherIn = (weekData.inflows.total || 0) - (weekData.inflows.ar || 0);
            if (otherIn > 0) summaryRows.push({ label: 'Inflow (Other)', value: otherIn, icon: 'fa-arrow-down', type: 'inflow' });
            
            summaryRows.push({ label: 'Outflow (AP)', value: weekData.outflows.ap, icon: 'fa-arrow-up', type: 'outflow' });
            
            // Category outflows
            if (cats && config.categories) {
                Object.keys(cats).forEach(k => {
                    const val = cats[k].weeklyAmounts ? cats[k].weeklyAmounts[weekStart] : 0;
                    if (val > 0) {
                        const catConf = config.categories.find(c => c.id === k);
                        summaryRows.push({ label: `Out: ${catConf ? catConf.name : k}`, value: val, icon: 'fa-arrow-up', type: 'outflow' });
                    }
                });
            }
            
            if (weekData.outflows.deferred > 0) {
                summaryRows.push({ label: 'Deferred (Backlog)', value: weekData.outflows.deferred, icon: 'fa-clock', type: 'warning' });
            }
            
            summaryRows.push({ label: 'Net Change', value: weekData.netChange, icon: 'fa-exchange-alt', type: weekData.netChange >= 0 ? 'positive' : 'negative' });
            summaryRows.push({ label: 'Ending Cash', value: weekData.endingCash, icon: 'fa-university', type: weekData.endingCash >= 0 ? 'neutral' : 'negative' });
            
            // Store summary for CSV export
            this.flyout.summaryData = summaryRows;
            
            // Build KPI row using shared components
            const netChangeColor = weekData.netChange >= 0 ? '#10b981' : '#ef4444';
            const coverageRatio = weekData.outflows.total > 0 ? (weekData.inflows.total / weekData.outflows.total) : 1;
            const coveragePct = Math.min(coverageRatio * 100, 100);
            
            // Use HealthGauge.generateSemi for coverage visualization
            const coverageGauge = typeof HealthGauge !== 'undefined' ? 
                HealthGauge.generateSemi(coveragePct, { width: 80, height: 45, strokeWidth: 8, showValue: false, thresholds: { good: 100, warning: 80 } }) :
                '';
            
            let summaryHtml = `
                <div class="cf-flyout-kpis" style="display:flex; gap:12px; margin-bottom:16px;">
                    <div class="cf-flyout-stat-card" style="flex:1;">
                        <div class="stat-icon" style="background:${netChangeColor}15;">
                            <i class="fas fa-exchange-alt" style="color:${netChangeColor};"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-label">Net Change</div>
                            <div class="stat-value" style="color:${netChangeColor};">${weekData.netChange >= 0 ? '+' : ''}${fmtMoney(weekData.netChange)}</div>
                        </div>
                    </div>
                    <div class="cf-flyout-stat-card" style="flex:1;">
                        <div class="stat-gauge">${coverageGauge}</div>
                        <div class="stat-content">
                            <div class="stat-label">Coverage Ratio</div>
                            <div class="stat-value">${(coverageRatio * 100).toFixed(0)}%</div>
                        </div>
                    </div>
                </div>
                <div class="cf-flyout-breakdown">
            `;
            
            summaryRows.forEach((row) => {
                let color = '#64748b';
                let valueColor = '#1e293b';
                if (row.type === 'inflow') { color = '#10b981'; valueColor = '#10b981'; }
                else if (row.type === 'outflow') { color = '#ef4444'; valueColor = '#ef4444'; }
                else if (row.type === 'info') { color = '#3b82f6'; valueColor = '#3b82f6'; }
                else if (row.type === 'warning') { color = '#f59e0b'; valueColor = '#f59e0b'; }
                else if (row.type === 'positive') { valueColor = '#10b981'; }
                else if (row.type === 'negative') { valueColor = '#ef4444'; }
                
                summaryHtml += `
                    <div class="cf-breakdown-row">
                        <span class="breakdown-label" style="color:${color};"><i class="fas ${row.icon}"></i>${row.label}</span>
                        <span class="breakdown-value" style="color:${valueColor};">${fmtMoney(row.value)}</span>
                    </div>
                `;
            });
            
            summaryHtml += '</div>';
            
            // Put summary in dedicated summary section (above tabs)
            el('#cfFlyoutSummary').innerHTML = summaryHtml;
            
            // Show tabs and toolbar
            el('#cfFlyoutTabs').style.display = 'flex';
            el('#cfFlyoutToolbar').style.display = 'flex';
            
            // Loading state for transactions
            el('#cfFlyoutBody').innerHTML = `
                <div class="cf-flyout-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <div class="loading-text">Loading transactions...</div>
                </div>
            `;
            el('#cfFlyoutPagination').style.display = 'none';
            
            try {
                // Fetch AR and AP data in parallel
                const [arRes, apRes] = await Promise.all([
                    API.post('cashflow', { subAction: 'week_transactions', weekStart: weekStart, type: 'ar' }),
                    API.post('cashflow', { subAction: 'week_transactions', weekStart: weekStart, type: 'ap' })
                ]);
                
                this.flyout.arData = (arRes.status === 'success') ? arRes.transactions : [];
                this.flyout.apData = (apRes.status === 'success') ? apRes.transactions : [];
                
                // Update tab labels with counts
                this.updateFlyoutTabs();
                
                // Render active tab
                this.renderFlyoutTable();
                
            } catch (e) {
                console.error('Week flyout error:', e);
                el('#cfFlyoutBody').innerHTML = `
                    <div class="cf-flyout-empty">
                        <i class="fas fa-exclamation-triangle text-warning"></i>
                        <div class="empty-title">Unable to load transactions</div>
                        <div class="empty-text">${e.message}</div>
                    </div>
                `;
            }
        },
        
        updateFlyoutTabs() {
            const arCount = this.flyout.arData.length;
            const apCount = this.flyout.apData.length;
            const arTotal = this.flyout.arData.reduce((sum, t) => sum + t.amount, 0);
            const apTotal = this.flyout.apData.reduce((sum, t) => sum + t.amount, 0);
            
            const tabs = el('#cfFlyoutTabs');
            if (tabs) {
                tabs.innerHTML = `
                    <div class="cf-flyout-tab ${this.flyout.activeTab === 'ar' ? 'active' : ''}" data-tab="ar" onclick="CashflowController.switchFlyoutTab('ar')">
                        <i class="fas fa-arrow-down text-success mr-1"></i>AR Inflows
                        <span class="badge badge-success ml-2">${arCount}</span>
                        <span class="badge badge-outline-success ml-1">${fmtMoney(arTotal)}</span>
                    </div>
                    <div class="cf-flyout-tab ${this.flyout.activeTab === 'ap' ? 'active' : ''}" data-tab="ap" onclick="CashflowController.switchFlyoutTab('ap')">
                        <i class="fas fa-arrow-up text-danger mr-1"></i>AP Outflows
                        <span class="badge badge-danger ml-2">${apCount}</span>
                        <span class="badge badge-outline-danger ml-1">${fmtMoney(apTotal)}</span>
                    </div>
                `;
            }
        },
        
        switchFlyoutTab(tab) {
            this.flyout.activeTab = tab;
            this.flyout.page = 1;
            this.flyout.search = '';
            el('#cfFlyoutSearch').value = '';
            this.updateFlyoutTabs();
            this.renderFlyoutTable();
        },
        
        filterFlyoutTable(query) {
            this.flyout.search = (query || '').toLowerCase().trim();
            this.flyout.page = 1;
            this.renderFlyoutTable();
        },
        
        groupFlyoutTable(groupBy) {
            this.flyout.groupBy = groupBy;
            this.flyout.page = 1;
            this.renderFlyoutTable();
        },
        
        sortFlyoutTable(col) {
            if (this.flyout.sortCol === col) {
                this.flyout.sortDir = this.flyout.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                this.flyout.sortCol = col;
                this.flyout.sortDir = 'desc';
            }
            this.renderFlyoutTable();
        },
        
        getFilteredFlyoutData() {
            const data = this.flyout.activeTab === 'ar' ? this.flyout.arData : this.flyout.apData;
            const search = this.flyout.search;
            
            if (!search) return data;
            
            return data.filter(t => {
                return (t.entityName || '').toLowerCase().includes(search) ||
                       (t.tranId || '').toLowerCase().includes(search);
            });
        },
        
        renderFlyoutTable() {
            const body = el('#cfFlyoutBody');
            if (!body) return;
            
            let data = this.getFilteredFlyoutData();
            
            if (data.length === 0) {
                body.innerHTML = `
                    <div class="cf-flyout-empty">
                        <i class="fas fa-inbox"></i>
                        <div class="empty-title">No transactions</div>
                        <div class="empty-text">${this.flyout.search ? 'No matches for your search' : 'No items scheduled for this week'}</div>
                    </div>
                `;
                el('#cfFlyoutPagination').style.display = 'none';
                return;
            }
            
            // Sort
            const sortCol = this.flyout.sortCol;
            const sortDir = this.flyout.sortDir;
            data = data.slice().sort((a, b) => {
                let aVal = a[sortCol];
                let bVal = b[sortCol];
                if (sortCol === 'amount') {
                    aVal = parseFloat(aVal) || 0;
                    bVal = parseFloat(bVal) || 0;
                }
                if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });
            
            // Paginate
            const page = this.flyout.page;
            const pageSize = this.flyout.pageSize;
            const totalItems = data.length;
            const totalPages = Math.ceil(totalItems / pageSize);
            const start = (page - 1) * pageSize;
            const paged = data.slice(start, start + pageSize);
            
            // Build table
            const sortIcon = (col) => {
                if (this.flyout.sortCol !== col) return '<i class="fas fa-sort sort-icon"></i>';
                return this.flyout.sortDir === 'asc' 
                    ? '<i class="fas fa-sort-up sort-icon"></i>' 
                    : '<i class="fas fa-sort-down sort-icon"></i>';
            };
            
            let html = `
                <div class="table-container">
                    <table class="cf-flyout-table">
                        <thead>
                            <tr>
                                <th class="sortable ${this.flyout.sortCol === 'tranId' ? 'sorted' : ''}" onclick="CashflowController.sortFlyoutTable('tranId')">
                                    ID ${sortIcon('tranId')}
                                </th>
                                <th class="sortable ${this.flyout.sortCol === 'entityName' ? 'sorted' : ''}" onclick="CashflowController.sortFlyoutTable('entityName')">
                                    ${this.flyout.activeTab === 'ar' ? 'Customer' : 'Vendor'} ${sortIcon('entityName')}
                                </th>
                                <th class="sortable ${this.flyout.sortCol === 'predictedDate' ? 'sorted' : ''}" onclick="CashflowController.sortFlyoutTable('predictedDate')">
                                    Predicted ${sortIcon('predictedDate')}
                                </th>
                                <th class="text-center">Method</th>
                                <th class="text-center">Status</th>
                                <th class="sortable text-right ${this.flyout.sortCol === 'amount' ? 'sorted' : ''}" onclick="CashflowController.sortFlyoutTable('amount')">
                                    Amount ${sortIcon('amount')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            paged.forEach(t => {
                const entityType = this.flyout.activeTab === 'ar' ? 'customer' : 'vendor';
                const daysClass = t.daysOverDue > 0 ? 'overdue' : t.daysOverDue < -7 ? 'current' : 'due-soon';
                const daysLabel = t.daysOverDue > 0 ? `+${t.daysOverDue}` : t.daysOverDue;
                const predMethod = (t.predictionMethod || 'unknown').toLowerCase();
                const predDetail = t.predictionDetail || '';

                // Prediction method pill - handle both old and new backend values
                let methodLabel = 'Unknown';
                let methodClass = 'method-unknown';
                if (predMethod === 'custom') { methodLabel = 'Custom'; methodClass = 'method-custom'; }
                else if (predMethod === 'statistical') { methodLabel = 'History'; methodClass = 'method-history'; }
                else if (predMethod === 'customer_history') { methodLabel = 'History'; methodClass = 'method-history'; }
                else if (predMethod === 'vendor_history') { methodLabel = 'History'; methodClass = 'method-history'; }
                else if (predMethod === 'terms') { methodLabel = 'Terms'; methodClass = 'method-terms'; }
                else if (predMethod === 'default') { methodLabel = 'Average'; methodClass = 'method-avg'; }
                else if (predMethod === 'global_avg') { methodLabel = 'Average'; methodClass = 'method-avg'; }
                else if (predMethod === 'duedate') { methodLabel = 'Due Date'; methodClass = 'method-terms'; }
                
                html += `
                    <tr>
                        <td><a href="/app/accounting/transactions/transaction.nl?id=${t.internalId}" target="_blank" class="cf-entity-link">${t.tranId}</a></td>
                        <td><a href="javascript:void(0)" class="cf-entity-link" onclick="CashflowController.showEntityFlyout(${t.entityId}, '${escapeHtml(t.entityName).replace(/'/g, "\\'")}', '${entityType}')">${escapeHtml(t.entityName)}</a></td>
                        <td>${t.predictedDate}</td>
                        <td class="text-center"><span class="cf-method-pill ${methodClass}" title="${escapeHtml(predDetail)}">${methodLabel}</span></td>
                        <td class="text-center"><span class="cf-days-pill ${daysClass}">${daysLabel}d</span></td>
                        <td class="text-right font-weight-bold">${fmtMoney(t.amount)}</td>
                    </tr>
                `;
            });
            
            html += '</tbody></table></div>';
            body.innerHTML = html;
            
            // Update pagination
            const pagination = el('#cfFlyoutPagination');
            if (totalPages > 1) {
                pagination.style.display = 'flex';
                el('#cfFlyoutPageInfo').textContent = `Showing ${start + 1}-${Math.min(start + pageSize, totalItems)} of ${totalItems}`;
                el('#cfFlyoutPrevBtn').disabled = page <= 1;
                el('#cfFlyoutNextBtn').disabled = page >= totalPages;
            } else {
                pagination.style.display = 'none';
            }
        },
        
        flyoutPrevPage() {
            if (this.flyout.page > 1) {
                this.flyout.page--;
                this.renderFlyoutTable();
            }
        },
        
        flyoutNextPage() {
            const data = this.getFilteredFlyoutData();
            const totalPages = Math.ceil(data.length / this.flyout.pageSize);
            if (this.flyout.page < totalPages) {
                this.flyout.page++;
                this.renderFlyoutTable();
            }
        },
        
        // ═══════════════════════════════════════════════════════════════════════════
        // ENTITY FLYOUT - Click a customer/vendor to see payment history
        // ═══════════════════════════════════════════════════════════════════════════
        
        async showEntityFlyout(entityId, entityName, entityType) {
            const self = this;

            // Store previous flyout state for back button
            if (this.flyout.type === 'week') {
                this.flyout.previousContext = {
                    type: 'week',
                    weekStart: this.flyout.context.weekStart
                };
            } else if (this.flyout.type === 'bucket') {
                this.flyout.previousContext = {
                    type: 'bucket',
                    bucket: this.flyout.context.bucket,
                    bucketType: this.flyout.context.type
                };
            }
            
            this.flyout.type = 'entity';
            this.flyout.context = { entityId, entityName, entityType };
            
            // Don't call openFlyout - flyout is already open
            
            // Set header with back button
            const icon = entityType === 'customer' ? 'fa-user' : 'fa-building';
            const backBtn = this.flyout.previousContext ? 
                `<button class="cf-back-btn" onclick="CashflowController.goBackFlyout()"><i class="fas fa-arrow-left"></i></button>` : '';
            el('#cfFlyoutTitle').innerHTML = `${backBtn}<i class="fas ${icon} mr-2"></i>${escapeHtml(entityName)}`;
            
            // Hide tabs, clear summary
            el('#cfFlyoutTabs').style.display = 'none';
            el('#cfFlyoutToolbar').style.display = 'none';
            el('#cfFlyoutSummary').innerHTML = '';
            
            // Loading state
            el('#cfFlyoutBody').innerHTML = `
                <div class="cf-flyout-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <div class="loading-text">Loading payment history...</div>
                </div>
            `;
            el('#cfFlyoutPagination').style.display = 'none';
            
            try {
                const res = await API.post('cashflow', { 
                    subAction: 'entity_history', 
                    entityId: entityId, 
                    entityType: entityType,
                    months: 12
                });
                
                if (res.status !== 'success') {
                    throw new Error(res.error || 'Failed to load entity data');
                }
                
                this.renderEntityFlyout(res, entityType);
                
            } catch (e) {
                console.error('Entity flyout error:', e);
                el('#cfFlyoutBody').innerHTML = `
                    <div class="cf-flyout-empty">
                        <i class="fas fa-exclamation-triangle text-warning"></i>
                        <div class="empty-title">Unable to load data</div>
                        <div class="empty-text">${e.message}</div>
                    </div>
                `;
            }
        },
        
        renderEntityFlyout(data, entityType) {
            const summary = data.summary || {};
            const trend = data.monthlyTrend || [];
            const openItems = data.openItems || [];
            const recentPayments = data.recentPayments || [];

            // Build summary using standard KPI card style
            let summaryHtml = '';

            if (entityType === 'customer') {
                const reliabilityColor = summary.reliabilityScore >= 70 ? '#10b981' : summary.reliabilityScore >= 50 ? '#f59e0b' : '#ef4444';
                summaryHtml = `
                    <div class="cf-flyout-kpis" style="display:flex; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
                        <div class="cf-flyout-stat-card" style="flex:1; min-width:120px;">
                            <div class="stat-icon" style="background:#3b82f615;">
                                <i class="fas fa-clock" style="color:#3b82f6;"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-label">Avg Days to Pay</div>
                                <div class="stat-value" style="color:#3b82f6;">${summary.avgDaysToPay || 0}d</div>
                            </div>
                        </div>
                        <div class="cf-flyout-stat-card" style="flex:1; min-width:120px;">
                            <div class="stat-icon" style="background:#10b98115;">
                                <i class="fas fa-check-circle" style="color:#10b981;"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-label">Total Paid (12mo)</div>
                                <div class="stat-value" style="color:#10b981;">${fmtMoney(summary.totalPaid || 0)}</div>
                            </div>
                        </div>
                        <div class="cf-flyout-stat-card" style="flex:1; min-width:120px;">
                            <div class="stat-icon" style="background:#f59e0b15;">
                                <i class="fas fa-file-invoice-dollar" style="color:#f59e0b;"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-label">Open Balance</div>
                                <div class="stat-value" style="color:#f59e0b;">${fmtMoney(summary.totalOpen || 0)}</div>
                            </div>
                        </div>
                        <div class="cf-flyout-stat-card" style="flex:1; min-width:120px;">
                            <div class="stat-icon" style="background:${reliabilityColor}15;">
                                <i class="fas fa-star" style="color:${reliabilityColor};"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-label">Reliability</div>
                                <div class="stat-value" style="color:${reliabilityColor};">${summary.reliabilityScore || 0}/100</div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                summaryHtml = `
                    <div class="cf-flyout-kpis" style="display:flex; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
                        <div class="cf-flyout-stat-card" style="flex:1; min-width:120px;">
                            <div class="stat-icon" style="background:#ef444415;">
                                <i class="fas fa-credit-card" style="color:#ef4444;"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-label">Total Paid (12mo)</div>
                                <div class="stat-value" style="color:#ef4444;">${fmtMoney(summary.totalPaid || 0)}</div>
                            </div>
                        </div>
                        <div class="cf-flyout-stat-card" style="flex:1; min-width:120px;">
                            <div class="stat-icon" style="background:#3b82f615;">
                                <i class="fas fa-receipt" style="color:#3b82f6;"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-label">Payments</div>
                                <div class="stat-value" style="color:#3b82f6;">${fmtNum(summary.paymentCount || 0, 0)}</div>
                            </div>
                        </div>
                        <div class="cf-flyout-stat-card" style="flex:1; min-width:120px;">
                            <div class="stat-icon" style="background:#f59e0b15;">
                                <i class="fas fa-file-invoice" style="color:#f59e0b;"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-label">Open Bills</div>
                                <div class="stat-value" style="color:#f59e0b;">${fmtMoney(summary.totalOpen || 0)}</div>
                            </div>
                        </div>
                        <div class="cf-flyout-stat-card" style="flex:1; min-width:120px;">
                            <div class="stat-icon" style="background:#64748b15;">
                                <i class="fas fa-calculator" style="color:#64748b;"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-label">Avg Payment</div>
                                <div class="stat-value">${fmtMoney(summary.avgPayment || 0)}</div>
                            </div>
                        </div>
                    </div>
                `;
            }

            el('#cfFlyoutSummary').innerHTML = summaryHtml;
            
            // Body content
            let html = '<div style="padding: 16px 24px;">';
            
            // Open items section
            html += `
                <div class="mb-4">
                    <h6 class="font-weight-bold mb-3"><i class="fas fa-clock text-warning mr-2"></i>Open ${entityType === 'customer' ? 'Invoices' : 'Bills'} (${openItems.length})</h6>
            `;
            
            if (openItems.length === 0) {
                html += '<p class="text-muted small">No open items</p>';
            } else {
                html += `<table class="cf-flyout-table"><thead><tr>
                    <th>ID</th><th>Date</th><th>Due Date</th><th class="text-center">Status</th><th>Memo</th><th class="text-right">Amount</th>
                </tr></thead><tbody>`;
                
                openItems.forEach(item => {
                    const daysClass = item.daysOverDue > 0 ? 'overdue' : item.daysOverDue < -7 ? 'current' : 'due-soon';
                    const daysLabel = item.daysOverDue > 0 ? `+${item.daysOverDue}` : item.daysOverDue;
                    const memo = item.memo ? (item.memo.length > 30 ? item.memo.substring(0, 30) + '...' : item.memo) : '-';
                    
                    html += `<tr>
                        <td><a href="/app/accounting/transactions/transaction.nl?id=${item.internalId}" target="_blank" class="cf-entity-link">${item.tranId}</a></td>
                        <td>${item.tranDate}</td>
                        <td>${item.dueDate || '-'}</td>
                        <td class="text-center"><span class="cf-days-pill ${daysClass}">${daysLabel}d</span></td>
                        <td class="text-muted" style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(item.memo || '')}">${escapeHtml(memo)}</td>
                        <td class="text-right font-weight-bold">${fmtMoney(item.amount)}</td>
                    </tr>`;
                });
                
                html += '</tbody></table>';
            }
            html += '</div>';
            
            // Recent payments section
            html += `
                <div>
                    <h6 class="font-weight-bold mb-3"><i class="fas fa-history text-info mr-2"></i>Recent Payments (${recentPayments.length})</h6>
            `;
            
            if (recentPayments.length === 0) {
                html += '<p class="text-muted small">No payment history found</p>';
            } else {
                html += `<table class="cf-flyout-table"><thead><tr>
                    <th>ID</th><th>${entityType === 'customer' ? 'Paid Date' : 'Payment Date'}</th>
                    ${entityType === 'customer' ? '<th class="text-center">Days to Pay</th>' : ''}
                    <th>Memo</th><th class="text-right">Amount</th>
                </tr></thead><tbody>`;
                
                recentPayments.forEach(p => {
                    const memo = p.memo ? (p.memo.length > 30 ? p.memo.substring(0, 30) + '...' : p.memo) : '-';
                    html += `<tr>
                        <td><a href="/app/accounting/transactions/transaction.nl?id=${p.internalId}" target="_blank" class="cf-entity-link">${p.tranId}</a></td>
                        <td>${entityType === 'customer' ? p.closeDate : p.tranDate}</td>
                        ${entityType === 'customer' ? `<td class="text-center">${p.daysToPay || '-'}</td>` : ''}
                        <td class="text-muted" style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(p.memo || '')}">${escapeHtml(memo)}</td>
                        <td class="text-right font-weight-bold">${fmtMoney(p.amount)}</td>
                    </tr>`;
                });
                
                html += '</tbody></table>';
            }
            html += '</div></div>';
            
            el('#cfFlyoutBody').innerHTML = html;
        },
        
        // ═══════════════════════════════════════════════════════════════════════════
        // AGING BUCKET FLYOUT - Click an aging bucket to see items
        // ═══════════════════════════════════════════════════════════════════════════
        
        async showBucketFlyout(bucket, type) {
            const self = this;
            this.resetFlyoutState();
            this.flyout.type = 'bucket';
            this.flyout.context = { bucket, type };
            
            this.openFlyout();
            
            // Set header
            const typeLabel = type === 'ar' ? 'AR' : 'AP';
            const icon = type === 'ar' ? 'fa-file-invoice-dollar' : 'fa-file-invoice';
            el('#cfFlyoutTitle').innerHTML = `<i class="fas ${icon} mr-2"></i>${typeLabel} Aging: ${bucket}`;
            
            // Hide tabs, show toolbar, clear summary
            el('#cfFlyoutTabs').style.display = 'none';
            el('#cfFlyoutToolbar').style.display = 'flex';
            el('#cfFlyoutSummary').innerHTML = '';
            
            // Loading state
            el('#cfFlyoutBody').innerHTML = `
                <div class="cf-flyout-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <div class="loading-text">Loading ${bucket} items...</div>
                </div>
            `;
            el('#cfFlyoutPagination').style.display = 'none';
            
            try {
                const res = await API.post('cashflow', { 
                    subAction: 'aging_bucket_detail', 
                    bucket: bucket, 
                    type: type 
                });
                
                if (res.status !== 'success') {
                    throw new Error(res.error || 'Failed to load bucket data');
                }
                
                // Store data for filtering/sorting
                this.flyout.arData = type === 'ar' ? res.items : [];
                this.flyout.apData = type === 'ap' ? res.items : [];
                this.flyout.activeTab = type;

                // Show summary using standard KPI card style
                const amountColor = type === 'ar' ? '#10b981' : '#ef4444';
                const amountIcon = type === 'ar' ? 'fa-arrow-down' : 'fa-arrow-up';
                el('#cfFlyoutSummary').innerHTML = `
                    <div class="cf-flyout-kpis" style="display:flex; gap:12px; margin-bottom:16px;">
                        <div class="cf-flyout-stat-card" style="flex:1;">
                            <div class="stat-icon" style="background:#3b82f615;">
                                <i class="fas fa-file-invoice" style="color:#3b82f6;"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-label">Items</div>
                                <div class="stat-value">${fmtNum(res.summary.count, 0)}</div>
                            </div>
                        </div>
                        <div class="cf-flyout-stat-card" style="flex:1;">
                            <div class="stat-icon" style="background:${amountColor}15;">
                                <i class="fas ${amountIcon}" style="color:${amountColor};"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-label">Total Amount</div>
                                <div class="stat-value" style="color:${amountColor};">${fmtMoney(res.summary.totalAmount)}</div>
                            </div>
                        </div>
                    </div>
                `;
                
                this.renderBucketTable(res.items, type);
                
            } catch (e) {
                console.error('Bucket flyout error:', e);
                el('#cfFlyoutBody').innerHTML = `
                    <div class="cf-flyout-empty">
                        <i class="fas fa-exclamation-triangle text-warning"></i>
                        <div class="empty-title">Unable to load data</div>
                        <div class="empty-text">${e.message}</div>
                    </div>
                `;
            }
        },
        
        renderBucketTable(items, type) {
            // Reuse the flyout table rendering
            this.renderFlyoutTable();
        },
        
        // ═══════════════════════════════════════════════════════════════════════════
        // CSV EXPORT
        // ═══════════════════════════════════════════════════════════════════════════
        
        exportFlyoutCSV() {
            let csv = '';
            const weekStart = (this.flyout.context && this.flyout.context.weekStart) || 'data';
            
            // For week flyouts, include summary, AR, and AP data
            if (this.flyout.type === 'week') {
                // Summary section
                if (this.flyout.summaryData && this.flyout.summaryData.length > 0) {
                    csv += 'WEEK SUMMARY\n';
                    csv += 'Item,Amount\n';
                    this.flyout.summaryData.forEach(row => {
                        csv += `"${row.label}","${row.value}"\n`;
                    });
                    csv += '\n';
                }
                
                // AR Inflows section
                if (this.flyout.arData && this.flyout.arData.length > 0) {
                    csv += 'AR INFLOWS\n';
                    csv += 'ID,Entity,Amount,Transaction Date,Due Date,Predicted Date,Days Over/Under,Confidence\n';
                    this.flyout.arData.forEach(t => {
                        csv += `"${t.tranId}","${t.entityName}","${t.amount}","${t.tranDate}","${t.dueDate || ''}","${t.predictedDate || ''}","${t.daysOverDue || 0}","${t.confidence || ''}"\n`;
                    });
                    csv += '\n';
                }
                
                // AP Outflows section
                if (this.flyout.apData && this.flyout.apData.length > 0) {
                    csv += 'AP OUTFLOWS\n';
                    csv += 'ID,Entity,Amount,Transaction Date,Due Date,Predicted Date,Days Over/Under,Confidence\n';
                    this.flyout.apData.forEach(t => {
                        csv += `"${t.tranId}","${t.entityName}","${t.amount}","${t.tranDate}","${t.dueDate || ''}","${t.predictedDate || ''}","${t.daysOverDue || 0}","${t.confidence || ''}"\n`;
                    });
                }
            } else {
                // For other flyout types (entity, bucket), just export current tab data
                const data = this.getFilteredFlyoutData();
                if (data.length === 0) return;
                
                csv = 'ID,Entity,Amount,Transaction Date,Due Date,Predicted Date,Days Over/Under,Confidence\n';
                data.forEach(t => {
                    csv += `"${t.tranId}","${t.entityName}","${t.amount}","${t.tranDate}","${t.dueDate || ''}","${t.predictedDate || ''}","${t.daysOverDue || 0}","${t.confidence || ''}"\n`;
                });
            }
            
            if (!csv) return;
            
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cashflow_week_${weekStart}_${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    // --- CONFIG CONTROLLER (FULL VERSION) ---
    const ConfigController = {
        data: null,
        idx: -1,
        fixedType: null,
        bankAccounts: [],
        
        // Initialize with pre-loaded data (from CashflowController)
        initWithData(res) {
            this.processConfigResponse(res);
        },
        
        async init(background = false) {
            if (!background) {
                el('#cfConfigContainer').innerHTML = '<div class="p-5 text-center text-muted">Loading Configuration...</div>';
            }
            
            try {
                const configName = CashflowController.getConfigName();
                const res = await API.get('config', { configName: configName });
                this.processConfigResponse(res, background);
            } catch(e) {
                console.error("Config Load Error", e);
            }
        },
        
        processConfigResponse(res, background = false) {
            // Safety check - ensure res exists and isn't an error response
            if (!res || res.error || !res.config) {
                console.error("Invalid config response:", res);
                this.data = { categories: [], groups: [], apFilters: {}, bankAccountIds: [] };
                this.bankAccounts = [];
                // Still render what we can
                if (el("#cfConfigList")) this.renderList();
                if(!background) this.showEmptyState();
                return;
            }
            
            this.data = res.config;
            this.bankAccounts = res.bankAccounts || [];
            
            // Normalize groups: merge categoryGroups (legacy) into groups
            if (!this.data.groups) {
                this.data.groups = [];
            }
            if (this.data.categoryGroups && Array.isArray(this.data.categoryGroups)) {
                // Merge legacy categoryGroups into groups (avoid duplicates by id)
                const existingIds = new Set(this.data.groups.map(g => g.id));
                this.data.categoryGroups.forEach(cg => {
                    if (!existingIds.has(cg.id)) {
                        this.data.groups.push(cg);
                    }
                });
                // Remove legacy property
                delete this.data.categoryGroups;
            }
            
            // Ensure categories array exists
            if (!this.data.categories) {
                this.data.categories = [];
            }
            
            window.accountList = (res.accounts || []).sort((a, b) => parseInt(a.acctNumber) - parseInt(b.acctNumber));
            window.vendorList = res.vendors || [];
            window.bankAccountList = this.bankAccounts;

            // Always render list if data is loaded and container exists, even in background
            if (el("#cfConfigList")) this.renderList();
            
            if(!background) {
                this.showEmptyState();
            }
        },

        showEmptyState() {
            // Show nice landing page with KPI-style stats
            this.showConfigLanding();
        },

        renderList() {
            const div = el("#cfConfigList");
            if (!div) return;
            div.innerHTML = "";
            
            const addHeader = (text) => {
                const d = document.createElement("div");
                d.className = "config-header";
                d.textContent = text;
                div.appendChild(d);
            };

            addHeader("System");
            const mkFixed = (n, t, fn, typeKey) => {
                const b = document.createElement("button");
                b.className = `list-group-item list-group-item-action ${this.fixedType === typeKey ? "active-config-item" : ""}`;
                b.innerHTML = `<div><span class="font-weight-500">${n}</span></div><span class="badge ${t === "IN" ? "pill-in" : (t === "OUT" ? "pill-out" : "badge-secondary")}">${t}</span>`;
                b.onclick = fn;
                div.appendChild(b);
            };
            mkFixed("Bank Accounts", "SYS", () => this.showFixed("BANK"), "BANK");
            mkFixed("Receivables (AR)", "IN", () => this.showFixed("AR"), "AR");
            mkFixed("Payables (AP)", "OUT", () => this.showFixed("AP"), "AP");

            addHeader("Groups");
            if (this.data && this.data.groups && this.data.groups.length > 0) {
                this.data.groups.forEach((g, i) => {
                    const item = document.createElement("button");
                    item.className = `list-group-item list-group-item-action ${this.editingGroupIdx === i ? "active-config-item" : ""}`;
                    const catCount = (g.categoryIds || []).length;
                    item.innerHTML = `<div><span class="font-weight-500">${g.name}</span></div><span class="badge badge-secondary">${catCount} cats</span>`;
                    item.onclick = () => this.editGroup(i);
                    div.appendChild(item);
                });
            }
            // Add Group button
            const addGrpBtn = document.createElement("button");
            addGrpBtn.className = "list-group-item list-group-item-action text-primary small";
            addGrpBtn.innerHTML = `<i class="fas fa-plus mr-1"></i> Add Group`;
            addGrpBtn.onclick = () => this.addGroup();
            div.appendChild(addGrpBtn);

            addHeader("Categories");
            if (this.data && this.data.categories) {
                this.data.categories.forEach((c, i) => {
                    const badgeType = c.type === "inflow" ? "pill-in" : "pill-out";
                    const item = document.createElement("button");
                    item.className = `list-group-item list-group-item-action ${i === this.idx && this.fixedType === null && this.editingGroupIdx === -1 ? "active-config-item" : ""}`;
                    item.innerHTML = `<div><span class="font-weight-500">${c.name}</span></div><span class="badge ${badgeType}">${(c.type||'out').toUpperCase().substr(0,3)}</span>`;
                    item.onclick = () => this.edit(i);
                    div.appendChild(item);
                });
            }
            // Add Category button
            const addCatBtn = document.createElement("button");
            addCatBtn.className = "list-group-item list-group-item-action text-primary small";
            addCatBtn.innerHTML = `<i class="fas fa-plus mr-1"></i> Add Category`;
            addCatBtn.onclick = () => this.addCategory();
            div.appendChild(addCatBtn);
        },

        editingGroupIdx: -1,

        addGroup() {
            if (!this.data.groups) this.data.groups = [];
            this.data.groups.push({
                id: "group_" + Date.now(),
                name: "New Group",
                categoryIds: []
            });
            // Use flyout for new groups
            this.editGroupInFlyout(this.data.groups.length - 1, true);
        },

        editGroup(i) {
            // Use flyout for editing groups
            this.editGroupInFlyout(i, false);
        },

        saveGroup() {
            if (this.editingGroupIdx === -1) return;
            const g = this.data.groups[this.editingGroupIdx];
            
            g.name = el('#confGroupName').value;
            const newId = el('#confGroupId').value.trim();
            if (newId && newId !== g.id) {
                // Check for duplicate IDs
                const isDupe = this.data.groups.some((grp, idx) => idx !== this.editingGroupIdx && grp.id === newId);
                if (isDupe) {
                    alert('A group with this ID already exists');
                    return;
                }
                g.id = newId;
            }
            
            // Collect selected categories
            const selectedCats = [];
            document.querySelectorAll('.group-cat-checkbox:checked').forEach(cb => {
                selectedCats.push(cb.value);
            });
            g.categoryIds = selectedCats;
            
            this.save();
        },

        deleteGroup() {
            if (this.editingGroupIdx !== -1) {
                $('#deleteConfirmModal').modal('show');
                el('#btnConfirmDelete').onclick = () => {
                    this.data.groups.splice(this.editingGroupIdx, 1);
                    this.editingGroupIdx = -1;
                    this.renderList();
                    this.showEmptyState();
                    $('#deleteConfirmModal').modal('hide');
                    this.save();
                };
            }
        },

        showFixed(type) {
            this.idx = -1;
            this.fixedType = type;
            this.editingGroupIdx = -1;
            this.configFlyout.type = 'system';
            this.configFlyout.systemType = type;
            this.renderList();
            this.openConfigFlyout();
            this.renderSystemConfigFlyout(type);
        },

        renderSystemConfigFlyout(type) {
            const body = el('#cfConfigFlyoutBody');
            if (!body) return;

            // Update flyout title
            const titleEl = el('#cfConfigFlyoutTitle');
            const deleteBtn = el('#cfConfigFlyoutDelete');
            if (deleteBtn) deleteBtn.style.display = 'none';

            // Hide tabs for system configs
            const tabsEl = el('#cfConfigFlyoutTabs');
            if (tabsEl) tabsEl.style.display = 'none';

            if (type === 'BANK') {
                if (titleEl) titleEl.innerHTML = '<i class="fas fa-university mr-2"></i>Bank Accounts';
                this.renderBankConfigForm(body);
            } else if (type === 'AP') {
                if (titleEl) titleEl.innerHTML = '<i class="fas fa-arrow-up text-danger mr-2"></i>Accounts Payable';
                this.renderAPConfigForm(body);
            } else if (type === 'AR') {
                if (titleEl) titleEl.innerHTML = '<i class="fas fa-arrow-down text-success mr-2"></i>Accounts Receivable';
                this.renderARConfigForm(body);
            }
        },

        renderBankConfigForm(body) {
            const selectedIds = this.data.bankAccountIds || [];
            const bankList = this.bankAccounts || [];

            // Sort bank accounts: selected first, then alphabetically
            const sortedBanks = [...bankList].sort((a, b) => {
                const aSel = selectedIds.includes(a.id);
                const bSel = selectedIds.includes(b.id);
                if (aSel && !bSel) return -1;
                if (!aSel && bSel) return 1;
                return a.name.localeCompare(b.name);
            });

            const bankOptions = sortedBanks.map(b =>
                `<option value="${b.id}" ${selectedIds.includes(b.id) ? 'selected' : ''}>${b.acctNumber || ''} ${b.name} (${fmtMoney(b.balance || 0)})</option>`
            ).join('');

            body.innerHTML = `
                <div class="cf-config-flyout-form">
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Starting Cash Accounts</div>
                        <p class="small text-muted mb-3">Select the bank accounts that should be included when calculating your starting cash position. The sum of these account balances will be used as your "Current Cash" figure.</p>
                        <input type="text" class="cf-form-input mb-2" placeholder="Search accounts..."
                            onkeyup="const term=this.value.toLowerCase(); document.getElementById('cfBankAccountIds').querySelectorAll('option').forEach(o => o.style.display = o.text.toLowerCase().includes(term) ? 'block' : 'none')">
                        <select id="cfBankAccountIds" class="cf-form-select" multiple style="height: 250px; width: 100%;">
                            ${bankOptions}
                        </select>
                        <div class="cf-form-help mt-2">Hold Ctrl/Cmd to select multiple accounts. Selected accounts appear at top.</div>
                    </div>

                    <div class="cf-method-info">
                        <div class="cf-method-info-title"><i class="fas fa-info-circle mr-1"></i>Note</div>
                        <div class="cf-method-info-text">If no accounts are selected, the system will use the sum of all active Bank type accounts.</div>
                    </div>
                </div>
                <div class="cf-config-flyout-footer">
                    <div></div>
                    <button class="cf-btn cf-btn-primary" onclick="ConfigController.saveBankAccounts()">
                        <i class="fas fa-save"></i> Save Bank Accounts
                    </button>
                </div>`;
        },

        renderAPConfigForm(body) {
            const f = this.data.apFilters || {};
            const ps = this.data.predictionSettings || {};
            const overduePush = ps.overduePushDays || { light: 7, medium: 14, heavy: 28 };
            const defaultDays = ps.defaultDaysToPay || 45;
            const historyDays = ps.paymentHistoryDays || 365;

            body.innerHTML = `
                <div class="cf-config-flyout-form">
                    <!-- Algorithm Flow -->
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Payment Date Prediction</div>
                        <div class="d-flex align-items-center justify-content-between text-center mb-3" style="gap: 6px;">
                            <div class="flex-fill p-2 rounded" style="background:rgba(100,116,139,0.15);">
                                <i class="fas fa-calendar-check mb-1" style="color:#64748b;"></i>
                                <div style="font-size: 10px;" class="font-weight-bold">Expected Date</div>
                            </div>
                            <i class="fas fa-chevron-right text-muted small"></i>
                            <div class="flex-fill p-2 rounded" style="background:rgba(59,130,246,0.15);">
                                <i class="fas fa-chart-line mb-1" style="color:#3b82f6;"></i>
                                <div style="font-size: 10px;" class="font-weight-bold">Vendor History</div>
                            </div>
                            <i class="fas fa-chevron-right text-muted small"></i>
                            <div class="flex-fill p-2 rounded" style="background:rgba(139,92,246,0.15);">
                                <i class="fas fa-clock mb-1" style="color:#8b5cf6;"></i>
                                <div style="font-size: 10px;" class="font-weight-bold">Default Terms</div>
                            </div>
                            <i class="fas fa-chevron-right text-muted small"></i>
                            <div class="flex-fill p-2 rounded" style="background:rgba(16,185,129,0.15);">
                                <i class="fas fa-calendar-day mb-1" style="color:#10b981;"></i>
                                <div style="font-size: 10px;" class="font-weight-bold">Biz Day Adj</div>
                            </div>
                        </div>
                        <div class="cf-form-help">
                            <i class="fas fa-info-circle mr-1"></i>Overdue bills pushed: <strong>${overduePush.light}d</strong> (&lt;30 late), <strong>${overduePush.medium}d</strong> (&gt;30 late)
                        </div>
                    </div>

                    <!-- Capacity Controls -->
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Capacity Controls</div>
                        <div class="cf-form-row">
                            <div class="cf-form-group">
                                <label class="cf-form-label">Weekly Cash Cap</label>
                                <input type="number" class="cf-form-input" id="cfGlobalApCap" value="${f.weeklyCap||0}">
                                <div class="cf-form-help">0 = unlimited</div>
                            </div>
                            <div class="cf-form-group">
                                <label class="cf-form-label">Restrict to Safe Capacity</label>
                                <div class="custom-control custom-switch mt-2">
                                    <input type="checkbox" class="custom-control-input" id="cfGlobalApRestrictSafe" ${f.restrictToSafe?'checked':''}>
                                    <label class="custom-control-label" for="cfGlobalApRestrictSafe">Enable</label>
                                </div>
                                <div class="cf-form-help">Safe = Cash + AR - Reserve</div>
                            </div>
                        </div>
                    </div>

                    <!-- Vendor Filtering -->
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Vendor Filtering</div>
                        <div class="cf-form-row">
                            <div class="cf-form-group">
                                <label class="cf-form-label"><i class="fas fa-ban text-danger mr-1"></i>Excluded Categories</label>
                                <input type="text" class="cf-form-input" id="cfGlobalApExclude" placeholder="e.g. 7, 9" value="${(f.excludeVendorCategories||[]).join(', ')}">
                            </div>
                            <div class="cf-form-group">
                                <label class="cf-form-label"><i class="fas fa-star text-warning mr-1"></i>Priority Categories</label>
                                <input type="text" class="cf-form-input" id="cfGlobalApPriority" placeholder="e.g. 5, 3" value="${(f.priorityVendorCategories||[]).join(', ')}">
                            </div>
                        </div>
                    </div>

                    <!-- Advanced Options -->
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Advanced Options</div>
                        <div class="cf-form-row">
                            <div class="cf-form-group">
                                <label class="cf-form-label"><i class="fas fa-piggy-bank text-warning mr-1"></i>Cash Preservation</label>
                                <div class="custom-control custom-switch mt-2">
                                    <input type="checkbox" class="custom-control-input" id="cfGlobalApPreserve" ${f.preservationMode?'checked':''}>
                                    <label class="custom-control-label" for="cfGlobalApPreserve">Enable</label>
                                </div>
                                <div class="cf-form-help">Prioritize vendors, oldest bills, defer excess</div>
                            </div>
                            <div class="cf-form-group">
                                <label class="cf-form-label"><i class="fas fa-layer-group text-muted mr-1"></i>Auto-Defer Overflow</label>
                                <div class="custom-control custom-switch mt-2">
                                    <input type="checkbox" class="custom-control-input" id="cfGlobalApDefer" ${f.deferIfNegative?'checked':''}>
                                    <label class="custom-control-label" for="cfGlobalApDefer">Enable</label>
                                </div>
                                <div class="cf-form-help">Push excess bills to next week</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="cf-config-flyout-footer">
                    <div></div>
                    <button class="cf-btn cf-btn-primary" onclick="ConfigController.save()">
                        <i class="fas fa-save"></i> Save Configuration
                    </button>
                </div>`;
        },

        renderARConfigForm(body) {
            const ps = this.data.predictionSettings || {};
            const volThresh = ps.volatilityThresholds || { stable: 5, volatile: 15 };
            const overduePush = ps.overduePushDays || { light: 7, medium: 14, heavy: 28 };
            const defaultDays = ps.defaultDaysToPay || 45;
            const historyDays = ps.paymentHistoryDays || 365;

            body.innerHTML = `
                <div class="cf-config-flyout-form">
                    <!-- Algorithm Flow -->
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Collection Date Prediction</div>
                        <div class="d-flex align-items-center justify-content-between text-center mb-3" style="gap: 6px;">
                            <div class="flex-fill p-2 rounded" style="background:rgba(16,185,129,0.15);">
                                <i class="fas fa-calendar-check mb-1" style="color:#10b981;"></i>
                                <div style="font-size: 10px;" class="font-weight-bold">Manual Override</div>
                            </div>
                            <i class="fas fa-chevron-right text-muted small"></i>
                            <div class="flex-fill p-2 rounded" style="background:rgba(59,130,246,0.15);">
                                <i class="fas fa-user-clock mb-1" style="color:#3b82f6;"></i>
                                <div style="font-size: 10px;" class="font-weight-bold">Customer History</div>
                            </div>
                            <i class="fas fa-chevron-right text-muted small"></i>
                            <div class="flex-fill p-2 rounded" style="background:rgba(14,165,233,0.15);">
                                <i class="fas fa-file-contract mb-1" style="color:#0ea5e9;"></i>
                                <div style="font-size: 10px;" class="font-weight-bold">Invoice Terms</div>
                            </div>
                            <i class="fas fa-chevron-right text-muted small"></i>
                            <div class="flex-fill p-2 rounded" style="background:rgba(100,116,139,0.15);">
                                <i class="fas fa-globe mb-1" style="color:#64748b;"></i>
                                <div style="font-size: 10px;" class="font-weight-bold">Fallback: ${defaultDays}d</div>
                            </div>
                        </div>
                    </div>

                    <!-- Customer Volatility -->
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Customer Payment Volatility</div>
                        <div class="cf-form-row">
                            <div class="d-flex justify-content-between align-items-center p-2 rounded mb-2" style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3);">
                                <div><span class="badge" style="background:#10b981; color:#fff;">Stable</span> σ &lt; ${volThresh.stable}d</div>
                                <span class="text-muted small">No buffer added</span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center p-2 rounded mb-2" style="background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3);">
                                <div><span class="badge" style="background:#f59e0b; color:#fff;">Average</span> ${volThresh.stable}-${volThresh.volatile}d</div>
                                <span class="text-muted small">Small buffer</span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center p-2 rounded" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3);">
                                <div><span class="badge" style="background:#ef4444; color:#fff;">Volatile</span> σ &gt; ${volThresh.volatile}d</div>
                                <span class="text-muted small">+0.5σ buffer</span>
                            </div>
                        </div>
                    </div>

                    <!-- Overdue Handling -->
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Overdue Invoice Handling</div>
                        <div class="cf-form-row">
                            <div class="d-flex justify-content-between align-items-center p-2 rounded mb-2" style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3);">
                                <div><strong>0-30 days late</strong></div>
                                <span>+${overduePush.light} days <span class="text-muted small">(likely soon)</span></span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center p-2 rounded mb-2" style="background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3);">
                                <div><strong>31-60 days late</strong></div>
                                <span>+${overduePush.medium} days <span class="text-muted small">(needs follow-up)</span></span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center p-2 rounded" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3);">
                                <div><strong>60+ days late</strong></div>
                                <span>+${overduePush.heavy} days <span class="text-muted small">(conservative)</span></span>
                            </div>
                        </div>
                    </div>

                    <!-- Data Sources -->
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Prediction Engine Settings</div>
                        <div class="d-flex justify-content-between text-center gap-3">
                            <div class="flex-fill p-3 rounded" style="background:#f8fafc; border:1px solid #e2e8f0;">
                                <i class="fas fa-clock text-primary d-block mb-1"></i>
                                <div class="font-weight-bold">${historyDays}d</div>
                                <div style="font-size: 10px;" class="text-muted">History Window</div>
                            </div>
                            <div class="flex-fill p-3 rounded" style="background:#f8fafc; border:1px solid #e2e8f0;">
                                <i class="fas fa-calculator text-info d-block mb-1"></i>
                                <div class="font-weight-bold">Mean + σ</div>
                                <div style="font-size: 10px;" class="text-muted">Statistical Model</div>
                            </div>
                            <div class="flex-fill p-3 rounded" style="background:#f8fafc; border:1px solid #e2e8f0;">
                                <i class="fas fa-calendar-alt text-warning d-block mb-1"></i>
                                <div class="font-weight-bold">Mon-Fri</div>
                                <div style="font-size: 10px;" class="text-muted">Business Days</div>
                            </div>
                        </div>
                    </div>

                    <div class="cf-method-info" style="background:linear-gradient(135deg, rgba(16,185,129,0.1) 0%, #f8fafc 100%); border-color:#86efac;">
                        <div class="cf-method-info-title" style="color:#10b981;"><i class="fas fa-magic mr-1"></i>Fully Automated</div>
                        <div class="cf-method-info-text">No configuration required. The system learns from your historical payment data and automatically adjusts predictions.</div>
                    </div>
                </div>`;
        },
        
        edit(i) {
            // Use flyout for editing categories
            this.editCategoryInFlyout(i, false);
        },

        onMethodChange() {
            const method = el("#confMethod").value;
            const current = this.idx > -1 ? this.data.categories[this.idx] : {};
            this.renderDynamicFields({ ...current, method: method });
            this.updateMethodDescription(method);
        },

        updateMethodDescription(method) {
            const container = el('#confMethodDescription');
            if (container && STRATEGY_DEFINITIONS[method]) {
                const def = STRATEGY_DEFINITIONS[method];
                container.style.display = 'block';
                container.innerHTML = `<strong>${def.title}:</strong> ${def.text}`;
            } else if (container) {
                container.style.display = 'none';
            }
        },

        renderDynamicFields(c) {
            const container = el("#conf-extra-fields");
            container.innerHTML = "";

            // --- HELPER HTML GENERATORS ---
            const getDaySelect = (val) => {
                const days = [{k:'',v:'Distributed'},{k:'0',v:'Sunday'},{k:'1',v:'Monday'},{k:'2',v:'Tuesday'},{k:'3',v:'Wednesday'},{k:'4',v:'Thursday'},{k:'5',v:'Friday'},{k:'6',v:'Saturday'}];
                let opts = days.map(d => `<option value="${d.k}" ${String(val)===d.k?'selected':''}>${d.v}</option>`).join('');
                return `<label class="cf-label mt-2">Include Through (Day)</label><select id="field_expectedDay" class="form-control form-control-sm mb-2">${opts}</select>`;
            };
            const getCalcOpts = (hVal, hLbl, adj) => `
                <div class="row mt-2 border-top pt-2">
                    <div class="col-6"><label class="cf-label">${hLbl}</label><input id="field_history" type="number" class="form-control form-control-sm" value="${hVal}"></div>
                    <div class="col-6"><label class="cf-label">Growth/Adj %</label><div class="input-group input-group-sm"><input id="field_adjustment" type="number" step="0.1" class="form-control" value="${adj||0}"><div class="input-group-append"><span class="input-group-text">%</span></div></div></div>
                </div>`;
            
            const getVendorUi = (selectedIds) => {
                const ids = selectedIds || [];
                const sorted = [...window.vendorList].sort((a, b) => {
                    const aSel = ids.includes(a.id);
                    const bSel = ids.includes(b.id);
                    if (aSel && !bSel) return -1;
                    if (!aSel && bSel) return 1;
                    return a.name.localeCompare(b.name);
                });
                let opts = sorted.map(v => `<option value="${v.id}" ${ids.includes(v.id)?'selected':''}>${v.name}</option>`).join('');
                return `
                    <label class="cf-label">Vendors</label>
                    <input type="text" class="form-control form-control-sm mb-1" placeholder="Search vendors..." onkeyup="const term=this.value.toLowerCase(); document.getElementById('field_vendorIds').querySelectorAll('option').forEach(o => o.style.display = o.text.toLowerCase().includes(term) ? 'block' : 'none')">
                    <select id="field_vendorIds" class="form-control form-control-sm shadow-sm" multiple style="height:150px">${opts}</select>
                    <small class="text-muted d-block mb-2">*Selected vendors sort to top</small>`;
            };

            // --- STRATEGY SWITCH ---
            if(c.method === 'gl_history_average') {
                const selIds = c.accounts || [];
                const sorted = [...window.accountList].sort((a,b) => selIds.includes(b.id) - selIds.includes(a.id));
                const opts = sorted.map(a => `<option value="${a.id}" ${selIds.includes(a.id)?'selected':''}>${a.acctNumber} - ${a.name}</option>`).join('');
                
                const wks = [{k: '', v: 'Distributed'}, {k: '1', v: '1st Week (Day 1-7)'}, {k: '2', v: '2nd Week (Day 8-14)'}, {k: '3', v: '3rd Week (Day 15-21)'}, {k: '4', v: '4th Week (Day 22+)'}];
                const wkOpts = wks.map(d => `<option value="${d.k}" ${String(c.expectedWeek) === d.k ? 'selected' : ''}>${d.v}</option>`).join('');

                container.innerHTML = `
                    <label class="cf-label">Accounts</label>
                    <input type="text" class="form-control form-control-sm mb-1" placeholder="Search accounts..." onkeyup="const term=this.value.toLowerCase(); document.getElementById('field_accounts').querySelectorAll('option').forEach(o => o.style.display = o.text.toLowerCase().includes(term) ? 'block' : 'none')">
                    <select id="field_accounts" class="form-control form-control-sm shadow-sm" multiple style="height:150px">${opts}</select>
                    
                    <div class="row mt-2">
                        <div class="col-6">${getDaySelect(c.expectedDay)}</div>
                        <div class="col-6"><label class="cf-label mt-2">Expected Week</label><select id="field_expectedWeek" class="form-control form-control-sm mb-2">${wkOpts}</select></div>
                    </div>
                    <div class="custom-control custom-checkbox mt-2">
                        <input type="checkbox" class="custom-control-input" id="field_useNetAmt" ${c.useNetAmt ? 'checked' : ''}>
                        <label class="custom-control-label cf-label" for="field_useNetAmt">Use Net Amount (Respect +/-)</label>
                    </div>
                    ${getCalcOpts(c.historyWeeks || 12, 'History Weeks', c.adjustmentPercent)}
                `;
            } 
            else if(c.method === 'vendor_payment_history') {
                container.innerHTML = `
                    <label class="cf-label">Vendor Category IDs (Comma Sep)</label>
                    <input id="field_vendorCategories" class="form-control form-control-sm" value="${(c.vendorCategories||[]).join(',')}">
                    ${getDaySelect(c.expectedDay)}
                    ${getCalcOpts(c.historyMonths || 12, 'History Months', c.adjustmentPercent)}
                `;
            }
            else if(c.method === 'manual_recurring') {
                const freq = c.frequency || 'weekly';
                container.innerHTML = `
                    <div class="row"><div class="col-6"><label class="cf-label">Amount</label><input id="field_amount" class="form-control form-control-sm" type="number" value="${c.amount||0}"></div>
                    <div class="col-6"><label class="cf-label">Frequency</label><select id="field_frequency" class="form-control form-control-sm">
                        <option value="weekly" ${freq==='weekly'?'selected':''}>Weekly</option>
                        <option value="bi_weekly" ${freq==='bi_weekly'?'selected':''}>Bi-Weekly</option>
                        <option value="monthly" ${freq==='monthly'?'selected':''}>Monthly</option>
                    </select></div></div>`;
            }
            else if(c.method === 'vendor_recurring_average') {
                container.innerHTML = `
                    <div class="row"><div class="col-8">${getVendorUi(c.vendorIds)}</div>
                    <div class="col-4"><label class="cf-label">History (Mos)</label><input id="field_history" type="number" class="form-control form-control-sm" value="${c.historyMonths||3}"></div></div>
                    ${getCalcOpts(0, 'Buffer Days', c.adjustmentPercent)}
                `;
            }
            else if(c.method === 'bank_register_history') {
                const selIds = c.bankAccountIds || [];
                const sorted = [...window.accountList].sort((a,b) => selIds.includes(b.id) - selIds.includes(a.id));
                const opts = sorted.map(a => `<option value="${a.id}" ${selIds.includes(a.id)?'selected':''}>${a.acctNumber} - ${a.name}</option>`).join('');
                
                container.innerHTML = `
                    <label class="cf-label">Bank Account(s)</label>
                    <select id="field_bankAccountIds" class="form-control form-control-sm shadow-sm" multiple style="height:100px">${opts}</select>
                    <label class="cf-label mt-2">Memo Keywords</label>
                    <input id="field_memoKeywords" class="form-control form-control-sm" value="${(c.memoKeywords||[]).join(', ')}">
                    <div class="d-flex mt-2">
                        <div class="custom-control custom-checkbox mr-3"><input type="checkbox" class="custom-control-input" id="field_incTransfers" ${c.includeTransfers!==false?'checked':''}><label class="custom-control-label small" for="field_incTransfers">Transfers</label></div>
                        <div class="custom-control custom-checkbox mr-3"><input type="checkbox" class="custom-control-input" id="field_incChecks" ${c.includeChecks!==false?'checked':''}><label class="custom-control-label small" for="field_incChecks">Checks</label></div>
                        <div class="custom-control custom-checkbox"><input type="checkbox" class="custom-control-input" id="field_incJournals" ${c.includeJournals===true?'checked':''}><label class="custom-control-label small" for="field_incJournals">Journals</label></div>
                    </div>
                    ${getDaySelect(c.expectedDay)}
                    ${getCalcOpts(c.historyWeeks || 12, 'History Weeks', c.adjustmentPercent)}
                `;
            }
            else if(c.method === 'formula_expression') {
                container.innerHTML = `
                    <label class="cf-label">Formula</label>
                    <textarea id="field_formula" class="form-control form-control-sm font-monospace" rows="4">${c.formula||''}</textarea>
                    <div class="small text-muted mt-1">Vars: {AR_IN}, {AP_OUT}, {NET_FLOW}, {WEEK_NUM}, {IS_MONTH_END}</div>
                `;
            }
            else {
                container.innerHTML = `<div class="text-muted small">Standard configuration for ${c.method}</div>`;
            }
        },

        addCategory() {
            this.data.categories.push({ id: "new_" + Date.now(), name: "New Category", method: "gl_history_average", type: "outflow", accounts: [] });
            // Use flyout for new categories
            this.editCategoryInFlyout(this.data.categories.length - 1, true);
        },

        delete() {
            if(this.idx !== -1) {
                $('#deleteConfirmModal').modal('show');
                el('#btnConfirmDelete').onclick = () => {
                    this.data.categories.splice(this.idx, 1);
                    this.idx = -1;
                    this.renderList();
                    this.showEmptyState();
                    $('#deleteConfirmModal').modal('hide');
                    this.save();
                };
            }
        },

        save() {
            if(this.fixedType === 'AP') {
                const f = this.data.apFilters || {};
                const apVal = el("#cfGlobalApExclude").value;
                const apPrio = el("#cfGlobalApPriority").value;
                this.data.apFilters = {
                    excludeVendorCategories: apVal ? apVal.split(",").map(s=>s.trim()).filter(s=>s) : [],
                    weeklyCap: parseFloat(el("#cfGlobalApCap").value) || 0,
                    deferIfNegative: el("#cfGlobalApDefer").checked,
                    preservationMode: el("#cfGlobalApPreserve").checked,
                    priorityVendorCategories: apPrio ? apPrio.split(",").map(s=>s.trim()).filter(s=>s) : [],
                    restrictToSafe: el("#cfGlobalApRestrictSafe").checked
                };
            } else if(this.fixedType === 'BANK') {
                // Bank accounts are saved via saveBankAccounts() which calls save()
                // Data already updated before this call
            } else if(this.idx !== -1) {
                const c = this.data.categories[this.idx];
                const oldId = c.id;
                c.name = el('#confName').value;
                c.type = el('#confType').value;
                c.method = el('#confMethod').value;
                
                // Handle internal ID change
                const newIdEl = el('#confId');
                if (newIdEl) {
                    const newId = newIdEl.value.trim();
                    if (newId && newId !== oldId) {
                        // Check for duplicate IDs
                        const isDupe = this.data.categories.some((cat, idx) => idx !== this.idx && cat.id === newId);
                        if (isDupe) {
                            alert('A category with this ID already exists');
                            return;
                        }
                        // Update group references
                        if (this.data.groups) {
                            this.data.groups.forEach(g => {
                                const idx = (g.categoryIds || []).indexOf(oldId);
                                if (idx !== -1) {
                                    g.categoryIds[idx] = newId;
                                }
                            });
                        }
                        c.id = newId;
                    }
                }
                
                const acc = el("#field_accounts");
                if (acc) c.accounts = Array.from(acc.selectedOptions).map(o => o.value);
                const vc = el("#field_vendorCategories");
                if (vc) c.vendorCategories = vc.value.split(",").map(s => s.trim()).filter(s => s);
                const vid = el("#field_vendorIds");
                if (vid) c.vendorIds = Array.from(vid.selectedOptions).map(o => o.value);
                
                const day = el("#field_expectedDay");
                if (day) c.expectedDay = day.value;
                const wk = el("#field_expectedWeek");
                if (wk) c.expectedWeek = wk.value;
                
                const hist = el("#field_history");
                if (hist) {
                    if(c.method.includes('month') || c.method === 'vendor_recurring_average') c.historyMonths = parseInt(hist.value);
                    else c.historyWeeks = parseInt(hist.value);
                }
                
                const adj = el("#field_adjustment");
                if (adj) c.adjustmentPercent = parseFloat(adj.value);
                
                const net = el("#field_useNetAmt");
                if (net) c.useNetAmt = net.checked;
                
                const amt = el("#field_amount");
                if (amt) c.amount = parseFloat(amt.value);
                const freq = el("#field_frequency");
                if (freq) c.frequency = freq.value;
                
                const form = el("#field_formula");
                if (form) c.formula = form.value;
                
                const bIds = el("#field_bankAccountIds");
                if (bIds) c.bankAccountIds = Array.from(bIds.selectedOptions).map(o => o.value);
                const memos = el("#field_memoKeywords");
                if (memos) c.memoKeywords = memos.value.split(',').map(s=>s.trim()).filter(s=>s);
                const iTrn = el("#field_incTransfers");
                if(iTrn) c.includeTransfers = iTrn.checked;
                const iChk = el("#field_incChecks");
                if(iChk) c.includeChecks = iChk.checked;
                const iJrn = el("#field_incJournals");
                if(iJrn) c.includeJournals = iJrn.checked;
            }

            // Clean up legacy categoryGroups - always use groups
            if (this.data.categoryGroups) {
                delete this.data.categoryGroups;
            }

            const configName = CashflowController.getConfigName();
            API.post('save_config', { config: this.data, configName: configName }).then(res => {
                if(res.status === 'success') {
                    showToast("Configuration Saved");
                    this.renderList();
                    CashflowController.loadData();
                } else {
                    alert('Error saving: ' + res.message);
                }
            });
        },
        
        saveBankAccounts() {
            const bankEl = el("#cfBankAccountIds");
            if (bankEl) {
                this.data.bankAccountIds = Array.from(bankEl.selectedOptions).map(o => o.value);
            }
            this.save();
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // CONFIGURATION FLYOUT SYSTEM
        // ═══════════════════════════════════════════════════════════════════════════

        configFlyout: {
            open: false,
            type: null, // 'category' or 'group'
            isNew: false,
            activeTab: 'details'
        },

        openConfigFlyout() {
            this.configFlyout.open = true;
            const overlay = el('#cfConfigFlyoutOverlay');
            const panel = el('#cfConfigFlyoutPanel');
            if (overlay) overlay.classList.add('open');
            if (panel) panel.classList.add('open');
            document.body.style.overflow = 'hidden';

            // Keyboard escape to close
            this._flyoutEscHandler = (e) => {
                if (e.key === 'Escape' && this.configFlyout.open) {
                    this.closeConfigFlyout();
                }
            };
            document.addEventListener('keydown', this._flyoutEscHandler);
        },

        closeConfigFlyout() {
            // If closing a new unsaved group, remove it from the data
            if (this.configFlyout.isNew && this.configFlyout.type === 'group' && this.editingGroupIdx !== -1) {
                this.data.groups.splice(this.editingGroupIdx, 1);
                this.editingGroupIdx = -1;
            }
            // If closing a new unsaved category, remove it from the data
            if (this.configFlyout.isNew && this.configFlyout.type === 'category' && this.idx !== -1) {
                this.data.categories.splice(this.idx, 1);
                this.idx = -1;
            }

            this.configFlyout.open = false;
            this.configFlyout.type = null;
            this.configFlyout.isNew = false;
            const overlay = el('#cfConfigFlyoutOverlay');
            const panel = el('#cfConfigFlyoutPanel');
            if (overlay) overlay.classList.remove('open');
            if (panel) panel.classList.remove('open');
            document.body.style.overflow = '';

            if (this._flyoutEscHandler) {
                document.removeEventListener('keydown', this._flyoutEscHandler);
            }

            // Refresh sidebar list and show landing content
            this.renderList();
            this.showConfigLanding();
        },

        showConfigLanding() {
            const container = el('#cfConfigContainer');
            if (!container) return;

            const catCount = this.data && this.data.categories ? this.data.categories.length : 0;
            const grpCount = this.data && this.data.groups ? this.data.groups.length : 0;
            const bankCount = this.data && this.data.bankAccountIds ? this.data.bankAccountIds.length : 0;

            // Count inflows vs outflows
            let inflowCount = 0, outflowCount = 0;
            if (this.data && this.data.categories) {
                this.data.categories.forEach(c => {
                    if (c.type === 'inflow') inflowCount++;
                    else outflowCount++;
                });
            }

            container.innerHTML = `
                <div class="cf-config-landing">
                    <div class="landing-icon">
                        <i class="fas fa-sliders-h"></i>
                    </div>
                    <div class="landing-title">Cashflow Configuration</div>
                    <div class="landing-text">Select an item from the sidebar to view or edit its settings</div>

                    <div class="cf-category-kpi-row" style="max-width:700px; margin:24px auto 0;">
                        <div class="cf-category-kpi" onclick="ConfigController.showFixed('BANK')" style="cursor:pointer;">
                            <div class="kpi-icon" style="background:rgba(59,130,246,0.12);">
                                <i class="fas fa-university" style="color:#3b82f6;"></i>
                            </div>
                            <div class="kpi-content">
                                <div class="kpi-label">Bank Accounts</div>
                                <div class="kpi-value">${bankCount}</div>
                            </div>
                            <i class="fas fa-chevron-right text-muted" style="font-size:12px;"></i>
                        </div>
                        <div class="cf-category-kpi" style="cursor:default;">
                            <div class="kpi-icon" style="background:rgba(139,92,246,0.12);">
                                <i class="fas fa-layer-group" style="color:#8b5cf6;"></i>
                            </div>
                            <div class="kpi-content">
                                <div class="kpi-label">Categories</div>
                                <div class="kpi-value">${catCount}</div>
                            </div>
                            <div style="font-size:10px; color:#94a3b8;">
                                <span class="text-success">${inflowCount} in</span> /
                                <span class="text-danger">${outflowCount} out</span>
                            </div>
                        </div>
                        <div class="cf-category-kpi" style="cursor:default;">
                            <div class="kpi-icon" style="background:rgba(16,185,129,0.12);">
                                <i class="fas fa-object-group" style="color:#10b981;"></i>
                            </div>
                            <div class="kpi-content">
                                <div class="kpi-label">Groups</div>
                                <div class="kpi-value">${grpCount}</div>
                            </div>
                        </div>
                    </div>

                    <div style="margin-top:32px; padding-top:24px; border-top:1px solid #e2e8f0;">
                        <div style="font-size:12px; color:#64748b; margin-bottom:12px;">Quick Actions</div>
                        <div style="display:flex; gap:12px; justify-content:center;">
                            <button class="cf-btn cf-btn-secondary" onclick="ConfigController.showFixed('BANK')">
                                <i class="fas fa-university"></i> Bank Accounts
                            </button>
                            <button class="cf-btn cf-btn-secondary" onclick="ConfigController.showFixed('AR')">
                                <i class="fas fa-arrow-down text-success"></i> AR Settings
                            </button>
                            <button class="cf-btn cf-btn-secondary" onclick="ConfigController.showFixed('AP')">
                                <i class="fas fa-arrow-up text-danger"></i> AP Settings
                            </button>
                            <button class="cf-btn cf-btn-primary" onclick="ConfigController.addCategory()">
                                <i class="fas fa-plus"></i> New Category
                            </button>
                        </div>
                    </div>
                </div>`;
        },

        switchConfigFlyoutTab(tab) {
            this.configFlyout.activeTab = tab;

            // Update tab UI
            document.querySelectorAll('.cf-flyout-config-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tab === tab);
            });

            // Show/hide content based on tab
            const previewPane = el('#cfConfigFlyoutPreview');
            const detailsPane = el('#cfConfigFlyoutDetails');

            if (tab === 'preview' && previewPane) {
                if (detailsPane) detailsPane.style.display = 'none';
                previewPane.style.display = 'block';
                this.renderConfigPreview();
            } else {
                if (previewPane) previewPane.style.display = 'none';
                if (detailsPane) detailsPane.style.display = 'block';
            }
        },

        renderConfigPreview() {
            const previewPane = el('#cfConfigFlyoutPreview');
            if (!previewPane) return;

            if (this.configFlyout.type === 'category' && this.idx !== -1) {
                const c = this.data.categories[this.idx];
                previewPane.innerHTML = `
                    <div class="cf-config-flyout-form">
                        <div class="cf-form-section">
                            <div class="cf-form-section-header">Preview</div>
                            <p class="text-muted small">Save the category to see forecast preview data.</p>
                        </div>
                    </div>`;
            } else {
                previewPane.innerHTML = `
                    <div class="cf-config-flyout-form">
                        <div class="text-muted text-center p-4">Preview not available</div>
                    </div>`;
            }
        },

        editCategoryInFlyout(i, isNew = false) {
            this.idx = i;
            this.fixedType = null;
            this.editingGroupIdx = -1;
            this.configFlyout.type = 'category';
            this.configFlyout.isNew = isNew;
            this.configFlyout.activeTab = 'details';
            this.renderList();
            this.openConfigFlyout();

            const c = this.data.categories[i];
            const typeClass = c.type === 'inflow' ? 'inflow' : 'outflow';
            const typeLabel = c.type === 'inflow' ? 'Inflow' : 'Outflow';

            // Set flyout title
            el('#cfConfigFlyoutTitle').innerHTML = `
                <i class="fas fa-chart-line mr-2"></i>${isNew ? 'New Category' : 'Edit Category'}
                <span class="cf-type-badge ${typeClass} ml-2" style="font-size:10px;">${typeLabel}</span>`;

            // Show/hide tabs
            el('#cfConfigFlyoutTabs').style.display = 'none'; // Hide tabs for now - can enable later

            // Update delete button visibility
            const deleteBtn = el('#cfConfigFlyoutDelete');
            if (deleteBtn) deleteBtn.style.display = isNew ? 'none' : 'inline-flex';

            // Render form
            this.renderCategoryFlyoutForm(c);
        },

        renderCategoryFlyoutForm(c) {
            const body = el('#cfConfigFlyoutBody');
            if (!body) return;

            // Method descriptions
            const methodDescriptions = {
                'gl_history_average': 'Analyzes GL account postings over a defined period to calculate weekly averages',
                'vendor_payment_history': 'Aggregates historical payments to vendors by category to project future spend',
                'credit_card_cycle': 'Tracks credit card liability + projected growth until payment date',
                'manual_recurring': 'Fixed amount at specified frequency (weekly, bi-weekly, monthly)',
                'formula_expression': 'Custom formula using Excel-style syntax with category references',
                'vendor_recurring_average': 'Auto-detects payment frequency and calculates run rate from vendor history',
                'bank_register_history': 'Forecasts from actual bank account cash movements'
            };

            const methodDesc = methodDescriptions[c.method] || 'Standard projection method';

            body.innerHTML = `
                <div class="cf-config-flyout-form" id="cfConfigFlyoutDetails">
                    <!-- General Section -->
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">General</div>
                        <div class="cf-form-row">
                            <div class="cf-form-group">
                                <label class="cf-form-label">Name</label>
                                <input id="confName" class="cf-form-input" value="${escapeHtml(c.name)}">
                            </div>
                            <div class="cf-form-group">
                                <label class="cf-form-label">Internal ID</label>
                                <input id="confId" class="cf-form-input" value="${escapeHtml(c.id)}">
                                <div class="cf-form-help">Unique identifier for references</div>
                            </div>
                        </div>
                        <div class="cf-form-row single">
                            <div class="cf-form-group">
                                <label class="cf-form-label">Type</label>
                                <select id="confType" class="cf-form-select">
                                    <option value="outflow" ${c.type === 'outflow' ? 'selected' : ''}>Outflow (Expense/Payment)</option>
                                    <option value="inflow" ${c.type === 'inflow' ? 'selected' : ''}>Inflow (Revenue/Collection)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Method Section -->
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Calculation Method</div>
                        <div class="cf-form-row single">
                            <div class="cf-form-group">
                                <label class="cf-form-label">Method</label>
                                <select id="confMethod" class="cf-form-select" onchange="ConfigController.onFlyoutMethodChange()">
                                    <option value="gl_history_average" ${c.method === 'gl_history_average' ? 'selected' : ''}>GL History Average</option>
                                    <option value="vendor_payment_history" ${c.method === 'vendor_payment_history' ? 'selected' : ''}>Vendor Payment History</option>
                                    <option value="credit_card_cycle" ${c.method === 'credit_card_cycle' ? 'selected' : ''}>Credit Card Cycle</option>
                                    <option value="manual_recurring" ${c.method === 'manual_recurring' ? 'selected' : ''}>Manual Recurring</option>
                                    <option value="formula_expression" ${c.method === 'formula_expression' ? 'selected' : ''}>Formula Expression</option>
                                    <option value="vendor_recurring_average" ${c.method === 'vendor_recurring_average' ? 'selected' : ''}>Vendor Recurring (Auto)</option>
                                    <option value="bank_register_history" ${c.method === 'bank_register_history' ? 'selected' : ''}>Bank Register History</option>
                                </select>
                            </div>
                        </div>
                        <div class="cf-method-info" id="confMethodInfo">
                            <div class="cf-method-info-title">${this.getMethodTitle(c.method)}</div>
                            <div class="cf-method-info-text">${methodDesc}</div>
                        </div>
                    </div>

                    <!-- Dynamic Fields Section -->
                    <div class="cf-form-section" id="conf-flyout-extra-fields">
                        <!-- Dynamic fields rendered here -->
                    </div>
                </div>
                <div id="cfConfigFlyoutPreview" style="display:none;"></div>`;

            // Render dynamic fields based on method
            this.renderFlyoutDynamicFields(c);
        },

        getMethodTitle(method) {
            const titles = {
                'gl_history_average': 'GL History Average',
                'vendor_payment_history': 'Vendor Payment History',
                'credit_card_cycle': 'Credit Card Cycle',
                'manual_recurring': 'Manual Recurring',
                'formula_expression': 'Formula Expression',
                'vendor_recurring_average': 'Vendor Recurring (Auto)',
                'bank_register_history': 'Bank Register History'
            };
            return titles[method] || method;
        },

        onFlyoutMethodChange() {
            const method = el("#confMethod").value;
            const current = this.idx > -1 ? this.data.categories[this.idx] : {};

            // Update method info
            const methodDescriptions = {
                'gl_history_average': 'Analyzes GL account postings over a defined period to calculate weekly averages',
                'vendor_payment_history': 'Aggregates historical payments to vendors by category to project future spend',
                'credit_card_cycle': 'Tracks credit card liability + projected growth until payment date',
                'manual_recurring': 'Fixed amount at specified frequency (weekly, bi-weekly, monthly)',
                'formula_expression': 'Custom formula using Excel-style syntax with category references',
                'vendor_recurring_average': 'Auto-detects payment frequency and calculates run rate from vendor history',
                'bank_register_history': 'Forecasts from actual bank account cash movements'
            };

            const infoEl = el('#confMethodInfo');
            if (infoEl) {
                infoEl.innerHTML = `
                    <div class="cf-method-info-title">${this.getMethodTitle(method)}</div>
                    <div class="cf-method-info-text">${methodDescriptions[method] || ''}</div>`;
            }

            // Re-render dynamic fields
            this.renderFlyoutDynamicFields({ ...current, method: method });
        },

        renderFlyoutDynamicFields(c) {
            const container = el("#conf-flyout-extra-fields");
            if (!container) return;

            container.innerHTML = '<div class="cf-form-section-header">Method Settings</div>';

            // Helper for day select
            const getDaySelect = (val) => {
                const days = [{ k: '', v: 'Distributed' }, { k: '0', v: 'Sunday' }, { k: '1', v: 'Monday' }, { k: '2', v: 'Tuesday' }, { k: '3', v: 'Wednesday' }, { k: '4', v: 'Thursday' }, { k: '5', v: 'Friday' }, { k: '6', v: 'Saturday' }];
                let opts = days.map(d => `<option value="${d.k}" ${String(val) === d.k ? 'selected' : ''}>${d.v}</option>`).join('');
                return `<select id="field_expectedDay" class="cf-form-select">${opts}</select>`;
            };

            if (c.method === 'gl_history_average') {
                const selIds = c.accounts || [];
                const sorted = [...(window.accountList || [])].sort((a, b) => selIds.includes(b.id) - selIds.includes(a.id));
                const opts = sorted.map(a => `<option value="${a.id}" ${selIds.includes(a.id) ? 'selected' : ''}>${a.acctNumber} - ${a.name}</option>`).join('');

                const wks = [{ k: '', v: 'Distributed' }, { k: '1', v: '1st Week' }, { k: '2', v: '2nd Week' }, { k: '3', v: '3rd Week' }, { k: '4', v: '4th Week' }];
                const wkOpts = wks.map(d => `<option value="${d.k}" ${String(c.expectedWeek) === d.k ? 'selected' : ''}>${d.v}</option>`).join('');

                container.innerHTML += `
                    <div class="cf-form-row single">
                        <div class="cf-form-group">
                            <label class="cf-form-label">GL Accounts</label>
                            <input type="text" class="cf-form-input mb-2" placeholder="Search accounts..." onkeyup="const t=this.value.toLowerCase();document.getElementById('field_accounts').querySelectorAll('option').forEach(o=>o.style.display=o.text.toLowerCase().includes(t)?'':'none')">
                            <div class="cf-form-multiselect">
                                <select id="field_accounts" class="cf-form-select" multiple style="height:150px;border:none;">${opts}</select>
                            </div>
                        </div>
                    </div>
                    <div class="cf-form-row">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Expected Day</label>
                            ${getDaySelect(c.expectedDay)}
                        </div>
                        <div class="cf-form-group">
                            <label class="cf-form-label">Expected Week</label>
                            <select id="field_expectedWeek" class="cf-form-select">${wkOpts}</select>
                        </div>
                    </div>
                    <div class="cf-form-row">
                        <div class="cf-form-group">
                            <label class="cf-form-label">History Weeks</label>
                            <input id="field_history" type="number" class="cf-form-input" value="${c.historyWeeks || 12}">
                        </div>
                        <div class="cf-form-group">
                            <label class="cf-form-label">Adjustment %</label>
                            <input id="field_adjustment" type="number" step="0.1" class="cf-form-input" value="${c.adjustmentPercent || 0}">
                        </div>
                    </div>
                    <div class="cf-form-row single">
                        <div class="cf-form-group">
                            <label class="cf-form-label" style="display:flex;align-items:center;gap:8px;">
                                <input type="checkbox" id="field_useNetAmt" ${c.useNetAmt ? 'checked' : ''}>
                                Use Net Amount (Respect +/-)
                            </label>
                        </div>
                    </div>`;
            }
            else if (c.method === 'vendor_payment_history') {
                container.innerHTML += `
                    <div class="cf-form-row single">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Vendor Category IDs</label>
                            <input id="field_vendorCategories" class="cf-form-input" value="${(c.vendorCategories || []).join(',')}">
                            <div class="cf-form-help">Comma-separated NetSuite vendor category IDs</div>
                        </div>
                    </div>
                    <div class="cf-form-row">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Expected Day</label>
                            ${getDaySelect(c.expectedDay)}
                        </div>
                        <div class="cf-form-group">
                            <label class="cf-form-label">History Months</label>
                            <input id="field_history" type="number" class="cf-form-input" value="${c.historyMonths || 12}">
                        </div>
                    </div>
                    <div class="cf-form-row single">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Adjustment %</label>
                            <input id="field_adjustment" type="number" step="0.1" class="cf-form-input" value="${c.adjustmentPercent || 0}">
                        </div>
                    </div>`;
            }
            else if (c.method === 'manual_recurring') {
                const freq = c.frequency || 'weekly';
                container.innerHTML += `
                    <div class="cf-form-row">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Amount</label>
                            <input id="field_amount" type="number" class="cf-form-input" value="${c.amount || 0}">
                        </div>
                        <div class="cf-form-group">
                            <label class="cf-form-label">Frequency</label>
                            <select id="field_frequency" class="cf-form-select">
                                <option value="weekly" ${freq === 'weekly' ? 'selected' : ''}>Weekly</option>
                                <option value="bi_weekly" ${freq === 'bi_weekly' ? 'selected' : ''}>Bi-Weekly</option>
                                <option value="monthly" ${freq === 'monthly' ? 'selected' : ''}>Monthly</option>
                            </select>
                        </div>
                    </div>`;
            }
            else if (c.method === 'vendor_recurring_average') {
                const selIds = c.vendorIds || [];
                const sorted = [...(window.vendorList || [])].sort((a, b) => {
                    const aSel = selIds.includes(a.id);
                    const bSel = selIds.includes(b.id);
                    if (aSel && !bSel) return -1;
                    if (!aSel && bSel) return 1;
                    return a.name.localeCompare(b.name);
                });
                const opts = sorted.map(v => `<option value="${v.id}" ${selIds.includes(v.id) ? 'selected' : ''}>${v.name}</option>`).join('');

                container.innerHTML += `
                    <div class="cf-form-row single">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Vendors</label>
                            <input type="text" class="cf-form-input mb-2" placeholder="Search vendors..." onkeyup="const t=this.value.toLowerCase();document.getElementById('field_vendorIds').querySelectorAll('option').forEach(o=>o.style.display=o.text.toLowerCase().includes(t)?'':'none')">
                            <select id="field_vendorIds" class="cf-form-select" multiple style="height:150px;">${opts}</select>
                        </div>
                    </div>
                    <div class="cf-form-row">
                        <div class="cf-form-group">
                            <label class="cf-form-label">History Months</label>
                            <input id="field_history" type="number" class="cf-form-input" value="${c.historyMonths || 3}">
                        </div>
                        <div class="cf-form-group">
                            <label class="cf-form-label">Buffer Days</label>
                            <input id="field_adjustment" type="number" class="cf-form-input" value="${c.adjustmentPercent || 0}">
                        </div>
                    </div>`;
            }
            else if (c.method === 'bank_register_history') {
                const selIds = c.bankAccountIds || [];
                const bankOpts = (window.bankAccountList || []).map(b =>
                    `<option value="${b.id}" ${selIds.includes(b.id) ? 'selected' : ''}>${b.name}</option>`
                ).join('');

                container.innerHTML += `
                    <div class="cf-form-row single">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Bank Accounts</label>
                            <select id="field_bankAccountIds" class="cf-form-select" multiple style="height:100px;">${bankOpts}</select>
                        </div>
                    </div>
                    <div class="cf-form-row single">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Memo Keywords</label>
                            <input id="field_memoKeywords" class="cf-form-input" value="${(c.memoKeywords || []).join(', ')}">
                            <div class="cf-form-help">Comma-separated keywords to filter transactions</div>
                        </div>
                    </div>
                    <div class="cf-form-row">
                        <label class="cf-form-label mr-3"><input type="checkbox" id="field_incTransfers" ${c.includeTransfers !== false ? 'checked' : ''}> Transfers</label>
                        <label class="cf-form-label mr-3"><input type="checkbox" id="field_incChecks" ${c.includeChecks !== false ? 'checked' : ''}> Checks</label>
                        <label class="cf-form-label"><input type="checkbox" id="field_incJournals" ${c.includeJournals === true ? 'checked' : ''}> Journals</label>
                    </div>
                    <div class="cf-form-row">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Expected Day</label>
                            ${getDaySelect(c.expectedDay)}
                        </div>
                        <div class="cf-form-group">
                            <label class="cf-form-label">History Weeks</label>
                            <input id="field_history" type="number" class="cf-form-input" value="${c.historyWeeks || 12}">
                        </div>
                    </div>
                    <div class="cf-form-row single">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Adjustment %</label>
                            <input id="field_adjustment" type="number" step="0.1" class="cf-form-input" value="${c.adjustmentPercent || 0}">
                        </div>
                    </div>`;
            }
            else if (c.method === 'formula_expression') {
                container.innerHTML += `
                    <div class="cf-form-row single">
                        <div class="cf-form-group">
                            <label class="cf-form-label">Formula</label>
                            <textarea id="field_formula" class="cf-form-input" rows="4" style="font-family:monospace;">${c.formula || ''}</textarea>
                            <div class="cf-form-help">Variables: {AR_IN}, {AP_OUT}, {NET_FLOW}, {WEEK_NUM}, {IS_MONTH_END}</div>
                        </div>
                    </div>`;
            }
            else {
                container.innerHTML += `<div class="text-muted small">Standard configuration for this method</div>`;
            }
        },

        editGroupInFlyout(i, isNew = false) {
            this.idx = -1;
            this.fixedType = null;
            this.editingGroupIdx = i;
            this.configFlyout.type = 'group';
            this.configFlyout.isNew = isNew;
            this.renderList();
            this.openConfigFlyout();

            const g = this.data.groups[i];

            // Set flyout title
            el('#cfConfigFlyoutTitle').innerHTML = `<i class="fas fa-layer-group mr-2"></i>${isNew ? 'New Group' : 'Edit Group'}`;

            // Hide tabs for groups
            el('#cfConfigFlyoutTabs').style.display = 'none';

            // Update delete button visibility
            const deleteBtn = el('#cfConfigFlyoutDelete');
            if (deleteBtn) deleteBtn.style.display = isNew ? 'none' : 'inline-flex';

            // Render group form
            this.renderGroupFlyoutForm(g);
        },

        renderGroupFlyoutForm(g) {
            const body = el('#cfConfigFlyoutBody');
            if (!body) return;

            // Build category checkboxes
            const cats = this.data.categories || [];
            const selectedIds = g.categoryIds || [];
            let catCheckboxes = '';

            cats.forEach(c => {
                const checked = selectedIds.includes(c.id) ? 'checked' : '';
                const typeClass = c.type === 'inflow' ? 'inflow' : 'outflow';
                catCheckboxes += `
                    <div class="cf-form-multiselect-item">
                        <input type="checkbox" class="group-cat-checkbox" id="grpcat_${c.id}" value="${c.id}" ${checked}>
                        <label for="grpcat_${c.id}" style="flex:1;margin:0;cursor:pointer;">${escapeHtml(c.name)}</label>
                        <span class="cf-type-badge ${typeClass}" style="font-size:9px;">${c.type === 'inflow' ? 'IN' : 'OUT'}</span>
                    </div>`;
            });

            if (cats.length === 0) {
                catCheckboxes = '<div class="text-muted small p-3">No categories defined yet. Create categories first.</div>';
            }

            body.innerHTML = `
                <div class="cf-config-flyout-form">
                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Group Settings</div>
                        <div class="cf-form-row">
                            <div class="cf-form-group">
                                <label class="cf-form-label">Group Name</label>
                                <input id="confGroupName" class="cf-form-input" value="${escapeHtml(g.name)}">
                            </div>
                            <div class="cf-form-group">
                                <label class="cf-form-label">Internal ID</label>
                                <input id="confGroupId" class="cf-form-input" value="${escapeHtml(g.id)}">
                                <div class="cf-form-help">Unique identifier</div>
                            </div>
                        </div>
                    </div>

                    <div class="cf-form-section">
                        <div class="cf-form-section-header">Categories in Group</div>
                        <div class="cf-form-multiselect" style="max-height:300px;">
                            ${catCheckboxes}
                        </div>
                    </div>
                </div>`;
        },

        saveFromFlyout() {
            if (this.configFlyout.type === 'category') {
                this.saveCategoryFromFlyout();
            } else if (this.configFlyout.type === 'group') {
                this.saveGroupFromFlyout();
            }
        },

        saveCategoryFromFlyout() {
            if (this.idx === -1) return;

            const c = this.data.categories[this.idx];
            const oldId = c.id;

            c.name = el('#confName').value;
            c.type = el('#confType').value;
            c.method = el('#confMethod').value;

            // Handle ID change
            const newIdEl = el('#confId');
            if (newIdEl) {
                const newId = newIdEl.value.trim();
                if (newId && newId !== oldId) {
                    const isDupe = this.data.categories.some((cat, idx) => idx !== this.idx && cat.id === newId);
                    if (isDupe) {
                        alert('A category with this ID already exists');
                        return;
                    }
                    // Update group references
                    if (this.data.groups) {
                        this.data.groups.forEach(g => {
                            const idx = (g.categoryIds || []).indexOf(oldId);
                            if (idx !== -1) {
                                g.categoryIds[idx] = newId;
                            }
                        });
                    }
                    c.id = newId;
                }
            }

            // Collect dynamic fields
            const acc = el("#field_accounts");
            if (acc) c.accounts = Array.from(acc.selectedOptions).map(o => o.value);
            const vc = el("#field_vendorCategories");
            if (vc) c.vendorCategories = vc.value.split(",").map(s => s.trim()).filter(s => s);
            const vid = el("#field_vendorIds");
            if (vid) c.vendorIds = Array.from(vid.selectedOptions).map(o => o.value);

            const day = el("#field_expectedDay");
            if (day) c.expectedDay = day.value;
            const wk = el("#field_expectedWeek");
            if (wk) c.expectedWeek = wk.value;

            const hist = el("#field_history");
            if (hist) {
                if (c.method.includes('month') || c.method === 'vendor_recurring_average') c.historyMonths = parseInt(hist.value);
                else c.historyWeeks = parseInt(hist.value);
            }

            const adj = el("#field_adjustment");
            if (adj) c.adjustmentPercent = parseFloat(adj.value);

            const net = el("#field_useNetAmt");
            if (net) c.useNetAmt = net.checked;

            const amt = el("#field_amount");
            if (amt) c.amount = parseFloat(amt.value);
            const freq = el("#field_frequency");
            if (freq) c.frequency = freq.value;

            const form = el("#field_formula");
            if (form) c.formula = form.value;

            const bIds = el("#field_bankAccountIds");
            if (bIds) c.bankAccountIds = Array.from(bIds.selectedOptions).map(o => o.value);
            const memos = el("#field_memoKeywords");
            if (memos) c.memoKeywords = memos.value.split(',').map(s => s.trim()).filter(s => s);
            const iTrn = el("#field_incTransfers");
            if (iTrn) c.includeTransfers = iTrn.checked;
            const iChk = el("#field_incChecks");
            if (iChk) c.includeChecks = iChk.checked;
            const iJrn = el("#field_incJournals");
            if (iJrn) c.includeJournals = iJrn.checked;

            // Save and close
            const configName = CashflowController.getConfigName();
            API.post('save_config', { config: this.data, configName: configName }).then(res => {
                if (res.status === 'success') {
                    showToast("Category Saved");
                    this.renderList();
                    this.closeConfigFlyout();
                    CashflowController.loadData();
                } else {
                    alert('Error saving: ' + res.message);
                }
            });
        },

        saveGroupFromFlyout() {
            if (this.editingGroupIdx === -1) return;

            const g = this.data.groups[this.editingGroupIdx];

            g.name = el('#confGroupName').value;
            const newId = el('#confGroupId').value.trim();
            if (newId && newId !== g.id) {
                const isDupe = this.data.groups.some((grp, idx) => idx !== this.editingGroupIdx && grp.id === newId);
                if (isDupe) {
                    alert('A group with this ID already exists');
                    return;
                }
                g.id = newId;
            }

            // Collect selected categories
            const selectedCats = [];
            document.querySelectorAll('.group-cat-checkbox:checked').forEach(cb => {
                selectedCats.push(cb.value);
            });
            g.categoryIds = selectedCats;

            // Save and close
            const configName = CashflowController.getConfigName();
            API.post('save_config', { config: this.data, configName: configName }).then(res => {
                if (res.status === 'success') {
                    showToast("Group Saved");
                    this.renderList();
                    this.closeConfigFlyout();
                    CashflowController.loadData();
                } else {
                    alert('Error saving: ' + res.message);
                }
            });
        },

        deleteFromFlyout() {
            if (this.configFlyout.type === 'category' && this.idx !== -1) {
                $('#deleteConfirmModal').modal('show');
                el('#btnConfirmDelete').onclick = () => {
                    this.data.categories.splice(this.idx, 1);
                    this.idx = -1;
                    this.renderList();
                    this.closeConfigFlyout();
                    $('#deleteConfirmModal').modal('hide');
                    this.save();
                };
            } else if (this.configFlyout.type === 'group' && this.editingGroupIdx !== -1) {
                $('#deleteConfirmModal').modal('show');
                el('#btnConfirmDelete').onclick = () => {
                    this.data.groups.splice(this.editingGroupIdx, 1);
                    this.editingGroupIdx = -1;
                    this.renderList();
                    this.closeConfigFlyout();
                    $('#deleteConfirmModal').modal('hide');
                    this.save();
                };
            }
        }
    };


    // ==========================================
    // HELPER FUNCTIONS
    // ==========================================
    
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ==========================================
    // EXPOSE & REGISTER
    // ==========================================
    window.CashflowController = CashflowController;
    window.ConfigController = ConfigController;
    
    // Register routes
    Router.register('cashflow', () => CashflowController.init());
    Router.register('config', () => ConfigController.init());

    console.log('[Dashboard.Cashflow] World-Class Flyout Version Loaded');

})(window);