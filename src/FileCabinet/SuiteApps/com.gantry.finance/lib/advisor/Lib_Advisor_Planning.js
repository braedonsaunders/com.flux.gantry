/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DEPRECATED - This file is deprecated as of v2 architecture
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This file was part of the v1 Advisor architecture which used:
 * - Regex-based entity extraction (error-prone)
 * - Hardcoded word lists and blacklists
 * - Pre-resolution steps before LLM processing
 *
 * REPLACED BY:
 * - Lib_Advisor_Orchestrator_v2.js - Simplified entry point
 * - Lib_Advisor_Agent.js - LLM-driven agent loop (LLM decides everything)
 * - Lib_Advisor_Tools.js - Pre-optimized tool definitions
 * - Lib_Advisor_ProgressStore.js - Progressive rendering support
 *
 * The v2 architecture lets the LLM exclusively decide:
 * - What entities to resolve
 * - What tools to use
 * - How to interpret results
 * - When to retry with different approaches
 *
 * This file is kept for reference only. Do not use for new development.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Lib_Advisor_Planning.js (DEPRECATED)
 * Planning and classification for the Advisor module
 *
 * Contains:
 * - planExecution
 * - matchConversationalPattern
 * - Template/dashboard summaries for planning
 * - Entity detection
 * - Session context management
 */
define([
    'N/log',
    './Lib_Advisor_AIProviders',
    './Lib_Advisor_Prompts',
    './Lib_Advisor_Templates',
    './Lib_Advisor_Utils',
    './Lib_Advisor_ToolDefinitions',
    './Lib_Advisor_EntityResolver',
    '../Lib_Dashboard_Registry'
], function(log, AIProviders, Prompts, Templates, Utils, ToolDefinitions, EntityResolver, DashboardRegistry) {
    'use strict';

    // DEBUG FLAG - set to true to enable verbose logging
    var DEBUG_PLANNING = true;
    
    // Debug log collector - will be included in response
    var debugLog = [];
    
    function addDebug(label, data) {
        if (DEBUG_PLANNING) {
            debugLog.push({
                ts: Date.now(),
                label: label,
                data: data
            });
        }
    }
    
    function getAndClearDebugLog() {
        var log = debugLog.slice();
        debugLog = [];
        return log;
    }

    const MAX_AGENT_ITERATIONS = 8;
    const MAX_PLANNING_ITERATIONS = 5;  // Max entity resolution calls during planning
    
    /**
     * Detect if user is referencing previous query results
     * Patterns like "same data", "analyze it", "drill down", "tell me more"
     */
    function isContextualQuery(message) {
        if (!message) return false;
        
        const contextPatterns = [
            /\bsame\s+(data|query|results?|info|information)\b/i,
            /\bthat\s+(data|query|results?|info)\b/i,
            /\bthe\s+(data|results?)\s+(above|you\s+showed|from\s+before)\b/i,
            /\bmore\s+detail/i,
            /\banalyze\s+(it|this|that|them)\b/i,
            /\bbreak\s+(it|this|that)\s+down\b/i,
            /\bdrill\s*(down|into)\b/i,
            /\btell\s+me\s+more\b/i,
            /\bexplain\s+(it|this|that|these)\b/i,
            /\bwhat\s+about\s+(the|those)\b/i,
            /\bgo\s+deeper\b/i,
            /\bexpand\s+on\s+(that|this|it)\b/i,
            /\bshow\s+me\s+more\b/i,
            /\bcan\s+you\s+(explain|elaborate|expand)\b/i,
            /\bthis\s+data\b/i,
            /\bthese\s+results?\b/i
        ];
        
        return contextPatterns.some(pattern => pattern.test(message));
    }
    
    // Import tools from ToolDefinitions (single source of truth)
    const PLANNING_TOOL = ToolDefinitions.PLANNING_TOOL;
    const PLANNING_RESOLVE_ENTITY_TOOL = ToolDefinitions.PLANNING_RESOLVE_ENTITY_TOOL;

    /**
     * Match conversational patterns - DISABLED
     * The LLM handles all messages for context-aware responses
     */
    function matchConversationalPattern(message) {
        // Always return null - let the LLM handle everything
        // The LLM has conversation context and can give much better responses
        return null;
    }

    /**
     * Plan execution strategy - Uses tool loop for entity-aware planning
     * 
     * NEW FLOW (Resolve-First Planning):
     * 1. LLM sees "invoices from oracle" 
     * 2. LLM calls resolve_entity("oracle", "auto") to discover type
     * 3. System resolves → returns {id: 49396, name: "Oracle Canada ULC", type: "vendor"}
     * 4. LLM now KNOWS Oracle is a vendor
     * 5. LLM calls create_plan with correct vendor template selection
     * 
     * This ensures template selection is informed by actual entity types,
     * not guesses based on user wording.
     */
    function planExecution(message, history, fiscalContext, sessionContext) {
        // Clear any previous debug log
        debugLog = [];
        
        // ═══════════════════════════════════════════════════════════════════════
        // PRE-PLANNER ENTITY RESOLUTION (NEW)
        // Resolve entities BEFORE the planner sees the message
        // This handles: pronouns, demonstratives, and explicit entity names
        // ═══════════════════════════════════════════════════════════════════════
        var preResolveResult = null;
        var enrichedMessage = message;
        
        try {
            preResolveResult = EntityResolver.resolveEntitiesInMessage(message, sessionContext);
            enrichedMessage = preResolveResult.enrichedMessage;
            
            addDebug('Pre-planner entity resolution', {
                originalMessage: message.substring(0, 100),
                enrichedMessage: enrichedMessage.substring(0, 150),
                resolvedCount: preResolveResult.resolvedEntities?.length || 0,
                resolvedEntities: preResolveResult.resolvedEntities?.map(r => ({
                    original: r.original,
                    resolved: r.entity?.name,
                    type: r.entity?.type,
                    strategy: r.strategy
                }))
            });
            
            // Update session context with newly resolved entities
            // CRITICAL: Must modify the ORIGINAL object, not reassign the local variable
            // Otherwise the Orchestrator won't see the changes (JavaScript reference semantics)
            if (preResolveResult.sessionContext) {
                // Merge resolvedEntities
                if (preResolveResult.sessionContext.resolvedEntities) {
                    sessionContext.resolvedEntities = sessionContext.resolvedEntities || {};
                    Object.assign(sessionContext.resolvedEntities, preResolveResult.sessionContext.resolvedEntities);
                }
                // MERGE entityOrder (don't replace - preserve existing entries!)
                // This ensures entities from previous queries aren't lost
                if (preResolveResult.sessionContext.entityOrder && Array.isArray(preResolveResult.sessionContext.entityOrder)) {
                    sessionContext.entityOrder = sessionContext.entityOrder || [];
                    for (const key of preResolveResult.sessionContext.entityOrder) {
                        const idx = sessionContext.entityOrder.indexOf(key);
                        if (idx >= 0) sessionContext.entityOrder.splice(idx, 1);
                        sessionContext.entityOrder.push(key);
                    }
                    // Keep bounded
                    if (sessionContext.entityOrder.length > 20) {
                        sessionContext.entityOrder = sessionContext.entityOrder.slice(-20);
                    }
                }
            }
        } catch (preResolveError) {
            // Log but don't fail - continue with original message
            log.error('Pre-planner entity resolution failed', { error: preResolveError.message });
            addDebug('Pre-planner resolution error (continuing)', { error: preResolveError.message });
        }
        
        // Build comprehensive context for LLM
        const dashboardSummary = getDashboardSummaryForPlanning();
        const templateSummary = getTemplateSummaryForPlanning();
        
        // Use centralized prompt from Prompts library
        const systemPrompt = Prompts.buildPlanningPrompt(fiscalContext, dashboardSummary, templateSummary, sessionContext);
        
        // Condense history for planning
        const condensedHistory = condenseHistoryForPlanning(history);
        
        // Track entities resolved during planning
        const planningResolvedEntities = {};
        
        // Pattern to identify pronouns/coreferences that should NOT be cached
        const pronounPattern = /(^|_)(them|they|their|it|its|him|her|this|that)$/i;
        
        // Copy already-resolved entities from session context (excluding pronouns)
        if (sessionContext?.resolvedEntities) {
            for (const key in sessionContext.resolvedEntities) {
                if (sessionContext.resolvedEntities.hasOwnProperty(key) && !pronounPattern.test(key)) {
                    planningResolvedEntities[key] = sessionContext.resolvedEntities[key];
                }
            }
        }
        
        // Also seed from pre-planner resolution results
        if (preResolveResult?.resolvedEntities) {
            for (const resolved of preResolveResult.resolvedEntities) {
                if (resolved.entity?.id) {
                    const key = resolved.entity.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                    planningResolvedEntities[key] = {
                        id: resolved.entity.id,
                        name: resolved.entity.name,
                        type: resolved.entity.type
                    };
                    // Also store by original term for lookup (but NOT pronouns)
                    const origKey = resolved.original.toLowerCase().replace(/[^a-z0-9]/g, '_');
                    if (origKey !== key && !pronounPattern.test(origKey)) {
                        planningResolvedEntities[origKey] = planningResolvedEntities[key];
                    }
                }
            }
        }
        
        // Planning tools: resolve_entity (optional) + create_plan (required)
        const planningTools = [PLANNING_RESOLVE_ENTITY_TOOL, PLANNING_TOOL];

        try {
            addDebug('Starting planning with tool loop', {
                messageLength: message.length,
                messagePreview: message.substring(0, 100),
                enrichedMessagePreview: enrichedMessage.substring(0, 150),
                historyLength: history?.length || 0,
                existingEntities: Object.keys(planningResolvedEntities)
            });
            
            // ═══════════════════════════════════════════════════════════════
            // CONTEXTUAL QUERY DETECTION
            // Detect when user references previous results ("same data", "analyze it", etc.)
            // and inject last query context to help planning
            // ═══════════════════════════════════════════════════════════════
            let contextualQueryInfo = '';
            if (isContextualQuery(message) && sessionContext?.lastQueryResult) {
                const lastQuery = sessionContext.lastQueryResult;
                contextualQueryInfo = `

=== PREVIOUS QUERY CONTEXT ===
The user is referencing a previous query. Here's what was last queried:
- Template used: ${lastQuery.templateId || 'dynamic query'}
- Description: ${lastQuery.description || 'N/A'}
- Columns returned: ${lastQuery.columns?.join(', ') || 'N/A'}
- Row count: ${lastQuery.rowCount || 'N/A'}
- Entities involved: ${JSON.stringify(lastQuery.entities || {})}
${lastQuery.query ? '- Query pattern: ' + lastQuery.query.substring(0, 200) + '...' : ''}

The user wants to work with THIS data. Consider:
1. Using the same template with different parameters
2. Using a related "drill-down" template
3. Using agent mode for deeper analysis of the same entities
=== END PREVIOUS CONTEXT ===
`;
                addDebug('Contextual query detected', {
                    pattern: 'User referencing previous results',
                    lastTemplateId: lastQuery.templateId,
                    lastDescription: lastQuery.description
                });
            }
            
            // Build initial messages for the conversation
            // Use enrichedMessage which has entity markers like [[VENDOR:49396:Name]]
            let conversationMessages = condensedHistory.slice();
            conversationMessages.push({ role: 'user', content: enrichedMessage });
            
            // Tool loop - continue until create_plan is called
            // Track consecutive failures to call a tool
            let consecutiveNoToolCalls = 0;
            const MAX_NO_TOOL_RETRIES = 3;
            
            // Track plan validation retries
            let planRetryCount = 0;
            const MAX_PLAN_RETRIES = 2;
            
            for (let iteration = 0; iteration < MAX_PLANNING_ITERATIONS; iteration++) {
                addDebug('Planning iteration ' + (iteration + 1), {
                    resolvedSoFar: Object.keys(planningResolvedEntities),
                    consecutiveNoToolCalls: consecutiveNoToolCalls
                });
                
                // Build context with currently resolved entities
                let contextAddition = '';
                if (Object.keys(planningResolvedEntities).length > 0) {
                    const entityLines = [];
                    for (const term in planningResolvedEntities) {
                        const e = planningResolvedEntities[term];
                        entityLines.push(`  • "${term}" → ${e.name} (${e.type}, ID: ${e.id})`);
                    }
                    contextAddition = '\n\n=== RESOLVED ENTITIES (from this planning session) ===\n' +
                        entityLines.join('\n') + '\n' +
                        '=== Use these entity types to select appropriate templates ===\n';
                }
                
                // Add stronger instruction if we've had no tool calls
                let toolReminder = '';
                if (consecutiveNoToolCalls > 0) {
                    toolReminder = '\n\n🚨 CRITICAL: You MUST call the create_plan tool to proceed. Do NOT respond with text - use the tool!\n';
                }
                
                // ═══════════════════════════════════════════════════════════════
                // PLANNING LLM CALL WITH RETRY
                // Retry once before falling back to template matching
                // ═══════════════════════════════════════════════════════════════
                var result = null;
                var planningLLMError = null;
                var MAX_PLANNING_LLM_RETRIES = 1;
                
                for (var llmAttempt = 0; llmAttempt <= MAX_PLANNING_LLM_RETRIES; llmAttempt++) {
                    try {
                        // Use enrichedMessage which has pre-resolved entity markers
                        result = AIProviders.callAI(enrichedMessage, {
                            systemPrompt: systemPrompt + contextualQueryInfo + contextAddition + toolReminder,
                            chatHistory: conversationMessages.slice(0, -1), // Exclude current message (it's in 'message' param)
                            temperature: 0.1,
                            tools: planningTools,
                            purpose: 'Plan execution (iteration ' + (iteration + 1) + ')' + (llmAttempt > 0 ? ' retry' : ''),
                            tier: 1
                        });
                        
                        // Success - clear any previous error
                        planningLLMError = null;
                        break;
                        
                    } catch (llmError) {
                        planningLLMError = llmError;
                        addDebug('Planning LLM error (attempt ' + (llmAttempt + 1) + ')', { 
                            error: llmError.message,
                            willRetry: llmAttempt < MAX_PLANNING_LLM_RETRIES
                        });
                        
                        if (llmAttempt < MAX_PLANNING_LLM_RETRIES) {
                            // Brief pause before retry
                            log.debug('Retrying planning LLM after error', { attempt: llmAttempt + 1 });
                        }
                    }
                }
                
                // If all retries failed, throw the last error
                if (planningLLMError) {
                    throw planningLLMError;
                }
                
                // Capture AI debug log
                if (result._aiDebug) {
                    result._aiDebug.forEach(entry => addDebug('AI: ' + entry.label, entry.data));
                }
                
                addDebug('AI Result', {
                    type: result?.type,
                    toolCalls: result?.toolCalls?.map(tc => tc.name) || [],
                    textLength: result?.text?.length || 0
                });
                
                // Handle tool calls
                if (result.type === 'tool_call' && result.toolCalls?.length > 0) {
                    const toolCall = result.toolCalls[0];
                    
                    // ═══════════════════════════════════════════════════════════════
                    // RESOLVE_ENTITY - Discover entity type before planning
                    // ═══════════════════════════════════════════════════════════════
                    if (toolCall.name === 'resolve_entity') {
                        const args = toolCall.arguments || {};
                        const term = args.term || '';
                        const entityType = args.entity_type || 'auto';
                        
                        addDebug('resolve_entity called', { term, entityType });
                        
                        // Check if already resolved
                        const termLower = term.toLowerCase();
                        if (planningResolvedEntities[termLower]) {
                            const existing = planningResolvedEntities[termLower];
                            addDebug('Entity already resolved', existing);
                            
                            // Add tool result to conversation
                            conversationMessages.push({
                                role: 'assistant',
                                content: null,
                                tool_calls: [{ id: toolCall.id || 'resolve_' + iteration, type: 'function', function: { name: 'resolve_entity', arguments: JSON.stringify(args) }}]
                            });
                            conversationMessages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id || 'resolve_' + iteration,
                                content: JSON.stringify({
                                    resolved: true,
                                    term: term,
                                    entity: existing,
                                    message: `Already resolved: "${term}" is ${existing.name} (${existing.type}, ID: ${existing.id})`
                                })
                            });
                            continue;
                        }
                        
                        // Actually resolve the entity
                        const resolution = EntityResolver.resolveEntityWithFallback(term, entityType);
                        
                        let toolResult;
                        if (resolution.resolved) {
                            // Store the resolved entity
                            planningResolvedEntities[termLower] = {
                                id: resolution.entity.id,
                                name: resolution.entity.name,
                                type: resolution.actualType || entityType
                            };
                            
                            toolResult = {
                                resolved: true,
                                term: term,
                                entity: {
                                    id: resolution.entity.id,
                                    name: resolution.entity.name,
                                    type: resolution.actualType || entityType
                                },
                                message: `Found: "${term}" is ${resolution.entity.name} (${resolution.actualType || entityType}, ID: ${resolution.entity.id}). Use this type to select appropriate templates.`
                            };
                            
                            addDebug('Entity resolved', toolResult);
                        } else {
                            toolResult = {
                                resolved: false,
                                term: term,
                                entity: null,
                                candidates: resolution.candidates?.slice(0, 3) || [],
                                message: `Could not resolve "${term}". ${resolution.candidates?.length ? 'Candidates: ' + resolution.candidates.slice(0, 3).map(c => c.name).join(', ') : 'No matches found.'}`
                            };
                            
                            addDebug('Entity not resolved', toolResult);
                        }
                        
                        // Add tool result to conversation for next iteration
                        conversationMessages.push({
                            role: 'assistant',
                            content: null,
                            tool_calls: [{ id: toolCall.id || 'resolve_' + iteration, type: 'function', function: { name: 'resolve_entity', arguments: JSON.stringify(args) }}]
                        });
                        conversationMessages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id || 'resolve_' + iteration,
                            content: JSON.stringify(toolResult)
                        });
                        
                        // Continue loop to let LLM process result and call create_plan
                        continue;
                    }
                    
                    // ═══════════════════════════════════════════════════════════════
                    // CREATE_PLAN - Final plan with entity-aware template selection
                    // ═══════════════════════════════════════════════════════════════
                    if (toolCall.name === 'create_plan') {
                        const plan = toolCall.arguments;
                        
                        addDebug('create_plan called', {
                            complexity: plan.complexity,
                            template: plan.template_match,
                            entitiesResolved: Object.keys(planningResolvedEntities).length
                        });
                        
                        // ═══════════════════════════════════════════════════════════════
                        // PLAN VALIDATION - Check for invalid patterns and retry if needed
                        // ═══════════════════════════════════════════════════════════════
                        var validationErrors = [];
                        
                        // Check 1: template action requires template_id
                        if (plan.plan && Array.isArray(plan.plan)) {
                            plan.plan.forEach(function(step, idx) {
                                if (step.action === 'template' && !step.template_id && !plan.template_match) {
                                    validationErrors.push('Step ' + (idx + 1) + ' has action "template" but no template_id specified');
                                }
                            });
                        }
                        
                        // If validation failed, retry planning with feedback
                        if (validationErrors.length > 0 && planRetryCount < MAX_PLAN_RETRIES) {
                            planRetryCount++;
                            addDebug('Plan validation failed, retrying', {
                                errors: validationErrors,
                                retryCount: planRetryCount
                            });
                            
                            // Add error feedback to prompt for next iteration
                            toolReminder = '\n\n🚨 PLAN VALIDATION ERROR:\n' + validationErrors.join('\n') + 
                                '\n\nFIX REQUIRED: When using action:"template", you MUST specify which template to use:\n' +
                                '- Either set template_match at the plan level (for single template execution)\n' +
                                '- OR set template_id on each step with action:"template"\n' +
                                '- OR change action to "query" to let the system generate SQL dynamically\n\n' +
                                'Please call create_plan again with a corrected plan.';
                            continue;
                        }
                        
                        // If still invalid after retries, auto-fix by converting template to query
                        if (validationErrors.length > 0) {
                            addDebug('Plan validation failed after retries, auto-fixing template->query', {
                                errors: validationErrors
                            });
                            if (plan.plan && Array.isArray(plan.plan)) {
                                plan.plan.forEach(function(step) {
                                    if (step.action === 'template' && !step.template_id && !plan.template_match) {
                                        step.action = 'query';  // Convert to query so SQL can be generated
                                    }
                                });
                            }
                        }
                        
                        // Validate and normalize the plan
                        plan.complexity = plan.complexity === 'multi_step' ? 'multi_step' : 'simple';
                        plan.plan = plan.plan || [{ step: 1, action: 'query', purpose: 'Answer the question' }];
                        
                        // Ensure estimated_queries is reasonable
                        var dataGatheringSteps = (plan.plan || []).filter(function(s) {
                            return s.action === 'query' || s.action === 'template';
                        }).length;
                        plan.estimated_queries = Math.max(plan.estimated_queries || 1, dataGatheringSteps);
                        plan.estimated_queries = Math.min(plan.estimated_queries, MAX_AGENT_ITERATIONS);
                        
                        // Merge in entities resolved during planning
                        // These are already resolved - orchestrator can skip re-resolution
                        plan.entities_to_resolve = plan.entities_to_resolve || [];
                        plan._planningResolvedEntities = planningResolvedEntities;
                        
                        addDebug('Plan finalized', {
                            complexity: plan.complexity,
                            template: plan.template_match,
                            dashboard: plan.dashboard_suggestion,
                            entitiesToResolve: plan.entities_to_resolve?.length || 0,
                            entitiesAlreadyResolved: Object.keys(planningResolvedEntities)
                        });
                        
                        plan._debugLog = getAndClearDebugLog();
                        return plan;
                    }
                    
                    // Unknown tool
                    addDebug('Unknown tool', { name: toolCall.name });
                }
                
                // No tool call - try to parse from text (fallback)
                const text = typeof result === 'string' ? result : result.text;
                if (text) {
                    const parsedPlan = tryParseJsonPlan(text);
                    if (parsedPlan) {
                        parsedPlan._planningResolvedEntities = planningResolvedEntities;
                        parsedPlan._debugLog = getAndClearDebugLog();
                        return parsedPlan;
                    }
                }
                
                // No tool call and no parseable plan
                consecutiveNoToolCalls++;
                addDebug('No tool call in iteration', { 
                    iteration, 
                    consecutiveNoToolCalls,
                    maxRetries: MAX_NO_TOOL_RETRIES
                });
                
                // After MAX_NO_TOOL_RETRIES consecutive failures, give up gracefully
                if (consecutiveNoToolCalls >= MAX_NO_TOOL_RETRIES) {
                    addDebug('Planning failed - no tool calls after retries', {
                        attempts: consecutiveNoToolCalls
                    });
                    
                    // Return error plan that will trigger user-facing error
                    return {
                        error: true,
                        errorMessage: 'I had trouble understanding this request. Could you rephrase it or break it into simpler questions?',
                        complexity: 'error',
                        reasoning: 'Planning failed after ' + MAX_NO_TOOL_RETRIES + ' attempts without creating a plan',
                        _planningResolvedEntities: planningResolvedEntities,
                        _debugLog: getAndClearDebugLog()
                    };
                }
                
                // Continue to retry
                continue;
            }
            
            // Max iterations reached without create_plan
            addDebug('Max planning iterations reached', { iterations: MAX_PLANNING_ITERATIONS });
            
            // Max iterations reached without create_plan - return error
            return {
                error: true,
                errorMessage: 'I had trouble analyzing this request. Could you try rephrasing it?',
                complexity: 'error',
                reasoning: 'Planning loop completed without explicit plan after ' + MAX_PLANNING_ITERATIONS + ' iterations',
                _planningResolvedEntities: planningResolvedEntities,
                _debugLog: getAndClearDebugLog()
            };
            
        } catch (e) {
            addDebug('Exception', { error: e.message, stack: e.stack });
            
            // Fallback to dashboard/template matching
            return handlePlanningException(message, planningResolvedEntities);
        }
    }
    
    /**
     * Helper to parse JSON plan from text response
     */
    function tryParseJsonPlan(text) {
        try {
            var plan = Utils.extractJsonFromText(text, 'complexity') || 
                       Utils.extractJsonFromText(text, 'plan');
            
            if (!plan) {
                var jsonText = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
                plan = JSON.parse(jsonText);
            }
            
            if (plan) {
                plan.complexity = plan.complexity === 'multi_step' ? 'multi_step' : 'simple';
                plan.plan = plan.plan || [{ step: 1, action: 'query', purpose: 'Answer the question' }];
                
                var dataGatheringSteps = (plan.plan || []).filter(function(s) {
                    return s.action === 'query' || s.action === 'template';
                }).length;
                plan.estimated_queries = Math.max(plan.estimated_queries || 1, dataGatheringSteps);
                plan.estimated_queries = Math.min(plan.estimated_queries, MAX_AGENT_ITERATIONS);
                plan.entities_to_resolve = plan.entities_to_resolve || [];
                
                addDebug('Parsed plan from text', { complexity: plan.complexity });
                return plan;
            }
        } catch (parseError) {
            addDebug('Parse error', { error: parseError.message });
        }
        return null;
    }
    
    /**
     * Handle planning exceptions with fallback matching
     */
    function handlePlanningException(message, resolvedEntities) {
        // ═══════════════════════════════════════════════════════════════
        // FIX #2: Try entity resolution BEFORE template matching
        // This ensures we know entity types for better template selection
        // ═══════════════════════════════════════════════════════════════
        var fallbackResolvedEntities = Object.assign({}, resolvedEntities || {});
        
        // Extract potential entity names from the message
        var words = message.split(/\s+/);
        var potentialEntities = words.filter(function(word) {
            // Skip common words and short words
            if (word.length < 3) return false;
            var lower = word.toLowerCase();
            var stopWords = ['the', 'from', 'for', 'and', 'with', 'show', 'find', 'get', 
                            'list', 'what', 'who', 'how', 'latest', 'recent', 'last',
                            'invoice', 'invoices', 'bill', 'bills', 'order', 'orders',
                            'customer', 'vendor', 'payment', 'payments', 'transaction'];
            if (stopWords.indexOf(lower) >= 0) return false;
            // Likely an entity if it starts with uppercase or is all lowercase (company name)
            return /^[A-Z]/.test(word) || /^[a-z]+$/.test(word);
        });
        
        // Try to resolve each potential entity
        potentialEntities.forEach(function(term) {
            var termLower = term.toLowerCase();
            if (!fallbackResolvedEntities[termLower]) {
                try {
                    var resolution = EntityResolver.resolveEntity(term, 'auto');
                    if (resolution.resolved && resolution.entity) {
                        fallbackResolvedEntities[termLower] = {
                            id: resolution.entity.id,
                            name: resolution.entity.name,
                            type: resolution.entity.type
                        };
                        addDebug('Fallback entity resolution', {
                            term: term,
                            resolved: resolution.entity.name,
                            type: resolution.entity.type
                        });
                    }
                } catch (e) {
                    // Ignore resolution errors in fallback
                }
            }
        });
        
        // PRIORITY 1: Try dashboard matching (needs score >= 30 for fallback)
        var dashboardMatch = findMatchingDashboard(message);
        if (dashboardMatch && dashboardMatch.score >= 30) {
            addDebug('Fallback: Found dashboard match', { 
                dashboardId: dashboardMatch.id, 
                score: dashboardMatch.score 
            });
            return {
                complexity: 'simple',
                reasoning: 'Planning failed but found matching dashboard: ' + dashboardMatch.name,
                dashboard_suggestion: dashboardMatch.id,
                plan: [{ step: 1, action: 'dashboard', purpose: dashboardMatch.name }],
                entities_to_resolve: [],
                _planningResolvedEntities: fallbackResolvedEntities,
                estimated_queries: 0,
                _debugLog: getAndClearDebugLog()
            };
        }
        
        // PRIORITY 2: Try template matching with entity awareness
        var templateMatch = Templates.findMatchingTemplate(message, fallbackResolvedEntities);
        
        // ═══════════════════════════════════════════════════════════════
        // CONTEXTUAL QUERY HANDLING IN FALLBACK
        // If user references previous results, use lower threshold or previous template
        // ═══════════════════════════════════════════════════════════════
        var effectiveThreshold = 50;
        var contextualLastTemplate = null;
        
        if (isContextualQuery(message)) {
            // For contextual queries, check if we have a previous template to reuse
            if (resolvedEntities?.lastQueryResult?.templateId) {
                contextualLastTemplate = resolvedEntities.lastQueryResult.templateId;
                addDebug('Fallback: Contextual query with previous template', {
                    lastTemplateId: contextualLastTemplate
                });
            }
            // Lower threshold for contextual queries since keywords won't match well
            effectiveThreshold = 25;
        }
        
        // If we have a contextual reference to a previous template, use it directly
        if (contextualLastTemplate) {
            var previousTemplate = Templates.findTemplateById(contextualLastTemplate);
            if (previousTemplate) {
                addDebug('Fallback: Using previous template for contextual query', {
                    templateId: previousTemplate.id,
                    reason: 'User referenced previous results'
                });
                return {
                    complexity: 'moderate',  // Moderate since they want more analysis
                    reasoning: 'User referenced previous results - using same template with deeper analysis',
                    template_match: previousTemplate.id,
                    extracted_params: templateMatch?.params || {},
                    template_params: templateMatch?.params || {},
                    plan: [
                        { step: 1, action: 'template', purpose: previousTemplate.description },
                        { step: 2, action: 'synthesize', purpose: 'Analyze results in detail' }
                    ],
                    entities_to_resolve: [],
                    _planningResolvedEntities: fallbackResolvedEntities,
                    estimated_queries: 1,
                    _debugLog: getAndClearDebugLog()
                };
            }
        }
        
        if (templateMatch && templateMatch.score >= effectiveThreshold) {
            addDebug('Fallback: Found template match', { 
                templateId: templateMatch.template.id, 
                score: templateMatch.score,
                threshold: effectiveThreshold
            });
            return {
                complexity: 'simple',
                reasoning: 'Planning failed but found matching template: ' + templateMatch.template.name,
                template_match: templateMatch.template.id,
                extracted_params: templateMatch.params,
                template_params: templateMatch.params,
                plan: [{ step: 1, action: 'template', purpose: templateMatch.template.description }],
                entities_to_resolve: [],
                _planningResolvedEntities: fallbackResolvedEntities,
                estimated_queries: 1,
                _debugLog: getAndClearDebugLog()
            };
        }
        
        // Log rejected low-confidence matches for debugging
        if (templateMatch && templateMatch.score > 0) {
            addDebug('Fallback: Rejected low-confidence template match', {
                templateId: templateMatch.template.id,
                score: templateMatch.score,
                threshold: effectiveThreshold
            });
        }
        
        // PRIORITY 3: Generic query (let AI figure it out)
        // Include resolved entities so AI can use them
        return {
            complexity: 'simple',
            reasoning: 'Planning failed, using simple query path',
            plan: [{ step: 1, action: 'query', purpose: 'Answer the question' }],
            entities_to_resolve: [],
            _planningResolvedEntities: fallbackResolvedEntities,
            estimated_queries: 1,
            _debugLog: getAndClearDebugLog()
        };
    }
    
    /**
     * Find matching dashboard based on keywords in the question
     * Returns { id, name, score } or null
     */
    function findMatchingDashboard(question) {
        const normalized = question.toLowerCase();
        const words = normalized.split(/\s+/);
        
        // Define dashboard keywords with weights
        const dashboardKeywords = {
            cashflow: {
                name: 'Cash Flow Dashboard',
                keywords: ['cash', 'cashflow', 'liquidity', 'runway', 'burn', 'projection', 
                           'forecast', 'bank balance', 'cash position', 'cash flow',
                           '30 days', '60 days', '90 days', 'days of cash', 'will our cash',
                           'future cash', 'projected cash'],
                strongMatches: ['projection', 'runway', 'burn rate', 'forecast', 'will our cash', 'future cash']
            },
            health: {
                name: 'Financial Health Dashboard',
                keywords: ['health', 'score', 'margin', 'margins', 'profitability', 'profit margin',
                           'gross margin', 'net margin', 'financial health', 'how healthy',
                           'ratios', 'current ratio', 'quick ratio'],
                strongMatches: ['health score', 'financial health', 'how healthy']
            },
            burden: {
                name: 'Burden Rate Dashboard',
                keywords: ['burden', 'overhead', 'labor cost', 'burden rate', 'allocation',
                           'indirect cost', 'labor burden'],
                strongMatches: ['burden rate', 'overhead rate', 'labor burden']
            },
            time: {
                name: 'Time Tracking Dashboard',
                keywords: ['time', 'utilization', 'billable', 'hours', 'timesheet', 
                           'time entry', 'time tracking', 'billable hours', 'utilization rate'],
                strongMatches: ['utilization rate', 'billable hours', 'time tracking']
            }
        };
        
        let bestMatch = null;
        let bestScore = 0;
        
        for (const [dashId, config] of Object.entries(dashboardKeywords)) {
            let score = 0;
            
            // Check each keyword
            config.keywords.forEach(keyword => {
                if (normalized.includes(keyword)) {
                    // Multi-word keywords get higher scores
                    let keywordScore = keyword.includes(' ') ? 20 : 10;
                    
                    // Strong matches get bonus points
                    if (config.strongMatches.includes(keyword)) {
                        keywordScore += 15;
                    }
                    
                    score += keywordScore;
                }
            });
            
            if (score > bestScore) {
                bestScore = score;
                bestMatch = { id: dashId, name: config.name, score: score };
            }
        }
        
        addDebug('Dashboard matching result', { 
            question: question.substring(0, 50),
            bestMatch: bestMatch ? bestMatch.id : null,
            score: bestScore
        });
        
        return bestMatch;
    }
    
    /**
     * Get template summary for planner - provides ALL templates with descriptions
     */
    function getTemplateSummaryForPlanning() {
        const templates = Templates.getAllTemplates();
        
        // Group templates by category
        const byCategory = {};
        templates.forEach(t => {
            const cat = t.category || 'OTHER';
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(t);
        });
        
        let summary = '';
        for (const [category, temps] of Object.entries(byCategory)) {
            summary += `\n${category}:\n`;
            temps.forEach(t => {
                const params = t.parameters?.length 
                    ? ` (params: ${t.parameters.map(p => p.name).join(', ')})` 
                    : '';
                const complexity = t.complexity ? ` [${t.complexity}]` : '';
                summary += `  • ${t.id}${complexity}: ${t.description}${params}\n`;
                
                // Include "answers" hints if present (helps LLM understand intent)
                if (t.answers && t.answers.length > 0) {
                    summary += `    → Answers: ${t.answers.slice(0, 2).join(', ')}\n`;
                }
                // Include "does_not_answer" to prevent misuse
                if (t.does_not_answer && t.does_not_answer.length > 0) {
                    summary += `    ⚠️ NOT for: ${t.does_not_answer.slice(0, 2).join(', ')}\n`;
                }
            });
        }
        
        return summary;
    }

    /**
     * Get dashboard summary for planner - emphasizes unique capabilities
     */
    function getDashboardSummaryForPlanning() {
        const dashboards = DashboardRegistry.getDataDashboards();
        
        return dashboards.map(d => {
            const schema = d.dataSchema;
            if (!schema) return null;
            
            // Get all field descriptions for a comprehensive view
            const fieldList = Object.entries(schema.fields || {})
                .filter(([key, val]) => val.type !== 'array')
                .map(([key, val]) => `• ${key}: ${val.desc}`)
                .slice(0, 10)
                .join('\n');
            
            // Get array field summaries
            const arrayFields = Object.entries(schema.fields || {})
                .filter(([key, val]) => val.type === 'array')
                .map(([key, val]) => `• ${key}: ${val.desc}`)
                .join('\n');
            
            // Include keywords for better matching
            const keywords = d.keywords ? d.keywords.join(', ') : '';
            
            // Highlight special capabilities and parameters
            let specialCapabilities = '';
            let availableParams = '';
            
            if (d.id === 'cashflow') {
                specialCapabilities = `
⭐ UNIQUE CAPABILITIES (not available via SQL):
• Cash projections: projection30, projection60, projection90
• Runway calculation with burn rate
• AR/AP aging breakdown pre-calculated`;
                availableParams = `
📊 CUSTOMIZABLE PARAMETERS:
• horizon: Number of days for projections (default: 90)
• subsidiary: Filter by subsidiary ID
• startDate/endDate: Custom date range`;
            } else if (d.id === 'health') {
                specialCapabilities = `
⭐ UNIQUE CAPABILITIES (not available via SQL):
• Health score calculation (0-100)
• Pre-calculated margins and ratios
• Department profitability breakdown`;
                availableParams = `
📊 CUSTOMIZABLE PARAMETERS:
• subsidiary: Filter by subsidiary ID
• startDate/endDate: Custom date range for YTD calculations`;
            } else if (d.id === 'burden') {
                specialCapabilities = `
⭐ UNIQUE CAPABILITIES (not available via SQL):
• Burden rate calculations
• Overhead allocation
• Labor cost analysis`;
                availableParams = `
📊 CUSTOMIZABLE PARAMETERS:
• subsidiary: Filter by subsidiary ID
• department: Filter by department
• startDate/endDate: Custom date range`;
            } else if (d.id === 'time') {
                specialCapabilities = `
⭐ UNIQUE CAPABILITIES (not available via SQL):
• Utilization rate calculations
• Billable vs non-billable breakdown
• Time entry summaries by employee/project`;
                availableParams = `
📊 CUSTOMIZABLE PARAMETERS:
• employee: Filter by employee ID
• project: Filter by project ID
• startDate/endDate: Custom date range`;
            }
            
            return `
═══════════════════════════════════════════════════════════════════════
${d.id.toUpperCase()} DASHBOARD - "${d.name}"
═══════════════════════════════════════════════════════════════════════
${d.description}
${schema.summary}
${specialCapabilities}
${availableParams}

Available Data:
${fieldList}
${arrayFields ? '\nDetail Arrays:\n' + arrayFields : ''}

Match Keywords: ${keywords}
`;
        }).filter(Boolean).join('\n');
    }

    // ═══════════════════════════════════════════════════════════════
    // SESSION CONTEXT MANAGEMENT
    // ═══════════════════════════════════════════════════════════════
    //
    // Session context is passed from client and persists until "New Chat"
    // Structure:
    // {
    //   resolvedEntities: { "acme": { type: "customer", id: "123", name: "Acme Corp" } },
    //   queryHistory: [
    //     { query: "SELECT...", columns: [...], rows: [...], timestamp: ... }
    //   ],
    //   topics: ["revenue", "customers"],  // What we've discussed
    //   lastQueryResult: { columns, rows }  // Full data for "tell me more"
    // }
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * Condense conversation history for planning
     * - Keeps user messages as-is (they're short)
     * - Summarizes assistant responses to just describe what was answered
     * - Limits to last 2 exchanges to prevent context confusion
     * This prevents the planner from getting confused by long previous responses
     */
    function condenseHistoryForPlanning(history) {
        if (!history || !Array.isArray(history) || history.length === 0) {
            return [];
        }
        
        const MAX_EXCHANGES = 4; // 2 user + 2 assistant messages
        const recentHistory = history.slice(-MAX_EXCHANGES);
        
        return recentHistory.map(function(msg) {
            if (msg.role === 'user') {
                // Keep user messages as-is
                return {
                    role: 'user',
                    content: msg.content || msg.text || ''
                };
            }
            
            // For assistant messages: create a very brief summary
            const content = msg.content || msg.text || '';
            
            // Extract just what topic was addressed (first 100 chars or first sentence)
            let summary = content.split(/[.!?\n]/)[0] || '';
            if (summary.length > 100) {
                summary = summary.substring(0, 100) + '...';
            }
            
            // If the response mentioned data results, note that
            if (content.includes('rows') || content.includes('results') || content.includes('$')) {
                summary = '[Provided data/analysis] ' + summary;
            }
            
            return {
                role: 'assistant',
                content: summary || '[Answered previous question]'
            };
        });
    }
    
    /**
     * Prepare conversation for LLM
     * - Messages: truncate display text only, never data
     * - Session context: passed through unchanged (contains full query results)
     */
    function prepareConversationHistory(history, sessionContext) {
        // Initialize or use existing session context
        const ctx = sessionContext || {
            resolvedEntities: {},
            entityOrder: [],
            queryHistory: [],
            topics: [],
            lastQueryResult: null
        };
        
        // Ensure nested objects exist
        if (!ctx.resolvedEntities) ctx.resolvedEntities = {};
        if (!ctx.entityOrder) ctx.entityOrder = [];
        if (!ctx.queryHistory) ctx.queryHistory = [];
        if (!ctx.topics) ctx.topics = [];
        
        if (!history || !Array.isArray(history) || history.length === 0) {
            return { 
                messages: [], 
                sessionContext: ctx
            };
        }
        
        const MAX_RECENT_MESSAGES = 8;  // Keep last 4 exchanges in full
        const MAX_DISPLAY_LENGTH = 500; // Truncate long display text only
        
        // Prepare messages for LLM - only truncate display text, never structured data
        const preparedMessages = [];
        
        for (let i = 0; i < history.length; i++) {
            const msg = history[i];
            const isRecent = i >= history.length - MAX_RECENT_MESSAGES;
            
            // Always keep user messages in full (they're usually short)
            if (msg.role === 'user') {
                preparedMessages.push({
                    role: 'user',
                    content: msg.content || msg.text || ''
                });
                continue;
            }
            
            // For assistant messages: keep recent ones full, summarize older display text
            if (msg.role === 'assistant') {
                const content = msg.content || msg.text || '';
                
                if (isRecent) {
                    // Recent: keep in full
                    preparedMessages.push({
                        role: 'assistant',
                        content: content
                    });
                } else {
                    // Older: truncate display text but note what was discussed
                    const truncated = content.length > MAX_DISPLAY_LENGTH 
                        ? content.substring(0, MAX_DISPLAY_LENGTH) + '... [truncated]'
                        : content;
                    preparedMessages.push({
                        role: 'assistant', 
                        content: truncated
                    });
                }
            }
        }
        
        return {
            messages: preparedMessages,
            sessionContext: ctx
        };
    }
    
    /**
     * Update session context after a successful query
     * Called after query execution to store results for follow-ups
     */
    function updateSessionContext(sessionContext, update) {
        const ctx = sessionContext || {
            resolvedEntities: {},
            entityOrder: [],
            queryHistory: [],
            topics: [],
            lastQueryResult: null
        };
        
        // Ensure nested objects exist
        if (!ctx.resolvedEntities) ctx.resolvedEntities = {};
        if (!ctx.entityOrder) ctx.entityOrder = [];
        if (!ctx.queryHistory) ctx.queryHistory = [];
        if (!ctx.topics) ctx.topics = [];
        
        // Add resolved entities
        if (update.resolvedEntities) {
            Object.assign(ctx.resolvedEntities, update.resolvedEntities);
        }
        
        // Merge entityOrder (for recency tracking in pronoun resolution)
        // This enables "them", "it" to refer to the last entity the user asked about
        if (update.entityOrder && Array.isArray(update.entityOrder)) {
            // Merge new order into existing, maintaining recency
            for (const key of update.entityOrder) {
                const idx = ctx.entityOrder.indexOf(key);
                if (idx >= 0) ctx.entityOrder.splice(idx, 1);
                ctx.entityOrder.push(key);
            }
            // Keep bounded
            if (ctx.entityOrder.length > 20) {
                ctx.entityOrder = ctx.entityOrder.slice(-20);
            }
        }
        
        // Store query result for follow-ups (keep last 3 queries)
        if (update.queryResult) {
            ctx.lastQueryResult = {
                query: update.query,
                columns: update.queryResult.columns,
                rows: update.queryResult.rows,
                rowCount: update.queryResult.rowCount,
                timestamp: Date.now()
            };
            
            // Add to history (limited)
            ctx.queryHistory.push(ctx.lastQueryResult);
            if (ctx.queryHistory.length > 3) {
                ctx.queryHistory.shift();
            }
        }
        
        // Track topics discussed
        if (update.topics) {
            update.topics.forEach(t => {
                if (!ctx.topics.includes(t)) {
                    ctx.topics.push(t);
                }
            });
            // Keep topics list manageable
            if (ctx.topics.length > 10) {
                ctx.topics = ctx.topics.slice(-10);
            }
        }
        
        return ctx;
    }
    
    /**
     * Build context summary for LLM prompt
     * Provides structured context without bloating the prompt
     */
    function buildContextSummary(sessionContext) {
        if (!sessionContext) return '';
        
        const parts = [];
        
        // Resolved entities
        const entities = Object.entries(sessionContext.resolvedEntities || {});
        if (entities.length > 0) {
            const entityList = entities.map(([term, info]) => 
                `${info.name} (${info.type}, ID: ${info.id})`
            ).join(', ');
            parts.push(`Known entities: ${entityList}`);
        }
        
        // Last query info for "tell me more" / "drill down"
        if (sessionContext.lastQueryResult) {
            const last = sessionContext.lastQueryResult;
            parts.push(`Last query returned ${last.rowCount} rows with columns: ${last.columns.join(', ')}`);
        }
        
        // Topics discussed
        if (sessionContext.topics && sessionContext.topics.length > 0) {
            parts.push(`Topics discussed: ${sessionContext.topics.join(', ')}`);
        }
        
        return parts.length > 0 
            ? '\n[Session context: ' + parts.join('. ') + ']'
            : '';
    }

    return {
        // Planning
        planExecution: planExecution,
        matchConversationalPattern: matchConversationalPattern,
        
        // Summaries
        getTemplateSummaryForPlanning: getTemplateSummaryForPlanning,
        getDashboardSummaryForPlanning: getDashboardSummaryForPlanning,
        
        // Session context
        prepareConversationHistory: prepareConversationHistory,
        updateSessionContext: updateSessionContext,
        buildContextSummary: buildContextSummary,
        
        // Constants
        MAX_AGENT_ITERATIONS: MAX_AGENT_ITERATIONS,
        
        // Debug
        DEBUG_PLANNING: DEBUG_PLANNING,
        getAndClearDebugLog: getAndClearDebugLog
    };
});