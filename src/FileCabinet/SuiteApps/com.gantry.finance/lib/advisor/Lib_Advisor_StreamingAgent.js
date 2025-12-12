/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_StreamingAgent.js
 * Streaming Context Architecture (SCA) - Multi-Phase Conversation Protocol
 *
 * WORLD-CLASS ARCHITECTURE:
 * LLM as Data Analyst - Full data access with zero hallucination
 *
 * PHASES:
 * 1. INTENT    - Classify the question type (~200 tokens, <1s)
 * 2. SELECT    - Pick relevant tools by name only (~300 tokens, <1s)
 * 3. INVOKE    - Execute tools, store data in N/cache (~200 tokens + tool time)
 * 4. RESPOND   - Single merged phase: LLM sees ACTUAL DATA ROWS,
 *                outputs narrative with {{token}} references (~8-10s)
 *
 * KEY INNOVATION: Token Reference System
 * - LLM outputs: "Your top customer is {{data.rows[0].customer_name}} with {{data.rows[0].total_revenue:currency}}"
 * - Code resolves tokens to real values from DataStore
 * - ZERO hallucination - all numbers come from actual data
 */
define([
    'N/log',
    './Lib_Advisor_AIProviders',
    './Lib_Advisor_Tools',
    './Lib_Advisor_DataStore',
    './Lib_Advisor_ProgressStore',
    './Lib_Advisor_Utils'
], function(log, AIProviders, Tools, DataStore, ProgressStore, Utils) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const PHASES = {
        INIT: 'init',
        INTENT: 'intent',
        SELECT: 'select',
        INVOKE: 'invoke',
        RESPOND: 'respond',   // NEW: Merged analyze+format with data access
        COMPLETE: 'complete',
        // Legacy phases kept for backward compatibility
        ANALYZE: 'analyze',
        LOAD_DATA: 'load_data',
        FORMAT: 'format'
    };

    // Use fast/cheap tier for all lightweight calls
    const FAST_TIER = 1;
    const MAX_TOOL_INVOCATIONS = 5;
    const MAX_DATA_LOADS = 3;
    const MAX_ANALYZE_ITERATIONS = 3;  // Prevent analyze loops
    const MAX_FORMAT_ITERATIONS = 2;   // Prevent format loops

    // ═══════════════════════════════════════════════════════════════════════════
    // LIGHTWEIGHT PROMPTS
    // ═══════════════════════════════════════════════════════════════════════════

    const INTENT_PROMPT = `Classify this financial question. Respond with JSON only.

Categories:
- entity_lookup: Finding a specific customer, vendor, employee, account
- top_list: Top N customers, vendors, items by some metric
- aging: AR aging, AP aging, overdue amounts
- reporting: Revenue, spend, GL activity, trial balance
- dashboard: Health metrics, KPIs, trends
- comparison: Compare periods, YoY, MoM
- transaction: Specific transaction details
- general: General questions, greetings, help

Question: "{question}"

Response format: {"intent": "category", "entities": ["named items"], "time_scope": "ytd|mtd|last_30|custom|none", "needs_resolution": true|false}`;

    const SELECT_PROMPT = `Select tools to answer this {intent} question. Respond with JSON only.

AVAILABLE TOOLS:
{tool_list}

Question: "{question}"
Intent: {intent}
{entity_context}

Rules:
- Pick 1-3 most relevant tools
- For entity names, include resolve_entity first
- Prefer specific tools over run_custom_query
- DO NOT select format_response - that's handled automatically

Response format: {"tools": ["tool1", "tool2"], "reasoning": "brief explanation"}`;

    const INVOKE_PROMPT = `Call this tool. Respond with JSON only.

TOOL: {tool_name}
{tool_schema}

Question context: "{question}"
{resolved_entities}

Response format: {"tool": "{tool_name}", "args": {...}}`;

    const ANALYZE_PROMPT = `Analyze this data to answer the user's question. Respond with JSON only.

QUESTION: "{question}"

{data_references}

Instructions:
- Use the data summaries and previews provided
- If you need more rows, respond with: {"action": "load_data", "refId": "ref_xxx", "start": 0, "end": 19}
- If you have enough data, provide your analysis
- Be specific with numbers and percentages

Response format (if ready to answer):
{"analysis": "Your detailed analysis here", "key_findings": ["finding1", "finding2"]}

Response format (if need more data):
{"action": "load_data", "refId": "ref_xxx", "start": 0, "end": 19}`;

    const FORMAT_PROMPT = `Format this analysis as rich content blocks. Respond with JSON only.

ANALYSIS:
{analysis}

KEY FINDINGS:
{findings}

DATA AVAILABLE:
{data_summary}

Create blocks array with these types:
- text: {"type": "text", "content": "narrative text"}
- metrics: {"type": "metrics", "items": [{"label": "X", "value": "$Y", "trend": "up|down|neutral"}]}
- table: {"type": "table", "title": "X", "headers": [...], "rows": [[...], ...]}
- list: {"type": "list", "title": "Key Insights", "items": ["item1", "item2"]}

Response format:
{"title": "Response Title", "summary": "One line summary", "blocks": [...]}`;

    // ═══════════════════════════════════════════════════════════════════════════
    // WORLD-CLASS RESPOND PROMPT - LLM as Data Analyst
    // ═══════════════════════════════════════════════════════════════════════════

    const RESPOND_PROMPT = `You are a financial data analyst. Analyze this data and create a response.

QUESTION: "{question}"

{data_sections}

═══════════════════════════════════════════════════════════════════════════════
CRITICAL INSTRUCTIONS - READ CAREFULLY:

1. NEVER INVENT DATA. Every number must come from tokens or the data above.

2. AVAILABLE TOKEN SYNTAX:
   Row values:
   - {{{{data.rows[0].customer_name}}}} → first row's customer_name
   - {{{{data.rows[0].total_revenue:currency}}}} → formats as currency
   - {{{{data.rows[5].amount}}}} → 6th row's amount value

   Aggregate stats (from STATS section above):
   - {{{{data.stats.total:currency}}}} → sum of primary monetary column
   - {{{{data.stats.average:currency}}}} → average
   - {{{{data.stats.count}}}} → total row count

   Column-specific aggregates:
   - {{{{data.stats.total_outstanding_ar:currency}}}} → sum of outstanding_ar column
   - {{{{data.stats.total_revenue:currency}}}} → sum of total_revenue column

3. DO NOT create table blocks - tables are rendered separately.
   Only create: text, metrics, list blocks.

4. For metrics, ALWAYS use tokens for the value field:
   {{"label": "Total Revenue", "value": "{{{{data.stats.total:currency}}}}"}}

5. In narrative, cite specific data points using tokens:
   "{{{{data.rows[0].customer_name}}}} leads with {{{{data.rows[0].total_revenue:currency}}}}."

═══════════════════════════════════════════════════════════════════════════════

Response format (JSON only):
{{
  "narrative": "Analysis text referencing {{{{tokens}}}} for specific values",
  "metrics": [
    {{"label": "Total Revenue", "value": "{{{{data.stats.total:currency}}}}", "trend": "neutral"}},
    {{"label": "Average", "value": "{{{{data.stats.average:currency}}}}", "trend": "neutral"}}
  ],
  "findings": [
    "Insight about {{{{data.rows[0].customer_name}}}} with {{{{data.rows[0].total_revenue:currency}}}}",
    "Another key finding with data reference"
  ]
}}`;

    // ═══════════════════════════════════════════════════════════════════════════
    // TOOL MANIFEST (Names + One-liners only)
    // NOTE: format_response is NOT included - it's internal only
    // ═══════════════════════════════════════════════════════════════════════════

    function getToolManifest() {
        return {
            // Discovery
            resolve_entity: "Find customer/vendor/employee by name → returns ID",
            resolve_gl_account: "Find GL account by name/number → returns ID",
            resolve_classification: "Find class/department/location → returns ID",

            // Customer/Revenue
            get_customer_revenue: "Revenue by customer for a period",
            get_top_customers: "Top N customers by revenue or volume",

            // Vendor/Spend
            get_vendor_spend: "Spend by vendor for a period",
            get_top_vendors: "Top N vendors by spend",

            // Aging
            get_ar_aging: "AR aging buckets by customer",
            get_ap_aging: "AP aging buckets by vendor",

            // GL & Reporting
            get_gl_activity: "GL account activity and balances",
            get_trial_balance: "Trial balance for a period",
            get_income_statement: "Income statement / P&L",
            get_balance_sheet: "Balance sheet",
            get_recent_transactions: "Recent transactions with filters",
            get_transaction_detail: "Details of a specific transaction",

            // Analysis
            compare_periods: "Compare two time periods",
            find_anomalies: "Find unusual transactions or patterns",
            get_cash_position: "Current cash and bank balances",
            get_expense_breakdown: "Expenses by category",

            // Dashboards
            dashboard_cashflow: "Cash flow dashboard metrics",
            dashboard_health: "Financial health indicators",
            dashboard_customervalue: "Customer value analysis",
            dashboard_vendorperformance: "Vendor performance metrics",

            // Utility
            get_fiscal_context: "Current fiscal period info",
            run_custom_query: "Execute custom SuiteQL query",
            run_saved_search: "Run a NetSuite saved search",
            list_saved_searches: "List available saved searches"
            // NOTE: format_response intentionally excluded - internal use only
        };
    }

    function getToolListForPrompt() {
        const manifest = getToolManifest();
        return Object.entries(manifest)
            .map(([name, desc]) => `• ${name}: ${desc}`)
            .join('\n');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    function initStreamingState(message, sessionContext, requestId) {
        return {
            requestId: requestId,
            message: message,
            sessionContext: sessionContext || {},
            phase: PHASES.INIT,
            intent: null,
            selectedTools: [],
            toolInvocations: [],
            dataReferences: [],
            resolvedEntities: {},
            analysis: null,
            formattedResponse: null,
            iteration: 0,
            analyzeIterations: 0,    // Track analyze phase runs
            formatIterations: 0,     // Track format phase runs
            startTime: Date.now(),
            phaseTimings: {},        // Track duration per phase
            errors: [],
            // Step tracking - IDs for updating vs adding
            stepIds: {
                intent: null,
                select: null,
                analyze: null,
                format: null
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP HELPERS - Rich step data for frontend
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Build debug info object when debug mode is enabled
     */
    function buildDebugInfo(prompt, response, state, extras) {
        if (!Utils.isDebugMode()) return undefined;

        return {
            promptLength: prompt?.length || 0,
            promptPreview: prompt?.substring(0, 500) + (prompt?.length > 500 ? '...' : ''),
            responseLength: response?.text?.length || 0,
            responsePreview: response?.text?.substring(0, 500) + (response?.text?.length > 500 ? '...' : ''),
            model: response?.model || AIProviders.getCurrentModelInfo()?.model,
            provider: response?.provider || AIProviders.getCurrentModelInfo()?.provider,
            tokensUsed: response?.usage || null,
            phase: state.phase,
            iteration: state.iteration,
            analyzeIterations: state.analyzeIterations,
            formatIterations: state.formatIterations,
            dataRefCount: state.dataReferences?.length || 0,
            errorCount: state.errors?.length || 0,
            ...extras
        };
    }

    /**
     * Add or update a thinking step with rich information
     */
    function upsertThinkingStep(state, stepKey, data) {
        const stepData = {
            type: 'thinking',
            title: data.title,
            status: data.status || 'active',
            context: {
                phase: data.phase,
                ...data.context
            },
            timestamp: data.timestamp || Date.now(),
            duration: data.duration,
            debug: data.debug
        };

        // Clean undefined values
        Object.keys(stepData).forEach(key => {
            if (stepData[key] === undefined) delete stepData[key];
        });
        if (stepData.context) {
            Object.keys(stepData.context).forEach(key => {
                if (stepData.context[key] === undefined) delete stepData.context[key];
            });
        }

        if (state.stepIds[stepKey]) {
            // Update existing step
            ProgressStore.updateStep(state.requestId, stepData);
        } else {
            // Add new step
            ProgressStore.addStep(state.requestId, stepData);
            state.stepIds[stepKey] = true;
        }
    }

    /**
     * Add a tool call step with rich information
     */
    function addToolCallStep(state, data) {
        const stepData = {
            type: 'tool_call',
            title: data.title,
            tool: data.tool,
            status: data.status || 'active',
            params: data.params,
            timestamp: Date.now()
        };

        // Add result info if complete
        if (data.status === 'complete') {
            stepData.result = {
                success: data.success,
                rowCount: data.rowCount,
                columns: data.columns,
                preview: data.preview,
                error: data.error,
                dataRef: data.dataRef
            };
            stepData.duration = data.duration;
            stepData.summary = data.summary;
        }

        // Add debug info
        if (data.debug) {
            stepData.debug = data.debug;
        }

        // Clean undefined values
        Object.keys(stepData).forEach(key => {
            if (stepData[key] === undefined) delete stepData[key];
        });
        if (stepData.result) {
            Object.keys(stepData.result).forEach(key => {
                if (stepData.result[key] === undefined) delete stepData.result[key];
            });
        }

        if (data.update) {
            ProgressStore.updateLastStep(state.requestId, stepData);
        } else {
            ProgressStore.addStep(state.requestId, stepData);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE EXECUTORS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Phase 1: INTENT - Classify the question
     */
    function executeIntentPhase(state) {
        const phaseStart = Date.now();
        const prompt = INTENT_PROMPT.replace('{question}', state.message);

        // Add thinking step
        upsertThinkingStep(state, 'intent', {
            title: 'Understanding your question',
            phase: 'intent',
            status: 'active',
            context: {
                question: state.message.substring(0, 100)
            }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.1,
                maxTokens: 200,
                jsonMode: true,
                purpose: 'SCA:intent'
            });

            const parsed = parseJsonResponse(response?.text);
            const duration = Date.now() - phaseStart;
            state.phaseTimings.intent = duration;

            if (parsed && parsed.intent) {
                state.intent = parsed;
                state.phase = PHASES.SELECT;

                // Update step with results
                upsertThinkingStep(state, 'intent', {
                    title: 'Understanding your question',
                    phase: 'intent',
                    status: 'complete',
                    duration: duration,
                    context: {
                        question: state.message.substring(0, 100),
                        intent: parsed.intent,
                        entities: parsed.entities || [],
                        timeScope: parsed.time_scope,
                        needsResolution: parsed.needs_resolution
                    },
                    debug: buildDebugInfo(prompt, response, state, { parsedIntent: parsed })
                });

                log.debug('SCA Intent phase complete', { intent: parsed.intent, duration: duration });
                return { success: true, nextPhase: PHASES.SELECT };
            } else {
                throw new Error('Failed to parse intent: ' + (response?.text?.substring(0, 100) || 'empty response'));
            }
        } catch (e) {
            const duration = Date.now() - phaseStart;
            log.error('SCA Intent phase failed', { error: e.message, duration: duration });
            state.errors.push({ phase: 'intent', error: e.message, timestamp: Date.now() });

            // Default to general reporting intent
            state.intent = { intent: 'reporting', entities: [], time_scope: 'none' };
            state.phase = PHASES.SELECT;

            upsertThinkingStep(state, 'intent', {
                title: 'Understanding your question',
                phase: 'intent',
                status: 'complete',
                duration: duration,
                context: {
                    intent: 'reporting',
                    fallback: true,
                    error: e.message
                }
            });

            return { success: true, nextPhase: PHASES.SELECT };
        }
    }

    /**
     * Phase 2: SELECT - Pick tools by name
     */
    function executeSelectPhase(state) {
        const phaseStart = Date.now();
        const entityContext = state.intent.entities && state.intent.entities.length > 0
            ? `Mentioned entities: ${state.intent.entities.join(', ')}`
            : 'No specific entities mentioned';

        const prompt = SELECT_PROMPT
            .replace('{intent}', state.intent.intent)
            .replace('{tool_list}', getToolListForPrompt())
            .replace('{question}', state.message)
            .replace('{entity_context}', entityContext);

        upsertThinkingStep(state, 'select', {
            title: 'Selecting analysis tools',
            phase: 'select',
            status: 'active',
            context: {
                intent: state.intent.intent,
                availableTools: Object.keys(getToolManifest()).length
            }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.1,
                maxTokens: 200,
                jsonMode: true,
                purpose: 'SCA:select'
            });

            const parsed = parseJsonResponse(response?.text);
            const duration = Date.now() - phaseStart;
            state.phaseTimings.select = duration;

            if (parsed && parsed.tools && parsed.tools.length > 0) {
                // Filter out format_response if LLM selected it (shouldn't happen but safety check)
                let selectedTools = parsed.tools
                    .filter(t => t !== 'format_response')
                    .slice(0, MAX_TOOL_INVOCATIONS);

                // Ensure we have at least one tool
                if (selectedTools.length === 0) {
                    selectedTools = getDefaultToolsForIntent(state.intent.intent);
                }

                state.selectedTools = selectedTools;
                state.phase = PHASES.INVOKE;

                upsertThinkingStep(state, 'select', {
                    title: 'Selecting analysis tools',
                    phase: 'select',
                    status: 'complete',
                    duration: duration,
                    context: {
                        intent: state.intent.intent,
                        selectedTools: state.selectedTools,
                        reasoning: parsed.reasoning
                    },
                    debug: buildDebugInfo(prompt, response, state, { parsedSelection: parsed })
                });

                log.debug('SCA Select phase complete', { tools: state.selectedTools, duration: duration });
                return { success: true, nextPhase: PHASES.INVOKE };
            } else {
                throw new Error('No tools selected from response');
            }
        } catch (e) {
            const duration = Date.now() - phaseStart;
            log.error('SCA Select phase failed', { error: e.message, duration: duration });
            state.errors.push({ phase: 'select', error: e.message, timestamp: Date.now() });

            // Default to a sensible tool based on intent
            state.selectedTools = getDefaultToolsForIntent(state.intent.intent);
            state.phase = PHASES.INVOKE;

            upsertThinkingStep(state, 'select', {
                title: 'Selecting analysis tools',
                phase: 'select',
                status: 'complete',
                duration: duration,
                context: {
                    selectedTools: state.selectedTools,
                    fallback: true,
                    error: e.message
                }
            });

            return { success: true, nextPhase: PHASES.INVOKE };
        }
    }

    /**
     * Phase 3: INVOKE - Call tools one at a time
     */
    function executeInvokePhase(state) {
        // Check if we have more tools to invoke
        const invokedCount = state.toolInvocations.length;
        if (invokedCount >= state.selectedTools.length) {
            // All tools invoked - ADD TABLE BLOCKS IMMEDIATELY before moving to respond
            // This enables progressive rendering: tables appear BEFORE LLM generates narrative
            addProgressiveTableBlocks(state);

            // Move to RESPOND phase (merged analyze+format with full data access)
            state.phase = PHASES.RESPOND;
            return { success: true, nextPhase: PHASES.RESPOND };
        }

        const toolName = state.selectedTools[invokedCount];

        // Skip format_response if somehow selected (double safety)
        if (toolName === 'format_response') {
            state.toolInvocations.push({ tool: toolName, skipped: true, reason: 'Internal tool only' });
            return { success: true, nextPhase: PHASES.INVOKE };
        }

        const tool = Tools.getTool(toolName);

        if (!tool) {
            log.error('SCA Unknown tool', { tool: toolName });
            state.toolInvocations.push({ tool: toolName, error: 'Unknown tool' });

            addToolCallStep(state, {
                title: `Unknown tool: ${toolName}`,
                tool: toolName,
                status: 'complete',
                success: false,
                error: 'Tool not found'
            });

            return { success: true, nextPhase: PHASES.INVOKE }; // Continue with next tool
        }

        // Build minimal schema for this tool
        const schemaLines = [];
        if (tool.parameters && tool.parameters.properties) {
            const required = tool.parameters.required || [];
            for (const [param, def] of Object.entries(tool.parameters.properties)) {
                const req = required.includes(param) ? ' (required)' : '';
                const enumVals = def.enum ? ` [${def.enum.slice(0, 5).join('|')}${def.enum.length > 5 ? '|...' : ''}]` : '';
                schemaLines.push(`  - ${param}: ${def.type}${enumVals}${req}`);
            }
        }

        const resolvedContext = Object.entries(state.resolvedEntities)
            .map(([name, entity]) => `  ${name} = ID ${entity.id} (${entity.type})`)
            .join('\n');

        const prompt = INVOKE_PROMPT
            .replace('{tool_name}', toolName)
            .replace('{tool_schema}', schemaLines.join('\n') || 'No parameters required')
            .replace('{question}', state.message)
            .replace('{resolved_entities}', resolvedContext ? `Resolved entities:\n${resolvedContext}` : '');

        // Add step as active
        addToolCallStep(state, {
            title: Tools.getToolDisplayName(toolName, {}),
            tool: toolName,
            status: 'active'
        });

        const invokeStart = Date.now();

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.1,
                maxTokens: 300,
                jsonMode: true,
                purpose: `SCA:invoke:${toolName}`
            });

            const parsed = parseJsonResponse(response?.text);
            const args = parsed?.args || {};

            // Execute the tool
            const toolStart = Date.now();
            const result = Tools.executeTool(toolName, args);
            const toolDuration = Date.now() - toolStart;
            const totalDuration = Date.now() - invokeStart;

            // Store data reference if tool returned rows
            let dataRef = null;
            if (result.success && result.rows && result.rows.length > 0) {
                dataRef = DataStore.storeData(state.requestId, toolName, result);
                state.dataReferences.push(dataRef);
            }

            // Track resolved entities
            if (toolName.startsWith('resolve_') && result.found && result.entity) {
                const searchTerm = args.term || args.name || 'unknown';
                state.resolvedEntities[searchTerm] = result.entity;
            }

            const invocation = {
                tool: toolName,
                args: args,
                success: result.success,
                rowCount: result.rowCount || (result.rows ? result.rows.length : 0),
                columns: result.columns || (result.rows && result.rows[0] ? Object.keys(result.rows[0]) : []),
                dataRef: dataRef?.refId,
                duration: toolDuration,
                timestamp: Date.now()
            };
            state.toolInvocations.push(invocation);

            // Build preview for frontend
            const preview = result.rows?.slice(0, 3).map(row => {
                const previewRow = {};
                const cols = Object.keys(row).slice(0, 4);
                cols.forEach(col => { previewRow[col] = row[col]; });
                return previewRow;
            });

            // Update step with results
            addToolCallStep(state, {
                title: Tools.getToolDisplayName(toolName, args),
                tool: toolName,
                status: 'complete',
                update: true,
                params: args,
                success: result.success,
                rowCount: invocation.rowCount,
                columns: invocation.columns.slice(0, 8),
                preview: preview,
                dataRef: dataRef?.refId,
                duration: totalDuration,
                summary: result.success
                    ? `Found ${invocation.rowCount} results`
                    : (result.error || 'Failed'),
                debug: buildDebugInfo(prompt, response, state, {
                    toolDuration: toolDuration,
                    totalDuration: totalDuration,
                    argsUsed: args
                })
            });

            log.debug('SCA Invoke phase - tool executed', {
                tool: toolName,
                success: result.success,
                rowCount: invocation.rowCount,
                hasDataRef: !!dataRef,
                duration: totalDuration
            });

            return { success: true, nextPhase: PHASES.INVOKE }; // Continue with next tool

        } catch (e) {
            const duration = Date.now() - invokeStart;
            log.error('SCA Invoke phase failed', { tool: toolName, error: e.message, duration: duration });
            state.errors.push({ phase: 'invoke', tool: toolName, error: e.message, timestamp: Date.now() });
            state.toolInvocations.push({ tool: toolName, error: e.message, duration: duration });

            addToolCallStep(state, {
                title: Tools.getToolDisplayName(toolName, {}),
                tool: toolName,
                status: 'complete',
                update: true,
                success: false,
                error: e.message,
                duration: duration,
                summary: 'Error: ' + e.message.substring(0, 50)
            });

            return { success: true, nextPhase: PHASES.INVOKE }; // Continue with next tool
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WORLD-CLASS RESPOND PHASE - LLM as Data Analyst
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Phase 4: RESPOND - Single merged phase with FULL DATA ACCESS
     * LLM sees actual data rows and uses {{token}} syntax for guaranteed accuracy
     */
    function executeRespondPhase(state) {
        const phaseStart = Date.now();

        // Check if we have any data
        if (state.dataReferences.length === 0) {
            // No data - provide fallback
            state.formattedResponse = {
                title: 'Unable to Answer',
                summary: 'No data found',
                blocks: [{
                    type: 'text',
                    content: "I wasn't able to find the data needed to answer your question. Please try rephrasing or providing more specific details."
                }]
            };
            state.phase = PHASES.COMPLETE;

            upsertThinkingStep(state, 'respond', {
                title: 'Generating response',
                phase: 'respond',
                status: 'complete',
                context: { noData: true }
            });

            return { success: true, nextPhase: PHASES.COMPLETE };
        }

        // Build data sections with ACTUAL ROWS for the prompt
        const dataSections = buildDataSectionsForPrompt(state);

        const prompt = RESPOND_PROMPT
            .replace('{question}', state.message)
            .replace('{data_sections}', dataSections);

        // Update thinking step
        upsertThinkingStep(state, 'respond', {
            title: 'Generating response',
            phase: 'respond',
            status: 'active',
            context: {
                dataRefs: state.dataReferences.length,
                phase: 'respond'
            }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.3,
                maxTokens: 2000,
                jsonMode: true,
                purpose: 'SCA:respond'
            });

            const parsed = parseJsonResponse(response?.text);
            const duration = Date.now() - phaseStart;
            state.phaseTimings.respond = duration;

            if (parsed) {
                // Resolve all {{tokens}} in the response
                const resolved = resolveAllTokens(parsed, state);

                // Build formatted response from resolved content
                state.formattedResponse = {
                    title: 'Analysis Results',
                    summary: resolved.narrative?.substring(0, 150) || '',
                    blocks: []
                };

                // Add narrative text block
                if (resolved.narrative) {
                    state.formattedResponse.blocks.push({
                        type: 'text',
                        content: resolved.narrative
                    });
                }

                // Add metrics block
                if (resolved.metrics && resolved.metrics.length > 0) {
                    state.formattedResponse.blocks.push({
                        type: 'metrics',
                        items: resolved.metrics
                    });
                }

                // Add findings as list
                if (resolved.findings && resolved.findings.length > 0) {
                    state.formattedResponse.blocks.push({
                        type: 'list',
                        title: 'Key Findings',
                        items: resolved.findings
                    });
                }

                state.phase = PHASES.COMPLETE;

                upsertThinkingStep(state, 'respond', {
                    title: 'Generating response',
                    phase: 'respond',
                    status: 'complete',
                    duration: duration,
                    context: {
                        blockCount: state.formattedResponse.blocks.length,
                        tokensResolved: true
                    },
                    debug: buildDebugInfo(prompt, response, state, {
                        responseLength: resolved.narrative?.length,
                        metricsCount: resolved.metrics?.length,
                        findingsCount: resolved.findings?.length
                    })
                });

                log.debug('SCA Respond phase complete', { duration: duration });
                return { success: true, nextPhase: PHASES.COMPLETE };
            }

            throw new Error('Invalid respond output - missing required fields');

        } catch (e) {
            const duration = Date.now() - phaseStart;
            log.error('SCA Respond phase failed', { error: e.message, duration: duration });
            state.errors.push({ phase: 'respond', error: e.message, timestamp: Date.now() });

            // Fallback: use data summaries directly
            const fallbackNarrative = buildFallbackNarrative(state);
            state.formattedResponse = {
                title: 'Analysis Results',
                summary: fallbackNarrative.substring(0, 150),
                blocks: [{ type: 'text', content: fallbackNarrative }]
            };
            state.phase = PHASES.COMPLETE;

            upsertThinkingStep(state, 'respond', {
                title: 'Generating response',
                phase: 'respond',
                status: 'complete',
                duration: duration,
                context: {
                    fallback: true,
                    error: e.message.substring(0, 100)
                }
            });

            return { success: true, nextPhase: PHASES.COMPLETE };
        }
    }

    /**
     * Build data sections with ACTUAL ROWS for the RESPOND prompt
     * This gives LLM full visibility into the data
     */
    function buildDataSectionsForPrompt(state) {
        const sections = [];

        state.dataReferences.forEach((ref, idx) => {
            const summary = ref.summary || {};
            const toolName = getToolDisplayName(summary.tool) || 'Data';

            // Load actual rows from DataStore
            const data = DataStore.loadRows(state.requestId, ref.refId, 0, 49); // Up to 50 rows
            if (!data || !data.rows) return;

            const totalRows = data.range?.total || data.rows.length;
            let section = `═══ DATA: ${toolName} (${totalRows} total rows) ═══\n`;
            section += `Columns: ${data.columns.join(', ')}\n\n`;

            // Compute aggregate stats from schema
            const computedStats = computeAggregateStats(summary);
            if (computedStats) {
                section += `STATS:\n`;
                if (computedStats.total !== undefined) {
                    section += `  total: ${formatStatValue(computedStats.total, 'total')}\n`;
                }
                if (computedStats.average !== undefined) {
                    section += `  average: ${formatStatValue(computedStats.average, 'average')}\n`;
                }
                section += `  count: ${totalRows}\n`;
                section += '\n';
            }

            // Add actual rows (up to 20 for prompt size management)
            const rowsToShow = Math.min(data.rows.length, 20);
            section += `ROWS (showing ${rowsToShow} of ${totalRows}):\n`;

            for (let i = 0; i < rowsToShow; i++) {
                const row = data.rows[i];
                const rowData = data.columns.slice(0, 6).map(col => {
                    const val = row[col];
                    if (val === null || val === undefined) return 'null';
                    if (typeof val === 'number') {
                        return isMonetaryColumn(col) ? '$' + val.toLocaleString('en-US', {minimumFractionDigits: 2}) : val.toLocaleString();
                    }
                    return String(val);
                });
                section += `  Row ${i}: {${data.columns.slice(0, 6).map((c, j) => `${c}: ${rowData[j]}`).join(', ')}}\n`;
            }

            // Reference syntax guide with available column stats
            section += `\nTOKEN REFERENCE GUIDE:\n`;
            section += `  Rows: {{data.rows[N].column_name}} or {{data.rows[N].column_name:currency}}\n`;
            section += `  Stats: {{data.stats.total}}, {{data.stats.count}}, {{data.stats.average}}\n`;

            // List columns with numeric stats
            if (summary.schema) {
                const numericCols = Object.entries(summary.schema)
                    .filter(([col, s]) => s.stats)
                    .map(([col]) => col);
                if (numericCols.length > 0) {
                    section += `  Column totals: ${numericCols.map(c => '{{data.stats.total_' + c + ':currency}}').join(', ')}\n`;
                }
            }

            sections.push(section);
        });

        return sections.join('\n\n') || 'No data available';
    }

    /**
     * Compute aggregate stats from the summary schema
     * Finds the primary monetary column and extracts its stats
     */
    function computeAggregateStats(summary) {
        if (!summary || !summary.schema) return null;

        // Find the primary monetary column (total_revenue, amount, total, etc.)
        const monetaryPriority = ['total_revenue', 'revenue', 'total', 'amount', 'balance', 'spend'];
        let primaryCol = null;
        let primaryStats = null;

        // First try priority columns
        for (const col of monetaryPriority) {
            if (summary.schema[col] && summary.schema[col].stats) {
                primaryCol = col;
                primaryStats = summary.schema[col].stats;
                break;
            }
        }

        // If not found, look for any numeric column with stats
        if (!primaryStats) {
            for (const [col, schema] of Object.entries(summary.schema)) {
                if (schema.stats && (schema.type === 'number' || schema.type === 'currency')) {
                    // Prefer columns with monetary names
                    if (isMonetaryColumn(col)) {
                        primaryCol = col;
                        primaryStats = schema.stats;
                        break;
                    }
                    // Keep as fallback
                    if (!primaryStats) {
                        primaryCol = col;
                        primaryStats = schema.stats;
                    }
                }
            }
        }

        if (!primaryStats) return null;

        return {
            total: primaryStats.sum,
            average: primaryStats.avg,
            min: primaryStats.min,
            max: primaryStats.max,
            count: primaryStats.count,
            column: primaryCol
        };
    }

    /**
     * Resolve all {{tokens}} in the LLM response with real data values
     */
    function resolveAllTokens(parsed, state) {
        const result = {
            narrative: resolveTokensInText(parsed.narrative || '', state),
            metrics: [],
            findings: []
        };

        // Resolve metrics
        if (parsed.metrics && Array.isArray(parsed.metrics)) {
            result.metrics = parsed.metrics.map(m => ({
                label: m.label || '',
                value: resolveTokensInText(String(m.value || ''), state),
                trend: m.trend || 'neutral'
            }));
        }

        // Resolve findings
        if (parsed.findings && Array.isArray(parsed.findings)) {
            result.findings = parsed.findings.map(f => resolveTokensInText(String(f), state));
        }

        return result;
    }

    /**
     * Resolve {{tokens}} in a text string
     * Supports: {{data.rows[N].column}}, {{data.rows[N].column:currency}}, {{data.stats.X}}
     */
    function resolveTokensInText(text, state) {
        if (!text) return '';

        // Pattern: {{data.rows[N].column}} or {{data.rows[N].column:format}}
        return text.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
            try {
                const trimmed = expr.trim();

                // Parse the expression
                // Format: data.rows[N].column or data.rows[N].column:format or data.stats.X
                const formatMatch = trimmed.match(/:(\w+)$/);
                const format = formatMatch ? formatMatch[1] : null;
                const path = format ? trimmed.replace(/:(\w+)$/, '') : trimmed;

                // Get the first data reference (most common case)
                const dataRef = state.dataReferences[0];
                if (!dataRef) return match;

                const data = DataStore.loadRows(state.requestId, dataRef.refId, 0, 49);
                if (!data) return match;

                const totalRows = data.range?.total || data.rows.length;

                // Handle data.rows[N].column
                const rowMatch = path.match(/data\.rows\[(\d+)\]\.(\w+)/);
                if (rowMatch) {
                    const rowIdx = parseInt(rowMatch[1], 10);
                    const column = rowMatch[2];

                    if (data.rows && data.rows[rowIdx] !== undefined) {
                        const value = data.rows[rowIdx][column];
                        return formatResolvedValue(value, format, column);
                    }
                    return match; // Keep original if not found
                }

                // Handle data.stats.X - compute from schema
                const statsMatch = path.match(/data\.stats\.(\w+)/);
                if (statsMatch) {
                    const statName = statsMatch[1];
                    const summary = dataRef.summary || {};
                    const computedStats = computeAggregateStats(summary);

                    // Handle count/rowCount
                    if (statName === 'count' || statName === 'rowCount') {
                        return totalRows.toString();
                    }

                    // Handle computed stats from primary column
                    if (computedStats) {
                        if (statName === 'total' && computedStats.total !== undefined) {
                            return formatResolvedValue(computedStats.total, format || 'currency', 'total');
                        }
                        if (statName === 'average' && computedStats.average !== undefined) {
                            return formatResolvedValue(computedStats.average, format || 'currency', 'average');
                        }
                        if (statName === 'min' && computedStats.min !== undefined) {
                            return formatResolvedValue(computedStats.min, format || 'currency', 'min');
                        }
                        if (statName === 'max' && computedStats.max !== undefined) {
                            return formatResolvedValue(computedStats.max, format || 'currency', 'max');
                        }
                    }

                    // Handle column-specific stats (e.g., total_outstanding_ar -> sum of outstanding_ar column)
                    if (summary.schema) {
                        // Check for total_X or sum_X patterns
                        const totalMatch = statName.match(/^(total|sum)_(.+)$/);
                        if (totalMatch) {
                            const colName = totalMatch[2];
                            if (summary.schema[colName]?.stats?.sum !== undefined) {
                                return formatResolvedValue(summary.schema[colName].stats.sum, format || 'currency', colName);
                            }
                        }

                        // Check for avg_X or average_X patterns
                        const avgMatch = statName.match(/^(avg|average)_(.+)$/);
                        if (avgMatch) {
                            const colName = avgMatch[2];
                            if (summary.schema[colName]?.stats?.avg !== undefined) {
                                return formatResolvedValue(summary.schema[colName].stats.avg, format || 'currency', colName);
                            }
                        }

                        // Direct column stat lookup
                        for (const [col, schema] of Object.entries(summary.schema)) {
                            if (schema.stats && schema.stats[statName] !== undefined) {
                                return formatResolvedValue(schema.stats[statName], format, statName);
                            }
                        }
                    }
                }

                return match; // Keep original if not resolved
            } catch (e) {
                log.debug('Token resolution error', { expr: expr, error: e.message });
                return match;
            }
        });
    }

    /**
     * Format a resolved value based on format hint and column name
     */
    function formatResolvedValue(value, format, columnName) {
        if (value === null || value === undefined) return '';

        if (typeof value === 'number') {
            if (format === 'currency' || (!format && isMonetaryColumn(columnName))) {
                return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            if (format === 'percent') {
                return value.toFixed(1) + '%';
            }
            return value.toLocaleString('en-US');
        }

        return String(value);
    }

    /**
     * Format stat value for display in prompt
     */
    function formatStatValue(value, key) {
        if (typeof value === 'number') {
            const keyLower = key.toLowerCase();
            if (keyLower.includes('total') || keyLower.includes('sum') || keyLower.includes('amount') ||
                keyLower.includes('revenue') || keyLower.includes('spend')) {
                return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            if (keyLower.includes('percent') || keyLower.includes('rate')) {
                return value.toFixed(1) + '%';
            }
            return value.toLocaleString('en-US');
        }
        return String(value);
    }

    /**
     * Build fallback narrative from data summaries when LLM fails
     */
    function buildFallbackNarrative(state) {
        const parts = [];

        state.dataReferences.forEach(ref => {
            const summary = ref.summary || {};
            const toolName = getToolDisplayName(summary.tool) || 'Query';
            parts.push(`${toolName}: ${summary.rowCount || 0} results found.`);

            if (summary.stats) {
                if (summary.stats.total) {
                    parts.push(`Total: $${summary.stats.total.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
                }
            }
        });

        return parts.join(' ') || 'Analysis complete.';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LEGACY PHASE FUNCTIONS (kept for backward compatibility)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Phase 4: ANALYZE - Analyze data with lightweight context
     * LEGACY: Now bypassed in favor of RESPOND phase
     */
    function executeAnalyzePhase(state) {
        const phaseStart = Date.now();
        state.analyzeIterations++;

        // Circuit breaker: prevent infinite analyze loops
        if (state.analyzeIterations >= MAX_ANALYZE_ITERATIONS) {
            log.audit('SCA Analyze circuit breaker triggered', {
                iterations: state.analyzeIterations,
                requestId: state.requestId
            });

            state.analysis = synthesizeFromDataRefs(state);
            state.phase = PHASES.FORMAT;

            upsertThinkingStep(state, 'analyze', {
                title: 'Analyzing results',
                phase: 'analyze',
                status: 'complete',
                context: {
                    circuitBreaker: true,
                    iterations: state.analyzeIterations
                }
            });

            return { success: true, nextPhase: PHASES.FORMAT };
        }

        // Check if we have any data to analyze
        if (state.dataReferences.length === 0 && state.toolInvocations.every(t => !t.success)) {
            // No data - provide a fallback response
            state.analysis = {
                analysis: "I wasn't able to find the data needed to answer your question. Please try rephrasing or providing more specific details.",
                key_findings: []
            };
            state.phase = PHASES.FORMAT;

            upsertThinkingStep(state, 'analyze', {
                title: 'Analyzing results',
                phase: 'analyze',
                status: 'complete',
                context: {
                    noData: true
                }
            });

            return { success: true, nextPhase: PHASES.FORMAT };
        }

        // Build data references for prompt
        const dataRefStrings = state.dataReferences.map(ref =>
            DataStore.formatReferenceForPrompt(ref)
        ).join('\n\n');

        const prompt = ANALYZE_PROMPT
            .replace('{question}', state.message)
            .replace('{data_references}', dataRefStrings || 'No data available');

        // Update thinking step (same step, just update status)
        upsertThinkingStep(state, 'analyze', {
            title: 'Analyzing results',
            phase: 'analyze',
            status: 'active',
            context: {
                dataRefs: state.dataReferences.length,
                iteration: state.analyzeIterations
            }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.2,
                maxTokens: 1000,
                jsonMode: true,
                purpose: 'SCA:analyze'
            });

            const parsed = parseJsonResponse(response?.text);
            const duration = Date.now() - phaseStart;
            state.phaseTimings.analyze = (state.phaseTimings.analyze || 0) + duration;

            // Check for load_data request
            if (parsed?.action === 'load_data' && parsed.refId) {
                if (state.iteration < MAX_DATA_LOADS) {
                    state.phase = PHASES.LOAD_DATA;
                    state.pendingDataLoad = parsed;

                    upsertThinkingStep(state, 'analyze', {
                        title: 'Analyzing results',
                        phase: 'analyze',
                        status: 'active',
                        context: {
                            loadingMoreData: true,
                            refId: parsed.refId
                        }
                    });

                    return { success: true, nextPhase: PHASES.LOAD_DATA };
                }
            }

            // FLEXIBLE: Accept analysis with OR without action field
            // LLM might return: {"analysis": "..."} or {"action": "respond", "analysis": "..."}
            if (parsed?.analysis) {
                state.analysis = {
                    analysis: parsed.analysis,
                    key_findings: parsed.key_findings || []
                };
                state.phase = PHASES.FORMAT;

                upsertThinkingStep(state, 'analyze', {
                    title: 'Analyzing results',
                    phase: 'analyze',
                    status: 'complete',
                    duration: duration,
                    context: {
                        hasAnalysis: true,
                        findingsCount: state.analysis.key_findings.length,
                        iteration: state.analyzeIterations
                    },
                    debug: buildDebugInfo(prompt, response, state, {
                        analysisLength: parsed.analysis?.length,
                        findingsCount: parsed.key_findings?.length
                    })
                });

                log.debug('SCA Analyze phase complete', { duration: duration });
                return { success: true, nextPhase: PHASES.FORMAT };
            }

            // If we got here, response was invalid
            throw new Error('Invalid analysis response - missing analysis field. Got: ' +
                (response?.text?.substring(0, 100) || 'empty'));

        } catch (e) {
            const duration = Date.now() - phaseStart;
            log.error('SCA Analyze phase failed', {
                error: e.message,
                duration: duration,
                iteration: state.analyzeIterations
            });
            state.errors.push({ phase: 'analyze', error: e.message, timestamp: Date.now() });

            // Synthesize a basic response from data summaries
            state.analysis = synthesizeFromDataRefs(state);
            state.phase = PHASES.FORMAT;

            upsertThinkingStep(state, 'analyze', {
                title: 'Analyzing results',
                phase: 'analyze',
                status: 'complete',
                duration: duration,
                context: {
                    fallback: true,
                    error: e.message.substring(0, 100),
                    iteration: state.analyzeIterations
                }
            });

            return { success: true, nextPhase: PHASES.FORMAT };
        }
    }

    /**
     * Phase 4b: LOAD_DATA - Load additional data on demand
     */
    function executeLoadDataPhase(state) {
        const cmd = state.pendingDataLoad;
        if (!cmd || !cmd.refId) {
            state.phase = PHASES.ANALYZE;
            return { success: true, nextPhase: PHASES.ANALYZE };
        }

        try {
            const result = DataStore.executeCommand(state.requestId, {
                action: cmd.action || 'LOAD_ROWS',
                refId: cmd.refId,
                start: cmd.start || 0,
                end: cmd.end || 19
            });

            if (result && result.rows) {
                // Add loaded data to the reference
                const existingRef = state.dataReferences.find(r => r.refId === cmd.refId);
                if (existingRef) {
                    existingRef.loadedRows = result.rows;
                    existingRef.summary.loadedData = true;
                }
            }

            state.pendingDataLoad = null;
            state.phase = PHASES.ANALYZE;
            state.iteration++;

            log.debug('SCA Load data phase complete', { rowsLoaded: result?.rows?.length || 0 });
            return { success: true, nextPhase: PHASES.ANALYZE };

        } catch (e) {
            log.error('SCA Load data phase failed', { error: e.message });
            state.pendingDataLoad = null;
            state.phase = PHASES.ANALYZE;
            return { success: true, nextPhase: PHASES.ANALYZE };
        }
    }

    /**
     * Phase 5: FORMAT - Create rich response blocks
     */
    function executeFormatPhase(state) {
        const phaseStart = Date.now();
        state.formatIterations++;

        // Circuit breaker: prevent infinite format loops
        if (state.formatIterations >= MAX_FORMAT_ITERATIONS) {
            log.audit('SCA Format circuit breaker triggered', {
                iterations: state.formatIterations,
                requestId: state.requestId
            });

            state.formattedResponse = {
                title: 'Analysis Results',
                summary: state.analysis?.analysis?.substring(0, 100) || 'Analysis complete',
                blocks: [
                    { type: 'text', content: state.analysis?.analysis || 'Unable to format response' }
                ]
            };
            state.phase = PHASES.COMPLETE;

            upsertThinkingStep(state, 'format', {
                title: 'Formatting response',
                phase: 'format',
                status: 'complete',
                context: {
                    circuitBreaker: true,
                    iterations: state.formatIterations
                }
            });

            return { success: true, nextPhase: PHASES.COMPLETE };
        }

        const dataSummary = state.dataReferences.map(ref => {
            const s = ref.summary;
            return `${s.tool}: ${s.rowCount} rows, columns: ${(s.columns || []).join(', ')}`;
        }).join('\n');

        const prompt = FORMAT_PROMPT
            .replace('{analysis}', state.analysis?.analysis || 'No analysis available')
            .replace('{findings}', (state.analysis?.key_findings || []).join('\n') || 'No specific findings')
            .replace('{data_summary}', dataSummary || 'No data');

        upsertThinkingStep(state, 'format', {
            title: 'Formatting response',
            phase: 'format',
            status: 'active',
            context: {
                iteration: state.formatIterations
            }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.1,
                maxTokens: 1500,
                jsonMode: true,
                purpose: 'SCA:format'
            });

            const parsed = parseJsonResponse(response?.text);
            const duration = Date.now() - phaseStart;
            state.phaseTimings.format = (state.phaseTimings.format || 0) + duration;

            // FLEXIBLE: Accept response with blocks array
            if (parsed && (parsed.blocks || parsed.title || parsed.summary)) {
                state.formattedResponse = {
                    title: parsed.title || 'Analysis Results',
                    summary: parsed.summary || state.analysis?.analysis?.substring(0, 100) || '',
                    blocks: parsed.blocks || [{ type: 'text', content: state.analysis?.analysis || '' }]
                };
                state.phase = PHASES.COMPLETE;

                // Enrich table blocks with actual data
                enrichTableBlocks(state);

                upsertThinkingStep(state, 'format', {
                    title: 'Formatting response',
                    phase: 'format',
                    status: 'complete',
                    duration: duration,
                    context: {
                        blockCount: state.formattedResponse.blocks.length,
                        blockTypes: state.formattedResponse.blocks.map(b => b.type)
                    },
                    debug: buildDebugInfo(prompt, response, state, {
                        responseTitle: parsed.title,
                        blockCount: parsed.blocks?.length
                    })
                });

                log.debug('SCA Format phase complete', {
                    blockCount: state.formattedResponse.blocks.length,
                    duration: duration
                });
                return { success: true, nextPhase: PHASES.COMPLETE };
            }

            throw new Error('Invalid format response - missing blocks/title/summary');

        } catch (e) {
            const duration = Date.now() - phaseStart;
            log.error('SCA Format phase failed', {
                error: e.message,
                duration: duration,
                iteration: state.formatIterations
            });
            state.errors.push({ phase: 'format', error: e.message, timestamp: Date.now() });

            // Create basic formatted response
            state.formattedResponse = {
                title: 'Analysis Results',
                summary: state.analysis?.analysis?.substring(0, 100) || 'Analysis complete',
                blocks: [
                    { type: 'text', content: state.analysis?.analysis || 'Unable to format response' }
                ]
            };
            state.phase = PHASES.COMPLETE;

            upsertThinkingStep(state, 'format', {
                title: 'Formatting response',
                phase: 'format',
                status: 'complete',
                duration: duration,
                context: {
                    fallback: true,
                    error: e.message.substring(0, 100),
                    iteration: state.formatIterations
                }
            });

            return { success: true, nextPhase: PHASES.COMPLETE };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Add progressive table blocks immediately after INVOKE phase
     * Uses REAL data from DataStore - NO hallucination possible
     * Tables render in frontend BEFORE LLM generates narrative text
     */
    function addProgressiveTableBlocks(state) {
        if (!state.dataReferences || state.dataReferences.length === 0) {
            log.debug('SCA addProgressiveTableBlocks - no data refs', { requestId: state.requestId });
            return;
        }

        state.dataReferences.forEach((ref, index) => {
            try {
                // Load actual data rows
                const data = DataStore.loadRows(state.requestId, ref.refId, 0, 19);
                if (!data || !data.rows || data.rows.length === 0) {
                    log.debug('SCA addProgressiveTableBlocks - no rows for ref', { refId: ref.refId });
                    return;
                }

                const summary = ref.summary || {};
                const toolDisplayName = getToolDisplayName(summary.tool) || 'Results';

                // Build table block with REAL data
                const displayColumns = data.columns.slice(0, 8); // Limit columns for display
                const tableBlock = {
                    type: 'table',
                    title: toolDisplayName,
                    dataRef: ref.refId,
                    totalRows: data.totalRows,
                    headers: displayColumns,
                    rows: data.rows.slice(0, 10).map(row => {
                        return displayColumns.map(col => formatCellValue(row[col], col));
                    }),
                    // Include summary stats for context
                    summary: {
                        rowCount: data.totalRows,
                        columns: data.columns.length,
                        aggregates: summary.aggregates
                    }
                };

                // Add to progress store for immediate frontend rendering
                ProgressStore.addBlock(state.requestId, tableBlock);

                log.debug('SCA addProgressiveTableBlocks - added table block', {
                    requestId: state.requestId,
                    refId: ref.refId,
                    rowCount: tableBlock.rows.length,
                    totalRows: data.totalRows
                });

            } catch (e) {
                log.error('SCA addProgressiveTableBlocks - error building block', {
                    requestId: state.requestId,
                    refId: ref.refId,
                    error: e.message
                });
            }
        });
    }

    function parseJsonResponse(text) {
        if (!text) return null;

        // Try direct parse
        try {
            return JSON.parse(text);
        } catch (e) {
            // Try to extract JSON from markdown code block
            const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (match) {
                try {
                    return JSON.parse(match[1].trim());
                } catch (e2) {
                    // ignore
                }
            }

            // Try to find JSON object in text using balanced brace matching
            let depth = 0;
            let startIndex = -1;

            for (let i = 0; i < text.length; i++) {
                if (text[i] === '{') {
                    if (depth === 0) startIndex = i;
                    depth++;
                } else if (text[i] === '}') {
                    depth--;
                    if (depth === 0 && startIndex !== -1) {
                        try {
                            return JSON.parse(text.substring(startIndex, i + 1));
                        } catch (e3) {
                            // Continue searching
                            startIndex = -1;
                        }
                    }
                }
            }
        }
        return null;
    }

    function getDefaultToolsForIntent(intent) {
        const defaults = {
            'entity_lookup': ['resolve_entity'],
            'top_list': ['get_top_customers'],
            'aging': ['get_ar_aging'],
            'reporting': ['get_recent_transactions'],
            'dashboard': ['dashboard_health'],
            'comparison': ['compare_periods'],
            'transaction': ['get_transaction_detail'],
            'general': ['get_fiscal_context']
        };
        return defaults[intent] || ['get_recent_transactions'];
    }

    function synthesizeFromDataRefs(state) {
        if (!state.dataReferences || state.dataReferences.length === 0) {
            return {
                analysis: 'No data was retrieved to analyze.',
                key_findings: []
            };
        }

        const summaries = state.dataReferences.map(ref => {
            const s = ref.summary;
            const insights = s.insights ? s.insights.join('. ') : '';
            return `${s.tool}: ${s.rowCount} results. ${insights}`;
        });

        return {
            analysis: summaries.join('\n\n') || 'Data retrieved successfully.',
            key_findings: state.dataReferences.flatMap(ref => ref.summary?.insights || [])
        };
    }

    function enrichTableBlocks(state) {
        if (!state.formattedResponse || !state.formattedResponse.blocks) return;

        state.formattedResponse.blocks.forEach(block => {
            if (block.type === 'table' && (!block.rows || block.rows.length === 0)) {
                // Try to populate from data references
                const dataRef = state.dataReferences[0];
                if (dataRef && dataRef.summary.preview) {
                    const preview = dataRef.summary.preview;
                    const cols = dataRef.summary.columns?.slice(0, 5) || [];

                    block.headers = block.headers || cols;
                    block.rows = preview.map(p => {
                        // Load actual row data if available
                        const data = DataStore.loadRows(state.requestId, dataRef.refId, p.rank - 1, p.rank - 1);
                        if (data && data.rows && data.rows[0]) {
                            return block.headers.map(h => formatCellValue(data.rows[0][h], h));
                        }
                        // Fallback to preview data
                        return [p.rank, p.name || '', p.value ? formatCellValue(p.value, 'amount') : ''];
                    });
                }
            }
        });
    }

    /**
     * Format cell value based on column type
     * Only formats monetary columns as currency, leaves IDs and counts as plain numbers
     */
    function formatCellValue(val, columnName) {
        if (val === null || val === undefined) return '';
        if (typeof val === 'number') {
            // Check if this is a monetary column
            const isMonetary = columnName ? isMonetaryColumn(columnName) : false;
            if (isMonetary) {
                return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            // For non-monetary numbers, just format with commas if large
            return val.toLocaleString('en-US');
        }
        return String(val);
    }

    /**
     * Check if a column contains monetary values based on its name
     */
    function isMonetaryColumn(col) {
        if (!col) return false;
        const lower = col.toLowerCase();
        // Patterns that are explicitly NOT monetary (even if they contain monetary words)
        const nonMonetaryPatterns = ['_id', 'id_', 'customer_id', 'vendor_id', 'employee_id',
            'account_id', 'internal_id', 'count', 'number', 'qty', 'quantity', 'rank', 'invoice_count'];
        if (nonMonetaryPatterns.some(p => lower.includes(p) || lower === p.replace('_', ''))) {
            return false;
        }
        // Patterns that indicate monetary values
        const monetaryPatterns = [
            'amount', 'total', 'balance', 'spend', 'revenue', 'cost',
            'price', 'debit', 'credit', 'payment', 'bucket', 'outstanding',
            'current_bucket', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90',
            'cash', 'expense', 'income', 'profit', 'loss', 'fee', 'charge'
        ];
        return monetaryPatterns.some(p => lower.includes(p));
    }

    /**
     * Get a user-friendly display name for a tool
     */
    function getToolDisplayName(toolName) {
        if (!toolName) return null;
        const displayNames = {
            'get_ar_aging': 'AR Aging Summary',
            'get_ap_aging': 'AP Aging Summary',
            'get_top_customers': 'Top Customers',
            'get_top_vendors': 'Top Vendors',
            'get_customer_revenue': 'Customer Revenue',
            'get_vendor_spend': 'Vendor Spend',
            'get_gl_activity': 'GL Activity',
            'get_trial_balance': 'Trial Balance',
            'get_income_statement': 'Income Statement',
            'get_balance_sheet': 'Balance Sheet',
            'get_cash_position': 'Cash Position',
            'get_recent_transactions': 'Recent Transactions',
            'resolve_entity': 'Entity Lookup',
            'resolve_gl_account': 'Account Lookup',
            'resolve_classification': 'Classification Lookup',
            'run_custom_query': 'Custom Query'
        };
        return displayNames[toolName] || toolName.replace(/^get_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN EXECUTION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Initialize streaming agent state
     */
    function initState(message, sessionContext, requestId) {
        const state = initStreamingState(message, sessionContext, requestId);

        // Import any existing resolved entities from session
        if (sessionContext && sessionContext.resolvedEntities) {
            state.resolvedEntities = { ...sessionContext.resolvedEntities };
        }

        // Mark as using streaming agent
        state.useStreamingAgent = true;

        return state;
    }

    /**
     * Run one step of the streaming agent
     * Returns { hasMore: boolean, phase: string } or { hasMore: false, response: object }
     */
    function runStep(state) {
        log.debug('SCA runStep', {
            phase: state.phase,
            iteration: state.iteration,
            analyzeIter: state.analyzeIterations,
            formatIter: state.formatIterations
        });

        let result;

        switch (state.phase) {
            case PHASES.INIT:
                state.phase = PHASES.INTENT;
                return { hasMore: true, phase: PHASES.INTENT };

            case PHASES.INTENT:
                result = executeIntentPhase(state);
                return { hasMore: true, phase: result.nextPhase };

            case PHASES.SELECT:
                result = executeSelectPhase(state);
                return { hasMore: true, phase: result.nextPhase };

            case PHASES.INVOKE:
                result = executeInvokePhase(state);
                // Route to appropriate next phase
                if (result.nextPhase === PHASES.RESPOND) {
                    return { hasMore: true, phase: PHASES.RESPOND };
                }
                if (result.nextPhase === PHASES.ANALYZE) {
                    return { hasMore: true, phase: PHASES.ANALYZE };
                }
                return { hasMore: true, phase: PHASES.INVOKE };

            case PHASES.RESPOND:
                result = executeRespondPhase(state);
                if (result.nextPhase === PHASES.COMPLETE) {
                    return {
                        hasMore: false,
                        response: buildFinalResponse(state)
                    };
                }
                return { hasMore: true, phase: result.nextPhase };

            case PHASES.ANALYZE:
                result = executeAnalyzePhase(state);
                return { hasMore: true, phase: result.nextPhase };

            case PHASES.LOAD_DATA:
                result = executeLoadDataPhase(state);
                return { hasMore: true, phase: result.nextPhase };

            case PHASES.FORMAT:
                result = executeFormatPhase(state);
                if (result.nextPhase === PHASES.COMPLETE) {
                    return {
                        hasMore: false,
                        response: buildFinalResponse(state)
                    };
                }
                return { hasMore: true, phase: result.nextPhase };

            case PHASES.COMPLETE:
                return {
                    hasMore: false,
                    response: buildFinalResponse(state)
                };

            default:
                log.error('SCA Unknown phase', { phase: state.phase });
                return { hasMore: false, error: 'Unknown phase: ' + state.phase };
        }
    }

    /**
     * Build final response object
     */
    function buildFinalResponse(state) {
        const formatted = state.formattedResponse || {};
        const duration = Date.now() - state.startTime;

        const response = {
            text: state.analysis?.analysis || formatted.summary || 'Analysis complete',
            richContent: formatted.blocks || [],
            title: formatted.title,
            summary: formatted.summary,
            sessionContext: {
                resolvedEntities: state.resolvedEntities
            },
            metadata: {
                phases: {
                    intent: state.intent,
                    toolsUsed: state.selectedTools,
                    toolResults: state.toolInvocations.map(t => ({
                        tool: t.tool,
                        success: t.success,
                        rowCount: t.rowCount
                    })),
                    dataRefs: state.dataReferences.map(r => r.refId)
                },
                duration: duration,
                phaseTimings: state.phaseTimings,
                iterations: {
                    total: state.iteration,
                    analyze: state.analyzeIterations,
                    format: state.formatIterations
                },
                errors: state.errors.length > 0 ? state.errors : undefined
            }
        };

        // Add debug info if debug mode
        if (Utils.isDebugMode()) {
            response.debug = {
                fullState: {
                    phase: state.phase,
                    intent: state.intent,
                    selectedTools: state.selectedTools,
                    toolInvocations: state.toolInvocations,
                    dataRefCount: state.dataReferences.length,
                    errors: state.errors
                }
            };
        }

        return response;
    }

    /**
     * Run the complete streaming agent (all phases)
     * Used for synchronous execution
     */
    function runComplete(message, sessionContext, requestId) {
        const state = initState(message, sessionContext, requestId);
        let result;
        let iterations = 0;
        const maxIterations = 20; // Safety limit

        while (iterations < maxIterations) {
            result = runStep(state);
            iterations++;

            if (!result.hasMore) {
                break;
            }
        }

        if (iterations >= maxIterations) {
            log.error('SCA Max iterations reached', { requestId });
            return { error: 'Max iterations reached', hasMore: false };
        }

        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        // State management
        initState: initState,
        runStep: runStep,
        runComplete: runComplete,

        // Phase constants
        PHASES: PHASES,

        // Utilities
        getToolManifest: getToolManifest,
        getToolListForPrompt: getToolListForPrompt
    };
});
