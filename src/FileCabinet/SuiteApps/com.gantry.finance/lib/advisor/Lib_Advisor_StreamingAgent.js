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
 * TRUE AGENTIC ARCHITECTURE (v2.0):
 * The system now implements a true ReAct (Reasoning + Acting) loop:
 *
 * PHASES:
 * 1. INTENT     - Classify the question type (~200 tokens, <1s)
 * 2. REASON_ACT - TRUE ReAct LOOP: Iteratively gather data until ready
 *                 ┌─────────────────────────────────────────────┐
 *                 │  THINK: "What do I need next?"              │
 *                 │  ACT: Invoke ONE tool                       │
 *                 │  OBSERVE: What did I get?                   │
 *                 │  REFLECT: Do I have enough? ──NO──→ LOOP   │
 *                 │      │                                      │
 *                 │     YES → Exit to RESPOND                   │
 *                 └─────────────────────────────────────────────┘
 * 3. SYNTHESIZE - LLM writes custom SuiteQL when tools fail (self-correcting)
 * 4. RESPOND    - LLM sees ACTUAL DATA ROWS, outputs narrative with {{token}} refs
 *
 * KEY DIFFERENCES FROM OLD ARCHITECTURE:
 * - OLD: SELECT all tools → INVOKE all → REFLECT once → RESPOND
 * - NEW: REASON_ACT loops, invoking ONE tool at a time, evaluating after each
 * - LLM decides when it has enough data (not a fixed pipeline)
 * - For comparisons (YoY, etc.), naturally gets both periods' data
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
    './Lib_Advisor_Cache',
    './Lib_Advisor_Utils',
    '../Lib_Dashboard_Registry'
], function(log, AIProviders, Tools, Cache, Utils, DashboardRegistry) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const PHASES = {
        INIT: 'init',
        INTENT: 'intent',
        REASON_ACT: 'reason_act',  // NEW: True ReAct loop - replaces SELECT/INVOKE/REFLECT
        SELECT: 'select',          // DEPRECATED: kept for backwards compatibility
        INVOKE: 'invoke',          // DEPRECATED: kept for backwards compatibility
        REFLECT: 'reflect',        // DEPRECATED: kept for backwards compatibility
        SYNTHESIZE: 'synthesize',  // LLM writes custom SQL when tools fail
        RESPOND: 'respond',        // Generate final response with data access
        COMPLETE: 'complete'
    };

    // Maximum iterations for the ReAct loop to prevent infinite loops
    const MAX_REASON_ACT_ITERATIONS = 8;

    // ═══════════════════════════════════════════════════════════════════════════
    // ADAPTIVE INTELLIGENCE ROUTING (AIR)
    // Task-aware model selection for optimal cost/quality balance
    // ═══════════════════════════════════════════════════════════════════════════

    const TIERS = {
        FAST: 1,      // Fast/cheap: Haiku, GPT-4o-mini, Gemini Flash - for classification, params
        BALANCED: 2,  // Balanced: Sonnet, GPT-4o, Gemini Flash - for reasoning
        PREMIUM: 3    // Premium: Opus, GPT-4, Gemini Pro - for complex analysis, SQL synthesis
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SQL COMPLEXITY ASSESSMENT FOR SYNTHESIZE TIER
    // Allows BALANCED tier for simple SQL, requires PREMIUM for complex queries
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Assess SQL query complexity to determine required tier
     * @param {string} sql - The SQL query to assess
     * @returns {string} 'SIMPLE' or 'COMPLEX'
     */
    function assessQueryComplexity(sql) {
        if (!sql) return 'SIMPLE';

        const sqlUpper = sql.toUpperCase();

        // Complex indicators: JOINs, subqueries, window functions, aggregations with GROUP BY
        const complexIndicators = [
            /\bJOIN\b/,                           // Any JOIN operation
            /\(\s*SELECT\b/,                      // Subqueries
            /\bWITH\s+\w+\s+AS\s*\(/,            // CTEs
            /\bGROUP\s+BY\b.*\bHAVING\b/,        // GROUP BY with HAVING
            /\bOVER\s*\(/,                        // Window functions
            /\bUNION\b/,                          // UNION queries
            /\bINTERSECT\b/,                      // Set operations
            /\bEXCEPT\b/,
            /\bCASE\s+WHEN\b.*\bCASE\s+WHEN\b/,  // Nested CASE statements
        ];

        // Check for complex patterns
        for (const pattern of complexIndicators) {
            if (pattern.test(sqlUpper)) {
                return 'COMPLEX';
            }
        }

        // Simple: single table SELECT, basic WHERE, ORDER BY, LIMIT
        return 'SIMPLE';
    }

    /**
     * Check if synthesize is allowed based on tier and query complexity
     * @param {number} tier - Current tier (1=FAST, 2=BALANCED, 3=PREMIUM)
     * @param {string} queryComplexity - 'SIMPLE' or 'COMPLEX'
     * @returns {boolean} True if synthesize is allowed
     */
    function canUseSynthesize(tier, queryComplexity) {
        if (tier >= TIERS.PREMIUM) return true;
        if (tier >= TIERS.BALANCED && queryComplexity === 'SIMPLE') return true;
        return false;
    }

    /**
     * Get the appropriate tier for SYNTHESIZE phase based on question complexity
     * Predicts likely query complexity from the question/intent before SQL generation
     * @param {Object} state - Current state
     * @returns {number} The tier (2=BALANCED or 3=PREMIUM)
     */
    function getSynthesizeTier(state) {
        // If we already have a generated query, assess its actual complexity
        if (state.synthesize?.queries?.length > 0) {
            const lastQuery = state.synthesize.queries[state.synthesize.queries.length - 1];
            if (lastQuery?.sql) {
                const complexity = assessQueryComplexity(lastQuery.sql);
                return complexity === 'COMPLEX' ? TIERS.PREMIUM : TIERS.BALANCED;
            }
        }

        // Predict complexity from question/intent
        const message = (state.message || '').toLowerCase();
        const intent = state.intent?.intent || '';

        // Indicators that suggest complex queries will be needed
        const complexIntentIndicators = [
            /compar/i,           // compare, comparison
            /year.over.year|yoy|y\/y/i,
            /month.over.month|mom|m\/m/i,
            /trend/i,
            /correlat/i,
            /breakdown.*by.*and/i,  // Multiple groupings
            /ratio/i,
            /percent.*of.*total/i,
            /rank/i,
            /top.*bottom/i,
            /vs\.?\s|versus/i,
        ];

        for (const pattern of complexIntentIndicators) {
            if (pattern.test(message)) {
                return TIERS.PREMIUM;
            }
        }

        // Comparison intent typically needs complex queries
        if (intent === 'comparison') {
            return TIERS.PREMIUM;
        }

        // Default to BALANCED for simpler synthesize requests
        return TIERS.BALANCED;
    }

    /**
     * Get the appropriate tier for a phase based on task requirements
     * @param {string} phase - The SCA phase
     * @param {Object} state - Current state for adaptive decisions
     * @returns {number} The tier (1, 2, or 3)
     */
    function getTierForPhase(phase, state) {
        switch (phase) {
            // Fast tier - simple classification and structured output
            case 'intent':
            case 'select':
            case 'invoke':
            case 'recovery':
                return TIERS.FAST;

            // Balanced tier - requires reasoning about results
            case 'reflect':
            case 'reason_act':  // ReAct loop requires good reasoning
                return TIERS.BALANCED;

            // Synthesize tier - adaptive based on query complexity
            // Simple SQL can use BALANCED, complex SQL needs PREMIUM
            case 'synthesize':
                return getSynthesizeTier(state);

            // Adaptive - based on response complexity
            case 'respond':
                return getAdaptiveRespondTier(state);

            default:
                return TIERS.FAST;
        }
    }

    /**
     * Calculate response complexity to determine RESPOND tier
     * Higher complexity = better model for quality answer
     * @param {Object} state - Current state
     * @returns {number} Complexity score (0-10)
     */
    function calculateResponseComplexity(state) {
        let score = 0;

        // Data volume factor
        const totalRows = (state.dataReferences || []).reduce((sum, ref) =>
            sum + (ref?.summary?.rowCount || 0), 0);
        if (totalRows > 100) score += 2;
        else if (totalRows > 20) score += 1;

        // Data source diversity (multiple tools = more complex synthesis)
        const successfulTools = (state.toolInvocations || []).filter(t => t.success).length;
        if (successfulTools > 2) score += 2;
        else if (successfulTools > 1) score += 1;

        // Dashboard data (rich metrics require better synthesis)
        if ((state.dataReferences || []).some(r => r.isDashboard)) score += 1;

        // Question complexity from INTENT phase
        if (state.intent) {
            if (state.intent.intent === 'comparison') score += 2;
            if (state.intent.intent === 'reporting') score += 1;
            if ((state.intent.semantic_topics || []).length > 2) score += 1;
        }

        // Synthesized SQL (already complex path)
        if (state.synthesizedQuery) score += 2;

        // Multiple entities resolved (cross-entity analysis)
        if (Object.keys(state.resolvedEntities || {}).length > 1) score += 1;

        return Math.min(score, 10); // Cap at 10
    }

    /**
     * Get tier for RESPOND phase based on complexity
     * @param {Object} state - Current state
     * @returns {number} The tier (1, 2, or 3)
     */
    function getAdaptiveRespondTier(state) {
        const complexity = calculateResponseComplexity(state);

        // Premium for complex multi-source analysis
        if (complexity >= 5) {
            log.debug('AIR: Premium tier for RESPOND', { complexity });
            return TIERS.PREMIUM;
        }

        // Balanced for moderate complexity
        if (complexity >= 2) {
            log.debug('AIR: Balanced tier for RESPOND', { complexity });
            return TIERS.BALANCED;
        }

        // Fast for simple summaries
        log.debug('AIR: Fast tier for RESPOND', { complexity });
        return TIERS.FAST;
    }

    const MAX_TOOL_INVOCATIONS = 5;
    const MAX_REFLECT_ITERATIONS = 3;  // Prevent infinite reflection loops
    const MAX_SYNTHESIZE_ITERATIONS = 3; // Max SQL generation/correction attempts

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 8: ITERATION BUDGET ALLOCATION
    // Limits attempts per unique tool to force diversification
    // ═══════════════════════════════════════════════════════════════════════════
    const MAX_ATTEMPTS_PER_TOOL = 3;  // Max attempts per unique tool before requiring different tool
    const MIN_TOOLS_BEFORE_GIVEUP = 2; // Must try at least 2 different tools before giving up

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 6: PROGRESS-BASED CIRCUIT BREAKER
    // Triggers escalation when no progress is made across iterations
    // ═══════════════════════════════════════════════════════════════════════════
    const NO_PROGRESS_THRESHOLD = 3;  // Escalate after 3 consecutive iterations with 0 rows

    // ═══════════════════════════════════════════════════════════════════════════
    // FAILURE MODE CLASSIFICATION
    // Distinguishes between different types of "no data" results
    // ═══════════════════════════════════════════════════════════════════════════

    const FAILURE_MODES = {
        SUCCESS: 'success',                    // Got useful data
        ENTITY_NOT_FOUND: 'entity_not_found',  // Entity doesn't exist in system
        ENTITY_FOUND_NO_DATA: 'entity_found_no_data',  // Entity exists but no matching transactions
        QUERY_TOO_RESTRICTIVE: 'query_too_restrictive', // Filters excluded all results
        NO_DATA_EXISTS: 'no_data_exists',      // No data for this query type at all
        PARTIAL_SUCCESS: 'partial_success',    // Some tools succeeded, some failed
        TOOL_ERROR: 'tool_error'               // Tool execution error
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SEMANTIC ERROR CLASSIFICATION
    // Uses LLM to classify errors when available, with fast fallback
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Classify an error semantically using fast LLM call
     * @param {string} errorMessage - The error message to classify
     * @returns {Object} - { category, recoverable, suggestion }
     */
    function classifyErrorSemantically(errorMessage) {
        const errorText = errorMessage || 'Unknown error';

        try {
            // Fast LLM classification (< 50 tokens response)
            const result = AIProviders.callAI(
                `Classify this NetSuite/SuiteQL error into ONE category:

Error: "${errorText.substring(0, 500)}"

Categories:
- PERMISSION_DENIED: Access/role issues
- INVALID_RECORD: Bad record type or ID
- INVALID_FIELD: Unknown column/field
- INVALID_QUERY: SQL syntax error
- RATE_LIMITED: Governance/concurrency
- NOT_FOUND: Record doesn't exist
- VALIDATION: Business rule violation
- TYPE_MISMATCH: Wrong data type provided
- TIMEOUT: Query took too long
- NETWORK: Connection/timeout
- UNKNOWN: Can't determine

Respond with JSON only: {"category":"...","recoverable":true/false,"suggestion":"one line fix"}`,
                { max_tokens: 100, temperature: 0 }
            );

            const responseText = result.text || result;

            // Try to parse the JSON response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    category: parsed.category || 'UNKNOWN',
                    recoverable: parsed.recoverable !== false,
                    suggestion: parsed.suggestion || 'Check error details'
                };
            }
        } catch (classificationError) {
            log.debug('Semantic error classification failed', { error: classificationError.message });
        }

        // Fallback if LLM response isn't valid JSON or call failed
        return {
            category: 'UNKNOWN',
            recoverable: true,
            suggestion: 'Check error details'
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 2: ERROR SEMANTIC PARSER
    // Parses error messages to extract actionable insights for the LLM
    // Uses semantic classification with fast fallback for critical checks
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Parse an error message and extract actionable insights
     * @param {string} errorMessage - The raw error message
     * @param {string} toolName - The tool that generated the error
     * @param {Object} args - The arguments that were passed
     * @param {Object} options - Optional settings: { useSemanticClassification: boolean }
     * @returns {Object} { category, insight, suggestedAction, parameterHints }
     */
    function parseErrorSemantics(errorMessage, toolName, args, options) {
        if (!errorMessage || typeof errorMessage !== 'string') {
            return {
                category: 'unknown',
                insight: 'An unknown error occurred.',
                suggestedAction: 'Try a different approach.',
                parameterHints: {}
            };
        }

        const lowerError = errorMessage.toLowerCase();
        options = options || {};

        // ═══════════════════════════════════════════════════════════════════════
        // SECURITY-CRITICAL CHECKS - Always run these regardless of LLM
        // ═══════════════════════════════════════════════════════════════════════
        if (lowerError.includes('permission') || lowerError.includes('access denied') ||
            lowerError.includes('unauthorized') || lowerError.includes('insufficient')) {
            return {
                category: 'permission_error',
                insight: `Access to the requested data is restricted.`,
                suggestedAction: `Try accessing data from a different subsidiary or record type.`,
                parameterHints: {},
                recoverable: false
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // SEMANTIC CLASSIFICATION - Use LLM for intelligent error categorization
        // ═══════════════════════════════════════════════════════════════════════
        if (options.useSemanticClassification !== false) {
            try {
                const semanticResult = classifyErrorSemantically(errorMessage);

                // Map semantic categories to detailed insights
                const categoryMappings = {
                    'TYPE_MISMATCH': {
                        insight: `A value of the wrong type was provided. The operation expected a different data type.`,
                        suggestedAction: `Use numeric values for numbers (24 instead of "last 2 years"), check date formats, and ensure IDs are integers.`,
                        parameterHints: { checkTypes: true, usedArgs: args }
                    },
                    'INVALID_FIELD': {
                        insight: `The field or column referenced does not exist or is not accessible.`,
                        suggestedAction: `Verify field names using get_record_schema or check available columns in the record type.`,
                        parameterHints: {}
                    },
                    'INVALID_QUERY': {
                        insight: `The database query has a syntax error or invalid structure.`,
                        suggestedAction: `Check SQL syntax, ensure all referenced tables/columns exist, and verify JOIN conditions.`,
                        parameterHints: { checkTypes: true, usedArgs: args }
                    },
                    'NOT_FOUND': {
                        insight: `The entity or record referenced does not exist in the system.`,
                        suggestedAction: `Verify the entity name spelling or try a broader search. Use resolve_vendor or resolve_customer to find valid entities.`,
                        parameterHints: {}
                    },
                    'VALIDATION': {
                        insight: `One or more values failed business rule validation.`,
                        suggestedAction: `Check that all required parameters are provided and values match the expected format.`,
                        parameterHints: {}
                    },
                    'RATE_LIMITED': {
                        insight: `The operation was limited due to governance or concurrency restrictions.`,
                        suggestedAction: `Wait a moment before retrying, or break the request into smaller operations.`,
                        parameterHints: { suggestRetry: true }
                    },
                    'TIMEOUT': {
                        insight: `The query took too long to execute.`,
                        suggestedAction: `Add more filters to reduce the data volume, or use a shorter time period.`,
                        parameterHints: { suggestShorterPeriod: true, suggestMoreFilters: true }
                    },
                    'PERMISSION_DENIED': {
                        insight: `Access to the requested data is restricted.`,
                        suggestedAction: `Try accessing data from a different subsidiary or record type.`,
                        parameterHints: {}
                    },
                    'INVALID_RECORD': {
                        insight: `The record type specified is invalid or not accessible.`,
                        suggestedAction: `Verify the record type name using explore_schema or check available record types.`,
                        parameterHints: {}
                    },
                    'NETWORK': {
                        insight: `A network or connection error occurred.`,
                        suggestedAction: `Retry the operation. If the problem persists, check system status.`,
                        parameterHints: { suggestRetry: true }
                    }
                };

                const mapping = categoryMappings[semanticResult.category] || {
                    insight: semanticResult.suggestion || `Error occurred: ${errorMessage.substring(0, 100)}`,
                    suggestedAction: `Try a different tool or different parameter values.`,
                    parameterHints: {}
                };

                return {
                    category: semanticResult.category.toLowerCase(),
                    insight: mapping.insight,
                    suggestedAction: mapping.suggestedAction,
                    parameterHints: mapping.parameterHints,
                    recoverable: semanticResult.recoverable,
                    semanticClassification: true
                };
            } catch (e) {
                log.audit('Semantic error classification failed', {
                    error: e.message,
                    errorMessage: errorMessage.substring(0, 100)
                });
                // Fall through to default return below
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // DEFAULT: Return generic error when semantic classification unavailable
        // Pattern-matching fallback removed - LLM classification is always available
        // and provides superior context-aware error handling
        // ═══════════════════════════════════════════════════════════════════════
        return {
            category: 'unknown',
            insight: `Error occurred: ${errorMessage.substring(0, 100)}`,
            suggestedAction: `Try a different tool or different parameter values.`,
            parameterHints: {},
            recoverable: true
        };
    }

    /**
     * Format parsed error insights for inclusion in LLM prompts
     * @param {Object} errorSemantics - Output from parseErrorSemantics
     * @returns {string} Formatted string for LLM context
     */
    function formatErrorInsightsForPrompt(errorSemantics) {
        const lines = [];
        lines.push(`🔍 ERROR ANALYSIS:`);
        lines.push(`   Category: ${errorSemantics.category}`);
        lines.push(`   Insight: ${errorSemantics.insight}`);
        lines.push(`   Suggested Action: ${errorSemantics.suggestedAction}`);

        if (Object.keys(errorSemantics.parameterHints).length > 0) {
            lines.push(`   Parameter Hints:`);
            for (const [key, value] of Object.entries(errorSemantics.parameterHints)) {
                lines.push(`     • ${key}: ${JSON.stringify(value)}`);
            }
        }

        return lines.join('\n');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEMANTIC TOOL DIVERSIFICATION
    // Uses LLM to intelligently suggest alternative tools after failures
    // Replaces hardcoded tool→alternatives mapping with semantic selection
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * SEMANTIC TOOL DIVERSIFICATION PROMPT
     * Used to find alternative tools when one fails repeatedly
     */
    const TOOL_DIVERSIFICATION_PROMPT = `Tool "${'{failed_tool}'}" has failed {failure_reason}.

Original question: "{question}"

Tool description: {tool_description}

Available tools (excluding the failed one):
{available_tools}

Which 2-3 alternative tools could provide similar or complementary data to answer the question?
Consider:
- Tools that access related data sources
- Tools that might have the same information in a different format
- Fallback tools for when specialized queries fail

Reply JSON only:
{
  "alternatives": [
    {"tool": "tool_name", "reason": "why this could help", "suggested_args": {}}
  ]
}`;

    /**
     * Get alternative tools using semantic LLM selection
     * @param {string} failedTool - The tool that failed
     * @param {Object} args - The arguments that were passed
     * @param {Object} resolvedEntities - Any resolved entities in state
     * @param {Object} state - Current agent state for context
     * @returns {Array} List of alternative tools to try [{tool, reason, args}]
     */
    function getAlternativeToolsForDiversification(failedTool, args, resolvedEntities, state) {
        // Get tool manifest for descriptions
        const toolManifest = Tools.getToolManifest();
        const failedToolDesc = toolManifest[failedTool] || 'Unknown tool';

        // Build list of available tools (excluding failed one and already tried)
        const alreadyTried = new Set(
            (state?.toolInvocations || []).map(t => t.tool)
        );
        alreadyTried.add(failedTool);

        const availableTools = Object.entries(toolManifest)
            .filter(([name]) => !alreadyTried.has(name))
            .map(([name, desc]) => `- ${name}: ${desc}`)
            .join('\n');

        // Determine failure reason
        const failureReason = state?.synthesize?.lastError ?
            `with error: ${state.synthesize.lastError.substring(0, 100)}` :
            'multiple times without success';

        try {
            const prompt = TOOL_DIVERSIFICATION_PROMPT
                .replace('{failed_tool}', failedTool)
                .replace('{failure_reason}', failureReason)
                .replace('{question}', state?.message || '')
                .replace('{tool_description}', failedToolDesc)
                .replace('{available_tools}', availableTools);

            const response = AIProviders.callAI(prompt, {
                tier: TIERS.FAST,
                temperature: 0.2,
                jsonMode: true,
                purpose: 'SCA:tool_diversification'
            });

            const parsed = parseJsonResponse(response?.text);

            if (parsed?.alternatives && Array.isArray(parsed.alternatives)) {
                // Validate suggested tools exist and format response
                return parsed.alternatives
                    .filter(alt => alt.tool && toolManifest[alt.tool])
                    .slice(0, 3)
                    .map(alt => ({
                        tool: alt.tool,
                        reason: alt.reason || 'LLM suggested alternative',
                        args: alt.suggested_args || {}
                    }));
            }
        } catch (e) {
            log.debug('Semantic tool diversification failed, using empty fallback', {
                error: e.message,
                failedTool: failedTool
            });
        }

        // Fallback: return empty array - ReAct loop will handle recovery
        return [];
    }

    /**
     * Check if tool diversification is required based on state
     * @param {Object} state - Current agent state
     * @returns {Object} { required: boolean, reason: string, suggestions: Array }
     */
    function checkToolDiversificationRequired(state) {
        // Count attempts per unique tool
        const toolAttempts = {};
        const toolsWithSuccess = new Set();

        for (const data of state.accumulatedData || []) {
            const toolName = data.tool;
            toolAttempts[toolName] = (toolAttempts[toolName] || 0) + 1;

            if (data.success && data.rowCount > 0) {
                toolsWithSuccess.add(toolName);
            }
        }

        // Check if any tool has exceeded the attempt limit
        for (const [tool, attempts] of Object.entries(toolAttempts)) {
            if (attempts >= MAX_ATTEMPTS_PER_TOOL && !toolsWithSuccess.has(tool)) {
                const alternatives = getAlternativeToolsForDiversification(
                    tool,
                    state.accumulatedData.find(d => d.tool === tool)?.args || {},
                    state.resolvedEntities,
                    state
                );

                return {
                    required: true,
                    reason: `Tool "${tool}" has been tried ${attempts} times without success. Must try a different tool.`,
                    exhaustedTool: tool,
                    suggestions: alternatives
                };
            }
        }

        // Check total unique tools tried
        const uniqueToolsTried = new Set(Object.keys(toolAttempts));
        if (uniqueToolsTried.size < MIN_TOOLS_BEFORE_GIVEUP &&
            state.reasonActIterations >= MAX_REASON_ACT_ITERATIONS - 2) {
            return {
                required: true,
                reason: `Only ${uniqueToolsTried.size} unique tool(s) tried. Must try at least ${MIN_TOOLS_BEFORE_GIVEUP} different tools before giving up.`,
                suggestions: []
            };
        }

        return { required: false, reason: null, suggestions: [] };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 6: PROGRESS-BASED CIRCUIT BREAKER
    // Detects when no progress is being made and triggers escalation
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Check if the circuit breaker should trigger based on progress
     * @param {Object} state - Current agent state
     * @returns {Object} { shouldTrigger: boolean, reason: string, escalationAction: string }
     */
    function checkCircuitBreaker(state) {
        const accumulatedData = state.accumulatedData || [];

        if (accumulatedData.length < NO_PROGRESS_THRESHOLD) {
            return { shouldTrigger: false };
        }

        // Check the last N iterations for progress
        const recentData = accumulatedData.slice(-NO_PROGRESS_THRESHOLD);
        const totalRowsRecent = recentData.reduce((sum, d) => sum + (d.rowCount || 0), 0);
        const allFailed = recentData.every(d => !d.success || d.rowCount === 0);

        if (allFailed && totalRowsRecent === 0) {
            // Determine escalation action based on context
            let escalationAction = 'SYNTHESIZE'; // Default: try custom SQL

            // If we've already tried synthesize, suggest clarification
            if (state.synthesize?.iterations > 0) {
                escalationAction = 'CLARIFY';
            }

            // If entity resolution failed, suggest different entity search
            const hadEntityResolution = recentData.some(d =>
                d.tool?.startsWith('resolve_') && !d.success
            );
            if (hadEntityResolution) {
                escalationAction = 'CLARIFY';
            }

            return {
                shouldTrigger: true,
                reason: `No progress detected: ${NO_PROGRESS_THRESHOLD} consecutive attempts returned 0 rows.`,
                consecutiveFailures: NO_PROGRESS_THRESHOLD,
                escalationAction: escalationAction,
                attemptsSummary: recentData.map(d => ({
                    tool: d.tool,
                    success: d.success,
                    rowCount: d.rowCount
                }))
            };
        }

        return { shouldTrigger: false };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIGHTWEIGHT PROMPTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * INTENT_PROMPT - Semantic intent classification
     * RECOMMENDATION 1: Uses LLM's semantic understanding instead of word lists
     * The LLM determines intent, entities, and topics based on meaning, not pattern matching
     */
    const INTENT_PROMPT = `Classify this financial question semantically. Respond with JSON only.
{date_context}
{history_context}
Categories (determine based on semantic meaning, not keywords):
- entity_lookup: ONLY use when the question is JUST about identifying/finding an entity (e.g., "who is acme corp", "find vendor xyz")
- entity_transactions: Finding transactions/documents FOR a specific entity (e.g., "bills from vendor X", "invoices to customer Y", "payments from Z")
  → This is DIFFERENT from entity_lookup! If user wants bills/invoices/payments/transactions for an entity, use entity_transactions
- top_list: Top N customers, vendors, items by some metric
- aging: AR aging, AP aging, overdue amounts
- reporting: Revenue, spend, GL activity, trial balance
- dashboard: Health metrics, KPIs, trends
- comparison: Compare periods, YoY, MoM
- transaction: Specific transaction details (by ID, number, or specific document)
- follow_up: Reference to previous question/data (e.g., "show that as a table", "more details")
- general: General questions, greetings, help

CRITICAL DISTINCTION:
- "who is oblender" → entity_lookup (just identifying)
- "bills from oblender" → entity_transactions (want transactions FOR the entity)
- "what do we owe oblender" → entity_transactions (want AP data FOR the entity)
- "invoices to acme" → entity_transactions (want transactions FOR the entity)

Question: "{question}"

Analyze the SEMANTIC MEANING of the question. Extract:
1. The primary intent category
2. Any named entities mentioned (customer names, vendor names, account names, etc.)
3. The time scope if mentioned
4. Semantic topics - determine what financial domains this question relates to based on meaning (e.g., receivables, payables, revenue, expenses, cash management, profitability)
5. A brief user-friendly narration (max 10 words) describing what you're analyzing, specific to their question
6. For entity_transactions: the transaction_context hint (what type: bills, invoices, payments, credits)
7. OUTPUT CONSTRAINTS - extract any limits or presentation requirements from the question:
   - limit: Number if user says "top 5", "top 10", "first 3", etc.
   - sort_by: What to rank by ("fastest growing" → "growth", "largest" → "amount", "most overdue" → "days_overdue")
   - sort_direction: "desc" for largest/fastest/most, "asc" for smallest/slowest/least
   - highlight: What to emphasize in the answer (e.g., "fastest growing category", "largest expense")
   - exclude: Items to exclude (e.g., "excluding COGS", "except marketing")

NEEDS_RESOLUTION GUIDELINES - Set true ONLY when genuinely ambiguous:
- TRUE: "Show me the stuff" (genuinely unclear what they want)
- TRUE: "Bills from Smith" when multiple entities named Smith exist
- TRUE: "Compare last quarter to the other one" (conflicting references)
- FALSE: "Show utilization by employee" (clear request - use defaults)
- FALSE: "What's our cash position" (clear request - just get the data)
- FALSE: "Revenue by customer" (clear request - use ytd default)
- FALSE: "Show expenses" (clear request - use ytd default)
Most reporting requests should be FALSE - use sensible period defaults instead of asking.

DRILL-DOWN DETECTION:
is_drill_down is true when user wants MORE detail on a previous result:
- "show me the details"
- "break that down"
- "give me more"
- "expand on that"
- "dig deeper"
- "elaborate"
- "can you list them"
- "what are those items"
- "show the table"
- "itemize that"
drill_down_context should describe what they want to expand on (e.g., "vendor analysis", "weekly projection", "AR buckets").

Response format: {"intent": "category", "entities": ["named items"], "time_scope": "ytd|mtd|last_30|custom|none", "needs_resolution": true|false, "references_previous": true|false, "semantic_topics": ["topic1", "topic2"], "transaction_context": "bills|invoices|payments|credits|all", "constraints": {"limit": null, "sort_by": null, "sort_direction": "desc", "highlight": null, "exclude": []}, "is_drill_down": false, "drill_down_context": null, "userNarration": "Looking into your customer revenue..."}`;

    const SELECT_PROMPT = `Select tools to answer this {intent} question. Respond with JSON only.
{date_context}

AVAILABLE TOOLS:
{tool_list}

Question: "{question}"
Intent: {intent}
{entity_context}
{history_context}
{available_data_context}

Rules:
- Pick 1-3 most relevant tools
- For entity names, include resolve_entity first
- Prefer specific tools over run_custom_query
- For follow_up questions referencing previous data, you may select no tools if data is available
- DO NOT select format_response - that's handled automatically

DRILL-DOWN QUERIES:
- If user asks for MORE DETAILS about a collection shown in previous response (e.g., "show weekly projection", "list AR buckets", "what are the critical weeks"), use load_cached_data tool
- Use load_cached_data with the ref_id from the previous dashboard response and the collection_name
- Collection names are listed in previous responses (e.g., weeklyProjection, arBuckets, apBuckets, criticalWeeks, topCustomers)

Also include a brief userNarration (max 10 words) describing what data you'll fetch, specific to their question.

Response format: {"tools": ["tool1", "tool2"], "reasoning": "brief explanation", "userNarration": "I'll analyze your customer transactions..."}`;

    const INVOKE_PROMPT = `Call this tool. Respond with JSON only.
{date_context}

TOOL: {tool_name}
{tool_schema}

{history_context}
Current question: "{question}"
{resolved_entities}

CRITICAL SEMANTIC GUIDANCE:

{period_options}

TRANSACTION TYPES - Infer from context (who is paying whom):
   - "Invoice FROM vendor" / "bill FROM vendor" / "we owe" → transaction_type: "VendBill"
   - "Invoice TO customer" / "customer owes us" / "receivable" → transaction_type: "CustInvc"
   - "Payment TO vendor" / "we paid" → transaction_type: "VendPmt"
   - "Payment FROM customer" / "customer paid" → transaction_type: "CustPmt"
   - "Credit memo TO customer" → transaction_type: "CustCred"
   - "Credit FROM vendor" → transaction_type: "VendCred"

   Determine direction by semantic meaning: who is the payer and who is the payee?

3. ENTITY CONTEXT:
   - If a vendor was resolved, transaction likely involves payables (VendBill, VendPmt)
   - If a customer was resolved, transaction likely involves receivables (CustInvc, CustPmt)

4. CLASSIFICATION DIMENSIONS (for resolve_classification):
   - ALWAYS use dimension="auto" to search all dimensions UNLESS you are 100% certain of the type
   - Common confusion: "Shop", "Engineering", "Sales" are typically DEPARTMENTS, not classes
   - "class" = accounting classification for categorizing transactions
   - "department" = organizational unit (teams, divisions, shops, etc.)
   - "location" = physical place
   - "subsidiary" = legal entity
   - When in doubt, use "auto" - it searches everything!

Response format: {"tool": "{tool_name}", "args": {...}}`;

    // ═══════════════════════════════════════════════════════════════════════════
    // REASON_ACT PROMPT - True ReAct Pattern (Reasoning + Acting in a Loop)
    // This is the core of the agentic system - iteratively gather data until ready
    // ═══════════════════════════════════════════════════════════════════════════

    const REASON_ACT_PROMPT = `You are an agentic financial analyst working step-by-step to answer the user's question.
{date_context}

{history_context}
CURRENT QUESTION: "{question}"

═══════════════════════════════════════════════════════════════════════════════
DATA COLLECTED SO FAR:
{accumulated_data}
═══════════════════════════════════════════════════════════════════════════════

AVAILABLE TOOLS:
{tool_list}

{period_options}

═══════════════════════════════════════════════════════════════════════════════
YOUR TASK: Think step-by-step about what you need to answer this question.

1. ANALYZE what data you already have (see "DATA COLLECTED SO FAR")
2. DETERMINE if you can fully answer the question with current data
3. If YES: respond with action="ANSWER"
4. If NO: identify EXACTLY what data you need next and call ONE tool

CRITICAL RULES:
- Call ONE tool at a time, then evaluate results
- For comparisons (YoY, MoM, etc): USE THE compare_to PARAMETER to get unified comparison data
  Example: "YoY comparison" → get_income_statement(period="ytd", compare_to="prior_year_ytd")
  This returns current_amount, prior_amount, change, pct_change columns in ONE dataset - MUCH better!
  DO NOT make separate calls for each period - use compare_to instead
{comparison_hint}
- Don't guess or assume - if you need data, GET IT
- After getting data, think: "Does this ACTUALLY answer the question?"
- ENTITY IDs: When you resolve an entity (customer/vendor), look for "RESOLVED ENTITIES"
  in the data summary. Use the ACTUAL numeric entity_id (e.g., 416), NOT placeholders.
  WRONG: vendor_id: "{{resolve_entity result}}"
  RIGHT: vendor_id: 416

SENSIBLE DEFAULTS - AVOID UNNECESSARY CLARIFICATION:
{needs_resolution_context}
- For reporting requests WITHOUT a specific period, USE DEFAULT PERIODS and proceed:
  • "Show utilization" → call dashboard_time with default period (this_month)
  • "What are our expenses" → call get_expenses with default period (ytd)
  • "Revenue by customer" → call the appropriate tool with ytd default
  • "Cash position" → call dashboard_cashflow (no period needed)
- DO NOT ask for clarification on straightforward reporting requests
- Only use CLARIFY when:
  • Multiple entities could match and disambiguation is required
  • The request is genuinely ambiguous (not just missing a period)
  • You've tried getting data but need more specific criteria from user

═══════════════════════════════════════════════════════════════════════════════
⚠️ DATA-QUESTION SEMANTIC FIT - CRITICAL VALIDATION
═══════════════════════════════════════════════════════════════════════════════
Before choosing ANSWER, verify the data you collected can DERIVE the answer:

Ask yourself: "What METRIC does the user want?"
- Speed/velocity questions (faster, slower, how long) → need TIME-based data (dates, durations)
- Amount questions (how much, total, balance) → need QUANTITY data (amounts, counts)
- Trend questions (increasing, declining) → need TIME-SERIES data (multiple periods)
- Comparison questions → need COMPARABLE data for both entities

Then ask: "Does my collected data contain this metric type?"
- Aging reports show CURRENT OUTSTANDING BALANCES by age bucket
  → They do NOT show payment speed, payment history, or average days to pay
- Transaction lists show WHAT transactions occurred
  → They may NOT show comparative metrics unless you compute them
- Summary dashboards show AGGREGATE metrics
  → They may NOT have the granular detail needed

If the data type doesn't match the question's metric type:
→ Use SYNTHESIZE to get the right data, or try a different tool
→ Do NOT fabricate conclusions from mismatched data

WHEN A QUERY RETURNS 0 ROWS:
- Look at "💡 BROADENING OPTIONS" - YOU DECIDE whether to use them
- Look at "🔄 ALTERNATIVE TOOLS TO CONSIDER" - consider different approaches
- Progressive strategy: Start specific, then broaden if needed
  1. First try the exact request (e.g., bills from last 30 days)
  2. If empty, consider: expand period (last_90_days → all) OR remove filters
  3. If still empty, try alternative tools (get_vendor_details, get_ap_aging)
  4. If entity has NO transaction history, that's a valid finding - report it
- NEVER assume data doesn't exist without trying broader queries

WHEN TO USE SYNTHESIZE (Custom SQL):
- Use SYNTHESIZE only when pre-built tools CANNOT answer the question
- Indicators that you should SYNTHESIZE:
  • You've tried 3+ variations of a tool with no results AND the entity exists
  • The question needs data that no pre-built tool provides
  • You need to join data in ways tools don't support
- Do NOT use SYNTHESIZE for simple queries - try broadening first
═══════════════════════════════════════════════════════════════════════════════

RESPOND WITH JSON:

If you need MORE DATA (single tool):
{{
  "thinking": "I have X, but I still need Y because...",
  "action": "GET_DATA",
  "tool": "tool_name",
  "args": {{}},
  "userNarration": "Brief status (max 8 words)"
}}

⚠️ FOR PERIOD COMPARISONS (YoY, MoM, quarter vs quarter):
ALWAYS use the compare_to parameter on financial statement tools - this returns a SINGLE unified table with pre-computed deltas (change, pct_change) which is MUCH better for comparison analysis.

Example - comparing this year to last year:
{{
  "thinking": "User wants YoY comparison. I'll use compare_to for unified comparison data with deltas.",
  "action": "GET_DATA",
  "tool": "get_income_statement",
  "args": {{ "period": "ytd", "compare_to": "prior_year_ytd" }},
  "userNarration": "Building YoY comparison"
}}

This returns columns: current_amount, prior_amount, change, pct_change - perfect for comparison analysis.
DO NOT make separate calls for each period - always use compare_to for comparisons.

If you need MULTIPLE TRULY INDEPENDENT datasets (NOT for period comparisons):
{{
  "thinking": "I need unrelated datasets: customer revenue AND vendor spend...",
  "action": "GET_DATA_BATCH",
  "tools": [
    {{ "tool": "get_customer_revenue", "args": {{}} }},
    {{ "tool": "get_vendor_spend", "args": {{}} }}
  ],
  "userNarration": "Fetching multiple datasets"
}}
NOTE: Only use GET_DATA_BATCH for truly independent data. NEVER use it for period comparisons.

If you have ENOUGH DATA to answer:
{{
  "thinking": "I have all the data needed: [list what you have]. I can now answer because...",
  "action": "ANSWER",
  "userNarration": "Ready to present findings"
}}

If you need to write CUSTOM SQL (tools don't cover this):
{{
  "thinking": "Pre-built tools cannot answer this because...",
  "action": "SYNTHESIZE",
  "userNarration": "Writing custom query"
}}

If the question is AMBIGUOUS and needs clarification:
{{
  "thinking": "The question is unclear because...",
  "action": "CLARIFY",
  "clarification_question": "What specifically would you like to know?",
  "userNarration": "Need more details"
}}`;

    // ═══════════════════════════════════════════════════════════════════════════
    // REFLECT PROMPT - ReAct Pattern (Reasoning + Acting)
    // Evaluates tool results and decides next action
    // DEPRECATED: Kept for backwards compatibility, REASON_ACT replaces this
    // ═══════════════════════════════════════════════════════════════════════════

    const REFLECT_PROMPT = `You are an agentic financial analyst. Your job is to evaluate whether you have the RIGHT data to answer the user's SPECIFIC question.

{history_context}
CURRENT QUESTION: "{question}"

═══════════════════════════════════════════════════════════════════════════════
⚠️ CHECK DATA FIRST - THIS IS THE MOST IMPORTANT SECTION
═══════════════════════════════════════════════════════════════════════════════

DATA COLLECTED:
{data_summary}

RESOLVED ENTITIES:
{resolved_entities}

TOOL EXECUTION SUMMARY:
{tool_summary}

⚠️ IMPORTANT: If DATA COLLECTED shows rows with actual data, you HAVE data to work with!
Custom SQL queries from SYNTHESIZE phase appear in both DATA COLLECTED and TOOL SUMMARY.
Do NOT say "no data found" if the DATA COLLECTED section shows rows > 0.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL: QUESTION-DATA MATCHING

Ask yourself these questions:

1. GRANULARITY CHECK:
   - Does the user want SUMMARY totals or DETAILED breakdown?
   - If they said "by employee", "by customer", "by project" - do you have that breakdown?
   - If you only have summary metrics but they want per-item details, you need MORE DATA

2. COLLECTION CHECK:
   - Look at "AVAILABLE COLLECTIONS" in the data summary
   - If a collection matches what the user needs (e.g., employeeUtilization for "by employee"), LOAD IT
   - Collections contain the detailed data - summary metrics are not enough for breakdown queries

3. COVERAGE CHECK:
   - Does the data actually answer what was asked?
   - Having "some data" is NOT the same as having "the right data"

═══════════════════════════════════════════════════════════════════════════════
DECIDE YOUR ACTION:

- PROCEED: You have EXACTLY what's needed. Include the full response blocks (saves a round trip)
- LOAD_COLLECTION: A dashboard collection exists with needed detail → load it
- BROADEN: Retry with broader parameters (expand date range, remove filters)
- DIFFERENT_TOOL: Need a completely different tool
- SYNTHESIZE: Need custom SQL query (tools don't cover this)
- CLARIFY: Genuinely ambiguous, need user input
- GIVE_UP: Exhausted all options

═══════════════════════════════════════════════════════════════════════════════
CHART AXIS RULES:
- x = LABEL axis (categories, dates, names) - displayed on horizontal axis
- y = VALUE axis (numeric amounts, counts) - displayed on vertical axis
- Example: For "Invoice Amounts Over Time", use x="trandate", y="amount"
- NEVER put numeric values on x-axis or dates on y-axis

═══════════════════════════════════════════════════════════════════════════════
RESPONSE FORMAT (JSON only):

{{
  "evaluation": {{
    "has_useful_data": true|false,
    "answers_specific_question": true|false,
    "needs_more_detail": true|false,
    "available_collections": ["collection_names_if_any"],
    "failure_mode": "SUCCESS|NEEDS_COLLECTION|ENTITY_NOT_FOUND|WRONG_GRANULARITY|NO_DATA_EXISTS"
  }},
  "diagnosis": "Does the data answer '{question}'? Be specific.",
  "action": "PROCEED|LOAD_COLLECTION|BROADEN|DIFFERENT_TOOL|SYNTHESIZE|CLARIFY|GIVE_UP",
  "action_details": {{
    "ref_id": "ref_id_for_load_collection",
    "collection_name": "collection_name_to_load",
    "tool": "tool_name_if_different_tool",
    "modified_params": {{}},
    "clarification_question": "question_if_clarify"
  }},
  "reasoning": "Why this action? What data do you need that you don't have?",
  "userNarration": "Brief status (max 10 words)",

  "response": {{
    "blocks": [
      {{"type": "text", "content": "Analysis with {{data.rows[N].column}} tokens..."}},
      {{"type": "metrics", "items": [{{"label": "Label", "value": "{{token}}", "trend": "up|down|neutral"}}]}},
      {{"type": "table", "dataRef": "ref_xxx", "title": "Title"}},
      {{"type": "chart", "chartType": "bar|line|pie", "dataRef": "ref_xxx", "x": "label_column", "y": "value_column"}},
      {{"type": "list", "title": "Findings", "items": ["item1", "item2"]}}
    ]
  }}
}}

⚠️ IMPORTANT: Only include "response" field if action is "PROCEED".
The response.blocks should be the COMPLETE final answer using the data you have.
Use {{data.rows[N].column}} tokens for actual values - they will be resolved.`;

    // ═══════════════════════════════════════════════════════════════════════════
    // SYNTHESIZE PROMPT - LLM Writes Custom SuiteQL
    // World-class SQL generation when pre-built tools fail
    // ═══════════════════════════════════════════════════════════════════════════

    const SYNTHESIZE_PROMPT = `You are an expert NetSuite SuiteQL developer. Write a custom query to answer the user's question.

{history_context}
CURRENT QUESTION: "{question}"

═══════════════════════════════════════════════════════════════════════════════
CONTEXT FROM PREVIOUS ATTEMPTS:
{previous_context}

═══════════════════════════════════════════════════════════════════════════════
NETSUITE SUITEQL SCHEMA:

**CORE TABLES:**

transaction (Header-level transactions)
  - id, tranid, trandate, type, entity, subsidiary, status
  - foreigntotal (USE THIS for amounts - 'amount' is NOT exposed!)
  - foreignamountunpaid, amountremaining, duedate
  - posting ('T'/'F'), voided ('T'/'F'), memo
  - ALWAYS filter: posting = 'T' AND voided = 'F'
  - Types: CustInvc, CustPymt, VendBill, VendPymt, CashSale, Check, Journal, ExpRept

transactionline (Line-level detail)
  - id, transaction, linesequencenumber, item
  - netamount (USE THIS - 'amount' is NOT exposed!)
  - quantity, rate, department, class, location, memo
  - mainline ('T' for header, 'F' for lines)
  - Filter mainline = 'F' for line items

transactionaccountingline (GL entries - USE FOR EXPENSE/INCOME ANALYSIS)
  - id, transaction, account
  - amount, debit, credit (THESE ARE exposed here!)
  - department, class, location, posting

account (Chart of accounts)
  - id, acctnumber, accountsearchdisplayname, accttype
  - balance, parent, subsidiary, isinactive
  - Types: Bank, AcctRec, AcctPay, Income, COGS, Expense, OthIncome, OthExpense, Equity, FixedAsset

customer
  - id, entityid, companyname, email, phone, subsidiary
  - balance (outstanding AR), overduebalance, creditlimit, isinactive

vendor
  - id, entityid, companyname, email, phone, subsidiary
  - balance (outstanding AP), isinactive

employee
  - id, entityid, firstname, lastname, email, department, subsidiary, isinactive

accountingperiod
  - id, periodname, startdate, enddate, isyear ('T'/'F'), isquarter ('T'/'F')

**SUITEQL SYNTAX RULES (CRITICAL!):**

1. ROW LIMITS: Wrap query in subquery and use ROWNUM (NOT "LIMIT" or "FETCH FIRST"!)
   ✓ SELECT * FROM (SELECT * FROM customer ORDER BY id) WHERE ROWNUM <= 100
   ✗ SELECT * FROM customer LIMIT 100
   ✗ SELECT * FROM customer FETCH FIRST 100 ROWS ONLY
   NOTE: ROWNUM must be in outer WHERE clause because it's evaluated BEFORE ORDER BY

2. DISPLAY NAMES: Use BUILTIN.DF() for foreign key display values
   ✓ BUILTIN.DF(transaction.entity) AS entity_name
   ✓ BUILTIN.DF(tal.account) AS account_name

3. DATE ARITHMETIC:
   - CURRENT_DATE (today)
   - CURRENT_DATE + 30 (add 30 days - just use + operator!)
   - CURRENT_DATE - 30 (subtract 30 days)
   - TO_DATE('2024-01-01', 'YYYY-MM-DD')
   - ADD_MONTHS(CURRENT_DATE, -12)
   - TRUNC(date, 'MM') for month start, 'Q' for quarter, 'IW' for week

4. BOOLEANS: Use 'T' for true, 'F' for false
   ✓ WHERE posting = 'T' AND voided = 'F'

5. STRING COMPARISON: Use single quotes
   ✓ WHERE type = 'VendBill'

6. CASE STATEMENTS for conditional aggregation:
   SUM(CASE WHEN condition THEN value ELSE 0 END)

7. CTEs (WITH clause): Supported! Rules for CTEs:
   - The main SELECT must reference a real table (not just CTEs)
   - Use CROSS JOIN to bring in CTE values
   - For row limits with ORDER BY, wrap entire CTE query: SELECT * FROM (WITH ... SELECT ... ORDER BY ...) WHERE ROWNUM <= N
   - For scalar aggregates, prefer subqueries from DUAL instead of CTEs

**COMMON PATTERNS:**

YoY Comparison (using CTEs):
SELECT * FROM (
  WITH current_year AS (
    SELECT account, SUM(amount) as amount
    FROM transactionaccountingline tal
    JOIN transaction t ON tal.transaction = t.id
    WHERE t.trandate >= TO_DATE('2025-01-01', 'YYYY-MM-DD')
      AND t.posting = 'T' AND t.voided = 'F'
    GROUP BY account
  ),
  prior_year AS (
    SELECT account, SUM(amount) as amount
    FROM transactionaccountingline tal
    JOIN transaction t ON tal.transaction = t.id
    WHERE t.trandate >= TO_DATE('2024-01-01', 'YYYY-MM-DD')
      AND t.trandate < TO_DATE('2025-01-01', 'YYYY-MM-DD')
      AND t.posting = 'T' AND t.voided = 'F'
    GROUP BY account
  )
  SELECT c.account, BUILTIN.DF(c.account) AS account_name,
    c.amount AS current_amount, p.amount AS prior_amount,
    CASE WHEN p.amount > 0 THEN (c.amount - p.amount) / p.amount * 100 END AS yoy_pct
  FROM current_year c
  LEFT JOIN prior_year p ON c.account = p.account
) WHERE ROWNUM <= 100

Cash Flow Projection (AR/AP due in next N days):
SELECT
  (SELECT COALESCE(SUM(balance), 0) FROM account WHERE accttype = 'Bank' AND isinactive = 'F') AS current_cash,
  (SELECT COALESCE(SUM(foreignamountunpaid), 0) FROM transaction
   WHERE type = 'CustInvc' AND posting = 'T' AND voided = 'F'
   AND duedate BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS ar_due_30_days,
  (SELECT COALESCE(SUM(foreignamountunpaid), 0) FROM transaction
   WHERE type = 'VendBill' AND posting = 'T' AND voided = 'F'
   AND duedate BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS ap_due_30_days
FROM DUAL

Expense by Category:
SELECT * FROM (
  SELECT a.acctnumber, a.accountsearchdisplayname,
    SUM(COALESCE(tal.debit,0) - COALESCE(tal.credit,0)) as amount
  FROM transactionaccountingline tal
  JOIN transaction t ON tal.transaction = t.id
  JOIN account a ON tal.account = a.id
  WHERE a.accttype = 'Expense' AND t.posting = 'T' AND t.voided = 'F'
  GROUP BY a.acctnumber, a.accountsearchdisplayname
  ORDER BY amount DESC
) WHERE ROWNUM <= 50

═══════════════════════════════════════════════════════════════════════════════
{error_context}
═══════════════════════════════════════════════════════════════════════════════

Write a SuiteQL query to answer the user's question. Think step by step:
1. What data do I need?
2. Which tables have that data?
3. What joins are required?
4. What filters apply?
5. How should I aggregate/sort?

Response format (JSON only):
{{
  "reasoning": "Step-by-step explanation of query design",
  "query": "The complete SuiteQL query",
  "purpose": "Brief description of what this query returns",
  "expected_columns": ["col1", "col2", "..."]
}}`;

    // ═══════════════════════════════════════════════════════════════════════════
    // MARKDOWN DIRECTIVE ARCHITECTURE (MDA) - Revolutionary Fast Response System
    // LLMs generate markdown naturally with simple directives for rich content
    // Code parses directives and builds tables/charts from dataRefs - BLAZING FAST
    // ═══════════════════════════════════════════════════════════════════════════

    const MDA_RESPOND_PROMPT = `You are a financial analyst. Analyze this data and write a clear response.

{history_context}
QUESTION: "{question}"

{data_sections}

═══════════════════════════════════════════════════════════════════════════════
WRITE YOUR RESPONSE IN MARKDOWN with these special directives:

1. TABLES - Show data from a dataRef:
   :::table ref_xxx
   Optional Title Here
   :::

2. CHARTS - Visualize data:
   :::chart bar ref_xxx
   x_column | y_column | Optional Title
   :::
   (chart types: bar, line, pie)

3. METRICS - Key numbers (max 4):
   :::metrics
   | Revenue | $1.2M | up |
   | Expenses | $800K | down |
   :::
   Format: | Label | Value | trend |
   Trend must be: up, down, or neutral
   ⚠️ DO NOT include header row or alignment rows like |:---|

4. LISTS - Findings or recommendations:
   :::list Optional Title
   - First item
   - Second item
   - Third item
   :::

5. TEXT - Just write normally (no directive needed)

═══════════════════════════════════════════════════════════════════════════════
TOKEN SYNTAX - Reference actual data values:

Row values: {{data.rows[0].column_name}} or {{data.rows[0].column_name:currency}}
Stats: {{data.stats.total:currency}}, {{data.stats.count}}, {{data.stats.average}}
Column totals: {{data.stats.total_column_name:currency}}

MULTI-DATA SOURCE SYNTAX (when comparing periods or multiple datasets):
- First dataset: {{data[0].rows[0].column}} or {{data[0].stats.total:currency}}
- Second dataset: {{data[1].rows[0].column}} or {{data[1].stats.total:currency}}
- By ref ID: {{ref:ref_abc123.rows[0].column:currency}}

═══════════════════════════════════════════════════════════════════════════════
{constraints_section}
═══════════════════════════════════════════════════════════════════════════════
GUIDELINES:

- Start with a brief overview of what the data shows
- Interleave explanatory text between tables and charts
- Use metrics for quick insights (place early)
- Use tables for detailed breakdowns
- Use charts for patterns/comparisons (bar: compare, line: trends, pie: composition, comparison: side-by-side period comparison)
- End with key findings or recommendations
- Write naturally - this is markdown, not JSON
- STRICTLY follow any OUTPUT CONSTRAINTS specified above

═══════════════════════════════════════════════════════════════════════════════
EXAMPLE RESPONSE:

Here's your year-over-year revenue comparison for {{data.rows[0].customer_name}}...

:::metrics
| Total Revenue | {{data.stats.total:currency}} | up |
| Record Count | {{data.stats.count}} | neutral |
:::

The current period shows strong performance:

:::table ref_abc123
Current Period Revenue
:::

Compared to the prior period:

:::table ref_def456
Prior Period Revenue
:::

:::chart bar ref_abc123
customer_name | total_revenue | Revenue by Customer
:::

:::list Key Findings
- Revenue increased 15% year-over-year
- Top 3 customers account for 60% of total
- New customer acquisition up 20%
:::

═══════════════════════════════════════════════════════════════════════════════

Now write your analysis:`;

    // ═══════════════════════════════════════════════════════════════════════════
    // MARKDOWN DIRECTIVE PARSER (MDA)
    // Parses markdown with :::directive blocks into structured block array
    // BLAZING FAST - LLM writes markdown, code builds rich content
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Parse markdown with directives into blocks array
     * Directives: :::table, :::chart, :::metrics, :::list
     * Regular text becomes text blocks
     * @param {string} markdown - Raw markdown from LLM
     * @param {Object} state - Current state for token resolution
     * @returns {Array} Array of block objects
     */
    function parseMarkdownDirectives(markdown, state) {
        if (!markdown || typeof markdown !== 'string') {
            log.debug('MDA: empty or invalid markdown input');
            return [];
        }

        const blocks = [];
        let currentText = '';

        // Split by directive markers (:::)
        // Regex captures: opening directive, content, closing
        const directiveRegex = /:::(table|chart|metrics|list)\s*([^\n]*)\n([\s\S]*?):::/g;

        let lastIndex = 0;
        let match;

        while ((match = directiveRegex.exec(markdown)) !== null) {
            // Capture text before this directive
            const textBefore = markdown.substring(lastIndex, match.index).trim();
            if (textBefore) {
                blocks.push({
                    type: 'text',
                    content: textBefore
                });
            }

            const directiveType = match[1];
            const directiveMeta = match[2].trim();
            const directiveContent = match[3].trim();

            try {
                const block = parseDirectiveBlock(directiveType, directiveMeta, directiveContent);
                if (block) {
                    blocks.push(block);
                }
            } catch (e) {
                log.debug('MDA: error parsing directive', {
                    type: directiveType,
                    error: e.message
                });
            }

            lastIndex = match.index + match[0].length;
        }

        // Capture remaining text after last directive
        const remainingText = markdown.substring(lastIndex).trim();
        if (remainingText) {
            blocks.push({
                type: 'text',
                content: remainingText
            });
        }

        log.debug('MDA: parsed markdown into blocks', {
            inputLength: markdown.length,
            blockCount: blocks.length,
            blockTypes: blocks.map(b => b.type).join(',')
        });

        return blocks;
    }

    /**
     * Parse a single directive block based on type
     * @param {string} type - Directive type (table, chart, metrics, list)
     * @param {string} meta - Metadata after directive type (e.g., "bar ref_xxx")
     * @param {string} content - Content inside the directive
     * @returns {Object|null} Block object or null if invalid
     */
    function parseDirectiveBlock(type, meta, content) {
        switch (type) {
            case 'table':
                return parseTableDirective(meta, content);
            case 'chart':
                return parseChartDirective(meta, content);
            case 'metrics':
                return parseMetricsDirective(content);
            case 'list':
                return parseListDirective(meta, content);
            default:
                return null;
        }
    }

    /**
     * Parse :::table ref_xxx directive
     * Format: :::table ref_xxx
     *         Optional Title
     *         :::
     */
    function parseTableDirective(meta, content) {
        // meta contains the dataRef
        const dataRef = meta.trim();
        if (!dataRef || !dataRef.startsWith('ref_')) {
            log.debug('MDA: invalid table dataRef', { meta });
            return null;
        }

        return {
            type: 'table',
            dataRef: dataRef,
            title: content.trim() || undefined
        };
    }

    /**
     * Parse :::chart type ref_xxx directive
     * Format: :::chart bar ref_xxx
     *         x_column | y_column | Optional Title
     *         :::
     */
    function parseChartDirective(meta, content) {
        // meta format: "bar ref_xxx" or "line ref_xxx" or "pie ref_xxx"
        const metaParts = meta.trim().split(/\s+/);
        if (metaParts.length < 2) {
            log.debug('MDA: invalid chart meta', { meta });
            return null;
        }

        const chartType = metaParts[0].toLowerCase();
        const dataRef = metaParts[1];

        if (!['bar', 'line', 'pie'].includes(chartType)) {
            log.debug('MDA: invalid chart type', { chartType });
            return null;
        }

        if (!dataRef || !dataRef.startsWith('ref_')) {
            log.debug('MDA: invalid chart dataRef', { dataRef });
            return null;
        }

        // content format: "x_column | y_column | Optional Title"
        const contentParts = content.split('|').map(s => s.trim());
        if (contentParts.length < 2) {
            log.debug('MDA: invalid chart content', { content });
            return null;
        }

        return {
            type: 'chart',
            chartType: chartType,
            dataRef: dataRef,
            x: contentParts[0],
            y: contentParts[1],
            title: contentParts[2] || undefined
        };
    }

    /**
     * Parse :::metrics directive
     * Format: :::metrics
     *         | Label | Value | trend |
     *         | Revenue | $1.2M | up |
     *         :::
     */
    function parseMetricsDirective(content) {
        const lines = content.split('\n').filter(l => l.trim());
        const items = [];

        for (const line of lines) {
            // Skip header row if present
            if (line.toLowerCase().includes('label') && line.toLowerCase().includes('value')) {
                continue;
            }

            // Skip markdown table alignment rows: :---, :--:, ---:, ---, |---|
            // These are formatting hints, not data
            if (/^[\|\s\-:]+$/.test(line) || line.includes(':---') || line.includes('---:') || line.includes(':--:')) {
                continue;
            }

            // Parse pipe-delimited format: | Label | Value | trend |
            const parts = line.split('|').map(s => s.trim()).filter(s => s);
            if (parts.length >= 2) {
                // Additional validation: skip if parts look like alignment syntax
                if (parts[0].match(/^-+$/) || parts[1].match(/^-+$/)) {
                    continue;
                }

                items.push({
                    label: parts[0].substring(0, 50),
                    value: parts[1],
                    trend: ['up', 'down', 'neutral'].includes(parts[2]?.toLowerCase())
                        ? parts[2].toLowerCase()
                        : 'neutral'
                });
            }
        }

        if (items.length === 0) {
            return null;
        }

        // Limit to 4 metrics
        return {
            type: 'metrics',
            items: items.slice(0, 4)
        };
    }

    /**
     * Parse :::list directive
     * Format: :::list Optional Title
     *         - First item
     *         - Second item
     *         :::
     */
    function parseListDirective(meta, content) {
        const title = meta.trim() || undefined;
        const lines = content.split('\n').filter(l => l.trim());
        const items = [];

        for (const line of lines) {
            // Parse bullet points: "- Item text" or "* Item text"
            const match = line.match(/^[\-\*]\s*(.+)$/);
            if (match) {
                items.push(match[1].trim());
            }
        }

        if (items.length === 0) {
            return null;
        }

        return {
            type: 'list',
            title: title,
            items: items
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RECOMMENDATION 6: PROACTIVE ERROR RECOVERY
    // Maps tools to alternative tools that can provide similar data when failures occur
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * SEMANTIC SIMPLE TOOL FALLBACK PROMPT
     * Used for quick tool alternative suggestions
     */
    const SIMPLE_TOOL_FALLBACK_PROMPT = `Tool "${'{tool_name}'}" failed.

Tool description: {tool_description}

Available alternative tools:
{available_tools}

Which 2 tools could provide similar data? Reply JSON only:
{"alternatives": ["tool1", "tool2"]}`;

    /**
     * Get alternative tools to try when a tool fails (semantic version)
     * Uses LLM to find semantically similar tools instead of hardcoded mapping
     * @param {string} toolName - The failed tool
     * @param {Object} state - Optional state for context
     * @returns {string[]} Array of alternative tool names to try
     */
    function getAlternativeTools(toolName, state) {
        // Get tool manifest for descriptions
        const toolManifest = Tools.getToolManifest();
        const toolDesc = toolManifest[toolName] || 'Unknown tool';

        // Build list of available tools (excluding failed one)
        const availableTools = Object.entries(toolManifest)
            .filter(([name]) => name !== toolName)
            .map(([name, desc]) => `- ${name}: ${desc}`)
            .join('\n');

        try {
            const prompt = SIMPLE_TOOL_FALLBACK_PROMPT
                .replace('{tool_name}', toolName)
                .replace('{tool_description}', toolDesc)
                .replace('{available_tools}', availableTools);

            const response = AIProviders.callAI(prompt, {
                tier: TIERS.FAST,
                temperature: 0.1,
                jsonMode: true,
                purpose: 'SCA:tool_fallback'
            });

            const parsed = parseJsonResponse(response?.text);

            if (parsed?.alternatives && Array.isArray(parsed.alternatives)) {
                // Validate suggested tools exist
                return parsed.alternatives
                    .filter(alt => toolManifest[alt])
                    .slice(0, 2);
            }
        } catch (e) {
            log.debug('Semantic tool fallback failed', {
                error: e.message,
                failedTool: toolName
            });
        }

        // Fallback: return empty array - ReAct loop will handle recovery
        return [];
    }

    /**
     * Build a retry suggestion message for users when tools fail
     * @param {string} toolName - The failed tool
     * @param {string} error - The error message
     * @returns {string} User-friendly suggestion
     */
    function buildRetrySuggestion(toolName, error) {
        const suggestions = {
            'resolve_entity': 'Try being more specific with the entity name, or check if the entity exists in the system.',
            'get_ar_aging': 'Try asking about specific customers or recent invoices instead.',
            'get_ap_aging': 'Try asking about specific vendors or recent bills instead.',
            'get_customer_revenue': 'Try asking for top customers or customer value analysis.',
            'get_vendor_spend': 'Try asking for top vendors or vendor performance metrics.',
            'run_custom_query': 'Try rephrasing your question to use a specific report or analysis.'
        };

        return suggestions[toolName] || 'Try rephrasing your question or asking for different data.';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DASHBOARD INTELLIGENCE BRIDGE
    // Converts dashboard intelligence objects to LLM-consumable data references
    // Works dynamically with any dashboard registered in Dashboard Registry
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Check if a tool result is a dashboard intelligence object
     * @param {Object} result - Tool execution result
     * @returns {boolean} True if result contains dashboard intelligence
     */
    function isDashboardResult(result) {
        return result && result.success && result.intelligence && result.dashboard;
    }

    /**
     * Build a comprehensive LLM-consumable summary from dashboard intelligence
     * Dynamically reads schema from Dashboard Registry - works for any dashboard
     *
     * @param {Object} result - Dashboard tool result with intelligence object
     * @returns {Object} Data structure formatted for RESPOND phase consumption
     */
    /**
     * Threshold for inlining collections - collections with fewer items
     * than this will be fully expanded in the LLM prompt
     */
    const COLLECTION_INLINE_THRESHOLD = 15;

    function buildDashboardIntelligenceData(result) {
        const dashboardId = result.dashboard;
        const intelligence = result.intelligence;

        // Get schema from Dashboard Registry
        const dashboard = DashboardRegistry.getDashboard(dashboardId);
        const schema = dashboard?.dataSchema;

        if (!schema) {
            log.debug('Dashboard Intelligence Bridge', 'No schema for: ' + dashboardId);
            return null;
        }

        // Build summary rows - one row per metric for LLM consumption
        const rows = [];
        const metrics = intelligence.metrics || {};

        // Process all metrics dynamically from the intelligence object
        for (const [metricName, metricData] of Object.entries(metrics)) {
            const fieldDef = schema.fields?.[metricName];
            rows.push({
                metric_name: metricName,
                value: metricData.value,
                formatted_value: metricData.formatted || String(metricData.value),
                description: metricData.desc || fieldDef?.desc || metricName,
                type: metricData.type || fieldDef?.type || 'unknown',
                status: metricData.status || null,
                trend: metricData.trend || null,
                change: metricData.change || null
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // INLINE SMALL COLLECTIONS
        // Collections with <= COLLECTION_INLINE_THRESHOLD items are fully expanded
        // This allows LLM to see all data without needing drill-down queries
        // ═══════════════════════════════════════════════════════════════════════
        const collections = intelligence.collections || {};
        const inlinedCollections = {}; // Store full collection data for text summary

        for (const [collectionName, collectionInfo] of Object.entries(collections)) {
            const fieldDef = schema.fields?.[collectionName];
            const shouldInline = collectionInfo.count <= COLLECTION_INLINE_THRESHOLD;

            // Try to load full collection data for inlining
            let fullCollectionData = null;
            if (shouldInline && intelligence.refId) {
                try {
                    const collectionResult = Cache.loadCollection(
                        intelligence.refId,
                        collectionName,
                        { limit: COLLECTION_INLINE_THRESHOLD }
                    );
                    if (collectionResult.success && collectionResult.items) {
                        fullCollectionData = collectionResult;
                        inlinedCollections[collectionName] = collectionResult;
                    }
                } catch (e) {
                    log.debug('Dashboard Intelligence Bridge', 'Failed to load collection for inline: ' + e.message);
                }
            }

            rows.push({
                metric_name: collectionName + '_collection',
                value: collectionInfo.count,
                formatted_value: `${collectionInfo.count} items`,
                description: collectionInfo.desc || fieldDef?.desc || `${collectionName} data`,
                type: 'collection',
                status: null,
                trend: null,
                change: null,
                preview: (collectionInfo.preview || []).join(', '),
                columns: (collectionInfo.columns || []).join(', '),
                refId: collectionInfo.refId,
                inlined: shouldInline && fullCollectionData !== null
            });
        }

        // Build column definitions
        const columns = [
            'metric_name', 'value', 'formatted_value', 'description',
            'type', 'status', 'trend', 'change', 'preview', 'columns', 'refId'
        ];

        // Build comprehensive text summary for the LLM
        let textSummary = `DASHBOARD: ${dashboard.name} (${dashboardId})\n`;
        textSummary += `${schema.summary}\n\n`;

        // Add insights if available
        if (intelligence.insights && intelligence.insights.length > 0) {
            textSummary += `KEY INSIGHTS:\n`;
            intelligence.insights.forEach(insight => {
                textSummary += `• ${insight}\n`;
            });
            textSummary += '\n';
        }

        // Add alerts if available
        if (intelligence.alerts && intelligence.alerts.length > 0) {
            textSummary += `ALERTS:\n`;
            intelligence.alerts.forEach(alert => {
                const icon = alert.type === 'danger' ? '🔴' : alert.type === 'warning' ? '🟡' : '🟢';
                textSummary += `${icon} ${alert.message}\n`;
            });
            textSummary += '\n';
        }

        // Add metrics section
        textSummary += `METRICS:\n`;
        for (const [metricName, metricData] of Object.entries(metrics)) {
            const statusIcon = metricData.status === 'danger' ? '⚠️ ' :
                              metricData.status === 'warning' ? '⚡ ' : '';
            const trendIcon = metricData.trend === 'up' ? '↑' :
                             metricData.trend === 'down' ? '↓' : '';
            textSummary += `• ${metricName}: ${metricData.formatted}`;
            if (trendIcon) textSummary += ` ${trendIcon}`;
            if (metricData.change) textSummary += ` (${metricData.change})`;
            if (statusIcon) textSummary += ` ${statusIcon}`;
            textSummary += `\n  └─ ${metricData.desc || ''}\n`;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // ADD COLLECTION DATA - INLINE SMALL, SUMMARIZE LARGE
        // ═══════════════════════════════════════════════════════════════════════
        if (Object.keys(collections).length > 0) {
            textSummary += `\n`;

            for (const [collectionName, collectionInfo] of Object.entries(collections)) {
                const inlinedData = inlinedCollections[collectionName];

                if (inlinedData && inlinedData.items && inlinedData.items.length > 0) {
                    // INLINE: Show full collection data
                    textSummary += `═══ ${collectionName.toUpperCase()} (${inlinedData.items.length} items - FULL DATA) ═══\n`;

                    // Build table header from item keys
                    const sampleItem = inlinedData.items[0];
                    const itemKeys = Object.keys(sampleItem).slice(0, 6); // Max 6 columns
                    textSummary += `| ${itemKeys.join(' | ')} |\n`;
                    textSummary += `|${itemKeys.map(() => '---').join('|')}|\n`;

                    // Add each row
                    inlinedData.items.forEach(item => {
                        const values = itemKeys.map(key => {
                            const val = item[key];
                            if (val === null || val === undefined) return '-';
                            if (typeof val === 'number') {
                                // Format currency-like values
                                if (Math.abs(val) >= 1000) {
                                    return val < 0 ? '-$' + Math.abs(val/1000).toFixed(0) + 'K' : '$' + (val/1000).toFixed(0) + 'K';
                                }
                                return typeof val === 'number' && !Number.isInteger(val) ? val.toFixed(2) : String(val);
                            }
                            return String(val).substring(0, 20);
                        });
                        textSummary += `| ${values.join(' | ')} |\n`;
                    });

                    // Add aggregates if available
                    if (inlinedData.aggregates) {
                        textSummary += `\nAggregates: Total=${inlinedData.aggregates.formatted?.sum || 'N/A'}, Avg=${inlinedData.aggregates.formatted?.avg || 'N/A'}\n`;
                    }
                    textSummary += `\n`;
                } else {
                    // SUMMARIZE: Show preview for large collections
                    // Note: REFLECT phase will see collection details and decide if loading is needed
                    textSummary += `═══ ${collectionName.toUpperCase()} (${collectionInfo.count} items available) ═══\n`;
                    if (collectionInfo.preview && collectionInfo.preview.length > 0) {
                        textSummary += `Preview: ${collectionInfo.preview.join(', ')}${collectionInfo.count > 3 ? '...' : ''}\n`;
                    }
                    textSummary += `Columns: ${(collectionInfo.columns || []).join(', ')}\n\n`;
                }
            }
        }

        return {
            rows: rows,
            columns: columns,
            rowCount: rows.length,
            textSummary: textSummary,
            dashboardId: dashboardId,
            dashboardName: dashboard.name,
            intelligence: intelligence,
            inlinedCollections: inlinedCollections,
            // Store refId for collection access
            refId: intelligence.refId
        };
    }

    /**
     * Store dashboard intelligence as a data reference for RESPOND phase
     *
     * @param {string} requestId - Current request ID
     * @param {string} toolName - Dashboard tool name (e.g., 'dashboard_cashflow')
     * @param {Object} result - Dashboard tool result
     * @returns {Object|null} Data reference object or null if failed
     */
    function storeDashboardDataReference(requestId, toolName, result) {
        const dashboardData = buildDashboardIntelligenceData(result);

        if (!dashboardData) {
            log.debug('Dashboard Intelligence Bridge', 'Failed to build data for: ' + toolName);
            return null;
        }

        // Create a data reference that looks like standard tool output
        // This allows RESPOND phase to consume it without special handling
        const dataRef = Cache.storeData(requestId, toolName, {
            success: true,
            rows: dashboardData.rows,
            columns: dashboardData.columns,
            rowCount: dashboardData.rowCount,
            // Store text summary for enhanced prompts
            textSummary: dashboardData.textSummary,
            // Mark as dashboard data for special handling in buildDataSectionsForPrompt
            isDashboard: true,
            dashboardId: dashboardData.dashboardId,
            dashboardName: dashboardData.dashboardName,
            // Preserve original intelligence for deep access
            intelligence: dashboardData.intelligence
        });

        log.debug('Dashboard Intelligence Bridge', {
            action: 'stored_data_reference',
            toolName: toolName,
            dashboardId: dashboardData.dashboardId,
            metricsCount: Object.keys(dashboardData.intelligence?.metrics || {}).length,
            collectionsCount: Object.keys(dashboardData.intelligence?.collections || {}).length,
            refId: dataRef?.refId
        });

        // Return both dataRef and dashboardData for caller to access textSummary, rowCount, etc.
        return {
            dataRef: dataRef,
            dashboardData: dashboardData
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    function initStreamingState(message, sessionContext, requestId, history) {
        // Build recent history context (last 3 exchanges for context)
        const recentHistory = (history || []).slice(-6).map(h => ({
            role: h.role,
            content: h.role === 'assistant' ? (h.text || h.content || '').substring(0, 200) : (h.text || h.content || '')
        }));

        return {
            requestId: requestId,
            message: message,
            history: recentHistory,  // Store recent history for context
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
            reflectIterations: 0,    // Track reflect phase runs (ReAct pattern)
            startTime: Date.now(),
            phaseTimings: {},        // Track duration per phase
            errors: [],
            // Step tracking - IDs for updating vs adding
            stepIds: {
                intent: null,
                select: null,
                reflect: null,
                synthesize: null,    // SYNTHESIZE phase step tracking
                analyze: null,
                format: null
            },
            // RECOMMENDATION 6: Error recovery tracking
            recoveryAttempts: {},     // Track which tools have been tried for recovery
            alternativeToolsQueue: [], // Queue of alternative tools to try

            // ═══════════════════════════════════════════════════════════════════════
            // Failed Tool Tracking - Prevent infinite retry loops
            // ═══════════════════════════════════════════════════════════════════════
            failedToolCalls: [],      // Array of { tool, args, error, count } for failed calls
            toolRetryCount: {},       // Map of "tool:argsHash" -> retry count

            // ═══════════════════════════════════════════════════════════════════════
            // FIX 3/4/6/8: Enhanced Tracking for Agentic Improvements
            // ═══════════════════════════════════════════════════════════════════════
            toolAttemptCount: {},      // FIX 8: Map of toolName -> attempt count
            consecutiveNoProgress: 0,  // FIX 6: Counter for consecutive 0-row results
            errorSemantics: [],        // FIX 2: Parsed error insights for LLM context
            blockedTools: {},          // FIX 3: Tools that are hard-blocked from retry (Object for JSON serialization)
            diversificationTriggered: false, // FIX 4: Whether diversification was required
            circuitBreakerTriggered: false,  // FIX 6: Whether circuit breaker fired
            diagnostics: {             // FIX 7: Diagnostic information for failure response
                toolsAttempted: [],    // List of {tool, args, error, success, rowCount}
                errorsEncountered: [], // List of error messages with context
                suggestedActions: [],  // List of suggested next steps
                timeSpent: 0           // Total time spent in iterations
            },

            // ═══════════════════════════════════════════════════════════════════════
            // ReAct Pattern State - Reflection and Reasoning
            // ═══════════════════════════════════════════════════════════════════════
            reflection: {
                hasReflected: false,           // Whether we've done initial reflection
                failureMode: null,             // Classified failure type
                entityFound: null,             // Track entity resolution separately from data
                dataFound: null,               // Track data retrieval separately
                broadeningAttempts: 0,         // How many times we've tried broadening
                clarificationNeeded: false,    // Whether we need user input
                gaveUp: false,                 // Whether we exhausted options
                journey: []                    // Track what we tried for transparency
            },

            // ═══════════════════════════════════════════════════════════════════════
            // SYNTHESIZE State - LLM SQL Generation
            // ═══════════════════════════════════════════════════════════════════════
            synthesize: {
                iterations: 0,                 // Number of SQL generation attempts
                queries: [],                   // History of queries tried [{sql, error, success}]
                lastError: null,               // Last SQL error for correction
                enabled: true                  // Whether to attempt synthesis before giving up
            },

            // ═══════════════════════════════════════════════════════════════════════
            // Progressive Narration - User-friendly status messages during processing
            // ═══════════════════════════════════════════════════════════════════════
            narration: {
                text: null,                    // Current narration text to display
                phase: null,                   // Phase that generated this narration
                timestamp: null                // When narration was set
            },

            // Follow-up context - preserve data from previous exchanges
            previousDataRefs: sessionContext?.lastDataRefs || null
        };
    }

    /**
     * Build context string from recent history for prompts
     * Includes both conversation history AND previous tool invocation results
     * This allows the LLM to use data from earlier tools when invoking subsequent tools
     */
    function buildHistoryContext(state) {
        const sections = [];

        // 1. Conversation history
        if (state.history && state.history.length > 0) {
            const lines = state.history.map(h => {
                const role = h.role === 'user' ? 'User' : 'Assistant';
                return `${role}: ${h.content}`;
            });
            sections.push(`RECENT CONVERSATION:\n${lines.join('\n')}`);
        }

        // 2. Previous tool invocations in this request (critical for multi-tool queries)
        // This gives the LLM access to data from earlier tools (e.g., vendor IDs from get_top_vendors)
        if (state.toolInvocations && state.toolInvocations.length > 0) {
            const toolResults = state.toolInvocations
                .filter(inv => inv.success && !inv.skipped)
                .map(inv => {
                    let resultSummary = `Tool: ${inv.tool}`;
                    if (inv.args) {
                        resultSummary += `\nArgs: ${JSON.stringify(inv.args)}`;
                    }
                    resultSummary += `\nStatus: ${inv.rowCount > 0 ? 'SUCCESS' : 'NO DATA'} (${inv.rowCount || 0} rows)`;

                    // Include actual data preview if available (critical for using IDs from previous tools)
                    if (inv.result && inv.result.rows && inv.result.rows.length > 0) {
                        const preview = inv.result.rows.slice(0, 10); // Show up to 10 rows
                        resultSummary += `\nData preview:\n${JSON.stringify(preview, null, 2)}`;
                    }

                    return resultSummary;
                });

            if (toolResults.length > 0) {
                sections.push(`PREVIOUS TOOL RESULTS (use these values when relevant):\n${toolResults.join('\n\n')}`);
            }
        }

        return sections.length > 0 ? `\n${sections.join('\n\n')}\n` : '';
    }

    /**
     * Build constraints section for MDA_RESPOND_PROMPT
     * Extracts user's output constraints from INTENT phase and formats for response generation
     * @param {Object} state - Current agent state
     * @returns {string} Formatted constraints section or empty string
     */
    function buildConstraintsSection(state) {
        const constraints = state.intent?.constraints;

        // If no constraints extracted, return empty
        if (!constraints) {
            return '';
        }

        const lines = ['OUTPUT CONSTRAINTS (MUST FOLLOW):'];
        let hasConstraints = false;

        if (constraints.limit && typeof constraints.limit === 'number') {
            lines.push(`- Show EXACTLY ${constraints.limit} items in tables and charts (not more, not less unless fewer exist)`);
            hasConstraints = true;
        }

        if (constraints.sort_by) {
            const direction = constraints.sort_direction === 'asc' ? 'ascending' : 'descending';
            lines.push(`- Sort by ${constraints.sort_by} (${direction})`);
            hasConstraints = true;
        }

        if (constraints.highlight) {
            lines.push(`- HIGHLIGHT in your response: "${constraints.highlight}"`);
            hasConstraints = true;
        }

        if (constraints.exclude && Array.isArray(constraints.exclude) && constraints.exclude.length > 0) {
            lines.push(`- EXCLUDE from results: ${constraints.exclude.join(', ')}`);
            hasConstraints = true;
        }

        if (!hasConstraints) {
            return '';
        }

        lines.push('');
        lines.push('⚠️ These constraints come directly from the user\'s question. Violating them will make the response incorrect.');

        return lines.join('\n');
    }

    /**
     * Get current date context for prompts
     */
    function getDateContext() {
        const now = new Date();
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
        return `Today is ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}.`;
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
            Cache.updateStep(state.requestId, stepData);
        } else {
            // Add new step
            Cache.addStep(state.requestId, stepData);
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
            Cache.updateLastStep(state.requestId, stepData);
        } else {
            Cache.addStep(state.requestId, stepData);
        }
    }

    /**
     * Update an existing tool call step
     */
    function updateToolCallStep(state, toolName, data) {
        addToolCallStep(state, {
            ...data,
            tool: toolName,
            update: true
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE EXECUTORS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Phase 1: INTENT - Classify the question
     */
    function executeIntentPhase(state) {
        const phaseStart = Date.now();
        const prompt = INTENT_PROMPT
            .replace('{question}', state.message)
            .replace('{date_context}', getDateContext())
            .replace('{history_context}', buildHistoryContext(state));

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
                tier: getTierForPhase('intent', state),
                temperature: 0.1,
                jsonMode: true,
                purpose: 'SCA:intent'
            });

            const parsed = parseJsonResponse(response?.text);
            const duration = Date.now() - phaseStart;
            state.phaseTimings.intent = duration;

            if (parsed && parsed.intent) {
                state.intent = parsed;

                // Handle general intent - check if tools would enhance the response
                // Instead of always skipping to RESPOND, ask LLM if tools would help
                // e.g., "How do I check my cash?" could benefit from Cash dashboard navigation
                if (parsed.intent === 'general') {
                    // Ask LLM if tools would enhance the response
                    const toolCheckPrompt = `User asked: "${state.message}"

Would any of these tools help answer this better?
- navigate_to_dashboard: Guide to specific dashboard (cash, AR, AP, revenue, expenses, etc.)
- list_dashboards: Show available analysis options
- get_help_topic: Explain Gantry features

Reply JSON only: {"use_tools": true/false, "suggested_tool": "tool_name or null", "reason": "brief explanation"}`;

                    let shouldUseTool = false;
                    let toolSuggestion = null;

                    try {
                        const toolCheckResponse = AIProviders.callAI(toolCheckPrompt, {
                            tier: TIERS.FAST,
                            temperature: 0.1,
                            jsonMode: true,
                            purpose: 'SCA:general_tool_check'
                        });

                        const toolCheck = parseJsonResponse(toolCheckResponse?.text);

                        if (toolCheck && toolCheck.use_tools && toolCheck.suggested_tool) {
                            shouldUseTool = true;
                            toolSuggestion = {
                                suggested_tool: toolCheck.suggested_tool,
                                reason: toolCheck.reason
                            };
                            log.debug('SCA Intent - general intent may benefit from tools', {
                                suggestedTool: toolCheck.suggested_tool,
                                reason: toolCheck.reason
                            });
                        }
                    } catch (toolCheckError) {
                        log.debug('SCA Intent - tool check failed, defaulting to no tools', {
                            error: toolCheckError.message
                        });
                    }

                    if (shouldUseTool && toolSuggestion) {
                        // Tools would help - route through REASON_ACT with hint
                        state.toolSelectionHint = toolSuggestion;
                        state.phase = PHASES.REASON_ACT;
                        state.accumulatedData = [];
                        state.reasonActIterations = 0;

                        state.narration = {
                            text: parsed.userNarration || 'Let me help you with that...',
                            phase: 'intent',
                            timestamp: Date.now()
                        };

                        upsertThinkingStep(state, 'intent', {
                            title: 'Understanding your question',
                            phase: 'intent',
                            status: 'complete',
                            duration: duration,
                            context: {
                                question: state.message.substring(0, 100),
                                intent: parsed.intent,
                                toolsWouldHelp: true,
                                suggestedTool: toolSuggestion.suggested_tool
                            },
                            debug: buildDebugInfo(prompt, response, state, { parsedIntent: parsed })
                        });

                        log.debug('SCA Intent - general intent routing to REASON_ACT for tool use');
                        return { success: true, nextPhase: PHASES.REASON_ACT };
                    }

                    // No tools needed - pure conversational response
                    state.phase = PHASES.RESPOND;
                    log.debug('SCA Intent - general/conversational, skipping to RESPOND');

                    upsertThinkingStep(state, 'intent', {
                        title: 'Understanding your question',
                        phase: 'intent',
                        status: 'complete',
                        duration: duration,
                        context: {
                            question: state.message.substring(0, 100),
                            intent: parsed.intent,
                            conversational: true
                        },
                        debug: buildDebugInfo(prompt, response, state, { parsedIntent: parsed })
                    });

                    return { success: true, nextPhase: PHASES.RESPOND };
                }

                // NEW: Route to REASON_ACT for agentic data gathering
                state.phase = PHASES.REASON_ACT;

                // Initialize accumulated data tracking for ReAct loop
                state.accumulatedData = [];
                state.reasonActIterations = 0;

                // Store progressive narration for frontend display
                state.narration = {
                    text: parsed.userNarration || 'Analyzing your question...',
                    phase: 'intent',
                    timestamp: Date.now()
                };

                // Update step with results
                upsertThinkingStep(state, 'intent', {
                    title: 'Understanding your question',
                    phase: 'intent',
                    status: 'complete',
                    duration: duration,
                    context: {
                        phase: 'intent',
                        question: state.message.substring(0, 100),
                        intent: parsed.intent,
                        entities: parsed.entities || [],
                        timeScope: parsed.time_scope,
                        needsResolution: parsed.needs_resolution,
                        // Include transaction context for entity_transactions intent
                        transactionContext: parsed.transaction_context
                    },
                    debug: buildDebugInfo(prompt, response, state, { parsedIntent: parsed })
                });

                log.debug('SCA Intent phase complete', { intent: parsed.intent, duration: duration });
                return { success: true, nextPhase: PHASES.REASON_ACT };
            } else {
                throw new Error('Failed to parse intent: ' + (response?.text?.substring(0, 100) || 'empty response'));
            }
        } catch (e) {
            const duration = Date.now() - phaseStart;
            log.error('SCA Intent phase failed', { error: e.message, duration: duration });
            state.errors.push({ phase: 'intent', error: e.message, timestamp: Date.now() });

            // Default to general reporting intent - route to REASON_ACT
            state.intent = { intent: 'reporting', entities: [], time_scope: 'none' };
            state.phase = PHASES.REASON_ACT;
            state.accumulatedData = [];
            state.reasonActIterations = 0;

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

            return { success: true, nextPhase: PHASES.REASON_ACT };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REASON_ACT PHASE - True ReAct Pattern (Replaces SELECT/INVOKE/REFLECT)
    // This is the core agentic loop: THINK → ACT → OBSERVE → REFLECT → LOOP
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Build accumulated data summary for the LLM
     * Shows all data collected so far across iterations
     * Includes data sanity warnings for comparison anomalies
     */
    function buildAccumulatedDataSummary(state) {
        if (!state.accumulatedData || state.accumulatedData.length === 0) {
            return 'No data collected yet. This is your first iteration.';
        }

        const lines = [];
        state.accumulatedData.forEach((item, idx) => {
            lines.push(`\n[${idx + 1}] Tool: ${item.tool}`);
            lines.push(`    Args: ${JSON.stringify(item.args)}`);
            lines.push(`    Status: ${item.success ? 'SUCCESS' : 'FAILED'}`);

            if (item.success) {
                lines.push(`    Rows: ${item.rowCount || 0}`);
                // ═══════════════════════════════════════════════════════════════════════
                // COLUMN SCHEMA: Show types so LLM can reason about data structure
                // Critical for chart generation: LLM needs to know which columns are
                // dates (x-axis labels) vs numbers (y-axis values)
                // ═══════════════════════════════════════════════════════════════════════
                if (item.schema && typeof item.schema === 'object') {
                    const colTypes = Object.entries(item.schema)
                        .map(([col, info]) => `${col}(${info.type || 'unknown'})`)
                        .join(', ');
                    lines.push(`    Columns [type]: ${colTypes}`);
                } else if (item.columns && item.columns.length > 0) {
                    lines.push(`    Columns: ${item.columns.join(', ')}`);
                }
                if (item.summary) {
                    lines.push(`    Summary: ${item.summary}`);
                }

                // ═══════════════════════════════════════════════════════════════
                // DASHBOARD DATA: Show metrics, collections, and full textSummary
                // ═══════════════════════════════════════════════════════════════
                if (item.metrics) {
                    lines.push(`    Key Metrics:`);
                    Object.entries(item.metrics).slice(0, 8).forEach(([name, data]) => {
                        const statusIcon = data.status === 'danger' ? ' ⚠️' : data.status === 'warning' ? ' ⚡' : '';
                        const trendIcon = data.trend === 'up' ? ' ↑' : data.trend === 'down' ? ' ↓' : '';
                        lines.push(`      • ${name}: ${data.formatted || data.value}${trendIcon}${statusIcon}`);
                    });
                }

                if (item.collections && item.collections.length > 0) {
                    lines.push(`    Available Collections (queryable):`);
                    item.collections.forEach(col => {
                        const preview = col.preview ? ` - Preview: ${col.preview.slice(0, 2).join(', ')}...` : '';
                        lines.push(`      • ${col.name}: ${col.count} items${preview}`);
                        // Show the refId and query hint so LLM knows exactly how to query
                        if (col.refId) {
                            lines.push(`        → Query with: load_collection(refId="${col.refId}", collection="${col.name}")`);
                        }
                    });
                }

                // For dashboards, show the full textSummary if available (truncated)
                if (item.textSummary) {
                    lines.push(`    ───── Full Dashboard Data ─────`);
                    // Show truncated textSummary (first 1500 chars to keep context manageable)
                    const truncatedSummary = item.textSummary.length > 1500
                        ? item.textSummary.substring(0, 1500) + '\n    ... [truncated - use collection queries for more]'
                        : item.textSummary;
                    truncatedSummary.split('\n').forEach(line => {
                        lines.push(`    ${line}`);
                    });
                }

                // Available dashboards (from list_dashboards)
                if (item.availableDashboards && item.availableDashboards.length > 0) {
                    lines.push(`    Available Dashboards:`);
                    item.availableDashboards.forEach(d => {
                        lines.push(`      • ${d.id}: ${d.name}`);
                        if (d.description) {
                            lines.push(`        ${d.description.substring(0, 80)}${d.description.length > 80 ? '...' : ''}`);
                        }
                        if (d.use_cases && d.use_cases.length > 0) {
                            lines.push(`        Use for: ${d.use_cases.join(', ')}`);
                        }
                    });
                }

                // Standard row data preview
                if (item.preview && item.preview.length > 0 && !item.metrics) {
                    lines.push(`    Sample data:`);
                    item.preview.slice(0, 3).forEach(row => {
                        const rowStr = Object.entries(row)
                            .map(([k, v]) => `${k}: ${typeof v === 'number' ? Utils.formatCurrency(v) : v}`)
                            .join(', ');
                        lines.push(`      - ${rowStr}`);
                    });
                }

                // ═══════════════════════════════════════════════════════════════
                // RESOLVED ENTITY: Show the actual entity data for use in queries
                // ═══════════════════════════════════════════════════════════════
                if (item.resolvedEntity) {
                    lines.push(`    ✓ RESOLVED: "${item.args?.name || 'entity'}" → ${item.resolvedEntity.name}`);
                    lines.push(`      ID: ${item.resolvedEntity.id} | Type: ${item.resolvedEntity.type}`);
                    lines.push(`      → USE entity_id: ${item.resolvedEntity.id} in subsequent tool calls`);
                }
            } else {
                lines.push(`    Error: ${item.error || 'Unknown error'}`);

                // ═══════════════════════════════════════════════════════════════
                // VALIDATION ERRORS: Show what was wrong with the parameters
                // ═══════════════════════════════════════════════════════════════
                if (item.validationErrors && item.validationErrors.length > 0) {
                    lines.push(`    Validation Errors:`);
                    item.validationErrors.forEach(err => {
                        lines.push(`      ⚠️ ${err}`);
                    });
                }
            }

            // ═══════════════════════════════════════════════════════════════════
            // SUGGESTIONS PIPELINE: Show tool suggestions for recovery
            // These help the LLM decide what to try next when queries fail
            // ═══════════════════════════════════════════════════════════════════
            if (item.rowCount === 0 || !item.success) {
                // Get broadening suggestions
                const broaderParams = Tools.suggestBroaderParams(item.args, item.tool);
                if (broaderParams.canBroaden) {
                    lines.push(`    💡 BROADENING OPTIONS (you decide which to use):`);
                    broaderParams.suggestions.forEach(s => lines.push(`      • ${s}`));
                }

                // Get semantically-selected alternative tools (LLM-based)
                const alternatives = getAlternativeToolsForDiversification(
                    item.tool,
                    item.args,
                    state.resolvedEntities,
                    state
                );
                if (alternatives.length > 0) {
                    lines.push(`    🔄 ALTERNATIVE TOOLS TO CONSIDER:`);
                    alternatives.forEach(alt => {
                        lines.push(`      • ${alt.tool}: ${alt.reason}`);
                        if (alt.args && Object.keys(alt.args).length > 0) {
                            lines.push(`        Suggested args: ${JSON.stringify(alt.args)}`);
                        }
                    });
                }

                // Include tool-specific suggestions if any
                if (item.suggestions && item.suggestions.length > 0) {
                    lines.push(`    📋 Tool Suggestions:`);
                    item.suggestions.forEach(s => lines.push(`      • ${s}`));
                }
            }

            // Show normalization warnings (informational)
            if (item.normalizationWarnings && item.normalizationWarnings.length > 0) {
                lines.push(`    ℹ️ Parameter Normalization:`);
                item.normalizationWarnings.forEach(w => lines.push(`      • ${w}`));
            }
        });

        // Add data sanity warnings if comparison data looks anomalous
        const warnings = detectDataAnomalies(state.accumulatedData);
        if (warnings.length > 0) {
            lines.push('\n⚠️ DATA SANITY WARNINGS:');
            warnings.forEach(w => lines.push(`  - ${w}`));
            lines.push('  Consider verifying the data or adjusting your query if these seem unexpected.');
        }

        // ═══════════════════════════════════════════════════════════════════════
        // RESOLVED ENTITIES SUMMARY: Show all resolved entities with their IDs
        // This is CRITICAL - LLM must use these actual IDs, not placeholders!
        // ═══════════════════════════════════════════════════════════════════════
        if (state.resolvedEntities && Object.keys(state.resolvedEntities).length > 0) {
            lines.push('\n✅ RESOLVED ENTITIES (use these IDs in your queries):');
            Object.entries(state.resolvedEntities).forEach(([searchName, entity]) => {
                lines.push(`  • "${searchName}" → ${entity.name} (${entity.type})`);
                lines.push(`    entity_id: ${entity.id}`);
            });
            lines.push('  ⚠️ IMPORTANT: Use the actual entity_id number above, NOT placeholders like {{resolve_entity result}}');
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FAILED TOOL CALLS: Show what has already failed to prevent retries
        // ═══════════════════════════════════════════════════════════════════════
        if (state.failedToolCalls && state.failedToolCalls.length > 0) {
            lines.push('\n🚫 FAILED TOOL CALLS (DO NOT RETRY WITH SAME ARGUMENTS):');
            state.failedToolCalls.forEach(f => {
                lines.push(`  - ${f.tool}(${JSON.stringify(f.args)})`);
                lines.push(`    Error: ${f.error}`);
                lines.push(`    Failed ${f.count} time(s) - try different arguments or a different approach`);
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 2: ERROR SEMANTIC INSIGHTS - Show parsed error analysis
        // Helps LLM understand WHY tools failed and HOW to fix
        // ═══════════════════════════════════════════════════════════════════════
        if (state.errorSemantics && state.errorSemantics.length > 0) {
            // Show only the most recent unique error insights
            const recentInsights = state.errorSemantics.slice(-3);
            const uniqueCategories = [...new Set(recentInsights.map(e => e.insights.category))];

            lines.push('\n🔍 ERROR ANALYSIS (learn from these to avoid repeating mistakes):');
            uniqueCategories.forEach(category => {
                const insight = recentInsights.find(e => e.insights.category === category);
                if (insight) {
                    lines.push(`  Category: ${category}`);
                    lines.push(`    Insight: ${insight.insights.insight}`);
                    lines.push(`    Fix: ${insight.insights.suggestedAction}`);
                    if (insight.insights.parameterHints && Object.keys(insight.insights.parameterHints).length > 0) {
                        lines.push(`    Hints: ${JSON.stringify(insight.insights.parameterHints)}`);
                    }
                }
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 3/8: BLOCKED TOOLS - Show which tools are completely blocked
        // ═══════════════════════════════════════════════════════════════════════
        if (state.blockedTools && Object.keys(state.blockedTools).length > 0) {
            lines.push('\n⛔ BLOCKED TOOLS (exhausted iteration budget):');
            lines.push(`  The following tools are BLOCKED: ${Object.keys(state.blockedTools).join(', ')}`);
            lines.push(`  You MUST use different tools to continue.`);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 4: DIVERSIFICATION REQUIREMENT - Force trying different tools
        // ═══════════════════════════════════════════════════════════════════════
        if (state.forcedDiversification) {
            lines.push('\n⚠️ DIVERSIFICATION REQUIRED:');
            lines.push(`  Reason: ${state.forcedDiversification.reason}`);
            if (state.forcedDiversification.suggestedAlternatives && state.forcedDiversification.suggestedAlternatives.length > 0) {
                lines.push(`  SUGGESTED ALTERNATIVE TOOLS:`);
                state.forcedDiversification.suggestedAlternatives.forEach(alt => {
                    lines.push(`    • ${alt.tool}: ${alt.reason}`);
                    lines.push(`      Suggested args: ${JSON.stringify(alt.args)}`);
                });
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 8: TOOL ATTEMPT BUDGET - Show remaining budget per tool
        // ═══════════════════════════════════════════════════════════════════════
        if (state.toolAttemptCount && Object.keys(state.toolAttemptCount).length > 0) {
            const toolsNearLimit = Object.entries(state.toolAttemptCount)
                .filter(([tool, count]) => count >= MAX_ATTEMPTS_PER_TOOL - 1)
                .map(([tool, count]) => `${tool}(${count}/${MAX_ATTEMPTS_PER_TOOL})`);

            if (toolsNearLimit.length > 0) {
                lines.push('\n📊 TOOL BUDGET WARNING:');
                lines.push(`  Tools near/at limit: ${toolsNearLimit.join(', ')}`);
                lines.push(`  Consider switching to alternative tools proactively.`);
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // SCHEMA DISCOVERY NEEDED: Route LLM to discover valid fields
        // Triggered when SYNTHESIZE hits "field not found" errors
        // ═══════════════════════════════════════════════════════════════════════
        if (state.synthesize?.schemaDiscoveryNeeded) {
            const hint = state.synthesize.schemaDiscoveryNeeded;
            lines.push('\n🔎 SCHEMA DISCOVERY REQUIRED:');
            lines.push(`  ⚠️ A query failed because field "${hint.error.match(/field\s+['"]?(\w+)['"]?/i)?.[1] || 'unknown'}" does not exist.`);
            lines.push(`  Table: ${hint.tableName}`);
            lines.push(`  `);
            lines.push(`  ACTION REQUIRED: Use get_record_schema to discover valid field names:`);
            lines.push(`    get_record_schema({ record_type: "${hint.tableName}" })`);
            lines.push(`  `);
            lines.push(`  After discovering the schema, rewrite your query with the correct field names.`);
            lines.push(`  This is better than guessing - the schema will show exactly what fields exist.`);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // SYNTHESIZE TRIGGER: Add hint if conditions are met for custom SQL
        // ═══════════════════════════════════════════════════════════════════════
        const synthesizeHint = detectSynthesizeTrigger(state);
        if (synthesizeHint) {
            lines.push(synthesizeHint);
        }

        return lines.join('\n');
    }

    /**
     * Detect anomalies in accumulated data for comparison queries
     * Flags major discrepancies that might indicate query issues
     * @param {Array} accumulatedData - Data collected from tool executions
     * @returns {Array} Array of warning messages
     */
    function detectDataAnomalies(accumulatedData) {
        const warnings = [];

        if (!accumulatedData || accumulatedData.length < 2) {
            return warnings;
        }

        // Group by tool name to compare similar queries
        const byTool = {};
        accumulatedData.forEach(item => {
            if (item.success) {
                if (!byTool[item.tool]) byTool[item.tool] = [];
                byTool[item.tool].push(item);
            }
        });

        // Check for row count anomalies in same-tool comparisons
        Object.entries(byTool).forEach(([toolName, items]) => {
            if (items.length >= 2) {
                const rowCounts = items.map(i => i.rowCount || 0).filter(r => r > 0);
                if (rowCounts.length >= 2) {
                    const max = Math.max(...rowCounts);
                    const min = Math.min(...rowCounts);
                    const ratio = max / Math.max(min, 1);

                    // Flag if one result has 5x+ more rows than another
                    if (ratio >= 5) {
                        warnings.push(`${toolName}: Large row count variance (${min} vs ${max} rows, ${ratio.toFixed(1)}x difference). Verify period filters are correct.`);
                    }
                }

                // Check for total amount anomalies if we have stats
                const totals = items
                    .filter(i => i.stats && i.stats.total !== undefined)
                    .map(i => ({ args: i.args, total: i.stats.total }));

                if (totals.length >= 2) {
                    const amounts = totals.map(t => Math.abs(t.total));
                    const maxAmt = Math.max(...amounts);
                    const minAmt = Math.min(...amounts);
                    const amtRatio = maxAmt / Math.max(minAmt, 1);

                    if (amtRatio >= 5 && minAmt > 0) {
                        warnings.push(`${toolName}: Large total variance (${Utils.formatCurrency(minAmt)} vs ${Utils.formatCurrency(maxAmt)}, ${amtRatio.toFixed(1)}x difference). This may indicate different time periods.`);
                    }
                }
            }
        });

        return warnings;
    }

    /**
     * Detect if SYNTHESIZE (custom SQL) might be warranted
     * Returns a hint string for the LLM if conditions are met, null otherwise
     *
     * Conditions for suggesting SYNTHESIZE:
     * 1. An entity has been successfully resolved (we know who/what we're looking for)
     * 2. Multiple tool calls have returned 0 rows (data tools are exhausted)
     * 3. No SYNTHESIZE has been attempted yet
     *
     * @param {Object} state - Current agent state
     * @returns {string|null} Hint message for LLM, or null if not triggered
     */
    function detectSynthesizeTrigger(state) {
        // Check if we have resolved entities (entity exists in the system)
        const hasResolvedEntities = state.resolvedEntities &&
            Object.keys(state.resolvedEntities).length > 0;

        if (!hasResolvedEntities) {
            return null; // No point suggesting SYNTHESIZE if we don't know what entity we're looking for
        }

        // Count how many data tool calls returned 0 rows
        const emptyDataToolCalls = (state.accumulatedData || []).filter(item => {
            // Only count data tools (not resolve_* which are discovery tools)
            const isDataTool = !item.tool.startsWith('resolve_') &&
                              item.tool !== 'list_dashboards' &&
                              item.tool !== 'get_fiscal_context';
            return isDataTool && item.success && item.rowCount === 0;
        });

        // Check if we've already tried SYNTHESIZE
        const alreadyTriedSynthesize = (state.accumulatedData || []).some(
            item => item.tool === 'run_custom_query'
        );

        if (alreadyTriedSynthesize) {
            return null; // Already tried custom SQL
        }

        // Trigger if 3+ data tool calls returned 0 rows with a resolved entity
        if (emptyDataToolCalls.length >= 3) {
            const entityNames = Object.keys(state.resolvedEntities);
            const entitySummary = entityNames.map(name => {
                const e = state.resolvedEntities[name];
                return `${e.name} (${e.type}, ID: ${e.id})`;
            }).join(', ');

            const toolsTried = [...new Set(emptyDataToolCalls.map(t => t.tool))].join(', ');

            return `\n⚡ SYNTHESIZE TRIGGER DETECTED:
  • Entity confirmed: ${entitySummary}
  • Pre-built tools exhausted: ${emptyDataToolCalls.length} queries returned 0 rows
  • Tools tried: ${toolsTried}
  • Consider using SYNTHESIZE to write custom SuiteQL that directly queries the transaction table
  • Example: Search for all bills for this vendor with: SELECT * FROM transaction WHERE entity = ${state.resolvedEntities[entityNames[0]]?.id} AND type = 'VendBill'
  • YOU DECIDE: If you believe the data genuinely doesn't exist, you can still ANSWER with "no data found"`;
        }

        return null;
    }

    /**
     * Generate a hash key for tool+args combination to track retries
     */
    function getToolArgsKey(toolName, args) {
        return toolName + ':' + JSON.stringify(args || {});
    }

    /**
     * Check if this tool+args combination has already failed too many times
     * FIX 3: HARD RETRY BLOCKING - Returns true to completely prevent the call
     */
    function shouldBlockRetry(state, toolName, args) {
        const key = getToolArgsKey(toolName, args);
        const retryCount = state.toolRetryCount[key] || 0;

        // Hard block after 2 failures with EXACT same args
        if (retryCount >= 2) {
            return { blocked: true, reason: 'exact_args_failed', count: retryCount };
        }

        // FIX 3: Also check if this tool is completely blocked due to repeated failures
        if (state.blockedTools && state.blockedTools[toolName]) {
            return { blocked: true, reason: 'tool_exhausted', count: state.toolAttemptCount[toolName] || 0 };
        }

        // FIX 8: Check iteration budget per tool
        const toolAttempts = state.toolAttemptCount[toolName] || 0;
        if (toolAttempts >= MAX_ATTEMPTS_PER_TOOL) {
            // Check if any of those attempts succeeded
            const hadSuccess = (state.accumulatedData || []).some(
                d => d.tool === toolName && d.success && d.rowCount > 0
            );
            if (!hadSuccess) {
                // Add to blocked tools object (not Set - must be JSON-serializable)
                if (!state.blockedTools) state.blockedTools = {};
                state.blockedTools[toolName] = true;
                return { blocked: true, reason: 'budget_exhausted', count: toolAttempts };
            }
        }

        return { blocked: false };
    }

    /**
     * Track a failed tool call
     * ENHANCED with error semantic parsing (Fix 2) and diagnostics tracking (Fix 7)
     */
    function trackFailedToolCall(state, toolName, args, error) {
        const key = getToolArgsKey(toolName, args);
        state.toolRetryCount[key] = (state.toolRetryCount[key] || 0) + 1;

        // Also add to failedToolCalls array for prompt visibility
        const existing = state.failedToolCalls.find(f => f.key === key);
        if (existing) {
            existing.count++;
            existing.lastError = error;
        } else {
            state.failedToolCalls.push({
                key: key,
                tool: toolName,
                args: args,
                error: error,
                count: 1
            });
        }

        // FIX 2: Parse error semantics and store for LLM context
        const errorInsights = parseErrorSemantics(error, toolName, args);
        if (!state.errorSemantics) state.errorSemantics = [];
        state.errorSemantics.push({
            tool: toolName,
            args: args,
            error: error,
            insights: errorInsights,
            timestamp: Date.now()
        });

        // FIX 7: Add to diagnostics
        if (!state.diagnostics) state.diagnostics = { toolsAttempted: [], errorsEncountered: [], suggestedActions: [] };
        state.diagnostics.errorsEncountered.push({
            tool: toolName,
            error: error,
            category: errorInsights.category,
            suggestion: errorInsights.suggestedAction
        });

        // Add unique suggested actions
        if (!state.diagnostics.suggestedActions.includes(errorInsights.suggestedAction)) {
            state.diagnostics.suggestedActions.push(errorInsights.suggestedAction);
        }
    }

    /**
     * Track tool attempt for budget allocation (Fix 8)
     */
    function trackToolAttempt(state, toolName, success, rowCount) {
        if (!state.toolAttemptCount) state.toolAttemptCount = {};
        state.toolAttemptCount[toolName] = (state.toolAttemptCount[toolName] || 0) + 1;

        // FIX 7: Track in diagnostics
        if (!state.diagnostics) state.diagnostics = { toolsAttempted: [], errorsEncountered: [], suggestedActions: [] };
        // Note: full details added in executeToolForReasonAct

        // FIX 6: Update consecutive no-progress counter
        if (success && rowCount > 0) {
            state.consecutiveNoProgress = 0; // Reset on progress
        } else {
            state.consecutiveNoProgress = (state.consecutiveNoProgress || 0) + 1;
        }
    }

    /**
     * Execute a single tool and return the result
     * ENHANCED with Fix 3 (Hard Retry Blocking), Fix 7 (Diagnostics), Fix 8 (Budget Tracking)
     */
    function executeToolForReasonAct(state, toolName, args) {
        const tool = Tools.getTool(toolName);

        if (!tool) {
            log.error('REASON_ACT Unknown tool', { tool: toolName });
            // FIX 7: Track in diagnostics
            if (!state.diagnostics) state.diagnostics = { toolsAttempted: [], errorsEncountered: [], suggestedActions: [] };
            state.diagnostics.toolsAttempted.push({ tool: toolName, args, success: false, error: 'Unknown tool', rowCount: 0 });
            return {
                tool: toolName,
                args: args,
                success: false,
                error: 'Unknown tool: ' + toolName + '. Check tool name spelling.',
                rowCount: 0
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 3: HARD RETRY BLOCKING - Completely prevent repeated failing calls
        // Returns structured block info instead of boolean
        // ═══════════════════════════════════════════════════════════════════════
        const blockCheck = shouldBlockRetry(state, toolName, args);
        if (blockCheck.blocked) {
            const key = getToolArgsKey(toolName, args);
            const failedCall = state.failedToolCalls.find(f => f.key === key);

            // Build context-aware error message based on block reason
            let errorMessage;
            let suggestion;

            switch (blockCheck.reason) {
                case 'exact_args_failed':
                    errorMessage = `Tool '${toolName}' with these EXACT arguments has already failed ${blockCheck.count} times. ` +
                        `Previous error: ${failedCall?.lastError || 'Unknown'}.`;
                    suggestion = 'You MUST use different arguments or a different tool entirely.';
                    break;

                case 'tool_exhausted':
                    errorMessage = `Tool '${toolName}' is BLOCKED - it has been tried ${blockCheck.count} times without success.`;
                    suggestion = 'You MUST try a completely different tool. Consider: ' +
                        getAlternativeToolsForDiversification(toolName, args, state.resolvedEntities, state)
                            .map(a => a.tool).join(', ');
                    break;

                case 'budget_exhausted':
                    errorMessage = `Tool '${toolName}' has exhausted its iteration budget (${MAX_ATTEMPTS_PER_TOOL} attempts).`;
                    suggestion = 'Budget depleted. You MUST use a different tool to continue.';
                    break;

                default:
                    errorMessage = `Tool '${toolName}' is blocked from retry.`;
                    suggestion = 'Try a different approach.';
            }

            log.audit('REASON_ACT HARD BLOCK', {
                tool: toolName,
                args: args,
                reason: blockCheck.reason,
                count: blockCheck.count
            });

            // FIX 7: Track blocked attempt in diagnostics
            if (!state.diagnostics) state.diagnostics = { toolsAttempted: [], errorsEncountered: [], suggestedActions: [] };
            state.diagnostics.toolsAttempted.push({
                tool: toolName,
                args,
                success: false,
                error: errorMessage,
                blocked: true,
                blockReason: blockCheck.reason
            });

            return {
                tool: toolName,
                args: args,
                success: false,
                error: errorMessage + ' ' + suggestion,
                rowCount: 0,
                blockedRetry: true,
                blockReason: blockCheck.reason
            };
        }

        // Auto-inject resolved entities
        args = autoInjectResolvedEntities(args, state, toolName);

        // Execute tool
        const toolStart = Date.now();
        let result = Cache.getCachedToolResult(toolName, args);
        let fromCache = false;

        if (result) {
            fromCache = true;
        } else {
            result = Tools.executeTool(toolName, args);
            Cache.cacheToolResult(toolName, args, result);
        }
        const toolDuration = Date.now() - toolStart;

        // Build accumulated data entry
        const dataEntry = {
            tool: toolName,
            args: args,
            success: result.success !== false,
            rowCount: result.rowCount || result.rows?.length || 0,
            columns: result.columns || [],
            error: result.error,
            duration: toolDuration,
            fromCache: fromCache,
            // Include tool suggestions for empty results
            suggestions: result.suggestions || [],
            // Include validation errors if any
            validationErrors: result.validationErrors || [],
            // Include normalization warnings
            normalizationWarnings: result.normalizationWarnings || []
        };

        // Store data reference if we got rows
        if (result.success && result.rows && result.rows.length > 0) {
            const dataRef = Cache.storeData(state.requestId, toolName, result);
            state.dataReferences.push(dataRef);
            dataEntry.dataRef = dataRef?.refId;

            // Add preview for LLM context
            dataEntry.preview = result.rows.slice(0, 5);

            // ═══════════════════════════════════════════════════════════════════════
            // AGENTIC FIX: Include schema with column types so LLM can reason about
            // data structure - critical for chart generation (date vs numeric columns)
            // ═══════════════════════════════════════════════════════════════════════
            if (dataRef?.summary?.schema) {
                dataEntry.schema = dataRef.summary.schema;
            }

            // Build summary
            if (result.columns && result.columns.length > 0) {
                const numericCols = result.columns.filter(col => {
                    const firstVal = result.rows[0]?.[col];
                    return typeof firstVal === 'number';
                });
                if (numericCols.length > 0) {
                    const col = numericCols[0];
                    const sum = result.rows.reduce((s, r) => s + (r[col] || 0), 0);
                    dataEntry.summary = `Total ${col}: ${Utils.formatCurrency(sum)}`;
                }
            }
        } else if (isDashboardResult(result)) {
            // Dashboard intelligence - bridge to first-class data
            const stored = storeDashboardDataReference(state.requestId, toolName, result);
            if (stored && stored.dataRef) {
                state.dataReferences.push(stored.dataRef);
                dataEntry.dataRef = stored.dataRef.refId;
                dataEntry.success = true;

                // Use dashboardData for accurate rowCount and textSummary
                const dashData = stored.dashboardData;
                dataEntry.rowCount = dashData.rowCount || Object.keys(result.intelligence?.metrics || {}).length;
                dataEntry.textSummary = dashData.textSummary;
                dataEntry.summary = `Dashboard: ${dashData.dashboardName || result.dashboard} - ${dataEntry.rowCount} metrics loaded`;
                dataEntry.columns = dashData.columns || [];

                // Extract key metrics for preview display
                if (result.intelligence?.metrics) {
                    dataEntry.metrics = result.intelligence.metrics;
                }

                // Extract collections info for LLM awareness - INCLUDE refId for querying
                if (result.intelligence?.collections) {
                    // Get the base dashboard refId from the stored data
                    const dashboardRefId = stored.dataRef?.refId || result.intelligence?.refId;

                    dataEntry.collections = Object.entries(result.intelligence.collections).map(([name, info]) => ({
                        name: name,
                        count: info.count,
                        preview: info.preview,
                        // Include the refId so LLM knows how to query this collection
                        refId: dashboardRefId,
                        queryHint: `Use load_collection(refId="${dashboardRefId}", collection="${name}") to load full data`
                    }));
                }
            }
        } else if (result.success && result.dashboards && Array.isArray(result.dashboards)) {
            // ═══════════════════════════════════════════════════════════════════════
            // STRUCTURED DATA: list_dashboards returns dashboards array, not rows
            // Make this first-class data so LLM knows what dashboards are available
            // ═══════════════════════════════════════════════════════════════════════
            dataEntry.rowCount = result.dashboards.length;
            dataEntry.success = true;
            dataEntry.summary = `${result.dashboards.length} dashboards available`;

            // Build preview for LLM
            dataEntry.availableDashboards = result.dashboards.map(d => ({
                id: d.id,
                name: d.name,
                description: d.description,
                use_cases: d.use_cases?.slice(0, 3)
            }));

            // Create columns for consistency
            dataEntry.columns = ['id', 'name', 'description', 'use_cases'];
        }

        // Track entity resolution
        if (toolName.startsWith('resolve_') && result.found && result.entity) {
            const searchName = args.name || 'unknown';
            state.resolvedEntities[searchName] = result.entity;
            dataEntry.resolvedEntity = result.entity;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FAILURE & EMPTY RESULT TRACKING: Prevent infinite retries
        // Track both actual failures AND empty results (success but no data)
        // ═══════════════════════════════════════════════════════════════════════
        const isFailure = !dataEntry.success && dataEntry.error;
        const isEmptyResult = dataEntry.success && dataEntry.rowCount === 0 && !dataEntry.metrics;
        const isEntityNotFound = toolName.startsWith('resolve_') && result.found === false;

        if (isFailure) {
            trackFailedToolCall(state, toolName, args, dataEntry.error);
        } else if (isEmptyResult || isEntityNotFound) {
            // Track empty results too - repeating them won't help
            const reason = isEntityNotFound
                ? `Entity not found: "${args.name || 'unknown'}"`
                : 'Query returned 0 rows';
            trackFailedToolCall(state, toolName, args, reason);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 8: Track tool attempt for iteration budget
        // FIX 6: Update consecutive no-progress counter
        // FIX 7: Add to diagnostics for failure response
        // ═══════════════════════════════════════════════════════════════════════
        trackToolAttempt(state, toolName, dataEntry.success, dataEntry.rowCount);

        // FIX 7: Add to diagnostics (detailed entry)
        if (!state.diagnostics) state.diagnostics = { toolsAttempted: [], errorsEncountered: [], suggestedActions: [], timeSpent: 0 };
        state.diagnostics.toolsAttempted.push({
            tool: toolName,
            args: args,
            success: dataEntry.success,
            rowCount: dataEntry.rowCount,
            error: dataEntry.error || null,
            duration: toolDuration
        });
        state.diagnostics.timeSpent += toolDuration;

        // Record tool invocation for compatibility
        state.toolInvocations.push({
            tool: toolName,
            args: args,
            success: dataEntry.success,
            rowCount: dataEntry.rowCount,
            duration: toolDuration,
            fromCache: fromCache
        });

        return dataEntry;
    }

    /**
     * Phase 2: REASON_ACT - True ReAct Loop
     * Iteratively reasons about what data is needed and gathers it
     */
    function executeReasonActPhase(state) {
        const phaseStart = Date.now();

        // Increment iteration counter
        state.reasonActIterations = (state.reasonActIterations || 0) + 1;

        // Check for max iterations to prevent infinite loops
        if (state.reasonActIterations > MAX_REASON_ACT_ITERATIONS) {
            log.audit('REASON_ACT max iterations reached', {
                iterations: state.reasonActIterations,
                dataCollected: state.accumulatedData?.length || 0
            });

            upsertThinkingStep(state, 'reason_act', {
                title: 'Analyzing data',
                phase: 'reason_act',
                status: 'complete',
                duration: Date.now() - phaseStart,
                context: {
                    iteration: state.reasonActIterations,
                    maxIterationsReached: true,
                    dataCount: state.accumulatedData?.length || 0
                }
            });

            state.phase = PHASES.RESPOND;
            return { success: true, nextPhase: PHASES.RESPOND };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 6: PROGRESS-BASED CIRCUIT BREAKER
        // Check if we're making progress - if not, escalate early
        // ═══════════════════════════════════════════════════════════════════════
        const circuitBreaker = checkCircuitBreaker(state);
        if (circuitBreaker.shouldTrigger) {
            log.audit('REASON_ACT circuit breaker triggered', {
                reason: circuitBreaker.reason,
                consecutiveFailures: circuitBreaker.consecutiveFailures,
                escalationAction: circuitBreaker.escalationAction
            });

            state.circuitBreakerTriggered = true;

            // Escalate based on the suggested action
            if (circuitBreaker.escalationAction === 'SYNTHESIZE' &&
                state.synthesize?.enabled &&
                (state.synthesize?.iterations || 0) < MAX_SYNTHESIZE_ITERATIONS) {

                upsertThinkingStep(state, 'reason_act', {
                    title: 'No progress - trying custom query',
                    phase: 'reason_act',
                    status: 'complete',
                    duration: Date.now() - phaseStart,
                    context: {
                        circuitBreaker: true,
                        escalation: 'SYNTHESIZE',
                        reason: circuitBreaker.reason
                    }
                });

                state.phase = PHASES.SYNTHESIZE;
                return { success: true, nextPhase: PHASES.SYNTHESIZE };
            } else {
                // CLARIFY or give up - go to RESPOND with diagnostic info
                upsertThinkingStep(state, 'reason_act', {
                    title: 'Unable to find data',
                    phase: 'reason_act',
                    status: 'complete',
                    duration: Date.now() - phaseStart,
                    context: {
                        circuitBreaker: true,
                        escalation: 'RESPOND',
                        reason: circuitBreaker.reason
                    }
                });

                state.reflection.gaveUp = true;
                state.reflection.giveUpExplanation = circuitBreaker.reason;
                state.phase = PHASES.RESPOND;
                return { success: true, nextPhase: PHASES.RESPOND };
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 4: TOOL DIVERSIFICATION REQUIREMENT
        // Check if we need to force trying different tools
        // ═══════════════════════════════════════════════════════════════════════
        const diversification = checkToolDiversificationRequired(state);
        if (diversification.required) {
            log.audit('REASON_ACT tool diversification required', {
                reason: diversification.reason,
                exhaustedTool: diversification.exhaustedTool,
                suggestions: diversification.suggestions.map(s => s.tool)
            });

            state.diversificationTriggered = true;

            // Add diversification context to the state for prompt building
            state.forcedDiversification = {
                reason: diversification.reason,
                blockedTools: Object.keys(state.blockedTools || {}),
                suggestedAlternatives: diversification.suggestions
            };
        }

        // Build the prompt with accumulated data
        // Note: SYNTHESIZE hint is automatically computed inside buildAccumulatedDataSummary()

        // Build needs_resolution context from INTENT phase to guide CLARIFY behavior
        const needsResolution = state.intent?.needsResolution;
        const needsResolutionContext = needsResolution
            ? '- Intent analysis suggests this question may need clarification - CLARIFY is acceptable if still unclear after analysis.'
            : '- Intent was CLEAR - strongly prefer using DEFAULT PERIODS and proceeding. Do NOT ask for clarification unless data is genuinely missing after trying tools.';

        // Build comparison hint based on detected time_scope from intent phase
        const timeScope = state.intent?.time_scope || state.intent?.timeScope;
        const comparisonScopes = ['yoy', 'mom', 'qoq', 'comparison', 'prior_year', 'last_year', 'year_over_year'];
        const isComparisonIntent = comparisonScopes.some(scope =>
            timeScope?.toLowerCase()?.includes(scope) ||
            state.intent?.intent === 'comparison'
        );
        const comparisonHint = isComparisonIntent
            ? `
⚠️ COMPARISON DETECTED: Your question involves period comparison (${timeScope || 'comparison'}).
   USE compare_to PARAMETER: get_income_statement(period="ytd", compare_to="prior_year_ytd")
   This gives you unified data with pre-computed change and pct_change columns.
   DO NOT call the tool twice with different periods - use compare_to instead!`
            : '';

        const prompt = REASON_ACT_PROMPT
            .replace('{date_context}', getDateContext())
            .replace('{history_context}', buildHistoryContext(state))
            .replace('{question}', state.message)
            .replace('{accumulated_data}', buildAccumulatedDataSummary(state))
            .replace('{tool_list}', Tools.getToolListForPrompt())
            .replace('{period_options}', Tools.getAvailablePeriods())
            .replace('{needs_resolution_context}', needsResolutionContext)
            .replace('{comparison_hint}', comparisonHint);

        // Add thinking step
        upsertThinkingStep(state, 'reason_act', {
            title: state.reasonActIterations === 1 ? 'Planning analysis' : 'Evaluating progress',
            phase: 'reason_act',
            status: 'active',
            context: {
                iteration: state.reasonActIterations,
                dataCollected: state.accumulatedData?.length || 0
            }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: getTierForPhase('reason_act', state),
                temperature: 0.2,
                jsonMode: true,
                maxTokens: 800,
                purpose: 'SCA:reason_act'
            });

            const parsed = parseJsonResponse(response?.text);
            const duration = Date.now() - phaseStart;

            if (!parsed || !parsed.action) {
                throw new Error('Invalid REASON_ACT response - missing action');
            }

            log.debug('REASON_ACT decision', {
                iteration: state.reasonActIterations,
                action: parsed.action,
                thinking: parsed.thinking?.substring(0, 100),
                tool: parsed.tool
            });

            // Store narration
            state.narration = {
                text: parsed.userNarration || 'Analyzing...',
                phase: 'reason_act',
                timestamp: Date.now()
            };

            // Handle the action
            switch (parsed.action) {
                case 'GET_DATA': {
                    // Validate we have tool and args
                    if (!parsed.tool) {
                        throw new Error('GET_DATA action requires tool name');
                    }

                    const toolName = parsed.tool;
                    const args = parsed.args || {};

                    // Add tool call step for UI
                    addToolCallStep(state, {
                        title: Tools.getToolDisplayName(toolName, args),
                        tool: toolName,
                        status: 'active'
                    });

                    // Execute the tool
                    const toolResult = executeToolForReasonAct(state, toolName, args);

                    // Add to accumulated data
                    state.accumulatedData.push(toolResult);

                    // Update tool call step
                    updateToolCallStep(state, toolName, {
                        status: 'complete',
                        params: args,
                        result: {
                            success: toolResult.success,
                            rowCount: toolResult.rowCount,
                            columns: toolResult.columns,
                            preview: toolResult.preview?.slice(0, 3)
                        },
                        duration: toolResult.duration,
                        summary: toolResult.success
                            ? `Found ${toolResult.rowCount} results`
                            : toolResult.error
                    });

                    // Update thinking step
                    upsertThinkingStep(state, 'reason_act', {
                        title: 'Gathering data',
                        phase: 'reason_act',
                        status: 'complete',
                        duration: duration + toolResult.duration,
                        context: {
                            iteration: state.reasonActIterations,
                            action: 'GET_DATA',
                            tool: toolName,
                            success: toolResult.success,
                            rowCount: toolResult.rowCount
                        },
                        debug: buildDebugInfo(prompt, response, state, {
                            reasonActDecision: parsed,
                            toolResult: toolResult
                        })
                    });

                    // Loop back to REASON_ACT to evaluate if we have enough data
                    state.phase = PHASES.REASON_ACT;
                    return { success: true, nextPhase: PHASES.REASON_ACT };
                }

                case 'GET_DATA_BATCH': {
                    // Execute multiple independent tools in one step
                    if (!parsed.tools || !Array.isArray(parsed.tools) || parsed.tools.length === 0) {
                        throw new Error('GET_DATA_BATCH action requires tools array');
                    }

                    log.debug('REASON_ACT executing batch tools', {
                        count: parsed.tools.length,
                        tools: parsed.tools.map(t => t.tool)
                    });

                    let totalDuration = 0;
                    const batchResults = [];

                    // Execute each tool in the batch
                    for (const toolSpec of parsed.tools) {
                        const toolName = toolSpec.tool;
                        const args = toolSpec.args || {};

                        if (!toolName) {
                            log.audit('GET_DATA_BATCH skipping invalid tool spec', toolSpec);
                            continue;
                        }

                        // Add tool call step for UI
                        addToolCallStep(state, {
                            title: Tools.getToolDisplayName(toolName, args),
                            tool: toolName,
                            status: 'active'
                        });

                        // Execute the tool
                        const toolResult = executeToolForReasonAct(state, toolName, args);
                        totalDuration += toolResult.duration || 0;

                        // Add to accumulated data
                        state.accumulatedData.push(toolResult);
                        batchResults.push({
                            tool: toolName,
                            success: toolResult.success,
                            rowCount: toolResult.rowCount
                        });

                        // Update tool call step
                        updateToolCallStep(state, toolName, {
                            status: 'complete',
                            params: args,
                            result: {
                                success: toolResult.success,
                                rowCount: toolResult.rowCount,
                                columns: toolResult.columns,
                                preview: toolResult.preview?.slice(0, 3)
                            },
                            duration: toolResult.duration,
                            summary: toolResult.success
                                ? `Found ${toolResult.rowCount} results`
                                : toolResult.error
                        });
                    }

                    // Update thinking step
                    upsertThinkingStep(state, 'reason_act', {
                        title: 'Gathering data (batch)',
                        phase: 'reason_act',
                        status: 'complete',
                        duration: duration + totalDuration,
                        context: {
                            iteration: state.reasonActIterations,
                            action: 'GET_DATA_BATCH',
                            toolCount: parsed.tools.length,
                            results: batchResults
                        },
                        debug: buildDebugInfo(prompt, response, state, {
                            reasonActDecision: parsed,
                            batchResults: batchResults
                        })
                    });

                    // Loop back to REASON_ACT to evaluate if we have enough data
                    state.phase = PHASES.REASON_ACT;
                    return { success: true, nextPhase: PHASES.REASON_ACT };
                }

                case 'ANSWER': {
                    // LLM decided we have enough data - proceed to RESPOND
                    log.debug('REASON_ACT ready to answer', {
                        iterations: state.reasonActIterations,
                        dataCount: state.accumulatedData?.length || 0,
                        thinking: parsed.thinking
                    });

                    upsertThinkingStep(state, 'reason_act', {
                        title: 'Analysis complete',
                        phase: 'reason_act',
                        status: 'complete',
                        duration: duration,
                        context: {
                            iteration: state.reasonActIterations,
                            action: 'ANSWER',
                            dataCollected: state.accumulatedData?.length || 0,
                            reasoning: parsed.thinking?.substring(0, 100)
                        },
                        debug: buildDebugInfo(prompt, response, state, { reasonActDecision: parsed })
                    });

                    state.phase = PHASES.RESPOND;
                    return { success: true, nextPhase: PHASES.RESPOND };
                }

                case 'SYNTHESIZE': {
                    // LLM wants to write custom SQL
                    log.debug('REASON_ACT routing to SYNTHESIZE', {
                        thinking: parsed.thinking
                    });

                    upsertThinkingStep(state, 'reason_act', {
                        title: 'Need custom query',
                        phase: 'reason_act',
                        status: 'complete',
                        duration: duration,
                        context: {
                            iteration: state.reasonActIterations,
                            action: 'SYNTHESIZE',
                            reasoning: parsed.thinking?.substring(0, 100)
                        },
                        debug: buildDebugInfo(prompt, response, state, { reasonActDecision: parsed })
                    });

                    state.phase = PHASES.SYNTHESIZE;
                    return { success: true, nextPhase: PHASES.SYNTHESIZE };
                }

                case 'CLARIFY': {
                    // Need user clarification - store question and go to respond
                    log.debug('REASON_ACT needs clarification', {
                        question: parsed.clarification_question
                    });

                    state.clarificationNeeded = parsed.clarification_question;

                    upsertThinkingStep(state, 'reason_act', {
                        title: 'Need clarification',
                        phase: 'reason_act',
                        status: 'complete',
                        duration: duration,
                        context: {
                            iteration: state.reasonActIterations,
                            action: 'CLARIFY',
                            question: parsed.clarification_question
                        },
                        debug: buildDebugInfo(prompt, response, state, { reasonActDecision: parsed })
                    });

                    state.phase = PHASES.RESPOND;
                    return { success: true, nextPhase: PHASES.RESPOND };
                }

                default: {
                    // Unknown action - log and proceed to respond
                    log.audit('REASON_ACT unknown action', { action: parsed.action });

                    upsertThinkingStep(state, 'reason_act', {
                        title: 'Analysis complete',
                        phase: 'reason_act',
                        status: 'complete',
                        duration: duration,
                        context: {
                            iteration: state.reasonActIterations,
                            action: parsed.action,
                            unknown: true
                        }
                    });

                    state.phase = PHASES.RESPOND;
                    return { success: true, nextPhase: PHASES.RESPOND };
                }
            }

        } catch (e) {
            const duration = Date.now() - phaseStart;
            log.error('REASON_ACT phase failed', {
                error: e.message,
                iteration: state.reasonActIterations
            });

            state.errors.push({
                phase: 'reason_act',
                error: e.message,
                timestamp: Date.now()
            });

            upsertThinkingStep(state, 'reason_act', {
                title: 'Analysis complete',
                phase: 'reason_act',
                status: 'complete',
                duration: duration,
                context: {
                    iteration: state.reasonActIterations,
                    fallback: true,
                    error: e.message.substring(0, 100)
                }
            });

            // If we have some data, proceed to respond; otherwise try synthesize
            if (state.accumulatedData && state.accumulatedData.length > 0) {
                state.phase = PHASES.RESPOND;
                return { success: true, nextPhase: PHASES.RESPOND };
            } else if (state.synthesize?.enabled) {
                state.phase = PHASES.SYNTHESIZE;
                return { success: true, nextPhase: PHASES.SYNTHESIZE };
            } else {
                state.phase = PHASES.RESPOND;
                return { success: true, nextPhase: PHASES.RESPOND };
            }
        }
    }

    /**
     * Phase 2 (DEPRECATED): SELECT - Pick tools by name
     * Kept for backwards compatibility - REASON_ACT is the new flow
     */
    function executeSelectPhase(state) {
        const phaseStart = Date.now();

        // ═══════════════════════════════════════════════════════════════════════
        // GENERAL INTENT - Check if tools would enhance the response
        // Instead of skipping tools entirely, ask LLM if tools would help
        // e.g., "How do I check my cash?" could benefit from Cash dashboard navigation
        // ═══════════════════════════════════════════════════════════════════════
        if (state.intent && state.intent.intent === 'general') {
            // Ask LLM if tools would enhance the response
            const toolCheckPrompt = `User asked: "${state.message}"

Would any of these tools help answer this better?
- navigate_to_dashboard: Guide to specific dashboard (cash, AR, AP, revenue, expenses, etc.)
- list_dashboards: Show available analysis options
- get_help_topic: Explain Gantry features

Reply JSON only: {"use_tools": true/false, "suggested_tool": "tool_name or null", "reason": "brief explanation"}`;

            try {
                const toolCheckResponse = AIProviders.callAI(toolCheckPrompt, {
                    tier: TIERS.FAST,
                    temperature: 0.1,
                    jsonMode: true,
                    purpose: 'SCA:general_tool_check'
                });

                const toolCheck = parseJsonResponse(toolCheckResponse?.text);

                if (toolCheck && toolCheck.use_tools && toolCheck.suggested_tool) {
                    // Tools would help - continue to normal tool selection with hint
                    log.debug('SCA SELECT phase - general intent may benefit from tools', {
                        suggestedTool: toolCheck.suggested_tool,
                        reason: toolCheck.reason
                    });

                    // Store the suggestion as a hint for tool selection
                    state.toolSelectionHint = {
                        suggested_tool: toolCheck.suggested_tool,
                        reason: toolCheck.reason
                    };

                    upsertThinkingStep(state, 'select', {
                        title: 'Selecting analysis tools',
                        phase: 'select',
                        status: 'active',
                        context: {
                            intent: 'general',
                            toolCheckResult: 'tools_may_help',
                            suggestedTool: toolCheck.suggested_tool
                        }
                    });

                    // Continue to normal tool selection (don't return here)
                } else {
                    // No tools needed - pure conversational response
                    state.selectedTools = [];
                    state.phase = PHASES.RESPOND;

                    upsertThinkingStep(state, 'select', {
                        title: 'Selecting analysis tools',
                        phase: 'select',
                        status: 'complete',
                        duration: Date.now() - phaseStart,
                        context: {
                            intent: 'general',
                            selectedTools: [],
                            conversational: true,
                            skippedToolSelection: true
                        }
                    });

                    log.debug('SCA SELECT phase - general/conversational intent, skipping to RESPOND');
                    return { success: true, nextPhase: PHASES.RESPOND };
                }
            } catch (toolCheckError) {
                // If tool check fails, default to skipping tools for general intent
                log.debug('SCA SELECT phase - tool check failed, defaulting to no tools', {
                    error: toolCheckError.message
                });

                state.selectedTools = [];
                state.phase = PHASES.RESPOND;

                upsertThinkingStep(state, 'select', {
                    title: 'Selecting analysis tools',
                    phase: 'select',
                    status: 'complete',
                    duration: Date.now() - phaseStart,
                    context: {
                        intent: 'general',
                        selectedTools: [],
                        conversational: true,
                        skippedToolSelection: true,
                        toolCheckFailed: true
                    }
                });

                return { success: true, nextPhase: PHASES.RESPOND };
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FOLLOW-UP DATA REUSE vs DRILL-DOWN DETECTION
        // Check if user is asking for DRILL-DOWN details (specific collection data)
        // or just referencing previous data for context
        // Uses semantic is_drill_down from INTENT phase (replaces hardcoded keywords)
        // ═══════════════════════════════════════════════════════════════════════
        if (state.intent.intent === 'follow_up' && state.previousDataRefs && state.previousDataRefs.length > 0) {
            // Use semantic drill-down detection from INTENT phase
            const isDrillDownRequest = state.intent.is_drill_down === true;

            // Check if previous data was from a dashboard (has collections)
            const hasDashboardData = state.previousDataRefs.some(ref => {
                const cols = ref.summary?.columns || [];
                return cols.includes('refId') || ref.refId?.startsWith('dash_');
            });

            if (isDrillDownRequest && hasDashboardData) {
                // This looks like a drill-down request - let LLM select load_cached_data
                log.debug('SCA SELECT phase - detected drill-down request, allowing tool selection', {
                    message: state.message.substring(0, 50),
                    hasDashboardData: true,
                    drillDownContext: state.intent.drill_down_context
                });
                // Continue to normal tool selection (don't skip)
            } else {
                // Simple follow-up - reuse previous data
                log.debug('SCA SELECT phase - simple follow-up, reusing previous data');

                // Reuse previous data references
                state.dataReferences = state.previousDataRefs;
                state.selectedTools = []; // No new tools needed

                upsertThinkingStep(state, 'select', {
                    title: 'Using previous results',
                    phase: 'select',
                    status: 'complete',
                    duration: Date.now() - phaseStart,
                    context: {
                        intent: state.intent.intent,
                        reusingPreviousData: true,
                        dataRefs: state.dataReferences.length
                    }
                });

                // Skip INVOKE and go straight to REFLECT (which will proceed to RESPOND)
                state.phase = PHASES.REFLECT;
                return { success: true, nextPhase: PHASES.REFLECT };
            }
        }

        const entityContext = state.intent.entities && state.intent.entities.length > 0
            ? `Mentioned entities: ${state.intent.entities.join(', ')}`
            : 'No specific entities mentioned';

        // Build context about previously fetched data (for drill-down queries)
        let availableDataContext = '';
        if (state.previousDataRefs && state.previousDataRefs.length > 0) {
            availableDataContext = '\nPREVIOUSLY FETCHED DATA (available for drill-down):';
            state.previousDataRefs.forEach(ref => {
                const summary = ref.summary || {};
                availableDataContext += `\n- Tool: ${summary.tool || 'unknown'}, RefId: ${ref.refId}`;
                if (summary.columns) {
                    // Check for collection rows
                    const collectionInfo = (summary.columns || []).includes('refId') ?
                        ' (dashboard with collections - can drill into arBuckets, apBuckets, weeklyProjection, etc.)' : '';
                    availableDataContext += collectionInfo;
                }
            });
            availableDataContext += '\n\nIf user asks about details/drill-down, use load_cached_data with ref_id and collection_name.\n';
        }

        const prompt = SELECT_PROMPT
            .replace('{intent}', state.intent.intent)
            .replace('{tool_list}', Tools.getToolListForPrompt())
            .replace('{question}', state.message)
            .replace('{entity_context}', entityContext)
            .replace('{date_context}', getDateContext())
            .replace('{history_context}', buildHistoryContext(state))
            .replace('{available_data_context}', availableDataContext);

        upsertThinkingStep(state, 'select', {
            title: 'Selecting analysis tools',
            phase: 'select',
            status: 'active',
            context: {
                intent: state.intent.intent,
                availableTools: Object.keys(Tools.getToolManifest()).length
            }
        });

        try {
            const response = AIProviders.callAI(prompt, {
                tier: getTierForPhase('select', state),
                temperature: 0.1,
                jsonMode: true,
                purpose: 'SCA:select'
            });

            const parsed = parseJsonResponse(response?.text);
            const duration = Date.now() - phaseStart;
            state.phaseTimings.select = duration;

            if (parsed && parsed.tools && parsed.tools.length > 0) {
                // Normalize tool selection - handle both string format and object format
                // LLM might return: ["tool_name"] OR [{tool_name: "name", parameters: {}}]
                let selectedTools = parsed.tools
                    .map(t => typeof t === 'string' ? t : (t.tool_name || t.name || null))
                    .filter(t => t && t !== 'format_response')
                    .slice(0, MAX_TOOL_INVOCATIONS);

                // Get default tools if LLM didn't select any
                if (selectedTools.length === 0) {
                    selectedTools = getDefaultToolsForIntent(state.intent.intent, state);
                }

                state.selectedTools = selectedTools;

                // OPTIMIZATION: Skip directly to RESPOND for conversational queries (no tools needed)
                if (selectedTools.length === 0 && state.intent.intent === 'general') {
                    state.phase = PHASES.RESPOND;

                    upsertThinkingStep(state, 'select', {
                        title: 'Selecting analysis tools',
                        phase: 'select',
                        status: 'complete',
                        duration: duration,
                        context: {
                            intent: state.intent.intent,
                            selectedTools: [],
                            conversational: true
                        },
                        debug: buildDebugInfo(prompt, response, state, { parsedSelection: parsed })
                    });

                    log.debug('SCA Select phase - conversational query, skipping to RESPOND');
                    return { success: true, nextPhase: PHASES.RESPOND };
                }

                state.phase = PHASES.INVOKE;

                // Store progressive narration for frontend display
                state.narration = {
                    text: parsed.userNarration || 'Gathering your financial data...',
                    phase: 'select',
                    timestamp: Date.now()
                };

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
            state.selectedTools = getDefaultToolsForIntent(state.intent.intent, state);

            // OPTIMIZATION: Skip directly to RESPOND for conversational queries
            if (state.selectedTools.length === 0 && state.intent.intent === 'general') {
                state.phase = PHASES.RESPOND;

                upsertThinkingStep(state, 'select', {
                    title: 'Selecting analysis tools',
                    phase: 'select',
                    status: 'complete',
                    duration: duration,
                    context: {
                        selectedTools: [],
                        conversational: true,
                        fallback: true,
                        error: e.message
                    }
                });

                return { success: true, nextPhase: PHASES.RESPOND };
            }

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
     * INTELLIGENCE FIX: Auto-inject resolved entity IDs into tool arguments
     * When we have previously resolved an entity, ensure the tool gets the correct ID
     * even if the LLM forgot to include it or used the wrong value.
     *
     * @param {Object} args - Tool arguments from LLM
     * @param {Object} state - Current streaming state
     * @param {string} toolName - Name of the tool being invoked
     * @returns {Object} Enhanced arguments with entity IDs injected
     */
    function autoInjectResolvedEntities(args, state, toolName) {
        if (!state.resolvedEntities || Object.keys(state.resolvedEntities).length === 0) {
            return args;
        }

        const enhanced = { ...args };
        const resolvedEntries = Object.entries(state.resolvedEntities);

        // ═══════════════════════════════════════════════════════════════════════
        // FULLY DYNAMIC ENTITY ID INJECTION
        // Inspects tool's parameter schema to find matching parameters
        // Works for standard entities AND custom record types
        // ═══════════════════════════════════════════════════════════════════════

        // Get tool schema to determine which parameters it accepts
        const tool = Tools.getTool(toolName);
        const toolParams = tool?.parameters?.properties || {};
        const toolParamNames = Object.keys(toolParams);

        for (const [searchTerm, entity] of resolvedEntries) {
            if (!entity || !entity.id) continue;

            const entityType = (entity.type || '').toLowerCase();

            // Dynamically find matching parameter names from tool schema
            const candidateParams = findEntityParamNames(entityType, toolParamNames);

            // Try to inject into each candidate parameter if the tool accepts it
            for (const paramName of candidateParams) {
                // Check if tool accepts this parameter AND we haven't already set it
                if (toolParams[paramName] && !enhanced[paramName]) {
                    enhanced[paramName] = entity.id;
                    log.debug('Dynamic entity ID injection', {
                        toolName,
                        paramName,
                        entityName: entity.name,
                        entityId: entity.id,
                        entityType: entityType,
                        detectionMethod: 'schema_introspection'
                    });
                    // Only inject into the first matching parameter
                    break;
                }
            }
        }

        return enhanced;
    }

    /**
     * Dynamically find parameter names that match an entity type
     * Works for standard entities AND custom record types
     *
     * @param {string} entityType - The entity type (e.g., 'customer', 'vendor', 'customrecord_contact')
     * @param {Array<string>} toolParamNames - Array of parameter names the tool accepts
     * @returns {Array<string>} Ordered list of matching parameter names
     */
    function findEntityParamNames(entityType, toolParamNames) {
        const entityLower = entityType.toLowerCase();
        const candidates = [];

        // Priority 1: Exact match with _id suffix (customer_id, vendor_id, etc.)
        const exactMatch = `${entityLower}_id`;
        if (toolParamNames.includes(exactMatch)) {
            candidates.push(exactMatch);
        }

        // Priority 2: Handle special cases (project -> job_id)
        const aliasMap = {
            'project': 'job_id',
            'job': 'project_id'
        };
        if (aliasMap[entityLower] && toolParamNames.includes(aliasMap[entityLower])) {
            candidates.push(aliasMap[entityLower]);
        }

        // Priority 3: Check for custom record types (customrecord_xyz -> customrecord_xyz_id)
        if (entityLower.startsWith('customrecord_')) {
            const customParamName = `${entityLower}_id`;
            if (toolParamNames.includes(customParamName)) {
                candidates.push(customParamName);
            }
            // Also check for generic record_id
            if (toolParamNames.includes('record_id') && !candidates.includes('record_id')) {
                candidates.push('record_id');
            }
        }

        // Priority 4: Generic entity_id (works for any entity type)
        if (toolParamNames.includes('entity_id') && !candidates.includes('entity_id')) {
            candidates.push('entity_id');
        }

        // Priority 5: Fuzzy match - parameter contains entity type
        for (const paramName of toolParamNames) {
            const paramLower = paramName.toLowerCase();
            if (paramLower.includes(entityLower) && paramLower.endsWith('_id')) {
                if (!candidates.includes(paramName)) {
                    candidates.push(paramName);
                }
            }
        }

        // Priority 6: For common entities, also check plural forms
        const pluralMap = {
            'vendor': 'vendor_ids',
            'customer': 'customer_ids',
            'employee': 'employee_ids'
        };
        if (pluralMap[entityLower] && toolParamNames.includes(pluralMap[entityLower])) {
            // Note: This would need array handling in the injection logic
            // For now, just note its availability but don't add to candidates
            log.debug('Plural parameter available', { entityType, param: pluralMap[entityLower] });
        }

        return candidates;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTO-INJECT CACHE REF_ID
    // When load_cached_data is called without ref_id, auto-detect from available refs
    // ═══════════════════════════════════════════════════════════════════════════
    function autoInjectCacheRefId(args, state, toolName) {
        // Only applies to load_cached_data tool
        if (toolName !== 'load_cached_data') {
            return args;
        }

        // If ref_id is already provided, nothing to do
        if (args.ref_id) {
            return args;
        }

        const enhanced = { ...args };

        // Gather all available data refs (current request + previous request)
        const allRefs = [
            ...(state.dataReferences || []),
            ...(state.previousDataRefs || [])
        ];

        if (allRefs.length === 0) {
            log.debug('autoInjectCacheRefId - no refs available');
            return args;
        }

        // If collection_name is provided, find a dashboard ref that has this collection
        if (args.collection_name) {
            const collectionNameLower = args.collection_name.toLowerCase();

            for (const ref of allRefs) {
                // Only check dashboard refs
                if (!ref.refId || !ref.refId.startsWith('dash_')) {
                    continue;
                }

                // Load the stored data to check its collections
                const storedData = Cache.loadRows(ref.requestId || state.requestId, ref.refId, 0, 1);
                const intelligence = storedData.intelligence;

                if (intelligence && intelligence.collections) {
                    // Check if this dashboard has the requested collection
                    const collectionNames = Object.keys(intelligence.collections).map(c => c.toLowerCase());
                    if (collectionNames.includes(collectionNameLower)) {
                        enhanced.ref_id = ref.refId;
                        log.debug('autoInjectCacheRefId - auto-injected ref_id from collection match', {
                            collection_name: args.collection_name,
                            ref_id: ref.refId,
                            dashboard: ref.summary?.dashboardName || 'unknown'
                        });
                        return enhanced;
                    }
                }
            }
        }

        // If no collection_name specified but only one dashboard ref exists, use it
        const dashboardRefs = allRefs.filter(r => r.refId && r.refId.startsWith('dash_'));
        if (dashboardRefs.length === 1 && !args.collection_name) {
            enhanced.ref_id = dashboardRefs[0].refId;
            log.debug('autoInjectCacheRefId - auto-injected single dashboard ref_id', {
                ref_id: dashboardRefs[0].refId
            });
            return enhanced;
        }

        // If there's only one ref total, use it
        if (allRefs.length === 1 && !args.collection_name) {
            enhanced.ref_id = allRefs[0].refId;
            log.debug('autoInjectCacheRefId - auto-injected single ref_id', {
                ref_id: allRefs[0].refId
            });
            return enhanced;
        }

        // Log warning if we couldn't auto-inject
        log.debug('autoInjectCacheRefId - could not auto-inject ref_id', {
            collection_name: args.collection_name || 'not specified',
            availableRefIds: allRefs.map(r => r.refId),
            dashboardCount: dashboardRefs.length
        });

        return enhanced;
    }

    /**
     * Phase 3: INVOKE - Call tools one at a time
     * After all tools complete, transitions to REFLECT phase for ReAct pattern evaluation
     */
    function executeInvokePhase(state) {
        // Check if we have more tools to invoke
        const invokedCount = state.toolInvocations.length;
        if (invokedCount >= state.selectedTools.length) {
            // All tools invoked - tables will appear in final response, not progressively
            // Progressive narration provides context during processing instead

            // ═══════════════════════════════════════════════════════════════════════
            // ReAct Pattern: Move to REFLECT phase to evaluate results
            // Instead of blindly proceeding to RESPOND, let LLM evaluate:
            // - Did we get useful data?
            // - If not, why? (entity not found vs no data vs too restrictive)
            // - What should we do next? (proceed, broaden, retry, clarify, give up)
            // ═══════════════════════════════════════════════════════════════════════
            state.phase = PHASES.REFLECT;
            return { success: true, nextPhase: PHASES.REFLECT };
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

        const currentYear = new Date().getFullYear();
        const prompt = INVOKE_PROMPT
            .replace('{tool_name}', toolName)
            .replace('{tool_schema}', schemaLines.join('\n') || 'No parameters required')
            .replace('{history_context}', buildHistoryContext(state))
            .replace('{question}', state.message)
            .replace('{resolved_entities}', resolvedContext ? `Resolved entities:\n${resolvedContext}` : '')
            .replace('{date_context}', getDateContext())
            .replace('{period_options}', Tools.getAvailablePeriods())
            .replace(/\{current_year\}/g, currentYear.toString());

        // Add step as active
        addToolCallStep(state, {
            title: Tools.getToolDisplayName(toolName, {}),
            tool: toolName,
            status: 'active'
        });

        const invokeStart = Date.now();

        try {
            const response = AIProviders.callAI(prompt, {
                tier: getTierForPhase('invoke', state),
                temperature: 0.1,
                jsonMode: true,
                purpose: `SCA:invoke:${toolName}`
            });

            const parsed = parseJsonResponse(response?.text);
            let args = parsed?.args || {};

            // ═══════════════════════════════════════════════════════════════════════
            // INTELLIGENCE FIX: Auto-inject resolved entity IDs into tool arguments
            // This prevents the LLM from forgetting to use the correct entity ID
            // ═══════════════════════════════════════════════════════════════════════
            args = autoInjectResolvedEntities(args, state, toolName);

            // ═══════════════════════════════════════════════════════════════════════
            // CACHE REF_ID FIX: Auto-inject ref_id for load_cached_data tool
            // When LLM omits ref_id, detect from available refs based on collection_name
            // ═══════════════════════════════════════════════════════════════════════
            args = autoInjectCacheRefId(args, state, toolName);

            // ═══════════════════════════════════════════════════════════════════════
            // BROADEN FIX: Apply broadened parameters from REFLECT phase
            // When REFLECT decides to BROADEN, it stores modified_params in state.broadenedParams
            // These MUST be merged into args to actually change the query behavior
            // ═══════════════════════════════════════════════════════════════════════
            if (state.broadenedParams && Object.keys(state.broadenedParams).length > 0) {
                log.debug('Applying broadened parameters from REFLECT', {
                    tool: toolName,
                    originalArgs: args,
                    broadenedParams: state.broadenedParams
                });
                args = { ...args, ...state.broadenedParams };
                // Clear after applying so we don't apply stale params to subsequent tools
                state.broadenedParams = null;
            }

            // ═══════════════════════════════════════════════════════════════════════
            // AGENTIC COLLECTION LOADING: Apply pending tool args from REFLECT
            // When REFLECT decides LOAD_COLLECTION, it stores args in state.pendingToolArgs
            // This allows REFLECT to directly specify what collection to load
            // ═══════════════════════════════════════════════════════════════════════
            if (state.pendingToolArgs && Object.keys(state.pendingToolArgs).length > 0) {
                log.debug('Applying pending tool args from REFLECT', {
                    tool: toolName,
                    originalArgs: args,
                    pendingArgs: state.pendingToolArgs
                });
                args = { ...args, ...state.pendingToolArgs };
                // Clear after applying
                state.pendingToolArgs = null;
            }

            // ═══════════════════════════════════════════════════════════════════════
            // TOOL RESULT CACHING: Check cache before executing
            // Entity resolution tools cached for 5 minutes, data queries for 30 seconds
            // ═══════════════════════════════════════════════════════════════════════
            const toolStart = Date.now();
            let result = Cache.getCachedToolResult(toolName, args);
            let fromCache = false;

            if (result) {
                // Cache hit - use cached result
                fromCache = true;
                log.debug('Tool result from cache', { tool: toolName, args: args });
            } else {
                // Cache miss - execute the tool
                result = Tools.executeTool(toolName, args);
                // Cache successful results
                Cache.cacheToolResult(toolName, args, result);
            }
            const toolDuration = Date.now() - toolStart;
            const totalDuration = Date.now() - invokeStart;

            // Store data reference if tool returned rows OR dashboard intelligence
            let dataRef = null;
            if (result.success && result.rows && result.rows.length > 0) {
                // Standard tool with rows
                dataRef = Cache.storeData(state.requestId, toolName, result);
                state.dataReferences.push(dataRef);
                // Track that we found data (for reflection)
                state.reflection.dataFound = true;
            } else if (isDashboardResult(result)) {
                // Dashboard Intelligence Bridge: Convert intelligence to data reference
                // This enables RESPOND phase to consume dashboard data seamlessly
                dataRef = storeDashboardDataReference(state.requestId, toolName, result);
                if (dataRef) {
                    state.dataReferences.push(dataRef);
                    state.reflection.dataFound = true;
                    log.debug('INVOKE phase - dashboard intelligence stored', {
                        tool: toolName,
                        dashboard: result.dashboard,
                        metricsCount: Object.keys(result.intelligence?.metrics || {}).length,
                        dataRefId: dataRef?.refId
                    });
                }
            }

            // ═══════════════════════════════════════════════════════════════════════
            // TRACK ENTITY RESOLUTION SEPARATELY FROM DATA
            // This enables proper diagnosis in REFLECT phase:
            // - Entity found but no data = ENTITY_FOUND_NO_DATA
            // - Entity not found = ENTITY_NOT_FOUND
            // ═══════════════════════════════════════════════════════════════════════
            if (toolName.startsWith('resolve_')) {
                if (result.found && result.entity) {
                    const searchName = args.name || 'unknown';
                    state.resolvedEntities[searchName] = result.entity;
                    state.reflection.entityFound = true;

                    // Record in journey
                    state.reflection.journey.push({
                        action: 'entity_resolved',
                        entity: result.entity.name,
                        type: result.entity.type,
                        id: result.entity.id,
                        confidence: result.confidence || 1.0
                    });
                } else {
                    // Entity was NOT found - important distinction
                    state.reflection.entityFound = false;
                    state.reflection.journey.push({
                        action: 'entity_not_found',
                        searchName: args.name,
                        searchType: args.type || 'auto'
                    });
                }
            }

            // Classify the invocation result for reflection
            const invocationResult = classifyToolResult(toolName, result, args, state);

            const invocation = {
                tool: toolName,
                args: args,
                success: result.success,
                rowCount: result.rowCount || (result.rows ? result.rows.length : 0),
                columns: result.columns || (result.rows && result.rows[0] ? Object.keys(result.rows[0]) : []),
                dataRef: dataRef?.refId,
                duration: toolDuration,
                fromCache: fromCache,  // Track cache usage
                timestamp: Date.now(),
                // NEW: Classification for reflection
                resultClass: invocationResult.classification,
                resultDetails: invocationResult.details,
                // Store result data for subsequent tool invocations to reference
                // This enables LLM to use IDs/values from previous tools (e.g., vendor IDs from get_top_vendors)
                result: result.rows ? { rows: result.rows.slice(0, 20) } : null // Limit to 20 rows to manage memory
            };
            state.toolInvocations.push(invocation);

            // Build preview for frontend
            const preview = result.rows?.slice(0, 3).map(row => {
                const previewRow = {};
                const cols = Object.keys(row).slice(0, 4);
                cols.forEach(col => { previewRow[col] = row[col]; });
                return previewRow;
            });

            // Update step with results - use smart summary builder
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
                summary: buildToolResultSummary(toolName, result, invocation.rowCount),
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
                fromCache: fromCache,
                duration: totalDuration
            });

            // Update progressive narration with template based on results
            const toolDisplayName = Tools.getToolDisplayName(toolName, args);
            if (result.success && invocation.rowCount > 0) {
                state.narration = {
                    text: 'Found ' + invocation.rowCount.toLocaleString() + ' results from ' + toolDisplayName.toLowerCase() + '...',
                    phase: 'invoke',
                    timestamp: Date.now()
                };
            } else if (result.success) {
                state.narration = {
                    text: 'Processed ' + toolDisplayName.toLowerCase() + '...',
                    phase: 'invoke',
                    timestamp: Date.now()
                };
            }

            return { success: true, nextPhase: PHASES.INVOKE }; // Continue with next tool

        } catch (e) {
            const duration = Date.now() - invokeStart;
            log.error('SCA Invoke phase failed', { tool: toolName, error: e.message, duration: duration });
            state.errors.push({ phase: 'invoke', tool: toolName, error: e.message, timestamp: Date.now() });
            state.toolInvocations.push({ tool: toolName, error: e.message, duration: duration, failed: true });

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

            // ═══════════════════════════════════════════════════════════════════════
            // RECOMMENDATION 6: PROACTIVE ERROR RECOVERY
            // When a tool fails, attempt alternative tools that may provide similar data
            // ═══════════════════════════════════════════════════════════════════════

            // Check if we haven't already tried recovery for this tool
            if (!state.recoveryAttempts[toolName]) {
                const alternatives = getAlternativeTools(toolName, state);

                // Filter out tools we've already selected or invoked
                const alreadyTried = [...state.selectedTools, ...state.toolInvocations.map(t => t.tool)];
                const validAlternatives = alternatives.filter(alt =>
                    !alreadyTried.includes(alt) && Tools.getTool(alt)
                );

                if (validAlternatives.length > 0) {
                    // Mark that we've attempted recovery for this tool
                    state.recoveryAttempts[toolName] = true;

                    // Add the first alternative to the selected tools queue
                    const alternativeTool = validAlternatives[0];
                    state.selectedTools.push(alternativeTool);

                    log.debug('SCA Proactive error recovery - trying alternative tool', {
                        failedTool: toolName,
                        alternativeTool: alternativeTool,
                        error: e.message
                    });

                    // Add a recovery step to inform the user
                    addToolCallStep(state, {
                        title: `Trying alternative: ${Tools.getToolDisplayName(alternativeTool, {})}`,
                        tool: alternativeTool,
                        status: 'active',
                        context: {
                            recoveryFor: toolName,
                            reason: 'Primary tool failed, attempting fallback'
                        }
                    });
                } else {
                    // No alternatives available - store retry suggestion for user
                    const suggestion = buildRetrySuggestion(toolName, e.message);
                    state.errors[state.errors.length - 1].suggestion = suggestion;
                    log.debug('SCA No alternative tools available', { tool: toolName });
                }
            }

            return { success: true, nextPhase: PHASES.INVOKE }; // Continue with next tool
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TOOL RESULT CLASSIFICATION
    // Distinguishes between different types of results for intelligent reflection
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Classify a tool result to enable intelligent reflection
     * Distinguishes between: success, entity not found, entity found but no data, etc.
     */
    function classifyToolResult(toolName, result, args, state) {
        // Entity resolution tools
        if (toolName.startsWith('resolve_')) {
            if (result.found && result.entity) {
                return {
                    classification: 'ENTITY_FOUND',
                    details: { entity: result.entity, confidence: result.confidence }
                };
            } else {
                return {
                    classification: 'ENTITY_NOT_FOUND',
                    details: { searchName: args.name, searchType: args.type }
                };
            }
        }

        // Data retrieval tools
        const rowCount = result.rowCount || (result.rows ? result.rows.length : 0);

        if (!result.success) {
            return {
                classification: 'TOOL_ERROR',
                details: { error: result.error || 'Unknown error' }
            };
        }

        if (rowCount > 0) {
            return {
                classification: 'DATA_FOUND',
                details: { rowCount: rowCount, truncated: result.truncated || false }
            };
        }

        // Zero rows - need to determine WHY
        // Check if we had an entity filter that might be too restrictive
        const hasEntityFilter = args.customer_id || args.vendor_id || args.entity_id;
        const hasDateFilter = args.start_date || args.end_date || args.period;
        const hasTypeFilter = args.transaction_type || args.account_type;

        if (hasEntityFilter && state.reflection.entityFound) {
            // Entity was found but query returned no data
            return {
                classification: 'ENTITY_FOUND_NO_DATA',
                details: {
                    entityFilter: hasEntityFilter,
                    dateFilter: hasDateFilter,
                    typeFilter: hasTypeFilter,
                    suggestion: hasDateFilter || hasTypeFilter ? 'Try broader filters' : 'No matching data exists'
                }
            };
        }

        if (hasDateFilter || hasTypeFilter) {
            // Filters might be too restrictive
            return {
                classification: 'QUERY_TOO_RESTRICTIVE',
                details: {
                    dateFilter: hasDateFilter,
                    typeFilter: hasTypeFilter,
                    suggestion: 'Try removing or broadening filters'
                }
            };
        }

        // No data exists for this query type
        return {
            classification: 'NO_DATA_EXISTS',
            details: { tool: toolName, suggestion: 'This data type may not exist in the system' }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REFLECT PHASE - ReAct Pattern (Reasoning + Acting)
    // Evaluates tool results and decides the next action
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Phase 3.5: REFLECT - Evaluate results and decide next action
     * This is the core of the ReAct pattern:
     * 1. Evaluate: Did we get useful data?
     * 2. Reason: If not, why? (entity not found, no data, too restrictive, wrong tool)
     * 3. Decide: Proceed, broaden, retry, clarify, or give up
     * 4. Loop back to INVOKE if retrying, otherwise proceed to RESPOND
     */
    function executeReflectPhase(state) {
        const phaseStart = Date.now();

        // Increment reflection counter
        state.reflectIterations++;

        // Check for infinite loop prevention
        if (state.reflectIterations > MAX_REFLECT_ITERATIONS) {
            log.audit('SCA REFLECT phase - max iterations reached, proceeding to RESPOND', {
                iterations: state.reflectIterations
            });
            state.phase = PHASES.RESPOND;
            return { success: true, nextPhase: PHASES.RESPOND };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // AGENTIC REFLECTION: Always evaluate whether data answers the question
        // Never skip LLM evaluation - "having data" != "having the RIGHT data"
        // The LLM must decide if it can answer the user's specific question
        // ═══════════════════════════════════════════════════════════════════════

        // FIX: Also check state.reflection.dataFound which SYNTHESIZE sets to true
        // This ensures we don't miss data from custom SQL queries
        const hasUsefulData = state.dataReferences.length > 0 || state.reflection.dataFound === true;

        // FIX: Also count rows from successful SYNTHESIZE queries (defense-in-depth)
        const synthesizeRows = (state.synthesize?.queries || [])
            .filter(q => q.success)
            .reduce((sum, q) => sum + (q.rowCount || 0), 0);
        const totalRows = state.toolInvocations.reduce((sum, inv) =>
            sum + (inv.rowCount || 0), 0) + synthesizeRows;

        log.debug('SCA REFLECT phase - evaluating with LLM (always-evaluate mode)', {
            dataRefs: state.dataReferences.length,
            totalRows: totalRows,
            synthesizeRows: synthesizeRows,
            dataFoundFlag: state.reflection.dataFound,
            tools: state.toolInvocations.map(t => t.tool)
        });

        // Build summaries for the LLM
        const toolSummary = buildToolSummaryForReflection(state);
        const resolvedEntitiesStr = buildResolvedEntitiesForReflection(state);
        const dataSummary = buildDataSummaryForReflection(state);

        const prompt = REFLECT_PROMPT
            .replace('{history_context}', buildHistoryContext(state))
            .replace('{question}', state.message)
            .replace('{tool_summary}', toolSummary)
            .replace('{resolved_entities}', resolvedEntitiesStr)
            .replace('{data_summary}', dataSummary);

        // Add thinking step
        upsertThinkingStep(state, 'reflect', {
            title: 'Evaluating results',
            phase: 'reflect',
            status: 'active',
            context: {
                iteration: state.reflectIterations,
                hasData: hasUsefulData,
                entityFound: state.reflection.entityFound
            }
        });

        // ═══════════════════════════════════════════════════════════════════════
        // LLM RETRY LOOP - Retry up to 3 times if response is invalid
        // ═══════════════════════════════════════════════════════════════════════
        const MAX_LLM_RETRIES = 3;
        let lastError = null;
        let parsed = null;

        for (let attempt = 1; attempt <= MAX_LLM_RETRIES; attempt++) {
            try {
                const response = AIProviders.callAI(prompt, {
                    tier: getTierForPhase('reflect', state),
                    temperature: 0.2 + (attempt - 1) * 0.1, // Slightly increase temperature on retries
                    maxTokens: 500,
                    jsonMode: true,
                    purpose: 'SCA:reflect'
                });

                parsed = parseJsonResponse(response?.text);

                // Normalize action field - handle alternative key names LLM might use
                if (parsed && !parsed.action) {
                    parsed.action = parsed.recommendation || parsed.decision || parsed.next_action;
                }

                if (!parsed || !parsed.action) {
                    throw new Error('Invalid reflect response - missing action');
                }

                // Success - break out of retry loop
                log.debug('SCA REFLECT LLM succeeded', { attempt: attempt });
                break;

            } catch (e) {
                lastError = e;
                log.debug('SCA REFLECT LLM attempt failed', {
                    attempt: attempt,
                    maxAttempts: MAX_LLM_RETRIES,
                    error: e.message
                });

                if (attempt < MAX_LLM_RETRIES) {
                    // Will retry
                    continue;
                }
                // Last attempt failed - will fall through to fallback
            }
        }

        const duration = Date.now() - phaseStart;
        state.phaseTimings.reflect = (state.phaseTimings.reflect || 0) + duration;

        // Check if we got a valid response after retries
        if (parsed && parsed.action) {
            // Update reflection state
            state.reflection.hasReflected = true;
            state.reflection.failureMode = parsed.evaluation?.failure_mode || FAILURE_MODES.NO_DATA_EXISTS;

            // Record in journey
            state.reflection.journey.push({
                action: 'reflection',
                iteration: state.reflectIterations,
                evaluation: parsed.evaluation,
                decision: parsed.action,
                reasoning: parsed.reasoning
            });

            // Handle the decided action
            const nextPhase = handleReflectAction(state, parsed);

            // Store progressive narration for frontend display
            state.narration = {
                text: parsed.userNarration || 'Analyzing patterns in your data...',
                phase: 'reflect',
                timestamp: Date.now()
            };

            // Update thinking step
            upsertThinkingStep(state, 'reflect', {
                title: 'Evaluating results',
                phase: 'reflect',
                status: 'complete',
                duration: duration,
                context: {
                    iteration: state.reflectIterations,
                    action: parsed.action,
                    reasoning: parsed.reasoning?.substring(0, 100)
                },
                debug: buildDebugInfo(prompt, null, state, { reflection: parsed })
            });

            log.debug('SCA REFLECT phase complete', {
                action: parsed.action,
                failureMode: parsed.evaluation?.failure_mode,
                nextPhase: nextPhase,
                duration: duration
            });

            return { success: true, nextPhase: nextPhase };
        }

        // All retries exhausted - fallback
        log.error('SCA REFLECT phase failed after retries', { error: lastError?.message, duration: duration });
        state.errors.push({ phase: 'reflect', error: lastError?.message || 'LLM retries exhausted', timestamp: Date.now() });

        // Default: proceed to RESPOND with what we have
        state.phase = PHASES.RESPOND;

        upsertThinkingStep(state, 'reflect', {
            title: 'Evaluating results',
            phase: 'reflect',
            status: 'complete',
            duration: duration,
            context: {
                fallback: true,
                error: (lastError?.message || 'LLM retries exhausted').substring(0, 100)
            }
        });

        return { success: true, nextPhase: PHASES.RESPOND };
    }

    /**
     * Handle the action decided by REFLECT phase
     * Returns the next phase to execute
     */
    function handleReflectAction(state, parsed) {
        const action = parsed.action;
        const details = parsed.action_details || {};

        switch (action) {
            case 'PROCEED':
                // ═══════════════════════════════════════════════════════════════════════
                // COMBINED REFLECT+RESPOND: If LLM included response.blocks, use them
                // This saves an entire LLM round trip
                // ═══════════════════════════════════════════════════════════════════════
                if (parsed.response && parsed.response.blocks && Array.isArray(parsed.response.blocks)) {
                    log.debug('SCA REFLECT - PROCEED with inline response (combined mode)', {
                        blockCount: parsed.response.blocks.length
                    });
                    // Store the response blocks for later processing
                    state.reflectResponse = parsed.response;
                    state.phase = PHASES.RESPOND;
                    return PHASES.RESPOND;
                }
                // No inline response - proceed to normal RESPOND phase
                state.phase = PHASES.RESPOND;
                return PHASES.RESPOND;

            case 'LOAD_COLLECTION':
                // ═══════════════════════════════════════════════════════════════════════
                // AGENTIC COLLECTION LOADING: Load detailed data from dashboard collection
                // This is the key to making the system truly agentic
                // ═══════════════════════════════════════════════════════════════════════
                if (details.collection_name && details.ref_id) {
                    log.debug('SCA REFLECT - LOAD_COLLECTION', {
                        collection: details.collection_name,
                        refId: details.ref_id
                    });

                    // Queue load_cached_data tool with collection params
                    state.selectedTools.push('load_cached_data');
                    state.pendingToolArgs = {
                        ref_id: details.ref_id,
                        collection_name: details.collection_name
                    };
                    state.reflection.journey.push({
                        action: 'load_collection',
                        collection: details.collection_name,
                        refId: details.ref_id,
                        reasoning: parsed.reasoning
                    });

                    state.phase = PHASES.INVOKE;
                    return PHASES.INVOKE;
                }
                // Missing params - proceed to respond with what we have
                log.debug('SCA REFLECT - LOAD_COLLECTION missing params', { details });
                state.phase = PHASES.RESPOND;
                return PHASES.RESPOND;

            case 'SYNTHESIZE':
                // ═══════════════════════════════════════════════════════════════════════
                // DIRECT SYNTHESIZE: LLM wants to write custom SQL
                // ═══════════════════════════════════════════════════════════════════════
                if (state.synthesize.enabled && state.synthesize.iterations < MAX_SYNTHESIZE_ITERATIONS) {
                    log.debug('SCA REFLECT - direct SYNTHESIZE action', {
                        synthesizeIterations: state.synthesize.iterations,
                        reason: parsed.reasoning
                    });

                    state.reflection.journey.push({
                        action: 'synthesize',
                        reason: 'LLM determined custom SQL needed',
                        diagnosis: parsed.diagnosis
                    });

                    state.phase = PHASES.SYNTHESIZE;
                    return PHASES.SYNTHESIZE;
                }
                // Synthesize exhausted or disabled
                state.phase = PHASES.RESPOND;
                return PHASES.RESPOND;

            case 'BROADEN':
                // Retry with broader parameters
                state.reflection.broadeningAttempts++;

                if (state.reflection.broadeningAttempts > 2) {
                    // Too many broadening attempts - give up
                    log.debug('SCA REFLECT - too many broadening attempts, giving up');
                    state.phase = PHASES.RESPOND;
                    return PHASES.RESPOND;
                }

                // Modify the last tool's args and retry
                if (details.tool && details.modified_params) {
                    // Add the tool with modified params to the queue
                    state.selectedTools.push(details.tool);
                    state.reflection.journey.push({
                        action: 'broaden_retry',
                        tool: details.tool,
                        modifiedParams: details.modified_params
                    });

                    // Store modified params for the next invoke
                    state.broadenedParams = details.modified_params;
                }

                state.phase = PHASES.INVOKE;
                return PHASES.INVOKE;

            case 'DIFFERENT_TOOL':
                // Try a completely different tool
                if (details.tool && Tools.getTool(details.tool)) {
                    const alreadyTried = state.toolInvocations.map(t => t.tool);
                    if (!alreadyTried.includes(details.tool)) {
                        state.selectedTools.push(details.tool);
                        state.reflection.journey.push({
                            action: 'try_different_tool',
                            tool: details.tool,
                            reasoning: parsed.reasoning
                        });

                        state.phase = PHASES.INVOKE;
                        return PHASES.INVOKE;
                    }
                }
                // Tool already tried or invalid - proceed to respond
                state.phase = PHASES.RESPOND;
                return PHASES.RESPOND;

            case 'CLARIFY':
                // We need user clarification - store the question and proceed
                state.reflection.clarificationNeeded = true;
                state.reflection.clarificationQuestion = details.clarification_question;
                state.phase = PHASES.RESPOND;
                return PHASES.RESPOND;

            case 'GIVE_UP':
                // ═══════════════════════════════════════════════════════════════════════
                // SYNTHESIZE FALLBACK: Before giving up, try LLM SQL generation
                // This is the world-class innovation - let LLM write custom queries
                // ═══════════════════════════════════════════════════════════════════════
                if (state.synthesize.enabled && state.synthesize.iterations < MAX_SYNTHESIZE_ITERATIONS) {
                    log.debug('SCA REFLECT - GIVE_UP redirected to SYNTHESIZE', {
                        synthesizeIterations: state.synthesize.iterations,
                        reason: details.explanation
                    });

                    state.reflection.journey.push({
                        action: 'try_synthesize',
                        reason: 'Pre-built tools insufficient, attempting custom SQL',
                        previousExplanation: details.explanation
                    });

                    state.phase = PHASES.SYNTHESIZE;
                    return PHASES.SYNTHESIZE;
                }

                // Synthesize exhausted or disabled - actually give up
                state.reflection.gaveUp = true;
                state.reflection.giveUpExplanation = details.explanation;
                state.phase = PHASES.RESPOND;
                return PHASES.RESPOND;

            default:
                // Unknown action - proceed to respond
                log.audit('SCA REFLECT - unknown action', { action: action });
                state.phase = PHASES.RESPOND;
                return PHASES.RESPOND;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SYNTHESIZE PHASE - LLM Writes Custom SQL
    // World-class innovation: When pre-built tools fail, let LLM write raw SQL
    // Self-correcting: If SQL errors, shows error to LLM and iterates
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Execute SYNTHESIZE phase - LLM generates custom SuiteQL
     * Self-correcting loop: generates SQL, executes, if error shows error and retries
     */
    function executeSynthesizePhase(state) {
        const phaseStart = Date.now();
        state.synthesize.iterations++;

        log.debug('SCA SYNTHESIZE phase starting', {
            requestId: state.requestId,
            iteration: state.synthesize.iterations,
            hasLastError: !!state.synthesize.lastError
        });

        // Check iteration limit
        if (state.synthesize.iterations > MAX_SYNTHESIZE_ITERATIONS) {
            log.audit('SCA SYNTHESIZE - max iterations reached', {
                iterations: state.synthesize.iterations
            });
            state.synthesize.enabled = false;
            state.reflection.gaveUp = true;
            state.reflection.giveUpExplanation = 'Unable to generate a working query after multiple attempts.';
            state.phase = PHASES.RESPOND;
            return { success: true, nextPhase: PHASES.RESPOND };
        }

        // Build context from previous tool attempts
        const previousContext = buildSynthesizeContext(state);

        // Build error context if this is a retry
        const errorContext = state.synthesize.lastError ?
            `PREVIOUS QUERY FAILED:\n\`\`\`sql\n${state.synthesize.queries[state.synthesize.queries.length - 1]?.sql || 'N/A'}\n\`\`\`\n\nERROR: ${state.synthesize.lastError}\n\nFix the error and try again. Common fixes:\n- Use ROWNUM for row limits: SELECT * FROM (your_query ORDER BY ...) WHERE ROWNUM <= N\n- Check column names against the schema\n- Use BUILTIN.DF() for display names\n- Verify table joins are correct` :
            '';

        const prompt = SYNTHESIZE_PROMPT
            .replace('{history_context}', buildHistoryContext(state))
            .replace('{question}', state.message)
            .replace('{previous_context}', previousContext)
            .replace('{error_context}', errorContext);

        // Add thinking step
        upsertThinkingStep(state, 'synthesize', {
            title: state.synthesize.iterations === 1 ? 'Writing custom query' : 'Fixing query',
            phase: 'synthesize',
            status: 'active',
            context: {
                iteration: state.synthesize.iterations,
                isRetry: state.synthesize.iterations > 1,
                lastError: state.synthesize.lastError?.substring(0, 100)
            }
        });

        try {
            // Call LLM to generate SQL (PREMIUM tier for complex SQL synthesis)
            const response = AIProviders.callAI(prompt, {
                tier: getTierForPhase('synthesize', state),
                temperature: 0.2,
                jsonMode: true,
                purpose: 'SCA:synthesize'
            });

            const parsed = parseJsonResponse(response?.text);

            if (!parsed || !parsed.query) {
                throw new Error('Invalid synthesize response - missing query');
            }

            const generatedSql = parsed.query;
            const purpose = parsed.purpose || 'Custom query';

            log.debug('SCA SYNTHESIZE - generated SQL', {
                sqlPreview: generatedSql.substring(0, 300),
                purpose: purpose,
                reasoning: parsed.reasoning?.substring(0, 200)
            });

            // Record the query attempt
            state.synthesize.queries.push({
                sql: generatedSql,
                purpose: purpose,
                reasoning: parsed.reasoning,
                timestamp: Date.now()
            });

            // Add tool call step for the custom query
            addToolCallStep(state, {
                title: `Running: ${purpose}`,
                tool: 'synthesized_query',
                status: 'active'
            });

            // Execute the SQL using QueryExecutor (imported via Tools)
            const queryResult = Tools.executeTool('run_custom_query', {
                sql: generatedSql,
                purpose: purpose
            });

            const queryDuration = Date.now() - phaseStart;

            if (!queryResult.success) {
                // SQL execution failed - store error and retry
                const errorMsg = queryResult.error || 'Query execution failed';
                state.synthesize.lastError = errorMsg;
                state.synthesize.queries[state.synthesize.queries.length - 1].error = errorMsg;

                log.debug('SCA SYNTHESIZE - query failed, will retry', {
                    error: errorMsg,
                    iteration: state.synthesize.iterations
                });

                // Update tool call step with error
                addToolCallStep(state, {
                    title: `Query failed: ${purpose}`,
                    tool: 'synthesized_query',
                    status: 'complete',
                    update: true,
                    success: false,
                    error: errorMsg,
                    duration: queryDuration
                });

                // ═══════════════════════════════════════════════════════════════════════
                // AGENTIC FIX: Detect schema errors and route to REASON_ACT for discovery
                // Instead of blindly retrying, let the agent use get_record_schema
                // ═══════════════════════════════════════════════════════════════════════
                const isSchemaError = /field\s+['"]?(\w+)['"]?\s+(for record\s+['"]?(\w+)['"]?\s+)?was not found/i.test(errorMsg) ||
                                      /column\s+['"]?(\w+)['"]?\s+not found/i.test(errorMsg) ||
                                      /invalid.*column/i.test(errorMsg);

                if (isSchemaError) {
                    // Extract table name from error if possible
                    const tableMatch = errorMsg.match(/for record\s+['"]?(\w+)['"]?/i) ||
                                       errorMsg.match(/table\s+['"]?(\w+)['"]?/i);
                    const tableName = tableMatch ? tableMatch[1].toLowerCase() : 'unknown';

                    log.debug('SCA SYNTHESIZE - schema error detected, routing to REASON_ACT for discovery', {
                        tableName: tableName,
                        error: errorMsg
                    });

                    // Store hint for REASON_ACT to use schema discovery
                    state.synthesize.schemaDiscoveryNeeded = {
                        tableName: tableName,
                        error: errorMsg,
                        hint: `Schema error detected. Use get_record_schema({ record_type: "${tableName}" }) to discover valid field names for this table, then retry with correct fields.`
                    };

                    // Add to journey for visibility
                    state.reflection.journey.push({
                        action: 'schema_error_detected',
                        tableName: tableName,
                        error: errorMsg,
                        recommendation: 'Use get_record_schema to discover valid fields'
                    });

                    // Route to REASON_ACT instead of blind retry
                    state.phase = PHASES.REASON_ACT;
                    return { success: true, nextPhase: PHASES.REASON_ACT };
                }

                // Loop back to synthesize (self-correction) for non-schema errors
                state.phase = PHASES.SYNTHESIZE;
                return { success: true, nextPhase: PHASES.SYNTHESIZE };
            }

            // Success! Store the data
            state.synthesize.lastError = null;
            state.synthesize.queries[state.synthesize.queries.length - 1].success = true;
            state.synthesize.queries[state.synthesize.queries.length - 1].rowCount = queryResult.rowCount;

            // Store data reference if we got rows
            if (queryResult.rows && queryResult.rows.length > 0) {
                const dataRef = Cache.storeData(state.requestId, 'synthesized_query', queryResult);
                state.dataReferences.push(dataRef);
                state.reflection.dataFound = true;

                // ═══════════════════════════════════════════════════════════════════════
                // FIX: Record SYNTHESIZE as a tool invocation so REFLECT sees it
                // Without this, buildToolSummaryForReflection() returns "No tools executed"
                // even when SYNTHESIZE successfully found data
                // ═══════════════════════════════════════════════════════════════════════
                state.toolInvocations.push({
                    tool: 'synthesized_query',
                    args: {
                        sql: generatedSql.substring(0, 200) + (generatedSql.length > 200 ? '...' : ''),
                        purpose: purpose
                    },
                    success: true,
                    rowCount: queryResult.rowCount,
                    failed: false,
                    resultClass: 'DATA',
                    synthesized: true,  // Flag to indicate this came from SYNTHESIZE phase
                    columns: queryResult.columns
                });

                state.reflection.journey.push({
                    action: 'synthesize_success',
                    purpose: purpose,
                    rowCount: queryResult.rowCount,
                    iterations: state.synthesize.iterations
                });
            }

            // Update tool call step with success
            addToolCallStep(state, {
                title: purpose,
                tool: 'synthesized_query',
                status: 'complete',
                update: true,
                success: true,
                rowCount: queryResult.rowCount,
                columns: queryResult.columns?.slice(0, 8),
                duration: queryDuration,
                summary: `Found ${queryResult.rowCount} results`
            });

            // Update thinking step
            upsertThinkingStep(state, 'synthesize', {
                title: 'Custom query succeeded',
                phase: 'synthesize',
                status: 'complete',
                duration: queryDuration,
                context: {
                    iteration: state.synthesize.iterations,
                    rowCount: queryResult.rowCount,
                    purpose: purpose
                },
                debug: {
                    sqlPreview: generatedSql.substring(0, 500),
                    reasoning: parsed.reasoning,
                    columns: queryResult.columns
                }
            });

            log.debug('SCA SYNTHESIZE - success', {
                rowCount: queryResult.rowCount,
                iterations: state.synthesize.iterations,
                duration: queryDuration
            });

            // ═══════════════════════════════════════════════════════════════════════
            // AGENTIC ITERATION: Route back to REFLECT instead of directly to RESPOND
            // This allows REFLECT to evaluate:
            // - Does this SQL result actually answer the question?
            // - Should we run another query to get more/different data?
            // - Is the data complete or do we need to join more tables?
            // ═══════════════════════════════════════════════════════════════════════
            state.phase = PHASES.REFLECT;
            return { success: true, nextPhase: PHASES.REFLECT };

        } catch (e) {
            const duration = Date.now() - phaseStart;
            log.error('SCA SYNTHESIZE phase error', { error: e.message, duration: duration });
            state.errors.push({ phase: 'synthesize', error: e.message, timestamp: Date.now() });

            // If we haven't exhausted iterations, try again
            if (state.synthesize.iterations < MAX_SYNTHESIZE_ITERATIONS) {
                state.synthesize.lastError = e.message;
                state.phase = PHASES.SYNTHESIZE;
                return { success: true, nextPhase: PHASES.SYNTHESIZE };
            }

            // Exhausted - give up
            state.synthesize.enabled = false;
            state.reflection.gaveUp = true;
            state.reflection.giveUpExplanation = `Unable to generate a working query: ${e.message}`;
            state.phase = PHASES.RESPOND;

            upsertThinkingStep(state, 'synthesize', {
                title: 'Query generation failed',
                phase: 'synthesize',
                status: 'complete',
                duration: duration,
                context: {
                    error: e.message.substring(0, 100),
                    iterations: state.synthesize.iterations
                }
            });

            return { success: true, nextPhase: PHASES.RESPOND };
        }
    }

    /**
     * Build context for SYNTHESIZE prompt from previous tool attempts
     * Shows the LLM what SQL was tried (so it can build on it)
     */
    function buildSynthesizeContext(state) {
        const lines = [];

        // Show what tools were tried and their results
        if (state.toolInvocations.length > 0) {
            lines.push('TOOLS THAT WERE TRIED:');
            state.toolInvocations.forEach((inv, idx) => {
                const status = inv.success ? (inv.rowCount > 0 ? 'SUCCESS' : 'NO DATA') : 'FAILED';
                lines.push(`${idx + 1}. ${inv.tool}: ${status} (${inv.rowCount || 0} rows)`);
                if (inv.args) {
                    lines.push(`   Args: ${JSON.stringify(inv.args)}`);
                }
            });
            lines.push('');
        }

        // Show resolved entities
        if (Object.keys(state.resolvedEntities).length > 0) {
            lines.push('RESOLVED ENTITIES:');
            Object.entries(state.resolvedEntities).forEach(([term, entity]) => {
                lines.push(`- "${term}" = ${entity.name} (${entity.type}, ID: ${entity.id})`);
            });
            lines.push('');
        }

        // Show existing data summaries if any
        if (state.dataReferences.length > 0) {
            lines.push('DATA ALREADY COLLECTED:');
            state.dataReferences.forEach(ref => {
                const summary = ref.summary || {};
                lines.push(`- ${summary.tool || 'Query'}: ${summary.rowCount || 0} rows`);
                if (summary.columns) {
                    lines.push(`  Columns: ${summary.columns.join(', ')}`);
                }
            });
            lines.push('');
        }

        // Show previous synthesize attempts
        if (state.synthesize.queries.length > 0) {
            lines.push('PREVIOUS CUSTOM QUERY ATTEMPTS:');
            state.synthesize.queries.forEach((q, idx) => {
                const status = q.success ? `SUCCESS (${q.rowCount} rows)` : `FAILED: ${q.error}`;
                lines.push(`Attempt ${idx + 1}: ${status}`);
                lines.push(`SQL: ${q.sql.substring(0, 200)}...`);
            });
            lines.push('');
        }

        return lines.join('\n') || 'No previous attempts.';
    }

    /**
     * Build tool execution summary for REFLECT prompt
     *
     * FIX: Also checks state.synthesize.queries as defense-in-depth
     * In case SYNTHESIZE succeeds but toolInvocations wasn't updated
     */
    function buildToolSummaryForReflection(state) {
        // ═══════════════════════════════════════════════════════════════════════
        // FIX: Check for successful SYNTHESIZE queries even if toolInvocations is empty
        // This is defense-in-depth - SYNTHESIZE should add to toolInvocations,
        // but if it doesn't, we still want REFLECT to know about the data
        // ═══════════════════════════════════════════════════════════════════════
        const successfulSynthQueries = (state.synthesize?.queries || [])
            .filter(q => q.success);

        if (state.toolInvocations.length === 0 && successfulSynthQueries.length === 0) {
            return 'No tools were executed.';
        }

        let summaryParts = [];

        // Add regular tool invocations
        if (state.toolInvocations.length > 0) {
            const toolSummary = state.toolInvocations.map((inv, idx) => {
                const status = inv.failed ? 'FAILED' : (inv.rowCount > 0 ? 'SUCCESS' : 'NO_DATA');
                const details = [];

                if (inv.args) {
                    const argStr = Object.entries(inv.args)
                        .filter(([k, v]) => v !== undefined && v !== null)
                        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                        .join(', ');
                    if (argStr) details.push(`Args: ${argStr}`);
                }

                if (inv.resultClass) {
                    details.push(`Classification: ${inv.resultClass}`);
                }

                if (inv.error) {
                    details.push(`Error: ${inv.error}`);
                }

                // Flag synthesized queries
                if (inv.synthesized) {
                    details.push('Source: SYNTHESIZE phase (custom SQL)');
                }

                return `${idx + 1}. ${inv.tool}: ${status} (${inv.rowCount || 0} rows)\n   ${details.join('\n   ')}`;
            }).join('\n\n');

            summaryParts.push(toolSummary);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX: Add SYNTHESIZE queries that may not be in toolInvocations
        // This catches edge cases where SYNTHESIZE succeeded but wasn't recorded
        // ═══════════════════════════════════════════════════════════════════════
        if (successfulSynthQueries.length > 0) {
            // Check if these are already in toolInvocations (avoid duplicates)
            const alreadyRecorded = state.toolInvocations.some(inv => inv.synthesized);

            if (!alreadyRecorded) {
                let synthSummary = '\n═══ CUSTOM SQL QUERIES (SYNTHESIZE) ═══\n';
                successfulSynthQueries.forEach((q, idx) => {
                    synthSummary += `${idx + 1}. synthesized_query: SUCCESS (${q.rowCount || 0} rows)\n`;
                    synthSummary += `   Purpose: ${q.purpose || 'Custom query'}\n`;
                    synthSummary += `   SQL: ${(q.sql || '').substring(0, 150)}${(q.sql || '').length > 150 ? '...' : ''}\n`;
                });
                summaryParts.push(synthSummary);
            }
        }

        return summaryParts.join('\n') || 'No tools were executed.';
    }

    /**
     * Build resolved entities summary for REFLECT prompt
     */
    function buildResolvedEntitiesForReflection(state) {
        const entries = Object.entries(state.resolvedEntities);
        if (entries.length === 0) {
            if (state.reflection.entityFound === false) {
                return 'Entity resolution was attempted but NO MATCHES were found.';
            }
            return 'No entities were resolved.';
        }

        return entries.map(([term, entity]) =>
            `"${term}" → ${entity.name} (${entity.type}, ID: ${entity.id})`
        ).join('\n');
    }

    /**
     * Build data summary for REFLECT prompt
     * AGENTIC STRUCTURAL AWARENESS: Shows categorical distributions, not just sample rows
     */
    function buildDataSummaryForReflection(state) {
        if (state.dataReferences.length === 0) {
            return 'NO DATA was collected. All queries returned 0 rows.';
        }

        const sections = [];

        state.dataReferences.forEach((ref, idx) => {
            const summary = ref.summary || {};
            const toolName = summary.tool || 'Unknown';

            let section = `\n═══ DATA SOURCE ${idx + 1}: ${toolName} ═══\n`;
            section += `RefId: ${ref.refId}\n`;
            section += `Rows: ${summary.rowCount || 0}\n`;

            if (summary.columns && summary.columns.length > 0) {
                section += `Columns: ${summary.columns.join(', ')}\n`;
            }

            // ═══════════════════════════════════════════════════════════════════════
            // STRUCTURAL AWARENESS: Show categorical column distributions
            // This is the KEY feature - LLM sees ALL categories that exist in data
            // ═══════════════════════════════════════════════════════════════════════
            if (summary.categoricalColumns && summary.categoricalColumns.length > 0) {
                section += `\n*** DATA STRUCTURE (categorical columns with distributions) ***\n`;

                summary.categoricalColumns.forEach(catCol => {
                    section += `\n  ${catCol.column} (${catCol.uniqueCount} unique values):\n`;

                    // Show distribution with counts and sums
                    catCol.distribution.forEach(item => {
                        let line = `    • ${item.value}: ${item.count} rows`;
                        if (item.sumFormatted && catCol.sumColumn) {
                            line += `, ${catCol.sumColumn}_total: ${item.sumFormatted}`;
                        }
                        section += line + '\n';
                    });
                });

                // Show drill-down hint
                section += `\n  → To filter: load_cached_data(ref_id="${ref.refId}", filter={"column": "value"})\n`;
                section += `  → To aggregate: load_cached_data(ref_id="${ref.refId}", group_by="column", aggregate_column="amount", aggregate_op="sum")\n`;
            }

            // ═══════════════════════════════════════════════════════════════════════
            // NUMERIC COLUMN STATS: Show computed statistics
            // ═══════════════════════════════════════════════════════════════════════
            if (summary.schema) {
                const numericCols = Object.entries(summary.schema)
                    .filter(([_, schema]) => schema.stats)
                    .slice(0, 3); // Limit to top 3 numeric columns

                if (numericCols.length > 0) {
                    section += `\n*** NUMERIC COLUMN STATS ***\n`;
                    numericCols.forEach(([colName, schema]) => {
                        const s = schema.stats;
                        section += `  ${colName}: sum=${formatNumberForSummary(s.sum)}, avg=${formatNumberForSummary(s.avg)}, range=[${formatNumberForSummary(s.min)} to ${formatNumberForSummary(s.max)}]\n`;
                    });
                }
            }

            // ═══════════════════════════════════════════════════════════════════════
            // STRATIFIED SAMPLE: Show representative rows from each category
            // Better than "first 3 rows" which can miss entire categories
            // ═══════════════════════════════════════════════════════════════════════
            if (summary.stratifiedSample && summary.stratifiedSample.length > 0) {
                section += `\n*** REPRESENTATIVE SAMPLE (1 per ${summary.stratifiedBy}) ***\n`;
                summary.stratifiedSample.forEach(sample => {
                    const parts = [`${summary.stratifiedBy}=${sample.category}`];
                    if (sample.name) parts.push(`name="${sample.name}"`);
                    if (sample.value !== undefined) parts.push(`${sample.valueColumn}=${typeof sample.value === 'number' ? sample.value.toLocaleString() : sample.value}`);
                    section += `  • ${parts.join(', ')}\n`;
                });
            } else {
                // Fallback to traditional sample if no stratified sample
                const data = Cache.loadRows(ref.requestId || state.requestId, ref.refId, 0, 5);
                if (data && data.rows && data.rows.length > 0) {
                    section += `\nSample data (first ${Math.min(3, data.rows.length)} rows):\n`;
                    const sampleRows = data.rows.slice(0, 3);
                    const displayCols = (data.columns || Object.keys(sampleRows[0] || {})).slice(0, 5);
                    sampleRows.forEach((row, i) => {
                        const values = displayCols.map(col => {
                            const val = row[col];
                            if (val === null || val === undefined) return 'null';
                            if (typeof val === 'number') return val.toLocaleString();
                            return String(val).substring(0, 30);
                        });
                        section += `  Row ${i}: ${displayCols.map((c, j) => `${c}=${values[j]}`).join(', ')}\n`;
                    });
                }
            }

            // ═══════════════════════════════════════════════════════════════════════
            // DASHBOARD COLLECTIONS: Critical for agentic data loading
            // If this is a dashboard, show available collections that can be loaded
            // ═══════════════════════════════════════════════════════════════════════
            const data = Cache.loadRows(ref.requestId || state.requestId, ref.refId, 0, 1);
            if (data && data.isDashboard && data.intelligence) {
                const collections = data.intelligence.collections || {};
                const collectionNames = Object.keys(collections);

                if (collectionNames.length > 0) {
                    section += `\n⚠️ AVAILABLE COLLECTIONS (can load with load_cached_data tool):\n`;
                    collectionNames.forEach(colName => {
                        const col = collections[colName];
                        const count = col.count || col.items?.length || 0;
                        const colColumns = col.columns || [];
                        section += `  • ${colName}: ${count} items\n`;
                        if (colColumns.length > 0) {
                            section += `    Columns: ${colColumns.slice(0, 5).join(', ')}${colColumns.length > 5 ? '...' : ''}\n`;
                        }
                        if (col.refId) {
                            section += `    Load with: load_cached_data(ref_id="${ref.refId}", collection_name="${colName}")\n`;
                        }
                    });
                }

                // Show dashboard metrics summary
                const metrics = data.intelligence.metrics || {};
                const metricNames = Object.keys(metrics);
                if (metricNames.length > 0) {
                    section += `\nDashboard Metrics (summary-level): ${metricNames.join(', ')}\n`;
                }
            }

            sections.push(section);
        });

        return sections.join('\n');
    }

    /**
     * Format number for data summary display
     */
    function formatNumberForSummary(num) {
        if (num === null || num === undefined || isNaN(num)) return 'N/A';
        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';
        if (absNum >= 1000000000) return sign + '$' + (absNum / 1000000000).toFixed(1) + 'B';
        if (absNum >= 1000000) return sign + '$' + (absNum / 1000000).toFixed(1) + 'M';
        if (absNum >= 1000) return sign + '$' + (absNum / 1000).toFixed(1) + 'K';
        return sign + '$' + absNum.toFixed(0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LLM-DRIVEN TOOL RECOVERY
    // When tools fail, ask LLM for intelligent alternatives
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Use LLM to suggest alternative tools when one fails
     * This replaces the static getAlternativeTools() lookup for smarter recovery
     */
    function getLLMSuggestedAlternative(toolName, error, state) {
        const alreadyTried = state.toolInvocations.map(t => t.tool).join(', ') || 'none';

        const prompt = RECOVERY_PROMPT
            .replace('{question}', state.message)
            .replace('{failed_tool}', toolName)
            .replace('{error}', error)
            .replace('{tool_list}', Tools.getToolListForPrompt())
            .replace('{already_tried}', alreadyTried);

        try {
            const response = AIProviders.callAI(prompt, {
                tier: getTierForPhase('recovery', state),
                temperature: 0.2,
                jsonMode: true,
                purpose: 'SCA:recovery'
            });

            const parsed = parseJsonResponse(response?.text);

            if (parsed && parsed.alternative_tool && parsed.suggestion !== 'GIVE_UP') {
                // Verify the tool exists
                if (Tools.getTool(parsed.alternative_tool)) {
                    log.debug('SCA LLM-suggested recovery tool', {
                        failed: toolName,
                        suggested: parsed.alternative_tool,
                        reasoning: parsed.reasoning
                    });
                    return {
                        tool: parsed.alternative_tool,
                        reasoning: parsed.reasoning
                    };
                }
            }

            return null;
        } catch (e) {
            log.debug('SCA LLM recovery failed, falling back to static alternatives', { error: e.message });
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WORLD-CLASS RESPOND PHASE - LLM as Data Analyst
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Phase 4: RESPOND - Single merged phase with FULL DATA ACCESS
     * LLM sees actual data rows and uses {{token}} syntax for guaranteed accuracy
     * Now enhanced with context from REFLECT phase
     */
    function executeRespondPhase(state) {
        const phaseStart = Date.now();

        // ═══════════════════════════════════════════════════════════════════════
        // CONVERSATIONAL HANDLING - Greetings, chitchat, general questions
        // When intent is 'general', provide a friendly conversational response
        // ═══════════════════════════════════════════════════════════════════════
        if (state.intent && state.intent.intent === 'general') {
            const conversationalResponse = generateConversationalResponse(state);
            const duration = Date.now() - phaseStart;

            state.formattedResponse = {
                title: 'Response',
                summary: conversationalResponse.substring(0, 100),
                blocks: [{
                    type: 'text',
                    content: conversationalResponse
                }]
            };
            state.phase = PHASES.COMPLETE;

            upsertThinkingStep(state, 'respond', {
                title: 'Generating response',
                phase: 'respond',
                status: 'complete',
                duration: duration,
                context: {
                    phase: 'respond',
                    conversational: true
                }
            });

            return { success: true, nextPhase: PHASES.COMPLETE };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // CLARIFICATION HANDLING - When REASON_ACT needs user input
        // ═══════════════════════════════════════════════════════════════════════
        if (state.clarificationNeeded) {
            const duration = Date.now() - phaseStart;

            state.formattedResponse = {
                title: 'Clarification Needed',
                summary: state.clarificationNeeded,
                blocks: [{
                    type: 'text',
                    content: state.clarificationNeeded
                }]
            };
            state.phase = PHASES.COMPLETE;

            upsertThinkingStep(state, 'respond', {
                title: 'Need more information',
                phase: 'respond',
                status: 'complete',
                duration: duration,
                context: {
                    phase: 'respond',
                    clarification: true
                }
            });

            return { success: true, nextPhase: PHASES.COMPLETE };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // COMBINED REFLECT+RESPOND MODE
        // If REFLECT phase already generated response blocks, use them directly
        // This saves an entire LLM round trip
        // ═══════════════════════════════════════════════════════════════════════
        if (state.reflectResponse && state.reflectResponse.blocks) {
            log.debug('SCA RESPOND - using combined mode response from REFLECT', {
                blockCount: state.reflectResponse.blocks.length
            });

            const resolved = resolveBlockSequence(state.reflectResponse.blocks, state);
            const duration = Date.now() - phaseStart;

            if (resolved && resolved.length > 0) {
                const firstTextBlock = resolved.find(b => b.type === 'text');
                const summary = firstTextBlock?.content?.substring(0, 150) || '';

                state.formattedResponse = {
                    title: 'Analysis Results',
                    summary: summary,
                    blocks: resolved
                };
                state.phase = PHASES.COMPLETE;

                upsertThinkingStep(state, 'respond', {
                    title: 'Generating response',
                    phase: 'respond',
                    status: 'complete',
                    duration: duration,
                    context: {
                        combinedMode: true,
                        blockCount: resolved.length,
                        tokensResolved: true
                    }
                });

                log.debug('SCA RESPOND phase complete (combined mode)', { duration, blockCount: resolved.length });
                return { success: true, nextPhase: PHASES.COMPLETE };
            }
            // If resolution failed, fall through to normal RESPOND
            log.debug('SCA RESPOND - combined mode resolution failed, falling back to normal flow');
        }

        // ═══════════════════════════════════════════════════════════════════════
        // HANDLE REFLECTION OUTCOMES
        // Use context from REFLECT phase to provide intelligent responses
        // ═══════════════════════════════════════════════════════════════════════

        // Check if clarification is needed
        if (state.reflection.clarificationNeeded) {
            state.formattedResponse = {
                title: 'Clarification Needed',
                summary: 'I need more information to answer your question',
                blocks: [{
                    type: 'text',
                    content: state.reflection.clarificationQuestion ||
                        "I found multiple possible interpretations of your question. Could you provide more details?"
                }]
            };
            state.phase = PHASES.COMPLETE;
            return { success: true, nextPhase: PHASES.COMPLETE };
        }

        // Check if we gave up
        if (state.reflection.gaveUp) {
            const explanation = state.reflection.giveUpExplanation ||
                "I wasn't able to find the data needed to answer your question.";

            // Build a helpful journey summary
            const journeySummary = buildJourneySummary(state);

            state.formattedResponse = {
                title: 'Unable to Answer',
                summary: explanation.substring(0, 100),
                blocks: [
                    { type: 'text', content: explanation },
                    ...(journeySummary ? [{
                        type: 'list',
                        title: 'What I Tried',
                        items: journeySummary
                    }] : [])
                ]
            };
            state.phase = PHASES.COMPLETE;
            return { success: true, nextPhase: PHASES.COMPLETE };
        }

        // Check if we have any data
        if (state.dataReferences.length === 0) {
            // No data - provide intelligent fallback based on failure mode
            const failureResponse = buildFailureModeResponse(state);

            state.formattedResponse = {
                title: failureResponse.title,
                summary: failureResponse.summary,
                blocks: failureResponse.blocks
            };
            state.phase = PHASES.COMPLETE;

            upsertThinkingStep(state, 'respond', {
                title: 'Generating response',
                phase: 'respond',
                status: 'complete',
                context: {
                    noData: true,
                    failureMode: state.reflection.failureMode
                }
            });

            return { success: true, nextPhase: PHASES.COMPLETE };
        }

        // Build data sections with ACTUAL ROWS for the prompt
        const dataSections = buildDataSectionsForPrompt(state);

        // ═══════════════════════════════════════════════════════════════════════
        // MARKDOWN DIRECTIVE ARCHITECTURE (MDA)
        // LLM writes natural markdown with :::directives
        // Code parses directives and builds rich blocks - BLAZING FAST
        // ═══════════════════════════════════════════════════════════════════════

        // Build constraints section from INTENT phase
        const constraintsSection = buildConstraintsSection(state);

        const prompt = MDA_RESPOND_PROMPT
            .replace('{history_context}', buildHistoryContext(state))
            .replace('{question}', state.message)
            .replace('{data_sections}', dataSections)
            .replace('{constraints_section}', constraintsSection);

        // Update thinking step
        upsertThinkingStep(state, 'respond', {
            title: 'Generating response',
            phase: 'respond',
            status: 'active',
            context: {
                dataRefs: state.dataReferences.length,
                phase: 'respond',
                architecture: 'MDA'
            }
        });

        // ═══════════════════════════════════════════════════════════════════════
        // MDA LLM CALL - Single fast call, no JSON mode needed
        // Markdown is natural for LLMs - generates 5-10x faster than complex JSON
        // ═══════════════════════════════════════════════════════════════════════
        let lastError = null;
        let parsedBlocks = null;
        let resolved = null;
        let rawMarkdown = null;

        try {
            const response = AIProviders.callAI(prompt, {
                tier: getTierForPhase('respond', state),
                temperature: 0.4,
                purpose: 'SCA:respond:MDA'
            });

            rawMarkdown = response?.text || '';

            log.debug('MDA: received markdown response', {
                length: rawMarkdown.length,
                preview: rawMarkdown.substring(0, 200)
            });

            // Parse markdown with directives into blocks
            parsedBlocks = parseMarkdownDirectives(rawMarkdown, state);

            if (!parsedBlocks || parsedBlocks.length === 0) {
                // If no blocks parsed, treat entire response as text block
                if (rawMarkdown.trim()) {
                    parsedBlocks = [{ type: 'text', content: rawMarkdown.trim() }];
                } else {
                    throw new Error('MDA: empty response from LLM');
                }
            }

            // Resolve blocks - builds tables/charts from dataRefs, resolves {{tokens}}
            resolved = resolveBlockSequence(parsedBlocks, state);

            if (!resolved || resolved.length === 0) {
                throw new Error('MDA: no blocks resolved');
            }

            log.debug('MDA: successfully parsed and resolved blocks', {
                parsedCount: parsedBlocks.length,
                resolvedCount: resolved.length,
                blockTypes: resolved.map(b => b.type).join(',')
            });

        } catch (e) {
            lastError = e;
            log.error('MDA RESPOND failed', {
                error: e.message,
                rawLength: rawMarkdown?.length
            });
        }

        const duration = Date.now() - phaseStart;
        state.phaseTimings.respond = duration;

        // ═══════════════════════════════════════════════════════════════════════
        // MDA SUCCESS - Blocks parsed and resolved successfully
        // ═══════════════════════════════════════════════════════════════════════
        if (resolved && resolved.length > 0) {
            // Extract summary from first text block
            const firstTextBlock = resolved.find(b => b.type === 'text');
            const summary = firstTextBlock?.content?.substring(0, 150) || '';

            // Build formatted response using resolved blocks directly
            state.formattedResponse = {
                title: 'Analysis Results',
                summary: summary,
                blocks: resolved
            };

            state.phase = PHASES.COMPLETE;

            upsertThinkingStep(state, 'respond', {
                title: 'Generating response',
                phase: 'respond',
                status: 'complete',
                duration: duration,
                context: {
                    architecture: 'MDA',
                    blockCount: resolved.length,
                    tokensResolved: true,
                    hasCharts: resolved.some(b => b.type === 'chart'),
                    hasTables: resolved.some(b => b.type === 'table')
                },
                debug: buildDebugInfo(prompt, null, state, {
                    architecture: 'MDA',
                    blockCount: resolved.length,
                    blockTypes: resolved.map(b => b.type).join(',')
                })
            });

            log.debug('MDA Respond phase complete', { duration: duration, blockCount: resolved.length });
            return { success: true, nextPhase: PHASES.COMPLETE };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // MDA FALLBACK - If parsing failed, build tables directly from dataRefs
        // This ensures users always see their data even if LLM output is malformed
        // ═══════════════════════════════════════════════════════════════════════
        log.error('MDA Respond phase failed', { error: lastError?.message, duration: duration });
        state.errors.push({ phase: 'respond', error: lastError?.message || 'MDA parse failed', timestamp: Date.now() });

        // Build fallback with actual data tables (not just "X results found")
        const fallbackBlocks = buildMDAFallbackBlocks(state);
        state.formattedResponse = {
            title: 'Analysis Results',
            summary: 'Here is the data from your query.',
            blocks: fallbackBlocks
        };
        state.phase = PHASES.COMPLETE;

        upsertThinkingStep(state, 'respond', {
            title: 'Generating response',
            phase: 'respond',
            status: 'complete',
            duration: duration,
            context: {
                architecture: 'MDA',
                fallback: true,
                error: (lastError?.message || 'MDA parse failed').substring(0, 100)
            }
        });

        return { success: true, nextPhase: PHASES.COMPLETE };
    }

    /**
     * Build fallback blocks with actual data tables when MDA parsing fails
     * Ensures users always see their data even if LLM output is malformed
     * @param {Object} state - Current state with dataReferences
     * @returns {Array} Array of table blocks
     */
    function buildMDAFallbackBlocks(state) {
        const blocks = [];

        // Add intro text
        blocks.push({
            type: 'text',
            content: 'Here is the data from your query:'
        });

        // Build table blocks for each data reference
        state.dataReferences.forEach(ref => {
            const tableBlock = buildTableBlockFromRef({ dataRef: ref.refId }, state);
            if (tableBlock) {
                blocks.push(tableBlock);
            }
        });

        // If no tables could be built, add a simple text summary
        if (blocks.length === 1) {
            const fallbackNarrative = buildFallbackNarrative(state);
            blocks.push({ type: 'text', content: fallbackNarrative });
        }

        return blocks;
    }

    /**
     * Build data sections with ACTUAL ROWS for the RESPOND prompt
     * This gives LLM full visibility into the data
     * Enhanced with Dashboard Intelligence Bridge support
     */
    function buildDataSectionsForPrompt(state) {
        const sections = [];

        state.dataReferences.forEach((ref, idx) => {
            const summary = ref.summary || {};
            const toolName = getToolDisplayName(summary.tool) || 'Data';

            // Load actual rows from DataStore
            // Use ref.requestId for follow-up queries (data stored under original request)
            const data = Cache.loadRows(ref.requestId || state.requestId, ref.refId, 0, 49); // Up to 50 rows
            if (!data || !data.rows) return;

            // ═══════════════════════════════════════════════════════════════════════
            // DASHBOARD INTELLIGENCE BRIDGE: Use rich text summary for dashboards
            // This provides LLM with formatted metrics, insights, and collection info
            // ═══════════════════════════════════════════════════════════════════════
            if (data.isDashboard && data.textSummary) {
                let section = `═══ DASHBOARD INTELLIGENCE: ${data.dashboardName || toolName} [dataRef: "${ref.refId}"] ═══\n\n`;
                section += data.textSummary;

                // Add token reference guide for dashboard metrics
                section += `\n\nTOKEN REFERENCE GUIDE FOR DASHBOARD DATA:\n`;
                section += `  Metrics: {{data.rows[N].formatted_value}} (use the formatted_value column)\n`;
                section += `  Row structure: metric_name, value, formatted_value, description, type, status, trend, change\n`;

                // List available metrics for easy reference
                const metricRows = data.rows.filter(r => r.type !== 'collection');
                if (metricRows.length > 0) {
                    section += `\n  AVAILABLE METRICS:\n`;
                    metricRows.forEach((row, i) => {
                        section += `    Row ${i}: ${row.metric_name} = ${row.formatted_value}\n`;
                    });
                }

                // List collections for drill-down reference
                const collectionRows = data.rows.filter(r => r.type === 'collection');
                if (collectionRows.length > 0) {
                    section += `\n  AVAILABLE COLLECTIONS (for drill-down queries):\n`;
                    collectionRows.forEach(row => {
                        section += `    ${row.metric_name}: ${row.value} items\n`;
                    });
                }

                sections.push(section);
                return; // Skip standard row processing for dashboards
            }

            // ═══════════════════════════════════════════════════════════════════════
            // STANDARD DATA PROCESSING (non-dashboard tools)
            // ═══════════════════════════════════════════════════════════════════════
            const totalRows = data.range?.total || data.rows.length;
            let section = `═══ DATA: ${toolName} (${totalRows} total rows) [dataRef: "${ref.refId}"] ═══\n`;
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

            // ═══════════════════════════════════════════════════════════════════════
            // CATEGORY INTELLIGENCE: Show breakdown by categorical columns
            // This prevents LLM from confusing total sum with specific categories
            // (e.g., knowing Revenue=$16.7M vs total of all rows=$31.9M)
            // ═══════════════════════════════════════════════════════════════════════
            if (summary.categoricalColumns && summary.categoricalColumns.length > 0) {
                section += `CATEGORY BREAKDOWN:\n`;
                summary.categoricalColumns.forEach(catCol => {
                    section += `  By ${catCol.column}:\n`;
                    catCol.distribution.forEach(item => {
                        const sumStr = item.sumFormatted || formatStatValue(item.sum, 'currency');
                        section += `    • ${item.value}: ${sumStr} (${item.count} rows)\n`;
                    });
                });
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
                        if (isMonetaryColumn(col)) {
                            // FIXED: Format negative currency correctly as -$X not $-X
                            const isNegative = val < 0;
                            const absVal = Math.abs(val);
                            const formatted = '$' + absVal.toLocaleString('en-US', {minimumFractionDigits: 2});
                            return isNegative ? '-' + formatted : formatted;
                        }
                        return val.toLocaleString();
                    }
                    return String(val);
                });
                section += `  Row ${i}: {${data.columns.slice(0, 6).map((c, j) => `${c}: ${rowData[j]}`).join(', ')}}\n`;
            }

            // Reference syntax guide with available column stats
            section += `\nTOKEN REFERENCE GUIDE:\n`;
            section += `  Rows: {{data.rows[N].column_name}} or {{data.rows[N].column_name:currency}}\n`;
            section += `  Stats: {{data.stats.total}}, {{data.stats.count}}, {{data.stats.average}}\n`;
            section += `  For table/chart blocks: use dataRef "${ref.refId}"\n`;

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
     * Build mapping from resolved entity names to their corresponding dataRefs
     * Enables entity-based token addressing: {{Teva.total_unpaid}} or {{Birla.current_amount}}
     *
     * Strategy: Match entity IDs in resolved entities to entity IDs in tool results
     */
    function buildEntityToRefMapping(state) {
        if (!state.resolvedEntities || !state.dataReferences) return null;

        const mapping = {};

        for (const [entityName, entity] of Object.entries(state.resolvedEntities)) {
            const entityId = entity.id;
            const entityType = entity.type; // 'customer', 'vendor', etc.

            // Find dataRefs that contain this entity's data
            for (const dataRef of state.dataReferences) {
                const summary = dataRef.summary || {};

                // Check if this dataRef was for this entity
                // Method 1: Check tool args for customer_id, vendor_id, entity_id
                const toolInvocation = state.toolInvocations.find(inv =>
                    inv.tool === summary.tool &&
                    (inv.args?.customer_id === entityId ||
                     inv.args?.vendor_id === entityId ||
                     inv.args?.entity_id === entityId)
                );

                if (toolInvocation) {
                    mapping[entityName] = dataRef;
                    break;
                }

                // Method 2: Check if first row contains this entity's ID
                // Load first row to check
                try {
                    const data = Cache.loadRows(
                        dataRef.requestId || state.requestId,
                        dataRef.refId,
                        0,
                        1
                    );
                    if (data && data.rows && data.rows.length > 0) {
                        const row = data.rows[0];
                        if (row.customer_id === entityId ||
                            row.vendor_id === entityId ||
                            row.entity_id === entityId) {
                            mapping[entityName] = dataRef;
                            break;
                        }
                        // Also check if customer_name or vendor_name matches
                        const nameMatch = entity.name?.toLowerCase();
                        if (nameMatch &&
                            (row.customer_name?.toLowerCase()?.includes(nameMatch) ||
                             row.vendor_name?.toLowerCase()?.includes(nameMatch))) {
                            mapping[entityName] = dataRef;
                            break;
                        }
                    }
                } catch (e) {
                    // Ignore cache errors, continue checking
                }
            }
        }

        return Object.keys(mapping).length > 0 ? mapping : null;
    }

    /**
     * Resolve {{tokens}} in a text string
     * Supports multiple addressing modes:
     *   - {{data.rows[N].column}}         - Uses first dataRef, row N
     *   - {{data[R].rows[N].column}}      - Uses dataRef R, row N (multi-ref support)
     *   - {{ref:REF_ID.rows[N].column}}   - Explicit ref by ID
     *   - {{EntityName.column}}           - Entity-based addressing (uses resolved entities)
     *   - {{data.stats.X}}                - Stats from first dataRef
     *
     * FIXED: Multi-dataRef support - LLM can address specific data sources
     */
    function resolveTokensInText(text, state) {
        if (!text) return '';

        // Build entity-to-dataRef mapping for entity-based addressing
        const entityToRef = buildEntityToRefMapping(state);

        // Pattern: {{data.rows[N].column}} or {{data.rows[N].column:format}}
        let resolved = text.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
            try {
                const trimmed = expr.trim();

                // Parse the expression
                // Format: data.rows[N].column or data.rows[N].column:format or data.stats.X
                const formatMatch = trimmed.match(/:(\w+)$/);
                const format = formatMatch ? formatMatch[1] : null;
                const path = format ? trimmed.replace(/:(\w+)$/, '') : trimmed;

                // ═══════════════════════════════════════════════════════════════════════
                // FIX: Multi-DataRef Addressing Modes
                // ═══════════════════════════════════════════════════════════════════════

                let dataRef = null;
                let adjustedPath = path;

                // Mode 1: Explicit ref by ID - {{ref:ref_get__xyz.rows[0].column}}
                const explicitRefMatch = path.match(/^ref:([^.]+)\.(.+)$/);
                if (explicitRefMatch) {
                    const refId = explicitRefMatch[1];
                    adjustedPath = 'data.' + explicitRefMatch[2];
                    dataRef = state.dataReferences.find(r => r.refId === refId);
                    if (!dataRef) {
                        log.debug('Token resolution: explicit ref not found', { refId: refId });
                        return match;
                    }
                }

                // Mode 2: Indexed dataRef - {{data[1].rows[0].column}}
                if (!dataRef) {
                    const indexedRefMatch = path.match(/^data\[(\d+)\]\.(.+)$/);
                    if (indexedRefMatch) {
                        const refIdx = parseInt(indexedRefMatch[1], 10);
                        adjustedPath = 'data.' + indexedRefMatch[2];
                        if (refIdx >= 0 && refIdx < state.dataReferences.length) {
                            dataRef = state.dataReferences[refIdx];
                        } else {
                            log.debug('Token resolution: dataRef index out of bounds', {
                                refIdx: refIdx,
                                available: state.dataReferences.length
                            });
                            return match;
                        }
                    }
                }

                // Mode 3: Entity-based addressing - {{Teva.total_unpaid}} or {{Birla.current_amount}}
                if (!dataRef && entityToRef) {
                    const entityMatch = path.match(/^([A-Za-z][A-Za-z0-9_\s]*?)\.(.+)$/);
                    if (entityMatch) {
                        const entityName = entityMatch[1].trim();
                        const columnPath = entityMatch[2];
                        // Find matching entity (case-insensitive)
                        const matchingEntity = Object.keys(entityToRef).find(
                            e => e.toLowerCase() === entityName.toLowerCase()
                        );
                        if (matchingEntity && entityToRef[matchingEntity]) {
                            dataRef = entityToRef[matchingEntity];
                            adjustedPath = 'data.rows[0].' + columnPath;
                        }
                    }
                }

                // Mode 4: Default - first dataRef (backwards compatible)
                if (!dataRef) {
                    dataRef = state.dataReferences[0];
                    adjustedPath = path;
                }

                if (!dataRef) return match;

                // Use dataRef.requestId for follow-up queries
                const data = Cache.loadRows(dataRef.requestId || state.requestId, dataRef.refId, 0, 49);
                if (!data) return match;

                const totalRows = data.range?.total || data.rows.length;

                // Handle data.rows[N].column - use adjustedPath for multi-ref support
                const rowMatch = adjustedPath.match(/data\.rows\[(\d+)\]\.(\w+)/);
                if (rowMatch) {
                    const rowIdx = parseInt(rowMatch[1], 10);
                    const column = rowMatch[2];

                    // FIXED: Add explicit bounds checking before array access
                    if (!data.rows || !Array.isArray(data.rows)) {
                        log.debug('Token resolution: no rows array', { expr: expr });
                        return match;
                    }
                    if (rowIdx < 0 || rowIdx >= data.rows.length) {
                        // Out of bounds - graceful degradation with informative fallback
                        log.debug('Token resolution: index out of bounds', {
                            expr: expr,
                            rowIdx: rowIdx,
                            availableRows: data.rows.length,
                            refId: dataRef.refId
                        });
                        return match; // Keep original token as fallback
                    }
                    if (data.rows[rowIdx] === null || data.rows[rowIdx] === undefined) {
                        return match;
                    }
                    const value = data.rows[rowIdx][column];
                    return formatResolvedValue(value, format, column);
                }

                // Handle data.stats.X - compute from schema (use adjustedPath)
                const statsMatch = adjustedPath.match(/data\.stats\.(\w+)/);
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

        // FIX: Clean up double dollar signs from LLM writing ${{token:currency}}
        // LLM sometimes writes "${{data.rows[0].amount:currency}}" which becomes "$$1,234.56"
        resolved = resolved.replace(/\$\s*\$/g, '$');  // Handle "$ $" and "$$"
        resolved = resolved.replace(/\$\$/g, '$');      // Handle remaining "$$"

        return resolved;
    }

    /**
     * Format a resolved value based on format hint and column name
     * AGENTIC FIX: Properly formats negative currency as -$X instead of $-X
     */
    function formatResolvedValue(value, format, columnName) {
        if (value === null || value === undefined) return '';

        if (typeof value === 'number') {
            if (format === 'currency' || (!format && isMonetaryColumn(columnName))) {
                // FIXED: Format negative currency correctly as -$X not $-X
                const isNegative = value < 0;
                const absVal = Math.abs(value);
                const formatted = '$' + absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return isNegative ? '-' + formatted : formatted;
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
     * AGENTIC FIX: Properly formats negative currency as -$X instead of $-X
     */
    function formatStatValue(value, key) {
        if (typeof value === 'number') {
            const keyLower = key.toLowerCase();
            if (keyLower.includes('total') || keyLower.includes('sum') || keyLower.includes('amount') ||
                keyLower.includes('revenue') || keyLower.includes('spend')) {
                // FIXED: Format negative currency correctly as -$X not $-X
                const isNegative = value < 0;
                const absVal = Math.abs(value);
                const formatted = '$' + absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return isNegative ? '-' + formatted : formatted;
            }
            if (keyLower.includes('percent') || keyLower.includes('rate')) {
                return value.toFixed(1) + '%';
            }
            return value.toLocaleString('en-US');
        }
        return String(value);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BLOCK SEQUENCE ARCHITECTURE - LLM-controlled block ordering
    // Allows LLM to interleave text, metrics, tables, charts in any order
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Resolve a blocks array from LLM response
     * Processes each block type and resolves tokens, builds tables/charts from dataRefs
     * @param {Array} blocks - Array of block objects from LLM
     * @param {Object} state - Current state with dataReferences
     * @returns {Array} Resolved blocks ready for rendering
     */
    function resolveBlockSequence(blocks, state) {
        if (!blocks || !Array.isArray(blocks)) {
            log.debug('resolveBlockSequence: invalid blocks input', { blocks: typeof blocks });
            return [];
        }

        const resolvedBlocks = [];
        const maxCharts = 2; // Limit charts per response for performance
        let chartCount = 0;

        for (const block of blocks) {
            try {
                const validatedBlock = validateBlock(block);
                if (!validatedBlock) {
                    log.debug('resolveBlockSequence: invalid block skipped', { block: JSON.stringify(block).substring(0, 100) });
                    continue;
                }

                switch (validatedBlock.type) {
                    case 'text':
                        resolvedBlocks.push({
                            type: 'text',
                            content: resolveTokensInText(validatedBlock.content || '', state)
                        });
                        break;

                    case 'metrics':
                        if (validatedBlock.items && Array.isArray(validatedBlock.items)) {
                            const resolvedItems = validatedBlock.items.slice(0, 4).map(m => ({
                                label: String(m.label || '').substring(0, 50),
                                value: resolveTokensInText(String(m.value || ''), state),
                                trend: ['up', 'down', 'neutral'].includes(m.trend) ? m.trend : 'neutral'
                            }));
                            if (resolvedItems.length > 0) {
                                resolvedBlocks.push({
                                    type: 'metrics',
                                    items: resolvedItems
                                });
                            }
                        }
                        break;

                    case 'list':
                        if (validatedBlock.items && Array.isArray(validatedBlock.items)) {
                            const resolvedItems = validatedBlock.items.map(item =>
                                resolveTokensInText(String(item), state)
                            );
                            resolvedBlocks.push({
                                type: 'list',
                                title: validatedBlock.title || undefined,
                                items: resolvedItems
                            });
                        }
                        break;

                    case 'table':
                        const tableBlock = buildTableBlockFromRef(validatedBlock, state);
                        if (tableBlock) {
                            resolvedBlocks.push(tableBlock);
                        }
                        break;

                    case 'chart':
                        if (chartCount < maxCharts) {
                            const chartBlock = buildChartBlock(validatedBlock, state);
                            if (chartBlock) {
                                resolvedBlocks.push(chartBlock);
                                chartCount++;
                            }
                        } else {
                            log.debug('resolveBlockSequence: max charts reached, skipping', { chartCount });
                        }
                        break;

                    default:
                        log.debug('resolveBlockSequence: unknown block type', { type: validatedBlock.type });
                }
            } catch (e) {
                log.error('resolveBlockSequence: error processing block', {
                    blockType: block?.type,
                    error: e.message
                });
            }
        }

        return resolvedBlocks;
    }

    /**
     * Validate a block object has required fields
     * @param {Object} block - Block to validate
     * @returns {Object|null} Validated block or null if invalid
     */
    function validateBlock(block) {
        if (!block || typeof block !== 'object') return null;
        if (!block.type || typeof block.type !== 'string') return null;

        const validTypes = ['text', 'metrics', 'list', 'table', 'chart'];
        if (!validTypes.includes(block.type)) return null;

        // Type-specific validation
        switch (block.type) {
            case 'text':
                if (!block.content && block.content !== '') return null;
                break;
            case 'metrics':
                if (!block.items || !Array.isArray(block.items)) return null;
                break;
            case 'list':
                if (!block.items || !Array.isArray(block.items)) return null;
                break;
            case 'table':
                if (!block.dataRef) return null;
                break;
            case 'chart':
                if (!block.dataRef || !block.chartType) return null;
                if (!block.x || !block.y) return null;
                break;
        }

        return block;
    }

    /**
     * Find a dataRef by its refId
     * @param {string} refId - The reference ID to find
     * @param {Object} state - Current state with dataReferences
     * @returns {Object|null} The dataRef object or null
     */
    function findDataRefByRefId(refId, state) {
        if (!refId || !state.dataReferences) return null;
        return state.dataReferences.find(ref => ref.refId === refId) || null;
    }

    /**
     * Build a table block from a dataRef
     * @param {Object} block - Block with dataRef and optional title
     * @param {Object} state - Current state with dataReferences
     * @returns {Object|null} Table block or null if dataRef invalid
     */
    function buildTableBlockFromRef(block, state) {
        const dataRef = findDataRefByRefId(block.dataRef, state);
        if (!dataRef) {
            log.debug('buildTableBlockFromRef: dataRef not found', { refId: block.dataRef });
            return null;
        }

        try {
            // Load data from cache
            const data = Cache.loadRows(dataRef.requestId || state.requestId, dataRef.refId, 0, 49);
            if (!data || !data.rows || data.rows.length === 0) {
                log.debug('buildTableBlockFromRef: no data for ref', { refId: block.dataRef });
                return null;
            }

            const summary = dataRef.summary || {};
            const toolDisplayName = block.title || getToolDisplayName(summary.tool) || 'Results';

            // Build table block with REAL data (same structure as progressive tables)
            const displayColumns = data.columns.slice(0, 8);
            return {
                type: 'table',
                title: toolDisplayName,
                dataRef: dataRef.refId,
                totalRows: data.totalRows || data.rows.length,
                headers: displayColumns,
                rows: data.rows.slice(0, 25).map(row => {
                    return displayColumns.map(col => formatCellValue(row[col], col));
                }),
                summary: {
                    rowCount: data.totalRows || data.rows.length,
                    columns: data.columns.length,
                    aggregates: summary.aggregates
                },
                // Mark as LLM-placed to distinguish from progressive tables
                llmPlaced: true
            };
        } catch (e) {
            log.error('buildTableBlockFromRef: error building table', {
                refId: block.dataRef,
                error: e.message
            });
            return null;
        }
    }

    /**
     * Build a chart block from a dataRef
     * @param {Object} block - Block with dataRef, chartType, x, y columns
     * @param {Object} state - Current state with dataReferences
     * @returns {Object|null} Chart block or null if invalid
     */
    function buildChartBlock(block, state) {
        const dataRef = findDataRefByRefId(block.dataRef, state);
        if (!dataRef) {
            log.debug('buildChartBlock: dataRef not found', { refId: block.dataRef });
            return null;
        }

        try {
            // Load data from cache (limit rows for chart performance)
            const data = Cache.loadRows(dataRef.requestId || state.requestId, dataRef.refId, 0, 49);
            if (!data || !data.rows || data.rows.length === 0) {
                log.debug('buildChartBlock: no data for ref', { refId: block.dataRef });
                return null;
            }

            // Validate x and y columns exist
            const xCol = block.x;
            const yCol = block.y;
            if (!data.columns.includes(xCol) || !data.columns.includes(yCol)) {
                log.debug('buildChartBlock: invalid columns', {
                    x: xCol,
                    y: yCol,
                    availableColumns: data.columns
                });
                return null;
            }

            // Validate chart type
            const validChartTypes = ['bar', 'line', 'pie'];
            const chartType = validChartTypes.includes(block.chartType) ? block.chartType : 'bar';

            // Limit data points for chart readability
            const maxDataPoints = chartType === 'pie' ? 10 : 20;
            const chartRows = data.rows.slice(0, maxDataPoints);

            // Build chart data structure (Plotly-compatible)
            const chartData = {
                labels: chartRows.map(row => formatCellValue(row[xCol], xCol)),
                values: chartRows.map(row => {
                    const val = row[yCol];
                    return typeof val === 'number' ? val : parseFloat(val) || 0;
                })
            };

            // Determine title
            const title = block.title || `${yCol} by ${xCol}`;

            return {
                type: 'chart',
                chartType: chartType,
                title: title,
                data: chartData,
                config: {
                    xKey: xCol,
                    yKey: yCol
                },
                dataRef: dataRef.refId
            };
        } catch (e) {
            log.error('buildChartBlock: error building chart', {
                refId: block.dataRef,
                chartType: block.chartType,
                error: e.message
            });
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTELLIGENT FAILURE RESPONSE BUILDERS
    // Provide helpful context based on what went wrong
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Build a user-friendly journey summary showing what was tried
     */
    function buildJourneySummary(state) {
        if (!state.reflection.journey || state.reflection.journey.length === 0) {
            return null;
        }

        const items = [];
        for (const step of state.reflection.journey) {
            switch (step.action) {
                case 'entity_resolved':
                    items.push(`Found "${step.entity}" (${step.type})`);
                    break;
                case 'entity_not_found':
                    items.push(`Could not find entity matching "${step.searchTerm}"`);
                    break;
                case 'broaden_retry':
                    items.push(`Retried ${step.tool} with broader parameters`);
                    break;
                case 'try_different_tool':
                    items.push(`Tried alternative tool: ${step.tool}`);
                    break;
                case 'reflection':
                    if (step.decision === 'GIVE_UP') {
                        items.push(`Determined: ${step.reasoning}`);
                    }
                    break;
            }
        }

        return items.length > 0 ? items : null;
    }

    /**
     * Build an intelligent failure response based on the diagnosed failure mode
     * FIX 7: ENHANCED with comprehensive diagnostics about what was tried
     */
    function buildFailureModeResponse(state) {
        const failureMode = state.reflection.failureMode;
        const entityFound = state.reflection.entityFound;

        // Default response
        let title = 'Unable to Find Data';
        let summary = "I couldn't find the data needed to answer your question.";
        let blocks = [];

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 7: Build diagnostic summary for the user
        // ═══════════════════════════════════════════════════════════════════════
        const diagnostics = state.diagnostics || { toolsAttempted: [], errorsEncountered: [], suggestedActions: [] };
        const uniqueToolsTried = [...new Set(diagnostics.toolsAttempted.map(t => t.tool))];
        const totalAttempts = diagnostics.toolsAttempted.length;
        const failedAttempts = diagnostics.toolsAttempted.filter(t => !t.success || t.rowCount === 0).length;

        switch (failureMode) {
            case FAILURE_MODES.ENTITY_NOT_FOUND:
                title = 'Entity Not Found';
                summary = "I couldn't find the entity you mentioned in the system.";
                blocks = [{
                    type: 'text',
                    content: "I searched for the entity you mentioned but couldn't find a match in the system. " +
                        "Please check the spelling or try a different name. You can ask me to 'list customers' or 'list vendors' to see what's available."
                }];
                break;

            case FAILURE_MODES.ENTITY_FOUND_NO_DATA:
                const entityName = Object.values(state.resolvedEntities)[0]?.name || 'the entity';
                title = 'No Data Found';
                summary = `Found ${entityName}, but no matching data exists.`;
                blocks = [{
                    type: 'text',
                    content: `I found ${entityName} in the system, but there's no data matching your query. ` +
                        "This could mean:\n" +
                        "• The entity has no transactions for the specified time period\n" +
                        "• The filters are too restrictive\n" +
                        "• This type of data doesn't exist for this entity\n\n" +
                        "Try asking with a broader date range or fewer filters."
                }];
                break;

            case FAILURE_MODES.QUERY_TOO_RESTRICTIVE:
                title = 'No Matching Data';
                summary = 'The query filters may be too restrictive.';
                blocks = [{
                    type: 'text',
                    content: "I couldn't find any data matching your criteria. " +
                        "The filters (date range, transaction type, etc.) might be too restrictive. " +
                        "Try asking with a broader date range or fewer constraints."
                }];
                break;

            case FAILURE_MODES.NO_DATA_EXISTS:
                title = 'Data Not Available';
                summary = 'This type of data may not exist in the system.';
                blocks = [{
                    type: 'text',
                    content: "I wasn't able to find this type of data in the system. " +
                        "It's possible this data hasn't been entered or isn't tracked. " +
                        "Try asking about a different type of data or check if this information is available in NetSuite."
                }];
                break;

            case FAILURE_MODES.TOOL_ERROR:
                title = 'Query Error';
                summary = 'An error occurred while fetching the data.';
                const lastError = state.errors[state.errors.length - 1];
                blocks = [{
                    type: 'text',
                    content: "I encountered an error while trying to fetch the data. " +
                        (lastError?.suggestion || "Please try rephrasing your question.")
                }];
                break;

            default:
                blocks = [{
                    type: 'text',
                    content: "I wasn't able to find the data needed to answer your question. " +
                        "Please try rephrasing or providing more specific details."
                }];
        }

        // Add journey summary if available
        const journeySummary = buildJourneySummary(state);
        if (journeySummary) {
            blocks.push({
                type: 'list',
                title: 'What I Tried',
                items: journeySummary
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 7: Add diagnostic summary block
        // ═══════════════════════════════════════════════════════════════════════
        if (totalAttempts > 0) {
            const diagnosticItems = [];

            // Summary of attempts
            diagnosticItems.push(`Tried ${uniqueToolsTried.length} different tool(s) with ${totalAttempts} total attempt(s)`);
            diagnosticItems.push(`${failedAttempts} attempt(s) returned no usable data`);

            // List tools tried
            if (uniqueToolsTried.length > 0) {
                diagnosticItems.push(`Tools tried: ${uniqueToolsTried.slice(0, 5).join(', ')}${uniqueToolsTried.length > 5 ? '...' : ''}`);
            }

            // Show specific errors encountered (deduplicated)
            if (diagnostics.errorsEncountered && diagnostics.errorsEncountered.length > 0) {
                const uniqueErrors = [...new Set(diagnostics.errorsEncountered.map(e => e.category))];
                diagnosticItems.push(`Error categories: ${uniqueErrors.join(', ')}`);
            }

            // Show circuit breaker / diversification triggers
            if (state.circuitBreakerTriggered) {
                diagnosticItems.push('⚡ Circuit breaker triggered due to no progress');
            }
            if (state.diversificationTriggered) {
                diagnosticItems.push('🔄 Tool diversification was required');
            }

            blocks.push({
                type: 'list',
                title: 'Diagnostic Summary',
                items: diagnosticItems
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 7: Add suggested actions if we have them
        // ═══════════════════════════════════════════════════════════════════════
        if (diagnostics.suggestedActions && diagnostics.suggestedActions.length > 0) {
            // Deduplicate and limit suggestions
            const uniqueSuggestions = [...new Set(diagnostics.suggestedActions)].slice(0, 3);

            blocks.push({
                type: 'list',
                title: 'Suggested Actions',
                items: uniqueSuggestions
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // FIX 7: Add alternative query suggestions based on error analysis
        // ═══════════════════════════════════════════════════════════════════════
        const errorCategories = [...new Set((state.errorSemantics || []).map(e => e.insights.category))];
        if (errorCategories.includes('type_mismatch')) {
            blocks.push({
                type: 'text',
                content: '💡 **Tip**: For time ranges, try being more specific. For example:\n' +
                    '• "Show revenue for the last 12 months"\n' +
                    '• "Show revenue for 2024"\n' +
                    '• "Show monthly revenue since January"'
            });
        }

        return { title, summary, blocks };
    }

    /**
     * Build fallback narrative from data summaries when LLM fails
     * AGENTIC FIX: Uses formatStatValue for consistent currency formatting
     */
    function buildFallbackNarrative(state) {
        const parts = [];

        state.dataReferences.forEach(ref => {
            const summary = ref.summary || {};
            const toolName = getToolDisplayName(summary.tool) || 'Query';
            parts.push(`${toolName}: ${summary.rowCount || 0} results found.`);

            if (summary.stats) {
                if (summary.stats.total !== undefined) {
                    // Use formatStatValue for consistent negative currency formatting
                    parts.push(`Total: ${formatStatValue(summary.stats.total, 'total')}`);
                }
            }
        });

        return parts.join(' ') || 'Analysis complete.';
    }

    /**
     * Generate a conversational response for general/non-financial queries
     * Uses LLM to provide friendly, contextual responses to greetings and chitchat
     */
    function generateConversationalResponse(state) {
        const historyContext = buildHistoryContext(state);

        const prompt = `You are a friendly financial assistant for NetSuite. The user sent a conversational message (greeting, chitchat, or general question).

${historyContext}
USER MESSAGE: "${state.message}"

Respond naturally and conversationally. Be warm and helpful. If it's a greeting, greet them back.
Mention that you can help with financial questions - revenue, expenses, customers, vendors, transactions, P&L, aging reports, etc.
Keep your response concise (1-3 sentences).
Do NOT use markdown formatting or special characters.
Do NOT make up any financial data.

Response:`;

        try {
            const response = AIProviders.callAI(prompt, {
                tier: getTierForPhase('intent', {}),
                temperature: 0.7,
                purpose: 'SCA:intent' // Conversational responses are short like intent
            });

            if (response && response.text && response.text.trim()) {
                return response.text.trim();
            }
        } catch (e) {
            log.debug('Conversational response generation failed', { error: e.message });
        }

        // Fallback if LLM fails
        return "Hello! I'm your financial assistant. I can help you explore your NetSuite data - ask me about revenue, expenses, customers, vendors, aging reports, or any financial metrics!";
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Build an appropriate summary for tool results
     * AGENTIC FIX: Handles entity resolution tools specially - they report 'found' status
     * not row counts. Also handles dashboard tools that return metric objects.
     *
     * @param {string} toolName - Name of the tool
     * @param {object} result - Tool execution result
     * @param {number} rowCount - Number of rows returned
     * @returns {string} Human-readable summary
     */
    function buildToolResultSummary(toolName, result, rowCount) {
        if (!result.success) {
            return result.error || 'Failed';
        }

        // Entity resolution tools have special result structure
        if (toolName.startsWith('resolve_')) {
            if (result.found && result.entity) {
                const entityName = result.entity.name || result.entity.entityid || 'entity';
                const entityType = result.entityType || result.entity.type || '';
                return `Found: ${entityName}${entityType ? ` (${entityType})` : ''}`;
            }
            if (result.notFound) {
                return result.message || 'No match found';
            }
            if (result.ambiguous && result.matches) {
                return `Ambiguous: ${result.matches.length} possible matches`;
            }
            // Fallback for resolve tools
            return result.message || 'Resolution complete';
        }

        // Dashboard tools return metrics, not rows
        if (toolName.startsWith('dashboard_')) {
            if (result.metrics) {
                const metricCount = Object.keys(result.metrics).length;
                return `${metricCount} metrics calculated`;
            }
            return 'Dashboard loaded';
        }

        // Fiscal context tool
        if (toolName === 'get_fiscal_context') {
            return result.context?.currentPeriod || 'Fiscal context loaded';
        }

        // Standard data tools - report row count
        if (rowCount > 0) {
            return `Found ${rowCount} results`;
        }

        // Zero rows but success - context-aware message
        if (result.message) {
            return result.message;
        }

        return 'No data found';
    }

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
                // Use ref.requestId for follow-up queries
                const data = Cache.loadRows(ref.requestId || state.requestId, ref.refId, 0, 19);
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
                Cache.addBlock(state.requestId, tableBlock);

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

    /**
     * SEMANTIC INTENT TOOL SELECTION PROMPT
     * Used to select appropriate tools for an intent when LLM selection fails
     */
    const INTENT_TOOL_SELECTION_PROMPT = `User intent: {intent}
Message: "{message}"

Select 1-2 most relevant tools from:
{available_tools}

Consider what data the user needs and which tools can provide it.
Reply JSON only: {"tools": ["tool1", "tool2"], "reasoning": "brief explanation"}`;

    /**
     * Get default tools for a given intent using semantic LLM selection
     * FIXED: Added 'follow_up' intent to use cached data instead of refetching
     * @param {string} intent - The classified intent
     * @param {Object} state - Current state for context
     * @returns {string[]} Array of tool names to use
     */
    function getDefaultToolsForIntent(intent, state) {
        // Special cases that should NOT invoke tools
        // These must remain hardcoded as they're behavioral requirements
        if (intent === 'general' || intent === 'follow_up') {
            // general: greetings, chitchat - let conversational handler deal with it
            // follow_up: use cached data, skip INVOKE phase
            return [];
        }

        // Try semantic selection for other intents
        try {
            const toolManifest = Tools.getToolManifest();
            const availableTools = Object.entries(toolManifest)
                .map(([name, desc]) => `- ${name}: ${desc}`)
                .join('\n');

            const prompt = INTENT_TOOL_SELECTION_PROMPT
                .replace('{intent}', intent)
                .replace('{message}', state?.message || '')
                .replace('{available_tools}', availableTools);

            const response = AIProviders.callAI(prompt, {
                tier: TIERS.FAST,
                temperature: 0.1,
                jsonMode: true,
                purpose: 'SCA:intent_tools'
            });

            const parsed = parseJsonResponse(response?.text);

            if (parsed?.tools && Array.isArray(parsed.tools)) {
                // Validate suggested tools exist
                const validTools = parsed.tools.filter(t => toolManifest[t]).slice(0, 2);
                if (validTools.length > 0) {
                    log.debug('Semantic intent tool selection', {
                        intent: intent,
                        selectedTools: validTools,
                        reasoning: parsed.reasoning
                    });
                    return validTools;
                }
            }
        } catch (e) {
            log.debug('Semantic intent tool selection failed', {
                error: e.message,
                intent: intent
            });
        }

        // Ultimate fallback: let ReAct loop figure it out
        // Return empty array instead of hardcoded defaults
        return [];
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

    /**
     * Enrich table blocks with actual data from data references
     * FIXED: Optimized to load all needed rows in one batch instead of N calls
     */
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

                    // OPTIMIZATION: Load all rows in one batch instead of N separate calls
                    // Use dataRef.requestId for follow-up queries
                    const maxRank = Math.max(...preview.map(p => p.rank || 0));
                    const allData = Cache.loadRows(dataRef.requestId || state.requestId, dataRef.refId, 0, maxRank);
                    const rowsMap = {};
                    if (allData && allData.rows) {
                        allData.rows.forEach((row, idx) => { rowsMap[idx] = row; });
                    }

                    block.rows = preview.map(p => {
                        const rowIndex = (p.rank || 1) - 1;
                        const rowData = rowsMap[rowIndex];
                        if (rowData) {
                            return block.headers.map(h => formatCellValue(rowData[h], h));
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
     * AGENTIC FIX: Properly formats negative currency as -$X instead of $-X
     * Also translates status codes to human-readable labels
     */
    function formatCellValue(val, columnName) {
        if (val === null || val === undefined) return '';

        // Translate status codes to human-readable labels
        const statusColumns = ['status', 'statusref', 'approvalstatus', 'orderstatus'];
        if (columnName && statusColumns.includes(columnName.toLowerCase())) {
            return Utils.mapStatus(val) || val;
        }

        if (typeof val === 'number') {
            // Check if this is a monetary column
            const isMonetary = columnName ? isMonetaryColumn(columnName) : false;
            if (isMonetary) {
                // FIXED: Format negative currency correctly as -$X not $-X
                const isNegative = val < 0;
                const absVal = Math.abs(val);
                const formatted = '$' + absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return isNegative ? '-' + formatted : formatted;
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
     * Get a user-friendly display name for a tool (internal/simple version)
     * Note: This is intentionally different from Tools.getToolDisplayName() which takes args
     * This version is for static display names without argument context
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
    function initState(message, sessionContext, requestId, history) {
        const state = initStreamingState(message, sessionContext, requestId, history);

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
            formatIter: state.formatIterations,
            reflectIter: state.reflectIterations
        });

        let result;

        switch (state.phase) {
            case PHASES.INIT:
                state.phase = PHASES.INTENT;
                return { hasMore: true, phase: PHASES.INTENT };

            case PHASES.INTENT:
                result = executeIntentPhase(state);
                return { hasMore: true, phase: result.nextPhase };

            // ═══════════════════════════════════════════════════════════════════════
            // REASON_ACT: True ReAct Loop - Replaces SELECT/INVOKE/REFLECT
            // This is the core agentic phase that iteratively gathers data
            // ═══════════════════════════════════════════════════════════════════════
            case PHASES.REASON_ACT:
                result = executeReasonActPhase(state);
                // REASON_ACT can loop back to itself (more data needed) or proceed
                if (result.nextPhase === PHASES.REASON_ACT) {
                    return { hasMore: true, phase: PHASES.REASON_ACT };
                }
                if (result.nextPhase === PHASES.SYNTHESIZE) {
                    return { hasMore: true, phase: PHASES.SYNTHESIZE };
                }
                if (result.nextPhase === PHASES.RESPOND) {
                    return { hasMore: true, phase: PHASES.RESPOND };
                }
                return { hasMore: true, phase: result.nextPhase };

            // DEPRECATED: Kept for backwards compatibility
            case PHASES.SELECT:
                result = executeSelectPhase(state);
                return { hasMore: true, phase: result.nextPhase };

            case PHASES.INVOKE:
                result = executeInvokePhase(state);
                // Route to appropriate next phase
                if (result.nextPhase === PHASES.REFLECT) {
                    return { hasMore: true, phase: PHASES.REFLECT };
                }
                if (result.nextPhase === PHASES.RESPOND) {
                    return { hasMore: true, phase: PHASES.RESPOND };
                }
                return { hasMore: true, phase: PHASES.INVOKE };

            // ═══════════════════════════════════════════════════════════════════════
            // ReAct Pattern: REFLECT phase evaluates results and decides next action
            // ═══════════════════════════════════════════════════════════════════════
            case PHASES.REFLECT:
                result = executeReflectPhase(state);
                // REFLECT can loop back to INVOKE for retry, proceed to SYNTHESIZE, or RESPOND
                if (result.nextPhase === PHASES.INVOKE) {
                    return { hasMore: true, phase: PHASES.INVOKE };
                }
                if (result.nextPhase === PHASES.SYNTHESIZE) {
                    return { hasMore: true, phase: PHASES.SYNTHESIZE };
                }
                if (result.nextPhase === PHASES.RESPOND) {
                    return { hasMore: true, phase: PHASES.RESPOND };
                }
                return { hasMore: true, phase: result.nextPhase };

            // ═══════════════════════════════════════════════════════════════════════
            // SYNTHESIZE: LLM writes custom SQL when pre-built tools fail
            // Self-correcting loop that retries on SQL errors
            // ═══════════════════════════════════════════════════════════════════════
            case PHASES.SYNTHESIZE:
                result = executeSynthesizePhase(state);
                // SYNTHESIZE can loop back to itself (self-correction) or proceed to RESPOND
                if (result.nextPhase === PHASES.SYNTHESIZE) {
                    return { hasMore: true, phase: PHASES.SYNTHESIZE };
                }
                if (result.nextPhase === PHASES.RESPOND) {
                    return { hasMore: true, phase: PHASES.RESPOND };
                }
                return { hasMore: true, phase: result.nextPhase };

            case PHASES.RESPOND:
                result = executeRespondPhase(state);
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
     * FIXED: Enhanced error propagation to surface errors visibly to users
     */
    function buildFinalResponse(state) {
        const formatted = state.formattedResponse || {};
        const duration = Date.now() - state.startTime;

        // Check if any tools failed
        const failedTools = state.toolInvocations.filter(t => !t.success && t.error);
        const successfulTools = state.toolInvocations.filter(t => t.success);
        const hasPartialFailure = failedTools.length > 0 && successfulTools.length > 0;
        const hasCompleteFailure = failedTools.length > 0 && successfulTools.length === 0;

        // Build base response
        let responseText = state.analysis?.analysis || formatted.summary || 'Analysis complete';
        let richContent = formatted.blocks || [];

        // ═══════════════════════════════════════════════════════════════════════
        // BLOCK COEXISTENCE: Merge progressive tables with LLM-placed blocks
        // - Progressive tables are added during INVOKE phase (fast, immediate UX)
        // - LLM can also place tables/charts via block sequence format
        // - If LLM placed any tables, don't add progressive tables (avoid duplicates)
        // ═══════════════════════════════════════════════════════════════════════
        const progressState = Cache.get(state.requestId);
        const llmPlacedTables = richContent.some(b => b.type === 'table' && b.llmPlaced);

        if (!llmPlacedTables && progressState?.blocks?.length > 0) {
            // LLM didn't place any tables - merge progressive tables
            const progressiveTableBlocks = progressState.blocks.filter(b => b.type === 'table');

            if (progressiveTableBlocks.length > 0) {
                // Insert after first text block
                const textBlockIndex = richContent.findIndex(b => b.type === 'text');
                const insertPosition = textBlockIndex >= 0 ? textBlockIndex + 1 : 0;

                richContent = [
                    ...richContent.slice(0, insertPosition),
                    ...progressiveTableBlocks,
                    ...richContent.slice(insertPosition)
                ];

                log.debug('Merged progressive table blocks into richContent', {
                    requestId: state.requestId,
                    tableCount: progressiveTableBlocks.length,
                    totalBlocks: richContent.length
                });
            }
        } else if (llmPlacedTables) {
            log.debug('Skipping progressive tables: LLM placed tables explicitly', {
                requestId: state.requestId,
                llmTableCount: richContent.filter(b => b.type === 'table').length
            });
        }

        // FIXED: Surface errors visibly in the response
        if (hasCompleteFailure) {
            // All tools failed - add error context to response
            const errorMessages = failedTools.map(t =>
                `• ${getToolDisplayName(t.tool)}: ${t.error || 'Unknown error'}`
            ).join('\n');
            responseText = "I encountered issues retrieving the data needed to answer your question. " +
                "Please try rephrasing your question or check that the requested entities exist.";
            richContent = [{
                type: 'text',
                content: responseText
            }, {
                type: 'list',
                title: 'Issues encountered',
                items: failedTools.map(t => `${getToolDisplayName(t.tool)}: ${t.error || 'Unknown error'}`)
            }];
        } else if (hasPartialFailure && state.errors.length > 0) {
            // Some tools failed - add warning note
            const warningBlock = {
                type: 'text',
                content: '⚠️ Note: Some data sources were unavailable. Results may be incomplete.'
            };
            // Insert warning at the end of rich content
            if (!richContent.some(b => b.content?.includes('unavailable'))) {
                richContent = [...richContent, warningBlock];
            }
        }

        const response = {
            text: responseText,
            richContent: richContent,
            title: formatted.title,
            summary: formatted.summary,
            sessionContext: {
                resolvedEntities: state.resolvedEntities,
                // RECOMMENDATION 1: Include LLM-extracted semantic topics (no word lists)
                semanticTopics: state.intent?.semantic_topics || [],
                // FOLLOW-UP DATA REUSE: Store data references for reuse in follow-up questions
                // This allows "show that as a table" or "tell me more" to access previous data
                lastDataRefs: state.dataReferences.length > 0 ? state.dataReferences : null,
                lastToolResults: state.toolInvocations.length > 0 ? state.toolInvocations.map(t => ({
                    tool: t.tool,
                    success: t.success,
                    rowCount: t.rowCount,
                    dataRef: t.dataRef
                })) : null
            },
            metadata: {
                phases: {
                    intent: state.intent,
                    toolsUsed: state.selectedTools,
                    toolResults: state.toolInvocations.map(t => ({
                        tool: t.tool,
                        success: t.success,
                        rowCount: t.rowCount,
                        error: t.error // FIXED: Include error in tool results
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
                errors: state.errors.length > 0 ? state.errors : undefined,
                hasPartialFailure: hasPartialFailure || undefined,
                hasCompleteFailure: hasCompleteFailure || undefined
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

        // Utilities (re-exported from Tools for backward compatibility)
        getToolManifest: Tools.getToolManifest,
        getToolListForPrompt: Tools.getToolListForPrompt
    };
});
