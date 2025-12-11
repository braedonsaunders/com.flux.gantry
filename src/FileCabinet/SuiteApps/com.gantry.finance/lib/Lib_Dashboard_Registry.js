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
            
            // AI-ready data schema description
            dataSchema: {
                summary: 'Cash flow and liquidity metrics showing current cash, receivables, payables, and runway projections',
                fields: {
                    // Summary metrics
                    totalCash: { type: 'currency', desc: 'Total cash across all bank accounts right now' },
                    totalAR: { type: 'currency', desc: 'Total accounts receivable (money owed TO us by customers)' },
                    totalAP: { type: 'currency', desc: 'Total accounts payable (money WE owe to vendors)' },
                    netPosition: { type: 'currency', desc: 'Net cash position = totalCash + totalAR - totalAP' },
                    runwayDays: { type: 'number', desc: 'Days of cash runway at current burn rate' },
                    burnRate: { type: 'currency', desc: 'Average monthly cash burn (negative = spending)' },
                    
                    // AR Aging buckets
                    arCurrent: { type: 'currency', desc: 'AR invoices 0-30 days old (not yet due)' },
                    ar31to60: { type: 'currency', desc: 'AR invoices 31-60 days old (slightly overdue)' },
                    ar61to90: { type: 'currency', desc: 'AR invoices 61-90 days old (moderately overdue)' },
                    arOver90: { type: 'currency', desc: 'AR invoices >90 days old (seriously overdue, collection risk)' },
                    
                    // AP Aging buckets
                    apCurrent: { type: 'currency', desc: 'AP bills due in 0-30 days' },
                    ap31to60: { type: 'currency', desc: 'AP bills due in 31-60 days' },
                    ap61to90: { type: 'currency', desc: 'AP bills due in 61-90 days' },
                    apOver90: { type: 'currency', desc: 'AP bills overdue >90 days (needs immediate attention)' },
                    
                    // Bank accounts array
                    bankAccounts: { 
                        type: 'array', 
                        desc: 'List of bank accounts with balances',
                        itemFields: {
                            name: { type: 'string', desc: 'Account name' },
                            balance: { type: 'currency', desc: 'Current balance' },
                            type: { type: 'string', desc: 'Account type (checking, savings, etc)' }
                        }
                    },
                    
                    // Projections
                    projection30: { type: 'currency', desc: 'Projected cash in 30 days' },
                    projection60: { type: 'currency', desc: 'Projected cash in 60 days' },
                    projection90: { type: 'currency', desc: 'Projected cash in 90 days' }
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
                fields: {
                    // Overall health score
                    healthScore: { type: 'number', desc: 'Overall health score 0-100 (>70 good, >50 ok, <50 concern)' },
                    healthGrade: { type: 'string', desc: 'Letter grade A/B/C/D/F based on healthScore' },
                    
                    // Revenue metrics
                    revenueYTD: { type: 'currency', desc: 'Total revenue year-to-date (fiscal year)' },
                    revenueMTD: { type: 'currency', desc: 'Total revenue month-to-date' },
                    revenueLastMonth: { type: 'currency', desc: 'Total revenue last full month' },
                    revenueGrowth: { type: 'percent', desc: 'Revenue growth % vs same period last year' },
                    
                    // Expense metrics
                    expensesYTD: { type: 'currency', desc: 'Total expenses year-to-date' },
                    expensesMTD: { type: 'currency', desc: 'Total expenses month-to-date' },
                    
                    // Gross margin
                    gmAmount: { type: 'currency', desc: 'Gross margin dollar amount = revenue - COGS' },
                    gmPercent: { type: 'percent', desc: 'Gross margin percentage = gmAmount / revenue * 100' },
                    gmTarget: { type: 'percent', desc: 'Target gross margin percentage (company goal)' },
                    
                    // Net income
                    netIncome: { type: 'currency', desc: 'Net income = revenue - all expenses' },
                    netMargin: { type: 'percent', desc: 'Net margin percentage = netIncome / revenue * 100' },
                    
                    // By department array
                    departmentMetrics: {
                        type: 'array',
                        desc: 'Profitability breakdown by department',
                        itemFields: {
                            department: { type: 'string', desc: 'Department name' },
                            revenue: { type: 'currency', desc: 'Department revenue' },
                            expenses: { type: 'currency', desc: 'Department expenses' },
                            grossMargin: { type: 'currency', desc: 'Department gross margin' },
                            gmPercent: { type: 'percent', desc: 'Department GM %' }
                        }
                    },
                    
                    // Trends
                    revenueByMonth: {
                        type: 'array',
                        desc: 'Monthly revenue trend',
                        itemFields: {
                            month: { type: 'string', desc: 'Month label' },
                            revenue: { type: 'currency', desc: 'Revenue for month' }
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
                fields: {
                    currentBurdenRate: { type: 'percent', desc: 'Current burden rate (overhead / direct labor)' },
                    targetBurdenRate: { type: 'percent', desc: 'Target burden rate from configuration' },
                    totalOverhead: { type: 'currency', desc: 'Total overhead costs for period' },
                    totalDirectLabor: { type: 'currency', desc: 'Total direct labor costs for period' },
                    overheadRecovery: { type: 'percent', desc: 'Overhead recovery percentage' },
                    
                    byCategory: {
                        type: 'array',
                        desc: 'Overhead breakdown by category',
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
                fields: {
                    totalBillableHours: { type: 'number', desc: 'Total billable hours in period' },
                    totalNonBillableHours: { type: 'number', desc: 'Total non-billable hours' },
                    utilizationRate: { type: 'percent', desc: 'Billable / total hours worked' },
                    unbilledAmount: { type: 'currency', desc: 'Value of unbilled time entries' },
                    averageBillRate: { type: 'currency', desc: 'Average billing rate per hour' },
                    effectiveRate: { type: 'currency', desc: 'Effective rate (actual collected / hours)' },
                    
                    byEmployee: {
                        type: 'array',
                        desc: 'Hours by employee',
                        itemFields: {
                            employee: { type: 'string', desc: 'Employee name' },
                            billable: { type: 'number', desc: 'Billable hours' },
                            nonBillable: { type: 'number', desc: 'Non-billable hours' },
                            utilization: { type: 'percent', desc: 'Utilization rate' }
                        }
                    },
                    
                    byCustomer: {
                        type: 'array',
                        desc: 'Hours by customer',
                        itemFields: {
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
                fields: {
                    riskScore: { type: 'number', desc: 'Overall risk score 0-100' },
                    flaggedCount: { type: 'number', desc: 'Number of flagged transactions' },
                    duplicateCount: { type: 'number', desc: 'Potential duplicate transactions' },
                    weekendCount: { type: 'number', desc: 'Transactions entered on weekends' },
                    benfordDeviation: { type: 'percent', desc: 'Deviation from Benford\'s Law expected distribution' },
                    
                    flaggedTransactions: {
                        type: 'array',
                        desc: 'List of flagged transactions',
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
                fields: {
                    // Summary metrics
                    performanceScore: { type: 'number', desc: 'Overall vendor management score 0-100' },
                    totalVendors: { type: 'number', desc: 'Number of active vendors in period' },
                    totalSpend: { type: 'currency', desc: 'Total spend across all vendors' },
                    cashFlowLeakage: { type: 'currency', desc: 'Estimated cash flow loss from early payments' },
                    
                    // Leverage Matrix quadrant counts
                    strategicPartners: { type: 'number', desc: 'Count of strategic partner vendors (high spend, high value)' },
                    commodityVendors: { type: 'number', desc: 'Count of commodity vendors (high spend, low value)' },
                    nicheVendors: { type: 'number', desc: 'Count of niche specialist vendors (low spend, high value)' },
                    transactionalVendors: { type: 'number', desc: 'Count of transactional vendors (low spend, low value)' },
                    
                    // Term Compliance
                    earlyPaymentRate: { type: 'percent', desc: 'Percentage of bills paid early (cash flow leakage)' },
                    onTimePaymentRate: { type: 'percent', desc: 'Percentage of bills paid on time' },
                    latePaymentRate: { type: 'percent', desc: 'Percentage of bills paid late (relationship risk)' },
                    avgDaysFromTerms: { type: 'number', desc: 'Average days from payment terms (negative = early)' },
                    
                    // Renewal Radar
                    upcomingRenewals: { type: 'number', desc: 'Contracts renewing in next 90 days' },
                    autoRenewRisks: { type: 'number', desc: 'High-value contracts with auto-renew enabled' },
                    totalAtRiskValue: { type: 'currency', desc: 'Total annual value of at-risk renewals' },
                    
                    // Concentration Risk
                    herfindahlIndex: { type: 'number', desc: 'HHI concentration index (>2500 = high concentration)' },
                    topVendorShare: { type: 'percent', desc: 'Spend share of largest vendor' },
                    top5Share: { type: 'percent', desc: 'Combined spend share of top 5 vendors' },
                    
                    // Vendor details array
                    vendors: {
                        type: 'array',
                        desc: 'List of vendors with performance metrics',
                        itemFields: {
                            vendorId: { type: 'number', desc: 'Vendor internal ID' },
                            vendorName: { type: 'string', desc: 'Vendor company name' },
                            totalSpend: { type: 'currency', desc: 'Total spend with vendor' },
                            spendShare: { type: 'percent', desc: 'Percentage of total spend' },
                            quadrant: { type: 'string', desc: 'Leverage matrix quadrant (strategic/commodity/niche/transactional)' },
                            valueScore: { type: 'number', desc: 'Value score 0-100' },
                            paymentTerms: { type: 'string', desc: 'Payment terms (Net 30, etc)' },
                            avgDaysFromTerms: { type: 'number', desc: 'Average days from terms for this vendor' }
                        }
                    },
                    
                    // Contract renewals array
                    renewals: {
                        type: 'array',
                        desc: 'Upcoming contract renewals',
                        itemFields: {
                            vendorName: { type: 'string', desc: 'Vendor name' },
                            endDate: { type: 'date', desc: 'Contract end date' },
                            daysUntilRenewal: { type: 'number', desc: 'Days until renewal (negative = overdue)' },
                            annualValue: { type: 'currency', desc: 'Annual contract value' },
                            autoRenew: { type: 'boolean', desc: 'Whether contract auto-renews' },
                            riskLevel: { type: 'string', desc: 'Risk level (critical/warning/low)' }
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
                fields: {
                    // Summary metrics
                    intelligenceScore: { type: 'number', desc: 'Overall customer intelligence score 0-100' },
                    totalCustomers: { type: 'number', desc: 'Number of active customers in period' },
                    totalRevenue: { type: 'currency', desc: 'Total revenue across all customers' },
                    projectedCLV: { type: 'currency', desc: 'Total projected customer lifetime value' },
                    
                    // RFM Segmentation
                    championsCount: { type: 'number', desc: 'Number of champion customers' },
                    atRiskCount: { type: 'number', desc: 'Number of at-risk customers' },
                    atRiskRevenue: { type: 'currency', desc: 'Revenue at risk from churn' },
                    
                    // Retention
                    retentionRate: { type: 'percent', desc: 'Average retention probability' },
                    avgCustomerValue: { type: 'currency', desc: 'Average customer value' },
                    
                    // Growth
                    monthlyGrowth: { type: 'percent', desc: 'Average monthly growth rate' },
                    newCustomers: { type: 'number', desc: 'New customers in period' },
                    
                    // Customer details array
                    customerHealth: {
                        type: 'array',
                        desc: 'List of customers with health scores',
                        itemFields: {
                            customerId: { type: 'number', desc: 'Customer internal ID' },
                            customerName: { type: 'string', desc: 'Customer company name' },
                            healthScore: { type: 'number', desc: 'Health score 0-100' },
                            healthGrade: { type: 'string', desc: 'Letter grade A+ to F' },
                            totalRevenue: { type: 'currency', desc: 'Total revenue from customer' },
                            projectedCLV: { type: 'currency', desc: 'Projected lifetime value' },
                            rfmSegment: { type: 'string', desc: 'RFM segment (champions/loyal/potential/new/hibernating/at-risk/lost)' },
                            churnRisk: { type: 'string', desc: 'Churn risk level (critical/high/medium/low)' },
                            recommendation: { type: 'string', desc: 'Recommended action (nurture/win-back/onboard/review/maintain)' }
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
                fields: {
                    // Summary metrics
                    healthScore: { type: 'number', desc: 'Overall spend health score 0-100' },
                    healthGrade: { type: 'string', desc: 'Letter grade A-F based on health score' },
                    totalSpend: { type: 'currency', desc: 'Total spend in analysis period' },
                    vendorCount: { type: 'number', desc: 'Number of vendors analyzed' },
                    avgVelocity: { type: 'percent', desc: 'Average monthly spend velocity across vendors' },
                    avgAcceleration: { type: 'percent', desc: 'Average acceleration (change in velocity)' },
                    acceleratingCount: { type: 'number', desc: 'Vendors with accelerating spend' },
                    alertCount: { type: 'number', desc: 'Total active alerts requiring attention' },
                    
                    // Boiling Frog (Subscription Creep)
                    boilingFrogCount: { type: 'number', desc: 'Vendors with detected subscription creep pattern' },
                    boilingFrogAnnualImpact: { type: 'currency', desc: 'Estimated annual cost of subscription creep' },
                    
                    // Shadow IT
                    shadowITViralCount: { type: 'number', desc: 'Software tools spreading virally via expense reports' },
                    shadowITEmployees: { type: 'number', desc: 'Employee touchpoints with shadow IT tools' },
                    shadowITPotentialSavings: { type: 'currency', desc: 'Potential savings from enterprise licensing' },
                    
                    // Commitment Cliff
                    poVelocity: { type: 'percent', desc: 'Purchase order velocity (committed outflows)' },
                    soVelocity: { type: 'percent', desc: 'Sales order velocity (committed inflows)' },
                    velocityGap: { type: 'percent', desc: 'Gap between PO and SO velocity' },
                    commitmentStatus: { type: 'string', desc: 'Commitment cliff status (healthy/warning/critical)' },
                    
                    // Vendor velocity array
                    vendorVelocity: {
                        type: 'array',
                        desc: 'Velocity analysis by vendor',
                        itemFields: {
                            vendorId: { type: 'number', desc: 'Vendor internal ID' },
                            vendorName: { type: 'string', desc: 'Vendor name' },
                            totalSpend: { type: 'currency', desc: 'Total spend with vendor' },
                            velocity: { type: 'percent', desc: 'Monthly spend velocity' },
                            acceleration: { type: 'percent', desc: 'Acceleration (change in velocity)' },
                            trend: { type: 'string', desc: 'Trend (accelerating/high/rising/stable/falling/declining/decelerating)' }
                        }
                    },
                    
                    // Anomalies array
                    anomalies: {
                        type: 'array',
                        desc: 'Detected spending anomalies',
                        itemFields: {
                            vendorName: { type: 'string', desc: 'Vendor name' },
                            month: { type: 'string', desc: 'Month of anomaly' },
                            amount: { type: 'currency', desc: 'Anomalous amount' },
                            deviation: { type: 'percent', desc: 'Deviation from expected' },
                            type: { type: 'string', desc: 'Anomaly type (spike/drop)' },
                            severity: { type: 'string', desc: 'Severity (critical/warning)' }
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
        getAdvisorQueries: getAdvisorQueries
    };
});