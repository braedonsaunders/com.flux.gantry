/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_Agent.js
 * LLM-driven agent loop for intelligent financial analysis
 *
 * ARCHITECTURE:
 * - LLM is the brain - decides everything
 * - No regex, no word lists, no preprocessing
 * - Agent loop iterates until answer is found or max iterations reached
 * - Self-correcting: retries with different approaches on failure
 * - Progressive updates via ProgressStore for real-time UI feedback
 *
 * FLOW:
 * 1. Build system prompt with financial expertise + available tools
 * 2. LLM analyzes user question
 * 3. LLM calls tools as needed (discovery, data, dashboard)
 * 4. LLM synthesizes results into answer
 * 5. Progress tracked for poll-based UI updates
 */
define([
    'N/log',
    './Lib_Advisor_Tools',
    './Lib_Advisor_ProgressStore',
    './Lib_Advisor_AIProviders',
    './Lib_Advisor_ResponseBuilder',
    './Lib_Advisor_Utils',
    '../Lib_Dashboard_Registry',
    '../Lib_Config'
], function(
    log,
    Tools,
    ProgressStore,
    AIProviders,
    ResponseBuilder,
    Utils,
    DashboardRegistry,
    ConfigLib
) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const MAX_ITERATIONS = 15;      // Don't give up easily
    const MAX_TOOL_CALLS_PER_TURN = 5;  // Limit parallel tool calls
    const THINKING_TIER = 1;        // Use tier 1 for reasoning
    const QUERY_TIER = 2;           // Use tier 2 for heavy queries

    // ═══════════════════════════════════════════════════════════════════════════
    // SYSTEM PROMPT - Financial Expert with Tools
    // ═══════════════════════════════════════════════════════════════════════════

    function buildSystemPrompt(fiscalContext, sessionContext) {
        // Get dashboard descriptions
        const dashboards = DashboardRegistry.getDataDashboards();
        const dashboardDescriptions = dashboards.map(d =>
            `- ${d.name} (${d.id}): ${d.description}`
        ).join('\n');

        const resolvedEntitiesContext = sessionContext && sessionContext.resolvedEntities ?
            Object.entries(sessionContext.resolvedEntities)
                .map(([key, entity]) => `  - "${key}" = ${entity.name} (${entity.type}, ID: ${entity.id})`)
                .join('\n') : '  (none yet)';

        return `You are an expert financial analyst assistant integrated with NetSuite ERP.

## CRITICAL: YOU MUST USE TOOLS
**DO NOT describe what tools you would use - ACTUALLY CALL THEM.**
When you need data, make a tool call. Do not explain your plan in text.
If you find yourself writing "I'll use the resolve_gl_account tool..." - STOP and actually call it instead.

## AVAILABLE TOOLS
1. **Discovery tools** - resolve_entity, resolve_gl_account, resolve_classification, explore_schema
2. **Data tools** - get_ap_aging, get_ar_aging, get_vendor_spend, get_customer_revenue, get_gl_activity, get_trial_balance, get_recent_transactions, get_transaction_detail, compare_periods, find_anomalies, get_cash_position, get_expense_breakdown
3. **Dashboard tools** - dashboard_cashflow, dashboard_health, dashboard_burden, dashboard_time, dashboard_integrity, dashboard_vendorperformance, dashboard_customervalue, dashboard_spendvelocity
4. **Utility tools** - get_fiscal_context, run_custom_query

## FISCAL CONTEXT
- Today: ${fiscalContext.currentDate}
- Fiscal year: ${fiscalContext.fiscalYearName} (${fiscalContext.fiscalYearStart} to ${fiscalContext.fiscalYearEnd})
- Period: ${fiscalContext.currentPeriod || 'Unknown'}

## SESSION CONTEXT - Already resolved:
${resolvedEntitiesContext}

## HOW TO ANSWER QUESTIONS
1. If user mentions a name (customer, vendor, account, class) → CALL resolve_entity or resolve_classification
2. If user asks about AP/AR → CALL get_ap_aging or get_ar_aging
3. If user asks about GL activity or transactions → CALL get_gl_activity or get_recent_transactions
4. If user asks about trends, health, metrics → CALL a dashboard tool
5. After getting data, provide your analysis in your response

## ENTITY HINTS
- "Hotels", "West Coast", "Corporate" → likely CLASSES - use resolve_classification
- "Travel", "Meals", "Payroll" → likely GL ACCOUNTS - use resolve_gl_account
- "Drill down" = analyze more detail - it's a COMMAND not an entity

## DASHBOARDS
${dashboardDescriptions}

## RESPONSE STYLE
- Be concise with specific numbers
- Format currency as $X,XXX
- Cite your data source
- Use tables for comparative data`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT LOOP
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Run the agent loop to answer a user question
     *
     * @param {string} message - User's question
     * @param {Array} history - Conversation history
     * @param {object} sessionContext - Session context with resolved entities
     * @param {string} requestId - Request ID for progress tracking
     * @param {object} options - Additional options
     * @returns {object} Final response
     */
    function runAgent(message, history, sessionContext, requestId, options) {
        options = options || {};
        const startTime = Date.now();

        log.debug('Agent starting', {
            requestId: requestId,
            messageLength: message.length,
            historyLength: history ? history.length : 0
        });

        // Get fiscal context
        const fiscalContext = getFiscalContext();

        // Build system prompt
        const systemPrompt = buildSystemPrompt(fiscalContext, sessionContext);

        // Get tool definitions
        const toolDefinitions = Tools.getToolDefinitions();

        // Build chat history for context (last 4 exchanges)
        const chatHistory = [];
        if (history && history.length > 0) {
            const recentHistory = history.slice(-8);
            for (const msg of recentHistory) {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    chatHistory.push({
                        role: msg.role,
                        content: msg.content
                    });
                }
            }
        }

        // Track progress
        ProgressStore.addStep(requestId, {
            type: 'thinking',
            title: 'Understanding your question...',
            status: 'complete'
        });

        // Agent loop - tracks conversation context as augmented prompt
        let iterations = 0;
        let lastToolResults = null;
        let allToolCalls = [];
        let conversationContext = ''; // Accumulates tool call context
        const toolCallSignatures = new Map(); // Track tool calls to detect loops
        let consecutiveRepeats = 0; // Track consecutive repeated calls
        const MAX_REPEATS = 2; // Max times to allow same tool call

        while (iterations < MAX_ITERATIONS) {
            iterations++;

            // Build the prompt for this iteration
            // Include previous tool results in the prompt for context
            let currentPrompt = message;
            if (conversationContext) {
                currentPrompt = message + '\n\n--- Previous tool calls and results ---\n' + conversationContext;
            }

            // If too many repeats, force a final answer
            if (consecutiveRepeats >= MAX_REPEATS) {
                currentPrompt += '\n\n**IMPORTANT: You have tried the same tool multiple times with no results. You MUST now provide a final answer to the user based on what you know, or explain that you could not find the requested information. Do NOT call any more tools.**';
            }

            log.debug('Agent iteration', {
                requestId: requestId,
                iteration: iterations,
                promptLength: currentPrompt.length,
                hasToolContext: !!conversationContext,
                consecutiveRepeats: consecutiveRepeats
            });

            try {
                // Call LLM with tools using correct interface: callAI(prompt, options)
                const llmResponse = AIProviders.callAI(currentPrompt, {
                    systemPrompt: systemPrompt,
                    chatHistory: chatHistory,
                    tools: consecutiveRepeats >= MAX_REPEATS ? null : toolDefinitions, // Remove tools if forcing answer
                    tier: THINKING_TIER,
                    purpose: `Agent iteration ${iterations}`,
                    temperature: 0.2
                });

                // Check for errors
                if (!llmResponse || llmResponse.error) {
                    log.error('LLM call failed', {
                        requestId: requestId,
                        error: llmResponse ? llmResponse.error : 'No response'
                    });

                    ProgressStore.fail(requestId, 'Failed to get AI response');
                    return buildErrorResponse('I encountered an error processing your request. Please try again.', startTime);
                }

                // Handle tool calls
                if (llmResponse.type === 'tool_call' && llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
                    const toolResults = [];
                    let hadRepeat = false;

                    for (const toolCall of llmResponse.toolCalls.slice(0, MAX_TOOL_CALLS_PER_TURN)) {
                        const toolName = toolCall.name || toolCall.function?.name;
                        const toolArgs = toolCall.arguments || toolCall.function?.arguments || {};

                        // Parse arguments if string
                        let parsedArgs = toolArgs;
                        if (typeof toolArgs === 'string') {
                            try {
                                parsedArgs = JSON.parse(toolArgs);
                            } catch (e) {
                                parsedArgs = {};
                            }
                        }

                        // Create signature to detect repeated calls
                        const signature = toolName + '::' + JSON.stringify(parsedArgs);
                        const previousCount = toolCallSignatures.get(signature) || 0;

                        if (previousCount >= MAX_REPEATS) {
                            // Skip this repeated call
                            log.debug('Skipping repeated tool call', {
                                tool: toolName,
                                args: parsedArgs,
                                previousCount: previousCount
                            });

                            hadRepeat = true;
                            conversationContext += `\n[SKIPPED - Already called ${toolName} with same args ${previousCount} times. Try a different approach or provide your answer.]\n`;
                            continue;
                        }

                        // Track this call
                        toolCallSignatures.set(signature, previousCount + 1);

                        // Add progress step BEFORE executing
                        const displayName = Tools.getToolDisplayName(toolName, parsedArgs);
                        ProgressStore.addStep(requestId, {
                            type: 'tool_call',
                            title: displayName,
                            tool: toolName,
                            params: parsedArgs,
                            status: 'running'
                        });

                        // Execute the tool
                        const result = Tools.executeTool(toolName, parsedArgs);

                        // Update progress step with result
                        ProgressStore.updateLastStep(requestId, {
                            status: 'complete',
                            rowCount: result.rowCount || (result.rows ? result.rows.length : 0),
                            success: result.success,
                            summary: summarizeToolResult(result)
                        });

                        toolResults.push({
                            tool: toolName,
                            args: parsedArgs,
                            result: result
                        });

                        allToolCalls.push({
                            tool: toolName,
                            args: parsedArgs,
                            result: result,
                            displayName: displayName
                        });

                        // Add to conversation context for next iteration
                        conversationContext += `\nTool: ${toolName}\n`;
                        conversationContext += `Arguments: ${JSON.stringify(parsedArgs)}\n`;
                        conversationContext += `Result: ${summarizeToolResult(result)}\n`;
                    }

                    lastToolResults = toolResults;

                    // Track repeats - if all calls were skipped, increment repeat counter
                    if (toolResults.length === 0 && hadRepeat) {
                        consecutiveRepeats++;
                        log.debug('All tool calls were repeats', {
                            consecutiveRepeats: consecutiveRepeats,
                            maxRepeats: MAX_REPEATS
                        });
                    } else if (toolResults.length > 0) {
                        // Made progress, reset repeat counter
                        consecutiveRepeats = 0;
                    }

                    // Continue to next iteration with tool results in context
                    continue;
                }

                // Final text response - we're done!
                if (llmResponse.text) {
                    log.debug('Agent completed', {
                        requestId: requestId,
                        iterations: iterations,
                        duration: Date.now() - startTime
                    });

                    // Build rich response
                    const response = buildFinalResponse(
                        llmResponse.text,
                        allToolCalls,
                        sessionContext,
                        startTime
                    );

                    // Complete progress
                    ProgressStore.complete(requestId, {
                        answer: llmResponse.text,
                        richContent: response.richContent,
                        sessionContext: response.sessionContext,
                        model: AIProviders.getCurrentModelInfo().model,
                        provider: AIProviders.getCurrentModelInfo().provider
                    });

                    return response;
                }

                // No text and no tool calls - unexpected
                log.debug('Agent received empty response', { requestId: requestId });

            } catch (e) {
                log.error('Agent iteration error', {
                    requestId: requestId,
                    iteration: iterations,
                    error: e.message,
                    stack: e.stack
                });

                // Check for fatal errors that shouldn't retry
                const errorMsg = (e.message || '').toLowerCase();
                const isFatalError =
                    errorMsg.includes('api key') ||
                    errorMsg.includes('authentication') ||
                    errorMsg.includes('unauthorized') ||
                    errorMsg.includes('forbidden') ||
                    errorMsg.includes('rate limit') ||
                    errorMsg.includes('quota') ||
                    errorMsg.includes('invalid_api_key') ||
                    errorMsg.includes('model not found');

                if (isFatalError) {
                    // Don't retry fatal errors
                    ProgressStore.fail(requestId, 'Configuration error: ' + e.message);
                    return buildErrorResponse(
                        'I encountered a configuration error. Please check the AI provider settings. Error: ' + e.message,
                        startTime
                    );
                }

                // Non-fatal error - retry with details
                if (iterations < MAX_ITERATIONS - 1) {
                    ProgressStore.addStep(requestId, {
                        type: 'retry',
                        title: 'Retrying: ' + (e.message || 'Unknown error').substring(0, 50),
                        error: e.message,
                        status: 'complete'
                    });
                    continue;
                }
            }
        }

        // Max iterations reached
        log.debug('Agent reached max iterations', {
            requestId: requestId,
            iterations: iterations
        });

        // Try to synthesize from what we have
        if (lastToolResults && lastToolResults.length > 0) {
            const synthesizedResponse = synthesizeFromToolResults(lastToolResults, message, startTime);

            ProgressStore.complete(requestId, {
                answer: synthesizedResponse.text,
                richContent: synthesizedResponse.richContent,
                sessionContext: sessionContext
            });

            return synthesizedResponse;
        }

        // Truly failed
        ProgressStore.fail(requestId, 'Could not complete analysis after maximum attempts');
        return buildErrorResponse(
            'I was unable to complete the analysis. Could you try rephrasing your question or breaking it into smaller parts?',
            startTime
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get fiscal context
     */
    function getFiscalContext() {
        const now = new Date();
        let fiscalCalendar = { fiscalYearStartMonth: 0, fiscalYearStartDay: 1 };

        try {
            const configCalendar = ConfigLib.getFiscalCalendar();
            if (configCalendar) {
                fiscalCalendar = configCalendar;
            }
        } catch (e) {
            log.debug('Could not get fiscal calendar', { error: e.message });
        }

        const fyStartMonth = fiscalCalendar.fiscalYearStartMonth || 0;
        const fyStartDay = fiscalCalendar.fiscalYearStartDay || 1;

        let fyYear = now.getFullYear();
        if (now.getMonth() < fyStartMonth || (now.getMonth() === fyStartMonth && now.getDate() < fyStartDay)) {
            fyYear = fyYear - 1;
        }

        const fyStart = new Date(fyYear, fyStartMonth, fyStartDay);
        const fyEnd = new Date(fyYear + 1, fyStartMonth, fyStartDay - 1);

        return {
            currentDate: Utils.formatDateYMD(now),
            currentYear: now.getFullYear(),
            currentMonth: now.getMonth() + 1,
            fiscalYearStart: Utils.formatDateYMD(fyStart),
            fiscalYearEnd: Utils.formatDateYMD(fyEnd),
            fiscalYear: fyYear,
            fiscalYearName: 'FY' + fyYear,
            currentPeriod: null // Could query this if needed
        };
    }

    /**
     * Summarize a tool result for progress display
     */
    function summarizeToolResult(result) {
        if (!result.success) {
            return 'Failed: ' + (result.error || 'Unknown error');
        }

        if (result.found === false) {
            return 'Not found';
        }

        if (result.found === true && result.entity) {
            return `Found: ${result.entity.name} (${result.entity.type})`;
        }

        if (result.found === true && result.bestMatch) {
            return `Found: ${result.bestMatch.name || result.bestMatch.account_name || JSON.stringify(result.bestMatch)}`;
        }

        if (result.rowCount !== undefined) {
            return `Found ${result.rowCount} results`;
        }

        if (result.data) {
            return 'Dashboard data retrieved';
        }

        return 'Completed';
    }

    /**
     * Build final response from LLM answer and tool results
     */
    function buildFinalResponse(text, toolCalls, sessionContext, startTime) {
        const steps = [];

        // Add steps from tool calls
        for (const tc of toolCalls) {
            steps.push({
                type: 'agent_step',
                title: tc.displayName,
                tool: tc.tool,
                status: 'complete',
                rowCount: tc.result.rowCount,
                success: tc.result.success
            });
        }

        // Build rich content from text
        const richContent = [];

        // Parse tables from markdown
        const tableRegex = /\|(.+)\|[\r\n]+\|[-:\s|]+\|[\r\n]+((?:\|.+\|[\r\n]*)+)/g;
        let match;
        let lastIndex = 0;

        while ((match = tableRegex.exec(text)) !== null) {
            // Add text before table
            const textBefore = text.substring(lastIndex, match.index).trim();
            if (textBefore) {
                richContent.push({ type: 'text', content: textBefore });
            }

            // Parse table
            const headerRow = match[1].split('|').map(h => h.trim()).filter(h => h);
            const dataRows = match[2].trim().split('\n').map(row =>
                row.split('|').map(cell => cell.trim()).filter(cell => cell)
            );

            richContent.push({
                type: 'table',
                headers: headerRow,
                rows: dataRows
            });

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        const remainingText = text.substring(lastIndex).trim();
        if (remainingText) {
            richContent.push({ type: 'text', content: remainingText });
        }

        // If no rich content parsed, just add the text
        if (richContent.length === 0) {
            richContent.push({ type: 'text', content: text });
        }

        // Update session context with any resolved entities from tool calls
        const updatedSessionContext = sessionContext ? { ...sessionContext } : {};
        updatedSessionContext.resolvedEntities = updatedSessionContext.resolvedEntities || {};

        for (const tc of toolCalls) {
            if (tc.tool === 'resolve_entity' && tc.result.found && tc.result.entity) {
                const key = tc.args.term.toLowerCase().replace(/\s+/g, '_');
                updatedSessionContext.resolvedEntities[key] = tc.result.entity;
            }
            if (tc.tool === 'resolve_classification' && tc.result.found && tc.result.bestMatch) {
                const key = tc.args.term.toLowerCase().replace(/\s+/g, '_');
                updatedSessionContext.resolvedEntities[key] = {
                    id: tc.result.bestMatch.id,
                    name: tc.result.bestMatch.name,
                    type: tc.result.bestMatch.dimension_type || 'classification'
                };
            }
            if (tc.tool === 'resolve_gl_account' && tc.result.found && tc.result.bestMatch) {
                const key = tc.args.term.toLowerCase().replace(/\s+/g, '_');
                updatedSessionContext.resolvedEntities[key] = {
                    id: tc.result.bestMatch.id,
                    name: tc.result.bestMatch.account_name,
                    type: 'account'
                };
            }
        }

        return {
            text: text,
            steps: steps,
            richContent: richContent,
            blocksFormat: true,
            duration: Date.now() - startTime,
            sessionContext: updatedSessionContext,
            model: AIProviders.getCurrentModelInfo().model,
            provider: AIProviders.getCurrentModelInfo().provider
        };
    }

    /**
     * Synthesize response from tool results when LLM didn't complete
     */
    function synthesizeFromToolResults(toolResults, originalMessage, startTime) {
        let text = 'Based on my analysis:\n\n';

        for (const tr of toolResults) {
            if (tr.result.success) {
                if (tr.result.rowCount && tr.result.rowCount > 0) {
                    text += `**${tr.tool}**: Found ${tr.result.rowCount} results\n`;

                    // Show first few rows
                    if (tr.result.rows && tr.result.rows.length > 0) {
                        const preview = tr.result.rows.slice(0, 5);
                        text += '```\n' + JSON.stringify(preview, null, 2) + '\n```\n\n';
                    }
                } else if (tr.result.data) {
                    text += `**Dashboard data** available\n\n`;
                }
            }
        }

        text += '\n*Note: Analysis was interrupted. Please try a more specific question.*';

        return {
            text: text,
            richContent: [{ type: 'text', content: text }],
            blocksFormat: true,
            duration: Date.now() - startTime
        };
    }

    /**
     * Build error response
     */
    function buildErrorResponse(message, startTime) {
        return {
            text: message,
            richContent: [{ type: 'text', content: message }],
            blocksFormat: true,
            duration: Date.now() - startTime,
            error: true
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SYNCHRONOUS EXECUTION (for non-polling mode)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Run agent synchronously without progress tracking
     * Used when polling is not available
     */
    function runAgentSync(message, history, sessionContext, options) {
        // Create a dummy request ID for internal tracking
        const requestId = ProgressStore.generateRequestId();
        ProgressStore.create(requestId, message);

        // Run the agent
        const result = runAgent(message, history, sessionContext, requestId, options);

        // Clean up progress store
        ProgressStore.remove(requestId);

        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        runAgent: runAgent,
        runAgentSync: runAgentSync,
        buildSystemPrompt: buildSystemPrompt,
        MAX_ITERATIONS: MAX_ITERATIONS
    };
});
