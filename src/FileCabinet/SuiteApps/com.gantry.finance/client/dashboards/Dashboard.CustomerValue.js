/**
 * Dashboard.CustomerValue.js
 * Customer Value Intelligence Dashboard
 * 
 * World-class customer analytics visualization:
 * - Executive Summary with Intelligence Score
 * - Customer Health Scorecard with grouping
 * - RFM Segmentation Matrix
 * - Lifetime Value Analysis
 * - Churn Risk Monitor
 * - Project Analysis with Costing
 * - Comprehensive Configuration
 */
(function() {
    'use strict';

    function el(s) { return typeof s === 'string' ? document.querySelector(s) : s; }
    function els(s) { return document.querySelectorAll(s); }

    // Custom sort orders for non-alphabetical sorting
    var SORT_ORDERS = {
        tier: { platinum: 1, gold: 2, silver: 3, bronze: 4, unknown: 5 },
        risk: { critical: 1, high: 2, medium: 3, low: 4, unknown: 5 },
        segment: { champions: 1, loyal: 2, potential: 3, new: 4, regular: 5, hibernating: 6, 'at-risk': 7, lost: 8, unknown: 9 },
        grade: { 'A': 1, 'A+': 1, 'A-': 2, 'B': 3, 'B+': 3, 'B-': 4, 'C': 5, 'C+': 5, 'C-': 6, 'D': 7, 'D+': 7, 'D-': 8, 'F': 9 }
    };

    window.CustomerValueController = {
        latestData: null,
        configData: {},
        subsidiaryId: null,
        subsidiaries: [],
        currencySymbol: '$',
        analysisWindow: '12',
        
        // Pagination state
        pagination: {
            health: { page: 1, pageSize: 25 },
            clv: { page: 1, pageSize: 25 },
            churn: { page: 1, pageSize: 25 },
            segment: { page: 1, pageSize: 25 }
        },
        
        // Sort state
        sortState: {
            health: { column: 'healthScore', direction: 'desc' },
            clv: { column: 'projectedCLV', direction: 'desc' },
            churn: { column: 'churnScore', direction: 'desc' },
            segment: { column: 'totalRevenue', direction: 'desc' }
        },
        
        // Grouping state
        healthGroupBy: 'none',

        init: function() {
            var self = this;
            this.render();
            this.loadInitialData();
            
            // Bind events
            jQuery(document).off('.customervalue').on('change.customervalue', '#cvSubsidiary', function() {
                self.subsidiaryId = this.value;
                self.loadData();
            }).on('change.customervalue', '#cvAnalysisWindow', function() {
                self.analysisWindow = this.value;
                self.loadData();
            }).on('click.customervalue', '#cvApplyRange', function() {
                self.loadData();
            }).on('shown.bs.tab.customervalue', 'a[data-toggle="tab"]', function(e) {
                var target = jQuery(e.target).attr('href');
                if (target === '#cv-config') {
                    self.renderConfigTab();
                } else if (target === '#cv-profit') {
                    self.renderProfitabilityTab();
                }
            });
            
            // Initialize tooltips
            jQuery('[data-toggle="tooltip"]').tooltip();
        },

        render: function() {
            var container = el('#gantry-view-container');
            if (!container) return;

            var tpl = el('#tpl-customervalue');
            if (tpl) {
                container.innerHTML = tpl.innerHTML;
            } else {
                container.innerHTML = '<div class="cf-dashboard p-3"><div class="alert alert-warning"><i class="fas fa-exclamation-triangle mr-2"></i>Customer Value template not found.</div></div>';
                return;
            }

            this.showSkeletonLoading();
        },

        showSkeletonLoading: function() {
            // Intelligence gauge skeleton (risk-meter style)
            var gaugeEl = el('#CV_IntelligenceGauge');
            if (gaugeEl) gaugeEl.innerHTML = Skeleton.render('custom', { width: '100px', height: '55px' });
            var valueEl = el('#CV_IntelligenceScore');
            if (valueEl) { valueEl.textContent = '--'; valueEl.className = 'risk-meter-value'; }
            var labelEl = el('#CV_ScoreLabel');
            if (labelEl) { labelEl.textContent = 'LOADING'; labelEl.className = 'risk-meter-label'; }
            
            // Other header KPIs
            ['CV_TotalCustomers', 'CV_Champions', 'CV_ProjectedCLV', 'CV_AtRisk'].forEach(function(id) {
                var el_ = el('#' + id);
                if (el_) el_.innerHTML = Skeleton.render('custom', { width: '50px', height: '1.5rem' });
            });
            
            // Overview tab containers
            var chartContainer = el('#cvDistributionChart');
            if (chartContainer) chartContainer.innerHTML = Skeleton.render('custom', { width: '100%', height: '180px' });
            
            var tierCards = el('#cvTierCards');
            if (tierCards) tierCards.innerHTML = Skeleton.render('custom', { width: '100%', height: '100px' });
            
            var keyMetrics = el('#cvKeyMetrics');
            if (keyMetrics) keyMetrics.innerHTML = Skeleton.render('custom', { width: '100%', height: '100px' });
            
            var segmentBars = el('#cvSegmentBars');
            if (segmentBars) segmentBars.innerHTML = Skeleton.render('custom', { width: '100%', height: '150px' });
            
            var insights = el('#cvInsightsPanel');
            if (insights) insights.innerHTML = Skeleton.render('custom', { width: '100%', height: '150px' });
            
            // Other tabs get table skeletons
            ['cvHealthContent', 'cvSegmentsContent', 'cvCLVContent', 'cvChurnContent', 'cvGrowthContent'].forEach(function(id) {
                var el_ = el('#' + id);
                if (el_) el_.innerHTML = Skeleton.render('table', { rows: 6 });
            });
        },

        async loadInitialData() {
            var self = this;
            try {
                // Load main config for subsidiaries
                var configRes = await API.get('config');
                this.subsidiaries = configRes.subsidiaries || [];
                
                // Load CustomerValue-specific config
                var cvConfigRes = await API.get('customer_value_config');
                this.configData = cvConfigRes.config || {};
                
                this.populateSubsidiaries();
                this.loadData();
            } catch (e) {
                console.error('Error loading initial config:', e);
                this.loadData();
            }
        },

        populateSubsidiaries: function() {
            var self = this;
            var select = el('#cvSubsidiary');
            if (!select) return;
            
            select.innerHTML = '<option value="">All Subsidiaries</option>';
            
            if (this.subsidiaries.length === 0) {
                select.style.display = 'none';
                return;
            }
            
            select.style.display = '';
            this.subsidiaries.forEach(function(s) {
                var opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                if (s.id == self.subsidiaryId) opt.selected = true;
                select.appendChild(opt);
            });
        },

        loadData: function() {
            var self = this;

            var endDate = new Date();
            var startDate = new Date();
            if (this.analysisWindow === 'all') {
                startDate.setFullYear(startDate.getFullYear() - 10);
            } else {
                startDate.setMonth(startDate.getMonth() - parseInt(this.analysisWindow));
            }

            var params = {
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0],
                subsidiary: self.subsidiaryId || '',
                config: JSON.stringify(self.configData || {})
            };

            API.get('customer_value_data', params).then(function(res) {
                self.latestData = res;
                if (res.results && res.results.currencyInfo) {
                    self.currencySymbol = res.results.currencyInfo.symbol || '$';
                }
                self.renderDashboard();
            }).catch(function(e) {
                console.error('Customer Value load error', e);
                self.renderError('Failed to load customer value data: ' + e.message);
            });
        },

        renderError: function(msg) {
            var content = el('#cvOverviewContent');
            if (content) {
                content.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-circle mr-2"></i>' + msg + '</div>';
            }
        },

        renderDashboard: function() {
            if (!this.latestData || !this.latestData.results) {
                this.renderError('No data returned from server');
                return;
            }
            this.renderKPIs();
            this.renderOverview();
            this.renderHealthScores();
            this.renderSegmentation();
            this.renderCLV();
            this.renderChurnRisk();
            this.renderGrowth();
            
            // Re-init tooltips
            jQuery('[data-toggle="tooltip"]').tooltip();
        },

        // ==========================================
        // KPI CARDS (Header Row)
        // ==========================================
        renderKPIs: function() {
            var self = this;
            var summary = this.latestData.results.summary || {};
            var kpis = summary.kpis || {};
            var growth = this.latestData.results.growthTrends || {};
            var monthly = growth.monthly || [];

            // Render intelligence gauge using risk-meter pattern
            var score = summary.intelligenceScore || 0;
            this.renderIntelligenceMeterKPI(score);
            
            this.setKPI('CV_TotalCustomers', this.formatNumber(summary.totalCustomers || 0));
            this.setKPI('CV_Champions', this.formatNumber(kpis.championsCount || 0));
            this.setKPI('CV_ProjectedCLV', this.formatCurrency(kpis.projectedCLV || 0));
            this.setKPI('CV_CLVYears', (this.configData.clvProjectionYears || 3) + '-year');
            this.setKPI('CV_AtRisk', this.formatNumber(kpis.atRiskCount || 0));
            this.setKPI('CV_AtRiskRevenue', this.formatCurrency(kpis.atRiskRevenue || 0));
            
            // Add sparklines to KPI cards if monthly data exists
            if (monthly.length >= 3 && typeof Sparkline !== 'undefined') {
                var revenueData = monthly.slice(-6).map(function(m) { return m.revenue || 0; });
                var customersData = monthly.slice(-6).map(function(m) { return m.newCustomers || 0; });
                
                // Add sparkline to Projected CLV card (shows revenue trend)
                this.addSparklineToKPI('CV_ProjectedCLV', revenueData, '#6f42c1');
                
                // Add sparkline to Total Customers card
                this.addSparklineToKPI('CV_TotalCustomers', customersData, '#17a2b8');
            }
        },
        
        // Render intelligence gauge exactly like Health dashboard's renderHealthMeterKPI
        renderIntelligenceMeterKPI: function(score) {
            var gaugeEl = el('#CV_IntelligenceGauge');
            var valueEl = el('#CV_IntelligenceScore');
            var labelEl = el('#CV_ScoreLabel');
            
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
        
        addSparklineToKPI: function(kpiId, data, color) {
            var kpiEl = el('#' + kpiId);
            if (!kpiEl || !data || data.length < 3) return;
            
            // Find or create sparkline container
            var parent = kpiEl.closest('.kpi-content');
            if (!parent) return;
            
            var existingSparkline = parent.querySelector('.kpi-sparkline');
            if (existingSparkline) existingSparkline.remove();
            
            var sparklineHtml = '<div class="kpi-sparkline mt-1">' + 
                Sparkline.generate(data, { width: 60, height: 14, color: color }) + '</div>';
            
            parent.insertAdjacentHTML('beforeend', sparklineHtml);
        },

        setKPI: function(id, value) {
            var el_ = el('#' + id);
            if (el_) el_.textContent = value;
        },

        // ==========================================
        // OVERVIEW TAB - Uses existing template containers
        // ==========================================
        renderOverview: function() {
            var summary = this.latestData.results.summary || {};
            var kpis = summary.kpis || {};

            // Distribution chart (replaces hero)
            var chartContainer = el('#cvDistributionChart');
            if (chartContainer) {
                chartContainer.innerHTML = this.renderSegmentDonut(summary.segmentBreakdown || {});
            }

            // Tier cards
            var tierContainer = el('#cvTierCards');
            if (tierContainer) {
                tierContainer.innerHTML = this.renderTierCardsCompact(summary.tierBreakdown || {});
            }

            // Key metrics
            var metricsContainer = el('#cvKeyMetrics');
            if (metricsContainer) {
                metricsContainer.innerHTML = this.renderKeyMetricsCompact(kpis);
            }

            // Segment bars
            var segmentContainer = el('#cvSegmentBars');
            if (segmentContainer) {
                segmentContainer.innerHTML = this.renderSegmentBarsCompact(summary.segmentBreakdown || {});
            }

            // Insights
            var insightsContainer = el('#cvInsightsPanel');
            if (insightsContainer) {
                insightsContainer.innerHTML = this.renderInsightsCompact(summary.insights || []);
            }
        },

        renderSegmentDonut: function(segments) {
            var segmentConfig = {
                champions: { color: '#28a745', label: 'Champions' },
                loyal: { color: '#17a2b8', label: 'Loyal' },
                potential: { color: '#6f42c1', label: 'Potential' },
                new: { color: '#20c997', label: 'New' },
                regular: { color: '#007bff', label: 'Regular' },
                hibernating: { color: '#fd7e14', label: 'Hibernating' },
                'at-risk': { color: '#dc3545', label: 'At Risk' },
                lost: { color: '#6c757d', label: 'Lost' }
            };
            
            var total = 0;
            var data = [];
            Object.keys(segmentConfig).forEach(function(key) {
                var seg = segments[key] || { count: 0 };
                total += seg.count || 0;
                data.push({ key: key, count: seg.count || 0, color: segmentConfig[key].color, label: segmentConfig[key].label });
            });
            
            if (total === 0) {
                return '<div class="text-center py-4 text-muted">No segment data</div>';
            }
            
            // Build SVG donut with hover areas
            var size = 140;
            var strokeWidth = 28;
            var radius = (size - strokeWidth) / 2;
            var circumference = 2 * Math.PI * radius;
            var centerX = size / 2;
            var centerY = size / 2;
            
            var html = '<div class="text-center">';
            html += '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="cursor: pointer;">';
            
            var offset = 0;
            data.forEach(function(seg) {
                if (seg.count > 0) {
                    var pct = seg.count / total;
                    var dashLength = pct * circumference;
                    var dashOffset = -offset * circumference;
                    // Each segment is a path with tooltip
                    html += '<circle cx="' + centerX + '" cy="' + centerY + '" r="' + radius + '" fill="none" stroke="' + seg.color + '" stroke-width="' + strokeWidth + '" stroke-dasharray="' + dashLength + ' ' + circumference + '" stroke-dashoffset="' + dashOffset + '" transform="rotate(-90 ' + centerX + ' ' + centerY + ')" style="cursor: pointer; transition: stroke-width 0.2s;" onmouseover="this.style.strokeWidth=\'' + (strokeWidth + 4) + '\'" onmouseout="this.style.strokeWidth=\'' + strokeWidth + '\'">';
                    html += '<title>' + seg.label + ': ' + seg.count + ' (' + (pct * 100).toFixed(1) + '%)</title>';
                    html += '</circle>';
                    offset += pct;
                }
            });
            
            // Center text
            html += '<text x="' + centerX + '" y="' + (centerY - 5) + '" text-anchor="middle" fill="#333" font-size="24" font-weight="bold">' + total + '</text>';
            html += '<text x="' + centerX + '" y="' + (centerY + 12) + '" text-anchor="middle" fill="#6c757d" font-size="10">CUSTOMERS</text>';
            html += '</svg>';
            
            // Compact legend - show full names
            html += '<div class="d-flex flex-wrap justify-content-center mt-2" style="gap: 4px 10px;">';
            data.filter(function(s) { return s.count > 0; }).forEach(function(seg) {
                html += '<span style="font-size: 10px; color: #6c757d;" title="' + seg.label + ': ' + seg.count + '"><span style="display: inline-block; width: 7px; height: 7px; background: ' + seg.color + '; border-radius: 50%; margin-right: 2px;"></span>' + seg.label + '</span>';
            });
            html += '</div>';
            html += '</div>';
            
            return html;
        },

        renderSegmentBarsCompact: function(segments) {
            var segmentConfig = {
                champions: { color: '#28a745', icon: 'fa-crown', label: 'Champions' },
                loyal: { color: '#17a2b8', icon: 'fa-heart', label: 'Loyal' },
                potential: { color: '#6f42c1', icon: 'fa-star', label: 'Potential' },
                new: { color: '#20c997', icon: 'fa-seedling', label: 'New' },
                regular: { color: '#007bff', icon: 'fa-user', label: 'Regular' },
                hibernating: { color: '#fd7e14', icon: 'fa-moon', label: 'Hibernating' },
                'at-risk': { color: '#dc3545', icon: 'fa-exclamation', label: 'At Risk' },
                lost: { color: '#6c757d', icon: 'fa-times', label: 'Lost' }
            };

            // Calculate total for percentage
            var total = 0;
            Object.keys(segmentConfig).forEach(function(key) {
                var seg = segments[key] || {};
                total += seg.count || 0;
            });

            var html = '';
            Object.keys(segmentConfig).forEach(function(key) {
                var seg = segments[key] || { count: 0, percentage: 0 };
                var cfg = segmentConfig[key];
                var count = seg.count || 0;
                // Calculate percentage from count/total, fallback to provided percentage
                var pct = total > 0 ? (count / total * 100) : (seg.percentage || 0);
                
                // Use flexbox bar instead of Bootstrap progress
                html += '<div class="d-flex align-items-center px-3 py-2 border-bottom">';
                html += '<div style="width: 90px; font-size: 12px; flex-shrink: 0;"><i class="fas ' + cfg.icon + ' mr-1" style="color:' + cfg.color + '"></i>' + cfg.label + '</div>';
                html += '<div style="flex: 1; min-width: 0; margin: 0 8px;">';
                html += '<div style="display: flex; align-items: center; height: 18px; background: #e9ecef; border-radius: 4px; overflow: hidden;">';
                html += '<div style="width: ' + pct + '%; min-width: ' + (count > 0 ? '24px' : '0') + '; height: 100%; background: ' + cfg.color + '; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 600; border-radius: 4px;">' + (count > 0 ? count : '') + '</div>';
                html += '</div></div>';
                html += '<div style="width: 40px; text-align: right; font-size: 11px; color: #6c757d; flex-shrink: 0;">' + pct.toFixed(0) + '%</div>';
                html += '</div>';
            });
            return html || '<div class="p-3 text-center text-muted">No segment data</div>';
        },

        renderTierCardsCompact: function(tiers) {
            var tierConfig = [
                { key: 'platinum', label: 'Platinum', color: '#667eea', icon: 'fa-gem' },
                { key: 'gold', label: 'Gold', color: '#f6d365', icon: 'fa-medal' },
                { key: 'silver', label: 'Silver', color: '#a8c0ff', icon: 'fa-award' },
                { key: 'bronze', label: 'Bronze', color: '#c79081', icon: 'fa-certificate' }
            ];

            var html = '<div class="row w-100 m-0">';
            tierConfig.forEach(function(t) {
                var count = tiers[t.key] || 0;
                html += '<div class="col-6 mb-2 text-center px-1">';
                html += '<div class="p-2 rounded h-100" style="background: ' + t.color + '20;">';
                html += '<i class="fas ' + t.icon + '" style="color: ' + t.color + '; font-size: 16px;"></i>';
                html += '<div class="h6 mb-0 mt-1">' + count + '</div>';
                html += '<div style="font-size: 11px;" class="text-muted">' + t.label + '</div>';
                html += '</div></div>';
            });
            html += '</div>';
            return html;
        },

        renderKeyMetricsCompact: function(kpis) {
            var self = this;
            
            // Safely get values with null protection
            var retentionRate = kpis.retentionRate != null ? kpis.retentionRate : 0;
            var paymentRate = kpis.paymentRate != null ? kpis.paymentRate : 0;
            var avgDaysToPay = kpis.avgDaysToPay != null ? kpis.avgDaysToPay : 0;
            var top10Share = kpis.top10Share != null ? kpis.top10Share : 0;
            var monthlyGrowth = kpis.monthlyGrowth != null ? kpis.monthlyGrowth : 0;
            
            var metrics = [
                { label: 'Avg Value', value: this.formatCurrency(kpis.avgCustomerValue || 0), icon: 'fa-user-tag', color: '#6f42c1' },
                { label: 'Retention', value: retentionRate.toFixed(0) + '%', icon: 'fa-sync', color: '#28a745' },
                { label: 'Payment', value: paymentRate.toFixed(0) + '%', icon: 'fa-check-circle', color: '#17a2b8' },
                { label: 'Avg DSO', value: Math.round(avgDaysToPay) + 'd', icon: 'fa-clock', color: '#fd7e14' },
                { label: 'Top 10%', value: top10Share.toFixed(0) + '%', icon: 'fa-crown', color: '#ffc107' },
                { label: 'Growth', value: (monthlyGrowth >= 0 ? '+' : '') + monthlyGrowth.toFixed(1) + '%', icon: 'fa-chart-line', color: monthlyGrowth >= 0 ? '#28a745' : '#dc3545' }
            ];

            var html = '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 8px;">';
            metrics.forEach(function(m) {
                html += '<div style="background: linear-gradient(135deg, ' + m.color + '10 0%, ' + m.color + '05 100%); border: 1px solid ' + m.color + '30; border-radius: 6px; padding: 8px 6px; text-align: center;">';
                html += '<div style="font-size: 9px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">' + m.label + '</div>';
                html += '<div style="font-size: 14px; font-weight: 700; color: ' + m.color + ';">' + m.value + '</div>';
                html += '</div>';
            });
            html += '</div>';
            return html;
        },

        renderInsightsCompact: function(insights) {
            if (!insights || insights.length === 0) {
                return '<div class="p-3 text-center text-muted">No insights available</div>';
            }
            
            var html = '';
            insights.slice(0, 5).forEach(function(insight) {
                var iconClass = insight.type === 'success' ? 'text-success' : 
                               insight.type === 'warning' ? 'text-warning' :
                               insight.type === 'alert' ? 'text-danger' : 'text-info';
                var icon = insight.type === 'success' ? 'fa-check-circle' : 
                          insight.type === 'warning' ? 'fa-exclamation-circle' :
                          insight.type === 'alert' ? 'fa-times-circle' : 'fa-info-circle';
                
                html += '<div class="d-flex align-items-start px-3 py-2 border-bottom">';
                html += '<i class="fas ' + icon + ' ' + iconClass + ' mr-2 mt-1"></i>';
                html += '<div class="small"><strong>' + insight.title + '</strong><br><span class="text-muted">' + insight.message + '</span></div>';
                html += '</div>';
            });
            
            return html;
        },

        // ==========================================
        // HEALTH SCORES TAB
        // ==========================================
        renderHealthScores: function() {
            var results = this.latestData.results;
            var customers = results.customerHealth || [];
            var self = this;
            
            this.healthCustomers = customers;
            
            var html = '<div class="card border-0 shadow-sm">';
            html += '<div class="card-header bg-white py-3">';
            html += '<div class="d-flex justify-content-between align-items-center flex-wrap">';
            html += '<h6 class="mb-0"><i class="fas fa-heartbeat text-danger mr-2"></i>Customer Health Scorecard</h6>';
            html += '<div class="d-flex align-items-center mt-2 mt-md-0">';
            html += '<label class="mr-2 mb-0 small text-muted">Group by:</label>';
            html += '<select class="form-control form-control-sm mr-3" id="cvHealthGroupBy" style="width: 130px;">';
            html += '<option value="none">None</option>';
            html += '<option value="rfmSegment">Segment</option>';
            html += '<option value="clvTier">CLV Tier</option>';
            html += '<option value="churnRisk">Churn Risk</option>';
            html += '<option value="healthGrade">Health Grade</option>';
            html += '</select>';
            html += '<span class="badge badge-primary">' + customers.length + ' Customers</span>';
            html += '</div></div></div>';
            html += '<div class="card-body p-0" id="cvHealthTableContainer">';
            html += this.renderHealthTable(customers);
            html += '</div></div>';

            el('#cvHealthContent').innerHTML = html;
            
            var groupSelect = el('#cvHealthGroupBy');
            if (groupSelect) {
                groupSelect.value = this.healthGroupBy;
                groupSelect.addEventListener('change', function() {
                    self.healthGroupBy = this.value;
                    self.pagination.health.page = 1;
                    el('#cvHealthTableContainer').innerHTML = self.renderHealthTable(self.healthCustomers);
                    self.bindHealthSort();
                });
            }
            this.bindHealthSort();
        },

        renderHealthTable: function(customers) {
            var self = this;
            
            if (this.healthGroupBy !== 'none') {
                return this.renderGroupedHealthTable(customers);
            }
            
            var sorted = this.sortData(customers, this.sortState.health);
            var pag = this.pagination.health;
            var startIdx = (pag.page - 1) * pag.pageSize;
            var pageItems = sorted.slice(startIdx, startIdx + pag.pageSize);
            
            var html = '<div class="cv-table-scroll">';
            html += '<table class="table table-hover mb-0 cv-health-table cv-sortable-table" id="healthTable">';
            html += '<thead><tr>';
            html += this.sortableHeader('Customer', 'customerName', 'health');
            html += this.sortableHeader('Health', 'healthScore', 'health', 'text-center');
            html += this.sortableHeader('Segment', 'rfmSegment', 'health', 'text-center');
            html += this.sortableHeader('CLV Tier', 'clvTier', 'health', 'text-center');
            html += this.sortableHeader('Risk', 'churnRisk', 'health', 'text-center');
            html += this.sortableHeader('Revenue', 'totalRevenue', 'health', 'text-right');
            html += this.sortableHeader('CLV', 'projectedCLV', 'health', 'text-right');
            html += '<th>Action</th>';
            html += '</tr></thead><tbody>';

            pageItems.forEach(function(c) {
                html += self.renderHealthRow(c);
            });

            html += '</tbody></table></div>';
            html += this.renderPagination(customers.length, pag.page, pag.pageSize, 'health');
            return html;
        },

        renderGroupedHealthTable: function(customers) {
            var self = this;
            var groups = {};
            var groupKey = this.healthGroupBy;
            
            customers.forEach(function(c) {
                var key = c[groupKey] || 'Unknown';
                if (!groups[key]) groups[key] = [];
                groups[key].push(c);
            });
            
            // Sort keys using custom order
            var sortedKeys = Object.keys(groups).sort(function(a, b) {
                var orderMap;
                if (groupKey === 'rfmSegment') orderMap = SORT_ORDERS.segment;
                else if (groupKey === 'clvTier') orderMap = SORT_ORDERS.tier;
                else if (groupKey === 'churnRisk') orderMap = SORT_ORDERS.risk;
                else if (groupKey === 'healthGrade') orderMap = SORT_ORDERS.grade;
                else return groups[b].length - groups[a].length; // default: by count
                
                var aOrder = orderMap[(a || '').toLowerCase()] || orderMap[a] || 99;
                var bOrder = orderMap[(b || '').toLowerCase()] || orderMap[b] || 99;
                return aOrder - bOrder;
            });
            
            var html = '';
            sortedKeys.forEach(function(key) {
                var groupCustomers = groups[key];
                var totalRevenue = groupCustomers.reduce(function(sum, c) { return sum + (c.totalRevenue || 0); }, 0);
                var isLargeGroup = groupCustomers.length > 15;
                
                html += '<div class="cv-group-section">';
                html += '<div class="cv-group-header" onclick="jQuery(this).next().slideToggle(); jQuery(this).find(\'.fa-chevron-down, .fa-chevron-right\').toggleClass(\'fa-chevron-down fa-chevron-right\');">';
                html += '<i class="fas fa-chevron-down mr-2"></i>';
                html += '<strong>' + self.formatGroupLabel(key, groupKey) + '</strong>';
                html += '<span class="badge badge-secondary ml-2">' + groupCustomers.length + '</span>';
                html += '<span class="text-muted ml-auto">' + self.formatCurrency(totalRevenue) + '</span>';
                html += '</div>';
                html += '<div class="cv-group-content">';
                // Add scrollable container for large groups
                if (isLargeGroup) {
                    html += '<div style="max-height: 400px; overflow-y: auto;">';
                }
                html += '<table class="table table-hover table-sm mb-0 cv-health-table"><tbody>';
                // Show ALL customers, not just first 10
                groupCustomers.forEach(function(c) {
                    html += self.renderHealthRow(c);
                });
                html += '</tbody></table>';
                if (isLargeGroup) {
                    html += '</div>';
                }
                html += '</div></div>';
            });
            
            return html;
        },

        renderHealthRow: function(c) {
            var html = '<tr>';
            html += '<td><strong>' + (c.customerName || 'Unknown') + '</strong><br><small class="text-muted">Last: ' + (c.daysSinceLast || 0) + ' days ago</small></td>';
            html += '<td class="text-center"><span class="cv-grade cv-grade-' + this.getGradeClass(c.healthGrade) + '">' + (c.healthGrade || 'N/A') + '</span><br><small class="text-muted">' + (c.healthScore || 0) + '</small></td>';
            html += '<td class="text-center">' + this.getSegmentBadge(c.rfmSegment) + '</td>';
            html += '<td class="text-center">' + this.getTierBadge(c.clvTier) + '</td>';
            html += '<td class="text-center">' + this.getRiskBadge(c.churnRisk) + '</td>';
            html += '<td class="text-right">' + this.formatCurrency(c.totalRevenue || 0) + '</td>';
            html += '<td class="text-right">' + this.formatCurrency(c.projectedCLV || 0) + '</td>';
            html += '<td>' + this.getRecommendationBadge(c.recommendation) + '</td>';
            html += '</tr>';
            return html;
        },

        formatGroupLabel: function(value, groupKey) {
            if (groupKey === 'rfmSegment') return (value || '').charAt(0).toUpperCase() + (value || '').slice(1).replace('-', ' ');
            if (groupKey === 'clvTier') return (value || '').charAt(0).toUpperCase() + (value || '').slice(1) + ' Tier';
            if (groupKey === 'churnRisk') return (value || '').charAt(0).toUpperCase() + (value || '').slice(1) + ' Risk';
            return value;
        },

        bindHealthSort: function() {
            var self = this;
            els('#healthTable th.sortable').forEach(function(th) {
                th.onclick = function() {
                    var col = this.dataset.sort;
                    if (self.sortState.health.column === col) {
                        self.sortState.health.direction = self.sortState.health.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        self.sortState.health.column = col;
                        self.sortState.health.direction = 'desc';
                    }
                    self.pagination.health.page = 1;
                    el('#cvHealthTableContainer').innerHTML = self.renderHealthTable(self.healthCustomers);
                    self.bindHealthSort();
                };
            });
        },
        
        bindSegmentSort: function() {
            var self = this;
            els('#segmentTable th.sortable').forEach(function(th) {
                th.onclick = function() {
                    var col = this.dataset.sort;
                    if (self.sortState.segment.column === col) {
                        self.sortState.segment.direction = self.sortState.segment.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        self.sortState.segment.column = col;
                        self.sortState.segment.direction = 'desc';
                    }
                    self.pagination.segment.page = 1;
                    el('#cvSegmentTableContainer').innerHTML = self.renderSegmentCustomersTable(self.segmentCustomers);
                    self.bindSegmentSort();
                };
            });
        },

        // ==========================================
        // SEGMENTATION TAB - Compact RFM Matrix
        // ==========================================
        renderSegmentation: function() {
            var self = this;
            var results = this.latestData.results;
            var rfm = results.rfmSegmentation || {};
            var customers = rfm.customers || [];
            this.segmentCustomers = customers;  // Store for sorting
            var distribution = rfm.distribution || {};
            var html = '';

            // Compact row with matrix and breakdown
            html += '<div class="row mb-4">';
            
            // RFM Matrix - compact inline
            html += '<div class="col-md-4">';
            html += '<div class="card border-0 shadow-sm h-100">';
            html += '<div class="card-header bg-white py-2"><span class="font-weight-bold small"><i class="fas fa-th text-primary mr-2"></i>RFM Matrix</span></div>';
            html += '<div class="card-body p-2 d-flex align-items-stretch">';
            html += this.renderRFMMatrix(distribution);
            html += '</div></div></div>';
            
            // Segment breakdown table
            html += '<div class="col-md-8">';
            html += '<div class="card border-0 shadow-sm h-100">';
            html += '<div class="card-header bg-white py-2"><span class="font-weight-bold small"><i class="fas fa-chart-bar text-primary mr-2"></i>Segment Performance</span></div>';
            html += '<div class="card-body p-0">';
            html += this.renderSegmentBreakdown(distribution);
            html += '</div></div></div>';
            html += '</div>';

            // Customers table
            html += '<div class="card border-0 shadow-sm">';
            html += '<div class="card-header bg-white py-2"><span class="font-weight-bold small"><i class="fas fa-users mr-2"></i>Customers by Segment</span></div>';
            html += '<div class="card-body p-0" id="cvSegmentTableContainer">' + this.renderSegmentCustomersTable(customers) + '</div>';
            html += '</div>';

            el('#cvSegmentsContent').innerHTML = html;
            this.bindSegmentSort();
        },

        renderRFMMatrix: function(distribution) {
            var segments = ['champions', 'loyal', 'potential', 'new', 'regular', 'hibernating', 'at-risk', 'lost'];
            var colors = { champions: '#28a745', loyal: '#17a2b8', potential: '#6f42c1', new: '#20c997', regular: '#007bff', hibernating: '#fd7e14', 'at-risk': '#dc3545', lost: '#6c757d' };
            var icons = { champions: 'fa-crown', loyal: 'fa-heart', potential: 'fa-star', new: 'fa-seedling', regular: 'fa-user', hibernating: 'fa-moon', 'at-risk': 'fa-exclamation', lost: 'fa-times' };
            var labels = { champions: 'Champ', loyal: 'Loyal', potential: 'Potntl', new: 'New', regular: 'Regular', hibernating: 'Hibern', 'at-risk': 'Risk', lost: 'Lost' };
            
            var total = 0;
            segments.forEach(function(s) { total += (distribution[s] || {}).count || 0; });
            
            // Grid fills entire container
            var html = '<div class="cv-rfm-grid w-100">';
            segments.forEach(function(seg) {
                var count = (distribution[seg] || {}).count || 0;
                var pct = total > 0 ? (count / total * 100) : 0;
                
                html += '<div class="cv-rfm-cell" style="background: ' + colors[seg] + ';" title="' + seg.replace('-', ' ') + ': ' + count + ' (' + pct.toFixed(1) + '%)">';
                html += '<i class="fas ' + icons[seg] + '" style="font-size: 12px;"></i>';
                html += '<span style="font-size: 14px; font-weight: 700;">' + count + '</span>';
                html += '<span style="font-size: 8px; opacity: 0.85;">' + labels[seg] + '</span>';
                html += '</div>';
            });
            // Total cell
            html += '<div class="cv-rfm-cell" style="background: #f8f9fa; color: #495057;">';
            html += '<span style="font-size: 14px; font-weight: 700;">' + total + '</span>';
            html += '<span style="font-size: 8px;">Total</span>';
            html += '</div>';
            html += '</div>';
            
            return html;
        },

        renderSegmentBreakdown: function(distribution) {
            var self = this;
            var segments = ['champions', 'loyal', 'potential', 'new', 'regular', 'hibernating', 'at-risk', 'lost'];
            var colors = { champions: '#28a745', loyal: '#17a2b8', potential: '#6f42c1', new: '#20c997', regular: '#007bff', hibernating: '#fd7e14', 'at-risk': '#dc3545', lost: '#6c757d' };
            
            var html = '<table class="table table-sm mb-0">';
            html += '<thead><tr><th>Segment</th><th class="text-right">Count</th><th class="text-right">Revenue</th><th class="text-right">Avg Value</th><th class="text-right">%</th></tr></thead><tbody>';
            
            segments.forEach(function(seg) {
                var d = distribution[seg] || { count: 0, totalRevenue: 0, percentage: 0 };
                var avgValue = d.count > 0 ? d.totalRevenue / d.count : 0;
                html += '<tr>';
                html += '<td><span class="cv-segment-dot" style="background: ' + colors[seg] + '"></span>' + seg.charAt(0).toUpperCase() + seg.slice(1).replace('-', ' ') + '</td>';
                html += '<td class="text-right">' + (d.count || 0) + '</td>';
                html += '<td class="text-right">' + self.formatCurrency(d.totalRevenue || 0) + '</td>';
                html += '<td class="text-right">' + self.formatCurrency(avgValue) + '</td>';
                html += '<td class="text-right">' + (d.percentage || 0).toFixed(1) + '%</td>';
                html += '</tr>';
            });
            
            html += '</tbody></table>';
            return html;
        },

        renderSegmentCustomersTable: function(customers) {
            var self = this;
            
            // Sort customers
            var sorted = this.sortData(customers, this.sortState.segment);
            
            var pag = this.pagination.segment;
            var startIdx = (pag.page - 1) * pag.pageSize;
            var pageItems = sorted.slice(startIdx, startIdx + pag.pageSize);
            
            var html = '<div class="cv-table-scroll"><table class="table table-hover table-sm mb-0 cv-sortable-table" id="segmentTable">';
            html += '<thead><tr>';
            html += this.sortableHeader('Customer', 'customerName', 'segment');
            html += this.sortableHeader('Segment', 'segment', 'segment', 'text-center');
            html += this.sortableHeader('R', 'recencyScore', 'segment', 'text-center');
            html += this.sortableHeader('F', 'frequencyScore', 'segment', 'text-center');
            html += this.sortableHeader('M', 'monetaryScore', 'segment', 'text-center');
            html += this.sortableHeader('Revenue', 'totalRevenue', 'segment', 'text-right');
            html += '<th class="text-center">Trend</th>';
            html += '</tr></thead><tbody>';
            
            pageItems.forEach(function(c) {
                // Generate sparkline data from monthly revenue or use existing trend
                var trendData = self.getSparklineData(c);
                
                html += '<tr>';
                html += '<td>' + (c.customerName || 'Unknown') + '</td>';
                html += '<td class="text-center">' + self.getSegmentBadge(c.segment) + '</td>';
                html += '<td class="text-center"><span class="badge badge-light">' + (c.recencyScore || 0) + '</span></td>';
                html += '<td class="text-center"><span class="badge badge-light">' + (c.frequencyScore || 0) + '</span></td>';
                html += '<td class="text-center"><span class="badge badge-light">' + (c.monetaryScore || 0) + '</span></td>';
                html += '<td class="text-right">' + self.formatCurrency(c.totalRevenue || 0) + '</td>';
                html += '<td class="text-center">' + (trendData.length > 1 ? Sparkline.generate(trendData, { width: 50, height: 16 }) : '<span class="text-muted small">No data</span>') + '</td>';
                html += '</tr>';
            });
            
            html += '</tbody></table></div>';
            html += this.renderPagination(customers.length, pag.page, pag.pageSize, 'segment');
            return html;
        },

        getSparklineData: function(customer) {
            // Try to use existing trend data
            if (customer.revenueTrend && Array.isArray(customer.revenueTrend)) {
                var hasData = customer.revenueTrend.some(function(v) { return v > 0; });
                if (hasData) return customer.revenueTrend;
            }
            
            // Try monthlyRevenue
            if (customer.monthlyRevenue && Array.isArray(customer.monthlyRevenue)) {
                var monthlyHasData = customer.monthlyRevenue.some(function(v) { return v > 0; });
                if (monthlyHasData) return customer.monthlyRevenue.slice(-6);
            }
            
            return [];
        },

        // ==========================================
        // CLV TAB
        // ==========================================
        renderCLV: function() {
            var results = this.latestData.results;
            var clv = results.lifetimeValue || {};
            var summary = clv.summary || {};
            var customers = clv.customers || [];
            var profit = results.profitability || {};
            var profitSummary = profit.summary || {};
            var profitCustomers = profit.customers || [];
            var self = this;
            var html = '';

            // Get current analysis window label
            var windowLabel = this.getAnalysisWindowLabel();

            // KPI Cards - Now includes profitability
            html += '<div class="row mb-3 cf-kpi-row" style="flex-wrap: nowrap; overflow-x: auto;">';
            
            // Build profitability sub-label with method indicator
            var profitMethod = profitSummary.method || 'gl_rollup';
            var profitSubLabel = (profitSummary.avgMarginPct || 0) + '% avg margin';
            if (profitMethod === 'disabled') {
                profitSubLabel = 'Disabled in config';
            } else if (profitSummary.status === 'error') {
                profitSubLabel = 'Unavailable';
            }
            
            var cards = [
                { label: 'Total Projected CLV', value: this.formatCurrency(summary.totalProjectedCLV || 0), sub: (summary.projectionYears || 3) + '-year projection', icon: 'fa-gem', color: 'purple' },
                { label: 'Period Revenue', value: this.formatCurrency(summary.totalHistoricalCLV || 0), sub: windowLabel, icon: 'fa-chart-line', color: 'blue' },
                { label: 'Gross Profit', value: this.formatCurrency(profitSummary.totalGrossProfit || 0), sub: profitSubLabel, icon: 'fa-hand-holding-usd', color: 'green' },
                { label: 'Profit Leaks', value: profitSummary.fakeChampions || 0, sub: 'High rev, low margin', icon: 'fa-exclamation-triangle', color: profitSummary.fakeChampions > 0 ? 'red' : 'gray' }
            ];
            
            cards.forEach(function(card) {
                html += '<div class="col-md-3 col-6 mb-2" style="flex-shrink: 1; min-width: 140px;">';
                html += '<div class="cf-kpi-card">';
                html += '<div class="icon-wrapper bg-' + card.color + '-soft"><i class="fas ' + card.icon + ' text-' + card.color + '"></i></div>';
                html += '<div class="kpi-content">';
                html += '<span class="kpi-label">' + card.label + '</span>';
                html += '<span class="kpi-value">' + card.value + '</span>';
                html += '<span class="kpi-sub">' + card.sub + '</span>';
                html += '</div></div></div>';
            });
            html += '</div>';

            // Build profit lookup by customerId (use string keys for consistent matching)
            var profitLookup = {};
            profitCustomers.forEach(function(p) {
                profitLookup[String(p.customerId)] = p;
            });
            
            // Merge margin data into CLV customers for sorting
            customers.forEach(function(c) {
                var profitData = profitLookup[String(c.customerId)];
                if (profitData) {
                    c.marginPct = profitData.marginPct;
                    c.grossProfit = profitData.grossProfit;
                    c.profitTier = profitData.profitTier;
                    c.isFakeChampion = profitData.isFakeChampion;
                } else {
                    c.marginPct = null;
                }
            });
            
            // Info about profitability method
            if (profitSummary.status === 'error') {
                html += '<div class="alert alert-warning small mb-3"><i class="fas fa-exclamation-triangle mr-2"></i>';
                html += profitSummary.message || 'Profitability data is unavailable for the selected configuration.';
                html += '</div>';
            } else if (profitMethod === 'disabled') {
                html += '<div class="alert alert-secondary small mb-3"><i class="fas fa-info-circle mr-2"></i>';
                html += 'Profitability analysis disabled. Enable in Settings tab to see gross margin data.';
                html += '</div>';
            }

            // Tier breakdown
            html += '<div class="row mb-3">';
            html += '<div class="col-md-6">';
            html += '<div class="card border-0 shadow-sm h-100">';
            html += '<div class="card-header bg-white py-2"><span class="font-weight-bold small"><i class="fas fa-layer-group text-purple mr-2"></i>CLV Tier Distribution</span></div>';
            html += '<div class="card-body py-2">';
            html += this.renderTierBreakdown(summary.tierBreakdown || {}, summary.tierThresholds || {});
            html += '</div></div></div>';
            
            // Profit Tier breakdown
            html += '<div class="col-md-6">';
            html += '<div class="card border-0 shadow-sm h-100">';
            html += '<div class="card-header bg-white py-2"><span class="font-weight-bold small"><i class="fas fa-percentage text-green mr-2"></i>Profit Margin Distribution</span></div>';
            html += '<div class="card-body py-2">';
            html += this.renderProfitTierBreakdown(profitSummary.tierBreakdown || {});
            html += '</div></div></div>';
            html += '</div>';

            // Formula explanation
            var projectionYears = this.configData.clvProjectionYears || summary.projectionYears || 3;
            html += '<div class="alert alert-light border mb-3 py-2">';
            html += '<div class="d-flex align-items-start">';
            html += '<i class="fas fa-info-circle text-primary mr-2 mt-1"></i>';
            html += '<div class="small">';
            html += '<strong>Projected CLV</strong> = Annual Value × ' + projectionYears + ' years × Retention Probability<br>';
            html += '<span class="text-muted">Tiers: Platinum (top 10%), Gold (next 20%), Silver (next 30%), Bronze (bottom 40%). Retention declines from 95% (active ≤14 days) to 20% (inactive 6+ months).</span>';
            html += '</div></div></div>';

            // CLV Table
            html += '<div class="card border-0 shadow-sm">';
            html += '<div class="card-header bg-white py-2"><span class="font-weight-bold small"><i class="fas fa-trophy text-warning mr-2"></i>Top Customers by Lifetime Value</span></div>';
            html += '<div class="card-body p-0" id="cvCLVTableContainer">' + this.renderCLVTable(customers) + '</div>';
            html += '</div>';

            el('#cvCLVContent').innerHTML = html;
            this.bindCLVSort();
        },

        renderTierBreakdown: function(tiers, thresholds) {
            var total = (tiers.platinum || 0) + (tiers.gold || 0) + (tiers.silver || 0) + (tiers.bronze || 0);
            if (total === 0) return '<div class="text-muted small">No tier data</div>';
            
            var self = this;
            var html = '<div class="small">';
            
            var tierData = [
                { name: 'Platinum', count: tiers.platinum || 0, color: '#6f42c1', threshold: thresholds.platinum },
                { name: 'Gold', count: tiers.gold || 0, color: '#ffc107', threshold: thresholds.gold },
                { name: 'Silver', count: tiers.silver || 0, color: '#6c757d', threshold: thresholds.silver },
                { name: 'Bronze', count: tiers.bronze || 0, color: '#cd7f32', threshold: 0 }
            ];
            
            tierData.forEach(function(t) {
                var pct = total > 0 ? (t.count / total * 100) : 0;
                html += '<div class="d-flex align-items-center mb-1">';
                html += '<span style="width: 70px;"><span class="badge" style="background: ' + t.color + '; color: white;">' + t.name + '</span></span>';
                html += '<div class="flex-grow-1 mx-2" style="height: 16px; background: #f0f0f0; border-radius: 3px;">';
                html += '<div style="width: ' + pct + '%; height: 100%; background: ' + t.color + '; border-radius: 3px;"></div>';
                html += '</div>';
                html += '<span style="width: 60px;" class="text-right">' + t.count + ' <span class="text-muted">(' + Math.round(pct) + '%)</span></span>';
                html += '</div>';
            });
            
            html += '</div>';
            return html;
        },

        renderProfitTierBreakdown: function(tiers) {
            var total = (tiers.high || 0) + (tiers.medium || 0) + (tiers.low || 0) + (tiers.marginal || 0) + (tiers.loss || 0);
            if (total === 0) return '<div class="text-muted small">No profitability data</div>';
            
            var html = '<div class="small">';
            
            var tierData = [
                { name: 'High (40%+)', count: tiers.high || 0, color: '#28a745' },
                { name: 'Medium (25-40%)', count: tiers.medium || 0, color: '#17a2b8' },
                { name: 'Low (10-25%)', count: tiers.low || 0, color: '#ffc107' },
                { name: 'Marginal (0-10%)', count: tiers.marginal || 0, color: '#fd7e14' },
                { name: 'Loss (<0%)', count: tiers.loss || 0, color: '#dc3545' }
            ];
            
            tierData.forEach(function(t) {
                var pct = total > 0 ? (t.count / total * 100) : 0;
                html += '<div class="d-flex align-items-center mb-1">';
                html += '<span style="width: 110px;"><span class="badge" style="background: ' + t.color + '; color: white;">' + t.name + '</span></span>';
                html += '<div class="flex-grow-1 mx-2" style="height: 14px; background: #f0f0f0; border-radius: 3px;">';
                html += '<div style="width: ' + pct + '%; height: 100%; background: ' + t.color + '; border-radius: 3px;"></div>';
                html += '</div>';
                html += '<span style="width: 50px;" class="text-right">' + t.count + '</span>';
                html += '</div>';
            });
            
            html += '</div>';
            return html;
        },

        renderCLVTable: function(customers) {
            var self = this;
            var sorted = this.sortData(customers, this.sortState.clv);
            var pag = this.pagination.clv;
            var startIdx = (pag.page - 1) * pag.pageSize;
            var pageItems = sorted.slice(startIdx, startIdx + pag.pageSize);
            
            var html = '<div class="cv-table-scroll"><table class="table table-hover table-sm mb-0 cv-sortable-table" id="clvTable">';
            html += '<thead><tr>';
            html += '<th style="width: 40px;">#</th>';
            html += this.sortableHeader('Customer', 'customerName', 'clv');
            html += this.sortableHeader('Tier', 'tier', 'clv', 'text-center');
            html += this.sortableHeader('Revenue', 'historicalCLV', 'clv', 'text-right');
            html += this.sortableHeader('Margin', 'marginPct', 'clv', 'text-center');
            html += this.sortableHeader('Projected CLV', 'projectedCLV', 'clv', 'text-right');
            html += '<th class="text-center">Retention</th>';
            html += '<th>Trend</th>';
            html += '</tr></thead><tbody>';

            pageItems.forEach(function(c, i) {
                var retentionColor = (c.retentionFactor || 0) >= 70 ? 'success' : (c.retentionFactor || 0) >= 50 ? 'warning' : 'danger';
                var trendData = self.getSparklineData(c);
                
                // Get margin from merged data
                var marginPct = c.marginPct;
                var marginDisplay = '--';
                var marginColor = 'secondary';
                
                if (marginPct !== undefined && marginPct !== null) {
                    marginDisplay = marginPct.toFixed(1) + '%';
                    if (marginPct >= 40) marginColor = 'success';
                    else if (marginPct >= 25) marginColor = 'info';
                    else if (marginPct >= 10) marginColor = 'warning';
                    else if (marginPct >= 0) marginColor = 'secondary';
                    else marginColor = 'danger';
                }
                
                html += '<tr>';
                html += '<td class="text-muted">' + (startIdx + i + 1) + '</td>';
                html += '<td><strong>' + (c.customerName || 'Unknown') + '</strong></td>';
                html += '<td class="text-center">' + self.getTierBadge(c.tier) + '</td>';
                html += '<td class="text-right">' + self.formatCurrency(c.historicalCLV || 0) + '</td>';
                html += '<td class="text-center"><span class="badge badge-' + marginColor + '">' + marginDisplay + '</span></td>';
                html += '<td class="text-right font-weight-bold text-primary">' + self.formatCurrency(c.projectedCLV || 0) + '</td>';
                html += '<td class="text-center"><span class="badge badge-' + retentionColor + '">' + (c.retentionFactor || 0) + '%</span></td>';
                html += '<td class="text-center">' + (trendData.length > 1 ? Sparkline.generate(trendData, { width: 50, height: 16 }) : '<span class="text-muted small">No data</span>') + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table></div>';
            html += this.renderPagination(customers.length, pag.page, pag.pageSize, 'clv');
            return html;
        },

        bindCLVSort: function() {
            var self = this;
            els('#clvTable th.sortable').forEach(function(th) {
                th.onclick = function() {
                    var col = this.dataset.sort;
                    if (self.sortState.clv.column === col) {
                        self.sortState.clv.direction = self.sortState.clv.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        self.sortState.clv.column = col;
                        self.sortState.clv.direction = 'desc';
                    }
                    self.pagination.clv.page = 1;
                    var clv = self.latestData.results.lifetimeValue || {};
                    el('#cvCLVTableContainer').innerHTML = self.renderCLVTable(clv.customers || []);
                    self.bindCLVSort();
                };
            });
        },

        // ==========================================
        // CHURN RISK TAB - With Friction & Velocity
        // ==========================================
        renderChurnRisk: function() {
            var results = this.latestData.results;
            var churn = results.churnRisk || {};
            var summary = churn.summary || {};
            var allCustomers = churn.customers || [];
            var friction = results.frictionAnalysis || {};
            var frictionSummary = friction.summary || {};
            var frictionCustomers = friction.customers || [];
            var velocity = results.purchaseVelocity || {};
            var velocitySummary = velocity.summary || {};
            var velocityCustomers = velocity.customers || [];
            
            // Filter to only critical, high, medium risk (exclude low)
            var atRiskCustomers = allCustomers.filter(function(c) {
                var risk = (c.riskLevel || c.churnRisk || '').toLowerCase();
                return risk === 'critical' || risk === 'high' || risk === 'medium';
            });
            
            this.churnCustomers = atRiskCustomers;
            
            var self = this;
            var html = '';

            // KPI Cards - Updated with friction data
            html += '<div class="row mb-3 cf-kpi-row" style="flex-wrap: nowrap; overflow-x: auto;">';
            var riskCards = [
                { label: 'Recency Risk', value: (summary.criticalRisk || 0) + (summary.highRisk || 0), sub: 'Critical + High', color: 'red', icon: 'fa-user-clock' },
                { label: 'High Friction', value: (frictionSummary.criticalFriction || 0) + (frictionSummary.highFriction || 0), sub: 'Returns/Credits', color: 'orange', icon: 'fa-exclamation-triangle' },
                { label: 'Overdue Orders', value: velocitySummary.overdueCustomers || 0, sub: velocitySummary.criticalOverdue + ' critical', color: 'yellow', icon: 'fa-clock' },
                { label: 'At Risk Revenue', value: this.formatCurrency(summary.atRiskRevenue || 0), sub: 'Potential loss', color: 'purple', icon: 'fa-dollar-sign' }
            ];
            
            riskCards.forEach(function(card) {
                html += '<div class="col-md-3 col-6 mb-2" style="flex-shrink: 1; min-width: 140px;">';
                html += '<div class="cf-kpi-card">';
                html += '<div class="icon-wrapper bg-' + card.color + '-soft"><i class="fas ' + card.icon + ' text-' + card.color + '"></i></div>';
                html += '<div class="kpi-content">';
                html += '<span class="kpi-label">' + card.label + '</span>';
                html += '<span class="kpi-value">' + card.value + '</span>';
                if (card.sub) html += '<span class="kpi-sub">' + card.sub + '</span>';
                html += '</div></div></div>';
            });
            html += '</div>';

            // Risk Signal Cards
            html += '<div class="row mb-3">';
            
            // Friction Signals (Left)
            html += '<div class="col-md-6">';
            html += '<div class="card border-0 shadow-sm h-100">';
            html += '<div class="card-header bg-white py-2">';
            html += '<span class="font-weight-bold small"><i class="fas fa-frown text-warning mr-2"></i>Friction Signals (Silent Churn)</span>';
            html += '</div>';
            html += '<div class="card-body p-0">';
            if (frictionCustomers.length > 0) {
                html += '<table class="table table-sm mb-0" style="font-size: 11px;">';
                html += '<thead><tr><th>Customer</th><th class="text-center">Returns</th><th class="text-center">Credits</th><th class="text-center">Friction</th></tr></thead><tbody>';
                frictionCustomers.slice(0, 8).forEach(function(c) {
                    var levelClass = c.frictionLevel === 'critical' ? 'danger' : c.frictionLevel === 'high' ? 'warning' : 'info';
                    html += '<tr>';
                    html += '<td>' + (c.customerName || 'Unknown').substring(0, 25) + '</td>';
                    html += '<td class="text-center">' + (c.returnCount || 0) + '</td>';
                    html += '<td class="text-center">' + (c.creditCount || 0) + '</td>';
                    html += '<td class="text-center"><span class="badge badge-' + levelClass + '">' + c.frictionLevel + '</span></td>';
                    html += '</tr>';
                });
                html += '</tbody></table>';
            } else {
                html += '<div class="text-center text-muted py-4"><i class="fas fa-check-circle text-success fa-2x mb-2 d-block"></i>No friction signals detected</div>';
            }
            html += '</div></div></div>';
            
            // Overdue Orders (Right)
            html += '<div class="col-md-6">';
            html += '<div class="card border-0 shadow-sm h-100">';
            html += '<div class="card-header bg-white py-2">';
            html += '<span class="font-weight-bold small"><i class="fas fa-hourglass-half text-info mr-2"></i>Overdue Orders (Expected Buyers)</span>';
            html += '</div>';
            html += '<div class="card-body p-0">';
            var overdueCustomers = velocityCustomers.filter(function(c) { return c.isOverdue; });
            if (overdueCustomers.length > 0) {
                html += '<table class="table table-sm mb-0" style="font-size: 11px;">';
                html += '<thead><tr><th>Customer</th><th class="text-center">Cycle</th><th class="text-center">Overdue</th><th class="text-center">Urgency</th></tr></thead><tbody>';
                overdueCustomers.slice(0, 8).forEach(function(c) {
                    var urgencyClass = c.urgency === 'critical' ? 'danger' : c.urgency === 'high' ? 'warning' : 'info';
                    html += '<tr>';
                    html += '<td>' + (c.customerName || 'Unknown').substring(0, 25) + '</td>';
                    html += '<td class="text-center">' + c.avgDaysBetweenOrders + 'd</td>';
                    html += '<td class="text-center text-danger">+' + c.daysOverdue + 'd</td>';
                    html += '<td class="text-center"><span class="badge badge-' + urgencyClass + '">' + c.urgency + '</span></td>';
                    html += '</tr>';
                });
                html += '</tbody></table>';
            } else {
                html += '<div class="text-center text-muted py-4"><i class="fas fa-check-circle text-success fa-2x mb-2 d-block"></i>All customers on schedule</div>';
            }
            html += '</div></div></div>';
            html += '</div>';

            // Formula explanation
            html += '<div class="alert alert-light border mb-3 py-2">';
            html += '<div class="small">';
            html += '<strong><i class="fas fa-brain text-primary mr-2"></i>World-Class Risk Detection:</strong> ';
            html += 'Recency risk (days inactive) + <strong>Friction signals</strong> (returns, credits - leading churn indicators) + <strong>Velocity</strong> (overdue vs expected order cycle)';
            html += '</div></div>';

            // Table - only at-risk customers
            html += '<div class="card border-0 shadow-sm">';
            html += '<div class="card-header bg-white py-2 d-flex justify-content-between align-items-center">';
            html += '<span class="font-weight-bold small"><i class="fas fa-user-slash text-danger mr-2"></i>At-Risk Customers (Recency Based)</span>';
            html += '<span class="badge badge-danger">' + atRiskCustomers.length + ' need attention</span>';
            html += '</div>';
            html += '<div class="card-body p-0" id="cvChurnTableContainer">' + this.renderChurnTable(atRiskCustomers) + '</div>';
            html += '</div>';

            el('#cvChurnContent').innerHTML = html;
            this.bindChurnSort();
        },

        renderChurnTable: function(customers) {
            var self = this;
            var sorted = this.sortData(customers, this.sortState.churn);
            var pag = this.pagination.churn;
            var startIdx = (pag.page - 1) * pag.pageSize;
            var pageItems = sorted.slice(startIdx, startIdx + pag.pageSize);
            
            var html = '<div class="cv-table-scroll"><table class="table table-hover table-sm mb-0 cv-sortable-table" id="churnTable">';
            html += '<thead><tr>';
            html += this.sortableHeader('Customer', 'customerName', 'churn');
            html += this.sortableHeader('Risk', 'riskLevel', 'churn', 'text-center');
            html += this.sortableHeader('Days Inactive', 'daysSinceLast', 'churn', 'text-right');
            html += this.sortableHeader('Last Revenue', 'lastRevenue', 'churn', 'text-right');
            html += this.sortableHeader('Total Revenue', 'totalRevenue', 'churn', 'text-right');
            html += this.sortableHeader('Score', 'churnScore', 'churn', 'text-center');
            html += '</tr></thead><tbody>';

            if (pageItems.length === 0) {
                html += '<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-check-circle text-success mr-2"></i>No at-risk customers found!</td></tr>';
            } else {
                pageItems.forEach(function(c) {
                    html += '<tr>';
                    html += '<td><strong>' + (c.customerName || 'Unknown') + '</strong></td>';
                    html += '<td class="text-center">' + self.getRiskBadge(c.riskLevel || c.churnRisk) + '</td>';
                    html += '<td class="text-right">' + (c.daysSinceLast || 0) + ' days</td>';
                    html += '<td class="text-right">' + self.formatCurrency(c.lastRevenue || 0) + '</td>';
                    html += '<td class="text-right">' + self.formatCurrency(c.totalRevenue || 0) + '</td>';
                    html += '<td class="text-center"><span class="badge badge-' + ((c.churnScore || 0) >= 70 ? 'danger' : (c.churnScore || 0) >= 50 ? 'warning' : 'info') + '">' + (c.churnScore || 0) + '</span></td>';
                    html += '</tr>';
                });
            }

            html += '</tbody></table></div>';
            if (customers.length > 0) {
                html += this.renderPagination(customers.length, pag.page, pag.pageSize, 'churn');
            }
            return html;
        },

        bindChurnSort: function() {
            var self = this;
            els('#churnTable th.sortable').forEach(function(th) {
                th.onclick = function() {
                    var col = this.dataset.sort;
                    if (self.sortState.churn.column === col) {
                        self.sortState.churn.direction = self.sortState.churn.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        self.sortState.churn.column = col;
                        self.sortState.churn.direction = 'desc';
                    }
                    self.pagination.churn.page = 1;
                    el('#cvChurnTableContainer').innerHTML = self.renderChurnTable(self.churnCustomers);
                    self.bindChurnSort();
                };
            });
        },

        // ==========================================
        // GROWTH TAB
        // ==========================================
        renderGrowth: function() {
            var results = this.latestData.results;
            var growth = results.growthTrends || {};
            var monthly = growth.monthly || [];
            var summary = growth.summary || {};
            var cohorts = results.cohortAnalysis || {};
            var velocity = results.purchaseVelocity || {};
            var self = this;
            var html = '';

            // KPI Cards - Now with YoY if available
            html += '<div class="row mb-3 cf-kpi-row" style="flex-wrap: nowrap; overflow-x: auto;">';
            var growthCards = [
                { 
                    label: summary.yoyGrowth !== null ? 'YoY Growth' : 'Avg Monthly', 
                    value: summary.yoyGrowth !== null ? this.formatGrowthRate(summary.yoyGrowth) : this.formatGrowthRate(summary.avgMonthlyGrowth), 
                    sub: summary.yoyGrowth !== null ? 'vs same period last year' : 'Month over month',
                    color: (summary.yoyGrowth || summary.avgMonthlyGrowth || 0) >= 0 ? 'green' : 'red', 
                    icon: 'fa-chart-line' 
                },
                { label: 'Median Monthly', value: this.formatCurrency(summary.medianMonthlyRevenue || 0), sub: 'Typical month', color: 'blue', icon: 'fa-chart-bar' },
                { label: 'New Customers', value: summary.totalNewCustomers || 0, sub: 'In period', color: 'purple', icon: 'fa-user-plus' },
                { label: 'Retention Rate', value: (cohorts.summary?.overallRetention || 0) + '%', sub: 'Still active', color: 'yellow', icon: 'fa-users' }
            ];
            
            growthCards.forEach(function(card) {
                html += '<div class="col-md-3 col-6 mb-2" style="flex-shrink: 1; min-width: 140px;">';
                html += '<div class="cf-kpi-card">';
                html += '<div class="icon-wrapper bg-' + card.color + '-soft"><i class="fas ' + card.icon + ' text-' + card.color + '"></i></div>';
                html += '<div class="kpi-content">';
                html += '<span class="kpi-label">' + card.label + '</span>';
                html += '<span class="kpi-value">' + card.value + '</span>';
                if (card.sub) html += '<span class="kpi-sub">' + card.sub + '</span>';
                html += '</div></div></div>';
            });
            html += '</div>';

            // Row with Chart and Cohort
            html += '<div class="row mb-3">';
            
            // Chart
            html += '<div class="col-md-8">';
            html += '<div class="card border-0 shadow-sm h-100">';
            html += '<div class="card-header bg-white py-2"><span class="font-weight-bold small"><i class="fas fa-chart-area text-primary mr-2"></i>Monthly Revenue Trend</span></div>';
            html += '<div class="card-body py-3">' + this.renderGrowthChart(monthly) + '</div>';
            html += '</div></div>';
            
            // Cohort Retention
            html += '<div class="col-md-4">';
            html += '<div class="card border-0 shadow-sm h-100">';
            html += '<div class="card-header bg-white py-2"><span class="font-weight-bold small"><i class="fas fa-users text-info mr-2"></i>Cohort Retention</span></div>';
            html += '<div class="card-body p-0">' + this.renderCohortTable(cohorts.cohorts || []) + '</div>';
            html += '</div></div>';
            html += '</div>';

            // Overdue Orders Alert
            if (velocity.summary && velocity.summary.overdueCustomers > 0) {
                html += '<div class="alert alert-warning py-2 mb-3">';
                html += '<i class="fas fa-clock mr-2"></i><strong>' + velocity.summary.overdueCustomers + ' customers</strong> are overdue for their next order';
                html += ' (' + velocity.summary.criticalOverdue + ' critical). Average order cycle: ' + velocity.summary.avgOrderCycle + ' days.';
                html += '</div>';
            }

            // Monthly Details Table
            html += '<div class="card border-0 shadow-sm">';
            html += '<div class="card-header bg-white py-2"><span class="font-weight-bold small"><i class="fas fa-table mr-2"></i>Monthly Details</span></div>';
            html += '<div class="card-body p-0"><div class="cv-table-scroll" style="max-height: 300px;"><table class="table table-hover table-sm mb-0">';
            html += '<thead class="sticky-top bg-white"><tr><th>Month</th><th class="text-right">Revenue</th><th class="text-right">Customers</th><th class="text-right">New</th><th class="text-right">Transactions</th><th class="text-right">MoM Growth</th></tr></thead><tbody>';
            
            // Show most recent first
            var sortedMonthly = monthly.slice().reverse();
            sortedMonthly.forEach(function(m) {
                var growthClass = m.growthRate > 0 ? 'text-success' : m.growthRate < 0 ? 'text-danger' : '';
                var rowClass = m.isMatureMonth === false ? 'text-muted' : '';
                html += '<tr class="' + rowClass + '">';
                html += '<td>' + (m.monthLabel || m.month);
                if (m.isMatureMonth === false) html += ' <small class="badge badge-light">ramp-up</small>';
                html += '</td>';
                html += '<td class="text-right">' + self.formatCurrency(m.revenue || 0) + '</td>';
                html += '<td class="text-right">' + (m.uniqueCustomers || 0) + '</td>';
                html += '<td class="text-right">' + (m.newCustomers || 0) + '</td>';
                html += '<td class="text-right">' + (m.transactionCount || 0) + '</td>';
                html += '<td class="text-right ' + growthClass + '">' + self.formatGrowthRate(m.growthRate) + '</td>';
                html += '</tr>';
            });
            
            html += '</tbody></table></div></div></div>';

            el('#cvGrowthContent').innerHTML = html;
        },

        formatGrowthRate: function(rate) {
            if (rate === undefined || rate === null) return '—';
            // Cap extreme growth rates for display
            if (rate > 500) return '>500%';
            if (rate < -90) return '<-90%';
            return (rate >= 0 ? '+' : '') + rate.toFixed(1) + '%';
        },

        renderCohortTable: function(cohorts) {
            if (!cohorts || cohorts.length === 0) {
                return '<div class="text-center text-muted py-4 small">No cohort data</div>';
            }
            
            var self = this;
            var html = '<table class="table table-sm mb-0" style="font-size: 11px;">';
            html += '<thead><tr><th>Year</th><th class="text-right">Customers</th><th class="text-right">Retention</th><th class="text-right">LTV</th></tr></thead><tbody>';
            
            cohorts.forEach(function(c) {
                var retentionClass = c.retentionRate >= 70 ? 'text-success' : c.retentionRate >= 40 ? 'text-warning' : 'text-danger';
                html += '<tr>';
                html += '<td>' + c.year + '</td>';
                html += '<td class="text-right">' + c.totalCustomers + '</td>';
                html += '<td class="text-right ' + retentionClass + '"><strong>' + c.retentionRate + '%</strong></td>';
                html += '<td class="text-right">' + self.formatCurrency(c.avgRevenue) + '</td>';
                html += '</tr>';
            });
            
            html += '</tbody></table>';
            return html;
        },

        renderGrowthChart: function(monthly) {
            if (!monthly || monthly.length === 0) return '<div class="text-center text-muted py-4">No data available</div>';
            
            var maxRevenue = Math.max.apply(null, monthly.map(function(m) { return m.revenue || 0; }));
            var self = this;
            
            var html = '<div class="d-flex align-items-end justify-content-between" style="height: 150px;">';
            monthly.forEach(function(m) {
                var height = maxRevenue > 0 ? ((m.revenue || 0) / maxRevenue * 130) : 0;
                // Simple solid color - blue base, slightly darker on hover via CSS
                html += '<div class="text-center cv-growth-bar" style="flex: 1; max-width: 60px;" title="' + (m.monthLabel || m.month) + ': ' + self.formatCurrency(m.revenue || 0) + '">';
                html += '<div style="height: ' + Math.max(height, 4) + 'px; background: #4f86f7; border-radius: 3px 3px 0 0; margin: 0 2px;"></div>';
                html += '<div class="small text-muted mt-1" style="font-size: 9px;">' + (m.monthLabel || m.month).substring(0, 3) + '</div>';
                html += '</div>';
            });
            html += '</div>';
            return html;
        },

        // ==========================================
        // PROFITABILITY TAB - Customer/Job Explorer with Flyout
        // ==========================================
        renderProfitabilityTab: function() {
            var self = this;
            var container = el('#cvProfitContent');
            if (!container) return;
            
            if (!this.latestData || !this.latestData.results) {
                container.innerHTML = '<div class="text-center text-muted py-5">No data available. Please wait for data to load.</div>';
                return;
            }
            
            var profitability = this.latestData.results.profitability || {};
            var customers = profitability.customers || [];
            var summary = profitability.summary || {};
            var method = summary.method || 'unknown';
            
            // Initialize state
            this.expandedCustomers = this.expandedCustomers || {};
            this.profitPagination = this.profitPagination || { page: 1, pageSize: 20, sortCol: 'totalRevenue', sortDir: 'desc' };
            
            var html = '';
            
            // Method indicator with explicit error messaging
            var methodClass = summary.status === 'error' ? 'warning' :
                              method === 'project_financials' ? 'success' : 'info';
            html += '<div class="alert alert-' + methodClass + ' py-2 mb-3">';
            html += '<i class="fas fa-' + (summary.status === 'error' ? 'exclamation-triangle' : (method === 'project_financials' ? 'check-circle' : 'info-circle')) + ' mr-2"></i>';
            html += '<strong>Method:</strong> ' + this.formatMethodName(method);
            
            if (summary.status === 'error') {
                html += '<br><small class="text-muted">' + (summary.message || 'Profitability data is unavailable.') + '</small>';
            } else if (method !== 'project_financials' && method !== 'disabled') {
                html += ' <small class="text-muted ml-2">— Switch to Project Financials in Configuration for job-level detail</small>';
            }
            html += '</div>';
            
            // Summary Cards - use cf-kpi-card for consistent styling
            html += '<div class="row mb-3 cf-kpi-row" style="flex-wrap: nowrap; overflow-x: auto;">';
            
            var kpiCards = [
                { label: 'Total Revenue', value: this.formatCurrency(summary.totalRevenue || 0), sub: (summary.customerCount || 0) + ' customers', icon: 'fa-dollar-sign', color: 'green' },
                { label: 'Total Costs', value: this.formatCurrency(summary.totalCost || 0), sub: (summary.totalJobs || 0) + ' jobs', icon: 'fa-file-invoice-dollar', color: 'red' },
                { label: 'Gross Profit', value: this.formatCurrency(summary.totalGrossProfit || 0), sub: (summary.totalGrossProfit || 0) < 0 ? 'Loss' : 'Profit', icon: 'fa-hand-holding-usd', color: (summary.totalGrossProfit || 0) < 0 ? 'red' : 'blue' },
                { label: 'Avg Margin', value: (summary.avgMarginPct || 0).toFixed(1) + '%', sub: this.getMarginLabel(summary.avgMarginPct), icon: 'fa-percentage', color: this.getMarginColor(summary.avgMarginPct) }
            ];
            
            var self = this;
            kpiCards.forEach(function(card) {
                html += '<div class="col-md-3 col-6 mb-2" style="flex-shrink: 1; min-width: 140px;">';
                html += '<div class="cf-kpi-card">';
                html += '<div class="icon-wrapper bg-' + card.color + '-soft"><i class="fas ' + card.icon + ' text-' + card.color + '"></i></div>';
                html += '<div class="kpi-content">';
                html += '<span class="kpi-label">' + card.label + '</span>';
                html += '<span class="kpi-value">' + card.value + '</span>';
                html += '<span class="kpi-sub">' + card.sub + '</span>';
                html += '</div></div></div>';
            });
            html += '</div>';
            
            if (customers.length === 0) {
                html += '<div class="text-center text-muted py-5"><i class="fas fa-inbox fa-3x mb-3"></i><div>No profitability data available for this period</div></div>';
                container.innerHTML = html;
                return;
            }
            
            // Sort customers
            var sortCol = this.profitPagination.sortCol;
            var sortDir = this.profitPagination.sortDir;
            var sortedCustomers = customers.slice().sort(function(a, b) {
                var aVal = a[sortCol] || 0;
                var bVal = b[sortCol] || 0;
                if (typeof aVal === 'string') {
                    return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                }
                return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
            });
            
            // Pagination
            var page = this.profitPagination.page;
            var pageSize = this.profitPagination.pageSize;
            var totalPages = Math.ceil(sortedCustomers.length / pageSize);
            var startIdx = (page - 1) * pageSize;
            var pageCustomers = sortedCustomers.slice(startIdx, startIdx + pageSize);
            
            // Customer/Job Table
            html += '<div class="card border-0 shadow-sm">';
            html += '<div class="card-header bg-white py-2 d-flex justify-content-between align-items-center">';
            html += '<span class="font-weight-bold"><i class="fas fa-users mr-2 text-primary"></i>Customer Profitability</span>';
            html += '<span class="small text-muted">Click customer to expand jobs • Click job for detail</span>';
            html += '</div>';
            html += '<div class="card-body p-0">';
            html += '<div class="table-responsive">';
            html += '<table class="table table-hover mb-0 cv-profit-table">';
            html += '<thead class="thead-light"><tr>';
            html += '<th style="width:30px;"></th>';
            html += this.profitSortHeader('Customer / Job', 'customerName');
            html += this.profitSortHeader('Revenue', 'totalRevenue', 'text-right');
            html += this.profitSortHeader('Costs', 'totalCost', 'text-right');
            html += this.profitSortHeader('Profit', 'grossProfit', 'text-right');
            html += this.profitSortHeader('Margin', 'marginPct', 'text-right');
            html += '<th class="text-center">Tier</th>';
            html += '</tr></thead>';
            html += '<tbody>';
            
            pageCustomers.forEach(function(c) {
                var isExpanded = self.expandedCustomers[c.customerId];
                var hasJobs = c.jobs && c.jobs.length > 0;
                var marginClass = c.marginPct >= 40 ? 'text-success' : c.marginPct < 0 ? 'text-danger' : c.marginPct < 10 ? 'text-warning' : '';
                var tierBadge = self.getProfitTierBadge(c.profitTier);
                
                // Customer row - use string customerId for onclick
                html += '<tr class="cv-customer-row' + (hasJobs ? ' cv-clickable' : '') + '" ' + 
                    (hasJobs ? 'onclick="CustomerValueController.toggleCustomerJobs(\'' + c.customerId + '\')"' : '') + '>';
                html += '<td class="text-center">';
                if (hasJobs) {
                    html += '<i class="fas fa-chevron-' + (isExpanded ? 'down' : 'right') + ' text-muted"></i>';
                }
                html += '</td>';
                html += '<td><strong>' + escapeHtml(c.customerName) + '</strong>';
                if (hasJobs) html += ' <span class="badge badge-secondary ml-1">' + c.jobs.length + ' jobs</span>';
                if (c.isFakeChampion) html += ' <span class="badge badge-warning ml-1" title="High revenue, low margin">⚠️</span>';
                html += '</td>';
                html += '<td class="text-right text-success">' + self.formatCurrency(c.totalRevenue) + '</td>';
                html += '<td class="text-right text-danger">' + self.formatCurrency(c.totalCost) + '</td>';
                html += '<td class="text-right ' + (c.grossProfit < 0 ? 'text-danger font-weight-bold' : '') + '">' + self.formatCurrency(c.grossProfit) + '</td>';
                html += '<td class="text-right ' + marginClass + ' font-weight-bold">' + (c.marginPct || 0).toFixed(1) + '%</td>';
                html += '<td class="text-center">' + tierBadge + '</td>';
                html += '</tr>';
                
                // Job rows (if expanded)
                if (isExpanded && hasJobs) {
                    c.jobs.forEach(function(j) {
                        var jMarginClass = j.marginPct >= 40 ? 'text-success' : j.marginPct < 0 ? 'text-danger' : j.marginPct < 10 ? 'text-warning' : '';
                        html += '<tr class="cv-job-row cv-clickable" onclick="CustomerValueController.openJobFlyout(' + j.jobId + ', \'' + escapeHtml(j.jobName).replace(/'/g, "\\'") + '\')">';
                        html += '<td></td>';
                        html += '<td class="pl-4"><i class="fas fa-project-diagram text-muted mr-2"></i>' + escapeHtml(j.jobName);
                        if (j.transactionCount) html += ' <small class="text-muted">(' + j.transactionCount + ' txns)</small>';
                        html += '</td>';
                        html += '<td class="text-right">' + self.formatCurrency(j.revenue) + '</td>';
                        html += '<td class="text-right">' + self.formatCurrency(j.costs) + '</td>';
                        html += '<td class="text-right ' + (j.profit < 0 ? 'text-danger' : '') + '">' + self.formatCurrency(j.profit) + '</td>';
                        html += '<td class="text-right ' + jMarginClass + '">' + (j.marginPct || 0).toFixed(1) + '%</td>';
                        html += '<td></td>';
                        html += '</tr>';
                    });
                }
            });
            
            html += '</tbody></table>';
            html += '</div>';
            
            // Pagination controls
            if (totalPages > 1) {
                html += '<div class="card-footer bg-white d-flex justify-content-between align-items-center py-2">';
                html += '<span class="small text-muted">Showing ' + (startIdx + 1) + '-' + Math.min(startIdx + pageSize, sortedCustomers.length) + ' of ' + sortedCustomers.length + ' customers</span>';
                html += '<nav><ul class="pagination pagination-sm mb-0">';
                html += '<li class="page-item ' + (page <= 1 ? 'disabled' : '') + '">';
                html += '<a class="page-link" href="#" onclick="CustomerValueController.profitPage(' + (page - 1) + '); return false;">«</a></li>';
                
                // Show page numbers
                var startPage = Math.max(1, page - 2);
                var endPage = Math.min(totalPages, startPage + 4);
                for (var p = startPage; p <= endPage; p++) {
                    html += '<li class="page-item ' + (p === page ? 'active' : '') + '">';
                    html += '<a class="page-link" href="#" onclick="CustomerValueController.profitPage(' + p + '); return false;">' + p + '</a></li>';
                }
                
                html += '<li class="page-item ' + (page >= totalPages ? 'disabled' : '') + '">';
                html += '<a class="page-link" href="#" onclick="CustomerValueController.profitPage(' + (page + 1) + '); return false;">»</a></li>';
                html += '</ul></nav>';
                html += '</div>';
            }
            
            html += '</div>';
            
            // Flyout Panel (hidden by default)
            html += '<div id="cvJobFlyout" class="cv-flyout-panel" style="display:none;">';
            html += '<div class="cv-flyout-header">';
            html += '<span id="cvJobFlyoutTitle">Job Detail</span>';
            html += '<button class="btn-close" onclick="CustomerValueController.closeJobFlyout()"><i class="fas fa-times"></i></button>';
            html += '</div>';
            html += '<div id="cvJobFlyoutBody" class="cv-flyout-body"></div>';
            html += '</div>';
            
            container.innerHTML = html;
        },
        
        profitSortHeader: function(label, col, cssClass) {
            var isSorted = this.profitPagination.sortCol === col;
            var dir = isSorted ? this.profitPagination.sortDir : 'desc';
            var newDir = isSorted && dir === 'desc' ? 'asc' : 'desc';
            var icon = isSorted ? (dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
            return '<th class="' + (cssClass || '') + ' cv-sortable" style="cursor:pointer;" onclick="CustomerValueController.profitSort(\'' + col + '\', \'' + newDir + '\')">' + 
                label + ' <i class="fas ' + icon + ' text-muted ml-1"></i></th>';
        },
        
        profitSort: function(col, dir) {
            this.profitPagination.sortCol = col;
            this.profitPagination.sortDir = dir;
            this.profitPagination.page = 1;
            this.renderProfitabilityTab();
        },
        
        profitPage: function(page) {
            var profitability = this.latestData.results.profitability || {};
            var customers = profitability.customers || [];
            var totalPages = Math.ceil(customers.length / this.profitPagination.pageSize);
            if (page >= 1 && page <= totalPages) {
                this.profitPagination.page = page;
                this.renderProfitabilityTab();
            }
        },
        
        toggleCustomerJobs: function(customerId) {
            this.expandedCustomers = this.expandedCustomers || {};
            this.expandedCustomers[customerId] = !this.expandedCustomers[customerId];
            this.renderProfitabilityTab();
        },
        
        openJobFlyout: async function(jobId, jobName) {
            var self = this;
            var panel = el('#cvJobFlyout');
            var title = el('#cvJobFlyoutTitle');
            var body = el('#cvJobFlyoutBody');
            
            if (!panel || !title || !body) return;
            
            title.innerHTML = '<i class="fas fa-project-diagram mr-2"></i>' + escapeHtml(jobName) + ' — Profitability Detail';
            body.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading job transactions...</div></div>';
            panel.style.display = 'flex';
            
            try {
                var params = {
                    action: 'customer_value',
                    subAction: 'job_detail',
                    jobId: jobId,
                    config: JSON.stringify(this.configData || {})
                };
                var res = await API.post('customer_value', params);
                
                if (res.status === 'success' && res.job) {
                    this.renderJobFlyoutContent(res);
                } else {
                    body.innerHTML = '<div class="alert alert-warning"><i class="fas fa-exclamation-triangle mr-2"></i>' + (res.error || 'Unable to load job detail') + '</div>';
                }
            } catch (e) {
                console.error('Job flyout error:', e);
                body.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-circle mr-2"></i>Error loading job detail: ' + e.message + '</div>';
            }
        },
        
        renderJobFlyoutContent: function(data) {
            var self = this;
            var body = el('#cvJobFlyoutBody');
            if (!body) return;
            
            var job = data.job;
            var summary = data.summary || {};
            var transactions = data.transactions || [];
            
            // Transaction type friendly names
            var txnTypeNames = {
                'CustInvc': 'Customer Invoices',
                'CashSale': 'Cash Sales',
                'CustCred': 'Customer Credits',
                'SalesOrd': 'Sales Orders',
                'Estimate': 'Estimates',
                'VendBill': 'Vendor Bills',
                'VendCred': 'Vendor Credits',
                'ExpRept': 'Expense Reports',
                'Check': 'Checks',
                'Journal': 'Journal Entries',
                'PurchOrd': 'Purchase Orders',
                'ItemRcpt': 'Item Receipts',
                'Transfer': 'Transfers',
                'Deposit': 'Deposits',
                'CustPymt': 'Customer Payments',
                'VendPymt': 'Vendor Payments'
            };
            
            var html = '';
            
            // Job info header
            html += '<div class="cv-flyout-job-header mb-3">';
            html += '<div class="d-flex justify-content-between align-items-start">';
            html += '<div>';
            html += '<h5 class="mb-1">' + escapeHtml(job.name) + '</h5>';
            html += '<div class="text-muted small">';
            if (job.customerName) html += '<i class="fas fa-user mr-1"></i>' + escapeHtml(job.customerName) + ' &nbsp;';
            if (job.jobType) html += '<i class="fas fa-tag mr-1"></i>' + escapeHtml(job.jobType) + ' &nbsp;';
            html += '</div>';
            if (job.startDate || job.endDate) {
                html += '<div class="text-muted small mt-1">';
                html += '<i class="fas fa-calendar mr-1"></i>';
                html += (job.startDate || '?') + ' → ' + (job.endDate || 'Ongoing');
                html += '</div>';
            }
            html += '</div>';
            html += '<a href="/app/accounting/project/project.nl?id=' + job.id + '" target="_blank" class="btn btn-sm btn-outline-primary">';
            html += '<i class="fas fa-external-link-alt mr-1"></i>View in NetSuite</a>';
            html += '</div></div>';
            
            // Summary cards
            html += '<div class="row mb-3">';
            html += '<div class="col-3"><div class="card border-0 bg-success-soft p-2 text-center">';
            html += '<div class="small text-muted">Revenue</div>';
            html += '<div class="h5 mb-0 text-success">' + this.formatCurrency(summary.totalRevenue || 0) + '</div>';
            html += '</div></div>';
            html += '<div class="col-3"><div class="card border-0 bg-danger-soft p-2 text-center">';
            html += '<div class="small text-muted">Costs</div>';
            html += '<div class="h5 mb-0 text-danger">' + this.formatCurrency(summary.totalCosts || 0) + '</div>';
            html += '</div></div>';
            html += '<div class="col-3"><div class="card border-0 bg-primary-soft p-2 text-center">';
            html += '<div class="small text-muted">Profit</div>';
            html += '<div class="h5 mb-0 ' + ((summary.grossProfit || 0) < 0 ? 'text-danger' : 'text-primary') + '">' + this.formatCurrency(summary.grossProfit || 0) + '</div>';
            html += '</div></div>';
            html += '<div class="col-3"><div class="card border-0 bg-info-soft p-2 text-center">';
            html += '<div class="small text-muted">Margin</div>';
            html += '<div class="h5 mb-0 text-info">' + (summary.marginPct || 0).toFixed(1) + '%</div>';
            html += '</div></div>';
            html += '</div>';
            
            // Breakdown by task (if available)
            var byTask = summary.byTask || {};
            var taskKeys = Object.keys(byTask);
            if (taskKeys.length > 1 || (taskKeys.length === 1 && taskKeys[0] !== 'No Task')) {
                html += '<div class="card border-0 shadow-sm mb-3">';
                html += '<div class="card-header bg-light py-2"><strong class="small"><i class="fas fa-tasks mr-2"></i>By Task</strong></div>';
                html += '<div class="card-body p-0">';
                html += '<table class="table table-sm mb-0">';
                html += '<thead class="thead-light"><tr><th>Task</th><th class="text-right">Revenue</th><th class="text-right">Costs</th><th class="text-right">Profit</th></tr></thead>';
                html += '<tbody>';
                taskKeys.sort(function(a, b) { return (byTask[b].revenue - byTask[b].costs) - (byTask[a].revenue - byTask[a].costs); }).forEach(function(task) {
                    var t = byTask[task];
                    var profit = t.revenue - t.costs;
                    html += '<tr>';
                    html += '<td>' + escapeHtml(task) + ' <small class="text-muted">(' + t.count + ')</small></td>';
                    html += '<td class="text-right text-success">' + self.formatCurrency(t.revenue) + '</td>';
                    html += '<td class="text-right text-danger">' + self.formatCurrency(t.costs) + '</td>';
                    html += '<td class="text-right ' + (profit < 0 ? 'text-danger' : '') + '">' + self.formatCurrency(profit) + '</td>';
                    html += '</tr>';
                });
                html += '</tbody></table></div></div>';
            }
            
            // Store transactions for re-rendering when grouping changes
            this.flyoutTransactions = transactions;
            this.flyoutTxnTypeNames = txnTypeNames;
            
            // Grouping mode (default: type)
            var groupMode = this.flyoutGroupMode || 'type';
            
            // Transactions card with grouping toggle
            html += '<div class="card border-0 shadow-sm">';
            html += '<div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">';
            html += '<strong class="small"><i class="fas fa-list mr-2"></i>Transactions (' + transactions.length + ' total)</strong>';
            html += '<div class="btn-group btn-group-sm">';
            html += '<button class="btn btn-' + (groupMode === 'type' ? 'primary' : 'outline-secondary') + '" onclick="CustomerValueController.setFlyoutGrouping(\'type\')">By Type</button>';
            html += '<button class="btn btn-' + (groupMode === 'account' ? 'primary' : 'outline-secondary') + '" onclick="CustomerValueController.setFlyoutGrouping(\'account\')">By Account</button>';
            html += '</div>';
            html += '</div>';
            html += '<div id="cvFlyoutTxnBody" class="card-body p-0" style="max-height: 500px; overflow-y: auto;">';
            
            html += this.renderFlyoutTransactions(transactions, groupMode, txnTypeNames);
            
            html += '</div></div>';
            
            body.innerHTML = html;
        },
        
        setFlyoutGrouping: function(mode) {
            this.flyoutGroupMode = mode;
            var txnBody = el('#cvFlyoutTxnBody');
            if (txnBody && this.flyoutTransactions) {
                txnBody.innerHTML = this.renderFlyoutTransactions(this.flyoutTransactions, mode, this.flyoutTxnTypeNames);
            }
            // Update button states
            var typeBtn = document.querySelector('[onclick*="setFlyoutGrouping(\'type\')"]');
            var acctBtn = document.querySelector('[onclick*="setFlyoutGrouping(\'account\')"]');
            if (typeBtn) typeBtn.className = 'btn btn-' + (mode === 'type' ? 'primary' : 'outline-secondary');
            if (acctBtn) acctBtn.className = 'btn btn-' + (mode === 'account' ? 'primary' : 'outline-secondary');
        },
        
        renderFlyoutTransactions: function(transactions, groupMode, txnTypeNames) {
            var self = this;
            var html = '';
            
            if (transactions.length === 0) {
                return '<div class="text-center text-muted py-4">No transactions found</div>';
            }
            
            // Group transactions by selected mode
            var grouped = {};
            transactions.forEach(function(t) {
                var key = groupMode === 'type' ? (t.tranType || 'Other') : (t.accountName || 'Unknown Account');
                if (!grouped[key]) {
                    grouped[key] = {
                        transactions: [],
                        totalRevenue: 0,
                        totalCost: 0,
                        accountType: t.accountType
                    };
                }
                grouped[key].transactions.push(t);
                if (t.isRevenue) grouped[key].totalRevenue += t.displayAmount || 0;
                if (t.isRevenueCredit) grouped[key].totalRevenue -= t.displayAmount || 0;
                if (t.isCost) grouped[key].totalCost += t.displayAmount || 0;
                if (t.isCostCredit) grouped[key].totalCost -= t.displayAmount || 0;
            });
            
            // Sort groups: revenue first, then costs, by amount
            var groupKeys = Object.keys(grouped).sort(function(a, b) {
                var aRev = grouped[a].totalRevenue;
                var bRev = grouped[b].totalRevenue;
                var aCost = grouped[a].totalCost;
                var bCost = grouped[b].totalCost;
                if (aRev > 0 && bRev <= 0) return -1;
                if (bRev > 0 && aRev <= 0) return 1;
                if (aRev > 0 && bRev > 0) return bRev - aRev;
                if (aCost > 0 && bCost <= 0) return -1;
                if (bCost > 0 && aCost <= 0) return 1;
                return bCost - aCost;
            });
            
            // Credit transaction types (for display purposes)
            var creditTranTypes = ['CustCred', 'CustRfnd', 'VendCred', 'VendRfnd'];
            
            // Render each group
            groupKeys.forEach(function(key, idx) {
                var group = grouped[key];
                var friendlyName = groupMode === 'type' ? (txnTypeNames[key] || key) : key;
                var isCreditType = groupMode === 'type' && creditTranTypes.indexOf(key) >= 0;
                
                // Determine group totals and styling
                var groupTotal, groupClass, groupPrefix;
                if (isCreditType) {
                    // Credit types: sum all displayAmounts in the group
                    groupTotal = group.transactions.reduce(function(sum, t) {
                        return sum + (t.displayAmount || 0);
                    }, 0);
                    groupClass = 'text-warning';
                    groupPrefix = '−';
                } else if (group.totalRevenue > 0) {
                    groupTotal = group.totalRevenue;
                    groupClass = 'text-success';
                    groupPrefix = '+';
                } else {
                    groupTotal = Math.abs(group.totalCost);
                    groupClass = 'text-danger';
                    groupPrefix = '-';
                }
                var groupId = 'txnGroup' + idx;
                
                // Group header (collapsible)
                html += '<div class="cv-txn-group">';
                html += '<div class="cv-txn-group-header d-flex justify-content-between align-items-center px-3 py-2 bg-light border-bottom" ';
                html += 'style="cursor: pointer;" onclick="CustomerValueController.toggleTxnGroup(\'' + groupId + '\')">';
                html += '<div>';
                html += '<i class="fas fa-chevron-down mr-2 text-muted cv-txn-chevron" id="' + groupId + 'Icon"></i>';
                html += '<strong>' + escapeHtml(friendlyName) + '</strong>';
                html += ' <span class="badge badge-secondary ml-2">' + group.transactions.length + '</span>';
                html += '</div>';
                html += '<span class="' + groupClass + ' font-weight-bold">' + groupPrefix + self.formatCurrency(groupTotal) + '</span>';
                html += '</div>';
                
                // Group transactions (shown by default)
                html += '<div id="' + groupId + '" class="cv-txn-group-body">';
                html += '<table class="table table-sm table-hover mb-0" style="font-size: 0.8rem;">';
                html += '<thead class="thead-light"><tr>';
                if (groupMode === 'type') {
                    html += '<th style="width:80px;">Date</th><th>Account</th><th>Memo</th><th class="text-right" style="width:95px;">Amount</th><th style="width:25px;"></th>';
                } else {
                    html += '<th style="width:80px;">Date</th><th>Type</th><th>Memo</th><th class="text-right" style="width:95px;">Amount</th><th style="width:25px;"></th>';
                }
                html += '</tr></thead><tbody>';
                
                group.transactions.forEach(function(t) {
                    // Colors: green=revenue, red=cost, orange=credit (reduction)
                    var amountClass = t.isRevenue ? 'text-success' : 
                                      t.isCost ? 'text-danger' : 
                                      (t.isRevenueCredit || t.isCostCredit) ? 'text-warning' : '';
                    var amountPrefix = t.isRevenue ? '+' : 
                                       t.isCost ? '-' : 
                                       (t.isRevenueCredit || t.isCostCredit) ? '−' : '';
                    var memoText = t.memo || '';
                    var memoShort = memoText.length > 40 ? memoText.substring(0, 40) + '...' : memoText;
                    var typeName = txnTypeNames[t.tranType] || t.tranType || '--';
                    html += '<tr>';
                    html += '<td class="text-nowrap small">' + (t.date || '--') + '</td>';
                    if (groupMode === 'type') {
                        html += '<td class="small" title="' + escapeHtml(t.accountName || '') + '">' + escapeHtml((t.accountName || '').substring(0, 25)) + '</td>';
                    } else {
                        html += '<td class="small">' + escapeHtml(typeName) + '</td>';
                    }
                    html += '<td class="small text-muted" title="' + escapeHtml(memoText) + '">' + escapeHtml(memoShort) + '</td>';
                    html += '<td class="text-right ' + amountClass + ' font-weight-bold">' + amountPrefix + self.formatCurrency(t.displayAmount) + '</td>';
                    html += '<td><a href="/app/accounting/transactions/transaction.nl?id=' + t.transactionId + '" target="_blank" class="text-muted"><i class="fas fa-external-link-alt fa-xs"></i></a></td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table>';
                html += '</div></div>';
            });
            
            return html;
        },
        
        toggleTxnGroup: function(groupId) {
            var group = el('#' + groupId);
            var icon = el('#' + groupId + 'Icon');
            if (group && icon) {
                if (group.style.display === 'none') {
                    group.style.display = '';
                    icon.className = 'fas fa-chevron-down mr-2 text-muted cv-txn-chevron';
                } else {
                    group.style.display = 'none';
                    icon.className = 'fas fa-chevron-right mr-2 text-muted cv-txn-chevron';
                }
            }
        },
        
        closeJobFlyout: function() {
            var panel = el('#cvJobFlyout');
            if (panel) panel.style.display = 'none';
        },
        
        getMarginLabel: function(marginPct) {
            if (marginPct >= 40) return 'Excellent';
            if (marginPct >= 25) return 'Good';
            if (marginPct >= 10) return 'Fair';
            if (marginPct >= 0) return 'Low';
            return 'Loss';
        },
        
        getMarginColor: function(marginPct) {
            if (marginPct >= 40) return 'green';
            if (marginPct >= 25) return 'blue';
            if (marginPct >= 10) return 'purple';
            if (marginPct >= 0) return 'orange';
            return 'red';
        },
        
        getProfitTierBadge: function(tier) {
            var config = {
                high: { class: 'badge-success', label: 'High' },
                medium: { class: 'badge-info', label: 'Medium' },
                low: { class: 'badge-warning', label: 'Low' },
                marginal: { class: 'badge-secondary', label: 'Marginal' },
                loss: { class: 'badge-danger', label: 'Loss' }
            };
            var c = config[tier] || { class: 'badge-secondary', label: tier || 'N/A' };
            return '<span class="badge ' + c.class + '">' + c.label + '</span>';
        },
        
        formatMethodName: function(method) {
            var names = {
                'project_financials': 'Project Financials (NetSuite Pre-calculated)',
                'gl_rollup': 'GL Rollup',
                'unsupported': 'Unsupported',
                'disabled': 'Disabled'
            };
            return names[method] || method;
        },

        // ==========================================
        // CONFIGURATION TAB - Comprehensive Settings
        // ==========================================
        renderConfigTab: function() {
            var self = this;
            var config = this.configData || {};
            var container = el('#cvConfigContainer');
            if (!container) return;

            var html = '<div class="p-3">';
            
            // Scoring Weights Section
            html += '<div class="card mb-3"><div class="card-header bg-white py-2"><h6 class="mb-0"><i class="fas fa-balance-scale mr-2 text-primary"></i>Health Score Weights</h6></div>';
            html += '<div class="card-body py-3">';
            html += '<p class="small text-muted mb-3">Adjust the importance of each factor in calculating customer health scores. Weights should sum to 100%.</p>';
            html += '<div class="row">';
            html += this.configSlider('Recency Weight', 'weightRecency', config.weightRecency || 25, 'How recently the customer made a purchase');
            html += this.configSlider('Frequency Weight', 'weightFrequency', config.weightFrequency || 25, 'How often the customer purchases');
            html += this.configSlider('Monetary Weight', 'weightMonetary', config.weightMonetary || 30, 'Total spend amount');
            html += this.configSlider('Payment Weight', 'weightPayment', config.weightPayment || 20, 'Invoice payment behavior');
            html += '</div>';
            html += '<div class="alert alert-info py-2 mb-0 small"><i class="fas fa-info-circle mr-1"></i>Current total: <strong id="cvWeightTotal">100%</strong></div>';
            html += '</div></div>';
            
            // CLV Settings Section
            html += '<div class="card mb-3"><div class="card-header bg-white py-2"><h6 class="mb-0"><i class="fas fa-gem mr-2 text-purple"></i>Customer Lifetime Value Settings</h6></div>';
            html += '<div class="card-body py-3"><div class="row">';
            html += this.configInput('CLV Projection Years', 'clvProjectionYears', config.clvProjectionYears || 3, 'Number of years to project future customer value (1-10)', 'number', 1, 10);
            html += this.configSelect('CLV Tier Thresholds', 'clvTierMethod', config.clvTierMethod || 'percentile', 'How to assign customer tiers', [
                { value: 'percentile', label: 'Percentile-based (top 20% = Platinum)' },
                { value: 'fixed', label: 'Fixed score thresholds' }
            ]);
            html += '</div></div></div>';
            
            // Profitability Settings Section
            html += '<div class="card mb-3"><div class="card-header bg-white py-2"><h6 class="mb-0"><i class="fas fa-dollar-sign mr-2 text-success"></i>Profitability Analysis</h6></div>';
            html += '<div class="card-body py-3">';
            html += '<p class="small text-muted mb-3">Configure how customer profitability is calculated. These settings mirror NetSuite\'s Setup → Accounting → Project Profitability.</p>';
            html += '<div class="row">';
            html += this.configSelect('Calculation Method', 'profitabilityMethod', config.profitabilityMethod || 'project_financials', 'How to calculate gross profit', [
                { value: 'project_financials', label: 'Project Financials (NetSuite pre-calculated, recommended)' },
                { value: 'gl_rollup', label: 'GL Rollup (uses actual job costs)' },
                { value: 'disabled', label: 'Disabled' }
            ]);
            html += '</div>';
            
            // Transactions included in profitability calculation
            html += '<hr class="my-3"><h6 class="font-weight-bold small mb-3"><i class="fas fa-filter mr-2"></i>Transactions Included in Profitability Calculation</h6>';
            html += '<p class="small text-muted mb-3">Select which committed (planned) transactions to include alongside actual transactions.</p>';
            
            // Committed Costs checkboxes
            // Default values match backend DEFAULTS (profitIncludePurchaseOrders defaults to true)
            html += '<div class="row">';
            html += '<div class="col-md-6">';
            html += '<label class="small font-weight-bold d-block mb-2 text-danger"><i class="fas fa-minus-circle mr-1"></i>Committed Costs</label>';
            html += this.configCheckbox('Planned Time', 'profitIncludePlannedTime', config.profitIncludePlannedTime === true, 'Include planned/budgeted time entries');
            html += this.configCheckbox('Actual Time', 'profitIncludeActualTime', config.profitIncludeActualTime !== false, 'Include actual time entries (usually enabled)');
            html += this.configCheckbox('Amortization', 'profitIncludeAmortization', config.profitIncludeAmortization === true, 'Include amortization schedule entries');
            html += this.configCheckbox('Purchase Orders', 'profitIncludePurchaseOrders', config.profitIncludePurchaseOrders !== false, 'Include open purchase orders as committed costs');
            html += this.configCheckbox('Expense Reports Pending Approval', 'profitIncludeExpenseReportsPending', config.profitIncludeExpenseReportsPending === true, 'Include expense reports awaiting approval');
            html += this.configCheckbox('Vendor Bills Pending Approval', 'profitIncludeVendorBillsPending', config.profitIncludeVendorBillsPending === true, 'Include vendor bills awaiting approval');
            html += this.configCheckbox('Journal Entries Pending Approval', 'profitIncludeJournalEntriesPending', config.profitIncludeJournalEntriesPending === true, 'Include journal entries awaiting approval');
            html += this.configCheckbox('Treat Approved Time as Actual', 'profitTreatApprovedTimeAsActual', config.profitTreatApprovedTimeAsActual === true, 'Count tracked & approved time as actual cost');
            html += '</div>';
            
            // Committed Revenue checkboxes
            html += '<div class="col-md-6">';
            html += '<label class="small font-weight-bold d-block mb-2 text-success"><i class="fas fa-plus-circle mr-1"></i>Committed Revenue</label>';
            html += this.configCheckbox('Sales Orders', 'profitIncludeSalesOrders', config.profitIncludeSalesOrders === true, 'Include open sales orders as committed revenue');
            html += this.configCheckbox('Charges', 'profitIncludeCharges', config.profitIncludeCharges === true, 'Include project charges as committed revenue');
            html += '<div class="alert alert-info py-2 mt-3 small"><i class="fas fa-info-circle mr-1"></i>Committed transactions are planned but not yet posted to the GL. Enable these to see projected profitability including pending work.</div>';
            html += '</div>';
            html += '</div>';
            
            html += '</div></div>';
            
            // Recency Thresholds Section
            html += '<div class="card mb-3"><div class="card-header bg-white py-2"><h6 class="mb-0"><i class="fas fa-clock mr-2 text-info"></i>Recency Thresholds</h6></div>';
            html += '<div class="card-body py-3">';
            html += '<p class="small text-muted mb-3">Define what constitutes "recent" customer activity for your business.</p>';
            html += '<div class="row">';
            html += this.configInput('Active (days)', 'recencyDaysGood', config.recencyDaysGood || 30, 'Customers who purchased within this period are considered active', 'number', 1, 365);
            html += this.configInput('At Risk (days)', 'recencyDaysWarning', config.recencyDaysWarning || 90, 'Customers inactive for this period need attention', 'number', 1, 365);
            html += this.configInput('Churned (days)', 'recencyDaysChurned', config.recencyDaysChurned || 180, 'Customers inactive longer are considered churned', 'number', 1, 730);
            html += '</div></div></div>';
            
            // Churn Risk Settings Section
            html += '<div class="card mb-3"><div class="card-header bg-white py-2"><h6 class="mb-0"><i class="fas fa-exclamation-triangle mr-2 text-warning"></i>Churn Risk Settings</h6></div>';
            html += '<div class="card-body py-3"><div class="row">';
            html += this.configInput('High Risk Threshold (days)', 'churnRiskHighDays', config.churnRiskHighDays || 120, 'Days of inactivity to flag as high churn risk', 'number', 30, 365);
            html += this.configInput('Critical Risk Threshold (days)', 'churnRiskCriticalDays', config.churnRiskCriticalDays || 180, 'Days of inactivity for critical churn risk', 'number', 60, 730);
            html += '</div></div></div>';
            
            // RFM Segmentation Settings
            html += '<div class="card mb-3"><div class="card-header bg-white py-2"><h6 class="mb-0"><i class="fas fa-th-large mr-2 text-success"></i>RFM Segmentation</h6></div>';
            html += '<div class="card-body py-3">';
            html += '<p class="small text-muted mb-3">Configure how customers are assigned to RFM segments.</p>';
            html += '<div class="row">';
            html += this.configSelect('Scoring Method', 'rfmScoringMethod', config.rfmScoringMethod || 'quintile', 'Method for calculating RFM scores', [
                { value: 'quintile', label: 'Quintile (1-5 scale, equal distribution)' },
                { value: 'percentile', label: 'Percentile-based' }
            ]);
            html += this.configInput('Min Transactions', 'rfmMinTransactions', config.rfmMinTransactions || 1, 'Minimum transactions to include in segmentation', 'number', 1, 100);
            html += '</div></div></div>';
            
            // Display Settings
            html += '<div class="card mb-3"><div class="card-header bg-white py-2"><h6 class="mb-0"><i class="fas fa-eye mr-2 text-secondary"></i>Display Settings</h6></div>';
            html += '<div class="card-body py-3"><div class="row">';
            html += this.configInput('Rows Per Page', 'rowsPerPage', config.rowsPerPage || 25, 'Number of rows to show in tables', 'number', 10, 100);
            html += this.configSelect('Currency Format', 'currencyFormat', config.currencyFormat || 'symbol', 'How to display currency values', [
                { value: 'symbol', label: '$1,234.56' },
                { value: 'code', label: 'USD 1,234.56' },
                { value: 'compact', label: '$1.2K' }
            ]);
            html += '</div></div></div>';

            // Save Button
            html += '<div class="d-flex justify-content-between align-items-center">';
            html += '<span class="small text-muted"><i class="fas fa-info-circle mr-1"></i>Changes take effect after clicking Apply and refreshing data</span>';
            html += '<button class="btn btn-primary" id="cvSaveConfig"><i class="fas fa-save mr-2"></i>Save Configuration</button>';
            html += '</div>';
            html += '</div>';

            container.innerHTML = html;
            
            // Bind slider updates and weight total calculation
            var weightInputs = ['cv_weightRecency', 'cv_weightFrequency', 'cv_weightMonetary', 'cv_weightPayment'];
            weightInputs.forEach(function(id) {
                var slider = el('#' + id);
                if (slider && slider.type === 'range') {
                    slider.oninput = function() {
                        el('#' + this.id + '_val').textContent = this.value + '%';
                        self.updateWeightTotal();
                    };
                }
            });
            
            this.updateWeightTotal();
            
            el('#cvSaveConfig').onclick = function() {
                self.saveConfig();
            };
        },

        updateWeightTotal: function() {
            var total = 0;
            ['cv_weightRecency', 'cv_weightFrequency', 'cv_weightMonetary', 'cv_weightPayment'].forEach(function(id) {
                var input = el('#' + id);
                if (input) total += parseInt(input.value) || 0;
            });
            var totalEl = el('#cvWeightTotal');
            if (totalEl) {
                totalEl.textContent = total + '%';
                totalEl.className = total === 100 ? 'text-success' : 'text-danger';
            }
        },

        configSlider: function(label, key, value, tooltip) {
            return '<div class="col-md-6 mb-3">' +
                '<label class="small font-weight-bold d-flex justify-content-between"><span>' + label + '</span><span class="badge badge-primary" id="cv_' + key + '_val">' + value + '%</span></label>' +
                '<input type="range" class="form-control-range" id="cv_' + key + '" min="0" max="50" value="' + value + '" title="' + tooltip + '">' +
                '<small class="text-muted">' + tooltip + '</small>' +
                '</div>';
        },

        configInput: function(label, key, value, tooltip, type, min, max) {
            type = type || 'number';
            var minAttr = min !== undefined ? ' min="' + min + '"' : '';
            var maxAttr = max !== undefined ? ' max="' + max + '"' : '';
            return '<div class="col-md-6 mb-3">' +
                '<label class="small font-weight-bold">' + label + '</label>' +
                '<input type="' + type + '" class="form-control form-control-sm" id="cv_' + key + '" value="' + value + '"' + minAttr + maxAttr + ' title="' + tooltip + '">' +
                '<small class="text-muted">' + tooltip + '</small>' +
                '</div>';
        },

        configSelect: function(label, key, value, tooltip, options) {
            var html = '<div class="col-md-6 mb-3">' +
                '<label class="small font-weight-bold">' + label + '</label>' +
                '<select class="form-control form-control-sm" id="cv_' + key + '" title="' + tooltip + '">';
            options.forEach(function(opt) {
                var selected = opt.value === value ? ' selected' : '';
                html += '<option value="' + opt.value + '"' + selected + '>' + opt.label + '</option>';
            });
            html += '</select><small class="text-muted">' + tooltip + '</small></div>';
            return html;
        },

        configCheckbox: function(label, key, checked, tooltip) {
            var checkedAttr = checked ? ' checked' : '';
            return '<div class="form-check mb-2">' +
                '<input type="checkbox" class="form-check-input" id="cv_' + key + '"' + checkedAttr + ' title="' + tooltip + '">' +
                '<label class="form-check-label small" for="cv_' + key + '">' + label + '</label>' +
                '</div>';
        },

        saveConfig: function() {
            var self = this;
            var config = {
                weightRecency: parseInt(el('#cv_weightRecency').value) || 25,
                weightFrequency: parseInt(el('#cv_weightFrequency').value) || 25,
                weightMonetary: parseInt(el('#cv_weightMonetary').value) || 30,
                weightPayment: parseInt(el('#cv_weightPayment').value) || 20,
                clvProjectionYears: parseInt(el('#cv_clvProjectionYears').value) || 3,
                clvTierMethod: el('#cv_clvTierMethod') ? el('#cv_clvTierMethod').value : 'percentile',
                profitabilityMethod: el('#cv_profitabilityMethod') ? el('#cv_profitabilityMethod').value : 'project_financials',
                profitabilityEstimatedMarginPct: el('#cv_profitabilityEstimatedMarginPct') ? (parseInt(el('#cv_profitabilityEstimatedMarginPct').value) || 35) : 35,
                // Profitability transaction inclusion settings (matches NetSuite Project Profitability)
                profitIncludePlannedTime: el('#cv_profitIncludePlannedTime') ? el('#cv_profitIncludePlannedTime').checked : false,
                profitIncludeActualTime: el('#cv_profitIncludeActualTime') ? el('#cv_profitIncludeActualTime').checked : true,
                profitIncludeAmortization: el('#cv_profitIncludeAmortization') ? el('#cv_profitIncludeAmortization').checked : false,
                profitIncludePurchaseOrders: el('#cv_profitIncludePurchaseOrders') ? el('#cv_profitIncludePurchaseOrders').checked : false,
                profitIncludeExpenseReportsPending: el('#cv_profitIncludeExpenseReportsPending') ? el('#cv_profitIncludeExpenseReportsPending').checked : false,
                profitIncludeVendorBillsPending: el('#cv_profitIncludeVendorBillsPending') ? el('#cv_profitIncludeVendorBillsPending').checked : false,
                profitIncludeJournalEntriesPending: el('#cv_profitIncludeJournalEntriesPending') ? el('#cv_profitIncludeJournalEntriesPending').checked : false,
                profitTreatApprovedTimeAsActual: el('#cv_profitTreatApprovedTimeAsActual') ? el('#cv_profitTreatApprovedTimeAsActual').checked : false,
                profitIncludeSalesOrders: el('#cv_profitIncludeSalesOrders') ? el('#cv_profitIncludeSalesOrders').checked : false,
                profitIncludeCharges: el('#cv_profitIncludeCharges') ? el('#cv_profitIncludeCharges').checked : false,
                recencyDaysGood: parseInt(el('#cv_recencyDaysGood').value) || 30,
                recencyDaysWarning: parseInt(el('#cv_recencyDaysWarning').value) || 90,
                recencyDaysChurned: parseInt(el('#cv_recencyDaysChurned').value) || 180,
                churnRiskHighDays: parseInt(el('#cv_churnRiskHighDays').value) || 120,
                churnRiskCriticalDays: parseInt(el('#cv_churnRiskCriticalDays').value) || 180,
                rfmScoringMethod: el('#cv_rfmScoringMethod') ? el('#cv_rfmScoringMethod').value : 'quintile',
                rfmMinTransactions: parseInt(el('#cv_rfmMinTransactions').value) || 1,
                rowsPerPage: parseInt(el('#cv_rowsPerPage').value) || 25,
                currencyFormat: el('#cv_currencyFormat') ? el('#cv_currencyFormat').value : 'symbol'
            };
            
            // Validate weight total
            var weightTotal = config.weightRecency + config.weightFrequency + config.weightMonetary + config.weightPayment;
            if (weightTotal !== 100) {
                if (window.Toast) {
                    Toast.show('Weights must sum to 100% (currently ' + weightTotal + '%)', 'error');
                }
                return;
            }
            
            API.post('customer_value_config', config).then(function() {
                self.configData = config;
                if (window.Toast) {
                    Toast.show('Configuration saved. Refreshing data...', 'success');
                }
                // Force refresh by clearing cached data and reloading
                self.latestData = null;
                self.expandedCustomers = {};
                self.profitPagination = { page: 1, pageSize: 20, sortCol: 'totalRevenue', sortDir: 'desc' };
                
                // Show loading state
                var tabs = ['cvOverviewContent', 'cvRFMContent', 'cvCLVContent', 'cvChurnContent', 'cvGrowthContent', 'cvProfitContent'];
                tabs.forEach(function(tabId) {
                    var tab = el('#' + tabId);
                    if (tab) tab.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x"></i><div class="mt-2">Refreshing data with new configuration...</div></div>';
                });
                
                // Reload data
                self.loadData();
            }).catch(function(e) {
                if (window.Toast) {
                    Toast.show('Failed to save: ' + e.message, 'error');
                }
            });
        },

        // ==========================================
        // UTILITY FUNCTIONS
        // ==========================================
        sortableHeader: function(label, column, tableKey, className) {
            var state = this.sortState[tableKey] || {};
            var isActive = state.column === column;
            var icon = isActive ? (state.direction === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
            return '<th class="sortable ' + (className || '') + '" data-sort="' + column + '" style="cursor: pointer;">' + label + ' <i class="fas ' + icon + ' text-muted"></i></th>';
        },

        sortData: function(data, state) {
            if (!state || !state.column || !data) return data || [];
            var col = state.column;
            var dir = state.direction === 'asc' ? 1 : -1;
            var self = this;
            
            return data.slice().sort(function(a, b) {
                var aVal = a[col];
                var bVal = b[col];
                
                // Custom ordering for tiers, risks, segments, grades
                if (col === 'tier' || col === 'clvTier') {
                    aVal = SORT_ORDERS.tier[(aVal || '').toLowerCase()] || 99;
                    bVal = SORT_ORDERS.tier[(bVal || '').toLowerCase()] || 99;
                } else if (col === 'riskLevel' || col === 'churnRisk') {
                    aVal = SORT_ORDERS.risk[(aVal || '').toLowerCase()] || 99;
                    bVal = SORT_ORDERS.risk[(bVal || '').toLowerCase()] || 99;
                } else if (col === 'rfmSegment' || col === 'segment') {
                    aVal = SORT_ORDERS.segment[(aVal || '').toLowerCase()] || 99;
                    bVal = SORT_ORDERS.segment[(bVal || '').toLowerCase()] || 99;
                } else if (col === 'healthGrade') {
                    aVal = SORT_ORDERS.grade[aVal] || 99;
                    bVal = SORT_ORDERS.grade[bVal] || 99;
                } else if (typeof aVal === 'string') {
                    return dir * (aVal || '').localeCompare(bVal || '');
                }
                
                return dir * ((aVal || 0) - (bVal || 0));
            });
        },

        renderPagination: function(totalItems, currentPage, pageSize, tableId) {
            var totalPages = Math.ceil(totalItems / pageSize);
            if (totalPages <= 1) return '';
            
            var start = (currentPage - 1) * pageSize + 1;
            var end = Math.min(currentPage * pageSize, totalItems);
            
            return '<div class="cv-pagination d-flex justify-content-between align-items-center p-3 border-top">' +
                '<div class="small text-muted">Showing ' + start + '-' + end + ' of ' + totalItems + '</div>' +
                '<div class="btn-group btn-group-sm">' +
                '<button class="btn btn-outline-secondary" ' + (currentPage <= 1 ? 'disabled' : '') + ' onclick="CustomerValueController.changePage(\'' + tableId + '\', ' + (currentPage - 1) + ')"><i class="fas fa-chevron-left"></i></button>' +
                '<span class="btn btn-outline-secondary disabled">' + currentPage + ' / ' + totalPages + '</span>' +
                '<button class="btn btn-outline-secondary" ' + (currentPage >= totalPages ? 'disabled' : '') + ' onclick="CustomerValueController.changePage(\'' + tableId + '\', ' + (currentPage + 1) + ')"><i class="fas fa-chevron-right"></i></button>' +
                '</div></div>';
        },

        changePage: function(tableId, newPage) {
            if (!this.pagination[tableId]) return;
            this.pagination[tableId].page = newPage;
            
            if (tableId === 'health') {
                el('#cvHealthTableContainer').innerHTML = this.renderHealthTable(this.healthCustomers);
                this.bindHealthSort();
            } else if (tableId === 'clv') {
                var clv = this.latestData.results.lifetimeValue || {};
                el('#cvCLVTableContainer').innerHTML = this.renderCLVTable(clv.customers || []);
                this.bindCLVSort();
            } else if (tableId === 'churn') {
                el('#cvChurnTableContainer').innerHTML = this.renderChurnTable(this.churnCustomers);
                this.bindChurnSort();
            } else if (tableId === 'segment') {
                el('#cvSegmentTableContainer').innerHTML = this.renderSegmentCustomersTable(this.segmentCustomers);
                this.bindSegmentSort();
            }
        },

        getGradeClass: function(grade) {
            if (!grade) return 'd';
            return grade.charAt(0).toLowerCase();
        },

        getAnalysisWindowLabel: function() {
            var select = el('#cvAnalysisWindow');
            if (select && select.selectedOptions && select.selectedOptions[0]) {
                return select.selectedOptions[0].text;
            }
            return 'Analysis period';
        },

        getSegmentBadge: function(segment) {
            var config = {
                champions: { class: 'cv-segment-champions', icon: 'fa-crown' },
                loyal: { class: 'cv-segment-loyal', icon: 'fa-heart' },
                potential: { class: 'cv-segment-potential', icon: 'fa-star' },
                new: { class: 'cv-segment-new', icon: 'fa-seedling' },
                hibernating: { class: 'cv-segment-hibernating', icon: 'fa-moon' },
                'at-risk': { class: 'cv-segment-at-risk', icon: 'fa-exclamation' },
                lost: { class: 'cv-segment-lost', icon: 'fa-times' }
            };
            var c = config[segment] || { class: 'cv-segment-lost', icon: 'fa-question' };
            return '<span class="cv-segment-badge ' + c.class + '"><i class="fas ' + c.icon + '"></i> ' + (segment || 'Unknown') + '</span>';
        },

        getTierBadge: function(tier) {
            var config = {
                platinum: { class: 'cv-tier-badge-platinum', icon: 'fa-gem' },
                gold: { class: 'cv-tier-badge-gold', icon: 'fa-medal' },
                silver: { class: 'cv-tier-badge-silver', icon: 'fa-award' },
                bronze: { class: 'cv-tier-badge-bronze', icon: 'fa-certificate' }
            };
            var c = config[tier] || { class: 'badge-secondary', icon: 'fa-circle' };
            return '<span class="cv-tier-badge ' + c.class + '"><i class="fas ' + c.icon + '"></i> ' + (tier || 'Unknown') + '</span>';
        },

        getRiskBadge: function(risk) {
            var config = {
                critical: { class: 'cv-risk-badge-critical' },
                high: { class: 'cv-risk-badge-high' },
                medium: { class: 'cv-risk-badge-medium' },
                low: { class: 'cv-risk-badge-low' }
            };
            var c = config[(risk || '').toLowerCase()] || { class: 'badge-secondary' };
            return '<span class="cv-risk-badge ' + c.class + '">' + (risk || 'Unknown') + '</span>';
        },

        getRecommendationBadge: function(rec) {
            var config = {
                nurture: { class: 'cv-rec-nurture', icon: 'fa-heart' },
                'win-back': { class: 'cv-rec-winback', icon: 'fa-undo' },
                winback: { class: 'cv-rec-winback', icon: 'fa-undo' },
                onboard: { class: 'cv-rec-onboard', icon: 'fa-handshake' },
                review: { class: 'cv-rec-review', icon: 'fa-search' },
                maintain: { class: 'cv-rec-maintain', icon: 'fa-check' },
                upsell: { class: 'cv-rec-upsell', icon: 'fa-arrow-up' }
            };
            var c = config[(rec || '').toLowerCase()] || { class: 'badge-secondary', icon: 'fa-question' };
            return '<span class="cv-rec-badge ' + c.class + '"><i class="fas ' + c.icon + '"></i> ' + (rec || 'N/A') + '</span>';
        },

        formatCurrency: function(num) {
            var isNegative = num < 0;
            num = Math.abs(num);
            var formatted;
            if (num >= 1000000) formatted = (num / 1000000).toFixed(1) + 'M';
            else if (num >= 1000) formatted = (num / 1000).toFixed(1) + 'K';
            else formatted = Math.round(num).toLocaleString();
            return (isNegative ? '-' : '') + this.currencySymbol + formatted;
        },

        formatNumber: function(num) {
            return (num || 0).toLocaleString();
        }
    };
    
    // escapeHtml is now provided globally by Gantry.Core.js (window.escapeHtml)
    // Removed local duplicate - use the global version which includes single-quote escaping

    // Register route with the Router
    Router.register('customervalue', function() {
        CustomerValueController.init();
    });
})();
