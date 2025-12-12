/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Dashboard_Registry.js
 * Centralized Dashboard Configuration
 * 
 * Single source of truth for all dashboard definitions.
 * Add new dashboards by adding entries to DASHBOARDS config.
 */
define([], function() {
    'use strict';

    /**
     * DASHBOARD REGISTRY
     * ===================
     * All dashboard configurations in one place.
     * To add a new dashboard:
     * 1. Add entry here with all required fields
     * 2. Create the data library (Lib_[Name]_Data.js)
     * 3. Create the dashboard controller (Dashboard.[Name].js)
     * 4. Create the HTML template in gantry_index.html
     */
    const DASHBOARDS = {
        
        // ═══════════════════════════════════════════════════════════════
        // ADVISOR - AI Chat Interface
        // ═══════════════════════════════════════════════════════════════
        advisor: {
            id: 'advisor',
            name: 'Advisor',
            shortName: 'Advisor',
            description: 'AI-powered financial advisor for natural language queries',
            icon: 'fa-magic',
            color: '#8b5cf6',
            route: 'advisor',
            sortOrder: 0,
            isSpecial: true,  // Not a data dashboard
            showInNav: true,
            
            // No data schema - this is the AI interface
            dataSchema: null
        },

        // ═══════════════════════════════════════════════════════════════
        // CASHFLOW - Cash Position & Projections
        // ═══════════════════════════════════════════════════════════════
        cashflow: {
            id: 'cashflow',
            name: 'Liquidity',
            shortName: 'Liquidity',
            description: 'Cash position, liquidity projections, and weekly cash forecasts (for detailed AR/AP aging by vendor/customer, use aging templates)',
            icon: 'fa-money-bill-wave',
            color: '#10b981',
            route: 'cashflow',
            sortOrder: 1,
            showInNav: true,

            // Contextual suggestions when on this dashboard
            suggestions: [
                'What are our upcoming payments this week?',
                'Show our top 10 customers by outstanding balance',
                'Compare cash position to last month'
            ],

            // Keywords that route questions to this dashboard
            keywords: [
                'treasury', 'cash position', 'cash balance', 'cash on hand',
                'cash flow', 'cashflow', 'cash runway',
                'runway', 'burn rate', 'cash burn',
                'days of cash', 'cash forecast',
                'liquidity', 'working capital'
            ],
            
            // Data library module path
            dataModule: './Lib_Cashflow_Data',
            
            // AI-ready data schema description with extraction paths
            dataSchema: {
                summary: 'Cash flow and liquidity metrics showing current cash, receivables, payables, and runway projections',

                // Extraction configuration for AI intelligence layer
                extraction: {
                    keyMetrics: ['totalCash', 'runwayWeeks', 'burnRate', 'totalAR', 'totalAP', 'netPosition'],
                    alertFields: ['runwayWeeks', 'arOver90'],
                    insightTemplates: [
                        { condition: 'runwayWeeks > 12', template: 'Cash position is strong with {runwayWeeks} weeks runway' },
                        { condition: 'runwayWeeks <= 8', template: 'Cash runway is concerning at only {runwayWeeks} weeks' },
                        { condition: 'arOver90 > 50000', template: 'AR over 90 days ({arOver90}) needs collection attention' }
                    ]
                },

                fields: {
                    // ═══ KEY METRICS (priority 1 - always extracted) ═══
                    totalCash: {
                        type: 'currency',
                        desc: 'Total cash across all bank accounts right now',
                        path: 'company.cash.startingCash',
                        priority: 1,
                        trendPath: 'sparklineData.endingCash'
                    },
                    projectedCash: {
                        type: 'currency',
                        desc: 'Projected cash at end of forecast period',
                        path: 'company.cash.projectedEnd',
                        priority: 1
                    },
                    totalAR: {
                        type: 'currency',
                        desc: 'Total accounts receivable (money owed TO us by customers)',
                        path: 'company.ar.totalOutstanding',
                        priority: 1
                    },
                    totalAP: {
                        type: 'currency',
                        desc: 'Total accounts payable (money WE owe to vendors)',
                        path: 'company.ap.totalOutstanding',
                        priority: 1
                    },
                    netPosition: {
                        type: 'currency',
                        desc: 'Net cash position = totalCash + totalAR - totalAP',
                        computed: 'totalCash + totalAR - totalAP',
                        priority: 1
                    },
                    runwayWeeks: {
                        type: 'number',
                        desc: 'Weeks of cash runway at current burn rate',
                        path: 'runway.weeksRunway',
                        priority: 1,
                        thresholds: { danger: 4, warning: 8, healthy: 12 }
                    },
                    burnRate: {
                        type: 'currency',
                        desc: 'Average weekly cash burn',
                        path: 'runway.avgWeeklyBurn',
                        priority: 1
                    },
                    runwayStatus: {
                        type: 'string',
                        desc: 'Runway status (healthy/warning/critical/sustainable)',
                        path: 'runway.status',
                        priority: 1
                    },

                    // ═══ AR METRICS (priority 2) ═══
                    arPctCurrent: {
                        type: 'percent',
                        desc: 'Percentage of AR that is current (not overdue)',
                        path: 'company.ar.pctCurrent',
                        priority: 2
                    },
                    arAvgDaysToPay: {
                        type: 'number',
                        desc: 'Average days customers take to pay',
                        path: 'company.ar.avgDaysToPay',
                        priority: 2
                    },

                    // ═══ AP METRICS (priority 2) ═══
                    apPctCurrent: {
                        type: 'percent',
                        desc: 'Percentage of AP that is current',
                        path: 'company.ap.pctCurrent',
                        priority: 2
                    },
                    apAvgDaysToPay: {
                        type: 'number',
                        desc: 'Average days to pay vendors',
                        path: 'company.ap.avgDaysToPay',
                        priority: 2
                    },

                    // ═══ CASH FLOW TOTALS (priority 2) ═══
                    totalInflows: {
                        type: 'currency',
                        desc: 'Total projected inflows over forecast period',
                        path: 'company.cash.totalInflows',
                        priority: 2
                    },
                    totalOutflows: {
                        type: 'currency',
                        desc: 'Total projected outflows over forecast period',
                        path: 'company.cash.totalOutflows',
                        priority: 2
                    },
                    netChange: {
                        type: 'currency',
                        desc: 'Net cash change over forecast period',
                        path: 'company.cash.netChange',
                        priority: 2
                    },

                    // ═══ COLLECTIONS (arrays for drill-down) ═══
                    weeklyProjection: {
                        type: 'array',
                        desc: 'Weekly cash flow projections',
                        path: 'company.weeklyCash',
                        labelField: 'weekLabel',
                        valueField: 'endingCash',
                        sortField: 'weekStart',
                        sortDirection: 'asc',
                        itemFields: {
                            weekLabel: { type: 'string', desc: 'Week label' },
                            weekStart: { type: 'date', desc: 'Week start date' },
                            weekEnd: { type: 'date', desc: 'Week end date' },
                            startingCash: { type: 'currency', desc: 'Starting cash for week' },
                            endingCash: { type: 'currency', desc: 'Ending cash for week' },
                            inflows: { type: 'currency', desc: 'Total inflows', path: 'inflows.total' },
                            outflows: { type: 'currency', desc: 'Total outflows', path: 'outflows.total' },
                            netChange: { type: 'currency', desc: 'Net change for week' }
                        }
                    },
                    arBuckets: {
                        type: 'array',
                        desc: 'AR aging buckets (Current, 31-60, 61-90, Over 90)',
                        path: 'company.ar.buckets',
                        labelField: 'label',
                        valueField: 'amount',
                        itemFields: {
                            label: { type: 'string', desc: 'Aging bucket label' },
                            amount: { type: 'currency', desc: 'Amount in bucket' }
                        }
                    },
                    apBuckets: {
                        type: 'array',
                        desc: 'AP aging buckets (Current, 31-60, 61-90, Over 90)',
                        path: 'company.ap.buckets',
                        labelField: 'label',
                        valueField: 'amount',
                        itemFields: {
                            label: { type: 'string', desc: 'Aging bucket label' },
                            amount: { type: 'currency', desc: 'Amount in bucket' }
                        }
                    },
                    criticalWeeks: {
                        type: 'array',
                        desc: 'Weeks where cash goes negative or critical',
                        path: 'runway.criticalWeeks',
                        labelField: 'weekLabel',
                        valueField: 'endingCash',
                        itemFields: {
                            weekLabel: { type: 'string', desc: 'Week label' },
                            endingCash: { type: 'currency', desc: 'Ending cash (negative = problem)' }
                        }
                    }
                }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // HEALTH - Financial Health Overview
        // ═══════════════════════════════════════════════════════════════
        health: {
            id: 'health',
            name: 'P&L',
            shortName: 'P&L',
            description: 'Gross margin, profitability by department, revenue vs expenses',
            icon: 'fa-heartbeat',
            color: '#ef4444',
            route: 'health',
            sortOrder: 2,
            showInNav: true,

            // Contextual suggestions when on this dashboard
            suggestions: [
                'Which department has the highest profit margin?',
                'Compare this quarter revenue to last quarter',
                'What are our largest expense categories?'
            ],

            keywords: [
                'p&l', 'p and l', 'profit and loss', 'pnl',
                'profitability pulse', 'profitability', 'profit pulse',
                'health score', 'financial health', 'company health',
                'overall health', 'business health',
                'financial overview', 'financial summary',
                'how are we doing', 'how is the company',
                'gross margin', 'profit margin'
            ],
            
            dataModule: './Lib_Health_Data',
            
            dataSchema: {
                summary: 'Financial health metrics including gross margin, revenue, expenses, and profitability by department',

                // Extraction configuration for AI intelligence layer
                extraction: {
                    keyMetrics: ['healthScore', 'revenueYTD', 'gmPercent', 'netIncome', 'revenueGrowthYoY'],
                    alertFields: ['healthScore', 'gmPercent'],
                    insightTemplates: [
                        { condition: 'healthScore >= 70', template: 'Financial health is strong at {healthScore}/100' },
                        { condition: 'healthScore < 50', template: 'Financial health needs attention: {healthScore}/100' },
                        { condition: 'gmPercent < 20', template: 'Gross margin is below target at {gmPercent}%' }
                    ]
                },

                fields: {
                    // ═══ KEY METRICS (priority 1) ═══
                    healthScore: {
                        type: 'number',
                        desc: 'Overall health score 0-100 (>70 good, >50 ok, <50 concern)',
                        path: 'company.healthScore',
                        priority: 1,
                        thresholds: { danger: 40, warning: 60, healthy: 75 }
                    },
                    revenueYTD: {
                        type: 'currency',
                        desc: 'Total revenue year-to-date (fiscal year)',
                        path: 'company.metrics.range.revenue',
                        priority: 1
                    },
                    cogsYTD: {
                        type: 'currency',
                        desc: 'Cost of goods sold year-to-date',
                        path: 'company.metrics.range.cogs',
                        priority: 2
                    },
                    opexYTD: {
                        type: 'currency',
                        desc: 'Operating expenses year-to-date',
                        path: 'company.metrics.range.opex',
                        priority: 1
                    },
                    gmAmount: {
                        type: 'currency',
                        desc: 'Gross margin dollar amount = revenue - COGS',
                        path: 'company.metrics.range.gm',
                        priority: 1
                    },
                    gmPercent: {
                        type: 'percent',
                        desc: 'Gross margin percentage',
                        path: 'company.metrics.range.gmPct',
                        priority: 1,
                        thresholds: { danger: 15, warning: 25, healthy: 35 }
                    },
                    netIncome: {
                        type: 'currency',
                        desc: 'Operating income = GM - OpEx',
                        path: 'company.metrics.range.opInc',
                        priority: 1
                    },
                    revenueGrowthYoY: {
                        type: 'percent',
                        desc: 'Revenue growth vs same period last year',
                        path: 'company.yoy.revenueDeltaPct',
                        priority: 1
                    },

                    // ═══ CURRENT MONTH METRICS (priority 2) ═══
                    revenueMTD: {
                        type: 'currency',
                        desc: 'Revenue current month',
                        path: 'company.metrics.currentMonth.revenue',
                        priority: 2
                    },
                    gmPercentMTD: {
                        type: 'percent',
                        desc: 'Gross margin % current month',
                        path: 'company.metrics.currentMonth.gmPct',
                        priority: 2
                    },

                    // ═══ AVERAGES & FORECASTS (priority 2) ═══
                    avgMonthlyRevenue: {
                        type: 'currency',
                        desc: 'Average monthly revenue in range',
                        path: 'company.averages.rangeAvgMonthlyRevenue',
                        priority: 2
                    },
                    avgMonthlyOpex: {
                        type: 'currency',
                        desc: 'Average monthly operating expenses',
                        path: 'company.averages.rangeAvgMonthlyOpEx',
                        priority: 2
                    },
                    runRateRevenue: {
                        type: 'currency',
                        desc: 'Run rate revenue for fiscal year',
                        path: 'company.forecast.runRateRevenueFy',
                        priority: 2
                    },
                    breakevenRevenue: {
                        type: 'currency',
                        desc: 'Monthly revenue needed to break even',
                        path: 'company.breakeven.breakevenMonthlyRevenue',
                        priority: 2
                    },
                    targetGMPct: {
                        type: 'percent',
                        desc: 'Target gross margin percentage',
                        path: 'company.breakeven.targetGMPct',
                        priority: 2
                    },

                    // ═══ FISCAL CONTEXT (priority 2) ═══
                    fiscalPercentComplete: {
                        type: 'percent',
                        desc: 'Percentage of fiscal year complete',
                        path: 'meta.fiscal.percentComplete',
                        priority: 2
                    },

                    // ═══ COLLECTIONS (arrays) ═══
                    departments: {
                        type: 'array',
                        desc: 'Profitability breakdown by department',
                        path: 'departments',
                        labelField: 'department.name',
                        valueField: 'metrics.range.revenue',
                        sortField: 'metrics.range.revenue',
                        sortDirection: 'desc',
                        itemFields: {
                            departmentId: { type: 'number', desc: 'Department ID', path: 'department.netsuiteId' },
                            departmentName: { type: 'string', desc: 'Department name', path: 'department.name' },
                            revenue: { type: 'currency', desc: 'Department revenue', path: 'metrics.range.revenue' },
                            cogs: { type: 'currency', desc: 'Department COGS', path: 'metrics.range.cogs' },
                            opex: { type: 'currency', desc: 'Department OpEx', path: 'metrics.range.opex' },
                            gm: { type: 'currency', desc: 'Gross margin', path: 'metrics.range.gm' },
                            gmPct: { type: 'percent', desc: 'GM %', path: 'metrics.range.gmPct' },
                            healthScore: { type: 'number', desc: 'Department health score' }
                        }
                    },
                    monthlyTrend: {
                        type: 'array',
                        desc: 'Monthly revenue/expense trend',
                        path: 'monthlyTrend',
                        labelField: 'month',
                        valueField: 'revenue',
                        itemFields: {
                            month: { type: 'string', desc: 'Month label' },
                            revenue: { type: 'currency', desc: 'Revenue' },
                            expenses: { type: 'currency', desc: 'Total expenses' },
                            netIncome: { type: 'currency', desc: 'Net income' }
                        }
                    },
                    topMovers: {
                        type: 'array',
                        desc: 'Accounts with largest changes',
                        path: 'topMovers',
                        labelField: 'name',
                        valueField: 'change',
                        sortField: 'change',
                        sortDirection: 'desc',
                        itemFields: {
                            name: { type: 'string', desc: 'Account name' },
                            current: { type: 'currency', desc: 'Current period amount' },
                            prior: { type: 'currency', desc: 'Prior period amount' },
                            change: { type: 'currency', desc: 'Dollar change' },
                            changePct: { type: 'percent', desc: 'Percent change' }
                        }
                    },
                    anomalies: {
                        type: 'array',
                        desc: 'Detected financial anomalies',
                        path: 'anomalies',
                        labelField: 'description',
                        valueField: 'amount',
                        itemFields: {
                            type: { type: 'string', desc: 'Anomaly type' },
                            description: { type: 'string', desc: 'Description' },
                            amount: { type: 'currency', desc: 'Amount involved' },
                            severity: { type: 'string', desc: 'Severity level' }
                        }
                    }
                }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // BURDEN - Overhead Burden Rate Analysis
        // ═══════════════════════════════════════════════════════════════
        burden: {
            id: 'burden',
            name: 'True Cost',
            shortName: 'True Cost',
            description: 'Burden rate analysis, overhead allocation, and cost recovery',
            icon: 'fa-weight-hanging',
            color: '#f59e0b',
            route: 'burden',
            sortOrder: 3,
            showInNav: true,

            // Contextual suggestions when on this dashboard
            suggestions: [
                'Which employees have the lowest utilization?',
                'Show burden rate by department',
                'What projects have the most unbilled time?'
            ],

            keywords: [
                'true cost', 'true costs',
                'rate engine', 'rates', 'billing rates',
                'burden rate', 'overhead rate', 'burden',
                'overhead', 'indirect costs', 'cost recovery',
                'labor burden', 'fringe rate', 'wrap rate',
                'fully burdened', 'cost allocation'
            ],
            
            dataModule: './Lib_Burden_Data',
            
            dataSchema: {
                summary: 'Burden rate and overhead allocation metrics for cost recovery analysis',

                extraction: {
                    keyMetrics: ['currentBurdenRate', 'targetBurdenRate', 'totalOverhead', 'totalDirectLabor', 'overheadRecovery'],
                    alertFields: ['currentBurdenRate'],
                    insightTemplates: [
                        { condition: 'currentBurdenRate > targetBurdenRate', template: 'Burden rate ({currentBurdenRate}%) exceeds target ({targetBurdenRate}%)' }
                    ]
                },

                fields: {
                    currentBurdenRate: {
                        type: 'percent',
                        desc: 'Current burden rate (overhead / direct labor)',
                        path: 'summary.currentBurdenRate',
                        priority: 1,
                        thresholds: { danger: 200, warning: 150, healthy: 100 }
                    },
                    targetBurdenRate: {
                        type: 'percent',
                        desc: 'Target burden rate from configuration',
                        path: 'summary.targetBurdenRate',
                        priority: 1
                    },
                    totalOverhead: {
                        type: 'currency',
                        desc: 'Total overhead costs for period',
                        path: 'summary.totalOverhead',
                        priority: 1
                    },
                    totalDirectLabor: {
                        type: 'currency',
                        desc: 'Total direct labor costs for period',
                        path: 'summary.totalDirectLabor',
                        priority: 1
                    },
                    overheadRecovery: {
                        type: 'percent',
                        desc: 'Overhead recovery percentage',
                        path: 'summary.overheadRecovery',
                        priority: 1
                    },

                    byCategory: {
                        type: 'array',
                        desc: 'Overhead breakdown by category',
                        path: 'categories',
                        labelField: 'category',
                        valueField: 'amount',
                        sortField: 'amount',
                        sortDirection: 'desc',
                        itemFields: {
                            category: { type: 'string', desc: 'Overhead category name' },
                            amount: { type: 'currency', desc: 'Amount for category' },
                            percent: { type: 'percent', desc: 'Percentage of total overhead' }
                        }
                    }
                }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // TIME - Billable Time & Utilization
        // ═══════════════════════════════════════════════════════════════
        time: {
            id: 'time',
            name: 'Billable IQ',
            shortName: 'Billable IQ',
            description: 'Employee utilization, billable hours tracking, and revenue recognition',
            icon: 'fa-clock',
            color: '#3b82f6',
            route: 'time',
            sortOrder: 4,
            showInNav: true,

            // Contextual suggestions when on this dashboard
            suggestions: [
                'Show billable hours by employee this month',
                'Which projects have the most hours logged?',
                'Compare utilization this month vs last month'
            ],

            keywords: [
                'billable iq', 'billable intelligence',
                'utilization', 'utilization rate', 'employee utilization',
                'time', 'billable time', 'billable hours',
                'time tracking', 'timesheet',
                'unbilled time', 'hours worked', 'employee hours',
                'billing rate', 'effective rate'
            ],
            
            dataModule: './Lib_Time_Data',
            
            dataSchema: {
                summary: 'Billable time and utilization metrics for labor tracking and revenue recognition',

                extraction: {
                    keyMetrics: ['totalBillableHours', 'totalNonBillableHours', 'utilizationRate', 'unbilledAmount', 'effectiveRate'],
                    alertFields: ['utilizationRate', 'unbilledAmount'],
                    insightTemplates: [
                        { condition: 'utilizationRate >= 75', template: 'Utilization is healthy at {utilizationRate}%' },
                        { condition: 'utilizationRate < 60', template: 'Utilization is low at {utilizationRate}%' },
                        { condition: 'unbilledAmount > 50000', template: 'Significant unbilled time: {unbilledAmount}' }
                    ]
                },

                fields: {
                    totalBillableHours: {
                        type: 'number',
                        desc: 'Total billable hours in period',
                        path: 'summary.totalBillableHours',
                        priority: 1
                    },
                    totalNonBillableHours: {
                        type: 'number',
                        desc: 'Total non-billable hours',
                        path: 'summary.totalNonBillableHours',
                        priority: 1
                    },
                    utilizationRate: {
                        type: 'percent',
                        desc: 'Billable / total hours worked',
                        path: 'summary.utilizationRate',
                        priority: 1,
                        thresholds: { danger: 50, warning: 65, healthy: 75 }
                    },
                    unbilledAmount: {
                        type: 'currency',
                        desc: 'Value of unbilled time entries',
                        path: 'summary.unbilledAmount',
                        priority: 1,
                        thresholds: { warning: 50000, danger: 100000 }
                    },
                    averageBillRate: {
                        type: 'currency',
                        desc: 'Average billing rate per hour',
                        path: 'summary.averageBillRate',
                        priority: 2
                    },
                    effectiveRate: {
                        type: 'currency',
                        desc: 'Effective rate (actual collected / hours)',
                        path: 'summary.effectiveRate',
                        priority: 1
                    },

                    byEmployee: {
                        type: 'array',
                        desc: 'Hours by employee',
                        path: 'byEmployee',
                        labelField: 'employee',
                        valueField: 'billable',
                        sortField: 'billable',
                        sortDirection: 'desc',
                        itemFields: {
                            employeeId: { type: 'number', desc: 'Employee ID' },
                            employee: { type: 'string', desc: 'Employee name' },
                            billable: { type: 'number', desc: 'Billable hours' },
                            nonBillable: { type: 'number', desc: 'Non-billable hours' },
                            utilization: { type: 'percent', desc: 'Utilization rate' }
                        }
                    },

                    byCustomer: {
                        type: 'array',
                        desc: 'Hours by customer',
                        path: 'byCustomer',
                        labelField: 'customer',
                        valueField: 'hours',
                        sortField: 'hours',
                        sortDirection: 'desc',
                        itemFields: {
                            customerId: { type: 'number', desc: 'Customer ID' },
                            customer: { type: 'string', desc: 'Customer name' },
                            hours: { type: 'number', desc: 'Hours logged' },
                            amount: { type: 'currency', desc: 'Billable amount' }
                        }
                    }
                }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // INTEGRITY - Transaction Integrity / Forensic Analysis
        // ═══════════════════════════════════════════════════════════════
        integrity: {
            id: 'integrity',
            name: 'Sentinel',
            shortName: 'Sentinel',
            description: 'Forensic transaction analysis: Benford\'s Law, duplicates, weekend entries, and anomaly detection',
            icon: 'fa-shield-alt',
            color: '#6366f1',
            route: 'integrity',
            sortOrder: 5,
            showInNav: true,

            // Contextual suggestions when on this dashboard
            suggestions: [
                'Show all flagged transactions this month',
                'Are there any potential duplicate bills?',
                'Which transactions deviate from Benford\'s Law?'
            ],

            keywords: [
                'sentinel', 'transaction integrity', 'integrity',
                'fraud', 'anomaly', 'anomalies',
                'benford', 'duplicate', 'duplicates',
                'weekend entries', 'forensic', 'audit',
                'suspicious', 'flagged transactions'
            ],
            
            dataModule: './Lib_Integrity_Data',
            
            dataSchema: {
                summary: 'Transaction integrity analysis including Benford\'s Law, duplicate detection, and anomaly flagging',

                extraction: {
                    keyMetrics: ['riskScore', 'flaggedCount', 'duplicateCount', 'weekendCount', 'benfordDeviation'],
                    alertFields: ['riskScore', 'flaggedCount'],
                    insightTemplates: [
                        { condition: 'riskScore < 30', template: 'Transaction integrity is excellent (risk score: {riskScore})' },
                        { condition: 'riskScore > 70', template: 'High risk detected - {flaggedCount} flagged transactions need review' },
                        { condition: 'duplicateCount > 0', template: '{duplicateCount} potential duplicate transactions detected' }
                    ]
                },

                fields: {
                    riskScore: {
                        type: 'number',
                        desc: 'Overall risk score 0-100',
                        path: 'summary.riskScore',
                        priority: 1,
                        thresholds: { healthy: 30, warning: 50, danger: 70 }
                    },
                    flaggedCount: {
                        type: 'number',
                        desc: 'Number of flagged transactions',
                        path: 'summary.flaggedCount',
                        priority: 1
                    },
                    duplicateCount: {
                        type: 'number',
                        desc: 'Potential duplicate transactions',
                        path: 'summary.duplicateCount',
                        priority: 1
                    },
                    weekendCount: {
                        type: 'number',
                        desc: 'Transactions entered on weekends',
                        path: 'summary.weekendCount',
                        priority: 2
                    },
                    benfordDeviation: {
                        type: 'percent',
                        desc: 'Deviation from Benford\'s Law expected distribution',
                        path: 'summary.benfordDeviation',
                        priority: 1
                    },

                    flaggedTransactions: {
                        type: 'array',
                        desc: 'List of flagged transactions',
                        path: 'flaggedTransactions',
                        labelField: 'tranId',
                        valueField: 'amount',
                        sortField: 'amount',
                        sortDirection: 'desc',
                        itemFields: {
                            tranId: { type: 'string', desc: 'Transaction ID' },
                            type: { type: 'string', desc: 'Transaction type' },
                            amount: { type: 'currency', desc: 'Transaction amount' },
                            flagType: { type: 'string', desc: 'Why flagged (duplicate, benford, weekend, etc)' },
                            riskLevel: { type: 'string', desc: 'Risk level (high, medium, low)' }
                        }
                    }
                }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // VENDOR PERFORMANCE - Procurement Intelligence
        // ═══════════════════════════════════════════════════════════════
        vendorperformance: {
            id: 'vendorperformance',
            name: 'Procurement',
            shortName: 'Procurement',
            description: 'Procurement intelligence: vendor leverage matrix, term compliance, contract renewals, and spend concentration',
            icon: 'fa-handshake',
            color: '#10b981',
            route: 'vendorperformance',
            sortOrder: 6,
            showInNav: true,

            // Contextual suggestions when on this dashboard
            suggestions: [
                'Which contracts are up for renewal this quarter?',
                'Show vendors where we\'re paying early and losing cash flow',
                'Who are our strategic vs commodity vendors?'
            ],

            keywords: [
                'procurement', 'procurement score', 'vendor scorecard',
                'vendor performance', 'vendor analysis',
                'vendor spend', 'supplier', 'suppliers',
                'payment terms', 'dpo', 'days payable',
                'contract renewal', 'auto renew', 'vendor leverage',
                'strategic vendors', 'vendor concentration',
                'cash flow leakage', 'early payment',
                'maverick spend', 'otif', 'ppv', 'price variance'
            ],
            
            dataModule: './Lib_VendorPerformance_Data',
            
            dataSchema: {
                summary: 'Vendor performance and procurement intelligence including leverage matrix, term compliance, and renewal tracking',

                extraction: {
                    keyMetrics: ['performanceScore', 'totalVendors', 'totalSpend', 'cashFlowLeakage', 'earlyPaymentRate', 'upcomingRenewals'],
                    alertFields: ['cashFlowLeakage', 'autoRenewRisks', 'earlyPaymentRate'],
                    insightTemplates: [
                        { condition: 'cashFlowLeakage > 10000', template: 'Cash flow leakage from early payments: {cashFlowLeakage}' },
                        { condition: 'autoRenewRisks > 0', template: '{autoRenewRisks} high-value contracts have auto-renew risk' },
                        { condition: 'earlyPaymentRate > 30', template: '{earlyPaymentRate}% of bills paid early - optimize payment timing' }
                    ]
                },

                fields: {
                    // ═══ KEY METRICS (priority 1) ═══
                    performanceScore: {
                        type: 'number',
                        desc: 'Overall vendor management score 0-100',
                        path: 'summary.performanceScore',
                        priority: 1,
                        thresholds: { danger: 40, warning: 60, healthy: 75 }
                    },
                    totalVendors: {
                        type: 'number',
                        desc: 'Number of active vendors in period',
                        path: 'summary.totalVendors',
                        priority: 1
                    },
                    totalSpend: {
                        type: 'currency',
                        desc: 'Total spend across all vendors',
                        path: 'summary.totalSpend',
                        priority: 1
                    },
                    cashFlowLeakage: {
                        type: 'currency',
                        desc: 'Estimated cash flow loss from early payments',
                        path: 'summary.cashFlowLeakage',
                        priority: 1,
                        thresholds: { warning: 10000, danger: 50000 }
                    },

                    // ═══ LEVERAGE MATRIX (priority 2) ═══
                    strategicPartners: {
                        type: 'number',
                        desc: 'Count of strategic partner vendors',
                        path: 'leverageMatrix.strategic',
                        priority: 2
                    },
                    commodityVendors: {
                        type: 'number',
                        desc: 'Count of commodity vendors',
                        path: 'leverageMatrix.commodity',
                        priority: 2
                    },
                    nicheVendors: {
                        type: 'number',
                        desc: 'Count of niche specialist vendors',
                        path: 'leverageMatrix.niche',
                        priority: 2
                    },
                    transactionalVendors: {
                        type: 'number',
                        desc: 'Count of transactional vendors',
                        path: 'leverageMatrix.transactional',
                        priority: 2
                    },

                    // ═══ TERM COMPLIANCE (priority 1) ═══
                    earlyPaymentRate: {
                        type: 'percent',
                        desc: 'Percentage of bills paid early',
                        path: 'termCompliance.earlyPaymentRate',
                        priority: 1
                    },
                    onTimePaymentRate: {
                        type: 'percent',
                        desc: 'Percentage of bills paid on time',
                        path: 'termCompliance.onTimePaymentRate',
                        priority: 2
                    },
                    latePaymentRate: {
                        type: 'percent',
                        desc: 'Percentage of bills paid late',
                        path: 'termCompliance.latePaymentRate',
                        priority: 2
                    },
                    avgDaysFromTerms: {
                        type: 'number',
                        desc: 'Average days from payment terms (negative = early)',
                        path: 'termCompliance.avgDaysFromTerms',
                        priority: 2
                    },

                    // ═══ RENEWAL RADAR (priority 1) ═══
                    upcomingRenewals: {
                        type: 'number',
                        desc: 'Contracts renewing in next 90 days',
                        path: 'renewalRadar.upcomingCount',
                        priority: 1
                    },
                    autoRenewRisks: {
                        type: 'number',
                        desc: 'High-value contracts with auto-renew enabled',
                        path: 'renewalRadar.autoRenewRisks',
                        priority: 1
                    },
                    totalAtRiskValue: {
                        type: 'currency',
                        desc: 'Total annual value of at-risk renewals',
                        path: 'renewalRadar.totalAtRiskValue',
                        priority: 1
                    },

                    // ═══ CONCENTRATION (priority 2) ═══
                    herfindahlIndex: {
                        type: 'number',
                        desc: 'HHI concentration index (>2500 = high)',
                        path: 'concentration.herfindahlIndex',
                        priority: 2
                    },
                    topVendorShare: {
                        type: 'percent',
                        desc: 'Spend share of largest vendor',
                        path: 'concentration.topVendorShare',
                        priority: 2
                    },
                    top5Share: {
                        type: 'percent',
                        desc: 'Combined spend share of top 5 vendors',
                        path: 'concentration.top5Share',
                        priority: 2
                    },

                    // ═══ COLLECTIONS ═══
                    vendors: {
                        type: 'array',
                        desc: 'List of vendors with performance metrics',
                        path: 'vendors',
                        labelField: 'vendorName',
                        valueField: 'totalSpend',
                        sortField: 'totalSpend',
                        sortDirection: 'desc',
                        itemFields: {
                            vendorId: { type: 'number', desc: 'Vendor internal ID' },
                            vendorName: { type: 'string', desc: 'Vendor company name' },
                            totalSpend: { type: 'currency', desc: 'Total spend with vendor' },
                            spendShare: { type: 'percent', desc: 'Percentage of total spend' },
                            quadrant: { type: 'string', desc: 'Leverage matrix quadrant' },
                            valueScore: { type: 'number', desc: 'Value score 0-100' },
                            paymentTerms: { type: 'string', desc: 'Payment terms' },
                            avgDaysFromTerms: { type: 'number', desc: 'Average days from terms' }
                        }
                    },

                    renewals: {
                        type: 'array',
                        desc: 'Upcoming contract renewals',
                        path: 'renewals',
                        labelField: 'vendorName',
                        valueField: 'annualValue',
                        sortField: 'daysUntilRenewal',
                        sortDirection: 'asc',
                        itemFields: {
                            vendorName: { type: 'string', desc: 'Vendor name' },
                            endDate: { type: 'date', desc: 'Contract end date' },
                            daysUntilRenewal: { type: 'number', desc: 'Days until renewal' },
                            annualValue: { type: 'currency', desc: 'Annual contract value' },
                            autoRenew: { type: 'boolean', desc: 'Whether contract auto-renews' },
                            riskLevel: { type: 'string', desc: 'Risk level' }
                        }
                    }
                }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // CUSTOMER VALUE - Customer Intelligence
        // ═══════════════════════════════════════════════════════════════
        customervalue: {
            id: 'customervalue',
            name: 'Revenue Intelligence',
            shortName: 'Revenue',
            description: 'Customer lifetime value, RFM segmentation, churn risk analysis, and revenue concentration',
            icon: 'fa-users',
            color: '#8b5cf6',
            route: 'customervalue',
            sortOrder: 7,
            showInNav: true,

            // Contextual suggestions when on this dashboard
            suggestions: [
                'Which customers are at risk of churning?',
                'Show our highest lifetime value customers',
                'How concentrated is our revenue in top customers?'
            ],

            keywords: [
                'revenue intelligence', 'customer intelligence', 'customer analytics',
                'customer value', 'clv', 'ltv', 'lifetime value',
                'rfm', 'recency frequency monetary', 'segmentation',
                'churn', 'retention', 'customer health',
                'customer profitability',
                'concentration risk', 'revenue risk', 'growth trends'
            ],
            
            dataModule: './Lib_CustomerValue_Data',
            
            dataSchema: {
                summary: 'Customer value intelligence including lifetime value, RFM segmentation, churn risk, and profitability analysis',

                extraction: {
                    keyMetrics: ['intelligenceScore', 'totalCustomers', 'totalRevenue', 'projectedCLV', 'atRiskCount', 'atRiskRevenue'],
                    alertFields: ['atRiskCount', 'atRiskRevenue'],
                    insightTemplates: [
                        { condition: 'atRiskCount > 5', template: '{atRiskCount} customers at risk of churning' },
                        { condition: 'atRiskRevenue > 100000', template: '{atRiskRevenue} revenue at risk from churn' },
                        { condition: 'championsCount > 0', template: '{championsCount} champion customers driving growth' }
                    ]
                },

                fields: {
                    // ═══ KEY METRICS (priority 1) ═══
                    intelligenceScore: {
                        type: 'number',
                        desc: 'Overall customer intelligence score 0-100',
                        path: 'summary.intelligenceScore',
                        priority: 1,
                        thresholds: { danger: 40, warning: 60, healthy: 75 }
                    },
                    totalCustomers: {
                        type: 'number',
                        desc: 'Number of active customers in period',
                        path: 'summary.totalCustomers',
                        priority: 1
                    },
                    totalRevenue: {
                        type: 'currency',
                        desc: 'Total revenue across all customers',
                        path: 'summary.totalRevenue',
                        priority: 1
                    },
                    projectedCLV: {
                        type: 'currency',
                        desc: 'Total projected customer lifetime value',
                        path: 'summary.projectedCLV',
                        priority: 1
                    },

                    // ═══ RFM SEGMENTATION (priority 1) ═══
                    championsCount: {
                        type: 'number',
                        desc: 'Number of champion customers',
                        path: 'segments.champions',
                        priority: 1
                    },
                    atRiskCount: {
                        type: 'number',
                        desc: 'Number of at-risk customers',
                        path: 'segments.atRisk',
                        priority: 1
                    },
                    atRiskRevenue: {
                        type: 'currency',
                        desc: 'Revenue at risk from churn',
                        path: 'summary.atRiskRevenue',
                        priority: 1,
                        thresholds: { warning: 50000, danger: 100000 }
                    },

                    // ═══ RETENTION (priority 2) ═══
                    retentionRate: {
                        type: 'percent',
                        desc: 'Average retention probability',
                        path: 'summary.retentionRate',
                        priority: 2
                    },
                    avgCustomerValue: {
                        type: 'currency',
                        desc: 'Average customer value',
                        path: 'summary.avgCustomerValue',
                        priority: 2
                    },

                    // ═══ GROWTH (priority 2) ═══
                    monthlyGrowth: {
                        type: 'percent',
                        desc: 'Average monthly growth rate',
                        path: 'summary.monthlyGrowth',
                        priority: 2
                    },
                    newCustomers: {
                        type: 'number',
                        desc: 'New customers in period',
                        path: 'summary.newCustomers',
                        priority: 2
                    },

                    // ═══ COLLECTIONS ═══
                    customerHealth: {
                        type: 'array',
                        desc: 'List of customers with health scores',
                        path: 'customers',
                        labelField: 'customerName',
                        valueField: 'totalRevenue',
                        sortField: 'totalRevenue',
                        sortDirection: 'desc',
                        itemFields: {
                            customerId: { type: 'number', desc: 'Customer internal ID' },
                            customerName: { type: 'string', desc: 'Customer company name' },
                            healthScore: { type: 'number', desc: 'Health score 0-100' },
                            healthGrade: { type: 'string', desc: 'Letter grade A+ to F' },
                            totalRevenue: { type: 'currency', desc: 'Total revenue from customer' },
                            projectedCLV: { type: 'currency', desc: 'Projected lifetime value' },
                            rfmSegment: { type: 'string', desc: 'RFM segment' },
                            churnRisk: { type: 'string', desc: 'Churn risk level' },
                            recommendation: { type: 'string', desc: 'Recommended action' }
                        }
                    }
                }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // SPEND VELOCITY - Physics for Finance
        // ═══════════════════════════════════════════════════════════════
        spendvelocity: {
            id: 'spendvelocity',
            name: 'Spend Velocity',
            shortName: 'Spend Velocity',
            description: 'Physics for Finance: Velocity-based spend analysis, subscription creep detection, Shadow IT radar, and commitment cliff analysis',
            icon: 'fa-tachometer-alt',
            color: '#6366f1',
            route: 'spendvelocity',
            sortOrder: 8,
            showInNav: true,

            // Contextual suggestions when on this dashboard
            suggestions: [
                'Which vendors have accelerating spend?',
                'Show subscription creep patterns (boiling frog)',
                'What shadow IT tools are spreading across teams?'
            ],

            keywords: [
                'cost dynamics', 'expense dynamics', 'cost trajectory',
                'spend velocity', 'velocity', 'acceleration',
                'subscription creep', 'boiling frog', 'price increases',
                'shadow it', 'viral adoption', 'software spread',
                'commitment cliff', 'po velocity', 'so velocity',
                'spend anomaly', 'spending trends', 'vendor velocity',
                'category velocity', 'expense velocity', 'cost growth'
            ],
            
            dataModule: './Lib_SpendVelocity_Data',
            
            dataSchema: {
                summary: 'Spend velocity intelligence treating expenses as physics - velocity (growth speed), acceleration (is growth speeding up), and anomaly detection',

                extraction: {
                    keyMetrics: ['healthScore', 'totalSpend', 'avgVelocity', 'acceleratingCount', 'boilingFrogCount', 'shadowITViralCount'],
                    alertFields: ['acceleratingCount', 'boilingFrogCount', 'shadowITViralCount', 'commitmentStatus'],
                    insightTemplates: [
                        { condition: 'acceleratingCount > 3', template: '{acceleratingCount} vendors have accelerating spend' },
                        { condition: 'boilingFrogCount > 0', template: 'Subscription creep detected: {boilingFrogCount} vendors with silent price increases' },
                        { condition: 'shadowITViralCount > 0', template: '{shadowITViralCount} shadow IT tools spreading virally' }
                    ]
                },

                fields: {
                    // ═══ KEY METRICS (priority 1) ═══
                    healthScore: {
                        type: 'number',
                        desc: 'Overall spend health score 0-100',
                        path: 'summary.healthScore',
                        priority: 1,
                        thresholds: { danger: 40, warning: 60, healthy: 75 }
                    },
                    healthGrade: {
                        type: 'string',
                        desc: 'Letter grade A-F based on health score',
                        path: 'summary.healthGrade',
                        priority: 1
                    },
                    totalSpend: {
                        type: 'currency',
                        desc: 'Total spend in analysis period',
                        path: 'summary.totalSpend',
                        priority: 1
                    },
                    vendorCount: {
                        type: 'number',
                        desc: 'Number of vendors analyzed',
                        path: 'summary.vendorCount',
                        priority: 2
                    },
                    avgVelocity: {
                        type: 'percent',
                        desc: 'Average monthly spend velocity',
                        path: 'summary.avgVelocity',
                        priority: 1
                    },
                    avgAcceleration: {
                        type: 'percent',
                        desc: 'Average acceleration (change in velocity)',
                        path: 'summary.avgAcceleration',
                        priority: 2
                    },
                    acceleratingCount: {
                        type: 'number',
                        desc: 'Vendors with accelerating spend',
                        path: 'summary.acceleratingCount',
                        priority: 1
                    },
                    alertCount: {
                        type: 'number',
                        desc: 'Total active alerts',
                        path: 'summary.alertCount',
                        priority: 1
                    },

                    // ═══ BOILING FROG (priority 1) ═══
                    boilingFrogCount: {
                        type: 'number',
                        desc: 'Vendors with subscription creep pattern',
                        path: 'boilingFrog.count',
                        priority: 1
                    },
                    boilingFrogAnnualImpact: {
                        type: 'currency',
                        desc: 'Annual cost of subscription creep',
                        path: 'boilingFrog.annualImpact',
                        priority: 1
                    },

                    // ═══ SHADOW IT (priority 1) ═══
                    shadowITViralCount: {
                        type: 'number',
                        desc: 'Software tools spreading virally',
                        path: 'shadowIT.viralCount',
                        priority: 1
                    },
                    shadowITEmployees: {
                        type: 'number',
                        desc: 'Employee touchpoints with shadow IT',
                        path: 'shadowIT.employees',
                        priority: 2
                    },
                    shadowITPotentialSavings: {
                        type: 'currency',
                        desc: 'Potential savings from enterprise licensing',
                        path: 'shadowIT.potentialSavings',
                        priority: 2
                    },

                    // ═══ COMMITMENT CLIFF (priority 2) ═══
                    poVelocity: {
                        type: 'percent',
                        desc: 'Purchase order velocity',
                        path: 'commitmentCliff.poVelocity',
                        priority: 2
                    },
                    soVelocity: {
                        type: 'percent',
                        desc: 'Sales order velocity',
                        path: 'commitmentCliff.soVelocity',
                        priority: 2
                    },
                    velocityGap: {
                        type: 'percent',
                        desc: 'Gap between PO and SO velocity',
                        path: 'commitmentCliff.velocityGap',
                        priority: 2
                    },
                    commitmentStatus: {
                        type: 'string',
                        desc: 'Commitment cliff status',
                        path: 'commitmentCliff.status',
                        priority: 1
                    },

                    // ═══ COLLECTIONS ═══
                    vendorVelocity: {
                        type: 'array',
                        desc: 'Velocity analysis by vendor',
                        path: 'vendors',
                        labelField: 'vendorName',
                        valueField: 'totalSpend',
                        sortField: 'velocity',
                        sortDirection: 'desc',
                        itemFields: {
                            vendorId: { type: 'number', desc: 'Vendor internal ID' },
                            vendorName: { type: 'string', desc: 'Vendor name' },
                            totalSpend: { type: 'currency', desc: 'Total spend with vendor' },
                            velocity: { type: 'percent', desc: 'Monthly spend velocity' },
                            acceleration: { type: 'percent', desc: 'Acceleration' },
                            trend: { type: 'string', desc: 'Trend classification' }
                        }
                    },

                    anomalies: {
                        type: 'array',
                        desc: 'Detected spending anomalies',
                        path: 'anomalies',
                        labelField: 'vendorName',
                        valueField: 'amount',
                        sortField: 'amount',
                        sortDirection: 'desc',
                        itemFields: {
                            vendorName: { type: 'string', desc: 'Vendor name' },
                            month: { type: 'string', desc: 'Month of anomaly' },
                            amount: { type: 'currency', desc: 'Anomalous amount' },
                            deviation: { type: 'percent', desc: 'Deviation from expected' },
                            type: { type: 'string', desc: 'Anomaly type' },
                            severity: { type: 'string', desc: 'Severity level' }
                        }
                    }
                }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // SETTINGS - Configuration
        // ═══════════════════════════════════════════════════════════════
        settings: {
            id: 'settings',
            name: 'Settings',
            shortName: 'Settings',
            description: 'Dashboard configuration, thresholds, and AI settings',
            icon: 'fa-cog',
            color: '#64748b',
            route: 'settings',
            sortOrder: 99,
            isSpecial: true,
            showInNav: true,
            isSeparated: true,  // Visual separator before this item
            
            dataSchema: null
        }
    };

    /**
     * ADVISOR QUERIES - Suggested queries by category
     */
    const ADVISOR_QUERIES = {
        categories: [
            {
                id: 'cash',
                name: 'Cash & Liquidity',
                icon: 'fa-coins',
                color: '#10b981',
                queries: [
                    { text: 'Cash position', question: "What's our current cash position?" },
                    { text: 'Cash runway', question: 'How many days of runway do we have?' },
                    { text: 'Bank balances', question: 'Show me all bank account balances' },
                    { text: 'Cash forecast', question: 'What does our cash forecast look like?' },
                    { text: 'Burn rate', question: "What's our monthly burn rate?" },
                    { text: 'Working capital', question: 'Calculate our working capital' }
                ]
            },
            {
                id: 'revenue',
                name: 'Revenue & Sales',
                icon: 'fa-chart-line',
                color: '#3b82f6',
                queries: [
                    { text: 'Revenue YTD', question: "What's our revenue year to date?" },
                    { text: 'Revenue trend', question: 'Show revenue trend by month' },
                    { text: 'Top customers', question: 'Who are our top customers by revenue?' },
                    { text: 'Revenue growth', question: 'How has revenue grown vs last year?' },
                    { text: 'Sales pipeline', question: "What's in the sales pipeline?" },
                    { text: 'Average deal', question: "What's our average deal size?" }
                ]
            },
            {
                id: 'expenses',
                name: 'Expenses & AP',
                icon: 'fa-receipt',
                color: '#ef4444',
                queries: [
                    { text: 'Top vendors', question: 'Who are our top vendors by spend?' },
                    { text: 'Expense breakdown', question: 'Break down expenses by category YTD' },
                    { text: 'Overdue bills', question: 'What bills are past due?' },
                    { text: 'Monthly expenses', question: 'How much did we spend last month?' },
                    { text: 'Vendor payments', question: 'What payments did we make this week?' },
                    { text: 'Recurring costs', question: 'What are our largest recurring expenses?' }
                ]
            },
            {
                id: 'profitability',
                name: 'Margins & Profit',
                icon: 'fa-balance-scale',
                color: '#8b5cf6',
                queries: [
                    { text: 'Gross margin', question: "What's our gross margin by department?" },
                    { text: 'Profit YTD', question: 'What is our net profit year to date?' },
                    { text: 'Margin trend', question: 'How has our margin changed over time?' },
                    { text: 'Best products', question: 'Which products have the highest margin?' },
                    { text: 'Department P&L', question: 'Show P&L by department' },
                    { text: 'Cost analysis', question: 'Where are our biggest cost increases?' }
                ]
            },
            {
                id: 'labor',
                name: 'Labor & Time',
                icon: 'fa-user-clock',
                color: '#f59e0b',
                queries: [
                    { text: 'Burden rate', question: "What's our current burden rate?" },
                    { text: 'Utilization', question: 'Show utilization by department' },
                    { text: 'Unbilled time', question: 'How much unbilled time do we have?' },
                    { text: 'Hours by employee', question: 'Show billable hours by employee this month' },
                    { text: 'Overtime', question: 'Who has worked overtime this week?' },
                    { text: 'Time by customer', question: 'Show hours logged by customer' }
                ]
            },
            {
                id: 'customers',
                name: 'Customers & AR',
                icon: 'fa-users',
                color: '#06b6d4',
                queries: [
                    { text: 'AR aging', question: 'Show me our AR aging' },
                    { text: 'Past due', question: 'Which customers have past due invoices?' },
                    { text: 'Customer balance', question: 'What is the balance for [customer name]?' },
                    { text: 'Payment history', question: 'Show recent customer payments' },
                    { text: 'Credit risk', question: 'Which customers are at credit risk?' },
                    { text: 'Customer YTD', question: 'Show YTD revenue by customer' }
                ]
            },
            {
                id: 'vendors',
                name: 'Vendor Performance',
                icon: 'fa-handshake',
                color: '#10b981',
                queries: [
                    { text: 'Vendor leverage', question: 'Show me our vendor leverage matrix' },
                    { text: 'Payment compliance', question: 'Are we paying vendors on time or too early?' },
                    { text: 'Cash leakage', question: 'How much cash flow are we losing to early payments?' },
                    { text: 'Contract renewals', question: 'What contracts are coming up for renewal?' },
                    { text: 'Auto-renew risks', question: 'Which high-value contracts have auto-renew?' },
                    { text: 'Vendor concentration', question: 'How concentrated is our vendor spend?' }
                ]
            },
            {
                id: 'velocity',
                name: 'Spend Velocity',
                icon: 'fa-tachometer-alt',
                color: '#6366f1',
                queries: [
                    { text: 'Spend velocity', question: 'Which vendors have the highest spend velocity?' },
                    { text: 'Subscription creep', question: 'Are any vendors silently increasing prices?' },
                    { text: 'Shadow IT', question: 'What software is spreading virally through expense reports?' },
                    { text: 'Commitment cliff', question: 'Are we committing to purchases faster than closing sales?' },
                    { text: 'Spend anomalies', question: 'Show me any unusual spending patterns' },
                    { text: 'Accelerating spend', question: 'Which vendors are accelerating their spend growth?' }
                ]
            }
        ]
    };

    /**
     * Get all dashboards as array (sorted)
     */
    function getAllDashboards() {
        return Object.values(DASHBOARDS).sort((a, b) => a.sortOrder - b.sortOrder);
    }

    /**
     * Get navigation items for sidebar
     */
    function getNavItems() {
        return getAllDashboards()
            .filter(d => d.showInNav)
            .map(d => ({
                id: d.id,
                name: d.name,
                icon: d.icon,
                route: d.route,
                color: d.color,
                isSeparated: d.isSeparated || false
            }));
    }

    /**
     * Get dashboard by ID
     */
    function getDashboard(id) {
        return DASHBOARDS[id] || null;
    }

    /**
     * Get dashboard by route
     */
    function getDashboardByRoute(route) {
        return Object.values(DASHBOARDS).find(d => d.route === route) || null;
    }

    /**
     * Get data dashboards (excludes advisor, settings)
     */
    function getDataDashboards() {
        return getAllDashboards().filter(d => !d.isSpecial && d.dataSchema);
    }

    /**
     * Find dashboard by keyword match
     */
    function findDashboardByKeyword(message) {
        const lower = message.toLowerCase();
        
        for (const dashboard of getDataDashboards()) {
            if (dashboard.keywords && dashboard.keywords.some(k => lower.includes(k))) {
                return dashboard;
            }
        }
        return null;
    }

    /**
     * Get AI-ready schema description for a dashboard
     */
    function getSchemaDescription(dashboardId) {
        const dashboard = getDashboard(dashboardId);
        if (!dashboard || !dashboard.dataSchema) return '';
        
        const schema = dashboard.dataSchema;
        let desc = `DATA SCHEMA FOR ${dashboard.name.toUpperCase()}:\n`;
        desc += schema.summary + '\n\nFIELDS:\n';
        
        for (const [key, field] of Object.entries(schema.fields)) {
            if (field.type === 'array') {
                desc += `• ${key} (array): ${field.desc}\n`;
                if (field.itemFields) {
                    for (const [subKey, subField] of Object.entries(field.itemFields)) {
                        desc += `  - ${subKey} (${subField.type}): ${subField.desc}\n`;
                    }
                }
            } else {
                desc += `• ${key} (${field.type}): ${field.desc}\n`;
            }
        }
        
        return desc;
    }

    /**
     * Get compact schema hints for AI context
     */
    function getCompactSchemaHints(dashboardId) {
        const dashboard = getDashboard(dashboardId);
        if (!dashboard || !dashboard.dataSchema) return '';
        
        const hints = [];
        for (const [key, field] of Object.entries(dashboard.dataSchema.fields)) {
            if (field.type !== 'array') {
                hints.push(`${key}:${field.type}`);
            }
        }
        return hints.join(', ');
    }

    /**
     * Get advisor queries configuration
     */
    function getAdvisorQueries() {
        return ADVISOR_QUERIES;
    }

    /**
     * Get contextual suggestions for a dashboard
     * @param {string} dashboardId - Dashboard ID (e.g., 'cashflow', 'health')
     * @returns {string[]} Array of suggestion strings, or empty array if none
     */
    function getDashboardSuggestions(dashboardId) {
        if (!dashboardId) return [];
        const dashboard = DASHBOARDS[dashboardId];
        return dashboard?.suggestions || [];
    }

    // Public API
    return {
        DASHBOARDS: DASHBOARDS,
        ADVISOR_QUERIES: ADVISOR_QUERIES,

        getAllDashboards: getAllDashboards,
        getNavItems: getNavItems,
        getDashboard: getDashboard,
        getDashboardByRoute: getDashboardByRoute,
        getDataDashboards: getDataDashboards,
        findDashboardByKeyword: findDashboardByKeyword,
        getSchemaDescription: getSchemaDescription,
        getCompactSchemaHints: getCompactSchemaHints,
        getAdvisorQueries: getAdvisorQueries,
        getDashboardSuggestions: getDashboardSuggestions
    };
});