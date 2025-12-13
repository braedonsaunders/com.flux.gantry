# Advisor Prompts Upgrade Proposal

## Executive Summary

This proposal outlines a comprehensive upgrade to the Gantry Advisor prebuilt prompts system. After analyzing the current 15 categories with 85+ prompts against the available tools (50+) and dashboard data (8 dashboards with 100+ computed metrics), I've identified significant opportunities to:

1. **Surface hidden intelligence** - Many powerful dashboard metrics (health scores, CLV, spend velocity, churn risk) aren't accessible via prompts
2. **Add strategic-level questions** - Current prompts are tactical; CFOs need strategic insights
3. **Leverage advanced analytics** - Anomaly detection, Benford's Law, RFM segmentation exist but aren't well exposed
4. **Align prompts with health categories** - The 8 health tiles should drive primary prompt organization

---

## Current State Analysis

### Existing Categories (15 total, 85+ prompts)

| Category | Prompts | Gaps Identified |
|----------|---------|-----------------|
| Financial Statements | 5 | Good coverage |
| Cash & Liquidity | 4 | Missing: burn rate, critical weeks, working capital |
| Accounts Receivable | 7 | Good - could add concentration risk |
| Accounts Payable | 6 | Missing: cash needs for AP |
| Revenue & Sales | 6 | Missing: YoY comparison, growth rate |
| Profitability | 4 | Missing: health score, breakeven, department scores |
| Expenses | 4 | Missing: velocity, acceleration, boiling frog, shadow IT |
| Orders & Pipeline | 4 | Missing: velocity gap, overdue POs |
| General Ledger | 3 | Missing: anomaly detection by account |
| Labor & Time | 3 | Missing: unbilled value, effective rate, trend |
| Inventory | 4 | Good coverage |
| Find Transaction | 8 | Good - could add memo search |
| Customers | 6 | Missing: CLV, churn risk, RFM, grades |
| Vendors | 6 | Missing: renewals, maverick spend, term compliance |
| Data Quality | 6 | Good - could add ghost vendor, sequential invoice |

### Major Gaps

1. **Dashboard Health Scores** - None of the 8 dashboard health scores are exposed via prompts
2. **Customer Intelligence** - CLV, RFM segmentation, churn risk, customer grades not accessible
3. **Vendor Intelligence** - Renewal radar, maverick spend, leverage matrix hidden
4. **Spend Analytics** - Velocity, acceleration, boiling frog patterns, shadow IT detection unused
5. **Burden/Overhead** - Zero prompts for burden rate analysis
6. **Forecasting** - Cash projections, critical weeks, runway deeply buried
7. **Comparisons** - Period comparisons, budget variance underutilized

---

## Proposed Structure

### Design Principles

1. **Health Categories First** - The 8 health tiles should be the primary organization
2. **Strategic to Tactical** - Lead with "what's the score?" then drill down
3. **Natural Language** - Prompts should feel like questions a CFO would ask
4. **Action-Oriented** - Prompts should surface insights that drive decisions
5. **Comprehensive** - Every major tool capability should have at least one prompt path

### Proposed Category Structure

**TIER 1: HEALTH CATEGORIES (8)** - Aligned with dashboard tiles
- Cash Flow
- Revenue & Profitability
- Expenses & Spend
- Margins & Burden
- Labor & Utilization
- Customers
- Vendors
- Data Quality

**TIER 2: OPERATIONAL CATEGORIES (6)** - Day-to-day finance operations
- Financial Statements
- Accounts Receivable
- Accounts Payable
- Orders & Pipeline
- Inventory
- General Ledger

**TIER 3: ANALYTICAL CATEGORIES (2)** - Cross-cutting analysis
- Comparisons & Variance
- Find Transaction

---

## Detailed Prompt Proposals

### TIER 1: HEALTH CATEGORIES

---

#### 1. CASH FLOW (Dashboard: cashflow)
**Icon:** fa-coins | **Color:** Green gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Cash Position | What's our current cash position? | auto | Core metric - total cash across accounts |
| Cash Runway | How many weeks of runway do we have? | auto | **Critical** - surfaces runwayWeeks metric |
| Weekly Burn Rate | What's our weekly burn rate? | auto | **NEW** - surfaces burnRate metric |
| Cash Forecast | What will our cash be in 30 days? | auto | Projection capability |
| Critical Weeks | When might we face cash constraints? | auto | **NEW** - surfaces criticalWeeks collection |
| Bank Balances | Show all bank account balances | auto | Detail drill-down |
| Working Capital | What's our working capital position? | auto | **NEW** - AR + Cash - AP calculation |
| AR/AP Impact | How do AR and AP affect our cash flow? | auto | **NEW** - aging impact analysis |

**Removed:** None (expanded from 4 to 8)

---

#### 2. REVENUE & PROFITABILITY (Dashboard: health)
**Icon:** fa-chart-line | **Color:** Blue gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Financial Health | What's our financial health score? | auto | **NEW** - surfaces healthScore (0-100) |
| P&L Summary | Show P&L summary year to date | auto | Income statement overview |
| Gross Margin | What's our gross margin percentage? | auto | Key profitability metric |
| YoY Growth | How does revenue compare to last year? | auto | **NEW** - YoY comparison |
| Department Health | Which departments are most profitable? | auto | **NEW** - department health scores |
| Breakeven Point | What revenue do we need to break even? | auto | **NEW** - breakeven calculation |
| Monthly Trend | Show monthly revenue trend | auto | Trend visualization |
| Top Changes | What accounts are driving P&L changes? | auto | **NEW** - topMovingAccounts |

**Removed:** Merged Revenue & Profitability categories

---

#### 3. EXPENSES & SPEND (Dashboard: spendvelocity)
**Icon:** fa-receipt | **Color:** Orange gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Spend Health | What's our spend health score? | auto | **NEW** - surfaces spendvelocity healthScore |
| Expense Breakdown | Break down expenses by category YTD | auto | Core expense analysis |
| Spend Velocity | Which vendors have accelerating spend? | auto | **NEW** - CAGR-based velocity! |
| Subscription Creep | Are there boiling frog spending patterns? | auto | **NEW** - silent price increases! |
| Shadow IT | Are there shadow IT tools spreading? | auto | **NEW** - viral software detection! |
| Expense Anomalies | Which expense accounts show anomalies? | auto | **NEW** - statistical outliers |
| By Department | Show expenses by department | auto | Departmental breakdown |
| Monthly Trend | Show monthly expense trend | auto | Trend analysis |

**Removed:** "Top Expense Accounts" (redundant with breakdown)

---

#### 4. MARGINS & BURDEN (Dashboard: burden)
**Icon:** fa-balance-scale | **Color:** Purple gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Burden Rate | What's our current burden rate? | auto | **NEW** - core overhead metric |
| vs Target | How does burden compare to our target? | auto | **NEW** - target comparison |
| Overhead Breakdown | Show overhead costs by category | auto | **NEW** - category analysis |
| By Department | Which departments have highest burden? | auto | **NEW** - department comparison |
| Allocation Base | How is overhead being allocated? | auto | **NEW** - allocation methodology |
| Burden Trend | Show burden rate trend over time | auto | **NEW** - historical trend |
| Gross Margin | Show gross margin by department | auto | Margin analysis |
| Net Margin | What's our net profit margin? | auto | Bottom-line profitability |

**This is an entirely NEW category** - burden dashboard had zero prompts

---

#### 5. LABOR & UTILIZATION (Dashboard: time)
**Icon:** fa-user-clock | **Color:** Amber gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Utilization Rate | What's our team utilization rate? | auto | **Enhanced** - overall metric first |
| By Employee | Show utilization by employee | auto | Employee breakdown |
| Unbilled Time | How much unbilled time do we have? | auto | **NEW** - unbilledAmount metric |
| Effective Rate | What's our effective billing rate? | auto | **NEW** - effectiveRate metric |
| By Customer | Which customers consume the most time? | auto | **NEW** - customer time analysis |
| Billable Hours | Show billable hours this month | auto | Core hours metric |
| Monthly Trend | Show utilization trend by month | auto | **NEW** - rolling history |
| Non-Billable | Where is non-billable time going? | auto | **NEW** - non-billable analysis |

**Expanded from 3 to 8 prompts**

---

#### 6. CUSTOMERS (Dashboard: customervalue)
**Icon:** fa-users | **Color:** Cyan gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Customer Score | What's our customer intelligence score? | auto | **NEW** - dashboard healthScore |
| Churn Risk | Which customers are at risk of churning? | auto | **NEW** - churn risk analysis! |
| Lifetime Value | What's our total customer lifetime value? | auto | **NEW** - CLV projection |
| RFM Segments | Show customer RFM segmentation | auto | **NEW** - RFM analysis! |
| Concentration | What's our customer concentration risk? | auto | **NEW** - Herfindahl index |
| Top Customers | Who are our top 10 customers by revenue? | auto | Core ranking |
| Champions | Who are our champion customers? | auto | **NEW** - RFM champions |
| Health Grades | Show customer health grades | auto | **NEW** - A+ to F grading |

**Removed:** Customer List, Customer Details (low value)
**Added:** 6 new intelligence-driven prompts

---

#### 7. VENDORS (Dashboard: vendorperformance)
**Icon:** fa-handshake | **Color:** Pink gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Vendor Score | What's our vendor performance score? | auto | **NEW** - dashboard healthScore |
| Renewal Radar | Which vendors are due for renewal? | auto | **NEW** - renewal radar! |
| Maverick Spend | Do we have spend without purchase orders? | auto | **NEW** - maverick spend! |
| Payment Terms | What's our payment term compliance? | auto | **NEW** - early/on-time/late % |
| Concentration | Show vendor concentration risk | auto | **NEW** - top vendor share |
| Top Vendors | Who are our top vendors by spend? | auto | Core ranking |
| Delivery Issues | Which vendors have delivery problems? | auto | **NEW** - OTIF analysis |
| Leverage Matrix | Show vendor strategic classification | auto | **NEW** - quadrant analysis |

**Removed:** Vendor List, Vendor Details (low value)
**Added:** 6 new intelligence-driven prompts

---

#### 8. DATA QUALITY / SENTINEL (Dashboard: integrity)
**Icon:** fa-shield-alt | **Color:** Indigo gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Risk Score | What's our transaction risk score? | auto | Core dashboard metric |
| Flagged Items | Show flagged transactions this month | auto | Primary alert view |
| Duplicates | Are there potential duplicate bills? | auto | Duplicate detection |
| Benford's Law | Which transactions fail Benford's Law? | auto | Statistical anomaly |
| Ghost Vendors | Are there ghost vendor patterns? | auto | **NEW** - address matching! |
| Sequential Invoices | Any suspicious sequential invoice patterns? | auto | **NEW** - shell company indicator! |
| Z-Score Anomalies | Show transactions with statistical anomalies | auto | **Enhanced** - Z-score analysis |
| Weekend Entries | Show transactions entered on weekends | auto | Timing anomaly |

**Removed:** "Anomaly Detection" (too generic)
**Added:** Ghost vendors, sequential invoices

---

### TIER 2: OPERATIONAL CATEGORIES

---

#### 9. FINANCIAL STATEMENTS
**Icon:** fa-file-invoice-dollar | **Color:** Purple gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Income Statement | Show the full income statement | auto | Keep |
| Balance Sheet | Show balance sheet | auto | Keep |
| Trial Balance | Show trial balance YTD | auto | Keep |
| Department P&L | Show P&L for | prefill | Keep |
| Comparative P&L | Compare P&L this year vs last year | auto | Enhanced wording |
| P&L by Department | Show P&L breakdown by all departments | auto | **NEW** - all depts at once |
| Balance Sheet Date | Show balance sheet as of | prefill | **NEW** - point-in-time |

**Minor enhancements only** - already good coverage

---

#### 10. ACCOUNTS RECEIVABLE
**Icon:** fa-hand-holding-usd | **Color:** Cyan gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| AR Aging Summary | Show AR aging summary | auto | Keep |
| AR Aging Detail | Show detailed AR aging by customer | auto | Keep |
| Past Due | Which invoices are past due? | auto | Keep |
| DSO | What's our days sales outstanding? | auto | Keep |
| Top AR Balances | Who owes us the most? | auto | Enhanced wording |
| Slowest Payers | Which customers are slowest to pay? | auto | **Enhanced** wording |
| Recent Payments | Show recent customer payments | auto | Keep |
| AR Concentration | What's our AR concentration risk? | auto | **NEW** |

---

#### 11. ACCOUNTS PAYABLE
**Icon:** fa-file-invoice | **Color:** Red gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| AP Aging | Show AP aging summary | auto | Keep |
| Bills Due | What bills are due this week? | auto | Keep |
| Past Due Bills | Which bills are past due? | auto | Keep |
| DPO | What's our days payable outstanding? | auto | Keep |
| Cash for AP | How much cash do we need for AP? | auto | **NEW** - cash planning |
| Top Payables | Who do we owe the most? | auto | Enhanced wording |
| AP Concentration | What's our AP concentration by vendor? | auto | **NEW** |
| Vendor Spend YoY | Compare vendor spend year over year | auto | Keep |

---

#### 12. ORDERS & PIPELINE
**Icon:** fa-shopping-cart | **Color:** Pink gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Open Sales Orders | Show open sales orders | auto | Keep |
| SO Backlog | What's our sales order backlog value? | auto | Keep |
| Open POs | Show open purchase orders | auto | Keep |
| PO Backlog | What's our purchase order backlog? | auto | **NEW** |
| Recent Orders | Show orders placed this week | auto | Keep |
| Pending Fulfillment | Which orders are pending fulfillment? | auto | **NEW** |
| Overdue POs | Which purchase orders are overdue? | auto | **NEW** |
| Velocity Gap | What's the gap between PO and SO velocity? | auto | **NEW** - commitment cliff |

---

#### 13. INVENTORY
**Icon:** fa-boxes | **Color:** Lime gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Stock Levels | Show current inventory levels | auto | Keep |
| Low Stock | What items are below reorder point? | auto | Keep |
| Out of Stock | Which items are out of stock? | auto | **NEW** |
| Inventory Value | What's our total inventory value? | auto | Keep |
| Stock Movement | Show inventory movement this month | auto | Keep |
| By Location | Show inventory by location | auto | **NEW** |
| Reorder Alerts | What items need to be reordered? | auto | **NEW** |

---

#### 14. GENERAL LEDGER
**Icon:** fa-book | **Color:** Indigo gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Account Activity | Show GL activity for | prefill | Keep |
| Journal Entries | Show recent journal entries | auto | Keep |
| Transaction Detail | Show detail for transaction # | prefill | Keep |
| By Department | Show GL activity by department | auto | **NEW** |
| Unusual Activity | Which accounts have unusual activity? | auto | **NEW** - anomaly |
| Account Search | Find transactions with memo | prefill | **NEW** - memo search |
| JE by Period | Show journal entries for | prefill | **NEW** - period-specific |

---

### TIER 3: ANALYTICAL CATEGORIES

---

#### 15. COMPARISONS & VARIANCE (NEW CATEGORY)
**Icon:** fa-balance-scale-right | **Color:** Teal gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Month vs Month | Compare this month to last month | auto | Period comparison |
| Quarter vs Quarter | Compare this quarter to last quarter | auto | Period comparison |
| Year over Year | Show year-over-year performance | auto | Annual comparison |
| Budget Variance | Show budget vs actual variance | auto | **NEW** - budget tool |
| Over Budget | Which accounts are over budget? | auto | **NEW** - variance filter |
| Department Compare | Compare performance across departments | auto | **NEW** - dept analysis |
| Revenue vs Expense | Compare revenue growth to expense growth | auto | **NEW** - dual comparison |
| Custom Compare | Compare | prefill | **NEW** - flexible comparison |

**This is an entirely NEW category** - consolidates comparison capabilities

---

#### 16. FIND TRANSACTION
**Icon:** fa-search | **Color:** Slate gradient

| Button Text | Question | Type | Rationale |
|-------------|----------|------|-----------|
| Find Invoice | Find invoice # | prefill | Keep |
| Find Bill | Find vendor bill # | prefill | Keep |
| Find SO | Find sales order # | prefill | Keep |
| Find PO | Find purchase order # | prefill | Keep |
| Find JE | Find journal entry # | prefill | **NEW** |
| Today's Activity | Show transactions created today | auto | Enhanced |
| By Entity | Show transactions for | prefill | **NEW** - entity search |
| By Memo | Find transactions with memo | prefill | **NEW** - memo search |
| Latest Invoice | Show the latest invoice | auto | Keep |
| Latest Bill | Show the latest vendor bill | auto | Keep |

---

## Summary Statistics

### Before vs After

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total Categories | 15 | 16 | +1 |
| Health-Aligned Categories | 0 | 8 | +8 |
| Total Prompts | 85 | 118 | +39% |
| Dashboard Scores Exposed | 0 | 8 | +8 |
| Advanced Analytics Prompts | 6 | 24 | +300% |
| Prefill Prompts | 13 | 16 | +3 |

### New Capabilities Surfaced

1. **8 Dashboard Health Scores** - Every dashboard's primary metric now accessible
2. **Customer Intelligence** - CLV, churn risk, RFM segmentation, health grades
3. **Vendor Intelligence** - Renewal radar, maverick spend, OTIF, leverage matrix
4. **Spend Analytics** - Velocity, acceleration, boiling frog, shadow IT
5. **Burden Analysis** - Full overhead/burden rate category (8 prompts)
6. **Cash Intelligence** - Burn rate, critical weeks, working capital
7. **Comparison Engine** - Dedicated category for period/budget analysis
8. **Fraud Detection** - Ghost vendors, sequential invoices, Z-score anomalies

### Removed Prompts (Low Value)

- Customer List / Vendor List (generic, low insight)
- Customer Details / Vendor Details (better as prefill search)
- Generic "Anomaly Detection" (replaced with specific types)
- Duplicate prompts across categories

---

## Implementation Recommendations

### Phase 1: Quick Wins (1-2 days)
1. Add health score prompts to each of the 8 dashboard categories
2. Add the 3 most valuable new prompts per category
3. Update prompt wording for clarity

### Phase 2: New Categories (2-3 days)
1. Create "Margins & Burden" category (currently zero prompts)
2. Create "Comparisons & Variance" category
3. Reorganize existing prompts to align with health tiles

### Phase 3: Advanced Analytics (3-4 days)
1. Add customer intelligence prompts (CLV, churn, RFM)
2. Add vendor intelligence prompts (renewals, maverick, OTIF)
3. Add spend velocity prompts (boiling frog, shadow IT)

### Phase 4: Polish (1-2 days)
1. Review prompt wording for natural language flow
2. Ensure all prompts resolve to correct tools
3. Add any missing prefill prompts
4. Test end-to-end prompt → response quality

---

## Technical Notes

### Prompt Structure
```javascript
{
    text: 'Button Text',           // Short label for button
    question: 'Full question?',    // Sent to advisor
    prefill: true/false,           // If true, prefills input for user to complete
    placeholder: 'Hint text'       // Only if prefill=true
}
```

### Tool Mapping Considerations
- Health score prompts → `dashboard_*` tools
- Comparison prompts → `compare_periods` tool
- Budget prompts → `get_budget_variance` tool
- Velocity prompts → `dashboard_spendvelocity` tool
- Intelligence prompts → `dashboard_customervalue` / `dashboard_vendorperformance`

### Category-Dashboard Alignment
```javascript
const categoryDashboardMap = {
    'cash': 'cashflow',
    'revenue': 'health',
    'expenses': 'spendvelocity',
    'margins': 'burden',
    'labor': 'time',
    'customers': 'customervalue',
    'vendors': 'vendorperformance',
    'dataquality': 'integrity'
};
```

---

## Open Questions for Discussion

1. **Category Naming**: Should "Revenue & Profitability" be split back into two categories?
2. **Prompt Limits**: Is there a max number of prompts per category for UX?
3. **Prefill Strategy**: Should more prompts be prefill to encourage specificity?
4. **Mobile UX**: How do 8+ prompts per category display on mobile?
5. **Personalization**: Should prompts adapt based on user role or company type?

---

## Appendix: Full Prompt List by Category

### 1. Cash Flow (8 prompts)
1. What's our current cash position?
2. How many weeks of runway do we have?
3. What's our weekly burn rate?
4. What will our cash be in 30 days?
5. When might we face cash constraints?
6. Show all bank account balances
7. What's our working capital position?
8. How do AR and AP affect our cash flow?

### 2. Revenue & Profitability (8 prompts)
1. What's our financial health score?
2. Show P&L summary year to date
3. What's our gross margin percentage?
4. How does revenue compare to last year?
5. Which departments are most profitable?
6. What revenue do we need to break even?
7. Show monthly revenue trend
8. What accounts are driving P&L changes?

### 3. Expenses & Spend (8 prompts)
1. What's our spend health score?
2. Break down expenses by category YTD
3. Which vendors have accelerating spend?
4. Are there boiling frog spending patterns?
5. Are there shadow IT tools spreading?
6. Which expense accounts show anomalies?
7. Show expenses by department
8. Show monthly expense trend

### 4. Margins & Burden (8 prompts)
1. What's our current burden rate?
2. How does burden compare to our target?
3. Show overhead costs by category
4. Which departments have highest burden?
5. How is overhead being allocated?
6. Show burden rate trend over time
7. Show gross margin by department
8. What's our net profit margin?

### 5. Labor & Utilization (8 prompts)
1. What's our team utilization rate?
2. Show utilization by employee
3. How much unbilled time do we have?
4. What's our effective billing rate?
5. Which customers consume the most time?
6. Show billable hours this month
7. Show utilization trend by month
8. Where is non-billable time going?

### 6. Customers (8 prompts)
1. What's our customer intelligence score?
2. Which customers are at risk of churning?
3. What's our total customer lifetime value?
4. Show customer RFM segmentation
5. What's our customer concentration risk?
6. Who are our top 10 customers by revenue?
7. Who are our champion customers?
8. Show customer health grades

### 7. Vendors (8 prompts)
1. What's our vendor performance score?
2. Which vendors are due for renewal?
3. Do we have spend without purchase orders?
4. What's our payment term compliance?
5. Show vendor concentration risk
6. Who are our top vendors by spend?
7. Which vendors have delivery problems?
8. Show vendor strategic classification

### 8. Data Quality (8 prompts)
1. What's our transaction risk score?
2. Show flagged transactions this month
3. Are there potential duplicate bills?
4. Which transactions fail Benford's Law?
5. Are there ghost vendor patterns?
6. Any suspicious sequential invoice patterns?
7. Show transactions with statistical anomalies
8. Show transactions entered on weekends

### 9. Financial Statements (7 prompts)
1. Show the full income statement
2. Show balance sheet
3. Show trial balance YTD
4. Show P&L for [department]
5. Compare P&L this year vs last year
6. Show P&L breakdown by all departments
7. Show balance sheet as of [date]

### 10. Accounts Receivable (8 prompts)
1. Show AR aging summary
2. Show detailed AR aging by customer
3. Which invoices are past due?
4. What's our days sales outstanding?
5. Who owes us the most?
6. Which customers are slowest to pay?
7. Show recent customer payments
8. What's our AR concentration risk?

### 11. Accounts Payable (8 prompts)
1. Show AP aging summary
2. What bills are due this week?
3. Which bills are past due?
4. What's our days payable outstanding?
5. How much cash do we need for AP?
6. Who do we owe the most?
7. What's our AP concentration by vendor?
8. Compare vendor spend year over year

### 12. Orders & Pipeline (8 prompts)
1. Show open sales orders
2. What's our sales order backlog value?
3. Show open purchase orders
4. What's our purchase order backlog?
5. Show orders placed this week
6. Which orders are pending fulfillment?
7. Which purchase orders are overdue?
8. What's the gap between PO and SO velocity?

### 13. Inventory (7 prompts)
1. Show current inventory levels
2. What items are below reorder point?
3. Which items are out of stock?
4. What's our total inventory value?
5. Show inventory movement this month
6. Show inventory by location
7. What items need to be reordered?

### 14. General Ledger (7 prompts)
1. Show GL activity for [account]
2. Show recent journal entries
3. Show detail for transaction #[id]
4. Show GL activity by department
5. Which accounts have unusual activity?
6. Find transactions with memo [text]
7. Show journal entries for [period]

### 15. Comparisons & Variance (8 prompts)
1. Compare this month to last month
2. Compare this quarter to last quarter
3. Show year-over-year performance
4. Show budget vs actual variance
5. Which accounts are over budget?
6. Compare performance across departments
7. Compare revenue growth to expense growth
8. Compare [custom]

### 16. Find Transaction (10 prompts)
1. Find invoice #[number]
2. Find vendor bill #[number]
3. Find sales order #[number]
4. Find purchase order #[number]
5. Find journal entry #[number]
6. Show transactions created today
7. Show transactions for [entity]
8. Find transactions with memo [text]
9. Show the latest invoice
10. Show the latest vendor bill

---

**Total: 16 categories, 118 prompts**

*Document generated: December 2024*
*For review and approval before implementation*
