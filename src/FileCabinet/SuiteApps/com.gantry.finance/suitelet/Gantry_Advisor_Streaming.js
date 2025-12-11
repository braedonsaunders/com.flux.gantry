/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * Gantry_Advisor_Streaming.js
 *
 * Frontend-Orchestrated Agent Loop for REAL streaming.
 *
 * Instead of one 28-second request, the frontend makes many 1-3 second requests.
 * Each request advances the conversation state. This achieves "streaming" via
 * multiple fast HTTP requests instead of relying on chunked transfer encoding.
 *
 * FLOW:
 * 1. Frontend: POST action=init, query="..." → Get sessionId + thinking
 * 2. Frontend: POST action=step, sessionId="..." → Execute next action (tool/think)
 * 3. Frontend: Repeat step until state=complete
 *
 * ACTIONS:
 * - init: Start new conversation, LLM decides first actions
 * - step: Execute next pending action (tool call or LLM thinking)
 * - status: Get current session state without executing
 * - cancel: Cancel and cleanup session
 */
define([
    'N/log',
    'N/llm',
    '../lib/advisor/Lib_Advisor_Session',
    '../lib/advisor/Lib_Advisor_Tools'
], function(log, llm, Session, Tools) {
    'use strict';

    // Maximum iterations to prevent infinite loops
    const MAX_ITERATIONS = 15;

    /**
     * Build system prompt for the advisor
     */
    function getSystemPrompt() {
        return `You are a financial analyst assistant connected to a LIVE NetSuite ERP database.

## CRITICAL: YOU MUST USE TOOLS FOR ANY DATA QUESTIONS
You have NO knowledge of this company's actual financial data. You MUST use tools to query the live database.

**For ANY question about:**
- Vendors, spending, purchases → USE TOOLS
- Transactions, GL activity → USE TOOLS
- Account balances, revenue, expenses → USE TOOLS
- Customers, employees, entities → USE TOOLS

**DO NOT:**
- Make up numbers or data
- Say "I don't have access to your data"
- Describe what tools you WOULD use - actually CALL them

## Available Tool Categories
- **Discovery**: resolve_classification, resolve_account, search_vendors, search_customers
- **Data**: get_gl_activity, get_vendor_spending, get_account_balance, get_transaction_details
- **Analysis**: get_spending_by_category, get_revenue_trends

## Response Flow
1. User asks a question about their data
2. YOU MUST call at least one tool to get real data
3. Analyze the results
4. Provide answer with actual numbers from the tools

REMEMBER: You are connected to a LIVE database. Use the tools!`;
    }

    /**
     * Handle incoming requests
     */
    function onRequest(context) {
        const request = context.request;
        const response = context.response;

        // Set JSON response type
        response.setHeader({
            name: 'Content-Type',
            value: 'application/json'
        });

        try {
            let result;

            // Get action and parameters (works for both GET and POST)
            const action = request.parameters.action || 'test';
            const sessionId = request.parameters.sessionId;
            const query = request.parameters.query;

            // For POST, also check body
            let bodyParams = {};
            if (request.method === 'POST' && request.body) {
                try {
                    bodyParams = JSON.parse(request.body);
                } catch (e) {
                    // Ignore parse errors, use URL params
                }
            }

            // Merge body params (POST body takes precedence)
            const finalAction = bodyParams.action || action;
            const finalSessionId = bodyParams.sessionId || sessionId;
            const finalQuery = bodyParams.query || query;

            // Handle actions (same for GET and POST)
            switch (finalAction) {
                case 'init':
                    result = handleInit(finalQuery);
                    break;

                case 'step':
                    result = handleStep(finalSessionId);
                    break;

                case 'status':
                    result = handleStatus(finalSessionId);
                    break;

                case 'cancel':
                    result = handleCancel(finalSessionId);
                    break;

                case 'demo':
                    // Demo mode - simulates streaming without LLM
                    result = handleDemo(finalSessionId, finalQuery);
                    break;

                case 'test':
                default:
                    result = {
                        success: true,
                        message: 'Advisor Streaming API ready',
                        actions: ['init', 'step', 'status', 'cancel', 'demo'],
                        usage: 'Add ?action=init&query=YOUR_QUESTION to start'
                    };
            }

            response.write(JSON.stringify(result));

        } catch (e) {
            log.error('Advisor Streaming Error', { message: e.message, stack: e.stack });
            response.write(JSON.stringify({
                success: false,
                error: e.message
            }));
        }
    }

    /**
     * INIT: Start a new conversation
     * - Creates session
     * - Calls LLM to decide initial actions
     * - Returns session ID and first update
     */
    function handleInit(query) {
        if (!query || query.trim() === '') {
            return { success: false, error: 'Query is required' };
        }

        log.debug('Init Starting', { query: query });

        // Create session
        const session = Session.createSession(query.trim());

        // Add thinking indicator
        Session.addIntermediateResult(session, 'thinking', {
            title: 'Understanding your question...'
        });

        // Call LLM to decide what to do
        const llmResult = callLLMForDecision(session);

        if (!llmResult.success) {
            session.state = 'error';
            Session.updateSession(session);
            return {
                success: false,
                sessionId: session.id,
                error: llmResult.error
            };
        }

        // Process LLM response
        processLLMResponse(session, llmResult);

        // Save session
        Session.updateSession(session);

        return {
            success: true,
            sessionId: session.id,
            state: session.state,
            update: getLatestUpdate(session),
            hasMore: session.state !== 'complete' && session.state !== 'error'
        };
    }

    /**
     * STEP: Execute next action
     * - If tools pending: execute next tool
     * - If tools complete: call LLM to decide next
     * - If LLM says done: return final answer
     */
    function handleStep(sessionId) {
        if (!sessionId) {
            return { success: false, error: 'sessionId is required' };
        }

        // Get session
        const session = Session.getSession(sessionId);
        if (!session) {
            return { success: false, error: 'Session not found or expired' };
        }

        // Check if already complete
        if (session.state === 'complete') {
            return {
                success: true,
                sessionId: session.id,
                state: 'complete',
                update: {
                    type: 'answer',
                    content: session.finalAnswer
                },
                hasMore: false
            };
        }

        // Check iteration limit
        session.iteration++;
        if (session.iteration > MAX_ITERATIONS) {
            session.state = 'complete';
            session.finalAnswer = 'I was unable to complete the analysis within the allowed iterations. Please try a more specific question.';
            Session.updateSession(session);
            return {
                success: true,
                sessionId: session.id,
                state: 'complete',
                update: { type: 'answer', content: session.finalAnswer },
                hasMore: false
            };
        }

        log.debug('Step', { sessionId: sessionId, state: session.state, iteration: session.iteration });

        let update;

        // Execute based on current state
        if (session.state === 'tool_pending' && Session.hasMoreTools(session)) {
            // Execute next tool
            update = executeNextTool(session);
        } else {
            // Call LLM to decide what to do next
            Session.addIntermediateResult(session, 'thinking', {
                title: 'Analyzing...'
            });

            const llmResult = callLLMForDecision(session);

            if (!llmResult.success) {
                session.state = 'error';
                Session.updateSession(session);
                return {
                    success: false,
                    sessionId: session.id,
                    error: llmResult.error
                };
            }

            update = processLLMResponse(session, llmResult);
        }

        // Save session
        Session.updateSession(session);

        return {
            success: true,
            sessionId: session.id,
            state: session.state,
            update: update || getLatestUpdate(session),
            hasMore: session.state !== 'complete' && session.state !== 'error'
        };
    }

    /**
     * STATUS: Get current session state
     */
    function handleStatus(sessionId) {
        if (!sessionId) {
            return { success: false, error: 'sessionId is required' };
        }

        const session = Session.getSession(sessionId);
        if (!session) {
            return { success: false, error: 'Session not found or expired' };
        }

        return {
            success: true,
            sessionId: session.id,
            state: session.state,
            iteration: session.iteration,
            toolsExecuted: session.executedTools.length,
            toolsPending: session.pendingToolCalls.length - session.currentToolIndex,
            hasMore: session.state !== 'complete' && session.state !== 'error'
        };
    }

    /**
     * CANCEL: End session early
     */
    function handleCancel(sessionId) {
        if (!sessionId) {
            return { success: false, error: 'sessionId is required' };
        }

        Session.deleteSession(sessionId);

        return {
            success: true,
            message: 'Session cancelled'
        };
    }

    /**
     * DEMO: Simulated streaming for testing (no LLM needed)
     * Call with action=demo to start, then keep calling with same sessionId
     */
    function handleDemo(sessionId, query) {
        // Demo steps to simulate
        const DEMO_STEPS = [
            { type: 'thinking', title: 'Understanding your question...' },
            { type: 'tool_call', tool: 'search_vendors', arguments: { query: 'top spending' }, status: 'pending' },
            { type: 'tool_result', tool: 'search_vendors', result: { vendors: ['Acme Corp', 'Globex Inc', 'Initech'] } },
            { type: 'tool_call', tool: 'get_vendor_spending', arguments: { vendor_id: '123' }, status: 'pending' },
            { type: 'tool_result', tool: 'get_vendor_spending', result: { total: 45000, transactions: 12 } },
            { type: 'thinking', title: 'Analyzing the results...' },
            { type: 'answer', content: 'Based on my analysis, your top 3 vendors by spend are:\n\n1. **Acme Corp** - $45,000 (12 transactions)\n2. **Globex Inc** - $32,500 (8 transactions)\n3. **Initech** - $28,750 (15 transactions)\n\nTotal spend across these vendors: $106,250' }
        ];

        // If no sessionId, start new demo
        if (!sessionId) {
            const newSessionId = 'demo_' + Date.now();
            return {
                success: true,
                sessionId: newSessionId,
                state: 'demo',
                stepIndex: 0,
                update: DEMO_STEPS[0],
                hasMore: true
            };
        }

        // Parse step index from sessionId or use provided
        let stepIndex = 0;
        const match = sessionId.match(/demo_(\d+)_step(\d+)/);
        if (match) {
            stepIndex = parseInt(match[2], 10) + 1;
        } else if (sessionId.startsWith('demo_')) {
            stepIndex = 1;
        }

        // Check if demo is complete
        if (stepIndex >= DEMO_STEPS.length) {
            return {
                success: true,
                sessionId: sessionId,
                state: 'complete',
                update: DEMO_STEPS[DEMO_STEPS.length - 1],
                hasMore: false
            };
        }

        // Return next step
        const newSessionId = 'demo_' + Date.now() + '_step' + stepIndex;
        return {
            success: true,
            sessionId: newSessionId,
            state: 'demo',
            stepIndex: stepIndex,
            update: DEMO_STEPS[stepIndex],
            hasMore: stepIndex < DEMO_STEPS.length - 1
        };
    }

    /**
     * Convert tool definitions to N/llm Tool objects
     * NetSuite requires tools to be created with llm.createTool()
     */
    function convertToLLMTools(toolDefinitions) {
        const llmTools = [];

        for (const toolDef of toolDefinitions) {
            try {
                const tool = llm.createTool({
                    name: toolDef.name,
                    description: toolDef.description,
                    parameters: toolDef.parameters
                });
                llmTools.push(tool);
            } catch (e) {
                log.error('Tool conversion error', { tool: toolDef.name, error: e.message });
            }
        }

        return llmTools;
    }

    function callLLMForDecision(session) {
        try {
            // Build conversation context
            const conversationContext = Session.buildConversationContext(session);

            // Get tool definitions and convert to N/llm Tool objects
            const toolDefinitions = Tools.getToolDefinitions();
            const tools = convertToLLMTools(toolDefinitions);

            // Build the prompt
            const prompt = conversationContext + '\n\nBased on the above, what should I do next? Either call a tool or provide the final answer.';

            log.debug('Calling LLM', { contextLength: prompt.length, toolCount: tools.length });

            // Call LLM
            const response = llm.generateText({
                prompt: prompt,
                systemPrompt: getSystemPrompt(),
                modelFamily: llm.ModelFamily.CLAUDE,
                modelParameters: {
                    maxTokens: 2000
                },
                tools: tools
            });

            return {
                success: true,
                text: response.text,
                toolCalls: response.toolCalls || [],
                finishReason: response.finishReason
            };

        } catch (e) {
            log.error('LLM Error', { message: e.message });
            return {
                success: false,
                error: 'LLM error: ' + e.message
            };
        }
    }

    /**
     * Process LLM response and update session state
     */
    function processLLMResponse(session, llmResult) {
        // Check for tool calls
        if (llmResult.toolCalls && llmResult.toolCalls.length > 0) {
            // LLM wants to call tools
            Session.setPendingToolCalls(session, llmResult.toolCalls);

            const firstTool = llmResult.toolCalls[0];
            Session.addIntermediateResult(session, 'tool_call', {
                tool: firstTool.name,
                arguments: firstTool.arguments,
                status: 'pending',
                totalTools: llmResult.toolCalls.length
            });

            return {
                type: 'tool_call',
                tool: firstTool.name,
                arguments: firstTool.arguments,
                status: 'pending',
                queuedTools: llmResult.toolCalls.length
            };

        } else if (llmResult.text && llmResult.text.trim()) {
            // LLM provided a text response - this is the final answer
            session.state = 'complete';
            session.finalAnswer = llmResult.text.trim();

            Session.addMessage(session, 'assistant', session.finalAnswer);
            Session.addIntermediateResult(session, 'answer', {
                content: session.finalAnswer
            });

            return {
                type: 'answer',
                content: session.finalAnswer
            };

        } else {
            // No tool calls and no text - unusual
            session.state = 'complete';
            session.finalAnswer = 'I was unable to process your request. Please try rephrasing your question.';

            return {
                type: 'answer',
                content: session.finalAnswer
            };
        }
    }

    /**
     * Execute the next pending tool
     */
    function executeNextTool(session) {
        const toolCall = Session.getNextPendingTool(session);

        if (!toolCall) {
            session.state = 'tools_complete';
            return { type: 'thinking', title: 'All tools executed, analyzing results...' };
        }

        const toolName = toolCall.name;
        let args = toolCall.arguments;

        // Parse arguments if string
        if (typeof args === 'string') {
            try {
                args = JSON.parse(args);
            } catch (e) {
                args = {};
            }
        }

        log.debug('Executing Tool', { tool: toolName, args: args });

        // Add running status
        Session.addIntermediateResult(session, 'tool_running', {
            tool: toolName,
            arguments: args
        });

        // Execute tool
        let result;
        try {
            session.state = 'tool_running';
            result = Tools.executeTool(toolName, args);
        } catch (e) {
            result = { error: e.message };
        }

        // Mark as executed
        Session.markToolExecuted(session, toolCall, result);

        // Add to messages for LLM context
        Session.addMessage(session, 'tool', JSON.stringify({
            tool: toolName,
            arguments: args,
            result: result
        }));

        // Add result to intermediate results
        Session.addIntermediateResult(session, 'tool_result', {
            tool: toolName,
            result: result
        });

        // Check if more tools
        if (Session.hasMoreTools(session)) {
            session.state = 'tool_pending';
        } else {
            session.state = 'tools_complete';
        }

        return {
            type: 'tool_result',
            tool: toolName,
            arguments: args,
            result: result,
            moreTools: Session.hasMoreTools(session)
        };
    }

    /**
     * Get the latest update from session
     */
    function getLatestUpdate(session) {
        if (session.intermediateResults && session.intermediateResults.length > 0) {
            const latest = session.intermediateResults[session.intermediateResults.length - 1];
            return {
                type: latest.type,
                ...latest.data
            };
        }
        return { type: 'unknown' };
    }

    return {
        onRequest: onRequest
    };
});
