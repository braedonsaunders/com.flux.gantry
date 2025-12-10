/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_DashboardHandler.js
 * Dashboard handling and interpretation for the Advisor module
 * 
 * Contains:
 * - Dashboard data fetching
 * - Dashboard caching
 * - Dashboard interpretation
 * - Summarization for agent
 */
define([
    'N/log',
    './Lib_Advisor_AIProviders',
    './Lib_Advisor_Prompts',
    './Lib_Advisor_ResponseBuilder',
    './Lib_Advisor_ToolDefinitions',
    './Lib_Advisor_Utils',
    '../Lib_Dashboard_Registry',
    '../Lib_Burden_Data',
    '../Lib_Cashflow_Data',
    '../Lib_Health_Data',
    '../Lib_Time_Data',
    '../Lib_Integrity_Data',
    '../Lib_VendorPerformance_Data',
    '../Lib_CustomerValue_Data',
    '../Lib_SpendVelocity_Data'
], function(log, AIProviders, Prompts, ResponseBuilder, ToolDefinitions, Utils, DashboardRegistry, BurdenData, CashflowData, HealthData, TimeData, IntegrityData, VendorPerformanceData, CustomerValueData, SpendVelocityData) {
    'use strict';

    const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
    const DASHBOARD_CACHE_MAX_SIZE = 20;

    /**
     * REQUEST-SCOPED cache for dashboard data with size limit
     * NOTE: In NetSuite's stateless architecture, this cache is reset on every HTTP request.
     * It's only useful for caching data within a single multi-step agent execution,
     * avoiding duplicate fetches during the same request. For persistent caching
     * across requests, use N/cache module instead.
     */
    const dashboardCache = {};

    function getCachedDashboardData(dashboardId, context) {
        const cacheKey = dashboardId + '_' + (context?.fiscalYearStart || 'default');
        const cached = dashboardCache[cacheKey];
        
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
            log.debug('Dashboard cache hit', { dashboardId: dashboardId, age: Date.now() - cached.timestamp });
            return cached.data;
        }
        
        return null;
    }

    function setCachedDashboardData(dashboardId, context, data) {
        const cacheKey = dashboardId + '_' + (context?.fiscalYearStart || 'default');
        
        // Enforce cache size limit - remove oldest entries if at capacity
        const keys = Object.keys(dashboardCache);
        if (keys.length >= DASHBOARD_CACHE_MAX_SIZE) {
            let oldestKey = keys[0];
            let oldestTime = dashboardCache[oldestKey].timestamp;
            for (const key of keys) {
                if (dashboardCache[key].timestamp < oldestTime) {
                    oldestTime = dashboardCache[key].timestamp;
                    oldestKey = key;
                }
            }
            delete dashboardCache[oldestKey];
        }
        
        dashboardCache[cacheKey] = {
            data: data,
            timestamp: Date.now()
        };
    }

    /**
     * Dashboard data fetchers (map ID to getData function)
     * The configuration comes from DashboardRegistry, but we need runtime bindings here
     * Note: Some libraries export 'analyze' instead of 'getData'
     */
    const DASHBOARD_DATA_FETCHERS = {
        burden: BurdenData.getData,
        cashflow: CashflowData.getData,
        health: HealthData.getData,
        time: TimeData.getData,
        integrity: IntegrityData.getData,
        vendorperformance: VendorPerformanceData.analyze,
        customervalue: CustomerValueData.analyze,
        spendvelocity: SpendVelocityData.getData
    };

    /**
     * Get dashboard info and data fetcher
     */
    function getDashboardWithFetcher(dashboardId) {
        const dashboardConfig = DashboardRegistry.getDashboard(dashboardId);
        if (!dashboardConfig) return null;
        
        return {
            ...dashboardConfig,
            getData: DASHBOARD_DATA_FETCHERS[dashboardId] || null
        };
    }

    /**
     * Handle queries that should use dashboard data
     */
    function handleDashboardQuery(message, classification, history, fiscalContext, steps, startTime, buildResponseFn) {
        const dashboardId = classification.dashboard;
        const dashboard = getDashboardWithFetcher(dashboardId);
        
        if (!dashboard || !dashboard.getData) {
            // Fall back to SQL - this needs to be handled by caller
            return null;
        }
        
        // Check cache first
        const cachedData = getCachedDashboardData(dashboardId, fiscalContext);
        const fromCache = !!cachedData;
        
        steps.push({
            type: 'dashboard',
            title: fromCache ? 'Using cached ' + dashboard.name : 'Loading ' + dashboard.name,
            cached: fromCache,
            status: 'running',
            timestamp: Date.now()
        });
        
        try {
            let dashboardData;
            
            if (cachedData) {
                dashboardData = cachedData;
            } else {
                // Build context for dashboard data fetch
                const dataContext = {
                    fiscalYearStart: fiscalContext.fiscalYearStart,
                    fiscalYearEnd: fiscalContext.fiscalYearEnd
                };
                
                // Get dashboard data
                dashboardData = dashboard.getData(dataContext);
                
                // Cache it
                setCachedDashboardData(dashboardId, fiscalContext, dashboardData);
            }
            
            steps[steps.length - 1].status = 'complete';
            steps[steps.length - 1].dataSize = JSON.stringify(dashboardData).length;
            
            // Add useful details about what was loaded
            var dashboardMetrics = extractDashboardMetrics(dashboardData, dashboardId);
            steps[steps.length - 1].content = dashboardMetrics.summary;
            steps[steps.length - 1].metrics = dashboardMetrics.items;
            steps[steps.length - 1].dashboardId = dashboardId;
            
            // Interpret the data
            steps.push({
                type: 'analyzing',
                title: 'Analyzing dashboard data',
                status: 'running',
                timestamp: Date.now(),
                content: 'Processing ' + dashboardMetrics.rowCount + ' data points across ' + dashboardMetrics.sectionCount + ' sections',
                dashboardId: dashboardId,
                dataPointCount: dashboardMetrics.rowCount,
                sectionCount: dashboardMetrics.sectionCount
            });
            
            const interpretation = interpretDashboardData(message, dashboardId, dashboardData, fiscalContext, history);
            
            steps[steps.length - 1].status = 'complete';
            steps[steps.length - 1].content = 'Analysis complete - generated ' + (interpretation.richContent ? interpretation.richContent.length : 0) + ' content blocks';
            
            // Build response - the buildResponseFn already has session context baked in
            // We just need to pass dashboard-specific context as additional options
            const dashboardTopics = getDashboardTopics(dashboardId);
            const response = buildResponseFn(interpretation.text, steps, startTime, {
                model: interpretation.model,
                provider: interpretation.provider,
                // Dashboard-specific context for suggestions (merged with existing session by buildResponse)
                dashboardContext: {
                    topics: dashboardTopics,
                    dashboardId: dashboardId
                }
            });
            response.richContent = interpretation.richContent;
            return response;
            
        } catch (e) {
            log.error('Dashboard data error', { error: e.message });
            steps[steps.length - 1].status = 'error';
            steps[steps.length - 1].error = e.message;
            
            // Return null to signal fallback to SQL
            return null;
        }
    }

    /**
     * Interpret dashboard data with AI using structured final_response tool
     */
    function interpretDashboardData(message, dashboardId, data, fiscalContext, history) {
        // Get dashboard config with schema
        const dashboardConfig = DashboardRegistry.getDashboard(dashboardId);
        const schemaDesc = DashboardRegistry.getSchemaDescription(dashboardId);
        
        // Build a summary of what arrays/breakdowns are available
        const availableBreakdowns = [];
        if (data.departmentMetrics && data.departmentMetrics.length > 0) {
            availableBreakdowns.push(`departmentMetrics: ${data.departmentMetrics.length} departments with revenue, cogs, grossProfit, margin`);
        }
        if (data.revenueBySource && data.revenueBySource.length > 0) {
            availableBreakdowns.push(`revenueBySource: ${data.revenueBySource.length} revenue sources/accounts`);
        }
        if (data.topCustomers && data.topCustomers.length > 0) {
            availableBreakdowns.push(`topCustomers: ${data.topCustomers.length} top customers by revenue`);
        }
        if (data.arAging && Object.keys(data.arAging).length > 0) {
            availableBreakdowns.push(`arAging: AR aging buckets (current, over30, over60, over90)`);
        }
        if (data.apAging && Object.keys(data.apAging).length > 0) {
            availableBreakdowns.push(`apAging: AP aging buckets`);
        }
        if (data.cashByAccount && data.cashByAccount.length > 0) {
            availableBreakdowns.push(`cashByAccount: ${data.cashByAccount.length} bank accounts`);
        }
        if (data.weeklyProjections && data.weeklyProjections.length > 0) {
            availableBreakdowns.push(`weeklyProjections: ${data.weeklyProjections.length} weeks of cash projections`);
        }
        if (data.departmentBurden && data.departmentBurden.length > 0) {
            availableBreakdowns.push(`departmentBurden: ${data.departmentBurden.length} departments with burden rates`);
        }
        if (data.employeeMetrics && data.employeeMetrics.length > 0) {
            availableBreakdowns.push(`employeeMetrics: ${data.employeeMetrics.length} employees with utilization`);
        }
        
        // Pass full data to AI - let it understand the structure
        const dataStr = JSON.stringify(data, null, 2);
        const maxLen = 30000; // Increase limit to ensure arrays aren't truncated
        const dataSummary = dataStr.length > maxLen 
            ? dataStr.substring(0, maxLen) + '\n... [truncated]'
            : dataStr;
        
        // Use centralized prompt from Prompts library
        const systemPrompt = Prompts.buildDashboardPrompt(
            fiscalContext, 
            dashboardConfig?.name || dashboardId, 
            schemaDesc
        );
        
        const breakdownInfo = availableBreakdowns.length > 0
            ? `\n\nAVAILABLE BREAKDOWNS IN THIS DATA:\n${availableBreakdowns.map(b => '• ' + b).join('\n')}\n\n⚠️ USE THESE ARRAYS to answer questions about departments, customers, accounts, etc.`
            : '';
        
        const prompt = `USER QUESTION: "${message}"

CURRENT DATE: ${fiscalContext.currentDate}
DASHBOARD: ${dashboardId}
${breakdownInfo}

FULL DATA OBJECT:
${dataSummary}

INSTRUCTIONS:
1. Answer the question using the ACTUAL DATA provided above
2. If the question asks about departments, use the departmentMetrics array
3. If the question asks about revenue sources, use the revenueBySource array
4. If the question asks about customers, use the topCustomers array
5. NEVER say "data not available" if the array exists - USE IT

⚠️ YOU MUST call the final_response tool with structured blocks. DO NOT output plain text.

RESPONSE STRUCTURE:
- Use "metrics" block for key numbers (1-3 metrics for important figures)
- Use "text" block for explanation and analysis
- Use "chart" block only if it helps visualize a comparison or trend
- Use "callout" with variant:"warning" for concerns, variant:"success" for positive findings

Example tool call:
final_response({
  blocks: [
    { type: "metrics", items: [{ label: "Cash Position", value: 125000, format: "currency" }] },
    { type: "text", content: "Your current cash position is healthy at $125K..." },
    { type: "callout", variant: "warning", content: "AR over 90 days has increased 15%..." }
  ],
  followUpSuggestions: ["Show AR aging details", "Compare to last month"]
})`;

        try {
            const result = AIProviders.callAI(prompt, { 
                temperature: 0.3,
                systemPrompt: systemPrompt,
                chatHistory: history,
                purpose: 'Interpret dashboard data',
                tier: 3,
                tools: [ToolDefinitions.FINAL_RESPONSE_TOOL]
            });
            
            // Handle tool call response
            if (result.type === 'tool_call' && result.toolCalls && result.toolCalls.length > 0) {
                const toolCall = result.toolCalls.find(tc => tc && tc.name === 'final_response');
                if (toolCall && toolCall.arguments) {
                    const args = typeof toolCall.arguments === 'string' 
                        ? JSON.parse(toolCall.arguments) 
                        : toolCall.arguments;
                    
                    return buildResponseFromBlocks(args.blocks || [], args.followUpSuggestions, result);
                }
            }
            
            // Fallback: try to parse from text response using Utils
            const fullText = typeof result === 'string' ? result : result.text;
            if (fullText) {
                // Use Utils.extractAndRemoveJson to properly extract JSON
                const extracted = Utils.extractAndRemoveJson(fullText, 'type');
                
                // Try to parse blocks array from the text
                let blocks = [];
                try {
                    const jsonMatch = fullText.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        if (Array.isArray(parsed)) {
                            blocks = parsed;
                        }
                    }
                } catch (e) {
                    // If array parse fails, try to build from extracted JSON objects
                    if (extracted.json && extracted.json.type) {
                        blocks = [extracted.json];
                    }
                }
                
                // If we got blocks, use them
                if (blocks.length > 0) {
                    return buildResponseFromBlocks(blocks, [], result);
                }
                
                // Last resort: use legacy parser but with cleaned text
                const richContent = ResponseBuilder.parseRichContentFromDashboard(fullText, data, dashboardId);
                return {
                    text: extracted.cleanedText || 'Here is the dashboard data:',
                    richContent: richContent,
                    model: result.model,
                    provider: result.provider
                };
            }
            
            return {
                text: 'Here is the dashboard data:',
                richContent: [],
                model: result.model,
                provider: result.provider
            };
        } catch (e) {
            log.error('Dashboard interpretation error', { error: e.message, stack: e.stack });
            
            // ═══════════════════════════════════════════════════════════════
            // FIX: Instead of just returning error, try to show raw dashboard data
            // This provides value to user even when AI interpretation fails
            // Uses Dashboard Registry schema for dynamic metric extraction
            // ═══════════════════════════════════════════════════════════════
            var fallbackContent = extractFallbackMetricsFromSchema(dashboardId, data);
            
            // If we got some content, return it with a note
            if (fallbackContent.length > 0) {
                return {
                    text: 'Dashboard data loaded (AI analysis unavailable). Key metrics:',
                    richContent: fallbackContent
                };
            }
            
            return {
                text: 'Retrieved dashboard data but could not interpret it: ' + e.message,
                richContent: []
            };
        }
    }
    
    /**
     * Extract fallback metrics dynamically from Dashboard Registry schema
     * This avoids hardcoding metric names and works with any dashboard
     */
    function extractFallbackMetricsFromSchema(dashboardId, data) {
        var fallbackContent = [];
        
        try {
            if (!data) return fallbackContent;
            
            // Get dashboard schema from registry
            var dashboardConfig = DashboardRegistry.getDashboard(dashboardId);
            if (!dashboardConfig || !dashboardConfig.dataSchema || !dashboardConfig.dataSchema.fields) {
                log.debug('No schema found for dashboard fallback', { dashboardId: dashboardId });
                return fallbackContent;
            }
            
            var schema = dashboardConfig.dataSchema;
            var fields = schema.fields;
            
            // Priority fields to show first (if they exist in schema)
            var priorityOrder = [
                'totalCash', 'cashBalance', 'currentBalance', 'netPosition',
                'totalAR', 'totalAP', 'runwayDays', 'burnRate',
                'healthScore', 'revenueYTD', 'netIncome', 'gmPercent',
                'utilizationRate', 'billableHours', 'totalBurden'
            ];
            
            // Build ordered list of fields: priority first, then alphabetical
            var orderedFields = [];
            
            // Add priority fields first (if they exist in schema)
            for (var i = 0; i < priorityOrder.length; i++) {
                var pKey = priorityOrder[i];
                if (fields[pKey] && fields[pKey].type !== 'array') {
                    orderedFields.push(pKey);
                }
            }
            
            // Add remaining non-array fields
            for (var fieldKey in fields) {
                if (fields.hasOwnProperty(fieldKey)) {
                    var fieldDef = fields[fieldKey];
                    // Skip arrays and already-added priority fields
                    if (fieldDef.type !== 'array' && orderedFields.indexOf(fieldKey) === -1) {
                        orderedFields.push(fieldKey);
                    }
                }
            }
            
            // Extract metrics for fields that have data
            var metricsAdded = 0;
            var maxMetrics = 8; // Limit to avoid overwhelming user
            
            for (var j = 0; j < orderedFields.length && metricsAdded < maxMetrics; j++) {
                var key = orderedFields[j];
                var field = fields[key];
                
                // Check if data has this field with a valid value
                if (data[key] !== undefined && data[key] !== null) {
                    var value = data[key];
                    
                    // Skip zero values for non-essential fields after first few metrics
                    if (metricsAdded >= 4 && value === 0) continue;
                    
                    // Map schema type to display format
                    var format = 'number';
                    if (field.type === 'currency') format = 'currency';
                    else if (field.type === 'percent') format = 'percent';
                    
                    // Create readable label from description or field name
                    var label = field.desc 
                        ? field.desc.split('(')[0].split('=')[0].trim() // Take first part before parens or equals
                        : formatFieldNameAsLabel(key);
                    
                    // Truncate long labels
                    if (label.length > 35) {
                        label = label.substring(0, 32) + '...';
                    }
                    
                    fallbackContent.push({
                        type: 'metric',
                        label: label,
                        value: value,
                        format: format
                    });
                    metricsAdded++;
                }
            }
            
            // Also check for nested structures common in dashboards
            var nestedPaths = [
                { path: 'cashPosition.currentCash', label: 'Current Cash', format: 'currency' },
                { path: 'summary.revenue', label: 'Revenue', format: 'currency' },
                { path: 'summary.grossProfit', label: 'Gross Profit', format: 'currency' },
                { path: 'apAging.total', label: 'AP Total', format: 'currency' },
                { path: 'arAging.total', label: 'AR Total', format: 'currency' }
            ];
            
            for (var k = 0; k < nestedPaths.length && metricsAdded < maxMetrics; k++) {
                var np = nestedPaths[k];
                var nestedValue = getNestedValue(data, np.path);
                if (nestedValue !== undefined && nestedValue !== null) {
                    // Check if we already have a similar metric
                    var alreadyHave = fallbackContent.some(function(m) {
                        return m.label.toLowerCase().indexOf(np.label.toLowerCase().split(' ')[0]) >= 0;
                    });
                    if (!alreadyHave) {
                        fallbackContent.push({
                            type: 'metric',
                            label: np.label,
                            value: nestedValue,
                            format: np.format
                        });
                        metricsAdded++;
                    }
                }
            }
            
        } catch (extractError) {
            log.debug('Could not extract fallback metrics from schema', { 
                error: extractError.message,
                dashboardId: dashboardId 
            });
        }
        
        return fallbackContent;
    }
    
    /**
     * Convert camelCase field name to readable label
     */
    function formatFieldNameAsLabel(fieldName) {
        // Insert space before capitals and uppercase first letter
        return fieldName
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, function(str) { return str.toUpperCase(); })
            .trim();
    }
    
    /**
     * Get nested object value by path (e.g., 'cashPosition.currentCash')
     */
    function getNestedValue(obj, path) {
        var parts = path.split('.');
        var current = obj;
        for (var i = 0; i < parts.length; i++) {
            if (current === null || current === undefined) return undefined;
            current = current[parts[i]];
        }
        return current;
    }
    
    /**
     * Build response from structured blocks (from final_response tool)
     */
    function buildResponseFromBlocks(blocks, followUpSuggestions, aiResult) {
        const richContent = [];
        let textContent = '';
        
        for (const block of blocks) {
            if (block.type === 'text') {
                // Collect text for the main text field
                if (textContent) textContent += '\n\n';
                textContent += block.content || '';
            } else if (block.type === 'metrics') {
                // Convert metrics block to individual metric items
                if (block.items && Array.isArray(block.items)) {
                    block.items.forEach(item => {
                        richContent.push({
                            type: 'metric',
                            label: item.label,
                            value: item.value,
                            format: item.format || 'number',
                            delta: item.delta,
                            trend: item.trend,
                            sparkline: item.sparkline
                        });
                    });
                }
            } else if (block.type === 'callout') {
                // Map callout to warning/success/info
                const variant = block.variant || 'info';
                richContent.push({
                    type: variant === 'error' ? 'warning' : variant,
                    title: block.title,
                    message: block.content || block.message
                });
            } else {
                // Pass through other block types (chart, table, etc.)
                richContent.push(block);
            }
        }
        
        return {
            text: textContent || 'Here is the dashboard data:',
            richContent: richContent,
            followUpSuggestions: followUpSuggestions || [],
            model: aiResult.model,
            provider: aiResult.provider
        };
    }

    /**
     * Summarize dashboard data for agent
     */
    function summarizeDashboardForAgent(dashboardId, data) {
        const fmt = (n) => n ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '0';
        const summaries = {
            cashflow: (d) => `Cash: $${fmt(d.totalCash || d.cashBalance)}, AR: $${fmt(d.totalAR)}, AP: $${fmt(d.totalAP)}, Runway: ${d.runwayDays || 'N/A'} days`,
            health: (d) => `Revenue YTD: $${fmt(d.revenueYTD || d.revenue)}, GM: ${d.gmPercent || 'N/A'}%, Net: $${fmt(d.netIncome)}`,
            burden: (d) => `Burden: ${d.overallBurdenRate || 'N/A'}%, Utilization: ${d.utilizationRate || 'N/A'}%, Unbilled: $${fmt(d.unbilledAmount)}`,
            time: (d) => `Billable: ${fmt(d.totalBillableHours)} hrs, Utilization: ${d.utilizationRate || 'N/A'}%`
        };
        try {
            return summaries[dashboardId]?.(data) || JSON.stringify(data).substring(0, 300);
        } catch (e) {
            return JSON.stringify(data).substring(0, 300);
        }
    }

    /**
     * Execute dashboard data fetch for agent
     */
    function executeAgentDashboard(args, fiscalContext) {
        const dashboard = getDashboardWithFetcher(args.dashboard);
        if (!dashboard?.getData) {
            return { success: false, error: 'Dashboard not found: ' + args.dashboard };
        }
        
        try {
            const cached = getCachedDashboardData(args.dashboard, fiscalContext);
            if (cached) return { success: true, data: cached, cached: true };
            
            const data = dashboard.getData({
                fiscalYearStart: fiscalContext.fiscalYearStart,
                fiscalYearEnd: fiscalContext.fiscalYearEnd
            });
            setCachedDashboardData(args.dashboard, fiscalContext, data);
            return { success: true, data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Get relevant topics for a dashboard type to generate contextual follow-up suggestions
     */
    function getDashboardTopics(dashboardId) {
        const dashboardTopics = {
            cashflow: ['cash', 'payments', 'invoices', 'customers', 'vendors', 'transactions'],
            health: ['revenue', 'sales', 'expenses', 'customers', 'profit'],
            burden: ['burden', 'utilization', 'employees', 'projects', 'departments'],
            time: ['time', 'utilization', 'employees', 'projects', 'departments']
        };
        return dashboardTopics[dashboardId] || [];
    }

    /**
     * Extract summary metrics from dashboard data for step display
     */
    function extractDashboardMetrics(dashboardData, dashboardId) {
        var result = {
            summary: '',
            items: [],
            rowCount: 0,
            sectionCount: 0
        };
        
        try {
            // Count data sections and rows
            var sections = [];
            var totalRows = 0;
            
            if (dashboardData) {
                for (var key in dashboardData) {
                    if (dashboardData.hasOwnProperty(key)) {
                        var value = dashboardData[key];
                        if (Array.isArray(value)) {
                            sections.push(key);
                            totalRows += value.length;
                        } else if (typeof value === 'object' && value !== null) {
                            sections.push(key);
                            // Count nested arrays
                            for (var subKey in value) {
                                if (Array.isArray(value[subKey])) {
                                    totalRows += value[subKey].length;
                                }
                            }
                        }
                    }
                }
            }
            
            result.rowCount = totalRows;
            result.sectionCount = sections.length;
            
            // Build summary based on dashboard type
            if (dashboardId === 'cashflow') {
                var items = [];
                if (dashboardData.currentBalance !== undefined) {
                    items.push('Current: $' + Math.round(dashboardData.currentBalance).toLocaleString());
                }
                if (dashboardData.projectedBalance !== undefined) {
                    items.push('Projected: $' + Math.round(dashboardData.projectedBalance).toLocaleString());
                }
                if (dashboardData.weeklyForecast && dashboardData.weeklyForecast.length) {
                    items.push(dashboardData.weeklyForecast.length + ' week forecast');
                }
                if (dashboardData.arAgingRanges && dashboardData.arAgingRanges.length) {
                    items.push(dashboardData.arAgingRanges.length + ' AR aging buckets');
                }
                if (dashboardData.apAgingRanges && dashboardData.apAgingRanges.length) {
                    items.push(dashboardData.apAgingRanges.length + ' AP aging buckets');
                }
                result.summary = items.join(' • ');
                result.items = items;
            } else if (dashboardId === 'health') {
                var items = [];
                if (dashboardData.ytdRevenue !== undefined) {
                    items.push('YTD Revenue: $' + Math.round(dashboardData.ytdRevenue).toLocaleString());
                }
                if (dashboardData.ytdProfit !== undefined) {
                    items.push('YTD Profit: $' + Math.round(dashboardData.ytdProfit).toLocaleString());
                }
                if (dashboardData.monthlyTrend && dashboardData.monthlyTrend.length) {
                    items.push(dashboardData.monthlyTrend.length + ' months of trends');
                }
                result.summary = items.join(' • ');
                result.items = items;
            } else {
                // Generic summary
                result.summary = sections.length + ' data sections, ' + totalRows + ' data points';
            }
            
        } catch (e) {
            result.summary = 'Dashboard data loaded';
        }
        
        return result;
    }

    return {
        // Cache management
        getCachedDashboardData: getCachedDashboardData,
        setCachedDashboardData: setCachedDashboardData,
        
        // Dashboard handling
        getDashboardWithFetcher: getDashboardWithFetcher,
        handleDashboardQuery: handleDashboardQuery,
        
        // Interpretation
        interpretDashboardData: interpretDashboardData,
        summarizeDashboardForAgent: summarizeDashboardForAgent,
        
        // Agent execution
        executeAgentDashboard: executeAgentDashboard
    };
});