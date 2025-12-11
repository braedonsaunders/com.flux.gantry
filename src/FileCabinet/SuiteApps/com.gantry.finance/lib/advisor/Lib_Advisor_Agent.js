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
    const REFLECT_AFTER_FAILURES = 2;   // Trigger reflection after this many failures
    const MAX_STRATEGY_PIVOTS = 3;      // Maximum strategy changes allowed

    // ═══════════════════════════════════════════════════════════════════════════
    // PLANNING PHASE PROMPT
    // ═══════════════════════════════════════════════════════════════════════════

    const PLANNING_PROMPT = `You are a financial analysis planning assistant. Analyze the user's question and create a plan to answer it.

## USER QUESTION:
{user_question}

## AVAILABLE TOOLS:
**Discovery (find IDs first):**
- resolve_entity - Find customer, vendor, employee by name
- resolve_gl_account - Find GL account by name/number
- resolve_classification - Find class, location, department, subsidiary

**Data (get actual numbers):**
- get_ap_aging, get_ar_aging - Aging buckets
- get_vendor_spend, get_customer_revenue - Entity analysis
- get_gl_activity - GL transactions by account/class/dept
- get_trial_balance - Current balances (can filter by account_type: Income, Expense, COGS, etc.)
- get_recent_transactions - Transaction list
- get_cash_position - Bank balances
- get_expense_breakdown - Expenses by category
- compare_periods - Period over period variance
- find_anomalies - Outlier detection

**Dashboards (comprehensive analysis):**
- dashboard_cashflow - Cash position, runway, projections
- dashboard_health - Profitability, margins, health score
- dashboard_burden - Overhead/burden rates
- dashboard_time - Utilization, billable hours
- dashboard_integrity - Fraud detection, anomalies
- dashboard_vendorperformance - Vendor metrics
- dashboard_customervalue - Customer CLV, RFM
- dashboard_spendvelocity - Cost trends

## YOUR TASK:
Create a plan that will FULLY answer the user's question. Think about:

1. **What is the user's GOAL?** (not just the literal words, but what they actually want to know)
2. **What data is needed?** Be specific about what constitutes a complete answer
3. **What tools should be called and in what order?**
4. **How will we know when we have enough data to answer?**

## IMPORTANT CONSIDERATIONS:
- For "income statement" → need Revenue (Income accounts), COGS accounts, and Expense accounts, then calculate Gross Profit and Net Income
- For "balance sheet" → need Assets, Liabilities, and Equity accounts
- For entity-specific questions → resolve entity first, then query with ID
- For trend questions → may need multiple period comparisons or find_anomalies
- Dashboard tools provide comprehensive pre-computed analysis - prefer these for broad questions

Respond with JSON only:
{
    "goal_understanding": "What the user actually wants to know (the WHY, not just the WHAT)",
    "data_needed": ["List of specific data points needed to fully answer"],
    "plan_steps": [
        {"step": 1, "action": "description", "tool": "tool_name", "args": {}, "purpose": "why this step"}
    ],
    "completion_criteria": "How to know when we have a complete answer",
    "expected_output_format": "What the final response should include (metrics, tables, charts, etc.)"
}`;

    const SELF_VERIFICATION_PROMPT = `You are verifying that a response fully answers the user's question.

## ORIGINAL QUESTION:
{user_question}

## PLANNED GOAL:
{goal}

## DATA GATHERED:
{data_summary}

## PROPOSED RESPONSE CONTENT:
{response_summary}

## YOUR TASK:
Determine if the proposed response FULLY answers the user's question.

## CRITICAL: DATA SUFFICIENCY RULES
Before marking incomplete, consider:
1. **If a data tool returned rows (rowCount > 0), that data CAN answer the question**
   - The LLM can compute totals, averages, and aggregations from returned rows
   - DO NOT request "more data" when rows were already returned
2. **For aging queries**: get_ar_aging or get_ap_aging with rows = COMPLETE DATA
3. **For entity queries**: If rows contain the entity data = COMPLETE
4. **The LLM has access to ALL returned row data** - it can sum, filter, analyze

## COMPLETENESS CHECK:
1. Did the data tool return relevant rows? → Data is SUFFICIENT
2. Does the format_response include metrics/tables/insights? → Analysis is PRESENT
3. Are the insights derived from the actual data? → Response is VALID

## QUALITY CHECK (1-10):
- 1-3: Missing critical data OR no analysis
- 4-6: Has data but weak insights
- 7-10: Has data with meaningful insights

## IMPORTANT:
- If data tools returned rows AND format_response was called → likely COMPLETE (score 7+)
- Only recommend "gather_more_data" if ZERO relevant data was retrieved
- "improve_analysis" is better than "gather_more_data" when data exists but insights are weak

Respond with JSON only:
{
    "is_complete": true|false,
    "missing_elements": ["list of missing data or analysis"],
    "quality_score": 1-10,
    "issues": ["list of quality issues"],
    "recommendation": "proceed|gather_more_data|improve_analysis",
    "improvement_guidance": "If not proceeding, what to do"
}`;

    const PLAN_REASSESSMENT_PROMPT = `You are reassessing a plan because some steps failed.

## ORIGINAL QUESTION:
{user_question}

## ORIGINAL PLAN:
{original_plan}

## WHAT HAPPENED:
{execution_summary}

## AVAILABLE TOOLS:
(Same as before - discovery, data, dashboard tools)

## YOUR TASK:
Determine if we can still answer the question and how. Consider:
1. Did we get enough data despite the failures?
2. Are there alternative tools that could provide the same information?
3. Should we try a completely different approach?

Respond with JSON only:
{
    "can_continue": true|false,
    "have_sufficient_data": true|false,
    "revised_plan": [
        {"step": 1, "action": "description", "tool": "tool_name", "args": {}}
    ],
    "reasoning": "Why this revised approach will work",
    "should_answer_now": true|false,
    "answer_guidance": "If should_answer_now is true, guidance on how to structure the answer with available data"
}`;

    // ═══════════════════════════════════════════════════════════════════════════
    // REFLECTION & ADAPTATION PROMPTS
    // ═══════════════════════════════════════════════════════════════════════════

    const REFLECTION_PROMPT = `You are analyzing the results of tool calls to determine if the current approach is working.

## RECENT TOOL CALLS AND RESULTS:
{tool_results}

## ORIGINAL USER QUESTION:
{user_question}

## YOUR TASK:
Analyze what happened and provide a JSON response:

{
    "assessment": "on_track|needs_pivot|blocked|partial_success",
    "confidence": 0.0-1.0,
    "findings": [
        {"insight": "what we learned", "importance": "high|medium|low"}
    ],
    "failures": [
        {"tool": "tool_name", "reason": "why it failed", "suggestion": "what to try instead"}
    ],
    "next_strategy": "description of recommended next approach",
    "should_pivot": true|false,
    "pivot_reason": "why we need to change strategy (if should_pivot is true)",
    "alternative_tools": ["list of tools to try if pivoting"]
}

## CRITICAL ANALYSIS GUIDELINES:
- **SUCCESS = rowCount > 0** → assessment should be "on_track", should_pivot = FALSE
- If any tool returned rows of data, that is SUCCESS - use that data to answer!

## HANDLING 0 ROWS RETURNED:
When a tool returns rowCount = 0, consider:

1. **Was the tool appropriate for the question?**
   - For vendor transactions: Try get_vendor_spend, get_ap_aging, or run_custom_query
   - For customer transactions: Try get_customer_revenue, get_ar_aging
   - For entity-specific data with 0 rows: TRY ALTERNATIVE TOOLS FIRST before concluding "no data"

2. **Were the filters too restrictive?**
   - Try removing transaction_type filter
   - Try expanding the time period (period: "all" or "last_year")
   - Try the query without entity_id to verify data exists at all

3. **Alternative tools for common scenarios:**
   - Vendor bills → get_vendor_spend, get_ap_aging, run_custom_query with VendBill
   - Customer invoices → get_customer_revenue, get_ar_aging
   - General transactions → get_gl_activity, get_recent_transactions without type filter

## WHEN TO PIVOT (should_pivot = true):
- Got 0 rows but HAVEN'T tried alternative tools yet
- Same tool called 2+ times with same 0-row result
- Error occurred
- Entity genuinely not found (found=false)

## WHEN NOT TO PIVOT (should_pivot = false):
- Tool returned rows of data (rowCount > 0)
- Already tried multiple alternative approaches with 0 rows each (accept "no data" as answer)
- Tool found an entity (found=true)

Respond with ONLY the JSON object, no other text.`;

    const STRATEGY_PIVOT_PROMPT = `You need to develop a NEW strategy because the previous approach failed.

## ORIGINAL QUESTION:
{user_question}

## WHAT WE TRIED:
{previous_attempts}

## WHY IT FAILED:
{failure_reasons}

## AVAILABLE TOOLS (YOU MUST ONLY USE THESE):
**Discovery:**
- resolve_entity(term, type_hint?) - Find customer, vendor, employee, item, project by name
- resolve_gl_account(term, account_type?) - Find GL account by name/number
- resolve_classification(term, dimension?) - Find class, location, department, subsidiary
- explore_schema(table) - Get available fields for a table

**Data:**
- get_ap_aging(vendor_id?) - AP aging by bucket
- get_ar_aging(customer_id?) - AR aging by bucket
- get_vendor_spend(vendor_id?, period?, limit?) - Vendor spending analysis
- get_customer_revenue(customer_id?, period?, limit?) - Customer revenue analysis
- get_gl_activity(account_id?, class_id?, department_id?, location_id?, period?) - GL transactions
- get_trial_balance(account_type?) - Account balances
- get_recent_transactions(transaction_type?, entity_id?, period?) - Recent transactions
- get_transaction_detail(transaction_id) - Full transaction details
- compare_periods(metric, period1, period2) - Period comparison
- find_anomalies(data_type, account_id?, class_id?, threshold?, period?) - Find outliers
- get_cash_position() - Current cash across bank accounts
- get_expense_breakdown(period?, department_id?, class_id?) - Expense by category

**Dashboards:**
- dashboard_cashflow, dashboard_health, dashboard_burden, dashboard_time
- dashboard_integrity, dashboard_vendorperformance, dashboard_customervalue, dashboard_spendvelocity

**Utility:**
- get_fiscal_context() - Get fiscal calendar info
- run_custom_query(sql, purpose) - Execute custom SuiteQL (use sparingly)

## YOUR TASK:
Create a new strategy using ONLY the tools listed above. Consider:
1. If entity wasn't found by name, try get_trial_balance or get_recent_transactions to see what data exists
2. If a specific query failed, try a broader data tool first
3. If classification failed, try different dimensions (class vs department vs location)
4. Use explore_schema to discover what data is actually available

Respond with JSON:
{
    "new_strategy": "description of the new approach",
    "reasoning": "why this approach might work better",
    "first_tool": "exact_tool_name_from_list_above",
    "first_tool_args": {},
    "backup_tools": ["exact_tool_names_from_list_above"]
}

IMPORTANT: first_tool and backup_tools MUST be exact tool names from the list above.

Respond with ONLY the JSON object.`;

    // ═══════════════════════════════════════════════════════════════════════════
    // REFLECTION & ADAPTATION FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Analyze recent tool results and determine if we need to pivot strategy
     */
    function performReflection(agentState, requestId) {
        const recentCalls = agentState.allToolCalls.slice(-5);
        if (recentCalls.length === 0) return null;

        // Build tool results summary for the prompt
        const toolResultsSummary = recentCalls.map(tc => {
            const resultSummary = tc.result ? {
                success: tc.result.success,
                rowCount: tc.result.rowCount || (tc.result.rows ? tc.result.rows.length : 0),
                error: tc.result.error,
                message: tc.result.message
            } : { error: 'No result' };

            return `Tool: ${tc.tool}\nArgs: ${JSON.stringify(tc.args)}\nResult: ${JSON.stringify(resultSummary)}`;
        }).join('\n\n');

        const prompt = REFLECTION_PROMPT
            .replace('{tool_results}', toolResultsSummary)
            .replace('{user_question}', agentState.message);

        try {
            const reflectionResponse = AIProviders.callAI(prompt, {
                systemPrompt: 'You are an analytical assistant that evaluates tool call results. Respond only with valid JSON.',
                tier: THINKING_TIER,
                purpose: 'Reflection on tool results',
                temperature: 0.3
            });

            if (reflectionResponse && reflectionResponse.text) {
                try {
                    // Extract JSON from response
                    let jsonText = reflectionResponse.text.trim();
                    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) jsonText = jsonMatch[0];

                    const reflection = JSON.parse(jsonText);

                    // Add reflection step to progress
                    ProgressStore.addStep(requestId, {
                        type: 'reflection',
                        title: 'Analyzing results...',
                        status: 'complete',
                        reflection: {
                            assessment: reflection.assessment,
                            confidence: reflection.confidence,
                            findings: reflection.findings || [],
                            failures: reflection.failures || [],
                            shouldPivot: reflection.should_pivot,
                            pivotReason: reflection.pivot_reason,
                            nextStrategy: reflection.next_strategy
                        }
                    });

                    return reflection;
                } catch (parseError) {
                    log.debug('Failed to parse reflection response', { error: parseError.message });
                }
            }
        } catch (e) {
            log.debug('Reflection call failed', { error: e.message });
        }

        return null;
    }

    /**
     * Generate a new strategy when the current approach isn't working
     */
    function generateStrategyPivot(agentState, reflection, requestId) {
        // Build summary of what we tried
        const attempts = agentState.allToolCalls.map(tc =>
            `${tc.tool}(${JSON.stringify(tc.args)}) → ${tc.result?.success ? 'OK' : 'FAILED'}: ${summarizeToolResult(tc.result)}`
        ).join('\n');

        const failureReasons = reflection.failures ?
            reflection.failures.map(f => `${f.tool}: ${f.reason}`).join('\n') :
            reflection.pivot_reason || 'Multiple failures with no results';

        const prompt = STRATEGY_PIVOT_PROMPT
            .replace('{user_question}', agentState.message)
            .replace('{previous_attempts}', attempts)
            .replace('{failure_reasons}', failureReasons);

        try {
            const pivotResponse = AIProviders.callAI(prompt, {
                systemPrompt: 'You are a strategic advisor helping find alternative approaches. Respond only with valid JSON.',
                tier: THINKING_TIER,
                purpose: 'Strategy pivot',
                temperature: 0.4
            });

            if (pivotResponse && pivotResponse.text) {
                try {
                    let jsonText = pivotResponse.text.trim();
                    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) jsonText = jsonMatch[0];

                    const strategy = JSON.parse(jsonText);

                    // Add strategy pivot step
                    ProgressStore.addStep(requestId, {
                        type: 'strategy_pivot',
                        title: 'Changing approach...',
                        status: 'complete',
                        strategy: {
                            newStrategy: strategy.new_strategy,
                            reasoning: strategy.reasoning,
                            firstTool: strategy.first_tool,
                            firstToolArgs: strategy.first_tool_args,
                            backupTools: strategy.backup_tools || []
                        }
                    });

                    return strategy;
                } catch (parseError) {
                    log.debug('Failed to parse strategy pivot response', { error: parseError.message });
                }
            }
        } catch (e) {
            log.debug('Strategy pivot call failed', { error: e.message });
        }

        return null;
    }

    /**
     * Check if a tool call result represents a real failure
     * A failure is: error, success=false, or found=false
     * NOT a failure: success=true with 0 rows (that's just "no matching data")
     */
    function isToolCallFailure(tc) {
        if (!tc.result) return true;
        if (tc.result.error) return true;
        if (tc.result.success === false) return true;
        if (tc.result.found === false) return true;  // Entity not found
        return false;
    }

    /**
     * Check if a tool call returned useful data
     */
    function hasUsefulData(tc) {
        if (!tc.result) return false;
        if (!tc.result.success) return false;

        // Check for rows
        const rowCount = tc.result.rowCount || (tc.result.rows ? tc.result.rows.length : 0);
        if (rowCount > 0) return true;

        // Check for dashboard data
        if (tc.result.data) return true;

        // Check for found entity
        if (tc.result.found === true) return true;

        return false;
    }

    /**
     * Determine if we should trigger reflection based on recent results
     *
     * KEY INSIGHT: Only reflect when we're STUCK, not when things are working.
     * If the most recent tool call succeeded with data, we should NOT reflect.
     */
    function shouldReflect(agentState) {
        if (!agentState.allToolCalls || agentState.allToolCalls.length === 0) return false;

        // CRITICAL: If the MOST RECENT tool call returned useful data, don't reflect!
        // The agent should USE that data, not second-guess itself.
        const lastCall = agentState.allToolCalls[agentState.allToolCalls.length - 1];
        if (hasUsefulData(lastCall)) {
            return false;
        }

        // Count recent ACTUAL failures (last 3 calls)
        const recentCalls = agentState.allToolCalls.slice(-3);
        const failures = recentCalls.filter(tc => isToolCallFailure(tc));

        // Reflect if we have multiple actual failures
        if (failures.length >= REFLECT_AFTER_FAILURES) return true;

        // Reflect if we've had repeated tool calls (same signature) - sign of being stuck
        const signatures = recentCalls.map(tc => tc.tool + '::' + JSON.stringify(tc.args));
        const uniqueSignatures = new Set(signatures);
        if (signatures.length > uniqueSignatures.size) return true;

        return false;
    }

    /**
     * Track a failure for reflection purposes
     */
    function trackFailure(agentState, toolName, args, result) {
        if (!agentState.recentFailures) agentState.recentFailures = [];

        agentState.recentFailures.push({
            tool: toolName,
            args: args,
            result: result,
            timestamp: Date.now()
        });

        // Keep only last 5 failures
        if (agentState.recentFailures.length > 5) {
            agentState.recentFailures = agentState.recentFailures.slice(-5);
        }
    }

    /**
     * Clear failure state when we have success
     * This prevents reflection from triggering after a successful tool call
     */
    function clearFailureState(agentState) {
        agentState.recentFailures = [];
        // Reset reflection count partially - allow 1 more reflection if truly needed
        agentState.reflectionCount = Math.max(0, agentState.reflectionCount - 1);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PLANNING PHASE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Create an initial plan for answering the user's question
     * This helps the agent understand the GOAL and what data is needed
     */
    function createPlan(message, requestId) {
        const prompt = PLANNING_PROMPT.replace('{user_question}', message);

        try {
            const planResponse = AIProviders.callAI(prompt, {
                systemPrompt: 'You are a financial analysis planning assistant. Create clear, actionable plans. Respond only with valid JSON.',
                tier: THINKING_TIER,
                purpose: 'Planning phase',
                temperature: 0.3
            });

            if (planResponse && planResponse.text) {
                try {
                    let jsonText = planResponse.text.trim();
                    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) jsonText = jsonMatch[0];

                    const plan = JSON.parse(jsonText);

                    // Add planning step to progress
                    ProgressStore.addStep(requestId, {
                        type: 'planning',
                        title: 'Creating analysis plan...',
                        status: 'complete',
                        plan: {
                            goal: plan.goal_understanding,
                            dataNeeded: plan.data_needed,
                            steps: plan.plan_steps ? plan.plan_steps.length : 0,
                            completionCriteria: plan.completion_criteria
                        }
                    });

                    log.debug('Plan created', {
                        requestId: requestId,
                        goal: plan.goal_understanding,
                        stepCount: plan.plan_steps ? plan.plan_steps.length : 0
                    });

                    return plan;
                } catch (parseError) {
                    log.debug('Failed to parse plan response', { error: parseError.message });
                }
            }
        } catch (e) {
            log.debug('Planning call failed', { error: e.message });
        }

        return null;
    }

    /**
     * Create a plan and UPDATE the thinking step with the actual AI plan
     * This is called on the FIRST poll to show the user what the AI is planning
     *
     * @param {string} message - User's question
     * @param {string} requestId - Request ID for progress tracking
     * @returns {object|null} The plan object or null if failed
     */
    function createPlanAndUpdateThinking(message, requestId) {
        const prompt = PLANNING_PROMPT.replace('{user_question}', message);

        try {
            const planResponse = AIProviders.callAI(prompt, {
                systemPrompt: 'You are a financial analysis planning assistant. Create clear, actionable plans. Respond only with valid JSON.',
                tier: THINKING_TIER,
                purpose: 'Planning phase',
                temperature: 0.3
            });

            if (planResponse && planResponse.text) {
                try {
                    let jsonText = planResponse.text.trim();
                    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) jsonText = jsonMatch[0];

                    const plan = JSON.parse(jsonText);

                    // UPDATE the existing thinking step with the actual AI plan
                    // This replaces the static keyword analysis with real AI output
                    const thinkingUpdate = {
                        title: 'Understanding your question',
                        status: 'complete',
                        plan: {
                            goal_understanding: plan.goal_understanding,
                            data_needed: plan.data_needed,
                            plan_steps: plan.plan_steps ? plan.plan_steps.map((step, i) => ({
                                step: step.step || (i + 1),
                                action: step.action,
                                tool: step.tool,
                                purpose: step.purpose
                            })) : [],
                            completion_criteria: plan.completion_criteria,
                            expected_output: plan.expected_output_format
                        }
                    };

                    // Update the thinking step with actual AI plan
                    const updated = ProgressStore.updateStepByType(requestId, 'thinking', thinkingUpdate);

                    if (!updated) {
                        // If thinking step doesn't exist, add the plan as a separate step
                        ProgressStore.addStep(requestId, {
                            type: 'planning',
                            title: 'Analysis plan created',
                            status: 'complete',
                            plan: thinkingUpdate.plan
                        });
                    }

                    log.debug('Plan created and thinking step updated', {
                        requestId: requestId,
                        goal: plan.goal_understanding,
                        stepCount: plan.plan_steps ? plan.plan_steps.length : 0,
                        thinkingUpdated: updated
                    });

                    return plan;
                } catch (parseError) {
                    log.debug('Failed to parse plan response', { error: parseError.message });

                    // Update thinking step to show planning failed gracefully
                    ProgressStore.updateStepByType(requestId, 'thinking', {
                        title: 'Understanding your question',
                        status: 'complete',
                        plan: {
                            goal_understanding: 'Analyzing your request...',
                            data_needed: ['Will determine during analysis'],
                            plan_steps: [],
                            completion_criteria: 'Answer the user question'
                        }
                    });
                }
            }
        } catch (e) {
            log.debug('Planning call failed', { error: e.message });
        }

        return null;
    }

    /**
     * Reassess the plan when tools fail
     * Determines if we should continue, pivot, or answer with what we have
     */
    function reassessPlan(agentState, requestId) {
        if (!agentState.plan) return null;

        // Build execution summary
        const executionSummary = agentState.allToolCalls.map(tc => {
            const status = tc.result.success ? 'SUCCESS' : 'FAILED';
            const dataInfo = tc.result.rowCount ? `(${tc.result.rowCount} rows)` :
                            tc.result.found === true ? '(found)' :
                            tc.result.found === false ? '(not found)' :
                            tc.result.error ? `(error: ${tc.result.error})` : '';
            return `${tc.tool}: ${status} ${dataInfo}`;
        }).join('\n');

        const prompt = PLAN_REASSESSMENT_PROMPT
            .replace('{user_question}', agentState.message)
            .replace('{original_plan}', JSON.stringify(agentState.plan, null, 2))
            .replace('{execution_summary}', executionSummary);

        try {
            const reassessResponse = AIProviders.callAI(prompt, {
                systemPrompt: 'You are reassessing a financial analysis plan. Be practical about what can still be achieved. Respond only with valid JSON.',
                tier: THINKING_TIER,
                purpose: 'Plan reassessment',
                temperature: 0.3
            });

            if (reassessResponse && reassessResponse.text) {
                try {
                    let jsonText = reassessResponse.text.trim();
                    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) jsonText = jsonMatch[0];

                    const reassessment = JSON.parse(jsonText);

                    // Add reassessment step to progress
                    ProgressStore.addStep(requestId, {
                        type: 'plan_reassessment',
                        title: 'Reassessing approach...',
                        status: 'complete',
                        reassessment: {
                            canContinue: reassessment.can_continue,
                            hasSufficientData: reassessment.have_sufficient_data,
                            shouldAnswerNow: reassessment.should_answer_now,
                            reasoning: reassessment.reasoning
                        }
                    });

                    return reassessment;
                } catch (parseError) {
                    log.debug('Failed to parse reassessment response', { error: parseError.message });
                }
            }
        } catch (e) {
            log.debug('Plan reassessment call failed', { error: e.message });
        }

        return null;
    }

    /**
     * Build plan context to add to the conversation
     */
    function buildPlanContext(plan) {
        if (!plan) return '';

        let context = '\n\n--- ANALYSIS PLAN ---\n';
        context += `GOAL: ${plan.goal_understanding}\n`;
        context += `DATA NEEDED: ${plan.data_needed ? plan.data_needed.join(', ') : 'Not specified'}\n`;
        context += `COMPLETION CRITERIA: ${plan.completion_criteria}\n`;

        if (plan.plan_steps && plan.plan_steps.length > 0) {
            context += `PLANNED STEPS:\n`;
            plan.plan_steps.forEach((step, i) => {
                context += `  ${i + 1}. ${step.action} (${step.tool}) - ${step.purpose}\n`;
            });
        }

        if (plan.expected_output_format) {
            context += `EXPECTED OUTPUT: ${plan.expected_output_format}\n`;
        }

        return context;
    }

    /**
     * Self-verification: Check if we have gathered enough data and the response is complete
     * This runs BEFORE format_response to ensure quality
     */
    function performSelfVerification(agentState, requestId) {
        // Only verify if we have a plan (goal to check against)
        if (!agentState.plan) return { is_complete: true, recommendation: 'proceed' };

        // Build data summary from tool calls
        const dataSummary = agentState.allToolCalls.map(tc => {
            const status = tc.result.success ? 'SUCCESS' : 'FAILED';
            const dataInfo = tc.result.rowCount ? `${tc.result.rowCount} rows` :
                            tc.result.found === true ? 'found' :
                            tc.result.found === false ? 'not found' :
                            tc.result.error ? `error: ${tc.result.error}` : 'no data';
            return `${tc.tool}: ${status} (${dataInfo})`;
        }).join('\n');

        // Summarize what data we got
        const successfulCalls = agentState.allToolCalls.filter(tc => tc.result.success && (tc.result.rowCount > 0 || tc.result.found));
        const dataGathered = successfulCalls.map(tc => tc.tool).join(', ');

        const prompt = SELF_VERIFICATION_PROMPT
            .replace('{user_question}', agentState.message)
            .replace('{goal}', agentState.plan.goal_understanding || 'Answer the question')
            .replace('{data_summary}', dataSummary || 'No data gathered')
            .replace('{response_summary}', `Data gathered from: ${dataGathered || 'none'}`);

        try {
            const verifyResponse = AIProviders.callAI(prompt, {
                systemPrompt: 'You are a quality assurance assistant verifying response completeness. Respond only with valid JSON.',
                tier: THINKING_TIER,
                purpose: 'Self-verification',
                temperature: 0.2
            });

            if (verifyResponse && verifyResponse.text) {
                try {
                    let jsonText = verifyResponse.text.trim();
                    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) jsonText = jsonMatch[0];

                    const verification = JSON.parse(jsonText);

                    // Add verification step to progress
                    ProgressStore.addStep(requestId, {
                        type: 'verification',
                        title: 'Verifying response completeness...',
                        status: 'complete',
                        verification: {
                            isComplete: verification.is_complete,
                            qualityScore: verification.quality_score,
                            recommendation: verification.recommendation
                        }
                    });

                    log.debug('Self-verification result', {
                        requestId: requestId,
                        isComplete: verification.is_complete,
                        qualityScore: verification.quality_score,
                        recommendation: verification.recommendation
                    });

                    return verification;
                } catch (parseError) {
                    log.debug('Failed to parse verification response', { error: parseError.message });
                }
            }
        } catch (e) {
            log.debug('Self-verification call failed', { error: e.message });
        }

        // Default: proceed if verification fails
        return { is_complete: true, recommendation: 'proceed' };
    }

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
4. **Saved Search & Report tools** - run_saved_search, list_saved_searches, run_report
5. **Utility tools** - get_fiscal_context, run_custom_query

## SAVED SEARCHES & REPORTS
- **list_saved_searches(record_type?, title_contains?)** - Find available saved searches by type or name
- **run_saved_search(search_id, filters?)** - Execute a saved search by ID or script ID
- **run_report(report_type, period?)** - Run standard reports: income_statement, balance_sheet, ar_aging, ap_aging, trial_balance, cash_flow, general_ledger

Use these when user asks for a specific saved search or report by name.

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
- Use tables for comparative data

## CRITICAL: ANALYSIS REQUIREMENTS
When you receive data from tools, you MUST:
1. **ANALYZE the data** - don't just repeat it back. Look for patterns, trends, outliers.
2. **COMPUTE AGGREGATIONS YOURSELF** - if a tool returns rows with numbers, YOU calculate the totals, averages, percentages. Do NOT call another tool to compute what you already have.
3. **PROVIDE INSIGHTS** - explain what the data means for the business.
4. **COMPARE AND CONTEXTUALIZE** - how does this compare to benchmarks, previous periods, expectations?
5. **HIGHLIGHT KEY FINDINGS** - what are the top 3-5 takeaways?
6. **USE THE format_response TOOL** - Structure your final response using the format_response tool for rich content.

## DATA COMPUTATION - YOU HAVE THE DATA, USE IT!
When a tool like get_ar_aging returns 45 rows, YOU have all the data:
- **Compute totals**: Sum the columns yourself (e.g., total_outstanding across all rows)
- **Calculate percentages**: What % is in each aging bucket?
- **Find patterns**: Which customers are highest? Which have overdue amounts?
- **DO NOT call run_custom_query to re-aggregate data you already have**

Example: If get_ar_aging returns rows with current_bucket, days_1_30, days_31_60, etc.:
- YOU sum each column to get totals
- YOU calculate: total_current / total_outstanding * 100 = current %
- YOU identify the top 5 customers by total_outstanding

## run_custom_query - WHEN TO USE IT
**run_custom_query executes SuiteQL against NetSuite record types, NOT tool names.**
- CORRECT: "SELECT ... FROM transaction WHERE ..."
- CORRECT: "SELECT ... FROM customer WHERE ..."
- WRONG: "SELECT ... FROM get_ar_aging" ← get_ar_aging is a TOOL, not a table!

Only use run_custom_query for:
- Queries that no existing tool supports
- Complex joins across NetSuite tables
- Specific field lookups not available in standard tools

## USING format_response TOOL
When providing your final answer, ALWAYS use the format_response tool to structure your response. This tool allows you to create rich content blocks:
- **text**: Narrative analysis and insights
- **table**: Structured data with headers and rows
- **metrics**: Key numbers with labels and optional comparison
- **chart**: Data visualizations (bar, line, pie)
- **list**: Bullet points for key takeaways

Example usage:
\`\`\`
format_response({
    blocks: [
        { type: "text", content: "Based on my analysis of your AR aging..." },
        { type: "metrics", items: [
            { label: "Total AR", value: "$125,000", change: "+5%", trend: "up" },
            { label: "Overdue", value: "$32,000", change: "-12%", trend: "down" }
        ]},
        { type: "table", title: "Top 5 Overdue Customers", headers: ["Customer", "Amount", "Days"], rows: [...] },
        { type: "list", title: "Key Insights", items: ["Insight 1", "Insight 2"] }
    ]
})
\`\`\``;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP-BY-STEP AGENT EXECUTION (for progressive rendering)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Initialize agent state for step-by-step execution
     * Creates the initial state and stores it for subsequent step calls
     *
     * @param {string} message - User's question
     * @param {Array} history - Conversation history
     * @param {object} sessionContext - Session context with resolved entities
     * @param {string} requestId - Request ID for progress tracking
     * @param {object} options - Additional options
     * @returns {object} Initial agent state
     */
    function initAgentState(message, history, sessionContext, requestId, options) {
        options = options || {};

        // Get fiscal context
        const fiscalContext = getFiscalContext();

        // Build system prompt
        const systemPrompt = buildSystemPrompt(fiscalContext, sessionContext);

        // NOTE: toolDefinitions are NOT stored in agentState to save cache space
        // They are regenerated fresh on each runAgentStep call via Tools.getToolDefinitions()

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

        const agentState = {
            message: message,
            history: history,
            sessionContext: sessionContext || {},
            options: options,
            requestId: requestId,
            startTime: Date.now(),
            iteration: 0,
            conversationContext: '',
            allToolCalls: [],
            toolCallSignatures: {},  // JSON-serializable version of Map
            consecutiveRepeats: 0,
            systemPrompt: systemPrompt,
            // toolDefinitions NOT stored - regenerated each step to save ~100KB cache space
            toolDefinitions: null,
            chatHistory: chatHistory,
            completed: false,
            finalResponse: null,
            // Reflection & Adaptation state
            recentFailures: [],
            reflectionCount: 0,
            strategyPivotCount: 0,
            currentStrategy: null,
            insights: [],           // Accumulated insights from reflections
            lastReflection: null,   // Most recent reflection result
            // Planning state
            plan: null,             // The initial plan
            planReassessmentCount: 0,
            needsPlanReassessment: false
        };

        // NOTE: Initial thinking step is added by the orchestrator AFTER ProgressStore.create()
        // This ensures the request exists before adding steps

        // Determine if planning is needed (skip for simple queries)
        // Planning will be executed on FIRST POLL to show actual AI plan in thinking step
        const isSimpleQuery = message.length < 30 && !message.includes('?') &&
            !/\b(show|get|what|how|why|compare|analyze|income|balance|cash|vendor|customer|expense)\b/i.test(message);

        // Flag for deferred planning - will be executed on first runAgentStep call
        agentState.planPending = !isSimpleQuery;
        agentState.plan = null;

        return agentState;
    }

    /**
     * Run ONE iteration of the agent loop
     * Returns after each LLM call (with or without tool execution)
     *
     * @param {string} requestId - Request ID
     * @returns {object} { hasMore: boolean, step: object|null, error: string|null, response: object|null }
     */
    function runAgentStep(requestId) {
        const MAX_REPEATS = 2;

        // Get current state
        const agentState = ProgressStore.getAgentState(requestId);
        if (!agentState) {
            return { hasMore: false, error: 'Session not found or expired' };
        }

        // Check if already completed
        if (agentState.completed) {
            return { hasMore: false, response: agentState.finalResponse };
        }

        // Check max iterations
        if (agentState.iteration >= MAX_ITERATIONS) {
            log.debug('Agent reached max iterations', { requestId: requestId });

            // Try to synthesize from what we have
            if (agentState.allToolCalls && agentState.allToolCalls.length > 0) {
                const toolResults = agentState.allToolCalls.map(tc => ({
                    tool: tc.tool,
                    result: tc.result
                }));
                const response = synthesizeFromToolResults(toolResults, agentState.message, agentState.startTime);

                ProgressStore.complete(requestId, {
                    answer: response.text,
                    richContent: response.richContent,
                    sessionContext: agentState.sessionContext
                });

                agentState.completed = true;
                agentState.finalResponse = response;
                ProgressStore.setAgentState(requestId, agentState);

                return { hasMore: false, response: response };
            }

            ProgressStore.fail(requestId, 'Could not complete analysis after maximum attempts');
            return { hasMore: false, error: 'Max iterations reached' };
        }

        agentState.iteration++;

        // Regenerate toolDefinitions fresh each step (not stored in cache to save space)
        // This saves ~100KB of cache space per request
        agentState.toolDefinitions = Tools.getToolDefinitions();

        // On FIRST poll iteration, run the planning phase and update the thinking step
        // This ensures the user sees the actual AI plan, not just static keyword analysis
        if (agentState.iteration === 1 && agentState.planPending) {
            try {
                log.debug('Running deferred planning on first poll', { requestId: requestId });

                const plan = createPlanAndUpdateThinking(agentState.message, requestId);
                if (plan) {
                    agentState.plan = plan;
                    agentState.conversationContext = buildPlanContext(plan);
                }
                agentState.planPending = false;
                ProgressStore.setAgentState(requestId, agentState);

                // Return early - this iteration was just for planning
                // Next poll will start the actual agent work
                return { hasMore: true, step: { type: 'planning', status: 'complete' } };
            } catch (planError) {
                log.error('Planning phase failed', { requestId: requestId, error: planError.message });
                agentState.planPending = false;
                ProgressStore.setAgentState(requestId, agentState);
                // Continue without plan - agent will work without it
            }
        }

        // Build the prompt for this iteration
        let currentPrompt = agentState.message;
        if (agentState.conversationContext) {
            currentPrompt = agentState.message + '\n\n--- Previous tool calls and results ---\n' + agentState.conversationContext;
        }

        // If too many repeats, force a final answer
        const forceAnswer = agentState.consecutiveRepeats >= MAX_REPEATS;
        if (forceAnswer) {
            currentPrompt += '\n\n**IMPORTANT: You have tried the same tool multiple times with no results. You MUST now provide a final answer to the user based on what you know, or explain that you could not find the requested information. Do NOT call any more tools.**';
        }

        log.debug('Agent step', {
            requestId: requestId,
            iteration: agentState.iteration,
            promptLength: currentPrompt.length,
            forceAnswer: forceAnswer
        });

        try {
            // Call LLM with tools
            const llmResponse = AIProviders.callAI(currentPrompt, {
                systemPrompt: agentState.systemPrompt,
                chatHistory: agentState.chatHistory,
                tools: forceAnswer ? null : agentState.toolDefinitions,
                tier: THINKING_TIER,
                purpose: `Agent iteration ${agentState.iteration}`,
                temperature: 0.2
            });

            // Check for errors
            if (!llmResponse || llmResponse.error) {
                log.error('LLM call failed in step', {
                    requestId: requestId,
                    error: llmResponse ? llmResponse.error : 'No response'
                });

                ProgressStore.fail(requestId, 'Failed to get AI response');
                return { hasMore: false, error: 'LLM call failed: ' + (llmResponse?.error || 'No response') };
            }

            // Handle tool calls
            if (llmResponse.type === 'tool_call' && llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
                let hadRepeat = false;
                let executedAny = false;

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
                    const previousCount = agentState.toolCallSignatures[signature] || 0;

                    if (previousCount >= MAX_REPEATS) {
                        log.debug('Skipping repeated tool call', {
                            tool: toolName,
                            previousCount: previousCount
                        });
                        hadRepeat = true;
                        agentState.conversationContext += `\n[SKIPPED - Already called ${toolName} with same args ${previousCount} times. Try a different approach or provide your answer.]\n`;
                        continue;
                    }

                    // Track this call
                    agentState.toolCallSignatures[signature] = previousCount + 1;

                    // Add progress step BEFORE executing
                    const displayName = Tools.getToolDisplayName(toolName, parsedArgs);
                    ProgressStore.addStep(requestId, {
                        type: 'tool_call',
                        title: displayName,
                        tool: toolName,
                        params: parsedArgs,
                        status: 'running'
                    });

                    // Execute the tool with timing
                    const toolStartTime = Date.now();
                    const result = Tools.executeTool(toolName, parsedArgs);
                    const toolDuration = Date.now() - toolStartTime;

                    // Format rich result for frontend step
                    const stepResult = formatResultForStep(result, toolName, toolDuration);

                    // Update progress step with RICH result data
                    ProgressStore.updateLastStep(requestId, {
                        status: 'complete',
                        ...stepResult,
                        // Metadata
                        meta: {
                            duration: toolDuration,
                            isLlmCall: false
                        }
                    });

                    // ═══════════════════════════════════════════════════════════════
                    // SPECIAL: format_response tool triggers completion
                    // WITH SELF-VERIFICATION: Ensure response is complete before finishing
                    // ═══════════════════════════════════════════════════════════════
                    if (toolName === 'format_response' && result.success && result.isFormatResponse) {
                        // Track format_response attempts for verification retry limits
                        agentState.formatResponseAttempts = (agentState.formatResponseAttempts || 0) + 1;
                        const MAX_FORMAT_RESPONSE_ATTEMPTS = 2;

                        // Perform self-verification before completing
                        const verification = performSelfVerification(agentState, requestId);

                        // Check if we have useful data from previous tool calls
                        const hasUsefulDataFromTools = agentState.allToolCalls.some(tc =>
                            tc.result && tc.result.success && (tc.result.rowCount > 0 || tc.result.found === true)
                        );

                        // Decide whether to accept or continue based on verification + data state
                        const shouldAcceptResponse =
                            verification.is_complete ||
                            verification.recommendation === 'proceed' ||
                            verification.recommendation === 'improve_analysis' ||  // Accept if just needs better analysis
                            (verification.quality_score && verification.quality_score >= 6) ||  // Accept if quality is decent
                            agentState.formatResponseAttempts >= MAX_FORMAT_RESPONSE_ATTEMPTS ||  // Accept after retry limit
                            (hasUsefulDataFromTools && verification.recommendation !== 'gather_more_data');  // Accept if we have data

                        if (!shouldAcceptResponse && verification.recommendation === 'gather_more_data') {
                            log.debug('Self-verification: requesting more data', {
                                requestId: requestId,
                                attempt: agentState.formatResponseAttempts,
                                maxAttempts: MAX_FORMAT_RESPONSE_ATTEMPTS,
                                missing: verification.missing_elements,
                                hasUsefulData: hasUsefulDataFromTools
                            });

                            // Add guidance to conversation context
                            agentState.conversationContext += `\n--- VERIFICATION FEEDBACK (Attempt ${agentState.formatResponseAttempts}/${MAX_FORMAT_RESPONSE_ATTEMPTS}) ---\n`;
                            agentState.conversationContext += `Missing: ${(verification.missing_elements || []).join(', ')}\n`;
                            agentState.conversationContext += `Guidance: ${verification.improvement_guidance || 'Improve your analysis'}\n`;

                            // IMPORTANT: Don't mark format_response as failed - it succeeded!
                            // Just record that verification requested improvements
                            agentState.allToolCalls.push({
                                tool: toolName,
                                args: parsedArgs,
                                result: {
                                    success: true, // format_response DID succeed
                                    isFormatResponse: true,
                                    verificationPending: true,
                                    verificationFeedback: verification.improvement_guidance
                                },
                                displayName: 'Formatting response...',
                                duration: toolDuration
                            });

                            executedAny = true;
                            continue;  // Try to improve
                        }

                        // Accept the response
                        log.debug('format_response accepted - completing with rich content', {
                            requestId: requestId,
                            blockCount: result.blockCount,
                            qualityScore: verification.quality_score,
                            attempt: agentState.formatResponseAttempts,
                            acceptReason: !verification.is_complete ?
                                (agentState.formatResponseAttempts >= MAX_FORMAT_RESPONSE_ATTEMPTS ? 'retry_limit' : 'has_data') :
                                'verification_passed'
                        });

                        // Complete the request with the formatted rich content
                        ProgressStore.complete(requestId, {
                            answer: result.summary || result.title || 'Response formatted',
                            richContent: result.richContent,
                            sessionContext: agentState.sessionContext
                        });

                        return {
                            hasMore: false,
                            done: true,
                            richContent: result.richContent
                        };
                    }

                    agentState.allToolCalls.push({
                        tool: toolName,
                        args: parsedArgs,
                        result: result,
                        displayName: displayName,
                        duration: toolDuration
                    });

                    // Track failures/successes for reflection
                    const toolCallRecord = { tool: toolName, args: parsedArgs, result: result };
                    if (isToolCallFailure(toolCallRecord)) {
                        trackFailure(agentState, toolName, parsedArgs, result);
                    } else if (hasUsefulData(toolCallRecord)) {
                        // SUCCESS with data - clear failure state!
                        // The agent got what it needed, no need to reflect
                        clearFailureState(agentState);
                    }

                    // Add to conversation context WITH ACTUAL DATA for LLM to use
                    agentState.conversationContext += `\n--- Tool: ${toolName} ---\n`;
                    agentState.conversationContext += `Arguments: ${JSON.stringify(parsedArgs)}\n`;
                    agentState.conversationContext += formatResultForLLM(result, toolName) + '\n';

                    executedAny = true;
                }

                // Track repeats
                if (!executedAny && hadRepeat) {
                    agentState.consecutiveRepeats++;
                } else if (executedAny) {
                    agentState.consecutiveRepeats = 0;
                }

                // ═══════════════════════════════════════════════════════════════
                // REFLECTION & ADAPTATION PHASE
                // ═══════════════════════════════════════════════════════════════

                // Check if we should trigger reflection based on recent results
                if (shouldReflect(agentState) && agentState.reflectionCount < 3) {
                    log.debug('Triggering reflection', {
                        requestId: requestId,
                        reflectionCount: agentState.reflectionCount,
                        recentFailures: agentState.recentFailures.length
                    });

                    const reflection = performReflection(agentState, requestId);
                    agentState.reflectionCount++;

                    if (reflection) {
                        // ═══════════════════════════════════════════════════════════
                        // FIX: Assessment-Action Consistency
                        // If assessment is "blocked", force should_pivot to true
                        // ═══════════════════════════════════════════════════════════
                        if (reflection.assessment === 'blocked' && !reflection.should_pivot) {
                            log.debug('Correcting inconsistent reflection: blocked but shouldPivot was false', {
                                requestId: requestId
                            });
                            reflection.should_pivot = true;
                            reflection.pivot_reason = reflection.pivot_reason || 'Assessment indicates blocked state - forcing pivot';
                        }

                        agentState.lastReflection = reflection;

                        // Store insights for future context
                        if (reflection.findings) {
                            agentState.insights = agentState.insights.concat(
                                reflection.findings.map(f => f.insight)
                            );
                        }

                        // Add reflection insights to conversation context
                        agentState.conversationContext += `\n--- REFLECTION INSIGHTS ---\n`;
                        agentState.conversationContext += `Assessment: ${reflection.assessment}\n`;
                        if (reflection.findings && reflection.findings.length > 0) {
                            agentState.conversationContext += `Findings:\n`;
                            reflection.findings.forEach(f => {
                                agentState.conversationContext += `- ${f.insight} (${f.importance})\n`;
                            });
                        }
                        if (reflection.next_strategy) {
                            agentState.conversationContext += `Recommended approach: ${reflection.next_strategy}\n`;
                        }

                        // Check if we need to pivot strategy
                        if (reflection.should_pivot && agentState.strategyPivotCount < MAX_STRATEGY_PIVOTS) {
                            log.debug('Triggering strategy pivot', {
                                requestId: requestId,
                                pivotCount: agentState.strategyPivotCount,
                                reason: reflection.pivot_reason
                            });

                            const newStrategy = generateStrategyPivot(agentState, reflection, requestId);
                            agentState.strategyPivotCount++;

                            if (newStrategy) {
                                agentState.currentStrategy = newStrategy;

                                // Add strategy to conversation context
                                agentState.conversationContext += `\n--- NEW STRATEGY ---\n`;
                                agentState.conversationContext += `Strategy: ${newStrategy.new_strategy}\n`;
                                agentState.conversationContext += `Reasoning: ${newStrategy.reasoning}\n`;
                                if (newStrategy.first_tool) {
                                    agentState.conversationContext += `Suggested first tool: ${newStrategy.first_tool}\n`;
                                }
                            }
                        }

                        // ═══════════════════════════════════════════════════════════
                        // PLAN REASSESSMENT: When reflection shows issues, reassess
                        // ═══════════════════════════════════════════════════════════
                        if (agentState.plan && agentState.planReassessmentCount < 2 &&
                            (reflection.assessment === 'blocked' || reflection.assessment === 'needs_pivot')) {

                            log.debug('Triggering plan reassessment', {
                                requestId: requestId,
                                assessment: reflection.assessment
                            });

                            const reassessment = reassessPlan(agentState, requestId);
                            agentState.planReassessmentCount++;

                            if (reassessment) {
                                // If we have sufficient data, hint to answer now
                                if (reassessment.should_answer_now && reassessment.answer_guidance) {
                                    agentState.conversationContext += `\n--- PLAN REASSESSMENT ---\n`;
                                    agentState.conversationContext += `Status: Have sufficient data to answer\n`;
                                    agentState.conversationContext += `Guidance: ${reassessment.answer_guidance}\n`;
                                    agentState.conversationContext += `\n**You should now provide a final answer using the format_response tool.**\n`;
                                } else if (reassessment.revised_plan && reassessment.revised_plan.length > 0) {
                                    agentState.conversationContext += `\n--- REVISED PLAN ---\n`;
                                    reassessment.revised_plan.forEach((step, i) => {
                                        agentState.conversationContext += `${i + 1}. ${step.action} (${step.tool})\n`;
                                    });
                                }
                            }
                        }
                    }
                }

                // Save state and return (more steps needed)
                ProgressStore.setAgentState(requestId, agentState);
                return { hasMore: true, step: { type: 'tool_calls', count: agentState.allToolCalls.length } };
            }

            // Final text response - we're done!
            if (llmResponse.text) {
                log.debug('Agent completed', {
                    requestId: requestId,
                    iterations: agentState.iteration,
                    duration: Date.now() - agentState.startTime
                });

                // Build rich response
                const response = buildFinalResponse(
                    llmResponse.text,
                    agentState.allToolCalls,
                    agentState.sessionContext,
                    agentState.startTime
                );

                // Complete progress
                ProgressStore.complete(requestId, {
                    answer: llmResponse.text,
                    richContent: response.richContent,
                    sessionContext: response.sessionContext,
                    model: AIProviders.getCurrentModelInfo().model,
                    provider: AIProviders.getCurrentModelInfo().provider
                });

                agentState.completed = true;
                agentState.finalResponse = response;
                ProgressStore.setAgentState(requestId, agentState);

                return { hasMore: false, response: response };
            }

            // No text and no tool calls - try again
            log.debug('Agent received empty response, continuing', { requestId: requestId });
            ProgressStore.setAgentState(requestId, agentState);
            return { hasMore: true, step: { type: 'empty_response' } };

        } catch (e) {
            log.error('Agent step error', {
                requestId: requestId,
                iteration: agentState.iteration,
                error: e.message,
                stack: e.stack
            });

            // Check for fatal errors
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
                ProgressStore.fail(requestId, 'Configuration error: ' + e.message);
                return { hasMore: false, error: 'Configuration error: ' + e.message };
            }

            // Non-fatal error - add retry step and continue
            if (agentState.iteration < MAX_ITERATIONS - 1) {
                ProgressStore.addStep(requestId, {
                    type: 'retry',
                    title: 'Retrying: ' + (e.message || 'Unknown error').substring(0, 50),
                    error: e.message,
                    status: 'complete'
                });

                ProgressStore.setAgentState(requestId, agentState);
                return { hasMore: true, step: { type: 'retry', error: e.message } };
            }

            ProgressStore.fail(requestId, e.message);
            return { hasMore: false, error: e.message };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT LOOP (synchronous - backward compatible)
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

                        // Execute the tool with timing
                        const toolStartTime = Date.now();
                        const result = Tools.executeTool(toolName, parsedArgs);
                        const toolDuration = Date.now() - toolStartTime;

                        // Format rich result for frontend step
                        const stepResult = formatResultForStep(result, toolName, toolDuration);

                        // Update progress step with RICH result data
                        ProgressStore.updateLastStep(requestId, {
                            status: 'complete',
                            ...stepResult,
                            meta: {
                                duration: toolDuration,
                                isLlmCall: false
                            }
                        });

                        // SPECIAL: format_response tool triggers completion
                        if (toolName === 'format_response' && result.success && result.isFormatResponse) {
                            log.debug('format_response tool called in sync mode - completing', {
                                requestId: requestId,
                                blockCount: result.blockCount
                            });

                            return {
                                text: '',
                                richContent: result.richContent,
                                blocksFormat: true,
                                steps: ProgressStore.getSteps(requestId),
                                duration: Date.now() - startTime,
                                sessionContext: sessionContext,
                                llmCalls: llmCalls,
                                allToolCalls: allToolCalls
                            };
                        }

                        toolResults.push({
                            tool: toolName,
                            args: parsedArgs,
                            result: result,
                            duration: toolDuration
                        });

                        allToolCalls.push({
                            tool: toolName,
                            args: parsedArgs,
                            result: result,
                            displayName: displayName,
                            duration: toolDuration
                        });

                        // Add to conversation context WITH ACTUAL DATA for LLM to use
                        conversationContext += `\n--- Tool: ${toolName} ---\n`;
                        conversationContext += `Arguments: ${JSON.stringify(parsedArgs)}\n`;
                        conversationContext += formatResultForLLM(result, toolName) + '\n';
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
     * Summarize a tool result for progress display (short version)
     */
    function summarizeToolResult(result) {
        if (!result.success) {
            return 'Failed: ' + (result.error || 'Unknown error');
        }

        if (result.found === false) {
            return 'Not found';
        }

        if (result.found === true && result.entity) {
            return `Found: ${result.entity.name} (${result.entity.type}, ID: ${result.entity.id})`;
        }

        if (result.found === true && result.bestMatch) {
            return `Found: ${result.bestMatch.name || result.bestMatch.account_name || JSON.stringify(result.bestMatch)}`;
        }

        if (result.rowCount !== undefined || (result.rows && result.rows.length > 0)) {
            const count = result.rowCount || result.rows.length;
            return `Found ${count} results`;
        }

        if (result.data) {
            return 'Dashboard data retrieved';
        }

        return 'Completed';
    }

    /**
     * Format tool result WITH ACTUAL DATA for LLM context
     * This is critical - the LLM needs to SEE the data to use it
     *
     * IMPORTANT: No truncation! The LLM needs ALL data to analyze properly.
     * The LLM is smart enough to handle large datasets and will provide better
     * analysis when it can see the full picture.
     */
    function formatResultForLLM(result, toolName) {
        const lines = [];

        if (!result.success) {
            lines.push(`Status: FAILED`);
            lines.push(`Error: ${result.error || 'Unknown error'}`);
            return lines.join('\n');
        }

        lines.push(`Status: SUCCESS`);

        // Entity resolution - include the ID prominently
        if (result.found === true && result.entity) {
            lines.push(`Found Entity: ${result.entity.name}`);
            lines.push(`Type: ${result.entity.type}`);
            lines.push(`ID: ${result.entity.id} ← USE THIS ID IN SUBSEQUENT QUERIES`);
            return lines.join('\n');
        }

        if (result.found === false) {
            lines.push(`Entity not found - try a different search term or broader query`);
            return lines.join('\n');
        }

        // Classification/Account resolution
        if (result.found === true && result.bestMatch) {
            lines.push(`Found: ${result.bestMatch.name || result.bestMatch.account_name}`);
            lines.push(`ID: ${result.bestMatch.id} ← USE THIS ID IN SUBSEQUENT QUERIES`);
            if (result.bestMatch.account_type) lines.push(`Type: ${result.bestMatch.account_type}`);
            if (result.bestMatch.dimension_type) lines.push(`Dimension: ${result.bestMatch.dimension_type}`);
            return lines.join('\n');
        }

        // Query results with ALL DATA - no truncation!
        const rows = result.rows || [];
        const rowCount = result.rowCount || rows.length;

        if (rowCount > 0) {
            lines.push(`Row Count: ${rowCount}`);

            // Include column names if available
            if (result.columns && result.columns.length > 0) {
                lines.push(`Columns: ${result.columns.join(', ')}`);
            }

            // Include ALL data - LLM needs full dataset to analyze properly
            lines.push(`\nComplete Data (${rowCount} rows):`);
            lines.push('```json');
            lines.push(JSON.stringify(rows, null, 2));
            lines.push('```');

            // Include totals if present
            if (result.totalCash !== undefined) lines.push(`\nTotal Cash: $${result.totalCash.toLocaleString()}`);
            if (result.totalExpenses !== undefined) lines.push(`\nTotal Expenses: $${result.totalExpenses.toLocaleString()}`);
            if (result.variance) lines.push(`\nVariance: ${JSON.stringify(result.variance)}`);

            return lines.join('\n');
        }

        // Dashboard data - include full data
        if (result.data) {
            lines.push(`Dashboard: ${result.dashboard || toolName}`);
            lines.push(`\nDashboard Data:`);
            lines.push('```json');
            lines.push(JSON.stringify(result.data, null, 2));
            lines.push('```');
            return lines.join('\n');
        }

        // Schema exploration
        if (result.schema) {
            lines.push(`Table: ${result.table}`);
            lines.push(`Schema: ${JSON.stringify(result.schema, null, 2)}`);
            return lines.join('\n');
        }

        return 'Completed (no data returned)';
    }

    /**
     * Format tool result for frontend step display
     * Includes preview data and metadata for rich rendering
     */
    function formatResultForStep(result, toolName, duration) {
        const stepData = {
            success: result.success,
            summary: summarizeToolResult(result),
            duration: duration || 0
        };

        if (!result.success) {
            stepData.error = result.error || 'Unknown error';
            return stepData;
        }

        // Entity resolution
        if (result.found !== undefined) {
            stepData.found = result.found;
            if (result.entity) {
                stepData.entity = result.entity;
            }
            if (result.bestMatch) {
                stepData.bestMatch = result.bestMatch;
            }
            return stepData;
        }

        // Query results - include preview
        const rows = result.rows || [];
        const rowCount = result.rowCount || rows.length;

        if (rowCount > 0) {
            stepData.rowCount = rowCount;
            stepData.columns = result.columns || [];
            stepData.preview = rows.slice(0, 5);  // First 5 rows for frontend preview

            // Include computed totals
            if (result.totalCash !== undefined) stepData.totalCash = result.totalCash;
            if (result.totalExpenses !== undefined) stepData.totalExpenses = result.totalExpenses;
            if (result.variance) stepData.variance = result.variance;

            return stepData;
        }

        // Dashboard data - include key metrics
        if (result.data) {
            stepData.dashboard = result.dashboard || toolName;
            stepData.dashboardData = result.data;
            return stepData;
        }

        return stepData;
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
        // Step-by-step execution (for progressive rendering)
        initAgentState: initAgentState,
        runAgentStep: runAgentStep,

        // Synchronous execution (backward compatible)
        runAgent: runAgent,
        runAgentSync: runAgentSync,

        // Utilities
        buildSystemPrompt: buildSystemPrompt,
        MAX_ITERATIONS: MAX_ITERATIONS
    };
});
