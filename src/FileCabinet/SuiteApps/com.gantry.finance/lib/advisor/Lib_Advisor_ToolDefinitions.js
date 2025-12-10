/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_ToolDefinitions.js
 * Tool schemas and definitions for the Advisor module
 * 
 * Contains:
 * - PLANNING_TOOL
 * - AGENT_TOOLS
 * - SUITEQL_TOOL
 * - THINK_TOOL
 * - INSPECT_RESULT_TOOL
 * - getAgentToolsForPlan
 */
define(['N/log', './Lib_Advisor_Templates'], function(log, Templates) {
    'use strict';

    /**
     * Tool definition for SuiteQL query execution
     */
    const SUITEQL_TOOL = {
        name: 'execute_suiteql',
        description: 'Execute a SuiteQL query to retrieve financial data from NetSuite. Use this when you need to query transaction, customer, vendor, or other NetSuite data.',
        parameters: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: 'The complete SuiteQL SELECT statement to execute' 
                },
                description: { 
                    type: 'string', 
                    description: 'Brief description of what this query returns (e.g., "Top 10 customers by revenue YTD")' 
                }
            },
            required: ['query', 'description']
        }
    };

    /**
     * Planning-phase entity resolution tool
     * Allows the planner to discover entity types BEFORE selecting templates
     * 
     * KEY INSIGHT: "invoices from oracle" requires knowing Oracle's type:
     * - If Oracle is a VENDOR → use vendor_bills template
     * - If Oracle is a CUSTOMER → use customer_invoices template
     * 
     * By resolving during planning, the LLM can make informed template decisions.
     */
    const PLANNING_RESOLVE_ENTITY_TOOL = {
        name: 'resolve_entity',
        description: `Look up an entity (customer, vendor, department, etc.) to discover its type and ID.

WHEN TO USE: Call this BEFORE create_plan when you see entity names and need to know their type to select the right template.

CRITICAL EXAMPLES:
- "invoices from oracle" → resolve_entity("oracle", "auto") 
  - If returns type:"vendor" → Oracle sends US bills, use vendor templates
  - If returns type:"customer" → We send Oracle invoices, use customer templates
- "revenue for shop department" → resolve_entity("shop", "department")

The returned entity type determines which templates are appropriate.
After resolving, call create_plan with the knowledge of what type each entity is.`,
        parameters: {
            type: 'object',
            properties: {
                term: { 
                    type: 'string', 
                    description: 'The name/term to look up (e.g., "oracle", "acme", "shop")' 
                },
                entity_type: { 
                    type: 'string', 
                    enum: ['customer', 'vendor', 'department', 'employee', 'item', 'project', 'account', 'auto'],
                    description: 'Expected type, or "auto" to search all types. Use "auto" when unsure.'
                }
            },
            required: ['term', 'entity_type']
        }
    };

    /**
     * Planning tool - CANONICAL DEFINITION
     * Used for structured plan extraction via formal tool calling
     * This ensures the model returns entities_to_resolve reliably
     * 
     * Enhanced with:
     * - query_complexity indicator for advanced patterns
     * - pattern_reference for complex query types
     * - template_modification for adjusted templates
     * - is_follow_up for LLM-based follow-up detection
     */
    const PLANNING_TOOL = {
        name: 'create_plan',
        description: 'Create an execution plan for the user question. You MUST call this tool with your plan.',
        parameters: {
            type: 'object',
            properties: {
                complexity: {
                    type: 'string',
                    enum: ['simple', 'multi_step'],
                    description: 'simple = 1 query/dashboard, multi_step = multiple queries or comparisons'
                },
                reasoning: {
                    type: 'string',
                    description: 'Explain what the question asks and your strategy'
                },
                is_follow_up: {
                    type: 'boolean',
                    description: 'Is this a follow-up/continuation of the previous question? True if user references "same", "that", "again", asks to filter previous results, or continues a topic from the conversation. False for new/standalone questions.'
                },
                entities_to_resolve: {
                    type: 'array',
                    description: 'ALL entity names mentioned that need lookup. REQUIRED for any company, person, or department name.',
                    items: {
                        type: 'object',
                        properties: {
                            term: { type: 'string', description: 'The name/term to resolve (e.g., "acme", "birla", "shop")' },
                            entity_type: { 
                                type: 'string', 
                                enum: ['customer', 'vendor', 'department', 'employee', 'auto'],
                                description: 'Type of entity. Use "auto" if unsure.'
                            }
                        },
                        required: ['term', 'entity_type']
                    }
                },
                execution_strategy: {
                    type: 'string',
                    enum: ['dashboard', 'template', 'template_modification', 'pattern_query', 'custom_query', 'multi_step'],
                    description: 'How to execute: dashboard (pre-built viz), template (exact match), template_modification (template with changes), pattern_query (use known SQL pattern), custom_query (write new SQL), multi_step (multiple operations)'
                },
                template_match: {
                    type: 'string',
                    description: 'Exact template ID if using template or template_modification strategy, null otherwise'
                },
                template_modifications: {
                    type: 'string',
                    description: 'If template_modification, describe what changes to make (e.g., "add department filter for Shop", "change date range to last 90 days")'
                },
                pattern_reference: {
                    type: 'string',
                    enum: ['budget_vs_actuals', 'system_note_audit', 'serial_lot_trace', 'project_profitability', 'order_lifecycle', 'inventory_by_bin', 'ar_aging_detail_tal', 'ar_aging_summary_tal', 'gl_detail', 'trial_balance_ytd', null],
                    description: 'If pattern_query, which known pattern to use. These are complex, validated queries for specific scenarios.'
                },
                query_complexity: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'very_high'],
                    description: 'Query complexity indicator. high/very_high for: Budget tables, NextTransactionLineLink, SystemNote, InventoryAssignment, multi-book accounting'
                },
                dashboard_suggestion: {
                    type: 'string',
                    enum: ['cashflow', 'health', 'burden', 'time', null],
                    description: 'Dashboard to use if dashboard strategy'
                },
                requires_synthesis: {
                    type: 'boolean',
                    description: 'Whether LLM synthesis is needed after data retrieval. TRUE for analysis/comparison/trends/insights. FALSE for simple data retrieval (show, list, what are, who are).'
                },
                synthesis_instructions: {
                    type: 'string',
                    description: 'If requires_synthesis is true, specific instructions for what to analyze or highlight. Null if requires_synthesis is false.'
                },
                plan: {
                    type: 'array',
                    description: 'Steps to execute',
                    items: {
                        type: 'object',
                        properties: {
                            step: { type: 'integer' },
                            action: { type: 'string', enum: ['resolve_entity', 'query', 'template', 'dashboard', 'synthesize'] },
                            purpose: { type: 'string' }
                        }
                    }
                },
                estimated_queries: {
                    type: 'integer',
                    description: 'Number of queries expected (1-5)'
                }
            },
            required: ['complexity', 'reasoning', 'is_follow_up', 'entities_to_resolve', 'execution_strategy', 'requires_synthesis', 'plan']
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // NEW AGENTIC TOOLS - Enhanced Analysis Capabilities
    // ═══════════════════════════════════════════════════════════════════════════════
    
    const THINK_TOOL = {
        name: 'think',
        description: 'Analyze data and decide next steps. OPTIMIZATION: If you know the specific query you want to run next, provide it in "suggested_query" to save a turn. If you have enough data to answer, provide "preliminary_answer" to finish immediately.',
        parameters: {
            type: 'object',
            properties: {
                observations: {
                    type: 'string',
                    description: 'What patterns, gaps, or insights do you see in the data so far?'
                },
                data_gaps: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'What additional data is needed to answer the question?'
                },
                next_action: {
                    type: 'string',
                    enum: ['query_more', 'inspect_data', 'compare', 'aggregate', 'done'],
                    description: 'What should be done next?'
                },
                suggested_query: {
                    type: 'string',
                    description: 'OPTIONAL: If next_action is query_more, write the SuiteQL here to execute immediately (saves a turn).'
                },
                preliminary_answer: {
                    type: 'string',
                    description: 'OPTIONAL: If next_action is done and you have enough data, provide your complete answer here to finish immediately.'
                },
                reasoning: {
                    type: 'string',
                    description: 'Why is this the right next step?'
                }
            },
            required: ['observations', 'next_action', 'reasoning']
        }
    };
    
    /**
     * Powerful reflection tool for adaptive planning
     * Use when: unexpected results, zero rows, new insights require plan changes
     */
    const REFLECT_AND_ADAPT_TOOL = {
        name: 'reflect_and_adapt',
        description: `POWERFUL REFLECTION TOOL: Use when query results reveal something unexpected that requires adapting the plan.

WHEN TO USE:
- Query returned 0 rows (data might not exist for that period/entity)
- Results reveal unexpected patterns (negative values, missing periods, new entities)  
- You realize the original plan is insufficient to fully answer the question
- Results suggest a better approach than originally planned

This tool lets you:
1. Analyze what you've learned
2. Decide if/how to modify the remaining plan
3. Add new queries if needed
4. Skip planned queries if data doesn't exist

After reflection, the agent will execute your adapted plan.`,
        parameters: {
            type: 'object',
            properties: {
                analysis: {
                    type: 'string',
                    description: 'Deep analysis of what the data reveals. What surprised you? What patterns emerge? What\'s missing?'
                },
                key_findings: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List 2-5 key insights from the data so far'
                },
                plan_assessment: {
                    type: 'string',
                    enum: ['on_track', 'needs_modification', 'needs_expansion', 'can_simplify', 'blocked'],
                    description: 'How is the current plan working? on_track=continue as planned, needs_modification=change remaining steps, needs_expansion=add more queries, can_simplify=skip unnecessary steps, blocked=cannot proceed without user input'
                },
                plan_modifications: {
                    type: 'array',
                    description: 'Changes to make to the remaining plan (only if plan_assessment is not on_track)',
                    items: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                enum: ['add_query', 'skip_step', 'modify_step', 'change_synthesis'],
                                description: 'Type of modification'
                            },
                            reason: {
                                type: 'string',
                                description: 'Why this modification is needed'
                            },
                            step_number: {
                                type: 'integer',
                                description: 'For skip_step/modify_step: which planned step (1-based)'
                            },
                            new_query: {
                                type: 'object',
                                description: 'For add_query: the new query to add',
                                properties: {
                                    purpose: { type: 'string', description: 'What this query retrieves' },
                                    sql: { type: 'string', description: 'Optional: SuiteQL to execute. If omitted, agent will generate.' }
                                }
                            },
                            new_synthesis: {
                                type: 'string',
                                description: 'For change_synthesis: updated synthesis instructions'
                            }
                        },
                        required: ['action', 'reason']
                    }
                },
                next_immediate_action: {
                    type: 'string',
                    enum: ['continue_plan', 'execute_new_query', 'skip_to_synthesis', 'ask_user'],
                    description: 'What to do immediately after this reflection'
                },
                immediate_query: {
                    type: 'object',
                    description: 'If next_immediate_action is execute_new_query, provide the query',
                    properties: {
                        sql: { type: 'string', description: 'SuiteQL query' },
                        purpose: { type: 'string', description: 'What this retrieves' }
                    }
                },
                user_question: {
                    type: 'string',
                    description: 'If next_immediate_action is ask_user, what to ask'
                },
                confidence: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                    description: 'How confident are you in this adaptation?'
                }
            },
            required: ['analysis', 'plan_assessment', 'next_immediate_action', 'confidence']
        }
    };
    
    const INSPECT_RESULT_TOOL = {
        name: 'inspect_result',
        description: `Get more details from a previous query result. Use when you need to filter data, or compute aggregations.

⚠️ DO NOT use more_rows if:
- Query had a LIMIT/FETCH FIRST and returned exactly that many rows (no additional rows exist)
- You already have all the data you need visible in the result summary

Only use more_rows when the result summary shows "... +N more" indicating truncated display.`,
        parameters: {
            type: 'object',
            properties: {
                result_step: {
                    type: 'integer',
                    description: 'Which step\'s result to inspect (1-based)'
                },
                action: {
                    type: 'string',
                    enum: ['more_rows', 'specific_columns', 'filter', 'aggregate'],
                    description: 'What to do: more_rows (see hidden rows - only if result was truncated), specific_columns (subset columns), filter (find matching rows), aggregate (sum/avg/etc)'
                },
                columns: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'For specific_columns: which columns to show'
                },
                filter_column: {
                    type: 'string',
                    description: 'For filter: column to filter on'
                },
                filter_value: {
                    type: 'string',
                    description: 'For filter: value to match'
                },
                aggregate_column: {
                    type: 'string',
                    description: 'For aggregate: column to aggregate'
                },
                aggregate_function: {
                    type: 'string',
                    enum: ['sum', 'avg', 'min', 'max', 'count'],
                    description: 'For aggregate: function to apply'
                },
                group_by: {
                    type: 'string',
                    description: 'For aggregate: column to group by'
                }
            },
            required: ['result_step', 'action']
        }
    };

    /**
     * Final response tool - structured output for AI responses
     * ═══════════════════════════════════════════════════════════════
     * CRITICAL: This constant MUST be exported for DashboardHandler 
     * and QueryExecution to use. Without this export, dashboard 
     * interpretation fails with "Cannot read property 'name' of undefined"
     * ═══════════════════════════════════════════════════════════════
     */
    const FINAL_RESPONSE_TOOL = {
        name: 'final_response',
        description: `Provide the final response to the user using structured content blocks. ALWAYS use this tool when you have all needed data - NEVER output plain text responses.

⚠️ CRITICAL REQUIREMENTS:
- If you executed queries that returned data, you MUST include at least one 'table' block using resultRef
- You MUST include a 'metrics' block with calculated totals/KPIs from the data
- Text blocks should explain and analyze the data - NOT just say "data is ready" or "analysis complete"
- A response with ONLY text and no data blocks is UNACCEPTABLE when data was collected

Structure your response as an array of blocks that will render in order. Mix text explanations with data visualizations for maximum clarity.

Block types:
- text: Markdown text content (explanations, analysis, insights)
- table: Display query results as a table (reference by step number using resultRef)
- chart: Visualize data (bar, line, pie charts)
- metrics: Key numbers/KPIs in card format - REQUIRED when data has totals
- callout: Highlighted info/warning/success boxes

Example blocks structure for a comparative analysis:
[
  { "type": "metrics", "items": [
    { "label": "Current Year Total", "value": 1500000, "format": "currency" },
    { "label": "Prior Year Total", "value": 1200000, "format": "currency" },
    { "label": "YoY Change", "value": 25, "format": "percent" }
  ]},
  { "type": "text", "content": "Revenue increased 25% year over year, driven primarily by..." },
  { "type": "table", "resultRef": 1, "title": "Current Year Detail" },
  { "type": "table", "resultRef": 2, "title": "Prior Year Detail" }
]`,
        parameters: {
            type: 'object',
            properties: {
                blocks: {
                    type: 'array',
                    description: 'Ordered content blocks. Mix text with data visualizations for natural flow.',
                    items: {
                        type: 'object',
                        properties: {
                            type: {
                                type: 'string',
                                enum: ['text', 'table', 'chart', 'metrics', 'callout'],
                                description: 'Block type'
                            },
                            content: {
                                type: 'string',
                                description: 'Markdown text content (for text and callout blocks)'
                            },
                            resultRef: {
                                type: 'integer',
                                description: 'Step number of query result to display (1-based)'
                            },
                            data: {
                                type: 'array',
                                description: 'Data array if not using resultRef',
                                items: { type: 'object' }
                            },
                            title: {
                                type: 'string',
                                description: 'Title for the table or chart'
                            },
                            columns: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Column names to show'
                            },
                            chartType: {
                                type: 'string',
                                enum: ['bar', 'line', 'pie'],
                                description: 'Chart type'
                            },
                            xKey: { type: 'string', description: 'Column name for X axis' },
                            yKey: { type: 'string', description: 'Column name for Y axis' },
                            items: {
                                type: 'array',
                                description: 'Metric items to display',
                                items: {
                                    type: 'object',
                                    properties: {
                                        label: { type: 'string' },
                                        value: { type: 'number' },
                                        format: { type: 'string', enum: ['currency', 'number', 'percent'] }
                                    },
                                    required: ['label', 'value']
                                }
                            },
                            variant: {
                                type: 'string',
                                enum: ['info', 'warning', 'success', 'error'],
                                description: 'Callout style'
                            }
                        },
                        required: ['type']
                    }
                },
                followUpSuggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Suggested follow-up questions (2-4 items)'
                }
            },
            required: ['blocks']
        }
    };

    /**
     * Agent tools for multi-step analysis
     */
    const AGENT_TOOLS = [
        // ═══════════════════════════════════════════════════════════════
        // DASHBOARD DATA TOOL - Use this FIRST for common financial questions
        // ═══════════════════════════════════════════════════════════════
        {
            name: 'get_dashboard_data',
            description: `PREFERRED: Get pre-calculated financial data from a dashboard. ALWAYS use this instead of raw queries for:
- "burden rate" / "burden dashboard" / "labor costs" → dashboard: "burden"
- "cash flow" / "cash position" / "liquidity" / "AR" / "AP" → dashboard: "cashflow"  
- "revenue" / "margins" / "profitability" / "health" → dashboard: "health"
- "utilization" / "billable hours" / "time" → dashboard: "time"

Dashboard data is faster, pre-aggregated, and includes period comparisons. Use execute_query only for specific custom analyses not covered by dashboards.`,
            parameters: {
                type: 'object',
                properties: {
                    dashboard: { 
                        type: 'string', 
                        enum: ['cashflow', 'health', 'burden', 'time'],
                        description: 'Dashboard to query: burden (labor/overhead costs), cashflow (cash/AR/AP), health (revenue/margins), time (utilization/hours)'
                    },
                    focus: { 
                        type: 'string', 
                        description: 'Optional: specific aspect to focus on (e.g., "by department", "trends", "top customers")'
                    },
                    include_details: {
                        type: 'boolean',
                        description: 'Include detailed breakdowns (department-level, customer-level). Default true.'
                    }
                },
                required: ['dashboard']
            }
        },
        
        // ═══════════════════════════════════════════════════════════════
        // ENTITY RESOLUTION - For fuzzy name lookups
        // ═══════════════════════════════════════════════════════════════
        {
            name: 'resolve_entity',
            description: `Resolve fuzzy entity names to exact matches with IDs. ALWAYS use this when users mention customers, vendors, departments, employees, or projects by name.

CRITICAL: After resolving, use the returned ID (not the name) in all subsequent queries and template parameters. For example:
- resolve_entity returns: "mechanical" → Mechanical (ID: 1)
- In templates use: department_id: 1 (NOT department: "Mechanical")

Can resolve MULTIPLE entities in a single call.`,
            parameters: {
                type: 'object',
                properties: {
                    entities: {
                        type: 'array',
                        description: 'Array of entities to resolve. Use this for multiple entities.',
                        items: {
                            type: 'object',
                            properties: {
                                term: { type: 'string', description: 'Search term (e.g., "acme", "mech", "john")' },
                                entity_type: { 
                                    type: 'string', 
                                    enum: ['customer', 'vendor', 'department', 'employee', 'item', 'project', 'account'],
                                    description: 'Type of entity'
                                }
                            },
                            required: ['term', 'entity_type']
                        }
                    },
                    term: { type: 'string', description: 'Single search term (for backwards compatibility)' },
                    entity_type: { 
                        type: 'string', 
                        enum: ['customer', 'vendor', 'department', 'employee', 'item', 'project', 'account'],
                        description: 'Type of entity (for backwards compatibility)'
                    }
                }
            }
        },
        
        // ═══════════════════════════════════════════════════════════════
        // SCHEMA DISCOVERY - For custom records and unknown fields
        // ═══════════════════════════════════════════════════════════════
        {
            name: 'get_record_schema',
            description: `Get the schema (fields, types, sublists) for a NetSuite record type. Use this when:
- You need to query a CUSTOM RECORD (custrecord_*, customrecord_*)
- You need to find specific CUSTOM FIELDS (custbody_*, custentity_*, custitem_*) on a standard record
- You encounter an "invalid column" error and need to discover correct field names
- The user asks about fields available on a record type

IMPORTANT: Use SPECIFIC transaction types, not "transaction":
- For vendor bills: use "vendorbill" (not "transaction")
- For customer invoices: use "invoice" (not "transaction")  
- For sales orders: use "salesorder" (not "transaction")
- For purchase orders: use "purchaseorder" (not "transaction")

Returns field IDs, labels, types, and sublist information. Use the field IDs in your SuiteQL queries.`,
            parameters: {
                type: 'object',
                properties: {
                    record_type: { 
                        type: 'string', 
                        description: 'The specific record type ID (e.g., "customer", "invoice", "vendorbill", "salesorder", "custrecord_my_custom_log"). Do NOT use generic "transaction".'
                    }
                },
                required: ['record_type']
            }
        },
        
        // ═══════════════════════════════════════════════════════════════
        // TEMPLATE EXECUTION - For common query patterns
        // ═══════════════════════════════════════════════════════════════
        {
            name: 'execute_template',
            description: 'Execute a pre-built query template identified during planning. The planning phase has already determined which template to use.',
            parameters: {
                type: 'object',
                properties: {
                    template_id: { 
                        type: 'string', 
                        description: 'Template ID from the plan (e.g., "top_customers_by_department", "invoice_lookup")'
                    },
                    parameters: { 
                        type: 'object', 
                        description: 'Template parameters with entity IDs (e.g., { "department_id": 1, "fiscal_year": "current" })'
                    },
                    purpose: {
                        type: 'string',
                        description: 'Brief description of what this query retrieves'
                    }
                },
                required: ['template_id']
            }
        },
        
        // ═══════════════════════════════════════════════════════════════
        // CUSTOM QUERY - For specific/custom analyses
        // ═══════════════════════════════════════════════════════════════
        {
            name: 'execute_query',
            description: 'Execute a custom SuiteQL query. Use ONLY when dashboards and templates cannot answer the question. Prefer get_dashboard_data for standard metrics.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'SuiteQL SELECT statement' },
                    purpose: { type: 'string', description: 'What this query retrieves' }
                },
                required: ['query', 'purpose']
            }
        },
        // Final response tool - extracted as constant for reuse
        FINAL_RESPONSE_TOOL,
        // New analysis tools
        THINK_TOOL,
        INSPECT_RESULT_TOOL,
        REFLECT_AND_ADAPT_TOOL,
        
        // Deep thinking for complex analysis (from AdaptiveIntelligence)
        {
            name: 'deep_think',
            description: `EXTENDED REASONING: Use for complex analysis requiring careful thought.

Unlike quick 'think' tool, deep_think is for:
• Synthesizing multiple data sources into coherent understanding
• Forming and testing hypotheses about what the data means
• Resolving contradictions between different data points
• Planning complex multi-step investigations
• Making high-stakes conclusions with confidence assessment

The system records your reasoning in working memory for continuity.

WHEN TO USE:
- After gathering 2+ data sources that need synthesis
- When data is surprising or contradicts expectations
- Before making important conclusions
- When you need to revise the investigation plan`,
            parameters: {
                type: 'object',
                properties: {
                    thinking_type: {
                        type: 'string',
                        enum: ['synthesize', 'hypothesize', 'investigate', 'resolve_contradiction', 'conclude'],
                        description: 'synthesize=combine data, hypothesize=form theory, investigate=plan queries, resolve_contradiction=fix conflicts, conclude=final answer'
                    },
                    context_summary: {
                        type: 'string',
                        description: 'Brief summary of what you know and what you need'
                    },
                    reasoning_steps: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Step-by-step reasoning (each step = clear logical progression)'
                    },
                    hypotheses: {
                        type: 'array',
                        description: 'Hypotheses to form or update',
                        items: {
                            type: 'object',
                            properties: {
                                text: { type: 'string', description: 'The hypothesis' },
                                confidence: { type: 'number', description: 'Confidence 0-1' },
                                action: { 
                                    type: 'string', 
                                    enum: ['add', 'support', 'refute', 'partial'],
                                    description: 'add=new, support/refute/partial=update existing'
                                },
                                hypothesis_id: { type: 'string', description: 'For updates: existing hypothesis ID (e.g., H1)' },
                                evidence: { type: 'string', description: 'Evidence supporting/refuting' }
                            },
                            required: ['text', 'action']
                        }
                    },
                    findings: {
                        type: 'array',
                        description: 'Confirmed findings to record in working memory',
                        items: {
                            type: 'object',
                            properties: {
                                insight: { type: 'string', description: 'The finding' },
                                importance: { type: 'string', enum: ['high', 'medium', 'low'] },
                                source: { type: 'string', description: 'Which step/data supports this' }
                            },
                            required: ['insight']
                        }
                    },
                    open_questions: {
                        type: 'array',
                        description: 'Questions needing investigation',
                        items: {
                            type: 'object',
                            properties: {
                                question: { type: 'string' },
                                priority: { type: 'integer', minimum: 1, maximum: 5, description: '5=highest priority' }
                            },
                            required: ['question']
                        }
                    },
                    plan_revision: {
                        type: 'object',
                        description: 'If the investigation plan needs to change',
                        properties: {
                            reason: { type: 'string', description: 'Why plan needs revision' },
                            add_steps: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        action: { type: 'string', enum: ['query', 'template', 'dashboard'] },
                                        purpose: { type: 'string' },
                                        sql: { type: 'string' }
                                    }
                                }
                            },
                            skip_steps: {
                                type: 'array',
                                items: { type: 'integer' },
                                description: 'Step numbers to skip (1-based)'
                            }
                        }
                    },
                    confidence_assessment: {
                        type: 'object',
                        properties: {
                            overall: { type: 'number', description: 'Overall confidence 0-1' },
                            reasoning: { type: 'string', description: 'Why this confidence level' }
                        }
                    },
                    next_action: {
                        type: 'string',
                        enum: ['continue_plan', 'execute_query', 'ask_user', 'finalize'],
                        description: 'What to do after thinking'
                    },
                    immediate_query: {
                        type: 'object',
                        description: 'If next_action=execute_query, provide the query',
                        properties: {
                            sql: { type: 'string' },
                            purpose: { type: 'string' }
                        }
                    },
                    conclusion: {
                        type: 'string',
                        description: 'If next_action=finalize, provide the final answer'
                    }
                },
                required: ['thinking_type', 'reasoning_steps', 'next_action']
            }
        }
    ];
    
    /**
     * Get agent tools dynamically based on the plan
     * If a template was selected in planning, inject only that template's schema
     * instead of the generic execute_template tool. This saves tokens.
     */
    function getAgentToolsForPlan(plan) {
        // Start with base tools (excluding execute_template which we'll customize)
        const baseTools = AGENT_TOOLS.filter(t => t.name !== 'execute_template');
        
        // If plan selected a specific template, inject its schema
        if (plan && plan.template_match) {
            const template = Templates.getTemplate(plan.template_match);
            if (template) {
                // Build parameter schema from template definition
                const paramProperties = {};
                const requiredParams = [];
                
                if (template.parameters && template.parameters.length > 0) {
                    template.parameters.forEach(param => {
                        paramProperties[param.name] = {
                            type: param.type || 'string',
                            description: param.description || `Parameter: ${param.name}`
                        };
                        if (param.required) {
                            requiredParams.push(param.name);
                        }
                    });
                }
                
                // Add customized execute_template with this specific template
                baseTools.push({
                    name: 'execute_template',
                    description: `Execute the "${template.name}" template: ${template.description}`,
                    parameters: {
                        type: 'object',
                        properties: {
                            template_id: {
                                type: 'string',
                                enum: [template.id],  // Use enum instead of const (Gemini doesn't support const)
                                description: `Must be "${template.id}"`
                            },
                            parameters: {
                                type: 'object',
                                properties: paramProperties,
                                required: requiredParams,
                                description: 'Template parameters'
                            },
                            purpose: {
                                type: 'string',
                                description: 'Brief description of what this query retrieves'
                            }
                        },
                        required: ['template_id']
                    }
                });
                
                log.debug('Injected specific template schema', { 
                    templateId: template.id,
                    paramCount: Object.keys(paramProperties).length 
                });
            } else {
                // Template not found (typo or deprecated), use generic lightweight definition
                log.debug('Template not found, using generic execute_template', { 
                    templateMatch: plan.template_match 
                });
                baseTools.push({
                    name: 'execute_template',
                    description: 'Execute a pre-built query template. The specified template was not found - use a valid template_id.',
                    parameters: {
                        type: 'object',
                        properties: {
                            template_id: { 
                                type: 'string', 
                                description: 'Template ID (from planning phase)'
                            },
                            parameters: { 
                                type: 'object', 
                                description: 'Template parameters as key-value pairs'
                            }
                        },
                        required: ['template_id']
                    }
                });
            }
        } else {
            // No template selected, use generic execute_template (lightweight)
            baseTools.push({
                name: 'execute_template',
                description: 'Execute a pre-built query template. Use template_id from the plan.',
                parameters: {
                    type: 'object',
                    properties: {
                        template_id: { 
                            type: 'string', 
                            description: 'Template ID (from planning phase)'
                        },
                        parameters: { 
                            type: 'object', 
                            description: 'Template parameters as key-value pairs'
                        }
                    },
                    required: ['template_id']
                }
            });
        }
        
        return baseTools;
    }

    /**
     * Check if the model output tool-like content as text instead of using proper tool calls
     * Patterns are generated dynamically from AGENT_TOOLS to avoid coupling issues
     */
    function checkToolCompliance(text, tools) {
        if (!text) return { failed: false };
        
        // Build tool name pattern dynamically from available tools
        const toolsToUse = tools || AGENT_TOOLS;
        const toolNames = toolsToUse.map(t => t.name).join('|');
        
        // Patterns that indicate the model tried to output tool-like content as text
        const failurePatterns = [
            // JSON with tool-like structures (these are static - rich content types)
            /\{\s*"type"\s*:\s*"(?:transaction_card|metric|chart|table)"/i,
            /\{\s*"answer"\s*:/i,
            /\[\s*\{\s*"type"\s*:\s*"(?:metric|chart|table|transaction_card)"/i,
        ];
        
        // Add dynamic pattern for tool names if we have any
        if (toolNames) {
            // Pattern: "I will call/use [tool_name]" without actually calling
            failurePatterns.push(
                new RegExp(`(?:I will|I'll|Let me)\\s+(?:call|use)\\s+(?:the\\s+)?(?:${toolNames})`, 'i')
            );
        }
        
        for (const pattern of failurePatterns) {
            if (pattern.test(text)) {
                // Don't try to extract JSON with regex - it's too fragile
                // The retry mechanism will handle this by re-prompting the LLM
                return {
                    failed: true,
                    type: 'json_as_text',
                    pattern: pattern.toString()
                };
            }
        }
        
        return { failed: false };
    }

    return {
        // Individual tools
        SUITEQL_TOOL: SUITEQL_TOOL,
        PLANNING_TOOL: PLANNING_TOOL,
        PLANNING_RESOLVE_ENTITY_TOOL: PLANNING_RESOLVE_ENTITY_TOOL,
        THINK_TOOL: THINK_TOOL,
        INSPECT_RESULT_TOOL: INSPECT_RESULT_TOOL,
        REFLECT_AND_ADAPT_TOOL: REFLECT_AND_ADAPT_TOOL,
        FINAL_RESPONSE_TOOL: FINAL_RESPONSE_TOOL,  // CRITICAL: Export for DashboardHandler and QueryExecution
        
        // Tool collections
        AGENT_TOOLS: AGENT_TOOLS,
        
        // Dynamic tools
        getAgentToolsForPlan: getAgentToolsForPlan,
        
        // Compliance checking
        checkToolCompliance: checkToolCompliance
    };
});