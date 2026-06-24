# Gantry Financial Suite - Functions Requiring Unit Tests

This document catalogs ALL functions across the codebase that require unit test implementation.

**Total Functions Identified**: ~300+
**Files Covered**: 21 library files
**Priority Levels**: P0 (Critical), P1 (High), P2 (Medium), P3 (Low)

---

## Table of Contents

1. [Lib_Config.js](#1-lib_configjs)
2. [Lib_Core.js](#2-lib_corejs)
3. [Lib_Shared.js](#3-lib_sharedjs)
4. [Lib_Dashboard_Registry.js](#4-lib_dashboard_registryjs)
5. [Lib_Model_Registry.js](#5-lib_model_registryjs)
6. [Lib_Time_Data.js](#6-lib_time_datajs)
7. [Lib_Cashflow_Data.js](#7-lib_cashflow_datajs)
8. [Lib_Health_Data.js](#8-lib_health_datajs)
9. [Lib_Burden_Data.js](#9-lib_burden_datajs)
10. [Lib_Integrity_Data.js](#10-lib_integrity_datajs)
11. [Lib_VendorPerformance_Data.js](#11-lib_vendorperformance_datajs)
12. [Lib_CustomerValue_Data.js](#12-lib_customervalue_datajs)
13. [Lib_SpendVelocity_Data.js](#13-lib_spendvelocity_datajs)
14. [Lib_Advisor_Utils.js](#14-lib_advisor_utilsjs)
15. [Lib_Advisor_QueryValidator.js](#15-lib_advisor_queryvalidatorjs)
16. [Lib_Advisor_QueryExecutor.js](#16-lib_advisor_queryexecutorjs)
17. [Lib_Advisor_EntityResolver.js](#17-lib_advisor_entityresolverjs)
18. [Lib_Advisor_AIProviders.js](#18-lib_advisor_aiprovidersjs)
19. [Lib_Advisor_Agent.js](#19-lib_advisor_agentjs)
20. [Lib_Advisor_ResponseBuilder.js](#20-lib_advisor_responsebuilderjs)
21. [Lib_Advisor_Tools.js](#21-lib_advisor_toolsjs)
22. [Lib_Advisor_ProgressStore.js](#22-lib_advisor_progressstorejs)
23. [Lib_Advisor_Orchestrator_v2.js](#23-lib_advisor_orchestrator_v2js)

---

## 1. Lib_Config.js

**Path**: `/lib/Lib_Config.js`
**Priority**: P0 - Critical (Foundation module)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `getStoredConfiguration` | `(configName: string) => object` | Retrieves stored config by name, merges with defaults | P0 |
| `generateDefaultConfiguration` | `(configName: string) => object` | Generates default config for dashboard | P0 |
| `save` | `(data: object, configName: string) => boolean` | Saves configuration to custom record | P0 |
| `getConfigForApi` | `(configName: string) => object` | Returns config with supplementary lookup data | P1 |
| `getFiscalCalendar` | `() => object` | Detects fiscal year from AccountingPeriod table | P0 |
| `getAccountList` | `() => array` | Fetches active GL accounts | P1 |
| `getBankAccountList` | `() => array` | Gets bank accounts with balances | P1 |
| `getSubsidiaryList` | `() => array` | Returns subsidiaries (OneWorld aware) | P1 |
| `getExpenseAccountList` | `() => array` | Gets Expense/COGS/OthExpense accounts | P2 |
| `getVendorList` | `() => array` | Gets active vendors with categories | P2 |
| `getDepartmentList` | `() => array` | Gets active departments | P2 |
| `getEmployeeList` | `() => array` | Gets active employees | P2 |
| `getServiceItemList` | `() => array` | Gets service items for time tracking | P2 |
| `getVendorCategoryList` | `() => array` | Gets vendor category classifications | P3 |
| `getEmployeeTypeList` | `() => array` | Gets employee types | P3 |
| `getCustomerList` | `() => array` | Gets active customers | P2 |

### Internal Helper Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `isDebugMode` | `() => boolean` | Checks if debug mode enabled (cached) | P2 |
| `debugLog` | `(title: string, details: any) => void` | Conditional debug logging | P3 |
| `auditLog` | `(title: string, details: any) => void` | Conditional audit logging | P3 |
| `formatConfigDate` | `(d: Date) => string` | Formats date as YYYY-MM-DD | P1 |
| `normalizeDateToYMD` | `(dateStr: string) => string` | Converts date strings to YYYY-MM-DD | P1 |
| `deepMerge` | `(source: object, target: object) => object` | Recursively merges objects | P0 |

---

## 2. Lib_Core.js

**Path**: `/lib/Lib_Core.js`
**Priority**: P0 - Critical (Query & Date utilities)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `parseDateRange` | `(params: object) => { startDate, endDate }` | Parses date range from request (MTD/QTD/YTD/L30/L90/L12M) | P0 |
| `parseDate` | `(dateInput: any) => Date` | Parses various date formats | P0 |
| `formatDateForQuery` | `(date: Date) => string` | Formats to YYYY-MM-DD for SQL | P0 |
| `formatDateForDisplay` | `(date: Date, formatType: string) => string` | Formats for UI display | P1 |
| `calculatePresetRange` | `(preset: string, asOf: Date) => object` | Calculates date ranges for presets | P0 |
| `getPriorYearRange` | `(startDate: Date, endDate: Date) => object` | Gets same period prior year | P1 |
| `getPriorPeriodRange` | `(startDate: Date, endDate: Date) => object` | Gets same duration before start | P1 |
| `runQuery` | `(sql: string, options: object) => array` | Executes SuiteQL query safely | P0 |
| `runQueryPaginated` | `(sql: string, pageSize: number) => array` | Runs paginated queries | P1 |
| `buildSubsidiaryFilter` | `(subsidiaryId: any, tableAlias: string) => string` | Builds WHERE clause fragment | P1 |
| `buildDateFilter` | `(dateColumn: string, startDate: Date, endDate: Date, tableAlias: string) => string` | Builds date range filter | P1 |
| `toNumber` | `(value: any, defaultValue: number) => number` | Safe number parsing | P0 |
| `percentage` | `(numerator: number, denominator: number, decimals: number) => number` | Calculates percentage | P0 |
| `ratio` | `(numerator: number, denominator: number, decimals: number) => number` | Calculates ratio as decimal | P0 |
| `variance` | `(actual: number, baseline: number) => object` | Calculates absolute and percent variance | P0 |
| `getSubsidiaries` | `() => array` | Lists all active subsidiaries | P2 |
| `getBankAccounts` | `(subsidiaryId: any) => array` | Gets bank accounts with balances | P2 |
| `getDepartments` | `(subsidiaryId: any) => array` | Gets departments | P2 |
| `getCurrentUser` | `() => object` | Gets current user info | P2 |
| `getRemainingUsage` | `() => number` | Checks remaining governance units | P1 |
| `isLowOnGovernance` | `(threshold: number) => boolean` | Checks if governance is low | P1 |

---

## 3. Lib_Shared.js

**Path**: `/lib/Lib_Shared.js`
**Priority**: P0 - Critical (Shared utilities)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `runSuiteQL` | `(sql: string) => array` | Executes SuiteQL with error handling | P0 |
| `formatDateYMD` | `(d: Date) => string` | Formats date to YYYY-MM-DD | P0 |
| `round2` | `(n: number) => number` | Rounds to 2 decimal places | P0 |
| `safeDiv` | `(n: number, d: number) => number` | Safe division avoiding divide by zero | P0 |

---

## 4. Lib_Dashboard_Registry.js

**Path**: `/lib/Lib_Dashboard_Registry.js`
**Priority**: P1 - High (Dashboard metadata)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `getAllDashboards` | `() => array` | Returns all dashboards sorted by sortOrder | P1 |
| `getNavItems` | `() => array` | Returns navigation sidebar items | P1 |
| `getDashboard` | `(id: string) => object` | Gets dashboard configuration by ID | P1 |
| `getDashboardByRoute` | `(route: string) => object` | Finds dashboard by route | P1 |
| `getDataDashboards` | `() => array` | Returns only data dashboards | P2 |
| `findDashboardByKeyword` | `(message: string) => object` | Matches dashboard by keyword | P1 |
| `getSchemaDescription` | `(dashboardId: string) => string` | Gets AI-ready schema description | P2 |
| `getCompactSchemaHints` | `(dashboardId: string) => object` | Gets compact field hints | P2 |
| `getAdvisorQueries` | `() => object` | Returns advisor query suggestions | P2 |
| `getDashboardSuggestions` | `(dashboardId: string) => array` | Returns contextual suggestions | P2 |

---

## 5. Lib_Model_Registry.js

**Path**: `/lib/Lib_Model_Registry.js`
**Priority**: P1 - High (AI model configuration)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `getModel` | `(modelId: string) => object` | Gets model definition by ID | P1 |
| `getModelsForProvider` | `(providerId: string) => array` | Lists models for a provider | P1 |
| `getSettingsOptions` | `(providerId: string) => array` | Gets model options for settings dropdown | P2 |
| `getDefaultModel` | `(providerId: string) => object` | Gets recommended model for provider | P1 |
| `getAllModelsForTierSettings` | `() => object` | Gets all models for tier settings | P2 |
| `getModelsForProviderSettings` | `(providerId: string) => array` | Gets models for provider settings | P2 |
| `getModelsForSettings` | `() => object` | Gets complete model data for Settings UI | P2 |
| `getOpenRouterModelsForSettings` | `(apiKey: string) => array` | Fetches OpenRouter models | P2 |
| `fetchOpenRouterModels` | `(apiKey: string) => array` | Fetches dynamic models from OpenRouter API | P1 |
| `getCuratedOpenRouterModels` | `() => array` | Returns curated fallback models | P2 |
| `getProvider` | `(providerId: string) => object` | Gets provider configuration | P1 |
| `getModelForTier` | `(providerId: string, tier: number, selectedModel: string, tierConfig: object) => object` | Selects model based on tier | P1 |
| `getModelForTierSimple` | `(providerId: string, tier: number, selectedModel: string) => object` | Simple tier model selection | P1 |
| `getModelDisplayInfo` | `(modelId: string) => object` | Gets model display info with pricing | P2 |
| `getMaxTokensParam` | `(modelId: string) => string` | Gets max tokens parameter name | P2 |
| `getParamWrapper` | `(modelId: string) => object` | Gets parameter wrapper structure | P2 |
| `buildApiParams` | `(modelId: string, params: object) => object` | Builds API parameters for model | P1 |
| `hasCapability` | `(modelId: string, capability: string) => boolean` | Checks model capabilities | P1 |
| `supportsTemperature` | `(modelId: string) => boolean` | Checks if model supports temperature | P2 |
| `getRetryGuidance` | `() => object` | Gets guidance for error recovery | P2 |
| `getGuidanceForError` | `(errorType: string) => string` | Gets specific error guidance | P2 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `processOpenRouterModels` | `(rawModels: array) => array` | Processes raw API response | P2 |
| `extractProviderFromId` | `(modelId: string) => string` | Extracts provider from model ID | P2 |
| `buildCapabilities` | `(model: object) => array` | Builds capabilities array | P2 |
| `getNetSuiteModelFamily` | `(modelName: string) => enum` | Gets NetSuite model family | P1 |

---

## 6. Lib_Time_Data.js

**Path**: `/lib/Lib_Time_Data.js`
**Priority**: P1 - High (Utilization calculations)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `getData` | `(context: { startDate, endDate, subsidiary }) => object` | Main utilization metrics | P0 |
| `handleRequest` | `(data: { subAction, employeeId, itemId, startDate, endDate }) => object` | Sub-action handler | P1 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `calculateRollingHistory` | `(rangeStart, rangeEnd, config, hiddenDepts, hiddenEmps, noBillDepts, subsidiaryId) => array` | Calculates 5-period rolling history | P1 |
| `fetchTimeStats` | `(start, end, config, subsidiaryId) => object` | Fetches time entry statistics | P0 |
| `buildTimeCompany` | `(curr, prior, days, config, noBillDepts) => object` | Builds company-level metrics | P0 |
| `buildTimeGroup` | `(curr, prior, groupKey, config, noBillDepts) => array` | Groups stats by department/item | P1 |
| `getEmployeeTimeEntries` | `(data, config) => array` | Retrieves employee time entries | P2 |
| `getItemTimeEntries` | `(data, config) => array` | Retrieves item time entries | P2 |

---

## 7. Lib_Cashflow_Data.js

**Path**: `/lib/Lib_Cashflow_Data.js`
**Priority**: P0 - Critical (Treasury calculations)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `getData` | `(context: object) => object` | Main cashflow analysis | P0 |

### Internal Functions (Key calculations)

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `computeCombinedStats` | `(paymentHistoryDays, defaultDaysToPay) => object` | Computes AR/AP statistics | P0 |
| `buildARForecast` | `(timeline, arStats, volatilityThresholds, overduePushDays) => array` | Projects AR collections | P0 |
| `buildAPForecast` | `(timeline, apStats, apFilters, overduePushDays) => array` | Projects AP payments | P0 |
| `computeBankBalance` | `(bankAccountIds: array) => number` | Calculates total bank balance | P0 |
| `calculateTimeline` | `(horizonWeeks: number) => array` | Builds weekly projection timeline | P1 |
| `buildARCategories` | `(timeline, categoryRules, currStats, arStats) => object` | Categories AR by customer | P1 |
| `buildAPCategories` | `(timeline, categoryRules, currStats, apStats) => object` | Categories AP by vendor | P1 |
| `calculateRunway` | `(cashBalance, burnRate) => number` | Calculates runway days | P0 |
| `calculateVolatility` | `(paymentHistory: array) => object` | Calculates payment volatility | P1 |
| `projectWeeklyCashflow` | `(timeline, ar, ap, config) => array` | Projects weekly cash flow | P0 |

---

## 8. Lib_Health_Data.js

**Path**: `/lib/Lib_Health_Data.js`
**Priority**: P0 - Critical (P&L calculations)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `getData` | `(context: object) => object` | Main financial health analysis | P0 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `parseLocalDate` | `(dateStr: string) => Date` | Timezone-safe date parsing | P1 |
| `roundMetrics` | `(metrics: object) => object` | Rounds financial metrics to 2 decimals | P1 |
| `roundAllPeriodMetrics` | `(metricsObj: object) => object` | Rounds all period metrics | P1 |
| `getMetricsForRange` | `(startStr, endStr) => object` | Fetches GL metrics for date range | P0 |
| `buildCompanyMetrics` | `(currentMetrics, priorMetrics) => object` | Builds company P&L | P0 |
| `buildDepartmentMetrics` | `(currentMetrics, priorMetrics) => array` | Builds department profitability | P0 |
| `fetchDepartmentMetrics` | `(start, end) => object` | Queries department-level data | P1 |
| `calculateHealthScore` | `(metrics: object) => number` | Calculates 0-100 health score | P0 |
| `calculateGrossMargin` | `(revenue, cogs) => number` | Calculates gross margin % | P0 |
| `calculateOperatingMargin` | `(grossProfit, opex) => number` | Calculates operating margin % | P0 |
| `calculateVariance` | `(current, prior) => object` | Calculates period variance | P0 |

---

## 9. Lib_Burden_Data.js

**Path**: `/lib/Lib_Burden_Data.js`
**Priority**: P0 - Critical (Overhead rate calculations - UNIQUE FEATURE)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `getData` | `(context: object) => object` | Main burden rate analysis | P0 |
| `handleRequest` | `(data: object) => object` | Sub-action handlers for CRUD | P1 |

### Internal Functions (Core Calculations)

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `analyzeOverhead` | `(startDate, endDate, categoryIds, baseAllocation) => object` | Core burden calculation | P0 |
| `computeOverheadByCategory` | `(rows, categories, baseAllocation) => object` | Allocates overhead by category | P0 |
| `calculateCompositeRate` | `(categories: array) => number` | Combines rates across categories | P0 |
| `buildTrendHistory` | `(startDate, endDate, categories) => array` | Calculates 12-month trend | P1 |
| `createProfile` | `(profileName: string) => object` | Creates new burden rate profile | P1 |
| `loadProfile` | `(profileId: string) => object` | Loads saved profile | P1 |
| `saveProfile` | `(profile: object) => boolean` | Persists profile to config | P1 |
| `deleteProfile` | `(profileId: string) => boolean` | Removes profile | P2 |
| `assignAccountToCategory` | `(accountId, categoryId) => boolean` | Maps GL account to category | P1 |
| `calculateRateByBase` | `(expense, base, baseType) => number` | Calculates rate for allocation base | P0 |
| `getBaseValue` | `(baseType, departmentId, startDate, endDate) => number` | Gets allocation base value | P0 |
| `fetchBilledHours` | `(departmentId, startDate, endDate) => number` | Fetches billed hours | P1 |
| `fetchLaborDollars` | `(departmentId, startDate, endDate) => number` | Fetches labor dollars | P1 |
| `fetchHeadcount` | `(departmentId, startDate, endDate) => number` | Fetches FTE headcount | P1 |
| `fetchRevenue` | `(departmentId, startDate, endDate) => number` | Fetches revenue | P1 |

---

## 10. Lib_Integrity_Data.js

**Path**: `/lib/Lib_Integrity_Data.js`
**Priority**: P0 - Critical (Fraud detection - UNIQUE FEATURE)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `analyzeIntegrity` | `(params: object) => object` | Main transaction integrity analysis | P0 |

### Internal Functions (Fraud Detection Algorithms)

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `detectDuplicates` | `(startDate, endDate, config, subsidiaryId) => array` | SQL-based duplicate detection | P0 |
| `analyzeBenford` | `(transactions: array) => object` | Benford's Law first-digit analysis | P0 |
| `analyzeBenford2D` | `(transactions: array) => object` | Benford's Law first TWO digits | P0 |
| `calculateExpectedBenford` | `(digit: number) => number` | Expected Benford frequency | P0 |
| `calculateExpectedBenford2D` | `(digits: string) => number` | Expected 2D Benford frequency | P0 |
| `calculateChiSquare` | `(observed, expected) => number` | Chi-square goodness of fit | P0 |
| `calculateZScore` | `(transactions, vendorId) => array` | Per-vendor statistical anomalies | P0 |
| `calculateVendorBaseline` | `(transactions, vendorId) => object` | Vendor transaction baseline | P0 |
| `detectSequentialInvoices` | `(vendorId, transactions) => array` | Shell company indicator | P0 |
| `analyzeSequentialPattern` | `(invoiceNumbers: array) => object` | Invoice number pattern analysis | P1 |
| `detectGhostVendors` | `(vendorId, transactions) => array` | Vendor/employee address matching | P0 |
| `matchAddresses` | `(vendorAddress, employeeAddresses) => array` | Address comparison | P1 |
| `calculateRSF` | `(transactions, vendorId) => object` | Relative Size Factor analysis | P0 |
| `flagWeekendEntries` | `(transactions: array) => array` | Identifies weekend entries | P1 |
| `buildFlaggedList` | `(duplicates, benford, anomalies, config) => array` | Consolidates findings | P1 |
| `calculateRiskScore` | `(transaction, flags) => number` | Calculates risk score 0-100 | P0 |
| `getRecommendations` | `(results: object) => array` | Generates audit recommendations | P2 |
| `getFirstDigit` | `(amount: number) => number` | Extracts first digit | P0 |
| `getFirstTwoDigits` | `(amount: number) => string` | Extracts first two digits | P0 |

---

## 11. Lib_VendorPerformance_Data.js

**Path**: `/lib/Lib_VendorPerformance_Data.js`
**Priority**: P1 - High (Procurement analytics)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `analyzeVendorPerformance` | `(params: object) => object` | Main vendor performance analysis | P0 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `calculateMaverickSpend` | `(vendorBills, purchaseOrders) => object` | Detects non-PO bills | P0 |
| `analyzeOTIF` | `(vendorTransactions, config) => object` | On-Time In-Full delivery analysis | P0 |
| `calculatePPV` | `(purchases: array) => object` | Purchase Price Variance | P0 |
| `buildLeverageMatrix` | `(vendorSpend, performance) => object` | Strategic/commodity quadrants | P1 |
| `calculateHHI` | `(vendorSpend: array) => number` | Herfindahl-Hirschman concentration | P0 |
| `calculatePaymentCompliance` | `(payments, config) => object` | Early/on-time/late rates | P1 |
| `analyzeLeadTimeVariance` | `(orders: array) => object` | Supplier consistency metrics | P2 |
| `buildVendorScorecard` | `(vendor, metrics, config) => object` | 0-100 scoring | P0 |
| `calculateWeightedScore` | `(metrics, weights) => number` | Weighted score calculation | P0 |
| `categorizeVendor` | `(score: number) => string` | Strategic/preferred/standard | P1 |

---

## 12. Lib_CustomerValue_Data.js

**Path**: `/lib/Lib_CustomerValue_Data.js`
**Priority**: P0 - Critical (Customer analytics)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `getData` | `(context: object) => object` | Main customer value analysis | P0 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `computeRFM` | `(customers, startDate, endDate) => object` | Recency/Frequency/Monetary scoring | P0 |
| `calculateRecencyScore` | `(daysSinceLastPurchase, thresholds) => number` | Recency component (1-5) | P0 |
| `calculateFrequencyScore` | `(purchaseCount, thresholds) => number` | Frequency component (1-5) | P0 |
| `calculateMonetaryScore` | `(totalRevenue, thresholds) => number` | Monetary component (1-5) | P0 |
| `calculateCLV` | `(customer, revenue, retentionRate, projectionYears) => number` | Lifetime value projection | P0 |
| `calculateRetentionRate` | `(customer, history) => number` | Customer retention rate | P1 |
| `calculateHealthScore` | `(customer, rfm, paymentHistory) => number` | Overall customer health 0-100 | P0 |
| `predictChurnRisk` | `(customer, recency, frequency) => object` | Churn probability | P0 |
| `calculateProfitability` | `(customerId, method) => number` | Via project financials or GL | P1 |
| `segmentCustomers` | `(rfmScores: array) => object` | RFM segments (champions, at-risk) | P0 |
| `getSegmentName` | `(r, f, m) => string` | Maps RFM to segment name | P0 |
| `calculateConcentrationRisk` | `(customers: array) => object` | HHI concentration analysis | P0 |
| `buildRFMDistribution` | `(segments: object) => object` | Distribution analytics | P2 |
| `classifyCustomerTier` | `(score: number) => string` | Platinum/Gold/Silver/Bronze | P1 |

---

## 13. Lib_SpendVelocity_Data.js

**Path**: `/lib/Lib_SpendVelocity_Data.js`
**Priority**: P0 - Critical (Physics-based spend analysis - UNIQUE FEATURE)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `analyzeSpendVelocity` | `(context: object) => object` | Main spend velocity analysis | P0 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `calculateCAGR` | `(startValue, endValue, periods) => number` | Compound Annual Growth Rate | P0 |
| `calculateVelocityCAGR` | `(monthlyAmounts, minBaseAmount) => number` | Monthly velocity from CAGR | P0 |
| `calculateAcceleration` | `(velocities: array) => number` | Rate of velocity change | P0 |
| `detectBoilingFrog` | `(monthlyAmounts, config) => object` | Subscription creep detection | P0 |
| `isBoilingFrog` | `(monthlyAmounts, threshold) => boolean` | Tests for subscription creep | P0 |
| `detectShadowIT` | `(transactions, config) => array` | Viral tool adoption detection | P0 |
| `detectZombieSpend` | `(monthlyAmounts, config) => boolean` | Inactive vendor detection | P1 |
| `detectFragmentation` | `(vendorIds, transactionCount, avgSize) => object` | Spend fragmentation | P1 |
| `calculateAnomalies` | `(monthlyAmounts, threshold) => array` | Statistical anomaly detection | P0 |
| `calculateStandardDeviation` | `(values: array) => number` | Standard deviation | P0 |
| `detectCommitmentCliff` | `(poVelocity, soVelocity) => object` | PO vs SO velocity gap | P0 |
| `classifyVelocity` | `(velocity: number) => string` | High/medium/low/negative | P1 |
| `classifyAcceleration` | `(acceleration: number) => string` | Accelerating/stable/decelerating | P1 |
| `buildVelocityTrend` | `(monthlyData: array) => array` | Velocity over time | P1 |
| `calculateHealthScore` | `(metrics: object) => number` | Overall velocity health 0-100 | P0 |

---

## 14. Lib_Advisor_Utils.js

**Path**: `/lib/advisor/Lib_Advisor_Utils.js`
**Priority**: P0 - Critical (Core utilities)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `cleanQuery` | `(query: string) => string` | Clean SQL query from markdown | P0 |
| `extractJsonFromText` | `(text: string, requiredField?: string) => object\|null` | Robust JSON extraction | P0 |
| `extractAndRemoveJson` | `(text: string, requiredField?: string) => { json, cleanedText }` | Extract and remove JSON | P1 |
| `checkGovernance` | `(requiredUnits: number) => { hasEnough, remaining, warning }` | Check governance units available | P0 |
| `buildPartialResponse` | `(toolResults, steps, startTime, reason, debugLog) => object` | Build response when exiting early | P1 |
| `formatDateYMD` | `(d: Date) => string` | Format date as YYYY-MM-DD | P0 |
| `formatResultsCompact` | `(result, maxRows, options) => string` | Format results compactly | P1 |
| `mapStatus` | `(statusCode: string) => string` | Map NetSuite status codes | P2 |
| `extractTopicsFromQuery` | `(message, description) => array` | Extract topics from query | P2 |
| `formatChatHistoryAsText` | `(history: array) => string` | Format chat history for prompt | P1 |
| `getRecordSchema` | `(recordType: string) => object` | Get schema for any record type | P1 |
| `extractErrorDetails` | `(e: Error) => object` | Extract comprehensive error details | P1 |
| `isDebugMode` | `() => boolean` | Check if debug mode enabled | P1 |
| `resetDebugModeCache` | `() => void` | Reset debug mode cache | P2 |
| `setForceDebugMode` | `(enabled: boolean) => void` | Force debug mode | P2 |
| `debugLog` | `(title: string, details?: any) => void` | Gated debug logging | P2 |
| `applyPivotTransformation` | `(rows, columns, pivotConfig) => object` | Apply pivot transformation | P2 |

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_MAX_TOKENS` | 4000 | Default max tokens |
| `GOVERNANCE_THRESHOLD_LLM` | 1000 | Governance threshold for LLM calls |
| `GOVERNANCE_THRESHOLD_QUERY` | 300 | Governance threshold for queries |

---

## 15. Lib_Advisor_QueryValidator.js

**Path**: `/lib/advisor/Lib_Advisor_QueryValidator.js`
**Priority**: P0 - Critical (Security)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `validateQuery` | `(sql: string) => { valid, reason?, suggestion?, warnings? }` | Validate SuiteQL for security | P0 |
| `ensureRowLimit` | `(sql: string, limit?: number) => string` | Add row limit to query | P0 |
| `convertLimitToFetchFirst` | `(sql: string) => string` | Convert LIMIT to FETCH FIRST | P0 |
| `hasFetchFirst` | `(sql: string) => boolean` | Check for proper row limit | P1 |
| `hasLimitClause` | `(sql: string) => boolean` | Check for LIMIT clause | P1 |
| `hasRowLimit` | `(sql: string) => boolean` | Check for any row limit | P1 |
| `getTableSchema` | `(tableNames?: array) => object` | Get schema for tables | P1 |
| `suggestFix` | `(errorMessage, failedQuery) => array` | Suggest fixes for errors | P2 |
| `isTableAllowed` | `(tableName: string) => { allowed, reason?, isStandard?, isCustomRecord? }` | Check if table allowed | P0 |
| `checkTransactionFilters` | `(sql, tablesInQuery) => array` | Check for recommended filters | P2 |

### Constants

| Constant | Description |
|----------|-------------|
| `STANDARD_TABLES` | List of known good tables |
| `BLOCKED_TABLES` | Security-sensitive blocked tables |
| `MAX_ROWS` | Maximum allowed rows |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `validateTables` | `(sql: string) => object` | Extracts and validates table names | P0 |
| `validateColumnReferences` | `(sql, tablesInQuery) => object` | Checks column references | P1 |
| `detectDangerousPatterns` | `(sql: string) => array` | Detects DROP/DELETE/UPDATE | P0 |

---

## 16. Lib_Advisor_QueryExecutor.js

**Path**: `/lib/advisor/Lib_Advisor_QueryExecutor.js`
**Priority**: P0 - Critical (Query execution)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `executeQuery` | `(sql: string, params?: object) => { success, columns, rows, rowCount, truncated, executionTime, sql, error? }` | Execute SuiteQL query safely | P0 |
| `executeScalar` | `(sql: string, params?: object) => { success, value }` | Execute query, return single value | P1 |
| `categorizeError` | `(error: object) => string` | Categorize error type | P0 |
| `buildErrorContext` | `(error, errorType, sql) => { message, type, suggestions }` | Build helpful error context | P1 |
| `formatResults` | `(results, formatting) => object` | Format query results | P2 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `formatCurrency` | `(value: number) => string` | Format as currency | P2 |
| `formatPercent` | `(value: number) => string` | Format as percent | P2 |
| `formatDate` | `(value: any) => string` | Format as date | P2 |
| `formatNumber` | `(value: number) => string` | Format with thousands separator | P2 |

---

## 17. Lib_Advisor_EntityResolver.js

**Path**: `/lib/advisor/Lib_Advisor_EntityResolver.js`
**Priority**: P0 - Critical (Entity matching)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `resolveEntity` | `(userTerm, entityType, preferredType?) => { success, resolved, entity, actualType, confidence, alternateMatches }` | Synchronous entity resolution | P0 |
| `resolveEntityWithFallback` | `(userTerm, entityType, preferredType?) => object` | Legacy resolution with fallback | P1 |
| `executeEntityResolution` | `(args: { term, entity_type }) => { success, resolved, id, name, code, confidence }` | Execute for agent tool | P0 |
| `getEntitiesOfType` | `(entityType, searchTerm?) => array` | Get all entities of type | P1 |
| `searchEntitiesDirectly` | `(entityType, searchTerm) => array` | Search entities directly | P1 |
| `findMatches` | `(term: string, entities: array) => { exact, fuzzy }` | Find exact and fuzzy matches | P0 |
| `getSimilarEntities` | `(term, entities, limit) => array` | Get similar entities | P1 |
| `parseEntityMarkers` | `(enrichedMessage: string) => { entities, cleanMessage }` | Parse [[TYPE:ID:NAME]] format | P1 |
| `markersToResolvedEntities` | `(entities: array) => object` | Convert to resolvedEntities format | P2 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `escapeSql` | `(str: string) => string` | Escapes SQL quotes | P0 |
| `escapeSqlLike` | `(str: string) => string` | Escapes SQL LIKE wildcards | P0 |
| `levenshteinDistance` | `(a: string, b: string) => number` | String distance calculation | P0 |

---

## 18. Lib_Advisor_AIProviders.js

**Path**: `/lib/advisor/Lib_Advisor_AIProviders.js`
**Priority**: P0 - Critical (AI integration)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `callAI` | `(prompt, options: { systemPrompt, chatHistory, documents, jsonMode, tools, maxTokens, temperature, purpose, tier }) => { text, type, toolCalls, model, provider, duration, _aiDebug }` | Unified AI call interface | P0 |
| `getAIConfig` | `() => object` | Retrieves AI configuration from settings | P0 |
| `getCurrentModelInfo` | `() => { provider, model }` | Gets current AI config for response | P1 |
| `getModelName` | `(aiConfig: object) => string` | Gets model name for display | P2 |
| `getUsage` | `() => { generate, embed }` | Gets NetSuite AI usage statistics | P2 |
| `getMaxTokensForModel` | `(modelId: string, purpose?: string) => number` | Gets max tokens for model | P1 |
| `getModelForTier` | `(provider, tier, aiConfig) => { provider, model }` | Gets model for tier and AI mode | P0 |
| `getModelDisplayInfo` | `(model: string) => object` | Gets model display info | P2 |
| `getAndClearAICallLog` | `() => array` | Gets and clears AI call history | P2 |
| `getAndClearAIDebugLog` | `() => array` | Gets and clears debug log | P2 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `callNetSuite` | `(prompt, aiConfig, options) => object` | Calls NetSuite N/llm module | P0 |
| `callOpenAI` | `(prompt, aiConfig, options) => object` | Calls OpenAI API | P0 |
| `callAnthropic` | `(prompt, aiConfig, options) => object` | Calls Anthropic API | P0 |
| `callGemini` | `(prompt, aiConfig, options) => object` | Calls Google Gemini API | P0 |
| `callOpenRouter` | `(prompt, aiConfig, options) => object` | Calls OpenRouter API | P1 |
| `callGrok` | `(prompt, aiConfig, options) => object` | Calls xAI Grok API | P1 |
| `mapToToolParameterType` | `(jsonType: string) => enum` | Maps JSON schema types | P2 |
| `getNetSuiteModelFamily` | `(modelName: string) => enum` | Gets NetSuite model family | P1 |
| `addAIDebug` | `(label, data) => void` | Adds debug entry | P3 |

---

## 19. Lib_Advisor_Agent.js

**Path**: `/lib/advisor/Lib_Advisor_Agent.js`
**Priority**: P0 - Critical (Agent loop)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `initAgentState` | `(message, history, sessionContext, requestId, options) => agentState` | Initialize agent state | P0 |
| `runAgentStep` | `(requestId: string) => { hasMore, step, error, response }` | Run ONE iteration of agent loop | P0 |
| `runAgent` | `(message, history, sessionContext, requestId, options) => object` | Synchronous wrapper using runAgentStep | P0 |
| `runAgentSync` | `(message, history, sessionContext, options) => object` | Run agent synchronously | P1 |
| `buildSystemPrompt` | `(fiscalContext, sessionContext) => string` | Build system prompt | P1 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `performReflection` | `(agentState, requestId) => object` | Analyzes tool results | P0 |
| `generateStrategyPivot` | `(agentState, reflection, requestId) => object` | Creates new strategy | P1 |
| `isToolCallFailure` | `(tc: object) => boolean` | Checks if tool call failed | P0 |
| `hasUsefulData` | `(tc: object) => boolean` | Checks if tool returned data | P0 |
| `shouldReflect` | `(agentState: object) => boolean` | Determines if reflection needed | P0 |
| `trackFailure` | `(agentState, toolName, args, result) => void` | Tracks failure for reflection | P1 |
| `clearFailureState` | `(agentState: object) => void` | Clears failure state | P1 |
| `trackError` | `(agentState, errorMessage) => void` | Tracks error for circuit breaker | P0 |
| `shouldTripCircuitBreaker` | `(agentState: object) => boolean` | Checks circuit breaker | P0 |
| `buildFactualToolSummary` | `(toolCalls: array) => string` | Builds factual tool summary | P0 |
| `hasTriedToolSignature` | `(agentState, toolName, args) => boolean` | Checks if tool tried | P1 |
| `markToolSignatureTried` | `(agentState, toolName, args) => void` | Marks tool as tried | P1 |
| `createPlan` | `(message, requestId) => object` | Creates initial analysis plan | P0 |
| `createPlanAndUpdateThinking` | `(message, requestId) => object` | Creates plan with thinking | P1 |
| `reassessPlan` | `(agentState, requestId) => object` | Reassesses plan on failure | P1 |
| `buildPlanContext` | `(plan: object) => string` | Builds plan context | P2 |
| `getFiscalContext` | `() => object` | Gets fiscal context info | P1 |
| `summarizeToolResult` | `(result: object) => string` | Summarizes tool result | P2 |
| `formatResultForLLM` | `(result, toolName) => string` | Formats result for LLM | P1 |
| `formatResultForStep` | `(result, toolName, duration) => object` | Formats result for step | P2 |
| `buildFinalResponse` | `(text, toolCalls, sessionContext, startTime) => object` | Builds final response | P0 |
| `synthesizeFromToolResults` | `(toolResults, originalMessage, startTime) => object` | Synthesizes response | P1 |
| `buildErrorResponse` | `(message, startTime) => object` | Builds error response | P1 |

---

## 20. Lib_Advisor_ResponseBuilder.js

**Path**: `/lib/advisor/Lib_Advisor_ResponseBuilder.js`
**Priority**: P1 - High (Response formatting)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `buildResponse` | `(text, steps, startTime, options) => object` | Build final response object | P0 |
| `parseRichContentFromAI` | `(text, queryResult, description, message) => array` | Parse rich content from AI | P1 |
| `parseRichContentFromDashboard` | `(text, dashboardData, dashboardId) => array` | Parse from dashboard data | P1 |
| `parseRichContentCore` | `(text, context) => array` | Core rich content parser | P1 |
| `sortRichContent` | `(richContent: array) => array` | Sort by priority | P2 |
| `isSingleTransactionResult` | `(result, message) => boolean` | Check if single transaction | P2 |
| `buildTransactionCardData` | `(row, columns) => object` | Build transaction card | P1 |
| `detectTransactionType` | `(row, description) => string` | Detect transaction type | P2 |
| `buildChartDataFromResult` | `(result: object) => object\|null` | Build chart from result | P1 |
| `extractMarkdownTables` | `(text: string) => { text, tables }` | Extract markdown tables | P1 |
| `generateContextualSuggestions` | `(sessionContext: object) => array` | Generate follow-ups | P2 |
| `addContextualSuggestions` | `(response: object) => object` | Add suggestions to response | P2 |

---

## 21. Lib_Advisor_Tools.js

**Path**: `/lib/advisor/Lib_Advisor_Tools.js`
**Priority**: P0 - Critical (Tool definitions)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `getToolDefinitions` | `() => array` | Get all tool definitions for LLM | P0 |
| `executeTool` | `(toolName: string, args: object) => object` | Execute specific tool | P0 |
| `getTool` | `(toolName: string) => object\|null` | Get specific tool definition | P1 |
| `getToolDisplayName` | `(toolName, args) => string` | Get user-friendly display name | P2 |
| `listToolsByCategory` | `() => { discovery, data, dashboard, utility }` | List tools by category | P2 |

### Tool Implementations (Each requires testing)

#### Discovery Tools
| Tool | Arguments | Returns | Priority |
|------|-----------|---------|----------|
| `resolve_entity` | `{ term, entity_type }` | `{ success, id, name, code }` | P0 |
| `resolve_gl_account` | `{ term }` | `{ success, id, name, number, type }` | P0 |
| `resolve_classification` | `{ term, classification_type }` | `{ success, id, name }` | P0 |
| `explore_schema` | `{ table_name }` | `{ success, schema }` | P1 |

#### Data Tools
| Tool | Arguments | Returns | Priority |
|------|-----------|---------|----------|
| `get_ap_aging` | `{ vendor_id?, as_of_date? }` | `{ buckets, total, details }` | P0 |
| `get_ar_aging` | `{ customer_id?, as_of_date? }` | `{ buckets, total, details }` | P0 |
| `get_vendor_spend` | `{ vendor_id?, start_date, end_date }` | `{ total, by_category, details }` | P0 |
| `get_customer_revenue` | `{ customer_id?, start_date, end_date }` | `{ total, by_item, details }` | P0 |
| `get_gl_activity` | `{ account_id?, start_date, end_date }` | `{ entries, balance }` | P0 |
| `get_trial_balance` | `{ as_of_date?, account_type? }` | `{ accounts, totals }` | P0 |
| `get_recent_transactions` | `{ entity_id?, type?, limit? }` | `{ transactions }` | P1 |
| `get_transaction_detail` | `{ transaction_id }` | `{ transaction }` | P1 |
| `compare_periods` | `{ metric, period1, period2 }` | `{ variance, percent_change }` | P0 |
| `find_anomalies` | `{ entity_type, threshold? }` | `{ anomalies }` | P1 |
| `get_cash_position` | `{ as_of_date? }` | `{ bank_balances, total }` | P0 |
| `get_expense_breakdown` | `{ start_date, end_date }` | `{ by_category, total }` | P1 |
| `get_income_statement` | `{ start_date, end_date }` | `{ revenue, expenses, net }` | P0 |
| `get_balance_sheet` | `{ as_of_date }` | `{ assets, liabilities, equity }` | P0 |
| `get_budget_vs_actual` | `{ start_date, end_date }` | `{ budget, actual, variance }` | P1 |

#### Dashboard Tools
| Tool | Arguments | Returns | Priority |
|------|-----------|---------|----------|
| `list_dashboards` | `{}` | `{ dashboards }` | P2 |
| `dashboard_cashflow` | `{ start_date?, end_date? }` | `{ data }` | P0 |
| `dashboard_health` | `{ start_date?, end_date? }` | `{ data }` | P0 |
| `dashboard_burden` | `{ start_date?, end_date? }` | `{ data }` | P0 |
| `dashboard_time` | `{ start_date?, end_date? }` | `{ data }` | P0 |
| `dashboard_integrity` | `{ start_date?, end_date? }` | `{ data }` | P0 |
| `dashboard_vendorperformance` | `{ start_date?, end_date? }` | `{ data }` | P0 |
| `dashboard_customervalue` | `{ start_date?, end_date? }` | `{ data }` | P0 |
| `dashboard_spendvelocity` | `{ start_date?, end_date? }` | `{ data }` | P0 |

#### Utility Tools
| Tool | Arguments | Returns | Priority |
|------|-----------|---------|----------|
| `get_fiscal_context` | `{}` | `{ fiscal_year, periods }` | P1 |
| `run_custom_query` | `{ sql }` | `{ columns, rows, rowCount }` | P0 |
| `list_saved_searches` | `{ type? }` | `{ searches }` | P2 |
| `run_saved_search` | `{ search_id, filters? }` | `{ results }` | P2 |
| `run_report` | `{ report_id }` | `{ results }` | P2 |

---

## 22. Lib_Advisor_ProgressStore.js

**Path**: `/lib/advisor/Lib_Advisor_ProgressStore.js`
**Priority**: P1 - High (Progress tracking)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `generateRequestId` | `() => string` | Generate unique request ID | P1 |
| `create` | `(requestId, message, agentState) => object` | Create new progress entry | P0 |
| `addStep` | `(requestId, step) => void` | Add step to progress | P0 |
| `updateLastStep` | `(requestId, updates) => void` | Update last step | P1 |
| `updateStepByType` | `(requestId, stepType, updates) => boolean` | Update specific step by type | P1 |
| `complete` | `(requestId, result) => void` | Mark request complete | P0 |
| `fail` | `(requestId, error) => void` | Mark request failed | P0 |
| `get` | `(requestId: string) => object\|null` | Get current progress state | P0 |
| `getAgentState` | `(requestId: string) => object\|null` | Get agent state | P1 |
| `setAgentState` | `(requestId, agentState) => boolean` | Set agent state | P1 |
| `exists` | `(requestId: string) => boolean` | Check if request exists | P1 |
| `remove` | `(requestId: string) => void` | Delete progress entry | P2 |
| `getPollingResponse` | `(requestId: string) => object` | Get formatted polling response | P0 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `getCache` | `() => object` | Gets cache reference | P2 |
| `safePut` | `(key, data, ttl) => boolean` | Safely puts data to cache | P1 |
| `safeGet` | `(key: string) => object` | Gets data from cache | P1 |
| `safeRemove` | `(key: string) => void` | Removes from cache | P2 |
| `trimAgentStateForStorage` | `(agentState: object) => object` | Trims agent state for storage | P1 |

---

## 23. Lib_Advisor_Orchestrator_v2.js

**Path**: `/lib/advisor/Lib_Advisor_Orchestrator_v2.js`
**Priority**: P0 - Critical (Main orchestration)

### Exported Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `processChat` | `(params: { message, history, sessionContext, aiSettings }) => object` | Process chat synchronously | P0 |
| `processChatAsync` | `(params: object) => { request_id, status }` | Start processing asynchronously | P0 |
| `getStatus` | `(requestId: string) => object` | Poll for progress updates | P0 |

### Re-exported Functions (from other modules)

| Function | From Module | Priority |
|----------|-------------|----------|
| `callAI` | AIProviders | P0 |
| `getAIConfig` | AIProviders | P1 |
| `getCurrentModelInfo` | AIProviders | P2 |
| `getUsage` | AIProviders | P2 |
| `getTools` | Tools | P1 |
| `executeTool` | Tools | P0 |
| `buildResponse` | ResponseBuilder | P1 |
| `cleanQuery` | Utils | P1 |
| `extractJsonFromText` | Utils | P1 |
| `checkGovernance` | Utils | P1 |

### Internal Functions

| Function | Signature | Description | Priority |
|----------|-----------|-------------|----------|
| `matchConversationalPattern` | `(message: string) => object\|null` | Matches simple patterns | P2 |
| `getHelpMessage` | `() => string` | Returns help message | P3 |

---

## Testing Priority Summary

### P0 - Critical (Must Test First) - 89 functions
Core calculations, security, data integrity

### P1 - High Priority - 72 functions
Important business logic, common paths

### P2 - Medium Priority - 58 functions
Supporting functions, edge cases

### P3 - Low Priority - 21 functions
Utility, logging, rarely used paths

---

## Testing Strategy Recommendations

### 1. Unit Test Structure
```
/tests
├── /lib
│   ├── Lib_Config.test.js
│   ├── Lib_Core.test.js
│   ├── Lib_Shared.test.js
│   ├── Lib_Dashboard_Registry.test.js
│   ├── Lib_Model_Registry.test.js
│   ├── Lib_Time_Data.test.js
│   ├── Lib_Cashflow_Data.test.js
│   ├── Lib_Health_Data.test.js
│   ├── Lib_Burden_Data.test.js
│   ├── Lib_Integrity_Data.test.js
│   ├── Lib_VendorPerformance_Data.test.js
│   ├── Lib_CustomerValue_Data.test.js
│   └── Lib_SpendVelocity_Data.test.js
├── /advisor
│   ├── Lib_Advisor_Utils.test.js
│   ├── Lib_Advisor_QueryValidator.test.js
│   ├── Lib_Advisor_QueryExecutor.test.js
│   ├── Lib_Advisor_EntityResolver.test.js
│   ├── Lib_Advisor_AIProviders.test.js
│   ├── Lib_Advisor_Agent.test.js
│   ├── Lib_Advisor_ResponseBuilder.test.js
│   ├── Lib_Advisor_Tools.test.js
│   ├── Lib_Advisor_ProgressStore.test.js
│   └── Lib_Advisor_Orchestrator_v2.test.js
├── /mocks
│   ├── netsuite-modules.js  # Mock N/query, N/search, etc.
│   ├── ai-providers.js      # Mock AI API responses
│   └── fixtures.js          # Test data fixtures
└── /integration
    ├── cashflow.integration.test.js
    ├── integrity.integration.test.js
    └── advisor.integration.test.js
```

### 2. Mock Requirements
- **N/query**: Mock `runSuiteQL`, `Query`, `ResultSet`
- **N/search**: Mock `create`, `load`, `Search`
- **N/record**: Mock `load`, `create`, `delete`
- **N/runtime**: Mock `getCurrentUser`, `getRemainingUsage`
- **N/https**: Mock `request`, `get`, `post`
- **N/cache**: Mock `getCache`, `get`, `put`, `remove`
- **N/log**: Mock `debug`, `audit`, `error`
- **N/llm**: Mock `generate`, `ModelFamily`

### 3. Critical Test Cases

#### Financial Calculations
- Benford's Law digit distribution
- Z-Score calculation with edge cases
- CAGR with zero/negative values
- HHI concentration index
- RFM scoring boundaries
- CLV projections
- Burden rate allocation

#### Security
- SQL injection prevention
- Blocked table access
- Row limit enforcement
- Dangerous operation detection

#### Edge Cases
- Empty result sets
- Missing fiscal calendar
- Zero denominators
- Invalid date formats
- Null entity IDs

---

## Total Functions: ~300

| Priority | Count | Percentage |
|----------|-------|------------|
| P0 - Critical | 89 | 30% |
| P1 - High | 72 | 24% |
| P2 - Medium | 58 | 19% |
| P3 - Low | 21 | 7% |
| Internal (not exported) | ~60 | 20% |

**Recommended Test Coverage Target**: 80%+ for P0/P1 functions
