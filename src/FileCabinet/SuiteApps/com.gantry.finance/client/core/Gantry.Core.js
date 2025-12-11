/**
 * Gantry.Core.js
 * Core framework - utilities, API client, router
 * 
 * EXACT PORT from gantry_app.js lines 1-118
 */
(function(window) {
    'use strict';

    // ==========================================
    // UTILITIES & HELPERS
    // ==========================================
    const el = (sel) => document.querySelector(sel);
    
    const fmtMoney = (n, decimals = 0) => {
        if (n == null || isNaN(Number(n))) return "$0";
        return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };

    const fmtNum = (n, digits = 1) => {
        if (n == null) return "0";
        return (Number(n) || 0).toFixed(digits);
    };

    const fmtPct = (n, digits = 1) => {
        if (n == null || isNaN(n)) return "—";
        // n is expected to be a decimal (0.25 = 25%), multiply by 100 for display
        return (Number(n) * 100).toFixed(digits) + "%";
    };

    const getNsLink = (text, internalId) => {
        if (!internalId) return text;
        const url = `/app/accounting/transactions/transaction.nl?id=${internalId}`;
        return `<a href="${url}" target="_blank" class="cf-link" onclick="event.stopPropagation()">${text} <i class="fas fa-external-link-alt fa-xs ml-1 opacity-50"></i></a>`;
    };

    const getTrendHtml = (val, isPositiveGood) => {
        if (val == null) return "";
        const color = (val > 0 === isPositiveGood) ? "text-success" : (val === 0 ? "text-muted" : "text-danger");
        const icon = val >= 0 ? "fa-arrow-up" : "fa-arrow-down";
        return `<span class="${color}"><i class="fas ${icon} small mr-1"></i>${Math.abs(val).toFixed(1)}</span>`;
    };

    const STRATEGY_DEFINITIONS = {
        'gl_history_average': { title: "Historical GL Smoothing", text: "Analyzes historical General Ledger activity over a defined lookback period to calculate a baseline weekly average." },
        'vendor_payment_history': { title: "Vendor Aggregate Analysis", text: "Aggregates historical payments to specific vendors or categories." },
        'credit_card_cycle': { title: "Hybrid Liability Projection", text: "Combines real-time GL balances with historical run-rates for credit card cycles." },
        'manual_recurring': { title: "Deterministic Scheduling", text: "Sets a fixed, rigid cash flow event (Weekly, Bi-Weekly, or Monthly)." },
        'formula_expression': { title: "Programmable Logic Engine", text: "Execute complex financial modeling using Excel-style syntax." },
        'vendor_recurring_average': { title: "Intelligent Pattern Recognition", text: "Automatically detects payment frequency and calculates a normalized payment amount." },
        'bank_register_history': { title: "Bank Register Analysis", text: "Forecasts based on actual cash movements in specific bank accounts." }
    };

    // ==========================================
    // SPARKLINE GENERATOR
    // ==========================================
    const Sparkline = {
        /**
         * Generate SVG sparkline from data array
         * @param {number[]} data - Array of numeric values (6-12 points ideal)
         * @param {object} options - Configuration options
         * @returns {string} SVG markup string
         */
        generate(data, options = {}) {
            const {
                width = 60,
                height = 20,
                stroke = 'auto',
                strokeWidth = 1.5,
                fill = 'none',
                showDot = true,
                positiveColor = '#10b981',
                negativeColor = '#ef4444',
                neutralColor = '#6b7280'
            } = options;

            if (!data || data.length < 2) {
                return `<svg width="${width}" height="${height}" class="sparkline"></svg>`;
            }

            // Filter out null/undefined values
            const cleanData = data.filter(v => v != null && !isNaN(v));
            if (cleanData.length < 2) {
                return `<svg width="${width}" height="${height}" class="sparkline"></svg>`;
            }

            const min = Math.min(...cleanData);
            const max = Math.max(...cleanData);
            const range = max - min || 1;
            
            const padding = 2;
            const chartWidth = width - (padding * 2);
            const chartHeight = height - (padding * 2);
            
            // Generate points
            const points = cleanData.map((val, i) => {
                const x = padding + (i / (cleanData.length - 1)) * chartWidth;
                const y = padding + chartHeight - ((val - min) / range) * chartHeight;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');

            // Determine trend color
            const trend = cleanData[cleanData.length - 1] - cleanData[0];
            const autoColor = trend > 0 ? positiveColor : trend < 0 ? negativeColor : neutralColor;
            const lineColor = stroke === 'auto' ? autoColor : stroke;

            // Last point coordinates for dot
            const lastX = padding + chartWidth;
            const lastY = padding + chartHeight - ((cleanData[cleanData.length - 1] - min) / range) * chartHeight;

            let svg = `<svg width="${width}" height="${height}" class="sparkline">
                <polyline points="${points}" fill="${fill}" stroke="${lineColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
            
            if (showDot) {
                svg += `<circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2" fill="${autoColor}"/>`;
            }
            
            svg += `</svg>`;
            return svg;
        },

        /**
         * Generate area sparkline (filled under line)
         */
        generateArea(data, options = {}) {
            const {
                width = 80,
                height = 24,
                stroke = '#3b82f6',
                fill = 'rgba(59, 130, 246, 0.15)',
                strokeWidth = 1.5
            } = options;

            if (!data || data.length < 2) {
                return `<svg width="${width}" height="${height}" class="sparkline-area"></svg>`;
            }

            const cleanData = data.filter(v => v != null && !isNaN(v));
            if (cleanData.length < 2) {
                return `<svg width="${width}" height="${height}" class="sparkline-area"></svg>`;
            }

            const min = Math.min(...cleanData, 0);
            const max = Math.max(...cleanData);
            const range = max - min || 1;
            
            const padding = 2;
            const chartWidth = width - (padding * 2);
            const chartHeight = height - (padding * 2);
            
            const points = cleanData.map((val, i) => {
                const x = padding + (i / (cleanData.length - 1)) * chartWidth;
                const y = padding + chartHeight - ((val - min) / range) * chartHeight;
                return { x, y };
            });

            const linePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
            
            const baseY = padding + chartHeight - ((0 - min) / range) * chartHeight;
            const areaPoints = [
                `${points[0].x.toFixed(1)},${baseY.toFixed(1)}`,
                ...points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
                `${points[points.length-1].x.toFixed(1)},${baseY.toFixed(1)}`
            ].join(' ');

            return `<svg width="${width}" height="${height}" class="sparkline-area">
                <polygon points="${areaPoints}" fill="${fill}"/>
                <polyline points="${linePoints}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        },

        /**
         * Generate bar sparkline
         */
        generateBars(data, options = {}) {
            const {
                width = 60,
                height = 20,
                barGap = 1,
                positiveColor = '#10b981',
                negativeColor = '#ef4444'
            } = options;

            if (!data || data.length < 1) {
                return `<svg width="${width}" height="${height}" class="sparkline-bars"></svg>`;
            }

            const cleanData = data.filter(v => v != null && !isNaN(v));
            if (cleanData.length < 1) {
                return `<svg width="${width}" height="${height}" class="sparkline-bars"></svg>`;
            }

            const max = Math.max(...cleanData.map(Math.abs));
            const barWidth = (width - (cleanData.length - 1) * barGap) / cleanData.length;
            const midY = height / 2;

            let bars = '';
            cleanData.forEach((val, i) => {
                const barHeight = max > 0 ? (Math.abs(val) / max) * (height / 2 - 2) : 0;
                const x = i * (barWidth + barGap);
                const y = val >= 0 ? midY - barHeight : midY;
                const color = val >= 0 ? positiveColor : negativeColor;
                bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${color}" rx="1"/>`;
            });

            return `<svg width="${width}" height="${height}" class="sparkline-bars">${bars}</svg>`;
        }
    };

    // ==========================================
    // HEALTH GAUGE COMPONENT
    // ==========================================
    const HealthGauge = {
        /**
         * Generate SVG circular gauge for health scores
         * @param {number} value - Score value (0-100)
         * @param {object} options - Configuration options
         * @returns {string} SVG markup string
         */
        generate(value, options = {}) {
            const {
                size = 120,
                strokeWidth = 10,
                showLabel = true,
                showValue = true,
                label = 'Health Score',
                thresholds = { good: 70, warning: 40 }
            } = options;

            const score = Math.max(0, Math.min(100, value || 0));
            const radius = (size - strokeWidth) / 2;
            const circumference = 2 * Math.PI * radius;
            const progress = (score / 100) * circumference;
            const center = size / 2;

            // Determine color based on thresholds
            let color, bgColor;
            if (score >= thresholds.good) {
                color = '#10b981'; // Green
                bgColor = '#d1fae5';
            } else if (score >= thresholds.warning) {
                color = '#f59e0b'; // Yellow/Orange
                bgColor = '#fef3c7';
            } else {
                color = '#ef4444'; // Red
                bgColor = '#fee2e2';
            }

            return `
            <div class="health-gauge-container" style="width:${size}px; text-align:center;">
                <svg width="${size}" height="${size}" class="health-gauge">
                    <!-- Background circle -->
                    <circle 
                        cx="${center}" cy="${center}" r="${radius}"
                        fill="none" stroke="#e5e7eb" stroke-width="${strokeWidth}"
                    />
                    <!-- Progress arc -->
                    <circle 
                        cx="${center}" cy="${center}" r="${radius}"
                        fill="none" stroke="${color}" stroke-width="${strokeWidth}"
                        stroke-linecap="round"
                        stroke-dasharray="${circumference}"
                        stroke-dashoffset="${circumference - progress}"
                        transform="rotate(-90 ${center} ${center})"
                        style="transition: stroke-dashoffset 0.5s ease;"
                    />
                    ${showValue ? `
                    <!-- Score value -->
                    <text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="middle" 
                          font-size="${size * 0.28}px" font-weight="700" fill="${color}">
                        ${Math.round(score)}
                    </text>
                    ` : ''}
                </svg>
                ${showLabel ? `<div class="health-gauge-label text-muted small mt-1">${label}</div>` : ''}
            </div>`;
        },

        /**
         * Generate mini gauge for inline use
         */
        generateMini(value, options = {}) {
            const { size = 36, strokeWidth = 4 } = options;
            return this.generate(value, { ...options, size, strokeWidth, showLabel: false });
        },

        /**
         * Generate semicircle gauge (180 degrees)
         */
        generateSemi(value, options = {}) {
            const {
                width = 140,
                height = 80,
                strokeWidth = 12,
                showValue = true,
                thresholds = { good: 70, warning: 40 }
            } = options;

            const score = Math.max(0, Math.min(100, value || 0));
            const radius = (width - strokeWidth) / 2;
            const circumference = Math.PI * radius; // Half circle
            const progress = (score / 100) * circumference;

            // Color based on thresholds
            let color;
            if (score >= thresholds.good) color = '#10b981';
            else if (score >= thresholds.warning) color = '#f59e0b';
            else color = '#ef4444';

            const cx = width / 2;
            const cy = height - strokeWidth / 2;

            return `
            <svg width="${width}" height="${height}" class="health-gauge-semi">
                <!-- Background arc -->
                <path d="M ${strokeWidth/2} ${cy} A ${radius} ${radius} 0 0 1 ${width - strokeWidth/2} ${cy}"
                      fill="none" stroke="#e5e7eb" stroke-width="${strokeWidth}" stroke-linecap="round"/>
                <!-- Progress arc -->
                <path d="M ${strokeWidth/2} ${cy} A ${radius} ${radius} 0 0 1 ${width - strokeWidth/2} ${cy}"
                      fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"
                      stroke-dasharray="${circumference}" stroke-dashoffset="${circumference - progress}"
                      style="transition: stroke-dashoffset 0.5s ease;"/>
                ${showValue ? `
                <text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="${width * 0.2}px" font-weight="700" fill="${color}">
                    ${Math.round(score)}
                </text>
                ` : ''}
            </svg>`;
        }
    };

    // ==========================================
    // CASH RUNWAY BAR COMPONENT
    // ==========================================
    const RunwayBar = {
        /**
         * Generate cash runway visualization
         * @param {object} data - Runway data object
         * @param {object} options - Configuration options
         * @returns {string} HTML markup string
         */
        generate(data, options = {}) {
            const weeks = data.weeksRunway || 0;
            const burnRate = data.avgWeeklyBurn || 0;
            const inflowRate = data.avgWeeklyInflow || 0;
            const netChange = data.netWeeklyChange || (inflowRate - burnRate);
            const currentCash = data.currentCash || 0;

            // Determine status
            const isNegativeCash = currentCash < 0;
            const isNetPositive = netChange > 0;
            
            let statusColor, statusText, statusIcon, statusBg;
            
            if (isNegativeCash) {
                statusColor = '#ef4444';
                statusText = 'Negative Cash Position';
                statusIcon = '⚠';
                statusBg = '#fee2e2';
            } else if (!isNetPositive && weeks <= 4) {
                statusColor = '#ef4444';
                statusText = `${weeks.toFixed(0)} Weeks Runway`;
                statusIcon = '⚠';
                statusBg = '#fee2e2';
            } else if (!isNetPositive && weeks <= 8) {
                statusColor = '#f59e0b';
                statusText = `${weeks.toFixed(0)} Weeks Runway`;
                statusIcon = '!';
                statusBg = '#fef3c7';
            } else if (isNetPositive) {
                statusColor = '#10b981';
                statusText = 'Cash Flow Positive';
                statusIcon = '✓';
                statusBg = '#d1fae5';
            } else {
                statusColor = '#10b981';
                statusText = `${weeks.toFixed(0)}+ Weeks Runway`;
                statusIcon = '✓';
                statusBg = '#d1fae5';
            }

            // Format values
            const netChangeFormatted = netChange >= 0 
                ? `+${fmtMoney(netChange)}` 
                : `${fmtMoney(netChange)}`;

            return `
            <div class="runway-bar-container">
                <div class="text-center py-2 rounded mb-3" style="background: ${statusBg};">
                    <div style="font-size: 14px; color: ${statusColor}; font-weight: 600;">
                        ${statusIcon} ${statusText}
                    </div>
                </div>
                
                <div class="row text-center" style="font-size: 12px;">
                    <div class="col-4 border-right">
                        <div class="text-muted mb-1">Current Cash</div>
                        <div class="font-weight-bold ${currentCash < 0 ? 'text-danger' : 'text-dark'}" style="font-size: 14px;">
                            ${fmtMoney(currentCash)}
                        </div>
                    </div>
                    <div class="col-4 border-right">
                        <div class="text-muted mb-1">Weekly Outflow</div>
                        <div class="font-weight-bold text-danger" style="font-size: 14px;">
                            ${fmtMoney(burnRate)}
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="text-muted mb-1">Weekly Inflow</div>
                        <div class="font-weight-bold text-success" style="font-size: 14px;">
                            ${fmtMoney(inflowRate)}
                        </div>
                    </div>
                </div>
                
                <div class="text-center mt-3 pt-2 border-top">
                    <span class="text-muted">Net Weekly: </span>
                    <span class="font-weight-bold" style="color: ${netChange >= 0 ? '#10b981' : '#ef4444'}; font-size: 16px;">
                        ${netChangeFormatted}
                    </span>
                </div>
            </div>`;
        },

        /**
         * Generate compact inline runway indicator
         */
        generateCompact(weeks, options = {}) {
            const { width = 80, height = 6, maxWeeks = 26 } = options;
            const pct = Math.min(100, (weeks / maxWeeks) * 100);
            
            let color;
            if (weeks <= 4) color = '#ef4444';
            else if (weeks <= 8) color = '#f59e0b';
            else color = '#10b981';

            return `
            <div class="runway-compact d-inline-flex align-items-center">
                <div class="runway-compact-bar" style="width:${width}px; height:${height}px;">
                    <div class="runway-compact-fill" style="width:${pct}%; background:${color};"></div>
                </div>
                <span class="runway-compact-value ml-2 small font-weight-bold" style="color:${color}">${weeks.toFixed(0)}w</span>
            </div>`;
        }
    };

    // ==========================================
    // CHART MANAGER (Using Plotly)
    // ==========================================
    const ChartManager = {
        charts: {},

        /**
         * Clear any skeleton or placeholder content from container
         */
        clearContainer(containerId) {
            const container = document.getElementById(containerId);
            if (container) {
                // Remove any skeleton elements before Plotly renders
                const skeletons = container.querySelectorAll('.skeleton-pulse, .skeleton-chart');
                skeletons.forEach(s => s.remove());
                // If container only has skeleton content, clear it entirely
                if (container.innerHTML.includes('skeleton-')) {
                    container.innerHTML = '';
                }
            }
        },

        /**
         * Create or update a cash position area chart
         */
        cashPositionChart(containerId, data, options = {}) {
            const container = document.getElementById(containerId);
            if (!container) return;
            
            // Clear any skeleton content first
            this.clearContainer(containerId);

            const { showForecast = true, height = 200 } = options;
            
            const weeks = data.weekly || [];
            const labels = weeks.map(w => w.weekLabel || w.weekStart);
            const endingCash = weeks.map(w => w.endingCash);
            const inflows = weeks.map(w => w.totalInflow);
            const outflows = weeks.map(w => Math.abs(w.totalOutflow));

            const traces = [
                {
                    x: labels,
                    y: endingCash,
                    type: 'scatter',
                    mode: 'lines',
                    fill: 'tozeroy',
                    name: 'Cash Position',
                    line: { color: '#3b82f6', width: 2 },
                    fillcolor: 'rgba(59, 130, 246, 0.1)'
                }
            ];

            const layout = {
                height: height,
                margin: { t: 10, r: 10, b: 40, l: 60 },
                xaxis: { 
                    tickangle: -45, 
                    tickfont: { size: 10 },
                    gridcolor: '#f3f4f6'
                },
                yaxis: { 
                    tickformat: '$,.0f',
                    tickfont: { size: 10 },
                    gridcolor: '#f3f4f6',
                    zeroline: true,
                    zerolinecolor: '#ef4444',
                    zerolinewidth: 2
                },
                showlegend: false,
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                hovermode: 'x unified'
            };

            const config = { 
                responsive: true, 
                displayModeBar: false 
            };

            if (this.charts[containerId]) {
                Plotly.react(containerId, traces, layout, config);
            } else {
                Plotly.newPlot(containerId, traces, layout, config);
                this.charts[containerId] = true;
            }
        },

        /**
         * Create revenue/GM trend chart
         */
        revenueTrendChart(containerId, data, options = {}) {
            const container = document.getElementById(containerId);
            if (!container) return;
            
            // Clear any skeleton content first
            this.clearContainer(containerId);

            const { height = 110 } = options;
            const sparkData = data.sparklineData || {};
            
            const labels = sparkData.labels || [];
            const revenue = sparkData.revenue || [];
            const gmPct = sparkData.gmPct || [];

            if (labels.length === 0 || revenue.length === 0) return;

            // gmPct is in decimal form (0.25 = 25%), multiply by 100 for display
            const gmPctDisplay = gmPct.map(v => ((v || 0) * 100));
            
            // Calculate revenue range
            const maxRevenue = Math.max(...revenue.filter(v => !isNaN(v) && v > 0)) * 1.15;
            
            // Scale GM% to revenue scale for overlay (GM 0-50% maps to 0-maxRevenue)
            const gmScaleFactor = maxRevenue / 50; // 50% GM would be at top of chart
            const gmScaled = gmPctDisplay.map(v => Math.max(0, v) * gmScaleFactor);

            const traces = [
                {
                    x: labels,
                    y: revenue,
                    type: 'bar',
                    name: 'Revenue',
                    marker: { color: 'rgba(59, 130, 246, 0.75)' },
                    hovertemplate: '<b>%{x}</b><br>Revenue: $%{y:,.0f}<extra></extra>'
                },
                {
                    x: labels,
                    y: gmScaled,
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: 'GM %',
                    line: { color: '#10b981', width: 3 },
                    marker: { size: 8, color: '#10b981' },
                    customdata: gmPctDisplay,
                    hovertemplate: '<b>%{x}</b><br>GM: %{customdata:.1f}%<extra></extra>'
                }
            ];

            // Create right-side tick values that show GM%
            const gmTicks = [0, 10, 20, 30, 40];
            const gmTickVals = gmTicks.map(v => v * gmScaleFactor);
            const gmTickText = gmTicks.map(v => v + '%');

            const layout = {
                height: height,
                margin: { t: 5, r: 35, b: 25, l: 50 },
                xaxis: { 
                    tickfont: { size: 9 },
                    fixedrange: true
                },
                yaxis: { 
                    tickformat: '$,.0s',
                    tickfont: { size: 9 },
                    fixedrange: true,
                    showgrid: true,
                    gridcolor: '#e5e7eb',
                    zeroline: false,
                    range: [0, maxRevenue]
                },
                yaxis2: {
                    tickvals: gmTickVals,
                    ticktext: gmTickText,
                    tickfont: { size: 9, color: '#10b981' },
                    overlaying: 'y',
                    side: 'right',
                    range: [0, maxRevenue],
                    fixedrange: true,
                    showgrid: false,
                    zeroline: false
                },
                showlegend: false,
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                bargap: 0.35,
                hovermode: 'closest',
                hoverlabel: {
                    bgcolor: 'white',
                    bordercolor: '#ccc',
                    font: { size: 11, color: '#333' }
                }
            };

            // Put GM line on y axis (same scale), not y2 - but we'll add y2 for the tick labels
            traces[1].yaxis = 'y';

            const config = { responsive: true, displayModeBar: false };

            if (this.charts[containerId]) {
                Plotly.react(containerId, traces, layout, config);
            } else {
                Plotly.newPlot(containerId, traces, layout, config);
                this.charts[containerId] = true;
            }
        },

        /**
         * Create inflow/outflow stacked bar chart
         */
        flowChart(containerId, data, options = {}) {
            const container = document.getElementById(containerId);
            if (!container) return;
            
            // Clear any skeleton content first
            this.clearContainer(containerId);

            const { height = 160 } = options;
            const weeks = data.weekly || [];
            
            const labels = weeks.map(w => w.weekLabel || w.weekStart);
            const inflows = weeks.map(w => w.totalInflow || 0);
            const outflows = weeks.map(w => Math.abs(w.totalOutflow || 0));

            const traces = [
                {
                    x: labels,
                    y: inflows,
                    type: 'bar',
                    name: 'Inflows',
                    marker: { color: '#10b981' }
                },
                {
                    x: labels,
                    y: outflows.map(v => -v),
                    type: 'bar',
                    name: 'Outflows',
                    marker: { color: '#ef4444' }
                }
            ];

            const layout = {
                height: height,
                margin: { t: 10, r: 10, b: 40, l: 60 },
                barmode: 'relative',
                xaxis: { tickangle: -45, tickfont: { size: 9 } },
                yaxis: { tickformat: '$,.0s', tickfont: { size: 10 } },
                showlegend: true,
                legend: { orientation: 'h', y: -0.35 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent'
            };

            const config = { responsive: true, displayModeBar: false };

            if (this.charts[containerId]) {
                Plotly.react(containerId, traces, layout, config);
            } else {
                Plotly.newPlot(containerId, traces, layout, config);
                this.charts[containerId] = true;
            }
        },

        /**
         * Destroy a chart
         */
        destroy(containerId) {
            if (this.charts[containerId]) {
                Plotly.purge(containerId);
                delete this.charts[containerId];
            }
        },

        /**
         * Resize all charts
         */
        resizeAll() {
            Object.keys(this.charts).forEach(id => {
                const container = document.getElementById(id);
                if (container) {
                    Plotly.Plots.resize(container);
                }
            });
        }
    };

    // ==========================================
    // STATUS COLORS UTILITY
    // ==========================================
    const StatusColors = {
        thresholds: {
            health: { good: 70, warning: 40 },
            gmPct: { good: 0.20, warning: 0.10 },
            utilization: { good: 0.75, warning: 0.50 },
            cashRunway: { good: 12, warning: 8 },
            variance: { good: 0, warning: -0.05 }
        },
        
        colors: {
            good: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
            warning: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
            critical: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
            neutral: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' }
        },

        getStatus(metric, value) {
            const t = this.thresholds[metric];
            if (!t) return 'neutral';
            if (value >= t.good) return 'good';
            if (value >= t.warning) return 'warning';
            return 'critical';
        },

        getColor(metric, value) {
            return this.colors[this.getStatus(metric, value)];
        },

        badge(metric, value, label) {
            const status = this.getStatus(metric, value);
            const c = this.colors[status];
            return `<span class="status-badge status-${status}" style="background:${c.bg}; color:${c.text}; border:1px solid ${c.border};">${label || value}</span>`;
        },

        dot(metric, value) {
            const c = this.getColor(metric, value);
            return `<span class="status-dot" style="background:${c.text};"></span>`;
        }
    };

    // ==========================================
    // SKELETON LOADING SYSTEM
    // ==========================================
    // Unified skeleton with gentle opacity pulse animation.
    // CSS in dark-mode.css handles all animation - works for any size.
    // ==========================================
    const Skeleton = {
        /**
         * Generate skeleton loading HTML
         * @param {string} type - Type: 'card', 'table', 'kpi', 'chart', 'text', 'block', 'section', 'split', 'tabContent', 'custom'
         * @param {object} options - Configuration options
         */
        render(type, options = {}) {
            switch (type) {
                case 'kpi': return this.kpiCard(options);
                case 'card': return this.card(options);
                case 'table': return this.table(options);
                case 'chart': return this.chart(options);
                case 'text': return this.text(options);
                case 'block': return this.block(options);
                case 'section': return this.section(options);
                case 'split': return this.split(options);
                case 'tabContent': return this.tabContent(options);
                default: return this.custom(options);
            }
        },

        /**
         * Base skeleton element - always uses skeleton-pulse class
         * CSS handles the animation uniformly
         */
        _pulse(width = '100%', height = '1rem', className = '', forceSmall = false) {
            return `<div class="skeleton-pulse ${className}" style="width:${width}; height:${height};"></div>`;
        },

        // KPI card skeleton
        kpiCard(options = {}) {
            const { count = 4 } = options;
            let html = '<div class="row">';
            for (let i = 0; i < count; i++) {
                html += `
                    <div class="col-md-3 mb-3">
                        <div class="card shadow-sm">
                            <div class="card-body p-3">
                                <div class="d-flex align-items-center mb-2">
                                    ${this._pulse('40px', '40px', 'rounded', true)}
                                    <div class="ml-3 flex-grow-1">
                                        ${this._pulse('60%', '0.7rem', 'mb-2', true)}
                                        ${this._pulse('40%', '0.6rem', '', true)}
                                    </div>
                                </div>
                                ${this._pulse('50%', '1.5rem', 'mb-2', true)}
                                ${this._pulse('80%', '0.6rem', '', true)}
                            </div>
                        </div>
                    </div>
                `;
            }
            html += '</div>';
            return html;
        },

        // Generic card skeleton
        card(options = {}) {
            const { height = '200px', showHeader = true } = options;
            return `
                <div class="card shadow-sm">
                    ${showHeader ? `<div class="card-header bg-light py-2">${this._pulse('40%', '1rem', '', true)}</div>` : ''}
                    <div class="card-body" style="min-height: ${height};">
                        ${this._pulse('70%', '1rem', 'mb-3', true)}
                        ${this._pulse('90%', '0.8rem', 'mb-2', true)}
                        ${this._pulse('60%', '0.8rem', 'mb-2', true)}
                        ${this._pulse('80%', '0.8rem', '', true)}
                    </div>
                </div>
            `;
        },

        // Table skeleton
        table(options = {}) {
            const { rows = 5, cols = 4 } = options;
            let headerCells = '', bodyRows = '';
            for (let i = 0; i < cols; i++) {
                headerCells += `<th>${this._pulse('80%', '0.8rem', '', true)}</th>`;
            }
            for (let r = 0; r < rows; r++) {
                bodyRows += '<tr>';
                for (let c = 0; c < cols; c++) {
                    bodyRows += `<td>${this._pulse(c === 0 ? '70%' : '50%', '0.75rem', '', true)}</td>`;
                }
                bodyRows += '</tr>';
            }
            return `
                <div class="table-responsive">
                    <table class="table table-sm">
                        <thead class="thead-light"><tr>${headerCells}</tr></thead>
                        <tbody>${bodyRows}</tbody>
                    </table>
                </div>
            `;
        },

        // Chart skeleton - bar chart with subtle pulse
        chart(options = {}) {
            const { height = '200px' } = options;
            return `
                <div class="skeleton-chart" style="height: ${height};">
                    <div class="skeleton-chart-bars">
                        <div class="skeleton-bar" style="height: 40%;"></div>
                        <div class="skeleton-bar" style="height: 70%;"></div>
                        <div class="skeleton-bar" style="height: 55%;"></div>
                        <div class="skeleton-bar" style="height: 85%;"></div>
                        <div class="skeleton-bar" style="height: 45%;"></div>
                        <div class="skeleton-bar" style="height: 65%;"></div>
                        <div class="skeleton-bar" style="height: 50%;"></div>
                    </div>
                </div>
            `;
        },

        // Text lines skeleton
        text(options = {}) {
            const { lines = 3 } = options;
            let html = '';
            for (let i = 0; i < lines; i++) {
                const w = i === lines - 1 ? '60%' : (90 - (i * 10)) + '%';
                html += this._pulse(w, '0.8rem', 'mb-2', true);
            }
            return html;
        },

        // Large content block - always uses subtle pulse
        block(options = {}) {
            const { height = '200px', rounded = true } = options;
            return `<div class="skeleton-block ${rounded ? 'rounded' : ''}" style="width: 100%; height: ${height};"></div>`;
        },

        // Section placeholder with optional text lines
        section(options = {}) {
            const { height = '120px', showLines = true } = options;
            if (!showLines) return this.block({ height });
            return `
                <div class="skeleton-section" style="min-height: ${height};">
                    ${this._pulse('45%', '1.2rem', 'mb-3', true)}
                    ${this._pulse('100%', '0.8rem', 'mb-2', true)}
                    ${this._pulse('90%', '0.8rem', 'mb-2', true)}
                    ${this._pulse('70%', '0.8rem', '', true)}
                </div>
            `;
        },

        // Split layout - two columns
        split(options = {}) {
            const { left = 8, right = 4, height = '300px' } = options;
            return `
                <div class="row">
                    <div class="col-md-${left} mb-3">${this.block({ height })}</div>
                    <div class="col-md-${right} mb-3">${this.block({ height })}</div>
                </div>
            `;
        },

        // Tab content placeholder
        tabContent(options = {}) {
            const { height = '400px' } = options;
            return `
                <div class="skeleton-tab-content p-4">
                    <div class="mb-4">
                        ${this._pulse('30%', '1.5rem', 'mb-2', true)}
                        ${this._pulse('50%', '0.9rem', '', true)}
                    </div>
                    ${this.block({ height: `calc(${height} - 80px)` })}
                </div>
            `;
        },

        // Custom dimensions - uses skeleton-pulse for small, skeleton-block for large
        custom(options = {}) {
            const { width = '100%', height = '2rem', borderRadius } = options;
            let style = `width:${width}; height:${height};`;
            if (borderRadius) style += ` border-radius:${borderRadius};`;
            return `<div class="skeleton-pulse" style="${style}"></div>`;
        },

        // Full dashboard skeleton
        dashboard() {
            return `
                <div class="container-fluid p-4">
                    <div class="d-flex align-items-center mb-4">
                        ${this._pulse('50px', '50px', 'rounded mr-3', true)}
                        <div>
                            ${this._pulse('200px', '1.5rem', 'mb-2', true)}
                            ${this._pulse('300px', '0.8rem', '', true)}
                        </div>
                    </div>
                    ${this.kpiCard({ count: 4 })}
                    <div class="row mt-3">
                        <div class="col-lg-8 mb-3">${this.card({ height: '300px' })}</div>
                        <div class="col-lg-4 mb-3">${this.card({ height: '300px' })}</div>
                    </div>
                    ${this.table({ rows: 8, cols: 5 })}
                </div>
            `;
        }
    };

    // ==========================================
    // ERROR BOUNDARY
    // ==========================================
    const ErrorBoundary = {
        /**
         * Wrap an async function with error handling
         * @param {Function} fn - Async function to wrap
         * @param {HTMLElement|string} container - Element or selector to show error in
         * @param {object} options - Error display options
         */
        async wrap(fn, container, options = {}) {
            const el = typeof container === 'string' ? document.querySelector(container) : container;
            const { showSkeleton = true, skeletonType = 'dashboard' } = options;
            
            // Show skeleton while loading
            if (el && showSkeleton) {
                el.innerHTML = Skeleton.render(skeletonType, options);
            }
            
            try {
                return await fn();
            } catch (error) {
                console.error('[ErrorBoundary] Caught error:', error);
                if (el) {
                    el.innerHTML = this.renderError(error, options);
                }
                throw error; // Re-throw so caller knows it failed
            }
        },

        /**
         * Render error card HTML
         */
        renderError(error, options = {}) {
            const { 
                title = 'Something went wrong',
                showDetails = true,
                showRetry = true,
                retryAction = 'location.reload()'
            } = options;

            const errorMessage = error?.message || 'An unexpected error occurred';
            const isNetworkError = errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('API Error');
            
            const icon = isNetworkError ? 'fa-wifi' : 'fa-exclamation-triangle';
            const subtitle = isNetworkError 
                ? 'Could not connect to the server. Please check your connection.'
                : 'There was a problem loading this content.';

            return `
                <div class="error-boundary-card">
                    <div class="card shadow-sm border-danger">
                        <div class="card-body text-center py-5">
                            <div class="error-icon mb-3">
                                <i class="fas ${icon} fa-3x text-danger"></i>
                            </div>
                            <h5 class="font-weight-bold text-danger mb-2">${title}</h5>
                            <p class="text-muted mb-3">${subtitle}</p>
                            ${showDetails ? `
                                <div class="alert alert-light text-left mb-3 mx-auto" style="max-width: 500px;">
                                    <small class="text-monospace text-muted">${this.escapeHtml(errorMessage)}</small>
                                </div>
                            ` : ''}
                            ${showRetry ? `
                                <button class="btn btn-outline-danger btn-sm" onclick="${retryAction}">
                                    <i class="fas fa-redo mr-2"></i>Try Again
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        },

        /**
         * Render inline error (smaller, for sections)
         */
        renderInlineError(message, options = {}) {
            const { showRetry = false, retryAction = '' } = options;
            return `
                <div class="alert alert-danger d-flex align-items-center" role="alert">
                    <i class="fas fa-exclamation-circle mr-2"></i>
                    <span class="flex-grow-1">${this.escapeHtml(message)}</span>
                    ${showRetry ? `
                        <button class="btn btn-sm btn-outline-danger ml-2" onclick="${retryAction}">
                            <i class="fas fa-redo"></i>
                        </button>
                    ` : ''}
                </div>
            `;
        },

        /**
         * HTML escape helper
         */
        escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
    };

    // ==========================================
    // API WRAPPER
    // ==========================================
    const API = {
        async get(action, params = {}) {
            const url = new URL(window.GANTRY_API_URL, window.location.origin);
            url.searchParams.append('action', action);
            Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
            
            const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
            if (!res.ok) {
                const errText = await res.text();
                console.error("NetSuite Error Details:", errText);
                throw new Error(`API Error ${res.status}: ${errText}`);
            }
            return await res.json();
        },
        async post(action, data) {
            const res = await fetch(window.GANTRY_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, data })
            });
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API Error ${res.status}: ${errText}`);
            }
            return await res.json();
        }
    };

    // ==========================================
    // ROUTER
    // ==========================================
    const Router = {
        routes: {},
        navigate(route) {
            document.querySelectorAll('.gantry-nav-link').forEach(a => {
                a.classList.toggle('active', a.dataset.route === route);
            });
            const container = el('#gantry-view-container');
            if(container) container.innerHTML = '';
            
            if (this.routes[route]) this.routes[route]();
            else if (this.routes['cashflow']) this.routes['cashflow']();
        },
        register(route, handler) {
            this.routes[route] = handler;
        }
    };

    function renderStub(name) {
        const tpl = el('#tpl-stub');
        if (tpl) {
            el('#gantry-view-container').innerHTML = tpl.innerHTML;
            const stubName = el('#stub-name');
            if (stubName) stubName.textContent = name;
        }
    }

    function showToast(msg, type) {
        const t = el("#cf-toast");
        const m = el("#cf-toast-msg");
        if (t && m) {
            m.textContent = msg;
            t.className = "cf-toast";
            if (type === 'error') t.classList.add('toast-error');
            if (type === 'success') t.classList.add('toast-success');
            t.style.display = "block";
            setTimeout(() => (t.style.display = "none"), 3000);
        }
    }

    // ==========================================
    // EXPOSE GLOBALLY
    // ==========================================
    // These need to be global for dashboard controllers to use
    window.el = el;
    window.fmtMoney = fmtMoney;
    window.fmtNum = fmtNum;
    window.fmtPct = fmtPct;
    window.getNsLink = getNsLink;
    window.getTrendHtml = getTrendHtml;
    window.STRATEGY_DEFINITIONS = STRATEGY_DEFINITIONS;
    window.API = API;
    window.Router = Router;
    window.showToast = showToast;
    window.renderStub = renderStub;
    
    // New visual components
    window.Sparkline = Sparkline;
    window.HealthGauge = HealthGauge;
    window.RunwayBar = RunwayBar;
    window.ChartManager = ChartManager;
    window.StatusColors = StatusColors;
    
    // Loading & Error handling
    window.Skeleton = Skeleton;
    window.ErrorBoundary = ErrorBoundary;

    // Resize charts on window resize
    window.addEventListener('resize', () => {
        ChartManager.resizeAll();
    });

})(window);