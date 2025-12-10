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
            el('#gantry-view-container').innerHTML = el('#tpl-cashflow').innerHTML;
            
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
            let lowestCash = co.cash.startingCash;
            let lowestWeek = 'Start';
            if (co.weeklyCash && co.weeklyCash.length > 0) {
                co.weeklyCash.forEach(w => {
                    if (w.endingCash < lowestCash) {
                        lowestCash = w.endingCash;
                        lowestWeek = w.weekStart;
                    }
                });
            }
            
            const lowestEl = el("#CF_LowestCash");
            const lowestDateEl = el("#CF_LowestCashDate");
            const lowestCard = el("#cfLowestCashCard");
            if (lowestEl) {
                lowestEl.textContent = fmtMoney(lowestCash);
                lowestEl.className = lowestCash < 0 ? 'kpi-value text-danger' : 'kpi-value';
            }
            if (lowestDateEl) {
                lowestDateEl.textContent = lowestWeek;
            }
            if (lowestCard) {
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

            // Runway Bar
            const runwayContainer = el("#cfRunwayBar");
            if (runwayContainer && runway) {
                // Pass the full runway object with all fields
                runwayContainer.innerHTML = RunwayBar.generate(runway, {
                    maxWeeks: Math.max(26, (meta.activeConfig.horizonWeeks || 8) * 2)
                });
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
            
            el("#cfVitalDso").textContent = (co.ar.avgDaysToPay || "0") + " Days";
            el("#cfVitalDpo").textContent = (co.ap.avgDaysToPay || "0") + " Days";

            const netFlow = co.cash.totalInflows - co.cash.totalOutflows;
            const elNetFlow = el("#cfVitalNetFlow");
            if (elNetFlow) {
                elNetFlow.textContent = (netFlow >= 0 ? "+" : "") + fmtMoney(netFlow);
                elNetFlow.className = `font-weight-bold ${netFlow >= 0 ? "text-success" : "text-danger"}`;
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
            
            // Determine health color based on pctCurrent
            let healthColor = 'text-success';
            let healthIcon = 'fa-check-circle';
            if (pctCurrent < 50) {
                healthColor = 'text-danger';
                healthIcon = 'fa-exclamation-circle';
            } else if (pctCurrent < 75) {
                healthColor = 'text-warning';
                healthIcon = 'fa-exclamation-triangle';
            }
            
            // Update header metrics
            const metricsEl = el("#cfArMetrics");
            if (metricsEl) {
                metricsEl.innerHTML = `
                    <div class="text-right mr-4">
                        <div class="small text-muted">Total Outstanding</div>
                        <div class="font-weight-bold text-primary">${fmtMoney(outstanding)}</div>
                    </div>
                    <div class="text-right mr-4">
                        <div class="small text-muted"><i class="fas ${healthIcon} ${healthColor} mr-1"></i>Current</div>
                        <div class="font-weight-bold ${healthColor}">${pctCurrent.toFixed(0)}%</div>
                    </div>
                    <div class="text-right mr-3">
                        <div class="small text-muted"><i class="fas fa-calendar-alt text-info mr-1"></i>DSO</div>
                        <div class="font-weight-bold text-info">${dso} Days</div>
                    </div>
                    <a href="/app/reporting/reportrunner.nl?reporttype=REGISTER&accttype=AcctRec" target="_blank" class="btn btn-sm btn-outline-primary py-0 px-2" title="Open AR Register in NetSuite">
                        <i class="fas fa-external-link-alt fa-xs"></i>
                    </a>`;
            }
            
            // Render buckets with flexbox proportional bars
            let html = '';
            const total = outstanding > 0 ? outstanding : 1;
            
            buckets.forEach((b) => {
                const pct = (b.amount / total) * 100;
                const isOverdue = b.label !== 'Current' && b.amount > 0;
                const hasItems = b.amount > 0;
                html += `
                <div class="cf-bucket-row d-flex align-items-center justify-content-between mb-2 ${hasItems ? 'clickable' : ''}" 
                     ${hasItems ? `onclick="CashflowController.showBucketFlyout('${b.label}', 'ar')" style="cursor:pointer;"` : ''}>
                    <div style="width: 60px;" class="small font-weight-bold ${isOverdue ? 'text-danger' : 'text-muted'}">${b.label}</div>
                    <div class="flex-grow-1 mx-2" style="display:flex; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
                        <div style="flex: ${b.amount}; background: ${isOverdue ? '#ef4444' : '#3b82f6'};"></div>
                        <div style="flex: ${total - b.amount};"></div>
                    </div>
                    <div class="small font-weight-bold" style="min-width:80px; text-align:right;">${fmtMoney(b.amount)}</div>
                    ${hasItems ? '<i class="fas fa-chevron-right text-muted ml-2" style="font-size:10px;"></i>' : ''}
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
            
            // For AP, higher current % is generally better (fewer overdue)
            let healthColor = 'text-success';
            let healthIcon = 'fa-check-circle';
            if (pctCurrent < 50) {
                healthColor = 'text-danger';
                healthIcon = 'fa-exclamation-circle';
            } else if (pctCurrent < 75) {
                healthColor = 'text-warning';
                healthIcon = 'fa-exclamation-triangle';
            }
            
            // Update header metrics
            const metricsEl = el("#cfApMetrics");
            if (metricsEl) {
                metricsEl.innerHTML = `
                    <div class="text-right mr-4">
                        <div class="small text-muted">Total Outstanding</div>
                        <div class="font-weight-bold text-danger">${fmtMoney(outstanding)}</div>
                    </div>
                    <div class="text-right mr-4">
                        <div class="small text-muted"><i class="fas ${healthIcon} ${healthColor} mr-1"></i>Current</div>
                        <div class="font-weight-bold ${healthColor}">${pctCurrent.toFixed(0)}%</div>
                    </div>
                    <div class="text-right mr-3">
                        <div class="small text-muted"><i class="fas fa-calendar-alt text-purple mr-1"></i>DPO</div>
                        <div class="font-weight-bold text-purple">${dpo} Days</div>
                    </div>
                    <a href="/app/reporting/reportrunner.nl?reporttype=REGISTER&accttype=AcctPay" target="_blank" class="btn btn-sm btn-outline-danger py-0 px-2" title="Open AP Register in NetSuite">
                        <i class="fas fa-external-link-alt fa-xs"></i>
                    </a>`;
            }
            
            // Render buckets with flexbox proportional bars
            let html = '';
            const total = outstanding > 0 ? outstanding : 1;
            
            buckets.forEach((b) => {
                const pct = (b.amount / total) * 100;
                const isOverdue = b.label !== 'Current' && b.amount > 0;
                const hasItems = b.amount > 0;
                html += `
                <div class="cf-bucket-row d-flex align-items-center justify-content-between mb-2 ${hasItems ? 'clickable' : ''}"
                     ${hasItems ? `onclick="CashflowController.showBucketFlyout('${b.label}', 'ap')" style="cursor:pointer;"` : ''}>
                    <div style="width: 60px;" class="small font-weight-bold ${isOverdue ? 'text-warning' : 'text-muted'}">${b.label}</div>
                    <div class="flex-grow-1 mx-2" style="display:flex; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
                        <div style="flex: ${b.amount}; background: ${isOverdue ? '#f59e0b' : '#ef4444'};"></div>
                        <div style="flex: ${total - b.amount};"></div>
                    </div>
                    <div class="small font-weight-bold" style="min-width:80px; text-align:right;">${fmtMoney(b.amount)}</div>
                    ${hasItems ? '<i class="fas fa-chevron-right text-muted ml-2" style="font-size:10px;"></i>' : ''}
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
            if (!thead || !tbody) return;

            const groups = config.groups || [];
            const isGroupMode = this.viewMode === 'groups' && groups.length > 0;

            // Build header based on view mode
            thead.innerHTML = `<th>Week</th><th class='text-right'>Inflow (AR)</th><th class='text-right'>AP Out</th>`;
            
            if (isGroupMode) {
                // Group mode - show group columns
                groups.forEach(g => {
                    thead.innerHTML += `<th class="text-right text-muted small">${g.name}</th>`;
                });
            } else {
                // Category mode - show category columns
                const catKeys = Object.keys(cats || {});
                catKeys.forEach(k => {
                    const confCat = config.categories.find(c => c.id === k);
                    thead.innerHTML += `<th class="text-right text-muted small">${confCat ? confCat.name : k}</th>`;
                });
            }
            thead.innerHTML += "<th class='text-right'>Net</th><th class='text-right'>End Cash</th>";
            tbody.innerHTML = "";

            const colKeys = isGroupMode ? groups.map(g => g.id) : Object.keys(cats || {});
            
            if (!weeks.length) {
                tbody.innerHTML = `<tr><td colspan="${5 + colKeys.length}" class="text-center p-4 text-muted">No data available</td></tr>`;
                return;
            }

            weeks.forEach((w, idx) => {
                const safeCap = w.safeApCapacity || 0;
                const isOverCap = w.outflows.ap > safeCap;
                const capPct = safeCap > 0 ? Math.min(100, (w.outflows.ap / safeCap) * 100) : (w.outflows.ap > 0 ? 100 : 0);
                const barColor = isOverCap ? "bg-danger" : "bg-success";

                const apCell = `
                    <div class="d-flex flex-column align-items-end">
                        <span class="${isOverCap ? "text-danger font-weight-bold" : ""}">${fmtMoney(w.outflows.ap)}</span>
                        <div class="progress w-100 mt-1" style="height: 3px; background-color: #e9ecef; width: 80px !important;">
                            <div class="progress-bar ${barColor}" style="width: ${capPct}%"></div>
                        </div>
                        <span class="text-muted" style="font-size:9px;">Safe: ${fmtMoney(safeCap)}</span>
                    </div>`;

                let html = `<td class="font-weight-medium">${w.weekStart}</td>
                            <td class="text-right text-success font-weight-bold">${fmtMoney(w.inflows.ar)}</td>
                            <td class="text-right">${apCell}</td>`;
                
                if (isGroupMode) {
                    // Group mode - aggregate categories within each group
                    groups.forEach(g => {
                        let groupTotal = 0;
                        (g.categoryIds || []).forEach(catId => {
                            if (cats[catId] && cats[catId].weeklyAmounts) {
                                groupTotal += cats[catId].weeklyAmounts[w.weekStart] || 0;
                            }
                        });
                        html += `<td class="text-right text-muted">${groupTotal > 0 ? fmtMoney(groupTotal) : "-"}</td>`;
                    });
                } else {
                    // Category mode
                    Object.keys(cats || {}).forEach(k => {
                        const val = cats[k].weeklyAmounts ? cats[k].weeklyAmounts[w.weekStart] || 0 : 0;
                        html += `<td class="text-right text-muted">${val > 0 ? fmtMoney(val) : "-"}</td>`;
                    });
                }

                html += `<td class="text-right font-weight-bold ${w.netChange >= 0 ? "text-success" : "text-danger"}">${fmtMoney(w.netChange)}</td>
                         <td class="text-right font-weight-bold ${w.endingCash < 0 ? "text-danger" : "text-dark"}">${fmtMoney(w.endingCash)}</td>`;

                const tr = document.createElement("tr");
                tr.className = "cf-week-row cf-clickable-row" + (w.endingCash < 0 ? " cf-row-negative" : "");
                tr.innerHTML = html;
                
                // Single click opens flyout with week details
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
            const sel = el("#cfDetailCatSelect");
            if (!sel) return;
            sel.innerHTML = "";
            const keys = Object.keys(cats || {});
            if (keys.length === 0) return;

            keys.forEach(k => {
                const conf = config.categories.find(c => c.id === k);
                sel.innerHTML += `<option value="${k}">${conf ? conf.name : k}</option>`;
            });

            sel.onchange = () => {
                this.detailPage = 1;
                this.renderDetailTable(cats[sel.value]);
            };
            this.renderDetailTable(cats[keys[0]]);
        },

        renderDetailTable(catData) {
            this.currentDetailCatData = catData;
            const detailData = (catData && catData.breakdown) ? catData.breakdown : [];
            const container = el("#cfDetailTable") ? el("#cfDetailTable").parentNode : null;
            if(!container) return;

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
                    methodDesc = `<p class="mb-2"><strong>Vendor Payment History</strong> aggregates historical payments to selected vendors to calculate a normalized run-rate.</p>
                        <div class="small text-muted">
                            <div class="mb-1"><i class="fas fa-store text-primary mr-1"></i><strong>Source:</strong> Check and VendPymt transactions to specified vendors</div>
                            <div class="mb-1"><i class="fas fa-chart-bar text-info mr-1"></i><strong>Calculation:</strong> Monthly payment totals → Median value → Weekly conversion (÷ 4.345)</div>
                            <div><i class="fas fa-shield-alt text-success mr-1"></i><strong>Why Median:</strong> Reduces impact of outlier payments for more stable forecasts</div>
                        </div>`;
                } else if (m.method === 'Credit Card Cycle') {
                    mathText = `<div class="d-flex justify-content-between small mb-1"><span>Balance:</span> <strong>${fmtMoney(m.outstanding)}</strong></div>
                        <div class="d-flex justify-content-between small mb-1 text-primary"><span>+ Growth:</span> <strong>${fmtMoney(m.projectedGrowth)}</strong></div>
                        <div class="border-top my-2"></div>
                        <div class="d-flex justify-content-between font-weight-bold text-dark mb-1"><span>Next Pay:</span> <span>${fmtMoney(m.outstanding + m.projectedGrowth)}</span></div>
                        <div class="small text-muted text-right">Target: ${m.nextPaymentDate || 'N/A'}</div>`;
                    methodDesc = `<p class="mb-2"><strong>Credit Card Cycle</strong> combines real-time liability balances with historical spending patterns.</p>
                        <div class="small text-muted">
                            <div class="mb-1"><i class="fas fa-credit-card text-primary mr-1"></i><strong>Balance:</strong> Current outstanding amount from credit card liability accounts</div>
                            <div class="mb-1"><i class="fas fa-chart-line text-info mr-1"></i><strong>Growth:</strong> Projected spending until payment date based on historical run-rate</div>
                            <div><i class="fas fa-calendar-check text-success mr-1"></i><strong>Timing:</strong> Payment scheduled on configured day of month</div>
                        </div>`;
                } else if (m.method === 'Manual Recurring') {
                    mathText = `<div class="d-flex justify-content-between small mb-1"><span>Amount:</span> <strong>${fmtMoney(m.amount)}</strong></div>
                    <div class="d-flex justify-content-between small mb-1"><span>Frequency:</span> <span>${m.frequency}</span></div>`;
                    methodDesc = `<p class="mb-2"><strong>Manual Recurring</strong> creates deterministic, fixed cash flow events.</p>
                        <div class="small text-muted">
                            <div class="mb-1"><i class="fas fa-clock text-primary mr-1"></i><strong>Frequency:</strong> ${m.frequency} schedule</div>
                            <div><i class="fas fa-lock text-info mr-1"></i><strong>Amount:</strong> Fixed at ${fmtMoney(m.amount)} per occurrence—no historical analysis</div>
                        </div>`;
                } else if (m.method === 'Vendor Recurring (Auto)') {
                    mathText = `<div class="d-flex justify-content-between small mb-1"><span>Detected:</span> <span class="badge badge-soft-primary text-uppercase">${m.frequency}</span></div>
                    <div class="d-flex justify-content-between small mb-1"><span>Interval:</span> <span>${m.interval} Days</span></div>
                    <div class="d-flex justify-content-between align-items-center border-top mt-2 pt-2"><span class="font-weight-bold">Run Rate:</span> <span class="font-weight-bold">${fmtMoney(m.avgAmount)}</span></div>`;
                    methodDesc = `<p class="mb-2"><strong>Vendor Recurring (Auto)</strong> uses pattern recognition to detect payment frequency.</p>
                        <div class="small text-muted">
                            <div class="mb-1"><i class="fas fa-brain text-primary mr-1"></i><strong>Detection:</strong> Analyzes payment intervals to classify as Weekly, Bi-Weekly, Monthly, or Quarterly</div>
                            <div class="mb-1"><i class="fas fa-calculator text-info mr-1"></i><strong>Amount:</strong> Average of historical payments at detected frequency</div>
                            <div><i class="fas fa-sync text-success mr-1"></i><strong>Projection:</strong> Next payment date calculated from last payment + detected interval</div>
                        </div>`;
                } else if (m.method === 'Bank Register History') {
                    mathText = `<div class="d-flex justify-content-between small mb-1"><span>Raw Avg:</span> <span>${fmtMoney(m.rawAverage)}</span></div>
                    <div class="d-flex justify-content-between small mb-1 text-muted"><span>(Based on ${m.weeksUsed} weeks)</span></div>
                    <div class="d-flex justify-content-between font-weight-bold border-top pt-1 mt-2"><span>Final (Wkly):</span> <span>${fmtMoney(m.finalAverage)}</span></div>`;
                    methodDesc = `<p class="mb-2"><strong>Bank Register History</strong> forecasts based on actual cash movements in bank accounts.</p>
                        <div class="small text-muted">
                            <div class="mb-1"><i class="fas fa-university text-primary mr-1"></i><strong>Source:</strong> Credits/debits from selected bank accounts (${m.bankAccounts ? m.bankAccounts.length + ' accounts' : 'N/A'})</div>
                            <div class="mb-1"><i class="fas fa-filter text-info mr-1"></i><strong>Filters:</strong> ${m.memoKeywords && m.memoKeywords.length ? 'Memo keywords: ' + m.memoKeywords.join(', ') : 'No memo filters applied'}</div>
                            <div><i class="fas fa-history text-success mr-1"></i><strong>Lookback:</strong> ${m.historyWeeks || 12} weeks of historical data</div>
                        </div>`;
                } else if (m.method === 'Calculated Formula') {
                    mathText = `<div class="small text-muted mb-1"><strong>Formula:</strong></div><code class="small d-block mb-2 text-wrap" style="background:#f8f9fa; padding:4px;">${m.formula}</code>`;
                    methodDesc = `<p class="mb-2"><strong>Formula Expression</strong> executes programmable logic using Excel-style syntax.</p>
                        <div class="small text-muted">
                            <div class="mb-1"><i class="fas fa-code text-primary mr-1"></i><strong>Engine:</strong> Supports arithmetic, functions (IF, MIN, MAX, etc.), and category references</div>
                            <div><i class="fas fa-link text-info mr-1"></i><strong>References:</strong> Use {CategoryID} to reference other category totals dynamically</div>
                        </div>`;
                } else {
                    mathText = `<div class="text-muted small">Standard projection based on transaction dates.</div>`;
                    methodDesc = `<p class="mb-0 small text-muted">This category uses default projection logic.</p>`;
                }

                logicHtml = `<div class="card border mb-3">
                        <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                            <small class="font-weight-bold"><i class="fas fa-cogs mr-2 text-primary"></i>Forecast Logic: ${m.method}</small>
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
                    </div>
                    <h6 class="cf-section-header mt-2">Source Data Breakdown</h6>`;
            }
            const logicContainer = el("#cfDetailLogic");
            if (!logicContainer) {
                const lc = document.createElement("div");
                lc.id = "cfDetailLogic";
                container.insertBefore(lc, el("#cfDetailTable"));
            }
            el("#cfDetailLogic").innerHTML = logicHtml;

            // Table Body with Pagination
            const tbody = el("#cfDetailTable").querySelector("tbody");
            tbody.innerHTML = "";
            
            const lblTotal = el("#cfDetailTotal");
            const lblPage = el("#detailPageLabel");
            const prevBtn = el("#btnDetailPrev");
            const nextBtn = el("#btnDetailNext");

            if (!detailData.length) {
                tbody.innerHTML = "<tr><td colspan='4' class='text-muted text-center p-4'>No source data found.</td></tr>";
                if (lblTotal) lblTotal.textContent = "$0";
                if (lblPage) lblPage.textContent = "";
                if (prevBtn) prevBtn.disabled = true;
                if (nextBtn) nextBtn.disabled = true;
                return;
            }

            // Sort & Group
            const hasDate = detailData.some(x => x.date);
            if (hasDate) detailData.sort((a,b) => new Date(b.date||0) - new Date(a.date||0));
            else detailData.sort((a,b) => b.amount - a.amount);

            // Pagination
            const totalItems = detailData.length;
            const totalPages = Math.ceil(totalItems / this.detailPageSize);
            if (this.detailPage > totalPages) this.detailPage = totalPages;
            if (this.detailPage < 1) this.detailPage = 1;
            
            const startIdx = (this.detailPage - 1) * this.detailPageSize;
            const endIdx = Math.min(startIdx + this.detailPageSize, totalItems);
            const pageData = detailData.slice(startIdx, endIdx);

            let lastGroup = "";
            pageData.forEach(row => {
                let group = "General";
                if (row.date) {
                    const d = new Date(row.date);
                    group = d.toLocaleString('default', { month: 'long', year: 'numeric' });
                } else if (row.name && row.name.includes(':')) {
                    group = row.name.split(':')[0].trim();
                }

                if (group !== lastGroup) {
                    tbody.innerHTML += `<tr class="bg-light"><td colspan="4" class="font-weight-bold text-uppercase small text-muted pl-3 py-2" style="letter-spacing:0.05em;">${group}</td></tr>`;
                    lastGroup = group;
                }

                const dateDisplay = row.date || "—";
                const typeDisplay = row.type || (row.amount < 0 ? 'Credit' : 'Debit');
                
                // Deep link if internalId is available
                const nameDisplay = row.internalId 
                    ? getNsLink(row.name, row.internalId)
                    : `<span class="text-dark">${row.name}</span>`;
                
                tbody.innerHTML += `
                    <tr>
                        <td class="pl-4"><div class="font-weight-medium">${nameDisplay}</div></td>
                        <td class="small text-muted">${dateDisplay}</td>
                        <td class="text-right font-weight-bold">${fmtMoney(row.amount)}</td>
                        <td class="text-center"><span class="badge badge-light border">${typeDisplay}</span></td>
                    </tr>`;
            });
            
            if (lblTotal) lblTotal.textContent = fmtMoney(catData.total);
            if (lblPage) lblPage.textContent = totalPages > 1 ? `Page ${this.detailPage} of ${totalPages} (${totalItems} items)` : `${totalItems} items`;
            if (prevBtn) prevBtn.disabled = this.detailPage <= 1;
            if (nextBtn) nextBtn.disabled = this.detailPage >= totalPages;
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
        },
        
        goBackFlyout() {
            const prev = this.flyout.previousContext;
            if (!prev) return;
            
            this.flyout.previousContext = null;
            
            if (prev.type === 'week') {
                this.resetFlyoutState();
                this.showWeekFlyout(prev.weekStart);
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
            
            // Build summary table for entity
            let summaryHtml = '<table class="table table-sm table-borderless mb-0" style="font-size: 13px;"><tbody>';
            
            if (entityType === 'customer') {
                summaryHtml += `
                    <tr><td class="text-muted py-1">Avg Days to Pay</td><td class="text-right font-weight-bold py-1 text-info">${summary.avgDaysToPay || 0} days</td></tr>
                    <tr><td class="text-muted py-1">Total Paid (12mo)</td><td class="text-right font-weight-bold py-1 text-success">${fmtMoney(summary.totalPaid || 0)}</td></tr>
                    <tr><td class="text-muted py-1">Open Balance</td><td class="text-right font-weight-bold py-1 text-warning">${fmtMoney(summary.totalOpen || 0)}</td></tr>
                    <tr><td class="text-muted py-1">Reliability Score</td><td class="text-right font-weight-bold py-1 ${summary.reliabilityScore >= 70 ? 'text-success' : summary.reliabilityScore >= 50 ? 'text-warning' : 'text-danger'}">${summary.reliabilityScore || 0}/100</td></tr>
                `;
            } else {
                summaryHtml += `
                    <tr><td class="text-muted py-1">Total Paid (12mo)</td><td class="text-right font-weight-bold py-1 text-danger">${fmtMoney(summary.totalPaid || 0)}</td></tr>
                    <tr><td class="text-muted py-1">Payments</td><td class="text-right font-weight-bold py-1 text-info">${summary.paymentCount || 0}</td></tr>
                    <tr><td class="text-muted py-1">Open Bills</td><td class="text-right font-weight-bold py-1 text-warning">${fmtMoney(summary.totalOpen || 0)}</td></tr>
                    <tr><td class="text-muted py-1">Avg Payment</td><td class="text-right font-weight-bold py-1">${fmtMoney(summary.avgPayment || 0)}</td></tr>
                `;
            }
            
            summaryHtml += '</tbody></table>';
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
            // Instead of showing empty state, auto-select Bank Accounts
            this.showFixed("BANK");
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
            this.editGroup(this.data.groups.length - 1);
        },

        editGroup(i) {
            this.idx = -1;
            this.fixedType = null;
            this.editingGroupIdx = i;
            this.renderList();
            
            const g = this.data.groups[i];
            const container = el('#cfConfigContainer');
            
            // Build category checkboxes
            const cats = this.data.categories || [];
            const selectedIds = g.categoryIds || [];
            let catCheckboxes = '';
            cats.forEach(c => {
                const checked = selectedIds.includes(c.id) ? 'checked' : '';
                catCheckboxes += `
                    <div class="custom-control custom-checkbox mb-1">
                        <input type="checkbox" class="custom-control-input group-cat-checkbox" id="grpcat_${c.id}" value="${c.id}" ${checked}>
                        <label class="custom-control-label small" for="grpcat_${c.id}">${c.name}</label>
                    </div>`;
            });
            if (cats.length === 0) {
                catCheckboxes = '<p class="text-muted small mb-0">No categories defined yet</p>';
            }
            
            container.innerHTML = `
                <div class="d-flex align-items-center mb-4 pb-2 border-bottom">
                    <div class="icon-box bg-purple-soft text-purple mr-3"><i class="fas fa-layer-group"></i></div>
                    <div><h5 class="m-0 font-weight-bold">Edit Group</h5><small class="text-muted">ID: ${g.id}</small></div>
                </div>
                <div class="row">
                    <div class="col-md-6 form-group">
                        <label class="cf-label">Group Name</label>
                        <input id="confGroupName" class="form-control form-control-sm" value="${g.name}">
                    </div>
                    <div class="col-md-6 form-group">
                        <label class="cf-label">Internal ID</label>
                        <input id="confGroupId" class="form-control form-control-sm" value="${g.id}">
                        <small class="text-muted">Unique identifier</small>
                    </div>
                </div>
                <div class="form-group">
                    <label class="cf-label">Categories in Group</label>
                    <div class="border rounded p-3 bg-light" style="max-height: 200px; overflow-y: auto;">
                        ${catCheckboxes}
                    </div>
                </div>
                <div class="d-flex justify-content-between">
                    <button class="btn btn-outline-danger btn-sm" onclick="ConfigController.deleteGroup()">Delete Group</button>
                    <button class="btn btn-primary btn-sm shadow-sm" onclick="ConfigController.saveGroup()">Save Group</button>
                </div>
            `;
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
            this.renderList();
            const container = el('#cfConfigContainer');
            
            if (type === 'BANK') {
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
                
                container.innerHTML = `
                    <div class="d-flex align-items-center mb-3 pb-2 border-bottom">
                        <div class="icon-box bg-gray-soft text-dark mr-3"><i class="fas fa-university"></i></div>
                        <div>
                            <h5 class="m-0 font-weight-bold">Bank Accounts</h5>
                            <small class="text-muted">Select accounts for cash position tracking</small>
                        </div>
                    </div>

                    <div class="card border mb-3">
                        <div class="card-header bg-light py-2">
                            <small class="font-weight-bold text-dark"><i class="fas fa-piggy-bank mr-1 text-primary"></i>Starting Cash Accounts</small>
                        </div>
                        <div class="card-body p-3">
                            <p class="small text-muted mb-2">Select the bank accounts that should be included when calculating your starting cash position. The sum of these account balances will be used as your "Current Cash" figure.</p>
                            <input type="text" class="form-control form-control-sm mb-2" placeholder="Search accounts..." onkeyup="const term=this.value.toLowerCase(); document.getElementById('cfBankAccountIds').querySelectorAll('option').forEach(o => o.style.display = o.text.toLowerCase().includes(term) ? 'block' : 'none')">
                            <select id="cfBankAccountIds" class="form-control" multiple style="height: 200px;">
                                ${bankOptions}
                            </select>
                            <small class="text-muted d-block mt-2">Hold Ctrl/Cmd to select multiple accounts. Selected accounts appear at top.</small>
                        </div>
                    </div>

                    <div class="alert alert-info border py-2 px-3 mb-3">
                        <small><i class="fas fa-info-circle mr-1"></i>If no accounts are selected, the system will use the sum of all active Bank type accounts.</small>
                    </div>

                    <button class="btn btn-primary shadow-sm" onclick="ConfigController.saveBankAccounts()">
                        <i class="fas fa-save mr-1"></i>Save Bank Accounts
                    </button>
                `;
            } else if (type === 'AP') {
                const f = this.data.apFilters || {};
                const ps = this.data.predictionSettings || {};
                const overduePush = ps.overduePushDays || { light: 7, medium: 14, heavy: 28 };
                const defaultDays = ps.defaultDaysToPay || 45;
                const historyDays = ps.paymentHistoryDays || 365;
                
                container.innerHTML = `
                    <div class="d-flex align-items-center mb-3 pb-2 border-bottom">
                        <div class="icon-box bg-red-soft text-red mr-3"><i class="fas fa-file-invoice-dollar"></i></div>
                        <div>
                            <h5 class="m-0 font-weight-bold">Accounts Payable</h5>
                            <small class="text-muted">Payment prediction & cash optimization</small>
                        </div>
                    </div>

                    <!-- Algorithm Flow -->
                    <div class="card border mb-3">
                        <div class="card-header bg-dark text-white py-2">
                            <small class="font-weight-bold"><i class="fas fa-project-diagram mr-2"></i>Payment Date Prediction</small>
                        </div>
                        <div class="card-body p-3">
                            <div class="d-flex align-items-center justify-content-between text-center" style="gap: 6px;">
                                <div class="flex-fill p-2 rounded bg-secondary text-white">
                                    <i class="fas fa-calendar-check mb-1"></i>
                                    <div style="font-size: 10px;" class="font-weight-bold">Expected Date</div>
                                    <div class="badge badge-light mt-1" style="font-size: 8px;">Override Field</div>
                                </div>
                                <i class="fas fa-chevron-right text-muted small"></i>
                                <div class="flex-fill p-2 rounded bg-info text-white">
                                    <i class="fas fa-chart-line mb-1"></i>
                                    <div style="font-size: 10px;" class="font-weight-bold">Vendor History</div>
                                    <div class="badge badge-light mt-1" style="font-size: 8px;">${historyDays}d window</div>
                                </div>
                                <i class="fas fa-chevron-right text-muted small"></i>
                                <div class="flex-fill p-2 rounded bg-primary text-white">
                                    <i class="fas fa-clock mb-1"></i>
                                    <div style="font-size: 10px;" class="font-weight-bold">Default Terms</div>
                                    <div class="badge badge-light mt-1" style="font-size: 8px;">${defaultDays} days</div>
                                </div>
                                <i class="fas fa-chevron-right text-muted small"></i>
                                <div class="flex-fill p-2 rounded bg-success text-white">
                                    <i class="fas fa-calendar-day mb-1"></i>
                                    <div style="font-size: 10px;" class="font-weight-bold">Biz Day Adj</div>
                                    <div class="badge badge-light mt-1" style="font-size: 8px;">Skip wkends</div>
                                </div>
                            </div>
                            <div class="mt-2 small text-muted">
                                <i class="fas fa-info-circle mr-1"></i>Overdue bills pushed forward: <code>${overduePush.light}d</code> (&lt;30 late), <code>${overduePush.medium}d</code> (&gt;30 late)
                            </div>
                        </div>
                    </div>

                    <!-- Capacity & Filtering -->
                    <div class="row">
                        <div class="col-md-6">
                            <div class="card border mb-3">
                                <div class="card-header bg-light py-2">
                                    <small class="font-weight-bold text-dark"><i class="fas fa-tachometer-alt mr-1 text-primary"></i>Capacity Controls</small>
                                </div>
                                <div class="card-body p-3">
                                    <div class="form-group mb-2">
                                        <label class="cf-label mb-1">Weekly Cash Cap</label>
                                        <div class="input-group input-group-sm">
                                            <div class="input-group-prepend"><span class="input-group-text">$</span></div>
                                            <input type="number" class="form-control" id="cfGlobalApCap" value="${f.weeklyCap||0}">
                                        </div>
                                        <small class="text-muted">0 = unlimited</small>
                                    </div>
                                    <div class="custom-control custom-switch">
                                        <input type="checkbox" class="custom-control-input" id="cfGlobalApRestrictSafe" ${f.restrictToSafe?'checked':''}>
                                        <label class="custom-control-label small" for="cfGlobalApRestrictSafe">Restrict to Safe Capacity</label>
                                    </div>
                                    <small class="text-muted d-block mt-1">Safe = Cash + AR - Minimum Reserve</small>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="card border mb-3">
                                <div class="card-header bg-light py-2">
                                    <small class="font-weight-bold text-dark"><i class="fas fa-filter mr-1 text-warning"></i>Vendor Filtering</small>
                                </div>
                                <div class="card-body p-3">
                                    <div class="form-group mb-2">
                                        <label class="cf-label mb-1"><i class="fas fa-ban text-danger mr-1"></i>Excluded Categories</label>
                                        <input type="text" class="form-control form-control-sm" id="cfGlobalApExclude" placeholder="e.g. 7, 9" value="${(f.excludeVendorCategories||[]).join(', ')}">
                                    </div>
                                    <div class="form-group mb-0">
                                        <label class="cf-label mb-1"><i class="fas fa-star text-warning mr-1"></i>Priority Categories</label>
                                        <input type="text" class="form-control form-control-sm" id="cfGlobalApPriority" placeholder="e.g. 5, 3" value="${(f.priorityVendorCategories||[]).join(', ')}">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Preservation & Overflow -->
                    <div class="row">
                        <div class="col-md-6">
                            <div class="card border mb-3" style="border-left: 3px solid #ffc107 !important;">
                                <div class="card-body p-3">
                                    <div class="d-flex justify-content-between align-items-center mb-2">
                                        <small class="font-weight-bold"><i class="fas fa-piggy-bank mr-1 text-warning"></i>Cash Preservation Mode</small>
                                        <div class="custom-control custom-switch mb-0">
                                            <input type="checkbox" class="custom-control-input" id="cfGlobalApPreserve" ${f.preservationMode?'checked':''}>
                                            <label class="custom-control-label" for="cfGlobalApPreserve"></label>
                                        </div>
                                    </div>
                                    <small class="text-muted">Prioritizes: 1) Priority vendors 2) Oldest bills 3) Defers excess</small>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="card border mb-3">
                                <div class="card-body p-3">
                                    <div class="d-flex justify-content-between align-items-center mb-2">
                                        <small class="font-weight-bold"><i class="fas fa-layer-group mr-1 text-secondary"></i>Auto-Defer Overflow</small>
                                        <div class="custom-control custom-switch mb-0">
                                            <input type="checkbox" class="custom-control-input" id="cfGlobalApDefer" ${f.deferIfNegative?'checked':''}>
                                            <label class="custom-control-label" for="cfGlobalApDefer"></label>
                                        </div>
                                    </div>
                                    <small class="text-muted">Push excess bills to next week when cap exceeded</small>
                                </div>
                            </div>
                        </div>
                    </div>

                    <button class="btn btn-primary shadow-sm" onclick="ConfigController.save()">
                        <i class="fas fa-save mr-1"></i>Save Configuration
                    </button>
                `;
            } else if (type === 'AR') {
                const ps = this.data.predictionSettings || {};
                const volThresh = ps.volatilityThresholds || { stable: 5, volatile: 15 };
                const overduePush = ps.overduePushDays || { light: 7, medium: 14, heavy: 28 };
                const defaultDays = ps.defaultDaysToPay || 45;
                const historyDays = ps.paymentHistoryDays || 365;
                
                container.innerHTML = `
                    <div class="d-flex align-items-center mb-3 pb-2 border-bottom">
                        <div class="icon-box bg-green-soft text-green mr-3"><i class="fas fa-hand-holding-usd"></i></div>
                        <div>
                            <h5 class="m-0 font-weight-bold">Accounts Receivable</h5>
                            <small class="text-muted">Collection prediction engine</small>
                        </div>
                    </div>

                    <!-- Algorithm Flow -->
                    <div class="card border mb-3">
                        <div class="card-header bg-dark text-white py-2">
                            <small class="font-weight-bold"><i class="fas fa-brain mr-2"></i>Collection Date Prediction</small>
                        </div>
                        <div class="card-body p-3">
                            <div class="d-flex align-items-center justify-content-between text-center" style="gap: 6px;">
                                <div class="flex-fill p-2 rounded bg-success text-white">
                                    <i class="fas fa-calendar-check mb-1"></i>
                                    <div style="font-size: 10px;" class="font-weight-bold">Manual Override</div>
                                    <div class="badge badge-light mt-1" style="font-size: 8px;">Expected Date</div>
                                </div>
                                <i class="fas fa-chevron-right text-muted small"></i>
                                <div class="flex-fill p-2 rounded bg-primary text-white">
                                    <i class="fas fa-user-clock mb-1"></i>
                                    <div style="font-size: 10px;" class="font-weight-bold">Customer History</div>
                                    <div class="badge badge-light mt-1" style="font-size: 8px;">Avg + 0.5σ</div>
                                </div>
                                <i class="fas fa-chevron-right text-muted small"></i>
                                <div class="flex-fill p-2 rounded bg-info text-white">
                                    <i class="fas fa-file-contract mb-1"></i>
                                    <div style="font-size: 10px;" class="font-weight-bold">Invoice Terms</div>
                                    <div class="badge badge-light mt-1" style="font-size: 8px;">Net 30, 60...</div>
                                </div>
                                <i class="fas fa-chevron-right text-muted small"></i>
                                <div class="flex-fill p-2 rounded bg-secondary text-white">
                                    <i class="fas fa-globe mb-1"></i>
                                    <div style="font-size: 10px;" class="font-weight-bold">Global Fallback</div>
                                    <div class="badge badge-light mt-1" style="font-size: 8px;">${defaultDays} days</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Volatility & Overdue -->
                    <div class="row">
                        <div class="col-md-6">
                            <div class="card border mb-3">
                                <div class="card-header bg-light py-2">
                                    <small class="font-weight-bold text-dark"><i class="fas fa-chart-area mr-1 text-info"></i>Customer Volatility</small>
                                </div>
                                <div class="card-body p-2">
                                    <table class="table table-sm mb-0" style="font-size: 11px;">
                                        <tbody>
                                            <tr>
                                                <td><span class="badge badge-success">Stable</span></td>
                                                <td>σ &lt; ${volThresh.stable}d</td>
                                                <td class="text-muted">No buffer</td>
                                            </tr>
                                            <tr>
                                                <td><span class="badge badge-warning">Average</span></td>
                                                <td>${volThresh.stable}-${volThresh.volatile}d</td>
                                                <td class="text-muted">Small buffer</td>
                                            </tr>
                                            <tr>
                                                <td><span class="badge badge-danger">Volatile</span></td>
                                                <td>σ &gt; ${volThresh.volatile}d</td>
                                                <td class="text-muted">+0.5σ buffer</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="card border mb-3">
                                <div class="card-header bg-light py-2">
                                    <small class="font-weight-bold text-dark"><i class="fas fa-history mr-1 text-danger"></i>Overdue Handling</small>
                                </div>
                                <div class="card-body p-2">
                                    <table class="table table-sm mb-0" style="font-size: 11px;">
                                        <tbody>
                                            <tr>
                                                <td><span class="badge badge-success">0-30d</span></td>
                                                <td>+${overduePush.light} days</td>
                                                <td class="text-muted">Likely soon</td>
                                            </tr>
                                            <tr>
                                                <td><span class="badge badge-warning">31-60d</span></td>
                                                <td>+${overduePush.medium} days</td>
                                                <td class="text-muted">Needs follow-up</td>
                                            </tr>
                                            <tr>
                                                <td><span class="badge badge-danger">60d+</span></td>
                                                <td>+${overduePush.heavy} days</td>
                                                <td class="text-muted">Conservative</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Data Sources -->
                    <div class="card border mb-3" style="border-left: 3px solid #28a745 !important;">
                        <div class="card-body p-3">
                            <div class="row">
                                <div class="col-6 col-md-3 text-center border-right">
                                    <i class="fas fa-clock text-primary mb-1"></i>
                                    <div class="small font-weight-bold">${historyDays}d</div>
                                    <div style="font-size: 10px;" class="text-muted">History Window</div>
                                </div>
                                <div class="col-6 col-md-3 text-center border-right">
                                    <i class="fas fa-calculator text-info mb-1"></i>
                                    <div class="small font-weight-bold">Mean + σ</div>
                                    <div style="font-size: 10px;" class="text-muted">Statistical Model</div>
                                </div>
                                <div class="col-6 col-md-3 text-center border-right">
                                    <i class="fas fa-calendar-alt text-warning mb-1"></i>
                                    <div class="small font-weight-bold">Mon-Fri</div>
                                    <div style="font-size: 10px;" class="text-muted">Business Days</div>
                                </div>
                                <div class="col-6 col-md-3 text-center">
                                    <i class="fas fa-shield-alt text-danger mb-1"></i>
                                    <div class="small font-weight-bold">Due Date</div>
                                    <div style="font-size: 10px;" class="text-muted">Floor Limit</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="alert alert-success border py-2 px-3 mb-0">
                        <small><i class="fas fa-magic mr-1"></i><strong>Fully Automated</strong> — No configuration required. The system learns from your historical payment data.</small>
                    </div>
                `;
            }
        },
        
        edit(i) {
            this.idx = i;
            this.fixedType = null;
            this.editingGroupIdx = -1;
            this.renderList();
            const c = this.data.categories[i];
            const container = el('#cfConfigContainer');
            
            // Render the Full Form Shell
            container.innerHTML = `
                <div class="d-flex align-items-center mb-4 pb-2 border-bottom">
                    <div class="icon-box bg-blue-soft text-blue mr-3"><i class="fas fa-chart-line"></i></div>
                    <div><h5 class="m-0 font-weight-bold">Edit Category</h5><small class="text-muted">ID: ${c.id}</small></div>
                </div>
                <div class="row">
                    <div class="col-md-4 form-group"><label class="cf-label">Name</label><input id="confName" class="form-control form-control-sm" value="${c.name}"></div>
                    <div class="col-md-4 form-group"><label class="cf-label">Internal ID</label><input id="confId" class="form-control form-control-sm" value="${c.id}"><small class="text-muted">Unique identifier</small></div>
                    <div class="col-md-4 form-group"><label class="cf-label">Type</label>
                        <select id="confType" class="form-control form-control-sm">
                            <option value="outflow" ${c.type==='outflow'?'selected':''}>Outflow</option>
                            <option value="inflow" ${c.type==='inflow'?'selected':''}>Inflow</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="cf-label">Logic Method</label>
                    <select id="confMethod" class="form-control form-control-sm" onchange="ConfigController.onMethodChange()">
                        <option value="gl_history_average" ${c.method==='gl_history_average'?'selected':''}>GL History Average</option>
                        <option value="vendor_payment_history" ${c.method==='vendor_payment_history'?'selected':''}>Vendor Payment History</option>
                        <option value="credit_card_cycle" ${c.method==='credit_card_cycle'?'selected':''}>Credit Card Cycle</option>
                        <option value="manual_recurring" ${c.method==='manual_recurring'?'selected':''}>Manual Recurring</option>
                        <option value="formula_expression" ${c.method==='formula_expression'?'selected':''}>Formula Expression</option>
                        <option value="vendor_recurring_average" ${c.method==='vendor_recurring_average'?'selected':''}>Vendor Recurring (Auto)</option>
                        <option value="bank_register_history" ${c.method==='bank_register_history'?'selected':''}>Bank Register History</option>
                    </select>
                </div>
                <div class="row">
                    <div class="col-12">
                        <div id="confMethodDescription" class="mt-2 mb-3 p-2 bg-light rounded border-left border-primary small text-muted" style="line-height: 1.4; display:none;"></div>
                    </div>
                </div>
                <div id="conf-extra-fields" class="bg-light p-3 rounded border mb-4"></div>
                <div class="d-flex justify-content-between">
                    <button class="btn btn-outline-danger btn-sm" onclick="ConfigController.delete()">Delete</button>
                    <button class="btn btn-primary btn-sm shadow-sm" onclick="ConfigController.save()">Save Changes</button>
                </div>
            `;
            
            this.renderDynamicFields(c);
            this.updateMethodDescription(c.method);
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
            this.data.categories.push({ id: "new_"+Date.now(), name: "New Category", method: "gl_history_average", type: "outflow", accounts: [] });
            this.edit(this.data.categories.length - 1);
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