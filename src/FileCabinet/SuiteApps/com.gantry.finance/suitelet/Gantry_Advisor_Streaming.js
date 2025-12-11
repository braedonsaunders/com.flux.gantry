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
        return `You are an expert financial analyst assistant integrated with NetSuite ERP.

## CRITICAL: YOU MUST USE TOOLS
**DO NOT describe what tools you would use - ACTUALLY CALL THEM.**
When you need data, make a tool call. Do not explain your plan in text.

## Your Capabilities
You have access to tools that can:
- Query GL transactions and account balances
- Look up vendors, customers, and employees
- Resolve account names/numbers and classifications
- Analyze spending patterns and trends

## Instructions
1. When asked a question, think about what data you need
2. Call the appropriate tools to get that data
3. After getting results, either call more tools or provide your final answer
4. Be concise and data-driven in your responses

## IMPORTANT
- If a tool returns "not found", try alternative searches or proceed with available data
- Don't call the same tool with the same arguments more than twice
- After 3-4 tool calls, synthesize what you've learned into an answer`;
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

            if (request.method === 'GET') {
                // GET requests - status check or test
                const action = request.parameters.action || 'test';
                const sessionId = request.parameters.sessionId;

                if (action === 'status' && sessionId) {
                    result = handleStatus(sessionId);
                } else {
                    result = { success: true, message: 'Advisor Streaming API ready', actions: ['init', 'step', 'status', 'cancel'] };
                }
            } else if (request.method === 'POST') {
                // POST requests - main actions
                let body;
                try {
                    body = JSON.parse(request.body);
                } catch (e) {
                    body = request.parameters;
                }

                const action = body.action || request.parameters.action;

                switch (action) {
                    case 'init':
                        result = handleInit(body.query || request.parameters.query);
                        break;

                    case 'step':
                        result = handleStep(body.sessionId || request.parameters.sessionId);
                        break;

                    case 'status':
                        result = handleStatus(body.sessionId || request.parameters.sessionId);
                        break;

                    case 'cancel':
                        result = handleCancel(body.sessionId || request.parameters.sessionId);
                        break;

                    default:
                        result = { success: false, error: 'Unknown action: ' + action };
                }
            } else {
                result = { success: false, error: 'Use GET or POST' };
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
     * Call LLM to decide what to do next
     */
    function callLLMForDecision(session) {
        try {
            // Build conversation context
            const conversationContext = Session.buildConversationContext(session);

            // Get tool definitions
            const tools = Tools.getToolDefinitions();

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
