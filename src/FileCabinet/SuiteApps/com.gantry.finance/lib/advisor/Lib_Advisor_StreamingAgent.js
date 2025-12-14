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
 * 1. INTENT     - Classify the question type (~200 tokens, <1s)
 * 2. SELECT     - Pick relevant tools by name only (~300 tokens, <1s)
 * 3. INVOKE     - Execute tools, store data in N/cache (~200 tokens + tool time)
 * 4. REFLECT    - ReAct pattern: evaluate results, decide next action
 * 5. SYNTHESIZE - NEW: LLM writes custom SuiteQL when tools fail (self-correcting)
 * 6. RESPOND    - LLM sees ACTUAL DATA ROWS, outputs narrative with {{token}} refs
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
        SELECT: 'select',
        INVOKE: 'invoke',
        REFLECT: 'reflect',      // ReAct pattern - evaluate results and decide next action
        SYNTHESIZE: 'synthesize', // LLM writes custom SQL when tools fail
        RESPOND: 'respond',      // Generate final response with data access
        COMPLETE: 'complete'
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // ADAPTIVE INTELLIGENCE ROUTING (AIR)
    // Task-aware model selection for optimal cost/quality balance
    // ═══════════════════════════════════════════════════════════════════════════

    const TIERS = {
        FAST: 1,      // Fast/cheap: Haiku, GPT-4o-mini, Gemini Flash - for classification, params
        BALANCED: 2,  // Balanced: Sonnet, GPT-4o, Gemini Flash - for reasoning
        PREMIUM: 3    // Premium: Opus, GPT-4, Gemini Pro - for complex analysis, SQL synthesis
    };

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
                return TIERS.BALANCED;

            // Premium tier - complex SQL generation needs best model
            case 'synthesize':
                return TIERS.PREMIUM;

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
- entity_lookup: Finding a specific customer, vendor, employee, account
- top_list: Top N customers, vendors, items by some metric
- aging: AR aging, AP aging, overdue amounts
- reporting: Revenue, spend, GL activity, trial balance
- dashboard: Health metrics, KPIs, trends
- comparison: Compare periods, YoY, MoM
- transaction: Specific transaction details
- follow_up: Reference to previous question/data (e.g., "show that as a table", "more details")
- general: General questions, greetings, help

Question: "{question}"

Analyze the SEMANTIC MEANING of the question. Extract:
1. The primary intent category
2. Any named entities mentioned (customer names, vendor names, account names, etc.)
3. The time scope if mentioned
4. Semantic topics - determine what financial domains this question relates to based on meaning (e.g., receivables, payables, revenue, expenses, cash management, profitability)
5. A brief user-friendly narration (max 10 words) describing what you're analyzing, specific to their question

Response format: {"intent": "category", "entities": ["named items"], "time_scope": "ytd|mtd|last_30|custom|none", "needs_resolution": true|false, "references_previous": true|false, "semantic_topics": ["topic1", "topic2"], "userNarration": "Looking into your customer revenue..."}`;

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

1. TIME PERIODS: Use current year ({current_year}). Valid formats:
   - Period params: "ytd", "this_month", "this_quarter", "last_12_months"
   - Date ranges: "{current_year}-01" to "{current_year}-12" (YYYY-MM format)

2. TRANSACTION TYPES - Infer from context (who is paying whom):
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
    // REFLECT PROMPT - ReAct Pattern (Reasoning + Acting)
    // Evaluates tool results and decides next action
    // ═══════════════════════════════════════════════════════════════════════════

    const REFLECT_PROMPT = `You are evaluating tool execution results. Analyze what happened and decide the next action.

{history_context}
CURRENT QUESTION: "{question}"

TOOL EXECUTION SUMMARY:
{tool_summary}

RESOLVED ENTITIES:
{resolved_entities}

DATA COLLECTED:
{data_summary}

═══════════════════════════════════════════════════════════════════════════════
EVALUATE THE RESULTS:

1. Did we successfully answer the question? Consider:
   - Entity resolution: Was the mentioned entity found?
   - Data retrieval: Did we get relevant data rows?
   - Coverage: Do we have enough data to provide a meaningful answer?

2. If results are insufficient, diagnose WHY:
   - ENTITY_NOT_FOUND: The entity (customer/vendor/account) doesn't exist
   - ENTITY_FOUND_NO_DATA: Entity exists but has no transactions/data for this query
   - QUERY_TOO_RESTRICTIVE: Filters (date range, type) excluded all results
   - WRONG_TOOL: Selected tool doesn't match the actual question
   - NO_DATA_EXISTS: This type of data simply doesn't exist in the system

3. Based on diagnosis, decide next action:
   - PROCEED: We have enough data, move to response generation
   - BROADEN: Retry with broader parameters (remove filters, expand date range)
   - DIFFERENT_TOOL: Try a different tool that might work better
   - CLARIFY: We need user clarification (ambiguous entity, unclear intent)
   - GIVE_UP: We've exhausted options, explain what we tried

═══════════════════════════════════════════════════════════════════════════════

Response format (JSON only):
{{
  "evaluation": {{
    "has_useful_data": true|false,
    "entity_found": true|false|null,
    "data_rows_found": number,
    "failure_mode": "SUCCESS|ENTITY_NOT_FOUND|ENTITY_FOUND_NO_DATA|QUERY_TOO_RESTRICTIVE|WRONG_TOOL|NO_DATA_EXISTS"
  }},
  "diagnosis": "Brief explanation of what happened",
  "action": "PROCEED|BROADEN|DIFFERENT_TOOL|CLARIFY|GIVE_UP",
  "action_details": {{
    "tool": "tool_name_if_retry",
    "modified_params": {{}},
    "clarification_question": "question_if_clarify",
    "explanation": "explanation_if_give_up"
  }},
  "reasoning": "Why this action is the best choice",
  "userNarration": "Brief insight about what you found (max 10 words, specific to data)"
}}`;

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
    // WORLD-CLASS RESPOND PROMPT - LLM as Data Analyst
    // ═══════════════════════════════════════════════════════════════════════════

    const RESPOND_PROMPT = `You are a financial data analyst. Analyze this data and create a response.

{history_context}
CURRENT QUESTION: "{question}"

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

3. OUTPUT FORMAT - Return a JSON object with a "blocks" array.
   You decide the sequence and mix of blocks to tell the best story.

4. AVAILABLE BLOCK TYPES:
   - text: {{"type": "text", "content": "Markdown text with {{{{tokens}}}}"}}
   - metrics: {{"type": "metrics", "items": [{{"label": "Max 4 Words", "value": "{{{{token}}}}", "trend": "up|down|neutral"}}]}}
   - table: {{"type": "table", "dataRef": "ref_xxx", "title": "Optional Title"}}
   - chart: {{"type": "chart", "chartType": "bar|line|pie", "dataRef": "ref_xxx", "x": "column_name", "y": "column_name", "title": "Optional"}}
   - list: {{"type": "list", "title": "Optional Title", "items": ["item1", "item2"]}}

5. BLOCK GUIDELINES:
   - Start with context (text block explaining what you're showing)
   - Place metrics early for quick insights (max 4 metrics)
   - Interleave text explanations between data visualizations
   - Use tables for detailed data (≥5 rows), charts for patterns/comparisons (<15 items)
   - Charts: pie for composition, bar for comparison, line for trends over time
   - End with findings/recommendations (list block)
   - Aim for 3-7 blocks total for a natural narrative flow

6. For metrics:
   - Labels must be MAX 4 WORDS (e.g., "Total Revenue", "Outstanding Balance")
   - ALWAYS use tokens for the value field

7. For charts:
   - Use the dataRef from the DATA section header (e.g., "ref_cust_abc123")
   - x and y must be actual column names from the data
   - Only create charts when the data has appropriate structure

8. For tables:
   - Reference the dataRef to include the full data
   - Tables will show all rows with pagination

9. TRUNCATION AWARENESS: If a data section shows "truncated: true", mention that more data is available.

═══════════════════════════════════════════════════════════════════════════════
⚠️ CRITICAL: OUTPUT STRUCTURE

You MUST return EXACTLY this structure: {{"blocks": [...]}}

The ONLY valid top-level key is "blocks" - an array of typed block objects.
Any other top-level keys will cause a validation error.

✅ CORRECT STRUCTURE:
{{"blocks": [{{"type": "text", "content": "..."}}, ...]}}
═══════════════════════════════════════════════════════════════════════════════

Response format (JSON only):
{{
  "blocks": [
    {{"type": "text", "content": "Here's an analysis of your data for {{{{data.rows[0].customer_name}}}}..."}},
    {{"type": "metrics", "items": [
      {{"label": "Total Revenue", "value": "{{{{data.stats.total:currency}}}}", "trend": "up"}},
      {{"label": "Record Count", "value": "{{{{data.stats.count}}}}", "trend": "neutral"}}
    ]}},
    {{"type": "text", "content": "The distribution shows interesting patterns:"}},
    {{"type": "chart", "chartType": "bar", "dataRef": "ref_xxx", "x": "customer_name", "y": "total_revenue", "title": "Revenue by Customer"}},
    {{"type": "table", "dataRef": "ref_xxx", "title": "Detailed Breakdown"}},
    {{"type": "list", "title": "Key Findings", "items": [
      "{{{{data.rows[0].customer_name}}}} leads with {{{{data.rows[0].total_revenue:currency}}}}",
      "Top 3 account for majority of total"
    ]}}
  ]
}}`;

    // ═══════════════════════════════════════════════════════════════════════════
    // RESPOND_BLOCKS_SCHEMA - JSON Schema for structured output enforcement
    // Used by providers that support schema-constrained JSON generation
    // ═══════════════════════════════════════════════════════════════════════════
    const RESPOND_BLOCKS_SCHEMA = {
        name: 'advisor_response',
        schema: {
            type: 'object',
            properties: {
                blocks: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            type: {
                                type: 'string',
                                enum: ['text', 'metrics', 'table', 'chart', 'list']
                            },
                            content: { type: 'string' },
                            items: {
                                type: 'array',
                                items: {
                                    oneOf: [
                                        { type: 'string' },
                                        {
                                            type: 'object',
                                            properties: {
                                                label: { type: 'string' },
                                                value: { type: 'string' },
                                                trend: { type: 'string', enum: ['up', 'down', 'neutral'] }
                                            },
                                            required: ['label', 'value']
                                        }
                                    ]
                                }
                            },
                            title: { type: 'string' },
                            dataRef: { type: 'string' },
                            chartType: { type: 'string', enum: ['bar', 'line', 'pie'] },
                            x: { type: 'string' },
                            y: { type: 'string' }
                        },
                        required: ['type']
                    }
                }
            },
            required: ['blocks']
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SCHEMA_CORRECTION_PROMPT - Used when LLM returns wrong format
    // ═══════════════════════════════════════════════════════════════════════════
    const SCHEMA_CORRECTION_PROMPT = `Your previous response used an invalid format.

You MUST return EXACTLY: {"blocks": [...]}

The ONLY valid top-level key is "blocks" containing an array of typed block objects.

Correct structure:
{
  "blocks": [
    {"type": "text", "content": "your analysis text here"},
    {"type": "metrics", "items": [{"label": "Label", "value": "value", "trend": "neutral"}]},
    {"type": "list", "title": "Key Takeaways", "items": ["item 1", "item 2"]}
  ]
}

Now provide the response using ONLY the blocks array format:`;

    // ═══════════════════════════════════════════════════════════════════════════
    // TOOL MANIFEST - Now delegated to Tools.js (single source of truth)
    // The manifest is dynamically generated from tool definitions.
    // Internal tools (exposed: false) are automatically excluded.
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get tool manifest - delegates to Tools.getToolManifest()
     * Dynamically generated from ALL_TOOLS with shortDescription metadata
     */
    function getToolManifest() {
        return Tools.getToolManifest();
    }

    /**
     * Get formatted tool list for LLM prompts - delegates to Tools.getToolListForPrompt()
     */
    function getToolListForPrompt() {
        return Tools.getToolListForPrompt();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RECOMMENDATION 6: PROACTIVE ERROR RECOVERY
    // Maps tools to alternative tools that can provide similar data when failures occur
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get alternative tools to try when a tool fails
     * @param {string} toolName - The failed tool
     * @returns {string[]} Array of alternative tool names to try
     */
    function getAlternativeTools(toolName) {
        const alternatives = {
            // AR tools - try related data sources
            'get_ar_aging': ['dashboard_customervalue', 'get_recent_transactions'],
            'get_customer_revenue': ['get_top_customers', 'dashboard_customervalue'],
            'get_top_customers': ['get_customer_revenue', 'dashboard_customervalue'],

            // AP tools - try related data sources
            'get_ap_aging': ['dashboard_vendorperformance', 'get_recent_transactions'],
            'get_vendor_spend': ['get_top_vendors', 'dashboard_vendorperformance'],
            'get_top_vendors': ['get_vendor_spend', 'dashboard_vendorperformance'],

            // Financial reporting - try related reports
            'get_income_statement': ['get_trial_balance', 'get_gl_activity'],
            'get_balance_sheet': ['get_trial_balance', 'get_cash_position'],
            'get_trial_balance': ['get_gl_activity', 'get_income_statement'],
            'get_gl_activity': ['get_trial_balance', 'get_recent_transactions'],

            // Dashboards - try related dashboards
            'dashboard_health': ['dashboard_cashflow', 'get_cash_position'],
            'dashboard_cashflow': ['get_cash_position', 'dashboard_health'],
            'dashboard_customervalue': ['get_top_customers', 'get_ar_aging'],
            'dashboard_vendorperformance': ['get_top_vendors', 'get_ap_aging'],

            // Entity resolution - try broader search
            'resolve_entity': ['run_custom_query'],
            'resolve_gl_account': ['get_trial_balance'],
            'resolve_classification': ['run_custom_query'],

            // Transactions
            'get_transaction_detail': ['get_recent_transactions'],
            'get_recent_transactions': ['run_custom_query']
        };

        return alternatives[toolName] || [];
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
                    textSummary += `═══ ${collectionName.toUpperCase()} (${collectionInfo.count} items - use load_cached_data for full data) ═══\n`;
                    if (collectionInfo.preview && collectionInfo.preview.length > 0) {
                        textSummary += `Preview: ${collectionInfo.preview.join(', ')}${collectionInfo.count > 3 ? '...' : ''}\n`;
                    }
                    textSummary += `Columns: ${(collectionInfo.columns || []).join(', ')}\n`;
                    textSummary += `RefId: ${collectionInfo.refId} (use with load_cached_data tool)\n\n`;
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

        return dataRef;
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
                state.phase = PHASES.SELECT;

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
     * Enhanced with follow-up data reuse capability
     */
    function executeSelectPhase(state) {
        const phaseStart = Date.now();

        // ═══════════════════════════════════════════════════════════════════════
        // CONVERSATIONAL QUERIES - Skip tool selection entirely for greetings/chitchat
        // No point asking LLM to select tools when we know none are needed
        // ═══════════════════════════════════════════════════════════════════════
        if (state.intent && state.intent.intent === 'general') {
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

        // ═══════════════════════════════════════════════════════════════════════
        // FOLLOW-UP DATA REUSE vs DRILL-DOWN DETECTION
        // Check if user is asking for DRILL-DOWN details (specific collection data)
        // or just referencing previous data for context
        // ═══════════════════════════════════════════════════════════════════════
        if (state.intent.intent === 'follow_up' && state.previousDataRefs && state.previousDataRefs.length > 0) {
            // Check if this looks like a drill-down request for specific data
            const drillDownKeywords = [
                'detail', 'details', 'show me', 'list', 'table', 'all',
                'weekly', 'projection', 'bucket', 'breakdown', 'items',
                'collection', 'drill', 'expand', 'full data', 'complete'
            ];
            const messageLower = state.message.toLowerCase();
            const isDrillDownRequest = drillDownKeywords.some(kw => messageLower.includes(kw));

            // Check if previous data was from a dashboard (has collections)
            const hasDashboardData = state.previousDataRefs.some(ref => {
                const cols = ref.summary?.columns || [];
                return cols.includes('refId') || ref.refId?.startsWith('dash_');
            });

            if (isDrillDownRequest && hasDashboardData) {
                // This looks like a drill-down request - let LLM select load_cached_data
                log.debug('SCA SELECT phase - detected drill-down request, allowing tool selection', {
                    message: state.message.substring(0, 50),
                    hasDashboardData: true
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
            .replace('{tool_list}', getToolListForPrompt())
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
                availableTools: Object.keys(getToolManifest()).length
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
                    selectedTools = getDefaultToolsForIntent(state.intent.intent);
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
            state.selectedTools = getDefaultToolsForIntent(state.intent.intent);

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
        // DYNAMIC ENTITY ID INJECTION
        // Instead of hardcoded tool lists, inspect the tool's parameter schema
        // This automatically works for any new tools added in the future
        // ═══════════════════════════════════════════════════════════════════════

        // Get tool schema to determine which parameters it accepts
        const tool = Tools.getTool(toolName);
        const toolParams = tool?.parameters?.properties || {};

        // Mapping from entity type to parameter name(s)
        const ENTITY_TYPE_TO_PARAMS = {
            'customer': ['customer_id', 'entity_id'],
            'vendor': ['vendor_id', 'entity_id'],
            'employee': ['employee_id', 'entity_id'],
            'account': ['account_id'],
            'item': ['item_id'],
            'project': ['project_id', 'job_id'],
            'class': ['class_id'],
            'department': ['department_id'],
            'location': ['location_id']
        };

        for (const [searchTerm, entity] of resolvedEntries) {
            if (!entity || !entity.id) continue;

            const entityType = (entity.type || '').toLowerCase();
            const candidateParams = ENTITY_TYPE_TO_PARAMS[entityType] || [];

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
                        entityType: entityType
                    });
                    // Only inject into the first matching parameter
                    break;
                }
            }
        }

        return enhanced;
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
                    const searchTerm = args.term || args.name || 'unknown';
                    state.resolvedEntities[searchTerm] = result.entity;
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
                        searchTerm: args.term,
                        typeHint: args.type_hint || 'auto'
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
                const alternatives = getAlternativeTools(toolName);

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
                    details: { searchTerm: args.term, typeHint: args.type_hint }
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
        // QUICK CHECK: Only skip LLM reflection if ALL tools succeeded with data
        // If ANY tool returned 0 rows, we need to evaluate whether to retry
        // ═══════════════════════════════════════════════════════════════════════
        const hasUsefulData = state.dataReferences.length > 0;
        const totalRows = state.toolInvocations.reduce((sum, inv) =>
            sum + (inv.rowCount || 0), 0);

        // Check if any tool returned 0 rows OR failed entirely (partial failure)
        const toolsWithNoData = state.toolInvocations.filter(inv =>
            inv.success && (inv.rowCount === 0 || inv.rowCount === undefined)
        );
        const toolsWithErrors = state.toolInvocations.filter(inv => !inv.success);
        const hasPartialFailure = (toolsWithNoData.length > 0 || toolsWithErrors.length > 0) && hasUsefulData;

        // Only fast-path to RESPOND if ALL tools returned data
        // If there's a partial failure, let LLM evaluate if we should retry
        if (hasUsefulData && totalRows > 0 && !hasPartialFailure) {
            // All tools returned data - proceed to RESPOND
            state.reflection.hasReflected = true;
            state.reflection.failureMode = FAILURE_MODES.SUCCESS;
            state.phase = PHASES.RESPOND;

            log.debug('SCA REFLECT phase - all tools returned data, proceeding to RESPOND', {
                dataRefs: state.dataReferences.length,
                totalRows: totalRows
            });

            return { success: true, nextPhase: PHASES.RESPOND };
        }

        // Log partial failure for debugging
        if (hasPartialFailure) {
            log.debug('SCA REFLECT phase - partial failure detected, evaluating with LLM', {
                toolsWithData: state.toolInvocations.filter(t => t.rowCount > 0).map(t => t.tool),
                toolsWithNoData: toolsWithNoData.map(t => t.tool),
                toolsWithErrors: toolsWithErrors.map(t => ({ tool: t.tool, error: t.error })),
                totalRows: totalRows
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // NO DATA CASE: Use LLM to evaluate and decide next action
        // ═══════════════════════════════════════════════════════════════════════

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

        try {
            const response = AIProviders.callAI(prompt, {
                tier: getTierForPhase('reflect', state),
                temperature: 0.2,
                jsonMode: true,
                purpose: 'SCA:reflect'
            });

            const parsed = parseJsonResponse(response?.text);
            const duration = Date.now() - phaseStart;
            state.phaseTimings.reflect = (state.phaseTimings.reflect || 0) + duration;

            if (!parsed || !parsed.action) {
                throw new Error('Invalid reflect response - missing action');
            }

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
                debug: buildDebugInfo(prompt, response, state, { reflection: parsed })
            });

            log.debug('SCA REFLECT phase complete', {
                action: parsed.action,
                failureMode: parsed.evaluation?.failure_mode,
                nextPhase: nextPhase,
                duration: duration
            });

            return { success: true, nextPhase: nextPhase };

        } catch (e) {
            const duration = Date.now() - phaseStart;
            log.error('SCA REFLECT phase failed', { error: e.message, duration: duration });
            state.errors.push({ phase: 'reflect', error: e.message, timestamp: Date.now() });

            // Default: proceed to RESPOND with what we have
            state.phase = PHASES.RESPOND;

            upsertThinkingStep(state, 'reflect', {
                title: 'Evaluating results',
                phase: 'reflect',
                status: 'complete',
                duration: duration,
                context: {
                    fallback: true,
                    error: e.message.substring(0, 100)
                }
            });

            return { success: true, nextPhase: PHASES.RESPOND };
        }
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
                // We have enough data (or gave up trying)
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

                // Loop back to synthesize (self-correction)
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

            // Tables will appear in final response - progressive narration provides context

            // Proceed to RESPOND with the data
            state.phase = PHASES.RESPOND;
            return { success: true, nextPhase: PHASES.RESPOND };

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
     */
    function buildToolSummaryForReflection(state) {
        if (state.toolInvocations.length === 0) {
            return 'No tools were executed.';
        }

        return state.toolInvocations.map((inv, idx) => {
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

            return `${idx + 1}. ${inv.tool}: ${status} (${inv.rowCount || 0} rows)\n   ${details.join('\n   ')}`;
        }).join('\n\n');
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
     */
    function buildDataSummaryForReflection(state) {
        if (state.dataReferences.length === 0) {
            return 'NO DATA was collected. All queries returned 0 rows.';
        }

        return state.dataReferences.map(ref => {
            const summary = ref.summary || {};
            return `- ${summary.tool || 'Unknown'}: ${summary.rowCount || 0} rows`;
        }).join('\n');
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
            .replace('{tool_list}', getToolListForPrompt())
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

        const prompt = RESPOND_PROMPT
            .replace('{history_context}', buildHistoryContext(state))
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

        // Track raw response for diagnostics (outside try block for catch access)
        let lastRawResponse = null;

        try {
            // ═══════════════════════════════════════════════════════════════════════
            // ATTEMPT 1: Call with JSON schema enforcement (if provider supports it)
            // maxTokens dynamically calculated from model's maxOutput (100% for respond)
            // ═══════════════════════════════════════════════════════════════════════
            const response = AIProviders.callAI(prompt, {
                tier: getTierForPhase('respond', state),
                temperature: 0.3,
                jsonMode: true,
                jsonSchema: RESPOND_BLOCKS_SCHEMA,
                purpose: 'SCA:respond'
            });

            let parsed = parseJsonResponse(response?.text);
            let retried = false;
            lastRawResponse = response?.text; // Capture for diagnostics

            // ═══════════════════════════════════════════════════════════════════════
            // ATTEMPT 2: If wrong format, retry with explicit correction prompt
            // LLMs sometimes ignore schema and return familiar patterns from training
            // ═══════════════════════════════════════════════════════════════════════
            if (parsed && !parsed.blocks) {
                log.debug('SCA Respond: wrong format detected, retrying with correction', {
                    receivedKeys: Object.keys(parsed),
                    hasNarrative: !!parsed.narrative,
                    hasFindings: !!parsed.findings,
                    rawPreview: (response?.text || '').substring(0, 300)
                });

                // Build correction prompt with original context + correction instructions
                const correctionPrompt = prompt + '\n\n' + SCHEMA_CORRECTION_PROMPT;

                const retryResponse = AIProviders.callAI(correctionPrompt, {
                    tier: getTierForPhase('respond', state),
                    temperature: 0.2, // Lower temperature for more deterministic output
                    jsonMode: true,
                    jsonSchema: RESPOND_BLOCKS_SCHEMA,
                    purpose: 'SCA:respond:retry'
                });

                parsed = parseJsonResponse(retryResponse?.text);
                lastRawResponse = retryResponse?.text; // Update for diagnostics
                retried = true;

                log.debug('SCA Respond: retry result', {
                    hasBlocks: !!(parsed && parsed.blocks),
                    blockCount: parsed?.blocks?.length || 0,
                    rawPreview: (retryResponse?.text || '').substring(0, 300)
                });
            }

            const duration = Date.now() - phaseStart;
            state.phaseTimings.respond = duration;

            if (parsed && parsed.blocks && Array.isArray(parsed.blocks)) {
                // ═══════════════════════════════════════════════════════════════════════
                // BLOCK SEQUENCE ARCHITECTURE: LLM controls block order and content
                // ═══════════════════════════════════════════════════════════════════════

                const resolvedBlocks = resolveBlockSequence(parsed.blocks, state);

                // Extract summary from first text block
                const firstTextBlock = resolvedBlocks.find(b => b.type === 'text');
                const summary = firstTextBlock?.content?.substring(0, 150) || '';

                log.debug('SCA Respond: block sequence format', {
                    blockCount: resolvedBlocks.length,
                    blockTypes: resolvedBlocks.map(b => b.type),
                    retried: retried
                });

                // Build formatted response
                state.formattedResponse = {
                    title: 'Analysis Results',
                    summary: summary,
                    blocks: resolvedBlocks
                };

                state.phase = PHASES.COMPLETE;

                upsertThinkingStep(state, 'respond', {
                    title: 'Generating response',
                    phase: 'respond',
                    status: 'complete',
                    duration: duration,
                    context: {
                        blockCount: resolvedBlocks.length,
                        tokensResolved: true,
                        hasCharts: resolvedBlocks.some(b => b.type === 'chart'),
                        hasTables: resolvedBlocks.some(b => b.type === 'table'),
                        retried: retried
                    },
                    debug: buildDebugInfo(prompt, response, state, {
                        blockCount: resolvedBlocks.length,
                        blockTypes: resolvedBlocks.map(b => b.type).join(','),
                        retried: retried
                    })
                });

                log.debug('SCA Respond phase complete', { duration: duration, retried: retried });
                return { success: true, nextPhase: PHASES.COMPLETE };
            }

            // Build diagnostic info about what we received
            const receivedKeys = parsed ? Object.keys(parsed) : [];
            const rawPreview = (lastRawResponse || '').substring(0, 200);

            log.error('SCA Respond: invalid format after all attempts', {
                retried: retried,
                receivedKeys: receivedKeys,
                rawPreview: rawPreview
            });

            throw new Error('Invalid respond output - expected blocks array, got keys: [' + receivedKeys.join(', ') + ']' + (retried ? ' (after retry)' : ''));

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
                    phase: 'respond',
                    fallback: true,
                    error: e.message.substring(0, 150),
                    rawPreview: (typeof lastRawResponse === 'string' ? lastRawResponse.substring(0, 200) : 'N/A')
                }
            });

            return { success: true, nextPhase: PHASES.COMPLETE };
        }
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
     * Resolve {{tokens}} in a text string
     * Supports: {{data.rows[N].column}}, {{data.rows[N].column:currency}}, {{data.stats.X}}
     * FIXED: Added explicit bounds checking for array index access (Bug 4 / Rec 3)
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

                // Use dataRef.requestId for follow-up queries
                const data = Cache.loadRows(dataRef.requestId || state.requestId, dataRef.refId, 0, 49);
                if (!data) return match;

                const totalRows = data.range?.total || data.rows.length;

                // Handle data.rows[N].column
                const rowMatch = path.match(/data\.rows\[(\d+)\]\.(\w+)/);
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
                            availableRows: data.rows.length
                        });
                        return match; // Keep original token as fallback
                    }
                    if (data.rows[rowIdx] === null || data.rows[rowIdx] === undefined) {
                        return match;
                    }
                    const value = data.rows[rowIdx][column];
                    return formatResolvedValue(value, format, column);
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
     */
    function buildFailureModeResponse(state) {
        const failureMode = state.reflection.failureMode;
        const entityFound = state.reflection.entityFound;

        // Default response
        let title = 'Unable to Find Data';
        let summary = "I couldn't find the data needed to answer your question.";
        let blocks = [];

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
                tier: FAST_TIER,
                temperature: 0.7,
                purpose: 'SCA:intent' // Conversational responses are short like intent
            });

            if (response && response.trim()) {
                return response.trim();
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
     * Get default tools for a given intent when LLM selection fails
     * FIXED: Added 'follow_up' intent to use cached data instead of refetching
     */
    function getDefaultToolsForIntent(intent) {
        const defaults = {
            'entity_lookup': ['resolve_entity'],
            'top_list': ['get_top_customers'],
            'aging': ['get_ar_aging'],
            'reporting': ['get_recent_transactions'],
            'dashboard': ['dashboard_health'],
            'comparison': ['compare_periods'],
            'transaction': ['get_transaction_detail'],
            // FIXED: general intent (greetings, chitchat) should NOT invoke tools
            // Let the conversational handler in RESPOND phase deal with it
            'general': [],
            // FIXED: follow_up intent should NOT invoke new tools - it should use cached data
            // Empty array signals to skip INVOKE phase and go directly to RESPOND with existing data
            'follow_up': []
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

        // Utilities
        getToolManifest: getToolManifest,
        getToolListForPrompt: getToolListForPrompt
    };
});
