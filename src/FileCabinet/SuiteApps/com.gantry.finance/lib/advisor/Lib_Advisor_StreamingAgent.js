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
        REFLECT: 'reflect',   // ReAct pattern - evaluate results and decide next action
        SYNTHESIZE: 'synthesize', // NEW: LLM writes custom SQL when tools fail
        RESPOND: 'respond',   // Merged analyze+format with data access
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

Response format: {"intent": "category", "entities": ["named items"], "time_scope": "ytd|mtd|last_30|custom|none", "needs_resolution": true|false, "references_previous": true|false, "semantic_topics": ["topic1", "topic2"]}`;

    const SELECT_PROMPT = `Select tools to answer this {intent} question. Respond with JSON only.
{date_context}

AVAILABLE TOOLS:
{tool_list}

Question: "{question}"
Intent: {intent}
{entity_context}
{history_context}

Rules:
- Pick 1-3 most relevant tools
- For entity names, include resolve_entity first
- Prefer specific tools over run_custom_query
- For follow_up questions referencing previous data, you may select no tools if data is available
- DO NOT select format_response - that's handled automatically

Response format: {"tools": ["tool1", "tool2"], "reasoning": "brief explanation"}`;

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
  "reasoning": "Why this action is the best choice"
}}`;

    // ═══════════════════════════════════════════════════════════════════════════
    // LLM-DRIVEN TOOL RECOVERY PROMPT
    // When tools fail, let LLM suggest alternatives based on context
    // ═══════════════════════════════════════════════════════════════════════════

    const RECOVERY_PROMPT = `A tool failed while answering a financial question. Suggest an alternative approach.

QUESTION: "{question}"
FAILED TOOL: {failed_tool}
ERROR: {error}

AVAILABLE TOOLS:
{tool_list}

ALREADY TRIED:
{already_tried}

Based on the error and question context, suggest:
1. An alternative tool that could provide similar information
2. Modified parameters that might work better
3. Whether to give up and explain the limitation to the user

Response format (JSON only):
{{
  "suggestion": "TRY_ALTERNATIVE|MODIFY_PARAMS|GIVE_UP",
  "alternative_tool": "tool_name or null",
  "reasoning": "Why this alternative might work",
  "user_message": "Message to show user if giving up"
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

1. ROW LIMITS: Use "FETCH FIRST N ROWS ONLY" (NOT "LIMIT N"!)
   ✓ SELECT * FROM customer FETCH FIRST 100 ROWS ONLY
   ✗ SELECT * FROM customer LIMIT 100

2. DISPLAY NAMES: Use BUILTIN.DF() for foreign key display values
   ✓ BUILTIN.DF(transaction.entity) AS entity_name
   ✓ BUILTIN.DF(tal.account) AS account_name

3. DATE FUNCTIONS:
   - CURRENT_DATE (today)
   - TO_DATE('2024-01-01', 'YYYY-MM-DD')
   - ADD_MONTHS(CURRENT_DATE, -12)
   - TRUNC(date, 'MM') for month start, 'Q' for quarter, 'IW' for week

4. BOOLEANS: Use 'T' for true, 'F' for false
   ✓ WHERE posting = 'T' AND voided = 'F'

5. STRING COMPARISON: Use single quotes
   ✓ WHERE type = 'VendBill'

6. CASE STATEMENTS for conditional aggregation:
   SUM(CASE WHEN condition THEN value ELSE 0 END)

**COMMON PATTERNS:**

YoY Comparison (using CTEs):
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
SELECT c.*, p.amount as prior,
  CASE WHEN p.amount > 0 THEN (c.amount - p.amount) / p.amount * 100 END as yoy_pct
FROM current_year c LEFT JOIN prior_year p ON c.account = p.account

Expense by Category:
SELECT a.acctnumber, a.accountsearchdisplayname,
  SUM(COALESCE(tal.debit,0) - COALESCE(tal.credit,0)) as amount
FROM transactionaccountingline tal
JOIN transaction t ON tal.transaction = t.id
JOIN account a ON tal.account = a.id
WHERE a.accttype = 'Expense' AND t.posting = 'T' AND t.voided = 'F'
GROUP BY a.acctnumber, a.accountsearchdisplayname
ORDER BY amount DESC

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

3. DO NOT create table blocks - tables are rendered separately.
   Only create: text, metrics, list blocks.

4. For metrics, ALWAYS use tokens for the value field:
   {{"label": "Total Revenue", "value": "{{{{data.stats.total:currency}}}}"}}

5. In narrative, cite specific data points using tokens:
   "{{{{data.rows[0].customer_name}}}} leads with {{{{data.rows[0].total_revenue:currency}}}}."

6. TRUNCATION AWARENESS: If a data section shows "truncated: true", inform the user:
   - Mention that more data may be available
   - Suggest they can ask for more results or use more specific filters
   - Example: "Showing the top 500 results. Ask if you'd like to see more or apply filters."

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

            // Follow-up context - preserve data from previous exchanges
            previousDataRefs: sessionContext?.lastDataRefs || null
        };
    }

    /**
     * Build context string from recent history for prompts
     */
    function buildHistoryContext(state) {
        if (!state.history || state.history.length === 0) return '';

        const lines = state.history.map(h => {
            const role = h.role === 'user' ? 'User' : 'Assistant';
            return `${role}: ${h.content}`;
        });

        return `\nRECENT CONVERSATION:\n${lines.join('\n')}\n`;
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
     * Enhanced with follow-up data reuse capability
     */
    function executeSelectPhase(state) {
        const phaseStart = Date.now();

        // ═══════════════════════════════════════════════════════════════════════
        // FOLLOW-UP DATA REUSE
        // If this is a follow-up question and we have previous data, skip tool selection
        // and go directly to RESPOND using the cached data
        // ═══════════════════════════════════════════════════════════════════════
        if (state.intent.intent === 'follow_up' && state.previousDataRefs && state.previousDataRefs.length > 0) {
            log.debug('SCA SELECT phase - follow-up with previous data, skipping tool selection');

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

        const entityContext = state.intent.entities && state.intent.entities.length > 0
            ? `Mentioned entities: ${state.intent.entities.join(', ')}`
            : 'No specific entities mentioned';

        const prompt = SELECT_PROMPT
            .replace('{intent}', state.intent.intent)
            .replace('{tool_list}', getToolListForPrompt())
            .replace('{question}', state.message)
            .replace('{entity_context}', entityContext)
            .replace('{date_context}', getDateContext())
            .replace('{history_context}', buildHistoryContext(state));

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

    /**
     * Phase 3: INVOKE - Call tools one at a time
     * After all tools complete, transitions to REFLECT phase for ReAct pattern evaluation
     */
    function executeInvokePhase(state) {
        // Check if we have more tools to invoke
        const invokedCount = state.toolInvocations.length;
        if (invokedCount >= state.selectedTools.length) {
            // All tools invoked - ADD TABLE BLOCKS IMMEDIATELY before moving to reflect
            // This enables progressive rendering: tables appear BEFORE LLM generates narrative
            addProgressiveTableBlocks(state);

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
                tier: FAST_TIER,
                temperature: 0.1,
                maxTokens: 300,
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
            let result = DataStore.getCachedToolResult(toolName, args);
            let fromCache = false;

            if (result) {
                // Cache hit - use cached result
                fromCache = true;
                log.debug('Tool result from cache', { tool: toolName, args: args });
            } else {
                // Cache miss - execute the tool
                result = Tools.executeTool(toolName, args);
                // Cache successful results
                DataStore.cacheToolResult(toolName, args, result);
            }
            const toolDuration = Date.now() - toolStart;
            const totalDuration = Date.now() - invokeStart;

            // Store data reference if tool returned rows
            let dataRef = null;
            if (result.success && result.rows && result.rows.length > 0) {
                dataRef = DataStore.storeData(state.requestId, toolName, result);
                state.dataReferences.push(dataRef);
                // Track that we found data (for reflection)
                state.reflection.dataFound = true;
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
                resultDetails: invocationResult.details
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
                tier: FAST_TIER,
                temperature: 0.2,
                maxTokens: 500,
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
            `PREVIOUS QUERY FAILED:\n\`\`\`sql\n${state.synthesize.queries[state.synthesize.queries.length - 1]?.sql || 'N/A'}\n\`\`\`\n\nERROR: ${state.synthesize.lastError}\n\nFix the error and try again. Common fixes:\n- Use FETCH FIRST N ROWS ONLY instead of LIMIT\n- Check column names against the schema\n- Use BUILTIN.DF() for display names\n- Verify table joins are correct` :
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
            // Call LLM to generate SQL
            const response = AIProviders.callAI(prompt, {
                tier: FAST_TIER,
                temperature: 0.2,
                maxTokens: 1500,
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
                const dataRef = DataStore.storeData(state.requestId, 'synthesized_query', queryResult);
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

            // Add progressive table block for immediate rendering
            if (queryResult.rows && queryResult.rows.length > 0) {
                addProgressiveTableBlocks(state);
            }

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
                tier: FAST_TIER,
                temperature: 0.2,
                maxTokens: 300,
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

                const data = DataStore.loadRows(state.requestId, dataRef.refId, 0, 49);
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
            'general': ['get_fiscal_context'],
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
                    const maxRank = Math.max(...preview.map(p => p.rank || 0));
                    const allData = DataStore.loadRows(state.requestId, dataRef.refId, 0, maxRank);
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
                if (result.nextPhase === PHASES.ANALYZE) {
                    return { hasMore: true, phase: PHASES.ANALYZE };
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
        // FIX: Merge progressive table blocks from ProgressStore into richContent
        // Tables are added during INVOKE phase via addProgressiveTableBlocks()
        // but were never being included in the final response
        // ═══════════════════════════════════════════════════════════════════════
        const progressState = ProgressStore.get(state.requestId);
        if (progressState && progressState.blocks && progressState.blocks.length > 0) {
            // Get table blocks from progressive rendering
            const tableBlocks = progressState.blocks.filter(b => b.type === 'table');
            if (tableBlocks.length > 0) {
                // Insert tables after text blocks but before metrics/findings
                // Find the position after text blocks
                const textBlockIndex = richContent.findIndex(b => b.type === 'text');
                const insertPosition = textBlockIndex >= 0 ? textBlockIndex + 1 : 0;

                // Insert table blocks at the appropriate position
                richContent = [
                    ...richContent.slice(0, insertPosition),
                    ...tableBlocks,
                    ...richContent.slice(insertPosition)
                ];

                log.debug('Merged progressive table blocks into richContent', {
                    requestId: state.requestId,
                    tableCount: tableBlocks.length,
                    totalBlocks: richContent.length
                });
            }
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
