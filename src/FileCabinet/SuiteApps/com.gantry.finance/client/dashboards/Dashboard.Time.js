/**
 * Dashboard.Time.js
 * Billable Time Dashboard Controller - ENHANCED
 * 
 * Features:
 * - Visual utilization gauges per department
 * - Sortable tables with click headers
 * - Rolling period history
 * - Department cards with sparklines
 * - Employee performance heatmap
 * - Enhanced KPIs with trends
 */
(function(window) {
    'use strict';

    // Helper: Format percentage from already-multiplied value (backend returns 0-100, not 0-1)
    const fmtPctVal = (val, digits = 1) => {
        if (val == null || isNaN(val)) return "—";
        return Number(val).toFixed(digits) + "%";
    };

    const TimeController = {
        latestItems: [],
        latestEmployees: [],
        latestDepts: [],
        rawData: null,
        sortState: {},
        subsidiaryId: null,
        subsidiaries: [],

        init() {
            // Load template immediately
            this.setupUI();
        },
        
        setupUI() {
            el('#gantry-view-container').innerHTML = el('#tpl-time').innerHTML;
            
            // Show skeleton loaders in data areas
            this.showLoadingState();
            
            // Subsidiary dropdown handler
            const subsidiaryEl = el("#tbSubsidiary");
            if (subsidiaryEl) {
                subsidiaryEl.addEventListener("change", (e) => {
                    this.subsidiaryId = e.target.value;
                    this.loadData();
                });
            }
            
            const btn = el("#tbApplyRange");
            if (btn) btn.addEventListener("click", () => {
                const start = el("#tbStartDate")?.value;
                const end = el("#tbEndDate")?.value;
                this.loadData(start, end);
            });
            
            if (window.jQuery) {
                $('#gantry-view-container .nav-tabs a').on('click', function (e) { 
                    e.preventDefault(); 
                    $(this).tab('show'); 
                });
                // Resize Plotly charts when tabs are shown
                $('#gantry-view-container .nav-tabs a').on('shown.bs.tab', function (e) {
                    const target = $(e.target).attr('data-target');
                    if (window.Plotly) {
                        // Resize any Plotly charts in the newly shown tab
                        setTimeout(() => {
                            const tabPane = document.querySelector(target);
                            if (tabPane) {
                                tabPane.querySelectorAll('[class*="js-plotly"]').forEach(chart => {
                                    Plotly.Plots.resize(chart);
                                });
                            }
                            // Also resize the history chart specifically
                            const historyChart = document.getElementById('tbHistoryTrendChart');
                            if (historyChart && historyChart.data) Plotly.Plots.resize(historyChart);
                        }, 50);
                    }
                });
            }
            this.loadConfig();
        },
        
        showLoadingState() {
            // KPI area skeleton
            const kpiIds = ['TB_CompanyNonBillableCost', 'TB_CompanyNonBillablePerDay', 'TB_CompanyTotalHours', 'TB_CompanyBillableHours'];
            kpiIds.forEach(id => {
                const el_ = el('#' + id);
                if (el_) el_.innerHTML = Skeleton.render('custom', { width: '60px', height: '1.5rem' });
            });
            
            // Billable gauge placeholder (risk-meter style)
            const gaugeEl = el("#TB_BillableGauge");
            if (gaugeEl) gaugeEl.innerHTML = Skeleton.render('custom', { width: '100px', height: '55px' });
            const valueEl = el("#TB_BillableValue");
            if (valueEl) { valueEl.textContent = '--'; valueEl.className = 'risk-meter-value'; }
            const labelEl = el("#TB_BillableLabel");
            if (labelEl) { labelEl.textContent = 'LOADING'; labelEl.className = 'risk-meter-label'; }
            
            // Department cards
            const deptContainer = el("#tbDeptCardsContainer");
            if (deptContainer) {
                let cardsHtml = '<div class="row">';
                for (let i = 0; i < 4; i++) {
                    cardsHtml += `<div class="col-md-6 col-lg-3 mb-3">${Skeleton.render('card', { height: '120px', showHeader: false })}</div>`;
                }
                cardsHtml += '</div>';
                deptContainer.innerHTML = cardsHtml;
            }
            
            // Tables
            const tables = ['tbEmployeeTableBodyNew', 'tbItemTableBody'];
            tables.forEach(id => {
                const tbody = el('#' + id);
                if (tbody) tbody.innerHTML = this.renderTableSkeletonRows(6, 5);
            });
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

        renderSubsidiaryDropdown() {
            const sel = el("#tbSubsidiary");
            if (!sel) return;
            
            sel.innerHTML = '';
            
            if (!this.subsidiaries || this.subsidiaries.length === 0) {
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

        async loadData(startDate, endDate) {
            if (el("#TB_CompanyPercentBilled")) el("#TB_CompanyPercentBilled").innerHTML = '<i class="fas fa-circle-notch fa-spin text-muted"></i>';
            try {
                const params = {};
                if (startDate) params.startDate = startDate;
                if (endDate) params.endDate = endDate;
                if (this.subsidiaryId) params.subsidiary = this.subsidiaryId;
                const data = await API.get('time', params);
                this.rawData = data;
                this.renderDashboard(data);
            } catch (e) {
                console.error("Time dashboard error", e);
            }
        },

        renderDashboard(data) {
            if (!data || !data.meta) return;
            const range = data.meta.range || {};
            const company = data.company || {};
            this.latestDepts = data.departments || [];
            this.latestItems = data.items || [];
            this.latestEmployees = data.employees || [];

            if (el("#tbStartDate") && !el("#tbStartDate").value) el("#tbStartDate").value = range.start;
            if (el("#tbEndDate") && !el("#tbEndDate").value) el("#tbEndDate").value = range.end;
            if (el("#TB_RangeDays")) el("#TB_RangeDays").textContent = range.days || 0;

            this.renderTopline(company, this.latestDepts, this.latestItems, this.latestEmployees);
            this.renderCompanyTab(company);
            this.renderIntelligenceTab(data);
            this.renderDeptTab(this.latestDepts);
            this.initDeptFilters(this.latestDepts);
            this.renderItemTab(this.latestItems);
            this.renderEmployeeTab(this.latestEmployees);
            this.renderJobTitlesTab(this.latestEmployees);
            this.renderHistoryTab(data);
        },

        // === ENHANCED TOPLINE KPIs ===
        renderTopline(company, depts, items, employees) {
            const range = company.range || {};
            const deltas = company.deltas || {};
            const thresholds = company.thresholds || { targetBillablePercent: 70 };
            const target = thresholds.targetBillablePercent || 70;
            const pct = range.percentBilled || 0;
            
            // Render Billable Rate Gauge using risk-meter pattern (like Health dashboard)
            this.renderUtilizationMeterKPI(pct, target);
            
            // Other KPIs
            if(el("#TB_CompanyNonBillableCost")) el("#TB_CompanyNonBillableCost").textContent = fmtMoney(range.nonBillableCost);
            if(el("#TB_CompanyNonBillablePerDay")) el("#TB_CompanyNonBillablePerDay").textContent = fmtMoney(range.nonBillableCostPerDay);
            if(el("#TB_CompanyTotalHours")) el("#TB_CompanyTotalHours").textContent = fmtNum(range.hours, 1);
            if(el("#TB_CompanyBillableHours")) el("#TB_CompanyBillableHours").textContent = fmtNum(range.billableHours, 1);

            // Hotspots - find most problematic areas (exclude non-billable departments)
            const billableDepts = [...depts].filter(d => !d.noBillable);
            const topDept = billableDepts.sort((a, b) => (b.range?.nonBillableCost || 0) - (a.range?.nonBillableCost || 0))[0];
            
            // Filter items - exclude items that are purely from non-billable departments
            const topItem = [...items].sort((a, b) => (b.range?.nonBillableCost || 0) - (a.range?.nonBillableCost || 0))[0];
            
            // Filter employees from billable departments only
            const noBillDeptIds = new Set(depts.filter(d => d.noBillable).map(d => String(d.department.netsuiteId)));
            const minHours = thresholds.minimumHoursForAnalysis || 10;
            const qualifiedEmps = [...employees]
                .filter(e => (e.range?.hours || 0) >= minHours && !noBillDeptIds.has(String(e.employee.departmentId)))
                .sort((a, b) => (a.range?.percentBilled || 0) - (b.range?.percentBilled || 0));
            
            const lowEmp = qualifiedEmps[0];
            
            // Count others with same lowest rate
            let lowEmpText = "—";
            if (lowEmp) {
                const lowRate = Math.round(lowEmp.range?.percentBilled || 0);
                const sameRateCount = qualifiedEmps.filter(e => 
                    Math.round(e.range?.percentBilled || 0) === lowRate
                ).length;
                
                lowEmpText = `${lowEmp.employee.name} (${lowRate}%)`;
                if (sameRateCount > 1) {
                    lowEmpText += ` <span class="text-muted">+ ${sameRateCount - 1} other${sameRateCount > 2 ? 's' : ''}</span>`;
                }
            }

            if(el("#TB_HotspotDept")) el("#TB_HotspotDept").textContent = topDept ? topDept.department.name : "—";
            if(el("#TB_HotspotItem")) el("#TB_HotspotItem").textContent = topItem ? topItem.item.name : "—";
            if(el("#TB_HotspotEmployee")) el("#TB_HotspotEmployee").innerHTML = lowEmpText;
        },
        
        // Render utilization gauge exactly like Health dashboard's renderHealthMeterKPI
        renderUtilizationMeterKPI(pct, target) {
            const gaugeEl = el('#TB_BillableGauge');
            const valueEl = el('#TB_BillableValue');
            const labelEl = el('#TB_BillableLabel');
            
            if (!gaugeEl) return;
            
            // Determine color and label based on percentage vs target
            let color, label, colorClass;
            const diff = pct - target;
            if (diff >= 0) {
                color = '#10b981'; colorClass = 'text-success'; label = 'ON TARGET';
            } else if (diff >= -10) {
                color = '#f59e0b'; colorClass = 'text-warning'; label = 'NEAR TARGET';
            } else if (diff >= -20) {
                color = '#f97316'; colorClass = 'text-orange'; label = 'BELOW TARGET';
            } else {
                color = '#ef4444'; colorClass = 'text-danger'; label = 'AT RISK';
            }
            
            // Calculate arc offset (full arc = 141.37, higher pct = less offset)
            // Scale to 100 max for gauge display
            const displayPct = Math.min(pct, 100);
            const arcLength = 141.37;
            const offset = arcLength * (1 - displayPct / 100);
            
            gaugeEl.innerHTML = `<svg width="100" height="55" class="health-gauge-semi">
                <path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke="#e5e7eb" stroke-width="10" stroke-linecap="round"></path>
                <path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arcLength}" stroke-dashoffset="${offset}" style="transition: stroke-dashoffset 0.5s ease;"></path>
            </svg>`;
            
            if (valueEl) {
                valueEl.textContent = pct.toFixed(1) + '%';
                valueEl.className = 'risk-meter-value ' + colorClass;
            }
            if (labelEl) {
                labelEl.textContent = label;
                labelEl.className = 'risk-meter-label ' + colorClass;
            }
        },

        // === ENHANCED COMPANY TAB ===
        renderCompanyTab(company) {
            const range = company.range || {};
            const prior = company.priorRange || {};
            const deltas = company.deltas || {};
            const thresholds = company.thresholds || {};
            const tbody = el("#tbCompanySummaryBody");
            if (!tbody) return;
            tbody.innerHTML = "";

            const addRow = (label, rVal, pVal, dHtml) => {
                tbody.innerHTML += `<tr><td class="font-weight-500 text-dark">${label}</td><td class="text-right font-weight-bold">${rVal}</td><td class="text-right text-muted">${pVal}</td><td class="text-right">${dHtml||"—"}</td></tr>`;
            };

            addRow("Percent Billed", fmtPctVal(range.percentBilled, 1), fmtPctVal(prior.percentBilled, 1), getTrendHtml(deltas.percentBilledDelta, true));
            addRow("Non-Billable Cost", fmtMoney(range.nonBillableCost), fmtMoney(prior.nonBillableCost), getTrendHtml(deltas.nonBillableCostDelta, false));
            addRow("Total Hours", fmtNum(range.hours, 1), fmtNum(prior.hours, 1), getTrendHtml((range.hours||0)-(prior.hours||0), true));
            addRow("Billable Hours", fmtNum(range.billableHours, 1), fmtNum(prior.billableHours, 1), getTrendHtml((range.billableHours||0)-(prior.billableHours||0), true));
            addRow("Non-Billable Hours", fmtNum(range.nonBillableHours, 1), fmtNum(prior.nonBillableHours, 1), getTrendHtml((range.nonBillableHours||0)-(prior.nonBillableHours||0), false));
            addRow("Cost Per Day", fmtMoney(range.nonBillableCostPerDay), fmtMoney(prior.nonBillableCostPerDay), "—");
            
            // Alerts
            const alertUl = el("#tbCompanyAlerts");
            if (alertUl) {
                alertUl.innerHTML = "";
                const alerts = company.alerts || [];
                if (alerts.length > 0) {
                    alerts.forEach(a => {
                        const icon = a.type === 'danger' ? 'fa-exclamation-circle text-danger' : 'fa-exclamation-triangle text-warning';
                        alertUl.innerHTML += `<li class="mb-2"><i class="fas ${icon} mr-2"></i>${a.message}</li>`;
                    });
                } else {
                    alertUl.innerHTML = '<li class="text-success"><i class="fas fa-check-circle mr-2"></i>All metrics within target.</li>';
                }
            }
            
            // Render company charts
            this.renderCompanyHoursChart(range);
            this.renderCompanyDeptChart();
        },
        
        renderCompanyHoursChart(range) {
            const container = el("#tbCompanyHoursChart");
            if (!container || !window.Plotly) return;
            
            const billable = range.billableHours || 0;
            const nonBillable = range.nonBillableHours || 0;
            
            if (billable === 0 && nonBillable === 0) {
                container.innerHTML = '<div class="text-center text-muted py-4"><i class="fas fa-chart-pie fa-2x mb-2 opacity-50"></i><div class="small">No data</div></div>';
                return;
            }
            
            const data = [{
                type: 'pie',
                values: [billable, nonBillable],
                labels: ['Billable', 'Non-Billable'],
                marker: {
                    colors: ['#10b981', '#ef4444']
                },
                hole: 0.5,
                textinfo: 'label+percent',
                textposition: 'outside',
                textfont: { size: 11 },
                hovertemplate: '<b>%{label}</b><br>%{value:.1f} hours<br>%{percent}<extra></extra>'
            }];
            
            const layout = {
                margin: { t: 10, b: 10, l: 10, r: 10 },
                showlegend: false,
                paper_bgcolor: 'transparent',
                annotations: [{
                    text: `<b>${fmtNum(billable + nonBillable, 0)}</b><br>hours`,
                    showarrow: false,
                    font: { size: 12, color: '#374151' }
                }]
            };
            
            Plotly.newPlot(container, data, layout, { responsive: true, displayModeBar: false });
        },
        
        renderCompanyDeptChart() {
            const container = el("#tbCompanyDeptChart");
            if (!container || !window.Plotly) return;
            
            const depts = this.latestDepts || [];
            if (depts.length === 0) {
                container.innerHTML = '<div class="text-center text-muted py-4"><i class="fas fa-building fa-2x mb-2 opacity-50"></i><div class="small">No data</div></div>';
                return;
            }
            
            // Sort by non-billable cost and take top 5
            const sorted = [...depts]
                .filter(d => !d.noBillable && !d.hidden)
                .sort((a, b) => (b.range?.nonBillableCost || 0) - (a.range?.nonBillableCost || 0))
                .slice(0, 5);
            
            const target = this.rawData?.company?.thresholds?.targetBillablePercent || 70;
            
            const names = sorted.map(d => d.department.name.length > 15 ? d.department.name.substring(0, 15) + '...' : d.department.name);
            const costs = sorted.map(d => d.range?.nonBillableCost || 0);
            const colors = sorted.map(d => {
                const pct = d.range?.percentBilled || 0;
                return pct >= target ? '#10b981' : pct >= target - 10 ? '#f59e0b' : '#ef4444';
            });
            
            const data = [{
                type: 'bar',
                x: costs,
                y: names,
                orientation: 'h',
                marker: { color: colors },
                text: costs.map(c => fmtMoney(c, 0)),
                textposition: 'outside',
                textfont: { size: 10 },
                hovertemplate: '<b>%{y}</b><br>Non-Bill Cost: %{x:$,.0f}<extra></extra>'
            }];
            
            const layout = {
                margin: { t: 5, b: 25, l: 100, r: 50 },
                xaxis: { 
                    showgrid: true, 
                    gridcolor: '#f3f4f6',
                    tickformat: '$,.0s'
                },
                yaxis: { 
                    autorange: 'reversed',
                    tickfont: { size: 10 }
                },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                bargap: 0.3
            };
            
            Plotly.newPlot(container, data, layout, { responsive: true, displayModeBar: false });
        },


        // ═══════════════════════════════════════════════════════════════════════════
        // INTELLIGENCE TAB - Sub-tabs for Forecasting, Anomalies, Analysis, What-If
        // ═══════════════════════════════════════════════════════════════════════════
        
        intelligenceState: {
            activeSubTab: 'forecasting'
        },
        
        renderIntelligenceTab(data) {
            const container = el("#tbIntelligenceContainer");
            if (!container) return;

            const company = data.company || {};
            const range = company.range || {};
            const priorRange = company.priorRange || {};
            const thresholds = company.thresholds || { targetBillablePercent: 70 };
            const target = thresholds.targetBillablePercent || 70;
            const history = data.history || {};
            
            // Get visible/filterable employees and depts respecting config
            const { employees, depts } = this.getFilteredDataForIntelligence();
            
            // Store for sub-tab access
            this.intelligenceData = { company, range, priorRange, thresholds, target, history, employees, depts };
            
            // Build sub-tabs structure like Integrity
            const activeTab = this.intelligenceState.activeSubTab || 'forecasting';
            
            container.innerHTML = `
                <ul class="nav nav-pills tb-intelligence-sub-tabs mb-3">
                    <li class="nav-item">
                        <a class="nav-link ${activeTab === 'forecasting' ? 'active' : ''}" href="#" onclick="TimeController.switchIntelligenceTab('forecasting'); return false;">
                            <i class="fas fa-chart-line mr-1"></i>Forecasting
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link ${activeTab === 'anomalies' ? 'active' : ''}" href="#" onclick="TimeController.switchIntelligenceTab('anomalies'); return false;">
                            <i class="fas fa-exclamation-triangle mr-1"></i>Anomalies
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link ${activeTab === 'analysis' ? 'active' : ''}" href="#" onclick="TimeController.switchIntelligenceTab('analysis'); return false;">
                            <i class="fas fa-balance-scale mr-1"></i>Peer Analysis
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link ${activeTab === 'whatif' ? 'active' : ''}" href="#" onclick="TimeController.switchIntelligenceTab('whatif'); return false;">
                            <i class="fas fa-calculator mr-1"></i>What-If
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link ${activeTab === 'treemap' ? 'active' : ''}" href="#" onclick="TimeController.switchIntelligenceTab('treemap'); return false;">
                            <i class="fas fa-th-large mr-1"></i>Treemap
                        </a>
                    </li>
                </ul>
                <div id="tbIntelligenceSubContent"></div>
            `;
            
            this.renderIntelligenceSubTab(activeTab);
        },
        
        switchIntelligenceTab(tabName) {
            this.intelligenceState.activeSubTab = tabName;
            
            // Update active state on pills
            document.querySelectorAll('.tb-intelligence-sub-tabs .nav-link').forEach(link => {
                link.classList.remove('active');
                if (link.textContent.toLowerCase().includes(tabName.substring(0, 4))) {
                    link.classList.add('active');
                }
            });
            
            this.renderIntelligenceSubTab(tabName);
        },
        
        renderIntelligenceSubTab(tabName) {
            const container = el("#tbIntelligenceSubContent");
            if (!container || !this.intelligenceData) return;
            
            const { company, range, priorRange, thresholds, target, history, employees, depts } = this.intelligenceData;
            
            switch (tabName) {
                case 'forecasting':
                    this.renderForecastingSubTab(container, history, range, priorRange, target);
                    break;
                case 'anomalies':
                    this.renderAnomaliesSubTab(container, employees, depts, thresholds);
                    break;
                case 'analysis':
                    this.renderPeerAnalysisSubTab(container, employees, thresholds, target);
                    break;
                case 'whatif':
                    this.renderWhatIfSubTab(container, employees, depts, thresholds);
                    break;
                case 'treemap':
                    this.renderTreemapSubTab(container, depts, employees);
                    break;
            }
        },
        
        // Get employees/depts filtered by visibility settings
        getFilteredDataForIntelligence() {
            const thresholds = this.rawData?.company?.thresholds || {};
            const noBillDeptIds = new Set();
            const hiddenDeptIds = new Set();
            
            // Build sets of non-billable and hidden departments
            (this.latestDepts || []).forEach(d => {
                if (d.noBillable) noBillDeptIds.add(String(d.department.netsuiteId));
                if (d.hidden) hiddenDeptIds.add(String(d.department.netsuiteId));
            });
            
            // Filter departments - exclude hidden and non-billable
            const depts = (this.latestDepts || []).filter(d => 
                !d.noBillable && !d.hidden
            );
            
            // Filter employees - exclude those in non-billable or hidden departments
            const employees = (this.latestEmployees || []).filter(e => {
                const deptId = String(e.employee.departmentId || '');
                return !noBillDeptIds.has(deptId) && !hiddenDeptIds.has(deptId);
            });
            
            return { employees, depts };
        },
        
        // === FORECASTING SUB-TAB ===
        renderForecastingSubTab(container, history, range, priorRange, target) {
            const forecasts = this.calculateForecasts(history, range, priorRange, target);
            
            container.innerHTML = `
                <!-- KPI Row using shared cf-kpi-card -->
                <div class="row mb-4 gutters-sm cf-kpi-row">
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-blue-soft"><i class="fas fa-chart-line text-blue"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Projected Billable %</span>
                                <span class="kpi-value ${forecasts.projectedBillable >= target ? 'text-success' : forecasts.projectedBillable >= target - 10 ? 'text-warning' : 'text-danger'}">${fmtPctVal(forecasts.projectedBillable, 1)}</span>
                                <span class="kpi-sub">${forecasts.billableTrend >= 0 ? '↑' : '↓'} ${Math.abs(forecasts.billableTrend).toFixed(1)}pp trend</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper ${forecasts.costTrend <= 0 ? 'bg-green-soft' : 'bg-red-soft'}"><i class="fas fa-dollar-sign ${forecasts.costTrend <= 0 ? 'text-green' : 'text-red'}"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Projected Non-Bill Cost</span>
                                <span class="kpi-value ${forecasts.costTrend <= 0 ? 'text-success' : 'text-danger'}">${fmtMoney(forecasts.projectedCost)}</span>
                                <span class="kpi-sub">${forecasts.costTrend <= 0 ? '↓' : '↑'} ${fmtMoney(Math.abs(forecasts.costTrend))} trajectory</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-bullseye text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Target Status</span>
                                <span class="kpi-value ${forecasts.projectedBillable >= target ? 'text-success' : 'text-warning'}">${forecasts.projectedBillable >= target ? 'On Track' : 'At Risk'}</span>
                                <span class="kpi-sub">target: ${target}%</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-gray-soft"><i class="fas fa-database text-gray"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Confidence</span>
                                <span class="kpi-value">${forecasts.confidence}%</span>
                                <span class="kpi-sub">${forecasts.dataPoints} data points</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="card shadow-sm">
                    <div class="card-header bg-light py-2">
                        <h6 class="mb-0"><i class="fas fa-chart-area mr-2"></i>Billable % Trend with Forecast</h6>
                    </div>
                    <div class="card-body">
                        <div id="tbForecastChart" style="height: 280px;"></div>
                    </div>
                </div>
                
                <div class="alert alert-info mt-3">
                    <i class="fas fa-info-circle mr-2"></i>
                    <strong>Methodology:</strong> Forecasts use linear regression on historical periods. 
                    Higher billable % naturally correlates with lower non-billable costs as the same hours shift from non-billable to billable work.
                </div>
            `;
            
            setTimeout(() => this.renderForecastChart(forecasts), 100);
        },
        
        // === ANOMALIES SUB-TAB (Employee Utilization Anomalies) ===
        renderAnomaliesSubTab(container, employees, depts, thresholds) {
            const anomalies = this.detectEmployeeAnomalies(employees, depts, thresholds);
            
            container.innerHTML = `
                <!-- Anomaly KPIs -->
                <div class="row mb-4 gutters-sm cf-kpi-row">
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-red-soft"><i class="fas fa-exclamation-triangle text-red"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Total Issues</span>
                                <span class="kpi-value ${anomalies.total > 0 ? 'text-danger' : 'text-success'}">${anomalies.total}</span>
                                <span class="kpi-sub">detected anomalies</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-danger-soft"><i class="fas fa-arrow-down text-danger"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Sudden Drops</span>
                                <span class="kpi-value">${anomalies.suddenDrops.length}</span>
                                <span class="kpi-sub">employees with &gt;15pp drop</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-warning-soft"><i class="fas fa-clock text-warning"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Overtime No Value</span>
                                <span class="kpi-value">${anomalies.overtimeNoValue.length}</span>
                                <span class="kpi-sub">high hours, low billable</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-user-tag text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Title Drift</span>
                                <span class="kpi-value">${anomalies.titleDrift.length}</span>
                                <span class="kpi-sub">roles trending down</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="row">
                    <!-- Sudden Drop Detector -->
                    <div class="col-md-4 mb-3">
                        <div class="card shadow-sm h-100">
                            <div class="card-header bg-light py-2">
                                <h6 class="mb-0"><i class="fas fa-arrow-down mr-2"></i>Sudden Drop</h6>
                            </div>
                            <div class="card-body p-0">
                                <div class="small text-muted px-3 py-2 border-bottom">Employees whose billable % dropped &gt;15pp from prior period</div>
                                ${anomalies.suddenDrops.length > 0 ? `
                                    <div class="list-group list-group-flush" style="max-height: 250px; overflow-y: auto;">
                                        ${anomalies.suddenDrops.map(a => `
                                            <div class="list-group-item d-flex justify-content-between align-items-center py-2">
                                                <span class="text-truncate" style="max-width: 150px;" title="${a.name}">${a.name}</span>
                                                <span class="badge badge-danger">${fmtPctVal(a.drop, 0)}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : '<div class="text-center text-success py-4"><i class="fas fa-check-circle fa-2x mb-2"></i><div>No sudden drops detected</div></div>'}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Overtime Without Value -->
                    <div class="col-md-4 mb-3">
                        <div class="card shadow-sm h-100">
                            <div class="card-header bg-light py-2">
                                <h6 class="mb-0"><i class="fas fa-clock mr-2"></i>Overtime No Value</h6>
                            </div>
                            <div class="card-body p-0">
                                <div class="small text-muted px-3 py-2 border-bottom">20%+ more hours than avg but billable 20pp below target</div>
                                ${anomalies.overtimeNoValue.length > 0 ? `
                                    <div class="list-group list-group-flush" style="max-height: 250px; overflow-y: auto;">
                                        ${anomalies.overtimeNoValue.map(a => `
                                            <div class="list-group-item d-flex justify-content-between align-items-center py-2">
                                                <span class="text-truncate" style="max-width: 120px;" title="${a.name}">${a.name}</span>
                                                <span><span class="text-muted small">${fmtNum(a.hours, 0)}h</span> <span class="badge badge-warning">${fmtPctVal(a.pct, 0)}</span></span>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : '<div class="text-center text-success py-4"><i class="fas fa-check-circle fa-2x mb-2"></i><div>No issues detected</div></div>'}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Title Drift -->
                    <div class="col-md-4 mb-3">
                        <div class="card shadow-sm h-100">
                            <div class="card-header bg-light py-2">
                                <h6 class="mb-0"><i class="fas fa-user-tag mr-2"></i>Title Drift</h6>
                            </div>
                            <div class="card-body p-0">
                                <div class="small text-muted px-3 py-2 border-bottom">Job titles where ALL employees are trending down</div>
                                ${anomalies.titleDrift.length > 0 ? `
                                    <div class="list-group list-group-flush" style="max-height: 250px; overflow-y: auto;">
                                        ${anomalies.titleDrift.map(a => `
                                            <div class="list-group-item d-flex justify-content-between align-items-center py-2">
                                                <span class="text-truncate" style="max-width: 120px;" title="${a.title}">${a.title}</span>
                                                <span><span class="text-muted small">${a.count} emp</span> <span class="badge badge-secondary">${fmtPctVal(a.avgDrop, 0)} avg</span></span>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : '<div class="text-center text-success py-4"><i class="fas fa-check-circle fa-2x mb-2"></i><div>No drifting titles</div></div>'}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="alert alert-light border mt-2">
                    <i class="fas fa-filter mr-2 text-muted"></i>
                    <small class="text-muted">Anomaly detection excludes employees in non-billable or hidden departments per your configuration settings.</small>
                </div>
            `;
        },
        
        // === PEER ANALYSIS SUB-TAB ===
        renderPeerAnalysisSubTab(container, employees, thresholds, target) {
            const peerComparison = this.calculatePeerComparison(employees, thresholds);
            
            // Calculate summary stats
            const titlesWithOutliers = peerComparison.filter(p => p.outliers > 0).length;
            const avgSpread = peerComparison.length > 0 
                ? peerComparison.reduce((sum, p) => sum + p.spread, 0) / peerComparison.length 
                : 0;
            
            container.innerHTML = `
                <!-- Peer Analysis KPIs -->
                <div class="row mb-4 gutters-sm cf-kpi-row">
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-blue-soft"><i class="fas fa-user-tag text-blue"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Job Titles Analyzed</span>
                                <span class="kpi-value">${peerComparison.length}</span>
                                <span class="kpi-sub">with 2+ employees</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-yellow-soft"><i class="fas fa-exclamation-circle text-yellow"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Titles with Outliers</span>
                                <span class="kpi-value ${titlesWithOutliers > 0 ? 'text-warning' : 'text-success'}">${titlesWithOutliers}</span>
                                <span class="kpi-sub">performance variance</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-arrows-alt-h text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Avg Spread</span>
                                <span class="kpi-value">${fmtPctVal(avgSpread, 0)}</span>
                                <span class="kpi-sub">max - min within title</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-green-soft"><i class="fas fa-bullseye text-green"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Target</span>
                                <span class="kpi-value">${target}%</span>
                                <span class="kpi-sub">billable threshold</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="card shadow-sm">
                    <div class="card-header bg-light py-2">
                        <h6 class="mb-0"><i class="fas fa-balance-scale mr-2"></i>Peer Comparison by Job Title</h6>
                    </div>
                    <div class="card-body p-0">
                        <div class="small text-muted px-3 py-2 border-bottom">Compare employees doing similar work (engineers vs engineers, managers vs managers)</div>
                        <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                            <table class="table table-sm table-hover mb-0">
                                <thead class="bg-light sticky-top">
                                    <tr>
                                        <th>Job Title</th>
                                        <th class="text-center">Employees</th>
                                        <th class="text-right">Avg %</th>
                                        <th class="text-right">Min</th>
                                        <th class="text-right">Max</th>
                                        <th class="text-right">Spread</th>
                                        <th class="text-center">Outliers</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${peerComparison.map(p => `
                                        <tr>
                                            <td class="text-truncate" style="max-width: 150px;" title="${p.title}">${p.title}</td>
                                            <td class="text-center">${p.count}</td>
                                            <td class="text-right ${p.avg >= target ? 'text-success' : p.avg >= target - 10 ? 'text-warning' : 'text-danger'} font-weight-bold">${fmtPctVal(p.avg, 0)}</td>
                                            <td class="text-right text-muted">${fmtPctVal(p.min, 0)}</td>
                                            <td class="text-right text-muted">${fmtPctVal(p.max, 0)}</td>
                                            <td class="text-right ${p.spread > 30 ? 'text-danger' : p.spread > 20 ? 'text-warning' : ''}">${fmtPctVal(p.spread, 0)}</td>
                                            <td class="text-center">${p.outliers > 0 ? '<span class="badge badge-warning">' + p.outliers + '</span>' : '<span class="text-success">—</span>'}</td>
                                        </tr>
                                    `).join('') || '<tr><td colspan="7" class="text-center text-muted py-4">No titles with 2+ employees for comparison</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                
                <div class="alert alert-info mt-3">
                    <i class="fas fa-info-circle mr-2"></i>
                    <strong>Outliers</strong> are employees whose billable % is more than 1.5 standard deviations from their title's average. 
                    High spread or outliers may indicate training gaps, workload imbalances, or role mismatches.
                </div>
            `;
        },
        
        // === WHAT-IF SUB-TAB ===
        renderWhatIfSubTab(container, employees, depts, thresholds) {
            const whatIfScenarios = this.calculateWhatIfScenarios(employees, depts, thresholds);
            const be = whatIfScenarios.breakEven;
            
            // Hiring outlook badge
            const outlookBadge = be.hiringOutlook === 'favorable' 
                ? '<span class="badge badge-success">Favorable</span>'
                : be.hiringOutlook === 'neutral'
                    ? '<span class="badge badge-warning">Neutral</span>'
                    : '<span class="badge badge-danger">Challenging</span>';
            
            container.innerHTML = `
                <!-- What-If KPIs - Unique metrics not repeated below -->
                <div class="row mb-4 gutters-sm cf-kpi-row">
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-green-soft"><i class="fas fa-lightbulb text-green"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Opportunities</span>
                                <span class="kpi-value">${whatIfScenarios.improvements.length}</span>
                                <span class="kpi-sub">improvement scenarios</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-blue-soft"><i class="fas fa-dollar-sign text-blue"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Potential Savings</span>
                                <span class="kpi-value text-success">${fmtMoney(whatIfScenarios.improvements.reduce((sum, i) => sum + i.savings, 0))}</span>
                                <span class="kpi-sub">if all implemented</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-tachometer-alt text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Efficiency Score</span>
                                <span class="kpi-value ${be.efficiencyScore >= 70 ? 'text-success' : be.efficiencyScore >= 50 ? 'text-warning' : 'text-danger'}">${be.efficiencyScore}</span>
                                <span class="kpi-sub">out of 100</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-gray-soft"><i class="fas fa-expand-arrows-alt text-gray"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Capacity Headroom</span>
                                <span class="kpi-value">${be.capacityHeadroom}</span>
                                <span class="kpi-sub">hires at current efficiency</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="row">
                    <!-- Improvement Opportunities -->
                    <div class="col-md-7 mb-3">
                        <div class="card shadow-sm h-100">
                            <div class="card-header bg-light py-2">
                                <h6 class="mb-0"><i class="fas fa-lightbulb mr-2"></i>Improvement Opportunities</h6>
                            </div>
                            <div class="card-body p-0">
                                <div class="small text-muted px-3 py-2 border-bottom">"If we improved [Title X] by 5%, we'd save $Y"</div>
                                ${whatIfScenarios.improvements.length > 0 ? `
                                    <div class="list-group list-group-flush" style="max-height: 300px; overflow-y: auto;">
                                        ${whatIfScenarios.improvements.slice(0, 8).map(s => `
                                            <div class="list-group-item d-flex justify-content-between align-items-center">
                                                <div>
                                                    <div class="font-weight-500">${s.description}</div>
                                                    <small class="text-muted">${s.detail}</small>
                                                </div>
                                                <span class="badge badge-success badge-pill">Save ${fmtMoney(s.savings)}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : '<div class="text-center text-muted py-4">No improvement opportunities identified</div>'}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Enhanced Hiring Break-Even Analysis -->
                    <div class="col-md-5 mb-3">
                        <div class="card shadow-sm h-100">
                            <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                                <h6 class="mb-0"><i class="fas fa-user-plus mr-2"></i>Hiring Intelligence</h6>
                                ${outlookBadge}
                            </div>
                            <div class="card-body">
                                <!-- Key Metrics Grid -->
                                <div class="row text-center mb-3">
                                    <div class="col-6 border-right">
                                        <div class="small text-muted">Break-Even Rate</div>
                                        <div class="h4 mb-0 text-primary">${fmtPctVal(be.requiredBillable, 0)}</div>
                                        <div class="small text-muted">billable %</div>
                                    </div>
                                    <div class="col-6">
                                        <div class="small text-muted">Avg Cost/Employee</div>
                                        <div class="h4 mb-0">${fmtMoney(be.costPerEmployee, 0)}</div>
                                        <div class="small text-muted">non-billable</div>
                                    </div>
                                </div>
                                
                                <!-- Detailed Metrics -->
                                <div class="border rounded p-2 mb-3 bg-light">
                                    <div class="d-flex justify-content-between small py-1 border-bottom">
                                        <span class="text-muted">Current Team Avg Billable</span>
                                        <strong class="${be.avgBillable >= thresholds.targetBillablePercent ? 'text-success' : 'text-warning'}">${fmtPctVal(be.avgBillable, 1)}</strong>
                                    </div>
                                    <div class="d-flex justify-content-between small py-1 border-bottom">
                                        <span class="text-muted">Avg Hours/Employee</span>
                                        <strong>${fmtNum(be.avgHoursPerEmployee, 1)}</strong>
                                    </div>
                                    <div class="d-flex justify-content-between small py-1 border-bottom">
                                        <span class="text-muted">Cost per Non-Bill Hour</span>
                                        <strong>${fmtMoney(be.costPerNonBillableHour)}</strong>
                                    </div>
                                    <div class="d-flex justify-content-between small py-1">
                                        <span class="text-muted">Total Employees</span>
                                        <strong>${be.totalEmployees}</strong>
                                    </div>
                                </div>
                                
                                <!-- Best/Worst Performers -->
                                ${be.bestTitle ? `
                                <div class="d-flex mb-2" style="gap: 8px;">
                                    <div class="flex-fill p-2 border rounded bg-success-soft small">
                                        <div class="text-muted">Best Title</div>
                                        <div class="font-weight-bold text-truncate" title="${be.bestTitle.title}">${be.bestTitle.title}</div>
                                        <div class="text-success">${fmtPctVal(be.bestTitle.avgPct, 0)} avg</div>
                                    </div>
                                    ${be.worstTitle ? `
                                    <div class="flex-fill p-2 border rounded bg-red-soft small">
                                        <div class="text-muted">Needs Focus</div>
                                        <div class="font-weight-bold text-truncate" title="${be.worstTitle.title}">${be.worstTitle.title}</div>
                                        <div class="text-danger">${fmtPctVal(be.worstTitle.avgPct, 0)} avg</div>
                                    </div>
                                    ` : ''}
                                </div>
                                ` : ''}
                                
                                <!-- Recommendation -->
                                <div class="alert alert-light mb-0 py-2">
                                    <i class="fas fa-lightbulb mr-2 text-warning"></i>
                                    <small>${be.recommendation}</small>
                                </div>
                            </div>
                        </div>
                        
                        ${whatIfScenarios.reallocations.length > 0 ? `
                        <div class="card shadow-sm mt-3">
                            <div class="card-header bg-light py-2">
                                <h6 class="mb-0"><i class="fas fa-exchange-alt mr-2"></i>Reallocation Ideas</h6>
                            </div>
                            <div class="card-body p-0">
                                <div class="list-group list-group-flush">
                                    ${whatIfScenarios.reallocations.slice(0, 3).map(r => `
                                        <div class="list-group-item py-2">
                                            <div class="d-flex align-items-center small">
                                                <span class="text-truncate" style="max-width: 80px;">${r.from}</span>
                                                <i class="fas fa-arrow-right mx-2 text-muted"></i>
                                                <span class="text-truncate" style="max-width: 80px;">${r.to}</span>
                                                <span class="ml-auto badge badge-info">${r.employees} emp</span>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        },
        
        // === TREEMAP SUB-TAB ===
        renderTreemapSubTab(container, depts, employees) {
            const treemapData = this.buildTreemapData(depts, employees);
            const target = this.rawData?.company?.thresholds?.targetBillablePercent || 70;
            
            // Calculate summary stats for the header
            const totalHours = depts.reduce((sum, d) => sum + (d.range?.hours || 0), 0);
            const avgBillable = totalHours > 0 
                ? (depts.reduce((sum, d) => sum + (d.range?.billableHours || 0), 0) / totalHours) * 100 
                : 0;
            
            container.innerHTML = `
                <!-- Legend -->
                <div class="tb-treemap-legend mb-3">
                    <span class="legend-label">Non-Billable</span>
                    <div class="legend-gradient"></div>
                    <span class="legend-label">Billable</span>
                </div>
                
                <!-- Main Treemap -->
                <div class="tb-treemap-wrapper">
                    <div id="tbTreemapChart"></div>
                </div>
                
                <!-- Help Text -->
                <div class="tb-treemap-help mt-3">
                    <div class="help-item"><i class="fas fa-hand-pointer"></i> Click to drill down</div>
                    <div class="help-item"><i class="fas fa-expand-arrows-alt"></i> Size = Hours worked</div>
                    <div class="help-item"><i class="fas fa-palette"></i> Color = Billable %</div>
                    <div class="help-item"><i class="fas fa-level-up-alt"></i> Click path bar to navigate up</div>
                </div>
            `;
            
            setTimeout(() => this.renderTreemap(treemapData, target), 100);
        },

        // === FORECASTING CALCULATIONS (Fixed: billable up = cost down) ===
        calculateForecasts(history, currentRange, priorRange, target) {
            const periods = history?.periods || [];
            const dataPoints = periods.length + 1;
            
            // Build time series (oldest to newest)
            const billableSeries = periods.map(p => p.companyPct || 0).reverse();
            billableSeries.push(currentRange.percentBilled || 0);
            
            // Linear regression for forecasting billable %
            const forecast = (series) => {
                if (series.length < 2) return { projected: series[series.length - 1] || 0, trend: 0 };
                
                const n = series.length;
                let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
                
                for (let i = 0; i < n; i++) {
                    sumX += i;
                    sumY += series[i];
                    sumXY += i * series[i];
                    sumXX += i * i;
                }
                
                const denom = n * sumXX - sumX * sumX;
                if (denom === 0) return { projected: series[series.length - 1] || 0, trend: 0 };
                
                const slope = (n * sumXY - sumX * sumY) / denom;
                const intercept = (sumY - slope * sumX) / n;
                
                const projected = intercept + slope * n;
                return { projected: Math.max(0, projected), trend: slope };
            };
            
            const billableForecast = forecast(billableSeries);
            const projectedBillable = Math.min(100, Math.max(0, billableForecast.projected));
            
            // Cost projection: INVERSE relationship with billable %
            // If billable % goes UP, non-billable % goes DOWN, so cost goes DOWN
            const currentCost = currentRange.nonBillableCost || 0;
            const currentBillable = currentRange.percentBilled || 0;
            const currentNonBillablePct = 100 - currentBillable;
            const projectedNonBillablePct = 100 - projectedBillable;
            
            // Calculate cost change proportional to non-billable % change
            let projectedCost = currentCost;
            
            // FIXED: Handle edge case where current period is at or near 100% billable
            if (currentNonBillablePct <= 0.01) {
                // Currently at or near 100% billable
                if (projectedNonBillablePct > 0.01) {
                    // Trending toward having non-billable work - estimate using available cost data
                    const totalHours = currentRange.hours || 0;
                    const nonBillableHours = currentRange.nonBillableHours || 0;
                    // Use historical cost per non-billable hour, or estimate from company averages
                    const avgCostPerHour = (nonBillableHours > 0 && currentCost > 0) 
                        ? currentCost / nonBillableHours 
                        : (currentRange.nonBillableCostPerHour || 50); // Fallback estimate
                    const projectedNonBillHours = totalHours * (projectedNonBillablePct / 100);
                    projectedCost = projectedNonBillHours * avgCostPerHour;
                } else {
                    // Staying at 100% billable - no non-billable cost
                    projectedCost = 0;
                }
            } else if (currentNonBillablePct > 0) {
                projectedCost = currentCost * (projectedNonBillablePct / currentNonBillablePct);
            }
            
            // Sanity bounds
            projectedCost = Math.max(0, Math.min(currentCost * 2, projectedCost));
            const costTrend = projectedCost - currentCost;
            
            // Confidence based on data consistency
            const variance = (series) => {
                if (series.length < 2) return 100;
                const mean = series.reduce((a, b) => a + b, 0) / series.length;
                const squaredDiffs = series.map(v => Math.pow(v - mean, 2));
                return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / series.length);
            };
            
            const billableVariance = variance(billableSeries);
            const confidence = Math.max(30, Math.min(95, 100 - billableVariance));
            
            return {
                projectedBillable,
                billableTrend: billableForecast.trend,
                projectedCost,
                costTrend,
                confidence: Math.round(confidence),
                dataPoints,
                series: { billable: billableSeries }
            };
        },

        /**
         * Detect employee utilization anomalies (billable %, overtime, title drift)
         * (Renamed from detectAnomalies for clarity - this is employee time-specific)
         */
        detectEmployeeAnomalies(employees, depts, thresholds) {
            const target = thresholds.targetBillablePercent || 70;
            const minHours = thresholds.minimumHoursForAnalysis || 10;
            
            // Sudden Drop Detector
            const suddenDrops = employees
                .filter(e => {
                    const delta = e.deltas?.percentBilledDelta;
                    return (e.range?.hours || 0) >= minHours && 
                           delta !== undefined && 
                           delta < -15;
                })
                .map(e => ({
                    name: e.employee.name,
                    current: e.range?.percentBilled || 0,
                    prior: e.priorRange?.percentBilled || 0,
                    drop: e.deltas?.percentBilledDelta || 0
                }))
                .sort((a, b) => a.drop - b.drop)
                .slice(0, 10);
            
            // Overtime Without Value
            const totalHours = employees.reduce((sum, e) => sum + (e.range?.hours || 0), 0);
            const avgHours = employees.length > 0 ? totalHours / employees.length : 0;
            
            const overtimeNoValue = employees
                .filter(e => {
                    const hours = e.range?.hours || 0;
                    const pct = e.range?.percentBilled || 0;
                    return hours >= avgHours * 1.2 && pct < target - 20;
                })
                .map(e => ({
                    name: e.employee.name,
                    hours: e.range?.hours || 0,
                    pct: e.range?.percentBilled || 0
                }))
                .sort((a, b) => b.hours - a.hours)
                .slice(0, 10);
            
            // Title Drift
            const titleGroups = {};
            employees.forEach(e => {
                const title = e.employee.title || 'No Title';
                if (!titleGroups[title]) titleGroups[title] = [];
                if ((e.range?.hours || 0) >= minHours && e.deltas?.percentBilledDelta !== undefined) {
                    titleGroups[title].push(e.deltas.percentBilledDelta);
                }
            });
            
            const titleDrift = Object.entries(titleGroups)
                .map(([title, deltas]) => {
                    if (deltas.length < 2) return null;
                    const avgDrop = deltas.reduce((a, b) => a + b, 0) / deltas.length;
                    const allNegative = deltas.every(d => d < 0);
                    return { title, avgDrop, count: deltas.length, allNegative };
                })
                .filter(t => t && t.avgDrop < -5 && t.allNegative)
                .sort((a, b) => a.avgDrop - b.avgDrop)
                .slice(0, 5);
            
            return {
                suddenDrops,
                overtimeNoValue,
                titleDrift,
                total: suddenDrops.length + overtimeNoValue.length + titleDrift.length
            };
        },

        // === PEER COMPARISON ===
        calculatePeerComparison(employees, thresholds) {
            const minHours = thresholds.minimumHoursForAnalysis || 10;
            
            const titleGroups = {};
            employees.forEach(e => {
                if ((e.range?.hours || 0) < minHours) return;
                const title = e.employee.title || 'No Title';
                if (!titleGroups[title]) titleGroups[title] = [];
                titleGroups[title].push(e.range?.percentBilled || 0);
            });
            
            return Object.entries(titleGroups)
                .filter(([_, pcts]) => pcts.length >= 2)
                .map(([title, pcts]) => {
                    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
                    const min = Math.min(...pcts);
                    const max = Math.max(...pcts);
                    const spread = max - min;
                    const stdDev = Math.sqrt(pcts.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / pcts.length);
                    const outliers = pcts.filter(p => Math.abs(p - avg) > stdDev * 1.5).length;
                    
                    return { title, count: pcts.length, avg, spread, min, max, outliers };
                })
                .sort((a, b) => b.count - a.count);
        },

        // === WHAT-IF SCENARIOS ===
        calculateWhatIfScenarios(employees, depts, thresholds) {
            const target = thresholds.targetBillablePercent || 70;
            const minHours = thresholds.minimumHoursForAnalysis || 10;
            
            // Group by title
            const titleGroups = {};
            employees.forEach(e => {
                const title = e.employee.title || 'No Title';
                if (!titleGroups[title]) {
                    titleGroups[title] = { employees: [], totalCost: 0, avgPct: 0 };
                }
                titleGroups[title].employees.push(e);
                titleGroups[title].totalCost += e.range?.nonBillableCost || 0;
            });
            
            Object.values(titleGroups).forEach(g => {
                const qualified = g.employees.filter(e => (e.range?.hours || 0) >= minHours);
                // FIXED: Use weighted average based on hours worked instead of simple mean
                const totalQualifiedHours = qualified.reduce((sum, e) => sum + (e.range?.hours || 0), 0);
                const totalQualifiedBillable = qualified.reduce((sum, e) => sum + (e.range?.billableHours || 0), 0);
                g.avgPct = totalQualifiedHours > 0 
                    ? (totalQualifiedBillable / totalQualifiedHours) * 100 
                    : 0;
            });
            
            // Improvement opportunities
            const improvements = Object.entries(titleGroups)
                .filter(([_, g]) => g.avgPct < target && g.totalCost > 0)
                .map(([title, g]) => {
                    const improvementPct = 5;
                    // FIXED: Removed unexplained * 2 multiplier - savings should equal the improvement percentage
                    const potentialSavings = g.totalCost * (improvementPct / 100);
                    return {
                        description: `Improve "${title}" by ${improvementPct}%`,
                        detail: `${g.employees.length} employees currently at ${fmtPctVal(g.avgPct, 0)} avg`,
                        savings: potentialSavings
                    };
                })
                .sort((a, b) => b.savings - a.savings);
            
            // Resource reallocation
            const highPerformingDepts = depts.filter(d => (d.range?.percentBilled || 0) >= target);
            const lowPerformingDepts = depts.filter(d => (d.range?.percentBilled || 0) < target - 15);
            
            const reallocations = [];
            lowPerformingDepts.forEach(from => {
                highPerformingDepts.forEach(to => {
                    if (from.department.netsuiteId !== to.department.netsuiteId) {
                        const fromEmps = employees.filter(e => 
                            String(e.employee.departmentId) === String(from.department.netsuiteId) &&
                            (e.range?.percentBilled || 0) < target - 20
                        );
                        if (fromEmps.length > 0) {
                            reallocations.push({
                                from: from.department.name,
                                to: to.department.name,
                                employees: Math.min(2, fromEmps.length),
                                reason: `Move underperformers to higher-billable dept`
                            });
                        }
                    }
                });
            });
            
            // Break-even with enhanced metrics
            const totalEmployees = employees.length || 1;
            const totalNonBillCost = employees.reduce((sum, e) => sum + (e.range?.nonBillableCost || 0), 0);
            const totalHours = employees.reduce((sum, e) => sum + (e.range?.hours || 0), 0);
            const totalBillableHours = employees.reduce((sum, e) => sum + (e.range?.billableHours || 0), 0);
            const costPerEmployee = totalNonBillCost / totalEmployees;
            // FIXED: Use weighted average (total billable hours / total hours) instead of simple mean of percentages
            const avgBillable = totalHours > 0 ? (totalBillableHours / totalHours) * 100 : 0;
            const avgHoursPerEmployee = totalHours / totalEmployees;
            
            // Calculate cost per non-billable hour
            const totalNonBillableHours = totalHours - totalBillableHours;
            const costPerNonBillableHour = totalNonBillableHours > 0 ? totalNonBillCost / totalNonBillableHours : 0;
            
            // Find best performing title for hiring recommendation
            const titlePerformance = Object.entries(titleGroups)
                .filter(([_, g]) => g.employees.length >= 2)
                .map(([title, g]) => ({ title, avgPct: g.avgPct, count: g.employees.length }))
                .sort((a, b) => b.avgPct - a.avgPct);
            const bestTitle = titlePerformance[0];
            const worstTitle = titlePerformance[titlePerformance.length - 1];
            
            // Calculate payback period (months to break even on a new hire)
            const monthlyNonBillCostPerEmployee = costPerEmployee / 3; // Assuming quarterly data
            const requiredBillable = Math.max(target, avgBillable + 5);
            
            // What would it take to add capacity without increasing non-bill cost ratio
            const capacityHeadroom = avgBillable >= target ? 
                Math.floor((avgBillable - target) / 5) : 0;
            
            // Efficiency score (0-100)
            // Formula: 50 points from billable %, 50 points from cost efficiency
            // Cost efficiency: Full 50 points if cost per employee < $5000/period
            // Deduct 1 point per $200 above $5000 threshold
            const COST_EFFICIENCY_THRESHOLD = 5000;
            const COST_PENALTY_DIVISOR = 200;
            const efficiencyScore = Math.min(100, Math.round(
                (avgBillable / target) * 50 + 
                (totalEmployees > 0 ? Math.min(50, (costPerEmployee < COST_EFFICIENCY_THRESHOLD ? 50 : 50 - (costPerEmployee - COST_EFFICIENCY_THRESHOLD) / COST_PENALTY_DIVISOR)) : 25)
            ));
            
            const recommendation = requiredBillable > 85 
                ? "New hires need exceptional billable rates to be cost-effective. Consider contractors for surge capacity."
                : requiredBillable > target 
                    ? `Focus hiring on ${bestTitle ? bestTitle.title : 'high-billable roles'}. Current top performers average ${bestTitle ? fmtPctVal(bestTitle.avgPct, 0) : 'N/A'}.`
                    : "Current utilization supports new hires. Prioritize roles that complement existing team strengths.";
            
            const hiringOutlook = avgBillable >= target + 5 ? 'favorable' : 
                                  avgBillable >= target - 5 ? 'neutral' : 'challenging';
            
            return {
                improvements,
                reallocations: reallocations.slice(0, 4),
                breakEven: { 
                    costPerEmployee, 
                    requiredBillable, 
                    recommendation,
                    avgBillable,
                    avgHoursPerEmployee,
                    costPerNonBillableHour,
                    bestTitle,
                    worstTitle,
                    capacityHeadroom,
                    efficiencyScore,
                    hiringOutlook,
                    totalEmployees
                }
            };
        },

        // === TREEMAP DATA (Fixed NaN handling) ===
        buildTreemapData(depts, employees) {
            const data = {
                labels: ['Company'],
                parents: [''],
                values: [0],
                colors: [0.5],
                ids: ['company'],
                customdata: [{ type: 'company' }]
            };
            
            let companyTotal = 0;
            
            depts.forEach(dept => {
                const deptHours = dept.range?.hours || 0;
                if (deptHours <= 0) return; // Skip depts with no hours
                
                companyTotal += deptHours;
                const deptId = `dept_${dept.department.netsuiteId}`;
                const deptPct = dept.range?.percentBilled || 0;
                
                data.labels.push(dept.department.name);
                data.parents.push('company');
                data.values.push(deptHours);
                data.colors.push(Math.max(0, Math.min(1, deptPct / 100)));
                data.ids.push(deptId);
                data.customdata.push({ type: 'department', id: dept.department.netsuiteId, name: dept.department.name });
                
                // Group employees by title within department
                const deptEmployees = employees.filter(e => 
                    String(e.employee.departmentId) === String(dept.department.netsuiteId)
                );
                
                const titleGroups = {};
                deptEmployees.forEach(e => {
                    const title = e.employee.title || 'No Title';
                    if (!titleGroups[title]) {
                        titleGroups[title] = { hours: 0, billableHours: 0, employees: [] };
                    }
                    titleGroups[title].hours += e.range?.hours || 0;
                    titleGroups[title].billableHours += e.range?.billableHours || 0;
                    titleGroups[title].employees.push(e);
                });
                
                Object.entries(titleGroups).forEach(([title, group]) => {
                    if (group.hours > 0) {
                        const titleId = `${deptId}_title_${title.replace(/[^a-zA-Z0-9]/g, '_')}`;
                        const titlePct = group.hours > 0 ? (group.billableHours / group.hours) * 100 : 0;
                        
                        data.labels.push(title);
                        data.parents.push(deptId);
                        data.values.push(group.hours);
                        data.colors.push(Math.max(0, Math.min(1, titlePct / 100)));
                        data.ids.push(titleId);
                        data.customdata.push({ type: 'title', title, deptId: dept.department.netsuiteId });
                        
                        // Employees under title
                        group.employees.forEach(e => {
                            const empHours = e.range?.hours || 0;
                            if (empHours > 0) {
                                const empId = `${titleId}_emp_${e.employee.netsuiteId}`;
                                const empPct = e.range?.percentBilled || 0;
                                data.labels.push(e.employee.name);
                                data.parents.push(titleId);
                                data.values.push(empHours);
                                data.colors.push(Math.max(0, Math.min(1, empPct / 100)));
                                data.ids.push(empId);
                                data.customdata.push({ type: 'employee', id: e.employee.netsuiteId, name: e.employee.name });
                            }
                        });
                    }
                });
            });
            
            // Set company total
            data.values[0] = companyTotal || 1;
            
            return data;
        },

        renderForecastChart(forecasts) {
            const container = el("#tbForecastChart");
            if (!container || !window.Plotly) return;
            
            const billable = forecasts.series.billable;
            const labels = billable.map((_, i) => i === billable.length - 1 ? 'Current' : `Period ${i + 1}`);
            labels.push('Projected');
            
            const billableWithForecast = [...billable, forecasts.projectedBillable];
            
            const trace1 = {
                x: labels.slice(0, -1),
                y: billable,
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Historical',
                line: { color: '#3b82f6', width: 2 },
                marker: { size: 8 }
            };
            
            const trace2 = {
                x: labels.slice(-2),
                y: [billable[billable.length - 1], forecasts.projectedBillable],
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Forecast',
                line: { color: '#3b82f6', width: 2, dash: 'dash' },
                marker: { size: 8, symbol: 'diamond' }
            };
            
            const layout = {
                margin: { t: 20, b: 40, l: 50, r: 20 },
                yaxis: { title: 'Billable %', range: [0, 100] },
                xaxis: { title: '' },
                showlegend: true,
                legend: { orientation: 'h', y: -0.2 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent'
            };
            
            Plotly.newPlot(container, [trace1, trace2], layout, { responsive: true, displayModeBar: false });
        },

        treemapData: null,
        
        renderTreemap(data, target = 70) {
            const container = el("#tbTreemapChart");
            if (!container || !window.Plotly) return;
            
            this.treemapData = data;
            
            // Validate data - ensure no NaN, null, or zero values
            const cleanValues = data.values.map(v => {
                const val = parseFloat(v);
                return (isNaN(val) || val === null || val === undefined || val <= 0) ? 0.01 : val;
            });
            const cleanColors = data.colors.map(c => {
                const val = parseFloat(c);
                return (isNaN(val) || val === null || val === undefined) ? 0.5 : Math.max(0, Math.min(1, val));
            });
            
            // Skip rendering if no valid data
            if (cleanValues.every(v => v <= 0.01)) {
                container.innerHTML = '<div class="text-center text-muted py-5"><i class="fas fa-chart-pie fa-3x mb-3 opacity-50"></i><div class="h6">No data available</div><p class="small">Time data will appear here once available</p></div>';
                return;
            }
            
            // Modern pastel color scale: Soft red → Soft orange → Soft yellow → Soft green
            const colorscale = [
                [0, '#fecaca'],      // Soft red for 0%
                [0.25, '#fed7aa'],   // Soft orange for 25%
                [0.5, '#fef08a'],    // Soft yellow for 50%
                [0.75, '#bbf7d0'],   // Soft mint for 75%
                [1, '#86efac']       // Soft green for 100%
            ];
            
            // Generate custom text for each cell
            const textLabels = data.labels.map((label, i) => {
                const hours = cleanValues[i];
                const pct = cleanColors[i] * 100;
                if (hours < 1) return label;
                return label;
            });
            
            const trace = {
                type: 'treemap',
                labels: textLabels,
                parents: data.parents,
                values: cleanValues,
                ids: data.ids,
                customdata: data.customdata,
                marker: {
                    colors: cleanColors,
                    colorscale: colorscale,
                    showscale: false,
                    line: {
                        width: 3,
                        color: 'rgba(255, 255, 255, 0.9)'
                    },
                    pad: { t: 36, l: 8, r: 8, b: 8 }
                },
                textfont: {
                    family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    size: 13,
                    color: '#334155'
                },
                textposition: 'middle center',
                texttemplate: '<b>%{label}</b><br>%{value:.0f}h',
                hovertemplate: '<b style="font-size:14px">%{label}</b><br>' +
                    '<span style="color:#94a3b8">Hours:</span> <b>%{value:.1f}</b><br>' +
                    '<span style="color:#94a3b8">Billable:</span> <b>%{color:.1%}</b>' +
                    '<extra></extra>',
                hoverlabel: {
                    bgcolor: 'rgba(15, 23, 42, 0.95)',
                    bordercolor: 'rgba(148, 163, 184, 0.3)',
                    font: { family: '-apple-system, BlinkMacSystemFont, sans-serif', size: 13, color: '#f1f5f9' },
                    align: 'left'
                },
                branchvalues: 'remainder',
                pathbar: {
                    visible: true,
                    thickness: 32,
                    textfont: { size: 13, color: '#475569', family: '-apple-system, BlinkMacSystemFont, sans-serif' },
                    side: 'top',
                    edgeshape: '/'
                },
                tiling: {
                    packing: 'squarify',
                    pad: 6
                },
                maxdepth: 3
            };
            
            const layout = {
                margin: { t: 44, b: 10, l: 10, r: 10 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                font: {
                    family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                },
                hoverlabel: {
                    namelength: -1
                }
            };
            
            const config = {
                responsive: true,
                displayModeBar: false,
                scrollZoom: false
            };
            
            try {
                Plotly.newPlot(container, [trace], layout, config);
                
                // Add click handler for drill-down navigation
                container.on('plotly_click', (eventData) => {
                    if (eventData.points && eventData.points[0]) {
                        const point = eventData.points[0];
                        const customdata = point.customdata;
                        if (customdata && customdata.type === 'employee') {
                            this.showEmployeeDetail(customdata.id);
                        }
                    }
                });
            } catch (err) {
                console.error('Treemap error:', err);
                container.innerHTML = '<div class="text-center text-muted py-5"><i class="fas fa-exclamation-triangle fa-3x mb-3 text-warning"></i><div class="h6">Unable to render visualization</div><p class="small">Please try refreshing the page</p></div>';
            }
        },

        // === ENHANCED DEPARTMENT TAB WITH CARDS ===
        renderDeptTab(depts) {
            const container = el("#tbDeptContainer");
            if (!container) {
                // Fall back to table if container not found
                this.renderDeptTableLegacy(depts);
                return;
            }

            const thresholds = this.rawData?.company?.thresholds || { targetBillablePercent: 70 };
            const target = thresholds.targetBillablePercent || 70;

            // Department cards view
            let cardsHtml = depts.map(d => {
                const r = d.range || {};
                const dt = d.deltas || {};
                const pct = r.percentBilled || 0;
                const isNoBillable = d.noBillable;
                
                // Color based on target (or gray for no-billable depts)
                let statusColor, statusBg, statusIcon, cardClass = '';
                if (isNoBillable) {
                    statusColor = 'text-secondary';
                    statusBg = 'bg-secondary';
                    statusIcon = 'fa-ban';
                    cardClass = 'border-secondary';
                } else if (pct >= target) {
                    statusColor = 'text-success';
                    statusBg = 'bg-success';
                    statusIcon = 'fa-check-circle';
                } else if (pct >= target - 10) {
                    statusColor = 'text-warning';
                    statusBg = 'bg-warning';
                    statusIcon = 'fa-exclamation-triangle';
                } else {
                    statusColor = 'text-danger';
                    statusBg = 'bg-danger';
                    statusIcon = 'fa-times-circle';
                }

                const trendHtml = getTrendHtml(dt.percentBilledDelta, true);
                const progressWidth = Math.min(100, Math.max(0, pct));

                return `
                    <div class="col-md-4 col-lg-3 mb-3">
                        <div class="card shadow-sm h-100 dept-card ${cardClass}" data-dept-id="${d.department.netsuiteId}" style="${isNoBillable ? 'opacity: 0.8;' : ''}">
                            <div class="card-body p-3">
                                <div class="d-flex justify-content-between align-items-start mb-2">
                                    <h6 class="font-weight-bold mb-0 text-truncate" style="max-width: 140px;" title="${d.department.name}">${d.department.name}</h6>
                                    <span class="${statusColor}" title="${isNoBillable ? 'No billable expectation' : ''}"><i class="fas ${statusIcon}"></i></span>
                                </div>
                                ${isNoBillable ? '<div class="text-center small text-secondary mb-1"><i class="fas fa-info-circle mr-1"></i>No billable expectation</div>' : ''}
                                <div class="text-center my-3">
                                    <div class="h2 mb-0 ${statusColor}">${fmtPctVal(pct, 1)}</div>
                                    <div class="small text-muted">Billable</div>
                                </div>
                                <div class="progress mb-2" style="height: 6px;">
                                    <div class="progress-bar ${statusBg}" style="width: ${progressWidth}%"></div>
                                </div>
                                <div class="d-flex justify-content-between small">
                                    <span class="text-muted">Prior: ${fmtPctVal(d.priorRange?.percentBilled, 1)}</span>
                                    <span>${trendHtml}</span>
                                </div>
                                <hr class="my-2">
                                <div class="row small">
                                    <div class="col-6">
                                        <div class="text-muted">Hours</div>
                                        <div class="font-weight-bold">${fmtNum(r.hours, 0)}</div>
                                    </div>
                                    <div class="col-6 text-right">
                                        <div class="text-muted">Non-Bill Cost</div>
                                        <div class="font-weight-bold text-danger">${fmtMoney(r.nonBillableCost, 0)}</div>
                                    </div>
                                </div>
                                <div class="dept-sparkline mt-2" data-dept="${d.department.netsuiteId}" style="height: 30px; overflow: hidden;"></div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <div class="mb-3 d-flex justify-content-between align-items-center flex-wrap">
                    <div class="mb-2 mb-md-0">
                        <span class="badge badge-success mr-2"><i class="fas fa-check-circle mr-1"></i>≥${target}%</span>
                        <span class="badge badge-warning mr-2"><i class="fas fa-exclamation-triangle mr-1"></i>${target-10}-${target}%</span>
                        <span class="badge badge-danger mr-2"><i class="fas fa-times-circle mr-1"></i>&lt;${target-10}%</span>
                        <span class="badge badge-secondary"><i class="fas fa-ban mr-1"></i>No Billable Expectation</span>
                    </div>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-secondary active" id="btnDeptCards" onclick="TimeController.showDeptCards()">
                            <i class="fas fa-th-large"></i>
                        </button>
                        <button class="btn btn-outline-secondary" id="btnDeptTable" onclick="TimeController.showDeptTable()">
                            <i class="fas fa-table"></i>
                        </button>
                    </div>
                </div>
                <div id="deptCardsView" class="row">${cardsHtml}</div>
                <div id="deptTableView" style="display: none;"></div>
            `;

            // Render sparklines
            setTimeout(() => this.renderDeptSparklines(), 100);
        },

        showDeptCards() {
            el("#deptCardsView").style.display = '';
            el("#deptTableView").style.display = 'none';
            el("#btnDeptCards").classList.add('active');
            el("#btnDeptTable").classList.remove('active');
        },

        showDeptTable() {
            el("#deptCardsView").style.display = 'none';
            const tableView = el("#deptTableView");
            tableView.style.display = '';
            el("#btnDeptCards").classList.remove('active');
            el("#btnDeptTable").classList.add('active');
            
            // Render table if not already
            if (!tableView.innerHTML) {
                this.renderDeptTableInContainer(this.latestDepts, tableView);
            }
        },

        renderDeptTableInContainer(depts, container) {
            container.innerHTML = `
                <div class="table-responsive shadow-sm border rounded">
                    <table class="table table-hover mb-0 cf-data-table" id="tbDeptTableSortable">
                        <thead class="bg-light">
                            <tr>
                                <th class="sortable" data-sort="name">Department <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="percentBilled">% Billed <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right text-muted">% Prior</th>
                                <th class="text-right sortable" data-sort="delta">Change <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="nonBillableCost">Non-Bill Cost <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right">Cost Δ</th>
                                <th class="text-right sortable" data-sort="hours">Total Hrs <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right text-success">Billable Hrs</th>
                                <th class="text-right text-danger">Non-Bill Hrs</th>
                            </tr>
                        </thead>
                        <tbody id="tbDeptTableBodySortable"></tbody>
                    </table>
                </div>
            `;

            this.renderDeptTableRows(depts);
            this.initSortableTable('tbDeptTableSortable', depts, 'dept');
        },

        renderDeptTableLegacy(depts) {
            const tbody = el("#tbDeptTableBody");
            if (!tbody) return;
            tbody.innerHTML = "";
            if (!depts.length) { 
                tbody.innerHTML = "<tr><td colspan='9' class='text-center p-4 text-muted'>No data</td></tr>"; 
                return; 
            }
            
            depts.forEach(d => {
                const r = d.range || {};
                const dt = d.deltas || {};
                tbody.innerHTML += `<tr>
                    <td class="font-weight-500 text-dark">${d.department.name}</td>
                    <td class="text-right font-weight-bold">${fmtPctVal(r.percentBilled, 1)}</td>
                    <td class="text-right text-muted small">${fmtPctVal(d.priorRange?.percentBilled, 1)}</td>
                    <td class="text-right">${getTrendHtml(dt.percentBilledDelta, true)}</td>
                    <td class="text-right">${fmtMoney(r.nonBillableCost)}</td>
                    <td class="text-right">${getTrendHtml(dt.nonBillableCostDelta, false)}</td>
                    <td class="text-right">${fmtNum(r.hours, 0)}</td>
                    <td class="text-right text-success">${fmtNum(r.billableHours, 0)}</td>
                    <td class="text-right text-danger">${fmtNum(r.nonBillableHours, 0)}</td>
                </tr>`;
            });
        },

        renderDeptTableRows(depts, tbody = null) {
            tbody = tbody || el("#tbDeptTableBodySortable") || el("#tbDeptTableBody");
            if (!tbody) return;
            tbody.innerHTML = "";
            if (!depts.length) { 
                tbody.innerHTML = "<tr><td colspan='9' class='text-center p-4 text-muted'>No data</td></tr>"; 
                return; 
            }
            
            depts.forEach(d => {
                const r = d.range || {};
                const dt = d.deltas || {};
                const isNoBillable = d.noBillable;
                const rowClass = isNoBillable ? 'text-muted' : '';
                const nameExtra = isNoBillable ? ' <span class="badge badge-secondary badge-sm ml-1" title="No billable expectation"><i class="fas fa-ban"></i></span>' : '';
                
                tbody.innerHTML += `<tr class="${rowClass}">
                    <td class="font-weight-500 ${isNoBillable ? 'text-muted' : 'text-dark'}">${d.department.name}${nameExtra}</td>
                    <td class="text-right font-weight-bold">${fmtPctVal(r.percentBilled, 1)}</td>
                    <td class="text-right text-muted small">${fmtPctVal(d.priorRange?.percentBilled, 1)}</td>
                    <td class="text-right">${getTrendHtml(dt.percentBilledDelta, true)}</td>
                    <td class="text-right">${fmtMoney(r.nonBillableCost)}</td>
                    <td class="text-right">${getTrendHtml(dt.nonBillableCostDelta, false)}</td>
                    <td class="text-right">${fmtNum(r.hours, 0)}</td>
                    <td class="text-right text-success">${fmtNum(r.billableHours, 0)}</td>
                    <td class="text-right text-danger">${fmtNum(r.nonBillableHours, 0)}</td>
                </tr>`;
            });
        },

        renderDeptSparklines() {
            const historyData = this.rawData?.history;
            if (!historyData || !window.Plotly) return;

            document.querySelectorAll('.dept-sparkline').forEach(container => {
                const deptId = container.dataset.dept;
                
                // Get historical data for this department
                const periods = historyData.periods || [];
                const values = periods.map(p => {
                    const deptData = p.deptData?.[deptId];
                    return deptData?.percentBilled || 0;
                }).reverse();

                if (values.length === 0) return;

                const minVal = Math.min(...values);
                const maxVal = Math.max(...values);
                const padding = (maxVal - minVal) * 0.3 || 5;

                const data = [{
                    y: values,
                    type: 'scatter',
                    mode: 'lines',
                    fill: 'tozeroy',
                    line: { color: '#6366f1', width: 1.5, shape: 'spline' },
                    fillcolor: 'rgba(99, 102, 241, 0.1)',
                    hoverinfo: 'skip'
                }];

                const layout = {
                    margin: { l: 0, r: 0, t: 0, b: 0 },
                    xaxis: { visible: false, fixedrange: true },
                    yaxis: { visible: false, fixedrange: true, range: [Math.max(0, minVal - padding), maxVal + padding] },
                    showlegend: false,
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent'
                };

                Plotly.newPlot(container, data, layout, { responsive: true, displayModeBar: false, staticPlot: true });
            });
        },

        initDeptFilters(depts) {
            const sel = el("#tbEmployeeDeptFilter");
            if (!sel) return;
            sel.innerHTML = '<option value="__ALL__">All Departments</option>';
            depts.forEach(d => sel.innerHTML += `<option value="${d.department.netsuiteId}">${d.department.name}</option>`);
            sel.onchange = () => this.renderEmployeeTab(this.filterEmployees(sel.value));
        },

        filterEmployees(deptId) {
            const employees = this.latestEmployees || [];
            if (!deptId || deptId === "__ALL__") return employees;
            return employees.filter(e => String(e.employee.departmentId) === String(deptId));
        },

        // === ENHANCED ITEMS TAB ===
        renderItemTab(items) {
            const container = el("#tbItemContainer");
            const tbody = el("#tbItemTableBody");
            const thresholds = this.rawData?.company?.thresholds || { targetBillablePercent: 70 };
            const target = thresholds.targetBillablePercent || 70;
            
            // Filter out items with 0 hours and 0 cost
            const filteredItems = items.filter(i => {
                const r = i.range || {};
                return (r.hours || 0) > 0 || (r.nonBillableCost || 0) > 0;
            });
            
            // Store for grouping/filtering
            this.latestItems = filteredItems;
            
            // Build department name lookup from latestDepts
            const deptNameMap = {};
            (this.latestDepts || []).forEach(d => {
                deptNameMap[d.department.netsuiteId] = d.department.name;
            });

            // Calculate item-specific KPIs - all unique
            const totalItems = filteredItems.length;
            const itemTotalHours = filteredItems.reduce((sum, i) => sum + (i.range?.hours || 0), 0);
            const itemBillableHours = filteredItems.reduce((sum, i) => sum + (i.range?.billableHours || 0), 0);
            const avgBillable = itemTotalHours > 0 ? (itemBillableHours / itemTotalHours) * 100 : 0;
            const avgHoursPerItem = totalItems > 0 ? itemTotalHours / totalItems : 0;
            
            // Find extremes
            const sortedByCost = [...filteredItems].sort((a, b) => 
                (b.range?.nonBillableCost || 0) - (a.range?.nonBillableCost || 0));
            const highestCostItem = sortedByCost[0];
            
            // Count items by billable performance
            const itemsAboveTarget = filteredItems.filter(i => (i.range?.percentBilled || 0) >= target).length;
            const itemsBelowTarget = filteredItems.filter(i => (i.range?.percentBilled || 0) < target - 10).length;
            
            if (container) {
                container.innerHTML = `
                    <!-- Item KPI Row - unique KPIs -->
                    <div class="row mb-3 gutters-sm cf-kpi-row">
                        <div class="col">
                            <div class="cf-kpi-card">
                                <div class="icon-wrapper bg-blue-soft"><i class="fas fa-box text-blue"></i></div>
                                <div class="kpi-content">
                                    <span class="kpi-label">Service Items</span>
                                    <span class="kpi-value">${totalItems}</span>
                                    <span class="kpi-sub">with activity</span>
                                </div>
                            </div>
                        </div>
                        <div class="col">
                            <div class="cf-kpi-card">
                                <div class="icon-wrapper bg-green-soft"><i class="fas fa-chart-pie text-green"></i></div>
                                <div class="kpi-content">
                                    <span class="kpi-label">Avg Billable %</span>
                                    <span class="kpi-value ${avgBillable >= target ? 'text-success' : avgBillable >= target - 10 ? 'text-warning' : 'text-danger'}">${fmtPctVal(avgBillable, 1)}</span>
                                    <span class="kpi-sub">across items</span>
                                </div>
                            </div>
                        </div>
                        <div class="col">
                            <div class="cf-kpi-card">
                                <div class="icon-wrapper bg-purple-soft"><i class="fas fa-clock text-purple"></i></div>
                                <div class="kpi-content">
                                    <span class="kpi-label">Avg Hours/Item</span>
                                    <span class="kpi-value">${fmtNum(avgHoursPerItem, 1)}</span>
                                    <span class="kpi-sub">per service item</span>
                                </div>
                            </div>
                        </div>
                        <div class="col">
                            <div class="cf-kpi-card">
                                <div class="icon-wrapper bg-success-soft"><i class="fas fa-check-circle text-success"></i></div>
                                <div class="kpi-content">
                                    <span class="kpi-label">Above Target</span>
                                    <span class="kpi-value text-success">${itemsAboveTarget}</span>
                                    <span class="kpi-sub">${itemsBelowTarget} below target</span>
                                </div>
                            </div>
                        </div>
                        <div class="col">
                            <div class="cf-kpi-card">
                                <div class="icon-wrapper bg-yellow-soft"><i class="fas fa-exclamation-triangle text-yellow"></i></div>
                                <div class="kpi-content">
                                    <span class="kpi-label">Highest Cost</span>
                                    <span class="kpi-value text-danger">${highestCostItem ? fmtMoney(highestCostItem.range?.nonBillableCost, 0) : '—'}</span>
                                    <span class="kpi-sub" title="${highestCostItem?.item?.name || ''}">${highestCostItem ? (highestCostItem.item.name.length > 15 ? highestCostItem.item.name.substring(0,15) + '...' : highestCostItem.item.name) : '—'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="mb-3 d-flex flex-wrap align-items-center">
                        <input type="text" class="form-control form-control-sm mr-2 mb-2" id="tbItemSearch" 
                            placeholder="Search items..." style="max-width: 200px;">
                        <select class="form-control form-control-sm mr-2 mb-2" id="tbItemGroupBy" style="max-width: 150px;">
                            <option value="none">No Grouping</option>
                            <option value="department">By Department</option>
                        </select>
                        <span class="small text-muted ml-auto mb-2">${filteredItems.length} items with activity</span>
                    </div>
                    <div class="table-responsive shadow-sm border rounded">
                        <table class="table table-hover mb-0 cf-data-table" id="tbItemTableSortable">
                            <thead class="bg-light">
                                <tr>
                                    <th class="sortable" data-sort="name">Item Name <i class="fas fa-sort text-muted ml-1"></i></th>
                                    <th class="text-right sortable" data-sort="percentBilled">% Billed <i class="fas fa-sort text-muted ml-1"></i></th>
                                    <th class="text-right sortable" data-sort="nonBillableCost">Non-Bill Cost <i class="fas fa-sort text-muted ml-1"></i></th>
                                    <th class="text-right sortable" data-sort="hours">Total Hours <i class="fas fa-sort text-muted ml-1"></i></th>
                                    <th class="text-right text-danger">Non-Bill Hours</th>
                                </tr>
                            </thead>
                            <tbody id="tbItemTableBodyNew"></tbody>
                        </table>
                    </div>
                    
                    <!-- Item Flyout Panel -->
                    <div id="tbItemFlyout" class="tb-flyout-panel" style="display:none;">
                        <div class="tb-flyout-header">
                            <span id="tbItemFlyoutTitle"></span>
                            <button class="btn-close" onclick="TimeController.closeItemFlyout()"><i class="fas fa-times"></i></button>
                        </div>
                        <div id="tbItemFlyoutBody" class="tb-flyout-body"></div>
                    </div>
                `;

                // Common refresh function
                const refreshItemDisplay = () => {
                    const search = (el("#tbItemSearch").value || '').toLowerCase();
                    const groupBy = el("#tbItemGroupBy").value;
                    
                    let filtered = this.latestItems || [];
                    if (search) {
                        filtered = filtered.filter(i => 
                            (i.item.name || '').toLowerCase().includes(search)
                        );
                    }
                    this.renderItemTableRows(filtered, el("#tbItemTableBodyNew"), groupBy, deptNameMap);
                };
                
                this.renderItemTableRows(filteredItems, el("#tbItemTableBodyNew"), 'none', deptNameMap);
                this.initSortableTable('tbItemTableSortable', filteredItems, 'item');
                
                el("#tbItemSearch").addEventListener('input', refreshItemDisplay);
                el("#tbItemGroupBy").onchange = refreshItemDisplay;
            } else if (tbody) {
                this.renderItemTableRows(filteredItems, tbody, 'none', deptNameMap);
            }
        },

        renderItemTableRows(items, tbody, groupBy = 'none', deptNameMap = {}) {
            if (!tbody) return;
            tbody.innerHTML = "";
            if (!items.length) { 
                tbody.innerHTML = "<tr><td colspan='5' class='text-center p-4'>No data</td></tr>"; 
                return; 
            }
            
            const target = this.rawData?.company?.thresholds?.targetBillablePercent || 70;
            
            // Helper to get department name
            const getDeptName = (item) => {
                return item.item.departmentName || 
                       deptNameMap[item.item.departmentId] || 
                       'Unknown Department';
            };
            
            if (groupBy === 'none') {
                items.forEach(i => {
                    const r = i.range || {};
                    tbody.innerHTML += `<tr class="clickable-row" onclick="TimeController.showItemDetail('${i.item.netsuiteId}')" style="cursor:pointer;">
                        <td class="font-weight-500 text-dark">${i.item.name}</td>
                        <td class="text-right font-weight-bold">${fmtPctVal(r.percentBilled, 1)}</td>
                        <td class="text-right">${fmtMoney(r.nonBillableCost)}</td>
                        <td class="text-right">${fmtNum(r.hours, 1)}</td>
                        <td class="text-right text-danger">${fmtNum(r.nonBillableHours, 1)}</td>
                    </tr>`;
                });
            } else {
                // Group by department
                const groups = {};
                items.forEach(i => {
                    const key = getDeptName(i);
                    if (!groups[key]) {
                        groups[key] = {
                            name: key,
                            items: [],
                            totals: { hours: 0, billableHours: 0, nonBillableHours: 0, nonBillableCost: 0 }
                        };
                    }
                    groups[key].items.push(i);
                    const r = i.range || {};
                    groups[key].totals.hours += r.hours || 0;
                    groups[key].totals.billableHours += r.billableHours || 0;
                    groups[key].totals.nonBillableHours += r.nonBillableHours || 0;
                    groups[key].totals.nonBillableCost += r.nonBillableCost || 0;
                });

                // Sort groups by non-billable cost descending
                const sortedGroups = Object.values(groups)
                    .map(g => {
                        g.percentBilled = g.totals.hours > 0 ? (g.totals.billableHours / g.totals.hours) * 100 : 0;
                        return g;
                    })
                    .sort((a, b) => b.totals.nonBillableCost - a.totals.nonBillableCost);

                sortedGroups.forEach(group => {
                    const pctColor = group.percentBilled >= target ? 'text-success' : 
                        group.percentBilled >= target - 10 ? 'text-warning' : 'text-danger';
                    
                    // Group header row
                    tbody.innerHTML += `<tr class="bg-light">
                        <td colspan="5" class="font-weight-bold py-2">
                            <i class="fas fa-building mr-2 text-primary"></i>
                            ${group.name}
                            <span class="badge badge-secondary ml-2">${group.items.length}</span>
                            <span class="float-right">
                                <span class="${pctColor} mr-3">${fmtPctVal(group.percentBilled, 1)}</span>
                                <span class="text-danger">${fmtMoney(group.totals.nonBillableCost, 0)}</span>
                            </span>
                        </td>
                    </tr>`;

                    // Sort items within group by non-billable cost descending
                    const sortedItems = [...group.items].sort((a, b) => 
                        (b.range?.nonBillableCost || 0) - (a.range?.nonBillableCost || 0)
                    );

                    // Item rows
                    sortedItems.forEach(i => {
                        const r = i.range || {};
                        tbody.innerHTML += `<tr class="clickable-row" onclick="TimeController.showItemDetail('${i.item.netsuiteId}')" style="cursor:pointer;">
                            <td class="pl-4 font-weight-500 text-dark">${i.item.name}</td>
                            <td class="text-right font-weight-bold">${fmtPctVal(r.percentBilled, 1)}</td>
                            <td class="text-right">${fmtMoney(r.nonBillableCost)}</td>
                            <td class="text-right">${fmtNum(r.hours, 1)}</td>
                            <td class="text-right text-danger">${fmtNum(r.nonBillableHours, 1)}</td>
                        </tr>`;
                    });
                });
            }
        },

        // === ENHANCED EMPLOYEE TAB WITH HEATMAP ===
        renderEmployeeTab(employees) {
            const container = el("#tbEmployeeContainer");
            const tbody = el("#tbEmployeeTableBody");
            const thresholds = this.rawData?.company?.thresholds || { targetBillablePercent: 70, minimumHoursForAnalysis: 10 };
            const target = thresholds.targetBillablePercent || 70;
            const minHours = thresholds.minimumHoursForAnalysis || 10;
            
            if (container) {
                // Sort by percent billed ascending (worst first)
                const sorted = [...employees].sort((a, b) => 
                    (a.range?.percentBilled || 0) - (b.range?.percentBilled || 0)
                );

                // Calculate employee-specific KPIs
                const totalEmployees = employees.length;
                const qualifiedEmployees = employees.filter(e => (e.range?.hours || 0) >= minHours);
                // FIXED: Use weighted average based on hours worked instead of simple mean of percentages
                const qualifiedTotalHours = qualifiedEmployees.reduce((sum, e) => sum + (e.range?.hours || 0), 0);
                const qualifiedBillableHours = qualifiedEmployees.reduce((sum, e) => sum + (e.range?.billableHours || 0), 0);
                const avgBillable = qualifiedTotalHours > 0 
                    ? (qualifiedBillableHours / qualifiedTotalHours) * 100 
                    : 0;
                
                // Count by performance category
                const aboveTarget = qualifiedEmployees.filter(e => (e.range?.percentBilled || 0) >= target).length;
                const nearTarget = qualifiedEmployees.filter(e => {
                    const pct = e.range?.percentBilled || 0;
                    return pct >= target - 10 && pct < target;
                }).length;
                const belowTarget = qualifiedEmployees.filter(e => (e.range?.percentBilled || 0) < target - 10).length;
                
                // Find top and bottom performers
                const topPerformer = qualifiedEmployees.length > 0 
                    ? [...qualifiedEmployees].sort((a, b) => (b.range?.percentBilled || 0) - (a.range?.percentBilled || 0))[0]
                    : null;
                const bottomPerformer = qualifiedEmployees.length > 0
                    ? [...qualifiedEmployees].sort((a, b) => (a.range?.percentBilled || 0) - (b.range?.percentBilled || 0))[0]
                    : null;
                
                // Calculate average hours per employee
                const avgHours = totalEmployees > 0 
                    ? employees.reduce((sum, e) => sum + (e.range?.hours || 0), 0) / totalEmployees 
                    : 0;

                container.innerHTML = `
                    <!-- Employee KPI Row - unique KPIs -->
                    <div class="row mb-3 gutters-sm cf-kpi-row">
                        <div class="col">
                            <div class="cf-kpi-card">
                                <div class="icon-wrapper bg-blue-soft"><i class="fas fa-users text-blue"></i></div>
                                <div class="kpi-content">
                                    <span class="kpi-label">Employees</span>
                                    <span class="kpi-value">${totalEmployees}</span>
                                    <span class="kpi-sub">${qualifiedEmployees.length} qualified (≥${minHours}h)</span>
                                </div>
                            </div>
                        </div>
                        <div class="col">
                            <div class="cf-kpi-card">
                                <div class="icon-wrapper bg-green-soft"><i class="fas fa-chart-pie text-green"></i></div>
                                <div class="kpi-content">
                                    <span class="kpi-label">Avg Billable %</span>
                                    <span class="kpi-value ${avgBillable >= target ? 'text-success' : avgBillable >= target - 10 ? 'text-warning' : 'text-danger'}">${fmtPctVal(avgBillable, 1)}</span>
                                    <span class="kpi-sub">per employee</span>
                                </div>
                            </div>
                        </div>
                        <div class="col">
                            <div class="cf-kpi-card">
                                <div class="icon-wrapper bg-purple-soft"><i class="fas fa-clock text-purple"></i></div>
                                <div class="kpi-content">
                                    <span class="kpi-label">Avg Hours</span>
                                    <span class="kpi-value">${fmtNum(avgHours, 1)}</span>
                                    <span class="kpi-sub">per employee</span>
                                </div>
                            </div>
                        </div>
                        <div class="col">
                            <div class="cf-kpi-card">
                                <div class="icon-wrapper bg-success-soft"><i class="fas fa-trophy text-success"></i></div>
                                <div class="kpi-content">
                                    <span class="kpi-label">Top Performer</span>
                                    <span class="kpi-value text-success">${topPerformer ? fmtPctVal(topPerformer.range?.percentBilled, 0) : '—'}</span>
                                    <span class="kpi-sub" title="${topPerformer?.employee?.name || ''}">${topPerformer ? (topPerformer.employee.name.length > 12 ? topPerformer.employee.name.substring(0,12) + '...' : topPerformer.employee.name) : '—'}</span>
                                </div>
                            </div>
                        </div>
                        <div class="col">
                            <div class="cf-kpi-card">
                                <div class="icon-wrapper bg-yellow-soft"><i class="fas fa-exclamation-triangle text-yellow"></i></div>
                                <div class="kpi-content">
                                    <span class="kpi-label">Below Target</span>
                                    <span class="kpi-value ${belowTarget > 0 ? 'text-danger' : 'text-success'}">${belowTarget}</span>
                                    <span class="kpi-sub">${aboveTarget} above, ${nearTarget} near</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="mb-3 d-flex justify-content-between align-items-center flex-wrap">
                        <div class="d-flex align-items-center mb-2 mb-md-0 flex-wrap">
                            <select id="tbEmployeeDeptFilterNew" class="form-control form-control-sm cf-select mr-2 mb-1" style="width:180px;">
                                <option value="__ALL__">All Departments</option>
                            </select>
                            <select id="tbEmployeeGroupBy" class="form-control form-control-sm cf-select mr-2 mb-1" style="width:150px;">
                                <option value="none">No Grouping</option>
                                <option value="department">By Department</option>
                                <option value="title">By Job Title</option>
                            </select>
                            <input type="text" class="form-control form-control-sm mb-1" id="tbEmployeeSearch" 
                                placeholder="Search employees..." style="width: 180px;">
                        </div>
                        <div class="btn-group btn-group-sm">
                            <button class="btn btn-outline-secondary" id="btnEmpHeatmap" onclick="TimeController.showEmployeeHeatmap()">
                                <i class="fas fa-th"></i> Heatmap
                            </button>
                            <button class="btn btn-outline-secondary active" id="btnEmpTable" onclick="TimeController.showEmployeeTable()">
                                <i class="fas fa-table"></i> Table
                            </button>
                        </div>
                    </div>
                    <div id="employeeHeatmapView" style="display: none;">${this.renderEmployeeHeatmap(sorted, thresholds, 'none')}</div>
                    <div id="employeeTableView">
                        <div class="table-responsive shadow-sm border rounded">
                            <table class="table table-hover mb-0 cf-data-table" id="tbEmployeeTableSortable">
                                <thead class="bg-light">
                                    <tr>
                                        <th class="sortable" data-sort="name">Employee <i class="fas fa-sort text-muted ml-1"></i></th>
                                        <th class="text-right sortable" data-sort="percentBilled">% Billed <i class="fas fa-sort text-muted ml-1"></i></th>
                                        <th class="text-right text-muted">% Prior</th>
                                        <th class="text-right sortable" data-sort="delta">Change <i class="fas fa-sort text-muted ml-1"></i></th>
                                        <th class="text-right sortable" data-sort="nonBillableCost">Non-Bill Cost <i class="fas fa-sort text-muted ml-1"></i></th>
                                        <th class="text-right">Cost Δ</th>
                                        <th class="text-right sortable" data-sort="hours">Total Hrs <i class="fas fa-sort text-muted ml-1"></i></th>
                                        <th class="text-right text-danger">Non-Bill Hrs</th>
                                    </tr>
                                </thead>
                                <tbody id="tbEmployeeTableBodyNew"></tbody>
                            </table>
                        </div>
                    </div>
                    
                    <!-- Employee Flyout Panel -->
                    <div id="tbEmployeeFlyout" class="tb-flyout-panel" style="display:none;">
                        <div class="tb-flyout-header">
                            <span id="tbEmployeeFlyoutTitle"></span>
                            <button class="btn-close" onclick="TimeController.closeEmployeeFlyout()"><i class="fas fa-times"></i></button>
                        </div>
                        <div id="tbEmployeeFlyoutBody" class="tb-flyout-body"></div>
                    </div>
                `;

                // Populate department filter
                const deptFilter = el("#tbEmployeeDeptFilterNew");
                if (deptFilter) {
                    (this.latestDepts || []).forEach(d => {
                        deptFilter.innerHTML += `<option value="${d.department.netsuiteId}">${d.department.name}</option>`;
                    });
                }
                
                // Common function to refresh employee display
                const refreshEmployeeDisplay = () => {
                    const deptId = el("#tbEmployeeDeptFilterNew").value;
                    const search = (el("#tbEmployeeSearch").value || '').toLowerCase();
                    const groupBy = el("#tbEmployeeGroupBy").value;
                    
                    let filtered = this.filterEmployees(deptId);
                    if (search) {
                        filtered = filtered.filter(emp => 
                            (emp.employee.name || '').toLowerCase().includes(search)
                        );
                    }
                    const sortedFiltered = [...filtered].sort((a, b) => 
                        (a.range?.percentBilled || 0) - (b.range?.percentBilled || 0)
                    );
                    
                    el("#employeeHeatmapView").innerHTML = this.renderEmployeeHeatmap(sortedFiltered, thresholds, groupBy);
                    this.renderEmployeeTableRows(sortedFiltered, el("#tbEmployeeTableBodyNew"), groupBy);
                };
                
                deptFilter.onchange = refreshEmployeeDisplay;
                el("#tbEmployeeGroupBy").onchange = refreshEmployeeDisplay;
                el("#tbEmployeeSearch").addEventListener('input', refreshEmployeeDisplay);

                this.renderEmployeeTableRows(sorted, el("#tbEmployeeTableBodyNew"), 'none');
                this.initSortableTable('tbEmployeeTableSortable', sorted, 'employee');
            } else if (tbody) {
                const sorted = [...employees].sort((a, b) => 
                    (a.range?.percentBilled || 0) - (b.range?.percentBilled || 0)
                );
                this.renderEmployeeTableRows(sorted, tbody, 'none');
            }
        },

        renderEmployeeHeatmap(employees, thresholds, groupBy = 'none') {
            const target = thresholds.targetBillablePercent || 70;
            const minHours = thresholds.minimumHoursForAnalysis || 10;

            // Build department name lookup from latestDepts
            const deptNameMap = {};
            (this.latestDepts || []).forEach(d => {
                deptNameMap[d.department.netsuiteId] = d.department.name;
            });
            
            const getDeptName = (emp) => {
                return emp.employee.departmentName || 
                       deptNameMap[emp.employee.departmentId] || 
                       'Unknown';
            };

            // Filter to employees meeting minimum hours
            const qualified = employees.filter(e => (e.range?.hours || 0) >= minHours);
            const unqualified = employees.filter(e => (e.range?.hours || 0) < minHours);

            const getColor = (pct) => {
                if (pct >= target) return 'success';
                if (pct >= target - 10) return 'warning';
                return 'danger';
            };
            
            const renderTile = (e, showSubtitle = true) => {
                const r = e.range || {};
                const pct = r.percentBilled || 0;
                const color = getColor(pct);
                const delta = e.deltas?.percentBilledDelta || 0;
                const deltaIcon = delta > 0 ? 'fa-arrow-up text-success' : delta < 0 ? 'fa-arrow-down text-danger' : '';
                const subtitle = groupBy === 'department' 
                    ? (e.employee.title || '') 
                    : getDeptName(e);
                
                return `
                    <div class="col-6 col-md-4 col-lg-3 col-xl-2 mb-2">
                        <div class="card border-left-${color} shadow-sm h-100" style="border-left-width: 4px !important;">
                            <div class="card-body p-2">
                                <div class="d-flex justify-content-between align-items-start mb-1">
                                    <div class="small font-weight-bold text-truncate flex-grow-1" title="${e.employee.name}">${e.employee.name}</div>
                                    ${deltaIcon ? `<i class="fas ${deltaIcon} ml-1" style="font-size: 0.65rem;"></i>` : ''}
                                </div>
                                ${showSubtitle && subtitle ? `<div class="text-muted small text-truncate mb-1" style="font-size: 0.7rem;" title="${subtitle}">${subtitle}</div>` : ''}
                                <div class="d-flex justify-content-between align-items-end">
                                    <div>
                                        <div class="h5 mb-0 font-weight-bold text-${color}">${fmtPctVal(pct, 0)}</div>
                                    </div>
                                    <div class="text-right">
                                        <div class="small text-muted">${fmtNum(r.hours, 0)}h</div>
                                        <div class="small text-danger" style="font-size: 0.7rem;">${fmtMoney(r.nonBillableCost, 0)}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            };
            
            const renderLowHoursTile = (e) => {
                return `
                    <div class="col-6 col-md-4 col-lg-3 col-xl-2 mb-2">
                        <div class="card bg-light h-100 border-0" style="opacity: 0.7;">
                            <div class="card-body p-2">
                                <div class="small text-muted text-truncate mb-1">${e.employee.name}</div>
                                <div class="d-flex justify-content-between align-items-end">
                                    <div class="h6 mb-0 text-muted">${fmtPctVal(e.range?.percentBilled, 0)}</div>
                                    <div class="small text-muted">${fmtNum(e.range?.hours, 0)}h</div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            };

            let html = '';
            
            if (groupBy === 'none') {
                // No grouping - flat list
                html = `<div class="row">${qualified.map(e => renderTile(e, true)).join('')}</div>`;
            } else {
                // Group by department or title
                const groups = {};
                qualified.forEach(e => {
                    const key = groupBy === 'department' 
                        ? getDeptName(e)
                        : (e.employee.title || 'No Title');
                    if (!groups[key]) {
                        groups[key] = {
                            name: key,
                            employees: [],
                            totals: { hours: 0, billableHours: 0, nonBillableCost: 0 }
                        };
                    }
                    groups[key].employees.push(e);
                    const r = e.range || {};
                    groups[key].totals.hours += r.hours || 0;
                    groups[key].totals.billableHours += r.billableHours || 0;
                    groups[key].totals.nonBillableCost += r.nonBillableCost || 0;
                });
                
                // Sort groups by non-billable cost descending
                const sortedGroups = Object.values(groups)
                    .map(g => {
                        g.percentBilled = g.totals.hours > 0 ? (g.totals.billableHours / g.totals.hours) * 100 : 0;
                        return g;
                    })
                    .sort((a, b) => b.totals.nonBillableCost - a.totals.nonBillableCost);
                
                sortedGroups.forEach(group => {
                    const pctColor = getColor(group.percentBilled);
                    html += `
                        <div class="mb-3">
                            <div class="d-flex align-items-center mb-2 pb-1 border-bottom">
                                <i class="fas fa-${groupBy === 'department' ? 'building' : 'user-tag'} text-primary mr-2"></i>
                                <span class="font-weight-bold">${group.name}</span>
                                <span class="badge badge-secondary ml-2">${group.employees.length}</span>
                                <span class="ml-auto small">
                                    <span class="font-weight-bold text-${pctColor}">${fmtPctVal(group.percentBilled, 0)}</span>
                                    <span class="text-muted mx-2">|</span>
                                    <span class="text-danger">${fmtMoney(group.totals.nonBillableCost, 0)}</span>
                                </span>
                            </div>
                            <div class="row">
                                ${group.employees
                                    .sort((a, b) => (a.range?.percentBilled || 0) - (b.range?.percentBilled || 0))
                                    .map(e => renderTile(e, true))
                                    .join('')}
                            </div>
                        </div>
                    `;
                });
            }

            if (unqualified.length > 0) {
                html += `
                    <div class="mt-3">
                        <button class="btn btn-sm btn-link text-muted p-0" type="button" data-toggle="collapse" data-target="#lowHoursEmployees">
                            <i class="fas fa-chevron-down mr-1"></i>${unqualified.length} employees with &lt;${minHours} hours
                        </button>
                        <div class="collapse mt-2" id="lowHoursEmployees">
                            <div class="row">
                                ${unqualified.map(e => renderLowHoursTile(e)).join('')}
                            </div>
                        </div>
                    </div>
                `;
            }

            if (qualified.length === 0 && unqualified.length === 0) {
                html = '<div class="text-center text-muted py-4">No employee data available</div>';
            }

            return html;
        },

        showEmployeeHeatmap() {
            el("#employeeHeatmapView").style.display = '';
            el("#employeeTableView").style.display = 'none';
            el("#btnEmpHeatmap").classList.add('active');
            el("#btnEmpTable").classList.remove('active');
        },

        showEmployeeTable() {
            el("#employeeHeatmapView").style.display = 'none';
            el("#employeeTableView").style.display = '';
            el("#btnEmpHeatmap").classList.remove('active');
            el("#btnEmpTable").classList.add('active');
        },

        renderEmployeeTableRows(employees, tbody, groupBy = 'none', sortKey = 'percentBilled', sortDir = 'asc') {
            if (!tbody) return;
            tbody.innerHTML = "";
            if (!employees.length) { 
                tbody.innerHTML = "<tr><td colspan='8' class='text-center p-4'>No data</td></tr>"; 
                return; 
            }

            const target = this.rawData?.company?.thresholds?.targetBillablePercent || 70;
            
            // Build department name lookup from latestDepts
            const deptNameMap = {};
            (this.latestDepts || []).forEach(d => {
                deptNameMap[d.department.netsuiteId] = d.department.name;
            });
            
            // Helper to get department name
            const getDeptName = (emp) => {
                return emp.employee.departmentName || 
                       deptNameMap[emp.employee.departmentId] || 
                       'Unknown Department';
            };
            
            // Helper to get sort value for an employee
            const getSortVal = (e, key) => {
                const r = e.range || {};
                if (key === 'name') return e.employee.name || '';
                if (key === 'percentBilled') return r.percentBilled || 0;
                if (key === 'nonBillableCost') return r.nonBillableCost || 0;
                if (key === 'hours') return r.hours || 0;
                if (key === 'delta') return e.deltas?.percentBilledDelta || 0;
                return 0;
            };
            
            // Sort employees
            const sortedEmployees = [...employees].sort((a, b) => {
                const aVal = getSortVal(a, sortKey);
                const bVal = getSortVal(b, sortKey);
                if (sortKey === 'name') {
                    return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                }
                return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
            });
            
            if (groupBy === 'none') {
                // No grouping - render flat list
                sortedEmployees.forEach(e => {
                    const r = e.range || {};
                    tbody.innerHTML += `<tr class="clickable-row" onclick="TimeController.showEmployeeDetail('${e.employee.netsuiteId}')" style="cursor:pointer;">
                        <td><div class="font-weight-500 text-dark">${e.employee.name}</div><div class="small text-muted">${e.employee.title || ""}</div></td>
                        <td class="text-right font-weight-bold">${fmtPctVal(r.percentBilled, 1)}</td>
                        <td class="text-right text-muted small">${fmtPctVal(e.priorRange?.percentBilled, 1)}</td>
                        <td class="text-right">${getTrendHtml(e.deltas?.percentBilledDelta, true)}</td>
                        <td class="text-right">${fmtMoney(r.nonBillableCost)}</td>
                        <td class="text-right">${getTrendHtml(e.deltas?.nonBillableCostDelta, false)}</td>
                        <td class="text-right">${fmtNum(r.hours, 0)}</td>
                        <td class="text-right text-danger">${fmtNum(r.nonBillableHours, 0)}</td>
                    </tr>`;
                });
            } else {
                // Group by department or title
                const groups = {};
                sortedEmployees.forEach(e => {
                    const key = groupBy === 'department' 
                        ? getDeptName(e)
                        : (e.employee.title || 'No Title');
                    if (!groups[key]) {
                        groups[key] = {
                            name: key,
                            employees: [],
                            totals: { hours: 0, billableHours: 0, nonBillableHours: 0, nonBillableCost: 0 }
                        };
                    }
                    groups[key].employees.push(e);
                    const r = e.range || {};
                    groups[key].totals.hours += r.hours || 0;
                    groups[key].totals.billableHours += r.billableHours || 0;
                    groups[key].totals.nonBillableHours += r.nonBillableHours || 0;
                    groups[key].totals.nonBillableCost += r.nonBillableCost || 0;
                });

                // Calculate group percentages and sort groups
                const sortedGroups = Object.values(groups)
                    .map(g => {
                        g.percentBilled = g.totals.hours > 0 ? (g.totals.billableHours / g.totals.hours) * 100 : 0;
                        return g;
                    })
                    .sort((a, b) => {
                        // Sort groups by the selected column's aggregate
                        let aVal, bVal;
                        if (sortKey === 'name') {
                            aVal = a.name;
                            bVal = b.name;
                            return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                        } else if (sortKey === 'percentBilled') {
                            aVal = a.percentBilled;
                            bVal = b.percentBilled;
                        } else if (sortKey === 'nonBillableCost') {
                            aVal = a.totals.nonBillableCost;
                            bVal = b.totals.nonBillableCost;
                        } else if (sortKey === 'hours') {
                            aVal = a.totals.hours;
                            bVal = b.totals.hours;
                        } else {
                            // Default to non-billable cost desc
                            aVal = a.totals.nonBillableCost;
                            bVal = b.totals.nonBillableCost;
                            return bVal - aVal;
                        }
                        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
                    });

                sortedGroups.forEach(group => {
                    const pctColor = group.percentBilled >= target ? 'text-success' : 
                        group.percentBilled >= target - 10 ? 'text-warning' : 'text-danger';
                    
                    // Group header row
                    tbody.innerHTML += `<tr class="bg-light">
                        <td colspan="8" class="font-weight-bold py-2">
                            <i class="fas fa-${groupBy === 'department' ? 'building' : 'user-tag'} mr-2 text-primary"></i>
                            ${group.name}
                            <span class="badge badge-secondary ml-2">${group.employees.length}</span>
                            <span class="float-right">
                                <span class="${pctColor} mr-3">${fmtPctVal(group.percentBilled, 1)}</span>
                                <span class="text-danger">${fmtMoney(group.totals.nonBillableCost, 0)}</span>
                            </span>
                        </td>
                    </tr>`;

                    // Employee rows (already sorted by the outer sort)
                    group.employees.forEach(e => {
                        const r = e.range || {};
                        tbody.innerHTML += `<tr class="clickable-row" onclick="TimeController.showEmployeeDetail('${e.employee.netsuiteId}')" style="cursor:pointer;">
                            <td class="pl-4"><div class="font-weight-500 text-dark">${e.employee.name}</div><div class="small text-muted">${groupBy === 'department' ? (e.employee.title || '') : getDeptName(e)}</div></td>
                            <td class="text-right font-weight-bold">${fmtPctVal(r.percentBilled, 1)}</td>
                            <td class="text-right text-muted small">${fmtPctVal(e.priorRange?.percentBilled, 1)}</td>
                            <td class="text-right">${getTrendHtml(e.deltas?.percentBilledDelta, true)}</td>
                            <td class="text-right">${fmtMoney(r.nonBillableCost)}</td>
                            <td class="text-right">${getTrendHtml(e.deltas?.nonBillableCostDelta, false)}</td>
                            <td class="text-right">${fmtNum(r.hours, 0)}</td>
                            <td class="text-right text-danger">${fmtNum(r.nonBillableHours, 0)}</td>
                        </tr>`;
                    });
                });
            }
        },

        // === JOB TITLES TAB ===
        renderJobTitlesTab(employees) {
            const container = el("#tbTitlesContainer");
            if (!container) return;

            const thresholds = this.rawData?.company?.thresholds || { targetBillablePercent: 70 };
            const target = thresholds.targetBillablePercent || 70;

            // Group employees by title
            const titleGroups = {};
            employees.forEach(emp => {
                const title = emp.employee.title || 'No Title';
                if (!titleGroups[title]) {
                    titleGroups[title] = {
                        title: title,
                        employees: [],
                        totals: { hours: 0, billableHours: 0, nonBillableHours: 0, nonBillableCost: 0 }
                    };
                }
                titleGroups[title].employees.push(emp);
                const r = emp.range || {};
                titleGroups[title].totals.hours += r.hours || 0;
                titleGroups[title].totals.billableHours += r.billableHours || 0;
                titleGroups[title].totals.nonBillableHours += r.nonBillableHours || 0;
                titleGroups[title].totals.nonBillableCost += r.nonBillableCost || 0;
            });

            // Calculate percentages and sort by non-billable cost
            const titles = Object.values(titleGroups).map(g => {
                g.percentBilled = g.totals.hours > 0 ? (g.totals.billableHours / g.totals.hours) * 100 : 0;
                // FIXED: avgPercentBilled should be the same weighted calculation as percentBilled
                // The unweighted "average of individual rates" is misleading
                g.avgPercentBilled = g.percentBilled; // Use same weighted calculation
                return g;
            }).sort((a, b) => b.totals.nonBillableCost - a.totals.nonBillableCost);

            // Store for flyout access
            this.titleData = titles;

            // Unique KPIs for Titles tab
            const avgEmployeesPerTitle = titles.length > 0 ? employees.length / titles.length : 0;
            const titlesAboveTarget = titles.filter(t => t.percentBilled >= target).length;
            const titlesBelowTarget = titles.filter(t => t.percentBilled < target - 10).length;
            
            // Find best and worst performing titles
            const sortedByPct = [...titles].sort((a, b) => b.percentBilled - a.percentBilled);
            const bestTitle = sortedByPct[0];
            const worstTitle = sortedByPct[sortedByPct.length - 1];

            container.innerHTML = `
                <!-- Unique KPI Header Row for Titles -->
                <div class="row mb-3 gutters-sm cf-kpi-row">
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-user-tag text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Job Titles</span>
                                <span class="kpi-value">${titles.length}</span>
                                <span class="kpi-sub">unique roles</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-blue-soft"><i class="fas fa-users text-blue"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Avg Team Size</span>
                                <span class="kpi-value">${fmtNum(avgEmployeesPerTitle, 1)}</span>
                                <span class="kpi-sub">employees per title</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-success-soft"><i class="fas fa-trophy text-success"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Best Title</span>
                                <span class="kpi-value text-success">${bestTitle ? fmtPctVal(bestTitle.percentBilled, 0) : '—'}</span>
                                <span class="kpi-sub" title="${bestTitle?.title || ''}">${bestTitle ? (bestTitle.title.length > 12 ? bestTitle.title.substring(0,12) + '...' : bestTitle.title) : '—'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-green-soft"><i class="fas fa-check-circle text-green"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Above Target</span>
                                <span class="kpi-value text-success">${titlesAboveTarget}</span>
                                <span class="kpi-sub">${titlesBelowTarget} below target</span>
                            </div>
                        </div>
                    </div>
                    <div class="col">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-yellow-soft"><i class="fas fa-exclamation-triangle text-yellow"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Needs Attention</span>
                                <span class="kpi-value text-danger">${worstTitle ? fmtPctVal(worstTitle.percentBilled, 0) : '—'}</span>
                                <span class="kpi-sub" title="${worstTitle?.title || ''}">${worstTitle ? (worstTitle.title.length > 12 ? worstTitle.title.substring(0,12) + '...' : worstTitle.title) : '—'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="table-responsive shadow-sm border rounded">
                    <table class="table table-hover mb-0 cf-data-table" id="tbTitlesTableSortable">
                        <thead class="bg-light">
                            <tr>
                                <th class="sortable" data-sort="title">Job Title <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="count">Employees <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="percentBilled">% Billed (Total) <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="avgPercent">% Billed (Avg) <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="hours">Total Hours <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="nonBillableCost">Non-Bill Cost <i class="fas fa-sort text-muted ml-1"></i></th>
                            </tr>
                        </thead>
                        <tbody id="tbTitlesTableBody"></tbody>
                    </table>
                </div>

                <!-- Flyout Panel for Title Details -->
                <div id="tbTitleFlyout" class="tb-flyout-panel" style="display:none;">
                    <div class="tb-flyout-header">
                        <span id="tbTitleFlyoutTitle"></span>
                        <button class="btn-close" onclick="TimeController.closeTitleFlyout()"><i class="fas fa-times"></i></button>
                    </div>
                    <div id="tbTitleFlyoutBody" class="tb-flyout-body"></div>
                </div>
            `;

            this.renderJobTitlesTableRows(titles, target);
            this.initJobTitlesSorting(titles);
        },

        renderJobTitlesTableRows(titles, target) {
            const tbody = el("#tbTitlesTableBody");
            if (!tbody) return;
            tbody.innerHTML = "";

            if (!titles.length) {
                tbody.innerHTML = "<tr><td colspan='6' class='text-center p-4 text-muted'>No data</td></tr>";
                return;
            }

            titles.forEach(t => {
                const pctColor = t.percentBilled >= target ? 'text-success' : 
                    t.percentBilled >= target - 10 ? 'text-warning' : 'text-danger';
                const avgColor = t.avgPercentBilled >= target ? 'text-success' : 
                    t.avgPercentBilled >= target - 10 ? 'text-warning' : 'text-danger';

                tbody.innerHTML += `<tr class="job-title-row" data-title="${encodeURIComponent(t.title)}" style="cursor: pointer;">
                    <td class="font-weight-500 text-dark">
                        <i class="fas fa-chevron-right mr-2 text-muted small"></i>${t.title}
                    </td>
                    <td class="text-right">${t.employees.length}</td>
                    <td class="text-right font-weight-bold ${pctColor}">${fmtPctVal(t.percentBilled, 1)}</td>
                    <td class="text-right ${avgColor}">${fmtPctVal(t.avgPercentBilled, 1)}</td>
                    <td class="text-right">${fmtNum(t.totals.hours, 0)}</td>
                    <td class="text-right text-danger">${fmtMoney(t.totals.nonBillableCost, 0)}</td>
                </tr>`;
            });

            // Add click handlers for expansion
            document.querySelectorAll('.job-title-row').forEach(row => {
                row.addEventListener('click', () => {
                    const title = decodeURIComponent(row.dataset.title);
                    const titleData = titles.find(t => t.title === title);
                    if (titleData) {
                        this.showJobTitleDetail(titleData);
                    }
                });
            });
        },

        showJobTitleDetail(titleData) {
            const flyout = el("#tbTitleFlyout");
            const title = el("#tbTitleFlyoutTitle");
            const body = el("#tbTitleFlyoutBody");
            if (!flyout || !body) return;

            const target = this.rawData?.company?.thresholds?.targetBillablePercent || 70;
            this.currentTitleData = titleData; // Store for sorting
            this.flyoutEmployees = titleData.employees; // Store for flyout sorting

            title.innerHTML = `<i class="fas fa-user-tag mr-2 text-primary"></i>${titleData.title}`;
            flyout.style.display = 'flex';

            // Determine performance level
            const pctClass = titleData.percentBilled >= target ? 'text-success' : 
                titleData.percentBilled >= target - 10 ? 'text-warning' : 'text-danger';
            const avgPctClass = titleData.avgPercentBilled >= target ? 'text-success' : 
                titleData.avgPercentBilled >= target - 10 ? 'text-warning' : 'text-danger';
            
            // Find best/worst performers
            const sortedByPct = [...titleData.employees].sort((a, b) => 
                (b.range?.percentBilled || 0) - (a.range?.percentBilled || 0));
            const topPerformer = sortedByPct[0];
            const bottomPerformer = sortedByPct[sortedByPct.length - 1];

            body.innerHTML = `
                <!-- KPI Row in Flyout -->
                <div class="row mb-3 gutters-sm cf-kpi-row" style="flex-shrink:0;">
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-blue-soft"><i class="fas fa-users text-blue"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Employees</span>
                                <span class="kpi-value">${titleData.employees.length}</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-green-soft"><i class="fas fa-chart-pie text-green"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Total Billable</span>
                                <span class="kpi-value ${pctClass}">${fmtPctVal(titleData.percentBilled, 1)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-red-soft"><i class="fas fa-funnel-dollar text-red"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Non-Bill Cost</span>
                                <span class="kpi-value text-danger">${fmtMoney(titleData.totals.nonBillableCost, 0)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Performance Highlights -->
                <div class="row mb-3" style="flex-shrink:0;">
                    <div class="col-6">
                        <div class="card border-success shadow-sm h-100">
                            <div class="card-body p-2 text-center">
                                <div class="small text-muted mb-1"><i class="fas fa-trophy text-success mr-1"></i>Top Performer</div>
                                <div class="font-weight-bold text-truncate">${topPerformer?.employee?.name || '—'}</div>
                                <div class="h5 text-success mb-0">${fmtPctVal(topPerformer?.range?.percentBilled, 1)}</div>
                            </div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="card border-danger shadow-sm h-100">
                            <div class="card-body p-2 text-center">
                                <div class="small text-muted mb-1"><i class="fas fa-exclamation-circle text-danger mr-1"></i>Needs Support</div>
                                <div class="font-weight-bold text-truncate">${bottomPerformer?.employee?.name || '—'}</div>
                                <div class="h5 text-danger mb-0">${fmtPctVal(bottomPerformer?.range?.percentBilled, 1)}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Hours Summary -->
                <div class="mb-3 p-2 bg-light rounded" style="flex-shrink:0;">
                    <div class="row text-center small">
                        <div class="col-4">
                            <div class="text-muted">Total Hours</div>
                            <div class="font-weight-bold">${fmtNum(titleData.totals.hours, 0)}</div>
                        </div>
                        <div class="col-4 border-left border-right">
                            <div class="text-muted">Billable Hours</div>
                            <div class="font-weight-bold text-success">${fmtNum(titleData.totals.billableHours, 0)}</div>
                        </div>
                        <div class="col-4">
                            <div class="text-muted">Non-Bill Hours</div>
                            <div class="font-weight-bold text-danger">${fmtNum(titleData.totals.nonBillableHours, 0)}</div>
                        </div>
                    </div>
                </div>

                <!-- Employee Table -->
                <div class="table-responsive flex-grow-1" style="overflow-y:auto;">
                    <table class="table table-sm table-hover mb-0" id="tbTitleDetailTable">
                        <thead class="bg-light sticky-top">
                            <tr>
                                <th class="sortable" data-sort="name" style="cursor:pointer;">Employee <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="percentBilled" style="cursor:pointer;">% Billed <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="hours" style="cursor:pointer;">Hours <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="billableHours" style="cursor:pointer;">Billable <i class="fas fa-sort text-muted ml-1"></i></th>
                                <th class="text-right sortable" data-sort="nonBillableCost" style="cursor:pointer;">Cost <i class="fas fa-sort text-muted ml-1"></i></th>
                            </tr>
                        </thead>
                        <tbody id="tbTitleDetailBody"></tbody>
                    </table>
                </div>

                <!-- Footer Summary -->
                <div class="p-2 bg-light border-top mt-2" style="flex-shrink:0;">
                    <div class="d-flex justify-content-between small font-weight-bold">
                        <span>Total (${titleData.employees.length} employees)</span>
                        <span class="${pctClass}">${fmtPctVal(titleData.percentBilled, 1)} billable</span>
                    </div>
                </div>
            `;

            this.renderTitleDetailRows(titleData.employees, target);
            this.initTitleDetailSorting(titleData.employees, target);
        },

        closeTitleFlyout() {
            const flyout = el("#tbTitleFlyout");
            if (flyout) flyout.style.display = 'none';
        },

        // === EMPLOYEE FLYOUT WITH API CALL ===
        employeeFlyoutState: {
            entries: [],
            search: '',
            sortCol: 'date',
            sortDir: 'desc',
            page: 1,
            perPage: 50
        },
        
        async showEmployeeDetail(employeeId) {
            const employee = (this.latestEmployees || []).find(e => String(e.employee.netsuiteId) === String(employeeId));
            if (!employee) return;
            
            const flyout = el("#tbEmployeeFlyout");
            const title = el("#tbEmployeeFlyoutTitle");
            const body = el("#tbEmployeeFlyoutBody");
            if (!flyout || !title || !body) return;
            
            const thresholds = this.rawData?.company?.thresholds || { targetBillablePercent: 70 };
            const target = thresholds.targetBillablePercent || 70;
            const r = employee.range || {};
            const d = employee.deltas || {};
            
            title.innerHTML = `<i class="fas fa-user mr-2"></i>${employee.employee.name}`;
            flyout.style.display = 'flex';
            
            const pctColor = (r.percentBilled || 0) >= target ? 'text-success' : 
                (r.percentBilled || 0) >= target - 10 ? 'text-warning' : 'text-danger';
            
            // Show loading state with KPIs
            body.innerHTML = `
                <!-- Employee KPIs -->
                <div class="row mb-3 gutters-sm cf-kpi-row">
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-green-soft"><i class="fas fa-chart-pie text-green"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Billable %</span>
                                <span class="kpi-value ${pctColor}">${fmtPctVal(r.percentBilled, 1)}</span>
                                <span class="kpi-sub">${d.percentBilledDelta !== undefined ? (d.percentBilledDelta >= 0 ? '↑' : '↓') + ' ' + Math.abs(d.percentBilledDelta).toFixed(1) + 'pp' : 'no prior'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-clock text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Hours</span>
                                <span class="kpi-value">${fmtNum(r.hours, 1)}</span>
                                <span class="kpi-sub">${fmtNum(r.billableHours, 1)} billable</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-red-soft"><i class="fas fa-dollar-sign text-red"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Non-Bill Cost</span>
                                <span class="kpi-value text-danger">${fmtMoney(r.nonBillableCost)}</span>
                                <span class="kpi-sub">${fmtNum(r.nonBillableHours, 1)} non-bill hrs</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="text-center py-4">
                    <i class="fas fa-spinner fa-spin fa-2x text-primary"></i>
                    <div class="mt-2 text-muted">Loading time entries...</div>
                </div>
            `;
            
            // Fetch time entries
            try {
                const params = {
                    action: 'time',
                    subAction: 'employee_entries',
                    employeeId: employeeId,
                    startDate: el('#tbStartDate')?.value || '',
                    endDate: el('#tbEndDate')?.value || ''
                };
                if (this.subsidiaryId) params.subsidiary = this.subsidiaryId;
                
                const res = await API.post('time', params);
                
                if (res.status === 'success' && res.entries) {
                    this.employeeFlyoutState.entries = res.entries;
                    this.employeeFlyoutState.page = 1;
                    this.renderEmployeeFlyoutContent(employee, target);
                } else {
                    this.renderEmployeeFlyoutFallback(employee, target);
                }
            } catch (e) {
                console.error('Employee entries error:', e);
                this.renderEmployeeFlyoutFallback(employee, target);
            }
        },
        
        renderEmployeeFlyoutContent(employee, target) {
            const body = el("#tbEmployeeFlyoutBody");
            if (!body) return;
            
            const r = employee.range || {};
            const pr = employee.priorRange || {};
            const d = employee.deltas || {};
            const entries = this.employeeFlyoutState.entries;
            const pctColor = (r.percentBilled || 0) >= target ? 'text-success' : 
                (r.percentBilled || 0) >= target - 10 ? 'text-warning' : 'text-danger';
            
            // Group by service item
            const byItem = {};
            // FIXED: Add null safety for entries array
            (entries || []).forEach(e => {
                const itemName = e.itemName || 'Unknown';
                if (!byItem[itemName]) byItem[itemName] = { hours: 0, billableHours: 0, count: 0 };
                byItem[itemName].hours += e.hours || 0;
                byItem[itemName].billableHours += e.billableHours || 0;
                byItem[itemName].count++;
            });
            const itemBreakdown = Object.entries(byItem)
                .map(([name, data]) => ({ name, ...data, pct: data.hours > 0 ? (data.billableHours / data.hours) * 100 : 0 }))
                .sort((a, b) => b.hours - a.hours);
            
            // Group by customer
            const byCustomer = {};
            // FIXED: Add null safety for entries array
            (entries || []).forEach(e => {
                const custName = e.customerName || 'Internal';
                if (!byCustomer[custName]) byCustomer[custName] = { hours: 0, count: 0 };
                byCustomer[custName].hours += e.hours || 0;
                byCustomer[custName].count++;
            });
            const customerBreakdown = Object.entries(byCustomer)
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => b.hours - a.hours);
            
            body.innerHTML = `
                <!-- Employee KPIs -->
                <div class="row mb-3 gutters-sm cf-kpi-row">
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-green-soft"><i class="fas fa-chart-pie text-green"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Billable %</span>
                                <span class="kpi-value ${pctColor}">${fmtPctVal(r.percentBilled, 1)}</span>
                                <span class="kpi-sub">${d.percentBilledDelta !== undefined ? (d.percentBilledDelta >= 0 ? '↑' : '↓') + ' ' + Math.abs(d.percentBilledDelta).toFixed(1) + 'pp' : 'no prior'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-clock text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Hours</span>
                                <span class="kpi-value">${fmtNum(r.hours, 1)}</span>
                                <span class="kpi-sub">${fmtNum(r.billableHours, 1)} billable</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-red-soft"><i class="fas fa-dollar-sign text-red"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Non-Bill Cost</span>
                                <span class="kpi-value text-danger">${fmtMoney(r.nonBillableCost)}</span>
                                <span class="kpi-sub">${fmtNum(r.nonBillableHours, 1)} non-bill hrs</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Employee Info -->
                <div class="d-flex mb-3" style="gap: 12px;">
                    <div class="flex-fill p-2 border rounded bg-light">
                        <div class="small text-muted">Job Title</div>
                        <div class="font-weight-bold">${employee.employee.title || 'Not set'}</div>
                    </div>
                    <div class="flex-fill p-2 border rounded bg-light">
                        <div class="small text-muted">Department</div>
                        <div class="font-weight-bold">${employee.employee.departmentName || 'Unknown'}</div>
                    </div>
                    <div class="flex-fill p-2 border rounded bg-light">
                        <div class="small text-muted">Prior Period</div>
                        <div class="font-weight-bold">${pr.percentBilled !== undefined ? fmtPctVal(pr.percentBilled, 1) : '—'}</div>
                    </div>
                </div>
                
                <div class="row mb-3">
                    <!-- Service Items Breakdown -->
                    <div class="col-6">
                        <div class="card shadow-sm h-100">
                            <div class="card-header bg-light py-2">
                                <h6 class="mb-0 small"><i class="fas fa-box mr-1"></i>By Service Item (${itemBreakdown.length})</h6>
                            </div>
                            <div class="card-body p-0" style="max-height: 180px; overflow-y: auto;">
                                ${itemBreakdown.map(i => `
                                    <div class="d-flex justify-content-between align-items-center px-2 py-1 border-bottom">
                                        <span class="text-truncate small" style="max-width: 120px;" title="${i.name}">${i.name}</span>
                                        <span class="small"><strong>${fmtNum(i.hours, 1)}h</strong> <span class="${i.pct >= target ? 'text-success' : 'text-muted'}">${fmtPctVal(i.pct, 0)}</span></span>
                                    </div>
                                `).join('') || '<div class="text-center text-muted py-3 small">No data</div>'}
                            </div>
                        </div>
                    </div>
                    <!-- Customer Breakdown -->
                    <div class="col-6">
                        <div class="card shadow-sm h-100">
                            <div class="card-header bg-light py-2">
                                <h6 class="mb-0 small"><i class="fas fa-building mr-1"></i>By Customer (${customerBreakdown.length})</h6>
                            </div>
                            <div class="card-body p-0" style="max-height: 180px; overflow-y: auto;">
                                ${customerBreakdown.map(c => `
                                    <div class="d-flex justify-content-between align-items-center px-2 py-1 border-bottom">
                                        <span class="text-truncate small" style="max-width: 120px;" title="${c.name}">${c.name}</span>
                                        <span class="small font-weight-bold">${fmtNum(c.hours, 1)}h</span>
                                    </div>
                                `).join('') || '<div class="text-center text-muted py-3 small">No data</div>'}
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Time Entries Table -->
                <div class="card shadow-sm">
                    <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                        <h6 class="mb-0"><i class="fas fa-list mr-2"></i>Time Entries (${entries.length})</h6>
                        <input type="text" class="form-control form-control-sm" style="width: 150px;" 
                            placeholder="Search..." id="tbEmpEntrySearch" oninput="TimeController.filterEmployeeEntries(this.value)">
                    </div>
                    <div class="card-body p-0">
                        <div class="table-responsive" id="tbEmployeeEntriesTable" style="max-height: 200px; overflow-y: auto;">
                            ${this.renderEmployeeEntriesTable(entries)}
                        </div>
                    </div>
                </div>
                
                <!-- Peer Comparison -->
                <div class="mt-3 p-2 border rounded bg-light">
                    <div class="small text-muted mb-1"><i class="fas fa-users mr-1"></i>Performance vs Peers (${employee.employee.title || 'No Title'})</div>
                    ${this.renderEmployeePeerComparison(employee, target)}
                </div>
            `;
        },
        
        renderEmployeeEntriesTable(entries) {
            const state = this.employeeFlyoutState;
            let filtered = entries;
            
            if (state.search) {
                const s = state.search.toLowerCase();
                filtered = entries.filter(e => 
                    (e.itemName || '').toLowerCase().includes(s) ||
                    (e.memo || '').toLowerCase().includes(s) ||
                    (e.customerName || '').toLowerCase().includes(s)
                );
            }
            
            // Sort
            filtered.sort((a, b) => {
                let aVal = a[state.sortCol], bVal = b[state.sortCol];
                if (state.sortCol === 'hours') {
                    aVal = parseFloat(aVal) || 0;
                    bVal = parseFloat(bVal) || 0;
                }
                if (aVal < bVal) return state.sortDir === 'asc' ? -1 : 1;
                if (aVal > bVal) return state.sortDir === 'asc' ? 1 : -1;
                return 0;
            });
            
            // Paginate
            const totalPages = Math.ceil(filtered.length / state.perPage);
            const start = (state.page - 1) * state.perPage;
            const paged = filtered.slice(start, start + state.perPage);
            
            const paginationHtml = filtered.length > state.perPage ? `
                <div class="d-flex justify-content-between align-items-center px-3 py-2 border-top bg-light">
                    <small class="text-muted">Showing ${start + 1}-${Math.min(start + state.perPage, filtered.length)} of ${filtered.length}</small>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-secondary ${state.page <= 1 ? 'disabled' : ''}" 
                            onclick="TimeController.employeeFlyoutPage(${state.page - 1})" ${state.page <= 1 ? 'disabled' : ''}>
                            <i class="fas fa-chevron-left"></i>
                        </button>
                        <button class="btn btn-outline-secondary disabled">${state.page} / ${totalPages}</button>
                        <button class="btn btn-outline-secondary ${state.page >= totalPages ? 'disabled' : ''}" 
                            onclick="TimeController.employeeFlyoutPage(${state.page + 1})" ${state.page >= totalPages ? 'disabled' : ''}>
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            ` : '';
            
            return `
                <table class="table table-sm table-hover mb-0">
                    <thead class="bg-light sticky-top">
                        <tr>
                            <th>Date</th>
                            <th>Item</th>
                            <th class="text-right">Hours</th>
                            <th>Customer</th>
                            <th>Memo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${paged.map(e => `
                            <tr>
                                <td class="text-nowrap">${e.date || '—'}</td>
                                <td class="text-truncate" style="max-width: 100px;" title="${e.itemName || ''}">${e.itemName || '—'}</td>
                                <td class="text-right font-weight-bold">${fmtNum(e.hours, 2)}</td>
                                <td class="text-truncate" style="max-width: 100px;" title="${e.customerName || ''}">${e.customerName || '—'}</td>
                                <td class="text-truncate text-muted" style="max-width: 120px;" title="${e.memo || ''}">${e.memo || '—'}</td>
                            </tr>
                        `).join('') || '<tr><td colspan="5" class="text-center text-muted py-3">No entries found</td></tr>'}
                    </tbody>
                </table>
                ${paginationHtml}
            `;
        },
        
        employeeFlyoutPage(page) {
            const totalPages = Math.ceil(this.employeeFlyoutState.entries.length / this.employeeFlyoutState.perPage);
            if (page < 1 || page > totalPages) return;
            this.employeeFlyoutState.page = page;
            const container = el("#tbEmployeeEntriesTable");
            if (container) {
                container.innerHTML = this.renderEmployeeEntriesTable(this.employeeFlyoutState.entries);
            }
        },
        
        filterEmployeeEntries(query) {
            this.employeeFlyoutState.search = query;
            this.employeeFlyoutState.page = 1;
            const container = el("#tbEmployeeEntriesTable");
            if (container) {
                container.innerHTML = this.renderEmployeeEntriesTable(this.employeeFlyoutState.entries);
            }
        },
        
        renderEmployeeFlyoutFallback(employee, target) {
            const body = el("#tbEmployeeFlyoutBody");
            if (!body) return;
            
            const r = employee.range || {};
            const pr = employee.priorRange || {};
            const d = employee.deltas || {};
            const pctColor = (r.percentBilled || 0) >= target ? 'text-success' : 
                (r.percentBilled || 0) >= target - 10 ? 'text-warning' : 'text-danger';
            
            body.innerHTML = `
                <!-- Employee KPIs -->
                <div class="row mb-3 gutters-sm cf-kpi-row">
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-green-soft"><i class="fas fa-chart-pie text-green"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Billable %</span>
                                <span class="kpi-value ${pctColor}">${fmtPctVal(r.percentBilled, 1)}</span>
                                <span class="kpi-sub">${d.percentBilledDelta !== undefined ? (d.percentBilledDelta >= 0 ? '↑' : '↓') + ' ' + Math.abs(d.percentBilledDelta).toFixed(1) + 'pp' : 'no prior'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-clock text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Hours</span>
                                <span class="kpi-value">${fmtNum(r.hours, 1)}</span>
                                <span class="kpi-sub">${fmtNum(r.billableHours, 1)} billable</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-red-soft"><i class="fas fa-dollar-sign text-red"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Non-Bill Cost</span>
                                <span class="kpi-value text-danger">${fmtMoney(r.nonBillableCost)}</span>
                                <span class="kpi-sub">${fmtNum(r.nonBillableHours, 1)} non-bill hrs</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Employee Info -->
                <div class="card shadow-sm mb-3">
                    <div class="card-header bg-light py-2">
                        <h6 class="mb-0"><i class="fas fa-info-circle mr-2"></i>Employee Details</h6>
                    </div>
                    <div class="card-body">
                        <div class="row">
                            <div class="col-6">
                                <div class="mb-2"><span class="text-muted">Job Title:</span> <strong>${employee.employee.title || 'Not set'}</strong></div>
                                <div class="mb-2"><span class="text-muted">Department:</span> <strong>${employee.employee.departmentName || 'Unknown'}</strong></div>
                            </div>
                            <div class="col-6">
                                <div class="mb-2"><span class="text-muted">Prior Period:</span> <strong>${pr.percentBilled !== undefined ? fmtPctVal(pr.percentBilled, 1) : '—'}</strong></div>
                                <div class="mb-2"><span class="text-muted">Prior Hours:</span> <strong>${pr.hours !== undefined ? fmtNum(pr.hours, 1) : '—'}</strong></div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Peer Comparison -->
                <div class="card shadow-sm">
                    <div class="card-header bg-light py-2">
                        <h6 class="mb-0"><i class="fas fa-users mr-2"></i>Performance vs Peers (${employee.employee.title || 'No Title'})</h6>
                    </div>
                    <div class="card-body">
                        ${this.renderEmployeePeerComparison(employee, target)}
                    </div>
                </div>
            `;
        },
        
        renderEmployeePeerComparison(employee, target) {
            const title = employee.employee.title || 'No Title';
            const peers = (this.latestEmployees || []).filter(e => 
                e.employee.title === title && e.employee.netsuiteId !== employee.employee.netsuiteId
            );
            
            if (peers.length === 0) {
                return '<div class="text-muted text-center py-3">No peers with same job title for comparison</div>';
            }
            
            const peerPcts = peers.map(p => p.range?.percentBilled || 0);
            const avgPeer = peerPcts.reduce((a, b) => a + b, 0) / peerPcts.length;
            const myPct = employee.range?.percentBilled || 0;
            const diff = myPct - avgPeer;
            
            return `
                <div class="row text-center">
                    <div class="col-4">
                        <div class="h4 mb-0 ${myPct >= target ? 'text-success' : 'text-warning'}">${fmtPctVal(myPct, 0)}</div>
                        <div class="small text-muted">This Employee</div>
                    </div>
                    <div class="col-4">
                        <div class="h4 mb-0 text-muted">${fmtPctVal(avgPeer, 0)}</div>
                        <div class="small text-muted">Peer Average (${peers.length})</div>
                    </div>
                    <div class="col-4">
                        <div class="h4 mb-0 ${diff >= 0 ? 'text-success' : 'text-danger'}">${diff >= 0 ? '+' : ''}${fmtPctVal(diff, 0)}</div>
                        <div class="small text-muted">vs Peers</div>
                    </div>
                </div>
            `;
        },
        
        closeEmployeeFlyout() {
            const flyout = el("#tbEmployeeFlyout");
            if (flyout) flyout.style.display = 'none';
        },

        // === ITEM FLYOUT WITH API CALL ===
        itemFlyoutState: {
            entries: [],
            search: '',
            sortCol: 'date',
            sortDir: 'desc',
            page: 1,
            perPage: 50
        },
        
        async showItemDetail(itemId) {
            const item = (this.latestItems || []).find(i => String(i.item.netsuiteId) === String(itemId));
            if (!item) return;
            
            const flyout = el("#tbItemFlyout");
            const title = el("#tbItemFlyoutTitle");
            const body = el("#tbItemFlyoutBody");
            if (!flyout || !title || !body) return;
            
            const thresholds = this.rawData?.company?.thresholds || { targetBillablePercent: 70 };
            const target = thresholds.targetBillablePercent || 70;
            const r = item.range || {};
            
            title.innerHTML = `<i class="fas fa-box mr-2"></i>${item.item.name}`;
            flyout.style.display = 'flex';
            
            const pctColor = (r.percentBilled || 0) >= target ? 'text-success' : 
                (r.percentBilled || 0) >= target - 10 ? 'text-warning' : 'text-danger';
            
            // Show loading state with KPIs
            body.innerHTML = `
                <!-- Item KPIs -->
                <div class="row mb-3 gutters-sm cf-kpi-row">
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-green-soft"><i class="fas fa-chart-pie text-green"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Billable %</span>
                                <span class="kpi-value ${pctColor}">${fmtPctVal(r.percentBilled, 1)}</span>
                                <span class="kpi-sub">target: ${target}%</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-clock text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Hours</span>
                                <span class="kpi-value">${fmtNum(r.hours, 1)}</span>
                                <span class="kpi-sub">${fmtNum(r.billableHours, 1)} billable</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-red-soft"><i class="fas fa-dollar-sign text-red"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Non-Bill Cost</span>
                                <span class="kpi-value text-danger">${fmtMoney(r.nonBillableCost)}</span>
                                <span class="kpi-sub">${fmtNum(r.nonBillableHours, 1)} non-bill hrs</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="text-center py-4">
                    <i class="fas fa-spinner fa-spin fa-2x text-primary"></i>
                    <div class="mt-2 text-muted">Loading time entries...</div>
                </div>
            `;
            
            // Fetch time entries
            try {
                const params = {
                    action: 'time',
                    subAction: 'item_entries',
                    itemId: itemId,
                    startDate: el('#tbStartDate')?.value || '',
                    endDate: el('#tbEndDate')?.value || ''
                };
                if (this.subsidiaryId) params.subsidiary = this.subsidiaryId;
                
                const res = await API.post('time', params);
                
                if (res.status === 'success' && res.entries) {
                    this.itemFlyoutState.entries = res.entries;
                    this.itemFlyoutState.page = 1;
                    this.renderItemFlyoutContent(item, target);
                } else {
                    this.renderItemFlyoutFallback(item, target, 'No time entries found for this item');
                }
            } catch (e) {
                console.error('Item entries error:', e);
                this.renderItemFlyoutFallback(item, target, 'Unable to load time entries');
            }
        },
        
        renderItemFlyoutContent(item, target) {
            const body = el("#tbItemFlyoutBody");
            if (!body) return;
            
            const r = item.range || {};
            const entries = this.itemFlyoutState.entries;
            const pctColor = (r.percentBilled || 0) >= target ? 'text-success' : 
                (r.percentBilled || 0) >= target - 10 ? 'text-warning' : 'text-danger';
            
            // Group by employee
            const byEmployee = {};
            // FIXED: Add null safety for entries array
            (entries || []).forEach(e => {
                const empName = e.employeeName || 'Unknown';
                if (!byEmployee[empName]) byEmployee[empName] = { hours: 0, billableHours: 0, count: 0 };
                byEmployee[empName].hours += e.hours || 0;
                byEmployee[empName].billableHours += e.billableHours || 0;
                byEmployee[empName].count++;
            });
            const employeeBreakdown = Object.entries(byEmployee)
                .map(([name, data]) => ({ name, ...data, pct: data.hours > 0 ? (data.billableHours / data.hours) * 100 : 0 }))
                .sort((a, b) => b.hours - a.hours);
            
            body.innerHTML = `
                <!-- Item KPIs -->
                <div class="row mb-3 gutters-sm cf-kpi-row">
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-green-soft"><i class="fas fa-chart-pie text-green"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Billable %</span>
                                <span class="kpi-value ${pctColor}">${fmtPctVal(r.percentBilled, 1)}</span>
                                <span class="kpi-sub">target: ${target}%</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-clock text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Hours</span>
                                <span class="kpi-value">${fmtNum(r.hours, 1)}</span>
                                <span class="kpi-sub">${fmtNum(r.billableHours, 1)} billable</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-red-soft"><i class="fas fa-dollar-sign text-red"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Non-Bill Cost</span>
                                <span class="kpi-value text-danger">${fmtMoney(r.nonBillableCost)}</span>
                                <span class="kpi-sub">${fmtNum(r.nonBillableHours, 1)} non-bill hrs</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Employee Breakdown -->
                <div class="card shadow-sm mb-3">
                    <div class="card-header bg-light py-2">
                        <h6 class="mb-0"><i class="fas fa-users mr-2"></i>Hours by Employee (${employeeBreakdown.length})</h6>
                    </div>
                    <div class="card-body p-0">
                        <div class="table-responsive" style="max-height: 250px; overflow-y: auto;">
                            <table class="table table-sm table-hover mb-0">
                                <thead class="bg-light sticky-top">
                                    <tr>
                                        <th>Employee</th>
                                        <th class="text-right">Hours</th>
                                        <th class="text-right">Billable %</th>
                                        <th class="text-right">Entries</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${employeeBreakdown.map(e => `
                                        <tr>
                                            <td class="text-truncate" style="max-width: 120px;">${e.name}</td>
                                            <td class="text-right">${fmtNum(e.hours, 1)}</td>
                                            <td class="text-right ${e.pct >= target ? 'text-success' : e.pct >= target - 10 ? 'text-warning' : 'text-danger'}">${fmtPctVal(e.pct, 0)}</td>
                                            <td class="text-right text-muted">${e.count}</td>
                                        </tr>
                                    `).join('') || '<tr><td colspan="4" class="text-center text-muted py-3">No employee data</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                
                <!-- Time Entries Table -->
                <div class="card shadow-sm">
                    <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                        <h6 class="mb-0"><i class="fas fa-list mr-2"></i>Time Entries (${entries.length})</h6>
                        <input type="text" class="form-control form-control-sm" style="width: 150px;" 
                            placeholder="Search..." id="tbItemEntrySearch" oninput="TimeController.filterItemEntries(this.value)">
                    </div>
                    <div class="card-body p-0">
                        <div class="table-responsive" id="tbItemEntriesTable" style="max-height: 250px; overflow-y: auto;">
                            ${this.renderItemEntriesTable(entries)}
                        </div>
                    </div>
                </div>
            `;
        },
        
        renderItemEntriesTable(entries) {
            const state = this.itemFlyoutState;
            let filtered = entries;
            
            if (state.search) {
                const s = state.search.toLowerCase();
                filtered = entries.filter(e => 
                    (e.employeeName || '').toLowerCase().includes(s) ||
                    (e.memo || '').toLowerCase().includes(s) ||
                    (e.customerName || '').toLowerCase().includes(s)
                );
            }
            
            // Sort
            filtered.sort((a, b) => {
                let aVal = a[state.sortCol], bVal = b[state.sortCol];
                if (state.sortCol === 'hours') {
                    aVal = parseFloat(aVal) || 0;
                    bVal = parseFloat(bVal) || 0;
                }
                if (aVal < bVal) return state.sortDir === 'asc' ? -1 : 1;
                if (aVal > bVal) return state.sortDir === 'asc' ? 1 : -1;
                return 0;
            });
            
            // Paginate
            const totalPages = Math.ceil(filtered.length / state.perPage);
            const start = (state.page - 1) * state.perPage;
            const paged = filtered.slice(start, start + state.perPage);
            
            const paginationHtml = filtered.length > state.perPage ? `
                <div class="d-flex justify-content-between align-items-center px-3 py-2 border-top bg-light">
                    <small class="text-muted">Showing ${start + 1}-${Math.min(start + state.perPage, filtered.length)} of ${filtered.length}</small>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-secondary ${state.page <= 1 ? 'disabled' : ''}" 
                            onclick="TimeController.itemFlyoutPage(${state.page - 1})" ${state.page <= 1 ? 'disabled' : ''}>
                            <i class="fas fa-chevron-left"></i>
                        </button>
                        <button class="btn btn-outline-secondary disabled">${state.page} / ${totalPages}</button>
                        <button class="btn btn-outline-secondary ${state.page >= totalPages ? 'disabled' : ''}" 
                            onclick="TimeController.itemFlyoutPage(${state.page + 1})" ${state.page >= totalPages ? 'disabled' : ''}>
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            ` : '';
            
            return `
                <table class="table table-sm table-hover mb-0">
                    <thead class="bg-light sticky-top">
                        <tr>
                            <th>Date</th>
                            <th>Employee</th>
                            <th class="text-right">Hours</th>
                            <th>Customer</th>
                            <th>Memo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${paged.map(e => `
                            <tr>
                                <td class="text-nowrap">${e.date || '—'}</td>
                                <td class="text-truncate" style="max-width: 100px;" title="${e.employeeName || ''}">${e.employeeName || '—'}</td>
                                <td class="text-right font-weight-bold">${fmtNum(e.hours, 2)}</td>
                                <td class="text-truncate" style="max-width: 100px;" title="${e.customerName || ''}">${e.customerName || '—'}</td>
                                <td class="text-truncate text-muted" style="max-width: 120px;" title="${e.memo || ''}">${e.memo || '—'}</td>
                            </tr>
                        `).join('') || '<tr><td colspan="5" class="text-center text-muted py-3">No entries found</td></tr>'}
                    </tbody>
                </table>
                ${paginationHtml}
            `;
        },
        
        itemFlyoutPage(page) {
            const totalPages = Math.ceil(this.itemFlyoutState.entries.length / this.itemFlyoutState.perPage);
            if (page < 1 || page > totalPages) return;
            this.itemFlyoutState.page = page;
            const container = el("#tbItemEntriesTable");
            if (container) {
                container.innerHTML = this.renderItemEntriesTable(this.itemFlyoutState.entries);
            }
        },
        
        filterItemEntries(query) {
            this.itemFlyoutState.search = query;
            this.itemFlyoutState.page = 1;
            const container = el("#tbItemEntriesTable");
            if (container) {
                container.innerHTML = this.renderItemEntriesTable(this.itemFlyoutState.entries);
            }
        },
        
        renderItemFlyoutFallback(item, target, message) {
            const body = el("#tbItemFlyoutBody");
            if (!body) return;
            
            const r = item.range || {};
            const pctColor = (r.percentBilled || 0) >= target ? 'text-success' : 
                (r.percentBilled || 0) >= target - 10 ? 'text-warning' : 'text-danger';
            
            body.innerHTML = `
                <!-- Item KPIs -->
                <div class="row mb-3 gutters-sm cf-kpi-row">
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-green-soft"><i class="fas fa-chart-pie text-green"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Billable %</span>
                                <span class="kpi-value ${pctColor}">${fmtPctVal(r.percentBilled, 1)}</span>
                                <span class="kpi-sub">target: ${target}%</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-purple-soft"><i class="fas fa-clock text-purple"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Hours</span>
                                <span class="kpi-value">${fmtNum(r.hours, 1)}</span>
                                <span class="kpi-sub">${fmtNum(r.billableHours, 1)} billable</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="cf-kpi-card">
                            <div class="icon-wrapper bg-red-soft"><i class="fas fa-dollar-sign text-red"></i></div>
                            <div class="kpi-content">
                                <span class="kpi-label">Non-Bill Cost</span>
                                <span class="kpi-value text-danger">${fmtMoney(r.nonBillableCost)}</span>
                                <span class="kpi-sub">${fmtNum(r.nonBillableHours, 1)} non-bill hrs</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="alert alert-info">
                    <i class="fas fa-info-circle mr-2"></i>
                    <small>${message}</small>
                </div>
            `;
        },
        
        closeItemFlyout() {
            const flyout = el("#tbItemFlyout");
            if (flyout) flyout.style.display = 'none';
        },

        renderTitleDetailRows(employees, target) {
            const tbody = el("#tbTitleDetailBody");
            if (!tbody) return;
            
            tbody.innerHTML = employees.map(e => {
                const r = e.range || {};
                const pctColor = (r.percentBilled || 0) >= target ? 'text-success' : 
                    (r.percentBilled || 0) >= target - 10 ? 'text-warning' : 'text-danger';
                return `<tr>
                    <td>${e.employee.name}</td>
                    <td class="text-right font-weight-bold ${pctColor}">${fmtPctVal(r.percentBilled, 1)}</td>
                    <td class="text-right">${fmtNum(r.hours, 0)}</td>
                    <td class="text-right">${fmtNum(r.billableHours, 0)}</td>
                    <td class="text-right text-danger">${fmtMoney(r.nonBillableCost, 0)}</td>
                </tr>`;
            }).join('');
        },

        initTitleDetailSorting(employees, target) {
            const table = el("#tbTitleDetailTable");
            if (!table) return;

            table.querySelectorAll('th.sortable').forEach(th => {
                th.addEventListener('click', () => {
                    const sortKey = th.dataset.sort;
                    const currentDir = this.sortState[`titleDetail_${sortKey}`] || 'asc';
                    const newDir = currentDir === 'asc' ? 'desc' : 'asc';
                    this.sortState[`titleDetail_${sortKey}`] = newDir;

                    // Update icons
                    table.querySelectorAll('th.sortable i').forEach(i => {
                        i.className = 'fas fa-sort text-muted ml-1';
                    });
                    th.querySelector('i').className = `fas fa-sort-${newDir === 'asc' ? 'up' : 'down'} text-primary ml-1`;

                    // Sort
                    const sorted = [...employees].sort((a, b) => {
                        let aVal, bVal;
                        const aR = a.range || {};
                        const bR = b.range || {};
                        
                        if (sortKey === 'name') {
                            aVal = a.employee?.name || '';
                            bVal = b.employee?.name || '';
                            return newDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                        }
                        if (sortKey === 'percentBilled') {
                            aVal = aR.percentBilled || 0;
                            bVal = bR.percentBilled || 0;
                        } else if (sortKey === 'hours') {
                            aVal = aR.hours || 0;
                            bVal = bR.hours || 0;
                        } else if (sortKey === 'billableHours') {
                            aVal = aR.billableHours || 0;
                            bVal = bR.billableHours || 0;
                        } else if (sortKey === 'nonBillableCost') {
                            aVal = aR.nonBillableCost || 0;
                            bVal = bR.nonBillableCost || 0;
                        }
                        return newDir === 'asc' ? aVal - bVal : bVal - aVal;
                    });

                    this.renderTitleDetailRows(sorted, target);
                });
            });
        },

        initJobTitlesSorting(titles) {
            const table = el("#tbTitlesTableSortable");
            if (!table) return;

            table.querySelectorAll('th.sortable').forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    const sortKey = th.dataset.sort;
                    const currentDir = this.sortState[`titles_${sortKey}`] || 'asc';
                    const newDir = currentDir === 'asc' ? 'desc' : 'asc';
                    this.sortState[`titles_${sortKey}`] = newDir;

                    // Update icons
                    table.querySelectorAll('th.sortable i').forEach(i => {
                        i.className = 'fas fa-sort text-muted ml-1';
                    });
                    th.querySelector('i').className = `fas fa-sort-${newDir === 'asc' ? 'up' : 'down'} text-primary ml-1`;

                    // Sort
                    const sorted = [...titles].sort((a, b) => {
                        let aVal, bVal;
                        if (sortKey === 'title') {
                            aVal = a.title;
                            bVal = b.title;
                            return newDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                        }
                        if (sortKey === 'count') {
                            aVal = a.employees.length;
                            bVal = b.employees.length;
                        } else if (sortKey === 'percentBilled') {
                            aVal = a.percentBilled;
                            bVal = b.percentBilled;
                        } else if (sortKey === 'avgPercent') {
                            aVal = a.avgPercentBilled;
                            bVal = b.avgPercentBilled;
                        } else if (sortKey === 'hours') {
                            aVal = a.totals.hours;
                            bVal = b.totals.hours;
                        } else if (sortKey === 'nonBillableCost') {
                            aVal = a.totals.nonBillableCost;
                            bVal = b.totals.nonBillableCost;
                        }
                        return newDir === 'asc' ? aVal - bVal : bVal - aVal;
                    });

                    const target = this.rawData?.company?.thresholds?.targetBillablePercent || 70;
                    this.renderJobTitlesTableRows(sorted, target);
                });
            });
        },

        // === SORTABLE TABLES ===
        initSortableTable(tableId, data, type) {
            const table = el(`#${tableId}`);
            if (!table) return;

            table.querySelectorAll('th.sortable').forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    const sortKey = th.dataset.sort;
                    const currentDir = this.sortState[`${tableId}_${sortKey}`] || 'asc';
                    const newDir = currentDir === 'asc' ? 'desc' : 'asc';
                    this.sortState[`${tableId}_${sortKey}`] = newDir;

                    // Update sort icons
                    table.querySelectorAll('th.sortable i').forEach(i => {
                        i.className = 'fas fa-sort text-muted ml-1';
                    });
                    th.querySelector('i').className = `fas fa-sort-${newDir === 'asc' ? 'up' : 'down'} text-primary ml-1`;

                    // Sort data
                    const sorted = this.sortData(data, sortKey, newDir, type);
                    
                    // Re-render appropriate table
                    if (type === 'dept') {
                        this.renderDeptTableRows(sorted);
                    } else if (type === 'item') {
                        this.renderItemTableRows(sorted, el("#tbItemTableBodyNew"));
                    } else if (type === 'employee') {
                        const groupBy = el("#tbEmployeeGroupBy")?.value || 'none';
                        this.renderEmployeeTableRows(data, el("#tbEmployeeTableBodyNew"), groupBy, sortKey, newDir);
                    }
                });
            });
        },

        sortData(data, key, dir, type) {
            return [...data].sort((a, b) => {
                let aVal, bVal;
                
                if (key === 'name') {
                    if (type === 'dept') {
                        aVal = a.department?.name || '';
                        bVal = b.department?.name || '';
                    } else if (type === 'item') {
                        aVal = a.item?.name || '';
                        bVal = b.item?.name || '';
                    } else {
                        aVal = a.employee?.name || '';
                        bVal = b.employee?.name || '';
                    }
                    return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                }
                
                if (key === 'percentBilled') {
                    aVal = a.range?.percentBilled || 0;
                    bVal = b.range?.percentBilled || 0;
                } else if (key === 'nonBillableCost') {
                    aVal = a.range?.nonBillableCost || 0;
                    bVal = b.range?.nonBillableCost || 0;
                } else if (key === 'hours') {
                    aVal = a.range?.hours || 0;
                    bVal = b.range?.hours || 0;
                } else if (key === 'delta') {
                    aVal = a.deltas?.percentBilledDelta || 0;
                    bVal = b.deltas?.percentBilledDelta || 0;
                }
                
                return dir === 'asc' ? aVal - bVal : bVal - aVal;
            });
        },

        // === HISTORY TAB ===
        renderHistoryTab(data) {
            const container = el("#tbHistoryContainer");
            if (!container) return;

            const history = data.history;
            if (!history || !history.periods) {
                container.innerHTML = `
                    <div class="text-center text-muted py-5">
                        <i class="fas fa-info-circle fa-2x mb-3"></i>
                        <p>Historical data not available.</p>
                    </div>
                `;
                return;
            }

            const periods = history.periods;
            const depts = this.latestDepts || [];
            const target = data.company?.thresholds?.targetBillablePercent || 70;

            // Current period from main data
            const currentPeriod = {
                label: 'Current',
                isCurrent: true,
                sortOrder: 999, // Always at top when sorting by period
                companyPct: data.company?.range?.percentBilled || 0,
                deptData: {}
            };
            depts.forEach(d => {
                currentPeriod.deptData[d.department.netsuiteId] = {
                    percentBilled: d.range?.percentBilled || 0
                };
            });

            // Add sortOrder to historical periods (most recent first)
            const periodsWithOrder = periods.map((p, i) => ({
                ...p,
                sortOrder: periods.length - i
            }));

            const allPeriods = [currentPeriod, ...periodsWithOrder];
            const trendValues = allPeriods.map(p => p.companyPct || 0).reverse();
            const trendLabels = allPeriods.map(p => p.label).reverse();

            container.innerHTML = `
                <div class="row mb-4" style="min-height: 260px;">
                    <div class="col-md-6 d-flex">
                        <div class="card shadow-sm w-100">
                            <div class="card-header bg-white py-2">
                                <h6 class="mb-0"><i class="fas fa-chart-line mr-2 text-primary"></i>Company Billable % Trend</h6>
                            </div>
                            <div class="card-body d-flex align-items-center justify-content-center p-2">
                                <div id="tbHistoryTrendChart" style="width: 100%; height: 180px;"></div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6 d-flex">
                        <div class="card shadow-sm w-100">
                            <div class="card-header bg-white py-2">
                                <h6 class="mb-0"><i class="fas fa-bullseye mr-2 text-primary"></i>Target: ${target}% Billable</h6>
                            </div>
                            <div class="card-body d-flex flex-column justify-content-center">
                                <div class="row text-center mb-3">
                                    <div class="col-4">
                                        <div class="h2 mb-0 text-success">${allPeriods.filter(p => (p.companyPct || 0) >= target).length}</div>
                                        <div class="small text-muted">Above Target</div>
                                    </div>
                                    <div class="col-4">
                                        <div class="h2 mb-0 text-warning">${allPeriods.filter(p => (p.companyPct || 0) >= target - 10 && (p.companyPct || 0) < target).length}</div>
                                        <div class="small text-muted">Near Target</div>
                                    </div>
                                    <div class="col-4">
                                        <div class="h2 mb-0 text-danger">${allPeriods.filter(p => (p.companyPct || 0) < target - 10).length}</div>
                                        <div class="small text-muted">Below Target</div>
                                    </div>
                                </div>
                                <hr class="my-2">
                                <div class="d-flex justify-content-between align-items-center py-2">
                                    <span class="text-muted">Average Billable %</span>
                                    <span class="h4 mb-0 font-weight-bold">${fmtPctVal(trendValues.reduce((a,b) => a+b, 0) / trendValues.length, 1)}</span>
                                </div>
                                <div class="d-flex justify-content-between align-items-center py-2">
                                    <span class="text-muted">Periods Analyzed</span>
                                    <span class="h4 mb-0 font-weight-bold">${allPeriods.length}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card shadow-sm">
                    <div class="card-header bg-white py-2">
                        <h6 class="mb-0"><i class="fas fa-history mr-2 text-primary"></i>Rolling Period History (% Billable)</h6>
                    </div>
                    <div class="card-body p-0">
                        <div class="table-responsive">
                            <table class="table table-sm table-hover table-bordered mb-0" id="tbHistoryDetailTable">
                                <thead class="bg-light">
                                    <tr>
                                        <th class="sortable" data-sort="period" style="cursor:pointer;">Period <i class="fas fa-sort text-muted ml-1"></i></th>
                                        ${depts.map(d => `<th class="text-right sortable" data-sort="dept_${d.department.netsuiteId}" style="cursor:pointer;">${d.department.name} <i class="fas fa-sort text-muted ml-1"></i></th>`).join('')}
                                        <th class="text-right font-weight-bold sortable" data-sort="company" style="cursor:pointer;">Company <i class="fas fa-sort text-muted ml-1"></i></th>
                                    </tr>
                                </thead>
                                <tbody id="tbHistoryDetailBody">
                                    ${allPeriods.map(p => {
                                        const rowClass = p.isCurrent ? 'table-active font-weight-bold' : '';
                                        const cells = depts.map(d => {
                                            const pct = p.deptData?.[d.department.netsuiteId]?.percentBilled || 0;
                                            const color = pct >= target ? 'text-success' : pct >= target - 10 ? 'text-warning' : 'text-danger';
                                            return `<td class="text-right ${color}">${fmtPctVal(pct, 1)}</td>`;
                                        }).join('');
                                        const companyColor = (p.companyPct || 0) >= target ? 'text-success' : 
                                            (p.companyPct || 0) >= target - 10 ? 'text-warning' : 'text-danger';
                                        
                                        return `
                                            <tr class="${rowClass}">
                                                <td>
                                                    ${p.isCurrent ? '<i class="fas fa-star text-warning mr-1"></i>' : ''}
                                                    ${p.label}
                                                </td>
                                                ${cells}
                                                <td class="text-right font-weight-bold ${companyColor}">${fmtPctVal(p.companyPct, 1)}</td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;

            // Render trend chart
            setTimeout(() => this.renderHistoryTrendChart(trendLabels, trendValues, target), 100);
            
            // Initialize history table sorting
            setTimeout(() => this.initHistoryTableSort(allPeriods, depts, target), 50);
        },

        initHistoryTableSort(allPeriods, depts, target) {
            const table = el("#tbHistoryDetailTable");
            if (!table) return;

            table.querySelectorAll('th.sortable').forEach(th => {
                th.addEventListener('click', () => {
                    const sortKey = th.dataset.sort;
                    const currentDir = this.sortState[`history_${sortKey}`] || 'asc';
                    const newDir = currentDir === 'asc' ? 'desc' : 'asc';
                    this.sortState[`history_${sortKey}`] = newDir;

                    // Update icons
                    table.querySelectorAll('th.sortable i').forEach(i => {
                        i.className = 'fas fa-sort text-muted ml-1';
                    });
                    th.querySelector('i').className = `fas fa-sort-${newDir === 'asc' ? 'up' : 'down'} text-primary ml-1`;

                    // Sort
                    const sorted = [...allPeriods].sort((a, b) => {
                        let aVal, bVal;
                        if (sortKey === 'period') {
                            // Keep current at top, sort rest by date
                            if (a.isCurrent) return -1;
                            if (b.isCurrent) return 1;
                            aVal = a.sortOrder || 0;
                            bVal = b.sortOrder || 0;
                        } else if (sortKey === 'company') {
                            aVal = a.companyPct || 0;
                            bVal = b.companyPct || 0;
                        } else if (sortKey.startsWith('dept_')) {
                            const deptId = sortKey.replace('dept_', '');
                            aVal = a.deptData?.[deptId]?.percentBilled || 0;
                            bVal = b.deptData?.[deptId]?.percentBilled || 0;
                        }
                        return newDir === 'asc' ? aVal - bVal : bVal - aVal;
                    });

                    this.renderHistoryTableRows(sorted, depts, target);
                });
            });
        },

        renderHistoryTableRows(periods, depts, target) {
            const tbody = el("#tbHistoryDetailBody");
            if (!tbody) return;

            tbody.innerHTML = periods.map(p => {
                const rowClass = p.isCurrent ? 'table-active font-weight-bold' : '';
                const cells = depts.map(d => {
                    const pct = p.deptData?.[d.department.netsuiteId]?.percentBilled || 0;
                    const color = pct >= target ? 'text-success' : pct >= target - 10 ? 'text-warning' : 'text-danger';
                    return `<td class="text-right ${color}">${fmtPctVal(pct, 1)}</td>`;
                }).join('');
                const companyColor = (p.companyPct || 0) >= target ? 'text-success' : 
                    (p.companyPct || 0) >= target - 10 ? 'text-warning' : 'text-danger';
                
                return `
                    <tr class="${rowClass}">
                        <td>
                            ${p.isCurrent ? '<i class="fas fa-star text-warning mr-1"></i>' : ''}
                            ${p.label}
                        </td>
                        ${cells}
                        <td class="text-right font-weight-bold ${companyColor}">${fmtPctVal(p.companyPct, 1)}</td>
                    </tr>
                `;
            }).join('');
        },

        renderHistoryTrendChart(labels, values, target) {
            const chartDiv = el("#tbHistoryTrendChart");
            if (!chartDiv || !window.Plotly) return;

            const minVal = Math.min(...values, target - 15);
            const maxVal = Math.max(...values, target + 10);

            const data = [
                {
                    x: labels,
                    y: values,
                    type: 'scatter',
                    mode: 'lines+markers',
                    fill: 'tozeroy',
                    line: { color: '#3b82f6', width: 2, shape: 'spline' },
                    marker: { size: 8, color: '#3b82f6' },
                    fillcolor: 'rgba(59, 130, 246, 0.1)',
                    name: 'Billable %',
                    hovertemplate: '%{x}: %{y:.1f}%<extra></extra>'
                },
                {
                    x: labels,
                    y: Array(labels.length).fill(target),
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: '#10b981', width: 2, dash: 'dash' },
                    name: 'Target',
                    hoverinfo: 'skip'
                }
            ];

            const layout = {
                margin: { l: 40, r: 10, t: 10, b: 40 },
                xaxis: { tickfont: { size: 10 } },
                yaxis: { 
                    ticksuffix: '%', 
                    tickfont: { size: 10 },
                    range: [minVal - 5, maxVal + 5]
                },
                showlegend: false,
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                hovermode: 'x unified'
            };

            Plotly.newPlot(chartDiv, data, layout, { responsive: true, displayModeBar: false });
        },

        // === CONFIGURATION TAB ===
        configData: null,
        allDepartments: [],
        allEmployees: [],
        allEmployeeTypes: [],

        async loadConfig() {
            try {
                const res = await API.get('time_config');
                if (res.error) {
                    this.configData = {};
                    this.renderConfigError("API Error: " + res.error);
                    return;
                }
                this.configData = res.config || {};
                this.allDepartments = res.departments || [];
                this.allEmployees = res.employees || [];
                this.subsidiaries = res.subsidiaries || [];
                this.renderSubsidiaryDropdown();

                // Fetch employee types from burden API (already exists there)
                this.loadEmployeeTypes();

                this.renderConfigTab();
                // Load data after config (which has subsidiaries)
                this.loadData();
            } catch(e) {
                console.error("Time config load error", e);
                el('#gantry-view-container').innerHTML = ErrorBoundary.renderError(e, {
                    title: 'Failed to Load Billable Time Dashboard',
                    retryAction: "TimeController.init()"
                });
            }
        },

        async loadEmployeeTypes() {
            try {
                const res = await API.post('burden', { subAction: 'get_employee_types' });
                if (res && res.employeeTypes) {
                    this.allEmployeeTypes = res.employeeTypes;
                    this.renderEmployeeTypesUI();
                }
            } catch(e) {
                console.error("Failed to load employee types", e);
            }
        },

        renderEmployeeTypesUI() {
            const container = el("#timeEmpTypesContainer");
            if (!container) return;

            const excludedTypes = (this.configData.excludeEmployeeTypes || []).map(t => String(t));
            const empTypes = this.allEmployeeTypes || [];

            if (empTypes.length === 0) {
                container.innerHTML = '<p class="text-muted mb-0 small">No employee types found</p>';
                return;
            }

            container.innerHTML = empTypes.map(t => {
                const isExcluded = excludedTypes.includes(String(t.id));
                return `
                    <div class="custom-control custom-checkbox mb-1">
                        <input type="checkbox" class="custom-control-input time-emptype-exclude"
                            id="timeEmpType_${t.id}" data-emptype-id="${t.id}" ${isExcluded ? 'checked' : ''}>
                        <label class="custom-control-label small" for="timeEmpType_${t.id}">${escapeHtml(t.name)}</label>
                    </div>
                `;
            }).join('');

            // Update badge
            const badge = el("#timeEmpTypeExcludeCount");
            if (badge) badge.textContent = excludedTypes.length + ' excluded';
        },

        renderConfigError(message) {
            const container = el("#timeConfigContainer");
            if (!container) return;
            container.innerHTML = `
                <div class="p-4 text-center">
                    <div class="text-danger mb-3"><i class="fas fa-exclamation-triangle fa-2x"></i></div>
                    <h6 class="text-danger">Configuration Error</h6>
                    <p class="text-muted small">${message}</p>
                </div>
            `;
        },

        renderConfigTab() {
            const container = el("#timeConfigContainer");
            if (!container) return;

            const cfg = this.configData;
            const hiddenDepts = cfg.hiddenDepartments || [];
            const hiddenEmps = cfg.hiddenEmployees || [];
            const noBillDepts = cfg.noBillableDepartments || [];

            let deptCheckboxes = this.allDepartments.map(d => {
                const isChecked = !hiddenDepts.includes(String(d.id));
                return `
                    <div class="custom-control custom-checkbox mb-1">
                        <input type="checkbox" class="custom-control-input time-dept-toggle" 
                            id="timeDept_${d.id}" data-dept-id="${d.id}" ${isChecked ? 'checked' : ''}>
                        <label class="custom-control-label small" for="timeDept_${d.id}">${d.name}</label>
                    </div>
                `;
            }).join('');

            // Non-billable departments (visible but excluded from company % calculation)
            let noBillDeptCheckboxes = this.allDepartments.map(d => {
                const isChecked = noBillDepts.includes(String(d.id));
                return `
                    <div class="custom-control custom-checkbox mb-1">
                        <input type="checkbox" class="custom-control-input time-dept-nobill" 
                            id="timeNoBill_${d.id}" data-dept-id="${d.id}" ${isChecked ? 'checked' : ''}>
                        <label class="custom-control-label small" for="timeNoBill_${d.id}">${d.name}</label>
                    </div>
                `;
            }).join('');

            const sortedEmps = [...this.allEmployees].sort((a,b) => (a.name||'').localeCompare(b.name||''));
            let empOptions = sortedEmps.map(e => {
                const isHidden = hiddenEmps.includes(String(e.id));
                const deptLabel = e.department ? ` (${e.department})` : '';
                return `<option value="${e.id}" ${isHidden ? 'selected' : ''}>${e.name}${deptLabel}</option>`;
            }).join('');

            container.innerHTML = `
                <div class="p-4">
                    <div class="d-flex align-items-center mb-4 pb-2 border-bottom">
                        <div class="icon-box bg-blue-soft text-blue mr-3"><i class="fas fa-clock"></i></div>
                        <div>
                            <h5 class="m-0 font-weight-bold">Time Efficiency Configuration</h5>
                            <small class="text-muted">Customize thresholds and visibility settings</small>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-md-6 mb-4">
                            <div class="card h-100">
                                <div class="card-header bg-light py-2">
                                    <h6 class="mb-0"><i class="fas fa-tachometer-alt mr-2"></i>Performance Thresholds</h6>
                                </div>
                                <div class="card-body">
                                    <div class="form-group">
                                        <label class="cf-label">Target Billable Percent (%)</label>
                                        <input type="number" class="form-control form-control-sm" id="cfgTimeTargetBillable" 
                                            value="${cfg.targetBillablePercent || 70}" step="1" min="0" max="100">
                                        <small class="text-muted">Alert when billable % falls below this target</small>
                                    </div>
                                    <div class="form-group">
                                        <label class="cf-label">Non-Billable Cost Spike Threshold ($)</label>
                                        <input type="number" class="form-control form-control-sm" id="cfgTimeNonBillSpike" 
                                            value="${cfg.nonBillableCostSpikeThreshold || 1000}" step="100" min="0">
                                        <small class="text-muted">Alert when non-billable cost increases by this amount</small>
                                    </div>
                                    <div class="form-group mb-0">
                                        <label class="cf-label">Minimum Hours for Analysis</label>
                                        <input type="number" class="form-control form-control-sm" id="cfgTimeMinHours" 
                                            value="${cfg.minimumHoursForAnalysis || 10}" step="1" min="0">
                                        <small class="text-muted">Exclude entries with fewer hours from heatmap</small>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-6 mb-4">
                            <div class="card h-100">
                                <div class="card-header bg-light py-2">
                                    <h6 class="mb-0"><i class="fas fa-cog mr-2"></i>Advanced Settings</h6>
                                </div>
                                <div class="card-body">
                                    <div class="form-group mb-0">
                                        <label class="cf-label">Labor Cost Field</label>
                                        <input type="text" class="form-control form-control-sm" id="cfgTimeLaborField"
                                            value="${cfg.laborCostField || 'laborcost'}">
                                        <small class="text-muted">NetSuite field ID for labor cost</small>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-6 mb-4">
                            <div class="card h-100">
                                <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                                    <h6 class="mb-0"><i class="fas fa-user-tag mr-2"></i>Exclude Employee Types</h6>
                                    <span class="badge badge-secondary" id="timeEmpTypeExcludeCount">0 excluded</span>
                                </div>
                                <div class="card-body">
                                    <p class="small text-muted mb-2">Checked employee types are <strong>excluded from all analysis</strong>. Their time entries will not appear in any dashboard data.</p>
                                    <div class="border rounded p-2 bg-light" style="max-height: 150px; overflow-y: auto;" id="timeEmpTypesContainer">
                                        <p class="text-muted mb-0 small"><i class="fas fa-spinner fa-spin mr-1"></i>Loading employee types...</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-6 mb-4">
                            <div class="card h-100">
                                <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                                    <h6 class="mb-0"><i class="fas fa-sitemap mr-2"></i>Department Visibility</h6>
                                    <div>
                                        <button class="btn btn-xs btn-outline-secondary mr-1" onclick="document.querySelectorAll('.time-dept-toggle').forEach(c=>c.checked=true)">All</button>
                                        <button class="btn btn-xs btn-outline-secondary" onclick="document.querySelectorAll('.time-dept-toggle').forEach(c=>c.checked=false)">None</button>
                                    </div>
                                </div>
                                <div class="card-body">
                                    <p class="small text-muted mb-2">Unchecked departments are completely hidden from analysis.</p>
                                    <div class="border rounded p-2 bg-light" style="max-height: 150px; overflow-y: auto;">
                                        ${deptCheckboxes || '<p class="text-muted mb-0 small">No departments found</p>'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-6 mb-4">
                            <div class="card h-100">
                                <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                                    <h6 class="mb-0"><i class="fas fa-ban mr-2"></i>Non-Billable Departments</h6>
                                    <div>
                                        <button class="btn btn-xs btn-outline-secondary mr-1" onclick="document.querySelectorAll('.time-dept-nobill').forEach(c=>c.checked=false)">None</button>
                                        <button class="btn btn-xs btn-outline-secondary" onclick="document.querySelectorAll('.time-dept-nobill').forEach(c=>c.checked=true)">All</button>
                                    </div>
                                </div>
                                <div class="card-body">
                                    <p class="small text-muted mb-2">Checked departments have <strong>no billable expectation</strong> (e.g., Admin, Shop). They remain visible but are excluded from company billable % calculation.</p>
                                    <div class="border rounded p-2 bg-light" style="max-height: 150px; overflow-y: auto;">
                                        ${noBillDeptCheckboxes || '<p class="text-muted mb-0 small">No departments found</p>'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-12 mb-4">
                            <div class="card">
                                <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                                    <h6 class="mb-0"><i class="fas fa-user-slash mr-2"></i>Hidden Employees</h6>
                                    <div>
                                        <button class="btn btn-xs btn-outline-secondary mr-1" onclick="el('#cfgTimeHiddenEmps').selectedIndex=-1;Array.from(el('#cfgTimeHiddenEmps').options).forEach(o=>o.selected=false)">Show All</button>
                                        <button class="btn btn-xs btn-outline-secondary" onclick="Array.from(el('#cfgTimeHiddenEmps').options).forEach(o=>o.selected=true)">Hide All</button>
                                    </div>
                                </div>
                                <div class="card-body">
                                    <p class="small text-muted mb-2">Select employees to <strong>hide</strong> from analysis (Ctrl/Cmd+click to select multiple).</p>
                                    <select multiple class="form-control" id="cfgTimeHiddenEmps" style="height: 200px;">
                                        ${empOptions || ''}
                                    </select>
                                    <small class="text-muted mt-1 d-block">${sortedEmps.length} employees total. ${hiddenEmps.length} currently hidden.</small>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="text-right mt-3">
                        <button class="btn btn-primary shadow-sm px-4" onclick="TimeController.saveConfig()">
                            <i class="fas fa-save mr-2"></i>Save Configuration
                        </button>
                    </div>
                </div>
            `;
        },

        async saveConfig() {
            const hiddenDepts = [];
            document.querySelectorAll('.time-dept-toggle').forEach(cb => {
                if (!cb.checked) hiddenDepts.push(cb.dataset.deptId);
            });

            const noBillDepts = [];
            document.querySelectorAll('.time-dept-nobill').forEach(cb => {
                if (cb.checked) noBillDepts.push(cb.dataset.deptId);
            });

            const hiddenEmps = [];
            const empSelect = el("#cfgTimeHiddenEmps");
            if (empSelect) {
                Array.from(empSelect.selectedOptions).forEach(opt => {
                    hiddenEmps.push(opt.value);
                });
            }

            // Collect excluded employee types
            const excludeEmpTypes = [];
            document.querySelectorAll('.time-emptype-exclude').forEach(cb => {
                if (cb.checked) excludeEmpTypes.push(cb.dataset.emptypeId);
            });

            const configToSave = {
                targetBillablePercent: parseInt(el("#cfgTimeTargetBillable")?.value) || 70,
                nonBillableCostSpikeThreshold: parseFloat(el("#cfgTimeNonBillSpike")?.value) || 1000,
                minimumHoursForAnalysis: parseInt(el("#cfgTimeMinHours")?.value) || 10,
                laborCostField: el("#cfgTimeLaborField")?.value || 'laborcost',
                hiddenDepartments: hiddenDepts,
                noBillableDepartments: noBillDepts,
                hiddenEmployees: hiddenEmps,
                excludeEmployeeTypes: excludeEmpTypes
            };

            try {
                const res = await API.post('save_time_config', configToSave);
                if (res.status === 'success') {
                    showToast("Time configuration saved!");
                    this.configData = configToSave;
                    this.loadData();
                } else {
                    alert('Error saving: ' + res.message);
                }
            } catch(e) {
                console.error(e);
                alert('Error saving configuration');
            }
        }
    };

    window.TimeController = TimeController;
    Router.register('time', () => TimeController.init());
    console.log('[Dashboard.Time] Loaded - Enhanced');

})(window);
