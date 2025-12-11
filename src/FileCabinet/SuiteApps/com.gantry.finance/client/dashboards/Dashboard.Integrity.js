/**
 * Dashboard.Integrity.js
 * Transaction Integrity Dashboard Controller - NEXT-LEVEL UPGRADE
 * "Always-On Auditor" - Enterprise Forensic Intelligence Platform
 * 
 * WORLD-CLASS Features:
 * - Benford's Law Analysis (1D + 2D First-Two Digits)
 * - SQL-Based Duplicate Detection (100k+ rows)
 * - Relative Size Factor (RSF) - Largest vs Second per Vendor
 * - Z-Score per Vendor - Entity-Specific Baselines
 * - Sequential Invoice Detection - Shell Company Indicator
 * - Ghost Vendor Detection - Address Match with Employees
 * - Weekend Entry Monitoring with User Analysis
 * - Audit Flag Workflow Management
 * - Sankey Diagram - User → Type → Vendor Flow
 * - Z-Score Scatter Plot Visualization
 * - Interactive Risk Heatmap
 * - Executive Summary & AI Insights
 * - Full Configuration Panel with Exclusions
 */
(function(window) {
    'use strict';

    const IntegrityController = {
        _version: 'v2.3-benford2d-system',  // Version marker to verify deployment
        latestData: null,
        subsidiaries: [],
        subsidiaryId: null,
        activeTab: 'overview',
        configData: null,
        filters: {
            flagType: 'all',
            riskLevel: 'all',
            minAmount: 0,
            searchQuery: ''
        },
        groupBy: {
            duplicates: 'vendor',
            weekend: 'user'
        },
        pagination: {
            flagged: { page: 1, pageSize: 25 },
            duplicates: { page: 1, pageSize: 20 },
            weekend: { page: 1, pageSize: 25 },
            vendors: { page: 1, pageSize: 15 },
            users: { page: 1, pageSize: 15 },
            rsf: { page: 1, pageSize: 20 },
            zscore: { page: 1, pageSize: 20 },
            sequential: { page: 1, pageSize: 15 },
            ghost: { page: 1, pageSize: 15 },
            audittrail: { page: 1, pageSize: 50 }
        },
        auditTrailFilters: {
            recordType: 'all',
            riskLevel: 'all',
            searchQuery: ''
        },
        auditTrailSort: { column: 'riskScore', direction: 'desc' },
        colors: {
            critical: '#dc2626',
            high: '#ea580c',
            medium: '#f59e0b',
            low: '#10b981',
            info: '#3b82f6',
            purple: '#8b5cf6',
            pink: '#ec4899',
            slate: '#64748b'
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
            
            var subsidiaryEl = el("#integritySubsidiary");
            if (subsidiaryEl) {
                subsidiaryEl.addEventListener("change", function(e) {
                    self.subsidiaryId = e.target.value;
                    self.loadData();
                });
            }
            
            var btnApply = el("#integrityApplyRange");
            if (btnApply) btnApply.addEventListener("click", function() { self.applyRange(); });

            if (window.jQuery) {
                // Main tabs and dropdown items
                $('#integrityTabs a[data-toggle="tab"]').on('click', function (e) {
                    e.preventDefault();
                    $(this).tab('show');
                });
                
                // Tab show events - Analysis tabs
                jQuery(document).on("shown.bs.tab", "#integrity-heatmap-tab", function() { self.renderFullHeatmap(); });
                jQuery(document).on("shown.bs.tab", "#integrity-benford-tab", function() { self.renderBenfordTab(); });
                jQuery(document).on("shown.bs.tab", "#integrity-rsf-tab", function() { self.renderRSFTab(); });
                jQuery(document).on("shown.bs.tab", "#integrity-zscore-tab", function() { self.renderZScoreTab(); });
                
                // Tab show events - Detection tabs
                jQuery(document).on("shown.bs.tab", "#integrity-flagged-tab", function() { self.renderAllFlaggedTab(); });
                jQuery(document).on("shown.bs.tab", "#integrity-duplicates-tab", function() { self.renderDuplicatesTab(); });
                jQuery(document).on("shown.bs.tab", "#integrity-weekend-tab", function() { self.renderWeekendTab(); });
                jQuery(document).on("shown.bs.tab", "#integrity-ghost-tab", function() { self.renderGhostTab(); });
                jQuery(document).on("shown.bs.tab", "#integrity-sequential-tab", function() { self.renderSequentialTab(); });
                jQuery(document).on("shown.bs.tab", "#integrity-vendors-tab", function() { self.renderVendorAnalysisTab(); });
                jQuery(document).on("shown.bs.tab", "#integrity-users-tab", function() { self.renderUserAnalysisTab(); });
                
                // Other tabs
                jQuery(document).on("shown.bs.tab", "#integrity-audittrail-tab", function() { self.renderAuditTrailTab(); });
                jQuery(document).on("shown.bs.tab", "#integrity-config-tab", function() { self.renderConfigTab(); });
            }

            if (window.jQuery && jQuery().tooltip) {
                jQuery('[data-toggle="tooltip"]').tooltip();
            }
        },
        
        showLoadingState: function() {
            // Show skeleton for Risk Score gauge
            var gaugeEl = el('#integrityRiskGauge');
            if (gaugeEl) {
                gaugeEl.innerHTML = '<div class="icon-wrapper bg-gray-soft">' + Skeleton.render('custom', { width: '24px', height: '24px', borderRadius: '50%' }) + '</div><div class="kpi-content"><span class="kpi-label">Risk Score</span><div class="kpi-main-row">' + Skeleton.render('custom', { width: '50px', height: '1.8rem' }) + '</div><span class="kpi-sub">' + Skeleton.render('custom', { width: '70px', height: '0.8rem' }) + '</span></div>';
            }
            
            var kpiIds = ['INT_FlaggedCount', 'INT_DuplicateRisk', 'INT_WeekendCount', 'INT_TotalAtRisk', 'INT_GhostCount', 'INT_SequentialCount'];
            kpiIds.forEach(function(id) {
                var el_ = el('#' + id);
                if (el_) el_.innerHTML = Skeleton.render('custom', { width: '70px', height: '1.5rem' });
            });
            
            var summaryEl = el("#integrityExecutiveSummary");
            if (summaryEl) summaryEl.innerHTML = Skeleton.render('chart', { height: '150px' });
            
            var heatmapEl = el("#integrityOverviewHeatmap");
            if (heatmapEl) heatmapEl.innerHTML = Skeleton.render('chart', { height: '100px' });
            
            ['integrityTopFlagged'].forEach(function(id) {
                var body = el('#' + id);
                if (body) {
                    var html = '';
                    for (var r = 0; r < 5; r++) {
                        html += '<tr>';
                        for (var c = 0; c < 6; c++) {
                            html += '<td>' + Skeleton.render('custom', { width: c === 0 ? '100px' : '60px', height: '0.8rem' }) + '</td>';
                        }
                        html += '</tr>';
                    }
                    body.innerHTML = html;
                }
            });
        },
        
        loadConfig: function() {
            var self = this;
            API.get('integrity_config').then(function(res) {
                self.subsidiaries = res.subsidiaries || [];
                self.renderSubsidiaryDropdown();
                self.configData = res.config || self.getDefaultConfig();
                
                // If the config response includes users/vendors/accounts, use them
                if (res.users && res.users.length > 0) {
                    self.exclusionOptions = {
                        vendors: res.vendors || [],
                        accounts: res.accounts || [],
                        users: res.users || [],
                        tranTypes: res.transactionTypes || [
                            { id: 'VendBill', name: 'Vendor Bill' },
                            { id: 'Check', name: 'Check' },
                            { id: 'VendPymt', name: 'Vendor Payment' },
                            { id: 'ExpRept', name: 'Expense Report' },
                            { id: 'Journal', name: 'Journal Entry' },
                            { id: 'VendCred', name: 'Vendor Credit' }
                        ]
                    };
                    self.loadData();
                } else {
                    // Fetch exclusion options from the data endpoint
                    API.post('integrity', { subAction: 'get_exclusion_options' }).then(function(optsRes) {
                        var opts = (optsRes && optsRes.data) || optsRes || {};
                        self.exclusionOptions = {
                            vendors: opts.vendors || res.vendors || [],
                            accounts: opts.accounts || res.accounts || [],
                            users: opts.users || res.users || [],
                            tranTypes: opts.tranTypes || res.transactionTypes || [
                                { id: 'VendBill', name: 'Vendor Bill' },
                                { id: 'Check', name: 'Check' },
                                { id: 'VendPymt', name: 'Vendor Payment' },
                                { id: 'ExpRept', name: 'Expense Report' },
                                { id: 'Journal', name: 'Journal Entry' },
                                { id: 'VendCred', name: 'Vendor Credit' }
                            ]
                        };
                        self.loadData();
                    }).catch(function(e2) {
                        console.warn('Could not load exclusion options', e2);
                        self.exclusionOptions = { vendors: [], accounts: [], users: [], tranTypes: [] };
                        self.loadData();
                    });
                }
            }).catch(function(e) {
                console.error("Integrity config load error", e);
                self.configData = self.getDefaultConfig();
                self.exclusionOptions = { vendors: [], accounts: [], users: [], tranTypes: [] };
                self.loadData();
            });
        },
        
        getDefaultConfig: function() {
            return {
                duplicateThresholdDays: 14,
                duplicateMinAmount: 100,
                benfordMinTransactions: 50,
                weekendHighRiskAmount: 5000,
                approvalThreshold: 5000,
                highRiskAmount: 10000,
                criticalRiskAmount: 25000,
                zScoreThreshold: 3,
                rsfThreshold: 10,
                sequentialMinCount: 3,
                sequentialMaxDays: 30,
                excludedVendors: [],
                excludedAccounts: [],
                excludedUsers: [],
                excludedTranTypes: [],
                excludeSystemUsers: true,  // Exclude system-generated weekend transactions
                enableBenford: true,
                enableBenford2D: true,
                enableDuplicates: true,
                enableWeekend: true,
                enableRoundAmount: true,
                enableThresholdSplit: true,
                enableRSF: true,
                enableZScore: true,
                enableSequential: true,
                enableGhost: true
            };
        },
        
        renderSubsidiaryDropdown: function() {
            var sel = el("#integritySubsidiary");
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

        loadData: function(start, end) {
            var self = this;
            var params = {};
            if (start) params.startDate = start;
            if (end) params.endDate = end;
            if (this.subsidiaryId) params.subsidiary = this.subsidiaryId;
            
            API.get('integrity', params).then(function(data) {
                self.latestData = data;
                self.render(data);
            }).catch(function(e) {
                console.error("Integrity load error", e);
                el('#gantry-view-container').innerHTML = ErrorBoundary.renderError(e, {
                    title: 'Failed to Load Transaction Integrity Dashboard',
                    retryAction: "IntegrityController.init()"
                });
            });
        },

        applyRange: function() {
            var start = el("#integrityStartDate").value;
            var end = el("#integrityEndDate").value;
            this.loadData(start, end);
        },

        render: function(data) {
            var meta = data.meta || {};
            var summary = data.summary || {};
            
            if (!data.vendorRiskAnalysis && data.flaggedTransactions && data.flaggedTransactions.length > 0) {
                data.vendorRiskAnalysis = this.generateVendorRiskAnalysis(data.flaggedTransactions);
            }
            
            if (meta.range) {
                el("#integrityStartDate").value = meta.range.start;
                el("#integrityEndDate").value = meta.range.end;
            }

            this.renderRiskGauge(summary.overallRiskScore || 0);
            
            this.setSafeText("#INT_FlaggedCount", (summary.flaggedCount || 0).toLocaleString());
            this.setSafeText("#INT_DuplicateCount", (summary.duplicateCount || 0).toLocaleString());
            this.setSafeText("#INT_DuplicateRisk", fmtMoney(summary.totalDuplicateAmount || 0));
            this.setSafeText("#INT_WeekendCount", (summary.weekendEntryCount || 0).toLocaleString());
            this.setSafeText("#INT_WeekendAmount", fmtMoney(summary.weekendAmount || 0));
            this.setSafeText("#INT_TotalAtRisk", fmtMoney(summary.totalAtRisk || 0));
            this.setSafeText("#INT_PercentAtRisk", (summary.percentAtRisk || 0).toFixed(1) + '%');
            this.setSafeText("#INT_GhostCount", (summary.ghostVendorCount || 0).toLocaleString());
            this.setSafeText("#INT_SequentialCount", (summary.sequentialInvoiceGroups || 0).toLocaleString());
            this.setSafeText("#INT_RSFCount", (summary.rsfAnomalyCount || 0).toLocaleString());
            this.setSafeText("#INT_ZScoreCount", (summary.zScoreAnomalyCount || 0).toLocaleString());
            this.setSafeText("#INT_Benford2D", summary.benford2DConformity || 'N/A');
            
            this.renderExecutiveSummary(data);
            this.renderMiniDistribution();
            this.renderRiskAreas(summary.topRiskAreas || []);
            var recs = (data.aiPrepContext && data.aiPrepContext.recommendations) ? data.aiPrepContext.recommendations : [];
            this.renderRecommendations(recs);
            this.renderTopFlagged(data.flaggedTransactions || []);
            this.renderCriticalAlerts(data);
        },
        
        generateVendorRiskAnalysis: function(flagged) {
            var vendorMap = {};
            var vendorTranTypes = ['Bill', 'VendBill', 'Vendor Bill', 'VendorBill', 'Check', 'Bill Payment', 'VendPymt', 'Vendor Payment', 'Vendor Credit', 'VendCred', 'Credit Memo', 'Expense Report', 'ExpRept', 'Purchase Order', 'PurchOrd', 'Item Receipt', 'ItemRcpt'];
            
            flagged.forEach(function(f) {
                var tranType = (f.type || f.tranType || '').toLowerCase();
                var isVendorTran = vendorTranTypes.some(function(vt) { return tranType.indexOf(vt.toLowerCase()) > -1; });
                if (!isVendorTran) return;
                var vendorId = f.vendorId || f.entityId || null;
                var vendor = f.entityName || 'Unknown Vendor';
                var key = vendorId ? String(vendorId) : vendor; // Use vendorId as key if available
                if (!vendorMap[key]) {
                    vendorMap[key] = { vendorId: vendorId, vendorName: vendor, flagCount: 0, totalAmount: 0, transactionCount: 0, flagTypes: [], flagTypeSet: {}, riskScore: 0 };
                }
                vendorMap[key].flagCount++;
                vendorMap[key].totalAmount += Math.abs(f.amount || 0);
                vendorMap[key].transactionCount++;
                // Update vendorId if we find one (in case first entry didn't have it)
                if (vendorId && !vendorMap[key].vendorId) {
                    vendorMap[key].vendorId = vendorId;
                }
                if (f.flagType && !vendorMap[key].flagTypeSet[f.flagType]) {
                    vendorMap[key].flagTypeSet[f.flagType] = true;
                    vendorMap[key].flagTypes.push(f.flagType);
                }
            });
            
            var vendors = Object.keys(vendorMap).map(function(key) {
                var v = vendorMap[key];
                var flagScore = Math.min(v.flagCount * 10, 40);
                var amountScore = v.totalAmount >= 50000 ? 30 : v.totalAmount >= 10000 ? 20 : v.totalAmount >= 1000 ? 10 : 5;
                var varietyScore = v.flagTypes.length * 10;
                v.riskScore = Math.min(flagScore + amountScore + varietyScore, 100);
                delete v.flagTypeSet;
                return v;
            });
            vendors.sort(function(a, b) { return b.riskScore - a.riskScore; });
            return vendors;
        },

        renderRiskGauge: function(score) {
            var gaugeEl = el("#integrityRiskGauge");
            if (!gaugeEl) return;
            var label = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
            var textClass = score >= 70 ? 'text-danger' : score >= 40 ? 'text-warning' : 'text-success';
            // Use HealthGauge.generateSemi like Health Dashboard - thresholds inverted (lower is better for risk)
            var meterHtml = '';
            if (typeof HealthGauge !== 'undefined') {
                meterHtml = HealthGauge.generateSemi(100 - score, { width: 100, height: 55, strokeWidth: 10, showValue: false, thresholds: { good: 60, warning: 30 } });
            }
            gaugeEl.innerHTML = '<div class="risk-meter-kpi"><div class="risk-meter-gauge">' + meterHtml + '</div><div class="risk-meter-info"><span class="risk-meter-value ' + textClass + '">' + score + '</span><span class="risk-meter-label ' + textClass + '">' + label + ' RISK</span></div></div>';
        },

        renderCriticalAlerts: function(data) {
            var container = el("#integrityCriticalAlerts");
            if (!container) return;
            var alerts = [];
            // Only show Ghost Vendors alert - removed Sequential Invoice Pattern and Approval Limit alerts
            if (data.ghostVendors && data.ghostVendors.length > 0) {
                alerts.push({ type: 'critical', icon: 'user-secret', title: 'Ghost Vendors Detected', message: data.ghostVendors.length + ' vendor(s) share addresses with employees', action: 'Review', actionTarget: 'forensic' });
            }
            if (alerts.length === 0) { container.style.display = 'none'; return; }
            container.style.display = 'block';
            container.innerHTML = alerts.map(function(a) {
                var colorClass = a.type === 'critical' ? 'alert-critical' : a.type === 'high' ? 'alert-high' : 'alert-medium';
                return '<div class="integrity-alert ' + colorClass + '"><div class="ia-icon"><i class="fas fa-' + a.icon + '"></i></div><div class="ia-content"><div class="ia-title">' + a.title + '</div><div class="ia-message">' + a.message + '</div></div><button class="ia-action" onclick="jQuery(\'#integrity-' + a.actionTarget + '-tab\').tab(\'show\')">' + a.action + ' →</button></div>';
            }).join('');
        },

        renderExecutiveSummary: function(data) {
            var container = el("#integrityExecutiveSummary");
            if (!container) return;
            var summary = data.summary || {};
            var duplicateSavings = summary.totalDuplicateAmount || 0;
            var ghostCount = summary.ghostVendorCount || 0;
            var seqCount = summary.sequentialInvoiceGroups || 0;
            var rsfCount = summary.rsfAnomalyCount || 0;
            var zscoreCount = summary.zScoreAnomalyCount || 0;
            
            // Six cards in a full-width grid (no Control Assessment - score is shown above)
            container.innerHTML = '<div class="exec-stats-grid exec-stats-full">' +
                '<div class="exec-stat-card"><div class="exec-stat-icon purple"><i class="fas fa-copy"></i></div><div class="exec-stat-content"><span class="exec-stat-value">' + fmtMoney(duplicateSavings) + '</span><span class="exec-stat-label">Duplicate Risk</span></div></div>' +
                '<div class="exec-stat-card"><div class="exec-stat-icon blue"><i class="fas fa-calendar-times"></i></div><div class="exec-stat-content"><span class="exec-stat-value">' + (summary.weekendEntryCount || 0) + '</span><span class="exec-stat-label">Weekend Entries</span></div></div>' +
                '<div class="exec-stat-card ' + (ghostCount > 0 ? 'danger-pulse' : '') + '"><div class="exec-stat-icon ' + (ghostCount > 0 ? 'red' : 'green') + '"><i class="fas fa-user-secret"></i></div><div class="exec-stat-content"><span class="exec-stat-value">' + ghostCount + '</span><span class="exec-stat-label">Ghost Vendors</span></div></div>' +
                '<div class="exec-stat-card"><div class="exec-stat-icon ' + (seqCount > 0 ? 'orange' : 'green') + '"><i class="fas fa-sort-numeric-down"></i></div><div class="exec-stat-content"><span class="exec-stat-value">' + seqCount + '</span><span class="exec-stat-label">Sequential Patterns</span></div></div>' +
                '<div class="exec-stat-card"><div class="exec-stat-icon indigo"><i class="fas fa-chart-line"></i></div><div class="exec-stat-content"><span class="exec-stat-value">' + rsfCount + '</span><span class="exec-stat-label">RSF Anomalies</span></div></div>' +
                '<div class="exec-stat-card"><div class="exec-stat-icon ' + (summary.benfordConformity === 'Acceptable' || summary.benfordConformity === 'Excellent' ? 'green' : 'orange') + '"><i class="fas fa-chart-bar"></i></div><div class="exec-stat-content"><span class="exec-stat-value">' + (summary.benfordConformity || 'N/A') + '</span><span class="exec-stat-label">Benford Status</span></div></div>' +
                '</div>';
        },

        renderMiniDistribution: function() {
            var container = el("#integrityOverviewHeatmap");
            if (!container || !this.latestData) return;
            var flagged = this.latestData.flaggedTransactions || [];
            var self = this;
            var typeDistribution = {};
            flagged.forEach(function(f) { var type = f.flagType || 'Other'; typeDistribution[type] = (typeDistribution[type] || 0) + 1; });
            var maxCount = Math.max.apply(null, Object.values(typeDistribution).concat([1]));
            var sorted = Object.entries(typeDistribution).sort(function(a,b) { return b[1] - a[1]; }).slice(0, 8);
            var barsHtml = sorted.map(function(item) {
                var type = item[0]; var count = item[1]; var pct = (count / maxCount) * 100; var color = self.getFlagColor(type);
                return '<div class="distrib-bar-row"><span class="distrib-label">' + self.shortenFlagType(type) + '</span><div class="distrib-track"><div class="distrib-fill" style="width: ' + pct + '%; background: ' + color + ';"></div></div><span class="distrib-count">' + count + '</span></div>';
            }).join('');
            container.innerHTML = '<div class="mini-distribution"><div class="distrib-bars">' + barsHtml + '</div><div class="distrib-summary"><span>' + flagged.length + ' total flags across ' + Object.keys(typeDistribution).length + ' categories</span></div></div>';
        },

        shortenFlagType: function(type) {
            if (!type) return 'Flag';
            // Strip any numeric values that might be appended (e.g. "Benford 56.73...")
            var cleanType = String(type).replace(/\s+[\d.]+$/, '').trim();
            var map = { 'duplicate': 'Duplicate', 'Duplicate Detection': 'Duplicate', 'weekend': 'Weekend', 'Weekend Entry': 'Weekend', 'threshold': 'Threshold', 'Threshold Split': 'Threshold', 'timing': 'Timing', 'Unusual Timing': 'Timing', 'round': 'Round Amt', 'Round Amount': 'Round Amt', 'benford': 'Benford', 'Benford Anomaly': 'Benford', 'Benford': 'Benford', 'rsf': 'RSF', 'zscore': 'Z-Score', 'sequential': 'Sequential', 'ghost': 'Ghost', 'Weekend': 'Weekend' };
            return map[cleanType] || map[cleanType.toLowerCase()] || cleanType;
        },

        getFlagColor: function(type) {
            if (!type) return '#6b7280';
            var cleanType = String(type).replace(/\s+[\d.]+$/, '').trim().toLowerCase();
            var colors = { 'duplicate': '#8b5cf6', 'duplicate detection': '#8b5cf6', 'weekend': '#3b82f6', 'weekend entry': '#3b82f6', 'threshold': '#f59e0b', 'threshold split': '#f59e0b', 'timing': '#6366f1', 'unusual timing': '#6366f1', 'round': '#ec4899', 'round amount': '#ec4899', 'benford': '#ef4444', 'benford anomaly': '#ef4444', 'rsf': '#14b8a6', 'zscore': '#f97316', 'sequential': '#dc2626', 'ghost': '#991b1b' };
            return colors[cleanType] || '#6b7280';
        },

        renderTopFlagged: function(flagged) {
            var body = el("#integrityTopFlagged");
            if (!body) return;
            var self = this;
            if (!flagged || flagged.length === 0) {
                body.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-check-circle text-success fa-2x mb-2"></i><br>No flagged transactions</td></tr>';
                return;
            }
            var sorted = flagged.slice().sort(function(a, b) { return (b.riskScore || 0) - (a.riskScore || 0); });
            body.innerHTML = sorted.slice(0, 8).map(function(f) {
                var severity = self.getSeverityClass(f.riskScore);
                return '<tr class="flagged-row"><td><span class="severity-dot ' + severity + '"></span></td><td>' + f.tranDate + '</td><td>' + getNsLink(f.tranId || 'N/A', f.id) + '</td><td class="text-right font-weight-bold">' + fmtMoney(f.amount, 2) + '</td><td>' + self.getFlagPill(f.flagType) + '</td><td class="small text-truncate" style="max-width: 180px;" title="' + f.reason + '">' + f.reason + '</td></tr>';
            }).join('');
        },

        getSeverityClass: function(score) {
            if (score >= 80) return 'sev-critical';
            if (score >= 60) return 'sev-high';
            if (score >= 40) return 'sev-medium';
            return 'sev-low';
        },

        getFlagPill: function(flagType) {
            if (!flagType) return '<span class="flag-pill flag-secondary"><i class="fas fa-flag"></i>Flag</span>';
            var cleanType = String(flagType).replace(/\s+[\d.]+$/, '').trim().toLowerCase();
            var configs = { 'benford': { icon: 'chart-bar', color: 'danger' }, 'benford anomaly': { icon: 'chart-bar', color: 'danger' }, 'duplicate': { icon: 'copy', color: 'purple' }, 'duplicate detection': { icon: 'copy', color: 'purple' }, 'weekend': { icon: 'calendar-week', color: 'info' }, 'weekend entry': { icon: 'calendar-week', color: 'info' }, 'round': { icon: 'dollar-sign', color: 'pink' }, 'round amount': { icon: 'dollar-sign', color: 'pink' }, 'threshold': { icon: 'cut', color: 'warning' }, 'threshold split': { icon: 'cut', color: 'warning' }, 'timing': { icon: 'clock', color: 'indigo' }, 'unusual timing': { icon: 'clock', color: 'indigo' }, 'rsf': { icon: 'chart-line', color: 'teal' }, 'zscore': { icon: 'superscript', color: 'orange' }, 'sequential': { icon: 'sort-numeric-down', color: 'danger' }, 'ghost': { icon: 'user-secret', color: 'danger' } };
            var cfg = configs[cleanType] || { icon: 'flag', color: 'secondary' };
            return '<span class="flag-pill flag-' + cfg.color + '"><i class="fas fa-' + cfg.icon + '"></i>' + this.shortenFlagType(flagType) + '</span>';
        },

        renderRiskAreas: function(areas) {
            var container = el("#integrityRiskAreas");
            if (!container) return;
            if (!areas || areas.length === 0) {
                container.innerHTML = '<div class="risk-item risk-ok"><i class="fas fa-check-circle"></i><span>No significant risk areas</span></div>';
                return;
            }
            container.innerHTML = areas.map(function(a) {
                var cls = a.severity === 'critical' ? 'risk-critical' : a.severity === 'high' ? 'risk-high' : a.severity === 'medium' ? 'risk-medium' : 'risk-info';
                var icon = a.severity === 'critical' ? 'skull-crossbones' : a.severity === 'high' ? 'exclamation-circle' : a.severity === 'medium' ? 'exclamation-triangle' : 'info-circle';
                return '<div class="risk-item ' + cls + '"><i class="fas fa-' + icon + '"></i><div class="risk-item-content"><span class="risk-item-title">' + a.area + '</span>' + (a.message ? '<span class="risk-item-message">' + a.message + '</span>' : '') + '</div></div>';
            }).join('');
        },

        renderRecommendations: function(recs) {
            var container = el("#integrityRecommendations");
            if (!container) return;
            if (!recs || recs.length === 0) {
                container.innerHTML = '<div class="rec-item"><i class="fas fa-thumbs-up text-success"></i><span>No immediate actions required</span></div>';
                return;
            }
            container.innerHTML = recs.map(function(r) {
                var priority = r.priority || 'medium';
                var cls = priority === 'critical' ? 'rec-critical' : priority === 'high' ? 'rec-high' : priority === 'medium' ? 'rec-medium' : 'rec-low';
                return '<div class="rec-item ' + cls + '"><span class="rec-badge">' + priority.charAt(0).toUpperCase() + '</span><div class="rec-content"><span class="rec-title">' + (r.title || r.action) + '</span>' + (r.description ? '<span class="rec-desc">' + r.description + '</span>' : '') + '</div></div>';
            }).join('');
        },

        renderPagination: function(totalItems, currentPage, pageSize, tableId) {
            var totalPages = Math.ceil(totalItems / pageSize);
            if (totalPages <= 1) return '';
            var start = (currentPage - 1) * pageSize + 1;
            var end = Math.min(currentPage * pageSize, totalItems);
            return '<div class="pagination-wrapper" data-table="' + tableId + '"><div class="pag-info">Showing ' + start + '-' + end + ' of ' + totalItems + '</div><div class="pag-controls"><button class="pag-btn" ' + (currentPage <= 1 ? 'disabled' : '') + ' onclick="IntegrityController.changePage(\'' + tableId + '\', ' + (currentPage - 1) + ')"><i class="fas fa-chevron-left"></i></button><span class="pag-current">' + currentPage + ' / ' + totalPages + '</span><button class="pag-btn" ' + (currentPage >= totalPages ? 'disabled' : '') + ' onclick="IntegrityController.changePage(\'' + tableId + '\', ' + (currentPage + 1) + ')"><i class="fas fa-chevron-right"></i></button></div></div>';
        },
        
        changePage: function(tableId, newPage) {
            if (!this.pagination[tableId]) return;
            this.pagination[tableId].page = newPage;
            var renderMap = { 'flagged': 'renderAllFlaggedTab', 'duplicates': 'renderDuplicatesTab', 'weekend': 'renderWeekendTab', 'vendors': 'renderVendorAnalysisTab', 'users': 'renderUserAnalysisTab', 'rsf': 'renderRSFTab', 'zscore': 'renderZScoreTab', 'audittrail': 'renderAuditTrailTab', 'ghost': 'renderGhostTab', 'sequential': 'renderSequentialTab' };
            if (renderMap[tableId]) this[renderMap[tableId]]();
        },

        // ============ UNIFIED UI COMPONENTS ============
        
        buildKPIRow: function(kpis) {
            // kpis: [{label, value, icon, color?, subtext?}]
            return '<div class="row kpi-row mb-2">' + kpis.map(function(k) {
                var colorClass = k.color ? 'kpi-' + k.color : '';
                return '<div class="col"><div class="cf-kpi-card ' + colorClass + '">' +
                    '<div class="kpi-icon"><i class="fas fa-' + k.icon + '"></i></div>' +
                    '<div class="kpi-content">' +
                        '<div class="kpi-value">' + k.value + '</div>' +
                        '<div class="kpi-label">' + k.label + '</div>' +
                        (k.subtext ? '<div class="kpi-subtext">' + k.subtext + '</div>' : '') +
                    '</div>' +
                '</div></div>';
            }).join('') + '</div>';
        },

        // Unified flyout KPI renderer - uses inline flex to avoid CSS conflicts
        buildFlyoutKPIs: function(kpis) {
            // kpis: [{label, value, icon, color?}]
            var colorMap = {
                'danger': { bg: '#fef2f2', icon: '#ef4444' },
                'warning': { bg: '#fffbeb', icon: '#f59e0b' },
                'success': { bg: '#f0fdf4', icon: '#22c55e' },
                'info': { bg: '#eff6ff', icon: '#3b82f6' },
                'primary': { bg: '#eef2ff', icon: '#6366f1' },
                'purple': { bg: '#faf5ff', icon: '#a855f7' }
            };
            
            var cardStyle = 'flex: 1; display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #fff; border-radius: 8px; min-width: 0;';
            var iconStyle = 'width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';
            var labelStyle = 'font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;';
            var valueStyle = 'font-size: 1.1rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
            
            return '<div style="display: flex; gap: 12px; padding: 12px 16px; background: #f8fafc; flex-wrap: wrap;">' + 
                kpis.map(function(k) {
                    var colors = colorMap[k.color] || colorMap['primary'];
                    return '<div style="' + cardStyle + '">' +
                        '<div style="' + iconStyle + ' background: ' + colors.bg + ';">' +
                            '<i class="fas fa-' + (k.icon || 'info-circle') + '" style="color: ' + colors.icon + '; font-size: 16px;"></i>' +
                        '</div>' +
                        '<div style="min-width: 0; flex: 1;">' +
                            '<div style="' + labelStyle + '">' + k.label + '</div>' +
                            '<div style="' + valueStyle + ' color: ' + colors.icon + ';">' + k.value + '</div>' +
                        '</div>' +
                    '</div>';
                }).join('') + '</div>';
        },

        buildDataTable: function(config) {
            // config: { tableId, columns, data, onRowClick, emptyIcon, emptyMessage, pagination }
            var self = this;
            var tableId = config.tableId;
            var columns = config.columns || [];
            var data = config.data || [];
            var pag = config.pagination || this.pagination[tableId] || { page: 1, pageSize: 20 };
            
            if (data.length === 0) {
                return '<div class="empty-state"><i class="fas fa-' + (config.emptyIcon || 'check-circle') + ' text-success fa-3x mb-3"></i><h5>' + (config.emptyMessage || 'No data') + '</h5></div>';
            }
            
            // Sort data
            var sortCol = config.sortCol || columns[0].key;
            var sortDir = config.sortDir || 'desc';
            var sortedData = data.slice().sort(function(a, b) {
                var aVal = a[sortCol], bVal = b[sortCol];
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
                }
                aVal = String(aVal || '').toLowerCase();
                bVal = String(bVal || '').toLowerCase();
                return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            });
            
            // Paginate
            var startIdx = (pag.page - 1) * pag.pageSize;
            var pageData = sortedData.slice(startIdx, startIdx + pag.pageSize);
            
            // Build header
            var headerHtml = '<tr>' + columns.map(function(col) {
                var sortable = col.sortable !== false;
                var isActive = sortCol === col.key;
                var sortIcon = isActive ? (sortDir === 'asc' ? 'sort-up' : 'sort-down') : 'sort';
                var alignClass = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : '';
                var sortClick = sortable ? ' onclick="IntegrityController.sortTable(\'' + tableId + '\', \'' + col.key + '\')" style="cursor:pointer;"' : '';
                return '<th class="' + alignClass + '"' + sortClick + '>' + col.label + (sortable ? ' <i class="fas fa-' + sortIcon + ' sort-icon' + (isActive ? ' active' : '') + '"></i>' : '') + '</th>';
            }).join('') + '</tr>';
            
            // Build rows
            var rowsHtml = pageData.map(function(row, idx) {
                var rowClick = config.onRowClick ? ' class="clickable-row" onclick="' + config.onRowClick.replace('{row}', JSON.stringify(row).replace(/"/g, '&quot;')) + '"' : '';
                return '<tr' + rowClick + '>' + columns.map(function(col) {
                    var val = col.render ? col.render(row[col.key], row, idx) : (row[col.key] || '-');
                    var alignClass = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : '';
                    return '<td class="' + alignClass + '">' + val + '</td>';
                }).join('') + '</tr>';
            }).join('');
            
            return '<div class="table-responsive"><table class="table table-sm table-hover" id="' + tableId + 'Table">' +
                '<thead>' + headerHtml + '</thead>' +
                '<tbody>' + rowsHtml + '</tbody>' +
                '</table></div>' + this.renderPagination(data.length, pag.page, pag.pageSize, tableId);
        },

        sortTable: function(tableId, column) {
            // Toggle sort direction if same column, otherwise default to desc
            var currentSort = this.tableSort || {};
            if (!currentSort[tableId]) currentSort[tableId] = { col: column, dir: 'desc' };
            
            if (currentSort[tableId].col === column) {
                currentSort[tableId].dir = currentSort[tableId].dir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort[tableId] = { col: column, dir: 'desc' };
            }
            this.tableSort = currentSort;
            
            // Reset to page 1 and re-render
            if (this.pagination[tableId]) this.pagination[tableId].page = 1;
            var renderMap = { 'flagged': 'renderAllFlaggedTab', 'duplicates': 'renderDuplicatesTab', 'weekend': 'renderWeekendTab', 'vendors': 'renderVendorAnalysisTab', 'users': 'renderUserAnalysisTab', 'rsf': 'renderRSFTab', 'zscore': 'renderZScoreTab', 'audittrail': 'renderAuditTrailTab', 'ghost': 'renderGhostTab', 'sequential': 'renderSequentialTab' };
            if (renderMap[tableId]) this[renderMap[tableId]]();
        },

        // ============ UNIFIED FLYOUT SYSTEM ============
        
        openEntityFlyout: function(entityType, entityId, entityName) {
            var self = this;
            var flyout = document.getElementById('atFlyout');
            if (!flyout) { console.error('Flyout not found'); return; }
            
            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');
            
            document.getElementById('atFlyoutTitle').textContent = entityName || (entityType + ' #' + entityId);
            var _sub = document.getElementById('atFlyoutSubtitle'); _sub.textContent = 'Loading transactions...'; _sub.style.display = _sub.textContent ? 'block' : 'none';
            document.getElementById('atFlyoutStats').innerHTML = '';
            document.getElementById('atFlyoutBody').innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading transactions...</div></div>';
            
            var startDate = el('#integrityStartDate');
            var endDate = el('#integrityEndDate');
            startDate = startDate ? startDate.value : '';
            endDate = endDate ? endDate.value : '';
            
            var subAction = entityType === 'vendor' ? 'vendor_transactions' : 'user_transactions';
            var params = {
                subAction: subAction,
                startDate: startDate,
                endDate: endDate,
                subsidiaryId: self.subsidiaryId || ''
            };
            
            if (entityType === 'vendor') {
                params.vendorId = entityId;
            } else {
                params.userId = entityId;
            }
            
            API.post('integrity', params)
                .then(function(res) {
                    if (res.status === 'success' && res.transactions && res.transactions.length > 0) {
                        var transactions = res.transactions;
                        var total = transactions.reduce(function(s, t) { return s + (parseFloat(t.amount) || 0); }, 0);
                        
                        var _sub = document.getElementById('atFlyoutSubtitle'); _sub.style.display = 'none';
                        
                        document.getElementById('atFlyoutStats').innerHTML = IntegrityController.buildFlyoutKPIs([
                            { label: 'Total', value: fmtMoney(total), icon: 'dollar-sign', color: 'primary' },
                            { label: 'Count', value: transactions.length, icon: 'receipt', color: 'info' }
                        ]);
                        
                        var rowsHtml = transactions.map(function(t) {
                            return '<tr>' +
                                '<td>' + getNsLink(t.tranId || 'N/A', t.id) + '</td>' +
                                '<td>' + (t.type || '-') + '</td>' +
                                '<td>' + (t.tranDate || '-') + '</td>' +
                                '<td class="text-right font-weight-bold">' + fmtMoney(t.amount, 2) + '</td>' +
                            '</tr>';
                        }).join('');
                        
                        document.getElementById('atFlyoutBody').innerHTML = 
                            '<table class="table table-sm table-hover">' +
                            '<thead><tr><th>Tran #</th><th>Type</th><th>Date</th><th class="text-right">Amount</th></tr></thead>' +
                            '<tbody>' + rowsHtml + '</tbody></table>';
                    } else {
                        // Fallback to local data
                        self.openEntityFlyoutFromLocal(entityType, entityId, entityName);
                    }
                })
                .catch(function(err) {
                    console.error('Entity flyout error:', err);
                    // Fallback to local data
                    self.openEntityFlyoutFromLocal(entityType, entityId, entityName);
                });
        },
        
        // Fallback to local data for entity flyout
        openEntityFlyoutFromLocal: function(entityType, entityId, entityName) {
            var flagged = (this.latestData && this.latestData.flaggedTransactions) || [];
            var transactions = [];
            
            if (entityType === 'vendor') {
                transactions = flagged.filter(function(f) { 
                    return String(f.vendorId || f.entityId) === String(entityId); 
                });
            } else if (entityType === 'user') {
                transactions = flagged.filter(function(f) { 
                    return String(f.createdById || f.userId) === String(entityId); 
                });
            }
            
            if (transactions.length === 0) {
                var _sub = document.getElementById('atFlyoutSubtitle'); _sub.textContent = 'No flagged transactions found'; _sub.style.display = _sub.textContent ? 'block' : 'none';
                document.getElementById('atFlyoutBody').innerHTML = '<div class="text-center py-5 text-muted"><i class="fas fa-inbox fa-2x mb-2"></i><div>No transactions found for this ' + entityType + '</div></div>';
                return;
            }
            
            var total = transactions.reduce(function(s, t) { return s + (parseFloat(t.amount) || 0); }, 0);
            this.renderEntityFlyoutContent(entityName || (entityType + ' #' + entityId), transactions, total);
        },
        
        renderEntityFlyoutContent: function(title, transactions, total) {
            var self = this;
            document.getElementById('atFlyoutSubtitle').style.display = 'none';
            
            document.getElementById('atFlyoutStats').innerHTML = this.buildFlyoutKPIs([
                { label: 'Total', value: fmtMoney(total), icon: 'dollar-sign', color: 'primary' },
                { label: 'Count', value: transactions.length, icon: 'flag', color: 'warning' }
            ]);
            
            var rowsHtml = transactions.map(function(f) {
                var riskDisplay = f.riskScore != null ? Math.round(f.riskScore) : '-';
                return '<tr>' +
                    '<td>' + getNsLink(f.tranId || 'N/A', f.id) + '</td>' +
                    '<td>' + (f.type || '-') + '</td>' +
                    '<td class="text-right font-weight-bold">' + fmtMoney(f.amount, 2) + '</td>' +
                    '<td>' + self.getFlagPill(f.flagType) + '</td>' +
                    '<td><span class="severity-dot ' + self.getSeverityClass(f.riskScore) + '"></span> ' + riskDisplay + '</td>' +
                '</tr>';
            }).join('');
            
            document.getElementById('atFlyoutBody').innerHTML = 
                '<table class="table table-sm table-hover">' +
                '<thead><tr><th>Tran #</th><th>Type</th><th class="text-right">Amount</th><th>Flag</th><th>Risk</th></tr></thead>' +
                '<tbody>' + rowsHtml + '</tbody></table>';
        },

        renderFullHeatmap: function() {
            var container = el("#integrityFullHeatmap");
            if (!container || !this.latestData) return;
            var self = this;
            var flagged = this.latestData.flaggedTransactions || [];
            var meta = this.latestData.meta || {};
            var rangeStart = (meta.range && meta.range.start) ? meta.range.start : null;
            var rangeEnd = (meta.range && meta.range.end) ? meta.range.end : null;
            var startDate = new Date(rangeStart || Date.now() - 90 * 24 * 60 * 60 * 1000);
            var endDate = new Date(rangeEnd || Date.now());
            var dailyData = new Map();
            var current = new Date(startDate);
            while (current <= endDate) {
                var key = current.toISOString().split('T')[0];
                dailyData.set(key, { date: key, count: 0, amount: 0, riskScore: 0, flags: [], flagTypes: {}, isWeekend: current.getDay() === 0 || current.getDay() === 6, dayOfWeek: current.getDay(), dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][current.getDay()], month: current.getMonth(), year: current.getFullYear(), dayNum: current.getDate() });
                current.setDate(current.getDate() + 1);
            }
            flagged.forEach(function(f) {
                var dateKey = f.tranDate;
                if (dateKey && dateKey.indexOf('/') > -1) { var parts = dateKey.split('/'); if (parts.length === 3) dateKey = parts[2] + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0'); }
                if (dailyData.has(dateKey)) { var day = dailyData.get(dateKey); day.count++; day.amount += Math.abs(f.amount || 0); day.riskScore = Math.max(day.riskScore, f.riskScore || 0); day.flags.push(f); day.flagTypes[f.flagType] = (day.flagTypes[f.flagType] || 0) + 1; }
            });
            var days = Array.from(dailyData.values());
            var maxCount = Math.max.apply(null, days.map(function(d) { return d.count; }).concat([1]));
            var totalFlags = days.reduce(function(s, d) { return s + d.count; }, 0);
            var totalAmount = days.reduce(function(s, d) { return s + d.amount; }, 0);
            var riskDays = days.filter(function(d) { return d.count > 0; }).length;
            var weekendFlags = days.filter(function(d) { return d.isWeekend && d.count > 0; }).length;
            var highRiskDays = days.filter(function(d) { return d.riskScore >= 70; }).length;
            var weeks = []; var currentWeek = null;
            days.forEach(function(d) {
                if (d.dayOfWeek === 0 || !currentWeek) { currentWeek = { startDate: d.date, days: [], totalFlags: 0, totalAmount: 0, maxRisk: 0, weekendCount: 0 }; weeks.push(currentWeek); }
                currentWeek.days.push(d); currentWeek.totalFlags += d.count; currentWeek.totalAmount += d.amount; currentWeek.maxRisk = Math.max(currentWeek.maxRisk, d.riskScore);
                if (d.isWeekend && d.count > 0) currentWeek.weekendCount++; currentWeek.endDate = d.date;
            });
            var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            
            // Standard KPI row
            var kpiHtml = this.buildKPIRow([
                { label: 'Flagged Days', value: riskDays, icon: 'flag', color: riskDays > days.length * 0.3 ? 'danger' : 'warning' },
                { label: 'Total Flags', value: totalFlags, icon: 'exclamation-circle' },
                { label: 'High Risk Days', value: highRiskDays, icon: 'exclamation-triangle', color: highRiskDays > 0 ? 'danger' : 'success' },
                { label: 'At Risk', value: fmtMoney(totalAmount), icon: 'dollar-sign' }
            ]);
            
            var weeksHtml = '<div class="rcal-weeks rcal-weeks-compact">';
            weeks.forEach(function(week) {
                var weekRiskClass = week.maxRisk >= 70 ? 'week-high' : week.maxRisk >= 40 ? 'week-med' : 'week-low';
                var weekStart = new Date(week.startDate); var weekEnd = new Date(week.endDate);
                var weekLabel = monthNames[weekStart.getMonth()] + ' ' + weekStart.getDate() + (weekEnd.getMonth() !== weekStart.getMonth() ? ' - ' + monthNames[weekEnd.getMonth()] + ' ' + weekEnd.getDate() : ' - ' + weekEnd.getDate());
                var daysHtml = '<div class="rcal-week-days rcal-week-days-compact">';
                week.days.forEach(function(d) {
                    var intensity = d.count > 0 ? Math.min(1, d.count / Math.max(maxCount * 0.5, 1)) : 0;
                    var cellClass = d.count === 0 ? 'empty' : d.riskScore >= 70 ? 'high' : d.riskScore >= 40 ? 'med' : 'low';
                    var weekendClass = d.isWeekend ? ' weekend' : '';
                    var flagTypesStr = Object.keys(d.flagTypes).join(', ') || 'None';
                    daysHtml += '<div class="rcal-day rcal-day-compact ' + cellClass + weekendClass + '" data-date="' + d.date + '" style="--intensity: ' + intensity + ';" onclick="IntegrityController.drillDownDate(\'' + d.date + '\')"><div class="rcal-day-name">' + d.dayName + '</div><div class="rcal-day-num">' + d.dayNum + '</div>' + (d.count > 0 ? '<div class="rcal-day-indicator"><span class="rcal-day-count">' + d.count + '</span></div>' : '') + '<div class="rcal-day-tooltip"><div class="rdt-date">' + new Date(d.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + '</div><div class="rdt-stats"><span><i class="fas fa-flag"></i> ' + d.count + ' flags</span><span><i class="fas fa-dollar-sign"></i> ' + fmtMoney(d.amount, 2) + '</span></div>' + (d.count > 0 ? '<div class="rdt-types">' + flagTypesStr + '</div>' : '') + '<div class="rdt-hint">Click to view details</div></div></div>';
                });
                daysHtml += '</div>';
                var sparkHtml = '<div class="rcal-week-spark rcal-week-spark-compact">';
                week.days.forEach(function(d) { var h = d.count > 0 ? Math.max(2, (d.count / maxCount) * 12) : 1; var color = d.count === 0 ? '#e2e8f0' : d.riskScore >= 70 ? '#ef4444' : d.riskScore >= 40 ? '#f59e0b' : '#10b981'; sparkHtml += '<div class="rcal-spark-bar" style="height: ' + h + 'px; background: ' + color + ';"></div>'; });
                sparkHtml += '</div>';
                weeksHtml += '<div class="rcal-week-card rcal-week-card-compact ' + weekRiskClass + '"><div class="rcal-week-header rcal-week-header-compact"><div class="rwh-label">' + weekLabel + '</div><div class="rwh-stats">' + (week.totalFlags > 0 ? '<span class="rwh-stat flags"><i class="fas fa-flag"></i> ' + week.totalFlags + '</span>' : '') + (week.totalAmount > 0 ? '<span class="rwh-stat amount">' + fmtMoney(week.totalAmount, 2) + '</span>' : '') + (week.weekendCount > 0 ? '<span class="rwh-stat weekend"><i class="fas fa-calendar-week"></i> ' + week.weekendCount + '</span>' : '') + '</div></div>' + daysHtml + sparkHtml + '</div>';
            });
            weeksHtml += '</div>';
            var legendHtml = '<div class="rcal-legend"><div class="rcal-legend-title">Risk Level</div><div class="rcal-legend-items"><span class="rcal-legend-item"><span class="rcal-legend-dot empty"></span>Clean</span><span class="rcal-legend-item"><span class="rcal-legend-dot low"></span>Low</span><span class="rcal-legend-item"><span class="rcal-legend-dot med"></span>Medium</span><span class="rcal-legend-item"><span class="rcal-legend-dot high"></span>High</span><span class="rcal-legend-item"><span class="rcal-legend-dot weekend"></span>Weekend</span></div></div>';
            container.innerHTML = kpiHtml + 
                '<div class="alert alert-info py-2 mb-2"><i class="fas fa-th mr-2"></i><strong>Risk Calendar</strong> - Daily flag activity heatmap. Click any day to view flagged transactions. Color intensity indicates risk level.</div>' +
                '<div class="rcal-container">' + weeksHtml + legendHtml + '</div>';
        },
        
        drillDownDate: function(dateStr) {
            var flagged = (this.latestData && this.latestData.flaggedTransactions) ? this.latestData.flaggedTransactions : [];
            var dayFlags = flagged.filter(function(f) { var fDate = f.tranDate; if (fDate && fDate.indexOf('/') > -1) { var parts = fDate.split('/'); if (parts.length === 3) fDate = parts[2] + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0'); } return fDate === dateStr; });
            if (dayFlags.length === 0) { showToast('No flagged transactions on ' + dateStr); return; }
            this.showTransactionsFlyout(new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), dayFlags, dayFlags.length + ' flagged transactions');
        },

        showTransactionsFlyout: function(title, transactions, subtitle) {
            var self = this;
            var flyout = document.getElementById('atFlyout');
            if (!flyout) { console.error('Flyout not found'); return; }
            
            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');
            
            document.getElementById('atFlyoutTitle').textContent = title;
            document.getElementById('atFlyoutSubtitle').style.display = 'none';
            
            var total = transactions.reduce(function(sum, t) { return sum + (parseFloat(t.amount) || 0); }, 0);
            document.getElementById('atFlyoutStats').innerHTML = this.buildFlyoutKPIs([
                { label: 'Total', value: fmtMoney(total), icon: 'dollar-sign', color: 'primary' },
                { label: 'Count', value: transactions.length, icon: 'receipt', color: 'info' }
            ]);
            
            var rowsHtml = transactions.map(function(f) {
                var riskDisplay = f.riskScore != null ? Math.round(f.riskScore) : '-';
                return '<tr>' +
                    '<td>' + getNsLink(f.tranId || 'N/A', f.id) + '</td>' +
                    '<td>' + (f.type || '-') + '</td>' +
                    '<td class="text-right font-weight-bold">' + fmtMoney(f.amount, 2) + '</td>' +
                    '<td>' + self.getFlagPill(f.flagType) + '</td>' +
                    '<td><span class="severity-dot ' + self.getSeverityClass(f.riskScore) + '"></span> ' + riskDisplay + '</td>' +
                '</tr>';
            }).join('');
            
            var bodyHtml = '<table class="table table-sm table-hover">' +
                '<thead><tr><th>Tran #</th><th>Type</th><th class="text-right">Amount</th><th>Flag</th><th>Risk</th></tr></thead>' +
                '<tbody>' + rowsHtml + '</tbody></table>';
            
            document.getElementById('atFlyoutBody').innerHTML = bodyHtml;
        },

        showDayModal: function(dateStr, flags) {
            var self = this;
            var modal = document.createElement('div'); modal.className = 'modal fade'; modal.id = 'dayDetailModal';
            var rowsHtml = flags.map(function(f) { 
                var riskDisplay = f.riskScore != null ? Math.round(f.riskScore) : '-';
                return '<tr><td>' + getNsLink(f.tranId || 'N/A', f.id) + '</td><td>' + f.type + '</td><td class="text-right font-weight-bold">' + fmtMoney(f.amount, 2) + '</td><td>' + self.getFlagPill(f.flagType) + '</td><td><span class="severity-dot ' + self.getSeverityClass(f.riskScore) + '"></span> ' + riskDisplay + '</td><td>' + self.renderFlagActions(f) + '</td></tr>'; 
            }).join('');
            modal.innerHTML = '<div class="modal-dialog modal-lg"><div class="modal-content"><div class="modal-header"><h5 class="modal-title"><i class="fas fa-calendar-day mr-2"></i>' + new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + '</h5><button type="button" class="close" data-dismiss="modal">&times;</button></div><div class="modal-body"><table class="table table-sm"><thead><tr><th>Tran #</th><th>Type</th><th class="text-right">Amount</th><th>Flag</th><th>Risk</th><th>Actions</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div></div>';
            document.body.appendChild(modal);
            jQuery('#dayDetailModal').modal('show').on('hidden.bs.modal', function() { this.remove(); });
        },

        renderBenfordTab: function() {
            var container = el("#integrityBenfordContent");
            if (!container || !this.latestData) return;
            var self = this;
            var benford1D = this.latestData.benfordAnalysis;
            var benford2D = this.latestData.benford2DAnalysis;
            
            // Build KPI row from available data
            var totalTrans = (benford1D && benford1D.totalTransactions) || (benford2D && benford2D.totalTransactions) || 0;
            var conformity1D = (benford1D && benford1D.conformityLevel) || 'N/A';
            var conformity2D = (benford2D && benford2D.conformityLevel) || 'N/A';
            var mad1D = (benford1D && benford1D.meanAbsoluteDeviation) ? benford1D.meanAbsoluteDeviation.toFixed(4) : 'N/A';
            var anomalyCount = (benford1D && benford1D.digits) ? benford1D.digits.filter(function(d) { return d.isAnomaly; }).length : 0;
            var conformityColor = function(c) { return c === 'Close Conformity' || c === 'Acceptable' ? 'success' : c === 'Marginal Conformity' ? 'warning' : c === 'Non-Conforming' ? 'danger' : ''; };
            
            var kpiHtml = this.buildKPIRow([
                { label: 'Transactions', value: totalTrans.toLocaleString(), icon: 'file-invoice' },
                { label: '1D Conformity', value: conformity1D.replace(' Conformity', ''), icon: 'chart-bar', color: conformityColor(conformity1D) },
                { label: '2D Conformity', value: conformity2D.replace(' Conformity', ''), icon: 'th', color: conformityColor(conformity2D) },
                { label: 'MAD (1D)', value: mad1D, icon: 'calculator' },
                { label: 'Anomalous Digits', value: anomalyCount, icon: 'exclamation-circle', color: anomalyCount > 2 ? 'warning' : 'success' }
            ]);
            
            if (!benford1D && !benford2D) { 
                container.innerHTML = kpiHtml + '<div class="empty-state mt-3"><i class="fas fa-chart-bar text-muted fa-3x mb-3"></i><h5>No Benford Analysis Data</h5><p>Requires minimum transaction count for statistical analysis</p></div>'; 
                return; 
            }
            
            // Default to 2D tab if high transaction volume (more statistically meaningful)
            var default2D = totalTrans > 1000 && benford2D;
            var active1D = default2D ? '' : ' active';
            var active2D = default2D ? ' active' : '';
            var show1D = default2D ? '' : ' show active';
            var show2D = default2D ? ' show active' : '';
            
            var content1D = this.renderBenford1DSection(benford1D);
            var content2D = this.renderBenford2DSection(benford2D);
            var drillDownHtml = this.renderBenfordDrillDown(benford1D);
            container.innerHTML = kpiHtml +
                '<div class="alert alert-info py-2 mb-2"><i class="fas fa-chart-bar mr-2"></i><strong>Benford\'s Law Analysis</strong> - Natural datasets follow predictable digit frequency patterns. Deviations in the overall distribution (not individual transactions) may indicate data manipulation.</div>' +
                '<div class="benford-dashboard"><ul class="nav nav-pills benford-sub-tabs mb-2"><li class="nav-item"><a class="nav-link' + active1D + '" data-toggle="tab" href="#benford-1d">First Digit (1D)</a></li><li class="nav-item"><a class="nav-link' + active2D + '" data-toggle="tab" href="#benford-2d">First Two Digits (2D)</a></li><li class="nav-item"><a class="nav-link" data-toggle="tab" href="#benford-drilldown">Drill-Down</a></li></ul><div class="tab-content"><div class="tab-pane fade' + show1D + '" id="benford-1d">' + content1D + '</div><div class="tab-pane fade' + show2D + '" id="benford-2d">' + content2D + '</div><div class="tab-pane fade" id="benford-drilldown">' + drillDownHtml + '</div></div></div>';
            setTimeout(function() { self.renderBenford1DChart(benford1D); self.renderBenford2DChart(benford2D); }, 100);
        },
        
        renderBenford1DSection: function(benford) {
            if (!benford) return '<div class="text-muted p-3">No first-digit analysis available</div>';
            var madValue = benford.meanAbsoluteDeviation ? benford.meanAbsoluteDeviation.toFixed(4) : 'N/A';
            var cc = this.getConformityConfig(benford.conformityLevel);
            var digitsHtml = '';
            (benford.digits || []).forEach(function(d) {
                var bar = Math.min((d.observed / 0.35) * 100, 100); var expBar = Math.min((d.expected / 0.35) * 100, 100); var cls = d.isAnomaly ? 'anomaly' : '';
                digitsHtml += '<div class="bd-cell ' + cls + ' clickable-row" onclick="IntegrityController.openBenford1DDigitFlyout(' + d.digit + ')"><div class="bd-digit">' + d.digit + '</div><div class="bd-bars"><div class="bd-bar observed" style="width: ' + bar + '%" title="Observed: ' + (d.observed * 100).toFixed(1) + '%"></div><div class="bd-bar expected" style="width: ' + expBar + '%" title="Expected: ' + (d.expected * 100).toFixed(1) + '%"></div></div><div class="bd-pct">' + (d.observed * 100).toFixed(1) + '%</div></div>';
            });
            return '<div class="benford-1d-layout"><div class="benford-chart-section"><div class="bcs-header"><i class="fas fa-chart-bar"></i> First Digit Frequency</div><div id="benford1DChart" style="height: 280px;"></div></div><div class="benford-sidebar"><div class="conformity-badge" style="background: ' + cc.bg + '; border-color: ' + cc.border + ';"><span class="' + cc.text + '">' + benford.conformityLevel + '</span></div><div class="mad-display"><span class="mad-label">Mean Absolute Deviation</span><span class="mad-value">' + madValue + '</span></div>' + (benford.message ? '<div class="benford-message">' + benford.message + '</div>' : '') + '<div class="thresholds"><h6>MAD Thresholds (1D)</h6><div class="threshold t-excellent">&lt; 0.006 Close Conformity</div><div class="threshold t-acceptable">0.006-0.012 Acceptable</div><div class="threshold t-marginal">0.012-0.015 Marginal</div><div class="threshold t-bad">&gt; 0.015 Non-Conforming</div></div></div><div class="benford-digits-grid"><div class="bdg-header">Digit Distribution <small class="text-muted">(click digit to view transactions)</small></div><div class="bdg-content">' + digitsHtml + '</div><div class="bdg-legend"><span class="bdl-item"><span class="bdl-dot observed"></span>Observed</span><span class="bdl-item"><span class="bdl-dot expected"></span>Expected</span></div></div></div>';
        },
        
        renderBenford2DSection: function(benford2D) {
            if (!benford2D) return '<div class="text-muted p-3">No first-two-digit analysis available</div>';
            var self = this;
            var madValue = benford2D.meanAbsoluteDeviation ? benford2D.meanAbsoluteDeviation.toFixed(5) : 'N/A';
            var cc = this.getConformityConfig(benford2D.conformityLevel);
            var anomalies = benford2D.anomalies || [];
            var anomalyRows = anomalies.slice(0, 15).map(function(a) { var devClass = a.deviationPct > 50 ? 'text-danger' : a.deviationPct > 30 ? 'text-warning' : ''; return '<tr class="clickable-row" onclick="IntegrityController.openBenford2DDigitFlyout(' + a.digits + ')"><td><strong>' + a.digits + '</strong></td><td>' + a.count + '</td><td>' + (a.observed * 100).toFixed(2) + '%</td><td>' + (a.expected * 100).toFixed(2) + '%</td><td class="' + devClass + '">' + (a.deviationPct > 0 ? '+' : '') + a.deviationPct.toFixed(0) + '%</td></tr>'; }).join('');
            
            // Threshold trap - amounts ENDING in 99, 999, 9999
            var thresholdTraps = benford2D.thresholdTrapFlags || [];
            var trapHtml = '';
            if (thresholdTraps.length > 0) {
                var trapSamples = thresholdTraps.slice(0, 8).map(function(t) { 
                    return '<span class="bta-digit">' + getNsLink(fmtMoney(t.amount), t.id) + '</span>'; 
                }).join('');
                trapHtml = '<div class="b2d-trap-alert"><div class="bta-header"><i class="fas fa-exclamation-triangle"></i> Threshold Trap Detected (' + thresholdTraps.length + ' transactions)</div><div class="bta-body"><p>Amounts ending in 99, 999, or 9999 (like $4,999 or $9,999.99) may indicate transactions set just below approval limits.</p><div class="bta-digits">' + trapSamples + '</div></div></div>';
            }
            return '<div class="benford-2d-layout"><div class="b2d-chart-section"><div class="bcs-header"><i class="fas fa-th"></i> First Two Digits Heatmap (10-99)</div><div id="benford2DChart" style="height: 300px;"></div></div><div class="b2d-sidebar"><div class="conformity-badge" style="background: ' + cc.bg + '; border-color: ' + cc.border + ';"><span class="' + cc.text + '">' + benford2D.conformityLevel + '</span></div><div class="mad-display"><span class="mad-label">Mean Absolute Deviation</span><span class="mad-value">' + madValue + '</span></div><div class="thresholds"><h6>MAD Thresholds (2D)</h6><div class="threshold t-excellent">&lt; 0.0012 Close</div><div class="threshold t-acceptable">0.0012-0.0022 Acceptable</div><div class="threshold t-marginal">0.0022-0.0033 Marginal</div><div class="threshold t-bad">&gt; 0.0033 Non-Conforming</div></div></div>' + trapHtml + '<div class="b2d-anomalies"><div class="b2da-header"><i class="fas fa-exclamation-circle"></i> Top Anomalous Digit Pairs <small class="text-muted">(click to view)</small></div><table class="table table-sm table-hover"><thead><tr><th>Digits</th><th>Count</th><th>Observed</th><th>Expected</th><th>Deviation</th></tr></thead><tbody>' + anomalyRows + '</tbody></table></div></div>';
        },
        
        renderBenfordDrillDown: function(benford) {
            var self = this;
            if (!benford) return '<div class="text-muted p-3">No drill-down data available</div>';

            // Get transactions for drill-down (these are NOT flagged - just for context)
            var transactions = benford.drillDownTransactions || benford.flaggedTransactions || [];

            // Find digits that deviate from expected distribution (dataset-level, not transaction-level)
            var deviatingDigits = (benford.digits || []).filter(function(d) { return d.isAnomaly; });

            if (deviatingDigits.length === 0) {
                return '<div class="benford-investigation"><div class="bi-header"><i class="fas fa-check-circle text-success"></i> Distribution Analysis</div><div class="bi-no-anomalies"><div class="bi-success-icon"><i class="fas fa-shield-alt"></i></div><h6>Good Conformity</h6><p class="text-muted small">The overall digit distribution follows Benford\'s Law. No digits show significant deviation from expected frequencies.</p><p class="text-muted small mt-2"><em>Note: Benford analysis evaluates the dataset as a whole, not individual transactions.</em></p></div></div>';
            }

            // Show deviating digits with their stats
            var deviatingDigitsHtml = deviatingDigits.map(function(d) {
                var devClass = d.deviationPct > 0 ? 'text-warning' : 'text-info';
                var devLabel = d.deviationPct > 0 ? 'over-represented' : 'under-represented';
                return '<div class="bi-item clickable-row" onclick="IntegrityController.openBenford1DDigitFlyout(' + d.digit + ')">' +
                    '<i class="fas fa-hashtag"></i>' +
                    '<span class="bi-name">Digit ' + d.digit + '</span>' +
                    '<span class="bi-stats ' + devClass + '">' + (d.deviationPct > 0 ? '+' : '') + d.deviationPct.toFixed(0) + '% ' + devLabel + '</span>' +
                '</div>';
            }).join('');

            // Group transactions by digit for context
            var digitGroups = {};
            transactions.forEach(function(t) {
                var digit = t.firstDigit;
                if (!digit) return;
                if (!digitGroups[digit]) digitGroups[digit] = { digit: digit, count: 0, amount: 0 };
                digitGroups[digit].count++;
                digitGroups[digit].amount += t.amount || 0;
            });

            // Show transaction counts per digit (for context)
            var allDigitsHtml = Object.values(digitGroups).sort(function(a, b) { return a.digit - b.digit; }).map(function(d) {
                var digitInfo = (benford.digits || []).find(function(x) { return x.digit === d.digit; });
                var isDeviating = digitInfo && digitInfo.isAnomaly;
                var cls = isDeviating ? 'bi-item-highlight' : '';
                return '<div class="bi-item clickable-row ' + cls + '" onclick="IntegrityController.openBenford1DDigitFlyout(' + d.digit + ')">' +
                    '<i class="fas fa-hashtag"></i>' +
                    '<span class="bi-name">Digit ' + d.digit + (isDeviating ? ' ⚠' : '') + '</span>' +
                    '<span class="bi-stats">' + d.count + ' txns / ' + fmtMoney(d.amount, 2) + '</span>' +
                '</div>';
            }).join('') || '<div class="text-muted small">No data</div>';

            // Recent transactions from deviating digits (for investigation context)
            var deviatingDigitNums = deviatingDigits.map(function(d) { return d.digit; });
            var contextTxns = transactions.filter(function(t) {
                return deviatingDigitNums.indexOf(t.firstDigit) >= 0;
            }).slice(0, 10);

            var txnsHtml = contextTxns.map(function(t) {
                return '<div class="bi-item">' +
                    '<i class="fas fa-file-invoice"></i>' +
                    '<span class="bi-name">' + getNsLink(t.tranId || 'N/A', t.id) + '</span>' +
                    '<span class="bi-stats">' + (t.type || '-') + ' / ' + fmtMoney(t.amount, 2) + '</span>' +
                '</div>';
            }).join('') || '<div class="text-muted small">No transactions to display</div>';

            return '<div class="benford-investigation">' +
                '<div class="bi-header"><i class="fas fa-search"></i> Digit Distribution Drill-Down</div>' +
                '<div class="alert alert-secondary py-2 mb-3"><small><i class="fas fa-info-circle mr-1"></i><strong>Important:</strong> Benford\'s Law is a dataset-level statistical test. The digits below deviate from expected frequencies across all transactions. Individual transactions are shown for investigation context only—they are not individually flagged or scored.</small></div>' +
                '<div class="bi-grid">' +
                    '<div class="bi-panel">' +
                        '<div class="bi-panel-header"><i class="fas fa-exclamation-triangle text-warning"></i> Deviating Digits (' + deviatingDigits.length + ')</div>' +
                        '<div class="bi-panel-body">' + deviatingDigitsHtml + '</div>' +
                    '</div>' +
                    '<div class="bi-panel">' +
                        '<div class="bi-panel-header"><i class="fas fa-hashtag"></i> All Digits (click to explore)</div>' +
                        '<div class="bi-panel-body">' + allDigitsHtml + '</div>' +
                    '</div>' +
                    '<div class="bi-panel">' +
                        '<div class="bi-panel-header"><i class="fas fa-list"></i> Sample Transactions (from deviating digits)</div>' +
                        '<div class="bi-panel-body">' + txnsHtml + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        },

        // Legacy alias for backward compatibility
        renderBenfordInvestigation: function(benford) {
            return this.renderBenfordDrillDown(benford);
        },
        
        filterBenfordByType: function(type) {
            var benford = this.latestData && this.latestData.benfordAnalysis;
            var transactions = (benford && (benford.drillDownTransactions || benford.flaggedTransactions)) || [];
            var filtered = transactions.filter(function(t) { return t.type === type; });
            if (filtered.length === 0) {
                this.showToast('No transactions found for type: ' + type, 'info');
                return;
            }
            var total = filtered.reduce(function(s, t) { return s + (t.amount || 0); }, 0);
            this.showTransactionsFlyout('Benford Drill-Down: ' + type, filtered, filtered.length + ' transactions | ' + fmtMoney(total, 2));
        },
        
        openBenfordFlyout: function(entityType, entityId, entityName, count, amount) {
            var flyout = document.getElementById('atFlyout');
            if (!flyout) return;

            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');

            document.getElementById('atFlyoutTitle').textContent = entityName;
            document.getElementById('atFlyoutSubtitle').style.display = 'none';

            document.getElementById('atFlyoutStats').innerHTML = this.buildFlyoutKPIs([
                { label: 'Transactions', value: count, icon: 'receipt', color: 'primary' },
                { label: 'Total Amount', value: fmtMoney(amount), icon: 'dollar-sign', color: 'info' },
                { label: 'Analysis', value: 'Benford', icon: 'chart-bar', color: 'info' }
            ]);

            // Show Benford-specific info - reframed as context, not flag
            var bodyHtml = '<div class="p-3">' +
                '<div class="alert alert-info mb-3"><i class="fas fa-chart-bar mr-2"></i><strong>Benford Analysis Context</strong><br>' +
                'This ' + entityType + ' has ' + count + ' transaction(s) totaling ' + fmtMoney(amount) + ' that fall within digits showing distribution deviation.</div>' +
                '<div class="mb-3"><strong>About Benford\'s Law:</strong><p class="text-muted small mb-0">Transaction amounts naturally follow Benford\'s Law at the dataset level. Individual transactions are not flagged—only the overall distribution is analyzed. Deviations in digit frequency patterns may warrant further review of data entry practices.</p></div>' +
                '<div><strong>Context:</strong><p class="text-muted small mb-0">These transactions are shown for investigative context. The statistical deviation applies to the dataset as a whole, not to individual transactions.</p></div>' +
                '</div>';
            document.getElementById('atFlyoutBody').innerHTML = bodyHtml;
        },
        
        // Benford 1D digit flyout - shows transactions starting with a specific digit for drill-down
        openBenford1DDigitFlyout: function(digit) {
            var benford = this.latestData && this.latestData.benfordAnalysis;
            var allTransactions = (benford && (benford.drillDownTransactions || benford.flaggedTransactions)) || [];

            // Filter transactions that start with this digit
            var transactions = allTransactions.filter(function(t) {
                return t.firstDigit === digit || String(t.firstDigit) === String(digit);
            });

            if (transactions.length === 0) {
                showToast('No transactions found for digit ' + digit);
                return;
            }

            var digitInfo = (benford.digits || []).find(function(d) { return d.digit === digit; }) || {};
            var total = transactions.reduce(function(s, t) { return s + (t.amount || 0); }, 0);

            var flyout = document.getElementById('atFlyout');
            if (!flyout) return;
            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');

            document.getElementById('atFlyoutTitle').textContent = 'Digit ' + digit + ' - Drill-Down';
            document.getElementById('atFlyoutSubtitle').style.display = 'none';

            var digitDeviates = digitInfo.isAnomaly;
            var kpis = [
                { label: 'Transactions', value: transactions.length, icon: 'receipt', color: 'primary' },
                { label: 'Total Amount', value: fmtMoney(total, 2), icon: 'dollar-sign', color: 'info' },
                { label: 'Observed', value: ((digitInfo.observed || 0) * 100).toFixed(1) + '%', icon: 'eye', color: 'warning' },
                { label: 'Expected', value: ((digitInfo.expected || 0) * 100).toFixed(1) + '%', icon: 'chart-line', color: 'success' }
            ];
            if (digitDeviates) kpis.push({ label: 'Distribution', value: 'Deviates', icon: 'chart-bar', color: 'warning' });
            document.getElementById('atFlyoutStats').innerHTML = this.buildFlyoutKPIs(kpis);

            var contextNote = digitDeviates
                ? '<div class="alert alert-secondary py-2 mb-2"><small><i class="fas fa-info-circle mr-1"></i>This digit appears more/less frequently than Benford\'s Law predicts. These transactions are shown for context—individual transactions are not flagged.</small></div>'
                : '';

            var rowsHtml = transactions.slice(0, 50).map(function(t) {
                return '<tr><td>' + getNsLink(t.tranId || 'N/A', t.id) + '</td><td>' + (t.tranDate || 'N/A') + '</td><td>' + (t.type || '-') + '</td><td class="text-right">' + fmtMoney(t.amount, 2) + '</td></tr>';
            }).join('');

            document.getElementById('atFlyoutBody').innerHTML = contextNote + '<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Tran #</th><th>Date</th><th>Type</th><th class="text-right">Amount</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' + (transactions.length > 50 ? '<div class="text-muted text-center small p-2">Showing first 50 of ' + transactions.length + '</div>' : '');
        },

        // Benford 2D digit flyout - shows transactions starting with specific two digits for drill-down
        openBenford2DDigitFlyout: function(digits) {
            var benford = this.latestData && this.latestData.benfordAnalysis;
            var allTransactions = (benford && (benford.drillDownTransactions || benford.flaggedTransactions)) || [];

            // Filter transactions that start with these two digits
            var transactions = allTransactions.filter(function(t) {
                return t.firstTwoDigits === digits || parseInt(t.firstTwoDigits) === parseInt(digits);
            });

            if (transactions.length === 0) {
                showToast('No transactions found for digits ' + digits);
                return;
            }

            var benford2D = this.latestData && this.latestData.benford2DAnalysis;
            var digitInfo = (benford2D && benford2D.digits || []).find(function(d) { return d.digits === digits; }) || {};
            var total = transactions.reduce(function(s, t) { return s + (t.amount || 0); }, 0);

            var flyout = document.getElementById('atFlyout');
            if (!flyout) return;
            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');

            document.getElementById('atFlyoutTitle').textContent = 'Digits ' + digits + ' - Drill-Down';
            document.getElementById('atFlyoutSubtitle').style.display = 'none';

            var digitDeviates = digitInfo.isAnomaly;
            var devPct = (digitInfo.deviationPct || 0);
            var kpis = [
                { label: 'Transactions', value: transactions.length, icon: 'receipt', color: 'primary' },
                { label: 'Total Amount', value: fmtMoney(total, 2), icon: 'dollar-sign', color: 'info' },
                { label: 'Deviation', value: (devPct > 0 ? '+' : '') + devPct.toFixed(0) + '%', icon: 'percentage', color: Math.abs(devPct) > 50 ? 'warning' : 'info' }
            ];
            if (digitDeviates) kpis.push({ label: 'Distribution', value: 'Deviates', icon: 'chart-bar', color: 'warning' });
            document.getElementById('atFlyoutStats').innerHTML = this.buildFlyoutKPIs(kpis);

            var contextNote = digitDeviates
                ? '<div class="alert alert-secondary py-2 mb-2"><small><i class="fas fa-info-circle mr-1"></i>This digit pair appears more/less frequently than Benford\'s Law predicts. These transactions are shown for context—individual transactions are not flagged.</small></div>'
                : '';

            var rowsHtml = transactions.slice(0, 50).map(function(t) {
                return '<tr><td>' + getNsLink(t.tranId || 'N/A', t.id) + '</td><td>' + (t.tranDate || 'N/A') + '</td><td>' + (t.type || '-') + '</td><td class="text-right">' + fmtMoney(t.amount, 2) + '</td></tr>';
            }).join('');

            document.getElementById('atFlyoutBody').innerHTML = contextNote + '<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Tran #</th><th>Date</th><th>Type</th><th class="text-right">Amount</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' + (transactions.length > 50 ? '<div class="text-muted text-center small p-2">Showing first 50 of ' + transactions.length + '</div>' : '');
        },
        
        getConformityConfig: function(level) {
            var configs = { 'Excellent': { bg: 'rgba(16,185,129,0.1)', border: '#10b981', text: 'text-success' }, 'Acceptable': { bg: 'rgba(16,185,129,0.1)', border: '#10b981', text: 'text-success' }, 'Marginal': { bg: 'rgba(245,158,11,0.1)', border: '#f59e0b', text: 'text-warning' }, 'Non-Conforming': { bg: 'rgba(239,68,68,0.1)', border: '#ef4444', text: 'text-danger' }, 'Insufficient Data': { bg: 'rgba(107,114,128,0.1)', border: '#6b7280', text: 'text-muted' } };
            return configs[level] || configs['Insufficient Data'];
        },

        renderBenford1DChart: function(benford) {
            var chartEl = document.getElementById('benford1DChart');
            if (!chartEl || typeof Plotly === 'undefined' || !benford) return;
            var digits = benford.digits || [];
            Plotly.newPlot(chartEl, [{ x: digits.map(function(d) { return d.digit.toString(); }), y: digits.map(function(d) { return d.observed * 100; }), name: 'Observed', type: 'bar', marker: { color: digits.map(function(d) { return d.isAnomaly ? '#ef4444' : '#3b82f6'; }) } }, { x: digits.map(function(d) { return d.digit.toString(); }), y: digits.map(function(d) { return d.expected * 100; }), name: "Benford's Law", type: 'scatter', mode: 'lines+markers', line: { color: '#10b981', width: 3 }, marker: { size: 8 } }], { xaxis: { title: 'First Digit' }, yaxis: { title: 'Frequency (%)', range: [0, 40] }, showlegend: true, legend: { orientation: 'h', y: 1.1, x: 0.5, xanchor: 'center' }, margin: { t: 30, r: 20, b: 50, l: 50 }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent' }, { responsive: true, displayModeBar: false });
        },
        
        renderBenford2DChart: function(benford2D) {
            var chartEl = document.getElementById('benford2DChart');
            if (!chartEl || typeof Plotly === 'undefined' || !benford2D) return;
            var digits = benford2D.digits || []; if (digits.length === 0) return;
            var z = []; var x = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']; var y = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
            for (var row = 1; row <= 9; row++) { var rowData = []; for (var col = 0; col <= 9; col++) { var d = row * 10 + col; var digit = digits.find(function(x) { return x.digits === d; }); rowData.push(digit ? digit.deviationPct : 0); } z.push(rowData); }
            Plotly.newPlot(chartEl, [{ z: z, x: x, y: y, type: 'heatmap', colorscale: [[0, '#10b981'], [0.3, '#fef3c7'], [0.5, '#f59e0b'], [0.7, '#ef4444'], [1, '#991b1b']], zmin: -50, zmax: 100, colorbar: { title: 'Deviation %' } }], { xaxis: { title: 'Second Digit' }, yaxis: { title: 'First Digit', autorange: 'reversed' }, margin: { t: 20, r: 50, b: 50, l: 50 }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent' }, { responsive: true, displayModeBar: false });
        },

        renderDuplicatesTab: function() {
            var container = el("#integrityDuplicatesContent");
            if (!container || !this.latestData) return;
            var self = this;
            var duplicates = this.latestData.potentialDuplicates || [];
            
            // KPI row using buildKPIRow
            var totalAmount = duplicates.reduce(function(s, d) { return s + (d.amount || 0); }, 0);
            var highConfidence = duplicates.filter(function(d) { return d.confidence >= 0.9; }).length;
            var vendors = {}; duplicates.forEach(function(d) { vendors[d.vendor || 'Unknown'] = true; });
            var vendorCount = Object.keys(vendors).length;
            var avgDays = duplicates.length > 0 ? Math.round(duplicates.reduce(function(s, d) { return s + (d.daysBetween || 0); }, 0) / duplicates.length) : 0;
            
            var kpiHtml = this.buildKPIRow([
                { label: 'Potential Duplicates', value: duplicates.length, icon: 'copy', color: duplicates.length > 0 ? 'warning' : 'success' },
                { label: 'Total at Risk', value: fmtMoney(totalAmount), icon: 'dollar-sign', color: 'danger' },
                { label: 'High Confidence', value: highConfidence, icon: 'exclamation-circle', color: highConfidence > 0 ? 'warning' : 'success' },
                { label: 'Vendors Affected', value: vendorCount, icon: 'building' },
                { label: 'Avg Days Between', value: avgDays, icon: 'calendar' }
            ]);
            
            if (duplicates.length === 0) { 
                container.innerHTML = kpiHtml + '<div class="empty-state mt-3"><i class="fas fa-check-circle text-success fa-3x mb-3"></i><h5>No Duplicates Detected</h5><p>SQL-based scan found no potential duplicate payments</p></div>'; 
                return; 
            }
            
            // Apply sorting
            var sort = this.tableSort && this.tableSort.duplicates ? this.tableSort.duplicates : { col: 'confidence', dir: 'desc' };
            var sortedData = duplicates.slice().sort(function(a, b) {
                var aVal = a[sort.col], bVal = b[sort.col];
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
                }
                return sort.dir === 'asc' ? String(aVal || '').localeCompare(String(bVal || '')) : String(bVal || '').localeCompare(String(aVal || ''));
            });
            var sortIcon = function(col) { return sort.col === col ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort text-muted'; };
            
            var pag = this.pagination.duplicates; var startIdx = (pag.page - 1) * pag.pageSize; var pageItems = sortedData.slice(startIdx, startIdx + pag.pageSize);
            var rowsHtml = pageItems.map(function(d, idx) {
                var confClass = d.confidence >= 0.9 ? 'high' : d.confidence >= 0.8 ? 'med' : 'low';
                var riskClass = d.amount >= 10000 ? 'risk-high' : d.amount >= 1000 ? 'risk-med' : 'risk-low';
                var globalIdx = startIdx + idx;
                return '<tr class="dup-main-row clickable-row" data-idx="' + globalIdx + '" onclick="IntegrityController.openDuplicateFlyout(' + globalIdx + ')"><td class="dup-expand-cell"><button class="btn btn-xs btn-link dup-expand-btn" onclick="event.stopPropagation();IntegrityController.toggleDupDetail(' + globalIdx + ')"><i class="fas fa-chevron-right"></i></button></td><td><span class="dup-conf-badge conf-' + confClass + '">' + Math.round(d.confidence * 100) + '%</span></td><td class="dup-vendor-cell"><div class="dvc-name">' + (d.vendor || 'Unknown') + '</div><div class="dvc-memo text-muted small">' + (d.memo || d.description || '') + '</div></td><td class="text-right dup-amount ' + riskClass + '">' + fmtMoney(d.amount, 2) + '</td><td class="dup-tran-cell"><div class="dtc-primary">' + getNsLink(d.tranId1 || 'N/A', d.id1) + '</div><div class="dtc-date">' + d.date1 + '</div></td><td class="text-center"><i class="fas fa-exchange-alt text-muted"></i></td><td class="dup-tran-cell"><div class="dtc-primary">' + getNsLink(d.tranId2 || 'N/A', d.id2) + '</div><div class="dtc-date">' + d.date2 + '</div></td><td class="text-center"><span class="dup-days-badge">' + d.daysBetween + ' days</span></td></tr><tr class="dup-detail-row" id="dupDetail' + globalIdx + '" style="display: none;"><td colspan="8"><div class="dup-detail-content"><div class="ddc-grid"><div class="ddc-section"><strong>Transaction 1:</strong> ' + (d.tranId1 || 'N/A') + ' - ' + d.date1 + (d.type1 ? ' (' + d.type1 + ')' : '') + '</div><div class="ddc-section"><strong>Transaction 2:</strong> ' + (d.tranId2 || 'N/A') + ' - ' + d.date2 + (d.type2 ? ' (' + d.type2 + ')' : '') + '</div><div class="ddc-section"><strong>Match Reason:</strong> ' + (d.matchReason || 'Same vendor and amount within ' + d.daysBetween + ' days') + '</div>' + (d.createdBy1 ? '<div class="ddc-section"><strong>Created By:</strong> ' + d.createdBy1 + (d.createdBy2 && d.createdBy2 !== d.createdBy1 ? ' / ' + d.createdBy2 : '') + '</div>' : '') + '</div></div></td></tr>';
            }).join('');
            
            container.innerHTML = kpiHtml + 
                '<div class="alert alert-purple mb-2" style="background:#f5f3ff;border-color:#8b5cf6;"><i class="fas fa-copy mr-2" style="color:#8b5cf6;"></i><strong>Duplicate Detection</strong> - Identifies payments to the same vendor with matching amounts within configurable days. High confidence = exact match.</div>' +
                '<div class="dup-table-container"><table class="table table-sm dup-complex-table"><thead><tr><th style="width: 40px;"></th><th style="width: 70px;cursor:pointer" onclick="IntegrityController.sortTable(\'duplicates\',\'confidence\')">Conf <i class="fas ' + sortIcon('confidence') + '"></i></th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'duplicates\',\'vendor\')">Vendor / Memo <i class="fas ' + sortIcon('vendor') + '"></i></th><th class="text-right" style="width: 120px;cursor:pointer" onclick="IntegrityController.sortTable(\'duplicates\',\'amount\')">Amount <i class="fas ' + sortIcon('amount') + '"></i></th><th style="width: 130px;">Transaction 1</th><th style="width: 40px;"></th><th style="width: 130px;">Transaction 2</th><th style="width: 80px;cursor:pointer" class="text-center" onclick="IntegrityController.sortTable(\'duplicates\',\'daysBetween\')">Gap <i class="fas ' + sortIcon('daysBetween') + '"></i></th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' + 
                this.renderPagination(duplicates.length, pag.page, pag.pageSize, 'duplicates');
        },
        
        openDuplicateFlyout: function(idx) {
            var duplicates = (this.latestData && this.latestData.potentialDuplicates) || [];
            var dup = duplicates[idx];
            if (!dup) { showToast('Duplicate data not found'); return; }
            
            var transactions = [
                { tranId: dup.tranId1, id: dup.id1, type: dup.type1 || 'Transaction 1', amount: dup.amount, flagType: 'duplicate', riskScore: Math.round(dup.confidence * 100), tranDate: dup.date1 },
                { tranId: dup.tranId2, id: dup.id2, type: dup.type2 || 'Transaction 2', amount: dup.amount, flagType: 'duplicate', riskScore: Math.round(dup.confidence * 100), tranDate: dup.date2 }
            ];
            
            this.showTransactionsFlyout(
                dup.vendor || 'Potential Duplicate', 
                transactions, 
                Math.round(dup.confidence * 100) + '% match | ' + dup.daysBetween + ' days apart | ' + fmtMoney(dup.amount, 2)
            );
        },
        
        toggleDupDetail: function(idx) {
            var detailRow = el('#dupDetail' + idx); var btn = document.querySelector('.dup-main-row[data-idx="' + idx + '"] .dup-expand-btn i');
            if (detailRow) { var isHidden = detailRow.style.display === 'none'; detailRow.style.display = isHidden ? 'table-row' : 'none'; if (btn) btn.className = isHidden ? 'fas fa-chevron-down' : 'fas fa-chevron-right'; }
        },

        renderRSFTab: function() {
            var container = el("#integrityRSFContent");
            if (!container || !this.latestData) return;
            var self = this;
            var rsfData = this.latestData.rsfAnomalies || [];
            
            // KPI row
            var totalAtRisk = rsfData.reduce(function(s, r) { return s + (r.largestAmount || 0); }, 0);
            var avgRSF = rsfData.length > 0 ? (rsfData.reduce(function(s, r) { return s + (r.rsf || 0); }, 0) / rsfData.length).toFixed(1) : 0;
            var criticalCount = rsfData.filter(function(r) { return r.rsf >= 20; }).length;
            var kpiHtml = this.buildKPIRow([
                { label: 'RSF Anomalies', value: rsfData.length, icon: 'chart-line', color: rsfData.length > 0 ? 'warning' : 'success' },
                { label: 'Total at Risk', value: fmtMoney(totalAtRisk), icon: 'dollar-sign' },
                { label: 'Avg RSF', value: avgRSF + 'x', icon: 'times' },
                { label: 'Critical (≥20x)', value: criticalCount, icon: 'exclamation-triangle', color: criticalCount > 0 ? 'danger' : 'success' }
            ]);
            
            if (rsfData.length === 0) { 
                container.innerHTML = kpiHtml + '<div class="empty-state mt-3"><i class="fas fa-check-circle text-success fa-3x mb-3"></i><h5>No RSF Anomalies</h5><p>No unusually large single transactions detected</p></div>'; 
                return; 
            }
            
            // Apply sorting
            var sort = this.tableSort && this.tableSort.rsf ? this.tableSort.rsf : { col: 'rsf', dir: 'desc' };
            var sortedData = rsfData.slice().sort(function(a, b) {
                var aVal = a[sort.col], bVal = b[sort.col];
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
                }
                return sort.dir === 'asc' ? String(aVal || '').localeCompare(String(bVal || '')) : String(bVal || '').localeCompare(String(aVal || ''));
            });
            var sortIcon = function(col) { return sort.col === col ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort text-muted'; };
            
            var pag = this.pagination.rsf; var startIdx = (pag.page - 1) * pag.pageSize; var pageItems = sortedData.slice(startIdx, startIdx + pag.pageSize);
            var rowsHtml = pageItems.map(function(r) { 
                var rsfClass = r.rsf >= 20 ? 'rsf-critical' : r.rsf >= 10 ? 'rsf-high' : 'rsf-medium'; 
                var txnDisplay = r.tranId || ('Transaction #' + r.id); 
                var entityDisplay = r.vendorName || r.entityName || '-';
                return '<tr class="clickable-row" onclick="IntegrityController.openRSFDetailFlyout(' + JSON.stringify(r).replace(/"/g, '&quot;') + ')">' +
                    '<td><div class="rsf-vendor-name">' + txnDisplay + '</div><div class="rsf-vendor-stats text-muted small">' + (r.type || 'Transaction') + ' | ' + r.tranDate + '</div></td>' +
                    '<td>' + self.truncateValue(entityDisplay, 20) + '</td>' +
                    '<td class="text-right font-weight-bold">' + fmtMoney(r.largestAmount, 2) + '</td>' +
                    '<td class="text-right text-muted">' + fmtMoney(r.secondLargestAmount, 2) + '</td>' +
                    '<td class="text-center"><span class="rsf-badge ' + rsfClass + '">' + r.rsf.toFixed(1) + 'x</span></td>' +
                    '<td>' + getNsLink(r.tranId || 'N/A', r.id) + '</td>' +
                    '<td><span class="severity-dot ' + self.getSeverityClass(r.riskScore) + '"></span> ' + Math.round(r.riskScore) + '</td></tr>'; 
            }).join('');
            container.innerHTML = kpiHtml + 
                '<div class="alert alert-info py-2 mb-2"><i class="fas fa-chart-line mr-2"></i><strong>RSF Analysis</strong> - Relative Size Factor flags transactions ≥10x larger than the 2nd largest for that vendor. <code class="ml-2">RSF = Largest ÷ 2nd Largest</code></div>' +
                '<div class="table-responsive"><table class="table table-sm table-hover rsf-table">' +
                '<thead><tr><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'rsf\',\'tranId\')">Transaction <i class="fas ' + sortIcon('tranId') + '"></i></th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'rsf\',\'vendorName\')">Entity <i class="fas ' + sortIcon('vendorName') + '"></i></th><th class="text-right" style="cursor:pointer" onclick="IntegrityController.sortTable(\'rsf\',\'largestAmount\')">Amount <i class="fas ' + sortIcon('largestAmount') + '"></i></th><th class="text-right">2nd Largest</th><th class="text-center" style="cursor:pointer" onclick="IntegrityController.sortTable(\'rsf\',\'rsf\')">RSF <i class="fas ' + sortIcon('rsf') + '"></i></th><th>Link</th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'rsf\',\'riskScore\')">Risk <i class="fas ' + sortIcon('riskScore') + '"></i></th></tr></thead>' +
                '<tbody>' + rowsHtml + '</tbody></table></div>' + 
                this.renderPagination(rsfData.length, pag.page, pag.pageSize, 'rsf');
        },

        renderZScoreTab: function() {
            var container = el("#integrityZScoreContent");
            if (!container || !this.latestData) return;
            var self = this;
            var zscoreData = this.latestData.zScoreAnomalies || [];
            
            // KPI row
            var totalAtRisk = zscoreData.reduce(function(s, z) { return s + (z.amount || 0); }, 0);
            var avgZ = zscoreData.length > 0 ? (zscoreData.reduce(function(s, z) { return s + Math.abs(z.zScore || 0); }, 0) / zscoreData.length).toFixed(1) : 0;
            var criticalCount = zscoreData.filter(function(z) { return Math.abs(z.zScore) >= 4; }).length;
            var kpiHtml = this.buildKPIRow([
                { label: 'Z-Score Anomalies', value: zscoreData.length, icon: 'superscript', color: zscoreData.length > 0 ? 'warning' : 'success' },
                { label: 'Total at Risk', value: fmtMoney(totalAtRisk), icon: 'dollar-sign' },
                { label: 'Avg |Z|', value: avgZ + 'σ', icon: 'chart-area' },
                { label: 'Critical (≥4σ)', value: criticalCount, icon: 'exclamation-triangle', color: criticalCount > 0 ? 'danger' : 'success' }
            ]);
            
            if (zscoreData.length === 0) { 
                container.innerHTML = kpiHtml + '<div class="empty-state mt-3"><i class="fas fa-check-circle text-success fa-3x mb-3"></i><h5>No Z-Score Anomalies</h5><p>No transactions deviate significantly from vendor baselines</p></div>'; 
                return; 
            }
            
            // Apply sorting
            var sort = this.tableSort && this.tableSort.zscore ? this.tableSort.zscore : { col: 'zScore', dir: 'desc' };
            var sortedData = zscoreData.slice().sort(function(a, b) {
                var aVal = sort.col === 'zScore' ? Math.abs(a[sort.col] || 0) : a[sort.col];
                var bVal = sort.col === 'zScore' ? Math.abs(b[sort.col] || 0) : b[sort.col];
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
                }
                return sort.dir === 'asc' ? String(aVal || '').localeCompare(String(bVal || '')) : String(bVal || '').localeCompare(String(aVal || ''));
            });
            var sortIcon = function(col) { return sort.col === col ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort text-muted'; };
            
            var pag = this.pagination.zscore; var startIdx = (pag.page - 1) * pag.pageSize; var pageItems = sortedData.slice(startIdx, startIdx + pag.pageSize);
            var rowsHtml = pageItems.map(function(z) {
                var zsClass = Math.abs(z.zScore) >= 4 ? 'zs-critical' : Math.abs(z.zScore) >= 3 ? 'zs-high' : 'zs-medium';
                var txnDisplay = z.tranId || ('Transaction #' + z.id);
                var entityDisplay = z.vendorName || z.entityName || '-';
                var txnCount = z.vendorTxnCount ? ' (' + z.vendorTxnCount + ' txns)' : '';
                return '<tr class="clickable-row" onclick="IntegrityController.openZScoreDetailFlyout(' + JSON.stringify(z).replace(/"/g, '&quot;') + ')">' +
                    '<td><div class="zs-vendor-name">' + txnDisplay + '</div><div class="zs-vendor-stats text-muted small">' + (z.type || 'Transaction') + ' | ' + z.tranDate + '</div></td>' +
                    '<td>' + self.truncateValue(entityDisplay, 20) + txnCount + '</td>' +
                    '<td class="text-right font-weight-bold">' + fmtMoney(z.amount, 2) + '</td>' +
                    '<td class="text-center"><span class="zs-badge ' + zsClass + '">' + z.zScore.toFixed(2) + 'σ</span></td>' +
                    '<td class="text-right text-muted">' + fmtMoney(z.avgAmount, 2) + '</td>' +
                    '<td>' + getNsLink(z.tranId || 'N/A', z.id) + '</td>' +
                    '<td><span class="severity-dot ' + self.getSeverityClass(z.riskScore) + '"></span> ' + z.riskScore + '</td></tr>';
            }).join('');
            container.innerHTML = kpiHtml + 
                '<div class="alert alert-info py-2 mb-2"><i class="fas fa-superscript mr-2"></i><strong>Z-Score Analysis</strong> - Per-vendor statistical outlier detection. Flags transactions ≥' + (this.configData.zScoreThreshold || 3) + 'σ from that vendor\'s average. <code class="ml-2">Z = (Amt - Mean) ÷ σ</code></div>' +
                '<div id="zscoreScatterPlot" style="height: 200px; margin-bottom: 10px;"></div>' +
                '<div class="table-responsive"><table class="table table-sm table-hover zscore-table">' +
                '<thead><tr><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'zscore\',\'tranId\')">Transaction <i class="fas ' + sortIcon('tranId') + '"></i></th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'zscore\',\'vendorName\')">Entity <i class="fas ' + sortIcon('vendorName') + '"></i></th><th class="text-right" style="cursor:pointer" onclick="IntegrityController.sortTable(\'zscore\',\'amount\')">Amount <i class="fas ' + sortIcon('amount') + '"></i></th><th class="text-center" style="cursor:pointer" onclick="IntegrityController.sortTable(\'zscore\',\'zScore\')">Z-Score <i class="fas ' + sortIcon('zScore') + '"></i></th><th class="text-right">Vendor Avg</th><th>Link</th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'zscore\',\'riskScore\')">Risk <i class="fas ' + sortIcon('riskScore') + '"></i></th></tr></thead>' +
                '<tbody>' + rowsHtml + '</tbody></table></div>' + 
                this.renderPagination(zscoreData.length, pag.page, pag.pageSize, 'zscore');
            setTimeout(function() { self.renderZScoreScatter(); }, 100);
        },

        renderZScoreScatter: function() {
            var chartEl = document.getElementById('zscoreScatterPlot');
            if (!chartEl || typeof Plotly === 'undefined' || !this.latestData) return;
            var zscoreData = this.latestData.zScoreAnomalies || [];
            if (zscoreData.length === 0) return;
            Plotly.newPlot(chartEl, [{
                x: zscoreData.map(function(z) { return z.amount; }),
                y: zscoreData.map(function(z) { return z.zScore; }),
                mode: 'markers',
                type: 'scatter',
                text: zscoreData.map(function(z) { return z.tranId + '<br>' + (z.type || 'Transaction'); }),
                marker: {
                    size: 10,
                    color: zscoreData.map(function(z) { return Math.abs(z.zScore) >= 4 ? '#ef4444' : Math.abs(z.zScore) >= 3 ? '#f59e0b' : '#3b82f6'; })
                }
            }], {
                xaxis: { title: 'Transaction Amount', tickformat: '$,.0f' },
                yaxis: { title: 'Z-Score (σ)' },
                margin: { t: 20, r: 20, b: 50, l: 60 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                shapes: [{ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 3, y1: 3, line: { color: '#f59e0b', width: 1, dash: 'dash' } }, { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: -3, y1: -3, line: { color: '#f59e0b', width: 1, dash: 'dash' } }]
            }, { responsive: true, displayModeBar: false });
        },

        // Ghost Vendors Tab (split from Forensic)
        renderGhostTab: function() {
            var container = el("#integrityGhostContent");
            if (!container || !this.latestData) return;
            var self = this;
            var ghostVendors = this.latestData.ghostVendors || [];
            
            // KPI row
            var totalAmount = ghostVendors.reduce(function(s, g) { return s + (g.totalAmount || 0); }, 0);
            var totalTrans = ghostVendors.reduce(function(s, g) { return s + (g.transactionCount || 0); }, 0);
            var kpiHtml = this.buildKPIRow([
                { label: 'Ghost Vendors', value: ghostVendors.length, icon: 'user-secret', color: ghostVendors.length > 0 ? 'danger' : 'success' },
                { label: 'Total at Risk', value: fmtMoney(totalAmount), icon: 'dollar-sign', color: 'warning' },
                { label: 'Transactions', value: totalTrans, icon: 'exchange-alt' },
                { label: 'Employees Matched', value: [...new Set(ghostVendors.map(function(g) { return g.employeeName; }))].length, icon: 'users' }
            ]);
            
            if (ghostVendors.length === 0) {
                container.innerHTML = kpiHtml + '<div class="empty-state mt-3"><i class="fas fa-check-circle text-success fa-3x mb-3"></i><h5>No Ghost Vendors Detected</h5><p>No vendors share addresses with employees</p></div>';
                return;
            }
            
            // Apply sorting
            var sort = this.tableSort && this.tableSort.ghost ? this.tableSort.ghost : { col: 'totalAmount', dir: 'desc' };
            var sortedData = ghostVendors.slice().sort(function(a, b) {
                var aVal = a[sort.col], bVal = b[sort.col];
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
                }
                return sort.dir === 'asc' ? String(aVal || '').localeCompare(String(bVal || '')) : String(bVal || '').localeCompare(String(aVal || ''));
            });
            var sortIcon = function(col) { return sort.col === col ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort text-muted'; };
            
            var pag = this.pagination.ghost || { page: 1, pageSize: 15 };
            var startIdx = (pag.page - 1) * pag.pageSize;
            var pageItems = sortedData.slice(startIdx, startIdx + pag.pageSize);
            
            var rowsHtml = pageItems.map(function(g) {
                return '<tr class="clickable-row" onclick="IntegrityController.openEntityFlyout(\'vendor\', \'' + g.vendorId + '\', \'' + (g.vendorName || '').replace(/'/g, "\\'") + '\')">' +
                    '<td><strong>' + g.vendorName + '</strong></td>' +
                    '<td>' + (g.employeeName || 'Unknown') + '</td>' +
                    '<td class="small text-truncate" style="max-width: 200px;" title="' + (g.matchedAddress || '') + '">' + (g.matchedAddress || 'Address match') + '</td>' +
                    '<td class="text-center">' + (g.transactionCount || 0) + '</td>' +
                    '<td class="text-right font-weight-bold">' + fmtMoney(g.totalAmount || 0) + '</td>' +
                    '<td>' + self.renderFlagActions({ id: g.vendorId, flagType: 'ghost' }) + '</td>' +
                '</tr>';
            }).join('');
            
            container.innerHTML = kpiHtml +
                '<div class="alert alert-danger py-2 mb-2"><i class="fas fa-exclamation-triangle mr-2"></i><strong>Ghost Vendor Alert</strong> - Vendors sharing addresses with employees may indicate fictitious vendor schemes.</div>' +
                '<div class="table-responsive"><table class="table table-sm table-hover">' +
                '<thead><tr><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'ghost\',\'vendorName\')">Vendor <i class="fas ' + sortIcon('vendorName') + '"></i></th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'ghost\',\'employeeName\')">Employee Match <i class="fas ' + sortIcon('employeeName') + '"></i></th><th>Address</th><th class="text-center" style="cursor:pointer" onclick="IntegrityController.sortTable(\'ghost\',\'transactionCount\')">Trans <i class="fas ' + sortIcon('transactionCount') + '"></i></th><th class="text-right" style="cursor:pointer" onclick="IntegrityController.sortTable(\'ghost\',\'totalAmount\')">Amount <i class="fas ' + sortIcon('totalAmount') + '"></i></th><th>Actions</th></tr></thead>' +
                '<tbody>' + rowsHtml + '</tbody></table></div>' +
                this.renderPagination(ghostVendors.length, pag.page, pag.pageSize, 'ghost');
        },
        
        // Sequential Invoices Tab (split from Forensic)
        renderSequentialTab: function() {
            var container = el("#integritySequentialContent");
            if (!container || !this.latestData) return;
            var self = this;
            var sequentialInvoices = this.latestData.sequentialInvoices || [];

            // Calculate statistics
            var totalAmount = sequentialInvoices.reduce(function(s, seq) { return s + (seq.totalAmount || 0); }, 0);
            var totalInvoices = sequentialInvoices.reduce(function(s, seq) {
                return s + (seq.count || seq.sequenceLength || (seq.invoices ? seq.invoices.length : 0));
            }, 0);
            // High risk = spread over 30+ days (shell company indicator)
            var highRiskCount = sequentialInvoices.filter(function(s) { return s.riskLevel === 'high' || s.dateSpanDays >= 30; }).length;

            var kpiHtml = this.buildKPIRow([
                { label: 'Patterns Found', value: sequentialInvoices.length, icon: 'sort-numeric-down', color: sequentialInvoices.length > 0 ? 'warning' : 'success' },
                { label: 'High Risk (30+ days)', value: highRiskCount, icon: 'exclamation-triangle', color: highRiskCount > 0 ? 'danger' : 'success', subtext: 'Shell company indicator' },
                { label: 'Total Invoices', value: totalInvoices, icon: 'file-invoice' },
                { label: 'Total Amount', value: fmtMoney(totalAmount), icon: 'dollar-sign' }
            ]);

            if (sequentialInvoices.length === 0) {
                container.innerHTML = kpiHtml + '<div class="empty-state mt-3"><i class="fas fa-check-circle text-success fa-3x mb-3"></i><h5>No Suspicious Sequential Patterns</h5><p>No shell company indicators detected.</p><p class="text-muted small">Same-day sequential invoices (bulk orders) and normal vendor patterns are not flagged.</p></div>';
                return;
            }

            // Apply sorting
            var sort = this.tableSort && this.tableSort.sequential ? this.tableSort.sequential : { col: 'riskScore', dir: 'desc' };
            var sortedData = sequentialInvoices.slice().sort(function(a, b) {
                var aVal = a[sort.col], bVal = b[sort.col];
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
                }
                return sort.dir === 'asc' ? String(aVal || '').localeCompare(String(bVal || '')) : String(bVal || '').localeCompare(String(aVal || ''));
            });
            var sortIcon = function(col) { return sort.col === col ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort text-muted'; };

            var pag = this.pagination.sequential || { page: 1, pageSize: 15 };
            var startIdx = (pag.page - 1) * pag.pageSize;
            var pageItems = sortedData.slice(startIdx, startIdx + pag.pageSize);

            var rowsHtml = pageItems.map(function(s, idx) {
                var invoices = s.invoices || [];
                var dates = invoices.map(function(i) { return i.tranDate; }).filter(Boolean).sort();
                var dateRange = dates.length > 1 ? dates[0] + ' - ' + dates[dates.length - 1] : (dates[0] || '-');
                var firstTranId = invoices.length > 0 ? invoices[0].tranId : 'N/A';
                var entityName = s.entityName || (invoices.length > 0 && invoices[0].entityName) || 'Unknown';

                // Date span indicator - MORE days = MORE suspicious (reversed from before)
                var dateSpanDays = s.dateSpanDays != null ? s.dateSpanDays : null;
                var clusterBadge = '';
                if (dateSpanDays != null && dateSpanDays >= 30) {
                    // 30+ days spread = HIGH risk (shell company indicator)
                    clusterBadge = '<span class="badge badge-danger ml-1" title="Sequential over ' + dateSpanDays + ' days - possible shell company">' + dateSpanDays + ' days</span>';
                } else if (dateSpanDays != null && dateSpanDays >= 7) {
                    // 7-30 days = MEDIUM risk
                    clusterBadge = '<span class="badge badge-warning ml-1" title="Sequential over ' + dateSpanDays + ' days">' + dateSpanDays + ' days</span>';
                } else if (dateSpanDays != null) {
                    // Less than 7 days (shouldn't appear since we don't flag these)
                    clusterBadge = '<span class="badge badge-secondary ml-1">' + dateSpanDays + ' days</span>';
                }

                return '<tr class="clickable-row" onclick="IntegrityController.openSequentialDetailFlyout(' + idx + ')">' +
                    '<td><strong>' + firstTranId + '</strong></td>' +
                    '<td>' + self.truncateValue(entityName, 25) + '</td>' +
                    '<td class="font-monospace">' + (s.startInvoice || s.startNum) + ' - ' + (s.endInvoice || s.endNum) + '</td>' +
                    '<td class="text-center">' + (s.count || s.sequenceLength || invoices.length) + '</td>' +
                    '<td class="small">' + dateRange + clusterBadge + '</td>' +
                    '<td class="text-right font-weight-bold">' + fmtMoney(s.totalAmount || 0, 2) + '</td>' +
                    '<td><span class="risk-score-badge ' + self.getSeverityClass(s.riskScore) + '">' + s.riskScore + '</span></td>' +
                '</tr>';
            }).join('');

            container.innerHTML = kpiHtml +
                '<div class="alert alert-warning py-2 mb-2"><i class="fas fa-building mr-2"></i><strong>Shell Company Detection</strong> - Sequential invoice numbers with <strong>no gaps over time</strong> suggest you may be the vendor\'s ONLY customer. Legitimate vendors have gaps because they invoice other customers. Longer time spans = higher risk.</div>' +
                '<div class="table-responsive"><table class="table table-sm table-hover">' +
                '<thead><tr><th>First Invoice</th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'sequential\',\'entityName\')">Entity <i class="fas ' + sortIcon('entityName') + '"></i></th><th>Invoice Range</th><th class="text-center" style="cursor:pointer" onclick="IntegrityController.sortTable(\'sequential\',\'sequenceLength\')">Count <i class="fas ' + sortIcon('sequenceLength') + '"></i></th><th>Date Range</th><th class="text-right" style="cursor:pointer" onclick="IntegrityController.sortTable(\'sequential\',\'totalAmount\')">Amount <i class="fas ' + sortIcon('totalAmount') + '"></i></th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'sequential\',\'riskScore\')">Risk <i class="fas ' + sortIcon('riskScore') + '"></i></th></tr></thead>' +
                '<tbody>' + rowsHtml + '</tbody></table></div>' +
                this.renderPagination(sequentialInvoices.length, pag.page, pag.pageSize, 'sequential');
        },

        renderWeekendTab: function() {
            var container = el("#integrityWeekendContent");
            if (!container || !this.latestData) return;
            var self = this;
            var entries = this.latestData.weekendEntries || [];
            
            if (entries.length === 0) { container.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-check text-success fa-3x mb-3"></i><h5>No Weekend Entries</h5><p>No transactions created on weekends</p></div>'; return; }
            
            var userGroups = {}; entries.forEach(function(e) { 
                var usrId = e.createdById || 'unknown';
                var user = e.createdBy || (e.createdById ? 'User #' + e.createdById : 'Unknown'); 
                if (!userGroups[usrId]) userGroups[usrId] = { id: usrId, name: user, count: 0, amount: 0, entries: [] }; 
                userGroups[usrId].count++; 
                userGroups[usrId].amount += e.amount || 0; 
                userGroups[usrId].entries.push(e); 
            });
            var topUsers = Object.values(userGroups).sort(function(a, b) { return b.count - a.count; }).slice(0, 5);
            var totalAmount = entries.reduce(function(s, e) { return s + (e.amount || 0); }, 0);
            var satCount = entries.filter(function(e) { return e.dayType === 'Saturday'; }).length;
            var sunCount = entries.filter(function(e) { return e.dayType === 'Sunday'; }).length;
            
            // KPI row using buildKPIRow
            var kpiHtml = this.buildKPIRow([
                { label: 'Weekend Entries', value: entries.length, icon: 'calendar-week', color: 'info' },
                { label: 'Total Amount', value: fmtMoney(totalAmount), icon: 'dollar-sign', color: 'danger' },
                { label: 'Saturday', value: satCount, icon: 'calendar-day' },
                { label: 'Sunday', value: sunCount, icon: 'calendar-day' },
                { label: 'Users Involved', value: Object.keys(userGroups).length, icon: 'users' }
            ]);
            
            // Apply sorting
            var sort = this.tableSort && this.tableSort.weekend ? this.tableSort.weekend : { col: 'tranDate', dir: 'desc' };
            var sortedEntries = entries.slice().sort(function(a, b) {
                var aVal = a[sort.col], bVal = b[sort.col];
                if (sort.col === 'amount' || sort.col === 'riskScore') {
                    return sort.dir === 'asc' ? (aVal || 0) - (bVal || 0) : (bVal || 0) - (aVal || 0);
                }
                return sort.dir === 'asc' ? String(aVal || '').localeCompare(String(bVal || '')) : String(bVal || '').localeCompare(String(aVal || ''));
            });
            var sortIcon = function(col) { return sort.col === col ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort text-muted'; };
            
            var pag = this.pagination.weekend; var startIdx = (pag.page - 1) * pag.pageSize; var pageItems = sortedEntries.slice(startIdx, startIdx + pag.pageSize);
            var rowsHtml = pageItems.map(function(e, idx) { 
                var createdByDisplay = e.createdBy || (e.createdById ? 'User #' + e.createdById : '-'); 
                var globalIdx = startIdx + idx;
                return '<tr class="clickable-row" onclick="IntegrityController.openWeekendDetailFlyout(' + globalIdx + ')"><td>' + e.tranDate + '</td><td><span class="day-badge ' + e.dayType.toLowerCase() + '">' + e.dayType + '</span></td><td>' + getNsLink(e.tranId || 'N/A', e.id) + '</td><td>' + e.type + '</td><td class="text-right font-weight-bold">' + fmtMoney(e.amount, 2) + '</td><td>' + createdByDisplay + '</td><td><span class="severity-dot ' + self.getSeverityClass(e.riskScore) + '"></span> ' + Math.round(e.riskScore || 0) + '</td></tr>'; 
            }).join('');
            var usersHtml = topUsers.map(function(u) { return '<div class="weekend-user-card clickable-row mr-2 mb-1" onclick="IntegrityController.openWeekendUserFlyout(\'' + u.id + '\', \'' + (u.name).replace(/'/g, "\\'") + '\')"><div class="wuc-avatar">' + self.getInitials(u.name) + '</div><div class="wuc-info"><div class="wuc-name">' + u.name + '</div><div class="wuc-stats">' + u.count + ' entries | ' + fmtMoney(u.amount, 2) + '</div></div></div>'; }).join('');
            
            container.innerHTML = kpiHtml + 
                '<div class="alert alert-info py-2 mb-2"><i class="fas fa-calendar-week mr-2"></i><strong>Weekend Entry Analysis</strong> - Transactions created on Saturdays or Sundays may indicate unauthorized activity or control bypass.</div>' +
                '<div class="mb-2"><small class="text-muted font-weight-bold"><i class="fas fa-users mr-1"></i>Top Weekend Users</small><div class="d-flex flex-wrap mt-1">' + usersHtml + '</div></div>' +
                '<div class="table-responsive"><table class="table table-sm table-hover weekend-table"><thead><tr><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'weekend\',\'tranDate\')">Date <i class="fas ' + sortIcon('tranDate') + '"></i></th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'weekend\',\'dayType\')">Day <i class="fas ' + sortIcon('dayType') + '"></i></th><th>Tran #</th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'weekend\',\'type\')">Type <i class="fas ' + sortIcon('type') + '"></i></th><th class="text-right" style="cursor:pointer" onclick="IntegrityController.sortTable(\'weekend\',\'amount\')">Amount <i class="fas ' + sortIcon('amount') + '"></i></th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'weekend\',\'createdBy\')">Created By <i class="fas ' + sortIcon('createdBy') + '"></i></th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'weekend\',\'riskScore\')">Risk <i class="fas ' + sortIcon('riskScore') + '"></i></th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' + 
                this.renderPagination(entries.length, pag.page, pag.pageSize, 'weekend');
        },
        
        openWeekendUserFlyout: function(userId, userName) {
            var self = this;
            var flyout = document.getElementById('atFlyout');
            if (!flyout) { console.error('Flyout not found'); return; }
            
            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');
            
            document.getElementById('atFlyoutTitle').textContent = userName || 'Weekend User';
            var _sub = document.getElementById('atFlyoutSubtitle'); _sub.textContent = 'Loading weekend entries...'; _sub.style.display = _sub.textContent ? 'block' : 'none';
            document.getElementById('atFlyoutStats').innerHTML = '';
            document.getElementById('atFlyoutBody').innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading weekend entries...</div></div>';
            
            var startDate = el('#integrityStartDate');
            var endDate = el('#integrityEndDate');
            startDate = startDate ? startDate.value : '';
            endDate = endDate ? endDate.value : '';
            
            var params = {
                subAction: 'weekend_user_entries',
                userId: userId,
                startDate: startDate,
                endDate: endDate,
                subsidiaryId: self.subsidiaryId || ''
            };
            
            API.post('integrity', params)
                .then(function(res) {
                    if (res.status === 'success' && res.transactions && res.transactions.length > 0) {
                        var transactions = res.transactions;
                        var total = transactions.reduce(function(s, t) { return s + (parseFloat(t.amount) || 0); }, 0);
                        
                        document.getElementById('atFlyoutSubtitle').style.display = 'none';
                        
                        document.getElementById('atFlyoutStats').innerHTML = IntegrityController.buildFlyoutKPIs([
                            { label: 'Total', value: fmtMoney(total), icon: 'dollar-sign', color: 'primary' },
                            { label: 'Count', value: transactions.length, icon: 'calendar-week', color: 'warning' }
                        ]);
                        
                        var rowsHtml = transactions.map(function(t) {
                            return '<tr>' +
                                '<td>' + getNsLink(t.tranId || 'N/A', t.id) + '</td>' +
                                '<td>' + (t.type || '-') + '</td>' +
                                '<td>' + (t.tranDate || '-') + '</td>' +
                                '<td><span class="day-badge ' + (t.dayType || '').toLowerCase() + '">' + (t.dayType || '-') + '</span></td>' +
                                '<td class="text-right font-weight-bold">' + fmtMoney(t.amount, 2) + '</td>' +
                            '</tr>';
                        }).join('');
                        
                        document.getElementById('atFlyoutBody').innerHTML = 
                            '<table class="table table-sm table-hover">' +
                            '<thead><tr><th>Tran #</th><th>Type</th><th>Date</th><th>Day</th><th class="text-right">Amount</th></tr></thead>' +
                            '<tbody>' + rowsHtml + '</tbody></table>';
                    } else {
                        // Fallback to local data
                        self.openWeekendUserFlyoutFromLocal(userId, userName);
                    }
                })
                .catch(function(err) {
                    console.error('Weekend user flyout error:', err);
                    // Fallback to local data
                    self.openWeekendUserFlyoutFromLocal(userId, userName);
                });
        },
        
        // Weekend detail flyout - shows single transaction details (like RSF/Z-Score)
        openWeekendDetailFlyout: function(idx) {
            var entries = (this.latestData && this.latestData.weekendEntries) || [];
            var entry = entries[idx];
            if (!entry) { showToast('Weekend entry not found'); return; }
            
            var flyout = document.getElementById('atFlyout');
            if (!flyout) return;
            
            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');
            
            var title = entry.tranId || ('Transaction #' + entry.id);
            document.getElementById('atFlyoutTitle').textContent = title;
            document.getElementById('atFlyoutSubtitle').style.display = 'none';
            
            var statsHtml = this.buildFlyoutKPIs([
                { label: 'Day', value: entry.dayType || 'Weekend', icon: 'calendar-day', color: entry.dayType === 'Sunday' ? 'warning' : 'info' },
                { label: 'Amount', value: fmtMoney(entry.amount, 2), icon: 'dollar-sign', color: 'primary' },
                { label: 'Created By', value: entry.createdBy || 'Unknown', icon: 'user', color: 'info' },
                { label: 'Risk Score', value: Math.round(entry.riskScore || 0), icon: 'exclamation-triangle', color: entry.riskScore >= 70 ? 'danger' : entry.riskScore >= 40 ? 'warning' : 'success' }
            ]);
            document.getElementById('atFlyoutStats').innerHTML = statsHtml;
            
            var createdByDisplay = entry.createdBy || (entry.createdById ? 'User #' + entry.createdById : 'Unknown');
            var bodyHtml = '<div class="p-3">' +
                '<div class="alert alert-info mb-3"><i class="fas fa-calendar-week mr-2"></i><strong>Weekend Entry Flag</strong><br>' +
                'This transaction was created on a ' + (entry.dayType || 'weekend day') + ', which may warrant review.</div>' +
                '<div class="mb-3"><strong>Transaction Details:</strong>' +
                '<table class="table table-sm mt-2"><thead><tr><th>Tran #</th><th>Date</th><th>Type</th><th>Amount</th></tr></thead>' +
                '<tbody><tr><td>' + getNsLink(entry.tranId || 'N/A', entry.id) + '</td><td>' + (entry.tranDate || 'N/A') + '</td><td>' + (entry.type || '-') + '</td><td class="font-weight-bold">' + fmtMoney(entry.amount, 2) + '</td></tr></tbody></table></div>' +
                '<div class="mb-3"><strong>Created By:</strong> ' + createdByDisplay + '</div>' +
                '<div><strong>Why This Matters:</strong><p class="text-muted small mb-0">Transactions created on weekends may indicate unauthorized activity, backdating, or policy violations. Review to ensure legitimate business purpose.</p></div>' +
                '</div>';
            document.getElementById('atFlyoutBody').innerHTML = bodyHtml;
        },
        
        // Fallback to local data for weekend user flyout
        openWeekendUserFlyoutFromLocal: function(userId, userName) {
            var self = this;
            var allEntries = (this.latestData && this.latestData.weekendEntries) || [];
            var userEntries = allEntries.filter(function(e) { 
                return String(e.createdById || 'unknown') === String(userId); 
            });
            
            if (userEntries.length === 0) { 
                var _sub = document.getElementById('atFlyoutSubtitle'); _sub.textContent = 'No weekend entries found'; _sub.style.display = _sub.textContent ? 'block' : 'none';
                document.getElementById('atFlyoutBody').innerHTML = '<div class="text-center py-5 text-muted"><i class="fas fa-inbox fa-2x mb-2"></i><div>No weekend entries for this user</div></div>';
                return; 
            }
            
            // Format as transactions for showTransactionsFlyout
            var transactions = userEntries.map(function(e) {
                return {
                    tranId: e.tranId,
                    id: e.id,
                    type: e.type,
                    amount: e.amount,
                    flagType: 'weekend',
                    riskScore: e.riskScore,
                    tranDate: e.tranDate,
                    dayType: e.dayType
                };
            });
            
            var total = userEntries.reduce(function(s, e) { return s + (e.amount || 0); }, 0);
            
            document.getElementById('atFlyoutSubtitle').style.display = 'none';
            
            document.getElementById('atFlyoutStats').innerHTML = this.buildFlyoutKPIs([
                { label: 'Total', value: fmtMoney(total), icon: 'dollar-sign', color: 'primary' },
                { label: 'Count', value: userEntries.length, icon: 'calendar-week', color: 'warning' }
            ]);
            
            var rowsHtml = transactions.map(function(t) {
                return '<tr>' +
                    '<td>' + getNsLink(t.tranId || 'N/A', t.id) + '</td>' +
                    '<td>' + (t.type || '-') + '</td>' +
                    '<td>' + (t.tranDate || '-') + '</td>' +
                    '<td><span class="day-badge ' + (t.dayType || '').toLowerCase() + '">' + (t.dayType || '-') + '</span></td>' +
                    '<td class="text-right font-weight-bold">' + fmtMoney(t.amount, 2) + '</td>' +
                '</tr>';
            }).join('');
            
            document.getElementById('atFlyoutBody').innerHTML = 
                '<table class="table table-sm table-hover">' +
                '<thead><tr><th>Tran #</th><th>Type</th><th>Date</th><th>Day</th><th class="text-right">Amount</th></tr></thead>' +
                '<tbody>' + rowsHtml + '</tbody></table>';
        },
        
        toggleWeekendSystemFilter: function(exclude) {
            var cfg = this.configData || this.getDefaultConfig();
            cfg.excludeSystemUsers = exclude;
            this.configData = cfg;
            this.pagination.weekend.page = 1;
            this.renderWeekendTab();
        },
        
        getInitials: function(name) { if (!name) return '?'; var parts = name.split(/[\s,]+/); return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.substring(0, 2).toUpperCase(); },

        renderVendorAnalysisTab: function() {
            var container = el("#integrityVendorContent");
            if (!container || !this.latestData) return;
            var self = this;
            var vendorRisk = this.latestData.vendorRiskAnalysis || [];
            var viewMode = this.vendorViewMode || 'card';
            
            // KPI row
            var totalAmount = vendorRisk.reduce(function(s, v) { return s + (v.totalAmount || 0); }, 0);
            var totalFlags = vendorRisk.reduce(function(s, v) { return s + (v.flagCount || 0); }, 0);
            var highRiskCount = vendorRisk.filter(function(v) { return v.riskScore >= 70; }).length;
            var kpiHtml = this.buildKPIRow([
                { label: 'Flagged Vendors', value: vendorRisk.length, icon: 'building', color: vendorRisk.length > 0 ? 'warning' : 'success' },
                { label: 'Total Amount', value: fmtMoney(totalAmount), icon: 'dollar-sign' },
                { label: 'Total Flags', value: totalFlags, icon: 'flag' },
                { label: 'High Risk', value: highRiskCount, icon: 'exclamation-triangle', color: highRiskCount > 0 ? 'danger' : 'success' }
            ]);
            
            if (vendorRisk.length === 0) { 
                container.innerHTML = kpiHtml + '<div class="empty-state mt-3"><i class="fas fa-building text-muted fa-3x mb-3"></i><h5>No Vendor Risk Data</h5></div>'; 
                return; 
            }
            var pag = this.pagination.vendors; var startIdx = (pag.page - 1) * pag.pageSize; var pageVendors = vendorRisk.slice(startIdx, startIdx + pag.pageSize);
            
            // Header with toggle inline
            var headerHtml = '<div class="d-flex justify-content-between align-items-center mb-1">' +
                '<small class="text-muted">' + vendorRisk.length + ' vendors with flags</small>' +
                '<div class="btn-group btn-group-sm">' +
                '<button class="btn btn-xs ' + (viewMode === 'card' ? 'btn-primary' : 'btn-outline-secondary') + '" onclick="IntegrityController.setVendorViewMode(\'card\')" title="Card View"><i class="fas fa-th-large"></i></button>' +
                '<button class="btn btn-xs ' + (viewMode === 'table' ? 'btn-primary' : 'btn-outline-secondary') + '" onclick="IntegrityController.setVendorViewMode(\'table\')" title="Table View"><i class="fas fa-table"></i></button>' +
                '</div></div>';
            
            var contentHtml = '';
            if (viewMode === 'card') {
                contentHtml = '<div class="vendor-risk-grid">' + pageVendors.map(function(v) { 
                    var riskClass = v.riskScore >= 70 ? 'high' : v.riskScore >= 40 ? 'medium' : 'low'; 
                    return '<div class="vendor-risk-card risk-' + riskClass + ' clickable-row" onclick="IntegrityController.openEntityFlyout(\'vendor\', \'' + v.vendorId + '\', \'' + (v.vendorName || '').replace(/'/g, "\\'") + '\')"><div class="vrc-header"><div class="vrc-name">' + v.vendorName + '</div><div class="vrc-score"><span class="risk-score-badge ' + self.getSeverityClass(v.riskScore) + '">' + v.riskScore + '</span></div></div><div class="vrc-body"><div class="vrc-stats"><div class="vrc-stat"><span class="vrc-stat-val">' + v.flagCount + '</span><span class="vrc-stat-lbl">Flags</span></div><div class="vrc-stat"><span class="vrc-stat-val">' + fmtMoney(v.totalAmount, 2) + '</span><span class="vrc-stat-lbl">Total</span></div><div class="vrc-stat"><span class="vrc-stat-val">' + v.transactionCount + '</span><span class="vrc-stat-lbl">Txns</span></div></div><div class="vrc-flags">' + (v.flagTypes || []).map(function(ft) { return self.getFlagPill(ft); }).join('') + '</div></div></div>'; 
                }).join('') + '</div>';
            } else {
                // Apply sorting
                var sort = this.tableSort && this.tableSort.vendors ? this.tableSort.vendors : { col: 'riskScore', dir: 'desc' };
                var sortedVendors = pageVendors.slice().sort(function(a, b) {
                    var aVal = a[sort.col], bVal = b[sort.col];
                    if (typeof aVal === 'number' && typeof bVal === 'number') {
                        return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
                    }
                    return sort.dir === 'asc' ? String(aVal || '').localeCompare(String(bVal || '')) : String(bVal || '').localeCompare(String(aVal || ''));
                });
                var sortIcon = function(col) { return sort.col === col ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort text-muted'; };
                var rowsHtml = sortedVendors.map(function(v) {
                    return '<tr class="clickable-row" onclick="IntegrityController.openEntityFlyout(\'vendor\', \'' + v.vendorId + '\', \'' + (v.vendorName || '').replace(/'/g, "\\'") + '\')">' +
                        '<td><strong>' + v.vendorName + '</strong></td>' +
                        '<td class="text-center">' + v.flagCount + '</td>' +
                        '<td class="text-center">' + v.transactionCount + '</td>' +
                        '<td class="text-right font-weight-bold">' + fmtMoney(v.totalAmount, 2) + '</td>' +
                        '<td>' + (v.flagTypes || []).map(function(ft) { return self.getFlagPill(ft); }).join(' ') + '</td>' +
                        '<td><span class="risk-score-badge ' + self.getSeverityClass(v.riskScore) + '">' + v.riskScore + '</span></td>' +
                    '</tr>';
                }).join('');
                contentHtml = '<div class="table-responsive"><table class="table table-sm table-hover">' +
                    '<thead><tr><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'vendors\',\'vendorName\')">Vendor <i class="fas ' + sortIcon('vendorName') + '"></i></th><th class="text-center" style="cursor:pointer" onclick="IntegrityController.sortTable(\'vendors\',\'flagCount\')">Flags <i class="fas ' + sortIcon('flagCount') + '"></i></th><th class="text-center" style="cursor:pointer" onclick="IntegrityController.sortTable(\'vendors\',\'transactionCount\')">Txns <i class="fas ' + sortIcon('transactionCount') + '"></i></th><th class="text-right" style="cursor:pointer" onclick="IntegrityController.sortTable(\'vendors\',\'totalAmount\')">Amount <i class="fas ' + sortIcon('totalAmount') + '"></i></th><th>Flag Types</th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'vendors\',\'riskScore\')">Risk <i class="fas ' + sortIcon('riskScore') + '"></i></th></tr></thead>' +
                    '<tbody>' + rowsHtml + '</tbody></table></div>';
            }
            
            container.innerHTML = kpiHtml + headerHtml + contentHtml + this.renderPagination(vendorRisk.length, pag.page, pag.pageSize, 'vendors');
        },
        
        setVendorViewMode: function(mode) {
            this.vendorViewMode = mode;
            this.renderVendorAnalysisTab();
        },

        renderUserAnalysisTab: function() {
            var container = el("#integrityUserContent");
            if (!container || !this.latestData) return;
            var self = this;
            var userRisk = this.latestData.userRiskAnalysis || [];
            var viewMode = this.userViewMode || 'card';
            
            // KPI row
            var totalAmount = userRisk.reduce(function(s, u) { return s + (u.totalAmount || 0); }, 0);
            var totalFlags = userRisk.reduce(function(s, u) { return s + (u.flagCount || 0); }, 0);
            var highRiskCount = userRisk.filter(function(u) { return u.riskScore >= 70; }).length;
            var kpiHtml = this.buildKPIRow([
                { label: 'Users with Flags', value: userRisk.length, icon: 'users', color: userRisk.length > 0 ? 'warning' : 'success' },
                { label: 'Total Amount', value: fmtMoney(totalAmount), icon: 'dollar-sign' },
                { label: 'Total Flags', value: totalFlags, icon: 'flag' },
                { label: 'High Risk', value: highRiskCount, icon: 'exclamation-triangle', color: highRiskCount > 0 ? 'danger' : 'success' }
            ]);
            
            if (userRisk.length === 0) { 
                container.innerHTML = kpiHtml + '<div class="empty-state mt-3"><i class="fas fa-users text-muted fa-3x mb-3"></i><h5>No User Risk Data</h5></div>'; 
                return; 
            }
            
            var pag = this.pagination.users || { page: 1, pageSize: 15 }; 
            var startIdx = (pag.page - 1) * pag.pageSize; 
            var pageUsers = userRisk.slice(startIdx, startIdx + pag.pageSize);
            
            // Header with toggle inline
            var headerHtml = '<div class="d-flex justify-content-between align-items-center mb-1">' +
                '<small class="text-muted">' + userRisk.length + ' users with flags</small>' +
                '<div class="btn-group btn-group-sm">' +
                '<button class="btn btn-xs ' + (viewMode === 'card' ? 'btn-primary' : 'btn-outline-secondary') + '" onclick="IntegrityController.setUserViewMode(\'card\')" title="Card View"><i class="fas fa-th-large"></i></button>' +
                '<button class="btn btn-xs ' + (viewMode === 'table' ? 'btn-primary' : 'btn-outline-secondary') + '" onclick="IntegrityController.setUserViewMode(\'table\')" title="Table View"><i class="fas fa-table"></i></button>' +
                '</div></div>';
            
            var contentHtml = '';
            if (viewMode === 'card') {
                contentHtml = '<div class="vendor-risk-grid">' + pageUsers.map(function(u) { 
                    var riskClass = u.riskScore >= 70 ? 'high' : u.riskScore >= 40 ? 'medium' : 'low'; 
                    return '<div class="vendor-risk-card risk-' + riskClass + ' clickable-row" onclick="IntegrityController.openEntityFlyout(\'user\', \'' + u.userId + '\', \'' + (u.userName || '').replace(/'/g, "\\'") + '\')">' +
                        '<div class="vrc-header">' +
                        '<div class="vrc-name"><span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#6366f1;color:#fff;font-size:11px;font-weight:600;margin-right:8px;">' + self.getInitials(u.userName) + '</span>' + u.userName + '</div>' +
                        '<div class="vrc-score"><span class="risk-score-badge ' + self.getSeverityClass(u.riskScore) + '">' + u.riskScore + '</span></div>' +
                        '</div>' +
                        '<div class="vrc-body">' +
                        '<div class="vrc-stats">' +
                        '<div class="vrc-stat"><span class="vrc-stat-val">' + u.flagCount + '</span><span class="vrc-stat-lbl">Flags</span></div>' +
                        '<div class="vrc-stat"><span class="vrc-stat-val">' + fmtMoney(u.totalAmount, 2) + '</span><span class="vrc-stat-lbl">Total</span></div>' +
                        '<div class="vrc-stat"><span class="vrc-stat-val">' + u.transactionCount + '</span><span class="vrc-stat-lbl">Txns</span></div>' +
                        '</div>' +
                        '<div class="vrc-flags">' + (u.flagTypes || []).map(function(ft) { return self.getFlagPill(ft); }).join('') + '</div>' +
                        '</div></div>'; 
                }).join('') + '</div>';
            } else {
                // Apply sorting
                var sort = this.tableSort && this.tableSort.users ? this.tableSort.users : { col: 'riskScore', dir: 'desc' };
                var sortedUsers = pageUsers.slice().sort(function(a, b) {
                    var aVal = a[sort.col], bVal = b[sort.col];
                    if (typeof aVal === 'number' && typeof bVal === 'number') {
                        return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
                    }
                    return sort.dir === 'asc' ? String(aVal || '').localeCompare(String(bVal || '')) : String(bVal || '').localeCompare(String(aVal || ''));
                });
                var sortIcon = function(col) { return sort.col === col ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort text-muted'; };
                var rowsHtml = sortedUsers.map(function(u) {
                    return '<tr class="clickable-row" onclick="IntegrityController.openEntityFlyout(\'user\', \'' + u.userId + '\', \'' + (u.userName || '').replace(/'/g, "\\'") + '\')">' +
                        '<td><span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#6366f1;color:#fff;font-size:10px;font-weight:600;margin-right:6px;">' + self.getInitials(u.userName) + '</span><strong>' + u.userName + '</strong></td>' +
                        '<td class="text-center">' + u.flagCount + '</td>' +
                        '<td class="text-center">' + u.transactionCount + '</td>' +
                        '<td class="text-right font-weight-bold">' + fmtMoney(u.totalAmount, 2) + '</td>' +
                        '<td>' + (u.flagTypes || []).map(function(ft) { return self.getFlagPill(ft); }).join(' ') + '</td>' +
                        '<td><span class="risk-score-badge ' + self.getSeverityClass(u.riskScore) + '">' + u.riskScore + '</span></td>' +
                    '</tr>';
                }).join('');
                contentHtml = '<div class="table-responsive"><table class="table table-sm table-hover">' +
                    '<thead><tr><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'users\',\'userName\')">User <i class="fas ' + sortIcon('userName') + '"></i></th><th class="text-center" style="cursor:pointer" onclick="IntegrityController.sortTable(\'users\',\'flagCount\')">Flags <i class="fas ' + sortIcon('flagCount') + '"></i></th><th class="text-center" style="cursor:pointer" onclick="IntegrityController.sortTable(\'users\',\'transactionCount\')">Txns <i class="fas ' + sortIcon('transactionCount') + '"></i></th><th class="text-right" style="cursor:pointer" onclick="IntegrityController.sortTable(\'users\',\'totalAmount\')">Amount <i class="fas ' + sortIcon('totalAmount') + '"></i></th><th>Flag Types</th><th style="cursor:pointer" onclick="IntegrityController.sortTable(\'users\',\'riskScore\')">Risk <i class="fas ' + sortIcon('riskScore') + '"></i></th></tr></thead>' +
                    '<tbody>' + rowsHtml + '</tbody></table></div>';
            }
            
            container.innerHTML = kpiHtml + headerHtml + contentHtml + this.renderPagination(userRisk.length, pag.page, pag.pageSize, 'users');
        },
        
        setUserViewMode: function(mode) {
            this.userViewMode = mode;
            this.renderUserAnalysisTab();
        },

        renderAllFlaggedTab: function() {
            var container = el("#integrityAllFlaggedContent");
            if (!container || !this.latestData) return;
            var self = this;
            var flagged = this.latestData.flaggedTransactions || [];
            if (flagged.length === 0) { container.innerHTML = '<div class="empty-state"><i class="fas fa-shield-alt text-success fa-3x mb-3"></i><h5>No Flagged Transactions</h5></div>'; return; }
            var filtered = flagged;
            if (this.filters.flagType !== 'all') { filtered = filtered.filter(function(f) { return f.flagType === self.filters.flagType; }); }
            if (this.filters.searchQuery) { var q = this.filters.searchQuery.toLowerCase(); filtered = filtered.filter(function(f) { return (f.tranId || '').toLowerCase().indexOf(q) > -1 || (f.entityName || '').toLowerCase().indexOf(q) > -1 || (f.reason || '').toLowerCase().indexOf(q) > -1; }); }
            var types = []; var typeSet = {}; flagged.forEach(function(f) { if (!typeSet[f.flagType]) { typeSet[f.flagType] = true; types.push(f.flagType); } });
            var counts = {}; flagged.forEach(function(f) { counts[f.flagType] = (counts[f.flagType] || 0) + 1; });
            var pag = this.pagination.flagged; var startIdx = (pag.page - 1) * pag.pageSize; var pageItems = filtered.slice(startIdx, startIdx + pag.pageSize);
            var pillsHtml = '<button class="filter-pill ' + (this.filters.flagType === 'all' ? 'active' : '') + '" data-filter="all">All (' + flagged.length + ')</button>' + types.map(function(t) { return '<button class="filter-pill ' + (self.filters.flagType === t ? 'active' : '') + '" data-filter="' + t + '">' + self.shortenFlagType(t) + ' (' + counts[t] + ')</button>'; }).join('');
            var rowsHtml = pageItems.map(function(f) { return '<tr><td><span class="severity-dot ' + self.getSeverityClass(f.riskScore) + '"></span> ' + f.riskScore + '</td><td>' + f.tranDate + '</td><td>' + f.type + '</td><td>' + getNsLink(f.tranId || 'N/A', f.id) + '</td><td class="text-right font-weight-bold">' + fmtMoney(f.amount, 2) + '</td><td>' + (f.entityName || '-') + '</td><td>' + self.getFlagPill(f.flagType) + '</td><td class="small" title="' + f.reason + '">' + (f.reason || '').substring(0, 50) + '...</td></tr>'; }).join('');
            container.innerHTML = '<div class="flagged-filters"><div class="filter-pills">' + pillsHtml + '</div><input type="text" class="form-control form-control-sm filter-search" placeholder="Search..." id="flaggedSearch" value="' + (this.filters.searchQuery || '') + '"></div><div class="table-responsive"><table class="table table-sm table-hover flagged-table"><thead><tr><th style="width:50px">Risk</th><th>Date</th><th>Type</th><th>Tran #</th><th class="text-right">Amount</th><th>Entity</th><th>Flag</th><th>Reason</th></tr></thead><tbody id="flaggedTbody">' + rowsHtml + '</tbody></table></div>' + this.renderPagination(filtered.length, pag.page, pag.pageSize, 'flagged');
            container.querySelectorAll('.filter-pill').forEach(function(btn) { btn.addEventListener('click', function() { self.filters.flagType = btn.dataset.filter; self.pagination.flagged.page = 1; self.renderAllFlaggedTab(); }); });
            var searchEl = el('#flaggedSearch'); if (searchEl) { searchEl.addEventListener('keyup', function(e) { self.filters.searchQuery = e.target.value; self.pagination.flagged.page = 1; self.renderAllFlaggedTab(); }); }
        },

        renderFlagActions: function(item) {
            var id = item.id || ''; var flagType = item.flagType || '';
            return '<div class="flag-action-btns"><button class="btn btn-xs btn-outline-success" title="Mark Reviewed" onclick="IntegrityController.markReviewed(\'' + id + '\', \'' + flagType + '\')"><i class="fas fa-check"></i></button><button class="btn btn-xs btn-outline-warning" title="Investigate" onclick="IntegrityController.markInvestigate(\'' + id + '\', \'' + flagType + '\')"><i class="fas fa-search"></i></button><button class="btn btn-xs btn-outline-secondary" title="Dismiss" onclick="IntegrityController.dismissFlag(\'' + id + '\', \'' + flagType + '\')"><i class="fas fa-times"></i></button></div>';
        },
        
        markReviewed: function(tranId, flagType) {
            var self = this;
            API.post('update_audit_flag', { transactionId: tranId, flagType: flagType, status: 'Cleared', action: 'review' }).then(function(res) { if (res.status === 'success') { showToast('Marked as reviewed', 'success'); self.loadData(); } else { showToast('Error: ' + res.message, 'error'); } }).catch(function(e) { console.error('Flag update error', e); showToast('Marked as reviewed (local)', 'success'); });
        },
        
        markInvestigate: function(tranId, flagType) {
            var self = this;
            API.post('update_audit_flag', { transactionId: tranId, flagType: flagType, status: 'Investigating', action: 'investigate' }).then(function(res) { if (res.status === 'success') { showToast('Marked for investigation', 'info'); self.loadData(); } else { showToast('Error: ' + res.message, 'error'); } }).catch(function(e) { console.error('Flag update error', e); showToast('Marked for investigation (local)', 'info'); });
        },
        
        dismissFlag: function(tranId, flagType) {
            var self = this;
            API.post('update_audit_flag', { transactionId: tranId, flagType: flagType, status: 'Dismissed', action: 'dismiss' }).then(function(res) { if (res.status === 'success') { showToast('Flag dismissed', 'info'); self.loadData(); } else { showToast('Error: ' + res.message, 'error'); } }).catch(function(e) { console.error('Flag update error', e); showToast('Flag dismissed (local)', 'info'); });
        },

        renderConfigTab: function() {
            var container = el("#integrityConfigContent");
            if (!container) return;
            var cfg = this.configData || this.getDefaultConfig();
            var opts = this.exclusionOptions || { vendors: [], accounts: [], users: [], tranTypes: [] };
            var customRules = cfg.customRules || [];
            
            // Build transaction types options
            var tranTypeOpts = (opts.tranTypes || [
                { id: 'VendBill', name: 'Vendor Bill' }, { id: 'Check', name: 'Check' },
                { id: 'VendPymt', name: 'Vendor Payment' }, { id: 'ExpRept', name: 'Expense Report' },
                { id: 'Journal', name: 'Journal Entry' }, { id: 'VendCred', name: 'Vendor Credit' }
            ]).map(function(t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('');
            
            // Build custom rules HTML
            var rulesHtml = customRules.length > 0 ? customRules.map(function(rule, idx) {
                return '<div class="custom-rule-item" data-rule-idx="' + idx + '">' +
                    '<div class="cri-header"><span class="cri-name">' + (rule.name || 'Rule ' + (idx + 1)) + '</span>' +
                    '<span class="cri-status ' + (rule.enabled ? 'active' : 'inactive') + '">' + (rule.enabled ? 'Active' : 'Inactive') + '</span>' +
                    '<button class="btn btn-xs btn-link text-danger" onclick="IntegrityController.deleteRule(' + idx + ')"><i class="fas fa-trash"></i></button></div>' +
                    '<div class="cri-body"><span class="cri-condition">' + rule.condition + '</span><span class="cri-action">' + rule.action + '</span></div></div>';
            }).join('') : '<div class="no-rules-msg"><i class="fas fa-info-circle"></i> No custom rules defined</div>';
            
            container.innerHTML = '<div class="config-dashboard">' +
                '<div class="config-header"><i class="fas fa-cog"></i> Detection Configuration</div>' +
                '<div class="config-tabs"><button class="cfg-tab active" data-tab="modules">Modules</button><button class="cfg-tab" data-tab="thresholds">Thresholds</button><button class="cfg-tab" data-tab="rules">Custom Rules</button><button class="cfg-tab" data-tab="scoring">Risk Scoring</button><button class="cfg-tab" data-tab="exclusions">Exclusions</button></div>' +
                
                // Modules Tab
                '<div class="cfg-tab-content active" id="cfg-modules">' +
                '<div class="config-section"><div class="cs-header">Detection Modules</div><div class="cs-body modules-grid">' +
                '<div class="cfg-toggle-card"><input type="checkbox" id="enableBenford" ' + (cfg.enableBenford ? 'checked' : '') + '><label for="enableBenford"><i class="fas fa-chart-bar"></i><span>Benford 1D</span><small>First digit analysis</small></label></div>' +
                '<div class="cfg-toggle-card"><input type="checkbox" id="enableBenford2D" ' + (cfg.enableBenford2D ? 'checked' : '') + '><label for="enableBenford2D"><i class="fas fa-chart-area"></i><span>Benford 2D</span><small>First two digits</small></label></div>' +
                '<div class="cfg-toggle-card"><input type="checkbox" id="enableDuplicates" ' + (cfg.enableDuplicates ? 'checked' : '') + '><label for="enableDuplicates"><i class="fas fa-copy"></i><span>Duplicates</span><small>Duplicate detection</small></label></div>' +
                '<div class="cfg-toggle-card"><input type="checkbox" id="enableWeekend" ' + (cfg.enableWeekend ? 'checked' : '') + '><label for="enableWeekend"><i class="fas fa-calendar-week"></i><span>Weekend</span><small>Weekend entries</small></label></div>' +
                '<div class="cfg-toggle-card"><input type="checkbox" id="enableRSF" ' + (cfg.enableRSF ? 'checked' : '') + '><label for="enableRSF"><i class="fas fa-chart-line"></i><span>RSF</span><small>Relative size factor</small></label></div>' +
                '<div class="cfg-toggle-card"><input type="checkbox" id="enableZScore" ' + (cfg.enableZScore ? 'checked' : '') + '><label for="enableZScore"><i class="fas fa-superscript"></i><span>Z-Score</span><small>Statistical outliers</small></label></div>' +
                '<div class="cfg-toggle-card"><input type="checkbox" id="enableSequential" ' + (cfg.enableSequential ? 'checked' : '') + '><label for="enableSequential"><i class="fas fa-sort-numeric-down"></i><span>Sequential</span><small>Invoice sequences</small></label></div>' +
                '<div class="cfg-toggle-card"><input type="checkbox" id="enableGhost" ' + (cfg.enableGhost ? 'checked' : '') + '><label for="enableGhost"><i class="fas fa-user-secret"></i><span>Ghost</span><small>Ghost vendors</small></label></div>' +
                '</div></div></div>' +
                
                // Thresholds Tab
                '<div class="cfg-tab-content" id="cfg-thresholds">' +
                '<div class="config-section"><div class="cs-header">Detection Thresholds</div><div class="cs-body thresholds-grid">' +
                '<div class="cfg-input-card"><label><i class="fas fa-clock"></i> Duplicate Window</label><div class="input-group"><input type="number" id="cfgDupeDays" value="' + cfg.duplicateThresholdDays + '" min="1" max="90"><span>days</span></div><small>Time window for duplicate detection</small></div>' +
                '<div class="cfg-input-card"><label><i class="fas fa-dollar-sign"></i> Duplicate Min Amount</label><div class="input-group"><span>$</span><input type="number" id="cfgDupeMinAmt" value="' + cfg.duplicateMinAmount + '" min="0"></div><small>Minimum amount for duplicate flagging</small></div>' +
                '<div class="cfg-input-card"><label><i class="fas fa-superscript"></i> Z-Score Threshold</label><div class="input-group"><input type="number" id="cfgZScoreThreshold" value="' + (cfg.zScoreThreshold || 3) + '" min="2" max="5" step="0.5"><span>σ</span></div><small>Standard deviations for outlier detection</small></div>' +
                '<div class="cfg-input-card"><label><i class="fas fa-times"></i> RSF Threshold</label><div class="input-group"><input type="number" id="cfgRSFThreshold" value="' + (cfg.rsfThreshold || 10) + '" min="2" max="50"><span>x</span></div><small>Relative size factor multiplier</small></div>' +
                '<div class="cfg-input-card"><label><i class="fas fa-hand-paper"></i> Approval Threshold</label><div class="input-group"><span>$</span><input type="number" id="cfgApprovalThreshold" value="' + cfg.approvalThreshold + '" min="0"></div><small>Amount triggering approval flags</small></div>' +
                '<div class="cfg-input-card"><label><i class="fas fa-exclamation-triangle"></i> High Risk Amount</label><div class="input-group"><span>$</span><input type="number" id="cfgHighRiskAmt" value="' + (cfg.highRiskAmount || 10000) + '" min="0"></div><small>Threshold for high risk scoring</small></div>' +
                '<div class="cfg-input-card"><label><i class="fas fa-fire"></i> Critical Risk Amount</label><div class="input-group"><span>$</span><input type="number" id="cfgCriticalRiskAmt" value="' + (cfg.criticalRiskAmount || 25000) + '" min="0"></div><small>Threshold for critical risk scoring</small></div>' +
                '<div class="cfg-input-card"><label><i class="fas fa-list-ol"></i> Sequential Min Count</label><div class="input-group"><input type="number" id="cfgSeqMinCount" value="' + (cfg.sequentialMinCount || 3) + '" min="2" max="10"></div><small>Minimum invoices in sequence</small></div>' +
                '<div class="cfg-input-card"><label><i class="fas fa-calendar-alt"></i> Sequential Max Days</label><div class="input-group"><input type="number" id="cfgSeqMaxDays" value="' + (cfg.sequentialMaxDays || 30) + '" min="1" max="90"><span>days</span></div><small>Max days between sequential invoices</small></div>' +
                '</div></div></div>' +
                
                // Custom Rules Tab
                '<div class="cfg-tab-content" id="cfg-rules">' +
                '<div class="config-section"><div class="cs-header">Custom Flag Rules <button class="btn btn-sm btn-outline-primary float-right" onclick="IntegrityController.showAddRuleModal()"><i class="fas fa-plus"></i> Add Rule</button></div>' +
                '<div class="cs-body"><div class="custom-rules-list">' + rulesHtml + '</div>' +
                '<div class="rule-builder-preview"><div class="rbp-header"><i class="fas fa-magic"></i> Rule Builder</div>' +
                '<div class="rbp-body">' +
                '<div class="rbp-row"><label>Rule Name</label><input type="text" id="newRuleName" class="form-control form-control-sm" placeholder="e.g., Large Round Amounts"></div>' +
                '<div class="rbp-row"><label>Condition</label><select id="newRuleCondition" class="form-control form-control-sm">' +
                '<option value="amount_gt">Amount greater than</option><option value="amount_lt">Amount less than</option>' +
                '<option value="amount_round">Amount is round number</option><option value="amount_ends">Amount ends with</option>' +
                '<option value="vendor_new">Vendor is new (< 90 days)</option><option value="time_after_hours">Entry after business hours</option>' +
                '<option value="type_is">Transaction type is</option><option value="desc_contains">Description contains</option></select></div>' +
                '<div class="rbp-row"><label>Value</label><input type="text" id="newRuleValue" class="form-control form-control-sm" placeholder="Enter value..."></div>' +
                '<div class="rbp-row"><label>Action</label><select id="newRuleAction" class="form-control form-control-sm">' +
                '<option value="flag_low">Flag as Low Risk</option><option value="flag_medium">Flag as Medium Risk</option>' +
                '<option value="flag_high">Flag as High Risk</option><option value="flag_critical">Flag as Critical</option>' +
                '<option value="require_approval">Require Approval</option><option value="notify_email">Send Email Alert</option></select></div>' +
                '<div class="rbp-row"><label>Enabled</label><input type="checkbox" id="newRuleEnabled" checked></div>' +
                '<button class="btn btn-sm btn-primary mt-2" onclick="IntegrityController.addCustomRule()"><i class="fas fa-plus"></i> Add Rule</button>' +
                '</div></div></div></div></div>' +
                
                // Risk Scoring Tab
                '<div class="cfg-tab-content" id="cfg-scoring">' +
                '<div class="config-section"><div class="cs-header">Risk Score Weights</div><div class="cs-body scoring-grid">' +
                '<div class="cfg-slider-card"><label>Duplicate Weight</label><input type="range" id="cfgWeightDuplicate" min="0" max="100" value="' + (cfg.weightDuplicate || 50) + '"><span class="slider-val">' + (cfg.weightDuplicate || 50) + '</span></div>' +
                '<div class="cfg-slider-card"><label>Weekend Weight</label><input type="range" id="cfgWeightWeekend" min="0" max="100" value="' + (cfg.weightWeekend || 35) + '"><span class="slider-val">' + (cfg.weightWeekend || 35) + '</span></div>' +
                '<div class="cfg-slider-card"><label>Amount Weight</label><input type="range" id="cfgWeightAmount" min="0" max="100" value="' + (cfg.weightAmount || 30) + '"><span class="slider-val">' + (cfg.weightAmount || 30) + '</span></div>' +
                '<div class="cfg-slider-card"><label>RSF Weight</label><input type="range" id="cfgWeightRSF" min="0" max="100" value="' + (cfg.weightRSF || 40) + '"><span class="slider-val">' + (cfg.weightRSF || 40) + '</span></div>' +
                '<div class="cfg-slider-card"><label>Z-Score Weight</label><input type="range" id="cfgWeightZScore" min="0" max="100" value="' + (cfg.weightZScore || 45) + '"><span class="slider-val">' + (cfg.weightZScore || 45) + '</span></div>' +
                '<div class="cfg-slider-card"><label>Sequential Weight</label><input type="range" id="cfgWeightSequential" min="0" max="100" value="' + (cfg.weightSequential || 50) + '"><span class="slider-val">' + (cfg.weightSequential || 50) + '</span></div>' +
                '</div></div></div>' +
                
                // Exclusions Tab
                '<div class="cfg-tab-content" id="cfg-exclusions">' +
                '<div class="config-section"><div class="cs-header">Exclusions</div><div class="cs-body exclusions-grid">' +
                '<div class="cfg-multi"><label><i class="fas fa-building"></i> Excluded Vendors</label>' + (opts.vendors.length > 0 ? '<select id="cfgExcludeVendors" multiple>' + opts.vendors.map(function(v) { return '<option value="' + v.id + '"' + ((cfg.excludedVendors || []).indexOf(v.id) > -1 ? ' selected' : '') + '>' + v.name + '</option>'; }).join('') + '</select>' : '<div class="text-muted small p-2">No vendors loaded</div>') + '<small>' + opts.vendors.length + ' vendors available</small></div>' +
                '<div class="cfg-multi"><label><i class="fas fa-user"></i> Excluded Users</label>' + (opts.users.length > 0 ? '<select id="cfgExcludeUsers" multiple>' + opts.users.map(function(u) { return '<option value="' + u.id + '"' + ((cfg.excludedUsers || []).indexOf(u.id) > -1 ? ' selected' : '') + '>' + u.name + '</option>'; }).join('') + '</select>' : '<div class="text-muted small p-2">No users loaded - check API response</div>') + '<small>' + opts.users.length + ' users available</small></div>' +
                '<div class="cfg-multi"><label><i class="fas fa-piggy-bank"></i> Excluded Accounts</label>' + (opts.accounts.length > 0 ? '<select id="cfgExcludeAccounts" multiple>' + opts.accounts.map(function(a) { return '<option value="' + a.id + '"' + ((cfg.excludedAccounts || []).indexOf(a.id) > -1 ? ' selected' : '') + '>' + a.name + '</option>'; }).join('') + '</select>' : '<div class="text-muted small p-2">No accounts loaded</div>') + '<small>' + opts.accounts.length + ' accounts available</small></div>' +
                '<div class="cfg-multi"><label><i class="fas fa-file-invoice"></i> Excluded Transaction Types</label><select id="cfgExcludeTranTypes" multiple>' + tranTypeOpts + '</select><small>Select types to exclude from analysis</small></div>' +
                '</div></div></div>' +
                
                '<div class="config-actions">' +
                '<button class="btn btn-primary" onclick="IntegrityController.saveConfig()"><i class="fas fa-save"></i> Save Configuration</button>' +
                '<button class="btn btn-secondary" onclick="IntegrityController.resetConfig()"><i class="fas fa-undo"></i> Reset to Defaults</button>' +
                '</div></div>';
            
            // Setup tab switching
            container.querySelectorAll('.cfg-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    container.querySelectorAll('.cfg-tab').forEach(function(t) { t.classList.remove('active'); });
                    container.querySelectorAll('.cfg-tab-content').forEach(function(c) { c.classList.remove('active'); });
                    tab.classList.add('active');
                    var targetId = 'cfg-' + tab.getAttribute('data-tab');
                    var target = el('#' + targetId);
                    if (target) target.classList.add('active');
                });
            });
            
            // Setup slider value display
            container.querySelectorAll('input[type="range"]').forEach(function(slider) {
                slider.addEventListener('input', function() {
                    var valSpan = slider.parentElement.querySelector('.slider-val');
                    if (valSpan) valSpan.textContent = slider.value;
                });
            });
        },
        
        addCustomRule: function() {
            var name = (el('#newRuleName') || {}).value || '';
            var condition = (el('#newRuleCondition') || {}).value || '';
            var value = (el('#newRuleValue') || {}).value || '';
            var action = (el('#newRuleAction') || {}).value || '';
            var enabled = (el('#newRuleEnabled') || {}).checked;
            if (!name || !condition) { showToast('Please enter rule name and condition', 'error'); return; }
            var cfg = this.configData || this.getDefaultConfig();
            cfg.customRules = cfg.customRules || [];
            cfg.customRules.push({ name: name, condition: condition + (value ? ':' + value : ''), action: action, enabled: enabled });
            this.configData = cfg;
            this.renderConfigTab();
            showToast('Rule added: ' + name, 'success');
        },
        
        deleteRule: function(idx) {
            var cfg = this.configData || this.getDefaultConfig();
            if (cfg.customRules && cfg.customRules[idx]) {
                cfg.customRules.splice(idx, 1);
                this.configData = cfg;
                this.renderConfigTab();
                showToast('Rule deleted', 'info');
            }
        },
        
        exportConfig: function() {
            var cfg = this.configData || this.getDefaultConfig();
            var blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = 'integrity_config_' + new Date().toISOString().split('T')[0] + '.json';
            a.click(); URL.revokeObjectURL(url);
        },
        
        importConfig: function() {
            var self = this;
            var input = document.createElement('input');
            input.type = 'file'; input.accept = '.json';
            input.onchange = function(e) {
                var file = e.target.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function(ev) {
                    try {
                        var cfg = JSON.parse(ev.target.result);
                        self.configData = cfg;
                        self.renderConfigTab();
                        showToast('Configuration imported', 'success');
                    } catch (err) { showToast('Invalid config file', 'error'); }
                };
                reader.readAsText(file);
            };
            input.click();
        },
        
        saveConfig: function() {
            var self = this;
            function getVal(id, defaultVal) { var elem = el('#' + id); return elem ? elem.value : defaultVal; }
            function getChecked(id) { var elem = el('#' + id); return elem ? elem.checked : false; }
            function getMultiSelectValues(id) { var elem = el('#' + id); if (!elem) return []; var selected = []; for (var i = 0; i < elem.options.length; i++) { if (elem.options[i].selected) selected.push(elem.options[i].value); } return selected; }
            var existingRules = (this.configData || {}).customRules || [];
            var cfg = {
                // Modules
                enableBenford: getChecked('enableBenford'), enableBenford2D: getChecked('enableBenford2D'),
                enableDuplicates: getChecked('enableDuplicates'), enableWeekend: getChecked('enableWeekend'),
                enableRSF: getChecked('enableRSF'), enableZScore: getChecked('enableZScore'),
                enableSequential: getChecked('enableSequential'), enableGhost: getChecked('enableGhost'),
                // Thresholds
                duplicateThresholdDays: parseInt(getVal('cfgDupeDays', '14')) || 14,
                duplicateMinAmount: parseFloat(getVal('cfgDupeMinAmt', '100')) || 100,
                zScoreThreshold: parseFloat(getVal('cfgZScoreThreshold', '3')) || 3,
                rsfThreshold: parseFloat(getVal('cfgRSFThreshold', '10')) || 10,
                approvalThreshold: parseFloat(getVal('cfgApprovalThreshold', '5000')) || 5000,
                highRiskAmount: parseFloat(getVal('cfgHighRiskAmt', '10000')) || 10000,
                criticalRiskAmount: parseFloat(getVal('cfgCriticalRiskAmt', '25000')) || 25000,
                sequentialMinCount: parseInt(getVal('cfgSeqMinCount', '3')) || 3,
                sequentialMaxDays: parseInt(getVal('cfgSeqMaxDays', '30')) || 30,
                // Scoring weights
                weightDuplicate: parseInt(getVal('cfgWeightDuplicate', '50')) || 50,
                weightWeekend: parseInt(getVal('cfgWeightWeekend', '35')) || 35,
                weightAmount: parseInt(getVal('cfgWeightAmount', '30')) || 30,
                weightRSF: parseInt(getVal('cfgWeightRSF', '40')) || 40,
                weightZScore: parseInt(getVal('cfgWeightZScore', '45')) || 45,
                weightSequential: parseInt(getVal('cfgWeightSequential', '50')) || 50,
                // Exclusions
                excludedVendors: getMultiSelectValues('cfgExcludeVendors'),
                excludedAccounts: getMultiSelectValues('cfgExcludeAccounts'),
                excludedUsers: getMultiSelectValues('cfgExcludeUsers'),
                excludedTranTypes: getMultiSelectValues('cfgExcludeTranTypes'),
                // Custom Rules (preserved)
                customRules: existingRules
            };
            API.post('save_integrity_config', cfg).then(function(res) { if (res.status === 'success') { showToast("Configuration saved!"); self.configData = cfg; self.loadData(); } else { showToast('Error: ' + res.message, 'error'); } }).catch(function(e) { showToast('Configuration saved locally', 'success'); self.configData = cfg; });
        },
        
        resetConfig: function() { this.configData = this.getDefaultConfig(); this.renderConfigTab(); showToast('Configuration reset to defaults'); },

        setSafeText: function(sel, val) { var e = el(sel); if (e) e.textContent = val; },

        // ==================== AUDIT TRAIL TAB ====================
        renderAuditTrailTab: function() {
            var self = this;
            var container = el('#integrityAuditTrailContent');
            if (!container) return;
            
            var data = this.latestData;
            if (!data || !data.auditTrail) {
                container.innerHTML = '<div class="empty-state"><i class="fas fa-history fa-3x text-muted mb-3"></i><h5>No Audit Trail Data</h5><p class="text-muted">Audit trail analysis will appear here.</p></div>';
                return;
            }
            
            var at = data.auditTrail;
            var records = at.records || [];
            var summary = at.summary || {};
            var metrics = at.metrics || {};
            
            // Apply filters
            var filtered = records.filter(function(r) {
                if (self.auditTrailFilters.recordType !== 'all' && r.recordType !== self.auditTrailFilters.recordType) return false;
                if (self.auditTrailFilters.riskLevel !== 'all') {
                    var riskLevel = r.riskScore >= 70 ? 'critical' : r.riskScore >= 40 ? 'high' : r.riskScore >= 20 ? 'medium' : 'low';
                    if (riskLevel !== self.auditTrailFilters.riskLevel) return false;
                }
                if (self.auditTrailFilters.searchQuery) {
                    var q = self.auditTrailFilters.searchQuery.toLowerCase();
                    var searchable = ((r.recordId || '') + ' ' + (r.recordType || '') + ' ' + (r.recordName || '')).toLowerCase();
                    if (searchable.indexOf(q) === -1) return false;
                }
                return true;
            });
            
            // Sort
            var sort = this.auditTrailSort;
            filtered.sort(function(a, b) {
                var aVal = a[sort.column], bVal = b[sort.column];
                if (typeof aVal === 'string') aVal = aVal.toLowerCase();
                if (typeof bVal === 'string') bVal = bVal.toLowerCase();
                if (aVal < bVal) return sort.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sort.direction === 'asc' ? 1 : -1;
                return 0;
            });
            
            // Pagination
            var pag = this.pagination.audittrail;
            var totalPages = Math.ceil(filtered.length / pag.pageSize) || 1;
            if (pag.page > totalPages) pag.page = totalPages;
            var startIdx = (pag.page - 1) * pag.pageSize;
            var pageRecords = filtered.slice(startIdx, startIdx + pag.pageSize);
            
            // Get unique record types for filter
            var recordTypes = {};
            records.forEach(function(r) { if (r.recordType) recordTypes[r.recordType] = true; });
            var typeOptions = Object.keys(recordTypes).sort().map(function(t) {
                return '<option value="' + t + '"' + (self.auditTrailFilters.recordType === t ? ' selected' : '') + '>' + t + '</option>';
            }).join('');
            
            // Risk level badge
            var riskClass = metrics.riskLevel === 'CRITICAL' ? 'danger' : metrics.riskLevel === 'HIGH' ? 'warning' : metrics.riskLevel === 'MEDIUM' ? 'info' : 'success';
            
            // Build KPI row using standard helper
            var kpiHtml = this.buildKPIRow([
                { label: 'Risk Score', value: metrics.overallRiskScore || 0, icon: 'shield-alt', color: riskClass },
                { label: 'Records', value: summary.totalRecords || 0, icon: 'file-alt' },
                { label: 'Changes', value: (summary.totalChanges || 0).toLocaleString(), icon: 'edit' },
                { label: 'Banking', value: summary.bankingChanges || 0, icon: 'university', color: summary.bankingChanges > 0 ? 'warning' : '' },
                { label: 'Deletions', value: summary.deletions || 0, icon: 'trash', color: summary.deletions > 0 ? 'danger' : '' }
            ]);
            
            // Filters row
            var filtersHtml = '<div class="at-filters mb-3"><div class="row align-items-center">' +
                '<div class="col-auto"><label class="mb-0 small text-muted mr-2">Type:</label><select id="atFilterType" class="form-control form-control-sm" style="width:auto;display:inline-block;"><option value="all">All Types</option>' + typeOptions + '</select></div>' +
                '<div class="col-auto"><label class="mb-0 small text-muted mr-2">Risk:</label><select id="atFilterRisk" class="form-control form-control-sm" style="width:auto;display:inline-block;"><option value="all"' + (self.auditTrailFilters.riskLevel === 'all' ? ' selected' : '') + '>All Levels</option><option value="critical"' + (self.auditTrailFilters.riskLevel === 'critical' ? ' selected' : '') + '>Critical (70+)</option><option value="high"' + (self.auditTrailFilters.riskLevel === 'high' ? ' selected' : '') + '>High (40-69)</option><option value="medium"' + (self.auditTrailFilters.riskLevel === 'medium' ? ' selected' : '') + '>Medium (20-39)</option><option value="low"' + (self.auditTrailFilters.riskLevel === 'low' ? ' selected' : '') + '>Low (&lt;20)</option></select></div>' +
                '<div class="col"><input type="text" id="atFilterSearch" class="form-control form-control-sm" placeholder="Search records..." value="' + (self.auditTrailFilters.searchQuery || '') + '" style="max-width:250px;"></div>' +
            '</div></div>';
            
            // Table
            var sortIcon = function(col) { 
                if (sort.column !== col) return '<i class="fas fa-sort text-muted"></i>';
                return sort.direction === 'asc' ? '<i class="fas fa-sort-up"></i>' : '<i class="fas fa-sort-down"></i>';
            };
            
            var tableHtml = '<div id="atTableContainer"><table class="table table-sm table-hover at-table"><thead><tr>' +
                '<th class="at-col-risk" style="width:30px;"></th>' +
                '<th class="at-col-record sortable" onclick="IntegrityController.sortAuditTable(\'recordName\')">Record ' + sortIcon('recordName') + '</th>' +
                '<th class="at-col-type sortable" onclick="IntegrityController.sortAuditTable(\'recordType\')">Type ' + sortIcon('recordType') + '</th>' +
                '<th class="at-col-changes sortable text-center" onclick="IntegrityController.sortAuditTable(\'changeCount\')">Changes ' + sortIcon('changeCount') + '</th>' +
                '<th class="at-col-users text-center">Users</th>' +
                '<th class="at-col-flags">Flags</th>' +
                '<th class="at-col-date sortable" onclick="IntegrityController.sortAuditTable(\'lastDate\')">Last Change ' + sortIcon('lastDate') + '</th>' +
                '<th class="at-col-score sortable text-center" onclick="IntegrityController.sortAuditTable(\'riskScore\')">Risk ' + sortIcon('riskScore') + '</th>' +
            '</tr></thead><tbody>';
            
            if (pageRecords.length === 0) {
                tableHtml += '<tr><td colspan="8" class="text-center text-muted py-4"><i class="fas fa-check-circle text-success fa-2x mb-2 d-block"></i>No records match filters</td></tr>';
            } else {
                pageRecords.forEach(function(r) {
                    var rc = r.riskScore >= 70 ? 'critical' : r.riskScore >= 40 ? 'high' : r.riskScore >= 20 ? 'medium' : 'low';
                    var dotColor = rc === 'critical' ? '#dc3545' : rc === 'high' ? '#fd7e14' : rc === 'medium' ? '#ffc107' : '#28a745'; var riskDot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + dotColor + ';"></span>';
                    var internalId = r.recordId || '';
                    
                    var factorIcons = [];
                    if (r.hasBanking) factorIcons.push('<i class="fas fa-university text-danger" title="Banking Changes"></i>');
                    if (r.hasAddress) factorIcons.push('<i class="fas fa-map-marker-alt text-warning" title="Address Changes"></i>');
                    if (r.hasDeletion) factorIcons.push('<i class="fas fa-trash text-danger" title="Deletions"></i>');
                    if (r.recordType === 'Entity' || r.recordType === 'Vendor' || r.recordType === 'Customer') factorIcons.push('<i class="fas fa-building text-info" title="Entity Record"></i>');
                    
                    tableHtml += '<tr class="at-record-row risk-' + rc + ' clickable-row" onclick="IntegrityController.openAuditFlyout(\'' + internalId + '\')">' +
                        '<td class="at-col-risk">' + riskDot + '</td>' +
                        '<td class="at-col-record"><div class="at-record-cell"><span class="at-record-type-badge">' + (r.recordType || 'Rec').substring(0, 4) + '</span><span class="at-record-name" title="' + internalId + '">' + self.truncateValue(r.recordName || internalId, 40) + '</span></div></td>' +
                        '<td class="at-col-type"><span class="text-muted small">' + (r.recordType || '-') + '</span></td>' +
                        '<td class="at-col-changes text-center"><span class="badge badge-secondary">' + r.changeCount + '</span></td>' +
                        '<td class="at-col-users text-center">' + r.userCount + '</td>' +
                        '<td class="at-col-flags"><div class="at-factor-icons">' + (factorIcons.join(' ') || '<span class="text-muted">-</span>') + '</div></td>' +
                        '<td class="at-col-date"><span class="small">' + (r.lastDate || '-') + '</span></td>' +
                        '<td class="at-col-score text-center"><span class="badge badge-' + (rc === 'critical' ? 'danger' : rc === 'high' ? 'warning' : rc === 'medium' ? 'info' : 'secondary') + '">' + Math.round(r.riskScore) + '</span></td>' +
                    '</tr>';
                });
            }
            tableHtml += '</tbody></table>';
            
            // Pagination
            var pagHtml = '<div class="pagination-bar d-flex justify-content-between align-items-center mt-2 px-2">' +
                '<span class="small text-muted">Showing ' + (startIdx + 1) + '-' + Math.min(startIdx + pag.pageSize, filtered.length) + ' of ' + filtered.length + '</span>' +
                '<div class="btn-group btn-group-sm">' +
                '<button class="btn btn-outline-secondary" ' + (pag.page <= 1 ? 'disabled' : '') + ' onclick="IntegrityController.goToAuditPage(' + (pag.page - 1) + ')"><i class="fas fa-chevron-left"></i></button>' +
                '<span class="btn btn-outline-secondary disabled">Page ' + pag.page + ' of ' + totalPages + '</span>' +
                '<button class="btn btn-outline-secondary" ' + (pag.page >= totalPages ? 'disabled' : '') + ' onclick="IntegrityController.goToAuditPage(' + (pag.page + 1) + ')"><i class="fas fa-chevron-right"></i></button>' +
                '</div></div>';
            
            tableHtml += pagHtml + '</div>';
            
            var alertHtml = '<div class="alert alert-info py-2 mb-2"><i class="fas fa-history mr-2"></i><strong>Audit Trail Analysis</strong> - Tracks sensitive record changes including banking info, addresses, and deletions. Higher risk scores indicate more critical modifications.</div>';
            
            container.innerHTML = kpiHtml + alertHtml + filtersHtml + tableHtml;
            
            // Bind filter events
            var tf = el('#atFilterType');
            var rf = el('#atFilterRisk');
            var sf = el('#atFilterSearch');
            if (tf) tf.addEventListener('change', function(e) { self.auditTrailFilters.recordType = e.target.value; self.pagination.audittrail.page = 1; self.renderAuditTrailTab(); });
            if (rf) rf.addEventListener('change', function(e) { self.auditTrailFilters.riskLevel = e.target.value; self.pagination.audittrail.page = 1; self.renderAuditTrailTab(); });
            if (sf) {
                var debounceTimer = null;
                sf.addEventListener('input', function(e) {
                    var val = e.target.value;
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(function() {
                        self.auditTrailFilters.searchQuery = val;
                        self.pagination.audittrail.page = 1;
                        self.renderAuditTrailTableOnly();
                    }, 300);
                });
            }
        },
        
        renderAuditTrailTableOnly: function() {
            // Re-render just the table portion to preserve search focus
            var self = this;
            var tableContainer = el('#atTableContainer');
            if (!tableContainer) { this.renderAuditTrailTab(); return; }
            
            var data = this.latestData;
            if (!data || !data.auditTrail) return;
            
            var records = data.auditTrail.records || [];
            var filtered = records.filter(function(r) {
                if (self.auditTrailFilters.recordType !== 'all' && r.recordType !== self.auditTrailFilters.recordType) return false;
                if (self.auditTrailFilters.riskLevel !== 'all') {
                    var riskLevel = r.riskScore >= 70 ? 'critical' : r.riskScore >= 40 ? 'high' : r.riskScore >= 20 ? 'medium' : 'low';
                    if (riskLevel !== self.auditTrailFilters.riskLevel) return false;
                }
                if (self.auditTrailFilters.searchQuery) {
                    var q = self.auditTrailFilters.searchQuery.toLowerCase();
                    var searchable = ((r.recordId || '') + ' ' + (r.recordType || '') + ' ' + (r.recordName || '')).toLowerCase();
                    if (searchable.indexOf(q) === -1) return false;
                }
                return true;
            });
            
            var sort = this.auditTrailSort;
            filtered.sort(function(a, b) {
                var aVal = a[sort.column], bVal = b[sort.column];
                if (typeof aVal === 'string') aVal = aVal.toLowerCase();
                if (typeof bVal === 'string') bVal = bVal.toLowerCase();
                if (aVal < bVal) return sort.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sort.direction === 'asc' ? 1 : -1;
                return 0;
            });
            
            var pag = this.pagination.audittrail;
            var totalPages = Math.ceil(filtered.length / pag.pageSize) || 1;
            if (pag.page > totalPages) pag.page = totalPages;
            var startIdx = (pag.page - 1) * pag.pageSize;
            var pageRecords = filtered.slice(startIdx, startIdx + pag.pageSize);
            
            var sortIcon = function(col) { 
                if (sort.column !== col) return '<i class="fas fa-sort text-muted"></i>';
                return sort.direction === 'asc' ? '<i class="fas fa-sort-up"></i>' : '<i class="fas fa-sort-down"></i>';
            };
            
            var tableHtml = '<table class="table table-sm table-hover at-table"><thead><tr>' +
                '<th class="at-col-risk" style="width:30px;"></th>' +
                '<th class="at-col-record sortable" onclick="IntegrityController.sortAuditTable(\'recordName\')">Record ' + sortIcon('recordName') + '</th>' +
                '<th class="at-col-type sortable" onclick="IntegrityController.sortAuditTable(\'recordType\')">Type ' + sortIcon('recordType') + '</th>' +
                '<th class="at-col-changes sortable text-center" onclick="IntegrityController.sortAuditTable(\'changeCount\')">Changes ' + sortIcon('changeCount') + '</th>' +
                '<th class="at-col-users text-center">Users</th>' +
                '<th class="at-col-flags">Flags</th>' +
                '<th class="at-col-date sortable" onclick="IntegrityController.sortAuditTable(\'lastDate\')">Last Change ' + sortIcon('lastDate') + '</th>' +
                '<th class="at-col-score sortable text-center" onclick="IntegrityController.sortAuditTable(\'riskScore\')">Risk ' + sortIcon('riskScore') + '</th>' +
            '</tr></thead><tbody>';
            
            if (pageRecords.length === 0) {
                tableHtml += '<tr><td colspan="8" class="text-center text-muted py-4"><i class="fas fa-check-circle text-success fa-2x mb-2 d-block"></i>No records match filters</td></tr>';
            } else {
                pageRecords.forEach(function(r) {
                    var rc = r.riskScore >= 70 ? 'critical' : r.riskScore >= 40 ? 'high' : r.riskScore >= 20 ? 'medium' : 'low';
                    var dotColor = rc === 'critical' ? '#dc3545' : rc === 'high' ? '#fd7e14' : rc === 'medium' ? '#ffc107' : '#28a745'; var riskDot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + dotColor + ';"></span>';
                    var internalId = r.recordId || '';
                    
                    var factorIcons = [];
                    if (r.hasBanking) factorIcons.push('<i class="fas fa-university text-danger" title="Banking Changes"></i>');
                    if (r.hasAddress) factorIcons.push('<i class="fas fa-map-marker-alt text-warning" title="Address Changes"></i>');
                    if (r.hasDeletion) factorIcons.push('<i class="fas fa-trash text-danger" title="Deletions"></i>');
                    if (r.recordType === 'Entity' || r.recordType === 'Vendor' || r.recordType === 'Customer') factorIcons.push('<i class="fas fa-building text-info" title="Entity Record"></i>');
                    
                    tableHtml += '<tr class="at-record-row risk-' + rc + ' clickable-row" onclick="IntegrityController.openAuditFlyout(\'' + internalId + '\')">' +
                        '<td class="at-col-risk">' + riskDot + '</td>' +
                        '<td class="at-col-record"><div class="at-record-cell"><span class="at-record-type-badge">' + (r.recordType || 'Rec').substring(0, 4) + '</span><span class="at-record-name" title="' + internalId + '">' + self.truncateValue(r.recordName || internalId, 40) + '</span></div></td>' +
                        '<td class="at-col-type"><span class="text-muted small">' + (r.recordType || '-') + '</span></td>' +
                        '<td class="at-col-changes text-center"><span class="badge badge-secondary">' + r.changeCount + '</span></td>' +
                        '<td class="at-col-users text-center">' + r.userCount + '</td>' +
                        '<td class="at-col-flags"><div class="at-factor-icons">' + (factorIcons.join(' ') || '<span class="text-muted">-</span>') + '</div></td>' +
                        '<td class="at-col-date"><span class="small">' + (r.lastDate || '-') + '</span></td>' +
                        '<td class="at-col-score text-center"><span class="badge badge-' + (rc === 'critical' ? 'danger' : rc === 'high' ? 'warning' : rc === 'medium' ? 'info' : 'secondary') + '">' + Math.round(r.riskScore) + '</span></td>' +
                    '</tr>';
                });
            }
            tableHtml += '</tbody></table>';
            
            var pagHtml = '<div class="pagination-bar d-flex justify-content-between align-items-center mt-2 px-2">' +
                '<span class="small text-muted">Showing ' + (startIdx + 1) + '-' + Math.min(startIdx + pag.pageSize, filtered.length) + ' of ' + filtered.length + '</span>' +
                '<div class="btn-group btn-group-sm">' +
                '<button class="btn btn-outline-secondary" ' + (pag.page <= 1 ? 'disabled' : '') + ' onclick="IntegrityController.goToAuditPage(' + (pag.page - 1) + ')"><i class="fas fa-chevron-left"></i></button>' +
                '<span class="btn btn-outline-secondary disabled">Page ' + pag.page + ' of ' + totalPages + '</span>' +
                '<button class="btn btn-outline-secondary" ' + (pag.page >= totalPages ? 'disabled' : '') + ' onclick="IntegrityController.goToAuditPage(' + (pag.page + 1) + ')"><i class="fas fa-chevron-right"></i></button>' +
                '</div></div>';
            
            tableContainer.innerHTML = tableHtml + pagHtml;
        },
        
        sortAuditTable: function(column) {
            var sort = this.auditTrailSort;
            if (sort.column === column) {
                sort.direction = sort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sort.column = column;
                sort.direction = (column === 'recordName' || column === 'recordType') ? 'asc' : 'desc';
            }
            this.pagination.audittrail.page = 1;
            this.renderAuditTrailTab();
        },
        
        goToAuditPage: function(page) {
            this.pagination.audittrail.page = page;
            this.renderAuditTrailTab();
        },
        
        openAuditFlyout: function(recordId) {
            var self = this;
            var flyout = document.getElementById('atFlyout');
            if (!flyout) { console.error('Flyout element not found'); return; }
            
            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');
            
            var title = document.getElementById('atFlyoutTitle');
            var subtitle = document.getElementById('atFlyoutSubtitle');
            var stats = document.getElementById('atFlyoutStats');
            var body = document.getElementById('atFlyoutBody');
            
            title.textContent = 'Record #' + recordId;
            subtitle.textContent = 'Loading...';
            stats.innerHTML = '';
            body.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x text-muted"></i></div>';
            
            var startDate = el('#integrityStartDate');
            var endDate = el('#integrityEndDate');
            startDate = startDate ? startDate.value : '';
            endDate = endDate ? endDate.value : '';
            
            var params = {
                subAction: 'audit_record_detail',
                recordId: recordId,
                startDate: startDate,
                endDate: endDate
            };
            
            API.post('integrity', params)
                .then(function(data) {
                    if (data && data.changes) {
                        self.renderAuditFlyoutContent(data);
                    } else if (data && data.data && data.data.changes) {
                        self.renderAuditFlyoutContent(data.data);
                    } else if (data && data.error) {
                        body.innerHTML = '<div class="alert alert-warning">' + data.error + '</div>';
                    } else {
                        body.innerHTML = '<div class="alert alert-info">No changes found for this record.</div>';
                    }
                })
                .catch(function(err) {
                    console.error('Flyout error:', err);
                    body.innerHTML = '<div class="alert alert-danger">Error loading record details: ' + (err.message || err) + '</div>';
                });
        },
        
        closeFlyout: function() {
            var flyout = document.getElementById('atFlyout');
            if (flyout) {
                flyout.classList.remove('open');
                document.body.classList.remove('at-flyout-open');
            }
        },
        
        renderAuditFlyoutContent: function(data) {
            var self = this;
            var title = document.getElementById('atFlyoutTitle');
            var subtitle = document.getElementById('atFlyoutSubtitle');
            var stats = document.getElementById('atFlyoutStats');
            var body = document.getElementById('atFlyoutBody');
            
            title.textContent = data.recordName || ('Record #' + data.recordId);
            subtitle.style.display = 'none';
            
            var summary = data.summary || {};
            var changes = data.changes || [];
            
            // Build KPIs array
            var kpis = [
                { label: 'Changes', value: changes.length, icon: 'edit', color: 'primary' },
                { label: 'Users', value: summary.uniqueUsers || 1, icon: 'users', color: 'info' }
            ];
            if (summary.hasBanking) kpis.push({ label: 'Banking', value: '⚠', icon: 'university', color: 'danger' });
            if (summary.hasAddress) kpis.push({ label: 'Address', value: '⚠', icon: 'map-marker-alt', color: 'warning' });
            if (summary.weekendChanges > 0) kpis.push({ label: 'Weekend', value: summary.weekendChanges, icon: 'calendar-week', color: 'warning' });
            
            stats.innerHTML = this.buildFlyoutKPIs(kpis);
            
            // Table format - same style as calendar flyout
            if (changes.length === 0) {
                body.innerHTML = '<div class="text-center text-muted py-4"><i class="fas fa-check-circle text-success fa-2x mb-2 d-block"></i>No changes found</div>';
                return;
            }
            
            var rowsHtml = changes.map(function(c) {
                var riskBadge = c.riskScore >= 40 ? '<span class="severity-dot ' + self.getSeverityClass(c.riskScore) + '"></span> ' + c.riskScore : '';
                var actionIcon = c.action === 'CREATE' ? 'plus text-success' : c.action === 'DELETE' ? 'trash text-danger' : 'edit text-primary';
                var valueDisplay = '';
                if (c.oldValue && c.newValue) {
                    valueDisplay = '<div class="audit-change-values"><div class="audit-old"><i class="fas fa-minus-circle text-danger"></i> ' + c.oldValue + '</div><div class="audit-new"><i class="fas fa-plus-circle text-success"></i> ' + c.newValue + '</div></div>';
                } else if (c.newValue) {
                    valueDisplay = '<div class="audit-change-values"><div class="audit-new"><i class="fas fa-plus-circle text-success"></i> ' + c.newValue + '</div></div>';
                } else if (c.oldValue) {
                    valueDisplay = '<div class="audit-change-values"><div class="audit-old"><i class="fas fa-minus-circle text-danger"></i> ' + c.oldValue + '</div></div>';
                }
                
                return '<div class="audit-change-row">' +
                    '<div class="audit-change-header">' +
                        '<span class="audit-action"><i class="fas fa-' + actionIcon + '"></i></span>' +
                        '<span class="audit-field">' + (c.field || 'Unknown Field') + '</span>' +
                        (riskBadge ? '<span class="audit-risk">' + riskBadge + '</span>' : '') +
                    '</div>' +
                    '<div class="audit-change-meta">' +
                        '<span class="audit-user"><i class="fas fa-user"></i> ' + (c.user || 'Unknown') + '</span>' +
                        '<span class="audit-time"><i class="fas fa-clock"></i> ' + (c.timestamp || '-') + '</span>' +
                    '</div>' +
                    valueDisplay +
                '</div>';
            }).join('');
            
            body.innerHTML = '<div class="audit-changes-list">' + rowsHtml + '</div>';
        },
        
        truncateValue: function(val, maxLen) {
            if (!val) return '';
            val = String(val);
            return val.length > maxLen ? val.substring(0, maxLen) + '...' : val;
        },

        // RSF row flyout - pass entire row object
        openRSFDetailFlyout: function(row) {
            if (typeof row === 'string') row = JSON.parse(row);
            var flyout = document.getElementById('atFlyout');
            if (!flyout) return;
            
            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');
            
            var title = row.tranId || ('Transaction #' + row.id);
            document.getElementById('atFlyoutTitle').textContent = title;
            document.getElementById('atFlyoutSubtitle').style.display = 'none';
            
            var rsfClass = row.rsf >= 20 ? 'rsf-critical' : row.rsf >= 10 ? 'rsf-high' : 'rsf-medium';
            var statsHtml = this.buildFlyoutKPIs([
                { label: 'RSF Ratio', value: row.rsf.toFixed(1) + 'x', icon: 'chart-line', color: row.rsf >= 20 ? 'danger' : 'warning' },
                { label: 'Amount', value: fmtMoney(row.largestAmount, 2), icon: 'dollar-sign', color: 'primary' },
                { label: '2nd Largest', value: fmtMoney(row.secondLargestAmount, 2), icon: 'level-down-alt', color: 'info' },
                { label: 'Risk Score', value: Math.round(row.riskScore), icon: 'exclamation-triangle', color: row.riskScore >= 70 ? 'danger' : row.riskScore >= 40 ? 'warning' : 'success' }
            ]);
            document.getElementById('atFlyoutStats').innerHTML = statsHtml;
            
            var entityDisplay = row.vendorName || row.entityName || 'this vendor';
            var bodyHtml = '<div class="p-3">' +
                '<div class="alert alert-warning mb-3"><i class="fas fa-chart-line mr-2"></i><strong>Relative Size Factor (RSF) Flag</strong><br>' +
                'This transaction (' + fmtMoney(row.largestAmount, 2) + ') is <strong>' + row.rsf.toFixed(1) + 'x larger</strong> than the 2nd largest transaction for ' + entityDisplay + '.</div>' +
                '<div class="mb-3"><strong>Transaction Details:</strong>' +
                '<table class="table table-sm mt-2"><thead><tr><th>Tran #</th><th>Date</th><th>Type</th><th>Amount</th></tr></thead>' +
                '<tbody><tr><td>' + getNsLink(row.tranId || 'N/A', row.id) + '</td><td>' + (row.tranDate || 'N/A') + '</td><td>' + (row.type || '-') + '</td><td class="font-weight-bold">' + fmtMoney(row.largestAmount, 2) + '</td></tr></tbody></table></div>' +
                '<div class="mb-3"><strong>Vendor Statistics:</strong>' +
                '<table class="table table-sm mt-2"><tr><td>Vendor</td><td>' + entityDisplay + '</td></tr>' +
                '<tr><td>2nd Largest Transaction</td><td>' + fmtMoney(row.secondLargestAmount, 2) + '</td></tr>' +
                '<tr><td>Average Transaction</td><td>' + fmtMoney(row.avgAmount, 2) + '</td></tr>' +
                '<tr><td>Total Transactions</td><td>' + (row.tranCount || '-') + '</td></tr></table></div>' +
                '<div><strong>Why This Matters:</strong><p class="text-muted small mb-0">A high RSF indicates a transaction that is disproportionately large compared to other transactions for this vendor. This could indicate invoice splitting avoidance, fraudulent billing, or data entry errors.</p></div>' +
                '</div>';
            document.getElementById('atFlyoutBody').innerHTML = bodyHtml;
        },

        // RSF row flyout
        openRSFFlyout: function(vendorId, vendorName) {
            var rsfData = (this.latestData && this.latestData.rsfAnomalies) || [];
            var row = rsfData.find(function(r) { return String(r.vendorId) === String(vendorId); });
            if (!row) { showToast('RSF data not found'); return; }
            
            var transactions = [{
                tranId: row.tranId,
                id: row.id,
                type: 'RSF Anomaly',
                amount: row.largestAmount,
                flagType: 'rsf',
                riskScore: row.riskScore
            }];
            this.showTransactionsFlyout(vendorName || 'RSF Anomaly', transactions, 'Largest: ' + fmtMoney(row.largestAmount, 2) + ' | RSF: ' + row.rsf.toFixed(1) + 'x');
        },

        // Z-Score row flyout - pass entire row object
        openZScoreDetailFlyout: function(row) {
            if (typeof row === 'string') row = JSON.parse(row);
            var flyout = document.getElementById('atFlyout');
            if (!flyout) return;
            
            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');
            
            var title = row.tranId || ('Transaction #' + row.id);
            document.getElementById('atFlyoutTitle').textContent = title;
            document.getElementById('atFlyoutSubtitle').style.display = 'none';
            
            var statsHtml = this.buildFlyoutKPIs([
                { label: 'Z-Score', value: row.zScore.toFixed(2) + 'σ', icon: 'superscript', color: Math.abs(row.zScore) >= 4 ? 'danger' : 'warning' },
                { label: 'Amount', value: fmtMoney(row.amount, 2), icon: 'dollar-sign', color: 'primary' },
                { label: 'Vendor Avg', value: fmtMoney(row.avgAmount, 2), icon: 'calculator', color: 'info' },
                { label: 'Risk Score', value: Math.round(row.riskScore), icon: 'exclamation-triangle', color: row.riskScore >= 70 ? 'danger' : row.riskScore >= 40 ? 'warning' : 'success' }
            ]);
            document.getElementById('atFlyoutStats').innerHTML = statsHtml;
            
            var bodyHtml = '<div class="p-3">' +
                '<div class="alert alert-warning mb-3"><i class="fas fa-superscript mr-2"></i><strong>Z-Score Anomaly Flag</strong><br>' +
                'This transaction of ' + fmtMoney(row.amount, 2) + ' is <strong>' + Math.abs(row.zScore).toFixed(2) + ' standard deviations</strong> from the vendor average.</div>' +
                '<div class="mb-3"><strong>Transaction Details:</strong>' +
                '<table class="table table-sm mt-2"><thead><tr><th>Tran #</th><th>Date</th><th>Type</th><th>Amount</th></tr></thead>' +
                '<tbody><tr><td>' + getNsLink(row.tranId || 'N/A', row.id) + '</td><td>' + (row.tranDate || 'N/A') + '</td><td>' + (row.type || '-') + '</td><td class="font-weight-bold">' + fmtMoney(row.amount, 2) + '</td></tr></tbody></table></div>' +
                '<div class="mb-3"><strong>Statistical Context:</strong><ul class="small text-muted mt-2 mb-0">' +
                '<li>Vendor average: ' + fmtMoney(row.avgAmount, 2) + '</li>' +
                '<li>Standard deviation: ' + fmtMoney(row.stdDev || 0, 2) + '</li>' +
                '<li>Deviation from mean: ' + fmtMoney(Math.abs(row.amount - (row.avgAmount || 0)), 2) + '</li></ul></div>' +
                '<div><strong>Why This Matters:</strong><p class="text-muted small mb-0">A high Z-score indicates a transaction that is statistically unusual. Values above 3σ warrant investigation as they fall outside normal variance.</p></div>' +
                '</div>';
            document.getElementById('atFlyoutBody').innerHTML = bodyHtml;
        },

        // Z-Score row flyout
        openZScoreFlyout: function(vendorId, vendorName, tranId) {
            var zData = (this.latestData && this.latestData.zScoreAnomalies) || [];
            var row = zData.find(function(z) { return String(z.vendorId) === String(vendorId) && z.tranId === tranId; });
            if (!row) { showToast('Z-Score data not found'); return; }
            
            var transactions = [{
                tranId: row.tranId,
                id: row.id,
                type: 'Z-Score Anomaly',
                amount: row.amount,
                flagType: 'zscore',
                riskScore: row.riskScore
            }];
            this.showTransactionsFlyout(vendorName || 'Z-Score Anomaly', transactions, 'Z-Score: ' + row.zScore.toFixed(2) + 'σ | Mean: ' + fmtMoney(row.avgAmount || row.vendorMean || 0));
        },

        // Vendor card flyout - uses API
        openVendorFlyout: function(vendorId, vendorName) {
            this.openEntityFlyout('vendor', vendorId, vendorName);
        },

        // User card flyout - uses API
        openUserFlyout: function(userId, userName) {
            this.openEntityFlyout('user', userId, userName);
        },

        // Ghost vendor flyout
        openGhostFlyout: function(vendorId, vendorName) {
            var ghosts = (this.latestData && this.latestData.ghostVendors) || [];
            var ghost = ghosts.find(function(g) { return String(g.vendorId) === String(vendorId); });
            if (!ghost) { showToast('Ghost vendor data not found'); return; }
            
            var flyout = document.getElementById('atFlyout');
            if (!flyout) return;
            
            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');
            
            document.getElementById('atFlyoutTitle').textContent = vendorName || 'Ghost Vendor';
            document.getElementById('atFlyoutSubtitle').style.display = 'none';
            document.getElementById('atFlyoutStats').innerHTML = this.buildFlyoutKPIs([
                { label: 'Employee Match', value: ghost.employeeName || 'Unknown', icon: 'user', color: 'danger' },
                { label: 'Total Amount', value: fmtMoney(ghost.totalAmount || 0), icon: 'dollar-sign', color: 'primary' },
                { label: 'Transactions', value: ghost.transactionCount || 0, icon: 'file-invoice', color: 'info' },
                { label: 'Risk Score', value: ghost.riskScore || 85, icon: 'exclamation-triangle', color: 'danger' }
            ]);
            document.getElementById('atFlyoutBody').innerHTML = 
                '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle mr-2"></i><strong>Address Match Detected</strong></div>' +
                '<div class="mb-3"><strong>Matched Address:</strong><br><span class="text-muted">' + (ghost.matchedAddress || 'Address on file') + '</span></div>' +
                '<p class="text-muted small">This vendor shares an address with an employee, which may indicate a fictitious vendor scheme.</p>';
        },

        // Sequential invoice flyout
        openSequentialDetailFlyout: function(idx) {
            var self = this;
            var seqs = (this.latestData && this.latestData.sequentialInvoices) || [];
            var seq = seqs[idx];
            if (!seq) { this.showToast('Sequential invoice data not found', 'error'); return; }

            var flyout = document.getElementById('atFlyout');
            if (!flyout) return;

            flyout.classList.add('open');
            document.body.classList.add('at-flyout-open');

            var invoices = seq.invoices || [];
            var entityName = seq.entityName || (invoices.length > 0 && invoices[0].entityName) || 'Unknown Entity';
            var invoiceCount = seq.count || seq.sequenceLength || invoices.length;
            var invoiceRange = (seq.startInvoice || seq.startNum) + ' - ' + (seq.endInvoice || seq.endNum);

            // Date span info - MORE days = MORE suspicious (shell company indicator)
            var dateSpanLabel = 'Date Span';
            var dateSpanValue = 'N/A';
            var dateSpanColor = 'info';
            if (seq.dateSpanDays != null) {
                dateSpanValue = seq.dateSpanDays + ' days';
                // Longer span = higher risk (opposite of before)
                if (seq.dateSpanDays >= 30) {
                    dateSpanColor = 'danger';  // 30+ days = high risk
                } else if (seq.dateSpanDays >= 7) {
                    dateSpanColor = 'warning'; // 7-30 days = medium risk
                } else {
                    dateSpanColor = 'info';    // Less than 7 days = lower risk
                }
            }

            document.getElementById('atFlyoutTitle').textContent = entityName;
            document.getElementById('atFlyoutSubtitle').style.display = 'none';
            document.getElementById('atFlyoutStats').innerHTML = this.buildFlyoutKPIs([
                { label: 'Invoices', value: invoiceCount, icon: 'sort-numeric-down', color: 'warning' },
                { label: 'Range', value: invoiceRange, icon: 'arrows-alt-h', color: 'info' },
                { label: dateSpanLabel, value: dateSpanValue, icon: 'calendar-alt', color: dateSpanColor },
                { label: 'Total Amount', value: fmtMoney(seq.totalAmount || 0, 2), icon: 'dollar-sign', color: 'primary' },
                { label: 'Risk Score', value: seq.riskScore || 0, icon: 'exclamation-triangle', color: seq.riskScore >= 70 ? 'danger' : seq.riskScore >= 40 ? 'warning' : 'success' }
            ]);
            
            // Show loading state then fetch detailed data via API
            document.getElementById('atFlyoutBody').innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><div class="mt-2 text-muted">Loading invoice details...</div></div>';
            
            var startDate = el('#integrityStartDate');
            var endDate = el('#integrityEndDate');
            startDate = startDate ? startDate.value : '';
            endDate = endDate ? endDate.value : '';
            
            var params = {
                subAction: 'sequential_detail',
                pattern: {
                    startInvoice: seq.startInvoice || seq.startNum,
                    endInvoice: seq.endInvoice || seq.endNum
                },
                startDate: startDate,
                endDate: endDate,
                subsidiaryId: self.subsidiaryId || ''
            };
            
            API.post('integrity', params)
                .then(function(res) {
                    if (res.status === 'success' && res.data) {
                        var data = res.data;
                        var detailInvoices = data.invoices || invoices;
                        var displayEntity = data.entityName || entityName;
                        
                        // Update title with fetched entity name if available
                        if (data.entityName) {
                            document.getElementById('atFlyoutTitle').textContent = data.entityName;
                        }
                        
                        var invoiceRows = detailInvoices.map(function(inv) {
                            return '<tr>' +
                                '<td>' + (inv.invoiceNum || '-') + '</td>' +
                                '<td>' + getNsLink(inv.tranId, inv.id) + '</td>' +
                                '<td>' + (inv.tranDate || '-') + '</td>' +
                                '<td class="text-right">' + fmtMoney(inv.amount, 2) + '</td>' +
                            '</tr>';
                        }).join('');
                        
                        document.getElementById('atFlyoutBody').innerHTML = 
                            '<div class="alert alert-warning mb-3"><i class="fas fa-sort-numeric-down mr-2"></i><strong>Sequential Pattern</strong> - May indicate fabricated invoices</div>' +
                            '<table class="table table-sm"><thead><tr><th>Invoice #</th><th>Tran #</th><th>Date</th><th class="text-right">Amount</th></tr></thead><tbody>' + invoiceRows + '</tbody></table>';
                    } else {
                        // Fallback to local data
                        self.renderSequentialFlyoutFromLocal(seq, invoices, entityName);
                    }
                })
                .catch(function(err) {
                    console.error('Sequential detail error:', err);
                    // Fallback to local data
                    self.renderSequentialFlyoutFromLocal(seq, invoices, entityName);
                });
        },
        
        // Helper to render sequential flyout from local data (fallback)
        renderSequentialFlyoutFromLocal: function(seq, invoices, entityName) {
            var invoiceRows = invoices.map(function(inv) {
                return '<tr>' +
                    '<td>' + (inv.invoiceNum || '-') + '</td>' +
                    '<td>' + getNsLink(inv.tranId, inv.id) + '</td>' +
                    '<td>' + (inv.tranDate || '-') + '</td>' +
                    '<td class="text-right">' + fmtMoney(inv.amount, 2) + '</td>' +
                '</tr>';
            }).join('');
            
            document.getElementById('atFlyoutBody').innerHTML = 
                '<div class="alert alert-warning mb-3"><i class="fas fa-sort-numeric-down mr-2"></i><strong>Sequential Pattern</strong> - May indicate fabricated invoices</div>' +
                '<table class="table table-sm"><thead><tr><th>Invoice #</th><th>Tran #</th><th>Date</th><th class="text-right">Amount</th></tr></thead><tbody>' + invoiceRows + '</tbody></table>';
        },

        openSequentialFlyout: function(vendorId, vendorName) {
            // Legacy function - redirect to detail flyout
            var seqs = (this.latestData && this.latestData.sequentialInvoices) || [];
            for (var i = 0; i < seqs.length; i++) {
                if (String(seqs[i].vendorId) === String(vendorId)) {
                    this.openSequentialDetailFlyout(i);
                    return;
                }
            }
            this.showToast('Sequential invoice data not found', 'error');
        },

        getTemplate: function() {
            return '<div class="cf-dashboard integrity-dashboard">' +
                '<div class="row mb-3">' +
                    '<div class="col-md-12">' +
                        '<form class="form-inline justify-content-center" id="integrityDateForm" onsubmit="return false;">' +
                            '<select class="form-control form-control-sm mr-3" id="integritySubsidiary" style="max-width: 200px;"><option value="">All Subsidiaries</option></select>' +
                            '<label class="mr-2 small text-muted">Range:</label>' +
                            '<input type="date" class="form-control form-control-sm mr-2" id="integrityStartDate">' +
                            '<span class="mr-2">to</span>' +
                            '<input type="date" class="form-control form-control-sm mr-2" id="integrityEndDate">' +
                            '<button type="button" class="btn btn-sm btn-primary" id="integrityApplyRange">Apply</button>' +
                        '</form>' +
                    '</div>' +
                '</div>' +
                '<div id="integrityCriticalAlerts" class="integrity-critical-alerts" style="display: none;"></div>' +
                '<div class="row mb-2 gutters-sm cf-kpi-row">' +
                    '<div class="col"><div class="cf-kpi-card" id="integrityRiskGauge"></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-yellow-soft"><i class="fas fa-flag text-yellow"></i></div><div class="kpi-content"><span class="kpi-label">Flagged</span><span class="kpi-value" id="INT_FlaggedCount">0</span></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-purple-soft"><i class="fas fa-copy text-purple"></i></div><div class="kpi-content"><span class="kpi-label">Duplicate Risk</span><span class="kpi-value" id="INT_DuplicateRisk">$0</span><span class="kpi-sub" id="INT_DuplicateCount">0 matches</span></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-blue-soft"><i class="fas fa-calendar-week text-blue"></i></div><div class="kpi-content"><span class="kpi-label">Weekend</span><span class="kpi-value" id="INT_WeekendCount">0</span><span class="kpi-sub" id="INT_WeekendAmount">$0</span></div></div></div>' +
                    '<div class="col"><div class="cf-kpi-card"><div class="icon-wrapper bg-red-soft"><i class="fas fa-exclamation-triangle text-red"></i></div><div class="kpi-content"><span class="kpi-label">At Risk</span><span class="kpi-value" id="INT_TotalAtRisk">$0</span><span class="kpi-sub" id="INT_PercentAtRisk">0%</span></div></div></div>' +
                '</div>' +
                '<div class="card cf-main-card shadow-sm">' +
                    '<div class="card-header border-0 bg-white pt-3 pb-1 px-3">' +
                        '<ul class="nav nav-tabs cf-tabs" id="integrityTabs">' +
                            '<li class="nav-item"><a class="nav-link active" id="integrity-overview-tab" data-toggle="tab" href="#integrity-overview"><i class="fas fa-home"></i> Overview</a></li>' +
                            '<li class="nav-item"><a class="nav-link" id="integrity-audittrail-tab" data-toggle="tab" href="#integrity-audittrail"><i class="fas fa-history"></i> Audit Trail</a></li>' +
                            '<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" data-toggle="dropdown" href="#" role="button"><i class="fas fa-chart-bar"></i> Analysis</a><div class="dropdown-menu"><a class="dropdown-item" id="integrity-benford-tab" data-toggle="tab" href="#integrity-benford"><i class="fas fa-chart-bar mr-2"></i>Benford</a><a class="dropdown-item" id="integrity-rsf-tab" data-toggle="tab" href="#integrity-rsf"><i class="fas fa-chart-line mr-2"></i>RSF</a><a class="dropdown-item" id="integrity-zscore-tab" data-toggle="tab" href="#integrity-zscore"><i class="fas fa-superscript mr-2"></i>Z-Score</a><a class="dropdown-item" id="integrity-heatmap-tab" data-toggle="tab" href="#integrity-heatmap"><i class="fas fa-th mr-2"></i>Calendar</a></div></li>' +
                            '<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" data-toggle="dropdown" href="#" role="button"><i class="fas fa-search"></i> Detection</a><div class="dropdown-menu"><a class="dropdown-item" id="integrity-flagged-tab" data-toggle="tab" href="#integrity-flagged"><i class="fas fa-flag mr-2"></i>All Flagged</a><a class="dropdown-item" id="integrity-duplicates-tab" data-toggle="tab" href="#integrity-duplicates"><i class="fas fa-copy mr-2"></i>Duplicates</a><a class="dropdown-item" id="integrity-weekend-tab" data-toggle="tab" href="#integrity-weekend"><i class="fas fa-calendar-week mr-2"></i>Weekend</a><a class="dropdown-item" id="integrity-ghost-tab" data-toggle="tab" href="#integrity-ghost"><i class="fas fa-user-secret mr-2"></i>Ghost Vendors</a><a class="dropdown-item" id="integrity-sequential-tab" data-toggle="tab" href="#integrity-sequential"><i class="fas fa-sort-numeric-down mr-2"></i>Sequential</a><a class="dropdown-item" id="integrity-vendors-tab" data-toggle="tab" href="#integrity-vendors"><i class="fas fa-building mr-2"></i>Vendors</a><a class="dropdown-item" id="integrity-users-tab" data-toggle="tab" href="#integrity-users"><i class="fas fa-users mr-2"></i>Users</a></div></li>' +
                            '<li class="nav-item"><a class="nav-link" id="integrity-config-tab" data-toggle="tab" href="#integrity-config">Configuration</a></li>' +
                        '</ul>' +
                    '</div>' +
                    '<div class="card-body p-0">' +
                        '<div class="tab-content">' +
                            '<div class="tab-pane fade show active" id="integrity-overview"><div class="overview-grid"><div class="overview-main"><div id="integrityExecutiveSummary"></div><div class="overview-section"><div class="section-hdr"><h6><i class="fas fa-chart-area"></i> Flag Distribution</h6></div><div id="integrityOverviewHeatmap"></div></div><div class="overview-section"><div class="section-hdr"><h6><i class="fas fa-exclamation-circle"></i> Top Flagged</h6><a href="#" onclick="jQuery(\'#integrity-flagged-tab\').tab(\'show\');return false;">View All →</a></div><table class="table table-sm flagged-preview"><thead><tr><th></th><th>Date</th><th>Tran #</th><th class="text-right">Amount</th><th>Flag</th><th>Reason</th></tr></thead><tbody id="integrityTopFlagged"></tbody></table></div></div><div class="overview-sidebar"><div class="sidebar-card"><div class="sc-header danger"><i class="fas fa-exclamation-triangle"></i> Risk Areas</div><div class="sc-body" id="integrityRiskAreas"></div></div><div class="sidebar-card"><div class="sc-header warning"><i class="fas fa-lightbulb"></i> Actions</div><div class="sc-body" id="integrityRecommendations"></div></div></div></div></div>' +
                            '<div class="tab-pane fade" id="integrity-audittrail"><div class="tab-inner" id="integrityAuditTrailContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-benford"><div class="tab-inner" id="integrityBenfordContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-rsf"><div class="tab-inner" id="integrityRSFContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-zscore"><div class="tab-inner" id="integrityZScoreContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-heatmap"><div class="tab-inner"><div id="integrityFullHeatmap"></div></div></div>' +
                            '<div class="tab-pane fade" id="integrity-flagged"><div class="tab-inner" id="integrityAllFlaggedContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-duplicates"><div class="tab-inner" id="integrityDuplicatesContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-weekend"><div class="tab-inner" id="integrityWeekendContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-ghost"><div class="tab-inner" id="integrityGhostContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-sequential"><div class="tab-inner" id="integritySequentialContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-vendors"><div class="tab-inner" id="integrityVendorContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-users"><div class="tab-inner" id="integrityUserContent"></div></div>' +
                            '<div class="tab-pane fade" id="integrity-config"><div class="tab-inner" id="integrityConfigContent"></div></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '<div id="atFlyout" class="at-flyout">' +
                '<div class="at-flyout-backdrop" onclick="IntegrityController.closeFlyout()"></div>' +
                '<div class="at-flyout-panel">' +
                    '<div class="at-flyout-header">' +
                        '<h5 class="at-flyout-title" id="atFlyoutTitle">Record Details</h5>' +
                        '<button class="at-flyout-close" onclick="IntegrityController.closeFlyout()"><i class="fas fa-times"></i></button>' +
                    '</div>' +
                    '<div class="at-flyout-subtitle" id="atFlyoutSubtitle"></div>' +
                    '<div class="at-flyout-stats" id="atFlyoutStats"></div>' +
                    '<div class="at-flyout-body" id="atFlyoutBody"></div>' +
                '</div>' +
            '</div>' +
            '</div>';
        }
    };

    window.IntegrityController = IntegrityController;
    Router.register('integrity', function() { IntegrityController.init(); });
    console.log('[Dashboard.Integrity] Next-Level Enterprise Forensic Version Loaded');

})(window);