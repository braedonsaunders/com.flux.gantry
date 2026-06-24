# Gantry Financial Suite

[![NetSuite](https://img.shields.io/badge/NetSuite-SuiteApp-blue)](https://www.netsuite.com/)
[![SuiteScript](https://img.shields.io/badge/SuiteScript-2.1-green)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Enterprise financial intelligence platform for NetSuite delivering real-time analytics, forecasting, and forensic intelligence through 10 specialized dashboards and an AI-powered financial advisor.

Gantry is open source and released under the MIT License. This project is not affiliated with, certified by, or endorsed by Oracle NetSuite.

## Overview

Gantry transforms NetSuite ERP data into actionable financial insights for C-suite executives and finance teams. Built as a native SuiteApp using SuiteScript 2.1, it integrates seamlessly with your existing NetSuite environment through a Suitelet/Restlet architecture.

## Dashboards

### Advisor
AI-powered natural language financial assistant with chat-based interface for querying financial data. Features intelligent entity resolution, multi-step analysis through tool calling, session persistence, and support for multiple AI providers (OpenAI, Claude, OpenRouter).

### Treasury (Cashflow)
Cash position analysis and liquidity projections including:
- Weekly cash flow forecasting with multiple prediction strategies (GL history, vendor payment patterns, credit card cycles)
- AP/AR aging analysis by vendor and customer
- Payment category management and bank account balancing
- Preservation mode for high-risk periods
- Vendor and category prioritization

### Profitability (Financial Health)
Margin waterfall analysis with drill-down capability:
- Multi-segment profitability analysis across departments, customers, and projects
- Revenue and expense forecasting with scenario modeling
- Anomaly detection and alerts
- Operating metrics and benchmarks with health score calculation
- Department performance comparison

### Rate Engine (Overhead Burden)
Multi-base overhead rate calculations:
- Interactive rate matrix with cell-level drill-down (hours, labor $, headcount, revenue bases)
- Drag-drop account classification with auto-matching
- Real-time scenario modeling with save/load capability
- Selling rate calculator with sensitivity analysis
- 6-period trend charts and budget variance tracking

### Utilization (Billable Time)
Employee productivity analytics:
- Utilization gauges per department
- Billable vs. non-billable hours tracking
- Rolling period history and department heatmaps
- Service item profitability
- Cost spike detection with sparkline trends

### Sentinel (Transaction Integrity)
Advanced forensic transaction analysis:
- **Benford's Law Analysis** - 1D and 2D first-digit fraud detection
- **Duplicate Detection** - SQL-based detection for 100k+ transactions
- **Relative Size Factor (RSF)** - Outlier identification by vendor patterns
- **Z-Score Analysis** - Entity-specific statistical baselines
- **Sequential Invoice Detection** - Shell company indicators
- **Ghost Vendor Detection** - Address matching with employees
- **Weekend Entry Monitoring** - User behavior analysis
- Sankey diagrams, scatter plots, and risk heatmaps

### Procurement (Vendor Performance)
Vendor intelligence and spend analytics:
- Maverick spend detection (bills without POs)
- OTIF Analysis (On-Time In-Full delivery metrics)
- Purchase Price Variance (PPV) detection
- Cash flow leakage analysis
- Vendor scorecard with HHI concentration index
- Leverage matrix analysis and contract renewal tracking

### Revenue Intelligence (Customer Value)
Customer health and segmentation:
- RFM (Recency, Frequency, Monetary) segmentation matrix
- Customer lifetime value (CLV) projections
- Churn risk monitoring and prediction
- Revenue concentration analysis
- Customer tier classification (Platinum/Gold/Silver/Bronze)
- Project-level costing and profitability

### Cost Dynamics (Spend Velocity)
Physics-based spend analysis:
- **Velocity & Acceleration Metrics** - Speed of spend changes
- **Boiling Frog Detector** - Subscription creep identification
- **Shadow IT Detection** - Viral software adoption tracking
- **Anomaly Heat Signatures** - Statistical outlier identification
- **Commitment Cliff** - PO vs. SO velocity analysis
- Seasonal pattern recognition and zombie spend detection
- Multi-subsidiary support with international currency handling

### Settings
Dashboard configuration and personalization:
- Dashboard visibility and ordering
- Dark mode toggle
- Default dashboard selection
- Per-dashboard parameter configuration

## Key Features

### Analytics & Visualization
- Interactive Plotly.js charts (bubble, scatter, waterfall, treemap, Sankey)
- Inline sparkline trends with custom SVG rendering
- Color-coded risk levels (Critical/High/Medium/Low)
- Interactive heatmaps and leverage matrices
- Full pagination and sortable tables with real-time filtering

### Advanced Algorithms
- Benford's Law fraud detection
- Z-Score anomaly detection with entity-specific baselines
- HHI (Herfindahl-Hirschman Index) concentration analysis
- Multiple forecasting algorithms (linear, exponential, seasonal)
- Velocity-based spend trajectory analysis

### AI Capabilities
- Natural language understanding for financial questions
- Entity resolution linking names to database records
- Tool calling for complex multi-step queries
- Template-based response formatting with visualizations
- Session persistence across conversations

### Enterprise Features
- Multi-subsidiary support (OneWorld compatible)
- Fiscal calendar auto-detection
- Scenario modeling with save/compare functionality
- Configurable thresholds and categories
- Debug mode for troubleshooting

## Tech Stack

**Frontend**
- Vanilla JavaScript (ES5/ES6)
- Plotly.js for data visualization
- Bootstrap 4.5.2
- Font Awesome 5.15.4
- Full dark mode support

**Backend**
- NetSuite SuiteScript 2.1
- Suitelet for HTML serving
- Restlet API router
- SuiteQL for complex queries

**AI Integration**
- OpenAI, Anthropic Claude, OpenRouter support
- Agent execution with tool calling
- Intelligent entity resolution

## Project Structure

```
/com.gantry.finance
├── /App
│   ├── gantry_index.html         # Main HTML template
│   └── /css/                     # 15 CSS modules
├── /client
│   ├── Gantry.App.js             # Router & navigation
│   ├── /core/                    # Utilities & API client
│   ├── /dashboards/              # 10 dashboard controllers
│   └── /advisor/                 # AI chat renderer
├── /lib
│   ├── Lib_Config.js             # Configuration & fiscal calendar
│   ├── Lib_*_Data.js             # Data libraries per dashboard
│   ├── Lib_Dashboard_Registry.js # Dashboard metadata
│   └── /advisor/                 # 16 AI-related modules
└── /suitelet
    ├── Gantry_Suitelet.js        # Entry point
    └── Gantry_Router.js          # API router
```

## Installation

Gantry is deployed with the SuiteCloud Development Framework (SDF):

```bash
git clone https://github.com/braedonsaunders/com.flux.gantry.git
cd com.flux.gantry
npm install
npx suitecloud account:setup
npm run sync
```

See the [installation guide](docs/installation.mdx) for details and [configuration](docs/configuration.mdx) for setup options. No license key or activation is required.

## Deployment

- **Suitelet**: `customscript_gantry_suitelet` / `customdeploy_gantry_suitelet`
- **Router**: `customscript_gantry_router` / `customdeploy_gantry_router`
- **Base Path**: `SuiteApps/com.gantry.finance`
- **Configuration**: `customrecord_gantry_config`

## License

Released under the [MIT License](LICENSE).

## Contributing

Issues and pull requests are welcome via [GitHub](https://github.com/braedonsaunders/com.flux.gantry). Please avoid committing customer data, account credentials, private keys, or screenshots containing sensitive NetSuite information.
