# Proposal: World-Class Dashboard Data Architecture for AI Advisor

## Executive Summary

Transform how the AI advisor consumes dashboard data from a naive "dump everything" approach to an intelligent, semantic extraction layer that provides **instant insights** with **on-demand deep-dives** - reducing token usage by 90% while maintaining full data fidelity.

---

## Current State Analysis

### How It Works Today

```
User Question
    ↓
LLM calls dashboard_cashflow()
    ↓
CashflowData.getData() executes (2487 lines of logic)
    ↓
Returns ~100KB nested JSON object
    ↓
formatResultForLLM() dumps entire JSON to prompt
    ↓
LLM parses 15,000+ tokens just for dashboard data
    ↓
LLM extracts the 3-5 values it actually needs
```

### Current Pain Points

1. **Token Waste**: Full dashboard JSON = 10,000-20,000 tokens per tool call
2. **Slow Response**: LLM must process massive context before answering
3. **No Semantic Understanding**: LLM receives raw data, must figure out what matters
4. **DataStore Mismatch**: Existing DataStore designed for tabular data, not nested objects
5. **No Caching Between Questions**: Each question re-fetches full dashboard

### Current DataStore Limitations

The existing `Lib_Advisor_DataStore.js` is well-designed but:
- Assumes tabular data with `rows[]` arrays
- Can't handle nested dashboard objects like `company.metrics.range.revenue`
- Summary generation is generic, not dashboard-aware
- No semantic extraction of key business metrics

---

## Proposed Architecture: "Dashboard Intelligence Layer"

### Core Innovation: Semantic Data Extraction

Instead of passing raw dashboard data to the LLM, we create an intelligent extraction layer that:

1. **Pre-extracts key metrics** the LLM will likely need
2. **Generates natural language summaries** of the data state
3. **Creates queryable references** for deep-dives
4. **Caches intelligently** at multiple levels

### New Component: `Lib_Advisor_DashboardCache.js`

```javascript
/**
 * Dashboard Intelligence Layer
 *
 * Transforms raw dashboard data into AI-consumable intelligence:
 * 1. Extracts key metrics into a compact format
 * 2. Generates natural language insights
 * 3. Creates queryable data references
 * 4. Caches at multiple levels for efficiency
 */

// ═══════════════════════════════════════════════════════════════════════════
// ARCHITECTURE OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FLOW:
 *
 * dashboard_cashflow()
 *     ↓
 * DashboardCache.process('cashflow', rawData)
 *     ↓
 * ┌─────────────────────────────────────────────┐
 * │ 1. Extract Key Metrics (10-15 values)       │
 * │ 2. Generate AI Summary (2-3 sentences)      │
 * │ 3. Create Queryable Collections             │
 * │ 4. Store in Multi-Level Cache               │
 * └─────────────────────────────────────────────┘
 *     ↓
 * Return DashboardIntelligence object to LLM
 *     ↓
 * LLM receives ~500 tokens instead of 15,000+
 */
```

---

## Detailed Design

### 1. Dashboard Intelligence Object

What the LLM receives instead of raw JSON:

```javascript
{
    // Identity
    dashboard: 'cashflow',
    refId: 'cash_a7x9p2',
    timestamp: 1702400000000,

    // ═══ KEY METRICS (what LLM needs 90% of the time) ═══
    metrics: {
        totalCash: { value: 2450000, formatted: '$2.45M', trend: 'up', change: '+5.2%' },
        runwayDays: { value: 127, formatted: '127 days', status: 'healthy' },
        burnRate: { value: -85000, formatted: '$85K/mo', trend: 'stable' },
        totalAR: { value: 1200000, formatted: '$1.2M', aging: { current: '65%', overdue: '35%' } },
        totalAP: { value: 450000, formatted: '$450K', dueSoon: '$125K in 7 days' },
        netPosition: { value: 3200000, formatted: '$3.2M' }
    },

    // ═══ AI-READY INSIGHTS (pre-generated for immediate use) ═══
    insights: [
        "Cash position is strong at $2.45M with 127 days runway",
        "AR aging shows 35% overdue - $420K needs collection attention",
        "Upcoming AP of $125K due within 7 days",
        "Cash trend is positive, up 5.2% from last month"
    ],

    // ═══ ALERT FLAGS (immediate attention items) ═══
    alerts: [
        { type: 'warning', message: 'AR > 90 days: $180K at risk', metric: 'arOver90' }
    ],

    // ═══ QUERYABLE COLLECTIONS (for deep-dives) ═══
    collections: {
        bankAccounts: {
            count: 4,
            refId: 'cash_a7x9p2_banks',
            preview: ['Operating (1,800K)', 'Payroll (400K)', 'Reserve (250K)'],
            queryHint: 'Use LOAD_COLLECTION for full bank account details'
        },
        arByCustomer: {
            count: 45,
            refId: 'cash_a7x9p2_ar',
            preview: ['Acme Corp ($450K)', 'TechFlow ($320K)', 'DataSync ($180K)'],
            queryHint: 'Use LOAD_COLLECTION for customer AR breakdown'
        },
        apByVendor: {
            count: 28,
            refId: 'cash_a7x9p2_ap',
            preview: ['AWS ($120K)', 'Oracle ($85K)', 'Salesforce ($45K)'],
            queryHint: 'Use LOAD_COLLECTION for vendor AP breakdown'
        },
        weeklyProjection: {
            count: 12,
            refId: 'cash_a7x9p2_weeks',
            preview: ['Week 1: $2.4M', 'Week 4: $2.1M', 'Week 8: $1.9M'],
            queryHint: 'Use LOAD_COLLECTION for weekly cash projection'
        }
    },

    // ═══ COMMANDS (how LLM can get more data) ═══
    commands: {
        loadCollection: 'LOAD_COLLECTION(refId, [filters])',
        getMetricDetail: 'GET_METRIC_DETAIL(refId, metricName)',
        compareToLast: 'COMPARE_TO_LAST(refId, period)',
        aggregate: 'AGGREGATE(collectionRef, field, operation)'
    }
}
```

### 2. Dashboard-Specific Extractors

Each dashboard gets a custom extractor that understands its data structure:

```javascript
const DASHBOARD_EXTRACTORS = {

    cashflow: {
        // Key metrics to always extract
        keyMetrics: [
            { path: 'company.cash.endingBalance', name: 'totalCash', type: 'currency' },
            { path: 'runway.days', name: 'runwayDays', type: 'number', statusThresholds: { danger: 30, warning: 60, healthy: 90 } },
            { path: 'runway.monthlyBurn', name: 'burnRate', type: 'currency', invert: true },
            { path: 'company.ar.total', name: 'totalAR', type: 'currency' },
            { path: 'company.ap.total', name: 'totalAP', type: 'currency' }
        ],

        // Collections that can be queried
        collections: [
            { path: 'company.bankAccounts', name: 'bankAccounts', idField: 'id', labelField: 'name', valueField: 'balance' },
            { path: 'company.ar.byCustomer', name: 'arByCustomer', idField: 'customerId', labelField: 'customerName', valueField: 'balance' },
            { path: 'company.ap.byVendor', name: 'apByVendor', idField: 'vendorId', labelField: 'vendorName', valueField: 'balance' },
            { path: 'company.weeklyCash', name: 'weeklyProjection', idField: 'weekLabel', valueField: 'endingCash' }
        ],

        // Custom insight generators
        generateInsights: function(data, metrics) {
            const insights = [];

            // Cash position insight
            const cashStatus = metrics.runwayDays.value > 90 ? 'strong' : metrics.runwayDays.value > 60 ? 'adequate' : 'concerning';
            insights.push(`Cash position is ${cashStatus} at ${metrics.totalCash.formatted} with ${metrics.runwayDays.formatted} runway`);

            // AR aging insight
            const arOverdue = (data.company?.ar?.aging31to60 || 0) + (data.company?.ar?.aging61to90 || 0) + (data.company?.ar?.agingOver90 || 0);
            const arTotal = metrics.totalAR.value || 1;
            const overduePercent = Math.round((arOverdue / arTotal) * 100);
            if (overduePercent > 20) {
                insights.push(`AR aging shows ${overduePercent}% overdue - ${formatCurrency(arOverdue)} needs collection attention`);
            }

            // Upcoming AP insight
            const apDueSoon = data.company?.ap?.dueSoon || 0;
            if (apDueSoon > 50000) {
                insights.push(`Upcoming AP of ${formatCurrency(apDueSoon)} due within 7 days`);
            }

            return insights;
        }
    },

    health: {
        keyMetrics: [
            { path: 'company.healthScore', name: 'healthScore', type: 'score', thresholds: { danger: 40, warning: 60, healthy: 75 } },
            { path: 'company.metrics.range.revenue', name: 'revenueYTD', type: 'currency' },
            { path: 'company.metrics.range.gm', name: 'grossMargin', type: 'currency' },
            { path: 'company.metrics.range.gmPct', name: 'gmPercent', type: 'percent' },
            { path: 'company.metrics.range.opex', name: 'expenses', type: 'currency' },
            { path: 'company.yoy.revenueDeltaPct', name: 'revenueGrowth', type: 'percent' }
        ],

        collections: [
            { path: 'departments', name: 'byDepartment', idField: 'department.netsuiteId', labelField: 'department.name', valueField: 'metrics.range.revenue' },
            { path: 'monthlyTrend', name: 'monthlyTrend', idField: 'month', valueField: 'revenue' },
            { path: 'topMovers', name: 'topMovers', labelField: 'name', valueField: 'change' }
        ],

        generateInsights: function(data, metrics) {
            const insights = [];
            const grade = getHealthGrade(metrics.healthScore.value);
            insights.push(`Financial health score: ${metrics.healthScore.value}/100 (${grade})`);
            insights.push(`YTD Revenue: ${metrics.revenueYTD.formatted} with ${metrics.gmPercent.formatted} gross margin`);
            if (metrics.revenueGrowth.value) {
                const direction = metrics.revenueGrowth.value > 0 ? 'up' : 'down';
                insights.push(`Revenue is ${direction} ${Math.abs(metrics.revenueGrowth.value)}% vs last year`);
            }
            return insights;
        }
    },

    // ... similar extractors for all 8 dashboards
};
```

### 3. Multi-Level Caching Strategy

```javascript
/**
 * CACHE ARCHITECTURE
 *
 * Level 1: In-Memory (per request) - Instant access
 * Level 2: N/Cache PRIVATE (per session) - 10 min TTL
 * Level 3: N/Cache PUBLIC (cross-session) - 5 min TTL for shared data
 */

const CACHE_CONFIG = {
    levels: {
        memory: {
            // In-request cache for repeated accesses
            enabled: true,
            maxItems: 50
        },
        session: {
            // Per-user session cache
            cacheName: 'ADVISOR_DASHBOARD_SESSION',
            scope: 'PRIVATE',
            ttl: 600  // 10 minutes
        },
        shared: {
            // Cross-user cache for expensive computations
            cacheName: 'ADVISOR_DASHBOARD_SHARED',
            scope: 'PUBLIC',
            ttl: 300  // 5 minutes
        }
    },

    // What to cache at each level
    cacheStrategy: {
        // Full dashboard data - session level (user-specific filters)
        fullData: 'session',

        // Extracted intelligence - session level
        intelligence: 'session',

        // Collections (for deep-dives) - session level
        collections: 'session',

        // Aggregated metrics (no user-specific data) - shared level
        aggregates: 'shared'
    }
};
```

### 4. Collection Query System

When LLM needs more detail, it can query collections:

```javascript
/**
 * LOAD_COLLECTION command handler
 *
 * Allows LLM to drill into specific data subsets without
 * re-fetching entire dashboard.
 */
function loadCollection(requestId, collectionRef, options = {}) {
    const { refId, collectionName } = parseCollectionRef(collectionRef);
    const cachedData = loadFromCache(requestId, refId);

    if (!cachedData) {
        return { error: 'Data expired, re-fetch dashboard' };
    }

    const collection = cachedData.collections[collectionName];
    if (!collection) {
        return { error: `Unknown collection: ${collectionName}` };
    }

    // Apply optional filters
    let items = collection.items;

    if (options.filter) {
        items = items.filter(item => evaluateFilter(item, options.filter));
    }

    if (options.sort) {
        items = sortBy(items, options.sort.field, options.sort.direction);
    }

    if (options.limit) {
        items = items.slice(0, options.limit);
    }

    // Format for LLM consumption
    return {
        collection: collectionName,
        totalCount: collection.items.length,
        returnedCount: items.length,
        items: items.map(item => ({
            id: item.id,
            label: item.label,
            value: item.value,
            formatted: formatValue(item.value, collection.valueType)
        })),

        // Pre-computed aggregates
        aggregates: {
            sum: items.reduce((a, b) => a + (b.value || 0), 0),
            avg: items.reduce((a, b) => a + (b.value || 0), 0) / items.length,
            max: Math.max(...items.map(i => i.value || 0)),
            min: Math.min(...items.map(i => i.value || 0))
        }
    };
}
```

### 5. Integration with Agent

```javascript
// In Lib_Advisor_Tools.js - Modified dashboard tool

dashboard_cashflow: {
    name: 'dashboard_cashflow',
    description: `Get treasury/cashflow intelligence including:
- Key metrics: cash position, runway, burn rate, AR/AP totals
- Pre-generated insights about financial state
- Queryable collections for deep-dives into bank accounts, customers, vendors
- Alerts for items needing attention

Returns a compact intelligence object (~500 tokens) instead of full data.
For detailed breakdowns, use LOAD_COLLECTION command.`,

    execute: function(args) {
        try {
            // Check cache first
            const cached = DashboardCache.get('cashflow', args);
            if (cached) {
                return cached;
            }

            // Fetch full data
            const rawData = CashflowData.getData(args);

            // Process through intelligence layer
            const intelligence = DashboardCache.process('cashflow', rawData, args);

            return {
                success: true,
                dashboard: 'cashflow',
                intelligence: intelligence,
                tool: 'dashboard_cashflow'
            };

        } catch (e) {
            log.error('dashboard_cashflow failed', { error: e.message });
            return { success: false, error: e.message };
        }
    }
}
```

### 6. Modified formatResultForLLM

```javascript
function formatResultForLLM(result, toolName) {
    // ... existing handling for other tools ...

    // Dashboard intelligence - compact format
    if (result.intelligence) {
        const intel = result.intelligence;
        const lines = [];

        lines.push(`═══ DASHBOARD: ${intel.dashboard.toUpperCase()} ═══`);
        lines.push(`Reference: ${intel.refId} | Updated: ${new Date(intel.timestamp).toLocaleTimeString()}`);
        lines.push('');

        // Key Metrics (what LLM needs most)
        lines.push('KEY METRICS:');
        for (const [name, metric] of Object.entries(intel.metrics)) {
            let line = `  ${name}: ${metric.formatted}`;
            if (metric.trend) line += ` (${metric.trend}${metric.change ? ' ' + metric.change : ''})`;
            if (metric.status) line += ` [${metric.status}]`;
            lines.push(line);
        }
        lines.push('');

        // AI-Ready Insights
        lines.push('INSIGHTS:');
        intel.insights.forEach(insight => lines.push(`  • ${insight}`));
        lines.push('');

        // Alerts (if any)
        if (intel.alerts && intel.alerts.length > 0) {
            lines.push('ALERTS:');
            intel.alerts.forEach(alert => lines.push(`  ⚠️ ${alert.message}`));
            lines.push('');
        }

        // Available Collections
        lines.push('AVAILABLE DATA (use LOAD_COLLECTION for details):');
        for (const [name, col] of Object.entries(intel.collections)) {
            lines.push(`  • ${name}: ${col.count} items - ${col.preview.slice(0, 3).join(', ')}...`);
        }

        return lines.join('\n');
    }
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Priority)

1. **Create `Lib_Advisor_DashboardCache.js`**
   - Multi-level caching system
   - Dashboard intelligence object structure
   - Collection storage and retrieval

2. **Create Dashboard Extractors**
   - Start with cashflow and health (most used)
   - Define key metrics for each
   - Build insight generators

3. **Add LOAD_COLLECTION Tool**
   - New tool for LLM to query collections
   - Filter, sort, limit capabilities
   - Pre-computed aggregates

### Phase 2: Integration

4. **Modify Dashboard Tools**
   - Route through DashboardCache.process()
   - Return intelligence objects
   - Cache full data for collection queries

5. **Update formatResultForLLM**
   - Handle intelligence objects
   - Generate compact, readable format
   - Include collection hints

### Phase 3: Optimization

6. **Add Remaining Dashboard Extractors**
   - burden, time, integrity, vendorperformance
   - customervalue, spendvelocity

7. **Implement Cross-Question Caching**
   - Detect related questions
   - Reuse cached dashboard data
   - TTL management

8. **Add Metrics and Monitoring**
   - Token usage tracking
   - Cache hit rates
   - Response time improvements

---

## Expected Improvements

### Token Usage

| Scenario | Before | After | Reduction |
|----------|--------|-------|-----------|
| Single dashboard query | 15,000 tokens | 500 tokens | 97% |
| Multi-dashboard query | 45,000 tokens | 1,500 tokens | 97% |
| Follow-up question | 15,000 tokens | 200 tokens (cache) | 99% |

### Response Time

| Scenario | Before | After | Improvement |
|----------|--------|-------|-------------|
| First dashboard access | 3-5s | 2-3s | 40% |
| Follow-up with same data | 3-5s | 0.1s | 98% |
| Deep-dive query | 3-5s | 0.2s | 96% |

### AI Quality

- **Faster responses**: Less data to parse
- **Better focus**: Key metrics highlighted
- **Actionable insights**: Pre-generated for immediate use
- **Consistent answers**: Same extraction logic every time

---

## New File Structure

```
lib/advisor/
├── Lib_Advisor_DashboardCache.js      # NEW: Core caching & intelligence layer
├── Lib_Advisor_DashboardExtractors.js # NEW: Dashboard-specific extractors
├── Lib_Advisor_CollectionQuery.js     # NEW: Collection query handler
├── Lib_Advisor_Tools.js               # MODIFIED: Use intelligence layer
├── Lib_Advisor_Agent.js               # MODIFIED: formatResultForLLM updates
└── Lib_Advisor_DataStore.js           # EXISTING: Keep for tabular data
```

---

## Alternative Approaches Considered

### Option A: Just Truncate Data (Rejected)
- Simple but loses data fidelity
- LLM can't access details when needed
- Doesn't solve the root problem

### Option B: Streaming Data (Rejected)
- Complex implementation
- NetSuite N/Cache doesn't support streaming
- Over-engineered for the use case

### Option C: Semantic Extraction (Selected)
- Matches how humans would summarize data
- Preserves full data for deep-dives
- Leverages domain knowledge about each dashboard
- Progressive disclosure pattern

---

## Success Metrics

1. **Token Reduction**: 90%+ reduction in dashboard-related tokens
2. **Cache Hit Rate**: >80% for follow-up questions
3. **Response Quality**: Maintained or improved answer accuracy
4. **Response Speed**: 50%+ faster for multi-question sessions

---

## Next Steps

1. Review and approve this proposal
2. Create `Lib_Advisor_DashboardCache.js` with cashflow extractor
3. Integrate with `dashboard_cashflow` tool as proof of concept
4. Measure token usage and response quality
5. Roll out to remaining dashboards

---

*This architecture transforms the AI advisor from a brute-force data processor into an intelligent financial analyst that knows what matters and can dig deeper when needed.*
