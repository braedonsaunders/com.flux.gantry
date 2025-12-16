# Duplicate Functions Consolidation Plan

## Executive Summary

After scanning the codebase for duplicate function names across 83 reported items, this plan categorizes each into one of four actions:

1. **CONSOLIDATE** - True duplicates that should be unified into a shared utility
2. **KEEP SEPARATE** - Intentionally different implementations (polymorphic pattern or different purposes)
3. **IMPORT FROM EXISTING** - Duplicate code where a canonical version already exists
4. **RENAME FOR CLARITY** - Same name but different purpose; rename to avoid confusion

**Key Finding:** Many "duplicates" are actually well-designed polymorphic patterns in this NetSuite SuiteApp architecture. The `getData()`, `handleRequest()`, and `getScoreOnly()` functions across 8 data libraries are intentional - they implement the same interface with domain-specific logic.

---

## Architecture Context

This is a **NetSuite SuiteApp** using SuiteScript 2.1 with AMD-style `define()` modules:

```
src/FileCabinet/SuiteApps/com.gantry.finance/
├── client/
│   ├── core/Gantry.Core.js          # Client-side utilities
│   ├── dashboards/Dashboard.*.js    # 10 dashboard controllers
│   └── Gantry.AdvisorRenderer.js    # Advisor UI rendering
├── lib/
│   ├── Lib_Core.js                  # Shared backend utilities (PRIMARY TARGET)
│   ├── Lib_Config.js                # Configuration management
│   ├── Lib_*_Data.js                # 8 domain data libraries
│   └── advisor/
│       └── Lib_Advisor_Utils.js     # Advisor utilities (SECONDARY TARGET)
└── suitelet/
    └── Gantry_Router.js             # API router
```

**Existing consolidation points:**
- `Lib_Core.js` - Backend utilities (dates, queries, calculations)
- `Lib_Advisor_Utils.js` - Advisor-specific utilities (formatting, logging)
- `Gantry.Core.js` - Client-side utilities

---

## Priority 1: HIGH - True Duplicates to Consolidate

### 1.1 Logging Functions (debugLog, auditLog)

| Function | Files | Implementation |
|----------|-------|----------------|
| `debugLog` | 4 files | Identical: `if (isDebugMode()) log.debug(title, details)` |
| `auditLog` | 4 files | Identical: `if (isDebugMode()) log.audit(title, details)` |

**Files affected:**
- `Lib_Burden_Data.js:49-55`
- `Lib_Cashflow_Data.js:33-39`
- `Lib_Config.js:40-46`
- `Gantry_Router.js:51-54` (already imports from Utils)

**Action:** Consolidate to `Lib_Advisor_Utils.js` (already exports `debugLog`)
```javascript
// In Lib_Advisor_Utils.js - ensure these are exported:
exports.debugLog = debugLog;
exports.auditLog = auditLog;

// In each file, replace with:
const { debugLog, auditLog } = require('./advisor/Lib_Advisor_Utils');
```

**Effort:** Low | **Risk:** Low | **Lines saved:** ~24

---

### 1.2 escapeHtml Function

| Implementation | Files | Code |
|----------------|-------|------|
| DOM-based | 2 | Uses `document.createElement('div').textContent` |
| Regex (no single-quote) | 4 | Manual entity replacement |
| Regex (with single-quote) | 2 | Includes `&#39;` escape |

**Files affected (8 total):**
- `Gantry.AdvisorRenderer.js:2902` - DOM-based
- `Gantry.Core.js:1066` - DOM-based
- `Dashboard.Burden.js:11483` - Regex
- `Dashboard.Cashflow.js:3830` - Regex + single-quote
- `Dashboard.CustomerValue.js:2516` - Regex + single-quote
- `Dashboard.Health.js:5877` - Regex
- `Dashboard.SpendVelocity.js:3295` - Regex
- `Dashboard.VendorPerformance.js:1974` - Regex

**Action:** Consolidate to `Gantry.Core.js` with the most secure version (single-quote escape)
```javascript
// In Gantry.Core.js - canonical version:
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
```

**Effort:** Medium | **Risk:** Low | **Lines saved:** ~56

---

### 1.3 getDefaultEndDate Function

| Files | Implementation |
|-------|----------------|
| 3 files | Identical: `new Date().toISOString().split('T')[0]` |

**Files affected:**
- `Lib_CustomerValue_Data.js:2523`
- `Lib_Integrity_Data.js:2459`
- `Lib_VendorPerformance_Data.js:1172`

**Action:** Add to `Lib_Core.js`
```javascript
function getDefaultEndDate() {
    return new Date().toISOString().split('T')[0];
}
```

**Effort:** Low | **Risk:** Low | **Lines saved:** ~9

---

### 1.4 mean Calculation

| Files | Implementation |
|-------|----------------|
| 3 files | Identical: `data.reduce((a, b) => a + b, 0) / data.length` |

**Files affected:**
- `Dashboard.Time.js:1141`
- `Lib_Cashflow_Data.js:987`
- `Lib_Health_Data.js:753`

**Action:** Add to `Lib_Core.js`
```javascript
function calculateMean(values) {
    if (!values || values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}
```

**Effort:** Low | **Risk:** Low | **Lines saved:** ~6

---

### 1.5 Herfindahl-Hirschman Index (HHI) Calculation

The `analyzeConcentrationRisk` function appears in 3 files with 70% shared logic:
- `Lib_CustomerValue_Data.js:1667` (207 lines)
- `Lib_SpendVelocity_Data.js:1246` (37 lines)
- `Lib_VendorPerformance_Data.js:850` (42 lines)

**Action:** Extract core HHI calculation to `Lib_Core.js`
```javascript
function calculateHerfindahlIndex(values, total) {
    if (!total || total === 0) return 0;
    return values.reduce((sum, value) => {
        const share = value / total;
        return sum + (share * share);
    }, 0) * 10000; // Scale to standard HHI range
}

function classifyConcentrationRisk(hhi, lowThreshold, highThreshold) {
    if (hhi > highThreshold) return 'high';
    if (hhi > lowThreshold) return 'moderate';
    return 'low';
}
```

**Effort:** Medium | **Risk:** Medium | **Lines saved:** ~50

---

## Priority 2: MEDIUM - Import from Existing Library

### 2.1 Formatting Functions (formatValue, formatPercent, formatCurrency, formatNumber, formatDate)

`Lib_Advisor_Utils.js` already has well-designed versions with options support. Other files should import from it.

| Function | Canonical Location | Files to Update |
|----------|-------------------|-----------------|
| `formatValue` | `Lib_Advisor_Utils.js:542` | `Gantry.AdvisorRenderer.js:2784` |
| `formatPercent` | `Lib_Advisor_Utils.js:465` | `Gantry.AdvisorRenderer.js:2865` |
| `formatCurrency` | `Lib_Advisor_Utils.js:437` | See note below |
| `formatNumber` | `Lib_Advisor_Utils.js:479` | `Gantry.AdvisorRenderer.js:2873`, `Lib_VendorPerformance_Data.js:1181` |
| `formatDate` | `Lib_Advisor_Utils.js:505` | `Gantry.AdvisorRenderer.js:2884`, `Lib_SpendVelocity_Data.js:2041` |

**Note on formatCurrency:** Four different implementations exist with different behaviors:
- `Gantry.AdvisorRenderer.js` wraps negatives in HTML `<span class="negative">`
- `Lib_Advisor_Utils.js` supports options object (most flexible)
- `Lib_CustomerValue_Data.js` uses K/M suffixes differently
- `Lib_SpendVelocity_Data.js` is extremely simple

**Recommendation:** Keep `Gantry.AdvisorRenderer.js` version for UI (needs HTML wrapping), standardize backend files on `Lib_Advisor_Utils.js` version.

**Effort:** Medium | **Risk:** Low

---

### 2.2 Model Registry Functions

| Function | Keep | Update |
|----------|------|--------|
| `getCuratedOpenRouterModels` | `Lib_Model_Registry.js:610` | `Dashboard.Settings.js:1113` |
| `getModelForTier` | `Lib_Model_Registry.js:1085` | Already correct - AIProviders wraps it |
| `getModelDisplayInfo` | `Lib_Model_Registry.js:1138` | Already correct - AIProviders wraps it |

**Action:** Update `Dashboard.Settings.js` to use `ModelRegistry.getCuratedOpenRouterModels()` and map fields for dropdown.

**Effort:** Low | **Risk:** Low

---

### 2.3 Permissions Functions

| Function | Keep | Update |
|----------|------|--------|
| `getDefaultPermissions` | `Lib_Permissions.js:46` | `Dashboard.Settings.js:1787` |
| `savePermissions` | Both (client vs server) | Verify API uses lib |

**Action:** `Dashboard.Settings.js` should import `getDefaultPermissions` from `Lib_Permissions.js`. The `savePermissions` functions are intentionally different (client-side async vs server-side sync).

**Effort:** Low | **Risk:** Low

---

### 2.4 evaluateFormula Function

| File | Implementation |
|------|----------------|
| `Gantry.AdvisorRenderer.js:1554` | Simple regex split on +/- |
| `Lib_Advisor_Cache.js:1173` | Full formula evaluation with validation |

**Action:** Keep `Lib_Advisor_Cache.js` version (more secure with validation). Update renderer to use it or simplify its needs.

**Effort:** Low | **Risk:** Low

---

## Priority 3: LOW - Rename for Clarity

### 3.1 calculateTrend Function

| File | Purpose | Suggested Name |
|------|---------|----------------|
| `Lib_Burden_Data.js:3628` | Full linear regression | `calculateLinearRegression` |
| `Lib_Advisor_Cache.js:1143` | Simple percent change | `calculatePercentChange` |

**Action:** Rename to clarify different algorithms.

---

### 3.2 detectAnomalies Function

| File | Purpose | Suggested Name |
|------|---------|----------------|
| `Dashboard.Time.js:1161` | Employee utilization anomalies | `detectEmployeeAnomalies` |
| `Lib_Health_Data.js:857` | Financial health anomalies | `detectFinancialAnomalies` |

**Action:** Rename to clarify different domains.

---

### 3.3 variance Function

| File | Purpose | Suggested Name |
|------|---------|----------------|
| `Lib_Core.js:935` | Financial variance (actual vs baseline) | Keep as `variance` |
| `Dashboard.Time.js:1139` | Statistical variance for std dev | `statisticalVariance` or inline |
| `Lib_Cashflow_Data.js:988` | Statistical variance for std dev | Use `Lib_Health_Data.calculateStdDev` |
| `Lib_Health_Data.js:754` | Statistical variance (internal) | Keep internal |

**Action:** Keep `Lib_Core.js` financial variance. Consider extracting `calculateStdDev` helper for statistical use.

---

## Priority 4: NO ACTION - Intentional Polymorphism

These functions are **correctly designed** as polymorphic implementations. Do NOT consolidate.

### 4.1 Data Library Interface Functions (8 files each)

| Function | Purpose | Pattern |
|----------|---------|---------|
| `getData` | Load and analyze domain data | Each module fetches different data types |
| `handleRequest` | Route domain-specific subActions | Each module has different operations |
| `getScoreOnly` | Quick health/risk score | Each calculates domain-specific metrics |

**Files:** `Lib_Burden_Data.js`, `Lib_Cashflow_Data.js`, `Lib_CustomerValue_Data.js`, `Lib_Health_Data.js`, `Lib_Integrity_Data.js`, `Lib_SpendVelocity_Data.js`, `Lib_Time_Data.js`, `Lib_VendorPerformance_Data.js`

**Why keep:** This is excellent architecture - same interface, different implementations enables:
- Generic dashboard loading in router
- Plugin-style extensibility
- Clear module contracts

---

### 4.2 Dashboard Initialization Functions

| Function | Files | Reason to Keep |
|----------|-------|----------------|
| `init` | 3 | Dashboard-specific initialization |
| `setupUI` | 2 | Different UI components |
| `showLoadingState` | 2 | Different DOM structures |
| `loadData` | 3 | Different data sources |
| `render` | 3 | Different rendering logic |
| `loadConfig`/`saveConfig` | 2 each | Different config schemas |

---

### 4.3 Transaction Query Functions

| Function | Files | Why Keep Separate |
|----------|-------|-------------------|
| `getAccountTransactions` | 3 | Different pagination, filtering, return formats |
| `getVendorTransactions` | 3 | Different row limits (100 vs 2000), transaction types |

**Potential partial consolidation:** Extract base query to `Lib_Core.js` with options, keep thin wrappers in each file.

---

### 4.4 Config Functions

| Function | Files | Why Keep Separate |
|----------|-------|-------------------|
| `getDefaultStartDate` | 3 | Different defaults (1 year vs 3 months) |
| `getDefaultConfig` | 4 | Different config schemas per domain |
| `getConfigForApi` | 3 | Different signatures and purposes |

---

### 4.5 UI Helper Functions

| Function | Files | Why Keep Separate |
|----------|-------|-------------------|
| `showToast` | 2 | Different DOM strategies (create vs existing element) |
| `sortIcon` | 3 | Different return types (HTML vs class name) |
| `renderList` | 2 | Different list structures |

---

### 4.6 Local Variable Names (False Positives)

These are local variables, not functions to consolidate:

| Name | Files | Type |
|------|-------|------|
| `values` | 7 | Local array variables |
| `points` | 2 | Chart data arrays |
| `labels` | 3 | Chart label arrays |
| `colors` | 2 | Chart color arrays |
| `sorted` | 6 | Sorted result arrays |
| `amounts` | 3 | Amount arrays |
| `sum` | 4 | Accumulator variables |
| `total` | 2 | Total calculations |
| `totalAmount` | 3 | Amount totals |
| `totalPaid` | 2 | Payment totals |
| `totalHours` | 2 | Hour totals |
| `totalRevenue` | 2 | Revenue totals |
| `revenues` | 2 | Revenue arrays |
| `monthly` | 2 | Monthly data |
| `accountIds` | 2 | Account ID arrays |
| `existingIdx` | 2 | Index variables |
| `el` | 2 | DOM element helpers |
| `fmtNum` | 2 | Number format helpers |
| `cfg` | 2 | Config objects |
| `order` | 2 | Sort order |
| `profile` | 2 | Profile objects |
| `types` | 2 | Type arrays |
| `summaries` | 2 | Summary objects |

---

### 4.7 Framework/Pattern Functions

| Function | Files | Type |
|----------|-------|------|
| `define` | 11 | AMD module definition (SuiteScript pattern) |
| `function` | 3 | IIFE pattern artifacts |
| `setTimeout` | 4 | Standard JS function usage |
| `onRequest` | 2 | SuiteScript entry point pattern |

---

## Implementation Phases

### Phase 1: Quick Wins (Week 1)
**Effort: Low | Risk: Low | Impact: High**

1. [ ] Add `calculateMean()` to `Lib_Core.js`
2. [ ] Add `getDefaultEndDate()` to `Lib_Core.js`
3. [ ] Export `auditLog` from `Lib_Advisor_Utils.js`
4. [ ] Update `Lib_Burden_Data.js`, `Lib_Cashflow_Data.js`, `Lib_Config.js` to import logging functions
5. [ ] Update `Dashboard.Settings.js` to import `getDefaultPermissions` from `Lib_Permissions.js`

### Phase 2: Formatting Consolidation (Week 2)
**Effort: Medium | Risk: Low | Impact: Medium**

1. [ ] Consolidate `escapeHtml` to `Gantry.Core.js` with single-quote escape
2. [ ] Update 7 dashboard files to use consolidated `escapeHtml`
3. [ ] Update formatting function imports in backend files to use `Lib_Advisor_Utils.js`
4. [ ] Update `Dashboard.Settings.js` to use `ModelRegistry.getCuratedOpenRouterModels()`

### Phase 3: Algorithm Extraction (Week 3)
**Effort: Medium | Risk: Medium | Impact: Medium**

1. [ ] Add `calculateHerfindahlIndex()` to `Lib_Core.js`
2. [ ] Refactor `analyzeConcentrationRisk` in 3 files to use shared HHI function
3. [ ] Consider extracting `calculateStdDev()` helper for statistical calculations

### Phase 4: Clarity Renames (Week 4)
**Effort: Low | Risk: Low | Impact: Low**

1. [ ] Rename `calculateTrend` → `calculateLinearRegression` in `Lib_Burden_Data.js`
2. [ ] Rename `calculateTrend` → `calculatePercentChange` in `Lib_Advisor_Cache.js`
3. [ ] Rename `detectAnomalies` → `detectEmployeeAnomalies` in `Dashboard.Time.js`
4. [ ] Rename `detectAnomalies` → `detectFinancialAnomalies` in `Lib_Health_Data.js`

---

## Summary Statistics

| Category | Count | Action |
|----------|-------|--------|
| True duplicates to consolidate | 12 functions | CONSOLIDATE |
| Import from existing library | 8 functions | IMPORT |
| Rename for clarity | 4 functions | RENAME |
| Intentional polymorphism (keep) | 15+ functions | NO ACTION |
| Local variables (false positives) | 25+ items | NO ACTION |
| Framework patterns | 4 items | NO ACTION |

**Estimated code reduction:** ~150-200 lines
**Risk level:** Low to Medium
**Testing required:** Regression testing on affected dashboards after each phase

---

## Files Modified Summary

### Primary Targets (add shared functions):
- `Lib_Core.js` - Add `calculateMean`, `getDefaultEndDate`, `calculateHerfindahlIndex`
- `Lib_Advisor_Utils.js` - Ensure `auditLog` exported
- `Gantry.Core.js` - Consolidate `escapeHtml`

### Files to Update (import shared functions):
- `Lib_Burden_Data.js` - Import logging, use HHI helper
- `Lib_Cashflow_Data.js` - Import logging
- `Lib_Config.js` - Import logging
- `Lib_CustomerValue_Data.js` - Use HHI helper, getDefaultEndDate
- `Lib_Integrity_Data.js` - Use getDefaultEndDate
- `Lib_VendorPerformance_Data.js` - Use HHI helper, getDefaultEndDate, formatNumber
- `Lib_SpendVelocity_Data.js` - Use HHI helper, formatDate
- `Dashboard.Burden.js` - Import escapeHtml
- `Dashboard.Cashflow.js` - Import escapeHtml
- `Dashboard.CustomerValue.js` - Import escapeHtml
- `Dashboard.Health.js` - Import escapeHtml
- `Dashboard.SpendVelocity.js` - Import escapeHtml
- `Dashboard.VendorPerformance.js` - Import escapeHtml
- `Dashboard.Settings.js` - Import getDefaultPermissions, getCuratedOpenRouterModels
- `Dashboard.Time.js` - Use calculateMean, rename detectAnomalies
- `Gantry.AdvisorRenderer.js` - Import formatting functions from Lib_Advisor_Utils
