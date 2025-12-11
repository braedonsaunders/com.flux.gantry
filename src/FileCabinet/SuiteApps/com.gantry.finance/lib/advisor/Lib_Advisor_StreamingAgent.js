/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_StreamingAgent.js
 * Streaming Context Architecture (SCA) - Multi-Phase Conversation Protocol
 *
 * REVOLUTIONARY APPROACH:
 * Instead of one massive LLM call with 15,000+ tokens that times out,
 * we use multiple lightweight calls of 200-500 tokens that complete in 1-3 seconds.
 *
 * PHASES:
 * 1. INTENT    - Classify the question type (~200 tokens, <1s)
 * 2. SELECT    - Pick relevant tools by name only (~300 tokens, <1s)
 * 3. INVOKE    - Call tool with minimal schema (~200 tokens, <1s)
 * 4. ANALYZE   - Analyze data reference + summary (~400 tokens, 2s)
 * 5. FORMAT    - Structure the response (~300 tokens, 1s)
 *
 * Total: 5-6 calls, 8-15 seconds, with progressive UI updates
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
        ANALYZE: 'analyze',
        LOAD_DATA: 'load_data',
        FORMAT: 'format',
        COMPLETE: 'complete'
    };

    // Use fast/cheap tier for all lightweight calls
    const FAST_TIER = 1;
    const MAX_TOOL_INVOCATIONS = 5;
    const MAX_DATA_LOADS = 3;

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

Response format: {"tools": ["tool1", "tool2"], "reasoning": "brief explanation"}`;

    const INVOKE_PROMPT = `Call this tool. Respond with JSON only.

TOOL: {tool_name}
{tool_schema}

Question context: "{question}"
{resolved_entities}

Response format: {"tool": "{tool_name}", "args": {...}}`;

    const ANALYZE_PROMPT = `Analyze this data to answer the user's question.

QUESTION: "{question}"

{data_references}

Instructions:
- Use the data summaries and previews provided
- If you need more rows, respond with: {"action": "load_data", "command": "LOAD_ROWS", "refId": "ref_xxx", "start": 0, "end": 19}
- If you have enough data, provide your analysis
- Be specific with numbers and percentages

Response format (if ready to answer):
{"action": "respond", "analysis": "Your detailed analysis here", "key_findings": ["finding1", "finding2"]}

Response format (if need more data):
{"action": "load_data", "command": "LOAD_ROWS|LOAD_ALL", "refId": "ref_xxx", "start": 0, "end": 19}`;

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
    // TOOL MANIFEST (Names + One-liners only)
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
            list_saved_searches: "List available saved searches",
            format_response: "Format final response with rich blocks"
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
            startTime: Date.now(),
            errors: []
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE EXECUTORS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Phase 1: INTENT - Classify the question
     */
    function executeIntentPhase(state) {
        const prompt = INTENT_PROMPT.replace('{question}', state.message);

        ProgressStore.addStep(state.requestId, {
            type: 'thinking',
            title: 'Understanding your question',
            status: 'active',
            context: { phase: 'intent' }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.1,
                maxTokens: 200,
                jsonMode: true,
                purpose: 'SCA:intent'
            });

            const parsed = parseJsonResponse(response.text);
            if (parsed && parsed.intent) {
                state.intent = parsed;
                state.phase = PHASES.SELECT;

                ProgressStore.updateStep(state.requestId, {
                    type: 'thinking',
                    title: 'Understanding your question',
                    status: 'complete',
                    context: { intent: parsed.intent, phase: 'intent' }
                });

                log.debug('SCA Intent phase complete', { intent: parsed.intent });
                return { success: true, nextPhase: PHASES.SELECT };
            } else {
                throw new Error('Failed to parse intent response');
            }
        } catch (e) {
            log.error('SCA Intent phase failed', { error: e.message });
            state.errors.push({ phase: 'intent', error: e.message });
            // Default to general reporting intent
            state.intent = { intent: 'reporting', entities: [], time_scope: 'none' };
            state.phase = PHASES.SELECT;
            return { success: true, nextPhase: PHASES.SELECT };
        }
    }

    /**
     * Phase 2: SELECT - Pick tools by name
     */
    function executeSelectPhase(state) {
        const entityContext = state.intent.entities && state.intent.entities.length > 0
            ? `Mentioned entities: ${state.intent.entities.join(', ')}`
            : 'No specific entities mentioned';

        const prompt = SELECT_PROMPT
            .replace('{intent}', state.intent.intent)
            .replace('{tool_list}', getToolListForPrompt())
            .replace('{question}', state.message)
            .replace('{entity_context}', entityContext);

        ProgressStore.addStep(state.requestId, {
            type: 'thinking',
            title: 'Selecting analysis tools',
            status: 'active',
            context: { phase: 'select' }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.1,
                maxTokens: 200,
                jsonMode: true,
                purpose: 'SCA:select'
            });

            const parsed = parseJsonResponse(response.text);
            if (parsed && parsed.tools && parsed.tools.length > 0) {
                state.selectedTools = parsed.tools.slice(0, MAX_TOOL_INVOCATIONS);
                state.phase = PHASES.INVOKE;

                ProgressStore.updateStep(state.requestId, {
                    type: 'thinking',
                    title: 'Selecting analysis tools',
                    status: 'complete',
                    context: { tools: state.selectedTools, phase: 'select' }
                });

                log.debug('SCA Select phase complete', { tools: state.selectedTools });
                return { success: true, nextPhase: PHASES.INVOKE };
            } else {
                throw new Error('No tools selected');
            }
        } catch (e) {
            log.error('SCA Select phase failed', { error: e.message });
            state.errors.push({ phase: 'select', error: e.message });
            // Default to a sensible tool based on intent
            state.selectedTools = getDefaultToolsForIntent(state.intent.intent);
            state.phase = PHASES.INVOKE;
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
            // All tools invoked, move to analyze
            state.phase = PHASES.ANALYZE;
            return { success: true, nextPhase: PHASES.ANALYZE };
        }

        const toolName = state.selectedTools[invokedCount];
        const tool = Tools.getTool(toolName);

        if (!tool) {
            log.error('SCA Unknown tool', { tool: toolName });
            state.toolInvocations.push({ tool: toolName, error: 'Unknown tool' });
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

        ProgressStore.addStep(state.requestId, {
            type: 'tool_call',
            title: Tools.getToolDisplayName(toolName, {}),
            tool: toolName,
            status: 'active'
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.1,
                maxTokens: 300,
                jsonMode: true,
                purpose: `SCA:invoke:${toolName}`
            });

            const parsed = parseJsonResponse(response.text);
            const args = parsed?.args || {};

            // Execute the tool
            const startTime = Date.now();
            const result = Tools.executeTool(toolName, args);
            const duration = Date.now() - startTime;

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

            state.toolInvocations.push({
                tool: toolName,
                args: args,
                success: result.success,
                rowCount: result.rowCount || (result.rows ? result.rows.length : 0),
                dataRef: dataRef?.refId,
                duration: duration
            });

            ProgressStore.updateStep(state.requestId, {
                type: 'tool_call',
                title: Tools.getToolDisplayName(toolName, args),
                tool: toolName,
                params: args,
                status: 'complete',
                success: result.success,
                summary: result.success
                    ? `Found ${result.rowCount || result.rows?.length || 0} results`
                    : result.error,
                duration: duration,
                rowCount: result.rowCount || result.rows?.length || 0
            });

            log.debug('SCA Invoke phase - tool executed', {
                tool: toolName,
                success: result.success,
                rowCount: result.rowCount || 0,
                hasDataRef: !!dataRef
            });

            return { success: true, nextPhase: PHASES.INVOKE }; // Continue with next tool

        } catch (e) {
            log.error('SCA Invoke phase failed', { tool: toolName, error: e.message });
            state.errors.push({ phase: 'invoke', tool: toolName, error: e.message });
            state.toolInvocations.push({ tool: toolName, error: e.message });

            ProgressStore.updateStep(state.requestId, {
                type: 'tool_call',
                title: Tools.getToolDisplayName(toolName, {}),
                tool: toolName,
                status: 'complete',
                success: false,
                summary: e.message
            });

            return { success: true, nextPhase: PHASES.INVOKE }; // Continue with next tool
        }
    }

    /**
     * Phase 4: ANALYZE - Analyze data with lightweight context
     */
    function executeAnalyzePhase(state) {
        // Check if we have any data to analyze
        if (state.dataReferences.length === 0 && state.toolInvocations.every(t => !t.success)) {
            // No data - provide a fallback response
            state.analysis = {
                action: 'respond',
                analysis: "I wasn't able to find the data needed to answer your question. Please try rephrasing or providing more specific details.",
                key_findings: []
            };
            state.phase = PHASES.FORMAT;
            return { success: true, nextPhase: PHASES.FORMAT };
        }

        // Build data references for prompt
        const dataRefStrings = state.dataReferences.map(ref =>
            DataStore.formatReferenceForPrompt(ref)
        ).join('\n\n');

        const prompt = ANALYZE_PROMPT
            .replace('{question}', state.message)
            .replace('{data_references}', dataRefStrings || 'No data available');

        ProgressStore.addStep(state.requestId, {
            type: 'thinking',
            title: 'Analyzing results',
            status: 'active',
            context: { phase: 'analyze' }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.2,
                maxTokens: 1000,
                jsonMode: true,
                purpose: 'SCA:analyze'
            });

            const parsed = parseJsonResponse(response.text);

            if (parsed?.action === 'load_data') {
                // LLM wants more data
                if (state.iteration < MAX_DATA_LOADS) {
                    state.phase = PHASES.LOAD_DATA;
                    state.pendingDataLoad = parsed;
                    return { success: true, nextPhase: PHASES.LOAD_DATA };
                }
            }

            if (parsed?.action === 'respond' && parsed.analysis) {
                state.analysis = parsed;
                state.phase = PHASES.FORMAT;

                ProgressStore.updateStep(state.requestId, {
                    type: 'thinking',
                    title: 'Analyzing results',
                    status: 'complete',
                    context: { phase: 'analyze' }
                });

                log.debug('SCA Analyze phase complete');
                return { success: true, nextPhase: PHASES.FORMAT };
            }

            throw new Error('Invalid analysis response');

        } catch (e) {
            log.error('SCA Analyze phase failed', { error: e.message });
            state.errors.push({ phase: 'analyze', error: e.message });

            // Synthesize a basic response from data summaries
            state.analysis = synthesizeFromDataRefs(state);
            state.phase = PHASES.FORMAT;
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
            const result = DataStore.executeCommand(state.requestId, cmd);

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
        const dataSummary = state.dataReferences.map(ref => {
            const s = ref.summary;
            return `${s.tool}: ${s.rowCount} rows, columns: ${s.columns.join(', ')}`;
        }).join('\n');

        const prompt = FORMAT_PROMPT
            .replace('{analysis}', state.analysis?.analysis || 'No analysis available')
            .replace('{findings}', (state.analysis?.key_findings || []).join('\n'))
            .replace('{data_summary}', dataSummary || 'No data');

        ProgressStore.addStep(state.requestId, {
            type: 'thinking',
            title: 'Formatting response',
            status: 'active',
            context: { phase: 'format' }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.1,
                maxTokens: 1500,
                jsonMode: true,
                purpose: 'SCA:format'
            });

            const parsed = parseJsonResponse(response.text);

            if (parsed && parsed.blocks) {
                state.formattedResponse = parsed;
                state.phase = PHASES.COMPLETE;

                // Enrich table blocks with actual data
                enrichTableBlocks(state);

                ProgressStore.updateStep(state.requestId, {
                    type: 'thinking',
                    title: 'Formatting response',
                    status: 'complete',
                    context: { phase: 'format' }
                });

                log.debug('SCA Format phase complete', { blockCount: parsed.blocks.length });
                return { success: true, nextPhase: PHASES.COMPLETE };
            }

            throw new Error('Invalid format response');

        } catch (e) {
            log.error('SCA Format phase failed', { error: e.message });
            state.errors.push({ phase: 'format', error: e.message });

            // Create basic formatted response
            state.formattedResponse = {
                title: 'Analysis Results',
                summary: state.analysis?.analysis || 'Analysis complete',
                blocks: [
                    { type: 'text', content: state.analysis?.analysis || 'Unable to format response' }
                ]
            };
            state.phase = PHASES.COMPLETE;
            return { success: true, nextPhase: PHASES.COMPLETE };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

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

            // Try to find JSON object in text
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[0]);
                } catch (e3) {
                    // ignore
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
        const summaries = state.dataReferences.map(ref => {
            const s = ref.summary;
            const insights = s.insights ? s.insights.join('. ') : '';
            return `${s.tool}: ${s.rowCount} results. ${insights}`;
        });

        return {
            action: 'respond',
            analysis: summaries.join('\n\n') || 'Data retrieved successfully.',
            key_findings: state.dataReferences.flatMap(ref => ref.summary.insights || [])
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
                    const cols = dataRef.summary.columns.slice(0, 5);

                    block.headers = block.headers || cols;
                    block.rows = preview.map(p => {
                        // Load actual row data if available
                        const data = DataStore.loadRows(state.requestId, dataRef.refId, p.rank - 1, p.rank - 1);
                        if (data && data.rows && data.rows[0]) {
                            return block.headers.map(h => formatCellValue(data.rows[0][h]));
                        }
                        return [p.rank, p.name || '', p.value ? formatCellValue(p.value) : ''];
                    });
                }
            }
        });
    }

    function formatCellValue(val) {
        if (val === null || val === undefined) return '';
        if (typeof val === 'number') {
            if (Math.abs(val) >= 1000) {
                return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            return val.toString();
        }
        return String(val);
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

        return state;
    }

    /**
     * Run one step of the streaming agent
     * Returns { hasMore: boolean, phase: string } or { hasMore: false, response: object }
     */
    function runStep(state) {
        log.debug('SCA runStep', { phase: state.phase, iteration: state.iteration });

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
                if (result.nextPhase === PHASES.ANALYZE) {
                    return { hasMore: true, phase: PHASES.ANALYZE };
                }
                return { hasMore: true, phase: PHASES.INVOKE };

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

        return {
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
                    dataRefs: state.dataReferences.map(r => r.refId)
                },
                duration: duration,
                errors: state.errors
            }
        };
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
