/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_DashboardCache.js
 * Dashboard Intelligence Layer
 *
 * Transforms raw dashboard data into AI-consumable intelligence objects.
 * Reads extraction configuration from Dashboard Registry - no hardcoded extractors.
 *
 * Features:
 * - Dynamic extraction based on schema paths
 * - Multi-level caching (memory + N/cache)
 * - Collection queries for drill-downs
 * - Automatic insight generation
 * - Alert detection from thresholds
 */
define(['N/cache', 'N/log', '../Lib_Dashboard_Registry'], function(cache, log, DashboardRegistry) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CACHE_NAME = 'ADVISOR_DASHBOARD_INTEL';
    const INTELLIGENCE_TTL = 600;   // 10 minutes
    const REF_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

    // In-memory cache for current request
    let memoryCache = {};

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getCache() {
        return cache.getCache({
            name: CACHE_NAME,
            scope: cache.Scope.PRIVATE
        });
    }

    function generateRefId(dashboardId) {
        let id = '';
        for (let i = 0; i < 6; i++) {
            id += REF_CHARS.charAt(Math.floor(Math.random() * REF_CHARS.length));
        }
        return `dash_${dashboardId.substring(0, 4)}_${id}`;
    }

    /**
     * Navigate nested object by dot-notation path
     * getPath(obj, 'company.cash.endingBalance') → value
     */
    function getPath(obj, path) {
        if (!obj || !path) return undefined;
        return path.split('.').reduce((o, p) => (o && o[p] !== undefined) ? o[p] : undefined, obj);
    }

    /**
     * Set value at nested path
     */
    function setPath(obj, path, value) {
        const parts = path.split('.');
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) current[parts[i]] = {};
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FORMATTING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function formatCurrency(value) {
        if (value === null || value === undefined || isNaN(value)) return 'N/A';
        const absVal = Math.abs(value);
        const sign = value < 0 ? '-' : '';
        if (absVal >= 1000000) return sign + '$' + (absVal / 1000000).toFixed(2) + 'M';
        if (absVal >= 1000) return sign + '$' + (absVal / 1000).toFixed(0) + 'K';
        return sign + '$' + Math.round(absVal).toLocaleString();
    }

    function formatPercent(value) {
        if (value === null || value === undefined || isNaN(value)) return 'N/A';
        return value.toFixed(1) + '%';
    }

    function formatNumber(value) {
        if (value === null || value === undefined || isNaN(value)) return 'N/A';
        if (value === 999) return 'Sustainable';
        return Math.round(value).toLocaleString();
    }

    function formatValue(value, type) {
        switch (type) {
            case 'currency': return formatCurrency(value);
            case 'percent': return formatPercent(value);
            case 'number': return formatNumber(value);
            case 'score': return value !== null ? value + '/100' : 'N/A';
            default: return value !== null && value !== undefined ? String(value) : 'N/A';
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TREND & STATUS CALCULATION
    // ═══════════════════════════════════════════════════════════════════════════

    function calculateTrend(values) {
        if (!Array.isArray(values) || values.length < 2) return null;

        // Filter to numeric values
        const nums = values.filter(v => typeof v === 'number' && !isNaN(v));
        if (nums.length < 2) return null;

        const recent = nums[nums.length - 1];
        const prior = nums[nums.length - 2];

        if (prior === 0) return { direction: 'stable', change: null };

        const change = ((recent - prior) / Math.abs(prior)) * 100;
        return {
            direction: change > 2 ? 'up' : change < -2 ? 'down' : 'stable',
            change: (change >= 0 ? '+' : '') + change.toFixed(1) + '%'
        };
    }

    function calculateStatus(value, thresholds, invertScale) {
        if (value === null || value === undefined || !thresholds) return null;

        // invertScale: for metrics where higher = worse (like risk score)
        if (invertScale) {
            if (thresholds.healthy !== undefined && value <= thresholds.healthy) return 'healthy';
            if (thresholds.warning !== undefined && value <= thresholds.warning) return 'warning';
            return 'danger';
        } else {
            // Normal scale: higher = better
            if (thresholds.danger !== undefined && value < thresholds.danger) return 'danger';
            if (thresholds.warning !== undefined && value < thresholds.warning) return 'warning';
            return 'healthy';
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FORMULA EVALUATION
    // ═══════════════════════════════════════════════════════════════════════════

    function evaluateFormula(formula, metrics) {
        if (!formula || !metrics) return null;

        let result = formula;

        // Replace field names with values
        for (const [name, metric] of Object.entries(metrics)) {
            const regex = new RegExp(`\\b${name}\\b`, 'g');
            const value = metric.value !== undefined ? metric.value : 0;
            result = result.replace(regex, value);
        }

        // Safe evaluation for simple arithmetic
        try {
            // Only allow numbers, operators, parentheses, and spaces
            if (!/^[\d\s+\-*/().]+$/.test(result)) {
                log.debug('DashboardCache', 'Invalid formula characters: ' + result);
                return null;
            }

            // Guard against deeply nested expressions that could cause stack overflow
            const parenDepth = (result.match(/\(/g) || []).length;
            if (parenDepth > 20) {
                log.debug('DashboardCache', 'Formula too deeply nested: ' + parenDepth + ' levels');
                return null;
            }

            const evaluated = Function('"use strict"; return (' + result + ')')();

            // Validate result is a finite number (catches Infinity, -Infinity, NaN)
            if (typeof evaluated !== 'number' || !isFinite(evaluated)) {
                log.debug('DashboardCache', 'Formula produced non-finite result: ' + evaluated);
                return null;
            }

            return evaluated;
        } catch (e) {
            log.debug('DashboardCache', 'Formula eval failed: ' + e.message);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INSIGHT GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    function generateInsights(dashboardId, metrics, schema) {
        const insights = [];

        // Use insight templates from schema
        const templates = schema.extraction?.insightTemplates || [];

        for (const template of templates) {
            try {
                // Evaluate condition
                let condition = template.condition;
                for (const [name, metric] of Object.entries(metrics)) {
                    const regex = new RegExp(`\\b${name}\\b`, 'g');
                    const value = metric.value !== undefined ? metric.value : 0;
                    condition = condition.replace(regex, value);
                }

                // Safe condition evaluation
                if (/^[\d\s+\-*/<>=!&|().]+$/.test(condition)) {
                    const result = Function('"use strict"; return (' + condition + ')')();
                    if (result) {
                        // Replace placeholders in template
                        let insight = template.template;
                        for (const [name, metric] of Object.entries(metrics)) {
                            insight = insight.replace(`{${name}}`, metric.formatted);
                        }
                        insights.push(insight);
                    }
                }
            } catch (e) {
                // Skip invalid template
            }
        }

        // Add generic insights for alerts
        for (const [name, metric] of Object.entries(metrics)) {
            if (metric.status === 'danger') {
                const fieldDef = schema.fields?.[name];
                if (fieldDef && insights.length < 5) {
                    insights.push(`${fieldDef.desc}: ${metric.formatted} [CRITICAL]`);
                }
            }
        }

        return insights.slice(0, 5);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN PROCESSING FUNCTION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Process raw dashboard data into an AI intelligence object
     *
     * @param {string} dashboardId - Dashboard identifier (e.g., 'cashflow')
     * @param {object} rawData - Raw data from dashboard data module
     * @param {string} requestId - Request ID for caching
     * @returns {object} Intelligence object for LLM consumption
     */
    function process(dashboardId, rawData, requestId) {
        const startTime = Date.now();

        // Get schema from registry
        const dashboard = DashboardRegistry.getDashboard(dashboardId);
        if (!dashboard || !dashboard.dataSchema) {
            log.debug('DashboardCache', 'No schema for: ' + dashboardId);
            return {
                dashboard: dashboardId,
                error: 'No schema defined',
                rawData: rawData
            };
        }

        const schema = dashboard.dataSchema;
        const refId = generateRefId(dashboardId);
        const timestamp = Date.now();

        // ═══════════════════════════════════════════════════════════════
        // STEP 1: Extract ALL scalar metrics from schema paths
        // ═══════════════════════════════════════════════════════════════
        const allMetrics = {};
        const computedQueue = []; // Fields with formulas - process after others

        for (const [fieldName, fieldDef] of Object.entries(schema.fields || {})) {
            if (fieldDef.type === 'array') continue; // Handle arrays separately

            // Queue computed fields for later
            if (fieldDef.computed) {
                computedQueue.push({ fieldName, fieldDef });
                continue;
            }

            if (!fieldDef.path) continue; // No path = can't extract

            // Extract value from path
            let value = getPath(rawData, fieldDef.path);

            // Handle null/undefined
            if (value === undefined || value === null) {
                allMetrics[fieldName] = {
                    value: null,
                    formatted: 'N/A',
                    type: fieldDef.type,
                    desc: fieldDef.desc,
                    priority: fieldDef.priority || 2
                };
                continue;
            }

            // Build metric object
            const metric = {
                value: value,
                formatted: formatValue(value, fieldDef.type),
                type: fieldDef.type,
                desc: fieldDef.desc,
                priority: fieldDef.priority || 2
            };

            // Add status if thresholds defined
            if (fieldDef.thresholds && value !== null) {
                const invertScale = fieldDef.type === 'number' &&
                    fieldDef.thresholds.healthy !== undefined &&
                    fieldDef.thresholds.healthy < (fieldDef.thresholds.danger || 0);
                metric.status = calculateStatus(value, fieldDef.thresholds, invertScale);
            }

            // Calculate trend if trendPath defined
            if (fieldDef.trendPath) {
                const trendData = getPath(rawData, fieldDef.trendPath);
                if (Array.isArray(trendData)) {
                    const trend = calculateTrend(trendData);
                    if (trend) {
                        metric.trend = trend.direction;
                        metric.change = trend.change;
                    }
                }
            }

            allMetrics[fieldName] = metric;
        }

        // Process computed fields
        for (const { fieldName, fieldDef } of computedQueue) {
            const value = evaluateFormula(fieldDef.computed, allMetrics);
            allMetrics[fieldName] = {
                value: value,
                formatted: formatValue(value, fieldDef.type),
                type: fieldDef.type,
                desc: fieldDef.desc,
                priority: fieldDef.priority || 2,
                computed: true
            };
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 2: Filter to key metrics only (priority 1)
        // ═══════════════════════════════════════════════════════════════
        const keyMetricNames = schema.extraction?.keyMetrics ||
            Object.entries(schema.fields || {})
                .filter(([_, def]) => def.priority === 1 && def.type !== 'array')
                .map(([name]) => name);

        const keyMetrics = {};
        for (const name of keyMetricNames) {
            if (allMetrics[name]) {
                keyMetrics[name] = allMetrics[name];
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 3: Build collections from array fields
        // ═══════════════════════════════════════════════════════════════
        const collections = {};
        const collectionData = {}; // Full data for caching

        for (const [fieldName, fieldDef] of Object.entries(schema.fields || {})) {
            if (fieldDef.type !== 'array' || !fieldDef.path) continue;

            let items = getPath(rawData, fieldDef.path) || [];
            if (!Array.isArray(items)) items = [];

            const colRefId = refId + '_' + fieldName;

            // Sort if specified
            let sortedItems = items;
            if (fieldDef.sortField && items.length > 0) {
                sortedItems = [...items].sort((a, b) => {
                    const aVal = getPath(a, fieldDef.sortField) || 0;
                    const bVal = getPath(b, fieldDef.sortField) || 0;
                    if (typeof aVal === 'number' && typeof bVal === 'number') {
                        return fieldDef.sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
                    }
                    return fieldDef.sortDirection === 'desc' ?
                        String(bVal).localeCompare(String(aVal)) :
                        String(aVal).localeCompare(String(bVal));
                });
            }

            // Generate preview (top 3 items)
            const preview = sortedItems.slice(0, 3).map(item => {
                const label = fieldDef.labelField ? getPath(item, fieldDef.labelField) : 'Item';
                const value = fieldDef.valueField ? getPath(item, fieldDef.valueField) : null;
                if (value !== null && typeof value === 'number') {
                    return `${label} (${formatCurrency(value)})`;
                }
                return String(label);
            });

            collections[fieldName] = {
                count: items.length,
                refId: colRefId,
                preview: preview,
                columns: Object.keys(fieldDef.itemFields || {}),
                desc: fieldDef.desc
            };

            // Store full data for queries
            collectionData[fieldName] = {
                items: sortedItems,
                labelField: fieldDef.labelField,
                valueField: fieldDef.valueField,
                itemFields: fieldDef.itemFields
            };
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 4: Generate alerts from thresholds
        // ═══════════════════════════════════════════════════════════════
        const alerts = [];
        const alertFields = schema.extraction?.alertFields || [];

        for (const fieldName of alertFields) {
            const metric = allMetrics[fieldName];
            const fieldDef = schema.fields?.[fieldName];

            if (metric && metric.status && metric.status !== 'healthy') {
                alerts.push({
                    type: metric.status,
                    field: fieldName,
                    message: `${fieldDef?.desc || fieldName}: ${metric.formatted}`,
                    value: metric.value
                });
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 5: Generate insights
        // ═══════════════════════════════════════════════════════════════
        const insights = generateInsights(dashboardId, allMetrics, schema);

        // ═══════════════════════════════════════════════════════════════
        // STEP 6: Cache full data for collection queries
        // ═══════════════════════════════════════════════════════════════
        try {
            const cachePayload = {
                dashboardId: dashboardId,
                timestamp: timestamp,
                rawData: rawData,
                allMetrics: allMetrics,
                collections: collectionData
            };

            // Store in N/cache
            getCache().put({
                key: refId,
                value: JSON.stringify(cachePayload),
                ttl: INTELLIGENCE_TTL
            });

            // Also store in memory cache for this request
            memoryCache[refId] = cachePayload;

            log.debug('DashboardCache', {
                action: 'cached',
                refId: refId,
                dashboardId: dashboardId,
                metricsCount: Object.keys(keyMetrics).length,
                collectionsCount: Object.keys(collections).length,
                duration: Date.now() - startTime
            });

        } catch (e) {
            log.error('DashboardCache', 'Cache failed: ' + e.message);
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 7: Return intelligence object
        // ═══════════════════════════════════════════════════════════════
        return {
            dashboard: dashboardId,
            refId: refId,
            timestamp: timestamp,
            metrics: keyMetrics,
            insights: insights,
            alerts: alerts,
            collections: collections,
            schemaHint: schema.summary,
            processingTime: Date.now() - startTime
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COLLECTION QUERY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Load a collection from cache with optional filtering
     */
    function loadCollection(refId, collectionName, options) {
        options = options || {};

        // Extract base refId
        const baseRefId = refId.split('_').slice(0, 3).join('_');

        // Try memory cache first
        let cached = memoryCache[baseRefId];

        // Fall back to N/cache
        if (!cached) {
            try {
                const cacheValue = getCache().get({ key: baseRefId });
                if (cacheValue) {
                    cached = JSON.parse(cacheValue);
                    memoryCache[baseRefId] = cached; // Store in memory
                }
            } catch (e) {
                log.debug('DashboardCache', 'Cache read failed: ' + e.message);
            }
        }

        if (!cached) {
            return {
                success: false,
                error: 'Data expired - please re-fetch dashboard',
                hint: 'Call the dashboard tool again to refresh data'
            };
        }

        const collection = cached.collections?.[collectionName];
        if (!collection) {
            return {
                success: false,
                error: `Collection '${collectionName}' not found`,
                available: Object.keys(cached.collections || {})
            };
        }

        let items = collection.items || [];

        // Apply filter
        if (options.filter && typeof options.filter === 'object') {
            items = items.filter(item => {
                for (const [field, condition] of Object.entries(options.filter)) {
                    const itemValue = getPath(item, field);

                    if (typeof condition === 'object') {
                        // Range/contains filter
                        if (condition.min !== undefined && itemValue < condition.min) return false;
                        if (condition.max !== undefined && itemValue > condition.max) return false;
                        if (condition.equals !== undefined && itemValue !== condition.equals) return false;
                        if (condition.contains !== undefined) {
                            if (!String(itemValue).toLowerCase().includes(String(condition.contains).toLowerCase())) {
                                return false;
                            }
                        }
                    } else {
                        // Exact match
                        if (itemValue !== condition) return false;
                    }
                }
                return true;
            });
        }

        // Apply sort
        if (options.sort && options.sort.field) {
            const { field, direction } = options.sort;
            const dir = direction === 'desc' ? -1 : 1;
            items = [...items].sort((a, b) => {
                const aVal = getPath(a, field);
                const bVal = getPath(b, field);
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return (aVal - bVal) * dir;
                }
                return String(aVal || '').localeCompare(String(bVal || '')) * dir;
            });
        }

        // Store total before limit
        const totalBeforeLimit = items.length;

        // Apply limit
        if (options.limit && options.limit > 0) {
            items = items.slice(0, options.limit);
        }

        // Calculate aggregates on value field
        const valueField = collection.valueField;
        let aggregates = null;

        if (valueField) {
            const values = items.map(i => getPath(i, valueField)).filter(v => typeof v === 'number' && !isNaN(v));
            if (values.length > 0) {
                aggregates = {
                    sum: values.reduce((a, b) => a + b, 0),
                    avg: values.reduce((a, b) => a + b, 0) / values.length,
                    min: Math.min(...values),
                    max: Math.max(...values),
                    count: values.length,
                    formatted: {
                        sum: formatCurrency(values.reduce((a, b) => a + b, 0)),
                        avg: formatCurrency(values.reduce((a, b) => a + b, 0) / values.length)
                    }
                };
            }
        }

        return {
            success: true,
            collection: collectionName,
            totalCount: totalBeforeLimit,
            returnedCount: items.length,
            columns: Object.keys(collection.itemFields || {}),
            items: items,
            aggregates: aggregates
        };
    }

    /**
     * Aggregate a specific field in a collection
     */
    function aggregate(refId, collectionName, field, operation) {
        const result = loadCollection(refId, collectionName, {});
        if (!result.success) return result;

        const values = result.items
            .map(item => getPath(item, field))
            .filter(v => typeof v === 'number' && !isNaN(v));

        if (values.length === 0) {
            return {
                success: true,
                result: null,
                message: 'No numeric values found for field: ' + field
            };
        }

        let value;
        switch ((operation || '').toLowerCase()) {
            case 'sum': value = values.reduce((a, b) => a + b, 0); break;
            case 'avg': value = values.reduce((a, b) => a + b, 0) / values.length; break;
            case 'min': value = Math.min(...values); break;
            case 'max': value = Math.max(...values); break;
            case 'count': value = values.length; break;
            default:
                return { success: false, error: `Unknown operation: ${operation}` };
        }

        return {
            success: true,
            collection: collectionName,
            field: field,
            operation: operation,
            result: value,
            formatted: formatCurrency(value),
            sampleSize: values.length
        };
    }

    /**
     * Get a specific metric from cached data
     */
    function getMetric(refId, metricName) {
        const baseRefId = refId.split('_').slice(0, 3).join('_');

        let cached = memoryCache[baseRefId];
        if (!cached) {
            try {
                const cacheValue = getCache().get({ key: baseRefId });
                if (cacheValue) {
                    cached = JSON.parse(cacheValue);
                }
            } catch (e) {
                return { success: false, error: 'Cache read failed' };
            }
        }

        if (!cached) {
            return { success: false, error: 'Data expired' };
        }

        const metric = cached.allMetrics?.[metricName];
        if (!metric) {
            return {
                success: false,
                error: `Metric '${metricName}' not found`,
                available: Object.keys(cached.allMetrics || {})
            };
        }

        return {
            success: true,
            metric: metricName,
            ...metric
        };
    }

    /**
     * Clear memory cache (call at end of request)
     */
    function clearMemoryCache() {
        memoryCache = {};
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        process: process,
        loadCollection: loadCollection,
        aggregate: aggregate,
        getMetric: getMetric,
        clearMemoryCache: clearMemoryCache,

        // Utility exports for testing
        formatCurrency: formatCurrency,
        formatPercent: formatPercent,
        formatValue: formatValue,
        getPath: getPath
    };
});
